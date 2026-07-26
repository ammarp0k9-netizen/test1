import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
await import('../js/word-list-data.js');

const {
  createPagedWordSource,
  createQuerySignature,
  normalizeQuery
} = globalThis.LootLinguaWordListData;

function makeItems(start) {
  return Array.from({ length: 25 }, (_, index) => ({
    contentWordId: `word-${start + index}`,
    version: 1
  }));
}

function makePage(index) {
  const start = index * 25 + 1;
  return {
    items: makeItems(start),
    beforeCursor: index ? `end-${start - 1}` : null,
    startCursor: `first-${start}`,
    endCursor: `end-${start + 24}`,
    hasPrevious: index > 0,
    hasNext: index < 5
  };
}

function pageIndexFor(request) {
  if (request.direction === 'backward') {
    return Math.max(0, Math.floor((Number(String(request.cursor).replace('first-', '')) - 1) / 25) - 1);
  }
  if (!request.cursor) return 0;
  return Math.floor(Number(String(request.cursor).replace('end-', '')) / 25);
}

function createFakeSource(overrides = {}) {
  const calls = [];
  const fetchPage = overrides.fetchPage || (async (request) => {
    calls.push(request);
    return makePage(pageIndexFor(request));
  });
  const source = createPagedWordSource({
    query: { sourceType: 'admin-content-words', worldId: 'world-a', gateId: 'gate-a', pageSize: 25 },
    pageSize: 25,
    maxCachedPages: 3,
    fetchPage,
    getItemId: (item) => item.contentWordId
  });
  return { source, calls };
}

test('loads initial, next, and previous pages with stable page metadata', async () => {
  const { source, calls } = createFakeSource();
  await source.loadInitialPage();
  assert.equal(source.getSnapshot().currentPage.pageIndex, 0);
  assert.equal(source.getSnapshot().currentPage.items.length, 25);
  assert.equal(source.getSnapshot().currentPage.hasPrevious, false);
  assert.equal(source.getSnapshot().currentPage.hasNext, true);

  await source.loadNextPage();
  assert.equal(source.getSnapshot().currentPage.pageIndex, 1);
  assert.equal(source.getSnapshot().currentPage.items[0].contentWordId, 'word-26');
  assert.equal(calls.at(-1).direction, 'forward');
  assert.equal(calls.at(-1).cursor, 'end-25');

  await source.loadPreviousPage();
  assert.equal(source.getSnapshot().currentPage.pageIndex, 0);
  assert.equal(source.getSnapshot().currentPage.items[0].contentWordId, 'word-1');
});

test('isolates query signatures by every result-affecting field', () => {
  const base = createQuerySignature({
    sourceType: 'admin-content-words', worldId: 'world-a', rankId: 'rank-a',
    gateId: 'gate-a', search: '', filter: '', sort: 'order:asc', pageSize: 25
  });
  assert.notEqual(base, createQuerySignature({
    sourceType: 'admin-content-words', worldId: 'world-b', rankId: 'rank-a',
    gateId: 'gate-a', search: '', filter: '', sort: 'order:asc', pageSize: 25
  }));
  assert.notEqual(base, createQuerySignature({
    sourceType: 'admin-content-words', worldId: 'world-a', rankId: 'rank-a',
    gateId: 'gate-a', search: '', filter: '', sort: 'order:asc', pageSize: 50
  }));
  assert.equal(
    createQuerySignature({
      sourceType: 'admin-content-words', worldId: 'world-a', rankId: 'rank-a',
      gateId: 'gate-a', filters: {}, sort: 'newest', pageSize: 25
    }),
    createQuerySignature({
      sourceType: 'admin-content-words', worldId: 'world-a', rankId: 'rank-a',
      gateId: 'gate-a', filters: { status: 'all', level: null },
      sort: 'latest', pageSize: '25'
    })
  );
  assert.deepEqual(normalizeQuery({
    sourceType: 'admin-content-word-import-staging',
    worldId: 'must-not-leak',
    rankId: 'must-not-leak',
    gateId: 'must-not-leak',
    filters: undefined,
    pageSize: '25'
  }), {
    sourceType: 'admin-content-word-import-staging',
    sort: 'newest',
    filters: {},
    pageSize: 25
  });
});

