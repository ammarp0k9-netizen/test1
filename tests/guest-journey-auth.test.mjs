import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createGuestJourneyAuth, isPermanentAccount } from '../js/guest-journey-auth.js';
import { firebaseDemoConfig, firebaseEmulatorSelected } from '../js/firebase-emulator-mode.js';

test('creation coalesces and retains an existing authenticated identity', async () => {
  const auth = { currentUser: null };
  const guest = { uid: 'guest-uid', isAnonymous: true };
  let creates = 0;
  let snapshots = 0;
  const manager = createGuestJourneyAuth(auth, {
    async signInAnonymously() { creates++; auth.currentUser = guest; return { user: guest }; },
  }, { beforeStart: () => { snapshots++; } });
  const first = manager.start();
  assert.equal(first, manager.start());
  assert.equal(await first, guest);
  assert.equal(await manager.start(), guest);
  assert.deepEqual([creates, snapshots], [1, 1]);
  auth.currentUser = { uid: 'registered', isAnonymous: false };
  assert.equal(await manager.start(), auth.currentUser);
  assert.deepEqual([creates, snapshots], [1, 1]);
});

test('registration links the anonymous UID, while collisions preserve both accounts', async () => {
  const guest = { uid: 'anon', isAnonymous: true };
  const auth = { currentUser: guest };
  let credentialOnLink;
  const manager = createGuestJourneyAuth(auth, {
    EmailAuthProvider: { credential: email => email },
    async linkWithCredential(user, credential) {
      assert.equal(user, guest);
      credentialOnLink = credential;
      if (credential === 'taken') throw { code: 'auth/email-already-in-use' };
      return { user: { uid: user.uid, isAnonymous: false } };
    },
    async linkWithPopup() { throw { code: 'auth/credential-already-in-use' }; },
    signInWithEmailAndPassword() { assert.fail('must not replace the guest'); },
    createUserWithEmailAndPassword() { assert.fail('must use linking'); },
  });
  for (const result of [manager.login('existing', 'password'), manager.register('taken', 'password'), manager.google({})]) {
    await assert.rejects(result, { code: 'guest-account/conflict' });
    assert.equal(auth.currentUser, guest);
  }
  const result = await manager.register('new', 'password');
  assert.equal(credentialOnLink, 'new');
  assert.equal(result.user.uid, guest.uid);
  assert.equal(isPermanentAccount(guest), false);
  assert.equal(isPermanentAccount(result.user), true);
});

test('OAuth redirect classifies an existing-account collision after restoring the anonymous session', async () => {
  const guest = { uid: 'previous-guest', isAnonymous: true };
  let restore;
  const auth = { currentUser: null, authStateReady: () => new Promise(resolve => { restore = resolve; }) };
  let attempts = 0;
  const manager = createGuestJourneyAuth(auth, {
    async getRedirectResult() { attempts++; throw { code: 'auth/credential-already-in-use' }; },
  });
  const result = manager.redirectResult();
  assert.equal(attempts, 0);
  auth.currentUser = guest;
  restore();
  await assert.rejects(result, { code: 'guest-account/conflict' });
  assert.equal(auth.currentUser, guest);
});

test('the first cloud session preserves the legacy snapshot before attempting authentication', async () => {
  const auth = { currentUser: null };
  const sequence = [];
  const manager = createGuestJourneyAuth(auth, {
    async signInAnonymously() { sequence.push('sign-in'); throw { code: 'auth/operation-not-allowed' }; },
  }, { beforeStart: () => sequence.push('preserve') });
  await assert.rejects(manager.start(), { code: 'auth/operation-not-allowed' });
  await assert.rejects(manager.start(), { code: 'auth/operation-not-allowed' });
  assert.deepEqual(sequence, ['preserve', 'sign-in', 'preserve', 'sign-in']);
});

test('legacy guest progress remains readable after cloud profile hydration replaces unscoped keys', () => {
  const source = readFileSync(new URL('../js/script.js', import.meta.url), 'utf8');
  const from = source.indexOf('window.hasPreservedLegacyGuestProfile =');
  const to = source.indexOf('function getGuestProgressSummary', from);
  assert.ok(from >= 0 && to > from);
  const values = new Map();
  const window = { auth: { currentUser: null }, getLootlinguaProfilePayload: () => ({ userXP: 75 }) };
  const context = {
    window, LEGACY_GUEST_PROFILE_KEY: 'legacy-profile',
    localStorage: { setItem: (key, value) => values.set(key, value) },
    loadJSON: (key, fallback) => values.has(key) ? JSON.parse(values.get(key)) : fallback,
    getGuestLootSnapshot: () => ({ profile: context.getGuestProgressSnapshot() }),
    hasDirtyGuestData: () => true,
    hasMeaningfulGuestLoot: ({ profile }) => profile.userXP > 0,
  };
  vm.runInNewContext(source.slice(from, to), context);
  window.preserveLegacyGuestProfile();
  window.auth.currentUser = { uid: 'anon', isAnonymous: true };
  window.getLootlinguaProfilePayload = () => ({ userXP: 300 });
  window.preserveLegacyGuestProfile();
  assert.equal(window.hasPreservedLegacyGuestProfile(), true);
  assert.equal(context.getGuestProgressSnapshot().userXP, 75);
});

test('anonymous identity gets the guest search quota and never sends a registered-account bearer', async () => {
  const source = readFileSync(new URL('../js/dictionary.js', import.meta.url), 'utf8');
  const cut = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const context = {
    window: { auth: { currentUser: { uid: 'anon', isAnonymous: true, getIdToken() { assert.fail('must not send a guest token'); } } } },
    GUEST_LS_NORMAL: 'normal', localStorage: { getItem: key => key === 'normal' ? '1' : null },
  };
  vm.runInNewContext(cut('function isAiUserLoggedIn(', 'function markGuestSearchUsed(') +
    cut('async function buildAiRequestHeaders(', 'function bindSearchLockOverlays('), context);
  assert.equal(context.isGuestSearchLocked('normal'), true);
  assert.equal((await context.buildAiRequestHeaders()).Authorization, undefined);
  context.window.auth.currentUser = { uid: 'anon', isAnonymous: false, getIdToken: async () => 'linked-token' };
  assert.equal(context.isGuestSearchLocked('normal'), false);
  assert.equal((await context.buildAiRequestHeaders()).Authorization, 'Bearer linked-token');
});

test('emulator selection stays on loopback and persists across internal route changes', () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  assert.equal(firebaseDemoConfig.projectId, 'demo-lootlingua');
  assert.equal(firebaseEmulatorSelected(new URL('http://127.0.0.1/app?firebaseEmulator=1'), storage), true);
  assert.equal(firebaseEmulatorSelected(new URL('http://127.0.0.1/app/world'), storage), true);
  assert.equal(firebaseEmulatorSelected(new URL('https://example.test/app'), storage), false);
  assert.throws(() => firebaseEmulatorSelected(new URL('https://example.test/app?firebaseEmulator=1'), storage));
});
