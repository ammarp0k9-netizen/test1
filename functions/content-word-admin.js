'use strict';

const { createHash } = require('node:crypto');

const CONTENT_OPERATIONS_COLLECTION = 'admin_content_operations';
const AUDIT_COLLECTION = 'admin_audit_logs';
const WORLD_OPERATION_LOCK_FIELD = '_adminWorldOperation';
const WORLD_DELETE_LOCK_FIELD = '_deleteLock';
const RANK_OPERATION_LOCK_FIELD = '_adminRankOperation';
const RANK_COPY_OPERATION_FIELD = '_adminCopyOperation';
const GATE_OPERATION_LOCK_FIELD = '_adminGateOperation';
const GATE_COPY_OPERATION_FIELD = '_adminGateCopyOperation';
const OPERATION_LOCK_TTL_MS = 15 * 60 * 1000;
const WRITE_CHUNK_SIZE = 300;
const MAX_BULK_WORDS = 100;
const MAX_ID_LENGTH = 128;
const MAX_WORD_LENGTH = 200;
const MAX_TRANSLATION_LENGTH = 500;
const MAX_COUNT = 10000000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const CONTENT_STATUSES = Object.freeze(['draft', 'published', 'archived']);

const WORD_COPY_FIELDS = Object.freeze([
  'schemaVersion', 'normalizationVersion', 'word', 'normalizedWord', 'wordKey',
  'translation', 'definition', 'definition_ar', 'example', 'exampleTranslation',
  'category', 'partOfSpeech', 'level', 'tags', 'synonyms', 'pronunciation',
  'audioUrl', 'imageUrl', 'notes', 'order'
]);

class WordAdminPayloadError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'WordAdminPayloadError';
    this.field = field;
  }
}

function isPlainRecord(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireAllowedKeys(data, allowedKeys, field = 'data') {
  if (!isPlainRecord(data)) {
    throw new WordAdminPayloadError(field, `${field} must be a request object.`);
  }
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) {
    throw new WordAdminPayloadError(field, `${field} contains unsupported fields.`);
  }
}

function requireContentId(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH ||
      !ID_PATTERN.test(value)) {
    throw new WordAdminPayloadError(
      field,
      `${field} must be a valid content identifier with at most ${MAX_ID_LENGTH} characters.`
    );
  }
  return value;
}

function requireExpectedVersion(value, field = 'expectedVersion') {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_COUNT) {
    throw new WordAdminPayloadError(field, `${field} must be a positive safe content version.`);
  }
  return value;
}

function requireOperationId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH ||
      !OPERATION_ID_PATTERN.test(value)) {
    throw new WordAdminPayloadError(
      'operationId',
      `operationId must be a safe identifier with at most ${MAX_ID_LENGTH} characters.`
    );
  }
  return value;
}

function requireConfirmationWord(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_WORD_LENGTH) {
    throw new WordAdminPayloadError(
      'confirmationWord',
      `confirmationWord must contain the exact word and be at most ${MAX_WORD_LENGTH} characters.`
    );
  }
  return value;
}

function sourceIdentity(data) {
  return {
    worldId: requireContentId(data.worldId, 'worldId'),
    rankId: requireContentId(data.rankId, 'rankId'),
    gateId: requireContentId(data.gateId, 'gateId'),
    contentWordId: requireContentId(data.contentWordId, 'contentWordId')
  };
}

function targetIdentity(data) {
  return {
    targetWorldId: requireContentId(data.targetWorldId, 'targetWorldId'),
    targetRankId: requireContentId(data.targetRankId, 'targetRankId'),
    targetGateId: requireContentId(data.targetGateId, 'targetGateId')
  };
}

function assertDifferentGate(payload) {
  if (payload.worldId === payload.targetWorldId &&
      payload.rankId === payload.targetRankId && payload.gateId === payload.targetGateId) {
    throw new WordAdminPayloadError(
      'targetGateId',
      'The target gate must differ from the source gate to preserve normalized-word uniqueness.'
    );
  }
}

function validateDuplicateWordPayload(data) {
  requireAllowedKeys(data, new Set([
    'worldId', 'rankId', 'gateId', 'contentWordId',
    'targetWorldId', 'targetRankId', 'targetGateId',
    'expectedVersion', 'operationId'
  ]));
  const payload = {
    ...sourceIdentity(data),
    ...targetIdentity(data),
    expectedVersion: requireExpectedVersion(data.expectedVersion),
    operationId: requireOperationId(data.operationId)
  };
  assertDifferentGate(payload);
  return payload;
}

function validateMoveWordPayload(data) {
  requireAllowedKeys(data, new Set([
    'worldId', 'rankId', 'gateId', 'contentWordId',
    'targetWorldId', 'targetRankId', 'targetGateId', 'confirmationWord',
    'expectedVersion', 'operationId'
  ]));
  const payload = {
    ...sourceIdentity(data),
    ...targetIdentity(data),
    confirmationWord: requireConfirmationWord(data.confirmationWord),
    expectedVersion: requireExpectedVersion(data.expectedVersion),
    operationId: requireOperationId(data.operationId)
  };
  assertDifferentGate(payload);
  return payload;
}

