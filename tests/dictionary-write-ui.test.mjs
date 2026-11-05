import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../js/dictionary.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));

function button(id = '') {
  const classes = new Set(), attrs = {};
  return { dataset: { id }, style: {}, disabled: false, innerHTML: '', attrs,
    classList: { add: name => classes.add(name), toggle: (name, active) => active ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) },
    setAttribute: (key, value) => { attrs[key] = value; }, removeAttribute: key => { delete attrs[key]; } };
}
function harness({ guest = false, custom = false } = {}) {
  const nodes = { wordInput: { value: 'Apple' }, meaningInput: { value: 'تفاحة جديدة' }, exampleInput: { value: 'An apple.' }, categoryInput: { value: 'اسم' }, addBtn: button() };
  const star = button('w1'), calls = { saves: [], updates: [], events: [], notices: [], persists: 0, clears: 0, renders: 0 };
  let saved = [], persistMode = '', save = async () => 'server-id', update = async () => true;
  const root = { auth: { currentUser: guest ? null : { uid: 'a' } }, __lootlinguaAuthGeneration: 1, words: [],
    dispatchEvent: event => calls.events.push(event),
    saveWordToCloud: async (...args) => { calls.saves.push(['personal', ...args]); return save(); },
    saveCustomWorldWordToCloud: async (...args) => { calls.saves.push(['custom', ...args]); return save(); },
    updateDictionaryWordInCloud: async (...args) => { calls.updates.push(['personal', ...args]); return update(); },
    updateCustomWorldDictionaryWordInCloud: async (...args) => { calls.updates.push(['custom', ...args]); return update(); },
  };
  const context = vm.createContext({ window: root, console, Date, Math, Map,
    currentView: custom ? 'customWorld' : 'personal', activeCustomWorldId: custom ? 'world-a' : null,
    dictionarySortMode: 'auto', currentFilter: 'all', editId: null, renderLimit: 20,
    document: { getElementById: id => nodes[id], querySelectorAll: () => [star] },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    getActiveDictionaryStorageScope: () => context.currentView === 'customWorld' ? 'custom_' + context.activeCustomWorldId : 'personal',
    isCustomWorldView: () => context.currentView === 'customWorld', isEditableDictionaryView: () => true,
    getWordLifecycleContract: () => null, hasSignedInUser: () => Boolean(root.auth.currentUser),
    findActiveDictionaryWord: word => root.words.find(item => item.word.toLowerCase() === word.toLowerCase()),
    isDictionaryWordHidden: word => word.hiddenFromDictionary === true,
    applyKnownSharedMastery: word => word, rateLimit: () => true,
    showToast: (...args) => calls.notices.push(args), pushNotification: (...args) => calls.notices.push(args),
    getActiveDictionaryMessageLabel: () => 'القاموس',
    reindexWordOrder: rows => rows.forEach((word, order) => { word.order = order; }),
    persistDictionary() {
      calls.persists++;
      if (persistMode === 'before') throw Error('Storage quota');
      saved = clone(root.words);
      if (persistMode === 'after') throw Error('Optional decoration failed');
    },
    saveAndRender() { context.persistDictionary(); calls.renders++; },
    readWordsFromStorage: () => clone(saved), readCustomWorldWordsFromStorage: () => clone(saved),
    render: () => calls.renders++, renderStarredWords: () => calls.renders++,
    clearInputs() { calls.clears++; for (const id of ['wordInput', 'meaningInput', 'exampleInput']) nodes[id].value = ''; },
    setAddFormExpanded() {},
  });
  vm.runInContext(section('async function saveActiveWordToCloud', 'async function deleteActiveWordFromCloud'), context);
  vm.runInContext(section('window.addWord = async function', 'window.editWord ='), context);
  vm.runInContext(section('window.toggleStar =', 'window.playSound ='), context);
  vm.runInContext(section('async function addAiMeaningCore', 'window.addAiMeaningToPersonal ='), context);
  return { root, context, nodes, star, calls, setSave: fn => { save = fn; }, setUpdate: fn => { update = fn; }, setPersist: mode => { persistMode = mode; }, stored: () => saved };
}

for (const custom of [false, true]) test(`null acknowledgement cannot save or announce a signed-in ${custom ? 'custom-world' : 'personal'} addition`, async () => {
  const h = harness({ custom }); h.setSave(async () => null);
  assert.equal(await h.root.addWord(), false);
  assert.equal(h.root.words.length, 0); assert.equal(h.calls.persists, 0); assert.equal(h.calls.clears, 0); assert.equal(h.calls.events.length, 0);
  assert.equal(h.nodes.wordInput.value, 'Apple'); assert.equal(h.nodes.addBtn.disabled, false);
});

