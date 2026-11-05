import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const xp = await readFile(new URL('../js/xp.js', import.meta.url), 'utf8');
const batch = await readFile(new URL('../js/xp-batch.js', import.meta.url), 'utf8');
const rewards = xp.slice(xp.indexOf('const XP_ECONOMY_VERSION'), xp.indexOf('function renderXpRanksGuide'));
const event = (eventId = 'shared') => ({ amount: 8, reason: 'word_mastered_first', eventId });
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function harness() {
  const values = new Map();
  const writes = [];
  const requests = [];
  const warnings = [];
  let profileSaves = 0;
  const root = { auth: { currentUser: { uid: 'A' } }, __lootlinguaAuthGeneration: 1, addEventListener() {} };
  const claim = (kind, payload) => new Promise((resolve, reject) => {
    requests.push({ kind, payload, uid: root.auth.currentUser.uid, resolve, reject });
  });
  root.claimXPEventInCloud = (payload) => claim('single', payload);
  root.claimXPEventsInCloud = (payload) => claim('batch', payload);
  const context = vm.createContext({
    window: root, Date, Number, Math, JSON, Set, Map,
    console: { info() {}, warn: (...args) => warnings.push(args) },
    getStorageUserId: () => root.auth.currentUser?.uid || 'guest',
    hasSignedInUser: () => Boolean(root.auth.currentUser),
    loadJSON: (key, fallback) => JSON.parse(values.get(key) || JSON.stringify(fallback)),
    saveJSON: (key, value) => { values.set(key, JSON.stringify(value)); writes.push(key); },
    saveInt: (key, value) => { values.set(key, String(value)); writes.push(key); },
    getRank: () => ({ label: 'rank' }),
    markGuestDataDirty() {}, checkThemeRelocksAfterXP() {}, checkThemeUnlocksAfterXP() {},
    renderXPBar() {}, refreshFeatureUnlockUI() {}, isJsonImportBatchActive: () => true,
    requestProfileCloudSave: () => { profileSaves++; },
  });
  vm.runInContext(`let userXP = 100;\n${rewards}\n${batch}`, context);
  return {
    root, values, writes, requests, warnings,
    get xp() { return vm.runInContext('userXP', context); },
    get inflight() { return JSON.parse(vm.runInContext('JSON.stringify([...xpAwardsInFlight])', context)); },
    get profileSaves() { return profileSaves; },
    switchTo(uid, xp = 500) {
      root.auth.currentUser = uid ? { uid } : null;
      root.__lootlinguaAuthGeneration++;
      vm.runInContext(`userXP = ${xp}`, context);
    },
    grant(kind, metadata = { eventId: 'shared', queueOnFailure: true }) {
      context.inputMetadata = metadata;
      return kind === 'single'
        ? vm.runInContext("awardXP(8, 'word_mastered_first', inputMetadata)", context)
        : root.awardXPBatch([{ amount: 8, reason: 'word_mastered_first', metadata }]);
    },
    settle(index, status, userXP = 900) {
      const request = requests[index];
      if (status === 'failure') { request.reject(new Error('offline')); return; }
      const outcome = status === 'awarded' ? { awarded: true } : { awarded: false, duplicate: true };
      request.resolve(request.kind === 'single' ? { ...outcome, userXP } : { results: [outcome], userXP });
    },
    retry() { return root.retryPendingXPEvents(); },
    pending(uid) { return JSON.parse(values.get(`lootlinguaPendingXpEvents_${uid}`) || '[]'); },
    log(uid) { return JSON.parse(values.get(`lootlinguaXpEventLog_${uid}`) || '[]'); },
  };
}

test('single and batch ignore old-session success, duplicate and failure after A to B or A to B to A', async () => {
  for (const kind of ['single', 'batch']) for (const aba of [false, true]) {
    for (const status of ['awarded', 'duplicate', 'failure']) {
      const h = harness();
      const metadata = { eventId: 'shared', queueOnFailure: true };
      const granting = h.grant(kind, metadata);
      h.switchTo('B');
      if (aba) h.switchTo('A');
      const before = h.writes.length;
      h.settle(0, status);
      const result = await granting;
      assert.equal(kind === 'single' ? result : result.total, 0);
      assert.equal(metadata.awardStatus, 'unavailable');
      assert.equal(h.xp, 500);
      assert.equal(h.writes.length, before);
      assert.equal(h.profileSaves, 0);
      assert.equal(h.warnings.length, 0);
      assert.equal(h.inflight.length, 0);
    }
  }
});

