import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { applyProfileIntent, profileOperationId, profileStorageIntents, mergeOnboardingProgress } from '../js/profile-sync-policy.mjs';

const source = (await readFile(new URL('../js/profile-cloud.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const clone = (value) => value === undefined ? undefined : structuredClone(value);
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}
function database(profile = {}) {
  const docs = new Map([['users/A/meta/profile', clone(profile)]]);
  const versions = new Map();
  const controls = { pause: null, ackPause: null, loseAck: false, transactions: 0, commits: 0 };
  const snapshot = (ref) => { const value = clone(docs.get(ref)); return { exists: () => value !== undefined, data: () => clone(value) }; };
  const write = (ref, value, options = {}) => {
    docs.set(ref, options.merge ? { ...docs.get(ref), ...clone(value) } : clone(value));
    versions.set(ref, (versions.get(ref) || 0) + 1);
  };
  async function runTransaction(_db, callback) {
    for (let attempt = 0; attempt < 12; attempt++) {
      controls.transactions++;
      const reads = new Map(), writes = [];
      const result = await callback({
        async get(ref) {
          reads.set(ref, versions.get(ref) || 0);
          const snap = snapshot(ref);
          if (controls.pause && ref.endsWith('/profile')) {
            const pause = controls.pause; controls.pause = null;
            pause.started.resolve(); await pause.release.promise;
          }
          return snap;
        },
        set: (ref, value, options) => writes.push([ref, value, options]),
      });
      if ([...reads].some(([ref, version]) => version !== (versions.get(ref) || 0))) continue;
      writes.forEach((args) => write(...args));
      controls.commits++;
      if (controls.ackPause) {
        const pause = controls.ackPause; controls.ackPause = null;
        pause.started.resolve(); await pause.release.promise;
      }
      if (controls.loseAck) { controls.loseAck = false; throw Object.assign(new Error('Acknowledgement lost'), { code: 'unavailable' }); }
      return result;
    }
    throw new Error('Transaction retry limit');
  }
  return { docs, controls, snapshot, runTransaction, write, profile: () => docs.get('users/A/meta/profile') };
}
function client(db, options = {}) {
  const localStorage = options.storage || storage();
  const auth = { currentUser: { uid: 'A' } };
  const timers = new Map(); let timer = 0;
  let local = clone(options.local || db.profile());
  const errors = [];
  const subscribers = [];
  const root = {
    auth, __lootlinguaAuthGeneration: 1,
    __lootlinguaProfileSnapshot: { uid: 'A', exists: true, data: clone(db.profile()), readFailed: false },
    getLootlinguaProfilePayload: () => clone(local),
    resetLootlinguaProfileState: () => { local = {}; },
    mergeLootlinguaProfileFromCloud: (data) => { Object.assign(local, clone(data)); },
    dispatchEvent() {}, addEventListener() {}, markInitialFeatureLoadPartDone() {},
    hasMeaningfulGuestLoot: ({ profile }) => Boolean(profile?.userXP || profile?.runnerCoins),
  };
  vm.runInNewContext(source, {
    window: root, localStorage, sessionStorage: storage(), Date, Math, JSON,
    applyProfileIntent, profileOperationId, profileStorageIntents, mergeOnboardingProgress, queueMicrotask,
    console: { error: (...args) => errors.push(args) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    getApps: () => [{}], getFirestore: () => db, getAuth: () => auth, onAuthStateChanged() {},
    doc: (_db, ...parts) => parts.join('/'), getDoc: async (ref) => db.snapshot(ref),
    runTransaction: db.runTransaction, onSnapshot: (_ref, callback) => {
      const subscriber = { callback, active: true }; subscribers.push(subscriber);
      return () => { subscriber.active = false; };
    },
    setTimeout: (callback) => { timers.set(++timer, callback); return timer; }, clearTimeout: (id) => timers.delete(id),
  });
  return { root, errors, localStorage, get local() { return local; },
    emitProfile() { for (const subscriber of subscribers) if (subscriber.active) subscriber.callback(db.snapshot('users/A/meta/profile')); },
    switchTo(uid) { auth.currentUser = { uid }; root.__lootlinguaAuthGeneration++; },
    get pending() { return [...Array(localStorage.length)].map((_value, index) => localStorage.key(index)).filter((key) => key.startsWith('lootlingua:profile-outbox:')); },
  };
}

test('stale full snapshots cannot overwrite XP, spendable balances, counters or streak tuples', async () => {
  const db = database({ userXP: 500, runnerCoins: 2, streakFreezes: 0, dailyStreak: 1, lastActivityDate: '2026-11-04', perfectQuizzes: 9 });
  const stale = client(db, { local: { userXP: 100, runnerCoins: 100, streakFreezes: 5, dailyStreak: 90, perfectQuizzes: 0, xpEconomyVersion: 2 } });
  assert.equal(await stale.root._saveProfileToCloudNow(), true);
  assert.equal(db.profile().userXP, 500);
  assert.equal(db.profile().runnerCoins, 2);
  assert.equal(db.profile().streakFreezes, 0);
  assert.equal(db.profile().dailyStreak, 1);
  assert.equal(db.profile().perfectQuizzes, 9);
});

test('two devices preserve legitimate wallet deltas through transaction retries', async () => {
  const db = database({ runnerCoins: 5, streakFreezes: 2 });
  const a = client(db), b = client(db);
  const results = await Promise.all([
    a.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: 4, eventId: 'run-A' }),
    b.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: 7, eventId: 'run-B' }),
  ]);
  assert.ok(results.every((result) => result.saved && result.applied));
  assert.equal(db.profile().runnerCoins, 16);
  assert.ok(db.controls.transactions > 2, 'the optimistic harness must exercise conflict retries');
  await b.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: -15, eventId: 'spend-B' });
  await a.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: 3, eventId: 'run-A2' });
  assert.equal(db.profile().runnerCoins, 4);
  const rejected = await a.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: -10, eventId: 'overdraw' });
  assert.equal(rejected.saved, true);
  assert.equal(rejected.applied, false);
  assert.equal(rejected.reason, 'insufficient-balance');
  assert.equal(a.local.runnerCoins, 4);
});

