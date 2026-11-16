import { createSavedGuestSession } from './saved-guest-session.js';

const DIALOG = `
  <h2 id="savedGuestTitle">تقدّم الضيف المحفوظ</h2>
  <p data-saved-guest-account dir="auto"></p>
  <p data-saved-guest-summary></p>
  <p data-saved-guest-status role="status" aria-live="polite"></p>
  <div class="saved-guest-actions">
    <button type="button" data-saved-guest-merge>دمج التقدّم</button>
    <button type="button" data-saved-guest-continue>المتابعة دون دمج</button>
    <button type="button" data-saved-guest-other>اختيار حساب آخر</button>
  </div>`;

export function createSavedGuestFlow({ app, appSdk, auth, sdk, guestAuth, emulator, mainDb, openLogin, onAuthenticated }) {
  const namedAuth = (name) => {
    let instance;
    return () => {
      if (instance) return instance;
      const firebaseApp = appSdk.getApps().find((item) => item.name === name) || appSdk.initializeApp(app.options, name);
      instance = sdk.getAuth(firebaseApp);
      if (emulator && !instance.emulatorConfig) sdk.connectAuthEmulator(instance, 'http://127.0.0.1:9099', { disableWarnings: true });
      return instance;
    };
  };
  const sessions = createSavedGuestSession({
    auth, sdk, getSavedAuth: namedAuth('lootlingua-saved-guest'),
    getDestinationAuth: namedAuth('lootlingua-guest-destination'),
  });
  const restoreButtons = [...document.querySelectorAll('[data-saved-guest-restore]')];
  let progress;
  let active = null;
  let dialog = null;
  let busy = false;

  async function progressMerge() {
    if (progress) return progress;
    const [firestore, imports] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
      import('./guest-progress-merge.js?v=full-merge-1'),
    ]);
    const configured = new WeakSet();
    progress = imports.createGuestProgressMerge({
      firestore, assertCurrent: sessions.assertCurrent,
      getDatabase(instance) {
        if (instance === auth && mainDb) return mainDb;
        const db = firestore.getFirestore(instance.app);
        if (emulator && !configured.has(db)) {
          firestore.connectFirestoreEmulator(db, '127.0.0.1', 8080);
          configured.add(db);
        }
        return db;
      },
    });
    return progress;
  }

  function summary(selector, value) { dialog.querySelector(selector).textContent = value; }

  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    dialog.querySelector('[data-saved-guest-merge]').disabled = value || !active?.plan || active.plan.completed;
    dialog.querySelectorAll('[data-saved-guest-continue], [data-saved-guest-other]').forEach((button) => { button.disabled = value; });
  }

  async function decide(action) {
    if (!active || busy) return;
    const current = active;
    setBusy(true);
    try {
      if (action === 'other') {
        await sessions.cancel(current.selection);
        active = null;
        dialog.close();
        openLogin();
        return;
      }
      if (action === 'merge') {
        if (!current.plan || current.plan.completed) return;
        const messages = { words: 'جارٍ دمج الكلمات والإتقان…', journeys: 'جارٍ حفظ الرحلات والمحاولات…', finalizing: 'جارٍ تأكيد حفظ الأرصدة والمكافآت…' };
        summary('[data-saved-guest-status]', 'جارٍ تجهيز الدمج…');
        await current.merge.commit(current.plan, (stage) => summary('[data-saved-guest-status]', messages[stage]));
        summary('[data-saved-guest-status]', 'تم حفظ دمج التقدّم.');
      }
      const user = await sessions.continueAsTarget(current.selection);
      active = null;
      dialog.close();
      await onAuthenticated(user, action);
    } catch (error) {
      const message = error?.code === 'guest-saved/session-changed'
        ? 'تغيّرت جلسة تسجيل الدخول. أغلق النافذة وابدأ من الحساب المطلوب.'
        : 'لم تكتمل العملية. تقدّم الضيف محفوظ، وتقدر تعيد المحاولة أو تتابع بحسابك القديم.';
      summary('[data-saved-guest-status]', message);
    } finally {
      setBusy(false);
    }
  }

  async function present(selection) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'saved-guest-dialog';
      dialog.setAttribute('aria-labelledby', 'savedGuestTitle');
      dialog.innerHTML = DIALOG;
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        void decide('other');
      });
      for (const action of ['merge', 'continue', 'other']) {
        dialog.querySelector(`[data-saved-guest-${action}]`).addEventListener('click', () => void decide(action));
      }
      document.body.append(dialog);
    }
    const current = active = { selection, merge: null, plan: null };
    summary('[data-saved-guest-account]', selection.target.email || selection.target.displayName || 'الحساب الذي سجّلت دخوله');
    summary('[data-saved-guest-summary]', 'جارٍ تجهيز معاينة الدمج…');
    summary('[data-saved-guest-status]', '');
    if (!dialog.open) dialog.showModal();
    setBusy(false);
    try {
      current.merge = await progressMerge();
      current.plan = await current.merge.preview(selection, auth);
      if (active !== current) return;
      const { words, journeys, xpAdded, finalXP, completed, receipt, guest } = current.plan;
      const format = value => new Intl.NumberFormat('ar').format(Number(value) || 0);
      const details = completed ? 'تقدّم هذا الضيف مدموج في هذا الحساب بالفعل.'
        : `الخبرة بعد الدمج: ${format(finalXP)} XP (${format(xpAdded)} من الضيف). كلمات جديدة: ${format(words.additions.length)}. عوالم: ${format(journeys.size)}. عملات الضيف: ${format(guest.runnerCoins)} للجري و${format(guest.lootBots?.coins)} لـ Loot Bots.`;
      summary('[data-saved-guest-summary]', details + (words?.skipped ? ` كلمات بصيغة قديمة تبقى محفوظة في جلسة الضيف: ${format(words.skipped)}.` : ''));
      if (!completed && receipt) summary('[data-saved-guest-status]', 'حُفظت الأرصدة سابقًا. يمكنك استكمال نقل السجلات.');
    } catch (error) {
      if (active !== current) return;
      const message = error?.code === 'guest-saved/another-destination'
        ? 'بدأ دمج هذا الضيف مع حساب آخر. اختر ذلك الحساب لاستكماله.'
        : 'تعذّرت معاينة الدمج. يمكنك المتابعة أو المحاولة لاحقًا.';
      summary('[data-saved-guest-summary]', message);
    } finally {
      if (active === current && !busy) setBusy(false);
    }
  }

  async function choose(selection) {
    // The authentication form closes independently, including after a redirect.
    void present(selection);
    return { guestDecision: true };
  }

  async function googleResult(operation) {
    try { return await operation(); }
    catch (error) {
      const collision = error?.cause;
      if (auth.currentUser?.isAnonymous !== true || collision?.code !== 'auth/credential-already-in-use') throw error;
      const credential = sdk.GoogleAuthProvider.credentialFromError(collision);
      if (!credential) throw error;
      return choose(await sessions.selectGoogle(credential));
    }
  }

  sdk.onIdTokenChanged(auth, async (user) => {
    try {
      if (user?.isAnonymous === false) await sessions.clearAfterLink(user);
      const saved = await sessions.savedUser();
      if (auth.currentUser?.uid !== user?.uid) return;
      restoreButtons.forEach((button) => { button.hidden = !saved || user?.isAnonymous === true || saved.uid === user?.uid; });
    } catch (_) {
      restoreButtons.forEach((button) => { button.hidden = true; });
    }
  });
  restoreButtons.forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const user = await sessions.restore();
      await onAuthenticated(user, 'restore');
    } catch (_) {
      const status = button.parentElement.querySelector('[data-saved-guest-restore-status]');
      if (status) status.textContent = 'تعذّرت استعادة جلسة الضيف. جرّب من المتصفح الذي حُفظت عليه.';
    } finally {
      button.disabled = false;
    }
  }));

  return Object.freeze({
    signIn: async (email, password) => auth.currentUser?.isAnonymous === true
      ? choose(await sessions.selectEmail(email, password)) : guestAuth.login(email, password),
    google: (provider, redirect) => googleResult(() => guestAuth.google(provider, redirect)),
    finishRedirect: () => googleResult(guestAuth.redirectResult),
    async hasSavedGuestForOtherAccount(uid) {
      const saved = await sessions.savedUser();
      return Boolean(saved && saved.uid !== uid);
    },
    async restoreForStart() {
      await auth.authStateReady();
      return auth.currentUser || ((await sessions.savedUser()) ? sessions.restore() : null);
    },
  });
}

export function useGoogleRedirect(auth, isIOS, hostname = location.hostname) {
  // Safari can block the cross-origin Firebase redirect helper on external hosts.
  return isIOS && auth.app.options.authDomain === hostname;
}
