import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function api(root = {}) {
  vm.runInNewContext(read('js/dictionary-pages.js'), { window: root, setTimeout, clearTimeout });
  return root.LootLinguaDictionaryPages;
}
const words = count => Array.from({ length: count }, (_, index) => ({ id: String(index).padStart(6, '0'), word: 'term-' + index, order: index, meaning: 'معنى ' + index }));
const settle = () => new Promise(resolve => setTimeout(resolve, 15));

test('one request loads 80 of 100000 records and idle time never drains the source', async () => {
  let calls = 0;
  const pages = api().create({ ownerId: 'a', fetchCounts: async () => ({ total: 100000 }), fetchPage: async (cursor, size) => {
    calls++; const offset = cursor || 0;
    return { words: words(size).map((word, i) => ({ ...word, id: String(offset + i) })), cursor: offset + size, done: false };
  } });
  await pages.refreshCounts(); await pages.next(); await settle();
  assert.equal(calls, 1); assert.equal(pages.words().length, 80); assert.equal(pages.state().complete, false);
});

test('simultaneous scroll requests join one read; failure retries the same cursor without losing loaded words', async () => {
  let calls = 0, reject = true;
  const cursors = [];
  const pages = api().create({ ownerId: 'a', fetchPage: async (cursor, size) => {
    calls++; cursors.push(cursor);
    await settle();
    if (cursor && reject) { reject = false; throw Error('offline'); }
    const offset = cursor || 0;
    return { words: words(160).slice(offset, offset + size), cursor: offset + size, done: offset > 0 };
  } });
  await Promise.all([pages.next(), pages.next(), pages.next()]); assert.equal(calls, 1);
  await assert.rejects(pages.next()); assert.equal(pages.words().length, 80); assert.equal(pages.state().complete, false);
  await pages.next(); assert.equal(pages.words().length, 160); assert.equal(pages.state().complete, true);
  assert.deepEqual(cursors, [null, 80, 80]);
});

test('full-data operations yield between pages, share a drain and do not trust an old count as completion', async () => {
  let calls = 0, yields = 0;
  const source = words(2000);
  const pages = api().create({ ownerId: 'a', fetchCounts: async () => ({ total: 1 }), yieldTask: async () => { yields++; },
    fetchPage: async (cursor, size) => {
      calls++; const offset = cursor || 0;
      return { words: source.slice(offset, offset + size), cursor: offset + size, done: offset + size >= source.length };
    } });
  await pages.refreshCounts(); await pages.next(); assert.equal(pages.state().complete, false);
  await Promise.all([pages.ensureComplete(), pages.ensureComplete()]);
  assert.equal(calls, 25); assert.equal(yields, 23); assert.equal(pages.words().at(-1).word, 'term-1999');
});

test('clearing a search stops its scan after the in-flight page', async () => {
  let calls = 0, release;
  const pages = api().create({ ownerId: 'a', fetchPage: async (cursor, size) => {
    calls++; await new Promise(resolve => { release = resolve; });
    return { words: words(80), cursor: (cursor || 0) + size, done: false };
  } });
  const controller = new AbortController();
  const request = pages.ensureComplete({ signal: controller.signal });
  await Promise.resolve(); await Promise.resolve(); controller.abort(); release();
  await assert.rejects(request, { name: 'AbortError' }); await settle();
  assert.equal(calls, 1); assert.equal(pages.state().complete, false); assert.equal(pages.words().length, 80);
});

test('cancelling search does not cancel another consumer preparing a full export or quiz', async () => {
  let calls = 0;
  const pages = api().create({ ownerId: 'a', fetchPage: async (cursor, size) => {
    calls++; await settle(); const offset = cursor || 0;
    return { words: words(160).slice(offset, offset + size), cursor: offset + size, done: offset > 0 };
  } });
  const controller = new AbortController();
  const search = pages.ensureComplete({ signal: controller.signal });
  const exportRequest = pages.ensureComplete();
  controller.abort(); await assert.rejects(search, { name: 'AbortError' });
  assert.equal((await exportRequest).length, 160); assert.equal(calls, 2);
});

