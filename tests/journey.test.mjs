import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../js/journey.js', import.meta.url), 'utf8');
const windowObject = {};
const context = vm.createContext({
  window: windowObject,
  globalThis: windowObject,
  encodeURIComponent,
  Error,
  Map,
  Set,
  Object,
  String,
  Number,
  Array,
  Boolean,
});
vm.runInContext(source, context);
const journey = windowObject.LootLinguaJourney;

function unlock(initialStatus) {
  return {
    mode: 'manual_placeholder',
    initialStatus,
    requiredMasteredRatio: null,
    requiredReviewingRatio: null,
    requiredGateCount: null,
  };
}

function rank(rankId, order, initialStatus = 'locked') {
  return {
    worldId: 'world-a',
    rankId,
    order,
    status: 'published',
    unlockConfig: unlock(initialStatus),
  };
}

function gate(rankId, gateId, order, initialStatus = 'locked') {
  return {
    worldId: 'world-a',
    rankId,
    gateId,
    order,
    status: 'published',
    unlockConfig: unlock(initialStatus),
  };
}

test('journey contract exposes official states and permits the cleared progression state', () => {
  assert.deepEqual(
    Array.from(journey.GATE_STATUSES),
    ['locked', 'available', 'learning', 'ready', 'cleared']
  );
  assert.deepEqual(
    Array.from(journey.WRITABLE_GATE_STATUSES),
    ['available', 'learning', 'ready', 'cleared']
  );
});

test('content order uses order followed by stable ID instead of DOM position', () => {
  const ordered = journey.stableContentOrder([
    rank('rank-z', 2),
    rank('rank-b', 1),
    rank('rank-a', 1),
  ], 'rankId');
  assert.deepEqual(ordered.map((item) => item.rankId), ['rank-a', 'rank-b', 'rank-z']);
});

test('an initially locked rank cannot start a journey and the first available rank is selected', () => {
  const ranks = [
    rank('rank-locked', 0, 'locked'),
    rank('rank-open', 1, 'available'),
  ];
  const firstGate = gate('rank-open', 'gate-open', 0, 'available');
  const selection = journey.selectJourneyStart(ranks, {
    'rank-open': [firstGate],
  });
  assert.equal(journey.canAccessRank(ranks[0], null), false);
  assert.equal(selection.rank.rankId, 'rank-open');
  assert.equal(selection.gate.gateId, 'gate-open');
});

test('the first gate is open before a journey regardless of legacy gate lock metadata', () => {
  const openRank = rank('rank-open', 0, 'available');
  const first = gate('rank-open', 'gate-a', 0, 'locked');
  const later = gate('rank-open', 'gate-b', 1, 'available');
  assert.equal(
    journey.canAccessGate(first, null, { rank: openRank, isFirstEligibleGate: true }),
    true
  );
  assert.equal(
    journey.canAccessGate(later, null, { rank: openRank, isFirstEligibleGate: false }),
    false
  );
});

test('a saved journey never falls back to another Admin-open rank or gate', () => {
  const activeRank = rank('rank-a', 0, 'available');
  const otherRank = rank('rank-b', 1, 'available');
  const activeGate = gate('rank-a', 'gate-a', 0, 'available');
  const otherGate = gate('rank-a', 'gate-b', 1, 'available');
  const savedJourney = {
    worldId: 'world-a',
    unlockedRankIds: ['rank-a'],
    unlockedGateIds: ['gate-a'],
  };
  assert.equal(journey.canAccessRank(activeRank, savedJourney), true);
  assert.equal(journey.canAccessRank(otherRank, savedJourney), false);
  assert.equal(journey.canAccessGate(activeGate, savedJourney, { rank: activeRank }), true);
  assert.equal(journey.canAccessGate(otherGate, savedJourney, { rank: activeRank }), false);
});

test('next target advances through gates then opens the first gate of the next rank', () => {
  const ranks = [
    rank('rank-a', 0, 'available'),
    rank('rank-b', 1, 'locked'),
  ];
  const gates = {
    'rank-a': [
      gate('rank-a', 'gate-a1', 0),
      gate('rank-a', 'gate-a2', 1),
    ],
    'rank-b': [
      gate('rank-b', 'gate-b1', 0),
      gate('rank-b', 'gate-b2', 1),
    ],
  };
  const withinRank = journey.selectNextJourneyTarget(ranks, gates, 'rank-a', 'gate-a1');
  assert.equal(withinRank.rank.rankId, 'rank-a');
  assert.equal(withinRank.gate.gateId, 'gate-a2');
  assert.equal(withinRank.rankUnlocked, false);

  const nextRank = journey.selectNextJourneyTarget(ranks, gates, 'rank-a', 'gate-a2');
  assert.equal(nextRank.rank.rankId, 'rank-b');
  assert.equal(nextRank.gate.gateId, 'gate-b1');
  assert.equal(nextRank.rankUnlocked, true);
});

