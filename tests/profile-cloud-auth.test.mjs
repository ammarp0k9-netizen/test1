import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileHarness, deferred, flushMicrotasks } from './profile-cloud-harness.mjs';

test('a delayed A read cannot replace B state, snapshot, readiness or loading ownership', async () => {
  const h = createProfileHarness({ manualReads: true });
  const a = h.root.loadProfileFromCloud({ uid: 'A' });
  h.setIdentity({ uid: 'B' });
  const b = h.root.loadProfileFromCloud({ uid: 'B' });
  h.resolveRead(0, { userXP: 100, owner: 'A' });
  assert.equal((await a).loaded, false);
  assert.equal(h.root.__applyingCloudProfile, true);
  assert.equal(h.resets.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal(h.ready.length, 0);
  h.resolveRead(1, { userXP: 200, owner: 'B' });
  assert.equal((await b).loaded, true);
  assert.equal(h.profile.owner, 'B');
  assert.equal(h.root.__lootlinguaProfileSnapshot.uid, 'B');
  assert.deepEqual(h.ready, ['profile']);
  assert.equal(h.root.__applyingCloudProfile, false);
});

test('a late A response after B completes cannot publish or reset anything', async () => {
  const h = createProfileHarness({ manualReads: true });
  const a = h.root.loadProfileFromCloud({ uid: 'A' });
  h.setIdentity({ uid: 'B' });
  const b = h.root.loadProfileFromCloud({ uid: 'B' });
  h.resolveRead(1, { userXP: 200 });
  await b;
  const before = h.root.__lootlinguaProfileSnapshot;
  h.resolveRead(0, { userXP: 100 });
  await a;
  assert.equal(h.root.__lootlinguaProfileSnapshot, before);
  assert.equal(h.profile.userXP, 200);
  assert.equal(h.resets.length, 1);
  assert.equal(h.events.length, 1);
});

test('A to logout and A to B to A invalidate a prior read even when the UID returns', async () => {
  for (const returnToA of [false, true]) {
    const h = createProfileHarness({ manualReads: true });
    const old = h.root.loadProfileFromCloud({ uid: 'A' });
    h.notifyAuth(null);
    if (returnToA) {
      h.setIdentity({ uid: 'B' });
      h.setIdentity({ uid: 'A' });
    }
    h.resolveRead(0, { userXP: 900 });
    assert.equal((await old).loaded, false);
    assert.equal(h.events.length, 0);
    assert.equal(h.resets.length, 0);
    assert.equal(h.root._profileLoaded, false);
    assert.equal(h.root.__applyingCloudProfile, false);
  }
});

test('the most recent overlapping load owns same-account state and cleanup', async () => {
  const h = createProfileHarness({ manualReads: true });
  const old = h.root.loadProfileFromCloud({ uid: 'A' });
  const recent = h.root.loadProfileFromCloud({ uid: 'A' });
  h.resolveRead(0, { userXP: 999 });
  assert.equal((await old).loaded, false);
  assert.equal(h.root.__applyingCloudProfile, true);
  assert.equal(h.ready.length, 0);
  h.resolveRead(1, { userXP: 222 });
  await recent;
  assert.equal(h.profile.userXP, 222);
  assert.equal(h.ready.length, 1);
});

test('stale read failures cannot replace another load snapshot, diagnostics or suppression', async () => {
  const h = createProfileHarness({ manualReads: true });
  const old = h.root.loadProfileFromCloud({ uid: 'A' });
  h.setIdentity({ uid: 'B' });
  const recent = h.root.loadProfileFromCloud({ uid: 'B' });
  h.reads[0].reject(new Error('old request failed'));
  await old;
  assert.equal(h.events.length, 0);
  assert.equal(h.errors.length, 0);
  assert.equal(h.root.__applyingCloudProfile, true);
  h.resolveRead(1, { userXP: 222 });
  await recent;
});

test('a current read failure publishes recovery information and completes its own readiness', async () => {
  const h = createProfileHarness({ manualReads: true });
  const loading = h.root.loadProfileFromCloud({ uid: 'A' });
  h.reads[0].reject(new Error('offline'));
  assert.equal((await loading).loaded, false);
  assert.equal(h.root.__lootlinguaProfileSnapshot.readFailed, true);
  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.ready, ['profile']);
  assert.equal(h.root.__applyingCloudProfile, false);
});

test('auth changes during the payload wait cannot start a stale Firestore read', async () => {
  const h = createProfileHarness();
  const get = h.root.getLootlinguaProfilePayload;
  delete h.root.getLootlinguaProfilePayload;
  const loading = h.root.loadProfileFromCloud({ uid: 'A' });
  h.notifyAuth(null);
  h.root.getLootlinguaProfilePayload = get;
  h.runTimers();
  assert.equal((await loading).loaded, false);
  assert.equal(h.reads.length, 0);
});

