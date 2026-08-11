import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [contract, placement, cloud, worlds, published, admin, html, packageSource] = await Promise.all([
  readFile(new URL('../js/journey.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/placement.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/published-content.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
]);

test('journey cloud uses the prepared contentProgress hierarchy and one active pointer', () => {
  assert.match(cloud, /'contentProgress'/);
  assert.match(cloud, /ACTIVE_JOURNEY_META_ID = 'active_content_journey'/);
  assert.match(cloud, /'ranks'[\s\S]*'gates'/);
  assert.match(contract, /placementStatus/);
  assert.match(contract, /unlockedRankIds/);
  assert.match(contract, /unlockedGateIds/);
  assert.match(cloud, /createJourneySeed/);
});

test('starting a journey validates published content and initial access before writing', () => {
  assert.match(cloud, /assertPublished\(worldSnapshot/);
  assert.match(cloud, /assertInitiallyAvailable\(rankData/);
  assert.doesNotMatch(cloud, /assertInitiallyAvailable\(gateData/);
  assert.match(cloud, /runTransaction\(db/);
  assert.match(cloud, /status: 'paused'/);
  assert.match(cloud, /status: 'active'/);
});

test('gate loading reads every public page and never depends on the visible 25-word page', () => {
  assert.match(published, /async function listAllPublishedGateWords/);
  assert.match(published, /while \(pageCount < 100\)/);
  assert.match(published, /cursor = page\.endCursor/);
  assert.match(cloud, /listAllPublishedGateWords\(worldId, rankId, gateId\)/);
  assert.doesNotMatch(cloud, /wordSnapshot|wordPager/);
});

test('word linking is idempotent and preserves an existing personal SRS record', () => {
  assert.match(cloud, /if \(!sourceSnapshot\.exists\(\)\)/);
  assert.match(cloud, /const legacyProjectionPending = !legacySnapshot\.exists\(\)/);
  assert.match(cloud, /if \(result\.legacyProjectionPending && result\.legacyProjection\)/);
  assert.match(cloud, /if \(snapshot\.exists\(\)\) return;/);
  assert.match(cloud, /missingEducationalWordPatch/);
  assert.match(cloud, /USER_WORD_EDUCATIONAL_FIELDS/);
  assert.match(cloud, /mastery_status: 'New'/);
  assert.match(cloud, /loadedContentWordIds/);
  assert.match(cloud, /deterministic-source-docs-v1/);
  assert.doesNotMatch(cloud, /updateDoc\([^)]*words/);
});

test('source references contain full hierarchy identity and are create-once', () => {
  [
    'worldId',
    'rankId',
    'gateId',
    'contentWordId',
    'addedFrom',
    'linkedAt',
  ].forEach((field) => assert.match(cloud, new RegExp(`\\b${field}\\b`)));
  assert.match(cloud, /const addedFrom = String\(options\?\.sourceType \|\| 'published-gate'\)/);
  assert.match(cloud, /addedFrom,/);
  assert.match(cloud, /core\(\)\.contentSourceId\(source\)/);
  assert.match(cloud, /allWords\.length > MAX_LOADED_WORD_IDS/);
  assert.match(cloud, /placementAssessmentId/);
  assert.match(cloud, /placementSeenAt/);
});

test('partial gate loads remain retryable and learning is written only after full success', () => {
  assert.match(cloud, /failures\.push/);
  assert.match(cloud, /if \(!failures\.length\)/);
  assert.match(cloud, /if \(failures\.length && completed === 0\) throw firstFailure/);
  assert.match(cloud, /partial: failures\.length > 0/);
  assert.match(worlds, /تمت معالجة \$\{result\.completed\} من \$\{result\.total\}/);
  assert.match(worlds, /إعادة المحاولة/);
});

test('a loaded learning gate continues to the quiz page', () => {
  const learningActions = worlds.slice(
    worlds.indexOf("} else if (state === 'learning')"),
    worlds.indexOf("} else if (state === 'ready')")
  );
  assert.match(learningActions, /متابعة التعلم/);
  assert.match(learningActions, /window\.loadQuizView\(\)/);
  assert.doesNotMatch(learningActions, /window\.loadPersonalDictionary\(\)/);
});

test('Journey preserves the original Firestore failure and identifies its operation', () => {
  const errorHelpers = cloud.slice(
    cloud.indexOf('function journeyCloudError'),
    cloud.indexOf('function requireServices')
  );
  const context = vm.createContext({});
  new vm.Script(`${errorHelpers}; this.wrap = journeyOperationError;`)
    .runInContext(context);
  const original = new Error('Missing or insufficient permissions.');
  original.code = 'permission-denied';
  const wrapped = context.wrap(
    original,
    'link-published-word-source-transaction',
    { contentWordId: 'word-hash', wordKey: 'i' }
  );
  assert.equal(wrapped.code, 'permission-denied');
  assert.equal(wrapped.message, original.message);
  assert.equal(wrapped.stack, original.stack);
  assert.equal(wrapped.operation, 'link-published-word-source-transaction');
  assert.equal(wrapped.contentWordId, 'word-hash');
  assert.equal(wrapped.wordKey, 'i');
  assert.match(cloud, /journey\/no-published-words/);
  assert.match(cloud, /read-all-published-gate-words/);
});

test('Journey source linking reports the exact failed transaction without clearing published data', () => {
  const linkBlock = cloud.slice(
    cloud.indexOf('async function linkPublishedWord'),
    cloud.indexOf('async function listAllGateWords')
  );
  const resumeBlock = worlds.slice(
    worlds.indexOf('async function maybeRenderPublishedPlacementResume'),
    worlds.indexOf('function publishedElement')
  );
  assert.match(linkBlock, /link-published-word-source-transaction/);
  assert.match(linkBlock, /wordKey: identity\.wordKey/);
  assert.match(resumeBlock, /setPublishedJourneyError/);
  assert.match(resumeBlock, /return false/);
  assert.doesNotMatch(resumeBlock, /renderPublishedError/);
});

test('journey loading does not award XP or touch quests, streaks, or chests', () => {
  assert.doesNotMatch(cloud, /awardXP|markDailyQuest|recordChest|dailyStreak|showXPBadge/);
  assert.doesNotMatch(cloud, /httpsCallable|getFunctions|firebase-functions|functions\//);
});

test('published UI displays lock, load, learning, and new-word synchronization states', () => {
  assert.match(worlds, /published-card-journey-\$\{journeyState\}/);
  assert.match(worlds, /أكمل البوابة السابقة لفتحها/);
  assert.match(worlds, /تحميل البوابة/);
  assert.match(worlds, /متابعة التعلم/);
  assert.match(worlds, /توجد كلمات جديدة في هذه البوابة/);
  assert.match(worlds, /مزامنة الكلمات الجديدة/);
  assert.doesNotMatch(worlds, /from "https:\/\/www\.gstatic\.com\/firebasejs/);
});

test('Admin exposes initial availability for ranks only', () => {
  const initialStatusMatches = admin.match(/name:\s*'initialStatus'/g) || [];
  assert.equal(initialStatusMatches.length, 1, 'Only the rank editor may expose initialStatus.');
  assert.match(admin, /admin-rank-lock-warning/);
  assert.match(admin, /unlockConfig:\s*\{[\s\S]*initialStatus:/);
});

test('SRS mastery derives Crown read-only without clearing or advancing the journey', () => {
  assert.match(cloud, /function evaluateActiveJourneyMastery/);
  assert.match(cloud, /masteryAchieved: view\.masteryAchieved/);
  const masteryBlock = cloud.slice(
    cloud.indexOf('async function evaluateActiveJourneyMastery'),
    cloud.indexOf('const evaluateActiveJourneyProgress')
  );
  assert.match(masteryBlock, /derived-from-srs-history/);
  assert.doesNotMatch(masteryBlock, /transaction\.update/);
  assert.doesNotMatch(masteryBlock, /masteryComplete|projectionPending/);
  assert.doesNotMatch(masteryBlock, /status: 'cleared'/);
  assert.doesNotMatch(masteryBlock, /unlockedGateIds|activeGateId:/);
  assert.match(worlds, /function bindPublishedLockedNode/);
  assert.match(worlds, /published-journey-node published-gate-node is-\$\{state\}/);
  assert.match(worlds, /if \(!canRevealPublishedGateWords\(gateState, publishedContentState\.journey\)\)/);
  assert.match(worlds, /gateState === 'locked'[\s\S]*أكمل البوابة السابقة لفتح كلمات هذه البوابة/);
});

test('Placement uses the central gate loader and suppresses every reward side effect', () => {
  assert.match(cloud, /const PLACEMENT_SOURCE = Object\.freeze\(\{[\s\S]*source: 'placement'[\s\S]*suppressRewards: true/);
  assert.match(cloud, /runGateWordOperation\(worldId, rankId, gateId/);
  assert.match(cloud, /placementCore\(\)\.resolvePassThreshold\(gate, schemaApi\(\)\)/);
  assert.match(placement, /Math\.ceil\(total \* ratio\)/);
  assert.doesNotMatch(cloud, /awardXP|lockedXP|markDailyQuest|recordChest|dailyStreak/);
});

test('journey modules load in the current application without adding a library', () => {
  assert.match(html, /js\/journey\.js\?v=/);
  assert.match(html, /js\/placement\.js\?v=/);
  assert.match(html, /js\/journey-cloud\.js\?v=/);
  assert.ok(html.indexOf('js/content-schema.js') < html.indexOf('js/journey.js'));
  assert.ok(html.indexOf('js/journey.js') < html.indexOf('js/placement.js'));
  assert.ok(html.indexOf('js/journey.js') < html.indexOf('js/worlds.js'));
  const packageJson = JSON.parse(packageSource);
  assert.deepEqual(Object.keys(packageJson.dependencies), ['firebase-admin']);
  assert.doesNotMatch(html, /ammar1\.png/);
});
