import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [schemaSource, placementSource, cloudSource, worldsSource] = await Promise.all([
  readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/level-placement.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
]);
const root = {};
const context = vm.createContext({
  window: root,
  globalThis: root,
  Error,
  Map,
  Set,
  Object,
  String,
  Number,
  Array,
  Boolean,
  Math,
  Date,
});
vm.runInContext(schemaSource, context);
vm.runInContext(placementSource, context);
const placement = root.LootLinguaLevelPlacement;

function rank(rankId, order, version = 1) {
  return {
    worldId: 'world-a',
    rankId,
    title: rankId,
    status: 'published',
    cefrLevel: 'A1',
    order,
    version,
  };
}

test('rank coverage snapshot records stable IDs, versions, and a deterministic hash', () => {
  const ranks = [rank('rank-b', 2, 4), rank('rank-a', 1, 2)];
  const first = placement.rankSetSnapshot(ranks);
  const second = placement.rankSetSnapshot(ranks.slice().reverse());
  assert.deepEqual(Array.from(first.assessedRankIds), ['rank-a', 'rank-b']);
  assert.deepEqual({ ...first.assessedRankVersions }, { 'rank-a': 2, 'rank-b': 4 });
  assert.equal(first.publishedRankSetHash, second.publishedRankSetHash);
});

test('only genuinely new rank IDs are unassessed', () => {
  const history = placement.rankSetSnapshot([
    rank('rank-a', 1, 1),
    rank('rank-b', 2, 1),
  ]);
  const unassessed = placement.getUnassessedPublishedRanks('A1', [
    rank('rank-a', 1, 2),
    rank('rank-b', 2, 1),
    rank('rank-c', 3, 1),
  ], history);
  assert.deepEqual(unassessed.map((item) => item.rankId), ['rank-c']);
});

test('legacy assessed rank IDs remain covered without inventing old version history', () => {
  const unassessed = placement.getUnassessedPublishedRanks('A1', [
    rank('rank-a', 1, 3),
    rank('rank-new', 2, 1),
  ], { assessedRankIds: ['rank-a'] });
  assert.deepEqual(unassessed.map((item) => item.rankId), ['rank-new']);
});

test('testing new ranks merges them into history without dropping older coverage', () => {
  const previous = placement.rankSetSnapshot([
    rank('rank-a', 1, 1),
    rank('rank-b', 2, 1),
  ]);
  const all = [rank('rank-a', 1, 1), rank('rank-b', 2, 1), rank('rank-c', 3, 2)];
  const merged = placement.mergeRankCoverage(previous, [all[2]], all);
  assert.deepEqual(Array.from(merged.assessedRankIds), ['rank-a', 'rank-b', 'rank-c']);
  assert.equal(merged.assessedRankVersions['rank-a'], 1);
  assert.equal(merged.assessedRankVersions['rank-c'], 2);
  assert.ok(merged.publishedRankSetHash);
});

test('new-ranks session carries tested rank versions while preserving legacy assessed IDs', () => {
  const newRankIds = ['rank-new-a', 'rank-new-b'];
  const selectedWords = newRankIds.map((rankId, index) => ({
    questionId: `question-${index}`,
    rankId,
    gateId: `gate-${index}`,
    contentWordId: `word-${index}`,
    wordKey: `key-${index}`,
    word: `Word ${index}`,
    translation: `Meaning ${index}`,
  }));
  const sample = {
    cefrLevel: 'A1',
    assessmentSeed: 'new-ranks-seed',
    orderedRankIds: newRankIds,
    rankVersions: { 'rank-new-a': 5, 'rank-new-b': 6 },
    publishedRankSetHash: 'new-ranks-hash',
    rankTitles: { 'rank-new-a': 'New A', 'rank-new-b': 'New B' },
    rankFirstGateIds: { 'rank-new-a': 'gate-0', 'rank-new-b': 'gate-1' },
    rankCoverage: {},
    selectedWords,
    selectedContentWordIds: selectedWords.map((item) => item.contentWordId),
    orderedQuestionIds: selectedWords.map((item) => item.questionId),
    adaptiveReserveIdsByRank: {},
  };
  const session = placement.createSessionSeed({
    assessmentId: 'assessment-new-ranks',
    worldId: 'world-a',
    sample,
    assessmentMode: 'new-ranks',
    previousHistory: {
      assessmentId: 'assessment-legacy',
      assessedRankIds: ['rank-old-a', 'rank-old-b'],
    },
  });

  assert.deepEqual({ ...session.rankVersions }, sample.rankVersions);
  assert.deepEqual(Array.from(session.testedRankIds), newRankIds);
  assert.deepEqual(
    new Set(session.assessedRankIds),
    new Set([...newRankIds, 'rank-old-a', 'rank-old-b'])
  );
});

