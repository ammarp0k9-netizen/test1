import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { calculateLevelPlacementReceipt, issueLevelPlacementReceipt } from '../tools/level-placement-authority.mjs';
import { buildPlacementCatalog } from '../tools/level-placement-catalog.mjs';

const placement = globalThis.LootLinguaLevelPlacement;
const schema = globalThis.LootLinguaContentSchema;
const emulator = /^127\.0\.0\.1:(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '');
const uid = 'placement-owner';
const worldId = 'world';

function fixture(pass, firstLevelRanks = 1) {
  const levelRanks = [...Array.from({ length: firstLevelRanks }, (_, order) => ({ cefrLevel: 'A1', order })),
    { cefrLevel: 'A2', order: 0 }];
  const rankBundles = levelRanks.map(({ cefrLevel, order }) => {
    const identifier = order ? cefrLevel + '-' + order : cefrLevel;
    const rankId = 'rank-' + identifier;
    const gateId = 'gate-' + identifier;
    const words = Array.from({ length: 4 }, (_, index) => {
      const base = ['apple', 'orange', 'banana', 'pear'][index];
      const word = order ? base + ' ' + order : base;
      return { contentWordId: 'word-' + index, word, wordKey: schema.normalizeWordIdentity({ word }).wordKey,
        translation: ['تفاحة', 'برتقالة', 'موزة', 'إجاصة'][index] + (order ? ' ' + order : ''),
        status: 'published', order: index };
    });
    return { rank: { rankId, cefrLevel, status: 'published', version: 1, order },
      gates: [{ gate: { gateId, status: 'published', order: 0 }, words }] };
  });
  const cefrLevel = 'A1';
  const assessmentSeed = placement.createAssessmentSeed(worldId, cefrLevel, 'authority-fixture');
  const assessmentId = placement.assessmentId(worldId, cefrLevel, assessmentSeed);
  const sample = placement.buildLevelSample({ cefrLevel, assessmentSeed, rankBundles });
  let session = placement.createSessionSeed({ assessmentId, worldId, sample });
  while (session.status === 'active') {
    const question = placement.buildQuestion(session);
    const answer = pass ? question.questionId : question.options.find(option => option.questionId !== question.questionId).questionId;
    session = placement.answerSession(session, answer);
    if (session.currentQuestionIndex === session.orderedQuestionIds.length) session = placement.finalizeRound(session);
  }
  const now = new Date();
  session = { ...session, startedAt: now, updatedAt: now, answersCompletedAt: now, resultApplied: false };
  const journey = { worldId, journeyVersion: 1, status: 'active', placementStatus: 'declined',
    activeRankId: 'rank-A1', activeGateId: 'gate-A1', unlockedRankIds: ['rank-A1'], unlockedGateIds: ['gate-A1'],
    activeLevelPlacementAssessmentId: assessmentId, activeLevelPlacementCefrLevel: cefrLevel,
    levelPlacementStatus: 'active', contentJourneyStatus: 'in-progress', startedAt: now, updatedAt: now };
  return { session, journey, rankBundles };
}

test('the authority derives failure from published questions and submitted choices even when all claimed grades say pass', () => {
  const original = fixture(false);
  const session = { ...original.session, correctCount: 4, passedLevel: true, passedRankIds: ['rank-A1'],
    answers: original.session.answers.map(answer => ({ ...answer, correct: true })) };
  const receipt = calculateLevelPlacementReceipt({ ...original, session });
  assert.equal(receipt.sessionResult.correctCount, 0);
  assert.equal(receipt.sessionResult.passedLevel, false);
  assert.deepEqual(receipt.journeyResult.unlockedGateIds, ['gate-A1']);
  assert.deepEqual(receipt.journeyResult.passedCefrLevels, []);
  assert.throws(() => calculateLevelPlacementReceipt({ ...original, session: { ...session, selectedContentWordIds: ['word-0'] } }),
    { code: 'level-placement/unverified-outcome' });
  assert.equal(calculateLevelPlacementReceipt(fixture(true)).journeyResult.activeGateId, 'gate-A2');
});

