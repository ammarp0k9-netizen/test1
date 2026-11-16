import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as adminStore } from 'firebase-admin/firestore';
import * as authSdk from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import { createGuestJourneyAuth } from '../js/guest-journey-auth.js';

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const dbHost = process.env.FIRESTORE_EMULATOR_HOST;
const loopback = /^127\.0\.0\.1:\d+$/;
const enabled = loopback.test(authHost || '') && loopback.test(dbHost || '');
const projectId = 'demo-lootlingua';

function runtime(app, content, clock) {
  const window = {
    LootLinguaPublishedContent: content,
    addEventListener() {}, dispatchEvent() {},
  };
  const globals = {
    window, document: { readyState: 'loading' }, console, Map, Set, Object, Array, Promise,
    Date: class extends Date { static now() { return clock.time; } },
    crypto: globalThis.crypto, localStorage: { getItem: () => null, setItem() {} },
    ...firestore, ...authSdk, getApps: () => [app], setTimeout,
    CustomEvent: class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } },
  };
  for (const name of ['content-schema', 'journey', 'learning-evidence', 'word-lifecycle', 'gate-clear', 'placement', 'level-placement', 'journey-cloud']) {
    const source = readFileSync(new URL('../js/' + name + '.js', import.meta.url), 'utf8');
    // Keep Firestore payloads in the SDK's realm so it recognizes plain objects.
    const load = new Function(...Object.keys(globals), source.replace(/^import\s+[^;]+;\s*/gm, ''));
    load(...Object.values(globals));
  }
  const cloud = readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
  const start = cloud.indexOf('const USER_WORD_EDUCATIONAL_FIELDS');
  const end = cloud.indexOf('async function getUserWordSourceSummary', start);
  assert.ok(start >= 0 && end > start);
  const loadWordWriter = new Function(...Object.keys(globals), 'auth', 'db',
    cloud.slice(start, end) + '\nreturn { upsertUserWordWithSource, migrateGuestWordsToCloud };');
  window.LootLinguaWordLifecycleCloud = loadWordWriter(...Object.values(globals), authSdk.getAuth(app), firestore.getFirestore(app));
  return window;
}

