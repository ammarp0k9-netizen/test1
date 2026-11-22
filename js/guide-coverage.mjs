export const GUIDE_TOUR = 'lootlingua-guide';
export const GUIDE_TOPICS = Object.freeze([
  'worlds', 'gate-start', 'lesson', 'gate-review', 'gate-wait', 'personal-review', 'mastery-result',
  'dictionary', 'search', 'meaning', 'manual-meaning', 'save', 'ready', 'starred', 'custom-worlds',
  'quiz', 'placement', 'games', 'notices', 'quests', 'treasure', 'activity', 'profile',
  'xp', 'ranks', 'stats', 'full-stats', 'titles', 'appearance', 'settings', 'account',
  'quiz-source', 'quiz-count', 'quiz-launch', 'treasure-extra', 'custom-world-form',
]);

export const DISCOVERY_TOPICS = Object.freeze(['dictionary', 'quiz', 'treasure', 'starred', 'custom-worlds']);

export const GUIDE_SIGNALS = Object.freeze([
  'lesson-started', 'dictionary-visited', 'first-official-review', 'guide-tour-started',
  ...DISCOVERY_TOPICS.map(topic => topic + '-invitation'),
]);

export const isGuideCovered = state => state === 'seen' || state === 'dismissed';

export function selectDiscoveryTopic(status, eligible, deferred = () => false) {
  if (status('first-official-review') !== 'seen') return '';
  return DISCOVERY_TOPICS.find(topic =>
    !isGuideCovered(status(topic)) && status(topic + '-invitation') !== 'dismissed' && !deferred(topic) &&
    (topic === 'dictionary' || eligible(topic))
  ) || '';
}

export function guideStorageKey(uid) {
  return 'lootlingua:guide-coverage:v1:' + (uid ? 'user:' + uid : 'guest');
}

export function readGuideCoverage(storage, uid) {
  try { return JSON.parse(storage.getItem(guideStorageKey(uid)) || 'null'); }
  catch (_) { return null; }
}

export function mergeGuideCoverage(left, right) {
  const records = [left, right].filter(state => state?.version === 1);
  const topics = {};
  for (const topic of [...GUIDE_TOPICS, ...GUIDE_SIGNALS]) {
    const choices = records.map(state => state.topics?.[topic]);
    if (topic.endsWith('-invitation') && choices.includes('dismissed')) topics[topic] = 'dismissed';
    else if (choices.includes('seen')) topics[topic] = 'seen';
    else if (choices.includes('dismissed')) topics[topic] = 'dismissed';
    else if (GUIDE_TOPICS.includes(topic) && choices.includes('in-progress')) topics[topic] = 'in-progress';
    else if (GUIDE_TOPICS.includes(topic) && choices.includes('visited')) topics[topic] = 'visited';
  }
  const deferredUntil = {};
  for (const topic of DISCOVERY_TOPICS) {
    if (isGuideCovered(topics[topic])) continue;
    const times = records.map(state => state.deferredUntil?.[topic]).filter(time => Number.isSafeInteger(time) && time > 0);
    if (times.length) deferredUntil[topic] = Math.max(...times);
  }
  if (!Object.keys(topics).length && !Object.keys(deferredUntil).length) return null;
  return { version: 1, topics, ...(Object.keys(deferredUntil).length ? { deferredUntil } : {}) };
}
