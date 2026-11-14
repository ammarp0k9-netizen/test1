import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = {};
vm.runInNewContext(await readFile(new URL('../js/runner-engine.js', import.meta.url), 'utf8'), { window: root });
vm.runInNewContext(await readFile(new URL('../js/runner-maps.js', import.meta.url), 'utf8'), { window: root });
const engine = root.LootLinguaRunnerEngine;
const words = [{ word: 'apple', meaning: 'تفاحة' }, { word: 'book', meaning: 'كتاب' }, { word: 'sun', meaning: 'شمس' }, { word: 'moon', meaning: 'قمر' }];
const copy = value => structuredClone(value);
function seeded(seed = 42) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function make(pool = words) { const state = engine.createState(pool, { random: seeded() }); state._nextRowAt = Infinity; state._nextGateAt = Infinity; return state; }
function entity(state, values) { const item = state._pool.pop(); Object.assign(item, { id: state._nextId++, resolved: false, z: .1, lane: 1 }, values); state.entities.push(item); return item; }

test('map rotation starts in the selected map and changes only deep inside a separate tunnel', () => {
  const state = make([]);
  const maps = root.LootLinguaRunnerMaps.maps.map(map => map.id);
  assert.equal(maps.length, 7);
  assert.ok(maps.includes('classic'));
  engine.configureMaps(state, 'forest', maps);
  const visited = new Set([state.mapId]);
  const { MAP_INTERVAL_MIN, MAP_INTERVAL_MAX, MAP_SWITCH_DEPTH } = engine.constants;
  assert.equal(state.mapId, 'forest');
  let arrivals = 0;
  for (let step = 0; step < 9000 && arrivals < maps.length - 1; step++) {
    const previous = state.mapId;
    engine.update(state, 50);
    assert.ok(state._nextMapAt >= MAP_INTERVAL_MIN && state._nextMapAt <= MAP_INTERVAL_MAX);
    if (state.mapTunnel) assert.ok(state._mapTime >= 34000);
    for (const event of state.events) if (event.type === 'map-arrival') {
      assert.equal(event.mapId, state.mapId);
      assert.ok(state.mapTunnel.changed && state.mapTunnel.z + state.mapTunnel.length <= 14);
      arrivals++;
    }
    if (state.mapId === previous) continue;
    assert.ok(state.mapTunnel?.z <= MAP_SWITCH_DEPTH && state.mapTunnel.z + state.mapTunnel.length > 54);
    assert.equal(state.mapTunnel.mapId, previous);
    assert.equal(state.events.some(event => event.type === 'map-arrival'), false);
    assert.ok(!visited.has(state.mapId));
    visited.add(state.mapId);
  }
  assert.equal(visited.size, maps.length);
  assert.equal(arrivals, maps.length - 1);
});

test('a fixed map persists and even an overdue question leaves a stretch of outdoor running after a travel tunnel', () => {
  const fixed = make();
  engine.configureMaps(fixed, 'harbor');
  for (let i = 0; i < 1000; i++) engine.update(fixed, 50);
  assert.equal(fixed.mapId, 'harbor');
  assert.equal(fixed.mapTunnel, null);
  engine.configureMaps(fixed, 'summit', ['summit', 'desert']);
  fixed._mapTime = fixed._nextMapAt;
  fixed._nextGateAt = fixed.elapsed + 8500;
  engine.update(fixed, 50);
  assert.equal(fixed.mapTunnel?.kind, 'passage');
  // Simulate a question becoming due while the travel tunnel is active.
  fixed._nextGateAt = fixed.elapsed;
  for (let i = 0; i < 500; i++) {
    engine.update(fixed, 50);
    if (!fixed.mapTunnel) break;
    assert.equal(fixed.gate, null);
  }
  assert.equal(fixed.mapId, 'desert');
  const { TUNNEL_GAP_MS } = engine.constants;
  for (let duration = 0; duration < TUNNEL_GAP_MS; duration += 50) {
    engine.update(fixed, 50);
    assert.equal(fixed.gate, null);
  }
  engine.update(fixed, 50);
  assert.equal(fixed.gate?.kind, 'gate');
  assert.equal(fixed.gate.mapId, 'desert');
  assert.equal(fixed.gate.destination, undefined);
});

