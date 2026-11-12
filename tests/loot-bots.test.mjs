import assert from 'node:assert/strict';
import test from 'node:test';
import { canDecode, createBattle, prepareDeck, LIMITS, STATION } from '../js/loot-bots-engine.mjs';

const words = [
  { word: 'he', translation: 'هو' }, { word: 'she', meaning: 'هي' }, { word: 'they', meaning: 'هم' },
];
const tick = 1 / 60;

function advance(battle, seconds, safe = false) {
  for (let i = 0; i < Math.ceil(seconds / tick); i++) {
    if (safe) battle.state.shieldUntil = battle.state.time + 1;
    battle.step(tick);
  }
}

function nextStation(battle) {
  const state = battle.state;
  while (state.phase === 'combat' && state.time < state.stationAt + 6) advance(battle, tick, true);
  assert.equal(state.phase, 'approach');
  advance(battle, 2.5, true);
}

function decode(battle) {
  nextStation(battle);
  Object.assign(battle.state.player, STATION);
  assert.equal(battle.activate(), true);
  return battle.state.question;
}

test('only a deliberate aim command fires, in the indicated direction', () => {
  const battle = createBattle(prepareDeck(words), () => .21), s = battle.state;
  advance(battle, 2);
  assert.ok(s.enemies.length);
  assert.equal(s.shots.length, 0);
  battle.step(tick, 0, 1, false, -1, 0);
  assert.equal(s.shots.length, 1);
  assert.equal(s.shots[0].dx, -1);
  assert.ok(s.player.y > 389);
  assert.equal(s.shots[0].hostile, false);
  advance(battle, .25);
  assert.equal(s.shots.length, 1);
});

test('station opens after combat, then needs proximity and deliberate activation', () => {
  const battle = createBattle(prepareDeck(words), () => .4), s = battle.state;
  advance(battle, 30, true);
  assert.equal(s.phase, 'combat');
  assert.equal(battle.activate(), false);
  nextStation(battle);
  const count = s.enemies.length;
  advance(battle, 8, true);
  assert.equal(s.enemies.length, count);
  assert.equal(battle.activate(), false);
  Object.assign(s.player, STATION);
  assert.equal(canDecode(s), true);
  assert.equal(s.question, null);
  assert.equal(battle.activate(), true);
  const combatTime = s.time;
  advance(battle, 8);
  assert.equal(s.time, combatTime);
  assert.equal(s.phase, 'decode');
});

test('two meanings suffice and prompts alternate without invented choices', () => {
  assert.equal(prepareDeck([{ word: 'he', meaning: 'هو' }, { word: 'him', meaning: 'هو' }]).prompts.length, 0);
  const battle = createBattle(prepareDeck(words.slice(0, 2)), () => .31);
  const first = decode(battle);
  assert.deepEqual(new Set(first.options.map(option => option.label)), new Set(['هو', 'هي']));
  battle.choose(first.options.findIndex(option => option.correct));
  advance(battle, 3.1, true);
  assert.notEqual(decode(battle).word, first.word);
});

test('a homograph cannot use another of its own translations as a distractor', () => {
  const battle = createBattle(prepareDeck([{ word: 'bat', meaning: 'خفاش' }, { word: 'BAT', meaning: 'مضرب' }, ...words]), () => 0);
  for (let i = 0; i < 4; i++) {
    const question = decode(battle);
    if (question.word.toLowerCase() === 'bat') {
      assert.equal(question.options.some(option => !option.correct && ['مضرب', 'خفاش'].includes(option.label)), false);
      return;
    }
    battle.choose(question.options.findIndex(option => option.correct));
    advance(battle, 3.1, true);
  }
  assert.fail('Every eligible prompt should appear before a repeat');
});

test('wrong answer reveals the meaning and resumes combat with a dodgeable attack', () => {
  const battle = createBattle(prepareDeck(words), () => .4);
  const question = decode(battle), s = battle.state, hp = s.hp;
  s.enemies.length = 0;
  s.player.y += 64;
  assert.equal(battle.choose(question.options.findIndex(option => !option.correct)), true);
  assert.equal(battle.choose(question.options.findIndex(option => option.correct)), false);
  assert.equal(s.event.answer, question.answer);
  assert.equal(s.hp, hp);
  assert.equal(s.tier, 0);
  advance(battle, 4.25);
  assert.equal(s.phase, 'combat');
  assert.equal(s.sector, 2);
  assert.equal(s.hp, hp);
  s.spawnAt = Infinity;
  advance(battle, 1.2);
  assert.ok(s.defense.fireAt > s.time);
  for (let i = 0; i < 46; i++) battle.step(tick, 1, 0, i === 15);
  assert.ok(s.shots.some(shot => shot.hostile));
  assert.equal(s.hp, hp);
});

test('correct answer improves the weapon and opens a longer, bounded combat interval', () => {
  const battle = createBattle(prepareDeck(words), () => .71);
  const question = decode(battle), s = battle.state;
  assert.equal(battle.choose(question.options.findIndex(option => option.correct)), true);
  assert.equal(s.tier, 1);
  assert.equal(s.score, 100);
  advance(battle, 3.1, true);
  assert.equal(s.phase, 'combat');
  assert.equal(s.defense, null);
  assert.ok(s.stationAt - s.time > 40);
  battle.step(tick, 0, 0, false, 1, 0);
  assert.equal(s.shots.at(-1)?.powered, true);
});

test('dash has a cooldown and dense fights respect entity caps', () => {
  const battle = createBattle(prepareDeck(words), () => .1), s = battle.state;
  const start = s.player.x;
  battle.step(tick, 1, 0, true);
  assert.ok(s.player.x - start > 8);
  const ready = s.dashReady;
  battle.step(tick, 1, 0, true);
  assert.equal(s.dashReady, ready);
  s.sector = 35;
  for (let i = 0; i < 18000; i++) {
    s.shieldUntil = s.time + 1;
    if (s.phase === 'approach' && s.phaseTime >= 2.4) Object.assign(s.player, STATION);
    if (s.question) battle.choose(s.question.options.findIndex(option => !option.correct));
    else if (canDecode(s)) battle.activate();
    battle.step(tick, 0, 0, false, Math.cos(i * .016), Math.sin(i * .016));
    for (const [entity, cap] of Object.entries(LIMITS)) assert.ok(s[entity].length <= cap);
  }
  assert.ok(s.sector > 38);
});
