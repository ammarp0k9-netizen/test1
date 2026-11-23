import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const [controller, entry, dictionary] = await Promise.all([
  readFile(new URL('../js/personal-dictionary-onboarding.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/dictionary.js', import.meta.url), 'utf8'),
]);

test('personal dictionary help stays independent and an old checkpoint resumes only by choice', () => {
  assert.match(controller, /lootlingua:personal-dictionary-onboarding:v1:/);
  assert.match(controller, /'awaiting-journey', 'intro', 'awaiting-first-word', 'completed'/);
  assert.match(controller, /lootlingua:guided-first-journey-change/);
  assert.match(controller, /currentJourneyCompleted\(\)/);
  assert.doesNotMatch(entry, /LootLinguaPersonalDictionaryOnboarding\?\.planForFirstJourney/);
  assert.match(controller, /if \(fullTourRequested\) renderStep\(\);\s+else offerResume\(state\)/);
});

test('guest first-word completion listens only for a persisted dictionary save', () => {
  assert.match(dictionary, /saveAndRender\(\);[\s\S]*?lootlingua:dictionary-word-saved/);
  assert.match(dictionary, /savedWord && window\.words\?\.some/);
  assert.match(controller, /firstWordSavedAt: Date\.now\(\), step: 4/);
  assert.match(controller, /persistent: true/);
});

test('guest-to-account hand-off moves only the separate dictionary step', () => {
  assert.match(controller, /migrateGuestState\(\)/);
  assert.match(controller, /localStorage\.removeItem\(key\('guest'\)\)/);
  assert.doesNotMatch(controller, /FeatureDiscovery/);
});
