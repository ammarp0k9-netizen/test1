'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AUDIT_COLLECTION,
  CONTENT_OPERATIONS_COLLECTION,
  GATE_COPY_OPERATION_FIELD,
  GATE_OPERATION_LOCK_FIELD,
  OPERATION_LOCK_TTL_MS,
  PARENT_RANK_LOCK_FIELD,
  RANK_COPY_OPERATION_FIELD,
  WORLD_DELETE_LOCK_FIELD,
  WORLD_OPERATION_LOCK_FIELD,
  GateAdminPayloadError,
  createDeleteContentGateHandler,
  createDuplicateContentGateHandler,
  createDuplicateGateId,
  createMoveContentGateHandler,
  createOperationKey,
  validateDeleteGatePayload,
  validateDuplicateGatePayload,
  validateMoveGatePayload
} = require('../content-gate-admin');

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
          return Promise.resolve().then(() => {
            if (bulkFailures > 0) {
              bulkFailures -= 1;
              throw new Error('bulk write failed');
            }
            setDocument(reference, data);
          });
        },
        delete(reference) {
          events.push(`bulkDelete:${reference.path}`);
          return Promise.resolve().then(() => store.delete(reference.path));
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
    get(documentPath) {
      return store.has(documentPath) ? clone(store.get(documentPath)) : null;
    },
    paths(prefix) {
      return [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
    }
  };
}

function world(worldId, overrides = {}) {
  return {
    worldId,
    title: worldId,
    status: 'draft',
    version: 9,
    rankCount: 2,
    gateCount: 4,
    wordCount: 8,
    updatedBy: 'old-admin',
    ...overrides
  };
}

function rank(worldId, rankId, overrides = {}) {
  return {
    worldId,
    rankId,
    title: rankId,
    status: 'draft',
    schemaVersion: 1,
    version: 7,
    gateCount: 2,
    wordCount: 4,
    updatedBy: 'old-admin',
    ...overrides
  };
}

function gate(worldId, rankId, gateId, overrides = {}) {
  return {
    worldId,
    rankId,
    gateId,
    title: 'Gate One',
    subtitle: 'A source gate',
    order: 3,
    difficulty: 'easy',
    status: 'published',
    schemaVersion: 1,
    version: 5,
    wordCount: 2,
    entryAssessmentPassRatio: 0.8,
    unlockConfig: {
      mode: 'manual_placeholder', initialStatus: 'locked',
      requiredMasteredRatio: null, requiredReviewingRatio: null, requiredGateCount: null
    },
    createdAt: new FakeTimestamp(100),
    updatedAt: new FakeTimestamp(200),
    createdBy: 'author',
    updatedBy: 'author',
    ...overrides
  };
}

function word(worldId, rankId, gateId, wordId, overrides = {}) {
  return {
    normalizationVersion: 1,
    schemaVersion: 1,
    worldId,
    rankId,
    gateId,
    contentWordId: wordId,
    word: wordId,
    normalizedWord: wordId,
    wordKey: wordId,
    translation: `translation-${wordId}`,
    order: 1,
    status: 'published',
    createdAt: new FakeTimestamp(100),
    updatedAt: new FakeTimestamp(200),
    createdBy: 'author',
    updatedBy: 'author',
    ...overrides
  };
}

