import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const browserPath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));
if (!browserPath) throw new Error('Chrome/Edge not found');

const offset = (process.pid + 311) % 500;
const serverPort = 8900 + offset;
const debugPort = 9900 + offset;
const appUrl = `http://127.0.0.1:${serverPort}/`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-gate-mastery-smoke-'));
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
function send(method, params = {}) {
  const request = new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return Promise.race([
    request,
    delay(7000).then(() => { throw new Error(`CDP timeout: ${method}`); }),
  ]);
}

const probe = `(() => {
  const world = { worldId: 'smoke-world', title: 'عالم الاختبار' };
  const rank = {
    worldId: 'smoke-world', rankId: 'smoke-rank', title: 'رتبة الاختبار',
    status: 'published', order: 0,
  };
  const gate = {
    worldId: 'smoke-world', rankId: 'smoke-rank', gateId: 'smoke-gate',
    title: 'بوابة الاختبار', status: 'published', order: 0,
  };
  const loaded = {
    worldId: 'smoke-world', rankId: 'smoke-rank', gateId: 'smoke-gate',
    status: 'cleared', loadedAt: Date.now(),
    loadedContentWordIds: ['one', 'two', 'three'],
    loadedWordKeys: ['one', 'two', 'three'],
  };
  publishedContentState.journey = {
    worldId: 'smoke-world', unlockedRankIds: ['smoke-rank'],
    unlockedGateIds: ['smoke-gate', 'next-gate'], levelPlacementClearedGateIds: [],
  };
  publishedContentState.activeJourney = {
    worldId: 'smoke-world', activeRankId: 'smoke-rank', activeGateId: 'next-gate',
  };
  publishedContentState.ranks = [rank];
  publishedContentState.gates = [gate];
  publishedContentState.journeyAction = null;
  publishedContentState.journeyError = null;
  publishedContentState.newGateWords = [];

  const mount = (progress, view) => {
    publishedContentState.gateProgress = progress;
    publishedContentState.gateMasteryView = view;
    const panel = makePublishedGateJourneyPanel(world, rank, gate);
    document.body.append(panel);
    return panel;
  };

  let reviewCall = null;
  window.startGateGapReview = (keys, context) => {
    reviewCall = { keys: [...keys], context: { ...context } };
    return true;
  };
  let masteryByKey = new Map();
  window.getSharedWordMasteryByKey = (wordKey) => masteryByKey.get(wordKey) || null;
  const destinationBefore = JSON.stringify(publishedContentState.activeJourney);
  const gap = mount(loaded, {
    derivedState: 'cleared-with-gap', gapCount: 3,
    gapWordKeys: ['one', 'two', 'three'], newContentWords: [],
  });
  gap.querySelector('button')?.click();
  const gapResult = {
    copy: gap.textContent.includes('مجتازة — بقي 3 كلمات لإتقانها'),
    action: gap.textContent.includes('راجع الكلمات المتبقية'),
    noCrown: !gap.querySelector('.fa-crown'),
    exactKeys: reviewCall?.keys?.join(',') === 'one,two,three',
    destinationStable: destinationBefore === JSON.stringify(publishedContentState.activeJourney),
  };

  publishedContentState.newGateWords = [{ contentWordId: 'new' }];
  masteryByKey = new Map(['one', 'two', 'three'].map((wordKey) => [wordKey, {
    mastery_status: 'Reviewing', mastered_once: true,
  }]));
  const mastered = mount(loaded, {
    derivedState: 'mastered', crownEarned: true, gapCount: 1,
    gapWordKeys: ['one'], newContentWords: [{ contentWordId: 'new' }],
  });
  const masteredResult = {
    label: mastered.textContent.includes('متقنة'),
    crown: Boolean(mastered.querySelector('.fa-crown')),
    contentNotice: mastered.textContent.includes('لا يغيّر Crown المحفوظ'),
    noGapAction: !mastered.textContent.includes('راجع الكلمات المتبقية'),
  };

  publishedContentState.newGateWords = [];
  const withoutLoad = mount({
    ...loaded, loadedAt: undefined, loadedWordKeys: undefined,
    loadedContentWordIds: undefined, clearedBy: 'level-placement',
    placementClearedWithoutLoad: true,
  }, null);
  const withoutLoadResult = {
    copy: withoutLoad.textContent.includes('مجتازة عبر اختبار المستوى — الكلمات غير محمّلة'),
    noCrown: !withoutLoad.querySelector('.fa-crown'),
  };

  const ready = mount({ ...loaded, status: 'ready' }, {
    derivedState: 'ready', crownEarned: false, gapCount: 0, gapWordKeys: [],
  });
  const readyResult = {
    clearAction: ready.textContent.includes('اختبار اجتياز البوابة'),
    noCrown: !ready.querySelector('.fa-crown'),
  };
  return { gapResult, masteredResult, withoutLoadResult, readyResult };
})()`;

try {
  await retry(async () => {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  });
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) throw new Error(`CDP ${response.status}`);
  });
  const targetResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT', signal: AbortSignal.timeout(2000) }
  );
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }),
    delay(3000).then(() => { throw new Error('WebSocket open timeout'); }),
  ]);
  socket.addEventListener('message', async (event) => {
    let raw = event.data;
    if (typeof raw !== 'string') {
      raw = typeof raw?.text === 'function' ? await raw.text() : Buffer.from(raw).toString('utf8');
    }
    const message = JSON.parse(raw);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await Promise.all([send('Runtime.enable'), send('Page.enable')]);
  await send('Page.navigate', { url: appUrl });
  await retry(async () => {
    const readiness = await send('Runtime.evaluate', {
      expression: "document.readyState === 'complete' && typeof makePublishedGateJourneyPanel === 'function' && Boolean(window.LootLinguaJourney)",
      returnByValue: true,
    });
    if (readiness.result?.value !== true) throw new Error('Gate mastery UI is not ready');
  }, 80, 250);
  const evaluation = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  }
  const result = evaluation.result?.value;
  console.log(JSON.stringify(result, null, 2));
  const passed = Object.values(result || {}).every((group) =>
    Object.values(group || {}).every((value) => value === true)
  );
  if (!passed) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  browser.kill();
  server.kill();
  browser.unref();
  server.unref();
}
