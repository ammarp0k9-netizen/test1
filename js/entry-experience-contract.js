(function attachLootLinguaEntryExperienceContract(root) {
  'use strict';

  const EXPERIENCE_VERSION = 2;
  const CONTRACT_VERSION = 2;
  const RELEASE_AT = Date.UTC(2026, 6, 30, 0, 0, 0);
  const NEW_ACCOUNT_WINDOW_MS = 30 * 60 * 1000;

  const STATUSES = Object.freeze(['in-progress', 'completed']);
  const TERMINAL_STATUSES = Object.freeze(['completed']);
  const STEPS = Object.freeze(['interests', 'theme', 'worlds', 'journey', 'context', 'destination', 'return']);
  const JOURNEY_STATUSES = Object.freeze(['pending', 'world-selected', 'structure-explored', 'return-reviewed']);
  const GAMER_STATUSES = Object.freeze(['not-applicable', 'offered', 'running', 'completed', 'unavailable', 'skipped']);
  const AUDIENCES = Object.freeze(['new', 'returning', 'returning-guest']);
  const CLASSIFICATIONS = Object.freeze([
    'brand-new',
    'returning-with-progress',
    'returning-light',
    'returning-guest-with-local-data',
    'existing-account-without-meaningful-progress',
  ]);
  const INTEREST_STATUSES = Object.freeze(['pending', 'selected', 'skipped']);
  const THEME_STATUSES = Object.freeze(['pending', 'selected', 'preserved']);
  const THEME_IDS = Object.freeze(['lootlingua', 'ocean']);
  const PRESERVABLE_THEME_IDS = Object.freeze(['lootlingua', 'ocean', 'golden', 'scroll', 'glass']);
  const OASIS_MODES = Object.freeze(['light', 'dark']);

  const INTERESTS = deepFreeze([
    { id: 'games', label: 'الألعاب', icon: 'fa-solid fa-gamepad' },
    { id: 'movies', label: 'الأفلام والمسلسلات', icon: 'fa-solid fa-film' },
    { id: 'study', label: 'الدراسة', icon: 'fa-solid fa-graduation-cap' },
    { id: 'general', label: 'الكلمات العامة', icon: 'fa-solid fa-comments' },
    { id: 'technology', label: 'التقنية والبرمجة', icon: 'fa-solid fa-code' },
    { id: 'travel', label: 'الحياة اليومية والسفر', icon: 'fa-solid fa-plane-departure' },
  ]);
  const INTEREST_IDS = Object.freeze(INTERESTS.map((item) => item.id));
  const INTEREST_ID_SET = new Set(INTEREST_IDS);

  const CTA_IDS = Object.freeze([
    'resume-journey-session',
    'resume-quiz',
    'continue-journey',
    'review-words',
    'explore-worlds',
    'suggest-placement',
    'new-user-start',
    'open-selected-world',
  ]);

  function deepFreeze(value, seen) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
    const visited = seen || new WeakSet();
    if (visited.has(value)) return value;
    visited.add(value);
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key], visited));
    return Object.freeze(value);
  }

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : (fallback || 0);
  }

  function timestampMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return Math.max(0, finiteNumber(value.toMillis(), 0));
    if (typeof value.toDate === 'function') return Math.max(0, value.toDate().getTime());
    if (value instanceof Date) return Math.max(0, value.getTime());
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }
    if (isPlainObject(value) && Number.isFinite(Number(value.seconds))) {
      return Math.max(0, (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1e6));
    }
    return Math.max(0, finiteNumber(value, 0));
  }

  function cleanString(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength || 160);
  }

  function cleanEnum(value, allowed, fallback) {
    const next = cleanString(value, 80);
    return allowed.includes(next) ? next : fallback;
  }

  function uniqueStrings(values, allowed, maxItems) {
    const allowedSet = allowed ? new Set(allowed) : null;
    const result = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const next = cleanString(value, 80);
      if (!next || seen.has(next) || (allowedSet && !allowedSet.has(next))) return;
      seen.add(next);
      if (result.length < (maxItems || 24)) result.push(next);
    });
    return result;
  }

  function storageOwner(identity) {
    const uid = cleanString(identity && identity.uid, 128);
    return uid ? `user:${uid}` : 'guest';
  }

  function entryStorageKey(identity, version) {
    const resolvedVersion = Math.max(1, Math.floor(finiteNumber(version, EXPERIENCE_VERSION)));
    return `lootlingua:entry-experience:v${resolvedVersion}:${storageOwner(identity)}`;
  }

  function guestEntryClaimStorageKey(version) {
    const resolvedVersion = Math.max(1, Math.floor(finiteNumber(version, EXPERIENCE_VERSION)));
    return `lootlingua:entry-guest-claim:v${resolvedVersion}`;
  }

  function pendingIntentStorageKey(identity) {
    return `lootlingua:pending-intent:v1:${storageOwner(identity)}`;
  }

  function profileMigrationStorageKey(identity) {
    return `lootlingua:guest-profile-migration:v1:${storageOwner(identity)}`;
  }

  function guestMigrationReceiptStorageKey(identity) {
    return `lootlingua:guest-migration-receipt:v1:${storageOwner(identity)}`;
  }

  function themeStorageKey(identity) {
    return `lootlingua:theme:${storageOwner(identity)}`;
  }

  function oasisModeStorageKey(identity) {
    return `lootlingua:oasis-mode:${storageOwner(identity)}`;
  }

  function themeIntroStorageKey(identity) {
    return `lootlingua:theme-intros:${storageOwner(identity)}`;
  }

  function normalizeEntryState(raw, fallback) {
    if (!isPlainObject(raw)) return null;
    const source = isPlainObject(fallback) ? fallback : {};
    const version = Math.floor(finiteNumber(raw.experienceVersion ?? raw.version, EXPERIENCE_VERSION));
    if (version !== EXPERIENCE_VERSION) return null;

    const status = cleanEnum(raw.status, STATUSES, 'in-progress');
    const audience = cleanEnum(raw.audience, AUDIENCES, cleanEnum(source.audience, AUDIENCES, 'new'));
    const classification = cleanEnum(
      raw.classification,
      CLASSIFICATIONS,
      cleanEnum(source.classification, CLASSIFICATIONS, audience === 'new' ? 'brand-new' : 'returning-light')
    );
    const currentStep = cleanEnum(
      raw.currentStep,
      STEPS,
      status === 'in-progress' ? 'interests' : 'destination'
    );
    const interestsStatus = cleanEnum(raw.interestsStatus, INTEREST_STATUSES, 'pending');
    const interestIds = interestsStatus === 'selected'
      ? uniqueStrings(raw.interestIds, INTEREST_IDS, INTEREST_IDS.length)
      : [];
    const normalizedInterestsStatus = interestsStatus === 'selected' && !interestIds.length
      ? 'pending'
      : interestsStatus;
    const themeStatus = cleanEnum(raw.themeStatus, THEME_STATUSES, 'pending');
    const themeId = cleanEnum(raw.themeId, PRESERVABLE_THEME_IDS, '');
    const oasisMode = cleanEnum(raw.oasisMode, OASIS_MODES, 'light');
    const themeExplicit = raw.themeExplicit === true;
    const journeyStatus = cleanEnum(raw.journeyStatus, JOURNEY_STATUSES, 'pending');
    const selectedWorldId = cleanString(raw.selectedWorldId, 128);
    const gamerStatus = cleanEnum(raw.gamerStatus, GAMER_STATUSES, 'not-applicable');
    const startedAt = timestampMillis(raw.startedAt);
    const updatedAt = timestampMillis(raw.updatedAt);
    const completedAt = status === 'completed' ? timestampMillis(raw.completedAt) : 0;
    const skippedAt = status === 'skipped' ? timestampMillis(raw.skippedAt) : 0;

    return {
      contractVersion: CONTRACT_VERSION,
      experienceVersion: EXPERIENCE_VERSION,
      status,
      audience,
      classification,
      currentStep,
      interestsStatus: normalizedInterestsStatus,
      interestIds,
      themeStatus,
      themeId,
      oasisMode,
      themeExplicit,
      journeyStatus,
      selectedWorldId,
      gamerStatus,
      source: cleanEnum(raw.source, ['app-entry', 'guest-migration', 'settings'], 'app-entry'),
      startedAt,
      updatedAt,
      completedAt,
      skippedAt,
    };
  }

  function normalizeLegacyPreferences(raw) {
    if (!isPlainObject(raw)) return null;
    const version = Math.floor(finiteNumber(raw.experienceVersion ?? raw.version, 0));
    if (version !== 1) return null;
    const interestsStatus = cleanEnum(raw.interestsStatus, INTEREST_STATUSES, 'pending');
    const interestIds = interestsStatus === 'selected'
      ? uniqueStrings(raw.interestIds, INTEREST_IDS, INTEREST_IDS.length)
      : [];
    return {
      interestIds,
      themeId: cleanEnum(raw.themeId, PRESERVABLE_THEME_IDS, ''),
      oasisMode: cleanEnum(raw.oasisMode, OASIS_MODES, 'light'),
    };
  }

  function createEntryDraft(presentation, preferences) {
    const context = presentation || {};
    const saved = preferences || {};
    const existingTheme = cleanEnum(saved.themeId, PRESERVABLE_THEME_IDS, '');
    return normalizeEntryState({
      contractVersion: CONTRACT_VERSION,
      experienceVersion: EXPERIENCE_VERSION,
      status: 'in-progress',
      audience: context.audience,
      classification: context.classification,
      currentStep: context.classification === 'returning-with-progress' ? 'return' : 'interests',
      interestsStatus: Array.isArray(saved.interestIds) && saved.interestIds.length ? 'selected' : 'pending',
      interestIds: saved.interestIds,
      themeStatus: existingTheme ? 'preserved' : 'pending',
      themeId: existingTheme,
      oasisMode: cleanEnum(saved.oasisMode, OASIS_MODES, 'light'),
      themeExplicit: false,
      journeyStatus: 'pending',
      selectedWorldId: '',
      gamerStatus: 'not-applicable',
      source: 'app-entry',
    });
  }

  function isTerminalState(state) {
    const normalized = normalizeEntryState(state);
    return Boolean(
      normalized &&
      TERMINAL_STATUSES.includes(normalized.status) &&
      normalized.currentStep === 'destination' &&
      ['structure-explored', 'return-reviewed'].includes(normalized.journeyStatus)
    );
  }

  function recoverUnverifiedTerminal(state, presentation, nowValue) {
    const normalized = normalizeEntryState(state);
    if (!normalized || normalized.status === 'in-progress' || isTerminalState(normalized)) {
      return normalized;
    }
    const classification = cleanEnum(
      presentation && presentation.classification,
      CLASSIFICATIONS,
      normalized.classification
    );
    const hasProgress = classification === 'returning-with-progress';
    return normalizeEntryState({
      ...normalized,
      status: 'in-progress',
      currentStep: hasProgress ? 'return' : 'interests',
      journeyStatus: 'pending',
      selectedWorldId: '',
      gamerStatus: 'not-applicable',
      completedAt: 0,
      skippedAt: 0,
      updatedAt: timestampMillis(nowValue) || Date.now(),
    });
  }

  function shouldPresent(state, version) {
    const requestedVersion = Math.floor(finiteNumber(version, EXPERIENCE_VERSION));
    const normalized = normalizeEntryState(state);
    if (!normalized || normalized.experienceVersion !== requestedVersion) return true;
    return !isTerminalState(normalized);
  }

  function positiveMapValue(map) {
    return isPlainObject(map) && Object.values(map).some((value) => finiteNumber(value, 0) > 0);
  }

  function nonEmptyMap(map) {
    return isPlainObject(map) && Object.keys(map).length > 0;
  }

  function wordHasSrs(word) {
    if (!isPlainObject(word)) return false;
    const textFields = [
      word.mastery_status,
      word.masteryStatus,
      word.srsState,
      word.learningState,
    ].map((value) => cleanString(value, 80).toLowerCase());
    if (textFields.some((value) => value && !['new', 'unseen', 'none'].includes(value))) return true;
    return [
      word.mastery_streak,
      word.masteryStreak,
      word.repetitions,
      word.interval,
      word.easeFactor,
      word.quiz_seen_count,
      word.forgetCount,
      word.remasteryAwardCount,
    ].some((value) => finiteNumber(value, 0) > 0) || Boolean(
      word.last_recalled_at ||
      word.first_recalled_at ||
      word.last_quizzed_at ||
      word.nextReviewAt ||
      word.mastered_once ||
      word.firstMasteredAt ||
      (Array.isArray(word.earnedTransitions) && word.earnedTransitions.length)
    );
  }

  function wordIsHiddenOrMastered(word) {
    if (!isPlainObject(word)) return false;
    const state = cleanString(
      word.mastery_status || word.masteryStatus || word.lifecycleState,
      80
    ).toLowerCase();
    return word.hiddenFromDictionary === true ||
      word.personalDictionaryState === 'moved-to-private-world' ||
      state === 'mastered';
  }

  function isResumableQuizSession(session) {
    if (!isPlainObject(session)) return false;
    const mode = cleanString(session.mode, 80);
    if (!['timeAttack', 'scramble'].includes(mode)) return false;
    const words = Array.isArray(session.words) ? session.words : [];
    if (!words.length) return false;
    const index = Math.max(0, Math.floor(finiteNumber(session.quizIndex, 0)));
    return index < words.length && !session.completedAt && !session.finishedAt;
  }

  function profileSignals(profile) {
    const data = isPlainObject(profile) ? profile : {};
    const xp = Math.max(0, finiteNumber(data.userXP, 0));
    const activity = positiveMapValue(data.activityMap);
    const quizHistory = Array.isArray(data.quizExposureHistory) && data.quizExposureHistory.length > 0;
    const addedGameWords = Array.isArray(data.addedGameWords) && data.addedGameWords.length > 0;
    const titles = Array.isArray(data.titlesState && data.titlesState.unlocked)
      ? data.titlesState.unlocked.length
      : 0;
    const loot = isPlainObject(data.dailyLootState) && (
      finiteNumber(data.dailyLootState.totalOpens, 0) > 0 ||
      finiteNumber(data.dailyLootState.streak, 0) > 0
    );
    const counters = [
      data.dailyStreak,
      data.maxStreak,
      data.streakFreezes,
      data.freezeSaves,
      data.gameDictAdds,
      data.perfectQuizzes,
    ].some((value) => finiteNumber(value, 0) > 0);
    const meaningful = xp > 0 || activity || quizHistory || addedGameWords || titles > 0 || loot || counters;
    const theme = cleanString(data.theme, 80);
    const personalized = Boolean(theme && theme !== 'lootlingua') ||
      (Array.isArray(data.interestIds) && data.interestIds.length > 0);
    return { xp, activity, quizHistory, addedGameWords, titles, loot, counters, meaningful, personalized, theme };
  }

  function normalizeSignals(input) {
    const source = isPlainObject(input) ? input : {};
    const words = Array.isArray(source.words) ? source.words : [];
    const guestWords = Array.isArray(source.guestWords) ? source.guestWords : [];
    const allWords = words.length ? words : guestWords;
    const profile = profileSignals(source.profile);
    const srsCount = allWords.filter(wordHasSrs).length + Math.max(0, Math.floor(finiteNumber(source.srsEntryCount, 0)));
    const hiddenOrMasteredCount = allWords.filter(wordIsHiddenOrMastered).length;
    const activeJourney = isPlainObject(source.activeJourney) ? source.activeJourney : null;
    const hasJourneyProgress = source.hasJourneyProgress === true || Boolean(activeJourney);
    const activeQuizSession = isPlainObject(source.activeQuizSession) ? source.activeQuizSession : null;
    const resumableQuiz = isResumableQuizSession(activeQuizSession);
    const localDraft = normalizeEntryState(source.localDraft);
    const legacyMarkers = isPlainObject(source.legacyMarkers) ? source.legacyMarkers : {};
    const hasLegacyMarker = Object.values(legacyMarkers).some((value) => value === true || Boolean(cleanString(value, 80)));
    const customWorldCount = Math.max(0, Math.floor(finiteNumber(source.customWorldCount, 0)));
    const pendingLocalDraft = Boolean(source.hasLocalLearningDraft) || resumableQuiz || Boolean(localDraft);
    const wordCount = allWords.length + Math.max(0, Math.floor(finiteNumber(source.additionalWordCount, 0)));
    const hasMeaningfulJourneyProgress = hasJourneyProgress ||
      source.hasWorldProgress === true || source.hasCompletionLedger === true;
    const hasAnyData = wordCount > 0 || profile.meaningful || profile.personalized || srsCount > 0 ||
      hiddenOrMasteredCount > 0 || resumableQuiz || customWorldCount > 0 || pendingLocalDraft ||
      source.hasKnownLegacyUse === true || hasMeaningfulJourneyProgress;
    // Kept as a compatibility alias for callers that used the old signal name.
    // It now means strong Journey/world progress only, never words, XP, or profile data.
    const strongProgress = hasMeaningfulJourneyProgress;
    const lightUse = hasAnyData && !hasMeaningfulJourneyProgress;
    const isAuthenticated = source.isAuthenticated === true || Boolean(cleanString(source.uid, 128));
    const accountCreatedAt = timestampMillis(source.accountCreatedAt);
    const accountLastSignInAt = timestampMillis(source.accountLastSignInAt);
    const now = timestampMillis(source.now) || Date.now();
    const profileExists = source.profileExists === true;
    const profileReadFailed = source.profileReadFailed === true;
    const accountPredatesRelease = accountCreatedAt > 0 && accountCreatedAt < RELEASE_AT;
    const accountAge = now - accountCreatedAt;
    // Freshness is tied to the trustworthy Auth creation/first-sign-in pair,
    // not to a hard-coded rollout date that may differ from the real deploy.
    const accountIsFresh = accountCreatedAt > 0 && accountAge >= -60 * 1000 &&
      accountAge <= NEW_ACCOUNT_WINDOW_MS;
    const firstSignInLooksFresh = accountIsFresh && (
      !accountLastSignInAt || Math.abs(accountLastSignInAt - accountCreatedAt) <= NEW_ACCOUNT_WINDOW_MS
    );

    return {
      isAuthenticated,
      uid: cleanString(source.uid, 128),
      wordCount,
      srsCount,
      hiddenOrMasteredCount,
      activeJourney,
      hasJourneyProgress,
      activeQuizSession,
      resumableQuiz,
      hasWorldProgress: source.hasWorldProgress === true,
      hasCompletionLedger: source.hasCompletionLedger === true,
      customWorldCount,
      localDraft,
      hasLegacyMarker,
      hasKnownLegacyUse: source.hasKnownLegacyUse === true,
      pendingLocalDraft,
      profile: source.profile || {},
      profileSignals: profile,
      profileExists,
      profileReadFailed,
      hasAnyData,
      hasMeaningfulJourneyProgress,
      strongProgress,
      lightUse,
      accountCreatedAt,
      accountLastSignInAt,
      accountPredatesRelease,
      firstSignInLooksFresh,
      hasPublishedWorld: source.hasPublishedWorld !== false,
      hasInterestMatch: source.hasInterestMatch === true,
      placementEligible: source.placementEligible === true,
      journeyDestination: isPlainObject(source.journeyDestination) ? source.journeyDestination : null,
    };
  }

  function classifyUser(input) {
    const signals = normalizeSignals(input);
    let classification;

    if (!signals.isAuthenticated) {
      if (signals.hasAnyData || signals.hasLegacyMarker) {
        classification = 'returning-guest-with-local-data';
      } else {
        classification = 'brand-new';
      }
    } else if (signals.hasMeaningfulJourneyProgress) {
      classification = 'returning-with-progress';
    } else if (signals.lightUse) {
      classification = 'returning-light';
    } else if (signals.firstSignInLooksFresh && !signals.profileReadFailed) {
      // Auth/profile creation is not product usage. A freshly-created account
      // with no real data must receive the same full path as a fresh guest.
      classification = 'brand-new';
    } else if (
      signals.profileExists ||
      signals.profileReadFailed ||
      !signals.firstSignInLooksFresh
    ) {
      classification = 'existing-account-without-meaningful-progress';
    } else {
      classification = 'brand-new';
    }

    const audience = classification === 'brand-new'
      ? 'new'
      : (classification === 'returning-guest-with-local-data' ? 'returning-guest' : 'returning');

    return { classification, audience, signals };
  }

  function entryCopy(classification, signalsInput) {
    const signals = signalsInput && signalsInput.profileSignals
      ? signalsInput
      : normalizeSignals(signalsInput || {});
    if (classification === 'returning-with-progress') {
      if (signals.activeJourney) {
        return {
          eyebrow: 'تجربة LootLingua الجديدة',
          title: 'أهلًا بعودتك',
          body: 'رحلتك وتقدّمك محفوظان كما هما. سنعرض لك عودة سريعة تعيدك مباشرة إلى موضعك الحالي دون تغيير ما أنجزته.',
        };
      }
      if (signals.wordCount > 0) {
        return {
          eyebrow: 'تجربة LootLingua الجديدة',
          title: 'أهلًا بعودتك',
          body: 'وجدنا كلماتك محفوظة. حدّد ما يهمك والمظهر الذي تفضّله، وسنبقي قاموسك وتقدّمك كما هما.',
        };
      }
      return {
        eyebrow: 'تجربة LootLingua الجديدة',
        title: 'أهلًا بعودتك',
        body: 'وجدنا تقدّمك محفوظًا. اختر اهتماماتك ومظهرك المفضّل لتجهيز التجربة الجديدة من دون تغيير بياناتك.',
      };
    }
    if (classification === 'returning-guest-with-local-data') {
      return {
        eyebrow: 'بياناتك ما زالت هنا',
        title: 'أهلًا بعودتك',
        body: 'بياناتك على هذا الجهاز محفوظة. اختر اهتماماتك ومظهرك، ويمكنك المتابعة كضيف من دون فقدان كلماتك.',
      };
    }
    if (classification === 'returning-light' && signals.wordCount > 0) {
      return {
        eyebrow: 'بياناتك محفوظة',
        title: 'أهلًا بعودتك',
        body: 'وجدنا كلماتك محفوظة، ولن تغيّر اختيارات هذه التجربة قاموسك أو تقدّم مراجعتك. اختر ما يهمك والمظهر الذي تفضّله ثم جرّب خطوة قصيرة.',
      };
    }
    if (classification === 'returning-light' || classification === 'existing-account-without-meaningful-progress') {
      return {
        eyebrow: 'تجربة LootLingua الجديدة',
        title: 'أهلًا بعودتك',
        body: 'يمكنك ضبط اهتماماتك ومظهرك للتجربة الجديدة، وستبقى إعداداتك الحالية كما هي حتى تختار تغييرها.',
      };
    }
    return {
      eyebrow: 'جهّز تجربتك',
      title: 'ما الذي تحب أن تتعلّمه؟',
      body: 'LootLingua يحوّل الكلمات التي تهمّك إلى قاموس شخصي ومراجعة ذكية ورحلة واضحة. اختر اهتماماتك لنهيّئ لك البداية، ويمكنك تعديلها لاحقًا.',
    };
  }

  function isJourneySessionDestination(destination) {
    const type = cleanString(destination && destination.type, 80);
    return [
      'level-placement',
      'level-placement-result',
      'placement',
      'placement-result',
      'gate-clear',
    ].includes(type);
  }

  function isWorldCompletedDestination(destination) {
    return destination?.classification === 'world-completed' ||
      cleanString(destination?.type, 80) === 'completed-current-content';
  }

  function alignStateToJourneyDestination(state, destination, nowValue) {
    const normalized = normalizeEntryState(state);
    if (!normalized || normalized.status !== 'in-progress' ||
      !isWorldCompletedDestination(destination)) {
      return normalized;
    }
    return normalizeEntryState({
      ...normalized,
      currentStep: 'destination',
      journeyStatus: 'return-reviewed',
      selectedWorldId: '',
      gamerStatus: 'not-applicable',
      updatedAt: timestampMillis(nowValue) || Date.now(),
    });
  }

  function resolveNextAction(input, contextInput) {
    const signals = input && input.profileSignals ? input : normalizeSignals(input || {});
    const context = isPlainObject(contextInput) ? contextInput : {};
    const selectedWorldId = cleanString(context.selectedWorldId, 128);
    const destination = signals.journeyDestination;
    if (isWorldCompletedDestination(destination)) {
      return {
        id: 'explore-worlds',
        label: 'استكشف العوالم',
        hint: 'أنهيت هذا العالم بالكامل. اختر عالمًا جديدًا عندما تكون مستعدًا لمواصلة التعلّم.',
        worldId: cleanString(destination?.worldId, 128),
        completedWorld: true,
        primary: true,
      };
    }
    if (signals.activeJourney && isJourneySessionDestination(destination)) {
      return {
        id: 'resume-journey-session',
        label: destination.type === 'gate-clear' ? 'أكمل محاولتك' : 'أكمل اختبارك',
        hint: 'سنفتح جلستك المحفوظة من حيث توقفت.',
        worldId: cleanString(signals.activeJourney.worldId, 128),
        primary: true,
      };
    }
    if (signals.resumableQuiz) {
      return {
        id: 'resume-quiz',
        label: 'أكمل جلستك',
        hint: 'اختبارك محفوظ ويمكنك المتابعة من السؤال الحالي.',
        primary: true,
      };
    }
    if (signals.activeJourney) {
      return {
        id: 'continue-journey',
        label: 'تابع رحلتك',
        hint: 'تابع من حيث توقفت؛ وجهتك الحالية لم تتغير.',
        worldId: cleanString(signals.activeJourney.worldId, 128),
        primary: true,
      };
    }
    if (signals.wordCount > 0 || signals.srsCount > 0) {
      return {
        id: 'review-words',
        label: 'راجع كلماتك',
        hint: signals.hasPublishedWorld ? 'كلماتك محفوظة، ويمكنك استكشاف العوالم أيضًا.' : 'كلماتك محفوظة كما هي.',
        secondaryId: selectedWorldId ? 'open-selected-world' : (signals.hasPublishedWorld ? 'explore-worlds' : ''),
        secondaryLabel: selectedWorldId ? 'افتح العالم الذي اخترته' : (signals.hasPublishedWorld ? 'اكتشف العوالم' : ''),
        secondaryWorldId: selectedWorldId,
        worldId: selectedWorldId,
        primary: true,
      };
    }
    if (signals.hasMeaningfulJourneyProgress) {
      return {
        id: 'explore-worlds',
        label: 'اكتشف العوالم',
        hint: 'تقدّمك محفوظ كما هو، ويمكنك اختيار وجهتك التالية من العوالم المتاحة.',
        primary: true,
      };
    }
    if (signals.placementEligible && signals.isAuthenticated && !signals.hasJourneyProgress) {
      return {
        id: 'suggest-placement',
        label: 'اكتشف مستواك',
        hint: 'اقتراح اختياري يساعدك على معرفة نقطة مناسبة، ويمكنك الاستكشاف بدلًا منه.',
        secondaryId: 'explore-worlds',
        secondaryLabel: 'استكشف العوالم',
        primary: true,
      };
    }
    if (selectedWorldId) {
      return {
        id: 'open-selected-world',
        label: 'استكشف العالم الذي اخترته',
        hint: 'سنفتح صفحة العالم نفسها. الاستكشاف متاح للضيف، وبدء الرحلة المحفوظة يطلب الحساب في سياقه فقط.',
        worldId: selectedWorldId,
        primary: true,
      };
    }
    return {
      id: signals.hasPublishedWorld ? 'explore-worlds' : 'new-user-start',
      label: signals.hasPublishedWorld ? 'اكتشف العوالم' : 'أضف أول كلمة',
      hint: signals.hasPublishedWorld
        ? 'افتح مساحة العوالم واختر بدايتك بنفسك.'
        : 'ابدأ بقاموسك الشخصي، وسنحتفظ بكلماتك كما هي.',
      primary: true,
    };
  }

  function ctaContradictsSignals(action, signalsInput) {
    const signals = signalsInput && signalsInput.profileSignals
      ? signalsInput
      : normalizeSignals(signalsInput || {});
    const id = cleanString(action && action.id, 80);
    if (!CTA_IDS.includes(id)) return true;
    if (id === 'new-user-start' && signals.hasMeaningfulJourneyProgress) return true;
    if (id === 'resume-journey-session' && (!signals.activeJourney || !isJourneySessionDestination(signals.journeyDestination))) return true;
    if (id === 'continue-journey' && !signals.activeJourney) return true;
    if (id === 'resume-quiz' && !signals.resumableQuiz) return true;
    if (id === 'review-words' && signals.wordCount === 0 && signals.srsCount === 0) return true;
    if (id === 'open-selected-world' && !cleanString(action?.worldId || action?.secondaryWorldId, 128)) return true;
    if (id === 'suggest-placement' && (!signals.placementEligible || signals.hasJourneyProgress || !signals.isAuthenticated)) return true;
    return false;
  }

  function stepRank(step) {
    return Math.max(0, STEPS.indexOf(cleanEnum(step, STEPS, 'interests')));
  }

  function journeyStatusRank(status) {
    return Math.max(0, JOURNEY_STATUSES.indexOf(cleanEnum(status, JOURNEY_STATUSES, 'pending')));
  }

  function gamerStatusRank(status) {
    const ranks = {
      'not-applicable': 0,
      offered: 1,
      running: 2,
      skipped: 3,
      unavailable: 3,
      completed: 4,
    };
    return ranks[cleanEnum(status, GAMER_STATUSES, 'not-applicable')] || 0;
  }

  function mergeEntryStates(accountRaw, guestRaw, context) {
    const account = normalizeEntryState(accountRaw, context);
    const guest = normalizeEntryState(guestRaw, context);
    if (account && isTerminalState(account)) return { state: account, source: 'account', changed: false };
    if (!guest) return { state: account, source: account ? 'account' : 'none', changed: false };
    if (!account) {
      return {
        state: {
          ...guest,
          audience: guest.audience === 'new' ? 'returning-guest' : guest.audience,
          classification: guest.classification === 'brand-new'
            ? 'returning-guest-with-local-data'
            : guest.classification,
          source: 'guest-migration',
        },
        source: 'guest',
        changed: true,
      };
    }
    if (isTerminalState(guest)) {
      return {
        state: {
          ...guest,
          audience: account.audience,
          classification: account.classification,
          source: 'guest-migration',
        },
        source: 'guest-terminal',
        changed: true,
      };
    }

    const furthest = stepRank(guest.currentStep) > stepRank(account.currentStep) ? guest : account;
    const accountIds = account.interestsStatus === 'selected' ? account.interestIds : [];
    const guestIds = guest.interestsStatus === 'selected' ? guest.interestIds : [];
    const interestIds = uniqueStrings([...accountIds, ...guestIds], INTEREST_IDS, INTEREST_IDS.length);
    const interestsStatus = interestIds.length
      ? 'selected'
      : (account.interestsStatus === 'skipped' || guest.interestsStatus === 'skipped' ? 'skipped' : 'pending');
    const appearance = account.themeExplicit
      ? account
      : (guest.themeExplicit ? guest : (account.themeId ? account : guest));
    const journeySource = journeyStatusRank(guest.journeyStatus) > journeyStatusRank(account.journeyStatus)
      ? guest
      : account;
    const worldSource = furthest.selectedWorldId
      ? furthest
      : (account.selectedWorldId ? account : guest);
    const gamerSource = gamerStatusRank(guest.gamerStatus) > gamerStatusRank(account.gamerStatus)
      ? guest
      : account;
    const merged = normalizeEntryState({
      ...account,
      status: 'in-progress',
      currentStep: furthest.currentStep,
      interestsStatus,
      interestIds,
      themeStatus: appearance.themeStatus,
      themeId: appearance.themeId,
      oasisMode: appearance.oasisMode,
      themeExplicit: appearance.themeExplicit,
      journeyStatus: journeySource.journeyStatus,
      selectedWorldId: worldSource.selectedWorldId,
      gamerStatus: gamerSource.gamerStatus,
      source: 'guest-migration',
      startedAt: Math.min(
        ...[account.startedAt, guest.startedAt].filter(Boolean)
      ) || account.startedAt || guest.startedAt,
      updatedAt: Math.max(account.updatedAt, guest.updatedAt),
    });
    return { state: merged, source: 'merged-draft', changed: true };
  }

  function transitionState(rawState, event, nowValue) {
    const state = normalizeEntryState(rawState);
    if (!state) throw new TypeError('A valid entry state is required.');
    if (isTerminalState(state)) return state;
    const action = isPlainObject(event) ? event : {};
    const type = cleanString(action.type, 80);
    const now = timestampMillis(nowValue) || Date.now();
    let next = { ...state, interestIds: [...state.interestIds], updatedAt: now };
    if (!next.startedAt) next.startedAt = now;

    if (type === 'select-interests') {
      const ids = uniqueStrings(action.interestIds, INTEREST_IDS, INTEREST_IDS.length);
      next.interestIds = ids;
      next.interestsStatus = ids.length ? 'selected' : 'pending';
    } else if (type === 'continue-interests') {
      if (next.interestsStatus !== 'selected' || !next.interestIds.length) {
        throw new RangeError('At least one interest is required to continue.');
      }
      next.currentStep = 'theme';
    } else if (type === 'skip-interests') {
      next.interestsStatus = 'skipped';
      next.interestIds = [];
      next.currentStep = 'theme';
    } else if (type === 'select-theme') {
      next.themeId = cleanEnum(action.themeId, THEME_IDS, '');
      if (!next.themeId) throw new RangeError('A supported theme is required.');
      next.oasisMode = cleanEnum(action.oasisMode, OASIS_MODES, next.oasisMode || 'light');
      next.themeStatus = 'selected';
      next.themeExplicit = true;
    } else if (type === 'continue-theme') {
      if (next.currentStep !== 'theme') {
        throw new RangeError('The theme step must be active before Worlds onboarding.');
      }
      next.currentStep = 'worlds';
    } else if (type === 'select-world') {
      if (next.currentStep !== 'worlds') {
        throw new RangeError('Worlds onboarding must be active before selecting a world.');
      }
      const worldId = cleanString(action.worldId, 128);
      if (!worldId) throw new RangeError('A published world is required.');
      next.selectedWorldId = worldId;
      next.journeyStatus = 'world-selected';
    } else if (type === 'continue-worlds') {
      if (next.currentStep !== 'worlds' || next.journeyStatus !== 'world-selected') {
        throw new RangeError('A world must be selected before exploring its structure.');
      }
      next.currentStep = 'journey';
    } else if (type === 'continue-worlds-fallback') {
      if (next.currentStep !== 'worlds') {
        throw new RangeError('Worlds onboarding must be active before using its fallback.');
      }
      next.selectedWorldId = '';
      next.journeyStatus = 'world-selected';
      next.currentStep = 'journey';
    } else if (type === 'explore-structure') {
      if (next.currentStep !== 'journey') {
        throw new RangeError('Journey structure must be active before it can be explored.');
      }
      next.journeyStatus = 'structure-explored';
    } else if (type === 'continue-journey') {
      if (next.currentStep !== 'journey' || next.journeyStatus !== 'structure-explored') {
        throw new RangeError('Journey structure must be explored before continuing.');
      }
      if (next.interestIds.includes('games')) {
        next.currentStep = 'context';
        if (next.gamerStatus === 'not-applicable') next.gamerStatus = 'offered';
      } else {
        next.currentStep = 'destination';
        next.gamerStatus = 'not-applicable';
      }
    } else if (type === 'start-gamer-demo') {
      if (next.currentStep !== 'context') {
        throw new RangeError('The contextual feature step must be active.');
      }
      next.gamerStatus = 'running';
    } else if (type === 'finish-gamer-demo') {
      if (next.currentStep !== 'context') {
        throw new RangeError('The contextual feature step must be active.');
      }
      next.gamerStatus = action.outcome === 'completed' ? 'completed' : 'unavailable';
    } else if (type === 'skip-gamer-demo') {
      if (next.currentStep !== 'context') {
        throw new RangeError('The contextual feature step must be active.');
      }
      next.gamerStatus = 'skipped';
      next.currentStep = 'destination';
    } else if (type === 'continue-context') {
      if (next.currentStep !== 'context' || !['completed', 'unavailable', 'skipped'].includes(next.gamerStatus)) {
        throw new RangeError('The contextual feature must finish or be skipped before continuing.');
      }
      next.currentStep = 'destination';
    } else if (type === 'review-return') {
      if (next.currentStep !== 'return') {
        throw new RangeError('The saved Journey reminder must be active.');
      }
      next.journeyStatus = 'return-reviewed';
    } else if (type === 'continue-return') {
      if (next.currentStep !== 'return' || next.journeyStatus !== 'return-reviewed') {
        throw new RangeError('The saved Journey reminder must be reviewed before continuing.');
      }
      next.currentStep = 'destination';
    } else if (type === 'complete') {
      if (next.currentStep !== 'destination') {
        throw new RangeError('The final destination step must be reached before completion.');
      }
      if (!['structure-explored', 'return-reviewed'].includes(next.journeyStatus)) {
        throw new RangeError('The required Journey interaction must be completed before onboarding completion.');
      }
      next.status = 'completed';
      next.currentStep = 'destination';
      next.completedAt = now;
      next.skippedAt = 0;
      if (next.themeStatus === 'pending') next.themeStatus = next.themeId ? 'preserved' : 'preserved';
    } else if (type === 'back') {
      if (next.currentStep === 'theme') next.currentStep = 'interests';
      else if (next.currentStep === 'worlds') next.currentStep = 'theme';
      else if (next.currentStep === 'journey') next.currentStep = 'worlds';
      else if (next.currentStep === 'context') next.currentStep = 'journey';
      else if (next.currentStep === 'destination') {
        next.currentStep = next.interestIds.includes('games') && next.gamerStatus !== 'not-applicable'
          ? 'context'
          : 'journey';
      }
    } else {
      throw new RangeError('Unsupported entry state transition.');
    }
    return normalizeEntryState(next);
  }

  function sanitizePendingIntent(raw, nowValue) {
    if (!isPlainObject(raw)) return null;
    const action = cleanEnum(raw.action, [
      'start-journey',
      'begin-journey-from-start',
      'start-placement',
      'start-level-placement',
    ], '');
    const worldId = cleanString(raw.worldId, 128);
    const operationId = cleanString(raw.operationId, 180);
    const createdAt = timestampMillis(raw.createdAt);
    const now = timestampMillis(nowValue) || Date.now();
    if (!action || !worldId || !operationId || !createdAt) return null;
    if (createdAt > now + 60 * 1000 || now - createdAt > 24 * 60 * 60 * 1000) return null;
    const status = cleanEnum(raw.status, ['pending', 'consuming', 'consumed', 'cancelled'], 'pending');
    const cefrLevel = cleanEnum(raw.cefrLevel, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], '');
    if (action === 'start-level-placement' && !cefrLevel) return null;
    return {
      version: 1,
      action,
      worldId,
      cefrLevel,
      source: cleanEnum(raw.source, ['entry', 'world', 'placement'], 'world'),
      entryStep: cleanEnum(raw.entryStep, [...STEPS, 'action'], 'destination'),
      operationId,
      createdAt,
      status,
      leaseUntil: timestampMillis(raw.leaseUntil),
      consumedAt: timestampMillis(raw.consumedAt),
      returnTo: sanitizeInternalPath(raw.returnTo),
    };
  }

  function resolvePendingIntentCandidate(accountRaw, guestRaw, nowValue) {
    const now = timestampMillis(nowValue) || Date.now();
    const account = sanitizePendingIntent(accountRaw, now);
    const guest = sanitizePendingIntent(guestRaw, now);
    const result = (intent, source) => ({
      intent,
      source,
      accountValid: Boolean(account),
      guestValid: Boolean(guest),
    });
    if (!account && !guest) return result(null, 'none');
    if (!guest) return result(account, 'account');
    if (!account) return result(guest, 'guest');

    const active = (intent) => intent.status === 'pending' || intent.status === 'consuming';
    const terminal = (intent) => intent.status === 'consumed' || intent.status === 'cancelled';
    if (account.operationId === guest.operationId) {
      // A terminal record for the same operation is authoritative regardless
      // of which namespace was persisted first, preventing a duplicate resume.
      if (terminal(account)) return result(account, 'account');
      if (terminal(guest)) return result(guest, 'guest');
      if (account.status === 'consuming' && guest.status !== 'consuming') {
        return result(account, 'account');
      }
      if (guest.status === 'consuming' && account.status !== 'consuming') {
        return result(guest, 'guest');
      }
      return result(account, 'account');
    }

    // A terminal marker for an older, unrelated operation must never erase a
    // newly requested guest Journey. Between two actionable intents the most
    // recently created explicit action wins; account scope wins exact ties.
    if (active(account) !== active(guest)) {
      return active(account) ? result(account, 'account') : result(guest, 'guest');
    }
    if (guest.createdAt > account.createdAt) return result(guest, 'guest');
    return result(account, 'account');
  }

  function resolveThemeIntro(seenInput, themeInput) {
    const seenIds = uniqueStrings(seenInput, PRESERVABLE_THEME_IDS, 12);
    const themeId = cleanEnum(themeInput, PRESERVABLE_THEME_IDS, '');
    if (!themeId || seenIds.includes(themeId)) {
      return { themeId, shouldAnnounce: false, seenIds };
    }
    return {
      themeId,
      shouldAnnounce: true,
      seenIds: uniqueStrings([...seenIds, themeId], PRESERVABLE_THEME_IDS, 12),
    };
  }

  function sanitizeInternalPath(value) {
    const path = cleanString(value, 500);
    if (!path || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) return '/app';
    try {
      const parsed = new URL(path, 'https://lootlingua.invalid');
      if (parsed.origin !== 'https://lootlingua.invalid') return '/app';
      return `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, 500);
    } catch (_) {
      return '/app';
    }
  }

  const API = deepFreeze({
    EXPERIENCE_VERSION,
    CONTRACT_VERSION,
    RELEASE_AT,
    STATUSES,
    TERMINAL_STATUSES,
    STEPS,
    JOURNEY_STATUSES,
    GAMER_STATUSES,
    AUDIENCES,
    CLASSIFICATIONS,
    INTEREST_STATUSES,
    THEME_STATUSES,
    THEME_IDS,
    PRESERVABLE_THEME_IDS,
    OASIS_MODES,
    INTERESTS,
    INTEREST_IDS,
    CTA_IDS,
    storageOwner,
    entryStorageKey,
    guestEntryClaimStorageKey,
    pendingIntentStorageKey,
    profileMigrationStorageKey,
    guestMigrationReceiptStorageKey,
    themeStorageKey,
    oasisModeStorageKey,
    themeIntroStorageKey,
    timestampMillis,
    normalizeEntryState,
    normalizeLegacyPreferences,
    createEntryDraft,
    isTerminalState,
    recoverUnverifiedTerminal,
    shouldPresent,
    wordHasSrs,
    wordIsHiddenOrMastered,
    isResumableQuizSession,
    normalizeSignals,
    classifyUser,
    entryCopy,
    isWorldCompletedDestination,
    alignStateToJourneyDestination,
    resolveNextAction,
    ctaContradictsSignals,
    mergeEntryStates,
    transitionState,
    sanitizePendingIntent,
    resolvePendingIntentCandidate,
    resolveThemeIntro,
    sanitizeInternalPath,
  });

  Object.defineProperty(root, 'LootLinguaEntryExperience', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
