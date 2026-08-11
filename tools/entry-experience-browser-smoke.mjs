import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocketClient from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const evidenceDir = path.join(root, 'reports', 'product-entry-evidence');
const evidenceScreenshotNames = new Set([
  'guest-new-desktop-worlds',
  'guest-new-desktop-journey-structure',
  'guest-new-desktop-journey-gate-preview',
  'guest-new-desktop-personalized-destination',
  'guest-new-320-worlds',
  'guest-new-320-journey-structure',
  'guest-new-320-journey-gate-preview',
  'account-journey-short-return',
  'guest-games-success-real-general-search',
  'guest-games-success-real-gamer-button',
  'guest-games-success-returned-destination',
  'guest-games-empty-returned-destination',
  'account-completed-hidden-app',
  'auth-close-prompt',
  'auth-close-guest-exploration',
  'entry-cloud-failure-kept-open',
]);
const browserPath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));

if (!browserPath) throw new Error('Chrome/Edge not found');

const offset = (process.pid + 419) % 450;
const serverPort = 9000 + offset;
const debugPort = 10000 + offset;
const origin = `http://127.0.0.1:${serverPort}`;
const appUrl = `${origin}/app`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-entry-smoke-'));
const server = spawn(process.execPath, [path.join(root, 'tools', 'static-server.mjs'), String(serverPort)], {
  cwd: root,
  stdio: 'ignore',
});
const browser = spawn(browserPath, [
  '--headless=new',
  '--no-sandbox',
  '--no-first-run',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: process.env.ENTRY_SMOKE_DEBUG === '1' ? ['ignore', 'ignore', 'inherit'] : 'ignore' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(operation, attempts = 60, waitMs = 200) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await delay(waitMs);
    }
  }
  throw lastError;
}

function baseEntry(overrides = {}) {
  const now = Date.now();
  return {
    contractVersion: 2,
    experienceVersion: 2,
    status: 'in-progress',
    audience: 'new',
    classification: 'brand-new',
    currentStep: 'interests',
    interestsStatus: 'pending',
    interestIds: [],
    themeStatus: 'pending',
    themeId: '',
    oasisMode: 'light',
    themeExplicit: false,
    journeyStatus: 'pending',
    selectedWorldId: '',
    gamerStatus: 'not-applicable',
    source: 'app-entry',
    startedAt: now - 5000,
    updatedAt: now - 1000,
    completedAt: 0,
    skippedAt: 0,
    ...overrides,
  };
}

function freshAccount(uid) {
  const created = new Date(Date.now() - (4 * 60 * 1000)).toISOString();
  return {
    uid,
    displayName: uid,
    metadata: { creationTime: created, lastSignInTime: created },
  };
}

const desktop = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const phone390 = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const phone320 = { width: 320, height: 568, deviceScaleFactor: 1, mobile: true };
const accountNew = freshAccount('account-new');
const accountWords = freshAccount('account-words');
const accountJourney = freshAccount('account-journey');
const accountCompleted = freshAccount('account-completed');
const accountRefresh = freshAccount('account-refresh');
const accountEntryFailure = freshAccount('account-entry-failure');
const accountProfileFailure = freshAccount('account-profile-failure');
const accountA = freshAccount('account-a');
const accountB = freshAccount('account-b');
const authAccount = freshAccount('account-auth-success');

const scenarios = new Map();

