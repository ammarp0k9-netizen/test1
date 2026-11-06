import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = {};
vm.runInNewContext(await readFile(new URL('../js/runner-engine.js', import.meta.url), 'utf8'), { window: root });
const engine = root.LootLinguaRunnerEngine;
const words = [{ word: 'apple', meaning: 'تفاحة' }, { word: 'book', meaning: 'كتاب' }, { word: 'sun', meaning: 'شمس' }, { word: 'moon', meaning: 'قمر' }];
const copy = value => structuredClone(value);
function seeded(seed = 42) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function make(pool = words) { const state = engine.createState(pool, { random: seeded() }); state._nextRowAt = Infinity; state._nextGateAt = Infinity; return state; }
function entity(state, values) { const item = state._pool.pop(); Object.assign(item, { id: state._nextId++, resolved: false, z: .1, lane: 1 }, values); state.entities.push(item); return item; }

test('normalization and seeded updates are deterministic and never mutate source dictionary records', () => {
  const original = copy(words), a = engine.createState(words, { random: seeded() }), b = engine.createState(words, { random: seeded() });
  for (let index = 0; index < 220; index++) { engine.update(a, 16); engine.update(b, 16); }
  assert.equal(JSON.stringify(a), JSON.stringify(b)); assert.deepEqual(words, original);
  assert.notEqual(a.words, words); assert.notEqual(a.words[0], words[0]);
});

test('lane controls are discrete, clamped and inactive while paused or finished', () => {
  const state = make(); assert.equal(engine.move(state, 1), false);
  engine.move(state, 2.6); assert.equal(state.lane, 2); engine.move(state, -9); assert.equal(state.lane, 0);
  state.paused = true; assert.equal(engine.move(state, 1), false); assert.equal(engine.jump(state), false);
  state.paused = false; state.over = true; assert.equal(engine.slide(state), false);
});

test('pause freezes movement, action timers and collision state; oversized dt advances at most 50ms', () => {
  const state = make(); engine.jump(state); const obstacle = entity(state, { kind: 'obstacle', obstacleType: 'wall' });
  state.paused = true; const before = JSON.stringify(state); engine.update(state, 10000); assert.equal(JSON.stringify(state), before);
  state.paused = false; engine.update(state, 10000);
  assert.equal(state.elapsed, 50); assert.ok(state.distance <= 1.15); assert.equal(obstacle.resolved, true); assert.equal(state.hearts, 2);
});

test('low obstacles require jump, overhead obstacles require slide, and solid walls require a clear lane', () => {
  for (const [obstacleType, action, hearts] of [['low', 'jump', 3], ['low', 'slide', 2], ['overhead', 'slide', 3], ['overhead', 'jump', 2], ['wall', 'jump', 2]]) {
    const state = make(); engine[action](state); entity(state, { kind: 'obstacle', obstacleType }); engine.update(state, 50);
    assert.equal(state.hearts, hearts, obstacleType + ' / ' + action);
  }
  const escaped = make(); entity(escaped, { kind: 'obstacle', obstacleType: 'wall' }); engine.move(escaped, 0); engine.update(escaped, 50); assert.equal(escaped.hearts, 3);
});

test('collisions use action timing at the crossing instant rather than the end of the frame', () => {
  const state = make(); engine.jump(state); state.elapsed = state.actionUntil - 20;
  entity(state, { kind: 'obstacle', obstacleType: 'low', z: .05 }); engine.update(state, 50);
  assert.equal(state.hearts, 3); assert.equal(engine.getAction(state), 'run');
});

test('a row crossing cannot charge several hearts during invulnerability and cannot charge a resolved obstacle twice', () => {
  const state = make(); entity(state, { kind: 'obstacle', obstacleType: 'wall' }); entity(state, { kind: 'obstacle', obstacleType: 'wall' });
  engine.update(state, 50); assert.equal(state.hearts, 2); engine.update(state, 50); assert.equal(state.hearts, 2);
  for (let index = 0; index < 25; index++) engine.update(state, 50);
  entity(state, { kind: 'obstacle', obstacleType: 'wall' }); engine.update(state, 50); assert.equal(state.hearts, 1);
});

