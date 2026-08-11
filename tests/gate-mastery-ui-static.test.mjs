import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [worlds, quiz, runtime, journeyCloud, rules, journey, srs, globalCloud, functionsIndex, indexes] = await Promise.all([
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/srs.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8'),
]);

test('Gate detail exposes the three required clear/mastery presentations', () => {
  assert.match(worlds, /مكتملة — بقي \$\{gapCount\} كلمات لإتقانها/);
  assert.match(worlds, /راجع الكلمات المتبقية/);
  assert.match(worlds, /fa-solid fa-crown/);
  assert.match(worlds, /mastered: 'متقنة'/);
  assert.match(worlds, /مكتملة باختبار المستوى — الكلمات غير مضافة/);
});

test('gap review starts a verified quiz from only the requested word keys', () => {
  const block = quiz.slice(
    quiz.indexOf('function gateGapReviewWords'),
    quiz.indexOf('function updateCard')
  );
  assert.match(block, /wanted\.has\(wordKey\)/);
  assert.match(block, /isEligibleForSrsReview/);
  assert.match(block, /mastery_status !== 'Mastered'/);
  assert.match(block, /startActualQuiz\('scramble'/);
  assert.match(block, /words: reviewWords/);
  assert.match(block, /gate-gap:/);
  assert.doesNotMatch(block, /activeGateId|unlockedGateIds|updateGateProgress/);
  assert.match(runtime, /sessionSource\.startsWith\('gate-gap:'\)/);
  assert.match(runtime, /Array\.isArray\(activeQuizSession\.words\)/);
});

test('refresh and multi-device updates are read-only in the Gate renderer', () => {
  assert.match(journeyCloud, /function subscribeGateProgress/);
  assert.match(worlds, /lootlingua:word-mastery-snapshot/);
  assert.match(worlds, /refreshPublishedGateMasteryView/);
  assert.match(worlds, /route\?\.key === 'rank'/);
  const renderBlock = worlds.slice(
    worlds.indexOf('function makePublishedGateJourneyPanel'),
    worlds.indexOf('function appendPublishedHeader')
  );
  assert.doesNotMatch(renderBlock, /setDoc|updateDoc|runTransaction/);
});

test('client Firestore rules contain no direct masteryComplete update escape hatch', () => {
  assert.doesNotMatch(rules, /validGateMasteryFlagUpdate/);
  assert.match(rules, /after\.get\('masteryComplete', false\) == before\.get\('masteryComplete', false\)/);
  assert.match(rules, /request\.resource\.data\.get\('masteryComplete', false\) ==[\s\S]*resource\.data\.get\('masteryComplete', false\)/);
});

test('Crown is derived from permanent SRS history without a Functions projection', () => {
  assert.match(journey, /state\?\.mastered_once === true/);
  assert.match(journey, /deriveGateCrownAchievement/);
  assert.doesNotMatch(journey, /progress\?\.masteryComplete === true/);
  assert.doesNotMatch(functionsIndex, /onDocumentWritten|gate-mastery|projectGateMastery/);
  assert.deepEqual(JSON.parse(indexes).fieldOverrides, []);
});

test('multi-device SRS merging cannot clear mastered_once with a stale snapshot', () => {
  assert.match(srs, /previous\.mastered_once \|\| next\.mastered_once/);
  assert.match(srs, /window\.getSharedWordMasteryByKey/);
  assert.match(srs, /lootlingua:word-mastery-snapshot/);
  assert.match(globalCloud, /if \(cloudState\.mastered_once !== true/);
  assert.match(globalCloud, /delete cloudState\.mastered_once/);
});
