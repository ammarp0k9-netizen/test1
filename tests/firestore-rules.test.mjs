import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  collectionGroup,
  deleteField,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  where
} from 'firebase/firestore';

const projectId = 'demo-lootlingua';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const environment = await initializeTestEnvironment({
  projectId,
  firestore: { rules }
});

const paths = {
  publishedWorld: 'content_worlds/published-world',
  draftWorld: 'content_worlds/draft-world',
  publishedRank: 'content_worlds/published-world/ranks/published-rank',
  draftRank: 'content_worlds/published-world/ranks/draft-rank',
  publishedGate: 'content_worlds/published-world/ranks/published-rank/gates/published-gate',
  draftGate: 'content_worlds/published-world/ranks/published-rank/gates/draft-gate',
  publishedWord: 'content_worlds/published-world/ranks/published-rank/gates/published-gate/words/sword',
  hiddenWord: 'content_worlds/published-world/ranks/published-rank/gates/draft-gate/words/hidden',
  orphanRank: 'content_worlds/missing-world/ranks/orphan-rank',
  orphanGate: 'content_worlds/published-world/ranks/missing-rank/gates/orphan-gate',
  orphanWord: 'content_worlds/published-world/ranks/published-rank/gates/missing-gate/words/orphan-word',
  lockedRank: 'content_worlds/published-world/ranks/backend-locked-rank',
  lockedRankChildGate: 'content_worlds/published-world/ranks/backend-locked-rank/gates/locked-rank-child',
  lockedGate: 'content_worlds/published-world/ranks/published-rank/gates/backend-locked-gate',
  copyLockedGate: 'content_worlds/published-world/ranks/published-rank/gates/backend-copy-locked-gate',
  lockedGateWord: 'content_worlds/published-world/ranks/published-rank/gates/backend-locked-gate/words/locked-word',
  operationLockedWorld: 'content_worlds/operation-locked-world',
  operationLockedRank: 'content_worlds/operation-locked-world/ranks/locked-rank',
  operationLockedGate: 'content_worlds/operation-locked-world/ranks/locked-rank/gates/locked-gate',
  operationLockedWord: 'content_worlds/operation-locked-world/ranks/locked-rank/gates/locked-gate/words/locked-word',
  legacyWorld: 'content_worlds/legacy-default-world',
  legacyRank: 'content_worlds/legacy-default-world/ranks/legacy-default-rank',
  legacyGate: 'content_worlds/legacy-default-world/ranks/legacy-default-rank/gates/legacy-default-gate',
  legacyWord: 'content_worlds/legacy-default-world/ranks/legacy-default-rank/gates/legacy-default-gate/words/legacy-default-word',
  stagingWord: `content_word_import_staging/staging_${'a'.repeat(64)}`,
  progress: 'users/user-a/contentProgress/published-world',
  membership: 'users/user-a/contentWords/sword',
  journeyWorld: 'content_worlds/journey-world',
  journeyRank: 'content_worlds/journey-world/ranks/journey-rank',
  journeyGate: 'content_worlds/journey-world/ranks/journey-rank/gates/journey-gate',
  journeyNextGate: 'content_worlds/journey-world/ranks/journey-rank/gates/journey-gate-next',
  journeyWord: 'content_worlds/journey-world/ranks/journey-rank/gates/journey-gate/words/journey-word',
  journeyHashedWord:
    'content_worlds/journey-world/ranks/journey-rank/gates/journey-gate/words/word_first_gate_hash',
  secondJourneyWorld: 'content_worlds/journey-world-two',
  secondJourneyRank: 'content_worlds/journey-world-two/ranks/journey-rank-two',
  secondJourneyGate: 'content_worlds/journey-world-two/ranks/journey-rank-two/gates/journey-gate-two',
  lockedJourneyWorld: 'content_worlds/locked-journey-world',
  lockedJourneyRank: 'content_worlds/locked-journey-world/ranks/locked-journey-rank',
  lockedJourneyGate: 'content_worlds/locked-journey-world/ranks/locked-journey-rank/gates/locked-journey-gate',
  levelWorld: 'content_worlds/level-world',
  levelRankA1: 'content_worlds/level-world/ranks/level-rank-a1',
  levelGateA1: 'content_worlds/level-world/ranks/level-rank-a1/gates/level-gate-a1',
  levelWordA1: 'content_worlds/level-world/ranks/level-rank-a1/gates/level-gate-a1/words/level-word-a1',
  levelRankA2: 'content_worlds/level-world/ranks/level-rank-a2',
  levelGateA2: 'content_worlds/level-world/ranks/level-rank-a2/gates/level-gate-a2',
  levelWordA2: 'content_worlds/level-world/ranks/level-rank-a2/gates/level-gate-a2/words/level-word-a2'
};

const unlockConfig = {
  mode: 'manual_placeholder',
  initialStatus: 'available',
  requiredMasteredRatio: null,
  requiredReviewingRatio: null,
  requiredGateCount: null
};

const timestamp = new Date('2026-01-01T00:00:00.000Z');

function world(worldId, status) {
  return {
    worldId,
    slug: worldId,
    title: worldId,
    status,
    version: 1,
    rankCount: 3,
    gateCount: 2,
    wordCount: 2,
    schemaVersion: 1,
    order: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: 'seed',
    updatedBy: 'seed'
  };
}

function rank(worldId, rankId, status) {
  return {
    worldId,
    rankId,
    title: rankId,
    order: 0,
    status,
    unlockConfig,
    gateCount: 0,
    wordCount: 0,
    version: 1,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: 'seed',
    updatedBy: 'seed'
  };
}

function gate(worldId, rankId, gateId, status) {
  return {
    worldId,
    rankId,
    gateId,
    title: gateId,
    order: 0,
    status,
    version: 1,
    wordCount: 0,
    entryAssessmentPassRatio: null,
    unlockConfig,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: 'seed',
    updatedBy: 'seed'
  };
}

function word(worldId, rankId, gateId, contentWordId, status) {
  return {
    normalizationVersion: 1,
    worldId,
    rankId,
    gateId,
    contentWordId,
    word: contentWordId,
    normalizedWord: contentWordId,
    wordKey: contentWordId,
    translation: 'معنى',
    order: 0,
    status,
    version: 1,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: 'seed',
    updatedBy: 'seed'
  };
}

function stagingWord(stagingWordId, uid = 'admin-a') {
  return {
    stagingWordId,
    importBatchId: 'import_batch_a',
    sourceFileName: 'batch-a.json',
    sourceOrder: 0,
    schemaVersion: 1,
    normalizationVersion: 1,
    word: 'staged',
    normalizedWord: 'staged',
    wordKey: 'staged',
    translation: 'مؤقت',
    order: 0,
    stagingStatus: 'pending',
    importedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid
  };
}

function journey(worldId, rankId, gateId) {
  return {
    worldId,
    activeRankId: rankId,
    activeGateId: gateId,
    status: 'active',
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    journeyVersion: 1,
    placementStatus: 'not-started',
    activePlacementAssessmentId: '',
    unlockedRankIds: [rankId],
    unlockedGateIds: [gateId]
  };
}

function entryExperienceState(overrides = {}) {
  return {
    contractVersion: 1,
    experienceVersion: 1,
    status: 'in-progress',
    audience: 'returning',
    classification: 'returning-light',
    currentStep: 'interests',
    interestsStatus: 'pending',
    interestIds: [],
    themeStatus: 'preserved',
    themeId: 'ocean',
    oasisMode: 'dark',
    themeExplicit: false,
    actionStatus: 'pending',
    source: 'app-entry',
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
    skippedAt: null,
    ...overrides
  };
}

function entryExperienceV2State(overrides = {}) {
  return {
    contractVersion: 2,
    experienceVersion: 2,
    status: 'in-progress',
    audience: 'returning',
    classification: 'returning-light',
    currentStep: 'interests',
    interestsStatus: 'pending',
    interestIds: [],
    themeStatus: 'preserved',
    themeId: 'ocean',
    oasisMode: 'dark',
    themeExplicit: false,
    journeyStatus: 'pending',
    selectedWorldId: '',
    gamerStatus: 'not-applicable',
    source: 'app-entry',
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
    skippedAt: null,
    ...overrides
  };
}

