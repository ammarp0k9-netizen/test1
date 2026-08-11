async function commitVerifiedQuizResults(trace, onStage) {
  if (!activeQuizSession || !isVerifiedQuizMode(activeQuizSession.mode)) return { xp: 0, masteredCount: 0, correctCount: 0, total: 0 };
  window.LootLinguaOperations?.diagnostic?.('commitVerifiedQuizResults', {
    ownerId: window.auth?.currentUser?.uid || 'guest',
    sessionId: String(activeQuizSession.id || ''),
    mode: String(activeQuizSession.mode || ''),
  });
  const byWord = new Map();
  quizSessionResults.forEach(result => {
    const key = String(result.wordId);
    const existing = byWord.get(key);
    byWord.set(key, {
      wordId: key,
      correct: existing ? Boolean(existing.correct && result.correct) : Boolean(result.correct),
      answeredAt: Math.max(Number(existing?.answeredAt) || 0, Number(result.answeredAt) || 0) || Date.now()
    });
  });
  let xp = 0;
  let masteredCount = 0;
  let correctCount = 0;
  const masteredIds = new Set();
  const advancedWords = [];
  const transitionEntries = [];

  // Commit against the immutable candidate snapshot captured when this session
  // started. Re-resolving here could apply an old answer to a newly selected
  // source (or to another account after an auth switch).
  const sourceWords = Array.isArray(activeQuizSession.words)
    ? activeQuizSession.words
    : [];
  const committedWordIds = new Set();
  for (const word of sourceWords) {
    const wordId = String(word.id);
    const result = byWord.get(wordId);
    if (!result || committedWordIds.has(wordId)) continue;
    committedWordIds.add(wordId);
    if (result.correct) correctCount++;
    const update = computeSrsUpdate(word, result.correct, activeQuizSession.id, result.answeredAt || Date.now());
    transitionEntries.push({ word, result, update });
  }
  trace?.stage('srs-calculated', { transitionCount: transitionEntries.length });
  onStage?.('applying-rewards');
  const batch = typeof awardWordTransitionXPBatch === 'function'
    ? await awardWordTransitionXPBatch(transitionEntries, activeQuizSession.id, { trace })
    : {
      awards: await Promise.all(transitionEntries.map((entry) =>
        awardWordTransitionXP(entry.word, entry.update, activeQuizSession.id)
      )),
      pendingCount: 0,
    };
  trace?.stage('xp-committed', {
    eventCount: batch.awards.filter((amount) => amount > 0).length,
    pendingCount: batch.pendingCount || 0,
  });
  onStage?.('committing-learning');
  window.__lootlinguaQuizLearningCommitDepth = (Number(window.__lootlinguaQuizLearningCommitDepth) || 0) + 1;
  let evidence = batch?.evidence || null;
  try {
    transitionEntries.forEach(({ word, update }, index) => {
      const awarded = batch.awards[index] || 0;
      xp += awarded;
      if (update.advanced && awarded > 0) {
        advancedWords.push({ word: word.word, nextStatus: update.nextStatus });
      }
      const wordKey = getWordMasteryKey(word);
      if (update.mastered && wordKey && !masteredIds.has(wordKey)) {
        masteredIds.add(wordKey);
        masteredCount++;
      }
    });

    if (typeof window.applyQuizLearningBatch === 'function') {
      await window.applyQuizLearningBatch(transitionEntries, {
        source: activeQuizSession.source || currentQuizSource,
        trace,
      });
    } else {
      transitionEntries.forEach(({ word, result, update }) => {
        const forgetCount = result.correct
          ? Math.max((word.forgetCount || 0) - 1, 0)
          : (word.forgetCount || 0) + 1;
        updateQuizWordInSource(
          word.id,
          { ...word, ...update.state, forgetCount },
          word.quizSource || activeQuizSession.source || currentQuizSource
        );
      });
    }

    if (
      !evidence &&
      window.auth?.currentUser &&
      typeof window.LootLinguaJourneyCloud?.recordQuizEvidenceBatch === 'function'
    ) {
      trace?.stage('evidence-write-start', { fallback: true, entryCount: transitionEntries.length });
      evidence = await window.LootLinguaJourneyCloud.recordQuizEvidenceBatch({
        sessionId: activeQuizSession.id,
        mode: activeQuizSession.mode,
        source: activeQuizSession.source || currentQuizSource,
        completed: true,
        entries: transitionEntries,
        projectReadiness: false,
      });
      trace?.stage('evidence-write-end', { ...evidence, fallback: true });
    }
    evidence ||= { recorded: 0, duplicate: 0, ineligible: transitionEntries.length, readinessError: null };
    if (
      window.auth?.currentUser &&
      typeof window.LootLinguaJourneyCloud?.projectQuizEvidenceReadiness === 'function'
    ) {
      trace?.stage('journey-projection-start');
      evidence = await window.LootLinguaJourneyCloud.projectQuizEvidenceReadiness(evidence);
      trace?.stage('journey-projection-end', evidence);
    }
    trace?.stage('evidence-committed', evidence);
  } finally {
    window.__lootlinguaQuizLearningCommitDepth = Math.max(
      0,
      (Number(window.__lootlinguaQuizLearningCommitDepth) || 1) - 1
    );
    if (window.__lootlinguaQuizLearningCommitDepth === 0) {
      window.dispatchEvent(new CustomEvent('lootlingua:quiz-learning-commit-complete'));
    }
  }

  const totalUnique = byWord.size;

  if (xp > 0) {
    showXPBadge(xp, null, false);
    if (advancedWords.length > 0) {
      const first = advancedWords[0];
      const statusLabel = first.nextStatus === 'Mastered' ? 'متقنة' : first.nextStatus === 'Reviewing' ? 'قريبة من الإتقان' : 'قيد التعلم';
      const extra = advancedWords.length > 1 ? ` و${advancedWords.length - 1} كلمة أخرى` : '';
      try {
        pushNotification(`زاد مؤشر الإتقان: ${first.word} أصبحت ${statusLabel}${extra}. +${xp} XP`, 'success');
      } catch (error) {
        console.warn('[QuizFinish] Notification side effect deferred after learning commit.', error?.message || error);
      }
    }
  }
  if (masteredCount > 0) recordChestMasteredWords(masteredIds);
  if (isEditableDictionaryView()) {
    render();
    trace?.count('rerenderCount');
  }
  return {
    xp,
    masteredCount,
    correctCount,
    total: totalUnique,
    pendingRewards: Number(batch.pendingCount) || 0,
    evidence,
  };
}

