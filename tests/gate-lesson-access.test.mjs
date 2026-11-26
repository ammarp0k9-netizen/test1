import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import '../js/gate-lesson.js';

const lesson = globalThis.LootLinguaGateLesson;
const cloud = readFileSync(new URL('../js/journey-cloud.js', import.meta.url), 'utf8');
const quiz = readFileSync(new URL('../js/quiz.js', import.meta.url), 'utf8');
const gate = { worldId: 'world', rankId: 'rank', gateId: 'gate' };
const selectedIds = ['one', 'two'];
const timestamp = value => ({ toMillis: () => value });

function accessHarness({ progress = {}, documents = {}, beforeRead } = {}) {
  const reads = [];
  const auth = { currentUser: { uid: 'owner' } };
  const scope = vm.createContext({
    requireUser: () => ({ uid: auth.currentUser.uid }), auth,
    window: { LootLinguaGateLesson: lesson }, db: {},
    doc: (base, ...parts) => typeof base === 'string' ? [base, ...parts].join('/') : parts.join('/'),
    gateLessonRef: () => 'lesson',
    gateProgressRef: (uid, world, rank, gateId) => 'users/' + uid + '/contentProgress/' + world + '/ranks/' + rank + '/gates/' + gateId,
    getGateProgress: async () => ({ loadedAt: timestamp(100), status: 'learning',
      loadedContentWordIds: selectedIds, ...progress }),
    getDoc: async path => {
      reads.push(path);
      await beforeRead?.(path, auth);
      return { exists: () => Object.hasOwn(documents, path), data: () => documents[path], metadata: {} };
    },
    contentApi: () => ({ getPublishedGate: async () => ({ status: 'published', publishedWordIds: selectedIds }) }),
    sameEvidenceWordKeys: (left = [], right = []) => lesson.sameWords(left, right),
    journeyCloudError: code => Object.assign(new Error(code), { code }),
  });
  vm.runInContext(cloud.slice(cloud.indexOf('async function getGateLessonCutoff()'),
    cloud.indexOf('async function saveGateLessonState(')), scope);
  return { reads, access: options => scope.getGateLessonAccess(gate, options) };
}

test('a backdated local draft and a historically loaded cohort do not establish lesson completion', async () => {
  const h = accessHarness({ documents: {
    'users/owner/meta/active_quiz_session': { id: 'draft', createdAt: 1, source: 'journey:world~rank~gate' },
  } });
  assert.equal((await h.access({ session: { id: 'draft', createdAt: 1 } })).allowed, false);
});

test('historical readiness requires the trusted activation time, exact published cohort and proof', async () => {
  const progress = { status: 'ready', readyAt: timestamp(500) };
  const documents = { 'releaseConfig/gateLesson': { activatedAt: timestamp(1000) },
    'users/owner/contentProgress/world/ranks/rank/gates/gate/readiness/proof': { wordIds: selectedIds } };
  assert.equal((await accessHarness({ progress }).access()).allowed, false);
  assert.equal((await accessHarness({ progress, documents }).access()).allowed, true);
  assert.equal((await accessHarness({ progress: { ...progress, readyAt: timestamp(1200) }, documents }).access()).allowed, false);
  assert.equal((await accessHarness({ progress, documents: { ...documents,
    'users/owner/contentProgress/world/ranks/rank/gates/gate/readiness/proof': { wordIds: ['one'] } } }).access()).allowed, false);
});

test('legacy review resumes only with a trusted matching seal and the original due cohort', async () => {
  const session = { id: 'draft', mode: 'scramble', source: 'journey:world~rank~gate',
    words: selectedIds.map(wordKey => ({ wordKey })), officialReviewDueWordKeys: selectedIds };
  const draft = { ...session, createdAt: 1 };
  const documents = { 'releaseConfig/gateLesson': { activatedAt: timestamp(1000) },
    'users/owner/meta/active_quiz_session': draft };
  documents['releaseConfig/gateLesson'].captureStartedAt = timestamp(900);
  assert.equal((await accessHarness({ documents }).access({ session })).allowed, false);
  documents['users/owner/meta/legacy_gate_quiz'] = { ...gate, sessionId: session.id, mode: session.mode,
    source: draft.source, capturedAt: timestamp(500), wordKeys: selectedIds, dueWordKeys: selectedIds };
  assert.equal((await accessHarness({ documents }).access({ session })).allowed, true);
  for (const changed of [{ id: 'new' }, { mode: 'matching' }, { source: 'personal' }, { words: [{ wordKey: 'one' }] }, { officialReviewDueWordKeys: ['one'] }]) {
    assert.equal((await accessHarness({ documents }).access({ session: { ...session, ...changed } })).allowed, false);
  }
});

