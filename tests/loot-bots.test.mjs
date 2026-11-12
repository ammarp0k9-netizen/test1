import assert from 'node:assert/strict';
import test from 'node:test';
import { bossProgress, canDecode, createBattle, prepareDeck, LIMITS, MAX_CELLS, STATION } from '../js/loot-bots-engine.mjs';
import { arenaForAspect, CUES, shotCover } from '../js/loot-bots-arena.mjs';
import { BOSS_TYPES, bossHealth, createBossDirector } from '../js/loot-bots-bosses.mjs';

const words = [
  { word: 'he', translation: 'هو' }, { word: 'she', meaning: 'هي' }, { word: 'they', meaning: 'هم' },
];
const tick = 1 / 60;
const besideStation = player => Object.assign(player, { x: STATION.x, y: STATION.y + 64 });

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
  if (battle.state.stationDone) winBoss(battle);
  nextStation(battle);
  besideStation(battle.state.player);
  assert.equal(battle.activate(), true);
  return battle.state.question;
}

function winBoss(battle) {
  const s = battle.state;
  while (s.phase === 'combat' && s.time <= s.bossCycleStart + s.bossInterval + 7) advance(battle, tick, true);
  assert.equal(s.phase, 'boss-warning');
  advance(battle, 3.05, true);
  assert.equal(s.phase, 'boss');
  assert.equal(battle.activate(), false);
  s.boss.hp = 1;
  s.shots.push({ x: s.boss.x, y: s.boss.y, dx: 0, dy: 0, speed: 0, life: 1, hostile: false });
  advance(battle, tick, true);
  assert.equal(s.phase, 'boss-clear');
  assert.ok(s.victory.coins > 0);
  advance(battle, 3.1, true);
  assert.equal(s.phase, 'combat');
  assert.equal(s.stationDone, false);
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
  assert.equal(s.cells, MAX_CELLS - 1);
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
  assert.equal(battle.activate(), false);
  besideStation(s.player);
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

test('a correct answer powers up the weapon when that reward is selected', () => {
  const battle = createBattle(prepareDeck(words), () => .3);
  const question = decode(battle), s = battle.state;
  assert.equal(battle.choose(question.options.findIndex(option => option.correct)), true);
  assert.equal(s.tier, 1);
  assert.equal(s.score, 100);
  advance(battle, 3.1, true);
  assert.equal(s.phase, 'combat');
  assert.equal(s.defense, null);
  assert.equal(s.event.reward.id, 'power');
  assert.equal(s.stationDone, true);
  battle.step(tick, 0, 0, false, 1, 0);
  assert.equal(s.shots.at(-1)?.powered, true);
});

test('late station gates the boss, reserves recovery time, and provides an interlude after the win', () => {
  const battle = createBattle(prepareDeck(words), () => .4), s = battle.state;
  nextStation(battle);
  advance(battle, 85, true);
  assert.equal(s.phase, 'approach');
  assert.ok(bossProgress(s) < 1);
  besideStation(s.player);
  assert.equal(battle.activate(), true);
  battle.choose(s.question.options.findIndex(option => !option.correct));
  advance(battle, 4.25, true);
  assert.ok(s.bossInterval - (s.time - s.bossCycleStart) > 8);
  winBoss(battle);
  assert.equal(s.bossWins, 1);
  assert.ok(s.stationAt - s.time > 34);
});

test('rewards respond to health, vary between stations, and grant their real effect', () => {
  const battle = createBattle(prepareDeck(words), () => .99), s = battle.state;
  let q = decode(battle);
  battle.choose(q.options.findIndex(option => option.correct));
  assert.equal(s.event.reward.id, 'magnet');
  advance(battle, 3.1, true);
  assert.equal(s.collected, 3);
  s.hp = 2;
  q = decode(battle);
  battle.choose(q.options.findIndex(option => option.correct));
  assert.equal(s.event.reward.id, 'repair');
  advance(battle, 3.1, true);
  assert.equal(s.hp, 4);
  q = decode(battle);
  battle.choose(q.options.findIndex(option => option.correct));
  assert.notEqual(s.event.reward.id, 'repair');
});

test('ten bosses open with distinct attacks and the next loop adds a new pattern', () => {
  const s = { time: 0, bossWins: 0, player: { x: 313, y: 327 }, shots: [], enemies: [] };
  let bullets = 0, spawns = 0;
  const director = createBossDirector({ state: s, random: () => .8, width: 640, height: 540,
    shoot: () => bullets++, spawn: () => spawns++, damage: () => true, burst: () => {} });
  const firstMoves = new Set(), ids = new Set();
  for (; s.bossWins < BOSS_TYPES.length; s.bossWins++) {
    director.prepare();
    ids.add(s.boss.id);
    s.time = s.boss.nextAt;
    director.update(tick);
    const attack = s.boss.attack;
    firstMoves.add(attack.move);
    assert.ok(attack.fireAt > s.time);
    s.time = attack.fireAt;
    director.update(tick);
    assert.equal(attack.fired, true);
  }
  assert.equal(ids.size, 10);
  assert.equal(firstMoves.size, 10);
  assert.ok(bullets >= 19 && spawns >= 2);
  director.prepare();
  assert.notEqual(s.boss.id, 'magnet');
  s.boss.sequence = 3;
  s.time = s.boss.nextAt;
  director.update(tick);
  assert.equal(s.boss.cycle, 1);
  assert.ok(!s.boss.attacks.includes(s.boss.attack.move));
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
    if (s.phase === 'approach' && s.phaseTime >= 2.4) besideStation(s.player);
    if (s.question) battle.choose(s.question.options.findIndex(option => !option.correct));
    else if (canDecode(s)) battle.activate();
    const aim = s.boss ? Math.atan2(s.boss.y - s.player.y, s.boss.x - s.player.x) : i * .016;
    if (s.phase === 'boss') { s.player.x = s.boss.x; s.player.y = Math.max(24, s.boss.y - 64); }
    battle.step(tick, 0, 0, false, Math.cos(aim), Math.sin(aim));
    for (const [entity, cap] of Object.entries(LIMITS)) assert.ok(s[entity].length <= cap);
  }
  assert.ok(s.sector >= 38 && s.bossWins >= 2);
});

