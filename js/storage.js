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
  'lootlinguaDailyStreakState',
  'lootlinguaGameDictAdds',
  'lootlinguaPerfectQuizzes',
  'lootlinguaExtraChests',
  'lootlingua.runner.coins.v1',
  'lootlingua.runner.shop.v1:guest',
  'lootlingua.runner.best-distance.v1',
  'lootlingua.bots.v1:guest',
]);
const GUEST_PROFILE_DIRTY_PREFIXES = ['lootlinguaDailyQuests_'];

let quizSourceDataChangeBatch = null;
let quizSourceDataChangeGeneration = 0;

function dispatchQuizSourceDataChanged(detail = {}) {
  const ownerId = String(detail.ownerId || getStorageUserId());
  const scope = String(detail.scope || 'personal');
  if (quizSourceDataChangeBatch && quizSourceDataChangeBatch.ownerId === ownerId) {
    quizSourceDataChangeBatch.scopes.add(scope);
    return;
  }
  window.dispatchEvent?.(new CustomEvent('lootlingua:quiz-source-data-changed', {
    detail: { ...detail, ownerId, scope },
  }));
}

function beginQuizSourceDataChangeBatch(uid) {
  const ownerId = getStorageUserId(uid);
  if (!quizSourceDataChangeBatch || quizSourceDataChangeBatch.ownerId !== ownerId) {
    quizSourceDataChangeGeneration += 1;
    quizSourceDataChangeBatch = {
      generation: quizSourceDataChangeGeneration,
      ownerId,
      depth: 0,
      scopes: new Set(),
    };
  }
  quizSourceDataChangeBatch.depth += 1;
  return {
    generation: quizSourceDataChangeBatch.generation,
    ownerId,
  };
}

function endQuizSourceDataChangeBatch(token) {
  const batch = quizSourceDataChangeBatch;
  if (!batch || token?.generation !== batch.generation || token?.ownerId !== batch.ownerId) return;
  batch.depth = Math.max(0, batch.depth - 1);
  if (batch.depth > 0) return;
  quizSourceDataChangeBatch = null;
  if (!batch.scopes.size) return;
  dispatchQuizSourceDataChanged({
    ownerId: batch.ownerId,
    scope: batch.scopes.size === 1 ? [...batch.scopes][0] : 'multiple',
    scopes: [...batch.scopes],
    source: 'quiz-learning-batch',
  });
}

window.beginQuizSourceDataChangeBatch = beginQuizSourceDataChangeBatch;
window.endQuizSourceDataChangeBatch = endQuizSourceDataChangeBatch;
window.addEventListener?.('lootlingua:auth-state', () => {
  quizSourceDataChangeGeneration += 1;
  quizSourceDataChangeBatch = null;
});

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
      ...(profile.lastPersonalTrustedQuizAt ? { lastPersonalTrustedQuizAt: profile.lastPersonalTrustedQuizAt } : {}),
      addedGameWords: profile.addedGameWords || [],
      dailyLootState: profile.dailyLootState || {},
      titlesState: profile.titlesState || {},
      activeTitleId: profile.activeTitleId || '',
      dailyQuestState: profile.dailyQuestState || {},
      streakFreezes: profile.streakFreezes || 0,
      freezeSaves: profile.freezeSaves || 0,
      streakState: profile.streakState || null,
      gameDictAdds: profile.gameDictAdds || 0,
      perfectQuizzes: profile.perfectQuizzes || 0,
      extraChests: profile.extraChests || [],
      ...(profile.extraChestState ? { extraChestState: profile.extraChestState } : {}),
      runnerCoins: profile.runnerCoins || 0,
      ...(profile.runnerUnlocks?.length ? { runnerUnlocks: profile.runnerUnlocks } : {}),
      runnerBestDistance: profile.runnerBestDistance || 0,
      ...(profile.lootBots ? { lootBots: profile.lootBots } : {}),
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

const LEGACY_GUEST_PROFILE_KEY = 'lootlingua:retained-guest-profile:v1';

