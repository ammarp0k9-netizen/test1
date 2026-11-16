import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repo = new URL('../', import.meta.url);
const source = await readFile(new URL('js/personal-dictionary-onboarding.js', repo), 'utf8');
const dictionary = await readFile(new URL('js/dictionary.js', repo), 'utf8');
const oldKey = 'lootlingua:personal-dictionary-onboarding:v1:';
const statsKey = 'lootlingua:contextual-onboarding:v1:full-stats:';
const coachId = 'contextualStatsCoach';

function setup(values = new Map(), uid) {
  const listeners = new Map();
  const observers = new Set();
  const tasks = [];
  const resumes = new Map();
  const writes = [];
  const panel = {
    isConnected: true, hidden: false, inert: false,
    getAttribute() { return String(this.hidden); },
    classList: { contains: name => name === 'show' && !panel.hidden },
    closest: () => panel.inert ? panel : null,
    querySelector: () => ({ getClientRects: () => [{}] }),
  };
  let active = null;
  let busyNode = false;
  let navigationCalls = 0;
  let profileWrites = 0;
  const event = (name, detail) => {
    for (const callback of listeners.get(name) || []) callback({ detail });
  };
  const root = {
    auth: { currentUser: uid ? { uid } : null },
    getOnboardingView: () => 'personal',
    loadPersonalDictionary() { navigationCalls++; },
    openStatsPanel() { navigationCalls++; },
    queueProfileIntent() { profileWrites++; },
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) || []), callback]);
    },
    dispatchEvent(message) { event(message.type, message.detail); },
    LootLinguaPopover: {
      getActiveId: () => active?.id || '',
      open(options) { assert.equal(active, null); active = options; return {}; },
      closeIf(id) {
        if (active?.id !== id) return;
        active = null;
        event('lootlingua:popover-closed', { id });
      },
      offerResume(id, value) { resumes.set(id, value); },
    },
  };
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  const document = {
    body: { matches: () => false },
    documentElement: { classList: { contains: () => false } },
    addEventListener() {},
    getElementById: id => id === 'statsPanel' ? panel : null,
    querySelectorAll: () => busyNode ? [{ getClientRects: () => [{}] }] : [],
    createElement: tag => ({
      tag, children: [],
      append(...items) { this.children.push(...items); },
      addEventListener(_name, callback) { this.click = callback; },
    }),
  };
  const storage = {
    getItem: key => values.get(key) || null,
    setItem(key, value) { writes.push(key); values.set(key, value); },
    removeItem: key => values.delete(key),
  };
  new Function('window', 'document', 'localStorage', 'setTimeout', 'CustomEvent',
    'MutationObserver', 'getComputedStyle', 'queueMicrotask', source)(
    root, document, storage, () => {}, class {}, Observer, () => ({ visibility: 'visible' }), fn => tasks.push(fn)
  );
  const api = root.LootLinguaPersonalDictionaryOnboarding;
  return {
    root, api, panel, resumes, writes, values, event,
    get observerCount() { return observers.size; },
    get navigationCalls() { return navigationCalls; },
    get profileWrites() { return profileWrites; },
    get active() { return active?.id; },
    setBusy(value) { busyNode = value; },
    setActive(id) { active = id ? { id } : null; },
    visit(useful = true) { panel.hidden = false; api.onStatsOpened(panel, useful); },
    mutate() { for (const observer of observers) observer.callback(); },
    flush() { while (tasks.length) tasks.shift()(); },
    choose(label) { active.content.children.at(-1).children.find(button => button.textContent === label).click(); },
  };
}
const legacy = (step, phase = 'intro') => JSON.stringify({ version: 1, phase, step });

test('a stats visit can explain its numbers at legacy step 3 and preserves the original resume point', () => {
  const key = oldKey + 'user:learner';
  const h = setup(new Map([[key, legacy(2)]]), 'learner');
  h.setActive('personalDictionaryOnboardingCoach');
  h.visit();
  assert.equal(h.active, coachId);
  assert.equal(h.api.getState().step, 2);
  assert.equal(h.values.get(key), legacy(2));
  assert.ok(h.resumes.get('personalDictionaryOnboardingCoach')?.open);
  assert.equal(h.navigationCalls, 0);
  assert.equal(h.profileWrites, 0);
});

