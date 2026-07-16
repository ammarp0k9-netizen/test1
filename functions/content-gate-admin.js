'use strict';

const { createHash } = require('node:crypto');

const CONTENT_OPERATIONS_COLLECTION = 'admin_content_operations';
const AUDIT_COLLECTION = 'admin_audit_logs';
const GATE_OPERATION_LOCK_FIELD = '_adminGateOperation';
const GATE_COPY_OPERATION_FIELD = '_adminGateCopyOperation';
const PARENT_RANK_LOCK_FIELD = '_adminRankOperation';
const RANK_COPY_OPERATION_FIELD = '_adminCopyOperation';
const WORLD_OPERATION_LOCK_FIELD = '_adminWorldOperation';
const WORLD_DELETE_LOCK_FIELD = '_deleteLock';
const OPERATION_LOCK_TTL_MS = 15 * 60 * 1000;
const WRITE_CHUNK_SIZE = 300;
const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 160;
const MAX_COUNT = 10000000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

const GATE_COPY_FIELDS = [
  'schemaVersion', 'title', 'subtitle', 'description', 'order', 'difficulty',
  'unlockConfig', 'entryAssessmentPassRatio'
];
const WORD_COPY_FIELDS = [
  'normalizationVersion', 'word', 'normalizedWord', 'wordKey', 'translation',
  'definition', 'definition_ar', 'example', 'exampleTranslation', 'category',
  'partOfSpeech', 'level', 'tags', 'synonyms', 'pronunciation', 'audioUrl',
  'imageUrl', 'notes', 'order', 'schemaVersion'
];

class GateAdminPayloadError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'GateAdminPayloadError';
    this.field = field;
  }
}

function isPlainRecord(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireAllowedKeys(data, allowedKeys) {
  if (!isPlainRecord(data)) {
    throw new GateAdminPayloadError('data', 'A request object is required.');
  }
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) {
    throw new GateAdminPayloadError('data', 'The request contains unsupported fields.');
  }
}

function requireContentId(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH ||
      !ID_PATTERN.test(value)) {
    throw new GateAdminPayloadError(
      field,
      `${field} must be a valid content identifier with at most ${MAX_ID_LENGTH} characters.`
    );
  }
  return value;
}

function requireExpectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GateAdminPayloadError(
      'expectedVersion',
      'expectedVersion must be a positive safe integer.'
    );
  }
  return value;
}

function requireOperationId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH ||
      !OPERATION_ID_PATTERN.test(value)) {
    throw new GateAdminPayloadError(
      'operationId',
      `operationId must be a safe identifier with at most ${MAX_ID_LENGTH} characters.`
    );
  }
  return value;
}

function validateDuplicateGatePayload(data) {
  requireAllowedKeys(data, new Set([
    'worldId', 'rankId', 'gateId', 'expectedVersion', 'operationId'
  ]));
  return {
    worldId: requireContentId(data.worldId, 'worldId'),
    rankId: requireContentId(data.rankId, 'rankId'),
    gateId: requireContentId(data.gateId, 'gateId'),
    expectedVersion: requireExpectedVersion(data.expectedVersion),
    operationId: requireOperationId(data.operationId)
  };
}

function validateMoveGatePayload(data) {
  requireAllowedKeys(data, new Set([
    'worldId', 'rankId', 'gateId', 'targetWorldId', 'targetRankId',
    'confirmationTitle', 'expectedVersion', 'operationId'
  ]));
  if (typeof data.confirmationTitle !== 'string' || data.confirmationTitle.length < 1 ||
      data.confirmationTitle.length > MAX_TITLE_LENGTH) {
    throw new GateAdminPayloadError(
      'confirmationTitle',
      `confirmationTitle must be a non-empty string with at most ${MAX_TITLE_LENGTH} characters.`
    );
  }
  const payload = {
    worldId: requireContentId(data.worldId, 'worldId'),
    rankId: requireContentId(data.rankId, 'rankId'),
    gateId: requireContentId(data.gateId, 'gateId'),
    targetWorldId: requireContentId(data.targetWorldId, 'targetWorldId'),
    targetRankId: requireContentId(data.targetRankId, 'targetRankId'),
    confirmationTitle: data.confirmationTitle,
    expectedVersion: requireExpectedVersion(data.expectedVersion),
    operationId: requireOperationId(data.operationId)
  };
  if (payload.worldId === payload.targetWorldId && payload.rankId === payload.targetRankId) {
    throw new GateAdminPayloadError(
      'targetRankId',
      'The source and target gate parents must be different.'
    );
  }
  return payload;
}

function validateDeleteGatePayload(data) {
  requireAllowedKeys(data, new Set([
    'worldId', 'rankId', 'gateId', 'confirmationTitle', 'expectedVersion', 'operationId'
  ]));
  if (typeof data.confirmationTitle !== 'string' || data.confirmationTitle.length < 1 ||
      data.confirmationTitle.length > MAX_TITLE_LENGTH) {
    throw new GateAdminPayloadError(
      'confirmationTitle',
      `confirmationTitle must be a non-empty string with at most ${MAX_TITLE_LENGTH} characters.`
    );
  }
  return {
    worldId: requireContentId(data.worldId, 'worldId'),
    rankId: requireContentId(data.rankId, 'rankId'),
    gateId: requireContentId(data.gateId, 'gateId'),
    confirmationTitle: data.confirmationTitle,
    expectedVersion: requireExpectedVersion(data.expectedVersion),
    operationId: requireOperationId(data.operationId)
  };
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createOperationKey(adminUid, action, operationId) {
  return hashText(`${adminUid}\0${action}\0${operationId}`);
}

function createRequestFingerprint(action, payload) {
  return hashText(JSON.stringify([
    action,
    payload.worldId,
    payload.rankId,
    payload.gateId,
    payload.targetWorldId || '',
    payload.targetRankId || '',
    payload.confirmationTitle || '',
    payload.expectedVersion
  ]));
}

function createDuplicateGateId(operationKey, sourceGateId) {
  return `gate-copy-${hashText(`${operationKey}\0gate\0${sourceGateId}`).slice(0, 40)}`;
}

function normalizeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT ? value : null;
}

function requireCounter(record, field, HttpsError) {
  const value = normalizeCount(record?.[field]);
  if (value === null) {
    throw new HttpsError('failed-precondition', `The stored ${field} counter is invalid.`);
  }
  return value;
}

function addCount(value, delta, HttpsError) {
  const current = requireCounter({ value }, 'value', HttpsError);
  if (!Number.isSafeInteger(delta) || delta < 0 || current + delta > MAX_COUNT) {
    throw new HttpsError('failed-precondition', 'A cached content counter would overflow.');
  }
  return current + delta;
}

function subtractCount(value, delta, HttpsError) {
  const current = requireCounter({ value }, 'value', HttpsError);
  if (!Number.isSafeInteger(delta) || delta < 0 || current < delta) {
    throw new HttpsError('failed-precondition', 'A cached content counter would underflow.');
  }
  return current - delta;
}

function copyFields(source, fields) {
  const result = {};
  const record = isPlainRecord(source) ? source : {};
  for (const field of fields) {
    if (Object.hasOwn(record, field) && record[field] !== undefined) result[field] = record[field];
  }
  return result;
}

function defaultCopyTitle(title) {
  const source = typeof title === 'string' && title ? title : 'Untitled gate';
  const suffix = ' (Copy)';
  return `${source.slice(0, Math.max(1, MAX_TITLE_LENGTH - suffix.length))}${suffix}`;
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
  if (error instanceof GateAdminPayloadError) {
    throw new HttpsError('invalid-argument', error.message, { field: error.field });
  }
  throw error;
}

