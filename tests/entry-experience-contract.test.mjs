import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  FIXED_NOW,
  FRESH_ACCOUNT_CREATED_AT,
  cloneFixture,
  legacyEntryFixtures,
  persistedEntryStates,
  scopedIdentities,
} from './fixtures/entry-experience-legacy-fixtures.mjs';

const source = await readFile(
  new URL('../js/entry-experience-contract.js', import.meta.url),
  'utf8'
);

const root = {};
const evaluateContract = new Function(
  'window',
  'globalThis',
  `${source}\nreturn window.LootLinguaEntryExperience;`
);
evaluateContract(root, root);

const entry = root.LootLinguaEntryExperience;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function v2State(overrides = {}) {
  return entry.normalizeEntryState({
    contractVersion: 2,
    experienceVersion: 2,
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
    journeyStatus: 'pending',
    selectedWorldId: '',
    gamerStatus: 'not-applicable',
    source: 'app-entry',
    startedAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    completedAt: 0,
    skippedAt: 0,
    ...overrides,
  });
}

function fixtureResult(fixture) {
  const classified = entry.classifyUser(fixture.input);
  const action = entry.resolveNextAction(classified.signals);
  return { classified, action };
}

function authenticatedFresh(overrides = {}) {
  return {
    isAuthenticated: true,
    uid: 'fresh-signal-probe',
    accountCreatedAt: FRESH_ACCOUNT_CREATED_AT,
    accountLastSignInAt: FRESH_ACCOUNT_CREATED_AT + 1000,
    now: FRESH_ACCOUNT_CREATED_AT + (10 * 60 * 1000),
    profileExists: false,
    profile: {},
    hasPublishedWorld: true,
    ...overrides,
  };
}

test('the versioned Entry Experience contract exposes frozen central enums and APIs', () => {
  assert.ok(entry);
  assert.equal(entry.EXPERIENCE_VERSION, 2);
  assert.equal(entry.CONTRACT_VERSION, 2);
  assert.deepEqual(Array.from(entry.STATUSES), ['in-progress', 'completed']);
  assert.deepEqual(Array.from(entry.AUDIENCES), ['new', 'returning', 'returning-guest']);
  assert.deepEqual(Array.from(entry.STEPS), ['interests', 'theme', 'worlds', 'journey', 'context', 'destination', 'return']);
  assert.deepEqual(Array.from(entry.JOURNEY_STATUSES), ['pending', 'world-selected', 'structure-explored', 'return-reviewed']);
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.INTERESTS));
  assert.equal(Object.getOwnPropertyDescriptor(root, 'LootLinguaEntryExperience').writable, false);
});

test('legacy production fixtures classify safely and resolve the expected central CTA', () => {
  for (const [name, fixture] of Object.entries(legacyEntryFixtures)) {
    const { classified, action } = fixtureResult(fixture);
    assert.equal(
      classified.classification,
      fixture.expected.classification,
      `${name}: classification`
    );
    assert.equal(classified.audience, fixture.expected.audience, `${name}: audience`);
    const expectedAction = fixture.expected.actionId === 'new-user-start' && classified.signals.hasPublishedWorld
      ? 'explore-worlds'
      : fixture.expected.actionId;
    assert.equal(action.id, expectedAction, `${name}: CTA`);
    assert.equal(
      entry.ctaContradictsSignals(action, classified.signals),
      false,
      `${name}: generated CTA contradicts its signals`
    );
  }
});

test('light data is distinct from meaningful Journey progress', () => {
  const lightSignals = [
    { words: [{ word: 'legacy', meaning: 'قديم' }] },
    { profile: { userXP: 5 } },
    { profile: { activityMap: { '2026-07-01': 1 } } },
    { srsEntryCount: 1 },
    {
      activeQuizSession: {
        id: 'quiz-a', mode: 'scramble', words: [{ word: 'one' }], quizIndex: 0,
      },
    },
  ];
  lightSignals.forEach((signal, index) => {
    const result = entry.classifyUser(authenticatedFresh(signal));
    assert.equal(result.classification, 'returning-light', `light signal ${index}`);
    assert.equal(result.signals.hasAnyData, true);
    assert.equal(result.signals.hasMeaningfulJourneyProgress, false);
    assert.equal(result.signals.strongProgress, false);
  });

  const progressSignals = [
    { activeJourney: { worldId: 'world-a' } },
    { hasWorldProgress: true },
    { hasCompletionLedger: true },
  ];

  progressSignals.forEach((signal, index) => {
    const result = entry.classifyUser(authenticatedFresh(signal));
    assert.equal(result.classification, 'returning-with-progress', `Journey signal ${index}`);
    assert.equal(result.audience, 'returning');
    assert.equal(result.signals.hasMeaningfulJourneyProgress, true);
  });

  assert.equal(
    entry.classifyUser(authenticatedFresh({ profile: { theme: 'ocean' } })).classification,
    'returning-light'
  );
  assert.equal(
    entry.classifyUser(authenticatedFresh({ hasKnownLegacyUse: true })).classification,
    'returning-light'
  );
});

