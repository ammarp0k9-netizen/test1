import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [schemaSource, placementSource, cloudSource, worldsSource, adminSource] = await Promise.all([
  readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/level-placement.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
]);
const windowObject = {};
const context = vm.createContext({
  window: windowObject,
  globalThis: windowObject,
  Error,
  Map,
  Set,
  Object,
  String,
  Number,
  Array,
  Boolean,
  Math,
  Date,
});
vm.runInContext(schemaSource, context);
vm.runInContext(placementSource, context);
const placement = windowObject.LootLinguaLevelPlacement;

function word(rankIndex, gateIndex, wordIndex, overrides = {}) {
  const token = `${rankIndex}-${gateIndex}-${wordIndex}`;
  return {
    contentWordId: `word-${token}`,
    wordKey: `key-${token}`,
    word: `Word ${token}`,
    translation: `Meaning ${token}`,
    status: 'published',
    order: wordIndex,
    ...overrides,
  };
}

function rankBundle(rankIndex, options = {}) {
  const gates = options.gates || 2;
  const wordsPerGate = options.wordsPerGate || 5;
  return {
    rank: {
      worldId: 'world-a',
      rankId: `rank-${rankIndex}`,
      title: `Rank ${rankIndex}`,
      status: 'published',
      cefrLevel: options.cefrLevel || 'A1',
      order: options.order ?? rankIndex,
    },
    gates: Array.from({ length: gates }, (_, gateOffset) => {
      const gateIndex = gateOffset + 1;
      return {
        gate: {
          worldId: 'world-a',
          rankId: `rank-${rankIndex}`,
          gateId: `gate-${rankIndex}-${gateIndex}`,
          status: 'published',
          order: gateIndex,
          entryAssessmentPassRatio: options.passThreshold ?? 0.75,
        },
        words: Array.from({ length: wordsPerGate }, (_, wordOffset) => (
          word(rankIndex, gateIndex, wordOffset + 1)
        )),
      };
    }),
  };
}

function sample(rankCount = 3, seed = 'fixed-seed') {
  return placement.buildLevelSample({
    cefrLevel: 'A1',
    assessmentSeed: seed,
    rankBundles: Array.from({ length: rankCount }, (_, index) => rankBundle(index + 1)),
  });
}

function sessionFromSample(value = sample()) {
  return placement.createSessionSeed({
    assessmentId: 'assessment-a',
    worldId: 'world-a',
    sample: value,
  });
}

function answerRankQuestions(session, correctByRank) {
  const answers = session.orderedQuestionIds.map((questionId) => {
    const selectedWord = session.selectedWords.find((item) => item.questionId === questionId);
    const remaining = correctByRank.get(selectedWord.rankId) || 0;
    const correct = remaining > 0;
    if (correct) correctByRank.set(selectedWord.rankId, remaining - 1);
    return {
      questionId,
      rankId: selectedWord.rankId,
      gateId: selectedWord.gateId,
      contentWordId: selectedWord.contentWordId,
      wordKey: selectedWord.wordKey,
      selectedQuestionId: correct ? questionId : 'wrong-option',
      correct,
    };
  });
  return {
    ...session,
    answers,
    correctCount: answers.filter((answer) => answer.correct).length,
    currentQuestionIndex: answers.length,
  };
}

test('Level Placement exposes one central bounded sampling configuration', () => {
  assert.deepEqual(
    { ...placement.LEVEL_PLACEMENT_CONFIG },
    {
      minimumQuestionsPerRank: 3,
      preferredQuestionsPerRank: 4,
      maximumTotalQuestions: 24,
      adaptiveQuestionsPerRank: 2,
      maximumAdaptiveRounds: 1,
    }
  );
});

