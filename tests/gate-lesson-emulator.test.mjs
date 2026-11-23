import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import '../js/gate-lesson.js';

const address = /^127\.0\.0\.1:(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '');
const authAddress = /^127\.0\.0\.1:(\d+)$/.exec(process.env.FIREBASE_AUTH_EMULATOR_HOST || '');
const projectId = 'demo-lootlingua';

test('an offline v1 browser draft resumes after the staged update and has one review result', {
  skip: !address || !authAddress, timeout: 45_000,
}, async () => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const { doc, getDoc, setDoc, updateDoc, disableNetwork, enableNetwork, serverTimestamp } = await import('firebase/firestore');
  const candidate = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const oldRules = process.env.LEGACY_FIRESTORE_RULES_FILE
    ? readFileSync(process.env.LEGACY_FIRESTORE_RULES_FILE, 'utf8') : candidate;
  const options = { projectId: 'demo-lootlingua-offline-' + crypto.randomUUID().slice(0, 8),
    firestore: { host: '127.0.0.1', port: Number(address[1]) } };
  const before = await initializeTestEnvironment({ ...options, firestore: { ...options.firestore, rules: oldRules } });
  const oldTab = before.authenticatedContext('learner').firestore();
  const progressPath = 'users/learner/contentProgress/world/ranks/rank/gates/gate';
  const draftPath = 'users/learner/meta/active_quiz_session';
  const reviewPath = 'users/learner/quizEvidenceSessions';
  const gate = { worldId: 'world', rankId: 'rank', gateId: 'gate' };
  const words = ['one', 'two'].map(wordKey => ({ wordKey }));
  const payload = id => ({ sessionId: id, status: 'completed', mode: 'scramble', sourceType: 'personal',
    privateWorldId: '', wordKeys: ['one', 'two'], correctWordKeys: ['one'], totalCount: 2,
    correctCount: 1, evidenceVersion: 2, completedAt: serverTimestamp(), officialReviewWorldId: 'world',
    officialReviewRankId: 'rank', officialReviewGateId: 'gate', officialReviewDueWordKeys: ['one', 'two'] });
  const quiz = readFileSync(new URL('../js/quiz.js', import.meta.url), 'utf8');
  const cloud = readFileSync(new URL('../js/journey-cloud.js', import.meta.url), 'utf8');
  const lesson = globalThis.LootLinguaGateLesson;
  const cut = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const storage = new Map();
  let after;
  try {
    await before.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, progressPath), {
        ...gate, status: 'learning', loadedAt: serverTimestamp(), loadedWordKeys: ['one', 'two'],
        loadedContentWordIds: ['one', 'two']
      });
    });
    await assertSucceeds(setDoc(doc(oldTab, reviewPath, 'old-protocol'), payload('old-protocol')));
    if (process.env.LEGACY_FIRESTORE_RULES_FILE) {
      await assertFails(setDoc(doc(oldTab, progressPath + '/lesson/progress'), {
        ...lesson.start(words.map(word => ({ id: word.wordKey }))), updatedAt: serverTimestamp()
      }));
      await assertFails(setDoc(doc(oldTab, reviewPath, 'new-on-old-rules'), {
        ...payload('new-on-old-rules'), lessonWorldId: 'world', lessonRankId: 'rank', lessonGateId: 'gate'
      }));
    }
    await disableNetwork(oldTab);
    const legacy = vm.createContext({
      activeQuizSession: { id: 'offline-draft', mode: 'scramble', source: 'gate-gap:world~rank~gate',
        officialReviewGate: gate, officialReviewDueWordKeys: ['one', 'two'], words, selectedWordKeys: ['one', 'two'] },
      quizIndex: 1, currentStreak: 1, currentQuizMistakes: 0, timeAttackHp: 3,
      quizSessionResults: [{ wordKey: 'one', correct: true }], currentQuizWords: words,
      matchingQuizState: null, hasStartedAnswering: true, ACTIVE_QUIZ_SESSION_KEY: 'active_quiz_session',
      isVerifiedQuizMode: mode => mode === 'scramble',
      hasSignedInUser: () => false,
      localStorage: { setItem: (key, value) => storage.set(key, value) }
    });
    vm.runInContext(cut(quiz, 'function serializeActiveQuizSession()', 'async function loadStoredActiveQuizSession()'), legacy);
    vm.runInContext('saveActiveQuizSession()', legacy);
    const stored = JSON.parse(storage.get('active_quiz_session'));

    after = await initializeTestEnvironment({ ...options, firestore: { ...options.firestore, rules: candidate } });
    const nextTab = after.authenticatedContext('learner').firestore();
    const stranger = after.authenticatedContext('other-learner').firestore();
    assert.equal((await getDoc(doc(nextTab, draftPath))).exists(), false);
    assert.equal((await getDoc(doc(nextTab, 'releaseConfig/gateLesson'))).exists(), false);
    await assertFails(setDoc(doc(nextTab, 'releaseConfig/gateLesson'), { activatedAt: serverTimestamp() }));

    let saveBlocked = true;
    const identity = { currentUser: { uid: 'learner' } };
    const browser = vm.createContext({
      window: { auth: identity, LootLinguaGateLesson: lesson },
      auth: identity, db: nextTab, doc, getDoc,
      requireUser: () => identity.currentUser,
      gateLessonRef: () => doc(nextTab, progressPath + '/lesson/progress'),
      getGateProgress: async () => (await getDoc(doc(nextTab, progressPath))).data(),
      showToast: () => {}
    });
    vm.runInContext(cut(cloud, 'async function getGateLessonCutoff()', 'async function saveGateLessonState('), browser);
    vm.runInContext(cut(quiz, 'async function canOpenGateQuiz(', 'window.resumeActiveQuizSession ='), browser);
    browser.window.LootLinguaJourneyCloud = { getGateLessonAccess: browser.getGateLessonAccess };
    browser.window.saveActiveQuizSessionToCloud = async saved => {
      try {
        await setDoc(doc(saveBlocked ? stranger : nextTab, draftPath), saved);
        return true;
      } catch (error) {
        assert.equal(error.code, 'permission-denied');
        return false;
      }
    };
    assert.equal(await browser.canOpenGateQuiz(stored, true), false);
    assert.equal(JSON.parse(storage.get('active_quiz_session')).quizIndex, 1);
    assert.equal((await getDoc(doc(nextTab, draftPath))).exists(), false);
    saveBlocked = false;
    assert.equal(await browser.canOpenGateQuiz(stored, true), true);
    assert.equal(await browser.canOpenGateQuiz(stored), false);

    await enableNetwork(oldTab);
    assert.equal((await getDoc(doc(oldTab, draftPath))).data().quizIndex, 1);
    const finished = { ...stored, quizIndex: 2, quizSessionResults: [
      ...stored.quizSessionResults, { wordKey: 'two', correct: false }
    ] };
    await assertSucceeds(setDoc(doc(nextTab, draftPath), finished));
    await assertFails(setDoc(doc(oldTab, draftPath), stored));
    await assertFails(updateDoc(doc(stranger, draftPath), { quizIndex: 0 }));
    assert.deepEqual((await getDoc(doc(oldTab, draftPath))).data().quizSessionResults, finished.quizSessionResults);
    const result = { ...payload(stored.id), lessonWorldId: 'world', lessonRankId: 'rank', lessonGateId: 'gate' };
    await assertSucceeds(setDoc(doc(nextTab, reviewPath, stored.id), result));
    await assertFails(setDoc(doc(oldTab, reviewPath, stored.id), payload(stored.id)));
    assert.deepEqual((await getDoc(doc(oldTab, reviewPath, stored.id))).data().correctWordKeys, ['one']);
    assert.equal((await getDoc(doc(nextTab, 'users/learner/meta/profile'))).exists(), false);
  } finally {
    await after?.cleanup();
    await before.cleanup();
  }
});