test('lost acknowledgements and another tab replay the same immutable operation without another credit', async () => {
  const db = database({ runnerCoins: 10 });
  const shared = storage();
  const a = client(db, { storage: shared });
  db.controls.loseAck = true;
  const intent = { type: 'wallet-delta', field: 'runnerCoins', amount: 5, eventId: 'same-run' };
  assert.equal((await a.root.commitProfileIntent(intent)).saved, false);
  assert.equal(db.profile().runnerCoins, 15);
  assert.equal(a.pending.length, 1);
  const b = client(db, { storage: shared });
  assert.equal((await b.root.flushProfileIntents()).saved, true);
  assert.equal(db.profile().runnerCoins, 15);
  assert.equal(b.pending.length, 0);
  assert.equal((await a.root.commitProfileIntent(intent)).saved, true);
  assert.equal(db.profile().runnerCoins, 15);
});

test('a new operation queued while an acknowledgement is pending is preserved and hydrated once', async () => {
  const db = database({ runnerCoins: 0 });
  const a = client(db);
  const pause = { started: deferred(), release: deferred() }; db.controls.pause = pause;
  const first = a.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: 2, eventId: 'first' });
  await pause.started.promise;
  const second = a.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: 3, eventId: 'second' });
  pause.release.resolve();
  const results = await Promise.all([first, second]);
  assert.ok(results.every((result) => result.saved && result.applied));
  assert.equal(db.profile().runnerCoins, 5);
  assert.equal(a.local.runnerCoins, 5);
  assert.equal(a.pending.length, 0);
});

test('ABA invalidates a pending transaction without applying A data into the newer session', async () => {
  const db = database({ runnerCoins: 10 });
  const a = client(db);
  const pause = { started: deferred(), release: deferred() }; db.controls.pause = pause;
  const saving = a.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: 5, eventId: 'held' });
  await pause.started.promise;
  a.switchTo('B'); a.switchTo('A');
  pause.release.resolve();
  assert.equal((await saving).saved, false);
  assert.equal(db.profile().runnerCoins, 10);
  assert.equal(a.pending.length, 1);
});

test('the same verified quiz on two devices increments activity, perfect count and protected day only once', async () => {
  const db = database({ dailyStreak: 8, maxStreak: 8, lastActivityDate: '2026-11-03', streakFreezes: 1, freezeSaves: 0 });
  const a = client(db), b = client(db);
  const intent = { type: 'quiz-activity', eventId: 'quiz:verified-session', day: '2026-11-05', answers: 10, perfect: true, advanceAfterFreeze: true };
  await Promise.all([a.root.commitProfileIntent(intent), b.root.commitProfileIntent(intent)]);
  assert.equal(db.profile().dailyStreak, 9);
  assert.equal(db.profile().streakFreezes, 0);
  assert.equal(db.profile().freezeSaves, 1);
  assert.equal(db.profile().activityMap['2026-11-05'], 10);
  assert.equal(db.profile().perfectQuizzes, 1);
  assert.equal(db.profile().dailyQuestState.flags.perfectQuiz, true);
});