test('the sample is deterministic, bounded, and represents every rank when possible', () => {
  const first = sample(6);
  const second = sample(6);
  assert.deepEqual(first.orderedQuestionIds, second.orderedQuestionIds);
  assert.ok(first.orderedQuestionIds.length <= 24);
  const represented = new Set(first.selectedWords
    .filter((item) => first.orderedQuestionIds.includes(item.questionId))
    .map((item) => item.rankId));
  assert.equal(represented.size, 6);
});

test('the v2 session preserves sampled rank versions required by Firestore Rules', () => {
  const value = sample(2);
  const session = sessionFromSample(value);
  assert.deepEqual({ ...session.rankVersions }, { ...value.rankVersions });
  assert.deepEqual(Object.keys(session.rankVersions).sort(), ['rank-1', 'rank-2']);
});

test('session snapshots preserve normalized identity and legacy snapshots are upgraded safely', () => {
  const value = sample(1);
  const current = value.selectedWords[0];
  assert.equal(typeof current.normalizedWord, 'string');
  assert.ok(current.normalizedWord);
  assert.equal(current.wordKey, placement.normalizeSavedWordSnapshot(current).wordKey);

  const { normalizedWord, ...legacy } = current;
  const upgraded = placement.normalizeSavedWordSnapshot(legacy);
  assert.equal(upgraded.normalizedWord, normalizedWord);
  assert.equal(upgraded.wordKey, current.wordKey);
  assert.throws(
    () => placement.normalizeSavedWordSnapshot({ ...legacy, wordKey: 'forged-key' }),
    (error) => error?.code === 'level-placement/invalid-word-snapshot'
  );
});

test('Level Placement question construction ignores personal and mixed word pools', () => {
  const published = rankBundle(1);
  const result = placement.buildLevelSample({
    cefrLevel: 'A1',
    assessmentSeed: 'published-only-contract',
    rankBundles: [published],
    personalWords: [{
      id: 'personal-only',
      word: 'Personal',
      translation: 'شخصية',
      wordKey: 'personal-only',
      status: 'published',
    }],
  });
  assert.equal(result.selectedWords.every((item) => item.contentWordId.startsWith('word-')), true);
  assert.equal(result.selectedWords.some((item) => item.contentWordId === 'personal-only'), false);
});

test('sampling distributes a rank across gates and never repeats wordKey', () => {
  const result = sample(2);
  const primary = result.selectedWords.filter((item) => result.orderedQuestionIds.includes(item.questionId));
  const firstRank = primary.filter((item) => item.rankId === 'rank-1');
  assert.ok(new Set(firstRank.map((item) => item.gateId)).size > 1);
  assert.equal(new Set(result.selectedWords.map((item) => item.wordKey)).size, result.selectedWords.length);
});

test('adaptive reserves cannot consume the only representation left for a later rank', () => {
  const first = rankBundle(1, { gates: 1, wordsPerGate: 6 });
  const second = rankBundle(2, { gates: 1, wordsPerGate: 6 });
  first.gates[0].words.forEach((item, index) => { item.wordKey = `shared-${index}`; });
  second.gates[0].words.forEach((item, index) => { item.wordKey = `shared-${index}`; });
  const result = placement.buildLevelSample({
    cefrLevel: 'A1',
    assessmentSeed: 'rank-priority',
    rankBundles: [first, second],
  });
  const primaryIds = new Set(result.orderedQuestionIds);
  assert.equal(
    result.selectedWords.some((item) => primaryIds.has(item.questionId) && item.rankId === 'rank-2'),
    true
  );
});

test('draft, archived, and untranslated words are excluded', () => {
  const bundle = rankBundle(1);
  bundle.gates[0].words.push(
    word(1, 1, 90, { status: 'draft' }),
    word(1, 1, 91, { status: 'archived' }),
    word(1, 1, 92, { translation: '' })
  );
  const result = placement.buildLevelSample({
    cefrLevel: 'A1',
    assessmentSeed: 'filter-seed',
    rankBundles: [bundle],
  });
  assert.equal(result.selectedWords.some((item) => ['word-1-1-90', 'word-1-1-91', 'word-1-1-92'].includes(item.contentWordId)), false);
});

