import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');

function functionSection(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.ok(start >= 0 && end > start, `missing function section: ${name}`);
  return source.slice(start, end);
}

test('word management view and editor are present without direct Firestore writes', () => {
  assert.match(source, /function renderWords\(\)/);
  assert.match(source, /function openWordsForGate\(worldId, rankId, gateId\)/);
  assert.match(source, /function openWordEditor\(world, rank, gate, word, mode, returnFocus\)/);
  assert.match(source, /function loadFreshWordForEditor\(world, rank, gate, contentWordId, returnFocus\)/);
  assert.match(source, /function changeWordStatus\(world, rank, gate, word, nextStatus\)/);
  assert.match(source, /function runBulkWordStatus\(world, rank, gate, action\)/);
  for (const method of [
    'listWords', 'getWord', 'createWord', 'updateWord', 'setWordStatus',
    'bulkPublishWords', 'bulkArchiveWords',
  ]) {
    assert.match(source, new RegExp(`'${method}'`), `${method} is not required by the facade.`);
  }
  assert.doesNotMatch(source, /httpsCallable|setDoc|updateDoc|deleteDoc|firebase\.functions/);
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML/);
});

test('word row actions expose only the wired safe operations', () => {
  assert.match(source, /makeButton\('[^']+', 'open-words'/);
  assert.match(source, /makeButton\([\s\S]*?'refresh-words'/);
  assert.match(source, /makeButton\([\s\S]*?'load-more-words'/);
  assert.match(source, /makeButton\('[^']+', 'create-word'/);
  assert.match(source, /makeButton\('[^']+', 'edit-word'/);
  assert.match(source, /makeButton\('[^']+', 'set-word-status'/);
  assert.match(source, /checkbox\.dataset\.adminAction = 'toggle-word-selection'/);
  assert.match(source, /'select-page-words'/);
  assert.match(source, /makeButton\('[^']+', 'bulk-publish-words'/);
  assert.match(source, /makeButton\('[^']+', 'bulk-archive-words'/);
  assert.doesNotMatch(source, /makeButton\('[^']+', 'archive-word'/);
  assert.match(source, /makeButton\('[^']+', 'duplicate-word'[\s\S]*?disabled:\s*true/);
  assert.match(source, /makeButton\('[^']+', 'move-word'[\s\S]*?disabled:\s*true/);
  assert.match(source, /makeButton\('[^']+', 'delete-word'[\s\S]*?disabled:\s*true/);
  assert.match(source, /makeButton\('[^']+', 'bulk-move-words'[\s\S]*?disabled:\s*true/);
});

test('handleAdminClick wires the scoped word actions and leaves deferred actions unimplemented', () => {
  const section = functionSection('handleAdminClick', 'switchToAdminShell');
  for (const action of [
    'open-words',
    'refresh-words',
    'load-more-words',
    'previous-words',
    'next-words',
    'retry-word-page',
    'toggle-word-selection',
    'select-page-words',
    'create-word',
    'edit-word',
    'set-word-status',
    'bulk-publish-words',
    'bulk-archive-words',
  ]) {
    assert.match(section, new RegExp(`action === '${action}'`), `${action} is not wired.`);
  }
  assert.match(section, /openWordsForGate\(world\.worldId, rank\.rankId, gate\.gateId\)/);
  assert.match(section, /refreshWords\(\{ append: false \}\)/);
  assert.match(section, /refreshWords\(\{ append: true \}\)/);
  assert.match(section, /setWordSelected\(word, actionButton\.checked\)/);
  assert.match(section, /const pageIsSelected = ui\.words\.every/);
  assert.match(section, /ui\.words\.forEach\(\(word\) => \{[\s\S]*?setWordSelected\(word, !pageIsSelected\)/);
  assert.match(section, /openWordEditor\(world, rank, gate, null, 'create', actionButton\)/);
  assert.match(section, /loadFreshWordForEditor\(world, rank, gate, word\.contentWordId, actionButton\)/);
  assert.match(section, /changeWordStatus\(world, rank, gate, word, actionButton\.dataset\.status\)/);
  assert.match(section, /runBulkWordStatus\(world, rank, gate, 'publish'\)/);
  assert.match(section, /runBulkWordStatus\(world, rank, gate, 'archive'\)/);
  assert.doesNotMatch(section, /action === 'duplicate-word'/);
  assert.doesNotMatch(section, /action === 'move-word'/);
  assert.doesNotMatch(section, /action === 'delete-word'/);
  assert.doesNotMatch(section, /action === 'bulk-move-words'/);
});

test('word loading keeps the legacy path behind a flag and routes the enabled path through the pager', () => {
  const refreshSection = functionSection('refreshWords', 'openWordsForGate');
  assert.match(refreshSection, /ADMIN_PAGED_WORDS_V2/);
  assert.match(refreshSection, /refreshPagedWords\(options\)/);
  assert.match(refreshSection, /refreshLegacyWords\(options\)/);
  assert.match(refreshSection, /createAdminWordPager/);
  assert.match(refreshSection, /pager\.loadInitialPage\(\)/);
  assert.match(refreshSection, /pager\.loadNextPage\(\)/);
  assert.match(refreshSection, /pager\.loadPreviousPage\(\)/);
  assert.match(refreshSection, /pager\.refreshCurrentPage\(\)/);
  const legacySection = functionSection('refreshLegacyWords', 'openWordsForGate');
  assert.match(legacySection, /const cursor = append \? ui\.wordNextCursor : null/);
  assert.match(legacySection, /const byId = new Map\(ui\.words\.map\(\(word\) => \[String\(word\.contentWordId\), word\]\)\)/);
  assert.match(legacySection, /received\.forEach\(\(word\) => byId\.set\(String\(word\.contentWordId\), word\)\)/);
});

test('open-words scopes the selected hierarchy before loading page one', () => {
  const section = functionSection('openWordsForGate', 'showAdminDashboard');
  assert.match(section, /ui\.view = 'words'/);
  assert.match(section, /ui\.activeWorldId = String\(world\.worldId\)/);
  assert.match(section, /ui\.activeRankId = String\(rank\.rankId\)/);
  assert.match(section, /ui\.activeGateId = String\(gate\.gateId\)/);
  assert.match(section, /ui\.wordNextCursor = null/);
  assert.match(section, /ui\.wordHasMore = false/);
  assert.match(section, /ui\.wordPager = null/);
  assert.match(section, /clearWordSelection\(\)/);
  assert.match(section, /await refreshWords\(\{ initial: true \}\)/);
});

test('word mutations await cloud writes before success feedback and keep failure state visible', () => {
  const editorSection = functionSection('saveWordEditor', 'loadFreshWordForEditor');
  for (const awaitedCall of ['await api.updateWord', 'await api.createWord']) {
    const awaitIndex = editorSection.indexOf(awaitedCall);
    const successIndex = editorSection.indexOf("'success'");
    assert.ok(awaitIndex >= 0 && successIndex > awaitIndex, `${awaitedCall} reports success too early`);
  }
  assert.match(editorSection, /if \(ui\.modal !== modalState \|\| modalState\.pending \|\| modalState\.localDuplicate\) return/);
  assert.match(editorSection, /renderFormIssues\(modalState\.errorBox,[\s\S]*?getErrorCode\(error, 'admin\/word-save-failed'\)/);

  const statusSection = functionSection('changeWordStatus', 'archiveWord');
  assert.match(statusSection, /await getCloudApi\(\)\.setWordStatus\([\s\S]*?expectedVersion\(word\)/);
  assert.ok(
    statusSection.indexOf('await getCloudApi().setWordStatus') < statusSection.indexOf("'success'"),
    'word status reports success too early'
  );
  assert.match(statusSection, /if \(ui\.actionKeys\.has\(key\)\) return/);
  assert.match(statusSection, /await refreshWords\(\{ append: false \}\)/);
  assert.match(statusSection, /setWordActionError\('[^']+', error\)/);

  const bulkSection = functionSection('runBulkWordStatus', 'createClientOperationId');
  assert.match(bulkSection, /await api\.bulkPublishWords/);
  assert.match(bulkSection, /await api\.bulkArchiveWords/);
  assert.ok(
    bulkSection.indexOf('await api.bulkPublishWords') < bulkSection.indexOf("'success'"),
    'bulk publish reports success too early'
  );
  assert.ok(
    bulkSection.indexOf('await api.bulkArchiveWords') < bulkSection.indexOf("'success'"),
    'bulk archive reports success too early'
  );
  assert.match(bulkSection, /if \(ui\.actionKeys\.has\(key\)\) return/);
  assert.match(bulkSection, /clearWordSelection\(\)/);
  assert.match(bulkSection, /await refreshWords\(\{ append: false \}\)/);
});

test('bulk word selection keeps exact versions and rejects oversized batches', () => {
  const selectionSection = functionSection('wordSelectionPayload', 'changeWordStatus');
  assert.match(selectionSection, /selected\.length > MAX_BULK_WORDS/);
  assert.match(selectionSection, /error\.code = 'content\/invalid-bulk-size'/);
  assert.match(selectionSection, /ui\.selectedWordMeta\.get\(contentWordId\)/);
  assert.match(selectionSection, /expectedVersion\(meta\)/);
  const toolbarSection = functionSection('renderWordBulkToolbar', 'renderWords');
  assert.match(toolbarSection, /selectedCount > MAX_BULK_WORDS/);
  assert.match(toolbarSection, /`\$\{selectedCount\} كلمات محددة`/);
  assert.match(toolbarSection, /تحديد الكل في الصفحة/);
  assert.match(toolbarSection, /إلغاء تحديد الكل/);
});

test('word cards keep selection beside identity and shorten technical identifiers safely', () => {
  const rowSection = functionSection('renderWordRow', 'renderWordBulkToolbar');
  assert.match(rowSection, /admin-word-selection/);
  assert.match(rowSection, /makeTechnicalCode\(/);
  assert.match(source, /function shortenTechnicalValue\(value, maxLength\)/);
  assert.match(source, /code\.title = fullValue/);
  assert.match(source, /code\.setAttribute\('aria-label', fullValue\)/);
});
