(function(root) {
  'use strict';
  const LANES = 3, MAX_HEARTS = 3, MAX_ENTITIES = 48, MAX_EVENTS = 16;
  const FAR = 112, SPAWN_Z = 96, GATE_SPAWN_Z = 64, BASE_SPEED = 14, MAX_SPEED = 32;
  const NEAR = -15, VEHICLE_HEIGHT = 1.05, VEHICLE_RAMP = 6, VEHICLE_EXIT = 3;
  const TUNNEL_LENGTH = 42, LONG_TUNNEL_MIN = 240, MIN_ROW_MS = 780;
  const IMPACT_FREEZE_MS = 260, RECOVERY_START_MS = 140;
  const GATE_BLOCKER_OFFSET = 6, GATE_COMMIT_Z = 2.5;
  const MAP_INTERVAL_MIN = 16000, MAP_INTERVAL_MAX = 24000, MAP_TUNNEL_LENGTH = 72, MAP_SWITCH_DEPTH = -28;
  const MAX_VEHICLE_LENGTH = 20;
  // Templates describe relationships, then lanes are shuffled. A truck can
  // accompany any normal hazard, not just another truck.
  const FORMATIONS = [
    ['train', 'wall', null], ['train', 'low', null], ['train', 'overhead', null],
    ['train', 'wall', 'wall'], ['train', 'low', 'wall'], ['train', 'overhead', 'wall'],
    ['train', 'low', 'overhead'], ['train', 'train', null], ['train', 'train', 'low'],
    ['train', 'train', 'overhead'], ['train', 'train', 'wall'], ['train', 'train', 'train'],
    ['train', 'duckwall', null], ['train', 'duckwall', 'low'], ['train', 'train', 'duckwall'],
    ['duckwall', 'wall', 'low'], ['duckwall', 'overhead', 'train'],
  ];
  const JUMP_MS = 640, SLIDE_MS = 480, ACTION_RECOVERY_MS = 70, INPUT_BUFFER_MS = 140, INVULNERABLE_MS = 1100;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');

  function normalizeWords(words) {
    const seen = new Set();
    return (Array.isArray(words) ? words : []).map(item => ({
      word: clean(item?.word || item?.term),
      meaning: clean(item?.translation || item?.meaning || item?.ar || item?.definition),
    })).filter(item => {
      const key = item.word.toLowerCase() + '\u0000' + item.meaning;
      if (!item.word || !item.meaning || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function random(state) { return clamp(Number(state._random()) || 0, 0, 1 - Number.EPSILON); }
  function choose(state, values) { return values[Math.floor(random(state) * values.length)]; }
  function emit(state, event) {
    if (state.events.length < MAX_EVENTS) state.events.push(event);
  }
  function createState(words, options = {}) {
    const normalized = normalizeWords(words);
    const rng = typeof options.random === 'function' ? options.random : Math.random;
    return {
      words: normalized, lane: 1, hearts: MAX_HEARTS, coins: 0,
      distance: 0, speed: BASE_SPEED, elapsed: 0, running: true, paused: false, over: false,
      action: 'run', actionStartedAt: 0, actionUntil: 0, invulnerableUntil: 0,
      autoRecovery: options.autoRecovery !== false, impact: null, _sideBumpUntil: 0,
      entities: [], gate: null, feedback: null, events: [],
      _random: rng, _gateLanes: [], _lastGateLane: -1, _queuedAction: null, _formationBag: [], _tunnelLengths: [],
      _promptDeck: [], _lastPrompt: '', _playedPromptCycle: false, _orderedPrompts: options.orderedPrompts === true,
      jumpOrigin: 0,
      _pool: Array.from({ length: MAX_ENTITIES }, () => ({})), _nextId: 1,
      _nextRowAt: 400, _nextGateAt: 30000 + Math.floor(clamp(Number(rng()) || 0, 0, 1) * 12000), _row: 0, _escapeLane: 1, _safeUntil: 0,
      _canGate: new Set(normalized.map(item => item.meaning)).size >= LANES,
      mapId: 'classic', mapTunnel: null, _mapOrder: [], _mapChoices: [], _nextMapAt: Infinity, _mapTime: 0,
    };
  }
  function configureMaps(state, mapId, rotation = []) {
    state.mapId = mapId;
    state._mapChoices = [...new Set(rotation)];
    state._mapOrder = [];
    state._mapTime = 0;
    state._nextMapAt = state._mapChoices.length > 1 ? mapInterval(state) : Infinity;
  }
  function mapInterval(state) {
    return MAP_INTERVAL_MIN + random(state) * (MAP_INTERVAL_MAX - MAP_INTERVAL_MIN);
  }
  function maybeMapTunnel(state) {
    if (state.gate || state.mapTunnel || state._mapTime < state._nextMapAt) return;
    if (!state._mapOrder.length) {
      state._mapOrder = state._mapChoices.filter(id => id !== state.mapId);
      for (let i = state._mapOrder.length - 1; i > 0; i--) {
        const j = Math.floor(random(state) * (i + 1));
        [state._mapOrder[i], state._mapOrder[j]] = [state._mapOrder[j], state._mapOrder[i]];
      }
    }
    state.mapTunnel = { kind: 'passage', z: SPAWN_Z, length: MAP_TUNNEL_LENGTH, mapId: state.mapId, destination: state._mapOrder.pop(), changed: false };
  }
  function usable(state) { return state.running && !state.paused && !state.over; }
  function getAction(state, at = state.elapsed) {
    return state.action !== 'run' && at >= state.actionStartedAt && at < state.actionUntil ? state.action : 'run';
  }
  function move(state, lane) {
    const value = Number(lane);
    if (!usable(state) || !Number.isFinite(value) || gateEntryLocked(state) || state.impact && state.elapsed < state.impact.freezeUntil) return false;
    const next = clamp(Math.round(value), 0, LANES - 1);
    if (next === state.lane) return false;
    if (!lanePathOpen(state, next)) {
      if (state.elapsed >= state._sideBumpUntil) {
        state.impact = { kind: 'side', direction: Math.sign(next - state.lane), startedAt: state.elapsed, freezeUntil: state.elapsed + 90, endAt: state.elapsed + 320, applied: true };
        state._sideBumpUntil = state.elapsed + 420;
        state._nextRowAt += 90; state._nextGateAt += 90;
        emit(state, { type: 'side-bump' });
      }
      return false;
    }
    state.lane = next; return true;
  }
  function startAction(state, action, duration) {
    if (!usable(state) || gateEntryLocked(state) || state.impact && state.elapsed < state.impact.freezeUntil) return false;
    const current = getAction(state);
    // Jump cancels a crouch; airborne input never resets the jump arc.
    if (current !== 'run' && !(current === 'slide' && action === 'jump')) {
      if (state.actionUntil - state.elapsed > INPUT_BUFFER_MS || state._queuedAction) return false;
      state._queuedAction = action; return true;
    }
    if (current === 'run' && state.elapsed < state.actionUntil + ACTION_RECOVERY_MS && state.actionUntil > 0) {
      if (state._queuedAction) return false;
      state._queuedAction = action; return true;
    }
    state._queuedAction = null;
    state.jumpOrigin = action === 'jump' ? getPose(state).floor : 0;
    state.action = action; state.actionStartedAt = state.elapsed; state.actionUntil = state.elapsed + duration;
    return true;
  }
  function jump(state) { return startAction(state, 'jump', JUMP_MS); }
  function slide(state) { return startAction(state, 'slide', SLIDE_MS); }
  function vehicleSurface(entity, z = entity.z) {
    const position = -z, length = Number(entity.length) || 20;
    if (position < 0 || position > length + VEHICLE_EXIT) return 0;
    return VEHICLE_HEIGHT * Math.max(0, Math.min(1, position / VEHICLE_RAMP, (length + VEHICLE_EXIT - position) / VEHICLE_EXIT));
  }
  function lanePathOpen(state, lane) {
    const direction = Math.sign(lane - state.lane);
    if (!direction) return true;
    // Provenance comes from an actual vehicle surface underneath the
    // current lane, never from jump height above the street.
    let support = state.entities.reduce((floor, item) => item.obstacleType === 'train' && item.lane === state.lane ? Math.max(floor, vehicleSurface(item)) : floor, 0);
    const pose = getPose(state);
    for (let step = state.lane + direction; direction > 0 ? step <= lane : step >= lane; step += direction) {
      const trucks = state.entities.filter(item => item.obstacleType === 'train' && item.lane === step && sideOccupied(item, item.z));
      const targetSupport = trucks.reduce((floor, item) => Math.max(floor, vehicleSurface(item)), 0);
      const roofJump = support > 0 && pose.action === 'jump' && pose.feet >= targetSupport;
      const rampJump = step === state.lane + direction && step === lane && pose.action === 'jump' &&
        trucks.every(item => -item.z <= VEHICLE_RAMP) && pose.feet >= targetSupport + .15;
      if (trucks.length && (!targetSupport || ((!support || targetSupport > support + .08) && !roofJump && !rampJump))) return false;
      support = targetSupport;
      if (state.entities.some(entity => entity.kind === 'obstacle' && entity.obstacleType !== 'train' && entity.lane === step && sideOccupied(entity, entity.z) && !clearsObstacle(entity.obstacleType, pose))) return false;
    }
    return true;
  }
  function sideOccupied(entity, z) {
    // Keep the body and a small shoulder clearance solid after the crossing.
    // Resolved means scored, not that the physical obstacle has disappeared.
    return entity.obstacleType === 'train' ? z <= 0 && z + entity.length + VEHICLE_EXIT > 0 : z <= .7 && z >= -3.2;
  }
  function clearsObstacle(type, pose) {
    return type === 'train' || type === 'duckwall' && pose.action === 'slide' && pose.top <= .55 ||
      type === 'low' && pose.feet >= .37 || type === 'overhead' && (pose.top <= .6 || pose.feet >= .88) || type === 'wall' && pose.feet >= 1.4;
  }
  function chooseRecovery(state, collided) {
    const speed = Math.max(BASE_SPEED, state.speed), freezeEnd = state.elapsed + IMPACT_FREEZE_MS;
    const actions = collided.obstacleType === 'overhead' || collided.obstacleType === 'duckwall' ? ['slide', 'jump', 'run'] : ['jump', 'run', 'slide'];
    let best = null;
    for (let lane = 0; lane < LANES; lane++) {
      if (!lanePathOpen(state, lane)) continue;
      for (const action of actions) {
        const duration = action === 'jump' ? JUMP_MS : action === 'slide' ? SLIDE_MS : 0;
        const simulated = { ...state, lane, elapsed: freezeEnd, action, actionStartedAt: state.elapsed + RECOVERY_START_MS, actionUntil: state.elapsed + RECOVERY_START_MS + duration };
        let safe = true, risk = 0;
        for (const entity of state.entities) {
          if (entity.kind !== 'obstacle' || entity.lane !== lane || entity.z < -1 || entity.z > speed * .9) continue;
          const at = freezeEnd + Math.max(0, entity.z) / speed * 1000;
          if (!clearsObstacle(entity.obstacleType, getPose(simulated, at))) {
            if (entity === collided || entity.obstacleType === 'wall' || entity.z <= speed * .5) { safe = false; break; }
            risk += 4;
          }
        }
        const cost = Math.abs(lane - state.lane) * 2 + (action === 'run' ? 0 : 1) + risk;
        if (safe && (!best || cost < best.cost)) best = { lane, action, cost };
      }
    }
    return best;
  }
  // Shared by collision and drawing: heights are measured in standing bodies.
  function getPose(state, at = state.elapsed) {
    const action = getAction(state, at);
    const fraction = clamp((at - state.actionStartedAt) / Math.max(1, state.actionUntil - state.actionStartedAt), 0, 1);
    let floor = 0;
    for (const entity of state.entities) {
      if (entity.obstacleType !== 'train' || entity.lane !== state.lane) continue;
      const z = entity.z + state.speed * (state.elapsed - at) / 1000;
      floor = Math.max(floor, vehicleSurface(entity, z));
    }
    const lift = action === 'jump' ? Math.sin(fraction * Math.PI) * 1.12 : 0;
    const takeoff = Number(state.jumpOrigin) || 0;
    const feet = action === 'jump' ? Math.max(floor, takeoff + (floor - takeoff) * fraction + lift) : floor;
    return { action, feet, top: feet + (action === 'slide' ? .43 : 1), floor, lift: Math.max(0, feet - floor), fraction };
  }
  function allocate(state, data) {
    const entity = state._pool.pop();
    if (!entity) return null;
    for (const key of Object.keys(entity)) delete entity[key];
    Object.assign(entity, { id: state._nextId++, active: true, resolved: false, bornAt: state.elapsed }, data);
    state.entities.push(entity); return entity;
  }
  function retire(state, index) {
    const [entity] = state.entities.splice(index, 1);
    entity.active = false;
    if (state.gate === entity) state.gate = null;
    state._pool.push(entity);
  }
  function createWordGate(state) {
    const meanings = new Set(state.words.map(item => item.meaning));
    if (meanings.size < LANES) return null;
    if (!state._promptDeck.length) {
      const seen = new Set();
      state._promptDeck = state.words.filter(item => {
        const key = item.word.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!state._orderedPrompts || state._playedPromptCycle) {
        for (let i = state._promptDeck.length - 1; i > 0; i--) {
          const other = Math.floor(random(state) * (i + 1));
          [state._promptDeck[i], state._promptDeck[other]] = [state._promptDeck[other], state._promptDeck[i]];
        }
      }
      if (state._promptDeck.length > 1 && state._promptDeck[0].word.toLowerCase() === state._lastPrompt) {
        state._promptDeck.push(state._promptDeck.shift());
      }
      state._playedPromptCycle = true;
    }
    const prompt = state._promptDeck.shift();
    state._lastPrompt = prompt.word.toLowerCase();
    const alternatives = [...meanings].filter(meaning => meaning !== prompt.meaning);
    const first = choose(state, alternatives);
    const second = choose(state, alternatives.filter(meaning => meaning !== first));
    if (!state._gateLanes.length) {
      state._gateLanes = [0, 1, 2];
      for (let index = 2; index > 0; index--) {
        const other = Math.floor(random(state) * (index + 1));
        [state._gateLanes[index], state._gateLanes[other]] = [state._gateLanes[other], state._gateLanes[index]];
      }
      if (state._gateLanes[0] === state._lastGateLane) [state._gateLanes[0], state._gateLanes[1]] = [state._gateLanes[1], state._gateLanes[0]];
    }
    const correctLane = state._gateLanes.shift();
    state._lastGateLane = correctLane;
    const options = [first, second];
    for (let index = options.length - 1; index > 0; index--) {
      const other = Math.floor(random(state) * (index + 1));
      [options[index], options[other]] = [options[other], options[index]];
    }
    options.splice(correctLane, 0, prompt.meaning);
    if (!state._tunnelLengths.length) {
      state._tunnelLengths = [TUNNEL_LENGTH, 64, 256, 320, 384, 448];
      for (let i = state._tunnelLengths.length - 1; i > 0; i--) {
        const other = Math.floor(random(state) * (i + 1));
        [state._tunnelLengths[i], state._tunnelLengths[other]] = [state._tunnelLengths[other], state._tunnelLengths[i]];
      }
    }
    const length = state._tunnelLengths.pop();
    return { kind: 'gate', lane: 1, z: GATE_SPAWN_Z, length, word: prompt.word,
      options, correctLane: options.indexOf(prompt.meaning), correctMeaning: prompt.meaning };
  }
  function hasGateWords(state) { return state._canGate; }
  function prepareGateBarriers(state, gate) {
    if (gate.barriersCreated) return;
    // Reserve both wrong routes together; allocation never grows the pool.
    for (let i = state.entities.length - 1; state._pool.length < 2 && i >= 0; i--) {
      if (state.entities[i].kind === 'coin' && state.entities[i].z > 0) retire(state, i);
    }
    if (state._pool.length < 2) return;
    for (let lane = 0; lane < LANES; lane++) if (lane !== gate.correctLane) {
      allocate(state, { kind: 'obstacle', obstacleType: 'wall', lane, z: gate.z + GATE_BLOCKER_OFFSET,
        length: 0, gateBarrier: true, gateId: gate.id });
    }
    gate.barriersCreated = true;
  }
  function gateEntryLocked(state) {
    const gate = state.gate;
    if (!gate || gate.entryReleased || gate.z > GATE_COMMIT_Z) return false;
    if (gate.entryLane == null) { gate.entryLane = state.lane; state._queuedAction = null; }
    return true;
  }
  function maybeGate(state) {
    if (state.elapsed < state._nextGateAt || state.gate || state.mapTunnel || !hasGateWords(state)) return;
    const data = createWordGate(state);
    const gate = data && allocate(state, data);
    if (!gate) return;
    // The scheduler drains obstacle rows before a reading gate. This guard also
    // protects restored/debug states from placing an obstacle in the read zone.
    for (let index = state.entities.length - 1; index >= 0; index--) {
      const entity = state.entities[index];
      if (entity.kind === 'obstacle' && entity.z > 0) retire(state, index);
    }
    state.gate = gate;
    prepareGateBarriers(state, gate);
    if (gate.length >= LONG_TUNNEL_MIN) {
      state._escapeLane = gate.correctLane;
      spawnRow(state, gate.z + 48);
      spawnRow(state, gate.z + 80);
    }
    state._nextGateAt = state.elapsed + 30000 + random(state) * 18000;
    emit(state, { type: 'gate-approach', id: gate.id, word: gate.word });
  }
  function spawnRow(state, seededZ = null) {
    const seeded = Number.isFinite(seededZ);
    if (!seeded && (state.elapsed < state._nextRowAt || state.elapsed < state._safeUntil)) return;
    const reading = state.gate && !state.gate.resolved && !seeded;
    const clearance = SPAWN_Z / state.speed * 1000 + 350;
    // Do not queue hidden hazards behind the reading veil: returning to full
    // speed would compress their spacing and reveal them too close together.
    const spawnZ = seeded ? seededZ : SPAWN_Z;
    const passage = state.gate || state.mapTunnel;
    // A vehicle spawned before the entrance must clear the tunnel with its
    // complete ramp and roof. Reserve that space while the approach moves in.
    const intersectsTravel = passage?.kind === 'passage' && spawnZ + MAX_VEHICLE_LENGTH + VEHICLE_EXIT >= passage.z && spawnZ <= passage.z + passage.length;
    const insideTunnel = passage && spawnZ >= passage.z && spawnZ <= passage.z + passage.length;
    const tunnelSafe = !insideTunnel || passage.length >= LONG_TUNNEL_MIN && spawnZ - passage.z >= 40;
    const draining = reading || intersectsTravel || !tunnelSafe || !seeded && hasGateWords(state) && state._nextGateAt - state.elapsed < clearance;
    const escapeOptions = [0, 1, 2].filter(lane => Math.abs(lane - state._escapeLane) <= 1 && (lane === state._escapeLane || !state.entities.some(item => item.kind === 'obstacle' && item.lane === lane && sideOccupied(item, item.z - spawnZ))));
    const escape = choose(state, escapeOptions);
    const blocked = [0, 1, 2].filter(lane => lane !== escape);
    if (random(state) > .5) blocked.reverse();
    const difficulty = clamp((state.distance - 180) / 1600, 0, 1);
    const fullRow = state.distance > 240 && random(state) < .15 + difficulty * .5;
    const obstacleCount = fullRow ? 3 : state.distance > 120 && random(state) < .6 + difficulty * .35 ? 2 : 1;
    if (fullRow) blocked.push(escape);
    if (state._pool.length < 12) return;
    const row = ++state._row;
    let layout = [null, null, null], route = escape;
    const occupiedByTruck = lane => state.entities.some(item => item.obstacleType === 'train' && item.lane === lane && item.z > -(item.length + VEHICLE_EXIT));
    if (!draining && state.distance > 160 && random(state) < .28 + difficulty * .12 && !state.entities.some(item => item.obstacleType === 'train' && item.z > -(item.length + VEHICLE_EXIT))) {
      if (!state._formationBag.length) {
        state._formationBag = FORMATIONS.map((_, index) => index).filter(index => state.distance > 500 || index < 8);
        for (let i = state._formationBag.length - 1; i > 0; i--) {
          const other = Math.floor(random(state) * (i + 1));
          [state._formationBag[i], state._formationBag[other]] = [state._formationBag[other], state._formationBag[i]];
        }
      }
      layout = FORMATIONS[state._formationBag.pop()].slice();
      for (let i = 2; i > 0; i--) {
        const other = Math.floor(random(state) * (i + 1));
        [layout[i], layout[other]] = [layout[other], layout[i]];
      }
      if (layout[route] === 'wall') {
        const passable = layout.findIndex(type => type !== 'wall');
        [layout[route], layout[passable]] = [layout[passable], layout[route]];
      }
    } else if (!draining) {
      for (let index = 0; index < obstacleCount; index++) {
        const lane = blocked[index];
        layout[lane] = lane === escape ? choose(state, ['low', 'overhead', 'duckwall']) : choose(state, ['low', 'overhead', 'wall', 'duckwall']);
      }
    }
    for (let lane = 0; lane < LANES; lane++) {
      const type = layout[lane];
      if (!type || occupiedByTruck(lane)) continue;
      const z = spawnZ + (type === 'train' && random(state) < .5 ? lane * 4 : 0);
      allocate(state, { kind: 'obstacle', obstacleType: type, length: type === 'train' ? MAX_VEHICLE_LENGTH : 0, lane, z, row, safeRoute: lane === route, routeLane: route, tunnelId: insideTunnel ? passage.id : null });
      if (type === 'train') for (const offset of [10, 15]) allocate(state, { kind: 'coin', lane, z: z + offset, height: VEHICLE_HEIGHT + .44, row });
      if (['low', 'overhead', 'duckwall'].includes(type) && random(state) < .65) {
        for (const offset of [0, 2]) allocate(state, { kind: 'coin', lane, z: spawnZ + offset,
          height: type === 'low' ? 1.5 : .22, requires: type === 'low' ? 'jump' : 'slide', row });
      }
    }
    if ((!layout[route] || draining) && !occupiedByTruck(route)) {
      allocate(state, { kind: 'coin', lane: escape, z: spawnZ + 3, row });
      allocate(state, { kind: 'coin', lane: escape, z: spawnZ + 6, row });
    }
    if (!draining) state._escapeLane = escape;
    if (!seeded) state._nextRowAt = state.elapsed + Math.max(MIN_ROW_MS, 1150 - difficulty * 370) + random(state) * 160;
  }
  function damage(state, at, cause, obstacle) {
    if ((!obstacle?.gateBarrier && at < state.invulnerableUntil) || state.over) return false;
    state.hearts = Math.max(0, state.hearts - 1);
    state.invulnerableUntil = at + INVULNERABLE_MS;
    emit(state, { type: 'hit', cause, hearts: state.hearts });
    if (obstacle && state.hearts) {
      // Recoil the whole scene together, keeping row geometry and tunnel depth intact.
      const recoil = Math.max(0, 3 - obstacle.z);
      for (const item of state.entities) item.z += recoil;
      state.distance = Math.max(0, state.distance - recoil);
      state.action = 'run'; state.actionUntil = 0; state._queuedAction = null; state.jumpOrigin = 0;
      const plan = state.autoRecovery ? chooseRecovery(state, obstacle) : null;
      state.impact = { kind: 'hit', startedAt: state.elapsed, recoverAt: state.elapsed + RECOVERY_START_MS,
        freezeUntil: state.elapsed + IMPACT_FREEZE_MS, endAt: state.elapsed + 650, plan, applied: false };
      state._nextRowAt += IMPACT_FREEZE_MS; state._nextGateAt += IMPACT_FREEZE_MS;
      state.invulnerableUntil += IMPACT_FREEZE_MS;
    }
    if (!state.hearts) { state.over = true; state.running = false; emit(state, { type: 'over' }); }
    return true;
  }
  function cross(state, entity, at) {
    entity.resolved = true;
    if (entity.kind === 'gate') {
      prepareGateBarriers(state, entity);
      const correct = state.lane === entity.correctLane;
      state.feedback = { correct, correctMeaning: entity.correctMeaning, chosenLane: state.lane, until: state.elapsed + 1200 };
      state._safeUntil = state.elapsed + 1200;
      emit(state, { type: 'gate', correct, word: entity.word, correctMeaning: entity.correctMeaning, chosenLane: state.lane });
    } else if (entity.lane === state.lane && entity.kind === 'coin') {
      const pose = getPose(state, at), height = entity.height ?? .44;
      const reachable = !entity.requires || entity.requires === 'jump' && pose.feet >= .37 || entity.requires === 'slide' && pose.top <= .6;
      if (reachable && pose.feet <= height + .12 && pose.top >= height - .12) {
        entity.collected = true;
        state.coins++; emit(state, { type: 'coin', id: entity.id, amount: 1, total: state.coins });
      }
    } else if (entity.lane === state.lane && entity.kind === 'obstacle') {
      const pose = getPose(state, at);
      if (entity.gateBarrier) {
        if (state.gate?.id === entity.gateId) state.gate.entryReleased = true;
        damage(state, at, 'wall', entity);
      } else if (!clearsObstacle(entity.obstacleType, pose)) damage(state, at, entity.obstacleType, entity);
    }
  }
  function update(state, dtMs) {
    state.events.length = 0;
    const dt = clamp(Number(dtMs) || 0, 0, 50);
    if (!usable(state) || !dt) return state;
    const before = state.elapsed;
    state.elapsed += dt;
    if (state.feedback && state.elapsed >= state.feedback.until) state.feedback = null;
    const impact = state.impact;
    if (impact) {
      if (!impact.applied && state.elapsed >= impact.recoverAt) {
        impact.applied = true;
        if (impact.plan && state.autoRecovery) {
          state.lane = impact.plan.lane;
          state.jumpOrigin = impact.plan.action === 'jump' ? getPose(state).floor : 0;
          state.action = impact.plan.action; state.actionStartedAt = impact.recoverAt;
          state.actionUntil = impact.recoverAt + (state.action === 'jump' ? JUMP_MS : state.action === 'slide' ? SLIDE_MS : 0);
          emit(state, { type: 'recovery', action: state.action, lane: state.lane });
        }
      }
      if (state.elapsed <= impact.freezeUntil) return state;
      if (state.elapsed >= impact.endAt) state.impact = null;
    }
    maybeMapTunnel(state);
    maybeGate(state);
    const desired = Math.min(MAX_SPEED, BASE_SPEED + state.distance / 70);
    state.speed = state.gate && !state.gate.resolved ? 12 : desired;
    const movingDt = impact ? Math.min(dt, Math.max(0, state.elapsed - impact.freezeUntil)) : dt;
    const travelled = state.speed * movingDt / 1000;
    state.distance += travelled;
    const mapTunnel = state.mapTunnel;
    if (mapTunnel) {
      mapTunnel.z -= travelled;
      if (!mapTunnel.changed && mapTunnel.z <= MAP_SWITCH_DEPTH) {
        mapTunnel.changed = true;
        state.mapId = mapTunnel.destination;
        emit(state, { type: 'map-change', mapId: state.mapId });
      }
      if (mapTunnel.z + mapTunnel.length < NEAR) {
        state.mapTunnel = null; state._mapTime = 0; state._nextMapAt = mapInterval(state);
      }
    } else if (!state.gate && state._mapChoices.length > 1) state._mapTime += movingDt;
    for (const entity of state.entities) entity.z -= travelled;
    const passage = state.gate;
    if (passage && !passage.entryReleased) {
      gateEntryLocked(state);
      if (passage.resolved && passage.z < -GATE_BLOCKER_OFFSET - 3.2) passage.entryReleased = true;
    }
    for (const entity of state.entities) {
      const oldZ = entity.z + travelled;
      if (!entity.resolved && oldZ > 0 && entity.z <= 0) cross(state, entity, before + dt * oldZ / travelled);
      if (state.over || state.impact && state.elapsed <= state.impact.freezeUntil) break;
    }
    for (let index = state.entities.length - 1; index >= 0; index--) {
      const entity = state.entities[index], span = (entity.length || 0) + (entity.obstacleType === 'train' ? VEHICLE_EXIT : 0);
      if (entity.z + span < NEAR - 1) retire(state, index);
    }
    if (getAction(state) === 'run') { state.action = 'run'; state.jumpOrigin = 0; }
    if (state._queuedAction && getAction(state) === 'run' && state.elapsed >= state.actionUntil + ACTION_RECOVERY_MS) {
      const action = state._queuedAction;
      startAction(state, action, action === 'jump' ? JUMP_MS : SLIDE_MS);
    }
    if (!state.over) spawnRow(state);
    return state;
  }
  root.LootLinguaRunnerEngine = Object.freeze({ createState, configureMaps, update, move, jump, slide, getAction, getPose, vehicleSurface, normalizeWords, createWordGate,
    constants: Object.freeze({ LANES, MAX_HEARTS, MAX_ENTITIES, MAX_EVENTS, FAR, NEAR, VEHICLE_HEIGHT, VEHICLE_RAMP, VEHICLE_EXIT, TUNNEL_LENGTH, LONG_TUNNEL_MIN, MIN_ROW_MS, SPAWN_Z, GATE_BLOCKER_OFFSET, BASE_SPEED, MAX_SPEED, JUMP_MS, SLIDE_MS, INVULNERABLE_MS, MAP_INTERVAL_MIN, MAP_INTERVAL_MAX, MAP_SWITCH_DEPTH }),
  });
})(window);
