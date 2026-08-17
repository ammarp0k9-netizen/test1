'use strict';

const { createHash } = require('node:crypto');

const APP_VERSION = '2026.08';
const GUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const GUEST_MAX_SUBMISSIONS = 2;
const guestAttempts = new Map();

function feedbackError(HttpsError, code, message) {
  return new HttpsError(code, message);
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function validatedPayload(value, HttpsError) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (!Object.keys(source).every((key) => ['rating', 'message', 'optionalName'].includes(key))) {
    throw feedbackError(HttpsError, 'invalid-argument', 'Unsupported feedback fields.');
  }
  const rating = Number(source.rating);
  const message = cleanText(source.message, 1600);
  const optionalName = cleanText(source.optionalName, 80);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw feedbackError(HttpsError, 'invalid-argument', 'Rating must be between 1 and 5.');
  }
  return { rating, message, optionalName };
}

function guestAttemptKey(request) {
  const ip = String(request.rawRequest?.ip || request.rawRequest?.headers?.['x-forwarded-for'] || 'unknown')
    .split(',')[0]
    .trim();
  return createHash('sha256').update(ip).digest('hex');
}

function assertGuestRateLimit(request, HttpsError, now) {
  const key = guestAttemptKey(request);
  const attempts = (guestAttempts.get(key) || []).filter((at) => now - at < GUEST_WINDOW_MS);
  if (attempts.length >= GUEST_MAX_SUBMISSIONS) {
    throw feedbackError(HttpsError, 'resource-exhausted', 'Please try again later.');
  }
  attempts.push(now);
  guestAttempts.set(key, attempts);
}

async function accountSnapshot(db, uid) {
  const user = db.collection('users').doc(uid);
  const [profileSnapshot, journeysSnapshot, quizzesSnapshot] = await Promise.all([
    user.collection('meta').doc('profile').get(),
    user.collection('contentProgress').get(),
    user.collection('quizEvidenceSessions').count().get(),
  ]);
  const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
  const journeys = journeysSnapshot.docs.map((snapshot) => snapshot.data() || {});
  const completedWorlds = journeys.filter((journey) => journey.contentJourneyStatus === 'completed-current-content').length;
  const completedRanks = new Set(journeys.flatMap((journey) => journey.passedCefrLevels || [])).size;
  const completedGates = new Set(journeys.flatMap((journey) => journey.levelPlacementClearedGateIds || [])).size;
  return {
    accountType: 'account', uid,
    currentXP: Math.max(0, Number(profile.userXP) || 0),
    progression: { completedWorlds, completedRanks, completedGates },
    trustedQuizCount: Math.max(0, Number(quizzesSnapshot.data().count) || 0),
    accountCreatedAt: profile.createdAt || null,
    appVersion: APP_VERSION,
  };
}

function guestSnapshot() {
  return { accountType: 'guest', appVersion: APP_VERSION };
}

function createSubmitFeedbackHandler({ db, FieldValue, HttpsError, makeId, now = () => Date.now() }) {
  return async (request) => {
    const payload = validatedPayload(request.data, HttpsError);
    const timestamp = now();
    const uid = String(request.auth?.uid || '');
    if (!uid) assertGuestRateLimit(request, HttpsError, timestamp);
    const metadata = uid ? await accountSnapshot(db, uid) : guestSnapshot();
    const ref = db.collection('feedback').doc(makeId());
    await ref.create({
      schemaVersion: 1,
      rating: payload.rating,
      message: payload.message,
      optionalName: payload.optionalName,
      metadata,
      submittedAt: FieldValue.serverTimestamp(),
    });
    return { accepted: true, id: ref.id };
  };
}

module.exports = { createSubmitFeedbackHandler, validatedPayload, guestSnapshot };
