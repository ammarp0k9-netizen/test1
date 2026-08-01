import { getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  Timestamp,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const app = getApps()[0];
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

function contract() {
  const api = window.LootLinguaEntryExperience;
  if (!api) throw entryError('entry/contract-unavailable', 'Entry Experience contract is unavailable.');
  return api;
}

function entryError(code, message, cause) {
  const error = new Error(message || code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function requireUser(expectedUser) {
  const user = auth?.currentUser;
  if (!user || (expectedUser?.uid && expectedUser.uid !== user.uid)) {
    throw entryError('entry/auth-changed', 'Authentication changed while loading Entry Experience.');
  }
  return user;
}

function entryRef(uid) {
  return doc(db, 'users', uid, 'entryExperiences', `v${contract().EXPERIENCE_VERSION}`);
}

function timestampOrNull(value) {
  const millis = contract().timestampMillis(value);
  return millis ? Timestamp.fromMillis(millis) : null;
}

function cloudPayload(state) {
  const normalized = contract().normalizeEntryState(state);
  if (!normalized) throw entryError('entry/invalid-state', 'Entry Experience state is invalid.');
  return {
    contractVersion: normalized.contractVersion,
    experienceVersion: normalized.experienceVersion,
    status: normalized.status,
    audience: normalized.audience,
    classification: normalized.classification,
    currentStep: normalized.currentStep,
    interestsStatus: normalized.interestsStatus,
    interestIds: normalized.interestIds,
    themeStatus: normalized.themeStatus,
    themeId: normalized.themeId,
    oasisMode: normalized.oasisMode,
    themeExplicit: normalized.themeExplicit,
    actionStatus: normalized.actionStatus,
    source: normalized.source,
    startedAt: timestampOrNull(normalized.startedAt) || serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: normalized.status === 'completed'
      ? (timestampOrNull(normalized.completedAt) || serverTimestamp())
      : null,
    skippedAt: normalized.status === 'skipped'
      ? (timestampOrNull(normalized.skippedAt) || serverTimestamp())
      : null,
  };
}

async function load(user) {
  if (!db) throw entryError('entry/storage-unavailable', 'Entry Experience storage is unavailable.');
  const current = requireUser(user);
  try {
    const snapshot = await getDoc(entryRef(current.uid));
    requireUser(current);
    if (!snapshot.exists()) return { exists: false, state: null };
    const state = contract().normalizeEntryState(snapshot.data());
    return { exists: true, state };
  } catch (error) {
    if (error?.code === 'entry/auth-changed') throw error;
    throw entryError('entry/read-failed', 'Could not read Entry Experience.', error);
  }
}

async function save(state, user) {
  if (!db) throw entryError('entry/storage-unavailable', 'Entry Experience storage is unavailable.');
  const current = requireUser(user);
  try {
    await setDoc(entryRef(current.uid), cloudPayload(state));
    requireUser(current);
    return contract().normalizeEntryState({ ...state, updatedAt: Date.now() });
  } catch (error) {
    if (error?.code === 'entry/auth-changed') throw error;
    throw entryError('entry/write-failed', 'Could not save Entry Experience.', error);
  }
}

const API = Object.freeze({ load, save });

Object.defineProperty(window, 'LootLinguaEntryExperienceCloud', {
  value: API,
  configurable: false,
  enumerable: true,
  writable: false,
});

window.dispatchEvent(new CustomEvent('lootlingua:entry-cloud-ready'));