function validateDeleteWordPayload(data) {
  requireAllowedKeys(data, new Set([
    'worldId', 'rankId', 'gateId', 'contentWordId',
    'confirmationWord', 'expectedVersion', 'operationId'
  ]));
  return {
    ...sourceIdentity(data),
    confirmationWord: requireConfirmationWord(data.confirmationWord),
    expectedVersion: requireExpectedVersion(data.expectedVersion),
    operationId: requireOperationId(data.operationId)
  };
}

function validateBulkItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BULK_WORDS) {
    throw new WordAdminPayloadError(
      'items',
      `items must contain between 1 and ${MAX_BULK_WORDS} versioned words.`
    );
  }
  const seen = new Set();
  return items.map((item, index) => {
    const field = `items[${index}]`;
    requireAllowedKeys(item, new Set(['contentWordId', 'expectedVersion']), field);
    const contentWordId = requireContentId(item.contentWordId, `${field}.contentWordId`);
    if (seen.has(contentWordId)) {
      throw new WordAdminPayloadError(`${field}.contentWordId`, 'Bulk word IDs must be unique.');
    }
    seen.add(contentWordId);
    return {
      contentWordId,
      expectedVersion: requireExpectedVersion(item.expectedVersion, `${field}.expectedVersion`)
    };
  });
}

function validateBulkWordPayload(data) {
  requireAllowedKeys(data, new Set([
    'action', 'worldId', 'rankId', 'gateId', 'items',
    'targetWorldId', 'targetRankId', 'targetGateId', 'operationId'
  ]));
  if (!['publish', 'archive', 'move'].includes(data.action)) {
    throw new WordAdminPayloadError('action', 'action must be publish, archive, or move.');
  }
  const payload = {
    action: data.action,
    worldId: requireContentId(data.worldId, 'worldId'),
    rankId: requireContentId(data.rankId, 'rankId'),
    gateId: requireContentId(data.gateId, 'gateId'),
    items: validateBulkItems(data.items),
    operationId: requireOperationId(data.operationId)
  };
  if (data.action === 'move') {
    Object.assign(payload, targetIdentity(data));
    assertDifferentGate(payload);
  } else if (Object.hasOwn(data, 'targetWorldId') || Object.hasOwn(data, 'targetRankId') ||
      Object.hasOwn(data, 'targetGateId')) {
    throw new WordAdminPayloadError(
      'targetGateId',
      'Target ancestry is supported only for the bulk move action.'
    );
  }
  return payload;
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createOperationKey(adminUid, action, operationId) {
  return `wordop_${hashText(`${adminUid}\n${action}\n${operationId}`)}`;
}

function createRequestFingerprint(action, payload) {
  return hashText(JSON.stringify({ action, payload }));
}

function createContentWordId(normalizationVersion, normalizedWord) {
  return `word_${hashText(`${String(normalizationVersion)}\0${normalizedWord}`)}`;
}

function createDuplicateWordId(normalizationVersion, normalizedWord) {
  return createContentWordId(normalizationVersion, normalizedWord);
}

function timestampToMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return Number.NaN;
}

function isLeaseActive(record, nowMillis) {
  if (!isPlainRecord(record)) return false;
  const leaseMillis = timestampToMillis(record.leaseAt);
  return Number.isFinite(leaseMillis) && nowMillis - leaseMillis < OPERATION_LOCK_TTL_MS;
}

function safeErrorName(error) {
  const value = error && (error.code || error.name);
  return typeof value === 'string' ? value.slice(0, 120) : 'unknown';
}

function assertAdmin(request, HttpsError) {
  const uid = request?.auth?.uid;
  const token = request?.auth?.token;
  if (typeof uid !== 'string' || !uid || !isPlainRecord(token) || token.admin !== true) {
    throw new HttpsError('permission-denied', 'A verified admin claim is required.');
  }
  return uid;
}

function translatePayloadError(error, HttpsError) {
  if (error instanceof WordAdminPayloadError) {
    throw new HttpsError('invalid-argument', error.message, { field: error.field });
  }
  throw error;
}

function requireCounter(record, field, HttpsError) {
  const value = isPlainRecord(record) ? record[field] : null;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COUNT) {
    throw new HttpsError('failed-precondition', `The stored ${field} counter is invalid.`);
  }
  return value;
}

function addCount(value, delta, HttpsError) {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(delta) ||
      value < 0 || value > MAX_COUNT || value + delta < 0 || value + delta > MAX_COUNT) {
    throw new HttpsError('failed-precondition', 'A content word counter would become invalid.');
  }
  return value + delta;
}