function sourceSeed(gateOverrides = {}, rankOverrides = {}, worldOverrides = {}) {
  const base = 'content_worlds/world-one/ranks/rank-one/gates/gate-one';
  return {
    'content_worlds/world-one': world('world-one', worldOverrides),
    'content_worlds/world-one/ranks/rank-one': rank('world-one', 'rank-one', rankOverrides),
    [base]: gate('world-one', 'rank-one', 'gate-one', gateOverrides),
    [`${base}/words/sword`]: word('world-one', 'rank-one', 'gate-one', 'sword'),
    [`${base}/words/shield`]: word('world-one', 'rank-one', 'gate-one', 'shield', {
      status: 'archived'
    })
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
  expectedVersion: 5, operationId: 'duplicate-gate-1'
};
const deletePayload = {
  worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-one',
  confirmationTitle: 'Gate One', expectedVersion: 5, operationId: 'delete-gate-1'
};
const movePayload = {
  worldId: 'world-one', rankId: 'rank-one', gateId: 'gate-one',
  targetWorldId: 'world-two', targetRankId: 'rank-two',
  confirmationTitle: 'Gate One',
  expectedVersion: 5, operationId: 'move-gate-1'
};

test('payload validators reject unsupported, unsafe, missing, and same-parent requests', () => {
  assert.deepEqual(validateDuplicateGatePayload(duplicatePayload), duplicatePayload);
  assert.deepEqual(validateDeleteGatePayload(deletePayload), deletePayload);
  assert.deepEqual(validateMoveGatePayload(movePayload), movePayload);
  assert.throws(
    () => validateDuplicateGatePayload({ ...duplicatePayload, operationId: undefined }),
    GateAdminPayloadError
  );
  assert.throws(
    () => validateDeleteGatePayload({ ...deletePayload, extra: true }),
    GateAdminPayloadError
  );
  assert.throws(
    () => validateMoveGatePayload({
      ...movePayload, targetWorldId: 'world-one', targetRankId: 'rank-one'
    }),
    GateAdminPayloadError
  );
  assert.throws(
    () => validateMoveGatePayload({ ...movePayload, confirmationTitle: undefined }),
    GateAdminPayloadError
  );
});

test('Functions entrypoint exports all three gate operations as v2 callables', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  for (const name of ['deleteContentGate', 'duplicateContentGate', 'moveContentGate']) {
    assert.match(source, new RegExp(`exports\\.${name}\\s*=\\s*onCall\\(`));
  }
  assert.match(source, /memory:\s*'512MiB'/);
  assert.match(source, /timeoutSeconds:\s*540/);
});

test('all gate handlers require a strict verified admin claim', async () => {
  const fake = createFakeDb(sourceSeed({ status: 'archived' }));
  const handlers = [
    [createDuplicateContentGateHandler(dependencies(fake)), duplicatePayload],
    [createDeleteContentGateHandler(dependencies(fake)), deletePayload],
    [createMoveContentGateHandler(dependencies(fake)), movePayload]
  ];
  for (const [handler, payload] of handlers) {
    await assert.rejects(
      handler({ auth: { uid: 'user', token: { admin: false } }, data: payload }),
      (error) => error.code === 'permission-denied'
    );
  }
});

test('duplicate copies the actual hierarchy as draft and increments counters once', async () => {
  const fake = createFakeDb(sourceSeed());
  const handler = createDuplicateContentGateHandler(dependencies(fake));
  const first = await handler(adminRequest(duplicatePayload));
  assert.equal(first.duplicated, true);
  assert.deepEqual(first.affectedCounts, { gateCount: 1, wordCount: 2 });
  const operationKey = createOperationKey('admin-one', 'duplicateContentGate', 'duplicate-gate-1');
  const targetGateId = createDuplicateGateId(operationKey, 'gate-one');
  const targetBase = `content_worlds/world-one/ranks/rank-one/gates/${targetGateId}`;
  const copiedGate = fake.get(targetBase);
  assert.equal(copiedGate.status, 'draft');
  assert.equal(copiedGate.version, 1);
  assert.equal(copiedGate.wordCount, 2);
  assert.equal(copiedGate.entryAssessmentPassRatio, 0.8);
  assert.equal(GATE_COPY_OPERATION_FIELD in copiedGate, false);
  assert.equal(fake.get(`${targetBase}/words/sword`).status, 'draft');
  assert.equal(fake.get(`${targetBase}/words/shield`).status, 'draft');
  const savedRank = fake.get('content_worlds/world-one/ranks/rank-one');
  const savedWorld = fake.get('content_worlds/world-one');
  assert.deepEqual(
    [savedRank.gateCount, savedRank.wordCount, savedWorld.gateCount, savedWorld.wordCount],
    [3, 6, 5, 10]
  );
  assert.equal(savedRank.version, 7);
  assert.equal(savedWorld.version, 9);
  assert.equal(WORLD_OPERATION_LOCK_FIELD in savedWorld, false);
  assert.equal(PARENT_RANK_LOCK_FIELD in savedRank, false);
  assert.equal(
    GATE_OPERATION_LOCK_FIELD in fake.get(
      'content_worlds/world-one/ranks/rank-one/gates/gate-one'
    ),
    false
  );
  assert.equal(fake.get(`${AUDIT_COLLECTION}/${operationKey}`).action, 'duplicate');

  const replay = await handler(adminRequest(duplicatePayload));
  assert.deepEqual(replay, first);
  assert.equal(fake.get('content_worlds/world-one/ranks/rank-one').gateCount, 3);
  assert.equal(fake.get('content_worlds/world-one').wordCount, 10);
  await assert.rejects(
    handler(adminRequest({ ...duplicatePayload, expectedVersion: 6 })),
    (error) => error.code === 'already-exists'
  );
});

