import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const xp = read('js/xp.js'), script = read('js/script.js'), runtime = read('js/core-runtime.js');
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing fixture source: ${start}`);
  return source.slice(from, to);
};
const streakCode = section(xp, 'function checkAndUpdateStreak(options = {})', '// ── Daily Goal & Confetti');
const modalCode = section(script, 'let activeModalFocusContext =', 'function findInFlightToast');
const keyboardCode = section(runtime, 'function closeOpenModalByShortcut()', '// ═══════════════════════════════════════════════════════\n// Init');
const hydrateCode = section(script, 'window.applyCanonicalLootlinguaProfile =', 'window.mergeLootlinguaProfileFromCloud =');
const browserPath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!browserPath) throw Error('Chrome/Edge not found');
const port = 21000 + process.pid % 2000;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-streak-freeze-'));
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-default-apps', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, nextId = 0;
const pending = new Map(), errors = [];
const report = { isolation: 'Real Chrome DOM/input with actual header, modal, CSS, streak, hydration and keyboard functions; in-memory storage; all network blocked', layout: [], helpThemes: [], interactions: [] };
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
async function key(name, shift = false) {
  const code = name === 'Enter' ? 13 : name === 'Tab' ? 9 : 27;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
  await delay(60);
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidenceDir, name), Buffer.from(result.data, 'base64'));
}
const evidenceDir = path.join(root, 'reports', 'stage-two-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
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
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
  const frameId = (await send('Page.getFrameTree')).frameTree.frame.id;
  await send('Page.setDocumentContent', { frameId, html: '<!doctype html><html lang="ar" dir="rtl" data-theme="lootlingua"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>' });
  await evaluate(`
    document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(read('style.css') + '\n' + read('entry-experience.css'))}}));
    const parsed = new DOMParser().parseFromString(${JSON.stringify(read('index.html'))},'text/html');
    document.body.innerHTML=parsed.getElementById('legendTopBar').outerHTML + '<main style="padding:120px 20px 20px"><h1>قاموسي</h1><p>كلماتك وتقدّم تعلّمك.</p></main>' + parsed.getElementById('streakFreezeHelpModal').outerHTML;
    const values=new Map();
    Object.defineProperty(window,'localStorage',{value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
    var userXP=100,dailyStreak=7,lastActivity='2026-11-03',currentView='personal';
    var APP_MODAL_ROUTES={streakFreezeHelpModal:'streak-freeze'};
    function loadInt(key,fallback){const value=parseInt(localStorage.getItem(key),10);return Number.isNaN(value)?fallback:value;}
    function saveInt(key,value){localStorage.setItem(key,String(value));}
    function loadJSON(key,fallback){return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}
    function saveJSON(key,value){localStorage.setItem(key,JSON.stringify(value));}
    function getStreakFreezeCount(){return loadInt('lootlinguaStreakFreezes',0);}
    function saveStreakFreezeCount(count){saveInt('lootlinguaStreakFreezes',count);}
    function todayStr(){return '2026-11-06';}
    function localDateKey(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
    function hasSignedInUser(){return false;}
    function isJsonImportBatchActive(){return true;}
    function getDailyQuestStorageKey(day){return 'dailyQuest:'+day;}
    for (const name of ['requestProfileCloudSave','renderDailyGoal','renderXPBar','syncHeroAvatar','renderProfileModalStats','updateDailyQuestsBadge','refreshFeatureUnlockUI','evaluateTitleUnlocks','showToast','setAppRoute','toggleProfileModal','openStatsPanel','toggleNotificationsPanel','toggleDailyQuestsSheet'])window[name]=()=>{};
    window.closeRouteEntry=(_kind,_key,callback)=>callback();
    ${modalCode}
    ${keyboardCode}
    ${streakCode}
    ${hydrateCode}
    window.setFreezeFixture=count=>{saveInt('lootlinguaStreakFreezes',count);renderStreak();};
    setFreezeFixture(0);
  `);
  const themes = [{ theme: 'lootlingua' }, { theme: 'golden' }, { theme: 'scroll' }, { theme: 'ocean', mode: 'light' }, { theme: 'ocean', mode: 'dark' }];
  for (const width of [320, 390, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: width < 600 });
    for (const theme of themes) for (const count of [0, 2, 999999]) {
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme.theme)};document.documentElement.dataset.oasisMode=${JSON.stringify(theme.mode || 'light')};setFreezeFixture(${count});`);
      await delay(40);
      const measured = await evaluate(`(()=>{
        const bar=document.getElementById('legendTopBar'),freeze=document.querySelector('.streak-freeze-row'),help=document.querySelector('.streak-freeze-help');
        const nodes=[document.getElementById('heroAvatarBtn'),...document.querySelector('.legend-top-widgets').children];
        const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const boxes=nodes.map(rect); const overlap=[];
        for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){const x=Math.min(boxes[a].right,boxes[b].right)-Math.max(boxes[a].x,boxes[b].x),y=Math.min(boxes[a].bottom,boxes[b].bottom)-Math.max(boxes[a].y,boxes[b].y);if(x>.5&&y>.5)overlap.push([a,b]);}
        return {bar:rect(bar),freeze:rect(freeze),help:rect(help),widgets:boxes,text:document.querySelector('[data-streak-freeze-count]').textContent,label:help.getAttribute('aria-label'),overflow:document.documentElement.scrollWidth>innerWidth,overlap,inside:boxes.every(r=>r.x>=-.5&&r.right<=innerWidth+.5)};
      })()`);
      const result = { width, ...theme, count, ...measured }; report.layout.push(result);
      assert.equal(measured.text, count ? `${count} فريز` : 'بدون فريز');
      assert.ok(!measured.overflow && measured.inside && measured.overlap.length === 0, 'Header layout: ' + JSON.stringify(result));
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
  await evaluate(`document.documentElement.dataset.theme='lootlingua';document.documentElement.dataset.oasisMode='light';setFreezeFixture(2);`);
  await screenshot('streak-freeze-320.png');
  await evaluate(`document.querySelector('.streak-freeze-help').focus();`); await key('Enter');
  const opened = await evaluate(`({visible:getComputedStyle(document.getElementById('streakFreezeHelpModal')).display!=='none',focused:document.getElementById('streakFreezeHelpModal').contains(document.activeElement),text:document.getElementById('streakFreezeHelpDescription').textContent,balance:document.getElementById('streakFreezeHelpBalance').textContent,viewport:document.getElementById('streakFreezeHelpModal').querySelector('.modal-content').getBoundingClientRect().toJSON()})`);
  assert.ok(opened.visible && opened.focused, JSON.stringify({ opened, errors, active: await evaluate('document.activeElement.outerHTML') })); assert.match(opened.text, /كل يوم غياب يحتاج فريزًا واحدًا/);
  assert.match(opened.text, /يوم عودتك يزيد السلسلة يومًا/); assert.match(opened.text, /لا يُصرف أي فريز/); assert.match(opened.text, /ليست سلسلة فتح الصناديق/);
  assert.equal(opened.balance, 'رصيدك الحالي: 2 فريز');
  assert.ok(opened.viewport.x >= 0 && opened.viewport.right <= 320 && opened.viewport.y >= 0 && opened.viewport.bottom <= 720);
  await screenshot('streak-freeze-help-320.png');
  await key('Tab'); assert.equal(await evaluate(`document.getElementById('streakFreezeHelpModal').contains(document.activeElement)`), true);
  await key('Tab', true); assert.equal(await evaluate(`document.getElementById('streakFreezeHelpModal').contains(document.activeElement)`), true);
  await key('Escape'); assert.equal(await evaluate(`getComputedStyle(document.getElementById('streakFreezeHelpModal')).display==='none'&&document.activeElement.classList.contains('streak-freeze-help')`), true);
  report.interactions.push({ name: 'Enter opens help; Tab/Shift+Tab stay inside; Escape restores help focus', passed: true });
  await evaluate(`document.querySelector('.streak-freeze-help').click();`); await delay(60);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('streakFreezeHelpModal')).display!=='none'`), true);
  await evaluate(`setFreezeFixture(2);dailyStreak=7;lastActivity='2026-11-03';checkAndUpdateStreak({learningEvent:true});`);
  assert.deepEqual(await evaluate(`({count:document.querySelector('[data-streak-freeze-count]').textContent,balance:document.getElementById('streakFreezeHelpBalance').textContent,streak:dailyStreak})`), { count: 'بدون فريز', balance: 'رصيدك الحالي: 0 فريز', streak: 8 });
  report.interactions.push({ name: 'two missed days spend two freezes and refresh the badge and open help balance', passed: true });
  await evaluate(`applyCanonicalLootlinguaProfile({streakFreezes:2,dailyStreak:9,lastActivityDate:'2026-11-06'});`);
  assert.deepEqual(await evaluate(`({count:document.querySelector('[data-streak-freeze-count]').textContent,balance:document.getElementById('streakFreezeHelpBalance').textContent,streak:dailyStreak})`), { count: '2 فريز', balance: 'رصيدك الحالي: 2 فريز', streak: 9 });
  report.interactions.push({ name: 'canonical account hydration refreshes both badge and open help balance', passed: true });
  for (const theme of themes) {
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme.theme)};document.documentElement.dataset.oasisMode=${JSON.stringify(theme.mode || 'light')};`);
    await delay(60);
    const help = await evaluate(`(()=>{const modal=document.getElementById('streakFreezeHelpModal'),content=modal.querySelector('.modal-content'),description=document.getElementById('streakFreezeHelpDescription'),button=modal.querySelector('button'),rect=content.getBoundingClientRect();return {visible:getComputedStyle(modal).display!=='none',inside:rect.x>=0&&rect.right<=innerWidth&&rect.y>=0&&rect.bottom<=innerHeight,horizontalOverflow:content.scrollWidth>content.clientWidth,textColor:getComputedStyle(description).color,surfaceColor:getComputedStyle(content).backgroundColor,buttonColor:getComputedStyle(button).color,buttonSurface:getComputedStyle(button).backgroundColor};})()`);
    report.helpThemes.push({ ...theme, width: 320, ...help });
    assert.ok(help.visible && help.inside && !help.horizontalOverflow, 'Help theme bounds: ' + JSON.stringify({ theme, help }));
  }
  assert.deepEqual(errors, []); report.runtimeExceptions = errors; report.passed = true;
  console.log(JSON.stringify({ layoutCases: report.layout.length, helpThemeCases: report.helpThemes.length, interactions: report.interactions, runtimeExceptions: errors }, null, 2));
} finally {
  report.runtimeExceptions = errors;
  fs.writeFileSync(path.join(evidenceDir, 'streak-freeze-browser.json'), JSON.stringify(report, null, 2) + '\n');
  socket?.close(); browser.kill();
}
