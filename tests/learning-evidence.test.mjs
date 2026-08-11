import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [source, cloudSource, runtimeSource] = await Promise.all([
  readFile(new URL('../js/learning-evidence.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz-runtime.js', import.meta.url), 'utf8'),
]);
const root = {};
vm.runInContext(source, vm.createContext({ window: root, globalThis: root }));
const evidence = root.LootLinguaLearningEvidence;

test('evidence IDs are deterministic per owner, quiz session, word, and version', () => {
  const first = evidence.evidenceEventId('user-a', 'session-a', 'word-a');
  assert.equal(first, evidence.evidenceEventId('user-a', 'session-a', 'word-a'));
  assert.notEqual(first, evidence.evidenceEventId('user-b', 'session-a', 'word-a'));
  assert.notEqual(first, evidence.evidenceEventId('user-a', 'session-b', 'word-a'));
  assert.notEqual(first, evidence.evidenceEventId('user-a', 'session-a', 'word-b'));
});

test('only completed correct verified recall can produce evidence', () => {
  const base = {
    word: { eligibleEvidenceCount: 0 },
    uid: 'user-a',
    wordKey: 'word-a',
    sessionId: 'session-a',
    sourceType: 'personal',
    mode: 'timeAttack',
    completed: true,
    correct: true,
    answeredAt: 100,
  };
  assert.equal(evidence.isEligibleRecall(base), true);
  assert.equal(evidence.isEligibleRecall({ ...base, mode: 'matching' }), true);
  assert.equal(evidence.isEligibleRecall({ ...base, correct: false }), false);
  assert.equal(evidence.isEligibleRecall({ ...base, completed: false }), false);
  assert.equal(evidence.isEligibleRecall({ ...base, mode: 'flashcards' }), false);
  assert.equal(evidence.isEligibleRecall({ ...base, mode: 'level-placement' }), false);
  assert.equal(evidence.isEligibleRecall({ ...base, sourceType: 'preview' }), false);
});

test('two-day readiness accepts injected development timing without changing production defaults', () => {
  const config = {
    requiredEvidenceCount: 3,
    secondEvidenceMinDelayMs: 100,
    finalEvidenceMinDelayMs: 200,
    finalEvidenceRequiresNextLocalDay: false,
  };
  const input = {
    uid: 'user-a',
    wordKey: 'word-a',
    sessionId: 'session-b',
    sourceType: 'private-world',
    mode: 'scramble',
    completed: true,
    correct: true,
  };
  assert.equal(evidence.isEligibleRecall({ ...input, word: { eligibleEvidenceCount: 0 }, answeredAt: 1 }, config), true);
  assert.equal(evidence.isEligibleRecall({
    ...input,
    word: { eligibleEvidenceCount: 1, lastEligibleEvidenceAt: 100 },
    answeredAt: 199,
  }, config), false);
  assert.equal(evidence.isEligibleRecall({
    ...input,
    word: { eligibleEvidenceCount: 1, lastEligibleEvidenceAt: 100 },
    answeredAt: 200,
  }, config), true);
  assert.equal(evidence.isEligibleRecall({
    ...input,
    word: { eligibleEvidenceCount: 2, lastEligibleEvidenceAt: 200 },
    answeredAt: 400,
  }, config), true);
  assert.equal(evidence.DEFAULT_EVIDENCE_CONFIG.requiredEvidenceCount, 3);
  assert.equal(evidence.DEFAULT_EVIDENCE_CONFIG.secondEvidenceMinDelayMs, 2 * 60 * 60 * 1000);
  assert.equal(evidence.DEFAULT_EVIDENCE_CONFIG.finalEvidenceMinDelayMs, 30 * 60 * 1000);
  assert.equal(evidence.DEFAULT_EVIDENCE_CONFIG.finalEvidenceRequiresNextLocalDay, true);
});

