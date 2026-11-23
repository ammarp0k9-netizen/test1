import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const viewSource = readFileSync(new URL('../js/gate-lesson-view.js', import.meta.url), 'utf8');
const scriptSource = readFileSync(new URL('../js/script.js', import.meta.url), 'utf8');
const guideSource = readFileSync(new URL('../js/smart-onboarding.js', import.meta.url), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.handlers = {};
    this.hidden = false;
    this.text = '';
  }
  append(...items) { this.children.push(...items); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, action) { this.handlers[name] = action; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text + this.children.map(item => item.textContent || item).join(''); }
}

function audioHarness({ recorded = true, synthesis = false, playError } = {}) {
  const media = [];
  const utterances = [];
  const view = { soundToken: 0 };
  const root = { location: { href: 'https://lesson.example/app' } };
  if (recorded) root.Audio = class {
    constructor(url) { this.url = url; this.handlers = {}; this.paused = false; media.push(this); }
    addEventListener(name, action) { this.handlers[name] = action; }
    play() { return playError ? Promise.reject(playError) : Promise.resolve(); }
    pause() { this.paused = true; }
  };
  if (synthesis) {
    root.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    root.speechSynthesis = { speak: value => utterances.push(value), cancel() {} };
  }
  const scope = vm.createContext({ root, active: view, URL,
    document: { createElement: tag => new Element(tag) } });
  vm.runInContext(viewSource.slice(viewSource.indexOf('  function stopAudio('), viewSource.indexOf('  function close(')), scope);
  const word = { word: 'shield', pronunciation: '/ʃiːld/', audioUrl: recorded ? '/shield.mp3' : '' };
  const container = scope.audioControl(view, word);
  const control = { container, word: word.word, status: container.children.at(-1), state: 'idle',
    button: container.children.find(node => node.className === 'gate-lesson-audio') };
  if (control.button) [control.symbol, control.label] = control.button.children;
  return { root, scope, view, word, container, control, media, utterances,
    speak: () => scope.speak(view, word, control) };
}

test('unavailable audio exposes a written fallback and creates no play button or automatic playback', () => {
  const h = audioHarness({ recorded: false });
  assert.equal(h.scope.audioSource(h.word).available, false);
  assert.equal(h.control.button, undefined);
  assert.equal(h.container.dataset.audioState, 'unavailable');
  assert.match(h.control.status.textContent, /الصوت غير متاح/);
  assert.equal(h.media.length, 0);
  assert.equal(h.utterances.length, 0);
});

test('unsafe audio URLs do not create a promised player while HTTPS and same-origin recordings remain available', () => {
  const h = audioHarness();
  for (const audioUrl of ['javascript:alert(1)', 'data:audio/wav,abc', 'http://other.example/word.mp3']) {
    assert.equal(h.scope.audioSource({ audioUrl }).available, false);
  }
  for (const audioUrl of ['/word.mp3', 'https://voice.example/word.mp3']) {
    assert.equal(h.scope.audioSource({ audioUrl }).available, true);
  }
  assert.equal(h.media.length, 0);
});

test('a recorded word reports playback, supports stopping and ignores a stale playback event', () => {
  const h = audioHarness();
  h.speak();
  assert.equal(h.control.state, 'loading');
  assert.equal(h.media[0].url, 'https://lesson.example/shield.mp3');
  h.media[0].handlers.playing();
  assert.equal(h.control.state, 'playing');
  assert.equal(h.control.button.attributes['aria-pressed'], 'true');
  assert.match(h.control.button.attributes['aria-label'], /إيقاف/);
  h.speak();
  assert.equal(h.media[0].paused, true);
  assert.equal(h.control.state, 'idle');
  h.media[0].handlers.playing();
  assert.equal(h.control.state, 'idle');
});

test('browser playback refusal offers a deliberate retry and does not silently start another engine', async () => {
  const h = audioHarness({ synthesis: true, playError: Object.assign(new Error(), { name: 'NotAllowedError' }) });
  h.speak();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.control.state, 'blocked');
  assert.equal(h.control.button.hidden, false);
  assert.match(h.control.status.textContent, /أوقف المتصفح/);
  assert.equal(h.utterances.length, 0);
});

test('a failed recording falls back to browser speech once and returns to idle when the word ends', async () => {
  const h = audioHarness({ synthesis: true, playError: Object.assign(new Error(), { name: 'NotSupportedError' }) });
  h.speak();
  h.media[0].handlers.error();
  await Promise.resolve();
  assert.equal(h.utterances.length, 1);
  assert.equal(h.utterances[0].text, 'shield');
  assert.equal(h.utterances[0].lang, 'en-US');
  h.utterances[0].onstart();
  assert.equal(h.control.state, 'playing');
  h.utterances[0].onend();
  assert.equal(h.control.state, 'idle');
});