function fullProductionProfilePayload(overrides = {}) {
  return {
    userXP: 125,
    xpEconomyVersion: 2,
    dailyStreak: 4,
    maxStreak: 7,
    lastActivityDate: '2026-08-01',
    activityMap: { '2026-08-01': 3 },
    quizExposureHistory: [{ sessionId: 'quiz-session-a', at: 1 }],
    theme: 'ocean',
    oasisMode: 'dark',
    themeIntroSeen: ['lootlingua', 'ocean'],
    displayName: 'Legacy Player',
    addedGameWords: ['sword'],
    dailyLootState: { totalOpens: 2, rewards: [] },
    titlesState: { unlocked: ['first-loot'], lastUnlockedAt: { 'first-loot': 1 } },
    activeTitleId: 'first-loot',
    dailyQuestDate: '2026-08-01',
    dailyQuestState: { claimed: {}, flags: {} },
    streakFreezes: 1,
    freezeSaves: 1,
    gameDictAdds: 2,
    perfectQuizzes: 1,
    extraChests: [{ id: 'chest-a', type: 'daily', earnedAt: 1 }],
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function placementSession(
  assessmentId = 'placement_v1_journey-rank~journey-gate',
  overrides = {}
) {
  return {
    assessmentId,
    worldId: 'journey-world',
    rankId: 'journey-rank',
    currentGateId: 'journey-gate',
    currentQuestionIndex: 0,
    orderedContentWordIds: ['journey-word'],
    orderedWordKeys: ['journey-word'],
    answers: [],
    correctCount: 0,
    totalQuestions: 1,
    passThreshold: 0.75,
    requiredCorrect: 1,
    status: 'active',
    source: 'placement',
    suppressRewards: true,
    answersComplete: false,
    wordsLinked: true,
    gateProgressSaved: false,
    placementCompleted: false,
    nextGateUnlocked: false,
    completionStep: 'answering',
    placementVersion: 1,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function levelPlacementSession(assessmentId, overrides = {}) {
  const selectedWord = {
    questionId: 'level-question-a1',
    rankId: 'level-rank-a1',
    gateId: 'level-gate-a1',
    contentWordId: 'level-word-a1',
    wordKey: 'level-word-a1',
    order: 0,
    word: 'level-word-a1',
    translation: 'meaning',
    passThreshold: 0.75,
    category: '',
    partOfSpeech: '',
    definition: '',
    definition_ar: '',
    example: '',
    exampleTranslation: '',
    level: '',
    tags: [],
    synonyms: [],
    pronunciation: '',
    notes: ''
  };
  return {
    assessmentId,
    worldId: 'level-world',
    cefrLevel: 'A1',
    status: 'active',
    assessmentSeed: 'level-world:A1:rules-test',
    orderedQuestionIds: ['level-question-a1'],
    selectedContentWordIds: ['level-word-a1'],
    selectedWords: [selectedWord],
    answers: [],
    currentQuestionIndex: 0,
    correctCount: 0,
    placementVersion: 1,
    perRankStats: {},
    ambiguousRankIds: [],
    recommendedStartRankId: '',
    recommendedStartGateId: '',
    passedRankIds: [],
    passedPrefixLength: 0,
    passedLevel: false,
    orderedRankIds: ['level-rank-a1'],
    rankTitles: { 'level-rank-a1': 'A1 Rank' },
    rankFirstGateIds: { 'level-rank-a1': 'level-gate-a1' },
    rankCoverage: { 'level-rank-a1': { requested: 1, selected: 1, reserve: 0, weak: true } },
    adaptiveReserveIdsByRank: { 'level-rank-a1': [] },
    adaptiveRound: 0,
    adaptiveRankIds: [],
    saveWordChoice: 'undecided',
    saveWordPendingIds: [],
    saveWordSavedIds: [],
    saveWordFailures: [],
    saveWordSummary: {
      created: 0,
      sourceLinked: 0,
      alreadyLinked: 0,
      restoredReady: 0,
      failed: 0
    },
    source: 'level-placement',
    suppressRewards: true,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides
  };
}

function availableGateProgress(worldId, rankId, gateId) {
  return {
    worldId,
    rankId,
    gateId,
    status: 'available',
    journeyVersion: 1,
    lastActivityAt: serverTimestamp(),
    readyEvidenceCount: 0,
    clearAttempts: 0
  };
}

function learningGateProgress(
  worldId,
  rankId,
  gateId,
  contentWordIds,
  nextRankId = rankId,
  nextGateId = 'journey-gate-next'
) {
  return {
    worldId,
    rankId,
    gateId,
    status: 'learning',
    journeyVersion: 1,
    lastActivityAt: serverTimestamp(),
    readyEvidenceCount: 0,
    clearAttempts: 0,
    loadedAt: serverTimestamp(),
    wordCountAtLoad: contentWordIds.length,
    contentVersion: 1,
    snapshotVersion: 1,
    loadedContentWordIds: contentWordIds,
    loadedWordKeys: contentWordIds,
    nextRankId,
    nextGateId,
    loadStrategy: 'deterministic-source-docs-v1',
    operationId: 'gate_test_operation'
  };
}

async function seed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const documents = [
      [paths.publishedWorld, world('published-world', 'published')],
      [paths.draftWorld, world('draft-world', 'draft')],
      [paths.publishedRank, rank('published-world', 'published-rank', 'published')],
      [paths.draftRank, rank('published-world', 'draft-rank', 'draft')],
      [paths.publishedGate, gate('published-world', 'published-rank', 'published-gate', 'published')],
      [paths.draftGate, gate('published-world', 'published-rank', 'draft-gate', 'draft')],
      [paths.publishedWord, word('published-world', 'published-rank', 'published-gate', 'sword', 'published')],
      [paths.hiddenWord, word('published-world', 'published-rank', 'draft-gate', 'hidden', 'published')],
      [paths.orphanRank, rank('missing-world', 'orphan-rank', 'published')],
      [paths.orphanGate, gate('published-world', 'missing-rank', 'orphan-gate', 'published')],
      [paths.orphanWord, word('published-world', 'published-rank', 'missing-gate', 'orphan-word', 'published')],
      [paths.lockedRank, {
        ...rank('published-world', 'backend-locked-rank', 'draft'),
        _adminRankOperation: { operationKey: 'backend-operation', action: 'duplicateContentRank' }
      }],
      [paths.lockedGate, {
        ...gate('published-world', 'published-rank', 'backend-locked-gate', 'draft'),
        _adminGateOperation: { operationKey: 'backend-operation', action: 'moveContentGate' }
      }],
      [paths.lockedRankChildGate,
        gate('published-world', 'backend-locked-rank', 'locked-rank-child', 'draft')],
      [paths.copyLockedGate, {
        ...gate('published-world', 'published-rank', 'backend-copy-locked-gate', 'draft'),
        _adminGateCopyOperation: 'backend-copy-operation'
      }],
      [paths.lockedGateWord,
        word('published-world', 'published-rank', 'backend-locked-gate', 'locked-word', 'draft')],
      [paths.operationLockedWorld, {
        ...world('operation-locked-world', 'draft'),
        _adminWorldOperation: {
          operationKey: 'gate-operation',
          action: 'moveContentGate',
          leaseAt: timestamp
        }
      }],
      [paths.operationLockedRank,
        rank('operation-locked-world', 'locked-rank', 'draft')],
      [paths.operationLockedGate,
        gate('operation-locked-world', 'locked-rank', 'locked-gate', 'draft')],
      [paths.operationLockedWord,
        word('operation-locked-world', 'locked-rank', 'locked-gate', 'locked-word', 'draft')],
      [paths.journeyWorld, world('journey-world', 'published')],
      [paths.journeyRank, rank('journey-world', 'journey-rank', 'published')],
      [paths.journeyGate, gate('journey-world', 'journey-rank', 'journey-gate', 'published')],
      [paths.journeyNextGate, {
        ...gate(
          'journey-world',
          'journey-rank',
          'journey-gate-next',
          'published'
        ),
        order: 1
      }],
      [paths.journeyWord,
        word('journey-world', 'journey-rank', 'journey-gate', 'journey-word', 'published')],
      [paths.journeyHashedWord, {
        ...word(
          'journey-world',
          'journey-rank',
          'journey-gate',
          'word_first_gate_hash',
          'published'
        ),
        word: 'I',
        normalizedWord: 'i',
        wordKey: 'i'
      }],
      [paths.secondJourneyWorld, world('journey-world-two', 'published')],
      [paths.secondJourneyRank,
        rank('journey-world-two', 'journey-rank-two', 'published')],
      [paths.secondJourneyGate,
        gate('journey-world-two', 'journey-rank-two', 'journey-gate-two', 'published')],
      [paths.lockedJourneyWorld, world('locked-journey-world', 'published')],
      [paths.lockedJourneyRank, {
        ...rank('locked-journey-world', 'locked-journey-rank', 'published'),
        unlockConfig: { ...unlockConfig, initialStatus: 'locked' }
      }],
      [paths.lockedJourneyGate,
        gate(
          'locked-journey-world',
          'locked-journey-rank',
          'locked-journey-gate',
          'published'
        )],
      [paths.levelWorld, world('level-world', 'published')],
      [paths.levelRankA1, {
        ...rank('level-world', 'level-rank-a1', 'published'),
        cefrLevel: 'A1'
      }],
      [paths.levelGateA1,
        gate('level-world', 'level-rank-a1', 'level-gate-a1', 'published')],
      [paths.levelWordA1,
        word('level-world', 'level-rank-a1', 'level-gate-a1', 'level-word-a1', 'published')],
      [paths.levelRankA2, {
        ...rank('level-world', 'level-rank-a2', 'published'),
        cefrLevel: 'A2',
        unlockConfig: { ...unlockConfig, initialStatus: 'locked' }
      }],
      [paths.levelGateA2,
        gate('level-world', 'level-rank-a2', 'level-gate-a2', 'published')],
      [paths.levelWordA2,
        word('level-world', 'level-rank-a2', 'level-gate-a2', 'level-word-a2', 'published')],
      [paths.progress, { worldId: 'published-world', status: 'active', activeRankId: 'published-rank' }],
      [paths.membership, {
        canonicalId: 'sword',
        normalizationVersion: 1,
        normalizedWord: 'sword',
        masteryKey: 'sword',
        word: 'Sword',
        translation: 'سيف',
        meaning: 'سيف',
        forgetCount: 0,
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      }],
      [`${paths.membership}/sources/source-a`, { worldId: 'published-world', rankId: 'published-rank' }],
      ['admin_audit_logs/log-a', { action: 'seed' }]
    ];
    await Promise.all(documents.map(([path, data]) => setDoc(doc(db, path), data)));
  });
}

let passed = 0;
let selected = 0;
const testFilter = String(process.argv[2] || '');
async function test(name, callback) {
  if (testFilter && !name.includes(testFilter)) return;
  selected += 1;
  try {
    await callback();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

try {
  await environment.clearFirestore();
  await seed();

  const anonymous = environment.unauthenticatedContext().firestore();
  const userA = environment.authenticatedContext('user-a', { email: 'a@example.test' }).firestore();
  const userB = environment.authenticatedContext('user-b').firestore();
  const admin = environment.authenticatedContext('admin-a', { admin: true }).firestore();
  const testClockAdmin = environment.authenticatedContext('test-clock-admin', {
    admin: true,
    testClock: true
  }).firestore();

  await test('Entry Experience v1 is owner-bound, version-bound, and non-deletable', async () => {
    const uid = 'entry-owner';
    const owner = environment.authenticatedContext(uid).firestore();
    const other = environment.authenticatedContext('entry-other').firestore();
    const v1Path = `users/${uid}/entryExperiences/v1`;

    await assertSucceeds(setDoc(doc(owner, v1Path), entryExperienceState()));
    await assertSucceeds(getDoc(doc(owner, v1Path)));
    await assertFails(getDoc(doc(other, v1Path)));
    await assertFails(getDoc(doc(anonymous, v1Path)));
    await assertFails(setDoc(doc(other, v1Path), entryExperienceState()));
    await assertFails(setDoc(
      doc(owner, `users/${uid}/entryExperiences/v2`),
      entryExperienceState({ experienceVersion: 2 })
    ));
    await assertFails(setDoc(
      doc(environment.authenticatedContext('entry-invalid-version').firestore(),
        'users/entry-invalid-version/entryExperiences/v1'),
      entryExperienceState({ contractVersion: 2 })
    ));
    const missingTerminalTimestamp = entryExperienceState();
    delete missingTerminalTimestamp.skippedAt;
    await assertFails(setDoc(
      doc(environment.authenticatedContext('entry-missing-field').firestore(),
        'users/entry-missing-field/entryExperiences/v1'),
      missingTerminalTimestamp
    ));
    await assertFails(setDoc(
      doc(environment.authenticatedContext('entry-extra-field').firestore(),
        'users/entry-extra-field/entryExperiences/v1'),
      { ...entryExperienceState(), unexpectedField: true }
    ));
    await assertFails(setDoc(
      doc(environment.authenticatedContext('entry-new-skip').firestore(),
        'users/entry-new-skip/entryExperiences/v1'),
      entryExperienceState({
        status: 'skipped',
        currentStep: 'action',
        skippedAt: serverTimestamp()
      })
    ));
    await assertFails(deleteDoc(doc(owner, v1Path)));
  });

  await test('Entry Experience completion is monotonic and preserves immutable identity fields', async () => {
    const uid = 'entry-completed-owner';
    const db = environment.authenticatedContext(uid).firestore();
    const reference = doc(db, `users/${uid}/entryExperiences/v1`);

    await assertSucceeds(setDoc(reference, entryExperienceState({
      audience: 'returning',
      classification: 'returning-with-progress'
    })));
    await assertSucceeds(updateDoc(reference, {
      currentStep: 'theme',
      interestsStatus: 'selected',
      interestIds: ['games', 'study'],
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      audience: 'new',
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      classification: 'brand-new',
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(reference, {
      status: 'completed',
      currentStep: 'action',
      themeStatus: 'selected',
      themeId: 'ocean',
      oasisMode: 'dark',
      themeExplicit: true,
      actionStatus: 'completed',
      completedAt: serverTimestamp(),
      skippedAt: null,
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(reference, {
      source: 'settings',
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      status: 'in-progress',
      currentStep: 'theme',
      completedAt: null,
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      status: 'skipped',
      currentStep: 'action',
      completedAt: null,
      skippedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertFails(deleteDoc(reference));
  });

  await test('Entry Experience v2 is owner-bound, proof-gated, monotonic, and independent from v1', async () => {
    const uid = 'entry-v2-owner';
    const owner = environment.authenticatedContext(uid).firestore();
    const other = environment.authenticatedContext('entry-v2-other').firestore();
    const reference = doc(owner, `users/${uid}/entryExperiences/v2`);

    await assertSucceeds(setDoc(reference, entryExperienceV2State()));
    await assertSucceeds(getDoc(reference));
    await assertFails(getDoc(doc(other, `users/${uid}/entryExperiences/v2`)));
    await assertFails(setDoc(
      doc(other, `users/${uid}/entryExperiences/v2`),
      entryExperienceV2State()
    ));
    await assertFails(setDoc(
      doc(anonymous, `users/${uid}/entryExperiences/v2`),
      entryExperienceV2State()
    ));
    await assertFails(setDoc(
      doc(owner, `users/${uid}/entryExperiences/v1`),
      entryExperienceV2State()
    ));

    await assertSucceeds(updateDoc(reference, {
      currentStep: 'worlds',
      interestsStatus: 'selected',
      interestIds: ['study'],
      themeStatus: 'selected',
      themeExplicit: true,
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(reference, {
      currentStep: 'journey',
      journeyStatus: 'world-selected',
      selectedWorldId: 'published-world-study',
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(reference, {
      journeyStatus: 'structure-explored',
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(reference, {
      currentStep: 'destination',
      gamerStatus: 'not-applicable',
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      status: 'completed',
      journeyStatus: 'pending',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      audience: 'new',
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      classification: 'brand-new',
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(reference, {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    const completedEntrySnapshot = await getDoc(reference);
    await assertSucceeds(setDoc(reference, {
      ...completedEntrySnapshot.data(),
      source: 'settings',
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      status: 'in-progress',
      currentStep: 'journey',
      completedAt: null,
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertFails(deleteDoc(reference));

    const invalidUid = 'entry-v2-invalid';
    const invalidDb = environment.authenticatedContext(invalidUid).firestore();
    const invalidReference = doc(invalidDb, `users/${invalidUid}/entryExperiences/v2`);
    const missingField = entryExperienceV2State();
    delete missingField.gamerStatus;
    await assertFails(setDoc(invalidReference, missingField));
    await assertFails(setDoc(invalidReference, {
      ...entryExperienceV2State(),
      journeyProgress: { gateId: 'forged-progress' }
    }));

    const completedJourneyUid = 'entry-v2-completed-journey';
    const completedJourneyDb = environment.authenticatedContext(completedJourneyUid).firestore();
    const completedJourneyReference = doc(
      completedJourneyDb,
      `users/${completedJourneyUid}/entryExperiences/v2`
    );
    const completedJourneyStartedAt = Timestamp.fromMillis(1000);
    await assertSucceeds(setDoc(completedJourneyReference, entryExperienceV2State({
      status: 'in-progress',
      audience: 'returning',
      classification: 'returning-with-progress',
      currentStep: 'return',
      journeyStatus: 'pending',
      startedAt: completedJourneyStartedAt
    })));
    await assertSucceeds(setDoc(completedJourneyReference, entryExperienceV2State({
      status: 'completed',
      audience: 'returning',
      classification: 'returning-with-progress',
      currentStep: 'destination',
      journeyStatus: 'return-reviewed',
      selectedWorldId: '',
      startedAt: completedJourneyStartedAt,
      completedAt: serverTimestamp()
    })));

    const newCompletedUid = 'entry-v2-new-completed';
    const newCompletedDb = environment.authenticatedContext(newCompletedUid).firestore();
    await assertSucceeds(setDoc(
      doc(newCompletedDb, `users/${newCompletedUid}/entryExperiences/v2`),
      entryExperienceV2State({
        status: 'completed',
        audience: 'returning',
        classification: 'returning-with-progress',
        currentStep: 'destination',
        journeyStatus: 'return-reviewed',
        completedAt: serverTimestamp()
      })
    ));
  });

  await test('Entry Experience v2 upgrades only a recognizable older shape into the strict current schema', async () => {
    const uid = 'entry-v2-older-shape';
    const owner = environment.authenticatedContext(uid).firestore();
    const reference = doc(owner, `users/${uid}/entryExperiences/v2`);
    const startedAt = Timestamp.fromMillis(1000);
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${uid}/entryExperiences/v2`), {
        contractVersion: 2,
        experienceVersion: 2,
        status: 'in-progress',
        audience: 'returning',
        classification: 'returning-with-progress',
        currentStep: 'return',
        interestsStatus: 'selected',
        interestIds: ['study'],
        themeStatus: 'preserved',
        themeId: 'lootlingua',
        themeExplicit: false,
        actionStatus: 'ready',
        source: 'app-entry',
        startedAt,
        updatedAt: Timestamp.fromMillis(2000),
        completedAt: null,
        skippedAt: null
      });
    });
    await assertSucceeds(setDoc(reference, entryExperienceV2State({
      status: 'completed',
      audience: 'returning',
      classification: 'returning-with-progress',
      currentStep: 'destination',
      journeyStatus: 'return-reviewed',
      startedAt,
      completedAt: serverTimestamp()
    })));

    const malformedUid = 'entry-v2-malformed-version';
    const malformedDb = environment.authenticatedContext(malformedUid).firestore();
    const malformedReference = doc(
      malformedDb,
      `users/${malformedUid}/entryExperiences/v2`
    );
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${malformedUid}/entryExperiences/v2`), {
        status: 'in-progress',
        audience: 'returning',
        classification: 'returning-with-progress',
        startedAt,
        completedAt: null
      });
    });
    await assertFails(setDoc(malformedReference, entryExperienceV2State({
      status: 'completed',
      audience: 'returning',
      classification: 'returning-with-progress',
      currentStep: 'destination',
      journeyStatus: 'return-reviewed',
      startedAt,
      completedAt: serverTimestamp()
    })));
  });

  await test('legacy completed/skipped v1 without first-action proof can migrate once', async () => {
    const uid = 'entry-legacy-unverified-owner';
    const db = environment.authenticatedContext(uid).firestore();
    const reference = doc(db, `users/${uid}/entryExperiences/v1`);

    await environment.withSecurityRulesDisabled(async (context) => {
      const legacy = entryExperienceState({
        status: 'completed',
        audience: 'new',
        classification: 'returning-with-progress',
        currentStep: 'action',
        completedAt: serverTimestamp()
      });
      delete legacy.actionStatus;
      await setDoc(doc(context.firestore(), `users/${uid}/entryExperiences/v1`), legacy);
    });
    await assertSucceeds(updateDoc(reference, {
      status: 'in-progress',
      audience: 'returning',
      classification: 'returning-light',
      currentStep: 'interests',
      actionStatus: 'pending',
      completedAt: null,
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(reference, {
      status: 'completed',
      currentStep: 'action',
      actionStatus: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      status: 'in-progress',
      currentStep: 'interests',
      actionStatus: 'pending',
      completedAt: null,
      updatedAt: serverTimestamp()
    }));
    await assertFails(deleteDoc(reference));

    const skippedUid = 'entry-legacy-skipped-owner';
    const skippedDb = environment.authenticatedContext(skippedUid).firestore();
    const skippedReference = doc(skippedDb, `users/${skippedUid}/entryExperiences/v1`);
    await environment.withSecurityRulesDisabled(async (context) => {
      const legacy = entryExperienceState({
        status: 'skipped',
        audience: 'returning-guest',
        classification: 'returning-guest-with-local-data',
        currentStep: 'action',
        skippedAt: serverTimestamp()
      });
      delete legacy.actionStatus;
      await setDoc(doc(context.firestore(), `users/${skippedUid}/entryExperiences/v1`), legacy);
    });
    await assertSucceeds(updateDoc(skippedReference, {
      status: 'in-progress',
      currentStep: 'interests',
      actionStatus: 'pending',
      skippedAt: null,
      updatedAt: serverTimestamp()
    }));
  });

  await test('full production profile supports create and legacy merge-update without weakening fields', async () => {
    const uid = 'entry-profile-owner';
    const owner = environment.authenticatedContext(uid).firestore();
    const other = environment.authenticatedContext('entry-profile-other').firestore();
    const reference = doc(owner, `users/${uid}/meta/profile`);
    const profile = fullProductionProfilePayload();

    await assertSucceeds(setDoc(reference, profile, { merge: true }));
    await assertSucceeds(getDoc(reference));
    await assertFails(getDoc(doc(other, `users/${uid}/meta/profile`)));
    await assertSucceeds(updateDoc(reference, {
      oasisMode: 'light',
      themeIntroSeen: ['ocean'],
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      oasisMode: 'sepia',
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      themeIntroSeen: Array.from({ length: 13 }, (_, index) => `theme-${index}`),
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(reference, {
      entryExperienceStatus: 'completed',
      updatedAt: serverTimestamp()
    }));

    const legacyUid = 'entry-profile-legacy-owner';
    const legacyOwner = environment.authenticatedContext(legacyUid).firestore();
    const legacyReference = doc(legacyOwner, `users/${legacyUid}/meta/profile`);
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${legacyUid}/meta/profile`), {
        userXP: 45,
        xpEconomyVersion: 1,
        legacyBadgeState: { id: 'pre-v1-badge' },
        updatedAt: timestamp
      });
    });
    await assertSucceeds(setDoc(
      legacyReference,
      fullProductionProfilePayload({ userXP: 45, oasisMode: 'light' }),
      { merge: true }
    ));
    const legacySaved = await getDoc(legacyReference);
    assert.deepEqual(legacySaved.data().legacyBadgeState, { id: 'pre-v1-badge' });
    assert.equal(legacySaved.data().oasisMode, 'light');
    await assertFails(updateDoc(legacyReference, {
      legacyBadgeState: { id: 'tampered' },
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(legacyReference, {
      legacyBadgeState: deleteField(),
      updatedAt: serverTimestamp()
    }));
    await assertFails(setDoc(
      doc(environment.authenticatedContext('unknown-profile-create').firestore(),
        'users/unknown-profile-create/meta/profile'),
      fullProductionProfilePayload({ unknownLegacyField: true }),
      { merge: true }
    ));
  });

  await test('anonymous reads a published world but not a draft', async () => {
    await assertSucceeds(getDoc(doc(anonymous, paths.publishedWorld)));
    await assertFails(getDoc(doc(anonymous, paths.draftWorld)));
  });

  await test('public world queries must prove published status', async () => {
    await assertSucceeds(getDocs(query(
      collection(anonymous, 'content_worlds'),
      where('status', '==', 'published'),
      orderBy('order')
    )));
    await assertFails(getDocs(collection(anonymous, 'content_worlds')));
  });

  await test('public rank and gate queries must prove published status', async () => {
    const ranks = collection(
      anonymous,
      'content_worlds/published-world/ranks'
    );
    const gates = collection(
      anonymous,
      'content_worlds/published-world/ranks/published-rank/gates'
    );
    await assertSucceeds(getDocs(query(
      ranks,
      where('status', '==', 'published'),
      orderBy('order'),
      orderBy(documentId())
    )));
    await assertSucceeds(getDocs(query(
      gates,
      where('status', '==', 'published'),
      orderBy('order'),
      orderBy(documentId())
    )));
    await assertFails(getDocs(query(ranks, orderBy('order'))));
    await assertFails(getDocs(query(gates, orderBy('order'))));
  });

  await test('published reads require fully published ancestry', async () => {
    await assertSucceeds(getDoc(doc(userA, paths.publishedRank)));
    await assertSucceeds(getDoc(doc(userA, paths.publishedGate)));
    await assertSucceeds(getDoc(doc(userA, paths.publishedWord)));
    await assertFails(getDoc(doc(userA, paths.draftRank)));
    await assertFails(getDoc(doc(userA, paths.hiddenWord)));
  });

  await test('public word pagination queries must prove published status', async () => {
    const words = collection(
      anonymous,
      'content_worlds/published-world/ranks/published-rank/gates/published-gate/words'
    );
    await assertSucceeds(getDocs(query(
      words,
      where('status', '==', 'published'),
      orderBy('order'),
      orderBy(documentId()),
      limit(1)
    )));
    await assertFails(getDocs(query(words, orderBy('order'), limit(1))));
  });

  await test('an admin can inspect an exact word inside a draft gate without broad collection reads', async () => {
    const draftWords = collection(
      admin,
      'content_worlds/published-world/ranks/published-rank/gates/draft-gate/words'
    );
    await assertSucceeds(getDoc(doc(admin, paths.hiddenWord)));
    await assertSucceeds(getDocs(query(
      draftWords,
      where('normalizedWord', '==', 'hidden'),
      limit(1)
    )));
    await assertFails(getDoc(doc(userA, paths.hiddenWord)));
  });

  await test('an admin cannot use the shared words collection group to inspect prepared content', async () => {
    await assertFails(getDocs(query(
      collectionGroup(admin, 'words'),
      where('worldId', '==', 'published-world'),
      where('normalizedWord', '==', 'hidden'),
      limit(1)
    )));
  });

  await test('missing published ancestors fail closed', async () => {
    await assertFails(getDoc(doc(userA, paths.orphanRank)));
    await assertFails(getDoc(doc(userA, paths.orphanGate)));
    await assertFails(getDoc(doc(userA, paths.orphanWord)));
  });

  await test('a normal user cannot write prepared content', async () => {
    await assertFails(setDoc(doc(userA, 'content_worlds/forged'), world('forged', 'published')));
    await assertFails(updateDoc(doc(userA, paths.publishedWorld), { title: 'forged' }));
  });

  await test('prepared parent deletion is backend-only even for an admin client', async () => {
    await assertFails(deleteDoc(doc(admin, paths.publishedWorld)));
  });

  await test('a normal user cannot self-assign an admin document', async () => {
    await assertFails(setDoc(doc(userA, 'admins/user-a'), { admin: true }));
  });

  await test('audit logs are admin-readable and client-write-protected', async () => {
    await assertFails(getDoc(doc(userA, 'admin_audit_logs/log-a')));
    await assertSucceeds(getDoc(doc(admin, 'admin_audit_logs/log-a')));
    await assertFails(setDoc(doc(admin, 'admin_audit_logs/client-forged'), { action: 'forged' }));
  });

  await test('Test Clock is owner-bound and requires its separate admin claim', async () => {
    const normalUserPath = 'users/user-a/testSettings/clock';
    const normalAdminPath = 'users/admin-a/testSettings/clock';
    const authorizedPath = 'users/test-clock-admin/testSettings/clock';
    const validClock = {
      version: 1,
      offsetMs: 86_400_000,
      updatedAt: serverTimestamp(),
      updatedBy: 'test-clock-admin'
    };

    await assertFails(setDoc(doc(userA, normalUserPath), {
      ...validClock,
      updatedBy: 'user-a'
    }));
    await assertFails(setDoc(doc(admin, normalAdminPath), {
      ...validClock,
      updatedBy: 'admin-a'
    }));
    await assertSucceeds(setDoc(doc(testClockAdmin, authorizedPath), validClock));
    await assertSucceeds(getDoc(doc(testClockAdmin, authorizedPath)));
    await assertFails(getDoc(doc(userA, authorizedPath)));
    await assertFails(setDoc(doc(testClockAdmin, authorizedPath), {
      ...validClock,
      offsetMs: 31_536_000_001
    }));
    await assertFails(setDoc(doc(testClockAdmin, authorizedPath), {
      ...validClock,
      unexpected: true
    }));
    await assertSucceeds(updateDoc(doc(testClockAdmin, authorizedPath), {
      offsetMs: -3_600_000,
      updatedAt: serverTimestamp()
    }));
    await assertFails(deleteDoc(doc(testClockAdmin, authorizedPath)));
  });

  await test('progress is account-bound and backend-write-only', async () => {
    await assertSucceeds(getDoc(doc(userA, paths.progress)));
    await assertFails(getDoc(doc(userB, paths.progress)));
    await assertFails(setDoc(doc(userA, 'users/user-a/contentProgress/forged'), {
      worldId: 'forged',
      status: 'completed',
      userXP: 999999
    }));
    await assertFails(setDoc(doc(userA, 'users/user-b/contentProgress/forged'), { status: 'active' }));
  });

  await test('an owner can create one valid journey with its active pointer and available gate', async () => {
    const batch = writeBatch(userA);
    batch.set(
      doc(userA, 'users/user-a/contentProgress/journey-world'),
      journey('journey-world', 'journey-rank', 'journey-gate')
    );
    batch.set(doc(userA, 'users/user-a/meta/active_content_journey'), {
      worldId: 'journey-world',
      journeyVersion: 1,
      updatedAt: serverTimestamp()
    });
    batch.set(
      doc(userA, 'users/user-a/contentProgress/journey-world/ranks/journey-rank/gates/journey-gate'),
      availableGateProgress('journey-world', 'journey-rank', 'journey-gate')
    );
    await assertSucceeds(batch.commit());
    const saved = await getDoc(doc(userA, 'users/user-a/contentProgress/journey-world'));
    assert.equal(saved.data().status, 'active');
    assert.deepEqual(saved.data().unlockedGateIds, ['journey-gate']);

    const forgedUid = 'forged-cleared-journey-user';
    const forgedDb = environment.authenticatedContext(forgedUid).firestore();
    const forged = writeBatch(forgedDb);
    forged.set(doc(forgedDb, `users/${forgedUid}/contentProgress/journey-world`), {
      ...journey('journey-world', 'journey-rank', 'journey-gate'),
      levelPlacementClearedGateIds: ['journey-gate']
    });
    forged.set(doc(forgedDb, `users/${forgedUid}/meta/active_content_journey`), {
      worldId: 'journey-world',
      journeyVersion: 1,
      updatedAt: serverTimestamp()
    });
    forged.set(
      doc(forgedDb, `users/${forgedUid}/contentProgress/journey-world/ranks/journey-rank/gates/journey-gate`),
      availableGateProgress('journey-world', 'journey-rank', 'journey-gate')
    );
    await assertFails(forged.commit());
  });

  await test('the exact legacy auto-reconcile batch reproduces the Rules expression-budget rejection', async () => {
    const uid = '2YWSZ8MdhPZBsqRqTozZvtTbzt83';
    const worldId = 'GyQfaD75uZFFpgB9Me9V';
    const activeRankId = 'R4NDhUw0L0gXgSwkbE1O';
    const activeGateId = 'fP49BRVyujuU4UqzUoey';
    const rankId = 'gw7HL4JwTwKDUpCs2JcF';
    const gateId = 'RaXFlTd649dE8rd1z7NJ';
    const oldRankIds = [
      activeRankId,
      'zH10H8d3GZcdMyy9HRx2',
      'VsRcZlJP3hV2hNL6Thl1',
      'VVSBrZ9o2F4eQUfaCqnf'
    ];
    const oldGateIds = [
      'PfMYVlBAQbLLBfwNLjxK', 'oo6iPLccdQVpCXVaDKTn',
      '9o3feiTttxfgwV3GoLgJ', activeGateId,
      'UiHVqnI0ZxLIGpci7HHQ', 'Oy4uz4EuFZWzGoKfzEGs',
      'kfolf55CkWaygyhF9hFr', '5Cj1ym8uBqKxBpejBEZD',
      '2MMu6H8lyTQFKpNFqOTE', '7Fus2JsckzAaXCaYoKCt',
      'n50we3pVJ7f4zfOnhUhr', '6FYCntPzwjY00TlP8ZIU',
      'AuMcDxTIJoVvTtrL3rnd', 'qH3NaXWyrUV6PNtpncSH',
      'UVnHgqemvxfBN2CQXqBd', 'Dkr1iUxgUGMCMvs6niQy',
      'qrmQ8QMpCs9DWtgZwrXu', 'UY2dbtZZfEO0vx1zROwY',
      'mLh27X6CxxqAAnfjjOaM'
    ];
    const parentPath = `users/${uid}/contentProgress/${worldId}`;
    const pointerPath = `users/${uid}/meta/active_content_journey`;
    const progressPath = `${parentPath}/ranks/${rankId}/gates/${gateId}`;
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, `content_worlds/${worldId}`), world(worldId, 'published')),
        setDoc(doc(db, `content_worlds/${worldId}/ranks/${activeRankId}`), {
          ...rank(worldId, activeRankId, 'published'),
          cefrLevel: 'A1'
        }),
        setDoc(doc(db, `content_worlds/${worldId}/ranks/${activeRankId}/gates/${activeGateId}`),
          gate(worldId, activeRankId, activeGateId, 'published')),
        setDoc(doc(db, `content_worlds/${worldId}/ranks/${rankId}`), {
          ...rank(worldId, rankId, 'published'),
          cefrLevel: 'A1',
          unlockConfig: { ...unlockConfig, initialStatus: 'locked' }
        }),
        setDoc(doc(db, `content_worlds/${worldId}/ranks/${rankId}/gates/${gateId}`),
          gate(worldId, rankId, gateId, 'published')),
        setDoc(doc(db, parentPath), {
          worldId,
          activeRankId,
          activeGateId,
          status: 'active',
          startedAt: timestamp,
          updatedAt: timestamp,
          journeyVersion: 1,
          placementStatus: 'completed',
          activePlacementAssessmentId: '',
          unlockedRankIds: oldRankIds,
          unlockedGateIds: oldGateIds,
          activeLevelPlacementAssessmentId: '',
          activeLevelPlacementCefrLevel: '',
          levelPlacementStatus: 'abandoned',
          levelPlacementVersion: 1,
          passedCefrLevels: ['A1'],
          partialCefrLevels: []
        }),
        setDoc(doc(db, pointerPath), {
          worldId,
          journeyVersion: 1,
          updatedAt: timestamp
        })
      ]);
    });

    const exactUser = environment.authenticatedContext(uid).firestore();
    const batch = writeBatch(exactUser);
    batch.update(doc(exactUser, parentPath), {
      unlockedRankIds: [...oldRankIds, rankId],
      unlockedGateIds: [...oldGateIds, gateId],
      contentJourneyStatus: 'in-progress',
      updatedAt: serverTimestamp()
    });
    batch.set(
      doc(exactUser, progressPath),
      availableGateProgress(worldId, rankId, gateId)
    );
    await assertFails(batch.commit());
    await assertFails(updateDoc(doc(exactUser, parentPath), {
      unlockedRankIds: [...oldRankIds, rankId],
      unlockedGateIds: [...oldGateIds, gateId],
      contentJourneyStatus: 'in-progress',
      updatedAt: serverTimestamp()
    }));
    console.log(
      '# exact failing predicate: contentProgress update -> validJourneyUpdate -> ' +
      'validJourneyNewRankReconcile exceeds the 1000-expression Rules budget'
    );
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), parentPath), {
        unlockedRankIds: [...oldRankIds, rankId],
        unlockedGateIds: [...oldGateIds, gateId],
        contentJourneyStatus: 'in-progress',
        updatedAt: timestamp
      }, { merge: true });
    });
    await assertSucceeds(setDoc(
      doc(exactUser, progressPath),
      availableGateProgress(worldId, rankId, gateId)
    ));
    const [parent, progress] = await Promise.all([
      getDoc(doc(exactUser, parentPath)),
      getDoc(doc(exactUser, progressPath))
    ]);
    assert.equal(parent.data().activeRankId, activeRankId);
    assert.equal(parent.data().activeGateId, activeGateId);
    assert.equal(parent.data().unlockedRankIds.includes(rankId), true);
    assert.equal(parent.data().unlockedGateIds.includes(gateId), true);
    assert.equal(progress.data().status, 'available');
  });

  await test('accepts the full new-ranks Level Placement start batch with required rankVersions', async () => {
    const uid = '2YWSZ8MdhPZBsqRqTozZvtTbzt83';
    const worldId = 'GyQfaD75uZFFpgB9Me9V';
    const assessmentId =
      'level_placement_v2_A1_GyQfaD75uZFFpgB9Me9V_A1__y7yd65';
    const activeRankId = 'R4NDhUw0L0gXgSwkbE1O';
    const activeGateId = 'fP49BRVyujuU4UqzUoey';
    const oldRankIds = [
      activeRankId,
      'zH10H8d3GZcdMyy9HRx2',
      'VsRcZlJP3hV2hNL6Thl1',
      'VVSBrZ9o2F4eQUfaCqnf'
    ];
    const newRankIds = ['gw7HL4JwTwKDUpCs2JcF', 'MSvvFKsy1uZYpQ1g2mV8'];
    const firstGateIds = {
      gw7HL4JwTwKDUpCs2JcF: 'RaXFlTd649dE8rd1z7NJ',
      MSvvFKsy1uZYpQ1g2mV8: 'K7DipPCJItok3sJtmzOc'
    };
    const oldGateIds = [
      'PfMYVlBAQbLLBfwNLjxK', 'oo6iPLccdQVpCXVaDKTn',
      '9o3feiTttxfgwV3GoLgJ', activeGateId,
      'UiHVqnI0ZxLIGpci7HHQ', 'Oy4uz4EuFZWzGoKfzEGs',
      'kfolf55CkWaygyhF9hFr', '5Cj1ym8uBqKxBpejBEZD',
      '2MMu6H8lyTQFKpNFqOTE', '7Fus2JsckzAaXCaYoKCt',
      'n50we3pVJ7f4zfOnhUhr', '6FYCntPzwjY00TlP8ZIU',
      'AuMcDxTIJoVvTtrL3rnd', 'qH3NaXWyrUV6PNtpncSH',
      'UVnHgqemvxfBN2CQXqBd', 'Dkr1iUxgUGMCMvs6niQy',
      'qrmQ8QMpCs9DWtgZwrXu', 'UY2dbtZZfEO0vx1zROwY',
      'mLh27X6CxxqAAnfjjOaM'
    ];
    const selected = [
      ['gw7HL4JwTwKDUpCs2JcF', 'RaXFlTd649dE8rd1z7NJ', 'word_61d9432cf2fd4c49850fc9e125460ce0a2550b6a716da1092277acd6b0409695', 'school', 2, 'مدرسة'],
      ['gw7HL4JwTwKDUpCs2JcF', 'RaXFlTd649dE8rd1z7NJ', 'word_28e90243e862bca1f3ee7a7d9143b1fbc66935dbaa1e7a437d3d87aacaa6e463', 'shop', 3, 'متجر'],
      ['gw7HL4JwTwKDUpCs2JcF', 'YFc34mAfG6SkydCdrlJu', 'word_2f68dbaa206ab719f036064e609a275cc2c7df3ddb9e6d261047baf8f550f544', 'place', 1, 'مكان'],
      ['gw7HL4JwTwKDUpCs2JcF', 'YFc34mAfG6SkydCdrlJu', 'word_33aec5a3db8ae13631db1bfdf5aaeb6a020fe18208d37246b6eba62848b0f15f', 'street', 4, 'شارع'],
      ['gw7HL4JwTwKDUpCs2JcF', '50noBdFPkjb67n6gs9iH', 'word_b96a6824f60b5718beb8135b6040f23001d5228673e3357a737a085e7d18a561', 'park', 6, 'منتزه'],
      ['gw7HL4JwTwKDUpCs2JcF', '50noBdFPkjb67n6gs9iH', 'word_c666e17e5f3fceea1d0aebb24de68238da5a772da15bd718235c3757b240f218', 'farm', 18, 'مزرعة'],
      ['MSvvFKsy1uZYpQ1g2mV8', 'K7DipPCJItok3sJtmzOc', 'word_773eb1d60b6c6673ae6dc207efcb32e4328f9c3b829b34497d1d07e14a305445', 'wake', 1, 'يستيقظ'],
      ['MSvvFKsy1uZYpQ1g2mV8', 'K7DipPCJItok3sJtmzOc', 'word_fa443ce151dcc24e65e518dff8d561d23920fa84e46874b9ec1b1793c76dbd73', 'sleep', 2, 'ينام'],
      ['MSvvFKsy1uZYpQ1g2mV8', 'TPHgACcOd1Fxd2XPGqdW', 'word_b7636564b25ffbee3ecaf02aea91eb114f44dc66087b630d6a7442bf521c892f', 'make', 8, 'يصنع'],
      ['MSvvFKsy1uZYpQ1g2mV8', 'TPHgACcOd1Fxd2XPGqdW', 'word_be0f9b4f1f8675c2d3578509eef669616e0e517b3e43b4350afe234868f45db7', 'use', 10, 'يستخدم'],
      ['MSvvFKsy1uZYpQ1g2mV8', 'xTvzdmrsu8M8Gpm4qnHs', 'word_eebcd534482c27c4aa6d34c43da4f87a52eb114bc21da8883fdb33279e3cea01', 'walk', 17, 'يمشي'],
      ['MSvvFKsy1uZYpQ1g2mV8', 'xTvzdmrsu8M8Gpm4qnHs', 'word_f90633fd63523fb47cd9c04870f0aaf5d2259fa57f8fc04ce29bd904d062bba1', 'run', 18, 'يركض']
    ].map(([rankId, gateId, contentWordId, wordKey, order, translation], index) => ({
      questionId: `new-rank-question-${index + 1}`,
      rankId,
      gateId,
      contentWordId,
      wordKey,
      order,
      word: wordKey,
      translation,
      passThreshold: 0.75,
      category: '',
      partOfSpeech: '',
      definition: '',
      definition_ar: '',
      example: '',
      exampleTranslation: '',
      level: 'A1',
      tags: [],
      synonyms: [],
      pronunciation: '',
      notes: ''
    }));
    const primary = [selected[0], selected[1], selected[2], selected[3],
      selected[6], selected[7], selected[8], selected[9]];
    const reserveByRank = {
      [newRankIds[0]]: [selected[4].questionId, selected[5].questionId],
      [newRankIds[1]]: [selected[10].questionId, selected[11].questionId]
    };
    const session = levelPlacementSession(assessmentId, {
      worldId,
      cefrLevel: 'A1',
      assessmentSeed: `${worldId}:A1:production-shaped-emulator-payload`,
      orderedQuestionIds: primary.map((item) => item.questionId),
      selectedContentWordIds: selected.map((item) => item.contentWordId),
      selectedWords: selected,
      placementVersion: 2,
      assessmentMode: 'new-ranks',
      previousAssessmentId: 'level_placement_v2_A1_legacy',
      testedRankIds: newRankIds,
      assessedRankIds: [...oldRankIds, ...newRankIds],
      assessedRankVersions: {
        [newRankIds[0]]: 5,
        [newRankIds[1]]: 6
      },
      publishedRankSetHash: 'exact-six-rank-snapshot',
      rankVersions: {
        [newRankIds[0]]: 5,
        [newRankIds[1]]: 6
      },
      orderedRankIds: newRankIds,
      rankTitles: {
        [newRankIds[0]]: 'الأماكن والاتجاهات',
        [newRankIds[1]]: 'الأفعال اليومية والحركة'
      },
      rankFirstGateIds: firstGateIds,
      rankCoverage: {
        [newRankIds[0]]: { requested: 4, selected: 4, reserve: 2, weak: false },
        [newRankIds[1]]: { requested: 4, selected: 4, reserve: 2, weak: false }
      },
      adaptiveReserveIdsByRank: reserveByRank
    });
    assert.equal(session.assessedRankIds.length, 6);
    assert.equal(Object.keys(session.assessedRankVersions).length, 2);
    assert.equal(session.testedRankIds.length, 2);
    assert.equal(session.orderedQuestionIds.length, 8);
    assert.equal(session.selectedWords.length, 12);
    assert.equal(session.selectedContentWordIds.length, 12);
    assert.equal(Object.values(session.adaptiveReserveIdsByRank).flat().length, 4);
    assert.deepEqual(session.rankVersions, {
      [newRankIds[0]]: 5,
      [newRankIds[1]]: 6
    });
    const parent = {
      worldId,
      activeRankId,
      activeGateId,
      status: 'active',
      startedAt: timestamp,
      updatedAt: timestamp,
      journeyVersion: 1,
      placementStatus: 'completed',
      activePlacementAssessmentId: '',
      unlockedRankIds: oldRankIds,
      unlockedGateIds: oldGateIds,
      activeLevelPlacementAssessmentId: '',
      activeLevelPlacementCefrLevel: '',
      levelPlacementStatus: 'abandoned',
      levelPlacementVersion: 1,
      passedCefrLevels: ['A1'],
      partialCefrLevels: [],
      contentJourneyStatus: 'in-progress',
      levelPlacementAssessmentIds: {
        A1: 'level_placement_v2_A1_legacy'
      },
      levelPlacementPassedRankIds: oldRankIds
    };
    const seedCase = async (caseUid, options = {}) => {
      const parentPath = `users/${caseUid}/contentProgress/${worldId}`;
      const sessionPath = `${parentPath}/levelPlacementSessions/${assessmentId}`;
      await environment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await Promise.all([
          setDoc(doc(db, `content_worlds/${worldId}`), world(worldId, 'published')),
          setDoc(doc(db, `content_worlds/${worldId}/ranks/${activeRankId}`), {
            ...rank(worldId, activeRankId, 'published'), cefrLevel: 'A1'
          }),
          setDoc(doc(db, `content_worlds/${worldId}/ranks/${activeRankId}/gates/${activeGateId}`),
            gate(worldId, activeRankId, activeGateId, 'published')),
          setDoc(doc(db, parentPath), {
            ...parent,
            ...(options.parentActive ? {
              activeLevelPlacementAssessmentId: assessmentId,
              activeLevelPlacementCefrLevel: 'A1',
              levelPlacementStatus: 'active',
              levelPlacementVersion: 2
            } : {})
          }),
          setDoc(doc(db, `users/${caseUid}/meta/active_content_journey`), {
            worldId,
            journeyVersion: 1,
            updatedAt: timestamp
          }),
          ...(options.seedSession ? [setDoc(doc(db, sessionPath), {
            ...session,
            startedAt: timestamp,
            updatedAt: timestamp
          })] : [])
        ]);
      });
      return { parentPath, sessionPath };
    };

    const sessionOnlyUid = `${uid}-session-only`;
    const sessionOnlyPaths = await seedCase(sessionOnlyUid, { parentActive: true });
    const sessionOnlyDb = environment.authenticatedContext(sessionOnlyUid).firestore();
    await assertSucceeds(setDoc(doc(sessionOnlyDb, sessionOnlyPaths.sessionPath), session));

    const parentOnlyUid = `${uid}-parent-only`;
    const parentOnlyPaths = await seedCase(parentOnlyUid, { seedSession: true });
    const parentOnlyDb = environment.authenticatedContext(parentOnlyUid).firestore();
    await assertSucceeds(updateDoc(doc(parentOnlyDb, parentOnlyPaths.parentPath), {
      activeLevelPlacementAssessmentId: assessmentId,
      activeLevelPlacementCefrLevel: 'A1',
      levelPlacementStatus: 'active',
      levelPlacementVersion: 2,
      placementStatus: 'completed',
      passedCefrLevels: ['A1'],
      updatedAt: serverTimestamp()
    }));

    const paths = await seedCase(uid);
    const exactDb = environment.authenticatedContext(uid).firestore();
    const batch = writeBatch(exactDb);
    batch.set(doc(exactDb, paths.sessionPath), session);
    batch.update(doc(exactDb, paths.parentPath), {
      activeLevelPlacementAssessmentId: assessmentId,
      activeLevelPlacementCefrLevel: 'A1',
      levelPlacementStatus: 'active',
      levelPlacementVersion: 2,
      placementStatus: 'completed',
      passedCefrLevels: ['A1'],
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
    const savedSessions = await getDocs(collection(
      exactDb,
      `${paths.parentPath}/levelPlacementSessions`
    ));
    assert.equal(savedSessions.size, 1);
    const savedParent = await getDoc(doc(exactDb, paths.parentPath));
    assert.equal(savedParent.data().activeLevelPlacementAssessmentId, assessmentId);
    console.log(
      '# full new-ranks start: required rankVersions present; ' +
      'session-create=pass, parent-update=pass, combined-batch=pass'
    );
  });

  await test('a locked initial rank cannot be used to create a journey', async () => {
    const batch = writeBatch(userA);
    batch.update(doc(userA, 'users/user-a/contentProgress/journey-world'), {
      status: 'paused',
      updatedAt: serverTimestamp()
    });
    batch.set(
      doc(userA, 'users/user-a/contentProgress/locked-journey-world'),
      journey('locked-journey-world', 'locked-journey-rank', 'locked-journey-gate')
    );
    batch.set(doc(userA, 'users/user-a/meta/active_content_journey'), {
      worldId: 'locked-journey-world',
      journeyVersion: 1,
      updatedAt: serverTimestamp()
    });
    await assertFails(batch.commit());
  });

  await test('journey documents reject XP fields and future gate states', async () => {
    await assertFails(updateDoc(doc(userA, 'users/user-a/contentProgress/journey-world'), {
      userXP: 1000,
      updatedAt: serverTimestamp()
    }));
    await assertFails(setDoc(
      doc(userA, 'users/user-a/contentProgress/journey-world/ranks/journey-rank/gates/journey-gate'),
      {
        ...learningGateProgress(
          'journey-world',
          'journey-rank',
          'journey-gate',
          ['journey-word']
        ),
        status: 'cleared'
      }
    ));
  });

  await test('available gate progress can become learning but cannot become mastered', async () => {
    const progressPath =
      'users/user-a/contentProgress/journey-world/ranks/journey-rank/gates/journey-gate';
    await assertFails(setDoc(doc(userA, progressPath), {
      ...learningGateProgress(
        'journey-world',
        'journey-rank',
        'journey-gate',
        ['journey-word']
      ),
      snapshotVersion: 0
    }));
    await assertSucceeds(setDoc(
      doc(userA, progressPath),
      learningGateProgress(
        'journey-world',
        'journey-rank',
        'journey-gate',
        ['journey-word']
      )
    ));
    await assertFails(setDoc(doc(userA, progressPath), {
      ...learningGateProgress(
        'journey-world',
        'journey-rank',
        'journey-gate',
        ['journey-word']
      ),
      status: 'mastered'
    }));
  });

  await test('mastery or a direct client write cannot clear a learning gate', async () => {
    const journeyPath = 'users/user-a/contentProgress/journey-world';
    const currentPath =
      `${journeyPath}/ranks/journey-rank/gates/journey-gate`;
    await assertFails(setDoc(doc(userA, currentPath), {
      ...learningGateProgress(
        'journey-world',
        'journey-rank',
        'journey-gate',
        ['journey-word']
      ),
      status: 'cleared',
      masteryComplete: true
    }));
  });

  await test('clients cannot forge masteryComplete on learning, ready, or cleared Gates', async () => {
    const progressPath =
      'users/user-a/contentProgress/journey-world/ranks/journey-rank/gates/journey-gate';
    const savedSnapshot = await getDoc(doc(userA, progressPath));
    const saved = savedSnapshot.data();
    await assertFails(updateDoc(doc(userA, progressPath), {
      masteryComplete: true,
      lastActivityAt: serverTimestamp()
    }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), progressPath), { status: 'ready' });
    });
    await assertFails(updateDoc(doc(userA, progressPath), {
      masteryComplete: true,
      lastActivityAt: serverTimestamp()
    }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), progressPath), { status: 'cleared' });
    });
    await assertFails(updateDoc(doc(userA, progressPath), {
      masteryComplete: true,
      lastActivityAt: serverTimestamp()
    }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), progressPath), saved);
    });
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), progressPath), {
        masteryComplete: true
      });
    });
    await assertFails(updateDoc(doc(userA, progressPath), {
      masteryComplete: false,
      lastActivityAt: serverTimestamp()
    }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), progressPath), saved);
    });
  });

  await test('word mastery merge keeps mastered_once monotonic across stale device saves', async () => {
    const masteryRef = doc(userA, 'users/user-a/meta/word_mastery');
    await setDoc(masteryRef, {
      entries: {
        gate_mastery_merge_probe: {
          mastery_status: 'Mastered',
          mastered_once: true
        }
      },
      updatedAt: serverTimestamp()
    }, { merge: true });
    await setDoc(masteryRef, {
      entries: {
        gate_mastery_merge_probe: {
          mastery_status: 'Reviewing'
        }
      },
      updatedAt: serverTimestamp()
    }, { merge: true });
    const snapshot = await getDoc(masteryRef);
    assert.equal(
      snapshot.data().entries.gate_mastery_merge_probe.mastered_once,
      true
    );
  });

  await test('a passing Placement session clears the gate and unlocks exactly the next gate', async () => {
    const journeyPath = 'users/user-a/contentProgress/journey-world';
    const currentPath =
      `${journeyPath}/ranks/journey-rank/gates/journey-gate`;
    const assessmentId = 'placement_v1_journey-rank~journey-gate';
    const sessionPath = `${journeyPath}/placementSessions/${assessmentId}`;

    await assertSucceeds(updateDoc(doc(userA, journeyPath), {
      placementStatus: 'active',
      activePlacementAssessmentId: '',
      updatedAt: serverTimestamp()
    }));
    const createSessionBatch = writeBatch(userA);
    createSessionBatch.update(doc(userA, journeyPath), {
      activePlacementAssessmentId: assessmentId,
      updatedAt: serverTimestamp()
    });
    createSessionBatch.set(
      doc(userA, sessionPath),
      placementSession(assessmentId)
    );
    await assertSucceeds(createSessionBatch.commit());

    await assertSucceeds(updateDoc(doc(userA, sessionPath), {
      currentQuestionIndex: 1,
      answers: [{
        contentWordId: 'journey-word',
        wordKey: 'journey-word',
        selectedContentWordId: 'journey-word',
        correct: true,
        seenAt: Date.now()
      }],
      correctCount: 1,
      status: 'submitting',
      answersComplete: true,
      completionStep: 'answers-saved',
      updatedAt: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(userA, currentPath), {
      status: 'cleared',
      clearedAt: serverTimestamp(),
      clearedBy: 'placement',
      placementScore: 0.5,
      placementCorrect: 1,
      placementTotal: 1,
      placementAssessmentId: assessmentId,
      lastActivityAt: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(userA, currentPath), {
      status: 'cleared',
      clearedAt: serverTimestamp(),
      clearedBy: 'placement',
      placementScore: 1,
      placementCorrect: 1,
      placementTotal: 1,
      placementAssessmentId: assessmentId,
      lastActivityAt: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(userA, sessionPath), {
      status: 'completed',
      outcome: 'passed',
      score: 1,
      rankCompletedByPlacement: false,
      gateProgressSaved: true,
      placementCompleted: true,
      nextGateUnlocked: true,
      completionStep: 'result-saved',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(doc(userA, journeyPath), {
      activeRankId: 'journey-rank',
      activeGateId: 'journey-gate-next',
      activePlacementAssessmentId: '',
      unlockedRankIds: ['journey-rank'],
      unlockedGateIds: ['journey-gate', 'journey-gate-next'],
      updatedAt: serverTimestamp()
    }));

    const [savedJourney, cleared] = await Promise.all([
      getDoc(doc(userA, journeyPath)),
      getDoc(doc(userA, currentPath))
    ]);
    assert.equal(savedJourney.data().activeGateId, 'journey-gate-next');
    assert.equal(cleared.data().status, 'cleared');
    assert.equal(savedJourney.data().unlockedGateIds.includes('journey-gate-next'), true);
  });

  await test('a failed Placement session stays learning and stops the chain', async () => {
    const journeyPath = 'users/user-a/contentProgress/journey-world';
    const gatePath =
      `${journeyPath}/ranks/journey-rank/gates/journey-gate-next`;
    const assessmentId = 'placement_v1_journey-rank~journey-gate-next';
    const sessionPath = `${journeyPath}/placementSessions/${assessmentId}`;
    await assertSucceeds(setDoc(
      doc(userA, gatePath),
      learningGateProgress(
        'journey-world',
        'journey-rank',
        'journey-gate-next',
        ['journey-next-word'],
        '',
        ''
      )
    ));
    const createSessionBatch = writeBatch(userA);
    createSessionBatch.update(doc(userA, journeyPath), {
      activePlacementAssessmentId: assessmentId,
      updatedAt: serverTimestamp()
    });
    createSessionBatch.set(doc(userA, sessionPath), placementSession(assessmentId, {
      currentGateId: 'journey-gate-next',
      orderedContentWordIds: ['journey-next-word']
    }));
    await assertSucceeds(createSessionBatch.commit());

    await assertSucceeds(updateDoc(doc(userA, sessionPath), {
      currentQuestionIndex: 1,
      answers: [{
        contentWordId: 'journey-next-word',
        wordKey: 'journey-word',
        selectedContentWordId: 'journey-word',
        correct: false,
        seenAt: Date.now()
      }],
      correctCount: 0,
      status: 'submitting',
      answersComplete: true,
      completionStep: 'answers-saved',
      updatedAt: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(userA, gatePath), {
      placementScore: 0,
      placementCorrect: 0,
      placementTotal: 1,
      placementAssessmentId: assessmentId,
      lastActivityAt: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(userA, sessionPath), {
      status: 'completed',
      outcome: 'failed',
      score: 0,
      rankCompletedByPlacement: false,
      gateProgressSaved: true,
      placementCompleted: true,
      nextGateUnlocked: false,
      completionStep: 'result-saved',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(doc(userA, journeyPath), {
      placementStatus: 'completed',
      activePlacementAssessmentId: '',
      updatedAt: serverTimestamp()
    }));

    const [savedJourney, savedGate] = await Promise.all([
      getDoc(doc(userA, journeyPath)),
      getDoc(doc(userA, gatePath))
    ]);
    assert.equal(savedJourney.data().placementStatus, 'completed');
    assert.equal(savedJourney.data().activeGateId, 'journey-gate-next');
    assert.equal(savedGate.data().status, 'learning');
  });

  await test('a 4/10 Placement failure saves the exact browser payload', async () => {
    const uid = 'placement-diagnostic-user';
    const worldId = 'placement-diagnostic-world';
    const rankId = 'R4NDhUw0L0gXgSwkbE1O';
    const gateId = 'fP49BRVyujuU4UqzUoey';
    const assessmentId =
      'placement_v1_20_R4NDhUw0L0gXgSwkbE1O_20_fP49BRVyujuU4UqzUoey';
    const journeyPath = `users/${uid}/contentProgress/${worldId}`;
    const gatePath = `${journeyPath}/ranks/${rankId}/gates/${gateId}`;
    const sessionPath = `${journeyPath}/placementSessions/${assessmentId}`;
    const wordIds = Array.from({ length: 10 }, (_, index) => `placement-word-${index + 1}`);
    const answers = wordIds.map((contentWordId, index) => ({
      contentWordId,
      wordKey: contentWordId,
      selectedContentWordId: index < 4
        ? contentWordId
        : wordIds[(index + 1) % wordIds.length],
      correct: index < 4,
      seenAt: Date.now() + index
    }));

    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, `content_worlds/${worldId}`), world(worldId, 'published')),
        setDoc(
          doc(db, `content_worlds/${worldId}/ranks/${rankId}`),
          rank(worldId, rankId, 'published')
        ),
        setDoc(
          doc(db, `content_worlds/${worldId}/ranks/${rankId}/gates/${gateId}`),
          gate(worldId, rankId, gateId, 'published')
        ),
        setDoc(doc(db, journeyPath), {
          ...journey(worldId, rankId, gateId),
          placementStatus: 'active',
          activePlacementAssessmentId: assessmentId
        }),
        setDoc(doc(db, `users/${uid}/meta/active_content_journey`), {
          worldId,
          journeyVersion: 1,
          updatedAt: timestamp
        }),
        setDoc(
          doc(db, gatePath),
          learningGateProgress(worldId, rankId, gateId, wordIds, '', '')
        ),
        setDoc(doc(db, sessionPath), placementSession(assessmentId, {
          worldId,
          rankId,
          currentGateId: gateId,
          currentQuestionIndex: 10,
          orderedContentWordIds: wordIds,
          orderedWordKeys: wordIds,
          answers,
          correctCount: 4,
          totalQuestions: 10,
          requiredCorrect: 8,
          status: 'submitting',
          answersComplete: true,
          completionStep: 'answers-saved',
          startedAt: timestamp,
          updatedAt: timestamp
        }))
      ]);
    });

    const diagnosticDb = environment.authenticatedContext(uid).firestore();
    const [journeySnapshot, gateSnapshot, sessionSnapshot] = await Promise.all([
      getDoc(doc(diagnosticDb, journeyPath)),
      getDoc(doc(diagnosticDb, gatePath)),
      getDoc(doc(diagnosticDb, sessionPath))
    ]);
    const actualJourney = journeySnapshot.data();
    const actualGate = gateSnapshot.data();
    const actualSession = sessionSnapshot.data();

    const payload = {
      status: 'learning',
      placementScore: 0.4,
      placementCorrect: 4,
      placementTotal: 10,
      placementAssessmentId: assessmentId,
      lastActivityAt: serverTimestamp()
    };
    const allowedChangedKeys = new Set([
      'status', 'clearedAt', 'clearedBy', 'placementScore',
      'placementCorrect', 'placementTotal', 'placementAssessmentId',
      'lastActivityAt'
    ]);
    const predicateResults = {
      before_status_is_learning: actualGate.status === 'learning',
      affected_keys_are_allowed: Object.keys(payload).every((key) => allowedChangedKeys.has(key)),
      world_id_is_immutable: actualGate.worldId === worldId,
      rank_id_is_immutable: actualGate.rankId === rankId,
      gate_id_is_immutable: actualGate.gateId === gateId,
      assessment_id_is_non_empty: assessmentId.length > 0 && assessmentId.length <= 500,
      score_is_number: Number.isFinite(payload.placementScore),
      correct_is_integer: Number.isInteger(payload.placementCorrect),
      total_is_integer: Number.isInteger(payload.placementTotal),
      total_is_positive: payload.placementTotal > 0,
      correct_is_non_negative: payload.placementCorrect >= 0,
      correct_does_not_exceed_total: payload.placementCorrect <= payload.placementTotal,
      payload_score_matches_counts:
        payload.placementScore === payload.placementCorrect / payload.placementTotal,
      session_status_is_submitting: actualSession.status === 'submitting',
      session_answers_are_complete:
        actualSession.currentQuestionIndex === actualSession.totalQuestions &&
        actualSession.answersComplete === true,
      session_rank_matches_path: actualSession.rankId === rankId,
      session_gate_matches_path: actualSession.currentGateId === gateId,
      payload_correct_matches_session:
        payload.placementCorrect === actualSession.correctCount,
      payload_total_matches_session:
        payload.placementTotal === actualSession.totalQuestions,
      payload_score_matches_session:
        payload.placementScore === actualSession.correctCount / actualSession.totalQuestions,
      journey_is_active: actualJourney.status === 'active',
      journey_placement_is_active: actualJourney.placementStatus === 'active',
      journey_assessment_is_current:
        actualJourney.activePlacementAssessmentId === assessmentId,
      journey_rank_matches_session: actualJourney.activeRankId === actualSession.rankId,
      journey_gate_matches_session: actualJourney.activeGateId === actualSession.currentGateId,
      failed_branch_matches:
        actualSession.correctCount < actualSession.requiredCorrect &&
        payload.status === 'learning' &&
        !Object.hasOwn(payload, 'clearedAt') &&
        !Object.hasOwn(payload, 'clearedBy')
    };
    Object.entries(predicateResults).forEach(([name, value]) => {
      assert.equal(value, true, `predicate failed: ${name}`);
    });

    await assertSucceeds(updateDoc(doc(diagnosticDb, gatePath), payload));
    await assertSucceeds(updateDoc(doc(diagnosticDb, sessionPath), {
      status: 'completed',
      outcome: 'failed',
      score: 0.4,
      rankCompletedByPlacement: false,
      gateProgressSaved: true,
      placementCompleted: true,
      nextGateUnlocked: false,
      completionStep: 'result-saved',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(doc(diagnosticDb, journeyPath), {
      placementStatus: 'completed',
      activePlacementAssessmentId: '',
      updatedAt: serverTimestamp()
    }));
    const savedGate = await getDoc(doc(diagnosticDb, gatePath));
    const savedSession = await getDoc(doc(diagnosticDb, sessionPath));
    const savedJourney = await getDoc(doc(diagnosticDb, journeyPath));
    assert.equal(savedGate.data().status, 'learning');
    assert.equal(savedGate.data().placementScore, 0.4);
    assert.equal(savedGate.data().placementCorrect, 4);
    assert.equal(savedGate.data().placementTotal, 10);
    assert.equal(savedGate.data().placementAssessmentId, assessmentId);
    assert.deepEqual(savedGate.data().loadedContentWordIds, wordIds);
    assert.equal(savedSession.data().currentQuestionIndex, 10);
    assert.equal(savedSession.data().answers.length, 10);
    assert.equal(savedSession.data().status, 'completed');
    assert.equal(savedJourney.data().placementStatus, 'completed');
  });

  await test('Placement sessions are owner-only and reject reward or inconsistent count fields', async () => {
    const sessionPath =
      'users/user-a/contentProgress/journey-world/placementSessions/forged-placement';
    await assertFails(getDoc(doc(userB, sessionPath)));
    await assertFails(setDoc(doc(userA, sessionPath), placementSession('forged-placement', {
      userXP: 500
    })));
    await assertFails(setDoc(doc(userA, sessionPath), placementSession('forged-placement', {
      correctCount: 1
    })));
  });

  await test('starting another world switches the active pointer without deleting old progress', async () => {
    const batch = writeBatch(userA);
    batch.update(doc(userA, 'users/user-a/contentProgress/journey-world'), {
      status: 'paused',
      updatedAt: serverTimestamp()
    });
    batch.set(
      doc(userA, 'users/user-a/contentProgress/journey-world-two'),
      journey('journey-world-two', 'journey-rank-two', 'journey-gate-two')
    );
    batch.set(doc(userA, 'users/user-a/meta/active_content_journey'), {
      worldId: 'journey-world-two',
      journeyVersion: 1,
      updatedAt: serverTimestamp()
    });
    batch.set(
      doc(userA, 'users/user-a/contentProgress/journey-world-two/ranks/journey-rank-two/gates/journey-gate-two'),
      availableGateProgress('journey-world-two', 'journey-rank-two', 'journey-gate-two')
    );
    await assertSucceeds(batch.commit());
    const [oldJourney, activePointer] = await Promise.all([
      getDoc(doc(userA, 'users/user-a/contentProgress/journey-world')),
      getDoc(doc(userA, 'users/user-a/meta/active_content_journey'))
    ]);
    assert.equal(oldJourney.exists(), true);
    assert.equal(oldJourney.data().status, 'paused');
    assert.equal(activePointer.data().worldId, 'journey-world-two');
  });

  await test('a user cannot read or write another account journey', async () => {
    await assertFails(getDoc(doc(userB, 'users/user-a/contentProgress/journey-world')));
    await assertFails(setDoc(
      doc(userB, 'users/user-a/contentProgress/forged-world'),
      journey('journey-world', 'journey-rank', 'journey-gate')
    ));
  });

  await test('an owner can link a published word once with a structured source', async () => {
    const sourceId = 'published_journey-world~journey-rank~journey-gate~journey-word';
    const canonicalPath = 'users/user-a/contentWords/journey-word';
    const sourcePath = `${canonicalPath}/sources/${sourceId}`;
    const pausedBatch = writeBatch(userA);
    pausedBatch.set(doc(userA, canonicalPath), {
      canonicalId: 'journey-word',
      normalizationVersion: 1,
      normalizedWord: 'journey-word',
      masteryKey: 'journey-word',
      legacyWordId: 'published_journey-word',
      word: 'journey-word',
      forgetCount: 0,
      primarySource: {
        worldId: 'journey-world',
        rankId: 'journey-rank',
        gateId: 'journey-gate',
        contentWordId: 'journey-word',
        sourceId,
        addedFrom: 'published-gate'
      },
      sourceCount: 1,
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    pausedBatch.set(doc(userA, sourcePath), {
      worldId: 'journey-world',
      rankId: 'journey-rank',
      gateId: 'journey-gate',
      contentWordId: 'journey-word',
      addedFrom: 'published-gate',
      operationId: 'paused_attempt',
      linkedAt: serverTimestamp()
    });
    await assertFails(pausedBatch.commit());

    const batch = writeBatch(userA);
    batch.update(doc(userA, 'users/user-a/contentProgress/journey-world-two'), {
      status: 'paused',
      updatedAt: serverTimestamp()
    });
    batch.update(doc(userA, 'users/user-a/contentProgress/journey-world'), {
      status: 'active',
      updatedAt: serverTimestamp()
    });
    batch.set(doc(userA, 'users/user-a/meta/active_content_journey'), {
      worldId: 'journey-world',
      journeyVersion: 1,
      updatedAt: serverTimestamp()
    });
    batch.set(doc(userA, canonicalPath), {
      canonicalId: 'journey-word',
      normalizationVersion: 1,
      normalizedWord: 'journey-word',
      masteryKey: 'journey-word',
      legacyWordId: 'published_journey-word',
      word: 'journey-word',
      translation: 'معنى',
      meaning: 'معنى',
      example: '',
      category: '',
      difficulty: '',
      forgetCount: 0,
      contentRefPath: paths.journeyWord,
      primarySource: {
        worldId: 'journey-world',
        rankId: 'journey-rank',
        gateId: 'journey-gate',
        contentWordId: 'journey-word',
        sourceId,
        addedFrom: 'published-gate'
      },
      sourceCount: 1,
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(userA, sourcePath), {
      worldId: 'journey-world',
      rankId: 'journey-rank',
      gateId: 'journey-gate',
      contentWordId: 'journey-word',
      addedFrom: 'published-gate',
      operationId: 'gate_test_operation',
      linkedAt: serverTimestamp()
    });
    batch.set(doc(userA, 'users/user-a/words/published_journey-word'), {
      text: 'journey-word',
      meaning: 'معنى',
      category: 'عام',
      userId: 'user-a',
      xpValue: 0,
      mastery_status: 'New',
      mastery_streak: 0,
      createdAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(userA, sourcePath)));
    await assertFails(setDoc(doc(userA, sourcePath), {
      worldId: 'journey-world',
      rankId: 'journey-rank',
      gateId: 'journey-gate',
      contentWordId: 'journey-word',
      addedFrom: 'published-gate',
      operationId: 'duplicate',
      linkedAt: serverTimestamp()
    }));
    await assertFails(setDoc(doc(userA, `${canonicalPath}/sources/forged-source-id`), {
      worldId: 'journey-world',
      rankId: 'journey-rank',
      gateId: 'journey-gate',
      contentWordId: 'journey-word',
      addedFrom: 'published-gate',
      operationId: 'duplicate',
      linkedAt: serverTimestamp()
    }));
  });

  await test('Journey links a real shaped word when contentWordId differs from wordKey', async () => {
    const sourceId =
      'published_journey-world~journey-rank~journey-gate~word_first_gate_hash';
    const canonicalPath = 'users/user-a/contentWords/i';
    const publishedWord = await getDoc(doc(userA, paths.journeyHashedWord));
    assert.equal(publishedWord.exists(), true);
    assert.equal(publishedWord.data().wordKey, 'i');
    const batch = writeBatch(userA);
    batch.set(doc(userA, canonicalPath), {
      canonicalId: 'i',
      normalizationVersion: 1,
      normalizedWord: 'i',
      masteryKey: 'i',
      legacyWordId: 'published_i',
      word: 'I',
      translation: 'أنا',
      meaning: 'أنا',
      example: '',
      category: 'People',
      difficulty: 'A1',
      forgetCount: 0,
      contentRefPath: paths.journeyHashedWord,
      primarySource: {
        worldId: 'journey-world',
        rankId: 'journey-rank',
        gateId: 'journey-gate',
        contentWordId: 'word_first_gate_hash',
        sourceId,
        addedFrom: 'published-gate'
      },
      sourceCount: 1,
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(userA, `${canonicalPath}/sources/${sourceId}`), {
      worldId: 'journey-world',
      rankId: 'journey-rank',
      gateId: 'journey-gate',
      contentWordId: 'word_first_gate_hash',
      addedFrom: 'published-gate',
      operationId: 'gate_real_payload',
      linkedAt: serverTimestamp()
    });
    batch.set(doc(userA, 'users/user-a/words/published_i'), {
      text: 'I',
      category: 'People',
      meaning: 'أنا',
      example: '',
      starred: false,
      forgetCount: 0,
      userId: 'user-a',
      xpValue: 0,
      mastery_status: 'New',
      mastery_streak: 0,
      last_recalled_at: null,
      first_recalled_at: null,
      last_recall_day: '',
      last_recall_session_id: '',
      last_quizzed_at: null,
      quiz_seen_count: 0,
      mastered_once: false,
      firstMasteredAt: null,
      hasEarnedMasteryXP: false,
      earnedTransitions: [],
      remasteryAwardCount: 0,
      xpEconomyVersion: 0,
      order: 0,
      createdAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
  });

  await test('word membership move and copy preserve Journey identity, SRS, Crown inputs, and retry safety', async () => {
    const seedLifecycleWord = async (uid, wordKey, options = {}) => {
      const legacyWordId = `legacy_${wordKey}`;
      const journeySources = options.journeySources === false ? [] : [
        {
          id: `published_journey-world~journey-rank~journey-gate~${wordKey}`,
          data: {
            worldId: 'journey-world',
            rankId: 'journey-rank',
            gateId: 'journey-gate',
            contentWordId: wordKey,
            addedFrom: 'published-gate',
            operationId: `seed_${wordKey}`,
            linkedAt: timestamp
          }
        },
        ...(options.sharedJourney ? [{
          id: `published_journey-world~journey-rank~journey-gate-next~${wordKey}`,
          data: {
            worldId: 'journey-world',
            rankId: 'journey-rank',
            gateId: 'journey-gate-next',
            contentWordId: wordKey,
            addedFrom: 'published-gate',
            operationId: `seed_shared_${wordKey}`,
            linkedAt: timestamp
          }
        }] : [])
      ];
      const personalSource = options.journeySources === false ? [{
        id: 'manual',
        data: { addedFrom: 'manual', operationId: `manual_${wordKey}`, linkedAt: timestamp }
      }] : [];
      const sources = [...journeySources, ...personalSource];
      const legacy = {
        text: wordKey,
        word: wordKey,
        normalizedWord: wordKey,
        wordKey,
        translation: `meaning-${wordKey}`,
        meaning: `meaning-${wordKey}`,
        category: 'عام',
        userId: uid,
        xpValue: 8,
        mastery_status: options.mastered ? 'Mastered' : 'Reviewing',
        mastery_streak: options.mastered ? 3 : 2,
        mastered_once: options.mastered === true,
        hasEarnedMasteryXP: options.mastered === true,
        earnedTransitions: options.mastered ? ['reviewing_mastered'] : [],
        remasteryAwardCount: 0,
        xpEconomyVersion: 2,
        hiddenFromDictionary: options.hidden === true,
        hiddenFromDictionaryAt: options.hidden ? timestamp : null,
        personalDictionaryState: 'active',
        order: 0,
        createdAt: timestamp
      };
      await environment.withSecurityRulesDisabled(async (context) => {
        const seedDb = context.firestore();
        const canonicalPath = `users/${uid}/contentWords/${wordKey}`;
        await Promise.all([
          setDoc(doc(seedDb, canonicalPath), {
            canonicalId: wordKey,
            normalizationVersion: 1,
            normalizedWord: wordKey,
            wordKey,
            masteryKey: wordKey,
            legacyWordId,
            word: wordKey,
            translation: legacy.translation,
            meaning: legacy.meaning,
            forgetCount: 0,
            primarySource: {
              sourceId: sources[0].id,
              addedFrom: sources[0].data.addedFrom,
              ...(sources[0].data.addedFrom === 'published-gate' ? {
                worldId: 'journey-world',
                rankId: 'journey-rank',
                gateId: 'journey-gate',
                contentWordId: wordKey
              } : {})
            },
            sourceCount: sources.length,
            schemaVersion: 1,
            createdAt: timestamp,
            joinedAt: timestamp,
            updatedAt: timestamp
          }),
          setDoc(doc(seedDb, `users/${uid}/words/${legacyWordId}`), legacy),
          ...sources.map((source) => setDoc(
            doc(seedDb, `${canonicalPath}/sources/${source.id}`),
            source.data
          ))
        ]);
      });
      return { legacyWordId, legacy, sourceIds: sources.map((source) => source.id) };
    };

    const linkPrivateMembership = async (
      db,
      uid,
      wordKey,
      legacyWordId,
      worldId,
      mode,
      options = {}
    ) => {
      const canonicalRef = doc(db, `users/${uid}/contentWords/${wordKey}`);
      const legacyRef = doc(db, `users/${uid}/words/${legacyWordId}`);
      const sourceRef = doc(db, `${canonicalRef.path}/sources/private_world_${worldId}`);
      const membershipRef = doc(db, `users/${uid}/customWorlds/${worldId}/words/member_${wordKey}`);
      return runTransaction(db, async (transaction) => {
        const [canonicalSnapshot, legacySnapshot, sourceSnapshot, membershipSnapshot] =
          await Promise.all([
            transaction.get(canonicalRef),
            transaction.get(legacyRef),
            transaction.get(sourceRef),
            transaction.get(membershipRef)
          ]);
        const canonical = canonicalSnapshot.data();
        const legacy = legacySnapshot.data();
        if (!sourceSnapshot.exists()) {
          transaction.update(canonicalRef, {
            sourceCount: canonical.sourceCount + 1,
            updatedAt: serverTimestamp()
          });
          transaction.set(sourceRef, {
            addedFrom: 'private-world',
            customWorldId: worldId,
            operationId: `membership-${mode}-${worldId}-${wordKey}`,
            linkedAt: serverTimestamp()
          });
        }
        if (
          (mode === 'move' && legacy.personalDictionaryState !== 'moved-to-private-world') ||
          options.forgedXp === true
        ) {
          transaction.update(legacyRef, {
            ...(mode === 'move' ? {
              personalDictionaryState: 'moved-to-private-world'
            } : {}),
            ...(options.forgedXp === true ? { xpValue: 999999 } : {})
          });
        }
        if (!membershipSnapshot.exists()) {
          transaction.set(membershipRef, {
            ...legacy,
            personalDictionaryState: mode === 'move' ? 'moved-to-private-world' : 'active'
          });
        }
      });
    };

    const journeyUid = 'journey-membership-user';
    const journeyWordKey = 'journey-membership-word';
    const journeySeed = await seedLifecycleWord(journeyUid, journeyWordKey, {
      hidden: true,
      mastered: true,
      sharedJourney: true
    });
    const journeyDbA = environment.authenticatedContext(journeyUid).firestore();
    const journeyDbB = environment.authenticatedContext(journeyUid).firestore();

    await assertSucceeds(linkPrivateMembership(
      journeyDbA,
      journeyUid,
      journeyWordKey,
      journeySeed.legacyWordId,
      'copied-world',
      'copy'
    ));
    let legacySnapshot = await getDoc(doc(
      journeyDbA,
      `users/${journeyUid}/words/${journeySeed.legacyWordId}`
    ));
    assert.equal(legacySnapshot.data().personalDictionaryState, 'active');

    await assertFails(linkPrivateMembership(
      journeyDbA,
      journeyUid,
      journeyWordKey,
      journeySeed.legacyWordId,
      'retry-world',
      'move',
      { forgedXp: true }
    ));
    const failedRetrySource = await getDoc(doc(
      journeyDbA,
      `users/${journeyUid}/contentWords/${journeyWordKey}/sources/private_world_retry-world`
    ));
    const failedRetryMembership = await getDoc(doc(
      journeyDbA,
      `users/${journeyUid}/customWorlds/retry-world/words/member_${journeyWordKey}`
    ));
    legacySnapshot = await getDoc(doc(
      journeyDbA,
      `users/${journeyUid}/words/${journeySeed.legacyWordId}`
    ));
    assert.equal(failedRetrySource.exists(), false);
    assert.equal(failedRetryMembership.exists(), false);
    assert.equal(legacySnapshot.data().personalDictionaryState, 'active');
    assert.equal(legacySnapshot.data().xpValue, 8);
    await assertSucceeds(linkPrivateMembership(
      journeyDbA,
      journeyUid,
      journeyWordKey,
      journeySeed.legacyWordId,
      'retry-world',
      'move'
    ));

    await assertSucceeds(linkPrivateMembership(
      journeyDbA,
      journeyUid,
      journeyWordKey,
      journeySeed.legacyWordId,
      'moved-world',
      'move'
    ));
    await assertSucceeds(linkPrivateMembership(
      journeyDbA,
      journeyUid,
      journeyWordKey,
      journeySeed.legacyWordId,
      'moved-world',
      'move'
    ));
    await Promise.all([
      assertSucceeds(linkPrivateMembership(
        journeyDbA,
        journeyUid,
        journeyWordKey,
        journeySeed.legacyWordId,
        'concurrent-world',
        'copy'
      )),
      assertSucceeds(linkPrivateMembership(
        journeyDbB,
        journeyUid,
        journeyWordKey,
        journeySeed.legacyWordId,
        'concurrent-world',
        'copy'
      ))
    ]);

    const [canonicalSnapshot, movedMembership, copyMembership, concurrentMembership] =
      await Promise.all([
        getDoc(doc(journeyDbA, `users/${journeyUid}/contentWords/${journeyWordKey}`)),
        getDoc(doc(
          journeyDbA,
          `users/${journeyUid}/customWorlds/moved-world/words/member_${journeyWordKey}`
        )),
        getDoc(doc(
          journeyDbA,
          `users/${journeyUid}/customWorlds/copied-world/words/member_${journeyWordKey}`
        )),
        getDoc(doc(
          journeyDbA,
          `users/${journeyUid}/customWorlds/concurrent-world/words/member_${journeyWordKey}`
        ))
      ]);
    legacySnapshot = await getDoc(doc(
      journeyDbA,
      `users/${journeyUid}/words/${journeySeed.legacyWordId}`
    ));
    assert.equal(canonicalSnapshot.data().sourceCount, 6);
    assert.equal(legacySnapshot.data().personalDictionaryState, 'moved-to-private-world');
    assert.equal(legacySnapshot.data().hiddenFromDictionary, true);
    assert.equal(legacySnapshot.data().mastered_once, true);
    assert.equal(legacySnapshot.data().mastery_status, 'Mastered');
    assert.equal(movedMembership.exists(), true);
    assert.equal(copyMembership.exists(), true);
    assert.equal(concurrentMembership.exists(), true);
    for (const sourceId of journeySeed.sourceIds) {
      await assertSucceeds(getDoc(doc(
        journeyDbA,
        `users/${journeyUid}/contentWords/${journeyWordKey}/sources/${sourceId}`
      )));
    }

    await assertFails(updateDoc(doc(
      journeyDbA,
      `users/${journeyUid}/words/${journeySeed.legacyWordId}`
    ), {
      personalDictionaryState: 'forged-state'
    }));
    await assertFails(updateDoc(doc(
      journeyDbA,
      `users/${journeyUid}/words/${journeySeed.legacyWordId}`
    ), {
      personalDictionaryState: 'active',
      xpValue: 999999
    }));

    const personalUid = 'ordinary-membership-user';
    const personalWordKey = 'ordinary-word';
    const personalSeed = await seedLifecycleWord(personalUid, personalWordKey, {
      journeySources: false
    });
    const personalDb = environment.authenticatedContext(personalUid).firestore();
    await assertSucceeds(linkPrivateMembership(
      personalDb,
      personalUid,
      personalWordKey,
      personalSeed.legacyWordId,
      'ordinary-world',
      'move'
    ));
    const personalLegacy = await getDoc(doc(
      personalDb,
      `users/${personalUid}/words/${personalSeed.legacyWordId}`
    ));
    assert.equal(personalLegacy.data().personalDictionaryState, 'moved-to-private-world');
  });

  await test('the reported three-write gate-word payload is accepted only for the active unlocked journey', async () => {
    const worldId = 'GyQfaD75uZFFpgB9Me9V';
    const rankId = 'gw7HL4JwTwKDUpCs2JcF';
    const gateId = 'RaXFlTd649dE8rd1z7NJ';
    const fallbackGateId = 'gate-before-reported-target';
    const contentWordId =
      'word_61d9432cf2fd4c49850fc9e125460ce0a2550b6a716da1092277acd6b0409695';
    const wordKey = 'school';
    const sourceId = `published_${worldId}~${rankId}~${gateId}~${contentWordId}`;
    const operationId = `gate_${gateId}_366b45d3-b65d-419f-a771-f1492e2e3300`;
    const publishedWordPath =
      `content_worlds/${worldId}/ranks/${rankId}/gates/${gateId}/words/${contentWordId}`;

    await environment.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await Promise.all([
        setDoc(doc(seedDb, `content_worlds/${worldId}`), world(worldId, 'published')),
        setDoc(doc(seedDb, `content_worlds/${worldId}/ranks/${rankId}`), {
          ...rank(worldId, rankId, 'published'),
          cefrLevel: 'A1'
        }),
        setDoc(doc(seedDb, `content_worlds/${worldId}/ranks/${rankId}/gates/${gateId}`),
          gate(worldId, rankId, gateId, 'published')),
        setDoc(doc(seedDb, `content_worlds/${worldId}/ranks/${rankId}/gates/${fallbackGateId}`),
          gate(worldId, rankId, fallbackGateId, 'published')),
        setDoc(doc(seedDb, publishedWordPath), {
          ...word(worldId, rankId, gateId, contentWordId, 'published'),
          word: 'school',
          normalizedWord: wordKey,
          wordKey,
          translation: 'مدرسة',
          level: 'A1'
        })
      ]);
    });

    const seedUserState = async (uid, { targetUnlocked, pointerWorldId = worldId }) => {
      await environment.withSecurityRulesDisabled(async (context) => {
        const seedDb = context.firestore();
        const activeGateId = targetUnlocked ? gateId : fallbackGateId;
        await Promise.all([
          setDoc(doc(seedDb, `users/${uid}/contentProgress/${worldId}`), {
            ...journey(worldId, rankId, activeGateId),
            placementStatus: 'completed',
            unlockedRankIds: [rankId],
            unlockedGateIds: [activeGateId]
          }),
          setDoc(doc(seedDb, `users/${uid}/meta/active_content_journey`), {
            worldId: pointerWorldId,
            journeyVersion: 1,
            updatedAt: timestamp
          })
        ]);
      });
    };

    const reportedBatch = (
      uid,
      { includeLegacy = true, compactCanonical = false } = {}
    ) => {
      const db = environment.authenticatedContext(uid).firestore();
      const batch = writeBatch(db);
      const canonicalPath = `users/${uid}/contentWords/${wordKey}`;
      const canonicalPayload = {
        word: 'school',
        normalizedWord: wordKey,
        wordKey,
        translation: 'مدرسة',
        definition: 'A place where children and students learn.',
        definition_ar: 'مكان يتعلم فيه الأطفال والطلاب.',
        example: 'The school is near my house.',
        exampleTranslation: 'المدرسة قريبة من منزلي.',
        partOfSpeech: 'noun',
        category: 'Places',
        level: 'A1',
        tags: ['common', 'place'],
        synonyms: [],
        pronunciation: '',
        notes: '',
        canonicalId: wordKey,
        normalizationVersion: 1,
        masteryKey: wordKey,
        legacyWordId: 'published_school',
        meaning: 'مدرسة',
        difficulty: 'A1',
        forgetCount: 0,
        contentRefPath: publishedWordPath,
        primarySource: {
          sourceId,
          addedFrom: 'published-gate',
          worldId,
          rankId,
          gateId,
          contentWordId
        },
        sourceCount: 1,
        eligibleEvidenceCount: 0,
        lastEligibleEvidenceAt: null,
        lastEvidenceEventId: '',
        evidenceVersion: 1,
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (compactCanonical) {
        [
          'definition', 'definition_ar', 'example', 'exampleTranslation',
          'partOfSpeech', 'category', 'level', 'tags', 'synonyms',
          'pronunciation', 'notes'
        ].forEach((field) => delete canonicalPayload[field]);
      }
      batch.set(doc(db, canonicalPath), canonicalPayload);
      const legacyPayload = {
        word: 'school',
        normalizedWord: wordKey,
        wordKey,
        translation: 'مدرسة',
        definition: 'A place where children and students learn.',
        definition_ar: 'مكان يتعلم فيه الأطفال والطلاب.',
        example: 'The school is near my house.',
        exampleTranslation: 'المدرسة قريبة من منزلي.',
        partOfSpeech: 'noun',
        category: 'Places',
        level: 'A1',
        tags: ['common', 'place'],
        synonyms: [],
        pronunciation: '',
        notes: '',
        text: 'school',
        meaning: 'مدرسة',
        starred: false,
        forgetCount: 0,
        userId: uid,
        xpValue: 0,
        mastery_status: 'New',
        mastery_streak: 0,
        last_recalled_at: null,
        first_recalled_at: null,
        last_recall_day: '',
        last_recall_session_id: '',
        last_quizzed_at: null,
        quiz_seen_count: 0,
        mastered_once: false,
        firstMasteredAt: null,
        hasEarnedMasteryXP: false,
        earnedTransitions: [],
        remasteryAwardCount: 0,
        xpEconomyVersion: 0,
        hiddenFromDictionary: false,
        hiddenFromDictionaryAt: null,
        personalDictionaryState: 'active',
        order: 2,
        createdAt: timestamp
      };
      if (includeLegacy) {
        batch.set(doc(db, `users/${uid}/words/published_school`), legacyPayload);
      }
      batch.set(doc(db, `${canonicalPath}/sources/${sourceId}`), {
        addedFrom: 'published-gate',
        operationId,
        worldId,
        rankId,
        gateId,
        contentWordId,
        linkedAt: serverTimestamp()
      });
      return { batch, db, legacyPayload };
    };

    const allowedUid = 'reported-gate-word-allowed';
    await seedUserState(allowedUid, { targetUnlocked: true });
    await assertFails(reportedBatch(allowedUid).batch.commit());
    const allowedRequest = reportedBatch(allowedUid, {
      includeLegacy: false,
      compactCanonical: true
    });
    await assertSucceeds(allowedRequest.batch.commit());
    await assertSucceeds(setDoc(
      doc(allowedRequest.db, `users/${allowedUid}/words/published_school`),
      allowedRequest.legacyPayload
    ));
    const [canonicalSnapshot, sourceSnapshot, legacySnapshot] = await Promise.all([
      getDoc(doc(allowedRequest.db, `users/${allowedUid}/contentWords/${wordKey}`)),
      getDoc(doc(
        allowedRequest.db,
        `users/${allowedUid}/contentWords/${wordKey}/sources/${sourceId}`
      )),
      getDoc(doc(allowedRequest.db, `users/${allowedUid}/words/published_school`))
    ]);
    assert.equal(canonicalSnapshot.exists(), true);
    assert.equal(sourceSnapshot.exists(), true);
    assert.equal(legacySnapshot.exists(), true);

    const lockedUid = 'reported-gate-word-locked';
    await seedUserState(lockedUid, { targetUnlocked: false });
    await assertFails(reportedBatch(lockedUid, {
      includeLegacy: false,
      compactCanonical: true
    }).batch.commit());

    const stalePointerUid = 'reported-gate-word-stale-pointer';
    await seedUserState(stalePointerUid, {
      targetUnlocked: true,
      pointerWorldId: 'another-world'
    });
    await assertFails(
      reportedBatch(stalePointerUid, {
        includeLegacy: false,
        compactCanonical: true
      }).batch.commit()
    );
  });

  await test('draft content cannot be linked as a journey source', async () => {
    const sourceId = 'published_published-world~published-rank~draft-gate~hidden';
    const canonicalPath = 'users/user-a/contentWords/hidden';
    const batch = writeBatch(userA);
    batch.set(doc(userA, canonicalPath), {
      canonicalId: 'hidden',
      normalizationVersion: 1,
      normalizedWord: 'hidden',
      masteryKey: 'hidden',
      legacyWordId: 'published_hidden',
      word: 'hidden',
      forgetCount: 0,
      primarySource: {
        worldId: 'published-world',
        rankId: 'published-rank',
        gateId: 'draft-gate',
        contentWordId: 'hidden',
        sourceId,
        addedFrom: 'published-gate'
      },
      sourceCount: 1,
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(userA, `${canonicalPath}/sources/${sourceId}`), {
      worldId: 'published-world',
      rankId: 'published-rank',
      gateId: 'draft-gate',
      contentWordId: 'hidden',
      addedFrom: 'published-gate',
      operationId: 'draft_attempt',
      linkedAt: serverTimestamp()
    });
    await assertFails(batch.commit());
  });

  await test('content membership cannot be created or rewritten by a client', async () => {
    await assertSucceeds(getDoc(doc(userA, paths.membership)));
    await assertFails(setDoc(doc(userA, 'users/user-a/contentWords/forged'), {
      canonicalId: 'forged',
      word: 'forged'
    }));
    await assertFails(updateDoc(doc(userA, paths.membership), { word: 'Forged' }));
    await assertFails(getDoc(doc(userB, paths.membership)));
  });

  await test('the owner may change only forgetCount by one step', async () => {
    await assertSucceeds(updateDoc(doc(userA, paths.membership), {
      forgetCount: 1,
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(userA, paths.membership), {
      forgetCount: 20,
      updatedAt: serverTimestamp()
    }));
  });

  await test('an admin can create a valid draft and malformed identity is rejected', async () => {
    const valid = {
      ...world('admin-draft', 'draft'),
      primaryInterest: 'games',
      interestTags: ['movies', 'technology'],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    };
    await assertSucceeds(setDoc(doc(admin, 'content_worlds/admin-draft'), valid));
    await assertFails(setDoc(doc(admin, 'content_worlds/path-id'), {
      ...valid,
      worldId: 'different-id'
    }));

    const legacyInterestPath = 'content_worlds/legacy-interest-world';
    await assertSucceeds(setDoc(doc(admin, legacyInterestPath), {
      ...world('legacy-interest-world', 'draft'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    }));
    await assertSucceeds(updateDoc(doc(admin, legacyInterestPath), {
      primaryInterest: 'study',
      interestTags: ['general', 'travel'],
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));

    for (const [worldId, interestPatch] of [
      ['invalid-primary-interest', { primaryInterest: 'sports' }],
      ['invalid-interest-tag', { primaryInterest: 'general', interestTags: ['sports'] }],
      ['duplicate-interest-tag', { primaryInterest: 'travel', interestTags: ['travel', 'travel'] }],
      ['stored-unknown-interest', { primaryInterest: 'unknown' }]
    ]) {
      await assertFails(setDoc(doc(admin, `content_worlds/${worldId}`), {
        ...world(worldId, 'draft'),
        ...interestPatch,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: 'admin-a',
        updatedBy: 'admin-a'
      }));
    }
    await assertFails(updateDoc(doc(userA, legacyInterestPath), {
      primaryInterest: 'movies',
      version: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'user-a'
    }));
  });

  await test('rank writes require the CEFR allowlist, initial counters, and monotonic versions', async () => {
    const rankPath = 'content_worlds/published-world/ranks/admin-rank';
    const valid = {
      ...rank('published-world', 'admin-rank', 'draft'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    };
    await assertFails(setDoc(doc(admin, rankPath), valid));
    const createBatch = writeBatch(admin);
    createBatch.set(doc(admin, rankPath), valid);
    createBatch.update(doc(admin, paths.publishedWorld), {
      rankCount: 4,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    });
    await assertSucceeds(createBatch.commit());
    await assertSucceeds(updateDoc(doc(admin, rankPath), {
      title: 'Admin Rank Updated',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, rankPath), {
      title: 'Stale Rank Update',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, rankPath), {
      cefrLevel: 'beginner',
      version: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertSucceeds(updateDoc(doc(admin, rankPath), {
      cefrLevel: 'B2',
      version: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, rankPath), {
      cefrLevel: 'A1',
      version: 4,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertSucceeds(updateDoc(doc(admin, rankPath), {
      title: 'Classified Rank Metadata Edit',
      version: 4,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, rankPath), {
      gateCount: 9,
      version: 5,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    const invalidCounterBatch = writeBatch(admin);
    invalidCounterBatch.set(doc(admin, 'content_worlds/published-world/ranks/nonzero-rank'), {
      ...valid,
      rankId: 'nonzero-rank',
      gateCount: 1
    });
    invalidCounterBatch.update(doc(admin, paths.publishedWorld), {
      rankCount: 5,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    });
    await assertFails(invalidCounterBatch.commit());
  });

  await test('an admin client cannot remove a backend rank-operation lock', async () => {
    await assertFails(updateDoc(doc(admin, paths.lockedRank), {
      title: 'Forged unlocked rank',
      version: 2,
      _adminRankOperation: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, paths.lockedRankChildGate), {
      title: 'Child edit during a rank operation',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
  });

  await test('gate writes require coupled ancestor counters, valid thresholds, and monotonic versions', async () => {
    const gatePath = 'content_worlds/published-world/ranks/published-rank/gates/admin-gate';
    const valid = {
      ...gate('published-world', 'published-rank', 'admin-gate', 'draft'),
      title: 'Admin Gate',
      entryAssessmentPassRatio: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    };

    await assertFails(setDoc(doc(admin, gatePath), valid));

    const createBatch = writeBatch(admin);
    createBatch.set(doc(admin, gatePath), valid);
    createBatch.update(doc(admin, paths.publishedRank), {
      gateCount: 1,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    });
    createBatch.update(doc(admin, paths.publishedWorld), {
      gateCount: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    });
    await assertSucceeds(createBatch.commit());

    await assertSucceeds(updateDoc(doc(admin, gatePath), {
      title: 'Admin Gate Updated',
      entryAssessmentPassRatio: 0.8,
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, gatePath), {
      title: 'Stale Gate Update',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, gatePath), {
      entryAssessmentPassRatio: 1.01,
      version: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, gatePath), {
      wordCount: 1,
      version: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
  });

  await test('admin word CRUD is independent from ancestor counters', async () => {
    const wordPath = 'content_worlds/published-world/ranks/published-rank/gates/published-gate/words/admin-word';
    const valid = {
      ...word('published-world', 'published-rank', 'published-gate', 'admin-word', 'draft'),
      word: 'Admin Word',
      normalizedWord: 'admin word',
      wordKey: 'admin_word',
      futureOptionalMetadata: 'kept for a later schema revision',
      translation: 'كلمة إدارية',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    };

    await assertSucceeds(setDoc(doc(admin, wordPath), valid));
    await assertFails(setDoc(doc(userA, `${wordPath}-non-admin`), {
      ...valid,
      contentWordId: 'admin-word-non-admin',
      createdBy: 'user-a',
      updatedBy: 'user-a'
    }));
    await assertFails(updateDoc(doc(userA, wordPath), {
      status: 'published',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'user-a'
    }));
    await assertFails(deleteDoc(doc(userA, wordPath)));

    await assertSucceeds(updateDoc(doc(admin, wordPath), {
      translation: 'كلمة إدارية محدثة',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, wordPath), {
      translation: 'تعديل قديم',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, wordPath), {
      contentWordId: 'different-id',
      version: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertSucceeds(updateDoc(doc(admin, wordPath), {
      status: 'published',
      version: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertSucceeds(updateDoc(doc(admin, wordPath), {
      status: 'archived',
      version: 4,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, wordPath), {
      worldId: 'another-world',
      version: 5,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, wordPath), {
      translation: '',
      version: 5,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertSucceeds(deleteDoc(doc(admin, wordPath)));
  });

  await test('legacy parents with missing optional fields do not block a word create', async () => {
    const legacyRank = rank('legacy-default-world', 'legacy-default-rank', 'draft');
    const legacyGate = gate('legacy-default-world', 'legacy-default-rank', 'legacy-default-gate', 'draft');
    delete legacyRank.unlockConfig;
    delete legacyGate.unlockConfig;
    delete legacyGate.entryAssessmentPassRatio;
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, paths.legacyWorld), {
          ...world('legacy-default-world', 'draft'),
          wordCount: 0
        }),
        setDoc(doc(db, paths.legacyRank), legacyRank),
        setDoc(doc(db, paths.legacyGate), legacyGate)
      ]);
    });

    await assertSucceeds(setDoc(doc(admin, paths.legacyWord), {
      ...word(
        'legacy-default-world',
        'legacy-default-rank',
        'legacy-default-gate',
        'legacy-default-word',
        'draft'
      ),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    }));
  });

  await test('an admin client cannot remove a backend gate-operation lock', async () => {
    await assertFails(updateDoc(doc(admin, paths.lockedGate), {
      title: 'Forged unlocked gate',
      version: 2,
      _adminGateOperation: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, paths.copyLockedGate), {
      title: 'Forged completed gate copy',
      version: 2,
      _adminGateCopyOperation: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
  });

  await test('a backend world-operation lock fences parent browser edits', async () => {
    await assertFails(updateDoc(doc(admin, paths.operationLockedWorld), {
      title: 'Forged unlocked world',
      version: 2,
      _adminWorldOperation: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, paths.operationLockedRank), {
      title: 'Rank changed during world operation',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertFails(updateDoc(doc(admin, paths.operationLockedGate), {
      title: 'Gate changed during world operation',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
  });

  await test('an admin can create, list, update, and delete staging words', async () => {
    const stagingWordId = `staging_${'a'.repeat(64)}`;
    await assertSucceeds(setDoc(doc(admin, paths.stagingWord), stagingWord(stagingWordId)));
    await assertSucceeds(getDocs(query(
      collection(admin, 'content_word_import_staging'),
      orderBy('importedAt', 'desc'),
      orderBy('importBatchId', 'desc'),
      orderBy('sourceOrder', 'asc'),
      orderBy(documentId(), 'asc'),
      limit(25)
    )));
    await assertSucceeds(updateDoc(doc(admin, paths.stagingWord), {
      stagingStatus: 'distributing',
      distributionTarget: {
        worldId: 'published-world',
        rankId: 'published-rank',
        gateId: 'published-gate'
      },
      distributionOperationId: 'operation-a',
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
    await assertSucceeds(deleteDoc(doc(admin, paths.stagingWord)));
  });

  await test('normal and anonymous clients cannot read or write staging words', async () => {
    const stagingWordId = `staging_${'b'.repeat(64)}`;
    const path = `content_word_import_staging/${stagingWordId}`;
    await assertFails(getDoc(doc(anonymous, path)));
    await assertFails(getDoc(doc(userA, path)));
    await assertFails(setDoc(doc(userA, path), stagingWord(stagingWordId, 'user-a')));
    await assertFails(deleteDoc(doc(userA, path)));
  });

  await test('staging rules reject forged identity and audit fields', async () => {
    const stagingWordId = `staging_${'c'.repeat(64)}`;
    const path = `content_word_import_staging/${stagingWordId}`;
    await assertFails(setDoc(doc(admin, path), {
      ...stagingWord(stagingWordId),
      stagingWordId: `staging_${'d'.repeat(64)}`
    }));
    await assertFails(setDoc(doc(admin, path), {
      ...stagingWord(stagingWordId),
      createdBy: 'another-admin'
    }));
    await assertFails(setDoc(doc(admin, path), {
      ...stagingWord(stagingWordId),
      worldId: 'forged-world'
    }));
  });

  await test('staging records cannot masquerade as published prepared content', async () => {
    const stagingWordId = `staging_${'e'.repeat(64)}`;
    const path = `content_word_import_staging/${stagingWordId}`;
    await assertFails(setDoc(doc(admin, path), {
      ...stagingWord(stagingWordId),
      status: 'published'
    }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), path), {
        ...stagingWord(stagingWordId),
        importedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });
    await assertFails(getDoc(doc(anonymous, path)));
  });

  await test('shared word details and legacy SRS limits remain collection-strict', async () => {
    const preparedPath =
      'content_worlds/published-world/ranks/published-rank/gates/published-gate/words/shared-details-invalid';
    await assertFails(setDoc(doc(admin, preparedPath), {
      ...word(
        'published-world',
        'published-rank',
        'published-gate',
        'shared-details-invalid',
        'draft'
      ),
      definition: 'x'.repeat(4001),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    }));

    const stagingWordId = `staging_${'f'.repeat(64)}`;
    await assertFails(setDoc(
      doc(admin, `content_word_import_staging/${stagingWordId}`),
      { ...stagingWord(stagingWordId), tags: 'not-a-list' }
    ));

    const legacyPath = 'users/user-a/words/shared-details-invalid';
    const legacyBase = {
      text: 'strict',
      meaning: 'strict meaning',
      category: 'general',
      userId: 'user-a',
      createdAt: serverTimestamp()
    };
    await assertFails(setDoc(doc(userA, legacyPath), {
      ...legacyBase,
      notes: 'x'.repeat(4001)
    }));

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), legacyPath), {
        ...legacyBase,
        createdAt: timestamp,
        mastery_status: 'Learning',
        mastery_streak: 1
      });
    });
    await assertFails(updateDoc(doc(userA, legacyPath), {
      mastery_streak: 4
    }));
  });

  const levelUser = environment.authenticatedContext('level-user').firestore();
  const levelAssessmentId = 'level_placement_v1_A1_rules_test';
  const levelJourneyPath = 'users/level-user/contentProgress/level-world';
  const levelSessionPath =
    `${levelJourneyPath}/levelPlacementSessions/${levelAssessmentId}`;

  await test('an owner can complete a structurally valid Level Placement result', async () => {
    const journeyBatch = writeBatch(levelUser);
    journeyBatch.set(
      doc(levelUser, levelJourneyPath),
      journey('level-world', 'level-rank-a1', 'level-gate-a1')
    );
    journeyBatch.set(doc(levelUser, 'users/level-user/meta/active_content_journey'), {
      worldId: 'level-world',
      journeyVersion: 1,
      updatedAt: serverTimestamp()
    });
    journeyBatch.set(
      doc(levelUser, `${levelJourneyPath}/ranks/level-rank-a1/gates/level-gate-a1`),
      availableGateProgress('level-world', 'level-rank-a1', 'level-gate-a1')
    );
    await assertSucceeds(journeyBatch.commit());

    const startBatch = writeBatch(levelUser);
    startBatch.update(doc(levelUser, levelJourneyPath), {
      placementStatus: 'declined',
      activeLevelPlacementAssessmentId: levelAssessmentId,
      activeLevelPlacementCefrLevel: 'A1',
      levelPlacementStatus: 'active',
      levelPlacementVersion: 1,
      passedCefrLevels: [],
      updatedAt: serverTimestamp()
    });
    startBatch.set(
      doc(levelUser, levelSessionPath),
      levelPlacementSession(levelAssessmentId)
    );
    await assertSucceeds(startBatch.commit());

    await assertFails(updateDoc(doc(levelUser, levelSessionPath), {
      status: 'awaiting-decision',
      answers: [{
        questionId: 'level-question-a1',
        rankId: 'level-rank-a1',
        gateId: 'level-gate-a1',
        contentWordId: 'level-word-a1',
        wordKey: 'level-word-a1',
        selectedQuestionId: 'level-question-a1',
        correct: true
      }],
      currentQuestionIndex: 1,
      correctCount: 1,
      perRankStats: { 'level-rank-a1': { status: 'passed' } },
      passedRankIds: ['disconnected-rank'],
      passedPrefixLength: 1,
      passedLevel: true,
      answersCompletedAt: serverTimestamp(),
      resultApplied: false,
      updatedAt: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(levelUser, levelSessionPath), {
      status: 'awaiting-decision',
      answers: [{
        questionId: 'level-question-a1',
        rankId: 'level-rank-a1',
        gateId: 'level-gate-a1',
        contentWordId: 'level-word-a1',
        wordKey: 'level-word-a1',
        selectedQuestionId: 'level-question-a1',
        correct: true
      }],
      currentQuestionIndex: 1,
      correctCount: 1,
      perRankStats: {
        'level-rank-a1': {
          asked: 1,
          correct: 1,
          ratio: 1,
          passThreshold: 0.75,
          requiredCorrect: 1,
          confidence: 'low',
          status: 'passed'
        }
      },
      passedRankIds: ['level-rank-a1'],
      passedPrefixLength: 1,
      passedLevel: true,
      answersCompletedAt: serverTimestamp(),
      resultApplied: false,
      updatedAt: serverTimestamp()
    }));

    const resultBatch = writeBatch(levelUser);
    resultBatch.update(doc(levelUser, levelSessionPath), {
      resultApplied: true,
      nextCefrLevel: 'A2',
      resultStartRankId: 'level-rank-a2',
      resultStartGateId: 'level-gate-a2',
      resultUnlockedRankIds: ['level-rank-a1', 'level-rank-a2'],
      resultUnlockedGateIds: ['level-gate-a1', 'level-gate-a2'],
      updatedAt: serverTimestamp()
    });
    resultBatch.update(doc(levelUser, levelJourneyPath), {
      activeRankId: 'level-rank-a2',
      activeGateId: 'level-gate-a2',
      unlockedRankIds: ['level-rank-a1', 'level-rank-a2'],
      unlockedGateIds: ['level-gate-a1', 'level-gate-a2'],
      passedCefrLevels: ['A1'],
      partialCefrLevels: [],
      levelPlacementStatus: 'awaiting-decision',
      updatedAt: serverTimestamp()
    });
    resultBatch.set(
      doc(levelUser, `${levelJourneyPath}/ranks/level-rank-a2/gates/level-gate-a2`),
      availableGateProgress('level-world', 'level-rank-a2', 'level-gate-a2')
    );
    await assertSucceeds(resultBatch.commit());
    const savedJourney = await getDoc(doc(levelUser, levelJourneyPath));
    assert.deepEqual(savedJourney.data().passedCefrLevels, ['A1']);
    assert.equal(savedJourney.data().activeRankId, 'level-rank-a2');
  });

  await test('Level Placement v2 commits its authoritative outcome before retryable gate projection', async () => {
    const uid = 'level-v2-user';
    const assessmentId = 'level_placement_v2_A1_rules_test';
    const journeyPath = `users/${uid}/contentProgress/level-world`;
    const sessionPath = `${journeyPath}/levelPlacementSessions/${assessmentId}`;
    const firstGatePath = `${journeyPath}/ranks/level-rank-a1/gates/level-gate-a1`;
    const nextGatePath = `${journeyPath}/ranks/level-rank-a2/gates/level-gate-a2`;
    const pointerPath = `users/${uid}/meta/active_content_journey`;
    const db = environment.authenticatedContext(uid).firestore();

    const setup = writeBatch(db);
    setup.set(doc(db, journeyPath), journey('level-world', 'level-rank-a1', 'level-gate-a1'));
    setup.set(doc(db, pointerPath), {
      worldId: 'level-world',
      journeyVersion: 1,
      updatedAt: serverTimestamp()
    });
    setup.set(
      doc(db, firstGatePath),
      availableGateProgress('level-world', 'level-rank-a1', 'level-gate-a1')
    );
    await assertSucceeds(setup.commit());

    const v2Session = levelPlacementSession(assessmentId, {
      placementVersion: 2,
      assessmentMode: 'full-level',
      previousAssessmentId: '',
      testedRankIds: ['level-rank-a1'],
      assessedRankIds: ['level-rank-a1'],
      assessedRankVersions: { 'level-rank-a1': 1 },
      publishedRankSetHash: 'level-rank-a1-v1',
      rankVersions: { 'level-rank-a1': 1 }
    });
    const start = writeBatch(db);
    start.update(doc(db, journeyPath), {
      placementStatus: 'declined',
      activeLevelPlacementAssessmentId: assessmentId,
      activeLevelPlacementCefrLevel: 'A1',
      levelPlacementStatus: 'active',
      levelPlacementVersion: 2,
      passedCefrLevels: [],
      updatedAt: serverTimestamp()
    });
    start.set(doc(db, sessionPath), v2Session);
    await assertSucceeds(start.commit());

    await assertSucceeds(updateDoc(doc(db, sessionPath), {
      status: 'awaiting-decision',
      answers: [{
        questionId: 'level-question-a1',
        rankId: 'level-rank-a1',
        gateId: 'level-gate-a1',
        contentWordId: 'level-word-a1',
        wordKey: 'level-word-a1',
        selectedQuestionId: 'level-question-a1',
        correct: true
      }],
      currentQuestionIndex: 1,
      correctCount: 1,
      perRankStats: {
        'level-rank-a1': {
          asked: 1,
          correct: 1,
          ratio: 1,
          passThreshold: 0.75,
          requiredCorrect: 1,
          confidence: 'low',
          status: 'passed'
        }
      },
      passedRankIds: ['level-rank-a1'],
      passedPrefixLength: 1,
      passedLevel: true,
      answersCompletedAt: serverTimestamp(),
      resultApplied: false,
      updatedAt: serverTimestamp()
    }));

    const crossPhase = writeBatch(db);
    crossPhase.update(doc(db, sessionPath), {
      status: 'completed',
      resultApplied: true,
      assessedAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      nextCefrLevel: 'A2',
      resultStartRankId: 'level-rank-a2',
      resultStartGateId: 'level-gate-a2',
      resultUnlockedRankIds: ['level-rank-a1', 'level-rank-a2'],
      resultUnlockedGateIds: ['level-gate-a1', 'level-gate-a2'],
      resultClearedGateIds: ['level-gate-a1'],
      completedCurrentContent: false,
      updatedAt: serverTimestamp()
    });
    crossPhase.update(doc(db, journeyPath), {
      activeRankId: 'level-rank-a2',
      activeGateId: 'level-gate-a2',
      unlockedRankIds: ['level-rank-a1', 'level-rank-a2'],
      unlockedGateIds: ['level-gate-a1', 'level-gate-a2'],
      passedCefrLevels: ['A1'],
      partialCefrLevels: [],
      levelPlacementStatus: 'awaiting-decision',
      contentJourneyStatus: 'in-progress',
      levelPlacementAssessmentIds: { A1: assessmentId },
      levelPlacementPassedRankIds: ['level-rank-a1'],
      updatedAt: serverTimestamp()
    });
    await assertFails(crossPhase.commit());

    const result = writeBatch(db);
    result.update(doc(db, sessionPath), {
      status: 'completed',
      resultApplied: true,
      assessedAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      nextCefrLevel: 'A2',
      resultStartRankId: 'level-rank-a2',
      resultStartGateId: 'level-gate-a2',
      resultUnlockedRankIds: ['level-rank-a1', 'level-rank-a2'],
      resultUnlockedGateIds: ['level-gate-a1', 'level-gate-a2'],
      resultClearedGateIds: ['level-gate-a1'],
      completedCurrentContent: false,
      updatedAt: serverTimestamp()
    });
    result.update(doc(db, journeyPath), {
      activeRankId: 'level-rank-a2',
      activeGateId: 'level-gate-a2',
      unlockedRankIds: ['level-rank-a1', 'level-rank-a2'],
      unlockedGateIds: ['level-gate-a1', 'level-gate-a2'],
      passedCefrLevels: ['A1'],
      partialCefrLevels: [],
      activeLevelPlacementAssessmentId: '',
      activeLevelPlacementCefrLevel: '',
      levelPlacementStatus: 'completed',
      contentJourneyStatus: 'in-progress',
      levelPlacementAssessmentIds: { A1: assessmentId },
      levelPlacementPassedRankIds: ['level-rank-a1'],
      levelPlacementClearedGateIds: ['level-gate-a1'],
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(result.commit());

    const savedOutcomeJourney = await getDoc(doc(db, journeyPath));
    const unprojectedNextGate = await getDoc(doc(db, nextGatePath));
    assert.equal(savedOutcomeJourney.data().activeRankId, 'level-rank-a2');
    assert.deepEqual(
      savedOutcomeJourney.data().levelPlacementClearedGateIds,
      ['level-gate-a1']
    );
    assert.equal(unprojectedNextGate.exists(), false);

    await assertFails(updateDoc(doc(db, firstGatePath), {
      status: 'cleared',
      clearedAt: serverTimestamp(),
      clearedBy: 'level-placement',
      levelPlacementAssessmentId: assessmentId,
      levelPlacementScore: 1.1,
      placementClearedWithoutLoad: true,
      lastActivityAt: serverTimestamp()
    }));

    const projection = writeBatch(db);
    projection.update(doc(db, firstGatePath), {
      status: 'cleared',
      clearedAt: serverTimestamp(),
      clearedBy: 'level-placement',
      levelPlacementAssessmentId: assessmentId,
      levelPlacementScore: 1,
      placementClearedWithoutLoad: true,
      lastActivityAt: serverTimestamp()
    });
    projection.set(
      doc(db, nextGatePath),
      availableGateProgress('level-world', 'level-rank-a2', 'level-gate-a2')
    );
    await assertSucceeds(projection.commit());

    const [savedJourney, clearedGate, nextGate] = await Promise.all([
      getDoc(doc(db, journeyPath)),
      getDoc(doc(db, firstGatePath)),
      getDoc(doc(db, nextGatePath))
    ]);
    assert.equal(savedJourney.data().activeRankId, 'level-rank-a2');
    assert.equal(savedJourney.data().activeLevelPlacementAssessmentId, '');
    assert.equal(clearedGate.data().clearedBy, 'level-placement');
    assert.equal(nextGate.data().status, 'available');
  });

  await test('level-placement-source-contract-e2e is owner-only, selected, retryable, and reward-free', async () => {
    const sourceUid = 'level-source-contract-user';
    const sourceUser = environment.authenticatedContext(sourceUid).firestore();
    const sourceJourneyPath = `users/${sourceUid}/contentProgress/level-world`;
    const sourceSessionPath =
      `${sourceJourneyPath}/levelPlacementSessions/${levelAssessmentId}`;
    await environment.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await Promise.all([
        setDoc(doc(seedDb, sourceJourneyPath), {
          ...journey('level-world', 'level-rank-a1', 'level-gate-a1'),
          activeLevelPlacementAssessmentId: '',
          activeLevelPlacementCefrLevel: '',
          levelPlacementStatus: 'completed',
          passedCefrLevels: ['A1'],
          levelPlacementAssessmentIds: { A1: levelAssessmentId }
        }),
        setDoc(doc(seedDb, `users/${sourceUid}/meta/active_content_journey`), {
          worldId: 'level-world',
          journeyVersion: 1,
          updatedAt: timestamp
        }),
        setDoc(doc(seedDb, sourceSessionPath), {
          ...levelPlacementSession(levelAssessmentId),
          status: 'completed',
          answers: [{
            questionId: 'level-question-a1',
            rankId: 'level-rank-a1',
            gateId: 'level-gate-a1',
            contentWordId: 'level-word-a1',
            wordKey: 'level-word-a1',
            selectedQuestionId: 'level-question-a1',
            correct: true
          }],
          currentQuestionIndex: 1,
          correctCount: 1,
          resultApplied: true,
          startedAt: timestamp,
          updatedAt: timestamp,
          answersCompletedAt: timestamp,
          assessedAt: timestamp,
          completedAt: timestamp
        })
      ]);
    });
    const sourceId = `${levelAssessmentId}~level-word-a1`;
    const sourcePath =
      `users/${sourceUid}/contentWords/level-word-a1/sources/level_placement_${sourceId}`;
    const canonicalPath = `users/${sourceUid}/contentWords/level-word-a1`;
    const batch = writeBatch(sourceUser);
    batch.set(doc(sourceUser, canonicalPath), {
      canonicalId: 'level-word-a1',
      normalizationVersion: 1,
      normalizedWord: 'level-word-a1',
      masteryKey: 'level-word-a1',
      legacyWordId: 'level-word-a1',
      word: 'level-word-a1',
      wordKey: 'level-word-a1',
      translation: 'meaning',
      meaning: 'meaning',
      forgetCount: 0,
      contentRefPath: paths.levelWordA1,
      primarySource: {
        worldId: 'level-world',
        rankId: 'level-rank-a1',
        gateId: 'level-gate-a1',
        contentWordId: 'level-word-a1',
        sourceId: `level_placement_${sourceId}`,
        addedFrom: 'level-placement'
      },
      sourceCount: 1,
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(sourceUser, sourcePath), {
      worldId: 'level-world',
      rankId: 'level-rank-a1',
      gateId: 'level-gate-a1',
      contentWordId: 'level-word-a1',
      type: 'level-placement',
      addedFrom: 'level-placement',
      operationId: `level-placement:${levelAssessmentId}`,
      linkedAt: serverTimestamp(),
      assessmentId: levelAssessmentId,
      cefrLevel: 'A1',
      placementResult: 'correct'
    });
    await assertSucceeds(batch.commit());
    await assertFails(getDoc(doc(userB, sourcePath)));
    const forgedSource = writeBatch(sourceUser);
    forgedSource.set(doc(
      sourceUser,
      `users/${sourceUid}/contentWords/forged-level-word`
    ), {
      canonicalId: 'forged-level-word',
      normalizationVersion: 1,
      normalizedWord: 'forged-level-word',
      masteryKey: 'forged-level-word',
      legacyWordId: 'forged-level-word',
      word: 'forged-level-word',
      wordKey: 'forged-level-word',
      translation: 'meaning',
      meaning: 'meaning',
      forgetCount: 0,
      contentRefPath: paths.levelWordA1,
      primarySource: {
        worldId: 'level-world',
        rankId: 'level-rank-a1',
        gateId: 'level-gate-a1',
        contentWordId: 'forged-level-word',
        sourceId: `level_placement_${levelAssessmentId}~forged-level-word`,
        addedFrom: 'level-placement'
      },
      sourceCount: 1,
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    forgedSource.set(doc(
      sourceUser,
      `users/${sourceUid}/contentWords/forged-level-word/sources/level_placement_${levelAssessmentId}~forged-level-word`
    ), {
      worldId: 'level-world',
      rankId: 'level-rank-a1',
      gateId: 'level-gate-a1',
      contentWordId: 'forged-level-word',
      type: 'level-placement',
      addedFrom: 'level-placement',
      operationId: `level-placement:${levelAssessmentId}`,
      linkedAt: serverTimestamp(),
      assessmentId: levelAssessmentId,
      cefrLevel: 'A1',
      placementResult: 'correct'
    });
    await assertFails(forgedSource.commit());
    await assertSucceeds(updateDoc(doc(sourceUser, sourceSessionPath), {
      saveWordChoice: 'all',
      saveWordPendingIds: [],
      saveWordSavedIds: ['level-question-a1'],
      saveWordFailures: [],
      saveWordSummary: {
        created: 1,
        sourceLinked: 0,
        alreadyLinked: 0,
        restored: 0,
        updatedMissingFields: 0,
        hiddenPreserved: 0,
        failed: 0
      },
      wordsSaveCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(doc(sourceUser, sourceSessionPath), {
      saveWordChoice: 'all',
      saveWordPendingIds: [],
      saveWordSavedIds: ['level-question-a1'],
      saveWordFailures: [],
      saveWordSummary: {
        created: 1,
        sourceLinked: 0,
        alreadyLinked: 1,
        restored: 0,
        updatedMissingFields: 0,
        hiddenPreserved: 0,
        failed: 0
      },
      wordsSaveCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(sourceUser, sourceSessionPath), {
      saveWordChoice: 'none',
      saveWordPendingIds: [],
      saveWordSavedIds: [],
      saveWordFailures: [],
      saveWordSummary: {},
      wordsSaveCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(sourceUser, sourceSessionPath), {
      userXP: 100,
      updatedAt: serverTimestamp()
    }));
  });

  await test('a direct URL cannot start a disconnected higher CEFR level', async () => {
    const closeBatch = writeBatch(levelUser);
    closeBatch.update(doc(levelUser, levelSessionPath), {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    closeBatch.update(doc(levelUser, levelJourneyPath), {
      activeLevelPlacementAssessmentId: '',
      activeLevelPlacementCefrLevel: '',
      levelPlacementStatus: 'completed',
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(closeBatch.commit());

    const forgedAssessment = 'level_placement_v1_C1_forged';
    const forgedBatch = writeBatch(levelUser);
    forgedBatch.update(doc(levelUser, levelJourneyPath), {
      activeLevelPlacementAssessmentId: forgedAssessment,
      activeLevelPlacementCefrLevel: 'C1',
      levelPlacementStatus: 'active',
      levelPlacementVersion: 1,
      passedCefrLevels: ['A1'],
      updatedAt: serverTimestamp()
    });
    forgedBatch.set(
      doc(levelUser, `${levelJourneyPath}/levelPlacementSessions/${forgedAssessment}`),
      levelPlacementSession(forgedAssessment, { cefrLevel: 'C1' })
    );
    await assertFails(forgedBatch.commit());
  });

  const lifecycleLegacyPath = 'users/user-a/words/lifecycle-word';
  const lifecycleCanonicalPath = 'users/user-a/contentWords/lifecycle';
  const lifecycleManualSourcePath = `${lifecycleCanonicalPath}/sources/manual`;
  const lifecycleJourneySourcePath =
    `${lifecycleCanonicalPath}/sources/published_lifecycle-world~lifecycle-rank~lifecycle-gate~lifecycle-content`;
  const lifecyclePrivateSourcePath =
    `${lifecycleCanonicalPath}/sources/private_world_lifecycle-private`;
  const lifecyclePrivateMembershipPath =
    'users/user-a/customWorlds/lifecycle-private/words/published_lifecycle';

  await test('an owner creates one canonical manual word and one source reference', async () => {
    const batch = writeBatch(userA);
    batch.set(doc(userA, lifecycleLegacyPath), {
      text: 'lifecycle',
      word: 'lifecycle',
      normalizedWord: 'lifecycle',
      wordKey: 'lifecycle',
      meaning: 'دورة حياة',
      translation: 'دورة حياة',
      category: 'عام',
      userId: 'user-a',
      mastery_status: 'Reviewing',
      mastery_streak: 2,
      hiddenFromDictionary: false,
      hiddenFromDictionaryAt: null,
      createdAt: serverTimestamp()
    });
    batch.set(doc(userA, lifecycleCanonicalPath), {
      canonicalId: 'lifecycle',
      normalizationVersion: 1,
      normalizedWord: 'lifecycle',
      masteryKey: 'lifecycle',
      legacyWordId: 'lifecycle-word',
      word: 'lifecycle',
      wordKey: 'lifecycle',
      translation: 'دورة حياة',
      meaning: 'دورة حياة',
      category: 'عام',
      forgetCount: 0,
      primarySource: { sourceId: 'manual', addedFrom: 'manual' },
      sourceCount: 1,
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.set(doc(userA, lifecycleManualSourcePath), {
      addedFrom: 'manual',
      operationId: 'manual-create',
      linkedAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
    assert.equal((await getDoc(doc(userA, lifecycleCanonicalPath))).data().sourceCount, 1);
  });

  await test('a manual word can gain one published Journey source without a duplicate', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, 'content_worlds/lifecycle-world'), world('lifecycle-world', 'published')),
        setDoc(doc(db, 'content_worlds/lifecycle-world/ranks/lifecycle-rank'), rank('lifecycle-world', 'lifecycle-rank', 'published')),
        setDoc(doc(db, 'content_worlds/lifecycle-world/ranks/lifecycle-rank/gates/lifecycle-gate'), gate('lifecycle-world', 'lifecycle-rank', 'lifecycle-gate', 'published')),
        setDoc(doc(db, 'content_worlds/lifecycle-world/ranks/lifecycle-rank/gates/lifecycle-gate/words/lifecycle-content'), {
          ...word('lifecycle-world', 'lifecycle-rank', 'lifecycle-gate', 'lifecycle-content', 'published'),
          word: 'lifecycle',
          normalizedWord: 'lifecycle',
          wordKey: 'lifecycle'
        }),
        setDoc(doc(db, 'users/user-a/contentProgress/lifecycle-world'), {
          ...journey('lifecycle-world', 'lifecycle-rank', 'lifecycle-gate'),
          unlockedRankIds: ['lifecycle-rank'],
          unlockedGateIds: ['lifecycle-gate']
        }),
        setDoc(doc(db, 'users/user-a/meta/active_content_journey'), {
          worldId: 'lifecycle-world',
          status: 'active',
          updatedAt: timestamp
        })
      ]);
    });
    const batch = writeBatch(userA);
    batch.update(doc(userA, lifecycleCanonicalPath), {
      sourceCount: 2,
      updatedAt: serverTimestamp()
    });
    batch.set(doc(userA, lifecycleJourneySourcePath), {
      worldId: 'lifecycle-world',
      rankId: 'lifecycle-rank',
      gateId: 'lifecycle-gate',
      contentWordId: 'lifecycle-content',
      addedFrom: 'published-gate',
      operationId: 'lifecycle-gate-load',
      linkedAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
    assert.equal((await getDoc(doc(userA, lifecycleCanonicalPath))).data().sourceCount, 2);
    assert.equal((await getDocs(collection(userA, `${lifecycleCanonicalPath}/sources`))).size, 2);
  });

  await test('linking a Journey word to a private world preserves every source atomically', async () => {
    const batch = writeBatch(userA);
    batch.update(doc(userA, lifecycleCanonicalPath), {
      sourceCount: 3,
      updatedAt: serverTimestamp()
    });
    batch.set(doc(userA, lifecyclePrivateSourcePath), {
      addedFrom: 'private-world',
      customWorldId: 'lifecycle-private',
      operationId: 'world-manage-link',
      linkedAt: serverTimestamp()
    });
    batch.set(doc(userA, lifecyclePrivateMembershipPath), {
      text: 'lifecycle',
      word: 'lifecycle',
      normalizedWord: 'lifecycle',
      wordKey: 'lifecycle',
      meaning: 'دورة حياة',
      translation: 'دورة حياة',
      category: 'عام',
      userId: 'user-a',
      mastery_status: 'Reviewing',
      mastery_streak: 2,
      hiddenFromDictionary: false,
      hiddenFromDictionaryAt: null,
      createdAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
    assert.equal((await getDoc(doc(userA, lifecycleCanonicalPath))).data().sourceCount, 3);
    const sources = await getDocs(collection(userA, `${lifecycleCanonicalPath}/sources`));
    assert.equal(sources.size, 3);
    assert.equal(sources.docs.some((item) => item.data().addedFrom === 'published-gate'), true);
    assert.equal((await getDoc(doc(userA, lifecyclePrivateMembershipPath))).exists(), true);
  });

  await test('a private-world move cannot delete a Journey-linked personal word or Journey source', async () => {
    await assertFails(deleteDoc(doc(userA, lifecycleLegacyPath)));
    const destructive = writeBatch(userA);
    destructive.delete(doc(userA, lifecyclePrivateMembershipPath));
    destructive.delete(doc(userA, lifecycleJourneySourcePath));
    destructive.update(doc(userA, lifecycleCanonicalPath), {
      sourceCount: 1,
      updatedAt: serverTimestamp()
    });
    await assertFails(destructive.commit());
    assert.equal((await getDoc(doc(userA, lifecycleJourneySourcePath))).exists(), true);
  });

  await test('removing private membership keeps the Journey source and correct sourceCount', async () => {
    const batch = writeBatch(userA);
    batch.delete(doc(userA, lifecyclePrivateMembershipPath));
    batch.delete(doc(userA, lifecyclePrivateSourcePath));
    batch.update(doc(userA, lifecycleCanonicalPath), {
      sourceCount: 2,
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
    assert.equal((await getDoc(doc(userA, lifecyclePrivateMembershipPath))).exists(), false);
    assert.equal((await getDoc(doc(userA, lifecyclePrivateSourcePath))).exists(), false);
    assert.equal((await getDoc(doc(userA, lifecycleJourneySourcePath))).exists(), true);
    assert.equal((await getDoc(doc(userA, lifecycleCanonicalPath))).data().sourceCount, 2);
  });

  await test('Journey word hide and restore preserve SRS and both sources', async () => {
    await assertSucceeds(updateDoc(doc(userA, lifecycleLegacyPath), {
      hiddenFromDictionary: true,
      hiddenFromDictionaryAt: serverTimestamp()
    }));
    let legacy = (await getDoc(doc(userA, lifecycleLegacyPath))).data();
    assert.equal(legacy.hiddenFromDictionary, true);
    assert.equal(legacy.mastery_status, 'Reviewing');
    assert.equal(legacy.mastery_streak, 2);
    assert.equal((await getDocs(collection(userA, `${lifecycleCanonicalPath}/sources`))).size, 2);

    await assertSucceeds(updateDoc(doc(userA, lifecycleLegacyPath), {
      hiddenFromDictionary: false,
      hiddenFromDictionaryAt: null
    }));
    legacy = (await getDoc(doc(userA, lifecycleLegacyPath))).data();
    assert.equal(legacy.hiddenFromDictionary, false);
    assert.equal(legacy.mastery_status, 'Reviewing');
    assert.equal((await getDocs(collection(userA, `${lifecycleCanonicalPath}/sources`))).size, 2);
  });

  await test('legacy Journey word visibility tolerates schema drift without changing learning fields', async () => {
    const uid = 'legacy-visibility-user';
    const wordKey = 'legacy-visible-word';
    const legacyPath = `users/${uid}/words/published_${wordKey}`;
    const canonicalPath = `users/${uid}/contentWords/${wordKey}`;
    const sourcePath = `${canonicalPath}/sources/published_legacy~rank~gate~word`;
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, legacyPath), {
          word: 'legacy',
          meaning: 'قديم',
          difficulty: 'A1',
          mastery_status: 'Reviewing',
          mastery_streak: 2,
          importedByLegacyClient: true,
          createdAt: timestamp
        }),
        setDoc(doc(db, canonicalPath), {
          canonicalId: wordKey,
          normalizationVersion: 1,
          normalizedWord: wordKey,
          masteryKey: wordKey,
          legacyWordId: `published_${wordKey}`,
          word: 'legacy',
          forgetCount: 0,
          primarySource: { addedFrom: 'published-gate', sourceId: 'published_legacy~rank~gate~word' },
          sourceCount: 1,
          schemaVersion: 1,
          createdAt: timestamp,
          updatedAt: timestamp
        }),
        setDoc(doc(db, sourcePath), {
          addedFrom: 'published-gate',
          worldId: 'legacy',
          rankId: 'rank',
          gateId: 'gate',
          contentWordId: 'word',
          operationId: 'legacy-load',
          linkedAt: timestamp
        })
      ]);
    });
    const db = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(updateDoc(doc(db, legacyPath), {
      hiddenFromDictionary: true,
      hiddenFromDictionaryAt: serverTimestamp()
    }));
    const hidden = (await getDoc(doc(db, legacyPath))).data();
    assert.equal(hidden.hiddenFromDictionary, true);
    assert.equal(hidden.mastery_status, 'Reviewing');
    assert.equal((await getDoc(doc(db, sourcePath))).exists(), true);
    await assertFails(updateDoc(doc(db, legacyPath), {
      hiddenFromDictionary: false,
      hiddenFromDictionaryAt: null,
      mastery_status: 'Mastered'
    }));
    await assertSucceeds(updateDoc(doc(db, legacyPath), {
      hiddenFromDictionary: false,
      hiddenFromDictionaryAt: null
    }));
    await assertSucceeds(updateDoc(doc(db, legacyPath), {
      forgetCount: 0,
      mastery_status: 'Mastered',
      mastery_streak: 3,
      last_recalled_at: serverTimestamp(),
      first_recalled_at: serverTimestamp(),
      last_recall_day: '2026-07-29',
      last_recall_session_id: 'quiz-legacy',
      last_quizzed_at: serverTimestamp(),
      quiz_seen_count: 3,
      mastered_once: true,
      firstMasteredAt: serverTimestamp(),
      hasEarnedMasteryXP: true,
      earnedTransitions: ['new_learning', 'learning_reviewing', 'reviewing_mastered'],
      remasteryAwardCount: 0,
      xpEconomyVersion: 2
    }));
    assert.equal((await getDoc(doc(db, legacyPath))).data().mastery_status, 'Mastered');
    await assertFails(updateDoc(doc(db, legacyPath), {
      mastery_streak: 2,
      meaning: 'forged'
    }));
  });

  await test('visibility rules reject another user and a combined SRS mutation', async () => {
    await assertFails(updateDoc(doc(userB, lifecycleLegacyPath), {
      hiddenFromDictionary: true,
      hiddenFromDictionaryAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(userA, lifecycleLegacyPath), {
      hiddenFromDictionary: true,
      hiddenFromDictionaryAt: serverTimestamp(),
      mastery_status: 'Mastered'
    }));
  });

  await test('ordinary deletion cleans personal sources but cannot delete Journey sources', async () => {
    const wordKey = 'ordinary-cleanup';
    const legacyPath = 'users/user-a/words/ordinary-cleanup-word';
    const canonicalPath = `users/user-a/contentWords/${wordKey}`;
    const sourcePath = `${canonicalPath}/sources/manual`;
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, legacyPath), {
          text: wordKey,
          word: wordKey,
          wordKey,
          meaning: 'تنظيف',
          category: 'عام',
          userId: 'user-a',
          createdAt: timestamp
        }),
        setDoc(doc(db, canonicalPath), {
          canonicalId: wordKey,
          normalizationVersion: 1,
          normalizedWord: wordKey,
          masteryKey: wordKey,
          legacyWordId: 'ordinary-cleanup-word',
          word: wordKey,
          wordKey,
          meaning: 'تنظيف',
          translation: 'تنظيف',
          forgetCount: 0,
          primarySource: { sourceId: 'manual', addedFrom: 'manual' },
          sourceCount: 1,
          schemaVersion: 1,
          createdAt: timestamp,
          joinedAt: timestamp,
          updatedAt: timestamp
        }),
        setDoc(doc(db, sourcePath), {
          addedFrom: 'manual',
          operationId: 'manual-create',
          linkedAt: timestamp
        })
      ]);
    });
    const cleanup = writeBatch(userA);
    cleanup.delete(doc(userA, legacyPath));
    cleanup.delete(doc(userA, sourcePath));
    cleanup.update(doc(userA, canonicalPath), {
      sourceCount: 0,
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(cleanup.commit());
    assert.equal((await getDoc(doc(userA, legacyPath))).exists(), false);
    assert.equal((await getDoc(doc(userA, sourcePath))).exists(), false);
    assert.equal((await getDoc(doc(userA, canonicalPath))).data().sourceCount, 0);
    await assertFails(deleteDoc(doc(userA, lifecycleJourneySourcePath)));
  });

  await test('a private-only word can be removed with its membership and source', async () => {
    const wordKey = 'private-only';
    const legacyPath = 'users/user-a/words/published_private-only';
    const canonicalPath = `users/user-a/contentWords/${wordKey}`;
    const sourcePath = `${canonicalPath}/sources/private_world_private-only-world`;
    const membershipPath = 'users/user-a/customWorlds/private-only-world/words/published_private-only';
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, legacyPath), {
          text: wordKey,
          word: wordKey,
          normalizedWord: wordKey,
          wordKey,
          meaning: 'خاص',
          category: 'عام',
          userId: 'user-a',
          hiddenFromDictionary: true,
          hiddenFromDictionaryAt: timestamp,
          createdAt: timestamp
        }),
        setDoc(doc(db, canonicalPath), {
          canonicalId: wordKey,
          normalizationVersion: 1,
          normalizedWord: wordKey,
          masteryKey: wordKey,
          legacyWordId: 'published_private-only',
          word: wordKey,
          wordKey,
          meaning: 'خاص',
          translation: 'خاص',
          forgetCount: 0,
          primarySource: {
            sourceId: 'private_world_private-only-world',
            addedFrom: 'private-world',
            customWorldId: 'private-only-world'
          },
          sourceCount: 1,
          schemaVersion: 1,
          createdAt: timestamp,
          joinedAt: timestamp,
          updatedAt: timestamp
        }),
        setDoc(doc(db, sourcePath), {
          addedFrom: 'private-world',
          customWorldId: 'private-only-world',
          operationId: 'private-only-create',
          linkedAt: timestamp
        }),
        setDoc(doc(db, membershipPath), {
          text: wordKey,
          word: wordKey,
          normalizedWord: wordKey,
          wordKey,
          meaning: 'خاص',
          category: 'عام',
          userId: 'user-a',
          createdAt: timestamp
        })
      ]);
    });
    const cleanup = writeBatch(userA);
    cleanup.delete(doc(userA, membershipPath));
    cleanup.delete(doc(userA, sourcePath));
    cleanup.update(doc(userA, canonicalPath), {
      sourceCount: 0,
      updatedAt: serverTimestamp()
    });
    cleanup.delete(doc(userA, legacyPath));
    await assertSucceeds(cleanup.commit());
    assert.equal((await getDoc(doc(userA, legacyPath))).exists(), false);
  });

  await test('a private-world membership moves atomically without changing Journey sources', async () => {
    const wordKey = 'atomic-transfer';
    const canonicalPath = `users/user-a/contentWords/${wordKey}`;
    const journeySourcePath = `${canonicalPath}/sources/published_gate_atomic`;
    const sourceAPath = `${canonicalPath}/sources/private_world_atomic-a`;
    const sourceBPath = `${canonicalPath}/sources/private_world_atomic-b`;
    const membershipId = `published_${wordKey}`;
    const membershipAPath = `users/user-a/customWorlds/atomic-a/words/${membershipId}`;
    const membershipBPath = `users/user-a/customWorlds/atomic-b/words/${membershipId}`;
    const membership = {
      text: wordKey,
      word: wordKey,
      normalizedWord: wordKey,
      wordKey,
      meaning: 'نقل ذري',
      translation: 'نقل ذري',
      category: 'عام',
      userId: 'user-a',
      hiddenFromDictionary: false,
      hiddenFromDictionaryAt: null,
      createdAt: timestamp
    };
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, canonicalPath), {
          canonicalId: wordKey,
          normalizationVersion: 1,
          normalizedWord: wordKey,
          masteryKey: wordKey,
          legacyWordId: membershipId,
          word: wordKey,
          wordKey,
          meaning: 'نقل ذري',
          translation: 'نقل ذري',
          forgetCount: 0,
          primarySource: {
            sourceId: 'published_gate_atomic',
            addedFrom: 'published-gate',
            worldId: 'atomic-world',
            rankId: 'atomic-rank',
            gateId: 'atomic-gate',
            contentWordId: 'atomic-content'
          },
          sourceCount: 2,
          schemaVersion: 1,
          createdAt: timestamp,
          joinedAt: timestamp,
          updatedAt: timestamp
        }),
        setDoc(doc(db, journeySourcePath), {
          worldId: 'atomic-world',
          rankId: 'atomic-rank',
          gateId: 'atomic-gate',
          contentWordId: 'atomic-content',
          addedFrom: 'published-gate',
          operationId: 'atomic-gate-load',
          linkedAt: timestamp
        }),
        setDoc(doc(db, sourceAPath), {
          addedFrom: 'private-world',
          customWorldId: 'atomic-a',
          operationId: 'atomic-source-a',
          linkedAt: timestamp
        }),
        setDoc(doc(db, membershipAPath), membership)
      ]);
    });

    const transfer = writeBatch(userA);
    transfer.set(doc(userA, sourceBPath), {
      addedFrom: 'private-world',
      customWorldId: 'atomic-b',
      operationId: 'atomic-transfer',
      linkedAt: serverTimestamp()
    });
    transfer.set(doc(userA, membershipBPath), {
      ...membership,
      createdAt: serverTimestamp()
    });
    transfer.delete(doc(userA, sourceAPath));
    transfer.delete(doc(userA, membershipAPath));
    await assertSucceeds(transfer.commit());

    assert.equal((await getDoc(doc(userA, journeySourcePath))).exists(), true);
    assert.equal((await getDoc(doc(userA, sourceAPath))).exists(), false);
    assert.equal((await getDoc(doc(userA, sourceBPath))).exists(), true);
    assert.equal((await getDoc(doc(userA, membershipAPath))).exists(), false);
    assert.equal((await getDoc(doc(userA, membershipBPath))).exists(), true);
    assert.equal((await getDoc(doc(userA, canonicalPath))).data().sourceCount, 2);
  });

  await test('eligible Evidence is owner-bound, deterministic, and immutable', async () => {
    const uid = 'evidence-user';
    const wordKey = 'evidence-word';
    const sessionId = 'evidence-session';
    const eventId = `e1~${uid}~${sessionId}~${wordKey}`;
    const legacyWordId = 'evidence-legacy-word';
    const canonicalPath = `users/${uid}/contentWords/${wordKey}`;
    const legacyPath = `users/${uid}/words/${legacyWordId}`;
    const sessionPath = `users/${uid}/quizEvidenceSessions/${sessionId}`;
    const eventPath = `${canonicalPath}/evidence/${eventId}`;
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, legacyPath), {
          word: wordKey,
          userId: uid,
          personalDictionaryState: 'active',
          createdAt: timestamp
        }),
        setDoc(doc(db, canonicalPath), {
          canonicalId: wordKey,
          normalizationVersion: 1,
          normalizedWord: wordKey,
          masteryKey: wordKey,
          legacyWordId,
          word: wordKey,
          wordKey,
          translation: 'evidence meaning',
          meaning: 'evidence meaning',
          forgetCount: 0,
          sourceCount: 1,
          eligibleEvidenceCount: 0,
          lastEligibleEvidenceAt: null,
          lastEvidenceEventId: '',
          evidenceVersion: 1,
          schemaVersion: 1,
          createdAt: timestamp,
          joinedAt: timestamp,
          updatedAt: timestamp
        })
      ]);
    });
    const evidenceDb = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(setDoc(doc(evidenceDb, sessionPath), {
      sessionId,
      status: 'completed',
      mode: 'timeAttack',
      sourceType: 'personal',
      privateWorldId: '',
      wordKeys: [wordKey],
      correctWordKeys: [wordKey],
      totalCount: 1,
      correctCount: 1,
      evidenceVersion: 1,
      completedAt: serverTimestamp()
    }));
    const evidenceBatch = writeBatch(evidenceDb);
    evidenceBatch.set(doc(evidenceDb, eventPath), {
      eventId,
      sessionId,
      wordKey,
      sourceType: 'personal',
      privateWorldId: '',
      membershipWordId: '',
      mode: 'timeAttack',
      correct: true,
      completed: true,
      sequence: 1,
      evidenceVersion: 1,
      occurredAt: serverTimestamp()
    });
    evidenceBatch.update(doc(evidenceDb, canonicalPath), {
      eligibleEvidenceCount: 1,
      lastEligibleEvidenceAt: serverTimestamp(),
      lastEvidenceEventId: eventId,
      evidenceVersion: 1,
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(evidenceBatch.commit());
    assert.equal((await getDoc(doc(evidenceDb, canonicalPath))).data().eligibleEvidenceCount, 1);
    await assertFails(updateDoc(doc(evidenceDb, eventPath), { sequence: 2 }));
    const forgedId = `e1~other-user~${sessionId}~${wordKey}`;
    await assertFails(setDoc(doc(evidenceDb, `${canonicalPath}/evidence/${forgedId}`), {
      eventId: forgedId,
      sessionId,
      wordKey,
      sourceType: 'personal',
      privateWorldId: '',
      membershipWordId: '',
      mode: 'timeAttack',
      correct: true,
      completed: true,
      sequence: 2,
      evidenceVersion: 1,
      occurredAt: serverTimestamp()
    }));
    await assertFails(getDoc(doc(userB, eventPath)));
  });

  await test('Evidence v2 enforces separate sessions, the short interval, and a later day', async () => {
    const uid = 'evidence-v2-user';
    const wordKey = 'evidence-v2-word';
    const legacyWordId = 'evidence-v2-legacy-word';
    const canonicalPath = `users/${uid}/contentWords/${wordKey}`;
    const legacyPath = `users/${uid}/words/${legacyWordId}`;
    const currentDayKey = Math.floor(Date.now() / 86400000);
    const db = environment.authenticatedContext(uid).firestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await Promise.all([
        setDoc(doc(seedDb, legacyPath), {
          word: wordKey,
          userId: uid,
          personalDictionaryState: 'active',
          createdAt: timestamp
        }),
        setDoc(doc(seedDb, canonicalPath), {
          canonicalId: wordKey,
          normalizationVersion: 1,
          normalizedWord: wordKey,
          masteryKey: wordKey,
          legacyWordId,
          word: wordKey,
          wordKey,
          translation: 'evidence meaning',
          meaning: 'evidence meaning',
          forgetCount: 0,
          sourceCount: 1,
          eligibleEvidenceCount: 0,
          lastEligibleEvidenceAt: null,
          lastEvidenceEventId: '',
          evidenceVersion: 1,
          schemaVersion: 1,
          createdAt: timestamp,
          joinedAt: timestamp,
          updatedAt: timestamp
        })
      ]);
    });

    const createSession = async (sessionId) => assertSucceeds(setDoc(
      doc(db, `users/${uid}/quizEvidenceSessions/${sessionId}`),
      {
        sessionId,
        status: 'completed',
        mode: 'timeAttack',
        sourceType: 'personal',
        privateWorldId: '',
        wordKeys: [wordKey],
        correctWordKeys: [wordKey],
        totalCount: 1,
        correctCount: 1,
        evidenceVersion: 2,
        completedAt: serverTimestamp()
      }
    ));
    const evidenceBatch = (sessionId, sequence, localDayKey) => {
      const eventId = `e2~${uid}~${sessionId}~${wordKey}`;
      const batch = writeBatch(db);
      batch.set(doc(db, `${canonicalPath}/evidence/${eventId}`), {
        eventId,
        sessionId,
        wordKey,
        sourceType: 'personal',
        privateWorldId: '',
        membershipWordId: '',
        mode: 'timeAttack',
        correct: true,
        completed: true,
        sequence,
        evidenceVersion: 2,
        timezoneOffsetMinutes: 0,
        localDayKey,
        occurredAt: serverTimestamp()
      });
      batch.update(doc(db, canonicalPath), {
        eligibleEvidenceCount: sequence,
        lastEligibleEvidenceAt: serverTimestamp(),
        lastEvidenceEventId: eventId,
        evidenceVersion: 2,
        evidenceTimezoneOffsetMinutes: 0,
        lastEvidenceLocalDayKey: localDayKey,
        updatedAt: serverTimestamp()
      });
      return batch.commit();
    };

    await createSession('evidence-v2-session-1');
    await assertSucceeds(evidenceBatch('evidence-v2-session-1', 1, currentDayKey));
    await assertFails(evidenceBatch('evidence-v2-session-1', 2, currentDayKey));

    await createSession('evidence-v2-session-2');
    await assertFails(evidenceBatch('evidence-v2-session-2', 2, currentDayKey));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), canonicalPath), {
        lastEligibleEvidenceAt: new Date(Date.now() - (2 * 60 * 60 * 1000) - 60000),
        lastEvidenceLocalDayKey: currentDayKey
      }, { merge: true });
    });
    await assertSucceeds(evidenceBatch('evidence-v2-session-2', 2, currentDayKey));

    await createSession('evidence-v2-session-3');
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), canonicalPath), {
        lastEligibleEvidenceAt: new Date(Date.now() - (31 * 60 * 1000)),
        lastEvidenceLocalDayKey: currentDayKey
      }, { merge: true });
    });
    await assertFails(evidenceBatch('evidence-v2-session-3', 3, currentDayKey));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), canonicalPath), {
        lastEligibleEvidenceAt: new Date(Date.now() - 86400000),
        lastEvidenceLocalDayKey: currentDayKey - 1
      }, { merge: true });
    });
    await assertSucceeds(evidenceBatch('evidence-v2-session-3', 3, currentDayKey));
    assert.equal((await getDoc(doc(db, canonicalPath))).data().eligibleEvidenceCount, 3);
  });

  await test('the reported Evidence v2 transaction accepts its legacy read precondition', async () => {
    const uid = 'reported-evidence-user-00001';
    const wordKey = 'she';
    const legacyWordId = 'published_she';
    const sessionId = 'quiz_1785315205783_b72jesr';
    const eventId = `e2~${uid}~${sessionId}~${wordKey}`;
    const canonicalPath = `users/${uid}/contentWords/${wordKey}`;
    const legacyPath = `users/${uid}/words/${legacyWordId}`;
    const sessionPath = `users/${uid}/quizEvidenceSessions/${sessionId}`;
    const eventPath = `${canonicalPath}/evidence/${eventId}`;
    const timezoneOffsetMinutes = -180;
    const localDayKey = Math.floor(
      (Date.now() - timezoneOffsetMinutes * 60 * 1000) / (24 * 60 * 60 * 1000)
    );
    await environment.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await Promise.all([
        setDoc(doc(seedDb, legacyPath), {
          text: 'she',
          word: 'she',
          normalizedWord: 'she',
          wordKey,
          translation: 'هي',
          definition: 'A female person previously mentioned.',
          definition_ar: 'ضمير للغائبة.',
          example: 'She is here.',
          exampleTranslation: 'هي هنا.',
          partOfSpeech: 'pronoun',
          category: 'Pronouns',
          level: 'A1',
          tags: ['pronoun'],
          synonyms: [],
          pronunciation: '',
          notes: '',
          meaning: 'هي',
          starred: false,
          forgetCount: 0,
          userId: uid,
          xpValue: 0,
          mastery_status: 'New',
          mastery_streak: 0,
          last_recalled_at: null,
          first_recalled_at: null,
          last_recall_day: '',
          last_recall_session_id: '',
          last_quizzed_at: null,
          quiz_seen_count: 0,
          mastered_once: false,
          firstMasteredAt: null,
          hasEarnedMasteryXP: false,
          earnedTransitions: [],
          remasteryAwardCount: 0,
          xpEconomyVersion: 0,
          hiddenFromDictionary: false,
          hiddenFromDictionaryAt: null,
          personalDictionaryState: 'active',
          order: 0,
          createdAt: timestamp
        }),
        setDoc(doc(seedDb, canonicalPath), {
          canonicalId: wordKey,
          normalizationVersion: 1,
          normalizedWord: wordKey,
          masteryKey: wordKey,
          legacyWordId,
          word: wordKey,
          wordKey,
          translation: 'هي',
          definition: 'A female person previously mentioned.',
          definition_ar: 'ضمير للغائبة.',
          meaning: 'هي',
          example: 'She is here.',
          exampleTranslation: 'هي هنا.',
          partOfSpeech: 'pronoun',
          category: 'Pronouns',
          level: 'A1',
          tags: ['pronoun'],
          synonyms: [],
          pronunciation: '',
          notes: '',
          difficulty: 'A1',
          forgetCount: 0,
          contentRefPath: 'content_worlds/w/ranks/r/gates/g/words/she',
          primarySource: {
            sourceId: 'published_w~r~g~she',
            addedFrom: 'published-gate',
            worldId: 'w',
            rankId: 'r',
            gateId: 'g',
            contentWordId: 'she'
          },
          sourceCount: 1,
          eligibleEvidenceCount: 0,
          lastEligibleEvidenceAt: null,
          lastEvidenceEventId: '',
          evidenceVersion: 1,
          schemaVersion: 1,
          createdAt: timestamp,
          joinedAt: timestamp,
          updatedAt: timestamp
        })
      ]);
    });
    const db = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(setDoc(doc(db, sessionPath), {
      sessionId,
      status: 'completed',
      mode: 'timeAttack',
      sourceType: 'personal',
      privateWorldId: '',
      wordKeys: [wordKey],
      correctWordKeys: [wordKey],
      totalCount: 1,
      correctCount: 1,
      evidenceVersion: 2,
      completedAt: serverTimestamp()
    }));
    await assertSucceeds(runTransaction(db, async (transaction) => {
      const canonicalRef = doc(db, canonicalPath);
      const eventRef = doc(db, eventPath);
      const legacyRef = doc(db, legacyPath);
      await Promise.all([
        transaction.get(canonicalRef),
        transaction.get(eventRef),
        transaction.get(legacyRef)
      ]);
      transaction.set(eventRef, {
        eventId,
        sessionId,
        wordKey,
        sourceType: 'personal',
        privateWorldId: '',
        membershipWordId: '',
        mode: 'timeAttack',
        correct: true,
        completed: true,
        sequence: 1,
        evidenceVersion: 2,
        timezoneOffsetMinutes,
        localDayKey,
        occurredAt: serverTimestamp()
      });
      transaction.update(canonicalRef, {
        eligibleEvidenceCount: 1,
        lastEligibleEvidenceAt: serverTimestamp(),
        lastEvidenceEventId: eventId,
        evidenceVersion: 2,
        evidenceTimezoneOffsetMinutes: timezoneOffsetMinutes,
        lastEvidenceLocalDayKey: localDayKey,
        updatedAt: serverTimestamp()
      });
    }));
    assert.equal((await getDoc(doc(db, eventPath))).exists(), true);
  });

  await test('Gate Clear atomically clears only a ready gate and opens its next gate', async () => {
    const uid = 'gate-clear-user';
    const worldId = 'journey-world';
    const rankId = 'journey-rank';
    const gateId = 'journey-gate';
    const nextGateId = 'journey-gate-next';
    const contentWordId = 'journey-word';
    const attemptId = 'gate-clear-rules-attempt';
    const journeyPath = `users/${uid}/contentProgress/${worldId}`;
    const progressPath = `${journeyPath}/ranks/${rankId}/gates/${gateId}`;
    const nextProgressPath = `${journeyPath}/ranks/${rankId}/gates/${nextGateId}`;
    const attemptPath = `${journeyPath}/gateClearAttempts/${attemptId}`;
    const pointerPath = `users/${uid}/meta/active_content_journey`;
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, journeyPath), journey(worldId, rankId, gateId)),
        setDoc(doc(db, pointerPath), {
          worldId,
          journeyVersion: 1,
          updatedAt: timestamp
        }),
        setDoc(doc(db, progressPath), {
          ...learningGateProgress(worldId, rankId, gateId, [contentWordId], rankId, nextGateId),
          status: 'ready',
          readyEvidenceCount: 1,
          readyWordCount: 1,
          requiredWordCount: 1,
          needsEvidenceWordCount: 0,
          readinessVersion: 1,
          readyAt: timestamp,
          activeClearAttemptId: ''
        })
      ]);
    });
    const clearDb = environment.authenticatedContext(uid).firestore();
    await assertFails(updateDoc(doc(clearDb, progressPath), {
      status: 'cleared',
      clearedBy: 'gate-clear',
      clearedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp()
    }));
    const startBatch = writeBatch(clearDb);
    startBatch.set(doc(clearDb, attemptPath), {
      attemptId,
      worldId,
      rankId,
      gateId,
      questionOrder: [contentWordId],
      answers: [],
      currentQuestionIndex: 0,
      correctCount: 0,
      totalCount: 1,
      passRatio: 0.75,
      requiredCorrect: 1,
      status: 'active',
      gateClearVersion: 1,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    startBatch.update(doc(clearDb, progressPath), {
      activeClearAttemptId: attemptId,
      clearAttempts: 1,
      lastActivityAt: serverTimestamp()
    });
    await assertSucceeds(startBatch.commit());
    await assertSucceeds(updateDoc(doc(clearDb, attemptPath), {
      answers: [{
        contentWordId,
        selectedContentWordId: contentWordId,
        correct: true
      }],
      currentQuestionIndex: 1,
      correctCount: 1,
      status: 'submitting',
      updatedAt: serverTimestamp()
    }));
    const finishBatch = writeBatch(clearDb);
    finishBatch.update(doc(clearDb, attemptPath), {
      status: 'passed',
      result: 'passed',
      score: 1,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    finishBatch.update(doc(clearDb, progressPath), {
      status: 'cleared',
      activeClearAttemptId: '',
      lastClearAttemptId: attemptId,
      lastClearResult: 'passed',
      clearScore: 1,
      clearCorrect: 1,
      clearTotal: 1,
      clearedBy: 'gate-clear',
      clearedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp()
    });
    finishBatch.update(doc(clearDb, journeyPath), {
      activeRankId: rankId,
      activeGateId: nextGateId,
      unlockedRankIds: [rankId],
      unlockedGateIds: [gateId, nextGateId],
      updatedAt: serverTimestamp()
    });
    finishBatch.set(
      doc(clearDb, nextProgressPath),
      availableGateProgress(worldId, rankId, nextGateId)
    );
    finishBatch.update(doc(clearDb, pointerPath), { updatedAt: serverTimestamp() });
    await assertSucceeds(finishBatch.commit());
    const [savedProgress, nextProgress, savedAttempt] = await Promise.all([
      getDoc(doc(clearDb, progressPath)),
      getDoc(doc(clearDb, nextProgressPath)),
      getDoc(doc(clearDb, attemptPath))
    ]);
    assert.equal(savedProgress.data().status, 'cleared');
    assert.equal(nextProgress.data().status, 'available');
    assert.equal(savedAttempt.data().status, 'passed');
    await assertFails(getDoc(doc(userB, attemptPath)));
  });

  await test('Gate Clear records rank completion only with its atomic boundary transition', async () => {
    async function seedReadyGate({
      uid,
      worldId,
      rankId,
      gateId,
      contentWordId,
      nextRankId,
      nextGateId,
      attemptId
    }) {
      const journeyPath = `users/${uid}/contentProgress/${worldId}`;
      const progressPath = `${journeyPath}/ranks/${rankId}/gates/${gateId}`;
      const attemptPath = `${journeyPath}/gateClearAttempts/${attemptId}`;
      const pointerPath = `users/${uid}/meta/active_content_journey`;
      await environment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await Promise.all([
          setDoc(doc(db, journeyPath), {
            ...journey(worldId, rankId, gateId),
            completedRankIds: [],
            rankCompletionVersions: {}
          }),
          setDoc(doc(db, pointerPath), {
            worldId,
            journeyVersion: 1,
            updatedAt: timestamp
          }),
          setDoc(doc(db, progressPath), {
            ...learningGateProgress(
              worldId,
              rankId,
              gateId,
              [contentWordId],
              nextRankId,
              nextGateId
            ),
            status: 'ready',
            readyEvidenceCount: 1,
            readyWordCount: 1,
            requiredWordCount: 1,
            needsEvidenceWordCount: 0,
            readinessVersion: 1,
            readyAt: timestamp,
            activeClearAttemptId: attemptId,
            clearAttempts: 1
          }),
          setDoc(doc(db, attemptPath), {
            attemptId,
            worldId,
            rankId,
            gateId,
            questionOrder: [contentWordId],
            answers: [{
              contentWordId,
              selectedContentWordId: contentWordId,
              correct: true
            }],
            currentQuestionIndex: 1,
            correctCount: 1,
            totalCount: 1,
            passRatio: 0.75,
            requiredCorrect: 1,
            status: 'submitting',
            gateClearVersion: 1,
            startedAt: timestamp,
            updatedAt: timestamp
          })
        ]);
      });
      return { journeyPath, progressPath, attemptPath, pointerPath };
    }

    function finishGateBatch(db, paths, {
      worldId,
      rankId,
      gateId,
      attemptId,
      nextRankId,
      nextGateId,
      completedCurrentContent = false,
      recordWorldCompletion = false
    }) {
      const batch = writeBatch(db);
      batch.update(doc(db, paths.attemptPath), {
        status: 'passed',
        result: 'passed',
        score: 1,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      batch.update(doc(db, paths.progressPath), {
        status: 'cleared',
        activeClearAttemptId: '',
        lastClearAttemptId: attemptId,
        lastClearResult: 'passed',
        clearScore: 1,
        clearCorrect: 1,
        clearTotal: 1,
        clearedBy: 'gate-clear',
        clearedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp()
      });
      if (completedCurrentContent) {
        const journeyUpdate = {
          completedRankIds: [rankId],
          rankCompletionVersions: { [rankId]: 1 },
          contentJourneyStatus: 'completed-current-content',
          updatedAt: serverTimestamp()
        };
        if (recordWorldCompletion) {
          journeyUpdate.worldCompletion = {
            version: 1,
            status: 'completed',
            worldId,
            completionId: `world_completion_v1_${worldId}_${rankId}`,
            requiredRankIds: [rankId],
            rankVersions: { [rankId]: 1 },
            completedBy: 'gate-clear',
            completedAt: serverTimestamp()
          };
        }
        batch.update(doc(db, paths.journeyPath), journeyUpdate);
      } else {
        batch.update(doc(db, paths.journeyPath), {
          activeRankId: nextRankId,
          activeGateId: nextGateId,
          unlockedRankIds: [rankId, nextRankId],
          unlockedGateIds: [gateId, nextGateId],
          completedRankIds: [rankId],
          rankCompletionVersions: { [rankId]: 1 },
          updatedAt: serverTimestamp()
        });
        batch.set(
          doc(db, `${paths.journeyPath}/ranks/${nextRankId}/gates/${nextGateId}`),
          availableGateProgress(worldId, nextRankId, nextGateId)
        );
      }
      batch.update(doc(db, paths.pointerPath), { updatedAt: serverTimestamp() });
      return batch;
    }

    const boundary = {
      uid: 'rank-boundary-user',
      worldId: 'level-world',
      rankId: 'level-rank-a1',
      gateId: 'level-gate-a1',
      contentWordId: 'level-word-a1',
      nextRankId: 'level-rank-a2',
      nextGateId: 'level-gate-a2',
      attemptId: 'rank-boundary-attempt'
    };
    const boundaryPaths = await seedReadyGate(boundary);
    const boundaryDb = environment.authenticatedContext(boundary.uid).firestore();
    const boundaryDbSecondDevice = environment.authenticatedContext(boundary.uid).firestore();
    await assertFails(updateDoc(doc(boundaryDb, boundaryPaths.journeyPath), {
      completedRankIds: [boundary.rankId],
      rankCompletionVersions: { [boundary.rankId]: 1 },
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(boundaryDb, boundaryPaths.journeyPath), {
      rewardXp: 5000,
      updatedAt: serverTimestamp()
    }));
    const concurrentResults = await Promise.allSettled([
      finishGateBatch(boundaryDb, boundaryPaths, boundary).commit(),
      finishGateBatch(boundaryDbSecondDevice, boundaryPaths, boundary).commit()
    ]);
    assert.equal(
      concurrentResults.filter((result) => result.status === 'fulfilled').length,
      1
    );
    assert.equal(
      concurrentResults.filter((result) => result.status === 'rejected').length,
      1
    );
    const boundaryJourney = (await getDoc(
      doc(boundaryDb, boundaryPaths.journeyPath)
    )).data();
    assert.deepEqual(boundaryJourney.completedRankIds, [boundary.rankId]);
    assert.equal(boundaryJourney.rankCompletionVersions[boundary.rankId], 1);
    assert.equal(boundaryJourney.activeRankId, boundary.nextRankId);

    const finalContent = {
      uid: 'rank-final-content-user',
      worldId: 'journey-world-two',
      rankId: 'journey-rank-two',
      gateId: 'journey-gate-two',
      contentWordId: 'final-content-word',
      nextRankId: '',
      nextGateId: '',
      attemptId: 'rank-final-content-attempt',
      completedCurrentContent: true,
      recordWorldCompletion: true
    };
    const finalPaths = await seedReadyGate(finalContent);
    const finalDb = environment.authenticatedContext(finalContent.uid).firestore();
    await assertFails(updateDoc(doc(finalDb, finalPaths.journeyPath), {
      worldCompletion: {
        version: 1,
        status: 'completed',
        worldId: finalContent.worldId,
        completionId: 'forged-before-final-boundary',
        requiredRankIds: [finalContent.rankId],
        rankVersions: { [finalContent.rankId]: 1 },
        completedBy: 'gate-clear',
        completedAt: serverTimestamp()
      },
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(finishGateBatch(
      finalDb,
      finalPaths,
      finalContent
    ).commit());
    const finalJourney = (await getDoc(
      doc(finalDb, finalPaths.journeyPath)
    )).data();
    assert.equal(finalJourney.contentJourneyStatus, 'completed-current-content');
    assert.deepEqual(finalJourney.completedRankIds, [finalContent.rankId]);
    assert.equal(finalJourney.worldCompletion.status, 'completed');
    assert.equal(finalJourney.worldCompletion.completedBy, 'gate-clear');
    assert.deepEqual(finalJourney.worldCompletion.requiredRankIds, [finalContent.rankId]);
    await assertFails(updateDoc(doc(finalDb, finalPaths.journeyPath), {
      'worldCompletion.completionId': 'replayed-or-replaced',
      updatedAt: serverTimestamp()
    }));
    await assertFails(finishGateBatch(finalDb, finalPaths, finalContent).commit());
  });

  await test('manual unlock placeholders reject invented thresholds', async () => {
    const invalid = {
      ...rank('published-world', 'invented-unlock', 'draft'),
      unlockConfig: { ...unlockConfig, requiredMasteredRatio: 0.8 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    };
    await assertFails(setDoc(
      doc(admin, 'content_worlds/published-world/ranks/invented-unlock'),
      invalid
    ));
  });

  await test('diagnoses the production-sized new-ranks result commit', async () => {
    const uid = 'production-sized-outcome-user';
    const worldId = 'production-sized-outcome-world';
    const assessmentId =
      'level_placement_v2_A1_production_sized_outcome';
    const oldRankIds = [
      'R4NDhUw0L0gXgSwkbE1O',
      'VVSBrZ9o2F4eQUfaCqnf',
      'VsRcZlJP3hV2hNL6Thl1',
      'zH10H8d3GZcdMyy9HRx2'
    ];
    const oldGateIds = Array.from({ length: 19 }, (_, index) => `old-gate-${index}`);
    const rankGateIds = {
      gw7HL4JwTwKDUpCs2JcF: [
        'RaXFlTd649dE8rd1z7NJ',
        'YFc34mAfG6SkydCdrlJu',
        '50noBdFPkjb67n6gs9iH',
        'HeAJaVCo7IZxfNEbYAIg',
        'kKepW8q7iBBAc7pHpi3E'
      ],
      MSvvFKsy1uZYpQ1g2mV8: [
        'K7DipPCJItok3sJtmzOc',
        'TPHgACcOd1Fxd2XPGqdW',
        'xTvzdmrsu8M8Gpm4qnHs',
        'oSZuGDllLzzViX4HnwrF',
        'RMV7yrYzVRuVYbP6Zl6X'
      ]
    };
    const newRankIds = Object.keys(rankGateIds);
    const clearedGateIds = Object.values(rankGateIds).flat();
    const targetRankId = 'first-a2-rank';
    const targetGateId = 'first-a2-gate';
    const availableGateIds = [targetGateId];
    const activeRankId = oldRankIds[0];
    const activeGateId = 'fP49BRVyujuU4UqzUoey';
    const journeyPath = `users/${uid}/contentProgress/${worldId}`;
    const sessionPath = `${journeyPath}/levelPlacementSessions/${assessmentId}`;
    const pointerPath = `users/${uid}/meta/active_content_journey`;
    const db = environment.authenticatedContext(uid).firestore();

    await environment.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      const documents = [
        [`content_worlds/${worldId}`, world(worldId, 'published')],
        [`content_worlds/${worldId}/ranks/${activeRankId}`, rank(worldId, activeRankId, 'published')],
        [`content_worlds/${worldId}/ranks/${activeRankId}/gates/${activeGateId}`,
          gate(worldId, activeRankId, activeGateId, 'published')]
      ];
      for (const [rankId, gateIds] of Object.entries(rankGateIds)) {
        documents.push([
          `content_worlds/${worldId}/ranks/${rankId}`,
          rank(worldId, rankId, 'published')
        ]);
        gateIds.forEach((gateId, order) => documents.push([
          `content_worlds/${worldId}/ranks/${rankId}/gates/${gateId}`,
          { ...gate(worldId, rankId, gateId, 'published'), order }
        ]));
      }
      documents.push([
        `content_worlds/${worldId}/ranks/${targetRankId}`,
        { ...rank(worldId, targetRankId, 'published'), cefrLevel: 'A2', order: 0 }
      ]);
      documents.push([
        `content_worlds/${worldId}/ranks/${targetRankId}/gates/${targetGateId}`,
        { ...gate(worldId, targetRankId, targetGateId, 'published'), order: 0 }
      ]);
      documents.push([
        journeyPath,
        {
          ...journey(worldId, activeRankId, activeGateId),
          placementStatus: 'completed',
          activeLevelPlacementAssessmentId: assessmentId,
          activeLevelPlacementCefrLevel: 'A1',
          levelPlacementStatus: 'active',
          levelPlacementVersion: 2,
          passedCefrLevels: ['A1'],
          partialCefrLevels: [],
          unlockedRankIds: oldRankIds,
          unlockedGateIds: oldGateIds,
          contentJourneyStatus: 'in-progress',
          levelPlacementAssessmentIds: {},
          levelPlacementPassedRankIds: oldRankIds
        }
      ]);
      documents.push([
        pointerPath,
        { worldId, journeyVersion: 1, updatedAt: timestamp }
      ]);
      documents.push([
        sessionPath,
        {
          ...levelPlacementSession(assessmentId, {
            worldId,
            placementVersion: 2,
            assessmentMode: 'new-ranks',
            status: 'awaiting-decision',
            orderedRankIds: newRankIds,
            testedRankIds: newRankIds,
            assessedRankIds: [...newRankIds, ...oldRankIds],
            assessedRankVersions: {
              [newRankIds[0]]: 5,
              [newRankIds[1]]: 6
            },
            rankVersions: {
              [newRankIds[0]]: 5,
              [newRankIds[1]]: 6
            },
            passedRankIds: newRankIds,
            passedPrefixLength: 2,
            passedLevel: true,
            perRankStats: {
              [newRankIds[0]]: {
                asked: 4, correct: 4, ratio: 1, passThreshold: 0.75,
                requiredCorrect: 3, confidence: 'high', status: 'passed'
              },
              [newRankIds[1]]: {
                asked: 4, correct: 4, ratio: 1, passThreshold: 0.75,
                requiredCorrect: 3, confidence: 'high', status: 'passed'
              }
            },
            resultApplied: false,
            answersCompletedAt: timestamp
          })
        }
      ]);
      for (const [path, data] of documents) {
        await setDoc(doc(seedDb, path), data);
      }
    });

    const addOutcomeWrites = (
      batch,
      includeSession,
      includeTargetProgress,
      clearedGateLedgerIds = []
    ) => {
      batch.update(doc(db, journeyPath), {
        activeRankId: targetRankId,
        activeGateId: targetGateId,
        unlockedRankIds: [...oldRankIds, ...newRankIds, targetRankId],
        unlockedGateIds: [...oldGateIds, ...clearedGateIds, ...availableGateIds],
        passedCefrLevels: ['A1'],
        partialCefrLevels: [],
        levelPlacementAssessmentIds: { A1: assessmentId },
        levelPlacementPassedRankIds: [...oldRankIds, ...newRankIds],
        levelPlacementClearedGateIds: clearedGateLedgerIds,
        contentJourneyStatus: 'in-progress',
        activeLevelPlacementAssessmentId: '',
        activeLevelPlacementCefrLevel: '',
        levelPlacementStatus: 'completed',
        updatedAt: serverTimestamp()
      });
      if (includeSession) {
        batch.update(doc(db, sessionPath), {
          status: 'completed',
          resultApplied: true,
          assessedAt: serverTimestamp(),
          completedAt: serverTimestamp(),
          nextCefrLevel: 'A2',
          resultStartRankId: targetRankId,
          resultStartGateId: targetGateId,
          resultUnlockedRankIds: [...newRankIds, targetRankId],
          resultUnlockedGateIds: [...clearedGateIds, ...availableGateIds],
          resultClearedGateIds: clearedGateIds,
          completedCurrentContent: false,
          updatedAt: serverTimestamp()
        });
      }
      if (includeTargetProgress) {
        batch.set(
          doc(db, `${journeyPath}/ranks/${targetRankId}/gates/${targetGateId}`),
          availableGateProgress(worldId, targetRankId, targetGateId)
        );
      }
    };

    const incomplete = writeBatch(db);
    addOutcomeWrites(incomplete, false, false, clearedGateIds);
    await assertFails(incomplete.commit());

    const missingClearLedger = writeBatch(db);
    addOutcomeWrites(missingClearLedger, true, false, []);
    await assertFails(missingClearLedger.commit());

    const result = writeBatch(db);
    addOutcomeWrites(result, true, false, clearedGateIds);
    await assertSucceeds(result.commit());

    const savedJourney = await getDoc(doc(db, journeyPath));
    const savedSession = await getDoc(doc(db, sessionPath));
    const savedTarget = await getDoc(
      doc(db, `${journeyPath}/ranks/${targetRankId}/gates/${targetGateId}`)
    );
    assert.equal(savedJourney.data().levelPlacementStatus, 'completed');
    assert.equal(savedJourney.data().activeLevelPlacementAssessmentId, '');
    assert.equal(savedSession.data().status, 'completed');
    assert.deepEqual(savedSession.data().resultClearedGateIds, clearedGateIds);
    assert.deepEqual(savedJourney.data().levelPlacementClearedGateIds, clearedGateIds);
    assert.equal(savedJourney.data().activeRankId, targetRankId);
    assert.equal(savedJourney.data().activeGateId, targetGateId);
    assert.equal(savedTarget.exists(), false);
  });

  await test('accepts a production-sized full-level outcome without atomic gate fan-out', async () => {
    const uid = 'production-sized-full-level-user';
    const worldId = 'production-sized-full-level-world';
    const assessmentId = 'level_placement_v2_A1_production_full_level';
    const passedRankIds = ['full-rank-1', 'full-rank-2', 'full-rank-3', 'full-rank-4'];
    const rankGateIds = Object.fromEntries(passedRankIds.map((rankId, rankIndex) => [
      rankId,
      Array.from({ length: rankIndex === 0 ? 4 : 5 }, (_, gateIndex) => (
        `full-gate-${rankIndex + 1}-${gateIndex + 1}`
      ))
    ]));
    const clearedGateIds = Object.values(rankGateIds).flat();
    const targetRankId = 'full-rank-a2';
    const targetGateId = 'full-gate-a2-1';
    const activeRankId = passedRankIds[0];
    const activeGateId = rankGateIds[activeRankId][0];
    const journeyPath = `users/${uid}/contentProgress/${worldId}`;
    const sessionPath = `${journeyPath}/levelPlacementSessions/${assessmentId}`;
    const pointerPath = `users/${uid}/meta/active_content_journey`;
    const db = environment.authenticatedContext(uid).firestore();

    await environment.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      const documents = [
        [`content_worlds/${worldId}`, world(worldId, 'published')],
        [`content_worlds/${worldId}/ranks/${targetRankId}`, {
          ...rank(worldId, targetRankId, 'published'),
          cefrLevel: 'A2'
        }],
        [`content_worlds/${worldId}/ranks/${targetRankId}/gates/${targetGateId}`,
          gate(worldId, targetRankId, targetGateId, 'published')]
      ];
      for (const [rankId, gateIds] of Object.entries(rankGateIds)) {
        documents.push([`content_worlds/${worldId}/ranks/${rankId}`, {
          ...rank(worldId, rankId, 'published'),
          cefrLevel: 'A1'
        }]);
        gateIds.forEach((gateId, order) => documents.push([
          `content_worlds/${worldId}/ranks/${rankId}/gates/${gateId}`,
          { ...gate(worldId, rankId, gateId, 'published'), order }
        ]));
      }
      documents.push([journeyPath, {
        ...journey(worldId, activeRankId, activeGateId),
        placementStatus: 'completed',
        activeLevelPlacementAssessmentId: assessmentId,
        activeLevelPlacementCefrLevel: 'A1',
        levelPlacementStatus: 'active',
        levelPlacementVersion: 2,
        passedCefrLevels: [],
        partialCefrLevels: [],
        contentJourneyStatus: 'in-progress',
        levelPlacementAssessmentIds: {},
        levelPlacementPassedRankIds: []
      }]);
      documents.push([pointerPath, {
        worldId,
        journeyVersion: 1,
        updatedAt: timestamp
      }]);
      documents.push([sessionPath, levelPlacementSession(assessmentId, {
        worldId,
        cefrLevel: 'A1',
        placementVersion: 2,
        assessmentMode: 'full-level',
        status: 'awaiting-decision',
        orderedRankIds: passedRankIds,
        testedRankIds: passedRankIds,
        assessedRankIds: passedRankIds,
        passedRankIds,
        passedPrefixLength: passedRankIds.length,
        passedLevel: true,
        perRankStats: Object.fromEntries(passedRankIds.map((rankId) => [rankId, {
          asked: 1,
          correct: 1,
          ratio: 1,
          passThreshold: 0.75,
          requiredCorrect: 1,
          confidence: 'low',
          status: 'passed'
        }])),
        resultApplied: false,
        answersCompletedAt: timestamp
      })]);
      for (const [path, data] of documents) {
        await setDoc(doc(seedDb, path), data);
      }
    });

    const result = writeBatch(db);
    result.update(doc(db, journeyPath), {
      activeRankId: targetRankId,
      activeGateId: targetGateId,
      unlockedRankIds: [...passedRankIds, targetRankId],
      unlockedGateIds: [...clearedGateIds, targetGateId],
      passedCefrLevels: ['A1'],
      partialCefrLevels: [],
      activeLevelPlacementAssessmentId: '',
      activeLevelPlacementCefrLevel: '',
      levelPlacementStatus: 'completed',
      contentJourneyStatus: 'in-progress',
      levelPlacementAssessmentIds: { A1: assessmentId },
      levelPlacementPassedRankIds: passedRankIds,
      levelPlacementClearedGateIds: clearedGateIds,
      updatedAt: serverTimestamp()
    });
    result.update(doc(db, sessionPath), {
      status: 'completed',
      resultApplied: true,
      assessedAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      nextCefrLevel: 'A2',
      resultStartRankId: targetRankId,
      resultStartGateId: targetGateId,
      resultUnlockedRankIds: [...passedRankIds, targetRankId],
      resultUnlockedGateIds: [...clearedGateIds, targetGateId],
      resultClearedGateIds: clearedGateIds,
      completedCurrentContent: false,
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(result.commit());
    const savedJourney = await getDoc(doc(db, journeyPath));
    const projectedGate = await getDoc(doc(
      db,
      `${journeyPath}/ranks/${passedRankIds[0]}/gates/${clearedGateIds[0]}`
    ));
    assert.deepEqual(savedJourney.data().levelPlacementClearedGateIds, clearedGateIds);
    assert.equal(projectedGate.exists(), false);
  });

  await test('production-a2-e2e accepts 24 answers and the full next-level outcome', async () => {
    const uid = 'production-sized-a2-start-user';
    const worldId = 'production-sized-a2-start-world';
    const assessmentId = 'level_placement_v2_A2_production_sized_start';
    const a1RankIds = Array.from({ length: 4 }, (_, index) => `a1-rank-${index + 1}`);
    const a1GateIds = Array.from({ length: 19 }, (_, index) => `a1-gate-${index + 1}`);
    const a2RankIds = Array.from({ length: 6 }, (_, index) => `a2-rank-${index + 1}`);
    const a2GateIds = a2RankIds.flatMap((_, rankIndex) => (
      Array.from({ length: 3 }, (_, gateIndex) => (
        `a2-gate-${rankIndex + 1}-${gateIndex + 1}`
      ))
    ));
    const activeRankId = a2RankIds[0];
    const activeGateId = 'a2-gate-1-1';
    const nextRankId = 'b1-rank-1';
    const nextGateId = 'b1-gate-1-1';
    const journeyPath = `users/${uid}/contentProgress/${worldId}`;
    const sessionPath = `${journeyPath}/levelPlacementSessions/${assessmentId}`;
    const db = environment.authenticatedContext(uid).firestore();
    const selectedWords = a2RankIds.flatMap((rankId, rankIndex) => (
      Array.from({ length: 6 }, (_, wordIndex) => {
        const questionNumber = (rankIndex * 6) + wordIndex + 1;
        return {
          questionId: `a2-question-${questionNumber}`,
          rankId,
          gateId: `a2-gate-${rankIndex + 1}-${(wordIndex % 3) + 1}`,
          contentWordId: `a2-word-${questionNumber}`,
          normalizedWord: `word-${questionNumber}`,
          wordKey: `a2-word-key-${questionNumber}`,
          order: wordIndex,
          word: `word-${questionNumber}`,
          translation: `meaning-${questionNumber}`,
          passThreshold: 0.75,
          category: '',
          partOfSpeech: '',
          definition: '',
          definition_ar: '',
          example: '',
          exampleTranslation: '',
          level: 'A2',
          tags: [],
          synonyms: [],
          pronunciation: '',
          notes: ''
        };
      })
    ));
    const primaryWords = a2RankIds.flatMap((_, rankIndex) => (
      selectedWords.slice(rankIndex * 6, (rankIndex * 6) + 4)
    ));
    const rankVersions = Object.fromEntries(a2RankIds.map((rankId) => [rankId, 1]));
    const firstGateIds = Object.fromEntries(a2RankIds.map((rankId, index) => [
      rankId,
      `a2-gate-${index + 1}-1`
    ]));
    const session = levelPlacementSession(assessmentId, {
      worldId,
      cefrLevel: 'A2',
      assessmentSeed: `${worldId}:A2:production-shaped-emulator-payload`,
      orderedQuestionIds: primaryWords.map((item) => item.questionId),
      selectedContentWordIds: selectedWords.map((item) => item.contentWordId),
      selectedWords,
      placementVersion: 2,
      assessmentMode: 'full-level',
      previousAssessmentId: '',
      testedRankIds: a2RankIds,
      assessedRankIds: a2RankIds,
      assessedRankVersions: rankVersions,
      publishedRankSetHash: 'six-a2-rank-snapshot',
      rankVersions,
      orderedRankIds: a2RankIds,
      rankTitles: Object.fromEntries(a2RankIds.map((rankId) => [rankId, rankId])),
      rankFirstGateIds: firstGateIds,
      rankCoverage: Object.fromEntries(a2RankIds.map((rankId) => [rankId, {
        requested: 4,
        selected: 4,
        reserve: 2,
        weak: false
      }])),
      adaptiveReserveIdsByRank: Object.fromEntries(a2RankIds.map((rankId, index) => [
        rankId,
        selectedWords.slice((index * 6) + 4, (index * 6) + 6).map((item) => item.questionId)
      ]))
    });

    const parent = {
      ...journey(worldId, activeRankId, activeGateId),
      placementStatus: 'completed',
      activePlacementAssessmentId: '',
      unlockedRankIds: [...a1RankIds, activeRankId],
      unlockedGateIds: [...a1GateIds, activeGateId],
      activeLevelPlacementAssessmentId: '',
      activeLevelPlacementCefrLevel: '',
      levelPlacementStatus: 'completed',
      levelPlacementVersion: 2,
      passedCefrLevels: ['A1'],
      partialCefrLevels: [],
      contentJourneyStatus: 'in-progress',
      levelPlacementAssessmentIds: { A1: 'level_placement_v2_A1_committed' },
      levelPlacementPassedRankIds: a1RankIds,
      levelPlacementClearedGateIds: a1GateIds
    };
    const seedJourneyCase = async (caseUid, options = {}) => {
      const caseJourneyPath = `users/${caseUid}/contentProgress/${worldId}`;
      const caseSessionPath = `${caseJourneyPath}/levelPlacementSessions/${assessmentId}`;
      const casePointerPath = `users/${caseUid}/meta/active_content_journey`;
      await environment.withSecurityRulesDisabled(async (context) => {
        const seedDb = context.firestore();
        await setDoc(doc(seedDb, caseJourneyPath), {
          ...parent,
          ...(options.parentActive ? {
            activeLevelPlacementAssessmentId: assessmentId,
            activeLevelPlacementCefrLevel: 'A2',
            levelPlacementStatus: 'active'
          } : {})
        });
        await setDoc(doc(seedDb, casePointerPath), {
          worldId,
          journeyVersion: 1,
          updatedAt: timestamp
        });
        if (options.seedSession) {
          await setDoc(doc(seedDb, caseSessionPath), {
            ...session,
            startedAt: timestamp,
            updatedAt: timestamp
          });
        }
      });
      return { caseJourneyPath, caseSessionPath };
    };

    await environment.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await setDoc(doc(seedDb, `content_worlds/${worldId}`), world(worldId, 'published'));
      for (const [rankIndex, rankId] of a2RankIds.entries()) {
        await setDoc(doc(seedDb, `content_worlds/${worldId}/ranks/${rankId}`), {
          ...rank(worldId, rankId, 'published'),
          cefrLevel: 'A2',
          order: rankIndex + 1
        });
        for (let gateIndex = 0; gateIndex < 3; gateIndex += 1) {
          const gateId = `a2-gate-${rankIndex + 1}-${gateIndex + 1}`;
          await setDoc(
            doc(seedDb, `content_worlds/${worldId}/ranks/${rankId}/gates/${gateId}`),
            { ...gate(worldId, rankId, gateId, 'published'), order: gateIndex + 1 }
          );
        }
      }
      await setDoc(doc(seedDb, `content_worlds/${worldId}/ranks/${nextRankId}`), {
        ...rank(worldId, nextRankId, 'published'),
        cefrLevel: 'B1',
        order: 1
      });
      await setDoc(
        doc(seedDb, `content_worlds/${worldId}/ranks/${nextRankId}/gates/${nextGateId}`),
        gate(worldId, nextRankId, nextGateId, 'published')
      );
    });
    await seedJourneyCase(uid);

    const sessionOnlyUid = `${uid}-session-only`;
    const sessionOnlyPaths = await seedJourneyCase(sessionOnlyUid, { parentActive: true });
    const sessionOnlyDb = environment.authenticatedContext(sessionOnlyUid).firestore();
    await assertSucceeds(setDoc(doc(sessionOnlyDb, sessionOnlyPaths.caseSessionPath), session));

    const parentOnlyUid = `${uid}-parent-only`;
    const parentOnlyPaths = await seedJourneyCase(parentOnlyUid, { seedSession: true });
    const parentOnlyDb = environment.authenticatedContext(parentOnlyUid).firestore();
    await assertSucceeds(updateDoc(doc(parentOnlyDb, parentOnlyPaths.caseJourneyPath), {
      activeLevelPlacementAssessmentId: assessmentId,
      activeLevelPlacementCefrLevel: 'A2',
      levelPlacementStatus: 'active',
      levelPlacementVersion: 2,
      placementStatus: 'completed',
      passedCefrLevels: ['A1'],
      updatedAt: serverTimestamp()
    }));

    const batch = writeBatch(db);
    batch.set(doc(db, sessionPath), session);
    batch.update(doc(db, journeyPath), {
      activeLevelPlacementAssessmentId: assessmentId,
      activeLevelPlacementCefrLevel: 'A2',
      levelPlacementStatus: 'active',
      levelPlacementVersion: 2,
      placementStatus: 'completed',
      passedCefrLevels: ['A1'],
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());

    const [savedJourney, savedSession] = await Promise.all([
      getDoc(doc(db, journeyPath)),
      getDoc(doc(db, sessionPath))
    ]);
    assert.equal(savedSession.exists(), true);
    assert.equal(savedSession.data().status, 'active');
    assert.equal(savedSession.data().cefrLevel, 'A2');
    assert.equal(savedSession.data().orderedQuestionIds.length, 24);
    assert.equal(savedSession.data().selectedWords.length, 36);
    assert.deepEqual(savedSession.data().testedRankIds, a2RankIds);
    assert.equal(savedJourney.data().activeLevelPlacementAssessmentId, assessmentId);
    assert.equal(savedJourney.data().activeLevelPlacementCefrLevel, 'A2');
    assert.equal(savedJourney.data().levelPlacementStatus, 'active');
    assert.equal(savedJourney.data().activeRankId, activeRankId);
    assert.equal(savedJourney.data().activeGateId, activeGateId);
    assert.deepEqual(savedJourney.data().levelPlacementPassedRankIds, a1RankIds);
    assert.deepEqual(savedJourney.data().levelPlacementClearedGateIds, a1GateIds);

    const answers = [];
    for (let index = 0; index < primaryWords.length; index += 1) {
      const word = primaryWords[index];
      answers.push({
        questionId: word.questionId,
        rankId: word.rankId,
        gateId: word.gateId,
        contentWordId: word.contentWordId,
        wordKey: word.wordKey,
        selectedQuestionId: word.questionId,
        correct: true
      });
      const finalAnswer = index === primaryWords.length - 1;
      const update = {
        status: finalAnswer ? 'awaiting-decision' : 'active',
        currentQuestionIndex: index + 1,
        orderedQuestionIds: primaryWords.map((item) => item.questionId),
        answers: answers.slice(),
        correctCount: index + 1,
        adaptiveRound: 0,
        adaptiveRankIds: [],
        perRankStats: finalAnswer ? Object.fromEntries(a2RankIds.map((rankId) => [rankId, {
          asked: 4,
          correct: 4,
          ratio: 1,
          passThreshold: 0.75,
          requiredCorrect: 3,
          confidence: 'high',
          status: 'passed'
        }])) : {},
        ambiguousRankIds: [],
        recommendedStartRankId: '',
        recommendedStartGateId: '',
        passedRankIds: finalAnswer ? a2RankIds : [],
        passedPrefixLength: finalAnswer ? a2RankIds.length : 0,
        passedLevel: finalAnswer,
        ...(finalAnswer ? {
          answersCompletedAt: serverTimestamp(),
          resultApplied: false
        } : {}),
        updatedAt: serverTimestamp()
      };
      await assertSucceeds(updateDoc(doc(db, sessionPath), update));
    }

    const awaitingSession = await getDoc(doc(db, sessionPath));
    assert.equal(awaitingSession.data().status, 'awaiting-decision');
    assert.equal(awaitingSession.data().answers.length, 24);
    assert.deepEqual(awaitingSession.data().passedRankIds, a2RankIds);
    assert.equal(awaitingSession.data().passedLevel, true);

    const result = writeBatch(db);
    result.update(doc(db, journeyPath), {
      activeRankId: nextRankId,
      activeGateId: nextGateId,
      unlockedRankIds: [...a1RankIds, ...a2RankIds, nextRankId],
      unlockedGateIds: [...a1GateIds, ...a2GateIds, nextGateId],
      passedCefrLevels: ['A1', 'A2'],
      partialCefrLevels: [],
      activeLevelPlacementAssessmentId: '',
      activeLevelPlacementCefrLevel: '',
      levelPlacementStatus: 'completed',
      contentJourneyStatus: 'in-progress',
      levelPlacementAssessmentIds: {
        A1: 'level_placement_v2_A1_committed',
        A2: assessmentId
      },
      levelPlacementPassedRankIds: [...a1RankIds, ...a2RankIds],
      levelPlacementClearedGateIds: [...a1GateIds, ...a2GateIds],
      updatedAt: serverTimestamp()
    });
    result.update(doc(db, sessionPath), {
      status: 'completed',
      resultApplied: true,
      assessedAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      nextCefrLevel: 'B1',
      resultStartRankId: nextRankId,
      resultStartGateId: nextGateId,
      resultUnlockedRankIds: [...a2RankIds, nextRankId],
      resultUnlockedGateIds: [...a2GateIds, nextGateId],
      resultClearedGateIds: a2GateIds,
      completedCurrentContent: false,
      updatedAt: serverTimestamp()
    });
    await assertSucceeds(result.commit());

    const [completedJourney, completedSession] = await Promise.all([
      getDoc(doc(db, journeyPath)),
      getDoc(doc(db, sessionPath))
    ]);
    assert.equal(completedSession.data().status, 'completed');
    assert.equal(completedSession.data().resultApplied, true);
    assert.equal(completedSession.data().resultStartRankId, nextRankId);
    assert.equal(completedSession.data().resultStartGateId, nextGateId);
    assert.equal(completedJourney.data().activeRankId, nextRankId);
    assert.equal(completedJourney.data().activeGateId, nextGateId);
    assert.equal(completedJourney.data().levelPlacementStatus, 'completed');
    assert.deepEqual(completedJourney.data().passedCefrLevels, ['A1', 'A2']);
  });

  await test('a completed paused Level Placement resumes to its result decision', async () => {
    const uid = 'paused-level-result-user';
    const worldId = 'level-world';
    const assessmentId = 'level_placement_v2_A1_paused_result';
    const journeyPath = `users/${uid}/contentProgress/${worldId}`;
    const sessionPath = `${journeyPath}/levelPlacementSessions/${assessmentId}`;
    const pointerPath = `users/${uid}/meta/active_content_journey`;
    const db = environment.authenticatedContext(uid).firestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const seedDb = context.firestore();
      await setDoc(doc(seedDb, journeyPath), {
        ...journey(worldId, 'level-rank-a1', 'level-gate-a1'),
        activeLevelPlacementAssessmentId: assessmentId,
        activeLevelPlacementCefrLevel: 'A1',
        levelPlacementStatus: 'paused',
        levelPlacementVersion: 2,
        passedCefrLevels: [],
        partialCefrLevels: []
      });
      await setDoc(doc(seedDb, pointerPath), {
        worldId,
        journeyVersion: 1,
        updatedAt: timestamp
      });
      await setDoc(doc(seedDb, sessionPath), levelPlacementSession(assessmentId, {
        placementVersion: 2,
        status: 'paused',
        answers: [{
          questionId: 'level-question-a1',
          rankId: 'level-rank-a1',
          gateId: 'level-gate-a1',
          contentWordId: 'level-word-a1',
          wordKey: 'level-word-a1',
          selectedQuestionId: 'level-question-a1',
          correct: true
        }],
        currentQuestionIndex: 1,
        correctCount: 1,
        passedRankIds: ['level-rank-a1'],
        passedPrefixLength: 1,
        passedLevel: true,
        answersCompletedAt: timestamp,
        resultApplied: false
      }));
    });

    const resume = writeBatch(db);
    resume.update(doc(db, sessionPath), {
      status: 'awaiting-decision',
      resumedAt: serverTimestamp(),
      resultApplied: true,
      assessedAt: serverTimestamp(),
      nextCefrLevel: 'A2',
      resultStartRankId: 'level-rank-a2',
      resultStartGateId: 'level-gate-a2',
      resultUnlockedRankIds: ['level-rank-a1', 'level-rank-a2'],
      resultUnlockedGateIds: ['level-gate-a1', 'level-gate-a2'],
      resultClearedGateIds: ['level-gate-a1'],
      completedCurrentContent: false,
      updatedAt: serverTimestamp()
    });
    resume.update(doc(db, journeyPath), {
      activeRankId: 'level-rank-a2',
      activeGateId: 'level-gate-a2',
      unlockedRankIds: ['level-rank-a1', 'level-rank-a2'],
      unlockedGateIds: ['level-gate-a1', 'level-gate-a2'],
      passedCefrLevels: ['A1'],
      partialCefrLevels: [],
      levelPlacementAssessmentIds: { A1: assessmentId },
      levelPlacementPassedRankIds: ['level-rank-a1'],
      contentJourneyStatus: 'in-progress',
      levelPlacementStatus: 'awaiting-decision',
      updatedAt: serverTimestamp()
    });
    resume.update(doc(db, pointerPath), { updatedAt: serverTimestamp() });
    await assertSucceeds(resume.commit());
    await assertSucceeds(updateDoc(doc(db, sessionPath), {
      saveWordChoice: 'none',
      saveWordPendingIds: [],
      saveWordSavedIds: [],
      saveWordFailures: [],
      saveWordSummary: {
        created: 0,
        sourceLinked: 0,
        alreadyLinked: 0,
        restoredReady: 0,
        failed: 0
      },
      wordsSaveCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
  });

  await test('notification lifecycle is owner-bound, read-monotonic, terminal, and non-deletable', async () => {
    const notificationId = 'nt3_rules_contract';
    const path = `users/user-a/notifications/${notificationId}`;
    await assertSucceeds(setDoc(doc(userA, path), {
      id: notificationId,
      schemaVersion: 3,
      ownerId: 'user-a',
      kind: 'smart',
      notificationType: 'reminder.review.due',
      occurrenceKey: 'review:rules-cycle',
      priority: 78,
      status: 'active',
      visualType: 'warning',
      message: 'لديك كلمات مستحقة للمراجعة.',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      showCount: 1,
      readAt: null,
    }));
    await assertSucceeds(getDoc(doc(userA, path)));
    await assertFails(getDoc(doc(userB, path)));
    await assertSucceeds(updateDoc(doc(userA, path), {
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(userA, path), {
      readAt: null,
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(userA, path), {
      status: 'dismissed',
      dismissedAt: serverTimestamp(),
      resolutionReason: 'clear-all',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(userA, path), {
      status: 'active',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(doc(userA, path)));
  });

  if (testFilter) assert.ok(selected > 0, `No Rules test matched "${testFilter}"`);
  assert.equal(passed, testFilter ? selected : 81);
  console.log(`# ${passed} Firestore Rules emulator tests passed`);
} finally {
  await environment.cleanup();
}
