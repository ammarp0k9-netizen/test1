(function(root) {
  'use strict';
  const KEY = 'lootlingua:firestore-capacity:v1:quizapp-ede17';
  const BASE = 60000, MAX = 900000;
  let state = { until: 0, attempts: 0, reason: '' };
  function classify(error) {
    let current = error;
    for (let depth = 0; current && depth < 6; depth++, current = current.cause) {
      const code = String(current.code || '').split('/').at(-1);
      if (current.capacityBackoff && current.syncReason) return { temporary: true, reason: current.syncReason, code };
      if (code === 'resource-exhausted') return { temporary: true,
        reason: /quota exceeded|exceeded.*quota|daily.*(?:quota|limit)/i.test(current.message || '') ? 'quota' : 'capacity', code };
      if (code === 'offline') return { temporary: true, reason: 'offline', code };
      if (['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(code) && (!current.cause || !String(current.code).includes('/'))) {
        return { temporary: true, reason: root.navigator?.onLine === false ? 'offline' : 'service', code };
      }
      if (['permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'not-found'].includes(code)) {
        return { temporary: false, reason: code, code };
      }
    }
    return { temporary: false, reason: 'unexpected', code: String(error?.code || '') };
  }
  const signal = () => root.dispatchEvent?.(new CustomEvent('lootlingua:cloud-capacity-change', { detail: { ...state } }));
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      state = { until: 0, attempts: 0, reason: '' };
      if (saved && Number(saved.until) > Date.now() - MAX) state = {
        until: Math.min(Number(saved.until) || 0, Date.now() + MAX),
        attempts: Math.max(0, Math.min(8, Number(saved.attempts) || 0)),
        reason: saved.reason || 'capacity',
      };
    } catch (_) {}
  }
  function remaining() { return Math.max(0, state.until - Date.now()); }
  function pause(error) {
    const failure = classify(error);
    if (!failure.temporary || failure.reason === 'offline' || error?.capacityBackoff) return remaining();
    if (remaining()) return remaining();
    state.attempts++;
    state.reason = failure.reason;
    const initial = failure.reason === 'service' ? 5000 : BASE;
    state.until = Date.now() + Math.min(MAX, initial * 2 ** (state.attempts - 1));
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
    signal();
    return remaining();
  }
  function assertAvailable() {
    if (root.navigator?.onLine === false) throw Object.assign(new Error('This device is offline.'), { code: 'offline' });
    const retryAfterMs = remaining();
    if (retryAfterMs) throw Object.assign(new Error('Firestore capacity is temporarily exhausted.'), {
      code: state.reason === 'service' ? 'unavailable' : 'resource-exhausted', retryAfterMs, capacityBackoff: true, syncReason: state.reason,
    });
  }
  function recovered() {
    if (remaining()) return;
    if (!state.attempts) return;
    state = { until: 0, attempts: 0, reason: '' };
    try { localStorage.removeItem(KEY); } catch (_) {}
    signal();
  }
  restore();
  root.addEventListener?.('storage', event => { if (event.key === KEY) { restore(); signal(); } });
  root.LootLinguaCloudBackoff = Object.freeze({ remaining, pause, assertAvailable, recovered, classify,
    reason: () => root.navigator?.onLine === false ? 'offline' : remaining() > 0 ? state.reason : '' });
})(typeof window !== 'undefined' ? window : globalThis);