function assertStoredGate(gate, payload, HttpsError) {
  if (!isPlainRecord(gate) || gate.worldId !== payload.worldId ||
      gate.rankId !== payload.rankId || gate.gateId !== payload.gateId) {
    throw new HttpsError('failed-precondition', 'The stored gate ancestry is invalid.');
  }
  if (!Number.isSafeInteger(gate.version) || gate.version < 1 || gate.version > MAX_COUNT) {
    throw new HttpsError('failed-precondition', 'The stored gate version is invalid.');
  }
  if (!['draft', 'published', 'archived'].includes(gate.status) ||
      typeof gate.title !== 'string' || !gate.title || gate.title.length > MAX_TITLE_LENGTH) {
    throw new HttpsError('failed-precondition', 'The stored gate status or title is invalid.');
  }
  if (gate.schemaVersion !== 1 || !Number.isSafeInteger(gate.order) || gate.order < 0 ||
      gate.order > 1000000 || normalizeCount(gate.wordCount) === null) {
    throw new HttpsError('failed-precondition', 'The stored gate schema or counters are invalid.');
  }
  const unlock = gate.unlockConfig;
  if (!isPlainRecord(unlock) ||
      !['locked', 'available'].includes(unlock.initialStatus) ||
      unlock.mode !== 'manual_placeholder' ||
      unlock.requiredMasteredRatio !== null ||
      unlock.requiredReviewingRatio !== null ||
      unlock.requiredGateCount !== null ||
      Object.keys(unlock).some((field) => ![
        'mode', 'initialStatus', 'requiredMasteredRatio',
        'requiredReviewingRatio', 'requiredGateCount'
      ].includes(field))) {
    throw new HttpsError('failed-precondition', 'The stored gate unlock placeholder is invalid.');
  }
  if (Object.hasOwn(gate, GATE_COPY_OPERATION_FIELD)) {
    throw new HttpsError('failed-precondition', 'A gate-copy reservation cannot be a source gate.');
  }
  if (!Object.hasOwn(gate, 'entryAssessmentPassRatio')) {
    // Schema-v1 legacy gates inherit the central default; copied/moved targets
    // persist the explicit null without inventing a per-gate threshold.
    gate.entryAssessmentPassRatio = null;
  } else if (gate.entryAssessmentPassRatio !== null &&
      (typeof gate.entryAssessmentPassRatio !== 'number' ||
        !Number.isFinite(gate.entryAssessmentPassRatio) ||
        gate.entryAssessmentPassRatio <= 0 || gate.entryAssessmentPassRatio > 1)) {
    throw new HttpsError('failed-precondition', 'The gate assessment pass ratio is invalid.');
  }
  if (gate.version !== payload.expectedVersion) {
    throw new HttpsError('aborted', 'The gate was changed by another request.', {
      reason: 'version-conflict',
      expectedVersion: payload.expectedVersion,
      actualVersion: gate.version
    });
  }
}

function assertStoredWorld(world, worldId, HttpsError) {
  if (!isPlainRecord(world) || world.worldId !== worldId) {
    throw new HttpsError('failed-precondition', 'The stored world identity is invalid.');
  }
  requireCounter(world, 'gateCount', HttpsError);
  requireCounter(world, 'wordCount', HttpsError);
}

function assertStoredRank(rank, worldId, rankId, HttpsError) {
  if (!isPlainRecord(rank) || rank.worldId !== worldId || rank.rankId !== rankId) {
    throw new HttpsError('failed-precondition', 'The stored rank ancestry is invalid.');
  }
  requireCounter(rank, 'gateCount', HttpsError);
  requireCounter(rank, 'wordCount', HttpsError);
  if (Object.hasOwn(rank, RANK_COPY_OPERATION_FIELD)) {
    throw new HttpsError('failed-precondition', 'A rank-copy reservation cannot accept gate operations.');
  }
}

function assertReceiptMatches(receipt, fingerprint, HttpsError) {
  if (!isPlainRecord(receipt) || receipt.fingerprint !== fingerprint) {
    throw new HttpsError(
      'already-exists',
      'operationId was already used for a different gate operation.'
    );
  }
}

function runningOperationError(operationId, HttpsError) {
  return new HttpsError('aborted', 'This gate operation is already running.', {
    operationId,
    retryable: true,
    retryAfterSeconds: Math.ceil(OPERATION_LOCK_TTL_MS / 1000)
  });
}

function assertAvailableLock(record, field, operationKey, nowMillis, HttpsError) {
  if (!isPlainRecord(record) || !Object.hasOwn(record, field)) return;
  const lock = record[field];
  if (!isPlainRecord(lock) || typeof lock.operationKey !== 'string' ||
      typeof lock.action !== 'string' || !Number.isFinite(timestampToMillis(lock.leaseAt))) {
    throw new HttpsError('failed-precondition', 'A malformed backend operation lock blocks this gate.');
  }
  if (lock.operationKey === operationKey) return;
  if (isLeaseActive(lock, nowMillis)) {
    throw new HttpsError('aborted', 'Another backend operation is using this content hierarchy.');
  }
}

function assertOwnedLock(record, field, operationKey, HttpsError) {
  const lock = isPlainRecord(record) ? record[field] : null;
  if (!isPlainRecord(lock) || lock.operationKey !== operationKey) {
    throw new HttpsError('failed-precondition', 'A required backend operation lock changed.');
  }
}

function assertNoActiveWorldDeleteLock(world, nowMillis, HttpsError) {
  if (!Object.hasOwn(world, WORLD_DELETE_LOCK_FIELD)) return;
  const lock = world[WORLD_DELETE_LOCK_FIELD];
  const requestedAt = isPlainRecord(lock) ? timestampToMillis(lock.requestedAt) : Number.NaN;
  if (!Number.isFinite(requestedAt)) {
    throw new HttpsError(
      'failed-precondition',
      'A malformed world-deletion lock blocks this gate operation.'
    );
  }
  // A well-formed lock older than the shared callable safety window is stale
  // and may be superseded. Active/future locks always block gate operations.
  if (nowMillis - requestedAt < OPERATION_LOCK_TTL_MS) {
    throw new HttpsError('aborted', 'The content world is being deleted.');
  }
}

function assertWorldAvailable(world, operationKey, nowMillis, HttpsError) {
  assertNoActiveWorldDeleteLock(world, nowMillis, HttpsError);
  assertAvailableLock(
    world, WORLD_OPERATION_LOCK_FIELD, operationKey, nowMillis, HttpsError
  );
}

function buildLock(operationKey, action, FieldValue) {
  return { operationKey, action, leaseAt: FieldValue.serverTimestamp() };
}

function makeSourceRefs(db, payload, operationKey) {
  const worldRef = db.collection('content_worlds').doc(payload.worldId);
  const rankRef = worldRef.collection('ranks').doc(payload.rankId);
  return {
    sourceWorldRef: worldRef,
    sourceRankRef: rankRef,
    sourceGateRef: rankRef.collection('gates').doc(payload.gateId),
    receiptRef: db.collection(CONTENT_OPERATIONS_COLLECTION).doc(operationKey),
    auditRef: db.collection(AUDIT_COLLECTION).doc(operationKey)
  };
}

function makeTargetRefs(db, payload, targetGateId) {
  const targetWorldId = payload.targetWorldId || payload.worldId;
  const targetRankId = payload.targetRankId || payload.rankId;
  const worldRef = db.collection('content_worlds').doc(targetWorldId);
  const rankRef = worldRef.collection('ranks').doc(targetRankId);
  return {
    targetWorldRef: worldRef,
    targetRankRef: rankRef,
    targetGateRef: rankRef.collection('gates').doc(targetGateId)
  };
}

function uniqueReferences(references) {
  const result = new Map();
  for (const reference of references) {
    if (reference) result.set(reference.path, reference);
  }
  return [...result.values()];
}

async function getSnapshots(transaction, references) {
  const snapshots = new Map();
  for (const reference of uniqueReferences(references)) {
    snapshots.set(reference.path, await transaction.get(reference));
  }
  return snapshots;
}