test('guest snapshot receipts remain permanent after recovery cleanup and later spending', async () => {
  const db = database({ userXP: 100, runnerCoins: 10, streakFreezes: 0 });
  const a = client(db), b = client(db);
  const imported = { type: 'guest-import', eventId: 'guest-snapshot', profile: { userXP: 180, runnerCoins: 5, streakFreezes: 1 } };
  assert.equal((await a.root.commitProfileIntent(imported)).saved, true);
  await b.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: -7, eventId: 'spent' });
  await b.root.commitProfileIntent({ type: 'learning-day', day: '2026-11-05' });
  await a.root.commitProfileIntent(imported);
  assert.equal(db.profile().runnerCoins, 8);
  assert.equal(db.profile().streakFreezes, 1);
  assert.equal(db.profile().userXP, 180);
});

test('simultaneous chest openings confirm at most one reward and spent freezes do not reappear', async () => {
  const db = database({ streakFreezes: 0, dailyLootState: {} });
  const a = client(db), b = client(db);
  const at = new Date('2026-11-05T12:00:00Z').getTime();
  const results = await Promise.all(['a', 'b'].map((id, index) => [a, b][index].root.commitProfileIntent({ type: 'loot-open', eventId: id, day: '2026-11-05', at, reward: { type: 'freeze', freezes: 1 } })));
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal(db.profile().streakFreezes, 1);
  assert.equal(db.profile().dailyLootState.totalOpens, 1);
  await b.root.commitProfileIntent({ type: 'wallet-delta', field: 'streakFreezes', amount: -1, eventId: 'freeze-spend' });
  await a.root._saveProfileToCloudNow();
  assert.equal(db.profile().streakFreezes, 0);
});

test('old quest dates cannot replace newer claims; removed legacy extra chests cannot be resurrected', async () => {
  const db = database({ dailyQuestDate: '2026-11-05', dailyQuestState: { claimed: { today: true }, flags: {} }, extraChests: [{ id: 'legacy' }] });
  const a = client(db), b = client(db);
  await a.root.commitProfileIntent({ type: 'quest', day: '2026-11-04', state: { claimed: { yesterday: true } } });
  assert.equal(db.profile().dailyQuestDate, '2026-11-05');
  assert.equal(db.profile().dailyQuestState.claimed.today, true);
  await b.root.commitProfileIntent({ type: 'extra-remove', chestId: 'legacy', eventId: 'consume' });
  await a.root.commitProfileIntent({ type: 'extra-add', chests: [{ id: 'legacy' }], eventId: 'stale-copy' });
  assert.deepEqual(db.profile().extraChests, []);
});

test('multiple absent days spend one freeze per day only when the entire gap is covered', async () => {
  for (const [freezes, expectedBalance, expectedStreak, expectedSaves] of [[3, 1, 9, 2], [2, 0, 9, 2], [1, 1, 1, 0], [0, 0, 1, 0]]) {
    const db = database({ dailyStreak: 8, lastActivityDate: '2026-11-02', streakFreezes: freezes, freezeSaves: 0 });
    const a = client(db), b = client(db);
    await Promise.all([a, b].map(c => c.root.commitProfileIntent({ type: 'quiz-activity', eventId: 'same-session', day: '2026-11-05', answers: 4 })));
    assert.equal(db.profile().streakFreezes, expectedBalance);
    assert.equal(db.profile().dailyStreak, expectedStreak);
    assert.equal(db.profile().freezeSaves, expectedSaves);
    assert.equal(db.profile().activityMap['2026-11-05'], 4);
  }
});

test('pending unconfirmed credits are not projected as spendable balances or counted twice', async () => {
  const db = database({ runnerCoins: 10, streakFreezes: 1, activityMap: {} });
  const a = client(db);
  a.root.queueProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: 20, eventId: 'pending-run' });
  assert.equal(a.local.runnerCoins, 10);
  a.root.queueProfileIntent({ type: 'quiz-activity', eventId: 'pending-quiz', day: '2026-11-05', answers: 5 });
  assert.deepEqual(a.local.activityMap, {});
  assert.equal((await a.root.flushProfileIntents()).saved, true);
  assert.equal(a.local.runnerCoins, 30);
  assert.equal(a.local.activityMap['2026-11-05'], 5);
});

test('a delayed older acknowledgement cannot revert a newer appearance revision', async () => {
  const db = database({ userXP: 100, theme: 'lootlingua', runnerCoins: 1 });
  const a = client(db), b = client(db);
  await a.root.loadProfileFromCloud({ uid: 'A' });
  const pause = { started: deferred(), release: deferred() }; db.controls.ackPause = pause;
  const old = a.root.commitProfileIntent({ type: 'quest', day: '2026-11-05', state: { flags: { openLoot: true } } });
  await pause.started.promise;
  assert.equal(await b.root.saveProfilePreferencesToCloud({ theme: 'ocean' }), true);
  a.emitProfile();
  assert.equal(a.local.theme, 'ocean');
  pause.release.resolve(); await old;
  assert.equal(a.local.theme, 'ocean');
  assert.equal(a.root.__lootlinguaProfileSnapshot.data.theme, 'ocean');
  assert.equal(db.profile().theme, 'ocean');
});

