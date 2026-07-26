import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminSource = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const cloudSource = readFileSync(new URL('../js/admin-cloud.js', import.meta.url), 'utf8');
const dataSource = readFileSync(new URL('../js/word-list-data.js', import.meta.url), 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return source.slice(start, end);
}

test('Admin Words V2 is feature-flagged and renders one current page', () => {
  const renderSection = section(adminSource, 'function renderWords()', 'function renderCurrentView()');
  const refreshSection = section(adminSource, 'async function refreshPagedWords', 'async function refreshLegacyWords');
  assert.match(adminSource, /const ADMIN_PAGED_WORDS_V2 = root\.LootLinguaFeatureFlags\?\.adminPagedWordsV2 !== false/);
  assert.match(adminSource, /const ADMIN_WORD_PAGE_CACHE_LIMIT = 3/);
  assert.match(refreshSection, /createAdminWordPager/);
  assert.match(refreshSection, /pager\.loadInitialPage\(\)/);
  assert.match(refreshSection, /pager\.loadNextPage\(\)/);
  assert.match(refreshSection, /pager\.loadPreviousPage\(\)/);
  assert.match(refreshSection, /pager\.refreshCurrentPage\(\)/);
  assert.match(renderSection, /'previous-words'/);
  assert.match(renderSection, /'next-words'/);
  assert.match(renderSection, /`صفحة \$\{ui\.wordPageIndex \+ 1\}`/);
  assert.match(renderSection, /ui\.words\.forEach\(\(word\) => list\.append\(renderWordRow/);
  assert.doesNotMatch(refreshSection, /new Map\(ui\.words\.map/);
});

test('Admin page selection is independent from cache and applies only to displayed words', () => {
  const selectionSection = section(adminSource, "if (action === 'select-page-words')", "if (action === 'create-word')");
  assert.match(adminSource, /selectedWordMeta: new Map\(\)/);
  assert.match(selectionSection, /ui\.words\.every/);
  assert.match(selectionSection, /ui\.words\.forEach/);
  assert.match(selectionSection, /setWordSelected\(word, !pageIsSelected\)/);
  assert.match(adminSource, /function wordSelectionPayload\(\)[\s\S]*?ui\.selectedWordMeta\.get\(contentWordId\)/);
});

test('central pagination contract owns signatures, generations, bounded cache, ledger, and retry-safe errors', () => {
  assert.match(dataSource, /function createQuerySignature\(query\)/);
  assert.match(dataSource, /function createPagedWordSource\(options\)/);
  assert.match(dataSource, /loadInitialPage/);
  assert.match(dataSource, /loadNextPage/);
  assert.match(dataSource, /loadPreviousPage/);
  assert.match(dataSource, /refreshCurrentPage/);
  assert.match(dataSource, /generation \+= 1/);
  assert.match(dataSource, /requestGeneration !== generation/);
  assert.match(dataSource, /while \(cache\.size > maxCachedPages\)/);
  assert.match(dataSource, /cursorLedger\.set/);
  assert.match(dataSource, /cache\.delete\(evictedIndex\)/);
  assert.doesNotMatch(dataSource, /IntersectionObserver|ResizeObserver|innerHTML/);
});

test('Admin Cloud uses scoped forward and backward keyset reads with one-document lookahead', () => {
  const listSection = section(cloudSource, 'async function listWords(', 'async function getWord(');
  assert.match(cloudSource, /endBefore,/);
  assert.match(cloudSource, /limitToLast,/);
  assert.match(listSection, /requireWordListDirection/);
  assert.match(listSection, /requireListSort\(normalizedQuery\.sort, WORD_SORTS, 'newest'\)/);
  assert.match(listSection, /listData\.createQuerySignature/);
  assert.match(listSection, /sortFields\.forEach/);
  assert.match(listSection, /orderBy\(documentId\(\), documentDirection\)/);
  assert.match(listSection, /endBefore\(\.\.\.cursorValues\)/);
  assert.match(listSection, /startAfter\(\.\.\.cursorValues\)/);
  assert.match(listSection, /limitToLast\(pageSize \+ 1\)/);
  assert.match(listSection, /limit\(pageSize \+ 1\)/);
  assert.match(listSection, /wordsCollection\(parentWorldId, parentRankId, parentGateId\)/);
  assert.match(listSection, /hasPrevious/);
  assert.match(listSection, /hasNext/);
  assert.doesNotMatch(listSection, /collectionGroup/);
});

test('Admin word query changes are server-side and reset the bounded pager', () => {
  const querySection = section(adminSource, 'function createAdminWordQuery(', 'function createAdminWordPager(');
  const pagerSection = section(adminSource, 'function createAdminWordPager(', 'function applyAdminWordPagerSnapshot(');
  const controlsSection = section(adminSource, 'function renderWordQueryControls()', 'function renderWords()');
  assert.match(querySection, /ui\.wordSearch/);
  assert.match(querySection, /ui\.wordFilterField/);
  assert.match(querySection, /ui\.wordSort/);
  assert.match(pagerSection, /sort: request\.query\.sort/);
  assert.match(pagerSection, /filters: request\.query\.filters/);
  assert.match(pagerSection, /search: request\.query\.search/);
  assert.match(controlsSection, /root\.setTimeout/);
  assert.match(controlsSection, /reloadAdminWordQuery/);
  assert.doesNotMatch(controlsSection, /\.sort\(/);
});

test('staging list reuses the same 25-row bounded pagination contract', () => {
  const refreshSection = section(adminSource, 'async function refreshStagingWords(', 'async function openStagingWords(');
  const renderSection = section(adminSource, 'function renderStagingWords()', 'function renderCurrentView()');
  const cloudSection = section(cloudSource, 'async function listStagingWords(', 'async function countStagingWords(');
  assert.match(adminSource, /maxCachedPages: ADMIN_WORD_PAGE_CACHE_LIMIT/);
  assert.match(refreshSection, /loadInitialPage/);
  assert.match(refreshSection, /loadNextPage/);
  assert.match(refreshSection, /loadPreviousPage/);
  assert.match(renderSection, /ui\.stagingWords\.forEach/);
  assert.match(renderSection, /'previous-staging'/);
  assert.match(renderSection, /'next-staging'/);
  assert.match(cloudSection, /limit\(pageSize \+ 1\)/);
  assert.match(cloudSection, /limitToLast\(pageSize \+ 1\)/);
});

test('Admin UI remains free of direct Firestore calls and does not add Cloud Functions', () => {
  assert.doesNotMatch(adminSource, /getDocs|collection\(|query\(|httpsCallable/);
  assert.doesNotMatch(dataSource, /firebase|Firestore|httpsCallable/);
  assert.doesNotMatch(cloudSource, /listWordsForward|listWordsBackward/);
});
