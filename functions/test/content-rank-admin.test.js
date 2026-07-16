'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AUDIT_COLLECTION,
  CONTENT_OPERATIONS_COLLECTION,
  COPY_OPERATION_FIELD,
  OPERATION_LOCK_FIELD,
  OPERATION_LOCK_TTL_MS,
  RankAdminPayloadError,
  createDeleteContentRankHandler,
  createDuplicateContentRankHandler,
  createOperationKey,
  isLeaseActive,
  normalizeCount,
  validateDeleteRankPayload,
  validateDuplicateRankPayload
} = require('../content-rank-admin');

const NOW = 2_000_000;

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
  }
}

class FakeTimestamp {
  constructor(milliseconds) {
    this.milliseconds = milliseconds;
  }

  toMillis() {
    return this.milliseconds;
  }
}

const SERVER_TIMESTAMP = Object.freeze({ transform: 'server-timestamp' });
const DELETE_FIELD = Object.freeze({ transform: 'delete-field' });
const FakeFieldValue = {
  serverTimestamp() {
    return SERVER_TIMESTAMP;
  },
  delete() {
    return DELETE_FIELD;
  }
};

function clone(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value === SERVER_TIMESTAMP || value === DELETE_FIELD || value instanceof FakeTimestamp) {
    return value;
  }
  if (Array.isArray(value)) return value.map(clone);
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = clone(child);
  return result;
}

function resolveTransforms(value) {
  if (value === SERVER_TIMESTAMP) return new FakeTimestamp(NOW);
  if (value === DELETE_FIELD) return DELETE_FIELD;
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value instanceof FakeTimestamp) return value;
  if (Array.isArray(value)) return value.map(resolveTransforms);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const resolved = resolveTransforms(child);
    if (resolved !== DELETE_FIELD) result[key] = resolved;
  }
  return result;
}

class FakeDocumentReference {
  constructor(database, documentPath) {
    this.database = database;
    this.path = documentPath;
    this.id = documentPath.split('/').at(-1);
  }

  collection(name) {
    return new FakeCollectionReference(this.database, `${this.path}/${name}`);
  }

  async get() {
    return this.database.snapshot(this);
  }
}

class FakeCollectionReference {
  constructor(database, collectionPath) {
    this.database = database;
    this.path = collectionPath;
  }

  doc(id) {
    return new FakeDocumentReference(this.database, `${this.path}/${id}`);
  }

