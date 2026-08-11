import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_MODES,
  SAFE_RESET_MESSAGE,
  authErrorMessage,
  createLandingAuthController,
  validateAuthFields,
} from '../js/landing-auth-controller.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(overrides = {}) {
  const states = [];
  const navigation = [];
  let authObserver = () => {};
  const gateway = {
    observeAuth(callback) {
      authObserver = callback;
      callback(overrides.initialUser || null);
      return () => {};
    },
    currentUser: () => overrides.initialUser || null,
    hasPendingRedirect: () => false,
    clearPendingRedirect() {},
    finishRedirect: async () => null,
    signInWithGoogle: async () => ({ user: { uid: 'google-user' } }),
    signIn: async () => ({ user: { uid: 'login-user' } }),
    createAccount: async () => ({ user: { uid: 'signup-user' } }),
    sendPasswordReset: async () => undefined,
    ...overrides.gateway,
  };
  const controller = createLandingAuthController({
    gateway,
    onStateChange: (state) => states.push(state),
    navigateToApp: () => navigation.push('/app'),
  });
  return { controller, gateway, states, navigation, emitAuth: (user) => authObserver(user) };
}

test('Arabic Firebase errors do not expose technical codes', () => {
  const cases = new Map([
    ['auth/invalid-credential', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
    ['auth/email-already-in-use', 'يوجد حساب مرتبط بهذا البريد بالفعل.'],
    ['auth/weak-password', 'كلمة المرور لا تستوفي متطلبات الأمان. استخدم 6 أحرف على الأقل.'],
    ['auth/invalid-email', 'تأكد من كتابة البريد الإلكتروني بشكل صحيح.'],
    ['auth/network-request-failed', 'تعذر الاتصال الآن. جرّب مرة أخرى.'],
  ]);
  for (const [code, expected] of cases) {
    const message = authErrorMessage({ code });
    assert.equal(message, expected);
    assert.doesNotMatch(message, /auth\//);
  }
});

test('signup validates confirmation locally before any Firebase request', async () => {
  let createCalls = 0;
  const { controller, states } = harness({
    gateway: { createAccount: async () => { createCalls += 1; return { user: { uid: 'new' } }; } },
  });
  await controller.initialize();
  controller.open(AUTH_MODES.SIGNUP);
  const completed = await controller.submit({
    email: 'learner@example.com',
    password: 'secret7',
    confirmation: 'different',
  });
  assert.equal(completed, false);
  assert.equal(createCalls, 0);
  assert.equal(states.at(-1).errors.confirmation, 'اكتب كلمة المرور نفسها في خانة التأكيد.');
});

test('email signup and login navigate only after Firebase returns a user', async () => {
  const signup = harness();
  await signup.controller.initialize();
  signup.controller.open(AUTH_MODES.SIGNUP);
  assert.equal(await signup.controller.submit({ email: 'new@example.com', password: 'secret7', confirmation: 'secret7' }), true);
  assert.deepEqual(signup.navigation, ['/app']);

  const login = harness();
  await login.controller.initialize();
  login.controller.open(AUTH_MODES.LOGIN);
  assert.equal(await login.controller.submit({ email: 'old@example.com', password: 'secret7' }), true);
  assert.deepEqual(login.navigation, ['/app']);
});

test('busy state prevents a second login submission', async () => {
  const pending = deferred();
  let loginCalls = 0;
  const { controller, states, navigation } = harness({
    gateway: {
      signIn() {
        loginCalls += 1;
        return pending.promise;
      },
    },
  });
  await controller.initialize();
  controller.open(AUTH_MODES.LOGIN);
  const first = controller.submit({ email: 'user@example.com', password: 'secret7' });
  const second = controller.submit({ email: 'user@example.com', password: 'secret7' });
  assert.equal(loginCalls, 1);
  assert.equal(await second, false);
  assert.equal(states.at(-1).busy, true);
  pending.resolve({ user: { uid: 'user' } });
  assert.equal(await first, true);
  assert.deepEqual(navigation, ['/app']);
});

test('password reset keeps the same safe message for existing and missing accounts', async () => {
  for (const gateway of [
    { sendPasswordReset: async () => undefined },
    { sendPasswordReset: async () => { throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); } },
  ]) {
    const { controller, states } = harness({ gateway });
    await controller.initialize();
    controller.open(AUTH_MODES.RESET);
    assert.equal(await controller.submit({ email: 'person@example.com' }), true);
    assert.equal(states.at(-1).message, SAFE_RESET_MESSAGE);
    assert.equal(states.at(-1).tone, 'success');
  }
});

test('an existing authenticated user changes state without automatic redirect', async () => {
  const user = { uid: 'existing-user' };
  const { controller, states, navigation } = harness({ initialUser: user });
  await controller.initialize();
  assert.equal(states.at(-1).user, user);
  assert.equal(states.at(-1).authResolved, true);
  assert.deepEqual(navigation, []);
});

test('natural field validation distinguishes email, password, and signup confirmation', () => {
  const invalid = validateAuthFields(AUTH_MODES.SIGNUP, {
    email: 'not-an-email',
    password: '123',
    confirmation: '456',
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.email);
  assert.ok(invalid.errors.password);
  assert.ok(invalid.errors.confirmation);
});
