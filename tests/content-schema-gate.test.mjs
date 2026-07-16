import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = globalThis;
await import('../js/content-schema.js');

const schema = globalThis.LootLinguaContentSchema;

function gate(overrides = {}) {
  return {
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: 'gate_1',
    title: 'Gate One',
    status: 'draft',
    ...overrides,
  };
}

function hasError(result, code) {
  return result.errors.some((error) => error.code === code);
}

test('centralizes immutable entry-assessment defaults independently from unlock placeholders', () => {
  assert.deepEqual(schema.ENTRY_ASSESSMENT_DEFAULTS, {
    passRatio: 0.75,
    assessmentVersion: 1,
  });
  assert.equal(Object.isFrozen(schema.ENTRY_ASSESSMENT_DEFAULTS), true);
  assert.deepEqual(schema.DEFAULT_UNLOCK_CONFIG, {
    mode: 'manual_placeholder',
    initialStatus: 'locked',
    requiredMasteredRatio: null,
    requiredReviewingRatio: null,
    requiredGateCount: null,
  });
});

test('Gate defaults to version 1 and a nullable assessment override', () => {
  const cleaned = schema.cleanGate(gate());
  assert.equal(cleaned.version, 1);
  assert.equal(cleaned.wordCount, 0);
  assert.equal(cleaned.entryAssessmentPassRatio, null);
  assert.equal(schema.resolveEntryAssessmentPassRatio(cleaned), 0.75);
  assert.equal(schema.resolveEntryAssessmentPassRatio(null), 0.75);
});

test('Gate accepts a finite assessment override greater than zero and at most one', () => {
  for (const ratio of [0.01, 0.75, 0.8, 1]) {
    const result = schema.validateGate(gate({ entryAssessmentPassRatio: ratio }));
    assert.equal(result.ok, true, `valid ratio rejected: ${ratio}`);
    assert.equal(result.value.entryAssessmentPassRatio, ratio);
    assert.equal(schema.resolveEntryAssessmentPassRatio(result.value), ratio);
  }
});

test('Gate rejects invalid assessment ratios and unsafe versions', () => {
  for (const ratio of [0, -0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, '0.8']) {
    const result = schema.validateGate(gate({ entryAssessmentPassRatio: ratio }));
    assert.equal(result.ok, false, `invalid ratio accepted: ${String(ratio)}`);
    assert.equal(
      hasError(result, 'assessment_ratio_out_of_range') || hasError(result, 'number_required'),
      true
    );
    assert.throws(() => schema.resolveEntryAssessmentPassRatio(ratio), RangeError);
  }

  for (const version of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER]) {
    assert.equal(schema.validateGate(gate({ version })).ok, false);
  }
});

test('Gate storage keeps explicit null and contains no undefined values', () => {
  const stored = schema.compactForStorage(schema.cleanGate(gate({
    entryAssessmentPassRatio: null,
  })));
  assert.equal(Object.hasOwn(stored, 'entryAssessmentPassRatio'), true);
  assert.equal(stored.entryAssessmentPassRatio, null);
  assert.equal(JSON.stringify(stored).includes('undefined'), false);
});