  async get() {
    const prefix = `${this.path}/`;
    const docs = [];
    for (const documentPath of [...this.database.store.keys()].sort()) {
      if (!documentPath.startsWith(prefix)) continue;
      const suffix = documentPath.slice(prefix.length);
      if (suffix.includes('/')) continue;
      docs.push(this.database.snapshot(this.doc(suffix)));
    }
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeDb(seed = {}, options = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
  const events = [];
  let recursiveFailures = options.recursiveFailures || 0;
  let bulkFailures = options.bulkFailures || 0;

  function setDocument(reference, data) {
    store.set(reference.path, resolveTransforms(clone(data)));
  }

  function updateDocument(reference, patch) {
    if (!store.has(reference.path)) throw new Error(`Missing update target: ${reference.path}`);
    const current = clone(store.get(reference.path));
    for (const [field, value] of Object.entries(patch)) {
      if (value === DELETE_FIELD) delete current[field];
      else current[field] = resolveTransforms(clone(value));
    }
    store.set(reference.path, current);
  }

  const db = {
    store,
    events,
    collection(name) {
      return new FakeCollectionReference(db, name);
    },
    snapshot(reference) {
      const exists = store.has(reference.path);
      return {
        exists,
        id: reference.id,
        ref: reference,
        data: () => exists ? clone(store.get(reference.path)) : undefined
      };
    },
    async runTransaction(callback) {
      events.push('transaction');
      const writes = [];
      const transaction = {
        async get(reference) {
          return db.snapshot(reference);
        },
        set(reference, data) {
          writes.push(() => {
            events.push(`set:${reference.path}`);
            setDocument(reference, data);
          });
        },
        update(reference, patch) {
          writes.push(() => {
            events.push(`update:${reference.path}`);
            updateDocument(reference, patch);
          });
        }
      };
      const result = await callback(transaction);
      for (const write of writes) write();
      return result;
    },
    async recursiveDelete(reference) {
      events.push(`recursiveDelete:${reference.path}`);
      if (options.recursiveBarrier) await options.recursiveBarrier.promise;
      if (recursiveFailures > 0) {
        recursiveFailures -= 1;
        throw new Error('recursive delete failed');
      }
      for (const documentPath of [...store.keys()]) {
        if (documentPath === reference.path || documentPath.startsWith(`${reference.path}/`)) {
          store.delete(documentPath);
        }
      }
    },
    bulkWriter() {
      events.push('bulkWriter');
      return {
        set(reference, data) {
          events.push(`bulkSet:${reference.path}`);
          return Promise.resolve().then(async () => {
            if (options.bulkBarrier) await options.bulkBarrier.promise;
            if (bulkFailures > 0) {
              bulkFailures -= 1;
              throw new Error('bulk write failed');
            }
            setDocument(reference, data);
          });
        },
        async close() {
          events.push('bulkClose');
        }
      };
    }
  };

  return {
    db,
    events,
    get(pathname) {
      return store.has(pathname) ? clone(store.get(pathname)) : null;
    },
    paths(prefix) {
      return [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
    }
  };
}

function baseWorld(overrides = {}) {
  return {
    worldId: 'world-one',
    title: 'World One',
    status: 'draft',
    version: 11,
    rankCount: 2,
    gateCount: 4,
    wordCount: 6,
    updatedBy: 'old-admin',
    ...overrides
  };
}

function baseRank(overrides = {}) {
  return {
    worldId: 'world-one',
    rankId: 'rank-one',
    title: 'Rank One',
    subtitle: 'Source subtitle',
    description: 'Source description',
    difficulty: 'easy',
    unlockConfig: { mode: 'initial' },
    order: 3,
    status: 'archived',
    schemaVersion: 1,
    version: 5,
    gateCount: 2,
    wordCount: 3,
    createdBy: 'old-admin',
    updatedBy: 'old-admin',
    ...overrides
  };
}

function hierarchySeed(rankOverrides = {}, worldOverrides = {}) {
  return {
    'content_worlds/world-one': baseWorld(worldOverrides),
    'content_worlds/world-one/ranks/rank-one': baseRank(rankOverrides),
    'content_worlds/world-one/ranks/rank-one/gates/gate-a': {
      worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-a', title: 'Gate A',
      status: 'published', version: 4, schemaVersion: 1, order: 1,
      unlockConfig: {}, entryAssessmentPassRatio: 0.8, wordCount: 99,
      createdBy: 'old-admin', updatedBy: 'old-admin'
    },
    'content_worlds/world-one/ranks/rank-one/gates/gate-a/words/word-a': {
      worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-a',
      contentWordId: 'word-a', word: 'Sword', normalizedWord: 'sword',
      wordKey: 'sword', translation: 'سيف', normalizationVersion: 1,
      status: 'published', schemaVersion: 1, version: 2, order: 1,
      createdBy: 'old-admin', updatedBy: 'old-admin', secretToken: 'never-copy'
    },
    'content_worlds/world-one/ranks/rank-one/gates/gate-a/words/word-b': {
      worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-a',
      contentWordId: 'word-b', word: 'Shield', normalizedWord: 'shield',
      wordKey: 'shield', translation: 'درع', normalizationVersion: 1,
      status: 'archived', schemaVersion: 1, version: 7, order: 2,
      createdBy: 'old-admin', updatedBy: 'old-admin'
    },
    'content_worlds/world-one/ranks/rank-one/gates/gate-b': {
      worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-b', title: 'Gate B',
      status: 'archived', version: 3, schemaVersion: 1, order: 2,
      unlockConfig: {}, wordCount: 1, createdBy: 'old-admin', updatedBy: 'old-admin'
    },
    'content_worlds/world-one/ranks/rank-one/gates/gate-b/words/word-c': {
      worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-b',
      contentWordId: 'word-c', word: 'Potion', normalizedWord: 'potion',
      wordKey: 'potion', translation: 'جرعة', normalizationVersion: 1,
      status: 'draft', schemaVersion: 1, version: 1, order: 1,
      createdBy: 'old-admin', updatedBy: 'old-admin'
    }
  };
}

function dependencies(fake, overrides = {}) {
  return {
    db: fake.db,
    FieldValue: FakeFieldValue,
    HttpsError: FakeHttpsError,
    makeRequestId: () => 'generated-operation',
    now: () => NOW,
    logger: { error() {} },
    ...overrides
  };
}

function adminRequest(data) {
  return { auth: { uid: 'admin-uid', token: { admin: true } }, data };
}

function deletePayload(overrides = {}) {
  return {
    worldId: 'world-one',
    rankId: 'rank-one',
    confirmationTitle: 'Rank One',
    expectedVersion: 5,
    operationId: 'delete-op-1',
    ...overrides
  };
}

function duplicatePayload(overrides = {}) {
  return {
    worldId: 'world-one',
    rankId: 'rank-one',
    expectedVersion: 5,
    operationId: 'duplicate-op-1',
    ...overrides
  };
}

test('rank callable payloads strictly validate IDs, types, versions, and exact text', () => {
  assert.deepEqual(validateDeleteRankPayload(deletePayload()), deletePayload());
  assert.equal(
    validateDeleteRankPayload(deletePayload({ confirmationTitle: ' Rank One ' }))
      .confirmationTitle,
    ' Rank One '
  );
  assert.deepEqual(validateDuplicateRankPayload(duplicatePayload({ title: 'Draft copy' })), {
    ...duplicatePayload(),
    title: 'Draft copy'
  });

  for (const invalid of [
    null,
    [],
    deletePayload({ worldId: 'bad/id' }),
    deletePayload({ rankId: ' bad' }),
    deletePayload({ expectedVersion: 0 }),
    deletePayload({ expectedVersion: '5' }),
    deletePayload({ confirmationTitle: '' }),
    deletePayload({ operationId: 'bad/id' }),
    { ...deletePayload(), unexpected: true }
  ]) {
    assert.throws(() => validateDeleteRankPayload(invalid), RankAdminPayloadError);
  }
  for (const invalid of [
    duplicatePayload({ expectedVersion: 1.2 }),
    duplicatePayload({ title: ' ' }),
    duplicatePayload({ title: 'x'.repeat(161) }),
    { ...duplicatePayload(), confirmationTitle: 'not accepted' }
  ]) {
    assert.throws(() => validateDuplicateRankPayload(invalid), RankAdminPayloadError);
  }
});

test('counter and lease helpers fail closed', () => {
  assert.equal(normalizeCount(4), 4);
  assert.equal(normalizeCount(-1), 0);
  assert.equal(normalizeCount(10000001), 0);
  assert.equal(isLeaseActive({ leaseAt: new FakeTimestamp(NOW - 1) }, NOW), true);
  assert.equal(
    isLeaseActive({ leaseAt: new FakeTimestamp(NOW - OPERATION_LOCK_TTL_MS) }, NOW),
    false
  );
  assert.equal(isLeaseActive({ leaseAt: 'invalid' }, NOW), true);
});

test('both handlers require authentication and the strict boolean admin claim', async () => {
  const fake = createFakeDb(hierarchySeed());
  const handlers = [
    createDeleteContentRankHandler(dependencies(fake)),
    createDuplicateContentRankHandler(dependencies(fake))
  ];
  for (const handler of handlers) {
    await assert.rejects(() => handler({ data: {} }), { code: 'unauthenticated' });
    await assert.rejects(
      () => handler({ auth: { uid: 'user', token: { admin: 'true' } }, data: {} }),
      { code: 'permission-denied' }
    );
  }
  assert.deepEqual(fake.events, []);
});

test('delete requires archived status, exact title, and the current rank version', async () => {
  const cases = [
    [hierarchySeed({ status: 'draft' }), deletePayload(), 'failed-precondition'],
    [hierarchySeed(), deletePayload({ confirmationTitle: 'Rank One ' }), 'failed-precondition'],
    [hierarchySeed(), deletePayload({ expectedVersion: 4 }), 'aborted']
  ];
  for (const [seed, payload, code] of cases) {
    const fake = createFakeDb(seed);
    const handler = createDeleteContentRankHandler(dependencies(fake));
    await assert.rejects(() => handler(adminRequest(payload)), { code });
    assert.equal(fake.events.some((event) => event.startsWith('recursiveDelete:')), false);
    assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 0);
  }
});

test('version conflicts expose the stable facade mapping reason', async () => {
  const fake = createFakeDb(hierarchySeed());
  const handler = createDuplicateContentRankHandler(dependencies(fake));
  await assert.rejects(
    () => handler(adminRequest(duplicatePayload({ expectedVersion: 4 }))),
    (error) => {
      assert.equal(error.code, 'aborted');
      assert.deepEqual(error.details, {
        reason: 'version-conflict',
        expectedVersion: 4,
        actualVersion: 5
      });
      return true;
    }
  );
});

test('delete recursively removes one rank, clamps counters, audits compactly, and preserves world version', async () => {
  const fake = createFakeDb(hierarchySeed({}, {
    rankCount: 0,
    gateCount: 1,
    wordCount: -9,
    hugeObject: 'x'.repeat(100000)
  }));
  const handler = createDeleteContentRankHandler(dependencies(fake));
  const result = await handler(adminRequest(deletePayload()));

  assert.deepEqual(result, {
    deleted: true,
    operationId: 'delete-op-1',
    worldId: 'world-one',
    rankId: 'rank-one',
    affectedCounts: { rankCount: 1, gateCount: 2, wordCount: 3 }
  });
  assert.equal(fake.paths('content_worlds/world-one/ranks/rank-one').length, 0);
  const world = fake.get('content_worlds/world-one');
  assert.deepEqual([world.rankCount, world.gateCount, world.wordCount], [0, 0, 0]);
  assert.equal(world.version, 11, 'counter-only mutation must preserve world.version');
  assert.equal(world.updatedBy, 'admin-uid');

  const operationKey = createOperationKey('admin-uid', 'deleteContentRank', 'delete-op-1');
  const receipt = fake.get(`${CONTENT_OPERATIONS_COLLECTION}/${operationKey}`);
  const audit = fake.get(`${AUDIT_COLLECTION}/${operationKey}`);
  assert.equal(receipt.status, 'completed');
  assert.deepEqual(receipt.result, result);
  assert.equal(audit.action, 'delete');
  assert.equal(audit.entityType, 'rank');
  assert.deepEqual(audit.affectedCounts, result.affectedCounts);
  assert.ok(JSON.stringify(audit).length < 1500);
  assert.equal(JSON.stringify(audit).includes('hugeObject'), false);
});

test('a completed delete operation replays without a second recursive delete or counter update', async () => {
  const fake = createFakeDb(hierarchySeed());
  const handler = createDeleteContentRankHandler(dependencies(fake));
  const first = await handler(adminRequest(deletePayload()));
  const worldAfterFirst = fake.get('content_worlds/world-one');
  const second = await handler(adminRequest(deletePayload()));

  assert.deepEqual(second, first);
  assert.deepEqual(fake.get('content_worlds/world-one'), worldAfterFirst);
  assert.equal(
    fake.events.filter((event) => event.startsWith('recursiveDelete:')).length,
    1
  );
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 1);
});

test('a fresh running receipt rejects a concurrent delete with retry metadata', async () => {
  const barrier = deferred();
  const fake = createFakeDb(hierarchySeed(), { recursiveBarrier: barrier });
  const handler = createDeleteContentRankHandler(dependencies(fake));
  const firstCall = handler(adminRequest(deletePayload()));

  while (!fake.events.some((event) => event.startsWith('recursiveDelete:'))) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await assert.rejects(
    () => handler(adminRequest(deletePayload())),
    (error) => {
      assert.equal(error.code, 'aborted');
      assert.equal(error.details.operationId, 'delete-op-1');
      assert.equal(error.details.retryable, true);
      return true;
    }
  );
  barrier.resolve();
  await firstCall;
});

test('a recursive delete failure records a retryable failure, releases the lock, and can retry', async () => {
  const fake = createFakeDb(hierarchySeed(), { recursiveFailures: 1 });
  const handler = createDeleteContentRankHandler(dependencies(fake));
  await assert.rejects(
    () => handler(adminRequest(deletePayload())),
    (error) => error.code === 'internal' && error.details.retryable === true
  );

  const operationKey = createOperationKey('admin-uid', 'deleteContentRank', 'delete-op-1');
  assert.equal(fake.get(`${CONTENT_OPERATIONS_COLLECTION}/${operationKey}`).status, 'failed');
  assert.equal(Object.hasOwn(fake.get('content_worlds/world-one/ranks/rank-one'), OPERATION_LOCK_FIELD), false);
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 0);

  const retried = await handler(adminRequest(deletePayload()));
  assert.equal(retried.deleted, true);
  assert.equal(fake.get(`${CONTENT_OPERATIONS_COLLECTION}/${operationKey}`).status, 'completed');
});

