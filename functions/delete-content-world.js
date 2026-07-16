'use strict';

const WORLD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_WORLD_ID_LENGTH = 128;
const MAX_CONFIRMATION_TITLE_LENGTH = 160;
const MAX_CACHED_COUNT = 10000000;
const MAX_AUDIT_SUMMARY_LENGTH = 500;
const DELETE_LOCK_FIELD = '_deleteLock';
const WORLD_OPERATION_LOCK_FIELD = '_adminWorldOperation';
const DELETE_LOCK_TTL_MS = 15 * 60 * 1000;

class DeleteWorldPayloadError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'DeleteWorldPayloadError';
    this.field = field;
  }
}

function isPlainRecord(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateDeleteWorldPayload(data) {
  if (!isPlainRecord(data)) {
    throw new DeleteWorldPayloadError('data', 'A request object is required.');
  }

  const allowedKeys = new Set(['worldId', 'confirmationTitle', 'expectedVersion']);
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) {
    throw new DeleteWorldPayloadError('data', 'The request contains unsupported fields.');
  }

  if (typeof data.worldId !== 'string' ||
      data.worldId.length < 1 ||
      data.worldId.length > MAX_WORLD_ID_LENGTH ||
      !WORLD_ID_PATTERN.test(data.worldId)) {
    throw new DeleteWorldPayloadError(
      'worldId',
      'worldId must be a valid content identifier with at most 128 characters.'
    );
  }

  if (typeof data.confirmationTitle !== 'string' ||
      data.confirmationTitle.trim().length < 1 ||
      data.confirmationTitle.length > MAX_CONFIRMATION_TITLE_LENGTH) {
    throw new DeleteWorldPayloadError(
      'confirmationTitle',
      'confirmationTitle must be a non-empty string with at most 160 characters.'
    );
  }

  if (Object.hasOwn(data, 'expectedVersion') &&
      (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 1)) {
    throw new DeleteWorldPayloadError(
      'expectedVersion',
      'expectedVersion must be a positive safe integer when provided.'
    );
  }

  // Keep the title byte-for-byte equivalent at the JavaScript string level.
  // Trimming here would weaken the explicit confirmation check below.
  const payload = {
    worldId: data.worldId,
    confirmationTitle: data.confirmationTitle
  };
  if (Object.hasOwn(data, 'expectedVersion')) {
    payload.expectedVersion = data.expectedVersion;
  }
  return payload;
}

function normalizeCachedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_CACHED_COUNT
    ? value
    : 0;
}

function getCachedCounts(world) {
  const source = isPlainRecord(world) ? world : Object.create(null);
  return {
    rankCount: normalizeCachedCount(source.rankCount),
    gateCount: normalizeCachedCount(source.gateCount),
    wordCount: normalizeCachedCount(source.wordCount)
  };
}

function copyBoundedString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function copyBoundedInteger(value) {
  return Number.isSafeInteger(value) && Math.abs(value) <= MAX_CACHED_COUNT
    ? value
    : 0;
}

function createBoundedBeforeSnapshot(worldId, world, cachedCounts) {
  return {
    worldId,
    title: copyBoundedString(world.title, MAX_CONFIRMATION_TITLE_LENGTH),
    status: copyBoundedString(world.status, 24),
    schemaVersion: copyBoundedInteger(world.schemaVersion),
    version: copyBoundedInteger(world.version),
    order: copyBoundedInteger(world.order),
    updatedBy: copyBoundedString(world.updatedBy, 128),
    rankCount: cachedCounts.rankCount,
    gateCount: cachedCounts.gateCount,
    wordCount: cachedCounts.wordCount
  };
}

function buildAuditSummary(worldId, title, cachedCounts) {
  const summary = `Deleted archived world "${title}" (${worldId}); cached hierarchy: ` +
    `${cachedCounts.rankCount} ranks, ${cachedCounts.gateCount} gates, ` +
    `${cachedCounts.wordCount} words.`;
  return summary.slice(0, MAX_AUDIT_SUMMARY_LENGTH);
}

