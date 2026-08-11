// State
// ═══════════════════════════════════════════════════════
const LEGACY_DICTIONARY_KEY = 'lootlinguaDict';
const WORDS_NORMAL_PREFIX = 'words_normal_';
const WORDS_GAMER_PREFIX = 'words_gamer_';
const WORDS_CUSTOM_PREFIX = 'words_custom_';
const CUSTOM_WORLDS_PREFIX = 'custom_worlds_';
const PENDING_CUSTOM_WORLDS_PREFIX = 'pending_custom_worlds_';
const GUEST_MIGRATION_HANDLED_KEY = 'lootlinguaGuestMigrationHandled';
const GUEST_MIGRATION_COMPLETE_KEY = 'lootlingua_migration_complete';
const GUEST_DATA_DIRTY_KEY = 'lootlinguaGuestDataDirty';
const GUEST_MIGRATION_RECEIPT_VERSION = 1;
const GUEST_MIGRATION_SNAPSHOT_KEY = 'lootlingua:guest-migration-snapshot:v1:guest';
const GUEST_PROFILE_DIRTY_KEYS = new Set([
  'userXP',
  'dailyStreak',
  'lootlinguaMaxStreak',
  'lastActivityDate',
  'activityMap',
  'addedGameWords',
  'lootlinguaDailyLootState',
  'lootlinguaTitlesState',
  'lootlinguaActiveTitleId',
  'lootlinguaStreakFreezes',
  'lootlinguaFreezeSaves',
  'lootlinguaGameDictAdds',
  'lootlinguaPerfectQuizzes',
  'lootlinguaExtraChests',
]);
const GUEST_PROFILE_DIRTY_PREFIXES = ['lootlinguaDailyQuests_'];

function hasSignedInUser() {
  return Boolean(window.auth?.currentUser);
}

function markGuestDataDirty() {
  if (hasSignedInUser()) return;
  localStorage.setItem(GUEST_DATA_DIRTY_KEY, '1');
  localStorage.removeItem(GUEST_MIGRATION_HANDLED_KEY);
  localStorage.removeItem(GUEST_MIGRATION_COMPLETE_KEY);
  localStorage.removeItem(GUEST_MIGRATION_SNAPSHOT_KEY);
  // A completed migration belongs to the previous guest snapshot. If the
  // signed-out user creates fresh local learning data, the next sign-in must
  // make a new, account-scoped migration decision instead of reusing the old
  // resolved promise/session flag.
  window.__guestMigrationSessionComplete = false;
  window.__guestMigrationPromise = null;
  window.__guestMigrationUid = '';
  window.__guestMigrationSessionDecision = null;
}

function markGuestProfileDataDirty(key) {
  if (window.__applyingCloudProfile || hasSignedInUser()) return;
  if (GUEST_PROFILE_DIRTY_KEYS.has(key) || GUEST_PROFILE_DIRTY_PREFIXES.some(prefix => key.startsWith(prefix))) {
    markGuestDataDirty();
  }
}

function markGuestMigrationHandled(user, status) {
  localStorage.setItem(GUEST_MIGRATION_HANDLED_KEY, JSON.stringify({
    status,
    uid: user?.uid || '',
    at: Date.now()
  }));
}

function hasHandledGuestMigration() {
  return Boolean(localStorage.getItem(GUEST_MIGRATION_HANDLED_KEY));
}

function hasHandledGuestMigrationForUser(uid) {
  if (!uid) return hasHandledGuestMigration();
  try {
    const raw = localStorage.getItem(GUEST_MIGRATION_HANDLED_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data.uid === uid;
  } catch {
    return hasHandledGuestMigration();
  }
}

function isGuestMigrationComplete(uid) {
  if (!uid) return localStorage.getItem(GUEST_MIGRATION_COMPLETE_KEY) === 'true';
  try {
    const raw = localStorage.getItem(GUEST_MIGRATION_COMPLETE_KEY);
    if (!raw) return false;
    if (raw === 'true') return true;
    const data = JSON.parse(raw);
    return data.uid === uid;
  } catch {
    return localStorage.getItem(GUEST_MIGRATION_COMPLETE_KEY) === 'true';
  }
}

function guestMigrationReceiptStorageKey(user) {
  return window.LootLinguaEntryExperience?.guestMigrationReceiptStorageKey({ uid: user?.uid }) ||
    `lootlingua:guest-migration-receipt:v1:user:${user?.uid || ''}`;
}

function stableGuestSnapshotValue(value) {
  if (Array.isArray(value)) return value.map(stableGuestSnapshotValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableGuestSnapshotValue(value[key])])
  );
}

