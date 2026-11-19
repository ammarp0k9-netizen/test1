import { GUIDE_TOUR, GUIDE_TOPICS, guideStorageKey, readGuideCoverage, mergeGuideCoverage } from './guide-coverage.mjs';

const root = window;
const panel = document.getElementById('lootlinguaGuide');
const legacyPrefix = 'lootlingua:contextual-onboarding:v1:';
const activeUid = () => root.auth?.currentUser?.uid || '';
const ownerKey = uid => uid ? 'user:' + uid : 'guest';
const memory = new Map();

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
  return Boolean(read(activeUid())?.topics[topic]);
}

function acknowledge(topic, status = 'seen') {
  if (GUIDE_TOPICS.includes(topic)) save(activeUid(), { [topic]: status });
}

function quizInFront() {
  return Boolean(root.hasActiveLearningQuiz?.() ||
    document.body?.matches('.quiz-active, .published-placement-mode') ||
    [...document.querySelectorAll('.published-gate-clear-view')].some(node => node.getClientRects().length));
}

function openTopic(topic) {
  if (root.LootLinguaGateLessonView?.isOpen?.() || quizInFront() || root.__entryExperienceActive) return false;
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
  if (!topic.matches?.('[data-guide-topics]') || !topic.open || !panel.open ||
      !panel.closest('#profileModal.open') || !panel.getClientRects().length) return;
  for (const other of panel.querySelectorAll('[data-guide-topics][open]')) {
    if (other !== topic) other.open = false;
  }
  save(activeUid(), Object.fromEntries(topic.dataset.guideTopics.split(' ').map(id => [id, 'seen'])));
}, true);

root.LootLinguaGuide = Object.freeze({ covered, acknowledge, openTopic, quizInFront, refresh });
root.addEventListener('lootlingua:auth-state', () => {
  if (panel) {
    panel.open = false;
    panel.querySelectorAll('[data-guide-topics][open]').forEach(item => { item.open = false; });
  }
  refresh();
});
for (const event of ['initial-data-ready', 'onboarding-cloud-change', 'guided-first-journey-change',
  'personal-dictionary-onboarding-change', 'feature-discovery-change']) {
  root.addEventListener('lootlingua:' + event, refresh);
}
root.addEventListener('storage', event => {
  if (event.key === guideStorageKey(activeUid())) root.dispatchEvent(new CustomEvent('lootlingua:guide-coverage-changed'));
});
refresh();