function snapshotFor(snapshots, reference) {
  return snapshots.get(reference.path);
}

async function* iterateDocuments(collectionReference) {
  if (typeof collectionReference.stream === 'function') {
    for await (const document of collectionReference.stream()) yield document;
    return;
  }
  const snapshot = await collectionReference.get();
  for (const document of snapshot.docs) yield document;
}

async function countGateWords(gateRef, HttpsError) {
  let count = 0;
  for await (const ignored of iterateDocuments(gateRef.collection('words'))) {
    void ignored;
    count += 1;
    if (count > MAX_COUNT) {
      throw new HttpsError('resource-exhausted', 'The gate contains too many words.');
    }
  }
  return count;
}

function buildDuplicateGate(source, payload, gateId, adminUid, operationKey, FieldValue) {
  return {
    ...copyFields(source, GATE_COPY_FIELDS),
    worldId: payload.worldId,
    rankId: payload.rankId,
    gateId,
    title: defaultCopyTitle(source.title),
    status: 'draft',
    version: 1,
    wordCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: adminUid,
    updatedBy: adminUid,
    [GATE_COPY_OPERATION_FIELD]: operationKey
  };
}

function buildMovedGate(source, payload, adminUid, operationKey, FieldValue) {
  return {
    ...copyFields(source, GATE_COPY_FIELDS),
    worldId: payload.targetWorldId,
    rankId: payload.targetRankId,
    gateId: payload.gateId,
    // Keep a partial target out of published reads until finalization.
    status: 'draft',
    version: source.version + 1,
    wordCount: 0,
    createdAt: source.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: source.createdBy || adminUid,
    updatedBy: adminUid,
    [GATE_COPY_OPERATION_FIELD]: operationKey
  };
}

function buildDuplicateWord(source, payload, targetGateId, wordId, adminUid, FieldValue) {
  return {
    ...copyFields(source, WORD_COPY_FIELDS),
    worldId: payload.worldId,
    rankId: payload.rankId,
    gateId: targetGateId,
    contentWordId: wordId,
    status: 'draft',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: adminUid,
    updatedBy: adminUid
  };
}

function buildMovedWord(source, payload, wordId, adminUid, FieldValue) {
  return {
    ...copyFields(source, WORD_COPY_FIELDS),
    worldId: payload.targetWorldId,
    rankId: payload.targetRankId,
    gateId: payload.gateId,
    contentWordId: wordId,
    status: source.status,
    createdAt: source.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: source.createdBy || adminUid,
    updatedBy: adminUid
  };
}

async function copyGateWords(dependencies, context, payload, mode) {
  const { db, FieldValue, HttpsError } = dependencies;
  const writer = db.bulkWriter();
  const pending = [];
  const sourceWordIds = new Set();
  let wordCount = 0;
  let failure = null;

  async function flush() {
    if (pending.length === 0) return;
    await Promise.all(pending.splice(0));
  }

  function queue(promise) {
    pending.push(promise);
  }

  try {
    for await (const wordDocument of iterateDocuments(context.sourceGateRef.collection('words'))) {
      const wordId = wordDocument.id;
      if (!ID_PATTERN.test(wordId) || wordId.length > MAX_ID_LENGTH) {
        throw new HttpsError('failed-precondition', 'A source content-word ID is invalid.');
      }
      sourceWordIds.add(wordId);
      wordCount += 1;
      if (wordCount > MAX_COUNT) {
        throw new HttpsError('resource-exhausted', 'The gate contains too many words.');
      }
      const targetWordRef = context.targetGateRef.collection('words').doc(wordId);
      const data = mode === 'move'
        ? buildMovedWord(wordDocument.data(), payload, wordId, context.adminUid, FieldValue)
        : buildDuplicateWord(
          wordDocument.data(), payload, context.targetGateRef.id, wordId,
          context.adminUid, FieldValue
        );
      queue(writer.set(targetWordRef, data));
      if (pending.length >= WRITE_CHUNK_SIZE) await flush();
    }
    await flush();

    // A failed earlier attempt may have left a partial deterministic target.
    // Streaming it and removing entries no longer in the source makes retries exact.
    for await (const targetWord of iterateDocuments(context.targetGateRef.collection('words'))) {
      if (!sourceWordIds.has(targetWord.id)) {
        queue(writer.delete(targetWord.ref));
        if (pending.length >= WRITE_CHUNK_SIZE) await flush();
      }
    }
    await flush();
  } catch (error) {
    failure = error;
  }

  try {
    await writer.close();
  } catch (error) {
    if (!failure) failure = error;
  }
  if (failure) throw failure;
  return wordCount;
}

async function markOperationFailed(dependencies, context, error) {
  const { db, FieldValue, logger = console } = dependencies;
  try {
    await db.runTransaction(async (transaction) => {
      const lockFieldsByPath = new Map();
      for (const reference of uniqueReferences([
        context.sourceWorldRef, context.targetWorldRef
      ])) {
        lockFieldsByPath.set(reference.path, {
          reference, field: WORLD_OPERATION_LOCK_FIELD
        });
      }
      for (const reference of uniqueReferences([
        context.sourceRankRef, context.targetRankRef
      ])) {
        lockFieldsByPath.set(reference.path, {
          reference, field: PARENT_RANK_LOCK_FIELD
        });
      }
      if (context.sourceGateRef) {
        lockFieldsByPath.set(context.sourceGateRef.path, {
          reference: context.sourceGateRef, field: GATE_OPERATION_LOCK_FIELD
        });
      }
      const lockEntries = [...lockFieldsByPath.values()];
      const snapshots = await getSnapshots(transaction, [
        context.receiptRef,
        ...lockEntries.map((entry) => entry.reference)
      ]);
      const receiptSnapshot = snapshotFor(snapshots, context.receiptRef);
      if (!receiptSnapshot?.exists) return;
      const receipt = receiptSnapshot.data();
      if (receipt.fingerprint !== context.fingerprint || receipt.status === 'completed') return;
      // Keep every owned hierarchy lock after a failed non-atomic phase. The
      // same operationId can retry immediately (receipt status is "failed"),
      // while another callable cannot mutate the hierarchy before resume.
      for (const { reference, field } of lockEntries) {
        const snapshot = snapshotFor(snapshots, reference);
        const lock = snapshot?.exists ? snapshot.data()[field] : null;
        if (isPlainRecord(lock) && lock.operationKey === context.operationKey) {
          transaction.update(reference, {
            [field]: {
              operationKey: lock.operationKey,
              action: lock.action,
              leaseAt: FieldValue.serverTimestamp()
            }
          });
        }
      }
      transaction.update(context.receiptRef, {
        status: 'failed',
        errorCode: safeErrorName(error),
        updatedAt: FieldValue.serverTimestamp(),
        leaseAt: FieldValue.serverTimestamp()
      });
    });
  } catch (cleanupError) {
    logger.error('Failed to mark a gate operation for retry.', {
      operationId: context.operationId,
      error: safeErrorName(cleanupError)
    });
  }
}

function readCompletedOrRunning(receiptSnapshot, fingerprint, operationId, now, HttpsError) {
  if (!receiptSnapshot.exists) return null;
  const receipt = receiptSnapshot.data();
  assertReceiptMatches(receipt, fingerprint, HttpsError);
  if (receipt.status === 'completed') {
    if (!isPlainRecord(receipt.result)) {
      throw new HttpsError('internal', 'The completed gate-operation receipt is corrupt.');
    }
    return { replay: receipt.result };
  }
  if (receipt.status === 'running') {
    if (!Number.isFinite(timestampToMillis(receipt.leaseAt))) {
      throw new HttpsError('failed-precondition', 'The gate-operation lease is corrupt.');
    }
    if (isLeaseActive(receipt, now())) {
      throw runningOperationError(operationId, HttpsError);
    }
  } else if (receipt.status !== 'failed') {
    throw new HttpsError('failed-precondition', 'The gate-operation receipt status is corrupt.');
  }
  return { previous: receipt };
}

