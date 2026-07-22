(function attachLootLinguaLevelPlacement(root) {
  'use strict';

  const LEVEL_PLACEMENT_VERSION = 1;
  const LEVEL_PLACEMENT_CONFIG = Object.freeze({
    minimumQuestionsPerRank: 3,
    preferredQuestionsPerRank: 4,
    maximumTotalQuestions: 24,
    adaptiveQuestionsPerRank: 2,
    maximumAdaptiveRounds: 1,
  });
  const SESSION_STATUSES = Object.freeze([
    'active',
    'submitting',
    'awaiting-decision',
    'completed',
    'paused',
    'abandoned',
  ]);
  const SAVE_WORD_CHOICES = Object.freeze([
    'undecided',
    'incorrect-only',
    'all',
    'none',
  ]);
  const RANK_RESULT_STATUSES = Object.freeze([
    'passed',
    'failed',
    'ambiguous',
    'insufficient-sample',
  ]);

  function levelPlacementError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  function schemaApi() {
    const schema = root.LootLinguaContentSchema;
    if (!schema) {
      throw levelPlacementError(
        'level-placement/schema-unavailable',
        'Content schema is unavailable.'
      );
    }
    return schema;
  }

  function cleanId(value, label) {
    const id = String(value || '').trim();
    if (!id || id.includes('/') || id.length > 500) {
      throw levelPlacementError(
        'level-placement/invalid-id',
        `${label || 'Content'} ID is invalid.`
      );
    }
    return id;
  }

  function normalizeLevel(value) {
    return schemaApi().normalizeCefrLevel(value);
  }

  function assertClassifiedLevel(value) {
    const level = normalizeLevel(value);
    if (level === 'unclassified') {
      throw levelPlacementError(
        'level-placement/unclassified',
        'Unclassified ranks cannot use Level Placement.'
      );
    }
    return level;
  }

  function hashText(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return hash >>> 0;
  }

  function compactToken(value) {
    const text = String(value || '');
    const safe = text.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24);
    return `${safe || 'id'}_${hashText(text).toString(36)}`;
  }

  function createAssessmentSeed(worldId, cefrLevel, entropy) {
    return [
      cleanId(worldId, 'World'),
      assertClassifiedLevel(cefrLevel),
      String(entropy || Date.now()),
    ].join(':');
  }

  function assessmentId(worldId, cefrLevel, seed) {
    const level = assertClassifiedLevel(cefrLevel);
    return `level_placement_v${LEVEL_PLACEMENT_VERSION}_${level}_${compactToken(
      seed || createAssessmentSeed(worldId, level)
    )}`;
  }

  function stableByOrder(items, idField) {
    return (Array.isArray(items) ? items : []).slice().sort((left, right) => {
      const leftOrder = Number(left?.order);
      const rightOrder = Number(right?.order);
      const safeLeft = Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER;
      const safeRight = Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER;
      if (safeLeft !== safeRight) return safeLeft - safeRight;
      return String(left?.[idField] || left?.id || '')
        .localeCompare(String(right?.[idField] || right?.id || ''), 'en');
    });
  }

  function deterministicOrder(items, seed, identity) {
    return (Array.isArray(items) ? items : []).slice().sort((left, right) => {
      const leftId = identity(left);
      const rightId = identity(right);
      const byHash = hashText(`${seed}:${leftId}`) - hashText(`${seed}:${rightId}`);
      return byHash || leftId.localeCompare(rightId, 'en');
    });
  }

  function validDiagnosticWord(word) {
    return Boolean(
      word &&
      word.status === 'published' &&
      String(word.contentWordId || '').trim() &&
      String(word.wordKey || '').trim() &&
      String(word.word || '').trim() &&
      String(word.translation || word.meaning || '').trim()
    );
  }

  function questionId(rankId, gateId, contentWordId) {
    return `lpq_${compactToken(rankId)}_${compactToken(gateId)}_${compactToken(contentWordId)}`;
  }

  function normalizeCandidate(rank, gate, word, passThreshold) {
    return {
      questionId: questionId(rank.rankId, gate.gateId, word.contentWordId),
      rankId: String(rank.rankId),
      gateId: String(gate.gateId),
      contentWordId: String(word.contentWordId),
      wordKey: String(word.wordKey),
      order: Number.isFinite(Number(word.order)) ? Number(word.order) : 0,
      word: String(word.word),
      translation: String(word.translation || word.meaning || ''),
      passThreshold: Number(passThreshold),
      category: String(word.category || ''),
      partOfSpeech: String(word.partOfSpeech || ''),
      definition: String(word.definition || ''),
      definition_ar: String(word.definition_ar || word.definitionAr || ''),
      example: String(word.example || ''),
      exampleTranslation: String(word.exampleTranslation || ''),
      level: String(word.level || ''),
      tags: Array.isArray(word.tags) ? word.tags.map(String).filter(Boolean) : [],
      synonyms: Array.isArray(word.synonyms) ? word.synonyms.map(String).filter(Boolean) : [],
      pronunciation: String(word.pronunciation || ''),
      notes: String(word.notes || ''),
    };
  }

  function rankQuotas(rankCount, config) {
    const settings = config || LEVEL_PLACEMENT_CONFIG;
    const count = Math.max(0, Number(rankCount) || 0);
    const quotas = Array.from({ length: count }, () => 0);
    let remaining = settings.maximumTotalQuestions;
    for (let index = 0; index < count && remaining > 0; index += 1) {
      quotas[index] = 1;
      remaining -= 1;
    }
    for (let target = 2; target <= settings.preferredQuestionsPerRank && remaining > 0; target += 1) {
      for (let index = 0; index < count && remaining > 0; index += 1) {
        if (quotas[index] < target) {
          quotas[index] += 1;
          remaining -= 1;
        }
      }
    }
    return quotas;
  }

  function pickDistributedCandidates(rankBundle, quota, seed, usedWordKeys, config) {
    const rank = rankBundle.rank;
    const gateBuckets = stableByOrder(rankBundle.gates, 'gateId').map((bundle) => {
      const threshold = Number(bundle.gate?.entryAssessmentPassRatio);
      const passThreshold = Number.isFinite(threshold) && threshold > 0 && threshold <= 1
        ? threshold
        : Number(schemaApi().ENTRY_ASSESSMENT_DEFAULTS.passRatio);
      const words = deterministicOrder(
        (bundle.words || []).filter(validDiagnosticWord),
        `${seed}:${rank.rankId}:${bundle.gate.gateId}`,
        (word) => `${word.wordKey}:${word.contentWordId}`
      ).map((word) => normalizeCandidate(rank, bundle.gate, word, passThreshold));
      return { gate: bundle.gate, words, index: 0 };
    }).filter((bucket) => bucket.words.length);

    const picked = [];
    const maximum = quota + config.adaptiveQuestionsPerRank;
    let cursor = 0;
    let misses = 0;
    while (gateBuckets.length && picked.length < maximum && misses < gateBuckets.length * 3) {
      const bucket = gateBuckets[cursor % gateBuckets.length];
      cursor += 1;
      let candidate = null;
      while (bucket.index < bucket.words.length) {
        const next = bucket.words[bucket.index++];
        if (usedWordKeys.has(next.wordKey)) continue;
        candidate = next;
        break;
      }
      if (!candidate) {
        misses += 1;
        continue;
      }
      misses = 0;
      usedWordKeys.add(candidate.wordKey);
      picked.push(candidate);
    }
    return {
      primary: picked.slice(0, quota),
      reserve: picked.slice(quota, quota + config.adaptiveQuestionsPerRank),
      availableCount: picked.length,
    };
  }

  function buildLevelSample(input) {
    const config = Object.freeze({
      ...LEVEL_PLACEMENT_CONFIG,
      ...(input?.config || {}),
    });
    const cefrLevel = assertClassifiedLevel(input?.cefrLevel);
    const seed = String(input?.assessmentSeed || '').trim();
    if (!seed) {
      throw levelPlacementError('level-placement/seed-required', 'Assessment seed is required.');
    }
    const rankBundles = (Array.isArray(input?.rankBundles) ? input.rankBundles : [])
      .filter((bundle) => (
        bundle?.rank?.status === 'published' &&
        normalizeLevel(bundle.rank.cefrLevel) === cefrLevel
      ))
      .sort((left, right) => schemaApi().comparePublishedRanks(left.rank, right.rank));
    if (!rankBundles.length) {
      throw levelPlacementError('level-placement/no-ranks', 'The selected level has no published ranks.');
    }

    const quotas = rankQuotas(rankBundles.length, config);
    const usedWordKeys = new Set();
    const primary = [];
    const reserve = [];
    const rankCoverage = {};
    const rankTitles = {};
    const rankFirstGateIds = {};
    rankBundles.forEach((bundle, index) => {
      const rankId = cleanId(bundle.rank.rankId, 'Rank');
      const selection = pickDistributedCandidates(
        bundle,
        quotas[index],
        seed,
        usedWordKeys,
        { ...config, adaptiveQuestionsPerRank: 0 }
      );
      primary.push(...selection.primary);
      rankCoverage[rankId] = {
        requested: quotas[index],
        selected: selection.primary.length,
        reserve: 0,
        weak: selection.primary.length < config.minimumQuestionsPerRank,
      };
      rankTitles[rankId] = String(bundle.rank.title || '');
      const firstGate = stableByOrder(bundle.gates, 'gateId')
        .find((gateBundle) => gateBundle?.gate?.status === 'published');
      rankFirstGateIds[rankId] = String(firstGate?.gate?.gateId || '');
    });
    rankBundles.forEach((bundle) => {
      const rankId = cleanId(bundle.rank.rankId, 'Rank');
      const selection = pickDistributedCandidates(
        bundle,
        0,
        `${seed}:adaptive`,
        usedWordKeys,
        config
      );
      reserve.push(...selection.reserve);
      rankCoverage[rankId].reserve = selection.reserve.length;
    });
    if (!primary.length) {
      throw levelPlacementError('level-placement/no-words', 'The selected level has no usable words.');
    }
    const orderedPrimary = deterministicOrder(
      primary,
      `${seed}:primary`,
      (item) => item.questionId
    ).slice(0, config.maximumTotalQuestions);
    const selectedWords = [...orderedPrimary, ...reserve.filter((item) => (
      !orderedPrimary.some((primaryItem) => primaryItem.questionId === item.questionId)
    ))];
    const reserveIdsByRank = {};
    reserve.forEach((item) => {
      if (!reserveIdsByRank[item.rankId]) reserveIdsByRank[item.rankId] = [];
      reserveIdsByRank[item.rankId].push(item.questionId);
    });
    return {
      cefrLevel,
      assessmentSeed: seed,
      orderedRankIds: rankBundles.map((bundle) => String(bundle.rank.rankId)),
      rankTitles,
      rankFirstGateIds,
      rankCoverage,
      selectedWords,
      selectedContentWordIds: selectedWords.map((item) => item.contentWordId),
      orderedQuestionIds: orderedPrimary.map((item) => item.questionId),
      adaptiveReserveIdsByRank: reserveIdsByRank,
    };
  }

  function createSessionSeed(input) {
    const sample = input?.sample || buildLevelSample(input);
    const id = cleanId(input?.assessmentId, 'Assessment');
    return {
      assessmentId: id,
      worldId: cleanId(input?.worldId, 'World'),
      cefrLevel: assertClassifiedLevel(sample.cefrLevel),
      status: 'active',
      assessmentSeed: String(sample.assessmentSeed),
      orderedQuestionIds: sample.orderedQuestionIds.slice(),
      selectedContentWordIds: sample.selectedContentWordIds.slice(),
      selectedWords: sample.selectedWords.map((item) => ({ ...item })),
      answers: [],
      currentQuestionIndex: 0,
      correctCount: 0,
      placementVersion: LEVEL_PLACEMENT_VERSION,
      perRankStats: {},
      ambiguousRankIds: [],
      recommendedStartRankId: '',
      recommendedStartGateId: '',
      passedRankIds: [],
      passedPrefixLength: 0,
      passedLevel: false,
      orderedRankIds: sample.orderedRankIds.slice(),
      rankTitles: { ...sample.rankTitles },
      rankFirstGateIds: { ...sample.rankFirstGateIds },
      rankCoverage: { ...sample.rankCoverage },
      adaptiveReserveIdsByRank: { ...sample.adaptiveReserveIdsByRank },
      adaptiveRound: 0,
      adaptiveRankIds: [],
      saveWordChoice: 'undecided',
      saveWordPendingIds: [],
      saveWordSavedIds: [],
      saveWordFailures: [],
      saveWordSummary: {
        created: 0,
        sourceLinked: 0,
        alreadyLinked: 0,
        restoredReady: 0,
        failed: 0,
      },
      source: 'level-placement',
      suppressRewards: true,
    };
  }

  function questionById(session, id) {
    return (session?.selectedWords || []).find(
      (item) => String(item.questionId) === String(id)
    ) || null;
  }

  function buildQuestion(session) {
    if (session?.status !== 'active') return null;
    const index = Number(session.currentQuestionIndex);
    const ids = Array.isArray(session.orderedQuestionIds) ? session.orderedQuestionIds : [];
    if (!Number.isSafeInteger(index) || index < 0 || index >= ids.length) return null;
    const correct = questionById(session, ids[index]);
    if (!correct) {
      throw levelPlacementError('level-placement/question-missing', 'Placement question is unavailable.');
    }
    const candidates = (session.selectedWords || []).filter((item) => (
      item.questionId !== correct.questionId && item.translation !== correct.translation
    ));
    const sameRank = candidates.filter((item) => item.rankId === correct.rankId);
    const otherRanks = candidates.filter((item) => item.rankId !== correct.rankId);
    const distractors = [
      ...deterministicOrder(
        sameRank,
        `${session.assessmentSeed}:options:${correct.questionId}:same-rank`,
        (item) => item.questionId
      ),
      ...deterministicOrder(
        otherRanks,
        `${session.assessmentSeed}:options:${correct.questionId}:other-ranks`,
        (item) => item.questionId
      ),
    ];
    const options = [];
    const translations = new Set();
    [correct, ...distractors].forEach((item) => {
      if (options.length >= 4 || translations.has(item.translation)) return;
      translations.add(item.translation);
      options.push({ questionId: item.questionId, text: item.translation });
    });
    return {
      questionId: correct.questionId,
      contentWordId: correct.contentWordId,
      prompt: correct.word,
      options: deterministicOrder(
        options,
        `${session.assessmentSeed}:option-order:${correct.questionId}`,
        (item) => item.questionId
      ),
      questionNumber: index + 1,
      totalQuestions: ids.length,
    };
  }

  function answerSession(session, selectedQuestionId) {
    if (session?.status !== 'active') {
      throw levelPlacementError('level-placement/session-inactive', 'Placement session is not active.');
    }
    const question = buildQuestion(session);
    if (!question) {
      throw levelPlacementError('level-placement/session-complete', 'Placement has no pending question.');
    }
    const selected = questionById(session, cleanId(selectedQuestionId, 'Answer'));
    if (!selected || !question.options.some((option) => option.questionId === selected.questionId)) {
      throw levelPlacementError('level-placement/invalid-answer', 'Placement answer is invalid.');
    }
    const correctWord = questionById(session, question.questionId);
    const correct = selected.questionId === question.questionId;
    const answers = [
      ...(Array.isArray(session.answers) ? session.answers : []),
      {
        questionId: question.questionId,
        rankId: correctWord.rankId,
        gateId: correctWord.gateId,
        contentWordId: correctWord.contentWordId,
        wordKey: correctWord.wordKey,
        selectedQuestionId: selected.questionId,
        correct,
      },
    ];
    return {
      ...session,
      answers,
      correctCount: (Number(session.correctCount) || 0) + (correct ? 1 : 0),
      currentQuestionIndex: Number(session.currentQuestionIndex) + 1,
    };
  }

  function rankThreshold(session, rankId, answers) {
    const questionIds = new Set(answers.map((answer) => String(answer.questionId)));
    const thresholds = (session.selectedWords || [])
      .filter((item) => item.rankId === rankId && questionIds.has(item.questionId))
      .map((item) => Number(item.passThreshold))
      .filter((value) => Number.isFinite(value) && value > 0 && value <= 1);
    if (!thresholds.length) return Number(schemaApi().ENTRY_ASSESSMENT_DEFAULTS.passRatio);
    return thresholds.reduce((sum, value) => sum + value, 0) / thresholds.length;
  }

  function analyzeSession(session, options) {
    const settings = { finalRound: false, ...(options || {}) };
    const stats = {};
    const answers = Array.isArray(session?.answers) ? session.answers : [];
    const orderedRankIds = Array.isArray(session?.orderedRankIds)
      ? session.orderedRankIds.map(String)
      : [];
    orderedRankIds.forEach((rankId) => {
      const rankAnswers = answers.filter((answer) => String(answer.rankId) === rankId);
      const asked = rankAnswers.length;
      const correct = rankAnswers.filter((answer) => answer.correct === true).length;
      const threshold = rankThreshold(session, rankId, rankAnswers);
      const requiredCorrect = asked ? Math.ceil(asked * threshold) : 1;
      const coverage = session.rankCoverage?.[rankId] || {};
      let status;
      if (asked < LEVEL_PLACEMENT_CONFIG.minimumQuestionsPerRank || coverage.weak) {
        status = 'insufficient-sample';
      } else if (correct >= requiredCorrect) {
        status = 'passed';
      } else if (!settings.finalRound && correct === requiredCorrect - 1) {
        status = 'ambiguous';
      } else {
        status = 'failed';
      }
      stats[rankId] = {
        asked,
        correct,
        ratio: asked ? correct / asked : 0,
        passThreshold: threshold,
        requiredCorrect,
        confidence: asked >= LEVEL_PLACEMENT_CONFIG.preferredQuestionsPerRank
          ? 'high'
          : (asked >= LEVEL_PLACEMENT_CONFIG.minimumQuestionsPerRank ? 'medium' : 'low'),
        status,
      };
    });

    const passedRankIds = [];
    let recommendedStartRankId = '';
    for (const rankId of orderedRankIds) {
      if (!recommendedStartRankId && stats[rankId]?.status === 'passed') {
        passedRankIds.push(rankId);
      } else if (!recommendedStartRankId) {
        recommendedStartRankId = rankId;
      }
    }
    const frontier = recommendedStartRankId ? stats[recommendedStartRankId] : null;
    const ambiguousRankIds = frontier?.status === 'ambiguous'
      ? [recommendedStartRankId]
      : [];
    return {
      perRankStats: stats,
      passedRankIds,
      passedPrefixLength: passedRankIds.length,
      ambiguousRankIds,
      recommendedStartRankId,
      recommendedStartGateId: recommendedStartRankId
        ? String(session.rankFirstGateIds?.[recommendedStartRankId] || '')
        : '',
      passedLevel: orderedRankIds.length > 0 && passedRankIds.length === orderedRankIds.length,
    };
  }

  function finalizeRound(session) {
    if (Number(session?.currentQuestionIndex) !== (session?.orderedQuestionIds || []).length) {
      throw levelPlacementError('level-placement/answers-incomplete', 'Placement answers are incomplete.');
    }
    const canAdapt = Number(session.adaptiveRound || 0) <
      LEVEL_PLACEMENT_CONFIG.maximumAdaptiveRounds;
    const initialAnalysis = analyzeSession(session, { finalRound: !canAdapt });
    const ambiguousRankId = initialAnalysis.ambiguousRankIds[0] || '';
    const reserve = ambiguousRankId
      ? (session.adaptiveReserveIdsByRank?.[ambiguousRankId] || [])
      : [];
    const answeredIds = new Set((session.answers || []).map((answer) => String(answer.questionId)));
    const availableSlots = Math.max(
      0,
      LEVEL_PLACEMENT_CONFIG.maximumTotalQuestions - session.orderedQuestionIds.length
    );
    const extra = reserve.filter((id) => !answeredIds.has(String(id)))
      .slice(0, Math.min(LEVEL_PLACEMENT_CONFIG.adaptiveQuestionsPerRank, availableSlots));
    if (canAdapt && ambiguousRankId && extra.length) {
      return {
        ...session,
        status: 'active',
        orderedQuestionIds: [...session.orderedQuestionIds, ...extra],
        adaptiveRound: Number(session.adaptiveRound || 0) + 1,
        adaptiveRankIds: Array.from(new Set([
          ...(session.adaptiveRankIds || []),
          ambiguousRankId,
        ])),
        perRankStats: initialAnalysis.perRankStats,
        ambiguousRankIds: [ambiguousRankId],
      };
    }
    const result = analyzeSession(session, { finalRound: true });
    return {
      ...session,
      status: 'awaiting-decision',
      ...result,
    };
  }

  function longestContiguousPassedPrefix(orderedRankIds, perRankStats) {
    const passed = [];
    for (const rankId of Array.isArray(orderedRankIds) ? orderedRankIds : []) {
      if (perRankStats?.[rankId]?.status !== 'passed') break;
      passed.push(String(rankId));
    }
    return passed;
  }

  function canStartLevelPlacement(cefrLevel, journey) {
    const level = normalizeLevel(cefrLevel);
    if (level === 'unclassified') return false;
    const levels = schemaApi().CEFR_LEVELS.filter((item) => item !== 'unclassified');
    const index = levels.indexOf(level);
    if (index === 0) return true;
    const passed = new Set((journey?.passedCefrLevels || []).map(String));
    return passed.has(levels[index - 1]);
  }

  function wordIdsForSaveChoice(session, choice) {
    if (!SAVE_WORD_CHOICES.includes(choice) || choice === 'undecided') {
      throw levelPlacementError('level-placement/invalid-save-choice', 'Save choice is invalid.');
    }
    if (choice === 'none') return [];
    const answers = Array.isArray(session?.answers) ? session.answers : [];
    return answers
      .filter((answer) => choice === 'all' || answer.correct !== true)
      .map((answer) => String(answer.questionId || ''))
      .filter((id, index, values) => id && values.indexOf(id) === index);
  }

  const API = Object.freeze({
    LEVEL_PLACEMENT_VERSION,
    LEVEL_PLACEMENT_CONFIG,
    SESSION_STATUSES,
    SAVE_WORD_CHOICES,
    RANK_RESULT_STATUSES,
    levelPlacementError,
    cleanId,
    normalizeLevel,
    assertClassifiedLevel,
    hashText,
    createAssessmentSeed,
    assessmentId,
    questionId,
    rankQuotas,
    buildLevelSample,
    createSessionSeed,
    buildQuestion,
    answerSession,
    analyzeSession,
    finalizeRound,
    longestContiguousPassedPrefix,
    canStartLevelPlacement,
    wordIdsForSaveChoice,
  });

  Object.defineProperty(root, 'LootLinguaLevelPlacement', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
