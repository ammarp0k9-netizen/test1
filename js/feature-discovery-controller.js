(function attachLootLinguaFeatureDiscoveryController(root) {
  'use strict';

  let state = null;
  let loadedOwner = '';

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

  root.addEventListener('lootlingua:auth-state', () => { loadedOwner = ''; load(); });
  const CONTROLLER = Object.freeze({ load, getState: () => load(), getStatus, start, complete });
  Object.defineProperty(root, 'LootLinguaFeatureDiscovery', { value: CONTROLLER, configurable: false, writable: false });
})(typeof window !== 'undefined' ? window : globalThis);