function addScenario(id, config = {}) {
  const scenario = {
    id,
    runId: `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    viewport: desktop,
    initialUid: '',
    accounts: {},
    profiles: {},
    wordsByUid: {},
    journeys: {},
    journeyDestinations: {},
    journeyProgressByUid: {},
    cloudEntries: {},
    localStorage: {},
    authResult: 'success',
    loginUid: authAccount.uid,
    failEntryTerminal: false,
    failProfile: false,
    restoreIntent: true,
    ...config,
  };
  scenarios.set(id, scenario);
  return scenario;
}

addScenario('guest-new-desktop');
addScenario('guest-new-390', { viewport: phone390 });
addScenario('guest-new-320', { viewport: phone320 });
addScenario('guest-words', {
  localStorage: {
    words_normal_guest: JSON.stringify([
      { id: 'guest-word', word: 'legacy', meaning: 'قديم', mastery_status: 'New' },
    ]),
  },
});
addScenario('guest-xp-light', { localStorage: { userXP: '5' } });
addScenario('account-new', {
  initialUid: accountNew.uid,
  accounts: { [accountNew.uid]: accountNew },
});
addScenario('account-words', {
  initialUid: accountWords.uid,
  accounts: { [accountWords.uid]: accountWords },
  wordsByUid: {
    [accountWords.uid]: [{ id: 'account-word', word: 'saved', meaning: 'محفوظ', mastery_status: 'New' }],
  },
});
addScenario('account-journey', {
  initialUid: accountJourney.uid,
  accounts: { [accountJourney.uid]: accountJourney },
  journeys: {
    [accountJourney.uid]: {
      worldId: 'smoke-world', activeRankId: 'rank-a1', activeGateId: 'gate-a1', status: 'active',
    },
  },
  journeyDestinations: {
    [accountJourney.uid]: { type: 'gate', reason: 'started' },
  },
  journeyProgressByUid: { [accountJourney.uid]: true },
});
addScenario('account-completed', {
  initialUid: accountCompleted.uid,
  accounts: { [accountCompleted.uid]: accountCompleted },
  cloudEntries: {
    [accountCompleted.uid]: baseEntry({
      status: 'completed', currentStep: 'destination', journeyStatus: 'structure-explored',
      selectedWorldId: 'smoke-world', completedAt: Date.now() - 1000,
    }),
  },
});
addScenario('guest-games-success', { gamerOutcome: 'success' });
addScenario('guest-games-empty', { gamerOutcome: 'empty' });
addScenario('auth-close', { accounts: { [authAccount.uid]: authAccount } });
addScenario('auth-success', { accounts: { [authAccount.uid]: authAccount } });
addScenario('refresh-guest');
addScenario('refresh-account-theme', {
  initialUid: accountRefresh.uid,
  accounts: { [accountRefresh.uid]: accountRefresh },
});
addScenario('entry-cloud-failure', {
  initialUid: accountEntryFailure.uid,
  accounts: { [accountEntryFailure.uid]: accountEntryFailure },
  failEntryTerminal: true,
});
addScenario('profile-cloud-failure', {
  initialUid: accountProfileFailure.uid,
  accounts: { [accountProfileFailure.uid]: accountProfileFailure },
  failProfile: true,
});
addScenario('account-switch', {
  initialUid: accountA.uid,
  accounts: { [accountA.uid]: accountA, [accountB.uid]: accountB },
});

function browserHarness() {
  const scenario = window.__ENTRY_SMOKE_SCENARIO__;
  const markerKey = '__lootlinguaEntrySmokeRun';
  const cloudKey = '__lootlinguaEntrySmokeCloud';
  const eventKey = '__lootlinguaEntrySmokeEvents';

  if (sessionStorage.getItem(markerKey) !== scenario.runId) {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(markerKey, scenario.runId);
    Object.entries(scenario.localStorage || {}).forEach(([key, value]) => {
      localStorage.setItem(key, String(value));
    });
    localStorage.setItem(cloudKey, JSON.stringify(scenario.cloudEntries || {}));
    localStorage.setItem(eventKey, '[]');
  }

  const readObject = (key, fallback = {}) => {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
    catch (_) { return fallback; }
  };
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const pushEvent = (type, detail = {}) => {
    const events = readObject(eventKey, []);
    events.push({ type, detail: clone(detail), at: Date.now() });
    localStorage.setItem(eventKey, JSON.stringify(events));
  };
  const userFor = (uid) => uid ? clone(scenario.accounts?.[uid] || null) : null;
  const profileFor = (uid) => {
    if (!uid) return { uid: '', exists: false, data: {}, readFailed: false };
    const configured = scenario.profiles?.[uid];
    return configured
      ? { uid, exists: configured.exists === true, data: clone(configured.data || {}), readFailed: configured.readFailed === true }
      : { uid, exists: false, data: {}, readFailed: false };
  };
  const wordsFor = (uid) => clone(scenario.wordsByUid?.[uid] || []);

  window.__entrySmoke = {
    scenarioId: scenario.id,
    get events() { return readObject(eventKey, []); },
    entrySaveCalls: [],
    profileSaveCalls: [],
  };

  function setIdentity(uid, emit) {
    const user = userFor(uid);
    window.auth.currentUser = user;
    window.__lootlinguaAuthResolved = true;
    window.__lootlinguaAuthUser = user;
    window.__lootlinguaInitialDataReady = true;
    window.__lootlinguaProfileSnapshot = profileFor(uid);
    window.__lootlinguaMasterySnapshot = uid
      ? { uid, entryCount: 0, readFailed: false }
      : null;
    window.words = wordsFor(uid);
    pushEvent('identity', { uid: uid || 'guest' });
    if (emit) {
      window.dispatchEvent(new CustomEvent('lootlingua:auth-state', { detail: { user } }));
      window.dispatchEvent(new CustomEvent('lootlingua:initial-data-ready', { detail: { uid: uid || '' } }));
    }
    return user;
  }

  window.auth = { currentUser: null };
  window.__lootlinguaAuthResolved = true;
  window.__lootlinguaInitialDataReady = true;
  setIdentity(scenario.initialUid || '', false);

  window.LootLinguaEntryExperienceCloud = Object.freeze({
    async load(user) {
      const entries = readObject(cloudKey, {});
      const state = clone(entries[user.uid] || null);
      pushEvent('entry-load', { uid: user.uid, status: state?.status || 'missing', step: state?.currentStep || '' });
      return { exists: Boolean(state), state };
    },
    async loadLegacyPreferences() {
      return { exists: false, preferences: null };
    },
    async save(state, user) {
      const snapshot = clone(state);
      window.__entrySmoke.entrySaveCalls.push({ uid: user.uid, status: snapshot.status, step: snapshot.currentStep });
      pushEvent('entry-save', { uid: user.uid, status: snapshot.status, step: snapshot.currentStep });
      if (scenario.failEntryTerminal && ['completed', 'skipped'].includes(snapshot.status)) {
        const error = new Error('Injected Entry terminal write failure');
        error.code = 'entry/write-failed';
        throw error;
      }
      const entries = readObject(cloudKey, {});
      entries[user.uid] = { ...snapshot, updatedAt: Date.now() };
      localStorage.setItem(cloudKey, JSON.stringify(entries));
      return clone(entries[user.uid]);
    },
  });

  window.LootLinguaJourneyCloud = Object.freeze({
    async getActiveJourney() {
      return clone(scenario.journeys?.[window.auth.currentUser?.uid || ''] || null);
    },
    async hasAnyJourneyProgress() {
      return scenario.journeyProgressByUid?.[window.auth.currentUser?.uid || ''] === true;
    },
    async resolveActiveJourneyDestination() {
      return clone(scenario.journeyDestinations?.[window.auth.currentUser?.uid || ''] || null);
    },
  });

  window.LootLinguaPublishedContent = Object.freeze({
    async getPublishedWorld(worldId) {
      pushEvent('published-world-read', { worldId });
      if (worldId === 'smoke-world') return { worldId, title: 'عالم المعرفة' };
      if (worldId === 'games-world') return { worldId, title: 'عالم الألعاب' };
      return null;
    },
  });
  window.LootLinguaWorldsEntryPreview = Object.freeze({
    async loadWorldChoices(interestIds) {
      pushEvent('entry-worlds-read', { interestIds });
      return [
        {
          worldId: 'smoke-world', title: 'عالم المعرفة', description: 'رحلة منشورة للتعلّم اليومي',
          icon: '📚', rankCount: 2, gateCount: 6,
          recommendation: { kind: interestIds.includes('study') ? 'interest-match' : 'available' },
        },
        {
          worldId: 'games-world', title: 'عالم الألعاب', description: 'مصطلحات اللعب ضمن رحلة منظمة',
          icon: '🎮', rankCount: 3, gateCount: 9,
          recommendation: { kind: interestIds.includes('games') ? 'interest-match' : 'available' },
        },
      ].sort((left, right) => Number(right.recommendation.kind === 'interest-match') - Number(left.recommendation.kind === 'interest-match'));
    },
    async loadWorldStructure(worldId) {
      pushEvent('entry-structure-read', { worldId });
      return {
        world: { worldId, title: worldId === 'games-world' ? 'عالم الألعاب' : 'عالم المعرفة', icon: worldId === 'games-world' ? '🎮' : '📚' },
        ranks: [
          { rankId: 'rank-a1', title: 'المستكشف' },
          { rankId: 'rank-a2', title: 'المغامر' },
        ],
        rank: { rankId: 'rank-a1', title: 'المستكشف' },
        gates: [
          { gateId: 'gate-a1', title: 'بوابة البداية', wordCount: 12 },
          { gateId: 'gate-a2', title: 'بوابة الفهم', wordCount: 15 },
          { gateId: 'gate-a3', title: 'بوابة الإتقان', wordCount: 18 },
        ],
      };
    },
    async loadRankPreview(worldId, rankId) {
      pushEvent('entry-rank-preview-read', { worldId, rankId });
      return {
        rank: { rankId, title: rankId === 'rank-a2' ? 'المغامر' : 'المستكشف' },
        gates: [
          { gateId: `${rankId}-gate-1`, title: 'بوابة البداية', wordCount: 12 },
          { gateId: `${rankId}-gate-2`, title: 'بوابة الفهم', wordCount: 15 },
          { gateId: `${rankId}-gate-3`, title: 'بوابة الإتقان', wordCount: 18 },
        ],
      };
    },
    async loadGatePreview(worldId, rankId, gateId) {
      pushEvent('entry-gate-preview-read', { worldId, rankId, gateId });
      return {
        gate: { gateId, title: gateId.endsWith('-2') ? 'بوابة الفهم' : 'بوابة البداية', wordCount: 12 },
        words: [
          { word: 'explore', translation: 'يستكشف' },
          { word: 'path', translation: 'طريق' },
          { word: 'master', translation: 'يتقن' },
        ],
      };
    },
    async loadJourneyContext(journey) {
      pushEvent('entry-return-read', { worldId: journey.worldId });
      return {
        world: { worldId: journey.worldId, title: 'عالم رحلتك' },
        rank: { rankId: journey.activeRankId, title: 'رتبة المستكشف' },
        gate: { gateId: journey.activeGateId, title: 'بوابة البداية' },
      };
    },
  });
  window.LootLinguaJourneyEntryActions = Object.freeze({
    async resumePendingIntent(intent, world) {
      pushEvent('intent-resumed', { action: intent.action, worldId: world.worldId });
      window.loadWorldsView();
      window.openPublishedWorld(world.worldId);
      return scenario.restoreIntent === false
        ? { restored: false }
        : { restored: true, result: { worldId: world.worldId } };
    },
  });

  window.prepareGuestMigrationForUser = async () => 'none';
  window.loadActiveQuizSessionFromCloud = async () => null;
  window.flushDeferredEntryToasts = () => {};
  window.showToast = (message, type) => pushEvent('toast', { message, type });
  window.closeProfileModal = () => {};
  window.setTheme = (themeId) => {
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('theme', themeId);
    pushEvent('theme-applied', { themeId });
    return true;
  };
  window.setProfileOasisMode = (mode) => {
    document.documentElement.setAttribute('data-oasis-mode', mode);
    localStorage.setItem('lootlinguaOasisMode', mode);
    return true;
  };
  window._saveProfileToCloudNow = async (options = {}) => {
    window.__entrySmoke.profileSaveCalls.push({ uid: window.auth.currentUser?.uid || '', verify: options.verify === true });
    pushEvent('profile-save', { uid: window.auth.currentUser?.uid || '', success: !scenario.failProfile });
    return !scenario.failProfile;
  };

  const showView = (id) => {
    document.querySelectorAll('[data-smoke-view]').forEach((view) => { view.hidden = view.id !== id; });
    document.body.dataset.currentView = id;
    pushEvent('view', { id });
  };
  window.loadWorldsView = () => showView('worldsView');
  window.loadPersonalDictionary = () => showView('personalView');
  window.loadQuizView = () => showView('quizView');
  window.openPublishedWorld = (worldId) => {
    showView('worldsView');
    document.body.dataset.openWorld = worldId;
    pushEvent('open-world', { worldId });
  };

  window.fetchSuggestions = async () => {
    const word = document.getElementById('wordInput')?.value?.trim() || 'Spawn';
    const list = document.getElementById('suggestionsList');
    const suggestionsBox = document.getElementById('suggestionsBox');
    if (suggestionsBox) suggestionsBox.style.display = 'block';
    if (list) list.innerHTML = `<article class="sug-result-card"><strong>${word}</strong><span> يظهر / ينشأ</span></article>`;
    let bubble = document.getElementById('gamerMeaningBubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'gamerMeaningBubble';
      bubble.className = 'gamer-meaning-bubble search-zone';
      bubble.innerHTML = '<button type="button" class="gamer-meaning-btn"><span>معنى الألعاب</span></button>';
      document.getElementById('suggestionsBox')?.appendChild(bubble);
      bubble.querySelector('.gamer-meaning-btn')?.addEventListener('click', () => window.fetchGamerSuggestions());
    }
    pushEvent('dictionary-normal-result', { word });
    window.dispatchEvent(new CustomEvent('lootlingua:dictionary-search-result', {
      detail: { type: 'normal', status: 'success', word },
    }));
  };
  window.fetchGamerSuggestions = async () => {
    const outcome = scenario.gamerOutcome || 'success';
    const bubble = document.getElementById('gamerMeaningBubble');
    let panel = document.getElementById('gamerSuggestionsPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'gamerSuggestionsPanel';
      bubble?.insertAdjacentElement('afterend', panel);
    }
    if (panel) panel.textContent = outcome === 'success'
      ? 'Spawn: الظهور داخل الخريطة أو نقطة إعادة الظهور'
      : 'ما لقينا معنى ألعاب واضح لهالكلمة.';
    pushEvent('dictionary-gamer-result', { outcome });
    window.dispatchEvent(new CustomEvent('lootlingua:dictionary-search-result', {
      detail: { type: 'gamer', status: outcome, word: 'Spawn' },
    }));
  };

  window.login = async () => {
    pushEvent('login-called');
    if (scenario.authResult === 'cancel') return false;
    await Promise.resolve();
    setIdentity(scenario.loginUid, true);
    return true;
  };
  window.__smokeSwitchAccount = (uid) => setIdentity(uid, true);

  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('startJourneyBtn')?.addEventListener('click', () => {
      window.LootLinguaEntryExperienceController?.requestJourneyAuth({
        action: 'start-journey', worldId: 'smoke-world', source: 'world',
      });
    });
    document.querySelectorAll('[data-switch-account]').forEach((button) => {
      button.addEventListener('click', () => window.__smokeSwitchAccount(button.dataset.switchAccount));
    });
  }, { once: true });
}

function harnessHtml(scenario) {
  const serialized = JSON.stringify(scenario).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ar" dir="rtl" data-theme="lootlingua">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Product Entry Browser Smoke</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/entry-experience.css">
  <style>
    body { margin: 0; min-height: 100vh; background: #0d1220; color: #f7f8fb; font-family: Arial, sans-serif; }
    #smokeApp { min-height: 100vh; padding: 24px; box-sizing: border-box; }
    [data-smoke-view] { max-width: 880px; margin: 0 auto; padding: 28px; border: 1px solid #40506d; border-radius: 18px; background: #171f31; }
    [data-smoke-view][hidden] { display: none !important; }
    .smoke-controls { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
    .smoke-controls button { min-height: 44px; padding: 10px 16px; }
  </style>
</head>
<body data-current-view="homeView">
  <main id="smokeApp">
    <section id="homeView" data-smoke-view><h1>LootLingua smoke app</h1></section>
    <section id="personalView" data-smoke-view hidden>
      <h1>القاموس الشخصي</h1>
      <div id="normalSearchZone" class="search-zone" data-search-type="normal">
        <label for="wordInput">الكلمة الإنجليزية</label>
        <input id="wordInput" aria-label="الكلمة الإنجليزية">
        <button id="searchBtn" type="button" onclick="fetchSuggestions()">ابحث عن معنى</button>
      </div>
      <div id="suggestionsBox"><div id="suggestionsList"></div></div>
    </section>
    <section id="worldsView" data-smoke-view hidden><h1>العوالم</h1><button id="startJourneyBtn" type="button">ابدأ رحلة محفوظة</button></section>
    <section id="quizView" data-smoke-view hidden><h1>الاختبار</h1></section>
    <div class="smoke-controls">
      <button type="button" data-switch-account="account-a">الحساب A</button>
      <button type="button" data-switch-account="account-b">الحساب B</button>
    </div>
  </main>
  <div id="entryExperienceRoot" class="entry-experience-root" hidden aria-hidden="true">
    <div class="entry-experience-backdrop" aria-hidden="true"></div>
    <section id="entryExperiencePanel" class="entry-experience-panel" role="dialog" aria-modal="true" aria-labelledby="entryExperienceTitle"></section>
    <p id="entryExperienceStatus" class="entry-experience-status" role="status" aria-live="polite"></p>
  </div>
  <script>window.__ENTRY_SMOKE_SCENARIO__=${serialized};(${browserHarness.toString()})();</script>
  <script src="/js/entry-experience-contract.js"></script>
  <script src="/js/entry-experience-controller.js"></script>
</body>
</html>`;
}

let socket;
let nextId = 1;
const pending = new Map();
let activeCase = 'bootstrap';
const runtimeExceptions = [];
const errorLogs = [];

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 8000);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timeout);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timeout);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params }), (error) => {
      if (process.env.ENTRY_SMOKE_DEBUG === '1') {
        console.error(`entry-smoke CDP -> ${id} ${method}${error ? ` (${error.message})` : ''}`);
      }
      if (!error) return;
      const waiter = pending.get(id);
      pending.delete(id);
      waiter?.reject(error);
    });
  });
}