test('an old empty account is returning while a trustworthy fresh account remains brand-new', () => {
  const oldWithNoEntryFields = entry.classifyUser(
    legacyEntryFixtures.accountWithoutEntryFields.input
  );
  assert.equal(
    oldWithNoEntryFields.classification,
    'existing-account-without-meaningful-progress'
  );
  assert.equal(oldWithNoEntryFields.audience, 'returning');

  const oldByTimestamp = entry.classifyUser(legacyEntryFixtures.oldAccountWithoutProfile.input);
  assert.equal(oldByTimestamp.classification, 'existing-account-without-meaningful-progress');

  const failedProfileRead = entry.classifyUser(authenticatedFresh({ profileReadFailed: true }));
  assert.equal(failedProfileRead.classification, 'existing-account-without-meaningful-progress');

  const fresh = entry.classifyUser(legacyEntryFixtures.freshAccount.input);
  assert.equal(fresh.classification, 'brand-new');
  assert.equal(fresh.audience, 'new');

  const freshWithEmptyProfile = entry.classifyUser(authenticatedFresh({
    profileExists: true,
    profile: {},
  }));
  assert.equal(freshWithEmptyProfile.classification, 'brand-new');
  assert.equal(freshWithEmptyProfile.audience, 'new');
});

test('an account created after the build cutoff is still returning once the fresh-account window passes', () => {
  const createdAt = entry.RELEASE_AT + (24 * 60 * 60 * 1000);
  const result = entry.classifyUser(authenticatedFresh({
    accountCreatedAt: createdAt,
    accountLastSignInAt: createdAt,
    now: createdAt + (31 * 60 * 1000),
  }));
  assert.equal(result.classification, 'existing-account-without-meaningful-progress');
  assert.equal(result.audience, 'returning');
});

test('device-global legacy markers identify a guest but never contaminate a fresh account', () => {
  assert.equal(
    entry.classifyUser(legacyEntryFixtures.guestWithLegacyMarkerOnly.input).classification,
    'returning-guest-with-local-data'
  );
  assert.equal(
    entry.classifyUser(legacyEntryFixtures.freshAccountWithForeignDeviceMarker.input)
      .classification,
    'brand-new'
  );
});

test('hidden and mastered legacy words remain meaningful SRS progress', () => {
  const fixture = legacyEntryFixtures.accountHiddenMasteredSrs;
  const classified = entry.classifyUser(fixture.input);
  assert.equal(classified.signals.wordCount, 2);
  assert.equal(classified.signals.hiddenOrMasteredCount, 2);
  assert.ok(classified.signals.srsCount >= 4);
  assert.equal(classified.signals.hasAnyData, true);
  assert.equal(classified.signals.hasMeaningfulJourneyProgress, false);
  assert.equal(classified.signals.strongProgress, false);
  assert.equal(classified.classification, 'returning-light');
  assert.equal(entry.wordIsHiddenOrMastered(fixture.input.words[0]), true);
  assert.equal(entry.wordIsHiddenOrMastered(fixture.input.words[1]), true);
  assert.equal(entry.wordHasSrs(fixture.input.words[0]), true);
  assert.equal(entry.wordHasSrs(fixture.input.words[1]), true);

  assert.equal(entry.wordHasSrs({ mastery_status: 'New' }), false);
  assert.equal(entry.wordIsHiddenOrMastered({ mastery_status: 'New' }), false);
});