test('stale guest preparation success or failure cannot affect the next auth session', async () => {
  for (const fail of [false, true]) {
    const prepared = deferred();
    const h = createProfileHarness({ prepare: () => prepared.promise });
    h.notifyAuth({ uid: 'A' });
    await flushMicrotasks();
    h.notifyAuth(null);
    if (fail) prepared.reject(new Error('old guest preparation failed'));
    else prepared.resolve();
    await flushMicrotasks();
    assert.equal(h.reads.length, 0);
    assert.equal(h.streaks.length, 0);
    assert.equal(h.root._profileLoaded, false);
    assert.equal(h.errors.length, 0);
  }
});

test('the auth promise chain marks only a successful current load', async () => {
  const h = createProfileHarness({ manualReads: true });
  h.notifyAuth({ uid: 'A' });
  await flushMicrotasks();
  h.notifyAuth({ uid: 'B' });
  await flushMicrotasks();
  h.resolveRead(0, { userXP: 100 });
  await flushMicrotasks();
  assert.equal(h.root._profileLoaded, false);
  assert.equal(h.streaks.length, 0);
  h.resolveRead(1, { userXP: 200 });
  await flushMicrotasks();
  assert.equal(h.root._profileLoaded, true);
  assert.deepEqual(h.streaks, ['B']);
});

test('auth readiness resumes after a words-only guest profile commit during the decision wait', async () => {
  const decision = deferred();
  const h = createProfileHarness({ profile: null, prepare: () => decision.promise });
  h.notifyAuth({ uid: 'A' });
  await flushMicrotasks();
  h.seedMigration('A', {});
  assert.equal(await h.root.commitPendingGuestProfileMigration({ uid: 'A' }), true);
  assert.equal(Number(h.profile.userXP) || 0, 0, 'an empty guest snapshot must not invent XP');
  assert.equal(Number(h.profile.runnerCoins) || 0, 0, 'an empty guest snapshot must not invent a wallet balance');
  assert.deepEqual(h.profile.activityMap || {}, {});
  h.root.finalizePendingGuestProfileMigration({ uid: 'A' });
  decision.resolve('accepted');
  await flushMicrotasks();
  assert.equal(h.root._profileLoaded, true);
  assert.equal(h.root.__lootlinguaProfileSnapshot.uid, 'A');
  assert.equal(h.root.__lootlinguaProfileSnapshot.exists, true);
  assert.deepEqual(h.streaks, ['A']);
  assert.equal(h.writes.length, 1);
  assert.equal(h.reads.length, 4);
});

test('auth reload after guest acceptance preserves the verified balance without another credit', async () => {
  const decision = deferred();
  const h = createProfileHarness({ profile: { userXP: 100, runnerCoins: 10 }, prepare: () => decision.promise });
  h.notifyAuth({ uid: 'A' });
  await flushMicrotasks();
  h.seedMigration();
  assert.equal(await h.root.commitPendingGuestProfileMigration({ uid: 'A' }), true);
  h.root.finalizePendingGuestProfileMigration({ uid: 'A' });
  decision.resolve('accepted');
  await flushMicrotasks();
  assert.equal(h.root._profileLoaded, true);
  assert.equal(h.profile.runnerCoins, 15);
  assert.equal(h.docs.get(h.path('A')).runnerCoins, 15);
  assert.equal(h.writes.length, 1);
});

test('a pending generic debounce cannot collect or save a newer account payload', async () => {
  const h = createProfileHarness();
  h.seedSnapshot();
  h.root.saveProfileToCloud();
  h.setIdentity({ uid: 'B' });
  h.runTimers();
  await flushMicrotasks();
  assert.equal(h.payloadReads, 0);
  assert.equal(h.writes.length, 0);
  h.setIdentity({ uid: 'A' });
  h.root.saveProfileToCloud();
  h.notifyAuth(null);
  assert.equal(h.timers.size, 0);
});

test('a save preflight cannot publish a stale snapshot or proceed to a write', async () => {
  const h = createProfileHarness({ manualReads: true });
  const saving = h.root.saveProfilePreferencesToCloud({ theme: 'ocean' });
  await flushMicrotasks();
  h.setIdentity({ uid: 'B' });
  const bSnapshot = { uid: 'B', exists: true, data: { userXP: 200 } };
  h.root.__lootlinguaProfileSnapshot = bSnapshot;
  h.resolveRead(0, { userXP: 100 });
  assert.equal(await saving, false);
  assert.equal(h.root.__lootlinguaProfileSnapshot, bSnapshot);
  assert.equal(h.writes.length, 0);
});

test('a submitted old-account save cannot publish success or failure into the new session', async () => {
  for (const fail of [false, true]) {
    const h = createProfileHarness({ manualWrites: true });
    h.seedSnapshot();
    const saving = h.root.saveProfilePreferencesToCloud({ theme: 'ocean' }, { verify: true });
    await flushMicrotasks();
    assert.equal(h.writes[0].reference, h.path('A'));
    h.setIdentity({ uid: 'B' });
    const bSnapshot = { uid: 'B', data: { userXP: 200 } };
    h.root.__lootlinguaProfileSnapshot = bSnapshot;
    const bFailure = { code: 'B-failure' };
    h.root.__lootlinguaLastProfileSaveFailure = bFailure;
    if (fail) h.writes[0].reject(new Error('old write failed'));
    else h.resolveWrite(0);
    assert.equal(await saving, false);
    assert.equal(h.root.__lootlinguaProfileSnapshot, bSnapshot);
    assert.equal(h.root.__lootlinguaLastProfileSaveFailure, bFailure);
    assert.equal(h.reads.length, 1, 'only the transaction read runs; stale verification must not run');
    assert.equal(h.errors.length, 0);
  }
});

