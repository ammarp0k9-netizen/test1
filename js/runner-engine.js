(function(root) {
  'use strict';
  const LANES = 3, MAX_HEARTS = 3, MAX_ENTITIES = 48, MAX_EVENTS = 16;
  const FAR = 80, SPAWN_Z = 64, BASE_SPEED = 12, MAX_SPEED = 23;
  const JUMP_MS = 850, SLIDE_MS = 800, INVULNERABLE_MS = 1100;
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
    return {
      words: normalized, lane: 1, hearts: MAX_HEARTS, coins: 0,
      distance: 0, speed: BASE_SPEED, elapsed: 0, running: true, paused: false, over: false,
      action: 'run', actionStartedAt: 0, actionUntil: 0, invulnerableUntil: 0,
      entities: [], gate: null, feedback: null, events: [],
      _random: typeof options.random === 'function' ? options.random : Math.random,
      _pool: Array.from({ length: MAX_ENTITIES }, () => ({})), _nextId: 1,
      _nextRowAt: 700, _nextGateAt: 12000, _row: 0, _escapeLane: 1, _safeUntil: 0,
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
    if (!usable(state) || getAction(state) !== 'run') return false;
    state.action = action; state.actionStartedAt = state.elapsed; state.actionUntil = state.elapsed + duration;
    return true;
  }
  function jump(state) { return startAction(state, 'jump', JUMP_MS); }
  function slide(state) { return startAction(state, 'slide', SLIDE_MS); }
  function allocate(state, data) {
    const entity = state._pool.pop();
    if (!entity) return null;
    for (const key of Object.keys(entity)) delete entity[key];
    Object.assign(entity, { id: state._nextId++, active: true, resolved: false }, data);
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
    const options = [prompt.meaning, first, second];
    for (let index = options.length - 1; index > 0; index--) {
      const other = Math.floor(random(state) * (index + 1));
      [options[index], options[other]] = [options[other], options[index]];
    }
    return { kind: 'gate', lane: 1, z: SPAWN_Z, word: prompt.word,
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
    state._nextGateAt = state.elapsed + 16000 + random(state) * 4000;
    emit(state, { type: 'gate-approach', id: gate.id, word: gate.word });
  }
  function spawnRow(state) {
    if (state.elapsed < state._nextRowAt || state.elapsed < state._safeUntil || (state.gate && !state.gate.resolved)) return;
    const clearance = SPAWN_Z / BASE_SPEED * 1000 + 500;
    if (hasGateWords(state) && state._nextGateAt - state.elapsed < clearance) return;
    const escapeOptions = [0, 1, 2].filter(lane => Math.abs(lane - state._escapeLane) <= 1);
    const escape = choose(state, escapeOptions);
    const blocked = [0, 1, 2].filter(lane => lane !== escape);
    if (random(state) > .5) blocked.reverse();
    const obstacleCount = state.speed > 16 && random(state) > .45 ? 2 : 1;
    if (state._pool.length < obstacleCount + 2) return;
    const row = ++state._row;
    for (let index = 0; index < obstacleCount; index++) {
      allocate(state, { kind: 'obstacle', obstacleType: choose(state, ['low', 'overhead', 'wall']),
        lane: blocked[index], z: SPAWN_Z, row });
    }
    allocate(state, { kind: 'coin', lane: escape, z: SPAWN_Z + 3, row });
    allocate(state, { kind: 'coin', lane: escape, z: SPAWN_Z + 6, row });
    state._escapeLane = escape;
    state._nextRowAt = state.elapsed + Math.max(750, 1300 - state.distance / 4);
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
      entity.collected = true;
      state.coins++; emit(state, { type: 'coin', id: entity.id, amount: 1, total: state.coins });
    } else if (entity.lane === state.lane && entity.kind === 'obstacle') {
      const action = getAction(state, at);
      const cleared = entity.obstacleType === 'low' && action === 'jump' || entity.obstacleType === 'overhead' && action === 'slide';
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
    const desired = Math.min(MAX_SPEED, BASE_SPEED + state.distance / 150);
    state.speed = state.gate && !state.gate.resolved ? BASE_SPEED : desired;
    const travelled = state.speed * dt / 1000;
    state.distance += travelled;
    for (const entity of state.entities) {
      const oldZ = entity.z;
      entity.z -= travelled;
      if (!entity.resolved && oldZ > 0 && entity.z <= 0) cross(state, entity, before + dt * oldZ / travelled);
      if (state.over) break;
    }
    for (let index = state.entities.length - 1; index >= 0; index--) if (state.entities[index].z < -8) retire(state, index);
    if (getAction(state) === 'run') state.action = 'run';
    if (!state.over) spawnRow(state);
    return state;
  }
  root.LootLinguaRunnerEngine = Object.freeze({ createState, update, move, jump, slide, getAction, normalizeWords, createWordGate,
    constants: Object.freeze({ LANES, MAX_HEARTS, MAX_ENTITIES, MAX_EVENTS, FAR, SPAWN_Z, BASE_SPEED, MAX_SPEED, JUMP_MS, SLIDE_MS, INVULNERABLE_MS }),
  });
})(window);