function markRemember() {
  const w = currentQuizWords[quizIndex];
  if (!w) return;
  recordFlashcardExposureOutcome(w, 'remembered');
  const { prevForget } = rememberQuizWord(w);
  currentStreak++;
  showStreakMsg(currentStreak);
  saveInt('lootlinguaFlashcardsReviewedToday', loadInt('lootlinguaFlashcardsReviewedToday', 0) + 1);
  if (quizIndex < currentQuizWords.length - 1) { quizIndex++; updateCard(); }
  else { finishQuizRun(); }
}

const QUIZ_FINISH_TRANSITIONS = Object.freeze({
  answering: ['final-answer-locked'],
  'final-answer-locked': ['saving-result'],
  'saving-result': ['applying-rewards', 'committing-learning', 'completed', 'save-failed'],
  'applying-rewards': ['committing-learning', 'save-partial-failure', 'save-failed'],
  'committing-learning': ['completed', 'save-partial-failure', 'save-failed'],
  'save-partial-failure': ['completed', 'saving-result'],
  'save-failed': ['saving-result'],
  completed: ['answering'],
});
const QUIZ_FINISH_COMMIT_TIMEOUT_MS = 30000;
let quizFinishState = 'answering';
let quizFinishPromise = null;
let quizFinishUi = null;

function dispatchTrustedQuizCompletedSafely(detail) {
  // Notification evaluation is downstream of the durable learning commit. Run
  // it detached so notification persistence can never retry that commit.
  Promise.resolve().then(() => {
    try {
      window.dispatchEvent(new CustomEvent('lootlingua:trusted-quiz-completed', { detail }));
    } catch (error) {
      console.warn('[QuizFinish] Notification evaluation deferred after learning commit.', error?.message || error);
    }
  }).catch((error) => {
    console.warn('[QuizFinish] Notification evaluation scheduling failed safely.', error?.message || error);
  });
}

