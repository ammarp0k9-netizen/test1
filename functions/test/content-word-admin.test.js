'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AUDIT_COLLECTION,
  CONTENT_OPERATIONS_COLLECTION,
  GATE_COPY_OPERATION_FIELD,
  GATE_OPERATION_LOCK_FIELD,
  MAX_BULK_WORDS,
  OPERATION_LOCK_TTL_MS,
  RANK_COPY_OPERATION_FIELD,
  RANK_OPERATION_LOCK_FIELD,
  WORLD_DELETE_LOCK_FIELD,
  WORLD_OPERATION_LOCK_FIELD,
  WRITE_CHUNK_SIZE,
  WordAdminPayloadError,
  createBulkUpdateContentWordsHandler,
  createContentWordId,
  createDeleteContentWordHandler,
  createDuplicateContentWordHandler,
  createMoveContentWordHandler,
  createOperationKey,
  validateBulkWordPayload,
  validateDeleteWordPayload,
  validateDuplicateWordPayload,
  validateMoveWordPayload
} = require('../content-word-admin');

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
}

class FakeQuery {
  constructor(database, collectionPath, filters = [], maximum = Infinity) {
    this.database = database;
    this.path = collectionPath;
    this.filters = filters;
    this.maximum = maximum;
  }

  where(field, operator, value) {
    if (operator !== '==') throw new Error(`Unsupported fake query operator: ${operator}`);
    return new FakeQuery(
      this.database,
      this.path,
      [...this.filters, { field, value }],
      this.maximum
    );
  }

  limit(maximum) {
    return new FakeQuery(this.database, this.path, this.filters, maximum);
  }
}

class FakeCollectionReference extends FakeQuery {
  constructor(database, collectionPath) {
    super(database, collectionPath);
  }

  doc(id) {
    return new FakeDocumentReference(this.database, `${this.path}/${id}`);
  }
}

