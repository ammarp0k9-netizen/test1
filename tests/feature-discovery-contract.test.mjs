import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/feature-discovery-contract.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../js/feature-discovery-controller.js', import.meta.url), 'utf8');
const scriptSource = await readFile(new URL('../js/script.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const worldsSource = await readFile(new URL('../js/worlds.js', import.meta.url), 'utf8');
const root = {};
new Function('window', 'globalThis', `${source}\nreturn window.LootLinguaFeatureDiscoveryContract;`)(root, root);
const discovery = root.LootLinguaFeatureDiscoveryContract;

test('feature discovery has independent, owner-scoped records without changing unlock eligibility', () => {
  assert.deepEqual(discovery.FEATURES, ['treasure', 'quiz', 'starred', 'custom-worlds']);
  assert.notEqual(discovery.storageKey({}), discovery.storageKey({ uid: 'account-a' }));
  assert.notEqual(discovery.storageKey({ uid: 'account-a' }), discovery.storageKey({ uid: 'account-b' }));
  const initial = discovery.create();
  assert.equal(discovery.stateFor(initial, 'quiz', false).status, 'locked');
  assert.equal(discovery.stateFor(initial, 'quiz', true).status, 'available');
  const started = discovery.transition(initial, 'quiz', 'start', 10);
  assert.equal(discovery.stateFor(started, 'quiz', true).status, 'in-progress');
  assert.equal(discovery.stateFor(started, 'treasure', true).status, 'available');
  const completed = discovery.transition(started, 'quiz', 'complete', 20);
  assert.equal(discovery.stateFor(completed, 'quiz', true).status, 'completed');
  assert.equal(discovery.stateFor(completed, 'quiz', false).status, 'locked');
});

test('guest migration preserves completed discovery and never resets an account record', () => {
  const guest = discovery.transition(discovery.create(), 'treasure', 'complete', 30);
  const account = discovery.transition(discovery.create(), 'quiz', 'start', 40);
  const merged = discovery.merge(account, guest);
  assert.equal(discovery.stateFor(merged, 'treasure', true).status, 'completed');
  assert.equal(discovery.stateFor(merged, 'quiz', true).status, 'in-progress');
  const accountCompleted = discovery.transition(account, 'treasure', 'complete', 50);
  assert.equal(discovery.stateFor(discovery.merge(accountCompleted, guest), 'treasure', true).completedAt, 50);
});

test('a claimed guest snapshot is consumed, while later guest progress is a new record', () => {
  const values = new Map();
  const listeners = new Map();
  const rootWithStorage = {
    auth: { currentUser: null },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent() {},
  };
  new Function('window', 'globalThis', 'localStorage', `${source}\n${controllerSource}\nreturn window.LootLinguaFeatureDiscovery;`)(rootWithStorage, rootWithStorage, rootWithStorage.localStorage);
  const controller = rootWithStorage.LootLinguaFeatureDiscovery;
  controller.complete('treasure');
  const guestKey = discovery.storageKey({});
  rootWithStorage.auth.currentUser = { uid: 'account-a' };
  listeners.get('lootlingua:auth-state')?.({});
  assert.equal(controller.getStatus('treasure', true), 'completed');
  assert.equal(values.has(guestKey), false, 'the claimed guest snapshot is consumed');
  listeners.get('lootlingua:auth-state')?.({});
  assert.equal(controller.getStatus('treasure', true), 'completed', 'the same account can sign in again without reset');
  // A later guest session may safely create new progress, but it must not
  // resurrect the treasure completion already transferred to account A.
  rootWithStorage.auth.currentUser = null;
  listeners.get('lootlingua:auth-state')?.({});
  controller.start('quiz');
  assert.equal(controller.getStatus('quiz', true), 'in-progress');
  rootWithStorage.auth.currentUser = { uid: 'account-b' };
  listeners.get('lootlingua:auth-state')?.({});
  assert.equal(controller.getStatus('quiz', true), 'in-progress');
  assert.equal(controller.getStatus('treasure', true), 'available');
  rootWithStorage.auth.currentUser = { uid: 'account-a' };
  listeners.get('lootlingua:auth-state')?.({});
  assert.equal(controller.getStatus('treasure', true), 'completed');
});

test('legacy game dictionaries are absent while the private-world panel remains', () => {
  assert.match(htmlSource, /id="customWorldsPanel"/);
  assert.match(htmlSource, /id="worldsGrid"/);
  assert.doesNotMatch(htmlSource, /world-card-(minecraft|pubg)|loadGameDictionary|gameSearchBar/);
  assert.doesNotMatch(worldsSource, /const gameData|loadGameDictionary|currentGameWords|renderGameWords|addFromGame/);
  assert.doesNotMatch(controllerSource, /minecraft|pubg/);
});

test('default feature gates and lock copy use the same word thresholds', () => {
  const unlockBlock = scriptSource.slice(scriptSource.indexOf('function computeDefaultUnlockedFeatures'), scriptSource.indexOf('function resolveUnlockedFeatures'));
  const explanationBlock = scriptSource.slice(scriptSource.indexOf('const UNLOCK_EXPLAIN'), scriptSource.indexOf('function openUnlockExplainModal'));
  assert.match(unlockBlock, /if \(p\.wordCount >= 1\)[\s\S]*u\.add\('treasure'\)/);
  assert.match(unlockBlock, /if \(p\.wordCount >= 5\) u\.add\('starred'\)/);
  assert.match(unlockBlock, /if \(p\.wordCount >= 5\) u\.add\('quiz'\)/);
  assert.match(explanationBlock, /starred:[\s\S]*?const need = 5/);
  assert.match(explanationBlock, /treasure:[\s\S]*?const need = 1/);
});
