(function attachLootLinguaJourney(root) {
  'use strict';

  const JOURNEY_VERSION = 1;
  const PLACEMENT_STATUS = 'not-started';
  const PLACEMENT_STATUSES = Object.freeze([
    'not-started',
    'active',
    'completed',
    'declined',
  ]);
  const JOURNEY_STATUSES = Object.freeze(['active', 'paused']);
  const CONTENT_JOURNEY_STATUSES = Object.freeze(['in-progress', 'completed-current-content']);
  const GATE_STATUSES = Object.freeze([
    'locked',
    'available',
    'learning',
    'ready',
    'cleared',
  ]);
  const WRITABLE_GATE_STATUSES = Object.freeze(['available', 'learning', 'ready', 'cleared']);

  function journeyError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  function cleanId(value, label) {
    const id = String(value || '').trim();
    if (!id || id.includes('/') || id.length > 500) {
      throw journeyError('journey/invalid-id', `${label || 'Content'} ID is invalid.`);
    }
    return id;
  }

  function itemId(item, idField) {
    return String(item && (item[idField] || item.id) || '');
  }

  function stableContentOrder(items, idField) {
    return (Array.isArray(items) ? items : [])
      .slice()
      .sort((left, right) => {
        const leftOrder = Number(left?.order);
        const rightOrder = Number(right?.order);
        const safeLeft = Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER;
        const safeRight = Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER;
        if (safeLeft !== safeRight) return safeLeft - safeRight;
        return itemId(left, idField).localeCompare(itemId(right, idField), 'en');
      });
  }

  function stableRankOrder(ranks) {
    const compare = root.LootLinguaContentSchema?.comparePublishedRanks;
    return typeof compare === 'function'
      ? (Array.isArray(ranks) ? ranks : []).slice().sort(compare)
      : stableContentOrder(ranks, 'rankId');
  }

  function initialAccessStatus(item) {
    return item?.unlockConfig?.initialStatus === 'available' ? 'available' : 'locked';
  }

  function journeyOwnsWorld(journey, worldId) {
    return Boolean(journey && String(journey.worldId || '') === String(worldId || ''));
  }

  function includesId(values, id) {
    return Array.isArray(values) && values.some((value) => String(value) === String(id));
  }

  function canAccessRank(rank, journey) {
    const rankId = itemId(rank, 'rankId');
    if (!rankId || rank?.status !== 'published') return false;
    if (journeyOwnsWorld(journey, rank.worldId)) {
      return includesId(journey.unlockedRankIds, rankId);
    }
    return initialAccessStatus(rank) === 'available';
  }

  function canAccessGate(gate, journey, options) {
    const settings = options || {};
    const gateId = itemId(gate, 'gateId');
    if (!gateId || gate?.status !== 'published') return false;
    if (journeyOwnsWorld(journey, gate.worldId)) {
      return (!settings.rank || canAccessRank(settings.rank, journey)) &&
        includesId(journey.unlockedGateIds, gateId);
    }
    if (settings.rank && !canAccessRank(settings.rank, null)) return false;
    return Boolean(settings.isFirstEligibleGate);
  }

  function getJourneyGateState(journey, gateProgress, gate, options) {
    if (!canAccessGate(gate, journey, options)) return 'locked';
    const savedStatus = String(gateProgress?.status || '');
    if (GATE_STATUSES.includes(savedStatus)) return savedStatus;
    return 'available';
  }

  function progressFor(progressByRank, rankId, gateId) {
    const rankProgress = progressByRank instanceof Map
      ? progressByRank.get(String(rankId))
      : progressByRank?.[String(rankId)];
    return rankProgress instanceof Map
      ? rankProgress.get(String(gateId))
      : rankProgress?.[String(gateId)] || null;
  }

  function resolveActiveJourneyDestination(input) {
    const journey = input?.journey || null;
    const ranks = stableRankOrder(input?.ranks).filter((rank) => rank?.status === 'published');
    const gatesByRank = input?.gatesByRank instanceof Map
      ? input.gatesByRank
      : new Map(Object.entries(input?.gatesByRank || {}));
    const progressByRank = input?.progressByRank || new Map();
    const orderedTargets = [];
    ranks.forEach((rank) => {
      const rankId = itemId(rank, 'rankId');
      stableContentOrder(gatesByRank.get(rankId), 'gateId')
        .filter((gate) => gate?.status === 'published')
        .forEach((gate) => orderedTargets.push({
          rank,
          gate,
          progress: progressFor(progressByRank, rankId, itemId(gate, 'gateId')),
        }));
    });
    const pointerRankId = String(journey?.activeRankId || input?.currentPointer?.activeRankId || '');
    const pointerGateId = String(journey?.activeGateId || input?.currentPointer?.activeGateId || '');
    const pointerTarget = orderedTargets.find((target) =>
      itemId(target.rank, 'rankId') === pointerRankId &&
      itemId(target.gate, 'gateId') === pointerGateId
    );
    const activeClear = orderedTargets.find((target) =>
      ['active', 'submitting'].includes(String(target.progress?.clearAttemptStatus || '')) ||
      Boolean(target.progress?.activeClearAttemptId)
    );
    if (activeClear) return { type: 'gate-clear', ...activeClear };
    if (
      input?.levelPlacementSession &&
      (
        ['active', 'submitting'].includes(String(input.levelPlacementSession.status || '')) ||
        (
          input?.resumePausedLevelPlacement === true &&
          String(input.levelPlacementSession.status || '') === 'paused'
        )
      )
    ) {
      return { type: 'level-placement', session: input.levelPlacementSession };
    }
    const started = (
      pointerTarget && ['learning', 'ready'].includes(String(pointerTarget.progress?.status || ''))
        ? pointerTarget
        : orderedTargets.find((target) =>
      ['learning', 'ready'].includes(String(target.progress?.status || ''))
        )
    );
    if (started) return { type: 'gate', reason: 'started', ...started };
    const available = (
      pointerTarget && String(pointerTarget.progress?.status || '') === 'available'
        ? pointerTarget
        : orderedTargets.find((target) =>
      String(target.progress?.status || '') === 'available'
        )
    );
    if (available) return { type: 'gate', reason: 'available', ...available };
    const unassessed = new Set((input?.unassessedRankIds || []).map(String));
    const newTarget = orderedTargets.find((target) =>
      unassessed.has(itemId(target.rank, 'rankId'))
    );
    if (newTarget) return { type: 'gate', reason: 'new-rank', ...newTarget };
    const allCleared = orderedTargets.length > 0 && orderedTargets.every((target) =>
      String(target.progress?.status || '') === 'cleared'
    );
    if (journey?.contentJourneyStatus === 'completed-current-content' || allCleared) {
      return { type: 'completed-current-content' };
    }
    return { type: 'unavailable' };
  }

  function resolveLevelPlacementResultDestination(input) {
    const session = input?.session || {};
    const journey = input?.journey || {};
    const passedLevel = session.passedLevel === true;
    if (session.assessmentMode === 'new-ranks' && passedLevel) {
      const testedRankIds = new Set((session.testedRankIds || []).map(String));
      const activeRankId = String(journey.activeRankId || '');
      const activeGateId = String(journey.activeGateId || '');
      if (activeRankId && activeGateId && !testedRankIds.has(activeRankId)) {
        return {
          rankId: activeRankId,
          gateId: activeGateId,
          completedCurrentContent: false,
          preserveExistingPointer: true,
        };
      }
      return {
        rankId: '',
        gateId: '',
        completedCurrentContent: true,
        preserveExistingPointer: false,
      };
    }

    if (passedLevel) {
      const nextTarget = input?.nextLevelTarget || null;
      const rankId = String(nextTarget?.rank?.rankId || '');
      const gateId = String(nextTarget?.gate?.gateId || '');
      return {
        rankId,
        gateId,
        completedCurrentContent: !rankId || !gateId,
        preserveExistingPointer: false,
      };
    }

    return {
      rankId: String(session.recommendedStartRankId || ''),
      gateId: String(session.recommendedStartGateId || ''),
      completedCurrentContent: false,
      preserveExistingPointer: false,
    };
  }

  function selectJourneyStart(ranks, gatesByRank) {
    const orderedRanks = stableRankOrder(ranks);
    const firstRank = orderedRanks.find((rank) => canAccessRank(rank, null));
    if (!firstRank) return null;
    const rankId = itemId(firstRank, 'rankId');
    const gateList = gatesByRank instanceof Map
      ? gatesByRank.get(rankId)
      : gatesByRank?.[rankId];
    const firstGate = stableContentOrder(gateList, 'gateId')
      .find((gate) => gate?.status === 'published') || null;
    if (!firstGate) return null;
    return { rank: firstRank, gate: firstGate };
  }

  function selectNextJourneyTarget(ranks, gatesByRank, currentRankId, currentGateId) {
    const orderedRanks = stableRankOrder(ranks)
      .filter((rank) => rank?.status === 'published');
    const rankIndex = orderedRanks.findIndex(
      (rank) => itemId(rank, 'rankId') === String(currentRankId || '')
    );
    if (rankIndex < 0) return null;

    const currentRank = orderedRanks[rankIndex];
    const currentId = itemId(currentRank, 'rankId');
    const currentGates = stableContentOrder(
      gatesByRank instanceof Map ? gatesByRank.get(currentId) : gatesByRank?.[currentId],
      'gateId'
    ).filter((gate) => gate?.status === 'published');
    const gateIndex = currentGates.findIndex(
      (gate) => itemId(gate, 'gateId') === String(currentGateId || '')
    );
    if (gateIndex < 0) return null;
    if (currentGates[gateIndex + 1]) {
      return {
        rank: currentRank,
        gate: currentGates[gateIndex + 1],
        rankUnlocked: false,
      };
    }

    for (let index = rankIndex + 1; index < orderedRanks.length; index += 1) {
      const rank = orderedRanks[index];
      const rankId = itemId(rank, 'rankId');
      const firstGate = stableContentOrder(
        gatesByRank instanceof Map ? gatesByRank.get(rankId) : gatesByRank?.[rankId],
        'gateId'
      ).find((gate) => gate?.status === 'published');
      if (firstGate) return { rank, gate: firstGate, rankUnlocked: true };
    }
    return null;
  }

  function createJourneySeed(worldId, rankId, gateId) {
    const safeWorldId = cleanId(worldId, 'World');
    const safeRankId = cleanId(rankId, 'Rank');
    const safeGateId = cleanId(gateId, 'Gate');
    return {
      worldId: safeWorldId,
      activeRankId: safeRankId,
      activeGateId: safeGateId,
      status: 'active',
      contentJourneyStatus: 'in-progress',
      journeyVersion: JOURNEY_VERSION,
      placementStatus: PLACEMENT_STATUS,
      activePlacementAssessmentId: '',
      unlockedRankIds: [safeRankId],
      unlockedGateIds: [safeGateId],
    };
  }

  function contentSourceId(source) {
    const parts = [
      cleanId(source?.worldId, 'World'),
      cleanId(source?.rankId, 'Rank'),
      cleanId(source?.gateId, 'Gate'),
      cleanId(source?.contentWordId, 'Word'),
    ];
    return `published_${parts.map(encodeURIComponent).join('~')}`;
  }

  function levelPlacementSourceId(source) {
    const assessment = cleanId(source?.assessmentId, 'Assessment');
    const word = cleanId(source?.contentWordId, 'Word');
    return `level_placement_${encodeURIComponent(assessment)}~${encodeURIComponent(word)}`;
  }

  function gateProgressPathKey(worldId, rankId, gateId) {
    return [
      cleanId(worldId, 'World'),
      cleanId(rankId, 'Rank'),
      cleanId(gateId, 'Gate'),
    ].join('/');
  }

  function detectNewContentWordIds(words, gateProgress) {
    const linked = new Set(
      Array.isArray(gateProgress?.loadedContentWordIds)
        ? gateProgress.loadedContentWordIds.map(String)
        : []
    );
    return (Array.isArray(words) ? words : [])
      .map((word) => String(word?.contentWordId || ''))
      .filter((id) => id && !linked.has(id));
  }

  function canTransitionGateProgress(beforeStatus, afterStatus, options) {
    const before = beforeStatus ? String(beforeStatus) : '';
    const after = String(afterStatus || '');
    if (!WRITABLE_GATE_STATUSES.includes(after)) return false;
    if (!before) return after === 'available' || after === 'learning';
    if (before === 'available') return after === 'available' || after === 'learning';
    if (before === 'learning') {
      return after === 'learning' ||
        after === 'ready' ||
        (after === 'cleared' && options?.source === 'placement');
    }
    if (before === 'ready') {
      return after === 'ready' ||
        (after === 'cleared' && options?.source === 'gate-clear');
    }
    return before === 'cleared' && after === 'cleared';
  }

  function gateStatusLabel(status) {
    return {
      locked: 'مقفلة',
      available: 'متاحة',
      learning: 'قيد التعلم',
      ready: 'جاهزة',
      cleared: 'مجتازة',
    }[status] || 'مقفلة';
  }

  const API = Object.freeze({
    JOURNEY_VERSION,
    PLACEMENT_STATUS,
    PLACEMENT_STATUSES,
    JOURNEY_STATUSES,
    CONTENT_JOURNEY_STATUSES,
    GATE_STATUSES,
    WRITABLE_GATE_STATUSES,
    journeyError,
    cleanId,
    stableContentOrder,
    stableRankOrder,
    initialAccessStatus,
    journeyOwnsWorld,
    canAccessRank,
    canAccessGate,
    getJourneyGateState,
    resolveActiveJourneyDestination,
    resolveLevelPlacementResultDestination,
    selectJourneyStart,
    selectNextJourneyTarget,
    createJourneySeed,
    contentSourceId,
    levelPlacementSourceId,
    gateProgressPathKey,
    detectNewContentWordIds,
    canTransitionGateProgress,
    gateStatusLabel,
  });

  Object.defineProperty(root, 'LootLinguaJourney', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });

  root.dispatchEvent?.(new CustomEvent('lootlingua:journey-ready'));
})(typeof window !== 'undefined' ? window : globalThis);