function createFakeDb(seed = {}, options = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
  const events = [];
  let failCommitCount = options.failCommitCount || 0;
  let transactionTail = Promise.resolve();

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
    querySnapshot(query) {
      const prefix = `${query.path}/`;
      const docs = [];
      for (const documentPath of [...store.keys()].sort()) {
        if (!documentPath.startsWith(prefix)) continue;
        const suffix = documentPath.slice(prefix.length);
        if (suffix.includes('/')) continue;
        const data = store.get(documentPath);
        if (!query.filters.every((filter) => data[filter.field] === filter.value)) continue;
        docs.push(db.snapshot(new FakeDocumentReference(db, documentPath)));
        if (docs.length >= query.maximum) break;
      }
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    runTransaction(callback) {
      const execute = async () => {
        events.push('transaction');
        const writes = [];
        const transaction = {
          async get(referenceOrQuery) {
            if (referenceOrQuery instanceof FakeQuery &&
                !(referenceOrQuery instanceof FakeDocumentReference)) {
              return db.querySnapshot(referenceOrQuery);
            }
            return db.snapshot(referenceOrQuery);
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
          },
          delete(reference) {
            writes.push(() => {
              events.push(`delete:${reference.path}`);
              store.delete(reference.path);
            });
          }
        };
        const result = await callback(transaction);
        if (failCommitCount > 0) {
          failCommitCount -= 1;
          throw new Error('injected atomic commit failure');
        }
        for (const write of writes) write();
        return result;
      };
      const result = transactionTail.then(execute, execute);
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }
  };

  return {
    db,
    events,
    get(documentPath) {
      return store.has(documentPath) ? clone(store.get(documentPath)) : null;
    },
    paths(prefix) {
      return [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
    }
  };
}

function world(worldId, wordCount, overrides = {}) {
  return {
    worldId,
    title: worldId,
    status: 'draft',
    version: 9,
    rankCount: 1,
    gateCount: 1,
    wordCount,
    updatedBy: 'old-admin',
    ...overrides
  };
}

function rank(worldId, rankId, wordCount, overrides = {}) {
  return {
    worldId,
    rankId,
    title: rankId,
    status: 'draft',
    schemaVersion: 1,
    version: 7,
    gateCount: 1,
    wordCount,
    updatedBy: 'old-admin',
    ...overrides
  };
}

function gate(worldId, rankId, gateId, wordCount, overrides = {}) {
  return {
    worldId,
    rankId,
    gateId,
    title: gateId,
    status: 'published',
    schemaVersion: 1,
    version: 5,
    wordCount,
    updatedBy: 'old-admin',
    ...overrides
  };
}

function normalize(value) {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function masteryKey(value) {
  return normalize(value)
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

function word(worldId, rankId, gateId, contentWordId, value, overrides = {}) {
  return {
    schemaVersion: 1,
    normalizationVersion: 1,
    worldId,
    rankId,
    gateId,
    contentWordId,
    word: value,
    normalizedWord: normalize(value),
    wordKey: masteryKey(value),
    translation: `translation-${value}`,
    definition: '',
    tags: [],
    synonyms: [],
    order: 1,
    status: 'published',
    version: 3,
    createdAt: new FakeTimestamp(100),
    updatedAt: new FakeTimestamp(200),
    createdBy: 'author',
    updatedBy: 'author',
    ...overrides
  };
}

function baseSeed() {
  const sourceGate = 'content_worlds/world-one/ranks/rank-one/gates/gate-one';
  const targetGate = 'content_worlds/world-two/ranks/rank-two/gates/gate-two';
  return {
    'content_worlds/world-one': world('world-one', 3),
    'content_worlds/world-one/ranks/rank-one': rank('world-one', 'rank-one', 3),
    [sourceGate]: gate('world-one', 'rank-one', 'gate-one', 3),
    [`${sourceGate}/words/sword-legacy`]: word(
      'world-one', 'rank-one', 'gate-one', 'sword-legacy', 'Sword'
    ),
    [`${sourceGate}/words/shield-legacy`]: word(
      'world-one', 'rank-one', 'gate-one', 'shield-legacy', 'Shield',
      { status: 'archived', version: 4, order: 2 }
    ),
    [`${sourceGate}/words/potion-legacy`]: word(
      'world-one', 'rank-one', 'gate-one', 'potion-legacy', 'Potion',
      { status: 'draft', version: 2, order: 3 }
    ),
    'content_worlds/world-two': world('world-two', 0),
    'content_worlds/world-two/ranks/rank-two': rank('world-two', 'rank-two', 0),
    [targetGate]: gate('world-two', 'rank-two', 'gate-two', 0)
  };
}

function dependencies(fake) {
  return {
    db: fake.db,
    FieldValue: FakeFieldValue,
    HttpsError: FakeHttpsError,
    now: () => NOW,
    logger: { error() {} }
  };
}

function adminRequest(data) {
  return { auth: { uid: 'admin-one', token: { admin: true } }, data };
}

const duplicatePayload = {
  worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-one',
  contentWordId: 'sword-legacy',
  targetWorldId: 'world-two', targetRankId: 'rank-two', targetGateId: 'gate-two',
  expectedVersion: 3, operationId: 'duplicate-word-1'
};

const movePayload = {
  ...duplicatePayload,
  confirmationWord: 'Sword',
  operationId: 'move-word-1'
};

const deletePayload = {
  worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-one',
  contentWordId: 'shield-legacy', confirmationWord: 'Shield',
  expectedVersion: 4, operationId: 'delete-word-1'
};

const bulkPublishPayload = {
  action: 'publish',
  worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-one',
  items: [
    { contentWordId: 'sword-legacy', expectedVersion: 3 },
    { contentWordId: 'potion-legacy', expectedVersion: 2 }
  ],
  operationId: 'bulk-publish-1'
};

test('strict payload validators accept the contract and reject extras, unsafe IDs, same gates, and invalid bulk data', () => {
  assert.deepEqual(validateDuplicateWordPayload(duplicatePayload), duplicatePayload);
  assert.deepEqual(validateMoveWordPayload(movePayload), movePayload);
  assert.deepEqual(validateDeleteWordPayload(deletePayload), deletePayload);
  assert.deepEqual(validateBulkWordPayload(bulkPublishPayload), bulkPublishPayload);
  assert.throws(
    () => validateDuplicateWordPayload({ ...duplicatePayload, extra: true }),
    WordAdminPayloadError
  );
  assert.throws(
    () => validateMoveWordPayload({
      ...movePayload,
      targetWorldId: 'world-one', targetRankId: 'rank-one', targetGateId: 'gate-one'
    }),
    WordAdminPayloadError
  );
  assert.throws(
    () => validateDeleteWordPayload({ ...deletePayload, contentWordId: '../unsafe' }),
    WordAdminPayloadError
  );
  assert.throws(
    () => validateBulkWordPayload({
      ...bulkPublishPayload,
      items: [bulkPublishPayload.items[0], bulkPublishPayload.items[0]]
    }),
    WordAdminPayloadError
  );
  assert.throws(
    () => validateBulkWordPayload({
      ...bulkPublishPayload,
      targetWorldId: 'world-two', targetRankId: 'rank-two', targetGateId: 'gate-two'
    }),
    WordAdminPayloadError
  );
  assert.equal(MAX_BULK_WORDS, 100);
  assert.equal(WRITE_CHUNK_SIZE, 300);
});

test('content identity and operation keys are deterministic, bounded, and account scoped', () => {
  const expected = `word_${createHash('sha256').update('1\0sword').digest('hex')}`;
  assert.equal(createContentWordId(1, 'sword'), expected);
  assert.equal(createContentWordId(1, 'sword').length, 69);
  assert.equal(createOperationKey('admin-one', 'moveContentWord', 'op-1').length, 71);
  assert.notEqual(
    createOperationKey('admin-one', 'moveContentWord', 'op-1'),
    createOperationKey('admin-two', 'moveContentWord', 'op-1')
  );
});

test('Functions entrypoint exports all four word operations and check script includes the module', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  for (const name of [
    'duplicateContentWord', 'moveContentWord', 'bulkUpdateContentWords', 'deleteContentWord'
  ]) {
    assert.match(indexSource, new RegExp(`exports\\.${name}\\s*=\\s*onCall\\(`));
  }
  assert.match(indexSource, /timeoutSeconds:\s*120/);
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );
  assert.match(packageJson.scripts.check, /content-word-admin\.js/);
});

test('every word handler requires auth and the strict boolean admin claim before payload handling', async () => {
  const fake = createFakeDb(baseSeed());
  const handlers = [
    createDuplicateContentWordHandler(dependencies(fake)),
    createMoveContentWordHandler(dependencies(fake)),
    createDeleteContentWordHandler(dependencies(fake)),
    createBulkUpdateContentWordsHandler(dependencies(fake))
  ];
  for (const handler of handlers) {
    await assert.rejects(() => handler({ data: null }), { code: 'permission-denied' });
    await assert.rejects(
      () => handler({ auth: { uid: 'user', token: { admin: 'true' } }, data: null }),
      { code: 'permission-denied' }
    );
  }
  assert.equal(fake.events.length, 0);
});

test('duplicate creates one deterministic draft in another gate, increments actual target counters, audits, and replays once', async () => {
  const fake = createFakeDb(baseSeed());
  const handler = createDuplicateContentWordHandler(dependencies(fake));
  const first = await handler(adminRequest(duplicatePayload));
  const replay = await handler(adminRequest(duplicatePayload));
  assert.deepEqual(replay, first);
  const targetId = createContentWordId(1, 'sword');
  assert.equal(first.target.contentWordId, targetId);
  const targetPath = `content_worlds/world-two/ranks/rank-two/gates/gate-two/words/${targetId}`;
  const copied = fake.get(targetPath);
  assert.equal(copied.status, 'draft');
  assert.equal(copied.version, 1);
  assert.equal(copied.normalizedWord, 'sword');
  assert.equal(copied.worldId, 'world-two');
  assert.ok(fake.get('content_worlds/world-one/ranks/rank-one/gates/gate-one/words/sword-legacy'));
  assert.deepEqual([
    fake.get('content_worlds/world-two').wordCount,
    fake.get('content_worlds/world-two/ranks/rank-two').wordCount,
    fake.get('content_worlds/world-two/ranks/rank-two/gates/gate-two').wordCount
  ], [1, 1, 1]);
  const operationKey = createOperationKey('admin-one', 'duplicateContentWord', 'duplicate-word-1');
  assert.equal(fake.get(`${CONTENT_OPERATIONS_COLLECTION}/${operationKey}`).status, 'completed');
  assert.equal(fake.get(`${AUDIT_COLLECTION}/${operationKey}`).action, 'duplicate');
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 1);
});

