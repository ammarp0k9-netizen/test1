import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync(new URL('../js/worlds.js', import.meta.url), 'utf8');
const revealSource = source.slice(source.indexOf('function captureLootOpening'), source.indexOf('window.startLootChestCharge'));
const openSource = source.slice(source.indexOf('window.openDailyLootBox ='), source.indexOf('function getTitleProgressMetrics'));
const reward = { type: 'freeze', freezes: 1, label: 'Freeze' };
function harness({ guest = false } = {}) {
  let owner = guest ? 'guest' : 'a', freezes = 0, commit = async () => ({ saved: true, applied: true });
  const calls = { intents: [], notices: [], confetti: 0, saves: 0, quests: 0 }, timers = [];
  const element = { disabled: false, classList: { add() {}, remove() {} }, setAttribute() {} };
  const state = { lockedXP: 0, streak: 0, totalOpens: 0, rewards: [] };
  const root = { __lootlinguaAuthGeneration: 1, crypto: { randomUUID: () => 'fixed-id' },
    commitProfileIntent: async intent => { calls.intents.push(structuredClone(intent)); return commit(); } };
  const context = vm.createContext({ window: root, Date, Math, Number,
    getStorageUserId: () => owner, todayStr: () => '2026-11-05',
    getLootAvailability: () => ({ state, ready: true, lockedXP: 0 }), pickDailyLootReward: () => reward,
    document: { getElementById: () => element },
    CHEST_XP_UNLOCK_TEXT: 'Unlock condition',
    showToast: (...args) => calls.notices.push(args), renderTreasureRoom() {},
    launchConfetti: () => calls.confetti++, evaluateTitleUnlocks() {}, updateDailyQuestsBadge() {},
    describeLootReward: value => value.label, updateLootStreak: () => 1,
    getStreakFreezeCount: () => freezes, saveStreakFreezeCount: value => { freezes = value; },
    saveLootState: () => calls.saves++, markDailyQuestFlag: () => calls.quests++, requestProfileCloudSave() {},
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
  });
  vm.runInContext(revealSource + '\n' + openSource, context);
  return { root, context, calls, state, timers, freezes: () => freezes,
    setCommit: fn => { commit = fn; }, switchOwner: uid => { owner = uid; root.__lootlinguaAuthGeneration++; } };
}
for (const result of [{ saved: false }, { saved: true, applied: false, reason: 'chest-cooldown' }]) test(`unconfirmed or rejected openings do not grant or announce a reward: ${JSON.stringify(result)}`, async () => {
  const h = harness(); h.setCommit(async () => result);
  assert.equal(await h.context.revealDailyLootReward(h.state, reward), false);
  assert.equal(h.freezes(), 0); assert.equal(h.calls.saves, 0); assert.equal(h.calls.confetti, 0);
  assert.ok(h.calls.notices.every(row => row[1] !== 'success'));
});
test('acknowledged account opening renders success without a second local grant', async () => {
  const h = harness(); assert.equal(await h.context.revealDailyLootReward(h.state, reward), true);
  assert.equal(h.calls.intents[0].eventId, 'fixed-id'); assert.equal(h.calls.intents[0].type, 'loot-open');
  assert.deepEqual(h.calls.intents[0].reward, reward);
  assert.equal(h.calls.confetti, 1); assert.equal(h.calls.saves, 0); assert.equal(h.calls.quests, 0); assert.equal(h.freezes(), 0);
});
for (const aba of [false, true]) test(`late opening acknowledgements cannot celebrate or grant in a new auth session${aba ? ' including ABA' : ''}`, async () => {
  const h = harness(); let resolve; h.setCommit(() => new Promise(done => { resolve = done; }));
  const operation = h.context.revealDailyLootReward(h.state, reward); h.switchOwner('b'); if (aba) h.switchOwner('a');
  resolve({ saved: true, applied: true }); assert.equal(await operation, false);
  assert.equal(h.calls.confetti, 0); assert.equal(h.calls.notices.length, 0); assert.equal(h.freezes(), 0);
});
test('the delayed opening animation keeps the original owner and does not submit as the next account', async () => {
  const h = harness(); h.root.openDailyLootBox(); h.switchOwner('b'); await h.timers[0]();
  assert.equal(h.calls.intents.length, 0); assert.equal(h.calls.confetti, 0); assert.equal(h.freezes(), 0);
});
test('guest openings keep their local reward path', async () => {
  const h = harness({ guest: true }); assert.equal(await h.context.revealDailyLootReward(h.state, reward), true);
  assert.equal(h.freezes(), 1); assert.equal(h.calls.saves, 1); assert.equal(h.calls.quests, 1); assert.equal(h.calls.intents.length, 0);
});
