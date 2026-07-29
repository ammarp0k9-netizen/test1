import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hash = (value) => createHash('sha256')
  .update(String(value).replace(/\r\n?/g, '\n'))
  .digest('hex')
  .toUpperCase();
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const wholeFileHashes = {
  'js/xp.js': 'B460405D648AC1C26C657C7C7C11A74C9E29E8BE48F5AD95FD3D85E45CC20F26',
  'js/srs.js': '60FB5D1A9B126F7C1E321C598496AC555385E2B899BE25547279566FE39D2DAA',
  'js/srs-transitions.js': '20BE678A9E6F3A1FE089AC474EEBEBC5D27CAC974CF493D03D88F2428D9A2703',
  'js/quiz-runtime.js': '1CB4A0AB68141403AEEEF3D1683FBCD7610DBAB9E3A8ED04D948A340AE20C8FA',
};

for (const [path, expected] of Object.entries(wholeFileHashes)) {
  assert.equal(hash(read(path)), expected, `${path} changed despite being protected`);
}

const quiz = read('js/quiz.js');
const protectedQuizMarker = 'function getQuizDueInfo';
assert.ok(quiz.includes(protectedQuizMarker), 'quiz protected marker is missing');
assert.equal(
  hash(quiz.slice(quiz.indexOf(protectedQuizMarker))),
  '46AE03B123886EDE033B77A9B1483141068DF528187B8716ADE260EB5488F210',
  'Quiz due/backlog/penalty/quota/deck/runtime source changed'
);

const cloud = read('js/cloud.js');
const xpStart = cloud.indexOf('window.claimXPEventInCloud');
const xpEnd = cloud.indexOf('window.listenCustomWorldWordsFromCloud');
assert.ok(xpStart >= 0 && xpEnd > xpStart, 'cloud XP transaction markers are missing');
assert.equal(
  hash(cloud.slice(xpStart, xpEnd)),
  '5EA184387BCA1AD02FD088E7601DA609002116FD051556863A1597E9793A5C1C',
  'Cloud XP transaction changed'
);

assert.match(read('js/xp.js'), /newToLearning:\s*2,[\s\S]*learningToReviewing:\s*4,[\s\S]*reviewingToMastered:\s*8,[\s\S]*remastered:\s*3,/);
console.log('Protected XP, SRS, quota, exposure, deck, Resume, and cloud-XP contracts are unchanged.');
