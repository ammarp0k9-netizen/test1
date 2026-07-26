(function attachLootLinguaWordListData(root) {
  'use strict';

  const DEFAULT_PAGE_SIZE = 25;
  const DEFAULT_CACHE_PAGES = 3;
  const SORT_ALIASES = Object.freeze({
    latest: 'newest',
    'created-desc': 'newest',
    'created-asc': 'oldest',
    'gate-order': 'order',
    'order-asc': 'order',
    'order:asc': 'order',
    alphabetical: 'word-asc',
    'word-ascending': 'word-asc',
    'word-descending': 'word-desc',
    'updated-desc': 'updated'
  });

  function makeError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  function emptyFilterValue(value) {
    if (value === undefined || value === null) return true;
    const normalized = String(value).trim();
    return !normalized || normalized.toLowerCase() === 'all';
  }

  function normalizeFilters(value) {
    if (emptyFilterValue(value)) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const filters = {};
    Object.keys(value).sort().forEach((field) => {
      const normalizedField = String(field || '').trim();
      const filterValue = value[field];
      if (!normalizedField || normalizedField.toLowerCase() === 'all' || emptyFilterValue(filterValue)) {
        return;
      }
      filters[normalizedField] = typeof filterValue === 'string'
        ? filterValue.trim()
        : filterValue;
    });
    return filters;
  }

  function normalizeSort(value) {
    if (emptyFilterValue(value)) return 'newest';
    const normalized = String(value).trim().toLowerCase();
    return SORT_ALIASES[normalized] || normalized;
  }

  function normalizePageSize(value) {
    const pageSize = Number(value);
    return Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
  }

  function normalizeSearch(value) {
    if (emptyFilterValue(value)) return '';
    const text = String(value).trim();
    const schema = root.LootLinguaContentSchema;
    return schema && typeof schema.normalizeWord === 'function'
      ? schema.normalizeWord(text)
      : text;
  }

  function normalizeQuery(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sourceType = String(source.sourceType || '').trim();
    const normalized = {
      sourceType,
      sort: normalizeSort(source.sort),
      filters: normalizeFilters(source.filters ?? source.filter),
      pageSize: normalizePageSize(source.pageSize)
    };
    if (sourceType === 'admin-content-words') {
      normalized.worldId = String(source.worldId || '').trim();
      normalized.rankId = String(source.rankId || '').trim();
      normalized.gateId = String(source.gateId || '').trim();
      normalized.search = normalizeSearch(source.search);
    } else if (sourceType !== 'admin-content-word-import-staging') {
      Object.keys(source).sort().forEach((key) => {
        if (key in normalized || key === 'filter') return;
        const item = source[key];
        normalized[key] = item === undefined || item === null ? '' : item;
      });
    }
    return normalized;
  }

  function cloneQuery(value) {
    return normalizeQuery(value);
  }

  function stableSerialize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    ).join(',')}}`;
  }

  function createQuerySignature(query) {
    return `word-list:v2:${encodeURIComponent(stableSerialize(normalizeQuery(query)))}`;
  }

  function pageItemsCount(cache) {
    let total = 0;
    cache.forEach((page) => {
      total += page.items.length;
    });
    return total;
  }

  function createPagedWordSource(options) {
    const settings = options || {};
    if (typeof settings.fetchPage !== 'function') {
      throw makeError('word-list/fetch-page-required', 'fetchPage is required.');
    }
    const pageSize = normalizePageSize(settings.pageSize);
    const requestedCachePages = Number(settings.maxCachedPages);
    const maxCachedPages = Number.isSafeInteger(requestedCachePages) && requestedCachePages > 0
      ? requestedCachePages
      : DEFAULT_CACHE_PAGES;
    const getItemId = typeof settings.getItemId === 'function'
      ? settings.getItemId
      : (item) => String(item && (item.contentWordId || item.id) || '');

    let query = cloneQuery(settings.query);
    let querySignature = createQuerySignature(query);
    let generation = 0;
    let navigationId = 0;
    let currentPageIndex = null;
    const cache = new Map();
    const cursorLedger = new Map();
    const pending = new Map();

    function getCurrentPage() {
      return currentPageIndex === null ? null : (cache.get(currentPageIndex) || null);
    }

    function getSnapshot() {
      const currentPage = getCurrentPage();
      return {
        query: cloneQuery(query),
        querySignature,
        generation,
        pageSize,
        currentPageIndex,
        currentPage,
        cache: {
          pageCount: cache.size,
          itemCount: pageItemsCount(cache),
          pageIndexes: Array.from(cache.keys()).sort((a, b) => a - b),
          ledgerPageIndexes: Array.from(cursorLedger.keys()).sort((a, b) => a - b)
        },
        loading: {
          initial: pending.has('initial'),
          next: pending.has('next'),
          previous: pending.has('previous'),
          refresh: pending.has('refresh')
        }
      };
    }

    function normalizePage(result, pageIndex) {
      if (!result || typeof result !== 'object' || !Array.isArray(result.items)) {
        throw makeError('word-list/invalid-page', 'The page source returned an invalid page.');
      }
      const seen = new Set();
      const items = result.items.filter((item, index) => {
        const id = String(getItemId(item, index) || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const startCursor = result.startCursor ?? result.firstCursor ?? null;
      const endCursor = result.endCursor ?? result.nextCursor ?? null;
      const beforeCursor = result.beforeCursor ?? null;
      return {
        items,
        pageKey: `${querySignature}:${pageIndex}:${beforeCursor || ''}:${endCursor || ''}`,
        pageIndex,
        startCursor,
        endCursor,
        beforeCursor,
        hasNext: Boolean(result.hasNext ?? result.hasMore),
        hasPrevious: Boolean(result.hasPrevious ?? pageIndex > 0),
        querySignature
      };
    }

    function writePage(page) {
      cache.set(page.pageIndex, page);
      cursorLedger.set(page.pageIndex, {
        pageKey: page.pageKey,
        pageIndex: page.pageIndex,
        startCursor: page.startCursor,
        endCursor: page.endCursor,
        beforeCursor: page.beforeCursor,
        hasNext: page.hasNext,
        hasPrevious: page.hasPrevious,
        querySignature: page.querySignature
      });
      currentPageIndex = page.pageIndex;
      evictDistantPages();
    }

    function evictDistantPages() {
      while (cache.size > maxCachedPages) {
        const candidates = Array.from(cache.keys()).filter((index) => index !== currentPageIndex);
        candidates.sort((left, right) => {
          const leftDistance = Math.abs(left - currentPageIndex);
          const rightDistance = Math.abs(right - currentPageIndex);
          return rightDistance - leftDistance || left - right;
        });
        const evictedIndex = candidates[0];
        if (evictedIndex === undefined) return;
        cache.delete(evictedIndex);
      }
    }

    function reset(nextQuery) {
      if (nextQuery !== undefined) query = cloneQuery(nextQuery);
      querySignature = createQuerySignature(query);
      generation += 1;
      navigationId += 1;
      currentPageIndex = null;
      cache.clear();
      cursorLedger.clear();
      pending.clear();
    }

    async function requestPage(requestKey, direction, pageIndex, cursor) {
      if (pending.has(requestKey)) return pending.get(requestKey);
      const requestGeneration = generation;
      const requestNavigationId = ++navigationId;
      const task = Promise.resolve()
        .then(() => settings.fetchPage({
          query: cloneQuery(query),
          querySignature,
          pageSize,
          direction,
          cursor: cursor || null,
          generation: requestGeneration
        }))
        .then((result) => {
          if (requestGeneration !== generation || requestNavigationId !== navigationId) {
            return getSnapshot();
          }
          writePage(normalizePage(result, pageIndex));
          return getSnapshot();
        }, (error) => {
          if (requestGeneration !== generation || requestNavigationId !== navigationId) {
            return getSnapshot();
          }
          throw error;
        })
        .finally(() => {
          if (pending.get(requestKey) === task) pending.delete(requestKey);
        });
      pending.set(requestKey, task);
      return task;
    }

    function activateCachedPage(pageIndex) {
      const page = cache.get(pageIndex);
      if (!page) return null;
      navigationId += 1;
      currentPageIndex = pageIndex;
      evictDistantPages();
      return getSnapshot();
    }

    function loadInitialPage(nextQuery) {
      reset(nextQuery === undefined ? query : nextQuery);
      return requestPage('initial', 'forward', 0, null);
    }

    function loadNextPage() {
      const currentPage = getCurrentPage();
      if (!currentPage || !currentPage.hasNext) return Promise.resolve(getSnapshot());
      const pageIndex = currentPage.pageIndex + 1;
      const cached = activateCachedPage(pageIndex);
      if (cached) return Promise.resolve(cached);
      return requestPage('next', 'forward', pageIndex, currentPage.endCursor);
    }

    function loadPreviousPage() {
      const currentPage = getCurrentPage();
      if (!currentPage || !currentPage.hasPrevious || currentPage.pageIndex <= 0) {
        return Promise.resolve(getSnapshot());
      }
      const pageIndex = currentPage.pageIndex - 1;
      const cached = activateCachedPage(pageIndex);
      if (cached) return Promise.resolve(cached);
      return requestPage('previous', 'backward', pageIndex, currentPage.startCursor);
    }

    function refreshCurrentPage() {
      const currentPage = getCurrentPage();
      if (!currentPage) return loadInitialPage();
      return requestPage('refresh', 'forward', currentPage.pageIndex, currentPage.beforeCursor);
    }

    return Object.freeze({
      loadInitialPage,
      loadNextPage,
      loadPreviousPage,
      refreshCurrentPage,
      invalidate(nextQuery) {
        reset(nextQuery);
        return getSnapshot();
      },
      getSnapshot
    });
  }

  const API = Object.freeze({
    normalizeQuery,
    createQuerySignature,
    createPagedWordSource,
    DEFAULT_PAGE_SIZE,
    DEFAULT_CACHE_PAGES
  });

  Object.defineProperty(root, 'LootLinguaWordListData', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false
  });
}(typeof window !== 'undefined' ? window : globalThis));
