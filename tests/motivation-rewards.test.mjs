import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { applyProfileIntent } from '../js/profile-sync-policy.mjs';

const policyCode = fs.readFileSync(new URL('../js/motivation-policy.js', import.meta.url), 'utf8');
const cloudCode = fs.readFileSync(new URL('../js/motivation-cloud.js', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');
const policyRoot = {}; vm.runInNewContext(policyCode, { window: policyRoot });
const P = policyRoot.LootLinguaMotivationPolicy;
const mastered = () => ({ mastered_once: true, hasEarnedMasteryXP: true, earnedTransitions: ['reviewing_mastered'], quiz_seen_count: 3, last_quizzed_at: 100 });
const entries = size => Object.fromEntries(Array.from({ length: size }, (_, index) => [`word_${index}`, mastered()]));
function backend() {
  const docs = new Map(), writes = []; let queue = Promise.resolve(), fail = false;
  return { docs, writes, failNext() { fail = true; },
    runTransaction: async (_, callback) => {
      const operation = queue.then(async () => {
        let writing = false; const pending = [];
        const result = await callback({
          get: async ref => { assert.equal(writing, false, 'all reads must precede writes'); const value = structuredClone(docs.get(ref)); return { exists: () => value !== undefined, data: () => value }; },
          set: (ref, data, options) => { writing = true; pending.push([ref, structuredClone(data), options]); },
        });
        if (fail) { fail = false; throw Error('simulated network loss'); }
        for (const [ref, data, options] of pending) { docs.set(ref, options?.merge ? { ...docs.get(ref), ...data } : data); writes.push(ref); }
        return result;
      });
      queue = operation.catch(() => {}); return operation;
    } };
}
function client(db) {
  const auth = { currentUser: { uid: 'alice' } }, root = { dispatchEvent() {} };
  const context = vm.createContext({ window: root, crypto: webcrypto, TextEncoder, Date,
    CustomEvent: class {}, getApps: () => [{}], getAuth: () => auth, getFirestore: () => ({}),
    doc: (_, ...parts) => parts.join('/'), runTransaction: db.runTransaction });
  vm.runInContext(policyCode, context); vm.runInContext(cloudCode, context);
  return { root, auth, claim: gates => root.LootLinguaMotivationCloud.claim({ gates, expectedUid: 'alice' }) };
}
const profilePath = 'users/alice/meta/profile', masteryPath = 'users/alice/meta/word_mastery';

test('mastery milestones use distinct, verified lifetime mastery and keep earned progress after forgetting', () => {
  const raw = entries(10); raw.fake = { mastery_status: 'Mastered', mastered_once: true }; raw.unseen = { ...mastered(), quiz_seen_count: 0 };
  const first = P.advance({}, raw); assert.equal(first.state.masteredKeys.length, 10);
  assert.equal(first.awards.length, 1); assert.equal(first.awards[0].xp, 20);
  first.state.rewards['mastery:10'] = { ...first.awards[0], at: 1 };
  const later = P.advance(first.state, { word_0: { ...mastered(), mastery_status: 'Learning' } });
  assert.equal(later.state.masteredKeys.length, 10); assert.equal(later.awards.length, 0);
  assert.equal(P.nextMastery(later.state).target, 25);
  assert.deepEqual(Array.from(P.advance({}, entries(100)).awards, award => award.xp), [20, 35, 60, 100]);
  assert.equal(P.nextStation({}, 'short', { availableCount: 2 }), null, 'never suggest an unreachable three-gate goal');
  assert.equal(P.nextStation({ worlds: { 'world:done': { count: 3 } }, rewards: { 'station:done:3': { xp: 25 } } }, 'done', { complete: true }), null);
});

test('two clients cannot both award a mastery threshold; retries and a missing projection use immutable receipts', async () => {
  const db = backend(); db.docs.set(profilePath, { userXP: 100, runnerCoins: 9 }); db.docs.set(masteryPath, { entries: entries(10) });
  const a = client(db), b = client(db);
  const results = await Promise.all([a.claim(), b.claim()]);
  assert.equal(results.reduce((sum, result) => sum + result.awarded.length, 0), 1);
  assert.equal(db.docs.get(profilePath).userXP, 120); assert.equal(db.docs.get(profilePath).runnerCoins, 9);
  const profile = db.docs.get(profilePath); delete profile.motivationRewards;
  const repaired = await a.claim(); assert.equal(repaired.awarded.length, 0); assert.equal(repaired.userXP, 120);
  assert.equal(repaired.state.rewards['mastery:10'].xp, 20);
});

test('gate stations count each saved Gate Clear once and exclude placement or failed gates', async () => {
  const db = backend(), a = client(db), b = client(db);
  const gates = Array.from({ length: 5 }, (_, index) => ({ worldId: 'world', rankId: 'rank', gateId: `gate${index}`, worldLabel: 'عالم الاختبار' }));
  for (const [index, gate] of gates.entries()) db.docs.set(`users/alice/contentProgress/world/ranks/rank/gates/${gate.gateId}`, {
    status: 'cleared', lastClearResult: index === 4 ? 'failed' : 'passed', clearedBy: index === 3 ? 'level-placement' : 'gate-clear',
  });
  const results = await Promise.all([a.claim(gates), b.claim(gates)]);
  assert.equal(db.docs.get(profilePath).motivationRewards.worlds['world:world'].count, 3);
  assert.equal(db.docs.get(profilePath).userXP, 25);
  assert.equal(results.reduce((sum, result) => sum + result.awarded.length, 0), 1);
  await a.claim(gates); assert.equal(db.docs.get(profilePath).userXP, 25);
});

test('failed writes do not grant or consume a milestone and a successful retry grants exactly once', async () => {
  const db = backend(), a = client(db); db.docs.set(masteryPath, { entries: entries(25) }); db.failNext();
  await assert.rejects(a.claim()); assert.equal(db.docs.has(profilePath), false); assert.equal(db.writes.length, 0);
  const result = await a.claim(); assert.equal(result.userXP, 55); assert.equal(result.awarded.length, 2);
  await a.claim(); assert.equal(db.docs.get(profilePath).userXP, 55);
  a.auth.currentUser = { uid: 'bob' }; await assert.rejects(a.claim(), /owner-changed/);
});

test('guest migration carries reward history without paying imported bonuses twice', async () => {
  const reward = { id: 'mastery:10', kind: 'mastery', xp: 20, target: 10, at: 1 };
  const guest = { userXP: 150, motivationRewards: { version: 1, masteredKeys: Object.keys(entries(10)), rewards: { 'mastery:10': reward } } };
  const migrated = applyProfileIntent({ userXP: 100 }, { type: 'guest-import', profile: guest }).profile;
  assert.equal(migrated.userXP, 150); assert.equal(migrated.motivationRewards.rewards['mastery:10'].xp, 20);
  const db = backend(), a = client(db); db.docs.set(profilePath, migrated); db.docs.set(masteryPath, { entries: entries(25) });
  const result = await a.claim(); assert.equal(result.userXP, 185); assert.equal(result.awarded.length, 1);
  assert.equal(result.awarded[0].target, 25);
});
