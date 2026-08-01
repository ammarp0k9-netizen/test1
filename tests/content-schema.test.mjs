import assert from 'node:assert/strict';

globalThis.window = globalThis;
await import('../js/content-schema.js');

const schema = globalThis.LootLinguaContentSchema;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write('ok - ' + name + '\n');
  } catch (error) {
    process.stderr.write('not ok - ' + name + '\n');
    throw error;
  }
}

function baseWorld(overrides = {}) {
  return {
    worldId: 'world_1',
    slug: 'starter-world',
    title: 'Starter World',
    status: 'draft',
    ...overrides
  };
}

function baseRank(overrides = {}) {
  return {
    worldId: 'world_1',
    rankId: 'rank_1',
    title: 'Rank One',
    status: 'draft',
    ...overrides
  };
}

function baseGate(overrides = {}) {
  return {
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: 'gate_1',
    title: 'Gate One',
    status: 'draft',
    ...overrides
  };
}

function baseWord(overrides = {}) {
  return {
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: 'gate_1',
    contentWordId: 'word_1',
    word: 'Sword',
    translation: 'سيف',
    status: 'draft',
    ...overrides
  };
}

function hierarchy(words, overrides = {}) {
  return {
    format: 'lootlingua-content',
    schemaVersion: 1,
    normalizationVersion: 1,
    worlds: [{
      ...baseWorld({ status: 'published' }),
      ranks: [{
        ...baseRank({ status: 'published' }),
        gates: [{
          ...baseGate({ status: 'published' }),
          words
        }]
      }]
    }],
    ...overrides
  };
}

function hasCode(result, code) {
  return result.errors.concat(result.warnings).some((item) => item.code === code);
}

function assertNoUndefined(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoUndefined);
    return;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      assert.notEqual(value[key], undefined, 'undefined at key ' + key);
      assertNoUndefined(value[key]);
    });
  }
}

test('exports one frozen classic-IIFE API', () => {
  assert.equal(schema.schemaVersion, 1);
  assert.equal(schema.normalizationVersion, 1);
  assert.equal(Object.isFrozen(schema), true);
  assert.equal(Object.isFrozen(schema.START_RANK_COPY), true);
});

test('uses the required content and progress statuses', () => {
  assert.deepEqual(schema.CONTENT_STATUSES, ['draft', 'published', 'archived']);
  assert.deepEqual(
    schema.PROGRESS_STATUSES,
    ['locked', 'available', 'learning', 'ready', 'cleared']
  );
});

test('centralizes the fixed world-interest contract and keeps legacy worlds readable', () => {
  assert.deepEqual(schema.WORLD_INTEREST_IDS, [
    'games', 'movies', 'study', 'general', 'technology', 'travel'
  ]);
  assert.equal(schema.WORLD_INTEREST_UNKNOWN, 'unknown');
  assert.equal(Object.isFrozen(schema.WORLD_INTEREST_IDS), true);
  assert.equal(Object.isFrozen(schema.WORLD_INTEREST_META), true);

  const legacy = schema.cleanWorld(baseWorld());
  assert.equal(legacy.primaryInterest, 'unknown');
  assert.deepEqual(legacy.interestTags, []);
  assert.equal(schema.normalizeWorldInterest(), 'unknown');
  assert.equal(schema.normalizeWorldInterest('unrecognized'), 'unknown');
  assert.deepEqual(
    schema.normalizeWorldInterestTags(['technology', 'invalid', 'technology', 'travel']),
    ['technology', 'travel']
  );
});

test('validates primaryInterest and interestTags against the central IDs', () => {
  const classified = schema.cleanWorld(baseWorld({
    primaryInterest: 'games',
    interestTags: ['movies', 'technology', 'movies']
  }));
  assert.equal(classified.primaryInterest, 'games');
  assert.deepEqual(classified.interestTags, ['movies', 'technology']);

  const invalidPrimary = schema.validateWorld(baseWorld({ primaryInterest: 'sports' }));
  assert.equal(invalidPrimary.ok, false);
  assert.equal(hasCode(invalidPrimary, 'invalid_enum'), true);

  const invalidTags = schema.validateWorld(baseWorld({ interestTags: ['travel', 'sports'] }));
  assert.equal(invalidTags.ok, false);
  assert.equal(hasCode(invalidTags, 'invalid_world_interest'), true);

  const tooManyTags = schema.validateWorld(baseWorld({
    interestTags: [...schema.WORLD_INTEREST_IDS, 'games']
  }));
  assert.equal(tooManyTags.ok, false);
  assert.equal(hasCode(tooManyTags, 'array_too_long'), true);
});

