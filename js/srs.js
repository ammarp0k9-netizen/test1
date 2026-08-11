// QUIZ — Modes + Settings
// ═══════════════════════════════════════════════════════
let selectedQuizMode = 'flashcards';
let quizQuestionCount = '10';
let currentQuizSource = 'personal';
let currentQuizPool = [];
let timeAttackHp = 3;
let timeAttackSeconds = 15;
let timeAttackTimer = null;
let timeAttackDirection = 'ar-to-en';
let scrambleDirection = 'ar-to-en';
let activeQuizSession = null;
let currentQuizExposureSessionId = '';
let currentQuizExposureMode = '';
let flashcardSessionOutcomes = new Map();
let quizSessionResults = [];
let hasStartedAnswering = false;
let pendingQuizExitTarget = 'quiz';

const ACTIVE_QUIZ_SESSION_KEY = 'active_quiz_session';
const SRS_STATUSES = ['New', 'Learning', 'Reviewing', 'Mastered'];
const SRS_MASTERY_WINDOW_MS = 72 * 60 * 60 * 1000;
const SRS_MASTERED_REVIEW_DUE_MS = 7 * 24 * 60 * 60 * 1000;
const QUIZ_QUEUE_DAY_MS = 24 * 60 * 60 * 1000;
const QUIZ_QUOTAS = Object.freeze({
  reviewing: 0.40,
  learning: 0.30,
  new: 0.20,
  masteredDue: 0.10,
});
const QUIZ_QUOTA_CAPS = Object.freeze({ new: 4, masteredDue: 3 });
const QUIZ_BACKLOG_THRESHOLDS = Object.freeze({
  heavyDueRatio: 2,
  criticalDueRatio: 3,
  severeOverdueMs: 3 * QUIZ_QUEUE_DAY_MS,
  heavySevereRatio: 1,
  criticalSevereRatio: 2,
});
const QUIZ_QUOTA_FALLBACKS = Object.freeze({
  reviewing: ['learning', 'masteredDue', 'new'],
  learning: ['reviewing', 'new', 'masteredDue'],
  new: ['learning', 'reviewing', 'masteredDue'],
  masteredDue: ['reviewing', 'learning', 'new'],
});
if (typeof window.__lootlinguaQuizDebug !== 'boolean') window.__lootlinguaQuizDebug = false;
const WORD_MASTERY_STORAGE_PREFIX = 'lootlinguaWordMastery_';
const QUIZ_EXPOSURE_HISTORY_PREFIX = 'lootlinguaQuizExposureHistory_';
const SCRAMBLE_DIRECTION_COPY = {
  'ar-to-en': 'رتب حروف الكلمة الإنجليزية اعتماداً على معناها العربي.',
  'en-to-ar': 'رتب حروف المعنى العربي اعتماداً على الكلمة الإنجليزية.'
};

function getDefaultMasteryState() {
  return {
    mastery_status: 'New',
    mastery_streak: 0,
    last_recalled_at: null,
    first_recalled_at: null,
    last_recall_day: '',
    last_recall_session_id: '',
    last_quizzed_at: null,
    quiz_seen_count: 0,
    mastered_once: false,
    firstMasteredAt: null,
    hasEarnedMasteryXP: false,
    earnedTransitions: [],
    remasteryAwardCount: 0,
    xpEconomyVersion: XP_ECONOMY_VERSION,
  };
}

function normalizeMasteryStatus(status) {
  return SRS_STATUSES.includes(status) ? status : 'New';
}

