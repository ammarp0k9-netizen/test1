import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  DISCOVERY_TOPICS, GUIDE_TOUR, GUIDE_TOPICS, GUIDE_SIGNALS, guideStorageKey,
  readGuideCoverage, mergeGuideCoverage, selectDiscoveryTopic, isGuideCovered,
} from '../js/guide-coverage.mjs';

const [smart, dictionary, discoveryContract, discovery, mini] = await Promise.all([
  'smart-onboarding', 'personal-dictionary-onboarding', 'feature-discovery-contract',
  'feature-discovery-controller', 'feature-mini-onboarding',
].map(file => readFile(new URL('../js/' + file + '.js', import.meta.url), 'utf8')));
const legacyKey = 'lootlingua:personal-dictionary-onboarding:v1:';
const contextualKey = 'lootlingua:contextual-onboarding:v1:';
const coach = 'contextualOnboardingCoach';
const fullTour = 'personalDictionaryOnboardingCoach';
const miniCoach = 'featureMiniOnboardingCoach';

function setup(values = new Map(), uid = null) {
  const events = new Map();
  const clicks = new Map();
  const surfaces = new Map();
  const tasks = new Map();
  const observers = [];
  const resumes = new Map();
  let nextTimer = 0;
  let view = 'personal';
  let active = null;
  let busy = false;
  let locked = '';
  let draft = { status: '', expanded: false, meaning: '' };
  let mount;
  let opens = 0;
  function listen(map, name, fn) { map.set(name, [...map.get(name) || [], fn]); }
  function emit(name, detail) { for (const fn of events.get('lootlingua:' + name) || []) fn({ detail }); }
  function flush() {
    for (let runs = 0; tasks.size; runs++) {
      assert.ok(runs < 100, 'guide dispatch must settle');
      const [id, fn] = tasks.entries().next().value;
      tasks.delete(id); fn();
    }
  }
  function element(selector, { textContent = '', isVisible = true } = {}) {
    const node = {
      isConnected: true, isVisible, textContent, children: [], dataset: {},
      classList: { contains: className => node.isVisible && ['open', 'active'].includes(className), toggle() {} },
      getBoundingClientRect: () => ({ top: 100, left: 10, right: 200, bottom: 150 }),
      getClientRects: () => node.isVisible ? [{}] : [],
      getAttribute: () => String(!node.isVisible),
      closest: value => selector === value ? node : null,
      append(...items) { this.children.push(...items); },
      addEventListener(_name, fn) { this.click = fn; },
    };
    if (selector) surfaces.set(selector, node);
    return node;
  }
  const doc = {
    documentElement: { classList: { contains: () => false } }, body: { matches: () => false },
    getElementById: id => surfaces.get('#' + id),
    querySelector: selector => surfaces.get(selector) || null,
    querySelectorAll: selector => busy && selector.includes('#toastMessage.show') ? [surfaces.get('#busy')] : [],
    createElement: () => element(),
    addEventListener(name, fn) { listen(clicks, name, fn); },
  };
  const root = {
    auth: { currentUser: uid ? { uid } : null }, innerHeight: 900, innerWidth: 1100,
    words: Array.from({ length: 5 }, (_, id) => ({ id })),
    isFeatureUnlocked: feature => feature !== locked,
    getPersonalDictionarySearchDraft: () => draft,
    getOnboardingView: () => view,
    loadPersonalDictionary() { opens++; view = 'personal'; emit('dictionary-navigation'); },
    openQuizModeSettings() { opens++; }, openCustomWorldModal() { opens++; },
    toggleProfileModal() { opens++; }, openStatsPanel() { opens++; },
    addEventListener(name, fn) { listen(events, name, fn); },
    dispatchEvent(event) { emit(event.type.slice('lootlingua:'.length), event.detail); },
    LootLinguaModalFocus: { currentSurface: () => mount },
    LootLinguaPopover: {
      getActiveId: () => active?.id || '', canAct: id => active?.id === id,
      open(options) { assert.ok(!active || active.id === options.id, 'only one guide may be active'); active = options; return options; },
      closeIf(id) { if (active?.id === id) { active = null; emit('popover-closed', { id }); } },
      offerResume(id, offer) { resumes.set(id, offer); },
    },
  };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const globals = {
    window: root, document: doc, localStorage: storage,
    setTimeout(fn) { tasks.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { tasks.delete(id); }, setInterval() {}, getComputedStyle: () => ({ visibility: 'visible' }),
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, queueMicrotask,
  };
  for (const source of [dictionary, discoveryContract, discovery, mini, smart]) new Function(...Object.keys(globals), source)(...Object.values(globals));
  element('#busy'); element('#searchBtn'); element('#suggestionsList'); element('#addBtn');
  element('#wordInput'); element('#normalSearchZone'); element('#addFormToggle');
  element('#profileModal'); element('#profileModalTitle'); element('#xpValue'); element('#levelSection');
  element('#quizViewSetup'); element('#quizAvailableCount'); element('#customWorldsTab');
  element('#dailyLootChest'); element('#starredSearchBar');
  return {
    root, values, element, emit, flush, resumes,
    get opens() { return opens; }, get active() { return active?.id; },
    get title() { return active?.content.children[0].textContent; },
    get copy() { return active?.content.children[1].textContent; },
    setBusy(value) { busy = value; observers.forEach(fn => fn()); },
    setLocked(value) { locked = value; },
    setModal(value) { mount = value; },
    setDraft(value) { draft = value; },
    setView(value) { emit('dictionary-navigation'); view = value; emit('surface-ready', { kind: 'view' }); },
    signIn(next) { root.auth.currentUser = next ? { uid: next } : null; emit('auth-state'); },
    input(name, target) { for (const fn of clicks.get(name) || []) fn({ target }); },
    choose(label) { active.content.children.at(-1).children.find(node => node.textContent === label).click(); },
    setHelp(value) { active = value ? { id: 'user-help' } : null; if (!value) emit('popover-closed', { id: 'user-help' }); },
  };
}
const old = (step, phase = 'intro') => JSON.stringify({ version: 1, phase, step });

test('the dictionary invitation needs an owner-matched receipt, and a visit alone does not consume it', async () => {
  const h = setup(new Map(), 'alex');
  const topics = new Set();
  h.root.LootLinguaGuide = {
    covered: topic => topics.has(topic),
    acknowledge: (topic, state = 'seen') => { if (isGuideCovered(state)) topics.add(topic); },
    isPresenting: () => false,
    status: topic => topics.has(topic) ? 'seen' : '',
    discoveryTopic: eligible => selectDiscoveryTopic(topic => topics.has(topic) ? 'seen' : '', eligible),
  };
  const state = { wordIds: ['word'] };
  h.root.LootLinguaGateLesson = { complete: candidate => candidate === state };
  h.root.LootLinguaJourneyCloud = { getGateLessonAccess: async () => ({ confirmed: true, state }) };
  const officialReviewGate = { worldId: 'world', rankId: 'rank', gateId: 'gate' };
  h.emit('surface-ready', { kind: 'view' });
  assert.equal(topics.has('dictionary-visited'), false);
  for (const detail of [
    { ownerId: 'alex' },
    { ownerId: 'alex', officialReviewGate, officialReviewCommitted: false },
    { ownerId: 'someone-else', officialReviewGate, officialReviewCommitted: true },
  ]) {
    h.emit('trusted-quiz-completed', detail);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.root.LootLinguaSmartOnboarding.dictionaryInvitationPending(), false);
  }
  const receipt = { ownerId: 'alex', officialReviewGate, officialReviewCommitted: true };
  h.emit('trusted-quiz-completed', receipt);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.root.LootLinguaSmartOnboarding.dictionaryInvitationPending(), true);
  topics.delete('first-official-review');
  h.input('click', { closest: selector => selector.includes('[data-view="personal"]') });
  assert.equal(topics.has('dictionary-visited'), true);
  assert.equal(topics.has('dictionary'), false);
  h.emit('trusted-quiz-completed', receipt);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.root.LootLinguaSmartOnboarding.dictionaryInvitationPending(), true);
  topics.add('dictionary');
  assert.equal(h.root.LootLinguaSmartOnboarding.dictionaryInvitationPending(), false);
});

