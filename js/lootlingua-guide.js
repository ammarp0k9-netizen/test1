import { GUIDE_TOUR, GUIDE_TOPICS, GUIDE_SIGNALS, DISCOVERY_TOPICS, guideStorageKey, readGuideCoverage, mergeGuideCoverage, selectDiscoveryTopic } from './guide-coverage.mjs';

const root = window;
const panel = document.getElementById('lootlinguaGuide');
const legacyPrefix = 'lootlingua:contextual-onboarding:v1:';
const activeUid = () => root.auth?.currentUser?.uid || '';
const ownerKey = uid => uid ? 'user:' + uid : 'guest';
const memory = new Map();
const tour = panel?.querySelector('[data-guide-tour]');
const startButton = panel?.querySelector('[data-guide-start]');
const topics = () => [...(panel?.querySelectorAll('[data-guide-topics]') || [])];
let touring = null;

function read(uid) {
  return mergeGuideCoverage(readGuideCoverage(localStorage, uid), memory.get(uid));
}

function save(uid, topics) {
  if (uid !== activeUid() || root.__lootlinguaAuthResolved === false) return;
  const before = read(uid);
  const next = mergeGuideCoverage(before, { version: 1, topics });
  if (!next || JSON.stringify(next) === JSON.stringify(before)) return;
  memory.set(uid, next);
  try { localStorage.setItem(guideStorageKey(uid), JSON.stringify(next)); } catch (_) {}
  if (uid) root.queueProfileIntent?.({ type: 'onboarding', tour: GUIDE_TOUR, state: next });
  root.dispatchEvent(new CustomEvent('lootlingua:guide-coverage-changed'));
}

function legacyTopics(uid) {
  const topics = {};
  for (const topic of GUIDE_TOPICS) {
    let value;
    try { value = localStorage.getItem(legacyPrefix + topic + ':' + ownerKey(uid)); } catch (_) {}
    if (value === 'completed' || root.LootLinguaPersonalDictionaryOnboarding?.hasCoveredStep?.(topic)) topics[topic] = 'seen';
    else if (value === 'skipped') topics[topic] = 'dismissed';
  }
  const discovery = root.LootLinguaFeatureDiscoveryContract;
  try {
    const old = discovery?.normalize(JSON.parse(localStorage.getItem(discovery.storageKey({ uid }))));
    for (const [topic, feature] of Object.entries(old?.features || {})) {
      if (feature.status === 'completed') topics[topic] = 'seen';
      if (feature.status === 'skipped' && !topics[topic]) topics[topic] = 'dismissed';
    }
    const worldGuide = root.LootLinguaGuidedFirstJourneyContract;
    const location = { uid };
    const guided = [worldGuide?.checkpointKey(location), worldGuide?.storageKey(location)]
      .filter(Boolean).map(key => worldGuide.normalize(JSON.parse(localStorage.getItem(key))));
    if (guided.some(state => state?.worldId && state.phase !== 'choosing-world')) topics.worlds = 'seen';
    if (guided.some(state => ['first-gate-opened', 'awaiting-quiz-cta', 'completed'].includes(state?.phase))) topics['gate-start'] = 'seen';
    if (guided.some(state => state?.placementStage === 'result' && state.resultStep >= 2)) topics.placement = 'seen';
  } catch (_) {}
  return topics;
}

function refresh() {
  if (root.__lootlinguaAuthResolved === false) return;
  const uid = activeUid();
  const topics = legacyTopics(uid);
  if (root.auth?.currentUser?.isAnonymous) {
    const guest = read('');
    if (guest) {
      save(uid, mergeGuideCoverage(guest, { version: 1, topics }).topics);
      memory.delete('');
      try { localStorage.removeItem(guideStorageKey('')); } catch (_) {}
      return;
    }
  }
  save(uid, topics);
}

function covered(topic) {
  return Boolean(status(topic));
}

function status(topic) {
  return read(activeUid())?.topics[topic] || '';
}

function acknowledge(topic, value = 'seen') {
  if (GUIDE_TOPICS.includes(topic) || GUIDE_SIGNALS.includes(topic)) save(activeUid(), { [topic]: value });
}

function updateGuideTopics() {
  if (!panel) return;
  const next = nextTopic();
  for (const section of topics()) {
    const name = section.dataset.guideTopics;
    section.querySelector('.profile-guide-status').textContent = status(name) === 'seen' ? 'تم الاطّلاع' :
      section === next && !section.open ? 'تابع هنا' : '';
  }
  startButton.hidden = Boolean(touring) || !next;
  startButton.textContent = covered('guide-tour-started') ? 'استأنف جولة التعريف' : 'ابدأ جولة التعريف';
}

function nextTopic() {
  return topics().find(section => !covered(section.dataset.guideTopics));
}

function isPresenting() {
  return Boolean(panel?.open && panel.closest('#profileModal.open') &&
    (touring || panel.querySelector('[data-guide-topics][open]')));
}

function presentationChanged() {
  root.dispatchEvent(new CustomEvent('lootlingua:guide-presentation-change'));
}

function blocked() {
  return root.LootLinguaGateLessonView?.isOpen?.() || quizInFront() || root.__entryExperienceActive ||
    root.__lootlinguaQuizLearningCommitDepth > 0;
}