test('duplicate creates deterministic draft descendants, recounts them, and commits one compact audit', async () => {
  const fake = createFakeDb(hierarchySeed({
    gateCount: 99,
    wordCount: 999,
    oversizedPrivateObject: { token: 'must-not-copy' }
  }));
  const handler = createDuplicateContentRankHandler(dependencies(fake));
  const result = await handler(adminRequest(duplicatePayload({ title: 'Rank One Copy' })));

  assert.equal(result.duplicated, true);
  assert.equal(result.operationId, 'duplicate-op-1');
  assert.equal(result.sourceRankId, 'rank-one');
  assert.deepEqual(result.affectedCounts, { rankCount: 1, gateCount: 2, wordCount: 3 });
  assert.equal(result.rank.title, 'Rank One Copy');
  assert.equal(result.rank.status, 'draft');
  assert.equal(result.rank.version, 1);
  assert.equal(JSON.stringify(result).includes('server-timestamp'), false);

  const targetPath = `content_worlds/world-one/ranks/${result.rankId}`;
  const target = fake.get(targetPath);
  assert.equal(target.status, 'draft');
  assert.equal(target.version, 1);
  assert.deepEqual([target.gateCount, target.wordCount], [2, 3]);
  assert.equal(Object.hasOwn(target, COPY_OPERATION_FIELD), false);
  assert.equal(Object.hasOwn(target, 'oversizedPrivateObject'), false);

  const targetPaths = fake.paths(`${targetPath}/gates/`);
  const gatePaths = targetPaths.filter((documentPath) =>
    documentPath.split('/').length === 6
  );
  const wordPaths = targetPaths.filter((documentPath) =>
    documentPath.split('/').length === 8
  );
  assert.equal(gatePaths.length, 2);
  assert.equal(wordPaths.length, 3);
  for (const documentPath of [...gatePaths, ...wordPaths]) {
    assert.equal(fake.get(documentPath).status, 'draft');
  }
  for (const documentPath of gatePaths) {
    assert.equal(fake.get(documentPath).version, 1);
    assert.equal(Object.hasOwn(fake.get(documentPath), 'entryAssessmentPassRatio'), true);
  }
  for (const documentPath of wordPaths) {
    assert.equal(Object.hasOwn(fake.get(documentPath), 'version'), false);
  }
  assert.equal(
    gatePaths.some((documentPath) => fake.get(documentPath).entryAssessmentPassRatio === 0.8),
    true
  );
  assert.deepEqual(gatePaths.map((documentPath) => fake.get(documentPath).wordCount).sort(), [1, 2]);
  assert.equal(wordPaths.some((documentPath) => JSON.stringify(fake.get(documentPath)).includes('never-copy')), false);

  const world = fake.get('content_worlds/world-one');
  assert.deepEqual([world.rankCount, world.gateCount, world.wordCount], [3, 6, 9]);
  assert.equal(world.version, 11);
  assert.equal(Object.hasOwn(fake.get('content_worlds/world-one/ranks/rank-one'), OPERATION_LOCK_FIELD), false);

  const operationKey = createOperationKey('admin-uid', 'duplicateContentRank', 'duplicate-op-1');
  const receipt = fake.get(`${CONTENT_OPERATIONS_COLLECTION}/${operationKey}`);
  const audit = fake.get(`${AUDIT_COLLECTION}/${operationKey}`);
  assert.equal(receipt.status, 'completed');
  assert.deepEqual(receipt.result, result);
  assert.equal(audit.action, 'duplicate');
  assert.deepEqual(audit.affectedCounts, result.affectedCounts);
  assert.ok(JSON.stringify(audit).length < 1500);
  assert.equal(JSON.stringify(audit).includes('must-not-copy'), false);
});

