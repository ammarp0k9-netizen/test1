/* Gate Runner: cosmetic only; it never changes SRS, XP, Gate Clear, or progress. */
(function () {
  'use strict';
  const MAX_HEARTS = 3, COIN_KEY = 'lootlingua.runner.coins.v1', BEST_DISTANCE_KEY = 'lootlingua.runner.best-distance.v1';
  const accountProgressKey = (uid, field) => `lootlingua.runner.progress.v1:user:${encodeURIComponent(uid)}:${field}`;
  function progressValue(field, guestKey) {
    try {
      const uid = window.auth?.currentUser?.uid;
      return Math.max(0, Number(localStorage.getItem(uid ? accountProgressKey(uid, field) : guestKey)) || 0);
    } catch { return 0; }
  }
  function refreshProgressUI() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-runner-wallet]').forEach(el => { el.textContent = String(RunnerCoinWallet.balance()); });
    document.querySelectorAll('[data-runner-best]').forEach(el => { el.textContent = String(RunnerBestDistance.value()); });
  }
  function acceptProfile(profile, uid) {
    if (!uid || window.auth?.currentUser?.uid !== uid) return;
    localStorage.setItem(accountProgressKey(uid, 'runnerCoins'), String(Math.max(0, Number(profile?.runnerCoins) || 0)));
    localStorage.setItem(accountProgressKey(uid, 'runnerBestDistance'), String(Math.max(0, Number(profile?.runnerBestDistance) || 0)));
    refreshProgressUI();
  }
  function normalizeWords(words) { const seen = new Set(); return (Array.isArray(words) ? words : []).map((x) => ({ word: String(x?.word || x?.term || '').trim(), meaning: String(x?.translation || x?.meaning || x?.ar || x?.definition || '').trim() })).filter((x) => x.word && x.meaning && !seen.has(`${x.word}\u0000${x.meaning}`) && seen.add(`${x.word}\u0000${x.meaning}`)); }
  const RunnerCoinWallet = Object.freeze({ balance() { return progressValue('runnerCoins', COIN_KEY); }, credit(amount, eventId) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (!value) return;
    if (window.auth?.currentUser) {
      if (typeof window.commitProfileIntent !== 'function') return;
      return window.commitProfileIntent({ type: 'wallet-delta', field: 'runnerCoins', amount: value,
        eventId: eventId || window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }).catch(error => {
          console.warn('[Runner] Coin synchronization pending', error?.message || error);
          return { saved: false, applied: false };
        });
    }
    try { localStorage.setItem(COIN_KEY, String(this.balance() + value)); window.markGuestProfileDataDirty?.(COIN_KEY); refreshProgressUI(); } catch {}
  } });
  const RunnerBestDistance = Object.freeze({ value() { return Math.floor(progressValue('runnerBestDistance', BEST_DISTANCE_KEY)); }, save(distance) {
    const next = Math.max(0, Math.floor(Number(distance) || 0));
    if (next <= this.value()) return false;
    try {
      if (window.auth?.currentUser) {
        if (!window.queueProfileIntent?.({ type: 'max', field: 'runnerBestDistance', value: next })) return false;
        const key = accountProgressKey(window.auth.currentUser.uid, 'runnerBestDistance');
        localStorage.setItem(key, String(Math.max(next, Number(localStorage.getItem(key)) || 0)));
      }
      localStorage.setItem(BEST_DISTANCE_KEY, String(next));
      refreshProgressUI();
    } catch { return false; }
    return true;
  } });
  function captureRunnerOwner() { return { uid: window.auth?.currentUser?.uid || '', generation: Number(window.__lootlinguaAuthGeneration) || 0 }; }
  function runnerOwnerCurrent(owner) { return owner.uid === (window.auth?.currentUser?.uid || '') && owner.generation === (Number(window.__lootlinguaAuthGeneration) || 0); }
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  function reviewIsDue(progress, now = window.LootLinguaTestClock?.effectiveNow?.() ?? Date.now()) {
    if (progress?.status && progress.status !== 'learning') return false;
    const due = Array.from(new Set((progress?.runnerReviewDueWordKeys || []).map(String).filter(Boolean)));
    const completed = new Set((progress?.runnerReviewCompletedDueWordKeys || []).map(String));
    const next = progress?.readinessNextAt;
    const nextAt = Number(next?.toMillis?.() ?? (next?.seconds != null ? next.seconds * 1000 + (next.nanoseconds || 0) / 1e6 : next)) || 0;
    const unresolvedDue = Number(progress?.availableForReviewNowCount) > 0 && (!due.length || due.some((key) => !completed.has(key)));
    return unresolvedDue || (nextAt > 0 && nextAt <= now);
  }
  function practiceLocked(context) {
    return Boolean(context?.practiceLocked ? context.practiceLocked() : context?.progress?.status === 'ready' || reviewIsDue(context?.progress));
  }
  function render(context) {
    const card = node('aside', 'gate-runner-card'), copy = node('div', 'gate-runner-card-copy');
    const totals = node('small', 'gate-runner-cosmetic'), wallet = node('span'), best = node('span');
    wallet.dataset.runnerWallet = ''; wallet.textContent = String(RunnerCoinWallet.balance());
    best.dataset.runnerBest = ''; best.textContent = String(RunnerBestDistance.value());
    totals.append('عملاتك: ', wallet, ' · أفضل مسافة: ', best, ' م');
    copy.append(node('strong', '', 'لووت رنر — جري البوابات'),
      node('span', '', 'تفادَ العوائق واعبر بوابة المعنى الصحيح. الجري لا يزيد الإتقان أو جاهزية البوابة. لرفع الجاهزية اختر المطابقة أو الصندوق المشفّر أو الهروب من النسيان.'),
      totals);
    const play = node('button', 'gate-runner-launch', 'ابدأ الجري'); play.type = 'button';
    const due = practiceLocked(context); play.disabled = due;
    play.addEventListener('click', async () => {
      if (play.disabled) return; play.disabled = true; play.setAttribute('aria-busy', 'true'); play.textContent = 'جارٍ تجهيز الطريق…';
      try { await launch(context); }
      finally { play.disabled = practiceLocked(context); play.removeAttribute('aria-busy'); play.textContent = 'ابدأ الجري'; }
    });
    card.append(copy, play);
    return card;
  }
  async function getWords(context) {
    if (context?.source === 'dictionary') return normalizeWords(context.words);
    const api = window.LootLinguaPublishedContent;
    if (!api?.listAllPublishedGateWords) return [];
    const words = await api.listAllPublishedGateWords(context.worldId, context.rankId, context.gateId);
    return normalizeWords(window.orderRunnerGateWords?.(words) || words);
  }

  let activeRun = null, launchPending = null, resources = null;
  let practiceBreak = { rounds: 0, until: 0 };
  const recentPrompts = new Map();
  function practiceBreakActive(context) {
    return context?.source === 'dictionary' && context.onPractice && practiceBreak.until > Date.now();
  }
  const engine = () => window.LootLinguaRunnerEngine;
  function ensureResources() {
    if (resources) return resources;
    const module = (name, file) => window[name] ? Promise.resolve() : new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = file;
      script.onload = () => window[name] ? resolve() : reject(new Error('Runner module unavailable'));
      script.onerror = () => { script.remove(); reject(new Error('Runner module unavailable')); };
      document.head.append(script);
    });
    const css = document.querySelector('link[data-runner-style]');
    const styles = css ? Promise.resolve() : new Promise((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'runner.css?v=20261107-runner-entry-1';
      link.dataset.runnerStyle = ''; link.onload = resolve; link.onerror = () => { link.remove(); reject(new Error('Runner styles unavailable')); };
      document.head.append(link);
    });
    resources = Promise.all([styles, module('LootLinguaRunnerEngine', 'js/runner-engine.js?v=20261111-runner-1'), module('LootLinguaRunnerRenderer', 'js/runner-renderer.js?v=20261111-jump-4')]).catch(error => { resources = null; throw error; });
    return resources;
  }
  function button(label, cls, action) {
    const result = node('button', cls, label); result.type = 'button'; result.addEventListener('click', action); return result;
  }
  function createQuestionSpeech() {
    const key = 'lootlingua.runner.question-speech.v1';
    const supported = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
    let enabled = true, current = null, lastGate = null;
    try { enabled = localStorage.getItem(key) !== 'off'; } catch {}
    function cancel() {
      if (!current) return;
      current = null;
      try { window.speechSynthesis.cancel(); } catch {}
    }
    return {
      get enabled() { return enabled; }, supported, cancel,
      toggle() { enabled = !enabled; try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch {} if (!enabled) cancel(); },
      read(gate) {
        if (!gate || gate.id === lastGate) return;
        lastGate = gate.id;
        if (!supported || !enabled || !/[a-z]/i.test(gate.word || '') || /[\u0600-\u06ff]/.test(gate.word)) return;
        cancel();
        try {
          const utterance = new window.SpeechSynthesisUtterance(String(gate.word).trim());
          utterance.lang = 'en-US'; utterance.rate = .9;
          const voices = window.speechSynthesis.getVoices();
          const voice = voices.find(item => /^en-US$/i.test(item.lang)) || voices.find(item => /^en\b/i.test(item.lang));
          if (voice) utterance.voice = voice;
          utterance.onend = utterance.onerror = () => { if (current === utterance) current = null; };
          current = utterance; window.speechSynthesis.speak(utterance);
        } catch { current = null; }
      },
    };
  }
  function createCoinAudio() {
    const key = 'lootlingua.runner.sound.v1';
    let enabled = true, context = null, master = null, closed = false, lastNote = -Infinity;
    try { enabled = localStorage.getItem(key) !== '0'; } catch {}
    function unlock() {
      if (!enabled || closed) return;
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!context && Audio) { context = new Audio(); master = context.createGain(); master.gain.value = 1; master.connect(context.destination); }
        if (context?.state === 'suspended') void context.resume().catch(() => {});
      } catch { /* Audio is optional; gameplay never waits for it. */ }
    }
    return {
      get enabled() { return enabled; }, unlock,
      toggle() {
        enabled = !enabled;
        try { localStorage.setItem(key, enabled ? '1' : '0'); } catch {}
        if (master) master.gain.setTargetAtTime(enabled ? 1 : 0, context.currentTime, .008);
        if (enabled) unlock();
      },
      play(kind = 'coin') {
        if (!enabled || closed || context?.state !== 'running' || kind === 'coin' && context.currentTime - lastNote < .065) return;
        try {
          const now = context.currentTime; lastNote = now;
          const gate = kind === 'gate', duration = gate ? .24 : .13;
          for (const [pitch, delay] of gate ? [[523.25, 0], [659.25, .07], [1046.5, .14]] : [[1174.66, 0], [1760, .035]]) {
            const note = context.createOscillator(), gain = context.createGain(), at = now + delay;
            note.type = gate ? 'triangle' : 'sine'; note.frequency.setValueAtTime(pitch, at);
            gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(gate ? .022 : .035, at + .006);
            gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
            note.connect(gain); gain.connect(master);
            note.onended = () => { note.disconnect(); gain.disconnect(); };
            note.start(at); note.stop(at + duration + .01);
          }
        } catch { /* Unsupported or interrupted audio stays silent. */ }
      },
      destroy() { closed = true; if (context) void context.close().catch(() => {}); },
    };
  }
  async function launch(context) {
    if (activeRun) { activeRun.focus(); return false; }
    if (practiceBreakActive(context)) {
      window.showToast?.('استراحة قصيرة من الجري. جرّب المطابقة لرفع الإتقان، أو ارجع للجري بعد دقيقتين.', 'info');
      context.onPractice();
      return false;
    }
    const owner = captureRunnerOwner();
    if (launchPending && runnerOwnerCurrent(launchPending.owner)) return false;
    if (practiceLocked(context) || (context?.isCurrent && !context.isCurrent())) return false;
    const operation = { owner }; launchPending = operation;
    let words;
    try { await ensureResources(); words = await getWords(context); }
    catch (error) { if (runnerOwnerCurrent(owner)) window.showToast?.('تعذّر تحميل اللعبة أو كلمات البوابة. حاول مجددًا.', 'warning'); return false; }
    finally { if (launchPending === operation) launchPending = null; }
    if (!runnerOwnerCurrent(owner) || practiceLocked(context) || activeRun || (context?.isCurrent && !context.isCurrent())) return false;

    const scope = context?.source === 'dictionary' ? context.scope || 'personal' : JSON.stringify([context?.worldId, context?.rankId, context?.gateId]);
    const recent = recentPrompts.get(scope) || [];
    const promptKey = word => String(word).toLowerCase();
    const recentSet = new Set(recent);
    const repeated = words.filter(item => recentSet.has(promptKey(item.word)));
    repeated.sort((a, b) => recent.indexOf(promptKey(a.word)) - recent.indexOf(promptKey(b.word)));
    const orderedWords = [...words.filter(item => !recentSet.has(promptKey(item.word))), ...repeated];
    const E = engine(), state = E.createState(orderedWords, { orderedPrompts: true });
    state.running = false;
    let answeredGate = false, correctGates = 0;
    const recoveryKey = 'lootlingua.runner.recovery.v1';
    const hintsKey = 'lootlingua.runner.hints.v1';
    let showObstacleHints = true;
    try { state.autoRecovery = localStorage.getItem(recoveryKey) !== 'off'; } catch {}
    try { showObstacleHints = localStorage.getItem(hintsKey) !== 'off'; } catch {}
    const runId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const returnFocus = document.activeElement;
    const overlay = node('div', 'runner-overlay llr-overlay'), game = node('section', 'llr-game');
    game.setAttribute('role', 'dialog'); game.setAttribute('aria-modal', 'true'); game.setAttribute('aria-label', 'لووت رنر — جري البوابات'); game.tabIndex = -1;
    const header = node('header', 'llr-header'), brand = node('div', 'llr-brand');
    brand.append(node('small', '', 'LOOT RUNNER'), node('strong', '', 'جري البوابات'));
    const audio = createCoinAudio();
    const speech = createQuestionSpeech();
    const sound = button('', 'llr-icon-button llr-sound', () => { audio.toggle(); syncSound(); });
    function syncSound() { sound.textContent = audio.enabled ? 'المؤثرات: مفعّلة' : 'المؤثرات: متوقفة'; sound.setAttribute('aria-label', audio.enabled ? 'كتم أصوات اللعبة' : 'تشغيل أصوات اللعبة'); sound.setAttribute('aria-pressed', String(audio.enabled)); }
    syncSound();
    const pause = button('إيقاف', 'llr-icon-button', () => setPaused(!state.paused)), exit = button('خروج', 'llr-icon-button', () => cleanup());
    const settingsButton = button('الإعدادات', 'llr-icon-button llr-settings-button', () => openSettings());
    header.append(brand, settingsButton, pause, exit);
    const viewport = node('div', 'llr-viewport'), canvas = node('canvas', 'llr-canvas');
    canvas.setAttribute('aria-hidden', 'true'); viewport.tabIndex = 0;
    viewport.setAttribute('aria-label', 'ثلاثة مسارات. الأسهم يمين ويسار للحركة، أعلى للقفز وأسفل للانزلاق. على الهاتف اسحب في الاتجاه نفسه.');
    const hud = node('div', 'llr-hud'), health = node('span'), coins = node('span'), distance = node('span'); hud.append(health, coins, distance);
    const challenge = node('div', 'llr-challenge'), kicker = node('small', '', 'اعبر البوابة التي تحمل المعنى الصحيح'), wordLabel = node('strong');
    challenge.append(kicker, wordLabel); challenge.hidden = true;
    const options = node('div', 'llr-gate-labels'); options.hidden = true;
    const labels = [0, 1, 2].map(lane => { const label = node('div', 'llr-gate-label'); label.dataset.lane = String(lane); options.append(label); return label; });
    const status = node('p', 'llr-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const screen = node('div', 'llr-screen');
    viewport.append(canvas, hud, challenge, options, status, screen);
    const controls = node('div', 'llr-controls');
    const move = lane => { E.move(state, lane); };
    for (const [label, action, icon] of [
      ['يسار', () => move(state.lane - 1), '←'], ['وسط', () => move(1), '•'], ['يمين', () => move(state.lane + 1), '→'],
      ['قفز', () => E.jump(state), '↑'], ['انزلاق', () => E.slide(state), '↓'],
    ]) { const b = button('', 'llr-control', action); b.append(node('b', '', icon), node('span', '', label)); controls.append(b); }
    const hint = node('p', 'llr-hint', 'اسحب للحركة والقفز والانزلاق · تدريب يجمع العملات دون تغيير الإتقان أو XP');
    game.append(header, viewport, controls, hint); overlay.append(game); document.body.append(overlay);
    document.body.classList.add('runner-input-active'); window.__lootlinguaRunnerInputActive = true;
    window.dispatchEvent(new CustomEvent('lootlingua:runner-input-active'));
    window.lockBackgroundScroll?.('runner');
    let renderer, resizeObserver, raf = 0, previous = 0, destroyed = false, settled = false, gateId = null, feedbackUntil = 0, hudKey = '', rect, lastDueCheck = 0, gesture = null;
    let gateZ = 0;
    let settingsOpen = false, resumeAfterSettings = false, demoRenderer = null, demoRaf = 0, demoState = null, demoPrevious = 0, demoIndex = 0;
    let demoPlaying = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const settings = node('section', 'llr-settings'); settings.hidden = true; settings.tabIndex = -1;
    settings.setAttribute('role', 'dialog'); settings.setAttribute('aria-modal', 'true'); settings.setAttribute('aria-label', 'إعدادات الجري');
    const closeSettingsButton = button('العودة إلى اللعبة', 'llr-secondary', closeSettings);
    const recovery = button('', 'llr-secondary llr-recovery', () => {
      state.autoRecovery = !state.autoRecovery;
      try { localStorage.setItem(recoveryKey, state.autoRecovery ? 'on' : 'off'); } catch {}
      syncRecovery();
    });
    function syncRecovery() {
      recovery.textContent = `مساعدة بعد الاصطدام: ${state.autoRecovery ? 'مفعّلة' : 'متوقفة'}`;
      recovery.setAttribute('aria-pressed', String(state.autoRecovery));
      modeDescription.textContent = state.autoRecovery
        ? 'بعد الاصطدام تخسر قلبًا وتتوقف الحركة للحظة، ثم تختار المساعدة حركة تجاوز واحدة آمنة ويعود التحكم إليك. إذا لم تجد مسارًا آمنًا تمر الشخصية مع الوميض.'
        : 'المساعدة متوقفة: بعد الاصطدام تخسر قلبًا وتتوقف الحركة للحظة، ثم تمر الشخصية عبر العائق وهي تومض. لا تغيّر المسار ولا تقفز ولا تنزلق تلقائيًا؛ تبقى الحركة مسؤوليتك.';
      demoIndex = 0;
      if (demoRenderer) resetDemo();
    }
    const modeDescription = node('p', 'llr-recovery-description');
    const demo = node('div', 'llr-recovery-demo');
    const demoTitle = node('strong'), demoCanvas = node('canvas'); demoCanvas.setAttribute('aria-hidden', 'true');
    const demoDescription = node('p'), demoControls = node('div', 'llr-settings-actions');
    const demoScenarios = [
      { title: 'صندوقان: اختيار ممر قابل للتجاوز', description: 'تتوقف الشخصية بعد الضربة، ثم تنتقل إلى الحاجز القابل للقفز، بعيدًا عن الصندوق الآخر.', types: ['wall', 'wall', 'low'] },
      { title: 'لوح يفرض الانزلاق', description: 'بعد الضربة تنزلق الشخصية تحت اللوح. لا تختار القفز إلى جسمه.', types: ['wall', 'duckwall', 'wall'] },
      { title: 'حاجز قصير: قفزة واحدة', description: 'تظهر الضربة أولًا، ثم قفزة لتجاوز الحاجز. بعدها يعود التحكم إليك.', types: ['wall', 'low', 'wall'] },
      { title: 'عارضة: اختيار الانزلاق', description: 'العارضة تسمح بالقفز أو الانزلاق؛ هنا تختار المساعدة الانزلاق الآمن.', types: ['wall', 'overhead', 'wall'] },
    ];
    function resetDemo() {
      demoState = E.createState([], { random: () => .5, autoRecovery: state.autoRecovery });
      demoState._nextRowAt = demoState._nextGateAt = Infinity;
      const scenario = demoScenarios[demoIndex];
      demoTitle.textContent = state.autoRecovery ? scenario.title : `دون مساعدة · ${['الصندوق', 'لوح الانزلاق', 'الحاجز القصير', 'العارضة'][demoIndex]}`;
      demoDescription.textContent = state.autoRecovery ? scenario.description : 'لاحظ الضربة والتوقّف، ثم الوميض والمرور عبر العائق في المسار نفسه، دون أي حركة تجاوز تلقائية.';
      scenario.types.forEach((type, lane) => {
        const item = demoState._pool.pop(); Object.assign(item, { id: lane + 1, kind: 'obstacle', obstacleType: type, lane, z: 17, length: 0, active: true, bornAt: -1000, resolved: false }); demoState.entities.push(item);
      });
      demoRenderer?.draw(demoState);
    }
    function demoFrame(now) {
      demoRaf = 0;
      if (destroyed || !settingsOpen || demo.hidden || document.hidden || !demoPlaying) return;
      if (!demoPrevious) demoPrevious = now;
      if (now - demoPrevious >= 32) {
        E.update(demoState, Math.min(50, now - demoPrevious)); demoPrevious = now;
        demoRenderer.draw(demoState);
        if (demoState.elapsed > 3600) { demoIndex = (demoIndex + 1) % demoScenarios.length; resetDemo(); }
      }
      demoRaf = requestAnimationFrame(demoFrame);
    }
    function resumeDemo() { cancelAnimationFrame(demoRaf); demoPrevious = 0; if (settingsOpen && !demo.hidden && !document.hidden && demoPlaying) demoRaf = requestAnimationFrame(demoFrame); }
    const demoPlay = button(demoPlaying ? 'إيقاف العرض' : 'تشغيل العرض', 'llr-icon-button', () => { demoPlaying = !demoPlaying; demoPlay.textContent = demoPlaying ? 'إيقاف العرض' : 'تشغيل العرض'; resumeDemo(); });
    demoControls.append(demoPlay);
    demo.append(node('small', '', 'عرض توضيحي — لا يغيّر تقدمك'), demoTitle, demoCanvas, demoDescription, demoControls);
    const hintsToggle = button('', 'llr-secondary llr-hints-toggle', () => {
      showObstacleHints = !showObstacleHints;
      try { localStorage.setItem(hintsKey, showObstacleHints ? 'on' : 'off'); } catch {}
      syncHints(); syncHUD();
    });
    function syncHints() { hintsToggle.textContent = `تلميحات العوائق: ${showObstacleHints ? 'ظاهرة' : 'مخفية'}`; hintsToggle.setAttribute('aria-pressed', String(showObstacleHints)); }
    syncHints();
    const speechToggle = button('', 'llr-secondary llr-speech-toggle', () => { speech.toggle(); syncSpeech(); });
    function syncSpeech() { speechToggle.textContent = speech.supported ? `نطق السؤال: ${speech.enabled ? 'مفعّل' : 'متوقف'}` : 'النطق غير مدعوم على هذا المتصفح'; speechToggle.disabled = !speech.supported; speechToggle.setAttribute('aria-pressed', String(speech.enabled && speech.supported)); }
    syncSpeech();
    function settingRow(description, control) { const row = node('div', 'llr-setting-row'); row.append(node('p', '', description), control); return row; }
    const audioSettings = node('section', 'llr-settings-group');
    audioSettings.append(node('h3', '', 'الصوت والقراءة'),
      settingRow('أصوات جمع العملات والإجابة الصحيحة.', sound),
      settingRow('قراءة الكلمة الإنجليزية تلقائيًا عند ظهور السؤال، دون قراءة المعاني. هذا الخيار مستقل عن المؤثرات.', speechToggle));
    const playSettings = node('section', 'llr-settings-group');
    playSettings.append(node('h3', '', 'إرشادات اللعب'), settingRow('إظهار تعليمات القفز والانزلاق وتغيير المسار قرب العوائق.', hintsToggle));
    const recoverySettings = node('section', 'llr-settings-group');
    recoverySettings.append(node('h3', '', 'مساعدة بعد الاصطدام'), recovery, modeDescription,
      node('p', '', 'الاصطدام بجانب الشاحنة يصدّك عن جانبها دون خسارة قلب.'), demo);
    settings.append(node('h2', '', 'إعدادات الجري'), closeSettingsButton, audioSettings, playSettings, recoverySettings);
    syncRecovery();
    game.append(settings);
    function setFocusSurface(dialog, onEscape) {
      window.LootLinguaModalFocus?.close(overlay, { restoreFocus: false });
      window.LootLinguaModalFocus?.open(overlay, { dialog, onEscape });
    }
    function openSettings() {
      if (settingsOpen || destroyed) return;
      resumeAfterSettings = state.running && !state.paused && !state.over;
      if (resumeAfterSettings) setPaused(true);
      settingsOpen = true; settings.hidden = false; gesture = null;
      if (!demoRenderer) {
        demoRenderer = window.LootLinguaRunnerRenderer.createRenderer(demoCanvas, { width: Math.max(240, Math.min(520, settings.clientWidth - 40)), height: 240, dprCap: 1 });
        resetDemo();
      }
      for (const el of [header, viewport, controls, hint]) el.inert = true;
      setFocusSurface(settings, closeSettings); closeSettingsButton.focus({ preventScroll: true }); resumeDemo();
    }
    function closeSettings() {
      if (!settingsOpen) return;
      settingsOpen = false; settings.hidden = true; cancelAnimationFrame(demoRaf);
      for (const el of [header, viewport, controls, hint]) el.inert = false;
      setFocusSurface(game, cleanup);
      if (resumeAfterSettings && !document.hidden) setPaused(false);
      else settingsButton.focus({ preventScroll: true });
    }
    const startingBest = RunnerBestDistance.value();
    const resize = () => { rect = viewport.getBoundingClientRect(); renderer?.resize(rect.width, rect.height); if (renderer) renderer.draw(state); };
    const saveRun = () => {
      if (settled || !runnerOwnerCurrent(owner)) return;
      settled = true; RunnerBestDistance.save(Math.floor(state.distance));
      if (state.coins > 0) void RunnerCoinWallet.credit(state.coins, runId);
    };
    function cleanup() {
      if (destroyed) return; saveRun(); destroyed = true; cancelAnimationFrame(raf);
      cancelAnimationFrame(demoRaf); demoRenderer?.destroy();
      resizeObserver?.disconnect(); renderer?.destroy(); audio.destroy(); speech.cancel();
      window.removeEventListener('resize', resize); window.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('lootlingua:auth-state', authChanged);
      window.LootLinguaModalFocus?.close(overlay);
      window.unlockBackgroundScroll?.('runner');
      document.body.classList.remove('runner-input-active'); window.__lootlinguaRunnerInputActive = false;
      window.dispatchEvent(new CustomEvent('lootlingua:runner-input-inactive'));
      overlay.remove(); activeRun = null;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
    function showScreen(title, description, cta, action) {
      const primary = button(cta, 'llr-primary', action);
      screen.replaceChildren(node('small', 'llr-screen-kicker', 'LOOT RUNNER'), node('h2', '', title), node('p', '', description), primary);
      screen.hidden = false;
      requestAnimationFrame(() => { if (!destroyed && primary.isConnected && !screen.hidden) primary.focus({ preventScroll: true }); });
    }
    function setPaused(value) {
      if (!state.running || state.over) return;
      state.paused = value; pause.textContent = value ? 'متابعة' : 'إيقاف';
      if (value) speech.cancel();
      if (value) { cancelAnimationFrame(raf); showScreen('استراحة قصيرة', 'خذ وقتك. الطريق ينتظرك.', 'متابعة الجري', () => setPaused(false)); }
      else { audio.unlock(); screen.hidden = true; previous = performance.now(); raf = requestAnimationFrame(frame); viewport.focus({ preventScroll: true }); }
    }
    function finish(reason) {
      speech.cancel();
      state.running = false; cancelAnimationFrame(raf); saveRun(); challenge.hidden = options.hidden = true;
      if (state.over && answeredGate && context?.source === 'dictionary' && context.onPractice && ++practiceBreak.rounds >= 2) {
        practiceBreak = { rounds: 0, until: Date.now() + 120000 };
      }
      const needsPractice = practiceBreakActive(context);
      const stats = `${Math.floor(state.distance)} متر · ${state.coins} عملة${state.distance > startingBest ? ' · رقم قياسي جديد!' : ''}`;
      const message = needsPractice
        ? 'الجري وبطاقات الذاكرة لا يرفعان الإتقان. جرّب المطابقة الآن، أو ارجع للجري بعد دقيقتين.'
        : 'الجري تدريب لا يزيد الإتقان.';
      showScreen(reason, `${stats}. ${message}`, needsPractice ? 'جرّب مطابقة الكلمات' : 'جولة جديدة', () => {
        cleanup();
        if (needsPractice) context.onPractice();
        else void launch(context);
      });
      screen.append(button(context?.source === 'dictionary' ? 'العودة إلى إعدادات اللعبة' : 'العودة إلى البوابة', 'llr-secondary', cleanup));
      if (state.over && correctGates >= 3 && runnerOwnerCurrent(owner)) {
        const chestNotice = node('p', 'llr-chest-result');
        chestNotice.setAttribute('role', 'status');
        screen.append(chestNotice);
        void window.LootLinguaTreasure?.training('runner', runId, correctGates).then(text => { chestNotice.textContent = text; });
      }
      pause.disabled = true;
    }
    function syncHUD() {
      const key = `${state.hearts}:${state.coins}:${Math.floor(state.distance)}`;
      if (key !== hudKey) { hudKey = key; health.textContent = `♥ ${state.hearts} فرص`; coins.textContent = `${state.coins} عملة`; distance.textContent = `${Math.floor(state.distance)} م`; }
      const gate = state.gate;
      if (gate && !gate.resolved) {
        challenge.hidden = options.hidden = false; gateZ = gate.z;
        if (gate.id !== gateId) { gateId = gate.id; wordLabel.textContent = gate.word; labels.forEach((label, lane) => { label.textContent = gate.options[lane]; }); if (state.running && !state.paused) speech.read(gate); }
        const near = renderer.project(1, gateZ);
        options.style.top = `${Math.max(rect.height * .31, Math.min(rect.height * .64, near.labelY || near.y - 60))}px`;
        labels.forEach((label, lane) => label.classList.toggle('is-selected', lane === state.lane));
      } else { challenge.hidden = options.hidden = true; gateId = null; speech.cancel(); }
      if (state.feedback && state.feedback.until !== feedbackUntil) {
        feedbackUntil = state.feedback.until;
        status.textContent = state.feedback.correct ? 'بوابة صحيحة! أحسنت.' : `إجابة خاطئة — المعنى الصحيح: ${state.feedback.correctMeaning || ''}`;
        status.dataset.tone = state.feedback.correct ? 'correct' : 'wrong';
      } else if (!state.feedback) {
        const nearby = state.entities.find(item => item.kind === 'obstacle' && item.lane === state.lane && item.z > 0 && item.z / state.speed < (item.obstacleType === 'low' ? .48 : ['overhead', 'duckwall'].includes(item.obstacleType) ? .4 : 1.1));
        const text = showObstacleHints && nearby ? ({ low: '↑ اقفز فوق الحاجز', overhead: '↓ انزلق تحت العارضة', duckwall: '↓ انزلق تحت اللوح — القفز لا يتجاوزه', wall: '← غيّر المسار →', train: 'منحدر أمامك — اصعد إلى سطح العربة' }[nearby.obstacleType] || '') : '';
        if (status.textContent !== text) status.textContent = text;
        status.dataset.tone = 'hint';
      }
    }
    function frame(now) {
      if (destroyed) return;
      if (!runnerOwnerCurrent(owner)) { cleanup(); return; }
      if (now - lastDueCheck > 1000) { lastDueCheck = now; if (practiceLocked(context)) { finish('حان وقت الاختبار الموثوق'); return; } }
      const delta = Math.min(50, Math.max(0, now - previous)); previous = now;
      E.update(state, delta);
      for (const event of state.events) {
        if (event.type === 'gate') {
          answeredGate = true;
          if (event.correct) correctGates++;
        }
        if (event.type !== 'gate-approach') continue;
        const key = promptKey(event.word);
        const history = (recentPrompts.get(scope) || []).filter(word => word !== key);
        history.push(key);
        if (!recentPrompts.has(scope) && recentPrompts.size >= 20) recentPrompts.delete(recentPrompts.keys().next().value);
        recentPrompts.set(scope, history.slice(-12));
      }
      if (state.events.some(event => event.type === 'gate' && event.correct)) audio.play('gate');
      else if (state.events.some(event => event.type === 'coin')) audio.play();
      renderer.draw(state); syncHUD();
      if (state.over) finish('رحلة جميلة! حاول تحطيم رقمك');
      else if (!state.paused && state.running) raf = requestAnimationFrame(frame);
    }
    function keyboard(event) {
      if (event.key === 'Tab') return;
      if (settingsOpen) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeSettings(); } return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); return; }
      if (event.target?.closest?.('button') && ['Enter', ' '].includes(event.key)) return;
      const key = event.key.toLowerCase();
      const actions = { arrowleft: () => move(state.lane - 1), a: () => move(state.lane - 1), arrowright: () => move(state.lane + 1), d: () => move(state.lane + 1), arrowup: () => E.jump(state), w: () => E.jump(state), ' ': () => E.jump(state), arrowdown: () => E.slide(state), s: () => E.slide(state), p: () => setPaused(!state.paused) };
      if (actions[key]) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) actions[key](); }
    }
    const visibility = () => { if (document.hidden) setPaused(true); resumeDemo(); };
    const authChanged = () => { if (!runnerOwnerCurrent(owner)) cleanup(); };
    viewport.addEventListener('pointerdown', event => {
      if (event.target.closest('button') || (event.button != null && event.button !== 0)) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lane: state.lane, acted: false };
      viewport.setPointerCapture?.(event.pointerId); event.preventDefault();
    });
    viewport.addEventListener('pointermove', event => {
      if (!gesture || gesture.id !== event.pointerId || gesture.acted) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < Math.max(18, Math.min(30, rect.width * .06))) return;
      gesture.acted = true;
      if (Math.abs(dx) > Math.abs(dy)) move(gesture.lane + Math.sign(dx));
      else if (dy < 0) E.jump(state); else E.slide(state);
      event.preventDefault();
    });
    viewport.addEventListener('pointerup', event => {
      if (gesture?.id !== event.pointerId) return;
      if (!gesture.acted) move(Math.min(2, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * 3))));
      gesture = null;
    });
    viewport.addEventListener('pointercancel', () => { gesture = null; });
    try {
      renderer = window.LootLinguaRunnerRenderer.createRenderer(canvas, { width: viewport.clientWidth, height: viewport.clientHeight });
      resize(); resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; resizeObserver?.observe(viewport);
      window.addEventListener('resize', resize); window.addEventListener('keydown', keyboard, true); document.addEventListener('visibilitychange', visibility);
      window.addEventListener('lootlingua:auth-state', authChanged);
      activeRun = { state, focus: () => game.focus(), close: cleanup };
      window.LootLinguaModalFocus?.open(overlay, { dialog: game, onEscape: cleanup });
      syncHUD(); renderer.draw(state);
      const free = new Set(words.map(w => w.meaning)).size < 3;
      showScreen('الطريق لك', `${free ? 'هذه جولة جري حر؛ البوابة تحتاج ثلاثة معانٍ مختلفة.' : 'عند ظهور كلمة، اعبر بوابة معناها الصحيح.'} السباق تدريب ولا يزيد الإتقان أو جاهزية البوابة.`, 'انطلق', () => {
        audio.unlock(); screen.hidden = true; state.running = true; state.paused = false; previous = performance.now(); viewport.focus({ preventScroll: true }); raf = requestAnimationFrame(frame);
      });
      screen.insertBefore(node('div', 'llr-tutorial', '← → مسارات   ↑ قفز   ↓ انزلاق\nالهاتف: اسحب في الاتجاه نفسه أو استخدم الأزرار'), screen.lastChild);
      return true;
    } catch (error) { cleanup(); window.showToast?.('تعذّر تشغيل الرسومات. حاول مجددًا.', 'warning'); return false; }
  }
  const previews = new WeakSet();
  function mountPreview(canvas) {
    if (!canvas || previews.has(canvas) || !canvas.getClientRects().length) return;
    previews.add(canvas);
    let renderer, state, raf = 0, visible = false, previous = 0, loading = false;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const allowed = () => visible && !document.hidden && !window.__lootlinguaRunnerInputActive && canvas.isConnected;
    function draw(now) {
      raf = 0;
      if (!allowed()) return;
      if (now - previous >= 33) {
        const delta = previous ? Math.min(now - previous, 80) : 0;
        previous = now; state.elapsed += delta; state.distance += delta * .014;
        renderer.draw(state);
      }
      if (!reduced?.matches) raf = requestAnimationFrame(draw);
    }
    async function resume() {
      cancelAnimationFrame(raf); raf = 0; previous = 0;
      if (!allowed() || loading) return;
      if (!renderer) {
        loading = true;
        try {
          await ensureResources();
          if (!canvas.isConnected) return;
          state = engine().createState([]); state.running = false;
          renderer = window.LootLinguaRunnerRenderer.createRenderer(canvas, { width: 240, height: 132, dprCap: 1 });
        } catch { previews.delete(canvas); return; }
        finally { loading = false; }
      }
      if (allowed()) { renderer.draw(state); if (!reduced?.matches) raf = requestAnimationFrame(draw); }
    }
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; void resume(); });
      observer.observe(canvas);
    } else { visible = true; void resume(); }
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('lootlingua:runner-input-active', resume);
    window.addEventListener('lootlingua:runner-input-inactive', resume);
    reduced?.addEventListener?.('change', resume);
  }
  window.LootLinguaGateRunner = {
    render, launch, mountPreview, acceptProfile, refreshProgressUI, reviewIsDue, normalizeWords, RunnerCoinWallet, RunnerBestDistance, MAX_HEARTS,
    createState: (...args) => engine().createState(...args), step: (...args) => engine().update(...args), chooseLane: (...args) => engine().move(...args),
    getDiagnostics: () => activeRun ? { lane: activeRun.state.lane, action: activeRun.state.action, paused: activeRun.state.paused, entities: activeRun.state.entities.filter(e => e.active !== false).length, distance: activeRun.state.distance } : null,
  };
  window.addEventListener?.('lootlingua:trusted-quiz-completed', () => { practiceBreak = { rounds: 0, until: 0 }; });
  window.addEventListener?.('lootlingua:auth-state', () => {
    practiceBreak = { rounds: 0, until: 0 };
    recentPrompts.clear();
    refreshProgressUI();
  });
  const initialProfile = window.__lootlinguaProfileSnapshot;
  if (initialProfile?.uid && initialProfile.uid === window.auth?.currentUser?.uid) acceptProfile(initialProfile.data, initialProfile.uid);
})();
