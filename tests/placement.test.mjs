import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [schemaSource, placementSource, cloudSource, worldsSource, rulesSource] =
  await Promise.all([
    readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/placement.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
    readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  ]);

const windowObject = {};
const context = vm.createContext({
  window: windowObject,
  globalThis: windowObject,
  encodeURIComponent,
  Error,
  RangeError,
  Map,
  Set,
  Object,
  String,
  Number,
  Array,
  Boolean,
  Math,
});
vm.runInContext(schemaSource, context);
vm.runInContext(placementSource, context);
const placement = windowObject.LootLinguaPlacement;
const schema = windowObject.LootLinguaContentSchema;

function words(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    contentWordId: `word-${index + 1}`,
    word: `Word ${index + 1}`,
    wordKey: `word_${index + 1}`,
    translation: `المعنى ${index + 1}`,
    status: 'published',
  }));
}

function session(overrides = {}) {
  const gateWords = words(10);
  return placement.createSessionSeed({
    assessmentId: placement.assessmentId('rank-a', 'gate-a'),
    worldId: 'world-a',
    rankId: 'rank-a',
    gateId: 'gate-a',
    words: gateWords,
    passThreshold: 0.75,
    ...overrides,
  });
}

test('Placement resolves the real gate threshold and rounds required answers upward', () => {
  assert.equal(placement.resolvePassThreshold({}, schema), 0.75);
  assert.equal(
    placement.resolvePassThreshold({ entryAssessmentPassRatio: 0.8 }, schema),
    0.8
  );
  assert.equal(placement.requiredCorrectAnswers(10, 0.75), 8);
  assert.equal(placement.placementPassed(7, 10, 0.75), false);
  assert.equal(placement.placementPassed(8, 10, 0.75), true);
});

test('a session contains every unique gate word and no reward fields', () => {
  const value = session();
  assert.equal(value.totalQuestions, 10);
  assert.equal(new Set(value.orderedContentWordIds).size, 10);
  assert.equal(value.source, 'placement');
  assert.equal(value.suppressRewards, true);
  for (const field of ['xp', 'lockedXP', 'streak', 'quest', 'chest']) {
    assert.equal(field in value, false);
  }
});

test('questions use same-gate distractors, expose at most four choices, and never repeat', () => {
  const gateWords = words(6);
  let value = placement.createSessionSeed({
    assessmentId: 'assessment-a',
    worldId: 'world-a',
    rankId: 'rank-a',
    gateId: 'gate-a',
    words: gateWords,
    passThreshold: 0.75,
  });
  const seen = new Set();
  while (value.currentQuestionIndex < value.totalQuestions) {
    const question = placement.buildQuestion(gateWords, value);
    assert.equal(question.options.length, 4);
    assert.equal(question.options.some((item) => item.contentWordId === question.contentWordId), true);
    assert.equal(seen.has(question.contentWordId), false);
    seen.add(question.contentWordId);
    value = placement.answerSession(value, question.contentWordId);
  }
  assert.equal(seen.size, gateWords.length);
  assert.equal(value.correctCount, gateWords.length);
});

test('answers are append-only, fixed after submission, and do not alter word mastery', () => {
  const gateWords = words(4);
  const initial = placement.createSessionSeed({
    assessmentId: 'assessment-b',
    worldId: 'world-a',
    rankId: 'rank-a',
    gateId: 'gate-a',
    words: gateWords,
    passThreshold: 0.75,
  });
  const first = placement.buildQuestion(gateWords, initial);
  const wrong = first.options.find((option) => option.contentWordId !== first.contentWordId);
  const answered = placement.answerSession(initial, wrong.contentWordId);
  assert.equal(answered.currentQuestionIndex, 1);
  assert.equal(answered.answers.length, 1);
  assert.equal(answered.answers[0].correct, false);
  assert.equal(answered.answers[0].wordKey, 'word_1');
  assert.equal(Number.isFinite(answered.answers[0].seenAt), true);
  assert.equal('mastery_status' in answered, false);
  assert.equal(initial.answers.length, 0);
});

