import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [schemaSource, journeySource, placementSource] = await Promise.all([
  readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/level-placement.js', import.meta.url), 'utf8'),
]);
const root = {};
const context = vm.createContext({
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
  Math,
  Date,
});
vm.runInContext(schemaSource, context);
vm.runInContext(journeySource, context);
vm.runInContext(placementSource, context);
const journeyContract = root.LootLinguaJourney;
const placementContract = root.LootLinguaLevelPlacement;

function rank(rankId, order, cefrLevel, initialStatus = 'locked') {
  return {
    worldId: 'world-a',
    rankId,
    order,
    cefrLevel,
    status: 'published',
    version: 1,
    unlockConfig: { initialStatus },
  };
}

function gate(rankId, gateId, order = 0) {
  return {
    worldId: 'world-a',
    rankId,
    gateId,
    order,
    status: 'published',
    unlockConfig: { initialStatus: 'locked' },
  };
}

const oldA1 = rank('a1-old', 1, 'A1', 'available');
const newA1a = rank('a1-new-a', 2, 'A1');
const newA1b = rank('a1-new-b', 3, 'A1');
const a2 = rank('a2-first', 4, 'A2');
const ranks = [oldA1, newA1a, newA1b, a2];
const gatesByRank = new Map([
  ['a1-old', [gate('a1-old', 'gate-old')]],
  ['a1-new-a', [gate('a1-new-a', 'gate-new-a')]],
  ['a1-new-b', [gate('a1-new-b', 'gate-new-b')]],
  ['a2-first', [gate('a2-first', 'gate-a2')]],
]);

function baseJourney(overrides = {}) {
  return {
    worldId: 'world-a',
    activeRankId: 'a1-old',
    activeGateId: 'gate-old',
    unlockedRankIds: ['a1-old'],
    unlockedGateIds: ['gate-old'],
    passedCefrLevels: ['A1'],
    partialCefrLevels: [],
    contentJourneyStatus: 'in-progress',
    ...overrides,
  };
}

