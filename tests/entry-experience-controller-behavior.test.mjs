import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createProfileHarness } from './profile-cloud-harness.mjs';

const [contractSource, controllerSource] = await Promise.all([
  readFile(new URL('../js/entry-experience-contract.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-controller.js', import.meta.url), 'utf8'),
]);

class MemoryStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
  }

  get length() {
    return this.values.size;
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  setFromString(value) {
    this.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  add(...names) {
    names.filter(Boolean).forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    if (force === true) {
      this.values.add(name);
      return true;
    }
    if (force === false) {
      this.values.delete(name);
      return false;
    }
    if (this.values.has(name)) {
      this.values.delete(name);
      return false;
    }
    this.values.add(name);
    return true;
  }

  toString() {
    return [...this.values].join(' ');
  }
}

function dataPropertyName(attribute) {
  return attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function selectorMatches(element, rawSelector) {
  const selector = rawSelector.trim();
  if (!selector) return false;
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  if (selector === 'button') return element.tagName === 'BUTTON';
  if (selector === 'h1') return element.tagName === 'H1';
  if (/^(button|input|select):not\(\[disabled\]\)$/.test(selector)) {
    return element.tagName === selector.slice(0, selector.indexOf(':')).toUpperCase() && !element.disabled;
  }
  if (selector === '[tabindex]:not([tabindex="-1"])') {
    return element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1';
  }
  const attributeMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attributeMatch) {
    const [, name, expected] = attributeMatch;
    if (!element.hasAttribute(name)) return false;
    return expected === undefined || element.getAttribute(name) === expected;
  }
  return element.tagName === selector.toUpperCase();
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this._innerHTML = '';
    this._id = '';
    this._connected = false;
    this._inert = false;
  }

  get id() {
    return this._id;
  }

  set id(value) {
    this._id = String(value || '');
    if (this._id) this.attributes.set('id', this._id);
    else this.attributes.delete('id');
  }

  get className() {
    return this.classList.toString();
  }

  set className(value) {
    this.classList.setFromString(value);
    this.attributes.set('class', this.classList.toString());
  }

  get inert() {
    return this._inert;
  }

  set inert(value) {
    this._inert = Boolean(value);
  }

  get isConnected() {
    return this._connected;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.children.forEach((child) => child.setConnected(false));
    this.children = [];

    const openingTag = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
    let match;
    while ((match = openingTag.exec(this._innerHTML))) {
      const child = new FakeElement(match[1], this.ownerDocument);
      const attributes = match[2] || '';
      const attributePattern = /([^\s=]+)(?:\s*=\s*"([^"]*)")?/g;
      let attribute;
      while ((attribute = attributePattern.exec(attributes))) {
        const name = attribute[1];
        if (!name || name === '/') continue;
        child.setAttribute(name, attribute[2] ?? '');
      }
      this.appendChild(child);
    }
  }

  setConnected(connected) {
    this._connected = Boolean(connected);
    this.children.forEach((child) => child.setConnected(connected));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    child.setConnected(this.isConnected);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
    this.setConnected(false);
  }

  setAttribute(name, value) {
    const key = String(name);
    const normalized = String(value ?? '');
    this.attributes.set(key, normalized);
    if (key === 'id') this._id = normalized;
    if (key === 'class') this.classList.setFromString(normalized);
    if (key === 'disabled') this.disabled = true;
    if (key === 'hidden') this.hidden = true;
    if (key.startsWith('data-')) this.dataset[dataPropertyName(key)] = normalized;
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  removeAttribute(name) {
    const key = String(name);
    this.attributes.delete(key);
    if (key === 'disabled') this.disabled = false;
    if (key === 'hidden') this.hidden = false;
    if (key.startsWith('data-')) delete this.dataset[dataPropertyName(key)];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return !event.defaultPrevented;
  }

  click() {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent('click'));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  getClientRects() {
    return this.hidden ? [] : [{}];
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelectorAll(selector) {
    const alternatives = String(selector).split(',').map((item) => item.trim()).filter(Boolean);
    return this.descendants().filter((element) => alternatives.some((item) => selectorMatches(element, item)));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeDocument {
  constructor() {
    this.readyState = 'loading';
    this.listeners = new Map();
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.documentElement.setConnected(true);
    this.body.setConnected(true);
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    if (this.body.id === id) return this.body;
    return this.body.descendants().find((element) => element.id === id) || null;
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return !event.defaultPrevented;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    this.target = init.target || null;
    this.currentTarget = null;
    Object.assign(this, init);
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeCustomEvent extends FakeEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

function createEventRoot() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((candidate) => candidate !== listener));
    },
    dispatchEvent(event) {
      event.target ||= this;
      event.currentTarget = this;
      for (const listener of listeners.get(event.type) || []) listener.call(this, event);
      return !event.defaultPrevented;
    },
  };
}

function evaluateContract(root = createEventRoot()) {
  const evaluate = new Function(
    'window',
    'globalThis',
    `${contractSource}\nreturn window.LootLinguaEntryExperience;`
  );
  return { root, api: evaluate(root, root) };
}

const contract = evaluateContract().api;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function entryState(overrides = {}) {
  const now = Date.now();
  const status = overrides.status || 'in-progress';
  return contract.normalizeEntryState({
    contractVersion: 2,
    experienceVersion: 2,
    status,
    audience: 'new',
    classification: 'brand-new',
    currentStep: status === 'in-progress' ? 'interests' : 'destination',
    interestsStatus: 'selected',
    interestIds: ['study'],
    themeStatus: 'selected',
    themeId: 'lootlingua',
    oasisMode: 'light',
    themeExplicit: true,
    journeyStatus: status === 'completed' ? 'structure-explored' : 'pending',
    selectedWorldId: status === 'completed' ? 'world-study' : '',
    gamerStatus: 'not-applicable',
    source: 'app-entry',
    startedAt: now - 10_000,
    updatedAt: now - 1_000,
    completedAt: status === 'completed' ? now - 1_000 : 0,
    skippedAt: status === 'skipped' ? now - 1_000 : 0,
    ...overrides,
  });
}

function legacyEntryStateWithoutActionProof(overrides = {}) {
  const now = Date.now();
  return {
    contractVersion: 1,
    experienceVersion: 1,
    status: 'completed',
    audience: 'returning',
    classification: 'returning-light',
    currentStep: 'action',
    interestsStatus: 'selected',
    interestIds: ['study'],
    themeStatus: 'selected',
    themeId: 'ocean',
    oasisMode: 'dark',
    themeExplicit: true,
    source: 'app-entry',
    startedAt: now - 10_000,
    updatedAt: now - 1_000,
    completedAt: now - 1_000,
    skippedAt: null,
    ...overrides,
  };
}

function freshUser(uid) {
  const now = new Date().toISOString();
  return {
    uid,
    displayName: uid,
    metadata: { creationTime: now, lastSignInTime: now },
  };
}

function oldUser(uid) {
  return {
    uid,
    displayName: uid,
    metadata: {
      creationTime: '2025-01-15T10:00:00.000Z',
      lastSignInTime: '2026-07-15T10:00:00.000Z',
    },
  };
}

async function settle(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function createHarness(options = {}) {
  const storage = options.storage || new MemoryStorage();
  const sessionStorage = options.sessionStorage || new MemoryStorage();
  const document = new FakeDocument();
  const shell = document.createElement('div');
  shell.id = 'entryExperienceRoot';
  shell.hidden = true;
  shell.setAttribute('aria-hidden', 'true');
  const panel = document.createElement('section');
  panel.id = 'entryExperiencePanel';
  const status = document.createElement('p');
  status.id = 'entryExperienceStatus';
  shell.appendChild(panel);
  shell.appendChild(status);
  document.body.appendChild(shell);
  const appSurface = document.createElement('main');
  appSurface.id = 'appSurface';
  document.body.appendChild(appSurface);
  const wordInput = document.createElement('input');
  wordInput.id = 'wordInput';
  document.body.appendChild(wordInput);

  const root = createEventRoot();
  const calls = {
    entryLoads: [],
    entrySaves: [],
    profileSaves: 0,
    profilePatches: [],
    fullProfileSaves: 0,
    resumeIntents: [],
    worlds: 0,
    dictionary: 0,
    quiz: 0,
    openedWorlds: [],
    resumedWorlds: [],
    previewReads: 0,
  };
  const initialUser = options.user || null;
  const initialProfile = options.profile || {};
  const initialProfileExists = options.profileExists === true;
  const initialProfileReadFailed = options.profileReadFailed === true;
  const initialMasteryCount = Math.max(0, Number(options.masteryCount) || 0);
  Object.assign(root, {
    __lootlinguaAuthResolved: true,
    __lootlinguaInitialDataReady: true,
    __lootlinguaAuthUser: initialUser,
    __lootlinguaProfileSnapshot: initialUser ? {
      uid: initialUser.uid,
      exists: initialProfileExists,
      data: clone(initialProfile),
      readFailed: initialProfileReadFailed,
    } : null,
    __lootlinguaMasterySnapshot: initialUser ? {
      uid: initialUser.uid,
      entryCount: initialMasteryCount,
      readFailed: false,
    } : null,
    words: clone(options.words || []),
    auth: { currentUser: initialUser },
    navigator: {},
    crypto: { randomUUID: () => `operation-${Math.random().toString(36).slice(2)}` },
    prepareGuestMigrationForUser: async () => 'none',
    loadActiveQuizSessionFromCloud: async () => clone(options.quizSession || null),
    LootLinguaJourneyCloud: {
      getActiveJourney: async () => clone(options.activeJourney || null),
      hasAnyJourneyProgress: async () => options.hasJourneyProgress === true,
      resolveActiveJourneyDestination: async () => clone(options.journeyDestination || null),
      ...(options.accountJourneyDestination ? {
        resolveAccountJourneyDestination: async () => clone(options.accountJourneyDestination),
      } : {}),
    },
    LootLinguaEntryExperienceCloud: {
      async load(user) {
        calls.entryLoads.push(user.uid);
        return options.entryLoad ? options.entryLoad(user) : { exists: false, state: null };
      },
      async loadLegacyPreferences(user) {
        if (options.legacyEntryLoad) return options.legacyEntryLoad(user);
        return { exists: false, preferences: null };
      },
      async save(state, user) {
        calls.entrySaves.push({ state: clone(state), uid: user.uid });
        if (options.entrySave) return options.entrySave(state, user, calls.entrySaves.length);
        return clone(state);
      },
    },
    LootLinguaPublishedContent: {
      getPublishedWorld: async (worldId) => ({ worldId, title: worldId === 'world-games' ? 'عالم الألعاب' : 'عالم المعرفة' }),
    },
    LootLinguaWorldsEntryPreview: Object.fromEntries(
      ['loadWorldChoices', 'loadWorldStructure', 'loadRankPreview', 'loadGatePreview', 'loadJourneyContext'].map(name => [
        name, async () => { calls.previewReads++; throw new Error('Entry must use the actual worlds surface'); },
      ])
    ),
    LootLinguaJourneyEntryActions: {
      async resumePendingIntent(intent, world) {
        calls.resumeIntents.push({ intent: clone(intent), world: clone(world) });
        return options.resumePendingIntent
          ? options.resumePendingIntent(intent, world)
          : { restored: true };
      },
    },
    _saveProfileToCloudNow: async () => {
      calls.fullProfileSaves += 1;
      throw new Error('Entry appearance must not save a full profile');
    },
    getThemeIntroSeenList: () => clone(options.themeIntroSeen || []),
    saveProfilePreferencesToCloud: async (patch, settings) => {
      calls.profileSaves += 1;
      calls.profilePatches.push({ patch: clone(patch), settings: clone(settings) });
      return options.profileSave ? options.profileSave(calls.profileSaves, patch, settings) : true;
    },
    setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      return true;
    },
    setProfileOasisMode(mode) {
      document.documentElement.setAttribute('data-oasis-mode', mode);
      return true;
    },
    async loadWorldsView() {
      calls.worlds += 1;
      return options.worldsLoaded !== false;
    },
    async resumePublishedLearning(worldId) {
      calls.resumedWorlds.push(worldId);
    },
    loadPersonalDictionary() {
      calls.dictionary += 1;
    },
    loadQuizView() {
      calls.quiz += 1;
    },
    openPublishedWorld(worldId) {
      calls.openedWorlds.push(worldId);
    },
    showToast() {},
    flushDeferredEntryToasts() {},
  });
  if (options.enableGamerSearch) {
    root.fetchSuggestions = async () => {
      root.dispatchEvent(new FakeCustomEvent('lootlingua:dictionary-search-result', {
        detail: { type: 'normal', status: options.gamerNormalStatus || 'success', word: 'Spawn' },
      }));
    };
    root.fetchGamerSuggestions = async () => {
      root.dispatchEvent(new FakeCustomEvent('lootlingua:dictionary-search-result', {
        detail: { type: 'gamer', status: options.gamerStatus || 'success', word: 'Spawn' },
      }));
    };
  }

  evaluateContract(root);
  let now = Date.now();
  class TestDate extends Date { static now() { return now; } }
  const evaluateController = new Function(
    'window',
    'globalThis',
    'document',
    'localStorage',
    'sessionStorage',
    'HTMLElement',
    'requestAnimationFrame',
    'location',
    'navigator',
    'CustomEvent',
    'Date',
    'setTimeout',
    `${controllerSource}\nreturn window.LootLinguaEntryExperienceController;`
  );
  const controller = evaluateController(
    root,
    root,
    document,
    storage,
    sessionStorage,
    FakeElement,
    (callback) => callback(),
    { pathname: '/app', search: '?view=worlds', hash: '' },
    root.navigator,
    FakeCustomEvent,
    TestDate,
    (callback, delay) => { if (delay < 3000) return setTimeout(callback, delay); }
  );
  controller.init();
  await settle();

  async function click(selector, scope = panel) {
    const element = scope.querySelector(selector);
    assert.ok(element, 'Missing interactive element ' + selector);
    assert.equal(element.disabled, false, selector + ' must be enabled');
    element.click();
    await settle();
    return element;
  }

  async function reachRevealedAction({ interest = 'study', theme = 'lootlingua' } = {}) {
    if (controller.getState()?.currentStep === 'welcome') await click('[data-entry-action="continue-welcome"]');
    if (controller.getState()?.currentStep === 'theme') {
      await click('[data-entry-theme="' + theme + '"]');
      await click('[data-entry-action="continue-theme"]');
    }
    assert.equal(controller.getState()?.currentStep, 'interests');
    await click('[data-entry-interest="' + interest + '"]');
    await click('[data-entry-action="continue-interests"]');
    assert.equal(controller.getState()?.currentStep, 'discover');
    assert.ok(panel.querySelector('[data-entry-action="discover-worlds"]'));
  }

  async function switchUser(user) {
    root.auth.currentUser = user;
    root.__lootlinguaAuthUser = user;
    root.__lootlinguaAuthResolved = true;
    root.__lootlinguaInitialDataReady = true;
    root.__lootlinguaProfileSnapshot = user ? {
      uid: user.uid,
      exists: false,
      data: {},
      readFailed: false,
    } : null;
    root.__lootlinguaMasterySnapshot = user ? {
      uid: user.uid,
      entryCount: 0,
      readFailed: false,
    } : null;
    root.dispatchEvent(new FakeCustomEvent('lootlingua:auth-state', { detail: { user } }));
    await settle(14);
  }

  return {
    root,
    document,
    shell,
    panel,
    status,
    storage,
    sessionStorage,
    controller,
    calls,
    click,
    reachRevealedAction,
    switchUser,
  };
}

function persistedState(storage, key) {
  const raw = storage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

test('Discover Worlds opens the real list before marking Entry complete, without delays or preview', async () => {
  const user = freshUser('destination-proof');
  const h = await createHarness({ user });
  await h.reachRevealedAction();
  const key = contract.entryStorageKey({ uid: user.uid });
  assert.equal(h.controller.isActive(), true);
  assert.equal(persistedState(h.storage, key).status, 'in-progress');
  assert.equal(h.calls.worlds, 0);
  await h.click('[data-entry-action="discover-worlds"]');
  assert.equal(h.calls.worlds, 1);
  assert.equal(h.calls.previewReads, 0);
  assert.deepEqual(h.calls.openedWorlds, []);
  assert.equal(persistedState(h.storage, key).status, 'completed');
  assert.equal(h.controller.isActive(), false);

  const unavailable = await createHarness({ user: freshUser('worlds-load-error'), worldsLoaded: false });
  await unavailable.reachRevealedAction();
  await unavailable.click('[data-entry-action="discover-worlds"]');
  assert.equal(unavailable.controller.isActive(), true);
  assert.equal(unavailable.controller.getState().status, 'in-progress');
  assert.equal(unavailable.calls.entrySaves.some(({ state }) => state.status === 'completed'), false);
});

test('an Entry cloud failure keeps an authenticated experience resumable and non-terminal across refresh', async () => {
  const user = freshUser('entry-write-failure');
  const storage = new MemoryStorage();
  let cloudState = null;
  const harness = await createHarness({
    user,
    storage,
    entryLoad: async () => ({ exists: Boolean(cloudState), state: clone(cloudState) }),
    entrySave: async (state) => {
      if (contract.isTerminalState(state)) {
        const error = new Error('offline');
        error.code = 'entry/write-failed';
        error.diagnostic = {
          operation: 'entry-completion',
          phase: 'firestore-write',
          documentPath: 'users/{account}/entryExperiences/v2',
          firebaseCode: 'unavailable',
        };
        throw error;
      }
      cloudState = clone(state);
      return clone(state);
    },
  });
  await harness.reachRevealedAction();
  await harness.click('[data-entry-action="discover-worlds"]');

  const localKey = contract.entryStorageKey({ uid: user.uid });
  assert.equal(harness.controller.getState().status, 'in-progress');
  assert.equal(harness.controller.isActive(), true);
  assert.notEqual(persistedState(storage, localKey)?.status, 'completed');
  assert.notEqual(persistedState(storage, localKey)?.status, 'skipped');
  assert.match(harness.status.textContent, /تعذّر حفظ الخطوة[\s\S]*حاول مرة أخرى/);

  const refreshed = await createHarness({
    user,
    storage,
    entryLoad: async () => {
      const error = new Error('still offline');
      error.code = 'entry/read-failed';
      throw error;
    },
  });
  assert.equal(refreshed.controller.getState().status, 'in-progress');
  assert.equal(refreshed.controller.isActive(), true);
});

test('a Profile cloud failure cannot close Entry or leave a terminal local receipt', async () => {
  const user = freshUser('profile-write-failure');
  const storage = new MemoryStorage();
  let cloudState = null;
  const harness = await createHarness({
    user,
    storage,
    entryLoad: async () => ({ exists: Boolean(cloudState), state: clone(cloudState) }),
    entrySave: async (state) => {
      cloudState = clone(state);
      return clone(state);
    },
    profileSave: async () => false,
  });
  await harness.reachRevealedAction();
  await harness.click('[data-entry-action="discover-worlds"]');

  const local = persistedState(storage, contract.entryStorageKey({ uid: user.uid }));
  assert.ok(harness.calls.profileSaves > 0, 'the profile persistence path must be exercised');
  assert.equal(harness.controller.getState().status, 'in-progress');
  assert.equal(harness.controller.isActive(), true);
  assert.notEqual(local?.status, 'completed');
  assert.notEqual(local?.status, 'skipped');
  assert.equal(harness.calls.fullProfileSaves, 0);
  assert.equal(harness.calls.profilePatches[0].settings.verify, true);
});

test('Entry completion verifies only appearance through the real profile adapter and preserves newer progress', async () => {
  const user = freshUser('appearance-patch');
  const h = await createHarness({ user, themeIntroSeen: ['lootlingua', 'ocean'] });
  const cloud = createProfileHarness({ localProfile: { userXP: 0, perfectQuizzes: 0 } });
  cloud.auth.currentUser = user;
  cloud.docs.set(cloud.path(user.uid), { userXP: 500, perfectQuizzes: 9, runnerCoins: 44 });
  cloud.seedSnapshot(user.uid);
  h.root.saveProfilePreferencesToCloud = cloud.root.saveProfilePreferencesToCloud;
  await h.reachRevealedAction();
  await h.click('[data-entry-action="discover-worlds"]');
  assert.equal(h.controller.getState().status, 'completed');
  assert.equal(h.controller.isActive(), false);
  const saved = cloud.docs.get(cloud.path(user.uid));
  assert.equal(saved.userXP, 500);
  assert.equal(saved.perfectQuizzes, 9);
  assert.equal(saved.runnerCoins, 44);
  assert.deepEqual(Object.keys(cloud.writes[0].data).sort(), ['_syncRevision', 'oasisMode', 'theme', 'themeIntroSeen', 'updatedAt']);
  assert.deepEqual(cloud.writes[0].data.themeIntroSeen, ['lootlingua', 'ocean']);
  assert.equal(cloud.reads.length, 2, 'the appearance transaction reads current state, then verifies the committed patch');
  assert.equal(cloud.payloadReads, 0);
  assert.equal(h.calls.fullProfileSaves, 0);
});

test('an unavailable preference API leaves Entry resumable without falling back to full profile writes', async () => {
  const user = freshUser('appearance-api-unavailable');
  const h = await createHarness({ user });
  delete h.root.saveProfilePreferencesToCloud;
  await h.reachRevealedAction();
  await h.click('[data-entry-action="discover-worlds"]');
  assert.equal(h.controller.getState().status, 'in-progress');
  assert.equal(h.controller.isActive(), true);
  assert.equal(h.calls.fullProfileSaves, 0);
  assert.notEqual(persistedState(h.storage, contract.entryStorageKey({ uid: user.uid }))?.status, 'completed');
});

test('closing contextual auth keeps the pending Journey intent available', async () => {
  const storage = new MemoryStorage({
    [contract.entryStorageKey({})]: JSON.stringify(entryState({ status: 'completed' })),
  });
  const harness = await createHarness({ storage });
  const requested = harness.controller.requestJourneyAuth({
    action: 'start-journey',
    worldId: 'world-auth-close',
    source: 'world',
  });
  assert.ok(requested);
  const key = contract.pendingIntentStorageKey({});
  assert.equal(persistedState(storage, key)?.status, 'pending');
  assert.ok(harness.document.getElementById('journeyAuthPrompt'));

  harness.document.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
  await settle();

  assert.equal(harness.document.getElementById('journeyAuthPrompt'), null);
  assert.equal(persistedState(storage, key)?.operationId, requested.operationId);
  assert.equal(persistedState(storage, key)?.status, 'pending');
});

test('auth success does not consume an intent when its public resume result says restored:false', async () => {
  const user = freshUser('intent-not-restored');
  const guestTerminal = entryState({ status: 'completed' });
  const accountTerminal = entryState({
    status: 'completed',
    audience: 'returning',
    classification: 'existing-account-without-meaningful-progress',
  });
  const storage = new MemoryStorage({
    [contract.entryStorageKey({})]: JSON.stringify(guestTerminal),
    [contract.entryStorageKey({ uid: user.uid })]: JSON.stringify(accountTerminal),
  });
  const harness = await createHarness({
    storage,
    entryLoad: async (current) => ({
      exists: current.uid === user.uid,
      state: current.uid === user.uid ? clone(accountTerminal) : null,
    }),
    resumePendingIntent: async () => ({ restored: false, reason: 'destination-not-opened' }),
  });
  const requested = harness.controller.requestJourneyAuth({
    action: 'start-journey',
    worldId: 'world-not-restored',
    source: 'world',
  });
  assert.ok(requested);

  await harness.switchUser(user);

  const accountIntent = persistedState(storage, contract.pendingIntentStorageKey({ uid: user.uid }));
  const guestIntent = persistedState(storage, contract.pendingIntentStorageKey({}));
  assert.equal(harness.calls.resumeIntents.length, 1);
  assert.equal(
    [accountIntent, guestIntent].some((intent) => intent?.status === 'consumed'),
    false
  );
  assert.equal(
    [accountIntent, guestIntent].some((intent) => intent?.status === 'pending'),
    true
  );
});

test('a guest terminal state observed with account A cannot silently complete fresh account B', async () => {
  const accountA = freshUser('account-a');
  const accountB = freshUser('account-b');
  const guestTerminal = entryState({ status: 'completed' });
  const accountATerminal = entryState({
    status: 'completed',
    audience: 'returning',
    classification: 'returning-with-progress',
  });
  const storage = new MemoryStorage({
    [contract.entryStorageKey({})]: JSON.stringify(guestTerminal),
    [contract.entryStorageKey({ uid: accountA.uid })]: JSON.stringify(accountATerminal),
  });
  const cloudStates = new Map([[accountA.uid, accountATerminal]]);
  const harness = await createHarness({
    user: accountA,
    storage,
    entryLoad: async (user) => ({
      exists: cloudStates.has(user.uid),
      state: clone(cloudStates.get(user.uid) || null),
    }),
    entrySave: async (state, user) => {
      cloudStates.set(user.uid, clone(state));
      return clone(state);
    },
  });
  assert.equal(harness.controller.isActive(), false);
  assert.equal(harness.controller.getState().status, 'completed');

  await harness.switchUser(accountB);

  assert.equal(harness.controller.getState().status, 'in-progress');
  assert.equal(harness.controller.getState().classification, 'brand-new');
  assert.equal(harness.controller.isActive(), true);
  assert.notEqual(cloudStates.get(accountB.uid)?.status, 'completed');
  assert.notEqual(
    persistedState(storage, contract.entryStorageKey({ uid: accountB.uid }))?.status,
    'completed'
  );
});

test('matrix: a fresh guest receives the original welcome and public-World onboarding', async () => {
  const harness = await createHarness();

  assert.equal(harness.controller.getPresentation().classification, 'brand-new');
  assert.equal(harness.controller.getState().currentStep, 'welcome');
  assert.equal(harness.calls.dictionary, 0);
  assert.equal(harness.controller.isActive(), true);
  assert.ok(harness.panel.querySelector('[data-entry-action="continue-welcome"]'));
});

test('games interest reaches the actual list and does not start a preview or search demo', async () => {
  const h = await createHarness({ user: freshUser('games-interest') });
  await h.reachRevealedAction({ interest: 'games' });
  assert.deepEqual(h.controller.getState().interestIds, ['games']);
  assert.equal(h.controller.getState().gamerStatus, 'not-applicable');
  assert.equal(h.panel.querySelector('[data-entry-action="start-gamer-demo"]'), null);
  await h.click('[data-entry-action="discover-worlds"]');
  assert.equal(h.calls.previewReads, 0);
  assert.equal(h.calls.worlds, 1);
  assert.deepEqual(h.calls.openedWorlds, []);
});

test('matrix: a guest with words returns to the dictionary without restarting Entry Experience', async () => {
  const storage = new MemoryStorage({
    words_normal_guest: JSON.stringify([
      { id: 'guest-word-one', word: 'lantern', meaning: 'فانوس' },
    ]),
  });
  const harness = await createHarness({ storage });

  assert.equal(harness.controller.getPresentation().classification, 'returning-guest-with-local-data');
  assert.equal(harness.calls.dictionary, 0, 'Entry leaves the startup dictionary route in place');
  assert.equal(JSON.parse(harness.storage.getItem('words_normal_guest'))[0].id, 'guest-word-one');
  assert.equal(harness.controller.getState().currentStep, 'discover');
  assert.equal(harness.controller.isActive(), false);
});

test('guest sign-in with saved words resumes one account destination instead of restarting Entry', async () => {
  const storage = new MemoryStorage({
    words_normal_guest: JSON.stringify([
      { id: 'guest-word-after-sign-in', word: 'harbor', meaning: 'Ù…ÙŠÙ†Ø§Ø¡' },
    ]),
  });
  const harness = await createHarness({ storage });

  await harness.switchUser(freshUser('guest-word-account'));

  assert.equal(harness.controller.getPresentation().classification, 'returning-guest-with-local-data');
  assert.equal(harness.controller.isActive(), false);
  assert.equal(harness.calls.entrySaves.length, 0);
  assert.equal(harness.calls.worlds, 0);
  assert.equal(JSON.parse(storage.getItem('words_normal_guest'))[0].id, 'guest-word-after-sign-in');
});

test('matrix: guest XP alone still begins at the personal dictionary without Product Entry', async () => {
  const storage = new MemoryStorage({ userXP: '25', lootlinguaGuestDataDirty: '1' });
  const harness = await createHarness({ storage });

  assert.equal(harness.controller.getPresentation().classification, 'returning-guest-with-local-data');
  assert.equal(harness.calls.dictionary, 0, 'Entry leaves the startup dictionary route in place');
  assert.equal(storage.getItem('userXP'), '25');
  assert.equal(harness.controller.getState().currentStep, 'discover');
  assert.equal(harness.controller.isActive(), false);
});

test('matrix: a fresh account with an existing empty profile is still brand-new and sees every step', async () => {
  const user = freshUser('fresh-empty-profile');
  const harness = await createHarness({
    user,
    profileExists: true,
    profile: {},
  });

  assert.equal(harness.controller.getPresentation().classification, 'brand-new');
  assert.equal(harness.controller.getState().currentStep, 'welcome');
  await harness.click('[data-entry-action="continue-welcome"]');
  assert.equal(harness.controller.getState().currentStep, 'theme');
  await harness.reachRevealedAction();
  await harness.click('[data-entry-action="discover-worlds"]');
  assert.equal(harness.calls.worlds, 1);
  assert.equal(harness.calls.previewReads, 0);
});

test('matrix: an old account with words only is returning-light and is not sent through the progress shortcut', async () => {
  const user = oldUser('old-words-only');
  const harness = await createHarness({
    user,
    profileExists: true,
    profile: {},
    words: [{ id: 'account-word-one', word: 'harbor', meaning: 'ميناء' }],
  });

  assert.equal(harness.controller.getPresentation().classification, 'returning-light');
  assert.equal(harness.controller.isActive(), false);
  assert.equal(harness.calls.previewReads, 0);
  assert.deepEqual(harness.calls.resumedWorlds, []);
  assert.equal(harness.calls.entrySaves.length, 0);
  assert.equal(harness.root.words[0].id, 'account-word-one');
});

test('matrix: an account with a real active Journey gets the short truthful return path', async () => {
  const user = oldUser('account-real-journey');
  const activeJourney = {
    worldId: 'world-active',
    activeRankId: 'rank-a1',
    activeGateId: 'gate-a1-1',
    status: 'active',
  };
  const harness = await createHarness({
    user,
    profileExists: true,
    profile: { userXP: 10 },
    activeJourney,
    hasJourneyProgress: true,
    journeyDestination: { type: 'gate', reason: 'started' },
  });

  assert.equal(harness.controller.getPresentation().classification, 'returning-with-progress');
  assert.equal(harness.controller.isActive(), false);
  assert.deepEqual(harness.calls.resumedWorlds, ['world-active']);
  assert.equal(harness.calls.previewReads, 0);
  assert.equal(harness.calls.entrySaves.length, 0);
});

test('matrix: a completed-only World gets the terminal shortcut with no fake Journey preview', async () => {
  const user = oldUser('completed-world-only');
  let cloudState = null;
  const harness = await createHarness({
    user,
    hasJourneyProgress: true,
    accountJourneyDestination: {
      type: 'completed-current-content',
      classification: 'world-completed',
      worldId: 'world-complete',
      journey: {
        worldId: 'world-complete',
        status: 'active',
        contentJourneyStatus: 'completed-current-content',
      },
    },
    entryLoad: async () => ({ exists: Boolean(cloudState), state: clone(cloudState) }),
    entrySave: async (state) => {
      cloudState = clone(state);
      return clone(state);
    },
  });

  assert.equal(harness.controller.getPresentation().classification, 'returning-with-progress');
  assert.equal(harness.controller.isActive(), false);
  assert.equal(harness.calls.worlds, 1);
  assert.equal(harness.calls.previewReads, 0);
  assert.deepEqual(harness.calls.resumedWorlds, []);
  assert.equal(cloudState, null);
});

test('migration: completed v1 preserves preferences without reopening Entry for a returning learner', async () => {
  const user = oldUser('legacy-completed-words-only');
  const legacyCompleted = legacyEntryStateWithoutActionProof({
    status: 'completed',
    audience: 'returning',
    classification: 'returning-with-progress',
  });
  assert.equal(Object.hasOwn(legacyCompleted, 'actionStatus'), false);
  const storage = new MemoryStorage();

  const harness = await createHarness({
    storage,
    user,
    profileExists: true,
    profile: {},
    words: [{ id: 'legacy-word-one', word: 'harbor', meaning: 'port' }],
    entryLoad: async () => ({ exists: false, state: null }),
    legacyEntryLoad: async () => ({
      exists: true,
      preferences: contract.normalizeLegacyPreferences(legacyCompleted),
    }),
  });

  assert.equal(harness.controller.getPresentation().classification, 'returning-light');
  assert.equal(harness.controller.getState().status, 'in-progress');
  assert.equal(harness.controller.getState().currentStep, 'discover');
  assert.equal(harness.controller.getState().journeyStatus, 'pending');
  assert.equal(harness.controller.getState().themeId, 'ocean');
  assert.deepEqual(harness.controller.getState().interestIds, ['study']);
  assert.equal(harness.controller.isActive(), false);
  assert.equal(harness.shell.hidden, true);
  assert.equal(harness.calls.entrySaves.length, 0);
});

test('migration: completed v1 plus real Journey progress resumes the actual world', async () => {
  const user = oldUser('legacy-completed-real-journey');
  const legacyCompleted = legacyEntryStateWithoutActionProof({
    status: 'completed',
    audience: 'returning',
    classification: 'returning-with-progress',
  });
  const activeJourney = {
    worldId: 'world-legacy-active',
    activeRankId: 'rank-l1',
    activeGateId: 'gate-l1-1',
    status: 'active',
  };

  const harness = await createHarness({
    user,
    profileExists: true,
    profile: { userXP: 50 },
    activeJourney,
    hasJourneyProgress: true,
    journeyDestination: { type: 'gate', reason: 'started' },
    entryLoad: async () => ({ exists: false, state: null }),
    legacyEntryLoad: async () => ({
      exists: true,
      preferences: contract.normalizeLegacyPreferences(legacyCompleted),
    }),
  });

  assert.equal(harness.controller.getPresentation().classification, 'returning-with-progress');
  assert.equal(harness.controller.getState().status, 'in-progress');
  assert.equal(harness.controller.isActive(), false);
  assert.deepEqual(harness.calls.resumedWorlds, ['world-legacy-active']);
  assert.equal(harness.calls.previewReads, 0);
  assert.equal(harness.calls.entrySaves.length, 0);
});

test('migration: a skipped v1 document preserves preferences for a returning learner', async () => {
  const user = oldUser('legacy-skipped-words-only');
  const legacySkipped = legacyEntryStateWithoutActionProof({
    status: 'skipped',
    audience: 'returning',
    classification: 'returning-light',
  });
  assert.equal(Object.hasOwn(legacySkipped, 'actionStatus'), false);

  const harness = await createHarness({
    user,
    profileExists: true,
    profile: {},
    words: [{ id: 'legacy-skipped-word', word: 'lantern', meaning: 'lamp' }],
    entryLoad: async () => ({ exists: false, state: null }),
    legacyEntryLoad: async () => ({
      exists: true,
      preferences: contract.normalizeLegacyPreferences(legacySkipped),
    }),
  });

  assert.equal(harness.controller.getPresentation().classification, 'returning-light');
  assert.equal(harness.controller.getState().status, 'in-progress');
  assert.equal(harness.controller.getState().currentStep, 'discover');
  assert.equal(harness.controller.getState().themeId, 'ocean');
  assert.deepEqual(harness.controller.getState().interestIds, ['study']);
  assert.equal(harness.controller.isActive(), false);
  assert.equal(harness.calls.entrySaves.length, 0);
});

test('Discover Worlds is checkpointed and remains resumable after refresh', async () => {
  const user = freshUser('first-action-refresh-account');
  const storage = new MemoryStorage();
  const h = await createHarness({ storage, user, profileExists: true });
  await h.reachRevealedAction({ theme: 'ocean' });
  const key = contract.entryStorageKey({ uid: user.uid });
  assert.equal(persistedState(storage, key).currentStep, 'discover');
  assert.equal(h.calls.entrySaves.at(-1).state.currentStep, 'discover');
  const refreshed = await createHarness({ storage, user, profileExists: true });
  assert.equal(refreshed.controller.getState().status, 'in-progress');
  assert.equal(refreshed.controller.getState().currentStep, 'discover');
  assert.equal(refreshed.controller.getState().themeId, 'ocean');
  assert.deepEqual(refreshed.controller.getState().interestIds, ['study']);
  assert.equal(refreshed.controller.isActive(), true);
  assert.equal(refreshed.calls.previewReads, 0);
  await refreshed.click('[data-entry-action="discover-worlds"]');
  assert.equal(refreshed.controller.getState().status, 'completed');
  assert.equal(refreshed.calls.worlds, 1);
});

test('matrix: a proven completed v2 account remains once-only and never reopens or writes on boot', async () => {
  const user = oldUser('completed-v2-account');
  const completed = entryState({
    status: 'completed',
    audience: 'returning',
    classification: 'returning-light',
  });
  const harness = await createHarness({
    user,
    entryLoad: async () => ({ exists: true, state: clone(completed) }),
  });

  assert.equal(harness.controller.getState().status, 'completed');
  assert.equal(harness.controller.getState().journeyStatus, 'structure-explored');
  assert.equal(harness.controller.isActive(), false);
  assert.equal(harness.shell.hidden, true);
  assert.equal(harness.calls.entrySaves.length, 0);
});

test('refresh restores theme, interests, and legacy World preview drafts without manufacturing completion', async () => {
  const storage = new MemoryStorage();
  const user = freshUser('refresh-entry-draft');
  const h = await createHarness({ storage, user });
  await h.click('[data-entry-action="continue-welcome"]');
  await h.click('[data-entry-theme="ocean"]');
  const theme = await createHarness({ storage, user });
  assert.equal(theme.controller.getState().currentStep, 'theme');
  assert.equal(theme.controller.getState().themeId, 'ocean');
  await theme.click('[data-entry-action="continue-theme"]');
  await theme.click('[data-entry-interest="games"]');
  const interests = await createHarness({ storage, user });
  assert.equal(interests.controller.getState().currentStep, 'interests');
  assert.deepEqual(interests.controller.getState().interestIds, ['games']);
  for (const currentStep of ['worlds', 'journey', 'destination']) {
    const old = entryState({ currentStep, contractVersion: 2, status: 'in-progress',
      audience: 'new', classification: 'brand-new', themeId: 'ocean',
      interestsStatus: 'selected', interestIds: ['games'], selectedWorldId: 'world-games' });
    const migrated = await createHarness({ user, entryLoad: async () => ({ exists: true, state: old }) });
    assert.equal(migrated.controller.getState().currentStep, 'discover');
    assert.equal(migrated.controller.getState().status, 'in-progress');
    assert.equal(migrated.controller.getState().selectedWorldId, 'world-games');
    assert.equal(migrated.controller.getState().themeId, 'ocean');
    assert.deepEqual(migrated.controller.getState().interestIds, ['games']);
    assert.equal(migrated.calls.previewReads, 0);
    assert.equal(migrated.calls.worlds, 0);
  }
});

test('Continue as guest starts a cloud journey and retries without losing the requested world', async () => {
  const user = { ...freshUser('anonymous-journey'), isAnonymous: true };
  const terminal = entryState({ status: 'completed' });
  const storage = new MemoryStorage({ [contract.entryStorageKey({})]: JSON.stringify(terminal) });
  const harness = await createHarness({
    storage,
    entryLoad: async () => ({ exists: true, state: clone(terminal) }),
    resumePendingIntent: async () => ({ restored: true, destination: 'world-restored' }),
  });
  harness.root.LootLinguaPersonalDictionaryOnboarding = {
    getState: () => ({ requiresFirstWord: true, phase: 'awaiting-first-word' }),
  };
  let attempts = 0;
  harness.root.beginGuestJourneySession = async () => {
    if (++attempts === 1) throw new Error('offline');
    await harness.switchUser(user);
    return user;
  };
  const requested = harness.controller.requestJourneyAuth({ action: 'start-journey', worldId: 'world-restored', source: 'world' });
  const prompt = harness.document.getElementById('journeyAuthPrompt');
  await harness.click('[data-journey-auth="guest"]', prompt);
  assert.match(prompt.querySelector('#journeyAuthStatus').textContent, /حاول مرة ثانية/);
  assert.equal(persistedState(storage, contract.pendingIntentStorageKey({})).operationId, requested.operationId);
  await harness.click('[data-journey-auth="guest"]', prompt);
  const restored = persistedState(storage, contract.pendingIntentStorageKey({ uid: user.uid }));
  assert.equal(restored.operationId, requested.operationId);
  assert.equal(restored.status, 'consumed');
  assert.equal(harness.calls.resumeIntents.length, 1);
  assert.equal(harness.document.getElementById('journeyAuthPrompt'), null);
});

test('auth success claims the exact guest operation and consumes it only after restored:true', async () => {
  const user = freshUser('intent-restored-success');
  const guestTerminal = entryState({ status: 'completed' });
  const accountTerminal = entryState({
    status: 'completed',
    audience: 'returning',
    classification: 'existing-account-without-meaningful-progress',
  });
  const storage = new MemoryStorage({
    [contract.entryStorageKey({})]: JSON.stringify(guestTerminal),
    [contract.entryStorageKey({ uid: user.uid })]: JSON.stringify(accountTerminal),
  });
  const harness = await createHarness({
    storage,
    entryLoad: async (current) => ({
      exists: current.uid === user.uid,
      state: current.uid === user.uid ? clone(accountTerminal) : null,
    }),
    resumePendingIntent: async () => ({ restored: true, destination: 'world-restored' }),
  });
  const requested = harness.controller.requestJourneyAuth({
    action: 'start-journey',
    worldId: 'world-restored',
    source: 'world',
  });
  assert.ok(requested?.operationId);
  assert.equal(
    persistedState(storage, contract.pendingIntentStorageKey({})).operationId,
    requested.operationId
  );

  await harness.switchUser(user);

  const consumed = persistedState(storage, contract.pendingIntentStorageKey({ uid: user.uid }));
  assert.equal(harness.calls.resumeIntents.length, 1);
  assert.equal(harness.calls.resumeIntents[0].intent.operationId, requested.operationId);
  assert.equal(consumed.operationId, requested.operationId);
  assert.equal(consumed.status, 'consumed');
  assert.ok(consumed.consumedAt > 0);
  assert.equal(storage.getItem(contract.pendingIntentStorageKey({})), null);
  assert.equal(harness.document.getElementById('journeyAuthPrompt'), null);
});


test('an old account profile cache is not guest learning evidence for a new account', async () => {
  const storage=new MemoryStorage({userXP:'900',dailyStreak:'20'});
  const h=await createHarness({user:freshUser('fresh-with-stale-cache'),storage});
  assert.equal(h.controller.getPresentation().classification,'brand-new');
  assert.equal(h.controller.getState().currentStep,'welcome');
});

test('late onboarding checkpoint cannot replace a new account and refresh keeps its own draft', async () => {
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  const h=await createHarness({user:freshUser('old-checkpoint'),entrySave:(_state,user)=>user.uid==='old-checkpoint'?pending:clone(_state)});
  await h.click('[data-entry-action="continue-welcome"]');
  let closed=0;h.root.closeRouteOverlays=()=>{closed++};
  const next=freshUser('new-checkpoint');await h.switchUser(next);
  assert.equal(h.controller.getState().currentStep,'welcome');assert.ok(closed>0);
  release({ ...h.controller.getState(),currentStep:'interests' });await settle();
  assert.equal(h.controller.getState().currentStep,'welcome');
  const refreshed=await createHarness({user:next,storage:h.storage});
  assert.equal(refreshed.controller.getState().currentStep,'welcome');assert.equal(refreshed.controller.isActive(),true);
});

test('unrelated profile/mastery arrivals cannot restart an open onboarding draft', async () => {
  const h=await createHarness({user:freshUser('stable-open-tour')});
  await h.click('[data-entry-action="continue-welcome"]');
  const reads=h.calls.entryLoads.length;
  h.root.dispatchEvent(new FakeCustomEvent('lootlingua:profile-snapshot'));
  h.root.dispatchEvent(new FakeCustomEvent('lootlingua:word-mastery-snapshot'));await settle();
  assert.equal(h.controller.getState().currentStep,'theme');assert.equal(h.calls.entryLoads.length,reads);
});
