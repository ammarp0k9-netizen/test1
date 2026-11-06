import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/startup-recovery.js', import.meta.url), 'utf8');
function harness() {
  const timers = new Map(), listeners = new Map(), idle = [], calls = { reloads: 0, guestLoads: 0, boots: 0, marks: [] };
  let nextTimer = 0;
  class Node {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.events = {}; this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = value; }
    hasAttribute(name) { return name in this.attributes; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener(type, listener) { this.events[type] = listener; }
    querySelector(selector) {
      const key = { '[data-startup-message]': 'startupMessage', '[data-startup-guest]': 'startupGuest', '[data-startup-retry]': 'startupRetry' }[selector];
      return this.children.find(child => key in child.dataset) || null;
    }
    replaceWith(node) { this.replacement = node; }
  }
  const overlay = new Node(), template = new Node('template');
  template.dataset.startupScript = 'js/oasis-preview-animation.js';
  const root = {
    location: { reload() { calls.reloads++; } },
    performance: { mark(name) { calls.marks.push(name); } },
    requestIdleCallback(callback) { idle.push(callback); },
    addEventListener(type, listener) { const entries = listeners.get(type) || []; entries.push(listener); listeners.set(type, entries); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
    loadGuestDictionaryState(options) { assert.deepEqual({ ...options }, { renderView: false }); calls.guestLoads++; },
    LootLinguaEntryExperienceController: { async boot() { calls.boots++; } },
  };
  const context = vm.createContext({ window: root, document: {
    getElementById: id => id === 'smartLoadingOverlay' ? overlay : null,
    createElement: tag => new Node(tag), querySelectorAll: () => [template],
  }, setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
  clearTimeout(id) { timers.delete(id); }, CustomEvent: class { constructor(type) { this.type = type; } } });
  vm.runInContext(source, context);
  const fire = (type, extra = {}) => root.dispatchEvent({ type, ...extra });
  const failModule = () => { const target = new Node('script'); target.setAttribute('data-startup-critical', ''); fire('error', { target }); };
  return { root, overlay, calls, timers, idle, template, fire, failModule, panel: () => overlay.children[0] };
}

test('a failed Firebase module provides retry without fabricating guest auth or opening account data', async () => {
  const h = harness();
  h.root.words = [{ id: 'private-account-word' }];
  h.failModule();
  const panel = h.panel();
  assert.ok(panel);
  assert.equal(panel.querySelector('[data-startup-guest]').hidden, true);
  assert.equal(await h.root.LootLinguaStartupRecovery.continueGuest(), false);
  assert.equal(h.calls.boots, 0);
  assert.equal(h.calls.guestLoads, 0);
  assert.equal(h.root.__lootlinguaAuthResolved, undefined);
  assert.equal(h.root.words[0].id, 'private-account-word');
  panel.querySelector('[data-startup-retry]').events.click();
  assert.equal(h.calls.reloads, 1);
  assert.equal(h.root.LootLinguaStartupRecovery.getStatus().completed, false);
});

test('slow auth exposes recovery after the timeout while retaining the startup gate', () => {
  const h = harness();
  const timer = [...h.timers.values()].find(timer => timer.ms === 12000);
  timer.callback();
  assert.ok(h.panel());
  assert.equal(h.root.LootLinguaStartupRecovery.getStatus().failed, false);
  assert.equal(h.root.LootLinguaStartupRecovery.getStatus().completed, false);
});

test('local continuation requires confirmed guest identity and complete guest hydration', async () => {
  const h = harness();
  h.failModule();
  h.root.__lootlinguaAuthResolved = true;
  h.root.__lootlinguaAuthUser = null;
  h.root.auth = { currentUser: null };
  assert.equal(await h.root.LootLinguaStartupRecovery.continueGuest(), false);
  h.root.__lootlinguaInitialDataReady = true;
  h.fire('lootlingua:initial-data-ready');
  assert.equal(h.panel().querySelector('[data-startup-guest]').hidden, false);
  h.root.LootLinguaEntryExperienceController.boot = async () => { h.calls.boots++; h.root.LootLinguaStartupRecovery.complete(); };
  assert.equal(await h.root.LootLinguaStartupRecovery.continueGuest(), true);
  assert.equal(h.calls.guestLoads, 1);
  assert.equal(h.calls.boots, 1);
  assert.equal(h.root.__lootlinguaAuthUser, null);
  assert.equal(h.overlay.children.length, 0);
});

test('an account or a late sign-in can never take the guest continuation path', async () => {
  for (const accountState of ['settled', 'between-auth-events']) {
    const h = harness();
    h.root.__lootlinguaAuthResolved = true;
    h.root.__lootlinguaInitialDataReady = true;
    h.root.auth = { currentUser: { uid: 'account-b' } };
    h.root.__lootlinguaAuthUser = accountState === 'settled' ? h.root.auth.currentUser : null;
    h.failModule();
    assert.equal(h.panel().querySelector('[data-startup-guest]').hidden, true);
    assert.equal(await h.root.LootLinguaStartupRecovery.continueGuest(), false);
    assert.equal(h.calls.guestLoads, 0);
  }
});

test('Entry completion is idempotent, cancels recovery, and loads only optional cosmetics after idle', () => {
  const h = harness();
  h.failModule();
  assert.equal(h.template.replacement, undefined);
  h.root.LootLinguaStartupRecovery.complete();
  h.root.LootLinguaStartupRecovery.complete();
  assert.equal(h.timers.size, 0);
  assert.equal(h.idle.length, 1);
  assert.equal(h.template.replacement, undefined);
  h.idle[0]();
  assert.equal(h.template.replacement.src, 'js/oasis-preview-animation.js');
  assert.equal(h.template.replacement.async, true);
  assert.deepEqual(h.calls.marks, ['lootlingua:startup-ready']);
  h.failModule();
  h.fire('unhandledrejection');
  assert.equal(h.overlay.children.length, 0);
});

test('failed local continuation keeps recovery available for retry', async () => {
  const h = harness();
  Object.assign(h.root, { __lootlinguaAuthResolved: true, __lootlinguaAuthUser: null, __lootlinguaInitialDataReady: true, auth: { currentUser: null } });
  h.root.loadGuestDictionaryState = () => { throw Error('Storage unavailable'); };
  h.failModule();
  assert.equal(await h.root.LootLinguaStartupRecovery.continueGuest(), false);
  assert.equal(h.panel().querySelector('[data-startup-guest]').disabled, false);
  assert.equal(h.root.LootLinguaStartupRecovery.getStatus().completed, false);
});