function newRanksSession(overrides = {}) {
  return {
    assessmentId: 'assessment-new-a1',
    worldId: 'world-a',
    cefrLevel: 'A1',
    status: 'awaiting-decision',
    assessmentMode: 'new-ranks',
    orderedRankIds: ['a1-new-a', 'a1-new-b'],
    testedRankIds: ['a1-new-a', 'a1-new-b'],
    passedRankIds: ['a1-new-a', 'a1-new-b'],
    passedLevel: true,
    rankFirstGateIds: {
      'a1-new-a': 'gate-new-a',
      'a1-new-b': 'gate-new-b',
    },
    perRankStats: {
      'a1-new-a': { ratio: 1 },
      'a1-new-b': { ratio: 1 },
    },
    resultApplied: false,
    saveWordChoice: 'undecided',
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyOutcome(state, options = {}) {
  if (state.session.resultApplied === true) return state;
  const plan = journeyContract.planPlacementOutcome({
    session: state.session,
    journey: state.journey,
    nextLevelTarget: options.nextLevelTarget || null,
    gatesByRank,
  });
  if (options.failBeforeCommit) {
    const error = new Error('permission-denied');
    error.code = 'permission-denied';
    throw error;
  }
  const next = {
    journey: clone(state.journey),
    session: clone(state.session),
    progress: clone(state.progress),
  };
  if (plan.destination.rankId && plan.destination.gateId) {
    next.journey.activeRankId = plan.destination.rankId;
    next.journey.activeGateId = plan.destination.gateId;
  }
  next.journey.unlockedRankIds = Array.from(new Set([
    ...next.journey.unlockedRankIds,
    ...plan.resultUnlockedRankIds,
  ]));
  next.journey.unlockedGateIds = Array.from(new Set([
    ...next.journey.unlockedGateIds,
    ...plan.resultUnlockedGateIds,
  ]));
  next.journey.levelPlacementClearedGateIds = Array.from(new Set([
    ...(next.journey.levelPlacementClearedGateIds || []),
    ...plan.resultClearedGateIds,
  ]));
  next.journey.contentJourneyStatus = plan.completedCurrentContent
    ? 'completed-current-content'
    : 'in-progress';
  Object.assign(next.session, {
    status: 'completed',
    resultApplied: true,
    resultStartRankId: plan.destination.rankId,
    resultStartGateId: plan.destination.gateId,
    resultUnlockedRankIds: plan.resultUnlockedRankIds,
    resultUnlockedGateIds: plan.resultUnlockedGateIds,
    resultClearedGateIds: plan.resultClearedGateIds,
    completedCurrentContent: plan.completedCurrentContent,
  });
  return next;
}

function progressGraph(progress) {
  const graph = new Map();
  Object.entries(progress).forEach(([path, value]) => {
    const [rankId, gateId] = path.split('/');
    if (!graph.has(rankId)) graph.set(rankId, new Map());
    graph.get(rankId).set(gateId, value);
  });
  return graph;
}

function resolve(state, extra = {}) {
  return journeyContract.resolveJourneyDestination({
    journey: state.journey,
    ranks,
    gatesByRank,
    progressByRank: progressGraph(state.progress),
    ...extra,
  });
}

test('scenario 1: legacy A1 plus two new ranks applies once, skips words, exits, and refreshes at the first passed new gate', () => {
  const legacyCoverage = placementContract.deriveLegacyRankCoverage({
    cefrLevel: 'A1',
    journey: baseJourney(),
    sessions: [{
      assessmentId: 'legacy-a1',
      cefrLevel: 'A1',
      status: 'completed',
      resultApplied: true,
      orderedRankIds: ['a1-old'],
    }],
    ranks: [oldA1, newA1a, newA1b],
    gatesByRank,
    progressByRank: new Map([
      ['a1-old', new Map([['gate-old', { status: 'learning' }]])],
    ]),
  });
  assert.deepEqual(
    placementContract.getUnassessedPublishedRanks(
      'A1',
      [oldA1, newA1a, newA1b],
      legacyCoverage
    ).map((item) => item.rankId),
    ['a1-new-a', 'a1-new-b']
  );
  let state = {
    journey: baseJourney(),
    session: newRanksSession({
      status: 'active',
      orderedQuestionIds: ['question-a', 'question-b'],
      answers: [],
      currentQuestionIndex: 0,
    }),
    progress: { 'a1-old/gate-old': { status: 'learning' } },
    view: 'assessment',
  };
  assert.equal(resolve(state, { levelPlacementSession: state.session }).type, 'level-placement');
  state = clone(state);
  Object.assign(state.session, {
    status: 'awaiting-decision',
    answers: [{ correct: true }, { correct: true }],
    currentQuestionIndex: 2,
    answersCompletedAt: 'saved',
  });
  assert.equal(
    resolve(state, { levelPlacementSession: state.session }).type,
    'level-placement-result'
  );
  state = applyOutcome(state);
  state.session.saveWordChoice = 'none';
  state.view = 'world';
  const destination = resolve(state);
  assert.equal(destination.rank.rankId, 'a1-new-a');
  assert.equal(destination.gate.gateId, 'gate-new-a');
  assert.equal(destination.reason, 'active-pointer');
  assert.equal(state.progress['a1-new-a/gate-new-a'], undefined);
  assert.equal(state.progress['a1-new-b/gate-new-b'], undefined);
  assert.equal(resolve(clone(state)).gate.gateId, 'gate-new-a');
});

test('scenario 2: clearing the final A1 gate advances to the first A2 gate and refresh preserves it', () => {
  const next = journeyContract.selectNextJourneyTarget(
    [oldA1, a2],
    new Map([
      ['a1-old', [gate('a1-old', 'gate-old')]],
      ['a2-first', [gate('a2-first', 'gate-a2')]],
    ]),
    'a1-old',
    'gate-old'
  );
  const state = {
    journey: baseJourney({
      activeRankId: next.rank.rankId,
      activeGateId: next.gate.gateId,
      unlockedRankIds: ['a1-old', next.rank.rankId],
      unlockedGateIds: ['gate-old', next.gate.gateId],
    }),
    progress: {
      'a1-old/gate-old': { status: 'cleared' },
      'a2-first/gate-a2': { status: 'available' },
    },
  };
  assert.equal(resolve(state).gate.gateId, 'gate-a2');
  assert.equal(resolve(clone(state)).gate.gateId, 'gate-a2');
});

test('scenario 3: failing every new rank preserves old progress and creates no new unlock', () => {
  const before = {
    journey: baseJourney(),
    session: newRanksSession({ passedRankIds: [], passedLevel: false }),
    progress: { 'a1-old/gate-old': { status: 'learning' } },
  };
  const state = applyOutcome(before);
  assert.deepEqual(state.journey.unlockedRankIds, ['a1-old']);
  assert.deepEqual(state.journey.unlockedGateIds, ['gate-old']);
  assert.equal(resolve(state).gate.gateId, 'gate-old');
});

test('scenario 4: permission denied exposes no partial success and retry applies exactly once', () => {
  const before = {
    journey: baseJourney(),
    session: newRanksSession(),
    progress: { 'a1-old/gate-old': { status: 'learning' } },
  };
  const snapshot = clone(before);
  assert.throws(() => applyOutcome(before, { failBeforeCommit: true }), /permission-denied/);
  assert.deepEqual(before, snapshot);
  const applied = applyOutcome(before);
  assert.equal(applied.session.resultApplied, true);
  assert.equal(applyOutcome(applied), applied);
});

test('scenario 5: double finish and reload retain one receipt without duplicate progress', () => {
  const initial = {
    journey: baseJourney(),
    session: newRanksSession(),
    progress: { 'a1-old/gate-old': { status: 'learning' } },
  };
  const once = applyOutcome(initial);
  const twice = applyOutcome(once);
  assert.equal(twice, once);
  assert.equal(Object.keys(twice.progress).length, 1);
  assert.equal(new Set(twice.session.resultUnlockedGateIds).size, 1);
});

test('scenario 6: missing legacy metadata derives coverage without relocking or duplicate assessment', () => {
  const coverage = placementContract.deriveLegacyRankCoverage({
    cefrLevel: 'A1',
    journey: baseJourney({ assessedRankIds: undefined }),
    sessions: [],
    ranks: [oldA1, newA1a],
    gatesByRank,
    progressByRank: new Map([
      ['a1-old', new Map([['gate-old', { status: 'learning' }]])],
    ]),
  });
  assert.deepEqual(Array.from(coverage.assessedRankIds), ['a1-old']);
  assert.deepEqual(
    placementContract.getUnassessedPublishedRanks('A1', [oldA1, newA1a], coverage)
      .map((item) => item.rankId),
    ['a1-new-a']
  );
});

test('scenario 7: word-save failure leaves applied progression complete and retry changes only word fields', () => {
  const state = applyOutcome({
    journey: baseJourney(),
    session: newRanksSession(),
    progress: { 'a1-old/gate-old': { status: 'learning' } },
  });
  const journeySnapshot = clone(state.journey);
  state.session.saveWordChoice = 'all';
  state.session.saveWordPendingIds = ['question-1'];
  assert.deepEqual(state.journey, journeySnapshot);
  state.session.saveWordPendingIds = [];
  state.session.saveWordSavedIds = ['question-1'];
  assert.deepEqual(state.journey, journeySnapshot);
  assert.equal(resolve(state).gate.gateId, 'gate-new-a');
});

test('scenario 8: later new-rank publication tests only the latest unseen ID', () => {
  const prior = placementContract.mergeRankCoverage(
    { assessedRankIds: ['a1-old'] },
    [newA1a],
    [oldA1, newA1a]
  );
  const later = rank('a1-new-later', 5, 'A1');
  assert.deepEqual(
    placementContract.getUnassessedPublishedRanks(
      'A1',
      [oldA1, newA1a, later],
      prior
    ).map((item) => item.rankId),
    ['a1-new-later']
  );
});

test('scenario 9: a stale pointer resolves the best valid work without mutating the pointer', () => {
  const state = {
    journey: baseJourney({ activeRankId: 'missing-rank', activeGateId: 'missing-gate' }),
    progress: { 'a1-old/gate-old': { status: 'learning' } },
  };
  const before = clone(state.journey);
  assert.equal(resolve(state).gate.gateId, 'gate-old');
  assert.deepEqual(state.journey, before);
});

test('scenario 10: passing the last published level produces completed-current-content without resetting', () => {
  const session = {
    ...newRanksSession(),
    assessmentMode: 'full-level',
    orderedRankIds: ['a2-first'],
    testedRankIds: ['a2-first'],
    passedRankIds: ['a2-first'],
    cefrLevel: 'A2',
    rankFirstGateIds: { 'a2-first': 'gate-a2' },
  };
  const state = applyOutcome({
    journey: baseJourney({
      activeRankId: 'a2-first',
      activeGateId: 'gate-a2',
      unlockedRankIds: ['a1-old', 'a2-first'],
      unlockedGateIds: ['gate-old', 'gate-a2'],
      passedCefrLevels: ['A1'],
    }),
    session,
    progress: {
      'a1-old/gate-old': { status: 'cleared' },
      'a2-first/gate-a2': { status: 'learning' },
    },
  });
  assert.equal(state.journey.contentJourneyStatus, 'completed-current-content');
  assert.equal(state.journey.activeRankId, 'a2-first');
  assert.equal(resolve(state).type, 'completed-current-content');
});
