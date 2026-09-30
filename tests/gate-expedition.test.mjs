import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

function expedition() {
  const values = new Map();
  const context = {
    window: { auth: { currentUser: { uid: 'player-1' } } },
    localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    Date, Number, String, Array, JSON, Math, Object, Set,
  };
  vm.runInNewContext(fs.readFileSync('js/gate-expedition.js', 'utf8'), context);
  return context.window.LootLinguaGateExpedition;
}

const gate = { worldId: 'world', rankId: 'rank', gateId: 'gate' };

test('two-hour and next-day waits receive bounded shard goals', () => {
  const api = expedition();
  assert.equal(api.windowTarget('two-hour', 2 * 3600000), 2);
  assert.equal(api.windowTarget('next-day', 24 * 3600000), 4);
  assert.equal(api.windowTarget('next-day', 30 * 60000), 1);
});

test('the two wait phases rotate between the two games for one gate', () => {
  const api = expedition();
  assert.notEqual(api.gameFor(gate, 'two-hour'), api.gameFor(gate, 'next-day'));
});

test('an official review suppresses side-game play without touching SRS data', () => {
  const api = expedition();
  const view = api.getView({ ...gate, progress: { availableForReviewNowCount: 1 } });
  assert.equal(view.mode, 'official-due');
  assert.equal(view.window, null);
});

test('a waiting window is stable for the same official review deadline', () => {
  const api = expedition();
  const context = { ...gate, progress: { waitingLaterTodayCount: 1, readinessNextAt: Date.now() + 2 * 3600000 } };
  const first = api.getView(context);
  const second = api.getView(context);
  assert.equal(first.window.id, second.window.id);
  assert.equal(first.window.target, 2);
});
