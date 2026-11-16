import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [runtime, transitions, journey] = await Promise.all(
  ['quiz-runtime.js', 'srs-transitions.js', 'journey-cloud.js'].map(name =>
    readFile(new URL('../js/' + name, import.meta.url), 'utf8'))
);
const day = '2026-11-14';
const now = Date.parse(day + 'T17:00:00Z');
const gate = { worldId: 'w', rankId: 'r', gateId: 'g' };
const readinessChange = { ...gate, ownerId: 'account', previousSteps: 4, previousTotal: 12, steps: 6, total: 12 };
const fresh = () => ({ mastery_status: 'New', mastery_streak: 0, last_recall_day: '', last_recall_session_id: '' });
const sameDay = () => ({ mastery_status: 'Learning', mastery_streak: 1, last_recall_day: day, last_recall_session_id: 'previous' });
const noPromotionText = 'أحسنت! ما في انتقال إتقان جديد بهالجلسة. التقدّم القادم إله شروط مراجعة متباعدة';

function harness({ states = [fresh()], correct = states.map(() => true), official = false, pending = 0,
  failFirstSave = false, evidence, waitForSave, practice = false, projection } = {}) {
  const words = states.map((_state, index) => ({ id: String(index), word: 'word-' + index }));
  const local = new Map(words.map((word, index) => [word.word, states[index]]));
  const statuses = [], toasts = [], earned = new Set();
  let saves = 0, retries = 0;
  const root = {
    auth: { currentUser: { uid: 'account' } },
    queueProfileIntent() {},
    LootLinguaJourneyCloud: projection || { async projectQuizEvidenceReadiness(summary) { return summary; } },
    LootLinguaOperations: {
      nextPaint: async () => {},
      startTrace: () => null,
      beginStatus: () => ({
        set(state, text, retry) { statuses.push({ state, text, retry }); },
        complete(text) { statuses.push({ state: 'completed', text }); },
        fail(text, retry) { statuses.push({ state: 'failed', text, retry }); },
      }),
    },
    async applyQuizLearningBatch(entries) {
      saves++;
      entries.forEach(({ word, update }) => local.set(word.word, { ...update.state }));
      if (waitForSave) await waitForSave;
      if (failFirstSave && saves === 1) throw new Error('save failed after local update');
      return { cloud: { saved: true } };
    },
    dispatchEvent() {},
  };
  const ctx = vm.createContext({
    window: root, console, document: { getElementById: () => ({ style: {} }) },
    SRS_STATUSES: ['New', 'Learning', 'Reviewing', 'Mastered'],
    SRS_MASTERY_WINDOW_MS: 72 * 3600000,
    getQuizDay: time => new Date(time).toISOString().slice(0, 10),
    getWordMasteryState: word => ({ ...local.get(word.word) }),
    getWordMasteryKey: word => word.word,
    activeQuizSession: practice ? null : { id: 'this-session', mode: 'matching', words, source: 'personal',
      ...(official ? { officialReviewGate: gate, journeyWorldId: gate.worldId, journeyRankId: gate.rankId, journeyGateId: gate.gateId } : {}) },
    currentQuizWords: words, currentQuizSource: 'personal',
    quizSessionResults: words.map((word, index) => ({ wordId: word.id, correct: correct[index], answeredAt: now })),
    currentQuizMistakes: correct.filter(value => !value).length, quizIndex: words.length,
    currentQuizExposureSessionId: 'this-session', currentQuizExposureMode: 'verified',
    flashcardSessionOutcomes: new Map(), matchingQuizState: {}, hasStartedAnswering: true,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    async awardWordTransitionXPBatch(entries) {
      const awards = entries.map(({ word, update }) => {
        if (!update.transition || earned.has(word.word) || pending) return 0;
        earned.add(word.word);
        return 2;
      });
      return { awards, pendingCount: pending, evidence: evidence || { recorded: 0, duplicate: 0 } };
    },
    isVerifiedQuizMode: mode => mode === 'matching', hasSignedInUser: () => true,
    showToast: (text, type, _duration, options) => toasts.push({ text, type, options }),
    retryPendingXPEvents: () => { retries++; },
    showXPBadge() {}, pushNotification() {}, recordChestMasteredWords() {},
    isEditableDictionaryView: () => false, recordQuizExposureSession() {},
    stopTimeAttackTimer() {}, todayStr: () => day, recordHighAccuracyVerifiedQuiz() {},
    playQuizCompletionSound() {}, launchConfetti() {}, clearActiveQuizSessionStorage() {},
    closeQuiz() {}, setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(transitions + '\n' + runtime, ctx);
  return { start: () => ctx.finishQuizRun(), statuses, toasts, earned,
    get saves() { return saves; }, get retries() { return retries; } };
}

test('reports a promotion only after confirmed save', async () => {
  let release;
  const waitForSave = new Promise(resolve => { release = resolve; });
  const h = harness({ waitForSave });
  const first = h.start();
  assert.equal(h.start(), first);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.toasts.length, 0);
  assert.ok(!h.statuses.some(status => status.state === 'completed'));
  release();
  const result = await first;
  assert.equal(result.promotedCount, 1);
  assert.match(h.toasts[0].text, /الإتقان: تقدّمت كلمة واحدة/);
  assert.equal(h.toasts[0].options.wrap, true);
  assert.equal(h.saves, 1);
});

test('a correct answer without a new stage gets the requested message', async () => {
  const h = harness({ states: [sameDay()] });
  const result = await h.start();
  assert.equal(result.correctCount, 1);
  assert.equal(result.promotedCount, 0);
  assert.ok(h.toasts[0].text.includes(noPromotionText));
});

test('a mixed quiz counts only actual upward transitions even when its XP is pending', async () => {
  const h = harness({ states: [fresh(), fresh(), sameDay(), fresh()], correct: [true, true, true, false], pending: 2 });
  const result = await h.start();
  assert.equal(result.correctCount, 3);
  assert.equal(result.promotedCount, 2);
  assert.equal(result.xp, 0);
  assert.match(h.toasts[0].text, /الإتقان: تقدّمت كلمتان/);
  assert.match(h.toasts[0].text, /بانتظار المزامنة/);
  h.statuses.find(status => status.state === 'partial-success').retry();
  assert.equal(h.retries, 1);
  assert.equal(h.saves, 1);
});

test('a save failure never shows success, then retry reports the persisted promotion once', async () => {
  const h = harness({ failFirstSave: true });
  assert.equal(await h.start(), null);
  assert.equal(h.toasts.length, 0);
  assert.equal(h.statuses.at(-1).state, 'failed');
  assert.equal(h.earned.size, 1);
  const retried = await h.statuses.at(-1).retry();
  assert.equal(retried.promotedCount, 1);
  assert.equal(retried.xp, 0);
  assert.equal(h.saves, 2);
  assert.equal(h.earned.size, 1);
  assert.equal(h.toasts.length, 1);
});

test('official review shows saved readiness separately, including a readiness gain without mastery', async () => {
  const mixed = harness({ official: true, evidence: { recorded: 9, readinessChange } });
  await mixed.start();
  assert.match(mixed.toasts[0].text, /الإتقان: تقدّمت كلمة واحدة/);
  assert.match(mixed.toasts[0].text, /جاهزية البوابة: \+2 · 6\/12/);
  const readinessOnly = harness({ official: true, states: [sameDay()], evidence: { recorded: 1, readinessChange } });
  await readinessOnly.start();
  assert.ok(readinessOnly.toasts[0].text.includes(noPromotionText));
  assert.match(readinessOnly.toasts[0].text, /جاهزية البوابة: \+2/);
});

test('an unchanged, unconfirmed, or different gate never displays a readiness increase', async () => {
  for (const [evidence, pattern] of [
    [{ recorded: 1, readinessChange: { ...readinessChange, previousSteps: 6 } }, /ما تغيّرت/],
    [{ recorded: 1, readinessChange: { ...readinessChange, gateId: 'wrong' } }, /راجع حالتها/],
    [{ recorded: 1, readinessChange, readinessError: new Error('failed') }, /راجع حالتها/],
    [{ recorded: 0, duplicate: 0 }, /ما تسجّلت زيادة/],
  ]) {
    const h = harness({ official: true, evidence });
    await h.start();
    assert.match(h.toasts[0].text, pattern);
    assert.doesNotMatch(h.toasts[0].text, /جاهزية البوابة: \+/);
  }
  const general = harness({ evidence: { recorded: 1, readinessChange } });
  await general.start();
  assert.doesNotMatch(general.toasts[0].text, /جاهزية البوابة/);
});

test('flashcards keep a training result outside the trusted commit', async () => {
  const h = harness({ practice: true });
  await h.start();
  assert.equal(h.saves, 0);
  assert.equal(h.earned.size, 0);
  assert.match(h.toasts[0].text, /بطاقات الذاكرة.+ما بيرفع الإتقان أو جاهزية البوابة/);
});

const projectSource = journey.slice(journey.indexOf('async function projectQuizEvidenceReadiness'),
  journey.indexOf('function createGateClearAttemptId'));
function projectionHarness({ reject = false, unchanged = false } = {}) {
  const updates = [], notices = [];
  const previous = {
    status: 'learning', readyWordCount: 0, requiredWordCount: 4,
    evidenceStepCount: unchanged ? 6 : 3, totalEvidenceSteps: 12, availableForReviewNowCount: 2,
    waitingLaterTodayCount: 0, waitingNextDayCount: 0, runnerReviewDueWordKeys: [],
    loadedWordKeys: ['1', '2', '3', '4'],
  };
  const readiness = {
    status: 'learning', ready: false, readyWordCount: 0, requiredWordCount: 4, evidenceStepCount: 6,
    totalEvidenceSteps: 12, availableForReviewNow: 2, waitingLaterToday: 0, waitingNextDay: 0,
  };
  const context = vm.createContext({
    requireUser: () => ({ uid: 'account' }),
    getActiveJourney: async () => ({ worldId: gate.worldId, activeRankId: gate.rankId, activeGateId: gate.gateId }),
    getGateProgress: async () => previous,
    gateCacheKey: (...ids) => ids.join('/'), rankCacheKey: (...ids) => ids.join('/'),
    db: {}, doc: () => ({}),
    getDoc: async () => ({ exists: () => true, data: () => ({}) }),
    evidenceCore: () => ({ normalizeTimezoneOffsetMinutes: () => 0, computeGateReadiness: () => readiness }),
    currentGateDueWordKeys: () => [], gateProgressRef: () => ({}), serverTimestamp: () => 123,
    async runTransaction(_db, task) {
      const update = await task({
        get: async () => ({ exists: () => true, data: () => ({ ...previous, evidenceStepCount: 4 }) }),
        update: (_ref, values) => updates.push(values),
      });
      if (reject) throw new Error('projection write rejected');
      return update;
    },
    cache: { gateProgress: new Map(), rankGateProgress: new Map() },
    window: { dispatchEvent: event => notices.push(event) },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    journeyOperationError: error => error, console: { warn() {} },
  });
  vm.runInContext(projectSource, context);
  return { updates, notices, project: () => context.projectQuizEvidenceReadiness({ recorded: 1 }) };
}

test('a confirmed projection uses previous steps from the transaction, not the cached value', async () => {
  const h = projectionHarness();
  const result = await h.project();
  assert.deepEqual({ ...result.readinessChange }, readinessChange);
  assert.equal(h.updates.length, 1);
  assert.equal(h.notices.length, 1);
});

test('a failed projection returns no confirmed readiness, and unchanged projection writes nothing', async () => {
  const failed = projectionHarness({ reject: true });
  const result = await failed.project();
  assert.equal(result.readinessChange, null);
  assert.match(result.readinessError.message, /rejected/);
  assert.equal(failed.notices.length, 0);
  const unchanged = projectionHarness({ unchanged: true });
  const same = await unchanged.project();
  assert.equal(same.readinessChange.previousSteps, same.readinessChange.steps);
  assert.equal(unchanged.updates.length, 0);
});