test('saved unlock IDs permit access and saved progress wins over presentation defaults', () => {
  const openRank = rank('rank-open', 0, 'locked');
  const savedGate = gate('rank-open', 'gate-b', 1, 'locked');
  const savedJourney = {
    worldId: 'world-a',
    unlockedRankIds: ['rank-open'],
    unlockedGateIds: ['gate-b'],
  };
  assert.equal(journey.canAccessRank(openRank, savedJourney), true);
  assert.equal(journey.canAccessGate(savedGate, savedJourney, { rank: openRank }), true);
  assert.equal(
    journey.getJourneyGateState(
      savedJourney,
      { status: 'learning' },
      savedGate,
      { rank: openRank }
    ),
    'learning'
  );
  assert.equal(
    journey.getJourneyGateState(
      savedJourney,
      { status: 'cleared' },
      savedGate,
      { rank: openRank }
    ),
    'cleared'
  );
});

test('journey seed stores IDs and placeholders without content or reward data', () => {
  const seed = journey.createJourneySeed('world-a', 'rank-a', 'gate-a');
  assert.deepEqual(JSON.parse(JSON.stringify(seed)), {
    worldId: 'world-a',
    activeRankId: 'rank-a',
    activeGateId: 'gate-a',
    status: 'active',
    contentJourneyStatus: 'in-progress',
    journeyVersion: 1,
    placementStatus: 'not-started',
    activePlacementAssessmentId: '',
    unlockedRankIds: ['rank-a'],
    unlockedGateIds: ['gate-a'],
  });
  assert.equal('xp' in seed, false);
  assert.equal('words' in seed, false);
});

test('active destination resolver prioritizes clear, selected placement, started, and available work', () => {
  const ranks = [rank('rank-a', 0, 'available'), rank('rank-b', 1, 'locked')];
  const gatesByRank = new Map([
    ['rank-a', [gate('rank-a', 'gate-a', 0), gate('rank-a', 'gate-b', 1)]],
    ['rank-b', [gate('rank-b', 'gate-c', 0)]],
  ]);
  const progressByRank = new Map([
    ['rank-a', new Map([
      ['gate-a', { status: 'learning' }],
      ['gate-b', { status: 'available', activeClearAttemptId: 'clear-a' }],
    ])],
    ['rank-b', new Map([['gate-c', { status: 'available' }]])],
  ]);
  const base = {
    journey: { activeRankId: 'rank-a', activeGateId: 'gate-a' },
    ranks,
    gatesByRank,
    progressByRank,
  };
  assert.equal(journey.resolveActiveJourneyDestination(base).type, 'gate-clear');
  progressByRank.get('rank-a').get('gate-b').activeClearAttemptId = '';
  assert.equal(journey.resolveActiveJourneyDestination({
    ...base,
    levelPlacementSession: { status: 'paused' },
    resumePausedLevelPlacement: true,
  }).type, 'level-placement');
  assert.equal(journey.resolveActiveJourneyDestination(base).reason, 'started');
  progressByRank.get('rank-a').get('gate-a').status = 'cleared';
  assert.equal(journey.resolveActiveJourneyDestination(base).reason, 'available');
});

test('active destination resolves new ranks before the completed-current-content state', () => {
  const ranks = [rank('rank-a', 0, 'available'), rank('rank-new', 1, 'locked')];
  const gatesByRank = new Map([
    ['rank-a', [gate('rank-a', 'gate-a', 0)]],
    ['rank-new', [gate('rank-new', 'gate-new', 0)]],
  ]);
  const progressByRank = new Map([
    ['rank-a', new Map([['gate-a', { status: 'cleared' }]])],
    ['rank-new', new Map([['gate-new', { status: 'locked' }]])],
  ]);
  const destination = journey.resolveActiveJourneyDestination({
    journey: { contentJourneyStatus: 'completed-current-content' },
    ranks,
    gatesByRank,
    progressByRank,
    unassessedRankIds: ['rank-new'],
  });
  assert.equal(destination.type, 'new-rank-assessment');
  assert.equal(destination.reason, 'new-rank');
  assert.equal(destination.gate.gateId, 'gate-new');
});

