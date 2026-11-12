import { WIDTH, HEIGHT, STATION, DOCKS, canDecode, isFighting } from './loot-bots-engine.mjs?v=2';

const TAU = Math.PI * 2;
const COLORS = { scout: '#ff936d', striker: '#ff75a8', gunner: '#ffd47d', tank: '#bd9bff', player: '#65eddf' };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let floor, scale = 0;
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
    const glow = c.createRadialGradient(320, 240, 25, 320, 240, 430);
    glow.addColorStop(0, '#24434d'); glow.addColorStop(.56, '#172b38'); glow.addColorStop(1, '#080e19');
    c.fillStyle = glow; c.fillRect(0, 0, WIDTH, HEIGHT);
    for (let x = 16; x < WIDTH; x += 32) line(c, x, 18, x, HEIGHT - 18, '#273d46');
    for (let y = 14; y < HEIGHT; y += 32) line(c, 16, y, WIDTH - 16, y, '#273d46');
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
    for (const {x, y} of DOCKS) {
      c.save(); c.translate(x, y); if (x > 320) c.scale(-1, 1);
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

  function station(s) {
    const { x, y } = STATION;
    const raising = s.phase === 'approach' ? Math.min(1, s.phaseTime / 2.4) : 1;
    const waiting = s.phase === 'combat' && !s.defense && s.time >= s.powerUntil;
    const wrong = s.defense || (s.phase === 'result' && s.event.type === 'wrong');
    const color = wrong ? '#ff765e' : s.time < s.powerUntil || s.phase === 'result' ? '#ffd477' : '#72efdb';
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

  function draw(s, moveStick, aimStick, mouse) {
    ctx.drawImage(floor, 0, 0, WIDTH, HEIGHT);
    station(s);
    const fighting = isFighting(s);
    for (const coin of s.coins) {
      disk(ctx, coin.x, coin.y + 2, 7, '#936438');
      disk(ctx, coin.x, coin.y, 6, '#ffd578');
      line(ctx, coin.x, coin.y - 3, coin.x, coin.y + 3, '#fff1bd', 2);
    }
    for (const enemy of s.enemies) {
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
    if (s.time < s.hurtUntil) ring(ctx, p.x, p.y, 25, '#ff8069', 3);
    else if (s.time < s.powerUntil || s.time < s.shieldUntil) ring(ctx, p.x, p.y, 25, s.time < s.powerUntil ? '#ffd179' : '#7ee8dd');
    if (s.time < s.dashUntil && !reducedMotion.matches) {
      disk(ctx, p.x - p.dx * 27, p.y - p.dy * 27, 13, '#327678aa');
      disk(ctx, p.x - p.dx * 45, p.y - p.dy * 45, 8, '#225358aa');
    }
    robot(p, 'player', 18, s.time < s.hurtUntil);
    if (s.time < s.muzzleUntil) disk(ctx, p.x + Math.cos(p.angle) * 32, p.y + Math.sin(p.angle) * 32, 4, '#fff2bf');
    if (moveStick) stick(moveStick, '#91e4d7af');
    if (aimStick) stick(aimStick, '#ffc981c5');
    if (mouse) {
      ring(ctx, mouse.x, mouse.y, 9, '#ffda8d');
      line(ctx, mouse.x - 4, mouse.y, mouse.x + 4, mouse.y, '#ffda8d');
    }
  }

  function resize() {
    const nextScale = Math.min(1.55, Math.max(.45, canvas.clientWidth * (window.devicePixelRatio || 1) / WIDTH));
    if (floor && Math.abs(nextScale - scale) < .025) return;
    scale = nextScale;
    canvas.width = Math.ceil(WIDTH * scale); canvas.height = Math.ceil(HEIGHT * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    floor = makeFloor(); sprites.clear();
    for (const kind of Object.keys(COLORS)) { sprite(kind, false); sprite(kind, true); }
  }

  return { draw, resize };
}