async function prepareDuplicate(dependencies, adminUid, payload) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const action = 'duplicateContentGate';
  const operationKey = createOperationKey(adminUid, action, payload.operationId);
  const fingerprint = createRequestFingerprint(action, payload);
  const sourceRefs = makeSourceRefs(db, payload, operationKey);
  const targetGateId = createDuplicateGateId(operationKey, payload.gateId);
  const targetRefs = makeTargetRefs(db, payload, targetGateId);

  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      sourceRefs.receiptRef, sourceRefs.sourceWorldRef, sourceRefs.sourceRankRef,
      sourceRefs.sourceGateRef, targetRefs.targetGateRef
    ]);
    const receiptSnapshot = snapshotFor(snapshots, sourceRefs.receiptRef);
    const receiptState = readCompletedOrRunning(
      receiptSnapshot, fingerprint, payload.operationId, now, HttpsError
    );
    if (receiptState?.replay) return receiptState;
    const worldSnapshot = snapshotFor(snapshots, sourceRefs.sourceWorldRef);
    const rankSnapshot = snapshotFor(snapshots, sourceRefs.sourceRankRef);
    const gateSnapshot = snapshotFor(snapshots, sourceRefs.sourceGateRef);
    const targetSnapshot = snapshotFor(snapshots, targetRefs.targetGateRef);
    if (!worldSnapshot.exists || !rankSnapshot.exists || !gateSnapshot.exists) {
      throw new HttpsError('not-found', 'The source gate hierarchy does not exist.');
    }
    const world = worldSnapshot.data();
    const rank = rankSnapshot.data();
    const gate = gateSnapshot.data();
    assertStoredWorld(world, payload.worldId, HttpsError);
    assertStoredRank(rank, payload.worldId, payload.rankId, HttpsError);
    assertStoredGate(gate, payload, HttpsError);
    assertWorldAvailable(world, operationKey, now(), HttpsError);
    assertAvailableLock(rank, PARENT_RANK_LOCK_FIELD, operationKey, now(), HttpsError);
    assertAvailableLock(gate, GATE_OPERATION_LOCK_FIELD, operationKey, now(), HttpsError);
    if (targetSnapshot.exists &&
        targetSnapshot.data()[GATE_COPY_OPERATION_FIELD] !== operationKey) {
      throw new HttpsError('already-exists', 'The deterministic target gate ID is occupied.');
    }

    const lock = buildLock(operationKey, action, FieldValue);
    transaction.update(sourceRefs.sourceWorldRef, { [WORLD_OPERATION_LOCK_FIELD]: lock });
    transaction.update(sourceRefs.sourceRankRef, { [PARENT_RANK_LOCK_FIELD]: lock });
    transaction.update(sourceRefs.sourceGateRef, { [GATE_OPERATION_LOCK_FIELD]: lock });
    if (!targetSnapshot.exists) {
      transaction.set(
        targetRefs.targetGateRef,
        buildDuplicateGate(gate, payload, targetGateId, adminUid, operationKey, FieldValue)
      );
    }
    transaction.set(sourceRefs.receiptRef, {
      action,
      status: 'running',
      operationId: payload.operationId,
      fingerprint,
      adminUid,
      worldId: payload.worldId,
      rankId: payload.rankId,
      gateId: payload.gateId,
      targetGateId,
      context: {
        title: gate.title,
        version: gate.version,
        wordCount: Number.isSafeInteger(receiptState?.previous?.context?.wordCount)
          ? receiptState.previous.context.wordCount
          : null
      },
      leaseAt: FieldValue.serverTimestamp(),
      createdAt: receiptState?.previous?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return {
      ...sourceRefs,
      ...targetRefs,
      adminUid,
      operationId: payload.operationId,
      operationKey,
      fingerprint,
      targetGateId,
      sourceTitle: gate.title
    };
  });
}

async function recordDuplicateCount(dependencies, context, payload, wordCount) {
  const { db, FieldValue, HttpsError } = dependencies;
  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      context.receiptRef, context.sourceWorldRef, context.sourceRankRef,
      context.sourceGateRef, context.targetGateRef
    ]);
    const receiptSnapshot = snapshotFor(snapshots, context.receiptRef);
    if (!receiptSnapshot.exists) throw new HttpsError('internal', 'The operation receipt is missing.');
    const receipt = receiptSnapshot.data();
    assertReceiptMatches(receipt, context.fingerprint, HttpsError);
    if (receipt.status === 'completed') return receipt.result;
    const world = snapshotFor(snapshots, context.sourceWorldRef).data();
    const rank = snapshotFor(snapshots, context.sourceRankRef).data();
    const gate = snapshotFor(snapshots, context.sourceGateRef).data();
    const target = snapshotFor(snapshots, context.targetGateRef).data();
    assertStoredWorld(world, payload.worldId, HttpsError);
    assertStoredRank(rank, payload.worldId, payload.rankId, HttpsError);
    assertStoredGate(gate, payload, HttpsError);
    assertOwnedLock(world, WORLD_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(rank, PARENT_RANK_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(gate, GATE_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    if (!isPlainRecord(target) || target[GATE_COPY_OPERATION_FIELD] !== context.operationKey) {
      throw new HttpsError('failed-precondition', 'The duplicate gate reservation changed.');
    }
    addCount(rank.gateCount, 1, HttpsError);
    addCount(rank.wordCount, wordCount, HttpsError);
    addCount(world.gateCount, 1, HttpsError);
    addCount(world.wordCount, wordCount, HttpsError);
    transaction.update(context.receiptRef, {
      'context': { title: context.sourceTitle, version: payload.expectedVersion, wordCount },
      updatedAt: FieldValue.serverTimestamp(),
      leaseAt: FieldValue.serverTimestamp()
    });
    return null;
  });
}

