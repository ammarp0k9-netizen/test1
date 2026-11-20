import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as adminStore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import { createGuestJourneyAuth } from '../js/guest-journey-auth.js';
import { createSavedGuestSession } from '../js/saved-guest-session.js';
import { createGuestDictionaryMerge } from '../js/guest-dictionary-merge.js';
import { useGoogleRedirect } from '../js/saved-guest-flow.js';
import { createGuestProgressMerge } from '../js/guest-progress-merge.js';
import { readFileSync } from 'node:fs';

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const dbHost = process.env.FIRESTORE_EMULATOR_HOST;
const loopback = /^127\.0\.0\.1:\d+$/;
const skip = !(loopback.test(authHost || '') && loopback.test(dbHost || ''));
const { collection, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp } = firestore;
const denied = (operation) => assert.rejects(operation, { code: 'permission-denied' });
const password = 'LocalOnlyPassword_724';

function client(t) {
  const app = initializeApp({ projectId: 'demo-lootlingua', apiKey: 'demo-lootlingua', authDomain: 'localhost' }, randomUUID());
  t.after(() => deleteApp(app));
  const auth = sdk.getAuth(app);
  sdk.connectAuthEmulator(auth, 'http://' + authHost, { disableWarnings: true });
  const db = firestore.getFirestore(app);
  firestore.connectFirestoreEmulator(db, '127.0.0.1', Number(dbHost.split(':')[1]));
  return { auth, db };
}

async function register(auth, label) {
  const email = `${label}-${randomUUID()}@example.test`;
  const { user } = await sdk.createUserWithEmailAndPassword(auth, email, password);
  return user;
}

function controller(t) {
  const main = client(t);
  const saved = client(t);
  const destination = client(t);
  const auth = createSavedGuestSession({
    auth: main.auth, getSavedAuth: () => saved.auth, getDestinationAuth: () => destination.auth,
    sdk: { ...sdk, browserLocalPersistence: sdk.inMemoryPersistence },
  });
  const merge = createGuestDictionaryMerge({
    firestore, getDatabase: (instance) => firestore.getFirestore(instance.app), assertCurrent: auth.assertCurrent,
  });
  return { main, saved, destination, auth, merge };
}

const word = (uid, text, meaning, extra = {}) => ({ text, meaning, userId: uid, category: 'عام', ...extra });
const profile = (db, user) => doc(db, 'users', user.uid, 'meta', 'profile');
const words = (db, user) => collection(db, 'users', user.uid, 'words');

