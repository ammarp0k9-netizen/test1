const accountCollision = new Set([
  'auth/email-already-in-use', 'auth/credential-already-in-use', 'auth/account-exists-with-different-credential',
]);

function linkedAccountConflict(cause) {
  return Object.assign(new Error('Guest journey must remain attached to its original UID.'), { code: 'guest-account/conflict', cause });
}

export function isPermanentAccount(user) {
  return Boolean(user && user.isAnonymous !== true);
}

export function createGuestJourneyAuth(auth, sdk, { beforeStart, locks = globalThis.navigator?.locks } = {}) {
  let pending = null;

  function start() {
    if (pending) return pending;
    const create = async () => {
      await auth.authStateReady?.();
      if (auth.currentUser) return auth.currentUser;
      await beforeStart?.();
      if (auth.currentUser) return auth.currentUser;
      return (await sdk.signInAnonymously(auth)).user;
    };
    const task = locks ? locks.request('lootlingua:guest-journey-auth', create) : create();
    pending = Promise.resolve(task).finally(() => { pending = null; });
    return pending;
  }

  async function link(operation) {
    try { return await operation(); }
    catch (error) {
      if (accountCollision.has(error?.code)) throw linkedAccountConflict(error);
      throw error;
    }
  }

  function register(email, password) {
    const guest = auth.currentUser;
    return guest?.isAnonymous === true
      ? link(() => sdk.linkWithCredential(guest, sdk.EmailAuthProvider.credential(email, password)))
      : sdk.createUserWithEmailAndPassword(auth, email, password);
  }

  async function login(email, password) {
    if (auth.currentUser?.isAnonymous === true) throw linkedAccountConflict();
    return sdk.signInWithEmailAndPassword(auth, email, password);
  }

  function google(provider, redirect = false) {
    const guest = auth.currentUser;
    if (guest?.isAnonymous === true) {
      return link(() => redirect ? sdk.linkWithRedirect(guest, provider) : sdk.linkWithPopup(guest, provider));
    }
    return redirect ? sdk.signInWithRedirect(auth, provider) : sdk.signInWithPopup(auth, provider);
  }

  async function redirectResult() {
    await auth.authStateReady?.();
    return auth.currentUser?.isAnonymous === true
      ? link(() => sdk.getRedirectResult(auth)) : sdk.getRedirectResult(auth);
  }

  return Object.freeze({ start, register, login, google, redirectResult });
}
