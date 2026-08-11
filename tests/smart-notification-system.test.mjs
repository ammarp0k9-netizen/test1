import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

process.env.TZ = 'Asia/Amman';

const [storeSource, engineSource, runtimeSource, cloudSource, coreSource, htmlSource, rulesSource, journeyCloudSource, appSource, xpSource, worldsSource, quizRuntimeSource, quizSource] = await Promise.all([
  readFile(new URL('../js/notification-store.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/notification-engine.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/notification-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/notification-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/core.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/script.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/xp.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz.js', import.meta.url), 'utf8'),
]);

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    clear: () => values.clear(),
    dump: () => new Map(values),
  };
}

function loadSystem() {
  const localStorage = memoryStorage();
  const root = {
    dispatchEvent() {},
    addEventListener() {},
  };
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const context = vm.createContext({
    window: root,
    globalThis: root,
    localStorage,
    console,
    CustomEvent,
    Date,
    Math,
    Set,
    Map,
    Object,
    String,
    Number,
    JSON,
    Promise,
  });
  vm.runInContext(storeSource, context);
  vm.runInContext(engineSource, context);
  return { root, store: root.LootLinguaNotificationStore, engine: root.LootLinguaNotificationEngine, localStorage, context };
}

function baseFacts(overrides = {}) {
  return {
    wordCount: 0,
    chest: {}, streak: {}, review: {}, gatePractice: {}, newWords: {}, quiz: {},
    journey: {}, gateReady: {}, contentUnlocked: {}, weakWords: {}, inactivity: {},
    ...overrides,
  };
}

function loadRuntimeHarness(initialFacts, actionContext = {}) {
  const system = loadSystem();
  const listeners = new Map();
  const documentListeners = new Map();
  const toasts = [];
  let facts = initialFacts;
  let timerId = 0;
  system.root.auth = { currentUser: { uid: 'account-a' } };
  system.store.switchOwner('account-a');
  system.root.LootLinguaNotificationSources = {
    async collect() { return { ...facts }; },
    getActionContext() {
      return {
        dueWordKeys: [], gateWordKeys: [], newWordKeys: [], weakWordKeys: [],
        ...actionContext,
      };
    },
  };
  system.root.addEventListener = (name, handler) => listeners.set(name, handler);
  system.root.showToast = (...args) => { toasts.push(args); return ''; };
  system.context.document = {
    readyState: 'complete',
    visibilityState: 'visible',
    addEventListener(name, handler) { documentListeners.set(name, handler); },
  };
  system.context.setTimeout = () => ++timerId;
  system.context.clearTimeout = () => {};
  vm.runInContext(runtimeSource, system.context);
  return {
    ...system,
    toasts,
    listeners,
    documentListeners,
    setFacts(nextFacts) { facts = nextFacts; },
  };
}

function installProductionNotificationReviewStarter(harness) {
  const start = quizSource.indexOf('window.startNotificationWordReview = function');
  const end = quizSource.indexOf('\n};', start) + 3;
  assert.ok(start >= 0 && end > start);
  let launched = null;
  harness.context.isFeatureUnlocked = () => true;
  harness.context.getQuizSourceWords = () => [{ id: 'due-1', word: 'one' }, { id: 'due-2', word: 'two' }];
  harness.context.normalizeQuizWord = (word) => word;
  harness.context.getWordMasteryKey = (word) => String(word.id);
  harness.context.clearActiveQuizSessionStorage = () => {};
  harness.context.startActualQuiz = (mode, options) => { launched = { mode, options }; };
  harness.context.showToast = () => {};
  harness.root.loadQuizView = () => {};
  vm.runInContext(quizSource.slice(start, end), harness.context);
  return () => launched;
}

