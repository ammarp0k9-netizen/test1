import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = ['cloud-backoff', 'operation-runtime', 'sync-status'].map(name =>
  readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'));

function harness(persisted = new Map(), model = { now: 2000000, accounts: {} }) {
  const node = () => Object.assign(new EventTarget(), {
    dataset: {}, style: { setProperty() {} }, textContent: '', hidden: false, offsetHeight: 35,
    getClientRects() { return this.hidden ? [] : [1]; },
    getBoundingClientRect: () => ({ bottom: 68, left: 30, width: 920 }),
    setAttribute() {},
  });
  const title = node();
  const close = node();
  const bar = Object.assign(node(), {
    querySelector: selector => ({
      '[data-sync-title]': title, '[data-sync-copy]': copy, i: icon, button: close,
    })[selector],
  });
  const copy = node();
  const icon = node();
  const header = node();
  const document = {
    readyState: 'complete', documentElement: { lang: 'en' }, body: node(),
    getElementById: id => ({ syncStatusBar: bar, legendTopBar: header })[id],
  };
  const auth = { currentUser: { uid: 'A' } };
  const localStorage = {
    getItem: key => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
    removeItem: key => persisted.delete(key),
  };
  class Clock extends Date { static now() { return model.now; } }
  const window = Object.assign(new EventTarget(), { auth, localStorage, navigator: { onLine: true } });
  const context = vm.createContext({ document, Date: Clock, localStorage, CustomEvent, window });
  vm.runInContext(source[0], context);
  vm.runInContext(source[1], context);
  const operations = window.LootLinguaOperations;
  operations.setSyncSource('dictionary', uid => model.accounts[uid]?.dictionary);
  operations.setSyncSource('profile', uid => model.accounts[uid]?.profile);
  vm.runInContext(source[2], context);
  return {
    operations, backoff: window.LootLinguaCloudBackoff, persisted, model, bar, close, title,
    show: () => bar.hidden ? '' : bar.dataset.state,
    emit: event => window.dispatchEvent(new Event(event)),
    account: uid => { auth.currentUser = uid && { uid }; window.dispatchEvent(new Event('lootlingua:auth-state')); },
    offline: value => { window.navigator.onLine = !value; window.dispatchEvent(new Event(value ? 'offline' : 'online')); },
  };
}

test('ordinary work is silent and only durable quota recovery shows progress and verified success', () => {
  let app = harness();
  const { model, persisted } = app;
  model.accounts.A = { dictionary: { pending: 1 }, profile: { pending: 1 } };
  app.operations.syncActivity('A', 'dictionary', { active: true });
  app.emit('lootlingua:quiz-mode-changed');
  assert.equal(app.show(), '');
  app.backoff.pause({ code: 'resource-exhausted', message: 'Daily quota exceeded' });
  assert.equal(app.show(), 'pending');
  app = harness(persisted, model);
  assert.equal(app.show(), 'pending');
  app.account('B');
  assert.equal(app.show(), '');
  app.account('A');
  model.now += 60001;
  app.operations.syncActivity('A', 'dictionary', { active: true });
  assert.equal(app.show(), 'active');
  app.emit('lootlingua:quiz-mode-changed');
  model.accounts.A.dictionary.pending = 0;
  app.operations.syncActivity('A', 'dictionary', {});
  assert.equal(app.show(), 'active');
  app = harness(persisted, model);
  assert.equal(app.show(), 'active');
  app.operations.syncActivity('A', 'profile', { active: true });
  model.accounts.A.profile.pending = 0;
  app.operations.syncNotify();
  assert.notEqual(app.show(), 'success');
  app.operations.syncActivity('A', 'profile', {});
  assert.equal(app.show(), 'success');
  assert.equal(app.bar.style.width, '920px');
  model.accounts.A.profile.pending = 1;
  app.operations.syncActivity('A', 'profile', { active: true });
  assert.equal(app.show(), 'success');
  model.accounts.A.profile.pending = 0;
  app.operations.syncActivity('A', 'profile', {});
  app.close.dispatchEvent(new Event('click'));
  app = harness(persisted, model);
  assert.equal(app.show(), '');
});

test('offline, local storage failures and rejections never report successful quota recovery', () => {
  const app = harness();
  const dictionary = { pending: 1 };
  app.model.accounts.A = { dictionary };
  app.offline(true);
  assert.equal(app.show(), 'pending');
  app.offline(false);
  assert.equal(app.show(), '');
  app.operations.syncStorageFailure('A', 'dictionary', true);
  app.backoff.pause({ code: 'resource-exhausted', message: 'Quota exceeded' });
  assert.equal(app.show(), 'error');
  assert.equal([...app.persisted.keys()].some(key => key.includes('quota-recovery')), false);
  app.operations.syncStorageFailure('A', 'dictionary', false);
  app.model.now += 60001;
  app.operations.syncActivity('A', 'dictionary', { active: true });
  Object.assign(dictionary, { pending: 0, rejected: 1 });
  app.operations.syncActivity('A', 'dictionary', {});
  assert.equal(app.show(), 'error');
  assert.notEqual(app.title.textContent, 'Your data and progress are synced.');
});
