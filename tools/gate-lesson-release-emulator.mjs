import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const projectId = 'demo-lootlingua';
const loopback = /^127\.0\.0\.1:\d+$/;
const verifiedModes = ['timeAttack', 'scramble', 'matching'];

function before(left, right) {
  return Boolean(left && right && (left.seconds < right.seconds ||
    (left.seconds === right.seconds && left.nanoseconds < right.nanoseconds)));
}

function draftGate(draft) {
  const pattern = /^(journey|gate-gap):([^~]+)~([^~]+)~([^~]+)$/;
  const encoded = pattern.exec(draft.source || '');
  const fromSource = encoded && { worldId: encoded[2], rankId: encoded[3], gateId: encoded[4] };
  const flat = draft.journeyGateId && { worldId: draft.journeyWorldId, rankId: draft.journeyRankId, gateId: draft.journeyGateId };
  const scopes = [flat, fromSource, draft.officialReviewGate].filter(Boolean);
  if (!scopes.length) return null;
  const fields = ['worldId', 'rankId', 'gateId'];
  const context = Object.fromEntries(fields.map(field => [field, scopes[0][field]]));
  return scopes.every(scope => fields.every(field => typeof scope[field] === 'string' &&
    /^[^/~]{1,128}$/.test(scope[field]) && scope[field] === context[field])) ? context : null;
}

export function gateLessonEmulatorRelease(app) {
  if (app?.options?.projectId !== projectId || !loopback.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
      !loopback.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) {
    throw new Error('Release rehearsal requires demo-lootlingua and both loopback emulators.');
  }
  const db = getFirestore(app);
  const release = db.doc('releaseConfig/gateLesson');

  const beginCapture = () => release.create({ captureStartedAt: FieldValue.serverTimestamp() });

  async function captureDraft(uid) {
    if (typeof uid !== 'string' || !/^[^/]{1,128}$/.test(uid)) throw new TypeError('Expected an owner UID.');
    const meta = db.collection('users').doc(uid).collection('meta');
    const draftRef = meta.doc('active_quiz_session');
    const sealRef = meta.doc('legacy_gate_quiz');
    return db.runTransaction(async tx => {
      const [config, draft, existing] = await Promise.all([tx.get(release), tx.get(draftRef), tx.get(sealRef)]);
      const { captureStartedAt, activatedAt } = config.data() || {};
      if (!captureStartedAt || activatedAt) throw new Error('The capture window is closed.');
      if (!draft.exists || !before(draft.updateTime, captureStartedAt)) return false;
      const state = draft.data();
      const context = draftGate(state);
      const words = state.words;
      if (!context || typeof state.id !== 'string' || !state.id || !verifiedModes.includes(state.mode) ||
          !Array.isArray(words) || !words.length || state.completedAt || state.finishedAt) return false;
      const runtimeCount = state.runtimeWords?.length || words.length;
      const index = Math.max(0, Number(state.quizIndex) || 0);
      if (index >= runtimeCount && !(index === runtimeCount && state.quizSessionResults?.length)) return false;
      const keys = words.map(word => word.wordKey);
      const due = state.officialReviewDueWordKeys || [];
      if (!keys.every(key => typeof key === 'string' && key.length > 0) ||
          new Set(keys).size !== keys.length || !Array.isArray(due) || !due.every(key => keys.includes(key))) return false;
      const { worldId, rankId, gateId } = context;
      const path = 'contentProgress/' + worldId + '/ranks/' + rankId + '/gates/' + gateId;
      const ownerGate = await tx.get(db.doc('users/' + uid + '/' + path));
      const published = await tx.get(db.doc('content_worlds/' + worldId + '/ranks/' + rankId + '/gates/' + gateId));
      const progress = ownerGate.data();
      if (published.data()?.status !== 'published' || !progress?.loadedAt ||
          !keys.every(key => progress.loadedWordKeys?.includes(key))) return false;
      if (existing.exists) {
        if (existing.data().sessionId !== state.id || !existing.data().capturedAt?.isEqual(draft.updateTime)) {
          throw new Error('A different legacy draft was already sealed.');
        }
        return true;
      }
      tx.create(sealRef, { ...context, sessionId: state.id, mode: state.mode, source: state.source || '',
        officialReviewGate: state.officialReviewGate || null, words, wordKeys: keys, dueWordKeys: due, capturedAt: draft.updateTime });
      return true;
    });
  }

  function activate() {
    return db.runTransaction(async tx => {
      const config = (await tx.get(release)).data();
      if (!config?.captureStartedAt) throw new Error('Start the capture window first.');
      if (!config.activatedAt) tx.update(release, { activatedAt: FieldValue.serverTimestamp() });
    });
  }

  return Object.freeze({ beginCapture, captureDraft, activate });
}