async function evaluate(expression, options = {}) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: options.awaitPromise !== false,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Evaluation failed');
  }
  return response.result?.value;
}

async function waitFor(expression, label, timeoutMs = 8000) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    try {
      lastValue = await evaluate(expression);
      if (lastValue) return lastValue;
    } catch (_) {}
    await delay(80);
  }
  throw new Error(`${activeCase}: timed out waiting for ${label}; last=${JSON.stringify(lastValue)}`);
}

async function click(selector) {
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' });
  })()`);
  await delay(80);
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (element.disabled || rect.width < 1 || rect.height < 1) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`${activeCase}: clickable element not found: ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await delay(120);
}

async function pressEscape() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await delay(120);
}

async function snapshot() {
  return evaluate(`(() => {
    const controller = window.LootLinguaEntryExperienceController;
    const state = controller?.getState?.() || null;
    const presentation = controller?.getPresentation?.() || null;
    const shell = document.getElementById('entryExperienceRoot');
    const visible = Boolean(shell && !shell.hidden && shell.getAttribute('aria-hidden') !== 'true');
    const cta = document.querySelector('[data-entry-cta]');
    const stage = !visible ? 'hidden' : (state?.currentStep || 'unknown');
    const pending = Object.keys(localStorage)
      .filter((key) => key.startsWith('lootlingua:pending-intent:v1:'))
      .map((key) => {
        try { return { key, value: JSON.parse(localStorage.getItem(key)) }; }
        catch (_) { return { key, value: null }; }
      });
    const panelRect = document.getElementById('entryExperiencePanel')?.getBoundingClientRect?.();
    return {
      scenarioId: window.__entrySmoke?.scenarioId,
      classification: presentation?.classification || '',
      audience: presentation?.audience || '',
      status: state?.status || '',
      currentStep: state?.currentStep || '',
      interestsStatus: state?.interestsStatus || '',
      interestIds: state?.interestIds || [],
      themeId: state?.themeId || '',
      themeExplicit: state?.themeExplicit === true,
      journeyStatus: state?.journeyStatus || '',
      selectedWorldId: state?.selectedWorldId || '',
      gamerStatus: state?.gamerStatus || '',
      visible,
      stage,
      worldCardCount: document.querySelectorAll('[data-entry-world]').length,
      routeNodeCount: document.querySelectorAll('[data-entry-route-node]').length,
      gamerGuideVisible: Boolean(document.getElementById('entryGamerGuide')),
      actionId: cta?.dataset.entryCta || '',
      actionIds: Array.from(document.querySelectorAll('[data-entry-cta]')).map((button) => button.dataset.entryCta),
      authVisible: Boolean(document.getElementById('journeyAuthPrompt')),
      pending,
      statusText: document.getElementById('entryExperienceStatus')?.textContent?.trim() || '',
      destination: document.body.dataset.currentView || '',
      openWorld: document.body.dataset.openWorld || '',
      events: window.__entrySmoke?.events || [],
      entrySaveCalls: window.__entrySmoke?.entrySaveCalls || [],
      profileSaveCalls: window.__entrySmoke?.profileSaveCalls || [],
      viewport: { width: innerWidth, height: innerHeight },
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      panelInsideViewport: !panelRect || (panelRect.left >= -1 && panelRect.right <= innerWidth + 1),
    };
  })()`);
}