test('duplicate rejects version conflicts, deterministic collisions, and malformed locks', async () => {
  const stale = createFakeDb(sourceSeed());
  await assert.rejects(
    createDuplicateContentGateHandler(dependencies(stale))(
      adminRequest({ ...duplicatePayload, expectedVersion: 4 })
    ),
    (error) => error.code === 'aborted' && error.details.reason === 'version-conflict'
  );

  const operationKey = createOperationKey('admin-one', 'duplicateContentGate', 'duplicate-gate-1');
  const targetGateId = createDuplicateGateId(operationKey, 'gate-one');
  const collisionSeed = sourceSeed();
  collisionSeed[`content_worlds/world-one/ranks/rank-one/gates/${targetGateId}`] = gate(
    'world-one', 'rank-one', targetGateId
  );
  const collision = createFakeDb(collisionSeed);
  await assert.rejects(
    createDuplicateContentGateHandler(dependencies(collision))(adminRequest(duplicatePayload)),
    (error) => error.code === 'already-exists'
  );

  const malformed = createFakeDb(sourceSeed({}, {
    [PARENT_RANK_LOCK_FIELD]: { operationKey: 'other' }
  }));
  await assert.rejects(
    createDuplicateContentGateHandler(dependencies(malformed))(adminRequest(duplicatePayload)),
    (error) => error.code === 'failed-precondition'
  );
});

test('gate operations reject copy reservations and malformed stored Gate contracts', async () => {
  const invalidGateOverrides = [
    { schemaVersion: 2 },
    { order: -1 },
    { wordCount: '2' },
    { entryAssessmentPassRatio: 0 },
    { entryAssessmentPassRatio: 1.01 },
    { unlockConfig: { mode: 'automatic', initialStatus: 'locked' } },
    { [GATE_COPY_OPERATION_FIELD]: 'unfinished-copy' }
  ];
  for (const overrides of invalidGateOverrides) {
    const fake = createFakeDb(sourceSeed(overrides));
    await assert.rejects(
      createDuplicateContentGateHandler(dependencies(fake))(adminRequest(duplicatePayload)),
      (error) => error.code === 'failed-precondition'
    );
    assert.equal(fake.events.some((event) => event === 'bulkWriter'), false);
  }

  const sourceRankCopy = createFakeDb(sourceSeed({}, {
    [RANK_COPY_OPERATION_FIELD]: 'rank-copy-reservation'
  }));
  await assert.rejects(
    createDuplicateContentGateHandler(dependencies(sourceRankCopy))(
      adminRequest(duplicatePayload)
    ),
    (error) => error.code === 'failed-precondition'
  );

  const targetRankCopySeed = crossWorldSeed();
  targetRankCopySeed['content_worlds/world-two/ranks/rank-two'][RANK_COPY_OPERATION_FIELD] =
    'rank-copy-reservation';
  const targetRankCopy = createFakeDb(targetRankCopySeed);
  await assert.rejects(
    createMoveContentGateHandler(dependencies(targetRankCopy))(adminRequest(movePayload)),
    (error) => error.code === 'failed-precondition'
  );
});

