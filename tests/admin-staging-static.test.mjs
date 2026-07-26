import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const admin = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const cloud = readFileSync(new URL('../js/admin-cloud.js', import.meta.url), 'utf8');
const importer = readFileSync(new URL('../js/admin-word-import.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return source.slice(start, end);
}

test('staging is a separate admin collection with deterministic duplicate identity', () => {
  const importSection = section(cloud, 'async function importStagingWords(', 'async function listStagingWords(');
  assert.match(cloud, /collection\(db, 'content_word_import_staging'\)/);
  assert.match(importSection, /deriveStagingWordId/);
  assert.match(importSection, /transaction\.get/);
  assert.match(importSection, /state: 'duplicate-staging'/);
  assert.doesNotMatch(importSection, /worldId:|rankId:|gateId:/);
});

test('staging import shares parser and validation but does not call createWord', () => {
  const stagingCommit = section(importer, 'async function commitToStaging(', 'const API');
  assert.match(importer, /destination === 'staging'/);
  assert.match(stagingCommit, /settings\.importWords/);
  assert.doesNotMatch(stagingCommit, /createWord/);
  assert.match(admin, /importer\.commitToStaging/);
  assert.match(admin, /cloud\.importStagingWords/);
});

test('distribution rereads staging, creates through createWord, then deletes', () => {
  const distribution = section(cloud, 'async function distributeStagingWords(', 'async function listWords(');
  assert.match(distribution, /await getDoc\(reference\)/);
  assert.match(distribution, /created = await createWord\(/);
  assert.ok(
    distribution.lastIndexOf('await deleteDoc(reference)') > distribution.indexOf('created = await createWord'),
    'staging deletion must happen after prepared-word creation'
  );
  assert.match(distribution, /duplicate-word-in-gate/);
  assert.match(distribution, /distributed-pending-cleanup/);
  assert.match(distribution, /stagingStatus === 'distributed' && sameTarget/);
  assert.match(distribution, /stagingStatus === 'distributing' && sameTarget/);
  assert.match(distribution, /deriveContentWordId\(/);
  assert.match(distribution, /targetDocument\.data\(\)\.normalizedWord === staging\.normalizedWord/);
});

test('staging selection is explicit and page-scoped', () => {
  const render = section(admin, 'function renderStagingWords()', 'function renderCurrentView()');
  assert.match(admin, /selectedStagingIds: new Set\(\)/);
  assert.match(render, /ui\.stagingWords\.filter/);
  assert.match(render, /'select-staging-page'/);
  assert.doesNotMatch(admin, /select-all-staging-query|selectEntireQuery/);
});

test('staging rules are admin-only and reject prepared-content fields', () => {
  const stagingRules = section(
    rules,
    'match /content_word_import_staging/{stagingWordId}',
    '// Existing user paths'
  );
  assert.match(stagingRules, /allow read: if isAdmin\(\)/);
  assert.match(stagingRules, /allow create: if isAdmin\(\)/);
  assert.match(stagingRules, /allow update: if isAdmin\(\)/);
  assert.match(stagingRules, /allow delete: if isAdmin\(\)/);
  const validator = section(rules, 'function validStagingWord(', 'function validStagingCreate(');
  assert.doesNotMatch(validator, /'worldId'|'rankId'|'gateId'|'status'/);
});

test('implementation adds no new callable, library, innerHTML, XP, SRS, or Journey coupling', () => {
  const distribution = section(cloud, 'async function distributeStagingWords(', 'async function listWords(');
  assert.doesNotMatch(distribution, /httpsCallable|getFunctions|xp|srs|journey/i);
  assert.doesNotMatch(admin, /\.innerHTML\s*=/);
  assert.doesNotMatch(importer, /\.innerHTML\s*=/);
});