test('Content Word mapping is complete and enrichment never touches SRS or user history', () => {
  const start = cloudSource.indexOf('const USER_WORD_EDUCATIONAL_FIELDS');
  const end = cloudSource.indexOf('function canonicalWordPayload', start);
  const mappingSource = cloudSource.slice(start, end);
  const mappingContext = vm.createContext({ Object, String, Array, Boolean });
  new vm.Script(
    `${mappingSource}; this.mapWord = contentWordToUserWordFields; ` +
    'this.missingPatch = missingEducationalWordPatch;'
  ).runInContext(mappingContext);
  const sourceWord = {
    word: 'Signal',
    translation: 'إشارة',
    definition: 'A sign that carries information.',
    definition_ar: 'علامة تحمل معلومات.',
    example: 'The signal is clear.',
    exampleTranslation: 'الإشارة واضحة.',
    partOfSpeech: 'noun',
    category: 'Communication',
    level: 'B1',
    tags: ['radio'],
    synonyms: ['sign'],
    pronunciation: '/ˈsɪɡ.nəl/',
    notes: 'Common noun',
  };
  const mapped = mappingContext.mapWord(sourceWord, {
    normalizedWord: 'signal',
    wordKey: 'signal',
  });
  for (const field of [
    'word', 'normalizedWord', 'wordKey', 'translation', 'definition',
    'definition_ar', 'example', 'exampleTranslation', 'partOfSpeech',
    'category', 'level', 'tags', 'synonyms', 'pronunciation', 'notes',
  ]) {
    assert.equal(field in mapped, true, field);
  }
  const existing = {
    word: 'Signal',
    meaning: 'تعديل المستخدم',
    category: 'Custom',
    mastery_status: 'Mastered',
    mastery_streak: 3,
    quiz_seen_count: 44,
  };
  const patch = mappingContext.missingPatch(existing, {
    ...mapped,
    meaning: mapped.translation,
  });
  assert.equal('meaning' in patch, false);
  assert.equal('category' in patch, false);
  assert.equal('mastery_status' in patch, false);
  assert.equal('mastery_streak' in patch, false);
  assert.equal('quiz_seen_count' in patch, false);
  assert.equal(patch.definition, sourceWord.definition);
});

