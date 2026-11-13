
// نستورد setDoc و getDoc بشكل منفصل عشان ما يكسر الـ module الأول
import { getApps }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { applyProfileIntent, profileOperationId, profileStorageIntents, mergeOnboardingProgress } from './profile-sync-policy.mjs?v=20261113-review-guide';

// استخدم التطبيق الموجود فقط بدون إعادة تعريف إذا كان معرف مسبقًا
let profileApp  = getApps()[0];
let profileDb   = getFirestore(profileApp);
let profileAuth = getAuth(profileApp);

function pendingGuestProfileMigrationKey(user) {
  return window.LootLinguaEntryExperience?.profileMigrationStorageKey({ uid: user?.uid }) ||
    `lootlingua:guest-profile-migration:v1:user:${user?.uid || ''}`;
}

function readPendingGuestProfileMigration(user) {
  if (!user?.uid) return null;
  try {
    const value = JSON.parse(localStorage.getItem(pendingGuestProfileMigrationKey(user)) || 'null');
    const profiles = Array.isArray(value?.profiles)
      ? value.profiles.filter((profile) => profile && typeof profile === 'object' && !Array.isArray(profile))
      : [];
    const fallbackProfile = value?.profile && typeof value.profile === 'object' && !Array.isArray(value.profile)
      ? value.profile
      : null;
    if (
      value?.version !== 1 ||
      value?.uid !== user.uid ||
      (!profiles.length && !fallbackProfile)
    ) return null;
    return {
      ...value,
      profile: fallbackProfile || profiles[profiles.length - 1],
      profiles: profiles.length ? profiles : [fallbackProfile],
    };
  } catch (_) {
    return null;
  }
}

function completePendingGuestProfileMigration(user, saved, hasExplicitTheme) {
  if (saved !== true) return false;
  const pending = readPendingGuestProfileMigration(user);
  if (!pending) return false;
  // Do not consume this recovery record yet: notification migration can still
  // fail after the profile write.  Retaining a verified marker lets retries
  // skip the already-applied guest balance without deleting guest data early.
  const committed = { ...pending, profileCommittedAt: Number(pending.profileCommittedAt) || Date.now(), updatedAt: Date.now() };
  localStorage.setItem(pendingGuestProfileMigrationKey(user), JSON.stringify(committed));
  window.__acceptedGuestProfileMigration = committed;
  if (hasExplicitTheme) {
    sessionStorage.removeItem('lootlingua:guest-theme-explicit:v1');
  }
  return true;
}

window.finalizePendingGuestProfileMigration = function(user) {
  if (!user?.uid) return false;
  localStorage.removeItem(pendingGuestProfileMigrationKey(user));
  if (window.__acceptedGuestProfileMigration?.uid === user.uid) {
    window.__acceptedGuestProfileMigration = null;
  }
  return true;
};

function diagnosticProfileValue(value, seen = new WeakSet()) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map((item) => diagnosticProfileValue(item, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, diagnosticProfileValue(item, seen)])
  );
}

function persistedProfileValueMatches(actual, expected) {
  if (expected instanceof Date) {
    const actualMillis = typeof actual?.toMillis === 'function'
      ? actual.toMillis()
      : (actual instanceof Date ? actual.getTime() : NaN);
    return actualMillis === expected.getTime();
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      expected.every((item, index) => persistedProfileValueMatches(actual[index], item));
  }
  if (expected && typeof expected === 'object') {
    return actual && typeof actual === 'object' && !Array.isArray(actual) &&
      Object.keys(expected).every((key) => persistedProfileValueMatches(actual[key], expected[key]));
  }
  return Object.is(actual, expected);
}

function reportProfileSaveFailure(error, referencePath, operation, payload) {
  const diagnostic = {
    path: referencePath,
    operation,
    writeMethod: 'transaction-sync',
    code: String(error?.code || 'profile/save-failed'),
    message: String(error?.message || error || 'Unknown profile save failure'),
    name: String(error?.name || 'Error'),
    payload: diagnosticProfileValue(payload),
  };
  window.__lootlinguaLastProfileSaveFailure = diagnostic;
  // Preserve the original Firebase error object, including its code and stack.
  if (!error?.capacityBackoff) console.error('saveProfile:', diagnostic, error);
  return diagnostic;
}

let _saveProfileDebounce = null;
let _profileAuthEpoch = 0;
let _profileLoadSequence = 0;
let _activeProfileLoad = null;
const _profilePreferenceSaves = new Map();
const _profileTaskQueues = new Map();
let _profileSnapshotUnsubscribe = null;
let _profileRetryTimer = null;
let _profileOperationSequence = 0;
let _profileOperationClock = 0;
const _profileLocalBaselines = new Map();