test('local Spark rules distinguish gate review and clear from independent quiz evidence', {
  skip: !address || !authAddress, timeout: 30_000,
}, async () => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');
  const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, Timestamp, serverTimestamp } = await import('firebase/firestore');
  const env = await initializeTestEnvironment({ projectId, firestore: {
    host: '127.0.0.1', port: Number(address[1]), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
  } });
  const app = initializeApp({ projectId, apiKey: projectId }, 'lesson-' + crypto.randomUUID());
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + authAddress[0], { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', Number(address[1]));
  const gate = 'first', rank = 'a1', world = 'lesson-' + crypto.randomUUID();
  const words = Array.from({ length: 15 }, (_, i) => ({ id: 'word-' + i, word: 'word' + i, translation: 'معنى ' + i,
    example: i === 2 ? 'We use word2 here.' : '' }));
  const ids = words.map(word => word.id);
  const keys = words.map(word => word.word);
  const now = Timestamp.fromMillis(Date.now());
  const activation = Timestamp.fromMillis(now.toMillis() - 10_000);
  const historical = Timestamp.fromMillis(activation.toMillis() - 1000);
  const lesson = globalThis.LootLinguaGateLesson;

  try {
    const { user } = await signInAnonymously(auth);
    const { uid } = user;
    assert.equal(user.isAnonymous, true);
    const worldProgress = 'users/' + uid + '/contentProgress/' + world;
    const gateProgress = worldProgress + '/ranks/' + rank + '/gates/' + gate;
    const lessonPath = gateProgress + '/lesson/progress';
    const evidencePath = id => 'users/' + uid + '/quizEvidenceSessions/' + id;
    const validProgress = { worldId: world, rankId: rank, gateId: gate, journeyVersion: 1,
      status: 'ready', readyAt: now, loadedAt: now, lastActivityAt: now, clearAttempts: 0,
      readyEvidenceCount: keys.length, loadedContentWordIds: ids, loadedWordKeys: keys, activeClearAttemptId: '' };
    await env.withSecurityRulesDisabled(async context => {
      const seed = context.firestore();
      await setDoc(doc(seed, 'releaseConfig/gateLesson'), { activatedAt: activation, captureStartedAt: Timestamp.fromMillis(activation.toMillis() - 100) });
      await setDoc(doc(seed, 'content_worlds/' + world + '/ranks/' + rank + '/gates/' + gate), {
        status: 'published', publishedWordIds: ids, passThreshold: 0.75,
      });
      await setDoc(doc(seed, worldProgress), { status: 'active', activeRankId: rank, activeGateId: gate });
      await setDoc(doc(seed, gateProgress), validProgress);
      await setDoc(doc(seed, gateProgress + '/readiness/proof'), { wordIds: ids });
    });

    const noticePath = 'users/' + uid + '/notifications/lesson-reminder';
    const notice = { id: 'lesson-reminder', ownerId: uid, status: 'active', message: 'درس متوقف', priority: 64,
      notificationType: 'reminder.gate.lesson', context: { worldId: world, rankId: rank, gateId: gate, episodeKey: 'first' } };
    await assertSucceeds(setDoc(doc(db, noticePath), notice));
    const differentOwner = env.authenticatedContext('other-notification-owner').firestore();
    await assertFails(getDoc(doc(differentOwner, noticePath)));
    await assertFails(setDoc(doc(differentOwner, noticePath), notice));
    await assertSucceeds(setDoc(doc(db, noticePath), { ...notice, status: 'dismissed' }));

    const evidence = id => ({
      sessionId: id, status: 'completed', mode: 'scramble', sourceType: 'personal', privateWorldId: '',
      wordKeys: keys, correctWordKeys: keys, totalCount: keys.length, correctCount: keys.length,
      evidenceVersion: 2, completedAt: serverTimestamp(),
    });
    const gateScope = { lessonWorldId: world, lessonRankId: rank, lessonGateId: gate };
    const official = { officialReviewWorldId: world, officialReviewRankId: rank, officialReviewGateId: gate,
      officialReviewDueWordKeys: keys };
    const clearRef = doc(db, worldProgress + '/gateClearAttempts/run');
    const clear = { attemptId: 'run', worldId: world, rankId: rank, gateId: gate, questionOrder: ids,
      answers: [], currentQuestionIndex: 0, correctCount: 0, totalCount: ids.length, passRatio: 0.75,
      requiredCorrect: Math.ceil(ids.length * 0.75), status: 'active', gateClearVersion: 1,
      startedAt: serverTimestamp(), updatedAt: serverTimestamp() };

    await assertSucceeds(setDoc(doc(db, evidencePath('personal')), evidence('personal')));
    await assertFails(setDoc(doc(db, evidencePath('gate')), { ...evidence('gate'), ...gateScope }));
    await assertFails(setDoc(doc(db, evidencePath('official')), { ...evidence('official'), ...official }));
    await assertFails(setDoc(clearRef, clear));
    await assertSucceeds(setDoc(doc(db, gateProgress), { ...validProgress, lastActivityAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, gateProgress), { ...validProgress, readyAt: historical, lastActivityAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, gateProgress), { ...validProgress, loadedAt: historical, lastActivityAt: serverTimestamp() }));
    const draftPath = 'users/' + uid + '/meta/active_quiz_session';
    const sealPath = 'users/' + uid + '/meta/legacy_gate_quiz';
    const draft = {
      id: 'legacy-draft', mode: 'scramble', createdAt: historical.toMillis(),
      source: 'journey:' + world + '~' + rank + '~' + gate,
      officialReviewGate: { worldId: world, rankId: rank, gateId: gate },
      officialReviewDueWordKeys: keys,
    };
    const seal = { sessionId: draft.id, mode: draft.mode, worldId: world, rankId: rank,
      gateId: gate, source: draft.source, words: [], officialReviewGate: draft.officialReviewGate,
      capturedAt: historical, wordKeys: keys, dueWordKeys: keys };

    await assertFails(setDoc(doc(db, 'releaseConfig/gateLesson'), { activatedAt: now }));
    await assertFails(setDoc(doc(db, sealPath), seal));
    await assertFails(setDoc(doc(db, draftPath), draft));
    await assertFails(setDoc(doc(db, evidencePath(draft.id)), { ...evidence(draft.id), ...official }));
    const other = env.authenticatedContext('unrelated-owner').firestore();
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), draftPath), draft);
    });
    await assertFails(setDoc(doc(db, evidencePath(draft.id)), { ...evidence(draft.id), ...official }));
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), sealPath), seal);
    });
    await assertFails(getDoc(doc(other, sealPath)));
    await assertSucceeds(setDoc(doc(db, draftPath), { ...draft, currentIndex: 4 }));
    await assertFails(setDoc(doc(db, draftPath), { ...draft, id: 'different-draft' }));
    await assertFails(setDoc(doc(db, draftPath), { ...draft, journeyWorldId: 'other', journeyRankId: rank, journeyGateId: gate }));
    await assertFails(setDoc(doc(db, draftPath), { ...draft, words: [{ wordKey: 'another-cohort' }] }));
    await assertFails(setDoc(doc(db, draftPath), { ...draft, officialReviewDueWordKeys: keys.slice(1) }));
    await assertFails(setDoc(doc(db, evidencePath(draft.id)), { ...evidence(draft.id), ...official, officialReviewDueWordKeys: keys.slice(1) }));
    await assertFails(setDoc(doc(db, evidencePath('different-draft')), { ...evidence('different-draft'), ...official }));
    await assertSucceeds(setDoc(doc(db, evidencePath(draft.id)), { ...evidence(draft.id), ...official }));

    await assertFails(setDoc(doc(db, lessonPath), { ...lesson.start(words), completedWordIds: ids, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, lessonPath), { ...lesson.start(words, ids), updatedAt: serverTimestamp() }));
    const empty = lesson.start(words);
    await assertFails(setDoc(doc(db, lessonPath), { ...lesson.start(words.slice(0, 1)), updatedAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled(async context => {
      const seed = context.firestore();
      await setDoc(doc(seed, gateProgress), { ...validProgress, loadedAt: historical });
      await setDoc(doc(seed, gateProgress + '/lesson/legacyCredit'), { wordIds: ids, creditedIds: [ids[0]], capturedAt: historical });
    });
    await assertFails(setDoc(doc(db, gateProgress + '/lesson/legacyCredit'), { wordIds: ids, creditedIds: ids, capturedAt: historical }));
    await assertFails(setDoc(doc(db, lessonPath), { ...lesson.start(words, ids), updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, lessonPath), { ...lesson.start(words, [ids[0]]), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, lessonPath), {
      ...empty, legacyCompletedIds: [ids[0]], completedWordIds: [ids[0]], updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db, lessonPath), {
      ...empty, study: { ...empty.study, remembered: [ids[0]], recalled: [ids[0]] },
      completedWordIds: [ids[0]], updatedAt: serverTimestamp(),
    }));
    const historicalAttempt = doc(db, worldProgress + '/gateClearAttempts/existing-run');
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), historicalAttempt.path), { ...clear, attemptId: 'existing-run',
        startedAt: historical, updatedAt: historical });
    });
    await assertSucceeds(setDoc(historicalAttempt, { ...clear, attemptId: 'existing-run', startedAt: historical,
      answers: [{ contentWordId: ids[0], selectedContentWordId: ids[0], correct: true }],
      currentQuestionIndex: 1, correctCount: 1 }));
    await assertFails(getDoc(doc(other, historicalAttempt.path)));

    const old = { version: 1, wordIds: ids, creditedIds: [], completedWordIds: [ids[0]],
      answers: { ['learn:' + ids[0]]: 'correct', ['recall:' + ids[0]]: 'revealed', ['learn:' + ids[1]]: 'wrong' },
      passed: ['learn:' + ids[0], 'recall:' + ids[0]], updatedAt: historical };
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), lessonPath), old);
    });
    let state = lesson.upgrade((await getDoc(doc(db, lessonPath))).data(), { confirmed: true });
    await assertSucceeds(setDoc(doc(db, lessonPath), { ...state, updatedAt: serverTimestamp() }));
    assert.deepEqual(state.legacyCompletedIds, [ids[0]]);
    assert.deepEqual(state.study.applied, []);
    const steps = lesson.build(words, state);
    const interact = (step, event, value) => { state = lesson.interact(state, steps, step.id, event, value); };
    let checkedFour = false;
    for (let step = lesson.stepAt(steps, state); step; step = lesson.stepAt(steps, state)) {
      if (step.phase === 'teach') {
        if (step.practice === 'cloze') interact(step, 'practice');
        else if (step.word.id === ids[1]) interact(step, 'guided', 'incorrect meaning');
        else interact(step, 'guided', lesson.expectedFor(step));
      }
      else if (step.phase === 'reinforce') interact(step, 'connect');
      else {
        const miss = step.phase === 'retrieve' && step.word.id === ids[1];
        const guided = step.phase === 'apply' && step.word.id === ids[2];
        if (guided) {
          interact(step, 'hint');
          await assertSucceeds(setDoc(doc(db, lessonPath), { ...state, updatedAt: serverTimestamp() }));
          assert.deepEqual((await getDoc(doc(db, lessonPath))).data().study.hinted, [ids[2]]);
        }
        if (miss) interact(step, 'reveal');
        else interact(step, 'answer', lesson.expectedFor(step));
        if (lesson.stepAt(steps, state)?.id === step.id) interact(step, 'next');
      }
      if (!checkedFour && state.completedWordIds.length === 4 && !lesson.complete(state)) {
        checkedFour = true;
        await assertSucceeds(setDoc(doc(db, lessonPath), { ...state, updatedAt: serverTimestamp() }));
        await assertFails(setDoc(doc(db, evidencePath('gate')), { ...evidence('gate'), ...gateScope }));
        const stored = lesson.upgrade((await getDoc(doc(db, lessonPath))).data());
        assert.equal(stored.study.misses[ids[1]], 'revealed');
        assert.deepEqual(stored.study.retried, []);
        const regressed = { ...stored, study: { ...stored.study, hinted: [] }, updatedAt: serverTimestamp() };
        await assertFails(setDoc(doc(db, lessonPath), regressed));
      }
    }
    assert.equal(checkedFour, true);
    assert.deepEqual(state.study.retried, [ids[1]]);
    await assertSucceeds(setDoc(doc(db, lessonPath), { ...state, updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(other, lessonPath)));
    await assertSucceeds(setDoc(doc(db, evidencePath('gate')), { ...evidence('gate'), ...gateScope }));
    await assertSucceeds(setDoc(doc(db, evidencePath('official')), { ...evidence('official'), ...official }));
    await assertSucceeds(setDoc(clearRef, clear));
    await assertSucceeds(setDoc(doc(db, draftPath), {
      ...draft, id: 'new-after-lesson', journeyWorldId: world, journeyRankId: rank, journeyGateId: gate,
    }));
  } finally {
    await deleteApp(app);
    await env.cleanup();
  }
});

