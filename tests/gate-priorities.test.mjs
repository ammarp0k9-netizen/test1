import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = file => readFileSync(new URL('../js/' + file + '.js', import.meta.url), 'utf8');
const worlds = source('worlds');
const slice = (start, end) => worlds.slice(worlds.indexOf(start), worlds.indexOf(end, worlds.indexOf(start)));
const renderer = [
  slice('function publishedElement(', 'function setPublishedTabState('),
  slice('function publishedGateMissionBrief(', '// Smart Journey notifications'),
  slice('async function beginPublishedGateClear(', 'function renderPublishedGateClearAssessment('),
  slice('async function submitPublishedGateClearAnswer(', 'function renderPublishedGateClearResult('),
  slice('function publishedTimestampMillis(', 'function appendPublishedHeader('),
].join('\n');

const hour = 3600000;
const now = Date.parse('2026-11-15T15:30:00Z');
const world = { worldId: 'world' };
const rank = { rankId: 'rank' };
const gate = { gateId: 'gate', title: 'بوابة الكلمات', wordCount: 16 };
const active = { worldId: 'world', activeRankId: 'rank', activeGateId: 'gate' };
const study = { status: 'learning', requiredWordCount: 3, readyWordCount: 0, totalEvidenceSteps: 9 };
const normalized = value => JSON.parse(JSON.stringify(value));

function element(tag) {
  return {
    tag, children: [], dataset: {}, handlers: {}, attrs: {}, isConnected: true,
    classList: { add() {} },
    get textContent() { return this.children.map(child => child.textContent ?? child).join(''); },
    set textContent(value) { this.children = [String(value)]; },
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key] ?? null; },
    removeAttribute(key) { delete this.attrs[key]; },
    addEventListener(type, handler) { this.handlers[type] = handler; },
    querySelector(selector) {
      const pattern = selector.slice(1);
      for (const child of this.children) {
        if (child.className?.split(' ').includes(pattern)) return child;
        const nested = child.querySelector?.(selector);
        if (nested) return nested;
      }
      return null;
    },
    set innerHTML(value) {
      this.html = value;
      if (this.id === 'publishedGateQuizPicker') {
        const modes = element('div'); modes.className = 'published-gate-quiz-modes'; this.append(modes);
      }
    },
    remove() { this.isConnected = false; },
  };
}

