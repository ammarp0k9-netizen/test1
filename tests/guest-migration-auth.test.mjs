import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deferred, flushMicrotasks } from './profile-cloud-harness.mjs';

const script = await readFile(new URL('../js/script.js', import.meta.url), 'utf8');
const migration = script.slice(
  script.indexOf('let activeGuestMigrationSession = null;'),
  script.indexOf('function beginViewSwitch()')
);

function createHarness() {
  const values = new Map([['guest-data', 'retained']]);
  const listeners = new Map();
  const calls = [];
  const ui = [];
  const errors = [];
  const hooks = {};
  const credits = new Map();
  const elements = new Map();
  const loot = {
    words: [{ word: 'guest-word', wordKey: 'guest-word' }],
    profile: { userXP: 180, runnerCoins: 5 },
    pendingCustomWorlds: [],
    wordMastery: { first: { level: 1 }, second: { level: 2 } },
    activeQuizSession: { id: 'guest-quiz', resumable: true },
  };
  const worlds = [{ id: 'world-1' }, { id: 'world-2' }];
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const profileKey = (uid) => `lootlingua:guest-profile-migration:v1:user:${uid}`;
  const root = {
    auth: { currentUser: { uid: 'A' } },
    __lootlinguaAuthGeneration: 1,
    words: [{ word: 'account-A' }],
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  const invoke = (stage, fallback, ...args) => {
    const uid = root.auth.currentUser?.uid;
    calls.push({ stage, uid, args });
    return Promise.resolve(hooks[stage] ? hooks[stage](uid, ...args) : fallback(...args));
  };
  root.migrateGuestWordsToCloud = (words, options) => invoke('words', () => words.map((_word, wordIndex) => ({
    wordIndex, wordId: `${root.auth.currentUser.uid}-guest-${wordIndex}`,
  })), words, options);
  root.saveCustomWorldToCloud = (world) => invoke('world', () => true, world);
  root.saveCustomWorldWordToCloud = (worldId, word) => invoke('worldWord', () => word.id, worldId, word);
  root.saveGlobalWordMasteryToCloud = (wordKey, state) => invoke('mastery', () => true, wordKey, state);
  root.applyGlobalWordMasterySnapshot = (state) => calls.push({ stage: 'apply-mastery', uid: root.auth.currentUser.uid, state });
  root.loadActiveQuizSessionFromCloud = () => invoke('quizRead', () => null);
  root.saveActiveQuizSessionToCloud = (session) => invoke('quizWrite', () => true, session);
  root.commitPendingGuestProfileMigration = (user) => invoke('profile', () => {
    const key = profileKey(user.uid);
    const pending = JSON.parse(localStorage.getItem(key));
    if (!pending.profileCommittedAt) {
      credits.set(user.uid, (credits.get(user.uid) || 0) + pending.profile.runnerCoins);
      pending.profileCommittedAt = Date.now();
      localStorage.setItem(key, JSON.stringify(pending));
    }
    root.__acceptedGuestProfileMigration = pending;
    return true;
  }, user);
  root.LootLinguaNotificationStore = {
    migrateGuestToOwner: (uid) => invoke('notifications', () => true, uid),
  };
  root.finalizePendingGuestProfileMigration = (user) => {
    calls.push({ stage: 'finalize', uid: user.uid });
    localStorage.removeItem(profileKey(user.uid));
  };
  const bindings = {
    window: root,
    document: { getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, { disabled: false, textContent: 'initial' });
      return elements.get(id);
    } },
    localStorage,
    console: { error: (...args) => errors.push(args) },
    setGuestMigrationBusy: (busy, message) => ui.push({ type: 'busy', uid: root.auth.currentUser?.uid, busy, message }),
    hideModal: (name) => ui.push({ type: 'hide', name }),
    showToast: (message, kind) => ui.push({ type: 'toast', message, kind }),
    renderGuestMigrationModal: (summary) => ui.push({ type: 'prompt', uid: summary.user.uid }),
    shouldSkipGuestMigrationPrompt: () => false,
    getGuestLootSnapshot: () => structuredClone(loot),
    ensureGuestMigrationSnapshotId: () => 'guest-snapshot',
    hasMeaningfulGuestLoot: (snapshot) => Boolean(snapshot.words.length || snapshot.profile.runnerCoins),
    normalizeMigrationWordKey: (word) => word.wordKey || word.word,
    dedupeCustomWorlds: (items) => items,
    readCustomWorldsFromStorage: () => worlds,
    normalizeCustomWorldPayload: (world) => world,
    readCustomWorldWordsFromStorage: (worldId) => [{ id: `${worldId}-word-1` }, { id: `${worldId}-word-2` }],
    writeCustomWorldWordsToStorage: (worldId, words, uid) => calls.push({ stage: 'store-world-words', uid, worldId, words }),
    applyStoredWordOrder: (words) => words,
    writeCustomWorldsToStorage: (_worlds, uid) => calls.push({ stage: 'store-worlds', uid }),
    renderCustomWorldCards: () => ui.push({ type: 'world-cards', uid: root.auth.currentUser?.uid }),
    loadJSON: () => null,
    isResumableQuizSession: (session) => session?.resumable === true,
    writeWordsToStorage: (_words, _type, uid) => calls.push({ stage: 'store-words', uid }),
    markGuestMigrationCompleteFlag: (user, status, guestSnapshotId) => {
      calls.push({ stage: 'receipt', uid: user.uid, status, guestSnapshotId });
      localStorage.setItem('complete', user.uid);
      localStorage.setItem('handled', user.uid);
      root.__guestMigrationSessionComplete = true;
      root.__guestMigrationSessionDecision = { uid: user.uid, status, guestSnapshotId };
    },
    purgeStaleGuestLocalData: () => { calls.push({ stage: 'purge' }); localStorage.removeItem('guest-data'); },
    saveAndRender: () => calls.push({ stage: 'save-render', uid: root.auth.currentUser?.uid }),
    GUEST_MIGRATION_COMPLETE_KEY: 'complete',
    GUEST_MIGRATION_HANDLED_KEY: 'handled',
  };
  new Function(...Object.keys(bindings), `let customWorlds = [];\n${migration}`)(...Object.values(bindings));
  return {
    root, values, calls, ui, errors, hooks, credits, elements, profileKey,
    switchTo(uid, prepare = true) {
      root.auth.currentUser = uid ? { uid } : null;
      root.__lootlinguaAuthGeneration++;
      root.words = uid ? [{ word: `account-${uid}` }] : [];
      listeners.get('lootlingua:auth-state')?.();
      return prepare ? root.prepareGuestMigrationForUser(root.auth.currentUser) : null;
    },
  };
}

