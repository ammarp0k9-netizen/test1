import { AUTH_MODES } from './auth-controller.js';
import { createAuthSurface } from './auth-surface.js';

const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyDQB5N4wxJw69-tb8suI2T2SfEfCpwFA2c',
  authDomain: 'quizapp-ede17.firebaseapp.com',
  projectId: 'quizapp-ede17',
  storageBucket: 'quizapp-ede17.firebasestorage.app',
  messagingSenderId: '473471031803',
  appId: '1:473471031803:web:1b803237aeb0444040535e',
  measurementId: 'G-C06S6C7JYT',
});

const FIREBASE_APP_MODULE = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
const FIREBASE_AUTH_MODULE = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
const LANDING_REDIRECT_PENDING_KEY = 'lootlinguaLandingLoginRedirectPending';
const authRoot = document.querySelector('[data-auth-dialog]');

function projectBasePath() {
  if (!location.hostname.endsWith('.github.io')) return '';
  const segments = location.pathname.split('/').filter(Boolean);
  return segments.length ? `/${segments[0]}` : '';
}

function internalPath(pathname) {
  return `${projectBasePath()}/${String(pathname || '').replace(/^\/+/, '')}`;
}

function appUrl() {
  return new URL(internalPath('/app'), location.origin);
}

function privacyUrl() {
  const pathname = location.hostname.endsWith('.github.io') ? '/privacy.html' : '/privacy';
  return new URL(internalPath(pathname), location.origin);
}

function syncInternalLinks() {
  document.querySelectorAll('[data-app-link]').forEach((link) => { link.href = appUrl().href; });
  document.querySelectorAll('[data-privacy-link]').forEach((link) => { link.href = privacyUrl().href; });
}

function goToApp() {
  const target = appUrl();
  if (target.origin !== location.origin) return;
  location.assign(target.href);
}

function renderLandingAuthState(state) {
  const user = state.user || null;
  const resolved = state.authResolved === true;
  document.body.dataset.authState = user ? 'user' : (resolved ? 'guest' : 'pending');
  document.querySelectorAll('[data-journey-label]').forEach((label) => {
    label.textContent = user ? 'تابع رحلتك' : (resolved ? 'ابدأ رحلتك' : 'فتح التطبيق');
  });
  document.querySelectorAll('[data-user-only]').forEach((node) => { node.hidden = !user; });
  document.querySelectorAll('[data-guest-only]').forEach((node) => { node.hidden = Boolean(user); });
  document.querySelectorAll('[data-auth-open]').forEach((button) => {
    button.hidden = Boolean(user);
    button.disabled = !resolved || state.busy;
  });
  const inlineStatus = document.querySelector('[data-auth-inline-status]');
  if (inlineStatus) inlineStatus.textContent = !state.open && state.tone === 'error' ? state.message : '';
}

function isIOSDevice() {
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function createFirebaseGateway() {
  const [appSdk, authSdk] = await Promise.all([import(FIREBASE_APP_MODULE), import(FIREBASE_AUTH_MODULE)]);
  const app = appSdk.getApps()[0] || appSdk.initializeApp(FIREBASE_CONFIG);
  const auth = authSdk.getAuth(app);
  auth.useDeviceLanguage();
  return Object.freeze({
    observeAuth: (callback) => authSdk.onAuthStateChanged(auth, callback),
    currentUser: () => auth.currentUser,
    hasPendingRedirect: () => sessionStorage.getItem(LANDING_REDIRECT_PENDING_KEY) === '1',
    clearPendingRedirect: () => sessionStorage.removeItem(LANDING_REDIRECT_PENDING_KEY),
    finishRedirect: async () => {
      const wasPending = sessionStorage.getItem(LANDING_REDIRECT_PENDING_KEY) === '1';
      const result = await authSdk.getRedirectResult(auth);
      return result?.user || (wasPending && auth.currentUser) ? { user: result?.user || auth.currentUser } : null;
    },
    signInWithGoogle: async () => {
      const provider = new authSdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (isIOSDevice()) {
        sessionStorage.setItem(LANDING_REDIRECT_PENDING_KEY, '1');
        await authSdk.signInWithRedirect(auth, provider);
        return { redirecting: true };
      }
      return authSdk.signInWithPopup(auth, provider);
    },
    signIn: (email, password) => authSdk.signInWithEmailAndPassword(auth, email, password),
    createAccount: (email, password) => authSdk.createUserWithEmailAndPassword(auth, email, password),
    sendPasswordReset: (email) => authSdk.sendPasswordResetEmail(auth, email),
  });
}

function unavailableGateway() {
  const unavailable = () => Promise.reject(Object.assign(new Error('auth-unavailable'), { code: 'auth/network-request-failed' }));
  return Object.freeze({
    observeAuth(callback) { queueMicrotask(() => callback(null)); return () => {}; },
    currentUser: () => null,
    hasPendingRedirect: () => false,
    clearPendingRedirect: () => sessionStorage.removeItem(LANDING_REDIRECT_PENDING_KEY),
    finishRedirect: async () => null,
    signInWithGoogle: unavailable,
    signIn: unavailable,
    createAccount: unavailable,
    sendPasswordReset: unavailable,
  });
}

async function initializeAuth() {
  let gateway;
  try {
    gateway = await createFirebaseGateway();
    document.body.dataset.authProvider = 'firebase';
  } catch (_) {
    gateway = unavailableGateway();
    document.body.dataset.authProvider = 'offline';
  }
  const authSurface = createAuthSurface({
    root: authRoot,
    triggerRoot: document,
    gateway,
    onAuthenticated: goToApp,
    onStateChange: renderLandingAuthState,
  });
  window.__lootlinguaLandingAuth = authSurface;
  const requestedMode = new URLSearchParams(location.search).get('auth');
  if (Object.values(AUTH_MODES).includes(requestedMode)) authSurface.open(requestedMode);
  await authSurface.initialize();
}

function bindPreviewInteractions() {
  const contextToggle = document.querySelector('[data-context-toggle]');
  const contextResult = document.getElementById('previewGamerMeaning');
  contextToggle?.addEventListener('click', () => {
    const expanded = contextToggle.getAttribute('aria-expanded') !== 'false';
    contextToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    contextResult?.classList.toggle('is-collapsed', expanded);
  });

  const reviewCard = document.querySelector('[data-review-card]');
  reviewCard?.addEventListener('click', () => {
    const flipped = reviewCard.classList.toggle('is-flipped');
    reviewCard.setAttribute('aria-pressed', flipped ? 'true' : 'false');
    reviewCard.setAttribute('aria-label', flipped ? 'اقلب البطاقة لإظهار الكلمة' : 'اقلب البطاقة لإظهار المعنى');
  });
  document.querySelectorAll('.quiz-controls [aria-disabled="true"]').forEach((button) => {
    button.addEventListener('click', (event) => event.preventDefault());
  });
}

function initializeReveals() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || !('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'));
    return;
  }
  document.documentElement.classList.add('enhanced');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: .12 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
}

syncInternalLinks();
bindPreviewInteractions();
initializeReveals();
document.querySelectorAll('[data-current-year]').forEach((node) => { node.textContent = String(new Date().getFullYear()); });
renderLandingAuthState({ authResolved: false, user: null, open: false, busy: false, message: '', tone: '' });
initializeAuth();