function purgeStaleGuestLocalData({ keepSearchTrial = false } = {}) {
  localStorage.removeItem(LEGACY_GUEST_PROFILE_KEY);
  localStorage.removeItem(getWordsStorageKey('normal', 'guest'));
  localStorage.removeItem(getWordsStorageKey('gamer', 'guest'));
  localStorage.removeItem(getCustomWorldsStorageKey('guest'));
  localStorage.removeItem(getPendingCustomWorldsStorageKey('guest'));
  localStorage.removeItem('lootlinguaQuizExposureHistory_guest');
  localStorage.removeItem('lootlinguaLastPersonalTrustedQuizAt_guest');
  localStorage.removeItem('lootlinguaWordMastery_guest');
  localStorage.removeItem('lootlinguaMotivation_v1_guest');
  localStorage.removeItem('lootlingua:guest-treasure:v1');
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
  if (!keepSearchTrial && typeof clearGuestSearchLocks === 'function') clearGuestSearchLocks();
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
  if ((Number(p.runnerCoins) || 0) > 0) return true;
  if (p.runnerUnlocks?.length > 0) return true;
  if ((Number(p.runnerBestDistance) || 0) > 0) return true;
  if (p.lootBots && (['coins', 'best', 'bosses', 'seconds'].some(key => Number(p.lootBots[key]) > 0) ||
      Object.keys(p.lootBots.audio || {}).length > 0)) return true;
  const titles = p.titlesState?.unlocked;
  if (Array.isArray(titles) && titles.length > 0) return true;
  const lootState = p.dailyLootState;
  if (lootState && ((Number(lootState.totalOpens) || 0) > 0 || (Number(lootState.streak) || 0) > 0)) return true;
  if (Array.isArray(p.addedGameWords) && p.addedGameWords.length > 0) return true;
  if (Array.isArray(p.extraChests) && p.extraChests.length > 0) return true;
  return false;
}

