export const ENTRY_RELEASE_AT = Date.UTC(2026, 6, 30, 0, 0, 0);
export const FIXED_NOW = Date.UTC(2026, 7, 15, 12, 0, 0);
export const OLD_ACCOUNT_CREATED_AT = Date.UTC(2025, 4, 10, 8, 0, 0);
export const FRESH_ACCOUNT_CREATED_AT = ENTRY_RELEASE_AT + (5 * 60 * 1000);

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function legacyWord(overrides = {}) {
  return {
    id: 'legacy-word',
    word: 'sword',
    meaning: 'سيف',
    category: 'عام',
    createdAt: '2025-05-10T08:00:00.000Z',
    ...overrides,
  };
}

function legacyProfile(overrides = {}) {
  return {
    userXP: 0,
    xpEconomyVersion: 2,
    dailyStreak: 0,
    maxStreak: 0,
    activityMap: {},
    theme: 'lootlingua',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function activeQuizSession(overrides = {}) {
  return {
    id: 'quiz-legacy-pending',
    mode: 'timeAttack',
    source: 'personal',
    createdAt: Date.UTC(2026, 6, 20, 9, 0, 0),
    words: [
      legacyWord({ id: 'quiz-word-a', word: 'apple', meaning: 'تفاحة' }),
      legacyWord({ id: 'quiz-word-b', word: 'book', meaning: 'كتاب' }),
    ],
    quizIndex: 1,
    currentStreak: 2,
    hasStartedAnswering: true,
    ...overrides,
  };
}

function activeJourney(overrides = {}) {
  return {
    worldId: 'world-legacy-a1',
    activeRankId: 'rank-a1',
    activeGateId: 'gate-a1-2',
    status: 'active',
    journeyVersion: 1,
    contentJourneyStatus: 'in-progress',
    ...overrides,
  };
}

function entryState(overrides = {}) {
  return {
    contractVersion: 1,
    experienceVersion: 1,
    status: 'in-progress',
    audience: 'returning',
    classification: 'returning-light',
    currentStep: 'interests',
    interestsStatus: 'pending',
    interestIds: [],
    themeStatus: 'pending',
    themeId: '',
    oasisMode: 'light',
    themeExplicit: false,
    source: 'app-entry',
    startedAt: Date.UTC(2026, 7, 1, 10, 0, 0),
    updatedAt: Date.UTC(2026, 7, 1, 10, 0, 0),
    completedAt: 0,
    skippedAt: 0,
    ...overrides,
  };
}

const accountBase = {
  isAuthenticated: true,
  accountCreatedAt: OLD_ACCOUNT_CREATED_AT,
  accountLastSignInAt: FIXED_NOW,
  now: FIXED_NOW,
  hasPublishedWorld: true,
};

export const legacyEntryFixtures = deepFreeze({
  accountWordsAndXpNoJourney: {
    input: {
      ...accountBase,
      uid: 'legacy-words-xp',
      profileExists: true,
      profile: legacyProfile({
        userXP: 340,
        lastActivityDate: '2026-07-20',
        activityMap: { '2026-07-20': 4 },
      }),
      words: [
        legacyWord({ id: 'legacy-sword' }),
        legacyWord({ id: 'legacy-book', word: 'book', meaning: 'كتاب' }),
      ],
    },
    expected: {
      classification: 'returning-with-progress',
      audience: 'returning',
      actionId: 'review-words',
    },
  },

  accountActiveJourney: {
    input: {
      ...accountBase,
      uid: 'legacy-active-journey',
      profileExists: true,
      profile: legacyProfile({ userXP: 880 }),
      activeJourney: activeJourney(),
      hasJourneyProgress: true,
      journeyDestination: { type: 'gate', reason: 'started', state: 'learning' },
    },
    expected: {
      classification: 'returning-with-progress',
      audience: 'returning',
      actionId: 'continue-journey',
    },
  },

  accountActiveJourneySession: {
    input: {
      ...accountBase,
      uid: 'legacy-journey-session',
      profileExists: true,
      profile: legacyProfile({ userXP: 920 }),
      activeJourney: activeJourney(),
      hasJourneyProgress: true,
      activeQuizSession: activeQuizSession(),
      journeyDestination: {
        type: 'level-placement',
        reason: 'active-assessment',
        session: { assessmentId: 'level-placement-legacy' },
      },
    },
    expected: {
      classification: 'returning-with-progress',
      audience: 'returning',
      actionId: 'resume-journey-session',
    },
  },

  accountHiddenMasteredSrs: {
    input: {
      ...accountBase,
      uid: 'legacy-hidden-mastered',
      profileExists: true,
      profile: legacyProfile({ userXP: 120 }),
      words: [
        legacyWord({
          id: 'legacy-hidden-reviewing',
          word: 'hidden',
          hiddenFromDictionary: true,
          hiddenFromDictionaryAt: '2026-06-10T08:00:00.000Z',
          mastery_status: 'Reviewing',
          mastery_streak: 2,
          last_recalled_at: '2026-07-10T08:00:00.000Z',
        }),
        legacyWord({
          id: 'legacy-mastered',
          word: 'mastered',
          mastery_status: 'Mastered',
          mastery_streak: 4,
          mastered_once: true,
          firstMasteredAt: '2026-06-12T08:00:00.000Z',
          earnedTransitions: ['new_learning', 'learning_reviewing', 'reviewing_mastered'],
        }),
      ],
      srsEntryCount: 2,
    },
    expected: {
      classification: 'returning-with-progress',
      audience: 'returning',
      actionId: 'review-words',
    },
  },

  accountPendingQuiz: {
    input: {
      ...accountBase,
      uid: 'legacy-pending-quiz',
      profileExists: true,
      profile: legacyProfile({ userXP: 210 }),
      activeJourney: activeJourney(),
      journeyDestination: { type: 'gate', reason: 'started' },
      activeQuizSession: activeQuizSession(),
    },
    expected: {
      classification: 'returning-with-progress',
      audience: 'returning',
      actionId: 'resume-quiz',
    },
  },

  accountOasisTheme: {
    input: {
      ...accountBase,
      uid: 'legacy-oasis-theme',
      profileExists: true,
      profile: legacyProfile({ theme: 'ocean' }),
    },
    expected: {
      classification: 'returning-light',
      audience: 'returning',
      actionId: 'new-user-start',
    },
  },

  accountWithoutEntryFields: {
    input: {
      ...accountBase,
      uid: 'legacy-no-entry-fields',
      profileExists: true,
      profile: legacyProfile(),
      legacyMarkers: {},
    },
    expected: {
      classification: 'existing-account-without-meaningful-progress',
      audience: 'returning',
      actionId: 'new-user-start',
    },
  },

  oldAccountWithoutProfile: {
    input: {
      ...accountBase,
      uid: 'legacy-old-timestamp-only',
      profileExists: false,
      profile: {},
    },
    expected: {
      classification: 'existing-account-without-meaningful-progress',
      audience: 'returning',
      actionId: 'new-user-start',
    },
  },

  accountProgressWithoutWordsOrJourney: {
    input: {
      ...accountBase,
      uid: 'legacy-progress-only',
      profileExists: true,
      profile: legacyProfile({ userXP: 75, activityMap: { '2026-06-01': 1 } }),
      hasWorldProgress: true,
      hasCompletionLedger: true,
    },
    expected: {
      classification: 'returning-with-progress',
      audience: 'returning',
      actionId: 'explore-worlds',
    },
  },

  guestWithLocalWords: {
    input: {
      isAuthenticated: false,
      now: FIXED_NOW,
      hasPublishedWorld: true,
      guestWords: [
        legacyWord({ id: 'guest-legacy-sword' }),
        legacyWord({ id: 'guest-legacy-map', word: 'map', meaning: 'خريطة' }),
      ],
      legacyMarkers: { lootlinguaOnboarding: 'skipped' },
    },
    expected: {
      classification: 'returning-guest-with-local-data',
      audience: 'returning-guest',
      actionId: 'review-words',
    },
  },

  guestWithLocalSessionAndDraft: {
    input: {
      isAuthenticated: false,
      now: FIXED_NOW,
      hasPublishedWorld: true,
      activeQuizSession: activeQuizSession({ mode: 'scramble' }),
      hasLocalLearningDraft: true,
      localDraft: entryState({
        audience: 'returning-guest',
        classification: 'returning-guest-with-local-data',
        currentStep: 'theme',
        interestsStatus: 'selected',
        interestIds: ['games', 'technology'],
        themeStatus: 'preserved',
        themeId: 'ocean',
        oasisMode: 'dark',
      }),
    },
    expected: {
      classification: 'returning-guest-with-local-data',
      audience: 'returning-guest',
      actionId: 'resume-quiz',
    },
  },

  guestWithLegacyMarkerOnly: {
    input: {
      isAuthenticated: false,
      now: FIXED_NOW,
      hasPublishedWorld: true,
      legacyMarkers: {
        lootlinguaOnboarding: 'completed',
        hasCompletedOnboarding: true,
      },
    },
    expected: {
      classification: 'returning-guest-with-local-data',
      audience: 'returning-guest',
      actionId: 'explore-worlds',
    },
  },

  freshAccount: {
    input: {
      isAuthenticated: true,
      uid: 'fresh-account',
      accountCreatedAt: FRESH_ACCOUNT_CREATED_AT,
      accountLastSignInAt: FRESH_ACCOUNT_CREATED_AT + 1000,
      now: FRESH_ACCOUNT_CREATED_AT + (10 * 60 * 1000),
      profileExists: false,
      profile: {},
      hasPublishedWorld: true,
    },
    expected: {
      classification: 'brand-new',
      audience: 'new',
      actionId: 'new-user-start',
    },
  },

  freshAccountWithForeignDeviceMarker: {
    input: {
      isAuthenticated: true,
      uid: 'fresh-account-b',
      accountCreatedAt: FRESH_ACCOUNT_CREATED_AT,
      accountLastSignInAt: FRESH_ACCOUNT_CREATED_AT + 1000,
      now: FRESH_ACCOUNT_CREATED_AT + (10 * 60 * 1000),
      profileExists: false,
      profile: {},
      hasPublishedWorld: true,
      legacyMarkers: { lootlinguaOnboarding: 'completed' },
    },
    expected: {
      classification: 'brand-new',
      audience: 'new',
      actionId: 'new-user-start',
    },
  },

  emptyGuest: {
    input: {
      isAuthenticated: false,
      now: FIXED_NOW,
      hasPublishedWorld: true,
      profile: {},
    },
    expected: {
      classification: 'brand-new',
      audience: 'new',
      actionId: 'explore-worlds',
    },
  },
});

export const persistedEntryStates = deepFreeze({
  inProgressTheme: entryState({
    currentStep: 'theme',
    interestsStatus: 'selected',
    interestIds: ['games', 'travel'],
    themeStatus: 'preserved',
    themeId: 'ocean',
    oasisMode: 'dark',
  }),
  completed: entryState({
    status: 'completed',
    currentStep: 'action',
    interestsStatus: 'selected',
    interestIds: ['games'],
    themeStatus: 'selected',
    themeId: 'ocean',
    oasisMode: 'dark',
    themeExplicit: true,
    completedAt: Date.UTC(2026, 7, 2, 11, 0, 0),
    updatedAt: Date.UTC(2026, 7, 2, 11, 0, 0),
  }),
  skipped: entryState({
    status: 'skipped',
    currentStep: 'action',
    interestsStatus: 'selected',
    interestIds: ['study'],
    themeStatus: 'preserved',
    themeId: 'ocean',
    oasisMode: 'light',
    themeExplicit: false,
    skippedAt: Date.UTC(2026, 7, 3, 12, 0, 0),
    updatedAt: Date.UTC(2026, 7, 3, 12, 0, 0),
  }),
});

export const guestMergeFixtures = deepFreeze({
  accountDraft: entryState({
    audience: 'returning',
    classification: 'returning-light',
    currentStep: 'interests',
    interestsStatus: 'selected',
    interestIds: ['games'],
    themeStatus: 'preserved',
    themeId: 'ocean',
    oasisMode: 'light',
    updatedAt: Date.UTC(2026, 7, 1, 10, 0, 0),
  }),
  guestDraft: entryState({
    audience: 'returning-guest',
    classification: 'returning-guest-with-local-data',
    currentStep: 'theme',
    interestsStatus: 'selected',
    interestIds: ['study', 'travel'],
    themeStatus: 'selected',
    themeId: 'ocean',
    oasisMode: 'dark',
    themeExplicit: true,
    updatedAt: Date.UTC(2026, 7, 2, 10, 0, 0),
  }),
  guestCompleted: entryState({
    status: 'completed',
    audience: 'returning-guest',
    classification: 'returning-guest-with-local-data',
    currentStep: 'action',
    interestsStatus: 'selected',
    interestIds: ['technology'],
    themeStatus: 'selected',
    themeId: 'lootlingua',
    themeExplicit: true,
    completedAt: Date.UTC(2026, 7, 4, 10, 0, 0),
    updatedAt: Date.UTC(2026, 7, 4, 10, 0, 0),
  }),
});

export const scopedIdentities = deepFreeze({
  guest: {},
  accountA: { uid: 'legacy-account-a' },
  accountB: { uid: 'legacy-account-b' },
});

export function cloneFixture(value) {
  return structuredClone(value);
}

