import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [
  operationsSource,
  cloudSource,
  worldsSource,
  journeyCloudSource,
  quizRuntimeSource,
  xpBatchSource,
  transitionBatchSource,
  indexSource,
  coreSource,
] = await Promise.all([
  readFile(new URL('../js/operation-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/xp-batch.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/srs-transition-batch.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/core.js', import.meta.url), 'utf8'),
]);

function performanceControls({ cores = 4, memory = 4, theme = 'lootlingua', preference } = {}) {
  const source = coreSource.slice(coreSource.indexOf('const PERFORMANCE_MODE_KEY'), coreSource.indexOf('window.showPerformanceModeHelp'));
  const values = new Map(preference ? [['lootlinguaPerformanceMode', preference]] : []);
  const window = { matchMedia: () => ({ matches: false }) };
  const classes = new Set();
  const context = vm.createContext({
    window, navigator: { hardwareConcurrency: cores, deviceMemory: memory, userAgent: 'Android' },
    document: { documentElement: { dataset: { theme }, classList: { contains: () => false } }, getElementById: () => null,
      body: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) } } },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
  });
  vm.runInContext(source, context);
  return { window, values, context, mode: () => vm.runInContext('getPerformanceModePreference()', context),
    frames: (...intervals) => vm.runInContext(`performanceSamples = ${JSON.stringify(intervals)}; updateAutomaticPerformance();`, context) };
}

test('automatic performance starts from hardware and theme rather than a phone user agent', () => {
  assert.equal(performanceControls({ cores: 8, memory: 8 }).mode(), 'ultra');
  assert.equal(performanceControls({ cores: 8, memory: 8, theme: 'glass' }).mode(), 'balanced');
  assert.equal(performanceControls().mode(), 'balanced');
  assert.equal(performanceControls({ cores: 2, memory: 4 }).mode(), 'stable');
  assert.equal(performanceControls({ cores: 2, memory: 2 }).mode(), 'turbo');
  assert.equal(performanceControls({ cores: 0, memory: 0 }).mode(), 'balanced');
});

test('automatic performance learns from sustained frame timing and restores its choice after a manual override', () => {
  const app = performanceControls();
  const smooth = Array(24).fill(16.7);
  const strained = Array(24).fill(33.3);
  app.frames(...smooth.slice(1), 130);
  assert.equal(app.mode(), 'balanced', 'an isolated long frame does not lower the mode');
  app.frames(...smooth);
  assert.equal(app.mode(), 'ultra');
  app.frames(...strained);
  assert.equal(app.mode(), 'balanced');
  app.frames(...smooth);
  app.frames(...smooth);
  assert.equal(app.mode(), 'balanced', 'a quality level that already struggled is not retried in the same session');
  app.window.setPerformanceLevel(3);
  assert.equal(app.mode(), 'turbo');
  app.window.useAutomaticPerformance();
  assert.equal(app.values.has('lootlinguaPerformanceMode'), false);
  assert.equal(app.mode(), 'balanced');
  app.window.__lootlinguaRunnerInputActive = true;
  assert.equal(vm.runInContext('canSamplePerformance()', app.context), false);
  assert.equal(performanceControls({ preference: 'on' }).mode(), 'turbo', 'older saved overrides remain valid');
});

test('operation telemetry records stages and scoped double-clicks join one task', async () => {
  const root = {
    performance: {
      now: () => Number(process.hrtime.bigint() / 1_000_000n),
      mark() {},
      measure() {},
    },
  };
  const context = vm.createContext({
    window: root,
    globalThis: root,
    console,
    Date,
    Map,
    Set,
    Promise,
    String,
    Number,
    Array,
    Object,
    Math,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(operationsSource, context);
  let calls = 0;
  const task = () => new Promise((resolve) => {
    calls += 1;
    setTimeout(() => resolve('saved'), 15);
  });
  const first = root.LootLinguaOperations.runExclusive('move:one', task);
  const second = root.LootLinguaOperations.runExclusive('move:one', task);
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), ['saved', 'saved']);
  assert.equal(calls, 1);

  const trace = root.LootLinguaOperations.startTrace('test-operation');
  trace.stage('validation').count('firestoreReads', 2).count('firestoreWrites').end();
  assert.equal(root.__lootlinguaPerformanceReport.at(-1).operation, 'test-operation');
  assert.equal(root.__lootlinguaPerformanceReport.at(-1).firestoreReads, 2);
  assert.equal(root.__lootlinguaPerformanceReport.at(-1).firestoreWrites, 1);
});