function normalizeWord(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function wordKey(value) {
  return normalizeWord(value)
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

function assertStoredWord(word, identity, expectedVersion, HttpsError) {
  if (!isPlainRecord(word) || word.worldId !== identity.worldId ||
      word.rankId !== identity.rankId || word.gateId !== identity.gateId ||
      word.contentWordId !== identity.contentWordId) {
    throw new HttpsError('failed-precondition', 'The stored word ancestry is invalid.');
  }
  if (word.schemaVersion !== 1 || word.normalizationVersion !== 1 ||
      typeof word.word !== 'string' || !word.word || word.word.length > MAX_WORD_LENGTH ||
      typeof word.translation !== 'string' || !word.translation ||
      word.translation.length > MAX_TRANSLATION_LENGTH ||
      word.normalizedWord !== normalizeWord(word.word) || word.wordKey !== wordKey(word.word) ||
      !word.wordKey || !CONTENT_STATUSES.includes(word.status) ||
      !Number.isSafeInteger(word.order) || word.order < 0 || word.order > 1000000 ||
      !Number.isSafeInteger(word.version) || word.version < 1 || word.version > MAX_COUNT) {
    throw new HttpsError('failed-precondition', 'The stored word schema is invalid.');
  }
  if (word.version !== expectedVersion) {
    throw new HttpsError('aborted', 'The word was changed by another request.', {
      reason: 'version-conflict',
      contentWordId: identity.contentWordId,
      expectedVersion,
      actualVersion: word.version
    });
  }
  return word;
}

function assertOperationLockAvailable(record, field, nowMillis, HttpsError) {
  if (!Object.hasOwn(record, field)) return;
  const lock = record[field];
  if (!isPlainRecord(lock) || typeof lock.operationKey !== 'string' ||
      typeof lock.action !== 'string' || !Number.isFinite(timestampToMillis(lock.leaseAt))) {
    throw new HttpsError('failed-precondition', 'A malformed backend operation lock blocks this word.');
  }
  if (isLeaseActive(lock, nowMillis)) {
    throw new HttpsError('aborted', 'Another backend operation is using this content hierarchy.');
  }
}

function assertWorldDeleteAvailable(world, nowMillis, HttpsError) {
  if (!Object.hasOwn(world, WORLD_DELETE_LOCK_FIELD)) return;
  const lock = world[WORLD_DELETE_LOCK_FIELD];
  const requestedAt = isPlainRecord(lock) ? timestampToMillis(lock.requestedAt) : Number.NaN;
  if (!Number.isFinite(requestedAt)) {
    throw new HttpsError('failed-precondition', 'A malformed world-deletion lock blocks this word.');
  }
  if (nowMillis - requestedAt < OPERATION_LOCK_TTL_MS) {
    throw new HttpsError('aborted', 'The content world is being deleted.');
  }
}

function assertHierarchy(world, rank, gate, identity, nowMillis, HttpsError) {
  if (!isPlainRecord(world) || world.worldId !== identity.worldId) {
    throw new HttpsError('not-found', 'The content world does not exist or has invalid identity.');
  }
  if (!isPlainRecord(rank) || rank.worldId !== identity.worldId ||
      rank.rankId !== identity.rankId) {
    throw new HttpsError('not-found', 'The content rank does not exist or has invalid ancestry.');
  }
  if (!isPlainRecord(gate) || gate.worldId !== identity.worldId ||
      gate.rankId !== identity.rankId || gate.gateId !== identity.gateId) {
    throw new HttpsError('not-found', 'The content gate does not exist or has invalid ancestry.');
  }
  requireCounter(world, 'wordCount', HttpsError);
  requireCounter(rank, 'wordCount', HttpsError);
  requireCounter(gate, 'wordCount', HttpsError);
  assertWorldDeleteAvailable(world, nowMillis, HttpsError);
  assertOperationLockAvailable(world, WORLD_OPERATION_LOCK_FIELD, nowMillis, HttpsError);
  assertOperationLockAvailable(rank, RANK_OPERATION_LOCK_FIELD, nowMillis, HttpsError);
  assertOperationLockAvailable(gate, GATE_OPERATION_LOCK_FIELD, nowMillis, HttpsError);
  if (Object.hasOwn(rank, RANK_COPY_OPERATION_FIELD)) {
    throw new HttpsError('failed-precondition', 'A rank-copy reservation blocks word operations.');
  }
  if (Object.hasOwn(gate, GATE_COPY_OPERATION_FIELD)) {
    throw new HttpsError('failed-precondition', 'A gate-copy reservation blocks word operations.');
  }
}

function copyFields(source, fields) {
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  return result;
}

function buildDuplicateWord(source, target, contentWordId, adminUid, FieldValue) {
  return {
    ...copyFields(source, WORD_COPY_FIELDS),
    worldId: target.worldId,
    rankId: target.rankId,
    gateId: target.gateId,
    contentWordId,
    status: 'draft',
    version: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: adminUid,
    updatedBy: adminUid
  };
}

function buildMovedWord(source, target, adminUid, FieldValue) {
  return {
    ...copyFields(source, WORD_COPY_FIELDS),
    worldId: target.worldId,
    rankId: target.rankId,
    gateId: target.gateId,
    contentWordId: source.contentWordId,
    status: source.status,
    version: source.version + 1,
    createdAt: source.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: source.createdBy || adminUid,
    updatedBy: adminUid
  };
}

function publicWord(word) {
  return {
    ...copyFields(word, WORD_COPY_FIELDS),
    worldId: word.worldId,
    rankId: word.rankId,
    gateId: word.gateId,
    contentWordId: word.contentWordId,
    status: word.status,
    version: word.version,
    createdBy: word.createdBy,
    updatedBy: word.updatedBy
  };
}

function hierarchyRefs(db, identity) {
  const worldRef = db.collection('content_worlds').doc(identity.worldId);
  const rankRef = worldRef.collection('ranks').doc(identity.rankId);
  const gateRef = rankRef.collection('gates').doc(identity.gateId);
  return { worldRef, rankRef, gateRef };
}

function operationRefs(db, operationKey) {
  return {
    receiptRef: db.collection(CONTENT_OPERATIONS_COLLECTION).doc(operationKey),
    auditRef: db.collection(AUDIT_COLLECTION).doc(operationKey)
  };
}

function uniqueReferences(references) {
  const unique = new Map();
  for (const reference of references) unique.set(reference.path, reference);
  return [...unique.values()];
}

async function getSnapshots(transaction, references) {
  const snapshots = new Map();
  for (const reference of uniqueReferences(references)) {
    snapshots.set(reference.path, await transaction.get(reference));
  }
  return snapshots;
}

function snapshotData(snapshots, reference) {
  const snapshot = snapshots.get(reference.path);
  return snapshot?.exists ? snapshot.data() : null;
}

function assertReceiptMatches(receipt, fingerprint, HttpsError) {
  if (!isPlainRecord(receipt) || receipt.fingerprint !== fingerprint) {
    throw new HttpsError(
      'already-exists',
      'operationId was already used for a different word operation.'
    );
  }
}

function readReceipt(snapshot, fingerprint, operationId, nowMillis, HttpsError) {
  if (!snapshot.exists) return null;
  const receipt = snapshot.data();
  assertReceiptMatches(receipt, fingerprint, HttpsError);
  if (receipt.status === 'completed') {
    if (!isPlainRecord(receipt.result)) {
      throw new HttpsError('failed-precondition', 'The completed word-operation receipt is corrupt.');
    }
    return receipt.result;
  }
  if (receipt.status === 'running') {
    if (!Number.isFinite(timestampToMillis(receipt.leaseAt))) {
      throw new HttpsError('failed-precondition', 'The word-operation lease is corrupt.');
    }
    if (isLeaseActive(receipt, nowMillis)) {
      throw new HttpsError('aborted', 'This word operation is already running.', {
        operationId,
        retryable: true,
        retryAfterSeconds: Math.ceil(OPERATION_LOCK_TTL_MS / 1000)
      });
    }
    return null;
  }
  if (receipt.status === 'failed') return null;
  throw new HttpsError('failed-precondition', 'The word-operation receipt status is corrupt.');
}

function makeCollisionQuery(gateRef, normalizedWord) {
  return gateRef.collection('words').where('normalizedWord', '==', normalizedWord).limit(1);
}

function queryHasDocuments(snapshot) {
  return Boolean(snapshot && (snapshot.empty === false || snapshot.size > 0 || snapshot.docs?.length));
}

function addCounterDelta(deltas, reference, delta) {
  const current = deltas.get(reference.path) || { reference, delta: 0 };
  current.delta += delta;
  deltas.set(reference.path, current);
}

function addHierarchyCounterDelta(deltas, refs, delta) {
  addCounterDelta(deltas, refs.gateRef, delta);
  addCounterDelta(deltas, refs.rankRef, delta);
  addCounterDelta(deltas, refs.worldRef, delta);
}

function applyCounterDeltas(transaction, snapshots, deltas, adminUid, FieldValue, HttpsError) {
  for (const { reference, delta } of deltas.values()) {
    if (delta === 0) continue;
    const record = snapshotData(snapshots, reference);
    transaction.update(reference, {
      wordCount: addCount(record.wordCount, delta, HttpsError),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminUid
    });
  }
}

function setCompletedReceipt(transaction, receiptRef, existingReceipt, context, result, FieldValue) {
  transaction.set(receiptRef, {
    action: context.action,
    entityType: context.entityType,
    operationId: context.operationId,
    operationKey: context.operationKey,
    adminUid: context.adminUid,
    fingerprint: context.fingerprint,
    status: 'completed',
    leaseAt: FieldValue.serverTimestamp(),
    result,
    createdAt: existingReceipt?.createdAt || FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
}

function setAudit(transaction, auditRef, data, FieldValue) {
  transaction.set(auditRef, {
    ...data,
    createdAt: FieldValue.serverTimestamp()
  });
}

function baseContext(adminUid, action, operationId, payload) {
  const operationKey = createOperationKey(adminUid, action, operationId);
  return {
    adminUid,
    action,
    entityType: action === 'bulkUpdateContentWords' ? 'word-batch' : 'word',
    operationId,
    operationKey,
    fingerprint: createRequestFingerprint(action, payload)
  };
}

function sourceTargetFromPayload(payload) {
  return {
    source: {
      worldId: payload.worldId,
      rankId: payload.rankId,
      gateId: payload.gateId
    },
    target: {
      worldId: payload.targetWorldId,
      rankId: payload.targetRankId,
      gateId: payload.targetGateId
    }
  };
}

async function executeDuplicate(dependencies, adminUid, payload) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const context = baseContext(adminUid, 'duplicateContentWord', payload.operationId, payload);
  const source = {
    worldId: payload.worldId, rankId: payload.rankId, gateId: payload.gateId,
    contentWordId: payload.contentWordId
  };
  const target = {
    worldId: payload.targetWorldId, rankId: payload.targetRankId, gateId: payload.targetGateId
  };
  const sourceRefs = hierarchyRefs(db, source);
  const targetRefs = hierarchyRefs(db, target);
  const sourceWordRef = sourceRefs.gateRef.collection('words').doc(payload.contentWordId);
  const refs = operationRefs(db, context.operationKey);

  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      refs.receiptRef,
      sourceRefs.worldRef, sourceRefs.rankRef, sourceRefs.gateRef, sourceWordRef,
      targetRefs.worldRef, targetRefs.rankRef, targetRefs.gateRef
    ]);
    const receiptSnapshot = snapshots.get(refs.receiptRef.path);
    const replay = readReceipt(
      receiptSnapshot, context.fingerprint, payload.operationId, now(), HttpsError
    );
    if (replay) return replay;
    const sourceWord = assertStoredWord(
      snapshotData(snapshots, sourceWordRef), source, payload.expectedVersion, HttpsError
    );
    assertHierarchy(
      snapshotData(snapshots, sourceRefs.worldRef), snapshotData(snapshots, sourceRefs.rankRef),
      snapshotData(snapshots, sourceRefs.gateRef), source, now(), HttpsError
    );
    assertHierarchy(
      snapshotData(snapshots, targetRefs.worldRef), snapshotData(snapshots, targetRefs.rankRef),
      snapshotData(snapshots, targetRefs.gateRef), target, now(), HttpsError
    );
    const targetWordId = createContentWordId(
      sourceWord.normalizationVersion, sourceWord.normalizedWord
    );
    const targetWordRef = targetRefs.gateRef.collection('words').doc(targetWordId);
    const targetWordSnapshot = await transaction.get(targetWordRef);
    if (targetWordSnapshot.exists) {
      throw new HttpsError('already-exists', 'The deterministic duplicate-word target already exists.');
    }
    const collision = await transaction.get(
      makeCollisionQuery(targetRefs.gateRef, sourceWord.normalizedWord)
    );
    if (queryHasDocuments(collision)) {
      throw new HttpsError('already-exists', 'The normalized word already exists in the target gate.', {
        normalizedWord: sourceWord.normalizedWord,
        gateId: target.gateId
      });
    }
    const duplicate = buildDuplicateWord(sourceWord, target, targetWordId, adminUid, FieldValue);
    const result = {
      duplicated: true,
      operationId: payload.operationId,
      source: { ...source },
      target: { ...target, contentWordId: targetWordId },
      affectedCounts: { wordCount: 1 },
      word: publicWord(duplicate)
    };
    const deltas = new Map();
    addHierarchyCounterDelta(deltas, targetRefs, 1);
    transaction.set(targetWordRef, duplicate);
    applyCounterDeltas(transaction, snapshots, deltas, adminUid, FieldValue, HttpsError);
    setAudit(transaction, refs.auditRef, {
      action: 'duplicate', entityType: 'word', entityId: targetWordId,
      worldId: target.worldId, rankId: target.rankId, gateId: target.gateId,
      sourceWorldId: source.worldId, sourceRankId: source.rankId,
      sourceGateId: source.gateId, sourceContentWordId: source.contentWordId,
      adminUid, operationId: payload.operationId,
      summary: `Duplicated word "${sourceWord.word.slice(0, MAX_WORD_LENGTH)}" as draft.`,
      affectedCounts: { wordCount: 1 },
      before: { version: sourceWord.version, status: sourceWord.status },
      after: { version: 1, status: 'draft' }
    }, FieldValue);
    setCompletedReceipt(
      transaction, refs.receiptRef, receiptSnapshot.exists ? receiptSnapshot.data() : null,
      context, result, FieldValue
    );
    return result;
  });
}

