import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [entrySource, worldsSource] = await Promise.all([
  readFile(new URL('../js/entry-experience-controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
]);

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Missing ${end}`);
  return source.slice(from, to);
}

test('Product Entry shows a Level-to-Gates preview with no Rank selector', () => {
  const structure = section(
    entrySource,
    '  function structureNodes(state) {',
    '  function gatePreviewMarkup(state) {'
  );
  assert.match(structure, /cefrLevel/);
  assert.match(structure, /بوابات مستوى/);
  assert.match(structure, /data-entry-preview-gate/);
  assert.doesNotMatch(structure, /data-entry-preview-rank/);
  assert.doesNotMatch(structure, /entry-route-rank/);
});

test('the Entry Gate preview forwards the Gate owner rankId only to the internal content API', () => {
  const preview = section(
    entrySource,
    '  async function inspectPreviewGate(gateId) {',
    '  function clearGamerGuide() {'
  );
  assert.match(preview, /selectedGate\?\.rankId/);
  assert.match(preview, /provider\.loadGatePreview/);
});

test('return and destination language presents World, Level, and Gate', () => {
  const returning = section(
    entrySource,
    '  function renderReturnJourney() {',
    '  function renderDestination() {'
  );
  assert.match(returning, /المستوى الحالي/);
  assert.doesNotMatch(returning, /الرتبة الحالية/);
  assert.match(entrySource, /عالم<\/span>[\s\S]*مستويات[\s\S]*بوابات/);
});

test('legacy Rank deep links collapse to the World surface', () => {
  const route = section(
    worldsSource,
    'window.loadPublishedContentRoute = function(route)',
    'window.openPublishedWorldsRoot'
  );
  assert.match(route, /legacy-rank-route/);
  assert.match(route, /key: 'world'/);
});
