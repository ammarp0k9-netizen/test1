'use strict';

const { createHash } = require('node:crypto');

const CONTENT_OPERATIONS_COLLECTION = 'admin_content_operations';
const AUDIT_COLLECTION = 'admin_audit_logs';
const OPERATION_LOCK_FIELD = '_adminRankOperation';
const COPY_OPERATION_FIELD = '_adminCopyOperation';
const OPERATION_LOCK_TTL_MS = 15 * 60 * 1000;
const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 160;
const MAX_COUNT = 10000000;
const WRITE_CHUNK_SIZE = 300;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

const RANK_COPY_FIELDS = [
  'schemaVersion', 'title', 'subtitle', 'description', 'order', 'difficulty',
  'unlockConfig'
];
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

class RankAdminPayloadError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'RankAdminPayloadError';
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
    throw new RankAdminPayloadError('data', 'A request object is required.');
  }
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) {
    throw new RankAdminPayloadError('data', 'The request contains unsupported fields.');
  }
}

function requireContentId(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH ||
      !ID_PATTERN.test(value)) {
    throw new RankAdminPayloadError(
      field,
      `${field} must be a valid content identifier with at most ${MAX_ID_LENGTH} characters.`
    );
  }
  return value;
}

function requireExpectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RankAdminPayloadError(
      'expectedVersion',
      'expectedVersion must be a positive safe integer.'
    );
  }
  return value;
}

function optionalOperationId(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH ||
      !OPERATION_ID_PATTERN.test(value)) {
    throw new RankAdminPayloadError(
      'operationId',
      `operationId must be a safe identifier with at most ${MAX_ID_LENGTH} characters.`
    );
  }
  return value;
}

function validateDuplicateRankPayload(data) {
  requireAllowedKeys(data, new Set([
    'worldId', 'rankId', 'expectedVersion', 'operationId', 'title'
  ]));
  const result = {
    worldId: requireContentId(data.worldId, 'worldId'),
    rankId: requireContentId(data.rankId, 'rankId'),
    expectedVersion: requireExpectedVersion(data.expectedVersion)
  };
  const operationId = optionalOperationId(data.operationId);
  if (operationId !== undefined) result.operationId = operationId;
  if (Object.hasOwn(data, 'title')) {
    if (typeof data.title !== 'string' || data.title.trim().length < 1 ||
        data.title.length > MAX_TITLE_LENGTH) {
      throw new RankAdminPayloadError(
        'title',
        `title must be a non-empty string with at most ${MAX_TITLE_LENGTH} characters.`
      );
    }
    result.title = data.title;
  }
  return result;
}

function validateDeleteRankPayload(data) {
  requireAllowedKeys(data, new Set([
    'worldId', 'rankId', 'confirmationTitle', 'expectedVersion', 'operationId'
  ]));
  if (typeof data.confirmationTitle !== 'string' ||
      data.confirmationTitle.trim().length < 1 ||
      data.confirmationTitle.length > MAX_TITLE_LENGTH) {
    throw new RankAdminPayloadError(
      'confirmationTitle',
      `confirmationTitle must be a non-empty string with at most ${MAX_TITLE_LENGTH} characters.`
    );
  }
  const result = {
    worldId: requireContentId(data.worldId, 'worldId'),
    rankId: requireContentId(data.rankId, 'rankId'),
    confirmationTitle: data.confirmationTitle,
    expectedVersion: requireExpectedVersion(data.expectedVersion)
  };
  const operationId = optionalOperationId(data.operationId);
  if (operationId !== undefined) result.operationId = operationId;
  return result;
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
    payload.expectedVersion,
    payload.confirmationTitle || '',
    payload.title || ''
  ]));
}

function createCopyId(kind, operationKey, sourceId) {
  return `${kind}-copy-${hashText(`${operationKey}\0${kind}\0${sourceId}`).slice(0, 40)}`;
}

function normalizeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT ? value : 0;
}