test('each awaited migration stage stops before another upload, local merge or cleanup after A to B', async (t) => {
  for (const stage of ['words', 'world', 'worldWord', 'mastery', 'quizRead', 'quizWrite', 'profile', 'notifications']) {
    await t.test(stage, async () => {
      const h = createHarness();
      const pending = deferred();
      h.hooks[stage] = () => pending.promise;
      let aDecision;
      const aPromise = h.root.prepareGuestMigrationForUser({ uid: 'A' });
      aPromise.then((decision) => { aDecision = decision; });
      const a = h.root.confirmGuestMigration();
      await flushMicrotasks();
      assert.ok(h.calls.some((call) => call.stage === stage), `${stage} must be reached`);
      const bPromise = h.switchTo('B');
      let bDecision;
      bPromise.then((decision) => { bDecision = decision; });
      await flushMicrotasks();
      assert.equal(aDecision, 'cancelled', 'A profile wait must be released immediately');
      assert.notEqual(aPromise, bPromise);
      const callCount = h.calls.length;
      const uiCount = h.ui.length;
      const bSummary = h.root.__guestMigrationSummary;
      const bDecisionState = h.root.__guestMigrationSessionDecision;
      pending.resolve(stage === 'words' ? [{ wordIndex: 0, wordId: 'old-A-word' }] : true);
      await a;
      await flushMicrotasks();
      assert.equal(h.calls.length, callCount, 'no following uploads or completion actions');
      assert.equal(h.ui.length, uiCount, 'no late UI changes');
      assert.equal(h.root.__guestMigrationSummary, bSummary);
      assert.equal(h.root.__guestMigrationSessionDecision, bDecisionState);
      assert.equal(bDecision, undefined, 'A cannot resolve B decision');
      assert.deepEqual(h.root.words, [{ word: 'account-B' }]);
      assert.equal(h.values.get('guest-data'), 'retained');
      assert.equal(h.errors.length, 0);
      h.root.declineGuestMigration();
      assert.equal(await bPromise, 'declined');
    });
  }
});

