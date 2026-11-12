import { createRenderer } from './loot-bots-renderer.mjs?v=6';
import { DEFAULT_ARENA, makeCover } from './loot-bots-arena.mjs?v=3';

export function mountPreview(canvas) {
  const renderer = createRenderer(canvas);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const player = { x: 315, y: 354, angle: 0, dx: 1, dy: 0 };
  const enemies = [
    { x: 400, y: 210, kind: 'striker', radius: 16, ready: 0, angle: 0, color: '#ff75a8' },
    { x: 190, y: 188, kind: 'gunner', radius: 18, ready: 0, angle: 0, color: '#ffd47d' },
  ];
  const shots = [{}, {}, {}];
  const state = { phase: 'combat', phaseTime: 0, time: 0, player, enemies, shots, sparks: [], cover: makeCover(DEFAULT_ARENA),
    coins: [{ x: 466, y: 327 }, { x: 437, y: 339 }, { x: 409, y: 348 }] };
  let visible = false, timer = 0, previous = 0;

  function draw() {
    const t = state.time;
    player.x = 309 + Math.sin(t * 1.1) * 119; player.y = 346 + Math.cos(t * 1.9) * 29;
    enemies[0].x = 431 + Math.sin(t * .9) * 49; enemies[0].y = 211 + Math.cos(t * 1.2) * 33;
    enemies[1].x = 163 + Math.cos(t) * 33; enemies[1].y = 186 + Math.sin(t * 1.3) * 29;
    for (const enemy of enemies) enemy.angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    player.angle = Math.atan2(enemies[0].y - player.y, enemies[0].x - player.x);
    state.muzzleUntil = t % .44 < .075 ? t + .1 : 0;
    for (let i = 0; i < shots.length; i++) {
      const hostile = i === 2, start = hostile ? enemies[1] : player, end = hostile ? player : enemies[0];
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const progress = (t * (hostile ? .72 : 1.85) + i * .49) % 1;
      Object.assign(shots[i], { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress,
        dx: Math.cos(angle), dy: Math.sin(angle), hostile });
    }
    renderer.draw(state);
  }

  const allowed = () => visible && !document.hidden && !window.__lootlinguaRunnerInputActive && canvas.isConnected;
  function tick() {
    timer = 0;
    if (!allowed()) return;
    const now = performance.now();
    state.time += previous ? Math.min(.1, (now - previous) / 1000) : 0;
    previous = now;
    draw();
    if (!motion.matches) timer = window.setTimeout(tick, 1000 / 24);
  }
  function refresh() {
    clearTimeout(timer); timer = 0; previous = 0;
    if (!allowed()) return;
    renderer.resize(); tick();
  }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); }, { threshold: .1 }).observe(canvas);
  window.addEventListener('resize', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('lootlingua:runner-input-active', refresh);
  window.addEventListener('lootlingua:runner-input-inactive', refresh);
  motion.addEventListener('change', refresh);
}