test('guest dictionary merge requires both Auth identities, preserves distinct senses and resumes without adding XP or cleared gates', { skip }, async (t) => {
  const { main, auth, merge, destination } = controller(t);
  const old = client(t);
  const other = client(t);
  const target = await register(old.auth, 'target');
  const alternative = await register(other.auth, 'alternative');
  const { user: guest } = await sdk.signInAnonymously(main.auth);
  const server = initializeAdmin({ projectId: 'demo-lootlingua' }, guest.uid);
  t.after(() => deleteAdmin(server));
  const guestWorld = 'test-world';
  const gatePath = (uid) => ['users', uid, 'contentProgress', guestWorld, 'ranks', 'a1', 'gates', 'first'];
  const guestGate = { status: 'cleared', clearedBy: 'gate-clear', readyEvidenceCount: 3 };
  await adminStore(server).doc(gatePath(guest.uid).join('/')).set(guestGate);
  const guestMastery = { entries: { bank: { mastery_status: 'Mastered' } }, updatedAt: new Date() };
  await setDoc(doc(main.db, 'users', guest.uid, 'meta', 'word_mastery'), guestMastery);
  // An ID and a schema-valid amount alone do not prove an earned transition.
  await setDoc(doc(main.db, 'users', guest.uid, 'meta', 'xp_event_word_transition:bogus:new_learning'), {
    amount: 2, reason: 'word_transition_new_learning', xpEconomyVersion: 2, createdAt: serverTimestamp(),
  });
  const profileReceipt = doc(main.db, 'users', guest.uid, 'meta', 'xp_event_profile_sync_v1_runner-purchase');
  await setDoc(profileReceipt, {
    type: 'profile-sync-v1', operationId: 'runner-purchase', result: { applied: true, reason: '' }, createdAt: new Date(),
  });
  await denied(updateDoc(profileReceipt, { result: { applied: false, reason: '' } }));
  await denied(setDoc(doc(main.db, 'users', guest.uid, 'meta', 'xp_event_profile_sync_v1_forged'), {
    amount: 2, reason: 'word_transition_new_learning', xpEconomyVersion: 2, createdAt: serverTimestamp(),
  }));
  await Promise.all([
    setDoc(doc(words(main.db, guest), 'match'), word(guest.uid, 'house', 'بيت')),
    setDoc(doc(words(main.db, guest), 'same-text-other-sense'), word(guest.uid, 'bank', 'ضفة', { mastery_status: 'Mastered', earnedTransitions: ['new_learning'], xpValue: 999 })),
    setDoc(doc(words(main.db, guest), 'distinct'), word(guest.uid, 'walk', 'يمشي')),
    setDoc(doc(words(main.db, guest), 'private'), word(guest.uid, 'hidden', 'مخفي', { personalDictionaryState: 'moved-to-private-world' })),
    setDoc(doc(words(old.db, target), 'already-present'), word(target.uid, 'house', 'بيت')),
    setDoc(doc(words(old.db, target), 'other-sense'), word(target.uid, 'bank', 'مصرف')),
    adminStore(server).doc(profile(main.db, guest).path).set({ userXP: 357, wallet: 88 }),
    adminStore(server).doc(profile(old.db, target).path).set({ userXP: 924, wallet: 17 }),
  ]);
  await denied(setDoc(profile(other.db, alternative), { userXP: 0, wallet: 1 }));
  await assert.rejects(auth.selectEmail(target.email, 'WrongPassword!'));
  assert.equal(main.auth.currentUser.uid, guest.uid);
  const first = await auth.selectEmail(alternative.email, password);
  const abandoned = await merge.preview(first, main.auth);
  await auth.cancel(first);
  const selected = await auth.selectEmail(target.email, password);
  await assert.rejects(merge.commit(abandoned), { code: 'guest-saved/session-changed' });
  assert.equal((await getDocs(words(other.db, alternative))).size, 0);
  const plan = await merge.preview(selected, main.auth);
  assert.equal(plan.additions.length, 2);
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.skipped, 1);
  assert.equal((await getDocs(words(old.db, target))).size, 2, 'preview did not write');
  const grant = (db) => doc(db, 'users', guest.uid, 'savedGuestMerges', plan.id);
  await denied(setDoc(grant(old.db), { targetUid: target.uid, createdAt: serverTimestamp() }));
  await denied(getDocs(words(old.db, guest)));

  await assert.rejects(merge.commit(plan, () => { throw new Error('test interruption after first committed word'); }), /test interruption/);
  assert.equal((await getDoc(grant(old.db))).data().completedAt, undefined);
  await denied(getDoc(grant(other.db)));
  await denied(updateDoc(grant(old.db), { targetUid: alternative.uid, completedAt: serverTimestamp() }));
  await denied(updateDoc(grant(other.db), { completedAt: serverTimestamp() }));
  await denied(updateDoc(grant(main.db), { completedAt: serverTimestamp() }));
  const retry = await merge.preview(selected, main.auth);
  assert.equal(retry.id, plan.id);
  assert.equal(retry.additions.length, 1);
  await merge.commit(retry);
  await merge.commit(plan);
  const savedRows = (await getDocs(words(old.db, target))).docs.map((row) => row.data());
  assert.equal(savedRows.length, 4);
  assert.deepEqual(savedRows.filter((row) => row.text === 'bank').map((row) => row.meaning).sort(), ['ضفة', 'مصرف']);
  assert.equal(savedRows.find((row) => row.meaning === 'ضفة').mastery_status, undefined);
  assert.equal((await getDoc(doc(old.db, 'users', target.uid, 'contentWords', 'bank'))).data().eligibleEvidenceCount, 0);
  assert.equal((await getDocs(collection(old.db, 'users', target.uid, 'contentProgress'))).size, 0);
  assert.equal((await getDoc(doc(old.db, ...gatePath(target.uid)))).exists(), false);
  assert.equal((await getDoc(doc(old.db, 'users', target.uid, 'meta', 'word_mastery'))).exists(), false);
  assert.equal((await getDoc(doc(old.db, 'users', target.uid, 'meta', 'xp_event_word_transition:bogus:new_learning'))).exists(), false);
  assert.deepEqual((await getDoc(profile(old.db, target))).data(), { userXP: 924, wallet: 17 });
  assert.equal((await getDocs(words(main.db, guest))).size, 4);
  assert.ok((await getDoc(grant(old.db))).data().completedAt);
  await denied(updateDoc(grant(old.db), { completedAt: serverTimestamp() }));
  assert.equal((await auth.continueAsTarget(selected)).uid, target.uid);
  assert.equal(destination.auth.currentUser, null);
  assert.equal((await auth.restore()).uid, guest.uid);
  assert.deepEqual((await getDoc(profile(main.db, guest))).data(), { userXP: 357, wallet: 88 });
  assert.deepEqual((await getDoc(doc(main.db, ...gatePath(guest.uid)))).data(), guestGate);
  assert.equal((await getDoc(doc(main.db, 'users', guest.uid, 'meta', 'word_mastery'))).data().entries.bank.mastery_status, 'Mastered');
});

