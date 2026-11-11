import { WIDTH, HEIGHT } from './loot-bots-engine.mjs?v=1';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const floor = document.createElement('canvas');
  floor.width = WIDTH; floor.height = HEIGHT;
  const bg = floor.getContext('2d');
  const glow = bg.createRadialGradient(320, 270, 40, 320, 270, 405);
  glow.addColorStop(0, '#17333c'); glow.addColorStop(1, '#0a121d');
  bg.fillStyle = glow; bg.fillRect(0, 0, WIDTH, HEIGHT);
  bg.strokeStyle = '#29444c'; bg.globalAlpha = .5;
  for (let x = 0; x < WIDTH; x += 40) { bg.beginPath(); bg.moveTo(x, 0); bg.lineTo(x, HEIGHT); bg.stroke(); }
  for (let y = 10; y < HEIGHT; y += 40) { bg.beginPath(); bg.moveTo(0, y); bg.lineTo(WIDTH, y); bg.stroke(); }
  bg.globalAlpha = 1; bg.strokeStyle = '#355a5f'; bg.lineWidth = 2;
  bg.strokeRect(12, 12, WIDTH - 24, HEIGHT - 24);
  bg.strokeStyle = '#24414b'; bg.lineWidth = 5;
  for (const x of [48, WIDTH - 48]) {
    const inset = x < WIDTH / 2 ? 1 : -1;
    bg.beginPath(); bg.moveTo(x, 72); bg.lineTo(x, 187); bg.lineTo(x + inset * 24, 213);
    bg.lineTo(x + inset * 24, 327); bg.lineTo(x, 353); bg.lineTo(x, 468); bg.stroke();
  }
  bg.lineWidth = 1;
  bg.setLineDash([5, 9]); bg.strokeStyle = '#33545e';
  bg.beginPath(); bg.arc(320, 270, 96, 0, Math.PI * 2); bg.stroke();
  bg.setLineDash([]);
  for (const x of [24, WIDTH - 116]) {
    for (const y of [23, HEIGHT - 35]) {
      bg.fillStyle = '#182f39'; bg.fillRect(x, y, 92, 12);
      bg.fillStyle = '#577d75'; bg.fillRect(x + 6, y + 4, 18, 4);
      bg.fillStyle = '#a38659'; bg.fillRect(x + 30, y + 4, 6, 4);
    }
  }

  function disk(x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  function ring(x, y, r, color, thickness = 2) {
    ctx.strokeStyle = color; ctx.lineWidth = thickness;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }
  function robot(bot, color, radius, player, flash = false) {
    ctx.save(); ctx.translate(bot.x, bot.y);
    disk(0, 5, radius + 4, '#081318');
    ctx.rotate(bot.angle); ctx.scale(radius / 16, radius / 16);
    ctx.fillStyle = '#111c2b'; ctx.fillRect(-14, -14, 24, 28);
    ctx.fillStyle = '#425461'; ctx.fillRect(-12, -15, 18, 5); ctx.fillRect(-12, 10, 18, 5);
    ctx.fillStyle = flash ? '#fff3d7' : color;
    ctx.beginPath(); ctx.moveTo(-11, -10); ctx.lineTo(8, -10); ctx.lineTo(15, -5); ctx.lineTo(15, 5);
    ctx.lineTo(8, 10); ctx.lineTo(-11, 10); ctx.lineTo(-15, 5); ctx.lineTo(-15, -5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff52'; ctx.fillRect(-10, -10, 17, 2);
    ctx.fillStyle = '#08162266'; ctx.fillRect(-10, 8, 17, 2);
    ctx.fillStyle = '#253947'; ctx.fillRect(-7, -7, 13, 14);
    ctx.fillStyle = player ? '#f7d486' : '#ffe4cb'; ctx.fillRect(1, -4, 4, 8);
    ctx.fillStyle = '#bccdd1'; ctx.fillRect(11, -2, player ? 12 : 5, 4);
    ctx.restore();
  }
  function draw(s, joystick) {
    ctx.drawImage(floor, 0, 0);
    for (const coin of s.coins) {
      disk(coin.x, coin.y + 2, 7, '#82572f');
      disk(coin.x, coin.y, 6, '#f5c969');
      ctx.fillStyle = '#fff1a8'; ctx.fillRect(coin.x - 1, coin.y - 3, 2, 6);
    }
    for (const enemy of s.enemies) {
      if (s.phase !== 'core' && s.time < enemy.ready) {
        const progress = 1 - (enemy.ready - s.time);
        disk(enemy.x, enemy.y, 23, '#391e34');
        ring(enemy.x, enemy.y, 11 + progress * 13, enemy.color);
        if (progress > .55) {
          ctx.globalAlpha = Math.min(1, (progress - .55) / .45);
          robot(enemy, enemy.color, enemy.radius, false);
          ctx.globalAlpha = 1;
        }
        continue;
      }
      ctx.globalAlpha = s.phase === 'core' ? .3 : 1;
      if (s.phase === 'combat' && enemy.chargeAt > s.time) ring(enemy.x, enemy.y, enemy.radius + 8, '#ffb5d2');
      robot(enemy, enemy.color, enemy.radius, false, s.time < enemy.hitUntil);
      ctx.globalAlpha = 1;
    }
    if (s.question) s.question.options.forEach((option, index) => {
      const wrong = s.question.wrong.has(index), color = wrong ? '#c96d87' : '#6acabb';
      const { x, y } = option;
      disk(x, y + 12, 32, wrong ? '#412735' : '#1c4249');
      ring(x, y + 12, 32, color);
      ring(x, y + 12, 25, wrong ? '#623249' : '#32676c', 1);
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y + 40); ctx.lineTo(x, y + 52); ctx.stroke();
    });
    for (const shot of s.shots) {
      ctx.strokeStyle = shot.powered ? '#ffe18d' : '#8fffe2'; ctx.lineWidth = shot.powered ? 4 : 2.5;
      ctx.beginPath(); ctx.moveTo(shot.x - shot.dx * 13, shot.y - shot.dy * 13);
      ctx.lineTo(shot.x, shot.y); ctx.stroke();
    }
    if (!reducedMotion.matches) for (const spark of s.sparks) {
      ctx.globalAlpha = spark.life / .22;
      ctx.fillStyle = spark.color; ctx.fillRect(spark.x, spark.y, 3, 3);
    }
    ctx.globalAlpha = 1;
    const p = s.player;
    if (s.phase === 'combat' && (s.time < s.powerUntil || s.time < s.shieldUntil)) ring(p.x, p.y, 26, s.time < s.powerUntil ? '#ffd179' : '#7ee8dd');
    if (s.phase === 'combat' && s.time < s.dashUntil) {
      disk(p.x - p.dx * 27, p.y - p.dy * 27, 13, '#236066');
      disk(p.x - p.dx * 45, p.y - p.dy * 45, 9, '#184149');
    }
    robot(p, '#65dbcb', 18, true, s.time < s.shieldUntil && s.time >= s.powerUntil);
    if (joystick) {
      disk(joystick.x, joystick.y, 44, '#142c3b99');
      ring(joystick.x, joystick.y, 44, '#89bbba99');
      disk(joystick.x + joystick.dx * 34, joystick.y + joystick.dy * 34, 15, '#a3ddd7b5');
    }
  }
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(WIDTH * ratio), height = Math.round(HEIGHT * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  resize();
  return { draw, resize };
}
