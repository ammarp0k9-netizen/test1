(function attachLootLinguaFeatureDiscoveryController(root) {
  'use strict';

  let state = null;
  let loadedOwner = '';
  let evaluationTimer = null;

  function api() { return root.LootLinguaFeatureDiscoveryContract; }
  function user() { return root.auth?.currentUser || null; }
  function identity() { return user() ? { uid: user().uid } : {}; }
  function read(identityValue) {
    try { return api().normalize(JSON.parse(localStorage.getItem(api().storageKey(identityValue)))); } catch (_) { return null; }
  }
  function write(next, identityValue) {
    localStorage.setItem(api().storageKey(identityValue), JSON.stringify(next));
  }
  function load() {
    if (!api()) return null;
    const current = identity();
    const key = api().storageKey(current);
    if (loadedOwner === key && state) return state;
    let next = read(current) || api().create();
    if (current.uid) {
      const guest = read({});
      if (guest) {
        next = api().merge(next, guest);
        // The guest snapshot is consumed only after the merged account state
        // is stored. A later guest session starts from a fresh record, so a
        // timestamp change cannot make an already-claimed snapshot eligible
        // for a different account.
        write(next, current);
        localStorage.removeItem(api().storageKey({}));
      }
    }
    state = next;
    loadedOwner = key;
    return state;
  }
  function save(next) {
    state = next;
    loadedOwner = api().storageKey(identity());
    write(next, identity());
    root.dispatchEvent?.(new CustomEvent('lootlingua:feature-discovery-change', { detail: { state } }));
    return state;
  }
  function getStatus(feature, unlocked) {
    return api().stateFor(load(), feature, unlocked).status;
  }
  function start(feature) { return save(api().transition(load(), feature, 'start', Date.now())); }
  function complete(feature) { return save(api().transition(load(), feature, 'complete', Date.now())); }

  const FEATURE_COPY = Object.freeze({
    treasure: {
      title: 'اكتشف الكنز',
      message: 'أضفت أول كلمة. صندوق المكافآت أصبح متاحًا لك.',
      label: 'افتح الكنز',
    },
    quiz: {
      title: 'اكتشف الاختبار',
      message: 'لديك خمس كلمات. هذا اختبار عام لكلماتك، وليس اختبار بوابة من العوالم المنشورة.',
      label: 'استكشف الاختبار',
    },
    starred: {
      title: 'اكتشف الكلمات الصعبة',
      message: 'يمكنك تمييز الكلمات التي تريد الرجوع إليها بنجمة ومراجعتها هنا.',
      label: 'استكشف الكلمات الصعبة',
    },
    'custom-worlds': {
      title: 'نظّم كلماتك في عالم خاص',
      message: 'أنشئ عالمًا خاصًا لمجموعتك من الكلمات. لا يرتبط هذا بالعوالم العامة أو بواباتها.',
      label: 'افتح عوالمي الخاصة',
    },
  });

  function wordCount() {
    try {
      if (typeof root.getPersonalDictionaryWordsSnapshot === 'function') {
        return root.getPersonalDictionaryWordsSnapshot().length;
      }
      if (typeof root.readWordsFromStorage === 'function') {
        return root.readWordsFromStorage('normal', user()?.uid || 'guest')
          .filter((word) => word?.hiddenFromDictionary !== true).length;
      }
    } catch (_) {}
    return Array.isArray(root.words) ? root.words.filter((word) => word?.hiddenFromDictionary !== true).length : 0;
  }

  function eligible(feature) {
    if (feature === 'custom-worlds') return wordCount() >= 5;
    return typeof root.isFeatureUnlocked === 'function'
      ? root.isFeatureUnlocked(feature)
      : (feature === 'treasure' ? wordCount() >= 1 : wordCount() >= 5);
  }

  function isInteractiveJourneyActive() {
    const journey = root.LootLinguaGuidedFirstJourney;
    const journeyState = journey?.getState?.();
    return Boolean(
      root.__entryExperienceActive ||
      root.LootLinguaGuidedFirstJourneyContract?.isActive?.(journeyState)
    );
  }

  function notificationKey(feature) { return `feature-discovery:${feature}`; }

  function updateMarkers() {
    if (typeof document === 'undefined') return;
    const defer = isInteractiveJourneyActive();
    api().FEATURES.forEach((feature) => {
      const pending = !defer && eligible(feature) && getStatus(feature, true) !== 'completed';
      const selectors = feature === 'custom-worlds'
        ? ['#customWorldsTab']
        : [`[data-feature="${feature}"]`];
      document.querySelectorAll(selectors.join(',')).forEach((element) => {
        element.classList.toggle('feature-discovery-ready', pending);
        if (pending) element.setAttribute('data-discovery-feature', feature);
        else element.removeAttribute('data-discovery-feature');
      });
    });
  }

  function syncNotifications() {
    const store = root.LootLinguaNotificationStore;
    if (!store?.upsert || !store?.resolve) return;
    if (isInteractiveJourneyActive()) return;
    api().FEATURES.forEach((feature) => {
      const current = getStatus(feature, eligible(feature));
      const key = notificationKey(feature);
      if (current === 'completed' || current === 'locked') {
        store.resolve(key, current === 'completed' ? 'feature-discovery-completed' : 'feature-discovery-ineligible');
        return;
      }
      // NotificationStore keeps terminal dismissals as records. Do not revive
      // a dismissed invitation or rewrite an active one on every word update.
      if (store.find?.(key)) return;
      const copy = FEATURE_COPY[feature];
      store.upsert({
        kind: 'smart',
        notificationType: 'feature.discovery',
        occurrenceKey: key,
        actionGroup: 'feature-discovery',
        priority: 24,
        severity: 'normal',
        visualType: 'info',
        title: copy.title,
        message: copy.message,
        cta: { id: 'open-feature-discovery', label: copy.label, args: { feature } },
        context: { feature },
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, { reason: 'feature-discovery' });
    });
  }

  function evaluate() {
    load();
    updateMarkers();
    syncNotifications();
    return state;
  }

  function requestEvaluation() {
    clearTimeout(evaluationTimer);
    evaluationTimer = setTimeout(evaluate, 80);
  }

  function open(feature) {
    if (!api().FEATURES.includes(feature) || !eligible(feature) || isInteractiveJourneyActive()) return false;
    start(feature);
    if (feature === 'treasure') root.loadTreasureView?.();
    else if (feature === 'quiz') root.loadQuizView?.();
    else if (feature === 'starred') root.loadStarredView?.();
    else if (feature === 'custom-worlds') {
      root.loadWorldsView?.();
      setTimeout(() => root.showCustomWorldsTab?.(), 0);
    }
    complete(feature);
    evaluate();
    return true;
  }

  function markManualUse(feature) {
    if (!api().FEATURES.includes(feature) || !eligible(feature) || isInteractiveJourneyActive()) return;
    if (getStatus(feature, true) === 'completed') return;
    start(feature);
    complete(feature);
    evaluate();
  }

  root.addEventListener('lootlingua:auth-state', () => { loadedOwner = ''; load(); requestEvaluation(); });
  ['lootlingua:initial-data-ready', 'lootlingua:learning-data-changed', 'lootlingua:entry-state-ready', 'lootlingua:guided-first-journey-change']
    .forEach((eventName) => root.addEventListener(eventName, requestEvaluation));
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('[data-feature], #customWorldsTab');
      if (!target) return;
      const feature = target.id === 'customWorldsTab' ? 'custom-worlds' : target.dataset.feature;
      setTimeout(() => markManualUse(feature), 0);
    }, true);
  }
  const CONTROLLER = Object.freeze({ load, getState: () => load(), getStatus, start, complete, evaluate, requestEvaluation, open });
  Object.defineProperty(root, 'LootLinguaFeatureDiscovery', { value: CONTROLLER, configurable: false, writable: false });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', requestEvaluation, { once: true });
    else requestEvaluation();
  }
})(typeof window !== 'undefined' ? window : globalThis);
