import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const script = read('js/script.js'), dictionary = read('js/dictionary.js');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function orderHarness(custom = false) {
  const calls = [], timers = [];
  const root = { auth: { currentUser: { uid: 'a' } }, __lootlinguaAuthGeneration: 1, words: [{ id: 'a1' }, { id: 'a2' }] };
  let context;
  context = vm.createContext({ window: root, activeCustomWorldId: custom ? 'world-a' : '', _wordOrderSyncTimer: null,
    isCustomWorldView: () => Boolean(context.activeCustomWorldId), showToast() {},
    clearTimeout() {}, setTimeout: fn => { timers.push(fn); return timers.length; },
  });
  root.updateDictionaryWordInCloud = async (...args) => { calls.push(['personal', ...args]); return true; };
  root.updateCustomWorldDictionaryWordInCloud = async (...args) => { calls.push(['custom', ...args]); return true; };
  vm.runInContext(between(script, 'function scheduleWordOrderCloudSync', 'function closeAppDropdowns'), context);
  return { root, context, calls, timers };
}

test('deferred reorder retains its original world and word snapshot instead of writing the newly opened world', async () => {
  const h = orderHarness(true), captured = h.context.captureWordOrderSync();
  h.context.activeCustomWorldId = 'world-b'; h.root.words = [{ id: 'b1' }];
  assert.equal(await h.context.syncWordOrdersToCloud(captured), true);
  assert.deepEqual(structuredClone(h.calls), [['custom', 'world-a', 'a1', { order: 0 }], ['custom', 'world-a', 'a2', { order: 1 }]]);
});

test('1000-word reordering bounds concurrent requests and keeps quiz writers untouched', async () => {
  const h = orderHarness(); let active = 0, peak = 0, calls = 0;
  h.root.words = Array.from({ length: 1000 }, (_, id) => ({ id: String(id) }));
  h.root.updateWordInCloud = () => { throw Error('Quiz writer must not run'); };
  h.root.updateDictionaryWordInCloud = async () => { calls++; active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return true; };
  assert.equal(await h.context.syncWordOrdersToCloud(), true); assert.equal(calls, 1000); assert.ok(peak <= 20);
});

test('an auth change stops queued order batches and an obsolete debounce cannot write into B', async () => {
  const h = orderHarness(); let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  h.root.words = Array.from({ length: 100 }, (_, id) => ({ id: String(id) }));
  h.root.updateDictionaryWordInCloud = async () => { calls++; await pending; return true; };
  const operation = h.context.syncWordOrdersToCloud(); assert.equal(calls, 20);
  h.root.auth.currentUser = { uid: 'b' }; h.root.__lootlinguaAuthGeneration++;
  release(); assert.equal(await operation, false); assert.equal(calls, 20);
  h.context.scheduleWordOrderCloudSync(); h.root.auth.currentUser = { uid: 'a' }; h.root.__lootlinguaAuthGeneration++;
  h.timers.at(-1)(); await Promise.resolve(); assert.equal(calls, 20);
});

function preferenceHarness() {
  const calls = [], attrs = new Map([['data-theme', 'lootlingua'], ['data-oasis-mode', 'light']]), storage = new Map();
  const root = { auth: { currentUser: { uid: 'a' } }, __lootlinguaAuthGeneration: 1,
    saveProfilePreferencesToCloud: async patch => { calls.push(structuredClone(patch)); return true; },
    saveProfileToCloud: () => { throw Error('A preference must not save the full profile'); },
  };
  const context = vm.createContext({ window: root, isInitialLoad: false,
    document: { documentElement: { getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value) }, querySelectorAll: () => [] },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    THEME_USE_MESSAGES: { lootlingua: 'original', ocean: 'ocean' }, themeSeenKey: (type, theme) => type + ':' + theme,
    currentThemePreferenceKey: () => 'theme-a', isThemeComingSoon: () => false, isThemeUnlocked: () => true,
    refreshThemeLockUI() {}, syncOasisAppearanceControls() {}, showToast() {}, setTimeout() {},
    applyOasisMode: mode => attrs.set('data-oasis-mode', mode),
  });
  vm.runInContext(between(script, 'function requestProfilePreferencesSave', '// بيانات الملف الشخصي'), context);
  vm.runInContext(between(script, 'function getThemeIntroSeenList', 'function bootstrapThemeNotificationKeysOnce'), context);
  vm.runInContext(between(script, 'window.setTheme =', 'function loadTheme'), context);
  vm.runInContext(script.slice(script.indexOf('window.setProfileOasisMode ='), script.indexOf('\n};', script.indexOf('window.setProfileOasisMode =')) + 3), context);
  return { root, context, calls };
}

