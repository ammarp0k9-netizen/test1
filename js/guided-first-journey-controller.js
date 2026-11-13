(function attachGuidedFirstJourneyController(root) {
  'use strict';

  const runtime = {
    state: null, loadedOwner: '', loading: null, authEpoch: 0,
    lastRoute: null, handoffAttempts: 0,
  };
  const COACH_ID = 'guidedFirstJourneyCoach';
  const HANDOFF_KEY = 'lootlingua:guided-first-journey:auth-handoff:v1';

  function api() { return root.LootLinguaGuidedFirstJourneyContract; }
  function cloud() { return root.LootLinguaGuidedFirstJourneyCloud; }
  function user() { return root.auth?.currentUser || null; }
  function identity() { const current = user(); return current ? { uid: current.uid } : {}; }
  function readLocal(forOwner = identity(), legacy = false) {
    try { return api().normalize(JSON.parse(localStorage.getItem(legacy ? api().storageKey(forOwner) : api().checkpointKey(forOwner)))); }
    catch (_) { return null; }
  }
  function active() { return api().isActive(runtime.state); }

  function readHandoff() {
    try { return JSON.parse(localStorage.getItem(HANDOFF_KEY) || sessionStorage.getItem(HANDOFF_KEY)); } catch (_) { return null; }
  }

  function writeHandoff(value) {
    try { localStorage.setItem(HANDOFF_KEY, JSON.stringify(value)); } catch (_) {}
  }

  function pendingIntentFor(currentUser) {
    try {
      return JSON.parse(localStorage.getItem(root.LootLinguaEntryExperience?.pendingIntentStorageKey?.({ uid: currentUser?.uid })));
    } catch (_) { return null; }
  }

  function preferNewestState(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    if (local.phase === 'completed' || remote.phase === 'completed') return local.phase === 'completed' ? local : remote;
    if (Number(local.updatedAt) !== Number(remote.updatedAt)) {
      return Number(local.updatedAt) > Number(remote.updatedAt) ? local : remote;
    }
    return api().PHASES.indexOf(local.phase) >= api().PHASES.indexOf(remote.phase) ? local : remote;
  }

  function announce() {
    const on = active();
    document.documentElement.classList.toggle('guided-first-journey-active', on);
    document.body.classList.toggle('guided-first-journey-active', on);
    // A public-world gate journey must not become a global feature lock. Each
    // feature owns its normal unlock rule and its own discovery progress.
    document.querySelectorAll('[data-feature], [data-dock-view="personal"], [data-view="personal"]').forEach((element) => {
      element.classList.remove('guided-first-journey-deemphasized', 'guided-first-journey-locked');
      element.removeAttribute('data-guided-lock');
    });
    root.dispatchEvent(new CustomEvent('lootlingua:guided-first-journey-change', { detail: { state: runtime.state } }));
  }

  function persist(state) {
    // World selection can change. Store the guide through the existing
    // profile outbox. The legacy guidedFirstJourneys/v1 document pins worldId.
    localStorage.setItem(api().checkpointKey(identity()), JSON.stringify(state));
    if (user()) root.queueProfileIntent?.({ type: 'onboarding', tour: 'public-world-guide', state });
    return state;
  }

  async function boot() {
    const owner = api().storageKey(identity());
    const epoch = runtime.authEpoch;
    const isCurrent = () => epoch === runtime.authEpoch && api().storageKey(identity()) === owner;
    if (runtime.loadedOwner === owner) return runtime.state;
    if (runtime.loading) return runtime.loading.promise;
    const request = { promise: null };
    runtime.loading = request;
    request.promise = (async () => {
      const local = readLocal();
      let remote = null;
      const current = user();
      if (!local && current && cloud()?.load) {
        try { remote = await cloud().load(current); } catch (_) {}
      }
      if (!isCurrent()) return null;
      if (runtime.loadedOwner === owner) return runtime.state;
      const checkpoint = readLocal();
      runtime.state = checkpoint || preferNewestState(readLocal(identity(), true), remote);
      const guest = current && (readLocal({}) || readLocal({}, true));
      const handoff = readHandoff();
      const pending = current ? pendingIntentFor(current) : null;
      if (
        current && !runtime.state && handoff?.claimedBy !== current.uid &&
        handoff?.state && handoff?.operationId && pending?.operationId === handoff.operationId &&
        String(pending.worldId || '') === String(handoff.state.worldId || '')
      ) {
        runtime.state = api().normalize(handoff.state);
      }
      if (guest && !runtime.state) runtime.state = guest;
      if (runtime.state && (!checkpoint || guest)) persist(runtime.state);
      if (guest && runtime.state) {
        localStorage.removeItem(api().checkpointKey({}));
        localStorage.removeItem(api().storageKey({}));
      }
      if (current && runtime.state && handoff?.state && (guest || pending?.operationId === handoff.operationId)) {
        writeHandoff({ ...handoff, claimedBy: current.uid, claimedAt: Date.now() });
      }
      const handoffStillPending = current && !runtime.state && handoff?.state &&
        handoff?.claimedBy !== current.uid && handoff?.operationId;
      runtime.loadedOwner = owner;
      announce();
      if (runtime.lastRoute) applyRoute(runtime.lastRoute);
      else updateResume();
      // Entry owns the secure guest-intent claim. It may finish its async boot a
      // moment after auth changes, so retry this bounded handoff instead of
      // copying guest state to an arbitrary account.
      if (handoffStillPending && runtime.handoffAttempts < 4) {
        runtime.handoffAttempts += 1;
        setTimeout(() => { if (!isCurrent()) return; runtime.loadedOwner = ''; void boot(); }, 350);
      } else if (runtime.state) {
        runtime.handoffAttempts = 0;
      }
      return runtime.state;
    })().finally(() => { if (runtime.loading === request) runtime.loading = null; });
    return request.promise;
  }

  async function beginFromEntry(payload) {
    if (!api().shouldStartForPresentation(payload?.presentation) || (!payload?.worldId && !payload?.chooseWorld)) return null;
    if (runtime.state) return runtime.state;
    const state = payload.chooseWorld ? api().chooseWorld(payload.worldId, Date.now()) : api().create(payload.worldId, Date.now());
    runtime.state = state;
    runtime.loadedOwner = api().storageKey(identity());
    persist(state);
    announce();
    return state;
  }

  function move(type, payload = {}) {
    if (!active()) return runtime.state;
    const next = api().transition(runtime.state, { ...payload, type }, Date.now());
    if (next.updatedAt === runtime.state.updatedAt) return runtime.state;
    runtime.state = next;
    persist(next);
    announce();
    return next;
  }

  const gateWordsLoaded = (payload) => move('gate-words-loaded', payload);
  const gateOpened = (payload) => move('gate-opened', payload);
  const selectWorld = (worldId) => move('select-world', { worldId });
  const journeyStarted = (journey) => move('start-world', { worldId: journey?.worldId });
  const placementGate = (payload) => move('placement-gate', payload);
  const completeFromQuizCta = (payload) => move('complete', payload);

  function enableGuestDictionary() {
    if (!active() || user()) return runtime.state;
    clearCoach();
    return move('enable-guest-dictionary');
  }

  function setPlacement(payload) {
    if (!active() || payload.worldId !== runtime.state.worldId) return;
    if (['placementStage', 'placementLevel', 'assessmentId', 'resultStep'].every((field) =>
      (payload[field] || '') === (runtime.state[field] || ''))) return;
    return move('placement', payload);
  }

  function shouldAllowSurface() {
    // Guided First Journey is a public-world progress record, not a feature
    // eligibility system. Keep its special gate quiz metadata, but never use
    // it to block the ordinary quiz, private worlds, or game dictionaries.
    return true;
  }

  function canPresent() {
    const dictionary = root.LootLinguaPersonalDictionaryOnboarding?.getState?.();
    return active() && !root.__entryExperienceActive &&
      !root.hasActiveLearningQuiz?.() &&
      document.getElementById?.('appAuthDialogShell')?.hidden !== false &&
      !document.documentElement.classList.contains('journey-auth-active') &&
      (!dictionary || ['awaiting-journey', 'completed'].includes(dictionary.phase)) &&
      !(!user() && runtime.state.guestDictionaryAvailable && dictionary?.phase !== 'awaiting-journey');
  }

  function isPresenting() {
    const route = runtime.lastRoute;
    if (!canPresent() || !route?.root?.isConnected || (root.getOnboardingView && root.getOnboardingView() !== 'worlds')) return false;
    if (route.type === 'worlds') return runtime.state.phase === 'choosing-world';
    return (route.worldId === runtime.state.worldId && ['assessment', 'placement-result', 'placement-resume'].includes(route.type)) ||
      root.LootLinguaPopover?.getActiveId?.() === COACH_ID;
  }

  function updateResume() {
    const state = runtime.state;
    const resume = canPresent() && !isPresenting() && state;
    root.LootLinguaPopover?.offerResume?.(COACH_ID, resume ? {
      label: state.placementStage === 'result' ? 'تابع شرح نتيجة المستوى' : 'تابع إرشاد رحلتك',
      priority: 2,
      open: () => {
        if (!state.worldId) root.loadWorldsView?.();
        else if (state.placementStage === 'result' && state.assessmentId) {
          root.openPublishedWorld?.(state.worldId, { assessmentId: state.assessmentId });
        } else if (state.gateId && state.rankId && !['offer', 'assessment'].includes(state.placementStage)) {
          root.openPublishedGate?.(state.worldId, state.rankId, state.gateId);
        } else root.openPublishedWorld?.(state.worldId);
      },
    } : null);
  }

  function applyRoute(payload) {
    if (!payload?.root || (root.getOnboardingView && root.getOnboardingView() !== 'worlds')) return;
    runtime.lastRoute = payload;
    renderRoute(payload);
    updateResume();
    root.LootLinguaFeatureDiscovery?.requestEvaluation?.();
  }

  function renderRoute(payload) {
    if (!canPresent()) {
      root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
      return;
    }
    const state = runtime.state;
    const rootNode = payload.root;
    if (payload.type === 'worlds') {
      rootNode.querySelectorAll('[data-guided-world]').forEach((card) => {
        const marker = card.querySelector('.guided-world-choice-label');
        const id = card.dataset.guidedWorld;
        const label = id === state.worldId ? 'بدأت الإرشاد في هذا العالم'
          : id === state.suggestedWorldId ? 'اخترت هذا العالم في المقدمة' : '';
        if (marker) { marker.hidden = !label; marker.textContent = label; }
      });
      if (state.phase === 'choosing-world') {
        const target = rootNode.querySelector('.published-hub-intro');
        showCoachMark(target, 'اختر أي عالم لتبدأ إرشاده. ميّزنا لك العالم الذي شاهدته في المقدمة.', { step: 'choose-world' });
        return;
      }
    }
    if (payload.worldId !== state.worldId || payload.type === 'assessment' ||
        (payload.type === 'gate' && state.gateId && payload.gateId && payload.gateId !== state.gateId)) {
      root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
      return;
    }
    if (payload.type === 'placement-resume') {
      const target = rootNode.querySelector('.published-level-placement-resume .published-placement-resume-actions');
      showCoachMark(target, 'تابع من سؤالك المحفوظ، أو ارجع إلى العالم واختر متى تبدأ التعلّم.',
        { step: 'placement-resume', actions: [target].filter(Boolean) });
      return;
    }
    if (payload.type === 'placement-result') {
      const stage = state.assessmentId === payload.assessmentId ? state.resultStep : 0;
      const record = { worldId: state.worldId, placementStage: 'result', placementLevel: payload.nextLevel || '',
        assessmentId: payload.assessmentId, resultStep: stage };
      setPlacement(record);
      const next = () => {
        setPlacement({ ...record, resultStep: stage + 1 });
        applyRoute(payload);
      };
      if (stage === 0) {
        showCoachMark(rootNode.querySelector('.published-placement-result-score'),
          'هنا عدد الإجابات الصحيحة من مجموع الأسئلة. افتح «مراجعة النتيجة» لترى أداءك في كل جزء.',
          { step: `${payload.assessmentId}:score`, next });
      } else if (stage === 1) {
        const target = rootNode.querySelector('[data-guide-placement-save]');
        showCoachMark(target, payload.canChooseWords
          ? 'اختر حفظ الكلمات التي أخطأت بها، أو احفظ كل الكلمات، أو تابع من دون حفظها.'
          : 'هنا تجد ما اخترت حفظه من الاختبار. تابع رحلتك عندما تكون جاهزًا.',
        { step: `${payload.assessmentId}:words`, next, actions: [target].filter(Boolean) });
      } else {
        const target = rootNode.querySelector('[data-guide-placement-destination]');
        const text = payload.worldCompleted
          ? 'أنهيت محتوى هذا العالم المنشور حاليًا. استكشف عالمًا آخر، وتابع هذا العالم عند نشر بوابات أو مستويات جديدة.'
          : payload.nextLevel
            ? `يمكنك اختبار مستوى ${payload.nextLevel} الآن أو متابعة التعلّم من البوابة المقترحة.`
            : payload.hasGate
              ? 'تابع إلى البوابة التي حددتها نتيجة اختبارك. ستبدأ التعلّم من المكان المناسب لك.'
              : 'ارجع إلى العالم لتختار خطوتك التالية من البوابات المتاحة.';
        showCoachMark(target, text, { step: `${payload.assessmentId}:destination`, actions: [target].filter(Boolean) });
      }
      return;
    }
    if (payload.type === 'world') {
      const placementButtons = [...rootNode.querySelectorAll('[data-guide-placement-level]:not([disabled])')];
      const offer = !state.placementStage ? state.phase === 'awaiting-first-gate' && !state.gateId
        : ['assessment', 'offer', 'result'].includes(state.placementStage);
      const assessment = offer && (state.placementLevel
        ? placementButtons.find((button) => button.dataset.guidePlacementLevel === state.placementLevel)
        : placementButtons[0]);
      if (assessment) {
        const continuation = () => {
          setPlacement({ worldId: state.worldId, placementStage: 'continue' });
          applyRoute(payload);
        };
        const text = state.placementStage === 'result' && state.placementLevel
          ? `يمكنك اختبار مستوى ${state.placementLevel} من هنا، أو متابعة التعلّم من البوابة المقترحة.`
          : state.placementStage === 'offer' && state.assessmentId
          ? 'يمكنك العودة لاختبار المستوى من هنا، أو متابعة التعلّم من بوابتك.'
          : 'اختبر مستواك لتبدأ من البوابة المناسبة لك. الاختبار اختياري؛ يمكنك المتابعة إلى البوابات.';
        showCoachMark(assessment, text, {
          step: `assessment:${assessment.dataset.guidePlacementLevel}`, actions: [assessment],
          next: continuation, label: 'تابع إلى البوابات',
        });
        return;
      }
      const target = (state.gateId && [...rootNode.querySelectorAll('.published-gate-node')]
        .find((node) => node.dataset.gateId === state.gateId && !node.disabled && !node.classList.contains('is-locked'))) ||
        rootNode.querySelector('.published-journey-panel .published-journey-cta:not([disabled]), .published-gate-node.is-available');
      if (!target) return;
      const message = state.phase === 'awaiting-quiz-cta'
        ? 'أنت هنا — أكمل من البوابة التي بدأت بها.'
        : (state.phase === 'first-gate-opened'
          ? 'هذه بوابتك الأولى. افتحها لتبدأ الرحلة وتتعلم كلماتها.'
          : 'هذا عالمك: ينتظم التعلم فيه بحسب المستوى ثم البوابات. ابدأ من أول بوابة متاحة.');
      showCoachMark(target, message, { step: `world:${state.phase}`, actions: [target] });
    }
    if (payload.type === 'gate') {
      const target = rootNode.querySelector('.published-journey-cta:not([disabled])');
      if (!target) return;
      const label = String(target.textContent || '');
      const guestHint = !user()
        ? ' يمكنك أيضًا استخدام قاموسك الشخصي لإضافة كلمات بنفسك.'
        : '';
      const message = state.phase === 'awaiting-quiz-cta'
        ? 'من هنا تختبر كلمات البوابة وترفع جاهزيتها. لووت رنر وLoot Bots للتدريب؛ لا يزيدان الإتقان أو تقدّم البوابة.'
        : (label.includes('أضف')
          ? 'هذه كلمات بوابتك التالية. أضفها إلى قاموسك لتبدأ التعلّم.'
          : `هنا تبدأ رحلتك. ${guestHint}`);
      showCoachMark(target, message, { step: `gate:${state.phase}`, actions: [target] });
    }
  }

  function showCoachMark(anchor, message, options = {}) {
    const popover = root.LootLinguaPopover;
    if (!anchor || !popover?.open) return;
    const activeId = popover.getActiveId?.();
    // A meaning/help popover owns the layer until the user closes it. The guide
    // remains visually highlighted and returns on the next real route render.
    if (activeId && activeId !== COACH_ID) return;
    const rect = anchor.getBoundingClientRect?.();
    if (rect && (rect.bottom < 56 || rect.top > root.innerHeight - 90)) {
      anchor.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }
    const content = document.createElement('div');
    content.className = 'guided-first-journey-coach-content';
    const title = document.createElement('strong');
    title.id = 'guidedFirstJourneyCoachTitle';
    title.textContent = 'خطوتك التالية';
    const copy = document.createElement('p');
    copy.textContent = message;
    content.append(title, copy);
    if (options.next) {
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'entry-primary';
      next.textContent = options.label || 'التالي';
      next.addEventListener('click', options.next);
      content.append(next);
    }
    popover.open({
      id: COACH_ID,
      className: 'lootlingua-popover guided-first-journey-coach',
      anchor,
      content,
      labelledBy: title.id,
      persistent: true,
      reading: { step: options.step, text: message, actions: options.actions },
    });
  }

  function clearCoach() {
    runtime.lastRoute = null;
    document.querySelectorAll('.guided-first-journey-target').forEach((node) => node.classList.remove('guided-first-journey-target'));
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
  }
  root.addEventListener('lootlingua:personal-dictionary-onboarding-change', () => {
    const dictionary = root.LootLinguaPersonalDictionaryOnboarding?.getState?.();
    if (!['awaiting-journey', 'completed'].includes(dictionary?.phase)) clearCoach();
    updateResume();
  });

  root.addEventListener('lootlingua:journey-auth-requested', (event) => {
    const intent = event.detail?.intent;
    if (!active() || user() || !intent || String(intent.worldId || '') !== String(runtime.state?.worldId || '')) return;
    writeHandoff({ operationId: intent.operationId, state: runtime.state, claimedBy: '', createdAt: Date.now() });
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
    updateResume();
  });
  root.addEventListener('lootlingua:entry-closed', () => {
    if (runtime.lastRoute) applyRoute(runtime.lastRoute);
    else updateResume();
  });
  root.addEventListener('lootlingua:auth-dialog-closed', () => {
    if (runtime.lastRoute) applyRoute(runtime.lastRoute);
    else updateResume();
  });
  root.addEventListener('lootlingua:auth-dialog-opened', () => {
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
    updateResume();
  });
  root.addEventListener('lootlingua:surface-ready', updateResume);
  root.addEventListener('lootlingua:onboarding-cloud-change', () => {
    if (!user()) return;
    const checkpoint = readLocal();
    if (!checkpoint || JSON.stringify(checkpoint) === JSON.stringify(runtime.state)) return;
    runtime.state = preferNewestState(checkpoint, runtime.state);
    if (runtime.lastRoute) applyRoute(runtime.lastRoute);
    else updateResume();
    announce();
  });
  root.addEventListener('lootlingua:popover-closed', (event) => {
    if (!active() || event.detail?.id === COACH_ID || !runtime.lastRoute?.root?.isConnected) return;
    requestAnimationFrame(() => { if (runtime.lastRoute) applyRoute(runtime.lastRoute); });
  });

  root.addEventListener('lootlingua:auth-state', () => {
    runtime.authEpoch++; runtime.loadedOwner = ''; runtime.loading = null;
    runtime.state = null; runtime.handoffAttempts = 0;
    clearCoach(); updateResume();
    announce(); void boot();
  });
  root.addEventListener('lootlingua:guided-first-journey-cloud-ready', () => { runtime.loadedOwner = ''; void boot(); });
  root.addEventListener('lootlingua:initial-data-ready', () => { void boot(); });

  // ── Verified gate quiz completion ────────────────────────────────────────
  // Wait for controller boot before evaluating the event. The page may restore
  // the published journey and its quiz session while the cloud-backed UX state
  // is still loading; dropping this event would leave the entire app locked.
  async function handleTrustedQuizCompleted(detail) {
    const source = String(detail?.source || '');
    const eventWorldId = String(detail?.worldId || '');
    const eventGateId = String(detail?.gateId || '');
    const hasJourneyContext = detail?.journeyContext === true || source.startsWith('journey:');
    if (!hasJourneyContext || !eventWorldId || !eventGateId || Number(detail?.total) < 1) return;
    if (!user()) return;

    await boot();
    if (!active() || !user()) return;
    if (eventWorldId !== runtime.state.worldId) return;
    if (runtime.state.gateId && eventGateId !== runtime.state.gateId) return;

    // A completed, verified gate quiz proves that its exact gate was opened
    // and its words were loaded. Recover from a lagging persisted UX phase, but
    // never replace a known, different gate ID.
    if (runtime.state.phase === 'awaiting-first-gate' && !runtime.state.gateId) {
      await gateOpened({ worldId: eventWorldId, gateId: eventGateId });
    }
    if (
      runtime.state.phase === 'first-gate-opened' &&
      runtime.state.gateId === eventGateId
    ) {
      await gateWordsLoaded({ worldId: eventWorldId, gateId: eventGateId });
    }
    if (runtime.state?.phase !== 'awaiting-quiz-cta') return;
    if (runtime.state.gateId !== eventGateId) return;

    await completeFromQuizCta({ worldId: eventWorldId, gateId: eventGateId });
  }

  root.addEventListener('lootlingua:trusted-quiz-completed', (event) => {
    void handleTrustedQuizCompleted(event.detail || {}).catch((error) => {
      root.LootLinguaOperations?.diagnostic?.('guided-first-journey-completion-error', {
        message: String(error?.message || error),
      });
    });
  });

  queueMicrotask(boot);

  Object.defineProperty(root, 'LootLinguaGuidedFirstJourney', {
    value: Object.freeze({
      boot, beginFromEntry, selectWorld, journeyStarted, setPlacement, placementGate, gateOpened, gateWordsLoaded,
      completeFromQuizCta, enableGuestDictionary, shouldAllowSurface, applyRoute, clearCoach, isPresenting,
      worldCompleted: (worldId) => move('world-completed', { worldId }), getState: () => runtime.state,
    }),
    configurable: false, writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
