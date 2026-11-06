import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const core = read('js/core.js'), dictionary = read('js/dictionary.js'), script = read('js/script.js');
const profileCode = core.slice(core.indexOf('window.toggleProfileModal ='), core.indexOf('const backgroundScrollLocks'));
const statsCode = dictionary.slice(dictionary.indexOf('let statsPanelRequest'), dictionary.indexOf('function renderHeatmap'));
const routeCode = script.slice(script.indexOf('function closeRouteOverlays()'), script.indexOf('function openRouteOverlay'));
const browserPath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!browserPath) throw Error('Chrome/Edge not found');
const port = 19500 + process.pid % 2000;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-modal-focus-'));
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, nextId = 0;
const pending = new Map(), errors = [];
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function waitForDOM(expression, name) {
  const deadline = Date.now() + 3000;
  do {
    if (await evaluate(expression)) return;
    await delay(20);
  } while (Date.now() < deadline);
  const diagnostics = await evaluate(`({active:document.activeElement?.outerHTML?.slice(0,300),
    layers:[...document.querySelectorAll('[role="dialog"]')].map(node=>({id:node.id,class:node.className,hidden:node.getAttribute('aria-hidden'),display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,zIndex:getComputedStyle(node).zIndex,rects:node.getClientRects().length,inert:node.inert}))})`);
  assert.fail(name + ': ' + JSON.stringify({ diagnostics, errors }, null, 2));
}
async function key(name, shift = false) {
  const code = name === 'Tab' ? 9 : 27;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
  await delay(60);
}
const report = { isolation: 'Real Chrome DOM/keyboard; cloud, render and routing adapters in memory; all network blocked', checks: [] };
try {
  for (let attempt = 0; ; attempt++) {
    try { await fetch('http://127.0.0.1:' + port + '/json/version'); break; }
    catch (error) { if (attempt > 60) throw error; await delay(100); }
  }
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.once('open', resolve));
  socket.on('message', data => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const call = pending.get(message.id); if (!call) return;
    pending.delete(message.id); if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result);
  });
  await send('Page.enable'); await send('Page.bringToFront'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 850, deviceScaleFactor: 1, mobile: false });
  const frameId = (await send('Page.getFrameTree')).frameTree.frame.id;
  await send('Page.setDocumentContent', { frameId, html: '<!doctype html><html lang="ar" dir="rtl" data-theme="lootlingua"><head><meta charset="utf-8"></head><body></body></html>' });
  await evaluate(`document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(read('style.css'))}}));
    const parsed = new DOMParser().parseFromString(${JSON.stringify(read('index.html'))},'text/html');
    document.body.innerHTML='<main id="background"><button id="trigger">الملف الشخصي</button><button id="backgroundSecond">خلفية</button></main><div id="alreadyInert" inert><button>معزول مسبقًا</button></div>' +
      ['profileModal','statsPanel','appAuthDialogShell','customWorldModal'].map(id=>parsed.getElementById(id).outerHTML).join('');
    window.auth={currentUser:null}; window.__lootlinguaAuthGeneration=1;
    window.closeRouteEntry=(_kind,_key,callback)=>callback(); window.setAppRoute=()=>{};
    for (const name of ['lockBackgroundScroll','unlockBackgroundScroll','syncHeroAvatar','renderProfileModalStats','renderXPBar','refreshFeatureUnlockUI','closeSidebarIfOpen','renderHeatmap','renderStatsNumbers'])window[name]=()=>{};
    ${read('js/modal-focus.js')}
    ${profileCode}
    ${statsCode}
    ${routeCode}
    window.fixtureFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    document.getElementById('trigger').focus();toggleProfileModal();`);
  await waitForDOM(`document.getElementById('profileModal').contains(document.activeElement)&&document.getElementById('background').inert`, 'profile focus and isolation');
  const initial = await evaluate(`({inside:document.getElementById('profileModal').contains(document.activeElement),backgroundInert:document.getElementById('background').inert,preexisting:document.getElementById('alreadyInert').inert})`);
  const initialDiagnostics = await evaluate(`({active:document.activeElement?.outerHTML?.slice(0,300),manager:!!window.LootLinguaModalFocus,
    layers:[...document.querySelectorAll('[role="dialog"]')].map(node=>({id:node.id,class:node.className,hidden:node.getAttribute('aria-hidden'),display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,zIndex:getComputedStyle(node).zIndex,rects:node.getClientRects().length,inert:node.inert})),profileClass:document.getElementById('profileModal').className})`);
  assert.ok(initial.inside && initial.backgroundInert && initial.preexisting, JSON.stringify({initial,initialDiagnostics},null,2)); report.checks.push({ name: 'profile focuses inside and isolates background', ...initial });
  await evaluate(`const buttons=[...document.querySelectorAll('#profileModal button')].filter(b=>b.getClientRects().length&&!b.closest('[hidden],[inert]')&&!b.disabled);window.fixtureLastButton=buttons.at(-1);fixtureLastButton.focus();`);
  await key('Tab'); assert.equal(await evaluate(`document.activeElement.classList.contains('profile-modal-close')`), true);
  await key('Tab', true); assert.equal(await evaluate(`document.activeElement===fixtureLastButton`), true);
  await evaluate(`document.querySelector('#profileModal .profile-modal-sheet').focus()`);
  await key('Tab', true); assert.equal(await evaluate(`document.activeElement===fixtureLastButton`), true);
  await key('Tab'); assert.equal(await evaluate(`document.activeElement.classList.contains('profile-modal-close')`), true);
  report.checks.push({ name: 'Tab and Shift+Tab wrap within visible profile controls', passed: true });
  await evaluate(`openStatsPanel()`);
  await waitForDOM(`document.getElementById('statsPanel').contains(document.activeElement)&&document.getElementById('profileModal').inert`, 'nested stats focus');
  assert.equal(await evaluate(`document.getElementById('statsPanel').contains(document.activeElement)&&document.getElementById('profileModal').inert`), true);
  await key('Escape');
  await waitForDOM(`document.getElementById('statsPanel').getAttribute('aria-hidden')==='true'&&document.getElementById('profileModal').contains(document.activeElement)&&!document.getElementById('profileModal').inert`, 'profile focus returns after stats');
  assert.equal(await evaluate(`document.getElementById('statsPanel').getAttribute('aria-hidden')==='true'&&document.getElementById('profileModal').contains(document.activeElement)&&!document.getElementById('profileModal').inert`), true);
  report.checks.push({ name: 'nested statistics closes alone and restores profile focus', passed: true });
  await evaluate(`document.getElementById('appAuthDialogShell').hidden=false;`);
  await waitForDOM(`!document.getElementById('appAuthDialogShell').inert&&document.getElementById('profileModal').inert&&document.getElementById('appAuthDialogShell').contains(document.activeElement)`, 'auth suspends profile');
  const authLayer = await evaluate(`({authInert:document.getElementById('appAuthDialogShell').inert,profileInert:document.getElementById('profileModal').inert,inside:document.getElementById('appAuthDialogShell').contains(document.activeElement),active:document.activeElement.outerHTML.slice(0,300),authVisibility:getComputedStyle(document.querySelector('.app-auth-dialog')).visibility,authRects:document.querySelector('.app-auth-dialog').getClientRects().length})`);
  assert.ok(!authLayer.authInert && authLayer.profileInert && authLayer.inside, JSON.stringify({authLayer,errors},null,2));
  await key('Escape');
  assert.equal(await evaluate(`document.getElementById('profileModal').classList.contains('open')`), true);
  await evaluate(`document.getElementById('appAuthDialogShell').hidden=true;`);
  await waitForDOM(`document.getElementById('profileModal').contains(document.activeElement)&&!document.getElementById('profileModal').inert`, 'profile focus returns after auth');
  assert.equal(await evaluate(`document.getElementById('profileModal').contains(document.activeElement)&&!document.getElementById('profileModal').inert`), true);
  await evaluate(`document.getElementById('customWorldModal').style.display='flex';`);
  await waitForDOM(`!document.getElementById('customWorldModal').inert&&document.getElementById('profileModal').inert&&document.getElementById('customWorldModal').contains(document.activeElement)`, 'custom modal suspends profile');
  await key('Escape');
  assert.equal(await evaluate(`document.getElementById('profileModal').classList.contains('open')`), true);
  await evaluate(`document.getElementById('customWorldModal').style.display='none';`);
  await waitForDOM(`document.getElementById('profileModal').contains(document.activeElement)&&!document.getElementById('profileModal').inert`, 'profile focus returns after custom modal');
  report.checks.push({ name: 'existing auth and custom layers suspend the underlying focus trap', passed: true });
  await key('Escape'); await delay(100);
  assert.equal(await evaluate(`document.activeElement.id==='trigger'&&!document.getElementById('background').inert&&document.getElementById('alreadyInert').inert`), true);
  report.checks.push({ name: 'closing restores the trigger and preserves pre-existing isolation', passed: true });
  await evaluate(`toggleProfileModal(); await fixtureFrame(); await openStatsPanel(); closeStatsPanel(); await openStatsPanel();`); await delay(350);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('statsPanel')).display!=='none'`), true);
  await evaluate(`closeRouteOverlays();`); await delay(100);
  assert.equal(await evaluate(`!document.getElementById('background').inert&&getComputedStyle(document.getElementById('statsPanel')).display==='none'&&!document.getElementById('profileModal').classList.contains('open')`), true);
  report.checks.push({ name: 'rapid reopen cancels the old hide timer; route cleanup releases isolation', passed: true });
  await evaluate(`(async()=>{let resolve;window.LootLinguaDictionaryPages={requireComplete:()=>new Promise(done=>{resolve=done})};const pendingOpen=openStatsPanel();closeRouteOverlays();resolve(true);await pendingOpen;})()`);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('statsPanel')).display==='none'&&!document.getElementById('background').inert`), true);
  report.checks.push({ name: 'route cleanup cancels a pending statistics request in the same account', passed: true });
  await evaluate(`let resolve;window.LootLinguaDictionaryPages={requireComplete:()=>new Promise(done=>{resolve=done})};const pendingOpen=openStatsPanel();window.auth.currentUser={uid:'other'};window.__lootlinguaAuthGeneration++;resolve(true);await pendingOpen;`);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('statsPanel')).display==='none'&&!document.getElementById('background').inert`), true);
  report.checks.push({ name: 'a deferred statistics request cannot reopen for another account', passed: true });
  assert.deepEqual(errors, []); report.runtimeExceptions = errors;
  const dir = path.join(root, 'reports', 'stage-two-evidence'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'modal-focus.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close(); browser.kill();
  // Chrome owns only the temporary test profile; the application data is untouched.
}