function harness(options = {}) {
  let clock = now;
  let id = 0;
  let panel;
  const timers = new Map();
  const calls = [];
  const events = [];
  const state = {
    journey: active, activeJourney: active, newGateWords: [], tab: 'published', gateProgress: null,
    ...options,
  };
  let quizWordReads = 0;
  const api = {
    getGateLessonAccess: async () => ({ allowed: options.lessonComplete !== false }),
    getGateQuizWords: async () => {
      quizWordReads++;
      if (options.quizWordError) throw new Error('تعذر تحميل كلمات الاختبار');
      return options.quizWords || [{ wordKey: 'waiting', eligibleEvidenceCount: 1, lastEligibleEvidenceAt: clock - hour }];
    },
    startGateClearAttempt: async () => { calls.push('start-clear'); return options.clearBundle; },
    resumeGateClearAttempt: async () => { calls.push('resume-clear'); return options.clearBundle; },
    answerGateClearQuestion: async () => { calls.push('save-answer'); throw Error('تعذّر حفظ الإجابة'); },
  };
  function game(name, input) {
    const card = element('aside');
    card.className = name;
    const button = element('button');
    button.className = 'gate-runner-launch';
    button.disabled = input.practiceLocked();
    button.handlers.click = () => input.isCurrent() && !input.practiceLocked() && calls.push([name, input.gateId]);
    card.append(button);
    return card;
  }
  const window = {
    LootLinguaTestClock: { effectiveNow: () => clock },
    LootLinguaNotificationRuntime: { requestEvaluation: type => events.push(type) },
    LootLinguaModalFocus: { open() {}, close() {} },
    LootLinguaBots: { renderGate: input => game('bots', input) },
    LootLinguaWordLifecycle: { wordKeyOf: word => word.wordKey },
    startGateQuiz: (mode, input) => { calls.push([mode, input]); return true; },
    startGateGapReview: (keys, ids) => calls.push(['mastery', keys, ids]),
    openPublishedWorldsRoot: () => calls.push('worlds'),
    openPublishedRank: () => calls.push('rank'),
    addEventListener() {}, dispatchEvent: event => events.push(event.type),
  };
  const document = {
    createElement: element, createTextNode: String, body: element('body'),
    getElementById: id => document.body.children.find(node => node.id === id && node.isConnected),
  };
  const sandbox = vm.createContext({
    window, document, Date, console, AbortController, localStorage: { getItem: () => null }, getJourneyCloudApi: () => api,
    currentView: 'worlds', publishedContentState: state, isPublishedGateRoute: () => true, isCurrentPublishedGate: () => true,
    publishedGateJourneyState: () => options.presentation || state.gateProgress?.status || 'available',
    publishedJourneyPresentation: () => ({ icon: '' }), animatePublishedGateProgress() {},
    appendMetaChip: (parent, label) => parent.append(label),
    queueMicrotask: fn => fn(), CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout(fn, delay) { timers.set(++id, { fn, at: clock + delay }); return id; },
    clearTimeout: handle => timers.delete(handle), requestAnimationFrame: fn => fn(), escapeHtml: value => value,
    isPublishedGateWordsLoading: () => Boolean(state.journeyAction?.pending && ['load', 'sync'].includes(state.journeyAction.type)),
    currentPublishedJourneyError: () => state.journeyError,
    startOrResumePublishedJourney: () => calls.push('start-journey'),
    beginPublishedJourneyFromStart: () => calls.push('choose-start'),
    runPublishedGateLoad: sync => calls.push(['load', sync]),
    retryPublishedJourneyError: () => state.journeyError.retry(),
    openPublishedJourneyDestination: worldId => calls.push(['next', worldId]),
    showToast: message => calls.push(['toast', message]), publishedJourneyErrorText: error => error.message,
    renderPublishedGateClearAssessment: (_w, _r, _g, bundle) => {
      if (!state.gateClearFeedback) assert.equal(state.gateClearPending, false);
      calls.push(['assessment', bundle]);
    },
    rerenderPublishedRoute: () => render(),
  });
  for (const file of ['runner-engine', 'gate-runner', 'learning-evidence']) vm.runInContext(source(file), sandbox);
  window.LootLinguaGateRunner = { ...window.LootLinguaGateRunner, render: input => game('runner', input) };
  vm.runInContext(renderer, sandbox);

  function render() {
    const previous = panel?.querySelector('.published-gate-readiness-copy');
    if (previous) previous.isConnected = false;
    panel = sandbox.makePublishedGateJourneyPanel(world, rank, gate);
    return panel;
  }
  function tick(target) {
    clock = target;
    for (const [handle, timer] of [...timers]) {
      if (timer.at > clock) continue;
      timers.delete(handle); timer.fn();
    }
  }

  return {
    render, tick, calls, events, sandbox, state, window, document,
    get panel() { return panel; },
    get buttons() { return panel.querySelector('.published-journey-actions').children; },
    openPicker: args => sandbox.openPublishedGateQuizPicker(world, rank, gate, args),
    get picker() { return document.getElementById('publishedGateQuizPicker'); },
    get quizWordReads() { return quizWordReads; },
    answer: (bundle, choice) => sandbox.submitPublishedGateClearAnswer(world, rank, gate, bundle, choice),
  };
}

const reviewCopy = panel => panel.querySelector('.published-gate-readiness-copy');
const buttonLabels = h => h.buttons.map(button => button.textContent);
const reviewFacts = panel => panel.querySelector('.published-gate-review-facts')?.children.map(row => row.children.map(item => item.textContent));
const reviewTime = panel => reviewCopy(panel).querySelector('.published-gate-review-time')?.children[1];
const pickerItems = picker => picker.querySelector('.published-gate-quiz-modes').children;
const pickerModes = picker => pickerItems(picker).filter(node => node.tag === 'button');
const gameLaunch = (h, name) => h.picker.querySelector('.' + name)?.querySelector('.gate-runner-launch');

