/* Removes only the retired Gate expedition client state. No learning data is read or changed. */
(function () {
  'use strict';

  const LEGACY_PREFIX = 'lootlingua.gate-expedition.v1.';
  const RECEIPT_PREFIX = 'lootlingua.gate-game-migration.v1.';
  const LEGACY_SELECTORS = [
    '.gate-expedition-card', '.gate-expedition-overlay', '.gate-expedition-modal',
    '.gate-dash-arena', '.gate-maze-grid',
  ].join(', ');

  function ownerId() {
    return String(window.auth?.currentUser?.uid || 'guest');
  }
  function removeLegacyDom() {
    try { document.querySelectorAll(LEGACY_SELECTORS).forEach((element) => element.remove()); } catch (_) {}
  }
  function migrate(options) {
    const storage = options?.storage || window.localStorage;
    const session = options?.sessionStorage || window.sessionStorage;
    const owner = String(options?.ownerId || ownerId());
    const legacyKey = `${LEGACY_PREFIX}${owner}`;
    // The old game only persisted localStorage. Session cleanup is intentionally
    // scoped to this account's same retired key should a pre-release client have written it.
    const targets = [
      { store: storage, key: legacyKey },
      { store: session, key: legacyKey },
    ].filter((target) => {
      try { return target.store.getItem(target.key) !== null; } catch (_) { return false; }
    });
    if (!targets.length) {
      removeLegacyDom();
      return { affected: false, removedKeys: [] };
    }
    targets.forEach(({ store, key }) => {
      try { store.removeItem(key); } catch (_) {}
    });
    try {
      storage.setItem(`${RECEIPT_PREFIX}${owner}`, JSON.stringify({ version: 1, migratedAt: Date.now() }));
    } catch (_) {}
    removeLegacyDom();
    return { affected: true, removedKeys: targets.map(({ key }) => key) };
  }
  function install() {
    migrate();
    // Defence against a stale pre-update bundle completing after the current
    // Gate route has already rendered. It removes only retired game nodes;
    // canonical state remains the Runner renderer in worlds.js.
    if (typeof MutationObserver === 'function' && document.body) {
      new MutationObserver(() => removeLegacyDom()).observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('lootlingua:auth-state', () => migrate());
  }
  window.LootLinguaGateGameMigration = Object.freeze({ migrate, install, removeLegacyDom, LEGACY_PREFIX, RECEIPT_PREFIX });
  install();
})();