test('centralizes the official CEFR rank field and keeps old ranks unclassified', () => {
  assert.deepEqual(schema.CEFR_LEVELS, [
    'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'unclassified'
  ]);
  assert.equal(schema.cleanRank(baseRank()).cefrLevel, 'unclassified');
  assert.equal(schema.cleanRank(baseRank({ cefrLevel: 'B2' })).cefrLevel, 'B2');
  assert.throws(
    () => schema.cleanRank(baseRank({ cefrLevel: 'beginner' })),
    (error) => error instanceof schema.SchemaValidationError
  );
});

test('sorts ranks by CEFR, then stored order, then stable rank ID', () => {
  const ranks = [
    baseRank({ rankId: 'a2-first', cefrLevel: 'A2', order: 0 }),
    baseRank({ rankId: 'a1-z', cefrLevel: 'A1', order: 9 }),
    baseRank({ rankId: 'a1-b', cefrLevel: 'A1', order: 2 }),
    baseRank({ rankId: 'a1-a', cefrLevel: 'A1', order: 2 }),
  ].sort(schema.comparePublishedRanks);
  assert.deepEqual(ranks.map((rank) => rank.rankId), [
    'a1-a', 'a1-b', 'a1-z', 'a2-first'
  ]);
});

test('groups classified and legacy ranks into separate ordered sections', () => {
  const groups = schema.groupRanksByCefrLevel([
    baseRank({ rankId: 'legacy' }),
    baseRank({ rankId: 'b1', cefrLevel: 'B1' }),
    baseRank({ rankId: 'a1', cefrLevel: 'A1' }),
  ]);
  assert.deepEqual(groups.get('A1').map((rank) => rank.rankId), ['a1']);
  assert.deepEqual(groups.get('B1').map((rank) => rank.rankId), ['b1']);
  assert.deepEqual(groups.get('unclassified').map((rank) => rank.rankId), ['legacy']);
});

test('keeps unlock decisions as manual placeholders only', () => {
  assert.deepEqual(schema.DEFAULT_UNLOCK_CONFIG, {
    mode: 'manual_placeholder',
    initialStatus: 'locked',
    requiredMasteredRatio: null,
    requiredReviewingRatio: null,
    requiredGateCount: null
  });
  const invalid = schema.validateRank(baseRank({
    unlockConfig: {
      mode: 'automatic',
      requiredMasteredRatio: 0.8
    }
  }));
  assert.equal(invalid.ok, false);
  assert.equal(hasCode(invalid, 'unlock_rule_not_decided'), true);
});

test('allows only manual locked or available initial presentation states', () => {
  const available = schema.validateRank(baseRank({
    unlockConfig: { mode: 'manual_placeholder', initialStatus: 'available' }
  }));
  assert.equal(available.ok, true);
  assert.equal(available.value.unlockConfig.initialStatus, 'available');

  const completed = schema.validateRank(baseRank({
    unlockConfig: { mode: 'manual_placeholder', initialStatus: 'completed' }
  }));
  assert.equal(completed.ok, false);
});

test('compacts optional empty values without removing explicit null placeholders', () => {
  assert.deepEqual(schema.compactForStorage({
    title: 'A',
    subtitle: '',
    tags: [],
    missing: undefined,
    unlockConfig: { mode: 'manual_placeholder', requiredMasteredRatio: null }
  }), {
    title: 'A',
    unlockConfig: { mode: 'manual_placeholder', requiredMasteredRatio: null }
  });
});

test('matches current normalizeWord behavior exactly', () => {
  const vectors = [
    ['', ''],
    ['  Sword  ', 'sword'],
    ['MULTI\t \n SPACE', 'multi space'],
    [' سَيْف ', 'سَيْف'],
    [0, ''],
    [false, '']
  ];
  for (const [input, expected] of vectors) {
    assert.equal(schema.normalizeWord(input), expected);
  }
});

test('matches current getWordMasteryKey behavior exactly', () => {
  assert.equal(schema.getWordMasteryKey('  Sword!! Shield  '), 'sword_shield');
  assert.equal(schema.getWordMasteryKey({ word: 'Hello, World!' }), 'hello_world');
  assert.equal(schema.getWordMasteryKey({ text: ' سيف / درع ' }), 'سيف_درع');
  assert.equal(schema.getWordMasteryKey('***'), '');
  const identity = schema.normalizeWordIdentity('  Sword!! Shield  ');
  assert.deepEqual(identity, {
    normalizedWord: 'sword!! shield',
    wordKey: 'sword_shield',
    normalizationVersion: 1
  });
});