function guestMigrationSnapshotFingerprint(snapshot) {
  const loot = snapshot || getGuestLootSnapshot();
  const profile = loot.profile || {};
  const stableSnapshot = stableGuestSnapshotValue({
    words: loot.words || [],
    customWorlds: loot.customWorlds || [],
    pendingCustomWorlds: loot.pendingCustomWorlds || [],
    wordMastery: loot.wordMastery || {},
    activeQuizSession: loot.activeQuizSession || null,
    profile: {
      userXP: profile.userXP || 0,
      dailyStreak: profile.dailyStreak || 0,
      maxStreak: profile.maxStreak || 0,
      lastActivityDate: profile.lastActivityDate || '',
      activityMap: profile.activityMap || {},
      quizExposureHistory: profile.quizExposureHistory || [],
      addedGameWords: profile.addedGameWords || [],
      dailyLootState: profile.dailyLootState || {},
      titlesState: profile.titlesState || {},
      activeTitleId: profile.activeTitleId || '',
      dailyQuestState: profile.dailyQuestState || {},
      streakFreezes: profile.streakFreezes || 0,
      freezeSaves: profile.freezeSaves || 0,
      gameDictAdds: profile.gameDictAdds || 0,
      perfectQuizzes: profile.perfectQuizzes || 0,
      extraChests: profile.extraChests || [],
    },
  });
  const serialized = JSON.stringify(stableSnapshot);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `guest-${(hash >>> 0).toString(36)}-${serialized.length}`;
}

function ensureGuestMigrationSnapshotId(snapshot) {
  const id = guestMigrationSnapshotFingerprint(snapshot);
  if (localStorage.getItem(GUEST_MIGRATION_SNAPSHOT_KEY) !== id) {
    localStorage.setItem(GUEST_MIGRATION_SNAPSHOT_KEY, id);
  }
  return id;
}

function readGuestMigrationReceipt(user, snapshotId) {
  if (!user?.uid || !snapshotId) return null;
  try {
    const receipt = JSON.parse(localStorage.getItem(guestMigrationReceiptStorageKey(user)) || 'null');
    if (
      receipt?.version !== GUEST_MIGRATION_RECEIPT_VERSION ||
      receipt?.uid !== user.uid ||
      receipt?.guestSnapshotId !== snapshotId ||
      !['accepted', 'declined'].includes(receipt?.status)
    ) return null;
    return receipt;
  } catch (_) {
    return null;
  }
}

function writeGuestMigrationReceipt(user, status, snapshotId) {
  if (!user?.uid || !snapshotId || !['accepted', 'declined'].includes(status)) return null;
  const now = Date.now();
  const receipt = {
    version: GUEST_MIGRATION_RECEIPT_VERSION,
    uid: user.uid,
    guestSnapshotId: snapshotId,
    status,
    decidedAt: now,
    completedAt: status === 'accepted' ? now : 0,
    declinedAt: status === 'declined' ? now : 0,
  };
  localStorage.setItem(guestMigrationReceiptStorageKey(user), JSON.stringify(receipt));
  return receipt;
}

function markGuestMigrationCompleteFlag(user, status, snapshotId) {
  writeGuestMigrationReceipt(user, status, snapshotId);
  localStorage.setItem(GUEST_MIGRATION_COMPLETE_KEY, JSON.stringify({
    uid: user?.uid || '',
    status,
    at: Date.now()
  }));
  markGuestMigrationHandled(user, status);
  if (status === 'accepted') localStorage.removeItem(GUEST_DATA_DIRTY_KEY);
  window.__guestMigrationSessionComplete = true;
  window.__guestMigrationSessionDecision = {
    uid: user?.uid || '',
    guestSnapshotId: snapshotId || '',
    status,
  };
}