test('production evidence requires two hours and a later local calendar day', () => {
  const offset = -180;
  const firstAt = Date.UTC(2026, 6, 25, 9, 0);
  const firstWord = {
    eligibleEvidenceCount: 1,
    lastEligibleEvidenceAt: firstAt,
    evidenceTimezoneOffsetMinutes: offset,
    lastEvidenceLocalDayKey: evidence.localDayKey(firstAt, offset),
  };
  assert.equal(
    evidence.getWordGateReadiness(firstWord, null, firstAt + (2 * 60 * 60 * 1000) - 1, offset).status,
    'waiting-second-review'
  );
  assert.equal(
    evidence.getWordGateReadiness(firstWord, null, firstAt + (2 * 60 * 60 * 1000), offset).status,
    'second-review-available'
  );

  const secondAt = Date.UTC(2026, 6, 25, 20, 50);
  const secondWord = {
    eligibleEvidenceCount: 2,
    lastEligibleEvidenceAt: secondAt,
    evidenceTimezoneOffsetMinutes: offset,
    lastEvidenceLocalDayKey: evidence.localDayKey(secondAt, offset),
  };
  const nextAt = Math.max(
    secondAt + (30 * 60 * 1000),
    evidence.nextLocalDayStart(secondAt, offset)
  );
  assert.equal(
    evidence.getWordGateReadiness(secondWord, null, nextAt - 1, offset).status,
    'waiting-next-day'
  );
  assert.equal(
    evidence.getWordGateReadiness(secondWord, null, nextAt, offset).status,
    'next-day-review-available'
  );
});

test('legacy evidence remains counted and is never pushed backward', () => {
  const now = Date.UTC(2026, 6, 26, 12, 0);
  assert.equal(evidence.getWordGateReadiness({
    evidenceVersion: 1,
    eligibleEvidenceCount: 3,
    lastEligibleEvidenceAt: now - 1000,
  }, null, now, 0).status, 'ready');
  assert.equal(evidence.getWordGateReadiness({
    evidenceVersion: 1,
    eligibleEvidenceCount: 1,
    lastEligibleEvidenceAt: now - (3 * 60 * 60 * 1000),
  }, null, now, 0).status, 'second-review-available');
});

test('word and gate readiness require every loaded gate word', () => {
  const config = { requiredCount: 2, minimumIntervalsMs: [0, 1] };
  assert.equal(evidence.getWordReadiness({ eligibleEvidenceCount: 0 }, config).status, 'needs-evidence');
  assert.equal(evidence.getWordReadiness({ eligibleEvidenceCount: 1 }, config).status, 'progressing');
  assert.equal(evidence.getWordReadiness({ eligibleEvidenceCount: 2 }, config).status, 'ready');
  const gate = evidence.computeGateReadiness([
    { eligibleEvidenceCount: 2 },
    { eligibleEvidenceCount: 1, hiddenFromDictionary: true },
  ], { status: 'learning' }, config);
  assert.equal(gate.status, 'learning');
  assert.equal(gate.readyWordCount, 1);
  assert.equal(gate.requiredWordCount, 2);
  assert.equal(gate.needsEvidenceWordCount, 1);
});

test('verified quiz Evidence stays idempotent and separate from reward implementation', () => {
  assert.match(runtimeSource, /recordQuizEvidenceBatch/);
  assert.match(runtimeSource, /completed: true/);
  assert.match(cloudSource, /function installQuizEvidenceBeforeRewardHook/);
  assert.match(cloudSource, /projectReadiness: false/);
  assert.match(cloudSource, /eventSnapshot\.exists\(\)\) return 'duplicate'/);
  assert.match(cloudSource, /isEligibleRecall\(\{\s*uid: user\.uid,/);
  assert.match(cloudSource, /eligibleEvidenceCount: nextCount/);
  const evidenceBlock = cloudSource.slice(
    cloudSource.indexOf('async function ensureQuizEvidenceSession'),
    cloudSource.indexOf('function createGateClearAttemptId')
  );
  assert.doesNotMatch(evidenceBlock, /awardXP|markDailyQuest|recordChest|dailyStreak/);
});