test('pending quiz and Journey sessions use the correct resumption priority', () => {
  const quiz = fixtureResult(legacyEntryFixtures.accountPendingQuiz);
  assert.equal(quiz.classified.signals.resumableQuiz, true);
  assert.equal(quiz.action.id, 'resume-quiz');

  const journeySession = fixtureResult(legacyEntryFixtures.accountActiveJourneySession);
  assert.equal(journeySession.classified.signals.resumableQuiz, true);
  assert.equal(journeySession.action.id, 'resume-journey-session');

  const invalidSessions = [
    null,
    { mode: 'flashcards', words: [{ word: 'a' }], quizIndex: 0 },
    { mode: 'timeAttack', words: [], quizIndex: 0 },
    { mode: 'timeAttack', words: [{ word: 'a' }], quizIndex: 1 },
    { mode: 'scramble', words: [{ word: 'a' }], quizIndex: 0, completedAt: FIXED_NOW },
  ];
  invalidSessions.forEach((session, index) => {
    assert.equal(entry.isResumableQuizSession(session), false, `invalid session ${index}`);
  });
});

test('central Journey destination types map to session resume without changing destination', () => {
  for (const type of [
    'level-placement',
    'level-placement-result',
    'placement',
    'placement-result',
    'gate-clear',
  ]) {
    const input = cloneFixture(legacyEntryFixtures.accountActiveJourney.input);
    input.journeyDestination = { type, reason: 'active-session', token: `keep-${type}` };
    const before = cloneFixture(input.journeyDestination);
    const classified = entry.classifyUser(input);
    const action = entry.resolveNextAction(classified.signals);
    assert.equal(action.id, 'resume-journey-session', type);
    assert.deepEqual(input.journeyDestination, before, `${type}: destination mutated`);
  }
});

test('World-completed destination aligns Product Entry to the terminal shortcut contract', () => {
  const destination = {
    type: 'completed-current-content',
    classification: 'world-completed',
    worldId: 'world-complete',
  };
  const signals = entry.normalizeSignals({
    isAuthenticated: true,
    uid: 'completed-user',
    hasJourneyProgress: true,
    journeyDestination: destination,
  });
  const action = entry.resolveNextAction(signals);
  assert.equal(action.id, 'explore-worlds');
  assert.equal(action.completedWorld, true);
  assert.equal(action.worldId, 'world-complete');

  const draft = entry.createEntryDraft(
    { audience: 'returning', classification: 'returning-with-progress' },
    {}
  );
  const aligned = entry.alignStateToJourneyDestination(draft, destination, FIXED_NOW);
  assert.equal(aligned.currentStep, 'destination');
  assert.equal(aligned.journeyStatus, 'return-reviewed');
  assert.equal(aligned.status, 'in-progress');
});

test('copy respects returning progress, local guest data, and the new-user boundary', () => {
  const words = fixtureResult(legacyEntryFixtures.accountWordsAndXpNoJourney);
  const wordsCopy = entry.entryCopy(words.classified.classification, words.classified.signals);
  assert.equal(wordsCopy.title, 'أهلًا بعودتك');
  assert.match(wordsCopy.body, /كلماتك محفوظة/);
  assert.doesNotMatch(`${wordsCopy.body} ${words.action.label}`, /أضف أول كلمة/);

  const journey = fixtureResult(legacyEntryFixtures.accountActiveJourney);
  const journeyCopy = entry.entryCopy(
    journey.classified.classification,
    journey.classified.signals
  );
  assert.equal(journeyCopy.title, 'أهلًا بعودتك');
  assert.match(journeyCopy.body, /رحلتك.*محفوظ/);
  assert.doesNotMatch(
    `${journeyCopy.body} ${journey.action.label} ${journey.action.hint}`,
    /من الصفر|اختر نقطة بداية|لا يوجد تقدم/
  );

  const guest = fixtureResult(legacyEntryFixtures.guestWithLocalWords);
  const guestCopy = entry.entryCopy(guest.classified.classification, guest.classified.signals);
  assert.equal(guestCopy.title, 'أهلًا بعودتك');
  assert.match(guestCopy.body, /هذا الجهاز.*محفوظة/);
  assert.match(guestCopy.body, /كضيف/);

  const fresh = fixtureResult(legacyEntryFixtures.freshAccount);
  const freshCopy = entry.entryCopy(fresh.classified.classification, fresh.classified.signals);
  assert.notEqual(freshCopy.title, 'أهلًا بعودتك');
});

