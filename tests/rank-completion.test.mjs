import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [journeySource, cloudSource, worldsSource, rulesSource] = await Promise.all([
  readFile(new URL('../js/journey.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
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
  { rankId: 'rank-a', order: 0, version: 2, status: 'published' },
  { rankId: 'rank-b', order: 1, version: 1, status: 'published' },
];
const gates = [
  { gateId: 'gate-a', order: 0, status: 'published' },
  { gateId: 'gate-b', order: 1, status: 'published' },
];
const baseJourney = {
  activeRankId: 'rank-b',
  activeGateId: 'gate-c',
  unlockedRankIds: ['rank-a', 'rank-b'],
  unlockedGateIds: ['gate-a', 'gate-b', 'gate-c'],
  completedRankIds: ['rank-a'],
  rankCompletionVersions: { 'rank-a': 2 },
};

function cleared(keys, overrides = {}) {
  return {
    status: 'cleared',
    loadedAt: 1,
    loadedWordKeys: keys,
    loadedContentWordIds: keys,
    ...overrides,
  };
}

test('Rank Completed needs cleared Gates but not Crowns or empty SRS gaps', () => {
  const progress = new Map([
    ['gate-a', cleared(['one'])],
    ['gate-b', cleared(['two'])],
  ]);
  const view = journey.deriveRankProgressView({
    rank: ranks[0],
    gates,
    progressByGate: progress,
    journey: { ...baseJourney, completedRankIds: [], rankCompletionVersions: {} },
    ranks,
    masteryByWordKey: new Map([
      ['one', { mastery_status: 'Mastered', mastered_once: true }],
      ['two', { mastery_status: 'Reviewing', mastered_once: false }],
    ]),
  });
  assert.equal(view.completed, true);
  assert.equal(view.mastered, false);
  assert.equal(view.masteredGateCount, 1);
});

test('Rank Mastered is derived only after every eligible cleared Gate has a Crown', () => {
  const view = journey.deriveRankProgressView({
    rank: ranks[0],
    gates,
    progressByGate: new Map([
      ['gate-a', cleared(['one'])],
      ['gate-b', cleared(['two'])],
    ]),
    journey: baseJourney,
    ranks,
    masteryByWordKey: new Map([
      ['one', { mastery_status: 'Reviewing', mastered_once: true }],
      ['two', { mastery_status: 'Mastered', mastered_once: true }],
    ]),
  });
  assert.equal(view.completed, true);
  assert.equal(view.mastered, true);
  assert.equal(view.masteredGateCount, 2);
});

test('Level Placement completion never fabricates Rank Mastery', () => {
  const view = journey.deriveRankProgressView({
    rank: ranks[0],
    gates,
    progressByGate: new Map([
      ['gate-a', {
        status: 'cleared',
        clearedBy: 'level-placement',
        placementClearedWithoutLoad: true,
      }],
      ['gate-b', {
        status: 'cleared',
        clearedBy: 'level-placement',
        placementClearedWithoutLoad: true,
      }],
    ]),
    journey: {
      ...baseJourney,
      completedRankIds: ['rank-a'],
      levelPlacementPassedRankIds: ['rank-a'],
    },
    ranks,
    masteryByWordKey: new Map(),
    placementHistory: { assessedRankVersions: { 'rank-a': 2 } },
  });
  assert.equal(view.completed, true);
  assert.equal(view.placementCompletion, true);
  assert.equal(view.mastered, false);
});

test('a later Rank version keeps historical completion and exposes new content', () => {
  const changedRank = { ...ranks[0], version: 3 };
  const view = journey.deriveRankProgressView({
    rank: changedRank,
    gates: [...gates, { gateId: 'gate-new', order: 2, status: 'published' }],
    progressByGate: new Map(),
    journey: baseJourney,
    ranks: [changedRank, ranks[1]],
    masteryByWordKey: new Map(),
  });
  assert.equal(view.completed, true);
  assert.equal(view.hasNewContent, true);
  assert.equal(view.completionVersion, 2);
  assert.equal(view.currentVersion, 3);
});

test('legacy progress derives earlier Rank completion without a render-time write', () => {
  const view = journey.deriveRankProgressView({
    rank: ranks[0],
    gates,
    progressByGate: new Map(),
    journey: {
      activeRankId: 'rank-b',
      activeGateId: 'gate-c',
      unlockedRankIds: ['rank-a', 'rank-b'],
      unlockedGateIds: ['gate-a', 'gate-b', 'gate-c'],
    },
    ranks,
    masteryByWordKey: new Map(),
  });
  assert.equal(view.completed, true);
  assert.equal(view.legacyCompletion, true);
  assert.equal(view.storedCompletion, false);
});

test('Gate Clear owns the atomic Rank completion commit and the CTA returns to the resolver', () => {
  const finalize = cloudSource.slice(
    cloudSource.indexOf('async function finalizeGateClearAttempt'),
    cloudSource.indexOf('async function answerGateClearQuestion')
  );
  const resultUi = worldsSource.slice(
    worldsSource.indexOf('function renderPublishedGateClearResult'),
    worldsSource.indexOf('async function maybeRenderPublishedGateClearResume')
  );
  assert.match(finalize, /completedRankIds/);
  assert.match(finalize, /rankCompletionVersions/);
  assert.match(finalize, /contentJourneyStatus: 'completed-current-content'/);
  assert.match(resultUi, /openPublishedJourneyDestination/);
  assert.doesNotMatch(resultUi, /awardXP|claimXP|localStorage/);
});

test('post-commit decoration failure cannot report a successful Gate Clear as failed', () => {
  const answer = cloudSource.slice(
    cloudSource.indexOf('async function answerGateClearQuestion'),
    cloudSource.indexOf('async function abandonGateClearAttempt')
  );
  assert.match(answer, /const result = await finalizeGateClearAttempt/);
  assert.match(answer, /Gate Clear committed; result decoration failed/);
  assert.match(answer, /return \{ attempt: nextSession, words: \[\], question: null, result \}/);
});

test('Rank reward is deliberately separate from completion and no new callable exists', () => {
  const finalize = cloudSource.slice(
    cloudSource.indexOf('async function finalizeGateClearAttempt'),
    cloudSource.indexOf('async function answerGateClearQuestion')
  );
  assert.doesNotMatch(finalize, /awardXP|claimXP|httpsCallable|getFunctions|reward/);
  assert.match(rulesSource, /validRankCompletionAppend/);
  assert.doesNotMatch(rulesSource, /rank_completion_reward|rank_completed_xp/);
});
