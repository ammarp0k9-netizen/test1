import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [source, cloudSource, worldsSource] = await Promise.all([
  readFile(new URL('../js/gate-clear.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
]);
const root = {};
vm.runInContext(source, vm.createContext({ window: root, globalThis: root }));
const gateClear = root.LootLinguaGateClear;

function words(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    contentWordId: `word-${index + 1}`,
    word: `word${index + 1}`,
    translation: `meaning${index + 1}`,
    status: 'published',
  }));
}

function seed(count = 10, passRatio = 0.75) {
  return gateClear.createSessionSeed({
    attemptId: 'attempt-a',
    worldId: 'world-a',
    rankId: 'rank-a',
    gateId: 'gate-a',
    words: words(count),
    passRatio,
  });
}

test('75 percent of 10 requires 8 correct answers', () => {
  assert.equal(gateClear.requiredCorrect(10, 0.75), 8);
  assert.equal(seed().requiredCorrect, 8);
});

test('Gate Clear uses every published word and excludes draft or archived words', () => {
  const session = gateClear.createSessionSeed({
    attemptId: 'attempt-b',
    worldId: 'world-a',
    rankId: 'rank-a',
    gateId: 'gate-a',
    words: [
      ...words(4),
      { contentWordId: 'draft-word', word: 'draft', translation: 'draft', status: 'draft' },
      { contentWordId: 'old-word', word: 'old', translation: 'old', status: 'archived' },
    ],
    passRatio: 0.75,
  });
  assert.equal(session.totalCount, 4);
  assert.equal(session.questionOrder.includes('draft-word'), false);
  assert.equal(session.questionOrder.includes('old-word'), false);
  const question = gateClear.buildQuestion(session, words(4));
  assert.equal(question.options.length, 4);
  assert.equal(new Set(question.options.map((option) => option.contentWordId)).size, 4);
});

test('an answer is fixed once and only a gate option is accepted', () => {
  const session = seed(4);
  const question = gateClear.buildQuestion(session, words(4));
  const answered = gateClear.answerSession(session, question.correctContentWordId);
  assert.equal(session.answers.length, 0);
  assert.equal(answered.answers.length, 1);
  assert.equal(answered.answers[0].correct, true);
  assert.equal(answered.currentQuestionIndex, 1);
  assert.throws(
    () => gateClear.answerSession(session, 'outside-gate'),
    (error) => error.code === 'gate-clear/invalid-option'
  );
});

test('pass and failure results use the stored requiredCorrect value', () => {
  const base = seed();
  assert.deepEqual(
    { ...gateClear.resultFor({ ...base, correctCount: 8 }) },
    { passed: true, result: 'passed', score: 0.8 }
  );
  assert.deepEqual(
    { ...gateClear.resultFor({ ...base, correctCount: 7 }) },
    { passed: false, result: 'failed', score: 0.7 }
  );
});

test('Gate Clear is available only from ready and commits clear plus next availability atomically', () => {
  assert.match(cloudSource, /progress\?\.status !== 'ready'/);
  const finalize = cloudSource.slice(
    cloudSource.indexOf('async function finalizeGateClearAttempt'),
    cloudSource.indexOf('async function answerGateClearQuestion')
  );
  assert.match(finalize, /runTransaction\(db/);
  assert.match(finalize, /status: 'cleared'/);
  assert.match(finalize, /clearedBy: 'gate-clear'/);
  assert.match(finalize, /status: 'available'/);
  assert.match(finalize, /lastClearResult: 'failed'/);
  assert.doesNotMatch(finalize, /loadGateWords|runGateWordOperation|awardXP/);
  assert.match(worldsSource, /state === 'ready'/);
  assert.match(worldsSource, /beginPublishedGateClear/);
});

test('Gate Clear session is resumable and has no reward side effects', () => {
  assert.match(cloudSource, /activeClearAttemptId/);
  assert.match(cloudSource, /async function resumeGateClearAttempt/);
  assert.match(cloudSource, /async function abandonGateClearAttempt/);
  const gateBlock = cloudSource.slice(
    cloudSource.indexOf('function createGateClearAttemptId'),
    cloudSource.indexOf('async function validateGateOperation')
  );
  assert.doesNotMatch(gateBlock, /awardXP|markDailyQuest|recordChest|dailyStreak|lockedXP/);
});
