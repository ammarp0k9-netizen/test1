(function attachLootLinguaLearningEvidence(root) {
  'use strict';

  const EVIDENCE_VERSION = 2;
  const LEGACY_EVIDENCE_VERSION = 1;
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const GATE_READINESS_EVIDENCE_CONFIG = Object.freeze({
    requiredEvidenceCount: 3,
    secondEvidenceMinDelayMs: 2 * HOUR_MS,
    finalEvidenceRequiresNextLocalDay: true,
    finalEvidenceMinDelayMs: 30 * MINUTE_MS,
    maxEvidencePerWordPerSession: 1,
  });
  const DEFAULT_EVIDENCE_CONFIG = GATE_READINESS_EVIDENCE_CONFIG;
  const ELIGIBLE_SOURCES = Object.freeze(['personal', 'private-world', 'journey', 'gate-clear']);
  const INELIGIBLE_MODES = Object.freeze(['flashcards', 'level-placement', 'placement', 'preview']);

  function effectiveNow() {
    const clock = root.LootLinguaTestClock;
    return typeof clock?.effectiveNow === 'function' ? clock.effectiveNow() : Date.now();
  }

  function resolveEvidenceConfig(config) {
    const legacyIntervals = Array.isArray(config?.minimumIntervalsMs)
      ? config.minimumIntervalsMs
      : null;
    return {
      requiredEvidenceCount: Math.max(
        1,
        Number(config?.requiredEvidenceCount ?? config?.requiredCount) ||
          GATE_READINESS_EVIDENCE_CONFIG.requiredEvidenceCount
      ),
      secondEvidenceMinDelayMs: Math.max(
        0,
        Number(config?.secondEvidenceMinDelayMs ?? legacyIntervals?.[1]) ||
          GATE_READINESS_EVIDENCE_CONFIG.secondEvidenceMinDelayMs
      ),
      finalEvidenceRequiresNextLocalDay:
        config?.finalEvidenceRequiresNextLocalDay !== false,
      finalEvidenceMinDelayMs: Math.max(
        0,
        Number(config?.finalEvidenceMinDelayMs ?? legacyIntervals?.[2]) ||
          GATE_READINESS_EVIDENCE_CONFIG.finalEvidenceMinDelayMs
      ),
      maxEvidencePerWordPerSession: 1,
    };
  }

  function evidenceEventId(uid, sessionId, wordKey) {
    const owner = String(uid || '').trim();
    const session = String(sessionId || '').trim();
    const word = String(wordKey || '').trim();
    if (!owner || !session || !word) return '';
    if (owner.includes('/') || session.includes('/') || word.includes('/')) return '';
    if (owner.length > 128 || session.length > 220 || word.length > 220) return '';
    return `e${EVIDENCE_VERSION}~${owner}~${session}~${word}`;
  }

  function evidenceState(word) {
    return {
      count: Math.max(0, Number(word?.eligibleEvidenceCount) || 0),
      lastAt: Math.max(0, Number(word?.lastEligibleEvidenceAt?.toMillis?.() ?? word?.lastEligibleEvidenceAt) || 0),
      version: Math.max(0, Number(word?.evidenceVersion) || 0),
    };
  }

  function normalizeTimezoneOffsetMinutes(value) {
    const offset = Number(value);
    if (!Number.isInteger(offset)) return 0;
    return Math.max(-840, Math.min(840, offset));
  }

  function localDayKey(timestampMs, timezoneOffsetMinutes) {
    const time = Math.max(0, Number(timestampMs) || 0);
    const offset = normalizeTimezoneOffsetMinutes(timezoneOffsetMinutes);
    return Math.floor((time - offset * MINUTE_MS) / DAY_MS);
  }

  function nextLocalDayStart(timestampMs, timezoneOffsetMinutes) {
    const offset = normalizeTimezoneOffsetMinutes(timezoneOffsetMinutes);
    const day = localDayKey(timestampMs, offset);
    return ((day + 1) * DAY_MS) + (offset * MINUTE_MS);
  }

  function lastEvidenceTime(word) {
    return Math.max(
      0,
      Number(word?.lastEligibleEvidenceAt?.toMillis?.() ?? word?.lastEligibleEvidenceAt) || 0
    );
  }

  function getWordGateReadiness(word, config, now, timezoneOffsetMinutes) {
    const settings = resolveEvidenceConfig(config);
    const state = evidenceState(word);
    const currentTime = Math.max(0, Number(now) || effectiveNow());
    const offset = normalizeTimezoneOffsetMinutes(
      word?.evidenceTimezoneOffsetMinutes ?? timezoneOffsetMinutes
    );
    const lastAt = lastEvidenceTime(word);
    const previousDay = Number.isInteger(Number(word?.lastEvidenceLocalDayKey))
      ? Number(word.lastEvidenceLocalDayKey)
      : localDayKey(lastAt, offset);
    const currentDay = localDayKey(currentTime, offset);
    if (state.count >= settings.requiredEvidenceCount) {
      return { status: 'ready', ready: true, nextEligibleAt: null, localDayKey: currentDay };
    }
    if (state.count <= 0) {
      return { status: 'needs-first-review', ready: false, nextEligibleAt: 0, localDayKey: currentDay };
    }
    if (state.count === 1) {
      const nextAt = lastAt + settings.secondEvidenceMinDelayMs;
      return {
        status: currentTime >= nextAt ? 'second-review-available' : 'waiting-second-review',
        ready: false,
        nextEligibleAt: nextAt,
        localDayKey: currentDay,
      };
    }
    const delayAt = lastAt + settings.finalEvidenceMinDelayMs;
    const nextDayAt = settings.finalEvidenceRequiresNextLocalDay
      ? nextLocalDayStart(lastAt, offset)
      : delayAt;
    const nextAt = Math.max(delayAt, nextDayAt);
    const nextDayReached = !settings.finalEvidenceRequiresNextLocalDay || currentDay > previousDay;
    return {
      status: nextDayReached && currentTime >= nextAt
        ? 'next-day-review-available'
        : 'waiting-next-day',
      ready: false,
      nextEligibleAt: nextAt,
      localDayKey: currentDay,
      previousLocalDayKey: previousDay,
    };
  }

  function nextEligibleEvidenceAt(word, config) {
    const readiness = getWordGateReadiness(
      word,
      config,
      effectiveNow(),
      word?.evidenceTimezoneOffsetMinutes
    );
    return readiness.ready ? Infinity : readiness.nextEligibleAt;
  }

  function isEligibleRecall(input, config) {
    const source = String(input?.sourceType || '');
    const mode = String(input?.mode || '');
    const answeredAt = Math.max(0, Number(input?.answeredAt) || 0);
    if (!input?.completed || input?.correct !== true) return false;
    if (!ELIGIBLE_SOURCES.includes(source) || INELIGIBLE_MODES.includes(mode)) return false;
    if (!evidenceEventId(input?.uid, input?.sessionId, input?.wordKey)) return false;
    const readiness = getWordGateReadiness(
      input?.word,
      config,
      answeredAt,
      input?.timezoneOffsetMinutes
    );
    return readiness.status === 'needs-first-review' ||
      readiness.status === 'second-review-available' ||
      readiness.status === 'next-day-review-available';
  }

  function getWordReadiness(word, evidenceConfig) {
    const config = resolveEvidenceConfig(evidenceConfig);
    const state = evidenceState(word);
    const count = Math.min(state.count, config.requiredEvidenceCount);
    const status = count >= config.requiredEvidenceCount
      ? 'ready'
      : (count > 0 ? 'progressing' : 'needs-evidence');
    return {
      status,
      ready: status === 'ready',
      eligibleEvidenceCount: count,
      requiredEvidenceCount: config.requiredEvidenceCount,
      nextEligibleAt: status === 'ready' ? null : nextEligibleEvidenceAt(word, config),
    };
  }

  function computeGateReadiness(gateWords, progress, evidenceConfig, now, timezoneOffsetMinutes) {
    const words = Array.isArray(gateWords) ? gateWords.filter(Boolean) : [];
    const currentTime = Math.max(0, Number(now) || effectiveNow());
    const readiness = words.map((word) =>
      getWordGateReadiness(word, evidenceConfig, currentTime, timezoneOffsetMinutes)
    );
    const readyWordCount = readiness.filter((item) => item.ready).length;
    const requiredWordCount = words.length;
    const ready = requiredWordCount > 0 && readyWordCount === requiredWordCount;
    const availableForReviewNow = readiness.filter((item) => [
      'needs-first-review', 'second-review-available', 'next-day-review-available'
    ].includes(item.status)).length;
    const waitingLaterToday = readiness.filter((item) => item.status === 'waiting-second-review').length;
    const waitingNextDay = readiness.filter((item) => item.status === 'waiting-next-day').length;
    const nextTimes = readiness.map((item) => Number(item.nextEligibleAt))
      .filter((value) => Number.isFinite(value) && value > currentTime);
    return {
      status: ready ? 'ready' : (progress?.status === 'available' ? 'available' : 'learning'),
      gateStatus: ready ? 'ready' : (progress?.status === 'available' ? 'available' : 'learning'),
      ready,
      readyWordCount,
      readyWords: readyWordCount,
      requiredWordCount,
      totalEligibleWords: requiredWordCount,
      needsEvidenceWordCount: Math.max(0, requiredWordCount - readyWordCount),
      availableForReviewNow,
      waitingLaterToday,
      waitingNextDay,
      progressRatio: requiredWordCount ? readyWordCount / requiredWordCount : 0,
      nextAvailabilityAt: nextTimes.length ? Math.min(...nextTimes) : null,
      readinessVersion: EVIDENCE_VERSION,
    };
  }

  const API = Object.freeze({
    EVIDENCE_VERSION,
    LEGACY_EVIDENCE_VERSION,
    MINUTE_MS,
    HOUR_MS,
    DAY_MS,
    GATE_READINESS_EVIDENCE_CONFIG,
    DEFAULT_EVIDENCE_CONFIG,
    ELIGIBLE_SOURCES,
    INELIGIBLE_MODES,
    effectiveNow,
    resolveEvidenceConfig,
    evidenceEventId,
    evidenceState,
    normalizeTimezoneOffsetMinutes,
    localDayKey,
    nextLocalDayStart,
    getWordGateReadiness,
    nextEligibleEvidenceAt,
    isEligibleRecall,
    getWordReadiness,
    computeGateReadiness,
  });

  Object.defineProperty(root, 'LootLinguaLearningEvidence', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
