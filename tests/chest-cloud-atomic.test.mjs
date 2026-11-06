import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../js/cloud.js', import.meta.url), 'utf8');
const writer = source.slice(source.indexOf('  window.claimXPEventInCloud ='), source.indexOf('  window.listenCustomWorldWordsFromCloud ='));
const profilePath = 'users/a/meta/profile';
const eventPath = 'users/a/meta/xp_event_daily_chest_unlock:100';
function harness({ fail = false, retry = false } = {}) {
  const profile = { userXP: 100, dailyLootState: { lockedXP: 20, lockStartedAt: 100, lastOpenAt: 100,
    totalOpens: 5, lockMasteredWordIds: ['one', 'two'], lockHighAccuracyQuizIds: [] }, displayName: 'Name' };
  const documents = new Map([[profilePath, structuredClone(profile)]]), operations = [];
  const root = {};
  const context = vm.createContext({ window: root, auth: { currentUser: { uid: 'a' } }, db: {}, Date,
    doc: (_db, ...parts) => parts.join('/'),
    async runTransaction(_db, callback) {
      let writes;
      for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
        writes = [];
        const value = await callback({
          get: async path => ({ exists: () => documents.has(path), data: () => structuredClone(documents.get(path)) }),
          set: (path, data, options) => writes.push({ path, data: structuredClone(data), options }),
        });
        if (retry && !attempt) continue;
        if (fail) throw Error('simulated transaction failure');
        for (const write of writes) documents.set(write.path, write.options?.merge ? { ...documents.get(write.path), ...write.data } : write.data);
        operations.push(...writes); return value;
      }
    },
  });
  vm.runInContext(writer, context);
  return { root, documents, operations, profile,
    claim: (patch = {}) => root.claimXPEventInCloud({ amount: 20, reason: 'daily_chest_unlock', eventId: 'daily_chest_unlock:100', baselineXP: 100, ...patch }) };
}

test('claiming chest XP resolves its lock and writes the receipt in one transaction', async () => {
  const h = harness(), result = await h.claim();
  assert.equal(result.awarded, true); assert.equal(h.documents.get(profilePath).userXP, 120);
  assert.equal(h.documents.get(profilePath).dailyLootState.lockedXP, 0);
  assert.equal(h.documents.get(profilePath).dailyLootState.lockStartedAt, 0);
  assert.equal(h.documents.get(profilePath).dailyLootState.totalOpens, 5);
  assert.equal(h.documents.get(profilePath).displayName, 'Name');
  assert.equal(h.documents.get(eventPath).amount, 20); assert.equal(h.operations.length, 2);
  assert.equal(h.documents.get(profilePath)._syncRevision, 1);
  assert.equal((await h.claim()).duplicate, true); assert.equal(h.documents.get(profilePath).userXP, 120);
  assert.equal(h.documents.get(profilePath)._syncRevision, 1);
});

test('failed or retried transactions cannot partially resolve or grant the chest twice', async () => {
  const failed = harness({ fail: true }); await assert.rejects(failed.claim(), /transaction failure/);
  assert.deepEqual(failed.documents.get(profilePath), failed.profile); assert.equal(failed.documents.has(eventPath), false);
  const retried = harness({ retry: true }); await retried.claim();
  assert.equal(retried.documents.get(profilePath).userXP, 120); assert.equal(retried.operations.length, 2);
});

test('a duplicate legacy claim repairs only its matching unresolved chest', async () => {
  const h = harness(); h.documents.set(eventPath, { amount: 20, reason: 'daily_chest_unlock' });
  h.documents.get(profilePath).userXP = 120;
  assert.equal((await h.claim()).duplicate, true);
  assert.equal(h.documents.get(profilePath).dailyLootState.lockedXP, 0);
  assert.equal(h.documents.get(profilePath).userXP, 120);
  assert.equal(h.documents.get(profilePath)._syncRevision, 1);
  const newer = harness(); newer.documents.set(eventPath, { amount: 20, reason: 'daily_chest_unlock' });
  newer.documents.get(profilePath).dailyLootState.lockStartedAt = 200;
  await newer.claim(); assert.equal(newer.documents.get(profilePath).dailyLootState.lockedXP, 20);
  assert.equal(newer.operations.length, 0);
});

test('an invalid amount, foreign receipt or word XP cannot resolve the chest', async () => {
  const h = harness(); assert.equal((await h.claim({ amount: 25 })).invalid, true); assert.equal(h.operations.length, 0);
  h.documents.set(eventPath, { amount: 2, reason: 'word_transition_new_learning' });
  await h.claim(); assert.equal(h.documents.get(profilePath).dailyLootState.lockedXP, 20); assert.equal(h.operations.length, 0);
  await h.claim({ amount: 2, reason: 'word_transition_new_learning', eventId: 'word_transition:apple:new_learning' });
  assert.equal(h.documents.get(profilePath).userXP, 102); assert.equal(h.documents.get(profilePath).dailyLootState.lockedXP, 20);
});
