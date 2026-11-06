import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const output = path.join(root, 'reports', 'glass-evidence'); fs.mkdirSync(output, { recursive: true });
const server = http.createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browserPath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!browserPath) throw Error('Chrome/Edge unavailable');
const port = 24000 + process.pid % 1000, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-glass-'));
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
const report = { isolation: 'Local Chrome and actual CSS/card renderer with sample content. Network, Firebase, user data and application writes are excluded.', modes: [] };
try {
  for (let retry = 0; ; retry++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch (error) { if (retry > 60) throw error; await delay(100); } }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.once('open', resolve));
  socket.on('message', data => { const message = JSON.parse(data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const call = pending.get(message.id); if (!call) return; pending.delete(message.id); if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result); });
  await send('Page.enable'); await send('Page.bringToFront'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['https://*'] });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }); await delay(100);
  const cardSource = read('js/dictionary-render.js');
  const render = cardSource.slice(cardSource.indexOf('function wordDetailText('), cardSource.indexOf('function ensureWordCardDetails('));
  await evaluate(`document.documentElement.dataset.theme='glass';document.body.className='legend-dock-visible perf-balanced';
    document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(read('style.css') + '\n' + read('motivation.css') + '\n' + read('glass-theme.css'))}}));
    const parsed=new DOMParser().parseFromString(${JSON.stringify(read('index.html'))},'text/html');
    document.body.innerHTML=parsed.querySelector('.legend-top-bar').outerHTML+'<main class="main-content">'+parsed.querySelector('.page-header').outerHTML+parsed.getElementById('personalControls').outerHTML+'<ul id="list" class="dictionary-windowed"></ul><section class="published-view-header"><h3>مغامرة الكلمات</h3></section><article class="published-word-card"><div class="published-word-content"><strong class="published-word-text">Lantern</strong><p class="published-word-translation">فانوس يضيء طريق رحلتك</p><p class="published-word-example">Keep your lantern close.</p></div><div class="published-word-actions"><button class="published-word-icon-btn">♪</button></div></article></main>'+parsed.querySelector('.legend-dock').outerHTML;
    document.head.append(Object.assign(document.createElement('style'),{textContent:'i{font-family:Arial!important}i::before{content:none!important}.glass-test-sheet{position:fixed!important;inset:22% 5% auto!important;width:min(430px,90vw)!important;max-height:65vh!important;margin:auto!important;padding:24px!important;transform:none!important;z-index:21000!important}.glass-test-sheet[hidden]{display:none!important}'}));
    document.querySelectorAll('i').forEach((node,index)=>node.textContent=['✦','◇','◉','⌕','↗'][index%5]);
    window.isReorderMode=false;window.selectedIndices=[];window.isBulkDeleteMode=false;window.bulkSelectedWordIds=new Set();window.isCustomWorldView=()=>false;window.safeClassToken=x=>x;window.escapeHtml=x=>String(x??'');window.highlightText=x=>x;
    window.renderMasteryIndicator=w=>'<span class="mastery-meter mastery-'+w.stage+'">'+Array.from({length:3},(_,i)=>'<span class="mastery-dot '+(i<w.stage?'filled':'')+'"></span>').join('')+'</span>';
    window.words=[{id:'1',word:'Discover',meaning:'يكتشف — تعلّم كلمة جديدة ووسّع عالمك',category:'فعل',partOfSpeech:'verb',stage:2,starred:true,expanded:true,example:'Discover something new every day.',exampleTranslation:'اكتشف شيئًا جديدًا كل يوم.'},{id:'2',word:'Journey',meaning:'رحلة من التعلّم والتقدّم',category:'اسم',stage:3},{id:'3',word:'Brilliant',meaning:'لامع، مبدع، ذكي',category:'صفة',stage:1}];${render}
    document.getElementById('list').innerHTML=words.map(w=>renderWordCard(w,'',new Map())).join('');
    document.querySelectorAll('#list i').forEach((node,index)=>node.textContent=['★','♪','✎','×'][index%4]);
    window.glassSheet=document.createElement('section');glassSheet.className='profile-modal-sheet glass-test-sheet';glassSheet.innerHTML='<h2>ملفك الشخصي</h2><p class="settings-label">خلفية واضحة للنصوص حتى عند تقليل البلور.</p><label>اسم المستخدم <input value="مستكشف الكلمات"></label><p>تقدّمك محفوظ، أكمل رحلتك بخطوة صغيرة.</p>';glassSheet.hidden=true;document.body.append(glassSheet);
    window.glassMetrics=()=>{const card=document.querySelector('.word-card'),dock=document.querySelector('.legend-top-bar'),styles=getComputedStyle(card),meaning=getComputedStyle(card.querySelector('.meaning-text'));return{mode:document.body.className,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,cardBackdrop:styles.backdropFilter,dockBackdrop:getComputedStyle(dock).backdropFilter,edgeBackdrop:getComputedStyle(dock,'::after').backdropFilter,edgeContent:getComputedStyle(dock,'::after').content,sheetBackdrop:getComputedStyle(glassSheet).backdropFilter,titleFill:getComputedStyle(document.getElementById('pageTitle')).webkitTextFillColor,cardFill:styles.getPropertyValue('--lg-card').trim(),sheetFill:styles.getPropertyValue('--lg-sheet').trim(),meaning:meaning.color,cardColor:styles.color}};
    window.fixtureContrast=()=>{const luminance=rgb=>{const c=rgb.slice(0,3).map(n=>{n=n/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722};const raw=getComputedStyle(document.querySelector('.word-card')),ink=getComputedStyle(document.querySelector('.meaning-text')).color.match(/[\\d.]+/g).map(Number);const fill=raw.getPropertyValue('--lg-card').trim();const canvas=[100,145,165];let color;if(fill.startsWith('#')){const h=fill.slice(1);color=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16))}else{const v=fill.match(/[\\d.]+/g).map(Number),alpha=v[3]??1;color=v.slice(0,3).map((n,i)=>n*alpha+canvas[i]*(1-alpha))}color=color.map(n=>n*.945+255*.055);return(luminance(ink)+.05)/(luminance(color)+.05)};
  `);
  for (const [mode, width] of [['perf-ultra', 1280], ['perf-balanced', 1280], ['perf-stable', 390], ['perf-turbo', 390], ['low-end-device', 320]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate(`document.body.className='legend-dock-visible ${mode}'`); await delay(80);
    const metrics = await evaluate('glassMetrics()'); metrics.readingContrast = await evaluate('fixtureContrast()');
    assert.equal(metrics.overflow, false); assert.equal(metrics.cardBackdrop, 'none'); assert.equal(metrics.edgeBackdrop, 'none'); assert.ok(metrics.readingContrast >= 4.5, JSON.stringify(metrics));
    if (['perf-stable', 'perf-turbo', 'low-end-device'].includes(mode)) { assert.equal(metrics.dockBackdrop, 'none'); assert.equal(metrics.sheetBackdrop, 'none'); assert.equal(metrics.edgeContent, 'none'); assert.notEqual(metrics.titleFill, 'rgba(0, 0, 0, 0)'); }
    else assert.ok(metrics.dockBackdrop.includes('blur('));
    report.modes.push(metrics);
    if (mode === 'perf-balanced' || mode === 'perf-turbo') await screenshot(mode);
  }
  await evaluate(`document.body.className='legend-dock-visible perf-balanced';document.querySelector('.word-card').classList.add('bulk-selected');`);
  assert.ok((await evaluate(`getComputedStyle(document.querySelector('.word-card')).boxShadow`)).includes('255, 219, 159'));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reduced = await evaluate('glassMetrics()'); assert.equal(reduced.dockBackdrop, 'none'); assert.equal(reduced.sheetBackdrop, 'none'); assert.equal(reduced.edgeContent, 'none');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.word-card')).animationName`), 'none');
  report.reduced = reduced;
  await evaluate(`document.body.className='legend-dock-visible perf-ultra'`);
  const reducedUltra = await evaluate('glassMetrics()'); assert.equal(reducedUltra.cardFill, '#203f55'); assert.equal(reducedUltra.sheetBackdrop, 'none'); assert.notEqual(reducedUltra.titleFill, 'rgba(0, 0, 0, 0)');
  report.reducedUltra = reducedUltra;
  await evaluate('glassSheet.hidden=false');
  assert.equal(await evaluate('getComputedStyle(glassSheet).animationName'), 'none');
  assert.equal(await evaluate('getComputedStyle(glassSheet).opacity'), '1');
  await screenshot('reduced-transparency-sheet');
  await evaluate(`glassSheet.hidden=true;document.documentElement.dataset.theme='scroll'`);
  assert.equal(await evaluate(`getComputedStyle(document.body).getPropertyValue('--lg-card').trim()`), '', 'material variables must not leak to another theme');
  report.runtimeExceptions = errors; assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'browser-smoke.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { socket?.close(); browser.kill(); await new Promise(resolve => server.close(resolve)); }