test('stale verification success or failure cannot commit migration or restore old local data', async () => {
  for (const fail of [false, true]) {
    const h = createProfileHarness({ manualReads: true });
    const { key } = h.seedMigration();
    const loading = h.root.commitPendingGuestProfileMigration({ uid: 'A' });
    h.resolveRead(0, { userXP: 100, runnerCoins: 10 });
    await flushMicrotasks();
    h.resolveRead(1, { userXP: 100, runnerCoins: 10 });
    await flushMicrotasks();
    assert.equal(h.writes.length, 1);
    assert.equal(h.reads.length, 3);
    h.setIdentity({ uid: 'B' });
    const b = h.root.loadProfileFromCloud({ uid: 'B' });
    h.resolveRead(3, { userXP: 300, runnerCoins: 20 });
    await b;
    if (fail) h.reads[2].reject(new Error('A verification failed'));
    else h.resolveRead(2);
    assert.equal(await loading, false);
    assert.equal(h.profile.userXP, 300);
    assert.equal(h.profile.runnerCoins, 20);
    assert.equal(JSON.parse(h.localStorage.getItem(key)).profileCommittedAt, undefined);
    assert.equal(h.root.__lootlinguaProfileSnapshot.uid, 'B');
    assert.equal(h.errors.length, 0);
  }
});

test('a verified guest migration retains its marker and retries without adding the balance again', async () => {
  const h = createProfileHarness({ profile: { userXP: 100, runnerCoins: 10 } });
  const { key } = h.seedMigration();
  assert.equal(await h.root.commitPendingGuestProfileMigration({ uid: 'A' }), true);
  assert.equal(h.docs.get(h.path('A')).runnerCoins, 15);
  assert.equal(h.docs.get(h.path('A')).userXP, 180);
  assert.equal(h.reads.length, 3, 'migration reads the initial profile, transactional profile, then verifies');
  assert.ok(JSON.parse(h.localStorage.getItem(key)).profileCommittedAt > 0);
  assert.equal(await h.root.commitPendingGuestProfileMigration({ uid: 'A' }), true);
  assert.equal(h.writes.length, 1);
  await h.root.loadProfileFromCloud({ uid: 'A' });
  assert.equal(h.profile.runnerCoins, 15);
  assert.equal(h.writes.length, 1);
  assert.equal(h.root.finalizePendingGuestProfileMigration({ uid: 'A' }), true);
  assert.equal(h.localStorage.getItem(key), null);
});

test('finalizing an account marker preserves a different account in-memory migration', () => {
  const h = createProfileHarness();
  const { key } = h.seedMigration('A');
  const bMigration = { uid: 'B', profile: { userXP: 500 } };
  h.root.__acceptedGuestProfileMigration = bMigration;
  assert.equal(h.root.finalizePendingGuestProfileMigration({ uid: 'A' }), true);
  assert.equal(h.localStorage.getItem(key), null);
  assert.equal(h.root.__acceptedGuestProfileMigration, bMigration);
});

test('failed current migration verification retains recoverable guest data', async () => {
  const h = createProfileHarness({ manualReads: true });
  const { key } = h.seedMigration();
  const loading = h.root.commitPendingGuestProfileMigration({ uid: 'A' });
  h.resolveRead(0, { userXP: 100 });
  await flushMicrotasks();
  h.resolveRead(1, { userXP: 100 });
  await flushMicrotasks();
  h.resolveRead(2, undefined);
  assert.equal(await loading, false);
  assert.equal(JSON.parse(h.localStorage.getItem(key)).profileCommittedAt, undefined);
  assert.equal(h.profile.userXP, 180);
  assert.equal(h.root.__lootlinguaLastProfileSaveFailure.code, 'profile/write-verification-failed');
});

test('a verified legacy migration marker is sealed without granting its spent balance again', async () => {
  const h = createProfileHarness({ profile: { userXP: 180, runnerCoins: 15 } });
  const { key, pending } = h.seedMigration();
  pending.guestSnapshotId = 'already-imported-legacy'; pending.profileCommittedAt = Date.now();
  h.localStorage.setItem(key, JSON.stringify(pending));
  await h.root.loadProfileFromCloud({ uid: 'A' });
  assert.equal(h.docs.get(h.path('A')).runnerCoins, 15);
  await h.root.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: -7, eventId: 'later-spend' });
  h.root.finalizePendingGuestProfileMigration({ uid: 'A' });
  await h.root.commitProfileIntent({ type: 'guest-import', eventId: pending.guestSnapshotId, profile: pending.profile });
  assert.equal(h.docs.get(h.path('A')).runnerCoins, 8);
});
