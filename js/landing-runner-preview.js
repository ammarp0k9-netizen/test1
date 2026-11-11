// Isolated, silent demonstration. No account, Firestore, rewards or game input.
const host = document.querySelector('[data-landing-runner]');
if (host) {
  const canvas = host.querySelector('canvas'), stage = canvas.parentElement;
  const toggle = host.querySelector('[data-runner-preview-pause]');
  const question = host.querySelector('.landing-runner-question'), options = host.querySelector('.landing-runner-options');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches, visible = false, loading = false, renderer, engine, state, raf = 0, previous = 0;
  const allowed = () => visible && !document.hidden && !paused && host.isConnected;
  function syncToggle() { toggle.textContent = paused ? 'تشغيل العرض' : 'إيقاف العرض'; toggle.setAttribute('aria-pressed', String(paused)); }
  function reset() {
    state = engine.createState([]); state._nextRowAt = state._nextGateAt = Infinity;
    const add = values => {
      const entity = state._pool.pop();
      Object.assign(entity, { id: state._nextId++, active: true, resolved: false, bornAt: -1000, length: 0 }, values);
      state.entities.push(entity); return entity;
    };
    add({ kind: 'obstacle', obstacleType: 'low', lane: 1, z: 16, row: 1, demoRoute: true });
    add({ kind: 'coin', lane: 1, z: 6, height: .44 });
    add({ kind: 'coin', lane: 1, z: 16, height: 1.5, requires: 'jump' });
    add({ kind: 'obstacle', obstacleType: 'duckwall', lane: 2, z: 42, row: 2, demoRoute: true });
    add({ kind: 'obstacle', obstacleType: 'wall', lane: 0, z: 42, row: 2 });
    add({ kind: 'obstacle', obstacleType: 'train', lane: 0, z: 68, length: 20, row: 3, demoRoute: true });
    add({ kind: 'coin', lane: 0, z: 78, height: 1.49 });
    add({ kind: 'coin', lane: 0, z: 83, height: 1.49 });
    add({ kind: 'obstacle', obstacleType: 'wall', lane: 1, z: 68, row: 3 });
    add({ kind: 'obstacle', obstacleType: 'overhead', lane: 2, z: 68, row: 3 });
    add({ kind: 'gate', lane: 1, z: 140, length: 42, word: 'lantern', correctMeaning: 'فانوس', options: ['جسر', 'فانوس', 'نهر'], correctLane: 1 });
  }
  function draw() {
    renderer.draw(state);
    const gate = state.entities.find(item => item.kind === 'gate');
    const reading = gate && gate.z <= 64 && !gate.resolved;
    question.hidden = options.hidden = !reading;
    if (reading) {
      const p = renderer.project(1, gate.z);
      options.style.top = `${Math.max(stage.clientHeight * .32, Math.min(stage.clientHeight * .59, p.labelY))}px`;
    }
  }
  function frame(now) {
    raf = 0;
    if (!allowed()) return;
    if (!previous) previous = now;
    if (now - previous >= 33) {
      const delta = Math.min(50, now - previous); previous = now;
      const gate = state.entities.find(item => item.kind === 'gate');
      if (gate && gate.z <= 64 && !gate.resolved) { state.gate = gate; engine.move(state, gate.correctLane); }
      else if (!gate?.resolved) {
        const route = state.entities.filter(item => item.demoRoute && !item.resolved && item.z > 0).sort((a,b) => a.z - b.z)[0];
        if (route) {
          engine.move(state, route.lane);
          if (engine.getAction(state) === 'run') {
            if (route.obstacleType === 'low' && route.z / state.speed < .28) engine.jump(state);
            if (route.obstacleType === 'duckwall' && route.z / state.speed < .22) engine.slide(state);
          }
        }
      }
      engine.update(state, delta);
      if (state.over || !gate || gate.z + gate.length < -12) reset();
      draw();
    }
    raf = requestAnimationFrame(frame);
  }
  async function resume() {
    cancelAnimationFrame(raf); raf = 0; previous = 0;
    if (!visible || document.hidden || !host.isConnected || loading) return;
    if (!renderer) {
      loading = true;
      try {
        await Promise.all([import('./runner-engine.js?v=20261111-runner-1'), import('./runner-renderer.js?v=20261111-runner-1')]);
        engine = window.LootLinguaRunnerEngine;
        renderer = window.LootLinguaRunnerRenderer.createRenderer(canvas, { width: stage.clientWidth, height: stage.clientHeight, dprCap: 1 });
        reset(); draw(); host.classList.add('is-ready');
      } catch { toggle.hidden = true; return; }
      finally { loading = false; }
    }
    if (allowed()) raf = requestAnimationFrame(frame);
  }
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; void resume(); }); observer.observe(host);
  const resize = new ResizeObserver(() => { if (renderer && visible) { renderer.resize(stage.clientWidth, stage.clientHeight); draw(); } }); resize.observe(stage);
  toggle.addEventListener('click', () => { paused = !paused; syncToggle(); void resume(); });
  reduced.addEventListener('change', () => { paused = reduced.matches; syncToggle(); void resume(); });
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', () => { cancelAnimationFrame(raf); raf = 0; previous = 0; });
  window.addEventListener('pageshow', resume);
  syncToggle();
}