function addCount(value, delta, HttpsError) {
  const next = normalizeCount(value) + normalizeCount(delta);
  if (!Number.isSafeInteger(next) || next > MAX_COUNT) {
    throw new HttpsError('failed-precondition', 'A cached content counter would overflow.');
  }
  return next;
}

function subtractCount(value, delta) {
  return Math.max(0, normalizeCount(value) - normalizeCount(delta));
}

function copyFields(source, fields) {
  const target = {};
  const record = isPlainRecord(source) ? source : {};
  for (const field of fields) {
    if (Object.hasOwn(record, field) && record[field] !== undefined) {
      target[field] = record[field];
    }
  }
  return target;
}

function defaultCopyTitle(title) {
  const source = typeof title === 'string' && title.length > 0 ? title : 'Rank';
  const prefix = 'Copy of ';
  return `${prefix}${source.slice(0, MAX_TITLE_LENGTH - prefix.length)}`;
}

function timestampToMillis(value) {
  if (!value || typeof value.toMillis !== 'function') return null;
  const result = value.toMillis();
  return Number.isFinite(result) ? result : null;
}

function isLeaseActive(record, nowMillis) {
  if (!isPlainRecord(record)) return false;
  const leaseMillis = timestampToMillis(record.leaseAt);
  if (leaseMillis === null) return true;
  return nowMillis - leaseMillis < OPERATION_LOCK_TTL_MS;
}

function safeErrorName(error) {
  if (!error || typeof error !== 'object') return 'unknown';
  if (typeof error.code === 'string') return error.code.slice(0, 80);
  if (typeof error.name === 'string') return error.name.slice(0, 80);
  return 'unknown';
}

function assertAdmin(request, HttpsError) {
  if (!request || !request.auth || typeof request.auth.uid !== 'string' ||
      request.auth.uid.length < 1) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }
  if (!request.auth.token || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  return request.auth.uid;
}

function translatePayloadError(error, HttpsError) {
  if (error instanceof RankAdminPayloadError) {
    throw new HttpsError('invalid-argument', error.message, { field: error.field });
  }
  throw error;
}

function assertStoredVersion(rank, expectedVersion, HttpsError) {
  if (!isPlainRecord(rank) || !Number.isSafeInteger(rank.version) || rank.version < 1) {
    throw new HttpsError('failed-precondition', 'The stored rank version is invalid.');
  }
  if (rank.version !== expectedVersion) {
    throw new HttpsError('aborted', 'The content rank changed before this operation started.', {
      reason: 'version-conflict',
      expectedVersion,
      actualVersion: rank.version
    });
  }
}

function assertReceiptMatches(receipt, fingerprint, HttpsError) {
  if (receipt.fingerprint !== fingerprint) {
    throw new HttpsError(
      'already-exists',
      'operationId was already used for a different rank operation.'
    );
  }
}

function runningOperationError(operationId, HttpsError) {
  return new HttpsError('aborted', 'This rank operation is already running.', {
    operationId,
    retryable: true,
    retryAfterSeconds: Math.ceil(OPERATION_LOCK_TTL_MS / 1000)
  });
}

function makeOperationRefs(db, worldId, rankId, operationKey) {
  const worldRef = db.collection('content_worlds').doc(worldId);
  return {
    worldRef,
    rankRef: worldRef.collection('ranks').doc(rankId),
    receiptRef: db.collection(CONTENT_OPERATIONS_COLLECTION).doc(operationKey),
    auditRef: db.collection(AUDIT_COLLECTION).doc(operationKey)
  };
}

function buildLock(operationKey, action, FieldValue) {
  return {
    operationKey,
    action,
    leaseAt: FieldValue.serverTimestamp()
  };
}

function assertAvailableLock(rank, operationKey, nowMillis, HttpsError) {
  const lock = isPlainRecord(rank) ? rank[OPERATION_LOCK_FIELD] : null;
  if (lock && lock.operationKey !== operationKey && isLeaseActive(lock, nowMillis)) {
    throw new HttpsError('aborted', 'Another backend operation is using this rank.');
  }
}