test('successful Placement stops at an explicit decision and final retry never re-asks the last question', () => {
  const answerStart = cloudSource.indexOf('async function answerPlacementQuestion');
  const answerEnd = cloudSource.indexOf('async function continuePlacement', answerStart);
  const answerBlock = cloudSource.slice(answerStart, answerEnd);
  const finalizeStart = cloudSource.indexOf('async function finalizePlacementResult');
  const finalizeEnd = cloudSource.indexOf('async function answerPlacementQuestion', finalizeStart);
  const finalizeBlock = cloudSource.slice(finalizeStart, finalizeEnd);
  assert.match(answerBlock, /status: 'submitting'/);
  assert.match(answerBlock, /finalizePlacementResult/);
  assert.doesNotMatch(answerBlock, /preparePlacementGate\(/);
  assert.doesNotMatch(finalizeBlock, /runGateWordOperation|preparePlacementGate|answerSession/);
  assert.match(
    cloudSource,
    /!\['active', 'submitting', 'completed'\]\.includes\(session\.status\)/
  );
  assert.match(
    finalizeBlock,
    /transaction\.get\(targetJourneyRef\),\s*transaction\.get\(sessionRef\)/
  );
  assert.doesNotMatch(
    finalizeBlock,
    /transaction\.get\(targetJourneyRef\),\s*transaction\.get\(targetJourneyRef\)/
  );
  assert.match(worldsSource, /اختبر البوابة التالية/);
  assert.match(worldsSource, /توقف هنا وابدأ رحلتك/);
  assert.match(worldsSource, /continuePublishedPlacement/);
  assert.match(worldsSource, /retryPublishedPlacementFinalization/);
  assert.match(
    worldsSource,
    /\['submitting', 'completed'\]\.includes\(bundle\?\.session\?\.status\)/
  );
  assert.match(cloudSource, /save-placement-gate-result/);
  assert.match(cloudSource, /complete-placement-session/);
  assert.match(cloudSource, /advance-placement-journey/);
  assert.doesNotMatch(worldsSource, /renderPublishedPlacementTransition/);
});

test('answer feedback and final saving are separate, short, and reduced-motion aware', () => {
  assert.match(worldsSource, /reduceMotion \? 120 : 820/);
  assert.match(worldsSource, /جارٍ حفظ نتيجتك وكلمات البوابة/);
  assert.match(worldsSource, /renderPublishedPlacementSaving\(bundle\)/);
  assert.match(worldsSource, /تعذر حفظ نتيجة البوابة/);
  assert.match(worldsSource, /حُفظت نتيجة البوابة، لكن تعذر إتمام الجلسة/);
});

test('Placement receipt and answer metadata identify exact assessment words without rewards', () => {
  const value = session();
  assert.deepEqual(Array.from(value.orderedWordKeys), words(10).map((item) => item.wordKey));
  for (const field of [
    'answersComplete',
    'wordsLinked',
    'gateProgressSaved',
    'placementCompleted',
    'nextGateUnlocked',
    'completionStep',
  ]) {
    assert.equal(field in value, true, field);
  }
  assert.match(cloudSource, /placementAssessmentId: id/);
  assert.match(cloudSource, /placementSeenAt: serverTimestamp\(\)/);
  assert.doesNotMatch(cloudSource, /awardXP|lockedXP|markDailyQuest|recordChest/);
});

test('cloud flow loads every gate word centrally and resumes one active assessment', () => {
  assert.match(cloudSource, /runGateWordOperation\(worldId, rankId, gateId/);
  assert.match(cloudSource, /onlyNew: false/);
  assert.match(cloudSource, /activePlacementAssessmentId/);
  assert.match(cloudSource, /function resumePlacement/);
  assert.match(cloudSource, /placement\/session-active/);
  assert.match(cloudSource, /status: didPass \? 'cleared' : 'learning'/);
  assert.match(cloudSource, /clearedBy: 'placement'/);
});

test('Level Placement replaces the new entry UI while legacy Gate Placement remains resumable', () => {
  assert.doesNotMatch(worldsSource, /'ابدأ اختبار تحديد المستوى'/);
  assert.match(worldsSource, /متابعة اختبار المستوى/);
  assert.match(worldsSource, /لديك اختبار مستوى غير مكتمل/);
  assert.match(worldsSource, /لديك اختبار تحديد غير مكتمل/);
  assert.match(worldsSource, /maybeRenderPublishedLevelPlacementResume/);
  assert.match(worldsSource, /maybeRenderPublishedPlacementResume/);
  assert.match(worldsSource, /اختَر|اختر المعنى الصحيح/);
  assert.doesNotMatch(worldsSource, /startQuiz[\s\S]*published-placement/);
});

test('Rules structurally bind owner sessions and placement-cleared gates without XP fields', () => {
  assert.match(rulesSource, /match \/placementSessions\/\{assessmentId\}/);
  assert.match(rulesSource, /validPlacementAnswerAppend/);
  assert.match(rulesSource, /correctCount >= session\.requiredCorrect/);
  assert.match(rulesSource, /cleared\.clearedBy == 'placement'/);
  assert.match(rulesSource, /suppressRewards == true/);
  assert.match(
    rulesSource,
    /data\.placementScore \* data\.placementTotal == data\.placementCorrect/
  );
  assert.match(rulesSource, /validPlacementGateScore\(after\)/);
  assert.doesNotMatch(rulesSource, /placementScore ==[\s\S]{0,80}placementCorrect \/ placementTotal/);
  assert.doesNotMatch(
    rulesSource.slice(
      rulesSource.indexOf('function validPlacementSession('),
      rulesSource.indexOf('function journeyAllowsGate(')
    ),
    /userXP|lockedXP|dailyStreak/
  );
});