test('an older profile acknowledgement cannot revive a chest resolved by the actual XP transaction', async () => {
  const db = database({ userXP: 100, dailyLootState: { lockedXP: 20, lockStartedAt: 100, lastOpenAt: 100 } });
  const a = client(db);
  await a.root.loadProfileFromCloud({ uid: 'A' });
  const cloud = await readFile(new URL('../js/cloud.js', import.meta.url), 'utf8');
  vm.runInNewContext(cloud.slice(cloud.indexOf('  window.claimXPEventInCloud ='), cloud.indexOf('  window.listenCustomWorldWordsFromCloud =')), {
    window: a.root, auth: a.root.auth, db, Date, doc: (_db, ...parts) => parts.join('/'), runTransaction: db.runTransaction,
  });
  const pause = { started: deferred(), release: deferred() }; db.controls.ackPause = pause;
  const old = a.root.commitProfileIntent({ type: 'quest', day: '2026-11-05', state: { flags: { openLoot: true } } });
  await pause.started.promise;
  assert.equal((await a.root.claimXPEventInCloud({ amount: 20, reason: 'daily_chest_unlock', eventId: 'daily_chest_unlock:100', baselineXP: 100 })).awarded, true);
  a.emitProfile(); pause.release.resolve(); await old;
  assert.equal(db.profile().dailyLootState.lockedXP, 0);
  assert.equal(a.local.dailyLootState.lockedXP, 0);
  assert.equal(a.root.__lootlinguaProfileSnapshot.data.dailyLootState.lockedXP, 0);
  assert.equal(a.local.userXP, 120);
});

test('storage mutation hooks synchronize set/flag writes but cannot turn a cached balance into credits', async () => {
  const db = database({ userXP: 500, streakFreezes: 0, runnerCoins: 2, addedGameWords: [] });
  const a = client(db); await a.root.loadProfileFromCloud({ uid: 'A' });
  a.root.recordProfileStorageMutation('lootlinguaStreakFreezes', '0', '999');
  a.root.recordProfileStorageMutation('userXP', '500', '999999');
  a.root.recordProfileStorageMutation('addedGameWords', '[]', '["word"]');
  await a.root.flushProfileIntents();
  assert.equal(db.profile().streakFreezes, 0); assert.equal(db.profile().userXP, 500);
  assert.deepEqual(db.profile().addedGameWords, ['word']);
});


test('onboarding checkpoints merge monotonically without affecting rewards', () => {
  let profile = {userXP: 42, runnerCoins: 7};
  const apply = (tour, state) => { profile = applyProfileIntent(profile, {type: 'onboarding', tour, state}).profile; };
  apply('treasure', {status:'completed', completedAt:100, updatedAt:100});
  apply('treasure', {status:'in-progress', step:5, updatedAt:500});
  apply('quiz', {status:'completed', completedAt:200});
  apply('personal-dictionary', {phase:'completed', step:16, completedAt:300});
  apply('personal-dictionary', {phase:'intro', step:0, updatedAt:900});
  assert.equal(profile.onboardingProgress.treasure.status, 'completed');
  assert.equal(profile.onboardingProgress.quiz.status, 'completed');
  assert.equal(profile.onboardingProgress['personal-dictionary'].phase, 'completed');
  assert.equal(profile.userXP, 42); assert.equal(profile.runnerCoins, 7);
  assert.equal(mergeOnboardingProgress('quiz', {status:'in-progress',step:4}, {status:'in-progress',step:1,updatedAt:900}).step, 4);
});

test('account onboarding imports local completion and restores it to another device', async () => {
  const db = database({userXP:42}); const a = client(db);
  const key = 'lootlingua:feature-discovery:v1:user:A';
  a.localStorage.setItem(key, JSON.stringify({version:1,features:{treasure:{status:'completed',completedAt:100,updatedAt:100}}}));
  a.localStorage.setItem('lootlingua:personal-dictionary-onboarding:v1:user:A', JSON.stringify({version:1,phase:'completed',step:16,completedAt:100}));
  await a.root.loadProfileFromCloud({uid:'A'});
  await a.root.flushProfileIntents();
  assert.equal(db.profile().onboardingProgress.treasure.status, 'completed');
  const b = client(db); await b.root.loadProfileFromCloud({uid:'A'});
  assert.equal(JSON.parse(b.localStorage.getItem(key)).features.treasure.status, 'completed');
  assert.equal(JSON.parse(b.localStorage.getItem('lootlingua:personal-dictionary-onboarding:v1:user:A')).phase, 'completed');
  b.switchTo('B');
  assert.equal(b.localStorage.getItem('lootlingua:feature-discovery:v1:user:B'), null);
});
