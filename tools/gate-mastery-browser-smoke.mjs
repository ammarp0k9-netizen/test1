import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const evidenceDir = path.join(root, 'reports', 'journey-ui-evidence');
const screenshotPrefix = String(process.env.JOURNEY_UI_SCREENSHOT_PREFIX || '').trim();
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
const appUrl = `http://127.0.0.1:${serverPort}/app`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-gate-mastery-smoke-'));
const server = spawn(process.execPath, [path.join(root, 'tools', 'static-server.mjs'), String(serverPort)], {
  cwd: root,
  stdio: 'ignore',
});
const browser = spawn(browserPath, [
  '--headless=new',
  '--no-sandbox',
  '--no-first-run',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--remote-allow-origins=*',
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

async function captureScreenshot(name) {
  if (!screenshotPrefix) return '';
  fs.mkdirSync(evidenceDir, { recursive: true });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await delay(180);
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const target = path.join(evidenceDir, `${screenshotPrefix}-${name}.png`);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  return path.relative(root, target).replaceAll('\\', '/');
}

const visualFixtureProbe = `(() => {
  window.SmartLoadingOverlay?.forceHide?.();
  document.getElementById('smartLoadingOverlay')?.remove();
  document.body.classList.remove('smart-loading-active');
  document.body.style.overflow = '';
  setPublishedPlacementMode(false);
  prepareWorldsShell();
  setPublishedTabsVisible(false);
  document.getElementById('notificationsPanel')?.classList.remove('open');
  document.getElementById('toastMessage')?.classList.remove('show');
  const world = {
    worldId: 'visual-world', title: 'عالم المغامرة',
    description: 'مفردات تساعدك على فهم المهمات والخرائط والتحديات.',
  };
  const ranks = [
    { worldId: world.worldId, rankId: 'rank-scout', title: 'المستكشف', description: 'البداية وفهم الإشارات الأساسية.', status: 'published', order: 0, version: 1, cefrLevel: 'A1', gateCount: 3, wordCount: 36, unlockConfig: { initialStatus: 'available' } },
    { worldId: world.worldId, rankId: 'rank-pathfinder', title: 'دليل الطريق', description: 'مفردات الحركة والتخطيط والتعاون.', status: 'published', order: 1, version: 1, cefrLevel: 'A1', gateCount: 5, wordCount: 68 },
    { worldId: world.worldId, rankId: 'rank-vanguard', title: 'الطليعة', description: 'تحديات أكثر عمقًا ومفردات متقدمة.', status: 'published', order: 2, version: 1, cefrLevel: 'A2', gateCount: 4, wordCount: 54 },
  ];
  const gates = [
    { worldId: world.worldId, rankId: 'rank-pathfinder', gateId: 'gate-cleared', title: 'التحرك', description: 'الاتجاهات والحركة داخل الخريطة.', status: 'published', order: 0, wordCount: 12 },
    { worldId: world.worldId, rankId: 'rank-pathfinder', gateId: 'gate-learning', title: 'العتاد', description: 'الأدوات والموارد التي تستخدمها.', status: 'published', order: 1, wordCount: 14 },
    { worldId: world.worldId, rankId: 'rank-pathfinder', gateId: 'gate-ready', title: 'الفريق', description: 'التنسيق والأدوار أثناء اللعب.', status: 'published', order: 2, wordCount: 15 },
    { worldId: world.worldId, rankId: 'rank-pathfinder', gateId: 'gate-available', title: 'المهمة', description: 'الأهداف والتعليمات والمكافآت.', status: 'published', order: 3, wordCount: 13 },
    { worldId: world.worldId, rankId: 'rank-pathfinder', gateId: 'gate-locked', title: 'المواجهة', description: 'مفردات المواجهات المتقدمة.', status: 'published', order: 4, wordCount: 14 },
  ];
  const journey = {
    worldId: world.worldId,
    activeRankId: 'rank-pathfinder',
    activeGateId: 'gate-learning',
    unlockedRankIds: ['rank-scout', 'rank-pathfinder'],
    unlockedGateIds: ['gate-cleared', 'gate-learning', 'gate-ready', 'gate-available'],
    completedRankIds: ['rank-scout'],
    rankCompletionVersions: { 'rank-scout': 1 },
  };
  const progress = new Map([
    ['gate-cleared', { worldId: world.worldId, rankId: 'rank-pathfinder', gateId: 'gate-cleared', status: 'cleared', loadedAt: Date.now(), loadedWordKeys: ['move'] }],
    ['gate-learning', { worldId: world.worldId, rankId: 'rank-pathfinder', gateId: 'gate-learning', status: 'learning', loadedAt: Date.now(), readyWordCount: 6, requiredWordCount: 14, loadedWordKeys: ['gear'] }],
    ['gate-ready', { worldId: world.worldId, rankId: 'rank-pathfinder', gateId: 'gate-ready', status: 'ready', loadedAt: Date.now(), readyWordCount: 15, requiredWordCount: 15, loadedWordKeys: ['team'] }],
  ]);
  publishedContentState.world = world;
  publishedContentState.rank = ranks[1];
  publishedContentState.gate = gates[2];
  publishedContentState.ranks = ranks;
  publishedContentState.gates = gates;
  publishedContentState.journey = journey;
  publishedContentState.activeJourney = journey;
  publishedContentState.journeyGraph = null;
  publishedContentState.gateProgressById = progress;
  publishedContentState.gateProgress = progress.get('gate-ready');
  publishedContentState.gateMasteryView = { derivedState: 'ready', gapCount: 0, gapWordKeys: [] };
  publishedContentState.levelPlacementOverviews = new Map();
  publishedContentState.newGateWords = [];
  publishedContentState.journeyAction = null;
  publishedContentState.journeyError = null;
  window.__journeyVisualFixture = { world, ranks, gates, journey, progress };
  return true;
})()`;

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
    copy: gap.textContent.includes('مكتملة — بقي 3 كلمات لإتقانها'),
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
    contentNotice: mastered.textContent.includes('وشارة إتقانك محفوظة'),
    noGapAction: !mastered.textContent.includes('راجع الكلمات المتبقية'),
  };

  publishedContentState.newGateWords = [];
  const withoutLoad = mount({
    ...loaded, loadedAt: undefined, loadedWordKeys: undefined,
    loadedContentWordIds: undefined, clearedBy: 'level-placement',
    placementClearedWithoutLoad: true,
  }, null);
  const withoutLoadResult = {
    copy: withoutLoad.textContent.includes('مكتملة باختبار المستوى — الكلمات غير مضافة'),
    noCrown: !withoutLoad.querySelector('.fa-crown'),
  };

  const ready = mount({ ...loaded, status: 'ready' }, {
    derivedState: 'ready', crownEarned: false, gapCount: 0, gapWordKeys: [],
  });
  const readyResult = {
    clearAction: ready.textContent.includes('اختبار اجتياز البوابة'),
    noCrown: !ready.querySelector('.fa-crown'),
  };
  const secondGate = {
    ...gate,
    gateId: 'smoke-gate-two',
    title: 'Gate two',
    order: 1,
  };
  const rankForProgress = { ...rank, version: 2, cefrLevel: 'A1' };
  const rankJourney = {
    worldId: world.worldId,
    activeRankId: rank.rankId,
    activeGateId: secondGate.gateId,
    unlockedRankIds: [rank.rankId],
    unlockedGateIds: [gate.gateId, secondGate.gateId],
    completedRankIds: [rank.rankId],
    rankCompletionVersions: { [rank.rankId]: 2 },
  };
  const rankProgress = new Map([
    [gate.gateId, { ...loaded, loadedWordKeys: ['one'] }],
    [secondGate.gateId, {
      ...loaded,
      gateId: secondGate.gateId,
      loadedWordKeys: ['two'],
      loadedContentWordIds: ['two'],
    }],
  ]);
  masteryByKey = new Map([
    ['one', { mastery_status: 'Mastered', mastered_once: true }],
    ['two', { mastery_status: 'Reviewing', mastered_once: false }],
  ]);
  const completedRank = publishedRankProgressView(
    rankForProgress,
    [gate, secondGate],
    rankJourney,
    rankProgress,
    [rankForProgress]
  );
  renderPublishedGates(
    world,
    rankForProgress,
    [gate, secondGate],
    [rankForProgress],
    rankJourney,
    rankJourney,
    rankProgress
  );
  const completedBanner = document.querySelector('.published-rank-achievement');
  const rankCompletedResult = {
    completed: completedRank.completed === true,
    notMastered: completedRank.mastered === false,
    banner: Boolean(completedBanner),
    trophy: Boolean(completedBanner?.querySelector('.fa-trophy')),
    noCrown: !completedBanner?.querySelector('.fa-crown'),
  };

  masteryByKey.set('two', { mastery_status: 'Mastered', mastered_once: true });
  const masteredRank = publishedRankProgressView(
    rankForProgress,
    [gate, secondGate],
    rankJourney,
    rankProgress,
    [rankForProgress]
  );
  renderPublishedGates(
    world,
    rankForProgress,
    [gate, secondGate],
    [rankForProgress],
    rankJourney,
    rankJourney,
    rankProgress
  );
  const masteredBanner = document.querySelector('.published-rank-achievement');
  const rankMasteredResult = {
    mastered: masteredRank.mastered === true,
    banner: masteredBanner?.classList.contains('is-mastered') === true,
    crown: Boolean(masteredBanner?.querySelector('.fa-crown')),
  };

  const changedRank = { ...rankForProgress, version: 3 };
  const changedRankView = publishedRankProgressView(
    changedRank,
    [gate, secondGate, { ...gate, gateId: 'new-gate', order: 2 }],
    rankJourney,
    rankProgress,
    [changedRank]
  );
  const newContentResult = {
    completedPreserved: changedRankView.completed === true,
    newContent: changedRankView.hasNewContent === true,
    masteryRevokedForCurrentSet: changedRankView.mastered === false,
  };

  let confettiCount = 0;
  const resolverCalls = [];
  window.launchConfetti = () => { confettiCount += 1; };
  window.getJourneyCloudApi = () => ({
    resolveActiveJourneyDestination: (worldId, options) => {
      resolverCalls.push({ worldId, options: { ...options } });
      return Promise.resolve({ type: 'completed-current-content' });
    },
  });
  window.openPublishedWorld = () => {};
  const completionBundle = {
    attempt: {
      attemptId: 'rank-smoke-attempt',
      correctCount: 2,
      totalCount: 2,
    },
    result: {
      result: { passed: true },
      rankCompleted: true,
      completedCurrentContent: true,
      rankCompletionVersion: 2,
    },
  };
  renderPublishedGateClearResult(world, rankForProgress, secondGate, completionBundle);
  renderPublishedGateClearResult(world, rankForProgress, secondGate, completionBundle);
  const resultPanel = document.querySelector('.published-placement-result');
  resultPanel?.querySelector('.published-placement-primary')?.click();
  const rankCelebrationResult = {
    panel: Boolean(resultPanel),
    trophy: Boolean(resultPanel?.querySelector('.fa-trophy')),
    oncePerCommit: confettiCount === 1,
    resolverAuthority: resolverCalls.length === 1 &&
      resolverCalls[0].worldId === world.worldId &&
      resolverCalls[0].options.resumePausedLevelPlacement === true,
  };

  confettiCount = 0;
  const resolverCountBeforeWorld = resolverCalls.length;
  const worldCompletionBundle = {
    ...completionBundle,
    attempt: { ...completionBundle.attempt, attemptId: 'world-smoke-attempt' },
    result: {
      ...completionBundle.result,
      worldCompleted: true,
      worldCompletionRecorded: true,
      worldCompletionId: 'wc1-smoke-world',
    },
  };
  renderPublishedGateClearResult(world, rankForProgress, secondGate, worldCompletionBundle);
  renderPublishedGateClearResult(world, rankForProgress, secondGate, worldCompletionBundle);
  const worldResultPanel = document.querySelector('.published-placement-result');
  worldResultPanel?.querySelector('.published-placement-primary')?.click();
  const worldNotification = (window.LootLinguaNotificationStore?.getAll?.() || window.__notifications || []).find((item) =>
    item.occurrenceKey === 'legacy:wc1-smoke-world' || item.meta?.dedupeKey === 'wc1-smoke-world'
  );
  const worldCompletionResult = {
    panel: worldResultPanel?.textContent.includes('اكتمل عالم') === true,
    globe: Boolean(worldResultPanel?.querySelector('.fa-earth-americas')),
    oncePerCommit: confettiCount === 1,
    permanentNotification: Boolean(worldNotification?.message || worldNotification?.msg),
    resolverAuthority: resolverCalls.length === resolverCountBeforeWorld + 1,
  };

  clearTimeout(window.__toastHideTimer);
  clearTimeout(window.__toastTransitionTimer);
  window.__toastActive = null;
  window.__toastQueue = [];
  document.getElementById('toastMessage')?.classList.remove('show');
  const longToast = 'This is a deliberately long multi-result browser smoke message. It must remain complete in the notification center and expose exact details.';
  const exactNotificationId = showToast(longToast, 'warning', 8000, {
    persist: true,
    importance: 'multi-result',
    resultCount: 3,
    dedupeKey: 'browser-smoke:toast-details',
  });
  showToast('queued-one', 'info', 2000);
  showToast('queued-two', 'success', 2000);
  const toastHost = document.getElementById('toastHost');
  const toastMessage = document.getElementById('toastMessage');
  const layerValues = [
    document.getElementById('profileModal'),
    document.getElementById('customWorldModal'),
    document.getElementById('deleteModal'),
    document.getElementById('notificationsPanel'),
  ].map((element) => Number.parseInt(getComputedStyle(element).zIndex, 10) || 0);
  toastMessage?.querySelector('.toast-details-btn')?.click();
  const exactItem = document.querySelector('.notif-item[data-notif-id="' + exactNotificationId + '"]');
  const toastLayerResult = {
    rootHost: toastHost?.parentElement === document.body,
    aboveAppLayers: Number.parseInt(getComputedStyle(toastHost).zIndex, 10) > Math.max(...layerValues),
    passiveHost: getComputedStyle(toastHost).pointerEvents === 'none',
    actionableToast: getComputedStyle(toastMessage).pointerEvents === 'auto',
    exactDetails: document.getElementById('notificationsPanel')?.classList.contains('open') === true &&
      exactItem?.classList.contains('notif-expanded') === true &&
      exactItem?.textContent.includes(longToast) === true,
    queueOrder: window.__toastQueue.map((item) => item.preview).join('|') === 'queued-one|queued-two',
    mobileViewport: window.innerWidth === 390,
  };

  window.launchConfetti = () => { throw new Error('animation unavailable'); };
  let animationIsolated = true;
  try {
    renderPublishedGateClearResult(world, rankForProgress, secondGate, {
      ...completionBundle,
      attempt: { ...completionBundle.attempt, attemptId: 'rank-smoke-animation-failure' },
    });
  } catch {
    animationIsolated = false;
  }
  const failureIsolationResult = {
    animationIsolated,
    resultStillVisible: Boolean(document.querySelector('.published-placement-result')),
  };

  return {
    gapResult,
    masteredResult,
    withoutLoadResult,
    readyResult,
    rankCompletedResult,
    rankMasteredResult,
    newContentResult,
    rankCelebrationResult,
    worldCompletionResult,
    toastLayerResult,
    failureIsolationResult,
  };
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
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
  if (screenshotPrefix) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Runtime.evaluate', { expression: visualFixtureProbe });
    await send('Runtime.evaluate', {
      expression: `(() => {
        const fixture = window.__journeyVisualFixture;
        publishedContentState.route = { key: 'world', params: { worldId: fixture.world.worldId } };
        renderPublishedRanks(fixture.world, fixture.ranks, fixture.journey, fixture.journey);
        window.scrollTo(0, 0);
      })()`,
    });
    await captureScreenshot('world-ranks-desktop');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const fixture = window.__journeyVisualFixture;
        publishedContentState.route = { key: 'rank', params: { worldId: fixture.world.worldId, rankId: fixture.ranks[1].rankId } };
        renderPublishedGates(fixture.world, fixture.ranks[1], fixture.gates, fixture.ranks, fixture.journey, fixture.journey, fixture.progress);
        window.scrollTo(0, 0);
      })()`,
    });
    await captureScreenshot('rank-gates-desktop');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const fixture = window.__journeyVisualFixture;
        publishedContentState.route = { key: 'gate', params: { worldId: fixture.world.worldId, rankId: fixture.ranks[1].rankId, gateId: fixture.gates[2].gateId } };
        const snapshot = {
          currentPageIndex: 0,
          pageSize: 25,
          currentPage: {
            items: [
              { contentWordId: 'squad', word: 'squad', translation: 'فريق', level: 'A1', partOfSpeech: 'noun' },
              { contentWordId: 'revive', word: 'revive', translation: 'ينقذ زميلًا', level: 'A1', partOfSpeech: 'verb' },
              { contentWordId: 'cover', word: 'cover', translation: 'غطاء أو حماية', level: 'A1', partOfSpeech: 'noun' },
            ],
            hasNext: false,
            hasPrevious: false,
          },
        };
        renderPublishedGateWords(fixture.world, fixture.ranks[1], fixture.gates[2], snapshot);
        window.scrollTo(0, 0);
      })()`,
    });
    await captureScreenshot('gate-ready-desktop');

    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await send('Runtime.evaluate', { expression: visualFixtureProbe });
      await send('Runtime.evaluate', {
        expression: `(() => {
          const fixture = window.__journeyVisualFixture;
          publishedContentState.route = { key: 'rank', params: { worldId: fixture.world.worldId, rankId: fixture.ranks[1].rankId } };
          renderPublishedGates(fixture.world, fixture.ranks[1], fixture.gates, fixture.ranks, fixture.journey, fixture.journey, fixture.progress);
          window.scrollTo(0, 0);
        })()`,
      });
      await captureScreenshot(`rank-gates-${viewport.width}`);
      await send('Runtime.evaluate', {
        expression: `(() => {
          const fixture = window.__journeyVisualFixture;
          publishedContentState.route = { key: 'gate', params: { worldId: fixture.world.worldId, rankId: fixture.ranks[1].rankId, gateId: fixture.gates[2].gateId } };
          const snapshot = {
            currentPageIndex: 0,
            pageSize: 25,
            currentPage: {
              items: [{ contentWordId: 'squad', word: 'squad', translation: 'فريق', level: 'A1', partOfSpeech: 'noun' }],
              hasNext: false,
              hasPrevious: false,
            },
          };
          renderPublishedGateWords(fixture.world, fixture.ranks[1], fixture.gates[2], snapshot);
          window.scrollTo(0, 0);
        })()`,
      });
      const mobileLayout = await send('Runtime.evaluate', {
        expression: `(() => ({
          noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
          selectVisible: getComputedStyle(document.querySelector('.published-gate-switcher-select')).display !== 'none',
          railHidden: getComputedStyle(document.querySelector('.published-gate-switcher-rail')).display === 'none'
        }))()`,
        returnByValue: true,
      });
      if (!Object.values(mobileLayout.result?.value || {}).every(Boolean)) {
        process.exitCode = 1;
        console.error(`Mobile gate layout failed at ${viewport.width}px`, mobileLayout.result?.value);
      }
      await captureScreenshot(`gate-ready-${viewport.width}`);
    }
  }
} finally {
  try { socket?.close(); } catch {}
  browser.kill();
  server.kill();
  browser.unref();
  server.unref();
}