test('duplicate prevents normalized collisions and operationId fingerprint reuse without partial writes', async () => {
  const seed = baseSeed();
  const targetId = createContentWordId(1, 'sword');
  seed[`content_worlds/world-two/ranks/rank-two/gates/gate-two/words/${targetId}`] = word(
    'world-two', 'rank-two', 'gate-two', targetId, 'Sword'
  );
  seed['content_worlds/world-two'].wordCount = 1;
  seed['content_worlds/world-two/ranks/rank-two'].wordCount = 1;
  seed['content_worlds/world-two/ranks/rank-two/gates/gate-two'].wordCount = 1;
  const fake = createFakeDb(seed);
  const handler = createDuplicateContentWordHandler(dependencies(fake));
  await assert.rejects(() => handler(adminRequest(duplicatePayload)), { code: 'already-exists' });
  assert.equal(fake.get('content_worlds/world-two').wordCount, 1);
  assert.equal(fake.paths(`${CONTENT_OPERATIONS_COLLECTION}/`).length, 0);

  const cleanFake = createFakeDb(baseSeed());
  const cleanHandler = createDuplicateContentWordHandler(dependencies(cleanFake));
  await cleanHandler(adminRequest(duplicatePayload));
  await assert.rejects(
    () => cleanHandler(adminRequest({ ...duplicatePayload, contentWordId: 'potion-legacy' })),
    { code: 'already-exists' }
  );
});