test('pending new ranks route before an older learning gate', () => {
  const ranks = [rank('rank-old', 0, 'available'), rank('rank-new', 1, 'locked')];
  const gatesByRank = new Map([
    ['rank-old', [gate('rank-old', 'gate-old', 0)]],
    ['rank-new', [gate('rank-new', 'gate-new', 0)]],
  ]);
  const destination = journey.resolveActiveJourneyDestination({
    journey: { activeRankId: 'rank-old', activeGateId: 'gate-old' },
    ranks,
    gatesByRank,
    progressByRank: new Map([
      ['rank-old', new Map([['gate-old', { status: 'learning' }]])],
      ['rank-new', new Map([['gate-new', { status: 'locked' }]])],
    ]),
    unassessedRankIds: ['rank-new'],
  });
  assert.equal(destination.type, 'new-rank-assessment');
  assert.equal(destination.rank.rankId, 'rank-new');
  assert.equal(destination.gate.gateId, 'gate-new');
});

test('an active new-ranks session resumes before an older clear attempt', () => {
  const ranks = [rank('rank-old', 0, 'available')];
  const gatesByRank = new Map([['rank-old', [gate('rank-old', 'gate-old', 0)]]]);
  const destination = journey.resolveActiveJourneyDestination({
    journey: { activeRankId: 'rank-old', activeGateId: 'gate-old' },
    ranks,
    gatesByRank,
    progressByRank: new Map([
      ['rank-old', new Map([['gate-old', {
        status: 'ready',
        activeClearAttemptId: 'clear-old',
      }]])],
    ]),
    levelPlacementSession: {
      assessmentMode: 'new-ranks',
      status: 'active',
    },
  });
  assert.equal(destination.type, 'level-placement');
  assert.equal(destination.session.assessmentMode, 'new-ranks');
});

test('a completed assessment awaiting application is resolved before new ranks or old progress', () => {
  const destination = journey.resolveJourneyDestination({
    journey: { activeRankId: 'rank-old', activeGateId: 'gate-old' },
    ranks: [rank('rank-old', 0, 'available'), rank('rank-new', 1)],
    gatesByRank: new Map([
      ['rank-old', [gate('rank-old', 'gate-old', 0)]],
      ['rank-new', [gate('rank-new', 'gate-new', 0)]],
    ]),
    progressByRank: new Map([
      ['rank-old', new Map([['gate-old', { status: 'learning' }]])],
    ]),
    unassessedRankIds: ['rank-new'],
    levelPlacementSession: {
      assessmentId: 'assessment-a',
      status: 'awaiting-decision',
      resultApplied: false,
      orderedQuestionIds: ['q-1'],
      currentQuestionIndex: 1,
      answers: [{}],
    },
  });
  assert.equal(destination.type, 'level-placement-result');
  assert.equal(destination.reason, 'outcome-pending');
  assert.equal(destination.requiresApply, true);
});

test('legacy Placement is a central resolver destination instead of a UI special case', () => {
  const destination = journey.resolveJourneyDestination({
    journey: { activeRankId: 'rank-old', activeGateId: 'gate-old' },
    ranks: [rank('rank-old', 0, 'available')],
    gatesByRank: new Map([['rank-old', [gate('rank-old', 'gate-old', 0)]]]),
    progressByRank: new Map(),
    legacyPlacementActive: true,
  });
  assert.equal(destination.type, 'placement');
  assert.equal(destination.reason, 'legacy-placement');
});

test('an unlocked active pointer with missing Gate Progress is derived as available before old work', () => {
  const destination = journey.resolveJourneyDestination({
    journey: {
      worldId: 'world-a',
      activeRankId: 'rank-new',
      activeGateId: 'gate-new',
      unlockedRankIds: ['rank-old', 'rank-new'],
      unlockedGateIds: ['gate-old', 'gate-new'],
    },
    ranks: [rank('rank-old', 0, 'available'), rank('rank-new', 1)],
    gatesByRank: new Map([
      ['rank-old', [gate('rank-old', 'gate-old', 0)]],
      ['rank-new', [gate('rank-new', 'gate-new', 0)]],
    ]),
    progressByRank: new Map([
      ['rank-old', new Map([['gate-old', { status: 'learning' }]])],
    ]),
  });
  assert.equal(destination.gate.gateId, 'gate-new');
  assert.equal(destination.reason, 'active-pointer');
  assert.equal(destination.derivedProgress, true);
});