test('one persistent invitation follows feature priority and natural coverage without replaying later', () => {
  const record = { 'dictionary-visited': 'seen' };
  const pending = (...unlocked) => selectDiscoveryTopic(topic => record[topic], topic => unlocked.includes(topic));
  assert.equal(pending('quiz', 'treasure'), '');
  record['first-official-review'] = 'seen';
  assert.equal(pending('quiz', 'treasure'), 'dictionary');
  record['dictionary-invitation'] = 'seen';
  assert.equal(pending('quiz', 'treasure'), 'dictionary');
  record['dictionary-invitation'] = 'dismissed';
  assert.equal(pending('quiz', 'treasure'), 'quiz');
  record.quiz = 'seen';
  assert.equal(pending('quiz', 'treasure', 'starred'), 'treasure');
  record.treasure = 'dismissed';
  assert.equal(pending('quiz', 'treasure', 'starred', 'custom-worlds'), 'starred');
  assert.equal(mergeGuideCoverage(
    { version: 1, topics: { 'quiz-invitation': 'seen' } },
    { version: 1, topics: { 'quiz-invitation': 'dismissed' } }
  ).topics['quiz-invitation'], 'dismissed');
});

test('early natural discovery does not unlock any invitation until the official review is saved', () => {
  const topics = { dictionary: 'seen', 'dictionary-visited': 'seen', 'lesson-started': 'seen' };
  const candidate = () => selectDiscoveryTopic(topic => topics[topic], () => true);
  assert.equal(candidate(), '');
  topics['first-official-review'] = 'dismissed';
  assert.equal(candidate(), '');
  topics['first-official-review'] = 'seen';
  assert.equal(candidate(), 'quiz');
  topics.quiz = 'visited';
  assert.equal(candidate(), 'quiz');
  topics.quiz = 'in-progress';
  assert.equal(candidate(), 'quiz');
  topics.quiz = 'dismissed';
  assert.equal(candidate(), 'treasure');
});