test('legacy valid gates inherit a null ratio and move version increments fail before overflow', async () => {
  const legacySeed = sourceSeed();
  delete legacySeed['content_worlds/world-one/ranks/rank-one/gates/gate-one']
    .entryAssessmentPassRatio;
  const legacy = createFakeDb(legacySeed);
  const duplicate = await createDuplicateContentGateHandler(dependencies(legacy))(
    adminRequest({ ...duplicatePayload, operationId: 'duplicate-legacy-gate' })
  );
  const copied = legacy.get(
    `content_worlds/world-one/ranks/rank-one/gates/${duplicate.gateId}`
  );
  assert.equal(Object.hasOwn(copied, 'entryAssessmentPassRatio'), true);
  assert.equal(copied.entryAssessmentPassRatio, null);

  const overflowSeed = crossWorldSeed();
  overflowSeed['content_worlds/world-one/ranks/rank-one/gates/gate-one'].version = 10000000;
  const overflow = createFakeDb(overflowSeed);
  await assert.rejects(
    createMoveContentGateHandler(dependencies(overflow))(adminRequest({
      ...movePayload, expectedVersion: 10000000, operationId: 'move-overflow'
    })),
    (error) => error.code === 'failed-precondition'
  );
  assert.equal(overflow.events.some((event) => event === 'bulkWriter'), false);
});

test('archived exact-title deletion uses actual words and replays without double decrement', async () => {
  const fake = createFakeDb(sourceSeed({ status: 'archived', wordCount: 99 }));
  const handler = createDeleteContentGateHandler(dependencies(fake));
  const first = await handler(adminRequest(deletePayload));
  assert.equal(first.deleted, true);
  assert.deepEqual(first.affectedCounts, { gateCount: 1, wordCount: 2 });
  const sourceBase = 'content_worlds/world-one/ranks/rank-one/gates/gate-one';
  assert.equal(fake.get(sourceBase), null);
  assert.equal(fake.paths(`${sourceBase}/`).length, 0);
  const savedRank = fake.get('content_worlds/world-one/ranks/rank-one');
  const savedWorld = fake.get('content_worlds/world-one');
  assert.deepEqual(
    [savedRank.gateCount, savedRank.wordCount, savedWorld.gateCount, savedWorld.wordCount],
    [1, 2, 3, 6]
  );
  assert.equal(savedRank.version, 7);
  assert.equal(savedWorld.version, 9);
  assert.equal(WORLD_OPERATION_LOCK_FIELD in savedWorld, false);
  const replay = await handler(adminRequest(deletePayload));
  assert.deepEqual(replay, first);
  assert.equal(fake.get('content_worlds/world-one/ranks/rank-one').wordCount, 2);
  const operationKey = createOperationKey('admin-one', 'deleteContentGate', 'delete-gate-1');
  assert.equal(fake.get(`${AUDIT_COLLECTION}/${operationKey}`).action, 'delete');
});

test('delete requires archived status and the exact untrimmed title', async () => {
  const published = createFakeDb(sourceSeed());
  await assert.rejects(
    createDeleteContentGateHandler(dependencies(published))(adminRequest(deletePayload)),
    (error) => error.code === 'failed-precondition'
  );
  const archived = createFakeDb(sourceSeed({ status: 'archived' }));
  await assert.rejects(
    createDeleteContentGateHandler(dependencies(archived))(
      adminRequest({ ...deletePayload, confirmationTitle: ' Gate One ' })
    ),
    (error) => error.code === 'failed-precondition'
  );
});