function purgeStaleGuestLocalData() {
  localStorage.removeItem(getWordsStorageKey('normal', 'guest'));
  localStorage.removeItem(getWordsStorageKey('gamer', 'guest'));
  localStorage.removeItem(getCustomWorldsStorageKey('guest'));
  localStorage.removeItem(getPendingCustomWorldsStorageKey('guest'));
  localStorage.removeItem('lootlinguaQuizExposureHistory_guest');
  localStorage.removeItem('lootlinguaWordMastery_guest');
  localStorage.removeItem('active_quiz_session');
  localStorage.removeItem(LEGACY_DICTIONARY_KEY);
  localStorage.removeItem(GUEST_DATA_DIRTY_KEY);
  localStorage.removeItem(GUEST_MIGRATION_SNAPSHOT_KEY);
  GUEST_PROFILE_DIRTY_KEYS.forEach((key) => localStorage.removeItem(key));
  Object.keys(localStorage).forEach((key) => {
    if (GUEST_PROFILE_DIRTY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      localStorage.removeItem(key);
    }
    if (key.startsWith(`${WORDS_CUSTOM_PREFIX}guest_`)) {
      localStorage.removeItem(key);
    }
  });
  if (typeof clearGuestSearchLocks === 'function') clearGuestSearchLocks();
  window.LootLinguaNotificationStore?.purgeOwner?.('guest');
}
window.purgeStaleGuestLocalData = purgeStaleGuestLocalData;

function getGuestLootSnapshot() {
  return {
    words: getGuestMigrationWords(),
    customWorlds: readCustomWorldsFromStorage('guest'),
    profile: getGuestProgressSnapshot(),
    wordMastery: loadJSON('lootlinguaWordMastery_guest', {}),
    activeQuizSession: loadJSON('active_quiz_session', null),
    pendingCustomWorlds: loadJSON(getPendingCustomWorldsStorageKey('guest'), []),
  };
}

function hasMeaningfulGuestLoot(snapshot) {
  const loot = snapshot || getGuestLootSnapshot();
  const words = loot.words || [];
  const p = loot.profile || {};
  const guestWorlds = readCustomWorldsFromStorage('guest');
  const wordMastery = loot.wordMastery && typeof loot.wordMastery === 'object'
    ? loot.wordMastery
    : {};
  const activeQuizSession = loot.activeQuizSession;
  const pendingCustomWorlds = Array.isArray(loot.pendingCustomWorlds)
    ? loot.pendingCustomWorlds
    : [];
  const xp = Math.max(Number(p.userXP) || 0, hasSignedInUser() ? 0 : (Number(userXP) || 0));
  if (guestWorlds.length > 0) return true;
  if (pendingCustomWorlds.length > 0) return true;
  if (Object.keys(wordMastery).length > 0) return true;
  if (activeQuizSession && typeof activeQuizSession === 'object') return true;
  if (words.length > 0) return true;
  if (xp > 0) return true;
  if ((Number(p.dailyStreak) || 0) > 0) return true;
  if ((Number(p.maxStreak) || 0) > 0) return true;
  if ((Number(p.streakFreezes) || 0) > 0) return true;
  if ((Number(p.freezeSaves) || 0) > 0) return true;
  if ((Number(p.gameDictAdds) || 0) > 0) return true;
  if ((Number(p.perfectQuizzes) || 0) > 0) return true;
  const titles = p.titlesState?.unlocked;
  if (Array.isArray(titles) && titles.length > 0) return true;
  const lootState = p.dailyLootState;
  if (lootState && ((Number(lootState.totalOpens) || 0) > 0 || (Number(lootState.streak) || 0) > 0)) return true;
  if (Array.isArray(p.addedGameWords) && p.addedGameWords.length > 0) return true;
  if (Array.isArray(p.extraChests) && p.extraChests.length > 0) return true;
  return false;
}

