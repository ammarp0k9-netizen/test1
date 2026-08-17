(function attachLootLinguaNotificationEngine(root) {
  'use strict';

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const TYPE = Object.freeze({
    CHEST_READY: 'reminder.chest.ready',
    STREAK_RISK: 'reminder.streak.risk',
    REVIEW_DUE: 'reminder.review.due',
    GATE_PRACTICE: 'reminder.gate.practice',
    WORDS_NEW: 'reminder.words.new',
    QUIZ_INACTIVE: 'reminder.quiz.inactive',
    JOURNEY_INACTIVE: 'reminder.journey.inactive',
    GATE_READY: 'progress.gate.ready',
    CONTENT_UNLOCKED: 'progress.content.unlocked',
    WORDS_WEAK: 'reminder.words.weak',
    INACTIVITY: 'reminder.inactivity',
    FEEDBACK_REQUEST: 'feedback.request',
  });

  const TABLE = Object.freeze({
    [TYPE.CHEST_READY]: { priority: 28, actionGroup: 'treasure', delay: 0, maxShows: 1 },
    [TYPE.STREAK_RISK]: { priority: 95, actionGroup: 'practice', delay: 0, maxShows: 2 },
    [TYPE.REVIEW_DUE]: { priority: 78, actionGroup: 'review', delay: 4 * HOUR, maxShows: 3 },
    [TYPE.GATE_PRACTICE]: { priority: 66, actionGroup: 'gate-practice', delay: 21 * HOUR, maxShows: 2 },
    [TYPE.WORDS_NEW]: { priority: 48, actionGroup: 'new-words', delay: 30 * HOUR, maxShows: 1 },
    [TYPE.QUIZ_INACTIVE]: { priority: 58, actionGroup: 'practice', delay: 4 * DAY, maxShows: 2 },
    [TYPE.JOURNEY_INACTIVE]: { priority: 61, actionGroup: 'journey', delay: 3 * DAY, maxShows: 2 },
    [TYPE.GATE_READY]: { priority: 91, actionGroup: 'gate-ready', delay: 0, maxShows: 1 },
    [TYPE.CONTENT_UNLOCKED]: { priority: 82, actionGroup: 'journey-unlock', delay: 0, maxShows: 2 },
    [TYPE.WORDS_WEAK]: { priority: 52, actionGroup: 'weak-words', delay: 3 * DAY, maxShows: 2 },
    [TYPE.INACTIVITY]: { priority: 44, actionGroup: 'return', delay: 7 * DAY, maxShows: 2 },
    [TYPE.FEEDBACK_REQUEST]: { priority: 20, actionGroup: 'feedback', delay: 0, maxShows: 1 },
  });

  function numeric(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === 'function') return value.toMillis();
    const result = Number(value);
    return Number.isFinite(result) ? Math.max(0, result) : 0;
  }

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(numeric(value) || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function localDayEnd(value) {
    const date = value instanceof Date ? new Date(value) : new Date(numeric(value) || Date.now());
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  function occurrence(type, ...parts) {
    return [type, ...parts.map((part) => clean(part) || 'none')].join(':');
  }

  function currentRecord(existing, occurrenceKey) {
    return existing.find((record) => clean(record?.occurrenceKey) === occurrenceKey) || null;
  }

  function messageFor(type, facts, context) {
    switch (type) {
      case TYPE.CHEST_READY:
        return { title: 'كنزك جاهز', message: 'صندوقك اليومي صار جاهزًا. افتحه وخذ مكافأتك.', cta: ['open-treasure', 'افتح الكنز'], visualType: 'success' };
      case TYPE.STREAK_RISK: {
        const freeze = Number(facts.streak?.freezeCount) > 0 ? ' لديك Streak Freeze احتياطي، لكن الممارسة الآن تحفظ يومك.' : '';
        const due = Number(facts.review?.dueCount) > 0 ? ` راجع ${facts.review.dueCount} كلمات مستحقة بخطوة قصيرة.` : ' أكمل Quiz موثوقًا قصيرًا قبل نهاية اليوم.';
        return { title: 'حافظ على سلسلتك', message: `سلسلتك ${facts.streak?.count || 0} أيام وما سجّلت ممارسة اليوم.${due}${freeze}`, cta: [Number(facts.review?.dueCount) ? 'review-due' : 'start-quiz', 'ابدأ الممارسة'], visualType: 'warning' };
      }
      case TYPE.REVIEW_DUE:
        return { title: 'مراجعاتك بانتظارك', message: `لديك ${context.dueCount} كلمات مستحقة للمراجعة. جلسة قصيرة الآن تمنع تراكمها.`, cta: ['review-due', 'راجع الآن'], visualType: context.severe ? 'danger' : 'warning' };
      case TYPE.GATE_PRACTICE:
        return { title: 'تدرّب قبل الاختبار', message: `في بوابة ${context.gateLabel || 'رحلتك'} ${context.unpracticedCount} كلمات موثوقة لم تتمرن عليها بعد.`, cta: ['practice-gate-gap', 'تدرّب على الكلمات'], visualType: 'warning' };
      case TYPE.WORDS_NEW:
        return { title: 'ثبّت كلماتك الجديدة', message: `أضفت ${context.wordCount} كلمات جديدة ولم تراجعها بعد. اختبر نفسك عليها الآن.`, cta: ['practice-new-words', 'راجع الكلمات'], visualType: 'info' };
      case TYPE.QUIZ_INACTIVE:
        return { title: 'حان وقت اختبار قصير', message: `لديك ${context.wordCount} كلمات، ومرّ ${context.days} أيام دون Quiz مكتمل وموثوق.`, cta: ['start-quiz', 'ابدأ Quiz'], visualType: 'info' };
      case TYPE.JOURNEY_INACTIVE:
        return { title: 'رحلتك تنتظرك', message: `بوابة ${context.gateLabel || 'رحلتك الحالية'} ما زالت قابلة للتقدم. عُد بخطوة صغيرة.`, cta: ['open-journey-target', 'تابع الرحلة'], visualType: 'info' };
      case TYPE.GATE_READY:
        return { title: 'البوابة جاهزة', message: `أكملت شروط ${context.gateLabel || 'البوابة الحالية'}. يمكنك دخول الاختبار الآن.`, cta: ['open-ready-gate', 'افتح البوابة'], visualType: 'success' };
      case TYPE.CONTENT_UNLOCKED:
        return { title: 'محتوى جديد انفتح', message: `${context.targetLabel || 'المحطة التالية'} أصبحت متاحة في رحلتك.`, cta: ['open-unlocked-content', 'استكشف الآن'], visualType: 'success' };
      case TYPE.WORDS_WEAK:
        return { title: 'قوِّ كلماتك الصعبة', message: `لديك ${context.wordCount} كلمات صعبة أو مميزة لم تراجعها منذ مدة.`, cta: ['practice-weak-words', 'راجع الصعب'], visualType: 'warning' };
      case TYPE.INACTIVITY:
        return { title: 'ارجع بخطوة خفيفة', message: `مرّ ${context.days} أيام منذ آخر تعلّم فعلي. جلسة قصيرة تكفي للعودة.`, cta: ['resume-learning', 'ابدأ جلسة قصيرة'], visualType: 'info' };
      case TYPE.FEEDBACK_REQUEST:
        return { title: 'كيف كانت تجربتك؟', message: 'تقييم قصير يساعدنا نحسّن LootLingua.', cta: ['open-feedback', 'أرسل تقييمك'], visualType: 'info' };
      default:
        return { title: 'تذكير', message: '', cta: ['', ''], visualType: 'info' };
    }
  }

  function normalizeFacts(input, now) {
    const facts = input && typeof input === 'object' ? input : {};
    return {
      ...facts,
      now,
      wordCount: Math.max(0, Number(facts.wordCount) || 0),
      chest: facts.chest || {},
      streak: facts.streak || {},
      review: facts.review || {},
      gatePractice: facts.gatePractice || {},
      newWords: facts.newWords || {},
      quiz: facts.quiz || {},
      journey: facts.journey || {},
      gateReady: facts.gateReady || {},
      contentUnlocked: facts.contentUnlocked || {},
      weakWords: facts.weakWords || {},
      inactivity: facts.inactivity || {},
      feedback: facts.feedback || {},
    };
  }

  function rawRules(facts) {
    const now = facts.now;
    const rules = [];
    const openKey = (type, fallback) => clean(facts.openOccurrences?.[type]) || fallback;
    const reviewDue = Math.max(0, Number(facts.review.dueCount) || 0);
    const reviewActive = Math.max(0, Number(facts.review.activeCount) || facts.wordCount);
    const reviewEligible = reviewDue >= 5 || (reviewActive >= 10 && reviewDue >= 3 && reviewDue / reviewActive >= 0.2);

    if (facts.chest.hasOpenedBefore && facts.chest.ready && !facts.chest.lockedByXp) {
      rules.push({ type: TYPE.CHEST_READY, key: openKey(TYPE.CHEST_READY, occurrence(TYPE.CHEST_READY, numeric(facts.chest.lastOpenAt))), since: numeric(facts.chest.readyAt) || now, context: {} });
    }

    const today = localDateKey(now);
    const minutesLeft = Math.max(0, (localDayEnd(now) - now) / 60000);
    if (Number(facts.streak.count) > 1 && clean(facts.streak.lastActivityDate) !== today && minutesLeft <= 180 && minutesLeft >= 0) {
      const slot = minutesLeft <= 60 && Number(facts.streak.count) >= 3 ? 'final' : 'early';
      rules.push({ type: TYPE.STREAK_RISK, key: openKey(TYPE.STREAK_RISK, occurrence(TYPE.STREAK_RISK, today)), since: now, context: { slot }, immediateSlot: slot });
    }

    if (reviewEligible) {
      rules.push({
        type: TYPE.REVIEW_DUE,
        key: openKey(TYPE.REVIEW_DUE, occurrence(TYPE.REVIEW_DUE, clean(facts.review.episodeKey) || today)),
        since: numeric(facts.review.eligibleSince) || now,
        context: { dueCount: reviewDue, activeCount: reviewActive },
      });
    }

    if (facts.gatePractice.actionable && Number(facts.gatePractice.unpracticedCount) >= 5) {
      rules.push({
        type: TYPE.GATE_PRACTICE,
        key: openKey(TYPE.GATE_PRACTICE, occurrence(TYPE.GATE_PRACTICE, facts.gatePractice.worldId, facts.gatePractice.rankId, facts.gatePractice.gateId, numeric(facts.gatePractice.loadedAt))),
        since: numeric(facts.gatePractice.newestLinkedAt || facts.gatePractice.loadedAt) || now,
        context: {
          worldId: clean(facts.gatePractice.worldId), rankId: clean(facts.gatePractice.rankId), gateId: clean(facts.gatePractice.gateId),
          gateLabel: clean(facts.gatePractice.gateLabel), unpracticedCount: Number(facts.gatePractice.unpracticedCount) || 0,
        },
      });
    }

    if (Number(facts.newWords.unreviewedCount) >= 6 && numeric(facts.newWords.batchCreatedAt)) {
      rules.push({
        type: TYPE.WORDS_NEW,
        key: openKey(TYPE.WORDS_NEW, occurrence(TYPE.WORDS_NEW, clean(facts.newWords.batchId) || numeric(facts.newWords.batchCreatedAt))),
        since: numeric(facts.newWords.batchCreatedAt),
        context: { wordCount: Number(facts.newWords.unreviewedCount) || 0, batchId: clean(facts.newWords.batchId) },
      });
    }

    const quizAnchor = numeric(facts.quiz.lastTrustedQuizAt || facts.quiz.learningAnchorAt);
    if (facts.wordCount >= 10 && quizAnchor && now - quizAnchor >= 4 * DAY) {
      rules.push({
        type: TYPE.QUIZ_INACTIVE,
        key: openKey(TYPE.QUIZ_INACTIVE, occurrence(TYPE.QUIZ_INACTIVE, quizAnchor)),
        since: quizAnchor,
        context: { wordCount: facts.wordCount, days: Math.floor((now - quizAnchor) / DAY) },
      });
    }

    const journeyAnchor = numeric(facts.journey.lastProgressAt);
    if (facts.journey.actionable && journeyAnchor && now - journeyAnchor >= 3 * DAY) {
      rules.push({
        type: TYPE.JOURNEY_INACTIVE,
        key: openKey(TYPE.JOURNEY_INACTIVE, occurrence(TYPE.JOURNEY_INACTIVE, facts.journey.worldId, facts.journey.rankId, facts.journey.gateId, journeyAnchor)),
        since: journeyAnchor,
        context: {
          worldId: clean(facts.journey.worldId), rankId: clean(facts.journey.rankId), gateId: clean(facts.journey.gateId), gateLabel: clean(facts.journey.gateLabel),
        },
      });
    }

    if (facts.gateReady.ready && numeric(facts.gateReady.readyAt)) {
      rules.push({
        type: TYPE.GATE_READY,
        key: openKey(TYPE.GATE_READY, occurrence(TYPE.GATE_READY, facts.gateReady.worldId, facts.gateReady.rankId, facts.gateReady.gateId, numeric(facts.gateReady.readyAt))),
        since: numeric(facts.gateReady.readyAt),
        context: {
          worldId: clean(facts.gateReady.worldId), rankId: clean(facts.gateReady.rankId), gateId: clean(facts.gateReady.gateId), gateLabel: clean(facts.gateReady.gateLabel),
        },
      });
    }

    if (facts.contentUnlocked.available && numeric(facts.contentUnlocked.unlockedAt)) {
      rules.push({
        type: TYPE.CONTENT_UNLOCKED,
        key: openKey(TYPE.CONTENT_UNLOCKED, occurrence(TYPE.CONTENT_UNLOCKED, facts.contentUnlocked.worldId, facts.contentUnlocked.rankId, facts.contentUnlocked.gateId, numeric(facts.contentUnlocked.unlockedAt))),
        since: numeric(facts.contentUnlocked.unlockedAt),
        context: {
          worldId: clean(facts.contentUnlocked.worldId), rankId: clean(facts.contentUnlocked.rankId), gateId: clean(facts.contentUnlocked.gateId), targetLabel: clean(facts.contentUnlocked.targetLabel),
        },
      });
    }

    if (Number(facts.weakWords.unreviewedCount) >= 8 && numeric(facts.weakWords.oldestAt) && now - numeric(facts.weakWords.oldestAt) >= 3 * DAY) {
      rules.push({
        type: TYPE.WORDS_WEAK,
        key: openKey(TYPE.WORDS_WEAK, occurrence(TYPE.WORDS_WEAK, clean(facts.weakWords.episodeKey) || numeric(facts.weakWords.oldestAt))),
        since: numeric(facts.weakWords.oldestAt),
        context: { wordCount: Number(facts.weakWords.unreviewedCount) || 0 },
      });
    }

    const inactivityAnchor = numeric(facts.inactivity.lastLearningAt);
    if (inactivityAnchor && now - inactivityAnchor >= 7 * DAY) {
      rules.push({
        type: TYPE.INACTIVITY,
        key: openKey(TYPE.INACTIVITY, occurrence(TYPE.INACTIVITY, inactivityAnchor)),
        since: inactivityAnchor,
        context: { days: Math.floor((now - inactivityAnchor) / DAY) },
      });
    }

    if (facts.feedback.eligible && clean(facts.feedback.episodeKey)) {
      rules.push({
        type: TYPE.FEEDBACK_REQUEST,
        key: openKey(TYPE.FEEDBACK_REQUEST, occurrence(TYPE.FEEDBACK_REQUEST, facts.feedback.episodeKey)),
        since: numeric(facts.feedback.eligibleSince) || now,
        context: { trustedQuizCount: Math.max(0, Number(facts.feedback.trustedQuizCount) || 0) },
      });
    }

    return rules;
  }

  function sameGate(left, right) {
    return clean(left.context?.worldId) === clean(right.context?.worldId) &&
      clean(left.context?.rankId) === clean(right.context?.rankId) &&
      clean(left.context?.gateId) === clean(right.context?.gateId);
  }

  function applyConflicts(rules, facts, reviewEligible) {
    const hasGateReady = rules.find((rule) => rule.type === TYPE.GATE_READY);
    const hasUnlock = rules.find((rule) => rule.type === TYPE.CONTENT_UNLOCKED);
    const hasLongInactivity = rules.some((rule) => rule.type === TYPE.INACTIVITY);
    const hasLearningPriority = rules.some((rule) => [
      TYPE.STREAK_RISK, TYPE.REVIEW_DUE, TYPE.GATE_READY,
      TYPE.CONTENT_UNLOCKED, TYPE.JOURNEY_INACTIVE,
    ].includes(rule.type));
    return rules.filter((rule) => {
      if (reviewEligible && [TYPE.QUIZ_INACTIVE, TYPE.WORDS_WEAK].includes(rule.type)) return false;
      if (hasLongInactivity && rule.type === TYPE.CHEST_READY) return false;
      if (hasGateReady && [TYPE.GATE_PRACTICE, TYPE.JOURNEY_INACTIVE].includes(rule.type) && sameGate(rule, hasGateReady)) return false;
      if (hasUnlock && rule.type === TYPE.JOURNEY_INACTIVE && sameGate(rule, hasUnlock)) return false;
      if (hasLearningPriority && rule.type === TYPE.FEEDBACK_REQUEST) return false;
      return true;
    }).filter((rule, index, values) => {
      if (rule.type !== TYPE.WORDS_NEW) return true;
      return !values.some((other) => (
        other.type === TYPE.GATE_PRACTICE && facts.now >= numeric(other.since) + TABLE[TYPE.GATE_PRACTICE].delay
      ));
    });
  }

  function slotFor(rule, record, now) {
    const type = rule.type;
    const shown = new Set(record?.shownSlots || []);
    const count = Math.max(0, Number(record?.showCount) || 0);
    const firstShown = numeric(record?.firstShownAt);
    const lastShown = numeric(record?.lastShownAt);
    const age = now - numeric(record?.eligibleSince || rule.since);
    if (count >= TABLE[type].maxShows) return '';
    if (rule.immediateSlot) return shown.has(rule.immediateSlot) ? '' : rule.immediateSlot;
    if (count === 0) return 'first';
    if (type === TYPE.REVIEW_DUE) {
      const due = Number(rule.context.dueCount) || 0;
      const initial = Number(record?.context?.initialDueCount ?? record?.context?.dueCount) || due;
      const growth = due >= initial + 5 || due >= Math.ceil(initial * 1.5);
      if (growth && now - lastShown >= 12 * HOUR && !shown.has('growth')) return 'growth';
      if (localDateKey(now) !== localDateKey(firstShown) && now - firstShown >= 20 * HOUR && !shown.has('next-day')) return 'next-day';
      if (now - lastShown >= 48 * HOUR && !shown.has('48h')) return '48h';
      return '';
    }
    if (type === TYPE.GATE_PRACTICE) return count < 2 && now - lastShown >= 48 * HOUR ? '48h' : '';
    if (type === TYPE.QUIZ_INACTIVE) return count < 2 && now - lastShown >= 5 * DAY ? '5d' : '';
    if (type === TYPE.JOURNEY_INACTIVE) return age >= 7 * DAY && !shown.has('7d') ? '7d' : '';
    if (type === TYPE.CONTENT_UNLOCKED) return count < 2 && now - lastShown >= 48 * HOUR ? '48h' : '';
    if (type === TYPE.WORDS_WEAK) return count < 2 && now - lastShown >= 7 * DAY ? '7d' : '';
    if (type === TYPE.INACTIVITY) return age >= 21 * DAY && !shown.has('21d') ? '21d' : '';
    return '';
  }

  function makeRecord(rule, existing, facts, ownerId, now) {
    const table = TABLE[rule.type];
    const eligibleSince = numeric(existing?.eligibleSince) || numeric(rule.since) || now;
    const eligibleAt = eligibleSince + table.delay;
    const isTerminal = existing && ['resolved', 'dismissed'].includes(existing.status);
    const status = isTerminal ? existing.status : (now >= eligibleAt ? 'active' : 'pending');
    const initialDueCount = Number(existing?.context?.initialDueCount) || Number(rule.context.dueCount);
    const dueGrowth = Boolean(existing) && (
      Number(rule.context.dueCount) >= initialDueCount + 5 ||
      Number(rule.context.dueCount) >= Math.ceil(initialDueCount * 1.5)
    );
    const severe = rule.type === TYPE.REVIEW_DUE && (
      now - eligibleSince >= 48 * HOUR || dueGrowth
    );
    const context = {
      ...(existing?.context || {}),
      ...rule.context,
      ...(rule.type === TYPE.REVIEW_DUE ? { initialDueCount: Number(existing?.context?.initialDueCount) || Number(rule.context.dueCount), severe } : {}),
    };
    const copy = messageFor(rule.type, facts, context);
    const record = {
      ...(existing || {}),
      id: existing?.id || root.LootLinguaNotificationStore?.deterministicId(ownerId, rule.key) || `nt3_${rule.key}`,
      schemaVersion: 3,
      ownerId,
      kind: 'smart',
      notificationType: rule.type,
      occurrenceKey: rule.key,
      actionGroup: table.actionGroup,
      priority: table.priority + (severe ? 8 : 0),
      severity: severe ? 'high' : (table.priority >= 80 ? 'high' : table.priority >= 55 ? 'medium' : 'low'),
      status,
      visualType: copy.visualType,
      title: copy.title,
      message: copy.message,
      cta: { id: copy.cta[0], label: copy.cta[1], args: { ...context } },
      context,
      createdAt: numeric(existing?.createdAt) || now,
      updatedAt: numeric(existing?.updatedAt) || now,
      eligibleSince,
      eligibleAt,
      firstShownAt: numeric(existing?.firstShownAt),
      lastShownAt: numeric(existing?.lastShownAt),
      showCount: Math.max(0, Number(existing?.showCount) || 0),
      shownSlots: Array.isArray(existing?.shownSlots) ? existing.shownSlots : [],
      readAt: numeric(existing?.readAt),
    };
    const semanticChanged = !existing || [
      'status', 'priority', 'severity', 'visualType', 'title', 'message', 'eligibleSince', 'eligibleAt',
    ].some((field) => JSON.stringify(existing?.[field] ?? null) !== JSON.stringify(record[field] ?? null)) ||
      JSON.stringify(existing?.context || {}) !== JSON.stringify(record.context || {}) ||
      JSON.stringify(existing?.cta || null) !== JSON.stringify(record.cta || null);
    if (semanticChanged) record.updatedAt = now;
    return { record, slot: status === 'active' && !isTerminal ? slotFor(rule, record, now) : '' };
  }

  function evaluate(inputFacts, existingRecords, options = {}) {
    const now = numeric(options.now) || Date.now();
    const ownerId = clean(options.ownerId) || 'guest';
    const existing = Array.isArray(existingRecords) ? existingRecords : [];
    const openOccurrences = Object.fromEntries(existing
      .filter((record) => record?.kind === 'smart' && ['pending', 'active'].includes(record.status))
      .map((record) => [String(record.notificationType || ''), String(record.occurrenceKey || '')]));
    const facts = normalizeFacts({ ...(inputFacts || {}), openOccurrences }, now);
    const raw = rawRules(facts).map((rule) => {
      const open = currentRecord(existing, rule.key);
      return open?.eligibleSince ? { ...rule, since: numeric(open.eligibleSince) } : rule;
    });
    const reviewRule = raw.find((rule) => rule.type === TYPE.REVIEW_DUE);
    const activeReviewConflict = Boolean(
      reviewRule && now >= numeric(reviewRule.since) + TABLE[TYPE.REVIEW_DUE].delay
    );
    let rules = applyConflicts(raw, facts, activeReviewConflict);
    // A reminder suppressed by a stronger conflict may resume later as a new
    // occurrence without reviving its terminal tombstone.
    rules = rules.map((rule) => {
      const suppressed = existing.find((record) => (
        clean(record?.occurrenceKey) === rule.key &&
        ['resolved', 'dismissed'].includes(record?.status) &&
        record?.resolutionReason === 'conflict-suppressed'
      ));
      return suppressed
        ? { ...rule, key: `${rule.key}:resume:${numeric(suppressed.resolvedAt || suppressed.dismissedAt || suppressed.updatedAt)}` }
        : rule;
    });
    const rawAlive = new Set(raw.map((rule) => rule.key));
    const visibleAlive = new Set(rules.map((rule) => rule.key));
    const resolutions = existing.filter((record) => (
      record?.kind === 'smart' && ['pending', 'active'].includes(record.status) && !visibleAlive.has(clean(record.occurrenceKey))
    )).map((record) => ({
      id: record.id,
      reason: rawAlive.has(clean(record.occurrenceKey)) ? 'conflict-suppressed' : 'source-cleared',
    }));
    const evaluated = rules.map((rule) => makeRecord(rule, currentRecord(existing, rule.key), facts, ownerId, now));
    const minimumProminentPriority = Math.max(0, Number(options.minProminentPriority) || 0);
    const excludedProminentOccurrences = new Set(
      (Array.isArray(options.excludeProminentOccurrenceKeys) ? options.excludeProminentOccurrenceKeys : [])
        .map(clean)
        .filter(Boolean)
    );
    const promotable = evaluated.filter((item) => (
      item.slot &&
      item.record.priority >= minimumProminentPriority &&
      !excludedProminentOccurrences.has(clean(item.record.occurrenceKey))
    )).sort((left, right) => (
      right.record.priority - left.record.priority ||
      left.record.eligibleSince - right.record.eligibleSince ||
      left.record.occurrenceKey.localeCompare(right.record.occurrenceKey)
    ));
    const selected = options.allowProminent === false ? null : (promotable[0] || null);
    if (selected) {
      selected.record.showCount += 1;
      selected.record.firstShownAt ||= now;
      selected.record.lastShownAt = now;
      selected.record.shownSlots = [...new Set([...selected.record.shownSlots, selected.slot])];
      selected.record.updatedAt = now;
    }
    const upserts = evaluated.map((item) => item.record);
    const nextAt = Math.min(...evaluated.map((item) => {
      if (item.record.status === 'pending') return item.record.eligibleAt;
      if (item.record.notificationType === TYPE.STREAK_RISK) return now + 15 * 60 * 1000;
      return Infinity;
    }).filter((value) => value > now));
    return {
      now,
      rules,
      upserts,
      resolutions,
      selected: selected ? { record: selected.record, slot: selected.slot } : null,
      nextAt: Number.isFinite(nextAt) ? nextAt : 0,
    };
  }

  const API = Object.freeze({
    HOUR,
    DAY,
    TYPE,
    TABLE,
    localDateKey,
    localDayEnd,
    reviewThreshold: (dueCount, activeCount) => Number(dueCount) >= 5 || (Number(activeCount) >= 10 && Number(dueCount) >= 3 && Number(dueCount) / Number(activeCount) >= 0.2),
    evaluate,
  });

  Object.defineProperty(root, 'LootLinguaNotificationEngine', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
