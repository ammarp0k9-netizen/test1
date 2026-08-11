(function attachLootLinguaJourney(root) {
  'use strict';

  const JOURNEY_VERSION = 1;
  const WORLD_COMPLETION_VERSION = 1;
  const PLACEMENT_STATUS = 'not-started';
  const PLACEMENT_STATUSES = Object.freeze([
    'not-started',
    'active',
    'completed',
    'declined',
  ]);
  const JOURNEY_STATUSES = Object.freeze(['active', 'paused']);
  const CONTENT_JOURNEY_STATUSES = Object.freeze(['in-progress', 'completed-current-content']);
  const DESTINATION_CLASSIFICATIONS = Object.freeze([
    'actionable-journey',
    'world-completed',
    'no-actionable-journey',
  ]);
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
    if (includesId(
      journey?.levelPlacementClearedGateIds,
      itemId(gate, 'gateId')
    )) return 'cleared';
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

  function targetProgressState(target, journey) {
    if (includesId(
      journey?.levelPlacementClearedGateIds,
      itemId(target?.gate, 'gateId')
    )) return 'cleared';
    const savedStatus = String(target?.progress?.status || '');
    if (GATE_STATUSES.includes(savedStatus)) return savedStatus;
    if (
      target?.rank &&
      target?.gate &&
      canAccessRank(target.rank, journey) &&
      canAccessGate(target.gate, journey, { rank: target.rank })
    ) {
      return 'available';
    }
    return 'locked';
  }

  function levelPlacementAnswersComplete(session) {
    const questions = Array.isArray(session?.orderedQuestionIds)
      ? session.orderedQuestionIds.length
      : 0;
    return questions > 0 &&
      Number(session?.currentQuestionIndex) === questions &&
      (session?.answers || []).length === questions;
  }

  function resolveJourneyDestination(input) {
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
    const levelPlacementSession = input?.levelPlacementSession || null;
    const levelPlacementStatus = String(levelPlacementSession?.status || '');
    const pendingLevelPlacementResult = Boolean(
      levelPlacementSession &&
      levelPlacementSession.resultApplied !== true &&
      (
        levelPlacementStatus === 'awaiting-decision' ||
        (levelPlacementStatus === 'paused' && levelPlacementAnswersComplete(levelPlacementSession))
      )
    );
    const appliedLevelPlacementNeedsClosure = Boolean(
      levelPlacementSession &&
      levelPlacementSession.resultApplied === true &&
      ['awaiting-decision', 'paused'].includes(levelPlacementStatus)
    );
    const levelPlacementActive = Boolean(levelPlacementSession && (
      ['active', 'submitting'].includes(levelPlacementStatus) ||
      (
        input?.resumePausedLevelPlacement === true &&
        levelPlacementStatus === 'paused' &&
        !pendingLevelPlacementResult
      )
    ));
    if (levelPlacementActive) {
      return { type: 'level-placement', reason: 'active-assessment', session: levelPlacementSession };
    }
    if (pendingLevelPlacementResult) {
      return {
        type: 'level-placement-result',
        reason: 'outcome-pending',
        requiresApply: true,
        session: levelPlacementSession,
      };
    }
    if (appliedLevelPlacementNeedsClosure) {
      return {
        type: 'level-placement-result',
        reason: 'outcome-finalization',
        requiresApply: true,
        session: levelPlacementSession,
      };
    }
    if (input?.legacyPlacementActive === true || input?.legacyPlacementSession) {
      return {
        type: 'placement',
        reason: 'legacy-placement',
        session: input?.legacyPlacementSession || null,
      };
    }
    const worldProgress = deriveWorldProgressView({
      worldId: journey?.worldId || input?.worldId,
      journey,
      ranks,
      gatesByRank,
      progressByRank,
    });
    if (worldProgress.currentContentTerminal) {
      return {
        type: 'completed-current-content',
        reason: 'terminal-progress',
        worldId: String(journey?.worldId || input?.worldId || ''),
        worldProgress,
      };
    }
    const unassessed = new Set((input?.unassessedRankIds || []).map(String));
    const newTarget = orderedTargets.find((target) =>
      unassessed.has(itemId(target.rank, 'rankId'))
    );
    if (newTarget) {
      return { type: 'new-rank-assessment', reason: 'new-rank', ...newTarget };
    }
    const activeClear = orderedTargets.find((target) =>
      ['active', 'submitting'].includes(String(target.progress?.clearAttemptStatus || '')) ||
      Boolean(target.progress?.activeClearAttemptId)
    );
    if (activeClear) return { type: 'gate-clear', reason: 'active-clear', ...activeClear };
    const pointerState = pointerTarget ? targetProgressState(pointerTarget, journey) : 'locked';
    if (pointerTarget && ['learning', 'ready', 'available'].includes(pointerState)) {
      return {
        type: 'gate',
        reason: pointerState === 'available' ? 'active-pointer' : 'started',
        derivedProgress: !pointerTarget.progress,
        state: pointerState,
        ...pointerTarget,
      };
    }
    const started = (
      orderedTargets.find((target) =>
        ['learning', 'ready'].includes(targetProgressState(target, journey))
      )
    );
    if (started) return { type: 'gate', reason: 'started', ...started };
    const available = (
      orderedTargets.find((target) =>
        targetProgressState(target, journey) === 'available'
      )
    );
    if (available) return { type: 'gate', reason: 'available', ...available };
    return { type: 'unavailable' };
  }

  const resolveActiveJourneyDestination = resolveJourneyDestination;

  function classifyJourneyDestination(destination) {
    const type = String(destination?.type || 'unavailable');
    if (type === 'completed-current-content') return 'world-completed';
    if (type === 'unavailable') return 'no-actionable-journey';
    return 'actionable-journey';
  }

  function resolveLevelPlacementResultDestination(input) {
    const session = input?.session || {};
    const journey = input?.journey || {};
    const passedLevel = session.passedLevel === true;
    if (session.assessmentMode === 'new-ranks') {
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
      const rankId = String(session.recommendedStartRankId || '');
      const gateId = String(session.recommendedStartGateId || '');
      if (rankId && gateId) {
        return {
          rankId,
          gateId,
          completedCurrentContent: false,
          preserveExistingPointer: false,
        };
      }
      return {
        rankId: String(journey.activeRankId || ''),
        gateId: String(journey.activeGateId || ''),
        completedCurrentContent: false,
        preserveExistingPointer: true,
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

  function planPlacementOutcome(input) {
    const session = input?.session || {};
    const journey = input?.journey || {};
    const passedRankIds = Array.from(new Set((session.passedRankIds || []).map(String).filter(Boolean)));
    const destination = resolveLevelPlacementResultDestination(input);
    const gatesByRank = input?.gatesByRank instanceof Map
      ? input.gatesByRank
      : new Map(Object.entries(input?.gatesByRank || {}));
    const clearedGateTargets = [];
    const availableGateTargets = [];
    const seenClearedPaths = new Set();
    const seenAvailablePaths = new Set();
    const addTarget = (target, collection, seen) => {
      const rankId = String(target?.rankId || '');
      const gateId = String(target?.gateId || '');
      const key = `${rankId}/${gateId}`;
      if (!rankId || !gateId || seen.has(key)) return;
      seen.add(key);
      collection.push({ rankId, gateId });
    };

    passedRankIds.forEach((rankId) => {
      stableContentOrder(gatesByRank.get(rankId), 'gateId')
        .filter((gate) => gate?.status === 'published')
        .forEach((gate) => addTarget({
          rankId,
          gateId: itemId(gate, 'gateId'),
        }, clearedGateTargets, seenClearedPaths));
    });

    if (
      destination.rankId && destination.gateId
    ) {
      const targetPath = `${destination.rankId}/${destination.gateId}`;
      if (!seenClearedPaths.has(targetPath)) {
        addTarget(destination, availableGateTargets, seenAvailablePaths);
      }
    }

    const resultUnlockedRankIds = Array.from(new Set([
      ...passedRankIds,
      ...(destination.rankId ? [destination.rankId] : []),
    ]));
    const resultClearedGateIds = Array.from(new Set(
      clearedGateTargets.map((target) => target.gateId)
    ));
    const resultUnlockedGateIds = Array.from(new Set([
      ...resultClearedGateIds,
      ...availableGateTargets.map((target) => target.gateId),
      ...(destination.gateId ? [destination.gateId] : []),
    ]));

    return {
      destination,
      passedRankIds,
      clearedGateTargets,
      availableGateTargets,
      resultUnlockedRankIds,
      resultUnlockedGateIds,
      resultClearedGateIds,
      completedCurrentContent: Boolean(destination.completedCurrentContent),
      preserveExistingPointer: Boolean(destination.preserveExistingPointer),
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
      completedRankIds: [],
      rankCompletionVersions: {},
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

  function effectiveLoadedGateWords(gateProgress, publishedWords) {
    if (!gateProgress?.loadedAt || !Array.isArray(publishedWords)) return [];
    const loadedContentWordIds = new Set(
      (gateProgress.loadedContentWordIds || []).map(String).filter(Boolean)
    );
    const loadedWordKeys = new Set(
      (gateProgress.loadedWordKeys || []).map(String).filter(Boolean)
    );
    const byWordKey = new Map();
    publishedWords.forEach((word) => {
      if (!word || (word.status && word.status !== 'published')) return;
      const contentWordId = String(word.contentWordId || word.id || '');
      const wordKey = String(word.wordKey || '');
      if (!wordKey || !loadedWordKeys.has(wordKey)) return;
      if (loadedContentWordIds.size && !loadedContentWordIds.has(contentWordId)) return;
      if (!byWordKey.has(wordKey)) byWordKey.set(wordKey, word);
    });
    return [...byWordKey.values()];
  }

  function masteryStateForKey(masteryByWordKey, wordKey) {
    const value = masteryByWordKey instanceof Map
      ? masteryByWordKey.get(wordKey)
      : masteryByWordKey?.[wordKey];
    return typeof value === 'string' ? { mastery_status: value } : (value || null);
  }

  function wordWasMastered(masteryByWordKey, wordKey) {
    const state = masteryStateForKey(masteryByWordKey, wordKey);
    return Boolean(
      state?.mastered_once === true ||
      state?.masteredOnce === true ||
      state?.mastery_status === 'Mastered'
    );
  }

  function deriveGateCrownAchievement(gateProgress, masteryByWordKey) {
    const progress = gateProgress || null;
    // Crown uses the immutable load cohort; current publication only affects gap UI.
    // This keeps the achievement monotonic without storing a client-writable claim.
    const loadedWordKeys = Array.from(new Set(
      (progress?.loadedWordKeys || []).map(String).filter(Boolean)
    ));
    const eligible = Boolean(
      progress?.loadedAt &&
      progress?.placementClearedWithoutLoad !== true &&
      ['learning', 'ready', 'cleared'].includes(String(progress?.status || '')) &&
      loadedWordKeys.length > 0
    );
    const masteryAchieved = Boolean(
      eligible && loadedWordKeys.every((wordKey) =>
        wordWasMastered(masteryByWordKey, wordKey)
      )
    );
    return {
      eligible,
      masteryAchieved,
      crownWordCount: eligible ? loadedWordKeys.length : null,
      crownWordKeys: eligible ? loadedWordKeys : [],
    };
  }

  function deriveGateMasteryView(gateProgress, publishedWords, masteryByWordKey) {
    const progress = gateProgress || null;
    const progressionStatus = String(progress?.status || '');
    const cleared = progressionStatus === 'cleared';
    const clearedWithoutLoad = Boolean(
      cleared && progress?.clearedBy === 'level-placement' &&
      progress?.placementClearedWithoutLoad === true
    );
    const membershipKnown = Array.isArray(publishedWords) && Boolean(progress?.loadedAt);
    const effectiveWords = membershipKnown
      ? effectiveLoadedGateWords(progress, publishedWords)
      : [];
    const effectiveWordKeys = effectiveWords.map((word) => String(word.wordKey));
    const gapWordKeys = effectiveWordKeys.filter((wordKey) =>
      masteryStateForKey(masteryByWordKey, wordKey)?.mastery_status !== 'Mastered'
    );
    const crown = deriveGateCrownAchievement(progress, masteryByWordKey);
    const crownEarned = Boolean(cleared && crown.masteryAchieved);
    let derivedState = progressionStatus || 'locked';
    if (clearedWithoutLoad) derivedState = 'cleared-without-load';
    else if (crownEarned) derivedState = 'mastered';
    else if (cleared && membershipKnown && gapWordKeys.length > 0) {
      derivedState = 'cleared-with-gap';
    }
    return {
      progressionStatus,
      derivedState,
      cleared,
      clearedWithoutLoad,
      crownEarned,
      masteryAchieved: crown.masteryAchieved,
      crownWordCount: crown.crownWordCount,
      membershipKnown,
      effectiveWordCount: membershipKnown ? effectiveWordKeys.length : null,
      effectiveWordKeys,
      masteredWordCount: membershipKnown
        ? effectiveWordKeys.length - gapWordKeys.length
        : null,
      gapCount: membershipKnown ? gapWordKeys.length : null,
      gapWordKeys,
    };
  }

  function gatePresentationState(gateProgress, fallbackState, masteryByWordKey) {
    const state = String(gateProgress?.status || fallbackState || '');
    if (
      state === 'cleared' &&
      deriveGateCrownAchievement(gateProgress, masteryByWordKey).masteryAchieved
    ) return 'mastered';
    return state;
  }

  function rankProgressFor(progressByGate, gateId) {
    return progressByGate instanceof Map
      ? progressByGate.get(String(gateId)) || null
      : progressByGate?.[String(gateId)] || null;
  }

  function rankCompletionVersion(input, rankId) {
    const stored = Number(input?.journey?.rankCompletionVersions?.[rankId]);
    if (Number.isSafeInteger(stored) && stored > 0) return stored;
    const history = input?.placementHistory || {};
    const assessed = Number(
      history?.rankVersions?.[rankId] ?? history?.assessedRankVersions?.[rankId]
    );
    return Number.isSafeInteger(assessed) && assessed > 0 ? assessed : 0;
  }

  function rankWasPassedByPlacement(journey, rankId) {
    return includesId(journey?.levelPlacementPassedRankIds, rankId);
  }

  function rankWasPassedByLegacyProgress(input, rankId) {
    const journey = input?.journey || {};
    const suppliedIndex = input?.rankIndexById instanceof Map
      ? input.rankIndexById
      : null;
    const ranks = suppliedIndex
      ? []
      : stableRankOrder(input?.ranks).filter((rank) => rank?.status === 'published');
    const rankIndex = suppliedIndex
      ? Number(suppliedIndex.get(String(rankId)))
      : ranks.findIndex((rank) => itemId(rank, 'rankId') === rankId);
    const activeIndex = Number.isInteger(input?.activeRankIndex)
      ? input.activeRankIndex
      : (suppliedIndex
        ? Number(suppliedIndex.get(String(journey.activeRankId || '')))
        : ranks.findIndex((rank) =>
          itemId(rank, 'rankId') === String(journey.activeRankId || '')
        ));
    if (rankIndex < 0) return false;
    if (activeIndex > rankIndex && includesId(journey.unlockedRankIds, journey.activeRankId)) {
      return true;
    }
    return journey.contentJourneyStatus === 'completed-current-content' &&
      ranks.length > 0 && rankIndex <= activeIndex;
  }

  function deriveRankProgressView(input) {
    const rank = input?.rank || {};
    const rankId = itemId(rank, 'rankId');
    const journey = input?.journey || {};
    const gates = stableContentOrder(input?.gates, 'gateId')
      .filter((gate) => gate?.status === 'published');
    const progressByGate = input?.progressByGate || new Map();
    const storedCompletion = includesId(journey.completedRankIds, rankId);
    const placementCompletion = rankWasPassedByPlacement(journey, rankId);
    const legacyCompletion = rankWasPassedByLegacyProgress(input, rankId);
    const allCurrentGatesCleared = gates.length > 0 && gates.every((gate) => {
      const gateId = itemId(gate, 'gateId');
      const progress = rankProgressFor(progressByGate, gateId);
      return getJourneyGateState(journey, progress, gate, { rank }) === 'cleared';
    });
    const completed = Boolean(
      storedCompletion || placementCompletion || legacyCompletion || allCurrentGatesCleared
    );
    const completionVersion = rankCompletionVersion(input, rankId) ||
      (allCurrentGatesCleared ? Math.max(1, Number(rank.version) || 1) : 0);
    const currentVersion = Math.max(1, Number(rank.version) || 1);
    const masteredGateIds = gates.filter((gate) => {
      const progress = rankProgressFor(progressByGate, itemId(gate, 'gateId'));
      if (String(progress?.status || '') !== 'cleared') return false;
      return deriveGateCrownAchievement(
        progress,
        input?.masteryByWordKey
      ).masteryAchieved;
    }).map((gate) => itemId(gate, 'gateId'));
    const mastered = Boolean(
      completed && gates.length > 0 && masteredGateIds.length === gates.length
    );
    return {
      rankId,
      completed,
      mastered,
      storedCompletion,
      placementCompletion,
      legacyCompletion,
      allCurrentGatesCleared,
      completionVersion,
      currentVersion,
      hasNewContent: completed && completionVersion > 0 && currentVersion > completionVersion,
      requiredGateCount: gates.length,
      masteredGateCount: masteredGateIds.length,
      masteredGateIds,
    };
  }

  function completedWorldRankIds(journey) {
    return Array.from(new Set([
      ...(journey?.completedRankIds || []),
      ...(journey?.levelPlacementPassedRankIds || []),
    ].map(String).filter(Boolean)));
  }

  function worldCompletionSnapshot(ranks) {
    const publishedRanks = stableRankOrder(ranks)
      .filter((rank) => rank?.status === 'published');
    const requiredRankIds = publishedRanks
      .map((rank) => itemId(rank, 'rankId'))
      .filter(Boolean);
    const rankVersions = Object.fromEntries(publishedRanks.map((rank) => [
      itemId(rank, 'rankId'),
      Math.max(1, Number(rank?.version) || 1),
    ]));
    return { requiredRankIds, rankVersions };
  }

  function worldCompletionId(worldId, snapshot) {
    const world = cleanId(worldId, 'World');
    const source = (snapshot?.requiredRankIds || [])
      .map((rankId) => `${rankId}:${snapshot?.rankVersions?.[rankId] || 1}`)
      .join('|');
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `wc${WORLD_COMPLETION_VERSION}~${world}~${(hash >>> 0).toString(36)}`;
  }

  function createWorldCompletionAchievement(input) {
    const snapshot = input?.snapshot || worldCompletionSnapshot(input?.ranks);
    const worldId = cleanId(input?.worldId, 'World');
    const completedBy = input?.completedBy === 'level-placement'
      ? 'level-placement'
      : 'gate-clear';
    return {
      version: WORLD_COMPLETION_VERSION,
      status: 'completed',
      worldId,
      completionId: worldCompletionId(worldId, snapshot),
      requiredRankIds: snapshot.requiredRankIds.slice(),
      rankVersions: { ...snapshot.rankVersions },
      completedBy,
      completedAt: input?.completedAt || null,
    };
  }

  function deriveWorldProgressView(input) {
    const journey = input?.journey || {};
    const ranks = stableRankOrder(input?.ranks)
      .filter((rank) => rank?.status === 'published');
    const snapshot = worldCompletionSnapshot(ranks);
    const coveredIds = new Set(completedWorldRankIds(journey));
    const rankIndexById = new Map(ranks.map((rank, index) => [
      itemId(rank, 'rankId'),
      index,
    ]));
    const activeRankIndex = rankIndexById.has(String(journey.activeRankId || ''))
      ? rankIndexById.get(String(journey.activeRankId || ''))
      : -1;
    const rankProgress = ranks.map((rank) => {
      const rankId = itemId(rank, 'rankId');
      const gates = input?.gatesByRank instanceof Map
        ? input.gatesByRank.get(rankId)
        : input?.gatesByRank?.[rankId];
      const progressByGate = input?.progressByRank instanceof Map
        ? input.progressByRank.get(rankId)
        : input?.progressByRank?.[rankId];
      return deriveRankProgressView({
        ...input,
        rank,
        ranks,
        gates,
        progressByGate,
        journey,
        rankIndexById,
        activeRankIndex,
        placementHistory: input?.placementHistoryByRank instanceof Map
          ? input.placementHistoryByRank.get(rankId)
          : input?.placementHistoryByRank?.[rankId],
      });
    });
    rankProgress.forEach((progress) => {
      if (progress.completed) coveredIds.add(String(progress.rankId));
    });
    const currentContentCompleted = snapshot.requiredRankIds.length > 0 &&
      snapshot.requiredRankIds.every((rankId) => coveredIds.has(String(rankId)));
    const storedAchievement = journey?.worldCompletion?.status === 'completed' &&
      Number(journey.worldCompletion.version) === WORLD_COMPLETION_VERSION
      ? journey.worldCompletion
      : null;
    const completionWorldId = String(journey?.worldId || input?.worldId || '');
    const currentCompletionId = snapshot.requiredRankIds.length && completionWorldId
      ? worldCompletionId(completionWorldId, snapshot)
      : '';
    const achievementMatchesCurrentContent = Boolean(
      storedAchievement &&
      String(storedAchievement.completionId || '') === currentCompletionId
    );
    const legacyCompleted = Boolean(
      !storedAchievement &&
      journey?.contentJourneyStatus === 'completed-current-content' &&
      currentContentCompleted
    );
    const completed = Boolean(storedAchievement || legacyCompleted || currentContentCompleted);
    const currentContentTerminal = Boolean(
      currentContentCompleted ||
      (
        journey?.contentJourneyStatus === 'completed-current-content' &&
        achievementMatchesCurrentContent
      )
    );
    const mastered = Boolean(
      currentContentCompleted &&
      rankProgress.length > 0 &&
      rankProgress.every((progress) => progress.mastered)
    );
    return {
      completed,
      mastered,
      storedAchievement,
      legacyCompleted,
      currentContentCompleted,
      currentContentTerminal,
      achievementMatchesCurrentContent,
      hasNewContent: completed && !currentContentTerminal,
      completionId: String(
        storedAchievement?.completionId ||
        (completed && completionWorldId ? worldCompletionId(completionWorldId, snapshot) : '')
      ),
      completedBy: String(storedAchievement?.completedBy || (legacyCompleted ? 'legacy' : 'derived')),
      requiredRankCount: snapshot.requiredRankIds.length,
      completedRankCount: snapshot.requiredRankIds.filter((rankId) => coveredIds.has(String(rankId))).length,
      masteredRankCount: rankProgress.filter((progress) => progress.mastered).length,
      requiredRankIds: snapshot.requiredRankIds,
      rankVersions: snapshot.rankVersions,
      rankProgress,
    };
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
      mastered: 'متقنة',
    }[status] || 'مقفلة';
  }

  const API = Object.freeze({
    JOURNEY_VERSION,
    WORLD_COMPLETION_VERSION,
    PLACEMENT_STATUS,
    PLACEMENT_STATUSES,
    JOURNEY_STATUSES,
    CONTENT_JOURNEY_STATUSES,
    DESTINATION_CLASSIFICATIONS,
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
    resolveJourneyDestination,
    resolveActiveJourneyDestination,
    classifyJourneyDestination,
    resolveLevelPlacementResultDestination,
    planPlacementOutcome,
    selectJourneyStart,
    selectNextJourneyTarget,
    createJourneySeed,
    contentSourceId,
    levelPlacementSourceId,
    gateProgressPathKey,
    detectNewContentWordIds,
    effectiveLoadedGateWords,
    deriveGateCrownAchievement,
    deriveGateMasteryView,
    gatePresentationState,
    deriveRankProgressView,
    completedWorldRankIds,
    worldCompletionSnapshot,
    worldCompletionId,
    createWorldCompletionAchievement,
    deriveWorldProgressView,
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
