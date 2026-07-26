import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const admin = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const importer = readFileSync(new URL('../js/admin-word-import.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing section: ${start}`);
  assert.ok(endIndex > startIndex, `Missing section boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('loads the import helper after the content schema and before the admin UI', () => {
  const schemaIndex = html.indexOf('src="js/content-schema.js');
  const importIndex = html.indexOf('src="js/admin-word-import.js"');
  const adminIndex = html.indexOf('src="js/admin.js');
  assert.ok(schemaIndex >= 0 && schemaIndex < importIndex);
  assert.ok(importIndex < adminIndex);
});

test('renders the JSON import action only in the existing words header', () => {
  const words = section(admin, 'function renderWords()', 'function renderCurrentView()');
  assert.match(words, /makeButton\('استيراد JSON', 'import-words-json'/);
  assert.match(words, /worldId: world\.worldId, rankId: rank\.rankId/);
  assert.match(words, /gateId: gate\.gateId/);
  assert.match(words, /ui\.wordImportPending/);
});

test('uses a JSON-only picker with the requested file limits', () => {
  const picker = section(admin, 'function chooseWordImportFile', 'function modalIsDirty');
  const preparation = section(admin, 'async function prepareWordImport', 'function chooseWordImportFile');
  assert.match(picker, /input\.accept = '\.json,application\/json'/);
  assert.match(preparation, /importer\.assertFileSize\(file\.size\)/);
  assert.match(preparation, /endsWith\('\.json'\)/);
  assert.equal(importer.includes('const MAX_FILE_BYTES = 2 * 1024 * 1024;'), true);
  assert.equal(importer.includes('const MAX_WORDS = 100;'), true);
});

test('previews central validation and duplicate results before importing', () => {
  const preparation = section(admin, 'async function prepareWordImport', 'function chooseWordImportFile');
  assert.match(preparation, /importer\.preparePreview\(parsed/);
  assert.match(preparation, /schema: root\.LootLinguaContentSchema/);
  assert.match(preparation, /await importer\.inspectDuplicates\(preview/);
  assert.match(preparation, /inspectGate: cloud\.inspectWordDuplicates\.bind\(cloud\)/);
  assert.match(admin, /مكرر في الملف/);
  assert.match(admin, /موجود في البوابة/);
  assert.match(admin, /سيتم إنشاء كل الكلمات المقبولة كمسودات/);
  assert.match(admin, /تعذر فحص وجود الكلمة خارج البوابة الحالية، ويمكن متابعة الاستيراد/);
  assert.match(admin, /تعذر فحص تكرار الكلمات داخل البوابة الحالية/);
});

test('commits through the selected destination and defers refresh until the modal closes', () => {
  const commit = section(admin, 'async function commitWordImport', 'async function prepareWordImport');
  assert.match(commit, /modalState\.pending \|\| modalState\.completed/);
  assert.match(commit, /await importer\.commit\(modalState\.preview/);
  assert.match(commit, /await importer\.commitToStaging\(modalState\.preview/);
  assert.match(commit, /createWord: cloud\.createWord\.bind\(cloud\)/);
  assert.match(commit, /if \(result\.summary\.succeeded > 0\)/);
  assert.match(commit, /modalState\.refreshAfterClose = true/);
  assert.doesNotMatch(commit, /refreshWords\(/);
  assert.doesNotMatch(commit, /refreshStagingWords\(/);
  assert.match(commit, /renderWordImportEntries\(modalState\.tableWrap, result\.entries\)/);
  assert.match(commit, /بقيت المعاينة والنتائج مفتوحة/);
});

test('builds import UI without innerHTML or a second write implementation', () => {
  const uiSection = section(admin, 'function wordImportResultLabel', 'function modalIsDirty');
  assert.doesNotMatch(uiSection, /innerHTML/);
  assert.doesNotMatch(importer, /setDoc|updateDoc|writeBatch|httpsCallable|firebase\.functions/);
  assert.match(importer, /await settings\.createWord\(/);
});

test('preview back and cancel use central delegation and release modal scroll state', () => {
  const preview = section(admin, 'function openWordImportPreview', 'async function commitWordImport');
  const close = section(admin, 'function closeAdminModal', 'function openWorldEditor');
  const click = section(admin, 'function handleAdminClick', 'function switchToAdminShell');
  assert.match(preview, /makeButton\('رجوع', 'choose-word-import-file'/);
  assert.match(preview, /makeButton\('إلغاء', 'close-modal'/);
  assert.match(preview, /getAdminRoot\(\)\.append\(overlay\)/);
  assert.doesNotMatch(preview, /document\.body\.append\(overlay\)/);
  assert.match(preview, /lockBackgroundScroll\('adminWordImport'\)/);
  assert.match(close, /modalState\.refreshAfterClose[\s\S]*?refreshWords\(\{ initial: true \}\)/);
  assert.match(close, /modalState\.refreshAfterClose[\s\S]*?refreshStagingWords\(\{ initial: true \}\)/);
  assert.match(click, /action === 'choose-word-import-file'/);
  assert.match(click, /closeAdminModal\(true\)[\s\S]*?chooseWordImportFile\(world, rank, gate, returnFocus, destination\)/);
  assert.match(click, /action === 'close-modal'[\s\S]*?closeAdminModal\(false\)/);
  assert.match(close, /unlockBackgroundScroll\('adminWordImport'\)/);
});

test('preview rows expose four calm visual states without technical error codes', () => {
  const labels = section(admin, 'function wordImportResultLabel', 'function renderWordImportStats');
  assert.match(labels, /return 'duplicate'/);
  assert.match(labels, /return 'warning'/);
  assert.match(labels, /return 'invalid'/);
  assert.match(labels, /return 'valid'/);
  assert.match(labels, /item && item\.message/);
  assert.doesNotMatch(labels, /\$\{code\}:/);
  for (const state of ['valid', 'warning', 'duplicate', 'invalid']) {
    assert.match(styles, new RegExp(`\\.admin-import-row-${state}`));
    assert.match(styles, new RegExp(`\\.admin-import-result-${state}`));
  }
});

test('runs both import suites as part of test:admin', () => {
  assert.match(packageJson.scripts['test:admin'], /tests\/admin-word-import\.test\.mjs/);
  assert.match(packageJson.scripts['test:admin'], /tests\/admin-word-import-ui-static\.test\.mjs/);
});
