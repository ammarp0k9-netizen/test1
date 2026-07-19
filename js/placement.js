(function attachLootLinguaPlacement(root) {
  'use strict';

  const PLACEMENT_VERSION = 1;
  const SESSION_STATUSES = Object.freeze(['active', 'completed', 'abandoned']);
  const SESSION_OUTCOMES = Object.freeze(['passed', 'failed']);
  const MAX_QUESTIONS = 2000;

  function placementError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  function cleanId(value, label) {
    const id = String(value || '').trim();
    if (!id || id.includes('/') || id.length > 500) {
      throw placementError('placement/invalid-id', `${label || 'Placement'} ID is invalid.`);
    }
    return id;
  }

  function resolvePassThreshold(gate, schema) {
    const contentSchema = schema || root.LootLinguaContentSchema;
    if (!contentSchema?.resolveEntryAssessmentPassRatio) {
      throw placementError('placement/schema-unavailable', 'Placement threshold is unavailable.');
    }
    return contentSchema.resolveEntryAssessmentPassRatio(gate);
  }

  function requiredCorrectAnswers(totalQuestions, threshold) {
    const total = Number(totalQuestions);
    const ratio = Number(threshold);
    if (!Number.isSafeInteger(total) || total < 1 || total > MAX_QUESTIONS) {
      throw placementError('placement/invalid-question-count', 'Question count is invalid.');
    }
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw placementError('placement/invalid-threshold', 'Placement threshold is invalid.');
    }
    return Math.ceil(total * ratio);
  }

  function placementScore(correctCount, totalQuestions) {
    const correct = Math.max(0, Number(correctCount) || 0);
    const total = Math.max(0, Number(totalQuestions) || 0);
    return total ? correct / total : 0;
  }

  function placementPassed(correctCount, totalQuestions, threshold) {
    return Number(correctCount) >= requiredCorrectAnswers(totalQuestions, threshold);
  }

  function compactIdToken(value) {
    const encoded = encodeURIComponent(value);
    if (encoded.length <= 180) return `${encoded.length}_${encoded}`;
    let first = 2166136261;
    let second = 2246822519;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 3266489917);
    }
    return `h${encoded.length}_${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
  }

  function assessmentId(rankId, gateId) {
    const rank = cleanId(rankId, 'Rank');
    const gate = cleanId(gateId, 'Gate');
    return `placement_v${PLACEMENT_VERSION}_${compactIdToken(rank)}_${compactIdToken(gate)}`;
  }

  function orderedWordIds(words) {
    const seen = new Set();
    const ids = [];
    (Array.isArray(words) ? words : []).forEach((word) => {
      const id = String(word?.contentWordId || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    if (!ids.length || ids.length > MAX_QUESTIONS) {
      throw placementError(
        'placement/invalid-question-count',
        'Placement needs one or more published words.'
      );
    }
    return ids;
  }

  function createSessionSeed(input) {
    const ids = orderedWordIds(input?.words);
    const threshold = Number(input?.passThreshold);
    return {
      assessmentId: cleanId(input?.assessmentId, 'Assessment'),
      worldId: cleanId(input?.worldId, 'World'),
      rankId: cleanId(input?.rankId, 'Rank'),
      currentGateId: cleanId(input?.gateId, 'Gate'),
      currentQuestionIndex: 0,
      orderedContentWordIds: ids,
      answers: [],
      correctCount: 0,
      totalQuestions: ids.length,
      passThreshold: threshold,
      requiredCorrect: requiredCorrectAnswers(ids.length, threshold),
      status: 'active',
      source: 'placement',
      suppressRewards: true,
      placementVersion: PLACEMENT_VERSION,
    };
  }

  function answerSession(session, selectedContentWordId) {
    if (session?.status !== 'active') {
      throw placementError('placement/session-inactive', 'Placement session is not active.');
    }
    const index = Number(session.currentQuestionIndex);
    const ids = Array.isArray(session.orderedContentWordIds)
      ? session.orderedContentWordIds.map(String)
      : [];
    if (!Number.isSafeInteger(index) || index < 0 || index >= ids.length) {
      throw placementError('placement/session-complete', 'Placement session has no pending question.');
    }
    const contentWordId = ids[index];
    const selectedId = cleanId(selectedContentWordId, 'Selected word');
    const correct = selectedId === contentWordId;
    const answers = [
      ...(Array.isArray(session.answers) ? session.answers : []),
      { contentWordId, selectedContentWordId: selectedId, correct },
    ];
    return {
      ...session,
      currentQuestionIndex: index + 1,
      answers,
      correctCount: (Number(session.correctCount) || 0) + (correct ? 1 : 0),
    };
  }

  function wordAnswerText(word) {
    return String(word?.translation || word?.meaning || '').trim();
  }

  function buildQuestion(words, session) {
    const index = Number(session?.currentQuestionIndex);
    const orderedIds = Array.isArray(session?.orderedContentWordIds)
      ? session.orderedContentWordIds.map(String)
      : [];
    if (!Number.isSafeInteger(index) || index < 0 || index >= orderedIds.length) return null;

    const wordById = new Map(
      (Array.isArray(words) ? words : [])
        .map((word) => [String(word?.contentWordId || ''), word])
        .filter(([id]) => id)
    );
    const correctId = orderedIds[index];
    const correctWord = wordById.get(correctId);
    if (!correctWord) {
      throw placementError('placement/word-unavailable', 'Placement word is unavailable.');
    }
    const correctText = wordAnswerText(correctWord);
    if (!correctText) {
      throw placementError('placement/word-unavailable', 'Placement answer is unavailable.');
    }

    const options = [{ contentWordId: correctId, text: correctText }];
    const usedText = new Set([correctText]);
    for (let offset = 1; offset < orderedIds.length && options.length < 4; offset += 1) {
      const candidateId = orderedIds[(index + offset) % orderedIds.length];
      const candidate = wordById.get(candidateId);
      const text = wordAnswerText(candidate);
      if (!candidate || !text || usedText.has(text)) continue;
      usedText.add(text);
      options.push({ contentWordId: candidateId, text });
    }
    options.sort((left, right) => {
      const leftKey = `${index}:${left.contentWordId}`;
      const rightKey = `${index}:${right.contentWordId}`;
      return leftKey.localeCompare(rightKey, 'en');
    });

    return {
      contentWordId: correctId,
      prompt: String(correctWord.word || '').trim(),
      options,
      questionNumber: index + 1,
      totalQuestions: orderedIds.length,
    };
  }

  const API = Object.freeze({
    PLACEMENT_VERSION,
    SESSION_STATUSES,
    SESSION_OUTCOMES,
    MAX_QUESTIONS,
    placementError,
    cleanId,
    resolvePassThreshold,
    requiredCorrectAnswers,
    placementScore,
    placementPassed,
    assessmentId,
    orderedWordIds,
    createSessionSeed,
    answerSession,
    buildQuestion,
  });

  Object.defineProperty(root, 'LootLinguaPlacement', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