test('a late A result and its progress callback cannot release B running lock or edit B UI', async () => {
  const h = createHarness();
  const old = deferred();
  const current = deferred();
  h.hooks.words = (uid) => uid === 'A' ? old.promise : current.promise;
  const aDecision = h.root.prepareGuestMigrationForUser({ uid: 'A' });
  const a = h.root.confirmGuestMigration();
  const aProgress = h.calls[0].args[1].onProgress;
  const bDecision = h.switchTo('B');
  const b = h.root.confirmGuestMigration();
  const uiCount = h.ui.length;
  aProgress({ completed: 99, total: 100 });
  old.resolve([{ wordIndex: 0, wordId: 'late-A' }]);
  await a;
  assert.equal(await aDecision, 'cancelled');
  assert.equal(h.root.__guestMigrationRunning, true);
  assert.equal(h.ui.length, uiCount);
  assert.deepEqual(h.root.words, [{ word: 'account-B' }]);
  current.resolve([{ wordIndex: 0, wordId: 'B-guest' }]);
  await b;
  assert.equal(await bDecision, 'accepted');
  assert.equal(h.root.__guestMigrationRunning, false);
  assert.equal(h.credits.get('A'), undefined);
  assert.equal(h.credits.get('B'), 5);
});

test('A to B to A cannot revive the old same-UID operation or its error handler', async () => {
  for (const fail of [false, true]) {
    const h = createHarness();
    const old = deferred();
    const current = deferred();
    let requests = 0;
    h.hooks.words = () => ++requests === 1 ? old.promise : current.promise;
    const firstDecision = h.root.prepareGuestMigrationForUser({ uid: 'A' });
    const first = h.root.confirmGuestMigration();
    const bDecision = h.switchTo('B');
    const latestDecision = h.switchTo('A');
    const latest = h.root.confirmGuestMigration();
    const state = h.root.__guestMigrationSessionDecision;
    const uiCount = h.ui.length;
    if (fail) old.reject(new Error('late old A failure'));
    else old.resolve([{ wordIndex: 0, wordId: 'old-A' }]);
    await first;
    assert.equal(await firstDecision, 'cancelled');
    assert.equal(await bDecision, 'cancelled');
    assert.notEqual(firstDecision, latestDecision);
    assert.equal(h.root.__guestMigrationRunning, true);
    assert.equal(h.root.__guestMigrationSessionDecision, state);
    assert.equal(h.ui.length, uiCount);
    assert.equal(h.errors.length, 0);
    assert.deepEqual(h.root.words, [{ word: 'account-A' }]);
    current.resolve([{ wordIndex: 0, wordId: 'new-A' }]);
    await latest;
    assert.equal(await latestDecision, 'accepted');
    assert.equal(h.credits.get('A'), 5);
  }
});

test('late notification failure or success retains A recovery and cannot erase B receipts or markers', async () => {
  for (const outcome of ['rejection', 'false', 'success']) {
    const h = createHarness();
    const pending = deferred();
    h.hooks.notifications = () => pending.promise;
    const aDecision = h.root.prepareGuestMigrationForUser({ uid: 'A' });
    const a = h.root.confirmGuestMigration();
    await flushMicrotasks();
    assert.equal(h.calls.at(-1).stage, 'notifications');
    assert.ok(JSON.parse(h.values.get(h.profileKey('A'))).profileCommittedAt);
    h.switchTo('B');
    const bMarker = { uid: 'B', profile: { runnerCoins: 9 } };
    const bFailure = { code: 'B-failure' };
    h.root.__acceptedGuestProfileMigration = bMarker;
    h.root.__lastGuestMigrationFailure = bFailure;
    h.values.set('complete', 'B');
    h.values.set('handled', 'B');
    const bState = h.root.__guestMigrationSessionDecision;
    const uiCount = h.ui.length;
    if (outcome === 'rejection') pending.reject(new Error('old notifications failed'));
    else pending.resolve(outcome === 'success');
    await a;
    assert.equal(await aDecision, 'cancelled');
    assert.equal(h.root.__acceptedGuestProfileMigration, bMarker);
    assert.equal(h.root.__lastGuestMigrationFailure, bFailure);
    assert.equal(h.root.__guestMigrationSessionDecision, bState);
    assert.equal(h.values.get('complete'), 'B');
    assert.equal(h.values.get('handled'), 'B');
    assert.ok(JSON.parse(h.values.get(h.profileKey('A'))).profileCommittedAt);
    assert.equal(h.values.get('guest-data'), 'retained');
    assert.equal(h.ui.length, uiCount);
    assert.equal(h.calls.some((call) => ['finalize', 'purge', 'receipt', 'save-render'].includes(call.stage)), false);
    assert.equal(h.errors.length, 0);
  }
});