test('cleans a valid word and derives identity instead of trusting input', () => {
  const result = schema.validateWord(baseWord({
    word: '  Sword  ',
    translation: '  سيف  ',
    tags: ['Weapon', 'weapon', ' noun '],
    synonyms: ['Blade', ' blade '],
    audioUrl: 'https://cdn.example.test/sword.mp3',
    imageUrl: '/assets/sword.png'
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.word, 'Sword');
  assert.equal(result.value.translation, 'سيف');
  assert.equal(result.value.normalizedWord, 'sword');
  assert.equal(result.value.wordKey, 'sword');
  assert.equal(result.value.normalizationVersion, 1);
  assert.deepEqual(result.value.tags, ['Weapon', 'noun']);
  assert.deepEqual(result.value.synonyms, ['Blade']);
  assert.equal(hasCode(result, 'duplicate_array_item'), true);
  assertNoUndefined(result.value);
});

test('rejects missing word or translation and mismatched derived identity', () => {
  const missing = schema.validateWord(baseWord({
    word: '',
    translation: ''
  }));
  assert.equal(missing.ok, false);
  assert.equal(hasCode(missing, 'required'), true);

  const mismatch = schema.validateWord(baseWord({
    normalizedWord: 'forged',
    wordKey: 'forged',
    normalizationVersion: 99
  }));
  assert.equal(mismatch.ok, false);
  assert.equal(hasCode(mismatch, 'derived_identity_mismatch'), true);
  assert.equal(hasCode(mismatch, 'unsupported_normalization_version'), true);
});

test('rejects HTML, DOM-like data, undefined, and unknown fields', () => {
  const html = schema.validateWord(baseWord({
    translation: '<img src=x onerror=alert(1)>'
  }));
  assert.equal(html.ok, false);
  assert.equal(hasCode(html, 'html_not_allowed'), true);

  const dom = schema.validateWorld(baseWorld({
    icon: { nodeType: 1, nodeName: 'DIV' }
  }));
  assert.equal(dom.ok, false);
  assert.equal(hasCode(dom, 'dom_not_allowed'), true);

  const unsafe = schema.validateSafeValue({ allowed: 1, forbidden: undefined });
  assert.equal(unsafe.ok, false);
  assert.equal(hasCode(unsafe, 'undefined_not_allowed'), true);

  const unknown = schema.validateWorld(baseWorld({ adminClaim: true }));
  assert.equal(unknown.ok, false);
  assert.equal(hasCode(unknown, 'unknown_field'), true);
});

test('accepts only safe HTTPS or local asset URLs', () => {
  assert.equal(schema.validateWord(baseWord({
    audioUrl: 'https://cdn.example.test/a.mp3',
    imageUrl: 'assets/a.png'
  })).ok, true);
  assert.equal(hasCode(schema.validateWord(baseWord({
    audioUrl: 'javascript:alert(1)'
  })), 'html_not_allowed'), true);
  assert.equal(hasCode(schema.validateWord(baseWord({
    imageUrl: 'http://example.test/a.png'
  })), 'unsafe_url_scheme'), true);
  assert.equal(hasCode(schema.validateWord(baseWord({
    imageUrl: '../private/a.png'
  })), 'url_path_traversal'), true);
});

test('validates world/rank/gate naming and metadata without id aliases leaking', () => {
  const world = schema.cleanWorld({ id: 'world_1', slug: 'world-one', title: ' World One ' });
  const rank = schema.cleanRank({ id: 'rank_1', title: ' Rank ', worldId: 'world_1' });
  const gate = schema.cleanGate({ id: 'gate_1', title: ' Gate ', worldId: 'world_1', rankId: 'rank_1' });
  assert.equal(world.worldId, 'world_1');
  assert.equal(rank.rankId, 'rank_1');
  assert.equal(gate.gateId, 'gate_1');
  assert.equal('id' in world, false);
  assert.equal('id' in rank, false);
  assert.equal('id' in gate, false);
});

test('keeps Rank version and cached counters as safe system fields', () => {
  const createdShape = schema.cleanRank(baseRank());
  assert.equal(createdShape.version, 1);
  assert.equal(createdShape.gateCount, 0);
  assert.equal(createdShape.wordCount, 0);

  const storedShape = schema.validateRank(baseRank({
    version: 7,
    gateCount: 4,
    wordCount: 80,
    createdAt: '2026-07-15T08:00:00.000Z',
    updatedAt: '2026-07-15T09:00:00.000Z',
    createdBy: 'admin_1',
    updatedBy: 'admin_2'
  }));
  assert.equal(storedShape.ok, true);
  assert.equal(storedShape.value.version, 7);
  assert.equal(storedShape.value.gateCount, 4);
  assert.equal(storedShape.value.wordCount, 80);
  assert.equal(storedShape.value.createdBy, 'admin_1');
  assertNoUndefined(storedShape.value);

  for (const version of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER]) {
    const invalid = schema.validateRank(baseRank({ version }));
    assert.equal(invalid.ok, false, 'unsafe Rank version was accepted: ' + String(version));
  }
});

test('allows a Draft world without a slug but requires one when Published', () => {
  const draft = schema.cleanWorld({ worldId: 'draft_world', title: 'Draft World', status: 'draft' });
  assert.equal(draft.slug, '');
  const published = schema.validateWorld({
    worldId: 'published_world',
    title: 'Published World',
    status: 'published'
  });
  assert.equal(published.ok, false);
  assert.equal(hasCode(published, 'required'), true);
});

test('throws a typed validation error from strict cleaners', () => {
  assert.throws(
    () => schema.cleanWord(baseWord({ translation: '' })),
    (error) => error && error.name === 'LootLinguaContentSchemaValidationError' &&
      Array.isArray(error.diagnostics)
  );
});

test('dry-runs a complete hierarchy without mutating it', () => {
  const input = hierarchy([
    baseWord({ status: 'published' }),
    baseWord({
      contentWordId: 'word_2',
      word: 'Shield',
      translation: 'درع',
      status: 'published'
    })
  ]);
  const before = JSON.stringify(input);
  const result = schema.dryRunImport(input);
  assert.equal(result.ok, true);
  assert.equal(result.canCommit, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.stats, { worlds: 1, ranks: 1, gates: 1, words: 2 });
  assert.equal(result.value.worlds[0].rankCount, 1);
  assert.equal(result.value.worlds[0].gateCount, 1);
  assert.equal(result.value.worlds[0].wordCount, 2);
  assert.equal(result.value.worlds[0].ranks[0].wordCount, 2);
  assert.equal(result.value.worlds[0].ranks[0].gates[0].wordCount, 2);
  assert.equal(JSON.stringify(input), before);
  assertNoUndefined(result.value);
});

test('accepts JSON text but never performs a write', () => {
  const result = schema.dryRunImport(JSON.stringify(hierarchy([
    baseWord({ status: 'published' })
  ])));
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(typeof result.commit, 'undefined');
});

test('blocks duplicate normalized words inside one gate', () => {
  const result = schema.dryRunImport(hierarchy([
    baseWord(),
    baseWord({
      contentWordId: 'word_2',
      word: ' sword ',
      translation: 'نصل'
    })
  ]));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, 'duplicate_word_in_gate'), true);
  assert.equal(result.duplicates.some((item) => item.scope === 'gate'), true);
});

