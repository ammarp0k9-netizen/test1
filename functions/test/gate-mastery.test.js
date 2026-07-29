'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const {
  allWordsMastered,
  createGateMasteryProjector,
  effectiveLoadedWordKeys,
  newlyMasteredWordKeys,
  shouldReconcileGateWrite,
  shouldReconcileContentWordWrite,
  uniqueGateTargets,
} = require('../gate-mastery');

const functionsEntrypoint = readFileSync(require.resolve('../index.js'), 'utf8');

function mastered(status = 'Mastered') {
  return { mastery_status: status };
}

function gate(gateId, overrides = {}) {
  return {
    worldId: 'world',
    rankId: 'rank',
    gateId,
    addedFrom: 'published-gate',
    ...overrides,
  };
}

test('only transitions into Mastered trigger source discovery', () => {
  assert.deepEqual(newlyMasteredWordKeys(
    { entries: { a: mastered('Reviewing'), b: mastered() } },
    { entries: { a: mastered(), b: mastered(), c: mastered('Learning') } }
  ), ['a']);
});

test('shared words discover every related gate once and ignore non-Journey sources', async () => {
  const commits = [];
  const projector = createGateMasteryProjector({
    async listWordSources(uid, wordKey) {
      assert.equal(uid, 'user');
      assert.equal(wordKey, 'shared');
      return [gate('gate-a'), gate('gate-b'), gate('gate-a'), {
        addedFrom: 'private-world', worldId: 'world', rankId: 'rank', gateId: 'private',
      }];
    },
    async commitGateMastery(uid, target) {
      commits.push(`${uid}/${target.gateId}`);
      return { changed: true };
    },
  });
  const result = await projector.projectMasteryTransitions(
    'user',
    { entries: { shared: mastered('Reviewing') } },
    { entries: { shared: mastered() } }
  );
  assert.equal(result.gateCount, 2);
  assert.deepEqual(commits.sort(), ['user/gate-a', 'user/gate-b']);
});

test('effective membership intersects the load snapshot with currently published words', () => {
  const progress = {
    status: 'cleared',
    loadedAt: 1,
    loadedContentWordIds: ['a', 'b', 'deleted'],
    loadedWordKeys: ['one', 'two', 'ghost'],
  };
  const published = [
    { contentWordId: 'a', wordKey: 'one', status: 'published' },
    { contentWordId: 'b', wordKey: 'two', status: 'archived' },
    { contentWordId: 'new', wordKey: 'new', status: 'published' },
  ];
  assert.deepEqual(effectiveLoadedWordKeys(progress, published), ['one']);
  assert.equal(allWordsMastered(['one'], { one: mastered() }), true);
  assert.equal(allWordsMastered([], {}), false);
});

test('ready and legacy cleared gates are eligible, while Level Placement without load is not', () => {
  const loaded = { status: 'ready', loadedAt: 1, loadedWordKeys: ['one'] };
  assert.equal(shouldReconcileGateWrite(null, loaded), true);
  assert.equal(shouldReconcileGateWrite(loaded, { ...loaded, status: 'cleared' }), false);
  assert.equal(shouldReconcileGateWrite(
    { status: 'cleared', placementClearedWithoutLoad: true },
    { ...loaded, status: 'cleared', placementClearedWithoutLoad: false }
  ), true);
  assert.equal(shouldReconcileGateWrite(null, {
    status: 'cleared',
    placementClearedWithoutLoad: true,
  }), false);
});

test('two concurrent last-word events converge on one permanent write', async () => {
  let masteryComplete = false;
  let writes = 0;
  const projector = createGateMasteryProjector({
    async listWordSources() { return [gate('old-gate')]; },
    async commitGateMastery() {
      await Promise.resolve();
      if (masteryComplete) return { changed: false, reason: 'already-complete' };
      masteryComplete = true;
      writes += 1;
      return { changed: true };
    },
  });
  await Promise.all([
    projector.projectMasteryTransitions('user', {}, { entries: { one: mastered() } }),
    projector.projectMasteryTransitions('user', {}, { entries: { two: mastered() } }),
  ]);
  assert.equal(masteryComplete, true);
  assert.equal(writes, 1);
});

test('a failed write remains retryable and the retry is idempotent', async () => {
  let attempts = 0;
  let writes = 0;
  const projector = createGateMasteryProjector({
    async listWordSources() { return [gate('retry-gate')]; },
    async commitGateMastery() {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary write failure');
      if (!writes) writes += 1;
      return { changed: writes === 1 };
    },
  });
  const before = { entries: { one: mastered('Reviewing') } };
  const after = { entries: { one: mastered() } };
  await assert.rejects(projector.projectMasteryTransitions('user', before, after));
  await projector.projectMasteryTransitions('user', before, after);
  assert.equal(attempts, 2);
  assert.equal(writes, 1);
});

test('large mastery maps inspect reverse membership only for newly Mastered keys', async () => {
  const beforeEntries = {};
  const afterEntries = {};
  for (let index = 0; index < 4000; index += 1) {
    beforeEntries[`word-${index}`] = mastered('Reviewing');
    afterEntries[`word-${index}`] = mastered('Reviewing');
  }
  afterEntries['word-3999'] = mastered();
  const reads = [];
  const projector = createGateMasteryProjector({
    async listWordSources(uid, wordKey) {
      reads.push(wordKey);
      return [gate('affected')];
    },
    async commitGateMastery() { return { changed: false }; },
  });
  const result = await projector.projectMasteryTransitions(
    'user',
    { entries: beforeEntries },
    { entries: afterEntries }
  );
  assert.deepEqual(reads, ['word-3999']);
  assert.equal(result.gateCount, 1);
});

test('source normalization never duplicates the same Gate', () => {
  assert.equal(uniqueGateTargets([gate('a'), gate('a'), gate('b')]).length, 2);
});

test('Functions exports retryable word, load, and content reconciliation triggers', () => {
  assert.match(functionsEntrypoint, /exports\.projectGateMasteryFromWord = onDocumentWritten/);
  assert.match(functionsEntrypoint, /exports\.projectGateMasteryFromGateLoad = onDocumentWritten/);
  assert.match(functionsEntrypoint, /exports\.reconcileGateMasteryFromContentWord = onDocumentWritten/);
  assert.equal((functionsEntrypoint.match(/retry: true/g) || []).length >= 3, true);
});

test('unpublish and delete reconcile only users linked to the affected content word', async () => {
  const commits = [];
  const projector = createGateMasteryProjector({
    async listWordSources() { return []; },
    async listContentWordMemberships(target) {
      assert.equal(target.contentWordId, 'removed');
      return [
        { uid: 'user-a', target: gate('gate-a') },
        { uid: 'user-a', target: gate('gate-a') },
        { uid: 'user-b', target: gate('gate-b') },
      ];
    },
    async commitGateMastery(uid, target) {
      commits.push(`${uid}/${target.gateId}`);
      return { changed: true };
    },
  });
  const result = await projector.projectContentWordChange(
    { contentWordId: 'removed' },
    { status: 'published', wordKey: 'removed-word' },
    { status: 'archived', wordKey: 'removed-word' }
  );
  assert.equal(result.userCount, 2);
  assert.equal(result.gateCount, 2);
  assert.deepEqual(commits.sort(), ['user-a/gate-a', 'user-b/gate-b']);
  assert.equal(shouldReconcileContentWordWrite(
    { status: 'published', wordKey: 'same' },
    { status: 'published', wordKey: 'same' }
  ), false);
});
