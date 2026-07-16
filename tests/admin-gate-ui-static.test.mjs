import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [source, styles] = await Promise.all([
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
]);

function functionSection(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.ok(start >= 0 && end > start, `missing function section: ${name}`);
  return source.slice(start, end);
}

test('rank rows open a sorted gate-management view with a four-level breadcrumb', () => {
  assert.match(source, /makeButton\('إدارة البوابات',\s*'open-gates'/);
  assert.match(source, /function renderGates\(\)/);
  assert.match(source, /function openGatesForRank\(worldId, rankId\)/);
  assert.match(source, /makeGateBreadcrumb\(world, rank, source \? String\(source\.title/);
  assert.match(source, /makeButton\(String\(rank && rank\.title \|\| 'الرتبة'\), 'open-gates'/);
  assert.match(source, /ui\.gates[\s\S]*?\.sort\(\(first, second\) => cachedCount\(first\.order\) - cachedCount\(second\.order\)/);
});

test('gate UI requires the complete cloud facade and never writes Firestore directly', () => {
  for (const method of [
    'listGates', 'getGate', 'createGate', 'updateGate', 'setGateStatus',
    'duplicateGateAsDraft', 'moveGate', 'requestDeleteGate',
  ]) {
    assert.match(source, new RegExp(`'${method}'`));
  }
  assert.doesNotMatch(source, /httpsCallable|setDoc|updateDoc|deleteDoc|firebase\.functions/);
});

test('gate editor stores a nullable ratio and resolves the central 75 percent default through schema', () => {
  assert.match(source, /schema\.ENTRY_ASSESSMENT_DEFAULTS[\s\S]*?\.passRatio/);
  assert.match(source, /schema\.resolveEntryAssessmentPassRatio\(gate\)/);
  assert.match(source, /rawThreshold === '' \? null : Number\(rawThreshold\) \/ 100/);
  assert.match(source, /entryAssessmentPassRatio/);
  assert.match(source, /اتركه فارغًا لاستخدام الافتراضي المركزي/);
  assert.match(source, /هذه العتبة لاختبار الدخول فقط؛ منطق الفتح بعد التعلّم لم يُحسم/);
  assert.doesNotMatch(functionSection('collectGateForm', 'gateFormSignature'), /0\.75/);
});

test('gate create and update validate with the shared schema and carry optimistic versions', () => {
  assert.match(source, /schema\.validateGate\(candidate,[\s\S]*?worldId:[\s\S]*?rankId:[\s\S]*?gateId:/);
  assert.match(source, /await api\.createGate\([\s\S]*?validation\.payload/);
  assert.match(source, /await api\.updateGate\([\s\S]*?expectedVersion\(modalState\.gate\)/);
  assert.match(source, /status:\s*'draft'[\s\S]*?version = 1[\s\S]*?wordCount = 0/);
});

test('gate status, duplicate, move, and delete mutations are awaited before success feedback', () => {
  for (const [name, nextName, awaitedCall] of [
    ['saveGateEditor', 'loadFreshGateForEditor', 'await api.updateGate'],
    ['changeGateStatus', 'duplicateGateAsDraft', 'await getCloudApi().setGateStatus'],
    ['duplicateGateAsDraft', 'createClientOperationId', 'await getCloudApi().duplicateGateAsDraft'],
    ['moveGate', 'openDeleteGateDialog', 'await getCloudApi().moveGate'],
    ['deleteGate', 'openDeleteRankDialog', 'await getCloudApi().requestDeleteGate'],
  ]) {
    const section = functionSection(name, nextName);
    const awaitIndex = section.indexOf(awaitedCall);
    const successIndex = section.indexOf("'success'");
    assert.ok(awaitIndex >= 0 && successIndex > awaitIndex, `${name} reports success too early`);
  }
});

test('gate move chooses another world and rank, confirms the exact title, and reuses an operation id', () => {
  const section = functionSection('moveGate', 'openDeleteGateDialog');
  assert.match(source, /name:\s*'targetWorldId'/);
  assert.match(source, /name:\s*'targetRankId'/);
  assert.match(source, /targetWorldId === String\(modalState\.world\.worldId\)[\s\S]*?targetRankId === String\(modalState\.rank\.rankId\)/);
  assert.match(section, /typedTitle !== modalState\.expectedTitle/);
  assert.match(section, /\{ worldId: targetWorldId, rankId: targetRankId \}/);
  assert.match(section, /expectedVersion\(modalState\.gate\)/);
  assert.match(section, /operationId:\s*modalState\.operationId,[\s\S]*?confirmationTitle:\s*typedTitle/);
  assert.match(source, /operationId:\s*createClientOperationId\('move-gate'\)/);
});

test('permanent gate deletion is archived-only, exact-title-confirmed, versioned, and backend-only', () => {
  assert.match(source, /gate\.status !== 'archived'/);
  const section = functionSection('deleteGate', 'openDeleteRankDialog');
  assert.match(section, /typedTitle !== modalState\.expectedTitle/);
  assert.match(section, /confirmationTitle:\s*typedTitle/);
  assert.match(section, /expectedVersion:\s*expectedVersion\(modalState\.gate\)/);
  assert.match(section, /await getCloudApi\(\)\.requestDeleteGate/);
});

test('gate mutations reject double submits and suppress stale-account feedback', () => {
  assert.match(source, /ui\.modal !== modalState \|\| modalState\.pending/);
  assert.match(source, /gate:[^`]+:status`[\s\S]*?if \(ui\.actionKeys\.has\(key\)\) return;/);
  assert.match(source, /function adminContextMatches\(uid\)/);
  assert.match(source, /String\(state\.uid \|\| ''\) === String\(uid \|\| ''\)/);
  assert.match(source, /ui\.modal\.kind === 'gate-editor'/);
  assert.match(source, /ui\.modal\.kind === 'move-gate'/);
  assert.match(source, /GATE_DIRTY_WARNING/);
});

test('gate list exposes word counts and assessment meaning without claiming counter integrity', () => {
  assert.match(source, /cachedCount\(gate\.wordCount\)/);
  assert.match(source, /عتبة اختبار الدخول فقط/);
  assert.match(source, /لا تمنح XP أو إتقانًا/);
  assert.match(source, /منطق فتح المحتوى بعد التعلّم لم يُحسم بعد/);
  assert.match(source, /عدد مخزن مؤقتًا · لم يتم التحقق/);
});

test('gate UI remains safe-DOM and has scoped responsive visual states', () => {
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML/);
  assert.match(styles, /\.admin-gate-metrics\s*\{\s*grid-template-columns:\s*repeat\(3,/);
  assert.match(styles, /\.admin-gate-row\s*\{/);
  assert.match(styles, /\.admin-threshold-chip\s*\{/);
  assert.match(styles, /\.admin-assessment-note\s*\{/);
  assert.match(styles, /\.admin-move-gate-dialog\s*\{/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.admin-metrics,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});
