import { getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const app = getApps()[0];
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

function contract() {
  if (!window.LootLinguaGuidedFirstJourneyContract) throw new Error('guided/contract-unavailable');
  return window.LootLinguaGuidedFirstJourneyContract;
}

function ref(uid) {
  return doc(db, 'users', uid, 'guidedFirstJourneys', `v${contract().VERSION}`);
}

function requireUser(expected) {
  const user = auth?.currentUser;
  if (!user || (expected?.uid && user.uid !== expected.uid)) throw new Error('guided/auth-changed');
  return user;
}

function payload(state) {
  const normalized = contract().normalize(state);
  if (!normalized) throw new Error('guided/invalid-state');
  return {
    version: normalized.version,
    audience: normalized.audience,
    phase: normalized.phase,
    worldId: normalized.worldId,
    gateId: normalized.gateId,
    guestDictionaryAvailable: normalized.guestDictionaryAvailable === true,
    startedAt: normalized.startedAt ? new Date(normalized.startedAt) : serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: normalized.completedAt ? new Date(normalized.completedAt) : null,
  };
}

async function load(user) {
  if (!db) throw new Error('guided/storage-unavailable');
  const current = requireUser(user);
  const snapshot = await getDoc(ref(current.uid));
  return snapshot.exists() ? contract().normalize(snapshot.data()) : null;
}

async function save(state, user) {
  if (!db) throw new Error('guided/storage-unavailable');
  const current = requireUser(user);
  await setDoc(ref(current.uid), payload(state));
  return state;
}

Object.defineProperty(window, 'LootLinguaGuidedFirstJourneyCloud', {
  value: Object.freeze({ load, save }), configurable: false, writable: false,
});
window.dispatchEvent(new CustomEvent('lootlingua:guided-first-journey-cloud-ready'));