async function markOperationFailed(dependencies, context, error) {
  const { db, FieldValue, logger = console } = dependencies;
  try {
    await db.runTransaction(async (transaction) => {
      const receiptSnapshot = await transaction.get(context.receiptRef);
      if (!receiptSnapshot.exists) return;
      const receipt = receiptSnapshot.data();
      if (receipt.fingerprint !== context.fingerprint || receipt.status === 'completed') return;

      const rankSnapshot = await transaction.get(context.rankRef);
      if (rankSnapshot.exists) {
        const rank = rankSnapshot.data();
        const lock = rank[OPERATION_LOCK_FIELD];
        if (isPlainRecord(lock) && lock.operationKey === context.operationKey) {
          transaction.update(context.rankRef, {
            [OPERATION_LOCK_FIELD]: FieldValue.delete()
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
    logger.error('Failed to mark a rank operation for retry.', {
      operationId: context.operationId,
      error: safeErrorName(cleanupError)
    });
  }
}

async function prepareDelete(dependencies, adminUid, payload, operationId) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const action = 'deleteContentRank';
  const operationKey = createOperationKey(adminUid, action, operationId);
  const fingerprint = createRequestFingerprint(action, payload);
  const refs = makeOperationRefs(db, payload.worldId, payload.rankId, operationKey);

  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(refs.receiptRef);
    if (receiptSnapshot.exists) {
      const receipt = receiptSnapshot.data();
      assertReceiptMatches(receipt, fingerprint, HttpsError);
      if (receipt.status === 'completed') return { replay: receipt.result };
      if (receipt.status === 'running' && isLeaseActive(receipt, now())) {
        throw runningOperationError(operationId, HttpsError);
      }
    }

    const worldSnapshot = await transaction.get(refs.worldRef);
    if (!worldSnapshot.exists) {
      throw new HttpsError('not-found', 'The parent content world does not exist.');
    }
    const rankSnapshot = await transaction.get(refs.rankRef);
    const previousReceipt = receiptSnapshot.exists ? receiptSnapshot.data() : null;

    if (!rankSnapshot.exists) {
      if (previousReceipt && previousReceipt.context) {
        transaction.set(refs.receiptRef, {
          ...previousReceipt,
          status: 'running',
          leaseAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        return {
          ...refs,
          adminUid,
          operationId,
          operationKey,
          fingerprint,
          affectedCounts: previousReceipt.context.affectedCounts,
          title: previousReceipt.context.title,
          skipRecursiveDelete: true
        };
      }
      throw new HttpsError('not-found', 'The content rank does not exist.');
    }

    const rank = rankSnapshot.data();
    if (!isPlainRecord(rank) || rank.status !== 'archived') {
      throw new HttpsError('failed-precondition', 'The content rank must be archived first.');
    }
    if (rank.title !== payload.confirmationTitle) {
      throw new HttpsError(
        'failed-precondition',
        'The confirmation title does not exactly match the archived rank title.'
      );
    }
    assertStoredVersion(rank, payload.expectedVersion, HttpsError);
    assertAvailableLock(rank, operationKey, now(), HttpsError);

    const affectedCounts = {
      rankCount: 1,
      gateCount: normalizeCount(rank.gateCount),
      wordCount: normalizeCount(rank.wordCount)
    };
    const context = { title: rank.title, version: rank.version, affectedCounts };

    transaction.update(refs.rankRef, {
      [OPERATION_LOCK_FIELD]: buildLock(operationKey, action, FieldValue)
    });
    transaction.set(refs.receiptRef, {
      action,
      status: 'running',
      operationId,
      fingerprint,
      adminUid,
      worldId: payload.worldId,
      rankId: payload.rankId,
      context,
      leaseAt: FieldValue.serverTimestamp(),
      createdAt: previousReceipt?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    return {
      ...refs,
      adminUid,
      operationId,
      operationKey,
      fingerprint,
      affectedCounts,
      title: rank.title,
      skipRecursiveDelete: false
    };
  });
}

async function finalizeDelete(dependencies, context) {
  const { db, FieldValue, HttpsError } = dependencies;
  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(context.receiptRef);
    if (!receiptSnapshot.exists) {
      throw new HttpsError('internal', 'The rank operation receipt is missing.');
    }
    const receipt = receiptSnapshot.data();
    assertReceiptMatches(receipt, context.fingerprint, HttpsError);
    if (receipt.status === 'completed') return receipt.result;

    const worldSnapshot = await transaction.get(context.worldRef);
    if (!worldSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'The parent content world no longer exists.');
    }
    const world = worldSnapshot.data();
    const result = {
      deleted: true,
      operationId: context.operationId,
      worldId: context.worldRef.id,
      rankId: context.rankRef.id,
      affectedCounts: context.affectedCounts
    };

    transaction.update(context.worldRef, {
      rankCount: subtractCount(world.rankCount, 1),
      gateCount: subtractCount(world.gateCount, context.affectedCounts.gateCount),
      wordCount: subtractCount(world.wordCount, context.affectedCounts.wordCount),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid
    });
    transaction.set(context.auditRef, {
      createdAt: FieldValue.serverTimestamp(),
      action: 'delete',
      entityType: 'rank',
      entityId: context.rankRef.id,
      worldId: context.worldRef.id,
      rankId: context.rankRef.id,
      adminUid: context.adminUid,
      operationId: context.operationId,
      summary: `Deleted archived rank "${context.title}".`,
      affectedCounts: context.affectedCounts,
      before: {
        title: context.title,
        version: receipt.context?.version || null,
        gateCount: context.affectedCounts.gateCount,
        wordCount: context.affectedCounts.wordCount
      }
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

function buildDuplicateRank(source, payload, targetRankId, adminUid, operationKey, FieldValue) {
  return {
    ...copyFields(source, RANK_COPY_FIELDS),
    worldId: payload.worldId,
    rankId: targetRankId,
    title: payload.title || defaultCopyTitle(source.title),
    status: 'draft',
    version: 1,
    gateCount: normalizeCount(source.gateCount),
    wordCount: normalizeCount(source.wordCount),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: adminUid,
    updatedBy: adminUid,
    [COPY_OPERATION_FIELD]: operationKey
  };
}

async function prepareDuplicate(dependencies, adminUid, payload, operationId) {
  const { db, FieldValue, HttpsError, now = Date.now } = dependencies;
  const action = 'duplicateContentRank';
  const operationKey = createOperationKey(adminUid, action, operationId);
  const fingerprint = createRequestFingerprint(action, payload);
  const refs = makeOperationRefs(db, payload.worldId, payload.rankId, operationKey);
  const targetRankId = createCopyId('rank', operationKey, payload.rankId);
  const targetRankRef = refs.worldRef.collection('ranks').doc(targetRankId);

  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(refs.receiptRef);
    if (receiptSnapshot.exists) {
      const receipt = receiptSnapshot.data();
      assertReceiptMatches(receipt, fingerprint, HttpsError);
      if (receipt.status === 'completed') return { replay: receipt.result };
      if (receipt.status === 'running' && isLeaseActive(receipt, now())) {
        throw runningOperationError(operationId, HttpsError);
      }
    }

    const worldSnapshot = await transaction.get(refs.worldRef);
    const sourceSnapshot = await transaction.get(refs.rankRef);
    const targetSnapshot = await transaction.get(targetRankRef);
    if (!worldSnapshot.exists) {
      throw new HttpsError('not-found', 'The parent content world does not exist.');
    }
    if (!sourceSnapshot.exists) {
      throw new HttpsError('not-found', 'The source content rank does not exist.');
    }

    const source = sourceSnapshot.data();
    assertStoredVersion(source, payload.expectedVersion, HttpsError);
    assertAvailableLock(source, operationKey, now(), HttpsError);
    if (targetSnapshot.exists && targetSnapshot.data()[COPY_OPERATION_FIELD] !== operationKey) {
      throw new HttpsError('already-exists', 'The deterministic target rank ID is occupied.');
    }

    const previousReceipt = receiptSnapshot.exists ? receiptSnapshot.data() : null;
    transaction.update(refs.rankRef, {
      [OPERATION_LOCK_FIELD]: buildLock(operationKey, action, FieldValue)
    });
    transaction.set(
      targetRankRef,
      buildDuplicateRank(source, payload, targetRankId, adminUid, operationKey, FieldValue)
    );
    transaction.set(refs.receiptRef, {
      action,
      status: 'running',
      operationId,
      fingerprint,
      adminUid,
      worldId: payload.worldId,
      rankId: payload.rankId,
      targetRankId,
      leaseAt: FieldValue.serverTimestamp(),
      createdAt: previousReceipt?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    return {
      ...refs,
      targetRankRef,
      source,
      adminUid,
      operationId,
      operationKey,
      fingerprint,
      targetRankId
    };
  });
}

function buildGateCopy(source, payload, targetRankId, targetGateId, actualWordCount, adminUid,
  FieldValue) {
  const passRatio = source.entryAssessmentPassRatio;
  return {
    ...copyFields(source, GATE_COPY_FIELDS),
    worldId: payload.worldId,
    rankId: targetRankId,
    gateId: targetGateId,
    status: 'draft',
    version: 1,
    wordCount: normalizeCount(actualWordCount),
    entryAssessmentPassRatio:
      typeof passRatio === 'number' && Number.isFinite(passRatio) && passRatio > 0 && passRatio <= 1
        ? passRatio
        : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: adminUid,
    updatedBy: adminUid
  };
}

function buildWordCopy(source, payload, targetRankId, targetGateId, targetWordId, adminUid,
  FieldValue) {
  return {
    ...copyFields(source, WORD_COPY_FIELDS),
    worldId: payload.worldId,
    rankId: targetRankId,
    gateId: targetGateId,
    contentWordId: targetWordId,
    status: 'draft',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: adminUid,
    updatedBy: adminUid
  };
}

async function copyRankDescendants(dependencies, context, payload) {
  const { db, FieldValue } = dependencies;
  const writer = db.bulkWriter();
  const pendingWrites = [];
  let gateCount = 0;
  let wordCount = 0;
  let failure = null;

  async function flushWrites() {
    if (pendingWrites.length === 0) return;
    await Promise.all(pendingWrites.splice(0));
  }

  function queueWrite(reference, data) {
    pendingWrites.push(writer.set(reference, data));
  }

  async function* iterateDocuments(collectionReference) {
    // Admin Query streams keep arbitrary ranks from being materialized in one
    // array. The get() fallback keeps the dependency-injected unit fakes small.
    if (typeof collectionReference.stream === 'function') {
      for await (const document of collectionReference.stream()) yield document;
      return;
    }
    const snapshot = await collectionReference.get();
    for (const document of snapshot.docs) yield document;
  }

  try {
    for await (const gateDocument of iterateDocuments(context.rankRef.collection('gates'))) {
      gateCount += 1;
      const targetGateId = createCopyId('gate', context.operationKey, gateDocument.id);
      const sourceGateRef = context.rankRef.collection('gates').doc(gateDocument.id);
      const targetGateRef = context.targetRankRef.collection('gates').doc(targetGateId);
      let gateWordCount = 0;
      for await (const wordDocument of iterateDocuments(sourceGateRef.collection('words'))) {
        gateWordCount += 1;
        wordCount += 1;
        const targetWordId = createCopyId(
          'word', context.operationKey, `${gateDocument.id}/${wordDocument.id}`
        );
        const targetWordRef = targetGateRef.collection('words').doc(targetWordId);
        queueWrite(targetWordRef, buildWordCopy(
          wordDocument.data(), payload, context.targetRankId, targetGateId,
          targetWordId, context.adminUid, FieldValue
        ));
        if (pendingWrites.length >= WRITE_CHUNK_SIZE) await flushWrites();
      }
      queueWrite(targetGateRef, buildGateCopy(
        gateDocument.data(), payload, context.targetRankId, targetGateId,
        gateWordCount, context.adminUid, FieldValue
      ));
      if (pendingWrites.length >= WRITE_CHUNK_SIZE) await flushWrites();
    }
    await flushWrites();
  } catch (error) {
    failure = error;
  }

  try {
    await writer.close();
  } catch (error) {
    if (!failure) failure = error;
  }
  if (failure) throw failure;
  return { rankCount: 1, gateCount, wordCount };
}

async function finalizeDuplicate(dependencies, context, counts, payload) {
  const { db, FieldValue, HttpsError } = dependencies;
  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(context.receiptRef);
    if (!receiptSnapshot.exists) {
      throw new HttpsError('internal', 'The rank operation receipt is missing.');
    }
    const receipt = receiptSnapshot.data();
    assertReceiptMatches(receipt, context.fingerprint, HttpsError);
    if (receipt.status === 'completed') return receipt.result;

    const worldSnapshot = await transaction.get(context.worldRef);
    const sourceSnapshot = await transaction.get(context.rankRef);
    const targetSnapshot = await transaction.get(context.targetRankRef);
    if (!worldSnapshot.exists || !sourceSnapshot.exists || !targetSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'The rank hierarchy changed during copying.');
    }
    const currentSource = sourceSnapshot.data();
    const sourceLock = currentSource[OPERATION_LOCK_FIELD];
    if (!isPlainRecord(sourceLock) || sourceLock.operationKey !== context.operationKey) {
      throw new HttpsError(
        'failed-precondition',
        'The source rank backend lock changed during copying.'
      );
    }
    assertStoredVersion(currentSource, payload.expectedVersion, HttpsError);
    const target = targetSnapshot.data();
    if (target[COPY_OPERATION_FIELD] !== context.operationKey) {
      throw new HttpsError('failed-precondition', 'The duplicate target is no longer reserved.');
    }

    const world = worldSnapshot.data();
    const resultRank = {
      ...copyFields(target, RANK_COPY_FIELDS),
      worldId: payload.worldId,
      rankId: context.targetRankId,
      status: 'draft',
      version: 1,
      gateCount: counts.gateCount,
      wordCount: counts.wordCount,
      createdAt: target.createdAt,
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: target.createdBy,
      updatedBy: context.adminUid
    };
    // Do not return or persist unresolved FieldValue transforms inside the
    // operation result. Callers can fetch the document for committed times.
    const resultRankSummary = {
      ...copyFields(resultRank, RANK_COPY_FIELDS),
      worldId: resultRank.worldId,
      rankId: resultRank.rankId,
      status: resultRank.status,
      version: resultRank.version,
      gateCount: resultRank.gateCount,
      wordCount: resultRank.wordCount,
      createdBy: resultRank.createdBy,
      updatedBy: resultRank.updatedBy
    };
    const result = {
      duplicated: true,
      operationId: context.operationId,
      worldId: payload.worldId,
      sourceRankId: payload.rankId,
      rankId: context.targetRankId,
      affectedCounts: counts,
      rank: resultRankSummary
    };

    transaction.set(context.targetRankRef, resultRank);
    transaction.update(context.rankRef, {
      [OPERATION_LOCK_FIELD]: FieldValue.delete()
    });
    transaction.update(context.worldRef, {
      rankCount: addCount(world.rankCount, 1, HttpsError),
      gateCount: addCount(world.gateCount, counts.gateCount, HttpsError),
      wordCount: addCount(world.wordCount, counts.wordCount, HttpsError),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.adminUid
    });
    transaction.set(context.auditRef, {
      createdAt: FieldValue.serverTimestamp(),
      action: 'duplicate',
      entityType: 'rank',
      entityId: context.targetRankId,
      worldId: payload.worldId,
      rankId: context.targetRankId,
      sourceRankId: payload.rankId,
      adminUid: context.adminUid,
      operationId: context.operationId,
      summary: `Duplicated rank "${context.source.title}" as draft.`,
      affectedCounts: counts,
      after: {
        title: resultRank.title,
        version: 1,
        gateCount: counts.gateCount,
        wordCount: counts.wordCount
      }
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

function createDeleteContentRankHandler(dependencies) {
  const { db, FieldValue, HttpsError, makeRequestId, logger = console } = dependencies || {};
  if (!db || !FieldValue || typeof HttpsError !== 'function' ||
      typeof makeRequestId !== 'function') {
    throw new TypeError('deleteContentRank backend dependencies are incomplete.');
  }

  return async function deleteContentRank(request) {
    const adminUid = assertAdmin(request, HttpsError);
    let payload;
    try {
      payload = validateDeleteRankPayload(request.data);
    } catch (error) {
      translatePayloadError(error, HttpsError);
    }
    const operationId = payload.operationId || makeRequestId();
    let context;
    try {
      context = await prepareDelete(dependencies, adminUid, payload, operationId);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Failed to prepare rank deletion.', {
        operationId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The rank deletion could not be prepared.', {
        operationId,
        retryable: true
      });
    }
    if (context.replay) return context.replay;

    if (!context.skipRecursiveDelete) {
      try {
        // recursiveDelete is intentionally not described as atomic. The receipt
        // keeps retries from decrementing counters or writing audits twice.
        await db.recursiveDelete(context.rankRef);
      } catch (error) {
        await markOperationFailed(dependencies, context, error);
        logger.error('Recursive rank deletion failed.', {
          operationId,
          error: safeErrorName(error)
        });
        throw new HttpsError('internal', 'The content rank could not be deleted.', {
          operationId,
          retryable: true
        });
      }
    }

    try {
      return await finalizeDelete(dependencies, context);
    } catch (error) {
      if (error instanceof HttpsError && error.code !== 'internal') throw error;
      await markOperationFailed(dependencies, context, error);
      logger.error('Rank deletion needs a receipt retry after recursive deletion.', {
        operationId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'Rank deletion needs a safe retry to finish.', {
        operationId,
        retryable: true
      });
    }
  };
}

function createDuplicateContentRankHandler(dependencies) {
  const { db, FieldValue, HttpsError, makeRequestId, logger = console } = dependencies || {};
  if (!db || !FieldValue || typeof HttpsError !== 'function' ||
      typeof makeRequestId !== 'function') {
    throw new TypeError('duplicateContentRank backend dependencies are incomplete.');
  }

  return async function duplicateContentRank(request) {
    const adminUid = assertAdmin(request, HttpsError);
    let payload;
    try {
      payload = validateDuplicateRankPayload(request.data);
    } catch (error) {
      translatePayloadError(error, HttpsError);
    }
    const operationId = payload.operationId || makeRequestId();
    let context;
    try {
      context = await prepareDuplicate(dependencies, adminUid, payload, operationId);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Failed to reserve a rank duplicate.', {
        operationId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The rank duplicate could not be prepared.', {
        operationId,
        retryable: true
      });
    }
    if (context.replay) return context.replay;

    let counts;
    try {
      counts = await copyRankDescendants(dependencies, context, payload);
    } catch (error) {
      await markOperationFailed(dependencies, context, error);
      logger.error('Copying rank descendants failed.', {
        operationId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The rank hierarchy could not be duplicated.', {
        operationId,
        retryable: true
      });
    }

    try {
      return await finalizeDuplicate(dependencies, context, counts, payload);
    } catch (error) {
      await markOperationFailed(dependencies, context, error);
      if (error instanceof HttpsError && error.code !== 'internal') throw error;
      logger.error('Failed to finalize a rank duplicate.', {
        operationId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The rank duplicate could not be finalized.', {
        operationId,
        retryable: true
      });
    }
  };
}

module.exports = {
  AUDIT_COLLECTION,
  CONTENT_OPERATIONS_COLLECTION,
  COPY_OPERATION_FIELD,
  OPERATION_LOCK_FIELD,
  OPERATION_LOCK_TTL_MS,
  RankAdminPayloadError,
  createCopyId,
  createDeleteContentRankHandler,
  createDuplicateContentRankHandler,
  createOperationKey,
  defaultCopyTitle,
  isLeaseActive,
  normalizeCount,
  validateDeleteRankPayload,
  validateDuplicateRankPayload
};
