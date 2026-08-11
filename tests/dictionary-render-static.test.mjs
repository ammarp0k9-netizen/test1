import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [dictionarySource, renderSource, cloudSource, entryControllerSource, personalDataSource] = await Promise.all([
  readFile(new URL('../js/dictionary.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/dictionary-render.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/personal-dictionary-data.js', import.meta.url), 'utf8'),
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

test('personal dictionary snapshot mapper completes without listener-only state', () => {
  const sortStart = cloudSource.indexOf('function personalSortDefinition');
  const mapperEnd = cloudSource.indexOf('function createPersonalDictionaryFirestoreAdapter', sortStart);
  assert.notEqual(sortStart, -1);
  assert.notEqual(mapperEnd, -1);
  const mapperSource = cloudSource.slice(sortStart, mapperEnd);
  const context = vm.createContext({
    PERSONAL_WORD_PAGE_SIZE: 50,
    mapWordDoc: (snapshot) => ({ id: snapshot.id, ...snapshot.data() }),
    snapshot: {
      docs: [
        { id: 'word-a', data: () => ({ word: 'alpha', createdAt: 20 }) },
        { id: 'word-b', data: () => ({ word: 'beta', createdAt: 10 }) },
      ],
      metadata: { fromCache: false, hasPendingWrites: false },
    },
    request: {
      owner: { type: 'account', id: 'account-1' },
      query: { sort: 'newest', filter: 'all' },
      direction: 'forward',
      pageSize: 1,
      cursor: null,
    },
  });
  const page = new vm.Script(`${mapperSource}; mapPersonalPageSnapshot(snapshot, request);`)
    .runInContext(context);

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, 'word-a');
  assert.equal(page.hasPrevious, false);
  assert.equal(page.hasNext, true);
  assert.equal(page.startCursor.id, 'word-a');
  assert.equal(page.endCursor.id, 'word-a');
  assert.equal(page.fromCache, false);
  assert.equal(page.hasPendingWrites, false);
  assert.equal(page.listen, false);

  const listenerPage = new vm.Script(`${mapperSource}; mapPersonalPageSnapshot(snapshot, request, true);`)
    .runInContext(context);
  assert.equal(listenerPage.listen, true);
});

test('personal dictionary keeps one current-page listener and prefetches nearby pages once', async () => {
  const root = {};
  vm.runInContext(personalDataSource, vm.createContext({
    window: root,
    globalThis: root,
    console,
    Date,
    Map,
    Set,
    Promise,
    String,
    Number,
    Array,
    Object,
    Math,
  }));

  let openedListeners = 0;
  let cachedPageListeners = 0;
  let oneShotReads = 0;
  let unsubscribedListeners = 0;
  const makePage = (pageIndex, hasNext) => ({
    items: [{ id: `word-${pageIndex}`, word: `word ${pageIndex}` }],
    beforeCursor: pageIndex ? { value: pageIndex - 1, id: `word-${pageIndex - 1}` } : null,
    startCursor: { value: pageIndex, id: `word-${pageIndex}` },
    endCursor: { value: pageIndex, id: `word-${pageIndex}` },
    hasPrevious: pageIndex > 0,
    hasNext,
  });
  const adapter = {
    openPageListener: async () => {
      openedListeners += 1;
      return {
        initial: makePage(0, true),
        unsubscribe: () => { unsubscribedListeners += 1; },
      };
    },
    listenPage: (_request, onUpdate) => {
      cachedPageListeners += 1;
      onUpdate(makePage(1, false));
      return () => { unsubscribedListeners += 1; };
    },
    fetchPage: async () => {
      oneShotReads += 1;
      return makePage(1, false);
    },
    getCounts: async () => ({ totalCount: 2, filteredCount: null }),
  };
  const repository = root.LootLinguaPersonalDictionaryData.createRepository({ pageSize: 1 });
  repository.configure({ ownerType: 'account', ownerId: 'account-1', adapter });

  await repository.loadInitial();
  assert.equal(openedListeners, 1);
  assert.equal(repository.getSnapshot().listenerCount, 1);
  assert.equal(repository.getSnapshot().currentPage.items[0].id, 'word-0');

  await repository.prefetchNext();
  assert.equal(oneShotReads, 1);
  assert.equal(openedListeners, 1);
  assert.equal(cachedPageListeners, 0);
  assert.equal(repository.getSnapshot().listenerCount, 1);

  await repository.loadNext();
  assert.equal(cachedPageListeners, 1);
  assert.equal(unsubscribedListeners, 1);
  assert.equal(repository.getSnapshot().listenerCount, 1);

  repository.destroy();
  assert.equal(unsubscribedListeners, 2);
  assert.equal(repository.getSnapshot().listenerCount, 0);

  const nextRepository = root.LootLinguaPersonalDictionaryData.createRepository({ pageSize: 1 });
  nextRepository.configure({ ownerType: 'account', ownerId: 'account-2', adapter });
  await nextRepository.loadInitial();
  assert.equal(openedListeners, 2);
  assert.equal(nextRepository.getSnapshot().listenerCount, 1);
  nextRepository.destroy();
  assert.equal(unsubscribedListeners, 3);
});

test('account dictionary startup always releases the loading gate after its initial page settles', () => {
  const start = cloudSource.indexOf('async function loadWordsFromCloud');
  const end = cloudSource.indexOf('function mapWordDoc', start);
  const block = cloudSource.slice(start, end);
  assert.match(block, /await openPersonalDictionaryQuery\(currentPersonalDictionaryQuery\(\)\)/);
  assert.match(block, /finally\s*{\s*finishPersonalDictionaryInitialLoad\(\)/);
  assert.match(block, /wordsUnsubscribe = \(\) =>[\s\S]*personalDictionaryRepository\?\.destroy\?\.\(\)/);
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

test('the optional Entry gamer guide observes the real dictionary search and gamer-meaning button', () => {
  assert.match(dictionarySource, /new CustomEvent\('lootlingua:dictionary-search-result'/);
  for (const status of ['success', 'empty', 'error', 'blocked']) {
    assert.match(dictionarySource, new RegExp(`announceDictionarySearchResult\\([^\\n]+['"]${status}['"]`));
  }
  assert.match(dictionarySource, /window\.__lootlinguaEntryGamerGuideActive\) return;/);
  assert.match(entryControllerSource, /typeof root\.fetchSuggestions !== 'function'/);
  assert.match(entryControllerSource, /typeof root\.fetchGamerSuggestions !== 'function'/);
  assert.match(entryControllerSource, /targetGamerGuide\('#searchBtn'\)/);
  assert.match(entryControllerSource, /targetGamerGuide\('#gamerMeaningBubble \.gamer-meaning-btn'\)/);
  assert.doesNotMatch(entryControllerSource, /fetch\(|\/api\/gamer-dictionary/);
});