test('late pages cannot publish after an owner switch or resurrect disposed data', async () => {
  const root = { auth: { currentUser: { uid: 'a' } } };
  const pagesApi = api(root); let resolve, publications = 0;
  const first = pagesApi.activate({ ownerId: 'a', onChange: () => publications++, fetchPage: () => new Promise(done => { resolve = done; }) });
  const request = first.next(); await Promise.resolve();
  const before = publications;
  root.auth.currentUser = { uid: 'b' };
  pagesApi.activate({ ownerId: 'b', fetchPage: async () => ({ words: [], done: true }) });
  resolve({ words: words(80), done: false });
  await assert.rejects(request, { code: 'dictionary/stale' });
  assert.equal(publications, before); assert.equal(first.words().length, 0); assert.equal(pagesApi.current('a'), null);
});

test('offline partial reads never become a successful full-source result', async () => {
  const pages = api().create({ ownerId: 'a', fetchPage: async () => ({ words: words(5), fromCache: true, done: true }) });
  await assert.rejects(pages.ensureComplete(), { code: 'dictionary/offline' });
  assert.equal(pages.state().complete, false);
});

test('a full offline backup is explicitly marked, and reconnect resets its pagination', async () => {
  const pages = api().create({ ownerId: 'a', fetchPage: async () => ({ words: words(80), cursor: 80, done: false }) });
  pages.restoreBackup(words(2000)); assert.equal(pages.state().offline, true); assert.equal(pages.state().complete, true);
  pages.reset(); await pages.next(); assert.equal(pages.words().length, 80); assert.equal(pages.state().offline, false); assert.equal(pages.state().complete, false);
});

function cloudHarness(t, source = words(2000)) {
  const reads = [], listeners = [], stops = [];
  const root = { auth: { currentUser: { uid: 'a' } }, dispatchEvent() {}, markInitialFeatureLoadPartDone() {}, applyCloudWordsFromSnapshot(rows) { root.words = rows; } };
  api(root);
  function records(q) {
    let rows = source;
    const order = q.constraints.find(item => item.kind === 'order') || { field: '__name__' };
    if (order && order.field !== '__name__') rows = rows.filter(word => Object.hasOwn(word, order.field));
    rows = [...rows].sort((a, b) => (order?.field === '__name__' ? 0 : ((a[order.field] ?? -1) - (b[order.field] ?? -1))) || a.id.localeCompare(b.id));
    for (const constraint of q.constraints.filter(item => item.kind !== 'limit')) {
      if (constraint.kind === 'where') rows = rows.filter(word => constraint.operator === 'in'
        ? constraint.value.includes(word.id) : word[constraint.field] === constraint.value);
      if (constraint.kind === 'after') { const index = rows.findIndex(word => word.id === constraint.doc.id); rows = rows.slice(index + 1); }
    }
    const maxRows = q.constraints.find(item => item.kind === 'limit')?.size;
    if (maxRows !== undefined) rows = rows.slice(0, maxRows);
    const docs = rows.map(word => ({ id: word.id, ref: { id: word.id }, data: () => word }));
    return { docs, size: docs.length, metadata: { fromCache: false }, docChanges: () => [] };
  }
  const context = vm.createContext({ window: root, auth: root.auth, db: {}, console, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    collection: () => ({ constraints: [] }), query: (_reference, ...constraints) => ({ constraints }),
    orderBy: field => ({ kind: 'order', field }), documentId: () => '__name__', startAfter: doc => ({ kind: 'after', doc }),
    where: (field, operator, value) => ({ kind: 'where', field, operator, value }), limit: size => ({ kind: 'limit', size }),
    getCountFromServer: async q => ({ data: () => ({ count: records(q).size }) }),
    getDocs: async q => { const page = records(q); reads.push({ type: 'get', limit: q.constraints.find(item => item.kind === 'limit')?.size, count: page.size }); return page; },
    onSnapshot(q, _options, callback) {
      if (typeof _options === 'function') callback = _options;
      const page = records(q); reads.push({ type: 'listen', limit: q.constraints.find(item => item.kind === 'limit')?.size, count: page.size });
      listeners.push(callback); queueMicrotask(() => callback(page)); return () => stops.push(q);
    },
    getDoc: async () => ({ exists: () => false }), wordsUnsubscribe: null,
  });
  const cloud = read('js/cloud.js');
  vm.runInContext(cloud.slice(cloud.indexOf('  function loadWordsFromCloud'), cloud.indexOf('  const USER_WORD_EDUCATIONAL_FIELDS')), context);
  context.loadWordsFromCloud(root.auth.currentUser);
  t.after(() => { context.wordsUnsubscribe?.(); root.LootLinguaDictionaryPages.clear(); });
  return { root, reads, listeners, stops, store: () => root.LootLinguaDictionaryPages.current('a'), context };
}

