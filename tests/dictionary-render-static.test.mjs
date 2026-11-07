import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [dictionarySource, renderSource, cloudSource, entryControllerSource] = await Promise.all([
  readFile(new URL('../js/dictionary.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/dictionary-render.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-controller.js', import.meta.url), 'utf8'),
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

test('Entry no longer attaches a game-dictionary search guide to the personal dictionary', () => {
  assert.doesNotMatch(entryControllerSource, /fetchSuggestions|fetchGamerSuggestions|targetGamerGuide|__lootlinguaEntryGamerGuideActive/);
  assert.doesNotMatch(dictionarySource, /__lootlinguaEntryGamerGuideActive/);
});

test('private-world rendering does not treat a false boolean as a personal page store', () => {
  const start = renderSource.indexOf('function renderDictionaryWindow');
  const prefix = renderSource.slice(start, renderSource.indexOf('  const searchType =', start));
  vm.runInNewContext('let dictionaryFullDataRequest=null;' + prefix + '}renderDictionaryWindow()', {
    window: { cancelDictionaryFullDataRequest() {}, LootLinguaDictionaryPages: { current() { throw Error('Private view must not use personal pagination'); } } },
    document: { getElementById: () => ({ value: '' }) },
    isEditableDictionaryView: () => true, isCustomWorldView: () => true,
    dictionarySortMode: 'newest', dictionarySortCategory: 'all', currentFilter: 'all',
  });
});

test('page-status events stay harmless in private worlds and other views while personal pages load', () => {
  const start = renderSource.indexOf('function updateDictionaryPageStatus');
  const code = renderSource.slice(start, renderSource.indexOf("window.addEventListener('lootlingua:dictionary-page-state'", start));
  for (const currentView of ['customWorld', 'worlds', 'quiz', 'profile', 'personal']) {
    const status = { hidden: false, setAttribute() {} };
    let reads = 0;
    const context = {
      currentView, document: { getElementById: id => id === 'dictionaryLoadStatus' ? status : ({ value: '' }) },
      window: { LootLinguaDictionaryPages: { current() { reads++; return { state: () => ({ loading: true, complete: false }) }; } } },
    };
    vm.runInNewContext(code + ';updateDictionaryPageStatus()', context);
    assert.equal(reads, currentView === 'personal' ? 1 : 0);
    assert.equal(status.hidden, currentView !== 'personal');
  }
});

test('private memberships remain visible and searchable despite personal-only hidden or moved flags', () => {
  const start = renderSource.indexOf('function getDictionaryListSnapshot');
  const code = renderSource.slice(start, renderSource.indexOf('function wordDetailText', start));
  for (const privateScope of [true, false]) for (const query of ['', 'apple']) {
    const words = [
      { id: 'moved', word: 'Apple', meaning: 'تفاحة', personalDictionaryState: 'moved-to-private-world' },
      { id: 'hidden', word: 'Apple hidden', meaning: 'تفاحة', hiddenFromDictionary: true },
      { id: 'visible', word: 'Apple active', meaning: 'تفاحة', personalDictionaryState: 'active' },
    ];
    const root = { words, LootLinguaWordLifecycle: { isVisibleInDictionaryList: word => !word.hiddenFromDictionary && word.personalDictionaryState !== 'moved-to-private-world' }, LootLinguaDictionaryWindow: { createHeightIndex: () => ({ measure() {} }) } };
    const context = vm.createContext({ window: root, Map, WORD_DOM_WINDOW_SIZE: 60, renderLimit: 20, dictionaryListCache: null, dictionaryRenderRevision: 0, dictionaryMeasurementScope: '', dictionaryMeasurements: new Map(),
      getStorageUserId: () => 'a', getActiveDictionaryStorageScope: () => privateScope ? 'custom-a' : 'personal', isCustomWorldView: () => privateScope,
      currentFilter: 'all', dictionarySortMode: 'auto', dictionarySortCategory: 'all', isReorderMode: false, sortDictionaryWords: rows => rows,
    });
    vm.runInContext(code, context);
    assert.deepEqual([...context.getDictionaryListSnapshot(query, 'all').filtered].map(word => word.id).sort(), privateScope ? ['hidden','moved','visible'] : ['visible']);
  }
});
