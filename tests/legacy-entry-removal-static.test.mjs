import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const [
  indexSource,
  styleSource,
  runtimeSource,
  coreSource,
  scriptSource,
  dictionarySource,
  dictionaryRenderSource,
  xpSource,
  entryControllerSource,
] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('style.css', root), 'utf8'),
  readFile(new URL('js/core-runtime.js', root), 'utf8'),
  readFile(new URL('js/core.js', root), 'utf8'),
  readFile(new URL('js/script.js', root), 'utf8'),
  readFile(new URL('js/dictionary.js', root), 'utf8'),
  readFile(new URL('js/dictionary-render.js', root), 'utf8'),
  readFile(new URL('js/xp.js', root), 'utf8'),
  readFile(new URL('js/entry-experience-controller.js', root), 'utf8'),
]);

const legacyRuntimeSources = [
  runtimeSource,
  coreSource,
  scriptSource,
  dictionarySource,
  dictionaryRenderSource,
  xpSource,
].join('\n');

test('the app shell contains versioned Product Entry but no legacy onboarding or welcome DOM', () => {
  assert.match(indexSource, /id="entryExperienceRoot"/);
  assert.match(indexSource, /id="editInterestsBtn"/);
  assert.doesNotMatch(indexSource, /id="(?:onboardingBackdrop|onboardingBox|onboardingTooltip|onboardingExampleChips|welcomeModal|replayOnboardingBtn)"/);
  assert.doesNotMatch(indexSource, /(?:dismissWelcomeModal|handleOnboardingReplayClick)\s*\(/);
});

test('boot starts only the versioned Entry controller', () => {
  assert.match(runtimeSource, /LootLinguaEntryExperienceController\?\.init\(\)/);
  assert.doesNotMatch(runtimeSource, /\binitOnboarding\s*\(|\btryStartEmptyOnboarding\b|\bdismissWelcomeModal\b/);
});

test('legacy onboarding producers, listeners, timers, and replay entry points are removed', () => {
  const forbidden = [
    /\bONBOARDING_STEPS\b/,
    /\bONBOARDING_INTRO_QUEST_DEFS\b/,
    /\bEMPTY_ONBOARDING_COPY\b/,
    /\bemptyOnboardingState\b/,
    /\binitOnboarding\b/,
    /\bstartOnboarding\b/,
    /\btryStartEmptyOnboarding\b/,
    /\binitEmptyOnboardingInputWatcher\b/,
    /\bnotifyDictionaryWordAdded\b/,
    /\bsettleOnboardingAfterJsonImport\b/,
    /\bscheduleWelcomeModalIfNeeded\b/,
    /\bshowWelcomeModalOnce\b/,
    /\bdismissWelcomeModal\b/,
    /\bhandleOnboardingReplayClick\b/,
    /\bonboardingEvent\b/,
  ];
  forbidden.forEach((pattern) => assert.doesNotMatch(legacyRuntimeSources, pattern));
});

test('legacy onboarding CSS is deleted instead of merely hidden', () => {
  assert.doesNotMatch(styleSource, /(?:\.onboarding-|#onboarding|\.empty-onboarding-|\.welcome-modal|body\.onboarding-active|pulseOnboardingHighlight|emptyOnboardingFloat)/);
});

test('historical first-run markers are read only by Entry classification and never cleared', async () => {
  for (const marker of ['lootlinguaOnboarding', 'hasCompletedOnboarding', 'lootlingua_welcome_v1_seen']) {
    assert.match(entryControllerSource, new RegExp(`getItem\\(['"]${marker}['"]\\)`));
  }

  const jsFiles = (await readdir(new URL('js/', root)))
    .filter((name) => name.endsWith('.js'));
  const allJs = (await Promise.all(jsFiles.map((name) => readFile(new URL(`js/${name}`, root), 'utf8')))).join('\n');
  assert.doesNotMatch(allJs, /removeItem\s*\(\s*['"](?:lootlinguaOnboarding|hasCompletedOnboarding|lootlingua_welcome_v1_seen)['"]\s*\)/);
  assert.doesNotMatch(allJs, /setItem\s*\(\s*['"](?:lootlinguaOnboarding|hasCompletedOnboarding|lootlingua_welcome_v1_seen)['"]/);
});