test('later preserves coverage and lets another eligible topic take its turn', () => {
  const before = { version: 1, topics: { 'first-official-review': 'seen' } };
  const deferred = mergeGuideCoverage(before, { version: 1, deferredUntil: { dictionary: 200 } });
  const candidate = now => selectDiscoveryTopic(topic => deferred.topics[topic], () => true,
    topic => now < deferred.deferredUntil[topic]);
  assert.equal(candidate(199), 'quiz');
  assert.equal(candidate(201), 'dictionary');
  assert.deepEqual(mergeGuideCoverage(deferred, { version: 1, topics: { dictionary: 'seen' } }), {
    version: 1, topics: { 'first-official-review': 'seen', dictionary: 'seen' },
  });
});

test('visiting or covering any discovery surfaces cannot open invitations before a saved review', () => {
  for (const visited of ['dictionary', 'quiz', 'treasure']) {
    for (const state of ['visited', 'in-progress', 'seen', 'dismissed']) {
      const topics = { [visited]: state };
      const candidate = () => selectDiscoveryTopic(topic => topics[topic], () => true);
      assert.equal(candidate(), '', visited + ' ' + state);
      topics['lesson-started'] = 'seen';
      assert.equal(candidate(), '', 'starting or finishing the lesson is insufficient');
      topics['first-official-review'] = 'seen';
      assert.equal(candidate(), visited === 'dictionary' && isGuideCovered(state) ? 'quiz' : 'dictionary');
    }
  }
});