test('world deletion locks and gate-operation locks interoperate fail closed', async () => {
  const activeDelete = createFakeDb(sourceSeed({}, {}, {
    [WORLD_DELETE_LOCK_FIELD]: {
      requestId: 'world-delete',
      requestedAt: new FakeTimestamp(NOW - 1)
    }
  }));
  await assert.rejects(
    createDuplicateContentGateHandler(dependencies(activeDelete))(
      adminRequest({ ...duplicatePayload, operationId: 'blocked-by-world-delete' })
    ),
    (error) => error.code === 'aborted'
  );

  const malformedDelete = createFakeDb(sourceSeed({}, {}, {
    [WORLD_DELETE_LOCK_FIELD]: { requestedAt: 'not-a-timestamp' }
  }));
  await assert.rejects(
    createDuplicateContentGateHandler(dependencies(malformedDelete))(
      adminRequest({ ...duplicatePayload, operationId: 'malformed-world-delete' })
    ),
    (error) => error.code === 'failed-precondition'
  );

  const expiredDelete = createFakeDb(sourceSeed({}, {}, {
    [WORLD_DELETE_LOCK_FIELD]: {
      requestId: 'expired-delete',
      requestedAt: new FakeTimestamp(NOW - OPERATION_LOCK_TTL_MS)
    }
  }));
  const expiredResult = await createDuplicateContentGateHandler(dependencies(expiredDelete))(
    adminRequest({ ...duplicatePayload, operationId: 'after-expired-world-delete' })
  );
  assert.equal(expiredResult.duplicated, true);

  const activeWorldOperation = {
    operationKey: 'another-operation',
    action: 'deleteContentGate',
    leaseAt: new FakeTimestamp(NOW - 1)
  };
  const sourceWorldBusy = createFakeDb(sourceSeed({}, {}, {
    [WORLD_OPERATION_LOCK_FIELD]: activeWorldOperation
  }));
  await assert.rejects(
    createDuplicateContentGateHandler(dependencies(sourceWorldBusy))(
      adminRequest({ ...duplicatePayload, operationId: 'blocked-by-gate-op' })
    ),
    (error) => error.code === 'aborted'
  );

  const targetWorldBusySeed = crossWorldSeed();
  targetWorldBusySeed['content_worlds/world-two'][WORLD_OPERATION_LOCK_FIELD] =
    activeWorldOperation;
  const targetWorldBusy = createFakeDb(targetWorldBusySeed);
  await assert.rejects(
    createMoveContentGateHandler(dependencies(targetWorldBusy))(
      adminRequest({ ...movePayload, operationId: 'target-world-busy' })
    ),
    (error) => error.code === 'aborted'
  );
  assert.equal(
    targetWorldBusy.get('content_worlds/world-two/ranks/rank-two/gates/gate-one'),
    null
  );
});

test('delete resumes after a non-atomic recursive failure without losing its actual count', async () => {
  const fake = createFakeDb(sourceSeed({ status: 'archived', wordCount: 500 }), {
    recursiveFailures: 1
  });
  const handler = createDeleteContentGateHandler(dependencies(fake));
  await assert.rejects(
    handler(adminRequest(deletePayload)),
    (error) => error.code === 'internal' && error.details.retryable === true
  );
  const operationKey = createOperationKey('admin-one', 'deleteContentGate', 'delete-gate-1');
  const failedReceipt = fake.get(`${CONTENT_OPERATIONS_COLLECTION}/${operationKey}`);
  assert.equal(failedReceipt.status, 'failed');
  assert.equal(failedReceipt.context.wordCount, 2);
  const lockedWorld = fake.get('content_worlds/world-one');
  const lockedRank = fake.get('content_worlds/world-one/ranks/rank-one');
  const lockedGate = fake.get('content_worlds/world-one/ranks/rank-one/gates/gate-one');
  for (const [record, field] of [
    [lockedWorld, WORLD_OPERATION_LOCK_FIELD],
    [lockedRank, PARENT_RANK_LOCK_FIELD],
    [lockedGate, GATE_OPERATION_LOCK_FIELD]
  ]) {
    assert.equal(record[field].operationKey, operationKey);
    assert.equal(record[field].leaseAt.toMillis(), NOW);
  }
  await assert.rejects(
    createDuplicateContentGateHandler(dependencies(fake))(adminRequest({
      ...duplicatePayload, operationId: 'new-op-while-delete-failed'
    })),
    (error) => error.code === 'aborted'
  );
  const result = await handler(adminRequest(deletePayload));
  assert.equal(result.deleted, true);
  assert.equal(fake.get('content_worlds/world-one/ranks/rank-one').wordCount, 2);
});

