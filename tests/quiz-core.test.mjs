import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const coreSource = await readFile(new URL('../js/quiz-core.js', import.meta.url), 'utf8');

function loadCore() {
  const context = vm.createContext({ Object, Array, Math, Date, Set, Map, String, Number, Boolean });
  new vm.Script(coreSource).runInContext(context);
  return context.LootLinguaQuizCore;
}

const core = loadCore();

function makeWords(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `word-${index + 1}`,
    word: `word ${index + 1}`,
    meaning: `meaning ${index + 1}`,
    wordKey: `word-${index + 1}`,
    createdAt: 1_700_000_000_000 + index,
    quiz_seen_count: 0,
    mastery_status: 'New',
    ...overrides,
  }));
}

test('private-world context is attached before lifecycle eligibility filtering', () => {
  const rawWords = makeWords(12).map(({ customWorldId, ...word }) => word);
  const snapshot = core.resolveQuizCandidates({
    scope: 'custom:world-a',
    ownerId: 'account-a',
    rawWords,
    normalizeCandidate: (word) => ({ ...word, wordKey: `${word.customWorldId}:${word.id}` }),
    wordKeyOf: (word) => word.wordKey,
    isEligible: (word) => word.customWorldId === 'world-a',
  });

  assert.equal(snapshot.rawCount, 12);
  assert.equal(snapshot.candidateCount, 12);
  assert.ok(snapshot.candidates.every((word) => word.customWorldId === 'world-a'));
  assert.equal(core.resolveQuizCandidates({ scope: 'custom:world-a', rawWords: [] }).candidateCount, 0);
});

test('empty, invalid, and normalized-duplicate records report the true eligible count', () => {
  const empty = core.resolveQuizCandidates({ scope: 'personal', rawWords: [] });
  const mixed = core.resolveQuizCandidates({
    scope: 'personal',
    rawWords: [
      { id: 'valid', word: 'loot', meaning: 'غنيمة', wordKey: 'loot' },
      { id: 'duplicate', word: 'Loot', meaning: 'نهب', wordKey: 'loot' },
      { id: 'missing-meaning', word: 'map', meaning: '', wordKey: 'map' },
      null,
      { id: 'lifecycle', word: 'moved', meaning: 'منقول', wordKey: 'moved', allowed: false },
    ],
    wordKeyOf: (word) => word.wordKey,
    isEligible: (word) => word.allowed !== false,
  });
  assert.equal(empty.candidateCount, 0);
  assert.equal(mixed.rawCount, 5);
  assert.equal(mixed.candidateCount, 1);
  assert.equal(
    mixed.excluded.map((item) => item.reason).sort().join(','),
    'invalid-record,lifecycle-ineligible,missing-learnable-content,normalized-duplicate',
  );
});

test('guest and account private worlds resolve their own full local/cloud-loaded records', () => {
  const guest = core.resolveQuizCandidates({
    scope: 'custom:guest-world',
    ownerId: 'guest',
    rawWords: makeWords(6),
    wordKeyOf: (word) => `${word.customWorldId}:${word.wordKey}`,
    isEligible: (word, source) => word.customWorldId === source.sourceId,
  });
  const account = core.resolveQuizCandidates({
    scope: 'custom:account-world',
    ownerId: 'uid-account',
    status: 'ready',
    rawWords: makeWords(12),
    wordKeyOf: (word) => `${word.customWorldId}:${word.wordKey}`,
    isEligible: (word, source) => word.customWorldId === source.sourceId,
  });
  assert.equal(guest.ownerId, 'guest');
  assert.equal(guest.candidateCount, 6);
  assert.equal(account.ownerId, 'uid-account');
  assert.equal(account.status, 'ready');
  assert.equal(account.candidateCount, 12);
});

test('source isolation keeps the same normalized word valid in World A and World B', () => {
  const shared = [{ id: 'shared', word: 'loot', meaning: 'غنيمة', wordKey: 'loot' }];
  const worldA = core.resolveQuizCandidates({ scope: 'custom:a', rawWords: shared, wordKeyOf: (word) => `${word.customWorldId}:${word.wordKey}` });
  const worldB = core.resolveQuizCandidates({ scope: 'custom:b', rawWords: shared, wordKeyOf: (word) => `${word.customWorldId}:${word.wordKey}` });
  assert.equal(worldA.candidateCount, 1);
  assert.equal(worldB.candidateCount, 1);
  assert.notEqual(worldA.candidates[0].wordKey, worldB.candidates[0].wordKey);
});

