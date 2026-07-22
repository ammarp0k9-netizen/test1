function getWordTransitionXPRequest(word, update, sessionId) {
  const transition = update?.transition;
  const state = update?.state;
  const wordKey = getWordMasteryKey(word);
  if (!transition || !state || !wordKey) return null;
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
  if (!amount) return null;
  return {
    amount,
    reason,
    metadata: { eventId, wordKey, sessionId, queueOnFailure: true },
    earned,
    transition,
    state,
  };
}

async function awardWordTransitionXPBatch(entries, sessionId) {
  const requests = entries.map((entry) => getWordTransitionXPRequest(
    entry.word,
    entry.update,
    sessionId
  ));
  const compact = requests.filter(Boolean);
  const batch = compact.length
    ? await awardXPBatch(compact)
    : { awards: [], total: 0, pendingCount: 0 };
  let compactIndex = 0;
  const awards = requests.map((request) => {
    if (!request) return 0;
    const awarded = batch.awards[compactIndex] || 0;
    compactIndex += 1;
    const status = request.metadata.awardStatus;
    if (status !== 'awarded' && status !== 'duplicate') return 0;
    if (request.transition === 'remastered') {
      request.state.remasteryAwardCount = Math.max(
        1,
        Number(request.state.remasteryAwardCount) || 0
      );
    } else {
      request.earned.add(request.transition);
      request.state.earnedTransitions = [...request.earned];
    }
    if (request.transition === 'reviewing_mastered') {
      request.state.firstMasteredAt = request.state.firstMasteredAt || Date.now();
      request.state.hasEarnedMasteryXP = true;
    }
    request.state.xpEconomyVersion = XP_ECONOMY_VERSION;
    return awarded;
  });
  return {
    awards,
    total: awards.reduce((sum, amount) => sum + amount, 0),
    pendingCount: batch.pendingCount || 0,
  };
}

window.awardWordTransitionXPBatch = awardWordTransitionXPBatch;
