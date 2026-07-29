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

function masteryMap(masteredOnceCount, currentMasteredCount = masteredOnceCount) {
  return new Map(words().map((word, index) => [
    word.wordKey,
    {
      mastery_status: index < currentMasteredCount ? 'Mastered' : 'Reviewing',
      mastered_once: index < masteredOnceCount,
    },
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
  const progress = loadedProgress();
  const mastery = masteryMap(10, 9);
  const view = journey.deriveGateMasteryView(progress, words(), mastery);
  assert.equal(view.derivedState, 'mastered');
  assert.equal(view.crownEarned, true);
  assert.equal(view.gapCount, 1);
  assert.equal(journey.gatePresentationState(progress, 'cleared', mastery), 'mastered');
});

test('ready gates may have all words Mastered but never display Crown before clear', () => {
  const progress = loadedProgress({ status: 'ready' });
  const mastery = masteryMap(10);
  const view = journey.deriveGateMasteryView(progress, words(), mastery);
  assert.equal(view.derivedState, 'ready');
  assert.equal(view.masteryAchieved, true);
  assert.equal(view.crownEarned, false);
  assert.equal(view.gapCount, 0);
  assert.equal(journey.gatePresentationState(progress, 'ready', mastery), 'ready');
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
  assert.equal(journey.gatePresentationState(progress, 'cleared', masteryMap(10)), 'cleared');
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
  assert.equal(view.crownEarned, false);
  assert.equal(view.derivedState, 'cleared');
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

test('a legacy masteryComplete flag is ignored and cannot fabricate a Crown', () => {
  const progress = loadedProgress({ masteryComplete: true });
  const mastery = masteryMap(9);
  const view = journey.deriveGateMasteryView(progress, words(), mastery);
  assert.equal(view.masteryAchieved, false);
  assert.equal(view.crownEarned, false);
  assert.equal(view.derivedState, 'cleared-with-gap');
  assert.equal(journey.gatePresentationState(progress, 'cleared', mastery), 'cleared');
});

test('one account-wide mastered word satisfies every loaded Gate that references it', () => {
  const sharedWord = [words(1)[0]];
  const progressA = loadedProgress({
    loadedContentWordIds: ['content-1'],
    loadedWordKeys: ['word-1'],
  });
  const progressB = loadedProgress({
    loadedContentWordIds: ['another-content-copy'],
    loadedWordKeys: ['word-1'],
  });
  const mastery = new Map([['word-1', {
    mastery_status: 'Reviewing',
    mastered_once: true,
  }]]);
  assert.equal(journey.deriveGateMasteryView(progressA, sharedWord, mastery).crownEarned, true);
  assert.equal(journey.deriveGateMasteryView(progressB, [{
    ...sharedWord[0],
    contentWordId: 'another-content-copy',
  }], mastery).crownEarned, true);
  assert.equal(mastery.size, 1);
});

test('content added after the load snapshot does not revoke an earned Crown', () => {
  const current = [...words(), {
    contentWordId: 'content-new',
    wordKey: 'word-new',
    status: 'published',
  }];
  const view = journey.deriveGateMasteryView(loadedProgress(), current, masteryMap(10));
  assert.equal(view.crownEarned, true);
  assert.equal(view.effectiveWordKeys.includes('word-new'), false);
});

test('two device snapshots converge when each masters one of the final words', () => {
  const firstDevice = masteryMap(8);
  firstDevice.set('word-9', { mastery_status: 'Mastered', mastered_once: true });
  const secondDevice = masteryMap(8);
  secondDevice.set('word-10', { mastery_status: 'Mastered', mastered_once: true });
  assert.equal(
    journey.deriveGateMasteryView(loadedProgress(), words(), firstDevice).crownEarned,
    false
  );
  const converged = new Map([...firstDevice, ...secondDevice]);
  converged.set('word-9', firstDevice.get('word-9'));
  assert.equal(
    journey.deriveGateMasteryView(loadedProgress(), words(), converged).crownEarned,
    true
  );
});

test('retrying the same derivation is idempotent and never mutates Gate progress', () => {
  const progress = loadedProgress();
  const before = structuredClone(progress);
  const mastery = masteryMap(10, 8);
  const first = journey.deriveGateMasteryView(progress, words(), mastery);
  const retry = journey.deriveGateMasteryView(progress, words(), mastery);
  assert.deepEqual(retry, first);
  assert.deepEqual(progress, before);
  assert.equal(first.crownEarned, true);
  assert.equal(first.gapCount, 2);
});