function setQuizFinishState(nextState, options = {}) {
  const allowed = QUIZ_FINISH_TRANSITIONS[quizFinishState] || [];
  if (nextState !== quizFinishState && !allowed.includes(nextState)) {
    throw new Error(`Invalid quiz finish transition: ${quizFinishState} -> ${nextState}`);
  }
  quizFinishState = nextState;
  const host = document.getElementById('quizView');
  if (!quizFinishUi && nextState !== 'answering') {
    ['quizViewCard', 'quizTimeAttackView', 'quizScrambleView', 'quizMatchingView'].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.style.display = 'none';
    });
    quizFinishUi = window.LootLinguaOperations?.beginStatus({
      scope: 'quiz-finish',
      host,
      loadingMessage: 'جارٍ حفظ نتيجتك...',
      longWaitMessage: 'يستغرق الحفظ وقتًا أطول من المعتاد، لكن إجاباتك محفوظة.',
    });
  }
  const messages = {
    'final-answer-locked': 'تم تثبيت إجابتك الأخيرة.',
    'saving-result': 'جارٍ حفظ نتيجتك...',
    'committing-learning': 'جارٍ تثبيت تقدم كلماتك...',
    'applying-rewards': 'جارٍ تطبيق المكافآت بأمان...',
    completed: options.message || 'تم حفظ النتيجة.',
    'save-partial-failure': options.message || 'حُفظت النتيجة، وتعذر حفظ بعض المكافآت.',
    'save-failed': options.message || 'تعذر حفظ النتيجة.',
  };
  if (nextState === 'completed') quizFinishUi?.complete(messages[nextState]);
  else if (nextState === 'save-partial-failure') {
    quizFinishUi?.set('partial-success', messages[nextState], options.retry);
  } else if (nextState === 'save-failed') {
    quizFinishUi?.fail(messages[nextState], options.retry);
  } else if (nextState !== 'answering') {
    quizFinishUi?.set('loading', messages[nextState]);
  }
}

function resetQuizFinishState() {
  quizFinishUi?.clear();
  quizFinishUi = null;
  quizFinishState = 'answering';
  quizFinishPromise = null;
}

function waitForQuizCommit(promise) {
  const configured = Number(window.__lootlinguaQuizFinishTimeoutMs);
  const timeoutMs = Number.isFinite(configured) && configured > 0
    ? configured
    : QUIZ_FINISH_COMMIT_TIMEOUT_MS;
  let timeoutId = null;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('Quiz result commit timed out.');
      error.code = 'quiz-finish/timeout';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => clearTimeout(timeoutId));
}

