import { WIDTH, HEIGHT, STATION, DOCKS, DEFAULT_ARENA, CUES, makeCover, moveSolid, shotCover, navigationTarget, isFighting, canDecode } from './loot-bots-arena.mjs?v=3';
import { createBossDirector, bossProgress, BOSS_WARNING, BOSS_CLEAR } from './loot-bots-bosses.mjs?v=4';
export { WIDTH, HEIGHT, STATION, DOCKS, isFighting, canDecode, bossProgress };
export const LIMITS = Object.freeze({ enemies: 20, shots: 32, coins: 28, sparks: 40 });
const BOT_TYPES = {
  scout: { speed: 75, hp: 2, radius: 14, color: '#ff936d' },
  striker: { speed: 95, hp: 2, radius: 13, color: '#ff75a8' },
  gunner: { speed: 66, hp: 2, radius: 16, color: '#ffd47d' },
  tank: { speed: 51, hp: 4, radius: 21, color: '#bd9bff' },
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const keyOf = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const REWARDS = {
  repair: { title: 'ترميم الدرع', icon: '✚', description: 'استعادة نقطتَي صحة', color: '#99efad', duration: 3 },
  shield: { title: 'درع طاقة', icon: '⬡', description: 'حماية من الإصابات لمدة 6 ثوانٍ', color: '#81ddff', duration: 6 },
  power: { title: 'طلقات مشحونة', icon: '✦', description: 'ضرر مضاعف وإطلاق أسرع لمدة 14 ثانية', color: '#ffdb86', duration: 14 },
  dash: { title: 'اندفاع سريع', icon: '»', description: 'شحن فوري ووقت انتظار أقصر لمدة 14 ثانية', color: '#92f3dd', duration: 14 },
  magnet: { title: 'مغناطيس الغنائم', icon: '◎', description: '3 عملات وجذب من مسافة أبعد لمدة 16 ثانية', color: '#ffd075', duration: 16 },
};

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

export const MAX_CELLS = 5;

export function createBattle(deck, random = Math.random, arena = DEFAULT_ARENA, previousBossId) {
  if (!deck.prompts.length) throw new Error('At least two distinct meanings are required.');
  const { width, height, station, docks } = arena;
  const state = {
    phase: 'combat', phaseTime: 0, sector: 1, hp: 5, score: 0, kills: 0, collected: 0, correct: 0, tier: 0,
    time: 0, stationAt: 32 + random() * 12, spawnAt: .8, fireAt: 0, muzzleUntil: 0,
    cells: MAX_CELLS, nextCell: 0, reloadUntil: 0, cues: 0, lastShieldSound: -1, arena, cover: makeCover(arena),
    shieldUntil: 0, hurtUntil: 0, dashUntil: 0, dashReady: 0, powerUntil: 0,
    player: { x: width / 2, y: height * .72, angle: -Math.PI / 2, dx: 0, dy: -1 },
    boss: null, bossWins: 0, bossCycleStart: 0, bossInterval: 67 + random() * 11, stationDone: false, victory: null,
    enemies: [], shots: [], coins: [], sparks: [], question: null, defense: null, event: null, reward: null,
  };
  let bag = [], lastWord = null, lastReward = null;
  const move = (actor, dx, dy, radius, steer = false) => moveSolid(actor, dx, dy, radius, arena, state.cover, steer);
  const navigate = actor => navigationTarget(actor, state.player, arena, state.cover, state.time);
  const visible = actor => shotCover(state.cover, actor.x, actor.y, state.player.x, state.player.y) < 0;
  const director = createBossDirector({ state, random, width, height, shoot, damage, spawn, burst, move, navigate, visible, previousBossId });

  function activeReward(id) {
    return state.reward?.id === id && state.time < state.reward.until;
  }

  function pickReward() {
    const choices = Object.keys(REWARDS).filter(id => id !== lastReward && (id !== 'repair' || state.hp < 5));
    const id = state.hp <= 2 && choices.includes('repair') ? 'repair' : choices[Math.floor(random() * choices.length)];
    lastReward = id;
    const reward = { id, ...REWARDS[id] };
    if (id === 'repair') {
      reward.amount = Math.min(2, 5 - state.hp);
      reward.description = reward.amount === 1 ? 'استعادة نقطة صحة' : REWARDS.repair.description;
    }
    return reward;
  }

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
    const first = Math.floor(random() * docks.length);
    for (let i = 0; i < docks.length; i++) {
      const dock = docks[(first + i) % docks.length];
      if (distance(state.player, dock) < 135 || state.enemies.some(enemy => state.time < enemy.ready && distance(enemy, dock) < 52)) continue;
      const angle = Math.atan2(station.y - dock.y, station.x - dock.x);
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
    state.cues |= CUES.station;
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
    state.event = { type: option.correct ? 'correct' : 'wrong', word: question.word, answer: question.answer,
      reward: option.correct ? pickReward() : null };
    state.cues |= option.correct ? CUES.correct : CUES.wrong;
    state.question = null;
    phase('result');
    return true;
  }

  function resumeFight() {
    state.shieldUntil = state.time + .85;
    const reward = state.event.reward;
    if (reward) {
      state.reward = { ...reward, until: state.time + reward.duration };
      if (reward.id === 'repair') state.hp += reward.amount;
      if (reward.id === 'power') state.powerUntil = state.reward.until;
      if (reward.id === 'dash') state.dashReady = state.time;
      if (reward.id === 'shield') state.shieldUntil = state.reward.until;
      if (reward.id === 'magnet') state.collected += 3;
      burst(state.player.x, state.player.y, reward.color, 18);
    } else state.defense = { x: station.x, y: station.y, angle: 0, aimAt: state.time + 1.1, fireAt: 0, volleys: 3 };
    state.sector++;
    state.stationDone = true;
    // Give the effect or the defense volley time to play out before the boss entrance.
    state.bossInterval = Math.max(state.bossInterval, state.time - state.bossCycleStart + 9);
    state.spawnAt = state.time + 2;
    phase('combat');
  }

  function shoot(origin, angle, hostile, powered = false, speed = hostile ? 255 : 635) {
    // Keep the player's shots available even during a turret volley.
    if (state.shots.length >= LIMITS.shots - (hostile ? 6 : 0)) return false;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const offset = hostile ? (origin === state.defense ? 42 : origin.radius) : 18;
    state.shots.push({ x: origin.x + dx * offset, y: origin.y + dy * offset, dx, dy,
      hostile, powered, speed, life: hostile ? 2.4 : 1.03 });
    return true;
  }

  function defeatBoss() {
    const boss = state.boss;
    state.bossWins++;
    const coins = 8 + Math.min(8, state.bossWins);
    state.score += 280 + coins * 5;
    state.collected += coins;
    state.cues |= CUES.victory;
    state.victory = { name: boss.name, coins, x: boss.x, y: boss.y, color: boss.color };
    burst(boss.x, boss.y, boss.color, 26);
    state.boss = null;
    state.enemies.length = 0;
    state.shots.length = 0;
    phase('boss-clear');
  }

  function damage() {
    if (state.time < state.shieldUntil || state.time < state.dashUntil) {
      if (activeReward('shield') && state.time > state.lastShieldSound + .25) { state.cues |= CUES.shield; state.lastShieldSound = state.time; }
      return false;
    }
    state.hp--; state.shieldUntil = state.time + 1.1; state.hurtUntil = state.time + .26;
    burst(state.player.x, state.player.y, '#ff987e', 12);
    state.cues |= CUES.damage;
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
        move(enemy, Math.cos(enemy.angle) * 307 * dt, Math.sin(enemy.angle) * 307 * dt, enemy.radius);
      } else if (gap > 1) {
        const goal = navigate(enemy), flanking = goal !== player;
        const attackRange = striker && gap > 55 && gap < 158 || gunner && gap < 345;
        const clearShot = (gunner || attackRange) && visible(enemy);
        const lineOpen = !flanking && (!gunner || clearShot);
        const canAttack = attackRange && clearShot && (gunner || !flanking);
        enemy.angle = flanking ? Math.atan2(goal.y - enemy.y, goal.x - enemy.x) : Math.atan2(dy, dx);
        if (state.time >= enemy.nextAttack && canAttack) {
          enemy.angle = Math.atan2(dy, dx);
          enemy.attackAt = state.time + (striker ? .48 : .59);
          enemy.nextAttack = state.time + (striker ? 2.9 : 2.6);
        } else {
          const direction = !lineOpen ? 1 : gunner && gap < 152 ? -1 : gunner && gap < 245 ? 0 : 1;
          const speed = enemy.speed * (1 + Math.min(.28, (state.sector - 1) * .026));
          move(enemy, Math.cos(enemy.angle) * speed * direction * dt, Math.sin(enemy.angle) * speed * direction * dt, enemy.radius, !flanking);
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
      move(enemy, 0, 0, enemy.radius);
      if (distance(player, enemy) < enemy.radius + 12 && damage()) {
        move(enemy, Math.cos(enemy.angle + Math.PI) * 22, Math.sin(enemy.angle + Math.PI) * 22, enemy.radius);
        if (state.phase === 'over') return;
      }
    }
  }

  function updateShots(dt) {
    for (let i = state.shots.length - 1; i >= 0; i--) {
      const shot = state.shots[i];
      const x = shot.x, y = shot.y;
      shot.x += shot.dx * shot.speed * dt; shot.y += shot.dy * shot.speed * dt; shot.life -= dt;
      if (shot.life <= 0 || shot.x < 0 || shot.x > width || shot.y < 0 || shot.y > height) { state.shots.splice(i, 1); continue; }
      const coverIndex = shotCover(state.cover, x, y, shot.x, shot.y);
      if (coverIndex >= 0) {
        const object = state.cover[coverIndex];
        state.shots.splice(i, 1);
        if (object.hp && !shot.hostile) {
          object.hp -= shot.powered ? 2 : 1;
          object.hitUntil = state.time + .12;
          if (object.hp <= 0) {
            state.cover.splice(coverIndex, 1);
            if (state.coins.length < LIMITS.coins) state.coins.push({ x: object.x, y: object.y, expires: state.time + 17 });
            burst(object.x, object.y, '#d6b97b', 13); state.cues |= CUES.destroy;
          } else state.cues |= CUES.hit;
        }
        burst(shot.x, shot.y, object.hp ? '#e5c78b' : '#8eb8c5', 3);
        continue;
      }
      if (shot.hostile) {
        if (distance(shot, state.player) < 17) {
          state.shots.splice(i, 1); damage();
          if (state.phase === 'over') return;
        }
        continue;
      }
      const boss = state.boss;
      if (state.phase === 'boss' && boss && distance(shot, boss) < boss.radius + 4) {
        state.shots.splice(i, 1);
        if (state.time < boss.guardUntil) {
          state.cues |= CUES.shield;
          boss.blockedUntil = state.time + .12;
          burst(shot.x, shot.y, '#8bd8f5', 3);
        } else {
          boss.hp -= shot.powered ? 2 : 1;
          state.cues |= CUES.hit;
          boss.hitUntil = state.time + .1;
          burst(shot.x, shot.y, boss.color, 3);
          if (boss.hp <= 0) { defeatBoss(); return; }
        }
        continue;
      }
      const hit = state.enemies.findIndex(enemy => state.time >= enemy.ready && distance(shot, enemy) <= enemy.radius + 5);
      if (hit < 0) continue;
      state.shots.splice(i, 1);
      const enemy = state.enemies[hit];
      enemy.hp -= shot.powered ? 2 : 1; enemy.hitUntil = state.time + .1;
      state.cues |= enemy.hp > 0 ? CUES.hit : CUES.destroy;
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
    if (state.phase === 'boss-clear' && state.phaseTime >= BOSS_CLEAR) {
      state.bossCycleStart = state.time;
      state.bossInterval = 72 + random() * 15;
      state.stationAt = state.time + 35 + random() * 13;
      state.stationDone = false;
      state.spawnAt = state.time + 1.5;
      phase('combat');
    }
    if (!isFighting(state) && state.phase !== 'boss-clear') return;
    for (let i = state.sparks.length - 1; i >= 0; i--) {
      const spark = state.sparks[i];
      spark.life -= dt;
      if (spark.life <= 0) state.sparks.splice(i, 1);
      else { spark.x += spark.dx * dt; spark.y += spark.dy * dt; }
    }
    if (state.phase === 'boss-clear') return;
    state.time += dt;
    if (state.reloadUntil && state.time >= state.reloadUntil) {
      state.reloadUntil = 0; state.cells = MAX_CELLS; state.cues |= CUES.reload;
    } else if (!state.reloadUntil && state.cells < MAX_CELLS && state.time >= state.nextCell) {
      state.cells++; state.nextCell = state.time + .22;
    }

    const player = state.player, length = Math.hypot(moveX, moveY);
    if (length > .04) { player.dx = moveX / length; player.dy = moveY / length; }
    if (dash && state.time >= state.dashReady) {
      state.dashUntil = state.time + .2; state.dashReady = state.time + (activeReward('dash') ? 1.05 : 2.3);
      state.cues |= CUES.dash;
    }
    const dashing = state.time < state.dashUntil;
    if (length > .04 || dashing) {
      const travel = dt * (dashing ? 495 : 181 * Math.min(length, 1));
      move(player, player.dx * travel, player.dy * travel, 15);
      if (state.time - state.muzzleUntil > .24) player.angle = Math.atan2(player.dy, player.dx);
    }
    if (aimX || aimY) {
      player.angle = Math.atan2(aimY, aimX);
      const powered = state.time < state.powerUntil;
      if (state.cells > 0 && state.time >= state.fireAt && !dashing && state.phase !== 'boss-warning' && shoot(player, player.angle, false, powered)) {
        state.cues |= CUES.fire;
        state.muzzleUntil = state.time + .075;
        state.fireAt = state.time + (powered ? .185 : .255 - state.tier * .012);
        state.nextCell = state.time + .62;
        if (--state.cells === 0) state.reloadUntil = state.time + (powered ? .8 : 1.05);
      }
    }

    if (state.phase === 'boss-warning') {
      if (state.phaseTime < BOSS_WARNING) return;
      state.enemies.length = 0;
      state.shieldUntil = Math.max(state.shieldUntil, state.time + .9);
      phase('boss');
    }
    if (state.phase === 'combat' && state.stationDone && bossProgress(state) >= 1 && !state.defense) {
      director.prepare();
      if (distance(state.player, state.boss) < 160) state.boss.y = height - 96;
      state.cues |= CUES.boss;
      phase('boss-warning');
      return;
    }
    if (state.phase === 'combat' && !state.stationDone && state.time >= state.stationAt) {
      const busy = state.enemies.some(enemy => enemy.attackAt > state.time && distance(player, enemy) < 125);
      if (!busy || state.time >= state.stationAt + 5) phase('approach');
    }
    if (state.phase === 'combat' && state.time >= state.spawnAt) {
      const chance = random();
      if (state.enemies.length < Math.min(13, 6 + state.sector)) {
        spawn(state.sector >= 3 && chance < .14 ? 'tank' : state.time > 16 && chance < .33 ? 'gunner' : state.time > 9 && chance < .57 ? 'striker' : 'scout');
      }
      state.spawnAt = state.time + Math.max(1.15, 2.65 - state.sector * .10) * (.84 + random() * .32);
    }
    updateDefense();
    if (state.phase === 'boss') director.update(dt);
    if (state.phase === 'over') return;
    updateEnemies(dt);
    if (state.phase === 'over') return;
    updateShots(dt);

    for (let i = state.coins.length - 1; i >= 0; i--) {
      const coin = state.coins[i], gap = distance(player, coin);
      if (gap < 22) { state.collected++; state.score += 5; state.coins.splice(i, 1); burst(coin.x, coin.y, '#ffdb7c', 5); state.cues |= CUES.coin; }
      else if (coin.expires < state.time) state.coins.splice(i, 1);
      else if (gap < (activeReward('magnet') ? 148 : 63)) {
        const pull = Math.min(1, dt * 9);
        coin.x += (player.x - coin.x) * pull; coin.y += (player.y - coin.y) * pull;
      }
    }
  }
  return { state, step, activate, choose };
}
