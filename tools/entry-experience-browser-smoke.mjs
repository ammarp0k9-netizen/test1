import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocketClient from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const evidenceDir = path.join(root, 'reports', 'product-entry-evidence');
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
    contractVersion: 1,
    experienceVersion: 1,
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
    actionStatus: 'pending',
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
      status: 'completed', currentStep: 'action', actionStatus: 'completed', completedAt: Date.now() - 1000,
    }),
  },
});
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
      return worldId === 'smoke-world' ? { worldId, title: 'Smoke World' } : null;
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
    <section id="personalView" data-smoke-view hidden><h1>القاموس الشخصي</h1><input id="wordInput" aria-label="الكلمة الإنجليزية"></section>
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
    const interest = document.querySelector('[data-entry-interest]');
    const theme = document.querySelector('[data-entry-theme]');
    const cta = document.querySelector('[data-entry-cta]');
    const stage = !visible ? 'hidden' : (interest ? 'interests' : (theme ? 'theme' : (cta || document.querySelector('.entry-first-action-card') ? 'action' : 'unknown')));
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
      visible,
      stage,
      firstActionCard: Boolean(document.querySelector('.entry-first-action-card')),
      firstActionRevealed: Boolean(document.querySelector('.entry-first-action-card.is-revealed')),
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
  for (let index = 0; index < 6; index += 1) {
    const current = await snapshot();
    if (!observed.includes(current.stage)) observed.push(current.stage);
    if (current.stage === 'action') {
      if (documentNeedsReveal(current) && options.reveal !== false) {
        await click('[data-entry-action="reveal-value"]');
      }
      return { observed, state: await snapshot() };
    }
    if (current.stage === 'interests') {
      if (!current.interestIds.length) await click('[data-entry-interest="study"]');
      await click('[data-entry-action="continue-interests"]');
      await waitFor(`document.querySelector('[data-entry-theme]') !== null`, 'theme step');
      continue;
    }
    if (current.stage === 'theme') {
      await click('[data-entry-theme="ocean"]');
      const nextSelector = await evaluate(`document.querySelector('[data-entry-action="continue-action"]')
        ? '[data-entry-action="continue-action"]'
        : '[data-entry-action="complete"]'`);
      await click(nextSelector);
      await waitFor(`document.querySelector('[data-entry-cta], .entry-first-action-card') !== null || document.getElementById('entryExperienceRoot')?.hidden === true`, 'first action');
      continue;
    }
    throw new Error(`${activeCase}: cannot reach action from stage ${current.stage}`);
  }
  throw new Error(`${activeCase}: action step loop exhausted`);
}

function documentNeedsReveal(current) {
  return current.firstActionCard && !current.firstActionRevealed;
}

function assertion(condition, message, failures) {
  if (!condition) failures.push(message);
}

