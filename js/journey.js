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
  const GATE_STATUSES = Object.freeze([
    'locked',
    'available',
    'learning',
    'ready',
    'cleared',
    'mastered',
  ]);
  const WRITABLE_GATE_STATUSES = Object.freeze(['available', 'learning', 'cleared']);

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

  function selectJourneyStart(ranks, gatesByRank) {
    const orderedRanks = stableContentOrder(ranks, 'rankId');
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
    const orderedRanks = stableContentOrder(ranks, 'rankId')
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
        (after === 'cleared' && options?.source === 'placement');
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
      mastered: 'متقنة',
    }[status] || 'مقفلة';
  }

  const API = Object.freeze({
    JOURNEY_VERSION,
    PLACEMENT_STATUS,
    PLACEMENT_STATUSES,
    JOURNEY_STATUSES,
    GATE_STATUSES,
    WRITABLE_GATE_STATUSES,
    journeyError,
    cleanId,
    stableContentOrder,
    initialAccessStatus,
    journeyOwnsWorld,
    canAccessRank,
    canAccessGate,
    getJourneyGateState,
    selectJourneyStart,
    selectNextJourneyTarget,
    createJourneySeed,
    contentSourceId,
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
