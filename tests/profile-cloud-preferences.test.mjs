import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileHarness, flushMicrotasks } from './profile-cloud-harness.mjs';

test('appearance saves preserve newer XP, counters and rewards and never build a full payload', async () => {
  const remote = {
    userXP: 108, perfectQuizzes: 2, dailyStreak: 9, runnerCoins: 77,
    dailyLootState: { lockedXP: 40 }, theme: 'lootlingua',
  };
  const h = createProfileHarness({ profile: remote });
  h.seedSnapshot();
  assert.equal(await h.root.saveProfilePreferencesToCloud({ theme: 'ocean', userXP: 0 }), false);
  assert.equal(await h.root.saveProfilePreferencesToCloud({
    theme: 'ocean', oasisMode: 'dark', themeIntroSeen: ['lootlingua', 'ocean'],
  }), true);
  const saved = h.docs.get(h.path('A'));
  assert.equal(saved.userXP, 108);
  assert.equal(saved.perfectQuizzes, 2);
  assert.equal(saved.runnerCoins, 77);
  assert.deepEqual(saved.dailyLootState, remote.dailyLootState);
  assert.equal(saved.theme, 'ocean');
  assert.equal(saved.oasisMode, 'dark');
  assert.deepEqual(Object.keys(h.writes[0].data).sort(), ['oasisMode', 'theme', 'themeIntroSeen', 'updatedAt']);
  assert.equal(h.payloadReads, 0);
});

test('a preference patch can create a missing profile without inventing progress fields', async () => {
  const h = createProfileHarness({ profile: null });
  assert.equal(await h.root.saveProfilePreferencesToCloud({ theme: 'golden' }, { verify: true }), true);
  assert.deepEqual(Object.keys(h.docs.get(h.path('A'))).sort(), ['theme', 'updatedAt']);
  assert.equal(h.root.__lootlinguaProfileSnapshot.exists, true);
  assert.equal(h.reads.length, 2);
  assert.equal(h.payloadReads, 0);
});

test('patch validation rejects the whole patch for unapproved fields or invalid preferences', async () => {
  const h = createProfileHarness();
  for (const patch of [null, [], {}, { userXP: 200 }, { theme: 'made-up' },
    { oasisMode: 'neon' }, { themeIntroSeen: 'ocean' }, { themeIntroSeen: ['made-up'] },
    { theme: 'ocean', userXP: 10 }, { theme: 'ocean', oasisMode: 'neon' }]) {
    assert.equal(await h.root.saveProfilePreferencesToCloud(patch), false);
  }
  assert.equal(h.reads.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(await h.root.saveProfilePreferencesToCloud({ themeIntroSeen: [] }), true);
  assert.deepEqual(h.writes[0].data.themeIntroSeen, []);
});

test('the patch copies caller arrays before preflight and keeps its account fixed', async () => {
  const h = createProfileHarness({ manualReads: true });
  const seen = ['ocean'];
  const patch = { theme: 'ocean', themeIntroSeen: seen };
  const saving = h.root.saveProfilePreferencesToCloud(patch);
  patch.theme = 'golden';
  seen.push('golden');
  await flushMicrotasks();
  h.resolveRead(0);
  assert.equal(await saving, true);
  assert.equal(h.writes[0].data.theme, 'ocean');
  assert.deepEqual(h.writes[0].data.themeIntroSeen, ['ocean']);
  assert.equal(h.writes[0].reference, h.path('A'));
});

test('identity changes during preference preflight prevent every write', async () => {
  const h = createProfileHarness({ manualReads: true });
  const saving = h.root.saveProfilePreferencesToCloud({ theme: 'ocean' });
  await flushMicrotasks();
  h.setIdentity({ uid: 'B' });
  h.resolveRead(0);
  assert.equal(await saving, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.root.__lootlinguaProfileSnapshot, null);
});

test('preference verification detects missing persistence and reports the actual patch only', async () => {
  const h = createProfileHarness({ manualReads: true });
  h.seedSnapshot();
  const saving = h.root.saveProfilePreferencesToCloud({ theme: 'ocean' }, { verify: true });
  await flushMicrotasks();
  h.resolveRead(0, { theme: 'lootlingua' });
  assert.equal(await saving, false);
  const failure = h.root.__lootlinguaLastProfileSaveFailure;
  assert.equal(failure.code, 'profile/write-verification-failed');
  assert.deepEqual(Object.keys(failure.payload).sort(), ['theme', 'updatedAt']);
  assert.equal(failure.operation, 'merge-update');
});

test('successful preference verification retains the actual newer progress in its snapshot', async () => {
  const h = createProfileHarness({ manualReads: true });
  h.seedSnapshot();
  const saving = h.root.saveProfilePreferencesToCloud({ oasisMode: 'dark' }, { verify: true });
  await flushMicrotasks();
  h.resolveRead(0, { ...h.writes[0].data, userXP: 500, perfectQuizzes: 9 });
  assert.equal(await saving, true);
  assert.equal(h.root.__lootlinguaProfileSnapshot.data.userXP, 500);
  assert.equal(h.root.__lootlinguaProfileSnapshot.data.perfectQuizzes, 9);
});

test('stale preference verification cannot replace the active profile or diagnostics', async () => {
  const h = createProfileHarness({ manualReads: true });
  h.seedSnapshot();
  const saving = h.root.saveProfilePreferencesToCloud({ theme: 'ocean' }, { verify: true });
  await flushMicrotasks();
  h.setIdentity({ uid: 'B' });
  const current = { uid: 'B', data: { userXP: 200 } };
  h.root.__lootlinguaProfileSnapshot = current;
  h.resolveRead(0, undefined);
  assert.equal(await saving, false);
  assert.equal(h.root.__lootlinguaProfileSnapshot, current);
  assert.equal(h.root.__lootlinguaLastProfileSaveFailure, undefined);
  assert.equal(h.errors.length, 0);
});

test('successive preference requests preserve call order through a delayed first preflight', async () => {
  const h = createProfileHarness({ manualReads: true, manualWrites: true });
  const first = h.root.saveProfilePreferencesToCloud({ theme: 'ocean' });
  const second = h.root.saveProfilePreferencesToCloud({ theme: 'golden' });
  await flushMicrotasks();
  assert.equal(h.reads.length, 1);
  assert.equal(h.writes.length, 0);
  h.resolveRead(0);
  await flushMicrotasks();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.theme, 'ocean');
  h.resolveWrite(0);
  assert.equal(await first, true);
  await flushMicrotasks();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].data.theme, 'golden');
  h.resolveWrite(1);
  assert.equal(await second, true);
  assert.equal(h.docs.get(h.path('A')).theme, 'golden');
});

test('B preferences proceed independently while an A request remains pending', async () => {
  const h = createProfileHarness({ manualReads: true });
  const a = h.root.saveProfilePreferencesToCloud({ theme: 'ocean' });
  await flushMicrotasks();
  h.setIdentity({ uid: 'B' });
  const b = h.root.saveProfilePreferencesToCloud({ theme: 'golden' });
  await flushMicrotasks();
  assert.equal(h.reads.length, 2);
  h.resolveRead(1, { userXP: 500 });
  assert.equal(await b, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].reference, h.path('B'));
  h.resolveRead(0);
  assert.equal(await a, false);
  assert.equal(h.root.__lootlinguaProfileSnapshot.uid, 'B');
});
