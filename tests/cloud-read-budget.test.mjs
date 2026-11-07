import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = file => fs.readFileSync(new URL('../js/' + file, import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function notifications(dirty = false) {
  const values = new Map(), events = new Map();
  const root = { addEventListener: (name, handler) => events.set(name, handler), dispatchEvent() {} };
  const localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const context = vm.createContext({ window: root, localStorage, console, Date,
    CustomEvent: class {}, getApps: () => [{}], getFirestore: () => ({}), getAuth: () => ({ currentUser: { uid: 'a' } }),
    collection: (...parts) => parts, doc: (...parts) => ({ id: parts.at(-1) }), query: (...parts) => parts, limit() {}, orderBy() {},
  });
  vm.runInContext(read('notification-store.js'), context);
  const store = root.LootLinguaNotificationStore; store.switchOwner('a');
  for (let i = 0; i < 100; i++) store.upsert({ id: 'notice-' + i, occurrenceKey: 'occurrence-' + i, kind: 'smart', title: 'Notice', message: 'Test', createdAt: 1700000000000, updatedAt: 1700000000000 }, { sync: false });
  const cloud = store.getAll().map(record => ({ ...record }));
  if (dirty) store.markVisibleRead([cloud[0].id], 1700000001000);
  let reads = 0, writes = 0, latestQueries = 0;
  context.onSnapshot = (_query, callback) => { callback({ docs: cloud.map(record => ({ id: record.id, data: () => record })) }); return () => {}; };
  context.onAuthStateChanged = (_auth, callback) => callback({ uid: 'a' });
  context.getDocs = async () => { latestQueries++; return { empty: false, docs: [{ data: () => ({ completedAt: 1700000000000 }) }] }; };
  context.runTransaction = async (_db, action) => action({
    get: async target => { reads++; const record = cloud.find(record => record.id === target.id); return { exists: () => Boolean(record), data: () => record }; },
    set() { writes++; },
  });
  const code = read('notification-cloud.js').replace(/^import[\s\S]*?from '[^']+';\s*/gm, '');
  vm.runInContext(code, context);
  return { root, events, stats: () => ({ reads, writes, latestQueries }) };
}

test('100 notifications already synchronized do not cause 100 transactions on login', async () => {
  const h = notifications(); await settle(); await settle();
  assert.equal(h.stats().reads, 0); assert.equal(h.stats().writes, 0);
});

test('only a changed offline notification is merged back to the cloud', async () => {
  const h = notifications(true); await settle(); await settle();
  assert.equal(h.stats().reads, 1); assert.equal(h.stats().writes, 1);
});

test('notification fact evaluations share the latest-quiz read until an actual completion invalidates it', async () => {
  const h = notifications();
  await Promise.all(Array.from({ length: 25 }, () => h.root.LootLinguaNotificationCloud.latestTrustedQuizAt()));
  assert.equal(h.stats().latestQueries, 1);
  h.events.get('lootlingua:trusted-quiz-completed')();
  await h.root.LootLinguaNotificationCloud.latestTrustedQuizAt();
  assert.equal(h.stats().latestQueries, 2);
});

test('rendering newest/oldest pages does not trigger a complete-dictionary scan', () => {
  const source = read('dictionary-render.js');
  const prefix = source.slice(source.indexOf('function renderDictionaryWindow'), source.indexOf("  const searchType =", source.indexOf('function renderDictionaryWindow')));
  for (const mode of ['newest', 'oldest']) {
    let scans = 0;
    const root = { cancelDictionaryFullDataRequest() {}, LootLinguaDictionaryPages: { current: () => ({ ownerId: 'a', state: () => ({ complete: false, queryMode: mode }), ensureComplete() { scans++; return Promise.resolve(); } }) } };
    vm.runInNewContext('let dictionaryFullDataRequest=null;' + prefix + '}renderDictionaryWindow()', {
      window: root, document: { getElementById: () => ({ value: '' }) }, AbortController,
      isEditableDictionaryView: () => true, isCustomWorldView: () => false,
      dictionarySortMode: mode, dictionarySortCategory: 'all', currentFilter: 'all',
    });
    assert.equal(scans, 0);
  }
});

test('private worlds show the account cache immediately and ignore an empty unconfirmed SDK cache', () => {
  const calls = []; let listener, subscriptions = 0;
  const auth = { currentUser: { uid: 'a' } };
  const root = { readCustomWorldsFromStorage: uid => { assert.equal(uid, 'a'); return [{ id: 'saved', name: 'Saved world' }]; }, applyCustomWorldsFromCloud: worlds => calls.push(worlds) };
  const source = read('cloud.js');
  const code = source.slice(source.indexOf('  function loadCustomWorldsFromCloud'), source.indexOf('  function loadGlobalWordMasteryFromCloud'));
  vm.runInNewContext('let customWorldsUnsubscribe=null;' + code, { window: root, auth, db: {}, console: { info() {}, warn() {} },
    collection() {}, onSnapshot(_query, callback) { subscriptions++; listener = callback; return () => {}; },
  });
  root.ensureCustomWorldsFromCloud(); root.ensureCustomWorldsFromCloud();
  assert.equal(subscriptions, 1); assert.equal(calls.length, 1); assert.equal(calls[0][0].id, 'saved');
  listener({ docs: [], metadata: { fromCache: true, hasPendingWrites: false } });
  assert.equal(calls.length, 1);
  listener({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
  assert.equal(calls.length, 2); assert.equal(calls[1].length, 0, 'a confirmed server deletion still clears the list');
  auth.currentUser = { uid: 'b' }; listener({ docs: [], metadata: { fromCache: false } });
  assert.equal(calls.length, 2, 'an old account cannot change the new account list');
});