async function finalizeDuplicate(dependencies, context, payload, wordCount) {
  const { db, FieldValue, HttpsError } = dependencies;
  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      context.receiptRef, context.sourceWorldRef, context.sourceRankRef,
      context.sourceGateRef, context.targetGateRef
    ]);
    const receipt = snapshotFor(snapshots, context.receiptRef).data();
    assertReceiptMatches(receipt, context.fingerprint, HttpsError);
    if (receipt.status === 'completed') return receipt.result;
    const world = snapshotFor(snapshots, context.sourceWorldRef).data();
    const rank = snapshotFor(snapshots, context.sourceRankRef).data();
    const gate = snapshotFor(snapshots, context.sourceGateRef).data();
    const target = snapshotFor(snapshots, context.targetGateRef).data();
    assertStoredWorld(world, payload.worldId, HttpsError);
    assertStoredRank(rank, payload.worldId, payload.rankId, HttpsError);
    assertStoredGate(gate, payload, HttpsError);
    assertOwnedLock(world, WORLD_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(rank, PARENT_RANK_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(gate, GATE_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    if (!isPlainRecord(target) || target[GATE_COPY_OPERATION_FIELD] !== context.operationKey) {
      throw new HttpsError('failed-precondition', 'The duplicate gate reservation changed.');
    }
    const result = {
      duplicated: true,
      operationId: payload.operationId,
      worldId: payload.worldId,
      rankId: payload.rankId,
      sourceGateId: payload.gateId,
      gateId: context.targetGateId,
      affectedCounts: { gateCount: 1, wordCount },
      gate: {
        ...copyFields(target, GATE_COPY_FIELDS),
        worldId: payload.worldId,
        rankId: payload.rankId,
        gateId: context.targetGateId,
        status: 'draft',
        version: 1,
        wordCount,
        createdBy: target.createdBy,
        updatedBy: context.adminUid
      }
    };
    transaction.update(context.targetGateRef, {
      wordCount,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid,
      [GATE_COPY_OPERATION_FIELD]: FieldValue.delete()
    });
    transaction.update(context.sourceGateRef, {
      [GATE_OPERATION_LOCK_FIELD]: FieldValue.delete()
    });
    transaction.update(context.sourceRankRef, {
      gateCount: addCount(rank.gateCount, 1, HttpsError),
      wordCount: addCount(rank.wordCount, wordCount, HttpsError),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid,
      [PARENT_RANK_LOCK_FIELD]: FieldValue.delete()
    });
    transaction.update(context.sourceWorldRef, {
      gateCount: addCount(world.gateCount, 1, HttpsError),
      wordCount: addCount(world.wordCount, wordCount, HttpsError),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid,
      [WORLD_OPERATION_LOCK_FIELD]: FieldValue.delete()
    });
    transaction.set(context.auditRef, {
      createdAt: FieldValue.serverTimestamp(),
      action: 'duplicate',
      entityType: 'gate',
      entityId: context.targetGateId,
      worldId: payload.worldId,
      rankId: payload.rankId,
      gateId: context.targetGateId,
      sourceGateId: payload.gateId,
      adminUid: context.adminUid,
      operationId: payload.operationId,
      summary: `Duplicated gate "${String(context.sourceTitle || '').slice(0, MAX_TITLE_LENGTH)}" as draft.`,
      affectedCounts: { gateCount: 1, wordCount },
      after: { title: result.gate.title, status: 'draft', version: 1, wordCount }
    });
    transaction.update(context.receiptRef, {
      status: 'completed',
      result,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return result;
  });
}

async function prepareDelete(dependencies, adminUid, payload) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const action = 'deleteContentGate';
  const operationKey = createOperationKey(adminUid, action, payload.operationId);
  const fingerprint = createRequestFingerprint(action, payload);
  const refs = makeSourceRefs(db, payload, operationKey);

  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      refs.receiptRef, refs.sourceWorldRef, refs.sourceRankRef, refs.sourceGateRef
    ]);
    const receiptSnapshot = snapshotFor(snapshots, refs.receiptRef);
    const receiptState = readCompletedOrRunning(
      receiptSnapshot, fingerprint, payload.operationId, now, HttpsError
    );
    if (receiptState?.replay) return receiptState;
    const worldSnapshot = snapshotFor(snapshots, refs.sourceWorldRef);
    const rankSnapshot = snapshotFor(snapshots, refs.sourceRankRef);
    const gateSnapshot = snapshotFor(snapshots, refs.sourceGateRef);
    if (!worldSnapshot.exists || !rankSnapshot.exists) {
      throw new HttpsError('not-found', 'The source gate parents do not exist.');
    }
    const world = worldSnapshot.data();
    const rank = rankSnapshot.data();
    assertStoredWorld(world, payload.worldId, HttpsError);
    assertStoredRank(rank, payload.worldId, payload.rankId, HttpsError);
    assertWorldAvailable(world, operationKey, now(), HttpsError);
    assertAvailableLock(rank, PARENT_RANK_LOCK_FIELD, operationKey, now(), HttpsError);
    const previousContext = receiptState?.previous?.context;
    if (!gateSnapshot.exists) {
      if (!isPlainRecord(previousContext) || !Number.isSafeInteger(previousContext.wordCount)) {
        throw new HttpsError('not-found', 'The content gate does not exist.');
      }
      const lock = buildLock(operationKey, action, FieldValue);
      transaction.update(refs.sourceWorldRef, { [WORLD_OPERATION_LOCK_FIELD]: lock });
      transaction.update(refs.sourceRankRef, { [PARENT_RANK_LOCK_FIELD]: lock });
      transaction.set(refs.receiptRef, {
        ...receiptState.previous,
        status: 'running',
        leaseAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      return {
        ...refs, adminUid, operationId: payload.operationId, operationKey, fingerprint,
        sourceTitle: previousContext.title,
        wordCount: previousContext.wordCount,
        sourceMissing: true
      };
    }

    const gate = gateSnapshot.data();
    assertStoredGate(gate, payload, HttpsError);
    if (gate.status !== 'archived') {
      throw new HttpsError('failed-precondition', 'The content gate must be archived first.');
    }
    if (gate.title !== payload.confirmationTitle) {
      throw new HttpsError(
        'failed-precondition',
        'The confirmation title does not exactly match the archived gate title.'
      );
    }
    assertAvailableLock(gate, GATE_OPERATION_LOCK_FIELD, operationKey, now(), HttpsError);
    const lock = buildLock(operationKey, action, FieldValue);
    transaction.update(refs.sourceWorldRef, { [WORLD_OPERATION_LOCK_FIELD]: lock });
    transaction.update(refs.sourceRankRef, { [PARENT_RANK_LOCK_FIELD]: lock });
    transaction.update(refs.sourceGateRef, { [GATE_OPERATION_LOCK_FIELD]: lock });
    transaction.set(refs.receiptRef, {
      action,
      status: 'running',
      operationId: payload.operationId,
      fingerprint,
      adminUid,
      worldId: payload.worldId,
      rankId: payload.rankId,
      gateId: payload.gateId,
      context: {
        title: gate.title,
        version: gate.version,
        wordCount: Number.isSafeInteger(previousContext?.wordCount)
          ? previousContext.wordCount
          : null
      },
      leaseAt: FieldValue.serverTimestamp(),
      createdAt: receiptState?.previous?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return {
      ...refs, adminUid, operationId: payload.operationId, operationKey, fingerprint,
      sourceTitle: gate.title,
      wordCount: Number.isSafeInteger(previousContext?.wordCount) ? previousContext.wordCount : null,
      sourceMissing: false
    };
  });
}

async function recordDeleteCount(dependencies, context, payload, wordCount) {
  const { db, FieldValue, HttpsError } = dependencies;
  await db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      context.receiptRef, context.sourceWorldRef, context.sourceRankRef, context.sourceGateRef
    ]);
    const receipt = snapshotFor(snapshots, context.receiptRef).data();
    assertReceiptMatches(receipt, context.fingerprint, HttpsError);
    const world = snapshotFor(snapshots, context.sourceWorldRef).data();
    const rank = snapshotFor(snapshots, context.sourceRankRef).data();
    const gateSnapshot = snapshotFor(snapshots, context.sourceGateRef);
    assertStoredWorld(world, payload.worldId, HttpsError);
    assertStoredRank(rank, payload.worldId, payload.rankId, HttpsError);
    assertOwnedLock(world, WORLD_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(rank, PARENT_RANK_LOCK_FIELD, context.operationKey, HttpsError);
    subtractCount(rank.gateCount, 1, HttpsError);
    subtractCount(rank.wordCount, wordCount, HttpsError);
    subtractCount(world.gateCount, 1, HttpsError);
    subtractCount(world.wordCount, wordCount, HttpsError);
    if (gateSnapshot.exists) {
      const gate = gateSnapshot.data();
      assertStoredGate(gate, payload, HttpsError);
      assertOwnedLock(gate, GATE_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    }
    transaction.update(context.receiptRef, {
      context: { title: context.sourceTitle, version: payload.expectedVersion, wordCount },
      updatedAt: FieldValue.serverTimestamp(),
      leaseAt: FieldValue.serverTimestamp()
    });
  });
}

