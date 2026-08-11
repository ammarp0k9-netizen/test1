import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocketClient from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const evidenceDir = path.join(root, 'reports', 'landing-auth-evidence');
const browserPath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));
if (!browserPath) throw new Error('Chrome/Edge not found');

const offset = (process.pid + 193) % 400;
const serverPort = 8850 + offset;
const debugPort = 9850 + offset;
const landingUrl = `http://127.0.0.1:${serverPort}/`;
const appUrl = `http://127.0.0.1:${serverPort}/app`;
const liveFirebase = process.env.LANDING_FIREBASE_MODE === 'live';
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-landing-smoke-'));
fs.mkdirSync(evidenceDir, { recursive: true });

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
  '--disable-gpu-compositing',
  '--disable-gpu-shader-disk-cache',
  '--disable-software-rasterizer',
  '--disable-features=SkiaGraphite,Vulkan',
  '--in-process-gpu',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { cwd: root, stdio: 'ignore' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function retry(operation, attempts = 60, waitMs = 200) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation(); }
    catch (error) { lastError = error; await delay(waitMs); }
  }
  throw lastError;
}

let socket;
let nextId = 1;
const pending = new Map();
const firebaseResponses = [];
const runtimeExceptions = [];
const missingAssets = [];
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function waitFor(expression, label, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(expression)) return; }
    catch (_) {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function captureScreenshot(id, selector = '') {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await delay(120);
  const clip = selector ? await evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    if (!rect) return null;
    return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height, scale: 1 };
  })()`) : null;
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: Boolean(clip),
    ...(clip ? { clip } : {}),
  });
  const imagePath = path.join(evidenceDir, `${id}.png`);
  fs.writeFileSync(imagePath, Buffer.from(result.data, 'base64'));
  return path.relative(root, imagePath).replaceAll('\\', '/');
}

const layoutAuditExpression = `(() => {
  const width = document.documentElement.clientWidth;
  const visible = Array.from(document.querySelectorAll('header, main, footer, section, article, .auth-dialog, .app-auth-dialog'))
    .filter((node) => !node.closest('[hidden]') && getComputedStyle(node).display !== 'none');
  const outside = visible.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.left < -1 || rect.right > width + 1;
  });
  const dialog = document.querySelector('.auth-dialog, .app-auth-dialog');
  const dialogShell = document.querySelector('[data-auth-dialog]');
  const dialogRect = dialog?.getBoundingClientRect();
  return {
    clientWidth: width,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > width,
    elementsInside: outside.length === 0,
    outside: outside.map((node) => node.className || node.tagName).slice(0, 5),
    authState: document.body.dataset.authState || '',
    authProvider: document.body.dataset.authProvider || '',
    dialogOpen: Boolean(dialogShell && !dialogShell.hidden),
    dialogLeft: dialogRect ? Math.round(dialogRect.left) : null,
    dialogRight: dialogRect ? Math.round(dialogRect.right) : null,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    activeElement: document.activeElement?.id || document.activeElement?.tagName || '',
    heroCta: document.querySelector('[data-journey-label]')?.textContent?.trim() || '',
    authMessage: document.querySelector('[data-auth-message]')?.textContent?.trim() || '',
    emailAutocomplete: document.querySelector('[data-auth-input="email"]')?.autocomplete || '',
    passwordAutocomplete: document.querySelector('[data-auth-input="password"]')?.autocomplete || '',
    confirmationAutocomplete: document.querySelector('[data-auth-input="confirmation"]')?.autocomplete || '',
    productPreviewCount: document.querySelectorAll('.product-preview').length,
    productPreviewImages: Array.from(document.querySelectorAll('.product-preview img')).map((node) => node.currentSrc || node.src),
    firebaseResources: performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('firebase-')),
  };
})()`;

const scenarios = [
  { id: 'landing-desktop-1440', width: 1440, height: 1000 },
  { id: 'landing-hero', width: 1440, height: 900, section: '#top' },
  { id: 'landing-context', width: 1440, height: 900, section: '#context' },
  { id: 'landing-journey', width: 1440, height: 900, section: '#journey' },
  { id: 'landing-review', width: 1440, height: 900, section: '#review' },
  { id: 'landing-final-cta', width: 1440, height: 900, section: '.final-cta' },
  { id: 'landing-tablet-834', width: 834, height: 1112 },
  { id: 'landing-mobile-390', width: 390, height: 844, mobile: true },
  { id: 'landing-mobile-320', width: 320, height: 568, mobile: true },
  { id: 'auth-dialog-desktop', width: 1440, height: 1000, auth: true },
  { id: 'auth-sheet-mobile', width: 390, height: 844, mobile: true, auth: true },
  { id: 'app-auth-dialog-desktop', width: 1440, height: 1000, auth: true, app: true },
  { id: 'landing-reduced-motion', width: 390, height: 844, mobile: true, reducedMotion: true },
];

try {
  await retry(async () => {
    const response = await fetch(landingUrl, { signal: AbortSignal.timeout(750) });
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
  if (!targetResponse.ok) throw new Error(`Unable to create browser target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  socket = new WebSocketClient(target.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
    delay(4000).then(() => { throw new Error('CDP WebSocket open timeout'); }),
  ]);
  socket.on('message', (data) => {
    const message = JSON.parse(Buffer.from(data).toString('utf8'));
    if (message.method === 'Network.responseReceived') {
      const response = message.params.response;
      if (response?.url?.includes('www.gstatic.com/firebasejs/')) {
        firebaseResponses.push({ url: response.url, status: response.status });
      }
      if (response?.status === 404 && response.url.startsWith(`http://127.0.0.1:${serverPort}/`)) {
        missingAssets.push(response.url);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(
        message.params.exceptionDetails?.exception?.description ||
        message.params.exceptionDetails?.text ||
        'Unknown runtime exception',
      );
    }
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  if (!liveFirebase) {
    await send('Network.setBlockedURLs', { urls: ['https://www.gstatic.com/*'] });
  }

  const selectedScenario = process.env.LANDING_SCENARIO;
  const scenariosToRun = selectedScenario
    ? scenarios.filter((scenario) => scenario.id === selectedScenario)
    : scenarios;
  if (!scenariosToRun.length) throw new Error(`Unknown LANDING_SCENARIO: ${selectedScenario}`);

  const matrix = [];
  for (const scenario of scenariosToRun) {
    const exceptionOffset = runtimeExceptions.length;
    await send('Emulation.setDeviceMetricsOverride', {
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
      mobile: scenario.mobile === true,
      screenWidth: scenario.width,
      screenHeight: scenario.height,
    });
    await send('Emulation.setEmulatedMedia', {
      features: [{
        name: 'prefers-reduced-motion',
        value: scenario.reducedMotion ? 'reduce' : 'no-preference',
      }],
    });
    const url = new URL(scenario.app ? appUrl : landingUrl);
    if (scenario.auth && !scenario.app) url.searchParams.set('auth', 'login');
    await send('Page.navigate', { url: url.href });
    if (scenario.app) {
      await waitFor(`document.readyState === 'complete' && document.getElementById('appAuthDialogShell')`, `${scenario.id} app shell`);
      await delay(700);
      await evaluate(`(async () => {
        document.getElementById('smartLoadingOverlay')?.remove();
        document.getElementById('toastHost')?.remove();
        const entry = document.getElementById('entryExperienceRoot');
        if (entry) { entry.hidden = true; entry.setAttribute('aria-hidden', 'true'); }
        document.documentElement.classList.remove('entry-experience-active', 'journey-auth-active');
        document.body.classList.remove('entry-experience-active', 'journey-auth-active');
        const root = document.getElementById('appAuthDialogShell');
        root.inert = false;
        const module = await import('/js/app-auth-ui.js');
        const unavailable = () => Promise.reject(Object.assign(new Error('offline'), { code: 'auth/network-request-failed' }));
        const surface = await module.mountAppAuth({ gateway: {
          observeAuth(callback) { queueMicrotask(() => callback(null)); return () => {}; },
          currentUser: () => null,
          hasPendingRedirect: () => false,
          clearPendingRedirect() {},
          finishRedirect: async () => null,
          signInWithGoogle: unavailable,
          signIn: unavailable,
          createAccount: unavailable,
          sendPasswordReset: unavailable,
        }});
        surface.open('login');
        return true;
      })()`);
    } else {
      await waitFor(
        `document.readyState === 'complete' && document.body?.dataset.authState === 'guest'`,
        `${scenario.id} landing auth fallback`,
      );
    }
    if (scenario.auth) {
      await waitFor(`document.querySelector('[data-auth-dialog]')?.hidden === false`, `${scenario.id} Auth surface`);
    }
    if (scenario.section) {
      await evaluate(`(() => {
        document.querySelectorAll('.reveal').forEach((node) => node.classList.add('is-visible'));
        document.querySelector(${JSON.stringify(scenario.section)})?.scrollIntoView({ block: 'start' });
      })()`);
    }
    await delay(350);

    const audit = await evaluate(layoutAuditExpression);
    if (audit.clientWidth !== scenario.width || audit.clientHeight !== scenario.height) {
      throw new Error(`${scenario.id}: incorrect viewport ${JSON.stringify(audit)}`);
    }
    if (audit.overflow || !audit.elementsInside) {
      throw new Error(`${scenario.id}: invalid layout audit ${JSON.stringify(audit)}`);
    }
    if (scenario.auth && (!audit.dialogOpen || audit.dialogLeft < -1 || audit.dialogRight > audit.clientWidth + 1)) {
      throw new Error(`${scenario.id}: Auth surface is outside the viewport ${JSON.stringify(audit)}`);
    }
    if (scenario.reducedMotion && !audit.reducedMotion) {
      throw new Error(`${scenario.id}: reduced-motion preference was not applied`);
    }
    const scenarioExceptions = runtimeExceptions.slice(exceptionOffset);
    if (scenarioExceptions.length && !scenario.app) {
      throw new Error(`${scenario.id}: runtime exceptions ${JSON.stringify(scenarioExceptions)}`);
    }
    const liveSdkResponses = firebaseResponses.filter((response) =>
      response.url.endsWith('/firebase-app.js') || response.url.endsWith('/firebase-auth.js'));
    const expectedProvider = liveFirebase ? 'firebase' : 'offline';
    if (!scenario.app && audit.authProvider !== expectedProvider) {
      throw new Error(`${scenario.id}: expected ${expectedProvider} Auth provider ${JSON.stringify(audit)}`);
    }
    if (!scenario.app && (audit.productPreviewCount !== 4 || audit.productPreviewImages.length)) {
      throw new Error(`${scenario.id}: previews must be four image-free DOM compositions ${JSON.stringify(audit)}`);
    }
    const image = await captureScreenshot(scenario.id, scenario.section);
    let authInteractions = null;
    if (scenario.auth) {
      authInteractions = await evaluate(`(() => {
        const shell = document.querySelector('[data-auth-dialog]');
        const password = shell.querySelector('[data-auth-input="password"]');
        const confirmation = shell.querySelector('[data-auth-input="confirmation"]');
        document.querySelector('[data-auth-switch="signup"]')?.click();
        const signupState = {
          passwordAutocomplete: password?.autocomplete || '',
          confirmationAutocomplete: confirmation?.autocomplete || '',
          confirmationVisible: !confirmation?.closest('[data-confirmation-field]')?.hidden,
        };
        password.value = 'temporary-value';
        confirmation.value = 'temporary-value';
        shell.querySelector('[data-password-toggle="password"]')?.click();
        const passwordRevealWorks = password.type === 'text';
        document.querySelector('[data-auth-close]')?.click();
        return {
          signupState,
          passwordRevealWorks,
          closesAndClearsPasswords: shell.hidden && password.value === '' && confirmation.value === '',
        };
      })()`);
      const validAuthInteraction =
        authInteractions.signupState.passwordAutocomplete === 'new-password' &&
        authInteractions.signupState.confirmationAutocomplete === 'new-password' &&
        authInteractions.signupState.confirmationVisible &&
        authInteractions.passwordRevealWorks &&
        authInteractions.closesAndClearsPasswords;
      if (!validAuthInteraction) {
        throw new Error(`${scenario.id}: Auth interaction audit failed ${JSON.stringify(authInteractions)}`);
      }
    }
    matrix.push({
      id: scenario.id,
      viewport: { width: scenario.width, height: scenario.height },
      image,
      audit,
      ...(liveFirebase ? { liveSdkResponses } : {}),
      ...(authInteractions ? { authInteractions } : {}),
      ...(scenario.app ? { deterministicAppAuth: true, ignoredAppRuntimeExceptions: scenarioExceptions } : {}),
    });
  }

  if (missingAssets.length) throw new Error(`Missing same-origin assets: ${JSON.stringify([...new Set(missingAssets)])}`);

  const summary = {
    generatedAt: new Date().toISOString(),
    browser: path.basename(browserPath),
    firebaseMode: liveFirebase ? 'live-sdk-guest-session' : 'deterministic-offline-fallback',
    missingAssets: [],
    matrix,
  };
  const matrixName = liveFirebase ? 'live-matrix.json' : 'matrix.json';
  fs.writeFileSync(path.join(evidenceDir, matrixName), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  socket?.close();
  browser.kill();
  browser.unref();
  server.kill();
  server.unref();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