test('duplicate replay uses the receipt and cannot double-copy or increment the parent', async () => {
  const fake = createFakeDb(hierarchySeed());
  const handler = createDuplicateContentRankHandler(dependencies(fake));
  const first = await handler(adminRequest(duplicatePayload()));
  const worldAfterFirst = fake.get('content_worlds/world-one');
  const bulkSetCount = fake.events.filter((event) => event.startsWith('bulkSet:')).length;

  const second = await handler(adminRequest(duplicatePayload()));
  assert.deepEqual(second, first);
  assert.deepEqual(fake.get('content_worlds/world-one'), worldAfterFirst);
  assert.equal(fake.events.filter((event) => event.startsWith('bulkSet:')).length, bulkSetCount);
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 1);
});

test('operationId cannot be reused with a different duplicate payload', async () => {
  const fake = createFakeDb(hierarchySeed());
  const handler = createDuplicateContentRankHandler(dependencies(fake));
  await handler(adminRequest(duplicatePayload({ title: 'First title' })));
  await assert.rejects(
    () => handler(adminRequest(duplicatePayload({ title: 'Different title' }))),
    { code: 'already-exists' }
  );
});

test('duplicate fails closed if another privileged writer removes the source lock', async () => {
  const barrier = deferred();
  const fake = createFakeDb(hierarchySeed(), { bulkBarrier: barrier });
  const handler = createDuplicateContentRankHandler(dependencies(fake));
  const call = handler(adminRequest(duplicatePayload()));

  while (!fake.events.some((event) => event.startsWith('bulkSet:'))) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const sourcePath = 'content_worlds/world-one/ranks/rank-one';
  const changedSource = fake.get(sourcePath);
  delete changedSource[OPERATION_LOCK_FIELD];
  changedSource.version = 6;
  fake.db.store.set(sourcePath, changedSource);
  barrier.resolve();

  await assert.rejects(() => call, { code: 'failed-precondition' });
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 0);
  assert.deepEqual(
    [
      fake.get('content_worlds/world-one').rankCount,
      fake.get('content_worlds/world-one').gateCount,
      fake.get('content_worlds/world-one').wordCount
    ],
    [2, 4, 6]
  );
});

