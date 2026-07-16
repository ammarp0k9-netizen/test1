import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
await import('../js/content-schema.js');

const schema = globalThis.LootLinguaContentSchema;

function word(overrides = {}) {
  return {
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: 'gate_1',
    contentWordId: 'word_1',
    word: 'Sword',
    translation: 'سيف',
    status: 'draft',
    ...overrides,
  };
}

function hasIssue(result, code) {
  return result.errors.concat(result.warnings).some((issue) => issue.code === code);
}

function assertNoUndefined(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.notEqual(item, undefined, `undefined at ${path}.${key}`);
    assertNoUndefined(item, `${path}.${key}`);
  }
}

test('Word has a strict versioned schema and derives central identity', () => {
  const cleaned = schema.cleanWord(word({
    word: '  Sword  ',
    normalizedWord: 'sword',
    wordKey: 'sword',
  }));
  assert.equal(cleaned.version, 1);
  assert.equal(cleaned.word, 'Sword');
  assert.equal(cleaned.normalizedWord, 'sword');
  assert.equal(cleaned.wordKey, 'sword');
  assert.equal(cleaned.normalizationVersion, schema.normalizationVersion);
  assertNoUndefined(cleaned);
});

test('Word accepts all product fields with bounded clean arrays and safe URLs', () => {
  const result = schema.validateWord(word({
    definition: 'A bladed weapon',
    definition_ar: 'سلاح ذو نصل',
    example: 'The knight raised a sword.',
    exampleTranslation: 'رفع الفارس سيفًا.',
    category: 'Equipment',
    partOfSpeech: 'noun',
    level: 'A2',
    tags: ['Weapon', ' weapon ', 'Medieval'],
    synonyms: ['Blade', ' blade '],
    pronunciation: '/sɔːrd/',
    audioUrl: 'https://cdn.example.test/sword.mp3',
    imageUrl: '/assets/sword.webp',
    notes: 'Admin note',
    order: 9,
    status: 'published',
    version: 7,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.version, 7);
  assert.deepEqual(result.value.tags, ['Weapon', 'Medieval']);
  assert.deepEqual(result.value.synonyms, ['Blade']);
  assert.equal(hasIssue(result, 'duplicate_array_item'), true);
  assertNoUndefined(result.value);
});

test('Word rejects missing required fields, forged identity, and unsafe versions', () => {
  assert.equal(schema.validateWord(word({ word: '', translation: '' })).ok, false);
  assert.equal(schema.validateWord(word({ normalizedWord: 'forged' })).ok, false);
  assert.equal(schema.validateWord(word({ wordKey: 'forged' })).ok, false);
  for (const version of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER]) {
    assert.equal(schema.validateWord(word({ version })).ok, false, String(version));
  }
});

test('Word rejects undefined, HTML, control text, and unknown fields', () => {
  const undefinedValue = schema.validateWord(word({ notes: undefined }));
  assert.equal(hasIssue(undefinedValue, 'undefined_not_allowed'), true);
  const html = schema.validateWord(word({ definition: '<img src=x onerror=alert(1)>' }));
  assert.equal(hasIssue(html, 'html_not_allowed'), true);
  const control = schema.validateWord(word({ example: 'bad\u0001value' }));
  assert.equal(hasIssue(control, 'control_character'), true);
  const unknown = schema.validateWord(word({ trustedQuiz: true }));
  assert.equal(hasIssue(unknown, 'unknown_field'), true);
});

test('Word enforces array, text, and URL limits', () => {
  const tooManyTags = Array.from({ length: schema.LIMITS.tags + 1 }, (_, index) => `tag-${index}`);
  assert.equal(hasIssue(schema.validateWord(word({ tags: tooManyTags })), 'array_too_long'), true);
  assert.equal(hasIssue(schema.validateWord(word({ word: 'x'.repeat(schema.LIMITS.word + 1) })), 'too_long'), true);
  assert.equal(hasIssue(schema.validateWord(word({ audioUrl: 'http://example.test/a.mp3' })), 'unsafe_url_scheme'), true);
  assert.equal(hasIssue(schema.validateWord(word({ imageUrl: '../private/a.png' })), 'url_path_traversal'), true);
});

test('Word compaction keeps required version and identity without undefined values', () => {
  const compacted = schema.compactForStorage(schema.cleanWord(word({
    definition: '',
    tags: [],
    synonyms: [],
  })));
  assert.equal(compacted.version, 1);
  assert.equal(compacted.normalizedWord, 'sword');
  assert.equal(Object.hasOwn(compacted, 'definition'), false);
  assert.equal(Object.hasOwn(compacted, 'tags'), false);
  assertNoUndefined(compacted);
});
