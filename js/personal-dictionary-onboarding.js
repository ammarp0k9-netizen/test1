(function attachPersonalDictionaryOnboarding(root) {
  'use strict';

  // This is deliberately separate from Entry Experience and the public-gate
  // journey.  It records only the short hand-off to the personal dictionary.
  const VERSION = 1;
  const KEY_PREFIX = 'lootlingua:personal-dictionary-onboarding:v1:';
  const COACH_ID = 'personalDictionaryOnboardingCoach';
  let renderToken = 0;
  let pausedForOverlay = false;
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
  function advance() {
    const state = read();
    if (!state || state.phase === 'completed') return;
    const step = Math.min(STEPS.length - 1, (Number(state.step) || 0) + 1);
    write({ ...state, step });
    renderStep();
  }
  function onDictionary() { return root.getOnboardingView?.() === 'personal'; }
  function closeCoach() {
    renderToken += 1;
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
  }
  function offerResume(state) {
    const resume = state && !['completed', 'awaiting-journey'].includes(state.phase) && !root.__entryExperienceActive;
    root.LootLinguaPopover?.offerResume?.(COACH_ID, resume ? {
      label: 'تابع إرشاد قاموسك',
      open: () => {
        pausedForOverlay = false;
        if (!onDictionary()) root.loadPersonalDictionary?.();
        renderStep();
      },
    } : null);
  }
  function renderStep() {
    const state = read();
    if (!state || ['completed', 'awaiting-journey'].includes(state.phase) || root.__entryExperienceActive ||
        document.getElementById('appAuthDialogShell')?.hidden === false) {
      closeCoach(); offerResume(null); return;
    }
    const index = Number(state.step) || 0;
    if ((index !== 0 && !onDictionary()) || pausedForOverlay) {
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
      root.closeProfileModal?.(true); root.openStatsPanel?.();
    }
    if (index >= 8 && index <= 15 && id !== 'full-stats') {
      if (!document.getElementById('profileModal')?.classList.contains('open')) root.toggleProfileModal?.();
    }
    if (id === 'titles') { root.closeStatsPanel?.(true); if (!document.getElementById('profileModal')?.classList.contains('open')) root.toggleProfileModal?.(); }
    if (id === 'ready') root.closeProfileModal?.(true);
    let attempts = 0;
    const show = () => {
      if (token !== renderToken || currentOwner !== owner() || (index !== 0 && !onDictionary())) return;
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
        next.textContent = id === 'ready' ? 'يلا نكمل التعلّم' : 'التالي';
        next.addEventListener('click', () => id === 'ready' ? finish(read()) : advance());
        content.append(next);
      }
      const popover = root.LootLinguaPopover;
      const actions = action === 'manual'
        ? (target.matches('#addFormToggle') ? [target] : [])
        : (action ? [target] : []);
      const shown = popover?.open({
        id: COACH_ID, className: 'lootlingua-popover personal-dictionary-onboarding-coach', anchor: target,
        content, persistent: true, reading: { step: `${index}:${selector}`, text, actions },
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
    closeCoach();
    offerResume(null);
    root.dispatchEvent(new CustomEvent('lootlingua:personal-dictionary-onboarding-change', { detail: { state: next } }));
    return next;
  }

  function routeToDictionary(state) {
    if (!state || state.phase === 'completed') return;
    const phase = state.requiresFirstWord ? 'awaiting-first-word' : 'intro';
    const next = state.phase === 'awaiting-journey' ? write({ ...state, phase }) : state;
    if (!onDictionary()) root.loadPersonalDictionary?.();
    renderStep();
    return next;
  }

  function continueWhenReady() {
    const state = read();
    if (!state || state.phase === 'completed') return;
    if (root.__entryExperienceActive) return;
    if (state.phase !== 'awaiting-journey') { renderStep(); return; }
    const guided = root.LootLinguaGuidedFirstJourney?.getState?.();
    if (owner() === 'guest' && guided?.guestDictionaryAvailable) { api.beginGuestDictionary(); return; }
    if (state.phase === 'awaiting-journey' && !currentJourneyCompleted()) return;
    routeToDictionary(state);
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
    continueWhenReady,
  };
  Object.defineProperty(root, 'LootLinguaPersonalDictionaryOnboarding', { value: Object.freeze(api), configurable: false });

  root.addEventListener('lootlingua:guided-first-journey-change', () => continueWhenReady());
  root.addEventListener('lootlingua:onboarding-cloud-change', () => {
    continueWhenReady();
  });
  root.addEventListener('lootlingua:dictionary-navigation', closeCoach);
  root.addEventListener('lootlingua:surface-ready', () => continueWhenReady());
  root.addEventListener('lootlingua:entry-closed', () => continueWhenReady());
  root.addEventListener('lootlingua:auth-dialog-opened', closeCoach);
  root.addEventListener('lootlingua:auth-dialog-closed', () => continueWhenReady());
  root.addEventListener('lootlingua:profile-guide-closed', () => {
    const state = read();
    if (!state || state.phase === 'completed' || state.step < 8 || state.step > 15) return;
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
    else if (event.detail.status !== 'success') renderStep();
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
    setTimeout(() => {
      if (currentOwner === owner() && read()?.step === state.step) advance();
    }, 0);
  }, true);
  root.addEventListener('lootlingua:auth-state', () => {
    closeCoach(); offerResume(null); pausedForOverlay = false; migrateGuestState(); setTimeout(continueWhenReady, 0);
  });
  root.addEventListener('lootlingua:initial-data-ready', () => { migrateGuestState(); setTimeout(continueWhenReady, 0); });
})(window);
