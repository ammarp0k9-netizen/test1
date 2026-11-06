(function(root) {
  'use strict';
  const KEY = 'lootlingua:firestore-capacity:v1:quizapp-ede17';
  const BASE = 60000, MAX = 900000;
  let state = { until: 0, attempts: 0 };
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      state = { until: 0, attempts: 0 };
      if (saved && Number(saved.until) > Date.now() - MAX) state = {
        until: Math.min(Number(saved.until) || 0, Date.now() + MAX),
        attempts: Math.max(0, Math.min(8, Number(saved.attempts) || 0)),
      };
    } catch (_) {}
  }
  function remaining() { return Math.max(0, state.until - Date.now()); }
  function pause(error) {
    if (String(error?.code).replace(/^firestore\//, '') !== 'resource-exhausted') return 0;
    if (remaining()) return remaining();
    state.attempts++;
    state.until = Date.now() + Math.min(MAX, BASE * 2 ** (state.attempts - 1));
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
    root.dispatchEvent?.(new CustomEvent('lootlingua:cloud-capacity-change', { detail: { ...state } }));
    return remaining();
  }
  function assertAvailable() {
    const retryAfterMs = remaining();
    if (retryAfterMs) throw Object.assign(new Error('Firestore capacity is temporarily exhausted.'), {
      code: 'resource-exhausted', retryAfterMs, capacityBackoff: true,
    });
  }
  function recovered() {
    if (remaining()) return;
    state = { until: 0, attempts: 0 };
    try { localStorage.removeItem(KEY); } catch (_) {}
  }
  restore();
  root.addEventListener?.('storage', event => { if (event.key === KEY) restore(); });
  root.LootLinguaCloudBackoff = Object.freeze({ remaining, pause, assertAvailable, recovered });
})(typeof window !== 'undefined' ? window : globalThis);