test('a new gate prioritizes start, start choice, or adding words based on the existing journey', () => {
  const fresh = harness({ journey: null, activeJourney: null }); fresh.render();
  assert.deepEqual(buttonLabels(fresh), ['ابدأ رحلة التعلم']);
  fresh.buttons[0].handlers.click(); assert.deepEqual(fresh.calls, ['start-journey']);
  fresh.state.journeyAction = { type: 'choose-start' }; fresh.render();
  assert.deepEqual(buttonLabels(fresh), ['ابدأ من البداية']);
  fresh.buttons[0].handlers.click(); assert.equal(fresh.calls.at(-1), 'choose-start');
  const joined = harness(); joined.render();
  assert.deepEqual(buttonLabels(joined), ['أضف كلمات البوابة']);
  joined.buttons[0].handlers.click(); assert.deepEqual(joined.calls, [['load', false]]);
});

test('an incomplete lesson blocks even a direct call to the gate picker', async () => {
  const h = harness({ lessonComplete: false, gateProgress: { ...study, availableForReviewNowCount: 3 } });
  assert.equal(await h.openPicker(), false);
  assert.equal(h.picker, undefined);
  assert.equal(h.quizWordReads, 0);
});

test('a due review uses the saved count and the games and cards are locked inside its picker', async () => {
  const progress = { ...study, availableForReviewNowCount: 2 };
  const h = harness({ gateProgress: progress }); h.render();
  assert.equal(h.buttons[0].textContent, 'ابدأ المراجعة الرسمية');
  assert.deepEqual(reviewFacts(h.panel), [['كلمات مستحقة الآن', '2']]);
  assert.equal(h.buttons[0].dataset.onboardingGateReview, 'due');
  assert.equal(reviewCopy(h.panel).dataset.onboardingGateReview, undefined);
  for (const name of ['runner', 'bots']) assert.equal(h.panel.querySelector('.' + name), null);
  await h.openPicker();
  for (const name of ['runner', 'bots']) assert.equal(gameLaunch(h, name).disabled, true);
  const cards = pickerModes(h.picker).find(button => button.className.includes('is-flashcards'));
  assert.equal(cards.disabled, true);
  cards.handlers.click();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.state.gateProgress, progress);
});

test('waiting locks training in the open picker exactly when the saved deadline arrives', async () => {
  const nextAt = now + 2 * hour;
  const h = harness({ gateProgress: { ...study, waitingLaterTodayCount: 2, readinessNextAt: { seconds: nextAt / 1000 } } });
  h.render(); assert.deepEqual(buttonLabels(h), ['تدرّب على كلمات البوابة']);
  const copy = reviewCopy(h.panel);
  assert.equal(reviewTime(h.panel).tag, 'time');
  assert.equal(reviewTime(h.panel).dateTime, new Date(nextAt).toISOString());
  assert.equal(copy.dataset.onboardingGateReview, undefined);
  assert.equal(h.buttons[0].dataset.onboardingGateReview, undefined);
  await h.openPicker();
  const cards = pickerModes(h.picker)[0];
  assert.equal(cards.disabled, false);
  assert.equal(gameLaunch(h, 'runner').disabled, false);
  assert.equal(gameLaunch(h, 'bots').disabled, false);
  h.tick(nextAt - 1); assert.strictEqual(reviewCopy(h.panel), copy);
  h.tick(nextAt); assert.deepEqual(buttonLabels(h), ['ابدأ المراجعة الرسمية']);
  assert.equal(h.buttons[0].dataset.onboardingGateReview, 'due');
  assert.equal(reviewFacts(h.panel), undefined);
  assert.equal(reviewTime(h.panel), undefined);
  assert.equal(cards.disabled, true);
  assert.equal(gameLaunch(h, 'runner').disabled, true);
  assert.equal(gameLaunch(h, 'bots').disabled, true);
  assert.equal(h.quizWordReads, 1);
  assert.equal(h.events.filter(event => event === 'gate-review-due').length, 1);
  assert.deepEqual(h.calls, []);
});