test('refresh reconstruction keeps seed, selected words, and current question', () => {
  const original = sessionFromSample();
  const answered = placement.answerSession(original, original.orderedQuestionIds[0]);
  const restored = JSON.parse(JSON.stringify(answered));
  assert.equal(placement.buildQuestion(restored).questionId, restored.orderedQuestionIds[1]);
  assert.equal(restored.assessmentSeed, original.assessmentSeed);
  assert.deepEqual(
    Array.from(restored.selectedContentWordIds),
    Array.from(original.selectedContentWordIds)
  );
});

test('questions are English to Arabic choices and answers are append-only', () => {
  const session = sessionFromSample();
  const question = placement.buildQuestion(session);
  assert.equal(question.prompt.startsWith('Word '), true);
  assert.ok(question.options.length <= 4 && question.options.length >= 2);
  assert.equal(Object.hasOwn(question, 'correctQuestionId'), false);
  const answered = placement.answerSession(session, question.questionId);
  assert.equal(session.answers.length, 0);
  assert.equal(answered.answers.length, 1);
  assert.equal(answered.answers[0].correct, true);
});

test('75 percent of ten requires eight correct', () => {
  const base = sessionFromSample(sample(1));
  const selectedWords = Array.from({ length: 10 }, (_, index) => ({
    ...base.selectedWords[index % base.selectedWords.length],
    questionId: `q-${index}`,
    contentWordId: `w-${index}`,
    wordKey: `k-${index}`,
    rankId: 'rank-1',
    passThreshold: 0.75,
  }));
  const complete = {
    ...base,
    selectedWords,
    orderedQuestionIds: selectedWords.map((item) => item.questionId),
    answers: selectedWords.map((item, index) => ({
      questionId: item.questionId,
      rankId: 'rank-1',
      correct: index < 7,
    })),
    rankCoverage: { 'rank-1': { weak: false } },
  };
  const failed = placement.analyzeSession(complete, { finalRound: true });
  assert.equal(failed.perRankStats['rank-1'].requiredCorrect, 8);
  assert.equal(failed.perRankStats['rank-1'].status, 'failed');
  complete.answers[7].correct = true;
  const passed = placement.analyzeSession(complete, { finalRound: true });
  assert.equal(passed.perRankStats['rank-1'].status, 'passed');
});

test('only the longest contiguous passed rank prefix is opened', () => {
  const base = sessionFromSample();
  const completed = answerRankQuestions(base, new Map([
    ['rank-1', 4],
    ['rank-2', 0],
    ['rank-3', 4],
  ]));
  const result = placement.analyzeSession(completed, { finalRound: true });
  assert.deepEqual(Array.from(result.passedRankIds), ['rank-1']);
  assert.equal(result.passedPrefixLength, 1);
  assert.equal(result.recommendedStartRankId, 'rank-2');
  assert.equal(result.passedLevel, false);
});

test('an ambiguous frontier gets at most one adaptive round with no repeated question', () => {
  const base = sessionFromSample(sample(1));
  const initialQuestionCount = base.orderedQuestionIds.length;
  const completed = answerRankQuestions(base, new Map([['rank-1', 2]]));
  const adaptive = placement.finalizeRound(completed);
  assert.equal(adaptive.adaptiveRound, 1);
  assert.ok(adaptive.orderedQuestionIds.length > initialQuestionCount);
  assert.ok(adaptive.orderedQuestionIds.length <= 24);
  assert.equal(new Set(adaptive.orderedQuestionIds).size, adaptive.orderedQuestionIds.length);
  const finalInput = answerRankQuestions(adaptive, new Map([['rank-1', 0]]));
  const final = placement.finalizeRound(finalInput);
  assert.equal(final.status, 'awaiting-decision');
  assert.equal(final.adaptiveRound, 1);
});