test('no generated CTA contradicts actual words, SRS, sessions, Journey, or progress', () => {
  for (const [name, fixture] of Object.entries(legacyEntryFixtures)) {
    const { classified, action } = fixtureResult(fixture);
    const text = `${action.label || ''} ${action.hint || ''}`;
    assert.equal(entry.ctaContradictsSignals(action, classified.signals), false, name);
    if (classified.signals.wordCount > 0 || classified.signals.srsCount > 0) {
      assert.doesNotMatch(text, /أضف أول كلمة/, name);
    }
    if (classified.signals.hasJourneyProgress) {
      assert.doesNotMatch(text, /من الصفر|اختر نقطة بداية/, name);
    }
    if (classified.signals.strongProgress) {
      assert.notEqual(action.id, 'new-user-start', name);
    }
  }

  const emptySignals = entry.normalizeSignals(authenticatedFresh());
  assert.equal(entry.ctaContradictsSignals({ id: 'resume-journey-session' }, emptySignals), true);
  assert.equal(entry.ctaContradictsSignals({ id: 'continue-journey' }, emptySignals), true);
  assert.equal(entry.ctaContradictsSignals({ id: 'resume-quiz' }, emptySignals), true);
  assert.equal(entry.ctaContradictsSignals({ id: 'review-words' }, emptySignals), true);
  assert.equal(entry.ctaContradictsSignals({ id: 'suggest-placement' }, emptySignals), true);
  assert.equal(
    entry.ctaContradictsSignals(
      { id: 'new-user-start' },
      entry.normalizeSignals(authenticatedFresh({ hasCompletionLedger: true }))
    ),
    true
  );
});

test('progress without words or an active Journey explores worlds instead of claiming a first start', () => {
  const { classified, action } = fixtureResult(
    legacyEntryFixtures.accountProgressWithoutWordsOrJourney
  );
  assert.equal(classified.signals.strongProgress, true);
  assert.equal(action.id, 'explore-worlds');
  assert.doesNotMatch(`${action.label} ${action.hint}`, /أضف أول كلمة|لا يوجد تقدم/);
});

test('Level Placement is suggestion-only and never outranks preserved progress', () => {
  const eligible = entry.classifyUser(authenticatedFresh({ placementEligible: true }));
  assert.equal(entry.resolveNextAction(eligible.signals).id, 'suggest-placement');

  const withProgress = entry.classifyUser(authenticatedFresh({
    placementEligible: true,
    hasWorldProgress: true,
  }));
  assert.equal(entry.resolveNextAction(withProgress.signals).id, 'explore-worlds');

  const withJourney = entry.classifyUser(authenticatedFresh({
    placementEligible: true,
    activeJourney: { worldId: 'world-existing' },
    journeyDestination: { type: 'gate', reason: 'started' },
  }));
  assert.equal(entry.resolveNextAction(withJourney.signals).id, 'continue-journey');
});

test('entry, migration receipt, intent, theme, Oasis, and intro storage keys are scoped per account', () => {
  const keyFactories = [
    (identity) => entry.entryStorageKey(identity),
    (identity) => entry.pendingIntentStorageKey(identity),
    (identity) => entry.profileMigrationStorageKey(identity),
    (identity) => entry.guestMigrationReceiptStorageKey(identity),
    (identity) => entry.themeStorageKey(identity),
    (identity) => entry.oasisModeStorageKey(identity),
    (identity) => entry.themeIntroStorageKey(identity),
  ];

  keyFactories.forEach((makeKey) => {
    const guest = makeKey(scopedIdentities.guest);
    const accountA = makeKey(scopedIdentities.accountA);
    const accountB = makeKey(scopedIdentities.accountB);
    assert.notEqual(guest, accountA);
    assert.notEqual(guest, accountB);
    assert.notEqual(accountA, accountB);
    assert.equal(makeKey(scopedIdentities.accountA), accountA);
  });
  assert.equal(entry.storageOwner({ uid: 'legacy-account-a' }), 'user:legacy-account-a');
  assert.equal(entry.storageOwner({}), 'guest');
  assert.match(entry.entryStorageKey(scopedIdentities.accountA), /:v2:user:legacy-account-a$/);
  assert.match(entry.entryStorageKey(scopedIdentities.accountA, 1), /:v1:user:legacy-account-a$/);
  assert.match(entry.entryStorageKey(scopedIdentities.accountB, 2), /:v2:user:legacy-account-b$/);
});