function finishQuizRun() {
  window.LootLinguaOperations?.diagnostic?.('finishQuizRun', {
    ownerId: window.auth?.currentUser?.uid || 'guest',
    coalesced: Boolean(quizFinishPromise),
  });
  if (quizFinishPromise) return quizFinishPromise;
  const retrying = quizFinishState === 'save-failed';
  setQuizFinishState(retrying ? 'saving-result' : 'final-answer-locked');
  stopTimeAttackTimer();
  const trace = window.LootLinguaOperations?.startTrace('quiz-finish', {
    questionCount: currentQuizWords.length,
  });
  trace?.stage('quiz-finish-start');
  trace?.stage('ui-feedback-visible');

  quizFinishPromise = (async () => {
    await (window.LootLinguaOperations?.nextPaint?.() || Promise.resolve());
    setQuizFinishState('saving-result');
    const verified = activeQuizSession && isVerifiedQuizMode(activeQuizSession.mode);
    const commit = verified
      ? await waitForQuizCommit(commitVerifiedQuizResults(trace, (stage) => setQuizFinishState(stage)))
      : { xp: 0, correctCount: currentQuizWords.length - currentQuizMistakes, total: currentQuizWords.length };
  const accuracy = commit.total > 0 ? commit.correctCount / commit.total : 0;
  const fullyCompleted = verified && quizIndex >= currentQuizWords.length;
  const exposureCompleted = currentQuizWords.length > 0 &&
    (verified ? quizIndex >= currentQuizWords.length : quizIndex >= currentQuizWords.length - 1);
  if (exposureCompleted) {
    recordQuizExposureSession(currentQuizExposureSessionId || activeQuizSession?.id, currentQuizWords, {
      mode: currentQuizExposureMode,
      outcomes: flashcardSessionOutcomes,
    });
  }
  if (fullyCompleted && commit.total > 0) {
    incrementDailyCountBy(commit.total);
    checkAndUpdateStreak({ learningEvent: true });
    dispatchTrustedQuizCompletedSafely({
      sessionId: String(activeQuizSession?.id || ''),
      completedAt: Date.now(),
      correctCount: Number(commit.correctCount) || 0,
      total: Number(commit.total) || 0,
    });
  }
  if (fullyCompleted && accuracy >= 0.9) recordHighAccuracyVerifiedQuiz(activeQuizSession.id);
  if (currentQuizMistakes === 0 && currentQuizWords.length > 0 && verified) {
    saveInt('lootlinguaPerfectQuizzes', loadInt('lootlinguaPerfectQuizzes', 0) + 1);
    if (!hasSignedInUser()) markGuestDataDirty();
    markDailyQuestFlag('perfectQuiz');
    if (typeof evaluateTitleUnlocks === 'function') evaluateTitleUnlocks(true);
    requestProfileCloudSave();
  }
  if (verified) {
    trace?.stage('primary-result-ready', { accuracy });
    if (commit.pendingRewards > 0) {
      setQuizFinishState('save-partial-failure', {
        message: 'حُفظت نتيجتك، وبعض مكافآت XP ستُعاد مزامنتها.',
        retry: () => retryPendingXPEvents(),
      });
    } else {
      setQuizFinishState('completed', {
        message: `تم حفظ النتيجة: ${Math.round(accuracy * 100)}% دقة.`,
      });
    }
    playQuizCompletionSound();
    trace?.stage('audio-started');
    if (accuracy >= 0.9 || commit.xp > 0) launchConfetti();
  } else {
    setQuizFinishState('completed', { message: 'تمت مراجعة البطاقات.' });
  }
  clearActiveQuizSessionStorage();
  activeQuizSession = null;
  currentQuizExposureSessionId = '';
  currentQuizExposureMode = '';
  flashcardSessionOutcomes = new Map();
  quizSessionResults = [];
  matchingQuizState = null;
  hasStartedAnswering = false;
    showToast(verified
    ? `تم حفظ الاختبار: ${Math.round(accuracy * 100)}% دقة${commit.xp ? `، +${commit.xp} XP` : ''}`
    : 'تمت مراجعة البطاقات بدون XP. أحسنت!',
      'success',
      3600);
    trace?.stage('quiz-finish-complete', {
      accuracy,
      xp: commit.xp,
      pendingRewards: commit.pendingRewards || 0,
    });
    trace?.stage('navigation-scheduled').end({
      accuracy,
      xp: commit.xp,
      pendingRewards: commit.pendingRewards || 0,
    });
    setTimeout(() => {
      resetQuizFinishState();
      closeQuiz();
    }, commit.pendingRewards > 0 ? 1800 : 600);
    return commit;
  })().catch((error) => {
    trace?.warn(error?.code || error?.message || 'quiz-finish-failed').end({ failed: true });
    quizFinishPromise = null;
    setQuizFinishState('save-failed', {
      message: 'تعذر حفظ النتيجة. إجاباتك ما زالت محفوظة للمحاولة من جديد.',
      retry: () => finishQuizRun(),
    });
    return null;
  });
  return quizFinishPromise;
}

function markForgot() {
  currentStreak = 0;
  currentQuizMistakes++;
  triggerShakeEffect(document.getElementById('quizViewCard'));
  safeVibrate(100);
  const w = currentQuizWords[quizIndex];
  if (!w) return;
  recordFlashcardExposureOutcome(w, 'forgotten');
  const { updatedWord } = forgetQuizWord(w);
  saveInt('lootlinguaFlashcardsReviewedToday', loadInt('lootlinguaFlashcardsReviewedToday', 0) + 1);
  requeueForgotQuizWord(updatedWord, quizIndex);

  // حدّث عداد البطاقات في الواجهة
  quizIndex++;
  updateCard();
}

