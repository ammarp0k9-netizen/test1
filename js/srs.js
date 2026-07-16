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
    mastered_once: Boolean(word.mastered_once || word.masteredOnce),
    firstMasteredAt: word.firstMasteredAt || (status === 'Mastered' ? (word.last_recalled_at || null) : null),
    hasEarnedMasteryXP: Boolean(word.hasEarnedMasteryXP || status === 'Mastered'),
    earnedTransitions,
    remasteryAwardCount: Math.max(0, Number(word.remasteryAwardCount) || 0),
    xpEconomyVersion: XP_ECONOMY_VERSION,
  };
}

function getWordMasteryStorageKey(uid) {
  return WORD_MASTERY_STORAGE_PREFIX + getStorageUserId(uid);
}

function readSharedWordMasteryStore(uid) {
  return loadJSON(getWordMasteryStorageKey(uid), {});
}

function writeSharedWordMasteryStore(entries, uid) {
  localStorage.setItem(getWordMasteryStorageKey(uid), JSON.stringify(entries && typeof entries === 'object' ? entries : {}));
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

function propagateMasteryStateAcrossAccount(wordText, state, options = {}) {
  const key = getWordMasteryKey(wordText);
  if (!key) return;
  const normalizedState = getInlineWordMasteryState(state);
  const uid = window.auth?.currentUser?.uid;
  const entries = readSharedWordMasteryStore(uid);
  entries[key] = normalizedState;
  writeSharedWordMasteryStore(entries, uid);
  if (!options.skipMetaSave) window.saveGlobalWordMasteryToCloud?.(key, normalizedState);

  const updateCopies = (words) => (Array.isArray(words) ? words : []).map((word) =>
    getWordMasteryKey(word) === key ? applyMasteryStateToWord(word, normalizedState) : word
  );
  const personal = updateCopies(readWordsFromStorage('normal', uid));
  writeWordsToStorage(personal, 'normal', uid);
  const worldCopies = new Map();
  customWorlds.forEach((world) => {
    const worldWords = updateCopies(readCustomWorldWordsFromStorage(world.id, uid));
    worldCopies.set(String(world.id), worldWords);
    writeCustomWorldWordsToStorage(world.id, worldWords, uid);
  });
  if (isEditableDictionaryView()) window.words = updateCopies(window.words);

  if (!hasSignedInUser() || options.skipCloudCopies) return;
  personal.forEach((word) => {
    if (getWordMasteryKey(word) === key) window.updateWordInCloud?.(word.id, normalizedState);
  });
  worldCopies.forEach((worldWords, worldId) => {
    worldWords.forEach((word) => {
      if (getWordMasteryKey(word) === key) {
        window.updateCustomWorldWordInCloud?.(worldId, word.id, normalizedState);
      }
    });
  });
}

window.applyGlobalWordMasterySnapshot = function(entries) {
  if (!entries || typeof entries !== 'object') return;
  const current = readSharedWordMasteryStore();
  writeSharedWordMasteryStore({ ...current, ...entries });
  Object.entries(entries).forEach(([key, state]) => {
    const word = [
      ...readWordsFromStorage('normal'),
      ...customWorlds.flatMap(world => readCustomWorldWordsFromStorage(world.id))
    ].find(item => getWordMasteryKey(item) === key);
    if (word) propagateMasteryStateAcrossAccount(word.word || word.text, state, { skipMetaSave: true, skipCloudCopies: true });
  });
  if (isEditableDictionaryView()) render();
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

