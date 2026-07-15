function getQuizDay(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function makeQuizSessionId() {
  return `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isVerifiedQuizMode(mode) {
  return mode === 'timeAttack' || mode === 'scramble';
}

const QUIZ_MODE_META = {
  flashcards: {
    title: 'بطاقات الذاكرة',
    desc: 'اختبار هادئ: اقلب البطاقة وحدد إذا تذكرت الكلمة أو نسيتها.'
  },
  timeAttack: {
    title: 'الهروب من النسيان',
    desc: 'اختيار من متعدد بسرعة. الوقت ضدك والـ HP معك.'
  },
  scramble: {
    title: 'الصندوق المشفر',
    desc: SCRAMBLE_DIRECTION_COPY['ar-to-en']
  }
};

function getScrambleDirectionText(direction = scrambleDirection) {
  return SCRAMBLE_DIRECTION_COPY[direction] || SCRAMBLE_DIRECTION_COPY['ar-to-en'];
}

function syncScrambleDirectionCopy() {
  const text = getScrambleDirectionText();
  if (selectedQuizMode === 'scramble') {
    const desc = document.getElementById('quizSettingsDesc');
    if (desc) desc.textContent = text;
  }
  const cover = document.getElementById('scrambleModeCoverDesc');
  if (cover) cover.textContent = text;
}

function warnIfTooFewStarredQuizWords(count = getQuizSourceWords('starred').length) {
  if (count > 0) return false;
  showToast('ما عندك كلمات صعبة معلّمة بالنجمة حالياً. علّم كلماتك الصعبة أولاً.', 'warning', 5600);
  return true;
}

function openQuizSetup() {
  loadQuizView();
}

function hideQuizPlayPanels() {
  ['quizViewCard', 'quizTimeAttackView', 'quizScrambleView', 'quizSettingsPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function suppressStrayQuizUi() {
  if (currentView === 'quiz') return;
  stopTimeAttackTimer();
  hideQuizPlayPanels();
  hideQuizResumePrompt();
  hideQuizExitPrompts();
  setQuizImmersive(false);
}

document.addEventListener('focusin', (e) => {
  if (currentView === 'quiz') return;
  if (e.target?.closest?.('#personalControls, #wordHunterModal')) suppressStrayQuizUi();
});

function setQuizImmersive(active) {
  document.body.classList.toggle('quiz-active', Boolean(active));
}

function serializeActiveQuizSession() {
  if (!activeQuizSession) return null;
  return {
    ...activeQuizSession,
    quizIndex,
    currentStreak,
    currentQuizMistakes,
    timeAttackHp,
    quizSessionResults,
    hasStartedAnswering
  };
}

function saveActiveQuizSession() {
  const session = serializeActiveQuizSession();
  if (!session || !isVerifiedQuizMode(session.mode)) return;
  if (hasSignedInUser()) {
    window.saveActiveQuizSessionToCloud?.(session);
  } else {
    localStorage.setItem(ACTIVE_QUIZ_SESSION_KEY, JSON.stringify(session));
  }
}

async function loadStoredActiveQuizSession() {
  if (hasSignedInUser() && typeof window.loadActiveQuizSessionFromCloud === 'function') {
    return await window.loadActiveQuizSessionFromCloud();
  }
  return loadJSON(ACTIVE_QUIZ_SESSION_KEY, null);
}

function isResumableQuizSession(session) {
  if (!session || !isVerifiedQuizMode(session.mode) || !Array.isArray(session.words) || !session.words.length) return false;
  const index = Math.max(0, Number(session.quizIndex) || 0);
  if (index >= session.words.length) return false;
  if (session.completedAt || session.finishedAt) return false;
  return true;
}

function clearActiveQuizSessionStorage() {
  localStorage.removeItem(ACTIVE_QUIZ_SESSION_KEY);
  if (hasSignedInUser()) window.clearActiveQuizSessionFromCloud?.();
}

function showQuizResumePrompt() {
  const modal = document.getElementById('quizResumeModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('show');
  }
}

function hideQuizResumePrompt() {
  const modal = document.getElementById('quizResumeModal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = '';
  }
}

function getQuizExitModalId() {
  return hasStartedAnswering ? 'quizForfeitModal' : 'quizExitSafeModal';
}

function hideQuizExitPrompts() {
  ['quizExitSafeModal', 'quizForfeitModal'].forEach((id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = '';
  });
}

function completeQuizExitNavigation() {
  const target = pendingQuizExitTarget || 'quiz';
  pendingQuizExitTarget = 'quiz';
  if (target === 'personal') loadPersonalDictionary();
  else showQuizModes({ force: true });
}

window.requestQuizExit = function(target = 'quiz') {
  if (!activeQuizSession || !isVerifiedQuizMode(activeQuizSession.mode)) {
    if (target === 'personal') loadPersonalDictionary();
    else showQuizModes({ force: true });
    return;
  }
  pendingQuizExitTarget = target;
  hideQuizResumePrompt();
  hideQuizExitPrompts();
  const modal = document.getElementById(getQuizExitModalId());
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('show');
  }
};

window.cancelQuizExitPrompt = function() {
  hideQuizExitPrompts();
  pendingQuizExitTarget = 'quiz';
  if (activeQuizSession && isVerifiedQuizMode(activeQuizSession.mode)) {
    setQuizImmersive(true);
    saveActiveQuizSession();
  }
};

window.confirmQuizExitWithoutLoss = function() {
  hideQuizExitPrompts();
  stopTimeAttackTimer();
  quizSessionResults = [];
  hasStartedAnswering = false;
  clearActiveQuizSessionStorage();
  window.__pendingQuizResumeSession = null;
  resetRuntimeQuizState();
  showToast('تم الخروج بدون خسارة لأنك لم تبدأ الحل.', 'info', 3200);
  completeQuizExitNavigation();
};

window.confirmQuizForfeit = function() {
  hideQuizExitPrompts();
  window.forfeitActiveQuizSession();
};

function resetRuntimeQuizState() {
  stopTimeAttackTimer();
  quizIndex = 0;
  currentQuizWords = [];
  currentStreak = 0;
  currentQuizMistakes = 0;
  timeAttackHp = 0;
  activeQuizSession = null;
  currentQuizExposureSessionId = '';
  currentQuizExposureMode = '';
  flashcardSessionOutcomes = new Map();
  quizSessionResults = [];
  hasStartedAnswering = false;
  setQuizImmersive(false);
}

function applyStoredQuizSession(session) {
  if (!isResumableQuizSession(session)) return false;
  activeQuizSession = {
    id: session.id || makeQuizSessionId(),
    mode: session.mode,
    source: session.source || 'personal',
    createdAt: session.createdAt || Date.now(),
    words: session.words,
    pool: Array.isArray(session.pool) && session.pool.length ? session.pool : session.words,
    questionCount: session.questionCount || session.words.length,
    direction: session.direction || {}
  };
  currentQuizExposureSessionId = activeQuizSession.id;
  currentQuizExposureMode = 'verified';
  flashcardSessionOutcomes = new Map();
  selectedQuizMode = activeQuizSession.mode;
  currentQuizSource = activeQuizSession.source;
  currentQuizWords = activeQuizSession.words;
  currentQuizPool = activeQuizSession.pool;
  quizIndex = Math.max(0, Math.min(Number(session.quizIndex) || 0, currentQuizWords.length));
  currentStreak = Number(session.currentStreak) || 0;
  currentQuizMistakes = Number(session.currentQuizMistakes) || 0;
  timeAttackHp = Number(session.timeAttackHp) || 3;
  quizSessionResults = Array.isArray(session.quizSessionResults) ? session.quizSessionResults : [];
  hasStartedAnswering = Boolean(session.hasStartedAnswering);
  if (activeQuizSession.direction?.timeAttack) timeAttackDirection = activeQuizSession.direction.timeAttack;
  if (activeQuizSession.direction?.scramble) scrambleDirection = activeQuizSession.direction.scramble;
  return true;
}

window.resumeActiveQuizSession = function() {
  hideQuizResumePrompt();
  if (!activeQuizSession && window.__pendingQuizResumeSession) {
    applyStoredQuizSession(window.__pendingQuizResumeSession);
  }
  if (!activeQuizSession) return;
  hideQuizPlayPanels();
  document.getElementById('quizViewSetup').style.display = 'none';
  const exitBtn = document.querySelector('#quizView .quiz-exit-btn');
  if (exitBtn) exitBtn.style.display = 'none';
  setQuizImmersive(true);
  if (activeQuizSession.mode === 'timeAttack') {
    document.getElementById('quizTimeAttackView').style.display = 'block';
    renderTimeAttackQuestion();
  } else {
    document.getElementById('quizScrambleView').style.display = 'block';
    updateScrambleCard();
  }
};

window.forfeitActiveQuizSession = function() {
  hideQuizResumePrompt();
  hideQuizExitPrompts();
  stopTimeAttackTimer();
  quizSessionResults = [];
  hasStartedAnswering = false;
  clearActiveQuizSessionStorage();
  window.__pendingQuizResumeSession = null;
  resetRuntimeQuizState();
  showToast('تم إلغاء المحاولة. لم يتم حفظ أي XP أو تقدم للكلمات، وصندوق الـ XP بقي مقفولاً.', 'warning', 5200);
  completeQuizExitNavigation();
};

function stopTimeAttackTimer() {
  if (timeAttackTimer) {
    clearInterval(timeAttackTimer);
    timeAttackTimer = null;
  }
}

function cleanupQuizSessionIfActive() {
  if (currentView !== 'quiz') return;
  resetRuntimeQuizState();
  hideQuizPlayPanels();
  const setup = document.getElementById('quizViewSetup');
  if (setup) setup.style.display = 'block';
  const exitBtn = document.querySelector('#quizView .quiz-exit-btn');
  if (exitBtn) exitBtn.style.display = 'flex';
}

function showQuizModes(options = {}) {
  if (!options.force && activeQuizSession && isVerifiedQuizMode(activeQuizSession.mode) && currentQuizWords.length) {
    window.requestQuizExit();
    return;
  }
  stopTimeAttackTimer();
  setQuizImmersive(false);
  hideQuizPlayPanels();
  const setup = document.getElementById('quizViewSetup');
  if (setup) setup.style.display = 'block';
  const exitBtn = document.querySelector('#quizView .quiz-exit-btn');
  if (exitBtn) exitBtn.style.display = 'flex';
  syncQuizSourceOptions();
  refreshQuizAvailableCount();
}

function closeQuizSetup() {
  showQuizModes();
}

function openQuizModeSettings(mode) {
  syncQuizSourceOptions();
  selectedQuizMode = QUIZ_MODE_META[mode] ? mode : 'flashcards';
  const exitBtn = document.querySelector('#quizView .quiz-exit-btn');
  if (exitBtn) exitBtn.style.display = 'none';
  document.getElementById('quizViewSetup').style.display = 'none';
  document.getElementById('quizSettingsPanel').style.display = 'block';
  document.getElementById('quizSettingsTitle').textContent = QUIZ_MODE_META[selectedQuizMode].title;
  document.getElementById('quizSettingsDesc').textContent = QUIZ_MODE_META[selectedQuizMode].desc;
  syncScrambleDirectionCopy();
  const isFlashcards = selectedQuizMode === 'flashcards';
  document.getElementById('flashcardPresetOptions').style.display = isFlashcards ? 'block' : 'none';
  document.getElementById('quizSharedSettings').style.display = 'block';
  document.getElementById('timeAttackDirectionGroup').style.display = selectedQuizMode === 'timeAttack' ? 'block' : 'none';
  document.getElementById('scrambleDirectionGroup').style.display = selectedQuizMode === 'scramble' ? 'block' : 'none';
  refreshQuizSettingsSummary();
}

function setQuizQuestionCount(count, btn) {
  quizQuestionCount = count;
  document.querySelectorAll('[data-quiz-count]').forEach(el => {
    el.classList.toggle('active', el === btn);
  });
  refreshQuizSettingsSummary();
}

function setTimeAttackDirection(direction, btn) {
  timeAttackDirection = direction === 'en-to-ar' ? 'en-to-ar' : 'ar-to-en';
  document.querySelectorAll('[data-time-direction]').forEach(el => {
    el.classList.toggle('active', el === btn);
  });
  refreshQuizSettingsSummary();
}

function setScrambleDirection(direction, btn) {
  scrambleDirection = direction === 'en-to-ar' ? 'en-to-ar' : 'ar-to-en';
  document.querySelectorAll('[data-scramble-direction]').forEach(el => {
    el.classList.toggle('active', el === btn);
  });
  syncScrambleDirectionCopy();
  refreshQuizSettingsSummary();
}

function getQuizSourceLabel(scope = currentQuizSource) {
  if (scope === 'starred') return 'الكلمات الصعبة';
  if (String(scope).startsWith('custom:')) {
    const id = String(scope).slice(7);
    const world = customWorlds.find(item => String(item.id) === id);
    return world ? `${world.emoji || '📘'} ${world.name || 'عالم خاص'}` : 'عالم خاص';
  }
  return 'القاموس الشخصي';
}

function syncQuizSourceOptions() {
  const wrap = document.querySelector('.quiz-source-selector');
  if (!wrap) return;
  const currentIsAvailable = currentQuizSource === 'personal' ||
    currentQuizSource === 'starred' ||
    (String(currentQuizSource).startsWith('custom:') && customWorlds.some(world => `custom:${world.id}` === currentQuizSource));
  if (!currentIsAvailable) currentQuizSource = 'personal';
  const customButtons = customWorlds.map(world => {
    const scope = `custom:${world.id}`;
    return `<button type="button" data-quiz-source="${escapeHtml(scope)}" onclick="setQuizSourceScope('${escapeHtml(scope)}', this)">${escapeHtml(world.emoji || '📘')} ${escapeHtml(world.name || 'عالم')}</button>`;
  }).join('');
  wrap.innerHTML = `
    <button type="button" data-quiz-source="personal" onclick="setQuizSourceScope('personal', this)">القاموس الشخصي</button>
    <button type="button" data-quiz-source="starred" onclick="setQuizSourceScope('starred', this)">الكلمات الصعبة</button>
    ${customButtons}
  `;
  wrap.querySelectorAll('[data-quiz-source]').forEach(el => {
    el.classList.toggle('active', el.dataset.quizSource === currentQuizSource);
  });
}

function setQuizSourceScope(scope, btn) {
  const requested = String(scope || 'personal');
  currentQuizSource = requested === 'starred' || requested.startsWith('custom:') ? requested : 'personal';
  document.querySelectorAll('[data-quiz-source]').forEach(el => {
    el.classList.toggle('active', el === btn || el.dataset.quizSource === currentQuizSource);
  });
  refreshQuizAvailableCount();
  refreshQuizSettingsSummary();
}
window.setQuizSourceScope = setQuizSourceScope;

function normalizeQuizWord(item, source, index) {
  if (!item) return null;
  const mastery = getWordMasteryState(item);
  const sourceId = source || 'personal';
  return {
    id: String(item.id || `${sourceId}-${item.text || item.word || index}`),
    word: item.word || item.text || '',
    meaning: item.meaning || '',
    example: item.example || '',
    forgetCount: item.forgetCount || 0,
    starred: Boolean(item.starred),
    difficulty: item.difficulty || item.level || item.cefr || item.cefrLevel || '',
    createdAt: item.createdAt || item.timestamp || item.addedAt || null,
    mastery_status: mastery.mastery_status,
    mastery_streak: mastery.mastery_streak,
    last_recalled_at: mastery.last_recalled_at,
    first_recalled_at: mastery.first_recalled_at,
    last_recall_day: mastery.last_recall_day,
    last_recall_session_id: mastery.last_recall_session_id,
    last_quizzed_at: mastery.last_quizzed_at,
    quiz_seen_count: mastery.quiz_seen_count,
    mastered_once: mastery.mastered_once,
    isGameQuizWord: false,
    quizSource: sourceId
  };
}

function getQuizSourceWords(scope = currentQuizSource) {
  const uid = window.auth?.currentUser?.uid;
  let source = [];
  let sourceKey = 'personal';
  if (scope === 'starred') {
    source = readWordsFromStorage('normal', uid).filter(w => Boolean(w.starred));
    sourceKey = 'personal';
  } else if (String(scope).startsWith('custom:')) {
    const worldId = String(scope).slice(7);
    source = readCustomWorldWordsFromStorage(worldId, uid);
    sourceKey = `custom:${worldId}`;
  } else {
    source = readWordsFromStorage('normal', uid);
    sourceKey = 'personal';
  }
  return source.map((w, i) => normalizeQuizWord(w, sourceKey, i)).filter(w => w.word && w.meaning);
}

function getQuizSourceParts(source = 'personal') {
  const src = String(source || 'personal');
  if (src.startsWith('custom:')) return { type: 'custom', worldId: src.slice(7) };
  return { type: 'personal', worldId: null };
}

function updateQuizWordInSource(wordId, updater, source = 'personal') {
  const uid = window.auth?.currentUser?.uid;
  const { type, worldId } = getQuizSourceParts(source);
  const currentIsOpen = type === 'custom'
    ? window.isActiveCustomWorld?.(worldId)
    : currentView === 'personal';
  const wordsList = currentIsOpen
    ? [...(window.words || [])]
    : (type === 'custom' ? readCustomWorldWordsFromStorage(worldId, uid) : readWordsFromStorage('normal', uid));
  let updatedWord = null;
  const nextWords = wordsList.map(word => {
    if (String(word.id) !== String(wordId)) return word;
    updatedWord = typeof updater === 'function' ? updater(word) : { ...word, ...updater };
    return updatedWord;
  });
  if (!updatedWord) return null;
  if (type === 'custom') {
    writeCustomWorldWordsToStorage(worldId, nextWords, uid);
    if (currentIsOpen) window.words = nextWords;
    if (window.updateCustomWorldWordInCloud) {
      const { quizSource, isGameQuizWord, ...cloudData } = updatedWord;
      window.updateCustomWorldWordInCloud(worldId, wordId, cloudData);
    }
  } else {
    writeWordsToStorage(nextWords, 'normal', uid);
    if (currentIsOpen) window.words = nextWords;
    if (window.updateWordInCloud) {
      const { quizSource, isGameQuizWord, ...cloudData } = updatedWord;
      window.updateWordInCloud(wordId, cloudData);
    }
  }
  propagateMasteryStateAcrossAccount(
    updatedWord.word || updatedWord.text,
    getInlineWordMasteryState(updatedWord)
  );
  return updatedWord;
}

function warnIfTooFewQuizSourceWords(scope = currentQuizSource, count = getQuizSourceWords(scope).length) {
  const source = getQuizSourceLabel(scope);
  if (count <= 0) {
    showToast(`ما عندك كلمات متاحة في ${source} حالياً. أضف كلمات أولاً.`, 'warning', 5600);
    return true;
  }
  const requestedCount = quizQuestionCount === 'all'
    ? count
    : Math.max(1, Number.parseInt(quizQuestionCount, 10) || count);
  if (count < requestedCount) {
    showToast(`${source} فيه ${count} كلمات فقط، لذلك سيستخدم الاختبار الكلمات المتاحة كلها.`, 'info', 4800);
  }
  return false;
}

function shuffleQuizWords(words) {
  return [...words].sort(() => Math.random() - 0.5);
}

function toQuizTimestamp(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function getQuizDueInfo(word, state, now) {
  const status = state.mastery_status;
  const lastQuizAt = toQuizTimestamp(state.last_quizzed_at || state.last_recalled_at);
  const lastRecallAt = toQuizTimestamp(state.last_recalled_at);
  const firstRecallAt = toQuizTimestamp(state.first_recalled_at);
  let dueAt = 0;
  if (status === 'Learning') {
    dueAt = lastRecallAt ? lastRecallAt + QUIZ_QUEUE_DAY_MS : 0;
  } else if (status === 'Reviewing') {
    if (state.mastered_once) dueAt = lastQuizAt;
    else if (firstRecallAt) dueAt = Math.max(firstRecallAt + SRS_MASTERY_WINDOW_MS, lastRecallAt + QUIZ_QUEUE_DAY_MS);
    else dueAt = lastQuizAt ? lastQuizAt + QUIZ_QUEUE_DAY_MS : 0;
  } else if (status === 'Mastered') {
    dueAt = lastQuizAt ? lastQuizAt + SRS_MASTERED_REVIEW_DUE_MS : 0;
  }
  const isDue = status !== 'New' && (!dueAt || dueAt <= now);
  return {
    dueAt,
    isDue,
    overdueMs: isDue ? Math.max(0, now - dueAt) : 0,
    lastQuizAt,
    lastRecallAt,
  };
}

function applyRecentExposurePenalty(word, options = {}) {
  const now = Number(options.now) || Date.now();
  const history = Array.isArray(options.history) ? options.history : readQuizExposureHistory();
  const wordKey = getWordMasteryKey(word);
  const state = options.state || getWordMasteryState(word);
  const due = options.due || getQuizDueInfo(word, state, now);
  const historyIndex = history.findIndex(entry =>
    (entry?.wordKeys || []).includes(wordKey) ||
    (entry?.wordExposures || []).some(exposure => exposure?.wordKey === wordKey)
  );
  const historyEntry = historyIndex >= 0 ? history[historyIndex] : null;
  const exposure = historyEntry?.wordExposures?.find(item => item?.wordKey === wordKey);
  const exposureMode = historyEntry?.mode || 'verified';
  const exposureOutcome = exposure?.outcome || (historyEntry ? 'seen' : '');
  const flashcardForgotten = exposureMode === 'flashcards' && exposureOutcome === 'forgotten';
  const exposureWeight = exposureMode === 'flashcards' ? 0.25 : 1;
  const basePenalty = historyIndex === 0 ? 900 : historyIndex === 1 ? 420 : historyIndex === 2 ? 180 : 0;
  let penalty = flashcardForgotten ? 0 : Math.round(basePenalty * exposureWeight);
  const ageMs = due.lastQuizAt ? Math.max(0, now - due.lastQuizAt) : Infinity;
  if (ageMs < 6 * 60 * 60 * 1000) penalty += 520;
  else if (ageMs < QUIZ_QUEUE_DAY_MS) penalty += 260;
  else if (ageMs < 3 * QUIZ_QUEUE_DAY_MS) penalty += 100;

  const urgent = due.overdueMs >= QUIZ_BACKLOG_THRESHOLDS.severeOverdueMs ||
    Number(word.forgetCount) >= 2 ||
    (state.mastered_once && state.mastery_status !== 'Mastered');
  if (urgent) penalty = Math.round(penalty * 0.2);
  if (flashcardForgotten) penalty = 0;
  return { penalty, historyIndex, urgent, exposureMode, exposureOutcome, flashcardForgotten };
}

function getQuizCandidateScore(word, bucketType, options = {}) {
  const now = Number(options.now) || Date.now();
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const state = options.state || getWordMasteryState(word);
  const due = options.due || getQuizDueInfo(word, state, now);
  const recent = applyRecentExposurePenalty(word, { ...options, now, state, due });
  const forgetCount = Math.max(0, Number(word.forgetCount) || 0);
  const seenCount = Math.max(0, Number(state.quiz_seen_count) || 0);
  const ageDays = due.lastQuizAt ? Math.min(365, Math.max(0, now - due.lastQuizAt) / QUIZ_QUEUE_DAY_MS) : 365;
  const overdueDays = Math.min(90, due.overdueMs / QUIZ_QUEUE_DAY_MS);
  const regressed = state.mastered_once && state.mastery_status !== 'Mastered';
  const flashcardForgottenBoost = recent.flashcardForgotten ? 2600 : 0;
  let score = 0;
  let reason = '';

  if (bucketType === 'reviewing') {
    score = (due.isDue ? 5000 : 0) + overdueDays * 220 + forgetCount * 420 + ageDays * 20 + flashcardForgottenBoost +
      (regressed ? 2600 : 0) - recent.penalty - Math.min(160, seenCount * 4);
    reason = regressed ? 'تراجعت من Mastered' : due.isDue ? 'Reviewing مستحقة' : 'Reviewing حسب الأولوية';
  } else if (bucketType === 'learning') {
    score = (due.isDue ? 3200 : 0) + forgetCount * 520 + ageDays * 24 + flashcardForgottenBoost +
      (regressed ? 1800 : 0) - recent.penalty - Math.min(140, seenCount * 3);
    reason = forgetCount > 0 ? 'Learning مع أخطاء سابقة' : due.isDue ? 'Learning تحتاج تثبيت' : 'Learning بدأت حديثًا';
  } else if (bucketType === 'new') {
    const createdAt = toQuizTimestamp(word.createdAt || word.timestamp || word.addedAt);
    const addedAgeDays = createdAt ? Math.min(730, Math.max(0, now - createdAt) / QUIZ_QUEUE_DAY_MS) : 365;
    score = (seenCount === 0 ? 4200 : 0) + addedAgeDays * 14 + flashcardForgottenBoost - seenCount * 260 - recent.penalty;
    reason = seenCount === 0 ? 'New لم تظهر من قبل' : 'New قديمة قليلة الظهور';
  } else {
    score = (due.isDue ? 4200 : -2200) + overdueDays * 260 + forgetCount * 360 + ageDays * 14 + flashcardForgottenBoost - recent.penalty;
    reason = due.isDue ? 'Mastered حان موعدها' : 'Mastered احتياطية غير مستحقة';
  }

  return {
    score: score + random() * 35,
    reason: recent.flashcardForgotten ? 'نسيتها في Flashcards' : reason,
    recentPenalty: recent.penalty,
    recentSessionIndex: recent.historyIndex,
    urgent: recent.urgent,
    flashcardForgotten: recent.flashcardForgotten,
  };
}

function classifyWordsBySrsStatus(words, options = {}) {
  const now = Number(options.now) || Date.now();
  const history = Array.isArray(options.history) ? options.history : readQuizExposureHistory();
  const buckets = { reviewing: [], learning: [], new: [], masteredDue: [], masteredNotDue: [] };
  const seenKeys = new Set();
  (Array.isArray(words) ? words : []).forEach((word, index) => {
    const wordKey = getWordMasteryKey(word) || `${word.quizSource || 'personal'}:${word.id || index}`;
    if (seenKeys.has(wordKey)) return;
    seenKeys.add(wordKey);
    const state = getWordMasteryState(word);
    const due = getQuizDueInfo(word, state, now);
    const bucketType = state.mastery_status === 'Reviewing'
      ? 'reviewing'
      : state.mastery_status === 'Learning'
        ? 'learning'
        : state.mastery_status === 'Mastered'
          ? (due.isDue ? 'masteredDue' : 'masteredNotDue')
          : 'new';
    const scoreInfo = getQuizCandidateScore(word, bucketType === 'masteredNotDue' ? 'masteredDue' : bucketType, {
      ...options,
      now,
      history,
      state,
      due,
    });
    buckets[bucketType].push({
      word,
      wordKey,
      status: state.mastery_status,
      bucketType,
      state,
      due,
      index,
      ...scoreInfo,
    });
  });
  return buckets;
}

function rankWordsWithinBucket(words, bucketType) {
  return [...(words || [])].sort((a, b) =>
    b.score - a.score ||
    b.due.overdueMs - a.due.overdueMs ||
    (Number(b.word.forgetCount) || 0) - (Number(a.word.forgetCount) || 0) ||
    a.index - b.index
  );
}

function getQuizBacklogState(buckets, requestedSize) {
  const size = Math.max(1, Number(requestedSize) || 1);
  const dueReviewing = (buckets.reviewing || []).filter(item => item.due.isDue);
  const severe = dueReviewing.filter(item => item.due.overdueMs >= QUIZ_BACKLOG_THRESHOLDS.severeOverdueMs || item.state.mastered_once);
  let level = 'normal';
  if (dueReviewing.length >= size * QUIZ_BACKLOG_THRESHOLDS.criticalDueRatio ||
      severe.length >= size * QUIZ_BACKLOG_THRESHOLDS.criticalSevereRatio) {
    level = 'critical';
  } else if (dueReviewing.length >= size * QUIZ_BACKLOG_THRESHOLDS.heavyDueRatio ||
             severe.length >= size * QUIZ_BACKLOG_THRESHOLDS.heavySevereRatio) {
    level = 'heavy';
  }
  return { level, dueReviewing: dueReviewing.length, severeReviewing: severe.length };
}

function calculateQuizQuotas(size, backlogState = { level: 'normal' }) {
  const limit = Math.max(1, Math.floor(Number(size) || 1));
  const quotas = {
    reviewing: Math.round(limit * QUIZ_QUOTAS.reviewing),
    learning: Math.round(limit * QUIZ_QUOTAS.learning),
    new: Math.round(limit * QUIZ_QUOTAS.new),
    masteredDue: Math.round(limit * QUIZ_QUOTAS.masteredDue),
  };
  const minimumNew = limit >= 10 ? 2 : limit >= 5 ? 1 : limit >= 3 ? 1 : 0;
  quotas.new = Math.max(minimumNew, Math.min(QUIZ_QUOTA_CAPS.new, quotas.new));
  quotas.masteredDue = Math.min(QUIZ_QUOTA_CAPS.masteredDue, quotas.masteredDue);

  const minimums = { reviewing: 0, learning: 0, new: minimumNew, masteredDue: 0 };
  const reduceOrder = ['learning', 'masteredDue', 'new', 'reviewing'];
  while (Object.values(quotas).reduce((sum, value) => sum + value, 0) > limit) {
    const key = reduceOrder.find(name => quotas[name] > minimums[name]);
    if (!key) break;
    quotas[key]--;
  }
  while (Object.values(quotas).reduce((sum, value) => sum + value, 0) < limit) quotas.reviewing++;

  if (backlogState.level === 'heavy') {
    const removedNew = Math.max(0, quotas.new - (minimumNew ? 1 : 0));
    quotas.new -= removedNew;
    quotas.reviewing += removedNew;
  } else if (backlogState.level === 'critical') {
    const removedNew = Math.max(0, quotas.new - (minimumNew ? 1 : 0));
    const removedMastered = quotas.masteredDue;
    quotas.new -= removedNew;
    quotas.masteredDue = 0;
    quotas.reviewing += removedNew + removedMastered;
  }
  return quotas;
}

function fillQuotaFromFallbacks(deck, buckets, deficits, picked, debug) {
  const take = (bucketName, count, reason) => {
    let added = 0;
    const bucket = buckets[bucketName] || [];
    while (bucket.length && added < count) {
      const candidate = bucket.shift();
      if (picked.has(candidate.wordKey)) continue;
      picked.add(candidate.wordKey);
      candidate.selectionReason = reason;
      deck.push(candidate);
      added++;
    }
    return added;
  };

  Object.entries(deficits).forEach(([missingBucket, missingCount]) => {
    let remaining = missingCount;
    for (const fallback of QUIZ_QUOTA_FALLBACKS[missingBucket] || []) {
      if (remaining <= 0) break;
      const added = take(fallback, remaining, `تعويض نقص ${missingBucket}`);
      if (added && debug) debug.fallbacks.push({ missingBucket, fallback, added });
      remaining -= added;
    }
  });
  return take;
}

function interleaveQuizDeck(candidates, options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const remaining = [...candidates];
  const result = [];
  while (remaining.length) {
    const last = result[result.length - 1];
    const beforeLast = result[result.length - 2];
    let eligible = remaining.filter(item => {
      const sameStatusRun = last && beforeLast && last.status === item.status && beforeLast.status === item.status;
      const source = item.word.quizSource || 'personal';
      const sameSourceRun = last && beforeLast &&
        (last.word.quizSource || 'personal') === source &&
        (beforeLast.word.quizSource || 'personal') === source;
      const hasAlternativeStatus = remaining.some(other => other.status !== item.status);
      const hasAlternativeSource = remaining.some(other => (other.word.quizSource || 'personal') !== source);
      return !(sameStatusRun && hasAlternativeStatus) && !(sameSourceRun && hasAlternativeSource);
    });
    if (!eligible.length) eligible = remaining;
    if (!result.length) {
      const starters = eligible.filter(item => item.status === 'Learning' || item.status === 'New');
      if (starters.length) eligible = starters;
    }
    const statusCounts = eligible.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {});
    const statusOrder = [...new Set(eligible.map(item => item.status))].sort((a, b) =>
      (statusCounts[b] || 0) - (statusCounts[a] || 0) ||
      (a === last?.status ? 1 : 0) - (b === last?.status ? 1 : 0)
    );
    const selectedStatus = statusOrder[0];
    const scored = eligible.filter(item => item.status === selectedStatus).map(item => ({
      item,
      displayScore: item.score + random() * 90,
    })).sort((a, b) => b.displayScore - a.displayScore);
    const starterWindow = !result.length ? scored.slice(0, Math.min(3, scored.length)) : scored.slice(0, 1);
    const next = starterWindow[Math.floor(random() * starterWindow.length)].item;
    result.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return result;
}

function validateQuizDeck(deck, requestedSize) {
  const limit = Math.max(0, Number(requestedSize) || 0);
  const seen = new Set();
  return (Array.isArray(deck) ? deck : []).filter(word => {
    const key = getWordMasteryKey(word) || `${word.quizSource || 'personal'}:${word.id}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function buildBalancedQuizDeck(sourceWords, requestedCount, options = {}) {
  const available = Array.isArray(sourceWords) ? sourceWords : [];
  const limit = Math.max(0, Math.min(Math.floor(Number(requestedCount) || 0), available.length));
  if (!limit) return [];
  const history = Array.isArray(options.history) ? options.history : readQuizExposureHistory();
  const buckets = classifyWordsBySrsStatus(available, { ...options, history });
  Object.keys(buckets).forEach(key => { buckets[key] = rankWordsWithinBucket(buckets[key], key); });
  const allCandidates = Object.values(buckets).flat();
  const backlog = getQuizBacklogState(buckets, limit);
  const quotas = calculateQuizQuotas(limit, backlog);
  const debug = { fallbacks: [] };
  const selected = [];
  const picked = new Set();
  const deficits = {};
  const primaryBuckets = ['reviewing', 'learning', 'new', 'masteredDue'];

  primaryBuckets.forEach(bucketName => {
    const wanted = quotas[bucketName] || 0;
    let added = 0;
    while (buckets[bucketName].length && added < wanted) {
      const candidate = buckets[bucketName].shift();
      if (picked.has(candidate.wordKey)) continue;
      picked.add(candidate.wordKey);
      candidate.selectionReason = `حصة ${bucketName}`;
      selected.push(candidate);
      added++;
    }
    deficits[bucketName] = Math.max(0, wanted - added);
  });

  const take = fillQuotaFromFallbacks(selected, buckets, deficits, picked, debug);
  const finalOrder = ['reviewing', 'learning', 'new', 'masteredDue', 'masteredNotDue'];
  for (const bucketName of finalOrder) {
    if (selected.length >= limit) break;
    take(bucketName, limit - selected.length, bucketName === 'masteredNotDue' ? 'نقص كبير؛ Mastered احتياطية' : 'ملء المقاعد المتبقية');
  }

  const interleaved = interleaveQuizDeck(selected.slice(0, limit), options);
  const deck = validateQuizDeck(interleaved.map(item => item.word), limit);
  if (window.__lootlinguaQuizDebug === true) {
    const availableCounts = allCandidates.reduce((counts, item) => {
      counts[item.bucketType] = (counts[item.bucketType] || 0) + 1;
      return counts;
    }, {});
    const selectedKeys = new Set(selected.map(item => item.wordKey));
    console.groupCollapsed(`[LootLingua Quiz] deck ${deck.length}/${limit}`);
    console.log('requested', requestedCount);
    console.log('available by bucket', availableCounts);
    console.log('quotas', quotas);
    console.log('backlog', backlog);
    console.log('fallbacks', debug.fallbacks);
    console.table(selected.map(item => ({
      word: item.word.word,
      source: item.word.quizSource,
      status: item.status,
      bucket: item.bucketType,
      score: Math.round(item.score),
      reason: item.reason,
      selectedBy: item.selectionReason,
      recentPenalty: item.recentPenalty,
    })));
    console.log('recently penalized', selected.filter(item => item.recentPenalty > 0).map(item => item.word.word));
    console.log('not selected with recent penalty', allCandidates
      .filter(item => item.recentPenalty > 0 && !selectedKeys.has(item.wordKey))
      .map(item => item.word.word));
    console.groupEnd();
  }
  return deck;
}

function buildSmartQuizDeck(sourceWords, requestedCount, options = {}) {
  return buildBalancedQuizDeck(sourceWords, requestedCount, options);
}

function getConfiguredQuizWords() {
  const sourceWords = getQuizSourceWords();
  const count = quizQuestionCount === 'all' ? sourceWords.length : parseInt(quizQuestionCount, 10);
  currentQuizPool = sourceWords;
  return buildSmartQuizDeck(sourceWords, count);
}

function refreshQuizAvailableCount() {
  const quizCountEl = document.getElementById('quizAvailableCount');
  if (!quizCountEl) return;
  const total = getQuizSourceWords('personal').length;
  const starred = getQuizSourceWords('starred').length;
  const worldParts = customWorlds
    .map(world => `${world.emoji || '📘'} ${world.name || 'عالم'}: ${getQuizSourceWords(`custom:${world.id}`).length}`)
    .join('، ');
  quizCountEl.textContent = (total > 0 || starred > 0 || worldParts)
    ? `القاموس الشخصي: ${total} كلمة، الكلمات الصعبة: ${starred}${worldParts ? '، ' + worldParts : ''}`
    : 'لا توجد كلمات متاحة للاختبار بعد.';
}

function refreshQuizSettingsSummary() {
  const total = getQuizSourceWords().length;
  const countText = quizQuestionCount === 'all' ? 'كل الكلمات' : `${quizQuestionCount} أسئلة`;
  const summary = document.getElementById('quizSettingsSummary');
  const sourceText = getQuizSourceLabel(currentQuizSource);
  if (summary) summary.textContent = `${sourceText}: ${total} كلمة متاحة، الاختبار: ${countText}.`;
}

function startConfiguredQuiz() {
  startActualQuiz(selectedQuizMode, { configured: true });
}

function startActualQuiz(mode, options = {}) {
  stopTimeAttackTimer();
  let words = options.configured ? getConfiguredQuizWords() : getQuizSourceWords(currentQuizSource);
  if (!options.configured) currentQuizPool = words;
  const verifiedMode = isVerifiedQuizMode(mode);
  const starredCount = getQuizSourceWords('starred').length;

  if ((options.configured || mode === 'flashcards' || mode === 'timeAttack' || mode === 'scramble') &&
      warnIfTooFewQuizSourceWords(currentQuizSource, getQuizSourceWords(currentQuizSource).length)) {
    openQuizModeSettings(options.configured ? selectedQuizMode : mode);
    return;
  }

  if (mode === 'recent') {
    words.sort((a, b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
    words = words.slice(0, 10);
  } else if (mode === 'old') {
    words.sort((a, b) => (a.id||0) - (b.id||0));
    words = words.slice(0, 10);
  } else if (mode === 'forgotten') {
    words = words.filter(w => (w.forgetCount||0) > 0).sort((a,b) => b.forgetCount - a.forgetCount);
    if (!words.length) {
      showToast("ما عندك كلمات بتغلط فيها. رح نختبرك عشوائياً.");
      words = [...window.words].sort(() => Math.random()-0.5).slice(0, 10);
    } else words = words.slice(0, 10);
  } else if (mode === 'starred') {
    words = words.filter(w => w.starred);
    if (warnIfTooFewStarredQuizWords(starredCount)) {
      openQuizModeSettings('flashcards');
      return;
    }
  } else if (!options.configured && mode !== 'flashcards' && mode !== 'timeAttack' && mode !== 'scramble') {
    words.sort(() => Math.random()-0.5);
  }

  if (options.configured && currentQuizSource === 'starred' && warnIfTooFewStarredQuizWords(starredCount)) {
    openQuizModeSettings(selectedQuizMode);
    return;
  }

  if (!words.length) {
    showToast('ما في كلمات كافية لهذا الاختبار.');
    openQuizModeSettings(options.configured ? selectedQuizMode : 'flashcards');
    return;
  }

  currentQuizWords = words;
  quizIndex = 0;
  currentStreak = 0;
  currentQuizMistakes = 0;
  quizSessionResults = [];
  hasStartedAnswering = false;
  currentQuizExposureSessionId = makeQuizSessionId();
  currentQuizExposureMode = verifiedMode ? 'verified' : 'flashcards';
  flashcardSessionOutcomes = new Map();
  activeQuizSession = verifiedMode ? {
    id: currentQuizExposureSessionId,
    mode,
    source: currentQuizSource,
    createdAt: Date.now(),
    words,
    pool: currentQuizPool,
    questionCount: words.length,
    direction: { timeAttack: timeAttackDirection, scramble: scrambleDirection }
  } : null;
  if (verifiedMode) {
    setQuizImmersive(true);
    saveActiveQuizSession();
  } else {
    setQuizImmersive(false);
    clearActiveQuizSessionStorage();
  }

  document.getElementById('quizViewSetup').style.display = 'none';
  hideQuizPlayPanels();
  const exitBtn = document.querySelector('#quizView .quiz-exit-btn');
  if (exitBtn) exitBtn.style.display = 'none';

  if (mode === 'timeAttack') {
    document.getElementById('quizTimeAttackView').style.display = 'block';
    startTimeAttackQuiz();
  } else if (mode === 'scramble') {
    document.getElementById('quizScrambleView').style.display = 'block';
    updateScrambleCard();
  } else {
    document.getElementById('quizViewCard').style.display = 'block';
    updateCard();
  }
}

function updateCard() {
  if (quizIndex >= currentQuizWords.length) {
    showToast("أبدعت! أنهيت الكلمات 👏");
    closeQuiz();
    return;
  }
  const card = document.getElementById('mainCard');
  if (card.classList.contains('is-flipped')) {
    card.style.transition = 'none';
    card.classList.remove('is-flipped');
    void card.offsetWidth;
    card.style.transition = '';
  }
  const w = currentQuizWords[quizIndex];
  document.getElementById('cardFrontText').innerText   = w.word;
  document.getElementById('cardBackText').innerText    = w.meaning;
  document.getElementById('cardBackExample').innerText = w.example || '';
  const hint = document.getElementById('quizHintText');
  hint.innerText = w.example || 'لا يوجد مثال';
  hint.classList.remove('show');

  const pct = (quizIndex / currentQuizWords.length) * 100;
  document.getElementById('quizCardProgress').style.width = pct + '%';
  document.getElementById('quizCardCounter').innerText    = `${quizIndex+1} / ${currentQuizWords.length}`;
}

function flipCard()      { document.getElementById('mainCard').classList.toggle('is-flipped'); }
function showHint(event) { event.stopPropagation(); document.getElementById('quizHintText').classList.add('show'); }

function closeQuiz() {
  showQuizModes();
}

function showStreakMsg(streak) {
  const msgs = { 3: "3 صح ورا بعض!", 5: "5 صح! أسطورة!", 7: "7 ورا بعض!", 10: "10! أنت الأفضل!" };
  if (msgs[streak]) showToast(msgs[streak]);
}

function updateQuizForgetState(w, nextForget) {
  const prevForget = w.forgetCount || 0;
  const updatedWord = { ...w, forgetCount: nextForget };
  currentQuizWords[quizIndex] = updatedWord;
  if (!w.isGameQuizWord) {
    updateQuizWordInSource(w.id, { forgetCount: nextForget }, w.quizSource || currentQuizSource);
    if (isEditableDictionaryView()) render();
  }
  return { updatedWord, prevForget };
}

function recordQuizAnswer(w, correct) {
  if (!activeQuizSession || !isVerifiedQuizMode(activeQuizSession.mode) || !w) return;
  hasStartedAnswering = true;
  quizSessionResults.push({
    wordId: w.id,
    correct: Boolean(correct),
    answeredAt: Date.now()
  });
  saveActiveQuizSession();
}

function rememberQuizWord(w) {
  if (activeQuizSession && isVerifiedQuizMode(activeQuizSession.mode)) {
    recordQuizAnswer(w, true);
    return { updatedWord: w, prevForget: w.forgetCount || 0 };
  }
  const nextForget = Math.max((w.forgetCount || 0) - 1, 0);
  return updateQuizForgetState(w, nextForget);
}

function forgetQuizWord(w) {
  if (activeQuizSession && isVerifiedQuizMode(activeQuizSession.mode)) {
    recordQuizAnswer(w, false);
    return { updatedWord: { ...w, forgetCount: (w.forgetCount || 0) + 1 }, prevForget: w.forgetCount || 0 };
  }
  const nextForget = (w.forgetCount || 0) + 1;
  return updateQuizForgetState(w, nextForget);
}

function requeueForgotQuizWord(updatedWord, fromIndex) {
  const gap = Math.max(2, Math.min(5 - (updatedWord.forgetCount || 0), 4));
  const insertAt = Math.min(fromIndex + gap, currentQuizWords.length);
  currentQuizWords.splice(insertAt, 0, { ...updatedWord });
}

