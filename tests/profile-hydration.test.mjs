import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../js/script.js', import.meta.url), 'utf8');
const start = script.includes('window.applyCanonicalLootlinguaProfile = function')
  ? script.indexOf('window.applyCanonicalLootlinguaProfile = function')
  : script.indexOf('window.mergeLootlinguaProfileFromCloud = function');
const block = script.slice(start, script.indexOf('function normalizeMigrationWordKey('));
function harness() {
  const values = new Map([
    ['lootlinguaStreakFreezes', '5'], ['lootlingua.runner.coins.v1', '100'],
    ['lootlinguaDisplayName', 'Authenticated Name'], ['theme', 'ocean'],
    ['activityMap', JSON.stringify({ '2026-11-05': 50 })],
    ['lootlinguaExtraChests', JSON.stringify([{ id: 'spent' }])],
  ]);
  const attrs = new Map([['data-theme', 'ocean'], ['data-oasis-mode', 'dark']]);
  let renders = 0;
  const root = { auth: { currentUser: { uid: 'A' } }, __profileHydrating: false };
  const context = vm.createContext({
    window: root, JSON, Math, Object, Array, Map, Set,
    document: { documentElement: { getAttribute: (key) => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value) }, getElementById: () => ({ style: { display: 'none' } }) },
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) },
    loadInt: (key, fallback = 0) => Number(values.get(key) ?? fallback), saveInt: (key, value) => values.set(key, String(value)),
    loadJSON: (key, fallback) => JSON.parse(values.get(key) || JSON.stringify(fallback)), saveJSON: (key, value) => values.set(key, JSON.stringify(value)),
    XP_ECONOMY_VERSION: 2, THEME_USE_MESSAGES: { ocean: '', lootlingua: '' },
    todayStr: () => '2026-11-05', getDailyQuestStorageKey: (day = '2026-11-05') => `quest:${day}`,
    getLootState: () => JSON.parse(values.get('lootlinguaDailyLootState') || '{}'), saveLootState: (state) => values.set('lootlinguaDailyLootState', JSON.stringify(state)),
    getTitleState: () => ({}), saveTitleState: (state) => values.set('lootlinguaTitlesState', JSON.stringify(state)),
    readQuizExposureHistory: () => [], writeQuizExposureHistory() {},
    setTheme: (theme) => attrs.set('data-theme', theme), applyOasisMode: (mode) => attrs.set('data-oasis-mode', mode),
    isThemeComingSoon: () => false, isThemeUnlocked: () => true, themeSeenKey: (_type, theme) => `theme:${theme}`,
    evaluateTitleUnlocks() {}, renderStreak: () => { renders++; }, renderDailyGoal() {}, renderXPBar() {}, syncHeroAvatar() {},
    updateDailyQuestsBadge() {}, refreshFeatureUnlockUI() {}, renderProfileModalStats() {}, refreshThemeLockUI() {},
    render: () => { throw new Error('Profile hydration must not render the dictionary'); },
  });
  vm.runInContext(`let userXP = 100, dailyStreak = 99, lastActivity = '2026-11-04';\n${block}`, context);
  return { root, values, attrs, get renders() { return renders; },
    apply: (data) => (root.applyCanonicalLootlinguaProfile || root.mergeLootlinguaProfileFromCloud)(data, { canonical: true }),
    state: () => JSON.parse(vm.runInContext('JSON.stringify({ userXP, dailyStreak, lastActivity })', context)),
  };
}

test('canonical hydration replaces spent balances and the dated streak tuple instead of taking maxima', () => {
  const h = harness();
  h.apply({ userXP: 500, streakFreezes: 0, runnerCoins: 3, dailyStreak: 2, lastActivityDate: '2026-11-01', activityMap: { '2026-11-05': 4 }, extraChests: [] });
  assert.equal(h.values.get('lootlinguaStreakFreezes'), '0');
  assert.equal(h.values.get('lootlingua.runner.coins.v1'), '3');
  assert.deepEqual(h.state(), { userXP: 500, dailyStreak: 2, lastActivity: '2026-11-01' });
  assert.equal(JSON.parse(h.values.get('activityMap'))['2026-11-05'], 4);
  assert.deepEqual(JSON.parse(h.values.get('lootlinguaExtraChests')), []);
});

test('partial profile hydration retains authenticated appearance/name and does not render a dictionary', () => {
  const h = harness();
  h.apply({ streakFreezes: 1, runnerCoins: 7 });
  assert.equal(h.values.get('lootlinguaDisplayName'), 'Authenticated Name');
  assert.equal(h.attrs.get('data-theme'), 'ocean');
  assert.equal(h.attrs.get('data-oasis-mode'), 'dark');
  assert.equal(h.root.__profileHydrating, false);
  const renders = h.renders;
  h.apply({ streakFreezes: 1, runnerCoins: 7 });
  assert.equal(h.renders, renders, 'identical acknowledgements must not rerender the same profile');
});
