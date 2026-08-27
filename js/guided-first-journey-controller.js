(function attachGuidedFirstJourneyController(root) {
  'use strict';

  const runtime = { state: null, loadedOwner: '', loading: null };

  function api() { return root.LootLinguaGuidedFirstJourneyContract; }
  function cloud() { return root.LootLinguaGuidedFirstJourneyCloud; }
  function user() { return root.auth?.currentUser || null; }
  function identity() { const current = user(); return current ? { uid: current.uid } : {}; }
  function readLocal() { try { return api().normalize(JSON.parse(localStorage.getItem(api().storageKey(identity())))); } catch (_) { return null; } }
  function saveLocal(state) { localStorage.setItem(api().storageKey(identity()), JSON.stringify(state)); }
  function active() { return api().isActive(runtime.state); }

  function preferNewestState(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    if (Number(local.updatedAt) !== Number(remote.updatedAt)) {
      return Number(local.updatedAt) > Number(remote.updatedAt) ? local : remote;
    }
    const priority = { 'awaiting-first-gate': 1, 'awaiting-quiz-cta': 2, completed: 3 };
    return (priority[local.phase] || 0) >= (priority[remote.phase] || 0) ? local : remote;
  }

  function announce() {
    const on = active();
    document.documentElement.classList.toggle('guided-first-journey-active', on);
    document.body.classList.toggle('guided-first-journey-active', on);
    document.querySelectorAll('[data-feature]').forEach((element) => {
      const feature = String(element.getAttribute('data-feature') || '');
      const locked = on && ['quiz', 'minecraft', 'pubg', 'starred', 'treasure'].includes(feature);
      element.classList.toggle('guided-first-journey-locked', locked);
      if (locked) element.setAttribute('data-guided-lock', 'true');
      else element.removeAttribute('data-guided-lock');
    });
    document.querySelectorAll('[data-dock-view="personal"], [data-view="personal"]').forEach((element) => {
      element.classList.toggle('guided-first-journey-deemphasized', on);
    });
    root.dispatchEvent(new CustomEvent('lootlingua:guided-first-journey-change', { detail: { state: runtime.state } }));
  }

  async function persist(state) {
    saveLocal(state);
    const current = user();
    if (!current || !cloud()?.save) return state;
    try { await cloud().save(state, current); } catch (_) { /* local state remains safely owner-scoped until retry */ }
    return state;
  }

  async function boot() {
    const owner = api().storageKey(identity());
    if (runtime.loadedOwner === owner) return runtime.state;
    if (runtime.loading) return runtime.loading;
    runtime.loading = (async () => {
      const local = readLocal();
      let remote = null;
      const current = user();
      if (current && cloud()?.load) {
        try { remote = await cloud().load(current); } catch (_) {}
      }
      runtime.state = preferNewestState(local, remote);
      runtime.loadedOwner = owner;
      runtime.loading = null;
      announce();
      return runtime.state;
    })();
    return runtime.loading;
  }

  async function beginFromEntry(payload) {
    if (!api().shouldStartForPresentation(payload?.presentation) || !payload?.worldId) return null;
    const state = api().create(payload.worldId, Date.now());
    runtime.state = state;
    runtime.loadedOwner = api().storageKey(identity());
    announce();
    await persist(state);
    return state;
  }

  async function gateWordsLoaded(payload) {
    if (!active()) return runtime.state;
    const next = api().transition(runtime.state, { type: 'gate-words-loaded', worldId: payload?.worldId, gateId: payload?.gateId }, Date.now());
    if (next === runtime.state) return next;
    runtime.state = next;
    announce();
    await persist(next);
    return next;
  }

  async function completeFromQuizCta(payload) {
    if (!active()) return runtime.state;
    const next = api().transition(runtime.state, { type: 'complete', worldId: payload?.worldId, gateId: payload?.gateId }, Date.now());
    if (next === runtime.state) return next;
    runtime.state = next;
    announce();
    await persist(next);
    return next;
  }

  function shouldAllowSurface(surface, options) {
    if (!active() || options?.guided === true) return true;
    const blocked = new Set(['quiz', 'minecraft', 'pubg', 'starred', 'treasure', 'custom-worlds']);
    if (!blocked.has(surface)) return true;
    root.showToast?.('خطوتك الحالية موجودة داخل البوابة المفتوحة. أكملها أولاً ثم ستتسع الرحلة.', 'info', 3600);
    return false;
  }

  function applyRoute(payload) {
    if (!active() || !payload?.root) return;
    const state = runtime.state;
    if (String(payload.worldId || '') !== state.worldId) return;
    const rootNode = payload.root;
    rootNode.querySelectorAll('.guided-first-journey-note, .guided-first-journey-target').forEach((node) => {
      node.classList.remove('guided-first-journey-target');
      if (node.classList.contains('guided-first-journey-note')) node.remove();
    });
    if (payload.type === 'world') {
      const target = state.phase === 'awaiting-quiz-cta' && state.gateId
        ? [...rootNode.querySelectorAll('.published-gate-node')]
          .find((node) => String(node.dataset.gateId || '') === state.gateId)
        : rootNode.querySelector('.published-gate-node.is-available');
      if (!target) return;
      target.classList.add('guided-first-journey-target');
      const note = document.createElement('p');
      note.className = 'guided-first-journey-note';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      note.textContent = state.phase === 'awaiting-quiz-cta'
        ? 'أنت هنا — أكمل من البوابة التي بدأت بها.'
        : 'أنت هنا — ابدأ من أول بوابة متاحة.';
      target.before(note);
    }
    if (payload.type === 'gate') {
      const target = rootNode.querySelector('.published-journey-cta');
      if (!target) return;
      target.classList.add('guided-first-journey-target');
      const note = document.createElement('p');
      note.className = 'guided-first-journey-note';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      note.textContent = state.phase === 'awaiting-quiz-cta'
        ? 'كلمات البوابة أصبحت في قاموسك. تابع التعلّم من الزر الموجود هنا.'
        : 'هذه خطوتك الحالية داخل العالم.';
      target.before(note);
    }
  }

  root.addEventListener('lootlingua:auth-state', () => { runtime.loadedOwner = ''; void boot(); });
  root.addEventListener('lootlingua:guided-first-journey-cloud-ready', () => { runtime.loadedOwner = ''; void boot(); });
  root.addEventListener('lootlingua:initial-data-ready', () => { void boot(); });
  queueMicrotask(boot);

  Object.defineProperty(root, 'LootLinguaGuidedFirstJourney', {
    value: Object.freeze({ boot, beginFromEntry, gateWordsLoaded, completeFromQuizCta, shouldAllowSurface, applyRoute, getState: () => runtime.state }),
    configurable: false, writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