test('release rehearsal seals only pre-capture server snapshots and keeps personal drafts independent', {
  skip: !address || !authAddress, timeout: 45_000,
}, async () => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, getDoc, deleteDoc, serverTimestamp } = await import('firebase/firestore');
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { gateLessonEmulatorRelease } = await import('../tools/gate-lesson-release-emulator.mjs');
  const env = await initializeTestEnvironment({ projectId, firestore: {
    host: '127.0.0.1', port: Number(address[1]), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
  } });
  const app = initializeApp({ projectId }, 'release-' + crypto.randomUUID());
  const server = getFirestore(app);
  const release = gateLessonEmulatorRelease(app);
  const fixtureId = crypto.randomUUID();
  const uid = 'historical-owner-' + fixtureId;
  const lateUid = 'late-owner-' + fixtureId;
  const guestUid = 'historical-guest-' + fixtureId;
  const user = env.authenticatedContext(uid).firestore();
  const secondTab = env.authenticatedContext(uid).firestore();
  const guest = env.authenticatedContext(guestUid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const other = env.authenticatedContext(lateUid).firestore();
  const meta = id => 'users/' + id + '/meta/active_quiz_session';
  const worldId = 'release-world-' + fixtureId, rankId = 'a1', gateId = 'first';
  const scope = { worldId, rankId, gateId };
  const old = { id: 'old-attempt', mode: 'scramble', source: 'journey:' + worldId + '~' + rankId + '~' + gateId,
    words: [{ wordKey: 'term' }], quizIndex: 1, quizSessionResults: [{ wordKey: 'term', correct: true }],
    createdAt: 1, officialReviewGate: scope, officialReviewDueWordKeys: ['term'] };
  try {
    await server.doc('releaseConfig/gateLesson').delete();
    await server.doc('content_worlds/' + worldId + '/ranks/' + rankId + '/gates/' + gateId)
      .set({ status: 'published', publishedWordIds: ['content-term'] });
    for (const id of [uid, guestUid, lateUid]) {
      await server.doc('users/' + id + '/contentProgress/' + worldId + '/ranks/' + rankId + '/gates/' + gateId)
        .set({ status: 'learning', loadedAt: new Date(), loadedWordKeys: ['term'], loadedContentWordIds: ['content-term'] });
    }
    await server.doc(meta(uid)).set(old);
    await server.doc(meta(guestUid)).set({ ...old, id: 'guest-attempt', quizIndex: 0, quizSessionResults: [] });
    // Model a saved draft from before the capture window, including on an emulator
    // that resolves two nearby writes to the same server-timestamp millisecond.
    await new Promise(resolve => setTimeout(resolve, 80));
    await release.beginCapture();
    const boundary = (await server.doc('releaseConfig/gateLesson').get()).data().captureStartedAt;
    assert.ok((await server.doc(meta(guestUid)).get()).updateTime.toMillis() < boundary.toMillis());
    await assertFails(setDoc(doc(user, 'releaseConfig/gateLesson'), { activatedAt: serverTimestamp() }, { merge: true }));
    const [firstSeal, duplicateSeal] = await Promise.all([
      release.captureDraft(uid), release.captureDraft(uid),
      assertFails(setDoc(doc(user, meta(uid)), { ...old, source: 'personal', officialReviewGate: null })),
      assertFails(deleteDoc(doc(secondTab, meta(uid)))),
      assertFails(setDoc(doc(other, meta(lateUid)), old)),
    ]);
    assert.deepEqual([firstSeal, duplicateSeal], [true, true]);
    assert.equal(await release.captureDraft(guestUid), true);
    // A fixture imported after the boundary remains ineligible despite a client date in the past.
    await server.doc(meta(lateUid)).set(old);
    assert.equal(await release.captureDraft(lateUid), false);
    await assertFails(getDoc(doc(other, 'users/' + uid + '/meta/legacy_gate_quiz')));
    await release.activate();
    await release.activate();
    const config = (await server.doc('releaseConfig/gateLesson').get()).data();
    const seal = (await server.doc('users/' + uid + '/meta/legacy_gate_quiz').get()).data();
    assert.ok(seal.capturedAt.toMillis() < config.captureStartedAt.toMillis());
    assert.ok(config.captureStartedAt.toMillis() <= config.activatedAt.toMillis());
    assert.equal(seal.capturedAt.isEqual((await server.doc(meta(uid)).get()).updateTime), true);
    await assertSucceeds(setDoc(doc(user, meta(uid)), old, { merge: true }));
    await assertSucceeds(setDoc(doc(guest, meta(guestUid)), { quizIndex: 1 }, { merge: true }));
    await assertFails(setDoc(doc(other, meta(lateUid)), { quizIndex: 0 }, { merge: true }));
    await assertSucceeds(setDoc(doc(other, meta(lateUid)), { id: 'personal', source: 'personal', mode: 'matching' }));

    const entry = { contractVersion: 3, experienceVersion: 2, status: 'completed', audience: 'new',
      classification: 'brand-new', currentStep: 'discover', interestsStatus: 'skipped', interestIds: [],
      themeStatus: 'selected', themeId: 'ocean', oasisMode: 'light', themeExplicit: true,
      journeyStatus: 'structure-explored', selectedWorldId: '', gamerStatus: 'not-applicable', source: 'app-entry',
      startedAt: serverTimestamp(), updatedAt: serverTimestamp(), completedAt: serverTimestamp(), skippedAt: null };
    const target = 'users/' + guestUid + '/entryExperiences/v2';
    await assertSucceeds(setDoc(doc(guest, target), entry));
    await assertFails(setDoc(doc(guest, target), { contractVersion: 2, currentStep: 'destination', updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(doc(other, target), entry));
  } finally {
    await deleteApp(app);
    await env.cleanup();
  }
});
