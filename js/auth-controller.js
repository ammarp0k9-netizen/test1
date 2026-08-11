export const AUTH_MODES = Object.freeze({
  LOGIN: 'login',
  SIGNUP: 'signup',
  RESET: 'reset',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_RESET_MESSAGE = 'إذا كان البريد مرتبطًا بحساب، أرسلنا إليه رابطًا لإعادة تعيين كلمة المرور.';

function authCode(error) {
  return String(error?.code || '').trim();
}

export function authErrorMessage(error) {
  const code = authCode(error);
  if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(code)) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (code === 'auth/email-already-in-use') return 'يوجد حساب مرتبط بهذا البريد بالفعل.';
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
    return 'كلمة المرور لا تستوفي متطلبات الأمان. استخدم 6 أحرف على الأقل.';
  }
  if (code === 'auth/invalid-email') return 'تأكد من كتابة البريد الإلكتروني بشكل صحيح.';
  if (code === 'auth/network-request-failed') return 'تعذر الاتصال الآن. جرّب مرة أخرى.';
  if (code === 'auth/too-many-requests') return 'تكررت المحاولات بسرعة. انتظر قليلًا ثم جرّب مرة أخرى.';
  if (code === 'auth/user-disabled') return 'هذا الحساب غير متاح حاليًا.';
  if (code === 'auth/operation-not-allowed') return 'تسجيل الدخول بالبريد غير متاح الآن.';
  if (code === 'auth/popup-blocked') {
    return 'منع المتصفح نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة ثم جرّب مرة أخرى.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'أغلقت نافذة تسجيل الدخول. يمكنك المحاولة متى أردت.';
  }
  return 'لم تكتمل العملية. جرّب مرة أخرى.';
}

export function validateAuthFields(mode, fields = {}) {
  const email = String(fields.email || '').trim();
  const password = String(fields.password || '');
  const confirmation = String(fields.confirmation || '');
  const errors = {};

  if (!email) errors.email = 'أدخل بريدك الإلكتروني.';
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'تأكد من كتابة البريد الإلكتروني بشكل صحيح.';

  if (mode !== AUTH_MODES.RESET) {
    if (!password) errors.password = 'أدخل كلمة المرور.';
    else if (mode === AUTH_MODES.SIGNUP && password.length < 6) errors.password = 'استخدم 6 أحرف على الأقل.';
  }

  if (mode === AUTH_MODES.SIGNUP && password !== confirmation) {
    errors.confirmation = 'اكتب كلمة المرور نفسها في خانة التأكيد.';
  }

  return Object.freeze({
    valid: Object.keys(errors).length === 0,
    values: Object.freeze({ email, password, confirmation }),
    errors: Object.freeze(errors),
  });
}

function publicState(state) {
  return Object.freeze({ ...state, errors: Object.freeze({ ...state.errors }) });
}

export function createAuthController({ gateway, onStateChange, onAuthenticated = () => {} }) {
  if (!gateway || typeof onStateChange !== 'function' || typeof onAuthenticated !== 'function') {
    throw new TypeError('Auth controller dependencies are required.');
  }

  let redirectPending = false;
  let unsubscribe = null;
  let state = {
    authResolved: false,
    user: null,
    open: false,
    mode: AUTH_MODES.LOGIN,
    busy: false,
    message: '',
    tone: '',
    errors: {},
  };

  function emit(patch = {}) {
    state = { ...state, ...patch };
    onStateChange(publicState(state));
    return state;
  }

  const clearFeedback = () => ({ message: '', tone: '', errors: {} });

  function open(mode = AUTH_MODES.LOGIN) {
    if (state.busy) return false;
    const nextMode = Object.values(AUTH_MODES).includes(mode) ? mode : AUTH_MODES.LOGIN;
    emit({ open: true, mode: nextMode, ...clearFeedback() });
    return true;
  }

  function close() {
    if (state.busy) return false;
    emit({ open: false, mode: AUTH_MODES.LOGIN, ...clearFeedback() });
    return true;
  }

  async function completeAuthentication(user, source) {
    emit({ user: user || state.user, busy: false, open: false, ...clearFeedback() });
    await onAuthenticated(user || state.user, source);
  }

  async function initialize() {
    redirectPending = gateway.hasPendingRedirect?.() === true;
    if (redirectPending) emit({ busy: true });
    unsubscribe = gateway.observeAuth((user) => {
      emit({ authResolved: true, user: user || null, busy: redirectPending || state.busy });
    });
    try {
      const result = await gateway.finishRedirect?.();
      redirectPending = false;
      gateway.clearPendingRedirect?.();
      if (result?.user) await completeAuthentication(result.user, 'redirect');
      else emit({ busy: false });
    } catch (error) {
      redirectPending = false;
      gateway.clearPendingRedirect?.();
      emit({ busy: false, message: authErrorMessage(error), tone: 'error' });
    }
  }

  async function signInWithGoogle() {
    if (state.busy) return false;
    const existingUser = state.user || gateway.currentUser?.();
    if (existingUser) {
      await completeAuthentication(existingUser, 'existing');
      return true;
    }
    emit({ busy: true, ...clearFeedback() });
    try {
      const result = await gateway.signInWithGoogle();
      if (result?.redirecting) return true;
      if (result?.user) {
        await completeAuthentication(result.user, 'google');
        return true;
      }
      emit({ busy: false });
      return false;
    } catch (error) {
      gateway.clearPendingRedirect?.();
      emit({ busy: false, message: authErrorMessage(error), tone: 'error' });
      return false;
    }
  }

  async function submit(fields) {
    if (state.busy) return false;
    const validation = validateAuthFields(state.mode, fields);
    if (!validation.valid) {
      emit({ errors: validation.errors, message: '', tone: '' });
      return false;
    }

    if (state.mode === AUTH_MODES.RESET) {
      emit({ busy: true, ...clearFeedback() });
      try {
        await gateway.sendPasswordReset(validation.values.email);
        emit({ busy: false, message: SAFE_RESET_MESSAGE, tone: 'success' });
        return true;
      } catch (error) {
        if (authCode(error) === 'auth/user-not-found') {
          emit({ busy: false, message: SAFE_RESET_MESSAGE, tone: 'success' });
          return true;
        }
        emit({ busy: false, message: authErrorMessage(error), tone: 'error' });
        return false;
      }
    }

    emit({ busy: true, ...clearFeedback() });
    try {
      const result = state.mode === AUTH_MODES.SIGNUP
        ? await gateway.createAccount(validation.values.email, validation.values.password)
        : await gateway.signIn(validation.values.email, validation.values.password);
      if (result?.user) {
        await completeAuthentication(result.user, state.mode);
        return true;
      }
      emit({ busy: false, message: 'لم تكتمل العملية. جرّب مرة أخرى.', tone: 'error' });
      return false;
    } catch (error) {
      emit({ busy: false, message: authErrorMessage(error), tone: 'error' });
      return false;
    }
  }

  function destroy() {
    unsubscribe?.();
    unsubscribe = null;
  }

  emit();
  return Object.freeze({ initialize, open, close, submit, signInWithGoogle, destroy, getState: () => publicState(state) });
}

export { SAFE_RESET_MESSAGE };