test('private-world source and membership share one deterministic transaction', () => {
  const upsert = cloudSource.slice(
    cloudSource.indexOf('async function upsertUserWordWithSource'),
    cloudSource.indexOf('async function getUserWordSourceSummary')
  );
  const privateSave = cloudSource.slice(
    cloudSource.indexOf('window.saveCustomWorldWordToCloud'),
    cloudSource.indexOf('window.updateCustomWorldWordInCloud')
  );
  assert.match(upsert, /membershipRef[\s\S]*transaction\.set\(membershipRef/);
  assert.match(upsert, /sourceLinked[\s\S]*transaction\.set\(sourceRef/);
  assert.match(upsert, /removePrivateSourceRef[\s\S]*transaction\.delete\(removePrivateSourceRef\)/);
  assert.match(upsert, /removePrivateMembershipRef[\s\S]*transaction\.delete\(removePrivateMembershipRef\)/);
  assert.match(privateSave, /privateWorldMembership: true/);
  assert.doesNotMatch(privateSave, /Math\.random|await setDoc/);
});

test('word move has an immediate UI guard and data-level deterministic identity', () => {
  const block = worldsSource.slice(
    worldsSource.indexOf('let worldManageOperationPromise'),
    worldsSource.indexOf('window.openDeleteCustomWorldModal')
  );
  assert.match(block, /if \(worldManageOperationPromise\) return worldManageOperationPromise/);
  assert.match(block, /button\.disabled = true/);
  assert.match(block, /aria-busy/);
  assert.match(block, /runExclusive/);
  assert.match(worldsSource, /function getWorldManageOperationId[\s\S]*map\(getWorldManageWordKey\)/);
  assert.match(block, /removePrivateWorldId:[\s\S]*memberships-moved-atomically/);
  assert.doesNotMatch(block, /deleteActiveWordFromCloud/);
  assert.doesNotMatch(block, /deleteCustomWorldWordFromCloud/);
});

test('Level Placement overlaps feedback with the write and avoids two forced rereads', () => {
  const uiBlock = worldsSource.slice(
    worldsSource.indexOf('async function submitPublishedLevelPlacementAnswer'),
    worldsSource.indexOf('function appendPublishedLevelPlacementStats')
  );
  const cloudBlock = journeyCloudSource.slice(
    journeyCloudSource.indexOf('async function answerLevelPlacementQuestion'),
    journeyCloudSource.indexOf('async function saveLevelPlacementWords')
  );
  assert.match(uiBlock, /const savePromise = getJourneyCloudApi\(\)\.answerLevelPlacementQuestion/);
  assert.match(uiBlock, /Promise\.all\(\[\s*savePromise/);
  assert.match(uiBlock, /setTimeout\(resolve, reduceMotion \? 100 : 520\)/);
  assert.doesNotMatch(cloudBlock, /getJourney\(world, \{ force: true \}\)/);
  assert.doesNotMatch(cloudBlock, /getLevelPlacementSession\(world, assessment, \{ force: true \}\)/);
  assert.match(cloudBlock, /avoidedForcedReads: 2/);
});

test('Quiz finish paints a saving state and batches transition XP without changing values', async () => {
  assert.match(quizRuntimeSource, /QUIZ_FINISH_TRANSITIONS/);
  assert.match(quizRuntimeSource, /setQuizFinishState\(retrying \? 'saving-result' : 'final-answer-locked'\)/);
  assert.match(quizRuntimeSource, /nextPaint/);
  assert.match(quizRuntimeSource, /awardWordTransitionXPBatch/);
  assert.doesNotMatch(
    quizRuntimeSource.slice(0, quizRuntimeSource.indexOf('function markRemember')),
    /for \([^)]*\) \{[\s\S]*await awardWordTransitionXP\(/
  );
  assert.match(xpBatchSource, /window\.claimXPEventsInCloud/);

  const root = {};
  const context = vm.createContext({
    window: root,
    globalThis: root,
    Date,
    Set,
    Array,
    Number,
    String,
    Math,
    Object,
    getWordMasteryKey: (word) => word.wordKey,
    XP_REWARDS: {
      newToLearning: 2,
      learningToReviewing: 4,
      reviewingToMastered: 8,
      remastered: 3,
    },
    XP_ECONOMY_VERSION: 2,
    awardXPBatch: async (requests) => {
      requests.forEach((request) => { request.metadata.awardStatus = 'awarded'; });
      return { awards: requests.map((request) => request.amount), pendingCount: 0 };
    },
  });
  vm.runInContext(transitionBatchSource, context);
  const entries = [
    {
      word: { wordKey: 'alpha' },
      update: { transition: 'new_learning', state: { earnedTransitions: [] } },
    },
    {
      word: { wordKey: 'beta' },
      update: { transition: 'learning_reviewing', state: { earnedTransitions: [] } },
    },
  ];
  const result = await root.awardWordTransitionXPBatch(entries, 'session-a');
  assert.deepEqual(result.awards, [2, 4]);
  assert.equal(result.total, 6);
});

test('treasure renders after its shell paints and keeps one countdown listener', () => {
  const block = worldsSource.slice(
    worldsSource.indexOf('window.loadTreasureView'),
    worldsSource.indexOf('// ── Starred Words View')
  );
  assert.match(block, /shell-visible/);
  assert.match(block, /nextPaint/);
  assert.match(block, /جارٍ تجهيز الكنز/);
  assert.match(worldsSource, /clearInterval\(window\.__lootCountdownTimer\)/);
});

test('central operation UX is loaded before mutating feature scripts', () => {
  const operationsIndex = indexSource.indexOf('js/operation-runtime.js');
  assert.ok(operationsIndex > 0);
  assert.ok(operationsIndex < indexSource.indexOf('js/worlds.js'));
  assert.match(operationsSource, /'loading'[\s\S]*'long-wait'[\s\S]*'partial-success'[\s\S]*'retryable-error'[\s\S]*'completed'/);
  assert.match(operationsSource, /__lootlinguaPerformanceReport/);
  assert.match(operationsSource, /__lootlinguaPerformanceDebug === true/);
});
