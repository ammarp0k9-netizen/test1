export const BOSS_TYPES = [
  { id: 'ram', name: 'الكاسر', hint: 'ابتعد عن خط الاندفاع', color: '#ff866d', form: 3, speed: 70, attacks: ['ram', 'ram', 'fan'] },
  { id: 'siege', name: 'مدفع الحصار', hint: 'غادر دوائر القصف', color: '#ffbe72', form: 8, speed: 42, attacks: ['bombs', 'fan'] },
  { id: 'coil', name: 'ملف الصواعق', hint: 'قف بين خطوط الكهرباء', color: '#d897ff', form: 6, speed: 56, attacks: ['spokes', 'spokes', 'bombs'] },
  { id: 'brood', name: 'حارس السرب', hint: 'تخلّص من الأتباع قبل أن يحيطوا بك', color: '#f7d97e', form: 5, speed: 61, attacks: ['summon', 'fan', 'summon'] },
  { id: 'bulwark', name: 'القلعة', hint: 'أطلق عندما ينفتح الدرع', color: '#7dcee9', form: 4, speed: 42, attacks: ['guard', 'fan'] },
  { id: 'sniper', name: 'عين الليزر', hint: 'غيّر اتجاهك بعد تثبيت الشعاع', color: '#ff89c1', form: 4, speed: 67, attacks: ['laser', 'laser', 'fan'] },
  { id: 'orbit', name: 'الدوّامة', hint: 'اعبر الفراغ بين دفعات المقذوفات', color: '#a9bcff', form: 10, speed: 56, attacks: ['orbit', 'fan', 'orbit'] },
  { id: 'furnace', name: 'الفرن', hint: 'انتقل إلى ممر أرضي آمن', color: '#ff9a62', form: 6, speed: 43, attacks: ['lanes', 'lanes', 'bombs'] },
  { id: 'mirror', name: 'الشبح المزدوج', hint: 'راقب خطّي إطلاق النسختين', color: '#f38af0', form: 4, speed: 72, attacks: ['echo', 'fan', 'echo'] },
  { id: 'magnet', name: 'قطب الجاذبية', hint: 'ابتعد عن الحلقة المضيئة', color: '#ade591', form: 12, speed: 51, attacks: ['ring', 'bombs', 'ring'] },
];

export const BOSS_WARNING = 3;
export const BOSS_CLEAR = 3;
const EXTRA = ['echo', 'lanes', 'ring', 'laser', 'bombs', 'spokes', 'ram', 'fan', 'orbit', 'spokes'];
const TAU = Math.PI * 2;
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));

export function bossProgress(state) {
  return clamp((state.time - state.bossCycleStart) / state.bossInterval, 0, state.stationDone ? 1 : .84);
}

export function bossHealth(ordinal) {
  return ordinal <= 10 ? 14 + ordinal * 2 : 34 + Math.round(20 * (1 - Math.exp(-(ordinal - 10) / 12)));
}

