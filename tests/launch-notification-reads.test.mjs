import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');

test('background notification checks share per-word reads and refresh at evidence, user action, owner change and expiry', async () => {
  const source = read('journey-cloud');
  const start = source.indexOf('async function getGateNotificationFacts(');
  const end = source.indexOf('function subscribeGateProgress(', start);
  const listeners = {};
  let uid = 'first';
  let now = 1000;
  let reads = 0;
  let eligibleEvidenceCount = 0;
  const progress = { status: 'learning', loadedAt: 200, loadedWordKeys: ['one', 'two'], loadedContentWordIds: ['w1', 'w2'] };
  const context = {
    gateNotificationFacts: null, GATE_NOTIFICATION_FACTS_MAX_AGE_MS: 60_000,
    requireUser: () => ({ uid }), timestampMillis: value => value || 0,
    listAllGateWords: async () => [{ wordKey: 'one', contentWordId: 'w1' }, { wordKey: 'two', contentWordId: 'w2' }],
    core: () => ({ cleanId: x => x, contentSourceId: word => word.contentWordId }),
    db: {}, doc: (_db, ...parts) => parts,
    getDoc: async () => { reads++; return { exists: () => true, data: () => ({ eligibleEvidenceCount, linkedAt: 300 }) }; },
    Date: { now: () => now }, window: { addEventListener: (event, listener) => { listeners[event] = listener; } },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const invalidation = source.indexOf("for (const event of ['lootlingua:journey-changed', 'lootlingua:trusted-quiz-completed'])");
  const invalidationEnd = source.indexOf('window.evaluateActivePublishedJourney', invalidation);
  vm.runInContext(source.slice(invalidation, invalidationEnd), context);
  const fetchFacts = options => context.getGateNotificationFacts('world', 'rank', 'gate', { progress, ...options });

  const [first, overlapping] = await Promise.all([fetchFacts(), fetchFacts()]);
  assert.equal(first.unpracticedCount, 2);
  assert.equal(overlapping, first);
  assert.equal(await fetchFacts(), first);
  assert.equal(reads, 4);

  eligibleEvidenceCount = 1;
  listeners['lootlingua:trusted-quiz-completed']();
  assert.equal((await fetchFacts()).unpracticedCount, 0);
  assert.equal(reads, 8);
  await fetchFacts({ fresh: true });
  assert.equal(reads, 12);
  uid = 'other';
  await fetchFacts();
  assert.equal(reads, 16);
  now += 60_000;
  await fetchFacts();
  assert.equal(reads, 20);
  progress.loadedWordKeys = ['one'];
  progress.loadedContentWordIds = ['w1'];
  await fetchFacts();
  assert.equal(reads, 22);
});

test('ready and cleared gates skip background per-word notification reads but an explicit action still refreshes', async () => {
  let status = 'learning';
  const calls = [];
  const window = {
    auth: { currentUser: { uid: 'user' } },
    readWordsFromStorage: () => [],
    LootLinguaJourneyCloud: {
      getActiveJourney: async () => ({ worldId: 'world', activeRankId: 'rank', activeGateId: 'gate' }),
      getGateProgress: async () => ({ status, loadedAt: 100 }),
      getGateNotificationFacts: async (_world, _rank, _gate, options) => {
        calls.push([status, options.fresh]);
        return { unpracticedCount: 5, unpracticedWordKeys: ['one', 'two'] };
      },
    },
  };
  const context = { window, localStorage: { getItem: () => null }, document: { getElementById: () => null } };
  vm.runInNewContext(read('notification-sources'), context);
  const api = window.LootLinguaNotificationSources;
  assert.equal((await api.collect()).gatePractice.unpracticedCount, 5);
  for (status of ['ready', 'cleared', 'available']) assert.equal((await api.collect()).gatePractice.actionable, false);
  status = 'ready';
  await api.collect({ reason: 'review-action' });
  assert.deepEqual(calls, [['learning', false], ['ready', true]]);
});
