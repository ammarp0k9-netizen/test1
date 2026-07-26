import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/admin-cloud.js', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Missing ${startMarker} section.`);
  return source.slice(start, end);
}

const createSection = section('async function createWord(', 'async function updateWord(');
assert.match(createSection, /await runTransaction\(db/);
assert.match(createSection, /transaction\.get\(wordReference\)/);
assert.doesNotMatch(createSection, /transaction\.get\(worldReference\)|transaction\.get\(rankReference\)|transaction\.get\(gateReference\)/);
assert.doesNotMatch(createSection, /transaction\.update\(/);
assert.match(createSection, /transaction\.set\(wordReference, saved\)/);
assert.match(createSection, /void incrementWordCountersBestEffort\(/);
assert.ok(
  createSection.indexOf('void incrementWordCountersBestEffort') > createSection.indexOf('await runTransaction'),
  'Counter work must start only after the word transaction resolves.'
);

const counterSection = section('async function incrementWordCountersBestEffort(', 'function wordRecord(');
assert.match(counterSection, /Promise\.allSettled/);
assert.match(counterSection, /wordCount: increment\(1\)/);
assert.match(counterSection, /console\.warn/);
assert.doesNotMatch(counterSection, /throw /);

const gateDuplicateSection = section('async function findGateWordDuplicate(', 'function assertStoredWorld(');
assert.match(gateDuplicateSection, /await deriveContentWordId\(normalizedWord, 1\)/);
assert.match(gateDuplicateSection, /await getDoc\(doc\(/);
assert.match(gateDuplicateSection, /wordsCollection\(worldId, rankId, gateId\)/);
assert.doesNotMatch(gateDuplicateSection, /collectionGroup|getDocs|query\(/);
assert.doesNotMatch(source, /collectionGroup\(/);

const inspectSection = section('async function inspectWordDuplicates(', 'async function createWord(');
assert.match(inspectSection, /findGateWordDuplicate/);

assert.doesNotMatch(createSection, /findGateWordDuplicate|collectionGroup/);

const bulkSection = section('async function bulkSetWordStatus(', 'async function duplicateWord(');
assert.match(bulkSection, /await runTransaction\(db/);
assert.match(bulkSection, /existing\.version !== item\.expectedVersion/);
assert.match(bulkSection, /transaction\.set\(reference, saved\)/);

const publishSection = section('async function bulkPublishWords(', 'async function bulkArchiveWords(');
const archiveSection = section('async function bulkArchiveWords(', 'async function bulkMoveWords(');
assert.match(publishSection, /bulkSetWordStatus\(worldId, rankId, gateId, 'published', items\)/);
assert.match(archiveSection, /bulkSetWordStatus\(worldId, rankId, gateId, 'archived', items\)/);
assert.doesNotMatch(publishSection + archiveSection, /bulkWordOperation/);
assert.doesNotMatch(source, /LootLinguaAdminWordTransactionDebug|logCreateWordTransactionDiagnostic/);

console.log('Admin Word writes are decoupled from counters, counter updates are best-effort, and bulk status uses Firestore.');