test('a new learner sees useful stats, while empty stats and previously covered steps do not show', () => {
  const h = setup();
  h.visit(false);
  assert.equal(h.active, undefined);
  h.visit();
  assert.equal(h.active, coachId);
  for (const record of [legacy(16, 'completed'), legacy(12)]) {
    const returning = setup(new Map([[oldKey + 'guest', record]]));
    returning.visit();
    assert.equal(returning.active, undefined);
    assert.equal(returning.observerCount, 0);
  }
});

test('completion and skipping are remembered independently after refresh and for the correct owner', () => {
  for (const [action, expected] of [['فهمت', 'completed'], ['تخطي', 'skipped']]) {
    const values = new Map();
    const h = setup(values, 'a');
    h.visit();
    h.choose(action);
    assert.equal(values.get(statsKey + 'user:a'), expected);
    assert.deepEqual(h.writes, [statsKey + 'user:a']);
    assert.equal(h.observerCount, 0);
    const refreshed = setup(values, 'a');
    refreshed.visit();
    assert.equal(refreshed.active, undefined);
    refreshed.root.auth.currentUser = { uid: 'b' };
    refreshed.event('lootlingua:auth-state');
    refreshed.visit();
    assert.equal(refreshed.active, coachId);
    assert.equal(refreshed.profileWrites, 0);
  }
});

test('closing, navigation and switching accounts do not mark a deferred stats guide as seen', () => {
  const h = setup();
  h.visit();
  h.panel.hidden = true;
  h.mutate();
  assert.equal(h.active, undefined);
  assert.equal(h.observerCount, 0);
  h.visit();
  assert.equal(h.active, coachId);
  h.event('lootlingua:dictionary-navigation');
  assert.equal(h.active, undefined);
  h.visit();
  h.choose('تخطي');
  h.root.auth.currentUser = { uid: 'a' };
  h.event('lootlingua:auth-state');
  h.visit();
  assert.equal(h.active, coachId);
  h.root.auth.currentUser = null;
  h.event('lootlingua:auth-state');
  h.visit();
  assert.equal(h.active, undefined);
  assert.equal(h.values.get(statsKey + 'guest'), 'skipped');
});

test('busy work and another open guide defer stats without replacing them', () => {
  for (const flag of ['hasActiveLearningQuiz', '__lootlinguaRunnerInputActive', '__lootlinguaQuizLearningCommitDepth']) {
    const h = setup();
    h.root[flag] = flag === 'hasActiveLearningQuiz' ? () => true : 1;
    h.visit();
    assert.equal(h.active, undefined);
    delete h.root[flag];
    h.mutate();
    assert.equal(h.active, coachId);
  }
  const h = setup();
  h.setActive('featureMiniOnboardingCoach');
  h.visit();
  assert.equal(h.active, 'featureMiniOnboardingCoach');
  h.root.LootLinguaPopover.closeIf('featureMiniOnboardingCoach');
  h.setBusy(true);
  h.flush();
  assert.equal(h.active, undefined);
  h.setBusy(false);
  h.mutate();
  assert.equal(h.active, coachId);
});

test('stats opening delivers only rendered data and explicit full-tour stats do not trigger the contextual guide', async () => {
  const begin = dictionary.indexOf('let statsPanelRequest');
  const openCode = dictionary.slice(begin, dictionary.indexOf('function closeStatsPanel', begin));
  const calls = [];
  const panel = { style: {}, setAttribute() {}, querySelector() { return {}; }, classList: { add() {} } };
  const root = {
    LootLinguaDictionaryPages: { async requireComplete() { calls.push('existing complete load'); return true; } },
    LootLinguaPersonalDictionaryOnboarding: { onStatsOpened(node, useful) { assert.equal(node, panel); calls.push(useful); } },
  };
  const open = new Function('window', 'document', 'setTimeout', 'lockBackgroundScroll', 'renderHeatmap', 'renderStatsNumbers',
    'setAppRoute', 'closeStatsPanel', openCode + '\nreturn openStatsPanel;')(
    root, { getElementById: () => panel }, fn => fn(), () => {}, () => calls.push('render heatmap'),
    () => { calls.push('render counts'); return true; }, () => {}, () => {}
  );
  await open();
  assert.deepEqual(calls, ['existing complete load', 'render heatmap', 'render counts', true]);
  calls.length = 0;
  await open({ fromTour: true });
  assert.deepEqual(calls, ['existing complete load', 'render heatmap', 'render counts']);
});
