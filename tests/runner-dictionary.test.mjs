import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const quiz = await readFile(new URL('../js/quiz.js', import.meta.url), 'utf8');
const runner = await readFile(new URL('../js/gate-runner.js', import.meta.url), 'utf8');
const start = quiz.slice(quiz.indexOf('let dictionaryRunnerPreparing ='), quiz.indexOf('let personalQuizPreparation ='));
const summary = quiz.slice(quiz.indexOf('function refreshQuizSettingsSummary()'), quiz.indexOf('function startConfiguredQuiz()'));
const pool = Array.from({ length: 12 }, (_, index) => ({ word: `word${index}`, meaning: `meaning${index}` }));
function fixture(count = 12) {
  const calls = [], notices = [], elements = { quizSettingsSummary: {}, quizStartButton: {} };
  const root = { __lootlinguaAuthGeneration: 1, LootLinguaGateRunner: { launch: async context => { calls.push(context); return true; } } };
  const context = vm.createContext({ window: root, selectedQuizMode: 'runner', currentView: 'quiz', currentQuizSource: 'personal', quizQuestionCount: '5',
    document: { getElementById: id => elements[id] }, getQuizSourceOwnerId: () => 'A',
    getQuizSourceResolutionStatus: () => 'ready', getQuizSourceWords: () => pool.slice(0, count),
    ensureQuizSourceReady: async () => ({}), getQuizSourceLabel: () => 'القاموس',
    getConfiguredQuizWords: () => pool.slice(0, 5), makeQuizSessionId: () => 'run',
    showToast: message => notices.push(message),
  });
  vm.runInContext(summary + '\n' + start, context);
  return { context, root, calls, notices, elements, start: () => context.startDictionaryRunner() };
}

test('dictionary runner locks at nine words and opens at ten without requiring ten words per round', async () => {
  const locked = fixture(9); locked.context.refreshQuizSettingsSummary();
  assert.equal(locked.elements.quizStartButton.disabled, true);
  assert.equal(await locked.start(), false); assert.equal(locked.calls.length, 0);
  const open = fixture(10); open.context.refreshQuizSettingsSummary();
  assert.equal(open.elements.quizStartButton.disabled, false);
  assert.equal(await open.start(), true);
  assert.equal(open.calls[0].source, 'dictionary'); assert.equal(open.calls[0].words.length, 5);
  assert.equal(open.calls[0].progress, undefined, 'practice does not impersonate a verified gate');
});

test('the configured pool keeps its size and gets distinct gate alternatives when meanings repeat', async () => {
  const f = fixture(); f.context.getConfiguredQuizWords = () => pool.slice(0, 5).map(word => ({ ...word, meaning: 'same' }));
  await f.start(); assert.equal(f.calls[0].words.length, 5);
  assert.equal(new Set(f.calls[0].words.map(word => word.meaning)).size, 3);
});

test('navigation, account changes and unavailable sources cannot open a stale dictionary run', async () => {
  for (const change of [f => { f.context.currentView = 'personal'; }, f => { f.root.__lootlinguaAuthGeneration++; }]) {
    const f = fixture(); f.context.ensureQuizSourceReady = async () => { change(f); return {}; };
    assert.equal(await f.start(), false); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.context.ensureQuizSourceReady = async () => ({ error: true });
  assert.equal(await f.start(), false); assert.equal(f.calls.length, 0);
});

test('correct-gate sound differs from coins and obeys the same mute switch', () => {
  const notes = [];
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} };
  class Audio {
    state = 'running'; currentTime = 1; destination = {};
    createGain() { return { gain: param, connect() {}, disconnect() {} }; }
    createOscillator() { const note = { frequency: { setValueAtTime: pitch => { note.pitch = pitch; } }, connect() {}, disconnect() {}, start() { notes.push([this.type, this.pitch]); }, stop() {} }; return note; }
    close() { return Promise.resolve(); }
  }
  const root = { AudioContext: Audio };
  const code = runner.slice(runner.indexOf('function createCoinAudio()'), runner.indexOf('async function launch(context)'));
  vm.runInNewContext(code + ';window.audio=createCoinAudio()', { window: root, localStorage: { getItem: () => '1', setItem() {} } });
  root.audio.unlock(); root.audio.play(); const coins = notes.splice(0);
  root.audio.play('gate'); assert.equal(notes.length, 3); assert.notDeepEqual(notes, coins);
  root.audio.toggle(); notes.length = 0; root.audio.play('gate'); root.audio.play(); assert.equal(notes.length, 0);
  root.audio.destroy();
});

test('question narration reads English once per gate, never meanings, independently of muted effects', () => {
  const said = [], saved = new Map([['lootlingua.runner.sound.v1', '0']]); let cancelled = 0;
  const root = { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { getVoices: () => [{ lang: 'ar' }, { lang: 'en-US' }], speak: value => said.push(value), cancel: () => { cancelled++; } } };
  const code = runner.slice(runner.indexOf('function createQuestionSpeech()'), runner.indexOf('function createCoinAudio()'));
  vm.runInNewContext(code + ';window.narrator=createQuestionSpeech()', { window: root, localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } });
  const narrator = root.narrator, gate = { id: 1, word: 'bridge', options: ['جسر', 'نهر', 'كتاب'], correctMeaning: 'جسر' };
  narrator.read(gate); narrator.read(gate);
  assert.equal(said.length, 1); assert.equal(said[0].text, 'bridge'); assert.equal(said[0].lang, 'en-US');
  narrator.toggle(); assert.equal(cancelled, 1); narrator.read({ ...gate, id: 2 }); assert.equal(said.length, 1);
  assert.equal(saved.get('lootlingua.runner.question-speech.v1'), 'off');
  narrator.toggle(); narrator.read({ ...gate, id: 3, word: 'كتاب' }); assert.equal(said.length, 1);
  narrator.read({ ...gate, id: 4 }); assert.equal(said.length, 2); narrator.cancel(); assert.equal(cancelled, 2);
});