function completeTrustedStreakDay({ today, yesterday, streakCount, answeredCount }) {
  const activityMap = { [today]: answeredCount };
  const ints = new Map([['lootlinguaMaxStreak', streakCount]]);
  const storage = memoryStorage();
  storage.setItem('activityMap', JSON.stringify(activityMap));
  const root = {
    LootLinguaLocalTime: { previousLocalDateKey: () => yesterday },
  };
  const context = vm.createContext({
    window: root,
    globalThis: root,
    localStorage: storage,
    todayStr: () => today,
    localDateKey: () => today,
    loadJSON: (key, fallback) => JSON.parse(storage.getItem(key) || JSON.stringify(fallback)),
    saveJSON: (key, value) => storage.setItem(key, JSON.stringify(value)),
    loadInt: (key, fallback) => ints.has(key) ? ints.get(key) : fallback,
    saveInt: (key, value) => ints.set(key, value),
    getStreakFreezeCount: () => 0,
    isJsonImportBatchActive: () => true,
    renderStreak() {},
    renderProfileModalStats() {},
    requestProfileCloudSave() {},
    evaluateTitleUnlocks() {},
    showToast() {},
    setTimeout() {},
    Date,
    Math,
    JSON,
  });
  const start = xpSource.indexOf('function checkAndUpdateStreak(options = {})');
  const end = xpSource.indexOf('\nfunction renderStreak', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(`let dailyStreak = ${Number(streakCount)}; let lastActivity = ${JSON.stringify(yesterday)};\n${xpSource.slice(start, end)}`, context);
  vm.runInContext('checkAndUpdateStreak({ learningEvent: true });', context);
  return vm.runInContext(`({
    dailyStreak,
    lastActivity,
    activityToday: JSON.parse(localStorage.getItem('activityMap') || '{}')[${JSON.stringify(today)}] || 0
  })`, context);
}

test('review.due always waits four real hours and does not over-trigger a small dictionary', () => {
  const { engine } = loadSystem();
  const now = new Date('2026-08-11T08:00:00+03:00').getTime();
  const small = engine.evaluate(baseFacts({
    wordCount: 4,
    review: { dueCount: 3, activeCount: 4, episodeKey: 'small' },
  }), [], { now, ownerId: 'guest' });
  assert.equal(small.upserts.some((record) => record.notificationType === engine.TYPE.REVIEW_DUE), false);

  const first = engine.evaluate(baseFacts({
    wordCount: 10,
    review: { dueCount: 3, activeCount: 10, episodeKey: 'backlog-a' },
  }), [], { now, ownerId: 'guest' });
  const pending = first.upserts.find((record) => record.notificationType === engine.TYPE.REVIEW_DUE);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.eligibleAt - pending.eligibleSince, 4 * engine.HOUR);
  assert.equal(first.selected, null);

  const early = engine.evaluate(baseFacts({
    wordCount: 10,
    review: { dueCount: 3, activeCount: 10, episodeKey: 'backlog-a' },
  }), first.upserts, { now: now + 4 * engine.HOUR - 1, ownerId: 'guest' });
  assert.equal(early.selected, null);
  assert.equal(early.upserts.find((record) => record.notificationType === engine.TYPE.REVIEW_DUE).status, 'pending');

  const eligible = engine.evaluate(baseFacts({
    wordCount: 10,
    review: { dueCount: 3, activeCount: 10, episodeKey: 'backlog-a' },
  }), early.upserts, { now: now + 4 * engine.HOUR, ownerId: 'guest' });
  assert.equal(eligible.selected.record.notificationType, engine.TYPE.REVIEW_DUE);
  assert.equal(eligible.selected.record.showCount, 1);
});

test('review escalation is driven by backlog age or real growth', () => {
  const { engine } = loadSystem();
  const now = Date.now();
  const first = engine.evaluate(baseFacts({ wordCount: 20, review: { dueCount: 5, activeCount: 20, episodeKey: 'growth' } }), [], { now, ownerId: 'guest' });
  const active = engine.evaluate(baseFacts({ wordCount: 20, review: { dueCount: 5, activeCount: 20, episodeKey: 'growth' } }), first.upserts, { now: now + 4 * engine.HOUR, ownerId: 'guest' });
  const unchanged = engine.evaluate(baseFacts({ wordCount: 20, review: { dueCount: 5, activeCount: 20, episodeKey: 'growth' } }), active.upserts, { now: now + 17 * engine.HOUR, ownerId: 'guest' });
  assert.equal(unchanged.selected, null);
  const grown = engine.evaluate(baseFacts({ wordCount: 20, review: { dueCount: 10, activeCount: 20, episodeKey: 'growth' } }), unchanged.upserts, { now: now + 17 * engine.HOUR, ownerId: 'guest' });
  assert.equal(grown.selected.slot, 'growth');
  assert.equal(grown.selected.record.severity, 'high');
});

