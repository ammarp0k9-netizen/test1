export function savedGuestError(code) {
  return Object.assign(new Error(code), { code });
}

export function createSavedGuestSession({ auth, getSavedAuth, getDestinationAuth, sdk, locks = globalThis.navigator?.locks }) {
  let selection = null;
  const locked = (work) => locks ? locks.request('lootlingua:saved-guest-session', work) : work();

  async function savedUser() {
    const saved = getSavedAuth();
    await saved.authStateReady();
    const user = saved.currentUser;
    return user?.isAnonymous === true ? user : null;
  }

  async function retain(source) {
    const saved = getSavedAuth();
    const prior = await savedUser();
    if (prior && prior.uid !== source.uid) throw savedGuestError('guest-saved/another-guest');
    await saved.setPersistence(sdk.browserLocalPersistence);
    await saved.updateCurrentUser(source);
    if (saved.currentUser?.uid !== source.uid) throw savedGuestError('guest-saved/session-changed');
    await saved.currentUser.getIdToken();
  }

  function assertCurrent(current) {
    if (!current || current !== selection || auth.currentUser?.uid !== current.source.uid ||
      auth.currentUser.isAnonymous !== true || current.destinationAuth.currentUser?.uid !== current.target.uid ||
      current.destinationAuth.currentUser.isAnonymous !== false) {
      throw savedGuestError('guest-saved/session-changed');
    }
    return current;
  }

  function select(operation) {
    return locked(async () => {
      const source = auth.currentUser;
      if (source?.isAnonymous !== true) throw savedGuestError('guest-saved/session-changed');
      await retain(source);
      const destinationAuth = getDestinationAuth();
      await destinationAuth.setPersistence(sdk.inMemoryPersistence);
      selection = null;
      await sdk.signOut(destinationAuth);
      const result = await operation(destinationAuth);
      const target = result.user;
      if (sdk.getAdditionalUserInfo?.(result)?.isNewUser === true || target?.isAnonymous !== false || target.uid === source.uid || auth.currentUser?.uid !== source.uid ||
        auth.currentUser.isAnonymous !== true) {
        await sdk.signOut(destinationAuth);
        throw savedGuestError('guest-saved/session-changed');
      }
      selection = Object.freeze({ source, target, destinationAuth });
      return selection;
    });
  }

  function continueAsTarget(current) {
    return locked(async () => {
      assertCurrent(current);
      await retain(auth.currentUser);
      assertCurrent(current);
      await auth.updateCurrentUser(current.target);
      if (auth.currentUser?.uid !== current.target.uid) throw savedGuestError('guest-saved/session-changed');
      selection = null;
      await sdk.signOut(current.destinationAuth).catch(() => {});
      return auth.currentUser;
    });
  }

  function cancel(current) {
    return locked(async () => {
      assertCurrent(current);
      selection = null;
      await sdk.signOut(current.destinationAuth);
    });
  }

  function restore() {
    return locked(async () => {
      const current = auth.currentUser;
      const source = await savedUser();
      if (!source) throw savedGuestError('guest-saved/unavailable');
      if (current?.uid === source.uid && current.isAnonymous === false) throw savedGuestError('guest-saved/unavailable');
      if (current?.isAnonymous === true && current.uid !== source.uid) throw savedGuestError('guest-saved/another-guest');
      await source.reload();
      if (source.isAnonymous !== true || auth.currentUser?.uid !== current?.uid) throw savedGuestError('guest-saved/session-changed');
      await auth.updateCurrentUser(source);
      return auth.currentUser;
    });
  }

  function clearAfterLink(user) {
    return locked(async () => {
      const saved = await savedUser();
      if (user?.isAnonymous === false && saved?.uid === user.uid) await sdk.signOut(getSavedAuth());
    });
  }

  return Object.freeze({
    savedUser, restore, clearAfterLink, assertCurrent, cancel, continueAsTarget,
    selectEmail: (email, password) => select((other) => sdk.signInWithEmailAndPassword(other, email, password)),
    selectGoogle: (credential) => select((other) => sdk.signInWithCredential(other, credential)),
  });
}
