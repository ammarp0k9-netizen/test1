import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [journeySource, cloudSource, worldsSource, rulesSource, functionsSource, packageSource, functionEntries] = await Promise.all([
  readFile(new URL('../js/journey.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readdir(new URL('../functions', import.meta.url)),
]);

const root = {};
vm.runInContext(journeySource, vm.createContext({
  window: root,
  globalThis: root,
  encodeURIComponent,
  Error,
  Map,
  Set,
  Object,
  String,
  Number,
  Array,
  Boolean,
}));
const journey = root.LootLinguaJourney;

const ranks = [
  { worldId: 'world-a', rankId: 'rank-a', order: 0, version: 1, status: 'published' },
  { worldId: 'world-a', rankId: 'rank-b', order: 1, version: 2, status: 'published' },
];
const gatesByRank = new Map([
  ['rank-a', [{ worldId: 'world-a', rankId: 'rank-a', gateId: 'gate-a', order: 0, status: 'published' }]],
  ['rank-b', [{ worldId: 'world-a', rankId: 'rank-b', gateId: 'gate-b', order: 0, status: 'published' }]],
]);

function gateProgress(wordKey, mastered, overrides = {}) {
  return {
    status: 'cleared',
    loadedAt: 1,
    loadedWordKeys: [wordKey],
    loadedContentWordIds: [wordKey],
    ...overrides,
    mastery: mastered,
  };
}

function progressGraph(overrides = {}) {
  return new Map([
    ['rank-a', new Map([['gate-a', gateProgress('one', false)]])],
    ['rank-b', new Map([['gate-b', gateProgress('two', false, overrides)]])],
  ]);
}

const completedJourney = {
  worldId: 'world-a',
  activeRankId: 'rank-b',
  activeGateId: 'gate-b',
  unlockedRankIds: ['rank-a', 'rank-b'],
  unlockedGateIds: ['gate-a', 'gate-b'],
  completedRankIds: ['rank-a', 'rank-b'],
  rankCompletionVersions: { 'rank-a': 1, 'rank-b': 2 },
  contentJourneyStatus: 'completed-current-content',
};

test('World Completed requires all current Ranks but not Gate Crowns', () => {
  const view = journey.deriveWorldProgressView({
    worldId: 'world-a',
    journey: completedJourney,
    ranks,
    gatesByRank,
    progressByRank: progressGraph(),
    masteryByWordKey: new Map([
      ['one', { mastery_status: 'Mastered', mastered_once: true }],
      ['two', { mastery_status: 'Reviewing', mastered_once: false }],
    ]),
  });
  assert.equal(view.completed, true);
  assert.equal(view.currentContentCompleted, true);
  assert.equal(view.mastered, false);
  assert.equal(view.completedRankCount, 2);
  assert.equal(view.legacyCompleted, true);
});

test('World Mastered is derived only after every eligible Rank is mastered', () => {
  const view = journey.deriveWorldProgressView({
    worldId: 'world-a',
    journey: completedJourney,
    ranks,
    gatesByRank,
    progressByRank: progressGraph(),
    masteryByWordKey: new Map([
      ['one', { mastery_status: 'Mastered', mastered_once: true }],
      ['two', { mastery_status: 'Mastered', mastered_once: true }],
    ]),
  });
  assert.equal(view.completed, true);
  assert.equal(view.mastered, true);
  assert.equal(view.masteredRankCount, 2);
});

test('Level Placement can complete a World without fabricating mastery', () => {
  const placementProgress = new Map([
    ['rank-a', new Map([['gate-a', { status: 'cleared', clearedBy: 'level-placement', placementClearedWithoutLoad: true }]])],
    ['rank-b', new Map([['gate-b', { status: 'cleared', clearedBy: 'level-placement', placementClearedWithoutLoad: true }]])],
  ]);
  const view = journey.deriveWorldProgressView({
    worldId: 'world-a',
    journey: {
      ...completedJourney,
      completedRankIds: [],
      levelPlacementPassedRankIds: ['rank-a', 'rank-b'],
    },
    ranks,
    gatesByRank,
    progressByRank: placementProgress,
    masteryByWordKey: new Map(),
  });
  assert.equal(view.completed, true);
  assert.equal(view.mastered, false);
});

test('new published Rank preserves the historical achievement and exposes new content', () => {
  const snapshot = journey.worldCompletionSnapshot(ranks);
  const achievement = journey.createWorldCompletionAchievement({
    worldId: 'world-a',
    snapshot,
    completedBy: 'gate-clear',
    completedAt: 123,
  });
  const nextRanks = [...ranks, {
    worldId: 'world-a', rankId: 'rank-c', order: 2, version: 1, status: 'published',
  }];
  const view = journey.deriveWorldProgressView({
    worldId: 'world-a',
    journey: { ...completedJourney, worldCompletion: achievement },
    ranks: nextRanks,
    gatesByRank: new Map([
      ...gatesByRank,
      ['rank-c', [{ worldId: 'world-a', rankId: 'rank-c', gateId: 'gate-c', status: 'published' }]],
    ]),
    progressByRank: progressGraph(),
    masteryByWordKey: new Map(),
  });
  assert.equal(view.completed, true);
  assert.equal(view.currentContentCompleted, false);
  assert.equal(view.hasNewContent, true);
  assert.equal(view.completionId, achievement.completionId);
});

test('finishing later content clears the new-content notice without replacing history', () => {
  const achievement = journey.createWorldCompletionAchievement({
    worldId: 'world-a', ranks, completedBy: 'gate-clear', completedAt: 123,
  });
  const nextRank = {
    worldId: 'world-a', rankId: 'rank-c', order: 2, version: 1, status: 'published',
  };
  const view = journey.deriveWorldProgressView({
    worldId: 'world-a',
    journey: {
      ...completedJourney,
      completedRankIds: ['rank-a', 'rank-b', 'rank-c'],
      rankCompletionVersions: { 'rank-a': 1, 'rank-b': 2, 'rank-c': 1 },
      worldCompletion: achievement,
    },
    ranks: [...ranks, nextRank],
    gatesByRank: new Map([...gatesByRank, ['rank-c', []]]),
    progressByRank: progressGraph(),
    masteryByWordKey: new Map(),
  });
  assert.equal(view.completed, true);
  assert.equal(view.currentContentCompleted, true);
  assert.equal(view.hasNewContent, false);
  assert.equal(view.completionId, achievement.completionId);
});

test('World derivation is linear and read-only for the maximum rules ledger size', () => {
  const largeRanks = Array.from({ length: 500 }, (_, index) => ({
    worldId: 'large-world',
    rankId: `rank-${index}`,
    order: index,
    version: 1,
    status: 'published',
  }));
  const rankIds = largeRanks.map((rank) => rank.rankId);
  const view = journey.deriveWorldProgressView({
    worldId: 'large-world',
    journey: {
      worldId: 'large-world',
      activeRankId: 'rank-499',
      completedRankIds: rankIds,
      rankCompletionVersions: Object.fromEntries(rankIds.map((id) => [id, 1])),
      contentJourneyStatus: 'completed-current-content',
    },
    ranks: largeRanks,
    gatesByRank: new Map(),
    progressByRank: new Map(),
    masteryByWordKey: new Map(),
  });
  assert.equal(view.completedRankCount, 500);
  assert.equal(view.currentContentCompleted, true);

  const deriveSource = journeySource.slice(
    journeySource.indexOf('function deriveWorldProgressView'),
    journeySource.indexOf('function canTransitionGateProgress')
  );
  const renderSource = worldsSource.slice(
    worldsSource.indexOf('function makePublishedJourneyPanel'),
    worldsSource.indexOf('function makeActiveJourneyBanner')
  );
  assert.doesNotMatch(deriveSource + renderSource, /setDoc|updateDoc|runTransaction|serverTimestamp/);
});

test('World completion IDs are deterministic and the achievement is one immutable field', () => {
  const first = journey.createWorldCompletionAchievement({
    worldId: 'world-a', ranks, completedBy: 'gate-clear', completedAt: 1,
  });
  const retry = journey.createWorldCompletionAchievement({
    worldId: 'world-a', ranks: [...ranks].reverse(), completedBy: 'gate-clear', completedAt: 2,
  });
  assert.equal(first.completionId, retry.completionId);
  assert.deepEqual(first.requiredRankIds, ['rank-a', 'rank-b']);
  assert.equal(first.version, 1);
});

test('Gate Clear and Level Placement own the atomic World completion writes', () => {
  const gateFinalize = cloudSource.slice(
    cloudSource.indexOf('async function finalizeGateClearAttempt'),
    cloudSource.indexOf('async function answerGateClearQuestion')
  );
  const placementApply = cloudSource.slice(
    cloudSource.indexOf('async function applyPlacementOutcome'),
    cloudSource.indexOf('async function applyLevelPlacementResult')
  );
  assert.match(gateFinalize, /createWorldCompletionAchievement/);
  assert.match(gateFinalize, /worldCompletionRecorded/);
  assert.match(placementApply, /createWorldCompletionAchievement/);
  assert.match(gateFinalize, /completedCurrentContent \? 'world-completed' : 'gate-clear'/);
  assert.match(placementApply, /savedSession\.completedCurrentContent[\s\S]*'world-completed'/);
  assert.match(rulesSource, /validWorldCompletionAppend/);
  assert.match(rulesSource, /achievement\.completedAt == request\.time/);
  assert.doesNotMatch(gateFinalize, /awardXP|claimXP|httpsCallable|getFunctions/);
  assert.doesNotMatch(placementApply, /awardXP|claimXP|httpsCallable|getFunctions/);
});

test('World completion CTA remains routed through the central Journey resolver', () => {
  const resultUi = worldsSource.slice(
    worldsSource.indexOf('function renderPublishedGateClearResult'),
    worldsSource.indexOf('async function maybeRenderPublishedGateClearResume')
  );
  assert.match(resultUi, /openPublishedJourneyDestination/);
  assert.doesNotMatch(resultUi, /activeRankId\s*=|activeGateId\s*=/);
});

test('Worlds root classifies the shared terminal destination without a fake resume CTA', () => {
  const rootLoader = worldsSource.slice(
    worldsSource.indexOf('async function loadPublishedWorlds'),
    worldsSource.indexOf('window.showPublishedWorldsTab')
  );
  const banner = worldsSource.slice(
    worldsSource.indexOf('function makeActiveJourneyBanner'),
    worldsSource.indexOf('async function beginPublishedGateClear')
  );
  assert.match(rootLoader, /readPublishedAccountJourneyDestination/);
  assert.match(rootLoader, /accountDestination\.classification === 'actionable-journey'/);
  assert.match(banner, /destination\.classification === 'world-completed'/);
  assert.match(banner, /استكشف العوالم/);
  assert.match(banner, /completed \? 'استكشف العوالم' : 'متابعة'/);
});

test('the phase adds no Function export, callable, or trigger', () => {
  const exportsBefore = [...functionsSource.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]);
  assert.deepEqual(exportsBefore.sort(), [
    'bulkUpdateContentWords', 'deleteContentGate', 'deleteContentRank', 'deleteContentWord',
    'deleteContentWorld', 'duplicateContentGate', 'duplicateContentRank', 'duplicateContentWord',
    'moveContentGate', 'moveContentWord',
  ].sort());
  assert.doesNotMatch(cloudSource, /worldCompletion.*httpsCallable|onCall\(|onCreate\(|onUpdate\(/s);
  assert.equal(functionEntries.some((name) => /world-completion|test-clock|notification/i.test(name)), false);
  const scripts = Object.values(JSON.parse(packageSource).scripts || {});
  assert.equal(scripts.some((command) => /deploy[^\n]*functions|--only[^\n]*functions/i.test(command)), false);
});