test('continuing without a merge preserves the guest, and new email accounts still link the same UID', { skip }, async (t) => {
  const { main, auth, merge } = controller(t);
  const old = client(t);
  const target = await register(old.auth, 'continue');
  const { user: guest } = await sdk.signInAnonymously(main.auth);
  await setDoc(doc(words(main.db, guest), 'saved'), word(guest.uid, 'again', 'مرة أخرى'));
  const selected = await auth.selectEmail(target.email, password);
  const plan = await merge.preview(selected, main.auth);
  assert.equal(plan.additions.length, 1);
  assert.equal((await auth.continueAsTarget(selected)).uid, target.uid);
  assert.equal((await getDocs(words(old.db, target))).size, 0);
  await sdk.signOut(main.auth);
  assert.equal((await auth.restore()).uid, guest.uid);
  assert.equal((await getDocs(words(main.db, guest))).size, 1);
  const journeyAuth = createGuestJourneyAuth(main.auth, sdk);
  const linked = await journeyAuth.register(`linked-${randomUUID()}@example.test`, password);
  assert.equal(linked.user.uid, guest.uid);
  assert.equal(linked.user.isAnonymous, false);
  await auth.clearAfterLink(linked.user);
  assert.equal(await auth.savedUser(), null);
});

test('Google credential collision keeps the anonymous session before a verified account switch', { skip }, async (t) => {
  const { main, auth } = controller(t);
  const old = client(t);
  const sub = randomUUID();
  const credential = sdk.GoogleAuthProvider.credential(JSON.stringify({ sub, email: `google-${sub}@example.test`, email_verified: true }));
  const { user: target } = await sdk.signInWithCredential(old.auth, credential);
  const { user: guest } = await sdk.signInAnonymously(main.auth);
  const wrapped = createGuestJourneyAuth(main.auth, { ...sdk, linkWithPopup: (user) => sdk.linkWithCredential(user, credential) });
  await assert.rejects(wrapped.google({}), (error) => error.code === 'guest-account/conflict' && error.cause.code === 'auth/credential-already-in-use');
  const selection = await auth.selectGoogle(credential);
  assert.equal(selection.target.uid, target.uid);
  assert.equal(main.auth.currentUser.uid, guest.uid);
  await auth.cancel(selection);
  assert.equal(main.auth.currentUser.uid, guest.uid);
  assert.equal(useGoogleRedirect(main.auth, true, 'example.github.io'), false);
  assert.equal(useGoogleRedirect(main.auth, true, 'localhost'), true);
});