function playQuizSound(event) {
  if (currentQuizWords[quizIndex]) playSound(currentQuizWords[quizIndex].word, event);
}

window.playQuizChoiceSound = function(event, encodedWord) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const word = decodeSugAttr(encodedWord);
  if (word) playSound(word, event);
};

function startTimeAttackQuiz() {
  timeAttackHp = 3;
  renderTimeAttackHearts(timeAttackHp);
  renderTimeAttackQuestion();
}

function renderTimeAttackHearts(hp, options = {}) {
  const host = document.getElementById('timeAttackHp');
  if (!host) return;
  const maxHp = 3;
  if (!host.querySelector('.hp-hearts')) {
    host.innerHTML = `<span class="hp-hearts" aria-label="نقاط الصحة ${hp}">${Array.from({ length: maxHp }, (_, index) =>
      `<span class="hp-heart" data-heart-index="${index}"><i class="fa-solid fa-heart" aria-hidden="true"></i><span class="hp-heart-shard shard-1" aria-hidden="true"></span><span class="hp-heart-shard shard-2" aria-hidden="true"></span></span>`
    ).join('')}</span>`;
  }
  const heartsWrap = host.querySelector('.hp-hearts');
  if (heartsWrap) heartsWrap.setAttribute('aria-label', `نقاط الصحة ${Math.max(0, hp)}`);
  const hearts = host.querySelectorAll('.hp-heart');
  hearts.forEach((heart, index) => {
    const alive = index < hp;
    if (options.breakIndex === index) {
      heart.classList.add('breaking');
      heart.classList.remove('alive');
      return;
    }
    heart.classList.toggle('alive', alive);
    if (!options.keepBreaking) heart.classList.remove('breaking');
  });
}