function reconcileEmptyGuestSessionState() {
  if (hasSignedInUser()) return;
  if ((Array.isArray(window.words) ? window.words.length : 0) > 0) return;
  if ((Number(userXP) || 0) > 0) return;
  purgeStaleGuestLocalData();
  resetGuestProgressState();
  localStorage.removeItem(GUEST_MIGRATION_HANDLED_KEY);
  localStorage.removeItem(GUEST_MIGRATION_COMPLETE_KEY);
  window.__guestMigrationSessionComplete = true;
}
window.reconcileEmptyGuestSessionState = reconcileEmptyGuestSessionState;
window.hasMeaningfulGuestLoot = hasMeaningfulGuestLoot;

function shouldSkipGuestMigrationPrompt(user) {
  if (!user?.uid) return true;
  if (!hasMeaningfulGuestLoot()) {
    reconcileEmptyGuestSessionState();
    return true;
  }
  const snapshotId = ensureGuestMigrationSnapshotId();
  if (readGuestMigrationReceipt(user, snapshotId)) return true;
  const sessionDecision = window.__guestMigrationSessionDecision;
  if (
    sessionDecision?.uid === user.uid &&
    sessionDecision?.guestSnapshotId === snapshotId &&
    ['accepted', 'declined', 'failed'].includes(sessionDecision.status)
  ) return true;
  // Old global markers are intentionally insufficient: they do not identify
  // the account and exact guest snapshot that was accepted or declined.
  return false;
}

function hasDirtyGuestData() {
  return localStorage.getItem(GUEST_DATA_DIRTY_KEY) === '1';
}

function getStorageUserId(uid) {
  return uid || window.auth?.currentUser?.uid || 'guest';
}

function getWordsStorageKey(type = 'normal', uid) {
  const prefix = type === 'gamer' ? WORDS_GAMER_PREFIX : WORDS_NORMAL_PREFIX;
  return prefix + getStorageUserId(uid);
}

