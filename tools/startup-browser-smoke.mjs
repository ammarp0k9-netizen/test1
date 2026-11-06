import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const browserPath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!browserPath) throw Error('Chrome/Edge not found');
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/app') {
    const scenario = url.searchParams.get('scenario') || 'guest';
    const baseline = url.searchParams.has('baseline');
    let html = read('index.html').replace(/<script\b(?=[^>]*\btype="module")[^>]*>[\s\S]*?<\/script>/g, tag =>
      /src="js\/cloud\.js/.test(tag) ? `<script data-startup-critical type="module" src="/fixture-auth.js?scenario=${scenario}"></script>` : '');
    html = html.replace(/<script\b[^>]*src="https?:[^>]*>[\s\S]*?<\/script>/g, '');
    if (baseline) html = html.replace('<script src="js/startup-recovery.js"></script>', '').replace('<template data-startup-script="js/oasis-preview-animation.js"></template>', '<script src="js/oasis-preview-animation.js" defer></script>');
    html = html.replace('<head>', `<head><script>localStorage.clear();localStorage.setItem('lootlinguaPerformanceMode','turbo');localStorage.setItem('lootlinguaPerformanceModeNoticeSeen','1');window.__fixtureLongTasks=[];new PerformanceObserver(list=>window.__fixtureLongTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({type:'longtask',buffered:true});</script>`);
    html = html.replace('</body>', `<script>const originalComplete=SmartLoadingOverlay.completeStartup;SmartLoadingOverlay.completeStartup=function(){window.__fixtureStartupReadyAt??=performance.now();return originalComplete.call(this)};</script></body>`);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    return;
  }
  if (url.pathname === '/fixture-auth.js') {
    const scenario = url.searchParams.get('scenario');
    if (scenario === 'module-failed') { response.writeHead(503).end('fixture module unavailable'); return; }
    const user = scenario === 'account-dependency-failed' ? { uid: 'fixture-private-account' } : null;
    const body = `window.auth={currentUser:${JSON.stringify(user)}};window.__lootlinguaAuthResolved=true;window.__lootlinguaAuthUser=auth.currentUser;window.__lootlinguaAuthGeneration=1;` +
      (user ? `window.words=[{id:'private-fixture',word:'PrivateAccountWord',meaning:'private'}];window.__lootlinguaInitialDataReady=true;` : `loadGuestDictionaryState({renderView:false});finishInitialFeatureLoad();`) +
      `window.dispatchEvent(new CustomEvent('lootlingua:auth-state',{detail:{user:auth.currentUser}}));` +
      (user ? `const missing=document.createElement('script');missing.type='module';missing.dataset.startupCritical='';missing.src='/missing-entry-dependency.js';document.body.appendChild(missing);` : '');
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(body);
    return;
  }
  const file = path.resolve(root, url.pathname.replace(/^\/+/, ''));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const debugPort = 20000 + process.pid % 3000;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-startup-'));
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-default-apps', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, nextId = 0;
const pending = new Map();
const runtimeExceptions = [];
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 160; attempt++) { if (await evaluate(expression)) return; await delay(200); }
  throw Error('Browser condition timed out: ' + expression);
}
const report = { isolation: 'All Firebase modules replaced or removed; no Firebase credentials/DB access; HTTPS blocked; fresh temporary profile', device: { width: 390, height: 844, cpuSlowdown: 6, latencyMs: 150, downloadBytesPerSecond: 204800 }, cases: [] };
try {
  for (let attempt = 0; ; attempt++) { try { await fetch('http://127.0.0.1:' + debugPort + '/json/version'); break; } catch (error) { if (attempt > 60) throw error; await delay(100); } }
  const target = await (await fetch('http://127.0.0.1:' + debugPort + '/json/new?about:blank', { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.once('open', resolve));
  socket.on('message', data => { const message = JSON.parse(data); if (message.method === 'Runtime.exceptionThrown') runtimeExceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); if (!message.id) return; const call = pending.get(message.id); if (!call) return; pending.delete(message.id); if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://*'] });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 204800, uploadThroughput: 102400 });
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const evidence = path.join(root, 'reports', 'integrity-evidence');
  fs.mkdirSync(evidence, { recursive: true });
  for (const baseline of process.argv.includes('--recovery-only') ? [] : [true, false]) {
    await send('Page.navigate', { url: origin + '/app?scenario=guest' + (baseline ? '&baseline=1' : '') });
    await waitFor('Boolean(window.__fixtureStartupReadyAt)');
    await waitFor(`performance.getEntriesByType('resource').some(entry=>entry.name.includes('oasis-preview-animation.js'))`);
    const result = await evaluate(`(() => { const ready=window.__fixtureStartupReadyAt;const oasis=performance.getEntriesByType('resource').find(entry=>entry.name.includes('oasis-preview-animation.js'));return {readyMs:ready,domContentLoadedMs:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,longTasksBeforeReady:__fixtureLongTasks.filter(entry=>entry.start<ready),oasisStartMs:oasis?.startTime,entryActive:LootLinguaEntryExperienceController.isActive(),entryStep:LootLinguaEntryExperienceController.getState()?.currentStep,authResolved:__lootlinguaAuthResolved,authUser:__lootlinguaAuthUser,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    assert.equal(result.entryActive, true);
    assert.equal(result.authUser, null);
    assert.equal(result.overflow, false);
    if (!baseline) assert.ok(result.oasisStartMs >= result.readyMs, 'cosmetic observer/network is deferred until Entry decides the first screen');
    report.cases.push({ name: baseline ? 'before-cosmetic-deferral' : 'after-cosmetic-deferral', ...result });
    console.log(JSON.stringify({ case: report.cases.at(-1).name, readyMs: result.readyMs, longTasks: result.longTasksBeforeReady.length }));
  }
  for (const scenario of ['module-failed', 'account-dependency-failed']) {
    await send('Page.navigate', { url: origin + '/app?scenario=' + scenario });
    await waitFor('Boolean(document.getElementById("startupRecovery")) && Boolean(window.SmartLoadingOverlay)');
    const result = await evaluate(`({status:LootLinguaStartupRecovery.getStatus(),guestHidden:document.querySelector('[data-startup-guest]').hidden,gate:document.documentElement.classList.contains('startup-pending'),overlay:SmartLoadingOverlay.isVisible(),entryActive:LootLinguaEntryExperienceController.isActive(),authResolved:window.__lootlinguaAuthResolved===true,authUid:window.auth?.currentUser?.uid||null,word:window.words?.[0]?.word||null,retryAvailable:!!document.querySelector('[data-startup-retry]'),overflow:document.documentElement.scrollWidth>innerWidth})`);
    assert.equal(result.guestHidden, true);
    assert.equal(result.gate, true);
    assert.equal(result.overlay, true);
    assert.equal(result.entryActive, false);
    assert.equal(result.retryAvailable, true);
    assert.equal(result.overflow, false);
    if (scenario === 'module-failed') assert.equal(result.authResolved, false);
    else { assert.equal(result.authUid, 'fixture-private-account'); assert.equal(result.word, 'PrivateAccountWord'); }
    assert.equal(await evaluate('LootLinguaStartupRecovery.continueGuest()'), false);
    report.cases.push({ name: scenario, ...result });
    const image = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, 'startup-' + scenario + '.png'), Buffer.from(image.data, 'base64'));
  }
  await send('Page.navigate', { url: origin + '/app?scenario=module-failed' });
  await waitFor('Boolean(document.getElementById("startupRecovery")) && Boolean(window.LootLinguaEntryExperienceController) && Boolean(window.finishInitialFeatureLoad)');
  const continued = await evaluate(`(async()=>{window.auth={currentUser:null};window.__lootlinguaAuthResolved=true;window.__lootlinguaAuthUser=null;window.__lootlinguaInitialDataReady=true;window.dispatchEvent(new CustomEvent('lootlingua:auth-state',{detail:{user:null}}));document.querySelector('[data-startup-guest]').click();await new Promise(resolve=>setTimeout(resolve,500));return {entryActive:LootLinguaEntryExperienceController.isActive(),step:LootLinguaEntryExperienceController.getState()?.currentStep,status:LootLinguaStartupRecovery.getStatus(),auth:auth.currentUser};})()`);
  assert.equal(continued.entryActive, true);
  assert.equal(continued.step, 'welcome');
  assert.equal(continued.status.completed, true);
  assert.equal(continued.auth, null);
  report.cases.push({ name: 'confirmed-local-guest-still-passes-through-entry', ...continued });
  // A real reload retries the failed module; the fixture then returns guest auth.
  await send('Page.navigate', { url: origin + '/app?scenario=module-failed' });
  await waitFor('Boolean(document.getElementById("startupRecovery"))');
  await evaluate(`history.replaceState(null,'','/app?scenario=guest');document.querySelector('[data-startup-retry]').click()`);
  await waitFor('Boolean(window.__fixtureStartupReadyAt)');
  assert.equal(await evaluate('LootLinguaEntryExperienceController.isActive()'), true);
  report.cases.push({ name: 'retry-reloads-and-resumes-entry', passed: true });
  report.runtimeExceptions = runtimeExceptions;
  assert.deepEqual(runtimeExceptions, []);
  const reportName = process.argv.includes('--recovery-only') ? 'startup-recovery-browser.json' : 'startup-browser.json';
  fs.writeFileSync(path.join(evidence, reportName), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.cases.length, evidence }, null, 2));
} finally { socket?.close(); browser.kill(); server.close(); }