test('different word clocks do not overwrite a due review or unlock games before the original rules allow it', async () => {
  const words = [
    { wordKey: 'first' },
    { wordKey: 'hour', eligibleEvidenceCount: 1, lastEligibleEvidenceAt: now - hour, evidenceTimezoneOffsetMinutes: -180 },
    { wordKey: 'tomorrow', eligibleEvidenceCount: 2, lastEligibleEvidenceAt: now - hour, evidenceTimezoneOffsetMinutes: -180 },
  ];
  const h = harness({ quizWords: words });
  const projection = h.window.LootLinguaLearningEvidence.computeGateReadiness(words, study, undefined, now, -180);
  assert.equal(projection.availableForReviewNow, 1);
  assert.equal(projection.waitingLaterToday, 1);
  assert.equal(projection.waitingNextDay, 1);
  h.state.gateProgress = {
    ...study, availableForReviewNowCount: projection.availableForReviewNow,
    waitingLaterTodayCount: projection.waitingLaterToday, waitingNextDayCount: projection.waitingNextDay,
    readinessNextAt: projection.nextAvailabilityAt, runnerReviewDueWordKeys: ['first'],
  };
  h.render();
  h.tick(now + 60000);
  assert.deepEqual(buttonLabels(h), ['ابدأ المراجعة الرسمية']);
  assert.deepEqual(reviewFacts(h.panel), [['كلمات مستحقة الآن', '1'], ['كلمات تنتظر المراجعة', '2']]);
  assert.match(reviewCopy(h.panel).textContent, /أقرب موعد للكلمات المنتظرة/);
  assert.equal(reviewTime(h.panel).dateTime, new Date(projection.nextAvailabilityAt).toISOString());
  await h.openPicker();
  const picker = h.document.getElementById('publishedGateQuizPicker');
  assert.match(picker.html, /كلمات مستحقة الآن: 1/);
  const modes = pickerModes(picker);
  assert.equal(modes.length, 4);
  assert.deepEqual(pickerItems(picker).filter(node => node.tag === 'h3').map(node => node.textContent), ['اختبارات التقدّم', 'العب وتدرّبتدريب فقط']);
  assert.match(modes[0].className, /timeAttack/);
  assert.match(modes.at(-1).className, /flashcards/);
  modes[0].handlers.click();
  assert.deepEqual(normalized(h.calls[0][1].officialReviewDueWordKeys), ['first']);
  h.state.gateProgress = { ...h.state.gateProgress, runnerReviewCompletedDueWordKeys: ['first'] };
  h.render();
  assert.equal(h.buttons[0].textContent, 'ابدأ المراجعة الرسمية');
  await h.openPicker();
  assert.equal(gameLaunch(h, 'runner').disabled, false);
  assert.equal(gameLaunch(h, 'bots').disabled, false);
  assert.equal(pickerModes(h.picker).at(-1).disabled, true);
});

test('waiting with no stored date offers training without guessing a time and keeps all quiz cards', async () => {
  const word = { wordKey: 'future', eligibleEvidenceCount: 1, lastEligibleEvidenceAt: now - hour };
  const h = harness({ quizWords: [word], gateProgress: { ...study, waitingLaterTodayCount: 1 } }); h.render();
  assert.match(reviewCopy(h.panel).textContent, /غير متاح الآن/);
  await h.openPicker();
  const picker = h.document.getElementById('publishedGateQuizPicker');
  const modes = pickerModes(picker);
  assert.equal(modes.length, 4);
  assert.equal(pickerItems(picker)[0].textContent, 'العب وتدرّبتدريب فقط');
  assert.match(modes[0].className, /flashcards/);
  assert.doesNotMatch(picker.html, /كلمات مستحقة الآن/);
});