async function finalizeDelete(dependencies, context, payload, wordCount) {
  const { db, FieldValue, HttpsError } = dependencies;
  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      context.receiptRef, context.sourceWorldRef, context.sourceRankRef, context.sourceGateRef
    ]);
    const receipt = snapshotFor(snapshots, context.receiptRef).data();
    assertReceiptMatches(receipt, context.fingerprint, HttpsError);
    if (receipt.status === 'completed') return receipt.result;
    if (snapshotFor(snapshots, context.sourceGateRef).exists) {
      throw new HttpsError('failed-precondition', 'The gate still exists after recursive deletion.');
    }
    const world = snapshotFor(snapshots, context.sourceWorldRef).data();
    const rank = snapshotFor(snapshots, context.sourceRankRef).data();
    assertStoredWorld(world, payload.worldId, HttpsError);
    assertStoredRank(rank, payload.worldId, payload.rankId, HttpsError);
    assertOwnedLock(world, WORLD_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(rank, PARENT_RANK_LOCK_FIELD, context.operationKey, HttpsError);
    const result = {
      deleted: true,
      operationId: payload.operationId,
      worldId: payload.worldId,
      rankId: payload.rankId,
      gateId: payload.gateId,
      affectedCounts: { gateCount: 1, wordCount }
    };
    transaction.update(context.sourceRankRef, {
      gateCount: subtractCount(rank.gateCount, 1, HttpsError),
      wordCount: subtractCount(rank.wordCount, wordCount, HttpsError),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid,
      [PARENT_RANK_LOCK_FIELD]: FieldValue.delete()
    });
    transaction.update(context.sourceWorldRef, {
      gateCount: subtractCount(world.gateCount, 1, HttpsError),
      wordCount: subtractCount(world.wordCount, wordCount, HttpsError),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid,
      [WORLD_OPERATION_LOCK_FIELD]: FieldValue.delete()
    });
    transaction.set(context.auditRef, {
      createdAt: FieldValue.serverTimestamp(),
      action: 'delete',
      entityType: 'gate',
      entityId: payload.gateId,
      worldId: payload.worldId,
      rankId: payload.rankId,
      gateId: payload.gateId,
      adminUid: context.adminUid,
      operationId: payload.operationId,
      summary: `Deleted archived gate "${String(context.sourceTitle || '').slice(0, MAX_TITLE_LENGTH)}".`,
      affectedCounts: { gateCount: 1, wordCount },
      before: { title: context.sourceTitle, version: payload.expectedVersion, wordCount }
    });
    transaction.update(context.receiptRef, {
      status: 'completed',
      result,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return result;
  });
}

async function prepareMove(dependencies, adminUid, payload) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const action = 'moveContentGate';
  const operationKey = createOperationKey(adminUid, action, payload.operationId);
  const fingerprint = createRequestFingerprint(action, payload);
  const sourceRefs = makeSourceRefs(db, payload, operationKey);
  const targetRefs = makeTargetRefs(db, payload, payload.gateId);

  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      sourceRefs.receiptRef, sourceRefs.sourceWorldRef, sourceRefs.sourceRankRef,
      sourceRefs.sourceGateRef, targetRefs.targetWorldRef, targetRefs.targetRankRef,
      targetRefs.targetGateRef
    ]);
    const receiptSnapshot = snapshotFor(snapshots, sourceRefs.receiptRef);
    const receiptState = readCompletedOrRunning(
      receiptSnapshot, fingerprint, payload.operationId, now, HttpsError
    );
    if (receiptState?.replay) return receiptState;
    const sourceWorldSnapshot = snapshotFor(snapshots, sourceRefs.sourceWorldRef);
    const sourceRankSnapshot = snapshotFor(snapshots, sourceRefs.sourceRankRef);
    const sourceGateSnapshot = snapshotFor(snapshots, sourceRefs.sourceGateRef);
    const targetWorldSnapshot = snapshotFor(snapshots, targetRefs.targetWorldRef);
    const targetRankSnapshot = snapshotFor(snapshots, targetRefs.targetRankRef);
    const targetGateSnapshot = snapshotFor(snapshots, targetRefs.targetGateRef);
    if (!sourceWorldSnapshot.exists || !sourceRankSnapshot.exists ||
        !targetWorldSnapshot.exists || !targetRankSnapshot.exists) {
      throw new HttpsError('not-found', 'A source or target gate parent does not exist.');
    }
    const sourceWorld = sourceWorldSnapshot.data();
    const sourceRank = sourceRankSnapshot.data();
    const targetWorld = targetWorldSnapshot.data();
    const targetRank = targetRankSnapshot.data();
    assertStoredWorld(sourceWorld, payload.worldId, HttpsError);
    assertStoredRank(sourceRank, payload.worldId, payload.rankId, HttpsError);
    assertStoredWorld(targetWorld, payload.targetWorldId, HttpsError);
    assertStoredRank(targetRank, payload.targetWorldId, payload.targetRankId, HttpsError);
    assertWorldAvailable(sourceWorld, operationKey, now(), HttpsError);
    assertWorldAvailable(targetWorld, operationKey, now(), HttpsError);
    assertAvailableLock(
      sourceRank, PARENT_RANK_LOCK_FIELD, operationKey, now(), HttpsError
    );
    assertAvailableLock(
      targetRank, PARENT_RANK_LOCK_FIELD, operationKey, now(), HttpsError
    );
    const previousContext = receiptState?.previous?.context;

    if (!sourceGateSnapshot.exists) {
      if (!isPlainRecord(previousContext) || !Number.isSafeInteger(previousContext.wordCount) ||
          !targetGateSnapshot.exists ||
          targetGateSnapshot.data()[GATE_COPY_OPERATION_FIELD] !== operationKey) {
        throw new HttpsError('not-found', 'The source gate does not exist.');
      }
      const lock = buildLock(operationKey, action, FieldValue);
      for (const worldRef of uniqueReferences([
        sourceRefs.sourceWorldRef, targetRefs.targetWorldRef
      ])) {
        transaction.update(worldRef, { [WORLD_OPERATION_LOCK_FIELD]: lock });
      }
      transaction.update(sourceRefs.sourceRankRef, { [PARENT_RANK_LOCK_FIELD]: lock });
      transaction.update(targetRefs.targetRankRef, { [PARENT_RANK_LOCK_FIELD]: lock });
      transaction.set(sourceRefs.receiptRef, {
        ...receiptState.previous,
        status: 'running',
        leaseAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      return {
        ...sourceRefs, ...targetRefs, adminUid, operationId: payload.operationId,
        operationKey, fingerprint, sourceTitle: previousContext.title,
        sourceStatus: previousContext.status,
        wordCount: previousContext.wordCount, sourceMissing: true
      };
    }

    const sourceGate = sourceGateSnapshot.data();
    assertStoredGate(sourceGate, payload, HttpsError);
    if (sourceGate.title !== payload.confirmationTitle) {
      throw new HttpsError(
        'failed-precondition',
        'The confirmation title does not exactly match the gate being moved.'
      );
    }
    if (sourceGate.version >= MAX_COUNT) {
      throw new HttpsError('failed-precondition', 'The moved gate version would overflow.');
    }
    assertAvailableLock(
      sourceGate, GATE_OPERATION_LOCK_FIELD, operationKey, now(), HttpsError
    );
    if (targetGateSnapshot.exists &&
        targetGateSnapshot.data()[GATE_COPY_OPERATION_FIELD] !== operationKey) {
      throw new HttpsError('already-exists', 'The target rank already contains this gate ID.');
    }
    const lock = buildLock(operationKey, action, FieldValue);
    for (const worldRef of uniqueReferences([
      sourceRefs.sourceWorldRef, targetRefs.targetWorldRef
    ])) {
      transaction.update(worldRef, { [WORLD_OPERATION_LOCK_FIELD]: lock });
    }
    transaction.update(sourceRefs.sourceRankRef, { [PARENT_RANK_LOCK_FIELD]: lock });
    transaction.update(targetRefs.targetRankRef, { [PARENT_RANK_LOCK_FIELD]: lock });
    transaction.update(sourceRefs.sourceGateRef, { [GATE_OPERATION_LOCK_FIELD]: lock });
    if (!targetGateSnapshot.exists) {
      transaction.set(
        targetRefs.targetGateRef,
        buildMovedGate(sourceGate, payload, adminUid, operationKey, FieldValue)
      );
    }
    transaction.set(sourceRefs.receiptRef, {
      action,
      status: 'running',
      operationId: payload.operationId,
      fingerprint,
      adminUid,
      worldId: payload.worldId,
      rankId: payload.rankId,
      gateId: payload.gateId,
      targetWorldId: payload.targetWorldId,
      targetRankId: payload.targetRankId,
      context: {
        title: sourceGate.title,
        status: sourceGate.status,
        version: sourceGate.version,
        targetVersion: sourceGate.version + 1,
        wordCount: Number.isSafeInteger(previousContext?.wordCount)
          ? previousContext.wordCount
          : null
      },
      leaseAt: FieldValue.serverTimestamp(),
      createdAt: receiptState?.previous?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return {
      ...sourceRefs, ...targetRefs, adminUid, operationId: payload.operationId,
      operationKey, fingerprint, sourceTitle: sourceGate.title,
      sourceStatus: sourceGate.status,
      wordCount: Number.isSafeInteger(previousContext?.wordCount) ? previousContext.wordCount : null,
      sourceMissing: false
    };
  });
}

async function recordMoveCount(dependencies, context, payload, wordCount) {
  const { db, FieldValue, HttpsError } = dependencies;
  await db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      context.receiptRef, context.sourceWorldRef, context.sourceRankRef,
      context.sourceGateRef, context.targetWorldRef, context.targetRankRef,
      context.targetGateRef
    ]);
    const receipt = snapshotFor(snapshots, context.receiptRef).data();
    assertReceiptMatches(receipt, context.fingerprint, HttpsError);
    const sourceWorld = snapshotFor(snapshots, context.sourceWorldRef).data();
    const sourceRank = snapshotFor(snapshots, context.sourceRankRef).data();
    const targetWorld = snapshotFor(snapshots, context.targetWorldRef).data();
    const targetRank = snapshotFor(snapshots, context.targetRankRef).data();
    const sourceGateSnapshot = snapshotFor(snapshots, context.sourceGateRef);
    const targetGate = snapshotFor(snapshots, context.targetGateRef).data();
    assertStoredWorld(sourceWorld, payload.worldId, HttpsError);
    assertStoredRank(sourceRank, payload.worldId, payload.rankId, HttpsError);
    assertStoredWorld(targetWorld, payload.targetWorldId, HttpsError);
    assertStoredRank(targetRank, payload.targetWorldId, payload.targetRankId, HttpsError);
    assertOwnedLock(sourceWorld, WORLD_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(targetWorld, WORLD_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(sourceRank, PARENT_RANK_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(targetRank, PARENT_RANK_LOCK_FIELD, context.operationKey, HttpsError);
    subtractCount(sourceRank.gateCount, 1, HttpsError);
    subtractCount(sourceRank.wordCount, wordCount, HttpsError);
    addCount(targetRank.gateCount, 1, HttpsError);
    addCount(targetRank.wordCount, wordCount, HttpsError);
    if (payload.worldId !== payload.targetWorldId) {
      subtractCount(sourceWorld.gateCount, 1, HttpsError);
      subtractCount(sourceWorld.wordCount, wordCount, HttpsError);
      addCount(targetWorld.gateCount, 1, HttpsError);
      addCount(targetWorld.wordCount, wordCount, HttpsError);
    }
    if (sourceGateSnapshot.exists) {
      const sourceGate = sourceGateSnapshot.data();
      assertStoredGate(sourceGate, payload, HttpsError);
      assertOwnedLock(
        sourceGate, GATE_OPERATION_LOCK_FIELD, context.operationKey, HttpsError
      );
    }
    if (!isPlainRecord(targetGate) ||
        targetGate[GATE_COPY_OPERATION_FIELD] !== context.operationKey) {
      throw new HttpsError('failed-precondition', 'The moved gate reservation changed.');
    }
    transaction.update(context.receiptRef, {
      context: {
        title: context.sourceTitle,
        status: context.sourceStatus,
        version: payload.expectedVersion,
        targetVersion: payload.expectedVersion + 1,
        wordCount
      },
      updatedAt: FieldValue.serverTimestamp(),
      leaseAt: FieldValue.serverTimestamp()
    });
  });
}