test('a BulkWriter failure exposes no success, leaves counters/audit unchanged, and retries safely', async () => {
  const fake = createFakeDb(hierarchySeed(), { bulkFailures: 1 });
  const handler = createDuplicateContentRankHandler(dependencies(fake));
  await assert.rejects(
    () => handler(adminRequest(duplicatePayload())),
    (error) => error.code === 'internal' && error.details.retryable === true
  );

  const worldAfterFailure = fake.get('content_worlds/world-one');
  assert.deepEqual([worldAfterFailure.rankCount, worldAfterFailure.gateCount, worldAfterFailure.wordCount], [2, 4, 6]);
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 0);
  assert.equal(Object.hasOwn(fake.get('content_worlds/world-one/ranks/rank-one'), OPERATION_LOCK_FIELD), false);

  const retried = await handler(adminRequest(duplicatePayload()));
  assert.equal(retried.duplicated, true);
  assert.deepEqual(retried.affectedCounts, { rankCount: 1, gateCount: 2, wordCount: 3 });
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 1);
});

test('Functions entrypoint exports both rank operations as v2 callables', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(source, /firebase-functions\/v2\/https/);
  assert.match(source, /exports\.deleteContentRank\s*=\s*onCall/);
  assert.match(source, /exports\.duplicateContentRank\s*=\s*onCall/);
  assert.equal((source.match(/timeoutSeconds:\s*540/g) || []).length >= 3, true);
});
