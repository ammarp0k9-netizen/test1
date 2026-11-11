import { createBattle, prepareDeck, WIDTH, HEIGHT } from './loot-bots-engine.mjs?v=1';
import { createRenderer } from './loot-bots-renderer.mjs?v=1';

const MOVEMENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
const STEP = 1 / 60;

export function openBattle({ words, source, isCurrent, returnFocus }) {
  const deck = prepareDeck(words);
  if (!deck.prompts.length) return 'small';

  const uid = window.auth?.currentUser?.uid;
  const storageKey = `lootlingua.bots.v1:${uid ? `user:${encodeURIComponent(uid)}` : 'guest'}`;
  const lifetime = new AbortController();
  const listen = (target, event, fn) => target.addEventListener(event, fn, { signal: lifetime.signal });
  const dialog = document.createElement('dialog');
  dialog.className = 'loot-bots'; dialog.dir = 'rtl'; dialog.setAttribute('aria-labelledby', 'lootBotsTitle');
  dialog.innerHTML = `
    <section class="lb-shell">
      <header class="lb-header">
        <div><h2 id="lootBotsTitle" lang="en" dir="ltr">Loot Bots</h2><p data-source></p></div>
        <div class="lb-actions"><button type="button" data-pause hidden>إيقاف مؤقت</button><button type="button" data-close>خروج</button></div>
      </header>
      <div class="lb-hud">
        <span>القطاع <b data-sector>1</b></span><span>الصحة <b data-hp>5 / 5</b></span>
        <span>النقاط <b data-score>0</b></span><span>العملات <b data-coins>0</b></span>
      </div>
      <div class="lb-arena" tabindex="0" aria-label="ساحة المعركة">
        <canvas aria-hidden="true"></canvas>
        <div class="lb-core" hidden>
          <div class="lb-question"><small>اختر نواة المعنى الصحيح</small><b lang="en" dir="ltr" data-word></b></div>
          <div class="lb-options"></div>
        </div>
        <div class="lb-panel">
          <strong data-heading>ساحة الروبوتات</strong>
          <p data-copy>تحرّك وراوغ. روبوتك يطلق النار تلقائيًا. طابق الكلمة مع معناها لشحن السلاح وفتح القطاع التالي.</p>
          <small data-record></small>
          <button type="button" data-play autofocus>ابدأ المعركة</button>
        </div>
      </div>
      <footer class="lb-footer"><p role="status" data-status>اسحب داخل الساحة أو استخدم الأسهم للتحرّك.</p><button type="button" data-dash disabled>اندفاع</button></footer>
      <p class="lb-note">تدريب بالكلمات فقط. النقاط والعملات خاصة باللعبة ولا ترفع الإتقان أو XP.</p>
    </section>`;
  const find = selector => dialog.querySelector(selector);
  const arena = find('.lb-arena'), renderer = createRenderer(find('canvas'));
  const panel = find('.lb-panel'), core = find('.lb-core'), options = find('.lb-options');
  const status = find('[data-status]'), play = find('[data-play]'), pause = find('[data-pause]'), dashButton = find('[data-dash]');
  const hud = ['sector', 'hp', 'score', 'coins'].map(key => find(`[data-${key}]`));
  const hudValues = [];
  const keyboard = new Set();
  let battle = createBattle(deck), mode = 'intro', frame = 0, previous = 0, accumulator = 0;
  let joystick = null, dash = false, shownQuestion = null, lastEvent = null, recorded = false, closed = false;

  function readProgress() {
    try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; }
  }
  function record() {
    if (recorded || !isCurrent()) return;
    recorded = true;
    const old = readProgress();
    try {
      localStorage.setItem(storageKey, JSON.stringify({ best: Math.max(Number(old.best) || 0, battle.state.score),
        coins: (Number(old.coins) || 0) + battle.state.collected }));
    } catch { /* Storage availability does not affect the match. */ }
  }
  function showRecord() {
    const record = readProgress();
    find('[data-record]').textContent = `أفضل نتيجة ${Number(record.best) || 0} · رصيد العملات ${Number(record.coins) || 0} على هذا الجهاز`;
  }
  function clearInput() {
    keyboard.clear(); joystick = null; dash = false;
  }
  function finish() {
    if (closed) return;
    if (mode !== 'intro') record();
    closed = true; cancelAnimationFrame(frame); lifetime.abort(); clearInput();
    dialog.close(); dialog.remove();
    window.unlockBackgroundScroll?.('loot-bots');
    window.__lootlinguaRunnerInputActive = false;
    window.dispatchEvent(new Event('lootlingua:runner-input-inactive'));
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function setPanel(next, title, copy, label) {
    cancelAnimationFrame(frame); frame = 0;
    mode = next; clearInput(); core.hidden = true; dashButton.disabled = true; pause.hidden = true;
    find('[data-heading]').textContent = title; find('[data-copy]').textContent = copy;
    play.textContent = label; panel.hidden = false; showRecord(); play.focus({ preventScroll: true });
  }
  function start() {
    if (!isCurrent()) return finish();
    if (mode === 'over') { battle = createBattle(deck); recorded = false; shownQuestion = null; lastEvent = null; }
    if (mode !== 'paused') status.textContent = 'اسحب للتحرّك · اندفع للمراوغة (المسافة).';
    mode = 'play'; previous = 0; accumulator = 0; panel.hidden = true; pause.hidden = false;
    arena.focus({ preventScroll: true });
    sync();
    if (!frame && mode === 'play') frame = requestAnimationFrame(tick);
  }
  function sync() {
    const s = battle.state;
    [s.sector, s.hp, s.score, s.collected].forEach((value, index) => {
      if (hudValues[index] === value) return;
      hudValues[index] = value;
      hud[index].textContent = index === 1 ? `${value} / 5` : value;
    });
    const dashDisabled = s.phase !== 'combat' || s.time < s.dashReady;
    if (dashButton.disabled !== dashDisabled) dashButton.disabled = dashDisabled;
    if (core.hidden !== (s.phase !== 'core')) core.hidden = s.phase !== 'core';
    if (s.question && s.question !== shownQuestion) {
      shownQuestion = s.question;
      find('[data-word]').textContent = s.question.word;
      options.replaceChildren(...s.question.options.map((option, index) => {
        const button = document.createElement('button'); button.type = 'button';
        button.style.left = `${option.x / WIDTH * 100}%`;
        button.style.top = `${option.y / HEIGHT * 100}%`;
        const number = document.createElement('span'); number.textContent = index + 1; number.setAttribute('aria-hidden', 'true');
        const label = document.createElement('bdi'); label.textContent = option.label;
        button.append(number, label);
        button.addEventListener('click', () => answer(index));
        return button;
      }));
      status.textContent = `ما معنى ${s.question.word}؟ تحرّك نحو النواة، أو اخترها مباشرة.`;
    }
    if (s.event && s.event !== lastEvent) {
      lastEvent = s.event;
      if (lastEvent.type === 'wrong') {
        status.textContent = `نواة خاطئة. المعنى الصحيح: ${lastEvent.answer}. اختره لفتح القطاع ومواجهة التعزيز.`;
        s.question.wrong.forEach(index => { options.children[index].disabled = true; });
      } else {
        status.textContent = `المعنى صحيح: ${lastEvent.answer}. السلاح مشحون!`;
      }
    }
    if (s.phase === 'combat' && options.contains(document.activeElement)) arena.focus({ preventScroll: true });
    if (s.phase === 'over') {
      record();
      setPanel('over', 'انتهت المعركة', `وصلت للقطاع ${s.sector} · ${s.score} نقطة · ${s.collected} عملة`, 'العب من جديد');
    }
  }
  function answer(index) {
    if (mode === 'play' && battle.choose(index)) {
      sync();
      if (battle.state.phase === 'combat') arena.focus({ preventScroll: true });
    }
  }
  function tick(now) {
    frame = 0;
    if (closed) return;
    if (!isCurrent()) return finish();
    if (mode === 'play') {
      accumulator += previous ? Math.min(.085, (now - previous) / 1000) : 0;
      previous = now;
      const has = (arrow, key) => Number(keyboard.has(arrow) || keyboard.has(key));
      const x = joystick?.dx ?? (has('ArrowRight', 'KeyD') - has('ArrowLeft', 'KeyA'));
      const y = joystick?.dy ?? (has('ArrowDown', 'KeyS') - has('ArrowUp', 'KeyW'));
      while (accumulator >= STEP) { battle.step(STEP, x, y, dash); dash = false; accumulator -= STEP; }
      sync(); renderer.draw(battle.state, joystick);
    }
    if (mode === 'play') frame = requestAnimationFrame(tick);
  }
  function point(event) {
    const bounds = arena.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width * WIDTH, y: (event.clientY - bounds.top) / bounds.height * HEIGHT };
  }

  listen(find('[data-close]'), 'click', finish);
  listen(play, 'click', start);
  listen(pause, 'click', () => setPanel('paused', 'المعركة متوقفة', 'الساحة بانتظارك.', 'تابع اللعب'));
  listen(dashButton, 'click', () => { dash = true; arena.focus({ preventScroll: true }); });
  listen(dialog, 'cancel', event => { event.preventDefault(); if (mode === 'play') pause.click(); else finish(); });
  listen(dialog, 'keydown', event => {
    if (mode !== 'play' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (MOVEMENT.has(event.code)) { event.preventDefault(); keyboard.add(event.code); }
    if (event.code === 'Space' && !event.target.closest('button')) { event.preventDefault(); if (!event.repeat) dash = true; }
    if (/^(Digit|Numpad)[1-3]$/.test(event.code) && battle.state.phase === 'core') {
      event.preventDefault(); if (!event.repeat) answer(Number(event.code.at(-1)) - 1);
    }
  });
  listen(window, 'keyup', event => keyboard.delete(event.code));
  listen(window, 'blur', clearInput);
  listen(window, 'lootlingua:auth-state', () => { if (!isCurrent()) finish(); });
  listen(document, 'visibilitychange', () => { if (document.hidden && mode === 'play') pause.click(); });
  listen(arena, 'pointerdown', event => {
    if (mode !== 'play' || joystick || event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault(); arena.setPointerCapture(event.pointerId);
    joystick = { ...point(event), id: event.pointerId, dx: 0, dy: 0 };
  });
  listen(arena, 'pointermove', event => {
    if (event.pointerId !== joystick?.id) return;
    const p = point(event), x = p.x - joystick.x, y = p.y - joystick.y, scale = Math.max(34, Math.hypot(x, y));
    joystick.dx = x / scale; joystick.dy = y / scale;
  });
  for (const event of ['lostpointercapture', 'pointerup', 'pointercancel']) {
    listen(arena, event, e => { if (e.pointerId === joystick?.id) joystick = null; });
  }
  find('[data-source]').textContent = source;
  showRecord(); renderer.draw(battle.state);
  document.body.append(dialog);
  dialog.showModal();
  window.lockBackgroundScroll?.('loot-bots');
  window.__lootlinguaRunnerInputActive = true;
  window.dispatchEvent(new Event('lootlingua:runner-input-active'));
  return 'opened';
}
