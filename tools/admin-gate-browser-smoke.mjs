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

const portOffset = (process.pid + 173) % 500;
const serverPort = 8850 + portOffset;
const debugPort = 9850 + portOffset;
const appUrl = 'http://127.0.0.1:' + serverPort + '/';
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-admin-gate-smoke-'));

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
  '--remote-debugging-port=' + debugPort,
  '--user-data-dir=' + profileDir,
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
    delay(7000).then(() => { throw new Error('CDP command timeout: ' + method); }),
  ]);
}

const harnessSource = `(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const adminSnapshot = Object.freeze({ resolved: true, isAdmin: true, uid: 'gate-smoke-admin', errorCode: '' });
  const state = {
    listWorldCalls: 0,
    listRankCalls: 0,
    listGateCalls: 0,
    getGateCalls: 0,
    createGateCalls: 0,
    updateGateCalls: 0,
    moveGateCalls: 0,
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
      title: 'عالم اختبار البوابات',
      subtitle: 'عالم وهمي',
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
      rankCount: 2,
      gateCount: 1,
      wordCount: 7,
      order: 1,
      isFeatured: false,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-02T10:00:00.000Z'
    }],
    ranks: [{
      schemaVersion: 1,
      worldId: 'smoke-world',
      rankId: 'smoke-rank',
      title: 'رتبة البوابة',
      subtitle: 'الرتبة المصدر',
      description: '',
      order: 1,
      difficulty: 'beginner',
      status: 'draft',
      version: 3,
      gateCount: 1,
      wordCount: 7,
      unlockConfig: {
        mode: 'manual_placeholder',
        initialStatus: 'available',
        requiredMasteredRatio: null,
        requiredReviewingRatio: null,
        requiredGateCount: null
      },
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-02T10:00:00.000Z'
    }, {
      schemaVersion: 1,
      worldId: 'smoke-world',
      rankId: 'smoke-target-rank',
      title: 'رتبة النقل',
      subtitle: 'الرتبة الهدف',
      description: '',
      order: 2,
      difficulty: 'intermediate',
      status: 'draft',
      version: 2,
      gateCount: 0,
      wordCount: 0,
      unlockConfig: {
        mode: 'manual_placeholder',
        initialStatus: 'locked',
        requiredMasteredRatio: null,
        requiredReviewingRatio: null,
        requiredGateCount: null
      },
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-02T10:00:00.000Z'
    }],
    gates: [{
      schemaVersion: 1,
      worldId: 'smoke-world',
      rankId: 'smoke-rank',
      gateId: 'smoke-gate',
      title: 'بوابة الاختبار',
      subtitle: 'بوابة وهمية',
      description: '',
      order: 1,
      difficulty: 'beginner',
      status: 'draft',
      version: 5,
      wordCount: 7,
      entryAssessmentPassRatio: null,
      unlockConfig: {
        mode: 'manual_placeholder',
        initialStatus: 'locked',
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
    async getRank() { throw new Error('smoke/unexpected-get-rank'); },
    async createRank() { throw new Error('smoke/unexpected-create-rank'); },
    async updateRank() { throw new Error('smoke/unexpected-update-rank'); },
    async setRankStatus() { throw new Error('smoke/unexpected-rank-status'); },
    async duplicateRankAsDraft() { throw new Error('smoke/unexpected-duplicate-rank'); },
    async requestDeleteRank() { throw new Error('smoke/unexpected-delete-rank'); },
    async listGates(worldId, rankId) {
      state.listGateCalls += 1;
      return clone(state.gates.filter(gate => gate.worldId === worldId && gate.rankId === rankId));
    },
    async getGate(worldId, rankId, gateId) {
      state.getGateCalls += 1;
      return clone(state.gates.find(gate =>
        gate.worldId === worldId && gate.rankId === rankId && gate.gateId === gateId
      ) || null);
    },
    async createGate() {
      state.createGateCalls += 1;
      throw new Error('smoke/create-submit-was-not-requested');
    },
    async updateGate(worldId, rankId, gateId, payload, expectedVersion) {
      state.updateGateCalls += 1;
      state.lastUpdate = { worldId, rankId, gateId, payload: clone(payload), expectedVersion };
      return new Promise(resolve => {
        state.resolveUpdate = () => {
          const gate = state.gates.find(item =>
            item.worldId === worldId && item.rankId === rankId && item.gateId === gateId
          );
          if (gate) {
            gate.title = payload.title;
            gate.subtitle = payload.subtitle;
            gate.description = payload.description;
            gate.order = payload.order;
            gate.difficulty = payload.difficulty;
            gate.entryAssessmentPassRatio = payload.entryAssessmentPassRatio;
            gate.unlockConfig = clone(payload.unlockConfig);
            gate.version += 1;
            gate.updatedAt = '2026-07-03T10:00:00.000Z';
          }
          state.resolveUpdate = null;
          resolve(clone(gate));
        };
      });
    },
    async setGateStatus() { throw new Error('smoke/unexpected-gate-status'); },
    async publishGateDraftWords() { throw new Error('smoke/unexpected-publish-gate-words'); },
    async duplicateGateAsDraft() { throw new Error('smoke/unexpected-duplicate-gate'); },
    async moveGate() {
      state.moveGateCalls += 1;
      throw new Error('smoke/move-submit-was-not-requested');
    },
    async requestDeleteGate() { throw new Error('smoke/unexpected-delete-gate'); },
    async importStagingWords() { throw new Error('smoke/unexpected-import-staging'); },
    async listStagingWords() { throw new Error('smoke/unexpected-list-staging'); },
    async countStagingWords() { throw new Error('smoke/unexpected-count-staging'); },
    async getStagingWord() { throw new Error('smoke/unexpected-get-staging'); },
    async deleteStagingWords() { throw new Error('smoke/unexpected-delete-staging'); },
    async distributeStagingWords() { throw new Error('smoke/unexpected-distribute-staging'); },
    async listWords() { throw new Error('smoke/unexpected-list-words'); },
    async getWord() { throw new Error('smoke/unexpected-get-word'); },
    async createWord() { throw new Error('smoke/unexpected-create-word'); },
    async updateWord() { throw new Error('smoke/unexpected-update-word'); },
    async setWordStatus() { throw new Error('smoke/unexpected-word-status'); },
    async inspectWordDuplicates() { throw new Error('smoke/unexpected-word-duplicates'); },
    async archiveWord() { throw new Error('smoke/unexpected-archive-word'); },
    async duplicateWord() { throw new Error('smoke/unexpected-duplicate-word'); },
    async moveWord() { throw new Error('smoke/unexpected-move-word'); },
    async bulkPublishWords() { throw new Error('smoke/unexpected-bulk-publish-words'); },
    async bulkArchiveWords() { throw new Error('smoke/unexpected-bulk-archive-words'); },
    async bulkMoveWords() { throw new Error('smoke/unexpected-bulk-move-words'); },
    async requestDeleteWord() { throw new Error('smoke/unexpected-delete-word'); }
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
  window.__adminGateSmokeHarness = { state, facade };
})()`;

