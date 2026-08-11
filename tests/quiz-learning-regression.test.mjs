import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [storageSource, srsSource, quizSource, runtimeSource, scriptSource, notificationStoreSource] = await Promise.all([
  readFile(new URL('../js/storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/srs.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/script.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/notification-store.js', import.meta.url), 'utf8'),
]);

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `Missing start marker: ${start}`);
  assert.ok(to > from, `Missing end marker: ${end}`);
  return source.slice(from, to);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
}

function makeMasteryState(index = 1) {
  return {
    mastery_status: index >= 3 ? 'Mastered' : index >= 2 ? 'Reviewing' : 'Learning',
    mastery_streak: Math.min(3, index),
    last_recalled_at: 1_720_000_000_000 + index,
    first_recalled_at: 1_710_000_000_000,
    last_recall_day: '2026-08-11',
    last_recall_session_id: 'matching-session',
    last_quizzed_at: 1_720_000_000_000 + index,
    quiz_seen_count: index,
    mastered_once: index >= 3,
    firstMasteredAt: index >= 3 ? 1_720_000_000_000 : null,
    hasEarnedMasteryXP: index >= 3,
    earnedTransitions: index >= 2 ? ['new_learning', 'learning_reviewing'] : ['new_learning'],
    remasteryAwardCount: 0,
    xpEconomyVersion: 2,
  };
}

function createMasteryHarness({ wordCount = 1000, withWorld = true } = {}) {
  const listeners = new Map();
  const stats = {
    masteryReads: 0,
    masteryWrites: 0,
    personalReads: 0,
    personalWrites: 0,
    worldReads: 0,
    worldWrites: 0,
    sourceInvalidations: 0,
    cloudBatches: 0,
    guestDirtyWrites: 0,
  };
  const personalByOwner = new Map();
  const masteryByOwner = new Map();
  const worldsByOwner = new Map();
  const words = Array.from({ length: wordCount }, (_, index) => ({
    id: `word-${index}`,
    word: `term-${index}`,
    meaning: `meaning-${index}`,
    forgetCount: index % 3,
    ...makeMasteryState(0),
  }));
  personalByOwner.set('uid-a', words);
  masteryByOwner.set('uid-a', {});
  worldsByOwner.set('uid-a:world-a', withWorld ? [clone(words[0]), clone(words[1])] : []);

  const window = {
    auth: { currentUser: { uid: 'uid-a' } },
    words: [],
    LootLinguaOperations: { diagnostic() {} },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent() {},
  };
  let sourceBatchDepth = 0;
  let sourceBatchChanged = false;
  window.beginQuizSourceDataChangeBatch = () => {
    sourceBatchDepth += 1;
    return { depth: sourceBatchDepth };
  };
  window.endQuizSourceDataChangeBatch = () => {
    sourceBatchDepth = Math.max(0, sourceBatchDepth - 1);
    if (sourceBatchDepth === 0 && sourceBatchChanged) {
      sourceBatchChanged = false;
      stats.sourceInvalidations += 1;
    }
  };
  window.commitQuizLearningBatchToCloud = async (payload) => {
    stats.cloudBatches += 1;
    assert.equal(payload.ownerId, window.auth.currentUser.uid);
    return {
      saved: true,
      firestoreWrites: 1 + payload.personalWords.length + payload.customWords.length,
    };
  };

  const context = vm.createContext({
    window,
    customWorlds: withWorld ? [{ id: 'world-a' }] : [],
    activeCustomWorldId: '',
    currentQuizSource: 'personal',
    SRS_STATUSES: ['New', 'Learning', 'Reviewing', 'Mastered'],
    XP_ECONOMY_VERSION: 2,
    Date,
    JSON,
    Map,
    Set,
    Object,
    Number,
    Array,
    Math,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    getStorageUserId(uid) { return uid || window.auth.currentUser?.uid || 'guest'; },
    getWordMasteryKey(wordOrText) {
      return String(typeof wordOrText === 'object' ? wordOrText?.word || wordOrText?.text || '' : wordOrText || '')
        .trim().toLowerCase();
    },
    applyMasteryStateToWord(word, state) {
      return { ...word, ...state };
    },
    readSharedWordMasteryStore(uid) {
      stats.masteryReads += 1;
      return clone(masteryByOwner.get(uid || window.auth.currentUser?.uid || 'guest') || {});
    },
    writeSharedWordMasteryStore(entries, uid) {
      stats.masteryWrites += 1;
      const owner = uid || window.auth.currentUser?.uid || 'guest';
      if (owner === 'guest') stats.guestDirtyWrites += 1;
      masteryByOwner.set(owner, clone(entries));
    },
    readWordsFromStorage(_type, uid) {
      stats.personalReads += 1;
      return clone(personalByOwner.get(uid || window.auth.currentUser?.uid || 'guest') || []);
    },
    writeWordsToStorage(next, _type, uid) {
      stats.personalWrites += 1;
      personalByOwner.set(uid || window.auth.currentUser?.uid || 'guest', clone(next));
      sourceBatchChanged = true;
      return true;
    },
    readCustomWorldWordsFromStorage(worldId, uid) {
      stats.worldReads += 1;
      return clone(worldsByOwner.get(`${uid || window.auth.currentUser?.uid || 'guest'}:${worldId}`) || []);
    },
    writeCustomWorldWordsToStorage(worldId, next, uid) {
      stats.worldWrites += 1;
      worldsByOwner.set(`${uid || window.auth.currentUser?.uid || 'guest'}:${worldId}`, clone(next));
      sourceBatchChanged = true;
      return true;
    },
    isEditableDictionaryView() { return false; },
    isCustomWorldView() { return false; },
    hasSignedInUser() { return Boolean(window.auth.currentUser); },
    render() {},
  });

  const masteryCore = between(srsSource, 'function normalizeMasteryStatus', 'function getWordMasteryStorageKey');
  const batchCore = between(srsSource, 'function masteryStateFingerprint', 'function propagateMasteryStateAcrossAccount');
  const snapshotCore = between(srsSource, 'let globalMasterySnapshotCache', 'function getQuizExposureHistoryStorageKey');
  new vm.Script(`${masteryCore}\n${batchCore}\n${snapshotCore}`)
    .runInContext(context);

  return {
    window,
    stats,
    listeners,
    personalByOwner,
    masteryByOwner,
    worldsByOwner,
  };
}

