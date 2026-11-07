(function(root) {
  'use strict';
  const LANES = 3, MAX_HEARTS = 3, MAX_ENTITIES = 48, MAX_EVENTS = 16;
  const FAR = 80, SPAWN_Z = 64, BASE_SPEED = 14, MAX_SPEED = 32;
  const NEAR = -15, VEHICLE_HEIGHT = 1.05, VEHICLE_RAMP = 6, VEHICLE_EXIT = 3;
  const TUNNEL_LENGTH = 42, MIN_ROW_MS = 780;
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
      const key = item.word + '\u0000' + item.meaning;
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
      entities: [], gate: null, feedback: null, events: [],
      _random: rng, _gateLanes: [], _lastGateLane: -1, _queuedAction: null, _formationBag: [],
      _pool: Array.from({ length: MAX_ENTITIES }, () => ({})), _nextId: 1,
      _nextRowAt: 400, _nextGateAt: 30000 + Math.floor(clamp(Number(rng()) || 0, 0, 1) * 12000), _row: 0, _escapeLane: 1, _safeUntil: 0,
      _canGate: new Set(normalized.map(item => item.meaning)).size >= LANES,
    };
  }
  function usable(state) { return state.running && !state.paused && !state.over; }
  function getAction(state, at = state.elapsed) {
    return state.action !== 'run' && at >= state.actionStartedAt && at < state.actionUntil ? state.action : 'run';
  }
  function move(state, lane) {
    const value = Number(lane);
    if (!usable(state) || !Number.isFinite(value)) return false;
    const next = clamp(Math.round(value), 0, LANES - 1);
    if (next === state.lane) return false;
    state.lane = next; return true;
  }
  function startAction(state, action, duration) {
    if (!usable(state)) return false;
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
    return { action, feet: floor + lift, top: floor + lift + (action === 'slide' ? .43 : 1), floor, lift };
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
    const prompt = choose(state, state.words);
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
    return { kind: 'gate', lane: 1, z: SPAWN_Z, length: TUNNEL_LENGTH, word: prompt.word,
      options, correctLane: options.indexOf(prompt.meaning), correctMeaning: prompt.meaning };
  }
  function hasGateWords(state) { return state._canGate; }
  function maybeGate(state) {
    if (state.elapsed < state._nextGateAt || state.gate || !hasGateWords(state)) return;
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
    state._nextGateAt = state.elapsed + 30000 + random(state) * 18000;
    emit(state, { type: 'gate-approach', id: gate.id, word: gate.word });
  }
  function spawnRow(state) {
    if (state.elapsed < state._nextRowAt || state.elapsed < state._safeUntil) return;
    const reading = state.gate && !state.gate.resolved;
    const clearance = SPAWN_Z / state.speed * 1000 + 350;
    // Do not queue hidden hazards behind the reading veil: returning to full
    // speed would compress their spacing and reveal them too close together.
    const draining = reading || hasGateWords(state) && state._nextGateAt - state.elapsed < clearance;
    const spawnZ = SPAWN_Z;
    const escapeOptions = [0, 1, 2].filter(lane => Math.abs(lane - state._escapeLane) <= 1);
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
      allocate(state, { kind: 'obstacle', obstacleType: type, length: type === 'train' ? 20 : 0, lane, z, row, safeRoute: lane === route });
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
    state._escapeLane = escape;
    state._nextRowAt = state.elapsed + Math.max(MIN_ROW_MS, 1150 - difficulty * 370) + random(state) * 160;
  }
  function damage(state, at, cause) {
    if (at < state.invulnerableUntil || state.over) return false;
    state.hearts = Math.max(0, state.hearts - 1);
    state.invulnerableUntil = at + INVULNERABLE_MS;
    emit(state, { type: 'hit', cause, hearts: state.hearts });
    if (!state.hearts) { state.over = true; state.running = false; emit(state, { type: 'over' }); }
    return true;
  }
  function cross(state, entity, at) {
    entity.resolved = true;
    if (entity.kind === 'gate') {
      const correct = state.lane === entity.correctLane;
      if (!correct) damage(state, at, 'gate');
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
      const cleared = entity.obstacleType === 'train' ||
        entity.obstacleType === 'duckwall' && pose.action === 'slide' && pose.top <= .55 ||
        entity.obstacleType === 'low' && pose.feet >= .37 ||
        entity.obstacleType === 'overhead' && (pose.top <= .6 || pose.feet >= .88) ||
        entity.obstacleType === 'wall' && pose.feet >= 1.4;
      if (!cleared) damage(state, at, entity.obstacleType);
    }
  }
  function update(state, dtMs) {
    state.events.length = 0;
    const dt = clamp(Number(dtMs) || 0, 0, 50);
    if (!usable(state) || !dt) return state;
    const before = state.elapsed;
    state.elapsed += dt;
    if (state.feedback && state.elapsed >= state.feedback.until) state.feedback = null;
    maybeGate(state);
    const desired = Math.min(MAX_SPEED, BASE_SPEED + state.distance / 70);
    state.speed = state.gate && !state.gate.resolved ? 12 : desired;
    const travelled = state.speed * dt / 1000;
    state.distance += travelled;
    for (const entity of state.entities) entity.z -= travelled;
    for (const entity of state.entities) {
      const oldZ = entity.z + travelled;
      if (!entity.resolved && oldZ > 0 && entity.z <= 0) cross(state, entity, before + dt * oldZ / travelled);
      if (state.over) break;
    }
    for (let index = state.entities.length - 1; index >= 0; index--) {
      const entity = state.entities[index], span = (entity.length || 0) + (entity.obstacleType === 'train' ? VEHICLE_EXIT : 0);
      if (entity.z + span < NEAR - 1) retire(state, index);
    }
    if (getAction(state) === 'run') state.action = 'run';
    if (state._queuedAction && getAction(state) === 'run' && state.elapsed >= state.actionUntil + ACTION_RECOVERY_MS) {
      const action = state._queuedAction;
      startAction(state, action, action === 'jump' ? JUMP_MS : SLIDE_MS);
    }
    if (!state.over) spawnRow(state);
    return state;
  }
  root.LootLinguaRunnerEngine = Object.freeze({ createState, update, move, jump, slide, getAction, getPose, vehicleSurface, normalizeWords, createWordGate,
    constants: Object.freeze({ LANES, MAX_HEARTS, MAX_ENTITIES, MAX_EVENTS, FAR, NEAR, VEHICLE_HEIGHT, VEHICLE_RAMP, VEHICLE_EXIT, TUNNEL_LENGTH, MIN_ROW_MS, SPAWN_Z, BASE_SPEED, MAX_SPEED, JUMP_MS, SLIDE_MS, INVULNERABLE_MS }),
  });
})(window);
