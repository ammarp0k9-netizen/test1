(function attachPersonalDictionaryData(root) {
  'use strict';

  const DEFAULT_PAGE_SIZE = 50;
  const DEFAULT_CACHE_PAGES = 3;
  const SEARCH_PROJECTION_TTL_MS = 5 * 60 * 1000;

  function normalizeQuery(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      source: String(source.source || 'personal'),
      sort: String(source.sort || 'newest'),
      filter: String(source.filter || 'all'),
    };
  }

  function stableQuerySignature(owner, query) {
    return [
      String(owner?.type || 'guest'),
      String(owner?.id || 'guest'),
      query.source,
      query.sort,
      query.filter,
    ].join('::');
  }

  function wordId(word) {
    return String(word?.id || '');
  }

  function lightweightProjection(word = {}) {
    return {
      id: wordId(word),
      word: String(word.word || word.text || ''),
      meaning: String(word.meaning || word.translation || ''),
      example: String(word.example || ''),
      category: String(word.category || ''),
      starred: Boolean(word.starred),
      hiddenFromDictionary: word.hiddenFromDictionary === true,
      personalDictionaryState: word.personalDictionaryState === 'moved-to-private-world'
        ? 'moved-to-private-world'
        : 'active',
      createdAt: word.createdAt || null,
      order: Number.isFinite(word.order) ? word.order : null,
      normalizedWord: String(word.normalizedWord || word.word || word.text || '').toLowerCase().trim(),
      wordLower: String(word.word || word.text || '').toLowerCase(),
      meaningLower: String(word.meaning || word.translation || '').toLowerCase(),
      exampleLower: String(word.example || '').toLowerCase(),
    };
  }

  function isVisibleWord(word) {
    return Boolean(word) && word.hiddenFromDictionary !== true &&
      word.personalDictionaryState !== 'moved-to-private-world';
  }

  function createMetrics() {
    return {
      sourceTotal: 0,
      loadedFullWords: 0,
      cachedPages: 0,
      cachedWords: 0,
      renderedCards: 0,
      pageRequests: 0,
      activeListeners: 0,
      fullDatasetResolves: {},
      fullListUiRebuilds: 0,
      staleResponseDrops: 0,
      singleWordPatches: 0,
      maxCachedWords: 0,
      maxRenderedCards: 0,
      searchProjectionBuilds: 0,
      searchProjectionReuses: 0,
    };
  }

  function createRepository(options = {}) {
    const pageSize = Number.isSafeInteger(options.pageSize) && options.pageSize > 0
      ? options.pageSize
      : DEFAULT_PAGE_SIZE;
    const maxCachedPages = Number.isSafeInteger(options.maxCachedPages) && options.maxCachedPages > 0
      ? options.maxCachedPages
      : DEFAULT_CACHE_PAGES;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const metrics = createMetrics();
    const subscribers = new Set();
    const cache = new Map();
    const ledger = new Map();
    const pending = new Map();
    const purposeCache = new Map();
    const searchFullCache = new Map();
    let owner = { type: 'guest', id: 'guest' };
    let adapter = null;
    let query = normalizeQuery();
    let querySignature = stableQuerySignature(owner, query);
    let generation = 0;
    let currentPageIndex = null;
    let activeUnsubscribe = null;
    let totalCount = 0;
    let filteredCount = null;
    let searchProjection = null;
    let searchProjectionBuiltAt = 0;
    let searchProjectionGeneration = -1;
    let searchBuildPromise = null;
    let revision = 0;

    function notify(detail = {}) {
      const snapshot = getSnapshot();
      subscribers.forEach((listener) => {
        try { listener(snapshot, detail); } catch (_) {}
      });
      return snapshot;
    }

    function stopListener() {
      if (!activeUnsubscribe) return;
      try { activeUnsubscribe(); } catch (_) {}
      activeUnsubscribe = null;
      metrics.activeListeners = 0;
    }

    function resetState({ keepOwner = true } = {}) {
      stopListener();
      generation += 1;
      currentPageIndex = null;
      cache.clear();
      ledger.clear();
      pending.clear();
      purposeCache.clear();
      searchFullCache.clear();
      searchProjection = null;
      searchProjectionBuiltAt = 0;
      searchProjectionGeneration = -1;
      searchBuildPromise = null;
      totalCount = 0;
      filteredCount = null;
      revision += 1;
      metrics.loadedFullWords = 0;
      metrics.cachedPages = 0;
      metrics.cachedWords = 0;
      metrics.sourceTotal = 0;
      if (!keepOwner) {
        owner = { type: 'guest', id: 'guest' };
        adapter = null;
      }
    }

    function configure(settings = {}) {
      const nextOwner = {
        type: String(settings.ownerType || 'guest'),
        id: String(settings.ownerId || 'guest'),
      };
      const nextQuery = normalizeQuery(settings.query || query);
      const nextSignature = stableQuerySignature(nextOwner, nextQuery);
      const ownerChanged = nextOwner.type !== owner.type || nextOwner.id !== owner.id;
      const adapterChanged = settings.adapter !== undefined && settings.adapter !== adapter;
      if (ownerChanged || adapterChanged || nextSignature !== querySignature) resetState();
      owner = nextOwner;
      if (settings.adapter !== undefined) adapter = settings.adapter;
      query = nextQuery;
      querySignature = stableQuerySignature(owner, query);
      notify({ type: 'configure', ownerChanged });
      return getSnapshot();
    }

    function pageItemCount() {
      let count = 0;
      cache.forEach((page) => { count += page.items.length; });
      return count;
    }

    function updateCacheMetrics() {
      metrics.cachedPages = cache.size;
      metrics.cachedWords = pageItemCount() + searchFullCache.size;
      metrics.loadedFullWords = metrics.cachedWords;
      metrics.maxCachedWords = Math.max(metrics.maxCachedWords, metrics.cachedWords);
    }

    function evictDistantPages() {
      while (cache.size > maxCachedPages) {
        const candidates = [...cache.keys()].filter((index) => index !== currentPageIndex);
        candidates.sort((left, right) => {
          const leftDistance = Math.abs(left - Number(currentPageIndex || 0));
          const rightDistance = Math.abs(right - Number(currentPageIndex || 0));
          return rightDistance - leftDistance || left - right;
        });
        if (!candidates.length) break;
        cache.delete(candidates[0]);
      }
      updateCacheMetrics();
    }

    function normalizePage(result, pageIndex, requestCursor) {
      const items = [];
      const seen = new Set();
      (Array.isArray(result?.items) ? result.items : []).forEach((word) => {
        const id = wordId(word);
        if (!id || seen.has(id)) return;
        seen.add(id);
        items.push(word);
      });
      return {
        pageIndex,
        items,
        beforeCursor: result?.beforeCursor ?? requestCursor ?? null,
        startCursor: result?.startCursor ?? null,
        endCursor: result?.endCursor ?? null,
        hasPrevious: Boolean(result?.hasPrevious ?? pageIndex > 0),
        hasNext: Boolean(result?.hasNext ?? result?.hasMore),
        querySignature,
      };
    }

    function diffPages(previous, next) {
      if (!previous) return { structural: true, changedIds: next.items.map(wordId) };
      const previousIds = previous.items.map(wordId);
      const nextIds = next.items.map(wordId);
      const structural = previousIds.join('|') !== nextIds.join('|');
      const previousById = new Map(previous.items.map((word) => [wordId(word), JSON.stringify(word)]));
      const changedIds = next.items
        .filter((word) => previousById.get(wordId(word)) !== JSON.stringify(word))
        .map(wordId);
      return { structural, changedIds };
    }

    function writePage(page, { activate = false, reason = 'page' } = {}) {
      if (page.querySignature !== querySignature) return getSnapshot();
      const previous = cache.get(page.pageIndex);
      cache.set(page.pageIndex, page);
      ledger.set(page.pageIndex, {
        pageIndex: page.pageIndex,
        beforeCursor: page.beforeCursor,
        startCursor: page.startCursor,
        endCursor: page.endCursor,
        hasPrevious: page.hasPrevious,
        hasNext: page.hasNext,
      });
      if (activate || currentPageIndex === null) currentPageIndex = page.pageIndex;
      evictDistantPages();
      const diff = diffPages(previous, page);
      notify({ type: reason, pageIndex: page.pageIndex, ...diff });
      return getSnapshot();
    }

    function buildRequest(pageIndex, direction, cursor) {
      return {
        owner: { ...owner },
        query: { ...query },
        querySignature,
        generation,
        pageIndex,
        pageSize,
        direction,
        cursor: cursor || null,
      };
    }

    function attachCurrentListener(page) {
      stopListener();
      if (!adapter?.listenPage || owner.type !== 'account' || !page) return;
      const listenerGeneration = generation;
      const request = buildRequest(page.pageIndex, 'forward', page.beforeCursor);
      activeUnsubscribe = adapter.listenPage(request, (result) => {
        if (listenerGeneration !== generation || request.querySignature !== querySignature) {
          metrics.staleResponseDrops += 1;
          return;
        }
        writePage(normalizePage(result, page.pageIndex, page.beforeCursor), {
          activate: true,
          reason: 'listener',
        });
      }, () => {
        notify({ type: 'listener-error', pageIndex: page.pageIndex });
      });
      metrics.activeListeners = 1;
    }

    async function requestPage(pageIndex, direction, cursor, settings = {}) {
      if (!adapter?.fetchPage && !adapter?.openPageListener) {
        throw new Error('personal-dictionary/page-adapter-unavailable');
      }
      const requestKey = `${generation}:${pageIndex}:${direction}:${JSON.stringify(cursor || null)}`;
      if (pending.has(requestKey)) return pending.get(requestKey);
      const requestGeneration = generation;
      const request = buildRequest(pageIndex, direction, cursor);
      metrics.pageRequests += 1;
      const source = settings.listen === true && adapter?.openPageListener
        ? Promise.resolve(adapter.openPageListener(request, (result) => {
          if (requestGeneration !== generation || request.querySignature !== querySignature) {
            metrics.staleResponseDrops += 1;
            return;
          }
          writePage(normalizePage(result, pageIndex, cursor), {
            activate: true,
            reason: 'listener',
          });
        }))
        : Promise.resolve(adapter.fetchPage(request));
      const task = source.then((opened) => {
        const result = opened?.initial || opened;
        if (requestGeneration !== generation || request.querySignature !== querySignature) {
          try { opened?.unsubscribe?.(); } catch (_) {}
          metrics.staleResponseDrops += 1;
          return getSnapshot();
        }
        if (opened?.unsubscribe) {
          stopListener();
          activeUnsubscribe = opened.unsubscribe;
          metrics.activeListeners = 1;
        }
        const snapshot = writePage(normalizePage(result, pageIndex, cursor), {
          activate: settings.activate === true,
          reason: settings.reason || 'page',
        });
        if (settings.listen === true && !opened?.unsubscribe) attachCurrentListener(cache.get(pageIndex));
        return snapshot;
      }).finally(() => {
        if (pending.get(requestKey) === task) pending.delete(requestKey);
      });
      pending.set(requestKey, task);
      return task;
    }

    async function loadCounts() {
      const countGeneration = generation;
      if (!adapter?.getCounts) return getSnapshot();
      const result = await adapter.getCounts({ owner: { ...owner }, query: { ...query }, generation });
      if (countGeneration !== generation) {
        metrics.staleResponseDrops += 1;
        return getSnapshot();
      }
      totalCount = Math.max(0, Number(result?.totalCount) || 0);
      filteredCount = Number.isFinite(result?.filteredCount) ? Number(result.filteredCount) : null;
      metrics.sourceTotal = totalCount;
      notify({ type: 'counts' });
      return getSnapshot();
    }

    async function loadInitial(nextQuery) {
      if (nextQuery) {
        const normalized = normalizeQuery(nextQuery);
        const signature = stableQuerySignature(owner, normalized);
        if (signature !== querySignature) {
          resetState();
          query = normalized;
          querySignature = signature;
        }
      }
      const countsPromise = loadCounts().catch(() => getSnapshot());
      const pagePromise = requestPage(0, 'forward', null, { activate: true, listen: true, reason: 'initial' });
      await Promise.all([countsPromise, pagePromise]);
      return getSnapshot();
    }

    function activateCachedPage(pageIndex) {
      const page = cache.get(pageIndex);
      if (!page) return null;
      currentPageIndex = pageIndex;
      evictDistantPages();
      attachCurrentListener(page);
      return notify({ type: 'activate', pageIndex, structural: true });
    }

    async function loadNext({ prefetch = false } = {}) {
      const current = cache.get(currentPageIndex);
      if (!current || !current.hasNext) return getSnapshot();
      const pageIndex = current.pageIndex + 1;
      if (cache.has(pageIndex)) {
        return prefetch ? getSnapshot() : activateCachedPage(pageIndex);
      }
      return requestPage(pageIndex, 'forward', current.endCursor, {
        activate: !prefetch,
        listen: !prefetch,
        reason: prefetch ? 'prefetch' : 'next',
      });
    }

    async function loadPrevious({ prefetch = false } = {}) {
      const current = cache.get(currentPageIndex);
      if (!current || !current.hasPrevious || current.pageIndex <= 0) return getSnapshot();
      const pageIndex = current.pageIndex - 1;
      if (cache.has(pageIndex)) {
        return prefetch ? getSnapshot() : activateCachedPage(pageIndex);
      }
      return requestPage(pageIndex, 'backward', current.startCursor, {
        activate: !prefetch,
        listen: !prefetch,
        reason: prefetch ? 'prefetch' : 'previous',
      });
    }

    async function refreshCurrentPage() {
      const current = cache.get(currentPageIndex);
      if (!current) return loadInitial();
      return requestPage(current.pageIndex, 'forward', current.beforeCursor, {
        activate: true,
        listen: true,
        reason: 'refresh',
      });
    }

    function getLoadedItems() {
      const seen = new Set();
      const result = [];
      [...cache.keys()].sort((a, b) => a - b).forEach((pageIndex) => {
        cache.get(pageIndex).items.forEach((word) => {
          const id = wordId(word);
          if (!id || seen.has(id)) return;
          seen.add(id);
          result.push(word);
        });
      });
      return result;
    }

    function getItemAt(index) {
      const pageIndex = Math.floor(Math.max(0, index) / pageSize);
      const page = cache.get(pageIndex);
      return page?.items[index - (pageIndex * pageSize)] || null;
    }

    function getVirtualCount() {
      if (!ledger.size) return 0;
      const highestIndex = Math.max(...ledger.keys());
      const highest = ledger.get(highestIndex);
      const known = (highestIndex * pageSize) + (cache.get(highestIndex)?.items.length || pageSize);
      const extent = known + (highest?.hasNext ? pageSize : 0);
      return totalCount > 0 ? Math.min(totalCount, extent) : extent;
    }

    async function ensurePageForIndex(index) {
      const target = Math.floor(Math.max(0, Number(index) || 0) / pageSize);
      if (target === currentPageIndex) return getSnapshot();
      if (cache.has(target)) return activateCachedPage(target);
      if (target === currentPageIndex + 1) return loadNext();
      if (target === currentPageIndex - 1) return loadPrevious();
      return getSnapshot();
    }

    function invalidateSearchProjection() {
      searchProjection = null;
      searchProjectionBuiltAt = 0;
      searchProjectionGeneration = -1;
      searchBuildPromise = null;
      searchFullCache.clear();
      updateCacheMetrics();
    }

    async function buildSearchProjection() {
      const isFresh = searchProjection && searchProjectionGeneration === generation &&
        now() - searchProjectionBuiltAt < SEARCH_PROJECTION_TTL_MS;
      if (isFresh) {
        metrics.searchProjectionReuses += 1;
        return searchProjection;
      }
      if (searchBuildPromise) return searchBuildPromise;
      if (!adapter?.scanAll) throw new Error('personal-dictionary/search-adapter-unavailable');
      const buildGeneration = generation;
      const projections = [];
      const seen = new Set();
      metrics.searchProjectionBuilds += 1;
      metrics.fullDatasetResolves['search-index'] = (metrics.fullDatasetResolves['search-index'] || 0) + 1;
      searchBuildPromise = Promise.resolve(adapter.scanAll({
        owner: { ...owner },
        query: { source: 'personal', sort: 'newest', filter: 'all' },
        generation: buildGeneration,
        pageSize,
        purpose: 'search-index',
        onPage(words) {
          if (buildGeneration !== generation) return;
          (Array.isArray(words) ? words : []).forEach((word) => {
            const projection = lightweightProjection(word);
            if (!projection.id || seen.has(projection.id)) return;
            seen.add(projection.id);
            projections.push(projection);
          });
        },
      })).then(() => {
        if (buildGeneration !== generation) {
          metrics.staleResponseDrops += 1;
          return [];
        }
        searchProjection = projections;
        searchProjectionBuiltAt = now();
        searchProjectionGeneration = generation;
        return searchProjection;
      }).finally(() => {
        searchBuildPromise = null;
      });
      return searchBuildPromise;
    }

    function filterSearchProjection(projections, searchText, searchType = 'all', filter = 'all') {
      const term = String(searchText || '').toLowerCase().trim();
      if (!term) return [];
      const matches = projections.filter((item) => {
        if (!isVisibleWord(item)) return false;
        if (filter === 'starred' && !item.starred) return false;
        const wordMatch = item.wordLower.includes(term);
        const meaningMatch = item.meaningLower.includes(term);
        const exampleMatch = item.exampleLower.includes(term);
        if (searchType === 'word') return wordMatch;
        if (searchType === 'meaning') return meaningMatch;
        if (searchType === 'example') return exampleMatch;
        return wordMatch || meaningMatch || exampleMatch;
      });
      matches.sort((left, right) => {
        const leftStarts = left.wordLower.startsWith(term);
        const rightStarts = right.wordLower.startsWith(term);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        return left.word.localeCompare(right.word);
      });
      filteredCount = matches.length;
      return matches;
    }

    async function search(searchText, searchType = 'all', filter = 'all') {
      const projections = await buildSearchProjection();
      if (searchProjectionGeneration !== generation) return [];
      return filterSearchProjection(projections, searchText, searchType, filter);
    }

    function trimSearchFullCache() {
      while (searchFullCache.size > pageSize * maxCachedPages) {
        searchFullCache.delete(searchFullCache.keys().next().value);
      }
      updateCacheMetrics();
    }

    async function resolveSearchItems(projections = []) {
      const missing = projections.map((item) => item.id).filter((id) => id && !searchFullCache.has(id));
      if (missing.length && adapter?.getByIds) {
        const requestGeneration = generation;
        const words = await adapter.getByIds({ owner: { ...owner }, ids: missing, generation });
        if (requestGeneration !== generation) {
          metrics.staleResponseDrops += 1;
          return [];
        }
        (Array.isArray(words) ? words : []).forEach((word) => {
          const id = wordId(word);
          if (!id) return;
          searchFullCache.delete(id);
          searchFullCache.set(id, word);
        });
        trimSearchFullCache();
      }
      return projections.map((item) => searchFullCache.get(item.id) || item);
    }

    async function resolveAll(purpose = 'compatibility', settings = {}) {
      const key = String(purpose || 'compatibility');
      const cached = purposeCache.get(key);
      if (!settings.force && cached?.generation === generation) return cached.words;
      if (!adapter?.scanAll) return getLoadedItems();
      const resolveGeneration = generation;
      metrics.fullDatasetResolves[key] = (metrics.fullDatasetResolves[key] || 0) + 1;
      const words = [];
      const seen = new Set();
      await adapter.scanAll({
        owner: { ...owner },
        query: { source: 'personal', sort: settings.sort || 'newest', filter: settings.filter || 'all' },
        generation: resolveGeneration,
        pageSize,
        purpose: key,
        onPage(items) {
          if (resolveGeneration !== generation) return;
          (Array.isArray(items) ? items : []).forEach((word) => {
            const id = wordId(word);
            if (!id || seen.has(id)) return;
            seen.add(id);
            words.push(word);
          });
        },
      });
      if (resolveGeneration !== generation) {
        metrics.staleResponseDrops += 1;
        return [];
      }
      purposeCache.set(key, { generation, words, createdAt: now() });
      return words;
    }

    function releasePurpose(purpose) {
      purposeCache.delete(String(purpose || ''));
    }

    async function getByWordKey(wordOrKey) {
      if (!adapter?.getByWordKey) return null;
      const requestGeneration = generation;
      const result = await adapter.getByWordKey({ owner: { ...owner }, wordOrKey, generation });
      if (requestGeneration !== generation) {
        metrics.staleResponseDrops += 1;
        return null;
      }
      return result || null;
    }

    function patchProjection(id, nextWord, remove = false) {
      if (!searchProjection) return;
      const index = searchProjection.findIndex((item) => item.id === id);
      if (remove) {
        if (index >= 0) searchProjection.splice(index, 1);
        searchFullCache.delete(id);
        return;
      }
      const projection = lightweightProjection(nextWord);
      if (index >= 0) searchProjection[index] = projection;
      else if (projection.id) searchProjection.push(projection);
      searchFullCache.delete(id);
      searchFullCache.set(id, nextWord);
      trimSearchFullCache();
    }

    function patchWord(idValue, patch) {
      const id = String(idValue || '');
      if (!id) return null;
      let updated = null;
      cache.forEach((page) => {
        page.items = page.items.map((word) => {
          if (wordId(word) !== id) return word;
          updated = typeof patch === 'function' ? patch(word) : { ...word, ...(patch || {}) };
          return updated;
        });
      });
      if (updated) patchProjection(id, updated);
      revision += 1;
      purposeCache.clear();
      metrics.singleWordPatches += 1;
      notify({ type: 'patch', changedIds: [id], structural: false });
      return updated;
    }

    function removeWord(idValue) {
      const id = String(idValue || '');
      let removed = null;
      cache.forEach((page) => {
        const found = page.items.find((word) => wordId(word) === id);
        if (found) removed = found;
        page.items = page.items.filter((word) => wordId(word) !== id);
      });
      patchProjection(id, null, true);
      purposeCache.clear();
      revision += 1;
      updateCacheMetrics();
      notify({ type: 'remove', changedIds: [id], structural: true });
      return removed;
    }

    function insertWord(word, settings = {}) {
      const id = wordId(word);
      if (!id) return null;
      const page = cache.get(settings.pageIndex ?? 0) || cache.get(currentPageIndex);
      if (page && !page.items.some((item) => wordId(item) === id)) {
        page.items.unshift(word);
        if (page.items.length > pageSize) page.items.length = pageSize;
      }
      patchProjection(id, word);
      purposeCache.clear();
      revision += 1;
      totalCount += 1;
      metrics.sourceTotal = totalCount;
      updateCacheMetrics();
      notify({ type: 'insert', changedIds: [id], structural: true });
      return word;
    }

    function getSnapshot() {
      const currentPage = currentPageIndex === null ? null : (cache.get(currentPageIndex) || null);
      return {
        owner: { ...owner },
        query: { ...query },
        querySignature,
        generation,
        revision,
        pageSize,
        maxCachedPages,
        currentPageIndex,
        currentPage,
        totalCount,
        loadedCount: pageItemCount(),
        visibleCount: getLoadedItems().filter(isVisibleWord).length,
        filteredCount,
        virtualCount: getVirtualCount(),
        cache: {
          pageCount: cache.size,
          wordCount: pageItemCount(),
          pageIndexes: [...cache.keys()].sort((a, b) => a - b),
          ledgerPageIndexes: [...ledger.keys()].sort((a, b) => a - b),
        },
        listenerCount: metrics.activeListeners,
        metrics: {
          ...metrics,
          fullDatasetResolves: { ...metrics.fullDatasetResolves },
        },
      };
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    }

    function recordRenderedCards(count) {
      metrics.renderedCards = Math.max(0, Number(count) || 0);
      metrics.maxRenderedCards = Math.max(metrics.maxRenderedCards, metrics.renderedCards);
    }

    function destroy() {
      resetState({ keepOwner: false });
      subscribers.clear();
    }

    function pause() {
      stopListener();
      notify({ type: 'pause' });
    }

    function resume() {
      const page = cache.get(currentPageIndex);
      if (page) attachCurrentListener(page);
      return getSnapshot();
    }

    return Object.freeze({
      configure,
      loadInitial,
      loadNext,
      loadPrevious,
      prefetchNext: () => loadNext({ prefetch: true }),
      prefetchPrevious: () => loadPrevious({ prefetch: true }),
      refreshCurrentPage,
      ensurePageForIndex,
      getLoadedItems,
      getItemAt,
      getSnapshot,
      loadCounts,
      search,
      resolveSearchItems,
      invalidateSearchProjection,
      resolveAll,
      releasePurpose,
      getByWordKey,
      patchWord,
      removeWord,
      insertWord,
      subscribe,
      recordRenderedCards,
      pause,
      resume,
      destroy,
    });
  }

  const API = Object.freeze({
    createRepository,
    normalizeQuery,
    lightweightProjection,
    DEFAULT_PAGE_SIZE,
    DEFAULT_CACHE_PAGES,
    SEARCH_PROJECTION_TTL_MS,
  });

  Object.defineProperty(root, 'LootLinguaPersonalDictionaryData', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