function reconcileEmptyGuestSessionState() {
  if (hasSignedInUser() || window.hasPreservedLegacyGuestProfile?.()) return;
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
  const pages = type === 'normal' && window.LootLinguaDictionaryPages?.current(getStorageUserId(uid));
  if (pages) return pages.words();
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

let personalBackupTimer = null;
window.cacheCompletePersonalDictionary = function(words, uid) {
  clearTimeout(personalBackupTimer);
  personalBackupTimer = setTimeout(() => {
    if (window.auth?.currentUser?.uid !== uid) return;
    try { localStorage.setItem(getWordsStorageKey('normal', uid), JSON.stringify(words)); }
    catch (error) { console.warn('[Dictionary] Offline backup unavailable:', error?.name); }
  }, 500);
};
window.readPersonalDictionaryBackup = function(uid) {
  try {
    const value = JSON.parse(localStorage.getItem(getWordsStorageKey('normal', uid)) || 'null');
    return Array.isArray(value) ? value : null;
  } catch (_) { return null; }
};

function writeWordsToStorage(words = window.words, type = 'normal', uid) {
  const ownerId = getStorageUserId(uid);
  const pages = type === 'normal' && window.LootLinguaDictionaryPages?.current(ownerId);
  if (pages) {
    pages.replaceLoaded(words);
    if (pages.state().complete && !pages.state().offline) window.cacheCompletePersonalDictionary(words, ownerId);
    dispatchQuizSourceDataChanged({ ownerId, scope: 'personal', source: 'page-cache-write' });
    return true;
  }
  const key = getWordsStorageKey(type, uid);
  const serialized = JSON.stringify(Array.isArray(words) ? words : []);
  if (ownerId === 'guest' && Array.isArray(words) && words.length > 0) {
    markGuestDataDirty();
  }
  if (localStorage.getItem(key) === serialized) return false;
  localStorage.setItem(key, serialized);
  dispatchQuizSourceDataChanged({
    ownerId,
    scope: type === 'normal' ? 'personal' : type,
    source: 'local-write',
  });
  return true;
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
window.readCustomWorldsFromStorage = readCustomWorldsFromStorage;

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
  try {
    localStorage.setItem(getPendingCustomWorldsStorageKey(uid), JSON.stringify(Array.isArray(worlds) ? worlds : []));
    window.LootLinguaOperations?.syncStorageFailure?.(getStorageUserId(uid), 'custom-worlds', false);
  } catch (error) {
    window.LootLinguaOperations?.syncStorageFailure?.(getStorageUserId(uid), 'custom-worlds', true);
    throw error;
  }
}
window.LootLinguaOperations?.setSyncSource?.('custom-worlds', uid => {
  const worlds = readPendingCustomWorldsFromStorage(uid);
  const rejected = worlds.filter(world => world.syncStatus === 'rejected');
  return { pending: worlds.length - rejected.length, rejected: rejected.length,
    rejections: rejected.map(world => ({ scope: 'custom-worlds', reason: world.lastSyncError })) };
});

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

const removalWorldOutbox = window.LootLinguaOperations?.createOutbox?.('custom-world-remove', async item => {
  if (typeof window.deleteCustomWorldFromCloud !== 'function') throw Object.assign(new Error('World storage is starting.'), { code: 'unavailable' });
  const { worldId, action, base, wordIds } = item.payload;
  const ok = await window.deleteCustomWorldFromCloud(worldId, { action, base, wordIds, propagate: true });
  if (ok !== true) throw Object.assign(new Error('World removal was not confirmed.'), { code: 'failed-precondition' });
}, {
  onConfirmed(item) {
    const { worldId } = item.payload;
    clearPendingCustomWorld(worldId, item.owner);
    removeCustomWorldWordsFromStorage(worldId, item.owner);
    const remaining = readCustomWorldsFromStorage(item.owner).filter(world => String(world.id) !== String(worldId));
    writeCustomWorldsToStorage(remaining, item.owner);
  },
});
function isWorldRemovalPending(worldId, owner) {
  return Boolean(removalWorldOutbox?.list(owner).some(item => !item.rejected && item.payload.worldId === String(worldId)));
}
window.isCustomWorldPendingSync = (worldId, owner) => readPendingCustomWorldsFromStorage(owner).some(world =>
  String(world.id) === String(worldId) && world.syncStatus !== 'rejected' && !isWorldRemovalPending(worldId, owner));

function queueCustomWorldRemoval(world, wordIds, action) {
  if (!removalWorldOutbox || !world?.id) return false;
  const worldId = String(world.id);
  const base = { name: world.name, description: world.description, emoji: world.emoji };
  removalWorldOutbox.enqueue('remove-world', { worldId, base, wordIds: [...new Set(wordIds.map(String))], action }, {
    id: `${worldId}:${action}`, lane: worldId,
  });
  return true;
}

function mergeCloudAndPendingCustomWorlds(cloudWorlds = [], uid, options = {}) {
  const cloud = dedupeCustomWorlds(cloudWorlds);
  const worlds = new Map(cloud.map(world => [String(world.id), world]));
  const pending = readPendingCustomWorldsFromStorage(uid);
  const canConfirmSynced = options.confirmedServer === true;
  const remainingPending = pending.filter(world => {
    const confirmed = worlds.get(String(world.id));
    return !canConfirmSynced || !confirmed || !['name', 'description', 'emoji'].every(field => String(world[field] || '') === String(confirmed[field] || ''));
  });
  if (remainingPending.length !== pending.length) {
    writePendingCustomWorldsToStorage(remainingPending, uid);
  }
  for (const world of remainingPending) {
    if (world.syncStatus !== 'rejected') worlds.set(String(world.id), world);
  }
  for (const item of removalWorldOutbox?.list(getStorageUserId(uid)) || []) {
    if (!item.rejected) worlds.delete(String(item.payload.worldId));
  }
  return [...worlds.values()].sort((a, b) => {
    const at = Date.parse(a.createdAt || '') || 0;
    const bt = Date.parse(b.createdAt || '') || 0;
    return at - bt;
  });
}

let pendingCustomWorldRetryInFlight = false;
let customWorldSyncTimer;
function scheduleCustomWorldSync() {
  clearTimeout(customWorldSyncTimer);
  const user = window.auth?.currentUser;
  if (!user || window.navigator?.onLine === false || !readPendingCustomWorldsFromStorage(user.uid).some(world => world.syncStatus !== 'rejected' && !isWorldRemovalPending(world.id, user.uid))) return;
  customWorldSyncTimer = setTimeout(() => retryPendingCustomWorlds('scheduled'), Math.max(1000, window.LootLinguaCloudBackoff?.remaining() || 0));
}
async function retryPendingCustomWorlds(reason = 'manual') {
  const user = window.auth?.currentUser;
  if (!user || pendingCustomWorldRetryInFlight || typeof window.saveCustomWorldToCloud !== 'function') return;
  if (window.LootLinguaCloudBackoff?.reason?.()) { scheduleCustomWorldSync(); return; }
  const pending = readPendingCustomWorldsFromStorage(user.uid).filter(world => world.syncStatus !== 'rejected' && !isWorldRemovalPending(world.id, user.uid));
  if (!pending.length) return;
  pendingCustomWorldRetryInFlight = true;
  const generation = Number(window.__lootlinguaAuthGeneration) || 0;
  const current = () => user.uid === window.auth?.currentUser?.uid && (Number(window.__lootlinguaAuthGeneration) || 0) === generation;
  const ops = window.LootLinguaOperations;
  const work = async lock => {
    if (!lock || !current()) return;
    ops?.syncActivity?.(user.uid, 'custom-worlds', { active: true });
  try {
    for (const world of pending) {
      if (!current()) return;
      if (isWorldRemovalPending(world.id, user.uid)) continue;
      const latest = () => readPendingCustomWorldsFromStorage(user.uid).find(item => item.id === world.id);
      if (latest()?.pendingAt !== world.pendingAt) continue;
      try {
        await window.LootLinguaCloudBackoff?.assertAvailable?.();
        const ok = await window.saveCustomWorldToCloud(world, { reconcile: true, propagate: true });
        if (current() && ok === true && latest()?.pendingAt === world.pendingAt) clearPendingCustomWorld(world.id, user.uid);
      } catch (error) {
        const backoff = window.LootLinguaCloudBackoff;
        const failure = backoff?.classify?.(error);
        if (failure?.temporary) { backoff.pause(error); scheduleCustomWorldSync(); break; }
        if (current() && latest()?.pendingAt === world.pendingAt) {
          const pending = readPendingCustomWorldsFromStorage(user.uid).map(row => row === world || row.id === world.id
            ? { ...row, syncStatus: 'rejected', lastSyncError: failure?.reason || 'unexpected' } : row);
          writePendingCustomWorldsToStorage(pending, user.uid);
        }
      }
    }
    if (!current()) return;
    const merged = mergeCloudAndPendingCustomWorlds(customWorlds, user.uid);
    customWorlds = merged;
    writeCustomWorldsToStorage(customWorlds, user.uid);
    renderCustomWorldCards();
  } finally {
    ops?.syncActivity?.(user.uid, 'custom-worlds', {});
  }
  };
  try {
    if (window.navigator?.locks) await window.navigator.locks.request('lootlingua:custom-worlds:' + user.uid, { ifAvailable: true }, work);
    else await work(true);
  } finally { pendingCustomWorldRetryInFlight = false; }
}
window.retryPendingCustomWorlds = retryPendingCustomWorlds;
window.addEventListener('online', () => retryPendingCustomWorlds('online'));
window.addEventListener('lootlingua:cloud-capacity-change', scheduleCustomWorldSync);
window.addEventListener('storage', event => {
  const uid = window.auth?.currentUser?.uid;
  if (uid && event.key === getPendingCustomWorldsStorageKey(uid)) {
    window.LootLinguaOperations?.syncNotify?.();
    scheduleCustomWorldSync();
  }
});

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

function hasPrivateWorldWordsCache(worldId, uid) {
  try { return localStorage.getItem(getCustomWorldWordsStorageKey(worldId, uid)) !== null; }
  catch (_) { return false; }
}

function getPrivateWorldCompleteKey(worldId, uid) {
  return 'lootlingua:complete:' + getCustomWorldWordsStorageKey(worldId, uid);
}

function getActivePrivateWorldWordCount() {
  const uid = window.auth?.currentUser?.uid;
  if (!uid) return window.words.length;
  try {
    const complete = localStorage.getItem(getPrivateWorldCompleteKey(activeCustomWorldId, uid)) === '1';
    return complete && hasPrivateWorldWordsCache(activeCustomWorldId, uid) ? window.words.length : '—';
  } catch (_) { return '—'; }
}

function writeCustomWorldWordsToStorage(worldId, words = window.words, uid) {
  if (!worldId) return false;
  const ownerId = getStorageUserId(uid);
  const key = getCustomWorldWordsStorageKey(worldId, uid);
  const serialized = JSON.stringify(Array.isArray(words) ? words : []);
  if (ownerId === 'guest' && Array.isArray(words) && words.length > 0) {
    markGuestDataDirty();
  }
  if (localStorage.getItem(key) === serialized) return false;
  localStorage.setItem(key, serialized);
  dispatchQuizSourceDataChanged({
    ownerId,
    scope: `custom:${String(worldId)}`,
    source: 'local-write',
  });
  return true;
}

function removeCustomWorldWordsFromStorage(worldId, uid) {
  if (!worldId) return;
  localStorage.removeItem(getCustomWorldWordsStorageKey(worldId, uid));
  localStorage.removeItem(getPrivateWorldCompleteKey(worldId, uid));
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

window.getActiveCustomWorldId = () => isCustomWorldView() ? String(activeCustomWorldId) : '';

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

window.clearDictionaryState = function({ renderView = true, resetSession = false } = {}) {
  if (resetSession) {
    activeCustomWorldId = null;
    customWorlds = [];
    currentView = 'personal';
    window.__dictionaryNavigationGeneration = (Number(window.__dictionaryNavigationGeneration) || 0) + 1;
    window.dispatchEvent(new CustomEvent('lootlingua:dictionary-navigation'));
    delete window.__dictionarySaveInFlight;
    if (typeof restoreActiveAddFormDraft === 'function') restoreActiveAddFormDraft();
    else if (typeof resetAddFormEditState === 'function') resetAddFormEditState();
    document.getElementById('addBtn')?.removeAttribute('aria-busy');
  }
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
  const activeWorld = isCustomWorldView() ? getActiveCustomWorld() : null;
  customWorlds = mergeCloudAndPendingCustomWorlds(worlds, uid, { confirmedServer });
  if (activeWorld && !confirmedServer && !getActiveCustomWorld()) customWorlds.push(activeWorld);
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
  window.dispatchEvent(new CustomEvent('lootlingua:custom-worlds-updated', { detail: { uid, confirmedServer } }));
};

window.applyCustomWorldWordsFromSnapshot = function(worldId, cloudWords, meta = {}) {
  const uid = window.auth?.currentUser?.uid;
  const unconfirmed = meta.listener && meta.fromCache;
  // The SDK cache may only hold part of the collection. Prefer our last
  // complete snapshot and never promote a partial result to a full count.
  if (unconfirmed && (hasPrivateWorldWordsCache(worldId, uid) || !cloudWords.length)) return;
  const projected = window.LootLinguaDictionarySync?.project(cloudWords, uid, worldId, meta.fromCache === true) || cloudWords;
  const rememberComplete = () => {
    if (!meta.listener || unconfirmed) return;
    try {
      const key = getPrivateWorldCompleteKey(worldId, uid);
      if (localStorage.getItem(key) !== '1') localStorage.setItem(key, '1');
    } catch (_) {}
  };
  if (!window.isActiveCustomWorld(worldId)) {
    if (!unconfirmed) {
      writeCustomWorldWordsToStorage(worldId, applyStoredWordOrder(cloudWords), uid);
      rememberComplete();
    }
    return;
  }
  loadDictionarySortPrefs();
  const prev = Array.isArray(window.words) ? window.words : [];
  let normalized = applyStoredWordOrder(projected);
  if (dictionarySortMode !== 'auto') {
    normalized = sortDictionaryWords(normalized);
  }
  window.words = normalized;
  if (!unconfirmed) {
    writeCustomWorldWordsToStorage(worldId, projected === cloudWords ? normalized : applyStoredWordOrder(cloudWords), uid);
    rememberComplete();
  }
  const needsFullRender = wordsSnapshotNeedsFullRender(prev, normalized) || isReorderMode || isBulkDeleteMode;
  if (!needsFullRender) renderProfileModalStats();
  if (needsFullRender) {
    renderLimit = 20;
    render();
    return;
  }
  refreshFeatureUnlockUI();
  syncWordMetaInDom();
};