async function executeMove(dependencies, adminUid, payload) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const context = baseContext(adminUid, 'moveContentWord', payload.operationId, payload);
  const identities = sourceTargetFromPayload(payload);
  const source = { ...identities.source, contentWordId: payload.contentWordId };
  const target = identities.target;
  const sourceRefs = hierarchyRefs(db, source);
  const targetRefs = hierarchyRefs(db, target);
  const sourceWordRef = sourceRefs.gateRef.collection('words').doc(payload.contentWordId);
  const refs = operationRefs(db, context.operationKey);

  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      refs.receiptRef,
      sourceRefs.worldRef, sourceRefs.rankRef, sourceRefs.gateRef, sourceWordRef,
      targetRefs.worldRef, targetRefs.rankRef, targetRefs.gateRef
    ]);
    const receiptSnapshot = snapshots.get(refs.receiptRef.path);
    const replay = readReceipt(
      receiptSnapshot, context.fingerprint, payload.operationId, now(), HttpsError
    );
    if (replay) return replay;
    const sourceWord = assertStoredWord(
      snapshotData(snapshots, sourceWordRef), source, payload.expectedVersion, HttpsError
    );
    if (sourceWord.word !== payload.confirmationWord) {
      throw new HttpsError('failed-precondition', 'The exact word confirmation does not match.');
    }
    if (sourceWord.version >= MAX_COUNT) {
      throw new HttpsError('failed-precondition', 'The word version cannot be incremented safely.');
    }
    assertHierarchy(
      snapshotData(snapshots, sourceRefs.worldRef), snapshotData(snapshots, sourceRefs.rankRef),
      snapshotData(snapshots, sourceRefs.gateRef), source, now(), HttpsError
    );
    assertHierarchy(
      snapshotData(snapshots, targetRefs.worldRef), snapshotData(snapshots, targetRefs.rankRef),
      snapshotData(snapshots, targetRefs.gateRef), target, now(), HttpsError
    );
    const targetWordId = createContentWordId(
      sourceWord.normalizationVersion, sourceWord.normalizedWord
    );
    const targetWordRef = targetRefs.gateRef.collection('words').doc(targetWordId);
    const targetWordSnapshot = await transaction.get(targetWordRef);
    if (targetWordSnapshot.exists) {
      throw new HttpsError('already-exists', 'The word ID already exists in the target gate.');
    }
    const collision = await transaction.get(
      makeCollisionQuery(targetRefs.gateRef, sourceWord.normalizedWord)
    );
    if (queryHasDocuments(collision)) {
      throw new HttpsError('already-exists', 'The normalized word already exists in the target gate.', {
        normalizedWord: sourceWord.normalizedWord,
        gateId: target.gateId
      });
    }
    const moved = buildMovedWord(sourceWord, target, adminUid, FieldValue);
    moved.contentWordId = targetWordId;
    const result = {
      moved: true,
      operationId: payload.operationId,
      source: { ...source },
      target: { ...target, contentWordId: targetWordId },
      affectedCounts: { wordCount: 1 },
      word: publicWord(moved)
    };
    const deltas = new Map();
    addHierarchyCounterDelta(deltas, sourceRefs, -1);
    addHierarchyCounterDelta(deltas, targetRefs, 1);
    transaction.delete(sourceWordRef);
    transaction.set(targetWordRef, moved);
    applyCounterDeltas(transaction, snapshots, deltas, adminUid, FieldValue, HttpsError);
    setAudit(transaction, refs.auditRef, {
      action: 'move', entityType: 'word', entityId: targetWordId,
      worldId: target.worldId, rankId: target.rankId, gateId: target.gateId,
      sourceWorldId: source.worldId, sourceRankId: source.rankId, sourceGateId: source.gateId,
      adminUid, operationId: payload.operationId,
      summary: `Moved word "${sourceWord.word.slice(0, MAX_WORD_LENGTH)}".`,
      affectedCounts: { wordCount: 1 },
      before: { version: sourceWord.version, status: sourceWord.status },
      after: { version: moved.version, status: moved.status }
    }, FieldValue);
    setCompletedReceipt(
      transaction, refs.receiptRef, receiptSnapshot.exists ? receiptSnapshot.data() : null,
      context, result, FieldValue
    );
    return result;
  });
}

