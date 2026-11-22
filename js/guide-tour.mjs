import { GUIDE_SECTIONS } from './guide-sections.mjs';

const id = 'lootlinguaSectionTour';
const checkpointKey = uid => 'lootlingua:guide-checkpoint:v1:' + (uid || 'guest');
const findSection = topic => GUIDE_SECTIONS.find(section => section.steps.some(step => step.topic === topic));
const gatedSections = new Set(['quiz', 'starred', 'treasure']);
const visible = node => Boolean(node?.isConnected && !node.closest('[hidden], [aria-hidden="true"], [inert]') &&
  node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
const find = selector => selector && [...document.querySelectorAll(selector)].find(visible);
const make = (tag, copy) => {
  const node = document.createElement(tag);
  node.textContent = copy;
  return node;
};

export function mountGuideTour(panel, { activeUid, blocked, covered, acknowledge, presentationChanged }) {
  const app = window;
  const popover = app.LootLinguaPopover;
  const launch = panel.querySelector('[data-guide-start]');
  let running = null;
  let rendered = null;
  let frame = 0;
  let loadTimer = 0;
  let pausedByTab = false;
  let lastPublishedRoute = null;
  const profile = panel.closest('#profileModal');
  const startupPending = () => app.__lootlinguaInitialDataReady === false;
  const suspended = () => startupPending() || blocked() || app.LootLinguaSmartOnboarding?.busy?.();
  const read = (uid = activeUid()) => {
    try {
      const saved = JSON.parse(localStorage.getItem(checkpointKey(uid)));
      const section = findSection(saved?.topic);
      if (saved?.owner === uid && section?.id === saved?.section) return saved;
    } catch (_) {}
    return null;
  };
  const persist = checkpoint => {
    if (checkpoint.owner !== activeUid()) return;
    try { localStorage.setItem(checkpointKey(checkpoint.owner), JSON.stringify(checkpoint)); } catch (_) {}
  };
  const resetSaved = uid => {
    try { localStorage.removeItem(checkpointKey(uid)); } catch (_) {}
  };
  const getWorldRoute = route => {
    if (route?.kind !== 'published' || !route.params?.worldId) return null;
    const { worldId, rankId, gateId } = route.params;
    return { worldId, ...(route.key === 'gate' && rankId && gateId && { rankId, gateId }) };
  };
  const checkpoint = active => ({
    owner: running.owner, section: running.section.id, topic: running.step.topic, manual: running.manual, active,
    ...(running.section.id === 'worlds' && { worldRoute: getWorldRoute(app.history.state) || running.worldRoute }),
  });
  const nextStep = (section, from = 0, manual = false) =>
    section.steps.slice(from).find(step => manual || !covered(step.topic));
  const nextSection = (from = 0) => GUIDE_SECTIONS.slice(from).find(section => nextStep(section));

  function closeCoach() {
    rendered = null;
    popover?.closeIf(id, { silent: true });
  }

  function sync() {
    const saved = read();
    const pending = saved || nextSection();
    if (launch.hidden !== !pending) launch.hidden = !pending;
    const label = saved ? 'استأنف جولة التعريف' : 'ابدأ جولة التعريف';
    if (launch.textContent !== label) launch.textContent = label;
    const offer = !running && saved && !pausedByTab && !suspended() &&
      !app.LootLinguaModalFocus?.currentSurface?.() && !find('#notificationsPanel');
    popover?.offerResume('sectionTour', offer ? {
      label: 'استأنف جولة التعريف', priority: 3, open: () => begin(),
    } : null);
  }

  function stop({ finish = false, save = true } = {}) {
    if (!running) return;
    if (save && !finish) persist(checkpoint(false));
    if (finish) resetSaved(running.owner);
    running = null;
    clearTimeout(loadTimer);
    closeCoach();
    sync();
    presentationChanged();
  }

  function currentIndex() {
    return running.section.steps.indexOf(running.step);
  }

  function go(section, step, { enter = false } = {}) {
    if (!running) return;
    closeCoach();
    clearTimeout(loadTimer);
    const current = running;
    const previous = current.section;
    if (section !== previous) {
      if (visible(find(previous.surface))) previous.leave?.(app);
      if (previous.id === 'custom-worlds' && find('#customWorldNameInput')) app.closeCustomWorldModal?.();
      current.manual = false;
    }
    Object.assign(current, { section, step, latestSurface: false, prepared: false,
      expired: false, entering: enter, unavailable: false, pendingAct: false });
    persist(checkpoint(true));
    const reveal = result => {
      if (running !== current || current.step !== step) return;
      current.entering = false;
      current.unavailable = result === false;
      loadTimer = setTimeout(() => { current.expired = true; schedule(); }, 1750);
      schedule();
    };
    if (enter) {
      const modal = app.LootLinguaModalFocus?.currentSurface?.();
      if (modal === profile && section.id !== 'profile') app.closeProfileModal?.(true);
      let result;
      try {
        const route = section.id === 'worlds' && step.topic !== 'worlds' && current.worldRoute;
        const needsGate = ['lesson', 'gate-review', 'gate-wait'].includes(step.topic);
        if (needsGate && route?.rankId && route.gateId) result = app.openPublishedGate?.(route.worldId, route.rankId, route.gateId);
        else if (route?.worldId) result = app.openPublishedWorld?.(route.worldId);
        else if (find(section.surface) && app.history.state?.kind !== 'overlay' &&
                 (step.topic !== 'worlds' || find('[data-guided-world]'))) result = true;
        else if (gatedSections.has(section.id) && app.isFeatureUnlocked?.(section.id) === false) result = false;
        else result = section.enter(app);
      }
      catch (_) { result = false; }
      Promise.resolve(result).then(reveal, () => reveal(false));
    } else reveal();
  }

  async function begin(topic) {
    const owner = activeUid();
    const pendingBoot = app.LootLinguaEntryExperienceController?.getPendingBoot?.();
    if (pendingBoot) {
      try { await pendingBoot; } catch (_) { return; }
      if (owner !== activeUid() || running) return;
    }
    const modal = app.LootLinguaModalFocus?.currentSurface?.();
    if (blocked() || startupPending() || app.__lootlinguaAuthResolved === false || (modal && modal !== profile)) return;
    const saved = topic ? null : read();
    const selected = topic || saved?.topic;
    const manual = Boolean(topic || saved?.manual);
    const section = (selected && findSection(selected)) || nextSection();
    if (!section) return;
    const desired = section.steps.find(step => step.topic === selected);
    const step = desired && (manual || !covered(desired.topic)) ? desired : nextStep(section, 0, manual);
    if (!step) {
      resetSaved(activeUid());
      sync();
      return begin();
    }
    pausedByTab = false;
    app.LootLinguaSmartOnboarding?.close();
    const fromSettings = profile?.classList.contains('open');
    panel.open = false;
    if (fromSettings) app.closeProfileModal?.(true);
    const onWorlds = app.getOnboardingView?.() === 'worlds';
    running = { owner: activeUid(), section, step, manual,
      worldRoute: saved?.worldRoute || (onWorlds ? lastPublishedRoute : null) };
    acknowledge('guide-tour-started');
    go(section, step, { enter: true });
    sync();
    presentationChanged();
  }

  function next({ result, section: skipSection = false, unavailable = false } = {}) {
    if (!running || running.owner !== activeUid() || blocked()) return;
    const { section, step, manual } = running;
    if (skipSection) {
      for (const item of section.steps) {
        if (!covered(item.topic)) acknowledge(item.topic, 'dismissed');
      }
    } else if (result) acknowledge(step.topic, result);
    const following = !skipSection && !unavailable && nextStep(section, currentIndex() + 1, manual);
    if (following) { go(section, following); return; }
    if (manual) { stop({ finish: true }); return; }
    const ahead = nextSection(GUIDE_SECTIONS.indexOf(section) + 1);
    if (ahead) go(ahead, nextStep(ahead), { enter: true });
    else stop({ finish: true });
  }

  function index() {
    if (!running) return;
    const section = running.section;
    stop();
    if (section.id === 'full-stats' || section.id === 'quests' || section.id === 'notices') section.leave?.(app);
    if (section.id === 'custom-worlds' && find('#customWorldNameInput')) app.closeCustomWorldModal?.();
    if (!profile?.classList.contains('open')) app.toggleProfileModal?.();
    panel.open = true;
    launch.focus();
  }

  function draw(anchor, target) {
    const { section, step } = running;
    const existing = popover?.getActiveId();
    if (existing && existing !== id) return;
    if (rendered?.anchor === anchor && rendered?.step === step && rendered.target === target && existing === id) return;
    closeCoach();
    const scope = document.createElement('div');
    scope.className = 'section-tour-content';
    scope.dir = 'rtl';
    const heading = make('h3', target ? step.title : section.title);
    heading.id = id + 'Title';
    heading.tabIndex = -1;
    const count = make('p', section.title + ' · ' + (currentIndex() + 1) + ' من ' + section.steps.length);
    count.className = 'section-tour-count';
    const actions = document.createElement('div');
    actions.className = 'section-tour-actions';
    const options = document.createElement('details');
    options.className = 'section-tour-options';
    const summary = make('summary', '⋯');
    summary.setAttribute('aria-label', 'خيارات الجولة');
    summary.title = 'خيارات الجولة';
    const secondary = document.createElement('div');
    secondary.className = 'section-tour-options-list';
    options.append(summary, secondary);
    const control = (command, label, action, group = secondary) => {
      const button = make('button', label);
      button.type = 'button';
      button.dataset.guideCommand = command;
      button.addEventListener('click', () => {
        if (running?.step === step) action();
      });
      group.append(button);
    };
    const atEnd = running.unavailable || !nextStep(section, currentIndex() + 1, running.manual);
    control('next', atEnd ? (running.manual ? 'إنهاء الشرح' : 'القسم التالي') : target ? 'التالي' : 'تابع دون تجربة',
      () => next({ result: target ? 'seen' : undefined, unavailable: running.unavailable }), actions);
    if (currentIndex() > 0) control('back', 'السابق', () => go(section, section.steps[currentIndex() - 1]));
    control('skip', 'تخطي الخطوة', () => next({ result: 'dismissed' }));
    if (section.steps.length > 1) control('skip-section', 'تخطي القسم', () => next({ section: true }));
    control('index', 'فهرس الأقسام', index);
    control('pause', 'إيقاف الجولة', () => {
      stop();
      const resume = find('#onboardingResume[data-coach="sectionTour"]');
      if (resume) resume.focus({ preventScroll: true });
      else if (anchor.matches('button, a, input, select, textarea')) anchor.focus({ preventScroll: true });
    });
    actions.append(options);
    const copy = target ? step.copy : running.unavailable ? 'هالقسم مش متاح حاليًا. تقدر تتابع وترجع له من الدليل لما يفتح.' :
      step.missing || 'العنصر المطلوب مش متاح حاليًا. تقدر تتابع الجولة وترجع له لاحقًا.';
    const body = make('p', copy);
    body.id = id + 'Copy';
    scope.append(count, heading, body, actions);
    const rect = anchor.getBoundingClientRect();
    if (rect.top < 54 || rect.bottom > app.innerHeight - 84) anchor.scrollIntoView({ block: 'center', behavior: 'instant' });
    const element = popover?.open({
      id, anchor, content: scope, labelledBy: heading.id, describedBy: body.id,
      className: 'lootlingua-popover section-tour-popover', persistent: true, escapeCloses: true, avoidAnchor: true,
      highlight: target,
      managesExpanded: false, onClose: options => { if (rendered && options.escape) stop(); },
    });
    if (!element) return;
    options.addEventListener('toggle', () => {
      if (element.isConnected) popover.reposition(id);
    });
    element.dataset.guideTopic = step.topic;
    element.dataset.guideSection = section.id;
    element.dataset.guideReady = String(target);
    rendered = { anchor, step, target };
    if (target && !covered(step.topic)) acknowledge(step.topic, 'in-progress');
    // Keep the user's focus and phone keyboard while live controls appear during use.
    if (!document.activeElement?.matches?.('input, textarea, select')) heading.focus({ preventScroll: true });
  }

  function update() {
    frame = 0;
    if (!running) { sync(); return; }
    if (running.owner !== activeUid()) { stop({ save: false }); return; }
    if (blocked()) { stop(); return; }
    if (running.entering || suspended()) { closeCoach(); return; }
    const { section, step } = running;
    const surface = find(section.surface);
    const modal = app.LootLinguaModalFocus?.currentSurface?.();
    const anchor = find(step.target);

    if (running.pendingAct) {
      const subsequent = nextStep(section, currentIndex() + 1, running.manual);
      const openedWorld = step.topic === 'worlds' && getWorldRoute(app.history.state);
      if (subsequent && (openedWorld || find(subsequent.target))) { next({ result: 'seen' }); return; }
    }
    if (!surface) {
      if (running.latestSurface) stop();
      else if (running.unavailable || running.expired) {
        running.unavailable = true;
        const fallback = !modal && find('.page-header h1, #heroAvatarBtn');
        if (fallback) draw(fallback, false);
        else stop();
      } else closeCoach();
      return;
    }
    running.latestSurface = true;
    if (modal && (!anchor || !modal.contains(anchor)) && !modal.contains(surface)) { closeCoach(); return; }
    if (!anchor && step.prepare && !running.prepared) {
      running.prepared = true;
      step.prepare(app);
      schedule();
      return;
    }
    const fallback = [...(modal || surface).querySelectorAll('h1, h2, h3, button, input')].find(visible) || surface;
    if (anchor) draw(anchor, true);
    else if (running.expired && visible(fallback)) draw(fallback, false);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  launch.addEventListener('click', () => begin());
  for (const item of panel.querySelectorAll('[data-guide-topics]')) {
    const topic = item.dataset.guideTopics;
    if (!findSection(topic)) continue;
    const visit = make('button', 'اشرح لي هون');
    visit.type = 'button';
    visit.className = 'profile-guide-visit';
    visit.dataset.guideVisit = topic;
    visit.onclick = () => begin(topic);
    item.append(visit);
  }
  document.addEventListener('click', event => {
    if (!running || !event.target?.closest) return;
    if (running.step.acts && event.target.closest(running.step.acts)) running.pendingAct = true;
    if (event.target.closest('[data-view], [data-dock-view]')) stop();
    schedule();
  }, true);
  new MutationObserver(records => {
    if (running || records.some(record => !record.target.closest?.('#onboardingResume'))) schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['aria-hidden', 'aria-busy', 'class', 'disabled', 'hidden', 'style'] });
  for (const event of ['surface-ready', 'initial-data-ready', 'guide-coverage-changed', 'gate-lesson-changed', 'quiz-mode-changed',
    'dictionary-search-result', 'dictionary-meaning-selected', 'dictionary-word-saved', 'gate-lesson-closed',
    'quiz-learning-commit-complete', 'toast-idle', 'auth-dialog-opened', 'auth-dialog-closed', 'popover-closed']) {
    app.addEventListener('lootlingua:' + event, schedule);
  }
  app.addEventListener('lootlingua:profile-guide-closed', () => {
    if (running && ['profile', 'full-stats'].includes(running.section.id)) stop();
    schedule();
  });
  app.addEventListener('lootlingua:auth-state', () => {
    stop({ save: false });
    lastPublishedRoute = null;
    if (app.auth?.currentUser?.isAnonymous && !read()) {
      const guest = read('');
      if (guest) {
        persist({ ...guest, owner: activeUid(), active: false });
        resetSaved('');
      }
    }
    pausedByTab = false;
    schedule();
  });
  app.addEventListener('lootlingua:saved-guest-merged', event => {
    const { sourceUid, targetUid } = event.detail || {};
    if (!sourceUid || !targetUid || targetUid !== activeUid() || read()) return;
    const guest = read(sourceUid);
    if (!guest) return;
    persist({ ...guest, owner: targetUid, active: false });
    schedule();
  });
  app.addEventListener('lootlingua:surface-ready', event => {
    if (event.detail?.kind === 'published') lastPublishedRoute = getWorldRoute(event.detail);
    else if (event.detail?.key === 'worlds') lastPublishedRoute = null;
  });
  app.addEventListener('storage', event => {
    if (event.key !== checkpointKey(activeUid())) return;
    pausedByTab = read()?.active === true;
    stop({ save: false });
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  sync();
  return { active: () => Boolean(running), sync, stop };
}
