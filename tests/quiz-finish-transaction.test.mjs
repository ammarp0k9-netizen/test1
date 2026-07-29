import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const cloudSource = await readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8');
const hookSource = cloudSource.slice(
  cloudSource.indexOf('function installQuizEvidenceBeforeRewardHook'),
  cloudSource.indexOf('const API = Object.freeze')
);

function createHarness() {
  const events = [];
  let evidenceAttempts = 0;
  let failNextEvidence = false;
  let xpCalls = 0;
  const window = {
    auth: { currentUser: { uid: 'quiz-user' } },
    getActiveVerifiedQuizCommitContext(sessionId) {
      return sessionId === 'quiz-session'
        ? { sessionId, mode: 'timeAttack', source: 'personal' }
        : null;
    },
    async awardWordTransitionXPBatch(entries) {
      events.push('xp');
      xpCalls += 1;
      assert.equal(entries.length, 1);
      return { awards: [2], total: 2, pendingCount: 0 };
    },
  };
  const context = vm.createContext({
    window,
    async recordQuizEvidenceBatch(input) {
      events.push('evidence');
      evidenceAttempts += 1;
      assert.equal(input.sessionId, 'quiz-session');
      assert.equal(input.mode, 'timeAttack');
      assert.equal(input.source, 'personal');
      assert.equal(input.completed, true);
      assert.equal(input.projectReadiness, false);
      if (failNextEvidence) {
        failNextEvidence = false;
        const error = new Error('evidence commit rejected');
        error.code = 'permission-denied';
        throw error;
      }
      return { recorded: 1, duplicate: 0, ineligible: 0 };
    },
    Object,
    Promise,
  });
  new vm.Script(`${hookSource}; this.installHook = installQuizEvidenceBeforeRewardHook;`)
    .runInContext(context);
  context.installHook();
  const entries = [{ word: { id: 'published_she', word: 'she' }, result: { correct: true } }];
  return {
    events,
    failEvidenceOnce() { failNextEvidence = true; },
    get evidenceAttempts() { return evidenceAttempts; },
    get xpCalls() { return xpCalls; },
    commit: (sessionId = 'quiz-session') => window.awardWordTransitionXPBatch(entries, sessionId),
  };
}

test('a failed Evidence commit grants no XP and does not project Journey readiness', async () => {
  const harness = createHarness();
  harness.failEvidenceOnce();
  await assert.rejects(harness.commit(), /evidence commit rejected/);
  assert.deepEqual(harness.events, ['evidence']);
  assert.equal(harness.xpCalls, 0);
});

test('retry persists Evidence before granting XP exactly once', async () => {
  const harness = createHarness();
  harness.failEvidenceOnce();
  await assert.rejects(harness.commit(), /evidence commit rejected/);
  harness.events.length = 0;
  const result = await harness.commit();
  assert.deepEqual(harness.events, ['evidence', 'xp']);
  assert.deepEqual(result, { awards: [2], total: 2, pendingCount: 0 });
  assert.equal(harness.evidenceAttempts, 2);
  assert.equal(harness.xpCalls, 1);
});

test('the pre-reward boundary defers Journey projection to the normal post-reward Evidence pass', async () => {
  const harness = createHarness();
  const result = await harness.commit();
  assert.deepEqual(harness.events, ['evidence', 'xp']);
  assert.deepEqual(result, { awards: [2], total: 2, pendingCount: 0 });
});

test('non-verified or guest contexts retain the existing reward path', async () => {
  const harness = createHarness();
  const result = await harness.commit('unrelated-session');
  assert.deepEqual(harness.events, ['xp']);
  assert.deepEqual(result, { awards: [2], total: 2, pendingCount: 0 });
});