function profileOutboxPrefix(uid) { return `lootlingua:profile-outbox:v1:${uid}:`; }
function botsOutboxPrefix(uid) { return `lootlingua:profile-outbox:bots-v1:${uid}:`; }
function profileReceiptId(id) {
  const encoded = encodeURIComponent(id);
  if (encoded.length > 1200) throw new Error('Profile operation identifier is too long');
  return `xp_event_profile_sync_v1_${encoded}`;
}
function readProfileOutbox(uid) {
  const prefix = profileOutboxPrefix(uid);
  const botsPrefix = botsOutboxPrefix(uid);
  const operations = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix) && !key?.startsWith(botsPrefix)) continue;
    try {
      const operation = JSON.parse(localStorage.getItem(key));
      if (operation?.version === 1 && operation.uid === uid && operation.id && Array.isArray(operation.commands)) operations.push({ ...operation, key });
    } catch (_) {}
  }
  return operations.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
function enqueueProfileTask(owner, task) {
  const key = JSON.stringify([owner?.uid, owner?.generation, owner?.epoch]);
  const previous = _profileTaskQueues.get(key) || Promise.resolve();
  const running = previous.catch(() => {}).then(() => {
    if (!isProfileOwnerCurrent(owner)) return { saved: false, reason: 'auth/identity-changed' };
    return task();
  });
  _profileTaskQueues.set(key, running);
  running.finally(() => { if (_profileTaskQueues.get(key) === running) _profileTaskQueues.delete(key); }).catch(() => {});
  return running;
}
function syncOnboardingProgress(data, owner) {
  const discoveryKey = `lootlingua:feature-discovery:v1:user:${owner.uid}`;
  const personalKey = `lootlingua:personal-dictionary-onboarding:v1:user:${owner.uid}`;
  const worldGuideKey = `lootlingua:public-world-guide:v1:user:${owner.uid}`;
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } };
  const discovery = read(discoveryKey) || { version: 1, features: {} };
  const features = { ...(discovery.features || {}) };
  let changed = false;
  for (const tour of ['treasure', 'quiz', 'starred', 'custom-worlds', 'personal-dictionary', 'public-world-guide']) {
    const separateKey = tour === 'personal-dictionary' ? personalKey : tour === 'public-world-guide' ? worldGuideKey : '';
    const local = separateKey ? read(separateKey) : features[tour];
    const remote = data.onboardingProgress?.[tour];
    const merged = mergeOnboardingProgress(tour, remote, local);
    if (!merged) continue;
    if (JSON.stringify(mergeOnboardingProgress(tour, local, null)) !== JSON.stringify(merged)) {
      changed = true;
      if (separateKey) localStorage.setItem(separateKey, JSON.stringify(merged));
      else features[tour] = merged;
    }
    // Firestore maps can return fields in a different order. Compare the
    // normalized values, never the serialization order of a server map.
    if (JSON.stringify(mergeOnboardingProgress(tour, remote, null)) !== JSON.stringify(merged)) {
      // Hydration suppresses intents. Import the account's local checkpoints
      // after hydration, guarded against sign-out/account switching.
      queueMicrotask(() => {
        if (isProfileOwnerCurrent(owner)) window.queueProfileIntent?.({ type: 'onboarding', tour, state: merged });
      });
    }
  }
  if (changed) {
    localStorage.setItem(discoveryKey, JSON.stringify({ version: 1, features }));
    window.dispatchEvent(new CustomEvent('lootlingua:onboarding-cloud-change', { detail: { uid: owner.uid } }));
  }
}
function applyCanonicalProfile(data, owner) {
  if (!isProfileOwnerCurrent(owner)) return;
  const known = window.__lootlinguaProfileSnapshot;
  if (known?.uid === owner.uid && Number(known.data?._syncRevision || 0) > Number(data?._syncRevision || 0)) data = known.data;
  let projected = data || {};
  for (const operation of readProfileOutbox(owner.uid)) {
    // Only idempotent presentation/set projections are safe before a receipt.
    // A lost acknowledgement may already be present in this snapshot; replaying
    // an additive counter or wallet locally would display it twice.
    for (const command of operation.commands) {
      if (['max', 'titles', 'union', 'appearance', 'quest', 'exposure', 'loot-progress', 'onboarding', 'bots-audio'].includes(command.type)) {
        projected = applyProfileIntent(projected, command).profile;
      }
    }
  }
  const wasHydrating = window.__profileHydrating === true;
  window.__profileHydrating = true;
  try {
    if (typeof window.applyCanonicalLootlinguaProfile === 'function') window.applyCanonicalLootlinguaProfile(projected);
    else window.mergeLootlinguaProfileFromCloud?.(projected, { canonical: true });
    syncOnboardingProgress(projected, owner);
    window.LootLinguaGateRunner?.acceptProfile?.(projected, owner.uid);
    window.LootLinguaBots?.acceptProfile?.(projected, owner.uid);
    _profileLocalBaselines.set(owner.uid, window.getLootlinguaProfilePayload?.() || projected);
    try { window.LootLinguaMotivation?.acceptProfile?.(data, owner.uid); }
    catch (error) { console.warn('[Motivation] Profile presentation deferred.', error); }
  } finally { window.__profileHydrating = wasHydrating; }
}
function scheduleProfileFlush() {
  clearTimeout(_profileRetryTimer);
  _profileRetryTimer = setTimeout(() => { window.flushProfileIntents?.(); }, Math.max(450, window.LootLinguaCloudBackoff?.remaining() || 0));
}
window.addEventListener?.('lootlingua:cloud-capacity-change', scheduleProfileFlush);