test('confirmed zero is displayed, missing totals are omitted, and fractions have explicit meaning and direction', () => {
  const h = harness({ gateProgress: { status: 'learning', waitingLaterTodayCount: 1, availableForReviewNowCount: null } });
  h.render();
  assert.deepEqual(reviewFacts(h.panel), [['كلمات تنتظر المراجعة الثانية', '1']]);
  assert.equal(h.panel.querySelector('.published-gate-readiness-track'), null);
  assert.equal(h.panel.querySelector('.published-gate-readiness-counts'), null);
  Object.assign(h.state.gateProgress, { ...study, availableForReviewNowCount: 0, waitingNextDayCount: 2, evidenceStepCount: 3 });
  h.render();
  assert.deepEqual(reviewFacts(h.panel), [['كلمات مستحقة الآن', '0'], ['كلمات تنتظر المراجعة', '3']]);
  const steps = h.panel.querySelector('.published-gate-readiness-track');
  assert.equal(steps.attrs['aria-valuenow'], 3);
  assert.equal(steps.attrs['aria-valuemax'], 9);
  const [stepCount, wordCount] = h.panel.querySelector('.published-gate-readiness-counts').children;
  assert.deepEqual([stepCount.children[0], stepCount.children[1].textContent, stepCount.children[1].dir], ['خطوات الجاهزية', '3 / 9', 'ltr']);
  assert.equal(wordCount.children[0], 'كلمات مكتملة الجاهزية');
  assert.match(h.panel.textContent, /الجاهزية تفتح اختبار الاجتياز. إتقان الكلمات له مراجعاته الخاصة/);
});

test('ready prioritizes starting or resuming the same Gate Clear attempt even with stale review fields', async () => {
  const clearBundle = { attempt: { attemptId: 'existing' }, question: { prompt: 'السؤال المحفوظ' } };
  const h = harness({ gateProgress: { ...study, status: 'ready', availableForReviewNowCount: 5 }, clearBundle });
  h.render(); assert.deepEqual(buttonLabels(h), ['ابدأ اختبار الاجتياز', 'خيارات التدريب']);
  await h.buttons[1].handlers.click();
  assert.equal(gameLaunch(h, 'runner').disabled, true);
  assert.equal(gameLaunch(h, 'bots').disabled, true);
  assert.equal(pickerModes(h.picker).length, 0);
  assert.equal(h.quizWordReads, 0);
  await h.buttons[0].handlers.click(); assert.equal(h.calls[0], 'start-clear');
  h.state.gateProgress.activeClearAttemptId = 'existing'; h.render();
  assert.deepEqual(buttonLabels(h), ['استأنف اختبار الاجتياز', 'خيارات التدريب']);
  assert.equal(h.calls.length, 2, 'rendering the gate does not open or fetch the saved attempt');
  await h.buttons[0].handlers.click(); assert.equal(h.calls[2], 'resume-clear');
  assert.deepEqual(h.calls[3], ['assessment', clearBundle]);
});

test('opening a gate does not resume a saved attempt or repaint an already open assessment', () => {
  const route = slice('async function loadPublishedRouteData(', 'window.openPublishedGate =');
  assert.doesNotMatch(route, /resumeGateClearAttempt|RenderPublishedGateClearResume/);
  let repaints = 0;
  const state = { route: { key: 'gate' }, world, rank, gate, gateClearBundle: { attempt: { attemptId: 'active' } } };
  const context = vm.createContext({ publishedContentState: state, renderPublishedGateWords: () => repaints++ });
  vm.runInContext(slice('function rerenderPublishedRoute(', "window.addEventListener('lootlingua:entry-state-ready'"), context);
  context.rerenderPublishedRoute(); assert.equal(repaints, 0);
  state.gateClearBundle = null;
  context.rerenderPublishedRoute(); assert.equal(repaints, 1);
});

test('an unavailable resume leaves the gate ready with an enabled retry and no success state', async () => {
  const h = harness({ gateProgress: { ...study, status: 'ready', activeClearAttemptId: 'existing' } });
  h.render();
  await h.buttons[0].handlers.click();
  assert.deepEqual(h.calls, ['resume-clear', ['toast', 'gate-clear/session-unavailable']]);
  assert.equal(h.buttons[0].textContent, 'استأنف اختبار الاجتياز');
  assert.equal(h.buttons[0].disabled, false);
  assert.equal(h.state.gateClearBundle, undefined);
});

