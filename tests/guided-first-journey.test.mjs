import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [contractSource, controllerSource, worldsSource, htmlSource, rulesSource, popoverSource] = await Promise.all([
  readFile(new URL('../js/guided-first-journey-contract.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/guided-first-journey-controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  readFile(new URL('../js/popover.js', import.meta.url), 'utf8'),
]);

const root = {};
new Function('window', 'globalThis', `${contractSource}\nreturn window.LootLinguaGuidedFirstJourneyContract;`)(root, root);
const guided = root.LootLinguaGuidedFirstJourneyContract;

test('Guided First Journey is only created for a truly new Entry presentation', () => {
  assert.equal(guided.shouldStartForPresentation({ classification: 'brand-new', audience: 'new' }), true);
  assert.equal(guided.shouldStartForPresentation({ classification: 'returning-light', audience: 'returning' }), false);
  assert.equal(guided.shouldStartForPresentation({ classification: 'returning-with-progress', audience: 'returning' }), false);
  assert.equal(guided.shouldStartForPresentation({ classification: 'brand-new', audience: 'returning-guest' }), false);
});

test('the behavioural milestone requires a completed first gate load and its own existing quiz CTA', () => {
  const started = guided.create('world-alpha', 100);
  assert.equal(started.phase, 'awaiting-first-gate');

  const otherWorld = guided.transition(started, {
    type: 'gate-words-loaded', worldId: 'world-beta', gateId: 'gate-1',
  }, 200);
  assert.equal(otherWorld.phase, 'awaiting-first-gate');

  const opened = guided.transition(started, {
    type: 'gate-opened', worldId: 'world-alpha', gateId: 'gate-1',
  }, 300);
  assert.equal(opened.phase, 'first-gate-opened');
  assert.equal(opened.gateId, 'gate-1');
  assert.equal(opened.guestDictionaryAvailable, false);

  const guestFallback = guided.transition(opened, { type: 'enable-guest-dictionary' }, 325);
  assert.equal(guestFallback.guestDictionaryAvailable, true);

  const loaded = guided.transition(guestFallback, {
    type: 'gate-words-loaded', worldId: 'world-alpha', gateId: 'gate-1',
  }, 350);
  assert.equal(loaded.phase, 'awaiting-quiz-cta');
  assert.equal(loaded.gateId, 'gate-1');

  const wrongGate = guided.transition(loaded, {
    type: 'complete', worldId: 'world-alpha', gateId: 'gate-2',
  }, 400);
  assert.equal(wrongGate.phase, 'awaiting-quiz-cta');

  const complete = guided.transition(loaded, {
    type: 'complete', worldId: 'world-alpha', gateId: 'gate-1',
  }, 500);
  assert.equal(complete.phase, 'completed');
  assert.equal(complete.completedAt, 500);
  assert.equal(guided.isActive(complete), false);
});

test('state keys isolate a guest and every account', () => {
  assert.notEqual(guided.storageKey({}), guided.storageKey({ uid: 'account-a' }));
  assert.notEqual(guided.storageKey({ uid: 'account-a' }), guided.storageKey({ uid: 'account-b' }));
  assert.match(guided.storageKey({ uid: 'account-a' }), /guided-first-journey:v1:user:account-a$/);
});

test('the app uses a small persisted UX layer without changing Entry or Journey semantics', () => {
  assert.match(htmlSource, /guided-first-journey-contract\.js/);
  assert.match(htmlSource, /guided-first-journey-controller\.js/);
  assert.match(htmlSource, /guided-first-journey-cloud\.js/);
  assert.match(controllerSource, /beginFromEntry/);
  assert.match(controllerSource, /\['quiz', 'minecraft', 'pubg', 'starred', 'treasure', 'custom-worlds'\]/);
  assert.match(controllerSource, /surface === 'personal'/);
  assert.match(controllerSource, /enableGuestDictionary/);
  assert.match(controllerSource, /guestExploring/);
  assert.match(controllerSource, /if \(guestExploring\) return true/);
  assert.match(controllerSource, /استكشاف الموقع كاملاً كضيف/);
  assert.match(worldsSource, /if \(!syncOnly\)[\s\S]*gateWordsLoaded/);
  assert.match(worldsSource, /completeFromQuizCta/);
  assert.match(worldsSource, /window\.loadQuizView\(\)/);
  assert.match(rulesSource, /match \/guidedFirstJourneys\/\{versionId\}/);
  assert.match(controllerSource, /LootLinguaPopover/);
  assert.match(controllerSource, /lootlingua:journey-auth-requested/);
  assert.match(controllerSource, /pendingIntentFor/);
  assert.match(popoverSource, /closeIf/);
  assert.match(popoverSource, /getActiveId/);
  assert.match(popoverSource, /lootlingua:popover-closed/);
});
