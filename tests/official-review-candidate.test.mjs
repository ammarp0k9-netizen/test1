import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import * as authSdk from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import * as functionsSdk from 'firebase/functions';
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
    ...firestore, ...authSdk, ...functionsSdk, getApps: () => [app], setTimeout,
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
  const quizWritesStart = cloud.indexOf('function sanitizeMasteryCloudState');
  const quizWritesEnd = cloud.indexOf('window.claimXPEventInCloud', quizWritesStart);
  assert.ok(quizWritesStart >= 0 && quizWritesEnd > quizWritesStart);
  const loadQuizWrites = new Function(...Object.keys(globals), 'auth', 'db', cloud.slice(quizWritesStart, quizWritesEnd));
  loadQuizWrites(...Object.values(globals), authSdk.getAuth(app), firestore.getFirestore(app));
  return window;
}

for (const identity of ['guest', 'registered']) test('verified Gate journey rejects forged progress for ' + identity, {
  skip: !enabled || process.env.LOOTLINGUA_RULES_CANDIDATE !== '1', timeout: 90_000,
}, async () => {
  const apps = [];
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
  const seed = connect('guest-journey-fixture', 'owner');
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
    const user = identity === 'guest' ? await sdk.start() : (await authSdk.createUserWithEmailAndPassword(
      guest.auth, 'gate-account-' + crypto.randomUUID() + '@example.test', 'EmulatorOnlyPass_72'
    )).user;
    assert.equal(user.isAnonymous, identity === 'guest');
    assert.equal((await sdk.start()).uid, user.uid);
    const ownerPath = `users/${user.uid}`;
    const journeyPath = `${ownerPath}/contentProgress/${worldId}`;
    const progressPath = `${journeyPath}/ranks/${rankId}/gates/${gateId}`;
    const schema = context.LootLinguaContentSchema;
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

    const evidence = context.LootLinguaLearningEvidence;
    const db = guest.db;
    const { doc, getDoc, getDocs, collection, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } = firestore;
    const wordKeys = quiz.map(word => word.wordKey);
    const sessionPath = id => `${ownerPath}/quizEvidenceSessions/${id}`;
    const canonicalPath = wordKey => `${ownerPath}/contentWords/${wordKey}`;
    const eventPath = (id, wordKey) => `${canonicalPath(wordKey)}/evidence/${evidence.evidenceEventId(user.uid, id, wordKey)}`;
    const reviewFields = {
      officialReviewWorldId: worldId, officialReviewRankId: rankId, officialReviewGateId: gateId,
      officialReviewDueWordKeys: wordKeys,
    };
    const session = (id, overrides = {}) => ({
      sessionId: id, status: 'completed', mode: 'matching', sourceType: 'personal', privateWorldId: '',
      wordKeys, correctWordKeys: wordKeys, totalCount: wordKeys.length, correctCount: wordKeys.length,
      evidenceVersion: 2, completedAt: serverTimestamp(), ...overrides,
    });
    const denied = operation => assert.rejects(operation, { code: 'permission-denied' });
    const firstKey = wordKeys[0];
    const saveForgedEventPair = (id, sequence, day, { withSummary = true, mode = 'matching', offset = 0 } = {}) => {
      const eventId = evidence.evidenceEventId(user.uid, id, firstKey);
      const batch = writeBatch(db);
      batch.set(doc(db, eventPath(id, firstKey)), {
        eventId, sessionId: id, wordKey: firstKey, sourceType: 'personal', privateWorldId: '',
        membershipWordId: '', mode, correct: true, completed: true, sequence, evidenceVersion: 2,
        timezoneOffsetMinutes: offset, localDayKey: day, occurredAt: serverTimestamp(),
      });
      if (withSummary) batch.update(doc(db, canonicalPath(firstKey)), {
        eligibleEvidenceCount: sequence, lastEligibleEvidenceAt: serverTimestamp(),
        lastEvidenceEventId: eventId, evidenceVersion: 2, evidenceTimezoneOffsetMinutes: offset,
        lastEvidenceLocalDayKey: day, updatedAt: serverTimestamp(),
      });
      return batch.commit();
    };
    const submit = (name, overrides = {}) => {
      clock.time = Date.now();
      return journey.recordQuizEvidenceBatch({
        sessionId: name, mode: 'matching', source: `journey:${worldId}~${rankId}~${gateId}`, completed: true,
        officialReviewGate: { worldId, rankId, gateId }, officialReviewDueWordKeys: wordKeys,
        timezoneOffsetMinutes: 0,
        entries: quiz.map(word => ({ word, result: { correct: true, answeredAt: clock.time } })),
        ...overrides,
      });
    };

    const email = `candidate-existing-${user.uid}@example.test`;
    const password = 'EmulatorOnlyPass_72';
    const { user: existing } = await authSdk.createUserWithEmailAndPassword(registered.auth, email, password);
    await authSdk.signOut(registered.auth);
    assert.equal((await authSdk.signInWithEmailAndPassword(registered.auth, email, password)).user.uid, existing.uid);
    await denied(getDoc(doc(registered.db, progressPath)));
    await denied(setDoc(doc(registered.db, sessionPath('intruder')), session('intruder', reviewFields)));
    await denied(updateDoc(doc(registered.db, progressPath), { status: 'ready' }));
    await denied(setDoc(doc(registered.db, eventPath('intruder', firstKey)), { sequence: 1 }));
    await denied(setDoc(doc(db, sessionPath('flashcards')), session('flashcards', { ...reviewFields, mode: 'flashcards' })));
    await denied(setDoc(doc(db, sessionPath('other-gate')), session('other-gate', { ...reviewFields, officialReviewGateId: nextGateId })));
    await denied(setDoc(doc(db, sessionPath('outside-cohort')), session('outside-cohort', {
      ...reviewFields, wordKeys: ['unloaded-word'], correctWordKeys: ['unloaded-word'],
      officialReviewDueWordKeys: ['unloaded-word'], totalCount: 1, correctCount: 1,
    })));
    await denied(setDoc(doc(db, sessionPath('incomplete')), session('incomplete', { officialReviewWorldId: worldId })));
    await setDoc(doc(db, sessionPath('legacy-empty-metadata')), session('legacy-empty-metadata', {
      officialReviewWorldId: '', officialReviewRankId: '', officialReviewGateId: '', officialReviewDueWordKeys: [],
    }));
    await denied(setDoc(doc(db, `${journeyPath}/ranks/${rankId}/gates/${nextGateId}`), {
      worldId, rankId, gateId: nextGateId, status: 'available', journeyVersion: 1,
      unlockedByGateId: gateId, unlockedAt: serverTimestamp(), lastActivityAt: serverTimestamp(),
      readyEvidenceCount: 0, clearAttempts: 0,
    }));
    await denied(updateDoc(doc(db, progressPath), {
      runnerReviewCompletedSessionId: 'nonexistent', runnerReviewCompletedDueWordKeys: wordKeys,
      lastActivityAt: serverTimestamp(),
    }));
    const today = () => evidence.localDayKey(Date.now(), 0);
    await denied(saveForgedEventPair('no-session', 1, today()));
    await denied(updateDoc(doc(db, canonicalPath(firstKey)), {
      eligibleEvidenceCount: 1, lastEvidenceEventId: 'no-event',
      lastEligibleEvidenceAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await setDoc(doc(db, sessionPath('wrong-answer')), session('wrong-answer', { correctWordKeys: [], correctCount: 0 }));
    await denied(saveForgedEventPair('wrong-answer', 1, today()));
    await assert.rejects(submit('wrong-answer', { officialReviewGate: null, officialReviewDueWordKeys: [] }), {
      code: 'evidence/session-conflict',
    });
    await denied(updateDoc(doc(db, progressPath), {
      runnerReviewCompletedSessionId: 'wrong-answer', runnerReviewCompletedDueWordKeys: wordKeys,
      lastActivityAt: serverTimestamp(),
    }));
    await setDoc(doc(db, sessionPath('orphan')), session('orphan'));
    await denied(saveForgedEventPair('orphan', 1, today(), { withSummary: false }));
    await denied(saveForgedEventPair('orphan', 1, today() + 1));

    async function checkReview(id, step, status) {
      const outcome = await submit(id);
      assert.equal(outcome.recorded, words.length, id);
      assert.equal(outcome.readinessError, null, id);
      const progress = await journey.getGateProgress(worldId, rankId, gateId, { force: true });
      assert.equal(progress.status, status, id);
      assert.equal(progress.evidenceStepCount, words.length * step, id);
      assert.equal(progress.runnerReviewCompletedSessionId, id, id);
      assert.deepEqual(new Set(progress.runnerReviewCompletedDueWordKeys), new Set(wordKeys));
      assert.equal((await getDoc(doc(db, eventPath(id, firstKey)))).data().sequence, step);
      assert.equal((await getDoc(doc(db, canonicalPath(firstKey)))).data().eligibleEvidenceCount, step);
      return progress;
    }

    // Move only local fixture history. All application writes and request.time
    // checks still use real clocks and unprivileged Auth emulator users.
    async function ageHistory(ids, hours) {
      const batch = writeBatch(seed.db);
      const delta = hours * 3_600_000;
      const shift = stamp => Timestamp.fromMillis(stamp.toMillis() - delta);
      const gateRef = doc(seed.db, progressPath);
      const progress = (await getDoc(gateRef)).data();
      batch.update(gateRef, { loadedAt: shift(progress.loadedAt), readinessNextAt: shift(progress.readinessNextAt) });
      for (const id of ids) {
        const reviewRef = doc(seed.db, sessionPath(id));
        batch.update(reviewRef, { completedAt: shift((await getDoc(reviewRef)).data().completedAt) });
        for (const key of wordKeys) {
          const ref = doc(seed.db, eventPath(id, key));
          const occurredAt = shift((await getDoc(ref)).data().occurredAt);
          batch.update(ref, { occurredAt, localDayKey: evidence.localDayKey(occurredAt.toMillis(), 0) });
        }
      }
      for (const key of wordKeys) {
        const ref = doc(seed.db, canonicalPath(key));
        const lastEligibleEvidenceAt = shift((await getDoc(ref)).data().lastEligibleEvidenceAt);
        batch.update(ref, {
          lastEligibleEvidenceAt, lastEvidenceLocalDayKey: evidence.localDayKey(lastEligibleEvidenceAt.toMillis(), 0),
        });
      }
      await batch.commit();
    }

    const first = await checkReview('review-one', 1, 'learning');
    assert.equal(first.waitingLaterTodayCount, words.length);
    const forged = {
      status: 'ready', readyEvidenceCount: words.length, readyWordCount: words.length,
      evidenceStepCount: words.length * 3, needsEvidenceWordCount: 0,
      availableForReviewNowCount: 0, waitingLaterTodayCount: 0, waitingNextDayCount: 0,
      readinessNextAt: null, runnerReviewDueWordKeys: [], readyAt: serverTimestamp(), lastActivityAt: serverTimestamp(),
    };
    await denied(updateDoc(doc(db, progressPath), forged));
    await denied(updateDoc(doc(db, progressPath), { readinessVerifiedAt: serverTimestamp() }));
    await denied(setDoc(doc(db, journeyPath, 'gateClearAttempts', 'forged-attempt'), {
      serverVerified: true, status: 'active', questionOrder: [words[0].contentWordId], passRatio: 0.01,
    }));
    // Simulate legacy data that predates the server seal.
    await updateDoc(doc(seed.db, progressPath), forged);
    await assert.rejects(journey.startGateClearAttempt(worldId, rankId, gateId), { code: 'gate-clear/not-ready' });
    assert.equal((await journey.getGateProgress(worldId, rankId, gateId, { force: true })).status, 'learning');
    const xp = [{ eventId: `word_transition:${firstKey}:new_learning`, amount: 2, reason: 'word_transition_new_learning' }];
    const award = await context.claimXPEventsInCloud(xp);
    const awardRetry = await context.claimXPEventsInCloud(xp);
    assert.equal(award.results[0].awarded, true);
    assert.equal(awardRetry.results[0].duplicate, true);
    assert.equal(award.userXP, 2);
    assert.equal(awardRetry.userXP, 2);
    const profileRef = doc(db, ownerPath, 'meta', 'profile');
    await denied(updateDoc(profileRef, { _syncRevision: 3 }));
    const learning = { mastery_status: 'Learning', mastery_streak: 1, last_quizzed_at: new Date() };
    assert.equal((await context.commitQuizLearningBatchToCloud({
      ownerId: user.uid, personalWords: [{ id: quiz[0].id, data: learning }], masteryEntries: { [firstKey]: learning },
    })).saved, true);
    await setDoc(doc(db, sessionPath('too-early')), session('too-early'));
    await denied(saveForgedEventPair('too-early', 2, today()));
    await denied(updateDoc(doc(db, sessionPath('review-one')), { correctCount: 0 }));
    await denied(updateDoc(doc(db, eventPath('review-one', firstKey)), { sequence: 2 }));
    await ageHistory(['review-one'], 3);
    const second = await checkReview('review-two', 2, 'learning');
    assert.equal(second.waitingNextDayCount, words.length);
    await denied(updateDoc(doc(db, progressPath), {
      runnerReviewCompletedSessionId: 'review-one', runnerReviewCompletedDueWordKeys: wordKeys,
      lastActivityAt: serverTimestamp(),
    }));
    const canonicalRef = doc(seed.db, canonicalPath(firstKey));
    const original = (await getDoc(canonicalRef)).data();
    const currentTime = Date.now();
    // Choose an offset that puts local time around noon regardless of test time.
    const offset = Math.floor(currentTime / 60000) % 1440 - 720;
    const localDay = evidence.localDayKey(currentTime, offset);
    await updateDoc(canonicalRef, {
      lastEligibleEvidenceAt: Timestamp.fromMillis(currentTime - 35 * 60_000),
      lastEvidenceLocalDayKey: localDay - 1,
      evidenceTimezoneOffsetMinutes: offset,
    });
    await setDoc(doc(db, sessionPath('forged-local-day')), session('forged-local-day'));
    await denied(saveForgedEventPair('forged-local-day', 3, localDay, { offset }));
    await setDoc(canonicalRef, original);
    await ageHistory(['review-one', 'review-two'], 27);
    const ready = await checkReview('review-three', 3, 'ready');
    assert.equal(ready.readyWordCount, words.length);
    const duplicate = await submit('review-three');
    assert.equal(duplicate.recorded, 0);
    assert.equal(duplicate.duplicate, words.length);
    const staleRetry = await submit('review-one');
    assert.equal(staleRetry.duplicate, words.length);
    assert.equal((await journey.getGateProgress(worldId, rankId, gateId, { force: true })).runnerReviewCompletedSessionId, 'review-three');
    assert.equal((await getDocs(collection(db, `${canonicalPath(firstKey)}/evidence`))).size, 3);

    let attempt = await journey.startGateClearAttempt(worldId, rankId, gateId);
    assert.equal(attempt.attempt.serverVerified, true);
    assert.equal(attempt.attempt.totalCount, words.length);
    const attemptRef = doc(db, journeyPath, 'gateClearAttempts', attempt.attempt.attemptId);
    await denied(updateDoc(attemptRef, { passRatio: 0.01, requiredCorrect: 1 }));
    assert.equal((await journey.resumeGateClearAttempt(worldId, rankId, gateId)).attempt.attemptId, attempt.attempt.attemptId);
    while (attempt.question) {
      attempt = await journey.answerGateClearQuestion(worldId, rankId, gateId, attempt.attempt.attemptId, attempt.question.correctContentWordId);
    }
    assert.equal(attempt.result.result.passed, true);
    assert.equal((await journey.getActiveJourney({ force: true })).activeGateId, nextGateId);
    assert.equal((await journey.getGateProgress(worldId, rankId, gateId, { force: true })).status, 'cleared');

    // Ensure an existing password account uses the same official rules and
    // the legacy generic-session payload still produces legitimate evidence.
    const registeredContext = runtime(registered.app, fixture, clock);
    const registeredJourney = registeredContext.LootLinguaJourneyCloud;
    await registeredJourney.beginJourneyFromStart(worldId);
    assert.equal((await registeredJourney.loadGateWords(worldId, rankId, gateId)).completed, words.length);
    const registeredWords = await registeredJourney.getGateQuizWords(worldId, rankId, gateId);
    const input = {
      mode: 'matching', completed: true, timezoneOffsetMinutes: 0,
      entries: registeredWords.map(word => ({ word, result: { correct: true, answeredAt: Date.now() } })),
    };
    clock.time = Date.now();
    const official = await registeredJourney.recordQuizEvidenceBatch({
      ...input, sessionId: 'registered-official', source: `journey:${worldId}~${rankId}~${gateId}`,
      officialReviewGate: { worldId, rankId, gateId }, officialReviewDueWordKeys: wordKeys,
      entries: input.entries.map(entry => ({ ...entry, result: { ...entry.result, correct: false } })),
    });
    assert.equal(official.recorded, 0);
    const registeredProgress = await registeredJourney.getGateProgress(worldId, rankId, gateId, { force: true });
    assert.equal(registeredProgress.runnerReviewCompletedSessionId, 'registered-official');
    const personal = await registeredJourney.recordQuizEvidenceBatch({ ...input, sessionId: 'registered-personal', source: 'personal' });
    assert.equal(personal.recorded, words.length);
    assert.equal(personal.readinessError, null);
    const personalSnapshot = await getDoc(doc(registered.db, 'users', existing.uid, 'quizEvidenceSessions', 'registered-personal'));
    assert.equal(Object.keys(personalSnapshot.data()).length, 11);
    assert.equal(personalSnapshot.data().sourceType, 'personal');
  } finally {
    await Promise.all(apps.map(deleteApp));
  }
});
