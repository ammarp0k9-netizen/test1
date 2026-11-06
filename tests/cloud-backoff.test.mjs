import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync(new URL('../js/cloud-backoff.js', import.meta.url), 'utf8');
function client(values = new Map()) {
  let now = 1000000;
  const root = { addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(source, { window: root, Date: { now: () => now }, localStorage: {
    getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  }, CustomEvent: class {} });
  return { gate: root.LootLinguaCloudBackoff, advance(ms) { now += ms; }, values };
}
test('quota backoff survives reload, shares a pause, and increases only after a failed recovery attempt', () => {
  const a = client(), error = { code: 'resource-exhausted' };
  assert.equal(a.gate.pause(error), 60000);
  assert.equal(a.gate.pause(error), 60000, 'parallel failures share a single window');
  assert.throws(() => a.gate.assertAvailable(), { code: 'resource-exhausted' });
  const b = client(a.values); assert.equal(b.gate.remaining(), 60000);
  a.advance(60001); a.gate.assertAvailable(); assert.equal(a.gate.pause(error), 120000);
  a.advance(120001); a.gate.recovered(); assert.equal(a.gate.remaining(), 0);
  assert.equal(a.gate.pause({ code: 'permission-denied' }), 0);
});