test('a nearby map change can share a question tunnel, preserving answers and revealing the new map once', () => {
  const state = make();
  engine.configureMaps(state, 'forest', ['forest', 'volcano']);
  state._mapTime = state._nextMapAt;
  state._nextGateAt = 800;
  engine.update(state, 50);
  assert.equal(state.mapTunnel, null);
  assert.equal(state.gate, null);
  state._random = () => 0;
  while (!state.gate) engine.update(state, 50);
  const gate = state.gate;
  assert.equal(gate.destination, 'volcano');
  assert.equal(gate.mapId, 'forest');
  assert.ok(gate.length >= 92);
  assert.equal(state.mapId, 'forest');
  assert.equal(state.mapTunnel, null);
  engine.move(state, gate.correctLane);
  let answers = 0;
  let arrivals = 0;
  while (state.gate) {
    engine.update(state, 50);
    for (const event of state.events) {
      if (event.type === 'gate') {
        assert.equal(event.correct, true);
        assert.equal(state.mapId, 'forest');
        answers++;
      } else if (event.type === 'map-arrival') {
        assert.ok(gate.resolved && gate.changed && gate.z + gate.length <= 14);
        assert.equal(event.mapId, 'volcano');
        arrivals++;
      }
    }
  }
  assert.equal(answers, 1);
  assert.equal(arrivals, 1);
  assert.equal(state.mapId, 'volcano');
  assert.equal(state._mapTime, 0);
  assert.equal(state._outdoorSinceTunnel, 0);
});

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