test('a verified Level Placement receipt is owner-bound, database-protected, and applies once', {
  skip: !emulator, timeout: 60_000
}, async () => {
  for (const pass of [false, true]) {
    const projectId = 'demo-placement-proof-' + randomUUID().slice(0, 8);
    const environment = await initializeTestEnvironment({ projectId, firestore: {
      host: '127.0.0.1', port: Number(emulator[1]),
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
    } });
    const admin = initializeApp({ projectId }, projectId);
    const store = getFirestore(admin);
    try {
      const { session, journey, rankBundles } = fixture(pass);
      const id = session.assessmentId;
      const journeyPath = `users/${uid}/contentProgress/${worldId}`;
      const sessionPath = `${journeyPath}/levelPlacementSessions/${id}`;
      const receiptPath = `${journeyPath}/levelPlacementOutcomeReceipts/${id}`;
      const root = `content_worlds/${worldId}`;
      const seed = store.batch();
      seed.set(store.doc(root), { status: 'published' });
      seed.set(store.doc(journeyPath), journey);
      seed.set(store.doc(sessionPath), session);
      for (const { rank, gates } of rankBundles) {
        const rankPath = `${root}/ranks/${rank.rankId}`;
        seed.set(store.doc(rankPath), rank);
        for (const { gate, words } of gates) {
          const gatePath = `${rankPath}/gates/${gate.gateId}`;
          seed.set(store.doc(gatePath), gate);
          for (const word of words) seed.set(store.doc(`${gatePath}/words/${word.contentWordId}`), word);
        }
      }
      await seed.commit();
      const owner = environment.authenticatedContext(uid).firestore();
      const secondTab = environment.authenticatedContext(uid).firestore();
      const outsider = environment.authenticatedContext('other-account').firestore();
      await assertFails(updateDoc(doc(owner, sessionPath), { passedLevel: !pass, updatedAt: serverTimestamp() }));
      await assertFails(setDoc(doc(owner, receiptPath), { approvedAt: serverTimestamp() }));
      const commit = (client, receipt, extra = {}) => {
        const batch = writeBatch(client);
        batch.update(doc(client, sessionPath), { ...receipt.sessionResult, ...extra,
          assessedAt: serverTimestamp(), completedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.update(doc(client, journeyPath), { ...receipt.journeyResult, updatedAt: serverTimestamp() });
        return batch.commit();
      };
      await assertFails(commit(owner, calculateLevelPlacementReceipt({ session, journey, rankBundles })));
      await issueLevelPlacementReceipt(store, uid, worldId, id);
      const receipt = (await assertSucceeds(getDoc(doc(owner, receiptPath)))).data();
      await assertFails(getDoc(doc(outsider, receiptPath)));
      await assertFails(commit(outsider, receipt));
      await assertFails(commit(owner, receipt, { passedLevel: !pass }));
      const attempts = await Promise.allSettled([commit(owner, receipt), commit(secondTab, receipt)]);
      assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'permission-denied');
      await assertFails(commit(owner, receipt));
      assert.deepEqual(await issueLevelPlacementReceipt(store, uid, worldId, id), { alreadyApplied: true });
      assert.equal((await getDoc(doc(owner, sessionPath))).data().passedLevel, pass);
      assert.equal((await getDoc(doc(owner, journeyPath))).data().activeGateId, pass ? 'gate-A2' : 'gate-A1');
      assert.equal((await getDoc(doc(owner, 'users/' + uid + '/meta/profile'))).exists(), false);
    } finally {
      await environment.cleanup();
      await deleteApp(admin);
    }
  }
});

test('Firestore alone scores saved choices, rejects fabricated results, and resumes an interrupted proof', {
  skip: !emulator, timeout: 60_000
}, async () => {
  const environment = await initializeTestEnvironment({
    projectId: 'demo-placement-free-' + randomUUID().slice(0, 8),
    firestore: { host: '127.0.0.1', port: Number(emulator[1]),
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
  const source = readFileSync(new URL('../js/journey-cloud.js', import.meta.url), 'utf8');
  const createVerifier = new Function('db', 'auth', 'doc', 'runTransaction', 'serverTimestamp',
    'journeyRef', 'levelPlacementSessionRef', 'commitVerifiedLevelPlacement', 'reconcilePreviouslyAppliedPlacementOutcome',
    source.slice(source.indexOf('function scorePlacementRank('), source.indexOf('async function applyPlacementOutcome('))
      + '\nreturn { scorePlacementRank, buildScoredPlacementOutcome, verifyPlacementWithRules };');
  try {
    for (const pass of [false, true]) {
      const account = pass ? 'passed-player' : 'failed-player';
      const { session, journey, rankBundles } = fixture(pass, pass ? 6 : 1);
      const catalog = buildPlacementCatalog(worldId, rankBundles);
      const id = session.assessmentId;
      const parent = `users/${account}/contentProgress/${worldId}`;
      const sessionPath = `${parent}/levelPlacementSessions/${id}`;
      const proofPath = `${parent}/levelPlacementProofs/${id}`;
      const receiptPath = `${parent}/levelPlacementOutcomeReceipts/${id}`;
      const catalogPath = `content_worlds/${worldId}/placementCatalog/current`;
      await environment.withSecurityRulesDisabled(async context => {
        const store = context.firestore();
        await Promise.all([
          setDoc(doc(store, `content_worlds/${worldId}`), { status: 'published' }),
          setDoc(doc(store, catalogPath), catalog),
          setDoc(doc(store, parent), journey),
          setDoc(doc(store, sessionPath), { ...session, status: 'paused', passedLevel: !pass }),
        ]);
      });
      const owner = environment.authenticatedContext(account).firestore();
      const secondTab = environment.authenticatedContext(account).firestore();
      const outsider = environment.authenticatedContext('outsider').firestore();
      const reference = doc(owner, proofPath);
      const savedSession = (await getDoc(doc(owner, sessionPath))).data();
      const savedJourney = (await getDoc(doc(owner, parent))).data();
      const start = { catalogId: catalog.id, answeredAt: savedSession.answersCompletedAt, rankCursor: 0,
        answerCount: 0, correctCount: 0, passedRankIds: [], clearedGateIds: [], wordKeys: [], statistics: {} };
      const commit = async (_user, _world, _id, receipt) => {
        const batch = writeBatch(secondTab);
        batch.update(doc(secondTab, sessionPath), { ...receipt.sessionResult,
          assessedAt: serverTimestamp(), completedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.update(doc(secondTab, parent), { ...receipt.journeyResult, updatedAt: serverTimestamp() });
        await batch.commit();
        return receipt.sessionResult;
      };
      const verifier = createVerifier(secondTab, { currentUser: { uid: account } }, doc, runTransaction, serverTimestamp,
        (uid, world) => doc(secondTab, 'users', uid, 'contentProgress', world),
        (uid, world, id) => doc(secondTab, 'users', uid, 'contentProgress', world, 'levelPlacementSessions', id),
        commit, (_user, _world, _id, result) => result);
      const step = verifier.scorePlacementRank(savedSession, catalog, start);
      const forged = verifier.buildScoredPlacementOutcome(savedSession, savedJourney, step, catalog);
      await assertFails(setDoc(doc(owner, catalogPath), { ...catalog, id: 'forged' }));
      await assertFails(setDoc(doc(outsider, proofPath), start));
      await assertFails(setDoc(doc(owner, receiptPath), { ...forged, approvedAt: serverTimestamp() }));
      await assertSucceeds(setDoc(reference, start));
      await assertFails(setDoc(reference, { ...step, correctCount: step.correctCount + 1 }));
      await assertFails(setDoc(reference, { ...step, step: { ...step.step, indices: [0, 0, 0, 0] } }));
      await assertSucceeds(setDoc(reference, step));
      await assertFails(setDoc(doc(owner, receiptPath), {
        ...forged, sessionResult: { ...forged.sessionResult, passedLevel: !pass }, approvedAt: serverTimestamp()
      }));
      const result = await assertSucceeds(verifier.verifyPlacementWithRules(
        { uid: account }, worldId, id, doc(secondTab, receiptPath), catalog));
      assert.equal(result.passedLevel, pass);
      assert.equal(result.correctCount, pass ? 24 : 0);
      assert.equal((await getDoc(doc(owner, parent))).data().activeGateId, pass ? 'gate-A2' : 'gate-A1');
      await assertFails(commit(null, worldId, id, forged));
      assert.equal((await getDoc(doc(owner, 'users/' + account + '/meta/profile'))).exists(), false);
    }
  } finally {
    await environment.cleanup();
  }
});
