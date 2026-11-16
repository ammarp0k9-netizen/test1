import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import * as auth from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore as adminStore } from 'firebase-admin/firestore';
import '../js/content-schema.js';

const projectId = 'demo-lootlingua';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const dbHost = process.env.FIRESTORE_EMULATOR_HOST;
const loopback = /^127\.0\.0\.1:\d+$/;
const skip = !(loopback.test(authHost || '') && loopback.test(dbHost || ''));
const { doc, setDoc, updateDoc, getDoc, serverTimestamp, writeBatch } = firestore;
const denied = (operation) => assert.rejects(operation, { code: 'permission-denied' });

function setup(t) {
  const name = randomUUID();
  const app = initializeApp({ projectId, apiKey: projectId }, name);
  const identity = auth.getAuth(app);
  auth.connectAuthEmulator(identity, 'http://' + authHost, { disableWarnings: true });
  const db = firestore.getFirestore(app);
  firestore.connectFirestoreEmulator(db, '127.0.0.1', Number(dbHost.split(':')[1]));
  const server = initializeAdmin({ projectId }, name);
  t.after(() => Promise.all([deleteApp(app), deleteAdmin(server)]));
  return { app, identity, db, server };
}

test('Spark rules accept staged placement and reject fabricated answer batches, unrelated gates, and receipt reuse', { skip }, async (t) => {
  const { identity, db, server } = setup(t);
  const { user } = await auth.signInAnonymously(identity);
  const worldId = 'placement-guards-' + randomUUID();
  const rankId = 'a1';
  const gateId = 'first';
  const content = `content_worlds/${worldId}/ranks/${rankId}`;
  const journey = `users/${user.uid}/contentProgress/${worldId}`;
  const rank = `${journey}/ranks/${rankId}/gates`;
  const v1 = doc(db, `${journey}/placementSessions/legacy`);
  const v2 = doc(db, `${journey}/levelPlacementSessions/level`);
  const seed = adminStore(server).batch();
  seed.set(adminStore(server).doc(content), { worldId, rankId, status: 'published', unlockConfig: { initialStatus: 'available' } });
  for (const id of ['first', 'next', 'unrelated']) {
    seed.set(adminStore(server).doc(`${content}/gates/${id}`), { worldId, rankId, gateId: id, status: 'published', entryAssessmentPassRatio: .5 });
    for (const wordKey of ['one', 'two']) {
      seed.set(adminStore(server).doc(`${content}/gates/${id}/words/${wordKey}`), { status: 'published', wordKey });
    }
  }
  await seed.commit();
  await setDoc(doc(db, journey), {
    worldId, journeyVersion: 1, activeRankId: rankId, activeGateId: gateId, unlockedRankIds: [rankId], unlockedGateIds: [gateId],
    status: 'active', placementStatus: 'not-started', contentJourneyStatus: 'in-progress', startedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  const gateSummary = (key) => ({
    worldId, rankId, gateId: key, status: 'cleared', journeyVersion: 1, readyEvidenceCount: 0,
    clearAttempts: 0, lastActivityAt: serverTimestamp(), clearedAt: serverTimestamp(),
  });
  const legacy = {
    assessmentId: 'legacy', worldId, rankId, currentGateId: gateId, startedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    status: 'active', currentQuestionIndex: 0, correctCount: 0, answers: [],
    orderedContentWordIds: ['two', 'one'], orderedWordKeys: ['two', 'one'], totalQuestions: 2, passThreshold: .5, requiredCorrect: 1,
  };
  await denied(setDoc(v1, { ...legacy, status: 'completed' }));
  await denied(setDoc(v1, { ...legacy, passThreshold: .1 }));
  await setDoc(v1, legacy);
  await updateDoc(doc(db, journey), { activePlacementAssessmentId: 'legacy', placementStatus: 'active' });
  const answer = (id, selected = id) => ({ contentWordId: id, selectedContentWordId: selected, correct: id === selected });
  await denied(updateDoc(v1, { currentQuestionIndex: 2, correctCount: 2, answers: [answer('two'), answer('one')], status: 'submitting' }));
  await denied(updateDoc(v1, { currentQuestionIndex: 1, correctCount: 1, answers: [{ ...answer('two', 'one'), correct: true }] }));
  await denied(updateDoc(doc(db, journey), { unlockedGateIds: [gateId, 'unrelated'] }));
  await updateDoc(v1, { currentQuestionIndex: 1, correctCount: 1, answers: [answer('two')] });
  await updateDoc(v1, { currentQuestionIndex: 2, correctCount: 1, answers: [answer('two'), answer('one', 'two')], status: 'submitting' });
  const cleared = (key) => ({ ...gateSummary(key), placementAssessmentId: 'legacy', clearedBy: 'placement' });
  await denied(setDoc(doc(db, `${rank}/unrelated`), cleared('unrelated')));
  await setDoc(doc(db, `${rank}/first`), cleared('first'));
  await updateDoc(v1, { status: 'completed', outcome: 'passed', completedAt: serverTimestamp() });
  await updateDoc(doc(db, journey), { activeGateId: 'next', unlockedGateIds: [gateId, 'next'], activePlacementAssessmentId: '' });

  const level = {
    assessmentId: 'level', worldId, cefrLevel: 'A1', status: 'active', currentQuestionIndex: 0, correctCount: 0,
    answers: [], orderedQuestionIds: ['test-q1', 'test-q2'], startedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  await denied(setDoc(v2, { ...level, status: 'awaiting-decision' }));
  await setDoc(v2, level);
  await updateDoc(doc(db, journey), { activeLevelPlacementAssessmentId: 'level' });
  const response = (qid) => {
    const wordKey = qid === 'test-q1' ? 'one' : 'two';
    return { questionId: qid, selectedQuestionId: qid, correct: true, rankId, gateId, contentWordId: wordKey, wordKey };
  };
  await denied(updateDoc(v2, { status: 'awaiting-decision' }));
  await denied(updateDoc(v2, { currentQuestionIndex: 1, correctCount: 1, answers: [{ ...response('test-q1'), contentWordId: 'forged' }] }));
  await updateDoc(v2, { currentQuestionIndex: 1, correctCount: 1, answers: [response('test-q1')] });
  await updateDoc(v2, { currentQuestionIndex: 2, correctCount: 2, answers: [response('test-q1'), response('test-q2')], status: 'awaiting-decision', passedRankIds: [rankId] });
  await denied(updateDoc(doc(db, journey), { unlockedGateIds: ['first', 'next', 'unrelated'] }));
  const applied = writeBatch(db);
  applied.update(doc(db, journey), { activeLevelPlacementAssessmentId: '', levelPlacementClearedGateIds: ['next'] });
  applied.update(v2, {
    status: 'completed', resultApplied: true, completedAt: serverTimestamp(), resultStartRankId: '', resultStartGateId: '',
    resultUnlockedRankIds: [], resultUnlockedGateIds: [], resultClearedGateIds: ['next'], completedCurrentContent: false,
  });
  await applied.commit();
  const byLevel = (key) => ({ ...gateSummary(key), levelPlacementAssessmentId: 'level', clearedBy: 'level-placement' });
  await denied(setDoc(doc(db, `${rank}/unrelated`), byLevel('unrelated')));
  await denied(updateDoc(v2, { resultClearedGateIds: ['unrelated'], completedAt: serverTimestamp() }));
  await setDoc(doc(db, `${rank}/next`), byLevel('next'));
  assert.equal((await getDoc(doc(db, `${rank}/next`))).data().clearedBy, 'level-placement');
});

test('Spark admin content operations preserve permissions, resume across batches, and clean up moved or deleted trees', { skip }, async (t) => {
  const { app, identity, db, server } = setup(t);
  const { user: guest } = await auth.signInAnonymously(identity);
  await adminAuth(server).setCustomUserClaims(guest.uid, { admin: true });
  await guest.getIdToken(true);
  const world = { worldId: 'spark-admin-fixture', slug: 'spark-admin-fixture', title: 'Fixture', status: 'draft' };
  const worldRef = doc(db, 'content_worlds', world.worldId);
  await denied(setDoc(worldRef, world));
  await auth.linkWithCredential(guest, auth.EmailAuthProvider.credential(`admin-${randomUUID()}@example.test`, 'OnlyEmulatorPass_731'));
  await guest.getIdToken(true);
  await setDoc(worldRef, world);
  // Exercise the real browser admin module with a local SDK and without a Functions dependency.
  const window = { LootLinguaContentSchema: globalThis.LootLinguaContentSchema, addEventListener() {}, dispatchEvent() {} };
  let failBatch = null;
  function instrumentedBatch(database) {
    const batch = writeBatch(database);
    const actions = [];
    return {
      delete(ref) { actions.push({ type: 'delete', ref }); batch.delete(ref); },
      set(ref, data) { actions.push({ type: 'set', ref }); batch.set(ref, data); },
      commit() {
        if (failBatch?.(actions)) return Promise.reject(Object.assign(new Error('Simulated connection loss'), { code: 'unavailable' }));
        return batch.commit();
      },
    };
  }
  const globals = { window, ...firestore, ...auth, writeBatch: instrumentedBatch, getApps: () => [app], queueMicrotask: () => {}, CustomEvent: class {} };
  const source = readFileSync(new URL('../js/admin-cloud.js', import.meta.url), 'utf8').replace(/^import\s+[^;]+;\s*/gm, '');
  new Function(...Object.keys(globals), source)(...Object.values(globals));
  const api = window.LootLinguaAdminCloud;
  const created = await api.createWorld({ slug: 'spark-' + randomUUID().slice(0, 8), title: 'Spark fixture', primaryInterest: 'games' });
  const rank = await api.createRank(created.worldId, { title: 'Spark rank', cefrLevel: 'A1' });
  const gate = await api.createGate(created.worldId, rank.rankId, { title: 'First' });
  const target = await api.createGate(created.worldId, rank.rankId, { title: 'Second' });
  const original = await api.createWord(created.worldId, rank.rankId, gate.gateId, { word: 'river', translation: 'نهر' });
  const copyWord = () => api.duplicateWord(created.worldId, rank.rankId, gate.gateId, original.contentWordId,
    { worldId: created.worldId, rankId: rank.rankId, gateId: target.gateId }, original.version, { operationId: 'word-copy' });
  const copied = await copyWord();
  assert.equal(copied.duplicated, true);
  assert.deepEqual(await copyWord(), copied);
  assert.equal(copied.word.status, 'draft');
  assert.equal(copied.word.translation, 'نهر');
  const gateCopy = await api.duplicateGateAsDraft(created.worldId, rank.rankId, gate.gateId, gate.version, { operationId: 'gate-copy' });
  assert.equal((await api.getGate(created.worldId, rank.rankId, gateCopy.gateId)).status, 'draft');
  const replay = await api.duplicateGateAsDraft(created.worldId, rank.rankId, gate.gateId, gate.version, { operationId: 'gate-copy' });
  assert.deepEqual(replay, gateCopy);
  const rankCopy = await api.duplicateRankAsDraft(created.worldId, rank.rankId, rank.version, { operationId: 'rank-copy' });
  const copiedRank = await api.getRank(created.worldId, rankCopy.rankId);
  assert.equal(copiedRank.status, 'draft');
  assert.ok(copiedRank.wordCount >= 3);
  const sameId = api.duplicateRankAsDraft(created.worldId, rank.rankId, rank.version, { operationId: 'gate-copy' });
  await assert.rejects(sameId, { code: 'admin/conflict' });

  const location = { worldId: created.worldId, rankId: rank.rankId, gateId: target.gateId };
  const from = [created.worldId, rank.rankId, gate.gateId];
  const move = (word, operationId) => api.moveWord(...from, word.contentWordId, location, word.version, { operationId, confirmationWord: word.word });
  await assert.rejects(move(original, 'collision'), { code: 'content/duplicate-word-in-gate' });
  assert.equal((await api.getWord(...from, original.contentWordId)).word, 'river');
  const first = await api.createWord(...from, { word: 'mountain', translation: 'جبل' });
  const second = await api.createWord(...from, { word: 'sky', translation: 'سماء' });
  const batchWord = await api.createWord(...from, { word: 'valley', translation: 'واد' });
  const moved = await move(first, 'word-move');
  assert.deepEqual(await move(first, 'word-move'), moved);
  await assert.rejects(api.getWord(...from, first.contentWordId), { code: 'admin/not-found' });
  const bulk = await api.bulkMoveWords(...from, [second, batchWord].map((word) => ({
    contentWordId: word.contentWordId, expectedVersion: word.version,
  })), location, { operationId: 'bulk-move' });
  assert.equal(bulk.itemCount, 2);
  const bulkItems = bulk.items.map(({ contentWordId, version }) => ({ contentWordId, expectedVersion: version }));
  const publish = () => api.bulkPublishWords(created.worldId, rank.rankId, target.gateId, bulkItems, { operationId: 'bulk-publish' });
  const published = await publish();
  assert.equal(published.action, 'publish');
  assert.deepEqual(await publish(), published);
  const publishedItems = published.items.map(({ contentWordId, version }) => ({ contentWordId, expectedVersion: version }));
  const result = await api.bulkArchiveWords(created.worldId, rank.rankId, target.gateId, publishedItems, { operationId: 'bulk-archive' });
  assert.equal(result.action, 'archive');
  assert.ok(result.items.every((word) => word.status === 'archived'));
  const remove = (word) => api.requestDeleteWord(...from, word.contentWordId, {
    operationId: 'word-delete', expectedVersion: word.version, confirmationWord: word.word,
  });
  await assert.rejects(remove(original), { code: 'content/archive-required' });
  const archived = await api.archiveWord(...from, original.contentWordId, original.version);
  const deleted = await remove(archived);
  assert.equal(deleted.deleted, true);
  assert.deepEqual(await remove(archived), deleted);
  const receipt = doc(db, 'admin_spark_content_operations', identity.currentUser.uid, 'receipts', 'word-delete');
  await denied(updateDoc(receipt, { result: { deleted: false } }));
  const sourceGate = (id) => doc(db, 'content_worlds', created.worldId, 'ranks', rank.rankId, 'gates', id);
  const countWords = (ref) => firestore.getCountFromServer(firestore.collection(ref, 'words')).then((result) => result.data().count);
  const big = await api.createGate(created.worldId, rank.rankId, { title: 'Large gate' });
  const otherWorld = await api.createWorld({ slug: 'spark-' + randomUUID().slice(0, 8), title: 'Destination', primaryInterest: 'games' });
  const otherRank = await api.createRank(otherWorld.worldId, { title: 'Destination rank', cefrLevel: 'A1' });
  const movingSource = sourceGate(big.gateId);
  const movingTarget = doc(db, 'content_worlds', otherWorld.worldId, 'ranks', otherRank.rankId, 'gates', big.gateId);
  const bigSize = 165;
  const serverDb = adminStore(server);
  const seed = serverDb.batch();
  const publishedWordIds = [];
  for (let index = 0; index < bigSize; index++) {
    const word = `chapter ${index}`;
    const contentWordId = `word-${index}`;
    if (index % 2 === 0) publishedWordIds.push(contentWordId);
    seed.set(serverDb.doc(`${movingSource.path}/words/${contentWordId}`), {
      worldId: created.worldId, rankId: rank.rankId, gateId: big.gateId, contentWordId,
      ...globalThis.LootLinguaContentSchema.normalizeWordIdentity(word), schemaVersion: 1,
      word, translation: 'كلمة', version: 2, status: index % 2 ? 'draft' : 'published',
      createdAt: new Date(), createdBy: identity.currentUser.uid,
    });
  }
  seed.update(serverDb.doc(movingSource.path), { status: 'published', wordCount: bigSize, publishedWordIds });
  seed.update(serverDb.doc(`content_worlds/${created.worldId}`), { wordCount: bigSize + 5 });
  seed.update(serverDb.doc(`content_worlds/${created.worldId}/ranks/${rank.rankId}`), { wordCount: bigSize + 5 });
  await seed.commit();

  const duplicateLarge = () => api.duplicateGateAsDraft(created.worldId, rank.rankId, big.gateId, big.version, { operationId: 'large-copy' });
  let completedCopyBatches = 0;
  failBatch = (actions) => actions.some(({ type, ref }) => type === 'set' && ref.path.includes('/copy_')) && ++completedCopyBatches === 2;
  await assert.rejects(duplicateLarge(), { code: 'admin/unavailable' });
  failBatch = null;
  assert.equal(await countWords(movingSource), bigSize);
  const duplicate = await duplicateLarge();
  assert.equal(duplicate.gate.title, 'Large gate (Copy)');
  assert.equal(await countWords(sourceGate(duplicate.gateId)), bigSize);
  const copy = (await getDoc(doc(firestore.collection(sourceGate(duplicate.gateId), 'words'), 'word-0'))).data();
  assert.equal(copy.status, 'draft');
  assert.equal(copy.version, 1);
  const largeRank = await api.duplicateRankAsDraft(created.worldId, rank.rankId, rank.version, { operationId: 'large-rank-copy' });
  assert.equal(largeRank.rank.title, 'Copy of Spark rank');
  const largeRankRef = doc(db, 'content_worlds', created.worldId, 'ranks', largeRank.rankId);
  const largeRankGates = await firestore.getDocsFromServer(firestore.collection(largeRankRef, 'gates'));
  assert.ok(largeRank.affectedCounts.wordCount >= 2 * bigSize);

  const moveGate = (confirmationTitle, operationId = 'large-move') => api.moveGate(created.worldId, rank.rankId, big.gateId,
    { worldId: otherWorld.worldId, rankId: otherRank.rankId }, big.version, { confirmationTitle, operationId });
  await assert.rejects(moveGate('Wrong title', 'wrong-move'), { code: 'content/exact-title-required' });
  assert.equal((await getDoc(movingTarget)).exists(), false);
  failBatch = (actions) => actions.some(({ type, ref }) => type === 'delete' && ref.path.startsWith(`${movingSource.path}/words/`));
  await assert.rejects(moveGate(big.title), { code: 'admin/unavailable' });
  failBatch = null;
  assert.equal((await getDoc(movingSource)).data().status, 'archived');
  assert.equal((await getDoc(movingTarget)).data().status, 'published');
  assert.equal(await countWords(movingSource), bigSize);
  assert.equal(await countWords(movingTarget), bigSize);
  const movedGate = await moveGate(big.title);
  assert.equal(movedGate.target.gateId, big.gateId);
  assert.deepEqual(await moveGate(big.title), movedGate);
  assert.equal((await getDoc(movingSource)).exists(), false);
  assert.equal(await countWords(movingSource), 0);
  const targetWord = (await getDoc(doc(firestore.collection(movingTarget, 'words'), 'word-0'))).data();
  assert.equal(targetWord.worldId, otherWorld.worldId);
  assert.equal(targetWord.status, 'published');
  assert.equal(targetWord.version, 2);
  assert.deepEqual((await getDoc(movingTarget)).data().publishedWordIds, publishedWordIds);
  assert.equal((await getDoc(doc(db, 'content_worlds', otherWorld.worldId))).data().wordCount, bigSize);

  const removeGate = (version, operationId, confirmationTitle = big.title) => api.requestDeleteGate(otherWorld.worldId, otherRank.rankId, big.gateId,
    { confirmationTitle, expectedVersion: version, operationId });
  await assert.rejects(removeGate(big.version + 1, 'not-archived'), { code: 'content/archive-required' });
  const archivedGate = await api.setGateStatus(otherWorld.worldId, otherRank.rankId, big.gateId, 'archived', big.version + 1);
  await assert.rejects(removeGate(archivedGate.version, 'wrong-delete', 'Wrong title'), { code: 'content/exact-title-required' });
  const removed = await removeGate(archivedGate.version, 'remove-big-gate');
  assert.deepEqual(await removeGate(archivedGate.version, 'remove-big-gate'), removed);
  assert.equal(removed.affectedCounts.wordCount, bigSize);
  assert.equal(await countWords(movingTarget), 0);
  assert.equal((await getDoc(movingTarget)).exists(), false);
  assert.equal((await getDoc(doc(db, 'content_worlds', otherWorld.worldId))).data().wordCount, 0);

  const archivedRank = await api.setRankStatus(created.worldId, largeRank.rankId, 'archived', largeRank.rank.version);
  const removeRank = () => api.requestDeleteRank(created.worldId, largeRank.rankId, { confirmationTitle: archivedRank.title,
    expectedVersion: archivedRank.version, operationId: 'remove-big-rank' });
  const deletedRank = await removeRank();
  assert.deepEqual(await removeRank(), deletedRank);
  assert.equal(deletedRank.affectedCounts.wordCount, largeRank.affectedCounts.wordCount);
  assert.equal((await getDoc(largeRankRef)).exists(), false);
  assert.equal((await firestore.getDocsFromServer(firestore.collection(largeRankRef, 'gates'))).size, 0);
  assert.deepEqual(await Promise.all(largeRankGates.docs.map((row) => countWords(row.ref))), largeRankGates.docs.map(() => 0));

  const job = doc(db, 'admin_spark_content_operations', identity.currentUser.uid, 'treeJobs', 'forged');
  await auth.createUserWithEmailAndPassword(identity, `non-admin-${randomUUID()}@example.test`, 'OnlyEmulatorPass_731');
  await denied(setDoc(job, { fingerprint: 'fake', gateCount: 1, wordCount: 1 }));
  await denied(firestore.deleteDoc(sourceGate(duplicate.gateId)));
  await assert.rejects(api.requestDeleteGate(created.worldId, rank.rankId, duplicate.gateId, {
    confirmationTitle: duplicate.gate.title, expectedVersion: duplicate.gate.version,
  }), { code: 'admin/permission-denied' });
});
