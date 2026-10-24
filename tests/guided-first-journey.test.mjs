import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [contractSource, controllerSource, worldsSource, htmlSource, rulesSource, popoverSource, quizSource, quizRuntimeSource] = await Promise.all([
  readFile(new URL('../js/guided-first-journey-contract.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/guided-first-journey-controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  readFile(new URL('../js/popover.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz-runtime.js', import.meta.url), 'utf8'),
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

class MemoryStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

function createControllerHarness() {
  const listeners = new Map();
  const classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
  const document = {
    documentElement: { classList },
    body: { classList },
    querySelectorAll: () => [],
    createElement: () => ({
      className: '',
      id: '',
      textContent: '',
      classList,
      append() {},
      setAttribute() {},
    }),
  };
  const root = {
    auth: { currentUser: { uid: 'guided-user' } },
    document,
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((candidate) => candidate !== listener));
    },
    dispatchEvent(event) {
      const dispatched = {
        type: event.type,
        detail: event.detail,
        target: root,
        preventDefault() {},
      };
      for (const listener of listeners.get(event.type) || []) listener.call(root, dispatched);
      return true;
    },
  };
  const evaluate = new Function(
    'window',
    'globalThis',
    `const localStorage = window.localStorage;
const sessionStorage = window.sessionStorage;
const document = window.document;
${contractSource}
${controllerSource}
return window.LootLinguaGuidedFirstJourney;`
  );
  return { root, controller: evaluate(root, root) };
}

test('trusted quiz completion requires the exact onboarding gate hierarchy', async () => {
  const { controller, root } = createControllerHarness();
  await controller.beginFromEntry({
    presentation: { classification: 'brand-new', audience: 'new' },
    worldId: 'world-alpha',
  });
  await controller.gateOpened({ worldId: 'world-alpha', gateId: 'gate-1' });
  await controller.gateWordsLoaded({ worldId: 'world-alpha', gateId: 'gate-1' });
  assert.equal(controller.getState().phase, 'awaiting-quiz-cta');

  const completedDetail = {
    source: 'journey:world-alpha~rank-a~gate-1',
    worldId: 'world-alpha',
    rankId: 'rank-a',
    gateId: 'gate-1',
    total: 3,
  };

  root.dispatchEvent({
    type: 'lootlingua:trusted-quiz-completed',
    detail: { ...completedDetail, gateId: 'gate-2' },
  });
  assert.equal(controller.getState().phase, 'awaiting-quiz-cta');

  root.dispatchEvent({
    type: 'lootlingua:trusted-quiz-completed',
    detail: { ...completedDetail, worldId: 'world-beta' },
  });
  assert.equal(controller.getState().phase, 'awaiting-quiz-cta');

  root.dispatchEvent({
    type: 'lootlingua:trusted-quiz-completed',
    detail: { ...completedDetail, gateId: '' },
  });
  assert.equal(controller.getState().phase, 'awaiting-quiz-cta');

  root.dispatchEvent({
    type: 'lootlingua:trusted-quiz-completed',
    detail: completedDetail,
  });
  assert.equal(controller.getState().phase, 'completed');
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
  assert.match(worldsSource, /\bloadQuizView\(\)/);
  assert.match(quizSource, /journeyWorldId: input\.worldId/);
  assert.match(quizSource, /journeyGateId: input\.gateId/);
  assert.match(quizRuntimeSource, /activeQuizSession\?\.journeyWorldId/);
  assert.match(quizRuntimeSource, /worldId: detailWorldId/);
  assert.match(controllerSource, /eventWorldId !== runtime\.state\.worldId/);
  assert.match(controllerSource, /eventGateId !== runtime\.state\.gateId/);
  assert.match(rulesSource, /match \/guidedFirstJourneys\/\{versionId\}/);
  assert.match(controllerSource, /LootLinguaPopover/);
  assert.match(controllerSource, /lootlingua:journey-auth-requested/);
  assert.match(controllerSource, /pendingIntentFor/);
  assert.match(popoverSource, /closeIf/);
  assert.match(popoverSource, /getActiveId/);
  assert.match(popoverSource, /lootlingua:popover-closed/);
});
