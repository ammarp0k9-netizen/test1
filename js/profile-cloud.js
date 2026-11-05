
// نستورد setDoc و getDoc بشكل منفصل عشان ما يكسر الـ module الأول
import { getApps }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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
    writeMethod: 'setDoc-merge',
    code: String(error?.code || 'profile/save-failed'),
    message: String(error?.message || error || 'Unknown profile save failure'),
    name: String(error?.name || 'Error'),
    payload: diagnosticProfileValue(payload),
  };
  window.__lootlinguaLastProfileSaveFailure = diagnostic;
  // Preserve the original Firebase error object, including its code and stack.
  console.error('saveProfile:', diagnostic, error);
  return diagnostic;
}

let _saveProfileDebounce = null;
let _profileAuthEpoch = 0;
let _profileLoadSequence = 0;
let _activeProfileLoad = null;
const _profilePreferenceSaves = new Map();

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
  const user = { uid: owner?.uid };
  const isCurrent = () => isProfileOperationCurrent(owner, options.profileLoadOwner);
  if (!isCurrent()) return false;
  const referencePath = `users/${user.uid}/meta/profile`;
  const reference = doc(profileDb, 'users', user.uid, 'meta', 'profile');
  let knownSnapshot = window.__lootlinguaProfileSnapshot;
  try {
    if (knownSnapshot?.uid !== user.uid || knownSnapshot.readFailed) {
      const preflight = await getDoc(reference);
      if (!isCurrent()) return false;
      knownSnapshot = {
        uid: user.uid,
        exists: preflight.exists(),
        data: preflight.exists() ? preflight.data() : null,
        readFailed: false,
      };
      window.__lootlinguaProfileSnapshot = knownSnapshot;
    }
    if (!isCurrent()) return false;
    await setDoc(reference, data, { merge: true });
    // A submitted write stays bound to its original account. Its continuation
    // must not publish that account's snapshot into a newer session or load.
    if (!isCurrent()) return false;
    let persistedData = knownSnapshot.data ? { ...knownSnapshot.data, ...data } : data;
    if (options.verify === true) {
      const verification = await getDoc(reference);
      if (!isCurrent()) return false;
      persistedData = verification.exists() ? verification.data() : null;
      if (!verification.exists() || !persistedProfileValueMatches(persistedData, data)) {
        const verificationError = new Error('Profile write could not be verified');
        verificationError.code = 'profile/write-verification-failed';
        throw verificationError;
      }
    }
    window.__lootlinguaProfileSnapshot = {
      uid: user.uid,
      exists: true,
      data: persistedData,
      readFailed: false,
    };
    window.__lootlinguaLastProfileSaveFailure = null;
    return true;
  } catch (e) {
    if (!isCurrent()) return false;
    const operation = knownSnapshot?.uid === user.uid
      ? (knownSnapshot.exists ? 'merge-update' : 'create-with-merge')
      : 'preflight-read';
    reportProfileSaveFailure(e, referencePath, operation, data);
    return false;
  }
}

async function performProfileSave(force = false, options = {}, owner = captureProfileOwner()) {
  if (!isProfileOperationCurrent(owner, options.profileLoadOwner)) return false;
  if (!force && (window.__applyingCloudProfile || window.isInitialLoad || window.__suppressUnlockNotices)) return false;
  const get = window.getLootlinguaProfilePayload;
  if (typeof get !== "function") return false;
  const base = get();
  const data = { ...base, updatedAt: new Date() };
  return writeProfileData(data, options, owner);
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
  data.updatedAt = new Date();
  // Preserve the order of explicit appearance changes through delayed preflight
  // reads. A different auth session has its own queue and never waits for this one.
  const queueKey = JSON.stringify([owner.uid, owner.generation, owner.epoch, owner.loadSequence]);
  const previous = _profilePreferenceSaves.get(queueKey) || Promise.resolve();
  const writeOptions = { verify: options.verify === true };
  const saving = previous.then(() => writeProfileData(data, writeOptions, owner));
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
    if (cloudData && typeof window.mergeLootlinguaProfileFromCloud === "function") {
      window.mergeLootlinguaProfileFromCloud(cloudData);
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
    if (shouldMergeGuestState && typeof window.mergeLootlinguaProfileFromCloud === "function") {
      for (const guestProfile of mergeableGuestProfiles) {
        if (!isCurrent()) return abandoned();
        const guestProfileForMerge = { ...guestProfile };
        // A stale guest appearance must never override an account preference.
        // Only the current explicit Entry session below may do so.
        delete guestProfileForMerge.theme;
        delete guestProfileForMerge.oasisMode;
        window.mergeLootlinguaProfileFromCloud(guestProfileForMerge, { guestMigration: true });
      }
      if (!isCurrent()) return abandoned();
      if (hasCurrentExplicitTheme) {
        window.mergeLootlinguaProfileFromCloud({
          theme: explicitThemeId,
          oasisMode: explicitOasisMode,
        });
      }
    }
    if (!isCurrent()) return abandoned();
    // Do not create/backfill a profile merely because it was read. A write is
    // warranted only after an explicit guest-data merge or a later user action.
    if (profileAlreadyCommitted) {
      outcome.pendingProfileCommitted = true;
    } else if (shouldMergeGuestState && window._saveProfileToCloudNow) {
      const saved = await window._saveProfileToCloudNow({
        verify: Boolean(persistedMigration || options.requirePendingProfileCommit),
        profileOwner: owner,
        profileLoadOwner: loadOwner,
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