test('1000-word account Matching commit uses bounded full passes and one source invalidation', async () => {
  const harness = createMasteryHarness();
  const sourceWords = harness.personalByOwner.get('uid-a').slice(0, 10);
  const transitions = sourceWords.map((word, index) => ({
    word: { ...word, quizSource: 'personal' },
    result: { correct: true },
    update: { state: makeMasteryState((index % 3) + 1) },
  }));

  const result = await harness.window.applyQuizLearningBatch(transitions, { source: 'personal' });
  assert.equal(result.fullDatasetPasses, 2, 'one personal pass plus one private-world pass');
  assert.equal(harness.stats.masteryReads, 1);
  assert.equal(harness.stats.masteryWrites, 1);
  assert.equal(harness.stats.personalReads, 1);
  assert.equal(harness.stats.personalWrites, 1);
  assert.equal(harness.stats.worldReads, 1);
  assert.equal(harness.stats.worldWrites, 1);
  assert.equal(harness.stats.sourceInvalidations, 1);
  assert.equal(harness.stats.cloudBatches, 1);
  assert.equal(harness.stats.guestDirtyWrites, 0);
  assert.equal(harness.personalByOwner.get('uid-a').length, 1000);
  assert.equal(harness.personalByOwner.get('uid-a')[9].mastery_streak, 1);
});

test('duplicate normalized words converge to one canonical mastery state without duplicate local passes', async () => {
  const harness = createMasteryHarness({ wordCount: 20, withWorld: false });
  const words = harness.personalByOwner.get('uid-a');
  words[1].word = words[0].word.toUpperCase();
  const transitions = [
    { word: { ...words[0], quizSource: 'personal' }, result: { correct: true }, update: { state: makeMasteryState(1) } },
    { word: { ...words[1], quizSource: 'personal' }, result: { correct: true }, update: { state: makeMasteryState(2) } },
  ];
  await harness.window.applyQuizLearningBatch(transitions, { source: 'personal' });
  const saved = harness.personalByOwner.get('uid-a');
  assert.equal(saved[0].mastery_streak, 2);
  assert.equal(saved[1].mastery_streak, 2);
  assert.equal(Object.keys(harness.masteryByOwner.get('uid-a')).length, 1);
  assert.equal(harness.stats.personalReads, 1);
  assert.equal(harness.stats.personalWrites, 1);
});

