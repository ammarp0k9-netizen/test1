import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browserPath = browserCandidates.find(candidate => fs.existsSync(candidate));
if (!browserPath) throw new Error('Chrome/Edge not found');

const portOffset = process.pid % 500;
const serverPort = 8800 + portOffset;
const debugPort = 9800 + portOffset;
const appUrl = `http://127.0.0.1:${serverPort}/`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-admin-rank-smoke-'));

const server = spawn(process.execPath, [path.join(root, 'tools', 'static-server.mjs'), String(serverPort)], {
  cwd: root,
  stdio: 'ignore',
});
const browser = spawn(browserPath, [
  '--headless=new',
  '--no-first-run',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retry(operation, attempts = 60, waitMs = 250) {
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

let socket;
let nextId = 1;
const pending = new Map();
const runtimeExceptions = [];

function send(method, params = {}) {
  const request = new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return Promise.race([
    request,
    delay(7000).then(() => { throw new Error(`CDP command timeout: ${method}`); }),
  ]);
}

const harnessSource = `(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const adminSnapshot = Object.freeze({ resolved: true, isAdmin: true, uid: 'smoke-admin', errorCode: '' });
  const state = {
    listWorldCalls: 0,
    listRankCalls: 0,
    getRankCalls: 0,
    createRankCalls: 0,
    updateRankCalls: 0,
    toasts: [],
    lastUpdate: null,
    resolveUpdate: null,
    realCloudFacade: null,
    realStateGetter: null,
    realAccessCheck: null,
    worlds: [{
      schemaVersion: 1,
      worldId: 'smoke-world',
      slug: 'smoke-world',
      title: 'عالم الاختبار',
      subtitle: 'عالم وهمي لاختبار الواجهة',
      description: '',
      icon: '',
      cover: '',
      theme: '',
      category: 'smoke',
      difficulty: 'beginner',
      languageFrom: 'en',
      languageTo: 'ar',
      status: 'draft',
      version: 4,
      rankCount: 1,
      gateCount: 2,
      wordCount: 12,
      order: 1,
      isFeatured: false,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-02T10:00:00.000Z'
    }],
    ranks: [{
      schemaVersion: 1,
      worldId: 'smoke-world',
      rankId: 'smoke-rank',
      title: 'رتبة الاختبار',
      subtitle: 'رتبة وهمية',
      description: '',
      order: 1,
      difficulty: 'beginner',
      status: 'draft',
      version: 3,
      gateCount: 2,
      wordCount: 12,
      unlockConfig: {
        mode: 'manual_placeholder',
        initialStatus: 'available',
        requiredMasteredRatio: null,
        requiredReviewingRatio: null,
        requiredGateCount: null
      },
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-02T10:00:00.000Z'
    }]
  };

  const facade = Object.freeze({
    async listWorlds() {
      state.listWorldCalls += 1;
      return clone(state.worlds);
    },
    async getWorld(worldId) {
      return clone(state.worlds.find(world => world.worldId === worldId) || null);
    },
    async createWorld() { throw new Error('smoke/unexpected-create-world'); },
    async updateWorld() { throw new Error('smoke/unexpected-update-world'); },
    async setWorldStatus() { throw new Error('smoke/unexpected-world-status'); },
    async requestDeleteWorld() { throw new Error('smoke/unexpected-delete-world'); },
    async listRanks(worldId) {
      state.listRankCalls += 1;
      return clone(state.ranks.filter(rank => rank.worldId === worldId));
    },
    async getRank(worldId, rankId) {
      state.getRankCalls += 1;
      return clone(state.ranks.find(rank => rank.worldId === worldId && rank.rankId === rankId) || null);
    },
    async createRank() {
      state.createRankCalls += 1;
      throw new Error('smoke/create-submit-was-not-requested');
    },
    async updateRank(worldId, rankId, payload, expectedVersion) {
      state.updateRankCalls += 1;
      state.lastUpdate = { worldId, rankId, payload: clone(payload), expectedVersion };
      return new Promise(resolve => {
        state.resolveUpdate = () => {
          const rank = state.ranks.find(item => item.worldId === worldId && item.rankId === rankId);
          if (rank) {
            rank.title = payload.title;
            rank.subtitle = payload.subtitle;
            rank.description = payload.description;
            rank.order = payload.order;
            rank.difficulty = payload.difficulty;
            rank.unlockConfig = clone(payload.unlockConfig);
            rank.version += 1;
            rank.updatedAt = '2026-07-03T10:00:00.000Z';
          }
          state.resolveUpdate = null;
          resolve(clone(rank));
        };
      });
    },
    async setRankStatus() { throw new Error('smoke/unexpected-rank-status'); },
    async duplicateRankAsDraft() { throw new Error('smoke/unexpected-duplicate-rank'); },
    async requestDeleteRank() { throw new Error('smoke/unexpected-delete-rank'); },
    async listGates() { throw new Error('smoke/unexpected-list-gates'); },
    async getGate() { throw new Error('smoke/unexpected-get-gate'); },
    async createGate() { throw new Error('smoke/unexpected-create-gate'); },
    async updateGate() { throw new Error('smoke/unexpected-update-gate'); },
    async setGateStatus() { throw new Error('smoke/unexpected-gate-status'); },
    async duplicateGateAsDraft() { throw new Error('smoke/unexpected-duplicate-gate'); },
    async moveGate() { throw new Error('smoke/unexpected-move-gate'); },
    async requestDeleteGate() { throw new Error('smoke/unexpected-delete-gate'); }
  });

  Object.defineProperty(window, 'LootLinguaAdminCloud', {
    configurable: true,
    get: () => facade,
    set: value => { state.realCloudFacade = value; }
  });
  Object.defineProperty(window, 'getLootLinguaAdminState', {
    configurable: true,
    get: () => () => ({ ...adminSnapshot }),
    set: value => { state.realStateGetter = value; }
  });
  Object.defineProperty(window, 'ensureLootLinguaAdminAccess', {
    configurable: true,
    get: () => async () => ({ ...adminSnapshot }),
    set: value => { state.realAccessCheck = value; }
  });
  window.__adminRankSmokeHarness = { state, facade };
})()`;

const probeExpression = `(async () => {
  const harness = window.__adminRankSmokeHarness;
  const state = harness.state;
  window.showToast = (message, type) => {
    state.toasts.push({ message: String(message), type: String(type || '') });
  };
  const waitFor = async (predicate, label, timeout = 6000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const value = predicate();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for ' + label);
  };
  const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
  const click = selector => {
    const target = document.querySelector(selector);
    if (!target) throw new Error('Missing click target: ' + selector);
    target.click();
    return target;
  };

  const opened = await window.loadAdminView();
  await waitFor(() => document.querySelector('.admin-world-row'), 'dashboard world row');
  const dashboard = {
    opened,
    visible: !document.getElementById('adminView').hidden,
    title: text('.admin-dashboard-title'),
    worldRows: document.querySelectorAll('.admin-world-row').length,
    manageRanksButton: Boolean(document.querySelector('[data-admin-action="open-ranks"][data-world-id="smoke-world"]')),
  };

  click('[data-admin-action="open-ranks"][data-world-id="smoke-world"]');
  await waitFor(() => document.querySelector('.admin-rank-row'), 'rank list row');
  const rankList = {
    title: text('.admin-dashboard-title'),
    rows: document.querySelectorAll('.admin-rank-row').length,
    breadcrumb: Array.from(document.querySelectorAll('#adminView > .admin-breadcrumb > *')).map(node => node.textContent.trim()),
    gateCountVisible: document.querySelector('.admin-rank-row')?.textContent.includes('2 بوابة') === true,
    wordCountVisible: document.querySelector('.admin-rank-row')?.textContent.includes('12 كلمة') === true,
  };

  click('[data-admin-action="create-rank"]');
  const createEditor = await waitFor(() => document.querySelector('.admin-rank-editor'), 'create rank editor');
  const create = {
    opened: Boolean(createEditor),
    title: text('#adminRankEditorTitle'),
    breadcrumb: Array.from(createEditor.querySelectorAll('.admin-breadcrumb > *')).map(node => node.textContent.trim()),
    hasOrder: Boolean(createEditor.querySelector('[name="order"]')),
    hasInitialStatus: Boolean(createEditor.querySelector('[name="initialStatus"]')),
  };
  click('.admin-rank-editor [data-admin-action="close-modal"]');
  await waitFor(() => !document.querySelector('.admin-modal-overlay'), 'create editor close');

  click('.admin-rank-row [data-admin-action="edit-rank"]');
  const editEditor = await waitFor(() => document.querySelector('.admin-rank-editor'), 'edit rank editor');
  const editForm = editEditor.querySelector('.admin-rank-form');
  const titleInput = editForm.elements.namedItem('title');
  const originalVersion = text('.admin-editor-version');
  titleInput.value = 'رتبة الاختبار المحدثة';
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  editForm.requestSubmit();
  editForm.requestSubmit();
  await waitFor(() => state.updateRankCalls === 1 && editForm.getAttribute('aria-busy') === 'true', 'pending update');
  const pendingSave = {
    updateCalls: state.updateRankCalls,
    saveDisabled: editForm.querySelector('button[type="submit"]').disabled,
    ariaBusy: editForm.getAttribute('aria-busy'),
    modalStillOpen: Boolean(document.querySelector('.admin-rank-editor')),
    successBeforeResolve: state.toasts.some(item => item.type === 'success'),
  };
  if (typeof state.resolveUpdate !== 'function') throw new Error('Deferred update was not captured');
  state.resolveUpdate();
  await waitFor(() => !document.querySelector('.admin-modal-overlay'), 'edit save completion');
  await waitFor(() => text('.admin-rank-row .admin-world-title') === 'رتبة الاختبار المحدثة', 'updated rank list title');
  const completedSave = {
    updateCalls: state.updateRankCalls,
    getRankCalls: state.getRankCalls,
    expectedVersion: state.lastUpdate?.expectedVersion,
    submittedTitle: state.lastUpdate?.payload?.title,
    successAfterResolve: state.toasts.some(item => item.type === 'success' && item.message.includes('تم حفظ الرتبة')),
    listTitle: text('.admin-rank-row .admin-world-title'),
    originalVersion,
  };

  return {
    dashboard,
    rankList,
    create,
    pendingSave,
    completedSave,
    calls: {
      listWorldCalls: state.listWorldCalls,
      listRankCalls: state.listRankCalls,
      createRankCalls: state.createRankCalls,
    },
  };
})()`;

try {
  console.log('admin-rank-smoke: waiting for local server');
  await retry(async () => {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  });
  console.log('admin-rank-smoke: waiting for browser debugging endpoint');
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
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }),
    delay(3000).then(() => { throw new Error('WebSocket open timeout'); }),
  ]);
  socket.addEventListener('message', async event => {
    let raw = event.data;
    if (typeof raw !== 'string') {
      raw = typeof raw?.text === 'function' ? await raw.text() : Buffer.from(raw).toString('utf8');
    }
    const message = JSON.parse(raw);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Unknown exception');
    }
  });
  await Promise.all([send('Runtime.enable'), send('Page.enable')]);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: harnessSource });
  await send('Page.navigate', { url: appUrl });
  await retry(async () => {
    const readiness = await send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && typeof window.loadAdminView === 'function' && Boolean(window.__adminRankSmokeHarness)`,
      returnByValue: true,
    });
    if (readiness.result?.value !== true) throw new Error('Admin UI is not ready');
  }, 80, 250);

  runtimeExceptions.length = 0;
  const evaluation = await send('Runtime.evaluate', {
    expression: probeExpression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text || 'Probe failed');
  }
  const result = evaluation.result?.value;
  console.log(JSON.stringify({ result, runtimeExceptions }, null, 2));

  const passed = result?.dashboard?.opened === true &&
    result?.dashboard?.visible === true &&
    result?.dashboard?.worldRows === 1 &&
    result?.dashboard?.manageRanksButton === true &&
    result?.rankList?.rows === 1 &&
    result?.rankList?.breadcrumb?.join('|') === 'الإدارة|←|عالم الاختبار' &&
    result?.rankList?.gateCountVisible === true &&
    result?.rankList?.wordCountVisible === true &&
    result?.create?.opened === true &&
    result?.create?.breadcrumb?.join('|') === 'الإدارة|←|عالم الاختبار|←|رتبة جديدة' &&
    result?.create?.hasOrder === true &&
    result?.create?.hasInitialStatus === true &&
    result?.pendingSave?.updateCalls === 1 &&
    result?.pendingSave?.saveDisabled === true &&
    result?.pendingSave?.ariaBusy === 'true' &&
    result?.pendingSave?.modalStillOpen === true &&
    result?.pendingSave?.successBeforeResolve === false &&
    result?.completedSave?.updateCalls === 1 &&
    result?.completedSave?.getRankCalls === 1 &&
    result?.completedSave?.expectedVersion === 3 &&
    result?.completedSave?.submittedTitle === 'رتبة الاختبار المحدثة' &&
    result?.completedSave?.successAfterResolve === true &&
    result?.completedSave?.listTitle === 'رتبة الاختبار المحدثة' &&
    result?.calls?.createRankCalls === 0 &&
    runtimeExceptions.length === 0;
  if (!passed) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  browser.kill();
  server.kill();
  browser.unref();
  server.unref();
}