test('next CEFR level stays locked until the previous level is passed', () => {
  assert.equal(placement.canStartLevelPlacement('A1', {}), true);
  assert.equal(placement.canStartLevelPlacement('A2', { passedCefrLevels: [] }), false);
  assert.equal(placement.canStartLevelPlacement('A2', { passedCefrLevels: ['A1'] }), true);
  assert.equal(placement.canStartLevelPlacement('C1', { passedCefrLevels: ['A1'] }), false);
  assert.equal(placement.canStartLevelPlacement('unclassified', {}), false);
});

test('word save choices select incorrect, all, or no assessment words', () => {
  const session = {
    answers: [
      { questionId: 'q-1', correct: true },
      { questionId: 'q-2', correct: false },
      { questionId: 'q-3', correct: false },
    ],
  };
  assert.deepEqual(Array.from(placement.wordIdsForSaveChoice(session, 'incorrect-only')), ['q-2', 'q-3']);
  assert.deepEqual(Array.from(placement.wordIdsForSaveChoice(session, 'all')), ['q-1', 'q-2', 'q-3']);
  assert.deepEqual(Array.from(placement.wordIdsForSaveChoice(session, 'none')), []);
});

test('cloud integration keeps assessment words opt-in and suppresses rewards', () => {
  assert.match(cloudSource, /sourceType: 'level-placement'/);
  assert.match(cloudSource, /suppressRewards: true/);
  assert.match(cloudSource, /saveLevelPlacementWords/);
  assert.doesNotMatch(cloudSource, /awardXP\([^)]*level-placement/);
  assert.doesNotMatch(cloudSource, /markDailyQuestFlag\([^)]*level-placement/);
});

test('published UI does not expose legacy Gate Placement as a new journey choice', () => {
  assert.match(worldsSource, /beginPublishedLevelPlacement/);
  assert.match(worldsSource, /legacy-active/);
  assert.doesNotMatch(worldsSource, /published-journey-choice[\s\S]{0,500}beginPublishedPlacement/);
});

test('Admin and Published UI use the central CEFR field and level grouping', () => {
  assert.match(adminSource, /name: 'cefrLevel'/);
  assert.match(adminSource, /المستوى اللغوي/);
  assert.match(adminSource, /غير مصنف/);
  assert.match(adminSource, /هذه الرتبة غير مصنفة بينما يحتوي العالم رتبًا بمستويات لغوية/);
  assert.match(worldsSource, /groupRanksByCefrLevel\(ranks\)/);
  assert.match(worldsSource, /CEFR_LEVELS\.forEach/);
  assert.match(worldsSource, /published-level-section/);
});