test('refresh keeps a loaded source count and a new session sees newly added words without mutating the old plan', () => {
  const originalWords = makeWords(10);
  const firstSnapshot = core.resolveQuizCandidates({ scope: 'personal', rawWords: originalWords, wordKeyOf: (word) => word.wordKey });
  const frozenPlan = core.buildQuizSelectionPlan(firstSnapshot.candidates, 5, {
    seed: 'frozen-session',
    getWordKey: (word) => word.wordKey,
    getState: (word) => word,
  });
  const frozenIds = frozenPlan.deck.map((word) => word.id).join(',');
  const refreshed = core.resolveQuizCandidates({ scope: 'personal', rawWords: originalWords, wordKeyOf: (word) => word.wordKey });
  const expanded = core.resolveQuizCandidates({
    scope: 'personal',
    rawWords: [...originalWords, ...makeWords(2).map((word, index) => ({ ...word, id: `new-${index}`, word: `new ${index}`, meaning: `new meaning ${index}`, wordKey: `new-${index}` }))],
    wordKeyOf: (word) => word.wordKey,
  });
  assert.equal(refreshed.candidateCount, 10, 'refresh cannot turn a loaded source into zero');
  assert.equal(expanded.candidateCount, 12, 'the next resolver snapshot sees newly added words');
  assert.equal(frozenPlan.deck.map((word) => word.id).join(','), frozenIds, 'the active session plan remains frozen');
});

test('resolver reports the true seven candidates while the existing requested minimum still blocks start', () => {
  const snapshot = core.resolveQuizCandidates({
    scope: 'personal',
    rawWords: makeWords(7),
    wordKeyOf: (word) => word.wordKey,
  });
  const plan = core.buildQuizSelectionPlan(snapshot.candidates, 7, {
    seed: 'minimum-regression',
    getWordKey: (word) => word.wordKey,
    getState: (word) => word,
  });
  const eligibility = core.getQuizStartEligibility(snapshot.candidateCount, 10, { mode: 'timeAttack' });

  assert.equal(snapshot.candidateCount, 7, 'picker must display the real eligible count');
  assert.equal(plan.candidateCount, 7, 'final resolved candidate pool must remain seven');
  assert.equal(plan.selectedCount, 7, 'the resolver can expose all seven without changing start semantics');
  assert.deepEqual(
    { allowed: eligibility.allowed, reason: eligibility.reason, available: eligibility.available, required: eligibility.required },
    { allowed: false, reason: 'below-required-count', available: 7, required: 10 },
  );
});

test('difficult words stay starred words from the personal dictionary only', () => {
  const snapshot = core.resolveQuizCandidates({
    scope: 'starred',
    rawWords: [
      ...makeWords(2, { starred: true }),
      ...makeWords(2, { starred: false }).map((word, index) => ({ ...word, id: `plain-${index}`, wordKey: `plain-${index}` })),
    ],
    wordKeyOf: (word) => word.wordKey,
  });
  assert.equal(snapshot.sourceType, 'difficult');
  assert.equal(snapshot.candidateCount, 2);
  assert.ok(snapshot.candidates.every((word) => word.starred === true));
  assert.equal(core.getQuizStartEligibility(snapshot.candidateCount, 2).allowed, true);
  const empty = core.resolveQuizCandidates({ scope: 'starred', rawWords: makeWords(5, { starred: false }) });
  assert.equal(empty.candidateCount, 0);
  assert.equal(core.getQuizStartEligibility(empty.candidateCount, 5).reason, 'empty-source');
});

test('matching resolver removes normalized word duplicates and ambiguous meanings', () => {
  const snapshot = core.resolveQuizCandidates({
    scope: 'personal',
    mode: 'matching',
    rawWords: [
      { id: '1', word: 'loot', meaning: 'غنيمة', wordKey: 'loot' },
      { id: '2', word: ' Loot ', meaning: 'نهب', wordKey: 'loot' },
      { id: '3', word: 'treasure', meaning: ' غنيمة ', wordKey: 'treasure' },
      { id: '4', word: 'map', meaning: 'خريطة', wordKey: 'map' },
    ],
    wordKeyOf: (word) => word.wordKey,
  });
  assert.equal(snapshot.candidates.map((word) => word.id).join(','), '1,4');
  assert.equal(snapshot.excluded.map((item) => item.reason).join(','), 'normalized-duplicate,ambiguous-matching-meaning');
});

