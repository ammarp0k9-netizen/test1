import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  contractSource,
  controllerSource,
  storageSource,
  migrationSource,
  profileSource,
  quizSource,
  worldsSource,
  cloudSource,
  rulesSource,
] = await Promise.all([
  readFile(new URL('../js/entry-experience-contract.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-controller.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/script.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/profile-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/quiz.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
]);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

const evaluateContract = new Function(
  'window',
  'globalThis',
  `${contractSource}\nreturn window.LootLinguaEntryExperience;`
);
const contractRoot = {};
const entry = evaluateContract(contractRoot, contractRoot);

test('legacy guest learning state is meaningful without a modern dirty marker', () => {
  const snapshotBlock = between(
    storageSource,
    'function getGuestLootSnapshot()',
    'function hasMeaningfulGuestLoot(snapshot)'
  );
  const meaningfulBlock = between(
    storageSource,
    'function hasMeaningfulGuestLoot(snapshot)',
    'function reconcileEmptyGuestSessionState()'
  );
  const skipBlock = between(
    storageSource,
    'function shouldSkipGuestMigrationPrompt(user)',
    'function hasDirtyGuestData()'
  );

  assert.match(snapshotBlock, /wordMastery:\s*loadJSON\('lootlinguaWordMastery_guest'/);
  assert.match(snapshotBlock, /activeQuizSession:\s*loadJSON\('active_quiz_session'/);
  assert.match(snapshotBlock, /pendingCustomWorlds:\s*loadJSON\(getPendingCustomWorldsStorageKey\('guest'\)/);
  assert.match(meaningfulBlock, /Object\.keys\(wordMastery\)\.length > 0/);
  assert.match(meaningfulBlock, /activeQuizSession && typeof activeQuizSession === 'object'/);
  assert.match(meaningfulBlock, /pendingCustomWorlds\.length > 0/);

  // Neither an account cache nor a marker for an older snapshot proves that
  // currently meaningful, unmarked legacy guest data was migrated.
  assert.doesNotMatch(skipBlock, /hasUserWordsCache|words_normal_[^\n]*purgeStaleGuestLocalData/);
  assert.doesNotMatch(skipBlock, /isGuestMigrationComplete|hasHandledGuestMigration|_profileLoaded/);

  let purgeCalls = 0;
  const buildDecision = new Function(
    'hasMeaningfulGuestLoot',
    'reconcileEmptyGuestSessionState',
    'ensureGuestMigrationSnapshotId',
    'readGuestMigrationReceipt',
    'window',
    `${skipBlock}\nreturn shouldSkipGuestMigrationPrompt;`
  );
  const shouldSkip = buildDecision(
    () => true,
    () => assert.fail('meaningful legacy data must not be reconciled as empty'),
    () => 'legacy-snapshot-a',
    () => null,
    { __guestMigrationSessionComplete: false, _profileLoaded: false }
  );
  assert.equal(shouldSkip({ uid: 'legacy-account-with-cache' }), false);
  assert.equal(purgeCalls, 0);

  const staleMarkerDecision = buildDecision(
    () => true,
    () => assert.fail('meaningful legacy data must not be reconciled as empty'),
    () => 'legacy-snapshot-b',
    () => null,
    { __guestMigrationSessionComplete: true, _profileLoaded: true }
  );
  assert.equal(staleMarkerDecision({ uid: 'legacy-account-with-old-markers' }), false);
  assert.equal(purgeCalls, 0);

  const matchingReceiptDecision = buildDecision(
    () => true,
    () => assert.fail('declined guest data must be preserved'),
    () => 'legacy-snapshot-b',
    (user, snapshotId) => user.uid === 'account-a' && snapshotId === 'legacy-snapshot-b'
      ? { version: 1, uid: user.uid, guestSnapshotId: snapshotId, status: 'declined' }
      : null,
    {}
  );
  assert.equal(matchingReceiptDecision({ uid: 'account-a' }), true);
  assert.equal(matchingReceiptDecision({ uid: 'account-b' }), false);
});

test('new guest data invalidates a previous migration session and resolved promise', () => {
  const dirtyBlock = between(
    storageSource,
    'function markGuestDataDirty()',
    'function markGuestProfileDataDirty(key)'
  );
  assert.match(dirtyBlock, /window\.__guestMigrationSessionComplete = false/);
  assert.match(dirtyBlock, /window\.__guestMigrationPromise = null/);
  assert.match(dirtyBlock, /window\.__guestMigrationUid = ''/);
  assert.match(dirtyBlock, /localStorage\.removeItem\(GUEST_MIGRATION_HANDLED_KEY\)/);
  assert.match(dirtyBlock, /localStorage\.removeItem\(GUEST_MIGRATION_COMPLETE_KEY\)/);
  assert.match(dirtyBlock, /localStorage\.removeItem\(GUEST_MIGRATION_SNAPSHOT_KEY\)/);

  const removed = [];
  const values = new Map();
  const root = {
    __guestMigrationSessionComplete: true,
    __guestMigrationPromise: Promise.resolve('accepted'),
    __guestMigrationUid: 'account-a',
  };
  const buildDirtyMarker = new Function(
    'window',
    'localStorage',
    'GUEST_DATA_DIRTY_KEY',
    'GUEST_MIGRATION_HANDLED_KEY',
    'GUEST_MIGRATION_COMPLETE_KEY',
    'GUEST_MIGRATION_SNAPSHOT_KEY',
    'hasSignedInUser',
    `${dirtyBlock}\nreturn markGuestDataDirty;`
  );
  const markDirty = buildDirtyMarker(
    root,
    {
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { removed.push(key); values.delete(key); },
    },
    'dirty',
    'handled',
    'complete',
    'snapshot',
    () => false
  );
  markDirty();
  assert.equal(values.get('dirty'), '1');
  assert.deepEqual(removed.sort(), ['complete', 'handled', 'snapshot']);
  assert.equal(root.__guestMigrationSessionComplete, false);
  assert.equal(root.__guestMigrationPromise, null);
  assert.equal(root.__guestMigrationUid, '');
  assert.equal(root.__guestMigrationSessionDecision, null);
});

test('accepted migration commits learning state before purging the guest namespace', () => {
  const prepareBlock = between(
    migrationSource,
    'window.prepareGuestMigrationForUser = function(user)',
    'window.confirmGuestMigration = async function()'
  );
  const acceptBlock = between(
    migrationSource,
    'window.confirmGuestMigration = async function()',
    'window.declineGuestMigration = function()'
  );
  const completionIndex = acceptBlock.indexOf("markGuestMigrationCompleteFlag(user, 'accepted', summary.guestSnapshotId)");
  const purgeIndex = acceptBlock.indexOf('purgeStaleGuestLocalData()', completionIndex);
  const recoveryWriteIndex = acceptBlock.indexOf('localStorage.setItem(profileMigrationKey');
  const verifiedProfileCommitIndex = acceptBlock.indexOf('await window.commitPendingGuestProfileMigration(user)');
  assert.ok(completionIndex > 0);
  assert.ok(recoveryWriteIndex > 0);
  assert.ok(recoveryWriteIndex < completionIndex);
  assert.ok(verifiedProfileCommitIndex > recoveryWriteIndex);
  assert.ok(verifiedProfileCommitIndex < completionIndex);
  assert.ok(purgeIndex > completionIndex);
  assert.ok(acceptBlock.indexOf('await window.saveWordToCloud') < completionIndex);
  assert.ok(acceptBlock.indexOf('await window.saveGlobalWordMasteryToCloud') < completionIndex);
  assert.ok(acceptBlock.indexOf('await window.saveActiveQuizSessionToCloud') < completionIndex);
  assert.match(acceptBlock, /const guestWorlds = dedupeCustomWorlds\(\[[\s\S]*?readCustomWorldsFromStorage\('guest'\)[\s\S]*?summary\.pendingCustomWorlds/);
  assert.ok(acceptBlock.indexOf('for (const world of guestWorlds)') < completionIndex);
  assert.match(acceptBlock, /if \(!savedWorld\) throw new Error\('custom-world-upload-failed'\)/);
  assert.match(acceptBlock, /if \(!saved\) throw new Error\('word-mastery-upload-failed'\)/);
  assert.match(acceptBlock, /if \(!saved\) throw new Error\('quiz-session-upload-failed'\)/);
  assert.match(acceptBlock, /`lootlingua:migrated-quiz-draft:\$\{user\.uid\}`/);
  assert.match(acceptBlock, /accountQuizSession && isResumableQuizSession\(accountQuizSession\)/);
  assert.match(cloudSource, /window\.saveActiveQuizSessionToCloud = async function\(session\)[\s\S]*?return true;[\s\S]*?return false;/);
  assert.match(prepareBlock, /const shouldPrompt = hasGuestData/);
  assert.doesNotMatch(prepareBlock, /const shouldPrompt[\s\S]*?hasHandledGuestMigrationForUser/);
  assert.match(acceptBlock, /if \(!profileCommitted\)[\s\S]*?throw profileError/);
});

test('decline is account-scoped and keeps the guest namespace intact', () => {
  const declineBlock = between(
    migrationSource,
    'window.declineGuestMigration = function()',
    'function beginViewSwitch()'
  );
  assert.match(declineBlock, /markGuestMigrationCompleteFlag\(user, 'declined', summary\.guestSnapshotId\)/);
  assert.doesNotMatch(declineBlock, /purgeStaleGuestLocalData|resetGuestProgressState|removeItem/);
  assert.match(storageSource, /guest-migration-receipt:v1:user:/);
  assert.match(storageSource, /receipt\?\.uid !== user\.uid/);
  assert.match(storageSource, /receipt\?\.guestSnapshotId !== snapshotId/);
});

test('versioned guest migration receipts bind one decision to one account and snapshot', () => {
  const receiptBlock = between(
    storageSource,
    'function guestMigrationReceiptStorageKey(user)',
    'function purgeStaleGuestLocalData()'
  );
  const values = new Map([
    ['words_normal_guest', JSON.stringify([{ word: 'legacy' }])],
  ]);
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const root = { LootLinguaEntryExperience: entry };
  const buildReceiptApi = new Function(
    'window',
    'localStorage',
    'GUEST_MIGRATION_RECEIPT_VERSION',
    'GUEST_MIGRATION_SNAPSHOT_KEY',
    `${receiptBlock}\nreturn { ensureGuestMigrationSnapshotId, readGuestMigrationReceipt, writeGuestMigrationReceipt };`
  );
  const api = buildReceiptApi(root, localStorage, 1, 'guest-snapshot');
  const guestSnapshot = {
    words: [{ word: 'legacy' }],
    customWorlds: [],
    pendingCustomWorlds: [],
    wordMastery: {},
    activeQuizSession: null,
    profile: { userXP: 30 },
  };
  const snapshotId = api.ensureGuestMigrationSnapshotId(guestSnapshot);
  const accountA = { uid: 'account-a' };
  const accountB = { uid: 'account-b' };
  const receipt = api.writeGuestMigrationReceipt(accountA, 'declined', snapshotId);

  assert.equal(receipt.version, 1);
  assert.equal(api.readGuestMigrationReceipt(accountA, snapshotId)?.status, 'declined');
  assert.equal(api.readGuestMigrationReceipt(accountB, snapshotId), null);
  assert.equal(api.readGuestMigrationReceipt(accountA, 'new-snapshot'), null);
  assert.ok(values.has('words_normal_guest'), 'a decline must not delete guest learning data');
  assert.notEqual(
    api.ensureGuestMigrationSnapshotId({ ...guestSnapshot, profile: { userXP: 31 } }),
    snapshotId,
    'a changed guest snapshot must not inherit a previous receipt'
  );
});

test('profile persistence exposes the exact failed write and verifies migration writes before cleanup', () => {
  assert.match(profileSource, /const referencePath = `users\/\$\{user\.uid\}\/meta\/profile`/);
  assert.match(profileSource, /await setDoc\(reference, data, \{ merge: true \}\)/);
  assert.match(profileSource, /knownSnapshot\.exists \? 'merge-update' : 'create-with-merge'/);
  assert.match(profileSource, /code: String\(error\?\.code/);
  assert.match(profileSource, /message: String\(error\?\.message/);
  assert.match(profileSource, /payload: diagnosticProfileValue\(payload\)/);
  assert.match(profileSource, /console\.error\('saveProfile:', diagnostic, error\)/);
  assert.match(profileSource, /const verification = await getDoc\(reference\)/);
  assert.match(profileSource, /persistedProfileValueMatches\(persistedData, data\)/);
  assert.match(profileSource, /window\.commitPendingGuestProfileMigration = async function\(user\)/);
  assert.match(migrationSource, /status: 'failed'/);
});

test('the real full profile payload exactly matches the strict Rules field contract', () => {
  const payloadBlock = between(
    migrationSource,
    'window.getLootlinguaProfilePayload = function()',
    'function clearDailyQuestStorage()'
  );
  const buildPayload = new Function(
    'window',
    'document',
    'localStorage',
    'userXP',
    'XP_ECONOMY_VERSION',
    'dailyStreak',
    'lastActivity',
    'todayStr',
    'loadInt',
    'loadJSON',
    'readQuizExposureHistory',
    'getThemeIntroSeenList',
    'getLootState',
    'getTitleState',
    'getDailyQuestStorageKey',
    `${payloadBlock}\nreturn window.getLootlinguaProfilePayload;`
  );
  const storageValues = new Map([['lootlinguaDisplayName', 'Legacy Player']]);
  const getPayload = buildPayload(
    {},
    { documentElement: { getAttribute: (name) => name === 'data-theme' ? 'ocean' : 'dark' } },
    { getItem: (key) => storageValues.get(key) || null },
    125,
    2,
    4,
    '2026-08-01',
    () => '2026-08-01',
    (_key, fallback) => fallback,
    (_key, fallback) => fallback,
    () => [{ sessionId: 'quiz-session-a', at: 1 }],
    () => ['lootlingua', 'ocean'],
    () => ({ totalOpens: 2, rewards: [] }),
    () => ({ unlocked: ['first-loot'], lastUnlockedAt: {} }),
    (date) => `lootlinguaDailyQuests_${date || '2026-08-01'}`
  );
  const payload = getPayload();
  const fieldsBlock = between(rulesSource, 'function profileFieldNames()', 'function validProfileValues(data)');
  const rulesFields = [...fieldsBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);

  assert.deepEqual([...Object.keys(payload), 'updatedAt'].sort(), rulesFields.sort());
  assert.equal(payload.theme, 'ocean');
  assert.equal(payload.oasisMode, 'dark');
  assert.deepEqual(payload.themeIntroSeen, ['lootlingua', 'ocean']);
});

test('an account quiz session wins without losing the guest resumable draft', () => {
  const loadBlock = between(
    quizSource,
    'async function loadStoredActiveQuizSession()',
    'function isResumableQuizSession(session)'
  );
  assert.match(loadBlock, /if \(cloudSession\) return cloudSession/);
  assert.match(loadBlock, /`lootlingua:migrated-quiz-draft:\$\{uid\}`/);
  assert.match(loadBlock, /isResumableQuizSession\(migratedGuestSession\)/);
  assert.match(loadBlock, /if \(saved\) localStorage\.removeItem\(backupKey\)/);
});

test('pending intent reconciliation does not let an unrelated terminal marker erase a new guest action', () => {
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const makeIntent = (overrides = {}) => ({
    action: 'start-journey',
    worldId: 'world-a',
    operationId: 'operation-a',
    createdAt: now - 10_000,
    status: 'pending',
    returnTo: '/app?view=worlds',
    ...overrides,
  });

  const newerGuest = entry.resolvePendingIntentCandidate(
    makeIntent({ operationId: 'old-account-op', status: 'consumed', consumedAt: now - 8_000 }),
    makeIntent({ operationId: 'new-guest-op', worldId: 'world-b', createdAt: now - 1_000 }),
    now
  );
  assert.equal(newerGuest.source, 'guest');
  assert.equal(newerGuest.intent.operationId, 'new-guest-op');

  const validGuestAfterInvalidAccount = entry.resolvePendingIntentCandidate(
    makeIntent({ operationId: 'expired', createdAt: now - (25 * 60 * 60 * 1000) }),
    makeIntent({ operationId: 'valid-guest' }),
    now
  );
  assert.equal(validGuestAfterInvalidAccount.source, 'guest');
  assert.equal(validGuestAfterInvalidAccount.accountValid, false);

  const sameOperationTerminal = entry.resolvePendingIntentCandidate(
    makeIntent({ status: 'consumed', consumedAt: now - 2_000 }),
    makeIntent(),
    now
  );
  assert.equal(sameOperationTerminal.source, 'account');
  assert.equal(sameOperationTerminal.intent.status, 'consumed');

  const newerAccount = entry.resolvePendingIntentCandidate(
    makeIntent({ operationId: 'new-account', createdAt: now - 500 }),
    makeIntent({ operationId: 'old-guest', createdAt: now - 2_000 }),
    now
  );
  assert.equal(newerAccount.source, 'account');
  assert.equal(newerAccount.intent.operationId, 'new-account');
});

test('pending Journey resume is account-scoped, revalidated, leased, and retry-safe', () => {
  const consumeBlock = between(
    controllerSource,
    'async function consumePendingJourneyIntent(options)',
    'async function runCta(id)'
  );
  const resumeBlock = between(
    worldsSource,
    'async function resumePendingJourneyIntent(intent, world)',
    'function publishedJourneyErrorText(error)'
  );
  assert.match(consumeBlock, /resolvePendingIntentCandidate\(/);
  assert.match(consumeBlock, /writeJson\(candidates\.accountKey, lease\)/);
  assert.match(consumeBlock, /published\.getPublishedWorld\(intent\.worldId\)/);
  assert.match(consumeBlock, /await actions\.resumePendingIntent\(intent, world\)/);
  assert.match(consumeBlock, /writeJson\(candidates\.accountKey, consumed\)[\s\S]*?localStorage\.removeItem\(candidates\.guestKey\)/);
  assert.match(consumeBlock, /status: 'pending'[\s\S]*?writeJson\(candidates\.accountKey, pending\)/);
  assert.match(consumeBlock, /navigator\?\.locks\?\.request/);
  assert.match(resumeBlock, /String\(world\.worldId \|\| ''\) !== String\(intent\?\.worldId \|\| ''\)/);
  assert.match(resumeBlock, /action === 'start-journey'/);
  assert.match(resumeBlock, /action === 'begin-journey-from-start'/);
  assert.match(resumeBlock, /action === 'start-placement'/);
  assert.match(resumeBlock, /action === 'start-level-placement'/);
  assert.doesNotMatch(resumeBlock, /awardXP|claimXP|userXP|gateProgress|completionLedger/);
});

test('Entry guest state is removed only after its account merge is saved', () => {
  const mergeBlock = between(
    controllerSource,
    'async function loadAccountEntry(user, token)',
    'function existingPreferences(user, state, profileSnapshot)'
  );
  const saveIndex = mergeBlock.indexOf('const saved = await cloud().save(account, user)');
  const removeIndex = mergeBlock.indexOf('localStorage.removeItem(api().entryStorageKey({}))');
  assert.ok(saveIndex > 0);
  assert.ok(removeIndex > saveIndex);
  assert.match(mergeBlock, /api\(\)\.mergeEntryStates\(account, guest/);
  assert.match(mergeBlock, /catch \(_\) \{[\s\S]*?cloudReadFailed = true/);
});

test('settings edits preserve terminal once-only state and cancellation is non-destructive', () => {
  const actionsBlock = between(
    controllerSource,
    'async function handleAction(action)',
    'function applyExplicitAppearance()'
  );
  const cancelBlock = between(
    actionsBlock,
    "if (action === 'cancel-settings')",
    "if (action === 'back')"
  );
  assert.match(cancelBlock, /runtime\.state = runtime\.settingsBaseState/);
  assert.match(cancelBlock, /close\(\)/);
  assert.match(cancelBlock, /return/);
  assert.doesNotMatch(cancelBlock, /skip-experience|transition\(/);

  assert.match(actionsBlock, /if \(runtime\.settingsMode === 'theme'\)[\s\S]*?\.\.\.runtime\.settingsBaseState,[\s\S]*?themeStatus: draft\.themeStatus,[\s\S]*?themeId: draft\.themeId/);
  assert.match(actionsBlock, /source: 'settings'/);
  assert.match(actionsBlock, /await saveCheckpoint\(/);
});

test('explicit guest appearance is allowlisted and its marker survives failed cloud persistence', () => {
  assert.match(profileSource, /\['lootlingua', 'ocean'\]\.includes\(explicitThemeSession\?\.themeId\)/);
  assert.match(profileSource, /\['light', 'dark'\]\.includes\(explicitThemeSession\?\.oasisMode\)/);
  assert.match(profileSource, /shouldMergeGuestProfile \|\| hasCurrentExplicitTheme/);
  assert.match(profileSource, /const saved = await window\._saveProfileToCloudNow\(\{[\s\S]*?verify:/);
  assert.match(profileSource, /completePendingGuestProfileMigration\([\s\S]*?user,[\s\S]*?saved,[\s\S]*?hasCurrentExplicitTheme[\s\S]*?\)/);
  assert.match(profileSource, /function completePendingGuestProfileMigration\(user, saved, hasExplicitTheme\)[\s\S]*?if \(saved !== true\) return false;[\s\S]*?if \(hasExplicitTheme\)[\s\S]*?sessionStorage\.removeItem\('lootlingua:guest-theme-explicit:v1'\)/);
  assert.match(profileSource, /await setDoc\([\s\S]*?return true;[\s\S]*?return false;/);
});

test('failed guest profile persistence survives refresh and clears only after a successful retry', () => {
  const helperBlock = between(
    profileSource,
    'function pendingGuestProfileMigrationKey(user)',
    'let _saveProfileDebounce'
  );
  const values = new Map();
  const sessionValues = new Map([
    ['lootlingua:guest-theme-explicit:v1', '{"themeId":"ocean"}'],
  ]);
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const session = {
    getItem(key) { return sessionValues.has(key) ? sessionValues.get(key) : null; },
    setItem(key, value) { sessionValues.set(key, String(value)); },
    removeItem(key) { sessionValues.delete(key); },
  };
  const user = { uid: 'profile-retry-account' };
  const key = entry.profileMigrationStorageKey(user);
  const payload = {
    version: 1,
    uid: user.uid,
    profile: { userXP: 180, dailyStreak: 4 },
    createdAt: Date.UTC(2026, 6, 30),
  };
  const normalizedPayload = { ...payload, profiles: [payload.profile] };
  storage.setItem(key, JSON.stringify(payload));

  const buildHelpers = new Function(
    'window',
    'localStorage',
    'sessionStorage',
    `${helperBlock}\nreturn { readPendingGuestProfileMigration, completePendingGuestProfileMigration };`
  );
  const firstRoot = {
    LootLinguaEntryExperience: entry,
    __acceptedGuestProfileMigration: payload,
  };
  const firstLoad = buildHelpers(firstRoot, storage, session);
  assert.deepEqual(firstLoad.readPendingGuestProfileMigration(user), normalizedPayload);
  assert.equal(firstLoad.completePendingGuestProfileMigration(user, false, true), false);
  assert.ok(storage.getItem(key));
  assert.equal(firstRoot.__acceptedGuestProfileMigration, payload);
  assert.ok(session.getItem('lootlingua:guest-theme-explicit:v1'));

  // A new JS context represents refresh: the memory handoff is gone, but the
  // account-scoped recovery record still reconstructs the pending merge.
  const refreshedRoot = { LootLinguaEntryExperience: entry };
  const refreshedLoad = buildHelpers(refreshedRoot, storage, session);
  assert.deepEqual(refreshedLoad.readPendingGuestProfileMigration(user), normalizedPayload);
  assert.equal(refreshedLoad.completePendingGuestProfileMigration(user, true, true), true);
  assert.equal(storage.getItem(key), null);
  assert.equal(refreshedRoot.__acceptedGuestProfileMigration, null);
  assert.equal(session.getItem('lootlingua:guest-theme-explicit:v1'), null);
});
