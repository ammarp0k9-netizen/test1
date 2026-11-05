(function attachDictionaryPages(root) {
  'use strict';

  // Data pagination and DOM windowing are independent. Nothing here drains
  // the source in the background: next() reads exactly one bounded page.
  function create({ ownerId, fetchPage, fetchCounts, onChange = () => {}, pageSize = 80, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
    const rows = new Map();
    const fullRequests = new Set();
    let cursor = null, complete = false, disposed = false, pending = null, draining = null;
    let error = null, counts = null, countPending = null, revision = 0, offline = false;
    let snapshot = [];
    const stale = () => Object.assign(new Error('Dictionary owner changed.'), { code: 'dictionary/stale' });
    const state = () => ({ ownerId, pageSize, loaded: rows.size, complete, loading: Boolean(pending), error, counts, revision, offline });
    function publish() {
      revision += 1;
      snapshot = [...rows.values()];
      if (!disposed) onChange(snapshot, state());
    }
    async function refreshCounts() {
      if (!fetchCounts || disposed) return counts;
      if (countPending) return countPending;
      countPending = Promise.resolve().then(fetchCounts).then(value => {
        if (disposed) throw stale();
        counts = value;
        publish();
        return counts;
      }).finally(() => { countPending = null; });
      return countPending;
    }
    function next() {
      if (disposed) return Promise.reject(stale());
      if (pending) return pending;
      if (complete) return Promise.resolve(snapshot);
      error = null;
      pending = Promise.resolve().then(() => fetchPage(cursor, pageSize, counts)).then(page => {
        if (disposed) throw stale();
        if (page.fromCache && !page.complete) {
          throw Object.assign(new Error('An online response is required to continue the dictionary.'), { code: 'dictionary/offline' });
        }
        for (const word of page.words || []) {
          const id = String(word.id);
          const expanded = rows.get(id)?.expanded;
          rows.set(id, expanded === undefined ? word : { ...word, expanded });
        }
        cursor = page.cursor;
        complete = page.done === true;
        return snapshot;
      }).catch(reason => { error = reason; throw reason; }).finally(() => {
        pending = null;
        if (!disposed) publish();
      });
      onChange(snapshot, state());
      return pending.then(() => snapshot);
    }
    function ensureComplete({ signal } = {}) {
      if (disposed) return Promise.reject(stale());
      const aborted = () => Object.assign(new Error('Dictionary request cancelled.'), { name: 'AbortError' });
      if (signal?.aborted) return Promise.reject(aborted());
      const token = {};
      fullRequests.add(token);
      let onAbort;
      const cancellation = new Promise((_resolve, reject) => {
        onAbort = () => { fullRequests.delete(token); reject(aborted()); };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      if (!draining) {
        draining = Promise.resolve().then(async () => {
          while (!complete && fullRequests.size) { await next(); if (!complete) await yieldTask(); }
          return snapshot;
        }).finally(() => { draining = null; });
      }
      const result = draining.then(() => {
        if (disposed) throw stale();
        if (!complete && fullRequests.has(token)) return ensureComplete({ signal });
        return snapshot;
      });
      return Promise.race([result, cancellation]).finally(() => {
        fullRequests.delete(token);
        signal?.removeEventListener('abort', onAbort);
      });
    }
    function replaceLoaded(words) {
      if (disposed) return false;
      const nextRows = new Map((Array.isArray(words) ? words : []).map(word => [String(word.id), word]));
      rows.clear();
      nextRows.forEach((word, id) => rows.set(id, word));
      snapshot = [...rows.values()];
      revision += 1;
      return true;
    }
    function merge(words, removedIds = []) {
      if (disposed) return;
      removedIds.forEach(id => rows.delete(String(id)));
      words.forEach(word => rows.set(String(word.id), { ...word, expanded: Boolean(rows.get(String(word.id))?.expanded) }));
      publish();
    }
    return { ownerId, state, words: () => snapshot, next, ensureComplete, refreshCounts, replaceLoaded, merge,
      restoreBackup(words) { replaceLoaded(words); complete = true; offline = true; error = null; publish(); },
      reset() { rows.clear(); cursor = null; complete = false; offline = false; error = null; counts = null; publish(); },
      dispose() { disposed = true; rows.clear(); snapshot = []; } };
  }

  let active = null;
  const api = {
    create,
    current(ownerId = root.auth?.currentUser?.uid) { return active && active.ownerId === ownerId ? active : null; },
    activate(options) { active?.dispose(); active = create(options); return active; },
    clear() { active?.dispose(); active = null; },
    async requireComplete({ personal = true } = {}) {
      const store = personal ? api.current() : null;
      if (!store || store.state().complete) return true;
      const uid = store.ownerId;
      const navigation = root.__dictionaryNavigationGeneration;
      const controller = root.AbortController ? new root.AbortController() : null;
      const onNavigation = () => { if (root.__dictionaryNavigationGeneration !== navigation) controller?.abort(); };
      root.addEventListener?.('lootlingua:dictionary-navigation', onNavigation);
      const status = root.document?.getElementById('dictionaryLoadStatus');
      if (status) status.textContent = 'جارٍ تجهيز القاموس كاملًا لهذه العملية…';
      try {
        await store.ensureComplete({ signal: controller?.signal });
        return api.current(uid) === store && root.auth?.currentUser?.uid === uid && root.__dictionaryNavigationGeneration === navigation;
      } catch (error) {
        if (error?.code !== 'dictionary/stale' && error?.name !== 'AbortError') root.showToast?.('تعذّر إكمال تحميل القاموس. تحقق من الاتصال وحاول مجددًا.', 'warning', 5000);
        return false;
      } finally {
        root.removeEventListener?.('lootlingua:dictionary-navigation', onNavigation);
      }
    },
  };
  root.LootLinguaDictionaryPages = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
