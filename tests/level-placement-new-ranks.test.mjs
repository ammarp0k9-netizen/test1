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

test('a new rank and a changed assessed rank version are both unassessed', () => {
  const history = placement.rankSetSnapshot([
    rank('rank-a', 1, 1),
    rank('rank-b', 2, 1),
  ]);
  const unassessed = placement.getUnassessedPublishedRanks('A1', [
    rank('rank-a', 1, 2),
    rank('rank-b', 2, 1),
    rank('rank-c', 3, 1),
  ], history);
  assert.deepEqual(unassessed.map((item) => item.rankId), ['rank-a', 'rank-c']);
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

test('new-ranks mode fetches and samples only the unassessed rank IDs', () => {
  const startBlock = cloudSource.slice(
    cloudSource.indexOf('async function startLevelPlacement'),
    cloudSource.indexOf('async function resumeLevelPlacement')
  );
  assert.match(startBlock, /assessmentMode === 'new-ranks'[\s\S]*overview\.unassessedRanks/);
  assert.match(startBlock, /loadPublishedLevelContent\(world, level,[\s\S]*rankIds: testRanks\.map/);
  assert.match(startBlock, /previousHistory: overview\.history/);
});

test('new published ranks become naturally available and clear completed-current-content', () => {
  const reconcileBlock = cloudSource.slice(
    cloudSource.indexOf('async function reconcileLevelPlacementJourney'),
    cloudSource.indexOf('async function resolveActiveJourneyDestination')
  );
  assert.match(reconcileBlock, /unlockedRankIds:[\s\S]*rankId/);
  assert.match(reconcileBlock, /unlockedGateIds:[\s\S]*gateId/);
  assert.match(reconcileBlock, /contentJourneyStatus: 'in-progress'/);
  assert.match(reconcileBlock, /status: 'available'/);
});

test('Published UI labels and counts only the new ranks', () => {
  assert.match(worldsSource, /'new-content': 'اختبار الرتب الجديدة'/);
  assert.match(worldsSource, /const newRankCount = overview\?\.unassessedRankIds\?\.length \|\| 0/);
  assert.match(worldsSource, /published-level-new-count/);
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
