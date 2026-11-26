(function initLootLinguaOperations(root) {
  'use strict';

  const VALID_STATES = new Set([
    'loading',
    'long-wait',
    'partial-success',
    'retryable-error',
    'completed',
  ]);
  const inFlight = new Map();
  const report = [];
  const MAX_REPORT_ITEMS = 120;
  const syncSources = new Map();
  const syncFailures = new Map();
  const syncSourceState = new Map();
  const getOwner = () => root.auth?.currentUser?.uid || '';
  const syncEvent = () => root.dispatchEvent?.(new CustomEvent('lootlingua:sync-state'));

  function syncStatus(owner = getOwner()) {
    const status = { pending: 0, rejected: 0, active: false, localFailure: false, reason: '', rejections: [] };
    if (!owner) return status;
    for (const [scope, read] of syncSources) {
      let pending;
      try { pending = read(owner) || {}; }
      catch (_) { status.localFailure = true; continue; }
      const source = syncSourceState.get(`${owner}:${scope}`) || {};
      status.pending += Number(pending.pending || 0);
      status.rejected += Number(pending.rejected || 0);
      status.rejections.push(...(pending.rejections || []));
      if (source.failure) { status.rejected++; status.rejections.push({ scope, reason: source.failure }); }
      status.active ||= Boolean(source.active);
      status.reason ||= source.reason || '';
    }
    status.localFailure ||= [...syncFailures.keys()].some(key => key.startsWith(owner + ':'));
    return status;
  }

  function setSyncSource(scope, read) { syncSources.set(scope, read); syncEvent(); }
  function syncActivity(owner, scope, state) { syncSourceState.set(`${owner}:${scope}`, state); syncEvent(); }
  function syncStorageFailure(owner, scope, failed) {
    const key = `${owner}:${scope}`;
    if (syncFailures.has(key) === Boolean(failed)) { syncEvent(); return; }
    if (failed) syncFailures.set(key, true);
    else syncFailures.delete(key);
    syncEvent();
  }

  function createOutbox(scope, replay, config = {}) {
    const prefix = 'lootlingua:sync-outbox:v1:' + scope + ':';
    let running = null;
    let timer = null;
    const uidPrefix = owner => prefix + encodeURIComponent(owner) + ':';
    const opKey = (owner, id) => uidPrefix(owner) + encodeURIComponent(id);
    const list = owner => {
      const storage = root.localStorage;
      const items = [];
      try {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (!key?.startsWith(uidPrefix(owner))) continue;
          const item = JSON.parse(storage.getItem(key));
          if (item?.owner === owner && item.id && item.lane) items.push(item);
        }
      } catch (error) {
        syncFailures.set(`${owner}:${scope}`, true);
        console.error('[Sync] Could not read local operations.', scope, error?.name);
      }
      return items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    };
    function write(item) {
      try {
        root.localStorage.setItem(opKey(item.owner, item.id), JSON.stringify(item));
        syncStorageFailure(item.owner, scope, false);
      } catch (error) {
        syncStorageFailure(item.owner, scope, true);
        throw Object.assign(new Error('Could not save this change on the device.'), { code: 'sync/local-storage', cause: error });
      }
    }
    function enqueue(type, payload, { id, lane } = {}) {
      const owner = getOwner();
      if (!owner || !lane || !id) throw Object.assign(new Error('The account or operation is missing.'), { code: 'sync/identity' });
      const prior = list(owner).find(item => item.id === id);
      if (prior) { schedule(); return prior; }
      const at = Math.max(Date.now(), 1 + Math.max(0, ...list(owner).filter(item => item.lane === lane).map(item => item.at)));
      const item = { owner, id, lane, type, payload, at };
      write(item);
      config.onChange?.(owner);
      schedule();
      return item;
    }
    function schedule(delay = 400) {
      clearTimeout(timer);
      timer = null;
      const owner = getOwner();
      if (!owner || root.navigator?.onLine === false || !list(owner).some(item => !item.rejected)) return;
      timer = setTimeout(() => { timer = null; void flush(); }, Math.max(delay, root.LootLinguaCloudBackoff?.remaining() || 0));
    }
    async function flush() {
      const owner = getOwner();
      if (!owner || running || root.navigator?.onLine === false) return running;
      const generation = Number(root.__lootlinguaAuthGeneration) || 0;
      const current = () => getOwner() === owner && (Number(root.__lootlinguaAuthGeneration) || 0) === generation;
      const backoff = root.LootLinguaCloudBackoff;
      const work = async lock => {
        if (!lock || !current()) return;
        const items = list(owner);
        const blocked = new Set();
        if (!items.some(item => !item.rejected)) return;
        syncActivity(owner, scope, { active: true });
        let reason;
        try {
          for (const item of items) {
            if (!current()) break;
            if (item.rejected) { blocked.add(item.lane); continue; }
            if (blocked.has(item.lane)) continue;
            try {
              backoff?.assertAvailable();
              const result = await replay(item, current);
              if (!current()) break;
              if (result?.retryLatest === true) { reason = 'pending'; continue; }
              config.onConfirmed?.(item, result);
              root.localStorage.removeItem(opKey(owner, item.id));
              backoff?.recovered();
              config.onChange?.(owner);
            } catch (error) {
              if (!current()) break;
              const failure = backoff?.classify(error) || {};
              if (failure.temporary) {
                reason = failure.reason;
                backoff?.pause(error);
                break;
              }
              blocked.add(item.lane);
              write({ ...item, rejected: true, reason: failure.reason || 'unexpected', code: String(error?.code || '') });
              config.onChange?.(owner);
            }
          }
        } finally {
          syncActivity(owner, scope, { reason: reason === 'pending' ? '' : reason });
          if (reason) schedule(reason === 'pending' ? 400 : 10000);
        }
      };
      const locks = root.navigator?.locks;
      running = Promise.resolve().then(() => locks
        ? locks.request(prefix + owner, { ifAvailable: true }, lock => { if (!lock) schedule(5000); return work(lock); })
        : work(true)).catch(error => {
        syncStorageFailure(owner, scope, true);
        console.error('[Sync] Could not update durable operations.', scope, error?.name);
      }).finally(() => {
        running = null;
        const items = getOwner() === owner ? list(owner) : [];
        const rejected = new Set(items.filter(item => item.rejected).map(item => item.lane));
        if (!timer && items.some(item => !item.rejected && !rejected.has(item.lane))) schedule();
      });
      return running;
    }
    setSyncSource(scope, owner => {
      const items = list(owner);
      const rejected = items.filter(item => item.rejected);
      return { pending: items.length - rejected.length, rejected: rejected.length,
        rejections: rejected.map(item => ({ scope, type: item.type, reason: item.reason,
          name: String(item.payload?.word?.word || item.payload?.base?.name || '').trim().slice(0, 70) })) };
    });
    for (const event of ['online', 'lootlingua:auth-state', 'lootlingua:cloud-capacity-change']) {
      root.addEventListener?.(event, () => schedule());
    }
    root.addEventListener?.('storage', event => {
      const owner = getOwner();
      if (owner && event.key?.startsWith(uidPrefix(owner))) { config.onChange?.(owner); syncEvent(); schedule(); }
    });
    return { enqueue, flush, list, schedule };
  }

  root.__lootlinguaPerformanceReport = report;

  function now() {
    return root.performance?.now ? root.performance.now() : Date.now();
  }

  function rounded(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function debugEnabled() {
    return root.__lootlinguaPerformanceDebug === true;
  }

  function diagnostic(name, details = {}) {
    if (!debugEnabled()) return null;
    const key = String(name || 'event');
    const store = root.__lootlinguaPerformanceDiagnostics ||= {
      counters: {},
      events: [],
    };
    store.counters[key] = (Number(store.counters[key]) || 0) + 1;
    store.events.push({ name: key, at: Date.now(), ...details });
    if (store.events.length > 200) store.events.splice(0, store.events.length - 200);
    return store.counters[key];
  }

  function startTrace(operation, metadata = {}) {
    const name = String(operation || 'operation');
    const startedAt = now();
    const stages = [];
    const counters = {
      firestoreReads: 0,
      firestoreWrites: 0,
      rerenderCount: 0,
    };
    const warnings = [];
    let ended = false;

    root.performance?.mark?.(`lootlingua:${name}:start`);

    const trace = {
      stage(stageName, details = {}) {
        if (ended) return trace;
        const item = {
          name: String(stageName || 'stage'),
          atMs: rounded(now() - startedAt),
          ...details,
        };
        stages.push(item);
        if (debugEnabled()) console.debug(`[LootLingua trace] ${name}`, item);
        return trace;
      },
      count(counter, amount = 1) {
        const key = String(counter || '').trim();
        if (key) counters[key] = (Number(counters[key]) || 0) + (Number(amount) || 0);
        return trace;
      },
      warn(message) {
        const text = String(message || '').trim();
        if (text) warnings.push(text);
        return trace;
      },
      end(details = {}) {
        if (ended) return report.at(-1) || null;
        ended = true;
        const totalMs = rounded(now() - startedAt);
        const item = {
          operation: name,
          totalMs,
          stages,
          ...counters,
          warnings,
          metadata: { ...metadata, ...details },
          recordedAt: Date.now(),
        };
        report.push(item);
        if (report.length > MAX_REPORT_ITEMS) report.splice(0, report.length - MAX_REPORT_ITEMS);
        root.performance?.mark?.(`lootlingua:${name}:end`);
        try {
          root.performance?.measure?.(
            `lootlingua:${name}`,
            `lootlingua:${name}:start`,
            `lootlingua:${name}:end`
          );
        } catch {}
        if (debugEnabled()) console.debug('[LootLingua performance]', item);
        return item;
      },
    };

    trace.stage('start');
    return trace;
  }

  function runExclusive(scope, task) {
    const key = String(scope || 'operation');
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = Promise.resolve()
      .then(task)
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
    inFlight.set(key, promise);
    return promise;
  }

  function isInFlight(scope) {
    return inFlight.has(String(scope || 'operation'));
  }

  function statusElement(host, scope) {
    if (!host?.querySelector || !root.document) return null;
    const key = String(scope || 'operation').replace(/[^a-zA-Z0-9_-]/g, '_');
    let element = host.querySelector(`:scope > .operation-status[data-operation-scope="${key}"]`);
    if (!element) {
      element = root.document.createElement('div');
      element.className = 'operation-status';
      element.dataset.operationScope = key;
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      host.append(element);
    }
    return element;
  }

  function setButtonsBusy(buttons, busy, label) {
    const values = Array.from(buttons || []).filter(Boolean);
    values.forEach((button) => {
      if (!button.dataset.operationDefaultHtml) {
        button.dataset.operationDefaultHtml = button.innerHTML;
      }
      button.disabled = Boolean(busy);
      button.setAttribute('aria-busy', String(Boolean(busy)));
      if (busy && label) {
        button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> ${label}`;
      } else if (!busy && button.dataset.operationDefaultHtml) {
        button.innerHTML = button.dataset.operationDefaultHtml;
        delete button.dataset.operationDefaultHtml;
      }
    });
  }

  function beginStatus(options = {}) {
    const scope = String(options.scope || 'operation');
    const host = options.host || null;
    const buttons = Array.from(options.buttons || []).filter(Boolean);
    const loadingMessage = String(options.loadingMessage || 'Working...');
    const longWaitMessage = String(options.longWaitMessage || loadingMessage);
    const longWaitMs = Math.max(400, Number(options.longWaitMs) || 5000);
    const element = statusElement(host, scope);
    let state = 'loading';
    let longWaitTimer = null;
    let cleared = false;

    function render(nextState, message, retry) {
      state = VALID_STATES.has(nextState) ? nextState : 'loading';
      host?.setAttribute?.('aria-busy', String(state === 'loading' || state === 'long-wait'));
      if (!element) return;
      element.className = `operation-status operation-status-${state}`;
      element.replaceChildren();
      const icon = root.document.createElement('i');
      icon.className = state === 'completed'
        ? 'fa-solid fa-circle-check'
        : state === 'retryable-error'
          ? 'fa-solid fa-triangle-exclamation'
          : state === 'partial-success'
            ? 'fa-solid fa-circle-exclamation'
            : 'fa-solid fa-circle-notch fa-spin';
      icon.setAttribute('aria-hidden', 'true');
      const text = root.document.createElement('span');
      text.textContent = String(message || loadingMessage);
      element.append(icon, text);
      if (typeof retry === 'function') {
        const retryButton = root.document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'operation-status-retry';
        retryButton.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i>';
        retryButton.setAttribute('aria-label', 'Retry');
        retryButton.addEventListener('click', retry, { once: true });
        element.append(retryButton);
      }
    }

    setButtonsBusy(buttons, true, options.buttonBusyLabel);
    render('loading', loadingMessage);
    longWaitTimer = setTimeout(() => {
      if (!cleared && state === 'loading') render('long-wait', longWaitMessage);
    }, longWaitMs);

    return {
      get state() { return state; },
      set(nextState, message, retry) {
        if (!cleared) render(nextState, message, retry);
      },
      complete(message) {
        clearTimeout(longWaitTimer);
        setButtonsBusy(buttons, false);
        render('completed', message || loadingMessage);
      },
      fail(message, retry) {
        clearTimeout(longWaitTimer);
        setButtonsBusy(buttons, false);
        render('retryable-error', message, retry);
      },
      clear() {
        if (cleared) return;
        cleared = true;
        clearTimeout(longWaitTimer);
        setButtonsBusy(buttons, false);
        host?.removeAttribute?.('aria-busy');
        element?.remove();
      },
    };
  }

  function nextPaint() {
    return new Promise((resolve) => {
      if (typeof root.requestAnimationFrame === 'function') {
        root.requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  root.LootLinguaOperations = Object.freeze({
    VALID_STATES,
    startTrace,
    runExclusive,
    isInFlight,
    beginStatus,
    setButtonsBusy,
    nextPaint,
    diagnostic,
    setSyncSource,
    syncStatus,
    syncActivity,
    syncNotify: syncEvent,
    syncStorageFailure,
    createOutbox,
  });
})(typeof window !== 'undefined' ? window : globalThis);
