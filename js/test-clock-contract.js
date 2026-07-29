(function attachLootLinguaTestClockContract(root) {
  'use strict';

  const CLOCK_VERSION = 1;
  const MAX_OFFSET_MS = 365 * 24 * 60 * 60 * 1000;

  function clampOffset(value) {
    const numeric = Number(value);
    const offset = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
    return Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, offset));
  }

  function computeEffectiveNow(realNowMs, offsetMs, authorized) {
    const real = Math.max(0, Number(realNowMs) || 0);
    return authorized ? Math.max(0, real + clampOffset(offsetMs)) : real;
  }

  Object.defineProperty(root, 'LootLinguaTestClockContract', {
    value: Object.freeze({
      CLOCK_VERSION,
      MAX_OFFSET_MS,
      clampOffset,
      computeEffectiveNow,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
