import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [schemaSource, entryContractSource, worldsSource] = await Promise.all([
  readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-contract.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

class TestCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

const context = vm.createContext({
  window: { dispatchEvent() {} },
  CustomEvent: TestCustomEvent,
});
new vm.Script('function getPublishedContentApi() { return window.LootLinguaPublishedContent; }')
  .runInContext(context);
new vm.Script(schemaSource, { filename: 'content-schema.recommendations.js' }).runInContext(context);
new vm.Script(entryContractSource, { filename: 'entry-experience.recommendations.js' }).runInContext(context);
new vm.Script(sourceSection(
  worldsSource,
  'const PUBLISHED_WORLD_RECOMMENDATION_COPY',
  'function appendMetaChip'
), { filename: 'world-interest-recommendations.js' }).runInContext(context);

function recommendation(world, interestIds) {
  context.__world = world;
  context.__interestIds = interestIds;
  const result = new vm.Script(
    'getPublishedWorldRecommendation(__world, __interestIds)'
  ).runInContext(context);
  return JSON.parse(JSON.stringify(result));
}

test('entry and published content share the same central interest IDs', () => {
  assert.deepEqual(
    Array.from(context.window.LootLinguaContentSchema.WORLD_INTEREST_IDS),
    Array.from(context.window.LootLinguaEntryExperience.INTEREST_IDS)
  );
});

test('matches only a central primaryInterest ID', () => {
  assert.deepEqual(recommendation({
    primaryInterest: 'games',
    interestTags: ['technology'],
  }, ['games']), {
    kind: 'interest-match',
    label: 'مقترح حسب اهتماماتك',
    matchedInterestId: 'games',
  });
});

test('matches an exact central interestTags ID', () => {
  assert.deepEqual(recommendation({
    primaryInterest: 'study',
    interestTags: ['movies', 'travel'],
  }, ['travel']), {
    kind: 'interest-match',
    label: 'مقترح حسب اهتماماتك',
    matchedInterestId: 'travel',
  });
});

test('does not infer a recommendation from title, category, or partial text', () => {
  assert.deepEqual(recommendation({
    title: 'Games and gaming',
    category: 'games',
    primaryInterest: 'study',
    interestTags: ['technology'],
  }, ['games']), {
    kind: 'available',
    label: 'متاح حاليًا',
    matchedInterestId: '',
  });
  assert.equal(
    recommendation({ primaryInterest: 'movies' }, ['movie']).kind,
    'available'
  );
});

test('treats legacy and malformed classification as unknown without hiding the world', () => {
  assert.equal(recommendation({}, ['games']).kind, 'available');
  assert.equal(recommendation({ primaryInterest: 'unknown' }, ['games']).kind, 'available');
  assert.equal(recommendation({
    primaryInterest: 'sports',
    interestTags: ['invalid'],
  }, ['sports', 'games']).kind, 'available');
});

test('recommendation evaluation is read-only for worlds and selected interests', () => {
  const world = Object.freeze({
    primaryInterest: 'games',
    interestTags: Object.freeze(['travel']),
  });
  const selected = Object.freeze(['travel']);
  assert.equal(recommendation(world, selected).matchedInterestId, 'travel');
  assert.deepEqual(world, { primaryInterest: 'games', interestTags: ['travel'] });
  assert.deepEqual(selected, ['travel']);
});

test('uses the selected Entry interests after filtering them through the central IDs', () => {
  context.window.LootLinguaEntryExperienceController = {
    getState: () => ({
      interestsStatus: 'selected',
      interestIds: ['technology', 'invalid', 'technology', 'travel'],
    }),
  };
  assert.deepEqual(
    Array.from(new vm.Script('getPublishedViewerInterestIds()').runInContext(context)),
    ['technology', 'travel']
  );
  context.window.LootLinguaEntryExperienceController = {
    getState: () => ({ interestsStatus: 'skipped', interestIds: ['games'] }),
  };
  assert.deepEqual(
    Array.from(new vm.Script('getPublishedViewerInterestIds()').runInContext(context)),
    []
  );
});

test('keeps coming-soon copy honest when there is no exact match', () => {
  assert.deepEqual(recommendation({
    primaryInterest: 'study',
    comingSoon: true,
  }, ['games']), {
    kind: 'upcoming',
    label: '',
    matchedInterestId: '',
  });
});

test('renders badges without sorting, filtering, or mutating progress', () => {
  const renderSection = sourceSection(
    worldsSource,
    'function renderPublishedWorlds',
    'function makePublishedLevelSection'
  );
  const cardSection = sourceSection(
    worldsSource,
    'function makePublishedHierarchyCard',
    'function makePublishedJourneyPanel'
  );
  const recommendationSection = sourceSection(
    worldsSource,
    'const PUBLISHED_WORLD_RECOMMENDATION_COPY',
    'async function loadEntryWorldChoices'
  );
  assert.match(renderSection, /items\.forEach\(\(world\) =>/);
  assert.doesNotMatch(renderSection, /items\.(?:sort|filter)\(/);
  assert.match(renderSection, /getPublishedWorldRecommendation\(world, viewerInterestIds\)/);
  assert.match(cardSection, /published-meta-chip-recommendation/);
  assert.match(cardSection, /published-meta-chip-availability/);
  assert.doesNotMatch(recommendationSection, /localStorage|setDoc|updateDoc|Journey|progress/i);
});

test('Entry preview groups real published Gates under their Level without creating Journey progress', async () => {
  const calls = [];
  context.window.LootLinguaPublishedContent = {
    async listPublishedWorlds() {
      calls.push('worlds');
      return [
        { worldId: 'study', primaryInterest: 'study', title: 'Study', rankCount: 2, gateCount: 4 },
        { worldId: 'games', primaryInterest: 'games', title: 'Games', rankCount: 3, gateCount: 8 },
        { worldId: 'soon', primaryInterest: 'games', title: 'Soon', comingSoon: true },
      ];
    },
    async getPublishedWorld(worldId) {
      calls.push(`world:${worldId}`);
      return { worldId, title: 'Games' };
    },
    async listPublishedRanks(worldId) {
      calls.push(`ranks:${worldId}`);
      return [{ rankId: 'rank-a1', title: 'A1', cefrLevel: 'A1' }];
    },
    async listPublishedGates(worldId, rankId) {
      calls.push(`gates:${worldId}:${rankId}`);
      return [{ gateId: 'gate-a1', title: 'Gate' }];
    },
    async getPublishedRank(worldId, rankId) {
      calls.push(`rank:${worldId}:${rankId}`);
      return { rankId, title: 'A1' };
    },
    async getPublishedGate(worldId, rankId, gateId) {
      calls.push(`gate:${worldId}:${rankId}:${gateId}`);
      return { gateId, title: 'Gate' };
    },
  };

  const preview = context.window.LootLinguaWorldsEntryPreview;
  const choices = JSON.parse(JSON.stringify(await preview.loadWorldChoices(['games'])));
  assert.deepEqual(choices.map((world) => world.worldId), ['games', 'study']);
  assert.equal(choices[0].recommendation.kind, 'interest-match');

  const structure = JSON.parse(JSON.stringify(await preview.loadWorldStructure('games')));
  assert.equal(structure.world.worldId, 'games');
  assert.equal(structure.gates[0].gateId, 'gate-a1');
  assert.equal(structure.gates[0].cefrLevel, 'A1');
  assert.equal(structure.gates[0].rankId, 'rank-a1', 'Rank stays internal to the Gate reference.');

  const saved = JSON.parse(JSON.stringify(await preview.loadJourneyContext({
    worldId: 'games', activeRankId: 'rank-a1', activeGateId: 'gate-a1',
  })));
  assert.equal(saved.world.worldId, 'games');
  assert.equal(saved.rank.rankId, 'rank-a1');
  assert.equal(saved.gate.gateId, 'gate-a1');
  assert.deepEqual(calls, [
    'worlds',
    'world:games', 'ranks:games', 'gates:games:rank-a1',
    'world:games', 'rank:games:rank-a1', 'gate:games:rank-a1:gate-a1',
  ]);

  const previewSection = sourceSection(
    worldsSource,
    'async function loadEntryWorldChoices',
    'function appendMetaChip'
  );
  assert.doesNotMatch(previewSection, /setDoc|updateDoc|beginJourney|awardXP|gateProgress/i);
});
