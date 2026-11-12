import { DEFAULT_ARENA, canDecode, isFighting } from './loot-bots-arena.mjs?v=3';

const TAU = Math.PI * 2;
const COLORS = { scout: '#ff936d', striker: '#ff75a8', gunner: '#ffd47d', tank: '#bd9bff', player: '#65eddf' };

export function createRenderer(canvas, arena = DEFAULT_ARENA, fitted = false) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const { width: WIDTH, height: HEIGHT, station: STATION, docks: DOCKS } = arena;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let floor, scale = 0;
  let view = { fit: 1, left: 0, top: 0 };
  const sprites = new Map();

  function disk(c, x, y, r, color) {
    c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  function ring(c, x, y, r, color, thickness = 2) {
    c.strokeStyle = color; c.lineWidth = thickness;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  }
  function line(c, x, y, endX, endY, color, width = 1) {
    c.strokeStyle = color; c.lineWidth = width;
    c.beginPath(); c.moveTo(x, y); c.lineTo(endX, endY); c.stroke();
  }
  function path(c, points, color) {
    c.fillStyle = color; c.beginPath();
    c.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
    c.closePath(); c.fill();
  }
  function surface(width, height, density) {
    const bitmap = document.createElement('canvas');
    bitmap.width = Math.ceil(width * density); bitmap.height = Math.ceil(height * density);
    const c = bitmap.getContext('2d');
    c.scale(density, density);
    return { bitmap, c };
  }

  function makeFloor() {
    const { bitmap, c } = surface(WIDTH, HEIGHT, scale);
    c.save(); c.scale(WIDTH / 640, HEIGHT / 540);
    const glow = c.createRadialGradient(320, 240, 25, 320, 240, 430);
    glow.addColorStop(0, '#24434d'); glow.addColorStop(.56, '#172b38'); glow.addColorStop(1, '#080e19');
    c.fillStyle = glow; c.fillRect(0, 0, 640, 540);
    for (let x = 16; x < 640; x += 32) line(c, x, 18, x, 522, '#273d46');
    for (let y = 14; y < 540; y += 32) line(c, 16, y, 624, y, '#273d46');
    path(c, [0, 0, 640, 0, 594, 44, 46, 44], '#1d3542');
    path(c, [0, 540, 640, 540, 600, 499, 40, 499], '#101e2b');
    for (const y of [30, 507]) {
      line(c, 64, y, 576, y, '#294b58', 3);
      for (let x = 76; x < 570; x += 37) {
        c.fillStyle = x % 2 === 0 ? '#537d7d' : '#254752'; c.fillRect(x, y - 3, 15, 6);
      }
    }
    for (const x of [58, 582]) {
      const side = x < 320 ? 1 : -1;
      line(c, x, 144, x, 398, '#274c58', 8);
      line(c, x + side * 7, 155, x + side * 7, 387, '#376677', 2);
      for (let y = 177; y < 390; y += 39) {
        path(c, [x - 5, y, x + 5, y, x + 9, y + 6, x - 9, y + 6], '#365464');
      }
    }
    c.restore();
    for (const {x, y} of DOCKS) {
      c.save(); c.translate(x, y); if (x > WIDTH / 2) c.scale(-1, 1);
      path(c, [-34, -44, 6, -44, 36, -24, 36, 24, 6, 44, -34, 44], '#101922');
      path(c, [-34, -37, 5, -37, 28, -21, 28, 21, 5, 37, -34, 37], '#294553');
      c.fillStyle = '#152432'; c.fillRect(-30, -20, 56, 40);
      for (let n = -25; n <= 18; n += 10) line(c, n, -20, n, 20, '#37535d', 2);
      line(c, -24, -31, 4, -31, '#886b59', 3); line(c, -24, 31, 4, 31, '#886b59', 3);
      c.restore();
    }
    const { x, y } = STATION;
    disk(c, x, y + 8, 65, '#14242d'); disk(c, x, y, 62, '#233d47');
    ring(c, x, y, 62, '#3f656c', 2);
    c.setLineDash([6, 8]); ring(c, x, y, 82, '#547477', 1.5); c.setLineDash([]);
    for (const side of [-1, 1]) {
      const end = x + side * 170;
      line(c, x + side * 64, y, end, y, '#325863', 4);
      line(c, end, y, end, y + 66, '#325863', 4);
      disk(c, end, y + 66, 4, '#49717b');
    }
    return bitmap;
  }

  function drawCover(cover, time) {
    for (const object of cover || []) {
      if (object.kind === 'station') continue;
      const { x, y, radius: r } = object;
      const hit = time < object.hitUntil;
      disk(ctx, x, y + 5, r + 3, '#091521b9');
      if (object.kind === 'pillar') {
        disk(ctx, x, y, r, '#406178'); ring(ctx, x, y, r - 2, '#83a0ad', 2);
        path(ctx, [x-15,y-8,x,y-17,x+15,y-8,x+15,y+8,x,y+17,x-15,y+8], '#1e3344');
        line(ctx, x - 7, y, x + 7, y, '#90bfcc', 3);
      } else if (object.kind === 'cell') {
        disk(ctx, x, y, r, hit ? '#fff0bd' : '#725f54'); ring(ctx, x, y, r - 3, '#e0ad76', 2);
        path(ctx, [x+1,y-15,x-10,y+2,x-1,y+2,x-4,y+14,x+12,y-3,x+3,y-3], '#fff1a1');
      } else {
        path(ctx, [x-r,y-9,x-9,y-r,x+9,y-r,x+r,y-9,x+r,y+9,x+9,y+r,x-9,y+r,x-r,y+9], hit ? '#ffebbe' : '#947256');
        ctx.fillStyle = '#3c4144'; ctx.fillRect(x - 11, y - 10, 22, 20);
        line(ctx, x - 12, y + 9, x + 12, y - 9, '#d7ad76', 3);
      }
      if (object.hp === 1) line(ctx, x - 9, y - 13, x + 6, y + 10, '#241b21', 2);
    }
  }

  function sprite(kind, hit) {
    const key = kind + (hit ? '-hit' : '');
    if (sprites.has(key)) return sprites.get(key);
    const { bitmap, c } = surface(64, 64, Math.max(1.4, scale));
    c.translate(32, 32);
    const color = hit ? '#fff5de' : COLORS[kind];
    const player = kind === 'player', striker = kind === 'striker', gunner = kind === 'gunner';
    c.fillStyle = '#0b1420'; c.fillRect(-16, -16, 28, 32);
    c.fillStyle = '#40545d'; c.fillRect(-14, -17, 24, 6); c.fillRect(-14, 11, 24, 6);
    for (const x of [-11, -5, 1, 7]) {
      line(c, x, -16, x, -12, '#6c8089'); line(c, x, 12, x, 16, '#6c8089');
    }
    path(c, [-14,-10, 8,-12, 16,-7, striker ? 20 : 16,0, 16,7, 8,12, -14,10, -17,4, -17,-4], color);
    path(c, [-14,-8, 8,-10, 13,-7, -10,-5], '#ffffff63');
    path(c, [-12,8, 12,6, 8,10, -14,10], '#141e3980');
    path(c, [-9,-6, 5,-7, 10,0, 5,7, -9,6, -12,0], '#253744');
    if (player || gunner) {
      c.fillStyle = '#94acb5'; c.fillRect(11, -3, 16, 6);
      c.fillStyle = '#162834'; c.fillRect(23, -2, 4, 4);
    }
    c.fillStyle = player ? '#ffe3a5' : '#fff1df'; c.fillRect(1, -4, 4, 8);
    sprites.set(key, bitmap);
    return bitmap;
  }
  function robot(bot, kind, size, flash = false) {
    disk(ctx, bot.x, bot.y + 4, size + 3, '#06101a99');
    ctx.save(); ctx.translate(bot.x, bot.y); ctx.rotate(bot.angle);
    const extent = size * 3.55;
    ctx.drawImage(sprite(kind, flash), -extent / 2, -extent / 2, extent, extent);
    ctx.restore();
  }

  function bossSprite(boss) {
    const key = `boss-${boss.id}`;
    if (sprites.has(key)) return sprites.get(key);
    const { bitmap, c } = surface(104, 104, Math.max(1.25, scale));
    c.translate(52, 52);
    const weapon = {
      ram: [18,-24, 48,0, 18,24, 25,0], siege: [-11,-23, 33,-23, 33,-12, 12,-12, 12,12, 33,12, 33,23, -11,23],
      coil: [-7,-42, 8,-30, 24,-37, 25,-16, -19,-16, -20,-30], brood: [-31,-8, -46,-24, -19,-36, -13,-22, -18,0, -13,22, -19,36, -46,24],
      bulwark: [5,-39, 27,-39, 36,-27, 36,27, 27,39, 5,39, 14,25, 14,-25], sniper: [12,-10, 49,-5, 49,5, 12,10],
      orbit: [-34,-7, -25,-32, 2,-39, 23,-26, 11,-19, -2,-27, -22,-23, -23,0], furnace: [-33,-30, 12,-35, 26,-27, 27,27, 12,35, -33,30],
      mirror: [-13,-31, 34,-35, 14,-12, -9,-10, -9,10, 14,12, 34,35, -13,31], magnet: [-34,-13, -29,-34, 30,-37, 39,-25, 16,-21, -12,-19, -17,-9],
    }[boss.id];
    const hull = [];
    for (let i = 0; i < boss.form; i++) {
      const angle = i * TAU / boss.form;
      hull.push(Math.cos(angle) * 34, Math.sin(angle) * 28);
    }
    path(c, weapon, '#526575');
    if (['coil', 'orbit', 'magnet'].includes(boss.id)) { c.rotate(Math.PI); path(c, weapon, '#526575'); c.rotate(-Math.PI); }
    path(c, hull, boss.color);
    c.scale(.72, .68); path(c, hull, '#253343'); c.scale(1 / .72, 1 / .68);
    ring(c, 0, 0, 13, '#0d1923', 6); disk(c, 0, 0, 9, boss.color); disk(c, 2, -2, 4, '#fff5da');
    line(c, -18, -9, -12, -9, '#d9e0e3', 2); line(c, -18, 9, -12, 9, '#d9e0e3', 2);
    sprites.set(key, bitmap);
    return bitmap;
  }

  function drawBoss(s) {
    const boss = s.boss;
    if (!boss) return;
    const attack = boss.attack, warning = s.phase === 'boss-warning';
    if (warning) {
      ring(ctx, boss.x, boss.y, 38 + Math.min(1, s.phaseTime / 2.2) * 24, boss.color, 2);
      ctx.globalAlpha = Math.min(1, .12 + s.phaseTime / 2.35);
    }
    if (attack) {
      const live = s.time >= attack.fireAt && attack.move !== 'ram' && attack.move !== 'echo';
      for (const region of attack.regions) {
        const color = live ? '#ffd1a6c9' : '#ff776c49';
        if (region.kind === 'line') {
          ctx.lineCap = 'round';
          line(ctx, region.x, region.y, region.endX, region.endY, color, region.radius * 2);
          line(ctx, region.x, region.y, region.endX, region.endY, live ? '#fff0d6' : '#ff9a87', 1.5);
          ctx.lineCap = 'butt';
        } else if (region.kind === 'ring') {
          ring(ctx, region.x, region.y, region.radius, color, region.thickness * 2);
          ring(ctx, region.x, region.y, region.radius, '#ff9a87', 2);
        } else {
          disk(ctx, region.x, region.y, region.radius, color);
          ring(ctx, region.x, region.y, region.radius, '#ff9a87', 2);
        }
        if (attack.move === 'echo') disk(ctx, region.x, region.y, 14, '#f490e6bb');
      }
      if (!attack.fired && !attack.regions.length) ring(ctx, boss.x, boss.y, boss.radius + 9, boss.color, 3);
    }
    disk(ctx, boss.x, boss.y + 5, boss.radius + 4, '#10101aa9');
    if (s.time < boss.guardUntil || s.time < boss.blockedUntil) ring(ctx, boss.x, boss.y, boss.radius + 9, '#91daff', 4);
    ctx.save(); ctx.translate(boss.x, boss.y); ctx.rotate(boss.angle);
    ctx.drawImage(bossSprite(boss), -52, -52, 104, 104);
    ctx.restore();
    if (s.time < boss.hitUntil) ring(ctx, boss.x, boss.y, boss.radius + 2, '#fff0ca', 2);
    ctx.globalAlpha = 1;
  }

  function station(s) {
    const { x, y } = STATION;
    const raising = s.phase === 'approach' ? Math.min(1, s.phaseTime / 2.4) : 1;
    const waiting = s.phase !== 'approach' && s.phase !== 'decode' && s.phase !== 'result' && !s.defense && !(s.reward && s.time < s.reward.until);
    const wrong = s.defense || (s.phase === 'result' && s.event.type === 'wrong');
    const color = wrong ? '#ff765e' : s.event?.reward?.color || '#72efdb';
    if (!waiting) {
      const r = 38 + 44 * raising;
      ring(ctx, x, y, r, wrong ? '#8f473e' : '#387b7e', 2);
      if (canDecode(s)) ring(ctx, x, y, STATION.reach, '#78edd28c', 2);
    }
    const lift = waiting ? 0 : 15 * raising;
    disk(ctx, x, y + 7, 41, '#101b25');
    disk(ctx, x, y - lift, 38, waiting ? '#203441' : '#2f4a51');
    ring(ctx, x, y - lift, 35, waiting ? '#49626d' : color, waiting ? 2 : 3);
    path(ctx, [x-21,y-lift-9, x,y-lift-23, x+21,y-lift-9, x+21,y-lift+9, x,y-lift+23, x-21,y-lift+9], waiting ? '#16222e' : '#163740');
    disk(ctx, x, y - lift, waiting ? 5 : 7 + 3 * raising, waiting ? '#67828c' : color);
    if (s.defense) {
      const {angle, fireAt} = s.defense, dx = Math.cos(angle), dy = Math.sin(angle);
      line(ctx, x, y, x + dx * 32, y + dy * 32, color, 9);
      if (fireAt) {
        for (const spread of [-.23, 0, .23]) {
          const a = angle + spread;
          line(ctx, x, y, x + Math.cos(a) * 720, y + Math.sin(a) * 720, '#ff795f9c', 2);
        }
      }
    }
  }

  function stick(control, color) {
    disk(ctx, control.x, control.y, 40, '#102232c0');
    ring(ctx, control.x, control.y, 40, color);
    disk(ctx, control.x + control.dx * 30, control.y + control.dy * 30, 14, color);
  }

  function draw(s, moveStick, reticle) {
    ctx.drawImage(floor, 0, 0, WIDTH, HEIGHT);
    station(s);
    drawCover(s.cover, s.time);
    const fighting = isFighting(s);
    for (const coin of s.coins) {
      disk(ctx, coin.x, coin.y + 2, 7, '#936438');
      disk(ctx, coin.x, coin.y, 6, '#ffd578');
      line(ctx, coin.x, coin.y - 3, coin.x, coin.y + 3, '#fff1bd', 2);
    }
    for (const enemy of s.enemies) {
      if (s.phase === 'boss-warning') {
        ctx.globalAlpha = Math.max(0, 1 - s.phaseTime / 1.2);
        if (ctx.globalAlpha > 0) robot(enemy, enemy.kind, enemy.radius);
        ctx.globalAlpha = 1;
        continue;
      }
      if (s.time < enemy.ready) {
        const progress = 1 - (enemy.ready - s.time) / 1.1;
        disk(ctx, enemy.x, enemy.y, 24, '#492d42');
        ring(ctx, enemy.x, enemy.y, 12 + progress * 15, enemy.color);
        if (progress > .4) {
          ctx.globalAlpha = Math.min(1, (progress - .4) / .6);
          robot(enemy, enemy.kind, enemy.radius);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      ctx.globalAlpha = fighting ? 1 : .36;
      if (enemy.attackAt > s.time) {
        const reach = enemy.kind === 'gunner' ? 420 : 104;
        line(ctx, enemy.x, enemy.y, enemy.x + Math.cos(enemy.angle) * reach, enemy.y + Math.sin(enemy.angle) * reach, enemy.color, 2);
        ring(ctx, enemy.x, enemy.y, enemy.radius + 7, enemy.color);
      }
      robot(enemy, enemy.kind, enemy.radius, s.time < enemy.hitUntil);
      ctx.globalAlpha = 1;
    }
    drawBoss(s);
    if (s.phase === 'boss-clear' && s.phaseTime < .85 && !reducedMotion.matches) {
      const { x, y, color } = s.victory;
      ctx.globalAlpha = 1 - s.phaseTime / .85;
      ring(ctx, x, y, 22 + s.phaseTime * 140, color, 4);
      ring(ctx, x, y, 12 + s.phaseTime * 85, '#ffe3a3', 2);
      ctx.globalAlpha = 1;
    }
    for (const shot of s.shots) {
      const color = shot.hostile ? '#ff846d' : shot.powered ? '#ffe599' : '#8fffe2';
      line(ctx, shot.x - shot.dx * 14, shot.y - shot.dy * 14, shot.x, shot.y, color, shot.hostile || shot.powered ? 4 : 2.5);
      if (shot.hostile) disk(ctx, shot.x, shot.y, 4.5, '#fff2ce');
    }
    if (!reducedMotion.matches) for (const spark of s.sparks) {
      ctx.globalAlpha = spark.life / .22;
      ctx.fillStyle = spark.color; ctx.fillRect(spark.x, spark.y, 3, 3);
    }
    ctx.globalAlpha = 1;
    const p = s.player;
    if (s.reward && s.time < s.reward.until) {
      ring(ctx, p.x, p.y, s.reward.id === 'shield' ? 29 : 25, s.reward.color, 3);
      if (s.reward.id === 'magnet') ring(ctx, p.x, p.y, 36, '#ffd07570', 1);
    }
    if (s.time < s.hurtUntil) ring(ctx, p.x, p.y, 25, '#ff8069', 3);
    else if (s.time < s.powerUntil || s.time < s.shieldUntil) ring(ctx, p.x, p.y, 25, s.time < s.powerUntil ? '#ffd179' : '#7ee8dd');
    if (s.time < s.dashUntil && !reducedMotion.matches) {
      disk(ctx, p.x - p.dx * 27, p.y - p.dy * 27, 13, '#327678aa');
      disk(ctx, p.x - p.dx * 45, p.y - p.dy * 45, 8, '#225358aa');
    }
    robot(p, 'player', 18, s.time < s.hurtUntil);
    if (s.time < s.muzzleUntil) disk(ctx, p.x + Math.cos(p.angle) * 32, p.y + Math.sin(p.angle) * 32, 4, '#fff2bf');
    if (moveStick) stick(moveStick, '#91e4d7af');
    if (reticle) {
      ring(ctx, reticle.x, reticle.y, 9, '#ffda8d');
      line(ctx, reticle.x - 4, reticle.y, reticle.x + 4, reticle.y, '#ffda8d');
    }
  }

  function resize() {
    const cssWidth = canvas.clientWidth || WIDTH;
    const cssHeight = fitted ? canvas.clientHeight || HEIGHT : cssWidth * HEIGHT / WIDTH;
    const fit = Math.min(cssWidth / WIDTH, cssHeight / HEIGHT);
    const density = Math.min(window.devicePixelRatio || 1, 1.55, Math.sqrt(1250000 / (cssWidth * cssHeight)));
    const pixelWidth = Math.ceil(cssWidth * density), pixelHeight = Math.ceil(cssHeight * density);
    const nextScale = fit * density;
    view = { fit, left: (cssWidth - WIDTH * fit) / 2, top: (cssHeight - HEIGHT * fit) / 2 };
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    ctx.setTransform(nextScale, 0, 0, nextScale, view.left * density, view.top * density);
    if (!floor || Math.abs(nextScale - scale) > .04) {
      scale = nextScale;
      floor = makeFloor(); sprites.clear();
      for (const kind of Object.keys(COLORS)) { sprite(kind, false); sprite(kind, true); }
    }
    return view;
  }

  return { draw, resize };
}