test('the atomic cleared-gate ledger overrides stale gate progress after full-level placement', () => {
  const destination = journey.resolveJourneyDestination({
    journey: {
      worldId: 'world-a',
      activeRankId: 'rank-a2',
      activeGateId: 'gate-a2',
      unlockedRankIds: ['rank-a1', 'rank-a2'],
      unlockedGateIds: ['gate-a1', 'gate-a2'],
      levelPlacementClearedGateIds: ['gate-a1'],
    },
    ranks: [rank('rank-a1', 0, 'available'), rank('rank-a2', 1)],
    gatesByRank: new Map([
      ['rank-a1', [gate('rank-a1', 'gate-a1', 0)]],
      ['rank-a2', [gate('rank-a2', 'gate-a2', 0)]],
    ]),
    progressByRank: new Map([
      ['rank-a1', new Map([['gate-a1', { status: 'learning' }]])],
    ]),
  });
  assert.equal(destination.gate.gateId, 'gate-a2');
  assert.equal(destination.state, 'available');
});

test('a gate published later is not inferred as cleared from an older full-level receipt', () => {
  const savedJourney = {
    worldId: 'world-a',
    unlockedRankIds: ['rank-a1'],
    unlockedGateIds: ['gate-a1', 'gate-a1-later'],
    levelPlacementClearedGateIds: ['gate-a1'],
  };
  const savedRank = rank('rank-a1', 0, 'available');
  assert.equal(
    journey.getJourneyGateState(
      savedJourney,
      null,
      gate('rank-a1', 'gate-a1', 0),
      { rank: savedRank }
    ),
    'cleared'
  );
  assert.equal(
    journey.getJourneyGateState(
      savedJourney,
      null,
      gate('rank-a1', 'gate-a1-later', 1),
      { rank: savedRank }
    ),
    'available'
  );
});

