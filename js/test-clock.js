import { getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const contract = window.LootLinguaTestClockContract;
const CLOCK_VERSION = contract.CLOCK_VERSION;
const MAX_OFFSET_MS = contract.MAX_OFFSET_MS;
const app = getApps()[0] || null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

let unsubscribe = null;
let state = Object.freeze({
  authorized: false,
  loaded: false,
  uid: '',
  offsetMs: 0,
  errorCode: '',
});

const { clampOffset, computeEffectiveNow } = contract;

function realNow() {
  return Date.now();
}

function effectiveNow() {
  return computeEffectiveNow(realNow(), state.offsetMs, state.authorized);
}

function publicState() {
  const currentRealTime = realNow();
  return {
    ...state,
    realNow: currentRealTime,
    effectiveNow: computeEffectiveNow(currentRealTime, state.offsetMs, state.authorized),
    active: Boolean(state.authorized && state.offsetMs !== 0),
  };
}

function renderBanner() {
  const banner = document.getElementById('testClockBanner');
  if (!banner) return;
  const snapshot = publicState();
  banner.hidden = !snapshot.active;
  document.body.classList.toggle('test-clock-active', snapshot.active);
  if (!snapshot.active) return;
  const direction = snapshot.offsetMs >= 0 ? '+' : '−';
  const totalMinutes = Math.round(Math.abs(snapshot.offsetMs) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? `${days} يوم` : '',
    hours ? `${hours} ساعة` : '',
    minutes ? `${minutes} دقيقة` : '',
  ].filter(Boolean).join(' و') || 'أقل من دقيقة';
  banner.textContent = `وضع الزمن التجريبي مفعّل (${direction}${parts}) — لا يغيّر وقت الخادم أو المكافآت.`;
}

function emit(next) {
  state = Object.freeze({
    authorized: Boolean(next.authorized),
    loaded: Boolean(next.loaded),
    uid: String(next.uid || ''),
    offsetMs: next.authorized ? clampOffset(next.offsetMs) : 0,
    errorCode: String(next.errorCode || ''),
  });
  renderBanner();
  window.dispatchEvent(new CustomEvent('lootlingua:test-clock-changed', {
    detail: publicState(),
  }));
}

function stopSubscription() {
  if (typeof unsubscribe === 'function') unsubscribe();
  unsubscribe = null;
}

function clockRef(uid) {
  return doc(db, 'users', uid, 'testSettings', 'clock');
}

function syncAuthorization() {
  const access = window.getLootLinguaAdminState?.() || {};
  const uid = String(auth?.currentUser?.uid || '');
  const authorized = Boolean(
    db && uid && access.resolved && access.isAdmin && access.canUseTestClock &&
    String(access.uid || '') === uid
  );
  if (!authorized) {
    stopSubscription();
    emit({ authorized: false, loaded: Boolean(access.resolved), uid, offsetMs: 0 });
    return;
  }
  if (state.authorized && state.uid === uid && unsubscribe) return;
  stopSubscription();
  emit({ authorized: true, loaded: false, uid, offsetMs: 0 });
  unsubscribe = onSnapshot(clockRef(uid), (snapshot) => {
    const data = snapshot.data() || {};
    emit({
      authorized: true,
      loaded: true,
      uid,
      offsetMs: snapshot.exists() && Number(data.version) === CLOCK_VERSION
        ? data.offsetMs
        : 0,
    });
  }, (error) => {
    emit({
      authorized: true,
      loaded: true,
      uid,
      offsetMs: 0,
      errorCode: error?.code || 'test-clock/read-failed',
    });
  });
}

async function setOffsetMs(value) {
  syncAuthorization();
  const current = publicState();
  const uid = String(auth?.currentUser?.uid || '');
  if (!current.authorized || current.uid !== uid) {
    const error = new Error('test-clock/permission-denied');
    error.code = 'test-clock/permission-denied';
    throw error;
  }
  const offsetMs = clampOffset(value);
  await setDoc(clockRef(uid), {
    version: CLOCK_VERSION,
    offsetMs,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  return offsetMs;
}

async function advanceBy(deltaMs) {
  return setOffsetMs(state.offsetMs + Math.trunc(Number(deltaMs) || 0));
}

async function setEffectiveDate(value) {
  const target = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  if (!Number.isFinite(target)) {
    const error = new Error('test-clock/invalid-date');
    error.code = 'test-clock/invalid-date';
    throw error;
  }
  return setOffsetMs(target - realNow());
}

async function reset() {
  return setOffsetMs(0);
}

function ensureBanner() {
  if (document.getElementById('testClockBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'testClockBanner';
  banner.className = 'test-clock-banner';
  banner.setAttribute('role', 'status');
  banner.hidden = true;
  document.body.append(banner);
  renderBanner();
}

const API = Object.freeze({
  CLOCK_VERSION,
  MAX_OFFSET_MS,
  clampOffset,
  computeEffectiveNow,
  realNow,
  effectiveNow,
  getState: publicState,
  setOffsetMs,
  advanceBy,
  setEffectiveDate,
  reset,
});

Object.defineProperty(window, 'LootLinguaTestClock', {
  value: API,
  configurable: false,
  enumerable: true,
  writable: false,
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureBanner, { once: true });
} else {
  ensureBanner();
}

window.addEventListener('lootlingua:admin-state', syncAuthorization);
window.addEventListener('lootlingua:auth-state', syncAuthorization);
queueMicrotask(syncAuthorization);