function compactPresentationIntents(owner) {
  const groups = new Map();
  for (const operation of readProfileOutbox(owner.uid)) {
    if (operation.commands.length !== 1) continue;
    const command = operation.commands[0];
    if (!['onboarding', 'appearance'].includes(command.type)) continue;
    if (command.type === 'appearance' && Object.keys(command.patch || {}).some(field => !['theme', 'oasisMode', 'themeIntroSeen'].includes(field))) continue;
    const key = command.type === 'appearance' ? 'appearance' : `onboarding:${command.tour}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(operation);
  }
  for (const operations of groups.values()) {
    if (operations.length < 2) continue;
    let merged = {};
    for (const operation of operations) merged = applyProfileIntent(merged, operation.commands[0]).profile;
    const last = operations.at(-1), command = last.commands[0];
    const combined = command.type === 'onboarding'
      ? { type: 'onboarding', tour: command.tour, state: merged.onboardingProgress?.[command.tour] }
      : { type: 'appearance', patch: Object.fromEntries(['theme', 'oasisMode', 'themeIntroSeen'].filter(field => Object.hasOwn(merged, field)).map(field => [field, merged[field]])) };
    // Persist the replacement before removing duplicates. Only idempotent
    // presentation intents are compacted; wallet/XP receipts stay untouched.
    const id = `presentation-compact:${Date.now()}-${++_profileOperationSequence}-${Math.random().toString(36).slice(2)}`;
    if (queueProfileCommands([combined], { id, project: false })) for (const operation of operations) localStorage.removeItem(operation.key);
  }
}
function queueProfileCommands(commands, options = {}) {
  const owner = captureProfileOwner();
  if (!owner || window.__profileHydrating || !commands.length) return null;
  const id = options.id || (commands.length === 1 ? profileOperationId(commands[0]) : null) ||
    window.crypto?.randomUUID?.() || `${Date.now()}-${++_profileOperationSequence}-${Math.random().toString(36).slice(2)}`;
  profileReceiptId(id);
  // Older open tabs can still flush the ordinary outbox. Keep new commands
  // out of their queue so they cannot receipt a game command as unsupported.
  const prefix = commands.every(command => command.type.startsWith('bots-')) ? botsOutboxPrefix(owner.uid) : profileOutboxPrefix(owner.uid);
  const key = `${prefix}${encodeURIComponent(id)}`;
  if (!localStorage.getItem(key)) {
    _profileOperationClock = Math.max(Date.now(), _profileOperationClock + 1);
    localStorage.setItem(key, JSON.stringify({ version: 1, uid: owner.uid, id, commands, createdAt: _profileOperationClock }));
  }
  if (options.project !== false && window.__lootlinguaProfileSnapshot?.uid === owner.uid) {
    applyCanonicalProfile(window.__lootlinguaProfileSnapshot.data, owner);
  }
  scheduleProfileFlush();
  return id;
}
window.queueProfileIntent = function(intent) {
  if (!intent || typeof intent !== 'object' || !intent.type) return null;
  return queueProfileCommands([JSON.parse(JSON.stringify(intent))]);
};
window.recordProfileStorageMutation = function(key, before, after) {
  if (window.__profileHydrating || !profileAuth.currentUser || !_profileLocalBaselines.has(profileAuth.currentUser.uid)) return;
  const commands = profileStorageIntents(key, before, after);
  if (commands.length) queueProfileCommands(commands, { project: false });
};

async function transactProfileOutbox(owner, options = {}) {
  const current = () => isProfileOwnerCurrent(owner) &&
    (!options.profileLoadOwner || isProfileOperationCurrent(owner, options.profileLoadOwner));
  const reference = doc(profileDb, 'users', owner.uid, 'meta', 'profile');
  const results = {};
  let persistedData = null;
  while (current()) {
    const operations = readProfileOutbox(owner.uid).slice(0, 20);
    if (!operations.length) break;
    const receiptRefs = operations.map((operation) => doc(profileDb, 'users', owner.uid, 'meta', profileReceiptId(operation.id)));
    const consumedIds = [...new Set(operations.flatMap((operation) => operation.commands.flatMap((command) =>
      command.type === 'extra-add' ? (command.chests || []).map((chest) => String(chest.id)) :
        command.type === 'extra-remove' ? [String(command.chestId)] : [])))];
    const consumedRefs = consumedIds.map((id) => doc(profileDb, 'users', owner.uid, 'meta', profileReceiptId(`extra-consumed:${id}`)));
    const unlockIds = [...new Set(operations.flatMap((operation) => operation.commands
      .filter((command) => command.type === 'loot-progress' && command.resolved)
      .map((command) => String(command.lockId))))];
    const unlockRefs = unlockIds.map((id) => doc(profileDb, 'users', owner.uid, 'meta', `xp_event_daily_chest_unlock:${id}`));
    const result = await runTransaction(profileDb, async (transaction) => {
      const snapshots = await Promise.all([transaction.get(reference), ...receiptRefs.map((ref) => transaction.get(ref)), ...consumedRefs.map((ref) => transaction.get(ref)), ...unlockRefs.map((ref) => transaction.get(ref))]);
      if (!current()) throw Object.assign(new Error('Authenticated user changed during profile synchronization'), { code: 'auth/identity-changed' });
      const original = snapshots[0].exists() ? snapshots[0].data() : {};
      let profile = original;
      const outcomes = {};
      const consumed = new Set(consumedIds.filter((_id, index) => snapshots[1 + operations.length + index].exists()));
      const confirmed = new Set(unlockIds.filter((_id, index) => snapshots[1 + operations.length + consumedIds.length + index].exists()));
      const newConsumed = new Set();
      operations.forEach((operation, index) => {
        if (snapshots[index + 1].exists()) {
          outcomes[operation.id] = snapshots[index + 1].data().result || { applied: false, reason: '' };
          return;
        }
        const before = profile;
        let applied = false, reason = '';
        for (const command of operation.commands) {
          const next = applyProfileIntent(profile, command, { consumedExtraIds: consumed, confirmedXP: confirmed.has(String(command.lockId)) });
          if (next.reason) { reason = next.reason; profile = before; break; }
          profile = next.profile;
          applied ||= next.applied;
          if (next.effects.consumedExtraId) { consumed.add(next.effects.consumedExtraId); newConsumed.add(next.effects.consumedExtraId); }
        }
        outcomes[operation.id] = { applied: !reason && applied, reason };
        // This receipt is a synchronization acknowledgement, never an XP grant.
        transaction.set(receiptRefs[index], { type: 'profile-sync-v1', operationId: operation.id, result: outcomes[operation.id], createdAt: new Date() });
      });
      // A monotonic revision lets hydration discard an older transaction's
      // acknowledgement after a newer snapshot has already been observed.
      if (JSON.stringify(profile) !== JSON.stringify(original) || !snapshots[0].exists()) {
        profile = { ...profile, updatedAt: new Date(), _syncRevision: (Number(original._syncRevision) || 0) + 1 };
        transaction.set(reference, profile, { merge: true });
      }
      for (const id of newConsumed) transaction.set(doc(profileDb, 'users', owner.uid, 'meta', profileReceiptId(`extra-consumed:${id}`)), { type: 'profile-extra-consumed-v1', createdAt: new Date() });
      return { profile, outcomes };
    });
    if (!current()) return { saved: false, reason: 'auth/identity-changed' };
    if (options.verify === true) {
      const verification = await getDoc(reference);
      const receipts = await Promise.all(receiptRefs.map((ref) => getDoc(ref)));
      if (!current()) return { saved: false, reason: 'auth/identity-changed' };
      if (!verification.exists() || receipts.some((snap) => !snap.exists())) throw Object.assign(new Error('Profile synchronization could not be verified'), { code: 'profile/write-verification-failed' });
      result.profile = verification.data();
    }
    persistedData = result.profile;
    Object.assign(results, result.outcomes);
    for (const operation of operations) localStorage.removeItem(operation.key);
    const known = window.__lootlinguaProfileSnapshot;
    if (known?.uid !== owner.uid || Number(known.data?._syncRevision || 0) <= Number(persistedData?._syncRevision || 0)) {
      window.__lootlinguaProfileSnapshot = { uid: owner.uid, exists: true, data: persistedData, readFailed: false };
    }
  }
  return { saved: current(), profile: persistedData, results };
}
window.flushProfileIntents = function(options = {}) {
  const owner = options.profileOwner || captureProfileOwner();
  if (!isProfileOwnerCurrent(owner)) return Promise.resolve({ saved: false, reason: 'auth/identity-changed' });
  const work = async () => {
    try {
      compactPresentationIntents(owner);
      window.LootLinguaCloudBackoff?.assertAvailable();
      const outcome = await transactProfileOutbox(owner, options);
      if (outcome.saved && outcome.profile) applyCanonicalProfile(outcome.profile, owner);
      if (outcome.saved && outcome.profile) { window.__lootlinguaLastProfileSaveFailure = null; window.LootLinguaCloudBackoff?.recovered(); }
      return outcome;
    } catch (error) {
      if (isProfileOwnerCurrent(owner)) {
        reportProfileSaveFailure(error, `users/${owner.uid}/meta/profile`, 'transaction-sync', {});
        clearTimeout(_profileRetryTimer);
        const quotaDelay = window.LootLinguaCloudBackoff?.pause(error) || (error?.code === 'resource-exhausted' ? 60000 : 0);
        _profileRetryTimer = setTimeout(() => window.flushProfileIntents?.(), Math.max(5000, quotaDelay));
      }
      return { saved: false, reason: error?.code || 'profile/sync-failed' };
    }
  };
  return options.insideProfileTask ? work() : enqueueProfileTask(owner, work);
};
window.commitProfileIntent = async function(intent) {
  const owner = captureProfileOwner();
  const id = queueProfileCommands([JSON.parse(JSON.stringify(intent))], { project: false });
  if (!id || !isProfileOwnerCurrent(owner)) return { saved: false, applied: false, reason: 'auth/identity-changed' };
  const outcome = await window.flushProfileIntents({ profileOwner: owner, verify: true });
  if (!outcome.saved || !isProfileOwnerCurrent(owner)) return { ...outcome, applied: false, operationId: id };
  let result = outcome.results?.[id];
  if (!result) {
    const receipt = await getDoc(doc(profileDb, 'users', owner.uid, 'meta', profileReceiptId(id)));
    if (!isProfileOwnerCurrent(owner)) return { saved: false, applied: false, reason: 'auth/identity-changed' };
    result = receipt.exists() ? receipt.data().result : { applied: false, reason: 'profile/receipt-missing' };
  }
  return { ...outcome, ...result, operationId: id };
};
window.addEventListener?.('online', () => window.flushProfileIntents?.());
window.addEventListener?.('storage', (event) => {
  const uid = profileAuth.currentUser?.uid || '';
  if (event.key?.startsWith(profileOutboxPrefix(uid)) || event.key?.startsWith(botsOutboxPrefix(uid))) scheduleProfileFlush();
});

function captureProfileOwner(user = profileAuth.currentUser) {
  if (!user?.uid || profileAuth.currentUser?.uid !== user.uid) return null;
  return {
    uid: user.uid,
    generation: Number(window.__lootlinguaAuthGeneration) || 0,
    epoch: _profileAuthEpoch,
    loadSequence: _profileLoadSequence,
  };
}

function isProfileOwnerCurrent(owner) {
  return Boolean(owner && profileAuth.currentUser?.uid === owner.uid &&
    owner.generation === (Number(window.__lootlinguaAuthGeneration) || 0) &&
    owner.epoch === _profileAuthEpoch);
}

function isProfileOperationCurrent(owner, loadOwner = null) {
  return isProfileOwnerCurrent(owner) && owner.loadSequence === _profileLoadSequence &&
    (!loadOwner || _activeProfileLoad === loadOwner);
}

async function writeProfileData(data, options, owner) {
  // Preferences share the profile revision but never write progress fields.
  const fields = ['theme', 'oasisMode', 'themeIntroSeen'];
  if (!data || Object.keys(data).some(key => !fields.includes(key))) return false;
  const isCurrent = () => isProfileOperationCurrent(owner, options.profileLoadOwner);
  if (!isCurrent()) return false;
  const referencePath = `users/${owner.uid}/meta/profile`;
  const reference = doc(profileDb, 'users', owner.uid, 'meta', 'profile');
  const appearance = {};
  const pendingAppearance = readProfileOutbox(owner.uid).filter(operation => operation.commands.length === 1 && operation.commands[0].type === 'appearance' && Object.keys(operation.commands[0].patch || {}).every(key => fields.includes(key)));
  for (const operation of pendingAppearance) Object.assign(appearance, operation.commands[0].patch);
  for (const key of fields) if (Object.hasOwn(data, key)) appearance[key] = data[key];
  let patch;
  let knownSnapshot = window.__lootlinguaProfileSnapshot;
  try {
    window.LootLinguaCloudBackoff?.assertAvailable();
    let persistedData = await runTransaction(profileDb, async transaction => {
      const current = await transaction.get(reference);
      if (!isCurrent()) throw Object.assign(new Error('Authenticated user changed'), { code: 'auth/identity-changed' });
      const remote = current.exists() ? current.data() : {};
      knownSnapshot = { uid: owner.uid, exists: current.exists(), data: remote, readFailed: false };
      patch = { ...appearance, updatedAt: new Date(), _syncRevision: (Number(remote._syncRevision) || 0) + 1 };
      transaction.set(reference, patch, { merge: true });
      return { ...remote, ...patch };
    });
    if (!isCurrent()) return false;
    if (options.verify === true) {
      const verification = await getDoc(reference);
      if (!isCurrent()) return false;
      persistedData = verification.exists() ? verification.data() : null;
      if (!verification.exists() || !persistedProfileValueMatches(persistedData, appearance) ||
          Number(persistedData?._syncRevision || 0) < patch._syncRevision) {
        throw Object.assign(new Error('Profile write could not be verified'), { code: 'profile/write-verification-failed' });
      }
    }
    const newest = window.__lootlinguaProfileSnapshot;
    if (newest?.uid === owner.uid && Number(newest.data?._syncRevision || 0) > Number(persistedData?._syncRevision || 0)) {
      persistedData = newest.data;
    }
    window.__lootlinguaProfileSnapshot = { uid: owner.uid, exists: true, data: persistedData, readFailed: false };
    window.__lootlinguaLastProfileSaveFailure = null;
    for (const operation of pendingAppearance) localStorage.removeItem(operation.key);
    window.LootLinguaCloudBackoff?.recovered();
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    const operation = knownSnapshot?.uid === owner.uid ? (knownSnapshot.exists ? 'merge-update' : 'create-with-merge') : 'preflight-read';
    reportProfileSaveFailure(error, referencePath, operation, patch);
    if (['resource-exhausted', 'unavailable', 'deadline-exceeded'].includes(error?.code)) {
      window.LootLinguaCloudBackoff?.pause(error);
      queueProfileCommands([{ type: 'appearance', patch: appearance }], { project: false });
    }
    return false;
  }
}

async function performProfileSave(force = false, options = {}, owner = captureProfileOwner()) {
  if (!isProfileOwnerCurrent(owner)) return false;
  if (!force && window.__profileHydrating) return false;
  const base = window.getLootlinguaProfilePayload?.();
  if (!base) return false;
  if (options.guestMigration) {
    const migration = options.guestMigration;
    const snapshotId = migration.guestSnapshotId || localStorage.getItem('lootlingua:guest-migration-snapshot:v1:guest') || ('legacy-' + (migration.createdAt || 0));
    queueProfileCommands([{ type: 'guest-import', eventId: snapshotId, profile: migration.profile || {} }], { project: false });
  } else {
    // Financial/progress fields never originate from a cached full payload.
    // Their explicit intents were persisted at the mutation's call site.
    const baseline = _profileLocalBaselines.get(owner.uid);
    const commands = [];
    if (baseline) {
      const patch = {};
      for (const field of ['displayName', 'activeTitleId']) if (base[field] !== baseline[field]) patch[field] = base[field];
      if (Object.keys(patch).length) commands.push({ type: 'appearance', patch });
      if (JSON.stringify(base.quizExposureHistory || []) !== JSON.stringify(baseline.quizExposureHistory || [])) commands.push({ type: 'exposure', entries: base.quizExposureHistory || [] });
    }
    for (const field of ['maxStreak', 'runnerBestDistance', 'xpEconomyVersion']) {
      if (Number(base[field]) > Number(baseline?.[field] || 0)) commands.push({ type: 'max', field, value: base[field] });
    }
    if (commands.length) queueProfileCommands(commands, { project: false });
  }
  const outcome = await window.flushProfileIntents({ ...options, profileOwner: owner });
  return outcome.saved === true;
}

// Explicit appearance changes write only these fields, even when the local
// learning state is older than another device's progress.
const PROFILE_PREFERENCE_FIELDS = Object.freeze(['theme', 'oasisMode', 'themeIntroSeen']);
const PROFILE_THEME_IDS = Object.freeze(['lootlingua', 'golden', 'scroll', 'ocean', 'glass']);
window.saveProfilePreferencesToCloud = async function(patch, options = {}) {
  const owner = captureProfileOwner();
  if (!owner || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  if (Object.keys(patch).some((field) => !PROFILE_PREFERENCE_FIELDS.includes(field))) return false;
  const data = {};
  for (const field of PROFILE_PREFERENCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const value = patch[field];
    if (field === 'theme') {
      if (!PROFILE_THEME_IDS.includes(value)) return false;
      data.theme = value;
    }
    if (field === 'oasisMode') {
      if (!['light', 'dark'].includes(value)) return false;
      data.oasisMode = value;
    }
    if (field === 'themeIntroSeen') {
      if (!Array.isArray(value) || value.length > 12 ||
          !value.every((theme) => PROFILE_THEME_IDS.includes(theme))) return false;
      data.themeIntroSeen = [...new Set(value)];
    }
  }
  if (!Object.keys(data).length) return false;
  // Preserve the order of explicit appearance changes through delayed preflight
  // reads. A different auth session has its own queue and never waits for this one.
  const queueKey = JSON.stringify([owner.uid, owner.generation, owner.epoch, owner.loadSequence]);
  const previous = _profilePreferenceSaves.get(queueKey) || Promise.resolve();
  const writeOptions = { verify: options.verify === true };
  const saving = previous.then(() => enqueueProfileTask(owner, () => writeProfileData(data, writeOptions, owner)));
  _profilePreferenceSaves.set(queueKey, saving);
  try {
    return await saving;
  } finally {
    if (_profilePreferenceSaves.get(queueKey) === saving) _profilePreferenceSaves.delete(queueKey);
  }
};

// حفظ مؤجل — يتجنب استدعاءات كثيرة ويأخذ القيم من script.js
window.saveProfileToCloud = function() {
  if (window.__applyingCloudProfile || window.isInitialLoad || window.__suppressUnlockNotices) return;
  clearTimeout(_saveProfileDebounce);
  const owner = captureProfileOwner();
  if (!owner) return;
  _saveProfileDebounce = setTimeout(() => performProfileSave(false, {}, owner), 450);
};

window._saveProfileToCloudNow = function(options = {}) {
  clearTimeout(_saveProfileDebounce);
  return performProfileSave(true, options, options.profileOwner || captureProfileOwner());
};

// ── loadProfileFromCloud ────────────────────────────
window.loadProfileFromCloud = async function(user, options = {}) {
  const outcome = { loaded: false, pendingProfileCommitted: false };
  const owner = options.profileOwner || captureProfileOwner(user);
  if (!isProfileOperationCurrent(owner) || owner.uid !== user?.uid) return outcome;
  const loadOwner = { sequence: ++_profileLoadSequence };
  owner.loadSequence = _profileLoadSequence;
  _activeProfileLoad = loadOwner;
  const isCurrent = () => isProfileOperationCurrent(owner, loadOwner);
  const abandoned = () => ({ loaded: false, pendingProfileCommitted: false });
  let profileReadCompleted = false;
  let accepted = null;
  window.__applyingCloudProfile = true;
  try {
    for (let w = 0; w < 30 && typeof window.getLootlinguaProfilePayload !== "function"; w++) {
      await new Promise((r) => setTimeout(r, 40));
      if (!isCurrent()) return abandoned();
    }
    if (!isCurrent()) return abandoned();
    const snap = await getDoc(doc(profileDb, "users", user.uid, "meta", "profile"));
    if (!isCurrent()) return abandoned();
    profileReadCompleted = true;
    outcome.loaded = true;
    const cloudData = snap.exists() ? snap.data() : null;
    window.__lootlinguaProfileSnapshot = {
      uid: user.uid,
      exists: snap.exists(),
      data: cloudData,
      readFailed: false,
    };
    window.dispatchEvent(new CustomEvent('lootlingua:profile-snapshot', {
      detail: window.__lootlinguaProfileSnapshot,
    }));
    if (!isCurrent()) return abandoned();
    if (typeof window.resetLootlinguaProfileState === "function") {
      // Keep the early cached appearance until a confirmed cloud theme replaces
      // it below. Profiles without a theme retain the established default reset.
      window.resetLootlinguaProfileState({
        clearDisplayName: true,
        resetTheme: !cloudData?.theme,
      });
    }
    if (!isCurrent()) return abandoned();
    if (user.displayName && typeof window.setLootlinguaDisplayName === "function") {
      window.setLootlinguaDisplayName(user.displayName);
    }
    if (!isCurrent()) return abandoned();
    if (cloudData) applyCanonicalProfile(cloudData, owner);
    else {
      window.LootLinguaGateRunner?.acceptProfile?.({}, owner.uid);
      window.LootLinguaBots?.acceptProfile?.({}, owner.uid);
    }
    if (!isCurrent()) return abandoned();
    const inMemoryMigration = window.__acceptedGuestProfileMigration;
    const persistedMigration = readPendingGuestProfileMigration(user);
    accepted = inMemoryMigration?.uid === user.uid
      ? inMemoryMigration
      : persistedMigration;
    const profileAlreadyCommitted = Number(accepted?.profileCommittedAt) > 0;
    const guestProfiles = accepted?.uid === user.uid && !profileAlreadyCommitted
      ? (
        Array.isArray(accepted.profiles) && accepted.profiles.length
          ? accepted.profiles
          : [accepted.profile]
      ).filter((profile) => profile && typeof profile === 'object' && !Array.isArray(profile))
      : [];
    let explicitThemeSession = null;
    try {
      explicitThemeSession = JSON.parse(
        sessionStorage.getItem('lootlingua:guest-theme-explicit:v1') || 'null'
      );
    } catch (_) {}
    const explicitThemeId = ['lootlingua', 'ocean'].includes(explicitThemeSession?.themeId)
      ? explicitThemeSession.themeId
      : '';
    const explicitOasisMode = ['light', 'dark'].includes(explicitThemeSession?.oasisMode)
      ? explicitThemeSession.oasisMode
      : 'light';
    const hasCurrentExplicitTheme = Boolean(
      explicitThemeId &&
      explicitThemeSession?.targetUid === user.uid &&
      Number(explicitThemeSession?.entryUpdatedAt) > 0 &&
      Date.now() - Number(explicitThemeSession?.at || 0) < 24 * 60 * 60 * 1000
    );
    const mergeableGuestProfiles = typeof window.hasMeaningfulGuestLoot === "function"
      ? guestProfiles.filter((profile) => window.hasMeaningfulGuestLoot({ words: [], profile }))
      : [];
    const shouldMergeGuestProfile = mergeableGuestProfiles.length > 0;
    const shouldMergeGuestState = Boolean(
      accepted || shouldMergeGuestProfile || hasCurrentExplicitTheme
    );
    if (hasCurrentExplicitTheme) {
      queueProfileCommands([{ type: 'appearance', patch: { theme: explicitThemeId, oasisMode: explicitOasisMode } }], { project: false });
    }
    if (!isCurrent()) return abandoned();
    // Do not create/backfill a profile merely because it was read. A write is
    // warranted only after an explicit guest-data merge or a later user action.
    if (profileAlreadyCommitted) {
      // A verified marker from an older client predates server receipts. Seal
      // the same snapshot ID without importing its already credited balances.
      const snapshotId = accepted.guestSnapshotId || localStorage.getItem('lootlingua:guest-migration-snapshot:v1:guest') || ('legacy-' + (accepted.createdAt || 0));
      queueProfileCommands([{ type: 'acknowledge' }], { id: profileOperationId({ type: 'guest-import', eventId: snapshotId }), project: false });
      const sealed = await window.flushProfileIntents({ profileOwner: owner, profileLoadOwner: loadOwner, verify: true });
      if (!isCurrent()) return abandoned();
      outcome.pendingProfileCommitted = sealed.saved === true;
    } else if (shouldMergeGuestState && window._saveProfileToCloudNow) {
      const saved = await window._saveProfileToCloudNow({
        verify: Boolean(persistedMigration || options.requirePendingProfileCommit),
        profileOwner: owner,
        profileLoadOwner: loadOwner,
        guestMigration: accepted || null,
      });
      if (!isCurrent()) return abandoned();
      outcome.pendingProfileCommitted = completePendingGuestProfileMigration(
        user,
        saved,
        hasCurrentExplicitTheme
      );
      if (options.requirePendingProfileCommit && !outcome.pendingProfileCommitted) {
        if (accepted?.profile && typeof window.resetLootlinguaProfileState === 'function') {
          window.resetLootlinguaProfileState({ clearDisplayName: true, resetTheme: true });
          if (isCurrent()) window.mergeLootlinguaProfileFromCloud?.(accepted.profile);
        }
        return outcome;
      }
    }
    if (!isCurrent()) return abandoned();
    _profileLocalBaselines.set(owner.uid, window.getLootlinguaProfilePayload?.() || cloudData || {});
    _profileSnapshotUnsubscribe?.();
    _profileSnapshotUnsubscribe = onSnapshot(doc(profileDb, 'users', owner.uid, 'meta', 'profile'), (snapshot) => {
      if (!isCurrent() || snapshot.metadata?.hasPendingWrites || snapshot.metadata?.fromCache || !snapshot.exists()) return;
      const data = snapshot.data();
      const known = window.__lootlinguaProfileSnapshot;
      if (known?.uid === owner.uid && Number(known.data?._syncRevision || 0) > Number(data?._syncRevision || 0)) return;
      window.__lootlinguaProfileSnapshot = { uid: owner.uid, exists: true, data, readFailed: false };
      applyCanonicalProfile(data, owner);
    }, (error) => {
      if (isCurrent()) console.error('loadProfile: live synchronization unavailable', error);
    });
    if (readProfileOutbox(owner.uid).length) scheduleProfileFlush();
  } catch (e) {
    if (!isCurrent()) return abandoned();
    if (!profileReadCompleted) {
      window.__lootlinguaProfileSnapshot = {
        uid: user?.uid || '',
        exists: false,
        data: null,
        readFailed: true,
      };
      window.dispatchEvent(new CustomEvent('lootlingua:profile-snapshot', {
        detail: window.__lootlinguaProfileSnapshot,
      }));
    }
    if (accepted?.profile && options.requirePendingProfileCommit &&
        typeof window.resetLootlinguaProfileState === 'function') {
      window.resetLootlinguaProfileState({ clearDisplayName: true, resetTheme: true });
      if (isCurrent()) window.mergeLootlinguaProfileFromCloud?.(accepted.profile);
    }
    console.error("loadProfile:", { code: e?.code, message: e?.message }, e);
  }
  finally {
    if (isCurrent()) {
      window.__applyingCloudProfile = false;
      if (typeof window.markInitialFeatureLoadPartDone === "function") window.markInitialFeatureLoadPartDone("profile");
    }
  }
  return outcome;
};

window.commitPendingGuestProfileMigration = async function(user) {
  const owner = captureProfileOwner(user);
  if (!isProfileOwnerCurrent(owner)) return false;
  const pending = readPendingGuestProfileMigration(user);
  if (!pending) return false;
  if (Number(pending.profileCommittedAt) > 0) return true;
  const outcome = await window.loadProfileFromCloud(user, { requirePendingProfileCommit: true, profileOwner: owner });
  return isProfileOperationCurrent(owner) && outcome.pendingProfileCommitted === true;
};

// ── شوف إذا المستخدم مسجل دخول وحمّل الـ profile ──
onAuthStateChanged(profileAuth, (user) => {
  _profileAuthEpoch++;
  clearTimeout(_saveProfileDebounce);
  _saveProfileDebounce = null;
  _activeProfileLoad = null;
  _profileSnapshotUnsubscribe?.();
  _profileSnapshotUnsubscribe = null;
  clearTimeout(_profileRetryTimer);
  _profileRetryTimer = null;
  window.__applyingCloudProfile = false;
  window._profileLoaded = false;
  const authOwner = captureProfileOwner(user);
  if (user && window.loadProfileFromCloud) {
    Promise.resolve().then(() => {
      if (!isProfileOwnerCurrent(authOwner)) return;
      return typeof window.prepareGuestMigrationForUser === "function"
        ? window.prepareGuestMigrationForUser(user)
        : undefined;
    }).then(async () => {
      if (!isProfileOwnerCurrent(authOwner)) return;
      // Guest migration may have loaded and committed a profile while this
      // decision was pending. Begin a fresh load within the same auth session.
      const owner = captureProfileOwner(user);
      const loading = window.loadProfileFromCloud(user, { profileOwner: owner });
      const loadOwner = _activeProfileLoad;
      const outcome = await loading;
      if (!isProfileOperationCurrent(owner, loadOwner) || !outcome.loaded) return;
      window._profileLoaded = true;
      if (window.checkAndUpdateStreak) window.checkAndUpdateStreak();
    }).catch((error) => {
      if (isProfileOwnerCurrent(authOwner)) console.error('loadProfile: guest preparation failed', error);
    });
  }
});