test('ordinary success preserves order, resolves its decision, and ignores concurrent confirmation', async () => {
  const h = createHarness();
  const decision = h.root.prepareGuestMigrationForUser({ uid: 'A' });
  assert.equal(h.root.prepareGuestMigrationForUser({ uid: 'A' }), decision);
  const migrating = h.root.confirmGuestMigration();
  await h.root.confirmGuestMigration();
  await migrating;
  assert.equal(await decision, 'accepted');
  assert.equal(h.calls.filter((call) => call.stage === 'words').length, 1);
  assert.equal(h.credits.get('A'), 5);
  assert.equal(h.values.has('guest-data'), false);
  assert.equal(h.values.has(h.profileKey('A')), false);
  assert.equal(h.root.__guestMigrationRunning, false);
  const stages = h.calls.map((call) => call.stage);
  assert.ok(stages.indexOf('profile') < stages.indexOf('notifications'));
  assert.ok(stages.indexOf('notifications') < stages.indexOf('finalize'));
  assert.ok(stages.indexOf('finalize') < stages.indexOf('receipt'));
  assert.ok(stages.indexOf('receipt') < stages.indexOf('purge'));
  assert.equal(h.errors.length, 0);
});

test('a current notification failure remains retryable without re-crediting the verified guest balance', async () => {
  const h = createHarness();
  let notificationAttempts = 0;
  h.hooks.notifications = () => ++notificationAttempts > 1;
  const decision = h.root.prepareGuestMigrationForUser({ uid: 'A' });
  let resolved;
  decision.then((status) => { resolved = status; });
  await h.root.confirmGuestMigration();
  assert.equal(resolved, undefined);
  assert.equal(h.root.__guestMigrationSessionDecision.status, 'failed');
  assert.equal(h.root.__guestMigrationRunning, false);
  assert.equal(h.values.get('guest-data'), 'retained');
  assert.ok(JSON.parse(h.values.get(h.profileKey('A'))).profileCommittedAt);
  assert.equal(h.credits.get('A'), 5);
  await h.root.confirmGuestMigration();
  assert.equal(await decision, 'accepted');
  assert.equal(h.credits.get('A'), 5);
  assert.equal(h.calls.filter((call) => call.stage === 'purge').length, 1);
  assert.equal(h.root.__guestMigrationRunning, false);
});

test('returning to A reuses the verified balance while the retired A notification request is still pending', async () => {
  const h = createHarness();
  const oldNotifications = deferred();
  let notificationRequests = 0;
  h.hooks.notifications = () => ++notificationRequests === 1 ? oldNotifications.promise : true;
  const oldDecision = h.root.prepareGuestMigrationForUser({ uid: 'A' });
  const old = h.root.confirmGuestMigration();
  await flushMicrotasks();
  assert.equal(h.credits.get('A'), 5);
  const bDecision = h.switchTo('B');
  const currentDecision = h.switchTo('A');
  await h.root.confirmGuestMigration();
  assert.equal(await oldDecision, 'cancelled');
  assert.equal(await bDecision, 'cancelled');
  assert.equal(await currentDecision, 'accepted');
  assert.equal(h.credits.get('A'), 5);
  const uiCount = h.ui.length;
  oldNotifications.reject(new Error('retired notification failure'));
  await old;
  assert.equal(h.credits.get('A'), 5);
  assert.equal(h.calls.filter((call) => call.stage === 'receipt').length, 1);
  assert.equal(h.calls.filter((call) => call.stage === 'purge').length, 1);
  assert.equal(h.root.__guestMigrationSessionDecision.status, 'accepted');
  assert.equal(h.ui.length, uiCount);
  assert.equal(h.errors.length, 0);
});

test('logout releases a pending prompt and stale preparation cannot replace B session', async () => {
  const h = createHarness();
  const aDecision = h.root.prepareGuestMigrationForUser({ uid: 'A' });
  h.switchTo(null, false);
  assert.equal(await aDecision, 'cancelled');
  assert.equal(h.root.__guestMigrationRunning, false);
  assert.equal(h.root.__guestMigrationSummary, null);
  const bDecision = h.switchTo('B');
  const summary = h.root.__guestMigrationSummary;
  assert.equal(await h.root.prepareGuestMigrationForUser({ uid: 'A' }), 'cancelled');
  assert.equal(h.root.__guestMigrationSummary, summary);
  assert.equal(h.root.__guestMigrationPromise, bDecision);
  h.root.declineGuestMigration();
  assert.equal(await bDecision, 'declined');
  assert.equal(h.values.get('guest-data'), 'retained');
});
