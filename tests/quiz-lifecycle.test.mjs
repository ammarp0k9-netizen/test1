import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [quiz, lifecycle] = await Promise.all([
  readFile(new URL('../js/quiz.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/word-lifecycle.js', import.meta.url), 'utf8'),
]);

test('personal quiz count and every quiz mode use the lifecycle-eligible pool', () => {
  assert.match(quiz, /function getQuizSourceWords/);
  assert.match(quiz, /isEligibleForPersonalDictionaryQuiz/);
  assert.match(quiz, /const total = getQuizSourceWords\('personal'\)\.length/);
  assert.match(quiz, /warnIfTooFewQuizSourceWords\(currentQuizSource, getQuizSourceWords\(currentQuizSource\)\.length\)/);
});

test('hiddenFromDictionary is not a quiz exclusion', () => {
  const sourceBlock = quiz.slice(
    quiz.indexOf('function getQuizSourceWords'),
    quiz.indexOf('function getQuizSourceParts')
  );
  assert.doesNotMatch(sourceBlock, /hiddenFromDictionary\s*!==\s*true/);
  assert.match(lifecycle, /function isEligibleForPersonalDictionaryQuiz[\s\S]*return hasLearnableContent/);
});
