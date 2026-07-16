import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const rawSource = readFileSync(new URL('../js/admin-cloud.js', import.meta.url), 'utf8');
const source = rawSource.replace(
  /import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];\s*/g,
  ''
);

const auth = { currentUser: null };
const db = Object.freeze({ kind: 'db' });
const store = new Map();
const callableRequests = [];
const microtasks = [];
const serverTime = Object.freeze({ __serverTimestamp: true });
let generatedGateId = 0;
let transactionBarrier = null;
let callableBarrier = null;
let failNextCallable = '';
let conflictNextCallable = '';

function collection(parent, name) {
  const path = parent?.path ? `${parent.path}/${name}` : name;
  return { kind: 'collection', path };
}

function doc(parent, id) {
  const documentId = id || `generated-gate-${++generatedGateId}`;
  return { kind: 'document', id: documentId, path: `${parent.path}/${documentId}` };
}

function snapshotFor(reference) {
  const value = store.get(reference.path);
  return {
    id: reference.id,
    exists: () => value !== undefined,
    data: () => value === undefined ? undefined : { ...value },
  };
}

async function runTransaction(_db, callback) {
  const writes = [];
  const result = await callback({
    get: async (reference) => snapshotFor(reference),
    set(reference, value) {
      writes.push({ type: 'set', reference, value: { ...value } });
    },
    update(reference, value) {
      writes.push({ type: 'update', reference, value: { ...value } });
    },
  });
  const barrier = transactionBarrier;
  if (barrier) await barrier;
  for (const write of writes) {
    if (write.type === 'set') {
      store.set(write.reference.path, write.value);
    } else {
      store.set(write.reference.path, {
        ...(store.get(write.reference.path) || {}),
        ...write.value,
      });
    }
  }
  return result;
}

function getDocs(reference) {
  const prefix = `${reference.path}/`;
  const docs = [];
  for (const path of store.keys()) {
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
    docs.push(snapshotFor({ id: path.slice(prefix.length), path }));
  }
  return Promise.resolve({ docs });
}

function httpsCallable(_functions, name) {
  return async (payload) => {
    callableRequests.push({ name, payload: JSON.parse(JSON.stringify(payload)) });
    const barrier = callableBarrier;
    if (barrier) await barrier;
    if (failNextCallable === name) {
      failNextCallable = '';
      const error = new Error('temporary callable failure');
      error.code = 'functions/unavailable';
      throw error;
    }
    if (conflictNextCallable === name) {
      conflictNextCallable = '';
      const error = new Error('stale gate version');
      error.code = 'functions/aborted';
      error.details = {
        reason: 'version-conflict',
        expectedVersion: 2,
        actualVersion: 3,
      };
      throw error;
    }
    if (name === 'duplicateContentGate') {
      return { data: { duplicated: true, sourceGateId: payload.gateId } };
    }
    if (name === 'moveContentGate') {
      return {
        data: {
          moved: true,
          gateId: payload.gateId,
          targetWorldId: payload.targetWorldId,
          targetRankId: payload.targetRankId,
        },
      };
    }
    if (name === 'deleteContentGate') {
      return { data: { deleted: true, gateId: payload.gateId } };
    }
    if (name === 'duplicateContentRank') {
      return { data: { duplicated: true, sourceRankId: payload.rankId } };
    }
    if (name === 'deleteContentRank') {
      return { data: { deleted: true, rankId: payload.rankId } };
    }
    return { data: { deleted: true, worldId: payload.worldId } };
  };
}

const listeners = new Map();
const storageValues = new Map();
const windowObject = {
  localStorage: {
    getItem(key) {
      return storageValues.has(key) ? storageValues.get(key) : null;
    },
    setItem(key, value) {
      storageValues.set(key, String(value));
    },
    removeItem(key) {
      storageValues.delete(key);
    },
  },
  addEventListener(type, handler) {
    const handlers = listeners.get(type) || [];
    handlers.push(handler);
    listeners.set(type, handlers);
  },
  dispatchEvent(event) {
    for (const handler of listeners.get(event.type) || []) handler(event);
    return true;
  },
};

const operationStorageKey = 'lootlingua_content_operation_resume_v1';
function persistedOperationEntries() {
  const raw = storageValues.get(operationStorageKey);
  return raw ? JSON.parse(raw).entries : [];
}

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

