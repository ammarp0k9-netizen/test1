import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/admin-cloud.js', import.meta.url), 'utf8');
const exportsBlock = source.match(/window\.LootLinguaAdminCloud\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/);
assert.ok(exportsBlock, 'The browser admin cloud API is not exported.');

for (const method of [
  'listGates',
  'getGate',
  'createGate',
  'updateGate',
  'setGateStatus',
  'publishGateDraftWords',
  'duplicateGateAsDraft',
  'moveGate',
  'requestDeleteGate',
]) {
  assert.match(exportsBlock[1], new RegExp(`\\b${method}\\b`), `${method} is not exported.`);
  assert.match(
    source,
    new RegExp(`async function ${method}\\([\\s\\S]*?requireAdminContext\\(\\)`),
    `${method} is not claim-gated.`
  );
}

assert.match(source, /function requireGateId\([\s\S]*?\^\[A-Za-z0-9\]/, 'Gate IDs are not strict.');
assert.match(source, /cleanGate\(candidate, \{[\s\S]*?worldId,[\s\S]*?rankId,[\s\S]*?gateId/, 'Gate writes bypass the schema.');
assert.match(source, /candidate\.version = 1/, 'New gates do not start at version 1.');
assert.match(source, /candidate\.wordCount = 0/, 'New gates do not reset wordCount.');
assert.match(source, /assertStoredGate\(existing, parentWorldId, parentRankId, id\)/, 'Stored Gate fields are not checked.');
assert.match(source, /existing\.version !== version/, 'Gate updates lack optimistic version checks.');
assert.match(source, /wordCount: existing\.wordCount/, 'Gate updates do not preserve wordCount.');
assert.match(source, /createdAt: existing\.createdAt/, 'Gate updates do not preserve createdAt.');
assert.match(source, /transaction\.update\(rankReference, \{[\s\S]*?gateCount: nextRankGateCount/, 'Gate creation does not update rank.gateCount.');
assert.match(source, /transaction\.update\(worldReference, \{[\s\S]*?gateCount: nextWorldGateCount/, 'Gate creation does not update world.gateCount.');
assert.match(source, /await runTransaction\(db/, 'Gate transactions are not awaited.');
assert.match(
  source,
  /async function publishDraftWordsForGate\([\s\S]*?where\('status', '==', 'draft'\)[\s\S]*?limit\(BULK_WORD_LIMIT\)[\s\S]*?bulkSetWordStatus\([\s\S]*?'published'/,
  'Gate publication does not publish every draft-word batch.'
);
assert.match(
  source,
  /async function publishGateDraftWords\([\s\S]*?gate\.status !== 'published'/,
  'Existing-gate repair is not restricted to published gates.'
);
const publishStatusSection = source.match(
  /async function setGateStatus\([\s\S]*?\n\}\n\nasync function publishDraftWordsForGate/
);
assert.ok(publishStatusSection, 'Gate status publication section is missing.');
assert.ok(
  publishStatusSection[0].indexOf('publishDraftWordsForGate') <
    publishStatusSection[0].indexOf('updateGate('),
  'A gate becomes public before its draft words are published.'
);
assert.match(source, /httpsCallable\(functions, 'duplicateContentGate'\)/);
assert.match(source, /httpsCallable\(functions, 'moveContentGate'\)/);
assert.match(source, /httpsCallable\(functions, 'deleteContentGate'\)/);
assert.match(source, /await duplicateContentGate\(\{[\s\S]*?operationId/);
assert.match(source, /await moveContentGate\(\{[\s\S]*?targetWorldId,[\s\S]*?targetRankId,[\s\S]*?confirmationTitle:[\s\S]*?operationId/);
assert.match(source, /await deleteContentGate\(\{[\s\S]*?confirmationTitle:[\s\S]*?operationId/);
assert.match(source, /const OPERATION_RESUME_STORAGE_KEY = 'lootlingua_content_operation_resume_v1'/);
assert.match(source, /resolveOperationToken\([\s\S]*?context\.uid/, 'Operation resumption is not account-scoped.');
assert.match(source, /readPersistedOperationId\(scopedCacheKey\)/, 'Reload recovery is not used.');
assert.match(source, /completeOperationToken\([\s\S]*?removePersistedOperationId/, 'Successful operations do not clear durable resume state.');

console.log('Admin Gate cloud APIs are claim-gated, transactional, versioned, movable, and idempotency-keyed.');
