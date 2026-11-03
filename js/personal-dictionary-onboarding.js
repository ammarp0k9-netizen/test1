(function attachPersonalDictionaryOnboarding(root) {
  'use strict';

  // This is deliberately separate from Entry Experience and the public-gate
  // journey.  It records only the short hand-off to the personal dictionary.
  const VERSION = 1;
  const KEY_PREFIX = 'lootlingua:personal-dictionary-onboarding:v1:';
  const COACH_ID = 'personalDictionaryOnboardingCoach';

  function owner() { return root.auth?.currentUser?.uid ? `user:${root.auth.currentUser.uid}` : 'guest'; }
  function key(forOwner = owner()) { return `${KEY_PREFIX}${forOwner}`; }
  function read(forOwner = owner()) {
    try {
      const value = JSON.parse(localStorage.getItem(key(forOwner)) || 'null');
      if (value?.version !== VERSION || !['awaiting-journey', 'intro', 'awaiting-first-word', 'completed'].includes(value.phase)) return null;
      return value;
    } catch (_) { return null; }
  }
  function write(value, forOwner = owner()) {
    const next = { ...value, version: VERSION, updatedAt: Date.now() };
    localStorage.setItem(key(forOwner), JSON.stringify(next));
    return next;
  }
  function hasWords() { return Array.isArray(root.words) && root.words.length > 0; }
  function currentJourneyCompleted() {
    const state = root.LootLinguaGuidedFirstJourney?.getState?.();
    return state?.phase === 'completed';
  }

  function migrateGuestState() {
    const user = root.auth?.currentUser;
    if (!user?.uid) return;
    const guest = read('guest');
    const account = read(`user:${user.uid}`);
    if (!guest || account) return;
    write({ ...guest, migratedFromGuestAt: Date.now() }, `user:${user.uid}`);
    localStorage.removeItem(key('guest'));
  }

  function finish(state) {
    if (!state || state.phase === 'completed') return state;
    const next = write({ ...state, phase: 'completed', completedAt: Date.now() });
    root.LootLinguaPopover?.closeIf?.(COACH_ID, { silent: true });
    root.dispatchEvent(new CustomEvent('lootlingua:personal-dictionary-onboarding-change', { detail: { state: next } }));
    return next;
  }

  function showCoach(state) {
    if (!state || state.phase === 'completed') return;
    const input = document.getElementById('wordInput');
    if (!input || !root.LootLinguaPopover?.open) return;
    if (root.LootLinguaPopover.getActiveId?.() && root.LootLinguaPopover.getActiveId?.() !== COACH_ID) return;
    const content = document.createElement('div');
    content.className = 'personal-dictionary-onboarding-content';
    const title = document.createElement('strong');
    title.id = 'personalDictionaryOnboardingTitle';
    title.textContent = 'قاموسك الشخصي';
    const copy = document.createElement('p');
    const requiresWord = state.phase === 'awaiting-first-word';
    copy.textContent = requiresWord
      ? 'ابحث عن كلمة تهمك ثم أضفها إلى قاموسك. تكتمل هذه الخطوة بعد حفظ كلمة فعلية.'
      : 'هنا تجمع الكلمات التي تتعلمها وتعود إليها لاحقًا. ابحث عن كلمة أو أضفها متى شئت.';
    content.append(title, copy);
    if (!requiresWord) {
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'personal-dictionary-onboarding-done';
      done.textContent = 'فهمت';
      done.addEventListener('click', () => finish(read()));
      content.append(done);
    }
    root.LootLinguaPopover.open({ id: COACH_ID, className: 'lootlingua-popover personal-dictionary-onboarding-coach', anchor: input, content, labelledBy: title.id });
  }

  function routeToDictionary(state) {
    if (!state || state.phase === 'completed') return;
    if (state.phase === 'awaiting-first-word' && hasWords()) { finish(state); return; }
    const phase = state.requiresFirstWord ? 'awaiting-first-word' : 'intro';
    const next = state.phase === 'awaiting-journey' ? write({ ...state, phase }) : state;
    if (typeof root.loadPersonalDictionary === 'function') root.loadPersonalDictionary();
    setTimeout(() => {
      const latest = read();
      if (latest?.phase === 'intro' || latest?.phase === 'awaiting-first-word') {
        document.getElementById('wordInput')?.focus({ preventScroll: true });
        showCoach(latest);
      }
    }, 0);
    return next;
  }

  function continueWhenReady() {
    const state = read();
    if (!state || state.phase === 'completed') return;
    if (state.phase === 'awaiting-first-word' && hasWords()) { finish(state); return; }
    if (state.phase === 'awaiting-journey' && !currentJourneyCompleted()) return;
    routeToDictionary(state);
  }

  const api = {
    planForFirstJourney({ requiresFirstWord = false } = {}) {
      const existing = read();
      if (existing) return existing;
      const state = write({
        version: VERSION,
        phase: 'awaiting-journey',
        requiresFirstWord: requiresFirstWord === true,
        startedAt: Date.now(),
        completedAt: 0,
      });
      root.dispatchEvent(new CustomEvent('lootlingua:personal-dictionary-onboarding-change', { detail: { state } }));
      return state;
    },
    getState: () => read(),
    continueWhenReady,
  };
  Object.defineProperty(root, 'LootLinguaPersonalDictionaryOnboarding', { value: Object.freeze(api), configurable: false });

  root.addEventListener('lootlingua:guided-first-journey-change', () => continueWhenReady());
  root.addEventListener('lootlingua:dictionary-word-saved', () => {
    const state = read();
    if (state?.phase === 'awaiting-first-word') finish(state);
  });
  root.addEventListener('lootlingua:auth-state', () => { migrateGuestState(); setTimeout(continueWhenReady, 0); });
  root.addEventListener('lootlingua:initial-data-ready', () => { migrateGuestState(); setTimeout(continueWhenReady, 0); });
})(window);
