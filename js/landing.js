import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyDQB5N4wxJw69-tb8suI2T2SfEfCpwFA2c',
  authDomain: 'quizapp-ede17.firebaseapp.com',
  projectId: 'quizapp-ede17',
  storageBucket: 'quizapp-ede17.firebasestorage.app',
  messagingSenderId: '473471031803',
  appId: '1:473471031803:web:1b803237aeb0444040535e',
  measurementId: 'G-C06S6C7JYT',
});

const LANDING_REDIRECT_PENDING_KEY = 'lootlinguaLandingLoginRedirectPending';
const authButtons = [...document.querySelectorAll('[data-google-sign-in]')];
const authLabels = [...document.querySelectorAll('[data-auth-button-label]')];
const authStatus = document.querySelector('[data-auth-status]');
let authResolved = false;
let signInPending = false;
let signedInUser = null;

function projectBasePath() {
  if (!location.hostname.endsWith('.github.io')) return '';
  const segments = location.pathname.split('/').filter(Boolean);
  return segments.length ? `/${segments[0]}` : '';
}

function internalPath(pathname) {
  const normalized = `/${String(pathname || '').replace(/^\/+/, '')}`;
  return `${projectBasePath()}${normalized}`;
}

function appUrl() {
  return new URL(internalPath('/app'), location.origin);
}

function privacyUrl() {
  const pathname = location.hostname.endsWith('.github.io') ? '/privacy.html' : '/privacy';
  return new URL(internalPath(pathname), location.origin);
}

function syncInternalLinks() {
  document.querySelectorAll('[data-app-link]').forEach((link) => {
    link.href = appUrl().href;
  });
  document.querySelectorAll('[data-privacy-link]').forEach((link) => {
    link.href = privacyUrl().href;
  });
}

function goToApp() {
  const target = appUrl();
  if (target.origin !== location.origin) return;
  location.assign(target.href);
}

function setStatus(message, state = '') {
  if (!authStatus) return;
  authStatus.textContent = message;
  if (state) authStatus.dataset.state = state;
  else authStatus.removeAttribute('data-state');
}

function syncAuthUi() {
  const busy = !authResolved || signInPending;
  authButtons.forEach((button) => {
    button.disabled = busy;
    button.setAttribute('aria-busy', signInPending ? 'true' : 'false');
  });
  authLabels.forEach((label) => {
    const compactHeader = label.closest('.header-actions') && matchMedia('(max-width: 380px)').matches;
    label.textContent = signInPending
      ? (compactHeader ? 'جارٍ…' : 'جارٍ تسجيل الدخول…')
      : signedInUser
        ? (compactHeader ? 'التطبيق' : 'العودة إلى التطبيق')
        : (label.closest('.final-actions') ? 'تسجيل الدخول بـ Google' : (compactHeader ? 'دخول' : 'تسجيل الدخول'));
  });

  if (signInPending) {
    setStatus('جارٍ فتح تسجيل الدخول الآمن عبر Google…');
  } else if (!authResolved) {
    setStatus('جارٍ التحقق من حالة تسجيل الدخول…');
  } else if (signedInUser) {
    setStatus('أنت مسجّل الدخول بالفعل، ويمكنك متابعة تجربتك.', 'success');
  } else {
    setStatus('يمكنك المتابعة كضيف أو تسجيل الدخول لحفظ تجربتك.');
  }
}

function isIOSDevice() {
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function authErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'تم إغلاق تسجيل الدخول. بقيت في الصفحة ويمكنك المحاولة متى أردت.';
  }
  if (code === 'auth/network-request-failed') {
    return 'تعذّر الاتصال الآن. تحقق من الإنترنت ثم أعد المحاولة.';
  }
  if (code === 'auth/popup-blocked') {
    return 'منع المتصفح نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.';
  }
  return 'لم يكتمل تسجيل الدخول. يمكنك إعادة المحاولة من الزر نفسه.';
}

async function beginGoogleSignIn(auth) {
  if (signInPending) return;
  if (auth.currentUser) {
    goToApp();
    return;
  }

  signInPending = true;
  syncAuthUi();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    if (isIOSDevice()) {
      sessionStorage.setItem(LANDING_REDIRECT_PENDING_KEY, '1');
      await signInWithRedirect(auth, provider);
      return;
    }
    const result = await signInWithPopup(auth, provider);
    if (result?.user) goToApp();
  } catch (error) {
    sessionStorage.removeItem(LANDING_REDIRECT_PENDING_KEY);
    signInPending = false;
    syncAuthUi();
    setStatus(authErrorMessage(error), 'error');
  }
}

async function initializeLandingAuth() {
  const app = getApps()[0] || initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  auth.useDeviceLanguage();

  authButtons.forEach((button) => {
    button.addEventListener('click', () => beginGoogleSignIn(auth));
  });

  const redirectWasPending = sessionStorage.getItem(LANDING_REDIRECT_PENDING_KEY) === '1';
  if (redirectWasPending) {
    signInPending = true;
    syncAuthUi();
  }

  onAuthStateChanged(auth, (user) => {
    signedInUser = user || null;
    authResolved = true;
    if (!redirectWasPending) signInPending = false;
    syncAuthUi();
  });

  try {
    const result = await getRedirectResult(auth);
    sessionStorage.removeItem(LANDING_REDIRECT_PENDING_KEY);
    signInPending = false;
    if (result?.user || (redirectWasPending && auth.currentUser)) {
      goToApp();
      return;
    }
    syncAuthUi();
  } catch (error) {
    sessionStorage.removeItem(LANDING_REDIRECT_PENDING_KEY);
    signInPending = false;
    syncAuthUi();
    setStatus(authErrorMessage(error), 'error');
  }
}

syncInternalLinks();
document.querySelectorAll('[data-current-year]').forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});
syncAuthUi();
window.addEventListener('resize', syncAuthUi, { passive: true });

initializeLandingAuth().catch(() => {
  authResolved = true;
  signInPending = false;
  syncAuthUi();
  setStatus('تعذّر تجهيز تسجيل الدخول الآن، لكن يمكنك متابعة الاستكشاف كضيف.', 'error');
});