test('stale private-world response cannot overwrite a new owner/source generation', async () => {
  const coordinator = core.createSourceRequestCoordinator();
  let visible = { ownerId: 'account-a', scope: 'custom:world-a', count: null, status: 'loading', wordIds: [] };
  let releaseOldRequest;
  const oldResponse = new Promise((resolve) => { releaseOldRequest = resolve; });
  const oldToken = coordinator.begin('account-a', 'custom:world-a');
  const applyingOldRequest = oldResponse.then((response) => {
    if (!core.isSourceResponseCurrent({
      coordinator,
      token: oldToken,
      response,
      currentOwnerId: visible.ownerId,
    })) return false;
    visible = {
      ownerId: response.ownerId,
      scope: `custom:${response.sourceId}`,
      count: response.words.length,
      status: 'ready',
      wordIds: response.words.map((word) => word.id),
    };
    return true;
  });

  const newToken = coordinator.begin('account-b', 'custom:world-b');
  visible = { ownerId: 'account-b', scope: 'custom:world-b', count: 5, status: 'ready', wordIds: ['b1', 'b2', 'b3', 'b4', 'b5'] };
  releaseOldRequest({ ownerId: 'account-a', sourceId: 'world-a', words: makeWords(12) });

  assert.equal(await applyingOldRequest, false);
  assert.equal(coordinator.isCurrent(oldToken), false);
  assert.equal(coordinator.isCurrent(newToken), true);
  assert.deepEqual(visible, {
    ownerId: 'account-b',
    scope: 'custom:world-b',
    count: 5,
    status: 'ready',
    wordIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
  }, 'the stale words cannot enter the new candidate snapshot');

  assert.equal(core.isSourceResponseCurrent({
    coordinator,
    token: newToken,
    currentOwnerId: 'account-b',
    response: { ownerId: 'account-a', sourceId: 'world-b' },
  }), false, 'a response cannot cross owner IDs');
  assert.equal(core.isSourceResponseCurrent({
    coordinator,
    token: newToken,
    currentOwnerId: 'account-b',
    response: { ownerId: 'account-b', sourceId: 'world-a' },
  }), false, 'a response cannot cross source IDs');

  const failingOldToken = coordinator.begin('account-a', 'custom:world-a');
  const activeBeforeLogout = coordinator.begin('account-b', 'custom:world-b');
  if (coordinator.isCurrent(failingOldToken)) visible = { ...visible, status: 'error' };
  assert.equal(visible.status, 'ready', 'a stale rejection cannot replace the new source loading/error state');

  coordinator.invalidate();
  assert.equal(coordinator.isCurrent(activeBeforeLogout), false, 'logout invalidates the active generation too');
});

test('selection is deterministic for the same frozen input and seed', () => {
  const words = makeWords(20);
  const options = {
    now: 1_800_000_000_000,
    seed: 'same-session',
    getWordKey: (word) => word.wordKey,
    getState: (word) => word,
  };
  const first = core.buildQuizSelectionPlan(words, 10, options);
  const second = core.buildQuizSelectionPlan(words, 10, options);
  assert.deepEqual(first.deck.map((word) => word.id), second.deck.map((word) => word.id));
});

test('few-exposure coverage prefers never-recent and least-recent words deterministically', () => {
  const words = makeWords(6, { quiz_seen_count: 1 });
  const history = [
    { wordKeys: ['word-1'] },
    { wordKeys: ['word-2'] },
    { wordKeys: ['word-3'] },
  ];
  const plan = core.buildQuizSelectionPlan(words, 3, {
    seed: 'recency-order',
    history,
    getWordKey: (word) => word.wordKey,
    getState: (word) => word,
  });
  const freshOrder = plan.pools.fresh;
  assert.ok(freshOrder.slice(0, 3).every((key) => ['word-4', 'word-5', 'word-6'].includes(key)));
  assert.ok(freshOrder.indexOf('word-3') < freshOrder.indexOf('word-2'));
  assert.ok(freshOrder.indexOf('word-2') < freshOrder.indexOf('word-1'));
});

