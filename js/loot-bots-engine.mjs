export const WIDTH = 640;
export const HEIGHT = 540;
export const STATION = Object.freeze({ x: 320, y: 262, reach: 86 });
export const DOCKS = [{ x: 34, y: 108 }, { x: 606, y: 108 }, { x: 34, y: 434 }, { x: 606, y: 434 }];
export const LIMITS = Object.freeze({ enemies: 20, shots: 32, coins: 28, sparks: 40 });
const BOT_TYPES = {
  scout: { speed: 75, hp: 2, radius: 14, color: '#ff936d' },
  striker: { speed: 95, hp: 2, radius: 13, color: '#ff75a8' },
  gunner: { speed: 70, hp: 3, radius: 16, color: '#ffd47d' },
  tank: { speed: 55, hp: 6, radius: 21, color: '#bd9bff' },
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const keyOf = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
export const isFighting = state => state.phase === 'combat' || state.phase === 'approach';
export const canDecode = state => state.phase === 'approach' && state.phaseTime >= 2.4 && distance(state.player, STATION) <= STATION.reach;

export function prepareDeck(words) {
  const byWord = new Map(), meanings = new Map();
  for (const item of words || []) {
    const word = String(item?.word || item?.term || '').trim();
    const meaning = String(item?.translation || item?.meaning || item?.ar || item?.definition || '').trim();
    if (!word || !meaning) continue;
    const key = keyOf(meaning), term = keyOf(word);
    if (!byWord.has(term)) byWord.set(term, { word, meaning, keys: new Set() });
    byWord.get(term).keys.add(key);
    if (!meanings.has(key)) meanings.set(key, meaning);
  }
  const prompts = [...byWord.values()].filter(prompt => prompt.keys.size < meanings.size);
  return { prompts, meanings: [...meanings] };
}

function shuffle(items, random) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createBattle(deck, random = Math.random) {
  if (!deck.prompts.length) throw new Error('At least two distinct meanings are required.');
  const state = {
    phase: 'combat', phaseTime: 0, sector: 1, hp: 5, score: 0, kills: 0, collected: 0, correct: 0, tier: 0,
    time: 0, stationAt: 32 + random() * 12, spawnAt: .8, fireAt: 0, muzzleUntil: 0,
    shieldUntil: 0, hurtUntil: 0, dashUntil: 0, dashReady: 0, powerUntil: 0,
    player: { x: 320, y: 389, angle: -Math.PI / 2, dx: 0, dy: -1 },
    enemies: [], shots: [], coins: [], sparks: [], question: null, defense: null, event: null,
  };
  let bag = [], lastWord = null;

  function phase(next) {
    state.phase = next; state.phaseTime = 0;
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count && state.sparks.length < LIMITS.sparks; i++) {
      const angle = i * Math.PI * 2 / count + state.time * 9;
      state.sparks.push({ x, y, dx: Math.cos(angle) * 120, dy: Math.sin(angle) * 120, color, life: .22 });
    }
  }

  function spawn(kind) {
    if (state.enemies.length >= LIMITS.enemies) return;
    const first = Math.floor(random() * DOCKS.length);
    for (let i = 0; i < DOCKS.length; i++) {
      const dock = DOCKS[(first + i) % DOCKS.length];
      if (distance(state.player, dock) < 135 || state.enemies.some(enemy => state.time < enemy.ready && distance(enemy, dock) < 52)) continue;
      const angle = Math.atan2(STATION.y - dock.y, STATION.x - dock.x);
      state.enemies.push({ ...BOT_TYPES[kind], ...dock, kind, ready: state.time + 1.1, angle,
        hitUntil: 0, attackAt: 0, nextAttack: state.time + 1.8, rushUntil: 0 });
      break;
    }
  }

  function activate() {
    if (!canDecode(state)) return false;
    if (!bag.length) {
      bag = shuffle(deck.prompts, random);
      if (bag.length > 1 && bag.at(-1) === lastWord) [bag[0], bag[bag.length - 1]] = [bag.at(-1), bag[0]];
    }
    const prompt = bag.pop();
    lastWord = prompt;
    const wrong = shuffle(deck.meanings.filter(([key]) => !prompt.keys.has(key)), random).slice(0, 2);
    const options = shuffle([{ label: prompt.meaning, correct: true }, ...wrong.map(([, label]) => ({ label, correct: false }))], random);
    state.question = { word: prompt.word, answer: prompt.meaning, options };
    state.shots.length = 0;
    state.dashUntil = 0;
    phase('decode');
    return true;
  }

  function choose(index) {
    const question = state.question, option = question?.options[index];
    if (state.phase !== 'decode' || !option) return false;
    if (option.correct) {
      state.correct++; state.score += 100;
      state.tier = Math.min(3, state.tier + 1);
    }
    state.event = { type: option.correct ? 'correct' : 'wrong', word: question.word, answer: question.answer };
    state.question = null;
    phase('result');
    return true;
  }

  function resumeFight() {
    const correct = state.event.type === 'correct';
    if (correct) state.powerUntil = state.time + 10;
    else state.defense = { x: STATION.x, y: STATION.y, angle: 0, aimAt: state.time + 1.1, fireAt: 0, volleys: 3 };
    state.shieldUntil = state.time + .85;
    state.sector++;
    state.stationAt = state.time + 40 + random() * 17;
    state.spawnAt = state.time + 2;
    phase('combat');
  }

  function shoot(origin, angle, hostile, powered = false) {
    // Keep the player's shots available even during a turret volley.
    if (state.shots.length >= LIMITS.shots - (hostile ? 6 : 0)) return;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const offset = hostile ? (origin === state.defense ? 8 : origin.radius) : 22;
    state.shots.push({ x: origin.x + dx * offset, y: origin.y + dy * offset, dx, dy,
      hostile, powered, speed: hostile ? 255 : 635, life: hostile ? 2.4 : 1.03 });
  }

  function damage() {
    if (state.time < state.shieldUntil || state.time < state.dashUntil) return false;
    state.hp--; state.shieldUntil = state.time + 1.1; state.hurtUntil = state.time + .26;
    burst(state.player.x, state.player.y, '#ff987e', 12);
    if (state.hp <= 0) phase('over');
    return true;
  }

  function updateDefense() {
    const turret = state.defense;
    if (!turret) return;
    if (!turret.fireAt && state.time >= turret.aimAt) {
      turret.angle = Math.atan2(state.player.y - turret.y, state.player.x - turret.x);
      turret.fireAt = state.time + .68;
    } else if (turret.fireAt && state.time >= turret.fireAt) {
      for (const spread of [-.23, 0, .23]) shoot(turret, turret.angle + spread, true);
      turret.volleys--; turret.fireAt = 0; turret.aimAt = state.time + 1.2;
      if (!turret.volleys) state.defense = null;
    }
  }

  function updateEnemies(dt) {
    const player = state.player;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const enemy = state.enemies[i];
      if (state.time < enemy.ready) continue;
      const dx = player.x - enemy.x, dy = player.y - enemy.y, gap = Math.hypot(dx, dy);
      const striker = enemy.kind === 'striker', gunner = enemy.kind === 'gunner';
      if (enemy.attackAt) {
        if (state.time < enemy.attackAt) continue;
        if (striker) enemy.rushUntil = state.time + .31;
        else shoot(enemy, enemy.angle, true);
        enemy.attackAt = 0;
      }
      const rush = state.time < enemy.rushUntil;
      if (rush) {
        enemy.x += Math.cos(enemy.angle) * 307 * dt;
        enemy.y += Math.sin(enemy.angle) * 307 * dt;
      } else if (gap > 1) {
        enemy.angle = Math.atan2(dy, dx);
        if (state.time >= enemy.nextAttack && (striker && gap > 55 && gap < 158 || gunner && gap < 345)) {
          enemy.attackAt = state.time + (striker ? .48 : .59);
          enemy.nextAttack = state.time + (striker ? 2.9 : 2.6);
        } else {
          const direction = gunner && gap < 152 ? -1 : gunner && gap < 245 ? 0 : 1;
          const speed = enemy.speed * (1 + Math.min(.28, (state.sector - 1) * .026));
          enemy.x += dx / gap * speed * direction * dt;
          enemy.y += dy / gap * speed * direction * dt;
        }
      }
    }
    // Resolve each pair once. Both robots give way, keeping enemy silhouettes readable.
    const enemies = state.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (state.time < enemy.ready || state.time < enemy.rushUntil) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const neighbor = enemies[j];
        if (state.time < neighbor.ready || state.time < neighbor.rushUntil) continue;
        const sx = enemy.x - neighbor.x, sy = enemy.y - neighbor.y;
        const clearance = enemy.radius + neighbor.radius - 1;
        if (Math.abs(sx) >= clearance || Math.abs(sy) >= clearance) continue;
        const separation = Math.hypot(sx, sy);
        if (separation >= clearance) continue;
        const push = Math.min(3.1, (clearance - separation) * .3);
        const px = separation ? sx / separation * push : push;
        const py = separation ? sy / separation * push : 0;
        enemy.x += px; enemy.y += py;
        neighbor.x -= px; neighbor.y -= py;
      }
    }
    for (const enemy of enemies) {
      if (state.time < enemy.ready) continue;
      enemy.x = clamp(enemy.x, 18, WIDTH - 18);
      enemy.y = clamp(enemy.y, 18, HEIGHT - 18);
      if (distance(player, enemy) < enemy.radius + 12 && damage()) {
        enemy.x = clamp(enemy.x + Math.cos(enemy.angle + Math.PI) * 31, 18, WIDTH - 18);
        enemy.y = clamp(enemy.y + Math.sin(enemy.angle + Math.PI) * 31, 18, HEIGHT - 18);
        if (state.phase === 'over') return;
      }
    }
  }

  function updateShots(dt) {
    for (let i = state.shots.length - 1; i >= 0; i--) {
      const shot = state.shots[i];
      shot.x += shot.dx * shot.speed * dt; shot.y += shot.dy * shot.speed * dt; shot.life -= dt;
      if (shot.life <= 0 || shot.x < 0 || shot.x > WIDTH || shot.y < 0 || shot.y > HEIGHT) { state.shots.splice(i, 1); continue; }
      if (shot.hostile) {
        if (distance(shot, state.player) < 17) {
          state.shots.splice(i, 1); damage();
          if (state.phase === 'over') return;
        }
        continue;
      }
      const hit = state.enemies.findIndex(enemy => state.time >= enemy.ready && distance(shot, enemy) <= enemy.radius + 5);
      if (hit < 0) continue;
      state.shots.splice(i, 1);
      const enemy = state.enemies[hit];
      enemy.hp -= shot.powered ? 2 : 1; enemy.hitUntil = state.time + .1;
      burst(shot.x, shot.y, enemy.color, enemy.hp > 0 ? 3 : 10);
      if (enemy.hp > 0) continue;
      state.enemies.splice(hit, 1); state.kills++; state.score += enemy.kind === 'tank' ? 40 : 20;
      if (state.coins.length < LIMITS.coins) state.coins.push({ x: enemy.x, y: enemy.y, expires: state.time + 17 });
    }
  }

  function step(dt, moveX = 0, moveY = 0, dash = false, aimX = 0, aimY = 0) {
    if (state.phase === 'over') return;
    dt = Math.min(.05, dt);
    state.phaseTime += dt;
    if (state.phase === 'result' && state.phaseTime >= (state.event.type === 'wrong' ? 4.2 : 3)) resumeFight();
    if (!isFighting(state)) return;
    state.time += dt;
    for (let i = state.sparks.length - 1; i >= 0; i--) {
      const spark = state.sparks[i];
      spark.life -= dt;
      if (spark.life <= 0) state.sparks.splice(i, 1);
      else { spark.x += spark.dx * dt; spark.y += spark.dy * dt; }
    }

    const player = state.player, length = Math.hypot(moveX, moveY);
    if (length > .04) { player.dx = moveX / length; player.dy = moveY / length; }
    if (dash && state.time >= state.dashReady) {
      state.dashUntil = state.time + .2; state.dashReady = state.time + 2.3;
    }
    const dashing = state.time < state.dashUntil;
    if (length > .04 || dashing) {
      const travel = dt * (dashing ? 495 : 181 * Math.min(length, 1));
      player.x = clamp(player.x + player.dx * travel, 23, WIDTH - 23);
      player.y = clamp(player.y + player.dy * travel, 23, HEIGHT - 23);
      if (state.time - state.muzzleUntil > .24) player.angle = Math.atan2(player.dy, player.dx);
    }
    if (aimX || aimY) {
      player.angle = Math.atan2(aimY, aimX);
      const powered = state.time < state.powerUntil;
      if (state.time >= state.fireAt && !dashing) {
        shoot(player, player.angle, false, powered);
        state.muzzleUntil = state.time + .075;
        state.fireAt = state.time + (powered ? .115 : .24 - state.tier * .025);
      }
    }

    if (state.phase === 'combat' && state.time >= state.stationAt) {
      const busy = state.enemies.some(enemy => enemy.attackAt > state.time && distance(player, enemy) < 125);
      if (!busy || state.time >= state.stationAt + 5) phase('approach');
    }
    if (state.phase === 'combat' && state.time >= state.spawnAt) {
      const chance = random();
      spawn(state.sector >= 3 && chance < .18 ? 'tank' : state.time > 13 && chance < .39 ? 'gunner' : state.time > 6 && chance < .66 ? 'striker' : 'scout');
      state.spawnAt = state.time + Math.max(.65, 2.05 - state.sector * .13) * (.8 + random() * .4);
    }
    updateDefense();
    updateEnemies(dt);
    if (state.phase === 'over') return;
    updateShots(dt);

    for (let i = state.coins.length - 1; i >= 0; i--) {
      const coin = state.coins[i], gap = distance(player, coin);
      if (gap < 22) { state.collected++; state.score += 5; state.coins.splice(i, 1); burst(coin.x, coin.y, '#ffdb7c', 5); }
      else if (coin.expires < state.time) state.coins.splice(i, 1);
      else if (gap < 63) {
        const pull = Math.min(1, dt * 9);
        coin.x += (player.x - coin.x) * pull; coin.y += (player.y - coin.y) * pull;
      }
    }
  }
  return { state, step, activate, choose };
}