test('a wrong gate reports feedback first and loses a heart only on its physical crate', () => {
  const state = make(), gate = entity(state, { ...engine.createWordGate(state), z: .1, correctLane: 0 }); state.gate = gate;
  engine.update(state, 50); assert.equal(state.hearts, 3); assert.equal(state.feedback.correct, false);
  assert.equal(state.feedback.correctMeaning, gate.correctMeaning); assert.equal(state.feedback.chosenLane, 1);
  assert.equal(state.entities.filter(item => item.gateBarrier).length, 2);
  assert.equal(engine.move(state, 0), false);
  for (let i = 0; i < 12 && state.hearts === 3; i++) engine.update(state, 50);
  assert.equal(state.hearts, 2); assert.equal(gate.entryReleased, true); assert.equal(state.impact.kind, 'hit');
  for (let i = 0; i < 4; i++) engine.update(state, 50);
  assert.equal(state.lane, 0, 'recovery can reach the correct route after the crate collision');
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
  for (let index = 0; index < 60; index++) { engine.update(state, 50); assert.ok(state.entities.every(item => item.kind !== 'obstacle' || item.gateBarrier || item.z > state.gate.z + 10)); }
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

test('even at maximum speed, crossing a short gate leaves over three seconds before the next hazard', () => {
  const state = engine.createState(words, { random: seeded() });
  state._tunnelLengths = [engine.constants.TUNNEL_LENGTH];
  state.distance = 100000; state._nextGateAt = 0;
  engine.update(state, 50);
  for (let frame = 0; frame < 80; frame++) {
    engine.update(state, 50);
    assert.ok(state.entities.every(item => item.kind !== 'obstacle' || item.gateBarrier));
  }
  const shift = .1 - state.gate.z; for (const item of state.entities) item.z += shift;
  state.lane = state.gate.correctLane; engine.update(state, 50);
  for (let frame = 0; frame < 60; frame++) {
    engine.update(state, 50);
    assert.ok(state.entities.every(item => item.kind !== 'obstacle' || item.gateBarrier || item.z > 0));
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

test('short tunnels contain no hazards; long tunnels seed hazards behind a safe entry', () => {
  let shorts = 0, longs = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const state = engine.createState(words, { random: seeded(seed) }); state.distance = 1500; state._nextGateAt = 0;
    engine.update(state, 50); const gate = state.gate;
    const hazards = state.entities.filter(item => item.kind === 'obstacle' && !item.gateBarrier);
    if (gate.length < engine.constants.LONG_TUNNEL_MIN) { shorts++; assert.equal(hazards.length, 0); }
    else { longs++; assert.ok(hazards.length > 0); for (const item of hazards) { assert.ok(item.z - gate.z >= 40); assert.ok(gate.z + gate.length - item.z >= 24); } }
  }
  assert.ok(shorts && longs);
});

test('long tunnel exits do not reserve an empty obstacle-free zone', () => {
  const state = make([]); state.distance = 1500; state._nextRowAt = 0;
  state.gate = entity(state, { kind: 'gate', z: -158, length: 256, resolved: true });
  engine.update(state, 50);
  const obstacles = state.entities.filter(item => item.kind === 'obstacle');
  assert.ok(obstacles.length > 0);
  assert.ok(obstacles.some(item => item.tunnelId === state.gate.id && state.gate.z + state.gate.length - item.z < 24));
});

test('recently passed obstacle bodies reject lateral entry without damage, then release after shoulder clearance', () => {
  for (const obstacleType of ['wall', 'low', 'overhead', 'duckwall']) {
    const state = make(); const item = entity(state, { kind: 'obstacle', obstacleType, lane: 2, z: -1.5, resolved: true });
    assert.equal(engine.move(state, 2), false, obstacleType); assert.equal(state.hearts, 3); assert.equal(state.lane, 1);
    assert.equal(state.impact.kind, 'side');
    for (let i = 0; i < 6; i++) engine.update(state, 50);
    assert.ok(item.z < -3.2); assert.equal(engine.move(state, 2), true);
  }
  const state = make(); state.lane = 0;
  entity(state, { kind: 'obstacle', obstacleType: 'wall', lane: 1, z: -1, resolved: true });
  assert.equal(engine.move(state, 2), false, 'cannot skip a solid intermediate lane');
});

test('formation routes do not require lateral entry into a still occupied preceding body', () => {
  const state = engine.createState([], { random: seeded(91) }); state.invulnerableUntil = Infinity;
  for (let frame = 0; frame < 5000; frame++) {
    const row = state._row, previous = state._escapeLane;
    engine.update(state, 50);
    if (state._row === row || state._escapeLane === previous) continue;
    for (const item of state.entities) {
      if (item.kind !== 'obstacle' || item.row === state._row || item.lane !== state._escapeLane) continue;
      const z = item.z - engine.constants.SPAWN_Z;
      const blocks = item.obstacleType === 'train' ? z <= 0 && z + item.length + engine.constants.VEHICLE_EXIT > 0 : z <= .7 && z >= -3.2;
      assert.equal(blocks, false, `row ${state._row} route enters ${item.obstacleType}`);
    }
  }
});

test('tunnel lengths include shuffled short and extended passages, including long first tunnels', () => {
  const firsts = new Set();
  for (let seed = 1; seed < 30; seed++) firsts.add(engine.createWordGate(engine.createState(words, { random: seeded(seed) })).length);
  assert.ok([...firsts].some(length => length >= 384)); assert.ok([...firsts].some(length => length < 240));
  const state = make(), lengths = new Set(Array.from({ length: 6 }, () => engine.createWordGate(state).length));
  assert.equal(lengths.size, 6);
});

test('truck transfers require real source support, not a street jump or a skipped empty lane', () => {
  const state = make();
  entity(state, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 1, z: -10, resolved: true });
  entity(state, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 2, z: -14, resolved: true });
  assert.equal(engine.move(state, 2), true); assert.equal(engine.getPose(state).floor, 1.05);
  assert.equal(engine.move(state, 1), true);
  const street = make();
  entity(street, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 2, z: -10, resolved: true });
  engine.jump(street); street.elapsed = engine.constants.JUMP_MS / 2;
  assert.ok(engine.getPose(street).feet > 1.05); assert.equal(engine.move(street, 2), false);
  const gap = make(); gap.lane = 0;
  for (const lane of [0, 2]) entity(gap, { kind: 'obstacle', obstacleType: 'train', length: 20, lane, z: -10, resolved: true });
  assert.equal(engine.move(gap, 2), false, 'cannot teleport over an unsupported middle lane');
  const slope = make();
  entity(slope, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 1, z: -10, resolved: true });
  entity(slope, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 2, z: -3, resolved: true });
  assert.equal(engine.move(slope, 2), true, 'can step down onto an overlapping loading ramp');
  assert.equal(engine.move(slope, 1), false, 'cannot climb the high roof from the low ramp side');
});

