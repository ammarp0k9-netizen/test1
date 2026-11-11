export const WIDTH = 640;
export const HEIGHT = 540;
export const LIMITS = Object.freeze({ enemies: 26, shots: 30, coins: 28, sparks: 36 });
const CORE_POINTS = [{ x: 135, y: 165 }, { x: 320, y: 125 }, { x: 505, y: 165 }];
const BOT_TYPES = {
  scout: { speed: 79, hp: 2, radius: 14, color: '#fb896e' },
  striker: { speed: 109, hp: 2, radius: 12, color: '#f66a9c' },
  tank: { speed: 52, hp: 5, radius: 21, color: '#d997ff' },
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const keyOf = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

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
    phase: 'combat', sector: 1, hp: 5, score: 0, kills: 0, collected: 0, correct: 0,
    time: 0, sectorTime: 0, sectorKills: 0, minCombat: 15 + random() * 7,
    spawnAt: .55, fireAt: .15, shieldUntil: 0, dashUntil: 0, dashReady: 0, powerUntil: 0,
    player: { x: WIDTH / 2, y: HEIGHT * .72, angle: -Math.PI / 2, dx: 0, dy: -1 },
    enemies: [], shots: [], coins: [], sparks: [], question: null, reinforcement: 0, event: null,
  };
  let bag = [], lastWord = null, coreOpenedAt = 0, coreContact = -1;

  function burst(x, y, color, count) {
    for (let i = 0; i < count && state.sparks.length < LIMITS.sparks; i++) {
      const angle = i * Math.PI * 2 / count + state.time * 9;
      state.sparks.push({ x, y, dx: Math.cos(angle) * 120, dy: Math.sin(angle) * 120, color, life: .22 });
    }
  }

  function spawn(kind) {
    if (state.enemies.length >= LIMITS.enemies) return;
    const edge = Math.floor(random() * 4), offset = .13 + random() * .74;
    const enemy = { ...BOT_TYPES[kind], kind, x: edge < 2 ? (edge ? WIDTH - 26 : 26) : WIDTH * offset,
      y: edge >= 2 ? (edge === 3 ? HEIGHT - 26 : 26) : HEIGHT * offset,
      ready: state.time + 1, hitUntil: 0, angle: 0, chargeAt: 0, chargeReady: state.time + 1.8 };
    state.enemies.push(enemy);
  }

  function openCore() {
    if (!bag.length) {
      bag = shuffle(deck.prompts, random);
      if (bag.length > 1 && bag.at(-1) === lastWord) [bag[0], bag[bag.length - 1]] = [bag.at(-1), bag[0]];
    }
    const prompt = bag.pop();
    lastWord = prompt;
    const wrong = shuffle(deck.meanings.filter(([key]) => !prompt.keys.has(key)), random).slice(0, 2);
    const options = shuffle([{ label: prompt.meaning, correct: true }, ...wrong.map(([, label]) => ({ label, correct: false }))], random);
    options.forEach((option, index) => Object.assign(option, options.length === 2 ? CORE_POINTS[index * 2] : CORE_POINTS[index]));
    state.phase = 'core';
    state.question = { word: prompt.word, answer: prompt.meaning, options, wrong: new Set() };
    state.shots.length = 0;
    coreContact = options.findIndex(option => distance(state.player, option) < 27);
    coreOpenedAt = state.time;
  }

  function choose(index) {
    const question = state.question, option = question?.options[index];
    if (state.phase !== 'core' || !option || question.wrong.has(index)) return false;
    if (!option.correct) {
      question.wrong.add(index);
      state.reinforcement++;
      state.event = { type: 'wrong', word: question.word, answer: question.answer };
      burst(option.x, option.y, '#f981a6', 10);
      return true;
    }
    state.correct++;
    state.score += question.wrong.size ? 45 : 90;
    state.hp = Math.min(5, state.hp + (question.wrong.size ? 0 : 1));
    state.powerUntil = state.time + (question.wrong.size ? 3 : 7);
    state.shieldUntil = state.time + 1.4;
    const delay = state.time - coreOpenedAt;
    for (const enemy of state.enemies) {
      enemy.ready += delay;
      enemy.chargeReady += delay;
      if (enemy.chargeAt) enemy.chargeAt += delay;
    }
    for (const coin of state.coins) coin.expires += delay;
    burst(state.player.x, state.player.y, '#ffd889', 14);
    state.event = { type: 'correct', word: question.word, answer: question.answer };
    state.phase = 'combat'; state.question = null;
    state.sector++; state.sectorTime = 0; state.sectorKills = 0;
    state.minCombat = 17 + random() * 10;
    state.spawnAt = state.time + 1.5;
    while (state.reinforcement > 0) {
      state.reinforcement--;
      spawn('striker');
    }
    return true;
  }

  function step(dt, moveX = 0, moveY = 0, dash = false) {
    if (state.phase === 'over') return;
    dt = Math.min(.05, dt);
    state.time += dt;
    for (let i = state.sparks.length - 1; i >= 0; i--) {
      const spark = state.sparks[i];
      spark.life -= dt;
      if (spark.life <= 0) state.sparks.splice(i, 1);
      else { spark.x += spark.dx * dt; spark.y += spark.dy * dt; }
    }
    const player = state.player, length = Math.hypot(moveX, moveY);
    if (length > 0) { player.dx = moveX / length; player.dy = moveY / length; }
    if (dash && state.phase === 'combat' && state.time >= state.dashReady) {
      state.dashUntil = state.time + .21; state.dashReady = state.time + 2.5;
    }
    const dashing = state.phase === 'combat' && state.time < state.dashUntil;
    if (length > 0 || dashing) {
      const travel = dt * (dashing ? 520 : 192 * Math.min(length, 1));
      player.x = clamp(player.x + player.dx * travel, 23, WIDTH - 23);
      player.y = clamp(player.y + player.dy * travel, 23, HEIGHT - 23);
      player.angle = Math.atan2(player.dy, player.dx);
    }
    if (state.phase === 'core') {
      const contact = state.question.options.findIndex(option => distance(player, option) < 27);
      if (contact >= 0 && contact !== coreContact) choose(contact);
      coreContact = contact;
      return;
    }

    state.sectorTime += dt;
    if (state.sectorTime >= state.minCombat && (state.sectorKills >= 3 || state.sectorTime >= state.minCombat + 8)) {
      openCore();
      return;
    }
    if (state.time >= state.spawnAt) {
      const chance = random();
      spawn(state.sector >= 3 && chance < .24 ? 'tank' : state.sector >= 2 && chance < .58 ? 'striker' : 'scout');
      state.spawnAt = state.time + Math.max(.44, 1.54 - state.sector * .12) * (.77 + random() * .46);
    }
    let target = null, range = 375;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const enemy = state.enemies[i];
      if (state.time < enemy.ready) continue;
      const dx = player.x - enemy.x, dy = player.y - enemy.y, gap = Math.hypot(dx, dy);
      if (enemy.kind === 'striker' && gap > 48 && gap < 175 && state.time >= enemy.chargeReady) {
        enemy.angle = Math.atan2(dy, dx); enemy.chargeAt = state.time + .4; enemy.chargeReady = state.time + 2.6;
      }
      if (enemy.chargeAt && state.time >= enemy.chargeAt && state.time < enemy.chargeAt + .32) {
        enemy.x = clamp(enemy.x + Math.cos(enemy.angle) * 290 * dt, 18, WIDTH - 18);
        enemy.y = clamp(enemy.y + Math.sin(enemy.angle) * 290 * dt, 18, HEIGHT - 18);
      } else if (state.time >= enemy.chargeAt && gap > 1) {
        enemy.angle = Math.atan2(dy, dx);
        const travel = Math.min(gap, enemy.speed * (1 + Math.min(.38, (state.sector - 1) * .034)) * dt);
        enemy.x += dx / gap * travel; enemy.y += dy / gap * travel;
      }
      if (gap < enemy.radius + 13 && state.time >= state.shieldUntil && !dashing) {
        state.hp--; state.shieldUntil = state.time + 1.05;
        burst(player.x, player.y, '#ff987e', 10);
        state.enemies.splice(i, 1);
        if (state.hp <= 0) { state.phase = 'over'; return; }
      } else if (gap < range) { target = enemy; range = gap; }
    }
    if (target) {
      player.angle = Math.atan2(target.y - player.y, target.x - player.x);
      if (state.time >= state.fireAt && state.shots.length < LIMITS.shots) {
        const powered = state.time < state.powerUntil;
        state.shots.push({ x: player.x, y: player.y, dx: Math.cos(player.angle), dy: Math.sin(player.angle), powered, life: .7 });
        state.fireAt = state.time + (powered ? .14 : .28);
      }
    }
    for (let i = state.shots.length - 1; i >= 0; i--) {
      const shot = state.shots[i];
      shot.x += shot.dx * 570 * dt; shot.y += shot.dy * 570 * dt; shot.life -= dt;
      if (shot.life <= 0 || shot.x < 0 || shot.x > WIDTH || shot.y < 0 || shot.y > HEIGHT) { state.shots.splice(i, 1); continue; }
      const hit = state.enemies.findIndex(enemy => state.time >= enemy.ready && distance(shot, enemy) <= enemy.radius + 5);
      if (hit < 0) continue;
      state.shots.splice(i, 1);
      const enemy = state.enemies[hit];
      enemy.hp -= shot.powered ? 2 : 1; enemy.hitUntil = state.time + .09;
      burst(shot.x, shot.y, enemy.color, enemy.hp > 0 ? 3 : 10);
      if (enemy.hp > 0) continue;
      state.enemies.splice(hit, 1); state.kills++; state.sectorKills++; state.score += enemy.kind === 'tank' ? 35 : 20;
      if (state.coins.length < LIMITS.coins) state.coins.push({ x: enemy.x, y: enemy.y, expires: state.time + 14 });
    }
    for (let i = state.coins.length - 1; i >= 0; i--) {
      const coin = state.coins[i], gap = distance(player, coin);
      if (gap < 19) { state.collected++; state.score += 5; state.coins.splice(i, 1); burst(coin.x, coin.y, '#ffdb7c', 5); }
      else if (coin.expires < state.time) state.coins.splice(i, 1);
      else if (gap < 58) {
        const pull = Math.min(1, dt * 8);
        coin.x += (player.x - coin.x) * pull; coin.y += (player.y - coin.y) * pull;
      }
    }
  }
  return { state, step, choose };
}
