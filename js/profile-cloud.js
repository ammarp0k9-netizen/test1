
// نستورد setDoc و getDoc بشكل منفصل عشان ما يكسر الـ module الأول
import { getApps }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// استخدم التطبيق الموجود فقط بدون إعادة تعريف إذا كان معرف مسبقًا
let profileApp  = getApps()[0];
let profileDb   = getFirestore(profileApp);
let profileAuth = getAuth(profileApp);

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
  } catch (e) { console.warn("saveProfile:", e.message); }
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
    if (typeof window.resetLootlinguaProfileState === "function") {
      window.resetLootlinguaProfileState({ clearDisplayName: true, resetTheme: true });
    }
    if (user.displayName && typeof window.setLootlinguaDisplayName === "function") {
      window.setLootlinguaDisplayName(user.displayName);
    }
    if (cloudData && typeof window.mergeLootlinguaProfileFromCloud === "function") {
      window.mergeLootlinguaProfileFromCloud(cloudData);
    }
    const accepted = window.__acceptedGuestProfileMigration;
    const guestProfile = accepted?.uid === user.uid ? accepted.profile : null;
    const shouldMergeGuestProfile = guestProfile &&
      typeof window.hasMeaningfulGuestLoot === "function" &&
      window.hasMeaningfulGuestLoot({ words: [], profile: guestProfile });
    if (shouldMergeGuestProfile && typeof window.mergeLootlinguaProfileFromCloud === "function") {
      window.mergeLootlinguaProfileFromCloud(guestProfile);
    }
    window.__acceptedGuestProfileMigration = null;
    if (window._saveProfileToCloudNow) await window._saveProfileToCloudNow();
  } catch (e) { console.warn("loadProfile:", e.message); }
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
