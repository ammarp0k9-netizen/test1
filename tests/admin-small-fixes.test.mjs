import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const cloud = read('js/admin-cloud.js'), admin = read('js/admin.js');
const section = (source, first, next) => source.slice(source.indexOf(first), source.indexOf(next, source.indexOf(first) + first.length));
const ref = path => ({ path, id: path.split('/').at(-1) });
function backend() {
  const docs = new Map(), deleted = [], context = { uid: 'admin' }; let commits = 0, failAt = 0;
  const error = (code, message) => Object.assign(Error(message), { code });
  const snapshot = reference => ({ ...reference, ref: reference, exists: () => docs.has(reference.path), data: () => structuredClone(docs.get(reference.path)) });
  const env = { Date, console, db: {}, contentWorlds: ref('content_worlds'), adminCloudError: error,
    assertAdminContext: owner => { if (owner.uid !== context.uid) throw error('admin/account-changed', 'account changed'); },
    resolveOperationToken: () => ({ operationId: 'stable-delete-id' }), completeOperationToken() {},
    doc: (parent, id) => ref(parent.path + '/' + id),
    ranksCollection: world => ref(`content_worlds/${world}/ranks`),
    gatesCollection: (world, rank) => ref(`content_worlds/${world}/ranks/${rank}/gates`),
    wordsCollection: (world, rank, gate) => ref(`content_worlds/${world}/ranks/${rank}/gates/${gate}/words`),
    serverTimestamp: () => Date.now(), documentId: () => '__name__', orderBy: (field, direction) => ({ kind: 'order', field, direction }), limit: value => ({ kind: 'limit', value }),
    where: (field, op, value) => ({ kind: 'where', field, op, value }),
    startAfter: (...values) => ({ kind: 'after', values }), endBefore: (...values) => ({ kind: 'before', values }), limitToLast: value => ({ kind: 'last', value }),
    query: (source, ...constraints) => ({ source, constraints }),
    getDocs: async ({ source, constraints }) => {
      let items = [...docs.keys()].filter(key => key.startsWith(source.path + '/') && key.slice(source.path.length + 1).split('/').length === 1).map(key => snapshot(ref(key)));
      for (const rule of constraints.filter(rule => rule.kind === 'where')) items = items.filter(item => rule.op === '>=' ? item.data()[rule.field] >= rule.value : rule.op === '<=' ? item.data()[rule.field] <= rule.value : item.data()[rule.field] === rule.value);
      const fields = constraints.filter(rule => rule.kind === 'order');
      const values = item => fields.map(rule => rule.field === '__name__' ? item.id : item.data()[rule.field]);
      const compare = (a, b) => { for (let i = 0; i < a.length; i++) { const result = String(a[i]).localeCompare(String(b[i])); if (result) return fields[i].direction === 'desc' ? -result : result; } return 0; };
      items.sort((a, b) => compare(values(a), values(b)));
      for (const rule of constraints) {
        if (rule.kind === 'after') items = items.filter(item => compare(values(item), rule.values) > 0);
        if (rule.kind === 'before') items = items.filter(item => compare(values(item), rule.values) < 0);
      }
      const cap = constraints.find(rule => rule.kind === 'limit' || rule.kind === 'last');
      if (cap) items = cap.kind === 'last' ? items.slice(-cap.value) : items.slice(0, cap.value);
      return { docs: items, empty: !items.length };
    },
    runTransaction: async (_, callback) => {
      const writes = []; let writing = false;
      const result = await callback({ get: async reference => { assert.equal(writing, false); return snapshot(reference); },
        update(reference, patch) { writing = true; writes.push(() => docs.set(reference.path, { ...docs.get(reference.path), ...patch })); },
        delete(reference) { writing = true; writes.push(() => { docs.delete(reference.path); deleted.push(reference.path); }); } });
      if (++commits === failAt) throw Error('simulated interruption'); writes.forEach(write => write()); return result;
    } };
  return { docs, deleted, context, env, failAt(value) { failAt = value; } };
}
function deletion(db) { const ctx = vm.createContext(db.env); vm.runInContext(section(cloud, 'async function deleteArchivedWorldDirect(', 'async function listRanks('), ctx); return payload => ctx.deleteArchivedWorldDirect({ uid: 'admin' }, payload); }
function seed(db, count = 145) {
  db.docs.set('content_worlds/world', { status: 'archived', title: 'عالمي', version: 2 });
  db.docs.set('content_worlds/world/ranks/rank', {}); db.docs.set('content_worlds/world/ranks/rank/gates/gate', {});
  for (let index = 0; index < count; index++) db.docs.set(`content_worlds/world/ranks/rank/gates/gate/words/word${index}`, {});
  db.docs.set('content_worlds/other', { title: 'keep' }); db.docs.set('users/student/words/word', { word: 'keep' });
}
const payload = { worldId: 'world', confirmationTitle: 'عالمي', expectedVersion: 2 };
test('archived world deletion is paged, children-first, and does not touch other worlds or student data', async () => {
  const db = backend(); seed(db); const result = await deletion(db)(payload);
  assert.equal(result.affectedCounts.words, 145); assert.equal(result.affectedCounts.gates, 1); assert.equal(result.affectedCounts.ranks, 1);
  assert.equal(db.deleted.at(-1), 'content_worlds/world'); assert.equal(db.docs.has('content_worlds/other'), true); assert.equal(db.docs.has('users/student/words/word'), true);
  assert.equal([...db.docs.keys()].some(key => key.startsWith('content_worlds/world/')), false);
});
test('interrupted deletion retains the archived parent and resumes with the same lease', async () => {
  const db = backend(); seed(db); db.failAt(3); const remove = deletion(db);
  await assert.rejects(remove(payload)); assert.ok(db.docs.has('content_worlds/world')); assert.equal(db.deleted.length, 60);
  await remove(payload); assert.equal(db.docs.has('content_worlds/world'), false); assert.equal(new Set(db.deleted).size, db.deleted.length);
});
test('world deletion refuses changed title/version, active operations and changed accounts before deleting', async () => {
  for (const change of [{ title: 'renamed' }, { version: 3 }, { status: 'published' }, { _adminWorldOperation: { leaseAt: Date.now() } }, { _deleteLock: { requestId: 'other', requestedAt: Date.now() } }]) {
    const db = backend(); seed(db, 1); Object.assign(db.docs.get('content_worlds/world'), change);
    await assert.rejects(deletion(db)(payload)); assert.equal(db.deleted.length, 0);
  }
  const db = backend(); seed(db, 1); db.context.uid = 'other'; await assert.rejects(deletion(db)(payload)); assert.equal(db.deleted.length, 0);
});
test('staging search queries the complete source and maintains separate paged cursors', async () => {
  const db = backend(), root = { LootLinguaContentSchema: { normalizeWord: value => String(value).toLowerCase().trim() } };
  const ctx = vm.createContext({ ...db.env, window: root, requireAdminContext: async () => ({ uid: 'admin' }), getWordListDataApi: () => root.LootLinguaWordListData,
    requireOptions: (value = {}, allowed) => { Object.keys(value).forEach(key => assert.ok(allowed.has(key))); return value; },
    requireWordPageSize: value => value, requireWordListDirection: value => value || 'forward', requireListSort: value => value || 'word-asc', requireListFilters: value => value,
    requirePrefixSearch: value => value || '', STAGING_SORTS: { 'word-asc': [{ field: 'normalizedWord', direction: 'asc' }] }, WORD_PAGE_SIZE_DEFAULT: 10,
    STAGING_CURSOR_PREFIX: 'test', contentWordImportStaging: ref('content_word_import_staging'), requireStagingWordId: value => value,
    stagingWordRecord: item => ({ ...item.data(), stagingWordId: item.id }), mapAdminCloudError: error => error,
    encodePageToken: (_, _path, signature, _fields, item, id) => JSON.stringify({ signature, values: [item.normalizedWord, id] }),
    decodePageToken: (token, _, _path, signature) => { const value = JSON.parse(token); assert.equal(value.signature, signature); return value.values; } });
  vm.runInContext(read('js/word-list-data.js'), ctx); vm.runInContext(section(cloud, 'async function listStagingWords(', 'async function countStagingWords('), ctx);
  for (let index = 0; index < 150; index++) db.docs.set('content_word_import_staging/' + index, { normalizedWord: (index < 125 ? 'alpha' : 'zebra') + String(index).padStart(3, '0') });
  const first = await ctx.listStagingWords({ sort: 'word-asc', pageSize: 10 }); assert.equal(first.items.some(item => item.normalizedWord.startsWith('zebra')), false);
  const match = await ctx.listStagingWords({ search: 'zebra', sort: 'word-asc', pageSize: 10 }); assert.equal(match.items.length, 10); assert.ok(match.items.every(item => item.normalizedWord.startsWith('zebra')));
  const next = await ctx.listStagingWords({ search: 'zebra', sort: 'word-asc', pageSize: 10, cursor: match.nextCursor });
  assert.equal(next.items.length, 10); assert.equal(new Set([...match.items, ...next.items].map(item => item.stagingWordId)).size, 20);
});
test('JSON file selection from staging preserves its route and reaches the shared preview pipeline', () => {
  const listeners = {}, ui = { view: 'staging', wordImportPending: false }; let picked = false, prepared;
  const input = { addEventListener: (name, handler) => { listeners[name] = handler; }, remove() {}, click() { picked = true; } };
  const ctx = vm.createContext({ ui, makeElement: () => input, document: { body: { append() {} } }, renderWords: () => { ui.view = 'words'; }, renderStagingWords() {}, prepareWordImport: (...args) => { prepared = args; } });
  vm.runInContext(section(admin, '  function chooseWordImportFile(', '  function modalIsDirty('), ctx);
  ctx.chooseWordImportFile(null, null, null, null, 'staging'); assert.equal(picked, true); assert.equal(ui.view, 'staging');
  input.files = [{ name: 'words.json' }]; listeners.change(); assert.equal(prepared[5], 'staging'); assert.equal(ui.view, 'staging');
});
