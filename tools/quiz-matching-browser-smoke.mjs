import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocketClient from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const evidenceDir = path.join(root, 'reports', 'quiz-matching-evidence');
const browserPath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => fs.existsSync(candidate));
if (!browserPath) throw new Error('Chrome/Edge not found');

const offset = (process.pid + 917) % 350;
const serverPort = 9700 + offset;
const debugPort = 10700 + offset;
const appUrl = `http://127.0.0.1:${serverPort}/app?quiz-matching-smoke=1`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lootlingua-quiz-matching-'));
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
async function retry(operation, attempts = 70, waitMs = 180) {
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
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10_000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function waitFor(expression, label, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(expression)) return; } catch (_) {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function screenshot(name, clipExpression = '') {
  const clip = clipExpression ? await evaluate(clipExpression) : null;
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  const target = path.join(evidenceDir, name);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  return path.relative(root, target).replaceAll('\\', '/');
}

const fixture = `(() => {
  window.SmartLoadingOverlay?.forceHide?.();
  const overlay = document.getElementById('smartLoadingOverlay');
  if (overlay) overlay.style.setProperty('display', 'none', 'important');
  const entry = document.getElementById('entryExperienceRoot');
  if (entry) entry.style.setProperty('display', 'none', 'important');
  const toast = document.getElementById('toastMessage');
  if (toast) toast.style.setProperty('display', 'none', 'important');
  document.body.classList.remove('smart-loading-active', 'entry-experience-active');
  document.body.style.overflow = '';
  window.unlockedFeatures = new Set(['personal', 'stats', 'starred', 'treasure', 'quiz']);
  const meanings = ['غنيمة', 'خريطة', 'كنز', 'مغامرة', 'بوابة', 'درع', 'سيف', 'جوهرة', 'قلعة', 'رحلة'];
  const terms = ['loot', 'map', 'treasure', 'adventure', 'portal', 'shield', 'sword', 'gem', 'castle', 'journey'];
  const words = terms.map((word, index) => ({
    id: 'matching-' + (index + 1),
    word,
    meaning: meanings[index],
    translation: meanings[index],
    example: 'A clear example for ' + word + '.',
    createdAt: new Date(Date.now() - index * 86400000).toISOString(),
    personalDictionaryState: 'active',
    mastery_status: index < 4 ? 'Reviewing' : 'New',
    mastery_streak: index < 4 ? 2 : 0,
    quiz_seen_count: index < 4 ? 4 : 0,
    forgetCount: index < 2 ? 1 : 0,
  }));
  localStorage.removeItem('active_quiz_session');
  const sevenWords = words.slice(0, 7);
  writeWordsToStorage(sevenWords, 'normal', 'guest');
  window.words = sevenWords;
  window.loadQuizView({ skipResume: true });
  openQuizModeSettings('matching');
  setQuizQuestionCount('10', document.querySelector('[data-quiz-count="10"]'));
  const sevenState = {
    pickerCount: resolveQuizSourceSnapshot('personal', { mode: 'matching' }).candidateCount,
    finalCandidateCount: getQuizSourceWords('personal', { mode: 'matching' }).length,
    startBlocked: document.getElementById('quizStartButton').disabled,
    summaryShowsSeven: document.getElementById('quizSettingsSummary').textContent.includes('7'),
  };
  writeWordsToStorage(words, 'normal', 'guest');
  window.words = words;
  refreshQuizAvailableCount();
  refreshQuizSettingsSummary();
  return { count: words.length, sevenState };
})()`;

const quizClip = `(() => {
  const rect = document.getElementById('quizMatchingView').getBoundingClientRect();
  const x = Math.max(0, rect.left - 24);
  const y = Math.max(0, rect.top - 18);
  return {
    x,
    y,
    width: Math.min(innerWidth - x, rect.width + 48),
    height: Math.min(innerHeight - y, rect.height + 36)
  };
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: appUrl });
  await waitFor(
    `document.readyState === 'complete' && Boolean(window.LootLinguaQuizCore) && typeof window.loadQuizView === 'function' && typeof startConfiguredQuiz === 'function'`,
    'quiz runtime',
  );
  const seeded = await evaluate(fixture);
  results.assertions.fixtureCount = seeded.count === 10;
  results.assertions.minimumSevenCountVisible = seeded.sevenState.pickerCount === 7 && seeded.sevenState.finalCandidateCount === 7 && seeded.sevenState.summaryShowsSeven;
  results.assertions.minimumSevenStartBlocked = seeded.sevenState.startBlocked === true;
  const start = await evaluate(`startConfiguredQuiz()`);
  results.assertions.configuredStart = start === true;
  await waitFor(`getComputedStyle(document.getElementById('quizMatchingView')).display !== 'none' && document.querySelectorAll('#matchingWords .matching-option').length === 5`, 'matching board');

  const paired = await evaluate(`(() => {
    const board = quizCore.currentMatchingBoard(matchingQuizState);
    const ids = board.wordIds;
    ids.forEach((wordId, index) => {
      const meaningId = index === 1 ? ids[2] : index === 2 ? ids[1] : wordId;
      quizCore.assignMatchingPair(matchingQuizState, wordId, meaningId);
    });
    renderMatchingBoard();
    return {
      phase: board.phase,
      pairCount: Object.keys(board.selections).length,
      checkEnabled: !document.getElementById('matchingCheckButton').disabled,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  results.assertions.desktopAllPairsVisible = paired.pairCount === 5 && paired.checkEnabled;
  results.assertions.desktopNoHorizontalOverflow = paired.horizontalOverflow === false;
  results.screenshots.push(await screenshot('matching-desktop.png', quizClip));

  const checked = await evaluate(`(() => {
    submitMatchingAnswers();
    const board = quizCore.currentMatchingBoard(matchingQuizState);
    return {
      phase: board.phase,
      resultCount: quizSessionResults.length,
      correctCount: quizSessionResults.filter(item => item.correct).length,
      incorrectCount: quizSessionResults.filter(item => !item.correct).length,
      lockedCount: document.querySelectorAll('#matchingBoard .is-locked').length,
    };
  })()`);
  results.assertions.firstAttemptEvidence = checked.phase === 'correction' && checked.resultCount === 5 && checked.correctCount === 3 && checked.incorrectCount === 2;
  results.assertions.correctPairsLock = checked.lockedCount >= 6;

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });
  await delay(250);
  await evaluate(`document.getElementById('toastMessage')?.style.setProperty('display', 'none', 'important')`);
  const mobile = await evaluate(`({
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    phase: quizCore.currentMatchingBoard(matchingQuizState).phase,
    wrongOptions: document.querySelectorAll('#matchingBoard .is-incorrect').length,
    visible: getComputedStyle(document.getElementById('quizMatchingView')).display !== 'none'
  })`);
  results.assertions.mobileCorrectionVisible = mobile.visible && mobile.phase === 'correction' && mobile.wrongOptions >= 2;
  results.assertions.mobileNoHorizontalOverflow = mobile.horizontalOverflow === false;
  results.screenshots.push(await screenshot('matching-mobile-correction.png', quizClip));

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
