export const GUIDE_TOUR = 'lootlingua-guide';
export const GUIDE_TOPICS = Object.freeze([
  'worlds', 'gate-start', 'lesson', 'gate-review', 'gate-wait', 'personal-review', 'mastery-result',
  'dictionary', 'search', 'meaning', 'manual-meaning', 'save', 'ready', 'starred', 'custom-worlds',
  'quiz', 'placement', 'games', 'notices', 'quests', 'treasure', 'activity', 'profile',
  'xp', 'ranks', 'stats', 'full-stats', 'titles', 'appearance', 'settings', 'account',
]);

export const DISCOVERY_TOPICS = Object.freeze(['dictionary', 'quiz', 'treasure', 'starred', 'custom-worlds']);

export const GUIDE_SIGNALS = Object.freeze([
  'lesson-started', 'dictionary-visited', 'first-official-review', 'guide-tour-started',
  ...DISCOVERY_TOPICS.map(topic => topic + '-invitation'),
]);

export function selectDiscoveryTopic(status, eligible) {
  const dictionaryHandled = status('dictionary') || status('dictionary-invitation') === 'dismissed';
  if (!dictionaryHandled) return status('first-official-review') ? 'dictionary' : '';
  return DISCOVERY_TOPICS.slice(1).find(topic =>
    !status(topic) && status(topic + '-invitation') !== 'dismissed' && eligible(topic)
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
  const topics = {};
  for (const topic of [...GUIDE_TOPICS, ...GUIDE_SIGNALS]) {
    const choices = [left, right].filter(state => state?.version === 1).map(state => state.topics?.[topic]);
    if (topic.endsWith('-invitation') && choices.includes('dismissed')) topics[topic] = 'dismissed';
    else if (choices.includes('seen')) topics[topic] = 'seen';
    else if (choices.includes('dismissed')) topics[topic] = 'dismissed';
  }
  return Object.keys(topics).length ? { version: 1, topics } : null;
}
