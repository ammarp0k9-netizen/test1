(function attachFeatureMiniOnboarding(root) {
  'use strict';
  const COACH_ID = 'featureMiniOnboardingCoach';
  const FEATURE_NAMES = { treasure: 'الكنز', quiz: 'الاختبار', starred: 'الكلمات الصعبة', 'custom-worlds': 'العوالم الخاصة' };
  let activeFeature = '';
  let stepIndex = 0;
  let internalClose = false;
  let worldSaveHandled = false;
  let run = 0;

  const STEPS = Object.freeze({
    treasure: [
      { selector: '#dailyLootChest', title: 'صندوقك اليومي', text: 'اضغط الصندوق لفتح مكافأتك اليومية عندما يكون جاهزًا.' },
      { selector: '#treasureSlots', title: 'تقدّم المكافآت', text: 'هنا ترى الصناديق المتاحة وما يحتاج إلى مزيد من التقدّم.' },
      { selector: '#lootCountdownText', title: 'الوقت وشروط الفتح', text: 'هنا وقت عودة الصندوق أو شروط تحرير XP المقفلة. اتبع الحالة المعروضة؛ فتح الصندوق ليس مضمونًا قبل استيفائها.' },
      { selector: '#lootRewardPreview', title: 'المكافأة وسلسلة اللوت', text: 'هذه المنطقة تعرض توجيه المكافأة أو سلسلة الصناديق ورصيد تجميد السلسلة بحسب حالة الصندوق.' },
      { selector: '.treasure-title-strip', title: 'ألقابك', text: 'هنا تقدّم الألقاب، وتظهر الألقاب في القائمة عند تجهيزها. أكمل الإنجازات لتفتحها، ثم اختر لقبك من الملف الشخصي.' },
      { selector: '#motivationRewardsPanel', title: 'إنجازاتك ومكافآت التعلّم', text: 'تحت الألقاب تجد سجل مكافآت إتقان الكلمات ومحطات البوابات، وسبب كل جائزة XP. المكافآت الإضافية تُصرف مرة واحدة لكل إنجاز.' },
    ],
    quiz: [
      { selector: '#quizAvailableCount', title: 'راجع قاموسك كله', text: 'اختبار البوابة يراجع كلمات تلك البوابة فقط. هنا تراجع القاموس الشخصي أو المصدر الذي تختاره؛ استخدمه باستمرار لتثبيت كلماتك.' },
      { selector: '#quizViewSetup .quiz-modes-grid', title: 'اختر وضعًا لتجربته', text: 'ارفع إتقانك بالمطابقة أو الصندوق المشفّر أو الهروب من النسيان. لووت رنر وLoot Bots وبطاقات الذاكرة للتدريب.', click: '.quiz-mode-card' },
      { selector: '#quizSharedSettings .quiz-source-selector', title: 'مصدر الكلمات', text: 'اختر القاموس الشخصي لمراجعته، أو الكلمات الصعبة أو عالمًا خاصًا إذا كان لديك. المصدر يحدد الكلمات التي ستختبرها.' },
      { selector: '#quizSharedSettings [aria-label="عدد الأسئلة"]', title: 'حجم الجلسة', text: 'اختر عدد الأسئلة المناسب. قد تختلف الخيارات الفعلية حسب الوضع والكلمات المتاحة.' },
      { selector: '#quizStartButton', title: 'ابدأ عندما تكون جاهزًا', text: 'راجع الملخص واتجاه السؤال إن ظهر. بعد البدء اتبع تعليمات الوضع، وستظهر نتيجة أدائك عند إنهاء الجلسة.' },
    ],
    starred: [
      { selector: '#starredSearchBar', title: 'راجع الكلمات الصعبة', text: 'أي كلمة تضع عليها نجمة تظهر هنا لتعود إليها بسرعة.' },
      { selector: '#list', title: 'قائمة المراجعة', text: 'استخدم البحث والقائمة لإدارة كلماتك المعلّمة.' },
      { selector: '#starredSearchInput', title: 'النجمة لا تحذف الكلمة', text: 'ابحث عن كلماتك هنا. إزالة النجمة تزيلها من قائمة الصعبة فقط، وتبقى الكلمة في قاموسك. يمكنك اختيار الصعبة كمصدر في الاختبار.' },
    ],
    'custom-worlds': [
      { selector: '#customWorldsTab', title: 'عوالمك الخاصة', text: 'هذه مجموعاتك الشخصية، وهي مستقلة عن العوالم العامة والبوابات.' },
      { selector: '#worldsGrid .world-card-add', title: 'أنشئ عالمًا', text: 'أنشئ عالمًا خاصًا لتنظيم الكلمات التي تريد جمعها معًا.' },
      { selector: '#worldsGrid .world-card-add', title: 'الاسم والرمز', text: 'اضغط + لترى نموذج إنشاء عالمك. لن نحفظ عالمًا نيابة عنك.', click: '.world-card-add' },
      { selector: '#customWorldNameInput', title: 'مجموعة تعبر عنك', text: 'اختر اسمًا ورمزًا ووصفًا اختياريًا، ثم احفظ عندما تريد. يمكنك أيضًا إغلاق النموذج والإنشاء لاحقًا.' },
      { selector: '#customWorldSaveBtn', title: 'احفظ عالمك', text: 'بعد كتابة الاسم اضغط إنشاء عالم. ننتظر نجاح حفظه؛ أو اختر تخطي لتتعرف على تنظيم الكلمات دون إنشاء عالم الآن.', event: 'saved-world' },
      { selector: '#worldsGrid', title: 'نظّم كلماتك داخل العالم', text: 'افتح عالمك لإضافة كلماتك من أدوات إدارة الكلمات. النسخ يبقي الكلمة في القاموس ويضيفها للعالم؛ النقل يخرجها من القاموس إلى العالم. التعديل والحذف من عنوان عالمك.' },
    ],
  });

  function controller() { return root.LootLinguaFeatureDiscovery; }
  function onFeature(feature) {
    const view = root.getOnboardingView?.();
    if (!view) return false;
    if (feature === 'custom-worlds') return view === 'worlds' && document.getElementById('customWorldsTab')?.classList.contains('active');
    return view === feature;
  }
  function close() {
    internalClose = true;
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
    internalClose = false;
  }
  function finish() {
    const feature = activeFeature;
    activeFeature = '';
    close();
    if (feature) controller()?.complete?.(feature);
    controller()?.evaluate?.();
    offerResume();
  }
  function prepareStep() {
    if (activeFeature === 'custom-worlds' && stepIndex >= 3 && stepIndex <= 4) {
      const modal = document.getElementById('customWorldModal');
      if (!modal?.getClientRects().length) root.openCustomWorldModal?.();
    }
    if (activeFeature === 'custom-worlds' && stepIndex === 5 && !worldSaveHandled) root.hideModal?.('customWorldModal');
    if (activeFeature === 'quiz' && stepIndex >= 2) {
      const panel = document.getElementById('quizSettingsPanel');
      if (!panel?.getClientRects().length) root.openQuizModeSettings?.('flashcards');
    }
  }
  function advance() {
    if (!activeFeature) return;
    if (stepIndex + 1 >= STEPS[activeFeature].length) { finish(); return; }
    stepIndex += 1;
    controller()?.checkpoint?.(activeFeature, stepIndex);
    close(); prepareStep();
    const currentRun = run;
    setTimeout(() => { if (currentRun === run) show(); }, 100);
  }
  function targetForCurrentStep() {
    const step = STEPS[activeFeature]?.[stepIndex];
    const target = step ? document.querySelector(step.selector) : null;
    if (target) target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' });
    return { step, target };
  }
  function show() {
    const { step, target } = targetForCurrentStep();
    if (!step || !onFeature(activeFeature) || !target?.getClientRects().length || !root.LootLinguaPopover?.open) {
      pause(); return;
    }
    const content = document.createElement('div');
    content.className = 'feature-mini-onboarding-content';
    const title = document.createElement('strong');
    title.id = 'featureMiniOnboardingTitle';
    title.textContent = step.title;
    const copy = document.createElement('p');
    copy.textContent = step.text;
    const actions = document.createElement('div');
    actions.className = 'feature-mini-onboarding-actions';
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'feature-mini-onboarding-skip'; skip.textContent = 'تخطي';
    skip.addEventListener('click', advance);
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'feature-mini-onboarding-next';
    next.textContent = stepIndex + 1 >= STEPS[activeFeature].length ? 'إنهاء' : 'التالي';
    if (step.click || step.event) next.hidden = true;
    next.addEventListener('click', advance);
    actions.append(skip, next); content.append(title, copy, actions);
    const actionsToDelay = step.click ? [...document.querySelectorAll(step.click)]
      : step.event ? [target] : [];
    if (!root.LootLinguaPopover.open({
      id: COACH_ID, className: 'lootlingua-popover feature-mini-onboarding-coach', anchor: target,
      content, labelledBy: title.id, persistent: true,
      reading: { step: `${activeFeature}:${stepIndex}`, text: step.text, actions: actionsToDelay },
    })) pause();
  }
  function pause() {
    run += 1;
    activeFeature = '';
    close();
    offerResume();
  }
  function start(feature) {
    if (!STEPS[feature] || !onFeature(feature) || controller()?.isInteractiveJourneyActive?.() ||
        (activeFeature && activeFeature !== feature)) return false;
    if (activeFeature === feature) return true;
    const currentRun = ++run;
    activeFeature = feature;
    offerResume();
    worldSaveHandled = false;
    stepIndex = Math.min(controller()?.getState?.()?.features?.[feature]?.step || 0, STEPS[feature].length - 1);
    prepareStep();
    let attempts = 0;
    const wait = () => {
      if (currentRun !== run || activeFeature !== feature) return;
      if (document.querySelector(STEPS[feature][stepIndex].selector)?.getClientRects().length) { show(); return; }
      if (++attempts >= 20) { pause(); controller()?.evaluate?.(); return; }
      setTimeout(wait, 100);
    };
    wait();
    return true;
  }
  Object.defineProperty(root, 'LootLinguaFeatureMiniOnboarding', { value: Object.freeze({ start, finish, getActiveFeature: () => activeFeature }), configurable: false });
  root.addEventListener('lootlingua:popover-closed', (event) => {
    if (!internalClose && event.detail?.id === COACH_ID) pause();
  });
  root.addEventListener('lootlingua:auth-state', pause);
  root.addEventListener('lootlingua:dictionary-navigation', pause);
  function interruptedFeatures() {
    const discovery = controller();
    if (activeFeature || discovery?.isInteractiveJourneyActive?.()) return [];
    const features = discovery?.getState?.()?.features || {};
    return Object.keys(STEPS).filter((key) =>
      features[key]?.status === 'in-progress' && discovery.getStatus(key) === 'in-progress')
      .sort((left, right) => (features[right].updatedAt || 0) - (features[left].updatedAt || 0));
  }
  function offerResume() {
    const [feature] = interruptedFeatures();
    root.LootLinguaPopover?.offerResume?.(COACH_ID, feature ? {
      label: `تابع استكشاف ${FEATURE_NAMES[feature]}`,
      open: () => { if (onFeature(feature)) start(feature); else controller()?.open?.(feature); },
    } : null);
  }
  function resume() {
    const feature = interruptedFeatures().find(onFeature);
    if (feature) start(feature);
    else offerResume();
  }
  root.addEventListener('lootlingua:surface-ready', () => {
    if (activeFeature && (!onFeature(activeFeature) || controller()?.isInteractiveJourneyActive?.())) pause();
    resume();
  });
  root.addEventListener('lootlingua:onboarding-cloud-change', resume);
  root.addEventListener('lootlingua:initial-data-ready', resume);
  root.addEventListener('lootlingua:discovery-display-change', offerResume);
  root.addEventListener('lootlingua:custom-world-saved', () => {
    if (activeFeature === 'custom-worlds' && stepIndex >= 3 && stepIndex <= 4) {
      worldSaveHandled = true;
      stepIndex = 4; advance();
    }
  });
  document.addEventListener('click', (event) => {
    const step = STEPS[activeFeature]?.[stepIndex];
    if (!step?.click || !event.target.closest?.(step.click) || !root.LootLinguaPopover?.canAct?.(COACH_ID)) return;
    advance();
  });
  setInterval(() => {
    if (!activeFeature || !document.getElementById(COACH_ID)) return;
    const selector = STEPS[activeFeature]?.[stepIndex]?.selector;
    const target = selector && document.querySelector(selector);
    if (!target?.getClientRects().length) pause();
  }, 500);
})(window);