function timestampToMillis(value) {
  if (value && typeof value.toMillis === 'function') {
    const result = value.toMillis();
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

function isDeleteLockActive(lock, nowMillis) {
  if (!isPlainRecord(lock)) return false;
  const requestedAtMillis = timestampToMillis(lock.requestedAt);
  // An unrecognised lock is treated as active rather than bypassed. Locks made
  // by this function always contain a Firestore Timestamp after commit.
  if (requestedAtMillis === null) return true;
  return nowMillis - requestedAtMillis < DELETE_LOCK_TTL_MS;
}

function getWorldOperationLockState(lock, nowMillis) {
  if (lock === undefined || lock === null) return 'none';
  if (!isPlainRecord(lock) || typeof lock.operationKey !== 'string' ||
      !lock.operationKey || typeof lock.action !== 'string' || !lock.action) {
    return 'malformed';
  }
  const leaseAtMillis = timestampToMillis(lock.leaseAt);
  if (leaseAtMillis === null) return 'malformed';
  // Gate callables use the same 15-minute safety window. Once it expires, a
  // world deletion may supersede the abandoned operation; until then it must
  // fail closed so recursiveDelete cannot race a gate copy/move/delete.
  return nowMillis - leaseAtMillis < DELETE_LOCK_TTL_MS ? 'active' : 'expired';
}

function safeErrorName(error) {
  if (!error || typeof error !== 'object') return 'unknown';
  if (typeof error.code === 'string') return error.code.slice(0, 80);
  if (typeof error.name === 'string') return error.name.slice(0, 80);
  return 'unknown';
}

function createDeleteContentWorldHandler(dependencies) {
  const {
    db,
    FieldValue,
    HttpsError,
    makeRequestId,
    now = Date.now,
    logger = console
  } = dependencies || {};

  if (!db || !FieldValue || typeof HttpsError !== 'function' ||
      typeof makeRequestId !== 'function') {
    throw new TypeError('deleteContentWorld backend dependencies are incomplete.');
  }

  async function releaseOwnedDeleteLock(worldRef, requestId, worldId) {
    try {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(worldRef);
        if (!snapshot.exists) return;
        const lock = snapshot.data()[DELETE_LOCK_FIELD];
        if (isPlainRecord(lock) && lock.requestId === requestId) {
          transaction.update(worldRef, {
            [DELETE_LOCK_FIELD]: FieldValue.delete()
          });
        }
      });
    } catch (error) {
      logger.error('Failed to release a content-world deletion lock.', {
        worldId,
        requestId,
        error: safeErrorName(error)
      });
    }
  }

  return async function deleteContentWorld(request) {
    if (!request || !request.auth || typeof request.auth.uid !== 'string' ||
        request.auth.uid.length < 1) {
      throw new HttpsError('unauthenticated', 'Authentication is required.');
    }
    if (!request.auth.token || request.auth.token.admin !== true) {
      throw new HttpsError('permission-denied', 'Administrator access is required.');
    }

    let payload;
    try {
      payload = validateDeleteWorldPayload(request.data);
    } catch (error) {
      if (error instanceof DeleteWorldPayloadError) {
        throw new HttpsError('invalid-argument', error.message, { field: error.field });
      }
      throw error;
    }

    const { worldId, confirmationTitle, expectedVersion } = payload;
    const adminUid = request.auth.uid;
    const requestId = makeRequestId();
    const worldRef = db.collection('content_worlds').doc(worldId);

    let deletionContext;
    try {
      deletionContext = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(worldRef);
        if (!snapshot.exists) {
          throw new HttpsError('not-found', 'The content world does not exist.');
        }

        const world = snapshot.data();
        if (!isPlainRecord(world) || world.status !== 'archived') {
          throw new HttpsError(
            'failed-precondition',
            'The content world must be archived before deletion.'
          );
        }
        if (world.title !== confirmationTitle) {
          throw new HttpsError(
            'failed-precondition',
            'The confirmation title does not exactly match the archived world title.'
          );
        }
        if (expectedVersion !== undefined && world.version !== expectedVersion) {
          throw new HttpsError(
            'aborted',
            'The content world changed after the deletion confirmation was opened.',
            {
              expectedVersion,
              actualVersion: Number.isSafeInteger(world.version) ? world.version : null
            }
          );
        }
        const worldOperationLockState = getWorldOperationLockState(
          world[WORLD_OPERATION_LOCK_FIELD], now()
        );
        if (worldOperationLockState === 'malformed') {
          throw new HttpsError(
            'failed-precondition',
            'A malformed content operation lock blocks world deletion.'
          );
        }
        if (worldOperationLockState === 'active') {
          throw new HttpsError(
            'aborted',
            'A gate operation is still using this content world.'
          );
        }
        if (isDeleteLockActive(world[DELETE_LOCK_FIELD], now())) {
          throw new HttpsError('aborted', 'A deletion for this content world is already running.');
        }

        const cachedCounts = getCachedCounts(world);
        const before = createBoundedBeforeSnapshot(worldId, world, cachedCounts);

        // This internal field is intentionally outside the browser-write schema.
        // Ordinary Admin UI updates therefore fail closed while deletion runs.
        transaction.update(worldRef, {
          [DELETE_LOCK_FIELD]: {
            requestId,
            adminUid,
            requestedAt: FieldValue.serverTimestamp()
          }
        });

        return { before, cachedCounts, title: world.title };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Failed to prepare recursive content-world deletion.', {
        worldId,
        requestId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The content world could not be prepared for deletion.');
    }

    try {
      await db.recursiveDelete(worldRef);
    } catch (error) {
      await releaseOwnedDeleteLock(worldRef, requestId, worldId);
      logger.error('Recursive content-world deletion failed.', {
        worldId,
        requestId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The content world could not be deleted.');
    }

    const auditEntry = {
      createdAt: FieldValue.serverTimestamp(),
      action: 'delete',
      entityType: 'world',
      entityId: worldId,
      worldId,
      adminUid,
      requestId,
      summary: buildAuditSummary(worldId, deletionContext.title, deletionContext.cachedCounts),
      affectedCounts: deletionContext.cachedCounts,
      before: deletionContext.before
    };

    try {
      await db.collection('admin_audit_logs').doc().set(auditEntry);
    } catch (error) {
      logger.error('Deleted a content world but failed to persist its audit entry.', {
        worldId,
        requestId,
        error: safeErrorName(error)
      });
      throw new HttpsError('internal', 'The deletion completed but its audit entry could not be saved.');
    }

    return {
      deleted: true,
      worldId,
      affectedCounts: deletionContext.cachedCounts
    };
  };
}

module.exports = {
  DELETE_LOCK_FIELD,
  DELETE_LOCK_TTL_MS,
  WORLD_OPERATION_LOCK_FIELD,
  DeleteWorldPayloadError,
  buildAuditSummary,
  createBoundedBeforeSnapshot,
  createDeleteContentWorldHandler,
  getCachedCounts,
  getWorldOperationLockState,
  isDeleteLockActive,
  validateDeleteWorldPayload
};