test('ignores an old generation result after a query reset', async () => {
  let resolveOld;
  const { source } = createFakeSource({
    fetchPage(request) {
      if (request.query.gateId === 'gate-a') {
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      return Promise.resolve({ ...makePage(0), items: [{ contentWordId: 'gate-b-word', version: 1 }] });
    }
  });
  const oldRequest = source.loadInitialPage();
  await Promise.resolve();
  const freshRequest = source.loadInitialPage({
    sourceType: 'admin-content-words', worldId: 'world-a', gateId: 'gate-b', pageSize: 25
  });
  resolveOld(makePage(0));
  await Promise.all([oldRequest, freshRequest]);
  assert.equal(source.getSnapshot().currentPage.items[0].contentWordId, 'gate-b-word');
  assert.match(source.getSnapshot().querySignature, /gate-b/);
});

test('keeps at most three cached pages while retaining cursor ledger and can refetch an evicted page', async () => {
  const { source, calls } = createFakeSource();
  await source.loadInitialPage();
  await source.loadNextPage();
  await source.loadNextPage();
  await source.loadNextPage();
  const afterFour = source.getSnapshot();
  assert.equal(afterFour.cache.pageCount, 3);
  assert.equal(afterFour.cache.itemCount, 75);
  assert.deepEqual(afterFour.cache.pageIndexes, [1, 2, 3]);
  assert.deepEqual(afterFour.cache.ledgerPageIndexes, [0, 1, 2, 3]);

  await source.loadPreviousPage();
  await source.loadPreviousPage();
  await source.loadPreviousPage();
  assert.equal(source.getSnapshot().currentPage.pageIndex, 0);
  assert.ok(calls.some((call) => call.direction === 'backward' && call.cursor === 'first-26'));
});

test('de-duplicates IDs and coalesces duplicate requests for one direction', async () => {
  let nextResolve;
  const { source, calls } = createFakeSource({
    fetchPage(request) {
      calls.push(request);
      if (request.direction === 'forward' && request.cursor === 'end-25') {
        return new Promise((resolve) => { nextResolve = resolve; });
      }
      if (!request.cursor) {
        return Promise.resolve({
          ...makePage(0),
          items: [{ contentWordId: 'word-1', version: 1 }, { contentWordId: 'word-1', version: 2 }]
        });
      }
      return Promise.resolve(makePage(pageIndexFor(request)));
    }
  });
  await source.loadInitialPage();
  assert.equal(source.getSnapshot().currentPage.items.length, 1);
  const firstNext = source.loadNextPage();
  const secondNext = source.loadNextPage();
  await Promise.resolve();
  assert.equal(calls.filter((call) => call.direction === 'forward' && call.cursor === 'end-25').length, 1);
  nextResolve(makePage(1));
  await Promise.all([firstNext, secondNext]);
  assert.equal(calls.filter((call) => call.direction === 'forward' && call.cursor === 'end-25').length, 1);
});

test('keeps the current page after an error and supports retry', async () => {
  let failNext = true;
  const { source } = createFakeSource({
    fetchPage(request) {
      if (request.direction === 'forward' && request.cursor === 'end-25' && failNext) {
        failNext = false;
        return Promise.reject(Object.assign(new Error('temporary'), { code: 'unavailable' }));
      }
      return Promise.resolve(makePage(pageIndexFor(request)));
    }
  });
  await source.loadInitialPage();
  await assert.rejects(source.loadNextPage(), { code: 'unavailable' });
  assert.equal(source.getSnapshot().currentPage.pageIndex, 0);
  await source.loadNextPage();
  assert.equal(source.getSnapshot().currentPage.pageIndex, 1);
});
