import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [schemaSource, lifecycleSource, cloudSource, dictionarySource, worldsSource, htmlSource] =
  await Promise.all([
    readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/word-lifecycle.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/dictionary.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

const root = {};
const context = vm.createContext({ window: root, globalThis: root });
vm.runInContext(schemaSource, context);
vm.runInContext(lifecycleSource, context);
const lifecycle = root.LootLinguaWordLifecycle;

test('legacy words default to active personal membership', () => {
  const word = { word: 'legacy', meaning: 'old' };
  assert.equal(lifecycle.getPersonalDictionaryState(word), 'active');
  assert.equal(lifecycle.isVisibleInPersonalDictionaryList(word), true);
  assert.equal(lifecycle.isEligibleForPersonalDictionaryQuiz(word), true);
});

test('move removes only personal list and personal quiz membership', () => {
  const moved = {
    word: 'journey',
    meaning: 'trip',
    personalDictionaryState: 'moved-to-private-world',
    customWorldId: 'notes',
  };
  assert.equal(lifecycle.isMovedToPrivateWorld(moved), true);
  assert.equal(lifecycle.isVisibleInPersonalDictionaryList(moved), false);
  assert.equal(lifecycle.isEligibleForPersonalDictionaryQuiz(moved), false);
  assert.equal(lifecycle.isEligibleForPrivateWorldQuiz(moved, 'notes'), true);
  assert.equal(lifecycle.isEligibleForSrsReview(moved), true);
});

test('copy keeps the personal membership and adds a private membership', () => {
  const copied = {
    word: 'copy',
    meaning: 'copy',
    personalDictionaryState: 'active',
    privateWorldIds: ['notes'],
  };
  assert.equal(lifecycle.isVisibleInPersonalDictionaryList(copied), true);
  assert.equal(lifecycle.isEligibleForPersonalDictionaryQuiz(copied), true);
  assert.equal(lifecycle.isEligibleForPrivateWorldQuiz(copied, 'notes'), true);
});

test('source summaries distinguish private membership without losing Journey ownership', () => {
  const summary = lifecycle.summarizeSources([
    { sourceId: 'journey', addedFrom: 'published-gate' },
    { sourceId: 'private-a', addedFrom: 'private-world', customWorldId: 'a' },
    { sourceId: 'private-b', addedFrom: 'private-world', customWorldId: 'b' },
  ]);
  assert.equal(summary.hasJourneySource, true);
  assert.equal(summary.privateWorldCount, 2);
  assert.deepEqual(
    Array.from(summary.privateWorldSources, (source) => source.customWorldId),
    ['a', 'b']
  );
});

test('cloud deletion requires a disposition for the final moved membership', () => {
  assert.match(cloudSource, /async function getPrivateWorldRemovalImpact/);
  assert.match(cloudSource, /personalDictionaryState === 'moved-to-private-world'/);
  assert.match(cloudSource, /word-lifecycle\/disposition-required/);
  assert.match(cloudSource, /word-lifecycle\/journey-delete-forbidden/);
  assert.match(cloudSource, /disposition === 'return-personal'/);
});

test('UI separates copy and move and offers return from a private world', () => {
  assert.match(htmlSource, /id="worldManageChoiceModal"/);
  assert.match(htmlSource, /confirmWorldManageChoice\('move'\)/);
  assert.match(htmlSource, /confirmWorldManageChoice\('copy'\)/);
  assert.match(htmlSource, /id="privateMembershipDispositionModal"/);
  assert.match(worldsSource, /returnPrivateWordToPersonalDictionary/);
  assert.match(dictionarySource, /getPrivateWorldRemovalImpact/);
});

test('membership operations do not invoke rewards or reset learning state', () => {
  const block = cloudSource.slice(
    cloudSource.indexOf('async function getPrivateWorldRemovalImpact'),
    cloudSource.indexOf('async function setUserWordDictionaryVisibility')
  );
  assert.doesNotMatch(block, /awardXP|markDailyQuest|recordChest|mastery_status\s*:/);
});
