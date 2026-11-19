(function attachSmartOnboarding(root) {
  'use strict';
  const id = 'contextualOnboardingCoach';
  const prefix = 'lootlingua:contextual-onboarding:v1:';
  const memory = new Set();
  let request = null;
  let timer = null;
  let result = null;
  let setupOrigin = '';
  const owner = () => root.auth?.currentUser?.uid ? 'user:' + root.auth.currentUser.uid : 'guest';
  const view = () => root.getOnboardingView?.();
  const legacy = () => root.LootLinguaPersonalDictionaryOnboarding;
  const get = selector => document.querySelector(selector);
  const number = selector => Number.parseInt(get(selector)?.textContent, 10) || 0;
  const visible = element => Boolean(element?.isConnected && !element.closest('[hidden], [aria-hidden="true"], [inert]') &&
    element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');

  function busy() {
    if (document.hidden || root.__lootlinguaAuthResolved === false || root.__entryExperienceActive ||
        root.LootLinguaGateLessonView?.isOpen?.() ||
        root.__lootlinguaRunnerInputActive || root.hasActiveLearningQuiz?.() || root.__lootlinguaQuizLearningCommitDepth > 0 ||
        document.body.matches('.quiz-active, .published-placement-mode, .journey-auth-active') ||
        document.documentElement.classList.contains('journey-auth-active')) return true;
    return [...document.querySelectorAll(
      '#appAuthDialogShell, #publishedGateQuizPicker, .published-gate-clear-view, #quizViewCard, #quizResumeModal, ' +
      '#quizView > .operation-status, .operation-status-loading, .operation-status-long-wait, ' +
      '#customWorldSaveBtn:disabled, dialog.loot-bots[open], ' +
      '[aria-busy="true"], #toastMessage.show'
    )].some(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  }

  function canShow(anchor) {
    if (!visible(anchor) || busy()) return false;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= root.innerHeight || rect.right <= 0 || rect.left >= root.innerWidth) return false;
    const modal = root.LootLinguaModalFocus?.currentSurface?.();
    return !modal || modal.contains(anchor);
  }

  function seen(step, keyOwner = owner()) {
    const key = prefix + step + ':' + keyOwner;
    if (memory.has(key)) return true;
    try { return ['completed', 'skipped'].includes(localStorage.getItem(key)); }
    catch (_) { return false; }
  }

  function remember(step, choice, keyOwner = owner()) {
    if (root.LootLinguaGuide && keyOwner === owner()) {
      root.LootLinguaGuide.acknowledge(step, choice === 'completed' ? 'seen' : 'dismissed');
      return;
    }
    if (seen(step, keyOwner)) return;
    const key = prefix + step + ':' + keyOwner;
    memory.add(key);
    try { localStorage.setItem(key, choice); } catch (_) { /* Keep the choice in this page. */ }
  }

  function covered(step) { return root.LootLinguaGuide?.covered(step) ?? (seen(step) || legacy()?.hasCoveredStep?.(step) === true); }
  function close() { root.LootLinguaPopover?.closeIf?.(id, { silent: true }); }
  function ownPopover() { return root.LootLinguaPopover?.getActiveId?.() === id; }
  function reset() { request = null; close(); }

  function offer(step, options = {}) {
    if (covered(step)) return;
    const original = legacy()?.getStep?.(step);
    const lesson = { ...original, ...options, step, owner: owner(), shown: false };
    if (!lesson.selector || !lesson.text || (request?.step === step && request?.selector === lesson.selector)) return;
    reset();
    request = lesson;
    schedule();
  }

  function present() {
    const lesson = request;
    if (!lesson) return false;
    const anchor = get(lesson.selector);
    if (lesson.owner !== owner() || covered(lesson.step) || (lesson.when && !lesson.when())) {
      reset(); return false;
    }
    if (!canShow(anchor)) {
      if (ownPopover()) lesson.shown = false;
      close(); return false;
    }
    const popover = root.LootLinguaPopover;
    if (lesson.shown || popover?.getActiveId?.()) return ownPopover();
    const content = document.createElement('div');
    content.className = 'feature-mini-onboarding-content';
    const title = document.createElement('strong');
    title.id = 'contextualOnboardingTitle'; title.textContent = lesson.title;
    const text = document.createElement('p'); text.textContent = lesson.text;
    const actions = document.createElement('div'); actions.className = 'feature-mini-onboarding-actions';
    for (const [label, status, className] of [
      ['فهمت', 'completed', 'feature-mini-onboarding-next'],
      ['تخطي', 'skipped', 'feature-mini-onboarding-skip'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label; button.className = className;
      button.addEventListener('click', () => {
        if (lesson !== request || lesson.owner !== owner()) return;
        remember(lesson.step, status); reset();
      });
      actions.append(button);
    }
    content.append(title, text, actions);
    lesson.shown = Boolean(popover?.open({
      id, anchor, content, labelledBy: title.id, persistent: true, yieldToHelp: true,
      className: 'lootlingua-popover feature-mini-onboarding-coach',
    }));
    return lesson.shown;
  }

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (!present()) root.LootLinguaFeatureMiniOnboarding?.resumeOnSurface?.();
    }, 90);
  }

  const onDictionary = () => view() === 'personal';
  const draft = () => root.getPersonalDictionarySearchDraft?.();
  function dictionaryLesson() {
    const data = onDictionary() && draft();
    if (!data || data.status === 'pending') return;
    if (data.expanded && data.meaning?.trim()) {
      offer('save', { when: () => onDictionary() && Boolean(draft()?.expanded && draft()?.meaning?.trim()) });
    } else if (data.status === 'success' && !data.expanded) {
      offer('meaning', {
        ...(data.hidden ? { selector: '#suggestionsList .dictionary-search-recovery', text: 'اضغط «عرض المعاني» لاسترجاع النتائج، ثم اختر المعنى.' } : {}),
        when: () => onDictionary() && draft()?.status === 'success' && !draft()?.expanded,
      });
    } else if (data.expanded || data.locked || ['blocked', 'empty', 'error', 'interrupted'].includes(data.status)) {
      offer('manual-meaning', {
        selector: data.expanded ? '#meaningInput' : '#addFormToggle', title: 'أضف معنى يدويًا',
        text: 'تقدر تكتب المعنى في الحقول الإضافية وتحفظ الكلمة.',
        when: () => onDictionary() && !draft()?.meaning?.trim() && draft()?.status !== 'pending',
      });
    } else {
      offer('search', { text: 'اكتب كلمة، ثم اضغط «ابحث عن معنى».',
        when: () => onDictionary() && !draft()?.expanded && !draft()?.status });
    }
  }
  const profileOpen = () => get('#profileModal')?.classList.contains('open');
  const generalModes = () => view() === 'quiz' && setupOrigin === 'general' && visible(get('#quizViewSetup'));

  function dictionaryEntry() {
    if (root.LootLinguaGuide) return;
    if (onDictionary()) dictionaryLesson();
    else {
      const needsDictionary = () => {
        const state = legacy()?.getState?.();
        return !onDictionary() && state?.step === 0 && ['intro', 'awaiting-first-word'].includes(state.phase);
      };
      if (needsDictionary()) offer('dictionary', { when: needsDictionary });
    }
  }

  function gateLesson() {
    if (view() !== 'worlds') return;
    const status = get('[data-onboarding-gate-review]');
    if (!status) return;
    const condition = status.dataset.onboardingGateReview;
    if (condition === 'due') {
      offer('gate-review', {
        selector: '[data-onboarding-gate-review="due"]', title: 'المراجعة الرسمية',
        text: 'راجع كلمات هالبوابة هون. الإجابات الصح للكلمات الجاهزة ممكن ترفع استعدادها.',
        when: () => view() === 'worlds' && visible(get('[data-onboarding-gate-review="due"]')),
      });
    } else if (condition === 'waiting') {
      offer('gate-wait', {
        selector: '[data-onboarding-gate-review="waiting"]', title: 'المراجعة التالية',
        text: 'الموعد ظاهر هنا. خلال الانتظار تقدر تتدرّب بالأنماط المتاحة.',
        when: () => view() === 'worlds' && visible(get('[data-onboarding-gate-review="waiting"]')),
      });
    }
  }

  root.addEventListener('lootlingua:profile-opened', () => {
    if (root.LootLinguaGuide) return;
    if (number('#xpValue') > 0 && !covered('xp')) offer('xp', { when: profileOpen });
    else offer('profile', { selector: '#profileModalTitle', text: 'هنا تشوف رتبتك وخبرتك وتلاقي إعداداتك.', when: profileOpen });
  });
  root.addEventListener('lootlingua:trusted-quiz-completed', event => {
    const detail = event.detail;
    if (!detail?.correctCount || !detail.total || detail.ownerId !== (root.auth?.currentUser?.uid || 'guest') ||
        detail.journeyContext || detail.officialReviewGate || String(detail.source).startsWith('journey:') || covered('mastery-result')) return;
    if (!result) result = { owner: owner(), promotedCount: Number(detail.promotedCount) || 0 };
  });
  root.addEventListener('lootlingua:quiz-modes-opened', event => {
    if (event.detail?.origin) setupOrigin = event.detail.origin;
    if (generalModes()) {
      if (result?.owner === owner() && !covered('mastery-result')) {
        offer('mastery-result', {
          selector: '#quizAvailableCount', title: 'كيف تتقدّم كلماتك؟',
          text: result.promotedCount > 0
            ? 'الكلمات اللي تقدّمت في نتيجتك حققت شروط المراجعة المتباعدة.'
            : 'الإجابة الصح خطوة مفيدة. الترقية إلها شروط مراجعة متباعدة.',
          when: generalModes,
        });
      } else if (visible(get('#quizPracticeLock'))) {
        offer('personal-review', {
          selector: '#quizPracticeLock', title: 'حان وقت مراجعة قاموسك',
          text: 'اختر اختبار تقدّم بالقاموس الشخصي. التدريب يفتح بعد المراجعة.',
          when: () => generalModes() && visible(get('#quizPracticeLock')),
        });
      }
    }
    schedule();
  });
  root.addEventListener('lootlingua:dictionary-search-result', event => {
    if (!onDictionary() || event.detail?.type !== 'normal' || !event.detail.scope?.endsWith(':personal')) return;
    if (event.detail.status === 'success') remember('search', 'completed');
    reset(); dictionaryLesson();
  });
  root.addEventListener('lootlingua:dictionary-meaning-selected', event => {
    if (!onDictionary() || !event.detail?.scope?.endsWith(':personal')) return;
    remember('meaning', 'completed'); reset(); dictionaryLesson();
  });
  root.addEventListener('lootlingua:dictionary-meaning-edited', dictionaryLesson);
  root.addEventListener('lootlingua:dictionary-word-saved', event => {
    const detail = event.detail;
    if (!onDictionary() || detail?.scope !== 'personal' || detail.owner !== (root.auth?.currentUser?.uid || 'guest')) return;
    remember('save', 'completed'); remember('manual-meaning', 'completed'); reset();
    offer('ready', { when: onDictionary });
  });
  root.addEventListener('lootlingua:dictionary-navigation', () => { reset(); setupOrigin = ''; });
  root.addEventListener('lootlingua:surface-ready', event => {
    if (event.detail?.kind === 'published') gateLesson();
    if (event.detail?.kind === 'view' && onDictionary()) dictionaryEntry();
    schedule();
  });
  root.addEventListener('lootlingua:personal-dictionary-onboarding-change', dictionaryEntry);
  root.addEventListener('lootlingua:gate-guide-state', gateLesson);
  root.addEventListener('lootlingua:auth-state', () => { result = null; reset(); schedule(); });
  for (const name of ['entry-closed', 'onboarding-cloud-change', 'popover-closed', 'profile-guide-closed',
    'toast-idle', 'quiz-learning-commit-complete', 'initial-data-ready', 'auth-dialog-closed', 'feature-discovery-change']) {
    root.addEventListener('lootlingua:' + name, schedule);
  }
  root.addEventListener('lootlingua:guide-coverage-changed', () => {
    if (request && covered(request.step)) reset();
  });
  root.addEventListener('lootlingua:auth-dialog-opened', () => {
    if (ownPopover() && request) request.shown = false;
    close();
  });

  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('focusin', event => {
    if (event.target?.closest?.('#wordInput, #meaningInput')) dictionaryLesson();
    if (event.target?.closest?.('#streakWrap') && number('#streakCount') > 0) {
      offer('activity', { selector: '#streakWrap', when: () => number('#streakCount') > 0 });
    }
  });
  document.addEventListener('click', event => {
    const target = event.target;
    if (target.closest?.('#' + id)) return;
    if (target.closest?.('#lootlinguaGuide, #onboardingResume, .help-btn, [aria-label^="شرح"], [onclick*="showKeyboardShortcutsModal"]')) {
      reset(); return;
    }
    if (target.closest?.('#addFormToggle')) { reset(); dictionaryLesson(); return; }
    // Re-evaluate after the clicked control updates its existing surface.
    const context = [
      ['ranks', '#xpRanksGuideToggle', () => profileOpen() && visible(get('#xpRanksGuidePanel')), '#xpRanksGuidePanel', 'الخبرة ترفع رتبتك وتفتح الثيمات. هون بتشوف شروط كل رتبة.'],
      ['stats', '.profile-stats-mini', () => profileOpen() && Boolean(number('#profileStatWords') || number('#profileStatStreak'))],
      ['titles', '#profileTitlePicker', () => profileOpen() && Boolean(get('#profileTitlePicker .profile-title-chip, #profileTitlePicker button')), null, 'هون بتشوف الألقاب اللي فتحتها بإنجازاتك.'],
      ['appearance', '#profileAppearanceSection', profileOpen],
      ['settings', '.profile-settings-section', profileOpen],
      ['account', '.profile-account-section', profileOpen],
      ['notices', '#notifBtn', () => visible(get('#notificationsPanel')) && Boolean(get('#notificationsPanel .notif-item')), '#notificationsPanel'],
      ['quests', '#dailyQuestsBtn', () => visible(get('#dailyQuestsSheet')) && Boolean(get('#dailyQuestsList li')), '#dailyQuestsResetHint'],
    ].find(([, selector]) => target.closest?.(selector));
    if (context) {
      if (root.LootLinguaGuide && !['ranks', 'quests', 'stats'].includes(context[0])) return;
      const [step, , when, selector, text] = context;
      offer(step, { when, ...(selector && { selector }), ...(text && { text }) });
    }
  });
  document.addEventListener('scroll', event => {
    schedule();
    if (root.LootLinguaGuide || !profileOpen() || !event.target?.closest?.('#profileModal') || ownPopover()) return;
    for (const [step, selector] of [
      ['stats', '.profile-stats-mini'], ['titles', '#profileTitlePicker'],
      ['appearance', '#profileAppearanceSection'], ['settings', '.profile-settings-section'],
      ['account', '.profile-account-section'],
    ]) {
      const anchor = get(selector);
      const rect = anchor?.getBoundingClientRect();
      if (!rect || rect.top < 55 || rect.top > root.innerHeight - 120 || covered(step) ||
          (step === 'stats' && !number('#profileStatWords') && !number('#profileStatStreak')) ||
          (step === 'titles' && !get('#profileTitlePicker .profile-title-chip, #profileTitlePicker button'))) continue;
      offer(step, { when: profileOpen, ...(step === 'titles' && { text: 'هون بتشوف الألقاب اللي فتحتها بإنجازاتك.' }) });
      break;
    }
  }, true);
  document.addEventListener('pointerover', event => {
    if (root.LootLinguaGuide) return;
    if (event.target?.closest?.('#streakWrap') && number('#streakCount') > 0) {
      offer('activity', { selector: '#streakWrap', when: () => number('#streakCount') > 0 });
    }
  });

  // Recheck pending guides when their surfaces change or busy work clears.
  const observe = () => new MutationObserver(() => {
    if (legacy()?.isPresenting?.() && busy()) legacy().pause();
    if (ownPopover() && request && (!canShow(get(request.selector)) || (request.when && !request.when()))) {
      request.shown = false;
      close();
    }
    if (request && !request.shown) schedule();
    const mini = root.LootLinguaFeatureMiniOnboarding;
    mini?.suspendIfObstructed?.();
    if (timer === null && mini?.hasVisibleCheckpoint?.()) schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['aria-busy', 'aria-hidden', 'disabled', 'inert', 'class', 'hidden', 'open', 'style'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true });
  else observe();

  root.LootLinguaSmartOnboarding = Object.freeze({
    busy, canShow, close: reset, schedule,
    isGeneralQuiz: () => setupOrigin === 'general',
  });
})(window);
