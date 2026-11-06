/* Gate Runner: cosmetic only; it never changes SRS, XP, Gate Clear, or progress. */
(function () {
  'use strict';
  const MAX_HEARTS = 3, COIN_KEY = 'lootlingua.runner.coins.v1', BEST_DISTANCE_KEY = 'lootlingua.runner.best-distance.v1';
  function normalizeWords(words) { const seen = new Set(); return (Array.isArray(words) ? words : []).map((x) => ({ word: String(x?.word || x?.term || '').trim(), meaning: String(x?.translation || x?.meaning || x?.ar || x?.definition || '').trim() })).filter((x) => x.word && x.meaning && !seen.has(`${x.word}\u0000${x.meaning}`) && seen.add(`${x.word}\u0000${x.meaning}`)); }
  const RunnerCoinWallet = Object.freeze({ balance() { try { return Math.max(0, Number(localStorage.getItem(COIN_KEY)) || 0); } catch { return 0; } }, credit(amount, eventId) {
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
    try { localStorage.setItem(COIN_KEY, String(this.balance() + value)); } catch {}
  } });
  const RunnerBestDistance = Object.freeze({ value() { try { return Math.max(0, Math.floor(Number(localStorage.getItem(BEST_DISTANCE_KEY)) || 0)); } catch { return 0; } }, save(distance) {
    const next = Math.max(0, Math.floor(Number(distance) || 0));
    if (next <= this.value()) return false;
    try {
      if (window.auth?.currentUser) {
        if (!window.queueProfileIntent?.({ type: 'max', field: 'runnerBestDistance', value: next })) return false;
      }
      localStorage.setItem(BEST_DISTANCE_KEY, String(next));
    } catch { return false; }
    return true;
  } });
  function captureRunnerOwner() { return { uid: window.auth?.currentUser?.uid || '', generation: Number(window.__lootlinguaAuthGeneration) || 0 }; }
  function runnerOwnerCurrent(owner) { return owner.uid === (window.auth?.currentUser?.uid || '') && owner.generation === (Number(window.__lootlinguaAuthGeneration) || 0); }
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  function reviewIsDue(progress, now = Date.now()) {
    const due = Array.from(new Set((progress?.runnerReviewDueWordKeys || []).map(String).filter(Boolean)));
    const completed = new Set((progress?.runnerReviewCompletedDueWordKeys || []).map(String));
    const nextAt = Number(progress?.readinessNextAt?.toMillis?.() ?? progress?.readinessNextAt) || 0;
    const unresolvedDue = Number(progress?.availableForReviewNowCount) > 0 && (!due.length || due.some((key) => !completed.has(key)));
    return unresolvedDue || (nextAt > 0 && nextAt <= now);
  }
  function render(context) {
    const card = node('aside', 'gate-runner-card'), copy = node('div', 'gate-runner-card-copy');
    copy.append(node('strong', '', 'لووت رنر — جري البوابات'),
      node('span', '', 'ثلاثة مسارات، قفز وانزلاق. تفادَ العوائق واعبر بوابة المعنى الصحيح.'),
      node('small', 'gate-runner-cosmetic', `عملاتك: ${RunnerCoinWallet.balance()} · أفضل مسافة: ${RunnerBestDistance.value()} م`));
    const play = node('button', 'gate-runner-launch', 'ابدأ الجري'); play.type = 'button';
    const due = reviewIsDue(context?.progress); play.disabled = due; play.setAttribute('aria-disabled', String(due));
    play.addEventListener('click', async () => {
      if (play.disabled) return; play.disabled = true; play.setAttribute('aria-busy', 'true'); play.textContent = 'جارٍ تجهيز الطريق…';
      try { await launch(context); }
      finally { play.disabled = reviewIsDue(context?.progress); play.removeAttribute('aria-busy'); play.textContent = 'ابدأ الجري'; }
    });
    card.append(copy, play);
    if (due) card.append(node('p', 'gate-runner-review-lock', 'حان وقت مراجعة البوابة. أكمل المراجعة الموثّقة أولًا، ثم ارجع للجري.'));
    return card;
  }
  async function getWords(context) { const api = window.LootLinguaPublishedContent; return api?.listAllPublishedGateWords ? normalizeWords(await api.listAllPublishedGateWords(context.worldId, context.rankId, context.gateId)) : []; }

  let activeRun = null, launchPending = null, resources = null;
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
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'runner.css?v=20261106-runner-2';
      link.dataset.runnerStyle = ''; link.onload = resolve; link.onerror = () => { link.remove(); reject(new Error('Runner styles unavailable')); };
      document.head.append(link);
    });
    resources = Promise.all([styles, module('LootLinguaRunnerEngine', 'js/runner-engine.js?v=20261106-runner-2'), module('LootLinguaRunnerRenderer', 'js/runner-renderer.js?v=20261106-runner-2')]).catch(error => { resources = null; throw error; });
    return resources;
  }
  function button(label, cls, action) {
    const result = node('button', cls, label); result.type = 'button'; result.addEventListener('click', action); return result;
  }
  async function launch(context) {
    if (activeRun) { activeRun.focus(); return false; }
    const owner = captureRunnerOwner();
    if (launchPending && runnerOwnerCurrent(launchPending.owner)) return false;
    if (reviewIsDue(context?.progress)) { window.showToast?.('حان وقت المراجعة الموثّقة أولًا.', 'info'); return false; }
    const operation = { owner }; launchPending = operation;
    let words;
    try { await ensureResources(); words = await getWords(context); }
    catch (error) { if (runnerOwnerCurrent(owner)) window.showToast?.('تعذّر تحميل اللعبة أو كلمات البوابة. حاول مجددًا.', 'warning'); return false; }
    finally { if (launchPending === operation) launchPending = null; }
    if (!runnerOwnerCurrent(owner) || reviewIsDue(context?.progress) || activeRun) return false;

    const E = engine(), state = E.createState(words); state.running = false;
    const runId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const returnFocus = document.activeElement;
    const overlay = node('div', 'runner-overlay llr-overlay'), game = node('section', 'llr-game');
    game.setAttribute('role', 'dialog'); game.setAttribute('aria-modal', 'true'); game.setAttribute('aria-label', 'لووت رنر — جري البوابات'); game.tabIndex = -1;
    const header = node('header', 'llr-header'), brand = node('div', 'llr-brand');
    brand.append(node('small', '', 'LOOT RUNNER'), node('strong', '', 'جري البوابات'));
    const pause = button('إيقاف', 'llr-icon-button', () => setPaused(!state.paused)), exit = button('خروج', 'llr-icon-button', () => cleanup());
    header.append(brand, pause, exit);
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
    const hint = node('p', 'llr-hint', 'اسحب للحركة والقفز والانزلاق · العملات للتسلية ولا تغيّر تقدّم البوابة');
    game.append(header, viewport, controls, hint); overlay.append(game); document.body.append(overlay);
    document.body.classList.add('runner-input-active'); window.__lootlinguaRunnerInputActive = true;
    window.dispatchEvent(new CustomEvent('lootlingua:runner-input-active'));
    window.lockBackgroundScroll?.('runner');
    let renderer, resizeObserver, raf = 0, previous = 0, destroyed = false, settled = false, gateId = null, feedbackUntil = 0, hudKey = '', rect, lastDueCheck = 0, gesture = null;
    let gateZ = 0;
    const startingBest = RunnerBestDistance.value();
    const resize = () => { rect = viewport.getBoundingClientRect(); renderer?.resize(rect.width, rect.height); if (renderer) renderer.draw(state); };
    const saveRun = () => {
      if (settled || !runnerOwnerCurrent(owner)) return;
      settled = true; RunnerBestDistance.save(Math.floor(state.distance));
      if (state.coins > 0) void RunnerCoinWallet.credit(state.coins, runId);
    };
    function cleanup() {
      if (destroyed) return; saveRun(); destroyed = true; cancelAnimationFrame(raf);
      resizeObserver?.disconnect(); renderer?.destroy();
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
      if (value) { cancelAnimationFrame(raf); showScreen('استراحة قصيرة', 'خذ وقتك. الطريق ينتظرك.', 'متابعة الجري', () => setPaused(false)); }
      else { screen.hidden = true; previous = performance.now(); raf = requestAnimationFrame(frame); viewport.focus({ preventScroll: true }); }
    }
    function finish(reason) {
      state.running = false; cancelAnimationFrame(raf); saveRun(); challenge.hidden = options.hidden = true;
      showScreen(reason, `${Math.floor(state.distance)} متر · ${state.coins} عملة${state.distance > startingBest ? ' · رقم قياسي جديد!' : ''}`, 'جولة جديدة', () => { cleanup(); void launch(context); });
      screen.append(button('العودة إلى البوابة', 'llr-secondary', cleanup));
      pause.disabled = true;
    }
    function syncHUD() {
      const key = `${state.hearts}:${state.coins}:${Math.floor(state.distance)}`;
      if (key !== hudKey) { hudKey = key; health.textContent = `♥ ${state.hearts} فرص`; coins.textContent = `${state.coins} عملة`; distance.textContent = `${Math.floor(state.distance)} م`; }
      const gate = state.gate;
      if (gate && !gate.resolved) {
        challenge.hidden = options.hidden = false; gateZ = gate.z;
        if (gate.id !== gateId) { gateId = gate.id; wordLabel.textContent = gate.word; labels.forEach((label, lane) => { label.textContent = gate.options[lane]; }); }
        const near = renderer.project(1, gateZ);
        options.style.top = `${Math.max(rect.height * .31, Math.min(rect.height * .64, near.labelY || near.y - 60))}px`;
        labels.forEach((label, lane) => label.classList.toggle('is-selected', lane === state.lane));
      } else { challenge.hidden = options.hidden = true; gateId = null; }
      if (state.feedback && state.feedback.until !== feedbackUntil) {
        feedbackUntil = state.feedback.until;
        status.textContent = state.feedback.correct ? 'بوابة صحيحة! أحسنت.' : `المعنى الصحيح: ${state.feedback.correctMeaning || ''}`;
        status.dataset.tone = state.feedback.correct ? 'correct' : 'wrong';
      } else if (!state.feedback) {
        const nearby = state.entities.find(item => item.kind === 'obstacle' && item.lane === state.lane && item.z > 0 && item.z / state.speed < (['low', 'overhead'].includes(item.obstacleType) ? .62 : 1.1));
        const text = nearby ? ({ low: '↑ اقفز فوق الحاجز', overhead: '↓ انزلق تحت العارضة', wall: '← غيّر المسار →', train: 'منحدر أمامك — اصعد إلى سطح العربة' }[nearby.obstacleType] || '') : '';
        if (status.textContent !== text) status.textContent = text;
        status.dataset.tone = 'hint';
      }
    }
    function frame(now) {
      if (destroyed) return;
      if (!runnerOwnerCurrent(owner)) { cleanup(); return; }
      if (now - lastDueCheck > 1000) { lastDueCheck = now; if (reviewIsDue(context?.progress)) { finish('حان وقت المراجعة الموثّقة'); return; } }
      const delta = Math.min(50, Math.max(0, now - previous)); previous = now;
      E.update(state, delta); renderer.draw(state); syncHUD();
      if (state.over) finish('رحلة جميلة! حاول تحطيم رقمك');
      else if (!state.paused && state.running) raf = requestAnimationFrame(frame);
    }
    function keyboard(event) {
      if (event.key === 'Tab') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); return; }
      if (event.target?.closest?.('button') && ['Enter', ' '].includes(event.key)) return;
      const key = event.key.toLowerCase();
      const actions = { arrowleft: () => move(state.lane - 1), a: () => move(state.lane - 1), arrowright: () => move(state.lane + 1), d: () => move(state.lane + 1), arrowup: () => E.jump(state), w: () => E.jump(state), ' ': () => E.jump(state), arrowdown: () => E.slide(state), s: () => E.slide(state), p: () => setPaused(!state.paused) };
      if (actions[key]) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) actions[key](); }
    }
    const visibility = () => { if (document.hidden) setPaused(true); };
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
      showScreen('الطريق لك', `اختر مسارك، اقفز فوق الحواجز وانزلق تحت العوارض. ${free ? 'هذه جولة جري حر؛ البوابة تحتاج ثلاثة معانٍ مختلفة لأسئلة الكلمات.' : 'عند ظهور كلمة، اعبر بوابة معناها الصحيح.'}`, 'انطلق', () => {
        screen.hidden = true; state.running = true; state.paused = false; previous = performance.now(); viewport.focus({ preventScroll: true }); raf = requestAnimationFrame(frame);
      });
      screen.insertBefore(node('div', 'llr-tutorial', '← → مسارات   ↑ قفز   ↓ انزلاق\nالهاتف: اسحب في الاتجاه نفسه أو استخدم الأزرار'), screen.lastChild);
      return true;
    } catch (error) { cleanup(); window.showToast?.('تعذّر تشغيل الرسومات. حاول مجددًا.', 'warning'); return false; }
  }
  window.LootLinguaGateRunner = {
    render, launch, reviewIsDue, normalizeWords, RunnerCoinWallet, RunnerBestDistance, MAX_HEARTS,
    createState: (...args) => engine().createState(...args), step: (...args) => engine().update(...args), chooseLane: (...args) => engine().move(...args),
    getDiagnostics: () => activeRun ? { lane: activeRun.state.lane, action: activeRun.state.action, paused: activeRun.state.paused, entities: activeRun.state.entities.filter(e => e.active !== false).length, distance: activeRun.state.distance } : null,
  };
})();