test('an old single or batch cannot block or clear the same event in another auth session', async () => {
  for (const first of ['single', 'batch']) for (const aba of [false, true]) {
    const h = harness();
    const a = h.grant(first);
    h.switchTo('B');
    if (aba) h.switchTo('A');
    const currentUid = aba ? 'A' : 'B';
    const bMetadata = { eventId: 'shared', queueOnFailure: true };
    const b = h.grant(first === 'single' ? 'batch' : 'single', bMetadata);
    assert.equal(h.requests.length, 2);
    h.settle(0, 'awarded');
    await a;
    assert.equal(h.inflight.length, 1);
    assert.equal(JSON.parse(h.inflight[0])[0], currentUid);
    h.settle(1, 'awarded', 508);
    const result = await b;
    assert.equal(typeof result === 'number' ? result : result.total, 8);
    assert.equal(bMetadata.awardStatus, 'awarded');
    assert.equal(h.xp, 508);
    if (!aba) assert.equal(h.log('A').length, 0);
    assert.equal(h.log(currentUid).length, 1);
    assert.equal(h.inflight.length, 0);
  }
});

test('same-session in-flight single/batch overlap is pending rather than a confirmed duplicate', async () => {
  for (const [first, next] of [['single', 'single'], ['single', 'batch'], ['batch', 'single']]) {
    const h = harness();
    const a = h.grant(first);
    const metadata = { eventId: 'shared', queueOnFailure: true };
    const result = await h.grant(next, metadata);
    assert.equal(metadata.awardStatus, 'unavailable');
    assert.equal(typeof result === 'number' ? result : result.total, 0);
    assert.equal(h.requests.length, 1);
    assert.equal(h.inflight.length, 1);
    assert.equal(h.pending('A').length, 1);
    h.settle(0, 'failure');
    await a;
    assert.equal(h.pending('A').length, 1);
  }
});

test('stale retries stop before another claim or queue rewrite, then safely reconcile after re-authentication', async () => {
  for (const aba of [false, true]) for (const status of ['awarded', 'duplicate', 'failure']) {
    const h = harness();
    const pendingA = [event('one'), event('two')];
    const pendingB = [event('B-only')];
    h.values.set('lootlinguaPendingXpEvents_A', JSON.stringify(pendingA));
    h.values.set('lootlinguaPendingXpEvents_B', JSON.stringify(pendingB));
    const retry = h.retry();
    assert.equal(h.requests.length, 1);
    h.switchTo('B');
    if (aba) h.switchTo('A', 100);
    const xp = h.xp;
    h.settle(0, status, 108);
    await retry;
    assert.equal(h.requests.length, 1);
    assert.equal(h.xp, xp);
    assert.deepEqual(h.pending('A'), pendingA);
    assert.deepEqual(h.pending('B'), pendingB);
    assert.equal(h.writes.length, 0);
    if (!aba) h.switchTo('A', 100);
    const current = h.retry();
    h.settle(1, 'duplicate', 108);
    await flush();
    assert.equal(h.requests.length, 3);
    h.settle(2, 'awarded', 116);
    await current;
    assert.deepEqual(h.pending('A'), []);
    assert.deepEqual(h.pending('B'), pendingB);
    assert.equal(h.xp, 116);
  }
});

test('current rewards retain their documented amount and durable duplicate behavior', async () => {
  const h = harness();
  const metadata = { eventId: 'current', queueOnFailure: true };
  const granting = h.grant('single', metadata);
  h.settle(0, 'awarded', 108);
  assert.equal(await granting, 8);
  assert.equal(metadata.awardStatus, 'awarded');
  assert.equal(h.xp, 108);
  assert.equal(h.log('A')[0].amount, 8);
  const again = { eventId: 'current' };
  assert.equal(await h.grant('batch', again).then((result) => result.total), 0);
  assert.equal(again.awardStatus, 'duplicate');
  assert.equal(h.requests.length, 1);
});
