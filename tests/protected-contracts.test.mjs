import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hash = (value) => createHash('sha256')
  .update(String(value).replace(/\r\n?/g, '\n'))
  .digest('hex')
  .toUpperCase();
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const wholeFileHashes = {
  'js/xp.js': '8058503B37BF437C3F2B9AA892A8EF6BE1601280F33DD60D6BFCB4B622FFB2A3',
  'js/srs.js': 'D38CDB594FEFB9C6B7F7ECC4144710DC28D72652A74E55E7C616E4E1F904152E',
  'js/srs-transitions.js': '20BE678A9E6F3A1FE089AC474EEBEBC5D27CAC974CF493D03D88F2428D9A2703',
  'js/quiz-core.js': 'C46FFDB1F580B42738765F5AF7FADFCA060DDD342628EF121AC77E62BE364A1D',
  'js/quiz-runtime.js': '85B7078FC240628C6250237308D24746D041FCACC186D3F15C297E37E997CC12',
};

for (const [path, expected] of Object.entries(wholeFileHashes)) {
  assert.equal(hash(read(path)), expected, `${path} changed despite being protected`);
}

const quiz = read('js/quiz.js');
const protectedQuizMarker = 'function getQuizDueInfo';
assert.ok(quiz.includes(protectedQuizMarker), 'quiz protected marker is missing');
assert.equal(
  hash(quiz.slice(quiz.indexOf(protectedQuizMarker))),
  '726C5EBF4CB4DC4B83E1F86E17D46294587A812A13DE0615321263DFAEDA5E9F',
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
console.log('Protected XP, SRS, and cloud-XP contracts are unchanged; approved Quiz core/runtime baselines match.');
