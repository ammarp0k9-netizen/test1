import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [apiSource, worldsSource, routerSource, htmlSource, styleSource, wordListSource] = await Promise.all([
  readFile(new URL('../js/published-content.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/script.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
  readFile(new URL('../js/word-list-data.js', import.meta.url), 'utf8'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('published content API exposes scoped read operations only', () => {
  [
    'listPublishedWorlds',
    'listPublishedRanks',
    'listPublishedGates',
    'listPublishedGateWords',
    'listAllPublishedGateWords',
    'invalidate',
  ].forEach((name) => assert.match(apiSource, new RegExp(`\\b${name}\\b`)));
  assert.match(apiSource, /where\('status', '==', PUBLISHED\)/);
  assert.match(apiSource, /orderBy\('order', 'asc'\)/);
  assert.match(apiSource, /orderBy\(documentId\(\), 'asc'\)/);
  assert.doesNotMatch(apiSource, /collectionGroup|onSnapshot|httpsCallable|getFunctions/);
});

test('published records preserve Admin unlock configuration for journey access checks', () => {
  assert.match(apiSource, /\.\.\.\(snapshot\.data\(\) \|\| \{\}\)/);
  assert.match(worldsSource, /initialAccessStatus|canAccessRank|canAccessGate/);
  assert.match(worldsSource, /published-card-journey-\$\{journeyState\}/);
});

test('published world reads expose the central interest contract with a legacy fallback', () => {
  const worldRecord = sourceSection(apiSource, 'function worldRecord', 'function recordKey');
  assert.match(worldRecord, /LootLinguaContentSchema/);
  assert.match(worldRecord, /normalizeWorldInterest\(item\.primaryInterest\)/);
  assert.match(worldRecord, /normalizeWorldInterestTags\(item\.interestTags\)/);
  assert.match(worldRecord, /:\s*'unknown'/);
  assert.match(worldRecord, /:\s*\[\]/);
  assert.match(apiSource, /snapshot\.docs\.map\(worldRecord\)/);
  assert.match(apiSource, /const item = worldRecord\(snapshot\)/);
});

test('published word reads use real 25-item bidirectional pagination', () => {
  assert.match(apiSource, /const PAGE_SIZE = 25/);
  assert.match(apiSource, /limitToLast\(settings\.pageSize \+ 1\)/);
  assert.match(apiSource, /limit\(settings\.pageSize \+ 1\)/);
  assert.match(apiSource, /endBefore\(cursorOrder, cursorId\)/);
  assert.match(apiSource, /startAfter\(cursorOrder, cursorId\)/);
  assert.match(apiSource, /order: item\.order/);
  assert.match(apiSource, /const cursorOrder = settings\.cursor\.order/);
  assert.doesNotMatch(
    sourceSection(apiSource, 'function wordCursor', 'async function listPublishedGateWords'),
    /Number\(item\.order\)/
  );
  assert.match(worldsSource, /sourceType: 'published-gate-words'/);
  assert.match(worldsSource, /maxCachedPages: 3/);
  assert.match(worldsSource, /wordPager: null/);
});

test('published UI is separate from the existing custom-world panel', () => {
  assert.match(htmlSource, /id="publishedWorldsTab"[^>]*class="worlds-tab active"/);
  assert.match(htmlSource, /id="customWorldsPanel"[^>]*hidden/);
  assert.match(htmlSource, /id="publishedContentView"/);
  assert.match(htmlSource, /id="worldsGrid"/);
  assert.match(worldsSource, /const publishedContentState = \{/);
  assert.match(worldsSource, /window\.showCustomWorldsTab/);
  assert.match(worldsSource, /renderCustomWorldCards\(\)/);
  assert.doesNotMatch(apiSource, /innerHTML|localStorage|ui\.words|adminPager|stagingPager/);
});

test('router recognizes every published-content route with dynamic project base path', () => {
  assert.match(routerSource, /location\.hostname\.endsWith\('\.github\.io'\)/);
  assert.match(routerSource, /segments\[1\] === 'app' \? `\/\$\{segments\[0\]\}\/app`/);
  assert.match(routerSource, /return segments\[0\] === 'app' \? '\/app' : ''/);
  assert.match(routerSource, /parts\.length === 2/);
  assert.match(routerSource, /parts\.length === 4 && parts\[2\] === 'ranks'/);
  assert.match(
    routerSource,
    /parts\.length === 6 && parts\[2\] === 'ranks' && parts\[4\] === 'gates'/
  );
  assert.match(routerSource, /kind: 'published', key: 'not-found'/);
  assert.doesNotMatch(routerSource, /APP_PROJECT_BASE_PATH\s*=\s*['"]\/LootLingua['"]/);
});

test('published content module is loaded without adding a dependency', () => {
  assert.match(
    htmlSource,
    /<script type="module" src="js\/published-content\.js\?v=[^"]+"><\/script>/
  );
  assert.match(htmlSource, /<script src="js\/word-list-data\.js\?v=[^"]+"><\/script>/);
  assert.match(htmlSource, /<script src="js\/worlds\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(apiSource, /firebase-functions|cloudfunctions|functions\//i);
});

test('deep published routes resolve local assets from the application root', () => {
  const headScript = htmlSource.match(
    /<script>\s*(\(function \(location, document\)[\s\S]*?)<\/script>/
  )?.[1];
  assert.ok(headScript, 'The early route/base script must exist.');
  assert.ok(
    htmlSource.indexOf('document.head.appendChild(assetBase)') <
      htmlSource.indexOf('href="style.css'),
    'The asset base must be installed before relative styles load.'
  );

  function runHeadScript(location) {
    const appended = [];
    const historyCalls = [];
    const documentObject = {
      head: {
        appendChild(element) {
          appended.push(element);
        },
      },
      createElement(tagName) {
        return { tagName: tagName.toUpperCase(), href: '' };
      },
    };
    const windowObject = {
      location,
      history: {
        state: null,
        replaceState(...args) {
          historyCalls.push(args);
        },
      },
    };
    vm.runInNewContext(headScript, {
      URLSearchParams,
      document: documentObject,
      window: windowObject,
    });
    return { appended, historyCalls };
  }

  const vercel = runHeadScript({
    hostname: 'lootlingua.vercel.app',
    pathname: '/worlds/world-a/ranks/rank-a/gates/gate-a',
    protocol: 'https:',
    origin: 'https://lootlingua.vercel.app',
    search: '',
    hash: '',
  });
  assert.equal(vercel.appended[0].href, '/');
  assert.equal(vercel.historyCalls.length, 0);

  const github = runHeadScript({
    hostname: 'example.github.io',
    pathname: '/LootLingua/',
    protocol: 'https:',
    origin: 'https://example.github.io',
    search: '?p=%2Fworlds%2Fworld-a%2Franks%2Frank-a',
    hash: '',
  });
  assert.equal(github.appended[0].href, '/LootLingua/');
  assert.equal(github.historyCalls[0][2], '/LootLingua/worlds/world-a/ranks/rank-a');
});

test('published gate UI exposes clear bidirectional page controls and counts', () => {
  const gateRender = sourceSection(
    worldsSource,
    'function renderPublishedGateWords',
    'function createPublishedWordPager'
  );
  const pageHandler = sourceSection(
    worldsSource,
    'async function loadPublishedWordPage',
    'function prepareWorldsShell'
  );
  assert.match(worldsSource, /function getPublishedWordPageMeta\(gate, snapshot\)/);
  assert.match(worldsSource, /Math\.ceil\(knownCount \/ pageSize\)/);
  assert.match(worldsSource, /`\$\{pageNumber\} \/ \$\{totalPages\}`/);
  assert.equal((gateRender.match(/makePublishedPagination\(/g) || []).length, 1);
  assert.doesNotMatch(gateRender, /published-pagination-top|'top'|'bottom'/);
  assert.match(pageHandler, /publishedContentState\.wordPager/);
  assert.match(pageHandler, /'loadPreviousPage' : 'loadNextPage'/);
  assert.match(pageHandler, /const task = pager\[method\]\(\)/);
  assert.match(pageHandler, /const result = await task/);
  assert.match(pageHandler, /publishedContentState\.wordSnapshot = result/);
  assert.match(pageHandler, /renderPublishedGateWords\([\s\S]*result/);
  assert.match(pageHandler, /document\.querySelector\('\.published-word-list'\)/);
  assert.match(worldsSource, /previous\.disabled = !page\.hasPrevious/);
  assert.match(worldsSource, /next\.disabled = !page\.hasNext/);
  assert.doesNotMatch(pageHandler, /adminPager|stagingPager|publishedContentState\.loading/);
});

test('published page totals do not count draft words as extra public pages', () => {
  const pageMetaSource = sourceSection(
    worldsSource,
    'function getPublishedWordPageMeta',
    'function makePublishedPagination'
  );
  const context = vm.createContext({});
  new vm.Script(`${pageMetaSource}; this.getMeta = getPublishedWordPageMeta;`)
    .runInContext(context);

  const ended = context.getMeta(
    { wordCount: 44 },
    {
      currentPageIndex: 0,
      pageSize: 25,
      currentPage: { items: Array.from({ length: 20 }), hasNext: false },
    }
  );
  assert.equal(ended.indicator, '1 / 1');
  assert.equal(ended.countLabel, '44 كلمة في البوابة · 20 منشورة حاليًا');

  const continuing = context.getMeta(
    { wordCount: 44 },
    {
      currentPageIndex: 0,
      pageSize: 25,
      currentPage: { items: Array.from({ length: 25 }), hasNext: true },
    }
  );
  assert.equal(continuing.indicator, '1 / 2');
});

test('world cards and tabs provide coarse-pointer feedback and animated navigation state', () => {
  assert.match(worldsSource, /const WORLDS_TOUCH_TARGET_SELECTOR/);
  assert.match(worldsSource, /'\.published-word-card'/);
  assert.match(worldsSource, /root\.addEventListener\('pointerdown'/);
  assert.match(worldsSource, /target\.classList\.add\('is-touch-pressed'\)/);
  assert.match(worldsSource, /target\.classList\.add\('is-touch-pop'\)/);
  assert.match(worldsSource, /tabs\.dataset\.activeTab = nextTab/);
  assert.match(worldsSource, /worlds-tab-panel-enter/);
  assert.match(worldsSource, /animatePublishedRouteChange/);
  assert.match(styleSource, /\.worlds-tabs::before/);
  assert.match(styleSource, /\.worlds-tabs\[data-active-tab="custom"\]::before/);
  assert.match(styleSource, /\.published-word-card\.is-touch-pressed/);
  assert.match(styleSource, /@keyframes worldsTouchPop/);
  assert.match(styleSource, /@keyframes worldsTabPanelEnter/);
});

test('published words reuse existing TTS and provide resilient themed visuals', () => {
  assert.match(worldsSource, /typeof window\.playGameSound === 'function'/);
  assert.match(worldsSource, /window\.playGameSound\(spokenWord, event\)/);
  assert.match(worldsSource, /sound\.disabled = !soundAvailable/);
  assert.match(worldsSource, /function getPublishedVisualFallback\(item, kind\)/);
  assert.match(worldsSource, /image\.addEventListener\('error', showFallback/);
  assert.match(worldsSource, /image\.alt = ''/);
  assert.match(worldsSource, /\\p\{Extended_Pictographic\}/);
  assert.match(worldsSource, /fa-solid fa-earth-americas/);
  assert.match(worldsSource, /published-card-visual-fallback/);
  assert.match(styleSource, /\.published-visual-games/);
  assert.match(styleSource, /\.published-word-sound\.is-speaking/);
  assert.match(styleSource, /\.published-word-actions/);
  assert.doesNotMatch(htmlSource, /ammar1\.png/);
});

test('Journey failures stay separate from Published Content state and retry only Journey', async () => {
  const errorStateSource = sourceSection(
    worldsSource,
    'function publishedJourneyErrorText',
    'async function startOrResumePublishedJourney'
  );
  const state = {
    world: { worldId: 'world-a' },
    rank: { rankId: 'rank-a' },
    gate: { gateId: 'gate-a' },
    journey: null,
    journeyError: null,
    error: null,
  };
  let retries = 0;
  const context = vm.createContext({ __state: state, __retry: () => { retries += 1; } });
  new vm.Script(`
    const publishedContentState = __state;
    ${errorStateSource}
    this.setJourneyError = setPublishedJourneyError;
    this.retryJourneyError = retryPublishedJourneyError;
  `).runInContext(context);

  const original = new Error('Missing or insufficient permissions.');
  original.code = 'permission-denied';
  original.operation = 'link-published-word-source-transaction';
  context.setJourneyError(original, 'fallback-operation', context.__retry, 'world-a');

  assert.equal(state.journeyError.code, 'permission-denied');
  assert.equal(state.journeyError.message, original.message);
  assert.equal(state.journeyError.stack, original.stack);
  assert.equal(state.journeyError.operation, original.operation);
  assert.equal(state.error, null);
  assert.equal(state.world.worldId, 'world-a');
  assert.equal(state.rank.rankId, 'rank-a');
  assert.equal(state.gate.gateId, 'gate-a');
  await context.retryJourneyError();
  assert.equal(retries, 1);
  assert.equal(state.journeyError, null);

  const missingDocument = new Error('Published gate document was not found.');
  missingDocument.code = 'not-found';
  context.setJourneyError(missingDocument, 'read-published-gate', null, 'world-a');
  assert.equal(state.journeyError.code, 'not-found');
  assert.equal(state.journeyError.message, missingDocument.message);
  assert.notEqual(state.journeyError.code, '404');
});

test('published presentation has compact words, polished states, and responsive navigation', () => {
  const publishedUi = sourceSection(
    worldsSource,
    'const publishedContentState = {',
    'function prepareWorldsShell'
  );
  const wordCard = sourceSection(
    worldsSource,
    'function makePublishedWordCard',
    'function getPublishedWordPageMeta'
  );
  assert.match(worldsSource, /published-skeleton-list/);
  assert.match(worldsSource, /published-hub-intro/);
  assert.match(worldsSource, /published-breadcrumb-separator/);
  assert.match(styleSource, /\.published-word-toolbar/);
  assert.match(styleSource, /\.published-word-card/);
  assert.match(styleSource, /\.worlds-view[\s\S]*--world-surface-radius: 20px/);
  assert.match(styleSource, /\.published-card[\s\S]*border-radius: var\(--world-surface-radius\)/);
  assert.match(styleSource, /\.world-card[\s\S]*border-radius: var\(--world-surface-radius\)/);
  assert.match(styleSource, /linear-gradient\(145deg/);
  assert.match(wordCard, /const content = publishedElement\('div', 'published-word-content'\)/);
  assert.match(wordCard, /content\.append\(identity\)/);
  assert.match(wordCard, /card\.append\(content, actions\)/);
  assert.match(wordCard, /wordText\.setAttribute\('dir', 'ltr'\)/);
  assert.match(wordCard, /translation\.setAttribute\('dir', 'rtl'\)/);
  assert.match(styleSource, /\.published-word-text[\s\S]*text-align: right/);
  assert.match(styleSource, /\.published-word-actions[\s\S]*grid-area: actions/);
  assert.doesNotMatch(publishedUi, /innerHTML/);
  assert.match(styleSource, /@media \(max-width: 640px\)/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(worldsSource, /ready: Object\.freeze\(\{ label: 'جاهزة للاجتياز'/);
  assert.match(worldsSource, /cleared: Object\.freeze\(\{ label: 'مكتملة'/);
  assert.match(worldsSource, /ready: 'ابدأ اختبار الاجتياز'/);
  assert.match(worldsSource, /cleared: 'راجع الكلمات'/);
  assert.match(styleSource, /\.published-journey-node\.is-ready[\s\S]*#f59e0b/);
  assert.match(styleSource, /\.published-journey-node\.is-cleared[\s\S]*var\(--success\)/);
  assert.match(styleSource, /\.published-gate-switcher-rail \{ display: none; \}/);
  assert.match(styleSource, /\.published-gate-switcher-select \{ display: block; \}/);
});

test('published pagination clicks replace items and return to the cached first page', async () => {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.className = '';
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this.disabled = false;
      this.type = '';
      this.classList = {
        add: (...tokens) => {
          const classes = new Set(this.className.split(/\s+/).filter(Boolean));
          tokens.forEach((token) => classes.add(token));
          this.className = [...classes].join(' ');
        },
        toggle: (token, force) => {
          const classes = new Set(this.className.split(/\s+/).filter(Boolean));
          const enabled = force === undefined ? !classes.has(token) : Boolean(force);
          if (enabled) classes.add(token);
          else classes.delete(token);
          this.className = [...classes].join(' ');
          return enabled;
        },
      };
    }

    append(...children) {
      this.children.push(...children);
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    }

    click() {
      if (this.disabled) return null;
      const event = {
        currentTarget: this,
        target: this,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.propagationStopped = true;
        },
      };
      for (const handler of this.listeners.get('click') || []) handler(event);
      return event;
    }
  }

  const documentObject = {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    querySelector: () => ({ scrollIntoView() {} }),
  };
  const windowObject = {
    matchMedia: () => ({ matches: true }),
    dispatchEvent: () => true,
  };
  const context = vm.createContext({
    window: windowObject,
    document: documentObject,
    console,
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    requestAnimationFrame: (callback) => callback(),
  });
  new vm.Script(wordListSource, { filename: 'word-list-data.published-click.js' })
    .runInContext(context);

  const firestoreQueries = [];
  const makeSnapshotDoc = (number) => ({
    id: `word-${number}`,
    data: () => ({
      word: `Word ${number}`,
      translation: `Meaning ${number}`,
      order: String(number - 1),
      status: 'published',
    }),
  });
  Object.assign(context, {
    getApps: () => [{}],
    getFirestore: () => ({}),
    collection: (parent, name) => ({
      path: parent?.path ? `${parent.path}/${name}` : name,
    }),
    doc: (parent, id) => ({ path: `${parent.path}/${id}`, id }),
    documentId: () => '__name__',
    where: (...values) => ({ type: 'where', values }),
    orderBy: (...values) => ({ type: 'orderBy', values }),
    startAfter: (...values) => ({ type: 'startAfter', values }),
    endBefore: (...values) => ({ type: 'endBefore', values }),
    limit: (value) => ({ type: 'limit', value }),
    limitToLast: (value) => ({ type: 'limitToLast', value }),
    query: (reference, ...constraints) => ({ reference, constraints }),
    getDoc: async () => ({ exists: () => false }),
    getDocs: async (querySpec) => {
      firestoreQueries.push(querySpec);
      const cursor = querySpec.constraints.find((item) => item.type === 'startAfter');
      const docs = cursor
        ? Array.from({ length: 19 }, (_, index) => makeSnapshotDoc(index + 26))
        : Array.from({ length: 26 }, (_, index) => makeSnapshotDoc(index + 1));
      return { docs };
    },
  });
  const executableApiSource = apiSource.replace(
    /import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];\s*/g,
    ''
  );
  new vm.Script(executableApiSource, { filename: 'published-content.behavior.js' })
    .runInContext(context);

  const pagerCalls = [];
  const publishedApi = windowObject.LootLinguaPublishedContent;
  const pager = windowObject.LootLinguaWordListData.createPagedWordSource({
    query: {
      sourceType: 'published-gate-words',
      worldId: 'world-a',
      rankId: 'rank-a',
      gateId: 'gate-a',
      sort: 'order',
      filters: { status: 'published' },
      pageSize: 25,
    },
    pageSize: 25,
    maxCachedPages: 3,
    getItemId: (item) => item.contentWordId,
    fetchPage: async (request) => {
      pagerCalls.push(request);
      return publishedApi.listPublishedGateWords('world-a', 'rank-a', 'gate-a', request);
    },
  });
  const initialSnapshot = await pager.loadInitialPage();
  const state = {
    wordPager: pager,
    wordSnapshot: initialSnapshot,
    wordPageRequest: null,
    generation: 1,
    world: { worldId: 'world-a' },
    rank: { rankId: 'rank-a' },
    gate: { gateId: 'gate-a' },
  };
  const renders = [];
  Object.assign(context, {
    __state: state,
    __renders: renders,
  });

  const helpers = sourceSection(
    worldsSource,
    'function publishedElement',
    'function setPublishedTabState'
  );
  const pagination = sourceSection(
    worldsSource,
    'function makePublishedPagination',
    'function renderPublishedGateWords'
  );
  const handler = sourceSection(
    worldsSource,
    'async function loadPublishedWordPage',
    'function prepareWorldsShell'
  );
  new vm.Script(`
    const publishedContentState = __state;
    function renderPublishedGateWords(_world, _rank, _gate, snapshot) {
      __renders.push(snapshot);
    }
    function logPublishedContentError() {}
    function renderPublishedError() {}
    ${helpers}
    ${pagination}
    ${handler}
  `, { filename: 'published-pagination-click.behavior.js' }).runInContext(context);

  context.__snapshot = state.wordSnapshot;
  let controls = new vm.Script(
    'makePublishedPagination(__snapshot, { indicator: "1 / 2" })'
  ).runInContext(context);
  let next = controls.children.find((item) => item.className?.includes('published-page-next'));
  let previous = controls.children.find((item) => item.className?.includes('published-page-previous'));
  assert.equal(next.disabled, false);
  assert.equal(previous.disabled, true);

  const nextEvent = next.click();
  assert.equal(nextEvent.defaultPrevented, true);
  assert.equal(nextEvent.propagationStopped, true);
  await state.wordPageRequest;
  assert.equal(state.wordSnapshot.currentPageIndex, 1);
  assert.equal(state.wordSnapshot.currentPage.items[0].contentWordId, 'word-26');
  assert.equal(renders.at(-1).currentPage.items[0].contentWordId, 'word-26');
  assert.equal(pagerCalls.at(-1).querySignature, state.wordSnapshot.querySignature);
  assert.deepEqual(
    { ...pagerCalls.at(-1).cursor },
    { order: '24', id: 'word-25' },
    'The exact Firestore cursor scalar type must reach the next-page query.'
  );
  const startAfterConstraint = firestoreQueries.at(-1).constraints.find(
    (item) => item.type === 'startAfter'
  );
  assert.deepEqual(
    [...startAfterConstraint.values],
    ['24', 'word-25'],
    'The next click must reach Firestore startAfter with the exact page-end cursor.'
  );

  context.__snapshot = state.wordSnapshot;
  controls = new vm.Script(
    'makePublishedPagination(__snapshot, { indicator: "2 / 2" })'
  ).runInContext(context);
  next = controls.children.find((item) => item.className?.includes('published-page-next'));
  previous = controls.children.find((item) => item.className?.includes('published-page-previous'));
  assert.equal(next.disabled, true);
  assert.equal(previous.disabled, false);

  previous.click();
  await state.wordPageRequest;
  assert.equal(state.wordSnapshot.currentPageIndex, 0);
  assert.equal(state.wordSnapshot.currentPage.items[0].contentWordId, 'word-1');
  assert.equal(renders.at(-1).currentPage.items[0].contentWordId, 'word-1');
});