const probeExpression = `(async () => {
  const harness = window.__adminGateSmokeHarness;
  const state = harness.state;
  window.confirm = () => true;
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
  const breadcrumb = root =>
    Array.from(root.querySelectorAll('.admin-breadcrumb > *')).map(node => node.textContent.trim());

  const opened = await window.loadAdminView();
  await waitFor(() => document.querySelector('.admin-world-row'), 'dashboard world row');
  const dashboard = {
    opened,
    visible: !document.getElementById('adminView').hidden,
    worldRows: document.querySelectorAll('.admin-world-row').length,
    manageRanksButton: Boolean(document.querySelector('[data-admin-action="open-ranks"][data-world-id="smoke-world"]')),
  };

  click('[data-admin-action="open-ranks"][data-world-id="smoke-world"]');
  await waitFor(() => document.querySelectorAll('.admin-rank-row').length === 2, 'rank list rows');
  const ranks = {
    rows: document.querySelectorAll('.admin-rank-row').length,
    gateButton: Boolean(document.querySelector('[data-admin-action="open-gates"][data-rank-id="smoke-rank"]')),
  };

  click('[data-admin-action="open-gates"][data-rank-id="smoke-rank"]');
  const gateRow = await waitFor(() => document.querySelector('.admin-gate-row'), 'gate list row');
  const gates = {
    rows: document.querySelectorAll('.admin-gate-row').length,
    breadcrumb: breadcrumb(document.getElementById('adminView')),
    wordCountVisible: gateRow.textContent.includes('7 كلمة'),
    defaultThresholdVisible: /75|٧٥/.test(gateRow.textContent) && gateRow.textContent.includes('افتراضية'),
    entryOnlyNote: text('.admin-assessment-note').includes('عتبة اختبار الدخول فقط'),
  };

  click('[data-admin-action="create-gate"]');
  const createEditor = await waitFor(() => document.querySelector('.admin-gate-editor'), 'create gate editor');
  const createThreshold = createEditor.querySelector('[name="entryAssessmentPassPercent"]');
  const create = {
    opened: Boolean(createEditor),
    breadcrumb: breadcrumb(createEditor),
    hasOrder: Boolean(createEditor.querySelector('[name="order"]')),
    thresholdBlank: createThreshold?.value === '',
    thresholdDefaultHelp: /75|٧٥/.test(createThreshold?.closest('.admin-field')?.textContent || ''),
  };
  click('.admin-gate-editor [data-admin-action="close-modal"]');
  await waitFor(() => !document.querySelector('.admin-modal-overlay'), 'create editor close');

  click('.admin-gate-row [data-admin-action="edit-gate"]');
  const editEditor = await waitFor(() => document.querySelector('.admin-gate-editor'), 'edit gate editor');
  const editForm = editEditor.querySelector('.admin-gate-form');
  const titleInput = editForm.elements.namedItem('title');
  const thresholdInput = editForm.elements.namedItem('entryAssessmentPassPercent');
  titleInput.value = 'بوابة الاختبار المحدثة';
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  editForm.requestSubmit();
  editForm.requestSubmit();
  await waitFor(
    () => state.updateGateCalls === 1 && editForm.getAttribute('aria-busy') === 'true',
    'pending gate update'
  );
  const pendingSave = {
    updateCalls: state.updateGateCalls,
    saveDisabled: editForm.querySelector('button[type="submit"]').disabled,
    ariaBusy: editForm.getAttribute('aria-busy'),
    modalStillOpen: Boolean(document.querySelector('.admin-gate-editor')),
    thresholdStayedBlank: thresholdInput.value === '',
    successBeforeResolve: state.toasts.some(item => item.type === 'success'),
  };
  if (typeof state.resolveUpdate !== 'function') throw new Error('Deferred gate update was not captured');
  state.resolveUpdate();
  await waitFor(() => !document.querySelector('.admin-modal-overlay'), 'gate save completion');
  await waitFor(
    () => text('.admin-gate-row .admin-world-title') === 'بوابة الاختبار المحدثة',
    'updated gate list title'
  );
  const completedSave = {
    updateCalls: state.updateGateCalls,
    getGateCalls: state.getGateCalls,
    expectedVersion: state.lastUpdate?.expectedVersion,
    submittedTitle: state.lastUpdate?.payload?.title,
    submittedThreshold: state.lastUpdate?.payload?.entryAssessmentPassRatio,
    successAfterResolve: state.toasts.some(item =>
      item.type === 'success' && item.message.includes('تم حفظ البوابة')
    ),
    listTitle: text('.admin-gate-row .admin-world-title'),
  };

  click('.admin-gate-row [data-admin-action="move-gate"]');
  const moveDialog = await waitFor(() => document.querySelector('.admin-move-gate-dialog'), 'move gate dialog');
  const targetWorld = moveDialog.querySelector('[name="targetWorldId"]');
  const targetRank = moveDialog.querySelector('[name="targetRankId"]');
  const confirmation = moveDialog.querySelector('[name="confirmationTitle"]');
  await waitFor(
    () => Array.from(targetRank.options).some(option => option.value === 'smoke-target-rank'),
    'move target rank option'
  );
  targetRank.value = 'smoke-target-rank';
  targetRank.dispatchEvent(new Event('change', { bubbles: true }));
  confirmation.value = 'بوابة الاختبار المحدثة';
  confirmation.dispatchEvent(new Event('input', { bubbles: true }));
  const move = {
    opened: Boolean(moveDialog),
    breadcrumb: breadcrumb(moveDialog),
    targetWorld: targetWorld.value,
    targetRankAvailable: Array.from(targetRank.options).some(option => option.value === 'smoke-target-rank'),
    sourceRankExcluded: !Array.from(targetRank.options).some(option => option.value === 'smoke-rank'),
    enabledAfterExactConfirmation: !moveDialog.querySelector('button[type="submit"]').disabled,
  };
  click('.admin-move-gate-dialog [data-admin-action="close-modal"]');
  await waitFor(() => !document.querySelector('.admin-modal-overlay'), 'move dialog close');

  return {
    dashboard,
    ranks,
    gates,
    create,
    pendingSave,
    completedSave,
    move,
    calls: {
      listWorldCalls: state.listWorldCalls,
      listRankCalls: state.listRankCalls,
      listGateCalls: state.listGateCalls,
      createGateCalls: state.createGateCalls,
      moveGateCalls: state.moveGateCalls,
    },
  };
})()`;

