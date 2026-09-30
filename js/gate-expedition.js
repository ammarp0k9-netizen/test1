/* Lightweight between-review games. Cosmetic only: never changes SRS, XP, or gate progress. */
(function () {
  'use strict';

  const STORAGE_PREFIX = 'lootlingua.gate-expedition.v1';
  const RELIC_TARGET = 6;
  const now = () => window.LootLinguaTestClock?.effectiveNow?.() || Date.now();
  const millis = (value) => {
    if (typeof value?.toMillis === 'function') return Number(value.toMillis()) || 0;
    if (value?.seconds != null) return Number(value.seconds) * 1000;
    return value instanceof Date ? value.getTime() : Number(value) || 0;
  };
  const hash = (value) => Array.from(String(value)).reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 7);
  const keyForUser = () => `${STORAGE_PREFIX}.${window.auth?.currentUser?.uid || 'guest'}`;
  const read = () => {
    try { return JSON.parse(localStorage.getItem(keyForUser())) || { version: 1, windows: {}, relics: {} }; }
    catch { return { version: 1, windows: {}, relics: {} }; }
  };
  const write = (state) => localStorage.setItem(keyForUser(), JSON.stringify(state));
  const gateKey = ({ worldId, rankId, gateId }) => `${worldId}/${rankId}/${gateId}`;
  const windowTarget = (kind, remaining) => {
    if (kind === 'two-hour') return remaining < 20 * 60000 ? 1 : 2;
    return remaining < 90 * 60000 ? 1 : remaining < 6 * 3600000 ? 2 : 4;
  };
  const gameFor = (gate, kind) => {
    const first = hash(gateKey(gate)) % 2 === 0 ? 'dash' : 'maze';
    return kind === 'two-hour' ? first : (first === 'dash' ? 'maze' : 'dash');
  };

  function resolveWindow(context, at = now()) {
    const progress = context.progress || {};
    const nextAt = millis(progress.readinessNextAt);
    const later = Math.max(0, Number(progress.waitingLaterTodayCount) || 0);
    const tomorrow = Math.max(0, Number(progress.waitingNextDayCount) || 0);
    if (!nextAt || (!later && !tomorrow)) return null;
    const kind = later > 0 ? 'two-hour' : 'next-day';
    const id = `${gateKey(context)}:${kind}:${nextAt}`;
    return { id, kind, nextAt, remaining: nextAt - at, target: windowTarget(kind, nextAt - at), gameId: gameFor(context, kind) };
  }

  function getView(context, at = now()) {
    const state = read();
    const current = resolveWindow(context, at);
    const prefix = `${gateKey(context)}:`;
    const old = Object.values(state.windows).filter((entry) => entry.gateKey === gateKey(context) && entry.endsAt <= at && !entry.completedAt && !entry.expiredAt).sort((a, b) => b.endsAt - a.endsAt)[0];
    if (old) { old.expiredAt = at; write(state); }
    const relic = state.relics[gateKey(context)] || { shards: 0, completedAt: 0 };
    if (!current) {
      if (Number(context.progress?.availableForReviewNowCount) > 0) {
        return { mode: 'official-due', window: old || null, relic };
      }
      return old ? { mode: 'expired', window: old, relic } : null;
    }
    if (current.remaining <= 0) return { mode: 'official-due', window: old || current, relic };
    let entry = state.windows[current.id];
    if (!entry) {
      entry = state.windows[current.id] = {
        id: current.id, gateKey: gateKey(context), kind: current.kind, gameId: current.gameId,
        startsAt: at, endsAt: current.nextAt, target: current.target, shards: 0, completedAt: 0, expiredAt: 0
      };
      write(state);
    }
    return { mode: entry.completedAt ? 'completed' : 'waiting', window: entry, relic };
  }

  function award(context) {
    const state = read();
    const view = getView(context);
    if (!view?.window || view.mode !== 'waiting') return null;
    const entry = state.windows[view.window.id];
    entry.shards = Math.min(entry.target, entry.shards + 1);
    const relicKey = gateKey(context);
    const relic = state.relics[relicKey] || { shards: 0, completedAt: 0 };
    relic.shards = Math.min(RELIC_TARGET, relic.shards + 1);
    if (entry.shards >= entry.target) entry.completedAt = now();
    if (relic.shards >= RELIC_TARGET && !relic.completedAt) relic.completedAt = now();
    state.relics[relicKey] = relic;
    write(state);
    return { entry, relic, newlyComplete: Boolean(entry.completedAt && entry.shards === entry.target), relicComplete: Boolean(relic.completedAt && relic.shards === RELIC_TARGET) };
  }

  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const waitLabel = (remaining) => {
    const min = Math.max(1, Math.ceil(remaining / 60000));
    if (min < 60) return `${min} دقيقة`;
    const h = Math.ceil(min / 60); return h === 1 ? 'ساعة تقريبًا' : `${h} ساعات تقريبًا`;
  };

  function render(context) {
    const view = getView(context);
    if (!view) return null;
    const card = el('aside', `gate-expedition-card is-${view.mode}`);
    const title = el('strong', 'gate-expedition-title');
    title.innerHTML = '<i class="fa-solid fa-gem"></i> مغامرة الانتظار';
    card.append(title);
    if (view.mode === 'official-due') {
      card.append(el('p', '', 'المراجعة الرسمية لهذه البوابة أصبحت جاهزة الآن. الألعاب الجانبية متوقفة كي تركّز على الاختبار الذي يرفع تقدّمك.'));
      if (view.window?.expiredAt) card.append(el('small', 'gate-expedition-missed', `انتهت نافذة الأثر عند ${view.window.shards || 0} / ${view.window.target || 0}. لم تخسر أي تقدّم؛ احتفظت بالشظايا التي جمعتها وستأتيك نافذة جديدة.`));
      return card;
    }
    if (view.mode === 'expired') {
      card.append(el('p', '', 'انتهى موعد هذه المغامرة، لكن لا توجد أي عقوبة على البوابة أو المراجعات.'));
      card.append(el('small', 'gate-expedition-missed', `جمعت ${view.window.shards || 0} من ${view.window.target || 0} شظايا؛ ستبقى معك ضمن أثر البوابة.`));
      return card;
    }
    const gameName = view.window.gameId === 'dash' ? 'اندفاع البوابة' : 'متاهة الأثر';
    card.append(el('p', '', view.mode === 'completed'
      ? 'أكملت هدف هذه الفترة. استمتع إن أحببت، لكن الألعاب لن ترفع شريط البوابة قبل الموعد الرسمي.'
      : `أمامك ${waitLabel(view.window.endsAt - now())} قبل المراجعة الرسمية. العب ${gameName} واجمع شظايا الأثر دون أن تؤثر اللعبة على SRS.`));
    const meter = el('div', 'gate-expedition-meter');
    meter.append(el('span', '', `شظايا الفترة: ${view.window.shards} / ${view.window.target}`));
    meter.append(el('span', '', `أثر البوابة: ${view.relic.shards || 0} / ${RELIC_TARGET}`));
    card.append(meter);
    if (view.relic.completedAt) card.append(el('small', 'gate-expedition-relic', '✦ اكتمل أثر البوابة — شارة مرئية لرحلتك.'));
    if (view.mode === 'waiting') {
      const button = el('button', 'gate-expedition-play', `العب ${gameName}`);
      button.type = 'button';
      button.addEventListener('click', () => launch(context, view.window));
      card.append(button);
    }
    return card;
  }

  function modalShell(title, subtitle) {
    const overlay = el('div', 'gate-expedition-overlay');
    const modal = el('section', 'gate-expedition-modal');
    const close = el('button', 'gate-expedition-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'إغلاق اللعبة');
    close.addEventListener('click', () => overlay.remove());
    modal.append(close, el('h3', '', title), el('p', 'gate-expedition-subtitle', subtitle)); overlay.append(modal); document.body.append(overlay);
    return { overlay, modal };
  }
  function finish(context, shell, won) {
    if (!won) { shell.modal.append(el('p', 'gate-expedition-result is-loss', 'قريب جدًا! أعد المحاولة؛ لا توجد خسارة ولا تأثير على المراجعات.')); return; }
    const result = award(context); if (!result) return;
    shell.modal.innerHTML = '';
    shell.modal.append(el('h3', '', result.relicComplete ? 'اكتمل أثر البوابة!' : 'حصلت على شظية أثر'), el('p', 'gate-expedition-result is-win', result.newlyComplete ? 'أنهيت هدف هذه الفترة. تقدّم البوابة نفسه ينتظر موعد المراجعة الرسمي.' : 'شظية محفوظة. أكمل الجولات قبل الموعد لتحصل على أثر البوابة.'));
    const close = el('button', 'gate-expedition-play', 'رجوع إلى البوابة'); close.type = 'button'; close.addEventListener('click', () => { shell.overlay.remove(); window.loadPublishedWorldDetail?.(); }); shell.modal.append(close);
  }

  function launchDash(context) {
    const shell = modalShell('اندفاع البوابة', 'اجمع 8 شظايا ذهبية ✦، وتفادَ الشقوق الحمراء ✕. لديك 3 قلوب و35 ثانية. هذه لعبة جانبية، وليست اختبار كلمات.');
    const target = 8;
    let lane = 1, energy = 0, hits = 0, running = true, elapsed = 0, last = performance.now();
    const hud = el('div', 'gate-dash-hud');
    const arena = el('div', 'gate-dash-arena');
    const legend = el('div', 'gate-dash-legend', '✦ اجمعها  ·  ✕ تجنبها');
    const player = el('div', 'gate-dash-player');
    const updateHud = () => { hud.textContent = `شظايا ${energy} / ${target} · قلوب ${'♥'.repeat(Math.max(0, 3 - hits))}${'♡'.repeat(Math.min(3, hits))} · ${Math.max(0, 35 - Math.floor(elapsed / 1000))}ث`; };
    player.style.setProperty('--lane', lane);
    arena.append(legend, player); shell.modal.append(hud, arena);
    const move = (delta) => { lane = Math.max(0, Math.min(2, lane + delta)); player.style.setProperty('--lane', lane); };
    const controls = el('div', 'gate-game-controls'); [['يمين', 1], ['يسار', -1]].forEach(([label, delta]) => { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', () => move(delta)); controls.append(b); }); shell.modal.append(controls);
    const key = (event) => { if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') move(-1); if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') move(1); };
    window.addEventListener('keydown', key);
    const spawn = (at) => {
      const good = (hash(`${at}:${energy}:${hits}`) % 5) !== 0;
      const item = el('div', `gate-dash-item ${good ? 'is-energy' : 'is-hazard'}`, good ? '✦' : '✕');
      item.setAttribute('aria-label', good ? 'شظية ذهبية' : 'شق أحمر');
      const itemLane = hash(`${at}:lane`) % 3;
      item.style.setProperty('--lane', itemLane); arena.append(item);
      setTimeout(() => {
        if (!running) { item.remove(); return; }
        if (itemLane === lane) {
          if (good) { energy++; item.classList.add('is-collected'); }
          else { hits++; player.classList.add('is-hit'); setTimeout(() => player.classList.remove('is-hit'), 260); item.classList.add('is-hit'); }
          updateHud();
        }
        setTimeout(() => item.remove(), itemLane === lane ? 120 : 0);
      }, 2400);
    };
    const timer = setInterval(() => { if (running) spawn(Date.now()); }, 900);
    updateHud();
    function frame(time) { if (!running) return; elapsed += time - last; last = time; updateHud(); if (energy >= target || hits >= 3 || elapsed >= 35000) { running = false; clearInterval(timer); window.removeEventListener('keydown', key); finish(context, shell, energy >= target && hits < 3); return; } requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }

  function launchMaze(context) {
    const shell = modalShell('متاهة الأثر', 'اجمع البلورات الثلاث ثم اعبر إلى البوابة. الأسهم أو الأزرار للحركة؛ لا يوجد سؤال أو تقييم.');
    const blocks = new Set(['1,1','3,0','3,1','1,3','2,3','4,2','4,3','0,4']); const crystals = new Set(['2,0','4,1','3,4']); let x = 0, y = 0, collected = 0, running = true, elapsed = 0, last = performance.now();
    const hud = el('div', 'gate-maze-hud', 'بلورات 0 / 3 · 40ث'); const grid = el('div', 'gate-maze-grid'); const cells = new Map();
    for (let cy = 0; cy < 5; cy++) for (let cx = 0; cx < 5; cx++) { const id = `${cx},${cy}`; const cell = el('span', 'gate-maze-cell'); if (blocks.has(id)) cell.classList.add('is-wall'); if (crystals.has(id)) cell.classList.add('is-crystal'); if (cx === 4 && cy === 4) cell.classList.add('is-exit'); grid.append(cell); cells.set(id, cell); }
    const update = () => { cells.forEach((cell) => cell.classList.remove('is-player')); cells.get(`${x},${y}`).classList.add('is-player'); if (crystals.delete(`${x},${y}`)) { collected++; cells.get(`${x},${y}`).classList.remove('is-crystal'); } if (x === 4 && y === 4 && collected === 3) { running = false; window.removeEventListener('keydown', key); finish(context, shell, true); } };
    const move = (dx, dy) => { if (!running) return; const nx = x + dx, ny = y + dy; if (nx < 0 || nx > 4 || ny < 0 || ny > 4 || blocks.has(`${nx},${ny}`)) return; x = nx; y = ny; update(); };
    const key = (event) => { const map = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0] }; if (map[event.key]) { event.preventDefault(); move(...map[event.key]); } };
    window.addEventListener('keydown', key); const controls = el('div', 'gate-game-controls gate-maze-controls'); [['↑',0,-1], ['←',-1,0], ['↓',0,1], ['→',1,0]].forEach(([label, dx, dy]) => { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', () => move(dx, dy)); controls.append(b); }); shell.modal.append(hud, grid, controls); update();
    function frame(time) { if (!running) return; elapsed += time - last; last = time; const sec = Math.max(0, 40 - Math.floor(elapsed / 1000)); hud.textContent = `بلورات ${collected} / 3 · ${sec}ث`; if (elapsed >= 40000) { running = false; window.removeEventListener('keydown', key); finish(context, shell, false); return; } requestAnimationFrame(frame); } requestAnimationFrame(frame);
  }
  function launch(context, windowState) {
    // A tab may have remained open past the official time. Never let a side
    // game masquerade as a valid waiting-window activity in that case.
    if (getView(context)?.mode !== 'waiting') {
      window.showToast?.('المراجعة الرسمية أصبحت جاهزة؛ الألعاب الجانبية توقفت الآن.', 'info');
      window.loadPublishedWorldDetail?.();
      return;
    }
    windowState.gameId === 'dash' ? launchDash(context) : launchMaze(context);
  }
  window.LootLinguaGateExpedition = { render, getView, resolveWindow, gameFor, windowTarget, RELIC_TARGET };
})();
