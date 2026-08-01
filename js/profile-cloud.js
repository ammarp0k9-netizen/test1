
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

let _saveProfileDebounce = null;
async function performProfileSave(force = false) {
  const user = profileAuth.currentUser;
  if (!user) return;
  if (!force && (window.__applyingCloudProfile || window.isInitialLoad || window.__suppressUnlockNotices)) return;
  const get = window.getLootlinguaProfilePayload;
  if (typeof get !== "function") return;
  const base = get();
  const data = { ...base, updatedAt: new Date() };
  try {
    await setDoc(doc(profileDb, "users", user.uid, "meta", "profile"), data, { merge: true });
    return true;
  } catch (e) {
    console.warn("saveProfile:", e.message);
    return false;
  }
}

// حفظ مؤجل — يتجنب استدعاءات كثيرة ويأخذ القيم من script.js
window.saveProfileToCloud = function() {
  if (window.__applyingCloudProfile || window.isInitialLoad || window.__suppressUnlockNotices) return;
  clearTimeout(_saveProfileDebounce);
  _saveProfileDebounce = setTimeout(performProfileSave, 450);
};

window._saveProfileToCloudNow = function() {
  clearTimeout(_saveProfileDebounce);
  return performProfileSave(true);
};

// ── loadProfileFromCloud ────────────────────────────
window.loadProfileFromCloud = async function(user) {
  window.__applyingCloudProfile = true;
  try {
    for (let w = 0; w < 30 && typeof window.getLootlinguaProfilePayload !== "function"; w++)
      await new Promise((r) => setTimeout(r, 40));
    const snap = await getDoc(doc(profileDb, "users", user.uid, "meta", "profile"));
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
    const accepted = inMemoryMigration?.uid === user.uid
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
      const saved = await window._saveProfileToCloudNow();
      completePendingGuestProfileMigration(user, saved, hasCurrentExplicitTheme);
    }
  } catch (e) {
    window.__lootlinguaProfileSnapshot = {
      uid: user?.uid || '',
      exists: false,
      data: null,
      readFailed: true,
    };
    window.dispatchEvent(new CustomEvent('lootlingua:profile-snapshot', {
      detail: window.__lootlinguaProfileSnapshot,
    }));
    console.warn("loadProfile:", e.message);
  }
  finally {
    window.__applyingCloudProfile = false;
    if (typeof window.markInitialFeatureLoadPartDone === "function") window.markInitialFeatureLoadPartDone("profile");
  }
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
