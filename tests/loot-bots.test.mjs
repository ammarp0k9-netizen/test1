import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattle, prepareDeck, LIMITS } from '../js/loot-bots-engine.mjs';

const words = [
  { word: 'he', translation: 'هو' }, { word: 'she', meaning: 'هي' }, { word: 'they', meaning: 'هم' },
];
const tick = 1 / 60;

function nextCore(battle) {
  for (let i = 0; i < 2400 && battle.state.phase === 'combat'; i++) {
    // Keep this test focused on the learning cycle across multiple sectors.
    battle.state.shieldUntil = battle.state.time + 1;
    battle.step(tick);
  }
  assert.equal(battle.state.phase, 'core');
  return battle.state.question;
}

test('two meanings suffice and alternate without invented choices', () => {
  assert.equal(prepareDeck([{ word: 'he', meaning: 'هو' }, { word: 'him', meaning: 'هو' }]).prompts.length, 0);
  const battle = createBattle(prepareDeck(words.slice(0, 2)), () => .31);
  const first = nextCore(battle);
  assert.equal(first.options.length, 2);
  assert.deepEqual(new Set(first.options.map(option => option.label)), new Set(['هو', 'هي']));
  battle.choose(first.options.findIndex(option => option.correct));
  assert.notEqual(nextCore(battle).word, first.word);
});

test('a homograph cannot use another of its own translations as a distractor', () => {
  const battle = createBattle(prepareDeck([{ word: 'bat', meaning: 'خفاش' }, { word: 'BAT', meaning: 'مضرب' }, ...words]), () => 0);
  for (let i = 0; i < 4; i++) {
    const question = nextCore(battle);
    if (question.word.toLowerCase() === 'bat') {
      assert.equal(question.options.some(option => !option.correct && ['مضرب', 'خفاش'].includes(option.label)), false);
      return;
    }
    battle.choose(question.options.findIndex(option => option.correct));
  }
  assert.fail('Every eligible prompt should appear before a repeat');
});

test('wrong core reveals the answer without damage and blocks the next sector until corrected', () => {
  const battle = createBattle(prepareDeck(words), () => .4);
  const question = nextCore(battle), s = battle.state, hp = s.hp;
  const wrong = question.options.findIndex(option => !option.correct);
  const correct = question.options.findIndex(option => option.correct);
  assert.equal(battle.choose(wrong), true);
  assert.equal(battle.choose(wrong), false);
  assert.equal(s.event.answer, question.answer);
  const score = s.score, before = s.enemies.map(({ x, y }) => ({ x, y }));
  for (let i = 0; i < 600; i++) battle.step(tick);
  assert.deepEqual(s.enemies.map(({ x, y }) => ({ x, y })), before);
  assert.equal(s.hp, hp);
  assert.equal(s.sector, 1);
  assert.equal(s.score, score);
  assert.equal(s.phase, 'core');
  assert.equal(battle.choose(correct), true);
  assert.equal(s.sector, 2);
  assert.equal(s.reinforcement, 0);
  assert.ok(s.enemies.some(enemy => enemy.kind === 'striker' && enemy.ready > s.time));
  assert.ok(s.powerUntil > s.time);
});

test('a core appearing under the player requires a deliberate entry', () => {
  const battle = createBattle(prepareDeck(words), () => .4), s = battle.state;
  s.player.x = 320; s.player.y = 125;
  nextCore(battle);
  battle.step(tick);
  assert.equal(s.phase, 'core');
  assert.equal(s.event, null);
  for (let i = 0; i < 15; i++) battle.step(tick, 0, 1);
  for (let i = 0; i < 15; i++) battle.step(tick, 0, -1);
  assert.ok(['correct', 'wrong'].includes(s.event?.type));
});

test('dash moves the player, has a cooldown, and the simulation bounds its entity counts', () => {
  const battle = createBattle(prepareDeck(words), () => .72), s = battle.state;
  const start = s.player.x;
  battle.step(tick, 1, 0, true);
  assert.ok(s.player.x - start > 8);
  const ready = s.dashReady;
  battle.step(tick, 1, 0, true);
  assert.equal(s.dashReady, ready);
  s.sector = 35;
  for (let i = 0; i < 7200; i++) {
    s.shieldUntil = s.time + 1;
    battle.step(tick);
    if (s.question) battle.choose(s.question.options.findIndex(option => option.correct));
    for (const [entity, cap] of Object.entries(LIMITS)) assert.ok(s[entity].length <= cap);
  }
});