test('profile help runs outside the legacy order, and the full tour resumes at its old checkpoint', () => {
  const key = legacyKey + 'user:alex';
  const h = setup(new Map([[key, old(2)]]), 'alex');
  h.emit('surface-ready', { kind: 'view' });
  h.emit('profile-opened'); h.flush();
  assert.equal(h.active, coach);
  assert.match(h.title, /ملفك/);
  h.choose('فهمت');
  assert.equal(h.values.get(contextualKey + 'profile:user:alex'), 'completed');
  assert.equal(h.values.get(key), old(2));
  h.emit('profile-opened'); h.flush(); assert.equal(h.active, undefined);
  h.resumes.get(fullTour).open(); h.flush();
  assert.equal(h.active, fullTour);
  assert.match(h.title, /المعنى/);
  assert.equal(h.opens, 0);
});

test('a new dictionary learner sees search, meaning and save according to the existing draft and does not repeat a skipped explanation', () => {
  const h = setup();
  h.emit('surface-ready', { kind: 'view' }); h.flush();
  assert.match(h.title, /البحث/);
  h.choose('تخطي');
  const scope = 'guest:personal';
  h.setDraft({ status: 'success', expanded: false });
  h.emit('dictionary-search-result', { status: 'success', type: 'normal', scope }); h.flush();
  assert.match(h.title, /المعنى/);
  h.setDraft({ status: 'success', expanded: true, meaning: 'معنى' });
  h.emit('dictionary-meaning-selected', { scope }); h.flush();
  assert.match(h.title, /احفظ/);
  h.setBusy(true); assert.equal(h.active, undefined);
  h.emit('dictionary-word-saved', { owner: 'guest', scope: 'personal' }); h.flush();
  assert.equal(h.active, undefined);
  h.setBusy(false); h.flush(); assert.match(h.title, /خطوتك/);
  assert.equal(h.values.get(contextualKey + 'search:guest'), 'skipped');
  assert.equal(h.values.get(contextualKey + 'save:guest'), 'completed');
});

test('terminal contextual state survives reload, account switching and a return to guest', () => {
  const h = setup();
  h.emit('profile-opened'); h.flush(); h.choose('تخطي');
  const reloaded = setup(h.values);
  reloaded.emit('profile-opened'); reloaded.flush(); assert.equal(reloaded.active, undefined);
  reloaded.signIn('a'); reloaded.emit('profile-opened'); reloaded.flush(); reloaded.choose('فهمت');
  reloaded.signIn('b'); reloaded.emit('profile-opened'); reloaded.flush(); assert.equal(reloaded.active, coach);
  reloaded.signIn('a'); reloaded.emit('profile-opened'); reloaded.flush(); assert.equal(reloaded.active, undefined);
  reloaded.signIn(null); reloaded.emit('profile-opened'); reloaded.flush(); assert.equal(reloaded.active, undefined);
  assert.equal(h.values.get(contextualKey + 'profile:guest'), 'skipped');
  assert.equal(h.values.get(contextualKey + 'profile:user:a'), 'completed');
});

test('a legacy-completed account does not repeat contextual explanations it already covered', () => {
  const h = setup(new Map([[legacyKey + 'user:a', old(16, 'completed')]]), 'a');
  h.emit('surface-ready', { kind: 'view' }); h.emit('profile-opened'); h.flush();
  assert.equal(h.active, undefined);
  assert.equal(h.values.size, 1);
});

test('a due or waiting gate gives way to requested help and a busy surface', () => {
  const h = setup(); h.setView('worlds');
  const due = h.element('[data-onboarding-gate-review="due"]'); due.dataset.onboardingGateReview = 'due';
  h.element('[data-onboarding-gate-review]').dataset.onboardingGateReview = 'due';
  h.setHelp(true); h.emit('gate-guide-state'); h.flush(); assert.equal(h.active, 'user-help');
  h.setBusy(true); h.setHelp(false); h.flush(); assert.equal(h.active, undefined);
  h.setBusy(false); h.flush(); assert.match(h.title, /حان وقت المراجعة/); h.choose('فهمت');
  h.element('[data-onboarding-gate-review]').dataset.onboardingGateReview = 'waiting';
  h.element('[data-onboarding-gate-review="waiting"]');
  h.emit('gate-guide-state'); h.flush(); assert.match(h.title, /التالية/);
  assert.equal(h.opens, 0);
});

