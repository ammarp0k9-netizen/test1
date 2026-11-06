import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

function runner() {
  const values = new Map();
  const context = {
    window: { auth: { currentUser: { uid: 'player-1' } } },
    localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    Date, Number, String, Array, JSON, Math, Object, Set,
  };
  vm.runInNewContext(fs.readFileSync(new URL('../js/runner-engine.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(new URL('../js/gate-runner.js', import.meta.url), 'utf8'), context);
  return context.window.LootLinguaGateRunner;
}

test('retired Gate Expedition is absent from both assets and application entrypoints', () => {
  assert.equal(fs.existsSync(new URL('../js/gate-expedition.js', import.meta.url)), false);
  for (const file of ['index.html', 'js/worlds.js', 'js/script.js']) {
    assert.doesNotMatch(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), /LootLinguaGateExpedition|gate-expedition\.js/);
  }
});

test('the remaining optional Runner is blocked while an official review is due', () => {
  const api = runner();
  assert.equal(api.reviewIsDue({ availableForReviewNowCount: 1 }, 1000), true);
  assert.equal(api.reviewIsDue({ readinessNextAt: 999 }, 1000), true);
  assert.equal(api.reviewIsDue({ readinessNextAt: 1001 }, 1000), false);
});

test('completing the exact official due-word set releases the optional Runner without a progression write', () => {
  const api = runner();
  const progress = { availableForReviewNowCount: 2, runnerReviewDueWordKeys: ['one', 'two'], runnerReviewCompletedDueWordKeys: ['one'] };
  const before = structuredClone(progress);
  assert.equal(api.reviewIsDue(progress, 1000), true);
  assert.deepEqual(progress, before);
  assert.equal(api.reviewIsDue({ ...progress, runnerReviewCompletedDueWordKeys: ['one', 'two'] }, 1000), false);
});

test('Runner gameplay keeps its source dictionary and SRS fields unchanged', () => {
  const api = runner();
  const words = [{ word: 'Apple', meaning: 'fruit', mastery_status: 'Reviewing', eligibleEvidenceCount: 2 }];
  const before = structuredClone(words);
  const state = api.createState(words);
  state.running = true;
  api.step(state, 16000, () => 0.3);
  api.chooseLane(state, state.event?.correctLane || 0, 1000);
  assert.deepEqual(words, before);
  assert.doesNotMatch(fs.readFileSync(new URL('../js/gate-runner.js', import.meta.url), 'utf8'), /recordQuizEvidenceBatch|awardWordTransitionXP|updateGateProgress|upsertUserWordWithSource/);
});
