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
  function guestUpdatedAt(snapshot) {
    return Math.max(0, ...Object.values(snapshot?.features || {}).map((item) => Number(item.updatedAt) || 0));
  }
  function canClaimGuest(current, guest) {
    const claim = (() => { try { return JSON.parse(localStorage.getItem(api().guestClaimStorageKey())); } catch (_) { return null; } })();
    return !claim || Number(claim.guestUpdatedAt) !== guestUpdatedAt(guest) || claim.uid === current.uid;
  }
  function claimGuest(current, guest) {
    localStorage.setItem(api().guestClaimStorageKey(), JSON.stringify({
      uid: current.uid, guestUpdatedAt: guestUpdatedAt(guest), claimedAt: Date.now(),
    }));
  }
  function load() {
    if (!api()) return null;
    const current = identity();
    const key = api().storageKey(current);
    if (loadedOwner === key && state) return state;
    let next = read(current) || api().create();
    if (current.uid) {
      const guest = read({});
      if (guest && canClaimGuest(current, guest)) {
        next = api().merge(next, guest);
        write(next, current);
        claimGuest(current, guest);
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