test('real theme/Oasis/intro callers send only preference fields and never the full profile', async () => {
  const h = preferenceHarness(); assert.equal(h.root.setTheme('ocean'), true); assert.equal(h.root.setProfileOasisMode('dark'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, [{ themeIntroSeen: ['ocean'] }, { theme: 'ocean' }, { oasisMode: 'dark' }]);
});

test('a preference queued in A is not invoked with B credentials in the next microtask', async () => {
  const h = preferenceHarness(); const request = h.context.requestProfilePreferencesSave({ theme: 'ocean' });
  h.root.auth.currentUser = { uid: 'b' }; h.root.__lootlinguaAuthGeneration++;
  assert.equal(await request, false); assert.equal(h.calls.length, 0);
});

test('statistics share a single mastery-store read for 2000 words', () => {
  const words = Array.from({ length: 2000 }, (_, id) => ({ word: 'term' + id, starred: id % 2 === 0 }));
  const entries = Object.fromEntries(words.map(word => [word.word, { mastery_status: 'Mastered', mastery_streak: 3, xpEconomyVersion: 2 }]));
  let reads = 0; const nodes = new Map();
  const root = { auth: { currentUser: { uid: 'a' } }, addEventListener() {} };
  const context = vm.createContext({ window: root, XP_ECONOMY_VERSION: 2, customWorlds: [], dailyStreak: 4,
    getStorageUserId: () => 'a', normalizeWord: word => String(word).toLowerCase().trim(),
    loadJSON: key => key === 'activityMap' ? { '2026-11-05': 3 } : (reads++, entries),
    readWordsFromStorage: () => words, localStorage: { setItem() {} }, hasSignedInUser: () => true,
    getPersonalDictionaryWordsSnapshot: () => words,
    document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } },
  });
  vm.runInContext(read('js/srs.js'), context);
  vm.runInContext(between(dictionary, 'function renderStatsNumbers', 'function persistDictionary'), context);
  context.renderStatsNumbers(); assert.equal(reads, 1); assert.equal(nodes.get('statTotal').textContent, 2000); assert.equal(nodes.get('statForgot').textContent, 2000);
});

test('the heatmap includes today shortly after midnight in Amman rather than yesterday in UTC', () => {
  process.env.TZ = 'Asia/Amman';
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-05T00:30:00+03:00'])); } }
  const cells = [], fragment = { appendChild: node => cells.push(node) };
  const context = vm.createContext({ Date: FixedDate, loadJSON: () => ({ '2026-11-05': 1 }), document: {
    getElementById: () => ({ appendChild() {} }), createDocumentFragment: () => fragment,
    createElement: () => ({ dataset: {} }),
  } });
  vm.runInContext(between(script, 'function localDateKey', 'function previousLocalDateKey'), context);
  vm.runInContext(between(dictionary, 'function renderHeatmap', 'function renderStatsNumbers'), context);
  context.renderHeatmap(); assert.equal(cells.length, 365); assert.equal(cells.at(-1).title, '2026-11-05 — 1 كلمة'); assert.equal(cells.at(-1).dataset.level, 4);
});
