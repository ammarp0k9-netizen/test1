(function attachSmartOnboarding(root) {
  'use strict';
  const id = 'contextualOnboardingCoach';
  const prefix = 'lootlingua:contextual-onboarding:v1:';
  const memory = new Set();
  let request = null;
  let inlineCoach = null;
  let highlighted = null;
  let handledDiscoverySurface = '';
  let resumeOwner = "";
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

  function canShow(anchor, checkViewport = true) {
    if (!visible(anchor) || anchor.disabled || busy() || root.LootLinguaGuide?.isPresenting?.()) return false;
    const openPopover = root.LootLinguaPopover?.getActiveId?.();
    if (openPopover && openPopover !== id) return false;
    if (checkViewport) {
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= root.innerHeight || rect.right <= 0 || rect.left >= root.innerWidth) return false;
    }
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
  function close() {
    inlineCoach?.remove();
    inlineCoach = null;
    highlighted?.classList.remove('coach-highlight-target');
    highlighted = null;
    root.LootLinguaPopover?.closeIf?.(id, { silent: true });
  }
  function ownPopover() { return root.LootLinguaPopover?.getActiveId?.() === id; }
  function presenting() { return ownPopover() || Boolean(inlineCoach?.isConnected); }
  function reset() { request = null; close(); }
  const guideHandled = (step, discovery) => discovery
    ? root.LootLinguaGuide?.status?.(step) === 'dismissed' : covered(step);

  function offer(step, options = {}) {
    if (guideHandled(step, options.discovery)) return;
    const original = legacy()?.getStep?.(step);
    const lesson = { ...original, ...options, step, owner: owner(), shown: false };
    if (!lesson.selector || !lesson.text || (request?.step === step && request?.selector === lesson.selector)) return;
    if (presenting() && request?.when?.() !== false && !lesson.explicit) return;
    reset();
    request = lesson;
    schedule();
  }

  function present() {
    const lesson = request;
    if (!lesson) return false;
    const anchor = get(lesson.selector);
    if (lesson.owner !== owner() || guideHandled(lesson.step, lesson.discovery) || (lesson.when && !lesson.when())) {
      reset(); return false;
    }
    if (!canShow(anchor, !lesson.inline || !presenting())) {
      if (presenting()) lesson.shown = false;
      close(); return false;
    }
    const popover = root.LootLinguaPopover;
    if (presenting() || popover?.getActiveId?.()) return presenting();
    const content = document.createElement('div');
    content.className = lesson.inline ? 'contextual-guide-inline' : 'feature-mini-onboarding-content';
    const title = document.createElement('strong');
    title.id = 'contextualOnboardingTitle'; title.textContent = lesson.title;
    const text = document.createElement('p'); text.textContent = lesson.text;
    const actions = document.createElement('div'); actions.className = 'feature-mini-onboarding-actions';
    for (const [label, status, className] of [
      [lesson.actionLabel || 'فهمت', 'completed', 'feature-mini-onboarding-next'],
      [lesson.dismissLabel || (lesson.inline ? 'إخفاء' : 'تخطي'), 'skipped', 'feature-mini-onboarding-skip'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label; button.className = className;
      button.addEventListener('click', () => {
        if (lesson !== request || lesson.owner !== owner()) return;
        const returnFocus = lesson.inline && content.contains(document.activeElement);
        if (lesson.discovery || root.LootLinguaGuide?.discoveryTopics?.includes(lesson.step)) {
          handledDiscoverySurface = discoverySurfaceKey();
        }
        if (status !== 'completed' || lesson.acknowledgeOnAccept !== false) remember(lesson.step, status);
        reset();
        if (status === 'skipped') lesson.onDismiss?.();
        if (status === 'completed' && lesson.onAccept) {
          lesson.onAccept();
          return;
        }
        if (returnFocus) (get(lesson.focusReturn) || (anchor.matches?.('button, a, input') ? anchor :
          anchor.querySelector?.('button, a, input')))?.focus();
      });
      actions.append(button);
    }
    content.append(title, text, actions);
    if (lesson.inline) {
      content.id = id;
      content.setAttribute('role', 'region');
      content.setAttribute('aria-labelledby', title.id);
      const position = lesson.highlight ? anchor.closest('.published-journey-actions') || anchor.parentElement : anchor;
      position[lesson.inline](content);
      inlineCoach = content;
      if (lesson.highlight) {
        highlighted = anchor;
        highlighted.classList.add('coach-highlight-target');
      }
      lesson.shown = true;
      return true;
    }
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
      if (coordinatesLegacy()) {
        updateDictionaryResume();
        if (!request) contextualSurface();
        present();
        updateDiscoveryMarker();
      } else if (!present()) root.LootLinguaFeatureMiniOnboarding?.resumeOnSurface?.();
    }, 90);
  }

  function coordinatesLegacy() { return Boolean(root.LootLinguaGuide?.isPresenting); }

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
  const gateQuizSetup = () => view() === 'quiz' && visible(get('#quizReturnToGate'));
  const generalModes = () => view() === 'quiz' && setupOrigin === 'general' &&
    visible(get('#quizViewSetup')) && !gateQuizSetup();

  function worldsIntro() {
    const selector = '.published-hub-intro';
    const onWorlds = () => view() === 'worlds' && Boolean(get(selector));
    if (!root.LootLinguaGuide || !onWorlds() || covered('lesson-started')) return;
    offer('worlds', {
      selector, when: onWorlds, inline: 'after', focusReturn: '[data-guided-world]',
      title: 'ابدأ من مجال تحبّه',
      text: 'العوالم قواميس جاهزة لمجالات مختلفة. اختار عالم مهتم فيه وابدأ تعلّم كلماته.',
    });
  }

  function dictionaryEntry() {
    if (root.LootLinguaGuide) {
      if (onDictionary() && !draft()?.word?.trim()) offer('dictionary', {
        selector: '#normalSearchZone', when: onDictionary, inline: 'before', focusReturn: '#wordInput',
        title: 'قاموسك الشخصي',
        text: 'تجد هنا كلمات العوالم وكلماتك الخاصة. لإضافة كلمة، اكتبها واضغط «ابحث عن معنى».',
      });
      return;
    }
    if (onDictionary()) dictionaryLesson();
    else {
      const needsDictionary = () => {
        const state = legacy()?.getState?.();
        return !onDictionary() && state?.step === 0 && ['intro', 'awaiting-first-word'].includes(state.phase);
      };
      if (needsDictionary()) offer('dictionary', { when: needsDictionary });
    }
  }

  function journeyButton(topic, selector, title, text) {
    offer(topic, {
      selector, title, text, inline: 'after', highlight: true, focusReturn: selector,
      when: () => view() === 'worlds' && Boolean(get(selector)),
    });
  }

  function gateLesson() {
    if (view() !== 'worlds') return;
    if (coordinatesLegacy()) {
      const review = 'button[data-onboarding-gate-review="due"]:not(:disabled)';
      if (get(review)) journeyButton('gate-review', review, 'حان وقت المراجعة', 'اضغط «ابدأ المراجعة الرسمية» لتراجع كلمات هذه البوابة.');
      return;
    }
    const status = get('[data-onboarding-gate-review]');
    if (!status) return;
    const condition = status.dataset.onboardingGateReview;
    if (condition === 'due') {
      offer('gate-review', {
        selector: '[data-onboarding-gate-review="due"]', title: 'حان وقت المراجعة',
        text: 'من هنا تراجع كلمات هذه البوابة عندما يحين موعدها.',
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

  const introButtons = [
    ['gate-start', 'button[data-guide-start-world]:not(:disabled)', 'ابدأ من أول بوابة', '«ابدأ من البداية» يفتح لك أول بوابة في هذا العالم.'],
    ['lesson', 'button[data-guide-learn-gate]:not(:disabled)', 'تعلّم كلمات البوابة', 'من هون بتبلّش تتعلّم كلمات هالبوابة.'],
  ];

  const discoverySurfaceKey = () => owner() + ':' + view() + ':' + (root.location?.pathname || '');
  const availableDiscovery = () => root.LootLinguaGuide?.discoveryTopic?.(topic =>
    root.LootLinguaFeatureDiscovery?.canShowInvitation(topic) === true) || '';
  const dictionaryInvitationPending = () => availableDiscovery() === 'dictionary';
  const discoverySurfaces = ['worlds', 'personal', 'quiz', 'treasure', 'starred', 'customWorld'];
  const discoveryReady = () => discoverySurfaces.includes(view()) && !busy() && !root.LootLinguaGuide?.isPresenting?.() &&
    !root.LootLinguaModalFocus?.currentSurface?.() && !visible(get('#notificationsPanel')) &&
    handledDiscoverySurface !== discoverySurfaceKey();

  function openDictionaryInvitation() {
    if (busy() || root.LootLinguaGuide?.isPresenting?.()) return false;
    if (root.loadPersonalDictionary?.() === false || !onDictionary()) return false;
    const heading = get('.page-header h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    return true;
  }

  function updateDictionaryResume() {
    const guide = root.LootLinguaGuide;
    const resume = dictionaryInvitationPending() && guide?.status?.('dictionary-invitation') === 'seen' &&
      !onDictionary() && discoveryReady();
    const nextOwner = resume ? owner() : '';
    if (nextOwner === resumeOwner) return;
    resumeOwner = nextOwner;
    root.LootLinguaPopover?.offerResume?.('dictionaryDiscovery', resume ? {
      label: 'تابع شرح القاموس الشخصي', priority: 2, open: openDictionaryInvitation,
    } : null);
  }

  function contextualSurface() {
    if (gateQuizSetup()) {
      offerDiscovery('#quizReturnToGate', gateQuizSetup);
      return;
    }
    if (view() === 'worlds') {
      const intro = !covered('lesson-started') && introButtons.find(([topic, selector]) => !covered(topic) && get(selector));
      if (intro) { journeyButton(...intro); return; }
      worldsIntro();
      if (!request) gateLesson();
    } else if (onDictionary()) dictionaryEntry();
    if (!request) featureOnSurface();
    if (request) return;
    const surface = view();
    const anchor = surface === 'worlds' && get('.published-gate-journey') ? '.published-gate-journey' : '.page-header';
    if (discoverySurfaces.includes(surface)) {
      offerDiscovery(anchor, () => view() === surface);
    }
  }

  const features = {
    dictionary: ['personal', '#normalSearchZone', 'قاموسك الشخصي', 'بتقدر تجمع فيه كلماتك وتضيف كلمات من اختيارك.', openDictionaryInvitation],
    quiz: ['quiz', '#quizViewSetup', 'الاختبار العام', 'هون تراجع كلمات قاموسك. المراجعة الرسمية لكل بوابة تفتحها من البوابة نفسها.', () => root.loadQuizView?.()],
    treasure: ['treasure', '#dailyLootChest', 'الكنز', 'هون بتلقى مكافآت تعلّمك.', () => root.loadTreasureView?.()],
    starred: ['starred', '#starredSearchBar', 'الكلمات الصعبة', 'تظهر هنا الكلمات اللي وضعت عليها نجمة.', () => root.loadStarredView?.()],
    'custom-worlds': ['worlds', '#customWorldsPanel .world-card-add', 'عوالمي الخاصة',
      'اجمع كلمات من اختيارك في عالم خاص حتى ترجع لها بسهولة.', () => {
        root.loadWorldsView?.(); setTimeout(() => root.showCustomWorldsTab?.(), 0);
      }],
  };

  function onFeature(topic) {
    const [surface, selector] = features[topic];
    return view() === surface && visible(get(selector)) && !(topic === 'quiz' && gateQuizSetup());
  }

  function offerDiscovery(selector, onSurface) {
    const topic = availableDiscovery();
    if (!topic || !discoveryReady() || !visible(get(selector)) || onFeature(topic)) return;
    const invitation = topic + '-invitation';
    const accepted = root.LootLinguaGuide.status(invitation) === 'seen';
    if (topic === 'dictionary' && accepted) return;
    const [, , title, text] = features[topic];
    offer(invitation, {
      selector, title: (accepted ? 'تابع شرح ' : 'اكتشف ') + title, text, inline: 'after', discovery: topic,
      actionLabel: 'استكشفني', dismissLabel: 'لاحقًا',
      when: () => onSurface() && discoveryReady() && availableDiscovery() === topic && !onFeature(topic),
      onAccept: () => openFeature(topic),
    });
  }

  function updateDiscoveryMarker() {
    const topic = discoveryReady() ? availableDiscovery() : '';
    const dockView = topic === 'dictionary' ? 'personal' : topic;
    for (const button of document.querySelectorAll('#legendDock [data-dock-view]')) {
      const show = ['personal', 'quiz', 'treasure'].includes(dockView) && button.dataset.dockView === dockView;
      if (show) button.setAttribute('data-discovery-pending', topic);
      else button.removeAttribute('data-discovery-pending');
    }
  }

  function featureOnSurface() {
    for (const [topic, [, selector, title, text]] of Object.entries(features)) {
      if (topic === 'dictionary' || covered(topic) || !onFeature(topic)) continue;
      offer(topic, { selector, title, text, inline: 'before', when: () => onFeature(topic) });
      break;
    }
  }

  function openFeature(feature) {
    const entry = features[feature];
    if (!entry || busy() || root.LootLinguaGuide?.isPresenting?.()) return false;
    reset();
    entry[4]();
    schedule();
    return true;
  }

  async function qualifyDictionary(detail) {
    const guide = root.LootLinguaGuide;
    const uid = root.auth?.currentUser?.uid;
    const gate = detail?.officialReviewGate;
    if (!guide || !uid || detail?.ownerId !== uid || detail?.officialReviewCommitted !== true ||
        !gate?.worldId || !gate.rankId || !gate.gateId || covered('first-official-review')) return;
    const access = await root.LootLinguaJourneyCloud?.getGateLessonAccess?.(gate).catch(() => null);
    const complete = root.LootLinguaGateLesson?.complete;
    if (root.auth?.currentUser?.uid !== uid || !access?.confirmed || !complete?.(access.state, access.state?.wordIds)) return;
    guide.acknowledge('first-official-review');
    schedule();
  }

  root.addEventListener('lootlingua:profile-opened', () => {
    if (number('#xpValue') > 0 && !covered('xp')) offer('xp', { when: profileOpen });
    else offer('profile', { selector: '#profileModalTitle', text: 'هنا تشوف رتبتك وخبرتك وتلاقي إعداداتك.', when: profileOpen });
  });
  root.addEventListener('lootlingua:trusted-quiz-completed', event => {
    const detail = event.detail;
    void qualifyDictionary(detail);
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
    if (handledDiscoverySurface && handledDiscoverySurface !== discoverySurfaceKey()) handledDiscoverySurface = '';
    if (coordinatesLegacy()) {
      contextualSurface();
      updateDictionaryResume();
    } else {
      if (event.detail?.kind === 'published') { worldsIntro(); gateLesson(); }
      if (event.detail?.kind === 'view' && onDictionary()) dictionaryEntry();
    }
    schedule();
  });
  root.addEventListener('lootlingua:personal-dictionary-onboarding-change', dictionaryEntry);
  root.addEventListener('lootlingua:entry-closed', () => { if (!coordinatesLegacy()) worldsIntro(); schedule(); });
  root.addEventListener('lootlingua:gate-guide-state', () => coordinatesLegacy() ? schedule() : gateLesson());
  root.addEventListener('lootlingua:gate-lesson-changed', event => {
    if (event.detail?.uid !== root.auth?.currentUser?.uid || !root.LootLinguaGateLessonView?.isOpen?.()) return;
    root.LootLinguaGuide?.acknowledge('lesson-started');
    if (request && ['worlds', 'gate-start', 'lesson'].includes(request.step)) reset();
  });
  root.addEventListener('lootlingua:auth-state', () => {
    result = null; handledDiscoverySurface = ''; reset(); updateDiscoveryMarker(); schedule();
  });
  for (const name of ['entry-closed', 'onboarding-cloud-change', 'popover-closed', 'profile-guide-closed',
    'toast-idle', 'quiz-learning-commit-complete', 'initial-data-ready', 'auth-dialog-closed', 'feature-discovery-change',
    'guide-presentation-change', 'quiz-mode-changed', 'gate-lesson-closed']) {
    root.addEventListener('lootlingua:' + name, schedule);
  }
  root.addEventListener('lootlingua:guide-coverage-changed', () => {
    if (request && (guideHandled(request.step, request.discovery) || request.when?.() === false)) reset();
    if (coordinatesLegacy()) { updateDictionaryResume(); updateDiscoveryMarker(); schedule(); }
  });
  root.addEventListener('lootlingua:auth-dialog-opened', () => {
    if (ownPopover() && request) request.shown = false;
    close();
  });

  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('focusin', event => {
    if (event.target?.closest?.('#wordInput, #meaningInput') && !inlineCoach) dictionaryLesson();
    if (event.target?.closest?.('#streakWrap') && number('#streakCount') > 0) {
      offer('activity', { selector: '#streakWrap', when: () => number('#streakCount') > 0 });
    }
  });
  document.addEventListener('click', event => {
    const target = event.target;
    if (target.closest?.('#' + id)) return;
    if (onDictionary() && target.closest?.('[data-view="personal"], [data-dock-view="personal"], #normalSearchZone')) {
      root.LootLinguaGuide?.acknowledge('dictionary-visited');
    }
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
      const [step, control, when, selector, text] = context;
      offer(step, { when, explicit: true, ...(coordinatesLegacy() && { selector: selector || control }),
        ...(selector && { selector }), ...(text && { text }) });
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
    if (event.target?.closest?.('#streakWrap') && number('#streakCount') > 0) {
      offer('activity', { selector: '#streakWrap', when: () => number('#streakCount') > 0 });
    }
  });

  // Recheck pending guides when their surfaces change or busy work clears.
  const observe = () => new MutationObserver(() => {
    if (legacy()?.isPresenting?.() && busy()) legacy().pause();
    if (presenting() && request && (!canShow(get(request.selector), !request.inline) || (request.when && !request.when()))) {
      request.shown = false;
      close();
    }
    if (request && !request.shown) schedule();
    const mini = root.LootLinguaFeatureMiniOnboarding;
    mini?.suspendIfObstructed?.();
    if (coordinatesLegacy() || (timer === null && mini?.hasVisibleCheckpoint?.())) schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['aria-busy', 'aria-hidden', 'disabled', 'inert', 'class', 'hidden', 'open', 'style'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true });
  else observe();

  root.LootLinguaSmartOnboarding = Object.freeze({
    busy, canShow, close: reset, schedule, presenting, coordinatesLegacy, openFeature, dictionaryInvitationPending,
    isGeneralQuiz: () => setupOrigin === 'general',
  });
})(window);
