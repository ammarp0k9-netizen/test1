import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const rawSource = readFileSync(new URL('../js/admin-cloud.js', import.meta.url), 'utf8');
const source = rawSource.replace(
  /import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];\s*/g,
  ''
);

const listeners = new Map();
const microtasks = [];
const auth = { currentUser: null };
const worldStore = new Map();
const callablePayloads = [];
const serverTime = Object.freeze({ __serverTimestamp: true });
let generatedId = 0;
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

function snapshotFor(reference) {
  const value = worldStore.get(reference.id);
  return {
    id: reference.id,
    exists: () => value !== undefined,
    data: () => value === undefined ? undefined : { ...value }
  };
}

const dependencies = {
  getApps: () => [{}],
  getAuth: () => auth,
  collection: (_db, name) => ({ kind: 'collection', name }),
  doc: (_collection, id) => ({ id: id || `generated-world-${++generatedId}` }),
  getDoc: async (reference) => snapshotFor(reference),
  getDocs: async () => ({
    docs: [...worldStore.keys()].map((id) => snapshotFor({ id }))
  }),
  getFirestore: () => ({}),
  orderBy: () => ({}),
  query: (reference) => reference,
  runTransaction: async (_db, callback) => {
    const pending = [];
    const result = await callback({
      get: async (reference) => snapshotFor(reference),
      set(reference, value) {
        pending.push([reference.id, { ...value }]);
      }
    });
    for (const [id, value] of pending) worldStore.set(id, value);
    return result;
  },
  serverTimestamp: () => serverTime,
  getFunctions: () => ({}),
  httpsCallable: () => async (payload) => {
    callablePayloads.push({ ...payload });
    return { data: { deleted: true, worldId: payload.worldId } };
  }
};

const dependencyNames = Object.keys(dependencies).join(', ');
const context = vm.createContext({
  __deps: dependencies,
  window: windowObject,
  CustomEvent: TestCustomEvent,
  queueMicrotask(callback) {
    microtasks.push(callback);
  },
  console
});

new vm.Script(`const { ${dependencyNames} } = __deps;\n${source}`, {
  filename: 'admin-cloud.behavior.js'
}).runInContext(context);

const schemaSource = readFileSync(new URL('../js/content-schema.js', import.meta.url), 'utf8');
new vm.Script(schemaSource, { filename: 'content-schema.behavior.js' }).runInContext(context);

function firebaseUser(uid, claimOrPromise) {
  return {
    uid,
    getIdTokenResult() {
      return typeof claimOrPromise === 'function'
        ? claimOrPromise()
        : Promise.resolve({ claims: { admin: claimOrPromise } });
    }
  };
}

auth.currentUser = firebaseUser('ordinary-user', false);
await windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
assert.equal(windowObject.getLootLinguaAdminState().isAdmin, false);

const forgedUser = firebaseUser('ordinary-user', true);
await windowObject.refreshLootLinguaAdminAccess(forgedUser);
assert.equal(
  windowObject.getLootLinguaAdminState().isAdmin,
  false,
  'A caller-supplied forged user object must never unlock Admin UI state.'
);

auth.currentUser = firebaseUser('real-admin', true);
await windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
assert.deepEqual(
  { ...windowObject.getLootLinguaAdminState() },
  { resolved: true, isAdmin: true, uid: 'real-admin', errorCode: '' }
);

let resolveOldToken;
const oldToken = new Promise((resolve) => { resolveOldToken = resolve; });
auth.currentUser = firebaseUser('old-admin', () => oldToken);
const staleCheck = windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
auth.currentUser = firebaseUser('new-user', false);
windowObject.dispatchEvent(new TestCustomEvent('lootlingua:auth-state', {
  detail: { user: forgedUser }
}));
resolveOldToken({ claims: { admin: true } });
await staleCheck;
await Promise.resolve();
await Promise.resolve();
assert.equal(windowObject.getLootLinguaAdminState().uid, 'new-user');
assert.equal(windowObject.getLootLinguaAdminState().isAdmin, false);

assert.equal(microtasks.length, 1, 'The module should schedule one initial Auth-derived refresh.');

auth.currentUser = firebaseUser('real-admin', true);
await windowObject.refreshLootLinguaAdminAccess({ forceRefresh: true });
const api = windowObject.LootLinguaAdminCloud;
const realmObject = (value) => vm.runInContext(`(${JSON.stringify(value)})`, context);

const created = await api.createWorld(realmObject({
  title: 'Test World',
  slug: 'test-world',
  status: 'draft',
  order: 3,
  rankCount: 999,
  gateCount: 999,
  wordCount: 999
}));
assert.equal(created.worldId, 'generated-world-1');
assert.equal(created.version, 1);
assert.deepEqual(
  [created.rankCount, created.gateCount, created.wordCount],
  [0, 0, 0],
  'Create must reset all cached counters.'
);
assert.equal(created.createdBy, 'real-admin');
assert.equal(created.createdAt, serverTime);

worldStore.set(created.worldId, {
  ...worldStore.get(created.worldId),
  rankCount: 7,
  gateCount: 11,
  wordCount: 101
});
const originalCreatedAt = worldStore.get(created.worldId).createdAt;
const updated = await api.updateWorld(created.worldId, realmObject({
  title: 'Updated World',
  rankCount: 0,
  gateCount: 0,
  wordCount: 0,
  createdBy: 'forged-admin',
  createdAt: '2000-01-01T00:00:00.000Z'
}), 1);
assert.equal(updated.title, 'Updated World');
assert.equal(updated.version, 2);
assert.deepEqual([updated.rankCount, updated.gateCount, updated.wordCount], [7, 11, 101]);
assert.equal(updated.createdBy, 'real-admin');
assert.equal(updated.createdAt, originalCreatedAt);

await assert.rejects(
  () => api.updateWorld(created.worldId, realmObject({ title: 'Stale overwrite' }), 1),
  (error) => error?.code === 'admin/version-conflict'
);
assert.equal(worldStore.get(created.worldId).title, 'Updated World');

await assert.rejects(
  () => api.createWorld(realmObject({ title: 'Missing slug', status: 'published' })),
  (error) => error?.code === 'content/publish-requires-slug'
);

const published = await api.setWorldStatus(created.worldId, 'published', 2);
assert.equal(published.status, 'published');
assert.equal(published.version, 3);

const deleteResult = await api.requestDeleteWorld(created.worldId, realmObject({
  confirmationTitle: 'Updated World',
  expectedVersion: 3
}));
assert.equal(deleteResult.deleted, true);
assert.deepEqual(callablePayloads.at(-1), {
  worldId: created.worldId,
  confirmationTitle: 'Updated World',
  expectedVersion: 3
});

console.log('Admin claim state ignores forged users and stale account checks.');
console.log('Admin World writes preserve system fields, counters, versions, and awaited callable input.');
