import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../js/cloud.js', import.meta.url), 'utf8');
const lifecycleSource = await readFile(new URL('../js/word-lifecycle.js', import.meta.url), 'utf8');
const schemaSource = await readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8');
const worldsSource = await readFile(new URL('../js/worlds.js', import.meta.url), 'utf8');

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing cloud source boundary: ${start}`);
  return source.slice(from, to);
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function harness() {
  const documents = new Map();
  const writes = [];
  const auth = { currentUser: { uid: 'owner-a' } };
  const root = {};
  let failure = null;
  let waitForWrite = null;
  let waitForRead = null;
  const reads = [];
  const context = vm.createContext({
    window: root, auth, db: {},
    console: { error() {} },
    doc: (_db, ...path) => path.join('/'),
    async getDoc(path) {
      reads.push(path);
      if (waitForRead) await waitForRead;
      return { exists: () => documents.has(path), data: () => documents.get(path) };
    },
    async updateDoc(path, patch) {
      if (waitForWrite) await waitForWrite;
      if (failure) throw failure;
      assert.ok(documents.has(path), `Unexpected document: ${path}`);
      writes.push({ path, patch: clone(patch) });
      documents.set(path, { ...documents.get(path), ...clone(patch) });
    },
  });
  vm.runInContext(schemaSource, context);
  vm.runInContext(lifecycleSource, context);
  vm.runInContext([
    between('  function wordLifecycleApi', '  function wordLifecycleError'),
    between('  function mapWordDoc', '  const USER_WORD_EDUCATIONAL_FIELDS'),
    between('  function buildQuizLearningCloudUpdate', '  window.commitQuizLearningBatchToCloud'),
    between('  window.updateCustomWorldWordInCloud =', '  window.deleteCustomWorldWordFromCloud'),
    between('  window.updateWordInCloud =', '  let activeQuizSessionWriteChain'),
  ].join('\n'), context);
  const original = {
    text: 'old text', word: 'old word', meaning: 'old meaning', translation: 'old translation',
    category: 'general', example: 'old example', starred: true, order: 7,
    userId: 'owner-a', mastery_status: 'Mastered', mastery_streak: 3,
    mastered_once: true, forgetCount: 2, xpValue: 42, xpEconomyVersion: 2,
    wordKey: 'old_word', normalizedWord: 'old word',
  };
  const scopes = [
    {
      name: 'personal', path: 'users/owner-a/words/word-a',
      update: (patch) => root.updateDictionaryWordInCloud('word-a', patch),
      learn: (patch) => root.updateWordInCloud('word-a', patch),
    },
    {
      name: 'custom', path: 'users/owner-a/customWorlds/world-a/words/word-a',
      update: (patch) => root.updateCustomWorldDictionaryWordInCloud('world-a', 'word-a', patch),
      learn: (patch) => root.updateCustomWorldWordInCloud('world-a', 'word-a', patch),
    },
  ];
  for (const scope of scopes) documents.set(scope.path, clone(original));
  return {
    root, auth, original, scopes, documents, writes, reads,
    failWith(error) { failure = error; },
    waitOn(promise) { waitForWrite = promise; },
    waitOnRead(promise) { waitForRead = promise; },
    reread(scope) {
      return context.mapWordDoc({ id: 'word-a', data: () => documents.get(scope.path) });
    },
  };
}

for (const name of ['personal', 'custom']) {
  test(`${name} dictionary edits persist aliases and reread the edited values without changing learning state`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    const patch = { word: 'OLD WORD', meaning: 'new meaning', example: '', category: 'verbs' };
    assert.equal(await scope.update(patch), true);
    assert.deepEqual(h.documents.get(scope.path), {
      ...h.original, ...patch, text: patch.word, translation: patch.meaning,
    });
    assert.equal(h.reread(scope).word, patch.word);
    assert.equal(h.reread(scope).meaning, patch.meaning);
    assert.equal(h.reread(scope).translation, patch.meaning);
    assert.equal(h.reread(scope).example, '');
    assert.equal(h.reread(scope).category, 'verbs');
    assert.deepEqual(h.reads, [scope.path]);
    const otherScope = h.scopes.find((item) => item.name !== name);
    assert.deepEqual(h.documents.get(otherScope.path), h.original);
  });

  test(`${name} star and order patches preserve false, zero, and all unrelated fields`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    await scope.update({ starred: false });
    await scope.update({ order: 0 });
    assert.deepEqual(h.writes.map(({ patch }) => patch), [{ starred: false }, { order: 0 }]);
    assert.deepEqual(h.documents.get(scope.path), { ...h.original, starred: false, order: 0 });
    assert.equal(h.reread(scope).starred, false);
    assert.equal(h.reread(scope).order, 0);
    assert.deepEqual(h.reads, []);
  });

  test(`${name} legacy display corrections preserve identity without stored key fields`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    const legacy = { ...h.original, text: 'old word' };
    delete legacy.wordKey;
    delete legacy.normalizedWord;
    delete legacy.word;
    h.documents.set(scope.path, legacy);
    await scope.update({ word: '  OLD   WORD  ' });
    assert.deepEqual(h.documents.get(scope.path), { ...legacy, word: '  OLD   WORD  ', text: '  OLD   WORD  ' });
    assert.equal(h.reread(scope).word, '  OLD   WORD  ');
  });

  test(`${name} changing a stored or legacy identity rejects the entire edit`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    await assert.rejects(scope.update({ word: 'different term', meaning: 'new meaning' }), { code: 'dictionary/identity-change' });
    assert.deepEqual(h.documents.get(scope.path), h.original);
    const legacy = { ...h.original };
    delete legacy.wordKey;
    delete legacy.normalizedWord;
    h.documents.set(scope.path, legacy);
    await assert.rejects(scope.update({ word: 'different term', starred: false }), { code: 'dictionary/identity-change' });
    assert.deepEqual(h.documents.get(scope.path), legacy);
    assert.deepEqual(h.writes, []);
  });

  test(`${name} stored wordKey remains authoritative when display text already drifted`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    h.documents.set(scope.path, { ...h.original, word: 'drifted term', text: 'drifted term' });
    await assert.rejects(scope.update({ word: 'DRIFTED TERM' }), { code: 'dictionary/identity-change' });
    assert.deepEqual(h.writes, []);
    await scope.update({ word: 'OLD WORD' });
    assert.equal(h.reread(scope).wordKey, 'old_word');
    assert.equal(h.reread(scope).word, 'OLD WORD');
  });

  test(`${name} editing a missing word reports missing-document without writing`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    h.documents.delete(scope.path);
    await assert.rejects(scope.update({ word: 'OLD WORD' }), { code: 'dictionary/missing-document' });
    assert.deepEqual(h.writes, []);
  });

  for (const returnToOriginalAccount of [false, true]) {
    test(`${name} account ${returnToOriginalAccount ? 'ABA switch' : 'switch'} during identity read cannot write`, async () => {
      const h = harness();
      const scope = h.scopes.find((item) => item.name === name);
      let finishRead;
      h.waitOnRead(new Promise((resolve) => { finishRead = resolve; }));
      const pending = scope.update({ word: 'OLD WORD', meaning: 'new meaning' });
      assert.equal(h.reads.length, 1);
      h.auth.currentUser = { uid: 'owner-b' };
      h.root.__lootlinguaAuthGeneration = 1;
      if (returnToOriginalAccount) {
        h.auth.currentUser = { uid: 'owner-a' };
        h.root.__lootlinguaAuthGeneration = 2;
      }
      finishRead();
      await assert.rejects(pending, { code: 'dictionary/stale-owner' });
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.documents.get(scope.path), h.original);
    });
  }

  test(`${name} SRS API strips dictionary fields even when passed a whole Quiz word`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    const learning = { mastery_status: 'Reviewing', mastery_streak: 1, forgetCount: 3, xpValue: 43 };
    await scope.learn({
      ...h.original, ...learning, word: 'Quiz drift', text: 'Quiz drift',
      meaning: 'Quiz drift', translation: 'Quiz drift', starred: false, order: 99,
    });
    const written = h.writes[0].patch;
    for (const key of ['word', 'text', 'meaning', 'translation', 'example', 'category', 'starred', 'order', 'userId']) {
      assert.equal(key in written, false, `${key} must stay out of learning writes`);
    }
    assert.deepEqual(h.documents.get(scope.path), { ...h.original, ...learning });
  });

  test(`${name} rejects invalid or non-dictionary patches before making a write`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    for (const patch of [
      null, [], {}, 'word', { starred: 1 }, { order: -1 }, { order: 1.2 }, { order: Infinity },
      { order: Number.MAX_SAFE_INTEGER + 1 }, { word: '' }, { word: '  ' }, { word: 42 },
      { word: 'x'.repeat(501) }, { meaning: null }, { meaning: 'x'.repeat(1001) },
      { category: 'x'.repeat(121) }, { example: 'x'.repeat(4001) },
      { meaning: 'valid', xpValue: 10 }, { mastery_status: 'Mastered' },
      { userId: 'other-owner' }, { 'mastery_status.value': 'Mastered' },
      { text: 'direct alias' }, { translation: 'direct alias' },
    ]) {
      await assert.rejects(scope.update(patch), { code: 'dictionary/invalid-update' });
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.documents.get(scope.path), h.original);
  });

  test(`${name} dictionary API propagates write failures and requires authentication`, async () => {
    const h = harness();
    const scope = h.scopes.find((item) => item.name === name);
    const denied = Object.assign(new Error('Permission denied'), { code: 'permission-denied' });
    h.failWith(denied);
    await assert.rejects(scope.update({ starred: false }), (error) => error === denied);
    h.auth.currentUser = null;
    await assert.rejects(scope.update({ starred: false }), { code: 'dictionary/auth-required' });
    assert.deepEqual(h.writes, []);
  });
}

test('invalid document or world IDs cannot write to another scope or fall back to personal words', async () => {
  const h = harness();
  for (const id of [undefined, null, '', ' ', '.', '..', 'other/word', 17]) {
    await assert.rejects(h.root.updateDictionaryWordInCloud(id, { starred: true }), { code: 'dictionary/invalid-update' });
    await assert.rejects(h.root.updateCustomWorldDictionaryWordInCloud(id, 'word-a', { starred: true }), { code: 'dictionary/invalid-update' });
    await assert.rejects(h.root.updateCustomWorldDictionaryWordInCloud('world-a', id, { starred: true }), { code: 'dictionary/invalid-update' });
  }
  assert.deepEqual(h.writes, []);
});

test('dictionary success resolves only after the cloud write completes', async () => {
  const h = harness();
  let finishWrite;
  h.waitOn(new Promise((resolve) => { finishWrite = resolve; }));
  let resolved = false;
  const pending = h.scopes[0].update({ starred: false }).then((result) => { resolved = true; return result; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(h.documents.get(h.scopes[0].path).starred, true);
  finishWrite();
  assert.equal(await pending, true);
  assert.equal(h.documents.get(h.scopes[0].path).starred, false);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function migrationHarness(options = {}) {
  const auth = { currentUser: { uid: 'owner-a' } };
  const root = {};
  const calls = { reads: [], upserts: [], batches: [], progress: [] };
  const readStarted = deferred();
  const upsertStarted = deferred();
  const commitStarted = deferred();
  const context = vm.createContext({
    window: root, auth, db: {},
    wordLifecycleApi: () => root.LootLinguaWordLifecycle,
    wordLifecycleError: (code, message) => Object.assign(new Error(message), { code }),
    sourceIdentity: (value) => ({ ...value, sourceId: 'guest-import' }),
    deterministicUserWordId: (key) => `published_${key}`,
    canonicalWordPayload: (word) => ({ word: word.word }),
    legacyWordPayload: (uid, word) => ({ userId: uid, word: word.word }),
    sourceDocumentPayload: (value) => value,
    doc: (base, ...parts) => typeof base === 'string' ? [base, ...parts].join('/') : parts.join('/'),
    async getDoc(path) {
      calls.reads.push(path);
      readStarted.resolve();
      if (options.readGate) await options.readGate;
      return { exists: () => options.existing !== false };
    },
    async upsertUserWordWithSource(input) {
      calls.upserts.push(input);
      upsertStarted.resolve();
      if (options.upsertGate) await options.upsertGate;
      return { status: 'already-linked', wordId: `word-${calls.upserts.length}` };
    },
    writeBatch() {
      const writes = [];
      return {
        create(path, value) { writes.push({ path, value }); },
        async commit() {
          calls.batches.push(writes);
          commitStarted.resolve();
          if (options.commitGate) await options.commitGate;
          if (options.commitError) throw options.commitError;
        },
      };
    },
  });
  vm.runInContext(schemaSource, context);
  vm.runInContext(lifecycleSource, context);
  vm.runInContext(between('  function guestMigrationError', '  async function getUserWordSourceSummary'), context);
  return {
    calls, readStarted, upsertStarted, commitStarted,
    start: () => context.migrateGuestWordsToCloud(
      Array.from({ length: 8 }, (_, index) => ({ word: `term ${index}`, meaning: 'meaning' })),
      { onProgress: (value) => calls.progress.push(value) },
    ),
    switchOwner(aba) {
      auth.currentUser = { uid: 'owner-b' };
      root.__lootlinguaAuthGeneration = 1;
      if (aba) {
        auth.currentUser = { uid: 'owner-a' };
        root.__lootlinguaAuthGeneration = 2;
      }
    },
  };
}

test('guest migration pins the owner on every upsert across chunks and batch-conflict fallback', async () => {
  for (const options of [
    {},
    { existing: false, commitError: Object.assign(new Error('Conflict'), { code: 'already-exists' }) },
  ]) {
    const h = migrationHarness(options);
    const results = await h.start();
    assert.equal(results.length, 8);
    assert.equal(h.calls.upserts.length, 8);
    assert.ok(h.calls.upserts.every((input) => input.uid === 'owner-a'));
    assert.ok(h.calls.reads.every((path) => path.startsWith('users/owner-a/')));
    assert.deepEqual(h.calls.progress.map((item) => item.completed), [6, 8]);
  }
});

for (const aba of [false, true]) {
  const switchName = aba ? 'ABA switch' : 'account switch';
  for (const phase of ['read', 'upsert']) {
    test(`guest migration rejects a stale owner after ${switchName} even when ${phase} fails`, async () => {
      const gate = deferred();
      const h = migrationHarness({ [phase === 'read' ? 'readGate' : 'upsertGate']: gate.promise });
      const pending = h.start();
      await (phase === 'read' ? h.readStarted.promise : h.upsertStarted.promise);
      h.switchOwner(aba);
      gate.reject(Object.assign(new Error('Denied'), { code: 'permission-denied' }));
      await assert.rejects(pending, { code: 'guest-migration/identity-changed' });
      assert.equal(h.calls.upserts.length, phase === 'read' ? 0 : 1);
      assert.equal(h.calls.batches.length, 0);
      assert.equal(h.calls.progress.length, 0);
    });
  }
  test(`guest migration stops after ${switchName} during existence reads`, async () => {
    const gate = deferred();
    const h = migrationHarness({ readGate: gate.promise });
    const pending = h.start();
    await h.readStarted.promise;
    h.switchOwner(aba);
    gate.resolve();
    await assert.rejects(pending, { code: 'guest-migration/identity-changed' });
    assert.equal(h.calls.upserts.length, 0);
    assert.equal(h.calls.batches.length, 0);
    assert.equal(h.calls.progress.length, 0);
  });

  test(`guest migration does not advance to the next word after ${switchName} during upsert`, async () => {
    const gate = deferred();
    const h = migrationHarness({ upsertGate: gate.promise });
    const pending = h.start();
    await h.upsertStarted.promise;
    h.switchOwner(aba);
    gate.resolve();
    await assert.rejects(pending, { code: 'guest-migration/identity-changed' });
    assert.equal(h.calls.upserts.length, 1);
    assert.equal(h.calls.upserts[0].uid, 'owner-a');
    assert.equal(h.calls.progress.length, 0);
  });

  for (const commitRejects of [false, true]) {
    test(`guest migration cannot fall through after ${switchName} during a ${commitRejects ? 'rejected' : 'completed'} batch`, async () => {
      const gate = deferred();
      const h = migrationHarness({ existing: false, commitGate: gate.promise });
      const pending = h.start();
      await h.commitStarted.promise;
      h.switchOwner(aba);
      if (commitRejects) gate.reject(Object.assign(new Error('Conflict'), { code: 'already-exists' }));
      else gate.resolve();
      await assert.rejects(pending, { code: 'guest-migration/identity-changed' });
      assert.equal(h.calls.batches.length, 1);
      assert.ok(h.calls.batches[0].every((item) => item.path.startsWith('users/owner-a/')));
      assert.equal(h.calls.upserts.length, 0);
      assert.equal(h.calls.progress.length, 0);
    });
  }
}

function privateMoveHarness(starred) {
  const personalPath = 'users/owner-a/words/published_apple';
  const membershipPath = 'users/owner-a/customWorlds/private-a/words/published_apple';
  const canonicalPath = 'users/owner-a/contentWords/apple';
  const legacy = {
    userId: 'owner-a', word: 'Apple', text: 'Apple', wordKey: 'apple', normalizedWord: 'apple',
    meaning: 'old meaning', translation: 'old meaning', category: 'noun', example: 'old example',
    starred: !starred, order: 3, hiddenFromDictionary: true, hiddenFromDictionaryAt: 100,
    personalDictionaryState: 'moved-to-private-world', mastery_status: 'Mastered', mastery_streak: 3,
    forgetCount: 7, xpValue: 42, mastered_once: true, xpEconomyVersion: 2,
  };
  const canonical = { word: 'Apple', meaning: 'published meaning', translation: 'published meaning',
    wordKey: 'apple', legacyWordId: 'published_apple', sourceCount: 2, eligibleEvidenceCount: 5 };
  const membership = { ...legacy, starred, meaning: 'edited meaning', translation: 'edited meaning',
    example: '', category: 'edited category', order: 0, mastery_status: 'New', mastery_streak: 0,
    forgetCount: 0, xpValue: 0, hiddenFromDictionary: false, hiddenFromDictionaryAt: null };
  const documents = new Map([
    [personalPath, clone(legacy)], [membershipPath, clone(membership)], [canonicalPath, clone(canonical)],
    [canonicalPath + '/sources/private_world_private-a', { addedFrom: 'private-world' }],
    [canonicalPath + '/sources/published-source', { addedFrom: 'published-gate' }],
  ]);
  const transactions = [];
  let stored = null;
  const root = { auth: { currentUser: { uid: 'owner-a' } }, words: [] };
  const snapshot = path => ({ exists: () => documents.has(path), data: () => clone(documents.get(path)) });
  const context = vm.createContext({ window: root, auth: root.auth, db: {}, console,
    serverTimestamp: () => 123,
    doc: (base, ...parts) => typeof base === 'string' ? [base, ...parts].join('/') : parts.join('/'),
    getDoc: async path => snapshot(path),
    async runTransaction(_db, callback) {
      const operations = [];
      const result = await callback({
        get: async path => snapshot(path),
        set: (path, value) => operations.push({ type: 'set', path, value: clone(value) }),
        update: (path, value) => operations.push({ type: 'update', path, value: clone(value) }),
        delete: path => operations.push({ type: 'delete', path }),
      });
      transactions.push(operations);
      for (const operation of operations) {
        if (operation.type === 'delete') documents.delete(operation.path);
        else documents.set(operation.path, operation.type === 'set' ? operation.value : { ...documents.get(operation.path), ...operation.value });
      }
      return result;
    },
    isCustomWorldView: () => true,
    readWordsFromStorage: () => [{ id: 'published_apple', ...clone(legacy) }],
    writeWordsToStorage: words => { stored = clone(words); },
    getWorldManageWordKey: word => root.LootLinguaWordLifecycle.wordKeyOf(word),
    reindexWordOrder: rows => rows.forEach((word, order) => { word.order = order; }),
  });
  vm.runInContext(schemaSource, context);
  vm.runInContext(lifecycleSource, context);
  vm.runInContext(between('  const USER_WORD_EDUCATIONAL_FIELDS', '  function guestMigrationError'), context);
  vm.runInContext(between('  window.saveWordToCloud =', '  window.updateWordInCloud ='), context);
  const start = worldsSource.indexOf('async function saveWordsToTarget');
  vm.runInContext(worldsSource.slice(start, worldsSource.indexOf('function showSkippedDuplicateWordsNotice', start)), context);
  return {
    documents, legacy, canonical, membership, personalPath, membershipPath, canonicalPath, transactions,
    stored: () => stored,
    moveDirect: () => context.upsertUserWordWithSource({
      word: clone(membership), source: { type: 'manual' }, restoreHidden: true,
      personalDictionaryState: 'active', removePrivateWorldId: 'private-a', removePrivateMembershipId: 'published_apple',
    }),
    move: () => context.saveWordsToTarget('personal', [{
      id: 'published_apple', ...clone(membership), personalDictionaryState: 'active', removePrivateWorldId: 'private-a',
      removePrivateMembershipId: 'published_apple',
    }]),
    copy: () => context.saveWordsToTarget('personal', [{ id: 'published_apple', ...clone(membership) }]),
  };
}

for (const starred of [true, false]) {
  test(`explicit private-to-personal move preserves edited meaning and starred=${starred} before removing membership`, async () => {
    const h = privateMoveHarness(starred);
    const rows = await h.move();
    const personal = h.documents.get(h.personalPath);
    assert.equal(h.documents.has(h.membershipPath), false);
    for (const word of [personal, rows[0], h.stored()[0]]) {
      assert.equal(word.meaning, 'edited meaning');
      assert.equal(word.translation, 'edited meaning');
      assert.equal(word.starred, starred);
      assert.equal(word.example, '');
      assert.equal(word.category, 'edited category');
      assert.equal(word.hiddenFromDictionary, false);
      assert.equal(word.personalDictionaryState, 'active');
      for (const key of ['wordKey', 'normalizedWord', 'mastery_status', 'mastery_streak', 'forgetCount', 'xpValue', 'mastered_once', 'xpEconomyVersion']) {
        assert.equal(word[key], h.legacy[key], `${key} must remain destination-owned`);
      }
    }
    assert.deepEqual(h.documents.get(h.canonicalPath), h.canonical);
    assert.equal(h.documents.has(h.canonicalPath + '/sources/published-source'), true);
    const operations = h.transactions[0];
    assert.ok(operations.findIndex(item => item.type === 'update' && item.path === h.personalPath) <
      operations.findIndex(item => item.type === 'delete' && item.path === h.membershipPath));
    const dictionaryPatch = operations.find(item => item.type === 'update' && item.path === h.personalPath).value;
    assert.equal('mastery_status' in dictionaryPatch, false);
    assert.equal('wordKey' in dictionaryPatch, false);
  });
}

test('a copy without source removal keeps the existing personal definition and star', async () => {
  const h = privateMoveHarness(true);
  await h.copy();
  assert.equal(h.documents.has(h.membershipPath), true);
  assert.equal(h.documents.get(h.personalPath).meaning, h.legacy.meaning);
  assert.equal(h.documents.get(h.personalPath).starred, h.legacy.starred);
  assert.equal(h.stored()[0].meaning, h.legacy.meaning);
  assert.equal(h.stored()[0].starred, h.legacy.starred);
});

test('a missing source membership rejects an explicit move before writes and preserves the destination', async () => {
  const h = privateMoveHarness(true);
  h.documents.delete(h.membershipPath);
  const before = clone([...h.documents]);
  await assert.rejects(h.moveDirect(), { code: 'word-lifecycle/source-membership-missing' });
  assert.deepEqual([...h.documents], before);
  assert.deepEqual(h.documents.get(h.personalPath), h.legacy);
  assert.equal(h.transactions.length, 0);
  await assert.rejects(h.move(), { code: 'word-lifecycle/source-membership-missing' });
  assert.deepEqual([...h.documents], before);
  assert.equal(h.transactions.length, 0);
  assert.equal(h.stored(), null);
});


function freshAccountWordHarness() {
  const documents=new Map();let readBarrier=null;
  const root={auth:{currentUser:{uid:'new-A'}},__lootlinguaAuthGeneration:1,words:[]};
  const context=vm.createContext({window:root,auth:root.auth,db:{},console:{error(){}},serverTimestamp:()=>123,
    doc:(_db,...parts)=>parts.join('/'),
    async runTransaction(_db,callback){
      const pending=[];
      const result=await callback({
        get:async path=>{if(readBarrier){const wait=readBarrier;readBarrier=null;await wait;}return {exists:()=>documents.has(path),data:()=>clone(documents.get(path))}},
        set:(path,value)=>pending.push([path,clone(value)]),
        update:(path,value)=>pending.push([path,{...documents.get(path),...clone(value)}]),
        delete:path=>pending.push([path,null]),
      });
      for(const [path,value]of pending)if(value)documents.set(path,value);else documents.delete(path);
      return result;
    }
  });
  vm.runInContext(schemaSource,context);vm.runInContext(lifecycleSource,context);
  vm.runInContext(between('  const USER_WORD_EDUCATIONAL_FIELDS','  function guestMigrationError'),context);
  vm.runInContext(between('  window.saveWordToCloud =','  window.updateWordInCloud ='),context);
  return {root,documents,save:()=>root.saveWordToCloud('journey','عام','رحلة','',0,{}),pause:promise=>{readBarrier=promise}};
}

test('a brand-new account saves its first manual word with canonical/source/personal records and no duplicate on retry',async()=>{
  const h=freshAccountWordHarness();const id=await h.save();assert.ok(id);
  const row=h.documents.get('users/new-A/words/'+id);
  assert.equal(row.userId,'new-A');assert.equal(row.meaning,'رحلة');assert.equal(row.personalDictionaryState,'active');
  assert.equal(h.documents.size,3);assert.equal(await h.save(),id);assert.equal(h.documents.size,3);
});

test('switching accounts during a first-word transaction aborts before any write',async()=>{
  const h=freshAccountWordHarness();let release;h.pause(new Promise(resolve=>{release=resolve}));
  const saving=h.save();await new Promise(resolve=>setImmediate(resolve));
  h.root.auth.currentUser={uid:'new-B'};h.root.__lootlinguaAuthGeneration++;release();
  await assert.rejects(saving,{code:'auth/identity-changed'});assert.equal(h.documents.size,0);
  const id=await h.save();assert.equal(h.documents.get('users/new-B/words/'+id).userId,'new-B');
});


test('word drafts are isolated by account as well as dictionary scope',async()=>{
  const text=await readFile(new URL('../js/dictionary.js',import.meta.url),'utf8');
  const start=text.indexOf('function getAddFormDraftScope()');
  const code=text.slice(start,text.indexOf('function readAddFormDraftFromDom()',start));
  const root={auth:{currentUser:{uid:'A'}}};const context=vm.createContext({window:root,isCustomWorldView:()=>false});
  vm.runInContext(code,context);const a=context.getAddFormDraftScope();
  root.auth.currentUser={uid:'B'};assert.notEqual(context.getAddFormDraftScope(),a);
});