test('word gates resolve once at z=0; remaining in the correct lane counts without an extra action', () => {
  const state = make(), data = engine.createWordGate(state);
  const gate = entity(state, { ...data, z: 3 }); state.gate = gate;
  engine.move(state, gate.correctLane); engine.update(state, 50);
  assert.equal(gate.resolved, false); assert.equal(state.feedback, null);
  engine.move(state, (gate.correctLane + 1) % 3); assert.equal(gate.resolved, false);
  engine.move(state, gate.correctLane);
  for (let index = 0; index < 7; index++) engine.update(state, 50);
  assert.equal(gate.resolved, true); assert.equal(state.feedback.correct, true); assert.equal(state.hearts, 3);
  const fixed = make(), sameLane = entity(fixed, { ...engine.createWordGate(fixed), z: .1, correctLane: 1 }); fixed.gate = sameLane;
  engine.update(fixed, 50); assert.equal(fixed.feedback.correct, true);
});

test('a wrong gate crossing loses one heart and supplies the correct meaning for feedback', () => {
  const state = make(), gate = entity(state, { ...engine.createWordGate(state), z: .1, correctLane: 0 }); state.gate = gate;
  engine.update(state, 50); assert.equal(state.hearts, 2); assert.equal(state.feedback.correct, false);
  assert.equal(state.feedback.correctMeaning, gate.correctMeaning); assert.equal(state.feedback.chosenLane, 1);
  engine.update(state, 50); assert.equal(state.hearts, 2);
});

test('gates have three distinct meanings and at least four seconds of reading time at maximum difficulty', () => {
  const state = make(); state.distance = 100000; state._nextGateAt = 0;
  engine.update(state, 50); const gate = state.gate;
  assert.equal(new Set(gate.options).size, 3); assert.equal(gate.options[gate.correctLane], gate.correctMeaning);
  assert.ok(gate.z / state.speed >= 4); assert.equal(state.speed, 12);
  assert.equal(engine.createWordGate(make([{ word: 'a', meaning: 'same' }, { word: 'b', meaning: 'same' }])), null);
});

test('active reading gates exclude obstacle rows and coins collect once in the player lane only', () => {
  const state = make(); state._nextRowAt = 0; state._nextGateAt = 0;
  engine.update(state, 50); assert.ok(state.gate);
  for (let index = 0; index < 60; index++) { engine.update(state, 50); assert.ok(state.entities.every(item => item.kind !== 'obstacle')); }
  const coins = make(); entity(coins, { kind: 'coin' }); entity(coins, { kind: 'coin', lane: 0 }); engine.update(coins, 50);
  assert.equal(coins.coins, 1); engine.update(coins, 50); assert.equal(coins.coins, 1);
});

test('spawn rows always provide an escape and recycle a fixed pool during a long run', () => {
  const state = engine.createState([], { random: seeded() }); let rows = 0, fastest = 0;
  for (let index = 0; index < 20000; index++) {
    state.invulnerableUntil = Infinity; engine.update(state, 50); fastest = Math.max(fastest, state.speed);
    assert.ok(state.entities.length <= 48); assert.equal(state.entities.length + state._pool.length, 48);
    assert.ok(state.events.length <= engine.constants.MAX_EVENTS);
    const byRow = new Map();
    for (const item of state.entities) if (item.kind === 'obstacle') { if (!byRow.has(item.row)) byRow.set(item.row, new Set()); byRow.get(item.row).add(item.lane); }
    for (const blocked of byRow.values()) assert.ok(blocked.size < 3);
    rows = Math.max(rows, state._row);
  }
  assert.ok(rows > 200); assert.equal(fastest, engine.constants.MAX_SPEED);
});
