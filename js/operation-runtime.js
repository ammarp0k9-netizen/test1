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
        if (Object.prototype.hasOwnProperty.call(counters, counter)) {
          counters[counter] += Number(amount) || 0;
        }
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
  });
})(typeof window !== 'undefined' ? window : globalThis);
