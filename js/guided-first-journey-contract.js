(function attachGuidedFirstJourneyContract(root) {
  'use strict';

  const VERSION = 1;
  const PHASES = Object.freeze(['awaiting-first-gate', 'awaiting-quiz-cta', 'completed']);
  const AUDIENCES = Object.freeze(['new']);

  function clean(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength || 160);
  }

  function time(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }

  function owner(identity) {
    const uid = clean(identity?.uid, 128);
    return uid ? `user:${uid}` : 'guest';
  }

  function storageKey(identity) {
    return `lootlingua:guided-first-journey:v${VERSION}:${owner(identity)}`;
  }

  function normalize(raw) {
    if (!raw || Object.prototype.toString.call(raw) !== '[object Object]') return null;
    if (Number(raw.version) !== VERSION || !PHASES.includes(raw.phase)) return null;
    const worldId = clean(raw.worldId, 128);
    if (!worldId) return null;
    return Object.freeze({
      version: VERSION,
      audience: AUDIENCES.includes(clean(raw.audience, 40)) ? clean(raw.audience, 40) : 'new',
      phase: clean(raw.phase, 80),
      worldId,
      gateId: clean(raw.gateId, 128),
      startedAt: time(raw.startedAt),
      updatedAt: time(raw.updatedAt),
      completedAt: raw.phase === 'completed' ? time(raw.completedAt) : 0,
    });
  }

  function create(worldId, nowValue) {
    const now = time(nowValue) || Date.now();
    return normalize({
      version: VERSION,
      audience: 'new',
      phase: 'awaiting-first-gate',
      worldId,
      gateId: '',
      startedAt: now,
      updatedAt: now,
      completedAt: 0,
    });
  }

  function transition(state, event, nowValue) {
    const current = normalize(state);
    if (!current) throw new RangeError('Guided First Journey state is invalid.');
    const now = time(nowValue) || Date.now();
    const type = clean(event?.type, 80);
    if (type === 'gate-words-loaded') {
      if (current.phase !== 'awaiting-first-gate') return current;
      if (clean(event.worldId, 128) !== current.worldId) return current;
      return normalize({ ...current, phase: 'awaiting-quiz-cta', gateId: clean(event.gateId, 128), updatedAt: now });
    }
    if (type === 'complete') {
      if (current.phase !== 'awaiting-quiz-cta') return current;
      if (clean(event.worldId, 128) !== current.worldId) return current;
      if (current.gateId && clean(event.gateId, 128) !== current.gateId) return current;
      return normalize({ ...current, phase: 'completed', updatedAt: now, completedAt: now });
    }
    return current;
  }

  function isActive(state) {
    const normalized = normalize(state);
    return Boolean(normalized && normalized.phase !== 'completed');
  }

  function shouldStartForPresentation(presentation) {
    return clean(presentation?.classification, 100) === 'brand-new' &&
      clean(presentation?.audience, 80) === 'new';
  }

  const API = Object.freeze({ VERSION, PHASES, storageKey, normalize, create, transition, isActive, shouldStartForPresentation });
  Object.defineProperty(root, 'LootLinguaGuidedFirstJourneyContract', { value: API, configurable: false, writable: false });
})(typeof window !== 'undefined' ? window : globalThis);