test('locked gate routes stop before creating or loading the word pager', () => {
  const routeBlock = worldsSource.slice(
    worldsSource.indexOf("const gateState = publishedGateJourneyState(", worldsSource.indexOf('async function loadPublishedRouteData')),
    worldsSource.indexOf("if (gateProgress?.status === 'learning'", worldsSource.indexOf('async function loadPublishedRouteData'))
  );
  assert.match(routeBlock, /if \(!canRevealPublishedGateWords/);
  assert.ok(routeBlock.indexOf('if (!canRevealPublishedGateWords') < routeBlock.indexOf('createPublishedWordPager'));
  assert.match(worldsSource, /تظهر كلمات هذه البوابة بعد بدء التعلم/);
});

test('partial levels navigate to the saved starting gate instead of starting another assessment', () => {
  assert.ok(
    worldsSource.indexOf("state === 'in-progress'") <
      worldsSource.indexOf("state === 'partially-passed'")
  );
  assert.match(
    worldsSource,
    /state === 'partially-passed'[\s\S]{0,240}openPublishedJourneyDestination\(world\.worldId, \{ resumePausedLevelPlacement: true \}\)/
  );
});

test('word-save retry keeps the original choice and retries pending IDs only', () => {
  assert.match(cloudSource, /const targetIds = previousPending\.length[\s\S]{0,120}\? previousPending/);
  assert.match(worldsSource, /savePublishedLevelPlacementWords\(bundle, session\.saveWordChoice\)/);
  assert.doesNotMatch(
    worldsSource,
    /إعادة حفظ الكلمات المتعثرة'[\s\S]{0,180}savePublishedLevelPlacementWords\(bundle, 'incorrect-only'\)/
  );
});

test('final-answer UI distinguishes a saved answer from a failed outcome application', () => {
  const answerBlock = worldsSource.slice(
    worldsSource.indexOf('async function submitPublishedLevelPlacementAnswer'),
    worldsSource.indexOf('function appendPublishedLevelPlacementStats')
  );
  assert.match(answerBlock, /error\?\.operation[\s\S]*apply-placement-outcome/);
  assert.match(answerBlock, /تم حفظ إجابتك الأخيرة، لكن تعذر تثبيت نتيجة الاختبار/);
  assert.match(answerBlock, /submitPublishedLevelPlacementAnswer\(bundle, question, selectedId\)/);
  assert.match(worldsSource, /save-level-placement-word-receipt/);
});

test('completed paused results resume into result application and keep save choices usable', () => {
  const continueBlock = cloudSource.slice(
    cloudSource.indexOf('async function continueLevelPlacement'),
    cloudSource.indexOf('async function levelPlacementUnlockedIds')
  );
  const finishBlock = cloudSource.slice(
    cloudSource.indexOf('async function finishLevelPlacement'),
    cloudSource.indexOf('async function abandonLevelPlacement')
  );
  const uiContinueBlock = worldsSource.slice(
    worldsSource.indexOf('async function continuePublishedLevelPlacement'),
    worldsSource.indexOf('function renderPublishedLevelPlacementResumePrompt')
  );
  assert.match(continueBlock, /pausedSession\?\.status === 'paused' && answersComplete/);
  assert.match(continueBlock, /return applyPlacementOutcome\(world, assessment\)/);
  assert.match(uiContinueBlock, /next\.session\.status === 'active'/);
  assert.match(uiContinueBlock, /renderPublishedLevelPlacementResult\(next\)/);
  assert.match(finishBlock, /session\.status === 'paused'/);
  assert.match(finishBlock, /journey\.levelPlacementStatus === 'paused'/);
  assert.match(finishBlock, /return;/);
  assert.match(cloudSource, /\['awaiting-decision', 'paused'\]\.includes\(session\.status\)/);
  assert.match(worldsSource, /showPublishedLevelPlacementResult/);
});

test('result application commits authoritative ledgers atomically and projects gate documents separately', () => {
  const applyBlock = cloudSource.slice(
    cloudSource.indexOf('async function applyPlacementOutcome'),
    cloudSource.indexOf('async function applyLevelPlacementResult')
  );
  assert.match(applyBlock, /planPlacementOutcome/);
  assert.match(applyBlock, /await runTransaction/);
  assert.match(applyBlock, /transaction\.update\(targetJourneyRef/);
  assert.match(applyBlock, /transaction\.update\(sessionRef/);
  assert.match(applyBlock, /transaction\.set\(pointerRef/);
  assert.match(applyBlock, /levelPlacementClearedGateIds/);
  assert.match(applyBlock, /reconcilePlacementOutcomeProgress/);
  assert.match(applyBlock, /progressReconciliationError/);
  assert.doesNotMatch(applyBlock, /const progressRefs/);
  assert.match(applyBlock, /resultClearedGateIds/);
  assert.match(applyBlock, /status: 'completed'/);
});

test('the result stop action is single-flight and navigates after the pause succeeds', () => {
  const stopBlock = worldsSource.slice(
    worldsSource.indexOf('async function stopPublishedLevelPlacement'),
    worldsSource.indexOf('function renderPublishedLevelPlacementExit')
  );
  assert.match(stopBlock, /if \(publishedContentState\.levelPlacementPending\) return null/);
  assert.match(stopBlock, /await pausePublishedLevelPlacement\(bundle\)/);
  assert.match(stopBlock, /window\.openPublishedWorld\(bundle\.journey\.worldId\)/);
  assert.match(stopBlock, /finally/);
});

test('save feedback covers every aggregate result and custom-world creation only passes context', () => {
  assert.match(worldsSource, /summary\?\.created/);
  assert.match(worldsSource, /summary\?\.sourceLinked/);
  assert.match(worldsSource, /summary\?\.alreadyLinked/);
  assert.match(worldsSource, /summary\?\.restored/);
  assert.match(worldsSource, /suggestedName: `ثغراتي في \$\{bundle\.session\.cefrLevel\}`/);
  assert.match(worldsSource, /levelPlacementAssessmentId: bundle\.session\.assessmentId/);
  const suggestionBlock = worldsSource.slice(
    worldsSource.indexOf('function openLevelPlacementWorldSuggestion'),
    worldsSource.indexOf('function updatePublishedGateProgressText')
  );
  assert.doesNotMatch(suggestionBlock, /saveWordsToTarget|writeCustomWorldWordsToStorage/);
});

test('only active or submitting Level Placement sessions auto-resume', () => {
  const journey = {
    worldId: 'world-a',
    activeLevelPlacementAssessmentId: 'assessment-a',
    levelPlacementStatus: 'active',
  };
  assert.equal(placement.shouldResumeLevelPlacement(null, journey), true);
  assert.equal(placement.shouldResumeLevelPlacement({
    assessmentId: 'assessment-a',
    worldId: 'world-a',
    status: 'active',
  }, journey), true);
  assert.equal(placement.shouldResumeLevelPlacement({
    assessmentId: 'assessment-a',
    worldId: 'world-a',
    status: 'submitting',
  }, { ...journey, levelPlacementStatus: 'submitting' }), true);
  ['awaiting-decision', 'paused', 'completed', 'abandoned'].forEach((status) => {
    assert.equal(placement.shouldResumeLevelPlacement({
      assessmentId: 'assessment-a',
      worldId: 'world-a',
      status,
    }, { ...journey, levelPlacementStatus: status }), false);
  });
});

test('continue later clears the active assessment and keeps the next-level CTA optional', () => {
  const finishBlock = cloudSource.slice(
    cloudSource.indexOf('async function finishLevelPlacement'),
    cloudSource.indexOf('async function abandonLevelPlacement')
  );
  assert.match(finishBlock, /activeLevelPlacementAssessmentId: ''/);
  assert.match(finishBlock, /activeLevelPlacementCefrLevel: ''/);
  assert.match(worldsSource, /shouldResumeLevelPlacement\(null, journey\)/);
  assert.match(worldsSource, /`متابعة الرحلة في \$\{session\.nextCefrLevel\}`/);
  const continueNextBlock = worldsSource.slice(
    worldsSource.indexOf('async function continueToNextPublishedLevel'),
    worldsSource.indexOf('async function pausePublishedLevelPlacement')
  );
  assert.match(continueNextBlock, /openPublishedJourneyDestination/);
  assert.doesNotMatch(continueNextBlock, /beginPublishedLevelPlacement/);
  assert.doesNotMatch(finishBlock, /startLevelPlacement/);
});

test('leave-and-save separates the committed pause from optional navigation', () => {
  const leaveBlock = worldsSource.slice(
    worldsSource.indexOf('window.confirmLevelPlacementExit'),
    worldsSource.indexOf('async function abandonPublishedLevelPlacement')
  );
  assert.match(leaveBlock, /await pausePublishedLevelPlacement\(bundle\)/);
  assert.match(leaveBlock, /hideModal\('levelPlacementExitModal'\)/);
  assert.match(leaveBlock, /operationUi\?\.complete/);
  assert.match(leaveBlock, /catch \(navigationError\)/);
  assert.ok(
    leaveBlock.indexOf('catch (navigationError)') >
      leaveBlock.indexOf("operationUi?.complete")
  );
});
