import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [policySource, coreSource, scriptSource, htmlSource, styleSource, worldsSource, dictionarySource] = await Promise.all([
  readFile(new URL('../js/notification-policy.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/core.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/script.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/dictionary.js', import.meta.url), 'utf8'),
]);

const root = {};
vm.runInContext(policySource, vm.createContext({ window: root, globalThis: root, Date, Math, Set, Object, String, Number }));
const policy = root.LootLinguaNotificationPolicy;

test('a short transient message remains toast-only', () => {
  assert.equal(policy.shouldPersist('تم الحفظ', {}), false);
});

test('a long message gets a short toast preview and a full notification record', () => {
  const message = 'اكتملت العملية مع عدة نتائج. نجحت ثلاث كلمات، وتعذرت كلمتان بسبب تعارض النسخة، ويمكن فتح التفاصيل لمعرفة الأسباب.';
  assert.equal(policy.shouldPersist(message, {}), true);
  const record = policy.createRecord(message, 'warning', {}, 100);
  assert.equal(record.msg, message);
  assert.ok(policy.toastPreview(message).length < message.length);
});

test('retry merges into the same deterministic notification instead of duplicating it', () => {
  const options = { dedupeKey: 'move:operation-1', partialFailure: true };
  const first = policy.createRecord('نجحت 3 وفشلت 2', 'warning', options, 100);
  const retry = policy.createRecord('نجحت 3 وفشلت 2', 'warning', options, 200);
  const records = policy.mergeRecord(policy.mergeRecord([], first), retry);
  assert.equal(records.length, 1);
  assert.equal(records[0].count, 1);
  assert.equal(records[0].id, first.id);
});

test('separate operations with the same copy are not accidentally deduplicated', () => {
  const first = policy.createRecord('Same important result', 'warning', { persist: true }, 100);
  const second = policy.createRecord('Same important result', 'warning', { persist: true }, 100);
  assert.notEqual(first.id, second.id);
  assert.equal(policy.mergeRecord(policy.mergeRecord([], first), second).length, 2);
});

test('the details contract records first, opens the exact ID, and persists unread state', () => {
  assert.match(scriptSource, /recordNotificationForToast/);
  assert.match(scriptSource, /openNotificationDetails\?\.\(entry\.notificationId/);
  assert.match(coreSource, /focusNotificationDetails\(id, ev, false\)/);
  assert.match(coreSource, /localStorage\.setItem/);
  assert.match(coreSource, /persistNotifications\(\)/);
  assert.doesNotMatch(coreSource, /window\.__notifications\.forEach\(n => n\.read = true\)/);
});

test('one root toast host sits above app overlays without blocking pointer input', () => {
  assert.equal((htmlSource.match(/id="toastHost"/g) || []).length, 1);
  assert.match(styleSource, /--layer-toast:\s*200000/);
  assert.match(styleSource, /\.toast-host[\s\S]*pointer-events:\s*none/);
  assert.match(styleSource, /\.toast-msg\.toast-interactive\s*\{\s*pointer-events:\s*auto/);
  assert.match(scriptSource, /window\.__toastQueue/);
});

test('World completion emits a persistent, deduplicated details-capable message', () => {
  assert.match(worldsSource, /importance:\s*'achievement'/);
  assert.match(worldsSource, /dedupeKey:\s*completionId/);
  assert.match(worldsSource, /persist:\s*true/);
});

test('move, copy, import, bulk removal, and Journey summaries opt into persistent records', () => {
  assert.match(worldsSource, /world-manage:[\s\S]*importance:\s*'multi-result'/);
  assert.match(worldsSource, /partialFailure:\s*result\.partial === true/);
  assert.match(dictionarySource, /failureDetails[\s\S]*importance:\s*'partial-failure'/);
  assert.match(dictionarySource, /operationId:\s*`json-import:/);
  assert.match(dictionarySource, /dedupeKey:\s*`\$\{ctx\.operationId\}:result`/);
});