async function finalizeMove(dependencies, context, payload, wordCount) {
  const { db, FieldValue, HttpsError } = dependencies;
  return db.runTransaction(async (transaction) => {
    const snapshots = await getSnapshots(transaction, [
      context.receiptRef, context.sourceWorldRef, context.sourceRankRef,
      context.sourceGateRef, context.targetWorldRef, context.targetRankRef,
      context.targetGateRef
    ]);
    const receipt = snapshotFor(snapshots, context.receiptRef).data();
    assertReceiptMatches(receipt, context.fingerprint, HttpsError);
    if (receipt.status === 'completed') return receipt.result;
    if (snapshotFor(snapshots, context.sourceGateRef).exists) {
      throw new HttpsError('failed-precondition', 'The source gate still exists after its move.');
    }
    const sourceWorld = snapshotFor(snapshots, context.sourceWorldRef).data();
    const sourceRank = snapshotFor(snapshots, context.sourceRankRef).data();
    const targetWorld = snapshotFor(snapshots, context.targetWorldRef).data();
    const targetRank = snapshotFor(snapshots, context.targetRankRef).data();
    const targetGate = snapshotFor(snapshots, context.targetGateRef).data();
    assertStoredWorld(sourceWorld, payload.worldId, HttpsError);
    assertStoredRank(sourceRank, payload.worldId, payload.rankId, HttpsError);
    assertStoredWorld(targetWorld, payload.targetWorldId, HttpsError);
    assertStoredRank(targetRank, payload.targetWorldId, payload.targetRankId, HttpsError);
    assertOwnedLock(sourceWorld, WORLD_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(targetWorld, WORLD_OPERATION_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(sourceRank, PARENT_RANK_LOCK_FIELD, context.operationKey, HttpsError);
    assertOwnedLock(targetRank, PARENT_RANK_LOCK_FIELD, context.operationKey, HttpsError);
    if (!isPlainRecord(targetGate) ||
        targetGate[GATE_COPY_OPERATION_FIELD] !== context.operationKey) {
      throw new HttpsError('failed-precondition', 'The moved gate reservation changed.');
    }
    const finalStatus = receipt.context?.status;
    if (!['draft', 'published', 'archived'].includes(finalStatus)) {
      throw new HttpsError('failed-precondition', 'The preserved gate status is missing.');
    }
    const result = {
      moved: true,
      operationId: payload.operationId,
      source: { worldId: payload.worldId, rankId: payload.rankId, gateId: payload.gateId },
      target: {
        worldId: payload.targetWorldId,
        rankId: payload.targetRankId,
        gateId: payload.gateId
      },
      affectedCounts: { gateCount: 1, wordCount },
      gate: {
        ...copyFields(targetGate, GATE_COPY_FIELDS),
        worldId: payload.targetWorldId,
        rankId: payload.targetRankId,
        gateId: payload.gateId,
        status: finalStatus,
        version: payload.expectedVersion + 1,
        wordCount,
        createdBy: targetGate.createdBy,
        updatedBy: context.adminUid
      }
    };
    transaction.update(context.targetGateRef, {
      status: finalStatus,
      wordCount,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid,
      [GATE_COPY_OPERATION_FIELD]: FieldValue.delete()
    });
    transaction.update(context.sourceRankRef, {
      gateCount: subtractCount(sourceRank.gateCount, 1, HttpsError),
      wordCount: subtractCount(sourceRank.wordCount, wordCount, HttpsError),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid,
      [PARENT_RANK_LOCK_FIELD]: FieldValue.delete()
    });
    transaction.update(context.targetRankRef, {
      gateCount: addCount(targetRank.gateCount, 1, HttpsError),
      wordCount: addCount(targetRank.wordCount, wordCount, HttpsError),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid,
      [PARENT_RANK_LOCK_FIELD]: FieldValue.delete()
    });
    if (payload.worldId === payload.targetWorldId) {
      transaction.update(context.sourceWorldRef, {
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.adminUid,
        [WORLD_OPERATION_LOCK_FIELD]: FieldValue.delete()
      });
    } else {
      transaction.update(context.sourceWorldRef, {
        gateCount: subtractCount(sourceWorld.gateCount, 1, HttpsError),
        wordCount: subtractCount(sourceWorld.wordCount, wordCount, HttpsError),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.adminUid,
        [WORLD_OPERATION_LOCK_FIELD]: FieldValue.delete()
      });
      transaction.update(context.targetWorldRef, {
        gateCount: addCount(targetWorld.gateCount, 1, HttpsError),
        wordCount: addCount(targetWorld.wordCount, wordCount, HttpsError),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.adminUid,
        [WORLD_OPERATION_LOCK_FIELD]: FieldValue.delete()
      });
    }
    transaction.set(context.auditRef, {
      createdAt: FieldValue.serverTimestamp(),
      action: 'move',
      entityType: 'gate',
      entityId: payload.gateId,
      worldId: payload.targetWorldId,
      rankId: payload.targetRankId,
      gateId: payload.gateId,
      sourceWorldId: payload.worldId,
      sourceRankId: payload.rankId,
      adminUid: context.adminUid,
      operationId: payload.operationId,
      summary: `Moved gate "${String(context.sourceTitle || '').slice(0, MAX_TITLE_LENGTH)}".`,
      affectedCounts: { gateCount: 1, wordCount },
      before: { version: payload.expectedVersion },
      after: { version: payload.expectedVersion + 1, status: finalStatus, wordCount }
    });
    transaction.update(context.receiptRef, {
      status: 'completed',
      result,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return result;
  });
}

function validateDependencies(dependencies, operationName) {
  const { db, FieldValue, HttpsError } = dependencies || {};
  if (!db || !FieldValue || typeof HttpsError !== 'function') {
    throw new TypeError(`${operationName} backend dependencies are incomplete.`);
  }
}

function createDuplicateContentGateHandler(dependencies) {
  validateDependencies(dependencies, 'duplicateContentGate');
  const { HttpsError, logger = console } = dependencies;
  return async function duplicateContentGate(request) {
    const adminUid = assertAdmin(request, HttpsError);
    let payload;
    try {
      payload = validateDuplicateGatePayload(request.data);
    } catch (error) {
      translatePayloadError(error, HttpsError);
    }
    let context;
    try {
      context = await prepareDuplicate(dependencies, adminUid, payload);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Failed to prepare a gate duplicate.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The gate duplicate could not be prepared.', {
        operationId: payload.operationId, retryable: true
      });
    }
    if (context.replay) return context.replay;
    let wordCount;
    try {
      wordCount = await copyGateWords(dependencies, context, payload, 'duplicate');
      await recordDuplicateCount(dependencies, context, payload, wordCount);
    } catch (error) {
      await markOperationFailed(dependencies, context, error);
      if (error instanceof HttpsError) throw error;
      logger.error('Copying gate words failed.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The gate words could not be duplicated.', {
        operationId: payload.operationId, retryable: true
      });
    }
    try {
      return await finalizeDuplicate(dependencies, context, payload, wordCount);
    } catch (error) {
      await markOperationFailed(dependencies, context, error);
      if (error instanceof HttpsError && error.code !== 'internal') throw error;
      logger.error('Failed to finalize a gate duplicate.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The gate duplicate needs a safe retry.', {
        operationId: payload.operationId, retryable: true
      });
    }
  };
}

function createDeleteContentGateHandler(dependencies) {
  validateDependencies(dependencies, 'deleteContentGate');
  const { db, HttpsError, logger = console } = dependencies;
  return async function deleteContentGate(request) {
    const adminUid = assertAdmin(request, HttpsError);
    let payload;
    try {
      payload = validateDeleteGatePayload(request.data);
    } catch (error) {
      translatePayloadError(error, HttpsError);
    }
    let context;
    try {
      context = await prepareDelete(dependencies, adminUid, payload);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Failed to prepare gate deletion.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The gate deletion could not be prepared.', {
        operationId: payload.operationId, retryable: true
      });
    }
    if (context.replay) return context.replay;
    let wordCount = context.wordCount;
    try {
      if (!Number.isSafeInteger(wordCount)) {
        wordCount = await countGateWords(context.sourceGateRef, HttpsError);
      }
      await recordDeleteCount(dependencies, context, payload, wordCount);
      if (!context.sourceMissing) await db.recursiveDelete(context.sourceGateRef);
    } catch (error) {
      await markOperationFailed(dependencies, context, error);
      if (error instanceof HttpsError) throw error;
      logger.error('Recursive gate deletion failed.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The content gate could not be deleted.', {
        operationId: payload.operationId, retryable: true
      });
    }
    try {
      return await finalizeDelete(dependencies, context, payload, wordCount);
    } catch (error) {
      await markOperationFailed(dependencies, context, error);
      if (error instanceof HttpsError && error.code !== 'internal') throw error;
      logger.error('Gate deletion needs a receipt retry after recursive deletion.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'Gate deletion needs a safe retry to finish.', {
        operationId: payload.operationId, retryable: true
      });
    }
  };
}

