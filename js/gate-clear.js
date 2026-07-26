(function attachLootLinguaGateClear(root) {
  'use strict';

  const GATE_CLEAR_VERSION = 1;
  const STATUSES = Object.freeze(['active', 'submitting', 'passed', 'failed', 'abandoned']);

  function cleanId(value, label) {
    const id = String(value || '').trim();
    if (!id || id.includes('/') || id.length > 500) {
      const error = new Error(`${label || 'Gate Clear'} ID is invalid.`);
      error.code = 'gate-clear/invalid-id';
      throw error;
    }
    return id;
  }

  function hashSeed(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededShuffle(items, seed) {
    const output = (Array.isArray(items) ? items : []).slice();
    let state = hashSeed(seed) || 1;
    for (let index = output.length - 1; index > 0; index -= 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const swap = state % (index + 1);
      [output[index], output[swap]] = [output[swap], output[index]];
    }
    return output;
  }

  function resolvePassThreshold(gate, schema) {
    const configured = Number(
      gate?.passThreshold ?? gate?.entryAssessmentPassRatio ?? gate?.unlockConfig?.passThreshold
    );
    if (Number.isFinite(configured) && configured > 0 && configured <= 1) return configured;
    const fallback = Number(schema?.DEFAULT_GATE_PASS_THRESHOLD);
    return Number.isFinite(fallback) && fallback > 0 && fallback <= 1 ? fallback : 0.75;
  }

  function requiredCorrect(total, threshold) {
    return Math.ceil(Math.max(0, Number(total) || 0) * Number(threshold || 0.75));
  }

  function createSessionSeed(input) {
    const attemptId = cleanId(input?.attemptId, 'Attempt');
    const words = (Array.isArray(input?.words) ? input.words : [])
      .filter((word) => word?.status !== 'draft' && word?.status !== 'archived')
      .filter((word) => String(word?.contentWordId || '') && String(word?.word || '') && String(word?.translation || word?.meaning || ''));
    if (!words.length) {
      const error = new Error('Gate Clear requires published words.');
      error.code = 'gate-clear/no-words';
      throw error;
    }
    const questionOrder = seededShuffle(
      words.map((word) => cleanId(word.contentWordId, 'Word')),
      attemptId
    );
    const configuredPassRatio = Number(input?.passRatio);
    const passRatio = Number.isFinite(configuredPassRatio) &&
      configuredPassRatio > 0 && configuredPassRatio <= 1
      ? configuredPassRatio
      : 0.75;
    return {
      attemptId,
      worldId: cleanId(input?.worldId, 'World'),
      rankId: cleanId(input?.rankId, 'Rank'),
      gateId: cleanId(input?.gateId, 'Gate'),
      questionOrder,
      answers: [],
      currentQuestionIndex: 0,
      correctCount: 0,
      totalCount: questionOrder.length,
      passRatio,
      requiredCorrect: requiredCorrect(questionOrder.length, passRatio),
      status: 'active',
      gateClearVersion: GATE_CLEAR_VERSION,
    };
  }

  function buildQuestion(session, words) {
    if (!session || session.status !== 'active') return null;
    const contentWordId = session.questionOrder?.[session.currentQuestionIndex];
    if (!contentWordId) return null;
    const eligibleWords = (Array.isArray(words) ? words : [])
      .filter((word) => word?.status !== 'draft' && word?.status !== 'archived');
    const index = new Map(eligibleWords.map((word) => [String(word.contentWordId), word]));
    const target = index.get(String(contentWordId));
    if (!target) return null;
    const distractors = seededShuffle(
      [...index.values()].filter((word) => String(word.contentWordId) !== String(contentWordId)),
      `${session.attemptId}:${session.currentQuestionIndex}`
    ).slice(0, 3);
    const options = seededShuffle([target, ...distractors], `${session.attemptId}:options:${session.currentQuestionIndex}`)
      .map((word) => ({
        contentWordId: String(word.contentWordId),
        text: String(word.word || ''),
      }));
    return {
      contentWordId: String(contentWordId),
      prompt: String(target.translation || target.meaning || ''),
      options,
      correctContentWordId: String(contentWordId),
    };
  }

  function answerSession(session, selectedContentWordId) {
    if (!session || session.status !== 'active') {
      const error = new Error('Gate Clear attempt is not active.');
      error.code = 'gate-clear/not-active';
      throw error;
    }
    const expected = String(session.questionOrder?.[session.currentQuestionIndex] || '');
    const selected = cleanId(selectedContentWordId, 'Selected word');
    if (!expected) {
      const error = new Error('Gate Clear question is unavailable.');
      error.code = 'gate-clear/question-missing';
      throw error;
    }
    if (!(session.questionOrder || []).map(String).includes(selected)) {
      const error = new Error('Selected Gate Clear option is invalid.');
      error.code = 'gate-clear/invalid-option';
      throw error;
    }
    const correct = selected === expected;
    const answers = [...(session.answers || []), {
      contentWordId: expected,
      selectedContentWordId: selected,
      correct,
    }];
    const currentQuestionIndex = answers.length;
    return {
      ...session,
      answers,
      currentQuestionIndex,
      correctCount: Math.max(0, Number(session.correctCount) || 0) + (correct ? 1 : 0),
      status: currentQuestionIndex === session.totalCount ? 'submitting' : 'active',
    };
  }

  function resultFor(session) {
    const passed = Number(session?.correctCount) >= Number(session?.requiredCorrect);
    return {
      passed,
      result: passed ? 'passed' : 'failed',
      score: Number(session?.totalCount) > 0
        ? Number(session.correctCount) / Number(session.totalCount)
        : 0,
    };
  }

  const API = Object.freeze({
    GATE_CLEAR_VERSION,
    STATUSES,
    cleanId,
    seededShuffle,
    resolvePassThreshold,
    requiredCorrect,
    createSessionSeed,
    buildQuestion,
    answerSession,
    resultFor,
  });

  Object.defineProperty(root, 'LootLinguaGateClear', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