test('rejected additions retain inputs, while a real acknowledgement emits exactly one saved event', async () => {
  const h = harness(); h.setSave(async () => { throw Error('permission-denied'); });
  assert.equal(await h.root.addWord(), false); assert.equal(h.calls.events.length, 0);
  h.setSave(async () => 'accepted-id'); assert.equal(await h.root.addWord(), true);
  assert.equal(h.root.words[0].id, 'accepted-id'); assert.equal(h.calls.events.length, 1);
  assert.equal(h.calls.events[0].detail.owner, 'a'); assert.equal(h.nodes.wordInput.value, '');
});

test('guest local persistence stays valid and storage failures do not announce success', async () => {
  const h = harness({ guest: true }); h.setPersist('before');
  assert.equal(await h.root.addWord(), false); assert.equal(h.root.words.length, 0); assert.equal(h.calls.events.length, 0);
  assert.equal(h.nodes.wordInput.value, 'Apple'); assert.equal(h.calls.saves.length, 0);
  h.setPersist(''); assert.equal(await h.root.addWord(), true);
  assert.equal(h.stored().length, 1); assert.equal(h.calls.events[0].detail.owner, 'guest');
});

test('an optional failure after durable local persistence cannot turn success into a failed addition', async () => {
  const h = harness({ guest: true }); h.setPersist('after');
  assert.equal(await h.root.addWord(), true); assert.equal(h.stored().length, 1); assert.equal(h.calls.events.length, 1);
});

test('double submission cannot launch two writes', async () => {
  const h = harness(); let resolve; h.setSave(() => new Promise(done => { resolve = done; }));
  const first = h.root.addWord(); await tick();
  assert.equal(await h.root.addWord(), false); assert.equal(h.calls.saves.length, 1);
  resolve('saved-once'); assert.equal(await first, true); assert.equal(h.calls.events.length, 1);
});

test('an empty form cannot trigger a complete dictionary scan', async () => {
  const h = harness(); let scans = 0;
  h.root.LootLinguaDictionaryPages = { requireComplete: async () => { scans++; return true; } };
  h.nodes.wordInput.value = '';
  assert.equal(await h.root.addWord(), false); assert.equal(scans, 0); assert.equal(h.calls.saves.length, 0);
});

test('a changed draft during preparation is cancelled before a write', async () => {
  const h = harness(); let resolve;
  h.root.LootLinguaDictionaryPages = { requireComplete: () => new Promise(done => { resolve = done; }) };
  const operation = h.root.addWord(); h.nodes.wordInput.value = 'new draft'; resolve(true);
  assert.equal(await operation, false); assert.equal(h.calls.saves.length, 0); assert.equal(h.nodes.wordInput.value, 'new draft');
});

test('a late acknowledged save cannot erase a newer draft in the same account', async () => {
  const h = harness(); let resolve; h.setSave(() => new Promise(done => { resolve = done; }));
  const operation = h.root.addWord(); await tick(); h.nodes.wordInput.value = 'new draft'; resolve('saved-apple');
  assert.equal(await operation, true); assert.equal(h.root.words[0].word, 'Apple'); assert.equal(h.nodes.wordInput.value, 'new draft'); assert.equal(h.calls.clears, 0); assert.equal(h.calls.events.length, 1);
});

test('a rejected write cannot roll back a newer unrelated cloud snapshot', async () => {
  const h = harness(); let resolve; h.setSave(() => new Promise(done => { resolve = done; }));
  const operation = h.root.addWord(); await tick();
  h.root.words = [{ id: 'remote', word: 'Banana', meaning: 'حديثة' }]; resolve(null);
  assert.equal(await operation, false); assert.equal(h.root.words[0].id, 'remote');
});

test('late success cannot clear the next account form, replace its words or emit its saved event', async () => {
  const h = harness(); let resolve; h.setSave(() => new Promise(done => { resolve = done; }));
  const operation = h.root.addWord(); await tick();
  h.root.auth.currentUser = { uid: 'b' }; h.root.__lootlinguaAuthGeneration++;
  h.root.words = [{ id: 'b', word: 'Other' }]; h.nodes.wordInput.value = 'B draft'; resolve('a-saved');
  assert.equal(await operation, false); assert.equal(h.root.words[0].id, 'b'); assert.equal(h.nodes.wordInput.value, 'B draft'); assert.equal(h.calls.events.length, 0);
});