test('two concurrent duplicate submissions commit one mutation and return one replayable result', async () => {
  const fake = createFakeDb(baseSeed());
  const handler = createDuplicateContentWordHandler(dependencies(fake));
  const [first, second] = await Promise.all([
    handler(adminRequest(duplicatePayload)),
    handler(adminRequest(duplicatePayload))
  ]);
  assert.deepEqual(second, first);
  assert.equal(fake.get('content_worlds/world-two').wordCount, 1);
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 1);
});

test('move requires exact confirmation and expectedVersion, then preserves status and atomically transfers counters', async () => {
  const fake = createFakeDb(baseSeed());
  const handler = createMoveContentWordHandler(dependencies(fake));
  await assert.rejects(
    () => handler(adminRequest({ ...movePayload, confirmationWord: 'sword' })),
    { code: 'failed-precondition' }
  );
  await assert.rejects(
    () => handler(adminRequest({ ...movePayload, expectedVersion: 2 })),
    { code: 'aborted' }
  );
  const result = await handler(adminRequest(movePayload));
  const targetId = createContentWordId(1, 'sword');
  assert.equal(result.target.contentWordId, targetId);
  assert.equal(
    fake.get('content_worlds/world-one/ranks/rank-one/gates/gate-one/words/sword-legacy'),
    null
  );
  const moved = fake.get(
    `content_worlds/world-two/ranks/rank-two/gates/gate-two/words/${targetId}`
  );
  assert.equal(moved.status, 'published');
  assert.equal(moved.version, 4);
  assert.equal(moved.contentWordId, targetId);
  assert.deepEqual([
    fake.get('content_worlds/world-one').wordCount,
    fake.get('content_worlds/world-one/ranks/rank-one').wordCount,
    fake.get('content_worlds/world-one/ranks/rank-one/gates/gate-one').wordCount,
    fake.get('content_worlds/world-two').wordCount,
    fake.get('content_worlds/world-two/ranks/rank-two').wordCount,
    fake.get('content_worlds/world-two/ranks/rank-two/gates/gate-two').wordCount
  ], [2, 2, 2, 1, 1, 1]);
});

