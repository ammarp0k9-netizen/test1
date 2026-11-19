(function attachPersonalDictionaryOnboarding(root) {
  'use strict';

  // This is deliberately separate from Entry Experience and the public-gate
  // journey.  It records only the short hand-off to the personal dictionary.
  const VERSION = 1;
  const KEY_PREFIX = 'lootlingua:personal-dictionary-onboarding:v1:';
  const COACH_ID = 'personalDictionaryOnboardingCoach';
  const STATS_COACH_ID = 'contextualStatsCoach';
  const STATS_KEY_PREFIX = 'lootlingua:contextual-onboarding:v1:full-stats:';
  const statsChoices = new Set();
  let statsVisit = null;
  let renderToken = 0;
  let pausedForOverlay = false;
  let fullTourRequested = false;
  const STEPS = [
    ['dictionary', '#legendDock [data-dock-view="personal"]', 'قاموسك الشخصي', 'اضغط قاموسك هنا لنضيف كلمة تتعلمها.', 'click'],
    ['search', '#searchBtn', 'جرّب البحث', 'اقترحنا journey: اكتبها أو اختر كلمة أخرى، ثم اضغط «ابحث عن معنى».', 'search'],
    ['meaning', '#suggestionsList', 'اختر المعنى المناسب', 'قد تحمل الكلمة أكثر من معنى. اضغط المعنى الذي يناسبك لتعبئة بيانات الكلمة.', 'meaning'],
    ['save', '#addBtn', 'احفظ الكلمة', 'اضغط «إضافة للقاموس». نكمل بعد نجاح حفظ كلمتك.', 'saved'],
    ['activity', '.legend-top-widgets', 'هدفك واستمرارك', 'النار تتابع سلسلتك اليومية، والدائرة تعرض هدفك. اضغط الهدف لرؤية إحصائياتك لاحقًا.'],
    ['notices', '#notifHub', 'دعواتك هنا', 'الجرس يجمع إشعاراتك ودعوات استكشاف الميزات. لا تحتاج إلى فتحها الآن.'],
    ['quests', '#dailyQuestsBtn', 'مهام اليوم', 'هنا تجد مهام اليوم وتقدّم إنجازها. اختر مهامك عندما تبدأ التعلّم.'],
    ['profile', '#heroAvatarBtn', 'ملفك وتقدّمك', 'صورتك تعرض رتبتك وXP. اضغطها لنرى تفاصيل تقدّمك وإعداداتك.', 'click'],
    ['xp', '#levelSection', 'كيف تكسب XP؟', 'تكسب XP عندما تتقدم في تعلّم الكلمات: 2 لبدء التعلّم، 4 للمراجعة، و8 لأول إتقان، و3 لإعادة الإتقان. إضافة كلمة وحدها لا تمنح XP.'],
    ['ranks', '#xpRanksGuideToggle', 'فائدة الخبرة', 'XP ترفع رتبتك وتفتح الثيمات بحسب مستواك. افتح دليل المستويات لترى الرتب.', 'click'],
    ['stats', '.profile-stats-mini', 'أرقام تعبّر عن تقدّمك', 'هنا عدد كلماتك وأفضل سلسلة. افتح الإحصائيات الكاملة لنرى بقية التفاصيل.'],
    ['full-stats', '#statsPanel .stats-box', 'تعلمك بالأرقام', 'هنا الكلمات والإتقان والسلسلة وأيام النشاط. خريطة النشاط تعرض الأيام التي تعلمت فيها.'],
    ['titles', '#profileTitlePicker', 'ألقاب إنجازاتك', 'الألقاب المفتوحة تظهر هنا. عندما تحصل على لقب يمكنك اختياره ليظهر بجانب اسمك.'],
    ['appearance', '#profileAppearanceSection', 'اختر المظهر الذي يريحك', 'الثيمات تفتح بحسب مستواك. واحة الهدوء تدعم الفاتح والداكن. جرّب المتاح إن أحببت؛ لا يلزم تغيير مظهرك.'],
    ['settings', '.profile-settings-section', 'إعدادات تناسب جهازك', 'اضبط الأداء حسب جهازك، وعدّل اهتماماتك هنا. ويتوفر دليل اختصارات للوحة المفاتيح.'],
    ['account', '.profile-account-section', 'حسابك وحفظ تقدمك', 'من هنا تسجّل الدخول لحفظ التقدم أو تدير جلستك الحالية. لن نطلب منك الخروج أثناء الجولة.'],
    ['ready', '#wordInput', 'خطوتك التالية', 'أضف كلمات تهمك، وتابع تعلّمها واختبار نفسك. مع تقدمك تفتح الميزات؛ ابحث عن النقاط الحمراء ودعوات «استكشفني» في الإشعارات. اختر ما تريد استكشافه في وقته.'],
  ];

  function owner() { return root.auth?.currentUser?.uid ? `user:${root.auth.currentUser.uid}` : 'guest'; }
  function key(forOwner = owner()) { return `${KEY_PREFIX}${forOwner}`; }
  function read(forOwner = owner()) {
    try {
      const value = JSON.parse(localStorage.getItem(key(forOwner)) || 'null');
      if (value?.version !== VERSION || !['awaiting-journey', 'intro', 'awaiting-first-word', 'completed'].includes(value.phase)) return null;
      return { ...value, step: Math.max(0, Math.min(STEPS.length - 1, Math.floor(Number(value.step) || 0))) };
    } catch (_) { return null; }
  }
  function write(value, forOwner = owner()) {
    const next = { ...value, version: VERSION, updatedAt: Date.now() };
    localStorage.setItem(key(forOwner), JSON.stringify(next));
    if (forOwner !== 'guest' && forOwner === owner()) root.queueProfileIntent?.({ type: 'onboarding', tour: 'personal-dictionary', state: next });
    return next;
  }
  function statsSeen(key = owner()) {
    if (statsChoices.has(key)) return true;
    try {
      const state = localStorage.getItem(STATS_KEY_PREFIX + key);
      return state === 'completed' || state === 'skipped';
    } catch (_) { return false; }
  }

  function closeStatsGuide() {
    statsVisit?.observer.disconnect();
    statsVisit = null;
    root.LootLinguaPopover?.closeIf?.(STATS_COACH_ID, { silent: true });
  }

  function showStatsGuide() {
    const visit = statsVisit;
    if (!visit) return;
    const { panel, key } = visit;
    if (key !== owner() || !panel.isConnected || panel.getAttribute('aria-hidden') === 'true') {
      closeStatsGuide(); return;
    }
    const state = read();
    const stepIndex = STEPS.findIndex(([id]) => id === 'full-stats');
    if (root.LootLinguaGuide?.covered('full-stats') || statsSeen(key) || state?.phase === 'completed' || state?.step > stepIndex) {
      closeStatsGuide(); return;
    }
    const popover = root.LootLinguaPopover;
    const busy = root.LootLinguaGateLessonView?.isOpen?.() || root.LootLinguaGuide?.quizInFront() || document.hidden || root.__entryExperienceActive || root.__lootlinguaAuthResolved === false ||
      root.hasActiveLearningQuiz?.() || root.__lootlinguaRunnerInputActive || root.__lootlinguaQuizLearningCommitDepth > 0 ||
      document.documentElement.classList.contains('journey-auth-active') ||
      document.body.matches('.quiz-active, .published-placement-mode') || panel.closest('[inert]') ||
      [...document.querySelectorAll('#quizViewCard, #publishedGateQuizPicker, .published-gate-clear-view, #appAuthDialogShell, [aria-busy="true"], .operation-status-long-wait, #toastMessage.show')].some(node =>
        node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    if (busy) { popover?.closeIf?.(STATS_COACH_ID, { silent: true }); return; }
    if (visit.shown || !panel.classList.contains('show') || popover?.getActiveId?.()) return;

    const [, , titleText, text] = STEPS[stepIndex];
    const anchor = panel.querySelector('#statsPanelTitle');
    if (!anchor?.getClientRects().length) return;
    const content = document.createElement('div');
    content.className = 'feature-mini-onboarding-content';
    const title = document.createElement('strong');
    title.id = 'contextualStatsTitle'; title.textContent = titleText;
    const copy = document.createElement('p'); copy.textContent = text;
    const actions = document.createElement('div'); actions.className = 'feature-mini-onboarding-actions';
    for (const [label, status, buttonClass] of [
      ['فهمت', 'completed', 'feature-mini-onboarding-next'],
      ['تخطي', 'skipped', 'feature-mini-onboarding-skip'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = buttonClass; button.textContent = label;
      button.addEventListener('click', () => {
        if (statsVisit !== visit || owner() !== key) return;
        root.LootLinguaGuide?.acknowledge('full-stats', status === 'completed' ? 'seen' : 'dismissed');
        statsChoices.add(key);
        try { localStorage.setItem(STATS_KEY_PREFIX + key, status); } catch (_) { /* Keep this choice for the current page. */ }
        closeStatsGuide();
      });
      actions.append(button);
    }
    content.append(title, copy, actions);
    visit.shown = Boolean(popover?.open({
      id: STATS_COACH_ID, className: 'lootlingua-popover feature-mini-onboarding-coach',
      anchor, content, labelledBy: title.id, persistent: true, yieldToHelp: true,
    }));
  }

  function onStatsOpened(panel, hasUsefulStats) {
    closeStatsGuide();
    const state = read();
    if (root.LootLinguaPopover?.getActiveId?.() === COACH_ID && STEPS[state?.step]?.[0] !== 'full-stats') {
      fullTourRequested = false;
      pausedForOverlay = true;
      closeCoach(); offerResume(state);
    }
    if (!hasUsefulStats || typeof MutationObserver !== 'function') return;
    // Observe only during this open panel, so an interrupted explanation can
    // wait for the current action without polling or loading more data.
    const observer = new MutationObserver(showStatsGuide);
    statsVisit = { panel, key: owner(), observer, shown: false };
    observer.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden', 'aria-busy', 'style', 'inert', 'open'] });
    showStatsGuide();
  }

  function advance(allowSurfaceOpen = false) {
    const state = read();
    if (!state || state.phase === 'completed') return;
    const step = Math.min(STEPS.length - 1, (Number(state.step) || 0) + 1);
    write({ ...state, step });
    renderStep({ allowSurfaceOpen });
  }
  function onDictionary() { return root.getOnboardingView?.() === 'personal'; }
  function closeCoach() {
    renderToken += 1;
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
  }
  function offerResume(state) {
    const resume = !root.LootLinguaGuide && state && !['completed', 'awaiting-journey'].includes(state.phase) && !root.__entryExperienceActive;
    root.LootLinguaPopover?.offerResume?.(COACH_ID, resume ? {
      label: 'تابع إرشاد قاموسك',
      priority: 3,
      open: () => {
        const smart = root.LootLinguaSmartOnboarding;
        if (smart?.busy()) return;
        smart?.close();
        root.LootLinguaFeatureMiniOnboarding?.pause?.();
        pausedForOverlay = false;
        if (!onDictionary() && state.step !== 0) root.loadPersonalDictionary?.();
        fullTourRequested = true;
        renderStep({ allowSurfaceOpen: true });
      },
    } : null);
  }
  function renderStep({ allowSurfaceOpen = false } = {}) {
    const state = read();
    if (root.LootLinguaGuide || !state || ['completed', 'awaiting-journey'].includes(state.phase) || root.__entryExperienceActive ||
        document.getElementById('appAuthDialogShell')?.hidden === false) {
      closeCoach(); offerResume(null); return;
    }
    const smart = root.LootLinguaSmartOnboarding;
    if (smart && (!fullTourRequested || smart.busy())) {
      closeCoach(); offerResume(state); return;
    }
    const index = Number(state.step) || 0;
    const statsOpen = document.getElementById('statsPanel')?.getAttribute('aria-hidden') === 'false';
    if ((index !== 0 && !onDictionary()) || pausedForOverlay || (statsOpen && (statsVisit || STEPS[index][0] !== 'full-stats'))) {
      closeCoach(); offerResume(state); return;
    }
    let [id, selector, titleText, text, action] = STEPS[index] || STEPS[0];
    const draft = root.getPersonalDictionarySearchDraft?.();
    const requiresFirstWord = state.requiresFirstWord && owner() === 'guest';
    if (!requiresFirstWord && index === 2 && draft?.status !== 'success') {
      selector = '#normalSearchZone';
      text = 'عند البحث، تظهر المعاني هنا. اختر المعنى الأنسب للكلمة التي تريد حفظها.';
    }
    if (!requiresFirstWord && index === 3 && !draft?.expanded) {
      selector = '#addFormToggle';
      text = 'افتح الحقول الإضافية لكتابة المعنى، ثم اضغط «إضافة للقاموس» عندما تكون جاهزًا.';
    }
    if (requiresFirstWord && index >= 1 && index <= 3) {
      if (index === 2 && draft?.meaning && draft.expanded) {
        advance(); return;
      }
      if (index === 1 && draft?.status === 'success' && !draft.meaning) {
        advance(); return;
      }
      if (draft?.status === 'pending') {
        closeCoach();
        offerResume(null);
        return; // The durable search will announce its result on this surface.
      }
      if (!draft?.meaning && (index >= 2 || draft?.locked || ['blocked', 'empty', 'error', 'interrupted'].includes(draft?.status))) {
        if (draft?.status === 'success') {
          selector = '#suggestionsList'; titleText = STEPS[2][2]; text = STEPS[2][3]; action = 'meaning';
          if (draft.hidden) {
            selector = '#suggestionsList .dictionary-search-recovery';
            text = 'اضغط «عرض المعاني» لاسترجاع نتائجك، ثم اختر المعنى المناسب.';
          }
        } else if (draft?.status || draft?.locked) {
          selector = draft.expanded ? '#meaningInput' : '#addFormToggle';
          titleText = 'أضف معنى يدويًا';
          text = 'تقدر تسترجع نتيجة بحثك إن ظهرت، أو تكتب المعنى في الحقول الإضافية وتحفظ الكلمة.';
          action = 'manual';
        } else {
          selector = '#searchBtn'; titleText = STEPS[1][2]; text = STEPS[1][3]; action = 'search';
        }
      }
    }
    if (requiresFirstWord && index === 1 && draft?.meaning && draft.expanded) {
      write({ ...state, step: 3 }); renderStep(); return;
    }
    const currentOwner = owner();
    const token = ++renderToken;
    root.LootLinguaPopover?.closeIf?.('guidedFirstJourneyCoach', { silent: true });
    if (action === 'search') {
      const input = document.getElementById('wordInput');
      if (input && !input.value) { input.value = 'journey'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    if (id === 'full-stats' && !document.getElementById('statsPanel')?.classList.contains('show')) {
      if (!allowSurfaceOpen) { closeCoach(); offerResume(state); return; }
      root.closeProfileModal?.(true); root.openStatsPanel?.({ fromTour: true });
    }
    if (index >= 8 && index <= 15 && id !== 'full-stats') {
      if (!document.getElementById('profileModal')?.classList.contains('open')) {
        if (smart && !allowSurfaceOpen) { closeCoach(); offerResume(state); return; }
        if (id === 'titles') root.closeStatsPanel?.(true);
        root.toggleProfileModal?.();
      }
    }
    if (id === 'ready' && (!smart || allowSurfaceOpen)) root.closeProfileModal?.(true);
    let attempts = 0;
    const show = () => {
      if (token !== renderToken || currentOwner !== owner() || (index !== 0 && !onDictionary())) return;
      if (smart?.busy() || statsVisit || (id !== 'full-stats' && document.getElementById('statsPanel')?.getAttribute('aria-hidden') === 'false')) {
        offerResume(state); return;
      }
      const target = document.querySelector(selector);
      if (!target?.getClientRects().length) {
        if (++attempts < 30) setTimeout(show, 100);
        else offerResume(state);
        return; // Keep the checkpoint: a missing target is never completion.
      }
      target.scrollIntoView?.({ block: 'center', behavior: 'instant' });
      const content = document.createElement('div');
      content.className = 'personal-dictionary-onboarding-content';
      const title = document.createElement('strong'); title.textContent = titleText;
      const copy = document.createElement('p'); copy.textContent = text;
      content.append(title, copy);
      if (!action || (!requiresFirstWord && ['search', 'meaning', 'saved'].includes(action))) {
        const next = document.createElement('button'); next.type = 'button'; next.className = 'entry-primary';
        const transition = { stats: 'افتح الإحصائيات', 'full-stats': 'افتح الملف الشخصي', account: 'ارجع للقاموس' };
        next.textContent = id === 'ready' ? 'يلا نكمل التعلّم' : transition[id] || 'التالي';
        next.addEventListener('click', () => id === 'ready' ? finish(read()) : advance(true));
        content.append(next);
      }
      const popover = root.LootLinguaPopover;
      const actions = action === 'manual'
        ? (target.matches('#addFormToggle') ? [target] : [])
        : (action ? [target] : []);
      const shown = popover?.open({
        id: COACH_ID, className: 'lootlingua-popover personal-dictionary-onboarding-coach', anchor: target,
        content, persistent: true, yieldToHelp: true, reading: { step: `${index}:${selector}`, text, actions },
      });
      offerResume(shown ? null : state);
    };
    setTimeout(show, 60);
  }
  function currentJourneyCompleted() {
    const state = root.LootLinguaGuidedFirstJourney?.getState?.();
    return state?.phase === 'completed';
  }

  function migrateGuestState() {
    const user = root.auth?.currentUser;
    if (!user?.uid) return;
    const guest = read('guest');
    const account = read(`user:${user.uid}`);
    if (!guest) return;
    const selected = account?.phase === 'completed' ? account
      : guest.phase === 'completed' ? guest
      : account && Number(account.step || 0) > Number(guest.step || 0) ? account : guest;
    write({ ...selected, migratedFromGuestAt: Date.now() }, `user:${user.uid}`);
    localStorage.removeItem(key('guest'));
  }

  function finish(state) {
    if (!state || state.phase === 'completed') return state;
    const next = write({ ...state, phase: 'completed', completedAt: Date.now() });
    fullTourRequested = false;
    closeCoach();
    offerResume(null);
    root.dispatchEvent(new CustomEvent('lootlingua:personal-dictionary-onboarding-change', { detail: { state: next } }));
    return next;
  }

  function routeToDictionary(state) {
    if (!state || state.phase === 'completed') return;
    const phase = state.requiresFirstWord ? 'awaiting-first-word' : 'intro';
    const next = state.phase === 'awaiting-journey' ? write({ ...state, phase }) : state;
    if (!root.LootLinguaSmartOnboarding && !onDictionary()) root.loadPersonalDictionary?.();
    if (next !== state) root.dispatchEvent(new CustomEvent('lootlingua:personal-dictionary-onboarding-change', { detail: { state: next } }));
    renderStep();
    return next;
  }

  function continueWhenReady() {
    const state = read();
    if (!state || state.phase === 'completed') return;
    if (root.__entryExperienceActive) return;
    if (state.phase === 'awaiting-journey') return;
    if (fullTourRequested) renderStep();
    else offerResume(state);
  }

  const api = {
    beginGuestDictionary() {
      const state = read();
      if (!state || state.phase === 'completed') return;
      if (state.phase !== 'awaiting-journey') { renderStep(); return; }
      write({ ...state, phase: 'awaiting-first-word', step: 0 });
      root.dispatchEvent(new CustomEvent('lootlingua:personal-dictionary-onboarding-change', { detail: { state: read() } }));
      renderStep();
    },
    planForFirstJourney({ requiresFirstWord = false } = {}) {
      const existing = read();
      if (existing) return existing;
      const state = write({
        version: VERSION,
        phase: 'awaiting-journey',
        requiresFirstWord: requiresFirstWord === true,
        startedAt: Date.now(),
        completedAt: 0,
      });
      root.dispatchEvent(new CustomEvent('lootlingua:personal-dictionary-onboarding-change', { detail: { state } }));
      return state;
    },
    getState: () => read(),
    isPresenting: () => root.LootLinguaPopover?.getActiveId?.() === COACH_ID,
    pause() {
      if (!api.isPresenting()) return;
      fullTourRequested = false;
      closeCoach(); offerResume(read());
    },
    getStep(id) {
      const step = STEPS.find(([stepId]) => stepId === id);
      return step && { selector: step[1], title: step[2], text: step[3] };
    },
    hasCoveredStep(id) {
      const index = STEPS.findIndex(([stepId]) => stepId === (id === 'mastery-result' ? 'xp' : id));
      const state = read();
      return index >= 0 && Boolean(state && (state.phase === 'completed' || state.step > index));
    },
    onStatsOpened,
    continueWhenReady,
  };
  Object.defineProperty(root, 'LootLinguaPersonalDictionaryOnboarding', { value: Object.freeze(api), configurable: false });

  root.addEventListener('lootlingua:guided-first-journey-change', () => continueWhenReady());
  root.addEventListener('lootlingua:onboarding-cloud-change', () => {
    continueWhenReady();
  });
  root.addEventListener('lootlingua:dictionary-navigation', () => { fullTourRequested = false; closeStatsGuide(); closeCoach(); });
  root.addEventListener('lootlingua:popover-closed', event => {
    if (statsVisit) queueMicrotask(showStatsGuide);
    if (fullTourRequested && event.detail?.id === COACH_ID) offerResume(read());
  });
  document.addEventListener('visibilitychange', showStatsGuide);
  root.addEventListener('lootlingua:surface-ready', () => continueWhenReady());
  root.addEventListener('lootlingua:entry-closed', () => continueWhenReady());
  root.addEventListener('lootlingua:auth-dialog-opened', closeCoach);
  root.addEventListener('lootlingua:auth-dialog-closed', () => continueWhenReady());
  root.addEventListener('lootlingua:profile-guide-closed', () => {
    const state = read();
    if (!state || state.phase === 'completed' || state.step < 8 || state.step > 15) return;
    fullTourRequested = false;
    pausedForOverlay = true;
    closeCoach(); offerResume(state);
  });
  root.addEventListener('lootlingua:dictionary-word-saved', (event) => {
    if (event.detail?.scope && event.detail.scope !== 'personal') return;
    const state = read();
    if (state && state.phase !== 'completed' && state.phase !== 'awaiting-journey' && Number(state.step) <= 3) {
      write({ ...state, firstWordSavedAt: Date.now(), step: 4 }); renderStep();
    }
  });
  root.addEventListener('lootlingua:dictionary-search-result', (event) => {
    const state = read();
    if (!state || !['intro', 'awaiting-first-word'].includes(state.phase) || !onDictionary() ||
        state.step < 1 || state.step > 3 || event.detail?.type !== 'normal' ||
        !event.detail.scope?.endsWith(':personal')) return;
    if (state.step === 1 && event.detail.status === 'success') advance();
    else renderStep();
  });
  root.addEventListener('lootlingua:dictionary-meaning-selected', (event) => {
    const state = read();
    if (!onDictionary() || !event.detail?.scope?.endsWith(':personal') || state?.step < 1 || state?.step > 3 ||
      !['intro', 'awaiting-first-word'].includes(state?.phase)) return;
    write({ ...state, step: 3 }); renderStep();
  });
  root.addEventListener('lootlingua:dictionary-meaning-edited', () => {
    const state = read();
    if (!onDictionary() || !state || !['intro', 'awaiting-first-word'].includes(state.phase) ||
        state.step < 1 || state.step > 3) return;
    if (root.getPersonalDictionarySearchDraft?.()?.meaning.trim() && state.step !== 3) write({ ...state, step: 3 });
    renderStep();
  });
  document.addEventListener('click', (event) => {
    const state = read();
    if (onDictionary() && state?.step >= 1 && state.step <= 3 && event.target.closest?.('#addFormToggle')) setTimeout(renderStep, 0);
  });
  document.addEventListener('click', (event) => {
    const state = read();
    if (!state || ['awaiting-journey', 'completed'].includes(state.phase)) return;
    const step = STEPS[Number(state.step) || 0];
    if (step?.[4] !== 'click' || !event.target.closest?.(step[1]) ||
        !root.LootLinguaPopover?.canAct?.(COACH_ID)) return;
    const currentOwner = owner();
    const requested = fullTourRequested;
    setTimeout(() => {
      if (currentOwner !== owner() || read()?.step !== state.step) return;
      if (requested && onDictionary()) fullTourRequested = true;
      advance();
    }, 0);
  }, true);
  root.addEventListener('lootlingua:auth-state', () => {
    fullTourRequested = false; closeStatsGuide(); closeCoach(); offerResume(null); pausedForOverlay = false; migrateGuestState(); setTimeout(continueWhenReady, 0);
  });
  root.addEventListener('lootlingua:initial-data-ready', () => { migrateGuestState(); setTimeout(continueWhenReady, 0); });
})(window);