async function executeDelete(dependencies, adminUid, payload) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const context = baseContext(adminUid, 'deleteContentWord', payload.operationId, payload);
  const source = {
    worldId: payload.worldId, rankId: payload.rankId, gateId: payload.gateId,
    contentWordId: payload.contentWordId
  };
  const sourceRefs = hierarchyRefs(db, source);
  const sourceWordRef = sourceRefs.gateRef.collection('words').doc(payload.contentWordId);
  const refs = operationRefs(db, context.operationKey);

  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      refs.receiptRef, sourceRefs.worldRef, sourceRefs.rankRef, sourceRefs.gateRef, sourceWordRef
    ]);
    const receiptSnapshot = snapshots.get(refs.receiptRef.path);
    const replay = readReceipt(
      receiptSnapshot, context.fingerprint, payload.operationId, now(), HttpsError
    );
    if (replay) return replay;
    const sourceWord = assertStoredWord(
      snapshotData(snapshots, sourceWordRef), source, payload.expectedVersion, HttpsError
    );
    if (sourceWord.status !== 'archived') {
      throw new HttpsError('failed-precondition', 'Only an archived word can be deleted.');
    }
    if (sourceWord.word !== payload.confirmationWord) {
      throw new HttpsError('failed-precondition', 'The exact word confirmation does not match.');
    }
    assertHierarchy(
      snapshotData(snapshots, sourceRefs.worldRef), snapshotData(snapshots, sourceRefs.rankRef),
      snapshotData(snapshots, sourceRefs.gateRef), source, now(), HttpsError
    );
    const result = {
      deleted: true,
      operationId: payload.operationId,
      source: { ...source },
      affectedCounts: { wordCount: 1 }
    };
    const deltas = new Map();
    addHierarchyCounterDelta(deltas, sourceRefs, -1);
    transaction.delete(sourceWordRef);
    applyCounterDeltas(transaction, snapshots, deltas, adminUid, FieldValue, HttpsError);
    setAudit(transaction, refs.auditRef, {
      action: 'delete', entityType: 'word', entityId: source.contentWordId,
      worldId: source.worldId, rankId: source.rankId, gateId: source.gateId,
      adminUid, operationId: payload.operationId,
      summary: `Deleted archived word "${sourceWord.word.slice(0, MAX_WORD_LENGTH)}".`,
      affectedCounts: { wordCount: 1 },
      before: { version: sourceWord.version, status: sourceWord.status }
    }, FieldValue);
    setCompletedReceipt(
      transaction, refs.receiptRef, receiptSnapshot.exists ? receiptSnapshot.data() : null,
      context, result, FieldValue
    );
    return result;
  });
}