async function screenshot(name) {
  if (process.env.ENTRY_SMOKE_SCREENSHOTS !== 'all' && !evidenceScreenshotNames.has(name)) return null;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await delay(120);
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const target = path.join(evidenceDir, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  return path.relative(root, target).replaceAll('\\', '/');
}

async function navigateScenario(id) {
  const scenario = scenarios.get(id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  activeCase = id;
  await send('Emulation.setDeviceMetricsOverride', {
    width: scenario.viewport.width,
    height: scenario.viewport.height,
    deviceScaleFactor: scenario.viewport.deviceScaleFactor,
    mobile: scenario.viewport.mobile,
    screenWidth: scenario.viewport.width,
    screenHeight: scenario.viewport.height,
  });
  await send('Page.navigate', { url: `${appUrl}?entry-smoke=${encodeURIComponent(id)}` });
  await waitFor(`document.readyState === 'complete' && Boolean(window.LootLinguaEntryExperienceController)`, 'controller load');
  await waitFor(`(() => {
    const controller = window.LootLinguaEntryExperienceController;
    return Boolean(controller?.getState?.()) || document.getElementById('entryExperienceRoot')?.hidden === true;
  })()`, 'entry boot');
  await delay(180);
  return snapshot();
}

async function reloadScenario() {
  await send('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState === 'complete' && Boolean(window.LootLinguaEntryExperienceController)`, 'controller reload');
  await waitFor(`Boolean(window.LootLinguaEntryExperienceController?.getState?.())`, 'entry state after reload');
  await delay(180);
  return snapshot();
}

async function stage() {
  return (await snapshot()).stage;
}

async function reachAction(options = {}) {
  const observed = [];
  for (let index = 0; index < 10; index += 1) {
    const current = await snapshot();
    if (!observed.includes(current.stage)) observed.push(current.stage);
    if (current.stage === 'destination') {
      return { observed, state: await snapshot() };
    }
    if (current.stage === 'interests') {
      if (!current.interestIds.length) await click(`[data-entry-interest="${options.interestId || 'study'}"]`);
      await click('[data-entry-action="continue-interests"]');
      await waitFor(`document.querySelector('[data-entry-theme]') !== null`, 'theme step');
      continue;
    }
    if (current.stage === 'theme') {
      await click('[data-entry-theme="ocean"]');
      await click('[data-entry-action="continue-theme"]');
      await waitFor(`document.querySelector('[data-entry-world]') !== null`, 'published World choices');
      continue;
    }
    if (current.stage === 'worlds') {
      if (options.captureStages) options.captureStages.push(await screenshot(`${options.screenshotPrefix || activeCase}-worlds`));
      const worldId = options.worldId || (current.interestIds.includes('games') ? 'games-world' : 'smoke-world');
      await click(`[data-entry-world="${worldId}"]`);
      await click('[data-entry-action="continue-worlds"]');
      await waitFor(`document.querySelector('[data-entry-route-node]') !== null`, 'Journey structure');
      continue;
    }
    if (current.stage === 'journey') {
      if (options.captureStages) options.captureStages.push(await screenshot(`${options.screenshotPrefix || activeCase}-journey-structure`));
      if (current.journeyStatus !== 'structure-explored') await click('[data-entry-route-node]');
      if (options.captureStages) options.captureStages.push(await screenshot(`${options.screenshotPrefix || activeCase}-journey-gate-preview`));
      await click('[data-entry-action="continue-journey"]');
      await waitFor(`window.LootLinguaEntryExperienceController?.getState?.()?.currentStep !== 'journey'`, 'post-Journey step');
      continue;
    }
    if (current.stage === 'context') {
      if (options.captureStages) options.captureStages.push(await screenshot(`${options.screenshotPrefix || activeCase}-context`));
      if (options.stopAtContext) return { observed, state: current };
      await click('[data-entry-action="skip-gamer-demo"]');
      await waitFor(`document.querySelector('[data-entry-cta]') !== null`, 'personalized destination');
      continue;
    }
    throw new Error(`${activeCase}: cannot reach destination from stage ${current.stage}`);
  }
  throw new Error(`${activeCase}: destination loop exhausted`);
}

function assertion(condition, message, failures) {
  if (!condition) failures.push(message);
}

async function runHappy(id, expected) {
  const failures = [];
  const images = [];
  const initial = await navigateScenario(id);
  images.push(await screenshot(`${id}-interests`));
  const reached = await reachAction({
    captureStages: id.startsWith('guest-new') ? images : null,
    screenshotPrefix: id,
  });
  const action = reached.state;
  images.push(await screenshot(`${id}-personalized-destination`));
  assertion(initial.classification === expected.classification, `classification=${initial.classification}, expected ${expected.classification}`, failures);
  assertion(initial.visible, 'Product Entry did not open', failures);
  assertion(action.stage === 'destination', `personalized destination missing (${action.stage})`, failures);
  assertion(action.status === 'in-progress', `completed before destination opened (${action.status})`, failures);
  assertion(action.journeyStatus === 'structure-explored', `Journey interaction proof=${action.journeyStatus}`, failures);
  assertion(action.actionId === expected.actionId, `action=${action.actionId}, expected ${expected.actionId}`, failures);
  assertion(action.noHorizontalOverflow && action.panelInsideViewport, 'mobile/desktop horizontal overflow detected', failures);
  await click(`[data-entry-cta="${expected.actionId}"]`);
  await waitFor(`document.getElementById('entryExperienceRoot')?.hidden === true`, 'Entry close after destination');
  const final = await snapshot();
  images.push(await screenshot(`${id}-destination`));
  assertion(final.status === 'completed', `final status=${final.status}`, failures);
  assertion(final.destination === expected.destination, `destination=${final.destination}, expected ${expected.destination}`, failures);
  return {
    id,
    classification: initial.classification,
    visibleSteps: reached.observed,
    onboardingInteraction: { worldId: action.selectedWorldId, journeyStatus: action.journeyStatus, statusBefore: action.status },
    auth: 'not shown during Product Entry',
    completion: { at: 'after destination CTA', status: final.status },
    destination: final.destination,
    viewport: action.viewport,
    layout: { noHorizontalOverflow: action.noHorizontalOverflow, panelInsideViewport: action.panelInsideViewport },
    images,
    failures,
    passed: failures.length === 0,
  };
}

async function runProgressAccount() {
  const id = 'account-journey';
  const failures = [];
  const images = [];
  const initial = await navigateScenario(id);
  images.push(await screenshot(`${id}-short-return`));
  assertion(initial.classification === 'returning-with-progress', `classification=${initial.classification}`, failures);
  assertion(initial.stage === 'return', `meaningful progress did not receive shortened return (${initial.stage})`, failures);
  assertion(initial.status === 'in-progress', `progress Entry already terminal (${initial.status})`, failures);
  await click('[data-entry-action="review-return"]');
  await click('[data-entry-action="continue-return"]');
  await waitFor(`document.querySelector('[data-entry-cta="continue-journey"]') !== null`, 'preserved Journey destination');
  const destination = await snapshot();
  assertion(destination.actionId === 'continue-journey', `action=${destination.actionId}`, failures);
  assertion(destination.journeyStatus === 'return-reviewed', `return proof=${destination.journeyStatus}`, failures);
  await click('[data-entry-cta="continue-journey"]');
  await waitFor(`document.getElementById('entryExperienceRoot')?.hidden === true`, 'progress destination close');
  const final = await snapshot();
  assertion(final.destination === 'worldsView' && final.openWorld === 'smoke-world', 'Journey destination was not restored', failures);
  assertion(final.status === 'completed', `final status=${final.status}`, failures);
  return {
    id,
    classification: initial.classification,
    visibleSteps: ['return', 'destination'],
    onboardingInteraction: { kind: 'shortened Journey reminder', journeyStatus: destination.journeyStatus },
    auth: 'not required',
    completion: { at: 'after Journey destination', status: final.status },
    destination: `${final.destination}:${final.openWorld}`,
    images,
    failures,
    passed: failures.length === 0,
  };
}

async function runGamerMeaning(id, expectedStatus) {
  const failures = [];
  const images = [];
  await navigateScenario(id);
  const reached = await reachAction({
    interestId: 'games',
    worldId: 'games-world',
    stopAtContext: true,
    captureStages: images,
    screenshotPrefix: id,
  });
  assertion(reached.state.stage === 'context', `games context missing (${reached.state.stage})`, failures);
  images.push(await screenshot(`${id}-optional-context`));
  const refreshedContext = await reloadScenario();
  assertion(refreshedContext.stage === 'context', `games context did not survive refresh (${refreshedContext.stage})`, failures);
  images.push(await screenshot(`${id}-context-after-refresh`));
  await click('[data-entry-action="start-gamer-demo"]');
  await waitFor(`document.getElementById('entryGamerGuide') !== null && document.querySelector('#searchBtn.entry-guided-search-target') !== null`, 'real search guide');
  images.push(await screenshot(`${id}-real-general-search`));
  await click('#searchBtn');
  await waitFor(`document.querySelector('#gamerMeaningBubble .gamer-meaning-btn.entry-guided-search-target') !== null`, 'real gamer meaning button');
  images.push(await screenshot(`${id}-real-gamer-button`));
  await click('#gamerMeaningBubble .gamer-meaning-btn');
  await waitFor(`document.getElementById('entryExperienceRoot')?.hidden === false && window.LootLinguaEntryExperienceController?.getState?.()?.currentStep === 'destination'`, 'return from gamer result');
  const returned = await snapshot();
  images.push(await screenshot(`${id}-returned-destination`));
  assertion(returned.gamerStatus === expectedStatus, `gamerStatus=${returned.gamerStatus}, expected ${expectedStatus}`, failures);
  assertion(!returned.authVisible, 'auth was shown because gamer meaning was unavailable', failures);
  assertion(returned.status === 'in-progress', `Entry completed before destination (${returned.status})`, failures);
  await click('[data-entry-cta="open-selected-world"]');
  await waitFor(`document.getElementById('entryExperienceRoot')?.hidden === true`, 'gamer route destination close');
  const final = await snapshot();
  assertion(final.status === 'completed', `final gamer route status=${final.status}`, failures);
  return {
    id,
    classification: reached.state.classification,
    visibleSteps: reached.observed,
    onboardingInteraction: { worldId: 'games-world', journeyStatus: returned.journeyStatus },
    gamerMeaning: { outcome: expectedStatus, contextRefresh: refreshedContext.stage, usedRealSearchButton: true, usedRealGamerButton: true },
    auth: 'not shown for success/empty gamer result',
    completion: { at: 'after selected World destination', status: final.status },
    destination: `${final.destination}:${final.openWorld}`,
    images,
    failures,
    passed: failures.length === 0,
  };
}

async function runCompletedAccount() {
  const id = 'account-completed';
  const failures = [];
  const initial = await navigateScenario(id);
  assertion(initial.classification === 'brand-new', `stored classification changed (${initial.classification})`, failures);
  assertion(!initial.visible && initial.stage === 'hidden', 'completed v2 was presented again', failures);
  assertion(initial.status === 'completed', `status=${initial.status}`, failures);
  return {
    id,
    classification: initial.classification,
    visibleSteps: [],
    onboardingInteraction: { visible: false, reason: 'v2 already completed' },
    auth: 'not shown',
    completion: { at: 'pre-existing version document', status: initial.status },
    destination: initial.destination,
    images: [await screenshot(`${id}-hidden-app`)],
    failures,
    passed: failures.length === 0,
  };
}

async function completeGuestToWorlds(id) {
  await navigateScenario(id);
  const reached = await reachAction();
  const action = reached.state;
  if (!action.actionIds.includes('open-selected-world')) {
    throw new Error(`${id}: selected guest World CTA is unavailable`);
  }
  await click('[data-entry-cta="open-selected-world"]');
  await waitFor(`document.getElementById('entryExperienceRoot')?.hidden === true && document.body.dataset.currentView === 'worldsView'`, 'guest worlds destination');
  await click('#startJourneyBtn');
  await waitFor(`document.getElementById('journeyAuthPrompt') !== null`, 'contextual auth prompt');
  return { reached, prompt: await snapshot() };
}

async function runAuthClose() {
  const id = 'auth-close';
  const failures = [];
  const images = [];
  const before = await completeGuestToWorlds(id);
  images.push(await screenshot(`${id}-prompt`));
  assertion(before.prompt.authVisible, 'contextual auth did not open', failures);
  assertion(before.prompt.pending.some((item) => item.value?.status === 'pending'), 'pending intent was not created', failures);
  await pressEscape();
  await waitFor(`document.getElementById('journeyAuthPrompt') === null`, 'auth prompt dismiss');
  const after = await snapshot();
  images.push(await screenshot(`${id}-guest-exploration`));
  assertion(after.pending.some((item) => item.value?.status === 'pending'), 'pending intent was lost on auth close', failures);
  assertion(after.destination === 'worldsView', `guest was not left in exploration (${after.destination})`, failures);
  assertion(after.status === 'completed', `Entry completion changed after auth close (${after.status})`, failures);
  return {
    id,
    classification: before.reached.state.classification,
    visibleSteps: before.reached.observed,
    onboardingInteraction: { visible: true, journeyStatus: before.reached.state.journeyStatus },
    auth: 'shown only after Start Journey; dismissed with real Escape key',
    pendingIntent: after.pending.map((item) => item.value?.status),
    completion: { at: 'guest exploration destination before cloud-only action', status: after.status },
    destination: after.destination,
    images,
    failures,
    passed: failures.length === 0,
  };
}

async function runAuthSuccess() {
  const id = 'auth-success';
  const failures = [];
  const images = [];
  const before = await completeGuestToWorlds(id);
  images.push(await screenshot(`${id}-prompt`));
  await click('[data-journey-auth="login"]');
  await waitFor(`(() => (window.__entrySmoke?.events || []).some((event) => event.type === 'intent-resumed'))()`, 'pending intent execution', 12000);
  await waitFor(`document.getElementById('journeyAuthPrompt') === null`, 'auth prompt close after login');
  const after = await snapshot();
  images.push(await screenshot(`${id}-resumed-intent`));
  const consumed = after.pending.find((item) => item.key.includes('user:account-auth-success'))?.value;
  assertion(consumed?.status === 'consumed', `account intent status=${consumed?.status || 'missing'}`, failures);
  assertion(!after.pending.some((item) => item.key.endsWith(':guest')), 'guest pending intent was not claimed', failures);
  assertion(after.events.some((event) => event.type === 'intent-resumed'), 'intent execution was not observed', failures);
  assertion(after.openWorld === 'smoke-world', `returned world=${after.openWorld}`, failures);
  return {
    id,
    classification: before.reached.state.classification,
    visibleSteps: before.reached.observed,
    onboardingInteraction: { visible: true, journeyStatus: before.reached.state.journeyStatus },
    auth: 'real DOM prompt → login button → auth-state callback',
    pendingIntent: consumed?.status || 'missing',
    completion: { at: 'guest World destination; intent consumed only after execution', status: after.status },
    destination: `${after.destination}:${after.openWorld}`,
    images,
    failures,
    passed: failures.length === 0,
  };
}

async function runRefreshGuest() {
  const id = 'refresh-guest';
  const failures = [];
  const images = [];
  await navigateScenario(id);
  await click('[data-entry-interest="technology"]');
  const interestBefore = await snapshot();
  const interestAfter = await reloadScenario();
  images.push(await screenshot(`${id}-interests-after-refresh`));
  assertion(interestAfter.stage === 'interests' && interestAfter.interestIds.includes('technology'), 'interests were not restored after refresh', failures);
  await click('[data-entry-action="continue-interests"]');
  await waitFor(`document.querySelector('[data-entry-theme]') !== null`, 'theme after refreshed interests');
  await click('[data-entry-theme="ocean"]');
  const themeBefore = await snapshot();
  const themeAfter = await reloadScenario();
  images.push(await screenshot(`${id}-theme-after-refresh`));
  assertion(themeAfter.stage === 'theme' && themeAfter.themeId === 'ocean', `theme was not restored (${themeAfter.stage}/${themeAfter.themeId})`, failures);
  await click('[data-entry-action="continue-theme"]');
  await waitFor(`document.querySelector('[data-entry-world]') !== null`, 'Worlds before refresh');
  const worldsBefore = await snapshot();
  const worldsAfter = await reloadScenario();
  await waitFor(`document.querySelector('[data-entry-world]') !== null`, 'Worlds after refresh');
  images.push(await screenshot(`${id}-worlds-after-refresh`));
  assertion(worldsBefore.stage === 'worlds' && worldsAfter.stage === 'worlds', `Worlds did not survive refresh (${worldsAfter.stage})`, failures);
  await click('[data-entry-world="smoke-world"]');
  await click('[data-entry-action="continue-worlds"]');
  await waitFor(`document.querySelector('[data-entry-route-node]') !== null`, 'Journey before refresh');
  const journeyBefore = await snapshot();
  const journeyAfter = await reloadScenario();
  await waitFor(`document.querySelector('[data-entry-route-node]') !== null`, 'Journey after refresh');
  images.push(await screenshot(`${id}-journey-after-refresh`));
  assertion(journeyBefore.stage === 'journey' && journeyAfter.stage === 'journey', `Journey did not survive refresh (${journeyAfter.stage})`, failures);
  await click('[data-entry-route-node]');
  const exploredBefore = await snapshot();
  const exploredAfter = await reloadScenario();
  images.push(await screenshot(`${id}-interaction-after-refresh`));
  assertion(exploredBefore.journeyStatus === 'structure-explored' && exploredAfter.journeyStatus === 'structure-explored', 'Journey interaction proof was not restored', failures);
  return {
    id,
    classification: interestAfter.classification,
    visibleSteps: ['interests', 'theme', 'worlds', 'journey'],
    refresh: {
      interests: { before: interestBefore.interestIds, after: interestAfter.interestIds },
      theme: { before: themeBefore.themeId, after: themeAfter.themeId },
      worlds: { before: worldsBefore.stage, after: worldsAfter.stage },
      journey: { before: journeyBefore.stage, after: journeyAfter.stage },
      interaction: { before: exploredBefore.journeyStatus, after: exploredAfter.journeyStatus },
    },
    onboardingInteraction: { visible: true, journeyStatus: exploredAfter.journeyStatus },
    auth: 'not shown',
    completion: { at: 'not yet complete', status: exploredAfter.status },
    destination: exploredAfter.destination,
    images,
    failures,
    passed: failures.length === 0,
  };
}

async function runRefreshAccountTheme() {
  const id = 'refresh-account-theme';
  const failures = [];
  await navigateScenario(id);
  await click('[data-entry-interest="study"]');
  await click('[data-entry-action="continue-interests"]');
  await waitFor(`document.querySelector('[data-entry-theme]') !== null`, 'account theme');
  await click('[data-entry-theme="ocean"]');
  const before = await snapshot();
  const after = await reloadScenario();
  assertion(after.stage === 'theme', `account step after refresh=${after.stage}`, failures);
  assertion(after.themeId === 'ocean' && after.themeExplicit, `newer local account appearance lost (${after.themeId})`, failures);
  return {
    id,
    classification: after.classification,
    visibleSteps: ['interests', 'theme'],
    refresh: { theme: { before: before.themeId, after: after.themeId, explicit: after.themeExplicit } },
    onboardingInteraction: { visible: false, reason: 'refresh probe stopped at theme' },
    auth: 'account already authenticated',
    completion: { at: 'not complete', status: after.status },
    destination: after.destination,
    images: [await screenshot(`${id}-theme-preserved`)],
    failures,
    passed: failures.length === 0,
  };
}

async function runTerminalFailure(id, kind) {
  const failures = [];
  const images = [];
  await navigateScenario(id);
  const reached = await reachAction();
  const before = reached.state;
  await click(`[data-entry-cta="${before.actionId}"]`);
  await waitFor(`document.getElementById('entryExperienceStatus')?.textContent?.trim().length > 0`, `${kind} failure message`);
  const failed = await snapshot();
  images.push(await screenshot(`${id}-kept-open`));
  assertion(failed.visible && failed.stage === 'destination', `Entry closed on ${kind} failure (${failed.stage})`, failures);
  assertion(failed.status === 'in-progress', `Entry became terminal on ${kind} failure (${failed.status})`, failures);
  assertion(failed.statusText.length > 0, `${kind} failure has no visible status`, failures);
  if (kind === 'profile') {
    assertion(failed.profileSaveCalls.length > 0, 'profile save was not attempted', failures);
    assertion(!failed.entrySaveCalls.some((call) => call.status === 'completed'), 'Entry terminal write ran after profile failure', failures);
  } else {
    assertion(failed.entrySaveCalls.some((call) => call.status === 'completed'), 'terminal Entry save failure was not injected', failures);
  }
  const refreshed = await reloadScenario();
  images.push(await screenshot(`${id}-after-refresh`));
  assertion(refreshed.visible && refreshed.stage === 'destination' && refreshed.status === 'in-progress', `${kind} failure did not remain resumable after refresh`, failures);
  return {
    id,
    classification: before.classification,
    visibleSteps: reached.observed,
    onboardingInteraction: { visible: true, journeyStatus: before.journeyStatus },
    auth: 'account already authenticated',
    failure: { kind, statusText: failed.statusText, saveCalls: failed.entrySaveCalls, profileCalls: failed.profileSaveCalls },
    completion: { at: 'not complete because persistence failed', status: failed.status },
    destination: failed.destination,
    refresh: { stage: refreshed.stage, status: refreshed.status },
    images,
    failures,
    passed: failures.length === 0,
  };
}

async function completeCurrentAccount() {
  const reached = await reachAction();
  const action = reached.state;
  await click(`[data-entry-cta="${action.actionId}"]`);
  await waitFor(`document.getElementById('entryExperienceRoot')?.hidden === true`, 'account completion close');
  return { reached, final: await snapshot() };
}

async function runAccountSwitch() {
  const id = 'account-switch';
  const failures = [];
  const images = [];
  const initialA = await navigateScenario(id);
  const completedA = await completeCurrentAccount();
  assertion(completedA.final.status === 'completed', 'account A did not complete', failures);
  await click('[data-switch-account="account-b"]');
  await waitFor(`document.getElementById('entryExperienceRoot')?.hidden === false`, 'account B Entry');
  const initialB = await snapshot();
  images.push(await screenshot(`${id}-account-b-entry`));
  assertion(initialB.classification === 'brand-new' && initialB.stage === 'interests', `account B inherited A state (${initialB.classification}/${initialB.stage})`, failures);
  const completedB = await completeCurrentAccount();
  assertion(completedB.final.status === 'completed', 'account B did not complete independently', failures);
  await click('[data-switch-account="account-a"]');
  await waitFor(`window.__lootlinguaAuthUser?.uid === 'account-a'`, 'switch back to account A');
  await delay(300);
  const returnedA = await snapshot();
  images.push(await screenshot(`${id}-account-a-return`));
  assertion(!returnedA.visible && returnedA.status === 'completed', `account A once-only state was not restored (${returnedA.stage}/${returnedA.status})`, failures);
  return {
    id,
    classification: { accountA: initialA.classification, accountB: initialB.classification },
    visibleSteps: { accountA: completedA.reached.observed, accountB: completedB.reached.observed },
    onboardingInteraction: { accountA: true, accountB: true },
    auth: 'two real auth-state callbacks on one browser profile',
    completion: { accountA: completedA.final.status, accountB: completedB.final.status },
    destination: { accountA: completedA.final.destination, accountB: completedB.final.destination },
    accountAReturnVisible: returnedA.visible,
    images,
    failures,
    passed: failures.length === 0,
  };
}

const results = [];

async function record(run) {
  try {
    const result = await run();
    results.push(result);
    console.log(`entry-smoke: ${result.id}: ${result.passed ? 'PASS' : 'FAIL'}`);
  } catch (error) {
    results.push({
      id: activeCase,
      passed: false,
      failures: [String(error?.stack || error)],
      images: [],
    });
    console.error(`entry-smoke: ${activeCase}: ERROR`, error);
  }
}

try {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await retry(async () => {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  });
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error(`CDP ${response.status}`);
  });

  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(2000),
  });
  if (!targetResponse.ok) throw new Error(`Unable to create Chrome target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  socket = new WebSocketClient(target.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    delay(4000).then(() => { throw new Error('CDP WebSocket open timeout'); }),
  ]);
  await delay(250);

  socket.on('message', async (data) => {
    let raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    if (process.env.ENTRY_SMOKE_DEBUG === '1') console.error('entry-smoke CDP <-', raw.slice(0, 500));
    const message = JSON.parse(raw);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params.request;
      let scenario;
      try {
        const url = new URL(request.url);
        scenario = scenarios.get(url.searchParams.get('entry-smoke'));
      } catch (_) {}
      if (message.params.resourceType === 'Document' && scenario) {
        const body = Buffer.from(harnessHtml(scenario), 'utf8').toString('base64');
        send('Fetch.fulfillRequest', {
          requestId: message.params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'text/html; charset=utf-8' },
            { name: 'Cache-Control', value: 'no-store' },
          ],
          body,
        }).catch(() => {});
      } else {
        send('Fetch.continueRequest', { requestId: message.params.requestId }).catch(() => {});
      }
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push({
        case: activeCase,
        error: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Unknown exception',
      });
    }
    if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') {
      errorLogs.push({ case: activeCase, error: message.params.entry.text });
    }
  });
  socket.on('close', (code, reason) => {
    if (process.env.ENTRY_SMOKE_DEBUG === '1') console.error('entry-smoke CDP closed', code, String(reason || ''));
  });
  socket.on('error', (error) => {
    if (process.env.ENTRY_SMOKE_DEBUG === '1') console.error('entry-smoke CDP error', error);
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Fetch.enable', {
    patterns: [{ urlPattern: `${origin}/app*`, resourceType: 'Document', requestStage: 'Request' }],
  });

  await record(() => runHappy('guest-new-desktop', { classification: 'brand-new', actionId: 'open-selected-world', destination: 'worldsView' }));
  await record(() => runHappy('guest-new-390', { classification: 'brand-new', actionId: 'open-selected-world', destination: 'worldsView' }));
  await record(() => runHappy('guest-new-320', { classification: 'brand-new', actionId: 'open-selected-world', destination: 'worldsView' }));
  await record(() => runHappy('guest-words', { classification: 'returning-guest-with-local-data', actionId: 'review-words', destination: 'personalView' }));
  await record(() => runHappy('guest-xp-light', { classification: 'returning-guest-with-local-data', actionId: 'open-selected-world', destination: 'worldsView' }));
  await record(() => runHappy('account-new', { classification: 'brand-new', actionId: 'open-selected-world', destination: 'worldsView' }));
  await record(() => runHappy('account-words', { classification: 'returning-light', actionId: 'review-words', destination: 'personalView' }));
  await record(runProgressAccount);
  await record(() => runGamerMeaning('guest-games-success', 'completed'));
  await record(() => runGamerMeaning('guest-games-empty', 'unavailable'));
  await record(runCompletedAccount);
  await record(runAuthClose);
  await record(runAuthSuccess);
  await record(runRefreshGuest);
  await record(runRefreshAccountTheme);
  await record(() => runTerminalFailure('entry-cloud-failure', 'entry'));
  await record(() => runTerminalFailure('profile-cloud-failure', 'profile'));
  await record(runAccountSwitch);

  results.forEach((result) => {
    result.images = (result.images || []).filter(Boolean);
  });
  const failures = results.flatMap((result) => (result.failures || []).map((failure) => ({ case: result.id, failure })));
  const summary = {
    generatedAt: new Date().toISOString(),
    browser: browserPath,
    appUrl,
    harness: 'real Chrome DOM/input/reload with Firebase replaced by an in-page deterministic adapter',
    passed: failures.length === 0 && runtimeExceptions.length === 0 && errorLogs.length === 0,
    caseCount: results.length,
    failures,
    runtimeExceptions,
    errorLogs,
    cases: results,
  };
  fs.writeFileSync(path.join(evidenceDir, 'matrix.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.passed) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch (_) {}
  browser.kill();
  server.kill();
  browser.unref();
  server.unref();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
}
