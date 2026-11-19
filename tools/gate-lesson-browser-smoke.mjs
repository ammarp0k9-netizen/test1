import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const firestoreAddress = /^127\.0\.0\.1:(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '');
assert.ok(firestoreAddress && /^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || ''),
  'Run only with loopback Auth and Firestore emulators.');
const root = path.resolve(import.meta.dirname, '..');
const browserPath = process.env.LOOTLINGUA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
assert.ok(existsSync(browserPath), 'Set LOOTLINGUA_CHROME to the local Chromium binary.');
const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, updateDoc, writeBatch, Timestamp } = await import('firebase/firestore');
await import('../js/gate-lesson.js');
const env = await initializeTestEnvironment({ projectId: 'demo-lootlingua',
  firestore: { host: '127.0.0.1', port: Number(firestoreAddress[1]) } });

const vocabulary = [
  ['squad', 'فريق', 'Our squad works together to finish the mission.'],
  ['shield', 'درع', 'Use your shield to block the attack.'],
  ['revive', 'إنعاش', 'We can revive our teammate after the fight.'],
  ['retreat', 'انسحاب', 'We must retreat before the bridge falls.'],
  ['supply', 'إمداد', 'The supply truck brings food to the camp.'],
  ['scout', 'استطلاع', 'Send a scout to check the path ahead.'],
  ['defend', 'دفاع', 'Help us defend the base from attack.'],
  ['ammo', 'ذخيرة', 'Save some ammo for the next round.'],
  ['cover', 'غطاء', 'Find cover behind the wall.'],
  ['rescue', 'إنقاذ', 'We will rescue the people in the tower.'],
  ['assist', 'مساعدة', 'You can assist your team by sharing supplies.'],
  ['signal', 'إشارة', 'Wait for the signal before you move.'],
  ['stealth', 'تخفٍّ', 'Use stealth to pass the sleeping guards.'],
  ['reload', 'إعادة تلقيم', 'Find a safe place to reload your weapon.'],
  ['shelter', 'ملجأ', 'The team found shelter from the storm.'],
  ['protect', 'حماية', 'Stay close and protect your teammate.'],
  ['gather', 'جمع', 'We should gather supplies before sunset.'],
  ['repair', 'إصلاح', 'Help repair the damaged bridge.'],
  ['escape', 'هروب', 'Find a safe route to escape the fire.'],
  ['explore', 'استكشاف', 'We can explore the island together.'],
  ['prepare', 'استعداد', 'Take a moment to prepare for the mission.'],
  ['follow', 'اتباع', 'Follow the path beside the river.'],
  ['guard', 'حراسة', 'A guard stands near the door.'],
  ['route', 'طريق', 'Choose the safest route to the camp.'],
  ['bridge', 'جسر', 'Cross the bridge one person at a time.'],
  ['camp', 'معسكر', 'The team returned to camp before dark.'],
  ['torch', 'شعلة', 'Light a torch to see inside the cave.'],
  ['rope', 'حبل', 'Use the rope to climb the wall.'],
  ['map', 'خريطة', 'Check the map before choosing a path.'],
  ['compass', 'بوصلة', 'The compass points toward the north.'],
];
const count = Number(process.env.LESSON_SMOKE_WORD_COUNT || 15);
assert.ok([1, 10, 15, 30].includes(count), 'Use a supported browser fixture size.');
const list = vocabulary.slice(0, count);
const worldId = 'lesson-ux-' + Date.now();
const rankId = 'training';
const gateId = 'field';
const staticPort = 9880 + process.pid % 100;
const testAudio = process.env.LESSON_UI_AUDIO_TEST === '1';
const sparse = process.env.LESSON_PACE_SPARSE === '1';
const stress = process.env.LESSON_PACE_FORGET === '1';
const baseline = process.env.LESSON_PACE_BASELINE_DIR;
const integration = process.env.LESSON_GUIDE_INTEGRATION === '1';
const baselineFiles = ['js/gate-lesson.js', 'js/gate-lesson-view.js', 'gate-lesson.css'];
await env.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  const batch = writeBatch(db);
  const worldPath = 'content_worlds/' + worldId;
  const rankPath = worldPath + '/ranks/' + rankId;
  const gatePath = rankPath + '/gates/' + gateId;
  const published = { status: 'published', version: 1, schemaVersion: 1, order: 0 };
  batch.set(doc(db, worldPath), { ...published, worldId, slug: worldId, title: 'عمليات الفريق',
    gateCount: 1, rankCount: 1, wordCount: list.length, interestTags: ['gaming'] });
  batch.set(doc(db, rankPath), { ...published, worldId, rankId, title: 'المستوى الأول', cefrLevel: 'A1',
    gateCount: 1, wordCount: list.length, unlockConfig: { initialStatus: 'available' } });
  const ids = list.map((_, i) => 'word-' + i);
  batch.set(doc(db, gatePath), { ...published, worldId, rankId, gateId, title: 'خطة الفريق',
    wordCount: list.length, publishedWordIds: ids, unlockConfig: { initialStatus: 'available' } });
  for (const [i, [word, translation, example]] of list.entries()) {
    batch.set(doc(db, gatePath + '/words/' + ids[i]), {
      ...published, worldId, rankId, gateId, contentWordId: ids[i], word, normalizedWord: word, wordKey: word,
      translation, order: i, normalizationVersion: 1,
      ...(sparse || i % 3 === 0 ? {} : { example }),
      ...(testAudio && i === 0 ? { audioUrl: 'http://127.0.0.1:' + staticPort + '/__lesson-qa.wav' } : {}),
    });
  }
  await batch.commit();
});