function getInlineWordMasteryState(word = {}) {
  const rawStreak = Math.max(0, Math.min(3, Number(word.mastery_streak ?? word.masteryStreak ?? 0) || 0));
  const rawStatus = word.mastery_status || word.masteryStatus || word.status;
  const inferredStatus = rawStreak >= 3 && (word.mastered_once || word.masteredOnce)
    ? 'Mastered'
    : rawStreak >= 2
      ? 'Reviewing'
      : rawStreak >= 1
        ? 'Learning'
        : 'New';
  const status = normalizeMasteryStatus(rawStatus || inferredStatus);
  const economyVersion = Number(word.xpEconomyVersion) || 0;
  let earnedTransitions = Array.isArray(word.earnedTransitions) ? [...new Set(word.earnedTransitions)] : [];
  if (economyVersion < XP_ECONOMY_VERSION) {
    if (status === 'Learning' || status === 'Reviewing' || status === 'Mastered') earnedTransitions.push('new_learning');
    if (status === 'Reviewing' || status === 'Mastered') earnedTransitions.push('learning_reviewing');
    if (status === 'Mastered') earnedTransitions.push('reviewing_mastered');
    earnedTransitions = [...new Set(earnedTransitions)];
  }
  return {
    mastery_status: status,
    mastery_streak: rawStreak,
    last_recalled_at: word.last_recalled_at || word.lastRecalledAt || null,
    first_recalled_at: word.first_recalled_at || word.firstRecalledAt || null,
    last_recall_day: word.last_recall_day || word.lastRecallDay || '',
    last_recall_session_id: word.last_recall_session_id || word.lastRecallSessionId || '',
    last_quizzed_at: word.last_quizzed_at || word.lastQuizzedAt || null,
    quiz_seen_count: Math.max(0, Number(word.quiz_seen_count ?? word.quizSeenCount ?? 0) || 0),
    mastered_once: Boolean(
      word.mastered_once || word.masteredOnce || status === 'Mastered'
    ),
    firstMasteredAt: word.firstMasteredAt || (status === 'Mastered' ? (word.last_recalled_at || null) : null),
    hasEarnedMasteryXP: Boolean(word.hasEarnedMasteryXP || status === 'Mastered'),
    earnedTransitions,
    remasteryAwardCount: Math.max(0, Number(word.remasteryAwardCount) || 0),
    xpEconomyVersion: XP_ECONOMY_VERSION,
  };
}

function mergePermanentWordMasteryState(existing, incoming) {
  const previous = existing ? getInlineWordMasteryState(existing) : null;
  const next = getInlineWordMasteryState(incoming || {});
  if (!previous) return next;
  next.mastered_once = Boolean(previous.mastered_once || next.mastered_once);
  next.firstMasteredAt = previous.firstMasteredAt || next.firstMasteredAt || null;
  next.hasEarnedMasteryXP = Boolean(
    previous.hasEarnedMasteryXP || next.hasEarnedMasteryXP
  );
  next.earnedTransitions = Array.from(new Set([
    ...(previous.earnedTransitions || []),
    ...(next.earnedTransitions || []),
  ])).slice(0, 8);
  next.remasteryAwardCount = Math.max(
    Number(previous.remasteryAwardCount) || 0,
    Number(next.remasteryAwardCount) || 0
  );
  return next;
}

function getWordMasteryStorageKey(uid) {
  return WORD_MASTERY_STORAGE_PREFIX + getStorageUserId(uid);
}

function readSharedWordMasteryStore(uid) {
  return loadJSON(getWordMasteryStorageKey(uid), {});
}

function writeSharedWordMasteryStore(entries, uid) {
  localStorage.setItem(getWordMasteryStorageKey(uid), JSON.stringify(entries && typeof entries === 'object' ? entries : {}));
  if (!hasSignedInUser() && typeof markGuestDataDirty === 'function') markGuestDataDirty();
}