function crossWorldSeed() {
  return {
    ...sourceSeed({}, { gateCount: 2, wordCount: 4 }, { gateCount: 4, wordCount: 8 }),
    'content_worlds/world-two': world('world-two', {
      version: 21, gateCount: 1, wordCount: 1
    }),
    'content_worlds/world-two/ranks/rank-two': rank('world-two', 'rank-two', {
      version: 31, gateCount: 1, wordCount: 1
    })
  };
}

test('cross-world move preserves content/status and adjusts every counter exactly once', async () => {
  const fake = createFakeDb(crossWorldSeed());
  const handler = createMoveContentGateHandler(dependencies(fake));
  const first = await handler(adminRequest(movePayload));
  assert.equal(first.moved, true);
  assert.deepEqual(first.affectedCounts, { gateCount: 1, wordCount: 2 });
  const sourceBase = 'content_worlds/world-one/ranks/rank-one/gates/gate-one';
  const targetBase = 'content_worlds/world-two/ranks/rank-two/gates/gate-one';
  assert.equal(fake.get(sourceBase), null);
  const movedGate = fake.get(targetBase);
  assert.equal(movedGate.status, 'published');
  assert.equal(movedGate.version, 6);
  assert.equal(movedGate.entryAssessmentPassRatio, 0.8);
  assert.equal(movedGate.worldId, 'world-two');
  assert.equal(movedGate.rankId, 'rank-two');
  assert.equal(GATE_COPY_OPERATION_FIELD in movedGate, false);
  assert.equal(fake.get(`${targetBase}/words/sword`).status, 'published');
  assert.equal(fake.get(`${targetBase}/words/shield`).status, 'archived');
  assert.equal(fake.get(`${targetBase}/words/sword`).worldId, 'world-two');
  assert.deepEqual(
    [
      fake.get('content_worlds/world-one/ranks/rank-one').gateCount,
      fake.get('content_worlds/world-one/ranks/rank-one').wordCount,
      fake.get('content_worlds/world-two/ranks/rank-two').gateCount,
      fake.get('content_worlds/world-two/ranks/rank-two').wordCount,
      fake.get('content_worlds/world-one').gateCount,
      fake.get('content_worlds/world-one').wordCount,
      fake.get('content_worlds/world-two').gateCount,
      fake.get('content_worlds/world-two').wordCount
    ],
    [1, 2, 2, 3, 3, 6, 2, 3]
  );
  assert.equal(fake.get('content_worlds/world-one/ranks/rank-one').version, 7);
  assert.equal(fake.get('content_worlds/world-two/ranks/rank-two').version, 31);
  assert.equal(fake.get('content_worlds/world-one').version, 9);
  assert.equal(fake.get('content_worlds/world-two').version, 21);
  assert.equal(
    WORLD_OPERATION_LOCK_FIELD in fake.get('content_worlds/world-one'),
    false
  );
  assert.equal(
    WORLD_OPERATION_LOCK_FIELD in fake.get('content_worlds/world-two'),
    false
  );
  const replay = await handler(adminRequest(movePayload));
  assert.deepEqual(replay, first);
  await assert.rejects(
    handler(adminRequest({ ...movePayload, confirmationTitle: 'Gate One ' })),
    (error) => error.code === 'already-exists'
  );
  const operationKey = createOperationKey('admin-one', 'moveContentGate', 'move-gate-1');
  assert.equal(fake.get(`${AUDIT_COLLECTION}/${operationKey}`).action, 'move');
});

