import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL('../js/' + file, import.meta.url), 'utf8');
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: index => [...data.keys()][index],
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key) };
}

function runtime(localStorage = storage()) {
  let instant = 1_800_000_000_000;
  class Clock extends Date { static now() { return instant; } }
  const listeners = new Map();
  const root = { localStorage, navigator: { onLine: true }, auth: { currentUser: { uid: 'A' } },
    addEventListener(type, handler) { (listeners.get(type) || listeners.set(type, []).get(type)).push(handler); },
    dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); } };
  const globals = { window: root, localStorage, Date: Clock, clearTimeout() {}, setTimeout() { return 1; },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, console };
  const context = vm.createContext(globals);
  vm.runInContext(read('cloud-backoff.js'), context);
  vm.runInContext(read('operation-runtime.js'), context);
  return { root, context, advance: ms => { instant += ms; } };
}

test('quota, service interruption, local connectivity and rejection are distinct', () => {
  const { root } = runtime();
  const api = root.LootLinguaCloudBackoff;
  const wrapped = cause => ({ code: 'published/unavailable', cause });
  assert.equal(api.classify(wrapped({ code: 'resource-exhausted', message: 'Quota exceeded.' })).reason, 'quota');
  assert.equal(api.classify({ code: 'resource-exhausted', message: 'Too much contention' }).reason, 'capacity');
  assert.equal(api.classify(wrapped({ code: 'permission-denied' })).temporary, false);
  assert.equal(api.classify({ code: 'firestore/unavailable' }).reason, 'service');
  root.navigator.onLine = false;
  assert.throws(() => api.assertAvailable(), { code: 'offline' });
});

test('the sync banner waits for confirmation and keeps its green state after ordinary background work', () => {
  const h = runtime();
  const makeNode = () => ({ hidden: false, style: { setProperty() {} }, dataset: {}, offsetHeight: 35,
    getBoundingClientRect: () => ({ width: 360, bottom: 60 }), getClientRects: () => [{}], setAttribute() {}, addEventListener() {} });
  const bar = makeNode();
  const dialog = new Map();
  bar.querySelector = key => { if (!dialog.has(key)) dialog.set(key, makeNode()); return dialog.get(key); };
  const header = makeNode();
  h.root.sessionStorage = storage();
  h.context.document = { body: makeNode(), documentElement: { lang: 'ar', clientWidth: 400 },
    getElementById: id => id === 'syncStatusBar' ? bar : id === 'legendTopBar' ? header : null };
  let pending = 1;
  h.root.LootLinguaOperations.setSyncSource('test', () => ({ pending }));
  h.root.navigator.onLine = false;
  vm.runInContext(read('sync-status.js'), h.context);
  assert.equal(bar.dataset.state, 'pending');
  assert.equal(bar.querySelector('button').hidden, true);
  h.root.navigator.onLine = true;
  h.root.LootLinguaOperations.syncNotify();
  assert.equal(bar.dataset.state, 'active');
  pending = 0;
  h.root.LootLinguaOperations.syncNotify();
  assert.equal(bar.dataset.state, 'success');
  pending = 1;
  h.root.LootLinguaOperations.syncNotify();
  assert.equal(bar.dataset.state, 'active');
  pending = 0;
  h.root.LootLinguaOperations.syncNotify();
  assert.equal(bar.dataset.state, 'success');
});