export function createBossDirector({ state, random, width, height, shoot, damage, spawn, burst,
  move = (actor, dx, dy) => { actor.x += dx; actor.y += dy; }, navigate = () => state.player, visible = () => true, previousBossId }) {
  let order = [], last = previousBossId;
  const line = (x, y, angle, reach, radius) => ({ kind: 'line', x, y,
    endX: x + Math.cos(angle) * reach, endY: y + Math.sin(angle) * reach, radius });
  const circle = (x, y, radius) => ({ kind: 'circle', x, y, radius });
  const aim = (x, y) => Math.atan2(state.player.y - y, state.player.x - x);
  const distance = (x, y, other) => Math.hypot(x - other.x, y - other.y);

  function prepare() {
    if (!order.length) {
      order = BOSS_TYPES.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      if (order[0].id === last) [order[0], order[1]] = [order[1], order[0]];
    }
    const type = order.shift();
    last = type.id;
    const cycle = Math.floor(state.bossWins / BOSS_TYPES.length);
    const hp = bossHealth(state.bossWins + 1);
    state.boss = { ...type, hp, maxHp: hp, cycle, x: width / 2, y: 96, angle: Math.PI / 2,
      radius: type.id === 'bulwark' || type.id === 'furnace' ? 37 : 31,
      nextAt: state.time + BOSS_WARNING + 1, sequence: 0, attack: null, hitUntil: 0, guardUntil: 0, blockedUntil: 0 };
    state.shots.length = 0;
    state.defense = null;
  }

  function prepareAttack(boss) {
    const p = state.player, angle = aim(boss.x, boss.y);
    const alternate = boss.cycle > 0 && boss.sequence % 4 === 3;
    const move = alternate ? EXTRA[BOSS_TYPES.findIndex(type => type.id === boss.id)] : boss.attacks[boss.sequence % boss.attacks.length];
    boss.sequence++;
    const duration = move === 'ring' || move === 'lanes' ? 1.15 : move === 'laser' || move === 'bombs' ? .95 : .78;
    let reach = Math.min(308, Math.hypot(p.x - boss.x, p.y - boss.y) + 70);
    if (move === 'ram') for (const object of state.cover || []) {
      const dx = object.x - boss.x, dy = object.y - boss.y;
      const front = dx * Math.cos(angle) + dy * Math.sin(angle);
      const side = dx * Math.sin(angle) - dy * Math.cos(angle), clearance = boss.radius + object.radius;
      if (front > 0 && Math.abs(side) < clearance) reach = Math.min(reach, Math.max(0, front - Math.sqrt(clearance ** 2 - side ** 2)));
    }
    const attack = { move, angle, started: state.time, fireAt: state.time + duration, endAt: state.time + duration + .27,
      regions: [], fired: false, hit: false };
    switch (move) {
      case 'ram':
        attack.regions = [line(boss.x, boss.y, angle, reach, 24)];
        attack.endAt = attack.fireAt + reach / 535;
        break;
      case 'bombs': {
        const side = boss.sequence % 2 ? 1 : -1;
        attack.regions = [[0, 0], [side * 94, -69], [-side * 83, 81]].map(([dx, dy]) =>
          circle(clamp(p.x + dx, 45, width - 45), clamp(p.y + dy, 45, height - 45), 36));
        break;
      }
      case 'spokes':
        attack.regions = [0, TAU / 3, TAU * 2 / 3].map(spread => line(boss.x, boss.y, angle + spread, 810, 12));
        break;
      case 'laser':
        attack.regions = [line(boss.x, boss.y, angle, 820, 16)];
        attack.endAt = attack.fireAt + .42;
        break;
      case 'lanes':
        attack.regions = boss.sequence % 2 ? [line(p.x, 0, Math.PI / 2, height, 31), line(p.x < width / 2 ? width - 91 : 91, 0, Math.PI / 2, height, 28)] :
          [line(0, p.y, 0, width, 31), line(0, p.y < height / 2 ? height - 91 : 91, 0, width, 28)];
        break;
      case 'echo':
        attack.regions = [{ x: 62, y: clamp(p.y - 90, 52, height - 52), radius: 10 },
          { x: width - 62, y: clamp(p.y + 90, 52, height - 52), radius: 10 }].map(origin =>
          line(origin.x, origin.y, aim(origin.x, origin.y), 780, 6));
        break;
      case 'ring':
        attack.regions = [{ kind: 'ring', x: boss.x, y: boss.y, radius: 132, thickness: 29 }];
        break;
      case 'guard':
        boss.guardUntil = attack.fireAt;
        break;
    }
    boss.angle = angle;
    boss.attack = attack;
  }

  function inside(region, player) {
    if (region.kind === 'circle') return distance(region.x, region.y, player) < region.radius + 9;
    if (region.kind === 'ring') return Math.abs(distance(region.x, region.y, player) - region.radius) < region.thickness + 9;
    const dx = region.endX - region.x, dy = region.endY - region.y;
    const t = clamp(((player.x - region.x) * dx + (player.y - region.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return distance(region.x + t * dx, region.y + t * dy, player) < region.radius + 8;
  }

  function update(dt) {
    const boss = state.boss;
    if (!boss) return;
    const attack = boss.attack;
    if (attack && state.time >= attack.fireAt) {
      if (!attack.fired) {
        attack.fired = true;
        if (attack.move === 'fan' || attack.move === 'guard') {
          for (const spread of [-.4, -.2, 0, .2, .4]) shoot(boss, attack.angle + spread, true, false, 295);
        }
        if (attack.move === 'orbit') {
          const rotation = attack.angle + (boss.sequence % 2) * .24;
          for (let i = 0; i < 12; i++) shoot(boss, rotation + i * TAU / 12, true, false, 236);
        }
        if (attack.move === 'echo') for (const ray of attack.regions) {
          shoot({ x: ray.x, y: ray.y, radius: 8 }, Math.atan2(ray.endY - ray.y, ray.endX - ray.x), true, false, 420);
        }
        if (attack.move === 'summon') {
          if (state.enemies.length < 5) spawn('scout');
          if (state.enemies.length < 5) spawn(boss.sequence % 2 ? 'gunner' : 'striker');
        }
        burst(boss.x, boss.y, boss.color, 8);
      }
      if (attack.move === 'ram' && state.time < attack.endAt) {
        move(boss, Math.cos(attack.angle) * 535 * dt, Math.sin(attack.angle) * 535 * dt, boss.radius);
      } else if (attack.move !== 'ram' && attack.move !== 'echo' && !attack.hit && attack.regions.some(region => inside(region, state.player))) {
        attack.hit = damage();
      }
      if (state.time >= attack.endAt) {
        boss.attack = null;
        boss.nextAt = state.time + (attack.move === 'guard' ? 2.6 : 1.75) - Math.min(.46, state.bossWins * .035);
      }
    } else if (!attack) {
      const gap = distance(boss.x, boss.y, state.player);
      const goal = navigate(boss);
      const clearShot = visible(boss);
      if (state.time >= boss.nextAt && clearShot && (boss.id !== 'ram' || goal === state.player)) prepareAttack(boss);
      else if (goal !== state.player || !clearShot) {
        boss.angle = Math.atan2(goal.y - boss.y, goal.x - boss.x);
        move(boss, Math.cos(boss.angle) * boss.speed * 1.25 * dt,
          Math.sin(boss.angle) * boss.speed * 1.25 * dt, boss.radius, goal === state.player);
      } else {
        boss.angle = aim(boss.x, boss.y);
        const desired = boss.id === 'ram' ? 143 : boss.id === 'sniper' ? 284 : 217;
        const drift = boss.id === 'orbit' || boss.id === 'mirror' ? (boss.sequence % 2 ? -.75 : .75) : .18;
        const radial = gap > desired + 25 ? 1 : gap < desired - 25 ? -.8 : 0;
        move(boss, (Math.cos(boss.angle) * radial - Math.sin(boss.angle) * drift) * boss.speed * dt,
          (Math.sin(boss.angle) * radial + Math.cos(boss.angle) * drift) * boss.speed * dt, boss.radius, true);
      }
    }
    boss.x = clamp(boss.x, boss.radius, width - boss.radius);
    boss.y = clamp(boss.y, boss.radius, height - boss.radius);
    if (distance(boss.x, boss.y, state.player) < boss.radius + 12) damage();
  }
  return { prepare, update };
}