test('an anonymous UID loads, reviews, clears and resumes a gate, then links without copying progress', {
  skip: !enabled, timeout: 90_000,
}, async () => {
  const apps = [];
  const admin = initializeAdmin({ projectId }, 'fresh-guest-journey-fixture');
  const fixtureDb = adminStore(admin);
  function connect(name, token) {
    const app = initializeApp({ projectId, apiKey: projectId }, name);
    apps.push(app);
    const auth = authSdk.getAuth(app);
    authSdk.connectAuthEmulator(auth, 'http://' + authHost, { disableWarnings: true });
    const db = firestore.getFirestore(app);
    const port = Number(dbHost.split(':')[1]);
    firestore.connectFirestoreEmulator(db, '127.0.0.1', port, token ? { mockUserToken: token } : {});
    return { app, auth, db };
  }
  const seed = connect('guest-journey-fixture', { sub: 'fixture-admin', user_id: 'fixture-admin', admin: true });
  const guest = connect('guest-journey-owner');
  const registered = connect('guest-journey-existing');
  const clock = { time: Date.now() };
  const worldId = 'guest-journey-fixture';
  const rankId = 'level-a1';
  const gateId = 'first';
  const nextGateId = 'next';
  const world = { worldId, slug: worldId, title: 'Fixture', status: 'published', version: 1, schemaVersion: 1, order: 0 };
  const rank = { worldId, rankId, title: 'Level 1', status: 'published', version: 1, cefrLevel: 'A1', order: 0, unlockConfig: { initialStatus: 'available' } };
  const gate = { worldId, rankId, gateId, title: 'First', status: 'published', version: 1, order: 0, wordCount: 5, unlockConfig: { initialStatus: 'available' } };
  const next = { ...gate, gateId: nextGateId, title: 'Next', order: 1, unlockConfig: { initialStatus: 'locked' } };
  const words = [];
  const fixture = {
    getPublishedWorld: async () => world, listPublishedRanks: async () => [rank],
    getPublishedRank: async () => rank, listPublishedGates: async () => [gate, next],
    getPublishedGate: async (_world, _rank, id) => id === nextGateId ? next : gate,
    listAllPublishedGateWords: async (_world, _rank, id) => id === gateId ? words : [],
  };
  const path = `content_worlds/${worldId}/ranks/${rankId}`;
  try {
    const context = runtime(guest.app, fixture, clock);
    const sdk = createGuestJourneyAuth(guest.auth, authSdk);
    const user = await sdk.start();
    assert.equal(user.isAnonymous, true);
    assert.equal((await sdk.start()).uid, user.uid);
    const ownerPath = `users/${user.uid}`;
    const journeyPath = `${ownerPath}/contentProgress/${worldId}`;
    const progressPath = `${journeyPath}/ranks/${rankId}/gates/${gateId}`;
    const schema = context.LootLinguaContentSchema;
    const legacy = [{ word: 'legacy word', translation: 'كلمة سابقة', mastered_once: true, earnedTransitions: ['Mastered'] }];
    const importLegacy = () => context.LootLinguaWordLifecycleCloud.migrateGuestWordsToCloud(legacy, {
      importId: 'legacy-device', operationId: 'legacy-device-transfer',
    });
    const [created] = await importLegacy();
    const [retried] = await importLegacy();
    assert.equal(created.created, true);
    assert.equal(retried.created, false);
    assert.equal(retried.wordId, created.wordId);
    const transferred = (await firestore.getDoc(firestore.doc(guest.db, ownerPath, 'words', created.wordId))).data();
    assert.equal(transferred.mastered_once, true);
    assert.deepEqual(transferred.earnedTransitions, ['Mastered']);
    const legacySources = await firestore.getDocs(firestore.collection(guest.db, ownerPath, 'contentWords', created.wordKey, 'sources'));
    assert.equal(legacySources.size, 1);
    for (const [index, title] of ['word one', 'word two', 'word three', 'word four', 'word five'].entries()) {
      words.push({ ...schema.normalizeWordIdentity(title), word: title, worldId, rankId, gateId,
        contentWordId: 'word-' + index, translation: 'معنى ' + index, status: 'published', version: 1 });
    }
    const batch = firestore.writeBatch(seed.db);
    batch.set(firestore.doc(seed.db, `content_worlds/${worldId}`), world);
    batch.set(firestore.doc(seed.db, path), rank);
    batch.set(firestore.doc(seed.db, `${path}/gates/${gateId}`), gate);
    batch.set(firestore.doc(seed.db, `${path}/gates/${nextGateId}`), next);
    for (const word of words) batch.set(firestore.doc(seed.db, `${path}/gates/${gateId}/words/${word.contentWordId}`), word);
    await batch.commit();

    const journey = context.LootLinguaJourneyCloud;
    assert.equal((await journey.beginJourneyFromStart(worldId)).activeGateId, gateId);
    const added = await journey.loadGateWords(worldId, rankId, gateId);
    assert.equal(added.completed, words.length);
    assert.equal(added.partial, false);
    assert.equal((await journey.getGateProgress(worldId, rankId, gateId, { force: true })).status, 'learning');
    const quiz = await journey.getGateQuizWords(worldId, rankId, gateId);
    assert.equal(quiz.length, words.length);

    const submit = name => journey.recordQuizEvidenceBatch({
      sessionId: name, mode: 'matching', source: `journey:${worldId}~${rankId}~${gateId}`, completed: true,
      officialReviewGate: { worldId, rankId, gateId }, officialReviewDueWordKeys: quiz.map(word => word.wordKey),
      entries: quiz.map(word => ({ word, result: { correct: true, answeredAt: clock.time, submittedAnswer: word.legacyWordId } })),
    });
    // The server enforces real time. Age only completed fixture evidence between
    // real submissions so the test exercises the two-hour and next-day rules.
    const evidence = context.LootLinguaLearningEvidence;
    const offset = new Date().getTimezoneOffset();
    const ageReviews = async (reviewDates) => {
      const batch = fixtureDb.batch();
      for (const word of quiz) {
        const ref = fixtureDb.doc(ownerPath + '/contentWords/' + word.wordKey);
        let lastDay, lastDate;
        for (const [id, date] of reviewDates) {
          const event = evidence.evidenceEventId(user.uid, id, word.wordKey);
          lastDate = date;
          lastDay = evidence.localDayKey(date.getTime(), offset);
          batch.update(ref.collection('evidence').doc(event), { occurredAt: date, localDayKey: lastDay });
        }
        batch.update(ref, { lastEligibleEvidenceAt: lastDate, lastEvidenceLocalDayKey: lastDay });
      }
      await batch.commit();
    };
    const firstDate = new Date(Date.now() - 30 * 3_600_000);
    const secondDate = new Date(Date.now() - 27 * 3_600_000);
    for (const [name, age] of [['review-one', [['review-one', firstDate]]],
      ['review-two', [['review-two', secondDate]]], ['review-three', []]]) {
      clock.time = Date.now();
      const review = await submit(name);
      assert.equal(review.recorded, words.length);
      assert.equal(review.readinessError, null);
      if (age.length) await ageReviews(age);
    }
    const duplicate = await submit('review-three');
    assert.equal(duplicate.recorded, 0);
    assert.equal(duplicate.duplicate, words.length);
    const beforeClear = await journey.getGateProgress(worldId, rankId, gateId, { force: true });
    assert.equal(beforeClear.status, 'ready');
    assert.equal(beforeClear.readyWordCount, words.length);

    let attempt = await journey.startGateClearAttempt(worldId, rankId, gateId);
    assert.equal((await journey.resumeGateClearAttempt(worldId, rankId, gateId)).attempt.attemptId, attempt.attempt.attemptId);
    while (attempt.question) {
      attempt = await journey.answerGateClearQuestion(worldId, rankId, gateId, attempt.attempt.attemptId, attempt.question.correctContentWordId);
    }
    assert.equal(attempt.result.result.passed, true);
    assert.equal((await journey.getActiveJourney({ force: true })).activeGateId, nextGateId);

    const email = `existing-${user.uid}@example.test`;
    const password = 'EmulatorOnlyPass_72';
    await authSdk.createUserWithEmailAndPassword(registered.auth, email, password);
    const publishSuggestion = ({ auth, db }) => firestore.setDoc(firestore.doc(db, 'suggestions', auth.currentUser.uid), {
      word: 'legacy word', ar: 'معنى', game: '', userId: auth.currentUser.uid,
      userEmail: auth.currentUser.email || '', timestamp: firestore.serverTimestamp(),
    });
    const writeSharedSearchCache = ({ auth, db }) => firestore.setDoc(firestore.doc(db, 'ai_global_cache', auth.currentUser.uid), {
      word: 'legacy word', caches: { normal: { type: 'normal', meanings: ['معنى'], createdAt: firestore.serverTimestamp() } },
    });
    await assert.rejects(firestore.getDoc(firestore.doc(registered.db, progressPath)), { code: 'permission-denied' });
    await assert.rejects(publishSuggestion(guest), { code: 'permission-denied' });
    await assert.rejects(writeSharedSearchCache(guest), { code: 'permission-denied' });
    await publishSuggestion(registered);
    await assert.rejects(sdk.register(email, password), { code: 'guest-account/conflict' });
    await assert.rejects(sdk.login(email, password), { code: 'guest-account/conflict' });
    assert.equal(guest.auth.currentUser.uid, user.uid);
    assert.equal(guest.auth.currentUser.isAnonymous, true);
    const linked = await sdk.register(`new-${user.uid}@example.test`, password);
    assert.equal(linked.user.uid, user.uid);
    assert.equal(linked.user.isAnonymous, false);
    await writeSharedSearchCache(guest);
    const progressAfterLink = (await firestore.getDoc(firestore.doc(guest.db, progressPath))).data();
    assert.equal(progressAfterLink.status, 'cleared');
    assert.equal(progressAfterLink.clearAttempts, 1);
    const reviews = await firestore.getDocs(firestore.collection(guest.db, ownerPath, 'quizEvidenceSessions'));
    assert.equal(reviews.size, 3);
  } finally {
    await Promise.all([...apps.map(deleteApp), deleteAdmin(admin)]);
  }
});