test('pending changes survive reopening and account changes; rejection blocks only its own dependent lane', async () => {
  const h = runtime();
  h.root.navigator.onLine = false;
  const scope = 'test';
  const inbox = h.root.LootLinguaOperations.createOutbox(scope, async () => assert.fail('Offline replay'));
  inbox.enqueue('add', { word: 'sample' }, { id: 'add', lane: 'word-a' });
  inbox.enqueue('edit', {}, { id: 'edit', lane: 'word-a' });
  inbox.enqueue('star', {}, { id: 'star', lane: 'word-b' });
  inbox.enqueue('star', {}, { id: 'star', lane: 'word-b' });
  await inbox.flush();
  assert.equal(h.root.LootLinguaOperations.syncStatus().pending, 3);

  const reopened = runtime(h.root.localStorage);
  const applied = [];
  let paused = true;
  const queue = reopened.root.LootLinguaOperations.createOutbox(scope, async operation => {
    if (paused) throw Object.assign(new Error('Quota exceeded.'), { code: 'resource-exhausted' });
    if (operation.type === 'add') throw Object.assign(new Error('Rejected by the server'), { code: 'permission-denied' });
    applied.push(operation.type);
  });
  reopened.root.auth.currentUser = { uid: 'B' };
  assert.equal(reopened.root.LootLinguaOperations.syncStatus().pending, 0);
  await queue.flush();
  reopened.root.auth.currentUser = { uid: 'A' };
  await queue.flush();
  assert.equal(reopened.root.LootLinguaCloudBackoff.reason(), 'quota');
  assert.equal(reopened.root.LootLinguaOperations.syncStatus().pending, 3);
  reopened.advance(60001); paused = false;
  await queue.flush();
  await queue.flush();
  assert.deepEqual(applied, ['star']);
  assert.equal(reopened.root.LootLinguaOperations.syncStatus().rejected, 1);
  assert.equal(reopened.root.LootLinguaOperations.syncStatus().pending, 1);
});

test('a local storage failure is never reported as a pending saved change', () => {
  const h = runtime();
  const queue = h.root.LootLinguaOperations.createOutbox('failure', async () => {});
  h.root.localStorage.setItem = () => { throw Error('storage full'); };
  assert.throws(() => queue.enqueue('edit', {}, { id: 'error', lane: 'test' }), { code: 'sync/local-storage' });
  assert.equal(h.root.LootLinguaOperations.syncStatus().pending, 0);
  assert.equal(h.root.LootLinguaOperations.syncStatus().localFailure, true);
});

test('two tabs share one outbox writer for an account', async () => {
  const shared = storage();
  const a = runtime(shared), b = runtime(shared);
  const locks = new Set();
  const scheduler = { async request(key, _options, work) {
    if (locks.has(key)) return work(null);
    locks.add(key);
    try { return await work({ name: key }); } finally { locks.delete(key); }
  } };
  a.root.navigator.locks = b.root.navigator.locks = scheduler;
  let complete;
  const gate = new Promise(resolve => { complete = resolve; });
  let writes = 0;
  const first = a.root.LootLinguaOperations.createOutbox('shared', async () => { writes++; await gate; });
  const second = b.root.LootLinguaOperations.createOutbox('shared', async () => { writes++; });
  first.enqueue('edit', { word: 'sample' }, { id: 'test', lane: 'word' });
  const writing = first.flush();
  await second.flush();
  assert.equal(writes, 1);
  complete();
  await writing;
  await second.flush();
  assert.equal(writes, 1);
  assert.equal(b.root.LootLinguaOperations.syncStatus().pending, 0);
});

