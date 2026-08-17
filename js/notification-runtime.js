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
    lastFacts = facts;
    const isSessionLikeReturn = reason === 'foreground' || reason === 'visible-wake';
    const canTryUrgentReentry = sessionProminentClaimed &&
      !urgentProminentOverrideClaimed &&
      initialProminentPriority < URGENT_REENTRY_PRIORITY &&
      isSessionLikeReturn &&
      facts.now - prominentClaimedAt >= PROMINENT_REENTRY_DELAY;
    const result = engine.evaluate(facts, store.getAll(), {
      ownerId,
      now: facts.now,
      allowProminent: !sessionProminentClaimed || canTryUrgentReentry,
      minProminentPriority: canTryUrgentReentry ? URGENT_REENTRY_PRIORITY : 0,
      excludeProminentOccurrenceKeys: canTryUrgentReentry ? [...eligibleAtInitialProminent] : [],
    });
    result.resolutions.forEach((resolution) => {
      store.resolve(resolution.id, resolution.reason, facts.now);
    });
    store.upsertMany(result.upserts, { reason: `engine:${reason}` });
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
    const record = store.find(notificationId);
    if (!record || record.status !== 'active') return false;
    store.markVisibleRead([record.id]);
    const action = String(record.cta?.id || '');
    const args = record.cta?.args || record.context || {};
    let handled = true;
    if (action === 'open-treasure') root.loadTreasureView?.();
    else if (action === 'review-due') handled = startWordReview('due');
    else if (action === 'practice-new-words') handled = startWordReview('new');
    else if (action === 'practice-weak-words') handled = startWordReview('weak');
    else if (action === 'practice-gate-gap') {
      const context = sources.getActionContext();
      handled = root.startGateGapReview?.(context.gateWordKeys, args) !== false;
    } else if (action === 'start-quiz' || action === 'resume-learning') {
      root.loadQuizView?.({ skipResume: false });
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
    'lootlingua:journey-cloud-ready',
    'lootlingua:trusted-quiz-completed',
    'lootlingua:learning-data-changed',
  ];
  events.forEach((name) => root.addEventListener(name, () => requestEvaluation(name)));
  root.addEventListener('lootlingua:auth-state', () => {
    evaluationGeneration += 1;
    clearWakeTimer();
    store.switchOwner(currentOwner());
    requestEvaluation('auth-switch', 250);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestEvaluation('foreground', 50);
    else clearWakeTimer();
  });

  const API = Object.freeze({
    evaluate,
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
