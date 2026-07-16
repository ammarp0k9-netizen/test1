'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DELETE_LOCK_FIELD,
  DELETE_LOCK_TTL_MS,
  WORLD_OPERATION_LOCK_FIELD,
  DeleteWorldPayloadError,
  createDeleteContentWorldHandler,
  getCachedCounts,
  getWorldOperationLockState,
  isDeleteLockActive,
  validateDeleteWorldPayload
} = require('../delete-content-world');

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'HttpsError';
    this.code = code;
    this.details = details;
  }
}

const SERVER_TIMESTAMP = Object.freeze({ type: 'server-timestamp' });
const DELETE_FIELD = Object.freeze({ type: 'delete-field' });

const FakeFieldValue = {
  serverTimestamp() {
    return SERVER_TIMESTAMP;
  },
  delete() {
    return DELETE_FIELD;
  }
};

function cloneWorld(world) {
  if (!world) return null;
  return { ...world };
}

function createFakeDb(initialWorld, options = {}) {
  let world = cloneWorld(initialWorld);
  let auditEntry = null;
  const events = [];

  const worldRef = { kind: 'world', id: initialWorld?.worldId || 'world-one' };
  const auditRef = {
    kind: 'audit',
    async set(entry) {
      events.push('audit');
      if (options.auditError) throw options.auditError;
      auditEntry = entry;
    }
  };

  const db = {
    collection(name) {
      if (name === 'content_worlds') {
        return {
          doc(id) {
            worldRef.id = id;
            return worldRef;
          }
        };
      }
      if (name === 'admin_audit_logs') {
        return { doc: () => auditRef };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
    async runTransaction(callback) {
      events.push('transaction');
      const transaction = {
        async get(ref) {
          assert.equal(ref, worldRef);
          return {
            exists: world !== null,
            data: () => cloneWorld(world)
          };
        },
        update(ref, update) {
          assert.equal(ref, worldRef);
          events.push(update[DELETE_LOCK_FIELD] === DELETE_FIELD ? 'unlock' : 'lock');
          for (const [field, value] of Object.entries(update)) {
            if (value === DELETE_FIELD) delete world[field];
            else world[field] = value;
          }
        }
      };
      return callback(transaction);
    },
    async recursiveDelete(ref) {
      assert.equal(ref, worldRef);
      events.push('recursive-delete');
      assert.ok(world[DELETE_LOCK_FIELD], 'the transaction must lock before recursiveDelete');
      if (options.recursiveDeleteError) throw options.recursiveDeleteError;
      world = null;
    }
  };

  return {
    db,
    events,
    getAuditEntry: () => auditEntry,
    getWorld: () => cloneWorld(world)
  };
}

function archivedWorld(overrides = {}) {
  return {
    worldId: 'world-one',
    title: 'World One',
    status: 'archived',
    schemaVersion: 1,
    version: 4,
    order: 2,
    updatedBy: 'previous-admin',
    rankCount: 3,
    gateCount: 12,
    wordCount: 340,
    ...overrides
  };
}

function createHandler(fake, overrides = {}) {
  return createDeleteContentWorldHandler({
    db: fake.db,
    FieldValue: FakeFieldValue,
    HttpsError: FakeHttpsError,
    makeRequestId: () => 'request-123',
    now: () => 2_000_000,
    logger: { error() {} },
    ...overrides
  });
}

function adminRequest(data = { worldId: 'world-one', confirmationTitle: 'World One' }) {
  return {
    auth: { uid: 'admin-uid', token: { admin: true } },
    data
  };
}

test('payload validation preserves exact confirmation text and rejects extra input', () => {
  assert.deepEqual(
    validateDeleteWorldPayload({ worldId: 'world_01', confirmationTitle: 'Exact title' }),
    { worldId: 'world_01', confirmationTitle: 'Exact title' }
  );
  assert.equal(
    validateDeleteWorldPayload({ worldId: 'world_01', confirmationTitle: ' Exact title ' })
      .confirmationTitle,
    ' Exact title '
  );
  assert.deepEqual(
    validateDeleteWorldPayload({
      worldId: 'world_01',
      confirmationTitle: 'Exact title',
      expectedVersion: 7
    }),
    { worldId: 'world_01', confirmationTitle: 'Exact title', expectedVersion: 7 }
  );

  for (const invalid of [
    null,
    [],
    { worldId: 'world/one', confirmationTitle: 'Title' },
    { worldId: ' world', confirmationTitle: 'Title' },
    { worldId: 'world', confirmationTitle: '' },
    { worldId: 'world', confirmationTitle: 'x'.repeat(161) },
    { worldId: 'world', confirmationTitle: 'Title', expectedVersion: 0 },
    { worldId: 'world', confirmationTitle: 'Title', expectedVersion: 1.5 },
    { worldId: 'world', confirmationTitle: 'Title', expectedVersion: '1' },
    { worldId: 'world', confirmationTitle: 'Title', token: 'must-not-be-accepted' }
  ]) {
    assert.throws(() => validateDeleteWorldPayload(invalid), DeleteWorldPayloadError);
  }
});

test('cached counts fail closed to zero for invalid or unbounded values', () => {
  assert.deepEqual(getCachedCounts({ rankCount: 2, gateCount: -1, wordCount: 10_000_001 }), {
    rankCount: 2,
    gateCount: 0,
    wordCount: 0
  });
});

test('delete locks expire only after the callable timeout safety margin', () => {
  const fresh = { requestedAt: { toMillis: () => 1_999_999 } };
  const stale = { requestedAt: { toMillis: () => 2_000_000 - DELETE_LOCK_TTL_MS } };
  assert.equal(isDeleteLockActive(fresh, 2_000_000), true);
  assert.equal(isDeleteLockActive(stale, 2_000_000), false);
  assert.equal(isDeleteLockActive({ requestedAt: 'untrusted' }, 2_000_000), true);
  assert.equal(isDeleteLockActive(null, 2_000_000), false);
});

test('gate-operation world locks share the timeout and malformed locks fail closed', () => {
  const active = {
    operationKey: 'gate-operation',
    action: 'moveContentGate',
    leaseAt: { toMillis: () => 1_999_999 }
  };
  const expired = {
    ...active,
    leaseAt: { toMillis: () => 2_000_000 - DELETE_LOCK_TTL_MS }
  };
  assert.equal(getWorldOperationLockState(undefined, 2_000_000), 'none');
  assert.equal(getWorldOperationLockState(active, 2_000_000), 'active');
  assert.equal(getWorldOperationLockState(expired, 2_000_000), 'expired');
  assert.equal(getWorldOperationLockState({ operationKey: 'missing-fields' }, 2_000_000), 'malformed');
});

test('authentication and the strict admin claim are required before database access', async () => {
  const fake = createFakeDb(archivedWorld());
  const handler = createHandler(fake);

  await assert.rejects(() => handler({ data: {} }), { code: 'unauthenticated' });
  await assert.rejects(
    () => handler({ auth: { uid: 'user', token: { admin: 'true' } }, data: {} }),
    { code: 'permission-denied' }
  );
  assert.deepEqual(fake.events, []);
});

test('invalid payload, missing world, non-archived world, and title mismatch fail before deletion', async () => {
  const invalidFake = createFakeDb(archivedWorld());
  await assert.rejects(
    () => createHandler(invalidFake)(adminRequest({ worldId: 'bad/id', confirmationTitle: 'World One' })),
    { code: 'invalid-argument' }
  );
  assert.deepEqual(invalidFake.events, []);

  const missingFake = createFakeDb(null);
  await assert.rejects(() => createHandler(missingFake)(adminRequest()), { code: 'not-found' });

  const draftFake = createFakeDb(archivedWorld({ status: 'draft' }));
  await assert.rejects(() => createHandler(draftFake)(adminRequest()), {
    code: 'failed-precondition'
  });

  const mismatchFake = createFakeDb(archivedWorld());
  await assert.rejects(
    () => createHandler(mismatchFake)(adminRequest({
      worldId: 'world-one',
      confirmationTitle: 'World One '
    })),
    { code: 'failed-precondition' }
  );

  for (const fake of [missingFake, draftFake, mismatchFake]) {
    assert.equal(fake.events.includes('recursive-delete'), false);
    assert.equal(fake.events.includes('audit'), false);
  }
});

test('expectedVersion rejects a stale confirmation inside the transaction before locking', async () => {
  const fake = createFakeDb(archivedWorld({ version: 8 }));
  await assert.rejects(
    () => createHandler(fake)(adminRequest({
      worldId: 'world-one',
      confirmationTitle: 'World One',
      expectedVersion: 7
    })),
    (error) => {
      assert.equal(error.code, 'aborted');
      assert.deepEqual(error.details, { expectedVersion: 7, actualVersion: 8 });
      return true;
    }
  );
  assert.deepEqual(fake.events, ['transaction']);
});

test('an active lock rejects a concurrent delete and an expired lock can be replaced', async () => {
  const activeFake = createFakeDb(archivedWorld({
    [DELETE_LOCK_FIELD]: { requestedAt: { toMillis: () => 1_999_999 } }
  }));
  await assert.rejects(() => createHandler(activeFake)(adminRequest()), { code: 'aborted' });
  assert.equal(activeFake.events.includes('recursive-delete'), false);

  const staleFake = createFakeDb(archivedWorld({
    [DELETE_LOCK_FIELD]: {
      requestId: 'expired',
      requestedAt: { toMillis: () => 2_000_000 - DELETE_LOCK_TTL_MS }
    }
  }));
  const result = await createHandler(staleFake)(adminRequest());
  assert.equal(result.deleted, true);
});

test('world deletion cannot race active or malformed Gate operations but may supersede expiry', async () => {
  const activeLock = {
    operationKey: 'gate-operation',
    action: 'duplicateContentGate',
    leaseAt: { toMillis: () => 1_999_999 }
  };
  const activeFake = createFakeDb(archivedWorld({
    [WORLD_OPERATION_LOCK_FIELD]: activeLock
  }));
  await assert.rejects(
    () => createHandler(activeFake)(adminRequest()),
    (error) => error.code === 'aborted'
  );
  assert.equal(activeFake.events.includes('recursive-delete'), false);

  const malformedFake = createFakeDb(archivedWorld({
    [WORLD_OPERATION_LOCK_FIELD]: { operationKey: 'broken' }
  }));
  await assert.rejects(
    () => createHandler(malformedFake)(adminRequest()),
    (error) => error.code === 'failed-precondition'
  );
  assert.equal(malformedFake.events.includes('recursive-delete'), false);

  const expiredFake = createFakeDb(archivedWorld({
    [WORLD_OPERATION_LOCK_FIELD]: {
      ...activeLock,
      leaseAt: { toMillis: () => 2_000_000 - DELETE_LOCK_TTL_MS }
    }
  }));
  const result = await createHandler(expiredFake)(adminRequest());
  assert.equal(result.deleted, true);
});

test('successful deletion locks, recursively deletes, audits, then returns cached counts', async () => {
  const fake = createFakeDb(archivedWorld({
    description: 'x'.repeat(100_000),
    secretToken: 'must-never-enter-the-audit'
  }));
  const handler = createHandler(fake);
  const result = await handler(adminRequest());

  assert.deepEqual(fake.events, ['transaction', 'lock', 'recursive-delete', 'audit']);
  assert.deepEqual(result, {
    deleted: true,
    worldId: 'world-one',
    affectedCounts: { rankCount: 3, gateCount: 12, wordCount: 340 }
  });

  const audit = fake.getAuditEntry();
  assert.equal(audit.createdAt, SERVER_TIMESTAMP);
  assert.equal(audit.action, 'delete');
  assert.equal(audit.entityType, 'world');
  assert.equal(audit.entityId, 'world-one');
  assert.equal(audit.worldId, 'world-one');
  assert.equal(audit.adminUid, 'admin-uid');
  assert.equal(audit.requestId, 'request-123');
  assert.match(audit.summary, /3 ranks, 12 gates, 340 words/);
  assert.deepEqual(audit.affectedCounts, result.affectedCounts);
  assert.equal(audit.before.title, 'World One');
  assert.equal(Object.hasOwn(audit.before, 'description'), false);
  assert.equal(JSON.stringify(audit).includes('must-never-enter-the-audit'), false);
  assert.ok(JSON.stringify(audit).length < 2000, 'audit entry stays compact');
});

test('recursive deletion failure releases its owned lock and never writes an audit', async () => {
  const fake = createFakeDb(archivedWorld(), {
    recursiveDeleteError: new Error('bulk writer failed')
  });
  await assert.rejects(() => createHandler(fake)(adminRequest()), { code: 'internal' });

  assert.deepEqual(fake.events, [
    'transaction',
    'lock',
    'recursive-delete',
    'transaction',
    'unlock'
  ]);
  assert.equal(Object.hasOwn(fake.getWorld(), DELETE_LOCK_FIELD), false);
  assert.equal(fake.getAuditEntry(), null);
});

test('audit failure occurs after recursive deletion and never returns deleted true', async () => {
  const fake = createFakeDb(archivedWorld(), { auditError: new Error('audit unavailable') });
  await assert.rejects(() => createHandler(fake)(adminRequest()), { code: 'internal' });
  assert.deepEqual(fake.events, ['transaction', 'lock', 'recursive-delete', 'audit']);
  assert.equal(fake.getWorld(), null);
});

test('Functions entrypoint uses v2 onCall and initializes the Admin app once', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(source, /firebase-functions\/v2\/https/);
  assert.match(source, /getApps\(\)\[0\] \|\| initializeApp\(\)/);
  assert.match(source, /exports\.deleteContentWorld\s*=\s*onCall/);
  assert.match(source, /timeoutSeconds:\s*540/);
});
