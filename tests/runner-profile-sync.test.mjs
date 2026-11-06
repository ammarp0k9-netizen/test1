import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const source = await readFile(new URL('../js/gate-runner.js', import.meta.url), 'utf8');
function harness(signed = true) {
  const values = new Map([['lootlingua.runner.coins.v1', '100'], ['lootlingua.runner.best-distance.v1', '10']]);
  const intents = [];
  const root = { auth: { currentUser: signed ? { uid: 'A' } : null },
    crypto: { randomUUID: () => 'random-run' },
    commitProfileIntent: async intent => { intents.push(intent); return { saved: true, applied: true }; },
    queueProfileIntent: intent => { intents.push(intent); return 'queued-max'; },
  };
  vm.runInNewContext(source, { window: root, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, console });
  if (signed) root.LootLinguaGateRunner.acceptProfile({ runnerCoins: 100, runnerBestDistance: 10 }, 'A');
  return { api: root.LootLinguaGateRunner, root, values, intents };
}
test('Runner account coins use the earned delta and immutable run ID without rewriting a cached balance', async () => {
  const h = harness();
  await h.api.RunnerCoinWallet.credit(7, 'run-once');
  assert.equal(h.values.get('lootlingua.runner.coins.v1'), '100');
  assert.equal(h.intents.length, 1); assert.equal(h.intents[0].amount, 7); assert.equal(h.intents[0].eventId, 'run-once');
  assert.equal(h.intents[0].field, 'runnerCoins'); assert.equal(h.intents[0].type, 'wallet-delta');
  assert.equal('userXP' in h.intents[0], false);
});
test('Runner guest wallet remains local and record changes use a maximum intent for accounts', async () => {
  const guest = harness(false); guest.api.RunnerCoinWallet.credit(3);
  assert.equal(guest.values.get('lootlingua.runner.coins.v1'), '103'); assert.equal(guest.intents.length, 0);
  const account = harness();
  assert.equal(account.api.RunnerBestDistance.save(9), false);
  assert.equal(account.api.RunnerBestDistance.save(25), true);
  assert.equal(account.intents.length, 1); assert.equal(account.intents[0].type, 'max'); assert.equal(account.intents[0].field, 'runnerBestDistance');
  assert.equal(account.intents[0].value, 25);
});
test('unavailable account sync does not fabricate a new local wallet balance', async () => {
  const h = harness(); delete h.root.commitProfileIntent;
  h.api.RunnerCoinWallet.credit(10);
  assert.equal(h.values.get('lootlingua.runner.coins.v1'), '100'); assert.equal(h.intents.length, 0);
});


test('all runner entry points share account progress while different accounts stay isolated', () => {
  const h=harness();assert.equal(h.api.RunnerCoinWallet.balance(),100);
  h.root.auth.currentUser={uid:'B'};
  assert.equal(h.api.RunnerCoinWallet.balance(),0);assert.equal(h.api.RunnerBestDistance.value(),0);
  h.api.acceptProfile({runnerCoins:999,runnerBestDistance:999},'A');assert.equal(h.api.RunnerCoinWallet.balance(),0);
  h.api.acceptProfile({runnerCoins:7,runnerBestDistance:320},'B');
  assert.equal(h.api.RunnerCoinWallet.balance(),7);assert.equal(h.api.RunnerBestDistance.value(),320);
  h.root.auth.currentUser={uid:'A'};assert.equal(h.api.RunnerCoinWallet.balance(),100);assert.equal(h.api.RunnerBestDistance.value(),10);
});
