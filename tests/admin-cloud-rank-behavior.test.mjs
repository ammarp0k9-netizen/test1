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
let generatedRankId = 0;
let transactionBarrier = null;
let callableBarrier = null;
let failNextCallable = '';
let conflictNextCallable = '';

function collection(parent, name) {
  const path = parent?.path ? `${parent.path}/${name}` : name;
  return { kind: 'collection', path };
}

function doc(parent, id) {
  const documentId = id || `generated-rank-${++generatedRankId}`;
  return { kind: 'document', id: documentId, path: `${parent.path}/${documentId}` };
}

function snapshotFor(reference) {
  const value = store.get(reference.path);
  return {
    id: reference.id,
    exists: () => value !== undefined,
    data: () => value === undefined ? undefined : { ...value }
  };
}

async function runTransaction(_db, callback) {
  const writes = [];
  const result = await callback({
    get: async (reference) => snapshotFor(reference),
    set(reference, value) {
      writes.push({ type: 'set', reference, value: { ...value } });
    },
    update(reference, patch) {
      writes.push({ type: 'update', reference, value: { ...patch } });
    }
  });
  const barrier = transactionBarrier;
  if (barrier) await barrier;
  for (const write of writes) {
    if (write.type === 'set') {
      store.set(write.reference.path, write.value);
    } else {
      store.set(write.reference.path, {
        ...(store.get(write.reference.path) || {}),
        ...write.value
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
      const error = new Error('stale rank version');
      error.code = 'functions/aborted';
      error.details = {
        reason: 'version-conflict',
        expectedVersion: 2,
        actualVersion: 3
      };
      throw error;
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
const windowObject = {
  addEventListener(type, handler) {
    const handlers = listeners.get(type) || [];
    handlers.push(handler);
    listeners.set(type, handlers);
  },
  dispatchEvent(event) {
    for (const handler of listeners.get(event.type) || []) handler(event);
    return true;
  }
};

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
  httpsCallable
};

const context = vm.createContext({
  __deps: dependencies,
  window: windowObject,
  CustomEvent: TestCustomEvent,
  queueMicrotask(callback) {
    microtasks.push(callback);
  },
  console
});
const dependencyNames = Object.keys(dependencies).join(', ');
new vm.Script(`const { ${dependencyNames} } = __deps;\n${source}`, {
  filename: 'admin-cloud-rank.behavior.js'
}).runInContext(context);

const schemaSource = readFileSync(new URL('../js/content-schema.js', import.meta.url), 'utf8');
new vm.Script(schemaSource, { filename: 'content-schema-rank.behavior.js' }).runInContext(context);

function firebaseUser(uid, isAdmin) {
  return {
    uid,
    getIdTokenResult: async () => ({ claims: { admin: isAdmin } })
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

function assertNoUndefined(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoUndefined);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    assert.notEqual(value[key], undefined, `undefined at ${key}`);
    assertNoUndefined(value[key]);
  }
}

auth.currentUser = firebaseUser('rank-admin', true);
await windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
const api = windowObject.LootLinguaAdminCloud;
const worldPath = 'content_worlds/world_1';
store.set(worldPath, {
  schemaVersion: 1,
  worldId: 'world_1',
  slug: 'world-one',
  title: 'World One',
  status: 'draft',
  version: 9,
  rankCount: 2,
  gateCount: 8,
  wordCount: 90,
  order: 1,
  createdAt: serverTime,
  updatedAt: serverTime,
  createdBy: 'first-admin',
  updatedBy: 'first-admin'
});

const transactionWait = deferred();
transactionBarrier = transactionWait.promise;
let createSettled = false;
const createPromise = api.createRank('world_1', realmObject({
  title: 'Rank Five',
  order: 5,
  status: 'draft',
  version: 500,
  gateCount: 500,
  wordCount: 500,
  createdBy: 'forged-admin'
})).then((value) => {
  createSettled = true;
  return value;
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(createSettled, false, 'createRank resolved before its transaction committed.');
transactionWait.resolve();
const created = await createPromise;
transactionBarrier = null;

assert.equal(created.rankId, 'generated-rank-1');
assert.equal(created.worldId, 'world_1');
assert.equal(created.version, 1);
assert.deepEqual([created.gateCount, created.wordCount], [0, 0]);
assert.equal(created.createdBy, 'rank-admin');
assert.equal(created.createdAt, serverTime);
const worldAfterCreate = store.get(worldPath);
assert.equal(worldAfterCreate.rankCount, 3);
assert.equal(worldAfterCreate.gateCount, 8);
assert.equal(worldAfterCreate.wordCount, 90);
assert.equal(worldAfterCreate.version, 9, 'A counter-only child mutation must preserve world.version.');
assert.equal(worldAfterCreate.updatedBy, 'rank-admin');
assertNoUndefined(store.get('content_worlds/world_1/ranks/generated-rank-1'));

store.set('content_worlds/world_1/ranks/rank-first', {
  ...store.get('content_worlds/world_1/ranks/generated-rank-1'),
  rankId: 'rank-first',
  title: 'First Rank',
  order: 1
});
const listed = await api.listRanks('world_1');
assert.deepEqual(Array.from(listed, (rank) => rank.rankId), ['rank-first', 'generated-rank-1']);
assert.equal((await api.getRank('world_1', 'generated-rank-1')).title, 'Rank Five');

const createdPath = 'content_worlds/world_1/ranks/generated-rank-1';
const originalCreatedAt = store.get(createdPath).createdAt;
store.set(createdPath, {
  ...store.get(createdPath),
  gateCount: 3,
  wordCount: 30
});
const updated = await api.updateRank('world_1', created.rankId, realmObject({
  title: 'Updated Rank',
  version: 999,
  gateCount: 0,
  wordCount: 0,
  createdAt: '2000-01-01T00:00:00.000Z',
  createdBy: 'forged-admin'
}), 1);
assert.equal(updated.title, 'Updated Rank');
assert.equal(updated.version, 2);
assert.deepEqual([updated.gateCount, updated.wordCount], [3, 30]);
assert.equal(updated.createdAt, originalCreatedAt);
assert.equal(updated.createdBy, 'rank-admin');

await assert.rejects(
  () => api.updateRank('world_1', created.rankId, realmObject({ title: 'Stale edit' }), 1),
  (error) => error?.code === 'admin/version-conflict'
);
assert.equal(store.get(createdPath).title, 'Updated Rank');

const archived = await api.setRankStatus('world_1', created.rankId, 'archived', 2);
assert.equal(archived.status, 'archived');
assert.equal(archived.version, 3);

conflictNextCallable = 'duplicateContentRank';
await assert.rejects(
  () => api.duplicateRankAsDraft(
    'world_1',
    created.rankId,
    2,
    realmObject({ operationId: 'stale_duplicate_submit' })
  ),
  (error) => error?.code === 'admin/version-conflict' &&
    error?.details?.actualVersion === 3
);

const duplicateWait = deferred();
callableBarrier = duplicateWait.promise;
let duplicateSettled = false;
const duplicatePromise = api.duplicateRankAsDraft(
  'world_1',
  created.rankId,
  3,
  realmObject({ operationId: 'duplicate_submit_1' })
).then((value) => {
  duplicateSettled = true;
  return value;
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(duplicateSettled, false, 'duplicateRankAsDraft resolved before its callable.');
duplicateWait.resolve();
assert.deepEqual(plain(await duplicatePromise), {
  duplicated: true,
  sourceRankId: created.rankId
});
callableBarrier = null;
assert.deepEqual(callableRequests.at(-1), {
  name: 'duplicateContentRank',
  payload: {
    worldId: 'world_1',
    rankId: created.rankId,
    expectedVersion: 3,
    operationId: 'duplicate_submit_1'
  }
});

failNextCallable = 'duplicateContentRank';
await assert.rejects(
  () => api.duplicateRankAsDraft('world_1', created.rankId, 3),
  (error) => error?.code === 'admin/unavailable'
);
const generatedOperationId = callableRequests.at(-1).payload.operationId;
assert.match(generatedOperationId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
await api.duplicateRankAsDraft('world_1', created.rankId, 3);
assert.equal(
  callableRequests.at(-1).payload.operationId,
  generatedOperationId,
  'A retry must reuse the generated idempotency key.'
);
await api.duplicateRankAsDraft('world_1', created.rankId, 3);
assert.notEqual(
  callableRequests.at(-1).payload.operationId,
  generatedOperationId,
  'A new operation after success must receive a fresh idempotency key.'
);

const deleted = await api.requestDeleteRank('world_1', created.rankId, realmObject({
  confirmationTitle: 'Updated Rank',
  expectedVersion: 3,
  operationId: 'delete_submit_1'
}));
assert.equal(deleted.deleted, true);
assert.deepEqual(callableRequests.at(-1), {
  name: 'deleteContentRank',
  payload: {
    worldId: 'world_1',
    rankId: created.rankId,
    confirmationTitle: 'Updated Rank',
    expectedVersion: 3,
    operationId: 'delete_submit_1'
  }
});

const requestCount = callableRequests.length;
await assert.rejects(
  () => api.requestDeleteRank('world_1', created.rankId, realmObject({
    confirmationTitle: 'Updated Rank'
  })),
  (error) => error?.code === 'admin/invalid-argument'
);
assert.equal(callableRequests.length, requestCount, 'Invalid deletion reached the callable.');

for (const invalidId of ['', '../rank', 'rank/child', ' rank', 'rank ']) {
  await assert.rejects(
    () => api.getRank('world_1', invalidId),
    (error) => error?.code === 'admin/invalid-argument'
  );
}

auth.currentUser = firebaseUser('ordinary-user', false);
await windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
await assert.rejects(
  () => api.listRanks('world_1'),
  (error) => error?.code === 'admin/permission-denied'
);

assert.equal(microtasks.length, 1);
console.log('Admin Rank writes are claim-gated, awaited, transactional, counter-safe, and versioned.');
console.log('Admin Rank duplicate/delete calls carry strict idempotency and confirmation payloads.');
