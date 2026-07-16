import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browserPath = browserCandidates.find(candidate => fs.existsSync(candidate));
if (!browserPath) throw new Error('Chrome/Edge not found');

const serverPort = 8765;
const debugPort = 9223;
const appUrl = `http://127.0.0.1:${serverPort}/`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-smoke-'));
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'refactor-baseline.json'), 'utf8'));
const requiredGlobals = baseline.inlineHandlers.requiredGlobals;

const server = spawn(process.execPath, [path.join(root, 'tools', 'static-server.mjs'), String(serverPort)], {
  cwd: root,
  stdio: 'ignore',
});
const browser = spawn(browserPath, [
  '--headless=new',
  '--no-first-run',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retry(operation, attempts = 40, waitMs = 250) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try { return await operation(); }
    catch (error) { lastError = error; await delay(waitMs); }
  }
  throw lastError;
}

let socket;
let nextId = 1;
const pending = new Map();
const exceptions = [];
const errorLogs = [];

function send(method, params = {}) {
  const request = new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return Promise.race([
    request,
    delay(5000).then(() => { throw new Error(`CDP command timeout: ${method}`); }),
  ]);
}

try {
  console.log('smoke: waiting for local server');
  await retry(async () => {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  });
  console.log('smoke: waiting for browser debugging endpoint');
  await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) throw new Error(`CDP ${response.status}`);
    return response.json();
  });
  console.log('smoke: creating browser target');
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(appUrl)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(2000),
  });
  if (!targetResponse.ok) throw new Error(`Unable to create browser target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await Promise.race([new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  }), delay(3000).then(() => { throw new Error('WebSocket open timeout'); })]);
  console.log('smoke: target connected');
  socket.addEventListener('message', async event => {
    let raw = event.data;
    if (typeof raw !== 'string') {
      raw = typeof raw?.text === 'function' ? await raw.text() : Buffer.from(raw).toString('utf8');
    }
    const message = JSON.parse(raw);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Unknown exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') {
      errorLogs.push(message.params.entry.text);
    }
  });
  await Promise.all([send('Runtime.enable'), send('Page.enable'), send('Log.enable')]);
  await send('Page.navigate', { url: appUrl });
  console.log('smoke: page navigating');
  await delay(10000);
  const expression = `(() => {
    const required = ${JSON.stringify(requiredGlobals)};
    const cloudFunctions = ['login', 'confirmLogout', 'saveWordToCloud', 'updateWordInCloud', 'deleteWordFromCloud', 'saveCustomWorldToCloud', 'saveCustomWorldWordToCloud', 'claimXPEventInCloud', 'saveProfileToCloud', 'loadProfileFromCloud'];
    let behaviorInvariants = null;
    let viewNavigation = null;
    let quizProbe = null;
    let themeProbe = null;
    try {
      const day = 24 * 60 * 60 * 1000;
      const now = Date.now();
      let probe = { word: '__lootlingua_refactor_srs_probe__', xpEconomyVersion: XP_ECONOMY_VERSION };
      const first = computeSrsUpdate(probe, true, 'audit-s1', now - (4 * day));
      probe = { word: probe.word, ...first.state };
      const second = computeSrsUpdate(probe, true, 'audit-s2', now - (3 * day));
      probe = { word: probe.word, ...second.state };
      const third = computeSrsUpdate(probe, true, 'audit-s3', now);
      behaviorInvariants = {
        xpRewards: { ...XP_REWARDS },
        srsStatuses: [first.nextStatus, second.nextStatus, third.nextStatus],
        srsTransitions: [first.transition, second.transition, third.transition],
      };
    } catch (error) {
      behaviorInvariants = { error: String(error?.stack || error) };
    }
    try {
      const navigationXP = userXP;
      const navigationStoredXP = localStorage.getItem('userXP');
      userXP = Math.max(userXP, 2000);
      localStorage.setItem('userXP', String(Math.max(Number(navigationStoredXP) || 0, 2000)));
      refreshFeatureUnlockUI();
      loadWorldsView();
      const worldsReady = currentView === 'worlds' && getComputedStyle(document.getElementById('worldsView')).display !== 'none';
      loadGameDictionary('minecraft');
      const gameReady = currentView === 'minecraft';
      goBackFromSubView();
      const backReady = currentView === 'worlds';
      loadPersonalDictionary();
      const personalReady = currentView === 'personal' && getComputedStyle(document.getElementById('personalControls')).display !== 'none';
      userXP = navigationXP;
      if (navigationStoredXP === null) localStorage.removeItem('userXP');
      else localStorage.setItem('userXP', navigationStoredXP);
      refreshFeatureUnlockUI();
      viewNavigation = { worldsReady, gameReady, backReady, personalReady };
    } catch (error) {
      viewNavigation = { error: String(error?.stack || error) };
    }
    try {
      const originalWords = window.words;
      const originalStoredWords = readWordsFromStorage('normal');
      const originalXP = userXP;
      const probeWords = Array.from({ length: 10 }, (_, index) => ({
        id: '__audit_quiz_' + index,
        word: 'auditword' + index,
        meaning: 'معنى تجريبي ' + index,
        example: 'Audit example ' + index,
        createdAt: new Date(Date.now() - index * 60000).toISOString(),
        forgetCount: index % 3,
        starred: index < 3,
        xpEconomyVersion: XP_ECONOMY_VERSION,
      }));
      window.words = probeWords;
      writeWordsToStorage(probeWords, 'normal');
      currentQuizSource = 'personal';
      const deck5 = buildSmartQuizDeck(probeWords, 5, { random: () => 0.25 });
      const deck10 = buildSmartQuizDeck(probeWords, 10, { random: () => 0.25 });

      loadQuizView();
      startActualQuiz('flashcards');
      const flashcardsReady = getComputedStyle(document.getElementById('quizViewCard')).display !== 'none';
      markRemember();
      const flashcardsNoXP = userXP === originalXP;

      resetRuntimeQuizState();
      startActualQuiz('timeAttack');
      const timeAttackReady = getComputedStyle(document.getElementById('quizTimeAttackView')).display !== 'none';
      const serialized = serializeActiveQuizSession();
      const resumeIdsBefore = serialized?.words?.map(word => String(word.id)) || [];
      stopTimeAttackTimer();
      resetRuntimeQuizState();
      applyStoredQuizSession(serialized);
      const resumeIdsAfter = currentQuizWords.map(word => String(word.id));
      const resumeStable = JSON.stringify(resumeIdsBefore) === JSON.stringify(resumeIdsAfter);
      stopTimeAttackTimer();

      resetRuntimeQuizState();
      startActualQuiz('scramble');
      const scrambleReady = getComputedStyle(document.getElementById('quizScrambleView')).display !== 'none';
      resetRuntimeQuizState();
      localStorage.removeItem(ACTIVE_QUIZ_SESSION_KEY);
      writeWordsToStorage(originalStoredWords, 'normal');
      window.words = originalWords;
      loadPersonalDictionary();
      quizProbe = {
        deck5: deck5.length,
        deck10: deck10.length,
        flashcardsReady,
        flashcardsNoXP,
        timeAttackReady,
        scrambleReady,
        resumeStable,
      };
    } catch (error) {
      quizProbe = { error: String(error?.stack || error) };
    }
    try {
      const originalTheme = localStorage.getItem('theme') || 'lootlingua';
      const themeXP = userXP;
      userXP = Math.max(userXP, 2000);
      refreshThemeLockUI();
      const availableThemes = ['lootlingua', 'golden', 'scroll', 'ocean'];
      const applied = availableThemes.map(theme => {
        setTheme(theme, true);
        return document.documentElement.getAttribute('data-theme') === theme;
      });
      userXP = themeXP;
      setTheme(originalTheme, true);
      refreshThemeLockUI();
      themeProbe = { availableThemesApplied: applied.every(Boolean), count: applied.length };
    } catch (error) {
      themeProbe = { error: String(error?.stack || error) };
    }
    return {
      readyState: document.readyState,
      title: document.title,
      hasMainContent: Boolean(document.querySelector('.main-content')),
      overlayPresent: Boolean(document.getElementById('smartLoadingOverlay')),
      missingHandlerGlobals: required.filter(name => typeof window[name] !== 'function'),
      firebaseReady: Boolean(window.auth && window.db),
      missingCloudFunctions: cloudFunctions.filter(name => typeof window[name] !== 'function'),
      behaviorInvariants,
      viewNavigation,
      quizProbe,
      themeProbe,
      scriptSources: Array.from(document.scripts).map(s => ({ type: s.type || 'classic', src: s.getAttribute('src') || 'inline' })),
    };
  })()`;
  const evaluation = await send('Runtime.evaluate', { expression, returnByValue: true });
  const result = evaluation.result?.value;
  const summary = { result, exceptions, errorLogs };
  console.log(JSON.stringify(summary, null, 2));
  const expectedBehavior = JSON.stringify({
    xpRewards: { newToLearning: 2, learningToReviewing: 4, reviewingToMastered: 8, remastered: 3 },
    srsStatuses: ['Learning', 'Reviewing', 'Mastered'],
    srsTransitions: ['new_learning', 'learning_reviewing', 'reviewing_mastered'],
  });
  const quizProbePassed = result?.quizProbe?.deck5 === 5 &&
    result?.quizProbe?.deck10 === 10 &&
    result?.quizProbe?.flashcardsReady === true &&
    result?.quizProbe?.flashcardsNoXP === true &&
    result?.quizProbe?.timeAttackReady === true &&
    result?.quizProbe?.scrambleReady === true &&
    result?.quizProbe?.resumeStable === true;
  if (!result?.hasMainContent || result?.readyState !== 'complete' || !result?.firebaseReady || result?.missingHandlerGlobals?.length || result?.missingCloudFunctions?.length || JSON.stringify(result?.behaviorInvariants) !== expectedBehavior || result?.viewNavigation?.worldsReady !== true || result?.viewNavigation?.gameReady !== true || result?.viewNavigation?.backReady !== true || result?.viewNavigation?.personalReady !== true || !quizProbePassed || result?.themeProbe?.availableThemesApplied !== true || exceptions.length) {
    process.exitCode = 1;
  }
} finally {
  try { socket?.close(); } catch {}
  browser.kill();
  server.kill();
  browser.unref();
  server.unref();
}
