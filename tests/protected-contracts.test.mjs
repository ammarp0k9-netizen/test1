import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
// Protect deck selection, verified commits and runtime/SRS integration by
// executing their existing behavioral suites, rather than freezing source text.
import './quiz-core.test.mjs';
import './quiz-finish-transaction.test.mjs';
import './quiz-learning-regression.test.mjs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing behavioral fixture section: ${start}`);
  return source.slice(from, to);
}

test('SRS keeps separate-day recalls, the 72-hour mastery window, and one 2/4/8/3 transition reward', async () => {
  const awards = [];
  const context = vm.createContext({
    getWordMasteryState: word => structuredClone(word),
    getWordMasteryKey: word => word.wordKey,
    getQuizDay: timestamp => new Date(timestamp).toISOString().slice(0, 10),
    async awardXP(amount, reason, metadata) { metadata.awardStatus = 'awarded'; awards.push({ amount, reason, id: metadata.eventId }); return amount; },
  });
  const windowDeclaration = read('js/srs.js').match(/const SRS_MASTERY_WINDOW_MS\s*=[^;]+;/)?.[0];
  assert.ok(windowDeclaration);
  vm.runInContext(section(read('js/xp.js'), 'const XP_ECONOMY_VERSION', 'const XP_EVENT_LOG_KEY') + '\n' + windowDeclaration + '\n' + read('js/srs-transitions.js'), context);
  let word = { wordKey: 'apple', mastery_status: 'New', mastery_streak: 0, mastered_once: false };
  const day = 86400000, start = Date.UTC(2026, 0, 1, 12);
  async function recall(correct, session, at) {
    const update = context.computeSrsUpdate(word, correct, session, at);
    const amount = await context.awardWordTransitionXP(word, update, session);
    word = { ...word, ...update.state };
    return amount;
  }
  assert.equal(await recall(true, 'first', start), 2);
  assert.equal(await recall(true, 'first', start + day), 0, 'one session cannot advance twice');
  assert.equal(await recall(true, 'same-day', start + 1000), 0, 'a second session on one day cannot advance');
  assert.equal(await recall(true, 'second', start + day), 4);
  assert.equal(await recall(true, 'too-early', start + 2 * day), 0);
  assert.equal(word.mastery_status, 'Reviewing');
  assert.equal(await recall(true, 'mastery', start + 3 * day), 8);
  assert.equal(word.mastery_status, 'Mastered');
  assert.equal(word.mastered_once, true);
  await recall(false, 'wrong', start + 4 * day);
  assert.equal(word.mastery_status, 'Reviewing');
  assert.equal(word.mastered_once, true);
  assert.equal(await recall(true, 'remastery', start + 5 * day), 3);
  await recall(false, 'wrong-again', start + 6 * day);
  assert.equal(await recall(true, 'remastery-again', start + 7 * day), 0);
  assert.deepEqual(awards.map(item => item.amount), [2, 4, 8, 3]);
  assert.equal(new Set(awards.map(item => item.id)).size, 4);
});

test('cloud XP rejects invalid amounts, commits once per owner, and never shares receipt identity between accounts', async () => {
  const values = new Map(), auth = { currentUser: { uid: 'a' } }, root = {};
  const context = vm.createContext({
    window: root, auth, db: {},
    doc: (_, ...parts) => parts.join('/'),
    async runTransaction(_, callback) {
      const writes = [];
      const result = await callback({
        async get(key) { return { exists: () => values.has(key), data: () => values.get(key) }; },
        set(key, value, options) { writes.push({ key, value, options }); },
      });
      for (const { key, value, options } of writes) values.set(key, options?.merge ? { ...values.get(key), ...value } : value);
      return result;
    },
  });
  vm.runInContext(section(read('js/cloud.js'), 'window.claimXPEventInCloud =', 'window.listenCustomWorldWordsFromCloud ='), context);
  const payload = { eventId: 'word_transition:apple:new_learning', reason: 'word_transition_new_learning', amount: 2 };
  const invalid = await root.claimXPEventInCloud({ ...payload, amount: 200 });
  assert.equal(invalid.invalid, true);
  assert.equal(values.size, 0);
  assert.equal((await root.claimXPEventInCloud(payload)).awarded, true);
  assert.equal(values.get('users/a/meta/profile').userXP, 2);
  assert.equal((await root.claimXPEventInCloud(payload)).duplicate, true);
  assert.equal(values.get('users/a/meta/profile').userXP, 2);
  auth.currentUser = { uid: 'b' };
  assert.equal((await root.claimXPEventInCloud(payload)).awarded, true);
  assert.equal(values.get('users/b/meta/profile').userXP, 2);
  assert.equal(values.get('users/a/meta/profile').userXP, 2);
});
