import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [dictionarySource, renderSource, cloudSource] = await Promise.all([
  readFile(new URL('../js/dictionary.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/dictionary-render.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
]);

test('personal words retain every published educational field from the cloud snapshot', () => {
  for (const field of [
    'normalizedWord',
    'wordKey',
    'translation',
    'definition',
    'definition_ar',
    'exampleTranslation',
    'partOfSpeech',
    'category',
    'level',
    'tags',
    'synonyms',
    'pronunciation',
    'notes',
  ]) {
    assert.match(cloudSource, new RegExp(`\\b${field}:`), field);
  }
});

test('part of speech and category render as separate labels', () => {
  assert.match(renderSource, /w\.category[\s\S]*class="cat-tag/);
  assert.match(renderSource, /w\.partOfSpeech[\s\S]*class="pos-tag/);
  assert.doesNotMatch(renderSource, /partOfSpeech\s*\|\|\s*w\.category/);
});

test('word details render definitions and translated examples without empty rows', () => {
  assert.match(renderSource, /definition_ar \|\| w\.definitionAr/);
  assert.match(renderSource, /renderWordDetailRow\('Definition'/);
  assert.match(renderSource, /renderWordDetailRow\('ترجمة المثال', w\.exampleTranslation\)/);
  assert.match(renderSource, /rows\.filter\(Boolean\)/);
  assert.match(renderSource, /definition !== meaning && definition !== definitionAr/);
});

test('opening one card among 180 words only updates that card and preserves scroll', () => {
  const start = dictionarySource.indexOf('function handleLiClick');
  const end = dictionarySource.indexOf('function showBackupHelp', start);
  const block = dictionarySource.slice(start, end);
  const words = Array.from({ length: 180 }, (_, index) => ({
    id: `word-${index}`,
    expanded: false,
  }));
  const calls = [];
  const element = {
    classList: {
      toggle(name, value) {
        calls.push(['toggle', name, value]);
      },
    },
    setAttribute(name, value) {
      calls.push(['attribute', name, value]);
    },
  };
  const context = vm.createContext({
    window: { words, scrollY: 912 },
    isReorderMode: false,
    persistDictionary() {
      throw new Error('full persistence must not run for expansion');
    },
    render() {
      throw new Error('full render must not run for expansion');
    },
  });
  new vm.Script(`${block}; handleLiClick(155, element);`)
    .runInContext(Object.assign(context, { element }));
  assert.equal(words[155].expanded, true);
  assert.deepEqual(calls, [
    ['toggle', 'show-example', true],
    ['attribute', 'aria-expanded', 'true'],
  ]);
  assert.equal(context.window.scrollY, 912);
});