test('theme intro is claimed once per theme across refresh and A to B to A changes', () => {
  const firstOasis = entry.resolveThemeIntro([], 'ocean');
  assert.equal(firstOasis.shouldAnnounce, true);
  assert.deepEqual(Array.from(firstOasis.seenIds), ['ocean']);

  const refreshedOasis = entry.resolveThemeIntro(firstOasis.seenIds, 'ocean');
  assert.equal(refreshedOasis.shouldAnnounce, false);

  const lootlingua = entry.resolveThemeIntro(firstOasis.seenIds, 'lootlingua');
  assert.equal(lootlingua.shouldAnnounce, true);
  assert.deepEqual(Array.from(lootlingua.seenIds), ['ocean', 'lootlingua']);

  const backToOasis = entry.resolveThemeIntro(lootlingua.seenIds, 'ocean');
  assert.equal(backToOasis.shouldAnnounce, false);
  assert.deepEqual(Array.from(backToOasis.seenIds), ['ocean', 'lootlingua']);
});

test('pending Journey intents are bounded, internal, expiring, and level-aware', () => {
  const now = FIXED_NOW;
  const base = {
    action: 'start-journey',
    worldId: 'published-world-a1',
    operationId: 'operation-123',
    createdAt: now - 1_000,
    status: 'pending',
    returnTo: '/app?view=worlds#published-world-a1',
  };
  const valid = entry.sanitizePendingIntent(base, now);
  assert.equal(valid.worldId, base.worldId);
  assert.equal(valid.returnTo, base.returnTo);
  assert.equal(valid.status, 'pending');

  const external = entry.sanitizePendingIntent({ ...base, returnTo: '//attacker.example/path' }, now);
  assert.equal(external.returnTo, '/app');
  assert.equal(entry.sanitizePendingIntent({ ...base, action: 'award-xp' }, now), null);
  assert.equal(entry.sanitizePendingIntent({ ...base, worldId: '' }, now), null);
  assert.equal(entry.sanitizePendingIntent({ ...base, createdAt: now - (25 * 60 * 60 * 1_000) }, now), null);

  assert.equal(entry.sanitizePendingIntent({
    ...base,
    action: 'start-level-placement',
  }, now), null);
  const placement = entry.sanitizePendingIntent({
    ...base,
    action: 'start-level-placement',
    cefrLevel: 'B1',
  }, now);
  assert.equal(placement.cefrLevel, 'B1');
});

test('creating a returning draft preserves an existing Oasis preference without applying a change', () => {
  const classified = entry.classifyUser(legacyEntryFixtures.accountOasisTheme.input);
  const preferences = { interestIds: ['study'], themeId: 'ocean', oasisMode: 'dark' };
  const before = cloneFixture(preferences);
  const draft = entry.createEntryDraft(classified, preferences);

  assert.equal(draft.status, 'in-progress');
  assert.equal(draft.audience, 'returning');
  assert.equal(draft.classification, 'returning-light');
  assert.equal(draft.themeId, 'ocean');
  assert.equal(draft.oasisMode, 'dark');
  assert.equal(draft.themeStatus, 'preserved');
  assert.equal(draft.themeExplicit, false);
  assert.deepEqual(preferences, before);
});

test('a legacy unlocked appearance can be preserved but cannot be newly selected by Entry v2', () => {
  const draft = entry.createEntryDraft({
    audience: 'returning',
    classification: 'returning-light',
  }, {
    themeId: 'golden',
    interestIds: [],
  });
  assert.equal(draft.themeId, 'golden');
  assert.equal(draft.themeStatus, 'preserved');
  assert.equal(draft.themeExplicit, false);
  assert.throws(
    () => entry.transitionState(draft, { type: 'select-theme', themeId: 'golden' }, FIXED_NOW),
    RangeError
  );
});

