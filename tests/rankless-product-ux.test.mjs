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

test('Product Entry Discover links to the actual World list without preview selectors', () => {
  const discover = section(entrySource, '  function renderDiscover()', '  function render()');
  assert.match(discover, /data-entry-action="discover-worlds"/);
  assert.match(discover, /العوالم/);
  assert.doesNotMatch(discover, /data-entry-preview|entry-route-rank|data-entry-world/);
  const action = section(entrySource, '  async function handleAction(action)', '  function applyExplicitAppearance(state)');
  assert.match(action, /action === 'discover-worlds'[\s\S]*?await root\.loadWorldsView[\s\S]*?await commitTerminalState/);
});

test('rankId identifies the internal owner of an actual published gate', () => {
  const gate = section(worldsSource, 'window.openPublishedGate = function', 'window.resumePublishedLearning');
  assert.match(gate, /function\(worldId, rankId, gateId\)/);
  assert.match(gate, /worldId, rankId, gateId/);
  assert.doesNotMatch(gate, /entry-route-rank|data-entry-preview/);
});

test('a returning learner with progress resumes the actual published World', () => {
  const boot = section(entrySource, '  async function performBoot()', '  function rootElement()');
  assert.match(boot, /signals\.activeJourney\?\.worldId[\s\S]*?await root\.resumePublishedLearning\?\.\(signals\.activeJourney\.worldId\)/);
  assert.doesNotMatch(entrySource, /renderReturnJourney|renderDestination/);
});

test('legacy Rank deep links collapse to the World surface', () => {
  const route = section(
    worldsSource,
    'window.loadPublishedContentRoute = function(route, options)',
    'window.openPublishedWorldsRoot'
  );
  assert.match(route, /legacy-rank-route/);
  assert.match(route, /key: 'world'/);
});