test('mastery snapshots are true diffs and their cache is isolated across UIDs', () => {
  const harness = createMasteryHarness({ wordCount: 100, withWorld: false });
  const state = makeMasteryState(2);
  harness.window.applyGlobalWordMasterySnapshot({ 'term-0': state });
  const firstWrites = harness.stats.masteryWrites + harness.stats.personalWrites;
  harness.window.applyGlobalWordMasterySnapshot({ 'term-0': clone(state) });
  assert.equal(harness.stats.masteryWrites + harness.stats.personalWrites, firstWrites, 'identical callback is idempotent');

  harness.personalByOwner.set('uid-b', [clone(harness.personalByOwner.get('uid-a')[0])]);
  harness.masteryByOwner.set('uid-b', {});
  harness.window.auth.currentUser = { uid: 'uid-b' };
  harness.listeners.get('lootlingua:auth-state')?.({ detail: { user: { uid: 'uid-b' } } });
  harness.window.applyGlobalWordMasterySnapshot({ 'term-0': state });
  assert.equal(harness.masteryByOwner.get('uid-b')['term-0'].mastery_streak, 2);
  assert.equal(harness.masteryByOwner.get('uid-a')['term-0'].mastery_streak, 2);
});

function createCommitHarness(mode = 'matching', correctness = Array(10).fill(true)) {
  const words = correctness.map((_correct, index) => ({
    id: `word-${index}`,
    word: `term-${index}`,
    forgetCount: 0,
    quizSource: 'personal',
  }));
  const stats = { rewardBatches: 0, learningBatches: 0, projections: 0, evidenceFallbacks: 0 };
  const evidence = { recorded: correctness.filter(Boolean).length, duplicate: 0, ineligible: correctness.filter(Boolean).length };
  const window = {
    auth: { currentUser: { uid: 'uid-a' } },
    LootLinguaOperations: { diagnostic() {} },
    LootLinguaJourneyCloud: {
      async recordQuizEvidenceBatch() { stats.evidenceFallbacks += 1; return evidence; },
      async projectQuizEvidenceReadiness(summary) { stats.projections += 1; return { ...summary, readinessError: null }; },
    },
    async applyQuizLearningBatch(entries) {
      stats.learningBatches += 1;
      assert.equal(entries.length, correctness.length);
      return { fullDatasetPasses: 1, localWordWrites: 1 };
    },
    dispatchEvent() {},
  };
  const context = vm.createContext({
    window,
    activeQuizSession: { id: 'session-a', mode, source: 'personal', words },
    quizSessionResults: correctness.map((correct, index) => ({ wordId: `word-${index}`, correct, answeredAt: index + 1 })),
    currentQuizSource: 'personal',
    isVerifiedQuizMode(value) { return ['matching', 'timeAttack', 'scramble'].includes(value); },
    computeSrsUpdate(_word, correct) {
      return { state: makeMasteryState(correct ? 1 : 0), advanced: correct, mastered: false, nextStatus: correct ? 'Learning' : 'New' };
    },
    async awardWordTransitionXPBatch(entries) {
      stats.rewardBatches += 1;
      const reward = { awards: entries.map((entry) => entry.result.correct ? 2 : 0), pendingCount: 0 };
      Object.defineProperty(reward, 'evidence', { value: evidence, enumerable: false });
      return reward;
    },
    getWordMasteryKey(word) { return String(word.word).toLowerCase(); },
    showXPBadge() {},
    pushNotification() {},
    recordChestMasteredWords() {},
    isEditableDictionaryView() { return false; },
    updateQuizWordInSource() { assert.fail('verified commit must not use per-word storage/cloud writes'); },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Date,
    Map,
    Set,
    Number,
    Math,
    console,
  });
  const commitSource = between(runtimeSource, 'async function commitVerifiedQuizResults', 'function markRemember');
  new vm.Script(`${commitSource}\nthis.commitVerifiedQuizResults = commitVerifiedQuizResults;`).runInContext(context);
  return { context, stats };
}

for (const mode of ['matching', 'timeAttack', 'scramble']) {
  test(`${mode} verified result commits rewards, Evidence, and learning exactly once`, async () => {
    const harness = createCommitHarness(mode);
    const result = await harness.context.commitVerifiedQuizResults();
    assert.equal(result.correctCount, 10);
    assert.equal(result.total, 10);
    assert.equal(result.xp, 20);
    assert.equal(harness.stats.rewardBatches, 1);
    assert.equal(harness.stats.learningBatches, 1);
    assert.equal(harness.stats.evidenceFallbacks, 0);
    assert.equal(harness.stats.projections, 1);
  });
}