test('eligible unseen words cannot starve across unchanged-source sessions', () => {
  const reviews = makeWords(30, {
    mastery_status: 'Reviewing',
    quiz_seen_count: 8,
    forgetCount: 2,
  }).map((word, index) => ({ ...word, id: `review-${index}`, wordKey: `review-${index}` }));
  const unseen = makeWords(12).map((word, index) => ({ ...word, id: `unseen-${index}`, wordKey: `unseen-${index}` }));
  const words = [...reviews, ...unseen];
  const initiallyUnseen = new Set(unseen.map((word) => word.wordKey));
  const selectedAtSession = new Map();
  let history = [];

  for (let session = 1; session <= 12 && selectedAtSession.size < initiallyUnseen.size; session += 1) {
    const remainingBefore = [...initiallyUnseen].filter((key) => !selectedAtSession.has(key));
    const plan = core.buildQuizSelectionPlan(words, 10, {
      now: 1_800_000_000_000 + session,
      seed: `session-${session}`,
      history,
      getWordKey: (word) => word.wordKey,
      getState: (word) => word,
      getDueInfo: (word) => ({ isDue: word.mastery_status === 'Reviewing', overdueMs: 50_000 }),
    });
    const selectedKeys = plan.selected.map((item) => item.wordKey);
    const newlySelectedUnseen = selectedKeys.filter((key) => remainingBefore.includes(key));
    assert.ok(newlySelectedUnseen.length >= 1, `session ${session} must select a still-unseen word`);
    assert.ok(
      plan.selected.filter((item) => item.selectionCategory === 'review').length >= 6,
      'critical review backlog must retain its majority quota',
    );
    newlySelectedUnseen.forEach((key) => {
      selectedAtSession.set(key, session);
      const word = words.find((item) => item.wordKey === key);
      word.quiz_seen_count += 1;
    });
    history = [{ wordKeys: selectedKeys }, ...history].slice(0, 20);
  }

  assert.equal(selectedAtSession.size, initiallyUnseen.size);
  assert.ok(Math.max(...selectedAtSession.values()) <= 4, 'all 12 unseen words are selected within a deterministic finite bound');
});

test('matching records only first-attempt evidence and correction cannot improve it', () => {
  const words = makeWords(5);
  const state = core.createMatchingState(words, { random: () => 0.5 });
  const ids = state.boards[0].wordIds;
  core.assignMatchingPair(state, ids[0], ids[0]);
  core.assignMatchingPair(state, ids[1], ids[2]);
  core.assignMatchingPair(state, ids[2], ids[1]);
  core.assignMatchingPair(state, ids[3], ids[3]);
  core.assignMatchingPair(state, ids[4], ids[4]);

  const first = core.submitMatchingBoard(state, 12345);
  assert.deepEqual(first.firstAttemptResults.map((result) => result.correct), [true, false, false, true, true]);
  assert.equal(first.phase, 'correction');

  core.assignMatchingPair(state, ids[1], ids[1]);
  core.assignMatchingPair(state, ids[2], ids[2]);
  const correction = core.submitMatchingBoard(state, 99999);
  assert.equal(correction.reason, 'correction-complete');
  assert.equal(correction.firstAttemptResults.length, 0);
  assert.equal(state.boards[0].firstAttemptResults[ids[1]], false);
  assert.equal(state.boards[0].firstAttemptSubmittedAt, 12345);
});

test('matching session state survives a JSON resume without changing first-attempt evidence', () => {
  const state = core.createMatchingState(makeWords(5), { random: () => 0.25 });
  const ids = state.boards[0].wordIds;
  ids.forEach((wordId, index) => core.assignMatchingPair(state, wordId, ids[(index + 1) % ids.length]));
  core.submitMatchingBoard(state, 555);
  const resumed = JSON.parse(JSON.stringify(state));
  assert.equal(JSON.stringify(resumed.boards[0].firstAttemptResults), JSON.stringify(state.boards[0].firstAttemptResults));
  assert.equal(JSON.stringify(resumed.boards[0].firstAttemptSelections), JSON.stringify(state.boards[0].firstAttemptSelections));
  assert.equal(resumed.boards[0].phase, 'correction');
});