function createMoveContentGateHandler(dependencies) {
  validateDependencies(dependencies, 'moveContentGate');
  const { db, HttpsError, logger = console } = dependencies;
  return async function moveContentGate(request) {
    const adminUid = assertAdmin(request, HttpsError);
    let payload;
    try {
      payload = validateMoveGatePayload(request.data);
    } catch (error) {
      translatePayloadError(error, HttpsError);
    }
    let context;
    try {
      context = await prepareMove(dependencies, adminUid, payload);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Failed to prepare a gate move.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The gate move could not be prepared.', {
        operationId: payload.operationId, retryable: true
      });
    }
    if (context.replay) return context.replay;
    let wordCount = context.wordCount;
    try {
      if (!context.sourceMissing) {
        wordCount = await copyGateWords(dependencies, context, payload, 'move');
      }
      await recordMoveCount(dependencies, context, payload, wordCount);
      if (!context.sourceMissing) await db.recursiveDelete(context.sourceGateRef);
    } catch (error) {
      await markOperationFailed(dependencies, context, error);
      if (error instanceof HttpsError) throw error;
      logger.error('The non-atomic gate move copy/delete phase failed.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The gate move needs a safe retry.', {
        operationId: payload.operationId, retryable: true,
        phase: 'copy-or-delete'
      });
    }
    try {
      return await finalizeMove(dependencies, context, payload, wordCount);
    } catch (error) {
      await markOperationFailed(dependencies, context, error);
      if (error instanceof HttpsError && error.code !== 'internal') throw error;
      logger.error('The non-atomic gate move needs receipt finalization.', {
        operationId: payload.operationId, error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The gate move needs a safe retry to finish.', {
        operationId: payload.operationId, retryable: true,
        phase: 'finalize'
      });
    }
  };
}

module.exports = {
  AUDIT_COLLECTION,
  CONTENT_OPERATIONS_COLLECTION,
  GATE_COPY_OPERATION_FIELD,
  GATE_OPERATION_LOCK_FIELD,
  OPERATION_LOCK_TTL_MS,
  PARENT_RANK_LOCK_FIELD,
  RANK_COPY_OPERATION_FIELD,
  WORLD_DELETE_LOCK_FIELD,
  WORLD_OPERATION_LOCK_FIELD,
  GateAdminPayloadError,
  createDeleteContentGateHandler,
  createDuplicateContentGateHandler,
  createDuplicateGateId,
  createMoveContentGateHandler,
  createOperationKey,
  isLeaseActive,
  validateDeleteGatePayload,
  validateDuplicateGatePayload,
  validateMoveGatePayload
};