test('a clear leads to the next gate while gap review and adding skipped words remain separate', () => {
  const h = harness({
    gateProgress: { status: 'cleared' }, activeJourney: { ...active, activeGateId: 'next' },
    gateMasteryView: { derivedState: 'cleared-with-gap', gapCount: 2, gapWordKeys: ['one', 'two'] },
  });
  h.render(); assert.deepEqual(buttonLabels(h), ['تابع إلى البوابة التالية', 'خيارات التدريب', 'راجع الكلمات المتبقية للإتقان']);
  h.buttons[0].handlers.click(); assert.deepEqual(h.calls[0], ['next', 'world']);
  h.buttons[2].handlers.click(); assert.deepEqual(normalized(h.calls[1]), ['mastery', ['one', 'two'], { worldId: 'world', rankId: 'rank', gateId: 'gate' }]);
  Object.assign(h.state.gateProgress, { clearedBy: 'level-placement', placementClearedWithoutLoad: true });
  h.render(); assert.deepEqual(buttonLabels(h), ['تابع إلى البوابة التالية', 'خيارات التدريب', 'أضف كلمات البوابة للإتقان']);
  h.buttons[2].handlers.click(); assert.deepEqual(h.calls.at(-1), ['load', false]);
  h.state.journey = { ...active, contentJourneyStatus: 'completed-current-content' };
  h.render(); assert.equal(h.buttons[0].textContent, 'استكشف العوالم');
});

test('loading Gate words blocks the official picker but permits eligible games without reading quiz words', async () => {
  const h = harness({ gateProgress: { ...study }, journeyAction: { type: 'load', pending: true, completed: 2, total: 16 } });
  h.render();
  assert.equal(h.buttons[0].disabled, true);
  assert.match(h.panel.textContent, /تم تحميل 2 من 16/);
  await h.openPicker();
  assert.equal(h.picker, undefined);
  assert.equal(h.quizWordReads, 0);
  await h.openPicker({ gamesOnly: true });
  assert.ok(gameLaunch(h, 'runner'));
  assert.equal(h.quizWordReads, 0);

  const completed = harness({ gateProgress: { ...study } });
  await completed.openPicker();
  assert.equal(completed.quizWordReads, 1);
  assert.ok(pickerModes(completed.picker).some(button => !button.disabled));
});

test('training uses only originally available games and can open without fetching quiz words', async () => {
  const cleared = harness({ gateProgress: { status: 'cleared' } });
  cleared.render();
  await cleared.buttons.find(button => button.textContent === 'خيارات التدريب').handlers.click();
  assert.equal(gameLaunch(cleared, 'runner'), undefined);
  assert.equal(gameLaunch(cleared, 'bots').disabled, false);
  assert.equal(cleared.quizWordReads, 0);
  gameLaunch(cleared, 'bots').handlers.click();
  assert.deepEqual(cleared.calls, [['bots', 'gate']]);

  const failed = harness({ gateProgress: { ...study }, quizWordError: true });
  await failed.openPicker();
  assert.match(failed.picker.html, /تعذر تحميل كلمات الاختبار/);
  assert.ok(pickerModes(failed.picker).every(button => button.disabled));
  assert.equal(gameLaunch(failed, 'runner').disabled, false);
});

test('partial word saves prioritize existing retry and a failed Clear answer keeps its original question', async () => {
  const h = harness({ journeyAction: { type: 'load', pending: true, completed: 2, total: 16 } });
  h.render(); assert.equal(h.buttons[0].disabled, true);
  assert.match(h.panel.textContent, /تم تحميل 2 من 16/);
  h.state.journeyAction.pending = false;
  h.state.journeyError = { text: 'تعذّر حفظ الكلمات المتبقية', retry: () => h.calls.push('retry-load') };
  h.render(); assert.equal(h.buttons[0].textContent, 'إعادة المحاولة');
  assert.match(h.panel.textContent, /تعذّر حفظ الكلمات المتبقية/);
  h.buttons[0].handlers.click(); assert.equal(h.calls[0], 'retry-load');
  const bundle = { attempt: { attemptId: 'existing' }, question: { correctContentWordId: 'word' } };
  await h.answer(bundle, 'word');
  assert.equal(h.state.gateClearPending, false);
  assert.equal(h.state.gateClearFeedback, null);
  assert.ok(h.calls.some(call => call[0] === 'toast' && call[1] === 'تعذّر حفظ الإجابة'));
  assert.deepEqual(h.calls.at(-1), ['assessment', bundle]);
});
