import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const [html, router, worlds, runtime] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('js/script.js', root), 'utf8'),
  readFile(new URL('js/worlds.js', root), 'utf8'),
  readFile(new URL('js/core-runtime.js', root), 'utf8'),
]);

test('the admin route has one hidden host and one script entrypoint', () => {
  assert.equal((html.match(/id="adminView"/g) || []).length, 1);
  assert.equal((html.match(/id="adminEntryBtn"/g) || []).length, 1);
  assert.equal((html.match(/src="js\/admin\.js"/g) || []).length, 1);
  assert.match(router, /admin:\s*'admin'/);
  assert.match(router, /typeof window\.loadAdminView === 'function'/);
});

test('the shared schema loads before the admin UI and auth facade', () => {
  const schemaIndex = html.indexOf('src="js/content-schema.js"');
  const uiIndex = html.indexOf('src="js/admin.js"');
  assert.ok(schemaIndex >= 0 && uiIndex > schemaIndex);
  assert.equal((html.match(/src="js\/content-schema\.js"/g) || []).length, 1);
  assert.equal((html.match(/src="js\/admin-cloud\.js"/g) || []).length, 1);
});

test('navigation cannot silently discard a dirty or pending admin editor', () => {
  assert.match(router, /canLeaveCurrentRoute/);
  assert.match(router, /window\.canLeaveAdminView\('route'\)/);
  assert.match(worlds, /window\.canLeaveAdminView\('personal'\)/);
  assert.match(runtime, /currentView === 'admin'/);
});
