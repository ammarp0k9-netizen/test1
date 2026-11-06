import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const start = index.indexOf('<div class="theme-selector profile-theme-selector">');
const selector = index.slice(start, index.indexOf('<div id="profileOasisModeSetting"', start));
const script = read('js/script.js');
const themeCode = script.slice(script.indexOf('window.setTheme ='), script.indexOf('function loadTheme()'));
const xp = read('js/xp.js');
const xpCode = xp.slice(0, xp.indexOf('const XP_ECONOMY_VERSION'));
const browserPath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!browserPath) throw Error('Chrome/Edge not found');
const debugPort = 16000 + process.pid % 3000;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-theme-a11y-'));
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-default-apps', '--disable-gpu', '--no-sandbox', '--remote-allow-origins=*', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, nextId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function key(keyName, code, windowsVirtualKeyCode) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode, text: keyName === 'Enter' ? '\r' : keyName });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode });
}
const report = { isolation: 'about:blank DOM fixture, all network blocked, in-memory preference storage; no auth/cloud modules', keyboard: [], colors: [] };
try {
  for (let i = 0; ; i++) {
    try { await fetch('http://127.0.0.1:' + debugPort + '/json/version'); break; }
    catch (error) { if (i > 60) throw error; await delay(100); }
  }
  const target = await (await fetch('http://127.0.0.1:' + debugPort + '/json/new?about:blank', { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.once('open', resolve));
  socket.on('message', data => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(Error(message.error.message)); else call.resolve(message.result);
  });
  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 720, deviceScaleFactor: 1, mobile: false });
  const frame = (await send('Page.getFrameTree')).frameTree.frame.id;
  await send('Page.setDocumentContent', { frameId: frame, html: `<!doctype html><html lang="ar" dir="rtl" data-theme="lootlingua"><head><meta charset="utf-8"><style>${read('style.css')}\n${read('entry-experience.css')}\nbody{padding:24px;max-width:760px;margin:auto} .fixture-actions{display:grid;gap:16px;margin-top:28px}</style></head><body><h2>الثيمات</h2>${selector}<div class="fixture-actions"><button class="app-auth-submit">تسجيل الدخول</button><div class="feature-mini-onboarding-actions"><button class="feature-mini-onboarding-next">التالي</button></div></div></body></html>` });
  await evaluate(`
    var userXP = 0, notices = [], saves = [];
    const storage = new Map();
    Object.defineProperty(window, 'localStorage', { value: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } });
    Object.defineProperty(window, 'sessionStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
    function loadInt() { return userXP; }
    function shouldSuppressUnlockNotices() { return true; }
    function showToast(...args) { notices.push(args); }
    function currentThemePreferenceKey() { return 'fixture-theme'; }
    function syncOasisAppearanceControls() {}
    function showThemeUseMessageOnce() {}
    function requestProfilePreferencesSave(value) { saves.push(value); }
    ${xpCode}
    ${themeCode}
    setTheme('lootlingua', true);
  `);
  const state = () => evaluate(`({theme:document.documentElement.dataset.theme, selected:[...document.querySelectorAll('.theme-option[aria-pressed="true"]')].map(item=>item.dataset.theme), notices:notices.length})`);
  const buttons = await evaluate(`[...document.querySelectorAll('.theme-option')].map(item=>({tag:item.tagName,type:item.type,tabIndex:item.tabIndex,theme:item.dataset.theme}))`);
  assert.equal(buttons.length, 5);
  assert.ok(buttons.every(button => button.tag === 'BUTTON' && button.type === 'button' && button.tabIndex === 0));
  await evaluate(`document.querySelector('[data-theme="ocean"].theme-option').focus()`);
  assert.equal(await evaluate('document.activeElement.dataset.theme'), 'ocean');
  await key('Enter', 'Enter', 13);
  assert.deepEqual((await state()).selected, ['ocean']);
  report.keyboard.push({ action: 'Enter selects available ocean', ...(await state()) });
  await evaluate(`document.querySelector('[data-theme="golden"].theme-option').focus()`);
  await key(' ', 'Space', 32);
  assert.equal((await state()).theme, 'ocean');
  assert.equal((await state()).notices, 1);
  report.keyboard.push({ action: 'Space respects golden level lock', ...(await state()) });
  await evaluate('userXP=50;refreshThemeLockUI()');
  await key(' ', 'Space', 32);
  assert.deepEqual((await state()).selected, ['golden']);
  report.keyboard.push({ action: 'Space selects unlocked golden', ...(await state()) });
  await evaluate(`document.querySelector('[data-theme="glass"].theme-option').focus()`);
  await key('Enter', 'Enter', 13);
  assert.equal((await state()).theme, 'golden');
  report.keyboard.push({ action: 'Enter respects glass level lock', ...(await state()) });
  await evaluate('userXP=150;refreshThemeLockUI()');
  await key('Enter', 'Enter', 13);
  assert.deepEqual((await state()).selected, ['golden']);
  report.keyboard.push({ action: 'Glass remains coming soon at Level 5', ...(await state()) });
  await evaluate('userXP=0;refreshThemeLockUI()');
  assert.deepEqual((await state()).selected, ['lootlingua']);
  report.keyboard.push({ action: 'Level relock synchronizes selected state', ...(await state()) });
  await send('DOM.enable');
  await send('CSS.enable');
  const doc = (await send('DOM.getDocument')).root.nodeId;
  for (const theme of ['lootlingua', 'golden', 'scroll', 'ocean', 'glass', 'frost']) {
    for (const mode of theme === 'ocean' ? ['light', 'dark'] : ['light']) {
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.dataset.oasisMode=${JSON.stringify(mode)}`);
      for (const selector of ['.app-auth-submit', '.feature-mini-onboarding-next']) {
        const nodeId = (await send('DOM.querySelector', { nodeId: doc, selector })).nodeId;
        for (const pseudo of [[], ['hover'], ['active']]) {
          await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudo });
          const colors = await evaluate(`(() => {
            const style=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
            const rgb=value=>value.match(/[0-9.]+/g).slice(0,3).map(Number);
            const luminance=values=>values.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
            const foreground=luminance(rgb(style.color)),background=luminance(rgb(style.backgroundColor));
            return {color:style.color,background:style.backgroundColor,ratio:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)};
          })()`);
          report.colors.push({ theme, mode, selector, state: pseudo[0] || 'normal', ...colors });
        }
        await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      }
    }
  }
  await evaluate(`userXP=50;setTheme('golden',true);document.querySelector('.theme-option[data-theme="golden"]').focus()`);
  const evidence = path.join(root, 'reports', 'integrity-evidence');
  fs.mkdirSync(evidence, { recursive: true });
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidence, 'theme-keyboard.png'), Buffer.from(screenshot.data, 'base64'));
  fs.writeFileSync(path.join(evidence, 'theme-accessibility.json'), JSON.stringify(report, null, 2) + '\n');
  const failures = report.colors.filter(item => item.ratio < 4.5);
  assert.deepEqual(failures, [], 'auth/coach text must meet 4.5:1 for every supported palette and state');
  console.log(JSON.stringify({ keyboardChecks: report.keyboard.length, contrastChecks: report.colors.length, minimumContrast: Math.min(...report.colors.map(item => item.ratio)), evidence }, null, 2));
} finally {
  socket?.close();
  browser.kill();
}
