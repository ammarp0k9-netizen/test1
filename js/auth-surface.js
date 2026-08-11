import { AUTH_MODES, createAuthController } from './auth-controller.js';

const COPY = Object.freeze({
  [AUTH_MODES.LOGIN]: {
    eyebrow: 'العودة إلى رحلتك',
    title: 'أهلًا بعودتك',
    intro: 'سجّل دخولك، وسنكمل من المكان المحفوظ في حسابك.',
    submit: 'تسجيل الدخول',
    switchText: 'ما عندك حساب؟',
    switchLabel: 'أنشئ حسابًا',
    switchMode: AUTH_MODES.SIGNUP,
  },
  [AUTH_MODES.SIGNUP]: {
    eyebrow: 'احفظ تقدّمك',
    title: 'أنشئ حسابك',
    intro: 'حساب واحد يحفظ كلماتك ورحلتك عندما تنتقل بين أجهزتك.',
    submit: 'إنشاء حساب',
    switchText: 'عندك حساب؟',
    switchLabel: 'سجّل الدخول',
    switchMode: AUTH_MODES.LOGIN,
  },
  [AUTH_MODES.RESET]: {
    eyebrow: 'استعادة الوصول',
    title: 'إعادة تعيين كلمة المرور',
    intro: 'اكتب بريدك، وسنرسل تعليمات الاستعادة إذا كان مرتبطًا بحساب.',
    submit: 'إرسال رابط الاستعادة',
    switchText: 'تذكّرت كلمة المرور؟',
    switchLabel: 'سجّل الدخول',
    switchMode: AUTH_MODES.LOGIN,
  },
});

export function createAuthSurface({
  root,
  triggerRoot = document,
  gateway,
  onAuthenticated = () => {},
  onStateChange = () => {},
  bodyClass = 'auth-dialog-open',
} = {}) {
  if (!root) throw new TypeError('Auth surface root is required.');

  const q = (selector) => root.querySelector(selector);
  const dialog = q('[role="dialog"]');
  const form = q('[data-auth-form]');
  const email = q('[data-auth-input="email"]');
  const password = q('[data-auth-input="password"]');
  const confirmation = q('[data-auth-input="confirmation"]');
  const passwordField = q('[data-password-field]');
  const confirmationField = q('[data-confirmation-field]');
  const forgot = q('[data-auth-mode="reset"]');
  const google = q('[data-auth-google]');
  const separator = q('[data-auth-provider-separator]');
  const submit = q('[data-auth-submit]');
  const switchWrap = q('[data-auth-switch-wrap]');
  const listeners = [];
  let controller;
  let returnFocus = null;

  function listen(node, type, handler, options) {
    if (!node) return;
    node.addEventListener(type, handler, options);
    listeners.push(() => node.removeEventListener(type, handler, options));
  }

  function clearPasswords() {
    [password, confirmation].forEach((input) => {
      if (!input) return;
      input.value = '';
      input.type = 'password';
    });
    root.querySelectorAll('[data-password-toggle]').forEach((button) => {
      button.textContent = 'إظهار';
      button.setAttribute('aria-pressed', 'false');
    });
  }

  function setOpen(open) {
    const wasOpen = !root.hidden;
    root.hidden = !open;
    document.body.classList.toggle(bodyClass, open);
    if (open && !wasOpen) {
      returnFocus = document.activeElement;
      requestAnimationFrame(() => email?.focus({ preventScroll: true }));
    } else if (!open && wasOpen) {
      clearPasswords();
      const target = returnFocus;
      returnFocus = null;
      if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
  }

  function render(state) {
    const copy = COPY[state.mode] || COPY.login;
    q('[data-auth-eyebrow]').textContent = copy.eyebrow;
    q('[data-auth-title]').textContent = copy.title;
    q('[data-auth-intro]').textContent = copy.intro;
    q('[data-auth-submit-label]').textContent = state.busy ? 'جارٍ التنفيذ…' : copy.submit;
    q('[data-google-label]').textContent = state.busy ? 'جارٍ فتح Google…' : 'المتابعة بحساب Google';
    q('[data-auth-switch-text]').textContent = copy.switchText;
    const switchButton = q('[data-auth-switch]');
    switchButton.textContent = copy.switchLabel;
    switchButton.dataset.authSwitch = copy.switchMode;

    const resetMode = state.mode === AUTH_MODES.RESET;
    const signupMode = state.mode === AUTH_MODES.SIGNUP;
    passwordField.hidden = resetMode;
    confirmationField.hidden = !signupMode;
    forgot.hidden = state.mode !== AUTH_MODES.LOGIN;
    google.hidden = resetMode;
    separator.hidden = resetMode;
    password.autocomplete = signupMode ? 'new-password' : 'current-password';
    confirmation.required = signupMode;

    root.querySelectorAll('[data-field-error]').forEach((node) => {
      const field = node.dataset.fieldError;
      const message = state.errors[field] || '';
      node.textContent = message;
      q(`[data-auth-input="${field}"]`)?.setAttribute('aria-invalid', message ? 'true' : 'false');
    });
    const message = q('[data-auth-message]');
    message.textContent = state.message || '';
    if (state.tone) message.dataset.tone = state.tone;
    else message.removeAttribute('data-tone');

    root.querySelectorAll('input, button').forEach((control) => {
      if (control.matches('[data-auth-close]')) return;
      control.disabled = state.busy || !state.authResolved;
    });
    setOpen(state.open);
    onStateChange(state);
  }

  controller = createAuthController({ gateway, onStateChange: render, onAuthenticated });

  triggerRoot.querySelectorAll('[data-auth-open]').forEach((button) => {
    listen(button, 'click', () => controller.open(button.dataset.authOpen || AUTH_MODES.LOGIN));
  });
  root.querySelectorAll('[data-auth-close]').forEach((button) => listen(button, 'click', () => controller.close()));
  listen(forgot, 'click', () => { clearPasswords(); controller.open(AUTH_MODES.RESET); });
  listen(google, 'click', () => controller.signInWithGoogle());
  listen(q('[data-auth-switch]'), 'click', (event) => {
    clearPasswords();
    controller.open(event.currentTarget.dataset.authSwitch || AUTH_MODES.LOGIN);
  });
  listen(form, 'submit', async (event) => {
    event.preventDefault();
    await controller.submit({ email: email.value, password: password.value, confirmation: confirmation.value });
    form.querySelector('[aria-invalid="true"]')?.focus();
  });
  root.querySelectorAll('[data-password-toggle]').forEach((button) => {
    listen(button, 'click', () => {
      const input = q(`[data-auth-input="${button.dataset.passwordToggle}"]`);
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.textContent = reveal ? 'إخفاء' : 'إظهار';
      button.setAttribute('aria-pressed', reveal ? 'true' : 'false');
    });
  });
  listen(document, 'keydown', (event) => {
    if (root.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      controller.close();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden]), [href]')]
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
  }, true);

  return Object.freeze({
    initialize: () => controller.initialize(),
    open: (mode) => controller.open(mode),
    close: () => controller.close(),
    getState: () => controller.getState(),
    destroy() {
      controller.destroy();
      listeners.splice(0).forEach((remove) => remove());
      document.body.classList.remove(bodyClass);
      clearPasswords();
    },
  });
}