test('new-rank Placement preserves older progress outside the ranks under test', () => {
  const destination = journey.resolveLevelPlacementResultDestination({
    journey: { activeRankId: 'rank-b2', activeGateId: 'gate-b2' },
    session: {
      assessmentMode: 'new-ranks',
      testedRankIds: ['rank-new'],
      passedLevel: true,
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(destination)), {
    rankId: 'rank-b2',
    gateId: 'gate-b2',
    completedCurrentContent: false,
    preserveExistingPointer: true,
  });
});

test('new-rank Placement routes to the first passed new rank and first gate', () => {
  const destination = journey.resolveLevelPlacementResultDestination({
    journey: { activeRankId: 'rank-old', activeGateId: 'gate-old' },
    session: {
      assessmentMode: 'new-ranks',
      testedRankIds: ['rank-new-a', 'rank-new-b'],
      orderedRankIds: ['rank-new-a', 'rank-new-b'],
      passedRankIds: ['rank-new-a'],
      rankFirstGateIds: {
        'rank-new-a': 'gate-new-a',
        'rank-new-b': 'gate-new-b',
      },
      passedLevel: false,
    },
  });
  assert.equal(destination.rankId, 'rank-new-a');
  assert.equal(destination.gateId, 'gate-new-a');
  assert.equal(destination.completedCurrentContent, false);
  assert.equal(destination.preserveExistingPointer, false);
});

test('new-rank Placement with no passed rank preserves the old pointer', () => {
  const destination = journey.resolveLevelPlacementResultDestination({
    journey: { activeRankId: 'rank-old', activeGateId: 'gate-old' },
    session: {
      assessmentMode: 'new-ranks',
      testedRankIds: ['rank-new'],
      orderedRankIds: ['rank-new'],
      passedRankIds: [],
      passedLevel: false,
    },
  });
  assert.equal(destination.rankId, 'rank-old');
  assert.equal(destination.gateId, 'gate-old');
  assert.equal(destination.completedCurrentContent, false);
  assert.equal(destination.preserveExistingPointer, true);
});

test('new-ranks outcome unlocks only the destination gate and clears none of them', () => {
  const outcome = journey.planPlacementOutcome({
    journey: { activeRankId: 'rank-old', activeGateId: 'gate-old' },
    session: {
      assessmentMode: 'new-ranks',
      orderedRankIds: ['rank-new-a', 'rank-new-b'],
      passedRankIds: ['rank-new-a', 'rank-new-b'],
      rankFirstGateIds: {
        'rank-new-a': 'gate-new-a',
        'rank-new-b': 'gate-new-b',
      },
    },
  });
  assert.deepEqual(Array.from(outcome.resultClearedGateIds), []);
  assert.deepEqual(
    Array.from(outcome.availableGateTargets, (target) => target.gateId),
    []
  );
  assert.deepEqual(Array.from(outcome.resultUnlockedGateIds), ['gate-new-a']);
  assert.equal(outcome.destination.gateId, 'gate-new-a');
});

test('full-level outcome clears passed ranks and opens the next-level target', () => {
  const outcome = journey.planPlacementOutcome({
    journey: { activeRankId: 'rank-a1', activeGateId: 'gate-a1' },
    session: {
      assessmentMode: 'full-level',
      passedLevel: true,
      passedRankIds: ['rank-a1'],
    },
    nextLevelTarget: {
      rank: { rankId: 'rank-a2' },
      gate: { gateId: 'gate-a2' },
    },
    gatesByRank: new Map([
      ['rank-a1', [
        { gateId: 'gate-a1', order: 0, status: 'published' },
        { gateId: 'gate-a1-last', order: 1, status: 'published' },
      ]],
    ]),
  });
  assert.deepEqual(
    Array.from(outcome.resultClearedGateIds),
    ['gate-a1', 'gate-a1-last']
  );
  assert.deepEqual(
    Array.from(outcome.availableGateTargets, (target) => target.gateId),
    ['gate-a2']
  );
  assert.equal(outcome.destination.rankId, 'rank-a2');
});

test('full-level Placement advances to the supplied next-level target', () => {
  const destination = journey.resolveLevelPlacementResultDestination({
    journey: { activeRankId: 'rank-a1', activeGateId: 'gate-a1' },
    session: { assessmentMode: 'full-level', passedLevel: true },
    nextLevelTarget: {
      rank: { rankId: 'rank-a2' },
      gate: { gateId: 'gate-a2' },
    },
  });
  assert.equal(destination.rankId, 'rank-a2');
  assert.equal(destination.gateId, 'gate-a2');
  assert.equal(destination.completedCurrentContent, false);
});

test('partial Level Placement starts at the recommended rank and gate', () => {
  const destination = journey.resolveLevelPlacementResultDestination({
    session: {
      assessmentMode: 'full-level',
      passedLevel: false,
      recommendedStartRankId: 'rank-frontier',
      recommendedStartGateId: 'gate-frontier',
    },
  });
  assert.equal(destination.rankId, 'rank-frontier');
  assert.equal(destination.gateId, 'gate-frontier');
  assert.equal(destination.completedCurrentContent, false);
});

test('source IDs use the complete hierarchy and do not collide on underscore boundaries', () => {
  const left = journey.contentSourceId({
    worldId: 'world__a',
    rankId: 'rank',
    gateId: 'gate',
    contentWordId: 'word',
  });
  const right = journey.contentSourceId({
    worldId: 'world',
    rankId: 'a__rank',
    gateId: 'gate',
    contentWordId: 'word',
  });
  assert.notEqual(left, right);
  assert.match(left, /^published_/);
});

test('new published words are derived without treating removed words as deletions', () => {
  const words = [
    { contentWordId: 'word-a' },
    { contentWordId: 'word-b' },
    { contentWordId: 'word-c' },
  ];
  assert.deepEqual(
    journey.detectNewContentWordIds(words, {
      loadedContentWordIds: ['word-a', 'word-b', 'removed-word'],
    }),
    ['word-c']
  );
});

test('gate transitions reserve cleared for Placement and reject mastery-only clearing', () => {
  assert.equal(journey.canTransitionGateProgress('', 'available'), true);
  assert.equal(journey.canTransitionGateProgress('', 'learning'), true);
  assert.equal(journey.canTransitionGateProgress('available', 'learning'), true);
  assert.equal(journey.canTransitionGateProgress('learning', 'learning'), true);
  assert.equal(journey.canTransitionGateProgress('learning', 'ready'), true);
  assert.equal(journey.canTransitionGateProgress('learning', 'cleared'), false);
  assert.equal(
    journey.canTransitionGateProgress(
      'learning',
      'cleared',
      { source: 'placement' }
    ),
    true
  );
  assert.equal(journey.canTransitionGateProgress('available', 'cleared'), false);
  assert.equal(
    journey.canTransitionGateProgress('ready', 'cleared', { source: 'gate-clear' }),
    true
  );
  assert.equal(journey.canTransitionGateProgress('', 'mastered'), false);
});

test('saved progress cannot expose a gate missing from the journey unlock ledger', () => {
  const openRank = rank('rank-a', 0, 'available');
  const lockedGate = gate('rank-a', 'gate-b', 1);
  const savedJourney = {
    worldId: 'world-a',
    unlockedRankIds: ['rank-a'],
    unlockedGateIds: ['gate-a'],
  };
  assert.equal(
    journey.getJourneyGateState(
      savedJourney,
      { status: 'cleared', clearedBy: 'placement' },
      lockedGate,
      { rank: openRank }
    ),
    'locked'
  );
});