function readWordsFromStorage(type = 'normal', uid) {
  const key = getWordsStorageKey(type, uid);
  const legacy = !uid && getStorageUserId(uid) === 'guest' ? localStorage.getItem(LEGACY_DICTIONARY_KEY) : null;
  try {
    const raw = localStorage.getItem(key) ?? legacy;
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWordsToStorage(words = window.words, type = 'normal', uid) {
  localStorage.setItem(getWordsStorageKey(type, uid), JSON.stringify(Array.isArray(words) ? words : []));
  if (getStorageUserId(uid) === 'guest' && Array.isArray(words) && words.length > 0) {
    markGuestDataDirty();
  }
  window.dispatchEvent?.(new CustomEvent('lootlingua:quiz-source-data-changed', {
    detail: { ownerId: getStorageUserId(uid), scope: type === 'normal' ? 'personal' : type, source: 'local-write' },
  }));
}

function getCustomWorldsStorageKey(uid) {
  return CUSTOM_WORLDS_PREFIX + getStorageUserId(uid);
}

function readCustomWorldsFromStorage(uid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(getCustomWorldsStorageKey(uid)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCustomWorldsToStorage(worlds = customWorlds, uid) {
  const uniqueWorlds = dedupeCustomWorlds(worlds);
  localStorage.setItem(getCustomWorldsStorageKey(uid), JSON.stringify(uniqueWorlds));
  if (getStorageUserId(uid) === 'guest' && Array.isArray(worlds) && worlds.length > 0) {
    markGuestDataDirty();
  }
}

function dedupeCustomWorlds(worlds = []) {
  const byId = new Map();
  (Array.isArray(worlds) ? worlds : []).forEach((world) => {
    if (!world?.id) return;
    const key = String(world.id);
    const previous = byId.get(key);
    byId.set(key, previous ? { ...previous, ...world } : world);
  });
  return [...byId.values()];
}

function getPendingCustomWorldsStorageKey(uid) {
  return PENDING_CUSTOM_WORLDS_PREFIX + getStorageUserId(uid);
}

function readPendingCustomWorldsFromStorage(uid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(getPendingCustomWorldsStorageKey(uid)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingCustomWorldsToStorage(worlds = [], uid) {
  localStorage.setItem(getPendingCustomWorldsStorageKey(uid), JSON.stringify(Array.isArray(worlds) ? worlds : []));
}

function upsertPendingCustomWorld(world, error, uid) {
  if (!world?.id) return;
  const key = String(world.id);
  const pending = readPendingCustomWorldsFromStorage(uid).filter(item => String(item.id) !== key);
  pending.push({
    ...world,
    syncStatus: 'pending',
    lastSyncError: error ? String(error).slice(0, 240) : '',
    pendingAt: new Date().toISOString(),
  });
  writePendingCustomWorldsToStorage(pending, uid);
}

function clearPendingCustomWorld(worldId, uid) {
  if (!worldId) return;
  const pending = readPendingCustomWorldsFromStorage(uid).filter(item => String(item.id) !== String(worldId));
  writePendingCustomWorldsToStorage(pending, uid);
}

function mergeCloudAndPendingCustomWorlds(cloudWorlds = [], uid, options = {}) {
  const cloud = dedupeCustomWorlds(cloudWorlds);
  const cloudIds = new Set(cloud.map(world => String(world.id)));
  const pending = readPendingCustomWorldsFromStorage(uid);
  const canConfirmSynced = options.confirmedServer === true;
  const remainingPending = pending.filter(world => !cloudIds.has(String(world.id)) || !canConfirmSynced);
  const unresolvedPending = pending.filter(world => !cloudIds.has(String(world.id)));
  if (remainingPending.length !== pending.length) {
    writePendingCustomWorldsToStorage(remainingPending, uid);
  }
  return dedupeCustomWorlds([...cloud, ...unresolvedPending]).sort((a, b) => {
    const at = Date.parse(a.createdAt || '') || 0;
    const bt = Date.parse(b.createdAt || '') || 0;
    return at - bt;
  });
}

let pendingCustomWorldRetryInFlight = false;
async function retryPendingCustomWorlds(reason = 'manual') {
  const user = window.auth?.currentUser;
  if (!user || pendingCustomWorldRetryInFlight || typeof window.saveCustomWorldToCloud !== 'function') return;
  const pending = readPendingCustomWorldsFromStorage(user.uid);
  if (!pending.length) return;
  pendingCustomWorldRetryInFlight = true;
  console.info('[LootLingua customWorlds] retry pending worlds', { reason, uid: user.uid, count: pending.length });
  try {
    for (const world of pending) {
      const ok = await window.saveCustomWorldToCloud(world);
      if (ok === true) clearPendingCustomWorld(world.id, user.uid);
      else upsertPendingCustomWorld(world, window.__lastCustomWorldSaveError || 'retry-failed', user.uid);
    }
    const merged = mergeCloudAndPendingCustomWorlds(customWorlds, user.uid);
    customWorlds = merged;
    writeCustomWorldsToStorage(customWorlds, user.uid);
    renderCustomWorldCards();
  } finally {
    pendingCustomWorldRetryInFlight = false;
  }
}
window.retryPendingCustomWorlds = retryPendingCustomWorlds;
window.addEventListener('online', () => retryPendingCustomWorlds('online'));

function getCustomWorldWordsStorageKey(worldId, uid) {
  return `${WORDS_CUSTOM_PREFIX}${getStorageUserId(uid)}_${String(worldId || '')}`;
}

function readCustomWorldWordsFromStorage(worldId, uid) {
  if (!worldId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(getCustomWorldWordsStorageKey(worldId, uid)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCustomWorldWordsToStorage(worldId, words = window.words, uid) {
  if (!worldId) return;
  localStorage.setItem(getCustomWorldWordsStorageKey(worldId, uid), JSON.stringify(Array.isArray(words) ? words : []));
  if (getStorageUserId(uid) === 'guest' && Array.isArray(words) && words.length > 0) {
    markGuestDataDirty();
  }
  window.dispatchEvent?.(new CustomEvent('lootlingua:quiz-source-data-changed', {
    detail: {
      ownerId: getStorageUserId(uid),
      scope: `custom:${String(worldId)}`,
      source: 'local-write',
    },
  }));
}

function removeCustomWorldWordsFromStorage(worldId, uid) {
  if (!worldId) return;
  localStorage.removeItem(getCustomWorldWordsStorageKey(worldId, uid));
}

function isCustomWorldView() {
  return currentView === 'customWorld' && Boolean(activeCustomWorldId);
}

function isEditableDictionaryView() {
  return currentView === 'personal' || isCustomWorldView();
}

function getActiveDictionaryStorageScope() {
  return isCustomWorldView() ? `custom_${activeCustomWorldId}` : 'personal';
}

function getActiveDictionaryWords() {
  return Array.isArray(window.words) ? window.words : [];
}

function writeActiveWordsToStorage(words = window.words, uid) {
  if (isCustomWorldView()) writeCustomWorldWordsToStorage(activeCustomWorldId, words, uid);
  else writeWordsToStorage(words, 'normal', uid);
}

function getActiveCustomWorld() {
  return customWorlds.find(world => String(world.id) === String(activeCustomWorldId)) || null;
}

window.isActiveCustomWorld = function(worldId) {
  return isCustomWorldView() && String(activeCustomWorldId) === String(worldId);
};

window.getWordsStorageKey = getWordsStorageKey;
window.readWordsFromStorage = readWordsFromStorage;
window.writeWordsToStorage = writeWordsToStorage;
window.replaceWordsForCurrentUser = function(words, type = 'normal', uid) {
  window.words = Array.isArray(words) ? words : [];
  writeWordsToStorage(window.words, type, uid);
};

window.clearDictionaryState = function({ renderView = true } = {}) {
  window.words = [];
  editId = null;
  pendingDeleteId = null;
  selectedIndices = [];
  isReorderMode = false;
  renderLimit = 20;
  if (renderView && typeof render === 'function') render();
};

window.loadGuestDictionaryState = function({ renderView = true } = {}) {
  loadDictionarySortPrefs();
  window.words = applyStoredWordOrder(readWordsFromStorage('normal', 'guest'));
  customWorlds = readCustomWorldsFromStorage('guest');
  if (dictionarySortMode !== 'auto') {
    window.words = sortDictionaryWords(window.words);
  }
  editId = null;
  pendingDeleteId = null;
  selectedIndices = [];
  isReorderMode = false;
  renderLimit = 20;
  if (renderView && typeof render === 'function') render();
};

window.applyCustomWorldsFromCloud = function(worlds, meta = {}) {
  const uid = window.auth?.currentUser?.uid;
  const confirmedServer = meta.fromCache === false && meta.hasPendingWrites === false;
  customWorlds = mergeCloudAndPendingCustomWorlds(worlds, uid, { confirmedServer });
  writeCustomWorldsToStorage(customWorlds, uid);
  renderCustomWorldCards();
  if (isCustomWorldView() && !getActiveCustomWorld()) {
    loadWorldsView();
  } else if (isCustomWorldView()) {
    updateCustomWorldHeader();
  }
  if (currentView === 'quiz') {
    syncQuizSourceOptions();
    refreshQuizAvailableCount();
    refreshQuizSettingsSummary();
  }
  retryPendingCustomWorlds('worlds-snapshot');
};

window.applyCustomWorldWordsFromSnapshot = function(worldId, cloudWords) {
  if (!window.isActiveCustomWorld(worldId)) {
    writeCustomWorldWordsToStorage(worldId, applyStoredWordOrder(cloudWords), window.auth?.currentUser?.uid);
    return;
  }
  loadDictionarySortPrefs();
  const prev = Array.isArray(window.words) ? window.words : [];
  let normalized = applyStoredWordOrder(cloudWords);
  if (dictionarySortMode !== 'auto') {
    normalized = sortDictionaryWords(normalized);
  }
  window.words = normalized;
  writeCustomWorldWordsToStorage(worldId, normalized, window.auth?.currentUser?.uid);
  const needsFullRender = wordsSnapshotNeedsFullRender(prev, normalized) || isReorderMode || isBulkDeleteMode;
  if (needsFullRender) {
    renderLimit = 20;
    render();
    return;
  }
  refreshFeatureUnlockUI();
  syncWordMetaInDom();
};

