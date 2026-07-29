import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../js/journey.js', import.meta.url), 'utf8');
const windowObject = {};
vm.runInContext(source, vm.createContext({
  window: windowObject,
  globalThis: windowObject,
  encodeURIComponent,
  Error,
  Map,
  Set,
  Object,
  String,
  Number,
  Array,
  Boolean,
}));
const journey = windowObject.LootLinguaJourney;

function words(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    id: `content-${index + 1}`,
    contentWordId: `content-${index + 1}`,
    wordKey: `word-${index + 1}`,
    status: 'published',
  }));
}

function loadedProgress(overrides = {}) {
  const all = words();
  return {
    status: 'cleared',
    loadedAt: 1,
    loadedContentWordIds: all.map((word) => word.contentWordId),
    loadedWordKeys: all.map((word) => word.wordKey),
    ...overrides,
  };
}

function masteryMap(masteredCount) {
  return new Map(words().map((word, index) => [
    word.wordKey,
    { mastery_status: index < masteredCount ? 'Mastered' : 'Reviewing' },
  ]));
}

test('a cleared 10-word gate with 3 non-mastered words derives an exact gap and no Crown', () => {
  const view = journey.deriveGateMasteryView(loadedProgress(), words(), masteryMap(7));
  assert.equal(view.derivedState, 'cleared-with-gap');
  assert.equal(view.effectiveWordCount, 10);
  assert.equal(view.masteredWordCount, 7);
  assert.equal(view.gapCount, 3);
  assert.equal(view.crownEarned, false);
  assert.deepEqual(Array.from(view.gapWordKeys), ['word-8', 'word-9', 'word-10']);
});

test('Crown is a permanent presentation achievement after clear even if a word regresses', () => {
  const progress = loadedProgress({ masteryComplete: true });
  const view = journey.deriveGateMasteryView(progress, words(), masteryMap(9));
  assert.equal(view.derivedState, 'mastered');
  assert.equal(view.crownEarned, true);
  assert.equal(view.gapCount, 1);
  assert.equal(journey.gatePresentationState(progress, 'cleared'), 'mastered');
});

test('ready gates may have all words Mastered but never display Crown before clear', () => {
  const progress = loadedProgress({ status: 'ready', masteryComplete: true });
  const view = journey.deriveGateMasteryView(progress, words(), masteryMap(10));
  assert.equal(view.derivedState, 'ready');
  assert.equal(view.crownEarned, false);
  assert.equal(view.gapCount, 0);
  assert.equal(journey.gatePresentationState(progress, 'ready'), 'ready');
});

test('Level Placement cleared-without-load has neither a fake gap nor Crown', () => {
  const progress = {
    status: 'cleared',
    clearedBy: 'level-placement',
    placementClearedWithoutLoad: true,
    masteryComplete: true,
  };
  const view = journey.deriveGateMasteryView(progress, words(), masteryMap(10));
  assert.equal(view.derivedState, 'cleared-without-load');
  assert.equal(view.membershipKnown, false);
  assert.equal(view.gapCount, null);
  assert.equal(view.crownEarned, false);
  assert.equal(journey.gatePresentationState(progress, 'cleared'), 'cleared');
});

test('current published membership removes ghost gaps and does not add post-load words retroactively', () => {
  const progress = loadedProgress();
  const current = words().slice(0, 9);
  current[8] = { ...current[8], status: 'archived' };
  current.push({
    contentWordId: 'content-new',
    wordKey: 'word-new',
    status: 'published',
  });
  const mastery = masteryMap(8);
  const view = journey.deriveGateMasteryView(progress, current, mastery);
  assert.equal(view.effectiveWordCount, 8);
  assert.equal(view.gapCount, 0);
  assert.equal(view.effectiveWordKeys.includes('word-9'), false);
  assert.equal(view.effectiveWordKeys.includes('word-new'), false);
});

test('legacy loaded gates without content IDs safely use the loaded word keys', () => {
  const progress = loadedProgress({ loadedContentWordIds: undefined });
  const view = journey.deriveGateMasteryView(progress, words(), masteryMap(9));
  assert.equal(view.effectiveWordCount, 10);
  assert.equal(view.gapCount, 1);
});

test('hidden and moved copies do not alter account-wide membership or mastery math', () => {
  const published = words().map((word, index) => ({
    ...word,
    hiddenFromDictionary: index === 7,
    personalDictionaryState: index === 8 ? 'moved-to-private-world' : 'active',
  }));
  const view = journey.deriveGateMasteryView(loadedProgress(), published, masteryMap(7));
  assert.equal(view.effectiveWordCount, 10);
  assert.deepEqual(Array.from(view.gapWordKeys), ['word-8', 'word-9', 'word-10']);
});

