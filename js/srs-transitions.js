function computeSrsUpdate(word, correct, sessionId, answeredAt) {
  const state = getWordMasteryState(word);
  const wasMasteredBefore = Boolean(state.mastered_once);
  const day = getQuizDay(answeredAt);
  let mastered = false;
  let advanced = false;
  const previousStatus = state.mastery_status;
  state.last_quizzed_at = answeredAt;
  state.quiz_seen_count = Math.max(0, Number(state.quiz_seen_count) || 0) + 1;

  if (correct) {
    const separateSession = state.last_recall_session_id !== sessionId;
    const differentDay = state.last_recall_day !== day;
    const canIncrement = separateSession && differentDay;
    if (canIncrement) {
      const nextStreak = Math.min(3, (state.mastery_streak || 0) + 1);
      state.mastery_streak = nextStreak;
      state.last_recalled_at = answeredAt;
      state.last_recall_day = day;
      state.last_recall_session_id = sessionId;
      if (nextStreak === 1 && !state.first_recalled_at) state.first_recalled_at = answeredAt;
      if (nextStreak === 1) {
        state.mastery_status = 'Learning';
        advanced = true;
      }
      else if (nextStreak === 2) {
        state.mastery_status = 'Reviewing';
        advanced = true;
      }
      else if (nextStreak === 3) {
        const firstAt = Number(state.first_recalled_at) || answeredAt;
        if (answeredAt - firstAt >= SRS_MASTERY_WINDOW_MS) {
          state.mastery_status = 'Mastered';
          state.mastered_once = true;
          mastered = true;
          advanced = true;
        } else {
          state.mastery_status = 'Reviewing';
          state.mastery_streak = 2;
          advanced = previousStatus !== 'Reviewing';
        }
      }
    }
  } else {
    if (state.mastery_status === 'Mastered') {
      state.mastery_status = 'Reviewing';
      state.mastery_streak = 2;
    } else if (state.mastered_once && (state.mastery_status === 'Reviewing' || state.mastery_streak >= 2)) {
      state.mastery_status = 'Learning';
      state.mastery_streak = 0;
    } else {
      const nextStreak = Math.max(0, (state.mastery_streak || 0) - 1);
      state.mastery_streak = nextStreak;
      state.mastery_status = nextStreak >= 2 ? 'Reviewing' : 'Learning';
    }
  }

  let transition = '';
  if (correct && previousStatus === 'New' && state.mastery_status === 'Learning') transition = 'new_learning';
  else if (correct && previousStatus === 'Learning' && state.mastery_status === 'Reviewing') transition = 'learning_reviewing';
  else if (correct && mastered && state.mastery_status === 'Mastered') {
    transition = wasMasteredBefore ? 'remastered' : 'reviewing_mastered';
  }
  return { state, mastered, advanced, transition, previousStatus, nextStatus: state.mastery_status };
}

async function awardWordTransitionXP(word, update, sessionId) {
  const transition = update?.transition;
  if (!transition) return 0;
  const state = update.state;
  const wordKey = getWordMasteryKey(word);
  if (!wordKey) return 0;
  const earned = new Set(state.earnedTransitions || []);
  let amount = 0;
  let reason = '';
  let eventId = '';

  if (transition === 'new_learning' && !earned.has(transition)) {
    amount = XP_REWARDS.newToLearning;
    reason = 'word_transition_new_learning';
    eventId = `word_transition:${wordKey}:new_learning`;
  } else if (transition === 'learning_reviewing' && !earned.has(transition)) {
    amount = XP_REWARDS.learningToReviewing;
    reason = 'word_transition_learning_reviewing';
    eventId = `word_transition:${wordKey}:learning_reviewing`;
  } else if (transition === 'reviewing_mastered' && !state.hasEarnedMasteryXP && !earned.has(transition)) {
    amount = XP_REWARDS.reviewingToMastered;
    reason = 'word_mastered_first';
    eventId = `word_transition:${wordKey}:reviewing_mastered`;
  } else if (transition === 'remastered' && (Number(state.remasteryAwardCount) || 0) < 1) {
    amount = XP_REWARDS.remastered;
    reason = 'word_remastered';
    eventId = `word_transition:${wordKey}:remastered:1`;
  }
  if (!amount) return 0;

  const metadata = { eventId, wordKey, sessionId, queueOnFailure: true };
  const awarded = await awardXP(amount, reason, metadata);
  if (metadata.awardStatus !== 'awarded' && metadata.awardStatus !== 'duplicate') return 0;

  if (transition === 'remastered') {
    state.remasteryAwardCount = Math.max(1, Number(state.remasteryAwardCount) || 0);
  } else {
    earned.add(transition);
    state.earnedTransitions = [...earned];
  }
  if (transition === 'reviewing_mastered') {
    state.firstMasteredAt = state.firstMasteredAt || Date.now();
    state.hasEarnedMasteryXP = true;
  }
  state.xpEconomyVersion = XP_ECONOMY_VERSION;
  return awarded;
}