test('Matching errors retain the verified correct count and do not become correct during commit', async () => {
  const correctness = [true, false, true, false, true, true, true, true, true, true];
  const harness = createCommitHarness('matching', correctness);
  const result = await harness.context.commitVerifiedQuizResults();
  assert.equal(result.correctCount, 8);
  assert.equal(result.total, 10);
  assert.equal(result.xp, 16);
});

test('notification feedback failure after a Matching commit does not hide or repeat learning success', async () => {
  const harness = createCommitHarness('matching');
  harness.context.pushNotification = () => {
    const error = new Error('Missing or insufficient permissions.');
    error.code = 'permission-denied';
    throw error;
  };
  const result = await harness.context.commitVerifiedQuizResults();
  assert.equal(result.correctCount, 10);
  assert.equal(result.total, 10);
  assert.equal(result.xp, 20);
  assert.equal(harness.stats.rewardBatches, 1);
  assert.equal(harness.stats.learningBatches, 1);
  assert.equal(harness.stats.projections, 1);
});

function createFinishHarness({ fail = false, pending = false, notificationPermissionDenied = false } = {}) {
  const statuses = [];
  const scheduled = [];
  let commits = 0;
  const learningStats = { xpTransitions: 0, evidenceWrites: 0, notificationAttempts: 0 };
  const trace = { stage() { return this; }, count() { return this; }, warn() { return this; }, end() { return this; } };
  const elements = new Map([
    ['quizView', { setAttribute() {}, removeAttribute() {} }],
    ['quizFinishButton', {}],
    ['quizViewCard', { style: {} }],
    ['quizTimeAttackView', { style: {} }],
    ['quizScrambleView', { style: {} }],
    ['quizMatchingView', { style: {} }],
  ]);
  const window = {
    auth: { currentUser: { uid: 'uid-a' } },
    __lootlinguaQuizFinishTimeoutMs: pending ? 5 : undefined,
    LootLinguaOperations: {
      diagnostic() {},
      startTrace() { return trace; },
      nextPaint() { return Promise.resolve(); },
      beginStatus() {
        return {
          set(state) { statuses.push(state); },
          complete() { statuses.push('completed'); },
          fail() { statuses.push('save-failed'); },
          clear() {},
        };
      },
    },
    dispatchEvent(event) {
      if (event?.type !== 'lootlingua:trusted-quiz-completed') return true;
      window.LootLinguaNotificationStore?.upsert({
        kind: 'smart',
        notificationType: 'reminder.quiz.inactive',
        occurrenceKey: 'quiz:matching-regression',
        status: 'active',
        visualType: 'info',
        message: 'Quiz reminder',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return true;
    },
  };
  const context = vm.createContext({
    window,
    document: { getElementById(id) { return elements.get(id) || null; } },
    activeQuizSession: { id: 'matching-session', mode: 'matching' },
    currentQuizWords: Array.from({ length: 10 }, (_, index) => ({ id: `word-${index}`, word: `term-${index}` })),
    currentQuizMistakes: 0,
    quizIndex: 10,
    currentQuizExposureSessionId: 'matching-session',
    currentQuizExposureMode: 'matching',
    flashcardSessionOutcomes: new Map(),
    matchingQuizState: {},
    quizSessionResults: [],
    hasStartedAnswering: true,
    isVerifiedQuizMode() { return true; },
    async commitVerifiedQuizResults(_trace, onStage) {
      commits += 1;
      learningStats.xpTransitions += 1;
      learningStats.evidenceWrites += 1;
      onStage('applying-rewards');
      onStage('committing-learning');
      if (pending) return new Promise(() => {});
      if (fail) throw new Error('save failed');
      return { xp: 20, correctCount: 10, total: 10, pendingRewards: 0 };
    },
    stopTimeAttackTimer() {},
    recordQuizExposureSession() {},
    incrementDailyCountBy() {},
    checkAndUpdateStreak() {},
    recordHighAccuracyVerifiedQuiz() {},
    saveInt() {},
    loadInt() { return 0; },
    hasSignedInUser() { return true; },
    markDailyQuestFlag() {},
    evaluateTitleUnlocks() {},
    requestProfileCloudSave() {},
    playQuizCompletionSound() {},
    launchConfetti() {},
    clearActiveQuizSessionStorage() {},
    showToast() {},
    closeQuiz() {},
    setTimeout(callback, delay) {
      if (pending && delay <= 5) return { native: globalThis.setTimeout(callback, delay) };
      scheduled.push({ callback, delay, cleared: false });
      return { index: scheduled.length - 1 };
    },
    clearTimeout(id) {
      if (id?.native) globalThis.clearTimeout(id.native);
      if (Number.isInteger(id?.index) && scheduled[id.index]) scheduled[id.index].cleared = true;
    },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Object,
    Promise,
    Math,
    Number,
    Map,
    Date,
    JSON,
    Set,
    String,
    console,
    localStorage: memoryStorage(),
  });
  if (notificationPermissionDenied) {
    vm.runInContext(notificationStoreSource, context);
    window.LootLinguaNotificationStore.switchOwner('uid-a');
    window.LootLinguaNotificationStore.registerCloudAdapter({
      async writeRecords() {
        learningStats.notificationAttempts += 1;
        if (learningStats.notificationAttempts === 1) {
          const error = new Error('Firestore BatchGetDocuments: Missing or insufficient permissions.');
          error.code = 'permission-denied';
          throw error;
        }
        return true;
      },
    });
  }
  const finishSource = between(runtimeSource, 'const QUIZ_FINISH_TRANSITIONS', 'function markForgot');
  new vm.Script(`${finishSource}\nthis.finishQuizRun = finishQuizRun; this.getFinishState = () => quizFinishState;`)
    .runInContext(context);
  return { context, window, statuses, scheduled, learningStats, get commits() { return commits; } };
}

test('account Matching finish is single-flight and leaves loading on the completed result state', async () => {
  const harness = createFinishHarness();
  const first = harness.context.finishQuizRun();
  const second = harness.context.finishQuizRun();
  assert.equal(first, second);
  const result = await first;
  assert.equal(result.total, 10);
  assert.equal(harness.commits, 1);
  assert.equal(harness.context.getFinishState(), 'completed');
  assert.ok(harness.statuses.includes('completed'));
  assert.equal(harness.scheduled.filter((timer) => !timer.cleared).length, 1);
});

test('account Matching 10/10 completes when notification BatchGet/write is permission-denied and retries without duplicate learning', async () => {
  const harness = createFinishHarness({ notificationPermissionDenied: true });
  const result = await harness.context.finishQuizRun();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(result.correctCount, 10);
  assert.equal(result.total, 10);
  assert.equal(harness.context.getFinishState(), 'completed');
  assert.equal(harness.commits, 1);
  assert.equal(harness.learningStats.xpTransitions, 1);
  assert.equal(harness.learningStats.evidenceWrites, 1);
  assert.equal(harness.learningStats.notificationAttempts, 1);
  assert.equal(harness.window.LootLinguaNotificationStore.deferredCloudWriteCount(), 1);

  assert.equal(await harness.window.LootLinguaNotificationStore.retryDeferredCloudWrites(), true);
  assert.equal(harness.learningStats.notificationAttempts, 2);
  assert.equal(harness.window.LootLinguaNotificationStore.deferredCloudWriteCount(), 0);
  assert.equal(harness.commits, 1);
  assert.equal(harness.learningStats.xpTransitions, 1);
  assert.equal(harness.learningStats.evidenceWrites, 1);
});

test('a failed account commit exits loading into a retryable state', async () => {
  const harness = createFinishHarness({ fail: true });
  const result = await harness.context.finishQuizRun();
  assert.equal(result, null);
  assert.equal(harness.commits, 1);
  assert.equal(harness.context.getFinishState(), 'save-failed');
  assert.ok(harness.statuses.includes('save-failed'));
});

test('an unresolved cloud commit is bounded by the finish watchdog and becomes retryable', async () => {
  const harness = createFinishHarness({ pending: true });
  const result = await harness.context.finishQuizRun();
  assert.equal(result, null);
  assert.equal(harness.commits, 1);
  assert.equal(harness.context.getFinishState(), 'save-failed');
  assert.ok(harness.statuses.includes('save-failed'));
});

test('source-change batching emits one invalidation for several changed scopes', () => {
  const events = [];
  const window = {
    dispatchEvent(event) { events.push(event); },
    addEventListener() {},
  };
  const context = vm.createContext({
    window,
    getStorageUserId(uid) { return uid || 'guest'; },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Set,
    String,
    Math,
  });
  const batchingSource = between(storageSource, 'let quizSourceDataChangeBatch', 'function hasSignedInUser');
  new vm.Script(`${batchingSource}\nthis.dispatchChange = dispatchQuizSourceDataChanged;`)
    .runInContext(context);
  const token = window.beginQuizSourceDataChangeBatch('uid-a');
  context.dispatchChange({ ownerId: 'uid-a', scope: 'personal', source: 'local-write' });
  context.dispatchChange({ ownerId: 'uid-a', scope: 'custom:world-a', source: 'local-write' });
  window.endQuizSourceDataChangeBatch(token);
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.source, 'quiz-learning-batch');
  assert.deepEqual([...events[0].detail.scopes], ['personal', 'custom:world-a']);
});

test('Quiz source refresh stays suppressed during learning commit and coalesces after completion', async () => {
  const listeners = new Map();
  let availableRefreshes = 0;
  let summaryRefreshes = 0;
  const window = {
    __lootlinguaQuizLearningCommitDepth: 1,
    LootLinguaOperations: { diagnostic() {} },
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  const context = vm.createContext({
    window,
    currentView: 'quiz',
    currentQuizSelectionPlan: null,
    quizSourceLoadStates: new Map(),
    quizSourceRequestCoordinator: { invalidate() {} },
    getQuizSourceOwnerId() { return 'uid-a'; },
    refreshQuizAvailableCount() { availableRefreshes += 1; },
    refreshQuizSettingsSummary() { summaryRefreshes += 1; },
    queueMicrotask,
    Promise,
    String,
    Number,
  });
  const refreshSource = between(quizSource, 'let quizSourceRefreshScheduled', 'function getQuizSourceParts');
  new vm.Script(refreshSource).runInContext(context);
  listeners.get('lootlingua:quiz-source-data-changed')?.({ detail: { ownerId: 'uid-a', source: 'local-write' } });
  listeners.get('lootlingua:learning-data-changed')?.({});
  await Promise.resolve();
  assert.equal(availableRefreshes, 0);
  assert.equal(summaryRefreshes, 0);
  window.__lootlinguaQuizLearningCommitDepth = 0;
  listeners.get('lootlingua:quiz-learning-commit-complete')?.({});
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(availableRefreshes, 1);
  assert.equal(summaryRefreshes, 1);
});

test('unscoped account profile cache is not guest migration data, while dirty guest progress remains migratable', () => {
  const snapshotSource = between(scriptSource, 'function getGuestProgressSnapshot', 'function getGuestProgressSummary');
  const payload = { userXP: 250, dailyStreak: 4 };
  const build = new Function('window', 'hasDirtyGuestData', `${snapshotSource}\nreturn getGuestProgressSnapshot;`);
  const accountSnapshot = build({ getLootlinguaProfilePayload: () => payload }, () => false);
  assert.deepEqual(accountSnapshot(), {});
  const guestSnapshot = build({ getLootlinguaProfilePayload: () => payload }, () => true);
  assert.deepEqual(guestSnapshot(), payload);

  const meaningfulSource = between(storageSource, 'function hasMeaningfulGuestLoot(snapshot)', 'function reconcileEmptyGuestSessionState');
  const makeMeaningful = new Function(
    'readCustomWorldsFromStorage',
    'hasSignedInUser',
    'userXP',
    `${meaningfulSource}\nreturn hasMeaningfulGuestLoot;`
  );
  const accountMeaningful = makeMeaningful(() => [], () => true, 250);
  assert.equal(accountMeaningful({ words: [], profile: {}, wordMastery: {}, pendingCustomWorlds: [] }), false);
  assert.equal(accountMeaningful({
    words: [{ id: 'guest-word', word: 'guest' }],
    profile: {},
    wordMastery: {},
    pendingCustomWorlds: [],
  }), true, 'genuine guest-scoped words still prompt even without a legacy profile marker');
  assert.equal(accountMeaningful({
    words: [],
    profile: payload,
    wordMastery: {},
    pendingCustomWorlds: [],
  }), true, 'dirty signed-out profile progress still prompts after account auth');
});
