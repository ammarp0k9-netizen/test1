/* Gate Runner: a cosmetic, self-contained game. It never changes SRS, XP or gate progress. */
(function () {
  'use strict';
  const LANES = 3;
  const MAX_HEARTS = 3;
  const RUN_DURATION = 70000;
  const COIN_KEY = 'lootlingua.runner.coins.v1';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const shuffle = (items, random = Math.random) => {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  };
  function normalizeWords(words) {
    const seen = new Set();
    return (Array.isArray(words) ? words : []).map((item) => ({
      word: String(item?.word || item?.term || '').trim(),
      meaning: String(item?.translation || item?.meaning || item?.ar || item?.definition || '').trim(),
    })).filter((item) => item.word && item.meaning && !seen.has(`${item.word}\u0000${item.meaning}`) && seen.add(`${item.word}\u0000${item.meaning}`));
  }
  function makeWordEvent(words, random = Math.random) {
    const pool = normalizeWords(words);
    if (pool.length < 3) return null;
    const prompt = pool[Math.floor(random() * pool.length)];
    const distractors = shuffle(pool.filter((item) => item.meaning !== prompt.meaning), random).slice(0, 2);
    if (distractors.length < 2) return null;
    const options = shuffle([prompt, ...distractors], random).map((item) => item.meaning);
    return { word: prompt.word, options, correctLane: options.indexOf(prompt.meaning) };
  }
  function calculateStage(width, height) {
    const w = Math.max(1, Number(width) || 1), h = Math.max(1, Number(height) || 1);
    return { width: w, height: h, scale: clamp(Math.min(w / 900, h / 520), .62, 1.35), compact: w < 560 || h < 520, portrait: h > w };
  }
  function createState(words) {
    return { words: normalizeWords(words), lane: 1, hearts: MAX_HEARTS, coins: 0, distance: 0, elapsed: 0, running: false, paused: false, over: false, event: null, nextEvent: 14500, eventUntil: 0, damageUntil: 0, lastInputAt: 0 };
  }
  function step(state, delta, random = Math.random) {
    if (!state.running || state.paused || state.over) return state;
    const eventActive = Boolean(state.event);
    const speed = eventActive ? .42 : 1;
    state.elapsed += delta;
    state.distance += delta * .012 * speed;
    if (!eventActive && state.elapsed >= state.nextEvent) {
      const event = makeWordEvent(state.words, random);
      if (event) { state.event = event; state.eventUntil = state.elapsed + 6200; }
      state.nextEvent += 15000 + Math.floor(random() * 6500);
    }
    if (state.event && state.elapsed >= state.eventUntil) state.event = null;
    if (state.elapsed >= RUN_DURATION) state.over = true;
    return state;
  }
  function chooseLane(state, lane, at = performance.now()) {
    if (!state.running || state.paused || state.over || at - state.lastInputAt < 90) return { accepted: false };
    state.lastInputAt = at;
    state.lane = clamp(lane, 0, LANES - 1);
    if (!state.event) return { accepted: true, resolved: false };
    const correct = state.event.correctLane === state.lane;
    state.event = null;
    if (!correct) { state.hearts -= 1; state.damageUntil = state.elapsed + 800; if (state.hearts <= 0) state.over = true; }
    return { accepted: true, resolved: true, correct };
  }
  function addCoin(state, token) {
    if (!state.running || !token || token.collected) return false;
    token.collected = true; state.coins += 1; return true;
  }
  function hitObstacle(state, obstacle) {
    if (!state.running || !obstacle || obstacle.hit || state.damageUntil > state.elapsed) return false;
    obstacle.hit = true; state.hearts -= 1; state.damageUntil = state.elapsed + 900;
    if (state.hearts <= 0) state.over = true;
    return true;
  }
  // This tiny wallet deliberately has no unlock or learning policy. A future shared
  // cosmetics surface can replace this adapter without changing Runner gameplay.
  const RunnerCoinWallet = Object.freeze({
    balance() { try { return Math.max(0, Number(localStorage.getItem(COIN_KEY)) || 0); } catch { return 0; } },
    credit(amount) { try { localStorage.setItem(COIN_KEY, String(this.balance() + Math.max(0, amount))); } catch {} },
  });
  const node = (tag, className, text) => { const result = document.createElement(tag); if (className) result.className = className; if (text != null) result.textContent = text; return result; };

  function render(context) {
    const card = node('aside', 'gate-runner-card');
    const copy = node('div', 'gate-runner-card-copy');
    const bank = RunnerCoinWallet.balance();
    copy.append(node('strong', '', 'Runner'), node('span', '', 'اركض، تفادَ العوائق، واجمع العملات. أحيانًا اختر مسار معنى كلمة من هذه البوابة.'), node('small', 'gate-runner-cosmetic', `رصيد العملات الجانبي: ${bank} — لا يؤثر على التعلم أو تقدّم البوابات.`));
    const play = node('button', 'gate-runner-launch', 'ابدأ Runner'); play.type = 'button';
    play.addEventListener('click', () => launch(context));
    card.append(copy, play);
    return card;
  }
  async function getWords(context) {
    const api = window.LootLinguaPublishedContent;
    if (!api?.listAllPublishedGateWords) return [];
    return normalizeWords(await api.listAllPublishedGateWords(context.worldId, context.rankId, context.gateId));
  }
  async function launch(context) {
    let words;
    try { words = await getWords(context); } catch { words = []; }
    const overlay = node('div', 'runner-overlay');
    const game = node('section', 'runner-game'); game.setAttribute('role', 'dialog'); game.setAttribute('aria-label', 'Runner');
    const header = node('header', 'runner-header');
    const hud = node('div', 'runner-hud');
    const pause = node('button', 'runner-icon-button', 'إيقاف'); pause.type = 'button';
    const exit = node('button', 'runner-exit', '× خروج'); exit.type = 'button'; header.append(hud, pause, exit);
    const stage = node('div', 'runner-stage'); stage.tabIndex = 0;
    const tracks = node('div', 'runner-tracks'); const player = node('div', 'runner-player', '●'); tracks.append(player); stage.append(tracks);
    const banner = node('div', 'runner-word-event'); stage.append(banner);
    const controls = node('div', 'runner-controls');
    ['يمين', 'وسط', 'يسار'].forEach((label, index) => { const button = node('button', '', label); button.type = 'button'; button.dataset.lane = String(2 - index); controls.append(button); });
    game.append(header, stage, controls); overlay.append(game); document.body.append(overlay);
    const state = createState(words); state.running = true;
    const objects = []; let raf = 0, previous = performance.now(), spawnAt = 0, saved = false, destroyed = false, touchStart = null;
    const resize = () => { const size = calculateStage(stage.clientWidth, stage.clientHeight); game.classList.toggle('is-compact', size.compact); game.style.setProperty('--runner-scale', String(size.scale)); };
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(stage); resize();
    const cleanup = () => { if (destroyed) return; destroyed = true; cancelAnimationFrame(raf); resizeObserver?.disconnect(); window.removeEventListener('keydown', keyboard); document.removeEventListener('visibilitychange', visibility); overlay.remove(); };
    const finish = (title) => {
      if (saved) return; saved = true; state.running = false; RunnerCoinWallet.credit(state.coins);
      game.classList.add('is-finished'); banner.replaceChildren(node('strong', '', title), node('span', '', `المسافة ${Math.floor(state.distance)} · العملات ${state.coins}`));
      const again = node('button', 'runner-primary', 'إعادة اللعب'); again.type = 'button'; again.addEventListener('click', () => { cleanup(); launch(context); });
      const leave = node('button', 'runner-secondary', 'خروج إلى البوابة'); leave.type = 'button'; leave.addEventListener('click', cleanup); banner.append(again, leave);
    };
    const update = () => {
      game.classList.toggle('is-paused', state.paused); game.classList.toggle('is-damaged', state.damageUntil > state.elapsed);
      player.style.setProperty('--lane', state.lane); hud.textContent = `♥`.repeat(state.hearts) + `♡`.repeat(MAX_HEARTS - state.hearts) + `  العملات ${state.coins}  ·  ${Math.floor(state.distance)}م`;
      pause.textContent = state.paused ? 'متابعة' : 'إيقاف';
      if (!state.event || state.over) { if (!game.classList.contains('is-finished')) banner.replaceChildren(); return; }
      banner.replaceChildren(node('strong', '', state.event.word), node('span', '', 'اختر معنى الكلمة عبر المسار المناسب'));
      state.event.options.forEach((option, lane) => banner.append(node('span', `runner-option lane-${lane}`, option)));
    };
    const select = (lane) => { const result = chooseLane(state, lane); if (!result.accepted) return; if (result.resolved) { game.classList.toggle('is-correct', result.correct); setTimeout(() => game.classList.remove('is-correct'), 420); } update(); };
    const keyboard = (event) => { if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') { event.preventDefault(); select(state.lane - 1); } if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') { event.preventDefault(); select(state.lane + 1); } if (event.key === 'Escape') cleanup(); };
    const visibility = () => { if (document.hidden && state.running && !state.over) { state.paused = true; update(); } };
    window.addEventListener('keydown', keyboard); document.addEventListener('visibilitychange', visibility);
    controls.addEventListener('pointerdown', (event) => { const button = event.target.closest('button[data-lane]'); if (button) { event.preventDefault(); select(Number(button.dataset.lane)); } });
    stage.addEventListener('pointerdown', (event) => { touchStart = event.clientX; stage.setPointerCapture?.(event.pointerId); });
    stage.addEventListener('pointerup', (event) => { if (touchStart == null) return; const delta = event.clientX - touchStart; touchStart = null; if (Math.abs(delta) > 24) select(state.lane + (delta > 0 ? 1 : -1)); });
    pause.addEventListener('click', () => { if (!state.over) { state.paused = !state.paused; update(); } }); exit.addEventListener('click', cleanup);
    const spawn = () => { const isCoin = Math.random() < .64; const lane = Math.floor(Math.random() * LANES); const item = node('div', isCoin ? 'runner-object is-coin' : 'runner-object is-obstacle', isCoin ? '●' : '▲'); item.style.setProperty('--lane', lane); tracks.append(item); objects.push({ node: item, lane, coin: isCoin, progress: 0, hit: false, collected: false }); };
    function frame(now) {
      if (destroyed) return; const delta = Math.min(50, now - previous); previous = now;
      step(state, delta); const slowed = state.event ? .45 : 1;
      if (state.running && !state.paused && now >= spawnAt) { spawn(); spawnAt = now + Math.max(560, 1100 - state.elapsed / 130); }
      if (!state.paused) objects.slice().forEach((item) => { item.progress += delta * .00042 * slowed; item.node.style.setProperty('--p', item.progress); if (item.progress > .82 && item.progress < 1.02 && item.lane === state.lane) { if (item.coin) { if (addCoin(state, item)) item.node.classList.add('is-collected'); } else if (hitObstacle(state, item)) item.node.classList.add('is-hit'); } if (item.progress > 1.12) { item.node.remove(); objects.splice(objects.indexOf(item), 1); } });
      update(); if (state.over) finish(state.hearts <= 0 ? 'انتهت القلوب' : 'انتهت الجولة'); else raf = requestAnimationFrame(frame);
    }
    update(); stage.focus({ preventScroll: true }); raf = requestAnimationFrame(frame);
  }
  window.LootLinguaGateRunner = { render, normalizeWords, makeWordEvent, calculateStage, createState, step, chooseLane, addCoin, hitObstacle, RunnerCoinWallet, MAX_HEARTS };
})();
