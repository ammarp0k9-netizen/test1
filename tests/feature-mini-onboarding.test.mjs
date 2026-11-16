import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/feature-mini-onboarding.js', import.meta.url), 'utf8');
function harness(feature, step = 0) {
  let state = { status: 'in-progress', step };
  let coach;
  let panelVisible = false;
  const events = new Map();
  const root = {
    LootLinguaFeatureDiscovery: {
      getState: () => ({ features: { [feature]: state } }),
      getStatus: () => state.status,
      checkpoint: (_, value) => { state = { ...state, step: value }; },
      complete: () => { state = { ...state, status: 'completed' }; },
      skip: () => { throw new Error('Step skipping must never dismiss the whole tour'); },
      evaluate() {},
    },
    LootLinguaPopover: { open: options => { coach = options; return options; }, closeIf: () => { coach = null; } },
    getOnboardingView: () => feature === 'custom-worlds' ? 'worlds' : feature,
    openCustomWorldModal: () => { panelVisible = true; },
    hideModal: () => { panelVisible = false; },
    openQuizModeSettings: () => { panelVisible = true; },
    addEventListener: (name, listener) => events.set(name, listener),
  };
  const document = {
    createElement: () => ({ children: [], listeners: {}, append(...nodes) { this.children.push(...nodes); }, addEventListener(name, fn) { this.listeners[name] = fn; } }),
    querySelector: selector => ({
      getClientRects: () => !['#customWorldNameInput', '#customWorldSaveBtn'].includes(selector) || panelVisible ? [{}] : [],
      scrollIntoView() {},
    }),
    querySelectorAll: () => [],
    getElementById: () => ({ getClientRects: () => panelVisible ? [{}] : [], classList: { contains: name => name === 'active' } }),
    addEventListener() {},
  };
  new Function('window', 'document', 'setTimeout', 'setInterval', source)(root, document, fn => fn(), () => {});
  return {
    start: () => root.LootLinguaFeatureMiniOnboarding.start(feature),
    state: () => state,
    panelVisible: () => panelVisible,
    openForm: () => { panelVisible = true; },
    skip() {
      const actions = coach.content.children.at(-1);
      const button = actions.children.find(node => node.className === 'feature-mini-onboarding-skip');
      assert.equal(button.textContent, 'تخطي');
      button.listeners.click();
    },
    emit: name => events.get(name)?.(),
  };
}
test('skip advances one checkpoint and keeps the remaining discovery active', () => {
  const h = harness('treasure'); h.start(); h.skip();
  assert.deepEqual(h.state(), { status: 'in-progress', step: 1 });
  h.skip(); assert.equal(h.state().step, 2);
});
test('skipping an interaction saves its checkpoint without opening a form', () => {
  const h = harness('custom-worlds', 2); h.start(); h.skip();
  assert.equal(h.state().step, 3);
  assert.equal(h.state().status, 'in-progress');
  assert.equal(h.panelVisible(), false);
});
test('saving from a form opened by the user reaches the final explanation', () => {
  const h = harness('custom-worlds', 4); h.openForm(); h.start();
  h.emit('lootlingua:custom-world-saved');
  assert.equal(h.state().step, 5);
  assert.equal(h.state().status, 'in-progress');
  h.start(); h.skip();
  assert.equal(h.state().status, 'completed');
});