test('warns about rank/world duplicate identity without inventing unlock logic', () => {
  const input = hierarchy([]);
  input.worlds[0].ranks[0].gates = [
    {
      ...baseGate({ gateId: 'gate_1' }),
      words: [baseWord({ gateId: 'gate_1' })]
    },
    {
      ...baseGate({ gateId: 'gate_2' }),
      words: [baseWord({ gateId: 'gate_2', contentWordId: 'word_2' })]
    }
  ];
  const result = schema.dryRunImport(input);
  assert.equal(result.ok, true);
  assert.equal(hasCode(result, 'duplicate_word_in_rank'), true);
  assert.equal(result.value.worlds[0].ranks[0].unlockConfig.mode, 'manual_placeholder');
});

test('reports document and normalized-word collisions against existing content', () => {
  const current = hierarchy([baseWord()]);
  const incoming = hierarchy([baseWord()]);
  const result = schema.dryRunImport(incoming, { existing: current });
  assert.equal(result.ok, false);
  assert.equal(result.collisions.some((item) => item.kind === 'world_id'), true);
  assert.equal(result.collisions.some((item) => item.kind === 'content_word_id'), true);
  assert.equal(result.collisions.some((item) => item.kind === 'word_identity'), true);
});

test('deduplicates content sources by the complete hierarchy identity', () => {
  const source = {
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: 'gate_1',
    contentWordId: 'word_1'
  };
  const other = { ...source, gateId: 'gate_2' };
  assert.deepEqual(schema.mergeContentSources([source], [source, other]), [source, other]);
});

test('centralizes safe start-rank wording without XP or mastery claims', () => {
  assert.equal(schema.START_RANK_COPY.actionLabel, 'ابدأ الرتبة');
  assert.equal(
    schema.START_RANK_COPY.description,
    'ستنضم جميع كلمات هذه الرتبة إلى رحلة مراجعتك تدريجيًا.'
  );
  const copy = JSON.stringify(schema.START_RANK_COPY);
  assert.equal(copy.includes('XP'), false);
  assert.equal(copy.includes('إتقان'), false);
  assert.equal(copy.includes('فتح كل البوابات'), false);
});

process.stdout.write('# ' + passed + ' content-schema tests passed\n');
