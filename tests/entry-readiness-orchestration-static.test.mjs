import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [cloudSource, controllerSource, scriptSource, worldsSource] = await Promise.all([
  readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/script.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
]);

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : -1;
  assert.ok(start >= 0, `${name} must exist`);
  return source.slice(start, end > start ? end : source.length);
}

test('authenticated Entry waits for words, profile, and SRS mastery before classification', () => {
  assert.match(cloudSource, /beginInitialFeatureLoad\(\["words", "profile", "mastery"\]\)/);
  assert.match(cloudSource, /__lootlinguaMasterySnapshot\s*=\s*null/);
  assert.match(cloudSource, /markInitialFeatureLoadPartDone\?\.\('mastery'\)/);
  assert.match(controllerSource, /__lootlinguaMasterySnapshot\.entryCount/);
  assert.match(controllerSource, /__lootlinguaMasterySnapshot\.readFailed\s*===\s*true/);
  assert.match(controllerSource, /addEventListener\('lootlingua:word-mastery-snapshot'/);
});

test('Entry waits for JourneyCloud and passes its central destination to CTA resolution', () => {
  assert.match(controllerSource, /__lootlinguaAuthUser\s*&&\s*!root\.LootLinguaJourneyCloud/);
  assert.match(controllerSource, /resolveAccountJourneyDestination\(/);
  assert.match(controllerSource, /resumePausedLevelPlacement:\s*true/);
  assert.match(controllerSource, /journeyDestination:\s*learning\.journeyDestination/);
  assert.match(controllerSource, /addEventListener\('lootlingua:journey-cloud-ready'/);
  assert.match(controllerSource, /learning\.learningReadFailed/);
});

test('Worlds root and Product Entry consume the same account destination classification', () => {
  assert.match(controllerSource, /resolveAccountJourneyDestination\(/);
  assert.match(worldsSource, /readPublishedAccountJourneyDestination/);
  assert.match(worldsSource, /resolveAccountJourneyDestination\(/);
  assert.match(worldsSource, /accountDestination\.classification === 'actionable-journey'/);
  assert.match(controllerSource, /journeyDestination\?\.classification === 'actionable-journey'/);
});

test('theme intro decisions use the versioned once-only contract and persist through profile sync', () => {
  const intro = functionBlock(scriptSource, 'showThemeUseMessageOnce', 'bootstrapThemeNotificationKeysOnce');
  assert.match(intro, /resolveThemeIntro/);
  assert.match(intro, /!intro\.shouldAnnounce/);
  assert.match(intro, /localStorage\.setItem\(key, '1'\)/);
  assert.match(scriptSource, /themeIntroSeen:\s*getThemeIntroSeenList\(\)/);

  const oasisStart = scriptSource.indexOf('window.setProfileOasisMode = function');
  assert.ok(oasisStart >= 0, 'setProfileOasisMode must exist');
  const oasis = scriptSource.slice(oasisStart, oasisStart + 500);
  assert.doesNotMatch(oasis, /showThemeUseMessageOnce/);
});

test('Entry defers ordinary toasts and releases one preview instead of a completion storm', () => {
  const showToast = functionBlock(scriptSource, 'showToast', null).slice(0, 1800);
  assert.match(showToast, /__entryExperienceActive/);
  assert.match(showToast, /type !== 'danger'/);
  assert.match(showToast, /settings\.critical !== true/);
  assert.match(scriptSource, /const pending = deferred\.splice\(0, deferred\.length\)/);
  assert.match(scriptSource, /const first = pending\.find\(/);
  assert.doesNotMatch(scriptSource, /deferred\.forEach\([^)]*queue\.push/);
});
