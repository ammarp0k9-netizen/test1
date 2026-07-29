import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [schemaSource, journeySource, levelPlacementSource, journeyCloudModule] =
  await Promise.all([
    readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/journey.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/level-placement.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  ]);

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function createHarness(options = {}) {
  const values = new Map();
  const auth = { currentUser: { uid: 'flow-user' } };
  const controls = {
    failNextOutcomeCommit: false,
    failProgressProjection: false,
    failWorldRefresh: false,
    failReadinessProjection: false,
    wordFailures: new Map(),
    outcomeCommitCount: 0,
    wordUpserts: [],
  };
  const db = { path: '' };
  const pathOf = (base, parts) => [base?.path, ...parts]
    .filter((part) => part !== undefined && part !== null && String(part) !== '')
    .map(String)
    .join('/');
  const doc = (base, ...parts) => ({ path: pathOf(base, parts) });
  const collection = (base, ...parts) => ({ path: pathOf(base, parts) });
  const snapshot = (reference) => {
    const present = values.has(reference.path);
    return {
      id: reference.path.split('/').at(-1),
      exists: () => present,
      data: () => clone(values.get(reference.path)),
    };
  };
  const applyUpdate = (current, patch) => ({ ...(current || {}), ...clone(patch) });
  const runTransaction = async (_db, callback) => {
    const writes = [];
    const transaction = {
      get: async (reference) => snapshot(reference),
      update: (reference, patch) => writes.push({ type: 'update', reference, patch }),
      set: (reference, data, writeOptions) => writes.push({
        type: 'set', reference, patch: data, merge: writeOptions?.merge === true,
      }),
      delete: (reference) => writes.push({ type: 'delete', reference }),
    };
    const result = await callback(transaction);
    const appliesOutcome = writes.some((write) => write.patch?.resultApplied === true);
    const projectsGate = writes.some((write) => (
      write.reference.path.includes('/contentProgress/') &&
      write.reference.path.includes('/ranks/') &&
      write.reference.path.includes('/gates/')
    ));
    if (appliesOutcome && controls.failNextOutcomeCommit) {
      controls.failNextOutcomeCommit = false;
      const error = new Error('Injected outcome commit failure');
      error.code = 'permission-denied';
      throw error;
    }
    if (projectsGate && controls.failProgressProjection) {
      const error = new Error('Injected projection failure');
      error.code = 'unavailable';
      throw error;
    }
    if (appliesOutcome) controls.outcomeCommitCount += 1;
    writes.forEach((write) => {
      if (write.type === 'delete') {
        values.delete(write.reference.path);
      } else if (write.type === 'update' || write.merge) {
        values.set(
          write.reference.path,
          applyUpdate(values.get(write.reference.path), write.patch)
        );
      } else {
        values.set(write.reference.path, clone(write.patch));
      }
    });
    return result;
  };
  const getDocs = async (reference) => {
    const prefix = `${reference.path}/`;
    const docs = [...values.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path]) => snapshot({ path }));
    return { docs };
  };
  const trace = {
    count() { return this; },
    stage() { return this; },
    warn() { return this; },
    end() { return this; },
  };
  const root = {
    __firebase: {
      getApps: () => [{}],
      getAuth: () => auth,
      getFirestore: () => db,
      collection,
      doc,
      getDoc: async (reference) => {
        if (
          controls.failReadinessProjection &&
          reference.path.endsWith('/contentProgress/world-a/ranks/rank-a2/gates/old-gate')
        ) {
          const error = new Error('Injected readiness projection failure');
          error.code = 'unavailable';
          throw error;
        }
        return snapshot(reference);
      },
      getDocs,
      runTransaction,
      serverTimestamp: () => new Date(),
      setDoc: async (reference, data, writeOptions) => {
        values.set(
          reference.path,
          writeOptions?.merge ? applyUpdate(values.get(reference.path), data) : clone(data)
        );
      },
    },
    addEventListener() {},
    dispatchEvent() { return true; },
    LootLinguaOperations: { startTrace: () => ({ ...trace }) },
  };
  const context = vm.createContext({
    window: root,
    globalThis: root,
    document: { readyState: 'loading' },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    console,
    setTimeout,
    clearTimeout,
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
  vm.runInContext(levelPlacementSource, context);

  const ranks = options.newRanks
    ? [
      { worldId: 'world-a', rankId: 'rank-a1-old', cefrLevel: 'A1', order: 0, status: 'published' },
      { worldId: 'world-a', rankId: 'rank-a1-new-a', cefrLevel: 'A1', order: 1, status: 'published' },
      { worldId: 'world-a', rankId: 'rank-a1-new-b', cefrLevel: 'A1', order: 2, status: 'published' },
      { worldId: 'world-a', rankId: 'rank-a2', cefrLevel: 'A2', order: 0, status: 'published' },
    ]
    : options.noNextLevel
    ? [
      { worldId: 'world-a', rankId: 'rank-a2', cefrLevel: 'A2', order: 1, status: 'published' },
    ]
    : [
      { worldId: 'world-a', rankId: 'rank-a2', cefrLevel: 'A2', order: 1, status: 'published' },
      { worldId: 'world-a', rankId: 'rank-b1', cefrLevel: 'B1', order: 2, status: 'published' },
    ];
  const gates = new Map([
    ['rank-a2', options.newRanks
      ? [
        { worldId: 'world-a', rankId: 'rank-a2', gateId: 'gate-a2', order: 0, status: 'published' },
      ]
      : [
        { worldId: 'world-a', rankId: 'rank-a2', gateId: 'old-gate', order: 0, status: 'published' },
        { worldId: 'world-a', rankId: 'rank-a2', gateId: 'gate-a2', order: 1, status: 'published' },
      ]],
    ['rank-b1', [
      { worldId: 'world-a', rankId: 'rank-b1', gateId: 'gate-b1', order: 1, status: 'published' },
    ]],
    ['rank-a1-old', [
      { worldId: 'world-a', rankId: 'rank-a1-old', gateId: 'gate-a1-old', order: 0, status: 'published' },
    ]],
    ['rank-a1-new-a', [
      { worldId: 'world-a', rankId: 'rank-a1-new-a', gateId: 'gate-new-a-0', order: 0, status: 'published' },
      { worldId: 'world-a', rankId: 'rank-a1-new-a', gateId: 'gate-new-a-1', order: 1, status: 'published' },
    ]],
    ['rank-a1-new-b', [
      { worldId: 'world-a', rankId: 'rank-a1-new-b', gateId: 'gate-new-b-0', order: 0, status: 'published' },
      { worldId: 'world-a', rankId: 'rank-a1-new-b', gateId: 'gate-new-b-1', order: 1, status: 'published' },
    ]],
  ]);
  root.LootLinguaPublishedContent = {
    listPublishedRanks: async () => clone(ranks),
    listPublishedGates: async (_worldId, rankId) => clone(gates.get(String(rankId)) || []),
    getPublishedWorld: async (worldId) => {
      if (controls.failWorldRefresh) {
        const error = new Error('Injected result refresh failure');
        error.code = 'unavailable';
        throw error;
      }
      return { worldId, title: 'World A', status: 'published' };
    },
    listAllPublishedGateWords: async () => [],
  };
  root.LootLinguaPlacement = {
    cleanId: (value) => String(value),
    shouldResumePlacement: () => false,
  };
  root.LootLinguaLearningEvidence = {
    EVIDENCE_VERSION: 2,
    evidenceEventId: (uid, sessionId, wordKey) => `e2~${uid}~${sessionId}~${wordKey}`,
    normalizeTimezoneOffsetMinutes: (value) => Number(value) || 0,
    localDayKey: () => 20260728,
    isEligibleRecall: () => true,
    computeGateReadiness: () => ({ ready: false, status: 'learning' }),
  };
  root.LootLinguaGateClear = {};
  root.LootLinguaWordLifecycle = {
    wordKeyOf: (word) => String(word?.wordKey || ''),
    isEligibleForPersonalDictionaryQuiz: () => true,
    addResultToSummary(summary, result) {
      for (const key of [
        'created', 'sourceLinked', 'alreadyLinked', 'restored',
        'updatedMissingFields', 'hiddenPreserved',
      ]) {
        if (result?.[key]) summary[key] = (Number(summary[key]) || 0) + 1;
      }
    },
  };
  root.LootLinguaWordLifecycleCloud = {
    async upsertUserWordWithSource(input) {
      const contentWordId = String(input.source?.contentWordId || '');
      controls.wordUpserts.push({
        contentWordId,
        normalizedWord: input.word?.normalizedWord,
        wordKey: input.word?.wordKey,
        sourceType: input.source?.type,
      });
      const remainingFailures = controls.wordFailures.get(contentWordId) || 0;
      if (remainingFailures > 0) {
        controls.wordFailures.set(contentWordId, remainingFailures - 1);
        const error = new Error('Injected word write failure');
        error.code = 'unavailable';
        throw error;
      }
      return {
        wordId: `legacy-${contentWordId}`,
        created: true,
        sourceLinked: false,
        alreadyLinked: false,
        restored: false,
        updatedMissingFields: false,
        hiddenPreserved: false,
      };
    },
  };

  const executableCloudSource = [
    'const { collection, doc, getDoc, getDocs, getFirestore, runTransaction, serverTimestamp, setDoc, getApps, getAuth } = window.__firebase;',
    journeyCloudModule.slice(journeyCloudModule.indexOf('const app =')),
  ].join('\n');
  vm.runInContext(executableCloudSource, context);

  const journeyPath = 'users/flow-user/contentProgress/world-a';
  const sessionPath = `${journeyPath}/levelPlacementSessions/assessment-a2`;
  const pointerPath = 'users/flow-user/meta/active_content_journey';
  const identity = root.LootLinguaContentSchema.normalizeWordIdentity({ word: 'Apple' });
  const selectedWords = [
    {
      questionId: 'question-1', rankId: 'rank-a2', gateId: 'gate-a2',
      contentWordId: 'word-1', wordKey: identity.wordKey,
      word: 'Apple', translation: 'تفاحة', passThreshold: 0.75,
    },
    {
      questionId: 'question-2', rankId: 'rank-a2', gateId: 'gate-a2',
      contentWordId: 'word-2', wordKey: root.LootLinguaContentSchema
        .normalizeWordIdentity({ word: 'Orange' }).wordKey,
      word: 'Orange', translation: 'برتقالة', passThreshold: 0.75,
    },
  ];
  const session = {
    assessmentId: 'assessment-a2', worldId: 'world-a', cefrLevel: 'A2',
    assessmentMode: 'full-level', status: 'awaiting-decision',
    orderedQuestionIds: ['question-1', 'question-2'],
    selectedContentWordIds: ['word-1', 'word-2'], selectedWords,
    answers: [
      {
        questionId: 'question-1', rankId: 'rank-a2', gateId: 'gate-a2',
        contentWordId: 'word-1', wordKey: selectedWords[0].wordKey,
        selectedQuestionId: 'question-1', correct: true,
      },
      {
        questionId: 'question-2', rankId: 'rank-a2', gateId: 'gate-a2',
        contentWordId: 'word-2', wordKey: selectedWords[1].wordKey,
        selectedQuestionId: 'wrong-option', correct: false,
      },
    ],
    currentQuestionIndex: 2, correctCount: 1, answersCompletedAt: new Date(),
    orderedRankIds: ['rank-a2'], testedRankIds: ['rank-a2'],
    passedRankIds: ['rank-a2'], passedLevel: true,
    perRankStats: { 'rank-a2': { asked: 2, correct: 1, ratio: 0.5 } },
    recommendedStartRankId: '', recommendedStartGateId: '',
    saveWordChoice: 'undecided', saveWordPendingIds: [], saveWordSavedIds: [],
    saveWordFailures: [], saveWordSummary: {}, resultApplied: false,
  };
  if (options.newRanks) {
    Object.assign(session, {
      cefrLevel: 'A1',
      assessmentMode: 'new-ranks',
      orderedRankIds: ['rank-a1-new-a', 'rank-a1-new-b'],
      testedRankIds: ['rank-a1-new-a', 'rank-a1-new-b'],
      passedRankIds: ['rank-a1-new-a', 'rank-a1-new-b'],
      passedLevel: true,
      rankFirstGateIds: {
        'rank-a1-new-a': 'gate-new-a-0',
        'rank-a1-new-b': 'gate-new-b-0',
      },
      perRankStats: {
        'rank-a1-new-a': { asked: 4, correct: 4, ratio: 1 },
        'rank-a1-new-b': { asked: 4, correct: 4, ratio: 1 },
      },
    });
  }
  const initialRankId = options.newRanks ? 'rank-a1-old' : 'rank-a2';
  const initialGateId = options.newRanks ? 'gate-a1-old' : 'old-gate';
  values.set(journeyPath, {
    worldId: 'world-a', status: 'active', activeRankId: initialRankId, activeGateId: initialGateId,
    unlockedRankIds: [initialRankId], unlockedGateIds: [initialGateId],
    passedCefrLevels: ['A1'], partialCefrLevels: [],
    activeLevelPlacementAssessmentId: 'assessment-a2',
    activeLevelPlacementCefrLevel: 'A2', levelPlacementStatus: 'active',
    levelPlacementAssessmentIds: {}, levelPlacementPassedRankIds: [],
    levelPlacementClearedGateIds: [], contentJourneyStatus: 'in-progress',
  });
  values.set(sessionPath, session);
  values.set(pointerPath, { worldId: 'world-a', journeyVersion: 1, updatedAt: new Date() });
  values.set(`${journeyPath}/ranks/${initialRankId}/gates/${initialGateId}`, {
    worldId: 'world-a', rankId: initialRankId, gateId: initialGateId,
    status: 'learning', journeyVersion: 1, loadedWordKeys: ['old-word-key'],
  });

  return {
    api: root.LootLinguaJourneyCloud,
    auth,
    controls,
    root,
    values,
    journeyPath,
    sessionPath,
  };
}

test('actual cloud flow keeps an atomic outcome authoritative when projection and refresh fail', async () => {
  const harness = createHarness();
  harness.controls.failProgressProjection = true;
  harness.controls.failWorldRefresh = true;
  const result = await harness.api.applyPlacementOutcome('world-a', 'assessment-a2');

  assert.equal(result.session.status, 'completed');
  assert.equal(result.session.resultApplied, true);
  assert.equal(result.session.resultStartRankId, 'rank-b1');
  assert.equal(result.session.resultStartGateId, 'gate-b1');
  assert.equal(result.progressReconciliationError?.code, 'unavailable');
  assert.equal(result.postCommitRefreshError?.code, 'unavailable');
  assert.equal(harness.values.get(harness.journeyPath).activeGateId, 'gate-b1');
  assert.equal(harness.values.get(harness.sessionPath).resultApplied, true);
  assert.equal(
    harness.values.get(`${harness.journeyPath}/ranks/rank-a2/gates/old-gate`).status,
    'learning'
  );

  harness.api.invalidate('all');
  harness.controls.failWorldRefresh = false;
  const destination = await harness.api.resolveActiveJourneyDestination('world-a', { force: true });
  assert.equal(destination.type, 'gate');
  assert.equal(destination.rank.rankId, 'rank-b1');
  assert.equal(destination.gate.gateId, 'gate-b1');
  harness.auth.currentUser = null;
  harness.api.invalidate('all');
  await assert.rejects(
    harness.api.resolveActiveJourneyDestination('world-a', { force: true }),
    (error) => error?.code === 'journey/sign-in-required'
  );
  harness.auth.currentUser = { uid: 'flow-user' };
  const afterSignIn = await harness.api.resolveActiveJourneyDestination('world-a', { force: true });
  assert.equal(afterSignIn.rank.rankId, 'rank-b1');
  assert.equal(afterSignIn.gate.gateId, 'gate-b1');
});

test('actual perfect new-ranks flow clears both new ranks and advances to order-zero A2', async () => {
  const harness = createHarness({ newRanks: true });
  const result = await harness.api.applyPlacementOutcome('world-a', 'assessment-a2');
  const clearedGateIds = [
    'gate-new-a-0',
    'gate-new-a-1',
    'gate-new-b-0',
    'gate-new-b-1',
  ];

  assert.equal(result.session.assessmentMode, 'new-ranks');
  assert.equal(result.session.resultApplied, true);
  assert.deepEqual(Array.from(result.session.resultClearedGateIds), clearedGateIds);
  assert.equal(result.session.nextCefrLevel, 'A2');
  assert.equal(result.session.resultStartRankId, 'rank-a2');
  assert.equal(result.session.resultStartGateId, 'gate-a2');
  assert.equal(result.journey.activeRankId, 'rank-a2');
  assert.equal(result.journey.activeGateId, 'gate-a2');
  assert.deepEqual(Array.from(result.journey.levelPlacementClearedGateIds), clearedGateIds);
  for (const gateId of clearedGateIds) {
    const rankId = gateId.includes('-a-') ? 'rank-a1-new-a' : 'rank-a1-new-b';
    assert.equal(
      harness.values.get(`${harness.journeyPath}/ranks/${rankId}/gates/${gateId}`).status,
      'cleared'
    );
  }
  assert.equal(
    harness.values.get(`${harness.journeyPath}/ranks/rank-a2/gates/gate-a2`).status,
    'available'
  );

  harness.api.invalidate('all');
  const destination = await harness.api.resolveActiveJourneyDestination('world-a', {
    force: true,
  });
  assert.equal(destination.type, 'gate');
  assert.equal(destination.rank.rankId, 'rank-a2');
  assert.equal(destination.gate.gateId, 'gate-a2');
});

test('actual final-answer retry resumes the saved outcome and applies it exactly once', async () => {
  const harness = createHarness();
  harness.controls.failNextOutcomeCommit = true;
  await assert.rejects(
    harness.api.answerLevelPlacementQuestion('world-a', 'assessment-a2', 'wrong-option'),
    (error) => error?.code === 'permission-denied'
  );
  assert.equal(harness.values.get(harness.sessionPath).status, 'awaiting-decision');
  assert.equal(harness.values.get(harness.sessionPath).resultApplied, false);

  const result = await harness.api.answerLevelPlacementQuestion(
    'world-a',
    'assessment-a2',
    'wrong-option'
  );
  assert.equal(result.session.resultApplied, true);
  assert.equal(harness.controls.outcomeCommitCount, 1);
  const repeated = await harness.api.applyPlacementOutcome('world-a', 'assessment-a2');
  assert.equal(repeated.session.resultApplied, true);
  assert.equal(harness.controls.outcomeCommitCount, 1);
});

test('actual word flow upgrades legacy snapshots, retries pending only, and keeps defer/skip independent', async () => {
  const harness = createHarness();
  const session = harness.values.get(harness.sessionPath);
  harness.values.set(harness.sessionPath, {
    ...session,
    status: 'completed',
    resultApplied: true,
  });
  harness.controls.wordFailures.set('word-2', 1);

  const partial = await harness.api.saveLevelPlacementWords('world-a', 'assessment-a2', 'all');
  assert.equal(partial.partial, true);
  assert.deepEqual(Array.from(partial.session.saveWordSavedIds), ['question-1']);
  assert.deepEqual(Array.from(partial.session.saveWordPendingIds), ['question-2']);
  assert.equal(harness.controls.wordUpserts[0].normalizedWord, 'apple');
  assert.equal(harness.controls.wordUpserts[0].sourceType, 'level-placement');

  const retried = await harness.api.saveLevelPlacementWords('world-a', 'assessment-a2', 'all');
  assert.equal(retried.partial, false);
  assert.deepEqual(
    Array.from(retried.session.saveWordSavedIds).sort(),
    ['question-1', 'question-2']
  );
  assert.equal(harness.controls.wordUpserts.filter((item) => item.contentWordId === 'word-1').length, 1);
  assert.equal(harness.controls.wordUpserts.filter((item) => item.contentWordId === 'word-2').length, 2);
  await harness.api.saveLevelPlacementWords('world-a', 'assessment-a2', 'all');
  assert.equal(harness.controls.wordUpserts.length, 3);

  const skipped = createHarness();
  const skippedSession = skipped.values.get(skipped.sessionPath);
  skipped.values.set(skipped.sessionPath, {
    ...skippedSession,
    status: 'completed',
    resultApplied: true,
  });
  assert.equal(skipped.values.get(skipped.sessionPath).saveWordChoice, 'undecided');
  assert.equal(skipped.controls.wordUpserts.length, 0);
  const none = await skipped.api.saveLevelPlacementWords('world-a', 'assessment-a2', 'none');
  assert.equal(none.session.saveWordChoice, 'none');
  assert.equal(skipped.controls.wordUpserts.length, 0);
  assert.equal(skipped.values.get(skipped.journeyPath).activeGateId, 'old-gate');
});

test('actual no-next-level flow persists completed-current-content without reviving the old pointer', async () => {
  const harness = createHarness({ noNextLevel: true });
  const result = await harness.api.applyPlacementOutcome('world-a', 'assessment-a2');
  assert.equal(result.session.completedCurrentContent, true);
  assert.equal(result.journey.contentJourneyStatus, 'completed-current-content');
  harness.api.invalidate('all');
  const destination = await harness.api.resolveActiveJourneyDestination('world-a', { force: true });
  assert.equal(destination.type, 'completed-current-content');
});

test('ordinary quiz evidence success is not reported as result failure when readiness projection fails', async () => {
  const harness = createHarness();
  const identity = harness.root.LootLinguaContentSchema.normalizeWordIdentity({ word: 'Apple' });
  harness.values.set(`users/flow-user/contentWords/${identity.wordKey}`, {
    canonicalId: identity.wordKey,
    wordKey: identity.wordKey,
    normalizedWord: identity.normalizedWord,
    legacyWordId: 'legacy-apple',
    eligibleEvidenceCount: 0,
  });
  harness.values.set('users/flow-user/words/legacy-apple', {
    word: 'Apple',
    wordKey: identity.wordKey,
    personalDictionaryState: 'active',
  });
  harness.controls.failReadinessProjection = true;
  const result = await harness.api.recordQuizEvidenceBatch({
    sessionId: 'quiz-session-a',
    mode: 'timeAttack',
    source: 'personal',
    completed: true,
    entries: [{
      word: { word: 'Apple', wordKey: identity.wordKey },
      result: { correct: true, answeredAt: Date.now() },
    }],
  });
  assert.equal(result.recorded, 1);
  assert.equal(result.readinessError?.code, 'unavailable');
  assert.equal(
    [...harness.values.keys()].some((path) => path.includes(`/contentWords/${identity.wordKey}/evidence/`)),
    true
  );
});
