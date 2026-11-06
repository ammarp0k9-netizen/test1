import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const output = path.join(root, 'reports', 'motivation-evidence'); fs.mkdirSync(output, { recursive: true });
const server = http.createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browserPath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!browserPath) throw Error('Chrome/Edge unavailable');
const port = 24000 + process.pid % 1000, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-motivation-'));
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, nextId = 0; const pending = new Map(), errors = [];
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function wait(expression, label) { const until = Date.now() + 5000; while (Date.now() < until) { if (await evaluate(expression)) return; await delay(40); } throw Error('Timed out: ' + label); }
async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64')); }
async function key(name) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: name === 'Tab' ? 9 : 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name }); await delay(50); }
const report = { isolation: 'Real Chrome/controller/policy/notification store/focus manager, isolated in-memory account adapter; no Firebase or production writes', checks: [], layouts: [] };
try {
  for (let retry = 0; ; retry++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch (error) { if (retry > 60) throw error; await delay(100); } }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.once('open', resolve));
  socket.on('message', data => { const message = JSON.parse(data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const call = pending.get(message.id); if (!call) return; pending.delete(message.id); if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result); });
  await send('Page.enable'); await send('Page.bringToFront'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['https://*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }); await delay(150);
  await evaluate(`document.documentElement.setAttribute('data-theme','lootlingua');document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(read('style.css') + '\n' + read('motivation.css') + '\nbody{padding:20px}main{max-width:760px;margin:auto}') }}));
    document.body.innerHTML='<main id="background"><button id="trigger">متابعة التعلّم</button><div data-motivation-goal class="motivation-goal"></div><section id="motivationRewardsPanel"></section></main>';
    window.auth={currentUser:{uid:'alice'}};window.__lootlinguaAuthGeneration=1;window.fixtureXP=80;window.fixtureRevision=0;window.fixtureState={};window.fixtureEntries={};window.fixtureGateKeys=new Set();
    window.fixtureEntry=()=>({mastered_once:true,hasEarnedMasteryXP:true,earnedTransitions:['reviewing_mastered'],quiz_seen_count:3,last_quizzed_at:100});
    window.fixtureFill=count=>{for(let i=0;i<count;i++)fixtureEntries['word_'+i]=fixtureEntry()};fixtureFill(9);
    window.getLootlinguaProfilePayload=()=>({userXP:fixtureXP});window.applyXPDelta=value=>{fixtureXP+=value};window.loadTreasureView=()=>{};
    window.lockBackgroundScroll=()=>{document.documentElement.style.overflow='hidden'};window.unlockBackgroundScroll=()=>{document.documentElement.style.overflow=''};
    ${read('js/motivation-policy.js')}
    ${read('js/notification-store.js')}
    ${read('js/modal-focus.js')}
    LootLinguaNotificationStore.switchOwner('alice');
    window.LootLinguaMotivationCloud={claim:async({gates,expectedUid})=>{if(window.fixtureFail)throw Error('simulated offline');if(window.fixtureHold)await fixtureHold;
      const fresh=(gates||[]).filter(g=>!fixtureGateKeys.has(g.gateId));fresh.forEach(g=>fixtureGateKeys.add(g.gateId));const r=LootLinguaMotivationPolicy.advance(fixtureState,fixtureEntries,fresh);
      const awarded=r.awards.map(a=>({...a,at:Date.now()}));awarded.forEach(a=>r.state.rewards[a.id]=a);fixtureState=r.state;
      return{state:r.state,awarded,userXP:fixtureXP+awarded.reduce((n,a)=>n+a.xp,0),uid:expectedUid,revision:++fixtureRevision}}};
    ${read('js/motivation.js')}
    document.getElementById('trigger').focus();await LootLinguaMotivation.reconcile();`);
  assert.ok(await evaluate(`document.querySelector('[data-motivation-goal]').textContent.includes('9 / 10')`));
  await evaluate(`window.activeQuizSession={id:'verified'};fixtureFill(10);LootLinguaMotivation.queueTitles([{id:'mastery_circle',name:'تاج الإتقان',how:'أتقن 10 كلمات'}]);await LootLinguaMotivation.reconcile()`);
  await delay(1050); assert.equal(await evaluate(`!!document.getElementById('motivationCelebration')`), false, 'never interrupt an active quiz');
  await evaluate(`activeQuizSession=null`); await wait(`!!document.getElementById('motivationCelebration')`, 'combined celebration');
  assert.equal(await evaluate('fixtureXP'), 100); assert.equal(await evaluate(`document.querySelectorAll('#motivationCelebration').length`), 1);
  assert.ok(await evaluate(`document.getElementById('motivationCelebration').textContent.includes('تاج الإتقان')&&document.getElementById('motivationCelebration').textContent.includes('+20 XP')`));
  for (let index = 0; index < 6; index++) { await key('Tab'); assert.ok(await evaluate(`document.getElementById('motivationCelebration').contains(document.activeElement)`)); }
  await screenshot('desktop-celebration'); await key('Escape'); await wait(`!document.getElementById('motivationCelebration')`, 'Escape closes');
  assert.equal(await evaluate(`document.activeElement.id`), 'trigger');
  await evaluate(`await LootLinguaMotivation.reconcile()`); assert.equal(await evaluate('fixtureXP'), 100);
  assert.equal(await evaluate(`LootLinguaNotificationStore.getAll().filter(n=>n.notificationType==='achievement.motivation').length`), 1);
  report.checks.push('confirmed bonus, one combined title/reward dialog after quiz, focus trap/restore, permanent notification, no repeated bonus');
  for (const [theme, width] of [['lootlingua', 1100], ['golden', 390], ['ocean', 320], ['scroll', 320]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate(`document.documentElement.setAttribute('data-theme','${theme}');LootLinguaMotivation.render()`);
    const layout = await evaluate(`(()=>{const goal=document.querySelector('[data-motivation-goal]'),style=getComputedStyle(goal);const luminance=rgb=>{const values=rgb.match(/[\\d.]+/g).slice(0,3).map(n=>{n=Number(n)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return values[0]*.2126+values[1]*.7152+values[2]*.0722};const a=luminance(style.color),b=luminance(style.backgroundColor);return{theme:'${theme}',width:${width},overflow:document.documentElement.scrollWidth>innerWidth,goal:goal.getBoundingClientRect().width,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}})()`);
    assert.ok(layout.contrast >= 4.5, JSON.stringify(layout));
    assert.equal(layout.overflow, false); report.layouts.push(layout);
    if (theme === 'ocean') await screenshot('mobile-goal-history');
  }
  await evaluate(`fixtureFill(25);await LootLinguaMotivation.reconcile()`); await wait(`!!document.getElementById('motivationCelebration')`, 'next mastery milestone');
  assert.equal(await evaluate('fixtureXP'), 135); await screenshot('mobile-celebration'); await key('Escape');
  await evaluate(`LootLinguaMotivation.observeGates({worldId:'world',title:'عالم المغامرة'},{rankId:'rank'},[1,2,3].map(n=>({rankId:'rank',gateId:'gate'+n,clearedBy:'gate-clear',lastClearResult:'passed',status:'cleared'})));await LootLinguaMotivation.reconcile()`);
  await wait(`fixtureXP===160`, 'three-gate station bonus'); await wait(`!!document.getElementById('motivationCelebration')`, 'station celebration'); await key('Escape');
  await evaluate(`window.fixtureFail=true;await LootLinguaMotivation.reconcile()`);
  assert.ok(await evaluate(`!!document.querySelector('.motivation-sync-error')`)); assert.equal(await evaluate('fixtureXP'), 160);
  await evaluate(`fixtureFail=false;await LootLinguaMotivation.reconcile()`); assert.equal(await evaluate('fixtureXP'), 160);
  report.checks.push('all four themes and small phones fit; second mastery bonus, station bonus, offline recovery without false XP');
  await evaluate(`fixtureFill(50);window.fixtureHold=new Promise(resolve=>window.fixtureRelease=resolve);window.fixturePending=LootLinguaMotivation.reconcile();`);
  await evaluate(`auth.currentUser={uid:'bob'};window.__lootlinguaAuthGeneration++;fixtureXP=0;window.dispatchEvent(new CustomEvent('lootlingua:auth-state'));fixtureRelease();await fixturePending;fixtureHold=null`);
  assert.equal(await evaluate('fixtureXP'), 0); assert.equal(await evaluate(`LootLinguaMotivation.getState().masteredKeys.length`), 0);
  report.checks.push('account switch discards an in-flight result and clears pending celebrations');
  report.runtimeExceptions = errors; assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'browser-smoke.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { socket?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