test('move rejects target collisions and active or malformed hierarchy locks, while an expired lock is recoverable', async () => {
  for (const [path, field, value, code] of [
    ['content_worlds/world-one', WORLD_OPERATION_LOCK_FIELD,
      { operationKey: 'other', action: 'move', leaseAt: new FakeTimestamp(NOW) }, 'aborted'],
    ['content_worlds/world-one/ranks/rank-one', RANK_OPERATION_LOCK_FIELD,
      { operationKey: 'other', action: 'move', leaseAt: new FakeTimestamp(NOW) }, 'aborted'],
    ['content_worlds/world-one/ranks/rank-one/gates/gate-one', GATE_OPERATION_LOCK_FIELD,
      { malformed: true }, 'failed-precondition'],
    ['content_worlds/world-one/ranks/rank-one', RANK_COPY_OPERATION_FIELD,
      'copy-reservation', 'failed-precondition'],
    ['content_worlds/world-one/ranks/rank-one/gates/gate-one', GATE_COPY_OPERATION_FIELD,
      'copy-reservation', 'failed-precondition'],
    ['content_worlds/world-one', WORLD_DELETE_LOCK_FIELD,
      { requestedAt: new FakeTimestamp(NOW) }, 'aborted']
  ]) {
    const seed = baseSeed();
    seed[path][field] = value;
    const fake = createFakeDb(seed);
    const handler = createMoveContentWordHandler(dependencies(fake));
    await assert.rejects(() => handler(adminRequest(movePayload)), { code });
  }

  const expiredSeed = baseSeed();
  expiredSeed['content_worlds/world-one'][WORLD_OPERATION_LOCK_FIELD] = {
    operationKey: 'old', action: 'move',
    leaseAt: new FakeTimestamp(NOW - OPERATION_LOCK_TTL_MS - 1)
  };
  const expiredFake = createFakeDb(expiredSeed);
  await createMoveContentWordHandler(dependencies(expiredFake))(adminRequest(movePayload));
  assert.equal(expiredFake.get('content_worlds/world-one').wordCount, 2);
});

test('delete is archived-only with exact confirmation and decrements all three counters once', async () => {
  const fake = createFakeDb(baseSeed());
  const handler = createDeleteContentWordHandler(dependencies(fake));
  await assert.rejects(
    () => handler(adminRequest({
      ...deletePayload,
      contentWordId: 'sword-legacy', expectedVersion: 3, confirmationWord: 'Sword'
    })),
    { code: 'failed-precondition' }
  );
  await assert.rejects(
    () => handler(adminRequest({ ...deletePayload, confirmationWord: ' Shield' })),
    { code: 'failed-precondition' }
  );
  const first = await handler(adminRequest(deletePayload));
  const replay = await handler(adminRequest(deletePayload));
  assert.deepEqual(replay, first);
  assert.equal(
    fake.get('content_worlds/world-one/ranks/rank-one/gates/gate-one/words/shield-legacy'),
    null
  );
  assert.deepEqual([
    fake.get('content_worlds/world-one').wordCount,
    fake.get('content_worlds/world-one/ranks/rank-one').wordCount,
    fake.get('content_worlds/world-one/ranks/rank-one/gates/gate-one').wordCount
  ], [2, 2, 2]);
});