const profile = mkdtempSync(path.join(tmpdir(), 'lootlingua-lesson-'));
const debugPort = staticPort + 1000;
const base = 'http://127.0.0.1:' + staticPort;
const staticServer = spawn(process.execPath, [path.join(root, 'tools/static-server.mjs'), String(staticPort)],
  { cwd: root, stdio: 'ignore', windowsHide: true });
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--disable-gpu',
  '--disable-extensions', '--no-default-browser-check', '--remote-allow-origins=*',
  '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile, 'about:blank'],
{ stdio: 'ignore', windowsHide: true });

async function until(probe, label, timeout = 24000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await probe(); if (result) return result; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 130));
  }
  throw new Error('Timed out at ' + label);
}
const directory = process.env.LESSON_SMOKE_OUTPUT;
const checks = { browser: path.basename(browserPath), words: count, sparse, stress, baseline: Boolean(baseline) };
let socket;
let inspectPage;
let failureScreenshot;
const commandTimers = new Map();
try {
  const target = await until(async () => {
    const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
    return targets.find(item => item.type === 'page' && item.url === 'about:blank');
  }, 'browser page debugging');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let counter = 0;
  const commands = new Map();
  socket.addEventListener('message', event => {
    const row = JSON.parse(event.data);
    if (row.method === 'Runtime.exceptionThrown') console.error('Browser exception', row.params.exceptionDetails.exception?.description?.slice(0, 500));
    if (row.method === 'Fetch.requestPaused') {
      const request = new URL(row.params.request.url);
      const oldFile = baseline && request.origin === base && baselineFiles.find(file => request.pathname === '/' + file);
      if (oldFile) {
        const body = readFileSync(path.join(baseline, oldFile)).toString('base64');
        void cdp('Fetch.fulfillRequest', { requestId: row.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: oldFile.endsWith('.css') ? 'text/css' : 'application/javascript' }], body });
        return;
      }
      if (request.pathname === '/__lesson-qa.wav') {
        // A short local tone verifies the actual media pipeline independently of installed TTS voices.
        const samples = 88200;
        const clip = Buffer.alloc(44 + samples * 2);
        clip.write('RIFF'); clip.writeUInt32LE(clip.length - 8, 4); clip.write('WAVEfmt ', 8);
        clip.writeUInt32LE(16, 16); clip.writeUInt16LE(1, 20); clip.writeUInt16LE(1, 22);
        clip.writeUInt32LE(44100, 24); clip.writeUInt32LE(88200, 28);
        clip.writeUInt16LE(2, 32); clip.writeUInt16LE(16, 34); clip.write('data', 36);
        clip.writeUInt32LE(samples * 2, 40);
        for (let index = 0; index < samples; index += 1) clip.writeInt16LE(Math.sin(index / 44100 * 440 * Math.PI * 2) * 2000, 44 + index * 2);
        void cdp('Fetch.fulfillRequest', { requestId: row.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'audio/wav' }], body: clip.toString('base64') });
        return;
      }
      return;
    }
    const finish = commands.get(row.id);
    if (!finish) return;
    commands.delete(row.id);
    clearTimeout(commandTimers.get(row.id));
    commandTimers.delete(row.id);
    if (row.error) finish.reject(new Error(row.error.message));
    else finish.resolve(row.result);
  });
  function cdp(method, params = {}) {
    const id = ++counter;
    return new Promise((resolve, reject) => {
      commands.set(id, { resolve, reject });
      commandTimers.set(id, setTimeout(() => {
        commands.delete(id);
        commandTimers.delete(id);
        reject(new Error('Chrome command timed out: ' + method));
      }, 30_000));
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function run(expression) {
    const row = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (row.exceptionDetails) throw new Error(row.exceptionDetails.exception?.description || row.exceptionDetails.text);
    return row.result.value;
  }
  inspectPage = run;
  const select = value => 'document.querySelector(' + JSON.stringify(value) + ')';
  const waitFor = value => until(() => run('Boolean(' + select(value) + '?.getClientRects().length && !' + select(value) + '?.disabled)'), value);
  async function clickAudio() {
    await waitFor('.gate-lesson-audio');
    await run('void document.querySelector(".gate-lesson-audio").scrollIntoView({block:"nearest",inline:"nearest"})');
    const point = await until(() => run('(() => { const button = document.querySelector(".gate-lesson-audio");' +
      'const rect = button.getBoundingClientRect(); const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2;' +
      'return button.contains(document.elementFromPoint(x, y)) ? {x, y} : null; })()'), 'audio button is in the active viewport');
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }
  const click = selector => until(() => run(
    '(() => { const node = ' + select(selector) +
    '; if (!node?.getClientRects().length || node.disabled) return false; node.click(); return true; })()'), selector);
  async function screenshot(name) {
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    await run('Promise.all(document.querySelector(".gate-lesson-stage")?.getAnimations({subtree: true}).filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})) || [])');
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(directory, name + '.png'), Buffer.from(data, 'base64'));
  }

  failureScreenshot = screenshot;
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  const intercepted = [];
  if (testAudio) intercepted.push({ urlPattern: '*__lesson-qa.wav' });
  if (baseline) for (const file of baselineFiles) intercepted.push({ urlPattern: base + '/' + file + '*' });
  if (intercepted.length) await cdp('Fetch.enable', { patterns: intercepted });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    const appendAction = action => {
      const items = JSON.parse(sessionStorage.getItem('__qaLessonActions') || '[]');
      const stage = document.querySelector('.gate-lesson-stage');
      items.push({ action, scene: stage?.dataset.scene, phase: stage?.dataset.phase,
        wordId: stage?.dataset.wordId, at: Date.now() });
      sessionStorage.setItem('__qaLessonActions', JSON.stringify(items));
    };
    document.addEventListener('click', event => {
      const button = event.target.closest?.('.gate-lesson button');
      if (!button) return;
      let action = button.dataset.lessonAction;
      const stage = document.querySelector('.gate-lesson-stage');
      if (!action && button.matches('.gate-lesson-context-word, .gate-lesson-reveal')) {
        action = stage?.dataset.phase === 'teach' ? 'explain' : 'reveal';
      }
      if (!action && button.matches('.gate-lesson-choice')) action = 'answer';
      if (!action && button.matches('.gate-lesson-hint')) action = 'hint';
      if (!action && button.matches('.gate-lesson-next')) action = stage?.classList.contains('is-finished') ? 'finish' : 'next';
      if (button.matches('.gate-lesson-exit')) action = 'exit';
      if (button.matches('.gate-lesson-audio')) action = 'audio';
      if (action) appendAction(action);
    }, true);
    document.addEventListener('submit', event => {
      if (event.target.matches('.gate-lesson-answer-form')) appendAction('typed-answer');
    }, true);
    document.addEventListener('focusin', event => {
      if (event.target.matches('.gate-lesson-answer-input')) appendAction('input-focus');
    });

    window.__qaAudioEvents = [];
    window.__qaSpeechEvents = [];
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) {
      for (const event of ['playing', 'ended', 'error']) this.addEventListener(event, () => window.__qaAudioEvents.push(event), {once: true});
      return nativePlay.apply(this, args);
    };
    if (typeof window.speechSynthesis?.speak === 'function') {
      const nativeSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = utterance => {
        for (const event of ['start', 'end', 'error']) utterance.addEventListener(event,
          detail => window.__qaSpeechEvents.push({type: event, error: detail.error || '', word: utterance.text, lang: utterance.lang}), {once: true});
        return nativeSpeak(utterance);
      };
    }
  ` });
  if (sparse) await cdp('Page.addScriptToEvaluateOnNewDocument', { source:
    'Object.defineProperty(window, "speechSynthesis", {value: { getVoices: () => [] }, configurable:true});' });
  await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp('Page.navigate', { url: base + '/app?firebaseEmulator=1' });
  await click('[data-entry-action="continue-welcome"]');
  await click('[data-entry-theme="ocean"]');
  await click('[data-entry-action="continue-theme"]');
  await click('[data-entry-action="skip-interests"]');
  await click('[data-entry-action="discover-worlds"]');
  await until(() => run('!window.__entryExperienceActive && Boolean(document.querySelector("[data-guided-world]"))'), 'actual worlds');
  if (integration) {
    assert.equal(await run('Boolean(document.querySelector("#onboardingResume:not([hidden]), .guided-first-journey-coach"))'), false);
    checks.entryWithoutTour = true;
  }
  await click('[data-guided-world="' + worldId + '"]');
  await click('.published-first-journey-start');
  await click('[data-journey-auth="guest"]');
  await until(() => run('window.auth?.currentUser?.isAnonymous && window.auth.app.options.projectId === "demo-lootlingua"'), 'local guest');
  const primary = '.published-gate-journey .published-journey-cta';
  await click(primary);
  await waitFor('.gate-lesson-progress');
  const initialXP = await run('typeof userXP === "number" ? userXP : null');
  assert.notEqual(initialXP, null);
  await until(() => run('window.LootLinguaJourneyCloud.getGateQuizWords(' +
    [worldId, rankId, gateId].map(JSON.stringify).join(',') + ', {force: true}).then(words => words.length === ' + count + ')'), 'complete gate source linking');
  const uid = await run('window.auth.currentUser.uid');
  const readLearningEvidence = () => env.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    const [mastery, evidence, sessions] = await Promise.all([
      getDoc(doc(database, 'users', uid, 'meta', 'word_mastery')),
      getDocs(collection(database, 'users', uid, 'contentWords', 'squad', 'evidence')),
      getDocs(collection(database, 'users', uid, 'quizEvidenceSessions')),
    ]);
    return { mastery: mastery.data() || null, evidenceCount: evidence.size, quizSessions: sessions.size };
  });
  const initialEvidence = await readLearningEvidence();
  checks.voices = await run('window.speechSynthesis?.getVoices().length ?? null');
  if (testAudio) {
    await clickAudio();
    await until(() => run('window.__qaAudioEvents.includes("playing")'), 'native recorded audio started');
    {
      assert.equal(await run('document.querySelector(".gate-lesson-sound").dataset.audioState'), 'playing');
      assert.notEqual(await run('getComputedStyle(document.querySelector(".gate-lesson-wave")).display'), 'none');
      await screenshot('audio-playing-mobile');
    }
    await until(() => run('window.__qaAudioEvents.includes("ended")'), 'native recorded audio playback');
    checks.audioEvents = await run('window.__qaAudioEvents');
    assert.ok(checks.audioEvents.includes('playing'));
    {
      assert.equal(await run('document.querySelector(".gate-lesson-sound").dataset.audioState'), 'idle');
      assert.equal(await run('getComputedStyle(document.querySelector(".gate-lesson-wave")).display'), 'none');
    }
  }
  await screenshot('lesson-mobile');
  assert.ok(await run('document.querySelector(".gate-lesson").getBoundingClientRect().width <= innerWidth'));
  const pageCount = () => run('document.querySelector(".gate-lesson-progress").value');
  const captured = new Set();
  const sceneEvidence = [];
  async function pairedScreenshots(name, context = {worldId, rankId, gateId}, appearance = '') {
    const scene = await run('({ activity: document.querySelector(".gate-lesson-stage").className, count: document.querySelector(".gate-lesson-progress").value, text: document.querySelector(".gate-lesson-stage").textContent })');
    const saved = await run('(() => { const cache = JSON.parse(localStorage.getItem("lootlingua:gate-lesson:v1:" + window.auth.currentUser.uid + ' +
      JSON.stringify(':' + JSON.stringify([context.worldId, context.rankId, context.gateId])) + ')); const lesson = window.LootLinguaGateLesson;' +
      'const step = lesson.stepAt(lesson.build(cache.words, cache.state), cache.state);' +
      'return step ? {stepId: step.id, wordId: step.word.id, word: step.word.word, response: lesson.resultFor(cache.state, step) || null} : null; })()');
    for (const viewport of [{ name: 'mobile', width: 390, height: 844, mobile: true },
      { name: 'desktop', width: 1300, height: 860, mobile: false }]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height,
        deviceScaleFactor: 1, mobile: viewport.mobile });
      await until(() => run('(() => { const rect = document.querySelector(".gate-lesson").getBoundingClientRect(); return innerWidth > 760 ? rect.height < innerHeight - 30 : Math.abs(rect.height - innerHeight) < 2; })()'), 'lesson layout in ' + viewport.name, 4000);
      // Theme specimens change only the CSS attribute; profile persistence is not under test here.
      if (appearance) await run('void (document.documentElement.dataset.theme = ' + JSON.stringify(appearance) + ')');
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await screenshot(name + '-' + viewport.name);
      assert.equal(await pageCount(), scene.count);
      assert.equal(await run('document.querySelector(".gate-lesson-stage").textContent'), scene.text);
      {
        assert.ok(await run('(() => { const pane = document.querySelector(".gate-lesson").getBoundingClientRect(); return pane.top >= 0 && pane.bottom <= innerHeight + 1 && (innerWidth > 760 || pane.height >= innerHeight - 1); })()'));
        assert.ok(await run('document.querySelector(".gate-lesson").scrollWidth <= document.querySelector(".gate-lesson").clientWidth'));
        assert.equal(await run('getComputedStyle(document.querySelector(".gate-lesson-progress")).direction'), 'rtl');
        if (!viewport.mobile) {
          assert.ok(await run('document.querySelector(".gate-lesson").getBoundingClientRect().height < innerHeight - 30'));
          assert.ok(await run('(() => { const next = document.querySelector(".gate-lesson-next"); const workspace = document.querySelector(".gate-lesson-workspace"); return !next || !workspace || next.getBoundingClientRect().top - workspace.getBoundingClientRect().bottom < 72; })()'));
        }
      }
    }
    sceneEvidence.push({ name, ...scene, ...saved });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await until(() => run('innerWidth === 390 && innerHeight === 844'), 'restored the phone viewport');
  }
  async function captureActivity() {
    const kind = await run('document.querySelector(".gate-lesson-stage").classList[1]');
    const viewport = await run('innerWidth < 600 ? "mobile" : "desktop"');
    const key = viewport + '-' + kind;
    if (!captured.has(key)) {
      captured.add(key);
      await screenshot('lesson-' + key);
      if (!captured.has('pair-' + kind)) {
        captured.add('pair-' + kind);
        await pairedScreenshots('activity-' + kind);
      }
    }
  }
  const phase = () => run('document.querySelector(".gate-lesson-stage")?.dataset.phase || "finished"');
  const cacheKey = 'lootlingua:gate-lesson:v1:';
  const records = [];
  async function savedScene() {
    return run('(() => { const lesson = window.LootLinguaGateLesson; const cache = JSON.parse(localStorage.getItem(' +
      JSON.stringify(cacheKey) + ' + window.auth.currentUser.uid + ' + JSON.stringify(':' + JSON.stringify([worldId, rankId, gateId])) +
      ')); const step = lesson.stepAt(lesson.build(cache.words, cache.state), cache.state); ' +
      'const stage = document.querySelector(".gate-lesson-stage");' +
      'return { id: step?.id, word: step?.word.word, wordId: step?.word.id, expected: step && lesson.expectedFor(step),' +
      'scene: stage?.dataset.scene || step?.id, members: step?.members, gap: Boolean(step?.gap),' +
      'phase: step?.phase, practice: step?.practice, meaning: step?.word.translation, result: step && lesson.resultFor(cache.state, step),' +
      'study: cache.state.study, options: Array.from(stage?.querySelectorAll(".gate-lesson-choice") || [], node => node.textContent), ' +
      'field: step?.answerField, text: stage?.innerText }; })()');
  }

  async function openAfterReload() {
    const prior = await run('performance.timeOrigin');
    await cdp('Page.reload');
    await until(() => run('performance.timeOrigin > ' + prior), 'new document after leaving the lesson');
    await click(primary);
    await waitFor('.gate-lesson-heading');
  }

  async function submit(text) {
    const option = await run('(() => { const button = [...document.querySelectorAll(".gate-lesson-choice, .gate-lesson-word-link")].find(node => node.textContent === ' +
      JSON.stringify(text) + '); if (!button) return false; button.click(); return true; })()');
    if (option) return;
    await waitFor('.gate-lesson-answer-input');
    await run('document.querySelector(".gate-lesson-answer-input").focus()');
    await cdp('Input.insertText', { text });
    await run('document.querySelector(".gate-lesson-answer-input").form.requestSubmit()');
  }

  function actionFor(scene) {
    if (scene.result) return 'next';
    if (scene.phase === 'reinforce') return 'connect';
    if (scene.phase === 'teach') return baseline ? 'previous-teach' : 'guided-or-practice';
    if (scene.phase === 'apply' && scene.practice === 'link') return 'guided';
    if (!stress || scene.phase === 'apply') return 'answer';
    const index = Number(scene.wordId.split('-').at(-1));
    if (index % 4 === 3) return 'answer';
    return index % 2 === 0 && scene.options.some(value => value !== scene.expected) ? 'wrong' : 'reveal';
  }

  async function advance(scene) {
    const action = actionFor(scene);
    if (scene.phase === 'teach') {
      assert.equal(await run('Boolean(document.querySelector(".gate-lesson-answer-form"))'), false);
      if (baseline) {
        if (await run('Boolean(document.querySelector(".gate-lesson-context-word, .gate-lesson-reveal"))')) {
          await click('.gate-lesson-context-word, .gate-lesson-reveal');
        } else await click('.gate-lesson-next');
      } else {
        assert.ok(scene.text.includes(scene.meaning));
        const practice = await run('Boolean(document.querySelector("[data-lesson-action=practice]"))');
        if (practice) await click('[data-lesson-action=practice]');
        else await submit(scene.expected);
      }
    } else if (action === 'next' || action === 'connect') await click('.gate-lesson-next');
    else {
      if (scene.phase === 'retrieve' || scene.phase === 'retry') {
        assert.ok(scene.study.applied.includes(scene.wordId));
        const prompt = await run('document.querySelector(".gate-lesson-prompt").innerText');
        assert.equal(prompt.toLowerCase().includes(scene.expected.toLowerCase()), false);
        assert.equal(await run('Boolean(document.querySelector(".gate-lesson").querySelector(".gate-lesson-feedback, .gate-lesson-next, [aria-selected=true]"))'), false);
      }
      if (action === 'reveal') await click('.gate-lesson-reveal');
      else if (action === 'wrong') await submit(scene.options.find(value => value !== scene.expected));
      else await submit(scene.expected);
      if (action === 'wrong' || action === 'reveal') {
        assert.equal(await run('document.querySelector(".gate-lesson-feedback").dataset.response'), action === 'wrong' ? 'wrong' : 'revealed');
        assert.equal(await run('document.querySelector(".gate-lesson-answer-word").textContent'), scene.word);
        assert.equal(await run('document.querySelector(".gate-lesson-receipt") === null'), true);
      }
      if (!baseline && (action === 'answer' || action === 'guided')) {
        const outcome = action === 'guided' ? 'guided' : 'correct';
        assert.equal(await run('document.querySelector(".gate-lesson-receipt").dataset.outcome'), outcome);
      }
    }
    return action;
  }

  async function verifyGateStillLocked() {
    const context = JSON.stringify({ worldId, rankId, gateId });
    assert.equal(await run('window.LootLinguaJourneyCloud.getGateLessonAccess(' + context + ').then(result => result.allowed)'), false);
    assert.equal(await run('window.startGateQuiz("scramble", ' + context + ')'), false);
    assert.equal(await run('window.startGateGapReview(["squad"], ' + context + ')'), false);
    assert.equal(await run('window.openPublishedGatePractice(' + [worldId, rankId, gateId].map(JSON.stringify).join(',') + ')'), false);
    assert.equal(await run('window.LootLinguaGateRunner.launch(' + context + ')'), false);
    assert.equal(await run('window.LootLinguaJourneyCloud.startGateClearAttempt(' +
      [worldId, rankId, gateId].map(JSON.stringify).join(',') + ').then(() => "allowed", error => error.code)'), 'gate-clear/not-ready');
    await run('window.LootLinguaNotificationStore.upsert({ id: "qa-old-gate", ownerId: window.auth.currentUser.uid, ' +
      'notificationType: "gate.practice", cta: {id: "practice-gate", args: ' + context + '}})');
    assert.equal(await run('window.handleNotificationAction("qa-old-gate")'), false);
    await run('(() => { const card = window.LootLinguaBots.renderGate({ ...' + context +
      ', isSourceCurrent: () => true }); document.body.append(card); card.querySelector("button").click(); card.remove(); })()');
    assert.equal(await run('Boolean(window.__lootlinguaRunnerInputActive)'), false);
    assert.equal(await run('window.loadQuizView({skipResume: true})'), true);
    assert.equal(await run('startActualQuiz("scramble", {source: "personal", words: getQuizSourceWords("personal"), skipAvailabilityCheck: true})'), true);
    assert.equal(await run('serializeActiveQuizSession().source'), 'personal');
    assert.ok(await run('serializeActiveQuizSession().words.length > 0'));
    await run('resetRuntimeQuizState(); clearActiveQuizSessionStorage(); window.__pendingQuizResumeSession = null;');
    await run('window.clearActiveQuizSessionFromCloud?.()');
    await run('void window.openPublishedGate(' + [worldId, rankId, gateId].map(JSON.stringify).join(',') + ')');
    await until(() => run(select(primary) + '?.textContent.includes("أكمل تعلّم كلماتك")'), 'return after independent quiz');
    checks.independentQuizAndLockedGate = true;
  }

  if (!baseline) {
    assert.equal(await run('document.body.classList.contains("gate-lesson-active")'), true);
    await run('showToast("QA performance notice", "info", 1200)');
    assert.ok(await run('window.__entryDeferredToastQueue.some(item => item.preview === "QA performance notice")'));
    await run('showToast("QA review reminder", "warning", 1200, {notificationId:"qa-ready", persist:false})');
    assert.ok(await run('window.__entryDeferredToastQueue.some(item => item.preview === "QA review reminder")'));
    await until(() => run('!window.__toastActive && !window.__toastQueue?.length'), 'toast queue idle before the focus check');
    await run('showToast("QA saving error", "danger", 5000, {critical: true})');
    await until(() => run('document.querySelector("#toastMessage").textContent.includes("QA saving error") && getComputedStyle(document.querySelector("#toastMessage")).visibility === "visible"'), 'necessary error stays visible');
    const tree = await cdp('Accessibility.getFullAXTree');
    assert.ok(tree.nodes.some(node => !node.ignored && node.role?.value === 'dialog'));
    assert.ok(tree.nodes.some(node => !node.ignored && node.name?.value === 'QA saving error'));
    await run('document.querySelector("[data-lesson-action]").focus()');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, autoRepeat: true });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    assert.equal(await phase(), 'teach');
    for (let index = 0; index < 8; index += 1) {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', windowsVirtualKeyCode: 9 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', windowsVirtualKeyCode: 9 });
      assert.ok(await run('document.querySelector(".gate-lesson").contains(document.activeElement)'));
    }
    await run('document.querySelector("#gateLessonTitle").focus()');
    checks.keyboard = true;
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await run('document.querySelector(".gate-lesson-stage").getAnimations({subtree:true}).filter(animation => animation.playState === "running").length'), 0);
    await cdp('Emulation.setEmulatedMedia', { features: [] });
    for (const dimensions of [{ width: 320, height: 568 }, { width: 390, height: 520 }]) {
      await cdp('Emulation.setDeviceMetricsOverride', { ...dimensions, deviceScaleFactor: 1, mobile: true });
      await until(() => run('innerWidth === ' + dimensions.width), 'short viewport');
      assert.ok(await run('document.querySelector(".gate-lesson").scrollWidth <= innerWidth'));
      await screenshot('small-' + dimensions.width + '-' + dimensions.height);
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  }

  const lessonRecord = 'window.LootLinguaNotificationStore.getDisplayRecords().find(record => record.cta?.id === "resume-gate-lesson")';
  const evaluateNotices = () => run('window.LootLinguaNotificationRuntime.evaluate("foreground").then(() => true)');
  async function showReminderAfter(hours, expectedCount) {
    assert.equal(await pageCount(), expectedCount);
    await click('.gate-lesson-exit');
    const localKey = cacheKey + uid + ':' + JSON.stringify([worldId, rankId, gateId]);
    const cached = 'JSON.parse(localStorage.getItem(' + JSON.stringify(localKey) + ')).state';
    const completed = await run(cached + '.completedWordIds');
    const lessonContext = JSON.stringify({ worldId, rankId, gateId });
    const saved = await run('window.LootLinguaJourneyCloud.saveGateLessonState(' + lessonContext + ', ' + cached + ' )' +
      '.then(state => state.completedWordIds, error => ({code: error.code, message: error.message}))');
    assert.deepEqual(saved, completed, 'locally saved work is also accepted by the emulator');
    const lessonPath = ['users', uid, 'contentProgress', worldId, 'ranks', rankId, 'gates', gateId, 'lesson', 'progress'];
    const remote = await run('window.LootLinguaJourneyCloud.getGateLessonAccess(' + lessonContext + ').then(result => ' +
      '({confirmed: result.confirmed, completed: result.state?.completedWordIds}))');
    assert.equal(remote.confirmed, true);
    assert.deepEqual(remote.completed, completed);
    const activity = Date.now() - hours * 3600_000;
    await env.withSecurityRulesDisabled(context =>
      updateDoc(doc(context.firestore(), ...lessonPath), { updatedAt: Timestamp.fromMillis(activity) }));
    await run('(() => { const key = ' + JSON.stringify(localKey) + '; const local = JSON.parse(localStorage.getItem(key));' +
      ' local.activityAt = ' + activity + '; localStorage.setItem(key, JSON.stringify(local)); })()');
    await evaluateNotices();
  }
  async function captureIntegration(name, selector, theme = 'ocean', align = 'nearest') {
    for (const viewport of [{ name: 'mobile', width: 390, height: 844, mobile: true },
      { name: 'desktop', width: 1300, height: 860, mobile: false }]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height,
        deviceScaleFactor: 1, mobile: viewport.mobile });
      await until(() => run('innerWidth === ' + viewport.width), 'guide viewport ' + viewport.name);
      await run('document.documentElement.dataset.theme = ' + JSON.stringify(theme));
      await run(select(selector) + '.scrollIntoView({block:' + JSON.stringify(align) + '})');
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      assert.ok(await run('(() => { const box = ' + select(selector) + '.getBoundingClientRect(); return box.width > 0 && box.left >= -1 && box.right <= innerWidth + 1; })()'));
      await screenshot(name + '-' + viewport.name);
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await until(() => run('innerWidth === 390'), 'phone restored');
  }
  let verifiedHint = false;
  let verifiedCorrection = false;
  const networks = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  for (let i = 0; await phase() !== 'finished'; i += 1) {
    assert.ok(i < count * 8 + 8, 'No unbounded correction or navigation loop');
    let scene = await savedScene();
    assert.ok(scene.phase);
    const action = actionFor(scene);
    if (!baseline && sparse && scene.phase === 'teach') {
      assert.match(await run('document.querySelector(".gate-lesson-audio-status").textContent'), /الصوت غير متاح/);
      checks.writtenFallback = true;
    }
    if (!baseline && !sparse && scene.phase === 'teach' && scene.word === 'shield' && !checks.speechEvents) {
      await clickAudio();
      await until(() => run('window.__qaSpeechEvents.some(event => event.type === "end" || event.type === "error")'), 'native pronunciation');
      checks.speechEvents = await run('window.__qaSpeechEvents');
    }
    if (!baseline && directory) {
      const visual = scene.phase === 'teach' ? (scene.options.length ? 'guided-word' : scene.text.includes('المعنى') ? 'teach-word' : 'teach') :
        scene.phase === 'apply' ? 'context-practice' : scene.phase === 'retrieve' ?
          (scene.result ? 'retrieval-correction' : 'retrieval-station') : scene.phase === 'retry' ? 'retry-station' : null;
      if (visual && !captured.has(visual)) {
        captured.add(visual);
        await pairedScreenshots(visual);
      }
    }
    // A stress fixture checks the optional help and reload without counting
    // the hint among mandatory no-miss actions.
    if (!baseline && stress && !verifiedHint && scene.phase === 'apply' && scene.word === 'revive') {
      assert.equal(scene.text.includes(scene.meaning), false);
      await click('.gate-lesson-hint');
      await click('.gate-lesson-exit');
      await openAfterReload();
      const restored = await savedScene();
      assert.equal(restored.id, scene.id);
      assert.ok(restored.study.hinted.includes(scene.wordId));
      await submit(scene.expected);
      assert.equal(await run('document.querySelector(".gate-lesson-receipt").dataset.outcome'), 'assisted');
      verifiedHint = true;
      records.push({ ...scene, action: 'answer', after: await phase() });
      continue;
    }
    const resume = !baseline && !stress && count > 1 && scene.phase === 'retrieve' && !checks.midStationResume &&
      scene.members?.indexOf(scene.wordId) === 1;
    if (resume) await cdp('Network.emulateNetworkConditions', { ...networks, offline: true });
    await advance(scene);
    const after = await savedScene();
    records.push({ ...scene, action, after: after.phase });
    if (resume) {
      assert.equal(after.scene, scene.scene);
      assert.notEqual(after.id, scene.id);
      assert.ok(after.study.recalled.includes(scene.wordId));
      await click('.gate-lesson-exit');
      assert.equal(await run('navigator.onLine'), false);
      await cdp('Network.emulateNetworkConditions', { ...networks, offline: false });
      await verifyGateStillLocked();
      await openAfterReload();
      const resumed = await savedScene();
      for (const key of ['id', 'scene', 'members', 'options']) assert.deepEqual(resumed[key], after[key]);
      assert.ok(resumed.study.recalled.includes(scene.wordId));
      checks.midStationResume = { scene: after.scene, word: after.word, completed: await pageCount() };
      if (directory) {
        for (const theme of ['lootlingua', 'golden', 'scroll', 'glass', 'ocean']) await pairedScreenshots('theme-' + theme, undefined, theme);
        await run('applyOasisMode("dark", false)');
        await pairedScreenshots('theme-ocean-dark', undefined, 'ocean');
        await run('applyOasisMode("light", false)');
      }
    }
    if (integration && scene.phase === 'retrieve' && scene.word === 'retreat') {
      await showReminderAfter(25, 4);
      const notification = await until(() => run(lessonRecord), '24-hour lesson reminder at 4/15');
      assert.equal(notification.cta.label, 'أكمل تعلّم كلماتك');
      assert.equal(notification.context.gateId, gateId);
      assert.equal(notification.showCount, 0);
      await click('#notifBtn');
      const item = '.notif-item[data-notif-id="' + notification.id + '"]';
      await waitFor(item + ' .notif-cta-btn');
      if (directory) await captureIntegration('lesson-reminder', '#notificationsPanel');
      await click(item + ' .notif-dismiss-btn');
      await evaluateNotices();
      assert.equal(await run('Boolean(' + lessonRecord + ')'), false);
      await run('closeNotificationsPanel()');
      await click(primary);
      await waitFor('.gate-lesson-progress');
      assert.equal(await pageCount(), 4);
      checks.reminderAtFour = { dismissed: true, occurrence: notification.occurrenceKey };
    }
    if (integration && scene.phase === 'retrieve' && scene.word === 'scout') {
      await showReminderAfter(25, 6);
      const firstNotice = await until(() => run(lessonRecord), 'new reminder after further saved work');
      assert.notEqual(firstNotice.occurrenceKey, checks.reminderAtFour.occurrence);
      await evaluateNotices();
      assert.equal(await run('window.LootLinguaNotificationStore.getDisplayRecords().filter(record => record.cta?.id === "resume-gate-lesson").length'), 1);
      await click('#notifBtn');
      await click('.notif-item[data-notif-id="' + firstNotice.id + '"] .notif-cta-btn');
      await waitFor('.gate-lesson-progress');
      const restored = await savedScene();
      for (const key of ['id', 'scene', 'members', 'options']) assert.deepEqual(restored[key], after[key]);
      assert.equal(await pageCount(), 6);
      assert.equal(await run('window.LootLinguaGuide.openTopic("lesson")'), false);
      assert.equal(await run('Boolean(' + lessonRecord + ')'), false);
      checks.reminderMidStation = { word: restored.word, scene: restored.scene, completed: 6 };
    }
    if (!baseline && stress && !verifiedCorrection && (action === 'wrong' || action === 'reveal')) {
      await click('.gate-lesson-exit');
      await openAfterReload();
      assert.equal((await savedScene()).id, scene.id);
      assert.equal((await savedScene()).result, after.result);
      verifiedCorrection = true;
    }
  }
  assert.equal(await pageCount(), count);
  if (!baseline && !stress && count > 1) assert.ok(checks.midStationResume);
  if (stress) {
    assert.ok(verifiedHint && verifiedCorrection);
    const misses = new Set(records.filter(row => row.phase === 'retrieve' && ['wrong', 'reveal'].includes(row.action)).map(row => row.wordId));
    const retries = new Set(records.filter(row => row.phase === 'retry').map(row => row.wordId));
    assert.deepEqual(retries, misses);
  }
  await click('.gate-lesson-next');
  assert.equal(await run('window.auth.currentUser.uid'), uid);
  assert.deepEqual(await readLearningEvidence(), initialEvidence);
  assert.equal(await run('userXP'), initialXP);
  await env.withSecurityRulesDisabled(async context => {
    const lessons = await getDocs(collection(context.firestore(), 'users', uid, 'contentProgress', worldId, 'ranks', rankId, 'gates', gateId, 'lesson'));
    assert.equal(lessons.size, 1);
    assert.equal(lessons.docs[0].data().completedWordIds.length, count);
  });
  assert.equal(await run('document.body.classList.contains("gate-lesson-active")'), false);
  await waitFor('.published-gate-practice-cta');
  if (integration) {
    await evaluateNotices();
    assert.equal(await run('Boolean(' + lessonRecord + ')'), false);
    assert.equal(await run('Boolean(document.querySelector("#onboardingResume:not([hidden])"))'), false);
    await click('#heroAvatarBtn');
    await waitFor('#profileModal.open');
    const guide = '#lootlinguaGuide > summary';
    const topic = '#lootlinguaGuide [data-guide-topics~="search"] > summary';
    assert.equal(await run(select(guide) + '.parentElement.previousElementSibling.classList.contains("keyboard-shortcuts-btn")'), true);
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await run(select(guide) + '.focus()');
    assert.equal(await run('document.activeElement === ' + select(guide)), true);
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor('#lootlinguaGuide[open]');
    assert.equal(await run('window.LootLinguaGuide.covered("manual-meaning")'), false);
    await click(topic);
    await until(() => run('window.LootLinguaGuide.covered("manual-meaning")'), 'shared guide topic acknowledged');
    if (directory) {
      await captureIntegration('guide-ocean', '#lootlinguaGuide', 'ocean', 'start');
      await captureIntegration('guide-glass', '#lootlinguaGuide', 'glass', 'start');
    }
    const tree = await cdp('Accessibility.getFullAXTree');
    assert.ok(tree.nodes.some(node => !node.ignored && node.name?.value === 'دليل LootLingua'));
    await run('closeProfileModal(true)');
    await run('loadPersonalDictionary()');
    await until(() => run('currentView === "personal"'), 'personal dictionary after optional guide');
    await run('document.querySelector("#wordInput").focus()');
    assert.equal(await run('window.LootLinguaGuide.covered("search")'), true);
    assert.notEqual(await run('window.LootLinguaPopover.getActiveId()'), 'contextualOnboardingCoach');
    checks.guide = { keyboard: true, screenReaderTree: true, dictionaryCovered: true, completesWithoutReminder: true };
    await run('window.openPublishedGate(' + [worldId, rankId, gateId].map(JSON.stringify).join(',') + ')');
    await waitFor('.published-gate-practice-cta');
  }
  await click('.published-gate-practice-cta');
  await waitFor('#publishedGateQuizPicker');
  const events = await run('JSON.parse(sessionStorage.getItem("__qaLessonActions"))');
  const tally = (...types) => events.filter(row => types.includes(row.action)).length;
  const scenes = new Set(records.map(row => row.scene));
  const stations = new Map();
  const returns = new Map();
  for (const row of records) {
    const groups = row.phase === 'retrieve' ? stations : row.phase === 'retry' ? returns : null;
    if (!groups) continue;
    if (!groups.has(row.scene)) groups.set(row.scene, new Set());
    groups.get(row.scene).add(row.word);
  }
  const serialize = groups => [...groups].map(([id, words]) => ({ id, words: [...words] }));
  checks.metrics = {
    mainScenes: scenes.size, teachingScenes: [...scenes].filter(id => id.startsWith(baseline ? 'teach:' : 'word:')).length,
    prompts: new Set(records.map(row => row.id)).size, responses: tally('answer', 'typed-answer', 'guided', 'reveal'),
    answers: tally('answer', 'typed-answer', 'guided'), reveals: tally('reveal'), typed: tally('typed-answer'), inputFocuses: tally('input-focus'),
    confirmationClicks: tally('next'), standaloneExplanations: tally('explain'), practiceStarts: tally('practice'),
    guidedRehearsals: tally('connect'), exitToGate: tally('finish'), optionalHints: tally('hint'),
    actionsInLesson: tally('answer', 'typed-answer', 'guided', 'reveal', 'next', 'explain', 'practice', 'connect'),
    stations: serialize(stations), returns: serialize(returns),
  };
  if (!baseline && !stress && count === 15) {
    assert.equal(checks.metrics.teachingScenes, 15);
    assert.ok(checks.metrics.stations.length >= 3 && checks.metrics.stations.length <= 5);
    assert.ok(checks.metrics.actionsInLesson <= 45);
    if (integration) {
      assert.equal(checks.metrics.mainScenes, 19);
      assert.equal(checks.metrics.stations.length, 4);
      assert.equal(checks.metrics.actionsInLesson, 40);
    }
    assert.equal(checks.metrics.confirmationClicks, 0);
    assert.equal(checks.metrics.typed, 0);
  }
  checks.officialLearningStateUnchanged = true;
  if (directory) {
    writeFileSync(path.join(directory, 'scene-evidence.json'), JSON.stringify(sceneEvidence, null, 2));
    writeFileSync(path.join(directory, 'browser-checks.json'), JSON.stringify(checks, null, 2));
    writeFileSync(path.join(directory, 'journey-trace.json'), JSON.stringify({ events, records }, null, 2));
  }
  console.log('UI verification', JSON.stringify(checks));
} catch (error) {
  console.error('Completed UI checks', JSON.stringify(checks));
  await failureScreenshot?.('failure');
  if (inspectPage) console.error('Browser state', await inspectPage('({url: location.href, entry: window.__entryExperienceActive, resolved: window.__lootlinguaAuthResolved, view: typeof currentView !== "undefined" ? currentView : "unknown", geometry: { width: innerWidth, height: innerHeight, client: document.documentElement.clientWidth, desktopMedia: matchMedia("(min-width:761px)").matches, overlayHeight: document.querySelector(".gate-lesson-overlay") && getComputedStyle(document.querySelector(".gate-lesson-overlay")).height, overlayDisplay: document.querySelector(".gate-lesson-overlay") && getComputedStyle(document.querySelector(".gate-lesson-overlay")).display, lesson: document.querySelector(".gate-lesson")?.getBoundingClientRect().toJSON(), help: document.querySelector(".gate-lesson-reveal")?.getBoundingClientRect().toJSON() }, text: document.body.innerText.slice(0, 2200)})').catch(() => null));
  throw error;
} finally {
  for (const timer of commandTimers.values()) clearTimeout(timer);
  socket?.close();
  browser.kill();
  staticServer.kill();
  await env.cleanup();
}