test('new-ranks mode fetches and samples only the unassessed rank IDs', () => {
  const startBlock = cloudSource.slice(
    cloudSource.indexOf('async function startLevelPlacement'),
    cloudSource.indexOf('async function resumeLevelPlacement')
  );
  assert.match(startBlock, /assessmentMode === 'new-ranks'[\s\S]*overview\.unassessedRanks/);
  assert.match(startBlock, /loadPublishedLevelContent\(world, level,[\s\S]*rankIds: testRanks\.map/);
  assert.match(startBlock, /previousHistory: overview\.history/);
});

test('new-ranks session start is single-flight and retries resume the active session', () => {
  const startBlock = cloudSource.slice(
    cloudSource.indexOf('async function startLevelPlacementOnce'),
    cloudSource.indexOf('async function resumeLevelPlacement')
  );
  assert.match(cloudSource, /const levelPlacementStartRequests = new Map\(\)/);
  assert.match(startBlock, /levelPlacementStartRequests\.get\(requestKey\)/);
  assert.match(startBlock, /if \(activeRequest\) return activeRequest/);
  assert.match(startBlock, /levelPlacementStartRequests\.set\(requestKey, request\)/);
  assert.match(startBlock, /levelPlacementStartRequests\.delete\(requestKey\)/);
  assert.match(startBlock, /activeLevelPlacementAssessmentId/);
  assert.match(startBlock, /return makeLevelPlacementBundle\(journey, activeSession\)/);
});

test('new-ranks start keeps one atomic session-plus-parent write', () => {
  const startBlock = cloudSource.slice(
    cloudSource.indexOf('async function startLevelPlacementOnce'),
    cloudSource.indexOf('async function resumeLevelPlacement')
  );
  assert.match(startBlock, /await runTransaction/);
  assert.match(startBlock, /getActiveJourney\(\{ force: true \}\)/);
  assert.match(startBlock, /activeJourney\?\.worldId/);
  assert.match(startBlock, /journey\.status !== 'active'/);
  assert.match(startBlock, /transaction\.set\(sessionRef, sessionCreate\)/);
  assert.match(startBlock, /transaction\.update\(targetJourneyRef, parentUpdate\)/);
  assert.equal((startBlock.match(/transaction\.set\(/g) || []).length, 1);
  assert.equal((startBlock.match(/transaction\.update\(/g) || []).length, 1);
});

test('opening a published page derives new ranks without writing progression', () => {
  const reconcileBlock = cloudSource.slice(
    cloudSource.indexOf('async function reconcileLevelPlacementJourney'),
    cloudSource.indexOf('async function resolveActiveJourneyDestination')
  );
  assert.match(reconcileBlock, /buildLevelPlacementOverviews/);
  assert.doesNotMatch(reconcileBlock, /runTransaction|transaction\.(?:set|update)|serverTimestamp/);
  assert.doesNotMatch(reconcileBlock, /status: 'available'|unlockedRankIds:|unlockedGateIds:/);
});

test('legacy A1 coverage keeps four old ranks assessed and marks only two real additions', () => {
  const oldRankIds = [
    'R4NDhUw0L0gXgSwkbE1O',
    'zH10H8d3GZcdMyy9HRx2',
    'VsRcZlJP3hV2hNL6Thl1',
    'VVSBrZ9o2F4eQUfaCqnf',
  ];
  const newRankIds = ['gw7HL4JwTwKDUpCs2JcF', 'MSvvFKsy1uZYpQ1g2mV8'];
  const ranks = [...oldRankIds, ...newRankIds].map((rankId, index) => rank(rankId, index));
  const gateIds = [
    'fP49BRVyujuU4UqzUoey',
    'gate-old-2',
    'gate-old-3',
    'gate-old-4',
    'RaXFlTd649dE8rd1z7NJ',
    'gate-new-2',
  ];
  const gatesByRank = new Map(ranks.map((item, index) => [
    item.rankId,
    [{ gateId: gateIds[index] }],
  ]));
  const progressByRank = new Map([
    [oldRankIds[0], new Map([
      [gateIds[0], { status: 'learning', placementScore: 0.4 }],
    ])],
  ]);
  const journey = {
    passedCefrLevels: ['A1'],
    activeRankId: oldRankIds[0],
    activeGateId: gateIds[0],
    unlockedRankIds: oldRankIds.slice(),
    unlockedGateIds: gateIds.slice(0, oldRankIds.length),
  };
  const sessions = [{
    assessmentId: 'legacy-a1',
    cefrLevel: 'A1',
    status: 'completed',
    resultApplied: true,
    orderedRankIds: oldRankIds.slice(),
    passedRankIds: oldRankIds.slice(),
    resultUnlockedRankIds: oldRankIds.slice(),
  }];
  const coverage = placement.deriveLegacyRankCoverage({
    cefrLevel: 'A1', journey, sessions, ranks, gatesByRank, progressByRank,
  });
  assert.deepEqual(Array.from(coverage.assessedRankIds), oldRankIds);
  assert.deepEqual(Array.from(coverage.testedRankIds), oldRankIds);
  assert.equal(journey.activeRankId, 'R4NDhUw0L0gXgSwkbE1O');
  assert.equal(journey.activeGateId, 'fP49BRVyujuU4UqzUoey');
  assert.deepEqual(
    placement.getUnassessedPublishedRanks('A1', ranks, coverage).map((item) => item.rankId),
    newRankIds
  );

  const repeated = placement.deriveLegacyRankCoverage({
    cefrLevel: 'A1',
    journey: { ...journey, assessedRankIds: coverage.assessedRankIds },
    sessions,
    ranks,
    gatesByRank,
    progressByRank,
  });
  assert.deepEqual(Array.from(repeated.assessedRankIds), oldRankIds);
  assert.deepEqual(Array.from(repeated.testedRankIds), oldRankIds);
});

test('Published route preserves last-known-good journey and retries reconciliation only', () => {
  const clearBlock = worldsSource.slice(
    worldsSource.indexOf('function clearPublishedJourneyViewState'),
    worldsSource.indexOf('async function readPublishedJourneyContext')
  );
  const readBlock = worldsSource.slice(
    worldsSource.indexOf('async function readPublishedJourneyContext'),
    worldsSource.indexOf('async function readPublishedLevelPlacementOverviews')
  );
  const retryBlock = worldsSource.slice(
    worldsSource.indexOf('async function retryPublishedJourneyReconciliation'),
    worldsSource.indexOf('async function readPublishedLevelPlacementOverviews')
  );
  const routeBlock = worldsSource.slice(
    worldsSource.indexOf('async function loadPublishedRouteData'),
    worldsSource.indexOf('window.loadPublishedContentRoute')
  );
  assert.match(clearBlock, /if \(!options\?\.preserveJourney\)/);
  assert.match(readBlock, /fallbackJourney/);
  assert.match(readBlock, /journey: fallbackJourney/);
  assert.match(routeBlock, /clearPublishedJourneyViewState\(\{ preserveJourney \}\)/);
  assert.match(retryBlock, /reconcileLevelPlacementJourney/);
  assert.doesNotMatch(retryBlock, /loadPublishedRouteData|openPublishedWorld/);
  assert.match(worldsSource, /تعذر تحديث تقدم العالم\. لم يتم تغيير تقدمك\./);
});

test('failed explicit progression is classified without mutating cached Journey first', () => {
  const applyBlock = cloudSource.slice(
    cloudSource.indexOf('async function applyLevelPlacementResult'),
    cloudSource.indexOf('async function answerLevelPlacementQuestion')
  );
  const transactionIndex = applyBlock.indexOf('await runTransaction');
  const resetIndex = applyBlock.indexOf('resetCache');
  assert.ok(transactionIndex >= 0 && resetIndex > transactionIndex);
  assert.doesNotMatch(applyBlock.slice(0, transactionIndex), /cache\.journeys\.set|cache\.active\s*=/);
  assert.match(applyBlock, /journeyOperationError\(error, 'apply-level-placement-result'/);
  assert.match(applyBlock, /logJourneyProgressionCommit/);
  assert.match(cloudSource, /__LOOTLINGUA_JOURNEY_DIAGNOSTICS__/);
});

test('Published UI labels and counts only the new ranks', () => {
  assert.match(worldsSource, /'new-content': 'اختبار الرتب الجديدة'/);
  assert.match(worldsSource, /const newRankCount = overview\?\.unassessedRankIds\?\.length \|\| 0/);
  assert.match(worldsSource, /published-level-new-count/);
});

test('Published UI reports new-ranks start failures precisely and preserves the visible journey', () => {
  const beginBlock = worldsSource.slice(
    worldsSource.indexOf('async function beginPublishedLevelPlacement'),
    worldsSource.indexOf('async function maybeRenderPublishedLevelPlacementResume')
  );
  assert.match(worldsSource, /تعذر بدء اختبار الرتب الجديدة\. لم يتم تغيير تقدمك\./);
  assert.match(beginBlock, /publishedContentState\.levelPlacementPending = true/);
  assert.match(beginBlock, /if \(publishedContentState\.levelPlacementPending\) return null/);
  assert.match(beginBlock, /start-new-ranks-placement/);
  assert.doesNotMatch(beginBlock, /publishedContentState\.(?:journey|activeJourney)\s*=\s*null/);
});

test('continue routing opens the first pending new rank CTA without writing progress', () => {
  const routeBlock = worldsSource.slice(
    worldsSource.indexOf('async function openPublishedJourneyDestination'),
    worldsSource.indexOf('async function startOrResumePublishedJourney')
  );
  const rankBlock = worldsSource.slice(
    worldsSource.indexOf('function renderPublishedGates'),
    worldsSource.indexOf('function publishedDetailText')
  );
  const continueBlock = worldsSource.slice(
    worldsSource.indexOf('async function startOrResumePublishedJourney'),
    worldsSource.indexOf('function makePublishedJourneyStartPanel')
  );
  assert.match(routeBlock, /destination\.type === 'new-rank-assessment'/);
  assert.match(routeBlock, /openPublishedRank\(worldId, destination\.rank\.rankId\)/);
  assert.doesNotMatch(routeBlock, /startLevelPlacement|runTransaction|\.update\(/);
  assert.match(continueBlock, /const sameActiveWorld = activeJourney/);
  assert.match(continueBlock, /const resumed = sameActiveWorld[\s\S]*publishedContentState\.journey \|\| activeJourney/);
  assert.match(rankBlock, /unassessedRankIds/);
  assert.match(rankBlock, /اختبر الرتب الجديدة/);
  assert.match(rankBlock, /beginPublishedLevelPlacement\(world, level\)/);
  assert.doesNotMatch(rankBlock, /startJourney|loadGate|runTransaction|\.update\(/);
});

test('applying new-rank results does not load words, start a quiz, or award XP', () => {
  const applyBlock = cloudSource.slice(
    cloudSource.indexOf('async function applyLevelPlacementResult'),
    cloudSource.indexOf('async function answerLevelPlacementQuestion')
  );
  assert.match(applyBlock, /resolveLevelPlacementResultDestination/);
  assert.match(applyBlock, /clearedBy: 'level-placement'/);
  assert.doesNotMatch(applyBlock, /loadGate|linkPublishedWord|startQuiz|awardXP|markDailyQuest/);
});