test('an injected commit failure has no false success, no partial counters, receipt, or audit; retry is safe', async () => {
  const fake = createFakeDb(baseSeed(), { failCommitCount: 1 });
  const handler = createDeleteContentWordHandler(dependencies(fake));
  await assert.rejects(() => handler(adminRequest(deletePayload)), {
    code: 'internal',
    details: { operationId: 'delete-word-1', retryable: true }
  });
  assert.ok(fake.get(
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/shield-legacy'
  ));
  assert.equal(fake.get('content_worlds/world-one').wordCount, 3);
  assert.equal(fake.paths(`${CONTENT_OPERATIONS_COLLECTION}/`).length, 0);
  assert.equal(fake.paths(`${AUDIT_COLLECTION}/`).length, 0);
  const result = await handler(adminRequest(deletePayload));
  assert.equal(result.deleted, true);
  assert.equal(fake.get('content_worlds/world-one').wordCount, 2);
});

test('bulk publish/archive updates up to 100 strict versions atomically, audits compactly, and replays', async () => {
  const fake = createFakeDb(baseSeed());
  const handler = createBulkUpdateContentWordsHandler(dependencies(fake));
  const first = await handler(adminRequest(bulkPublishPayload));
  const replay = await handler(adminRequest(bulkPublishPayload));
  assert.deepEqual(replay, first);
  assert.equal(first.itemCount, 2);
  assert.equal(first.affectedCounts.wordCount, 0);
  assert.equal(fake.get(
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/sword-legacy'
  ).version, 4);
  const potion = fake.get(
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/potion-legacy'
  );
  assert.equal(potion.status, 'published');
  assert.equal(potion.version, 3);
  assert.equal(fake.get('content_worlds/world-one').wordCount, 3);
  const key = createOperationKey('admin-one', 'bulkUpdateContentWords', 'bulk-publish-1');
  const audit = fake.get(`${AUDIT_COLLECTION}/${key}`);
  assert.equal(audit.itemCount, 2);
  assert.deepEqual(audit.contentWordIds, ['sword-legacy', 'potion-legacy']);

  const tooMany = Array.from({ length: MAX_BULK_WORDS + 1 }, (_, index) => ({
    contentWordId: `word-${index}`, expectedVersion: 1
  }));
  assert.throws(
    () => validateBulkWordPayload({ ...bulkPublishPayload, items: tooMany }),
    WordAdminPayloadError
  );
});

test('one stale version makes the entire bulk status transaction fail without partial updates', async () => {
  const fake = createFakeDb(baseSeed());
  const handler = createBulkUpdateContentWordsHandler(dependencies(fake));
  await assert.rejects(() => handler(adminRequest({
    ...bulkPublishPayload,
    items: [bulkPublishPayload.items[0], { contentWordId: 'potion-legacy', expectedVersion: 99 }]
  })), { code: 'aborted' });
  assert.equal(fake.get(
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/sword-legacy'
  ).version, 3);
  assert.equal(fake.get(
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/potion-legacy'
  ).status, 'draft');
  assert.equal(fake.paths(`${CONTENT_OPERATIONS_COLLECTION}/`).length, 0);
});