test('one trusted quiz ends inactivity and a later cycle starts with clean counters', () => {
  const { engine, store } = loadSystem();
  store.switchOwner('account-a');
  const now = Date.now();
  const oldAnchor = now - 5 * engine.DAY;
  const first = engine.evaluate(baseFacts({ wordCount: 12, quiz: { lastTrustedQuizAt: oldAnchor } }), store.getAll(), { now, ownerId: 'account-a' });
  store.upsertMany(first.upserts);
  assert.equal(first.selected.record.notificationType, engine.TYPE.QUIZ_INACTIVE);
  assert.equal(first.selected.record.showCount, 1);

  const trustedAt = now + 1000;
  const ended = engine.evaluate(baseFacts({ wordCount: 12, quiz: { lastTrustedQuizAt: trustedAt } }), store.getAll(), { now: trustedAt, ownerId: 'account-a' });
  assert.equal(ended.rules.some((rule) => rule.type === engine.TYPE.QUIZ_INACTIVE), false);
  ended.resolutions.forEach((item) => store.resolve(item.id, item.reason, trustedAt));

  const later = trustedAt + 4 * engine.DAY + 1;
  const nextCycle = engine.evaluate(baseFacts({ wordCount: 12, quiz: { lastTrustedQuizAt: trustedAt } }), store.getAll(), { now: later, ownerId: 'account-a' });
  assert.equal(nextCycle.selected.record.notificationType, engine.TYPE.QUIZ_INACTIVE);
  assert.equal(nextCycle.selected.record.showCount, 1);
  assert.notEqual(nextCycle.selected.record.occurrenceKey, first.selected.record.occurrenceKey);
});

test('gate practice waits 21 hours and resolves when trusted unpracticed count falls below five', () => {
  const { engine } = loadSystem();
  const now = Date.now();
  const facts = baseFacts({
    gatePractice: {
      actionable: true, unpracticedCount: 5, newestLinkedAt: now,
      loadedAt: now, worldId: 'w', rankId: 'r', gateId: 'g', gateLabel: 'بوابة البداية',
    },
  });
  const first = engine.evaluate(facts, [], { now: now + 20 * engine.HOUR, ownerId: 'u' });
  assert.equal(first.selected, null);
  const ready = engine.evaluate(facts, first.upserts, { now: now + 21 * engine.HOUR, ownerId: 'u' });
  assert.equal(ready.selected.record.notificationType, engine.TYPE.GATE_PRACTICE);
  const practiced = engine.evaluate(baseFacts({ gatePractice: { ...facts.gatePractice, unpracticedCount: 4 } }), ready.upserts, { now: now + 22 * engine.HOUR, ownerId: 'u' });
  assert.equal(practiced.resolutions.length, 1);
});

test('local-day streak gate uses Asia/Amman day instead of UTC day', () => {
  const { engine } = loadSystem();
  const nearMidnight = new Date('2026-08-10T22:30:00Z'); // 01:30 on Aug 11 in Amman
  assert.equal(engine.localDateKey(nearMidnight), '2026-08-11');
  const evening = new Date('2026-08-11T21:30:00+03:00').getTime();
  const result = engine.evaluate(baseFacts({
    streak: { count: 6, lastActivityDate: '2026-08-10', freezeCount: 0 },
  }), [], { now: evening, ownerId: 'guest' });
  assert.equal(result.selected.record.notificationType, engine.TYPE.STREAK_RISK);
});

