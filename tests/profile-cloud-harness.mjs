import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { applyProfileIntent, profileOperationId, profileStorageIntents, mergeOnboardingProgress } from '../js/profile-sync-policy.mjs';

const source = (await readFile(new URL('../js/profile-cloud.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function flushMicrotasks() {
  for (let turn = 0; turn < 16; turn++) await Promise.resolve();
}

function storage() {
  const values = new Map();
  return {
    values,
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

export function createProfileHarness(options = {}) {
  const auth = { currentUser: { uid: 'A' } };
  const docs = new Map();
  const reads = [];
  const writes = [];
  const transactionReads = [], receiptReads = [];
  const events = [];
  const errors = [];
  const resets = [];
  const merges = [];
  const ready = [];
  const streaks = [];
  const timers = new Map();
  const localStorage = storage();
  const sessionStorage = storage();
  let timerSequence = 0;
  let authObserver;
  let payloadReads = 0;
  let profile = structuredClone(options.localProfile || { userXP: 100, perfectQuizzes: 1, theme: 'lootlingua' });
  const path = (uid = auth.currentUser?.uid) => `users/${uid}/meta/profile`;
  if (options.profile !== null) docs.set(path('A'), structuredClone(options.profile || profile));
  const snapshot = (data) => ({ exists: () => data !== undefined, data: () => structuredClone(data) });
  const root = {
    __lootlinguaAuthGeneration: 1,
    getLootlinguaProfilePayload: () => { payloadReads++; return structuredClone(profile); },
    resetLootlinguaProfileState: (settings) => { resets.push(settings); profile = {}; },
    mergeLootlinguaProfileFromCloud(data, settings = {}) {
      merges.push({ data: structuredClone(data), settings });
      for (const [key, value] of Object.entries(data)) {
        if (key === 'runnerCoins' && settings.guestMigration) profile[key] = (profile[key] || 0) + value;
        else if (key === 'userXP') profile[key] = Math.max(profile[key] || 0, value);
        else profile[key] = structuredClone(value);
      }
    },
    hasMeaningfulGuestLoot: ({ profile: data }) => Boolean(data?.userXP || data?.runnerCoins),
    markInitialFeatureLoadPartDone: (part) => ready.push(part),
    checkAndUpdateStreak: () => streaks.push(auth.currentUser?.uid),
    dispatchEvent: (event) => events.push({ type: event.type, detail: structuredClone(event.detail) }),
  };
  if (options.prepare) root.prepareGuestMigrationForUser = options.prepare;
  const getDoc = (reference) => {
    if (reference.includes('/meta/xp_event_')) { receiptReads.push(reference); return Promise.resolve(snapshot(docs.get(reference))); }
    const pending = deferred();
    const entry = { reference, ...pending };
    reads.push(entry);
    if (!options.manualReads) pending.resolve(snapshot(docs.get(reference)));
    return pending.promise;
  };
  const setDoc = (reference, data, settings) => {
    const pending = deferred();
    const entry = { reference, data: structuredClone(data), settings, ...pending };
    writes.push(entry);
    if (!options.manualWrites) {
      docs.set(reference, { ...docs.get(reference), ...structuredClone(data) });
      pending.resolve();
    }
    return pending.promise;
  };
  const runTransaction = async (_db, callback) => {
    const staged = [];
    const result = await callback({
      get: async (reference) => { transactionReads.push(reference); return reference.endsWith('/meta/profile') ? getDoc(reference) : snapshot(docs.get(reference)); },
      set: (reference, data, settings) => staged.push({ reference, data: structuredClone(data), settings }),
    });
    // Keep old tests' manually controlled profile-write boundary while all
    // receipt writes remain atomic with the successful profile operation.
    for (const write of staged.filter(item => item.reference.endsWith('/meta/profile'))) await setDoc(write.reference, write.data, write.settings);
    for (const write of staged.filter(item => !item.reference.endsWith('/meta/profile'))) docs.set(write.reference, write.data);
    return result;
  };
  vm.runInNewContext(source, {
    window: root,
    Date,
    localStorage,
    sessionStorage,
    console: { error: (...args) => errors.push(args) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    getApps: () => [{}], getFirestore: () => ({}), getAuth: () => auth,
    onAuthStateChanged: (_auth, callback) => { authObserver = callback; },
    doc: (_db, ...parts) => parts.join('/'), getDoc, setDoc, runTransaction,
    applyProfileIntent, profileOperationId, profileStorageIntents, mergeOnboardingProgress, queueMicrotask,
    onSnapshot: () => () => {},
    setTimeout: (callback) => { const id = ++timerSequence; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    root, auth, docs, reads, writes, transactionReads, receiptReads, events, errors, resets, merges, ready, streaks,
    localStorage, sessionStorage, timers, path,
    get profile() { return profile; },
    get payloadReads() { return payloadReads; },
    setIdentity(user) {
      auth.currentUser = user;
      root.__lootlinguaAuthGeneration++;
      root.__lootlinguaProfileSnapshot = null;
      root._profileLoaded = false;
    },
    notifyAuth(user) { this.setIdentity(user); authObserver(user); },
    resolveRead(index, data) {
      const entry = reads[index];
      entry.resolve(snapshot(arguments.length > 1 ? data : docs.get(entry.reference)));
    },
    resolveWrite(index) {
      const entry = writes[index];
      docs.set(entry.reference, { ...docs.get(entry.reference), ...entry.data });
      entry.resolve();
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    seedSnapshot(uid = 'A') {
      root.__lootlinguaProfileSnapshot = {
        uid, exists: docs.has(path(uid)), data: structuredClone(docs.get(path(uid))) || null, readFailed: false,
      };
    },
    seedMigration(uid = 'A', guest = { userXP: 180, runnerCoins: 5 }) {
      const key = `lootlingua:guest-profile-migration:v1:user:${uid}`;
      const pending = { version: 1, uid, profile: guest, profiles: [guest] };
      localStorage.setItem(key, JSON.stringify(pending));
      return { key, pending };
    },
  };
}