const dependencies = {
  getApps: () => [{}],
  getAuth: () => auth,
  collection,
  doc,
  getDoc: async (reference) => snapshotFor(reference),
  getDocs,
  getFirestore: () => db,
  orderBy: () => ({}),
  query: (reference) => reference,
  runTransaction,
  serverTimestamp: () => serverTime,
  getFunctions: () => ({}),
  httpsCallable,
};

const context = vm.createContext({
  __deps: dependencies,
  window: windowObject,
  CustomEvent: TestCustomEvent,
  queueMicrotask(callback) {
    microtasks.push(callback);
  },
  console,
});
const dependencyNames = Object.keys(dependencies).join(', ');
new vm.Script(`const { ${dependencyNames} } = __deps;\n${source}`, {
  filename: 'admin-cloud-gate.behavior.js',
}).runInContext(context);

const schemaSource = readFileSync(new URL('../js/content-schema.js', import.meta.url), 'utf8');
new vm.Script(schemaSource, { filename: 'content-schema-gate.behavior.js' }).runInContext(context);

function firebaseUser(uid, isAdmin) {
  return {
    uid,
    getIdTokenResult: async () => ({ claims: { admin: isAdmin } }),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function realmObject(value) {
  return vm.runInContext(`(${JSON.stringify(value)})`, context);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoUndefined(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    assert.notEqual(value[key], undefined, `undefined at ${path}.${key}`);
    assertNoUndefined(value[key], `${path}.${key}`);
  }
}

auth.currentUser = firebaseUser('gate-admin', true);
await windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
const api = windowObject.LootLinguaAdminCloud;
const worldPath = 'content_worlds/world_1';
const rankPath = `${worldPath}/ranks/rank_1`;
store.set(worldPath, {
  schemaVersion: 1,
  worldId: 'world_1',
  slug: 'world-one',
  title: 'World One',
  status: 'draft',
  version: 11,
  rankCount: 3,
  gateCount: 4,
  wordCount: 90,
  order: 1,
  createdAt: serverTime,
  updatedAt: serverTime,
  createdBy: 'first-admin',
  updatedBy: 'first-admin',
});
store.set(rankPath, {
  schemaVersion: 1,
  worldId: 'world_1',
  rankId: 'rank_1',
  title: 'Rank One',
  status: 'draft',
  version: 7,
  gateCount: 2,
  wordCount: 40,
  order: 1,
  createdAt: serverTime,
  updatedAt: serverTime,
  createdBy: 'first-admin',
  updatedBy: 'first-admin',
});

const transactionWait = deferred();
transactionBarrier = transactionWait.promise;
let createSettled = false;
const createPromise = api.createGate('world_1', 'rank_1', realmObject({
  worldId: 'forged_world',
  rankId: 'forged_rank',
  gateId: 'forged_gate',
  title: 'Gate Five',
  order: 5,
  status: 'draft',
  version: 500,
  wordCount: 500,
  entryAssessmentPassRatio: null,
  createdBy: 'forged-admin',
})).then((value) => {
  createSettled = true;
  return value;
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(createSettled, false, 'createGate resolved before its transaction committed.');
transactionWait.resolve();
const created = await createPromise;
transactionBarrier = null;

assert.equal(created.gateId, 'generated-gate-1');
assert.equal(created.worldId, 'world_1');
assert.equal(created.rankId, 'rank_1');
assert.equal(created.version, 1);
assert.equal(created.wordCount, 0);
assert.equal(created.entryAssessmentPassRatio, null);
assert.equal(created.createdBy, 'gate-admin');
assert.equal(created.createdAt, serverTime);
assert.equal(
  windowObject.LootLinguaContentSchema.resolveEntryAssessmentPassRatio(created),
  0.75
);

const worldAfterCreate = store.get(worldPath);
const rankAfterCreate = store.get(rankPath);
assert.equal(worldAfterCreate.gateCount, 5);
assert.equal(worldAfterCreate.version, 11);
assert.equal(worldAfterCreate.rankCount, 3);
assert.equal(worldAfterCreate.wordCount, 90);
assert.equal(rankAfterCreate.gateCount, 3);
assert.equal(rankAfterCreate.version, 7);
assert.equal(rankAfterCreate.wordCount, 40);
assert.equal(worldAfterCreate.updatedBy, 'gate-admin');
assert.equal(rankAfterCreate.updatedBy, 'gate-admin');

const createdPath = `${rankPath}/gates/${created.gateId}`;
assertNoUndefined(store.get(createdPath));
store.set(`${rankPath}/gates/gate-first`, {
  ...store.get(createdPath),
  gateId: 'gate-first',
  title: 'First Gate',
  order: 1,
});
const listed = await api.listGates('world_1', 'rank_1');
assert.deepEqual(Array.from(listed, (gate) => gate.gateId), ['gate-first', created.gateId]);
assert.equal((await api.getGate('world_1', 'rank_1', created.gateId)).title, 'Gate Five');

const originalCreatedAt = store.get(createdPath).createdAt;
store.set(createdPath, { ...store.get(createdPath), wordCount: 12 });
const updated = await api.updateGate('world_1', 'rank_1', created.gateId, realmObject({
  title: 'Updated Gate',
  entryAssessmentPassRatio: 0.8,
  version: 999,
  wordCount: 0,
  createdAt: '2000-01-01T00:00:00.000Z',
  createdBy: 'forged-admin',
}), 1);
assert.equal(updated.title, 'Updated Gate');
assert.equal(updated.version, 2);
assert.equal(updated.wordCount, 12);
assert.equal(updated.entryAssessmentPassRatio, 0.8);
assert.equal(updated.createdAt, originalCreatedAt);
assert.equal(updated.createdBy, 'gate-admin');
assert.equal(windowObject.LootLinguaContentSchema.resolveEntryAssessmentPassRatio(updated), 0.8);

await assert.rejects(
  () => api.updateGate('world_1', 'rank_1', created.gateId, realmObject({
    entryAssessmentPassRatio: 0,
  }), 2),
  (error) => error?.code === 'admin/validation-failed'
);
assert.equal(store.get(createdPath).entryAssessmentPassRatio, 0.8);

await assert.rejects(
  () => api.updateGate('world_1', 'rank_1', created.gateId, realmObject({ title: 'Stale' }), 1),
  (error) => error?.code === 'admin/version-conflict'
);
assert.equal(store.get(createdPath).title, 'Updated Gate');

const archived = await api.setGateStatus('world_1', 'rank_1', created.gateId, 'archived', 2);
assert.equal(archived.status, 'archived');
assert.equal(archived.version, 3);

conflictNextCallable = 'duplicateContentGate';
await assert.rejects(
  () => api.duplicateGateAsDraft(
    'world_1',
    'rank_1',
    created.gateId,
    2,
    realmObject({ operationId: 'stale_gate_duplicate' })
  ),
  (error) => error?.code === 'admin/version-conflict' && error?.details?.actualVersion === 3
);

const duplicateWait = deferred();
callableBarrier = duplicateWait.promise;
let duplicateSettled = false;
const duplicatePromise = api.duplicateGateAsDraft(
  'world_1',
  'rank_1',
  created.gateId,
  3,
  realmObject({ operationId: 'duplicate_gate_1' })
).then((value) => {
  duplicateSettled = true;
  return value;
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(duplicateSettled, false, 'duplicateGateAsDraft resolved before its callable.');
duplicateWait.resolve();
assert.deepEqual(plain(await duplicatePromise), {
  duplicated: true,
  sourceGateId: created.gateId,
});
callableBarrier = null;
assert.deepEqual(callableRequests.at(-1), {
  name: 'duplicateContentGate',
  payload: {
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: created.gateId,
    expectedVersion: 3,
    operationId: 'duplicate_gate_1',
  },
});

failNextCallable = 'duplicateContentGate';
await assert.rejects(
  () => api.duplicateGateAsDraft('world_1', 'rank_1', created.gateId, 3),
  (error) => error?.code === 'admin/unavailable'
);
const generatedOperationId = callableRequests.at(-1).payload.operationId;
assert.ok(
  persistedOperationEntries().some((entry) => entry.operationId === generatedOperationId),
  'An ambiguous failed callable must persist its generated idempotency key.'
);
await api.duplicateGateAsDraft('world_1', 'rank_1', created.gateId, 3);
assert.equal(callableRequests.at(-1).payload.operationId, generatedOperationId);
assert.ok(
  persistedOperationEntries().every((entry) => entry.operationId !== generatedOperationId),
  'A successful retry must remove its persisted idempotency key.'
);
await api.duplicateGateAsDraft('world_1', 'rank_1', created.gateId, 3);
assert.notEqual(callableRequests.at(-1).payload.operationId, generatedOperationId);

const moved = await api.moveGate(
  'world_1',
  'rank_1',
  created.gateId,
  realmObject({ worldId: 'world_2', rankId: 'rank_2' }),
  3,
  realmObject({
    operationId: 'move_gate_1',
    confirmationTitle: 'Updated Gate'
  })
);
assert.equal(moved.moved, true);
assert.deepEqual(callableRequests.at(-1), {
  name: 'moveContentGate',
  payload: {
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: created.gateId,
    targetWorldId: 'world_2',
    targetRankId: 'rank_2',
    confirmationTitle: 'Updated Gate',
    expectedVersion: 3,
    operationId: 'move_gate_1',
  },
});

const beforeNoopMove = callableRequests.length;
await assert.rejects(
  () => api.moveGate(
    'world_1',
    'rank_1',
    created.gateId,
    realmObject({ worldId: 'world_1', rankId: 'rank_1' }),
    3
  ),
  (error) => error?.code === 'admin/invalid-argument'
);
assert.equal(callableRequests.length, beforeNoopMove);

await assert.rejects(
  () => api.moveGate(
    'world_1',
    'rank_1',
    created.gateId,
    realmObject({ worldId: 'world_2', rankId: 'rank_2' }),
    3
  ),
  (error) => error?.code === 'admin/invalid-argument'
);
assert.equal(callableRequests.length, beforeNoopMove, 'An unconfirmed move reached the callable.');

const accountWait = deferred();
callableBarrier = accountWait.promise;
const accountChangedMove = api.moveGate(
  'world_1',
  'rank_1',
  created.gateId,
  realmObject({ worldId: 'world_3', rankId: 'rank_3' }),
  3,
  realmObject({ confirmationTitle: 'Updated Gate' })
);
await new Promise((resolve) => setTimeout(resolve, 0));
const ambiguousOperationId = callableRequests.at(-1).payload.operationId;
auth.currentUser = firebaseUser('another-admin', true);
accountWait.resolve();
await assert.rejects(accountChangedMove, (error) => error?.code === 'admin/account-changed');
callableBarrier = null;
assert.ok(
  persistedOperationEntries().some((entry) => entry.operationId === ambiguousOperationId),
  'An account-change ambiguity must remain recoverable after a reload.'
);

auth.currentUser = firebaseUser('gate-admin', true);
await windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
vm.runInContext('pendingOperationIds.clear()', context);
await api.moveGate(
  'world_1',
  'rank_1',
  created.gateId,
  realmObject({ worldId: 'world_3', rankId: 'rank_3' }),
  3,
  realmObject({ confirmationTitle: 'Updated Gate' })
);
assert.equal(
  callableRequests.at(-1).payload.operationId,
  ambiguousOperationId,
  'An account-change ambiguity must retain the generated idempotency key.'
);
assert.ok(
  persistedOperationEntries().every((entry) => entry.operationId !== ambiguousOperationId),
  'A resumed operation must clear durable state after success.'
);

const deleted = await api.requestDeleteGate('world_1', 'rank_1', created.gateId, realmObject({
  confirmationTitle: 'Updated Gate',
  expectedVersion: 3,
  operationId: 'delete_gate_1',
}));
assert.equal(deleted.deleted, true);
assert.deepEqual(callableRequests.at(-1), {
  name: 'deleteContentGate',
  payload: {
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: created.gateId,
    confirmationTitle: 'Updated Gate',
    expectedVersion: 3,
    operationId: 'delete_gate_1',
  },
});

const requestCount = callableRequests.length;
await assert.rejects(
  () => api.requestDeleteGate('world_1', 'rank_1', created.gateId, realmObject({
    confirmationTitle: 'Updated Gate',
  })),
  (error) => error?.code === 'admin/invalid-argument'
);
assert.equal(callableRequests.length, requestCount, 'Invalid deletion reached the callable.');

for (const invalidId of ['', '../gate', 'gate/child', ' gate', 'gate ']) {
  await assert.rejects(
    () => api.getGate('world_1', 'rank_1', invalidId),
    (error) => error?.code === 'admin/invalid-argument'
  );
}

for (const request of callableRequests) assertNoUndefined(request);
auth.currentUser = firebaseUser('ordinary-user', false);
await windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
await assert.rejects(
  () => api.listGates('world_1', 'rank_1'),
  (error) => error?.code === 'admin/permission-denied'
);

assert.equal(microtasks.length, 1);
console.log('Admin Gate writes are claim-gated, awaited, transactional, counter-safe, and versioned.');
console.log('Admin Gate duplicate/move/delete calls carry strict idempotency and destination payloads.');