test('a trusted saved general result precedes discovery; official, incorrect and other-owner results do not', () => {
  const h = setup(); h.setView('quiz'); h.emit('quiz-modes-opened', { origin: 'general' });
  const result = { ownerId: 'guest', correctCount: 2, total: 3, source: 'personal', promotedCount: 1 };
  h.emit('trusted-quiz-completed', { ...result, officialReviewGate: { gateId: 'g' } });
  h.emit('trusted-quiz-completed', { ...result, correctCount: 0 });
  h.emit('trusted-quiz-completed', { ...result, ownerId: 'previous' });
  h.flush(); assert.equal(h.active, miniCoach);
  h.choose('تخطي الجولة');
  h.setBusy(true); h.emit('trusted-quiz-completed', result);
  h.emit('quiz-modes-opened'); h.flush(); assert.equal(h.active, undefined);
  h.setBusy(false); h.emit('toast-idle'); h.flush(); assert.match(h.copy, /حققت شروط/);
  h.choose('فهمت');
  h.emit('quiz-modes-opened'); h.flush(); assert.equal(h.active, undefined);
});

test('personal review guidance appears only when the existing practice lock is visible', () => {
  const h = setup(); h.setView('quiz');
  const lock = h.element('#quizPracticeLock', { isVisible: false });
  h.emit('quiz-modes-opened', { origin: 'general' }); h.flush(); assert.equal(h.active, miniCoach);
  h.choose('تخطي الجولة'); lock.isVisible = true;
  h.emit('quiz-modes-opened'); h.flush(); assert.match(h.title, /قاموسك/);
  h.choose('تخطي'); h.emit('quiz-modes-opened'); h.flush(); assert.equal(h.active, undefined);
});

test('profile and toolbar guidance respects its actual open surface and only explains available content', () => {
  const h = setup();
  h.element('#xpValue', { textContent: '12 XP' });
  const profile = h.element('#profileModal');
  h.setModal({ contains: anchor => anchor === profile || anchor === h.root.__testTarget });
  h.root.__testTarget = h.element('#levelSection');
  h.emit('profile-opened'); h.flush(); assert.match(h.title, /XP/); h.choose('فهمت');
  const settings = h.element('.profile-settings-section');
  h.root.__testTarget = settings;
  h.input('click', settings); h.flush(); assert.match(h.title, /إعدادات/); h.choose('تخطي');
  const account = h.element('.profile-account-section');
  h.root.__testTarget = account;
  h.input('click', account); h.flush(); assert.match(h.title, /حسابك/); h.choose('فهمت');
  h.setModal(null);
  const quests = h.element('#dailyQuestsBtn');
  h.element('#dailyQuestsSheet'); h.element('#dailyQuestsResetHint');
  h.input('click', quests); h.flush(); assert.equal(h.active, undefined);
  h.element('#dailyQuestsList li'); h.input('click', quests); h.flush(); assert.match(h.title, /مهام/);
});

test('mini tours start on the appropriate unlocked surface, keep checkpoints and wait for real form/settings actions', () => {
  const h = setup(new Map([[legacyKey + 'guest', old(2)]]));
  h.setLocked('starred'); h.setView('starred'); h.flush(); assert.equal(h.active, undefined);
  h.setLocked(''); h.setView('starred'); h.flush(); assert.equal(h.active, miniCoach);
  h.choose('تخطي الجولة'); h.setView('starred'); h.flush(); assert.equal(h.active, undefined);
  h.setBusy(true); h.setView('treasure'); h.flush(); assert.equal(h.active, undefined);
  h.setBusy(false); h.flush(); assert.equal(h.active, miniCoach);
  h.setView('quiz'); h.emit('quiz-modes-opened', { origin: 'journey' }); h.flush(); assert.equal(h.active, undefined);
  h.emit('quiz-modes-opened', { origin: 'general' }); h.flush(); assert.equal(h.active, miniCoach);
  h.element('#quizSharedSettings .quiz-source-selector');
  h.emit('quiz-settings-opened'); h.flush(); assert.match(h.title, /مصدر/);
  h.setView('worlds'); h.flush(); assert.match(h.title, /عوالمك/);
  h.element('#customWorldNameInput'); h.emit('custom-world-form-opened'); h.flush(); assert.match(h.title, /مجموعة/);
  assert.equal(h.opens, 0);
  assert.equal(h.root.LootLinguaFeatureDiscovery.getState().features['custom-worlds'].step, 3);
});

