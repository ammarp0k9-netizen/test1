import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/dictionary.js', import.meta.url), 'utf8');
function block(start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0, start);
  const finish = source.indexOf(end, offset);
  assert.ok(finish > offset, end);
  return source.slice(offset, finish);
}

function harness() {
  const listeners = new Map();
  const calls = [];
  const inputs = {
    meaningInput: { value: '', focus() { calls.push('focus'); } },
    exampleInput: { value: '' },
    suggestionsBox: { style: { display: 'block' } },
  };
  const context = vm.createContext({
    window: { dispatchEvent(event) { calls.push(event.type); } },
    document: {
      addEventListener(type, listener) {
        const registered = listeners.get(type) || [];
        registered.push(listener);
        listeners.set(type, registered);
      },
      getElementById(id) { return inputs[id]; },
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    setCategoryDropdownValue(value) { calls.push(['category', value]); },
    setAddFormExpanded(value) { calls.push(['expanded', value]); },
    clearGamerSuggestionsUI() { calls.push('clear-gamer'); },
  });
  vm.runInContext([
    block('function escapeHtml(', 'function safeClassToken('),
    block('function sugAttr(', 'window.submitSuggestionFromUI'),
    block('let suggestionInteractionsBound =', 'window.fetchGamerSuggestions'),
    block('function selectSuggestion(', 'const WORD_HUNTER_MIN_CONFIDENCE'),
  ].join('\n'), context);
  function dispatch(type, control, additions = {}) {
    const event = {
      type,
      target: { closest() { return control; } },
      prevented: false,
      preventDefault() { this.prevented = true; },
      ...additions,
    };
    for (const listener of listeners.get(type) || []) listener(event);
    return event;
  }
  return { context, listeners, calls, inputs, dispatch };
}

function selectionControl(markup) {
  const item = markup.match(/<div class="[^"]*sug-item-clickable[^"]*"([^>]*)>/)?.[1];
  assert.ok(item, 'the result is an interactive item');
  const dataset = {};
  for (const [, name, value] of item.matchAll(/data-([a-z]+)="([^"]*)"/g)) dataset[name] = value;
  return { dataset, closest() { return {}; } };
}

const hostile = `" autofocus onfocus="globalThis.compromised=1" ><img src=x onerror="globalThis.compromised=1"> ' \\ &#39;);globalThis.compromised=1;// &quot;`;

test('AI fields stay text and selection data, never inline executable attributes', () => {
  const { context } = harness();
  const markup = context.renderSuggestionHtml([{
    ar: hostile, pos: hostile, ex: hostile, ex_ar: hostile, game: hostile,
  }], 'sug-item', { sourceWord: hostile, showActions: true });
  assert.doesNotMatch(markup, /\son\w+\s*=\s*["']/i);
  assert.doesNotMatch(markup, /<(?:img|script)\b/i);
  assert.ok(markup.includes('&lt;img'));
  assert.ok(markup.includes('&amp;#39;'));
  const control = selectionControl(markup);
  for (const name of ['ar', 'pos', 'ex']) assert.equal(decodeURIComponent(control.dataset[name]), hostile);
  assert.equal(context.compromised, undefined);
});

test('clicking a descendant selects exact quoted/entity text without evaluating it', () => {
  const { context, dispatch, inputs, calls } = harness();
  const markup = context.renderSuggestionHtml([{ ar: hostile, pos: hostile, ex: hostile }], 'sug-item');
  const event = dispatch('click', selectionControl(markup));
  assert.equal(event.prevented, true);
  assert.equal(inputs.meaningInput.value, hostile);
  assert.equal(inputs.exampleInput.value, hostile);
  assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === 'category'), ['category', hostile]);
  assert.equal(inputs.suggestionsBox.style.display, 'none');
  assert.ok(calls.includes('lootlingua:dictionary-meaning-selected'));
  assert.ok(calls.includes('focus'));
  assert.equal(context.compromised, undefined);
});

test('Arabic, emoji, combining marks, newlines and lone surrogates render safely', () => {
  const { context, dispatch, inputs } = harness();
  const unicode = 'مرحبا 🎮 e\u0301 \u2028\u2029\n\r\t\uD800 end \uDC00';
  const expected = 'مرحبا 🎮 e\u0301 \u2028\u2029\n\r\t\uFFFD end \uFFFD';
  const markup = context.renderSuggestionHtml([{ ar: unicode, ex: unicode }], 'sug-item');
  dispatch('click', selectionControl(markup));
  assert.equal(inputs.meaningInput.value, expected);
  assert.equal(inputs.exampleInput.value, expected);
  assert.ok(markup.includes('مرحبا 🎮'));
});

test('malformed API fields use scalar fallbacks and bounded stars without throwing', () => {
  const { context } = harness();
  const badObject = { toString() { throw new Error('objects must not be stringified'); } };
  const fields = context.pickSuggestionFields({
    ar: badObject, arabic: 'fallback', pos: [], category: 'noun',
    ex: badObject, sentence: 42, ex_ar: null, game: {}, stars: Infinity,
  });
  assert.equal(fields.ar, 'fallback');
  assert.equal(fields.pos, 'noun');
  assert.equal(fields.ex, '42');
  assert.equal(fields.exAr, '');
  assert.equal(fields.game, '');
  assert.equal(fields.stars, 1);
  for (const entry of [null, undefined, [], true, 3, 'string', badObject]) {
    assert.doesNotThrow(() => context.renderSuggestionHtml([entry], 'sug-item'));
  }
  for (const [value, expected] of [[-100, 1], [2.6, 3], [100, 3], ['2', 2], [NaN, 1]]) {
    assert.equal(context.pickSuggestionFields({ stars: value }).stars, expected);
  }
  assert.equal(context.renderSuggestionHtml(null, 'sug-item'), '');
});

test('result activation supports Enter and Space and ignores unrelated/repeated keys', () => {
  for (const key of ['Enter', ' ']) {
    const { context, dispatch, inputs } = harness();
    const markup = context.renderSuggestionHtml([{ ar: 'معنى' }], 'sug-item');
    assert.match(markup, /role="button" tabindex="0"/);
    const control = selectionControl(markup);
    assert.equal(dispatch('keydown', control, { key: 'ArrowDown' }).prevented, false);
    assert.equal(dispatch('keydown', control, { key, repeat: true }).prevented, false);
    assert.equal(inputs.meaningInput.value, '');
    assert.equal(dispatch('keydown', control, { key }).prevented, true);
    assert.equal(inputs.meaningInput.value, 'معنى');
  }
});

test('repeated rendering binds once and leaves other action buttons and regions alone', () => {
  const { context, dispatch, listeners, inputs } = harness();
  for (let i = 0; i < 3; i++) context.renderSuggestionHtml([{ ar: 'meaning' }], 'sug-item');
  assert.equal(listeners.get('click').length, 1);
  assert.equal(listeners.get('keydown').length, 1);
  assert.equal(dispatch('click', null).prevented, false);
  assert.equal(dispatch('click', { closest() { return null; } }).prevented, false);
  assert.equal(inputs.meaningInput.value, '');
  const passive = context.renderSuggestionHtml([{ ar: 'meaning' }], 'sug-item', { allowSelect: false });
  assert.doesNotMatch(passive, /data-action="select-ai-meaning"|tabindex=/);
});

test('more/less uses a native button, only its own rows, and no selector-derived JS', () => {
  const { context, dispatch } = harness();
  const markup = context.renderSuggestionHtml(Array.from({ length: 6 }, () => ({ ar: 'معنى' })), 'sug-item', {
    listSelector: hostile,
  });
  assert.match(markup, /<button type="button" class="sug-toggle gamer-sug-toggle"/);
  assert.doesNotMatch(markup, /onclick=|globalThis/);
  const rows = [{ style: { display: 'none' } }, { style: { display: 'none' } }];
  let expanded = 'false';
  const toggle = {
    dataset: { action: 'toggle-ai-meanings' },
    closest() { return {}; },
    parentElement: { querySelectorAll(selector) { assert.equal(selector, '.extra-meaning'); return rows; } },
    getAttribute() { return expanded; },
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); expanded = value; },
  };
  assert.equal(dispatch('keydown', toggle, { key: 'Enter' }).prevented, false);
  dispatch('click', toggle);
  assert.equal(expanded, 'true');
  assert.ok(rows.every(row => row.style.display === 'block'));
  assert.equal(toggle.textContent, 'عرض أقل ▲');
  dispatch('click', toggle);
  assert.equal(expanded, 'false');
  assert.ok(rows.every(row => row.style.display === 'none'));
  assert.equal(toggle.textContent, 'عرض المزيد (2) ▼');
});
