import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
function preview(reducedMotion = false) {
  const frames = new Map(), clicks = new Map(), events = new Map(), draws = [];
  let nextFrame = 0, intersection;
  const stage = { clientWidth: 480, clientHeight: 480 }, canvas = { parentElement: stage };
  const toggle = { addEventListener: (name, callback) => clicks.set(name, callback), setAttribute() {} };
  const question = {}, options = { style: {} };
  const host = { isConnected: true, classList: { add() {} }, querySelector: selector => ({ canvas, '[data-runner-preview-pause]': toggle, '.landing-runner-question': question, '.landing-runner-options': options })[selector] };
  const document = { hidden: false, querySelector: () => host, addEventListener: (name, callback) => events.set(name, callback) };
  const root = { document, matchMedia: () => ({ matches: reducedMotion, addEventListener() {} }), addEventListener: (name, callback) => events.set(name, callback) };
  const context = vm.createContext({ window: root, document,
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: class { constructor(callback) { intersection = callback; } observe() {} }, ResizeObserver: class { observe() {} },
  });
  vm.runInContext(read('js/runner-engine.js'), context);
  root.LootLinguaRunnerRenderer = { createRenderer: () => ({ resize() {}, project: () => ({ labelY: 200 }), draw(state) { draws.push({ hearts: state.hearts, action: state.action, floor: root.LootLinguaRunnerEngine.getPose(state).floor, correct: state.feedback?.correct, entities: state.entities.length }); } }) };
  const code = read('js/landing-runner-preview.js').replace(/await Promise\.all\(\[import\([^\n]+\]\);/, '');
  vm.runInContext(code, context);
  return { draws, frames, clicks, events, document, enter: () => intersection([{ isIntersecting: true }]), leave: () => intersection([{ isIntersecting: false }]), step(now) { const [id, callback] = frames.entries().next().value || []; if (callback) { frames.delete(id); callback(now); } } };
}

test('landing demo clears obstacles, climbs the truck and answers its gate correctly while remaining bounded', () => {
  const h = preview(); assert.equal(h.draws.length, 0, 'offscreen preview stays unloaded');
  h.enter();
  for (let frame = 1; frame < 950; frame++) h.step(frame * 34);
  assert.ok(h.draws.some(draw => draw.action === 'jump'));
  assert.ok(h.draws.some(draw => draw.action === 'slide'));
  assert.ok(h.draws.some(draw => draw.floor === 1.05));
  assert.ok(h.draws.some(draw => draw.correct === true));
  assert.ok(h.draws.every(draw => draw.hearts === 3 && draw.entities <= 48));
  h.leave(); assert.equal(h.frames.size, 0);
});

test('reduced motion shows a populated still scene; explicit play and hidden-page suspension work', () => {
  const h = preview(true); h.enter();
  assert.ok(h.draws[0].entities >= 10); assert.equal(h.frames.size, 0);
  h.clicks.get('click')(); assert.equal(h.frames.size, 1);
  h.document.hidden = true; h.events.get('visibilitychange')(); assert.equal(h.frames.size, 0);
  const html = read('landing.html'); assert.ok(html.indexOf('id="runner"') < html.indexOf('id="review"'));
});
