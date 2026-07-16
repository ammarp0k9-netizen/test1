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

test('admin UI exports its guarded view entry points', () => {
  assert.match(source, /root\.loadAdminView\s*=\s*loadAdminView/);
  assert.match(source, /root\.openAdminDashboard\s*=\s*loadAdminView/);
  assert.match(source, /root\.canLeaveAdminView\s*=\s*canLeaveAdminView/);
});

test('admin UI treats role events as notifications, not authorization data', () => {
  assert.match(source, /function handleAdminState\(\)\s*\{/);
  assert.doesNotMatch(source, /event\.detail/);
  assert.doesNotMatch(source, /المرحلة|مرحلة/);
});

test('admin UI renders remote values through safe DOM text APIs', () => {
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
  assert.doesNotMatch(source, /\son(?:click|change|input|submit)\s*=/i);
});

test('world mutations use the central cloud facade and optimistic versions', () => {
  assert.match(source, /await api\.createWorld\(validation\.payload\)/);
  assert.match(source, /await api\.updateWorld\([\s\S]*expectedVersion\(modalState\.world\)/);
  assert.match(source, /await getCloudApi\(\)\.setWorldStatus\([\s\S]*expectedVersion\(world\)/);
  assert.match(source, /await getCloudApi\(\)\.requestDeleteWorld\([\s\S]*expectedVersion:\s*expectedVersion\(modalState\.world\)/);
});

test('rank management exposes a real world-to-ranks list and editor breadcrumb', () => {
  assert.match(source, /makeButton\('إدارة الرتب',\s*'open-ranks'/);
  assert.match(source, /function renderRanks\(\)/);
  assert.match(source, /function openRankEditor\(world, rank, mode, returnFocus\)/);
  assert.match(source, /makeAdminBreadcrumb\(world, source \? String\(source\.title/);
  assert.match(source, /makeElement\('span', 'admin-breadcrumb-separator', '←'\)/);
  assert.match(source, /name:\s*'order'[\s\S]*type:\s*'number'/);
  assert.match(source, /name:\s*'initialStatus'/);
  assert.doesNotMatch(source, /إدارة الرتب والبوابات متاحة في التحديثات الإدارية اللاحقة/);
});

test('rank navigation and three-metric summary have scoped responsive styles', () => {
  assert.match(styles, /\.admin-breadcrumb\s*\{/);
  assert.match(styles, /\.admin-breadcrumb-link:focus-visible\s*\{/);
  assert.match(styles, /\.admin-rank-metrics\s*\{\s*grid-template-columns:\s*repeat\(3,/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.admin-metrics,[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test('rank mutations use only the cloud facade and carry optimistic versions', () => {
  assert.match(source, /await api\.createRank\(String\(modalState\.world\.worldId\), validation\.payload\)/);
  assert.match(source, /await api\.updateRank\([\s\S]*expectedVersion\(modalState\.rank\)/);
  assert.match(source, /await getCloudApi\(\)\.setRankStatus\([\s\S]*expectedVersion\(rank\)/);
  assert.match(source, /await getCloudApi\(\)\.duplicateRankAsDraft\([\s\S]*expectedVersion\(rank\)/);
  assert.match(source, /await getCloudApi\(\)\.requestDeleteRank\([\s\S]*confirmationTitle:\s*typedTitle,[\s\S]*expectedVersion:\s*expectedVersion\(modalState\.rank\)/);
  assert.doesNotMatch(source, /httpsCallable|deleteDoc|firebase\.functions/);
});

test('rank forms and row actions reject double submission', () => {
  assert.match(source, /if \(ui\.modal !== modalState \|\| modalState\.pending\) return;/);
  assert.match(source, /if \(ui\.actionKeys\.has\(key\)\) return;[\s\S]*setActionPending\(key, true\)/);
  assert.match(source, /modalState\.deleteButton\.disabled = true/);
});

test('rank success feedback is emitted only after its cloud write is awaited', () => {
  for (const [name, nextName, awaitedCall] of [
    ['saveRankEditor', 'loadFreshRankForEditor', 'await api.updateRank'],
    ['changeRankStatus', 'duplicateRankAsDraft', 'await getCloudApi().setRankStatus'],
    ['duplicateRankAsDraft', 'openDeleteRankDialog', 'await getCloudApi().duplicateRankAsDraft'],
    ['deleteRank', 'openDeleteWorldDialog', 'await getCloudApi().requestDeleteRank'],
  ]) {
    const section = functionSection(name, nextName);
    const awaitIndex = section.indexOf(awaitedCall);
    const successIndex = section.indexOf("'success'");
    assert.ok(awaitIndex >= 0 && successIndex > awaitIndex, `${name} reports success too early`);
  }
});

test('rank deletion is archived-only, exact-title-confirmed, and backend awaited', () => {
  assert.match(source, /rank\.status\s*!==\s*'archived'/);
  assert.match(source, /typedTitle\s*!==\s*modalState\.expectedTitle/);
  assert.match(source, /await getCloudApi\(\)\.requestDeleteRank\([\s\S]*?notify\('تم حذف الرتبة/);
});

test('rank list exposes gate and word counters without claiming integrity', () => {
  assert.match(source, /cachedCount\(rank\.gateCount\)/);
  assert.match(source, /cachedCount\(rank\.wordCount\)/);
  assert.match(source, /أعداد مخزنة مؤقتًا · لم يتم التحقق/);
});

test('permanent deletion is archived-only and requires the exact title', () => {
  assert.match(source, /world\.status\s*!==\s*'archived'/);
  assert.match(source, /typedTitle\s*!==\s*modalState\.expectedTitle/);
  assert.match(source, /confirmationTitle:\s*typedTitle/);
});

test('dirty and pending editors guard close, navigation, and unload', () => {
  assert.match(source, /DIRTY_WARNING/);
  assert.match(source, /RANK_DIRTY_WARNING/);
  assert.match(source, /ui\.modal\.kind === 'rank-editor'/);
  assert.match(source, /modalState\.pending/);
  assert.match(source, /ui\.actionKeys\.size > 0/);
  assert.match(source, /handleNavigationCapture/);
  assert.match(source, /beforeunload/);
  assert.match(source, /event\.returnValue\s*=\s*''/);
});

test('counter integrity stays explicitly unverified', () => {
  const matches = source.match(/لم يتم التحقق/g) || [];
  assert.ok(matches.length >= 3, 'expected unverified wording in dashboard and delete impact');
});
