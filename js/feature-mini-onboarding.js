(function attachFeatureMiniOnboarding(root) {
  'use strict';
  const COACH_ID = 'featureMiniOnboardingCoach';
  let activeFeature = '';
  let stepIndex = 0;
  let internalClose = false;

  const STEPS = Object.freeze({
    treasure: [
      { selector: '#dailyLootChest', title: 'صندوقك اليومي', text: 'اضغط الصندوق لفتح مكافأتك اليومية عندما يكون جاهزًا.' },
      { selector: '#treasureSlots', title: 'تقدّم المكافآت', text: 'هنا ترى الصناديق المتاحة وما يحتاج إلى مزيد من التقدّم.' },
    ],
    quiz: [
      { selector: '#quizViewSetup', title: 'اختر طريقة التعلّم', text: 'ابدأ باختيار وضع اختبار يناسبك؛ هذا اختبار كلماتك الشخصي.' },
      { selector: '#quizAvailableCount', title: 'كلماتك المتاحة', text: 'هذا العدد يتحدث من قاموسك، وليس من كلمات بوابة عالم عام.' },
    ],
    starred: [
      { selector: '#starredSearchBar', title: 'راجع الكلمات الصعبة', text: 'أي كلمة تضع عليها نجمة تظهر هنا لتعود إليها بسرعة.' },
      { selector: '#list', title: 'قائمة المراجعة', text: 'استخدم البحث والقائمة لإدارة كلماتك المعلّمة.' },
    ],
    'custom-worlds': [
      { selector: '#customWorldsTab', title: 'عوالمك الخاصة', text: 'هذه مجموعاتك الشخصية، وهي مستقلة عن العوالم العامة والبوابات.' },
      { selector: '#worldsGrid .world-card-add', title: 'أنشئ عالمًا', text: 'أنشئ عالمًا خاصًا لتنظيم الكلمات التي تريد جمعها معًا.' },
    ],
  });

  function controller() { return root.LootLinguaFeatureDiscovery; }
  function close() {
    internalClose = true;
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
    internalClose = false;
  }
  function finish(skipped) {
    const feature = activeFeature;
    activeFeature = '';
    close();
    if (feature) (skipped ? controller()?.skip : controller()?.complete)?.(feature);
    controller()?.evaluate?.();
  }
  function targetForCurrentStep() {
    const step = STEPS[activeFeature]?.[stepIndex];
    const target = step ? document.querySelector(step.selector) : null;
    if (target) target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' });
    return { step, target };
  }
  function show() {
    const { step, target } = targetForCurrentStep();
    if (!step || !target || !target.getClientRects().length || !root.LootLinguaPopover?.open) { activeFeature = ''; close(); return; }
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
    skip.type = 'button'; skip.className = 'feature-mini-onboarding-skip'; skip.textContent = 'تخطي الشرح';
    skip.addEventListener('click', () => finish(true));
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'feature-mini-onboarding-next';
    next.textContent = stepIndex + 1 >= STEPS[activeFeature].length ? 'إنهاء' : 'التالي';
    next.addEventListener('click', () => {
      if (stepIndex + 1 >= STEPS[activeFeature].length) finish(false);
      else { stepIndex += 1; controller()?.checkpoint?.(activeFeature, stepIndex); close(); setTimeout(show, 80); }
    });
    actions.append(skip, next); content.append(title, copy, actions);
    root.LootLinguaPopover.open({ id: COACH_ID, className: 'lootlingua-popover feature-mini-onboarding-coach', anchor: target, content, labelledBy: title.id });
  }
  function start(feature) {
    if (!STEPS[feature] || (activeFeature && activeFeature !== feature)) return false;
    activeFeature = feature;
    stepIndex = Math.min(controller()?.getState?.()?.features?.[feature]?.step || 0, STEPS[feature].length - 1);
    let attempts = 0;
    const wait = () => {
      if (!activeFeature) return;
      if (document.querySelector(STEPS[feature][0].selector)) { show(); return; }
      if (++attempts >= 20) { activeFeature = ''; controller()?.evaluate?.(); return; }
      setTimeout(wait, 100);
    };
    wait();
    return true;
  }
  Object.defineProperty(root, 'LootLinguaFeatureMiniOnboarding', { value: Object.freeze({ start, finish, getActiveFeature: () => activeFeature }), configurable: false });
  root.addEventListener('lootlingua:popover-closed', (event) => {
    if (!internalClose && event.detail?.id === COACH_ID) activeFeature = '';
  });
  root.addEventListener('lootlingua:auth-state', () => { activeFeature = ''; close(); });
  setInterval(() => {
    if (!activeFeature) return;
    const selector = STEPS[activeFeature]?.[stepIndex]?.selector;
    const target = selector && document.querySelector(selector);
    if (!target?.getClientRects().length) { activeFeature = ''; close(); }
  }, 500);
})(window);