test('the full v2 route requires a real World choice and a Journey-structure interaction before destination', () => {
  const classified = entry.classifyUser(legacyEntryFixtures.accountWordsAndXpNoJourney.input);
  const initial = entry.createEntryDraft(classified, {});
  const selected = entry.transitionState(initial, {
    type: 'select-interests',
    interestIds: ['games', 'invalid', 'games', 'technology'],
  }, FIXED_NOW);
  assert.deepEqual(Array.from(selected.interestIds), ['games', 'technology']);
  assert.equal(selected.interestsStatus, 'selected');
  assert.equal(selected.currentStep, 'interests');
  assert.ok(selected.startedAt > 0);

  const themeStep = entry.transitionState(
    selected,
    { type: 'continue-interests' },
    FIXED_NOW + 1000
  );
  assert.equal(themeStep.currentStep, 'theme');

  const themed = entry.transitionState(themeStep, {
    type: 'select-theme', themeId: 'ocean', oasisMode: 'dark',
  }, FIXED_NOW + 2000);
  assert.equal(themed.themeId, 'ocean');
  assert.equal(themed.oasisMode, 'dark');
  assert.equal(themed.themeStatus, 'selected');
  assert.equal(themed.themeExplicit, true);

  const worlds = entry.transitionState(themed, { type: 'continue-theme' }, FIXED_NOW + 3000);
  assert.equal(worlds.currentStep, 'worlds');
  assert.throws(() => entry.transitionState(worlds, { type: 'continue-worlds' }), /world must be selected/i);

  const selectedWorld = entry.transitionState(worlds, {
    type: 'select-world', worldId: 'published-world-games',
  }, FIXED_NOW + 4000);
  assert.equal(selectedWorld.selectedWorldId, 'published-world-games');
  assert.equal(selectedWorld.journeyStatus, 'world-selected');

  const journey = entry.transitionState(selectedWorld, { type: 'continue-worlds' }, FIXED_NOW + 5000);
  assert.equal(journey.currentStep, 'journey');
  assert.throws(() => entry.transitionState(journey, { type: 'continue-journey' }), /explored/i);

  const explored = entry.transitionState(journey, { type: 'explore-structure' }, FIXED_NOW + 6000);
  assert.equal(explored.journeyStatus, 'structure-explored');
  assert.equal(explored.status, 'in-progress');

  const context = entry.transitionState(explored, { type: 'continue-journey' }, FIXED_NOW + 7000);
  assert.equal(context.currentStep, 'context');
  assert.equal(context.gamerStatus, 'offered');
  const skippedContext = entry.transitionState(context, { type: 'skip-gamer-demo' }, FIXED_NOW + 8000);
  assert.equal(skippedContext.currentStep, 'destination');
  assert.equal(skippedContext.gamerStatus, 'skipped');

  const completed = entry.transitionState(skippedContext, { type: 'complete' }, FIXED_NOW + 9000);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.currentStep, 'destination');
  assert.equal(completed.journeyStatus, 'structure-explored');
  assert.equal(completed.completedAt, FIXED_NOW + 9000);
  assert.equal(completed.skippedAt, 0);
  assert.equal(entry.shouldPresent(completed), false);

  assert.throws(
    () => entry.transitionState(initial, { type: 'continue-interests' }, FIXED_NOW),
    RangeError
  );
  assert.throws(
    () => entry.transitionState(initial, { type: 'select-theme', themeId: 'golden' }, FIXED_NOW),
    RangeError
  );
});

test('skipping interests reaches theme, while Back restores the interests step', () => {
  const classified = entry.classifyUser(legacyEntryFixtures.guestWithLocalWords.input);
  const initial = entry.createEntryDraft(classified, { themeId: 'ocean', oasisMode: 'light' });
  const skipped = entry.transitionState(initial, { type: 'skip-interests' }, FIXED_NOW);
  assert.equal(skipped.interestsStatus, 'skipped');
  assert.deepEqual(Array.from(skipped.interestIds), []);
  assert.equal(skipped.currentStep, 'theme');
  assert.equal(skipped.themeId, 'ocean');
  assert.equal(skipped.themeStatus, 'preserved');

  const back = entry.transitionState(skipped, { type: 'back' }, FIXED_NOW + 1000);
  assert.equal(back.currentStep, 'interests');
  assert.equal(back.themeId, 'ocean');
});

test('v2 cannot be globally skipped, and v1 is preference input rather than v2 completion', () => {
  const raw = v2State();
  assert.throws(
    () => entry.transitionState(raw, { type: 'skip-experience' }, FIXED_NOW),
    /unsupported/i
  );
  assert.equal(entry.normalizeEntryState(persistedEntryStates.completed), null);
  assert.equal(entry.shouldPresent(persistedEntryStates.completed), true);
  assert.deepEqual(plain(entry.normalizeLegacyPreferences(persistedEntryStates.completed)), {
    interestIds: ['games'],
    themeId: 'ocean',
    oasisMode: 'dark',
  });
});

