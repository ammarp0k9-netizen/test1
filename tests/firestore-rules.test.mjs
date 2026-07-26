import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
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
async function test(name, callback) {
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
      gateCount: 9,
      version: 4,
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

  await test('Level Placement v2 atomically reconciles cleared gates and the next journey target', async () => {
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

    const result = writeBatch(db);
    result.update(doc(db, sessionPath), {
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
    result.update(doc(db, journeyPath), {
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
    result.update(doc(db, firstGatePath), {
      status: 'cleared',
      clearedAt: serverTimestamp(),
      clearedBy: 'level-placement',
      levelPlacementAssessmentId: assessmentId,
      levelPlacementScore: 1,
      placementClearedWithoutLoad: true,
      lastActivityAt: serverTimestamp()
    });
    result.set(
      doc(db, nextGatePath),
      availableGateProgress('level-world', 'level-rank-a2', 'level-gate-a2')
    );
    result.update(doc(db, pointerPath), { updatedAt: serverTimestamp() });
    await assertSucceeds(result.commit());

    const [savedJourney, clearedGate, nextGate] = await Promise.all([
      getDoc(doc(db, journeyPath)),
      getDoc(doc(db, firstGatePath)),
      getDoc(doc(db, nextGatePath))
    ]);
    assert.equal(savedJourney.data().activeRankId, 'level-rank-a2');
    assert.equal(clearedGate.data().clearedBy, 'level-placement');
    assert.equal(nextGate.data().status, 'available');
  });

  await test('Level Placement sources are owner-only, selected, and reward-free', async () => {
    const sourceId = `${levelAssessmentId}~level-word-a1`;
    const sourcePath =
      `users/level-user/contentWords/level-word-a1/sources/level_placement_${sourceId}`;
    const canonicalPath = 'users/level-user/contentWords/level-word-a1';
    const batch = writeBatch(levelUser);
    batch.set(doc(levelUser, canonicalPath), {
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
    batch.set(doc(levelUser, sourcePath), {
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
    await assertFails(updateDoc(doc(levelUser, levelSessionPath), {
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

  assert.equal(passed, 59);
  console.log(`# ${passed} Firestore Rules emulator tests passed`);
} finally {
  await environment.cleanup();
}