async function executeBulk(dependencies, adminUid, payload) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const context = baseContext(adminUid, 'bulkUpdateContentWords', payload.operationId, payload);
  const sourceIdentity = {
    worldId: payload.worldId, rankId: payload.rankId, gateId: payload.gateId
  };
  const sourceRefs = hierarchyRefs(db, sourceIdentity);
  const targetIdentityValue = payload.action === 'move' ? {
    worldId: payload.targetWorldId,
    rankId: payload.targetRankId,
    gateId: payload.targetGateId
  } : null;
  const targetRefs = targetIdentityValue ? hierarchyRefs(db, targetIdentityValue) : null;
  const sourceWordRefs = payload.items.map((item) =>
    sourceRefs.gateRef.collection('words').doc(item.contentWordId));
  const refs = operationRefs(db, context.operationKey);

  return db.runTransaction(async (transaction) => {
    const parentReferences = [sourceRefs.worldRef, sourceRefs.rankRef, sourceRefs.gateRef];
    if (targetRefs) {
      parentReferences.push(targetRefs.worldRef, targetRefs.rankRef, targetRefs.gateRef);
    }
    const snapshots = await getSnapshots(transaction, [
      refs.receiptRef, ...parentReferences, ...sourceWordRefs
    ]);
    const receiptSnapshot = snapshots.get(refs.receiptRef.path);
    const replay = readReceipt(
      receiptSnapshot, context.fingerprint, payload.operationId, now(), HttpsError
    );
    if (replay) return replay;
    assertHierarchy(
      snapshotData(snapshots, sourceRefs.worldRef), snapshotData(snapshots, sourceRefs.rankRef),
      snapshotData(snapshots, sourceRefs.gateRef), sourceIdentity, now(), HttpsError
    );
    if (targetRefs) {
      assertHierarchy(
        snapshotData(snapshots, targetRefs.worldRef), snapshotData(snapshots, targetRefs.rankRef),
        snapshotData(snapshots, targetRefs.gateRef), targetIdentityValue, now(), HttpsError
      );
    }
    const words = payload.items.map((item, index) => assertStoredWord(
      snapshotData(snapshots, sourceWordRefs[index]),
      { ...sourceIdentity, contentWordId: item.contentWordId },
      item.expectedVersion,
      HttpsError
    ));
    for (const word of words) {
      if (word.version >= MAX_COUNT) {
        throw new HttpsError('failed-precondition', 'A selected word version cannot be incremented.');
      }
    }
    if (targetRefs) {
      const normalizedWords = new Set();
      const targetWordRefs = [];
      for (let index = 0; index < words.length; index += 1) {
        const word = words[index];
        if (normalizedWords.has(word.normalizedWord)) {
          throw new HttpsError(
            'failed-precondition',
            'The selected source words contain a normalized-word collision.'
          );
        }
        normalizedWords.add(word.normalizedWord);
        const targetWordId = createContentWordId(
          word.normalizationVersion, word.normalizedWord
        );
        const targetWordRef = targetRefs.gateRef.collection('words').doc(targetWordId);
        targetWordRefs.push(targetWordRef);
        const targetWordSnapshot = await transaction.get(targetWordRef);
        if (targetWordSnapshot.exists) {
          throw new HttpsError('already-exists', 'A selected word ID exists in the target gate.', {
            contentWordId: targetWordId
          });
        }
      }
      for (const word of words) {
        const collision = await transaction.get(
          makeCollisionQuery(targetRefs.gateRef, word.normalizedWord)
        );
        if (queryHasDocuments(collision)) {
          throw new HttpsError('already-exists', 'A selected normalized word exists in the target gate.', {
            contentWordId: word.contentWordId,
            normalizedWord: word.normalizedWord
          });
        }
      }
    }

    const itemResults = [];
    if (targetRefs) {
      const targetWordRefs = words.map((word) => targetRefs.gateRef.collection('words').doc(
        createContentWordId(word.normalizationVersion, word.normalizedWord)
      ));
      for (let index = 0; index < words.length; index += 1) {
        const moved = buildMovedWord(words[index], targetIdentityValue, adminUid, FieldValue);
        moved.contentWordId = targetWordRefs[index].id;
        transaction.delete(sourceWordRefs[index]);
        transaction.set(targetWordRefs[index], moved);
        itemResults.push({
          contentWordId: moved.contentWordId,
          version: moved.version,
          status: moved.status,
          target: { ...targetIdentityValue }
        });
      }
    } else {
      const status = payload.action === 'publish' ? 'published' : 'archived';
      for (let index = 0; index < words.length; index += 1) {
        const version = words[index].version + 1;
        transaction.update(sourceWordRefs[index], {
          status,
          version,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUid
        });
        itemResults.push({ contentWordId: words[index].contentWordId, version, status });
      }
    }
    const deltas = new Map();
    if (targetRefs) {
      addHierarchyCounterDelta(deltas, sourceRefs, -words.length);
      addHierarchyCounterDelta(deltas, targetRefs, words.length);
      applyCounterDeltas(transaction, snapshots, deltas, adminUid, FieldValue, HttpsError);
    }
    const result = {
      updated: true,
      action: payload.action,
      operationId: payload.operationId,
      itemCount: words.length,
      affectedCounts: { wordCount: targetRefs ? words.length : 0 },
      items: itemResults
    };
    setAudit(transaction, refs.auditRef, {
      action: `bulk-${payload.action}`,
      entityType: 'word-batch',
      entityId: context.operationKey,
      worldId: targetIdentityValue?.worldId || sourceIdentity.worldId,
      rankId: targetIdentityValue?.rankId || sourceIdentity.rankId,
      gateId: targetIdentityValue?.gateId || sourceIdentity.gateId,
      sourceWorldId: sourceIdentity.worldId,
      sourceRankId: sourceIdentity.rankId,
      sourceGateId: sourceIdentity.gateId,
      adminUid,
      operationId: payload.operationId,
      summary: `Bulk ${payload.action} applied to ${words.length} content words.`,
      affectedCounts: { wordCount: targetRefs ? words.length : 0 },
      itemCount: words.length,
      contentWordIds: words.map((word) => word.contentWordId)
    }, FieldValue);
    setCompletedReceipt(
      transaction, refs.receiptRef, receiptSnapshot.exists ? receiptSnapshot.data() : null,
      context, result, FieldValue
    );
    return result;
  });
}