test('real Firestore adapter subscribes only to 80 documents and does not issue a second initial download', async t => {
  const h = cloudHarness(t); await settle();
  assert.equal(h.store().words().length, 80); assert.equal(h.store().state().counts.total, 2000);
  assert.equal(h.reads.length, 1); assert.equal(h.reads[0].type, 'listen'); assert.equal(h.reads[0].limit, 80);
  await h.store().next(); assert.equal(h.store().words().length, 160);
  assert.equal(h.reads[1].limit, 80); assert.equal(h.reads[1].count, 80);
});

test('cursor pagination keeps equal-order IDs and legacy documents without order, with no omissions or duplicates', async t => {
  const source = words(207).map((word, index) => index >= 153 ? { id: word.id, word: word.word, meaning: word.meaning } : { ...word, order: Math.floor(index / 20) });
  const h = cloudHarness(t, source); await settle(); await h.store().ensureComplete();
  assert.equal(h.store().words().length, source.length);
  assert.deepEqual([...h.store().words()].map(word => word.id).sort(), source.map(word => word.id).sort());
  assert.ok(h.reads.every(request => request.limit === 80 && request.count <= 80));
});

test('head updates do not turn an unloaded dictionary into a complete one', async t => {
  const h = cloudHarness(t); await settle();
  const value = { id: 'new-word', word: 'new term', order: -1 };
  h.listeners[0]({ metadata: { fromCache: false }, docChanges: () => [{ type: 'added', doc: { id: value.id, data: () => value } }] });
  await settle(); assert.equal(h.store().state().complete, false); assert.equal(h.store().words().length, 81);
});

test('visible-page subscriptions stay bounded and are released when leaving the dictionary', async t => {
  const h = cloudHarness(t); await settle(); await h.store().next();
  h.root.watchPersonalDictionaryRows(h.store().words().map(word => word.id));
  await new Promise(resolve => setTimeout(resolve, 290));
  assert.equal(h.listeners.length, 4); // The existing 80-word head plus 30/30/20 visible IDs.
  assert.ok(h.reads.slice(2).every(request => request.limit <= 30 && request.count <= 30));
  h.root.watchPersonalDictionaryRows([]); assert.equal(h.stops.length, 3);
});

test('Journey lookup also reads bounded pages and preserves raw legacy metadata', async t => {
  const source = words(207).map(word => ({ ...word, legacyOnlyMetadata: 'kept' }));
  const h = cloudHarness(t, source); await settle();
  const code = read('js/journey-cloud.js');
  h.context.personalWordsCollection = () => ({ constraints: [] });
  h.context.schemaApi = () => ({ normalizeWordIdentity: word => ({ wordKey: word }) });
  vm.runInContext(code.slice(code.indexOf('async function readPersonalWordIndex'), code.indexOf('function deterministicLegacyWordId')), h.context);
  const index = await h.context.readPersonalWordIndex('a');
  assert.equal(index.size, 207); assert.equal(index.get('term-206').data.legacyOnlyMetadata, 'kept');
  assert.ok(h.reads.every(request => request.limit <= 80));
});

test('a partial page cannot resolve or fabricate word-count based smart reminders', () => {
  const root = {}; vm.runInNewContext(read('js/notification-engine.js'), { window: root, Intl, Date, Set, Map });
  const existing = { id: 'review', kind: 'smart', status: 'active', notificationType: 'reminder.review.due', occurrenceKey: 'old-review' };
  const result = root.LootLinguaNotificationEngine.evaluate({ dictionaryComplete: false, now: Date.now(), wordCount: 2000, review: { dueCount: 80, activeCount: 80 } }, [existing], { ownerId: 'a' });
  assert.equal(result.resolutions.length, 0);
  assert.ok(result.upserts.every(item => item.notificationType !== 'reminder.review.due'));
});

