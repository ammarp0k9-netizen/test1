import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { publicLandingPath, runLogoutSequence } from '../js/logout-flow.js';

const root = path.resolve(import.meta.dirname, '..');
const cloudSource = fs.readFileSync(path.join(root, 'js', 'cloud.js'), 'utf8');

test('logout waits for listener cleanup and isolation cleanup before navigation', async () => {
  const calls = [];
  let resolveAccountCleanup;
  const accountCleanup = new Promise((resolve) => { resolveAccountCleanup = resolve; });

  const logout = runLogoutSequence({
    savePendingProfile: async () => calls.push('save-profile'),
    prepareLogout: () => calls.push('prepare'),
    waitForAccountCleanup: () => { calls.push('arm-listener-cleanup'); return accountCleanup; },
    signOut: async () => calls.push('sign-out'),
    clearAccountState: () => calls.push('clear-account'),
    purgeGuestIsolationState: () => calls.push('purge-isolation'),
    resetProfileState: () => calls.push('reset-profile'),
    closeLogoutUi: () => calls.push('close-ui'),
    afterCleanup: () => calls.push('cleanup-settled'),
    navigateToLanding: () => calls.push('navigate'),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['save-profile', 'prepare', 'arm-listener-cleanup', 'sign-out']);
  resolveAccountCleanup();
  await logout;
  assert.deepEqual(calls, [
    'save-profile',
    'prepare',
    'arm-listener-cleanup',
    'sign-out',
    'clear-account',
    'purge-isolation',
    'reset-profile',
    'close-ui',
    'cleanup-settled',
    'navigate',
  ]);
});

test('failed sign-out never runs destructive cleanup or navigation', async () => {
  const calls = [];
  await assert.rejects(() => runLogoutSequence({
    prepareLogout: () => calls.push('prepare'),
    waitForAccountCleanup: () => new Promise(() => {}),
    signOut: async () => { calls.push('sign-out'); throw new Error('failed'); },
    clearAccountState: () => calls.push('clear-account'),
    navigateToLanding: () => calls.push('navigate'),
  }), /failed/);
  assert.deepEqual(calls, ['prepare', 'sign-out']);
});

test('the app logout is wired through the listener barrier and sequenced helper', () => {
  const start = cloudSource.indexOf('window.confirmLogout = async function()');
  const end = cloudSource.indexOf('function loadWordsFromCloud', start);
  const block = cloudSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /waitForAccountCleanup/);
  assert.match(block, /lootlingua:auth-state/);
  assert.match(block, /await runLogoutSequence\(\{/);
  assert.match(block, /signOut: \(\) => signOut\(auth\)/);
  assert.match(block, /purgeGuestIsolationState: \(\) => window\.purgeStaleGuestLocalData/);
  assert.match(block, /navigateToLanding: \(\) => location\.assign\(publicLandingPath\(location\)\)/);
  assert.doesNotMatch(block, /signOut\(auth\)\.then/);
});

test('public landing path respects Vercel and GitHub Pages project roots', () => {
  assert.equal(publicLandingPath({ hostname: 'loot-lingua.vercel.app', pathname: '/app/dictionary' }), '/');
  assert.equal(publicLandingPath({ hostname: 'example.github.io', pathname: '/lootlingua/app/dictionary' }), '/lootlingua/');
});
