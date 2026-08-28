(function attachGuidedFirstJourneyController(root) {
  'use strict';

  const runtime = { state: null, loadedOwner: '', loading: null, handoff: null, lastRoute: null, handoffAttempts: 0, reengagementOwner: '' };
  const COACH_ID = 'guidedFirstJourneyCoach';
  const HANDOFF_KEY = 'lootlingua:guided-first-journey:auth-handoff:v1';

  function api() { return root.LootLinguaGuidedFirstJourneyContract; }
  function cloud() { return root.LootLinguaGuidedFirstJourneyCloud; }
  function user() { return root.auth?.currentUser || null; }
  function identity() { const current = user(); return current ? { uid: current.uid } : {}; }
  function readLocal() { try { return api().normalize(JSON.parse(localStorage.getItem(api().storageKey(identity())))); } catch (_) { return null; } }
  function saveLocal(state) { localStorage.setItem(api().storageKey(identity()), JSON.stringify(state)); }
  function active() { return api().isActive(runtime.state); }

  function readHandoff() {
    try { return JSON.parse(sessionStorage.getItem(HANDOFF_KEY)); } catch (_) { return null; }
  }

  function writeHandoff(value) {
    try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(value)); } catch (_) {}
  }

  function pendingIntentFor(currentUser) {
    try {
      return JSON.parse(localStorage.getItem(root.LootLinguaEntryExperience?.pendingIntentStorageKey?.({ uid: currentUser?.uid })));
    } catch (_) { return null; }
  }

  function preferNewestState(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    if (Number(local.updatedAt) !== Number(remote.updatedAt)) {
      return Number(local.updatedAt) > Number(remote.updatedAt) ? local : remote;
    }
    const priority = { 'awaiting-first-gate': 1, 'first-gate-opened': 2, 'awaiting-quiz-cta': 3, completed: 4 };
    return (priority[local.phase] || 0) >= (priority[remote.phase] || 0) ? local : remote;
  }

  function announce() {
    const on = active();
    // Once the guest reaches the sign-in handoff, this small UX layer must not
    // lock any app surface. Product-owned progression locks remain untouched.
    const guestExploring = Boolean(on && runtime.state?.guestDictionaryAvailable && !user());
    document.documentElement.classList.toggle('guided-first-journey-active', on);
    document.body.classList.toggle('guided-first-journey-active', on);
    document.querySelectorAll('[data-feature]').forEach((element) => {
      const feature = String(element.getAttribute('data-feature') || '');
      const locked = on && !guestExploring && (
        ['quiz', 'minecraft', 'pubg', 'starred', 'treasure'].includes(feature) ||
        feature === 'personal'
      );
      element.classList.toggle('guided-first-journey-locked', locked);
      if (locked) element.setAttribute('data-guided-lock', 'true');
      else element.removeAttribute('data-guided-lock');
    });
    document.querySelectorAll('[data-dock-view="personal"], [data-view="personal"]').forEach((element) => {
      element.classList.toggle('guided-first-journey-deemphasized', false);
      element.classList.toggle('guided-first-journey-locked', on && !guestExploring);
      if (on && !guestExploring) element.setAttribute('data-guided-lock', 'true');
      else element.removeAttribute('data-guided-lock');
    });
    root.dispatchEvent(new CustomEvent('lootlingua:guided-first-journey-change', { detail: { state: runtime.state } }));
  }

  async function persist(state) {
    saveLocal(state);
    const current = user();
    if (!current || !cloud()?.save) return state;
    try { await cloud().save(state, current); } catch (_) { /* local state remains safely owner-scoped until retry */ }
    return state;
  }

  async function boot() {
    const owner = api().storageKey(identity());
    if (runtime.loadedOwner === owner) return runtime.state;
    if (runtime.loading) return runtime.loading;
    runtime.loading = (async () => {
      const local = readLocal();
      let remote = null;
      const current = user();
      if (current && cloud()?.load) {
        try { remote = await cloud().load(current); } catch (_) {}
      }
      runtime.state = preferNewestState(local, remote);
      const handoff = readHandoff();
      const pending = current ? pendingIntentFor(current) : null;
      if (
        current && !runtime.state && handoff?.claimedBy !== current.uid &&
        handoff?.state && handoff?.operationId && pending?.operationId === handoff.operationId &&
        String(pending.worldId || '') === String(handoff.state.worldId || '')
      ) {
        runtime.state = api().normalize(handoff.state);
        writeHandoff({ ...handoff, claimedBy: current.uid, claimedAt: Date.now() });
        if (runtime.state) void persist(runtime.state);
      }
      const handoffStillPending = current && !runtime.state && handoff?.state &&
        handoff?.claimedBy !== current.uid && handoff?.operationId;
      runtime.loadedOwner = owner;
      runtime.loading = null;
      announce();
      if (current && runtime.state?.guestDictionaryAvailable && runtime.reengagementOwner !== owner) {
        runtime.reengagementOwner = owner;
        root.showToast?.('تم تسجيل دخولك. إذا رغبت بمتابعة التعلّم، ستجد عالمك من قسم العوالم.', 'info', 5200);
      }
      // Entry owns the secure guest-intent claim. It may finish its async boot a
      // moment after auth changes, so retry this bounded handoff instead of
      // copying guest state to an arbitrary account.
      if (handoffStillPending && runtime.handoffAttempts < 4) {
        runtime.handoffAttempts += 1;
        setTimeout(() => { runtime.loadedOwner = ''; void boot(); }, 350);
      } else if (runtime.state) {
        runtime.handoffAttempts = 0;
      }
      return runtime.state;
    })();
    return runtime.loading;
  }

  async function beginFromEntry(payload) {
    if (!api().shouldStartForPresentation(payload?.presentation) || !payload?.worldId) return null;
    const state = api().create(payload.worldId, Date.now());
    runtime.state = state;
    runtime.loadedOwner = api().storageKey(identity());
    announce();
    await persist(state);
    return state;
  }

  async function gateWordsLoaded(payload) {
    if (!active()) return runtime.state;
    const next = api().transition(runtime.state, { type: 'gate-words-loaded', worldId: payload?.worldId, gateId: payload?.gateId }, Date.now());
    if (next === runtime.state) return next;
    runtime.state = next;
    announce();
    await persist(next);
    return next;
  }

  async function gateOpened(payload) {
    if (!active()) return runtime.state;
    const next = api().transition(runtime.state, { type: 'gate-opened', worldId: payload?.worldId, gateId: payload?.gateId }, Date.now());
    if (next === runtime.state) return next;
    runtime.state = next;
    announce();
    await persist(next);
    return next;
  }

  async function enableGuestDictionary() {
    if (!active() || user()) return runtime.state;
    const next = api().transition(runtime.state, { type: 'enable-guest-dictionary' }, Date.now());
    if (next === runtime.state) return next;
    runtime.state = next;
    announce();
    await persist(next);
    root.showToast?.('يمكنك الآن استكشاف الموقع كاملاً كضيف، بما فيه إضافة كلماتك يدويًا من قاموسك الشخصي. سجّل دخولك لاحقًا لحفظ الرحلة ومتابعة التعلّم من العوالم.', 'info', 6200);
    return next;
  }

  async function completeFromQuizCta(payload) {
    if (!active()) return runtime.state;
    const next = api().transition(runtime.state, { type: 'complete', worldId: payload?.worldId, gateId: payload?.gateId }, Date.now());
    if (next === runtime.state) return next;
    runtime.state = next;
    announce();
    await persist(next);
    return next;
  }

  function shouldAllowSurface(surface, options) {
    if (!active() || options?.guided === true) return true;
    const guestExploring = Boolean(runtime.state?.guestDictionaryAvailable && !user());
    if (guestExploring) return true;
    if (surface === 'personal') {
      root.showToast?.('خطوتك الحالية داخل العالم. سيفتح القاموس عندما تحتاجه في المسار.', 'info', 3400);
      return false;
    }
    const blocked = new Set(['quiz', 'minecraft', 'pubg', 'starred', 'treasure', 'custom-worlds']);
    if (!blocked.has(surface)) return true;
    root.showToast?.('خطوتك الحالية موجودة داخل البوابة المفتوحة. أكملها أولاً ثم ستتسع الرحلة.', 'info', 3600);
    return false;
  }

  function applyRoute(payload) {
    if (!active() || !payload?.root) return;
    runtime.lastRoute = payload;
    const state = runtime.state;
    if (String(payload.worldId || '') !== state.worldId) return;
    const rootNode = payload.root;
    rootNode.querySelectorAll('.guided-first-journey-note, .guided-first-journey-target').forEach((node) => {
      node.classList.remove('guided-first-journey-target');
      if (node.classList.contains('guided-first-journey-note')) node.remove();
    });
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
    if (payload.type === 'world') {
      const target = state.phase !== 'awaiting-first-gate' && state.gateId
        ? [...rootNode.querySelectorAll('.published-gate-node')]
          .find((node) => String(node.dataset.gateId || '') === state.gateId)
        : rootNode.querySelector('.published-gate-node.is-available');
      if (!target) return;
      target.classList.add('guided-first-journey-target');
      const message = state.phase === 'awaiting-quiz-cta'
        ? 'أنت هنا — أكمل من البوابة التي بدأت بها.'
        : (state.phase === 'first-gate-opened'
          ? 'هذه بوابتك الأولى. افتحها لتبدأ الرحلة وتتعلم كلماتها.'
          : 'هذا عالمك: ينتظم التعلم فيه بحسب المستوى ثم البوابات. ابدأ من أول بوابة متاحة.');
      showCoachMark(target, message);
    }
    if (payload.type === 'gate') {
      const target = rootNode.querySelector('.published-journey-cta');
      if (!target) return;
      target.classList.add('guided-first-journey-target');
      const label = String(target.textContent || '');
      const guestHint = !user()
        ? ' يمكنك أيضًا استخدام قاموسك الشخصي لإضافة كلمات بنفسك.'
        : '';
      const message = state.phase === 'awaiting-quiz-cta'
        ? 'كلمات هذه البوابة أصبحت في قاموسك. تابع التعلّم من الزر الموجود هنا للوصول إلى الاختبار.'
        : (label.includes('أضف')
          ? 'هذه كلمات بوابتك التالية. أضفها إلى قاموسك لتبدأ التعلّم.'
          : `هنا تبدأ رحلتك. ${guestHint}`);
      showCoachMark(target, message);
    }
  }

  function showCoachMark(anchor, message) {
    const popover = root.LootLinguaPopover;
    if (!anchor || !popover?.open) return;
    const activeId = popover.getActiveId?.();
    // A meaning/help popover owns the layer until the user closes it. The guide
    // remains visually highlighted and returns on the next real route render.
    if (activeId && activeId !== COACH_ID) return;
    const content = document.createElement('div');
    content.className = 'guided-first-journey-coach-content';
    const title = document.createElement('strong');
    title.id = 'guidedFirstJourneyCoachTitle';
    title.textContent = 'خطوتك التالية';
    const copy = document.createElement('p');
    copy.textContent = message;
    content.append(title, copy);
    popover.open({
      id: COACH_ID,
      className: 'lootlingua-popover guided-first-journey-coach',
      anchor,
      content,
      labelledBy: title.id,
    });
  }

  root.addEventListener('lootlingua:journey-auth-requested', (event) => {
    const intent = event.detail?.intent;
    if (!active() || user() || !intent || String(intent.worldId || '') !== String(runtime.state?.worldId || '')) return;
    writeHandoff({ operationId: intent.operationId, state: runtime.state, claimedBy: '', createdAt: Date.now() });
    void enableGuestDictionary();
  });
  root.addEventListener('lootlingua:popover-closed', (event) => {
    if (!active() || event.detail?.id === COACH_ID || !runtime.lastRoute?.root?.isConnected) return;
    requestAnimationFrame(() => applyRoute(runtime.lastRoute));
  });

  root.addEventListener('lootlingua:auth-state', () => { runtime.loadedOwner = ''; runtime.handoffAttempts = 0; void boot(); });
  root.addEventListener('lootlingua:guided-first-journey-cloud-ready', () => { runtime.loadedOwner = ''; void boot(); });
  root.addEventListener('lootlingua:initial-data-ready', () => { void boot(); });
  queueMicrotask(boot);

  Object.defineProperty(root, 'LootLinguaGuidedFirstJourney', {
    value: Object.freeze({ boot, beginFromEntry, gateOpened, gateWordsLoaded, completeFromQuizCta, enableGuestDictionary, shouldAllowSurface, applyRoute, getState: () => runtime.state }),
    configurable: false, writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
