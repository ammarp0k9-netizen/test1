import {
  AUTH_MODES,
  createLandingAuthController,
} from './landing-auth-controller.js?v=20260811-1';

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

const dialogShell = document.querySelector('[data-auth-dialog]');
const dialog = dialogShell?.querySelector('.auth-dialog');
const authTitle = document.querySelector('[data-auth-title]');
const authEyebrow = document.querySelector('[data-auth-eyebrow]');
const authIntro = document.querySelector('[data-auth-intro]');
const authForm = document.querySelector('[data-auth-form]');
const emailInput = document.getElementById('authEmail');
const passwordInput = document.getElementById('authPassword');
const confirmationInput = document.getElementById('authConfirmation');
const passwordField = document.querySelector('[data-password-field]');
const confirmationField = document.querySelector('[data-confirmation-field]');
const forgotButton = document.querySelector('[data-auth-mode="reset"]');
const googleButton = document.querySelector('[data-auth-google]');
const googleLabel = document.querySelector('[data-google-label]');
const providerSeparator = document.querySelector('[data-auth-provider-separator]');
const submitButton = document.querySelector('[data-auth-submit]');
const submitLabel = document.querySelector('[data-auth-submit-label]');
const authMessage = document.querySelector('[data-auth-message]');
const authSwitchWrap = document.querySelector('[data-auth-switch-wrap]');
const inlineStatus = document.querySelector('[data-auth-inline-status]');

let controller = null;
let returnFocus = null;
let latestState = {
  authResolved: false,
  user: null,
  open: false,
  mode: AUTH_MODES.LOGIN,
  busy: false,
  message: '',
  tone: '',
  errors: {},
};

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

function modeCopy(mode) {
  if (mode === AUTH_MODES.SIGNUP) {
    return {
      eyebrow: 'احفظ تقدّمك',
      title: 'أنشئ حسابك',
      intro: 'حساب واحد يحفظ كلماتك ورحلتك عندما تنتقل بين أجهزتك.',
      submit: 'إنشاء حساب',
      switchHtml: 'عندك حساب؟ <button type="button" data-auth-switch="login">سجّل الدخول</button>',
    };
  }
  if (mode === AUTH_MODES.RESET) {
    return {
      eyebrow: 'استعادة الوصول',
      title: 'إعادة تعيين كلمة المرور',
      intro: 'اكتب بريدك، وسنرسل تعليمات الاستعادة إذا كان مرتبطًا بحساب.',
      submit: 'إرسال رابط الاستعادة',
      switchHtml: 'تذكّرت كلمة المرور؟ <button type="button" data-auth-switch="login">سجّل الدخول</button>',
    };
  }
  return {
    eyebrow: 'العودة إلى رحلتك',
    title: 'أهلًا بعودتك',
    intro: 'سجّل دخولك، وسنكمل من المكان المحفوظ في حسابك.',
    submit: 'تسجيل الدخول',
    switchHtml: 'ما عندك حساب؟ <button type="button" data-auth-switch="signup">أنشئ حسابًا</button>',
  };
}

function resetPasswordVisibility() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle || '');
    if (input) input.type = 'password';
    button.textContent = 'إظهار';
    button.setAttribute('aria-pressed', 'false');
  });
}

function clearPasswords() {
  if (passwordInput) passwordInput.value = '';
  if (confirmationInput) confirmationInput.value = '';
  resetPasswordVisibility();
}

function setFieldErrors(errors = {}) {
  document.querySelectorAll('[data-field-error]').forEach((node) => {
    const field = node.dataset.fieldError;
    const message = errors[field] || '';
    node.textContent = message;
    document.querySelector(`[name="${field}"]`)?.setAttribute('aria-invalid', message ? 'true' : 'false');
  });
}

function bindSwitchButton() {
  authSwitchWrap?.querySelector('[data-auth-switch]')?.addEventListener('click', (event) => {
    clearPasswords();
    openAuth(event.currentTarget.dataset.authSwitch || AUTH_MODES.LOGIN);
  });
}

function setDialogVisibility(open) {
  if (!dialogShell) return;
  const wasOpen = !dialogShell.hidden;
  dialogShell.hidden = !open;
  document.body.classList.toggle('auth-dialog-open', open);

  if (open && !wasOpen) {
    returnFocus = document.activeElement;
    requestAnimationFrame(() => emailInput?.focus({ preventScroll: true }));
  } else if (!open && wasOpen) {
    clearPasswords();
    const focusTarget = returnFocus;
    returnFocus = null;
    if (focusTarget?.isConnected) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }
}