test('inactivity has only the 7-day and 21-day stages', () => {
  const { engine } = loadSystem();
  const anchor = Date.now();
  const early = engine.evaluate(baseFacts({ inactivity: { lastLearningAt: anchor } }), [], { now: anchor + 6 * engine.DAY, ownerId: 'u' });
  assert.equal(early.rules.some((rule) => rule.type === engine.TYPE.INACTIVITY), false);
  const first = engine.evaluate(baseFacts({ inactivity: { lastLearningAt: anchor } }), [], { now: anchor + 7 * engine.DAY, ownerId: 'u' });
  assert.equal(first.selected.slot, 'first');
  const second = engine.evaluate(baseFacts({ inactivity: { lastLearningAt: anchor } }), first.upserts, { now: anchor + 21 * engine.DAY, ownerId: 'u' });
  assert.equal(second.selected.slot, '21d');
  const noThird = engine.evaluate(baseFacts({ inactivity: { lastLearningAt: anchor } }), second.upserts, { now: anchor + 40 * engine.DAY, ownerId: 'u' });
  assert.equal(noThird.selected, null);
});

test('unread regression: opening reads three, list stays, new arrival is one, stale cloud cannot revert', () => {
  const { store } = loadSystem();
  store.switchOwner('account-a');
  const now = Date.now();
  const record = (suffix, at = now) => ({
    ownerId: 'account-a', kind: 'smart', notificationType: `test.${suffix}`,
    occurrenceKey: `occurrence:${suffix}`, status: 'active', visualType: 'info',
    message: `message ${suffix}`, createdAt: at, updatedAt: at,
  });
  store.upsertMany([record('one'), record('two'), record('three')]);
  assert.equal(store.getUnreadCount(), 3);
  const visibleIds = store.getDisplayRecords().map((item) => item.id);
  store.markVisibleRead(visibleIds, now + 10);
  assert.equal(store.getUnreadCount(), 0);
  assert.equal(store.getDisplayRecords().length, 3);
  store.upsert(record('four', now + 20));
  assert.equal(store.getUnreadCount(), 1);

  const stale = store.getAll().filter((item) => visibleIds.includes(item.id)).map((item) => ({
    ...item,
    readAt: 0,
    read: false,
    updatedAt: now + 1000,
  }));
  store.mergeCloud(stale);
  assert.equal(store.getUnreadCount(), 1);
  assert.ok(store.getAll().filter((item) => visibleIds.includes(item.id)).every((item) => item.readAt === now + 10));
});

test('terminal lifecycle and read timestamps win dedupe/cloud merge races', () => {
  const { store } = loadSystem();
  const base = {
    ownerId: 'u', kind: 'smart', notificationType: 'reminder.review.due',
    occurrenceKey: 'review-cycle', status: 'active', visualType: 'warning',
    message: 'راجع', createdAt: 100, updatedAt: 100, readAt: 150,
  };
  const dismissed = { ...base, status: 'dismissed', dismissedAt: 200, updatedAt: 200 };
  const staleActive = { ...base, status: 'active', readAt: 0, updatedAt: 300 };
  const merged = store.mergePair(dismissed, staleActive, 'u');
  assert.equal(merged.status, 'dismissed');
  assert.equal(merged.readAt, 150);
  assert.equal(merged.dismissedAt, 200);
});

test('guest/account namespaces are isolated and accepted migration copies smart lifecycle only', async () => {
  const { store } = loadSystem();
  const writes = [];
  store.registerCloudAdapter({
    async migrateRecords(records) { writes.push(...records); return true; },
    async writeRecords() { return true; },
  });
  store.switchOwner('guest');
  store.upsert({
    ownerId: 'guest', kind: 'smart', notificationType: 'reminder.quiz.inactive',
    occurrenceKey: 'quiz:guest-cycle', status: 'dismissed', visualType: 'info',
    message: 'اختبر', createdAt: 100, updatedAt: 200, dismissedAt: 200,
  });
  store.upsert({
    ownerId: 'guest', kind: 'legacy', notificationType: 'legacy.notice',
    occurrenceKey: 'legacy:toast', status: 'active', visualType: 'info',
    message: 'عملية قديمة', createdAt: 100, updatedAt: 100,
  });
  store.switchOwner('account-a');
  assert.equal(store.getAll().length, 0); // decline/no acceptance means no copy
  assert.equal(await store.migrateGuestToOwner('account-a'), true);
  assert.equal(store.getAll().length, 1);
  assert.equal(store.getAll()[0].kind, 'smart');
  assert.equal(store.getAll()[0].status, 'dismissed');
  assert.equal(store.getAll()[0].ownerId, 'account-a');
  assert.equal(writes.length, 1);
});

