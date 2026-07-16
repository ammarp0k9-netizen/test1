import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
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
  progress: 'users/user-a/contentProgress/published-world',
  membership: 'users/user-a/contentWords/sword'
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

  await test('missing published ancestors fail closed', async () => {
    await assertFails(getDoc(doc(userA, paths.orphanRank)));
    await assertFails(getDoc(doc(userA, paths.orphanGate)));
    await assertFails(getDoc(doc(userA, paths.orphanWord)));
  });

  await test('a normal user cannot write prepared content', async () => {
    await assertFails(setDoc(doc(userA, 'content_worlds/forged'), world('forged', 'published')));
    await assertFails(updateDoc(doc(userA, paths.publishedWorld), { title: 'forged' }));
  });

  await test('prepared content deletion is backend-only even for an admin client', async () => {
    await assertFails(deleteDoc(doc(admin, paths.publishedWorld)));
    await assertFails(deleteDoc(doc(admin, paths.publishedWord)));
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

  await test('rank writes require initial counters and monotonic versions', async () => {
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
      gateCount: 9,
      version: 3,
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

  await test('word writes require coupled ancestor counters and monotonic versions', async () => {
    const wordPath = 'content_worlds/published-world/ranks/published-rank/gates/published-gate/words/admin-word';
    const valid = {
      ...word('published-world', 'published-rank', 'published-gate', 'admin-word', 'draft'),
      word: 'Admin Word',
      normalizedWord: 'admin word',
      wordKey: 'admin_word',
      translation: 'كلمة إدارية',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: 'admin-a',
      updatedBy: 'admin-a'
    };

    await assertFails(setDoc(doc(admin, wordPath), valid));

    const createBatch = writeBatch(admin);
    createBatch.set(doc(admin, wordPath), valid);
    createBatch.update(doc(admin, paths.publishedGate), {
      wordCount: 1,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    });
    createBatch.update(doc(admin, paths.publishedRank), {
      wordCount: 1,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    });
    createBatch.update(doc(admin, paths.publishedWorld), {
      wordCount: 3,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    });
    await assertSucceeds(createBatch.commit());

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
    await assertFails(updateDoc(doc(admin, paths.lockedGateWord), {
      notes: 'Forged during a gate operation',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
  });

  await test('a backend world-operation lock fences browser edits throughout its hierarchy', async () => {
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
    await assertFails(updateDoc(doc(admin, paths.operationLockedWord), {
      notes: 'Word changed during world operation',
      version: 2,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-a'
    }));
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

  assert.equal(passed, 20);
  console.log(`# ${passed} Firestore Rules emulator tests passed`);
} finally {
  await environment.cleanup();
}
