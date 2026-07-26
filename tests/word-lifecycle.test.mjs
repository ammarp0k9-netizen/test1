import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [schemaSource, lifecycleSource, cloudSource, dictionarySource, worldsSource] = await Promise.all([
  readFile(new URL('../js/content-schema.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/word-lifecycle.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/dictionary.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
]);

const root = {};
const context = vm.createContext({
  window: root,
  globalThis: root,
  Object,
  String,
  Boolean,
  Number,
  Array,
  Set,
  Map,
});
vm.runInContext(schemaSource, context);
vm.runInContext(lifecycleSource, context);
const lifecycle = root.LootLinguaWordLifecycle;

test('one normalized wordKey identifies manual and published copies', () => {
  assert.equal(lifecycle.wordKeyOf('  Is  '), 'is');
  assert.equal(lifecycle.wordKeyOf({ word: 'IS', wordKey: 'is' }), 'is');
  const found = lifecycle.findUserWordByKey([{ id: 'legacy-a', text: 'is' }], { word: 'IS' });
  assert.equal(found.id, 'legacy-a');
});

test('legacy words without visibility fields remain visible', () => {
  const oldWord = { word: 'legacy', meaning: 'قديم' };
  assert.equal(lifecycle.isVisibleInDictionaryList(oldWord), true);
  assert.equal(lifecycle.isHiddenFromDictionary(oldWord), false);
});

test('hidden words leave the list but remain eligible for quiz and SRS', () => {
  const hidden = {
    word: 'journey',
    meaning: 'رحلة',
    hiddenFromDictionary: true,
    mastery_status: 'Reviewing',
  };
  assert.equal(lifecycle.isVisibleInDictionaryList(hidden), false);
  assert.equal(lifecycle.isEligibleForPersonalDictionaryQuiz(hidden), true);
  assert.equal(lifecycle.isEligibleForSrsReview(hidden), true);
});

test('journey linkage is derived only from actual source references', () => {
  const decoratedWord = { category: 'A1', tags: ['journey'] };
  assert.equal(lifecycle.summarizeSources([decoratedWord]).hasJourneySource, false);
  const summary = lifecycle.summarizeSources([
    { addedFrom: 'manual' },
    { addedFrom: 'published-gate', worldId: 'world-a', gateId: 'gate-a' },
    { addedFrom: 'level-placement', assessmentId: 'assessment-a' },
  ]);
  assert.equal(summary.hasJourneySource, true);
  assert.equal(summary.journeySources.length, 2);
});

test('aggregate results distinguish every lifecycle outcome and hidden preservation', () => {
  const summary = lifecycle.emptySummary();
  [
    { status: 'created' },
    { status: 'restored' },
    { status: 'source-linked', hiddenPreserved: true },
    { status: 'already-linked' },
    { status: 'updated-missing-fields' },
    { status: 'failed' },
  ].forEach((result) => lifecycle.addResultToSummary(summary, result));
  assert.deepEqual(
    { ...summary },
    {
      created: 1,
      restored: 1,
      sourceLinked: 1,
      alreadyLinked: 1,
      updatedMissingFields: 1,
      failed: 1,
      hiddenPreserved: 1,
    }
  );
});

test('all signed-in add paths delegate to the central lifecycle API', () => {
  assert.match(cloudSource, /async function upsertUserWordWithSource/);
  assert.match(cloudSource, /window\.saveWordToCloud[\s\S]*upsertUserWordWithSource/);
  assert.match(cloudSource, /saveCustomWorldWordToCloud[\s\S]*type: 'private-world'/);
  assert.match(dictionarySource, /type: 'dictionary-search'/);
  assert.match(worldsSource, /saveCustomWorldWordToCloud\(targetId/);
});

test('private world linking is atomic, deterministic, and non-destructive', () => {
  const privateSave = cloudSource.slice(
    cloudSource.indexOf('window.saveCustomWorldWordToCloud'),
    cloudSource.indexOf('window.updateCustomWorldWordInCloud')
  );
  const worldManage = worldsSource.slice(
    worldsSource.indexOf('window.applyWorldManageToTarget'),
    worldsSource.indexOf('window.openDeleteCustomWorldModal')
  );
  assert.match(privateSave, /privateWorldMembership: true/);
  assert.match(cloudSource, /function privateWorldMembershipId[\s\S]*deterministicUserWordId/);
  assert.match(cloudSource, /removePrivateSourceRef[\s\S]*removePrivateMembershipRef/);
  assert.doesNotMatch(privateSave, /Math\.random|setDoc\(doc\(db, "users"/);
  assert.doesNotMatch(worldManage, /deleteActiveWordFromCloud/);
  assert.doesNotMatch(worldManage, /deleteCustomWorldWordFromCloud/);
  assert.match(worldManage, /sourceCustomWorldId[\s\S]*removeSourceMembership/);
  assert.match(worldManage, /memberships-moved-atomically/);
});

test('Journey linkage survives an additional private-world source and its removal', () => {
  const linked = lifecycle.summarizeSources([
    { sourceId: 'manual', addedFrom: 'manual' },
    { sourceId: 'published_w~r~g~word', addedFrom: 'published-gate' },
    { sourceId: 'private_world_notes', addedFrom: 'private-world' },
  ]);
  assert.equal(linked.hasJourneySource, true);
  assert.equal(linked.sources.length, 3);
  const afterMembershipRemoval = lifecycle.summarizeSources(
    linked.sources.filter((source) => source.addedFrom !== 'private-world')
  );
  assert.equal(afterMembershipRemoval.hasJourneySource, true);
  assert.equal(afterMembershipRemoval.sources.length, 2);
});

test('hide and restore update visibility only and never call reward hooks', () => {
  const visibilityBlock = cloudSource.slice(
    cloudSource.indexOf('async function setUserWordDictionaryVisibility'),
    cloudSource.indexOf('window.LootLinguaWordLifecycleCloud')
  );
  assert.match(visibilityBlock, /hiddenFromDictionary:/);
  assert.match(visibilityBlock, /hiddenFromDictionaryAt:/);
  assert.match(dictionarySource, /dictionary-restore:[\s\S]*runExclusive/);
  assert.doesNotMatch(visibilityBlock, /awardXP|markDailyQuest|recordChest|mastery_status|xpEconomyVersion/);
});

test('gate loading preserves hidden state and explicit search restore is separate', () => {
  assert.match(cloudSource, /hiddenPreserved: wasHidden && !restored/);
  assert.match(dictionarySource, /restoreHidden: true/);
  assert.match(worldsSource, /مخفية من قاموسك/);
  assert.match(worldsSource, /استعادة إلى القاموس/);
  assert.match(dictionarySource, /data\.local && !restore/);
});

test('ordinary deletion removes personal sources while Journey sources remain protected', () => {
  assert.match(cloudSource, /async function deletePersonalUserWord/);
  assert.match(cloudSource, /journey-delete-forbidden/);
  assert.match(cloudSource, /batch\.delete\(doc\(canonicalRef, 'sources'/);
  assert.match(dictionarySource, /sourceSummaryById/);
});

test('partial lifecycle retries keep successful IDs and retry pending items only', () => {
  assert.match(cloudSource, /sourceSnapshot\.exists\(\)/);
  assert.match(worldsSource, /result\.failures\.length/);
  assert.match(dictionarySource, /const failed = results\.filter/);
});

test('the lifecycle adds no Evidence, Ready, Gate Clear, XP, or Cloud Functions', () => {
  assert.doesNotMatch(lifecycleSource, /Evidence|Gate Clear|awardXP|httpsCallable|getFunctions/);
  assert.doesNotMatch(cloudSource.slice(
    cloudSource.indexOf('async function upsertUserWordWithSource'),
    cloudSource.indexOf('function loadCustomWorldsFromCloud')
  ), /awardXP|markDailyQuest|recordChest|httpsCallable|getFunctions/);
});