test('offline assessments save ordered answers and withhold official outcomes before replay', async () => {
  const h = runtime();
  h.root.navigator.onLine = false;
  const calls = [];
  const auth = h.root.auth;
  const save = (type, values) => { calls.push({ type, values }); return { session: {} }; };
  const apply = (session, selected, key) => ({ ...session, currentQuestionIndex: session.currentQuestionIndex + 1,
    answers: [...(session.answers || []), { [key]: selected }] });
  Object.assign(h.context, {
    auth, requireUser: () => auth.currentUser,
    journeyCloudError: code => Object.assign(Error(code), { code }), queueMicrotask,
    levelPlacementCore: () => ({ answerSession: (session, selected) => apply(session, selected, 'selectedQuestionId'),
      finalizeRound: session => ({ ...session, status: 'awaiting-decision' }) }),
    placementCore: () => ({ answerSession: (session, selected) => apply(session, selected, 'selectedContentWordId') }),
    gateClearCore: () => ({ answerSession: (session, selected) => ({ ...apply(session, selected, 'selectedContentWordId'), status: 'submitting' }),
      buildQuestion: () => null }),
    answerGateClearQuestion: (...values) => save('gate', values), answerPlacementQuestion: (...values) => save('legacy', values),
    answerLevelPlacementQuestion: (...values) => save('level', values),
  });
  const source = read('journey-cloud.js');
  vm.runInContext(source.slice(source.indexOf('const placementCheckpointKey'), source.indexOf('async function answerLevelPlacementQuestion')), h.context);
  const journey = { worldId: 'world' };
  const active = { status: 'active', currentQuestionIndex: 0, assessmentId: 'level', orderedQuestionIds: ['one', 'two'] };
  const first = h.context.stageLevelPlacementAnswer({ journey, session: active }, 'a');
  const level = h.context.stageLevelPlacementAnswer(first, 'b');
  assert.equal(level.session.status, 'awaiting-decision');
  assert.equal(level.session.resultApplied, undefined);
  const legacy = h.context.stageLegacyPlacementAnswer({ journey, words: [], session: { ...active, totalQuestions: 1, assessmentId: 'older' } }, 'c');
  assert.equal(legacy.session.status, 'submitting');
  const gate = h.context.stageGateClearAnswer('world', 'rank', 'gate', { words: [], attempt: { ...active, attemptId: 'clear' } }, 'd');
  assert.equal(gate.pendingCloud, true);
  assert.equal(gate.result, undefined);
  assert.equal(h.context.readPendingLevelPlacement('world').session.currentQuestionIndex, 2);
  auth.currentUser = { uid: 'another' };
  assert.equal(h.context.readPendingGateClear('world', 'rank', 'gate'), null);
  auth.currentUser = { uid: 'A' };
  assert.equal(h.root.LootLinguaOperations.syncStatus().pending, 4);
  assert.equal(calls.length, 0);
  h.root.navigator.onLine = true;
  await vm.runInContext('placementAnswerOutbox.flush()', h.context);
  assert.deepEqual(calls.filter(call => call.type === 'level').map(call => call.values.at(-1).expectedIndex), [0, 1]);
  assert.deepEqual(calls.filter(call => call.type !== 'level').map(call => call.type).sort(), ['gate', 'legacy']);
  assert.equal(h.root.LootLinguaOperations.syncStatus().pending, 0);
});

function published(h, web) {
  Object.assign(h.context, {
    getApps: () => [{}], getFirestore: () => ({}), collection: (...path) => path, doc: (...path) => path,
    query: (...path) => path, documentId: () => 'id', where() {}, orderBy() {}, limit() {}, limitToLast() {},
    startAfter() {}, endBefore() {}, getDoc: web, getDocs: web,
  });
  vm.runInContext(read('published-content.js').replace(/^import\s[\s\S]*?from\s+"[^"]+";\r?\n/gm, ''), h.context);
  return h.root.LootLinguaPublishedContent;
}

test('10 published words use 10 document reads across list, lesson, and reload rather than 30', async () => {
  const original = runtime();
  let queries = 0;
  let served = 'Initial';
  const web = async () => {
    queries++;
    return { docs: Array.from({ length: 10 }, (_, index) => ({ id: 'word-' + index, data: () => ({ order: index, word: served }) })) };
  };
  const first = published(original, web);
  const results = await Promise.all([first.listPublishedGateWords('w', 'r', 'g'), first.listAllPublishedGateWords('w', 'r', 'g')]);
  assert.equal(results[0].items.length, 10);
  assert.equal(results[1].length, 10);
  const reopened = runtime(original.root.localStorage);
  const second = published(reopened, web);
  assert.equal((await second.listPublishedGateWords('w', 'r', 'g')).items[0].word, 'Initial');
  assert.equal(queries, 1);
  reopened.advance(300001); reopened.root.navigator.onLine = false;
  assert.equal((await second.listPublishedGateWords('w', 'r', 'g')).items.length, 10);
  await assert.rejects(second.listAllPublishedGateWords('w', 'r', 'g', { requireFresh: true }), { code: 'offline' });
  reopened.root.navigator.onLine = true; served = 'Updated';
  assert.equal((await second.listPublishedGateWords('w', 'r', 'g')).items[0].word, 'Updated');
  assert.equal(queries, 2);
});