test('export waits for every page and exports all words rather than the initial 80', async () => {
  const root = { auth: { currentUser: { uid: 'a' } }, words: [] };
  const source = words(207); let calls = 0, exported;
  const pagesApi = api(root);
  const pages = pagesApi.activate({ ownerId: 'a', onChange: rows => { root.words = rows; }, fetchPage: async (cursor, size) => {
    calls++; const offset = cursor || 0;
    return { words: source.slice(offset, offset + size), cursor: offset + size, done: offset + size >= source.length };
  } });
  await pages.next(); assert.equal(root.words.length, 80);
  const code = read('js/dictionary.js');
  const context = vm.createContext({ window: root, isCustomWorldView: () => false, getActiveCustomWorld: () => null,
    document: { createElement: () => ({ click() { exported = JSON.parse(decodeURIComponent(this.href.split(',').slice(1).join(','))); } }) },
  });
  vm.runInContext(code.slice(code.indexOf('window.exportData ='), code.indexOf('window.importData =')), context);
  await root.exportData();
  assert.equal(exported.words.length, 207); assert.equal(exported.words.at(-1).word, 'term-206'); assert.equal(calls, 3);
});

test('a pending full-data action is cancelled when navigation changes', async () => {
  const root = { auth: { currentUser: { uid: 'a' } }, __dictionaryNavigationGeneration: 1 };
  const pagesApi = api(root); let release;
  pagesApi.activate({ ownerId: 'a', fetchPage: () => new Promise(resolve => { release = resolve; }) });
  const operation = pagesApi.requireComplete(); await Promise.resolve(); await Promise.resolve();
  root.__dictionaryNavigationGeneration++;
  release({ words: words(80), done: true });
  assert.equal(await operation, false);
});

test('quiz readiness awaits the complete personal source and retains its request guard', async () => {
  const root = { auth: { currentUser: { uid: 'a' } } };
  const source = words(2000), pagesApi = api(root);
  const pages = pagesApi.activate({ ownerId: 'a', yieldTask: async () => {}, fetchPage: async (cursor, size) => {
    const offset = cursor || 0;
    return { words: source.slice(offset, offset + size), cursor: offset + size, done: offset + size >= source.length };
  } });
  await pages.next(); let currentToken;
  const coordinator = { begin: () => (currentToken = {}), isCurrent: token => token === currentToken };
  const context = vm.createContext({ window: root, quizCore: { parseSourceScope: scope => ({ scope, sourceType: 'personal' }) },
    currentQuizSource: 'personal', getQuizSourceOwnerId: owner => owner || root.auth.currentUser.uid,
    quizSourceRequestCoordinator: coordinator, refreshQuizAvailableCount() {}, refreshQuizSettingsSummary() {},
    resolveQuizSourceSnapshot: () => ({ candidateCount: pages.words().length, status: 'ready' }),
  });
  const code = read('js/quiz.js');
  vm.runInContext(code.slice(code.indexOf('async function ensureQuizSourceReady'), code.indexOf('window.resolveQuizSourceSnapshot')), context);
  const result = await context.ensureQuizSourceReady('personal');
  assert.equal(result.candidateCount, 2000); assert.equal(pages.state().complete, true);
});


test('head updates share cached aggregation counts rather than querying on each change',async()=>{
  let now=0,calls=0;const pages=api().create({ownerId:'A',clock:()=>now,fetchPage:async()=>({words:[],done:true}),fetchCounts:async()=>{calls++;return{total:2000,indexed:2000,starred:20}}});
  for(let i=0;i<30;i++)await pages.refreshCounts();assert.equal(calls,1);
  now=60001;await pages.refreshCounts();assert.equal(calls,2);
});

test('exhausted count queries back off without preventing bounded word loading',async()=>{
  let now=0,calls=0;const pages=api().create({ownerId:'A',clock:()=>now,fetchPage:async()=>({words:words(80),cursor:80,done:false}),fetchCounts:async()=>{calls++;throw Object.assign(new Error('quota'),{code:'resource-exhausted'})}});
  for(let i=0;i<20;i++)await assert.rejects(pages.refreshCounts(),{code:'resource-exhausted'});
  assert.equal(calls,1);await pages.next();assert.equal(pages.words().length,80);assert.equal(pages.state().complete,false);
  now=60001;await assert.rejects(pages.refreshCounts());assert.equal(calls,2);
});