test('full merge adds stored balances once, preserves evidence and clears the next gate through the normal route', { skip, timeout: 90_000 }, async (t) => {
  const { main, auth } = controller(t);
  const account = client(t);
  const outsider = client(t);
  const target = await register(account.auth, 'merge-destination');
  const other = await register(outsider.auth, 'merge-other');
  const guest = await createGuestJourneyAuth(main.auth, sdk).start();
  const merge = createGuestProgressMerge({ firestore, getDatabase: auth => firestore.getFirestore(auth.app), assertCurrent: auth.assertCurrent });
  const server = initializeAdmin({ projectId: 'demo-lootlingua' }, 'full-' + guest.uid);
  t.after(() => deleteAdmin(server));
  const admin = adminStore(server);
  const worldId = 'full-guest-' + guest.uid;
  const rankId = 'a1';
  const source = 'users/' + guest.uid;
  const dest = 'users/' + target.uid;
  const worldPath = 'content_worlds/' + worldId;
  const gateProgress = (owner, id) => owner + '/contentProgress/' + worldId + '/ranks/a1/gates/' + id;
  const past = new Date(Date.now() - 30 * 60 * 60 * 1000);
  const previous = new Date(past.getTime() - 3 * 60 * 60 * 1000);
  const at = new Date();
  const mode = 'matching';
  const userDb = account.db;
  const base = { version: 1, status: 'published', schemaVersion: 1 };
  const batch = admin.batch();
  const add = (path, data) => batch.set(admin.doc(path), data);
  add(worldPath, { ...base, worldId, slug: worldId, title: 'Merge world', order: 0 });
  add(worldPath + '/ranks/a1', { ...base, worldId, rankId, title: 'A1', cefrLevel: 'A1', order: 0, unlockConfig: { initialStatus: 'available' } });
  const gates = ['first', 'second', 'third'].map((gateId, order) => ({ ...base, worldId, rankId, gateId, title: gateId, order,
    wordCount: 1, publishedWordIds: ['term'], unlockConfig: { initialStatus: order ? 'locked' : 'available' } }));
  for (const gate of gates) add(worldPath + '/ranks/a1/gates/' + gate.gateId, gate);
  const content = { ...base, worldId, rankId, gateId: 'second', contentWordId: 'term', wordKey: 'bank', normalizedWord: 'bank',
    normalizationVersion: 1, word: 'bank', translation: 'ضفة', order: 0 };
  add(worldPath + '/ranks/a1/gates/second/words/term', content);
  const journey = { worldId, journeyVersion: 1, status: 'active', activeRankId: rankId, activeGateId: 'second',
    placementStatus: 'declined', unlockedRankIds: [rankId], unlockedGateIds: ['first', 'second'], startedAt: previous, updatedAt: past };
  add(source + '/contentProgress/' + worldId, journey);
  add(dest + '/contentProgress/' + worldId, { ...journey, activeGateId: 'first', unlockedGateIds: ['first'] });
  add(source + '/meta/active_content_journey', { worldId, updatedAt: past });
  const gate = { worldId, rankId, journeyVersion: 1, readyEvidenceCount: 0, clearAttempts: 0, status: 'available', lastActivityAt: past };
  add(dest + '/contentProgress/' + worldId + '/ranks/a1/gates/first', { ...gate, gateId: 'first' });
  const attemptId = 'previous-clear-' + guest.uid;
  add(gateProgress(source, 'first'), { ...gate, gateId: 'first', status: 'cleared', clearedBy: 'gate-clear', clearedAt: past,
    lastClearResult: 'passed', lastClearAttemptId: attemptId });
  add(source + '/contentProgress/' + worldId + '/gateClearAttempts/' + attemptId, { attemptId, worldId, rankId, gateId: 'first',
    status: 'passed', startedAt: previous, updatedAt: past, completedAt: past, correctCount: 1, totalCount: 1, currentQuestionIndex: 1 });
  add(gateProgress(source, 'second'), { ...gate, gateId: 'second', status: 'learning', loadedAt: previous,
    loadedWordKeys: ['bank'], loadedContentWordIds: ['term'], evidenceStepCount: 2, totalEvidenceSteps: 3 });
  add(gateProgress(source, 'second') + '/lesson/progress', {
    version: 1, wordIds: ['term'], creditedIds: [], completedWordIds: ['term'],
    answers: { 'learn:term': 'revealed', 'recall:term': 'correct' },
    passed: ['learn:term', 'recall:term'], updatedAt: past,
  });
  await import('../js/gate-lesson.js');
  const lesson = globalThis.LootLinguaGateLesson;
  const repairWords = [{ id: 'term', word: 'bank', translation: 'ضفة' }];
  const compact = lesson.start(repairWords);
  // A saved guest from the previous lesson engine, paused before its retry.
  const repairDraft = { ...compact, study: { ...compact.study, explained: ['term'], taught: ['term'],
    hinted: ['term'], applied: ['term'], applications: { term: 'assisted' },
    misses: { term: 'revealed' }, recalled: ['term'] } };
  const repairPlan = lesson.build(repairWords, repairDraft);
  assert.equal(lesson.stepAt(repairPlan, repairDraft).phase, 'reinforce');
  add(gateProgress(source, 'first') + '/lesson/progress', { ...repairDraft, updatedAt: past });

  const mastery = { mastery_status: 'Reviewing', mastery_streak: 2, first_recalled_at: previous.getTime(),
    last_recalled_at: past.getTime(), last_recall_session_id: 'prior-2', earnedTransitions: ['new_learning', 'learning_reviewing'] };
  add(source + '/meta/word_mastery', { entries: { bank: mastery }, updatedAt: past });
  add(dest + '/meta/word_mastery', { entries: { bank: { mastery_status: 'Learning', last_recalled_at: at.getTime() },
    river: { mastery_status: 'Learning' } }, updatedAt: at });
  add(source + '/words/bank-origin', word(guest.uid, 'bank', 'ضفة', { wordKey: 'bank', personalDictionaryState: 'active' }));
  add(dest + '/words/bank-target', word(target.uid, 'bank', 'مصرف', { wordKey: 'bank', personalDictionaryState: 'active' }));
  add(source + '/customWorlds/private-study', { userId: guest.uid, name: 'Private study' });
  add(source + '/customWorlds/private-study/words/private-word', word(guest.uid, 'tree', 'شجرة'));
  const canonicalPath = source + '/contentWords/bank';
  const previousEvent = 'e2~' + guest.uid + '~prior-2~bank';
  add(canonicalPath, { word: 'bank', translation: 'ضفة', normalizedWord: 'bank', wordKey: 'bank', normalizationVersion: 1,
    canonicalId: 'bank', masteryKey: 'bank', legacyWordId: 'bank-origin', evidenceVersion: 2, schemaVersion: 1,
    sourceCount: 1, forgetCount: 0, eligibleEvidenceCount: 2, lastEligibleEvidenceAt: past,
    lastEvidenceEventId: previousEvent, evidenceTimezoneOffsetMinutes: 0, lastEvidenceLocalDayKey: Math.floor(past.getTime() / 86400000) });
  add(canonicalPath + '/sources/' + [worldId, rankId, 'second', 'term'].join('~'), { addedFrom: 'published-gate', operationId: 'published-import', linkedAt: previous });
  for (const [sequence, date] of [[1, previous], [2, past]]) {
    const sessionId = 'prior-' + sequence;
    const eventId = 'e2~' + guest.uid + '~' + sessionId + '~bank';
    add(source + '/quizEvidenceSessions/' + sessionId, { sessionId, status: 'completed', mode, sourceType: 'personal', privateWorldId: '',
      wordKeys: ['bank'], correctWordKeys: ['bank'], totalCount: 1, correctCount: 1, evidenceVersion: 2, completedAt: date });
    add(canonicalPath + '/evidence/' + eventId, { eventId, wordKey: 'bank', sessionId, sequence, occurredAt: date, correct: true });
  }
  add(source + '/meta/profile', { onboardingProgress: { 'lootlingua-guide': { version: 1, topics: { lesson: 'seen' } } }, userXP: 5000, runnerCoins: 7, lootBots: { coins: 20, best: 56 },
    titlesState: { unlocked: ['guest-title'] }, theme: 'ocean', runnerUnlocks: ['character-2'] });
  add(dest + '/meta/profile', { onboardingProgress: { 'lootlingua-guide': { version: 1, topics: { lesson: 'dismissed', dictionary: 'seen' } } }, userXP: 8000, runnerCoins: 9, lootBots: { coins: 1, best: 65 }, titlesState: { unlocked: ['account-title'] }, theme: 'lootlingua' });
  await batch.commit();

  const grant = (db, uid) => doc(db, 'users', uid, 'savedGuestMerges', 'progress');
  const permit = (db, uid) => doc(db, 'users', uid, 'meta', 'saved_guest_import');
  await denied(setDoc(grant(userDb, guest.uid), { targetUid: target.uid, createdAt: serverTimestamp() }));
  await denied(setDoc(permit(userDb, target.uid), { sourceUid: guest.uid, startedAt: serverTimestamp() }));
  await denied(getDoc(doc(userDb, gateProgress(source, 'second'))));
  const selected = await auth.selectEmail(target.email, password);
  const plan = await merge.preview(selected, main.auth);
  assert.equal(plan.finalXP, 13000);
  assert.equal((await getDoc(profile(userDb, target))).data().userXP, 8000);
  await assert.rejects(merge.commit(plan, (stage) => { if (stage === 'journeys') throw Error('interrupted after words'); }), /interrupted/);
  assert.equal((await getDoc(profile(userDb, target))).data().userXP, 8000);
  await denied(setDoc(permit(outsider.db, other.uid), { sourceUid: guest.uid, startedAt: serverTimestamp() }));
  await denied(getDoc(grant(outsider.db, guest.uid)));
  await denied(updateDoc(grant(main.db, guest.uid), { targetUid: other.uid }));
  await denied(setDoc(doc(outsider.db, gateProgress(dest, 'third')), { ...gate, gateId: 'third' }));
  await auth.cancel(selected);
  const otherSelection = await auth.selectEmail(other.email, password);
  await assert.rejects(merge.preview(otherSelection, main.auth), { code: 'guest-saved/another-destination' });
  await auth.cancel(otherSelection);
  const retry = await auth.selectEmail(target.email, password);
  await assert.rejects(merge.commit(await merge.preview(retry, main.auth), stage => { if (stage === 'finalizing') throw Error('interrupted after balance'); }), /interrupted/);
  assert.equal((await getDoc(profile(userDb, target))).data().userXP, 13000);
  await merge.commit(await merge.preview(retry, main.auth));
  const finished = await merge.preview(retry, main.auth);
  assert.equal(finished.completed, true);
  assert.equal(finished.receipt.sourceXP, 5000);
  await merge.commit(finished);
  const merged = (await getDoc(profile(userDb, target))).data();
  assert.equal(merged.userXP, 13000);
  assert.equal(merged.runnerCoins, 16);
  assert.equal(merged.lootBots.coins, 21);
  assert.equal(merged.theme, 'lootlingua');
  assert.deepEqual(merged.onboardingProgress['lootlingua-guide'].topics, { lesson: 'seen', dictionary: 'seen' });
  await denied(getDoc(profile(outsider.db, target)));
  assert.deepEqual(merged.titlesState.unlocked.sort(), ['account-title', 'guest-title']);
  assert.deepEqual((await getDocs(words(userDb, target))).docs.map(row => row.data().meaning).sort(), ['ضفة', 'مصرف']);
  assert.equal((await getDoc(doc(userDb, dest + '/customWorlds/private-study/words/private-word'))).data().userId, target.uid);
  const savedMastery = (await getDoc(doc(userDb, dest + '/meta/word_mastery'))).data().entries;
  assert.equal(savedMastery.bank.last_recalled_at, past.getTime());
  assert.equal(savedMastery.bank.mastery_status, 'Reviewing');
  assert.equal(savedMastery.river.mastery_status, 'Learning');
  assert.equal((await getDoc(doc(userDb, gateProgress(dest, 'first')))).data().status, 'cleared');
  const migratedLesson = (await getDoc(doc(userDb, gateProgress(dest, 'second') + '/lesson/progress'))).data();
  assert.equal(migratedLesson.version, 2);
  assert.deepEqual(migratedLesson.completedWordIds, ['term']);
  assert.deepEqual(migratedLesson.legacyCompletedIds, ['term']);
  const importedRepair = lesson.upgrade((await getDoc(doc(userDb, gateProgress(dest, 'first') + '/lesson/progress'))).data());
  assert.deepEqual(importedRepair.study.hinted, ['term']);
  assert.equal(importedRepair.study.applications.term, 'assisted');
  assert.equal(importedRepair.study.misses.term, 'revealed');
  assert.equal(lesson.stepAt(repairPlan, importedRepair).phase, 'reinforce');
  await denied(getDoc(doc(outsider.db, gateProgress(dest, 'first') + '/lesson/progress')));
  assert.equal((await getDoc(doc(userDb, dest + '/contentProgress/' + worldId))).data().activeGateId, 'second');
  assert.equal((await getDoc(doc(userDb, dest + '/contentWords/bank/evidence/' + previousEvent))).data().occurredAt.toMillis(), past.getTime());
  assert.equal((await getDoc(doc(userDb, dest + '/contentWords/bank'))).data().eligibleEvidenceCount, 2);
  assert.equal((await getDoc(permit(userDb, target.uid))).exists(), false);
  await denied(setDoc(permit(userDb, target.uid), { sourceUid: guest.uid, startedAt: serverTimestamp() }));
  assert.equal((await auth.continueAsTarget(retry)).uid, target.uid);
  assert.equal((await auth.restore()).uid, guest.uid);
  assert.equal((await admin.doc(source + '/meta/profile').get()).data().userXP, 5000);

  // Use the release Journey module to earn the remaining review and clear the
  // imported gate under normal Rules, after the import permit is gone.
  const app = account.auth.app;
  const fixture = {
    getPublishedWorld: async () => ({ worldId, version: 1 }),
    getPublishedRank: async () => ({ ...base, worldId, rankId, cefrLevel: 'A1', order: 0 }),
    listPublishedRanks: async () => [{ ...base, worldId, rankId, cefrLevel: 'A1', order: 0 }],
    getPublishedGate: async (_world, _rank, id) => gates.find(gate => gate.gateId === id),
    listPublishedGates: async () => gates,
    listAllPublishedGateWords: async (_w, _r, id) => id === 'second' ? [content] : [],
  };
  const window = { LootLinguaPublishedContent: fixture, addEventListener() {}, dispatchEvent() {} };
  const env = { window, document: { readyState: 'loading' }, getApps: () => [app], ...sdk, ...firestore };
  for (const name of ['content-schema', 'journey', 'learning-evidence', 'word-lifecycle', 'gate-clear', 'gate-lesson', 'placement', 'level-placement', 'journey-cloud']) {
    const code = readFileSync(new URL('../js/' + name + '.js', import.meta.url), 'utf8').replace(/^import\s+[^;]+;\s*/gm, '');
    new Function(...Object.keys(env), code)(...Object.values(env));
  }
  const runtime = window.LootLinguaJourneyCloud;
  const current = (await getDoc(doc(userDb, dest + '/contentWords/bank'))).data();
  const reviewInput = { sessionId: 'verified-after-merge', mode, source: 'journey:test', completed: true,
    officialReviewGate: { worldId, rankId, gateId: 'second' }, officialReviewDueWordKeys: ['bank'], timezoneOffsetMinutes: 0,
    entries: [{ word: { ...content, wordKey: 'bank' }, result: { correct: true, answeredAt: Date.now(), submittedAnswer: current.legacyWordId } }] };
  const saved = await runtime.recordQuizEvidenceBatch(reviewInput);
  assert.equal(saved.recorded, 1);
  assert.equal(saved.readinessError, null);
  assert.equal((await runtime.recordQuizEvidenceBatch(reviewInput)).duplicate, 1);
  assert.equal((await runtime.getGateProgress(worldId, rankId, 'second', { force: true })).status, 'ready');
  const attempt = await runtime.startGateClearAttempt(worldId, rankId, 'second');
  const cleared = await runtime.answerGateClearQuestion(worldId, rankId, 'second', attempt.attempt.attemptId, 'term');
  assert.equal(cleared.result.result.passed, true);
  assert.equal((await runtime.getActiveJourney({ force: true })).activeGateId, 'third');
});