async function runHappy(id, expected) {
  const failures = [];
  const images = [];
  const initial = await navigateScenario(id);
  images.push(await screenshot(`${id}-interests`));
  const reached = await reachAction();
  const action = reached.state;
  images.push(await screenshot(`${id}-first-action`));
  assertion(initial.classification === expected.classification, `classification=${initial.classification}, expected ${expected.classification}`, failures);
  assertion(initial.visible, 'Product Entry did not open', failures);
  assertion(action.stage === 'action', `first action stage missing (${action.stage})`, failures);
  assertion(action.status === 'in-progress', `completed before first action (${action.status})`, failures);
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
    firstAction: { visible: action.stage === 'action', revealed: action.firstActionRevealed, statusBefore: action.status },
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
  assertion(initial.stage === 'action', `meaningful progress did not receive shortened action (${initial.stage})`, failures);
  assertion(initial.status === 'in-progress', `progress Entry already terminal (${initial.status})`, failures);
  assertion(initial.actionId === 'continue-journey', `action=${initial.actionId}`, failures);
  await click('[data-entry-cta="continue-journey"]');
  await waitFor(`document.getElementById('entryExperienceRoot')?.hidden === true`, 'progress destination close');
  const final = await snapshot();
  assertion(final.destination === 'worldsView' && final.openWorld === 'smoke-world', 'Journey destination was not restored', failures);
  assertion(final.status === 'completed', `final status=${final.status}`, failures);
  return {
    id,
    classification: initial.classification,
    visibleSteps: [initial.stage],
    firstAction: { visible: true, kind: 'shortened return CTA', statusBefore: initial.status },
    auth: 'not required',
    completion: { at: 'after Journey destination', status: final.status },
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
  assertion(!initial.visible && initial.stage === 'hidden', 'completed v1 was presented again', failures);
  assertion(initial.status === 'completed', `status=${initial.status}`, failures);
  return {
    id,
    classification: initial.classification,
    visibleSteps: [],
    firstAction: { visible: false, reason: 'v1 already completed' },
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
  if (!action.actionIds.includes('explore-worlds')) {
    throw new Error(`${id}: secondary guest explore-worlds CTA is unavailable`);
  }
  await click('[data-entry-cta="explore-worlds"]');
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
    firstAction: { visible: true, revealed: true },
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
    firstAction: { visible: true, revealed: true },
    auth: 'real DOM prompt → login button → auth-state callback',
    pendingIntent: consumed?.status || 'missing',
    completion: { at: 'guest first-action destination; intent consumed only after execution', status: after.status },
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
  const nextSelector = await evaluate(`document.querySelector('[data-entry-action="continue-action"]')
    ? '[data-entry-action="continue-action"]'
    : '[data-entry-action="complete"]'`);
  await click(nextSelector);
  await waitFor(`document.querySelector('[data-entry-cta], .entry-first-action-card') !== null || document.getElementById('entryExperienceRoot')?.hidden === true`, 'action before refresh');
  const actionBefore = await snapshot();
  const actionAfter = await reloadScenario();
  images.push(await screenshot(`${id}-action-after-refresh`));
  assertion(actionBefore.stage === 'action' && actionBefore.status === 'in-progress', `action was terminal before refresh (${actionBefore.stage}/${actionBefore.status})`, failures);
  assertion(actionAfter.stage === 'action' && actionAfter.visible && actionAfter.status === 'in-progress', `action did not survive refresh (${actionAfter.stage}/${actionAfter.status})`, failures);
  return {
    id,
    classification: interestAfter.classification,
    visibleSteps: ['interests', 'theme', 'action'],
    refresh: {
      interests: { before: interestBefore.interestIds, after: interestAfter.interestIds },
      theme: { before: themeBefore.themeId, after: themeAfter.themeId },
      action: { before: `${actionBefore.stage}/${actionBefore.status}`, after: `${actionAfter.stage}/${actionAfter.status}` },
    },
    firstAction: { visible: actionAfter.stage === 'action' },
    auth: 'not shown',
    completion: { at: 'not yet complete', status: actionAfter.status },
    destination: actionAfter.destination,
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
    firstAction: { visible: false, reason: 'refresh probe stopped at theme' },
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
  assertion(failed.visible && failed.stage === 'action', `Entry closed on ${kind} failure (${failed.stage})`, failures);
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
  assertion(refreshed.visible && refreshed.stage === 'action' && refreshed.status === 'in-progress', `${kind} failure did not remain resumable after refresh`, failures);
  return {
    id,
    classification: before.classification,
    visibleSteps: reached.observed,
    firstAction: { visible: true, revealed: true },
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
    firstAction: { accountA: true, accountB: true },
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

  await record(() => runHappy('guest-new-desktop', { classification: 'brand-new', actionId: 'new-user-start', destination: 'personalView' }));
  await record(() => runHappy('guest-new-390', { classification: 'brand-new', actionId: 'new-user-start', destination: 'personalView' }));
  await record(() => runHappy('guest-new-320', { classification: 'brand-new', actionId: 'new-user-start', destination: 'personalView' }));
  await record(() => runHappy('guest-words', { classification: 'returning-guest-with-local-data', actionId: 'review-words', destination: 'personalView' }));
  await record(() => runHappy('guest-xp-light', { classification: 'returning-guest-with-local-data', actionId: 'new-user-start', destination: 'personalView' }));
  await record(() => runHappy('account-new', { classification: 'brand-new', actionId: 'new-user-start', destination: 'personalView' }));
  await record(() => runHappy('account-words', { classification: 'returning-light', actionId: 'review-words', destination: 'personalView' }));
  await record(runProgressAccount);
  await record(runCompletedAccount);
  await record(runAuthClose);
  await record(runAuthSuccess);
  await record(runRefreshGuest);
  await record(runRefreshAccountTheme);
  await record(() => runTerminalFailure('entry-cloud-failure', 'entry'));
  await record(() => runTerminalFailure('profile-cloud-failure', 'profile'));
  await record(runAccountSwitch);

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
