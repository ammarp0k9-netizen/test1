async function commitVerifiedQuizResults() {
  if (!activeQuizSession || !isVerifiedQuizMode(activeQuizSession.mode)) return { xp: 0, masteredCount: 0, correctCount: 0, total: 0 };
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

  const sourceWords = getQuizSourceWords(activeQuizSession.source || currentQuizSource);
  for (const word of sourceWords) {
    const result = byWord.get(String(word.id));
    if (!result) continue;
    if (result.correct) correctCount++;
    const update = computeSrsUpdate(word, result.correct, activeQuizSession.id, result.answeredAt || Date.now());
    const awarded = await awardWordTransitionXP(word, update, activeQuizSession.id);
    xp += awarded;
    if (update.advanced && awarded > 0) {
      advancedWords.push({ word: word.word, nextStatus: update.nextStatus });
    }
    const wordKey = getWordMasteryKey(word);
    if (update.mastered && wordKey && !masteredIds.has(wordKey)) {
      masteredIds.add(wordKey);
      masteredCount++;
    }
    const forgetCount = result.correct ? Math.max((word.forgetCount || 0) - 1, 0) : (word.forgetCount || 0) + 1;
    const updated = { ...word, ...update.state, forgetCount };
    updateQuizWordInSource(word.id, updated, word.quizSource || activeQuizSession.source || currentQuizSource);
  }

  const totalUnique = byWord.size;

  if (xp > 0) {
    showXPBadge(xp, null, false);
    if (advancedWords.length > 0) {
      const first = advancedWords[0];
      const statusLabel = first.nextStatus === 'Mastered' ? 'متقنة' : first.nextStatus === 'Reviewing' ? 'قريبة من الإتقان' : 'قيد التعلم';
      const extra = advancedWords.length > 1 ? ` و${advancedWords.length - 1} كلمة أخرى` : '';
      pushNotification(`زاد مؤشر الإتقان: ${first.word} أصبحت ${statusLabel}${extra}. +${xp} XP`, 'success');
    }
  }
  if (masteredCount > 0) recordChestMasteredWords(masteredIds);
  if (isEditableDictionaryView()) render();
  return { xp, masteredCount, correctCount, total: totalUnique };
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

let quizFinishInFlight = false;

async function finishQuizRun() {
  if (quizFinishInFlight) return;
  quizFinishInFlight = true;
  stopTimeAttackTimer();
  const verified = activeQuizSession && isVerifiedQuizMode(activeQuizSession.mode);
  const commit = verified
    ? await commitVerifiedQuizResults()
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
    playQuizCompletionSound();
    if (accuracy >= 0.9 || commit.xp > 0) launchConfetti();
  }
  clearActiveQuizSessionStorage();
  activeQuizSession = null;
  currentQuizExposureSessionId = '';
  currentQuizExposureMode = '';
  flashcardSessionOutcomes = new Map();
  quizSessionResults = [];
  hasStartedAnswering = false;
  showToast(verified
    ? `تم حفظ الاختبار: ${Math.round(accuracy * 100)}% دقة${commit.xp ? `، +${commit.xp} XP` : ''}`
    : 'تمت مراجعة البطاقات بدون XP. أحسنت!',
    'success',
    3600);
  quizFinishInFlight = false;
  setTimeout(closeQuiz, 600);
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

// ═══════════════════════════════════════════════════════