test('full merge deduplicates proven reward receipts and carries consumed shop rewards forward', { skip }, async (t) => {
  const { main, auth } = controller(t);
  const account = client(t);
  const target = await register(account.auth, 'reward-destination');
  const guest = (await sdk.signInAnonymously(main.auth)).user;
  const merge = createGuestProgressMerge({ firestore, getDatabase: auth => firestore.getFirestore(auth.app), assertCurrent: auth.assertCurrent });
  const sharedId = 'xp_event_word_transition:bank:reviewing_mastered';
  const countedId = 'xp_event_motivation_' + 'a'.repeat(64);
  const rewardedId = 'xp_event_motivation_' + 'b'.repeat(64);
  const consumedId = 'xp_event_profile_sync_v1_' + encodeURIComponent('extra-consumed:award:mastery:10');
  const xpReceipt = { amount: 8, reason: 'word_mastered_first', xpEconomyVersion: 2, createdAt: serverTimestamp() };
  const mine = (db, user, key) => doc(db, 'users', user.uid, 'meta', key);
  await Promise.all([
    setDoc(profile(main.db, guest), { userXP: 40, runnerCoins: 4, extraChests: [
      { id: 'award:mastery:10', kind: 'mastery', readyAt: Date.now(), slot: 0 },
    ] }),
    setDoc(profile(account.db, target), { userXP: 70, runnerCoins: 5 }),
    setDoc(doc(words(main.db, guest), 'legacy-mastery'), word(guest.uid, 'glass', 'زجاج', {
      mastery_status: 'Mastered', mastery_streak: 3, mastered_once: true, last_recalled_at: 100,
    })),
    setDoc(doc(words(account.db, target), 'legacy-mastery'), word(target.uid, 'earth', 'أرض', {
      mastery_status: 'Reviewing', mastery_streak: 2, last_recalled_at: 200,
    })),
    setDoc(mine(main.db, guest, sharedId), xpReceipt),
    setDoc(mine(account.db, target, sharedId), xpReceipt),
    setDoc(mine(account.db, target, consumedId), { type: 'profile-extra-consumed-v1', createdAt: serverTimestamp() }),
    setDoc(mine(main.db, guest, countedId), { reason: 'motivation_gate_counted', amount: 0, createdAt: serverTimestamp() }),
    setDoc(mine(main.db, guest, rewardedId), { reason: 'motivation_milestone', amount: 20, at: Date.now(), rewardId: 'mastery:10', createdAt: serverTimestamp() }),
  ]);
  const selection = await auth.selectEmail(target.email, password);
  const plan = await merge.preview(selection, main.auth);
  assert.equal(plan.finalXP, 102);
  await merge.commit(plan);
  const saved = (await getDoc(profile(account.db, target))).data();
  assert.equal(saved.userXP, 102);
  assert.equal(saved.runnerCoins, 9);
  assert.deepEqual(saved.extraChests, []);
  const legacy = (await getDoc(mine(account.db, target, 'word_mastery'))).data().entries;
  assert.equal(legacy.glass.mastery_status, 'Mastered');
  assert.equal(legacy.glass.last_recalled_at, 100);
  assert.equal(legacy.earth.mastery_status, 'Reviewing');
  assert.equal((await getDoc(mine(account.db, target, rewardedId))).data().amount, 20);
  await denied(updateDoc(mine(account.db, target, rewardedId), { amount: 25 }));
});
