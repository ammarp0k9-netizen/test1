import { createBattle, prepareDeck, isFighting, canDecode, bossProgress, MAX_CELLS } from './loot-bots-engine.mjs?v=6';
import { arenaForAspect } from './loot-bots-arena.mjs?v=3';
import { createRenderer } from './loot-bots-renderer.mjs?v=6';
import { createBotsAudio } from './loot-bots-audio.mjs?v=1';

const MOVEMENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
const AIM = new Set(['KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyF']);
const STEP = 1 / 60;
const AIM_GUIDE_KEY = 'lootlingua.bots.drag-aim-seen.v1';
const LAST_BOSS_KEY = 'lootlingua.bots.last-boss.v1';
const readHint = key => { try { return localStorage.getItem(key); } catch { return null; } };
const saveHint = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

export function openBattle({ words, source, isCurrent, returnFocus }) {
  const deck = prepareDeck(words);
  if (!deck.prompts.length) return 'small';

  const profile = window.LootLinguaBots;
  const uid = window.auth?.currentUser?.uid || '';
  const audio = createBotsAudio(profile?.progress(uid)?.audio);
  const lifetime = new AbortController();
  const listen = (target, event, fn) => target.addEventListener(event, fn, { signal: lifetime.signal });
  const dialog = document.createElement('dialog');
  dialog.className = 'loot-bots'; dialog.dir = 'rtl'; dialog.setAttribute('aria-labelledby', 'lootBotsTitle');
  dialog.dataset.nativeModal = '';
  dialog.innerHTML = `
    <section class="lb-shell">
      <header class="lb-header">
        <div><h2 id="lootBotsTitle" lang="en" dir="ltr">Loot Bots</h2><p data-source></p></div>
        <div class="lb-actions"><button type="button" data-pause hidden>إيقاف مؤقت</button><button type="button" data-sound aria-expanded="false" aria-controls="lbAudioSettings">الصوت</button><button type="button" data-close>خروج</button></div>
      </header>
      <div class="lb-hud">
        <span class="lb-health">الصحة <b data-hp role="img" aria-label="5 من 5 قلوب">♥♥♥♥♥</b></span>
        <span>القطاع <b data-sector>1</b></span><span>السلاح <b data-tier>1</b></span><span>النقاط <b data-score>0</b></span><span>العملات <b data-coins>0</b></span>
      </div>
      <div class="lb-boss-meter" data-meter>
        <span><b data-boss-label>الزعيم القادم</b><small data-boss-detail></small></span>
        <div class="lb-track" role="progressbar" aria-label="اقتراب الزعيم القادم" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
      </div>
      <div class="lb-arena" tabindex="0" aria-label="ساحة المعركة">
        <canvas aria-hidden="true"></canvas>
        <div class="lb-announcement" hidden><strong></strong><small></small></div>
        <div class="lb-reward" hidden></div>
        <div class="lb-aim-guide" hidden><strong>اسحب من زر «إطلاق»</strong><span>وجّه السحبة نحو الخصم، وخلّي إصبعك ضاغط للإطلاق.</span></div>
        <div class="lb-combat-controls" hidden>
          <div class="lb-weapon"><b data-cells>5 / 5</b><small>السلاح</small></div>
          <div><button type="button" data-dash disabled><span aria-hidden="true">»</span><b>اندفاع</b><small data-charge>جاهز</small></button>
            <button type="button" data-fire aria-label="إطلاق، اسحب من الزر للتصويب" hidden>إطلاق</button></div>
        </div>
        <button type="button" class="lb-station" hidden>شغّل المحطة</button>
        <div class="lb-core" hidden role="group" aria-labelledby="lbCoreTitle">
          <div class="lb-question"><small id="lbCoreTitle">رمز محطة الطاقة · اختر معناه</small><b lang="en" dir="ltr" data-word></b><button type="button" data-repeat hidden>اسمع الكلمة</button></div>
          <div class="lb-options"></div>
        </div>
        <div class="lb-result" hidden><strong></strong><span></span></div>
        <div class="lb-panel">
          <strong data-heading>ساحة الروبوتات</strong>
          <p data-copy></p>
          <small data-mission>لما تفتح محطة الطاقة، فكّ رمزها لتكسب تعزيزًا وتفتح مواجهة الزعيم.</small>
          <small data-record></small>
          <fieldset id="lbAudioSettings" hidden><legend>إعدادات الصوت</legend>
            <label><input type="checkbox" data-effects> صوت المؤثرات</label>
            <label><input type="checkbox" data-speech> نطق الكلمات</label>
          </fieldset>
          <button type="button" data-play autofocus>ابدأ المعركة</button>
        </div>
      </div>
      <footer class="lb-footer"><p role="status" data-status></p></footer>
      <p class="lb-note">تدريب فقط · العملات والنقاط خارج الإتقان وXP.</p>
    </section>`;
  const find = selector => dialog.querySelector(selector);
  const arena = find('.lb-arena'), canvas = find('canvas');
  let geometry, renderer, view, battle;
  const panel = find('.lb-panel'), core = find('.lb-core'), options = find('.lb-options');
  const station = find('.lb-station'), result = find('.lb-result');
  const meter = find('[data-meter]'), track = find('.lb-track'), meterFill = track.firstElementChild;
  const bossLabel = find('[data-boss-label]'), bossDetail = find('[data-boss-detail]');
  const announcement = find('.lb-announcement'), rewardBadge = find('.lb-reward'), charge = find('[data-charge]');
  const status = find('[data-status]'), play = find('[data-play]'), pause = find('[data-pause]'), dashButton = find('[data-dash]');
  const combatControls = find('.lb-combat-controls'), weapon = find('.lb-weapon'), fireButton = find('[data-fire]');
  const aimGuide = find('.lb-aim-guide');
  const hud = ['sector', 'hp', 'tier', 'cells', 'score', 'coins'].map(key => find(`[data-${key}]`));
  const sound = find('[data-sound]'), audioOptions = find('#lbAudioSettings'), repeat = find('[data-repeat]');
  const toggles = { effects: find('[data-effects]'), speech: find('[data-speech]') };
  const hudValues = [];
  const keyboard = new Set();
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const controls = coarse ? 'اسحب يسار الساحة للحركة. اسحب من زر «إطلاق» لتصوّب وتطلق. لمسة سريعة تطلق في آخر اتجاه اخترته.' : 'تحرّك بالأسهم أو WASD. صوّب بالفأرة واضغط للإطلاق.';
  const idleHint = coarse ? 'يسار الساحة للحركة · اسحب من زر إطلاق للتصويب.' : 'الأسهم للحركة · الفأرة للإطلاق · مسافة للاندفاع.';
  let mode = 'intro', frame = 0, previous = 0, accumulator = 0, runId, outcome;
  let joystick = null, mouse = null, pendingAim = null, dash = false, shownQuestion = null;
  let fireDrag = null, lastAim = { x: 0, y: -1 }, guideUntil = readHint(AIM_GUIDE_KEY) ? 0 : Infinity;
  let lastBoss = readHint(LAST_BOSS_KEY);
  let lastPhase = null, lastEvent = null, lastHint = '', recorded = false, closed = false;
  let lastMeter = '', lastMeterValue = -1, lastCharge = '', lastReward = null;
  let bounds;

  function resize() {
    bounds = null;
    view = renderer.resize();
    station.style.top = `${view.top + (geometry.station.y + 44) * view.fit}px`;
    if (mode !== 'play') renderer.draw(battle.state);
  }
  function newRound() {
    geometry = arenaForAspect(arena.clientWidth / arena.clientHeight);
    renderer = createRenderer(canvas, geometry, true);
    battle = createBattle(deck, Math.random, geometry, lastBoss);
    lastAim = { x: 0, y: -1 };
    if (guideUntil !== Infinity) guideUntil = 0;
    runId = profile?.newRunId(); outcome = null;
    resize();
  }
  function record() {
    if (recorded) return;
    recorded = true;
    const s = battle.state;
    outcome = profile?.record(uid, runId, { best: s.score, coins: s.collected, bosses: s.bossWins, seconds: Math.floor(s.time) });
  }
  function showRecord() {
    const saved = profile?.progress(uid) || {};
    const labels = { best: 'النقاط', bosses: 'الزعماء', seconds: 'الصمود' };
    find('[data-record]').textContent = outcome?.saved === false ? 'تعذّر حفظ نتيجة الجولة.' : outcome?.records?.length ?
      `رقم قياسي جديد في ${outcome.records.map(key => labels[key]).join(' و')}` :
      `أفضل نتيجة ${saved.best || 0} · ${saved.coins || 0} عملة · أفضل صمود ${saved.seconds || 0} ث`;
  }
  function readAudioSettings() {
    const settings = profile?.progress(uid)?.audio || {};
    for (const [field, toggle] of Object.entries(toggles)) {
      const enabled = settings[field]?.enabled !== false;
      toggle.checked = enabled; audio.set(field, enabled);
    }
    toggles.speech.disabled = !audio.canSpeak;
    repeat.hidden = !audio.canSpeak || !toggles.speech.checked;
  }
  function clearInput() {
    keyboard.clear(); joystick = null; mouse = null; pendingAim = null; dash = false; fireDrag = null;
  }
  function finish() {
    if (closed) return;
    if (mode !== 'intro') record();
    closed = true; cancelAnimationFrame(frame); lifetime.abort(); clearInput();
    audio.close();
    dialog.close(); dialog.remove();
    window.unlockBackgroundScroll?.('loot-bots');
    window.__lootlinguaRunnerInputActive = false;
    window.dispatchEvent(new Event('lootlingua:runner-input-inactive'));
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function setPanel(next, title, copy, label) {
    cancelAnimationFrame(frame); frame = 0;
    audio.stopSpeech();
    mode = next; clearInput(); core.hidden = true; station.hidden = true; result.hidden = true;
    arena.classList.remove('is-fighting');
    dashButton.disabled = true; combatControls.hidden = true; pause.hidden = true;
    aimGuide.hidden = true;
    announcement.hidden = true; rewardBadge.hidden = true;
    find('[data-mission]').hidden = true;
    find('[data-heading]').textContent = title; find('[data-copy]').textContent = copy;
    play.textContent = label; panel.hidden = false; showRecord(); play.focus({ preventScroll: true });
  }
  function start() {
    if (closed || mode === 'play') return;
    if (!isCurrent()) { finish(); window.showToast?.('تغيّر مصدر الكلمات. افتح الساحة من جديد.', 'info'); return; }
    try {
      const aspect = arena.clientWidth / arena.clientHeight;
      if (mode === 'over' || (mode === 'intro' && Math.abs(geometry.width / geometry.height - aspect) > .1)) {
        newRound(); recorded = false; shownQuestion = null; lastEvent = null; lastPhase = null;
      } else resize();
    } catch {
      status.textContent = 'تعذّر تجهيز عرض الساحة. جرّب البدء مرة ثانية.';
      return;
    }
    audio.unlock(); audioOptions.hidden = true; sound.setAttribute('aria-expanded', 'false');
    mode = 'play'; previous = 0; accumulator = 0; panel.hidden = true; pause.hidden = false;
    lastPhase = null;
    arena.focus({ preventScroll: true });
    sync();
    if (battle.state.phase === 'decode') audio.say(battle.state.question.word);
    if (!frame && mode === 'play') frame = requestAnimationFrame(tick);
  }
  function sync() {
    const s = battle.state;
    [s.sector, s.hp, s.tier + 1, s.cells, s.score, s.collected].forEach((value, index) => {
      if (hudValues[index] === value) return;
      hudValues[index] = value;
      hud[index].textContent = index === 1 ? '♥'.repeat(value) + '♡'.repeat(5 - value) : index === 3 ? value ? `${value} / ${MAX_CELLS}` : 'السلاح يبرد…' : value;
      if (index === 1) hud[index].setAttribute('aria-label', `${value} من 5 قلوب`);
      if (index === 3) weapon.classList.toggle('is-cooling', !value);
    });
    const fighting = isFighting(s), remaining = Math.max(0, s.dashReady - s.time);
    const dashDisabled = !fighting || remaining > 0;
    if (dashButton.disabled !== dashDisabled) dashButton.disabled = dashDisabled;
    if (combatControls.hidden === fighting) combatControls.hidden = !fighting;
    const guideVisible = coarse && s.phase === 'combat' && s.time < guideUntil;
    if (aimGuide.hidden === guideVisible) aimGuide.hidden = !guideVisible;
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
      announcement.classList.toggle('is-lower', warning && s.boss.y < geometry.height / 2);
      if (warning) {
        lastBoss = s.boss.id; saveHint(LAST_BOSS_KEY, lastBoss);
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
      setPanel('over', 'انتهت المعركة', `${s.bossWins} زعيم هزمته · ${s.score} نقطة · ${s.collected} عملة · ${Math.floor(s.time)} ث صمود`, 'العب من جديد');
    }
  }
  function answer(index) {
    if (mode === 'play' && battle.choose(index)) {
      audio.stopSpeech(); audio.play(battle.state.cues); battle.state.cues = 0;
      clearInput();
      sync();
      arena.focus({ preventScroll: true });
    }
  }
  function activate() {
    if (mode !== 'play' || !battle.activate()) return;
    clearInput(); sync(); audio.say(battle.state.question.word);
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
      const target = mouse?.held ? mouse : null;
      const keyX = has('KeyL') - has('KeyJ'), keyY = has('KeyK') - has('KeyI');
      while (accumulator >= STEP) {
        let aimX = target ? target.x - player.x : fireDrag?.direction?.x ?? keyX;
        let aimY = target ? target.y - player.y : fireDrag?.direction?.y ?? keyY;
        if (!aimX && !aimY) {
          if (pendingAim) ({ x: aimX, y: aimY } = pendingAim);
          else if (keyboard.has('KeyF')) { aimX = Math.cos(player.angle); aimY = Math.sin(player.angle); }
        }
        const previousShot = battle.state.muzzleUntil;
        battle.step(STEP, x, y, dash, aimX, aimY);
        if (fireDrag?.direction && battle.state.muzzleUntil !== previousShot) fireDrag.fired = true;
        if (pendingAim && (battle.state.muzzleUntil !== previousShot || battle.state.time >= pendingAim.until)) pendingAim = null;
        dash = false; accumulator -= STEP;
      }
      sync(); renderer.draw(battle.state, joystick, mouse, fireDrag?.direction);
      audio.play(battle.state.cues); battle.state.cues = 0;
    }
    if (mode === 'play') frame = requestAnimationFrame(tick);
  }
  function point(event) {
    bounds ||= arena.getBoundingClientRect();
    return { x: (event.clientX - bounds.left - view.left) / view.fit, y: (event.clientY - bounds.top - view.top) / view.fit };
  }

  listen(find('[data-close]'), 'click', finish);
  listen(play, 'click', start);
  let startTouch = null;
  listen(play, 'pointerdown', event => {
    if (event.pointerType === 'touch') startTouch = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  listen(play, 'pointercancel', () => { startTouch = null; });
  listen(play, 'pointerup', event => {
    if (startTouch?.id !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - startTouch.x, event.clientY - startTouch.y);
    startTouch = null;
    if (distance < 14) start();
  });
  listen(station, 'click', activate);
  listen(repeat, 'click', () => audio.say(battle.state.question?.word));
  listen(sound, 'click', () => {
    if (mode === 'play') pause.click();
    audioOptions.hidden = !audioOptions.hidden;
    sound.setAttribute('aria-expanded', String(!audioOptions.hidden));
    if (!audioOptions.hidden) toggles.effects.focus();
  });
  for (const [field, toggle] of Object.entries(toggles)) listen(toggle, 'change', () => {
    audio.set(field, toggle.checked);
    if (field === 'effects' && toggle.checked) audio.unlock();
    if (field === 'speech') repeat.hidden = !toggle.checked;
    if (profile?.saveAudio(uid, field, toggle.checked) === false) status.textContent = 'تعذّر حفظ إعداد الصوت.';
  });
  listen(pause, 'click', () => setPanel('paused', 'المعركة متوقفة', 'الساحة بانتظارك.', 'تابع اللعب'));
  function requestDash() { dash = true; arena.focus({ preventScroll: true }); }
  listen(dashButton, 'pointerdown', event => { if (event.button === 0) { event.preventDefault(); requestDash(); } });
  listen(dashButton, 'click', event => { if (event.detail === 0) requestDash(); });
  fireButton.hidden = !coarse;
  listen(fireButton, 'pointerdown', event => {
    if (event.button !== 0 || fireDrag || !isFighting(battle.state)) return;
    event.preventDefault();
    fireDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, direction: null, fired: false };
    fireButton.setPointerCapture(event.pointerId);
  });
  listen(fireButton, 'pointermove', event => {
    if (fireDrag?.id !== event.pointerId) return;
    const x = event.clientX - fireDrag.x, y = event.clientY - fireDrag.y;
    const gap = Math.hypot(x, y);
    if (gap < (fireDrag.direction ? 6 : 11)) return;
    lastAim = fireDrag.direction = { x: x / gap, y: y / gap };
    if (guideUntil === Infinity) {
      guideUntil = Math.max(3, battle.state.time + 2.6);
      aimGuide.firstElementChild.textContent = 'هيك بتصوّب وتطلق';
      aimGuide.lastElementChild.textContent = 'لمسة سريعة تطلق في آخر اتجاه اخترته.';
      saveHint(AIM_GUIDE_KEY, '1');
    }
  });
  function tapFire() { pendingAim = { ...lastAim, until: battle.state.time + .16 }; }
  listen(fireButton, 'click', event => { if (event.detail === 0) tapFire(); });
  for (const type of ['lostpointercapture', 'pointerup', 'pointercancel']) listen(fireButton, type, event => {
    if (fireDrag?.id !== event.pointerId) return;
    if (type === 'pointerup' && !fireDrag.fired) tapFire();
    fireDrag = null;
  });
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
  listen(window, 'lootlingua:bots-profile', () => { if (isCurrent()) { readAudioSettings(); if (mode !== 'play') showRecord(); } });
  listen(window, 'pagehide', finish);
  listen(document, 'visibilitychange', () => { if (document.hidden && mode === 'play') pause.click(); });
  listen(window, 'resize', resize);
  listen(arena, 'pointerdown', event => {
    if (mode !== 'play' || !isFighting(battle.state) || event.button !== 0 || event.target.closest('button')) return;
    bounds = arena.getBoundingClientRect();
    const p = point(event), id = event.pointerId, player = battle.state.player;
    if (event.pointerType === 'mouse') mouse = { ...p, id, held: true };
    else if (p.x < geometry.width / 2 && !joystick) joystick = { ...p, id, dx: 0, dy: 0 };
    else return;
    if (mouse?.id === id) pendingAim = { x: p.x - player.x, y: p.y - player.y, until: battle.state.time + .16 };
    event.preventDefault(); arena.setPointerCapture(id);
    if (document.activeElement !== arena) arena.focus({ preventScroll: true });
  });
  listen(arena, 'pointermove', event => {
    if (event.pointerType === 'mouse') {
      if (mode === 'play' && isFighting(battle.state)) mouse = { ...point(event), id: event.pointerId, held: mouse?.held || false };
      return;
    }
    const stick = event.pointerId === joystick?.id ? joystick : null;
    if (!stick) return;
    const p = point(event), x = p.x - stick.x, y = p.y - stick.y, gap = Math.hypot(x, y);
    const scale = Math.max(38, gap);
    stick.dx = x / scale; stick.dy = y / scale;
  });
  listen(arena, 'pointerleave', () => { if (!mouse?.held) mouse = null; });
  for (const event of ['lostpointercapture', 'pointerup', 'pointercancel']) {
    listen(arena, event, e => {
      if (e.pointerId === joystick?.id) joystick = null;
      if (e.pointerId === mouse?.id) mouse.held = false;
      if (event === 'pointercancel') pendingAim = null;
    });
  }
  find('[data-source]').textContent = source;
  find('[data-copy]').textContent = controls;
  status.textContent = coarse ? idleHint : 'IJKL للتصويب والإطلاق بلوحة المفاتيح.';
  showRecord();
  document.body.append(dialog);
  try {
    dialog.showModal();
    newRound(); readAudioSettings();
  } catch (error) {
    lifetime.abort(); audio.close(); dialog.remove();
    throw error;
  }
  window.lockBackgroundScroll?.('loot-bots');
  window.__lootlinguaRunnerInputActive = true;
  window.dispatchEvent(new Event('lootlingua:runner-input-active'));
  return 'opened';
}
