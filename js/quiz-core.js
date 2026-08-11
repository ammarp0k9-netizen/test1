(function attachLootLinguaQuizCore(root) {
  'use strict';

  const SELECTION_PLAN_VERSION = 2;
  const MATCHING_STATE_VERSION = 1;

  function cleanText(value) {
    return String(value || '').trim();
  }

  function normalizeComparable(value) {
    return cleanText(value).toLowerCase().replace(/\s+/g, ' ');
  }

  function parseSourceScope(scope) {
    const requested = cleanText(scope) || 'personal';
    if (requested === 'starred') {
      return Object.freeze({ scope: 'starred', sourceType: 'difficult', sourceId: '' });
    }
    if (requested.startsWith('custom:')) {
      return Object.freeze({
        scope: requested,
        sourceType: 'private-world',
        sourceId: requested.slice(7),
      });
    }
    return Object.freeze({ scope: 'personal', sourceType: 'personal', sourceId: '' });
  }

  function resolveQuizCandidates(input = {}) {
    const source = parseSourceScope(input.scope);
    const rawWords = Array.isArray(input.rawWords) ? input.rawWords : [];
    const normalizeCandidate = typeof input.normalizeCandidate === 'function'
      ? input.normalizeCandidate
      : (word) => ({ ...word });
    const wordKeyOf = typeof input.wordKeyOf === 'function'
      ? input.wordKeyOf
      : (word) => normalizeComparable(word?.word || word?.text);
    const isEligible = typeof input.isEligible === 'function'
      ? input.isEligible
      : () => true;
    const matchingMode = input.mode === 'matching';
    const candidates = [];
    const excluded = [];
    const seenWordKeys = new Set();
    const seenMeanings = new Set();

    rawWords.forEach((rawWord, index) => {
      if (!rawWord || typeof rawWord !== 'object') {
        excluded.push({ index, reason: 'invalid-record', wordKey: '' });
        return;
      }
      if (source.sourceType === 'difficult' && rawWord.starred !== true) {
        excluded.push({ index, reason: 'not-difficult', wordKey: cleanText(rawWord.wordKey) });
        return;
      }
      const contextualWord = source.sourceType === 'private-world'
        ? { ...rawWord, customWorldId: source.sourceId }
        : { ...rawWord };
      const candidate = normalizeCandidate(contextualWord, index, source.scope);
      if (!candidate) {
        excluded.push({ index, reason: 'normalization-failed', wordKey: '' });
        return;
      }
      const word = cleanText(candidate.word || candidate.text);
      const meaning = cleanText(candidate.meaning || candidate.translation);
      if (!word || !meaning) {
        excluded.push({ index, reason: 'missing-learnable-content', wordKey: cleanText(candidate.wordKey) });
        return;
      }
      if (isEligible(candidate, source) === false) {
        excluded.push({ index, reason: 'lifecycle-ineligible', wordKey: cleanText(candidate.wordKey) });
        return;
      }
      const wordKey = cleanText(wordKeyOf(candidate));
      if (!wordKey) {
        excluded.push({ index, reason: 'missing-word-key', wordKey: '' });
        return;
      }
      if (seenWordKeys.has(wordKey)) {
        excluded.push({ index, reason: 'normalized-duplicate', wordKey });
        return;
      }
      const meaningKey = normalizeComparable(meaning);
      if (matchingMode && seenMeanings.has(meaningKey)) {
        excluded.push({ index, reason: 'ambiguous-matching-meaning', wordKey });
        return;
      }
      seenWordKeys.add(wordKey);
      if (matchingMode) seenMeanings.add(meaningKey);
      candidates.push({ ...candidate, word, meaning, wordKey });
    });

    return Object.freeze({
      status: input.status || 'ready',
      ownerId: cleanText(input.ownerId) || 'guest',
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      scope: source.scope,
      mode: cleanText(input.mode),
      rawCount: rawWords.length,
      candidateCount: candidates.length,
      candidates,
      excluded,
    });
  }

  function getQuizStartEligibility(candidateCount, requestedCount, options = {}) {
    const available = Math.max(0, Math.floor(Number(candidateCount) || 0));
    const requested = requestedCount === 'all'
      ? available
      : Math.max(1, Math.floor(Number(requestedCount) || 1));
    const modeMinimum = options.mode === 'matching' ? 5 : 1;
    const required = Math.max(modeMinimum, requested);
    if (available <= 0) {
      return Object.freeze({ allowed: false, reason: 'empty-source', available, required, requested });
    }
    if (available < required) {
      return Object.freeze({ allowed: false, reason: 'below-required-count', available, required, requested });
    }
    return Object.freeze({ allowed: true, reason: 'ready', available, required, requested });
  }

  function createSourceRequestCoordinator() {
    let generation = 0;
    let activeOwnerId = '';
    let activeScope = '';
    return Object.freeze({
      begin(ownerId, scope) {
        generation += 1;
        activeOwnerId = cleanText(ownerId) || 'guest';
        activeScope = parseSourceScope(scope).scope;
        return Object.freeze({ generation, ownerId: activeOwnerId, scope: activeScope });
      },
      isCurrent(token) {
        return Boolean(token) &&
          Number(token.generation) === generation &&
          cleanText(token.ownerId) === activeOwnerId &&
          parseSourceScope(token.scope).scope === activeScope;
      },
      invalidate() {
        generation += 1;
        activeOwnerId = '';
        activeScope = '';
        return generation;
      },
      current() {
        return Object.freeze({ generation, ownerId: activeOwnerId, scope: activeScope });
      },
    });
  }

  function isSourceResponseCurrent(input = {}) {
    const coordinator = input.coordinator;
    const token = input.token;
    const response = input.response;
    const source = parseSourceScope(token?.scope);
    return Boolean(
      coordinator?.isCurrent?.(token) &&
      source.sourceType === 'private-world' &&
      cleanText(input.currentOwnerId) === cleanText(token?.ownerId) &&
      cleanText(response?.ownerId) === cleanText(token?.ownerId) &&
      cleanText(response?.sourceId) === source.sourceId
    );
  }

  function toTimestamp(value) {
    if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
    if (value?.toMillis) return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function recentSessionIndex(wordKey, history) {
    return (Array.isArray(history) ? history : []).findIndex((entry) =>
      (entry?.wordKeys || []).includes(wordKey) ||
      (entry?.wordExposures || []).some((item) => item?.wordKey === wordKey)
    );
  }

  function compareLeastRecentlySelected(a, b) {
    const aIndex = Number(a?.recentSessionIndex);
    const bIndex = Number(b?.recentSessionIndex);
    const aNeverRecent = !Number.isFinite(aIndex) || aIndex < 0;
    const bNeverRecent = !Number.isFinite(bIndex) || bIndex < 0;
    if (aNeverRecent !== bNeverRecent) return aNeverRecent ? -1 : 1;
    if (aNeverRecent) return 0;
    return bIndex - aIndex;
  }

  function selectionQuotas(size, dueCount) {
    const limit = Math.max(1, Math.floor(Number(size) || 1));
    const level = dueCount >= limit * 3 ? 'critical' : dueCount >= limit * 2 ? 'heavy' : 'normal';
    const ratios = level === 'critical'
      ? { review: 0.60, fresh: 0.30 }
      : level === 'heavy'
        ? { review: 0.50, fresh: 0.30 }
        : { review: 0.40, fresh: 0.40 };
    let review = Math.round(limit * ratios.review);
    let fresh = Math.round(limit * ratios.fresh);
    let coverage = Math.max(0, limit - review - fresh);
    if (limit >= 5 && fresh < 1) fresh = 1;
    while (review + fresh + coverage > limit && coverage > 0) coverage -= 1;
    while (review + fresh + coverage > limit && review > 0) review -= 1;
    while (review + fresh + coverage < limit) coverage += 1;
    return Object.freeze({ review, fresh, coverage, backlogLevel: level });
  }

  function alternateFreshOrder(items) {
    const exposureGroups = new Map();
    items.forEach((item) => {
      const seen = item.trustedSeenCount;
      if (!exposureGroups.has(seen)) exposureGroups.set(seen, []);
      exposureGroups.get(seen).push(item);
    });
    const result = [];
    [...exposureGroups.keys()].sort((a, b) => a - b).forEach((seen) => {
      const recencyGroups = new Map();
      exposureGroups.get(seen).forEach((item) => {
        const recencyKey = item.recentSessionIndex < 0 ? 'never' : String(item.recentSessionIndex);
        if (!recencyGroups.has(recencyKey)) recencyGroups.set(recencyKey, []);
        recencyGroups.get(recencyKey).push(item);
      });
      const orderedRecencyKeys = [...recencyGroups.keys()].sort((a, b) => {
        if (a === 'never') return -1;
        if (b === 'never') return 1;
        return Number(b) - Number(a);
      });
      orderedRecencyKeys.forEach((recencyKey) => {
        const group = recencyGroups.get(recencyKey).sort((a, b) =>
          b.createdAt - a.createdAt ||
          a.tieBreaker - b.tieBreaker ||
          a.wordKey.localeCompare(b.wordKey)
        );
        let left = 0;
        let right = group.length - 1;
        let takeNewest = true;
        while (left <= right) {
          if (takeNewest) result.push(group[left++]);
          else result.push(group[right--]);
          takeNewest = !takeNewest;
        }
      });
    });
    return result;
  }

  function buildQuizSelectionPlan(words, requestedCount, options = {}) {
    const source = Array.isArray(words) ? words : [];
    const getWordKey = typeof options.getWordKey === 'function'
      ? options.getWordKey
      : (word) => cleanText(word?.wordKey || word?.id || word?.word);
    const getState = typeof options.getState === 'function'
      ? options.getState
      : (word) => word || {};
    const getDueInfo = typeof options.getDueInfo === 'function'
      ? options.getDueInfo
      : () => ({ isDue: false, overdueMs: 0, lastQuizAt: 0 });
    const history = Array.isArray(options.history) ? options.history : [];
    const now = Math.max(1, Number(options.now) || Date.now());
    const seed = cleanText(options.seed) || String(now);
    const limit = Math.max(0, Math.min(Math.floor(Number(requestedCount) || 0), source.length));
    const seen = new Set();
    const allCandidates = [];

    source.forEach((word, index) => {
      const wordKey = getWordKey(word) || `${word?.id || index}`;
      if (!wordKey || seen.has(wordKey)) return;
      seen.add(wordKey);
      const state = getState(word) || {};
      const due = getDueInfo(word, state, now) || {};
      const trustedSeenCount = Math.max(0, Number(state.quiz_seen_count ?? word?.quiz_seen_count) || 0);
      const historyIndex = recentSessionIndex(wordKey, history);
      const recentRank = historyIndex < 0 ? -1 : historyIndex;
      const createdAt = toTimestamp(word?.createdAt || word?.timestamp || word?.addedAt);
      const status = cleanText(state.mastery_status || word?.mastery_status) || 'New';
      const importantReview = status !== 'New' && (
        due.isDue === true ||
        status === 'Reviewing' ||
        Number(word?.forgetCount) > 0 ||
        (state.mastered_once === true && status !== 'Mastered')
      );
      const fresh = trustedSeenCount < 2;
      allCandidates.push({
        word,
        wordKey,
        index,
        state,
        due,
        status,
        trustedSeenCount,
        recentSessionIndex: recentRank,
        createdAt,
        importantReview,
        fresh,
        tieBreaker: stableHash(`${seed}:${wordKey}`),
      });
    });

    if (!limit) {
      return Object.freeze({
        version: SELECTION_PLAN_VERSION,
        requestedCount,
        candidateCount: allCandidates.length,
        selectedCount: 0,
        quotas: selectionQuotas(1, 0),
        pools: { review: [], fresh: [], coverage: [] },
        selected: [],
        deck: [],
      });
    }

    const reviewPool = allCandidates.filter((item) => item.importantReview).sort((a, b) =>
      Number(b.due?.isDue) - Number(a.due?.isDue) ||
      (Number(b.due?.overdueMs) || 0) - (Number(a.due?.overdueMs) || 0) ||
      (Number(b.word?.forgetCount) || 0) - (Number(a.word?.forgetCount) || 0) ||
      b.trustedSeenCount - a.trustedSeenCount ||
      compareLeastRecentlySelected(a, b) ||
      a.tieBreaker - b.tieBreaker
    );
    const freshPool = alternateFreshOrder(allCandidates.filter((item) => item.fresh));
    const coveragePool = [...allCandidates].sort((a, b) =>
      compareLeastRecentlySelected(a, b) ||
      (Number(a.due?.lastQuizAt) || 0) - (Number(b.due?.lastQuizAt) || 0) ||
      (Number(b.word?.forgetCount) || 0) - (Number(a.word?.forgetCount) || 0) ||
      a.tieBreaker - b.tieBreaker
    );
    const quotas = selectionQuotas(limit, reviewPool.length);
    const selected = [];
    const picked = new Set();

    const take = (pool, count, category, reason) => {
      let added = 0;
      for (const item of pool) {
        if (added >= count || selected.length >= limit) break;
        if (picked.has(item.wordKey)) continue;
        picked.add(item.wordKey);
        selected.push({ ...item, selectionCategory: category, selectionReason: reason });
        added += 1;
      }
      return added;
    };

    const reviewAdded = take(reviewPool, quotas.review, 'review', 'مراجعة مهمة أو مستحقة');
    const freshAdded = take(freshPool, quotas.fresh, 'fresh', 'ظهور موثوق قليل');
    const coverageAdded = take(coveragePool, quotas.coverage, 'coverage', 'تغطية وتنويع');
    const deficits = {
      review: Math.max(0, quotas.review - reviewAdded),
      fresh: Math.max(0, quotas.fresh - freshAdded),
      coverage: Math.max(0, quotas.coverage - coverageAdded),
    };
    take(freshPool, deficits.review, 'fresh', 'تعويض نقص المراجعة');
    take(reviewPool, deficits.fresh, 'review', 'تعويض نقص الكلمات قليلة الظهور');
    take(reviewPool, deficits.coverage, 'review', 'تعويض نقص التغطية');
    take(freshPool, limit - selected.length, 'fresh', 'ملء المقاعد المتبقية');
    take(coveragePool, limit - selected.length, 'coverage', 'ملء المقاعد المتبقية');

    const categoryOrder = ['review', 'fresh', 'coverage'];
    const queues = Object.fromEntries(categoryOrder.map((category) => [
      category,
      selected.filter((item) => item.selectionCategory === category),
    ]));
    const interleaved = [];
    while (interleaved.length < selected.length) {
      let progressed = false;
      categoryOrder.forEach((category) => {
        const next = queues[category].shift();
        if (!next) return;
        interleaved.push(next);
        progressed = true;
      });
      if (!progressed) break;
    }

    return Object.freeze({
      version: SELECTION_PLAN_VERSION,
      requestedCount,
      candidateCount: allCandidates.length,
      selectedCount: interleaved.length,
      quotas,
      pools: Object.freeze({
        review: reviewPool.map((item) => item.wordKey),
        fresh: freshPool.map((item) => item.wordKey),
        coverage: coveragePool.map((item) => item.wordKey),
      }),
      selected: interleaved,
      deck: interleaved.map((item) => item.word),
    });
  }

  function shuffleWithRandom(items, random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function matchingBoardSizes(total) {
    const count = Math.max(0, Math.floor(Number(total) || 0));
    if (!count) return [];
    if (count <= 7) return [count];
    const boardCount = Math.ceil(count / 6);
    const base = Math.floor(count / boardCount);
    const extra = count % boardCount;
    return Array.from({ length: boardCount }, (_, index) => base + (index < extra ? 1 : 0));
  }

  function createMatchingState(words, options = {}) {
    const source = Array.isArray(words) ? words : [];
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const sizes = matchingBoardSizes(source.length);
    const boards = [];
    let offset = 0;
    sizes.forEach((size, boardIndex) => {
      const boardWords = source.slice(offset, offset + size);
      offset += size;
      boards.push({
        id: `matching-board-${boardIndex + 1}`,
        wordIds: boardWords.map((word) => String(word.id)),
        meaningOrder: shuffleWithRandom(boardWords.map((word) => String(word.id)), random),
        selections: {},
        firstAttemptSelections: null,
        firstAttemptResults: null,
        firstAttemptSubmittedAt: 0,
        correctionChecks: 0,
        incorrectWordIds: [],
        phase: 'pairing',
      });
    });
    return {
      version: MATCHING_STATE_VERSION,
      boardIndex: 0,
      boards,
      pendingWordId: '',
      completedWordCount: 0,
    };
  }

  function currentMatchingBoard(state) {
    return state?.boards?.[Math.max(0, Number(state.boardIndex) || 0)] || null;
  }

  function assignMatchingPair(state, wordId, meaningWordId) {
    const board = currentMatchingBoard(state);
    const word = cleanText(wordId);
    const meaning = cleanText(meaningWordId);
    if (!board || !word || !meaning || board.phase === 'revealed' || board.phase === 'complete') return false;
    if (!board.wordIds.includes(word) || !board.meaningOrder.includes(meaning)) return false;
    if (board.firstAttemptResults && board.firstAttemptResults[word] === true) return false;
    const lockedMeaningOwner = Object.keys(board.selections).find((existingWordId) =>
      board.selections[existingWordId] === meaning &&
      existingWordId !== word &&
      board.firstAttemptResults?.[existingWordId] === true
    );
    if (lockedMeaningOwner) return false;
    Object.keys(board.selections).forEach((existingWordId) => {
      if (board.selections[existingWordId] === meaning && existingWordId !== word) {
        if (!board.firstAttemptResults || board.firstAttemptResults[existingWordId] !== true) {
          delete board.selections[existingWordId];
        }
      }
    });
    board.selections[word] = meaning;
    return true;
  }

  function submitMatchingBoard(state, answeredAt = Date.now()) {
    const board = currentMatchingBoard(state);
    if (!board) return { accepted: false, reason: 'missing-board', firstAttemptResults: [] };
    const complete = board.wordIds.every((wordId) => Boolean(board.selections[wordId]));
    if (!complete) return { accepted: false, reason: 'incomplete-pairs', firstAttemptResults: [] };
    const correctness = Object.fromEntries(board.wordIds.map((wordId) => [
      wordId,
      board.selections[wordId] === wordId,
    ]));

    if (!board.firstAttemptResults) {
      board.firstAttemptSelections = { ...board.selections };
      board.firstAttemptResults = correctness;
      board.firstAttemptSubmittedAt = Math.max(1, Number(answeredAt) || Date.now());
      board.incorrectWordIds = board.wordIds.filter((wordId) => correctness[wordId] !== true);
      const results = board.wordIds.map((wordId) => ({
        wordId,
        correct: correctness[wordId] === true,
        answeredAt: board.firstAttemptSubmittedAt,
        firstAttempt: true,
      }));
      if (!board.incorrectWordIds.length) {
        board.phase = 'complete';
      } else {
        board.phase = 'correction';
        board.incorrectWordIds.forEach((wordId) => { delete board.selections[wordId]; });
      }
      return {
        accepted: true,
        reason: board.phase === 'complete' ? 'first-attempt-correct' : 'first-attempt-recorded',
        firstAttemptResults: results,
        incorrectWordIds: [...board.incorrectWordIds],
        phase: board.phase,
      };
    }

    board.correctionChecks += 1;
    const remainingIncorrect = board.incorrectWordIds.filter((wordId) => board.selections[wordId] !== wordId);
    if (!remainingIncorrect.length) {
      board.phase = 'complete';
      return { accepted: true, reason: 'correction-complete', firstAttemptResults: [], phase: board.phase };
    }
    board.phase = 'revealed';
    remainingIncorrect.forEach((wordId) => { board.selections[wordId] = wordId; });
    return {
      accepted: true,
      reason: 'correction-revealed',
      firstAttemptResults: [],
      incorrectWordIds: remainingIncorrect,
      phase: board.phase,
    };
  }

  function advanceMatchingBoard(state) {
    const board = currentMatchingBoard(state);
    if (!board || !['complete', 'revealed'].includes(board.phase)) return false;
    state.completedWordCount += board.wordIds.length;
    if (state.boardIndex >= state.boards.length - 1) return false;
    state.boardIndex += 1;
    state.pendingWordId = '';
    return true;
  }

  const API = Object.freeze({
    SELECTION_PLAN_VERSION,
    MATCHING_STATE_VERSION,
    parseSourceScope,
    resolveQuizCandidates,
    getQuizStartEligibility,
    createSourceRequestCoordinator,
    isSourceResponseCurrent,
    buildQuizSelectionPlan,
    matchingBoardSizes,
    createMatchingState,
    currentMatchingBoard,
    assignMatchingPair,
    submitMatchingBoard,
    advanceMatchingBoard,
  });

  Object.defineProperty(root, 'LootLinguaQuizCore', {
    value: API,
    configurable: true,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
