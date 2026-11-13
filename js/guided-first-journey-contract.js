(function attachGuidedFirstJourneyContract(root) {
  'use strict';

  const VERSION = 1;
  const PHASES = Object.freeze(['choosing-world', 'awaiting-first-gate', 'first-gate-opened', 'awaiting-quiz-cta', 'completed']);
  const PLACEMENT_STAGES = Object.freeze(['assessment', 'result', 'offer', 'continue']);
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

  function checkpointKey(identity) {
    return `lootlingua:public-world-guide:v${VERSION}:${owner(identity)}`;
  }

  function normalize(raw) {
    if (!raw || Object.prototype.toString.call(raw) !== '[object Object]') return null;
    if (Number(raw.version) !== VERSION || !PHASES.includes(raw.phase)) return null;
    const worldId = clean(raw.worldId, 128);
    if (!worldId && raw.phase !== 'choosing-world') return null;
    return Object.freeze({
      version: VERSION,
      audience: AUDIENCES.includes(clean(raw.audience, 40)) ? clean(raw.audience, 40) : 'new',
      phase: clean(raw.phase, 80),
      worldId,
      suggestedWorldId: clean(raw.suggestedWorldId, 128),
      gateId: clean(raw.gateId, 128),
      rankId: clean(raw.rankId, 128),
      placementStage: PLACEMENT_STAGES.includes(raw.placementStage) ? raw.placementStage : '',
      placementLevel: clean(raw.placementLevel, 8),
      assessmentId: clean(raw.assessmentId, 128),
      resultStep: Math.min(2, Math.floor(time(raw.resultStep))),
      guestDictionaryAvailable: raw.guestDictionaryAvailable === true,
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
      guestDictionaryAvailable: false,
      startedAt: now,
      updatedAt: now,
      completedAt: 0,
    });
  }

  function chooseWorld(suggestedWorldId, nowValue) {
    const now = time(nowValue) || Date.now();
    return normalize({ version: VERSION, phase: 'choosing-world', suggestedWorldId, startedAt: now, updatedAt: now });
  }

  function transition(state, event, nowValue) {
    const current = normalize(state);
    if (!current) throw new RangeError('Guided First Journey state is invalid.');
    const now = Math.max(time(nowValue) || Date.now(), current.updatedAt + 1);
    const type = clean(event?.type, 80);
    if (current.phase === 'completed') return current;
    if (type === 'select-world' || type === 'start-world') {
      const worldId = clean(event.worldId, 128);
      if (!worldId || (type === 'select-world' && current.phase !== 'choosing-world') ||
          (type === 'start-world' && current.worldId === worldId)) return current;
      return normalize({ ...create(worldId, now), suggestedWorldId: current.suggestedWorldId,
        startedAt: current.startedAt, guestDictionaryAvailable: current.guestDictionaryAvailable });
    }
    if (type === 'placement') {
      if (clean(event.worldId, 128) !== current.worldId) return current;
      const { placementStage, placementLevel, assessmentId, resultStep = 0 } = event;
      return normalize({ ...current, placementStage, placementLevel, assessmentId, resultStep, updatedAt: now });
    }
    if (type === 'placement-gate') {
      if (clean(event.worldId, 128) !== current.worldId || !event.gateId) return current;
      const sameGate = current.gateId === clean(event.gateId, 128);
      return normalize({ ...current, phase: sameGate ? current.phase : 'awaiting-first-gate',
        gateId: event.gateId, rankId: event.rankId, placementStage: 'continue', updatedAt: now });
    }
    if (type === 'gate-opened') {
      if (current.phase !== 'awaiting-first-gate') return current;
      if (clean(event.worldId, 128) !== current.worldId) return current;
      const gateId = clean(event.gateId, 128);
      if (!gateId || (current.gateId && current.gateId !== gateId)) return current;
      return normalize({ ...current, phase: 'first-gate-opened', gateId, rankId: event.rankId || current.rankId, updatedAt: now });
    }
    if (type === 'gate-words-loaded') {
      if (current.phase !== 'first-gate-opened') return current;
      if (clean(event.worldId, 128) !== current.worldId || clean(event.gateId, 128) !== current.gateId) return current;
      return normalize({ ...current, phase: 'awaiting-quiz-cta', updatedAt: now });
    }
    if (type === 'complete') {
      if (current.phase !== 'awaiting-quiz-cta') return current;
      if (clean(event.worldId, 128) !== current.worldId) return current;
      if (current.gateId && clean(event.gateId, 128) !== current.gateId) return current;
      return normalize({ ...current, phase: 'completed', updatedAt: now, completedAt: now });
    }
    if (type === 'world-completed' && clean(event.worldId, 128) === current.worldId) {
      return normalize({ ...current, phase: 'completed', updatedAt: now, completedAt: now });
    }
    if (type === 'enable-guest-dictionary') {
      if (current.phase === 'completed') return current;
      return normalize({ ...current, guestDictionaryAvailable: true, updatedAt: now });
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

  const API = Object.freeze({ VERSION, PHASES, PLACEMENT_STAGES, storageKey, checkpointKey, normalize, create, chooseWorld, transition, isActive, shouldStartForPresentation });
  Object.defineProperty(root, 'LootLinguaGuidedFirstJourneyContract', { value: API, configurable: false, writable: false });
})(typeof window !== 'undefined' ? window : globalThis);
