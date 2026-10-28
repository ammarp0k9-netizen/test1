(function attachLootLinguaFeatureDiscoveryContract(root) {
  'use strict';

  // This intentionally describes discovery only. Product unlocks remain owned
  // by the existing feature-gate functions in script.js.
  const VERSION = 1;
  const FEATURES = Object.freeze(['treasure', 'quiz', 'starred', 'custom-worlds']);
  const STATUSES = Object.freeze(['available', 'in-progress', 'completed']);
  const STATUS_PRIORITY = Object.freeze({ available: 1, 'in-progress': 2, completed: 3 });

  function clean(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength || 160);
  }

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  function owner(identity) {
    const uid = clean(identity?.uid, 128);
    return uid ? `user:${uid}` : 'guest';
  }

  function storageKey(identity) {
    return `lootlingua:feature-discovery:v${VERSION}:${owner(identity)}`;
  }

  function guestClaimStorageKey() {
    return `lootlingua:feature-discovery-guest-claim:v${VERSION}`;
  }

  function normalizeFeature(raw) {
    if (!raw || Object.prototype.toString.call(raw) !== '[object Object]') return null;
    const status = clean(raw.status, 40);
    if (!STATUSES.includes(status)) return null;
    const updatedAt = timestamp(raw.updatedAt);
    return Object.freeze({
      status,
      startedAt: status === 'available' ? 0 : timestamp(raw.startedAt),
      completedAt: status === 'completed' ? timestamp(raw.completedAt) : 0,
      updatedAt,
    });
  }

  function normalize(raw) {
    if (!raw || Object.prototype.toString.call(raw) !== '[object Object]' || Number(raw.version) !== VERSION) return null;
    const features = {};
    FEATURES.forEach((feature) => {
      const state = normalizeFeature(raw.features?.[feature]);
      if (state) features[feature] = state;
    });
    return Object.freeze({ version: VERSION, features: Object.freeze(features) });
  }

  function create() {
    return Object.freeze({ version: VERSION, features: Object.freeze({}) });
  }

  function stateFor(state, feature, unlocked) {
    if (!FEATURES.includes(feature)) return null;
    if (unlocked !== true) return Object.freeze({ status: 'locked', startedAt: 0, completedAt: 0, updatedAt: 0 });
    return normalize(state)?.features?.[feature] || Object.freeze({ status: 'available', startedAt: 0, completedAt: 0, updatedAt: 0 });
  }

  function transition(state, feature, event, nowValue) {
    if (!FEATURES.includes(feature)) throw new RangeError('Unknown discovery feature.');
    const current = normalize(state) || create();
    const before = current.features[feature] || { status: 'available', startedAt: 0, completedAt: 0, updatedAt: 0 };
    const now = timestamp(nowValue) || Date.now();
    let next = before;
    if (event === 'start' && before.status === 'available') {
      next = { status: 'in-progress', startedAt: now, completedAt: 0, updatedAt: now };
    } else if (event === 'complete' && before.status !== 'completed') {
      next = { status: 'completed', startedAt: before.startedAt || now, completedAt: now, updatedAt: now };
    }
    if (next === before) return current;
    return normalize({ version: VERSION, features: { ...current.features, [feature]: next } });
  }

  function newest(left, right) {
    if (!left) return right;
    if (!right) return left;
    const leftPriority = STATUS_PRIORITY[left.status] || 0;
    const rightPriority = STATUS_PRIORITY[right.status] || 0;
    if (leftPriority !== rightPriority) return leftPriority > rightPriority ? left : right;
    return left.updatedAt >= right.updatedAt ? left : right;
  }

  function merge(account, guest) {
    const left = normalize(account) || create();
    const right = normalize(guest) || create();
    const features = {};
    FEATURES.forEach((feature) => {
      const selected = newest(left.features[feature], right.features[feature]);
      if (selected) features[feature] = selected;
    });
    return normalize({ version: VERSION, features });
  }

  const API = Object.freeze({ VERSION, FEATURES, STATUSES, storageKey, guestClaimStorageKey, normalize, create, stateFor, transition, merge });
  Object.defineProperty(root, 'LootLinguaFeatureDiscoveryContract', { value: API, configurable: false, writable: false });
})(typeof window !== 'undefined' ? window : globalThis);
