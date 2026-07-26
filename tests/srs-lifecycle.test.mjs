import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [srs, lifecycle] = await Promise.all([
  readFile(new URL('../js/srs.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/word-lifecycle.js', import.meta.url), 'utf8'),
]);

test('SRS eligibility includes hidden learnable records', () => {
  assert.match(lifecycle, /function isEligibleForSrsReview[\s\S]*return hasLearnableContent/);
  assert.doesNotMatch(srs, /hiddenFromDictionary/);
});

test('visibility does not alter SRS transition or reward code', () => {
  assert.doesNotMatch(srs, /hiddenFromDictionary\s*=|hiddenFromDictionaryAt\s*=/);
});
