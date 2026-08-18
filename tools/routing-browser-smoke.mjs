import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocketClient from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const browserPath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));
if (!browserPath) throw new Error('Chrome or Edge not found');

const suppliedOrigin = process.env.ROUTING_SMOKE_ORIGIN?.replace(/\/$/, '');
const offset = (process.pid + 241) % 400;
const serverPort = 8900 + offset;
const debugPort = 9900 + offset;
const origin = suppliedOrigin || `http://127.0.0.1:${serverPort}`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-routing-smoke-'));
const server = suppliedOrigin ? null : spawn(process.execPath, [path.join(root, 'tools', 'static-server.mjs'), String(serverPort)], {
  cwd: root,
  stdio: 'ignore',
});
const browser = spawn(browserPath, [
  '--headless=new', '--no-sandbox', '--no-first-run', '--disable-extensions', '--disable-default-apps',
  '--disable-gpu', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`, 'about:blank',
], { cwd: root, stdio: 'ignore' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function retry(operation, attempts = 50) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation(); } catch (error) { lastError = error; await delay(100); }
  }
  throw lastError;
}

let socket;
let nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed');
  return response.result?.value;
}
async function waitForReady(label) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (await evaluate(`document.readyState === 'complete' && Boolean(document.body)`)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function snapshot(id) {
  await waitForReady(id);
  await delay(1200);
  const state = await evaluate(`({
    url: location.href,
    pathname: location.pathname,
    title: document.title,
    appDocument: Boolean(document.getElementById('mainContent')),
    landingDocument: Boolean(document.querySelector('[data-auth-dialog]')),
    routeKind: history.state?.kind || null,
    routeKey: history.state?.key || null,
    currentView: window.currentView || null,
    smartLoadingVisible: (() => {
      const node = document.getElementById('smartLoadingOverlay');
      return Boolean(node && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
    })(),
    entryExperienceVisible: (() => {
      const node = document.getElementById('entryExperienceRoot');
      return Boolean(node && !node.hidden && getComputedStyle(node).display !== 'none');
    })()
  })`);
  if (state.pathname !== '/app/dictionary' && id.includes('dictionary')) {
    throw new Error(`${id}: URL changed to ${state.url}`);
  }
  return { id, ...state };
}
async function navigate(url, id) {
  await send('Page.navigate', { url });
  return snapshot(id);
}

try {
  if (!suppliedOrigin) {
    await retry(async () => {
      const response = await fetch(origin, { signal: AbortSignal.timeout(500) });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
    });
  }
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) throw new Error(`CDP returned ${response.status}`);
  });
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const target = await targetResponse.json();
  socket = new WebSocketClient(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', (data) => {
    const message = JSON.parse(Buffer.from(data).toString('utf8'));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await Promise.all([send('Runtime.enable'), send('Page.enable')]);

  const results = [];
  results.push(await navigate(`${origin}/`, 'root'));
  results.push(await navigate(`${origin}/landing`, 'landing'));
  results.push(await navigate(`${origin}/app`, 'app'));
  results.push(await navigate(`${origin}/app/dictionary`, 'dictionary-direct-new-tab'));
  await send('Page.reload', { ignoreCache: true });
  results.push(await snapshot('dictionary-direct-refresh'));
  await evaluate(`loadWorldsView?.(); loadPersonalDictionary?.()`);
  results.push(await snapshot('dictionary-after-internal-navigation'));
  await send('Page.reload', { ignoreCache: true });
  results.push(await snapshot('dictionary-refresh-after-navigation'));
  await send('Target.closeTarget', { targetId: target.id });

  const reopened = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
  const reopenSocket = new WebSocketClient(reopened.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { reopenSocket.once('open', resolve); reopenSocket.once('error', reject); });
  socket = reopenSocket;
  nextId = 1;
  pending.clear();
  socket.on('message', (data) => {
    const message = JSON.parse(Buffer.from(data).toString('utf8'));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await Promise.all([send('Runtime.enable'), send('Page.enable')]);
  results.push(await navigate(`${origin}/app/dictionary`, 'dictionary-deep-link-after-tab-reopen'));

  const rootResult = results[0];
  const landingResult = results[1];
  const landingTitle = 'LootLingua | تعلّم الإنجليزية من الأشياء اللي تحبها';
  if (rootResult.title !== landingTitle || landingResult.title !== landingTitle) {
    throw new Error(`Landing routing failed: ${JSON.stringify({ rootResult, landingResult })}`);
  }
  const dictionaryResults = results.filter((result) => result.id.includes('dictionary'));
  for (const result of dictionaryResults) {
    if (result.title !== 'LootLingua | قاموس الأساطير' || result.routeKind !== 'view' || result.routeKey !== 'personal') {
      throw new Error(`Dictionary routing failed: ${JSON.stringify(result)}`);
    }
  }
  console.log(JSON.stringify({ origin, results }, null, 2));
} finally {
  socket?.close();
  browser.kill();
  browser.unref();
  server?.kill();
  server?.unref();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
