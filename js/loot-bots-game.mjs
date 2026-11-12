import { createBattle, prepareDeck, isFighting, canDecode, bossProgress, WIDTH, HEIGHT } from './loot-bots-engine.mjs?v=3';
import { createRenderer } from './loot-bots-renderer.mjs?v=3';

const MOVEMENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
const AIM = new Set(['KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyF']);
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
        <span>السلاح <b data-tier>1</b></span><span>النقاط <b data-score>0</b></span><span>العملات <b data-coins>0</b></span>
      </div>
      <div class="lb-boss-meter" data-meter>
        <span><b data-boss-label>الزعيم القادم</b><small data-boss-detail></small></span>
        <div class="lb-track" role="progressbar" aria-label="اقتراب الزعيم القادم" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
      </div>
      <div class="lb-arena" tabindex="0" aria-label="ساحة المعركة">
        <canvas aria-hidden="true"></canvas>
        <div class="lb-announcement" hidden><strong></strong><small></small></div>
        <div class="lb-reward" hidden></div>
        <button type="button" data-dash hidden disabled><span aria-hidden="true">»</span><b>اندفاع</b><small data-charge>جاهز</small></button>
        <button type="button" class="lb-station" hidden>شغّل المحطة</button>
        <div class="lb-core" hidden role="group" aria-labelledby="lbCoreTitle">
          <div class="lb-question"><small id="lbCoreTitle">رمز محطة الطاقة · اختر معناه</small><b lang="en" dir="ltr" data-word></b></div>
          <div class="lb-options"></div>
        </div>
        <div class="lb-result" hidden><strong></strong><span></span></div>
        <div class="lb-panel">
          <strong data-heading>ساحة الروبوتات</strong>
          <p data-copy></p>
          <small data-mission>لما تفتح محطة الطاقة، فكّ رمزها لتكسب تعزيزًا وتفتح مواجهة الزعيم.</small>
          <small data-record></small>
          <button type="button" data-play autofocus>ابدأ المعركة</button>
        </div>
      </div>
      <footer class="lb-footer"><p role="status" data-status></p></footer>
      <p class="lb-note">تدريب بالكلمات فقط. النقاط والعملات خاصة باللعبة ولا ترفع الإتقان أو XP.</p>
    </section>`;
  const find = selector => dialog.querySelector(selector);
  const arena = find('.lb-arena'), renderer = createRenderer(find('canvas'));
  const panel = find('.lb-panel'), core = find('.lb-core'), options = find('.lb-options');
  const station = find('.lb-station'), result = find('.lb-result');
  const meter = find('[data-meter]'), track = find('.lb-track'), meterFill = track.firstElementChild;
  const bossLabel = find('[data-boss-label]'), bossDetail = find('[data-boss-detail]');
  const announcement = find('.lb-announcement'), rewardBadge = find('.lb-reward'), charge = find('[data-charge]');
  const status = find('[data-status]'), play = find('[data-play]'), pause = find('[data-pause]'), dashButton = find('[data-dash]');
  const hud = ['sector', 'hp', 'tier', 'score', 'coins'].map(key => find(`[data-${key}]`));
  const hudValues = [];
  const keyboard = new Set();
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const controls = coarse ? 'اسحب يسار الساحة للحركة ويمينها للتصويب والإطلاق.' : 'تحرّك بالأسهم أو WASD. صوّب بالفأرة واضغط للإطلاق.';
  const idleHint = coarse ? controls : 'الأسهم للحركة · الفأرة للإطلاق · مسافة للاندفاع.';
  let battle = createBattle(deck), mode = 'intro', frame = 0, previous = 0, accumulator = 0;
  let joystick = null, aimStick = null, mouse = null, pendingAim = null, dash = false, shownQuestion = null;
  let lastPhase = null, lastEvent = null, lastHint = '', recorded = false, closed = false;
  let lastMeter = '', lastMeterValue = -1, lastCharge = '', lastReward = null;
  let bounds;

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
    keyboard.clear(); joystick = null; aimStick = null; mouse = null; pendingAim = null; dash = false;
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
    mode = next; clearInput(); core.hidden = true; station.hidden = true; result.hidden = true;
    arena.classList.remove('is-fighting');
    dashButton.disabled = true; dashButton.hidden = true; pause.hidden = true;
    announcement.hidden = true; rewardBadge.hidden = true;
    find('[data-mission]').hidden = true;
    find('[data-heading]').textContent = title; find('[data-copy]').textContent = copy;
    play.textContent = label; panel.hidden = false; showRecord(); play.focus({ preventScroll: true });
  }
  function start() {
    if (!isCurrent()) return finish();
    if (mode === 'over') { battle = createBattle(deck); recorded = false; shownQuestion = null; lastEvent = null; lastPhase = null; }
    mode = 'play'; previous = 0; accumulator = 0; panel.hidden = true; pause.hidden = false;
    lastPhase = null;
    arena.focus({ preventScroll: true });
    sync();
    if (!frame && mode === 'play') frame = requestAnimationFrame(tick);
  }
  function sync() {
    const s = battle.state;
    [s.sector, s.hp, s.tier + 1, s.score, s.collected].forEach((value, index) => {
      if (hudValues[index] === value) return;
      hudValues[index] = value;
      hud[index].textContent = index === 1 ? `${value} / 5` : value;
    });
    const fighting = isFighting(s), remaining = Math.max(0, s.dashReady - s.time);
    const dashDisabled = !fighting || remaining > 0;
    if (dashButton.disabled !== dashDisabled) dashButton.disabled = dashDisabled;
    if (dashButton.hidden === fighting) dashButton.hidden = !fighting;
    const chargeText = remaining ? `${(Math.ceil(remaining * 10) / 10).toFixed(1)} ث` : 'جاهز';
    if (chargeText !== lastCharge) {
      lastCharge = chargeText;
      charge.textContent = chargeText;
    }
    const active = fighting && s.phase !== 'boss-warning' && s.reward && s.time < s.reward.until ? s.reward : null;
    if (active !== lastReward || rewardBadge.hidden === Boolean(active)) {
      lastReward = active;
      rewardBadge.hidden = !active;
      if (active) { rewardBadge.textContent = `${active.icon} ${active.title}`; rewardBadge.style.setProperty('--reward', active.color); }
    }
    const near = canDecode(s);
    if (station.hidden === near) {
      if (!near && document.activeElement === station) arena.focus({ preventScroll: true });
      station.hidden = !near;
    }
    if (core.hidden !== (s.phase !== 'decode')) core.hidden = s.phase !== 'decode';
    if (result.hidden !== (s.phase !== 'result')) result.hidden = s.phase !== 'result';
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      arena.classList.toggle('is-fighting', fighting);
      lastHint = '';
      const warning = s.phase === 'boss-warning', victory = s.phase === 'boss-clear';
      announcement.hidden = !warning && !victory;
      announcement.classList.toggle('is-victory', victory);
      announcement.classList.toggle('is-lower', warning && s.boss.y < HEIGHT / 2);
      if (warning) {
        announcement.firstElementChild.textContent = `احذر · ${s.boss.name}`;
        announcement.lastElementChild.textContent = s.boss.hint;
        status.textContent = `يقترب ${s.boss.name}. ${s.boss.hint}.`;
      } else if (victory) {
        announcement.firstElementChild.textContent = `هزمت ${s.victory.name}`;
        announcement.lastElementChild.textContent = `+${s.victory.coins} عملات`;
        status.textContent = `هزمت ${s.victory.name} وربحت ${s.victory.coins} عملات.`;
      }
    }
    const label = s.boss ? s.boss.name : s.phase === 'boss-clear' ? 'انتصار' : 'الزعيم القادم';
    const progress = bossProgress(s);
    const detail = s.boss ? s.phase === 'boss-warning' ? 'يقترب' : `${s.boss.hp} / ${s.boss.maxHp}` :
      s.phase === 'boss-clear' ? `+${s.victory.coins} عملات` : s.phase === 'approach' ? 'شغّل المحطة أولًا' : progress >= .76 ? 'المواجهة قريبة' : '';
    const meterKey = `${label}|${detail}|${s.phase}`;
    if (meterKey !== lastMeter) {
      lastMeter = meterKey;
      bossLabel.textContent = label; bossDetail.textContent = detail;
      meter.classList.toggle('is-threat', Boolean(s.boss));
      track.setAttribute('aria-label', s.boss ? `صحة ${s.boss.name}` : 'اقتراب الزعيم القادم');
    }
    const value = Math.round((s.boss ? s.boss.hp / s.boss.maxHp : progress) * 100);
    if (value !== lastMeterValue) {
      lastMeterValue = value;
      meterFill.style.transform = `scaleX(${value / 100})`;
      track.setAttribute('aria-valuenow', value);
    }
    if (s.phase === 'combat' || s.phase === 'approach' || s.phase === 'boss') {
      let hint = idleHint;
      if (near) hint = coarse ? 'شغّل المحطة لفكّ رمزها.' : 'شغّل المحطة لفكّ رمزها (E).';
      else if (s.phase === 'approach') hint = 'محطة الطاقة تفتح في وسط الساحة. اقترب منها.';
      else if (s.defense) hint = 'دفاع المحطة نشط. راوغ خطوط التصويب.';
      else if (s.boss) hint = s.boss.hint;
      else if (active) hint = active.description;
      if (hint !== lastHint) { lastHint = hint; status.textContent = hint; }
    }
    if (s.question && s.question !== shownQuestion) {
      shownQuestion = s.question;
      find('[data-word]').textContent = s.question.word;
      options.replaceChildren(...s.question.options.map((option, index) => {
        const button = document.createElement('button'); button.type = 'button';
        const number = document.createElement('span'); number.textContent = index + 1; number.setAttribute('aria-hidden', 'true');
        const label = document.createElement('bdi'); label.textContent = option.label;
        button.append(number, label);
        button.addEventListener('click', () => answer(index));
        return button;
      }));
      status.textContent = `المحطة أوقفت القتال مؤقتًا. ما معنى ${s.question.word}؟`;
      options.firstElementChild?.focus({ preventScroll: true });
    }
    if (s.event && s.event !== lastEvent) {
      lastEvent = s.event;
      const wrong = lastEvent.type === 'wrong';
      result.classList.toggle('is-wrong', wrong);
      result.firstElementChild.textContent = wrong ? 'رمز خاطئ · دفاع المحطة تفعّل' : `${lastEvent.reward.icon} ${lastEvent.reward.title}`;
      result.lastElementChild.textContent = wrong ? `المعنى الصحيح: ${lastEvent.word} — ${lastEvent.answer}` : lastEvent.reward.description;
      status.textContent = wrong ? `المعنى الصحيح: ${lastEvent.answer}. استعد لمراوغة دفاع المحطة.` : `المعنى صحيح: ${lastEvent.answer}. ${lastEvent.reward.description}.`;
    }
    if (s.phase === 'over') {
      record();
      setPanel('over', 'انتهت المعركة', `${s.bossWins} زعيم هزمته · ${s.score} نقطة · ${s.collected} عملة`, 'العب من جديد');
    }
  }
  function answer(index) {
    if (mode === 'play' && battle.choose(index)) {
      clearInput();
      sync();
      arena.focus({ preventScroll: true });
    }
  }
  function activate() {
    if (mode !== 'play' || !battle.activate()) return;
    clearInput(); sync();
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
      const player = battle.state.player;
      const target = mouse?.held ? mouse : aimStick?.dragged ? null : aimStick;
      const keyX = has('KeyL') - has('KeyJ'), keyY = has('KeyK') - has('KeyI');
      while (accumulator >= STEP) {
        let aimX = target ? target.x - player.x : aimStick?.dx ?? keyX;
        let aimY = target ? target.y - player.y : aimStick?.dy ?? keyY;
        if (!aimX && !aimY) {
          if (pendingAim) ({ x: aimX, y: aimY } = pendingAim);
          else if (keyboard.has('KeyF')) { aimX = Math.cos(player.angle); aimY = Math.sin(player.angle); }
        }
        battle.step(STEP, x, y, dash, aimX, aimY);
        dash = false; pendingAim = null; accumulator -= STEP;
      }
      sync(); renderer.draw(battle.state, joystick, aimStick, mouse);
    }
    if (mode === 'play') frame = requestAnimationFrame(tick);
  }
  function point(event) {
    bounds ||= arena.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width * WIDTH, y: (event.clientY - bounds.top) / bounds.height * HEIGHT };
  }

  listen(find('[data-close]'), 'click', finish);
  listen(play, 'click', start);
  listen(station, 'click', activate);
  listen(pause, 'click', () => setPanel('paused', 'المعركة متوقفة', 'الساحة بانتظارك.', 'تابع اللعب'));
  function requestDash() { dash = true; arena.focus({ preventScroll: true }); }
  listen(dashButton, 'pointerdown', event => { if (event.button === 0) { event.preventDefault(); requestDash(); } });
  listen(dashButton, 'click', event => { if (event.detail === 0) requestDash(); });
  listen(dialog, 'cancel', event => { event.preventDefault(); if (mode === 'play') pause.click(); else finish(); });
  listen(dialog, 'keydown', event => {
    if (mode !== 'play' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isFighting(battle.state) && (MOVEMENT.has(event.code) || AIM.has(event.code))) { event.preventDefault(); keyboard.add(event.code); }
    if (event.code === 'KeyE' && !event.repeat) activate();
    if (event.code === 'Space' && !event.target.closest('button')) { event.preventDefault(); if (!event.repeat) dash = true; }
    if (/^(Digit|Numpad)[1-3]$/.test(event.code) && battle.state.phase === 'decode') {
      event.preventDefault(); if (!event.repeat) answer(Number(event.code.at(-1)) - 1);
    }
  });
  listen(window, 'keyup', event => keyboard.delete(event.code));
  listen(window, 'blur', clearInput);
  listen(window, 'lootlingua:auth-state', () => { if (!isCurrent()) finish(); });
  listen(document, 'visibilitychange', () => { if (document.hidden && mode === 'play') pause.click(); });
  listen(window, 'resize', () => { bounds = null; renderer.resize(); if (mode !== 'play') renderer.draw(battle.state); });
  listen(arena, 'pointerdown', event => {
    if (mode !== 'play' || !isFighting(battle.state) || event.button !== 0 || event.target.closest('button')) return;
    bounds = arena.getBoundingClientRect();
    const p = point(event), id = event.pointerId, player = battle.state.player;
    if (event.pointerType === 'mouse') mouse = { ...p, id, held: true };
    else if (p.x < WIDTH / 2 && !joystick) joystick = { ...p, id, dx: 0, dy: 0 };
    else if (p.x >= WIDTH / 2 && !aimStick) aimStick = { ...p, id, dx: 0, dy: 0, dragged: false };
    else return;
    if (mouse?.id === id || aimStick?.id === id) pendingAim = { x: p.x - player.x, y: p.y - player.y };
    event.preventDefault(); arena.setPointerCapture(id);
    if (document.activeElement !== arena) arena.focus({ preventScroll: true });
  });
  listen(arena, 'pointermove', event => {
    if (event.pointerType === 'mouse') {
      if (mode === 'play' && isFighting(battle.state)) mouse = { ...point(event), id: event.pointerId, held: mouse?.held || false };
      return;
    }
    const stick = event.pointerId === joystick?.id ? joystick : event.pointerId === aimStick?.id ? aimStick : null;
    if (!stick) return;
    const p = point(event), x = p.x - stick.x, y = p.y - stick.y, gap = Math.hypot(x, y);
    const scale = Math.max(38, gap);
    stick.dx = x / scale; stick.dy = y / scale;
    if (stick === aimStick && gap > 10) stick.dragged = true;
  });
  listen(arena, 'pointerleave', () => { if (!mouse?.held) mouse = null; });
  for (const event of ['lostpointercapture', 'pointerup', 'pointercancel']) {
    listen(arena, event, e => {
      if (e.pointerId === joystick?.id) joystick = null;
      if (e.pointerId === aimStick?.id) aimStick = null;
      if (e.pointerId === mouse?.id) mouse.held = false;
      if (event === 'pointercancel') pendingAim = null;
    });
  }
  find('[data-source]').textContent = source;
  find('[data-copy]').textContent = controls;
  status.textContent = coarse ? 'يسار الساحة للحركة · يمينها للتصويب والإطلاق.' : 'IJKL للتصويب والإطلاق بلوحة المفاتيح.';
  showRecord();
  document.body.append(dialog);
  dialog.showModal();
  renderer.resize(); renderer.draw(battle.state);
  window.lockBackgroundScroll?.('loot-bots');
  window.__lootlinguaRunnerInputActive = true;
  window.dispatchEvent(new Event('lootlingua:runner-input-active'));
  return 'opened';
}