test('runner presents the planned words once per cycle and avoids a repeat at the boundary', () => {
  const words = [{ word: 'bridge', meaning: 'جسر' }, { word: 'river', meaning: 'نهر' },
    { word: 'lantern', meaning: 'فانوس' }, { word: 'Bridge', meaning: 'معبر' }];
  const state = engine.createState(words, { random: () => 0, orderedPrompts: true });
  const first = Array.from({ length: 3 }, () => engine.createWordGate(state).word);
  const second = Array.from({ length: 3 }, () => engine.createWordGate(state).word);
  assert.deepEqual(first, ['bridge', 'river', 'lantern']);
  assert.equal(new Set(second).size, 3);
  assert.notEqual(second[0], first[2]);
});

test('a timed jump can land on a truck ramp and a roof jump clears the height difference', () => {
  const state = make();
  entity(state, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 2, z: -3, resolved: true });
  assert.equal(engine.jump(state), true);
  state.elapsed = engine.constants.JUMP_MS / 2;
  assert.equal(engine.move(state, 2), true);
  assert.ok(engine.getPose(state).feet >= .525);
  const roof = make();
  entity(roof, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 1, z: -3, resolved: true });
  entity(roof, { kind: 'obstacle', obstacleType: 'train', length: 20, lane: 2, z: -10, resolved: true });
  assert.equal(engine.jump(roof), true);
  roof.elapsed = engine.constants.JUMP_MS / 2;
  assert.equal(engine.move(roof, 2), true);
});

test('entry locks cannot bypass a wrong-route crate, even mid-jump or during invulnerability; assist off still passes after impact', () => {
  for (const speed of [14, 32]) {
    const state = make(); state.distance = (speed - 14) * 70; state.autoRecovery = false; state.invulnerableUntil = Infinity;
    engine.jump(state);
    state.gate = entity(state, { ...engine.createWordGate(state), correctLane: 0, z: 2.4 });
    assert.equal(engine.move(state, 0), false); assert.equal(engine.slide(state), false);
    let hit = false;
    for (let frame = 0; frame < 40 && !hit; frame++) {
      assert.equal(engine.move(state, 0), false);
      engine.update(state, 50); hit = state.hearts < 3;
      if (!hit && state.gate.resolved) assert.equal(state.hearts, 3, 'the answer itself does not remove a heart');
    }
    assert.ok(hit); assert.equal(state.hearts, 2); assert.equal(state.gate.entryReleased, true); assert.equal(state.impact.plan, null);
    for (let frame = 0; frame < 30; frame++) engine.update(state, 50);
    assert.equal(state.lane, 1); assert.equal(state.hearts, 2);
    assert.equal(state.entities.length + state._pool.length, 48);
  }
});

test('correct gates keep a clear entry, release controls beyond the blockers and never charge a heart', () => {
  const state = make(); state.gate = entity(state, { ...engine.createWordGate(state), correctLane: 1, z: .1 });
  engine.update(state, 50); assert.equal(state.feedback.correct, true);
  assert.equal(engine.move(state, 0), false);
  const blockers = state.entities.filter(item => item.gateBarrier);
  assert.equal(blockers.length, 2); assert.ok(blockers.every(item => item.lane !== 1 && item.obstacleType === 'wall'));
  for (let frame = 0; frame < 20; frame++) engine.update(state, 50);
  assert.equal(state.hearts, 3); assert.equal(state.gate.entryReleased, true); assert.equal(engine.move(state, 0), true);
});