const visitTopic = {
  worlds: () => root.loadWorldsView?.(),
  dictionary: () => root.loadPersonalDictionary?.(),
  quiz: () => root.loadQuizView?.(),
  starred: () => root.loadStarredView?.(),
  treasure: () => root.loadTreasureView?.(),
  'custom-worlds': () => { root.loadWorldsView?.(); setTimeout(() => root.showCustomWorldsTab?.(), 0); },
  'full-stats': () => root.openStatsPanel?.(),
};

function pauseTour({ focus = false } = {}) {
  if (!touring) return;
  touring = null;
  tour.hidden = true;
  updateGuideTopics();
  presentationChanged();
  if (focus) (startButton.hidden ? panel.querySelector('summary') : startButton)?.focus();
}

function showTourTopic() {
  const topic = nextTopic();
  if (!topic || blocked()) { pauseTour({ focus: true }); return; }
  touring = { uid: activeUid(), topic: topic.dataset.guideTopics };
  for (const section of topics()) section.open = false;
  tour.hidden = false;
  const heading = tour.querySelector('h3');
  heading.textContent = topic.querySelector('summary span').textContent;
  tour.querySelector('[data-guide-tour-copy]').textContent = topic.querySelector('p').textContent;
  tour.querySelector('[data-guide-tour-action="visit"]').hidden = !visitTopic[touring.topic];
  updateGuideTopics();
  presentationChanged();
  heading.focus();
}

startButton?.addEventListener('click', () => {
  if (blocked() || !panel.closest('#profileModal.open') || !nextTopic()) return;
  root.LootLinguaSmartOnboarding?.close();
  acknowledge('guide-tour-started');
  showTourTopic();
});

tour?.addEventListener('click', event => {
  const action = event.target.closest('[data-guide-tour-action]')?.dataset.guideTourAction;
  if (!touring || touring.uid !== activeUid() || !action) return;
  if (action === 'pause' || blocked()) { pauseTour({ focus: true }); return; }
  const topic = touring.topic;
  if (action === 'visit') {
    const visit = visitTopic[topic];
    if (!visit) return;
    acknowledge(topic);
    pauseTour();
    root.closeProfileModal?.(true);
    visit();
  } else {
    acknowledge(topic, action === 'skip' ? 'dismissed' : 'seen');
    showTourTopic();
  }
});

function quizInFront() {
  return Boolean(root.hasActiveLearningQuiz?.() ||
    document.body?.matches('.quiz-active, .published-placement-mode') ||
    [...document.querySelectorAll('.published-gate-clear-view')].some(node => node.getClientRects().length));
}

function openTopic(topic) {
  if (blocked()) return false;
  pauseTour();
  const target = [...(panel?.querySelectorAll('[data-guide-topics]') || [])]
    .find(node => node.dataset.guideTopics.split(' ').includes(topic));
  if (!target) return false;
  root.LootLinguaSmartOnboarding?.close();
  if (!panel.closest('#profileModal.open')) root.toggleProfileModal?.();
  panel.open = true;
  target.open = true;
  target.querySelector('summary')?.focus();
  requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest' }));
  return true;
}

panel?.addEventListener('toggle', event => {
  const topic = event.target;
  if (topic === panel && !panel.open) pauseTour();
  if (!topic.matches?.('[data-guide-topics]') || !topic.open || !panel.open ||
      !panel.closest('#profileModal.open') || !panel.getClientRects().length || blocked()) {
    presentationChanged();
    return;
  }
  pauseTour();
  root.LootLinguaSmartOnboarding?.close();
  for (const other of panel.querySelectorAll('[data-guide-topics][open]')) {
    if (other !== topic) other.open = false;
  }
  acknowledge(topic.dataset.guideTopics);
  updateGuideTopics();
  presentationChanged();
}, true);

root.addEventListener('lootlingua:guide-coverage-changed', updateGuideTopics);
root.LootLinguaGuide = Object.freeze({
  covered, status, acknowledge, openTopic, quizInFront, refresh, isPresenting, discoveryTopics: DISCOVERY_TOPICS,
  discoveryTopic: eligible => selectDiscoveryTopic(status, eligible),
});
root.addEventListener('lootlingua:profile-guide-closed', () => {
  pauseTour();
  if (panel) panel.open = false;
  presentationChanged();
});
root.addEventListener('lootlingua:auth-state', () => {
  pauseTour();
  if (panel) {
    panel.open = false;
    panel.querySelectorAll('[data-guide-topics][open]').forEach(item => { item.open = false; });
  }
  refresh();
  updateGuideTopics();
});
for (const event of ['initial-data-ready', 'onboarding-cloud-change', 'guided-first-journey-change',
  'personal-dictionary-onboarding-change', 'feature-discovery-change']) {
  root.addEventListener('lootlingua:' + event, refresh);
}
root.addEventListener('storage', event => {
  const uid = activeUid();
  if (event.key !== guideStorageKey(uid) || root.__lootlinguaAuthResolved === false) return;
  const disk = mergeGuideCoverage(readGuideCoverage(localStorage, uid), null);
  const merged = read(uid);
  if (merged && JSON.stringify(merged) !== JSON.stringify(disk)) {
    memory.set(uid, merged);
    try { localStorage.setItem(event.key, JSON.stringify(merged)); } catch (_) {}
  }
  root.dispatchEvent(new CustomEvent('lootlingua:guide-coverage-changed'));
});
refresh();
updateGuideTopics();
