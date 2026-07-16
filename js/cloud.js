
  import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import {
    getAuth, signInWithPopup, signInWithRedirect, signOut,
    GoogleAuthProvider, onAuthStateChanged, getRedirectResult
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  import {
    getFirestore, collection, addDoc, query,
    orderBy, deleteDoc, doc, updateDoc, onSnapshot, serverTimestamp,
    getDoc, setDoc, getDocs, runTransaction
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

  const firebaseConfig = {
    apiKey:            "AIzaSyDQB5N4wxJw69-tb8suI2T2SfEfCpwFA2c",
    authDomain:        "quizapp-ede17.firebaseapp.com",
    projectId:         "quizapp-ede17",
    storageBucket:     "quizapp-ede17.firebasestorage.app",
    messagingSenderId: "473471031803",
    appId:             "1:473471031803:web:1b803237aeb0444040535e",
    measurementId:     "G-C06S6C7JYT"
  };

  const app  = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db   = getFirestore(app);
  window.db = db;
  window.auth = auth;
  let wordsUnsubscribe = null;
  let customWorldsUnsubscribe = null;
  let customWorldWordsUnsubscribe = null;
  let wordMasteryUnsubscribe = null;
  let suppressNextGuestLoad = false;
  const LOGIN_REDIRECT_PENDING_KEY = 'lootlinguaLoginRedirectPending';

  function isIOSDevice() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPad|iPhone|iPod/i.test(ua) ||
      (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function setLoginLoading(isLoading, message = 'جاري توجيهك لتسجيل الدخول...') {
    const btn = document.getElementById('loginBtn');
    if (!btn) return;
    if (!btn.dataset.defaultHtml) btn.dataset.defaultHtml = btn.innerHTML;
    btn.disabled = !!isLoading;
    btn.classList.toggle('loading', !!isLoading);
    if (isLoading) {
      btn.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${message}`;
    } else {
      btn.innerHTML = btn.dataset.defaultHtml;
    }
  }

  async function handleLoginRedirectResult() {
    if (sessionStorage.getItem(LOGIN_REDIRECT_PENDING_KEY)) {
      setLoginLoading(true, 'جاري إكمال تسجيل الدخول...');
    }
    try {
      const result = await getRedirectResult(auth);
      if (result?.user && typeof showToast === 'function') {
        showToast('تم تسجيل الدخول بنجاح', 'success', 3200);
      }
    } catch (e) {
      console.error(e.code || 'auth/redirect-error', e.message);
      if (typeof showToast === 'function') {
        showToast('صار خطأ أثناء تسجيل الدخول. جرّب مرة ثانية.', 'danger', 4200);
      }
    } finally {
      sessionStorage.removeItem(LOGIN_REDIRECT_PENDING_KEY);
      setLoginLoading(false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleLoginRedirectResult, { once: true });
  } else {
    handleLoginRedirectResult();
  }

  onAuthStateChanged(auth, (user) => {
    window.dispatchEvent(new CustomEvent('lootlingua:auth-state', { detail: { user: user || null } }));
    // Notify Smart Loading Overlay that auth state is resolved
    if (window.SmartLoadingOverlay && window.SmartLoadingOverlay.onAuthResolved) {
      window.SmartLoadingOverlay.onAuthResolved(user);
    }

    if (wordsUnsubscribe) {
      wordsUnsubscribe();
      wordsUnsubscribe = null;
    }
    if (customWorldsUnsubscribe) {
      customWorldsUnsubscribe();
      customWorldsUnsubscribe = null;
    }
    if (customWorldWordsUnsubscribe) {
      customWorldWordsUnsubscribe();
      customWorldWordsUnsubscribe = null;
    }
    if (wordMasteryUnsubscribe) {
      wordMasteryUnsubscribe();
      wordMasteryUnsubscribe = null;
    }
    document.getElementById('logoutBtn').style.display = user ? 'block' : 'none';
    document.getElementById('loginBtn').style.display  = user ? 'none'  : 'block';
    if (user) setLoginLoading(false);
    if (typeof window.refreshGuestSearchLocks === 'function') {
      window.refreshGuestSearchLocks();
    }
    if (user && user.displayName && window.setLootlinguaDisplayName) {
      window.setLootlinguaDisplayName(user.displayName);
    }
    if (user) {
      if (typeof window.beginInitialFeatureLoad === "function") {
        window.beginInitialFeatureLoad(["words", "profile"]);
      } else {
        window.__suppressUnlockNotices = true;
      }
      suppressNextGuestLoad = false;
      if (typeof window.prepareGuestMigrationForUser === 'function') {
        window.prepareGuestMigrationForUser(user);
      }
      if (typeof window.clearDictionaryState === 'function') window.clearDictionaryState();
      else window.words = [];
      if (typeof window.render === 'function') window.render();
      loadWordsFromCloud(user);
      loadCustomWorldsFromCloud(user);
      loadGlobalWordMasteryFromCloud(user);
      setTimeout(() => {
        if (typeof window.retryPendingCustomWorlds === 'function') {
          window.retryPendingCustomWorlds('auth-state');
        }
        if (typeof window.retryPendingXPEvents === 'function') {
          window.retryPendingXPEvents();
        }
      }, 0);
    } else {
      if (suppressNextGuestLoad) {
        suppressNextGuestLoad = false;
        if (typeof window.clearDictionaryState === 'function') window.clearDictionaryState();
        else {
          window.words = [];
          if (typeof render === 'function') render();
        }
        if (typeof window.finishInitialFeatureLoad === "function") window.finishInitialFeatureLoad();
      } else if (typeof window.loadGuestDictionaryState === 'function') {
        window.loadGuestDictionaryState();
        if (typeof window.finishInitialFeatureLoad === "function") window.finishInitialFeatureLoad();
      } else if (typeof window.clearDictionaryState === 'function') {
        window.clearDictionaryState();
        if (typeof window.finishInitialFeatureLoad === "function") window.finishInitialFeatureLoad();
      } else {
        window.words = [];
        if (typeof render === 'function') render();
        if (typeof window.finishInitialFeatureLoad === "function") window.finishInitialFeatureLoad();
      }
    }
  });

  window.login = async function() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    setLoginLoading(true, isIOSDevice() ? 'جاري توجيهك لتسجيل الدخول...' : 'جاري فتح تسجيل الدخول...');
    try {
      if (isIOSDevice()) {
        sessionStorage.setItem(LOGIN_REDIRECT_PENDING_KEY, '1');
        await signInWithRedirect(auth, provider);
        return;
      }
      await signInWithPopup(auth, provider);
      setLoginLoading(false);
    } catch (e) {
      console.error(e.code, e.message);
      sessionStorage.removeItem(LOGIN_REDIRECT_PENDING_KEY);
      setLoginLoading(false);
      if (e.code === 'auth/popup-blocked') alert("الـ popup اتعطل من المتصفح. جرب تسمح لـ popups للموقع.");
    }
  };

  window.confirmLogout = async function() {
    suppressNextGuestLoad = true;
    if (typeof window._saveProfileToCloudNow === 'function') {
      try { await window._saveProfileToCloudNow(); } catch (e) { console.warn('save-before-logout:', e); }
    }
    if (typeof window.clearDictionaryState === 'function') window.clearDictionaryState();
    signOut(auth).then(() => {
      if (typeof window.clearDictionaryState === 'function') window.clearDictionaryState();
      if (typeof window.purgeStaleGuestLocalData === 'function') window.purgeStaleGuestLocalData();
      if (typeof window.resetLootlinguaProfileState === 'function') {
        window.resetLootlinguaProfileState({ clearDisplayName: true, resetTheme: true });
      }
      hideModal('logoutModal');
    });
  };

  function loadWordsFromCloud(user) {
    const listenerUid = user.uid;
    const q = query(collection(db, "users", user.uid, "words"), orderBy("createdAt", "desc"));
    wordsUnsubscribe = onSnapshot(q, (snapshot) => {
      if (auth.currentUser?.uid !== listenerUid) return;
      if (window.__suppressCloudWordsSnapshot) return;
      const cloudWords = snapshot.docs.map(d => ({
        id:          d.id,
        word:        d.data().text   || d.data().word || '',
        meaning:     d.data().meaning     || '',
        example:     d.data().example     || '',
        category:    d.data().category    || 'عام',
        starred:     d.data().starred     || false,
        forgetCount: d.data().forgetCount || 0,
        xpValue:     d.data().xpValue ?? 0,
        mastery_status: d.data().mastery_status || '',
        mastery_streak: Number(d.data().mastery_streak) || 0,
        last_recalled_at: d.data().last_recalled_at || null,
        first_recalled_at: d.data().first_recalled_at || null,
        last_recall_day: d.data().last_recall_day || '',
        last_recall_session_id: d.data().last_recall_session_id || '',
        last_quizzed_at: d.data().last_quizzed_at || null,
        quiz_seen_count: Number(d.data().quiz_seen_count) || 0,
        mastered_once: Boolean(d.data().mastered_once),
        firstMasteredAt: d.data().firstMasteredAt || null,
        hasEarnedMasteryXP: Boolean(d.data().hasEarnedMasteryXP),
        earnedTransitions: Array.isArray(d.data().earnedTransitions) ? d.data().earnedTransitions : [],
        remasteryAwardCount: Number(d.data().remasteryAwardCount) || 0,
        xpEconomyVersion: Number(d.data().xpEconomyVersion) || 0,
        order:       Number.isFinite(d.data().order) ? d.data().order : null,
        createdAt:   d.data().createdAt?.toDate ? d.data().createdAt.toDate().toISOString() : (d.data().createdAt || null)
      }));

      if (typeof window.applyCloudWordsFromSnapshot === "function") {
        window.applyCloudWordsFromSnapshot(cloudWords);
      } else {
        window.words = cloudWords;
        if (typeof window.writeWordsToStorage === "function") {
          window.writeWordsToStorage(cloudWords, "normal", listenerUid);
        }
        if (typeof window.saveAndRender === "function") window.saveAndRender();
      }
      
      // Notify Smart Loading Overlay that user data is loaded
      if (window.SmartLoadingOverlay && window.SmartLoadingOverlay.onUserDataLoaded) {
        window.SmartLoadingOverlay.onUserDataLoaded();
      }
      
      if (typeof window.markInitialFeatureLoadPartDone === "function") window.markInitialFeatureLoadPartDone("words");
      else if (typeof window.finishInitialFeatureLoad === "function") window.finishInitialFeatureLoad();
    }, (error) => {
      console.warn("loadWordsFromCloud:", error.code || error.message, error);
      if (error.code === "permission-denied" && typeof showToast === "function") {
        showToast("قواعد Firebase لا تسمح بقراءة كلماتك حالياً. راجع Firestore Rules.");
      }
      // Even on error, dismiss the loading overlay
      if (window.SmartLoadingOverlay && window.SmartLoadingOverlay.onUserDataLoaded) {
        window.SmartLoadingOverlay.onUserDataLoaded();
      }
      if (typeof window.markInitialFeatureLoadPartDone === "function") window.markInitialFeatureLoadPartDone("words");
    });
  }

  function mapWordDoc(d) {
    return {
      id:          d.id,
      word:        d.data().text   || d.data().word || '',
      meaning:     d.data().meaning     || '',
      example:     d.data().example     || '',
      category:    d.data().category    || 'عام',
      starred:     d.data().starred     || false,
      forgetCount: d.data().forgetCount || 0,
      xpValue:     d.data().xpValue ?? 0,
      mastery_status: d.data().mastery_status || '',
      mastery_streak: Number(d.data().mastery_streak) || 0,
      last_recalled_at: d.data().last_recalled_at || null,
      first_recalled_at: d.data().first_recalled_at || null,
      last_recall_day: d.data().last_recall_day || '',
      last_recall_session_id: d.data().last_recall_session_id || '',
      last_quizzed_at: d.data().last_quizzed_at || null,
      quiz_seen_count: Number(d.data().quiz_seen_count) || 0,
      mastered_once: Boolean(d.data().mastered_once),
      firstMasteredAt: d.data().firstMasteredAt || null,
      hasEarnedMasteryXP: Boolean(d.data().hasEarnedMasteryXP),
      earnedTransitions: Array.isArray(d.data().earnedTransitions) ? d.data().earnedTransitions : [],
      remasteryAwardCount: Number(d.data().remasteryAwardCount) || 0,
      xpEconomyVersion: Number(d.data().xpEconomyVersion) || 0,
      order:       Number.isFinite(d.data().order) ? d.data().order : null,
      createdAt:   d.data().createdAt?.toDate ? d.data().createdAt.toDate().toISOString() : (d.data().createdAt || null)
    };
  }

  function loadCustomWorldsFromCloud(user) {
    if (!user) return;
    const listenerUid = user.uid;
    const q = collection(db, "users", user.uid, "customWorlds");
    console.info("[LootLingua customWorlds] listener starting", {
      uid: listenerUid,
      path: `users/${listenerUid}/customWorlds`,
    });
    customWorldsUnsubscribe = onSnapshot(q, (snapshot) => {
      if (auth.currentUser?.uid !== listenerUid) return;
      console.info("[LootLingua customWorlds] snapshot", {
        uid: listenerUid,
        count: snapshot.docs.length,
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
      const worlds = snapshot.docs.map(d => ({
        id: d.id,
        name: d.data().name || 'عالم جديد',
        description: d.data().description || '',
        emoji: d.data().emoji || '📘',
        createdAt: d.data().createdAt?.toDate ? d.data().createdAt.toDate().toISOString() : (d.data().createdAt || null),
        updatedAt: d.data().updatedAt?.toDate ? d.data().updatedAt.toDate().toISOString() : (d.data().updatedAt || null),
      })).sort((a, b) => {
        const at = Date.parse(a.createdAt || '') || 0;
        const bt = Date.parse(b.createdAt || '') || 0;
        return at - bt;
      });
      if (typeof window.applyCustomWorldsFromCloud === 'function') {
        window.applyCustomWorldsFromCloud(worlds, {
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        });
      }
    }, (error) => {
      console.warn("[LootLingua customWorlds] listener error", {
        uid: listenerUid,
        path: `users/${listenerUid}/customWorlds`,
        code: error.code || '',
        message: error.message || '',
      }, error);
    });
  }

  function loadGlobalWordMasteryFromCloud(user) {
    if (!user) return;
    const listenerUid = user.uid;
    wordMasteryUnsubscribe = onSnapshot(
      doc(db, "users", user.uid, "meta", "word_mastery"),
      (snapshot) => {
        if (auth.currentUser?.uid !== listenerUid || !snapshot.exists()) return;
        const entries = snapshot.data()?.entries;
        if (entries && typeof window.applyGlobalWordMasterySnapshot === 'function') {
          window.applyGlobalWordMasterySnapshot(entries);
        }
      },
      (error) => console.warn('loadGlobalWordMasteryFromCloud:', error.code || error.message)
    );
  }

  window.saveGlobalWordMasteryToCloud = async function(wordKey, state) {
    const user = auth.currentUser;
    if (!user || !wordKey || !state) return false;
    try {
      await setDoc(doc(db, "users", user.uid, "meta", "word_mastery"), {
        entries: { [String(wordKey)]: state },
        updatedAt: new Date(),
      }, { merge: true });
      return true;
    } catch (error) {
      console.warn('saveGlobalWordMasteryToCloud:', error.code || error.message);
      return false;
    }
  };

  window.claimXPEventInCloud = async function(payload = {}) {
    const user = auth.currentUser;
    const amount = Math.max(0, Math.floor(Number(payload.amount) || 0));
    const reason = String(payload.reason || '');
    const eventId = String(payload.eventId || '').replace(/\//g, '_').slice(0, 500);
    if (!user || !eventId || !amount) return { awarded: false, duplicate: false };
    const eventRef = doc(db, "users", user.uid, "meta", `xp_event_${eventId}`);
    const profileRef = doc(db, "users", user.uid, "meta", "profile");
    return runTransaction(db, async (transaction) => {
      const eventSnap = await transaction.get(eventRef);
      const profileSnap = await transaction.get(profileRef);
      const currentXP = Math.max(
        Number(profileSnap.data()?.userXP) || 0,
        Number(payload.baselineXP) || 0
      );
      if (eventSnap.exists()) {
        return { awarded: false, duplicate: true, userXP: currentXP };
      }
      const fixedAmounts = {
        word_transition_new_learning: 2,
        word_transition_learning_reviewing: 4,
        word_mastered_first: 8,
        word_remastered: 3,
      };
      const transitionSuffixes = {
        word_transition_new_learning: ':new_learning',
        word_transition_learning_reviewing: ':learning_reviewing',
        word_mastered_first: ':reviewing_mastered',
        word_remastered: ':remastered:1',
      };
      const expectedAmount = fixedAmounts[reason];
      let valid = Boolean(expectedAmount && amount === expectedAmount &&
        eventId.startsWith('word_transition:') && eventId.endsWith(transitionSuffixes[reason]));
      if (reason === 'daily_chest_unlock') {
        const loot = profileSnap.data()?.dailyLootState || {};
        const lockId = Number(loot.lockStartedAt) || Number(loot.lastOpenAt) || 0;
        valid = amount > 0 && amount <= 50 && amount === (Number(loot.lockedXP) || 0) &&
          eventId === `daily_chest_unlock:${lockId}`;
      }
      if (!valid) return { awarded: false, duplicate: false, invalid: true, userXP: currentXP };
      const nextXP = currentXP + amount;
      transaction.set(eventRef, {
        amount,
        reason,
        xpEconomyVersion: Number(payload.xpEconomyVersion) || 2,
        createdAt: new Date(),
      });
      transaction.set(profileRef, {
        userXP: nextXP,
        xpEconomyVersion: Number(payload.xpEconomyVersion) || 2,
        updatedAt: new Date(),
      }, { merge: true });
      return { awarded: true, duplicate: false, userXP: nextXP };
    });
  };

  window.listenCustomWorldWordsFromCloud = function(worldId) {
    const user = auth.currentUser;
    if (!user || !worldId) return;
    if (customWorldWordsUnsubscribe) {
      customWorldWordsUnsubscribe();
      customWorldWordsUnsubscribe = null;
    }
    const listenerUid = user.uid;
    const listenerWorldId = String(worldId);
    const q = query(collection(db, "users", user.uid, "customWorlds", listenerWorldId, "words"), orderBy("createdAt", "desc"));
    customWorldWordsUnsubscribe = onSnapshot(q, (snapshot) => {
      if (auth.currentUser?.uid !== listenerUid) return;
      if (window.__suppressCloudWordsSnapshot) return;
      if (typeof window.isActiveCustomWorld !== 'function' || !window.isActiveCustomWorld(listenerWorldId)) return;
      const cloudWords = snapshot.docs.map(mapWordDoc);
      if (typeof window.applyCustomWorldWordsFromSnapshot === 'function') {
        window.applyCustomWorldWordsFromSnapshot(listenerWorldId, cloudWords);
      }
    }, (error) => {
      console.warn("listenCustomWorldWordsFromCloud:", error.code || error.message, error);
    });
  };

  window.stopCustomWorldWordsCloudListener = function() {
    if (customWorldWordsUnsubscribe) {
      customWorldWordsUnsubscribe();
      customWorldWordsUnsubscribe = null;
    }
  };

  window.saveCustomWorldToCloud = async function(world) {
    const user = auth.currentUser;
    if (!user || !world?.id) return false;
    const worldId = String(world.id).replace(/\//g, '_').slice(0, 500);
    const path = `users/${user.uid}/customWorlds/${worldId}`;
    window.__lastCustomWorldSaveError = '';
    console.info("[LootLingua customWorlds] setDoc start", {
      uid: user.uid,
      worldId,
      path,
      hasAuth: Boolean(user),
    });
    try {
      await setDoc(doc(db, "users", user.uid, "customWorlds", worldId), {
        name: world.name || 'عالم جديد',
        description: world.description || '',
        emoji: world.emoji || '📘',
        userId: user.uid,
        createdAt: world.createdAt || new Date(),
        updatedAt: new Date(),
      }, { merge: true });
      console.info("[LootLingua customWorlds] setDoc success", { uid: user.uid, worldId, path });
      return true;
    } catch (e) {
      window.__lastCustomWorldSaveError = `${e.code || 'unknown'}: ${e.message || e}`;
      console.warn("[LootLingua customWorlds] setDoc failed", {
        uid: user.uid,
        worldId,
        path,
        code: e.code || '',
        message: e.message || '',
      }, e);
      return false;
    }
  };

  window.deleteCustomWorldFromCloud = async function(worldId) {
    const user = auth.currentUser;
    if (!user || !worldId) return false;
    try {
      const wordsRef = collection(db, "users", user.uid, "customWorlds", String(worldId), "words");
      const snap = await getDocs(wordsRef);
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, "users", user.uid, "customWorlds", String(worldId)));
      return true;
    } catch (e) {
      console.warn("deleteCustomWorldFromCloud:", e.message);
      return false;
    }
  };

  window.saveCustomWorldWordToCloud = async function(worldId, word = {}) {
    const user = auth.currentUser;
    if (!user || !worldId) return null;
    const docId = String(word.id || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`)
      .replace(/\//g, '_')
      .slice(0, 500);
    try {
      await setDoc(doc(db, "users", user.uid, "customWorlds", String(worldId), "words", docId), {
        text: word.word || word.text || '',
        category: word.category || 'عام',
        meaning: word.meaning || '',
        example: word.example || '',
        starred: Boolean(word.starred),
        forgetCount: Number(word.forgetCount) || 0,
        userId: user.uid,
        xpValue: word.xpValue ?? 0,
        mastery_status: word.mastery_status || 'New',
        mastery_streak: Number(word.mastery_streak) || 0,
        last_recalled_at: word.last_recalled_at || null,
        first_recalled_at: word.first_recalled_at || null,
        last_recall_day: word.last_recall_day || '',
        last_recall_session_id: word.last_recall_session_id || '',
        last_quizzed_at: word.last_quizzed_at || null,
        quiz_seen_count: Number(word.quiz_seen_count) || 0,
        mastered_once: Boolean(word.mastered_once),
        firstMasteredAt: word.firstMasteredAt || null,
        hasEarnedMasteryXP: Boolean(word.hasEarnedMasteryXP),
        earnedTransitions: Array.isArray(word.earnedTransitions) ? word.earnedTransitions : [],
        remasteryAwardCount: Number(word.remasteryAwardCount) || 0,
        xpEconomyVersion: Number(word.xpEconomyVersion) || 0,
        order: Number.isFinite(word.order) ? word.order : 0,
        createdAt: word.createdAt || new Date()
      }, { merge: false });
      return docId;
    } catch (e) {
      console.error("saveCustomWorldWordToCloud:", e);
      return null;
    }
  };

  window.updateCustomWorldWordInCloud = async function(worldId, docId, data) {
    const user = auth.currentUser;
    if (!user || !worldId || !docId) return;
    const update = { userId: user.uid };
    if ('word'        in data) update.text        = data.word;
    if ('meaning'     in data) update.meaning     = data.meaning;
    if ('example'     in data) update.example     = data.example;
    if ('category'    in data) update.category    = data.category;
    if ('starred'     in data) update.starred     = data.starred;
    if ('forgetCount' in data) update.forgetCount = data.forgetCount;
    if ('xpValue'     in data) update.xpValue     = data.xpValue;
    if ('order'       in data) update.order       = data.order;
    if ('mastery_status' in data) update.mastery_status = data.mastery_status;
    if ('mastery_streak' in data) update.mastery_streak = data.mastery_streak;
    if ('last_recalled_at' in data) update.last_recalled_at = data.last_recalled_at;
    if ('first_recalled_at' in data) update.first_recalled_at = data.first_recalled_at;
    if ('last_recall_day' in data) update.last_recall_day = data.last_recall_day;
    if ('last_recall_session_id' in data) update.last_recall_session_id = data.last_recall_session_id;
    if ('last_quizzed_at' in data) update.last_quizzed_at = data.last_quizzed_at;
    if ('quiz_seen_count' in data) update.quiz_seen_count = data.quiz_seen_count;
    if ('mastered_once' in data) update.mastered_once = data.mastered_once;
    if ('firstMasteredAt' in data) update.firstMasteredAt = data.firstMasteredAt;
    if ('hasEarnedMasteryXP' in data) update.hasEarnedMasteryXP = data.hasEarnedMasteryXP;
    if ('earnedTransitions' in data) update.earnedTransitions = data.earnedTransitions;
    if ('remasteryAwardCount' in data) update.remasteryAwardCount = data.remasteryAwardCount;
    if ('xpEconomyVersion' in data) update.xpEconomyVersion = data.xpEconomyVersion;
    try { await updateDoc(doc(db, "users", user.uid, "customWorlds", String(worldId), "words", docId), update); }
    catch (e) { console.error("updateCustomWorldWordInCloud:", e); }
  };

  window.deleteCustomWorldWordFromCloud = async function(worldId, id) {
    const user = auth.currentUser;
    if (!user || !worldId || !id) return false;
    try {
      await deleteDoc(doc(db, "users", user.uid, "customWorlds", String(worldId), "words", String(id)));
      return true;
    } catch (e) {
      console.error("deleteCustomWorldWordFromCloud:", e);
      return false;
    }
  };

  window.saveWordToCloud = async function(wordText, wordCategory, meaning, example, order = 0, extra = {}) {
    const user = auth.currentUser;
    if (!user) return null;
    const source = extra && typeof extra === 'object' ? extra : {};
    const createdAt = source.createdAt || new Date();
    try {
      const ref = await addDoc(collection(db, "users", user.uid, "words"), {
        text: wordText || source.word || source.text || '',
        category: wordCategory || source.category || 'عام',
        meaning: meaning || source.meaning || '',
        example: example || source.example || '',
        starred: Boolean(source.starred),
        forgetCount: Number(source.forgetCount) || 0,
        userId: user.uid,
        xpValue: source.xpValue ?? 0,
        mastery_status: source.mastery_status || 'New',
        mastery_streak: Number(source.mastery_streak) || 0,
        last_recalled_at: source.last_recalled_at || null,
        first_recalled_at: source.first_recalled_at || null,
        last_recall_day: source.last_recall_day || '',
        last_recall_session_id: source.last_recall_session_id || '',
        last_quizzed_at: source.last_quizzed_at || null,
        quiz_seen_count: Number(source.quiz_seen_count) || 0,
        mastered_once: Boolean(source.mastered_once),
        firstMasteredAt: source.firstMasteredAt || null,
        hasEarnedMasteryXP: Boolean(source.hasEarnedMasteryXP),
        earnedTransitions: Array.isArray(source.earnedTransitions) ? source.earnedTransitions : [],
        remasteryAwardCount: Number(source.remasteryAwardCount) || 0,
        xpEconomyVersion: Number(source.xpEconomyVersion) || 0,
        order: Number.isFinite(order) ? order : (Number.isFinite(source.order) ? source.order : 0),
        createdAt
      });
      return ref.id;
    } catch (e) { console.error("فشل الرفع:", e); return null; }
  };

  window.updateWordInCloud = async function(docId, data) {
    const user = auth.currentUser;
    if (!user || !docId) return;
    const update = { userId: user.uid };
    if ('word'        in data) update.text        = data.word;
    if ('meaning'     in data) update.meaning     = data.meaning;
    if ('example'     in data) update.example     = data.example;
    if ('category'    in data) update.category    = data.category;
    if ('starred'     in data) update.starred     = data.starred;
    if ('forgetCount' in data) update.forgetCount = data.forgetCount;
    if ('xpValue'     in data) update.xpValue     = data.xpValue;
    if ('order'       in data) update.order       = data.order;
    if ('mastery_status' in data) update.mastery_status = data.mastery_status;
    if ('mastery_streak' in data) update.mastery_streak = data.mastery_streak;
    if ('last_recalled_at' in data) update.last_recalled_at = data.last_recalled_at;
    if ('first_recalled_at' in data) update.first_recalled_at = data.first_recalled_at;
    if ('last_recall_day' in data) update.last_recall_day = data.last_recall_day;
    if ('last_recall_session_id' in data) update.last_recall_session_id = data.last_recall_session_id;
    if ('last_quizzed_at' in data) update.last_quizzed_at = data.last_quizzed_at;
    if ('quiz_seen_count' in data) update.quiz_seen_count = data.quiz_seen_count;
    if ('mastered_once' in data) update.mastered_once = data.mastered_once;
    if ('firstMasteredAt' in data) update.firstMasteredAt = data.firstMasteredAt;
    if ('hasEarnedMasteryXP' in data) update.hasEarnedMasteryXP = data.hasEarnedMasteryXP;
    if ('earnedTransitions' in data) update.earnedTransitions = data.earnedTransitions;
    if ('remasteryAwardCount' in data) update.remasteryAwardCount = data.remasteryAwardCount;
    if ('xpEconomyVersion' in data) update.xpEconomyVersion = data.xpEconomyVersion;
    try { await updateDoc(doc(db, "users", user.uid, "words", docId), update); }
    catch (e) { console.error("خطأ في التحديث:", e); }
  };

  let activeQuizSessionWriteChain = Promise.resolve();

  window.saveActiveQuizSessionToCloud = async function(session) {
    const user = auth.currentUser;
    if (!user || !session) return;
    activeQuizSessionWriteChain = activeQuizSessionWriteChain
      .catch(() => {})
      .then(async () => {
        if (auth.currentUser?.uid !== user.uid) return;
        try { await setDoc(doc(db, "users", user.uid, "meta", "active_quiz_session"), session, { merge: false }); }
        catch (e) { console.warn("activeQuizSession save:", e.message); }
      });
    return activeQuizSessionWriteChain;
  };

  window.loadActiveQuizSessionFromCloud = async function() {
    const user = auth.currentUser;
    if (!user) return null;
    try {
      const snap = await getDoc(doc(db, "users", user.uid, "meta", "active_quiz_session"));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      console.warn("activeQuizSession load:", e.message);
      return null;
    }
  };

  window.clearActiveQuizSessionFromCloud = async function() {
    const user = auth.currentUser;
    if (!user) return;
    activeQuizSessionWriteChain = activeQuizSessionWriteChain
      .catch(() => {})
      .then(async () => {
        if (auth.currentUser?.uid !== user.uid) return;
        try { await deleteDoc(doc(db, "users", user.uid, "meta", "active_quiz_session")); }
        catch (e) { console.warn("activeQuizSession clear:", e.message); }
      });
    return activeQuizSessionWriteChain;
  };

  window.deleteWordFromCloud = async function(id) {
    const user = auth.currentUser;
    if (!user || !id) return false;
    try {
      await deleteDoc(doc(db, "users", user.uid, "words", String(id)));
      return true;
    } catch (e) {
      console.error("خطأ بالحذف:", e);
      return false;
    }
  };

  const AI_CACHE_COLLECTION = 'ai_global_cache';

  function normalizeAiCacheDocId(word) {
    const id = String(word || '').toLowerCase().trim()
      .replace(/\//g, '_')
      .replace(/[^\w\-\u0600-\u06FF]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return id ? id.slice(0, 500) : '';
  }

  function readCacheEntry(data, type) {
    if (!data) return null;
    const bucket = data.caches?.[type];
    if (bucket?.meanings && Array.isArray(bucket.meanings) && bucket.meanings.length) {
      return bucket.meanings;
    }
    if (data.type === type && Array.isArray(data.meanings) && data.meanings.length) {
      return data.meanings;
    }
    if (data.type === type && data.meaning != null) {
      return Array.isArray(data.meaning) ? data.meaning : [data.meaning];
    }
    return null;
  }

  /** قراءة معاني AI من الذاكرة المشتركة — Document ID = الكلمة، type = normal | gamer */
  window.getAiGlobalCache = async function(word, type) {
    const docId = normalizeAiCacheDocId(word);
    if (!docId || !type) return null;
    try {
      const snap = await getDoc(doc(db, AI_CACHE_COLLECTION, docId));
      if (!snap.exists()) return null;
      return readCacheEntry(snap.data(), type);
    } catch (e) {
      console.warn('getAiGlobalCache:', e);
      return null;
    }
  };

  /** حفظ نتائج AI للجميع — word, meanings, type, createdAt */
  window.saveAiGlobalCache = async function(word, type, meanings) {
    const docId = normalizeAiCacheDocId(word);
    if (!docId || !type || !Array.isArray(meanings) || !meanings.length) return false;
    try {
      await setDoc(doc(db, AI_CACHE_COLLECTION, docId), {
        word: String(word).trim(),
        caches: {
          [type]: {
            type,
            meanings,
            createdAt: serverTimestamp(),
          },
        },
      }, { merge: true });
      return true;
    } catch (e) {
      console.warn('saveAiGlobalCache:', e);
      return false;
    }
  };

  /** اقتراح إضافة كلمة — Collection: suggestions (بدون XP) */
  window.submitWordSuggestion = async function(payload = {}) {
    const word = String(payload.word || '').trim();
    const ar = String(payload.ar || '').trim();
    const game = String(payload.game || '').trim();
    if (!word || !ar) return { ok: false, error: 'الكلمة والمعنى مطلوبان' };
    const user = auth.currentUser;
    if (!user) return { ok: false, error: 'سجّل دخولك أولاً' };
    try {
      await addDoc(collection(db, 'suggestions'), {
        word,
        ar,
        game,
        timestamp: serverTimestamp(),
        userId: user.uid,
        userEmail: user.email || '',
      });
      return { ok: true };
    } catch (e) {
      console.error('submitWordSuggestion:', e);
      return { ok: false, error: e.message || 'فشل الإرسال' };
    }
  };