test('only one candidate is selected as prominent while every eligible record is active in center', () => {
  const { engine } = loadSystem();
  const now = new Date('2026-08-11T22:30:00+03:00').getTime();
  const result = engine.evaluate(baseFacts({
    wordCount: 20,
    streak: { count: 8, lastActivityDate: '2026-08-10' },
    gateReady: { ready: true, readyAt: now - 1000, worldId: 'w', rankId: 'r', gateId: 'g' },
    inactivity: { lastLearningAt: now - 8 * engine.DAY },
  }), [], { now, ownerId: 'u' });
  assert.equal(result.selected.record.notificationType, engine.TYPE.STREAK_RISK);
  assert.ok(result.upserts.filter((record) => record.status === 'active').length >= 3);
  assert.equal(result.upserts.filter((record) => record.showCount > 0).length, 1);
});

test('review conflict suppresses quiz only after the four-hour gate and quiz can resume as a new occurrence', () => {
  const { engine, store } = loadSystem();
  store.switchOwner('u');
  const now = Date.now();
  const quizAnchor = now - 5 * engine.DAY;
  const quiz = engine.evaluate(baseFacts({ wordCount: 12, quiz: { lastTrustedQuizAt: quizAnchor } }), [], { now, ownerId: 'u' });
  store.upsertMany(quiz.upserts);

  const reviewPending = engine.evaluate(baseFacts({
    wordCount: 12,
    quiz: { lastTrustedQuizAt: quizAnchor },
    review: { dueCount: 5, activeCount: 12, episodeKey: 'conflict' },
  }), store.getAll(), { now: now + 1000, ownerId: 'u' });
  assert.ok(reviewPending.rules.some((rule) => rule.type === engine.TYPE.QUIZ_INACTIVE));
  assert.equal(reviewPending.resolutions.length, 0);
  store.upsertMany(reviewPending.upserts);

  const reviewActive = engine.evaluate(baseFacts({
    wordCount: 12,
    quiz: { lastTrustedQuizAt: quizAnchor },
    review: { dueCount: 5, activeCount: 12, episodeKey: 'conflict' },
  }), store.getAll(), { now: now + 1000 + 4 * engine.HOUR, ownerId: 'u' });
  const suppressed = reviewActive.resolutions.find((item) => item.reason === 'conflict-suppressed');
  assert.ok(suppressed);
  store.resolve(suppressed.id, suppressed.reason, reviewActive.now);
  store.upsertMany(reviewActive.upserts);

  const resumed = engine.evaluate(baseFacts({
    wordCount: 12,
    quiz: { lastTrustedQuizAt: quizAnchor },
    review: { dueCount: 0, activeCount: 12 },
  }), store.getAll(), { now: reviewActive.now + 1000, ownerId: 'u' });
  const resumedQuiz = resumed.upserts.find((record) => record.notificationType === engine.TYPE.QUIZ_INACTIVE && record.status === 'active');
  assert.ok(resumedQuiz);
  assert.match(resumedQuiz.occurrenceKey, /:resume:/);
  assert.equal(resumedQuiz.showCount, 1);
});

