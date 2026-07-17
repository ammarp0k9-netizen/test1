(function attachLootLinguaWordListData(root) {
  'use strict';

  const DEFAULT_PAGE_SIZE = 25;
  const DEFAULT_CACHE_PAGES = 3;

  function makeError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  function cloneQuery(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return { ...value };
  }

  function stableSerialize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    ).join(',')}}`;
  }

  function createQuerySignature(query) {
    return `word-list:v1:${stableSerialize(cloneQuery(query))}`;
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
    const pageSize = Number.isSafeInteger(settings.pageSize) && settings.pageSize > 0
      ? settings.pageSize
      : DEFAULT_PAGE_SIZE;
    const maxCachedPages = Number.isSafeInteger(settings.maxCachedPages) && settings.maxCachedPages > 0
      ? settings.maxCachedPages
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