function validateDependencies(dependencies, operationName) {
  const { db, FieldValue, HttpsError } = dependencies || {};
  if (!db || !FieldValue || typeof HttpsError !== 'function') {
    throw new TypeError(`${operationName} backend dependencies are incomplete.`);
  }
}

function makeHandler(dependencies, operationName, validate, execute) {
  validateDependencies(dependencies, operationName);
  const { HttpsError, logger = console } = dependencies;
  return async function contentWordOperation(request) {
    const adminUid = assertAdmin(request, HttpsError);
    let payload;
    try {
      payload = validate(request.data);
    } catch (error) {
      translatePayloadError(error, HttpsError);
    }
    try {
      return await execute(dependencies, adminUid, payload);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error(`Failed to execute ${operationName}.`, {
        operationId: payload.operationId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The word operation failed atomically and may be retried.', {
        operationId: payload.operationId,
        retryable: true
      });
    }
  };
}

function createDuplicateContentWordHandler(dependencies) {
  return makeHandler(
    dependencies, 'duplicateContentWord', validateDuplicateWordPayload, executeDuplicate
  );
}

function createMoveContentWordHandler(dependencies) {
  return makeHandler(dependencies, 'moveContentWord', validateMoveWordPayload, executeMove);
}

function createDeleteContentWordHandler(dependencies) {
  return makeHandler(dependencies, 'deleteContentWord', validateDeleteWordPayload, executeDelete);
}

function createBulkUpdateContentWordsHandler(dependencies) {
  return makeHandler(
    dependencies, 'bulkUpdateContentWords', validateBulkWordPayload, executeBulk
  );
}

module.exports = {
  AUDIT_COLLECTION,
  CONTENT_OPERATIONS_COLLECTION,
  GATE_COPY_OPERATION_FIELD,
  GATE_OPERATION_LOCK_FIELD,
  MAX_BULK_WORDS,
  OPERATION_LOCK_TTL_MS,
  RANK_COPY_OPERATION_FIELD,
  RANK_OPERATION_LOCK_FIELD,
  WORLD_DELETE_LOCK_FIELD,
  WORLD_OPERATION_LOCK_FIELD,
  WRITE_CHUNK_SIZE,
  WordAdminPayloadError,
  createBulkUpdateContentWordsHandler,
  createContentWordId,
  createDeleteContentWordHandler,
  createDuplicateContentWordHandler,
  createDuplicateWordId,
  createMoveContentWordHandler,
  createOperationKey,
  validateBulkWordPayload,
  validateDeleteWordPayload,
  validateDuplicateWordPayload,
  validateMoveWordPayload
};
