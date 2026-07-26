import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const [html, router, worlds, runtime, admin, core, styles] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('js/script.js', root), 'utf8'),
  readFile(new URL('js/worlds.js', root), 'utf8'),
  readFile(new URL('js/core-runtime.js', root), 'utf8'),
  readFile(new URL('js/admin.js', root), 'utf8'),
  readFile(new URL('js/core.js', root), 'utf8'),
  readFile(new URL('style.css', root), 'utf8'),
]);

test('the admin route has one hidden host and one script entrypoint', () => {
  assert.equal((html.match(/id="adminView"/g) || []).length, 1);
  assert.equal((html.match(/id="adminEntryBtn"/g) || []).length, 1);
  assert.equal((html.match(/src="js\/admin\.js(?:\?[^"]+)?"/g) || []).length, 1);
  assert.match(router, /admin:\s*'admin'/);
  assert.match(router, /typeof window\.loadAdminView === 'function'/);
});

test('the shared schema loads before the admin UI and auth facade', () => {
  const schemaIndex = html.indexOf('src="js/content-schema.js');
  const uiIndex = html.indexOf('src="js/admin.js');
  assert.ok(schemaIndex >= 0 && uiIndex > schemaIndex);
  assert.equal((html.match(/src="js\/content-schema\.js(?:\?[^"]+)?"/g) || []).length, 1);
  assert.equal((html.match(/src="js\/admin-cloud\.js(?:\?[^"]+)?"/g) || []).length, 1);
});

test('navigation cannot silently discard a dirty or pending admin editor', () => {
  assert.match(router, /canLeaveCurrentRoute/);
  assert.match(router, /window\.canLeaveAdminView\('route'\)/);
  assert.match(worlds, /window\.canLeaveAdminView\('personal'\)/);
  assert.match(runtime, /currentView === 'admin'/);
});

test('admin entry normalizes layout state and remembers every supported origin view', () => {
  assert.match(admin, /const originView = typeof currentView/);
  assert.match(admin, /ui\.returnView = originView/);
  assert.match(admin, /ui\.returnCustomWorldId/);
  assert.match(admin, /setTreasureMode\(false\)/);
  assert.match(admin, /document\.body\.classList\.remove\([\s\S]*?'treasure-mode'[\s\S]*?'game-bg-active'/);
  assert.match(admin, /document\.body\.classList\.add\('admin-mode'\)/);
  assert.match(admin, /viewBackTarget = 'admin-origin'/);
});

test('admin back navigation restores the captured route instead of assuming personal', () => {
  assert.match(core, /currentView === 'admin'[\s\S]*?window\.returnFromAdminView\(\)/);
  assert.match(admin, /function returnFromAdminView\(\)/);
  assert.match(admin, /returnView === 'customWorld'/);
  assert.match(admin, /returnView === 'minecraft' \|\| returnView === 'pubg'/);
  for (const loader of [
    'loadTreasureView',
    'loadWorldsView',
    'loadStarredView',
    'loadQuizView',
    'loadPersonalDictionary',
  ]) {
    assert.match(admin, new RegExp(loader), `${loader} is not available as an admin return target.`);
  }
});

test('admin layout owns a responsive width and clips only its outer horizontal overflow', () => {
  assert.match(styles, /body\.admin-mode \.main-content\s*\{[\s\S]*?width:\s*100% !important/);
  assert.match(styles, /body\.admin-mode \.main-content\s*\{[\s\S]*?max-width:\s*1180px !important/);
  assert.match(styles, /\.admin-view\s*\{[\s\S]*?min-width:\s*0[\s\S]*?overflow-x:\s*clip/);
  assert.match(styles, /\.admin-worlds-section\s*\{[\s\S]*?max-width:\s*100%/);
});
