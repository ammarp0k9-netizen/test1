/* Practice arcade entry points. The combat engine loads on launch. */
(() => {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  let resources, pending = false;
  const guestKey = 'lootlingua.bots.v1:guest';
  const owner = () => window.auth?.currentUser?.uid || '';
  const accountKey = uid => `lootlingua.bots.v1:user:${encodeURIComponent(uid)}`;
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const read = key => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const id = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stats = data => ({ coins: number(data.coins), best: number(data.best), bosses: number(data.bosses), seconds: number(data.seconds) });
  const combine = (left, right) => ({ coins: Math.min(Number.MAX_SAFE_INTEGER, left.coins + right.coins),
    best: Math.max(left.best, right.best), bosses: Math.max(left.bosses, right.bosses), seconds: Math.max(left.seconds, right.seconds) });
  const hasRun = data => Object.values(stats(data)).some(Boolean);

  function progress(uid = owner()) {
    const data = read(uid ? `${accountKey(uid)}:cloud` : guestKey);
    const audio = { ...data.audio };
    if (uid) {
      const local = read(`${accountKey(uid)}:audio`);
      for (const field of ['effects', 'speech']) if ((local[field]?.at || 0) > (audio[field]?.at || 0)) audio[field] = local[field];
    }
    return { ...stats(data), audio };
  }
  function refreshStats() {
    const data = progress();
    document.querySelectorAll('[data-bots-stats]').forEach(el => {
      el.textContent = `${data.coins} عملة · أفضل نتيجة ${data.best} · ${data.bosses} زعيم`;
    });
  }
  function submit(uid, command) {
    if (uid === owner()) {
      try { if (window.queueProfileIntent?.(command)) return true; } catch { /* Keep the same receipt ID for retry. */ }
    }
    return write(`${accountKey(uid)}:pending:${command.eventId}`, command);
  }
  function drain(uid = owner()) {
    if (!uid || uid !== owner() || typeof window.queueProfileIntent !== 'function') return;
    try {
      const key = accountKey(uid), legacy = read(key);
      if (hasRun(legacy)) {
        legacy.importId ||= id();
        if (write(key, legacy) && window.queueProfileIntent({ type: 'bots-run', eventId: `legacy-${legacy.importId}`, run: stats(legacy) })) localStorage.removeItem(key);
      }
      for (const item of Object.keys(localStorage)) {
        if (!item.startsWith(`${key}:pending:`)) continue;
        const command = read(item);
        if (command.eventId && window.queueProfileIntent(command)) localStorage.removeItem(item);
      }
    } catch { /* The original record remains available for a retry. */ }
  }
  function record(uid, runId, run) {
    const values = stats(run), before = progress(uid);
    const records = ['best', 'bosses', 'seconds'].filter(key => values[key] > before[key]);
    if (!hasRun(values)) return { saved: true, records };
    const saved = uid ? submit(uid, { type: 'bots-run', eventId: runId, run: values }) :
      write(guestKey, { ...combine(before, values), audio: before.audio });
    if (!uid && saved) window.markGuestProfileDataDirty?.(guestKey);
    refreshStats();
    return { saved, records };
  }
  function saveAudio(uid, field, enabled) {
    const before = progress(uid);
    const at = Math.max(Date.now(), (before.audio[field]?.at || 0) + 1);
    if (uid) {
      if (!submit(uid, { type: 'bots-audio', eventId: id(), field, enabled, at })) return false;
      write(`${accountKey(uid)}:audio`, { ...before.audio, [field]: { enabled, at } });
      return true;
    }
    return write(guestKey, { ...before, audio: { ...before.audio, [field]: { enabled, at } } });
  }

  function loadGame() {
    if (resources) return resources;
    const link = document.createElement('link');
    const styles = new Promise((resolve, reject) => {
      link.rel = 'stylesheet'; link.href = new URL('loot-bots.css?v=5', base);
      link.onload = resolve; link.onerror = () => reject(new Error('Arena stylesheet unavailable'));
      document.head.append(link);
    });
    resources = Promise.all([styles, import(new URL('js/loot-bots-game.mjs?v=5', base))])
      .then(([, game]) => game)
      .catch(error => { link.remove(); resources = null; throw error; });
    return resources;
  }

  async function launch(button, { source, words, isSourceCurrent }) {
    if (pending || window.__lootlinguaRunnerInputActive) return;
    pending = true;
    const uid = window.auth?.currentUser?.uid, generation = window.__lootlinguaAuthGeneration;
    const isCurrent = () => uid === window.auth?.currentUser?.uid && generation === window.__lootlinguaAuthGeneration && isSourceCurrent();
    const heading = button.querySelector('strong') || button, label = heading.textContent;
    button.disabled = true; button.setAttribute('aria-busy', 'true'); heading.textContent = 'جارٍ تجهيز الساحة…';
    try {
      const [game, deck] = await Promise.all([loadGame(), words()]);
      if (!isCurrent() || window.__lootlinguaRunnerInputActive) return;
      button.disabled = false;
      drain(uid);
      const result = game.openBattle({ words: deck, source, isCurrent, returnFocus: button });
      if (result === 'small') window.showToast?.('الساحة تحتاج كلمتين على الأقل بمعنيين مختلفين من هذا المصدر.', 'info');
    } catch (error) {
      if (isCurrent()) window.showToast?.('تعذّر تجهيز كلمات الساحة. حاول مرة ثانية.', 'warning');
    } finally {
      pending = false;
      button.disabled = false; button.removeAttribute('aria-busy'); heading.textContent = label;
    }
  }

  const preview = document.getElementById('lootBotsPreview');
  if (preview && typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      import(new URL('js/loot-bots-preview.mjs?v=3', base)).then(module => module.mountPreview(preview)).catch(() => {});
    });
    observer.observe(preview);
  }

  window.LootLinguaBots = {
    launchDictionary: launch, progress, record, saveAudio, newRunId: id, refreshStats,
    guestProgress() { const data = progress(''); return hasRun(data) || Object.keys(data.audio).length ? data : null; },
    acceptProfile(profile, uid) {
      if (!uid || uid !== owner()) return;
      write(`${accountKey(uid)}:cloud`, { ...stats(profile.lootBots || {}), audio: profile.lootBots?.audio || {} });
      refreshStats();
      window.dispatchEvent(new Event('lootlingua:bots-profile'));
      queueMicrotask(() => drain(uid));
    },
    renderGate({ worldId, rankId, gateId, title, isSourceCurrent }) {
      const card = document.createElement('aside'); card.className = 'gate-runner-card loot-bots-gate-card';
      const copy = document.createElement('div'); copy.className = 'gate-runner-card-copy';
      const heading = document.createElement('strong'); heading.textContent = 'Loot Bots'; heading.lang = 'en';
      const desc = document.createElement('span'); desc.textContent = 'صوّب وقاتل وفكّ رمز محطة الطاقة بكلمات هذه البوابة. تدريب دون رفع الإتقان.';
      const button = document.createElement('button'); button.className = 'gate-runner-launch'; button.type = 'button'; button.textContent = 'ادخل الساحة';
      button.addEventListener('click', () => { void launch(button, {
        source: `كلمات بوابة ${title || ''}`.trim(), isSourceCurrent,
        words: () => window.LootLinguaPublishedContent.listAllPublishedGateWords(worldId, rankId, gateId),
      }); });
      const summary = document.createElement('small'); summary.className = 'gate-runner-cosmetic'; summary.dataset.botsStats = '';
      const data = progress(); summary.textContent = `${data.coins} عملة · أفضل نتيجة ${data.best} · ${data.bosses} زعيم`;
      copy.append(heading, desc, summary); card.append(copy, button);
      return card;
    },
  };
  const snapshot = window.__lootlinguaProfileSnapshot;
  if (snapshot?.uid && !snapshot.readFailed) window.LootLinguaBots.acceptProfile(snapshot.data || {}, snapshot.uid);
  refreshStats();
  window.addEventListener('lootlingua:auth-state', () => { refreshStats(); drain(); });
  window.addEventListener('online', () => drain());
  window.addEventListener('storage', event => { if (event.key?.startsWith('lootlingua.bots.v1:')) refreshStats(); });
})();
