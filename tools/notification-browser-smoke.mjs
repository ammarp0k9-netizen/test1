import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocketClient from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const evidenceDir = path.join(root, 'reports', 'notification-system-evidence');
const browserPath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));
if (!browserPath) throw new Error('Chrome/Edge not found');

const offset = (process.pid + 733) % 400;
const serverPort = 9300 + offset;
const debugPort = 10300 + offset;
const appUrl = `http://127.0.0.1:${serverPort}/app?notification-smoke=1`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-notification-smoke-'));
const server = spawn(process.execPath, [path.join(root, 'tools', 'static-server.mjs'), String(serverPort)], {
  cwd: root,
  stdio: 'ignore',
});
const browser = spawn(browserPath, [
  '--headless=new', '--no-sandbox', '--no-first-run', '--disable-extensions',
  '--disable-default-apps', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`, 'about:blank',
], { stdio: 'ignore' });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function retry(operation, attempts = 60, waitMs = 200) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation(); } catch (error) { lastError = error; await delay(waitMs); }
  }
  throw lastError;
}

let socket;
let nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result?.value;
}

async function waitFor(expression, label, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(expression)) return; } catch (_) {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function screenshot(name, clipExpression) {
  const clip = clipExpression ? await evaluate(clipExpression) : null;
  const result = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  const target = path.join(evidenceDir, name);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  return path.relative(root, target).replaceAll('\\', '/');
}

const fixture = `(() => {
  window.SmartLoadingOverlay?.forceHide?.();
  document.getElementById('smartLoadingOverlay')?.remove();
  document.getElementById('entryExperienceRoot')?.setAttribute('hidden', '');
  document.body.classList.remove('smart-loading-active', 'entry-experience-active');
  document.body.style.overflow = '';
  const store = window.LootLinguaNotificationStore;
  store.switchOwner('guest');
  store.dismissAllActive(Date.now() - 1000);
  const now = Date.now();
  const notices = [
    {
      ownerId: 'guest', kind: 'legacy', notificationType: 'reminder.streak.risk',
      occurrenceKey: 'visual:streak', actionGroup: 'practice', priority: 95,
      severity: 'high', status: 'active', visualType: 'warning',
      title: 'حافظ على سلسلتك',
      message: 'سلسلتك 8 أيام وما سجّلت ممارسة اليوم. راجع 5 كلمات مستحقة بخطوة قصيرة.',
      cta: { id: 'review-due', label: 'ابدأ الممارسة', args: {} },
      createdAt: now - 120000, updatedAt: now - 120000,
    },
    {
      ownerId: 'guest', kind: 'legacy', notificationType: 'progress.gate.ready',
      occurrenceKey: 'visual:gate-ready', actionGroup: 'gate-ready', priority: 91,
      severity: 'high', status: 'active', visualType: 'success',
      title: 'البوابة جاهزة',
      message: 'أكملت شروط بوابة الفريق. يمكنك دخول الاختبار الآن.',
      cta: { id: 'open-ready-gate', label: 'افتح البوابة', args: { worldId: 'visual', rankId: 'a1', gateId: 'team' } },
      createdAt: now - 60000, updatedAt: now - 60000,
    },
    {
      ownerId: 'guest', kind: 'legacy', notificationType: 'reminder.review.due',
      occurrenceKey: 'visual:reviews', actionGroup: 'review', priority: 78,
      severity: 'medium', status: 'active', visualType: 'warning',
      title: 'مراجعاتك بانتظارك',
      message: 'لديك 5 كلمات مستحقة للمراجعة. جلسة قصيرة الآن تمنع تراكمها.',
      cta: { id: 'review-due', label: 'راجع الآن', args: {} },
      createdAt: now, updatedAt: now,
    },
  ];
  store.upsertMany(notices, { reason: 'visual-fixture' });
  return { badge: store.getUnreadCount(), count: store.getDisplayRecords().length };
})()`;

const panelClip = `(() => {
  const panel = document.getElementById('notificationsPanel').getBoundingClientRect();
  const x = Math.max(0, panel.left - 28);
  const y = Math.max(0, panel.top - 78);
  return { x, y, width: Math.min(innerWidth - x, panel.width + 56), height: Math.min(innerHeight - y, panel.height + 100) };
})()`;

const results = { generatedAt: new Date().toISOString(), browser: browserPath, screenshots: [], assertions: {} };
try {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await retry(async () => {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  });
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error(`CDP ${response.status}`);
  });
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const target = await response.json();
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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: appUrl });
  await waitFor(`document.readyState === 'complete' && Boolean(window.LootLinguaNotificationStore) && typeof toggleNotificationsPanel === 'function'`, 'notification app');
  const seeded = await evaluate(fixture);
  results.assertions.initialBadge = seeded.badge === 3;
  results.assertions.initialCount = seeded.count === 3;
  await evaluate(`toggleNotificationsPanel()`);
  await delay(350);
  const opened = await evaluate(`({
    badge: window.LootLinguaNotificationStore.getUnreadCount(),
    count: window.LootLinguaNotificationStore.getDisplayRecords().length,
    panelOpen: document.getElementById('notificationsPanel').classList.contains('open'),
    ctaCount: document.querySelectorAll('.notif-cta-btn').length,
    overflow: document.documentElement.scrollWidth > innerWidth
  })`);
  results.assertions.openBadgeZero = opened.badge === 0;
  results.assertions.openListPreserved = opened.count === 3;
  results.assertions.contextualCtas = opened.ctaCount === 3;
  results.assertions.desktopNoOverflow = opened.overflow === false;
  results.screenshots.push(await screenshot('notification-center-cta-desktop.png', panelClip));
  const ctaAction = await evaluate(`(async () => {
    const record = window.LootLinguaNotificationStore.getAll().find(item => item.occurrenceKey === 'visual:reviews');
    const original = window.startNotificationWordReview;
    window.__notificationCtaSmoke = null;
    window.startNotificationWordReview = (keys, context) => {
      window.__notificationCtaSmoke = { kind: context.kind, keyCount: keys.length };
      return true;
    };
    await window.handleNotificationAction(record.id);
    window.startNotificationWordReview = original;
    return window.__notificationCtaSmoke;
  })()`);
  results.assertions.contextualCtaAction = ctaAction?.kind === 'due';

  await evaluate(`toggleNotificationsPanel()`);
  const afterNew = await evaluate(`(() => {
    const store = window.LootLinguaNotificationStore;
    const now = Date.now();
    store.upsert({ ownerId:'guest', kind:'legacy', notificationType:'progress.content.unlocked', occurrenceKey:'visual:new-after-close', status:'active', visualType:'success', title:'محتوى جديد انفتح', message:'بوابة المهمة أصبحت متاحة في رحلتك.', cta:{id:'open-unlocked-content',label:'استكشف الآن',args:{}}, createdAt:now, updatedAt:now });
    return store.getUnreadCount();
  })()`);
  results.assertions.newAfterCloseBadgeOne = afterNew === 1;
  const afterStale = await evaluate(`(() => {
    const store = window.LootLinguaNotificationStore;
    const old = store.getAll().filter(item => item.occurrenceKey.startsWith('visual:') && item.occurrenceKey !== 'visual:new-after-close').map(item => ({...item,readAt:0,read:false,updatedAt:Date.now()+1000}));
    store.mergeCloud(old);
    return store.getUnreadCount();
  })()`);
  results.assertions.staleSnapshotKeepsRead = afterStale === 1;

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
  await evaluate(`(() => {
    const entry = document.getElementById('entryExperienceRoot');
    if (entry) {
      entry.hidden = true;
      entry.setAttribute('aria-hidden', 'true');
      entry.style.setProperty('display', 'none', 'important');
    }
    document.getElementById('smartLoadingOverlay')?.style.setProperty('display', 'none', 'important');
    document.body.classList.remove('smart-loading-active', 'entry-experience-active');
    document.body.style.overflow = '';
  })()`);
  await evaluate(`toggleNotificationsPanel()`);
  await delay(300);
  const mobile = await evaluate(`({ overflow: document.documentElement.scrollWidth > innerWidth, ctaCount: document.querySelectorAll('.notif-cta-btn').length })`);
  results.assertions.mobileNoOverflow = mobile.overflow === false;
  results.assertions.mobileCtas = mobile.ctaCount === 4;
  results.screenshots.push(await screenshot('notification-center-cta-mobile.png'));

  await evaluate(`toggleNotificationsPanel()`);
  const toastProbe = await evaluate(`(async () => {
    clearTimeout(window.__toastHideTimer);
    clearTimeout(window.__toastTransitionTimer);
    window.__toastActive = null;
    window.__toastQueue = [];
    window.__entryDeferredToastQueue = [];
    const toast = document.getElementById('toastMessage');
    toast.className = 'toast-msg';
    showToast('Repeated locked gate', 'warning', 1200);
    showToast('Repeated locked gate', 'warning', 1200);
    showToast('Repeated locked gate', 'warning', 1200);
    showToast('Queued different one', 'info', 1200);
    showToast('Queued different two', 'success', 1200);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visibleRect = toast.getBoundingClientRect();
    const firstState = {
      active: window.__toastActive?.preview,
      queued: window.__toastQueue.map(entry => entry.preview),
      centeredDelta: Math.abs((visibleRect.left + (visibleRect.width / 2)) - (innerWidth / 2)),
      top: visibleRect.top,
      visible: toast.classList.contains('show'),
    };
    await new Promise(resolve => setTimeout(resolve, 1280));
    const exitRect = toast.getBoundingClientRect();
    return {
      ...firstState,
      exitedShowState: !toast.classList.contains('show'),
      exitMovedUp: exitRect.top < firstState.top,
    };
  })()`);
  results.assertions.toastDuplicateSuppressed = toastProbe.active === 'Repeated locked gate' && toastProbe.queued.length === 2;
  results.assertions.toastDifferentQueuePreserved = toastProbe.queued.join('|') === 'Queued different one|Queued different two';
  results.assertions.toastCenteredFromStart = toastProbe.visible === true && toastProbe.centeredDelta <= 1;
  results.assertions.toastExitsUpward = toastProbe.exitedShowState === true && toastProbe.exitMovedUp === true;
  results.passed = Object.values(results.assertions).every(Boolean);
  fs.writeFileSync(path.join(evidenceDir, 'matrix.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(results, null, 2));
  if (!results.passed) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch (_) {}
  browser.kill();
  server.kill();
  browser.unref();
  server.unref();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
}