test('bulk move transfers every selected word atomically using central deterministic IDs and exact counters', async () => {
  const fake = createFakeDb(baseSeed());
  const handler = createBulkUpdateContentWordsHandler(dependencies(fake));
  const payload = {
    action: 'move',
    worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-one',
    targetWorldId: 'world-two', targetRankId: 'rank-two', targetGateId: 'gate-two',
    items: [
      { contentWordId: 'sword-legacy', expectedVersion: 3 },
      { contentWordId: 'potion-legacy', expectedVersion: 2 }
    ],
    operationId: 'bulk-move-1'
  };
  const result = await handler(adminRequest(payload));
  assert.equal(result.itemCount, 2);
  assert.equal(result.affectedCounts.wordCount, 2);
  for (const [legacyId, normalizedWord] of [
    ['sword-legacy', 'sword'], ['potion-legacy', 'potion']
  ]) {
    assert.equal(fake.get(
      `content_worlds/world-one/ranks/rank-one/gates/gate-one/words/${legacyId}`
    ), null);
    const targetId = createContentWordId(1, normalizedWord);
    const moved = fake.get(
      `content_worlds/world-two/ranks/rank-two/gates/gate-two/words/${targetId}`
    );
    assert.equal(moved.contentWordId, targetId);
  }
  assert.deepEqual([
    fake.get('content_worlds/world-one').wordCount,
    fake.get('content_worlds/world-one/ranks/rank-one').wordCount,
    fake.get('content_worlds/world-one/ranks/rank-one/gates/gate-one').wordCount,
    fake.get('content_worlds/world-two').wordCount,
    fake.get('content_worlds/world-two/ranks/rank-two').wordCount,
    fake.get('content_worlds/world-two/ranks/rank-two/gates/gate-two').wordCount
  ], [1, 1, 1, 2, 2, 2]);
});

test('a single target normalized collision aborts an entire bulk move with no deletes or counter changes', async () => {
  const seed = baseSeed();
  const potionId = createContentWordId(1, 'potion');
  seed[`content_worlds/world-two/ranks/rank-two/gates/gate-two/words/${potionId}`] = word(
    'world-two', 'rank-two', 'gate-two', potionId, 'Potion'
  );
  seed['content_worlds/world-two'].wordCount = 1;
  seed['content_worlds/world-two/ranks/rank-two'].wordCount = 1;
  seed['content_worlds/world-two/ranks/rank-two/gates/gate-two'].wordCount = 1;
  const fake = createFakeDb(seed);
  const handler = createBulkUpdateContentWordsHandler(dependencies(fake));
  await assert.rejects(() => handler(adminRequest({
    action: 'move',
    worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-one',
    targetWorldId: 'world-two', targetRankId: 'rank-two', targetGateId: 'gate-two',
    items: [
      { contentWordId: 'sword-legacy', expectedVersion: 3 },
      { contentWordId: 'potion-legacy', expectedVersion: 2 }
    ],
    operationId: 'bulk-collision-1'
  })), { code: 'already-exists' });
  assert.ok(fake.get(
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/sword-legacy'
  ));
  assert.ok(fake.get(
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/potion-legacy'
  ));
  assert.equal(fake.get('content_worlds/world-one').wordCount, 3);
  assert.equal(fake.get('content_worlds/world-two').wordCount, 1);
  assert.equal(fake.paths(`${CONTENT_OPERATIONS_COLLECTION}/`).length, 0);
});

test('counter underflow and malformed stored words are rejected before any destructive write', async () => {
  const underflowSeed = baseSeed();
  underflowSeed['content_worlds/world-one'].wordCount = 0;
  const underflowFake = createFakeDb(underflowSeed);
  await assert.rejects(
    () => createDeleteContentWordHandler(dependencies(underflowFake))(adminRequest(deletePayload)),
    { code: 'failed-precondition' }
  );
  assert.ok(underflowFake.get(
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/shield-legacy'
  ));

  const malformedSeed = baseSeed();
  malformedSeed[
    'content_worlds/world-one/ranks/rank-one/gates/gate-one/words/shield-legacy'
  ].normalizedWord = 'forged';
  const malformedFake = createFakeDb(malformedSeed);
  await assert.rejects(
    () => createDeleteContentWordHandler(dependencies(malformedFake))(adminRequest(deletePayload)),
    { code: 'failed-precondition' }
  );
});

