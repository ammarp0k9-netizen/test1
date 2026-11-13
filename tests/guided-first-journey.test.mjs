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
      addEventListener() {},
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getState().phase, 'awaiting-quiz-cta');

  root.dispatchEvent({
    type: 'lootlingua:trusted-quiz-completed',
    detail: { ...completedDetail, worldId: 'world-beta' },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getState().phase, 'awaiting-quiz-cta');

  root.dispatchEvent({
    type: 'lootlingua:trusted-quiz-completed',
    detail: { ...completedDetail, gateId: '' },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getState().phase, 'awaiting-quiz-cta');

  root.dispatchEvent({
    type: 'lootlingua:trusted-quiz-completed',
    detail: completedDetail,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getState().phase, 'completed');
});

test('guest dictionary hand-off closes the public coach and never resurrects its stale route', async () => {
  const { controller, root } = createControllerHarness();
  let opened = 0;
  let closed = 0;
  root.LootLinguaPopover = { getActiveId: () => '', open(options) { opened++; assert.equal(options.persistent, true); }, closeIf() { closed++; } };
  await controller.beginFromEntry({ presentation: { classification: 'brand-new', audience: 'new' }, worldId: 'world-alpha' });
  const target = { textContent: 'ابدأ رحلة التعلم', classList: { add() {}, remove() {} } };
  const routeRoot = { isConnected: true, querySelectorAll: () => [], querySelector: () => target };
  const route = { type: 'gate', worldId: 'world-alpha', root: routeRoot };
  controller.applyRoute(route);
  assert.equal(opened, 1);
  controller.clearCoach();
  root.dispatchEvent({ type: 'lootlingua:popover-closed', detail: { id: 'personalDictionaryOnboardingCoach' } });
  assert.equal(opened, 1);
  root.auth.currentUser = null;
  await controller.enableGuestDictionary();
  root.LootLinguaPersonalDictionaryOnboarding = { getState: () => ({ phase: 'completed' }) };
  controller.applyRoute(route);
  assert.equal(opened, 1, 'completed dictionary guidance must not restart the guest gate coach');
  assert.ok(closed > 0);
  assert.equal(controller.getState().phase, 'awaiting-first-gate', 'learning progress is preserved');
});

test('verified completion recovers if the journey cloud phase lags behind its completed gate quiz', async () => {
  const { controller, root } = createControllerHarness();
  await controller.beginFromEntry({
    presentation: { classification: 'brand-new', audience: 'new' },
    worldId: 'world-alpha',
  });
  assert.equal(controller.getState().phase, 'awaiting-first-gate');

  root.dispatchEvent({
    type: 'lootlingua:trusted-quiz-completed',
    detail: {
      source: 'verified-session',
      journeyContext: true,
      worldId: 'world-alpha',
      rankId: 'rank-a',
      gateId: 'gate-1',
      total: 3,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getState().phase, 'completed');
});

test('an active public-world journey does not override ordinary feature eligibility', async () => {
  const { controller } = createControllerHarness();
  await controller.beginFromEntry({
    presentation: { classification: 'brand-new', audience: 'new' },
    worldId: 'world-alpha',
  });
  assert.equal(controller.getState().phase, 'awaiting-first-gate');
  assert.equal(controller.shouldAllowSurface('quiz'), true);
  assert.equal(controller.shouldAllowSurface('custom-worlds'), true);
});

test('choosing a world, browsing another, and starting there are distinct actions', async () => {
  const { controller, root } = createControllerHarness();
  const outbox = [];
  root.queueProfileIntent = (intent) => outbox.push(intent);
  await controller.beginFromEntry({
    presentation: { classification: 'brand-new', audience: 'new' },
    worldId: 'preview-world', chooseWorld: true,
  });
  assert.equal(controller.getState().phase, 'choosing-world');
  assert.equal(controller.getState().worldId, '');
  controller.selectWorld('first-world');
  assert.equal(controller.getState().worldId, 'first-world');
  const world = { isConnected: true, querySelectorAll: () => [], querySelector: () => null };
  controller.selectWorld('browsed-world');
  controller.applyRoute({ type: 'world', worldId: 'browsed-world', root: world });
  assert.equal(controller.getState().worldId, 'first-world');
  controller.journeyStarted({ worldId: 'browsed-world' });
  assert.equal(controller.getState().worldId, 'browsed-world');
  assert.equal(controller.getState().suggestedWorldId, 'preview-world');
  assert.deepEqual(outbox.map(({ state }) => state.worldId), ['', 'first-world', 'browsed-world']);
  assert.equal(outbox.every(({ tour }) => tour === 'public-world-guide'), true);
});

test('placement result checkpoints restore and follow only the recommended gate after continuing', async () => {
  const { controller, root } = createControllerHarness();
  const seen = [];
  const target = { dataset: { guidePlacementLevel: 'B1' }, classList: { add() {} } };
  const world = { isConnected: true, querySelectorAll: () => [target], querySelector: () => target };
  root.LootLinguaPopover = { getActiveId: () => '', open(options) { seen.push(options); }, closeIf() {} };
  await controller.beginFromEntry({ presentation: { classification: 'brand-new', audience: 'new' }, worldId: 'world-a' });
  controller.setPlacement({ worldId: 'world-a', placementStage: 'assessment', placementLevel: 'A2', assessmentId: 'one' });
  controller.applyRoute({ type: 'assessment', worldId: 'world-a', root: world });
  assert.equal(seen.length, 0, 'answering the test is interruption-free');
  controller.setPlacement({ worldId: 'world-a', placementStage: 'offer', placementLevel: 'A2', assessmentId: 'one' });
  target.dataset.guidePlacementLevel = 'A2';
  controller.applyRoute({ type: 'world', worldId: 'world-a', root: world });
  assert.match(seen.at(-1).reading.text, /العودة لاختبار المستوى/);
  controller.setPlacement({ worldId: 'world-a', placementStage: 'result', placementLevel: 'B1', assessmentId: 'one', resultStep: 2 });
  controller.applyRoute({ type: 'placement-result', worldId: 'world-a', root: world, assessmentId: 'one', nextLevel: 'B1' });
  assert.match(seen.at(-1).reading.text, /B1/);
  target.dataset.guidePlacementLevel = 'B1';
  controller.applyRoute({ type: 'world', worldId: 'world-a', root: world });
  assert.match(seen.at(-1).reading.text, /B1/);
  controller.placementGate({ worldId: 'world-a', rankId: 'rank-b', gateId: 'gate-b' });
  controller.gateOpened({ worldId: 'world-a', gateId: 'wrong-gate' });
  assert.equal(controller.getState().phase, 'awaiting-first-gate');
  controller.gateOpened({ worldId: 'world-a', rankId: 'rank-b', gateId: 'gate-b' });
  assert.equal(controller.getState().phase, 'first-gate-opened');
  controller.worldCompleted('world-a');
  assert.equal(controller.getState().phase, 'completed');
});


test('gate word loading stays visible while per-word cloud progress updates arrive', () => {
  const refreshBody = worldsSource.slice(
    worldsSource.indexOf('async function refreshPublishedGateMasteryView'),
    worldsSource.indexOf('function watchPublishedGateProgress')
  );
  const watcherBody = worldsSource.slice(
    worldsSource.indexOf('function watchPublishedGateProgress'),
    worldsSource.indexOf('function requestJourneySignIn')
  );
  const panelBody = worldsSource.slice(
    worldsSource.indexOf('function makePublishedGateJourneyPanel'),
    worldsSource.indexOf('function appendPublishedHeader')
  );
  const pickerBody = worldsSource.slice(
    worldsSource.indexOf('async function openPublishedGateQuizPicker'),
    worldsSource.indexOf('window.openPublishedGatePractice')
  );

  assert.doesNotMatch(refreshBody, /if \(isPublishedGateWordsLoading\(\)\) return false;/);
  assert.doesNotMatch(watcherBody, /if \(isPublishedGateWordsLoading\(\)\) return;/);
  assert.match(refreshBody, /if \(!options\.suppressRender\) rerenderPublishedRoute\(\);/);
  assert.match(watcherBody, /refreshPublishedGateMasteryView\(/);
  assert.match(panelBody, /const gateLoadPending = isPublishedGateWordsLoading\(\)/);
  assert.match(panelBody, /if \(gateLoadPending\) \{[\s\S]*?loading\.disabled = true;/);
  assert.ok(
    panelBody.indexOf('if (gateLoadPending)') < panelBody.indexOf("} else if (state === 'learning')"),
    'the loading state must take precedence over the learning CTA'
  );
  assert.match(pickerBody, /if \(isPublishedGateWordsLoading\(\)\)/);
});

test('the public-world journey stays separate from feature eligibility', () => {
  assert.match(htmlSource, /guided-first-journey-contract\.js/);
  assert.match(htmlSource, /guided-first-journey-controller\.js/);
  assert.match(htmlSource, /guided-first-journey-cloud\.js/);
  assert.match(controllerSource, /beginFromEntry/);
  assert.doesNotMatch(controllerSource, /minecraft|pubg/);
  assert.match(controllerSource, /must not become a global feature lock/);
  assert.match(controllerSource, /enableGuestDictionary/);
  assert.doesNotMatch(controllerSource, /يمكنك الآن استكشاف الموقع كاملاً كضيف/);
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


test('a completed guest boot does not block loading a newly signed-in account', async () => {
  const {root,controller}=createControllerHarness();root.auth.currentUser=null;await controller.boot();
  let loads=0;root.LootLinguaGuidedFirstJourneyCloud={load:async()=>{loads++;return guided.create('world-b',100)}};
  root.auth.currentUser={uid:'B'};root.dispatchEvent({type:'lootlingua:auth-state'});await controller.boot();
  assert.equal(loads,1);assert.equal(controller.getState().worldId,'world-b');
});

test('a late guided-journey read from A cannot overwrite B', async () => {
  const {root,controller}=createControllerHarness();let release;
  const pending=new Promise(resolve=>{release=resolve});
  root.LootLinguaGuidedFirstJourneyCloud={load:async user=>user.uid==='guided-user'?pending:guided.create('world-b',200)};
  const old=controller.boot();root.auth.currentUser={uid:'B'};root.dispatchEvent({type:'lootlingua:auth-state'});
  await controller.boot();release(guided.create('world-a',100));await old;
  assert.equal(controller.getState().worldId,'world-b');
});