test('missing speech voices use a written fallback while temporary synthesis errors allow retry', () => {
  const h = audioHarness({ recorded: false, synthesis: true });
  h.speak();
  h.utterances[0].onerror({ error: 'network' });
  assert.equal(h.control.state, 'error');
  assert.equal(h.control.button.hidden, false);
  h.speak();
  h.utterances[1].onerror({ error: 'voice-unavailable' });
  assert.equal(h.control.state, 'unavailable');
  assert.equal(h.control.button.hidden, true);
  assert.match(h.control.status.textContent, /باللفظ المكتوب/);
});

test('lesson presentation defers ordinary toasts while preserving notification records and necessary messages', () => {
  let lessonOpen = true;
  const shown = [];
  const recorded = [];
  const window = { LootLinguaGateLessonView: { isOpen: () => lessonOpen },
    recordNotificationForToast: text => { recorded.push(text); return 'receipt-' + recorded.length; } };
  const scope = vm.createContext({ window, findInFlightToast: () => null,
    displayNextToast: () => shown.push(window.__toastQueue.at(-1)) });
  vm.runInContext(scriptSource.slice(scriptSource.indexOf('function showToast('),
    scriptSource.indexOf('window.flushDeferredEntryToasts')), scope);
  assert.equal(scope.showToast('Performance notice'), 'receipt-1');
  assert.equal(shown.length, 0);
  assert.equal(window.__entryDeferredToastQueue.length, 1);
  scope.showToast('Gate review reminder', 'warning', 2500, { notificationId: 'review-ready', persist: false });
  assert.equal(shown.length, 0);
  assert.equal(window.__entryDeferredToastQueue.length, 2);
  assert.equal(window.__entryDeferredToastQueue[1].fromNotificationCenter, true);
  scope.showToast('Saving failed', 'danger');
  scope.showToast('Network warning', 'warning');
  scope.showToast('Important account notice', 'info', 2500, { critical: true });
  assert.equal(shown.length, 3);
  assert.equal(shown[2].critical, true);
  lessonOpen = false;
  scope.showToast('Normal notice after the lesson');
  assert.equal(shown.length, 4);
  window.__entryExperienceActive = true;
  scope.showToast('Entry warning', 'warning');
  assert.equal(shown.length, 4);
  assert.equal(recorded.length, 7);
});

test('contextual guidance yields to the lesson and returns to its usual eligibility after closing', () => {
  let lessonOpen = true;
  const scope = vm.createContext({ root: { LootLinguaGateLessonView: { isOpen: () => lessonOpen } },
    document: { hidden: false, body: { matches: () => false },
      documentElement: { classList: { contains: () => false } }, querySelectorAll: () => [] } });
  vm.runInContext(guideSource.slice(guideSource.indexOf('  function busy()'), guideSource.indexOf('  function canShow(')), scope);
  assert.equal(scope.busy(), true);
  lessonOpen = false;
  assert.equal(scope.busy(), false);
});

test('closing a lesson after an account switch cannot surface the previous owner’s deferred toast', () => {
  const window = { auth: { currentUser: { uid: 'owner-b' } },
    __entryDeferredToastQueue: [
      { preview: 'Owner A lesson notice', presentationOwner: 'owner-a', toastDedupeKey: 'a' },
      { preview: 'Owner B lesson notice', presentationOwner: 'owner-b', toastDedupeKey: 'b' },
    ] };
  let displays = 0;
  const scope = vm.createContext({ window, findInFlightToast: () => null, displayNextToast: () => displays++ });
  vm.runInContext(scriptSource.slice(scriptSource.indexOf('window.flushDeferredEntryToasts ='),
    scriptSource.indexOf('// ═', scriptSource.indexOf('window.flushDeferredEntryToasts ='))), scope);
  window.flushDeferredEntryToasts();
  assert.equal(displays, 1);
  assert.equal(window.__toastQueue.length, 1);
  assert.equal(window.__toastQueue[0].preview, 'Owner B lesson notice');
});

test('presentation credits learning and practice without changing completed words', () => {
  const start = viewSource.indexOf('  function progressUnits(');
  const end = viewSource.indexOf('  const number =', start);
  const scope = vm.createContext({});
  vm.runInContext(viewSource.slice(start, end), scope);
  const state = {
    wordIds: ['old', 'new'], completedWordIds: ['old'],
    study: { taught: ['old', 'new'], applied: ['old'] }
  };
  const before = structuredClone(state);
  assert.deepEqual({ ...scope.progressUnits(state) }, { units: 5, introduced: 2 });
  assert.deepEqual(state, before);
  state.study.applied.push('new');
  assert.equal(scope.progressUnits(state).units, 6);
  state.completedWordIds.push('new');
  assert.equal(scope.progressUnits(state).units, 8);
});
