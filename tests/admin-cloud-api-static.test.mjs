import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/admin-cloud.js', import.meta.url), 'utf8');

const exportsBlock = source.match(/window\.LootLinguaAdminCloud\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/);
assert.ok(exportsBlock, 'The browser admin cloud API is not exported.');
for (const method of [
  'listWorlds',
  'getWorld',
  'createWorld',
  'updateWorld',
  'setWorldStatus',
  'requestDeleteWorld',
  'listRanks',
  'getRank',
  'createRank',
  'updateRank',
  'setRankStatus',
  'duplicateRankAsDraft',
  'requestDeleteRank',
]) {
  assert.match(exportsBlock[1], new RegExp(`\\b${method}\\b`), `${method} is not exported.`);
  assert.match(
    source,
    new RegExp(`async function ${method}\\([^)]*\\) \\{[\\s\\S]*?requireAdminContext\\(\\)`),
    `${method} is not claim-gated.`
  );
}

assert.match(source, /getFirestore\(app\)/, 'The existing Firebase app is not reused for Firestore.');
assert.match(source, /getFunctions\(app\)/, 'The existing Firebase app is not reused for Functions.');
assert.match(source, /query\(contentWorlds, orderBy\('order', 'asc'\)\)/, 'World listing lacks safe ordering.');
const worldListBlock = source.slice(
  source.indexOf('async function listWorlds('),
  source.indexOf('async function getWorld(')
);
const rankListBlock = source.slice(
  source.indexOf('async function listRanks('),
  source.indexOf('async function getRank(')
);
assert.match(
  rankListBlock,
  /getDocs\(query\(ranksCollection\(parentId\), orderBy\('order', 'asc'\)\)\)/,
  'Rank listing lacks one-shot order-based querying.'
);
assert.equal((worldListBlock.match(/await getDocs\(/g) || []).length, 1, 'World listing must use one one-shot query.');
assert.equal((rankListBlock.match(/await getDocs\(/g) || []).length, 1, 'Rank listing must use one one-shot query.');
assert.doesNotMatch(source, /onSnapshot|deleteDoc/, 'The content API must not subscribe or delete recursively in the browser.');
assert.match(source, /runTransaction\(db/, 'World writes must use transactions.');
assert.match(source, /existing\.version !== version/, 'World updates lack optimistic version checks.');
assert.match(source, /createdAt: existing\.createdAt/, 'World updates do not preserve createdAt.');
assert.match(source, /rankCount: existing\.rankCount/, 'World updates do not preserve counters.');
assert.match(source, /cleanWorld\(candidate, \{ worldId \}\)/, 'World writes do not use the canonical schema.');
assert.match(source, /compactForStorage/, 'World writes are not compacted for storage.');
assert.match(source, /content\/publish-requires-slug/, 'Published worlds are not required to have a slug.');
assert.match(source, /\['draft', 'published', 'archived'\]/, 'World status values are not explicitly constrained.');
assert.match(source, /httpsCallable\(functions, 'deleteContentWorld'\)/, 'World deletion does not use the backend callable.');
assert.match(source, /const payload = \{ worldId: id, confirmationTitle \}/, 'The exact confirmation title is not forwarded.');
assert.match(source, /auth\?\.currentUser\?\.uid !== context\.uid/, 'Async world requests are not account guarded.');
assert.match(
  source,
  /error\?\.details\?\.reason === 'version-conflict'[\s\S]*?'admin\/version-conflict'/,
  'Callable version conflicts are not mapped to the canonical admin error.'
);

assert.match(source, /function requireRankId\([\s\S]*?\^\[A-Za-z0-9\]/, 'Rank IDs are not strictly checked.');
assert.match(source, /cleanRank\(candidate, \{ worldId, rankId \}\)/, 'Rank writes do not use the canonical schema.');
assert.match(source, /candidate\.version = 1/, 'New ranks do not start at version 1.');
assert.match(source, /candidate\.gateCount = 0/, 'New ranks do not reset gateCount.');
assert.match(source, /candidate\.wordCount = 0/, 'New ranks do not reset wordCount.');
assert.match(source, /assertStoredRank\(existing, parentId, id\)/, 'Stored Rank system fields are not checked.');
assert.match(source, /existing\.version !== version/, 'Rank updates lack optimistic version checks.');
assert.match(source, /gateCount: existing\.gateCount/, 'Rank updates do not preserve gateCount.');
assert.match(source, /wordCount: existing\.wordCount/, 'Rank updates do not preserve wordCount.');
assert.match(source, /createdAt: existing\.createdAt/, 'Rank updates do not preserve createdAt.');
assert.match(source, /transaction\.update\(worldReference, \{[\s\S]*?rankCount: nextRankCount/, 'Rank creation does not atomically update world.rankCount.');
assert.match(source, /await runTransaction\(db/, 'Rank transactions are not awaited.');
assert.match(source, /httpsCallable\(functions, 'duplicateContentRank'\)/, 'Rank duplication does not use its backend callable.');
assert.match(source, /httpsCallable\(functions, 'deleteContentRank'\)/, 'Rank deletion does not use its backend callable.');
assert.match(source, /await duplicateContentRank\(\{[\s\S]*?operationId/, 'Rank duplication is not awaited or idempotency-keyed.');
assert.match(source, /await deleteContentRank\(\{[\s\S]*?operationId/, 'Rank deletion is not awaited or idempotency-keyed.');

console.log('Admin World/Rank cloud APIs are claim-gated, transactional, versioned, and backend-deleted.');
