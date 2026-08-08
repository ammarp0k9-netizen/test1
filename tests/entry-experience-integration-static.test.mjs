import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  contractSource,
  controllerSource,
  cloudSource,
  indexSource,
  rulesSource,
] = await Promise.all([
  readFile(new URL('../js/entry-experience-contract.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
]);

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  const writes = [];
  return {
    writes,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes.push({ type: 'set', key, value: String(value) });
      values.set(key, String(value));
    },
    removeItem(key) {
      writes.push({ type: 'remove', key });
      values.delete(key);
    },
  };
}

function createDocument() {
  const classList = { add() {}, remove() {}, toggle() {} };
  return {
    readyState: 'complete',
    activeElement: null,
    documentElement: { classList },
    body: { children: [], classList, appendChild() {} },
    getElementById() { return null; },
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      throw new Error('Boot must not need to create interactive UI when the shell is absent.');
    },
  };
}

async function createBootHarness({ user = null } = {}) {
  const listeners = new Map();
  const storage = createStorage();
  const sessionStorage = createStorage();
  const document = createDocument();
  const root = {
    __lootlinguaAuthResolved: true,
    __lootlinguaInitialDataReady: true,
    __lootlinguaAuthUser: user,
    __lootlinguaProfileSnapshot: user ? {
      uid: user.uid,
      exists: false,
      data: {},
      readFailed: false,
    } : null,
    words: [],
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
  };

  const evaluateContract = new Function(
    'window',
    'globalThis',
    `${contractSource}\nreturn window.LootLinguaEntryExperience;`
  );
  evaluateContract(root, root);

  const cloudCalls = { loads: 0, saves: 0 };
  if (user) {
    root.LootLinguaJourneyCloud = Object.freeze({
      async getActiveJourney() { return null; },
      async hasAnyJourneyProgress() { return false; },
    });
    root.LootLinguaEntryExperienceCloud = Object.freeze({
      async load(expectedUser) {
        assert.equal(expectedUser.uid, user.uid);
        cloudCalls.loads += 1;
        return { exists: false, state: null };
      },
      async save() {
        cloudCalls.saves += 1;
        throw new Error('A passive boot must never save Entry Experience state.');
      },
    });
  }

  class HTMLElement {}
  const evaluateController = new Function(
    'window',
    'globalThis',
    'document',
    'localStorage',
    'sessionStorage',
    'HTMLElement',
    'requestAnimationFrame',
    'location',
    'navigator',
    `${controllerSource}\nreturn window.LootLinguaEntryExperienceController;`
  );
  const controller = evaluateController(
    root,
    root,
    document,
    storage,
    sessionStorage,
    HTMLElement,
    (callback) => callback(),
    { pathname: '/app', search: '', hash: '' },
    {}
  );

  // init() schedules boot in a microtask. Flush async reads and then call boot once
  // explicitly so this assertion remains deterministic across Node versions.
  await new Promise((resolve) => setImmediate(resolve));
  await controller.boot();
  await new Promise((resolve) => setImmediate(resolve));
  return { controller, storage, cloudCalls };
}

test('the app wires one Entry shell and loads its versioned contract before cloud storage', () => {
  assert.equal(occurrences(indexSource, /id="entryExperienceRoot"/g), 1);
  const contractIndex = indexSource.indexOf('js/entry-experience-contract.js');
  const controllerIndex = indexSource.indexOf('js/entry-experience-controller.js');
  const firebaseIndex = indexSource.indexOf('js/cloud.js');
  const entryCloudIndex = indexSource.indexOf('js/entry-experience-cloud.js');
  assert.ok(contractIndex >= 0);
  assert.ok(controllerIndex > contractIndex);
  assert.ok(firebaseIndex > controllerIndex);
  assert.ok(entryCloudIndex > firebaseIndex);
});

test('v2 cloud persistence is owner-scoped while v1 is read only for preference seeding', () => {
  assert.match(
    cloudSource,
    /function entryRef\(uid, version = contract\(\)\.EXPERIENCE_VERSION\)[\s\S]*?`v\$\{version\}`/
  );
  assert.match(cloudSource, /getDoc\(entryRef\(current\.uid, 1\)\)/);
  assert.match(cloudSource, /const API = Object\.freeze\(\{ load, loadLegacyPreferences, save \}\)/);
  assert.equal(occurrences(cloudSource, /\bsetDoc\s*\(/g), 1);
  assert.doesNotMatch(cloudSource, /onboarding\.completed|hasCompletedOnboarding/);

  assert.match(rulesSource, /match \/entryExperiences\/\{versionId\}/);
  assert.match(rulesSource, /versionId == 'v1'/);
  assert.match(rulesSource, /versionId == 'v2'/);
  assert.match(rulesSource, /allow read: if isOwner\(uid\)/);
  assert.match(rulesSource, /allow delete: if false/);
});

test('passive fresh guest boot classifies in memory without local or cloud writes', async () => {
  const harness = await createBootHarness();
  assert.equal(harness.controller.getState()?.status, 'in-progress');
  assert.deepEqual(harness.storage.writes, []);
  assert.deepEqual(harness.cloudCalls, { loads: 0, saves: 0 });
});

test('passive fresh account boot reads v2 but does not create it before interaction', async () => {
  const now = new Date().toISOString();
  const harness = await createBootHarness({
    user: {
      uid: 'fresh-account-no-boot-write',
      metadata: { creationTime: now, lastSignInTime: now },
    },
  });
  assert.equal(harness.controller.getState()?.status, 'in-progress');
  assert.ok(harness.cloudCalls.loads >= 1);
  assert.equal(harness.cloudCalls.saves, 0);
  assert.deepEqual(harness.storage.writes, []);
});