function getWordMasteryKey(wordOrText) {
  const text = typeof wordOrText === 'object'
    ? (wordOrText.word || wordOrText.text || '')
    : wordOrText;
  return normalizeWord(text)
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

function masteryProgressScore(state = {}) {
  const statusScore = { New: 0, Learning: 10, Reviewing: 20, Mastered: 30 }[state.mastery_status] || 0;
  return statusScore * 1e12 + (Number(state.mastery_streak) || 0) * 1e9 + (Number(state.last_quizzed_at || state.last_recalled_at) || 0);
}

function getBestKnownMasteryState(wordOrText) {
  const key = getWordMasteryKey(wordOrText);
  if (!key) return null;
  const stored = readSharedWordMasteryStore()[key];
  if (stored) return getInlineWordMasteryState(stored);
  const uid = window.auth?.currentUser?.uid;
  const allCopies = [
    ...readWordsFromStorage('normal', uid),
    ...customWorlds.flatMap(world => readCustomWorldWordsFromStorage(world.id, uid))
  ].filter(word => getWordMasteryKey(word) === key);
  if (!allCopies.length) return null;
  return allCopies
    .map(getInlineWordMasteryState)
    .sort((a, b) => masteryProgressScore(b) - masteryProgressScore(a))[0];
}

function applyMasteryStateToWord(word, state) {
  return { ...word, ...getInlineWordMasteryState(state) };
}

function applyKnownSharedMastery(word) {
  const known = getBestKnownMasteryState(word);
  return known ? applyMasteryStateToWord(word, known) : word;
}

function getWordMasteryState(word = {}) {
  return getBestKnownMasteryState(word) || getInlineWordMasteryState(word);
}

window.getSharedWordMasteryByKey = function(wordKey) {
  const key = String(wordKey || '');
  if (!key) return null;
  const stored = readSharedWordMasteryStore()[key];
  return stored ? getInlineWordMasteryState(stored) : null;
};

function masteryStateFingerprint(state) {
  return JSON.stringify(getInlineWordMasteryState(state || {}), (_key, value) => {
    if (value?.toMillis && typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return value;
  });
}

function masteryStatesEqual(left, right) {
  return masteryStateFingerprint(left) === masteryStateFingerprint(right);
}

function applyMasteryBatchToWords(words, masteryUpdates, directUpdates) {
  let changed = false;
  const cloudWords = [];
  const nextWords = (Array.isArray(words) ? words : []).map((word) => {
    const direct = directUpdates?.get(String(word?.id));
    const base = direct ? { ...word, ...direct } : word;
    const mastery = masteryUpdates.get(getWordMasteryKey(base));
    if (!direct && !mastery) return word;
    const next = mastery ? applyMasteryStateToWord(base, mastery) : base;
    cloudWords.push(next);
    if (JSON.stringify(next) === JSON.stringify(word)) return word;
    changed = true;
    return next;
  });
  return { words: changed ? nextWords : words, changed, cloudWords };
}

function applyMasteryUpdatesAcrossLocalCopies(masteryUpdates, options = {}) {
  const uid = options.uid;
  const currentMastery = options.currentMastery || readSharedWordMasteryStore(uid);
  const nextMastery = { ...currentMastery };
  let masteryChanged = false;
  masteryUpdates.forEach((state, key) => {
    if (!masteryStatesEqual(nextMastery[key], state)) masteryChanged = true;
    nextMastery[key] = state;
  });
  if (masteryChanged) writeSharedWordMasteryStore(nextMastery, uid);

  const directPersonal = options.directPersonal || new Map();
  const directCustom = options.directCustom || new Map();
  const worldIds = new Set((Array.isArray(customWorlds) ? customWorlds : []).map((world) => String(world.id)));
  directCustom.forEach((_updates, worldId) => worldIds.add(String(worldId)));
  const batchToken = window.beginQuizSourceDataChangeBatch?.(uid);
  let personalResult;
  const worldResults = new Map();
  let localWordWrites = 0;
  try {
    personalResult = applyMasteryBatchToWords(
      readWordsFromStorage('normal', uid),
      masteryUpdates,
      directPersonal
    );
    if (personalResult.changed && writeWordsToStorage(personalResult.words, 'normal', uid)) localWordWrites += 1;
    worldIds.forEach((worldId) => {
      const result = applyMasteryBatchToWords(
        readCustomWorldWordsFromStorage(worldId, uid),
        masteryUpdates,
        directCustom.get(worldId) || new Map()
      );
      worldResults.set(worldId, result);
      if (result.changed && writeCustomWorldWordsToStorage(worldId, result.words, uid)) localWordWrites += 1;
    });
  } finally {
    window.endQuizSourceDataChangeBatch?.(batchToken);
  }

  if (isEditableDictionaryView()) {
    if (isCustomWorldView()) {
      const activeResult = worldResults.get(String(activeCustomWorldId));
      if (activeResult?.changed) window.words = activeResult.words;
    } else if (personalResult?.changed) {
      window.words = personalResult.words;
    }
  }
  return {
    masteryChanged,
    localWordWrites,
    fullDatasetPasses: 1 + worldIds.size,
    personalCloudWords: personalResult?.cloudWords || [],
    worldResults,
  };
}

window.applyQuizLearningBatch = async function(transitionEntries = [], options = {}) {
  const entries = Array.isArray(transitionEntries) ? transitionEntries : [];
  const uid = window.auth?.currentUser?.uid;
  const ownerId = getStorageUserId(uid);
  const trace = options.trace;
  const masteryStore = readSharedWordMasteryStore(uid);
  const masteryUpdates = new Map();
  const directPersonal = new Map();
  const directCustom = new Map();
  trace?.count('masteryStoreReads');
  trace?.stage('mastery-update-start', { transitionCount: entries.length, ownerId });
  window.LootLinguaOperations?.diagnostic?.('mastery-update-start', { transitionCount: entries.length, ownerId });

  entries.forEach(({ word, result, update }) => {
    const wordKey = getWordMasteryKey(word);
    if (!wordKey || !word?.id || !update?.state) return;
    const previous = masteryUpdates.get(wordKey) || masteryStore[wordKey];
    const state = mergePermanentWordMasteryState(previous, update.state);
    masteryUpdates.set(wordKey, state);
    const forgetCount = result?.correct
      ? Math.max((Number(word.forgetCount) || 0) - 1, 0)
      : (Number(word.forgetCount) || 0) + 1;
    const updatedWord = applyMasteryStateToWord({ ...word, ...update.state, forgetCount }, state);
    const source = String(word.quizSource || options.source || currentQuizSource || 'personal');
    if (source.startsWith('custom:')) {
      const worldId = source.slice(7);
      if (!directCustom.has(worldId)) directCustom.set(worldId, new Map());
      directCustom.get(worldId).set(String(word.id), updatedWord);
    } else {
      directPersonal.set(String(word.id), updatedWord);
    }
  });

  const local = applyMasteryUpdatesAcrossLocalCopies(masteryUpdates, {
    uid,
    currentMastery: masteryStore,
    directPersonal,
    directCustom,
  });
  trace?.count('masteryStoreWrites', local.masteryChanged ? 1 : 0);
  trace?.count('localWordWrites', local.localWordWrites);
  trace?.count('fullDatasetPasses', local.fullDatasetPasses);
  trace?.stage('local-state-update', {
    masteryKeys: masteryUpdates.size,
    localWordWrites: local.localWordWrites,
    fullDatasetPasses: local.fullDatasetPasses,
  });
  window.LootLinguaOperations?.diagnostic?.('local-state-update', {
    ownerId,
    masteryKeys: masteryUpdates.size,
    localWordWrites: local.localWordWrites,
    fullDatasetPasses: local.fullDatasetPasses,
  });

  let cloud = { saved: true, firestoreWrites: 0, skipped: true };
  if (uid) {
    if (window.auth?.currentUser?.uid !== uid) {
      const error = new Error('Quiz owner changed while committing learning state.');
      error.code = 'quiz-learning/stale-owner';
      throw error;
    }
    if (typeof window.commitQuizLearningBatchToCloud !== 'function') {
      const error = new Error('Quiz learning cloud writer is unavailable.');
      error.code = 'quiz-learning/cloud-writer-unavailable';
      throw error;
    }
    const customWords = [];
    local.worldResults.forEach((result, worldId) => {
      result.cloudWords.forEach((word) => customWords.push({ worldId, id: word.id, data: word }));
    });
    trace?.stage('mastery-cloud-write-start', {
      personalWords: local.personalCloudWords.length,
      customWords: customWords.length,
      masteryKeys: masteryUpdates.size,
    });
    cloud = await window.commitQuizLearningBatchToCloud({
      ownerId: uid,
      masteryEntries: Object.fromEntries(masteryUpdates),
      personalWords: local.personalCloudWords.map((word) => ({ id: word.id, data: word })),
      customWords,
    });
    if (cloud?.saved !== true) {
      const error = new Error('Quiz learning cloud batch was not saved.');
      error.code = cloud?.stale ? 'quiz-learning/stale-owner' : 'quiz-learning/cloud-save-failed';
      throw error;
    }
    trace?.count('firestoreWrites', cloud.firestoreWrites || 0);
    trace?.stage('mastery-cloud-write-end', cloud);
  }
  trace?.stage('mastery-update-end', {
    masteryKeys: masteryUpdates.size,
    localWordWrites: local.localWordWrites,
    cloudWrites: cloud.firestoreWrites || 0,
  });
  window.LootLinguaOperations?.diagnostic?.('mastery-update-end', {
    ownerId,
    masteryKeys: masteryUpdates.size,
    localWordWrites: local.localWordWrites,
    cloudWrites: cloud.firestoreWrites || 0,
  });
  return { ...local, cloud, masteryKeys: masteryUpdates.size };
};

function propagateMasteryStateAcrossAccount(wordText, state, options = {}) {
  const key = getWordMasteryKey(wordText);
  if (!key) return;
  const uid = window.auth?.currentUser?.uid;
  const entries = readSharedWordMasteryStore(uid);
  const normalizedState = mergePermanentWordMasteryState(entries[key], state);
  const local = applyMasteryUpdatesAcrossLocalCopies(new Map([[key, normalizedState]]), {
    uid,
    currentMastery: entries,
  });
  if (!options.skipMetaSave) window.saveGlobalWordMasteryToCloud?.(key, normalizedState);

  if (!hasSignedInUser() || options.skipCloudCopies) return;
  local.personalCloudWords.forEach((word) => {
    if (options.cloudOwner?.type === 'personal' && String(options.cloudOwner.id) === String(word.id)) return;
    window.updateWordInCloud?.(word.id, normalizedState);
  });
  local.worldResults.forEach((result, worldId) => {
    result.cloudWords.forEach((word) => {
      if (
        options.cloudOwner?.type === 'custom' &&
        String(options.cloudOwner.worldId) === String(worldId) &&
        String(options.cloudOwner.id) === String(word.id)
      ) return;
      window.updateCustomWorldWordInCloud?.(worldId, word.id, normalizedState);
    });
  });
}

let globalMasterySnapshotCache = { ownerId: '', fingerprints: new Map() };

window.addEventListener?.('lootlingua:auth-state', (event) => {
  globalMasterySnapshotCache = {
    ownerId: event?.detail?.user?.uid || 'guest',
    fingerprints: new Map(),
  };
});

window.applyGlobalWordMasterySnapshot = function(entries) {
  if (!entries || typeof entries !== 'object') return;
  const uid = window.auth?.currentUser?.uid;
  const ownerId = getStorageUserId(uid);
  if (globalMasterySnapshotCache.ownerId !== ownerId) {
    globalMasterySnapshotCache = { ownerId, fingerprints: new Map() };
  }
  const current = readSharedWordMasteryStore(uid);
  const changed = new Map();
  Object.entries(entries).forEach(([key, state]) => {
    const incomingFingerprint = masteryStateFingerprint(state);
    const merged = mergePermanentWordMasteryState(current[key], state);
    const alreadySeen = globalMasterySnapshotCache.fingerprints.get(key) === incomingFingerprint;
    globalMasterySnapshotCache.fingerprints.set(key, incomingFingerprint);
    if (alreadySeen && masteryStatesEqual(current[key], merged)) return;
    if (!masteryStatesEqual(current[key], merged)) changed.set(key, merged);
  });
  let local = { localWordWrites: 0, fullDatasetPasses: 0 };
  if (changed.size > 0) {
    local = applyMasteryUpdatesAcrossLocalCopies(changed, { uid, currentMastery: current });
    if (isEditableDictionaryView()) render();
  }
  window.LootLinguaOperations?.diagnostic?.('mastery-snapshot-callback', {
    ownerId,
    receivedKeys: Object.keys(entries).length,
    changedKeys: changed.size,
    localWordWrites: local.localWordWrites,
  });
  window.dispatchEvent(new CustomEvent('lootlingua:word-mastery-snapshot', {
    detail: { wordKeys: [...changed.keys()], uid: ownerId },
  }));
};

function getQuizExposureHistoryStorageKey(uid) {
  return QUIZ_EXPOSURE_HISTORY_PREFIX + getStorageUserId(uid);
}

function readQuizExposureHistory(uid) {
  const history = loadJSON(getQuizExposureHistoryStorageKey(uid), []);
  return Array.isArray(history) ? history.slice(0, 3) : [];
}

function writeQuizExposureHistory(history, uid) {
  localStorage.setItem(
    getQuizExposureHistoryStorageKey(uid),
    JSON.stringify(Array.isArray(history) ? history.slice(0, 3) : [])
  );
}

function recordQuizExposureSession(sessionId, words, options = {}) {
  if (!sessionId || !Array.isArray(words) || !words.length) return;
  const wordKeys = [...new Set(words.map(getWordMasteryKey).filter(Boolean))];
  if (!wordKeys.length) return;
  const mode = options.mode === 'flashcards' ? 'flashcards' : 'verified';
  const outcomes = options.outcomes instanceof Map ? options.outcomes : new Map();
  const wordExposures = wordKeys.map(wordKey => ({
    wordKey,
    outcome: mode === 'flashcards' ? (outcomes.get(wordKey) || 'seen') : 'verified',
  }));
  const history = readQuizExposureHistory().filter(entry => String(entry?.sessionId) !== String(sessionId));
  writeQuizExposureHistory([{
    sessionId: String(sessionId),
    at: Date.now(),
    mode,
    wordKeys,
    wordExposures,
  }, ...history].slice(0, 3));
  if (!hasSignedInUser()) markGuestDataDirty();
  requestProfileCloudSave();
}

function recordFlashcardExposureOutcome(word, outcome) {
  if (currentQuizExposureMode !== 'flashcards') return;
  const wordKey = getWordMasteryKey(word);
  if (!wordKey) return;
  if (flashcardSessionOutcomes.get(wordKey) === 'forgotten') return;
  flashcardSessionOutcomes.set(wordKey, outcome === 'forgotten' ? 'forgotten' : 'remembered');
}

function getWordStateForQueue(word = {}) {
  return getWordMasteryState(word).mastery_status;
}

function getMasteryLevel(word = {}) {
  const state = getWordMasteryState(word);
  return state.mastery_status === 'Mastered' ? 3 : Math.max(0, Math.min(2, state.mastery_streak || 0));
}

function getMasteryLabel(word = {}) {
  const state = getWordMasteryState(word);
  if (state.mastery_status === 'Mastered') return 'متقنة';
  if (state.mastery_streak >= 2) return 'قريبة من الإتقان';
  if (state.mastery_streak >= 1) return 'قيد التعلم';
  return 'جديدة';
}

function renderMasteryIndicator(word = {}) {
  const level = getMasteryLevel(word);
  const label = getMasteryLabel(word);
  const dots = [1, 2, 3].map(i => `<span class="mastery-dot${i <= level ? ' filled' : ''}" aria-hidden="true"></span>`).join('');
  const id = sugAttr(String(word.id || ''));
  return `<span class="mastery-meter mastery-${level}" role="button" tabindex="0" data-word-id="${id}" onclick="showWordMasteryPopover(event, '${id}')" onkeydown="if(event.key==='Enter'||event.key===' '){showWordMasteryPopover(event, '${id}')}" title="الإتقان: ${escapeHtml(label)}" aria-label="الإتقان: ${escapeHtml(label)}">${dots}</span>`;
}

window.showMasteryHelp = function(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  document.getElementById('masteryHelpPopover')?.remove();
  unlockBackgroundScroll('masteryHelp');
  const pop = document.createElement('div');
  pop.id = 'masteryHelpPopover';
  pop.className = 'mastery-help-popover';
  pop.innerHTML = `
    <button type="button" class="mastery-help-close" aria-label="إغلاق"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    <strong>كيف يعني إتقان كلمة؟</strong>
    <p>كل كلمة عندها 3 نقاط. لما تجاوبها صح في اختبار موثّق وعلى يوم/جلسة مختلفة ترتفع نقطة. إذا وصلت 3 نقاط وبعد مرور 72 ساعة من أول مراجعة صحيحة، تصير الكلمة متقنة.</p>
    <p>إذا غلطت، المؤشر ينزل درجة. الكلمة المتقنة تحتاج خطأين عشان ترجع للصفر.</p>
  `;
  document.body.appendChild(pop);
  pop.innerHTML = `
    <button type="button" class="mastery-help-close" aria-label="إغلاق"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    <strong>كيف تفتح XP الصندوق؟</strong>
    <p>أتقن كلمتين جديدتين من الاختبار، أو أنهِ اختبارين موثقين بدقة 90% أو أكثر.</p>
    <p>الإتقان يتقدم على مراحل وفي جلسات/أيام مختلفة. إجابة صحيحة واحدة لا تكفي وحدها.</p>
  `;
  lockBackgroundScroll('masteryHelp');
  const target = event?.currentTarget || event?.target;
  const rect = target?.getBoundingClientRect?.();
  const top = rect ? rect.bottom + 8 : 90;
  const left = rect ? Math.min(window.innerWidth - 18, Math.max(18, rect.left + rect.width / 2)) : window.innerWidth / 2;
  pop.style.top = `${Math.min(top, window.innerHeight - 24)}px`;
  pop.style.left = `${left}px`;
  const cleanupMasteryHelp = () => {
    pop.remove();
    unlockBackgroundScroll('masteryHelp');
  };
  pop.querySelector('.mastery-help-close')?.addEventListener('click', cleanupMasteryHelp);
  setTimeout(() => {
    const close = (e) => {
      if (!pop.contains(e.target)) {
        cleanupMasteryHelp();
        document.removeEventListener('pointerdown', close, true);
      }
    };
    document.addEventListener('pointerdown', close, true);
  }, 0);
};

window.showWordMasteryPopover = function(event, wordId) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  document.getElementById('wordMasteryPopover')?.remove();
  unlockBackgroundScroll('wordMasteryHelp');
  const id = decodeSugAttr(wordId || event?.currentTarget?.dataset?.wordId || '');
  const word = (window.words || []).find(w => String(w.id) === id) ||
    (currentQuizWords || []).find(w => String(w.id) === id) || {};
  const state = getWordMasteryState(word);
  const level = getMasteryLevel(word);
  const label = getMasteryLabel(word);
  const nextText = state.mastery_status === 'Mastered'
    ? 'هذه الكلمة متقنة. ستظهر لاحقا كمراجعة متباعدة حتى تثبتها.'
    : level === 0
      ? 'أجب عنها صح في اختبار موثق في يوم مختلف لتنتقل إلى قيد التعلم وتحصل XP بسيط.'
      : level === 1
        ? 'أجب عنها صح مرة أخرى في يوم/جلسة مختلفة لتصبح قريبة من الإتقان وتحصل XP أعلى.'
        : 'بعد مرور 72 ساعة من أول إجابة صحيحة، إجابة صحيحة جديدة تجعلها متقنة وتعطي مكافأة الإتقان.';
  const pop = document.createElement('div');
  pop.id = 'wordMasteryPopover';
  pop.className = 'word-mastery-popover';
  pop.innerHTML = `
    <strong>${escapeHtml(label)}</strong>
    <p>${escapeHtml(nextText)}</p>
  `;
  document.body.appendChild(pop);
  lockBackgroundScroll('wordMasteryHelp');
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  const width = Math.min(300, window.innerWidth - 24);
  pop.style.maxWidth = `${width}px`;
  const popRect = pop.getBoundingClientRect();
  const top = rect ? rect.top - popRect.height - 10 : 90;
  const left = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  pop.style.top = `${Math.max(12, Math.min(top, window.innerHeight - popRect.height - 12))}px`;
  pop.style.left = `${Math.max(12 + popRect.width / 2, Math.min(left, window.innerWidth - 12 - popRect.width / 2))}px`;
  const cleanupWordMasteryHelp = () => {
    pop.remove();
    unlockBackgroundScroll('wordMasteryHelp');
  };
  setTimeout(() => {
    const close = (e) => {
      if (!pop.contains(e.target) && !event?.currentTarget?.contains?.(e.target)) {
        cleanupWordMasteryHelp();
        document.removeEventListener('pointerdown', close, true);
      }
    };
    document.addEventListener('pointerdown', close, true);
  }, 0);
};
