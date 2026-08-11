import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [quiz, lifecycle, quizCore, transitions] = await Promise.all([
  readFile(new URL('../js/quiz.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/word-lifecycle.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz-core.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/srs-transitions.js', import.meta.url), 'utf8'),
]);

test('picker and start resolve through the same mode-aware candidate snapshot', () => {
  assert.match(quiz, /function resolveQuizSourceSnapshot/);
  assert.match(quiz, /quizCore\.resolveQuizCandidates/);
  assert.match(quiz, /const total = getQuizSourceWords\('personal', \{ mode: selectedQuizMode \}\)\.length/);
  assert.match(quiz, /const resolvedSourceWords = explicitWords \|\| getQuizSourceWords\(currentQuizSource, \{ mode \}\)/);
  assert.match(quiz, /getQuizStartEligibility\(total, quizQuestionCount, \{ mode: selectedQuizMode \}\)/);
});

test('hiddenFromDictionary is not a quiz exclusion', () => {
  const sourceBlock = quiz.slice(quiz.indexOf('function resolveQuizSourceSnapshot'), quiz.indexOf('function getQuizSourceWords'));
  assert.doesNotMatch(sourceBlock, /hiddenFromDictionary\s*!==\s*true/);
  assert.match(lifecycle, /function isEligibleForPersonalDictionaryQuiz[\s\S]*return hasLearnableContent/);
});

test('verified commit uses frozen session words and includes Matching', async () => {
  const runtime = await readFile(new URL('../js/quiz-runtime.js', import.meta.url), 'utf8');
  const commitBlock = runtime.slice(runtime.indexOf('async function commitVerifiedQuizResults'), runtime.indexOf('function markRemember'));
  assert.match(commitBlock, /Array\.isArray\(activeQuizSession\.words\)/);
  assert.doesNotMatch(commitBlock, /getQuizSourceWords\(/);
  assert.match(quiz, /mode === 'timeAttack' \|\| mode === 'scramble' \|\| mode === 'matching'/);
  assert.match(quiz, /sourceType: sourceInfo\.sourceType/);
  assert.match(quiz, /sourceId: sourceInfo\.sourceId/);
  assert.match(quiz, /candidateCount: resolvedSourceWords\.length/);
  assert.match(quiz, /selectedWordIds: selectedWords\.map/);
  assert.match(quiz, /selectedWordKeys: selectedWords\.map/);
});

test('selection reads the existing trusted SRS exposure count without a new metadata store', () => {
  assert.match(quizCore, /state\.quiz_seen_count \?\? word\?\.quiz_seen_count/);
  assert.match(transitions, /state\.quiz_seen_count = Math\.max\(0, Number\(state\.quiz_seen_count\) \|\| 0\) \+ 1/);
  assert.doesNotMatch(quizCore, /localStorage|sessionStorage|indexedDB/);
});

test('account private-world loading binds apply/error/cache state to owner and source generation', () => {
  const loader = quiz.slice(quiz.indexOf('async function ensureQuizSourceReady'), quiz.indexOf('window.resolveQuizSourceSnapshot'));
  assert.match(loader, /quizCore\.isSourceResponseCurrent/);
  assert.ok(loader.indexOf('quizCore.isSourceResponseCurrent') < loader.indexOf('writeCustomWorldWordsToStorage'));
  assert.match(loader, /getQuizSourceOwnerId\(\) === ownerId/);
  assert.match(loader, /cachedSnapshot\.candidateCount > 0/);
  assert.match(quiz, /quizSourceRequestCoordinator\.invalidate\(\)/);
});
