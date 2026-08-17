(function attachLootLinguaNotificationSources(root) {
  'use strict';

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  let actionCache = {
    dueWordKeys: [], gateWordKeys: [], newWordKeys: [], weakWordKeys: [],
  };

  function timestamp(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return Math.max(0, value.toMillis());
    if (typeof value?.toDate === 'function') return Math.max(0, value.toDate().getTime());
    if (value instanceof Date) return Math.max(0, value.getTime());
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  function wordKey(word, index) {
    return String(root.getWordMasteryKey?.(word) || root.LootLinguaWordLifecycle?.wordKeyOf?.(word) || word?.wordKey || word?.id || `word-${index}`);
  }

  function mastery(word) {
    return root.getWordMasteryState?.(word) || {
      mastery_status: word?.mastery_status || 'New',
      last_quizzed_at: word?.last_quizzed_at || null,
      last_recalled_at: word?.last_recalled_at || null,
    };
  }

  function dueInfo(word, state, now) {
    if (typeof root.getQuizDueInfo === 'function') return root.getQuizDueInfo(word, state, now);
    const status = String(state?.mastery_status || 'New');
    const last = timestamp(state?.last_quizzed_at || state?.last_recalled_at);
    const interval = status === 'Mastered' ? 7 * DAY : DAY;
    const dueAt = status === 'New' ? 0 : (last ? last + interval : 0);
    return { dueAt, isDue: status !== 'New' && (!dueAt || dueAt <= now), overdueMs: dueAt ? Math.max(0, now - dueAt) : 0 };
  }

  function visibleWords(ownerId) {
    if (typeof root.readWordsFromStorage === 'function') {
      return root.readWordsFromStorage('normal', ownerId === 'guest' ? 'guest' : ownerId)
        .filter((word) => word && word.hiddenFromDictionary !== true);
    }
    return (Array.isArray(root.words) ? root.words : []).filter((word) => word && word.hiddenFromDictionary !== true);
  }

  function stableHash(values) {
    let hash = 2166136261;
    String(values).split('').forEach((char) => {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return (hash >>> 0).toString(36);
  }

  function reviewFacts(words, now) {
    const all = words.map((word, index) => {
      const state = mastery(word);
      return { word, state, key: wordKey(word, index), due: dueInfo(word, state, now) };
    });
    const active = all.filter((item) => item.state.mastery_status !== 'New');
    const due = active.filter((item) => item.due.isDue);
    const oldest = due.reduce((value, item) => Math.min(value, item.due.dueAt || timestamp(item.state.last_recalled_at) || now), Infinity);
    return {
      activeCount: active.length,
      dueCount: due.length,
      oldestDueAt: Number.isFinite(oldest) ? oldest : 0,
      episodeKey: Number.isFinite(oldest) ? `due-${oldest}` : '',
      dueWordKeys: due.map((item) => item.key),
      dueKeySet: new Set(due.map((item) => item.key)),
      all,
    };
  }

  function groupNewWords(all, now) {
    const candidates = all.filter((item) => {
      const createdAt = timestamp(item.word?.createdAt);
      const practicedAt = timestamp(item.state?.last_quizzed_at || item.state?.last_recalled_at);
      return createdAt > 0 && !practicedAt && item.state?.mastery_status === 'New';
    }).sort((left, right) => timestamp(left.word.createdAt) - timestamp(right.word.createdAt));
    const batches = [];
    candidates.forEach((item) => {
      const at = timestamp(item.word.createdAt);
      const current = batches[batches.length - 1];
      if (!current || at - current.lastAt > 6 * HOUR) batches.push({ firstAt: at, lastAt: at, items: [item] });
      else {
        current.lastAt = at;
        current.items.push(item);
      }
    });
    const eligible = batches.filter((batch) => batch.items.length >= 6 && now >= batch.firstAt).sort((a, b) => a.firstAt - b.firstAt)[0];
    if (!eligible) return { unreviewedCount: 0, batchCreatedAt: 0, batchId: '', wordKeys: [] };
    const keys = eligible.items.map((item) => item.key);
    return {
      unreviewedCount: keys.length,
      batchCreatedAt: eligible.firstAt,
      batchId: `b${stableHash(`${eligible.firstAt}|${keys.slice().sort().join('|')}`)}`,
      wordKeys: keys,
    };
  }

  function quizFacts(all, newWords, now) {
    const history = typeof root.readQuizExposureHistory === 'function' ? root.readQuizExposureHistory() : [];
    const localVerifiedAt = (Array.isArray(history) ? history : [])
      .filter((entry) => entry?.mode === 'verified')
      .reduce((latest, entry) => Math.max(latest, timestamp(entry?.completedAt || entry?.at)), 0);
    // last_quizzed_at is the historic verified-quiz fallback. A recall/flashcard
    // touch alone must not end the no-quiz episode.
    const masteryQuizAt = all.reduce((latest, item) => Math.max(
      latest,
      timestamp(item.state?.last_quizzed_at)
    ), 0);
    const createdAnchor = all.reduce((latest, item) => Math.max(latest, timestamp(item.word?.createdAt)), 0);
    const verifiedCount = (Array.isArray(history) ? history : [])
      .filter((entry) => entry?.mode === 'verified').length;
    return {
      localVerifiedAt,
      verifiedCount,
      lastTrustedQuizAt: Math.max(localVerifiedAt, masteryQuizAt),
      learningAnchorAt: Math.max(createdAnchor, timestamp(newWords.batchCreatedAt)),
    };
  }

  function weakFacts(review, now) {
    const weak = review.all.filter((item) => {
      if (review.dueKeySet.has(item.key)) return false;
      if (!item.word?.starred && Number(item.word?.forgetCount) < 2) return false;
      const last = timestamp(item.state?.last_quizzed_at || item.state?.last_recalled_at || item.word?.createdAt);
      return last > 0 && now - last >= 3 * DAY;
    });
    const oldestAt = weak.reduce((oldest, item) => Math.min(
      oldest,
      timestamp(item.state?.last_quizzed_at || item.state?.last_recalled_at || item.word?.createdAt)
    ), Infinity);
    return {
      unreviewedCount: weak.length,
      oldestAt: Number.isFinite(oldestAt) ? oldestAt : 0,
      episodeKey: Number.isFinite(oldestAt) ? `weak-${oldestAt}` : '',
      wordKeys: weak.map((item) => item.key),
    };
  }

  function chestFacts(now) {
    try {
      const availability = typeof root.getLootAvailability === 'function'
        ? root.getLootAvailability()
        : null;
      const state = availability?.state || (typeof root.getLootState === 'function' ? root.getLootState() : {});
      const lastOpenAt = timestamp(state?.lastOpenAt);
      const structuralProgressAt = Math.max(
        timestamp(progress?.loadedAt),
        timestamp(progress?.clearedAt),
        timestamp(progress?.unlockedAt),
        timestamp(journey?.startedAt)
      ) || timestamp(progress?.lastActivityAt || journey?.updatedAt);
      return {
        hasOpenedBefore: lastOpenAt > 0,
        lastOpenAt,
        readyAt: lastOpenAt ? lastOpenAt + DAY : 0,
        ready: Boolean(lastOpenAt && (availability ? availability.ready : now >= lastOpenAt + DAY)),
        lockedByXp: Number(availability?.lockedXP ?? state?.lockedXP) > 0,
      };
    } catch (_) {
      return {};
    }
  }

  async function journeyFacts() {
    const api = root.LootLinguaJourneyCloud;
    if (!root.auth?.currentUser || !api?.getActiveJourney) return {};
    try {
      const journey = await api.getActiveJourney();
      if (!journey?.activeRankId || !journey?.activeGateId) return {};
      const worldId = String(journey.worldId || '');
      const rankId = String(journey.activeRankId || '');
      const gateId = String(journey.activeGateId || '');
      const progress = await api.getGateProgress(worldId, rankId, gateId);
      let gateLabel = '';
      try {
        const gate = await root.LootLinguaPublishedContent?.getPublishedGate?.(worldId, rankId, gateId);
        gateLabel = String(gate?.name || gate?.title || gate?.label || '');
      } catch (_) {}
      let trusted = null;
      try { trusted = await api.getGateNotificationFacts?.(worldId, rankId, gateId, { progress }); } catch (_) {}
      const readyAt = timestamp(progress?.readyAt);
      const unlockedAt = timestamp(progress?.unlockedAt);
      return {
        journey: {
          actionable: ['available', 'learning', 'ready'].includes(String(progress?.status || '')),
          worldId, rankId, gateId, gateLabel,
          lastProgressAt: structuralProgressAt,
        },
        gatePractice: {
          actionable: ['learning'].includes(String(progress?.status || '')) && Boolean(progress?.loadedAt),
          worldId, rankId, gateId, gateLabel,
          loadedAt: timestamp(progress?.loadedAt),
          newestLinkedAt: timestamp(trusted?.newestLinkedAt || progress?.loadedAt),
          unpracticedCount: Math.max(0, Number(trusted?.unpracticedCount) || 0),
          wordKeys: Array.isArray(trusted?.unpracticedWordKeys) ? trusted.unpracticedWordKeys.map(String) : [],
        },
        gateReady: {
          ready: progress?.status === 'ready' && readyAt > 0,
          readyAt, worldId, rankId, gateId, gateLabel,
        },
        contentUnlocked: {
          available: progress?.status === 'available' && unlockedAt > 0 && Boolean(progress?.unlockedByGateId),
          unlockedAt, worldId, rankId, gateId, targetLabel: gateLabel,
        },
      };
    } catch (error) {
      if (!['auth/missing-user', 'journey/auth-required'].includes(String(error?.code || ''))) {
        console.warn('[NotificationSources] Journey facts unavailable.', error?.message || error);
      }
      return {};
    }
  }

  async function collect(options = {}) {
    const now = timestamp(options.now) || Date.now();
    const ownerId = String(options.ownerId || root.auth?.currentUser?.uid || 'guest');
    const words = visibleWords(ownerId);
    const review = reviewFacts(words, now);
    const newWords = groupNewWords(review.all, now);
    const quiz = quizFacts(review.all, newWords, now);
    if (ownerId !== 'guest' && root.LootLinguaNotificationCloud?.latestTrustedQuizAt) {
      try { quiz.lastTrustedQuizAt = Math.max(quiz.lastTrustedQuizAt, await root.LootLinguaNotificationCloud.latestTrustedQuizAt()); } catch (_) {}
    }
    const weakWords = weakFacts(review, now);
    const journey = await journeyFacts();
    const quizView = document.getElementById('quizView');
    const quizOpen = Boolean(quizView && quizView.offsetParent !== null && quizView.style.display !== 'none');
    const feedbackSubmitted = localStorage.getItem(`lootlingua_feedback_submitted_v1_${ownerId}`) === '1';
    const feedbackDismissedAt = timestamp(localStorage.getItem(`lootlingua_feedback_dismissed_at_v1_${ownerId}`));
    const feedbackCooldownOver = !feedbackDismissedAt || now - feedbackDismissedAt >= 90 * DAY;
    const feedbackEligible = !feedbackSubmitted && feedbackCooldownOver && !quizOpen &&
      !root.__entryExperienceActive && words.length >= 10 && Number(quiz.verifiedCount) >= 1 &&
      (ownerId === 'guest' || Boolean(journey.journey?.actionable));
    const profileLastActivity = String(localStorage.getItem('lastActivityDate') || '');
    const lastLearningAt = Math.max(
      quiz.lastTrustedQuizAt,
      review.all.reduce((latest, item) => Math.max(latest,
        timestamp(item.word?.createdAt), timestamp(item.state?.last_quizzed_at), timestamp(item.state?.last_recalled_at)
      ), 0),
      timestamp(journey.journey?.lastProgressAt)
    );
    actionCache = {
      dueWordKeys: review.dueWordKeys,
      gateWordKeys: journey.gatePractice?.wordKeys || [],
      newWordKeys: newWords.wordKeys,
      weakWordKeys: weakWords.wordKeys,
      journey: journey.journey || {},
    };
    return {
      now,
      wordCount: words.length,
      chest: chestFacts(now),
      streak: {
        count: Math.max(0, Number(localStorage.getItem('dailyStreak')) || 0),
        lastActivityDate: profileLastActivity,
        freezeCount: Math.max(0, Number(localStorage.getItem('lootlinguaStreakFreezes')) || 0),
      },
      review: {
        dueCount: review.dueCount,
        activeCount: review.activeCount,
        episodeKey: review.episodeKey,
      },
      newWords,
      quiz,
      weakWords,
      inactivity: { lastLearningAt },
      feedback: {
        eligible: feedbackEligible,
        trustedQuizCount: Math.max(0, Number(quiz.verifiedCount) || 0),
        eligibleSince: Math.max(quiz.localVerifiedAt, quiz.lastTrustedQuizAt),
        // A dismissed request may be offered again only after its long cooldown.
        // A submitted request never reaches this branch because feedbackEligible is false.
        episodeKey: feedbackEligible
          ? `meaningful-use-v1:${feedbackDismissedAt ? Math.floor((now - feedbackDismissedAt) / (90 * DAY)) : 0}`
          : '',
      },
      journey: journey.journey || {},
      gatePractice: journey.gatePractice || {},
      gateReady: journey.gateReady || {},
      contentUnlocked: journey.contentUnlocked || {},
    };
  }

  function getActionContext() {
    return {
      ...actionCache,
      dueWordKeys: [...actionCache.dueWordKeys],
      gateWordKeys: [...actionCache.gateWordKeys],
      newWordKeys: [...actionCache.newWordKeys],
      weakWordKeys: [...actionCache.weakWordKeys],
    };
  }

  const API = Object.freeze({ timestamp, collect, getActionContext });
  Object.defineProperty(root, 'LootLinguaNotificationSources', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