test('failed editing keeps the old word and edit mode; success mirrors readable aliases without touching mastery', async () => {
  const h = harness(); h.root.words = [{ id: 'w1', word: 'Apple', text: 'Apple', meaning: 'قديم', translation: 'قديم', mastery_streak: 3 }]; h.context.editId = 'w1';
  h.setUpdate(async () => { throw Error('denied'); }); assert.equal(await h.root.addWord(), false);
  assert.equal(h.root.words[0].meaning, 'قديم'); assert.equal(h.context.editId, 'w1');
  h.setUpdate(async () => true); assert.equal(await h.root.addWord(), true);
  assert.equal(h.root.words[0].meaning, 'تفاحة جديدة'); assert.equal(h.root.words[0].translation, 'تفاحة جديدة'); assert.equal(h.root.words[0].mastery_streak, 3);
  assert.equal(h.calls.events.length, 0);
});

test('custom-world edits use the dictionary writer, never the SRS writer', async () => {
  const h = harness({ custom: true }); h.root.words = [{ id: 'w1', word: 'Apple' }]; h.context.editId = 'w1';
  h.root.updateCustomWorldWordInCloud = () => { throw Error('SRS writer must not run'); };
  assert.equal(await h.root.addWord(), true); assert.deepEqual(h.calls.updates[0].slice(0, 3), ['custom', 'world-a', 'w1']);
});

test('star acknowledgement updates data and aria; a rejected star is restored without an unhandled rejection', async () => {
  const h = harness(); h.root.words = [{ id: 'w1', word: 'Apple', starred: false }];
  h.setUpdate(async () => { throw Error('denied'); }); assert.equal(await h.root.toggleStar('w1'), false);
  assert.equal(h.root.words[0].starred, false); assert.equal(h.star.attrs['aria-pressed'], 'false'); assert.equal(h.star.disabled, false);
  h.setUpdate(async () => true); assert.equal(await h.root.toggleStar('w1'), true);
  assert.equal(h.root.words[0].starred, true); assert.equal(h.star.attrs['aria-pressed'], 'true');
});

test('a null search-add response never falls back to a fake local success for a signed-in account', async () => {
  const h = harness(); h.setSave(async () => null);
  await h.context.addAiMeaningCore({ word: 'Apple', ar: 'تفاحة', pos: 'اسم', ex: '' }, button());
  assert.equal(h.root.words.length, 0); assert.equal(h.calls.persists, 0);
  assert.ok(h.calls.notices.every(notice => notice[1] !== 'success'));
});

test('a guest example-only edit cannot succeed against the older persisted version after quota failure', async () => {
  const h = harness({ guest: true });
  h.root.words = [{ id: 'w1', word: 'Apple', meaning: h.nodes.meaningInput.value, example: 'Old example', category: h.nodes.categoryInput.value }];
  h.context.persistDictionary(); h.context.editId = 'w1'; h.setPersist('before');
  assert.equal(await h.root.addWord(), false);
  assert.equal(h.root.words[0].example, 'Old example'); assert.equal(h.context.editId, 'w1');
  assert.equal(h.nodes.exampleInput.value, 'An apple.'); assert.equal(h.calls.clears, 0);
});

test('a failed guest suggestion rolls back the phantom word and remains retryable', async () => {
  const h = harness({ guest: true }), btn = button();
  const suggestion = { word: 'Apple', ar: 'Apple meaning', pos: 'noun', ex: 'An apple.' };
  h.setPersist('before'); await h.context.addAiMeaningCore(suggestion, btn);
  assert.equal(h.root.words.length, 0); assert.equal(h.stored().length, 0); assert.equal(btn.disabled, false);
  h.setPersist(''); await h.context.addAiMeaningCore(suggestion, btn);
  assert.equal(h.root.words.length, 1); assert.equal(h.stored().length, 1); assert.equal(btn.disabled, true);
});

test('a guest suggestion stays saved after an optional failure following durable persistence', async () => {
  const h = harness({ guest: true }), btn = button(); h.setPersist('after');
  await h.context.addAiMeaningCore({ word: 'Apple', ar: 'Apple meaning', pos: 'noun', ex: '' }, btn);
  assert.equal(h.root.words.length, 1); assert.equal(h.stored().length, 1); assert.equal(btn.disabled, true);
});
