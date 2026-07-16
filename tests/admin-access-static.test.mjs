import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const adminCloud = read('js/admin-cloud.js');
const cloud = read('js/cloud.js');
const html = read('index.html');

assert.match(adminCloud, /getIdTokenResult\(options\.forceRefresh !== false\)/, 'Admin claim is not read from the Firebase ID token');
assert.match(adminCloud, /token\?\.claims\?\.admin === true/, 'Admin claim must require strict boolean true');
assert.match(adminCloud, /const user = auth\?\.currentUser \|\| null/, 'Admin checks must derive the user from Firebase Auth');
assert.match(adminCloud, /const revision = \+\+checkRevision/, 'Stale claim requests are not revision guarded');
assert.match(adminCloud, /auth\?\.currentUser !== user/, 'Account switches are not object-identity guarded');
assert.doesNotMatch(adminCloud, /event\.detail\?\.user/, 'Admin checks must not trust a CustomEvent user object');
assert.doesNotMatch(adminCloud, /sessionStorage/, 'Session storage must not be used for admin state.');
const operationPersistenceBlock = adminCloud.match(
  /function operationResumeStorage[\s\S]*?function requireExpectedVersion/
);
assert.ok(operationPersistenceBlock, 'The narrowly scoped operation-resume storage block is missing.');
assert.equal(
  (adminCloud.match(/localStorage/g) || []).length,
  1,
  'Browser storage must remain limited to the operation-resume adapter.'
);
assert.match(adminCloud, /const OPERATION_RESUME_STORAGE_KEY = 'lootlingua_content_operation_resume_v1'/);
assert.match(
  operationPersistenceBlock[0],
  /scopedCacheKey = JSON\.stringify\(\[String\(uid \|\| ''\), operationKey\]\)/,
  'Persisted operation IDs must be isolated by Firebase UID.'
);
assert.doesNotMatch(
  operationPersistenceBlock[0],
  /claims|isAdmin|adminState|getIdToken|currentUser|forceRefresh|admin\s*===/i,
  'The operation-resume adapter must never persist or derive admin authority.'
);
assert.doesNotMatch(adminCloud, /@|password|secret/i, 'Admin access module contains an email/password/secret marker');
assert.match(cloud, /lootlingua:auth-state/, 'Main Auth listener does not notify account-safe role state');
assert.equal((cloud.match(/initializeApp\(/g) || []).length, 1, 'Firebase must still initialize exactly once');
assert.equal((html.match(/src="js\/admin-cloud\.js"/g) || []).length, 1, 'Admin claim module must be loaded exactly once');
assert.equal((html.match(/src="js\/content-schema\.js"/g) || []).length, 1, 'Content schema must be loaded exactly once');

console.log('Admin access is token-based and non-persistent; only account-scoped idempotency IDs survive reloads.');
