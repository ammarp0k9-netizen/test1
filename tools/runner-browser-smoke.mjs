import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const output = process.env.RUNNER_SMOKE_OUTPUT || path.join(root, 'reports', 'runner-evidence');
fs.mkdirSync(output, { recursive: true });
const locks = read('js/core.js');
const lockCode = locks.slice(locks.indexOf('const backgroundScrollLocks'), locks.indexOf('function syncHeroAvatar()'));
const runtime = read('js/core-runtime.js');
const shortcuts = runtime.slice(runtime.indexOf("document.addEventListener('keydown', function(e)"), runtime.indexOf('// Init'));
const requests = [];
const html = `<!doctype html><html lang="ar" dir="rtl" data-theme="lootlingua"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;padding:24px;background:#09121c}main{height:1500px}main button{padding:12px;margin:8px}</style></head><body><main class="main-content" id="fixtureBackground"><button id="trigger">اللعب</button><button id="addBtn">إضافة كلمة خلف اللعبة</button></main><script>
window.auth={currentUser:{uid:'runner-A'}};window.__lootlinguaAuthGeneration=1;
window.fixtureWords=[{word:'lantern',meaning:'فانوس'},{word:'bridge',meaning:'جسر'},{word:'river',meaning:'نهر'},{word:'treasure',meaning:'كنز'}];
window.fixtureIntents=[];window.fixtureToasts=[];window.fixtureAdds=0;window.fixtureReceipts=new Set();
window.fixtureSpeech=[];Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{lang:'en-US'}],speak:u=>fixtureSpeech.push({text:u.text,lang:u.lang}),cancel:()=>{}}});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};
window.commitProfileIntent=async intent=>{fixtureIntents.push({uid:auth.currentUser?.uid,intent:structuredClone(intent)});if(!fixtureReceipts.has(intent.eventId)){fixtureReceipts.add(intent.eventId);if(intent.type==='wallet-delta')localStorage.setItem('lootlingua.runner.coins.v1',String(Number(localStorage.getItem('lootlingua.runner.coins.v1')||0)+intent.amount));}return{saved:true,applied:true}};
window.queueProfileIntent=intent=>{fixtureIntents.push({uid:auth.currentUser?.uid,intent:structuredClone(intent)});return'fixture-max'};
window._saveProfileToCloudNow=async()=>true;
window.showToast=(...args)=>fixtureToasts.push(args);
window.LootLinguaPublishedContent={listAllPublishedGateWords:async()=>{if(window.fixtureWordsGate)await window.fixtureWordsGate;if(window.fixtureRejectWords)throw Error('simulated offline');return structuredClone(fixtureWords)}};
window.fixtureContext={worldId:'world',rankId:'rank',gateId:'gate',progress:{readinessNextAt:0}};
document.getElementById('addBtn').addEventListener('click',()=>fixtureAdds++);
var currentView='personal';
${lockCode}
${shortcuts}
</script><script src="/js/modal-focus.js"></script><script src="/js/gate-runner.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  requests.push(pathname);
  if (pathname === '/fixture') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return; }
  const target = path.resolve(root, pathname.replace(/^\/+/, ''));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': target.endsWith('.css') ? 'text/css' : /\.m?js$/.test(target) ? 'text/javascript' : 'application/octet-stream' });
  res.end(fs.readFileSync(target));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browserPath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!browserPath) throw Error('Chrome/Edge not found');
const debugPort = 23000 + process.pid % 1500;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-runner-'));
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
let socket, nextId = 0;
const pending = new Map(), exceptions = [], caughtExceptions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true, userGesture: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result?.value;
}
async function wait(expression, name, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await evaluate(expression)) return; await delay(35); }
  throw Error(name + ': ' + JSON.stringify(await evaluate(`({diagnostics:window.LootLinguaGateRunner?.getDiagnostics(),active:document.activeElement?.outerHTML?.slice(0,120),toasts:window.fixtureToasts,exceptions:${JSON.stringify(exceptions)}})`)));
}
async function key(name) {
  const codes = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, ' ': 32, p: 80, Enter: 13, Escape: 27 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name === ' ' ? 'Space' : name === 'p' ? 'KeyP' : name, windowsVirtualKeyCode: codes[name] });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, windowsVirtualKeyCode: codes[name] });
  await delay(35);
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64'));
}
async function swipe(dx, dy) {
  const box = await evaluate(`(()=>{const r=document.querySelector('.llr-viewport').getBoundingClientRect();return{x:r.left+r.width*.5,y:r.top+r.height*.65}})()`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, id: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + dx, y: box.y + dy, id: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(45);
}
const report = { isolation: 'Real Chrome and real lazy controller/engine/renderer/CSS; deterministic local published words, profile adapters and synthetic speech recorder; external HTTPS blocked', viewports: [], checks: [] };
try {
  for (let attempt = 0; ; attempt++) {
    try { await fetch('http://127.0.0.1:' + debugPort + '/json/version'); break; }
    catch (error) { if (attempt > 60) throw error; await delay(100); }
  }
  const target = await (await fetch('http://127.0.0.1:' + debugPort + '/json/new?about:blank', { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.once('open', resolve));
  socket.on('message', data => {
    const message = JSON.parse(data);
    if (message.method === 'Debugger.paused') {
      caughtExceptions.push(message.params.data?.description || message.params.reason);
      void send('Debugger.resume');
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const call = pending.get(message.id); if (!call) return;
    pending.delete(message.id); if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result);
  });
  await send('Page.enable'); await send('Page.bringToFront'); await send('Runtime.enable'); await send('Network.enable');
  await send('Debugger.enable'); await send('Debugger.setPauseOnExceptions', { state: 'all' });
  await send('Network.setBlockedURLs', { urls: ['https://*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin + '/fixture' }); await wait('!!window.LootLinguaGateRunner', 'fixture load');
  assert.equal(requests.some(item => /runner-engine|runner-renderer|runner\.css/.test(item)), false, 'expensive Runner resources must remain lazy');
  // Preload the actual engine only to supply its supported deterministic RNG;
  // the controller still loads renderer/CSS through its production loader.
  await evaluate(`await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='js/runner-engine.js';s.onload=resolve;s.onerror=reject;document.head.append(s)});window.fixtureEngine=LootLinguaRunnerEngine;window.LootLinguaRunnerEngine=Object.freeze({...fixtureEngine,createState:(words,options)=>{const s=fixtureEngine.createState(words,{...options,random:()=>.5});if(words?.length)window.fixtureLiveState=s;return s}});`);
  await evaluate(`document.documentElement.dataset.theme='glass';document.body.classList.add('perf-turbo','low-end-device');
    document.getElementById('trigger').focus();
    await LootLinguaGateRunner.launch(fixtureContext);`);
  assert.ok(await evaluate(`document.body.classList.contains('runner-input-active') &&
    getComputedStyle(document.getElementById('fixtureBackground')).visibility === 'hidden' &&
    getComputedStyle(document.querySelector('.llr-primary')).transitionDuration !== '1e-06s'`));
  await evaluate(`document.querySelector('.llr-screen .llr-primary').click()`);
  await wait('LootLinguaGateRunner.getDiagnostics()?.distance > 0', 'Runner playing in Turbo');
  await key('Escape');
  assert.ok(await evaluate(`!document.body.classList.contains('runner-input-active') &&
    getComputedStyle(document.getElementById('fixtureBackground')).visibility === 'visible' &&
    document.activeElement.id === 'trigger'`));
  await evaluate(`await new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/loot-bots.css';link.onload=resolve;link.onerror=reject;document.head.append(link)});
    const {openBattle}=await import('/js/loot-bots-game.mjs');
    openBattle({words:fixtureWords,source:'اختبار',isCurrent:()=>true,returnFocus:document.getElementById('trigger')});`);
  assert.ok(await evaluate(`document.querySelector('.loot-bots')?.open &&
    getComputedStyle(document.getElementById('fixtureBackground')).visibility === 'hidden' &&
    getComputedStyle(document.querySelector('.loot-bots [data-play]')).backgroundColor === 'rgb(154, 242, 220)'`));
  await evaluate(`document.querySelector('.loot-bots [data-play]').click()`);
  await wait(`document.querySelector('.loot-bots .lb-arena').classList.contains('is-fighting')`, 'Loot Bots playing in Turbo');
  await evaluate(`document.querySelector('.loot-bots [data-close]').click()`);
  assert.ok(await evaluate(`!document.querySelector('.loot-bots') && document.body.classList.contains('perf-turbo') &&
    getComputedStyle(document.getElementById('fixtureBackground')).visibility === 'visible'`));
  await evaluate(`document.documentElement.dataset.theme='lootlingua';document.body.classList.remove('perf-turbo','low-end-device')`);
  report.checks.push({name:'Runner and Loot Bots own their styles under Glass/Turbo, stop background painting, and restore the page on exit',passed:true});
  for (const width of [1280, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width === 1280 ? 900 : 844, deviceScaleFactor: width < 600 ? 3 : 1, mobile: width < 600 });
    await send('Emulation.setTouchEmulationEnabled', { enabled: width < 600 });
    assert.equal(await evaluate('innerWidth'), width, 'the responsive test must use the requested CSS viewport');
    await evaluate(`fixtureContext.progress={readinessNextAt:0};document.getElementById('trigger').focus();await LootLinguaGateRunner.launch(fixtureContext);`);
    await wait(`!!document.querySelector('.llr-screen .llr-primary')`, 'intro');
    const intro = await evaluate(`({title:document.querySelector('.llr-screen h2').textContent,inside:document.querySelector('.llr-game').contains(document.activeElement),locked:document.documentElement.classList.contains('modal-scroll-locked'),inert:document.getElementById('fixtureBackground').inert,dom:document.querySelector('.llr-overlay').querySelectorAll('*').length})`);
    assert.ok(intro.inside && intro.locked && intro.inert);
    await evaluate(`window.fixtureNotes=0;const NativeAudio=window.AudioContext;if(NativeAudio&&!window.fixtureAudioInstrumented){window.fixtureAudioInstrumented=true;const original=NativeAudio.prototype.createOscillator;NativeAudio.prototype.createOscillator=function(...args){window.fixtureNotes++;return original.apply(this,args)}}document.querySelector('.llr-screen .llr-primary').click()`);
    await wait(`LootLinguaGateRunner.getDiagnostics()?.distance>0`, 'running');
    await key('Enter'); assert.equal(await evaluate('fixtureAdds'), 0, 'Enter must not submit the background dictionary');
    if (width === 1280) {
      await key('ArrowLeft'); assert.equal((await evaluate('LootLinguaGateRunner.getDiagnostics()')).lane, 0);
      await key('ArrowRight'); assert.equal((await evaluate('LootLinguaGateRunner.getDiagnostics()')).lane, 1);
      await key(' '); assert.equal((await evaluate('LootLinguaGateRunner.getDiagnostics()')).action, 'jump');
      await wait(`LootLinguaGateRunner.getDiagnostics().action==='run'`, 'jump landing'); await key('ArrowDown'); await wait(`LootLinguaGateRunner.getDiagnostics().action==='slide'`, 'slide starts after recovery');
    } else {
      await swipe(90, 0); assert.equal((await evaluate('LootLinguaGateRunner.getDiagnostics()')).lane, 2);
      await swipe(-180, 0); assert.equal((await evaluate('LootLinguaGateRunner.getDiagnostics()')).lane, 1, 'a swipe changes only one lane');
      await swipe(0, -80); assert.equal((await evaluate('LootLinguaGateRunner.getDiagnostics()')).action, 'jump');
      await wait(`LootLinguaGateRunner.getDiagnostics().action==='run'`, 'jump landing'); await swipe(0, 80); await wait(`LootLinguaGateRunner.getDiagnostics().action==='slide'`, 'slide starts after recovery');
    }
    await key('p'); const beforePause = await evaluate('LootLinguaGateRunner.getDiagnostics()'); await delay(170);
    const afterPause = await evaluate('LootLinguaGateRunner.getDiagnostics()'); assert.equal(afterPause.distance, beforePause.distance); assert.equal(afterPause.paused, true);
    await key('p'); await wait('LootLinguaGateRunner.getDiagnostics().distance>' + afterPause.distance, 'resume');
    if (width === 1280) {
      assert.equal(await evaluate('fixtureNotes'), 0, 'movement and jumping alone must not chime');
      await wait('fixtureNotes>0', 'the farther spawned coins reach the runner', 12000); await screenshot('desktop-running');
      assert.ok(await evaluate('fixtureNotes>0'), 'collected coins create the chime');
      const notes = await evaluate(`document.querySelector('.llr-sound').click();window.fixtureNotes`);
      assert.equal(await evaluate(`document.querySelector('.llr-sound').getAttribute('aria-pressed')`), 'false');
      await delay(240); assert.equal(await evaluate('fixtureNotes'), notes, 'muting stops new notes');
    } else assert.equal(await evaluate(`document.querySelector('.llr-sound').getAttribute('aria-pressed')`), 'false', 'mute preference survives reopening');
    if (width === 1280) {
      const expected = await evaluate(`(()=>{const s=fixtureLiveState,g=s._pool.pop();Object.assign(g,fixtureEngine.createWordGate(s),{id:s._nextId++,active:true,bornAt:s.elapsed});s.entities.push(g);s.gate=g;return g.word})()`);
      await wait('fixtureSpeech.length===1', 'automatic question narration with sound effects muted');
      assert.equal((await evaluate('fixtureSpeech[0]')).text, expected);
    }
    await evaluate(`document.querySelector('.llr-settings-button').click()`);
    await wait(`document.querySelector('.llr-settings').contains(document.activeElement)`, 'settings focus');
    assert.equal(await evaluate(`document.querySelectorAll('.llr-settings-group').length`), 3);
    assert.equal(await evaluate(`document.querySelector('.llr-speech-toggle').getAttribute('aria-pressed')`), width === 1280 ? 'true' : 'false');
    if (width === 1280) await evaluate(`document.querySelector('.llr-speech-toggle').click()`);
    assert.equal(await evaluate(`document.querySelector('.llr-hints-toggle').getAttribute('aria-pressed')`), width === 1280 ? 'true' : 'false', 'obstacle hint preference persists across runs');
    if (width === 1280) {
      await evaluate(`document.querySelector('.llr-hints-toggle').click()`);
      assert.equal(await evaluate(`localStorage.getItem('lootlingua.runner.hints.v1')`), 'off');
    }
    const settingsDistance = (await evaluate('LootLinguaGateRunner.getDiagnostics()')).distance;
    const stableWallet = await evaluate(`(()=>{const el=document.querySelectorAll('.llr-hud span')[1],old=el.textContent,a=el.getBoundingClientRect();el.textContent='99999 عملة';const b=el.getBoundingClientRect();el.textContent=old;return a.x===b.x&&a.width===b.width})()`);
    assert.equal(stableWallet, true, 'the coin HUD stays fixed when the digit count changes');
    await delay(300);
    assert.equal((await evaluate('LootLinguaGateRunner.getDiagnostics()')).distance, settingsDistance, 'the live run pauses behind the demonstration');
    assert.equal(await evaluate(`(()=>{const p=document.querySelector('.llr-settings'),r=p.getBoundingClientRect();return document.elementFromPoint(r.left+10,r.top+10)?.closest('.llr-settings')===p&&document.querySelector('.llr-viewport').inert&&document.documentElement.scrollWidth<=innerWidth})()`), true);
    await evaluate(`document.querySelector('.llr-recovery').click()`);
    assert.equal(await evaluate(`localStorage.getItem('lootlingua.runner.recovery.v1')`), 'off');
    assert.ok(await evaluate(`document.querySelector('.llr-recovery-description').textContent.includes('المساعدة متوقفة')&&document.querySelector('.llr-recovery-demo strong').textContent.includes('دون مساعدة')`));
    assert.equal(await evaluate(`document.querySelectorAll('.llr-recovery-demo button').length`), 1, 'only play/pause remains, without previous/next controls');
    if (width === 1280) {
      const firstTitle = await evaluate(`document.querySelector('.llr-recovery-demo strong').textContent`);
      await wait(`document.querySelector('.llr-recovery-demo strong').textContent!==${JSON.stringify(firstTitle)}`, 'automatic scenario progression', 6500);
      await screenshot('recovery-off');
    }
    await evaluate(`document.querySelector('.llr-recovery').click()`);
    await screenshot(`recovery-help-${width}`);
    await key('Escape');
    await wait(`document.querySelector('.llr-settings').hidden&&!LootLinguaGateRunner.getDiagnostics().paused`, 'closing settings resumes the run');
    if (width === 1280) {
      await evaluate(`fixtureLiveState.gate.id=fixtureLiveState._nextId++;fixtureLiveState.gate.word='lantern'`);
      await delay(150); assert.equal(await evaluate('fixtureSpeech.length'), 1, 'disabled narration does not read a new question');
    }
    const state = await evaluate(`(()=>{const canvas=document.querySelector('.llr-canvas'),viewport=document.querySelector('.llr-viewport').getBoundingClientRect(),box=document.querySelector('.llr-game').getBoundingClientRect(),d=LootLinguaGateRunner.getDiagnostics();return{...d,viewportWidth:innerWidth,dpr:canvas.width/Math.round(viewport.width),backingPerCssPixel:canvas.width/canvas.clientWidth,dom:document.querySelector('.llr-overlay').querySelectorAll('*').length,overflow:document.documentElement.scrollWidth>innerWidth,insideViewport:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight}})()`);
    assert.ok(state.dpr <= 1.51 && state.entities <= 48 && state.dom <= intro.dom + 1 && !state.overflow && state.insideViewport, JSON.stringify(state));
    await key('Escape'); await wait('!document.querySelector(".llr-overlay")', 'exit cleanup');
    assert.equal(await evaluate(`!window.__lootlinguaRunnerInputActive&&!document.documentElement.classList.contains('modal-scroll-locked')&&!document.getElementById('fixtureBackground').inert&&document.activeElement.id==='trigger'`), true);
    report.viewports.push({ width, intro, measured: state });
  }
  const credits = await evaluate(`fixtureIntents.filter(row=>row.intent.type==='wallet-delta')`);
  assert.equal(credits.length, 1, 'the collected desktop coins must be credited once despite cleanup'); assert.ok(credits[0].intent.amount > 0);
  report.checks.push({ name: 'wallet award once per run, no XP or SRS intent', credits });
  await evaluate(`await LootLinguaGateRunner.launch(fixtureContext);document.querySelector('.llr-screen .llr-primary').click();auth.currentUser={uid:'runner-B'};window.__lootlinguaAuthGeneration++;`);
  await wait('LootLinguaGateRunner.getDiagnostics()===null', 'account switch closes run');
  assert.equal((await evaluate(`fixtureIntents.filter(row=>row.uid==='runner-B'&&row.intent.type==='wallet-delta').length`)), 0);
  await evaluate(`fixtureContext.progress={availableForReviewNowCount:1};window.fixtureDueResult=await LootLinguaGateRunner.launch(fixtureContext)`);
  assert.equal(await evaluate('fixtureDueResult'), false);
  await evaluate(`fixtureContext.progress={readinessNextAt:0};window.fixtureRejectWords=true;window.fixtureOfflineResult=await LootLinguaGateRunner.launch(fixtureContext);window.fixtureRejectWords=false;`);
  assert.equal(await evaluate('fixtureOfflineResult'), false); assert.equal(await evaluate(`!!document.querySelector('.llr-overlay')`), false);
  await evaluate(`let release;window.fixtureWordsGate=new Promise(resolve=>{release=resolve});window.fixtureLaunch=LootLinguaGateRunner.launch(fixtureContext);await new Promise(r=>setTimeout(r,30));fixtureContext.progress.availableForReviewNowCount=1;release();await fixtureLaunch;window.fixtureWordsGate=null;`);
  assert.equal(await evaluate(`!!document.querySelector('.llr-overlay')`), false);
  await evaluate(`fixtureContext.progress={readinessNextAt:0};await LootLinguaGateRunner.launch(fixtureContext);document.querySelector('.llr-screen .llr-primary').click();fixtureContext.progress.availableForReviewNowCount=1;`);
  await wait(`document.querySelector('.llr-screen h2')?.textContent.includes('الاختبار الموثوق')`, 'review becomes due'); await key('Escape');
  report.checks.push({ name: 'account switching, word-load failure and review due before/during launch are guarded', passed: true });
  await evaluate(`fixtureContext.progress={readinessNextAt:0};window.fixtureCanvas=document.createElement('canvas');fixtureCanvas.style.cssText='width:360px;height:520px';document.body.append(fixtureCanvas);window.fixtureRenderer=LootLinguaRunnerRenderer.createRenderer(fixtureCanvas);fixtureRenderer.resize(360,520);`);
  report.pool = await evaluate(`(()=>{const E=fixtureEngine,s=E.createState(fixtureWords,{random:()=>.5});let max=0,events=0,metrics,dom=document.querySelectorAll('*').length;const started=performance.now();for(let frame=0;frame<2400;frame++){if(s.gate&&!s.gate.resolved){E.move(s,s.gate.correctLane)}else{const ahead=s.entities.filter(e=>e.kind==='obstacle'&&!e.resolved&&e.z>0).sort((a,b)=>a.z-b.z);if(ahead.length){const row=ahead.filter(e=>e.row===ahead[0].row);const open=[0,1,2].find(lane=>!row.some(e=>e.lane===lane));const route=open===undefined?row.find(e=>['low','overhead','duckwall'].includes(e.obstacleType))||row.find(e=>e.obstacleType==='train'):null;E.move(s,open===undefined?route.lane:open);if(route&&route.z/s.speed<.18){if(route.obstacleType==='low')E.jump(s);if(['overhead','duckwall'].includes(route.obstacleType))E.slide(s)}}}E.update(s,50);if(frame%4===0)metrics=fixtureRenderer.draw(s);max=Math.max(max,s.entities.length);events=Math.max(events,s.events.length);if(s.over)throw Error('action-aware route died')}return{simulatedSeconds:120,draws:600,executionMs:performance.now()-started,maxEntities:max,pool:s._pool.length,active:s.entities.length,total:s._pool.length+s.entities.length,maxEvents:events,dpr:metrics.dpr,domBefore:dom,domAfter:document.querySelectorAll('*').length}})()`);
  assert.equal(report.pool.total, 48); assert.ok(report.pool.maxEntities <= 48 && report.pool.maxEvents <= 16 && report.pool.dpr <= 1.5); assert.equal(report.pool.domBefore, report.pool.domAfter);
  await evaluate('fixtureRenderer.destroy();fixtureCanvas.remove()');
  for (const [width, action, imageName] of [[390, 'jump', 'mobile-gate-jump'], [320, 'slide', 'small-mobile-slide'], [1280, 'run', 'train-rooftop'], [1280, 'slide', 'under-beam-depth'], [1280, 'run', 'mixed-vehicles'], [1280, 'run', 'truck-cab-support'], [1280, 'run', 'near-edge-crate'], [1280, 'run', 'coins-occluded'], [1280, 'run', 'roof-coins'], [1280, 'slide', 'duckwall'], [1280, 'run', 'tunnel-approach'], [1280, 'run', 'tunnel-inside'], [1280, 'run', 'tunnel-exit'], [1280, 'run', 'long-tunnel-hazards'], [390, 'run', 'fog-reveal']]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await evaluate(`fixtureContext.progress={readinessNextAt:0};await LootLinguaGateRunner.launch(fixtureContext);window.fixtureVisualUI=document.querySelector('.llr-overlay').cloneNode(true)`);
    await key('Escape');
    await wait(`!document.querySelector('.llr-overlay')`, 'close controller before isolated renderer scene');
    await evaluate(`document.body.append(fixtureVisualUI);document.querySelector('.llr-screen').hidden=true;window.fixtureVisualState=fixtureEngine.createState(fixtureWords,{random:()=>.5});Object.assign(fixtureVisualState,{elapsed:500,action:'${action}',actionStartedAt:100,actionUntil:900,lane:1,distance:85});fixtureVisualState.entities=[{id:1,active:true,kind:'gate',z:24,lane:1,word:'lantern',options:['جسر','فانوس','نهر'],correctLane:1},{id:2,active:true,kind:'obstacle',obstacleType:'low',lane:2,z:9},{id:3,active:true,kind:'obstacle',obstacleType:'overhead',lane:0,z:13},{id:4,active:true,kind:'obstacle',obstacleType:'wall',lane:2,z:30},{id:5,active:true,kind:'coin',lane:0,z:6}];window.fixtureVisual=LootLinguaRunnerRenderer.createRenderer(document.querySelector('.llr-canvas'));const b=document.querySelector('.llr-viewport').getBoundingClientRect();fixtureVisual.resize(b.width,b.height);fixtureVisual.draw(fixtureVisualState);document.querySelector('.llr-challenge').hidden=false;document.querySelector('.llr-challenge strong').textContent='lantern';document.querySelector('.llr-gate-labels').hidden=false;document.querySelector('.llr-gate-labels').style.top=(b.height*.48)+'px';document.querySelectorAll('.llr-gate-label').forEach((label,i)=>{label.textContent=fixtureVisualState.entities[0].options[i]});`);
    if (imageName === 'train-rooftop') await evaluate(`Object.assign(fixtureVisualState,{lane:1,distance:300,action:'run'});fixtureVisualState.entities=[{id:1,active:true,kind:'obstacle',obstacleType:'train',lane:1,z:-10,length:20,resolved:true},{id:2,active:true,kind:'coin',lane:1,z:2,height:1.49},{id:3,active:true,kind:'obstacle',obstacleType:'low',lane:0,z:14},{id:4,active:true,kind:'obstacle',obstacleType:'overhead',lane:2,z:20}];document.querySelector('.llr-challenge').hidden=true;document.querySelector('.llr-gate-labels').hidden=true;fixtureVisual.draw(fixtureVisualState);`);
    if (['under-beam-depth', 'mixed-vehicles', 'truck-cab-support', 'near-edge-crate'].includes(imageName)) {
      const scene = imageName === 'under-beam-depth' ? [{id:1,active:true,kind:'obstacle',obstacleType:'overhead',lane:1,z:-2.4,resolved:true}]
        : imageName === 'mixed-vehicles' ? [{id:1,active:true,kind:'obstacle',obstacleType:'train',lane:0,z:15,length:20},{id:2,active:true,kind:'obstacle',obstacleType:'wall',lane:1,z:15},{id:3,active:true,kind:'obstacle',obstacleType:'train',lane:2,z:19,length:20}]
        : imageName === 'truck-cab-support' ? [{id:1,active:true,kind:'obstacle',obstacleType:'train',lane:1,z:-19.5,length:20,resolved:true}]
        : [{id:1,active:true,kind:'obstacle',obstacleType:'wall',lane:2,z:-8,resolved:true}];
      const result = await evaluate(`fixtureVisualState.entities=${JSON.stringify(scene)};document.querySelector('.llr-challenge').hidden=true;document.querySelector('.llr-gate-labels').hidden=true;({metrics:fixtureVisual.draw(fixtureVisualState),pose:fixtureEngine.getPose(fixtureVisualState)})`);
      if (imageName === 'under-beam-depth') { assert.equal(result.metrics.foreground, 1); assert.ok(result.pose.top < .6); }
      if (imageName === 'truck-cab-support') assert.equal(result.pose.floor, 1.05);
      if (imageName === 'near-edge-crate') assert.equal(result.metrics.drawn, 1);
    }
    if (['coins-occluded', 'roof-coins', 'duckwall', 'tunnel-approach', 'tunnel-inside', 'tunnel-exit'].includes(imageName)) {
      const scene = imageName === 'coins-occluded' ? [{id:1,active:true,kind:'obstacle',obstacleType:'wall',lane:1,z:8}]
        : imageName === 'roof-coins' ? [{id:1,active:true,kind:'obstacle',obstacleType:'train',lane:1,z:4,length:20}]
        : imageName === 'duckwall' ? [{id:1,active:true,kind:'obstacle',obstacleType:'duckwall',lane:1,z:1}]
        : [{id:1,active:true,kind:'gate',lane:1,z:imageName === 'tunnel-approach' ? 28 : imageName === 'tunnel-inside' ? -22 : -55,length:42,word:'lantern',options:['جسر','فانوس','نهر'],correctLane:1,resolved:imageName !== 'tunnel-approach'}];
      await evaluate(`fixtureVisualState.entities=${JSON.stringify(scene)};fixtureVisualState.gate=fixtureVisualState.entities.find(e=>e.kind==='gate')||null;fixtureVisualState.feedback=null;document.querySelector('.llr-challenge').hidden=true;document.querySelector('.llr-gate-labels').hidden=true;fixtureVisual.draw(fixtureVisualState);`);
      if (imageName === 'coins-occluded' || imageName === 'roof-coins') {
        const difference = await evaluate(`(()=>{const c=document.querySelector('.llr-canvas'),ctx=c.getContext('2d'),before=ctx.getImageData(0,0,c.width,c.height).data;fixtureVisualState.entities.push({id:9,active:true,kind:'coin',lane:1,z:${imageName === 'coins-occluded' ? 12 : 15},height:${imageName === 'coins-occluded' ? .44 : 1.49}});fixtureVisual.draw(fixtureVisualState);const after=ctx.getImageData(0,0,c.width,c.height).data;let changed=0;for(let i=0;i<before.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2])changed++;return changed})()`);
        if (imageName === 'coins-occluded') assert.equal(difference,0,'wall hides the entire coin');
        else assert.ok(difference>50,'roof coin is visible above its supporting vehicle');
        report.checks.push({name:imageName,changedPixels:difference});
        if (imageName === 'roof-coins') {
          const orderDifference = await evaluate(`(()=>{const c=document.querySelector('.llr-canvas'),ctx=c.getContext('2d');fixtureVisualState.entities.push({id:10,active:true,kind:'coin',lane:1,z:16.2,height:1.49});fixtureVisual.draw(fixtureVisualState);const before=ctx.getImageData(0,0,c.width,c.height).data;fixtureVisualState.entities.reverse();fixtureVisual.draw(fixtureVisualState);const after=ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<before.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2])n++;return n})()`);
          assert.equal(orderDifference, 0, 'overlapping roof coins keep physical depth regardless of allocation order');
          report.checks.push({name:'roof coin depth order',changedPixels:orderDifference});
        }
      }
    }
    if (imageName === 'long-tunnel-hazards') {
      await evaluate(`fixtureVisualState.entities=[{id:1,active:true,kind:'gate',lane:1,z:-22,length:256,resolved:true},{id:2,active:true,kind:'obstacle',obstacleType:'train',lane:0,z:16,length:20},{id:3,active:true,kind:'obstacle',obstacleType:'duckwall',lane:1,z:16},{id:4,active:true,kind:'obstacle',obstacleType:'wall',lane:2,z:16},{id:5,active:true,kind:'obstacle',obstacleType:'low',lane:1,z:48}];fixtureVisualState.gate=fixtureVisualState.entities[0];document.querySelector('.llr-challenge').hidden=true;document.querySelector('.llr-gate-labels').hidden=true;fixtureVisual.draw(fixtureVisualState);`);
    }
    if (imageName === 'fog-reveal') {
      const reveal = await evaluate(`(()=>{const c=document.querySelector('.llr-canvas'),ctx=c.getContext('2d');fixtureVisualState.entities=[];fixtureVisualState.gate=null;fixtureVisual.draw(fixtureVisualState);const before=ctx.getImageData(0,0,c.width,c.height).data;const differences=z=>{fixtureVisualState.entities=[{id:9,kind:'obstacle',obstacleType:'wall',lane:1,z,active:true,bornAt:0}];fixtureVisual.draw(fixtureVisualState);const after=ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<before.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2])n++;return n};return{atSpawn:differences(fixtureEngine.constants.SPAWN_Z),approaching:differences(82)}})()`);
      assert.equal(reveal.atSpawn, 0, 'allocation behind fog produces no visible pixel change');
      assert.ok(reveal.approaching > 0, 'the existing obstacle gradually emerges while approaching');
      report.checks.push({name:'distance-driven fog reveal',...reveal});
      const opaqueTruck = await evaluate(`(()=>{const c=document.querySelector('.llr-canvas'),ctx=c.getContext('2d');fixtureVisualState.entities=[{id:1,kind:'obstacle',obstacleType:'train',lane:1,z:82,length:20,active:true,bornAt:0}];fixtureVisual.draw(fixtureVisualState);const before=ctx.getImageData(0,0,c.width,c.height).data;fixtureVisualState.entities.push({id:2,kind:'coin',lane:1,z:92,height:.44,active:true});fixtureVisual.draw(fixtureVisualState);const after=ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<before.length;i+=4)if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2])n++;return n})()`);
      assert.equal(opaqueTruck, 0, 'a distant truck is solid and hides ground-level coins behind its body');
      report.checks.push({name:'opaque distant truck',changedPixels:opaqueTruck});
    }
    await screenshot(imageName);
    const pixels = await evaluate(`(()=>{const c=document.querySelector('.llr-canvas'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const colors=new Set();for(let i=0;i<data.length;i+=400)colors.add(data[i]+','+data[i+1]+','+data[i+2]);return colors.size})()`);
    assert.ok(pixels > 15, 'renderer must produce a nonblank scene');
    await evaluate(`fixtureVisual.destroy();fixtureVisualUI.remove()`);
  }
  // Exercise the actual quiz entry/settings/start functions against local-only
  // source adapters. No Firebase requests or user progress writes.
  const entry = read('index.html'), quizCode = read('js/quiz.js');
  const setup = entry.slice(entry.indexOf('<div id="quizViewSetup"'), entry.indexOf('<!-- Quiz Flashcard -->'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate(`document.getElementById('fixtureBackground').insertAdjacentHTML('afterbegin', ${JSON.stringify(setup)});currentView='quiz';var selectedQuizMode='flashcards',currentQuizSource='personal',quizQuestionCount='10',customWorlds=[],activeQuizSession=null,currentQuizWords=[],timeAttackTimer=null;var SCRAMBLE_DIRECTION_COPY={'ar-to-en':'رتب الكلمة'},scrambleDirection='ar-to-en';`);
  await evaluate(`await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/js/quiz-core.js';script.onload=resolve;script.onerror=reject;document.head.append(script)});`);
  await evaluate(quizCode);
  await evaluate(`window.fixtureDictionary=Array.from({length:12},(_,i)=>({word:'word'+i,meaning:'معنى '+i}));getQuizSourceWords=()=>fixtureDictionary;getQuizSourceResolutionStatus=()=> 'ready';ensureQuizSourceReady=async()=>({});getConfiguredQuizWords=()=>fixtureDictionary.slice(0,Number(quizQuestionCount)||12);syncQuizSourceOptions=()=>{};refreshQuizAvailableCount=()=>LootLinguaGateRunner.mountPreview(document.getElementById('runnerModePreview'));refreshQuizAvailableCount();document.querySelector('.quiz-mode-runner').scrollIntoView();`);
  await wait(`document.getElementById('runnerModePreview').width>0`, 'runner preview');
  await screenshot('dictionary-runner-entry');
  await evaluate(`fixtureDictionary=fixtureDictionary.slice(0,9);openQuizModeSettings('runner')`);
  assert.equal(await evaluate(`document.getElementById('quizStartButton').disabled`), true);
  await evaluate(`fixtureDictionary.push({word:'tenth',meaning:'العاشر'});refreshQuizSettingsSummary();setQuizQuestionCount('5',document.querySelector('[data-quiz-count="5"]'));document.getElementById('quizSettingsPanel').scrollIntoView();`);
  assert.equal(await evaluate(`document.getElementById('quizStartButton').disabled`), false);
  assert.equal(await evaluate(`document.getElementById('runnerSetupBrief').hidden`), false);
  await screenshot('dictionary-runner-settings');
  await evaluate(`fixtureRejectWords=true;await startConfiguredQuiz()`);
  await wait(`!!document.querySelector('.llr-overlay')`, 'dictionary run');
  await key('Escape');
  assert.equal(await evaluate(`document.getElementById('quizSettingsPanel').classList.contains('runner-setup')`), true);
  await evaluate(`openQuizModeSettings('flashcards')`);
  assert.equal(await evaluate(`document.getElementById('runnerSetupBrief').hidden`), true);
  report.checks.push({ name: 'real dictionary settings lock at 9, unlock at 10, select 5 words, launch without published gate calls and restore ordinary quiz settings', passed: true });
  report.assets = requests.filter(item => /runner-engine|runner-renderer|runner\.css/.test(item));
  report.runtimeExceptions = exceptions; assert.deepEqual(exceptions, []);
  fs.writeFileSync(path.join(output, 'browser-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error?.stack || error); report.runtimeExceptions = exceptions; report.caughtExceptions = caughtExceptions;
  fs.writeFileSync(path.join(output, 'browser-smoke-failed.json'), JSON.stringify(report, null, 2) + '\n');
  throw error;
} finally {
  socket?.close(); browser.kill(); await new Promise(resolve => server.close(resolve));
}