test('streak-risk CTA completes a verified activity, marks the local day, preserves streak, and resolves', async () => {
  const now = new Date('2026-08-11T22:20:00+03:00').getTime();
  const today = '2026-08-11';
  const yesterday = '2026-08-10';
  const facts = baseFacts({
    now,
    wordCount: 12,
    streak: { count: 8, lastActivityDate: yesterday, freezeCount: 0 },
    review: { dueCount: 2, activeCount: 12, dueWordKeys: ['due-1', 'due-2'] },
  });
  const harness = loadRuntimeHarness(facts, { dueWordKeys: ['due-1', 'due-2'] });
  const getLaunchedActivity = installProductionNotificationReviewStarter(harness);
  const first = await harness.root.LootLinguaNotificationRuntime.evaluate('manual');
  const risk = first.selected?.record;
  assert.equal(risk?.notificationType, harness.engine.TYPE.STREAK_RISK);
  assert.equal(risk?.cta?.id, 'review-due');

  assert.equal(await harness.root.handleNotificationAction(risk.id), true);
  const launched = getLaunchedActivity();
  assert.equal(launched?.mode, 'scramble');
  assert.equal(launched?.options?.source, 'notification:due');
  assert.match(quizSource, /function isVerifiedQuizMode\(mode\)\s*\{\s*return mode === 'timeAttack' \|\| mode === 'scramble';/);
  assert.match(quizRuntimeSource, /if \(fullyCompleted && commit\.total > 0\) \{[\s\S]*?incrementDailyCountBy\(commit\.total\);[\s\S]*?checkAndUpdateStreak\(\{ learningEvent: true \}\);/);

  const completion = completeTrustedStreakDay({
    today,
    yesterday,
    streakCount: 8,
    answeredCount: launched.options.words.length,
  });
  assert.ok(completion.activityToday > 0);
  assert.equal(completion.lastActivity, today);
  assert.equal(completion.dailyStreak, 9);

  harness.setFacts(baseFacts({
    now: now + 10 * 60 * 1000,
    wordCount: 12,
    streak: { count: completion.dailyStreak, lastActivityDate: completion.lastActivity, freezeCount: 0 },
    review: { dueCount: 0, activeCount: 12 },
  }));
  const after = await harness.root.LootLinguaNotificationRuntime.evaluate('trusted-quiz-completed');
  assert.equal(after.rules.some((rule) => rule.type === harness.engine.TYPE.STREAK_RISK), false);
  assert.equal(harness.store.find(risk.id)?.status, 'resolved');
  assert.equal(harness.store.find(risk.id)?.resolutionReason, 'source-cleared');
});

test('repeated no-op evaluation produces zero notification cloud writes', async () => {
  const now = new Date('2026-08-11T09:00:00+03:00').getTime();
  const chest = {
    hasOpenedBefore: true,
    lastOpenAt: now - 25 * 60 * 60 * 1000,
    readyAt: now - 60 * 60 * 1000,
    ready: true,
    lockedByXp: false,
  };
  const harness = loadRuntimeHarness(baseFacts({ now, chest }));
  const cloudWrites = [];
  harness.store.registerCloudAdapter({
    async writeRecords(records) { cloudWrites.push(records); return true; },
  });
  await harness.root.LootLinguaNotificationRuntime.evaluate('manual');
  assert.equal(cloudWrites.length, 1);
  const synchronized = harness.store.getAll();
  cloudWrites.length = 0;

  harness.setFacts(baseFacts({ now: now + 15 * 60 * 1000, chest }));
  const repeated = await harness.root.LootLinguaNotificationRuntime.evaluate('visible-wake');
  await Promise.resolve();
  assert.equal(repeated.selected, null);
  assert.deepEqual(harness.store.getAll(), synchronized);
  assert.equal(cloudWrites.length, 0);
});

test('one new urgent reminder may override an old low prominent after a meaningful return', async () => {
  const morning = new Date('2026-08-11T08:00:00+03:00').getTime();
  const chest = {
    hasOpenedBefore: true,
    lastOpenAt: morning - 25 * 60 * 60 * 1000,
    readyAt: morning - 60 * 60 * 1000,
    ready: true,
    lockedByXp: false,
  };
  const harness = loadRuntimeHarness(baseFacts({ now: morning, chest }));
  const first = await harness.root.LootLinguaNotificationRuntime.evaluate('manual');
  assert.equal(first.selected?.record.notificationType, harness.engine.TYPE.CHEST_READY);
  assert.equal(harness.toasts.length, 1);

  harness.setFacts(baseFacts({
    now: morning + harness.engine.HOUR,
    chest,
    gateReady: { ready: true, readyAt: morning + 1, worldId: 'early', rankId: 'r', gateId: 'g' },
  }));
  const tooSoon = await harness.root.LootLinguaNotificationRuntime.evaluate('foreground');
  assert.equal(tooSoon.selected, null);
  assert.equal(harness.toasts.length, 1);

  const evening = new Date('2026-08-11T22:30:00+03:00').getTime();
  harness.setFacts(baseFacts({
    now: evening,
    chest,
    streak: { count: 8, lastActivityDate: '2026-08-10', freezeCount: 0 },
  }));
  const urgent = await harness.root.LootLinguaNotificationRuntime.evaluate('foreground');
  assert.equal(urgent.selected?.record.notificationType, harness.engine.TYPE.STREAK_RISK);
  assert.ok(urgent.selected.record.priority >= 90);
  assert.equal(first.upserts.some((record) => record.occurrenceKey === urgent.selected.record.occurrenceKey), false);
  assert.equal(harness.toasts.length, 2);
  assert.equal(harness.root.LootLinguaNotificationRuntime.getProminentState().urgentOverrideClaimed, true);

  harness.setFacts(baseFacts({
    now: evening + 20 * 60 * 1000,
    chest,
    streak: { count: 8, lastActivityDate: '2026-08-10', freezeCount: 0 },
    gateReady: { ready: true, readyAt: evening + 1, worldId: 'w', rankId: 'r', gateId: 'g' },
  }));
  const third = await harness.root.LootLinguaNotificationRuntime.evaluate('foreground');
  assert.equal(third.selected, null);
  assert.equal(harness.toasts.length, 2);

  const continuouslyOpen = loadRuntimeHarness(baseFacts({ now: morning, chest }));
  await continuouslyOpen.root.LootLinguaNotificationRuntime.evaluate('manual');
  continuouslyOpen.setFacts(baseFacts({
    now: evening,
    chest,
    streak: { count: 8, lastActivityDate: '2026-08-10', freezeCount: 0 },
  }));
  const wakeUrgent = await continuouslyOpen.root.LootLinguaNotificationRuntime.evaluate('visible-wake');
  assert.equal(wakeUrgent.selected?.record.notificationType, continuouslyOpen.engine.TYPE.STREAK_RISK);
  assert.equal(continuouslyOpen.toasts.length, 2);
});

test('static integration wires v3 store/cloud/runtime, contextual CTA, trusted gate facts, and no delete rule', () => {
  assert.match(htmlSource, /notification-store\.js/);
  assert.match(htmlSource, /notification-engine\.js/);
  assert.match(htmlSource, /notification-sources\.js/);
  assert.match(htmlSource, /notification-runtime\.js/);
  assert.match(htmlSource, /notification-cloud\.js/);
  assert.match(runtimeSource, /sessionProminentClaimed/);
  assert.match(runtimeSource, /URGENT_REENTRY_PRIORITY = 90/);
  assert.match(runtimeSource, /PROMINENT_REENTRY_DELAY = 2 \* engine\.HOUR/);
  assert.match(coreSource, /markVisibleRead/);
  assert.match(coreSource, /notif-cta-btn/);
  assert.match(cloudSource, /runTransaction/);
  assert.match(rulesSource, /match \/notifications\/\{notificationId\}/);
  assert.match(rulesSource, /Lifecycle evidence is intentionally tombstoned/);
  assert.match(journeyCloudSource, /eligibleEvidenceCount/);
  assert.match(journeyCloudSource, /unlockedByGateId/);
  assert.match(appSource, /function todayStr\(\) \{ return localDateKey\(new Date\(\)\); \}/);
  assert.doesNotMatch(appSource, /function todayStr\(\)[^{]*\{[^}]*toISOString/);
  assert.match(xpSource, /previousLocalDateKey/);
  assert.match(worldsSource, /previousLocalDateKey/);
  assert.match(quizRuntimeSource, /lootlingua:trusted-quiz-completed/);
});
