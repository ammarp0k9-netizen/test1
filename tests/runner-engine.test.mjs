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

test('obstacles use physical clearances: jump low bars, slide under beams and change lanes around tall walls', () => {
  for (const [obstacleType, action, hearts] of [['low', 'jump', 3], ['low', 'slide', 2], ['overhead', 'slide', 3], ['overhead', 'jump', 3], ['wall', 'jump', 2]]) {
    const state = make(); engine[action](state); state.elapsed = state.actionUntil * .4; entity(state, { kind: 'obstacle', obstacleType }); engine.update(state, 50);
    assert.equal(state.hearts, hearts, obstacleType + ' / ' + action);
  }
  const escaped = make(); entity(escaped, { kind: 'obstacle', obstacleType: 'wall' }); engine.move(escaped, 0); engine.update(escaped, 50); assert.equal(escaped.hearts, 3);
});

test('collisions use action timing at the crossing instant rather than the end of the frame', () => {
  const state = make(); engine.jump(state); state.elapsed = state.actionUntil - 80;
  entity(state, { kind: 'obstacle', obstacleType: 'low', z: .05 }); engine.update(state, 50);
  assert.equal(state.hearts, 3); assert.ok(engine.getPose(state).feet < .37);
});

test('a row crossing cannot charge several hearts during invulnerability and cannot charge a resolved obstacle twice', () => {
  const state = make(); entity(state, { kind: 'obstacle', obstacleType: 'wall' }); entity(state, { kind: 'obstacle', obstacleType: 'wall' });
  engine.update(state, 50); assert.equal(state.hearts, 2); engine.update(state, 50); assert.equal(state.hearts, 2);
  for (let index = 0; index < 25; index++) engine.update(state, 50);
  state.elapsed = Math.max(state.elapsed, state.invulnerableUntil + 1);
  entity(state, { kind: 'obstacle', obstacleType: 'wall', lane: state.lane }); engine.update(state, 50); assert.equal(state.hearts, 1);
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

test('reading gates keep obstacles behind them and coins collect once in the player lane only', () => {
  const state = make(); state._nextRowAt = 0; state._nextGateAt = 0;
  engine.update(state, 50); assert.ok(state.gate);
  for (let index = 0; index < 60; index++) { engine.update(state, 50); assert.ok(state.entities.every(item => item.kind !== 'obstacle' || item.z > state.gate.z + 10)); }
  const coins = make(); entity(coins, { kind: 'coin' }); entity(coins, { kind: 'coin', lane: 0 }); engine.update(coins, 50);
  assert.equal(coins.coins, 1); engine.update(coins, 50); assert.equal(coins.coins, 1);
});

test('spawn rows always provide a traversable route and recycle a fixed pool during a long run', () => {
  const state = engine.createState([], { random: seeded() }); let rows = 0, fastest = 0, closedRows = 0; const formations = new Set();
  for (let index = 0; index < 20000; index++) {
    state.invulnerableUntil = Infinity; engine.update(state, 50); fastest = Math.max(fastest, state.speed);
    assert.ok(state.entities.length <= 48); assert.equal(state.entities.length + state._pool.length, 48);
    assert.ok(state.events.length <= engine.constants.MAX_EVENTS);
    const byRow = new Map();
    for (const item of state.entities) if (item.kind === 'obstacle') { if (!byRow.has(item.row)) byRow.set(item.row, []); byRow.get(item.row).push(item); }
    for (const blocked of byRow.values()) if (blocked.length === 3) {
      assert.ok(blocked.some(item => ['low', 'overhead', 'duckwall', 'train'].includes(item.obstacleType)));
      closedRows++;
    }
    if (state._row > rows) {
      const spawned = state.entities.filter(item => item.kind === 'obstacle' && item.row === state._row);
      if (spawned.length) formations.add(spawned.map(item => item.obstacleType).sort().join(','));
      const route = spawned.find(item => item.safeRoute);
      if (route) assert.notEqual(route.obstacleType, 'wall');
    }
    rows = Math.max(rows, state._row);
  }
  assert.ok(rows > 200); assert.equal(fastest, engine.constants.MAX_SPEED); assert.ok(closedRows > 0);
  for (const pattern of ['train,wall,wall', 'train,train,wall', 'low,train,train', 'low,overhead,train', 'train,train,train']) assert.ok(formations.has(pattern), pattern);
});

test('gate answer lanes use balanced shuffled bags without immediate repeats', () => {
  const state = make(); let previous = -1;
  for (let bag = 0; bag < 30; bag++) {
    const lanes = [];
    for (let index = 0; index < 3; index++) {
      const gate = engine.createWordGate(state);
      assert.notEqual(gate.correctLane, previous);
      assert.equal(gate.options[gate.correctLane], gate.correctMeaning);
      previous = gate.correctLane; lanes.push(previous);
    }
    assert.equal(new Set(lanes).size, 3);
  }
});

test('actions buffer one repeat without extending the arc; sliding can immediately turn into jumping', () => {
  for (const action of ['jump', 'slide']) {
    const state = make(); engine[action](state); const end = state.actionUntil;
    assert.equal(engine[action](state), false);
    state.elapsed = end - 100;
    assert.equal(engine[action](state), true);
    assert.equal(engine[action](state), false);
    assert.equal(state.actionUntil, end);
    while (state.elapsed < end + 100) engine.update(state, 25);
    assert.equal(engine.getAction(state), action);
    assert.ok(state.actionStartedAt >= end + 70);
  }
  const state = make(); engine.slide(state); engine.update(state, 50);
  assert.equal(engine.jump(state), true); assert.equal(engine.getAction(state), 'jump');
  assert.equal(state._queuedAction, null);
});

test('jumping above a coin misses it; shared physical height clears a low obstacle at the apex', () => {
  const state = make(); engine.jump(state); state.elapsed = state.actionUntil / 2;
  entity(state, { kind: 'coin' }); entity(state, { kind: 'obstacle', obstacleType: 'low' });
  engine.update(state, 50); assert.equal(state.coins, 0); assert.equal(state.hearts, 3);
  const landing = make(); engine.jump(landing); landing.elapsed = landing.actionUntil - 20;
  entity(landing, { kind: 'obstacle', obstacleType: 'low' }); engine.update(landing, 50);
  assert.equal(landing.hearts, 2, 'feet are already below the barrier during landing');
});

test('gate intervals leave a long randomized run and restore distance-based speed after crossing', () => {
  for (const seed of [1, 2, 100]) {
    const state = engine.createState(words, { random: seeded(seed) });
    assert.ok(state._nextGateAt >= 30000 && state._nextGateAt <= 42000);
    state.distance = 1400; state._nextGateAt = 0; engine.update(state, 50);
    assert.equal(state.speed, 12);
    assert.ok(state._nextGateAt - state.elapsed >= 30000);
    state.lane = state.gate.correctLane; state.gate.z = .1; engine.update(state, 50); engine.update(state, 50);
    assert.equal(state.speed, 32);
  }
});

test('train ramp lifts the runner, roof coins require roof height, and leaving its lane drops support', () => {
  const state = make();
  entity(state, { kind: 'obstacle', obstacleType: 'train', length: 20, z: -10, resolved: true });
  assert.equal(engine.getPose(state).floor, 1.05);
  entity(state, { kind: 'coin', height: 1.49 }); entity(state, { kind: 'coin' });
  engine.update(state, 50); assert.equal(state.coins, 1);
  engine.move(state, 0); assert.equal(engine.getPose(state).floor, 0);
});

test('even at maximum speed, crossing a gate leaves over three seconds before the next hazard', () => {
  const state = engine.createState(words, { random: seeded() });
  state.distance = 100000; state._nextGateAt = 0;
  engine.update(state, 50);
  for (let frame = 0; frame < 80; frame++) {
    engine.update(state, 50);
    assert.ok(state.entities.every(item => item.kind !== 'obstacle'));
  }
  state.gate.z = .1; state.lane = state.gate.correctLane; engine.update(state, 50);
  for (let frame = 0; frame < 60; frame++) {
    engine.update(state, 50);
    assert.ok(state.entities.every(item => item.kind !== 'obstacle' || item.z > 0));
  }
  assert.equal(state.hearts, 3);
  assert.ok(state.entities.some(item => item.kind === 'obstacle'), 'hazards resume after the recovery gap');
});

test('bonus coin trails accompany jumpable or slidable hazards, never tall walls', () => {
  const state = engine.createState([], { random: seeded() }); let trails = 0;
  state.invulnerableUntil = Infinity;
  for (let frame = 0; frame < 1500; frame++) {
    engine.update(state, 50);
    for (const coin of state.entities.filter(item => item.requires && item.z > 0)) {
      const obstacle = state.entities.find(item => item.kind === 'obstacle' && item.row === coin.row && item.lane === coin.lane);
      assert.ok((coin.requires === 'jump' ? ['low'] : ['overhead', 'duckwall']).includes(obstacle?.obstacleType));
      assert.equal(coin.height, coin.requires === 'jump' ? 1.5 : .22); trails++;
    }
  }
  assert.ok(trails > 0);
});

test('bonus coins require the matching safe body pose', () => {
  for (const [requires, action, expected] of [['jump', null, 0], ['jump', 'jump', 1], ['slide', null, 0], ['slide', 'slide', 1]]) {
    const state = make(); if (action) { engine[action](state); state.elapsed = state.actionUntil / 2; }
    entity(state, { kind: 'coin', requires, height: requires === 'jump' ? 1.5 : .22 });
    engine.update(state, 50); assert.equal(state.coins, expected, `${requires}/${action}`);
  }
});


test('vehicle support includes the full golden cab, with an exit only after the visible roof ends', () => {
  const state = make(); const truck = entity(state, {kind:'obstacle',obstacleType:'train',length:20,z:-17,resolved:true});
  for(const position of [6,10,17,18.5,19.99,20]) {
    truck.z=-position;assert.equal(engine.getPose(state).floor,1.05);
    assert.equal(engine.vehicleSurface(truck),1.05);
  }
  truck.z=-21.5;assert.equal(engine.getPose(state).floor,.525);
  truck.z=-23;assert.equal(engine.getPose(state).floor,0);
});

test('near-camera objects remain alive until their complete geometry passes the near plane',()=>{
  const state=make();const wall=entity(state,{kind:'obstacle',obstacleType:'wall',z:-9,resolved:true});
  engine.update(state,16);assert.ok(state.entities.includes(wall));
  wall.z=-16.1;engine.update(state,16);assert.ok(!state.entities.includes(wall));
  const truck=entity(state,{kind:'obstacle',obstacleType:'train',length:20,z:-33,resolved:true});
  engine.update(state,16);assert.ok(state.entities.includes(truck));
  truck.z=-39.1;engine.update(state,16);assert.ok(!state.entities.includes(truck));
});


test('the tall ducking panel requires a ground slide, not a jump',()=>{
  for(const action of ['run','jump','slide']){
    const state=make();if(action!=='run'){engine[action](state);state.elapsed=state.actionUntil*.4}
    entity(state,{kind:'obstacle',obstacleType:'duckwall'});engine.update(state,50);
    assert.equal(state.hearts,action==='slide'?3:2,action);
  }
});

test('row spacing gets tighter with progress but keeps a finite action recovery floor',()=>{
  const early=make([]);early._nextRowAt=0;engine.update(early,50);const start=early._nextRowAt-early.elapsed;
  const late=make([]);late.distance=100000;late._nextRowAt=0;engine.update(late,50);const hard=late._nextRowAt-late.elapsed;
  assert.ok(hard<start);assert.ok(hard>=engine.constants.MIN_ROW_MS);
  assert.ok(engine.constants.MIN_ROW_MS>engine.constants.JUMP_MS+70);
});

test('a gate remains a physical passage after answering, until its entire tunnel has passed',()=>{
  const state=make(),gate=entity(state,{...engine.createWordGate(state),length:engine.constants.TUNNEL_LENGTH,z:.1,correctLane:1});state.gate=gate;state.distance=100000;
  engine.update(state,50);assert.equal(gate.resolved,true);assert.equal(gate.length,engine.constants.TUNNEL_LENGTH);
  for(let i=0;i<20;i++)engine.update(state,50);
  assert.equal(state.gate,gate);assert.ok(gate.z+gate.length>0);
  for(let i=0;i<20;i++)engine.update(state,50);
  assert.equal(state.gate,null);
});

test('assist off shows an impact freeze then passes the obstacle without steering or automatic actions', () => {
  const state = make(); state.autoRecovery = false;
  const box = entity(state, { kind: 'obstacle', obstacleType: 'wall' });
  engine.update(state, 50); const z = box.z, distance = state.distance;
  assert.equal(state.hearts, 2); assert.equal(state.impact.kind, 'hit'); assert.equal(state.impact.plan, null);
  assert.ok(z >= 3); assert.equal(engine.move(state, 0), false);
  for (let i = 0; i < 5; i++) engine.update(state, 50);
  assert.equal(box.z, z); assert.equal(state.distance, distance);
  for (let i = 0; i < 24; i++) engine.update(state, 50);
  assert.ok(box.z < 0); assert.equal(state.lane, 1); assert.equal(state.action, 'run'); assert.equal(state.hearts, 2);
});

test('assistance selects one physically valid maneuver for jump, forced duck, and two adjacent crates', () => {
  for (const speed of [14, 32]) for (const types of [['wall', 'low', 'wall'], ['wall', 'duckwall', 'wall'], ['wall', 'overhead', 'wall'], ['wall', 'wall', 'low']]) {
    const state = make(); state.distance = (speed - 14) * 70;
    types.forEach((obstacleType, lane) => entity(state, { kind: 'obstacle', obstacleType, lane }));
    engine.update(state, 50); const plan = state.impact.plan;
    assert.ok(plan, types.join(',')); assert.notEqual(types[plan.lane], 'wall');
    assert.equal(plan.action, types[plan.lane] === 'low' ? 'jump' : 'slide');
    for (let i = 0; i < 5; i++) engine.update(state, 50);
    assert.equal(state.lane, plan.lane); assert.equal(state.action, plan.action);
    for (let i = 0; i < 20; i++) engine.update(state, 50);
    assert.equal(state.hearts, 2); assert.equal(state.action, 'run');
    assert.equal(engine.move(state, state.lane === 0 ? 1 : 0), true, 'control returns to the player');
  }
});

test('truck side entry recoils without losing a heart; the forward ramp and leaving the roof remain usable', () => {
  const state = make(), truck = entity(state, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 2, z: -8, resolved: true });
  assert.equal(engine.move(state, 2), false); assert.equal(state.lane, 1); assert.equal(state.hearts, 3); assert.equal(state.impact.kind, 'side');
  for (let i = 0; i < 3; i++) engine.update(state, 50);
  truck.z = 5; assert.equal(engine.move(state, 2), true);
  for (let i = 0; i < 18; i++) engine.update(state, 50);
  assert.ok(engine.getPose(state).floor > 0); assert.equal(engine.move(state, 1), true); assert.equal(engine.getPose(state).floor, 0);
});

test('assistance never mounts an adjacent truck side or chooses an impossible all-crate escape', () => {
  const state = make();
  entity(state, { kind: 'obstacle', obstacleType: 'wall', lane: 0 });
  entity(state, { kind: 'obstacle', obstacleType: 'wall', lane: 1 });
  entity(state, { kind: 'obstacle', obstacleType: 'train', lane: 2, length: 20, z: -8, resolved: true });
  engine.update(state, 50); assert.equal(state.impact.plan, null);
});

test('normal hazards spawn in the distant fog range within the fixed pool', () => {
  const state = make([]); state._nextRowAt = 0; engine.update(state, 50);
  assert.ok(engine.constants.SPAWN_Z > 80); assert.ok(engine.constants.FAR > engine.constants.SPAWN_Z);
  assert.ok(state.entities.every(item => item.z >= engine.constants.SPAWN_Z));
  assert.equal(state.entities.length + state._pool.length, 48);
});

test('short tunnels contain no hazards; long tunnels seed hazards behind a safe entry and before the exit', () => {
  let shorts = 0, longs = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const state = engine.createState(words, { random: seeded(seed) }); state.distance = 1500; state._nextGateAt = 0;
    engine.update(state, 50); const gate = state.gate;
    const hazards = state.entities.filter(item => item.kind === 'obstacle');
    if (gate.length < engine.constants.LONG_TUNNEL_MIN) { shorts++; assert.equal(hazards.length, 0); }
    else { longs++; assert.ok(hazards.length > 0); for (const item of hazards) { assert.ok(item.z - gate.z >= 40); assert.ok(gate.z + gate.length - item.z >= 24); } }
  }
  assert.ok(shorts && longs);
});