function renderTimeAttackQuestion() {
  stopTimeAttackTimer();
  if (quizIndex >= currentQuizWords.length || timeAttackHp <= 0) {
    finishQuizRun();
    return;
  }

  const w = currentQuizWords[quizIndex];
  document.getElementById('timeAttackCounter').textContent = `${quizIndex + 1} / ${currentQuizWords.length}`;
  renderTimeAttackHearts(timeAttackHp);
  document.querySelector('#quizTimeAttackView .quiz-mini-label').textContent =
    timeAttackDirection === 'en-to-ar' ? 'اختر المعنى العربي' : 'اختر الكلمة الإنجليزية';
  document.getElementById('timeAttackPrompt').textContent =
    timeAttackDirection === 'en-to-ar' ? w.word : w.meaning;
  document.getElementById('timeAttackProgress').style.width = `${(quizIndex / currentQuizWords.length) * 100}%`;

  const distractors = shuffleQuizWords(currentQuizPool.filter(x => x.id !== w.id)).slice(0, 3);
  const choices = shuffleQuizWords([w, ...distractors]);
  const choicesAreEnglish = timeAttackDirection !== 'en-to-ar';
  document.getElementById('timeAttackChoices').innerHTML = choices.map(choice => {
    const label = timeAttackDirection === 'en-to-ar' ? choice.meaning : choice.word;
    const answerId = choice.id.replace(/'/g, "\\'");
    return choicesAreEnglish
      ? `<div class="quiz-choice-with-sound">
          <button type="button" class="quiz-choice-answer" onclick="answerTimeAttack('${answerId}')">${escapeHtml(label)}</button>
          <button type="button" class="quiz-choice-sound btn-icon-tip" data-tip="نطق" onclick="playQuizChoiceSound(event, '${sugAttr(choice.word)}')" aria-label="نطق ${escapeHtml(choice.word)}"><i class="fa-solid fa-volume-up" aria-hidden="true"></i></button>
        </div>`
      : `<button type="button" onclick="answerTimeAttack('${answerId}')">${escapeHtml(label)}</button>`;
  }).join('');

  timeAttackSeconds = 15;
  const timerStartEl = document.getElementById('timeAttackTimer');
  if (timerStartEl) {
    timerStartEl.textContent = `${timeAttackSeconds}s`;
    timerStartEl.classList.remove('timer-danger');
  }
  timeAttackTimer = setInterval(() => {
    if (currentView !== 'quiz') {
      stopTimeAttackTimer();
      return;
    }
    timeAttackSeconds--;
    const timerEl = document.getElementById('timeAttackTimer');
    if (timerEl) {
      timerEl.textContent = `${timeAttackSeconds}s`;
      timerEl.classList.toggle('timer-danger', timeAttackSeconds <= 3);
    }
    if (timeAttackSeconds <= 0) answerTimeAttack('', { timedOut: true });
  }, 1000);
}

function answerTimeAttack(answerId, options = {}) {
  stopTimeAttackTimer();
  const w = currentQuizWords[quizIndex];
  if (!w) return;
  if (answerId === w.id) {
    rememberQuizWord(w);
    currentStreak++;
    showStreakMsg(currentStreak);
  } else {
    currentStreak = 0;
    currentQuizMistakes++;
    const prevHp = timeAttackHp;
    timeAttackHp--;
    renderTimeAttackHearts(timeAttackHp, { breakIndex: prevHp - 1, keepBreaking: true });
    triggerShakeEffect(document.getElementById('quizTimeAttackView'));
    safeVibrate(100);
    const { updatedWord } = forgetQuizWord(w);
    if (timeAttackHp > 0) requeueForgotQuizWord(updatedWord, quizIndex);
    showToast(options.timedOut ? 'انتهى الوقت!' : (timeAttackHp > 0 ? 'غلط، جرّب تكمل!' : 'خلصت نقاط الصحة.'));
    setTimeout(() => renderTimeAttackHearts(timeAttackHp), 680);
  }
  quizIndex++;
  saveActiveQuizSession();
  renderTimeAttackQuestion();
}

function scrambleWord(word) {
  const chars = String(word || '').replace(/\s+/g, '').split('');
  if (chars.length <= 2) return chars.join('');
  let mixed = chars;
  for (let i = 0; i < 4 && mixed.join('').toLowerCase() === chars.join('').toLowerCase(); i++) {
    mixed = shuffleQuizWords(chars);
  }
  return mixed.join('');
}

function updateScrambleCard() {
  if (quizIndex >= currentQuizWords.length) {
    finishQuizRun();
    return;
  }
  const w = currentQuizWords[quizIndex];
  document.getElementById('scrambleCounter').textContent = `${quizIndex + 1} / ${currentQuizWords.length}`;
  document.getElementById('scrambleProgress').style.width = `${(quizIndex / currentQuizWords.length) * 100}%`;
  document.querySelector('#quizScrambleView .quiz-mini-label').textContent =
    getScrambleDirectionText();
  document.getElementById('scrambleMeaning').textContent =
    scrambleDirection === 'en-to-ar' ? w.word : w.meaning;
  const scrambledText = scrambleDirection === 'en-to-ar' ? w.meaning : w.word;
  document.getElementById('scrambleLetters').innerHTML = scrambleWord(scrambledText)
      .split('')
      .map(ch => `<span>${escapeHtml(ch)}</span>`)
      .join('');
  const input = document.getElementById('scrambleInput');
  input.value = '';
  input.dir = scrambleDirection === 'en-to-ar' ? 'rtl' : 'ltr';
  input.placeholder = scrambleDirection === 'en-to-ar' ? 'اكتب المعنى هنا...' : 'اكتب الكلمة هنا...';
  setTimeout(() => input.focus(), 40);
}

function submitScrambleAnswer() {
  const w = currentQuizWords[quizIndex];
  if (!w) return;
  const input = document.getElementById('scrambleInput');
  const normalize = s => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
  const expected = scrambleDirection === 'en-to-ar' ? w.meaning : w.word;
  if (normalize(input.value) === normalize(expected)) {
    rememberQuizWord(w);
    currentStreak++;
    showStreakMsg(currentStreak);
  } else {
    currentStreak = 0;
    currentQuizMistakes++;
    triggerShakeEffect(document.getElementById('quizScrambleView'));
    safeVibrate(100);
    const { updatedWord } = forgetQuizWord(w);
    requeueForgotQuizWord(updatedWord, quizIndex);
    showToast(`الإجابة: ${expected}`);
  }
  quizIndex++;
  saveActiveQuizSession();
  updateScrambleCard();
}

function getMatchingWordById(wordId) {
  return (activeQuizSession?.words || currentQuizWords || [])
    .find((word) => String(word.id) === String(wordId)) || null;
}

function matchingPairColor(index) {
  const hues = [190, 272, 38, 328, 148, 218, 12, 92];
  return `hsl(${hues[index % hues.length]} 78% 58%)`;
}

function matchingEncodedId(value) {
  return sugAttr(value).replace(/'/g, '%27');
}

function renderMatchingBoard() {
  if (!matchingQuizState) return;
  const board = quizCore.currentMatchingBoard(matchingQuizState);
  if (!board) return;
  const totalBoards = matchingQuizState.boards.length;
  const boardNumber = matchingQuizState.boardIndex + 1;
  const wordsHost = document.getElementById('matchingWords');
  const meaningsHost = document.getElementById('matchingMeanings');
  const checkButton = document.getElementById('matchingCheckButton');
  const feedback = document.getElementById('matchingFeedback');
  const counter = document.getElementById('matchingCounter');
  const progress = document.getElementById('matchingProgress');
  if (!wordsHost || !meaningsHost || !checkButton) return;

  if (counter) counter.textContent = `المجموعة ${boardNumber} / ${totalBoards}`;
  if (progress) {
    const completed = matchingQuizState.completedWordCount;
    progress.style.width = `${Math.round((completed / Math.max(1, currentQuizWords.length)) * 100)}%`;
  }
  const pairIndexByWord = new Map(board.wordIds.map((wordId, index) => [wordId, index]));
  const assignedWordByMeaning = new Map(Object.entries(board.selections).map(([wordId, meaningId]) => [meaningId, wordId]));
  const firstWrongMeanings = new Set((board.incorrectWordIds || []).map((wordId) => board.firstAttemptSelections?.[wordId]).filter(Boolean));
  const boardLocked = board.phase === 'complete' || board.phase === 'revealed';

  wordsHost.innerHTML = board.wordIds.map((wordId, index) => {
    const word = getMatchingWordById(wordId);
    const paired = Boolean(board.selections[wordId]);
    const selected = matchingQuizState.pendingWordId === wordId;
    const correct = board.firstAttemptResults?.[wordId] === true;
    const incorrect = board.phase === 'correction' && board.incorrectWordIds.includes(wordId);
    const classes = [
      'matching-option', 'matching-word-option', paired ? 'is-paired' : '', selected ? 'is-selected' : '',
      correct ? 'is-correct is-locked' : '', incorrect ? 'is-incorrect' : '',
      board.phase === 'revealed' && !correct ? 'is-revealed' : '',
    ].filter(Boolean).join(' ');
    const disabled = boardLocked || correct;
    return `<button type="button" class="${classes}" style="--pair-color:${matchingPairColor(index)}" onclick="selectMatchingWord('${matchingEncodedId(wordId)}')" ${disabled ? 'disabled' : ''}>
      <span class="matching-pair-badge">${paired || correct || board.phase === 'revealed' ? index + 1 : '•'}</span>
      <span class="matching-option-label">${escapeHtml(word?.word || '')}</span>
    </button>`;
  }).join('');

  meaningsHost.innerHTML = board.meaningOrder.map((meaningId) => {
    const word = getMatchingWordById(meaningId);
    const assignedWordId = assignedWordByMeaning.get(meaningId) || '';
    const pairIndex = assignedWordId ? pairIndexByWord.get(assignedWordId) : -1;
    const locked = assignedWordId && board.firstAttemptResults?.[assignedWordId] === true;
    const incorrect = board.phase === 'correction' && firstWrongMeanings.has(meaningId);
    const classes = [
      'matching-option', 'matching-meaning-option', assignedWordId ? 'is-paired' : '',
      locked ? 'is-correct is-locked' : '', incorrect ? 'is-incorrect' : '',
      board.phase === 'revealed' && assignedWordId && !locked ? 'is-revealed' : '',
    ].filter(Boolean).join(' ');
    const color = pairIndex >= 0 ? matchingPairColor(pairIndex) : 'var(--accent)';
    return `<button type="button" class="${classes}" style="--pair-color:${color}" onclick="selectMatchingMeaning('${matchingEncodedId(meaningId)}')" ${boardLocked || locked ? 'disabled' : ''}>
      <span class="matching-pair-badge">${pairIndex >= 0 ? pairIndex + 1 : '•'}</span>
      <span class="matching-option-label">${escapeHtml(word?.meaning || '')}</span>
    </button>`;
  }).join('');

  const allPaired = board.wordIds.every((wordId) => Boolean(board.selections[wordId]));
  checkButton.disabled = !allPaired && !boardLocked;
  checkButton.textContent = boardLocked
    ? (boardNumber < totalBoards ? 'المجموعة التالية' : 'إنهاء الاختبار')
    : board.phase === 'correction'
      ? 'تحقق من التصحيح'
      : 'تحقق من إجاباتك';
  if (feedback) {
    if (board.phase === 'correction') {
      feedback.textContent = 'لديك بعض الإجابات تحتاج مراجعة. صحح الأزواج المعلّمة؛ نتيجتك الأولى محفوظة.';
    } else if (board.phase === 'revealed') {
      feedback.textContent = 'راجع الأزواج الصحيحة قبل المتابعة. لم تتغير نتيجة المحاولة الأولى.';
    } else if (board.phase === 'complete') {
      feedback.textContent = board.incorrectWordIds.length
        ? 'أكملت التصحيح. نتيجة المحاولة الأولى محفوظة.'
        : 'ممتاز، جميع الأزواج صحيحة من المحاولة الأولى.';
    } else if (matchingQuizState.pendingWordId) {
      feedback.textContent = 'الآن اختر المعنى المقابل لهذه الكلمة.';
    } else {
      feedback.textContent = 'اختر كلمة، ثم اختر معناها المقابل.';
    }
  }
}

window.selectMatchingWord = function(encodedWordId) {
  const board = quizCore.currentMatchingBoard(matchingQuizState);
  const wordId = decodeSugAttr(encodedWordId);
  if (!board || !wordId || board.firstAttemptResults?.[wordId] === true) return;
  matchingQuizState.pendingWordId = wordId;
  renderMatchingBoard();
  saveActiveQuizSession();
};

window.selectMatchingMeaning = function(encodedMeaningId) {
  const wordId = matchingQuizState?.pendingWordId;
  const meaningId = decodeSugAttr(encodedMeaningId);
  if (!wordId || !meaningId) {
    showToast('اختر كلمة أولاً، ثم اختر معناها.', 'info', 2400);
    return;
  }
  if (!quizCore.assignMatchingPair(matchingQuizState, wordId, meaningId)) return;
  matchingQuizState.pendingWordId = '';
  renderMatchingBoard();
  saveActiveQuizSession();
};

function finishOrAdvanceMatchingBoard() {
  const hasNext = quizCore.advanceMatchingBoard(matchingQuizState);
  quizIndex = matchingQuizState.completedWordCount;
  if (hasNext) {
    saveActiveQuizSession();
    renderMatchingBoard();
    return;
  }
  quizIndex = currentQuizWords.length;
  saveActiveQuizSession();
  finishQuizRun();
}

window.submitMatchingAnswers = function() {
  const board = quizCore.currentMatchingBoard(matchingQuizState);
  if (!board) return;
  if (board.phase === 'complete' || board.phase === 'revealed') {
    finishOrAdvanceMatchingBoard();
    return;
  }
  const result = quizCore.submitMatchingBoard(matchingQuizState, Date.now());
  if (!result.accepted) {
    showToast('اربط جميع الكلمات بمعانيها قبل التحقق.', 'warning', 3200);
    return;
  }
  if (result.firstAttemptResults.length) {
    hasStartedAnswering = true;
    result.firstAttemptResults.forEach((answer) => {
      const word = getMatchingWordById(answer.wordId);
      quizSessionResults.push({
        ...answer,
        wordKey: word?.wordKey || getWordMasteryKey(word),
      });
      if (!answer.correct) currentQuizMistakes += 1;
    });
  }
  activeQuizSession.matchingState = matchingQuizState;
  saveActiveQuizSession();
  renderMatchingBoard();
};

// ═══════════════════════════════════════════════════════