test('normalization restores every v2 stage and its interaction proof after refresh', () => {
  const stages = [
    v2State(),
    v2State({ currentStep: 'theme', interestsStatus: 'selected', interestIds: ['games'] }),
    v2State({ currentStep: 'worlds', interestsStatus: 'selected', interestIds: ['games'], themeStatus: 'selected', themeId: 'ocean' }),
    v2State({ currentStep: 'journey', interestsStatus: 'selected', interestIds: ['games'], journeyStatus: 'world-selected', selectedWorldId: 'world-a' }),
    v2State({ currentStep: 'context', interestsStatus: 'selected', interestIds: ['games'], journeyStatus: 'structure-explored', selectedWorldId: 'world-a', gamerStatus: 'running' }),
    v2State({ currentStep: 'destination', journeyStatus: 'structure-explored', selectedWorldId: 'world-a' }),
    v2State({ currentStep: 'return', classification: 'returning-with-progress' }),
  ];
  stages.forEach((saved) => {
    const restored = entry.normalizeEntryState(plain(saved));
    assert.equal(restored.currentStep, saved.currentStep);
    assert.equal(restored.journeyStatus, saved.journeyStatus);
    assert.equal(restored.gamerStatus, saved.gamerStatus);
    assert.equal(restored.selectedWorldId, saved.selectedWorldId);
    assert.equal(entry.shouldPresent(restored), true);
  });
});

test('only completed v2 with Journey proof is once-only for the same scoped account', () => {
  const completedRaw = v2State({
    status: 'completed',
    currentStep: 'destination',
    journeyStatus: 'structure-explored',
    selectedWorldId: 'world-a',
    completedAt: FIXED_NOW + 5000,
  });
  const completedBootOne = entry.normalizeEntryState(completedRaw);
  const completedBootTwo = entry.normalizeEntryState(plain(completedBootOne));

  assert.equal(entry.shouldPresent(completedBootOne), false);
  assert.equal(entry.shouldPresent(completedBootTwo), false);
  assert.equal(entry.shouldPresent(v2State({ currentStep: 'destination', journeyStatus: 'structure-explored' })), true);
  assert.equal(entry.shouldPresent(null), true);
  assert.equal(entry.shouldPresent(persistedEntryStates.completed), true);

  const statesByKey = new Map([
    [entry.entryStorageKey(scopedIdentities.accountA), plain(completedBootTwo)],
    [entry.entryStorageKey(scopedIdentities.accountB), plain(v2State())],
  ]);
  assert.equal(
    entry.shouldPresent(statesByKey.get(entry.entryStorageKey(scopedIdentities.accountA))),
    false
  );
  assert.equal(
    entry.shouldPresent(statesByKey.get(entry.entryStorageKey(scopedIdentities.accountB))),
    true
  );
  assert.equal(entry.shouldPresent(statesByKey.get(entry.entryStorageKey({ uid: 'account-c' }))), true);

  const missingProof = plain(completedBootTwo);
  missingProof.journeyStatus = 'pending';
  const normalizedMissingProof = entry.normalizeEntryState(missingProof);
  assert.equal(entry.shouldPresent(normalizedMissingProof), true);
  const recoveredProgress = entry.recoverUnverifiedTerminal(
    normalizedMissingProof,
    { classification: 'returning-with-progress' },
    FIXED_NOW
  );
  assert.equal(recoveredProgress.status, 'in-progress');
  assert.equal(recoveredProgress.currentStep, 'return');
  assert.equal(recoveredProgress.journeyStatus, 'pending');
});

