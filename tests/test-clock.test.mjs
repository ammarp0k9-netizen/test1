import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [contractSource, clockSource, evidenceSource, rulesSource, adminSource, htmlSource] = await Promise.all([
  readFile(new URL('../js/test-clock-contract.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/test-clock.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/learning-evidence.js', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

const root = {};
vm.runInContext(contractSource, vm.createContext({ window: root, globalThis: root, Math, Number, Object }));
const clock = root.LootLinguaTestClockContract;

test('ordinary users always receive real time', () => {
  assert.equal(clock.computeEffectiveNow(1000, 86400000, false), 1000);
});

test('an authorized test account can advance one day and reset', () => {
  assert.equal(clock.computeEffectiveNow(1000, 86400000, true), 86401000);
  assert.equal(clock.computeEffectiveNow(1000, 0, true), 1000);
});

test('offsets are bounded and moving backward never mutates progression data', () => {
  assert.equal(clock.clampOffset(Infinity), 0);
  assert.equal(clock.clampOffset(clock.MAX_OFFSET_MS * 2), clock.MAX_OFFSET_MS);
  assert.equal(clock.computeEffectiveNow(1000, -5000, true), 0);
  assert.doesNotMatch(clockSource, /deleteDoc|update.*contentProgress|eligibleEvidenceCount|awardXP/);
});

test('readiness presentation uses effective time while server writes stay real', () => {
  assert.match(evidenceSource, /LootLinguaTestClock/);
  assert.match(evidenceSource, /effectiveNow\(\)/);
  assert.match(clockSource, /serverTimestamp\(\)/);
  assert.doesNotMatch(clockSource, /Timestamp\.from|request\.time|Date\.prototype/);
});

test('Test Clock is claim-gated, account-scoped, event-driven, and visible only in admin UI', () => {
  assert.match(rulesSource, /request\.auth\.token\.testClock == true/);
  assert.match(rulesSource, /match \/testSettings\/clock/);
  assert.match(rulesSource, /validTestClock\(request\.resource\.data, uid\)/);
  assert.match(clockSource, /onSnapshot\(clockRef\(uid\)/);
  assert.doesNotMatch(clockSource, /setInterval|poll/);
  assert.match(adminSource, /state\.canUseTestClock/);
  assert.match(adminSource, /وضع الزمن التجريبي مفعّل/);
});

test('the clock module is loaded once and never changes server timestamps or reward modules', () => {
  assert.equal((htmlSource.match(/src="js\/test-clock\.js(?:\?[^\"]+)?"/g) || []).length, 1);
  assert.doesNotMatch(clockSource, /xp\.js|awardXP|streak|serverTimestamp\s*=/i);
  assert.doesNotMatch(rulesSource, /function effectiveRequestTime|fakeRequestTime/);
});