test('the shared guide migrates completed and explicitly dismissed topics only for their owner', async () => {
  const guideModule = (await readFile(new URL('../js/lootlingua-guide.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const values = new Map([
    ['lootlingua:contextual-onboarding:v1:gate-wait:user:A', 'completed'],
    ['lootlingua:contextual-onboarding:v1:search:user:A', 'skipped'],
    ['lootlingua:contextual-onboarding:v1:meaning:user:A', 'shown'],
  ]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const listeners = new Map();
  const events = [];
  const root = { auth: { currentUser: { uid: 'A' } }, addEventListener: (name, cb) => listeners.set(name, cb),
    dispatchEvent: event => events.push(event.type) };
  vm.runInNewContext(guideModule, { window: root, document: { getElementById: () => null },
    localStorage: storage, CustomEvent: class { constructor(type) { this.type = type; } },
    DISCOVERY_TOPICS, GUIDE_TOUR, GUIDE_TOPICS, GUIDE_SIGNALS, guideStorageKey, readGuideCoverage, mergeGuideCoverage,
    selectDiscoveryTopic, isGuideCovered });
  assert.deepEqual(JSON.parse(storage.getItem(guideStorageKey('A'))).topics, { 'gate-wait': 'seen', search: 'dismissed' });
  assert.equal(root.LootLinguaGuide.covered('meaning'), false);
  root.LootLinguaGuide.acknowledge('search', 'seen');
  assert.equal(JSON.parse(storage.getItem(guideStorageKey('A'))).topics.search, 'seen');
  root.auth.currentUser = { uid: 'B' };
  listeners.get('lootlingua:auth-state')();
  assert.equal(root.LootLinguaGuide.covered('gate-wait'), false);
  assert.equal(storage.getItem(guideStorageKey('B')), undefined);
  root.auth.currentUser = null;
  listeners.get('lootlingua:auth-state')();
  root.LootLinguaGuide.acknowledge('lesson');
  root.auth.currentUser = { uid: 'ANON', isAnonymous: true };
  listeners.get('lootlingua:auth-state')();
  assert.equal(JSON.parse(storage.getItem(guideStorageKey('ANON'))).topics.lesson, 'seen');
  assert.equal(storage.getItem(guideStorageKey()), undefined);
  assert.ok(events.includes('lootlingua:guide-coverage-changed'));
  root.LootLinguaGuide.acknowledge('first-official-review');
  assert.equal(root.LootLinguaGuide.covered('first-official-review'), true);
  values.set(guideStorageKey('ANON'), JSON.stringify({ version: 1, topics: { 'dictionary-invitation': 'dismissed' } }));
  listeners.get('storage')({ key: guideStorageKey('ANON') });
  assert.equal(root.LootLinguaGuide.covered('first-official-review'), true);
  assert.equal(root.LootLinguaGuide.status('dictionary-invitation'), 'dismissed');
  assert.equal(JSON.parse(storage.getItem(guideStorageKey('ANON'))).topics.lesson, 'seen');
  assert.equal(root.LootLinguaGuide.covered('dictionary'), false);
  root.auth.currentUser = { uid: 'B' };
  listeners.get('lootlingua:auth-state')();
  listeners.get('storage')({ key: guideStorageKey('ANON') });
  assert.equal(root.LootLinguaGuide.covered('first-official-review'), false);
  assert.equal(root.LootLinguaGuide.status('dictionary-invitation'), '');
});