function renderAuthState(state) {
  latestState = state;
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

  const copy = modeCopy(state.mode);
  if (authEyebrow) authEyebrow.textContent = copy.eyebrow;
  if (authTitle) authTitle.textContent = copy.title;
  if (authIntro) authIntro.textContent = copy.intro;
  if (submitLabel) submitLabel.textContent = state.busy ? 'جارٍ التنفيذ…' : copy.submit;
  if (googleLabel) googleLabel.textContent = state.busy ? 'جارٍ فتح Google…' : 'المتابعة بحساب Google';
  if (authSwitchWrap) {
    authSwitchWrap.innerHTML = copy.switchHtml;
    bindSwitchButton();
  }

  const resetMode = state.mode === AUTH_MODES.RESET;
  const signupMode = state.mode === AUTH_MODES.SIGNUP;
  if (passwordField) passwordField.hidden = resetMode;
  if (confirmationField) confirmationField.hidden = !signupMode;
  if (forgotButton) forgotButton.hidden = state.mode !== AUTH_MODES.LOGIN;
  if (googleButton) googleButton.hidden = resetMode;
  if (providerSeparator) providerSeparator.hidden = resetMode;
  if (passwordInput) passwordInput.autocomplete = signupMode ? 'new-password' : 'current-password';
  if (confirmationInput) confirmationInput.required = signupMode;

  const interactionBusy = state.busy || !resolved;
  [googleButton, submitButton].forEach((button) => {
    if (!button) return;
    button.disabled = interactionBusy;
    button.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  });
  authForm?.querySelectorAll('input, button').forEach((control) => {
    if (control === submitButton) return;
    control.disabled = interactionBusy;
  });
  authSwitchWrap?.querySelector('[data-auth-switch]')?.toggleAttribute('disabled', state.busy);

  setFieldErrors(state.errors);
  if (authMessage) {
    authMessage.textContent = state.message || '';
    if (state.tone) authMessage.dataset.tone = state.tone;
    else authMessage.removeAttribute('data-tone');
  }
  if (inlineStatus) {
    inlineStatus.textContent = !state.open && state.tone === 'error' ? state.message : '';
  }
  setDialogVisibility(state.open);
}

function openAuth(mode = AUTH_MODES.LOGIN) {
  if (controller) {
    controller.open(mode);
    return;
  }
  renderAuthState({ ...latestState, open: true, mode, message: '', tone: '', errors: {} });
}

function closeAuth() {
  if (controller) controller.close();
  else renderAuthState({ ...latestState, open: false, mode: AUTH_MODES.LOGIN, message: '', tone: '', errors: {} });
}

function isIOSDevice() {
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function createFirebaseGateway() {
  const [appSdk, authSdk] = await Promise.all([
    import(FIREBASE_APP_MODULE),
    import(FIREBASE_AUTH_MODULE),
  ]);
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
      return result?.user || (wasPending && auth.currentUser)
        ? { user: result?.user || auth.currentUser }
        : null;
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
    observeAuth(callback) {
      queueMicrotask(() => callback(null));
      return () => {};
    },
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
  const requestedMode = new URLSearchParams(location.search).get('auth');
  const initialMode = Object.values(AUTH_MODES).includes(requestedMode) ? requestedMode : null;
  let gateway;
  let authProvider = 'firebase';
  try {
    gateway = await createFirebaseGateway();
  } catch (_) {
    authProvider = 'offline';
    gateway = unavailableGateway();
  }
  document.body.dataset.authProvider = authProvider;

  const dialogWasOpened = latestState.open;
  const dialogMode = dialogWasOpened ? latestState.mode : initialMode;
  controller = createLandingAuthController({
    gateway,
    onStateChange: renderAuthState,
    navigateToApp: goToApp,
  });
  if (dialogMode) controller.open(dialogMode);
  await controller.initialize();
}

function trapDialogFocus(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeAuth();
    return;
  }
  if (event.key !== 'Tab' || !dialog || dialogShell?.hidden) return;
  const focusable = [...dialog.querySelectorAll('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden]), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.closest('[hidden]'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.querySelectorAll('[data-auth-open]').forEach((button) => {
  button.addEventListener('click', () => openAuth(button.dataset.authOpen || AUTH_MODES.LOGIN));
});
document.querySelectorAll('[data-auth-close]').forEach((button) => button.addEventListener('click', closeAuth));
forgotButton?.addEventListener('click', () => {
  clearPasswords();
  openAuth(AUTH_MODES.RESET);
});
googleButton?.addEventListener('click', () => controller?.signInWithGoogle());
authForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!controller) return;
  await controller.submit({
    email: emailInput?.value,
    password: passwordInput?.value,
    confirmation: confirmationInput?.value,
  });
  authForm.querySelector('[aria-invalid="true"]')?.focus();
});
document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle || '');
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'إخفاء' : 'إظهار';
    button.setAttribute('aria-pressed', reveal ? 'true' : 'false');
  });
});
document.addEventListener('keydown', trapDialogFocus, true);

syncInternalLinks();
document.querySelectorAll('[data-current-year]').forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});
renderAuthState(latestState);

if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('enhanced');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
} else {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'));
}

initializeAuth();
