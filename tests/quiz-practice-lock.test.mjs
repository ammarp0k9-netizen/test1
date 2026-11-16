import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const quiz = readFileSync(new URL('../js/quiz.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (from, to) => quiz.slice(quiz.indexOf(from), quiz.indexOf(to, quiz.indexOf(from)));
const methods = [
  cut('function isVerifiedQuizMode(', 'const QUIZ_MODE_META'),
  cut('let quizReturnGate = null;', 'function getScrambleDirectionText('),
  cut('function openQuizModeSettings(', 'function setQuizQuestionCount('),
  cut('const personalQuizPracticeLockCopy', 'function refreshQuizAvailableCount('),
  cut('function refreshQuizSettingsSummary(', 'let dictionaryRunnerPreparing'),
  cut('let personalQuizPreparation', 'window.startGateQuiz'),
].join('\n');

function harness({ due = false, loadSource } = {}) {
  function node() {
    const attributes = new Map();
    return { hidden: false, disabled: false, textContent: '', style: { display: 'block' },
      setAttribute: (key, value) => attributes.set(key, value),
      getAttribute: key => attributes.get(key), removeAttribute: key => attributes.delete(key),
    };
  }
  const nodes = new Map();
  const presets = Array.from({ length: 4 }, node);
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const messages = [];
  const routes = [];
  const events = new Map();
  const reachedStart = new Error('passed the practice lock');
  const sandbox = vm.createContext({
    window: {
      LootLinguaNotificationSources: { personalQuizDueAt: () => due ? 1 : 0 },
      addEventListener: (name, handler) => events.set(name, handler),
      openPublishedGate: (...ids) => routes.push(ids),
    },
    activeQuizSession: null,
    document: { getElementById: element, querySelectorAll: () => presets },
    currentView: 'quiz', selectedQuizMode: 'flashcards', currentQuizSource: 'personal', quizQuestionCount: 'all',
    getQuizSourceOwnerId: () => 'guest', getQuizSourceResolutionStatus: () => 'ready',
    getQuizSourceLabel: () => 'القاموس الشخصي', getQuizSourceWords: () => [{ word: 'tea' }],
    quizCore: { getQuizStartEligibility: () => ({ allowed: true }) }, updateQuizMasteryOpportunity() {},
    stopTimeAttackTimer() {}, ensureQuizSourceReady: loadSource || (async () => ({ candidates: [] })),
    makeQuizSessionId() { throw reachedStart; }, showToast: message => messages.push(message),
  });
  vm.runInContext(methods, sandbox);
  return { sandbox, element, presets, messages, routes, events, reachedStart, setDue(value) { due = value; } };
}

test('the general menu keeps all six modes in the same two named categories', () => {
  const group = id => html.match(new RegExp('<section[^>]*aria-labelledby="' + id + '">([\\s\\S]*?)</section>'))[1];
  const progress = group('quizProgressModesTitle');
  const practice = group('quizPracticeModesTitle');
  assert.match(progress, /اختبارات التقدّم/);
  for (const label of ['الهروب من النسيان', 'الصندوق المشفّر', 'مطابقة الكلمات']) assert.ok(progress.includes(label));
  for (const label of ['العب وتدرّب', 'تدريب فقط', 'بطاقات الذاكرة', 'جري البوابات', 'Loot Bots']) assert.ok(practice.includes(label));
  assert.equal(progress.match(/class="quiz-mode-card /g).length + practice.match(/class="quiz-mode-card /g).length, 6);
});

test('the personal due date locks the games and every flashcard entry, then releases them together', async () => {
  const h = harness({ due: true });
  h.sandbox.refreshQuizPracticeAvailability();
  for (const id of ['flashcardsDictionary', 'runnerDictionary', 'lootBotsDictionary', 'quizStartButton']) assert.equal(h.element(id).disabled, true);
  assert.ok(h.presets.every(button => button.disabled));
  assert.equal(h.element('quizPracticeLock').hidden, false);
  assert.doesNotThrow(() => h.sandbox.openQuizModeSettings('flashcards'));
  for (const mode of ['flashcards', 'recent', 'old', 'starred', 'all']) assert.equal(await h.sandbox.startActualQuiz(mode), false);
  assert.match(h.messages[0], /الألعاب وبطاقات الذاكرة مقفلة/);
  h.setDue(false); h.sandbox.refreshQuizPracticeAvailability();
  assert.ok(h.presets.every(button => !button.disabled));
  assert.equal(h.element('flashcardsDictionary').disabled, false);
  assert.equal(h.element('quizPracticeLock').hidden, true);
  await assert.rejects(h.sandbox.startActualQuiz('recent'), error => error === h.reachedStart);
});

test('the flashcard launch rechecks the deadline after asynchronous word preparation', async () => {
  let finishRead;
  const h = harness({ loadSource: () => new Promise(resolve => { finishRead = resolve; }) });
  const launch = h.sandbox.startActualQuiz('recent');
  h.setDue(true);
  finishRead({});
  assert.equal(await launch, false);
});

test('returning after a gate quiz points to the exact gate and is cleared across navigation or auth changes', () => {
  const h = harness();
  const session = { journeyWorldId: 'w', journeyRankId: 'r', journeyGateId: 'g' };
  h.sandbox.rememberQuizGate(session);
  assert.equal(h.element('quizReturnToGate').hidden, false);
  assert.deepEqual(h.routes, []);
  h.sandbox.returnToQuizGate();
  assert.deepEqual(h.routes, [['w', 'r', 'g']]);
  h.events.get('lootlingua:auth-state')();
  assert.equal(h.element('quizReturnToGate').hidden, true);
  h.sandbox.returnToQuizGate();
  assert.equal(h.routes.length, 1);
});

test('gate cards use the gate lock, independently of the personal due date and trusted modes', async () => {
  const h = harness({ due: true });
  const gate = { journeyGateId: 'gate', words: [{ word: 'tea' }] };
  await assert.rejects(h.sandbox.startActualQuiz('flashcards', { ...gate, isGateFlashcardsLocked: () => false }), error => error === h.reachedStart);
  assert.equal(await h.sandbox.startActualQuiz('flashcards', { ...gate, isGateFlashcardsLocked: () => true }), false);
  await assert.rejects(h.sandbox.startActualQuiz('matching', { ...gate, isGateFlashcardsLocked: () => true }), error => error === h.reachedStart);
});