test('guest-to-account merge preserves v2 route state, terminal completion, and account authority', () => {
  const accountDraft = v2State({
    currentStep: 'theme', interestsStatus: 'selected', interestIds: ['study'], themeId: 'lootlingua', themeStatus: 'preserved',
  });
  const guestDraft = v2State({
    audience: 'new', classification: 'brand-new', currentStep: 'journey', interestsStatus: 'selected',
    interestIds: ['games', 'travel'], themeId: 'ocean', oasisMode: 'dark', themeStatus: 'selected', themeExplicit: true,
    journeyStatus: 'world-selected', selectedWorldId: 'world-games',
  });
  const mergedDraft = entry.mergeEntryStates(
    accountDraft,
    guestDraft,
    { audience: 'returning', classification: 'returning-light' }
  );
  assert.equal(mergedDraft.source, 'merged-draft');
  assert.equal(mergedDraft.changed, true);
  assert.equal(mergedDraft.state.currentStep, 'journey');
  assert.deepEqual(Array.from(mergedDraft.state.interestIds), ['study', 'games', 'travel']);
  assert.equal(mergedDraft.state.themeId, 'ocean');
  assert.equal(mergedDraft.state.oasisMode, 'dark');
  assert.equal(mergedDraft.state.themeExplicit, true);
  assert.equal(mergedDraft.state.selectedWorldId, 'world-games');
  assert.equal(mergedDraft.state.journeyStatus, 'world-selected');
  assert.equal(mergedDraft.state.source, 'guest-migration');

  const guestTerminal = entry.mergeEntryStates(
    accountDraft,
    v2State({
      status: 'completed', currentStep: 'destination', journeyStatus: 'structure-explored',
      selectedWorldId: 'world-games', completedAt: FIXED_NOW + 9000,
    }),
    { audience: 'returning', classification: 'returning-light' }
  );
  assert.equal(guestTerminal.source, 'guest-terminal');
  assert.equal(guestTerminal.state.status, 'completed');
  assert.equal(guestTerminal.state.audience, 'returning');
  assert.equal(guestTerminal.state.classification, 'returning-light');
  assert.equal(entry.shouldPresent(guestTerminal.state), false);

  const accountTerminal = entry.mergeEntryStates(
    v2State({
      status: 'completed', currentStep: 'destination', journeyStatus: 'return-reviewed',
      classification: 'returning-with-progress', completedAt: FIXED_NOW + 9000,
    }),
    guestDraft,
    { audience: 'returning', classification: 'returning-with-progress' }
  );
  assert.equal(accountTerminal.source, 'account');
  assert.equal(accountTerminal.changed, false);
  assert.equal(accountTerminal.state.status, 'completed');
  assert.equal(accountTerminal.state.journeyStatus, 'return-reviewed');

  const guestOnly = entry.mergeEntryStates(null, guestDraft, {
    audience: 'returning', classification: 'returning-light',
  });
  assert.equal(guestOnly.source, 'guest');
  assert.equal(guestOnly.state.audience, 'returning-guest');
  assert.equal(guestOnly.state.classification, 'returning-guest-with-local-data');
});

test('classification, copy, CTA, transitions, and merge do not mutate legacy input data', () => {
  for (const [name, fixture] of Object.entries(legacyEntryFixtures)) {
    const before = cloneFixture(fixture.input);
    const classified = entry.classifyUser(fixture.input);
    entry.entryCopy(classified.classification, classified.signals);
    entry.resolveNextAction(classified.signals);
    entry.ctaContradictsSignals(entry.resolveNextAction(classified.signals), classified.signals);
    assert.deepEqual(fixture.input, before, name);
  }

  const transitionInput = v2State({ currentStep: 'theme', interestsStatus: 'selected', interestIds: ['study'] });
  const transitionBefore = cloneFixture(transitionInput);
  assert.throws(
    () => entry.transitionState(transitionInput, { type: 'skip-experience' }, FIXED_NOW),
    /unsupported/i
  );
  assert.deepEqual(transitionInput, transitionBefore);

  const account = v2State({ interestsStatus: 'selected', interestIds: ['study'] });
  const guest = v2State({ audience: 'new', classification: 'brand-new', currentStep: 'worlds' });
  const accountBefore = cloneFixture(account);
  const guestBefore = cloneFixture(guest);
  entry.mergeEntryStates(account, guest, {
    audience: 'returning', classification: 'returning-light',
  });
  assert.deepEqual(account, accountBefore);
  assert.deepEqual(guest, guestBefore);
});

test('the pure contract contains no storage, Firestore, progress, reward, or theme mutation path', () => {
  assert.doesNotMatch(source, /\blocalStorage\b|\bsessionStorage\b/);
  assert.doesNotMatch(source, /\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/);
  assert.doesNotMatch(source, /\b(?:awardXP|claimXP|updateGateProgress|startJourney|setTheme)\s*\(/);
});
