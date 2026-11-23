(function attachLootLinguaNotificationRuntime(root) {
  'use strict';

  const store = root.LootLinguaNotificationStore;
  const engine = root.LootLinguaNotificationEngine;
  const sources = root.LootLinguaNotificationSources;
  if (!store || !engine || !sources) return;

  const URGENT_REENTRY_PRIORITY = 90;
  const PROMINENT_REENTRY_DELAY = 2 * engine.HOUR;
  let sessionProminentClaimed = false;
  let prominentClaimedAt = 0;
  let initialProminentPriority = 0;
  let urgentProminentOverrideClaimed = false;
  let eligibleAtInitialProminent = new Set();
  let evaluationGeneration = 0;
  let debounceTimer = null;
  let wakeTimer = null;
  let lastFacts = null;

  function currentOwner() {
    return String(root.auth?.currentUser?.uid || 'guest');
  }

  function learningInFront() {
    return Boolean(root.__entryExperienceActive || root.LootLinguaGateLessonView?.isOpen?.() ||
      root.hasActiveLearningQuiz?.() || document.body?.matches?.('.published-placement-mode, .quiz-active') ||
      root.LootLinguaSmartOnboarding?.quizInFront?.());
  }

  function clearWakeTimer() {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }

  function scheduleWake(result) {
    clearWakeTimer();
    if (document.visibilityState === 'hidden') return;
    const now = Date.now();
    const nextAt = Number(result?.nextAt) || 0;
    // Pending eligibility and the end-of-day streak window are checked while
    // visible. Long background timers are intentionally avoided.
    const delay = nextAt > now
      ? Math.min(15 * 60 * 1000, Math.max(1000, nextAt - now))
      : 15 * 60 * 1000;
    wakeTimer = setTimeout(() => evaluate('visible-wake'), delay);
  }

  async function evaluate(reason = 'manual') {
    const generation = ++evaluationGeneration;
    const ownerId = currentOwner();
    if (store.currentOwner() !== ownerId) store.switchOwner(ownerId);
    let facts;
    try {
      facts = await sources.collect({ ownerId, now: Date.now(), reason });
    } catch (error) {
      console.warn('[NotificationRuntime] Fact collection failed safely.', error?.message || error);
      return null;
    }
    if (generation !== evaluationGeneration || currentOwner() !== ownerId) return null;
    const previous = lastFacts;
    facts.lessonReminderDeferred = learningInFront();
    lastFacts = { ...facts, ownerId };
    const gateAccessChanged = JSON.stringify([previous?.gateLesson, previous?.lessonReminder, previous?.lessonReminderDeferred]) !==
      JSON.stringify([facts.gateLesson, facts.lessonReminder, facts.lessonReminderDeferred]);
    root.refreshQuizPracticeAvailability?.();
    const isSessionLikeReturn = reason === 'foreground' || reason === 'visible-wake';
    const canTryUrgentReentry = sessionProminentClaimed &&
      !urgentProminentOverrideClaimed &&
      initialProminentPriority < URGENT_REENTRY_PRIORITY &&
      isSessionLikeReturn &&
      facts.now - prominentClaimedAt >= PROMINENT_REENTRY_DELAY;
    const result = engine.evaluate(facts, store.getAll(), {
      ownerId,
      now: facts.now,
      allowProminent: !facts.lessonReminderDeferred && (!sessionProminentClaimed || canTryUrgentReentry),
      minProminentPriority: canTryUrgentReentry ? URGENT_REENTRY_PRIORITY : 0,
      excludeProminentOccurrenceKeys: canTryUrgentReentry ? [...eligibleAtInitialProminent] : [],
    });
    result.resolutions.forEach((resolution) => {
      store.resolve(resolution.id, resolution.reason, facts.now);
    });
    store.upsertMany(result.upserts, { reason: 'engine:' + reason });
    if (gateAccessChanged) store.refreshVisibility?.();
    if (result.selected) {
      const record = result.selected.record;
      if (!sessionProminentClaimed) {
        sessionProminentClaimed = true;
        prominentClaimedAt = facts.now;
        initialProminentPriority = Number(record.priority) || 0;
        eligibleAtInitialProminent = new Set(result.upserts
          .filter((item) => item.status === 'active')
          .map((item) => String(item.occurrenceKey || ''))
          .filter(Boolean));
      } else {
        urgentProminentOverrideClaimed = true;
      }
      root.showToast?.(
        `${record.title}: ${record.message}`,
        record.visualType,
        6200,
        { persist: false, notificationId: record.id }
      );
    }
    scheduleWake(result);
    return result;
  }

  function requestEvaluation(reason, delay = 180) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => evaluate(reason), Math.max(0, Number(delay) || 0));
  }

  function startWordReview(kind) {
    const context = sources.getActionContext();
    const keys = kind === 'due'
      ? context.dueWordKeys
      : kind === 'new'
        ? context.newWordKeys
        : context.weakWordKeys;
    if (typeof root.startNotificationWordReview === 'function') {
      return root.startNotificationWordReview(keys, { kind });
    }
    root.loadQuizView?.({ skipResume: true });
    return true;
  }

  async function handleAction(notificationId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const ownerId = currentOwner();
    const record = store.find(notificationId);
    if (!record || record.ownerId !== ownerId || record.status !== 'active' || learningInFront()) return false;
    const action = String(record.cta?.id || '');
    const gate = gateAction(record);
    if (root.LootLinguaGateLesson && (gate || action === 'resume-gate-lesson')) {
      const context = gate?.context || contextFor(record);
      if (!context) return false;
      const access = await root.LootLinguaJourneyCloud?.getGateLessonAccess?.(context).catch(() => null);
      if (currentOwner() !== ownerId || learningInFront() || store.find(record.id)?.status !== 'active') return false;
      if (action === 'resume-gate-lesson') {
        const reminder = access?.confirmed ? sources.lessonReminder(context, access) : null;
        if (!matchesReminder(record, reminder, Date.now())) { requestEvaluation('stale-lesson'); return false; }
        root.closeNotificationsPanel?.();
        const opened = await root.resumePublishedGateLesson?.(context, ownerId);
        if (opened && currentOwner() === ownerId) store.markVisibleRead([record.id]);
        else requestEvaluation('stale-lesson');
        return opened === true;
      }
      if (!access?.allowed) { requestEvaluation('stale-gate'); return false; }
    }
    store.markVisibleRead([record.id]);
    if ((!gate && ['review-due', 'practice-new-words', 'practice-weak-words'].includes(action)) || action === 'practice-gate-gap') {
      if (await root.LootLinguaDictionaryPages?.requireComplete() === false) return false;
      await sources.collect({ ownerId, now: Date.now(), reason: 'review-action' });
      if (currentOwner() !== ownerId || learningInFront()) return false;
    }
    const args = gate?.context || { ...record.context, ...record.cta?.args };
    let handled = true;
    if (action === 'open-treasure') root.loadTreasureView?.();
    else if (action === 'open-motivation-rewards') root.LootLinguaMotivation?.openHistory?.();
    else if (action === 'open-feature-discovery') handled = root.LootLinguaFeatureDiscovery?.open?.(String(args.feature || '')) === true;
    else if (action === 'resume-public-world-onboarding') {
      if (root.LootLinguaFeatureDiscovery?.isInteractiveJourneyActive?.()) return false;
      handled = await root.LootLinguaEntryExperienceController?.consumePendingJourneyIntent?.({ explicitDiscovery: true }) === true;
      if (handled) store.resolve(record.id, 'public-world-resumed');
      else { root.loadWorldsView?.(); handled = true; }
    }
    else if (gate?.context && ['start-quiz', 'resume-learning', 'review-due', 'practice-new-words', 'practice-weak-words'].includes(action)) {
      await root.openPublishedGate?.(args.worldId, args.rankId, args.gateId);
    }
    else if (action === 'review-due') handled = startWordReview('due');
    else if (action === 'practice-new-words') handled = startWordReview('new');
    else if (action === 'practice-weak-words') handled = startWordReview('weak');
    else if (action === 'practice-gate') {
      if (typeof root.openPublishedGatePractice === 'function') {
        handled = await root.openPublishedGatePractice(args.worldId, args.rankId, args.gateId) !== false;
      } else if (root.openPublishedGate && args.worldId && args.rankId && args.gateId) {
        await root.openPublishedGate(args.worldId, args.rankId, args.gateId);
      } else handled = false;
    } else if (action === 'practice-gate-gap') {
      const context = sources.getActionContext();
      handled = await root.startGateGapReview?.(context.gateWordKeys, args) !== false;
    } else if (action === 'start-quiz' || action === 'resume-learning') {
      root.loadQuizView?.({ skipResume: true });
    } else if (['open-ready-gate', 'open-unlocked-content'].includes(action)) {
      if (root.openPublishedGate && args.worldId && args.rankId && args.gateId) {
        await root.openPublishedGate(args.worldId, args.rankId, args.gateId);
      } else root.loadWorldsView?.();
    } else if (action === 'open-journey-target') {
      if (root.openPublishedGate && args.worldId && args.rankId && args.gateId) {
        await root.openPublishedGate(args.worldId, args.rankId, args.gateId);
      } else root.loadWorldsView?.();
    } else if (action === 'open-feedback') {
      root.LootLinguaFeedback?.open?.(record.id);
    } else handled = false;
    requestEvaluation(`cta:${action}`, 500);
    return handled;
  }

  root.handleNotificationAction = handleAction;
  root.dismissNotification = function(notificationId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const record = store.find(notificationId);
    store.dismiss([notificationId], Date.now(), 'user-dismissed');
    if (record?.notificationType === engine.TYPE.FEEDBACK_REQUEST) root.LootLinguaFeedback?.markDismissed?.();
  };

  const events = [
    'lootlingua:initial-data-ready',
    'lootlingua:profile-loaded',
    'lootlingua:word-mastery-changed',
    'lootlingua:word-mastery-snapshot',
    'lootlingua:journey-changed',
    'lootlingua:gate-lesson-changed',
    'lootlingua:gate-lesson-closed',
    'lootlingua:quiz-mode-changed',
    'lootlingua:surface-ready',
    'lootlingua:journey-cloud-ready',
    'lootlingua:trusted-quiz-completed',
    'lootlingua:learning-data-changed',
    'lootlingua:dictionary-page-state',
    'lootlingua:test-clock-changed',
  ];
  events.forEach((name) => root.addEventListener(name, () => {
    if (name === 'lootlingua:gate-lesson-closed' || name === 'lootlingua:quiz-mode-changed') store.refreshVisibility?.();
    requestEvaluation(name);
  }));
  root.addEventListener('lootlingua:auth-state', () => {
    evaluationGeneration += 1;
    if (store.currentOwner() !== currentOwner()) {
      lastFacts = null;
      sessionProminentClaimed = false;
      urgentProminentOverrideClaimed = false;
      eligibleAtInitialProminent.clear();
    }
    clearWakeTimer();
    store.switchOwner(currentOwner());
    requestEvaluation('auth-switch', 250);
  });
  root.addEventListener('storage', event => {
    if (event.key?.startsWith('lootlingua:gate-lesson:v1:' + currentOwner() + ':')) {
      store.refreshVisibility?.();
      requestEvaluation('lesson-other-tab');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestEvaluation('foreground', 50);
    else clearWakeTimer();
  });

  function contextFor(record) {
    const contract = root.LootLinguaGateLesson;
    const args = { ...record.context, ...record.cta?.args };
    return contract?.gateContext(args) || contract?.gateContext(args.officialReviewGate) || null;
  }

  function gateAction(record) {
    const contract = root.LootLinguaGateLesson;
    const args = { ...record.context, ...record.cta?.args };
    const knownAction = ['practice-gate', 'practice-gate-gap', 'open-ready-gate'].includes(record.cta?.id);
    const knownType = [engine.TYPE.GATE_REVIEW, engine.TYPE.GATE_PRACTICE, engine.TYPE.GATE_READY].includes(record.notificationType);
    const explicitSource = ['start-quiz', 'resume-learning', 'review-due', 'practice-new-words', 'practice-weak-words'].includes(record.cta?.id) &&
      contract?.hasGateIntent(args);
    return knownAction || knownType || explicitSource ? { context: contextFor(record) } : null;
  }

  function sameGate(left, right) {
    return Boolean(left && right && left.worldId === right.worldId && left.rankId === right.rankId && left.gateId === right.gateId);
  }

  function matchesReminder(record, reminder, now) {
    return sameGate(contextFor(record), reminder) && record.context?.episodeKey === reminder.episodeKey &&
      now >= reminder.activityAt + engine.DAY;
  }

  function canDisplayGateAction(record) {
    const gate = gateAction(record);
    const reminder = record.cta?.id === 'resume-gate-lesson';
    if (!gate && !reminder) return true;
    if (!root.LootLinguaGateLesson) return true;
    if (record.ownerId !== currentOwner() || lastFacts?.ownerId !== currentOwner()) return false;
    if (reminder) {
      return lastFacts.lessonReminderConfirmed && Boolean(lastFacts.lessonReminder) && !learningInFront() &&
        sameGate(contextFor(record), lastFacts.gateLesson) && matchesReminder(record,
          sources.lessonReminder(lastFacts.gateLesson, lastFacts.lessonAccess), Date.now());
    }
    return Boolean(lastFacts.gateLesson?.allowed && sameGate(gate.context, lastFacts.gateLesson));
  }

  const API = Object.freeze({
    evaluate,
    canDisplayGateAction,
    learningInFront,
    requestEvaluation,
    getLastFacts: () => lastFacts ? { ...lastFacts } : null,
    hasClaimedProminent: () => sessionProminentClaimed,
    getProminentState: () => ({
      claimed: sessionProminentClaimed,
      claimedAt: prominentClaimedAt,
      initialPriority: initialProminentPriority,
      urgentOverrideClaimed: urgentProminentOverrideClaimed,
    }),
  });
  Object.defineProperty(root, 'LootLinguaNotificationRuntime', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestEvaluation('boot', 800), { once: true });
  } else requestEvaluation('boot', 800);
})(typeof window !== 'undefined' ? window : globalThis);
