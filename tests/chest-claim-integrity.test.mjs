import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../js/worlds.js', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('const chestXPUnlockInFlight'), source.indexOf('function evaluateChestXPUnlock'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness() {
  let owner = 'a', award = async metadata => { metadata.awardStatus = 'awarded'; return 20; };
  const states = new Map(['a', 'b'].map(uid => [uid, { lockedXP: 20, lockStartedAt: 100, lockMasteredWordIds: ['one', 'two'], lockHighAccuracyQuizIds: ['quiz'], streak: 5 }]));
  const calls = { claims: 0, saves: 0, badges: 0, toasts: 0 };
  const root = { __lootlinguaAuthGeneration: 1 };
  const context = vm.createContext({ window: root, Map, JSON, Date,
    getStorageUserId: () => owner,
    getLootState: () => structuredClone(states.get(owner)), todayStr: () => '2026-11-05',
    awardXP: async (_amount, _reason, metadata) => { calls.claims++; return award(metadata); },
    saveChestProgressState: state => { calls.saves++; states.set(owner, structuredClone(state)); },
    showXPBadge: () => calls.badges++, showToast: () => calls.toasts++,
  });
  vm.runInContext(section, context);
  return { context, root, calls, states, claim: () => context.unlockChestXP(),
    setAward: fn => { award = fn; }, switchOwner: uid => { owner = uid; root.__lootlinguaAuthGeneration++; } };
}

for (const status of ['invalid', 'unavailable', 'pending', undefined]) test(`a ${status} chest claim retains its locked XP and qualification for retry`, async () => {
  const h = harness(); h.setAward(async metadata => { metadata.awardStatus = status; return 0; });
  assert.equal(await h.claim(), false); assert.equal(h.states.get('a').lockedXP, 20);
  assert.equal(h.states.get('a').lockMasteredWordIds.length, 2); assert.equal(h.calls.saves, 0); assert.equal(h.calls.badges, 0);
});

for (const status of ['awarded', 'duplicate']) test(`only a confirmed ${status} chest claim resolves the lock`, async () => {
  const h = harness(); h.setAward(async metadata => { metadata.awardStatus = status; return status === 'awarded' ? 20 : 0; });
  assert.equal(await h.claim(), true); assert.equal(h.states.get('a').lockedXP, 0); assert.equal(h.calls.saves, 1);
  assert.equal(h.calls.badges, status === 'awarded' ? 1 : 0); assert.equal(h.states.get('a').streak, 5);
});

test('failed claims remain retryable and overlapping claims use one request', async () => {
  const h = harness(), gate = deferred(); h.setAward(async metadata => { await gate.promise; metadata.awardStatus = 'invalid'; return 0; });
  const first = h.claim(), second = h.claim(); assert.equal(h.calls.claims, 1); gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  h.setAward(async metadata => { metadata.awardStatus = 'awarded'; return 20; }); assert.equal(await h.claim(), true);
});

for (const aba of [false, true]) test(`a late chest result cannot resolve another auth session${aba ? ' including A to B to A' : ''}`, async () => {
  const h = harness(), gate = deferred(); h.setAward(async metadata => { await gate.promise; metadata.awardStatus = 'awarded'; return 20; });
  const first = h.claim(); h.switchOwner('b'); if (aba) h.switchOwner('a'); gate.resolve();
  assert.equal(await first, false); assert.equal(h.calls.saves, 0); assert.equal(h.calls.badges, 0);
  assert.equal(h.states.get('a').lockedXP, 20); assert.equal(h.states.get('b').lockedXP, 20);
});

test('an old account claim does not block a new account claim', async () => {
  const h = harness(), gate = deferred(); h.setAward(async metadata => { await gate.promise; metadata.awardStatus = 'awarded'; return 20; });
  const first = h.claim(); h.switchOwner('b'); h.setAward(async metadata => { metadata.awardStatus = 'awarded'; return 20; });
  assert.equal(await h.claim(), true); gate.resolve(); assert.equal(await first, false);
  assert.equal(h.states.get('a').lockedXP, 20); assert.equal(h.states.get('b').lockedXP, 0);
});

test('late acknowledgement cannot erase a different pending chest or newer unrelated state', async () => {
  const h = harness(), gate = deferred(); h.setAward(async metadata => { await gate.promise; metadata.awardStatus = 'awarded'; return 20; });
  const first = h.claim(); h.states.get('a').lockStartedAt = 200; gate.resolve(); assert.equal(await first, false);
  assert.equal(h.states.get('a').lockedXP, 20); assert.equal(h.calls.saves, 0);
  h.setAward(async metadata => { h.states.get('a').streak = 9; metadata.awardStatus = 'awarded'; return 20; });
  assert.equal(await h.claim(), true); assert.equal(h.states.get('a').streak, 9);
});

test('signed-in chest XP waits for pending profile work and does not claim after a failed or stale flush', async () => {
  const h = harness(); h.root.auth = { currentUser: { uid: 'a' } };
  h.root.flushProfileIntents = async () => ({ saved: false });
  assert.equal(await h.claim(), false); assert.equal(h.calls.claims, 0);
  const gate = deferred(); h.root.flushProfileIntents = () => gate.promise;
  const first = h.claim(); h.switchOwner('b'); gate.resolve({ saved: true });
  assert.equal(await first, false); assert.equal(h.calls.claims, 0);
});
