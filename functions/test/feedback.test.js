'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubmitFeedbackHandler } = require('../feedback');

class TestHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function fakeDb() {
  const writes = [];
  const profile = { exists: true, data: () => ({ userXP: 42, displayName: 'ignored' }) };
  const journeys = { docs: [{ data: () => ({ contentJourneyStatus: 'completed-current-content', passedCefrLevels: ['A1'], levelPlacementClearedGateIds: ['g1'] }) }] };
  const count = { data: () => ({ count: 3 }) };
  return {
    writes,
    collection(name) {
      assert.equal(name, 'feedback');
      return { doc: (id) => ({ id, create: async (value) => writes.push(value) }) };
    },
    userCollection(name) {
      return {
        doc: () => ({ get: async () => profile }),
        get: async () => journeys,
        count: () => ({ get: async () => count }),
      };
    },
  };
}

function accountDb() {
  const base = fakeDb();
  const feedbackCollection = base.collection.bind(base);
  base.collection = (name) => {
    if (name === 'feedback') return feedbackCollection(name);
    assert.equal(name, 'users');
    return { doc: () => ({ collection: (child) => base.userCollection(child) }) };
  };
  return base;
}

test('feedback function accepts only the three public fields and writes server metadata', async () => {
  const db = accountDb();
  const handler = createSubmitFeedbackHandler({
    db,
    FieldValue: { serverTimestamp: () => 'server-time' },
    HttpsError: TestHttpsError,
    makeId: () => 'feedback-1',
  });
  await handler({ auth: { uid: 'account-1' }, data: { rating: 5, message: 'ممتاز', optionalName: '' } });
  assert.equal(db.writes.length, 1);
  assert.deepEqual(db.writes[0].metadata, {
    accountType: 'account', uid: 'account-1', currentXP: 42,
    progression: { completedWorlds: 1, completedRanks: 1, completedGates: 1 },
    trustedQuizCount: 3, accountCreatedAt: null, appVersion: '2026.08',
  });
  await assert.rejects(
    () => handler({ auth: { uid: 'account-1' }, data: { rating: 5, message: '', optionalName: '', currentXP: 999999 } }),
    (error) => error.code === 'invalid-argument'
  );
});