try {
  console.log('admin-gate-smoke: waiting for local server');
  await retry(async () => {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
  });
  console.log('admin-gate-smoke: waiting for browser debugging endpoint');
  await retry(async () => {
    const response = await fetch('http://127.0.0.1:' + debugPort + '/json/version', {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) throw new Error('CDP ' + response.status);
  });
  const targetResponse = await fetch(
    'http://127.0.0.1:' + debugPort + '/json/new?' + encodeURIComponent('about:blank'),
    { method: 'PUT', signal: AbortSignal.timeout(2000) }
  );
  if (!targetResponse.ok) throw new Error('Unable to create browser target: ' + targetResponse.status);
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
      runtimeExceptions.push(
        message.params.exceptionDetails?.exception?.description ||
        message.params.exceptionDetails?.text ||
        'Unknown exception'
      );
    }
  });
  await Promise.all([send('Runtime.enable'), send('Page.enable')]);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: harnessSource });
  await send('Page.navigate', { url: appUrl });
  await retry(async () => {
    const readiness = await send('Runtime.evaluate', {
      expression: "document.readyState === 'complete' && typeof window.loadAdminView === 'function' && Boolean(window.__adminGateSmokeHarness)",
      returnByValue: true,
    });
    if (readiness.result?.value !== true) throw new Error('Admin gate UI is not ready');
  }, 80, 250);

  runtimeExceptions.length = 0;
  const evaluation = await send('Runtime.evaluate', {
    expression: probeExpression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ||
      evaluation.exceptionDetails.text ||
      'Gate probe failed'
    );
  }
  const result = evaluation.result?.value;
  console.log(JSON.stringify({ result, runtimeExceptions }, null, 2));

  const passed = result?.dashboard?.opened === true &&
    result?.dashboard?.visible === true &&
    result?.dashboard?.worldRows === 1 &&
    result?.dashboard?.manageRanksButton === true &&
    result?.ranks?.rows === 2 &&
    result?.ranks?.gateButton === true &&
    result?.gates?.rows === 1 &&
    result?.gates?.breadcrumb?.join('|') === 'الإدارة|←|عالم اختبار البوابات|←|رتبة البوابة' &&
    result?.gates?.wordCountVisible === true &&
    result?.gates?.defaultThresholdVisible === true &&
    result?.gates?.entryOnlyNote === true &&
    result?.create?.opened === true &&
    result?.create?.breadcrumb?.join('|') === 'الإدارة|←|عالم اختبار البوابات|←|رتبة البوابة|←|بوابة جديدة' &&
    result?.create?.hasOrder === true &&
    result?.create?.thresholdBlank === true &&
    result?.create?.thresholdDefaultHelp === true &&
    result?.pendingSave?.updateCalls === 1 &&
    result?.pendingSave?.saveDisabled === true &&
    result?.pendingSave?.ariaBusy === 'true' &&
    result?.pendingSave?.modalStillOpen === true &&
    result?.pendingSave?.thresholdStayedBlank === true &&
    result?.pendingSave?.successBeforeResolve === false &&
    result?.completedSave?.updateCalls === 1 &&
    result?.completedSave?.getGateCalls === 1 &&
    result?.completedSave?.expectedVersion === 5 &&
    result?.completedSave?.submittedTitle === 'بوابة الاختبار المحدثة' &&
    result?.completedSave?.submittedThreshold === null &&
    result?.completedSave?.successAfterResolve === true &&
    result?.completedSave?.listTitle === 'بوابة الاختبار المحدثة' &&
    result?.move?.opened === true &&
    result?.move?.breadcrumb?.join('|') === 'الإدارة|←|عالم اختبار البوابات|←|رتبة البوابة|←|بوابة الاختبار المحدثة' &&
    result?.move?.targetWorld === 'smoke-world' &&
    result?.move?.targetRankAvailable === true &&
    result?.move?.sourceRankExcluded === true &&
    result?.move?.enabledAfterExactConfirmation === true &&
    result?.calls?.createGateCalls === 0 &&
    result?.calls?.moveGateCalls === 0 &&
    runtimeExceptions.length === 0;
  if (!passed) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  browser.kill();
  server.kill();
  browser.unref();
  server.unref();
}
