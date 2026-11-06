import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const xp = await readFile(new URL('../js/xp.js', import.meta.url), 'utf8');
const script = await readFile(new URL('../js/script.js', import.meta.url), 'utf8');
const streak = xp.slice(xp.indexOf('function checkAndUpdateStreak(options = {})'), xp.indexOf('\nfunction renderStreak'));
const dates = script.slice(script.indexOf('function localDateKey('), script.indexOf('function localDayBounds('));

function run({ now = '2026-11-05T12:00:00', last = '2026-11-03', freezes = 3, helpers = true, learningEvent = true, repeats = 1 } = {}) {
  const instant = new Date(now).getTime();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  const values = new Map([
    ['lootlinguaStreakFreezes', freezes], ['lootlinguaFreezeSaves', 2], ['lootlinguaMaxStreak', 9],
    ['activityMap', JSON.stringify({ [now.slice(0, 10)]: 4 })],
  ]);
  let saves = 0;
  const context = vm.createContext({
    Date: FixedDate, window: {}, Math, JSON,
    localStorage: { setItem: (key, value) => values.set(key, value) },
    loadInt: (key, fallback) => values.get(key) ?? fallback,
    saveInt: (key, value) => values.set(key, value),
    loadJSON: (key, fallback) => JSON.parse(values.get(key) || JSON.stringify(fallback)),
    saveJSON: (key, value) => values.set(key, JSON.stringify(value)),
    requestProfileCloudSave: () => { saves++; },
    hasSignedInUser: () => false,
    renderStreak() {}, renderProfileModalStats() {}, evaluateTitleUnlocks() {},
    isJsonImportBatchActive: () => true, setTimeout() {}, showToast() {},
    ...(helpers ? {
      getStreakFreezeCount: () => values.get('lootlinguaStreakFreezes'),
      saveStreakFreezeCount: (value) => values.set('lootlinguaStreakFreezes', value),
    } : {}),
  });
  vm.runInContext(`${dates}\nfunction todayStr() { return localDateKey(new Date()); }
    window.LootLinguaLocalTime = { previousLocalDateKey };
    let dailyStreak = 7; let lastActivity = ${JSON.stringify(last)}; let userXP = 321;
    ${streak}
    for (let activity = 0; activity < ${repeats}; activity++) checkAndUpdateStreak({ learningEvent: ${learningEvent} });`, context);
  return {
    ...JSON.parse(vm.runInContext('JSON.stringify({ dailyStreak, lastActivity, userXP })', context)),
    freezes: values.get('lootlinguaStreakFreezes'),
    freezeSaves: values.get('lootlinguaFreezeSaves'),
    storedDate: values.get('lastActivityDate'),
    activity: JSON.parse(values.get('activityMap')),
    saves,
  };
}

if (process.env.LOOTLINGUA_STREAK_DST_CASE === '1') {
  for (const [now, last, hours] of [
    ['2026-03-09T12:00:00', '2026-03-07', 47],
    ['2026-11-02T12:00:00', '2026-10-31', 49],
  ]) {
    assert.equal((new Date(now) - new Date(`${last}T12:00:00`)) / 3_600_000, hours);
    const result = run({ now, last });
    assert.equal(result.freezes, 2);
    assert.equal(result.dailyStreak, 8);
    assert.equal(result.freezeSaves, 3);
  }
  for (const [now, last] of [
    ['2026-03-10T12:00:00', '2026-03-07'],
    ['2026-11-03T12:00:00', '2026-10-31'],
  ]) {
    const result = run({ now, last });
    assert.equal(result.freezes, 1);
    assert.equal(result.dailyStreak, 8);
    const insufficient = run({ now, last, freezes: 1 });
    assert.equal(insufficient.freezes, 1);
    assert.equal(insufficient.dailyStreak, 1);
  }
} else {
  test('today is idempotent and yesterday advances the streak without consuming a freeze', () => {
    const today = run({ last: '2026-11-05' });
    assert.equal(today.dailyStreak, 7);
    assert.equal(today.freezes, 3);
    assert.equal(today.saves, 0);
    const yesterday = run({ last: '2026-11-04' });
    assert.equal(yesterday.dailyStreak, 8);
    assert.equal(yesterday.freezes, 3);
    assert.equal(yesterday.freezeSaves, 2);
    assert.equal(yesterday.storedDate, '2026-11-05');
  });

  test('exactly one absent calendar day consumes one freeze and counts the return learning day', () => {
    for (const helpers of [false, true]) {
      const result = run({ helpers });
      assert.equal(result.dailyStreak, 8);
      assert.equal(result.freezes, 2);
      assert.equal(result.freezeSaves, 3);
      assert.equal(result.storedDate, '2026-11-05');
      assert.equal(result.activity['2026-11-05'], 4);
      assert.equal(result.userXP, 321);
    }
  });

  test('uncovered absences, future or invalid dates do not waste protection', () => {
    for (const last of ['2026-10-31', '2026-10-05', '2025-11-05', '2026-11-06', 'invalid']) {
      const result = run({ last });
      assert.equal(result.dailyStreak, 1);
      assert.equal(result.freezes, 3);
      assert.equal(result.freezeSaves, 2);
      assert.equal(result.storedDate, '2026-11-05');
    }
  });

  test('each absent calendar day costs one freeze, and repeated learning today never spends twice', () => {
    for (const helpers of [false, true]) {
      const result = run({ last: '2026-11-02', freezes: 2, helpers, repeats: 3 });
      assert.equal(result.freezes, 0); assert.equal(result.freezeSaves, 4);
      assert.equal(result.dailyStreak, 8); assert.equal(result.storedDate, '2026-11-05');
      const insufficient = run({ last: '2026-11-02', freezes: 1, helpers });
      assert.equal(insufficient.freezes, 1); assert.equal(insufficient.freezeSaves, 2);
      assert.equal(insufficient.dailyStreak, 1);
    }
  });

  test('single-day protection follows month, leap-day and year boundaries', () => {
    for (const [now, last] of [
      ['2026-03-01T00:30:00', '2026-02-27'],
      ['2024-03-01T23:30:00', '2024-02-28'],
      ['2027-01-01T12:00:00', '2026-12-30'],
    ]) {
      const result = run({ now, last });
      assert.equal(result.freezes, 2);
      assert.equal(result.dailyStreak, 8);
      assert.equal(result.storedDate, now.slice(0, 10));
    }
  });

  test('no freeze or no prior activity starts a new streak; passive checks do not spend', () => {
    const noFreeze = run({ freezes: 0 });
    assert.equal(noFreeze.dailyStreak, 1);
    assert.equal(noFreeze.freezeSaves, 2);
    const first = run({ last: '' });
    assert.equal(first.dailyStreak, 1);
    assert.equal(first.freezes, 3);
    const passive = run({ learningEvent: false });
    assert.equal(passive.dailyStreak, 7);
    assert.equal(passive.freezes, 3);
    assert.equal(passive.saves, 0);
  });

  test('DST transitions cover a calendar gap of one day across both 47-hour and 49-hour spans', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: 'America/New_York', LOOTLINGUA_STREAK_DST_CASE: '1' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
