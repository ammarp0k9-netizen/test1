import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../js/script.js', import.meta.url), 'utf8');
const router = script.slice(script.indexOf('const APP_VIEW_ROUTES'), script.indexOf('function closeRouteEntry'));

function harness(pathname, { auth = null, navigation = 'navigate' } = {}) {
  const opened = [];
  const customWorlds = [];
  const location = new URL(pathname, 'https://example.github.io');
  const window = Object.assign(new EventTarget(), {
    auth,
    performance: { getEntriesByType: () => [{ type: navigation }] },
    loadCustomWorld: id => opened.push(['private', id]),
    showCustomWorldsTab: () => opened.push('private-tab'),
    loadPublishedContentRoute: route => opened.push(['published', route.params.gateId]),
  });
  const history = {
    state: null,
    replaceState(state, _, url) { this.state = state; location.href = new URL(url, location).href; },
    pushState(state, _, url) { this.replaceState(state, _, url); },
  };
  const context = vm.createContext({
    window, location, history, customWorlds, currentView: 'personal', CustomEvent,
    document: { querySelectorAll: () => [], getElementById: () => null },
    queueMicrotask,
    loadPersonalDictionary: () => opened.push('dictionary'),
    loadTreasureView: () => opened.push('treasure'),
    loadWorldsView: () => opened.push('worlds'),
    prepareWorldsShell: () => opened.push('worlds-shell'),
  });
  vm.runInContext(router, context);
  return { window, location, history, opened, customWorlds, context };
}

test('named pages survive authentication on boot and retain their query and fragment', () => {
  const app = harness('/test1/app/treasure/?foo=1#panel', { auth: { currentUser: { uid: 'account' } } });
  app.context.handleInitialRouting();
  assert.deepEqual(app.opened, []);
  app.window.__lootlinguaInitialDataReady = true;
  app.window.dispatchEvent(new Event('lootlingua:initial-data-ready'));
  assert.deepEqual(app.opened, ['treasure']);
  assert.equal(app.location.pathname + app.location.search + app.location.hash, '/test1/app/treasure?foo=1#panel');
  assert.equal(app.window.shouldPreserveEntryRoute(), true);
});

test('a named dictionary or a reload is preserved, while a fresh app root can resume learning', () => {
  const direct = harness('/test1/app/dictionary');
  direct.context.handleInitialRouting();
  assert.deepEqual(direct.opened, ['dictionary']);
  assert.equal(direct.window.shouldPreserveEntryRoute(), true);
  const root = harness('/test1/app/');
  root.context.handleInitialRouting();
  assert.equal(root.location.pathname, '/test1/app/dictionary');
  assert.equal(root.window.shouldPreserveEntryRoute(), false);
  assert.equal(harness('/test1/app', { navigation: 'reload' }).window.shouldPreserveEntryRoute(), true);
});

test('a private dictionary link waits for its owner and opens when the existing snapshot arrives', () => {
  const app = harness('/test1/private-worlds/%D8%B9%D8%A7%D9%84%D9%85', { auth: { currentUser: { uid: 'owner' } } });
  app.context.handleInitialRouting();
  assert.deepEqual(app.opened, []);
  app.window.__lootlinguaInitialDataReady = true;
  app.window.dispatchEvent(new Event('lootlingua:initial-data-ready'));
  assert.deepEqual(app.opened, ['worlds-shell', 'private-tab']);
  app.customWorlds.push({ id: 'عالم' });
  app.window.dispatchEvent(new CustomEvent('lootlingua:custom-worlds-updated', { detail: { uid: 'other' } }));
  assert.equal(app.opened.length, 2);
  app.window.dispatchEvent(new CustomEvent('lootlingua:custom-worlds-updated', { detail: { uid: 'owner' } }));
  assert.deepEqual(app.opened.at(-1), ['private', 'عالم']);
  assert.equal(app.history.state.key, 'customWorld');
  assert.equal(app.location.pathname, '/test1/private-worlds/%D8%B9%D8%A7%D9%84%D9%85');
});

test('private tabs and published gate links remain distinct on reload', () => {
  const tab = harness('/test1/private-worlds');
  tab.context.handleInitialRouting();
  assert.deepEqual(tab.opened, ['worlds-shell', 'private-tab']);
  const gate = harness('/test1/worlds/world/ranks/rank/gates/gate');
  gate.context.handleInitialRouting();
  assert.deepEqual(gate.opened, [['published', 'gate']]);
});