test('cloud completion uses the complete loaded cohort and rejects an account switch during reads', async () => {
  const complete = { version: 1, wordIds: selectedIds, completedWordIds: selectedIds };
  assert.equal((await accessHarness({ documents: { lesson: complete } }).access()).allowed, true);
  assert.equal((await accessHarness({ documents: { lesson: { ...complete, completedWordIds: ['one'] } } }).access()).allowed, false);
  const changed = accessHarness({ documents: { lesson: complete },
    beforeRead: (_path, auth) => { auth.currentUser = { uid: 'other' }; } });
  await assert.rejects(changed.access(), { code: 'journey/auth-changed' });
});

function quizHarness(allowed = false) {
  let checks = 0;
  const root = { LootLinguaGateLesson: lesson, auth: { currentUser: { uid: 'owner' } },
    LootLinguaJourneyCloud: { getGateLessonAccess: async () => { checks++; return { allowed }; } } };
  const scope = vm.createContext({ window: root, showToast: () => {} });
  vm.runInContext(quiz.slice(quiz.indexOf('async function canOpenGateQuiz('),
    quiz.indexOf('window.resumeActiveQuizSession')), scope);
  vm.runInContext(quiz.slice(quiz.indexOf('window.startGateQuiz ='),
    quiz.indexOf('function gateGapReviewWords(')), scope);
  vm.runInContext(quiz.slice(quiz.indexOf('window.startGateGapReview ='),
    quiz.indexOf('window.startNotificationWordReview =')), scope);
  return { root, scope, checks: () => checks };
}

test('all gate quiz modes and gap review reject incomplete learning before opening a quiz', async () => {
  const h = quizHarness();
  for (const mode of ['scramble', 'matching', 'timeAttack', 'flashcards']) {
    assert.equal(await h.root.startGateQuiz(mode, gate), false);
  }
  assert.equal(await h.root.startGateGapReview(selectedIds, gate), false);
  assert.equal(h.checks(), 5);
});

test('independent personal quizzes with overlapping words do not consult gate lesson eligibility', async () => {
  const h = quizHarness();
  assert.equal(await h.scope.canOpenGateQuiz({ source: 'personal', words: [{ contentWordId: 'one' }] }), true);
  assert.equal(await h.scope.canOpenGateQuiz({ source: 'journey:malformed' }), false);
  assert.equal(h.checks(), 0);
});

test('an unverified saved gate quiz stays intact and cannot reach the resume or result handler', async () => {
  const h = quizHarness();
  const saved = { id: 'unverified', source: 'personal', officialReviewGate: gate, quizIndex: 4 };
  h.root.__pendingQuizResumeSession = saved;
  vm.runInContext(quiz.slice(quiz.indexOf('window.resumeActiveQuizSession ='),
    quiz.indexOf('window.forfeitActiveQuizSession =')), h.scope);
  assert.equal(await h.root.resumeActiveQuizSession(), false);
  assert.equal(h.root.__pendingQuizResumeSession, saved);
  assert.equal(saved.quizIndex, 4);
  assert.equal(h.checks(), 1);
});

test('a verified legacy gate quiz resumes its checkpoint or submits its saved result once', async () => {
  for (const finished of [false, true]) {
    const h = quizHarness(true);
    const calls = { applied: 0, rendered: 0, submitted: 0 };
    const saved = { id: 'verified', source: 'personal', mode: 'scramble', officialReviewGate: gate,
      words: Array.from({ length: 15 }, (_, index) => ({ id: 'word-' + index })),
      quizIndex: finished ? 15 : 4, quizSessionResults: [{ wordId: 'word-0', correct: true }] };
    h.root.__pendingQuizResumeSession = saved;
    Object.assign(h.scope, {
      activeQuizSession: null,
      isVerifiedQuizMode: () => true,
      applyStoredQuizSession: value => { calls.applied++; h.scope.activeQuizSession = value; return true; },
      hideQuizResumePrompt() {}, hideQuizPlayPanels() {}, setQuizImmersive() {},
      finishQuizRun: () => { calls.submitted++; return 'submitted'; },
      updateScrambleCard: () => { calls.rendered++; },
      document: { getElementById: () => ({ style: {} }), querySelector: () => null },
    });
    vm.runInContext(quiz.slice(quiz.indexOf('function quizDraftWordCount('),
      quiz.indexOf('function isResumableQuizSession(')), h.scope);
    vm.runInContext(quiz.slice(quiz.indexOf('window.resumeActiveQuizSession ='),
      quiz.indexOf('window.forfeitActiveQuizSession =')), h.scope);
    await h.root.resumeActiveQuizSession();
    assert.equal(h.scope.activeQuizSession, saved);
    assert.equal(saved.quizIndex, finished ? 15 : 4);
    assert.deepEqual(calls, { applied: 1, rendered: finished ? 0 : 1, submitted: finished ? 1 : 0 });
    assert.equal(h.checks(), 1);
  }
});

test('trusted activation is explicit and client timestamps cannot invent a default cutoff', () => {
  assert.equal(lesson.isLegacy(timestamp(100), undefined), false);
  assert.equal(lesson.isLegacy(timestamp(100), timestamp(100)), false);
  assert.equal(lesson.isLegacy(timestamp(100), timestamp(101)), true);
});