test('a held trigger empties the cells, cools down, and preserves the gap between bursts', () => {
  const battle = createBattle(prepareDeck(words), () => .5), s = battle.state;
  s.spawnAt = Infinity;
  const shotsAt = [];
  for (let i = 0; i < 210; i++) {
    s.cues = 0;
    battle.step(tick, 0, 0, false, 0, -1);
    if (s.cues & CUES.fire) shotsAt.push(s.time);
  }
  assert.ok(shotsAt.length > MAX_CELLS);
  assert.ok(shotsAt[MAX_CELLS] - shotsAt[MAX_CELLS - 1] > 1);
  assert.ok(shotsAt[1] - shotsAt[0] < .3);
});

test('portrait and landscape keep a solid station that can be activated from its rim', () => {
  for (const aspect of [.65, 1.7]) {
    const arena = arenaForAspect(aspect), battle = createBattle(prepareDeck(words), () => .5, arena), s = battle.state;
    s.spawnAt = Infinity; s.stationAt = 0;
    for (let i = 0; i < 210; i++) battle.step(tick, 0, -1, i === 38);
    assert.ok(Math.abs(s.player.x - arena.station.x) < .1);
    assert.ok(s.player.y >= arena.station.y + 53.9);
    assert.equal(battle.activate(), true);
  }
});

test('player shots crack and remove crates, but solid objects still stop bullets', () => {
  const battle = createBattle(prepareDeck(words), () => .5), s = battle.state;
  s.spawnAt = Infinity;
  const crate = s.cover.find(item => item.kind === 'crate'), pillar = s.cover.find(item => item.kind === 'pillar');
  function hit(object) {
    s.shots.push({ x: object.x, y: object.y - object.radius - 5, dx: 0, dy: 1, speed: 640, life: 1, hostile: false });
    battle.step(tick);
    assert.equal(s.shots.length, 0);
  }
  hit(crate); assert.equal(crate.hp, 1);
  hit(crate); assert.ok(!s.cover.includes(crate));
  hit(pillar); assert.ok(s.cover.includes(pillar));
});

test('boss health increases for the opening ten and scales within a late-game ceiling', () => {
  for (let i = 2; i <= 12; i++) assert.ok(bossHealth(i) > bossHealth(i - 1));
  assert.ok(bossHealth(200) >= bossHealth(30));
  assert.ok(bossHealth(200) <= 54);
});

test('gunner seeks a line of fire around the station before winding up', () => {
  const battle = createBattle(prepareDeck(words), () => .5), s = battle.state;
  s.spawnAt = Infinity;
  const gunner = { x: 320, y: 165, kind: 'gunner', radius: 16, ready: 0, rushUntil: 0, attackAt: 0, nextAttack: 0, speed: 66 };
  s.enemies.push(gunner);
  battle.step(tick);
  assert.equal(gunner.attackAt, 0);
  for (let i = 0; i < 270 && !gunner.attackAt; i++) battle.step(tick);
  assert.ok(gunner.attackAt > s.time);
  assert.equal(shotCover(s.cover, gunner.x, gunner.y, s.player.x, s.player.y), -1);
  assert.ok(Math.abs(gunner.x - 320) > 45);
});

test('the first boss flanks solid cover before charging a sheltered player', () => {
  const battle = createBattle(prepareDeck(words), () => .5), s = battle.state;
  s.spawnAt = Infinity;
  s.stationDone = true; s.bossInterval = 0.1;
  advance(battle, 4.2, true);
  const boss = s.boss;
  assert.equal(s.phase, 'boss');
  assert.equal(boss.attack, null);
  for (let i = 0; i < 320 && !boss.attack; i++) advance(battle, tick, true);
  assert.equal(boss.attack?.move, 'ram');
  assert.equal(shotCover(s.cover, boss.x, boss.y, s.player.x, s.player.y), -1);
});