test('move requires the exact source title before reserving the target', async () => {
  const fake = createFakeDb(crossWorldSeed());
  await assert.rejects(
    createMoveContentGateHandler(dependencies(fake))(adminRequest({
      ...movePayload,
      confirmationTitle: 'Gate One ',
      operationId: 'move-wrong-title'
    })),
    (error) => error.code === 'failed-precondition'
  );
  assert.equal(
    fake.get('content_worlds/world-two/ranks/rank-two/gates/gate-one'),
    null
  );
  assert.equal(fake.events.some((event) => event === 'bulkWriter'), false);
});

test('same-world move changes rank counters but leaves world totals unchanged', async () => {
  const seed = sourceSeed();
  seed['content_worlds/world-one/ranks/rank-two'] = rank('world-one', 'rank-two', {
    gateCount: 1, wordCount: 1, version: 20
  });
  const fake = createFakeDb(seed);
  const handler = createMoveContentGateHandler(dependencies(fake));
  const payload = {
    ...movePayload,
    targetWorldId: 'world-one',
    targetRankId: 'rank-two',
    operationId: 'move-same-world-1'
  };
  await handler(adminRequest(payload));
  assert.deepEqual(
    [
      fake.get('content_worlds/world-one/ranks/rank-one').gateCount,
      fake.get('content_worlds/world-one/ranks/rank-one').wordCount,
      fake.get('content_worlds/world-one/ranks/rank-two').gateCount,
      fake.get('content_worlds/world-one/ranks/rank-two').wordCount,
      fake.get('content_worlds/world-one').gateCount,
      fake.get('content_worlds/world-one').wordCount
    ],
    [1, 2, 2, 3, 4, 8]
  );
  assert.equal(fake.get('content_worlds/world-one').version, 9);
});

test('move rejects a target collision before copying or changing counters', async () => {
  const seed = crossWorldSeed();
  seed['content_worlds/world-two/ranks/rank-two/gates/gate-one'] = gate(
    'world-two', 'rank-two', 'gate-one'
  );
  const fake = createFakeDb(seed);
  await assert.rejects(
    createMoveContentGateHandler(dependencies(fake))(adminRequest(movePayload)),
    (error) => error.code === 'already-exists'
  );
  assert.equal(fake.get('content_worlds/world-one/ranks/rank-one').gateCount, 2);
  assert.equal(fake.get('content_worlds/world-two/ranks/rank-two').gateCount, 1);
  assert.equal(fake.events.some((event) => event === 'bulkWriter'), false);
});

test('move retries a failed copy deterministically and removes stale partial target words', async () => {
  const fake = createFakeDb(crossWorldSeed(), { bulkFailures: 1 });
  const handler = createMoveContentGateHandler(dependencies(fake));
  await assert.rejects(
    handler(adminRequest(movePayload)),
    (error) => error.code === 'internal' && error.details.retryable === true
  );
  const operationKey = createOperationKey('admin-one', 'moveContentGate', 'move-gate-1');
  for (const worldPath of ['content_worlds/world-one', 'content_worlds/world-two']) {
    const lock = fake.get(worldPath)[WORLD_OPERATION_LOCK_FIELD];
    assert.equal(lock.operationKey, operationKey);
    assert.equal(lock.leaseAt.toMillis(), NOW);
  }
  await assert.rejects(
    handler(adminRequest({ ...movePayload, operationId: 'different-move-after-failure' })),
    (error) => error.code === 'aborted'
  );
  const targetBase = 'content_worlds/world-two/ranks/rank-two/gates/gate-one';
  fake.db.store.set(`${targetBase}/words/stale`, word(
    'world-two', 'rank-two', 'gate-one', 'stale'
  ));
  const result = await handler(adminRequest(movePayload));
  assert.equal(result.moved, true);
  assert.equal(fake.get(`${targetBase}/words/stale`), null);
  assert.equal(fake.get(`${targetBase}/words/sword`).contentWordId, 'sword');
  assert.equal(fake.get(`${targetBase}/words/shield`).contentWordId, 'shield');
});
