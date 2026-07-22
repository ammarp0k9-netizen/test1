
  import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import {
    getAuth, signInWithPopup, signInWithRedirect, signOut,
    GoogleAuthProvider, onAuthStateChanged, getRedirectResult
  } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  import {
    getFirestore, collection, addDoc, query,
    orderBy, deleteDoc, doc, updateDoc, onSnapshot, serverTimestamp,
    getDoc, setDoc, getDocs, runTransaction, writeBatch
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
      const cloudWords = snapshot.docs.map(mapWordDoc);

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
    const data = d.data() || {};
    return {
      id:          d.id,
      word:        data.text || data.word || '',
      normalizedWord: data.normalizedWord || '',
      wordKey: data.wordKey || '',
      translation: data.translation || data.meaning || '',
      meaning:     data.meaning || data.translation || '',
      definition: data.definition || '',
      definition_ar: data.definition_ar || data.definitionAr || '',
      example:     data.example || '',
      exampleTranslation: data.exampleTranslation || '',
      partOfSpeech: data.partOfSpeech || '',
      category:    data.category || 'عام',
      level: data.level || data.difficulty || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      synonyms: Array.isArray(data.synonyms) ? data.synonyms : [],
      pronunciation: data.pronunciation || '',
      notes: data.notes || '',
      starred:     data.starred || false,
      forgetCount: data.forgetCount || 0,
      xpValue:     data.xpValue ?? 0,
      mastery_status: data.mastery_status || '',
      mastery_streak: Number(data.mastery_streak) || 0,
      last_recalled_at: data.last_recalled_at || null,
      first_recalled_at: data.first_recalled_at || null,
      last_recall_day: data.last_recall_day || '',
      last_recall_session_id: data.last_recall_session_id || '',
      last_quizzed_at: data.last_quizzed_at || null,
      quiz_seen_count: Number(data.quiz_seen_count) || 0,
      mastered_once: Boolean(data.mastered_once),
      firstMasteredAt: data.firstMasteredAt || null,
      hasEarnedMasteryXP: Boolean(data.hasEarnedMasteryXP),
      earnedTransitions: Array.isArray(data.earnedTransitions) ? data.earnedTransitions : [],
      remasteryAwardCount: Number(data.remasteryAwardCount) || 0,
      xpEconomyVersion: Number(data.xpEconomyVersion) || 0,
      hiddenFromDictionary: data.hiddenFromDictionary === true,
      hiddenFromDictionaryAt: data.hiddenFromDictionaryAt?.toDate
        ? data.hiddenFromDictionaryAt.toDate().toISOString()
        : (data.hiddenFromDictionaryAt || null),
      order:       Number.isFinite(data.order) ? data.order : null,
      createdAt:   data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || null)
    };
  }

  const USER_WORD_EDUCATIONAL_FIELDS = Object.freeze([
    'word', 'normalizedWord', 'wordKey', 'translation', 'definition',
    'definition_ar', 'example', 'exampleTranslation', 'partOfSpeech',
    'category', 'level', 'tags', 'synonyms', 'pronunciation', 'notes',
  ]);

  function wordLifecycleApi() {
    if (!window.LootLinguaWordLifecycle) {
      const error = new Error('Word lifecycle contract is unavailable.');
      error.code = 'word-lifecycle/unavailable';
      throw error;
    }
    return window.LootLinguaWordLifecycle;
  }

  function wordLifecycleError(code, message, cause) {
    const error = new Error(message || code, cause ? { cause } : undefined);
    error.code = code;
    return error;
  }

  function deterministicUserWordId(wordKey) {
    return `published_${String(wordKey || '').replace(/\//g, '_')}`.slice(0, 500);
  }

  function educationalWordFields(word, identity) {
    const source = word && typeof word === 'object' ? word : {};
    return {
      word: String(source.word || source.text || ''),
      normalizedWord: String(identity.normalizedWord || ''),
      wordKey: String(identity.wordKey || ''),
      translation: String(source.translation || source.meaning || ''),
      definition: String(source.definition || ''),
      definition_ar: String(source.definition_ar || source.definitionAr || ''),
      example: String(source.example || ''),
      exampleTranslation: String(source.exampleTranslation || ''),
      partOfSpeech: String(source.partOfSpeech || ''),
      category: String(source.category || ''),
      level: String(source.level || source.difficulty || source.cefrLevel || ''),
      tags: Array.isArray(source.tags) ? source.tags.map(String).filter(Boolean) : [],
      synonyms: Array.isArray(source.synonyms) ? source.synonyms.map(String).filter(Boolean) : [],
      pronunciation: String(source.pronunciation || ''),
      notes: String(source.notes || ''),
    };
  }

  function missingEducationalPatch(existing, incoming) {
    const patch = {};
    USER_WORD_EDUCATIONAL_FIELDS.forEach((field) => {
      const current = existing?.[field];
      const next = incoming?.[field];
      const currentEmpty = Array.isArray(current)
        ? current.length === 0
        : !String(current ?? '').trim() || (field === 'category' && current === 'عام');
      const nextPresent = Array.isArray(next)
        ? next.length > 0
        : Boolean(String(next ?? '').trim());
      if (currentEmpty && nextPresent) patch[field] = next;
    });
    if ((!existing?.text && !existing?.word) && incoming.word) patch.text = incoming.word;
    if (!existing?.meaning && incoming.translation) patch.meaning = incoming.translation;
    return patch;
  }

  function sourceIdentity(source, identity) {
    const lifecycle = wordLifecycleApi();
    const input = source && typeof source === 'object' ? source : {};
    const type = lifecycle.normalizeSourceType(input.type || input.addedFrom);
    const safe = (value) => String(value || '').trim().replace(/\//g, '_').slice(0, 500);
    let sourceId = '';
    if (type === 'published-gate') {
      sourceId = window.LootLinguaJourney.contentSourceId(input);
    } else if (type === 'level-placement') {
      sourceId = window.LootLinguaJourney.levelPlacementSourceId(input);
    } else if (type === 'private-world') {
      sourceId = `private_world_${safe(input.customWorldId)}`;
    } else if (type === 'dictionary-search') {
      sourceId = 'dictionary_search';
    } else if (type === 'import') {
      sourceId = `import_${safe(input.importId) || 'account'}`;
    } else {
      sourceId = 'manual';
    }
    if (!sourceId || sourceId.includes('/')) {
      throw wordLifecycleError('word-lifecycle/invalid-source', 'Word source is invalid.');
    }
    return { ...input, type, sourceId, wordKey: identity.wordKey };
  }

  function sourceDocumentPayload(source, operationId) {
    const payload = {
      addedFrom: source.type,
      operationId: String(operationId || `word-${source.sourceId}`).slice(0, 180),
      linkedAt: serverTimestamp(),
    };
    if (source.type === 'published-gate' || source.type === 'level-placement') {
      Object.assign(payload, {
        worldId: String(source.worldId || ''),
        rankId: String(source.rankId || ''),
        gateId: String(source.gateId || ''),
        contentWordId: String(source.contentWordId || ''),
      });
    }
    if (source.type === 'published-gate' && source.placementAssessmentId) {
      payload.placementAssessmentId = String(source.placementAssessmentId);
      payload.placementSeenAt = serverTimestamp();
    }
    if (source.type === 'level-placement') {
      Object.assign(payload, {
        type: 'level-placement',
        assessmentId: String(source.assessmentId || ''),
        cefrLevel: String(source.cefrLevel || ''),
        placementResult: source.placementResult === 'correct' ? 'correct' : 'incorrect',
      });
    }
    if (source.type === 'private-world') payload.customWorldId = String(source.customWorldId || '');
    if (source.type === 'import') payload.importId = String(source.importId || 'account');
    return payload;
  }

  function primarySourcePayload(source) {
    const payload = { sourceId: source.sourceId, addedFrom: source.type };
    ['worldId', 'rankId', 'gateId', 'contentWordId', 'customWorldId', 'importId']
      .forEach((field) => {
        if (source[field]) payload[field] = String(source[field]);
      });
    return payload;
  }

  function canonicalWordPayload(word, identity, legacyWordId, source) {
    const educational = educationalWordFields(word, identity);
    const hierarchy = source.type === 'published-gate' || source.type === 'level-placement';
    return {
      ...educational,
      canonicalId: identity.wordKey,
      normalizationVersion: identity.normalizationVersion,
      masteryKey: identity.wordKey,
      legacyWordId,
      meaning: educational.translation,
      difficulty: educational.level,
      forgetCount: 0,
      ...(hierarchy ? {
        contentRefPath: `content_worlds/${source.worldId}/ranks/${source.rankId}/gates/${source.gateId}/words/${source.contentWordId}`,
      } : {}),
      primarySource: primarySourcePayload(source),
      sourceCount: 1,
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  }

  function legacyWordPayload(uid, word, identity, options) {
    const educational = educationalWordFields(word, identity);
    const hidden = options?.hiddenOnCreate === true;
    return {
      ...educational,
      text: educational.word,
      category: educational.category || 'عام',
      meaning: educational.translation,
      starred: Boolean(word?.starred),
      forgetCount: Number(word?.forgetCount) || 0,
      userId: uid,
      xpValue: word?.xpValue ?? 0,
      mastery_status: word?.mastery_status || 'New',
      mastery_streak: Number(word?.mastery_streak) || 0,
      last_recalled_at: word?.last_recalled_at || null,
      first_recalled_at: word?.first_recalled_at || null,
      last_recall_day: word?.last_recall_day || '',
      last_recall_session_id: word?.last_recall_session_id || '',
      last_quizzed_at: word?.last_quizzed_at || null,
      quiz_seen_count: Number(word?.quiz_seen_count) || 0,
      mastered_once: Boolean(word?.mastered_once),
      firstMasteredAt: word?.firstMasteredAt || null,
      hasEarnedMasteryXP: Boolean(word?.hasEarnedMasteryXP),
      earnedTransitions: Array.isArray(word?.earnedTransitions) ? word.earnedTransitions : [],
      remasteryAwardCount: Number(word?.remasteryAwardCount) || 0,
      xpEconomyVersion: Number(word?.xpEconomyVersion) || 0,
      hiddenFromDictionary: hidden,
      hiddenFromDictionaryAt: hidden ? serverTimestamp() : null,
      order: Number.isFinite(word?.order) ? word.order : 0,
      createdAt: word?.createdAt || serverTimestamp(),
    };
  }

  async function upsertUserWordWithSource(input = {}) {
    const user = auth.currentUser;
    if (!user) throw wordLifecycleError('word-lifecycle/sign-in-required', 'Sign in is required.');
    if (input.uid && String(input.uid) !== user.uid) {
      throw wordLifecycleError('word-lifecycle/user-mismatch', 'Word owner does not match the signed-in user.');
    }
    const lifecycle = wordLifecycleApi();
    const word = input.word && typeof input.word === 'object' ? input.word : { word: input.word };
    const identity = lifecycle.normalizeIdentity(word);
    if (!identity.normalizedWord || !identity.wordKey) {
      throw wordLifecycleError('word-lifecycle/invalid-word', 'Word identity is invalid.');
    }
    if (word.wordKey && String(word.wordKey) !== identity.wordKey) {
      throw wordLifecycleError('word-lifecycle/identity-mismatch', 'Word identity is inconsistent.');
    }
    const source = sourceIdentity(input.source, identity);
    const canonicalRef = doc(db, 'users', user.uid, 'contentWords', identity.wordKey);
    const sourceRef = doc(canonicalRef, 'sources', source.sourceId);
    const localWord = lifecycle.findUserWordByKey(window.words || [], identity.wordKey);

    try {
      return await runTransaction(db, async (transaction) => {
        const [canonicalSnapshot, sourceSnapshot] = await Promise.all([
          transaction.get(canonicalRef),
          transaction.get(sourceRef),
        ]);
        const canonical = canonicalSnapshot.exists() ? canonicalSnapshot.data() : null;
        const legacyWordId = String(
          input.existingWordId || canonical?.legacyWordId || localWord?.id ||
          deterministicUserWordId(identity.wordKey)
        );
        const legacyRef = doc(db, 'users', user.uid, 'words', legacyWordId);
        const legacySnapshot = await transaction.get(legacyRef);
        const legacy = legacySnapshot.exists() ? legacySnapshot.data() : null;
        const incomingLegacy = legacyWordPayload(user.uid, word, identity, input);
        const educationalPatch = legacy ? missingEducationalPatch(legacy, incomingLegacy) : {};
        const wasHidden = legacy?.hiddenFromDictionary === true;
        const restored = Boolean(input.restoreHidden === true && wasHidden);
        const sourceLinked = !sourceSnapshot.exists();
        const created = !canonicalSnapshot.exists() && !legacySnapshot.exists();

        if (!canonicalSnapshot.exists()) {
          transaction.set(canonicalRef, canonicalWordPayload(
            word,
            identity,
            legacyWordId,
            source
          ));
        } else if (sourceLinked) {
          transaction.update(canonicalRef, {
            sourceCount: Math.max(0, Number(canonical?.sourceCount) || 0) + 1,
            updatedAt: serverTimestamp(),
          });
        }

        if (!legacySnapshot.exists()) {
          transaction.set(legacyRef, incomingLegacy);
        } else {
          const patch = { ...educationalPatch };
          if (restored) {
            patch.hiddenFromDictionary = false;
            patch.hiddenFromDictionaryAt = null;
          }
          if (Object.keys(patch).length) transaction.update(legacyRef, patch);
        }
        if (sourceLinked) {
          transaction.set(sourceRef, sourceDocumentPayload(source, input.operationId));
        }

        const updatedMissingFields = Object.keys(educationalPatch).length > 0;
        const flags = {
          created,
          restored,
          sourceLinked: !created && !restored && sourceLinked,
          alreadyLinked: !created && !restored && !sourceLinked && !updatedMissingFields,
          updatedMissingFields: !created && !restored && !sourceLinked && updatedMissingFields,
        };
        return {
          status: lifecycle.resultType(flags),
          ...flags,
          educationalFieldsUpdated: Object.keys(educationalPatch),
          hiddenPreserved: wasHidden && !restored,
          wordKey: identity.wordKey,
          wordId: legacyWordId,
          sourceId: source.sourceId,
          sourceType: source.type,
          linked: sourceLinked,
          existingWord: !created,
          restoredReady: restored,
        };
      });
    } catch (error) {
      if (!error.code) error.code = 'word-lifecycle/failed';
      throw error;
    }
  }

  async function getUserWordSourceSummary(wordOrKey) {
    const user = auth.currentUser;
    if (!user) throw wordLifecycleError('word-lifecycle/sign-in-required', 'Sign in is required.');
    const lifecycle = wordLifecycleApi();
    const wordKey = lifecycle.wordKeyOf(wordOrKey);
    if (!wordKey) return lifecycle.summarizeSources([]);
    const canonicalRef = doc(db, 'users', user.uid, 'contentWords', wordKey);
    const canonicalSnapshot = await getDoc(canonicalRef);
    if (!canonicalSnapshot.exists()) return lifecycle.summarizeSources([]);
    const snapshot = await getDocs(collection(canonicalRef, 'sources'));
    return lifecycle.summarizeSources(snapshot.docs.map((item) => ({
      sourceId: item.id,
      ...(item.data() || {}),
    })));
  }

  async function setUserWordDictionaryVisibility(wordId, visible) {
    const user = auth.currentUser;
    if (!user || !wordId) throw wordLifecycleError('word-lifecycle/invalid-word', 'Word is unavailable.');
    await updateDoc(doc(db, 'users', user.uid, 'words', String(wordId)), {
      hiddenFromDictionary: !visible,
      hiddenFromDictionaryAt: visible ? null : serverTimestamp(),
    });
    return { wordId: String(wordId), hiddenFromDictionary: !visible };
  }

  async function deletePersonalUserWord(wordId, wordOrKey, knownSourceSummary) {
    const user = auth.currentUser;
    if (!user || !wordId) {
      throw wordLifecycleError('word-lifecycle/invalid-word', 'Word is unavailable.');
    }
    const lifecycle = wordLifecycleApi();
    const wordKey = lifecycle.wordKeyOf(wordOrKey);
    const legacyRef = doc(db, 'users', user.uid, 'words', String(wordId));
    if (!wordKey) {
      await deleteDoc(legacyRef);
      return { deleted: true, wordId: String(wordId), sourceCount: 0 };
    }
    const canonicalRef = doc(db, 'users', user.uid, 'contentWords', wordKey);
    const summary = knownSourceSummary || await getUserWordSourceSummary(wordKey);
    if (summary?.hasJourneySource) {
      throw wordLifecycleError(
        'word-lifecycle/journey-delete-forbidden',
        'Journey-linked words must be hidden instead of deleted.'
      );
    }
    const canonicalSnapshot = await getDoc(canonicalRef);
    const batch = writeBatch(db);
    batch.delete(legacyRef);
    (summary?.sources || []).forEach((source) => {
      if (!source?.sourceId || lifecycle.isJourneySourceType(source.addedFrom)) return;
      batch.delete(doc(canonicalRef, 'sources', String(source.sourceId)));
    });
    if (
      canonicalSnapshot.exists() &&
      Number.isFinite(Number(canonicalSnapshot.data()?.sourceCount)) &&
      Number(canonicalSnapshot.data().sourceCount) > 0
    ) {
      batch.update(canonicalRef, { sourceCount: 0, updatedAt: serverTimestamp() });
    }
    await batch.commit();
    return {
      deleted: true,
      wordId: String(wordId),
      wordKey,
      sourceCount: (summary?.sources || []).length,
    };
  }

  window.LootLinguaWordLifecycleCloud = Object.freeze({
    upsertUserWordWithSource,
    getUserWordSourceSummary,
    setUserWordDictionaryVisibility,
    deletePersonalUserWord,
  });
  window.upsertUserWordWithSource = upsertUserWordWithSource;
  window.getUserWordSourceSummary = getUserWordSourceSummary;
  window.hideUserWordFromDictionary = (wordId) => setUserWordDictionaryVisibility(wordId, false);
  window.restoreUserWordToDictionary = (wordId) => setUserWordDictionaryVisibility(wordId, true);
  window.deletePersonalUserWord = deletePersonalUserWord;

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
      await upsertUserWordWithSource({
        word,
        source: { type: 'private-world', customWorldId: String(worldId) },
        restoreHidden: false,
        hiddenOnCreate: true,
        operationId: `private-world:${String(worldId)}`,
      });
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
    try {
      const result = await upsertUserWordWithSource({
        word: {
          ...source,
          word: wordText || source.word || source.text || '',
          category: wordCategory || source.category || 'عام',
          meaning: meaning || source.meaning || '',
          example: example || source.example || '',
          order: Number.isFinite(order) ? order : source.order,
        },
        source: source.lifecycleSource || { type: 'manual' },
        restoreHidden: true,
        existingWordId: source.existingWordId,
        operationId: source.operationId || 'personal-word-upsert',
      });
      window.__lastUserWordLifecycleResult = result;
      return result.wordId;
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
