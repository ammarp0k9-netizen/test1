
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
  localStorage.removeItem(pendingGuestProfileMigrationKey(user));
  window.__acceptedGuestProfileMigration = null;
  if (hasExplicitTheme) {
    sessionStorage.removeItem('lootlingua:guest-theme-explicit:v1');
  }
  return true;
}

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
async function performProfileSave(force = false, options = {}) {
  const user = profileAuth.currentUser;
  if (!user) return false;
  if (!force && (window.__applyingCloudProfile || window.isInitialLoad || window.__suppressUnlockNotices)) return false;
  const get = window.getLootlinguaProfilePayload;
  if (typeof get !== "function") return false;
  const base = get();
  const data = { ...base, updatedAt: new Date() };
  const referencePath = `users/${user.uid}/meta/profile`;
  const reference = doc(profileDb, 'users', user.uid, 'meta', 'profile');
  let knownSnapshot = window.__lootlinguaProfileSnapshot;
  try {
    if (knownSnapshot?.uid !== user.uid || knownSnapshot.readFailed) {
      const preflight = await getDoc(reference);
      knownSnapshot = {
        uid: user.uid,
        exists: preflight.exists(),
        data: preflight.exists() ? preflight.data() : null,
        readFailed: false,
      };
      window.__lootlinguaProfileSnapshot = knownSnapshot;
    }
    if (profileAuth.currentUser?.uid !== user.uid) {
      const identityError = new Error('Authenticated user changed before profile write');
      identityError.code = 'auth/identity-changed';
      throw identityError;
    }
    await setDoc(reference, data, { merge: true });
    let persistedData = knownSnapshot.data ? { ...knownSnapshot.data, ...data } : data;
    if (options.verify === true) {
      const verification = await getDoc(reference);
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
    const operation = knownSnapshot?.uid === user.uid
      ? (knownSnapshot.exists ? 'merge-update' : 'create-with-merge')
      : 'preflight-read';
    reportProfileSaveFailure(e, referencePath, operation, data);
    return false;
  }
}

// حفظ مؤجل — يتجنب استدعاءات كثيرة ويأخذ القيم من script.js
window.saveProfileToCloud = function() {
  if (window.__applyingCloudProfile || window.isInitialLoad || window.__suppressUnlockNotices) return;
  clearTimeout(_saveProfileDebounce);
  _saveProfileDebounce = setTimeout(performProfileSave, 450);
};

window._saveProfileToCloudNow = function(options = {}) {
  clearTimeout(_saveProfileDebounce);
  return performProfileSave(true, options);
};

// ── loadProfileFromCloud ────────────────────────────
window.loadProfileFromCloud = async function(user, options = {}) {
  const outcome = { loaded: false, pendingProfileCommitted: false };
  let profileReadCompleted = false;
  let accepted = null;
  window.__applyingCloudProfile = true;
  try {
    for (let w = 0; w < 30 && typeof window.getLootlinguaProfilePayload !== "function"; w++)
      await new Promise((r) => setTimeout(r, 40));
    const snap = await getDoc(doc(profileDb, "users", user.uid, "meta", "profile"));
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
    if (typeof window.resetLootlinguaProfileState === "function") {
      window.resetLootlinguaProfileState({ clearDisplayName: true, resetTheme: true });
    }
    if (user.displayName && typeof window.setLootlinguaDisplayName === "function") {
      window.setLootlinguaDisplayName(user.displayName);
    }
    if (cloudData && typeof window.mergeLootlinguaProfileFromCloud === "function") {
      window.mergeLootlinguaProfileFromCloud(cloudData);
    }
    const inMemoryMigration = window.__acceptedGuestProfileMigration;
    const persistedMigration = readPendingGuestProfileMigration(user);
    accepted = inMemoryMigration?.uid === user.uid
      ? inMemoryMigration
      : persistedMigration;
    const guestProfiles = accepted?.uid === user.uid
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
      mergeableGuestProfiles.forEach((guestProfile) => {
        const guestProfileForMerge = { ...guestProfile };
        // A stale guest appearance must never override an account preference.
        // Only the current explicit Entry session below may do so.
        delete guestProfileForMerge.theme;
        delete guestProfileForMerge.oasisMode;
        window.mergeLootlinguaProfileFromCloud(guestProfileForMerge);
      });
      if (hasCurrentExplicitTheme) {
        window.mergeLootlinguaProfileFromCloud({
          theme: explicitThemeId,
          oasisMode: explicitOasisMode,
        });
      }
    }
    // Do not create/backfill a profile merely because it was read. A write is
    // warranted only after an explicit guest-data merge or a later user action.
    if (shouldMergeGuestState && window._saveProfileToCloudNow) {
      const saved = await window._saveProfileToCloudNow({
        verify: Boolean(persistedMigration || options.requirePendingProfileCommit),
      });
      outcome.pendingProfileCommitted = completePendingGuestProfileMigration(
        user,
        saved,
        hasCurrentExplicitTheme
      );
      if (options.requirePendingProfileCommit && !outcome.pendingProfileCommitted) {
        if (accepted?.profile && typeof window.resetLootlinguaProfileState === 'function') {
          window.resetLootlinguaProfileState({ clearDisplayName: true, resetTheme: true });
          window.mergeLootlinguaProfileFromCloud?.(accepted.profile);
        }
        return outcome;
      }
    }
  } catch (e) {
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
      window.mergeLootlinguaProfileFromCloud?.(accepted.profile);
    }
    console.error("loadProfile:", { code: e?.code, message: e?.message }, e);
  }
  finally {
    window.__applyingCloudProfile = false;
    if (typeof window.markInitialFeatureLoadPartDone === "function") window.markInitialFeatureLoadPartDone("profile");
  }
  return outcome;
};

window.commitPendingGuestProfileMigration = async function(user) {
  if (!readPendingGuestProfileMigration(user)) return false;
  const outcome = await window.loadProfileFromCloud(user, { requirePendingProfileCommit: true });
  return outcome.pendingProfileCommitted === true;
};

// ── شوف إذا المستخدم مسجل دخول وحمّل الـ profile ──
onAuthStateChanged(profileAuth, (user) => {
  if (user && window.loadProfileFromCloud) {
    const waitForGuestDecision = typeof window.prepareGuestMigrationForUser === "function"
      ? window.prepareGuestMigrationForUser(user)
      : Promise.resolve();
    waitForGuestDecision.then(() => window.loadProfileFromCloud(user)).then(() => {
      window._profileLoaded = true;
      if (window.checkAndUpdateStreak) window.checkAndUpdateStreak();
    });
  }
});
