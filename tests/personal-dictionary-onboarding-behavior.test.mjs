import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/personal-dictionary-onboarding.js', import.meta.url), 'utf8');
function harness(values = new Map()) {
  const listeners = new Map();
  const root = { auth: { currentUser: null },
    addEventListener(type, fn) { listeners.set(type, fn); },
    dispatchEvent() {},
  };
  const storage = { getItem: key => values.get(key) || null, setItem: (key, val) => values.set(key, val), removeItem: key => values.delete(key) };
  const document = { addEventListener() {}, getElementById() { return null; } };
  new Function('window', 'document', 'localStorage', 'setTimeout', 'CustomEvent', source)(root, document, storage, () => {}, class { constructor(type, args) { this.type = type; this.detail = args?.detail; } });
  return { root, api: root.LootLinguaPersonalDictionaryOnboarding, values, emit: (type, detail) => listeners.get(type)?.({ detail }) };
}
test('guest waits at the real auth boundary and persisted word advances only to the top-bar guide', () => {
  const h = harness();
  h.api.planForFirstJourney({ requiresFirstWord: true });
  h.emit('lootlingua:dictionary-word-saved');
  assert.equal(h.api.getState().phase, 'awaiting-journey');
  h.api.beginGuestDictionary();
  assert.equal(h.api.getState().phase, 'awaiting-first-word');
  h.emit('lootlingua:dictionary-word-saved');
  assert.equal(h.api.getState().step, 4);
  assert.notEqual(h.api.getState().phase, 'completed');
  assert.ok(h.api.getState().firstWordSavedAt);
});
test('reload and sign-in preserve the incomplete guide without repeating welcome or claiming completion', () => {
  const h = harness();
  h.api.planForFirstJourney({ requiresFirstWord: true }); h.api.beginGuestDictionary();
  h.emit('lootlingua:dictionary-word-saved');
  const refreshed = harness(h.values);
  assert.equal(refreshed.api.getState().step, 4);
  refreshed.root.auth.currentUser = { uid: 'account-a' };
  refreshed.emit('lootlingua:auth-state');
  assert.equal(refreshed.api.getState().step, 4);
  assert.equal(h.values.has('lootlingua:personal-dictionary-onboarding:v1:guest'), false);
  refreshed.root.auth.currentUser = { uid: 'account-b' };
  refreshed.emit('lootlingua:auth-state');
  assert.equal(refreshed.api.getState(), null);
});
