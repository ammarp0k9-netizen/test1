import { getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const app = getApps()[0];
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const functions = app ? getFunctions(app) : null;
const contentWorlds = db ? collection(db, 'content_worlds') : null;
const deleteContentWorld = functions ? httpsCallable(functions, 'deleteContentWorld') : null;
const duplicateContentRank = functions ? httpsCallable(functions, 'duplicateContentRank') : null;
const deleteContentRank = functions ? httpsCallable(functions, 'deleteContentRank') : null;
const duplicateContentGate = functions ? httpsCallable(functions, 'duplicateContentGate') : null;
const moveContentGate = functions ? httpsCallable(functions, 'moveContentGate') : null;
const deleteContentGate = functions ? httpsCallable(functions, 'deleteContentGate') : null;
const duplicateContentWord = functions ? httpsCallable(functions, 'duplicateContentWord') : null;
const moveContentWord = functions ? httpsCallable(functions, 'moveContentWord') : null;
const bulkUpdateContentWords = functions ? httpsCallable(functions, 'bulkUpdateContentWords') : null;
const deleteContentWord = functions ? httpsCallable(functions, 'deleteContentWord') : null;
const CONTENT_STATUSES = Object.freeze(['draft', 'published', 'archived']);
const WORLD_EDITABLE_FIELDS = Object.freeze([
  'slug',
  'title',
  'subtitle',
  'description',
  'icon',
  'cover',
  'theme',
  'category',
  'difficulty',
  'languageFrom',
  'languageTo',
  'status',
  'order',
  'isFeatured',
]);
const WORLD_INPUT_FIELDS = new Set([
  'schemaVersion',
  'worldId',
  'id',
  ...WORLD_EDITABLE_FIELDS,
  'version',
  'rankCount',
  'gateCount',
  'wordCount',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
]);
const RANK_EDITABLE_FIELDS = Object.freeze([
  'title',
  'subtitle',
  'description',
  'order',
  'difficulty',
  'status',
  'unlockConfig',
]);
const RANK_INPUT_FIELDS = new Set([
  'schemaVersion',
  'worldId',
  'rankId',
  'id',
  ...RANK_EDITABLE_FIELDS,
  'version',
  'gateCount',
  'wordCount',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
]);
const GATE_EDITABLE_FIELDS = Object.freeze([
  'title',
  'subtitle',
  'description',
  'order',
  'difficulty',
  'status',
  'entryAssessmentPassRatio',
  'unlockConfig',
]);
const GATE_INPUT_FIELDS = new Set([
  'schemaVersion',
  'worldId',
  'rankId',
  'gateId',
  'id',
  ...GATE_EDITABLE_FIELDS,
  'version',
  'wordCount',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
]);
const WORD_EDITABLE_FIELDS = Object.freeze([
  'word',
  'translation',
  'definition',
  'definition_ar',
  'example',
  'exampleTranslation',
  'category',
  'partOfSpeech',
  'level',
  'tags',
  'synonyms',
  'pronunciation',
  'audioUrl',
  'imageUrl',
  'notes',
  'order',
  'status',
]);
const WORD_INPUT_FIELDS = new Set([
  'schemaVersion',
  'normalizationVersion',
  'worldId',
  'rankId',
  'gateId',
  'contentWordId',
  'wordId',
  'id',
  'normalizedWord',
  'wordKey',
  ...WORD_EDITABLE_FIELDS,
  'version',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
]);
const WORD_PAGE_SIZE_DEFAULT = 50;
const WORD_PAGE_SIZE_MAX = 100;
const BULK_WORD_LIMIT = 100;
const WORD_CURSOR_PREFIX = 'llw1_';
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let checkRevision = 0;
let operationSequence = 0;
const pendingOperationIds = new Map();
const OPERATION_RESUME_STORAGE_KEY = 'lootlingua_content_operation_resume_v1';
const MAX_PERSISTED_OPERATION_IDS = 200;
let adminState = Object.freeze({
  resolved: false,
  isAdmin: false,
  uid: null,
  errorCode: '',
});

function emitAdminState(next) {
  adminState = Object.freeze({
    resolved: Boolean(next.resolved),
    isAdmin: Boolean(next.isAdmin),
    uid: next.uid ? String(next.uid) : null,
    errorCode: next.errorCode ? String(next.errorCode) : '',
  });
  window.dispatchEvent(new CustomEvent('lootlingua:admin-state', {
    detail: { ...adminState },
  }));
  return { ...adminState };
}

async function refreshAdminAccess(options = {}) {
  // Never accept a caller-supplied user object. The Firebase Auth instance is
  // the only browser-side source for both identity and token claims.
  const user = auth?.currentUser || null;
  const revision = ++checkRevision;
  const uid = user?.uid ? String(user.uid) : null;

  // Clear the previous account's privilege before any asynchronous token work.
  emitAdminState({ resolved: false, isAdmin: false, uid, errorCode: '' });
  if (!user || !uid) {
    return emitAdminState({ resolved: true, isAdmin: false, uid: null, errorCode: '' });
  }

  try {
    const token = await user.getIdTokenResult(options.forceRefresh !== false);
    if (revision !== checkRevision || auth?.currentUser !== user || auth?.currentUser?.uid !== uid) {
      return { ...adminState };
    }
    return emitAdminState({
      resolved: true,
      isAdmin: token?.claims?.admin === true,
      uid,
      errorCode: '',
    });
  } catch (error) {
    if (revision !== checkRevision || auth?.currentUser !== user || auth?.currentUser?.uid !== uid) {
      return { ...adminState };
    }
    return emitAdminState({
      resolved: true,
      isAdmin: false,
      uid,
      errorCode: error?.code || 'auth/token-read-failed',
    });
  }
}

async function ensureAdminAccess(options = {}) {
  const user = auth?.currentUser || null;
  if (!user) {
    if (!adminState.resolved || adminState.uid !== null || adminState.isAdmin) {
      await refreshAdminAccess({ forceRefresh: false });
    }
    return { ...adminState };
  }
  if (options.forceRefresh || !adminState.resolved || adminState.uid !== user.uid) {
    return refreshAdminAccess({ forceRefresh: options.forceRefresh !== false });
  }
  return { ...adminState };
}

async function requireAdminAccess(options = {}) {
  const state = await ensureAdminAccess(options);
  if (!state.isAdmin) {
    const error = new Error(state.uid ? 'admin/permission-denied' : 'admin/auth-required');
    error.code = state.uid ? 'admin/permission-denied' : 'admin/auth-required';
    throw error;
  }
  return state;
}

function adminCloudError(code, message, details) {
  const error = new Error(message || code);
  error.name = 'LootLinguaAdminCloudError';
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function mapAdminCloudError(error, fallbackCode) {
  if (error?.code?.startsWith?.('admin/') || error?.code?.startsWith?.('content/')) return error;
  if (error?.name === 'LootLinguaContentSchemaValidationError') {
    return adminCloudError(
      'admin/validation-failed',
      'The content data did not pass validation.',
      error.diagnostics || []
    );
  }

  const sourceCode = String(error?.code || '');
  if (
    (sourceCode === 'aborted' || sourceCode === 'functions/aborted') &&
    error?.details?.reason === 'version-conflict'
  ) {
    const conflict = adminCloudError(
      'admin/version-conflict',
      error?.message || 'The content was changed by another request.',
      error.details
    );
    conflict.sourceCode = sourceCode;
    return conflict;
  }
  const mappedCodes = {
    'unauthenticated': 'admin/auth-required',
    'functions/unauthenticated': 'admin/auth-required',
    'permission-denied': 'admin/permission-denied',
    'functions/permission-denied': 'admin/permission-denied',
    'not-found': 'admin/not-found',
    'functions/not-found': 'admin/not-found',
    'already-exists': 'admin/already-exists',
    'functions/already-exists': 'admin/already-exists',
    'aborted': 'admin/conflict',
    'functions/aborted': 'admin/conflict',
    'failed-precondition': 'admin/conflict',
    'functions/failed-precondition': 'admin/conflict',
    'invalid-argument': 'admin/invalid-argument',
    'functions/invalid-argument': 'admin/invalid-argument',
    'deadline-exceeded': 'admin/timeout',
    'functions/deadline-exceeded': 'admin/timeout',
    'unavailable': 'admin/unavailable',
    'functions/unavailable': 'admin/unavailable',
  };
  const mapped = adminCloudError(
    mappedCodes[sourceCode] || fallbackCode || 'admin/request-failed',
    error?.message || 'The admin content request failed.',
    error?.details
  );
  mapped.sourceCode = sourceCode;
  return mapped;
}

async function requireAdminContext() {
  const state = await requireAdminAccess();
  const uid = state.uid ? String(state.uid) : '';
  if (!uid || auth?.currentUser?.uid !== uid) {
    throw adminCloudError('admin/account-changed', 'The signed-in account changed during the request.');
  }
  if (
    !db ||
    !contentWorlds ||
    !functions ||
    !deleteContentWorld ||
    !duplicateContentRank ||
    !deleteContentRank ||
    !duplicateContentGate ||
    !moveContentGate ||
    !deleteContentGate ||
    !duplicateContentWord ||
    !moveContentWord ||
    !bulkUpdateContentWords ||
    !deleteContentWord
  ) {
    throw adminCloudError('admin/firebase-unavailable', 'Firebase services are not available.');
  }
  return Object.freeze({ uid });
}

function assertAdminContext(context) {
  if (!context?.uid || auth?.currentUser?.uid !== context.uid) {
    throw adminCloudError('admin/account-changed', 'The signed-in account changed during the request.');
  }
}

function getContentSchema() {
  const schema = window.LootLinguaContentSchema;
  if (
    !schema ||
    typeof schema.cleanWorld !== 'function' ||
    typeof schema.cleanRank !== 'function' ||
    typeof schema.cleanGate !== 'function' ||
    typeof schema.cleanWord !== 'function' ||
    typeof schema.normalizeWord !== 'function' ||
    typeof schema.normalizeWordIdentity !== 'function' ||
    typeof schema.compactForStorage !== 'function'
  ) {
    throw adminCloudError('admin/schema-unavailable', 'The content schema is not available.');
  }
  return schema;
}

function requireWorldId(value) {
  const worldId = typeof value === 'string' ? value : '';
  if (!worldId || worldId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(worldId)) {
    throw adminCloudError('admin/invalid-argument', 'A valid worldId is required.');
  }
  return worldId;
}

function requireRankId(value) {
  const rankId = typeof value === 'string' ? value : '';
  if (!rankId || rankId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rankId)) {
    throw adminCloudError('admin/invalid-argument', 'A valid rankId is required.');
  }
  return rankId;
}

function requireGateId(value) {
  const gateId = typeof value === 'string' ? value : '';
  if (!gateId || gateId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(gateId)) {
    throw adminCloudError('admin/invalid-argument', 'A valid gateId is required.');
  }
  return gateId;
}

function requireContentWordId(value) {
  const contentWordId = typeof value === 'string' ? value : '';
  if (
    !contentWordId ||
    contentWordId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(contentWordId)
  ) {
    throw adminCloudError('admin/invalid-argument', 'A valid contentWordId is required.');
  }
  return contentWordId;
}

function requireWordPageSize(value) {
  const pageSize = value === undefined ? WORD_PAGE_SIZE_DEFAULT : value;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > WORD_PAGE_SIZE_MAX) {
    throw adminCloudError(
      'admin/invalid-argument',
      `pageSize must be an integer from 1 to ${WORD_PAGE_SIZE_MAX}.`
    );
  }
  return pageSize;
}

function encodeBase64UrlAscii(value) {
  let output = '';
  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index);
    const hasSecond = index + 1 < value.length;
    const hasThird = index + 2 < value.length;
    const second = hasSecond ? value.charCodeAt(index + 1) : 0;
    const third = hasThird ? value.charCodeAt(index + 2) : 0;
    if (first > 0x7f || second > 0x7f || third > 0x7f) {
      throw adminCloudError('admin/invalid-argument', 'The page cursor contains invalid data.');
    }
    output += BASE64URL_ALPHABET[first >> 2];
    output += BASE64URL_ALPHABET[((first & 3) << 4) | (second >> 4)];
    if (hasSecond) output += BASE64URL_ALPHABET[((second & 15) << 2) | (third >> 6)];
    if (hasThird) output += BASE64URL_ALPHABET[third & 63];
  }
  return output;
}

function decodeBase64UrlAscii(value) {
  if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid.');
  }
  let output = '';
  let bits = 0;
  let bitCount = 0;
  for (const character of value) {
    const digit = BASE64URL_ALPHABET.indexOf(character);
    if (digit < 0) {
      throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid.');
    }
    bits = (bits << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output += String.fromCharCode((bits >> bitCount) & 0xff);
      bits &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0 && bits !== 0) {
    throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid.');
  }
  return output;
}

function encodeWordPageToken(worldId, rankId, gateId, word) {
  return WORD_CURSOR_PREFIX + encodeBase64UrlAscii(JSON.stringify({
    v: 1,
    w: worldId,
    r: rankId,
    g: gateId,
    o: word.order,
    i: word.contentWordId,
  }));
}

function decodeWordPageToken(token, worldId, rankId, gateId) {
  if (typeof token !== 'string' || !token.startsWith(WORD_CURSOR_PREFIX)) {
    throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid.');
  }
  let cursor;
  try {
    cursor = JSON.parse(decodeBase64UrlAscii(token.slice(WORD_CURSOR_PREFIX.length)));
  } catch (error) {
    if (error?.code === 'admin/invalid-argument') throw error;
    throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid.');
  }
  const keys = cursor && typeof cursor === 'object' && !Array.isArray(cursor)
    ? Object.keys(cursor).sort()
    : [];
  if (
    keys.join(',') !== 'g,i,o,r,v,w' ||
    cursor.v !== 1 ||
    cursor.w !== worldId ||
    cursor.r !== rankId ||
    cursor.g !== gateId ||
    !Number.isSafeInteger(cursor.o) ||
    cursor.o < 0 ||
    cursor.o > 1000000
  ) {
    throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid for this gate.');
  }
  return Object.freeze({
    order: cursor.o,
    contentWordId: requireContentWordId(cursor.i),
  });
}

async function deriveContentWordId(normalizedWord, normalizationVersion) {
  if (
    typeof normalizedWord !== 'string' ||
    !normalizedWord ||
    !Number.isSafeInteger(normalizationVersion) ||
    normalizationVersion < 1 ||
    typeof globalThis.crypto?.subtle?.digest !== 'function' ||
    typeof globalThis.TextEncoder !== 'function'
  ) {
    throw adminCloudError(
      'admin/secure-identity-unavailable',
      'A secure deterministic word identity cannot be generated in this browser.'
    );
  }
  const material = `${normalizationVersion}\u0000${normalizedWord}`;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new globalThis.TextEncoder().encode(material)
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return requireContentWordId(`word_${hex}`);
}

function requireOperationId(value) {
  const operationId = typeof value === 'string' ? value : '';
  if (
    !operationId ||
    operationId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(operationId)
  ) {
    throw adminCloudError('admin/invalid-argument', 'A valid operationId is required.');
  }
  return operationId;
}

function generateOperationId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return requireOperationId(cryptoApi.randomUUID());
  }
  operationSequence += 1;
  return requireOperationId([
    'rankop',
    Date.now().toString(36),
    operationSequence.toString(36),
    Math.random().toString(36).slice(2, 14),
  ].join('_'));
}

function operationResumeStorage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function readPersistedOperationEntries() {
  const storage = operationResumeStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(OPERATION_RESUME_STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((entry) =>
      entry &&
      typeof entry.cacheKey === 'string' &&
      entry.cacheKey.length <= 2048 &&
      typeof entry.operationId === 'string' &&
      entry.operationId.length <= 128 &&
      /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.operationId) &&
      Number.isFinite(entry.updatedAt)
    );
  } catch {
    return [];
  }
}

function writePersistedOperationEntries(entries) {
  const storage = operationResumeStorage();
  if (!storage) return;
  try {
    const bounded = entries
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_PERSISTED_OPERATION_IDS);
    if (bounded.length) {
      storage.setItem(OPERATION_RESUME_STORAGE_KEY, JSON.stringify({
        version: 1,
        entries: bounded,
      }));
    } else {
      storage.removeItem(OPERATION_RESUME_STORAGE_KEY);
    }
  } catch {
    // Operation resumption is best-effort client durability. Authorization and
    // idempotency are still verified by Auth, Rules, and the callable receipt.
  }
}

function readPersistedOperationId(cacheKey) {
  return readPersistedOperationEntries()
    .find((entry) => entry.cacheKey === cacheKey)?.operationId || '';
}

function persistOperationId(cacheKey, operationId) {
  const entries = readPersistedOperationEntries()
    .filter((entry) => entry.cacheKey !== cacheKey);
  entries.push({ cacheKey, operationId, updatedAt: Date.now() });
  writePersistedOperationEntries(entries);
}

function removePersistedOperationId(cacheKey, operationId) {
  writePersistedOperationEntries(readPersistedOperationEntries().filter((entry) =>
    entry.cacheKey !== cacheKey || entry.operationId !== operationId
  ));
}

function resolveOperationToken(options, operationKey, uid) {
  const scopedCacheKey = JSON.stringify([String(uid || ''), operationKey]);
  const requestedOperationId = Object.prototype.hasOwnProperty.call(options, 'operationId')
    ? requireOperationId(options.operationId)
    : '';
  let operationId = pendingOperationIds.get(scopedCacheKey) ||
    readPersistedOperationId(scopedCacheKey);
  if (!operationId) {
    operationId = requestedOperationId || generateOperationId();
  }
  pendingOperationIds.set(scopedCacheKey, operationId);
  persistOperationId(scopedCacheKey, operationId);
  return Object.freeze({ operationId, cacheKey: scopedCacheKey });
}

function completeOperationToken(token) {
  if (token.cacheKey && pendingOperationIds.get(token.cacheKey) === token.operationId) {
    pendingOperationIds.delete(token.cacheKey);
    removePersistedOperationId(token.cacheKey, token.operationId);
  }
}

function requireExpectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw adminCloudError('admin/invalid-argument', 'A positive expectedVersion is required.');
  }
  return value;
}

function requireWorldInput(value) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw adminCloudError('admin/invalid-argument', 'World data must be an object.');
  }
  const unknownFields = Object.keys(value).filter((field) => !WORLD_INPUT_FIELDS.has(field));
  if (unknownFields.length) {
    throw adminCloudError(
      'admin/invalid-argument',
      'World data contains unsupported fields.',
      unknownFields
    );
  }
  return value;
}

function requireRankInput(value) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw adminCloudError('admin/invalid-argument', 'Rank data must be an object.');
  }
  const unknownFields = Object.keys(value).filter((field) => !RANK_INPUT_FIELDS.has(field));
  if (unknownFields.length) {
    throw adminCloudError(
      'admin/invalid-argument',
      'Rank data contains unsupported fields.',
      unknownFields
    );
  }
  return value;
}

function requireGateInput(value) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw adminCloudError('admin/invalid-argument', 'Gate data must be an object.');
  }
  const unknownFields = Object.keys(value).filter((field) => !GATE_INPUT_FIELDS.has(field));
  if (unknownFields.length) {
    throw adminCloudError(
      'admin/invalid-argument',
      'Gate data contains unsupported fields.',
      unknownFields
    );
  }
  return value;
}

function requireWordInput(value) {
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw adminCloudError('admin/invalid-argument', 'Word data must be an object.');
  }
  const unknownFields = Object.keys(value).filter((field) => !WORD_INPUT_FIELDS.has(field));
  if (unknownFields.length) {
    throw adminCloudError(
      'admin/invalid-argument',
      'Word data contains unsupported fields.',
      unknownFields
    );
  }
  return value;
}

function requireWordTarget(value) {
  const target = requireOptions(
    value,
    new Set(['worldId', 'rankId', 'gateId']),
    'A target world, rank, and gate are required.'
  );
  return Object.freeze({
    worldId: requireWorldId(target.worldId),
    rankId: requireRankId(target.rankId),
    gateId: requireGateId(target.gateId),
  });
}

function requireBulkWordItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > BULK_WORD_LIMIT) {
    throw adminCloudError(
      'admin/invalid-argument',
      `Bulk word operations require from 1 to ${BULK_WORD_LIMIT} items.`
    );
  }
  const seen = new Set();
  const items = value.map((item) => {
    const source = requireOptions(
      item,
      new Set(['contentWordId', 'wordId', 'expectedVersion']),
      'Each bulk item must contain a contentWordId and expectedVersion.'
    );
    if (
      Object.prototype.hasOwnProperty.call(source, 'contentWordId') &&
      Object.prototype.hasOwnProperty.call(source, 'wordId') &&
      source.contentWordId !== source.wordId
    ) {
      throw adminCloudError('admin/invalid-argument', 'Bulk word ID aliases must match.');
    }
    const contentWordId = requireContentWordId(source.contentWordId || source.wordId);
    if (seen.has(contentWordId)) {
      throw adminCloudError('admin/invalid-argument', 'Bulk word IDs must be unique.');
    }
    seen.add(contentWordId);
    return {
      contentWordId,
      expectedVersion: requireExpectedVersion(source.expectedVersion),
    };
  });
  return items.sort((left, right) => left.contentWordId.localeCompare(right.contentWordId));
}

function requireOptions(value, allowedFields, message, optional = false) {
  if (optional && value === undefined) return {};
  const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw adminCloudError('admin/invalid-argument', message);
  }
  const unknownFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknownFields.length) {
    throw adminCloudError('admin/invalid-argument', 'Options contain unsupported fields.', unknownFields);
  }
  return value;
}

function worldRecord(snapshot) {
  return {
    ...(snapshot.data() || {}),
    worldId: snapshot.id,
  };
}

function ranksCollection(worldId) {
  return collection(doc(contentWorlds, worldId), 'ranks');
}

function rankRecord(snapshot, worldId) {
  return {
    ...(snapshot.data() || {}),
    worldId,
    rankId: snapshot.id,
  };
}

function gatesCollection(worldId, rankId) {
  return collection(doc(ranksCollection(worldId), rankId), 'gates');
}

function gateRecord(snapshot, worldId, rankId) {
  return {
    ...(snapshot.data() || {}),
    worldId,
    rankId,
    gateId: snapshot.id,
  };
}

function wordsCollection(worldId, rankId, gateId) {
  return collection(doc(gatesCollection(worldId, rankId), gateId), 'words');
}

async function incrementWordCountersBestEffort(worldId, rankId, gateId, uid) {
  try {
    const results = await Promise.allSettled([
      updateDoc(doc(contentWorlds, worldId), {
        wordCount: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
      updateDoc(doc(ranksCollection(worldId), rankId), {
        wordCount: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
      updateDoc(doc(gatesCollection(worldId, rankId), gateId), {
        wordCount: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    ]);
    if (!results.some((result) => result.status === 'rejected')) {
      return;
    }
  } catch {
    // Counter drift is acceptable here; the word write already committed.
  }
  if (typeof console !== 'undefined') {
    console.warn('[LootLingua] Word saved, but one or more word counters were not incremented.');
  }
}

function wordRecord(snapshot, worldId, rankId, gateId) {
  return {
    ...(snapshot.data() || {}),
    worldId,
    rankId,
    gateId,
    contentWordId: snapshot.id,
  };
}

function compareWorlds(left, right) {
  const leftOrder = Number.isSafeInteger(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isSafeInteger(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const byTitle = String(left.title || '').localeCompare(String(right.title || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  return byTitle || String(left.worldId).localeCompare(String(right.worldId));
}

function compareRanks(left, right) {
  const leftOrder = Number.isSafeInteger(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isSafeInteger(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const byTitle = String(left.title || '').localeCompare(String(right.title || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  return byTitle || String(left.rankId).localeCompare(String(right.rankId));
}

function compareGates(left, right) {
  const leftOrder = Number.isSafeInteger(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isSafeInteger(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const byTitle = String(left.title || '').localeCompare(String(right.title || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  return byTitle || String(left.gateId).localeCompare(String(right.gateId));
}

function cleanWorldForStorage(candidate, worldId) {
  const schema = getContentSchema();
  if (
    candidate?.status === 'published' &&
    (typeof candidate.slug !== 'string' || !candidate.slug.trim())
  ) {
    throw adminCloudError('content/publish-requires-slug', 'A published world requires a slug.');
  }
  const world = schema.compactForStorage(schema.cleanWorld(candidate, { worldId }));
  if (!CONTENT_STATUSES.includes(world.status)) {
    throw adminCloudError('content/invalid-status', 'World status is invalid.');
  }
  if (world.status === 'published' && (typeof world.slug !== 'string' || !world.slug)) {
    throw adminCloudError('content/publish-requires-slug', 'A published world requires a slug.');
  }
  return world;
}

function buildCreateCandidate(payload, worldId, uid) {
  const source = requireWorldInput(payload);
  const candidate = { ...source };
  delete candidate.id;
  delete candidate.createdAt;
  delete candidate.updatedAt;
  candidate.worldId = worldId;
  candidate.version = 1;
  candidate.rankCount = 0;
  candidate.gateCount = 0;
  candidate.wordCount = 0;
  candidate.createdBy = uid;
  candidate.updatedBy = uid;
  return cleanWorldForStorage(candidate, worldId);
}

function buildUpdateCandidate(existing, patch, worldId, uid, nextVersion) {
  const source = requireWorldInput(patch);
  const candidate = {};
  WORLD_EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      candidate[field] = source[field];
    } else if (Object.prototype.hasOwnProperty.call(existing, field)) {
      candidate[field] = existing[field];
    }
  });
  candidate.schemaVersion = existing.schemaVersion;
  candidate.worldId = worldId;
  candidate.version = nextVersion;
  candidate.rankCount = existing.rankCount;
  candidate.gateCount = existing.gateCount;
  candidate.wordCount = existing.wordCount;
  candidate.createdBy = existing.createdBy;
  candidate.updatedBy = uid;
  return cleanWorldForStorage(candidate, worldId);
}

function cleanRankForStorage(candidate, worldId, rankId) {
  const schema = getContentSchema();
  const rank = schema.compactForStorage(schema.cleanRank(candidate, { worldId, rankId }));
  if (!CONTENT_STATUSES.includes(rank.status)) {
    throw adminCloudError('content/invalid-status', 'Rank status is invalid.');
  }
  return rank;
}

function buildRankCreateCandidate(payload, worldId, rankId, uid) {
  const source = requireRankInput(payload);
  const candidate = {};
  RANK_EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) candidate[field] = source[field];
  });
  if (Object.prototype.hasOwnProperty.call(source, 'schemaVersion')) {
    candidate.schemaVersion = source.schemaVersion;
  }
  candidate.worldId = worldId;
  candidate.rankId = rankId;
  candidate.version = 1;
  candidate.gateCount = 0;
  candidate.wordCount = 0;
  candidate.createdBy = uid;
  candidate.updatedBy = uid;
  return cleanRankForStorage(candidate, worldId, rankId);
}

function buildRankUpdateCandidate(existing, patch, worldId, rankId, uid, nextVersion) {
  const source = requireRankInput(patch);
  const candidate = {};
  RANK_EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      candidate[field] = source[field];
    } else if (Object.prototype.hasOwnProperty.call(existing, field)) {
      candidate[field] = existing[field];
    }
  });
  candidate.schemaVersion = existing.schemaVersion;
  candidate.worldId = worldId;
  candidate.rankId = rankId;
  candidate.version = nextVersion;
  candidate.gateCount = existing.gateCount;
  candidate.wordCount = existing.wordCount;
  candidate.createdBy = existing.createdBy;
  candidate.updatedBy = uid;
  return cleanRankForStorage(candidate, worldId, rankId);
}

function cleanGateForStorage(candidate, worldId, rankId, gateId) {
  const schema = getContentSchema();
  const gate = schema.compactForStorage(schema.cleanGate(candidate, {
    worldId,
    rankId,
    gateId,
  }));
  if (!CONTENT_STATUSES.includes(gate.status)) {
    throw adminCloudError('content/invalid-status', 'Gate status is invalid.');
  }
  return gate;
}

function buildGateCreateCandidate(payload, worldId, rankId, gateId, uid) {
  const source = requireGateInput(payload);
  const candidate = {};
  GATE_EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) candidate[field] = source[field];
  });
  if (Object.prototype.hasOwnProperty.call(source, 'schemaVersion')) {
    candidate.schemaVersion = source.schemaVersion;
  }
  candidate.worldId = worldId;
  candidate.rankId = rankId;
  candidate.gateId = gateId;
  candidate.version = 1;
  candidate.wordCount = 0;
  candidate.createdBy = uid;
  candidate.updatedBy = uid;
  return cleanGateForStorage(candidate, worldId, rankId, gateId);
}

function buildGateUpdateCandidate(existing, patch, worldId, rankId, gateId, uid, nextVersion) {
  const source = requireGateInput(patch);
  const candidate = {};
  GATE_EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      candidate[field] = source[field];
    } else if (Object.prototype.hasOwnProperty.call(existing, field)) {
      candidate[field] = existing[field];
    }
  });
  candidate.schemaVersion = existing.schemaVersion;
  candidate.worldId = worldId;
  candidate.rankId = rankId;
  candidate.gateId = gateId;
  candidate.version = nextVersion;
  candidate.wordCount = existing.wordCount;
  candidate.createdBy = existing.createdBy;
  candidate.updatedBy = uid;
  return cleanGateForStorage(candidate, worldId, rankId, gateId);
}

function cleanWordForStorage(candidate, worldId, rankId, gateId, contentWordId) {
  const schema = getContentSchema();
  const word = schema.compactForStorage(schema.cleanWord(candidate, {
    worldId,
    rankId,
    gateId,
    contentWordId,
  }));
  if (!CONTENT_STATUSES.includes(word.status)) {
    throw adminCloudError('content/invalid-status', 'Word status is invalid.');
  }
  return word;
}

function buildWordCreateCandidate(payload, worldId, rankId, gateId, contentWordId, uid) {
  const source = requireWordInput(payload);
  const candidate = {};
  WORD_EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) candidate[field] = source[field];
  });
  if (Object.prototype.hasOwnProperty.call(source, 'schemaVersion')) {
    candidate.schemaVersion = source.schemaVersion;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'normalizationVersion')) {
    candidate.normalizationVersion = source.normalizationVersion;
  }
  candidate.worldId = worldId;
  candidate.rankId = rankId;
  candidate.gateId = gateId;
  candidate.contentWordId = contentWordId;
  candidate.version = 1;
  candidate.createdBy = uid;
  candidate.updatedBy = uid;
  return cleanWordForStorage(candidate, worldId, rankId, gateId, contentWordId);
}

function buildWordUpdateCandidate(
  existing,
  patch,
  worldId,
  rankId,
  gateId,
  contentWordId,
  uid,
  nextVersion
) {
  const source = requireWordInput(patch);
  const candidate = {};
  WORD_EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      candidate[field] = source[field];
    } else if (Object.prototype.hasOwnProperty.call(existing, field)) {
      candidate[field] = existing[field];
    }
  });
  candidate.schemaVersion = existing.schemaVersion;
  candidate.normalizationVersion = existing.normalizationVersion;
  candidate.worldId = worldId;
  candidate.rankId = rankId;
  candidate.gateId = gateId;
  candidate.contentWordId = contentWordId;
  candidate.version = nextVersion;
  candidate.createdBy = existing.createdBy;
  candidate.updatedBy = uid;
  return cleanWordForStorage(candidate, worldId, rankId, gateId, contentWordId);
}

function assertStoredWord(existing, worldId, rankId, gateId, contentWordId) {
  const schema = getContentSchema();
  const identity = schema.normalizeWordIdentity(existing.word);
  if (
    existing.worldId !== worldId ||
    existing.rankId !== rankId ||
    existing.gateId !== gateId ||
    existing.contentWordId !== contentWordId ||
    existing.normalizedWord !== identity.normalizedWord ||
    existing.wordKey !== identity.wordKey ||
    existing.normalizationVersion !== identity.normalizationVersion ||
    !CONTENT_STATUSES.includes(existing.status) ||
    !Number.isSafeInteger(existing.version) ||
    existing.version < 1 ||
    existing.version > schema.LIMITS.count ||
    !Object.prototype.hasOwnProperty.call(existing, 'createdAt') ||
    typeof existing.createdBy !== 'string' ||
    !existing.createdBy
  ) {
    throw adminCloudError('admin/corrupt-data', 'The stored word has invalid system fields.');
  }
}

async function findWordDuplicates(
  context,
  worldId,
  rankId,
  gateId,
  normalizedWord,
  excludedContentWordId
) {
  const [gateSnapshot, worldSnapshot] = await Promise.all([
    getDocs(query(
      wordsCollection(worldId, rankId, gateId),
      where('normalizedWord', '==', normalizedWord),
      limit(2)
    )),
    getDocs(query(
      collectionGroup(db, 'words'),
      where('worldId', '==', worldId),
      where('normalizedWord', '==', normalizedWord),
      limit(WORD_PAGE_SIZE_MAX + 1)
    )),
  ]);
  assertAdminContext(context);
  const worldMatches = worldSnapshot.docs
    .map((item) => ({ ...(item.data() || {}), contentWordId: item.id }))
    .filter((item) => !(
      item.rankId === rankId &&
      item.gateId === gateId &&
      item.contentWordId === excludedContentWordId
    ));
  const gateMatches = gateSnapshot.docs
    .map((item) => ({ ...(item.data() || {}), contentWordId: item.id }))
    .filter((item) => item.contentWordId !== excludedContentWordId);
  const byPath = new Map();
  worldMatches.concat(gateMatches).forEach((item) => {
    byPath.set([
      item.worldId,
      item.rankId,
      item.gateId,
      item.contentWordId,
    ].join('/'), item);
  });
  const matches = Array.from(byPath.values());
  const visibleMatches = matches.slice(0, WORD_PAGE_SIZE_MAX).map((item) => ({
    worldId: item.worldId,
    rankId: item.rankId,
    gateId: item.gateId,
    contentWordId: item.contentWordId,
    status: item.status,
  }));
  const duplicateInGate = matches.some((item) =>
    item.rankId === rankId && item.gateId === gateId
  );
  const duplicateInRank = matches.some((item) => item.rankId === rankId);
  const duplicateInWorld = matches.length > 0;
  const duplicateScopes = [];
  if (duplicateInGate) duplicateScopes.push('gate');
  if (duplicateInRank) duplicateScopes.push('rank');
  if (duplicateInWorld) duplicateScopes.push('world');
  return Object.freeze({
    normalizedWord,
    duplicateInGate,
    duplicateInRank,
    duplicateInWorld,
    duplicateScopes: Object.freeze(duplicateScopes),
    matches: Object.freeze(visibleMatches),
    hasMore: worldSnapshot.docs.length > WORD_PAGE_SIZE_MAX,
  });
}

function assertStoredWorld(existing, worldId) {
  const countersAreValid = ['rankCount', 'gateCount', 'wordCount'].every((field) =>
    Number.isSafeInteger(existing[field]) && existing[field] >= 0
  );
  if (
    existing.worldId !== worldId ||
    !Number.isSafeInteger(existing.version) ||
    existing.version < 1 ||
    !Object.prototype.hasOwnProperty.call(existing, 'createdAt') ||
    typeof existing.createdBy !== 'string' ||
    !existing.createdBy ||
    !countersAreValid
  ) {
    throw adminCloudError('admin/corrupt-data', 'The stored world has invalid system fields.');
  }
}

function assertStoredRank(existing, worldId, rankId) {
  const countersAreValid = ['gateCount', 'wordCount'].every((field) =>
    Number.isSafeInteger(existing[field]) && existing[field] >= 0
  );
  if (
    existing.worldId !== worldId ||
    existing.rankId !== rankId ||
    !Number.isSafeInteger(existing.version) ||
    existing.version < 1 ||
    !Object.prototype.hasOwnProperty.call(existing, 'createdAt') ||
    typeof existing.createdBy !== 'string' ||
    !existing.createdBy ||
    !countersAreValid
  ) {
    throw adminCloudError('admin/corrupt-data', 'The stored rank has invalid system fields.');
  }
}

function assertStoredGate(existing, worldId, rankId, gateId) {
  if (
    existing.worldId !== worldId ||
    existing.rankId !== rankId ||
    existing.gateId !== gateId ||
    !Number.isSafeInteger(existing.version) ||
    existing.version < 1 ||
    !Number.isSafeInteger(existing.wordCount) ||
    existing.wordCount < 0 ||
    !Object.prototype.hasOwnProperty.call(existing, 'createdAt') ||
    typeof existing.createdBy !== 'string' ||
    !existing.createdBy
  ) {
    throw adminCloudError('admin/corrupt-data', 'The stored gate has invalid system fields.');
  }
}

async function listWorlds() {
  try {
    const context = await requireAdminContext();
    const snapshot = await getDocs(query(contentWorlds, orderBy('order', 'asc')));
    assertAdminContext(context);
    return snapshot.docs.map(worldRecord).sort(compareWorlds);
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/list-failed');
  }
}

async function getWorld(worldId) {
  try {
    const context = await requireAdminContext();
    const id = requireWorldId(worldId);
    const snapshot = await getDoc(doc(contentWorlds, id));
    assertAdminContext(context);
    if (!snapshot.exists()) {
      throw adminCloudError('admin/not-found', 'World not found.');
    }
    return worldRecord(snapshot);
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/read-failed');
  }
}

async function createWorld(payload) {
  try {
    const context = await requireAdminContext();
    const reference = doc(contentWorlds);
    const world = buildCreateCandidate(payload, reference.id, context.uid);
    assertAdminContext(context);

    const savedWorld = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const existing = await transaction.get(reference);
      assertAdminContext(context);
      if (existing.exists()) {
        throw adminCloudError('admin/already-exists', 'The generated worldId already exists.');
      }
      const createdAt = serverTimestamp();
      const updatedAt = serverTimestamp();
      const saved = {
        ...world,
        createdAt,
        updatedAt,
        createdBy: context.uid,
        updatedBy: context.uid,
      };
      transaction.set(reference, saved);
      return { ...saved, worldId: reference.id };
    });
    assertAdminContext(context);
    return savedWorld;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/create-failed');
  }
}

async function updateWorld(worldId, payload, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const id = requireWorldId(worldId);
    const version = requireExpectedVersion(expectedVersion);
    const patch = requireWorldInput(payload);
    const reference = doc(contentWorlds, id);

    const savedWorld = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const snapshot = await transaction.get(reference);
      assertAdminContext(context);
      if (!snapshot.exists()) {
        throw adminCloudError('admin/not-found', 'World not found.');
      }
      const existing = snapshot.data() || {};
      assertStoredWorld(existing, id);
      if (existing.version !== version) {
        throw adminCloudError('admin/version-conflict', 'The world was changed by another request.', {
          expectedVersion: version,
          actualVersion: existing.version,
        });
      }

      const world = buildUpdateCandidate(existing, patch, id, context.uid, existing.version + 1);
      const updatedAt = serverTimestamp();
      const saved = {
        ...world,
        worldId: id,
        version: existing.version + 1,
        rankCount: existing.rankCount,
        gateCount: existing.gateCount,
        wordCount: existing.wordCount,
        createdAt: existing.createdAt,
        createdBy: existing.createdBy,
        updatedAt,
        updatedBy: context.uid,
      };
      transaction.set(reference, saved);
      return saved;
    });
    assertAdminContext(context);
    return savedWorld;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/update-failed');
  }
}

async function setWorldStatus(worldId, status, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const result = await updateWorld(worldId, { status }, expectedVersion);
    assertAdminContext(context);
    return result;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/status-update-failed');
  }
}

async function requestDeleteWorld(worldId, options) {
  try {
    const context = await requireAdminContext();
    const id = requireWorldId(worldId);
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw adminCloudError('admin/invalid-argument', 'Delete confirmation data is required.');
    }
    const confirmationTitle = options.confirmationTitle;
    if (typeof confirmationTitle !== 'string' || !confirmationTitle) {
      throw adminCloudError('admin/invalid-argument', 'An exact confirmationTitle is required.');
    }
    const payload = { worldId: id, confirmationTitle };
    if (options.expectedVersion !== undefined) {
      payload.expectedVersion = requireExpectedVersion(options.expectedVersion);
    }
    assertAdminContext(context);
    const response = await deleteContentWorld(payload);
    assertAdminContext(context);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/delete-failed');
  }
}

async function listRanks(worldId) {
  try {
    const context = await requireAdminContext();
    const parentId = requireWorldId(worldId);
    const snapshot = await getDocs(query(ranksCollection(parentId), orderBy('order', 'asc')));
    assertAdminContext(context);
    return snapshot.docs.map((item) => rankRecord(item, parentId)).sort(compareRanks);
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/list-failed');
  }
}

async function getRank(worldId, rankId) {
  try {
    const context = await requireAdminContext();
    const parentId = requireWorldId(worldId);
    const id = requireRankId(rankId);
    const snapshot = await getDoc(doc(ranksCollection(parentId), id));
    assertAdminContext(context);
    if (!snapshot.exists()) {
      throw adminCloudError('admin/not-found', 'Rank not found.');
    }
    return rankRecord(snapshot, parentId);
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/read-failed');
  }
}

async function createRank(worldId, payload) {
  try {
    const context = await requireAdminContext();
    const parentId = requireWorldId(worldId);
    const worldReference = doc(contentWorlds, parentId);
    const reference = doc(ranksCollection(parentId));
    const rankId = requireRankId(reference.id);
    const rank = buildRankCreateCandidate(payload, parentId, rankId, context.uid);
    assertAdminContext(context);

    const savedRank = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const worldSnapshot = await transaction.get(worldReference);
      assertAdminContext(context);
      if (!worldSnapshot.exists()) {
        throw adminCloudError('admin/not-found', 'Parent world not found.');
      }
      const existingWorld = worldSnapshot.data() || {};
      assertStoredWorld(existingWorld, parentId);

      const existingRank = await transaction.get(reference);
      assertAdminContext(context);
      if (existingRank.exists()) {
        throw adminCloudError('admin/already-exists', 'The generated rankId already exists.');
      }
      const nextRankCount = existingWorld.rankCount + 1;
      if (!Number.isSafeInteger(nextRankCount)) {
        throw adminCloudError('admin/corrupt-data', 'The world rankCount cannot be incremented safely.');
      }

      const createdAt = serverTimestamp();
      const updatedAt = serverTimestamp();
      const saved = {
        ...rank,
        createdAt,
        updatedAt,
        createdBy: context.uid,
        updatedBy: context.uid,
      };
      transaction.set(reference, saved);
      transaction.update(worldReference, {
        rankCount: nextRankCount,
        updatedAt: serverTimestamp(),
        updatedBy: context.uid,
      });
      return { ...saved, worldId: parentId, rankId };
    });
    assertAdminContext(context);
    return savedRank;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/create-failed');
  }
}

async function updateRank(worldId, rankId, payload, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const parentId = requireWorldId(worldId);
    const id = requireRankId(rankId);
    const version = requireExpectedVersion(expectedVersion);
    const patch = requireRankInput(payload);
    const reference = doc(ranksCollection(parentId), id);

    const savedRank = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const snapshot = await transaction.get(reference);
      assertAdminContext(context);
      if (!snapshot.exists()) {
        throw adminCloudError('admin/not-found', 'Rank not found.');
      }
      const existing = snapshot.data() || {};
      assertStoredRank(existing, parentId, id);
      if (existing.version !== version) {
        throw adminCloudError('admin/version-conflict', 'The rank was changed by another request.', {
          expectedVersion: version,
          actualVersion: existing.version,
        });
      }

      const rank = buildRankUpdateCandidate(
        existing,
        patch,
        parentId,
        id,
        context.uid,
        existing.version + 1
      );
      const updatedAt = serverTimestamp();
      const saved = {
        ...rank,
        worldId: parentId,
        rankId: id,
        version: existing.version + 1,
        gateCount: existing.gateCount,
        wordCount: existing.wordCount,
        createdAt: existing.createdAt,
        createdBy: existing.createdBy,
        updatedAt,
        updatedBy: context.uid,
      };
      transaction.set(reference, saved);
      return saved;
    });
    assertAdminContext(context);
    return savedRank;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/update-failed');
  }
}

async function setRankStatus(worldId, rankId, status, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const result = await updateRank(worldId, rankId, { status }, expectedVersion);
    assertAdminContext(context);
    return result;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/status-update-failed');
  }
}

async function duplicateRankAsDraft(worldId, rankId, expectedVersion, options) {
  try {
    const context = await requireAdminContext();
    const parentId = requireWorldId(worldId);
    const id = requireRankId(rankId);
    const version = requireExpectedVersion(expectedVersion);
    const settings = requireOptions(
      options,
      new Set(['operationId']),
      'Duplicate options must be an object.',
      true
    );
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify(['duplicateContentRank', parentId, id, version]),
      context.uid
    );
    assertAdminContext(context);
    const response = await duplicateContentRank({
      worldId: parentId,
      rankId: id,
      expectedVersion: version,
      operationId: operationToken.operationId,
    });
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/duplicate-failed');
  }
}

async function requestDeleteRank(worldId, rankId, options) {
  try {
    const context = await requireAdminContext();
    const parentId = requireWorldId(worldId);
    const id = requireRankId(rankId);
    const settings = requireOptions(
      options,
      new Set(['confirmationTitle', 'expectedVersion', 'operationId']),
      'Delete confirmation data is required.'
    );
    if (typeof settings.confirmationTitle !== 'string' || !settings.confirmationTitle) {
      throw adminCloudError('admin/invalid-argument', 'An exact confirmationTitle is required.');
    }
    const version = requireExpectedVersion(settings.expectedVersion);
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify([
        'deleteContentRank',
        parentId,
        id,
        version,
        settings.confirmationTitle,
      ]),
      context.uid
    );
    assertAdminContext(context);
    const response = await deleteContentRank({
      worldId: parentId,
      rankId: id,
      confirmationTitle: settings.confirmationTitle,
      expectedVersion: version,
      operationId: operationToken.operationId,
    });
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/delete-failed');
  }
}

async function listGates(worldId, rankId) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const snapshot = await getDocs(query(
      gatesCollection(parentWorldId, parentRankId),
      orderBy('order', 'asc')
    ));
    assertAdminContext(context);
    return snapshot.docs
      .map((item) => gateRecord(item, parentWorldId, parentRankId))
      .sort(compareGates);
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/list-failed');
  }
}

async function getGate(worldId, rankId, gateId) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const id = requireGateId(gateId);
    const snapshot = await getDoc(doc(gatesCollection(parentWorldId, parentRankId), id));
    assertAdminContext(context);
    if (!snapshot.exists()) {
      throw adminCloudError('admin/not-found', 'Gate not found.');
    }
    return gateRecord(snapshot, parentWorldId, parentRankId);
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/read-failed');
  }
}

async function createGate(worldId, rankId, payload) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const worldReference = doc(contentWorlds, parentWorldId);
    const rankReference = doc(ranksCollection(parentWorldId), parentRankId);
    const reference = doc(gatesCollection(parentWorldId, parentRankId));
    const gateId = requireGateId(reference.id);
    const gate = buildGateCreateCandidate(
      payload,
      parentWorldId,
      parentRankId,
      gateId,
      context.uid
    );
    assertAdminContext(context);

    const savedGate = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const worldSnapshot = await transaction.get(worldReference);
      assertAdminContext(context);
      const rankSnapshot = await transaction.get(rankReference);
      assertAdminContext(context);
      const gateSnapshot = await transaction.get(reference);
      assertAdminContext(context);

      if (!worldSnapshot.exists()) {
        throw adminCloudError('admin/not-found', 'Parent world not found.');
      }
      if (!rankSnapshot.exists()) {
        throw adminCloudError('admin/not-found', 'Parent rank not found.');
      }
      if (gateSnapshot.exists()) {
        throw adminCloudError('admin/already-exists', 'The generated gateId already exists.');
      }

      const existingWorld = worldSnapshot.data() || {};
      const existingRank = rankSnapshot.data() || {};
      assertStoredWorld(existingWorld, parentWorldId);
      assertStoredRank(existingRank, parentWorldId, parentRankId);
      const nextWorldGateCount = existingWorld.gateCount + 1;
      const nextRankGateCount = existingRank.gateCount + 1;
      if (!Number.isSafeInteger(nextWorldGateCount) || !Number.isSafeInteger(nextRankGateCount)) {
        throw adminCloudError('admin/corrupt-data', 'The parent gateCount cannot be incremented safely.');
      }

      const createdAt = serverTimestamp();
      const updatedAt = serverTimestamp();
      const saved = {
        ...gate,
        createdAt,
        updatedAt,
        createdBy: context.uid,
        updatedBy: context.uid,
      };
      transaction.set(reference, saved);
      transaction.update(rankReference, {
        gateCount: nextRankGateCount,
        updatedAt: serverTimestamp(),
        updatedBy: context.uid,
      });
      transaction.update(worldReference, {
        gateCount: nextWorldGateCount,
        updatedAt: serverTimestamp(),
        updatedBy: context.uid,
      });
      return {
        ...saved,
        worldId: parentWorldId,
        rankId: parentRankId,
        gateId,
      };
    });
    assertAdminContext(context);
    return savedGate;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/create-failed');
  }
}

async function updateGate(worldId, rankId, gateId, payload, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const id = requireGateId(gateId);
    const version = requireExpectedVersion(expectedVersion);
    const patch = requireGateInput(payload);
    const reference = doc(gatesCollection(parentWorldId, parentRankId), id);

    const savedGate = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const snapshot = await transaction.get(reference);
      assertAdminContext(context);
      if (!snapshot.exists()) {
        throw adminCloudError('admin/not-found', 'Gate not found.');
      }
      const existing = snapshot.data() || {};
      assertStoredGate(existing, parentWorldId, parentRankId, id);
      if (existing.version !== version) {
        throw adminCloudError('admin/version-conflict', 'The gate was changed by another request.', {
          expectedVersion: version,
          actualVersion: existing.version,
        });
      }

      const gate = buildGateUpdateCandidate(
        existing,
        patch,
        parentWorldId,
        parentRankId,
        id,
        context.uid,
        existing.version + 1
      );
      const saved = {
        ...gate,
        worldId: parentWorldId,
        rankId: parentRankId,
        gateId: id,
        version: existing.version + 1,
        wordCount: existing.wordCount,
        createdAt: existing.createdAt,
        createdBy: existing.createdBy,
        updatedAt: serverTimestamp(),
        updatedBy: context.uid,
      };
      transaction.set(reference, saved);
      return saved;
    });
    assertAdminContext(context);
    return savedGate;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/update-failed');
  }
}

async function setGateStatus(worldId, rankId, gateId, status, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const result = await updateGate(worldId, rankId, gateId, { status }, expectedVersion);
    assertAdminContext(context);
    return result;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/status-update-failed');
  }
}

async function duplicateGateAsDraft(worldId, rankId, gateId, expectedVersion, options) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const id = requireGateId(gateId);
    const version = requireExpectedVersion(expectedVersion);
    const settings = requireOptions(
      options,
      new Set(['operationId']),
      'Duplicate options must be an object.',
      true
    );
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify(['duplicateContentGate', parentWorldId, parentRankId, id, version]),
      context.uid
    );
    assertAdminContext(context);
    const response = await duplicateContentGate({
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: id,
      expectedVersion: version,
      operationId: operationToken.operationId,
    });
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/duplicate-failed');
  }
}

async function moveGate(worldId, rankId, gateId, target, expectedVersion, options) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const id = requireGateId(gateId);
    const destination = requireOptions(
      target,
      new Set(['worldId', 'rankId']),
      'A target world and rank are required.'
    );
    const targetWorldId = requireWorldId(destination.worldId);
    const targetRankId = requireRankId(destination.rankId);
    if (targetWorldId === parentWorldId && targetRankId === parentRankId) {
      throw adminCloudError('admin/invalid-argument', 'The target rank must differ from the source rank.');
    }
    const version = requireExpectedVersion(expectedVersion);
    const settings = requireOptions(
      options,
      new Set(['operationId', 'confirmationTitle']),
      'Move options must be an object.',
      false
    );
    if (typeof settings.confirmationTitle !== 'string' || !settings.confirmationTitle) {
      throw adminCloudError('admin/invalid-argument', 'An exact confirmationTitle is required.');
    }
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify([
        'moveContentGate',
        parentWorldId,
        parentRankId,
        id,
        targetWorldId,
        targetRankId,
        version,
        settings.confirmationTitle,
      ]),
      context.uid
    );
    assertAdminContext(context);
    const response = await moveContentGate({
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: id,
      targetWorldId,
      targetRankId,
      confirmationTitle: settings.confirmationTitle,
      expectedVersion: version,
      operationId: operationToken.operationId,
    });
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/move-failed');
  }
}

async function requestDeleteGate(worldId, rankId, gateId, options) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const id = requireGateId(gateId);
    const settings = requireOptions(
      options,
      new Set(['confirmationTitle', 'expectedVersion', 'operationId']),
      'Delete confirmation data is required.'
    );
    if (typeof settings.confirmationTitle !== 'string' || !settings.confirmationTitle) {
      throw adminCloudError('admin/invalid-argument', 'An exact confirmationTitle is required.');
    }
    const version = requireExpectedVersion(settings.expectedVersion);
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify([
        'deleteContentGate',
        parentWorldId,
        parentRankId,
        id,
        version,
        settings.confirmationTitle,
      ]),
      context.uid
    );
    assertAdminContext(context);
    const response = await deleteContentGate({
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: id,
      confirmationTitle: settings.confirmationTitle,
      expectedVersion: version,
      operationId: operationToken.operationId,
    });
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/delete-failed');
  }
}

async function listWords(worldId, rankId, gateId, options) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const settings = requireOptions(
      options,
      new Set(['pageSize', 'pageToken', 'cursor']),
      'Word list options must be an object.',
      true
    );
    const pageSize = requireWordPageSize(settings.pageSize);
    if (
      settings.pageToken !== undefined &&
      settings.cursor !== undefined &&
      settings.pageToken !== settings.cursor
    ) {
      throw adminCloudError('admin/invalid-argument', 'pageToken and cursor must match.');
    }
    const pageToken = settings.pageToken ?? settings.cursor ?? '';
    const constraints = [
      orderBy('order', 'asc'),
      orderBy(documentId(), 'asc'),
    ];
    if (pageToken) {
      const cursor = decodeWordPageToken(
        pageToken,
        parentWorldId,
        parentRankId,
        parentGateId
      );
      constraints.push(startAfter(cursor.order, cursor.contentWordId));
    }
    constraints.push(limit(pageSize + 1));
    const snapshot = await getDocs(query(
      wordsCollection(parentWorldId, parentRankId, parentGateId),
      ...constraints
    ));
    assertAdminContext(context);
    const hasMore = snapshot.docs.length > pageSize;
    const items = snapshot.docs.slice(0, pageSize).map((item) =>
      wordRecord(item, parentWorldId, parentRankId, parentGateId)
    );
    items.forEach((item) => assertStoredWord(
      item,
      parentWorldId,
      parentRankId,
      parentGateId,
      item.contentWordId
    ));
    const nextPageToken = hasMore && items.length
      ? encodeWordPageToken(
        parentWorldId,
        parentRankId,
        parentGateId,
        items[items.length - 1]
      )
      : null;
    return {
      items,
      pageSize,
      hasMore,
      nextPageToken,
      nextCursor: nextPageToken,
    };
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/list-failed');
  }
}

async function getWord(worldId, rankId, gateId, contentWordId) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const id = requireContentWordId(contentWordId);
    const snapshot = await getDoc(doc(
      wordsCollection(parentWorldId, parentRankId, parentGateId),
      id
    ));
    assertAdminContext(context);
    if (!snapshot.exists()) {
      throw adminCloudError('admin/not-found', 'Word not found.');
    }
    const word = wordRecord(snapshot, parentWorldId, parentRankId, parentGateId);
    assertStoredWord(word, parentWorldId, parentRankId, parentGateId, id);
    return word;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/read-failed');
  }
}

async function inspectWordDuplicates(worldId, rankId, gateId, word, options) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const settings = requireOptions(
      options,
      new Set(['contentWordId']),
      'Duplicate inspection options must be an object.',
      true
    );
    const excludedContentWordId = settings.contentWordId === undefined
      ? ''
      : requireContentWordId(settings.contentWordId);
    const schema = getContentSchema();
    const preview = schema.cleanWord({
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: parentGateId,
      contentWordId: excludedContentWordId || 'word_preview',
      word,
      translation: 'preview',
      status: 'draft',
    });
    return await findWordDuplicates(
      context,
      parentWorldId,
      parentRankId,
      parentGateId,
      preview.normalizedWord,
      excludedContentWordId
    );
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/duplicate-check-failed');
  }
}

async function createWord(worldId, rankId, gateId, payload) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const provisionalWord = buildWordCreateCandidate(
      payload,
      parentWorldId,
      parentRankId,
      parentGateId,
      'word_preview',
      context.uid
    );
    const contentWordId = await deriveContentWordId(
      provisionalWord.normalizedWord,
      provisionalWord.normalizationVersion
    );
    assertAdminContext(context);
    const word = buildWordCreateCandidate(
      payload,
      parentWorldId,
      parentRankId,
      parentGateId,
      contentWordId,
      context.uid
    );
    const duplicateAnalysis = await findWordDuplicates(
      context,
      parentWorldId,
      parentRankId,
      parentGateId,
      word.normalizedWord,
      ''
    );
    if (duplicateAnalysis.duplicateInGate) {
      throw adminCloudError(
        'content/duplicate-word-in-gate',
        'The normalized word already exists in this gate.',
        duplicateAnalysis
      );
    }

    const wordReference = doc(
      wordsCollection(parentWorldId, parentRankId, parentGateId),
      contentWordId
    );
    const savedWord = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const existingWordSnapshot = await transaction.get(wordReference);
      assertAdminContext(context);
      if (existingWordSnapshot.exists()) {
        const collision = existingWordSnapshot.data() || {};
        throw adminCloudError(
          collision.normalizedWord === word.normalizedWord
            ? 'content/duplicate-word-in-gate'
            : 'content/word-identity-collision',
          collision.normalizedWord === word.normalizedWord
            ? 'The normalized word already exists in this gate.'
            : 'The deterministic word identity is already occupied.'
        );
      }
      const saved = {
        ...word,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: context.uid,
        updatedBy: context.uid,
      };
      transaction.set(wordReference, saved);
      return saved;
    });
    assertAdminContext(context);
    void incrementWordCountersBestEffort(
      parentWorldId,
      parentRankId,
      parentGateId,
      context.uid
    );
    return {
      ...savedWord,
      duplicateAnalysis: {
        ...duplicateAnalysis,
        duplicateScopes: duplicateAnalysis.duplicateScopes.filter((scope) => scope !== 'gate'),
      },
    };
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/create-failed');
  }
}

async function updateWord(worldId, rankId, gateId, contentWordId, payload, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const id = requireContentWordId(contentWordId);
    const version = requireExpectedVersion(expectedVersion);
    const patch = requireWordInput(payload);
    const reference = doc(wordsCollection(parentWorldId, parentRankId, parentGateId), id);
    const savedWord = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const snapshot = await transaction.get(reference);
      assertAdminContext(context);
      if (!snapshot.exists()) {
        throw adminCloudError('admin/not-found', 'Word not found.');
      }
      const existing = snapshot.data() || {};
      assertStoredWord(existing, parentWorldId, parentRankId, parentGateId, id);
      if (existing.version !== version) {
        throw adminCloudError('admin/version-conflict', 'The word was changed by another request.', {
          expectedVersion: version,
          actualVersion: existing.version,
        });
      }
      const word = buildWordUpdateCandidate(
        existing,
        patch,
        parentWorldId,
        parentRankId,
        parentGateId,
        id,
        context.uid,
        existing.version + 1
      );
      if (word.normalizedWord !== existing.normalizedWord) {
        throw adminCloudError(
          'content/word-identity-immutable',
          'Changing a normalized word identity requires creating a new word.'
        );
      }
      const saved = {
        ...word,
        worldId: parentWorldId,
        rankId: parentRankId,
        gateId: parentGateId,
        contentWordId: id,
        version: existing.version + 1,
        createdAt: existing.createdAt,
        createdBy: existing.createdBy,
        updatedAt: serverTimestamp(),
        updatedBy: context.uid,
      };
      transaction.set(reference, saved);
      return saved;
    });
    assertAdminContext(context);
    return savedWord;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/update-failed');
  }
}

async function setWordStatus(worldId, rankId, gateId, contentWordId, status, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const result = await updateWord(
      worldId,
      rankId,
      gateId,
      contentWordId,
      { status },
      expectedVersion
    );
    assertAdminContext(context);
    return result;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/status-update-failed');
  }
}

async function archiveWord(worldId, rankId, gateId, contentWordId, expectedVersion) {
  try {
    const context = await requireAdminContext();
    const result = await setWordStatus(
      worldId,
      rankId,
      gateId,
      contentWordId,
      'archived',
      expectedVersion
    );
    assertAdminContext(context);
    return result;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/archive-failed');
  }
}

async function bulkSetWordStatus(worldId, rankId, gateId, status, items) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    if (!['published', 'archived'].includes(status)) {
      throw adminCloudError('admin/invalid-argument', 'Bulk word status is invalid.');
    }
    const canonicalItems = requireBulkWordItems(items);
    const savedWords = await runTransaction(db, async (transaction) => {
      assertAdminContext(context);
      const currentWords = await Promise.all(canonicalItems.map(async (item) => {
        const reference = doc(
          wordsCollection(parentWorldId, parentRankId, parentGateId),
          item.contentWordId
        );
        const snapshot = await transaction.get(reference);
        return { item, reference, snapshot };
      }));
      assertAdminContext(context);
      const updates = currentWords.map(({ item, reference, snapshot }) => {
        if (!snapshot.exists()) {
          throw adminCloudError('admin/not-found', 'Word not found.');
        }
        const existing = snapshot.data() || {};
        assertStoredWord(existing, parentWorldId, parentRankId, parentGateId, item.contentWordId);
        if (existing.version !== item.expectedVersion) {
          throw adminCloudError('admin/version-conflict', 'A word was changed by another request.', {
            contentWordId: item.contentWordId,
            expectedVersion: item.expectedVersion,
            actualVersion: existing.version,
          });
        }
        const word = buildWordUpdateCandidate(
          existing,
          { status },
          parentWorldId,
          parentRankId,
          parentGateId,
          item.contentWordId,
          context.uid,
          existing.version + 1
        );
        return {
          reference,
          saved: {
            ...word,
            worldId: parentWorldId,
            rankId: parentRankId,
            gateId: parentGateId,
            contentWordId: item.contentWordId,
            version: existing.version + 1,
            createdAt: existing.createdAt,
            createdBy: existing.createdBy,
            updatedAt: serverTimestamp(),
            updatedBy: context.uid,
          },
        };
      });
      updates.forEach(({ reference, saved }) => transaction.set(reference, saved));
      return updates.map(({ saved }) => saved);
    });
    assertAdminContext(context);
    return savedWords;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/bulk-update-failed');
  }
}

async function duplicateWord(
  worldId,
  rankId,
  gateId,
  contentWordId,
  target,
  expectedVersion,
  options
) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const id = requireContentWordId(contentWordId);
    const destination = requireWordTarget(target);
    if (
      destination.worldId === parentWorldId &&
      destination.rankId === parentRankId &&
      destination.gateId === parentGateId
    ) {
      throw adminCloudError(
        'admin/invalid-argument',
        'A word cannot be duplicated inside the same gate.'
      );
    }
    const version = requireExpectedVersion(expectedVersion);
    const settings = requireOptions(
      options,
      new Set(['operationId']),
      'Duplicate options must be an object.',
      true
    );
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify([
        'duplicateContentWord',
        parentWorldId,
        parentRankId,
        parentGateId,
        id,
        destination.worldId,
        destination.rankId,
        destination.gateId,
        version,
      ]),
      context.uid
    );
    assertAdminContext(context);
    const response = await duplicateContentWord({
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: parentGateId,
      contentWordId: id,
      targetWorldId: destination.worldId,
      targetRankId: destination.rankId,
      targetGateId: destination.gateId,
      expectedVersion: version,
      operationId: operationToken.operationId,
    });
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/duplicate-failed');
  }
}

async function moveWord(
  worldId,
  rankId,
  gateId,
  contentWordId,
  target,
  expectedVersion,
  options
) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const id = requireContentWordId(contentWordId);
    const destination = requireWordTarget(target);
    if (
      destination.worldId === parentWorldId &&
      destination.rankId === parentRankId &&
      destination.gateId === parentGateId
    ) {
      throw adminCloudError('admin/invalid-argument', 'The target gate must differ from the source gate.');
    }
    const version = requireExpectedVersion(expectedVersion);
    const settings = requireOptions(
      options,
      new Set(['operationId', 'confirmationWord']),
      'Move options must be an object.'
    );
    if (typeof settings.confirmationWord !== 'string' || !settings.confirmationWord) {
      throw adminCloudError('admin/invalid-argument', 'An exact confirmationWord is required.');
    }
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify([
        'moveContentWord',
        parentWorldId,
        parentRankId,
        parentGateId,
        id,
        destination.worldId,
        destination.rankId,
        destination.gateId,
        version,
        settings.confirmationWord,
      ]),
      context.uid
    );
    assertAdminContext(context);
    const response = await moveContentWord({
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: parentGateId,
      contentWordId: id,
      targetWorldId: destination.worldId,
      targetRankId: destination.rankId,
      targetGateId: destination.gateId,
      confirmationWord: settings.confirmationWord,
      expectedVersion: version,
      operationId: operationToken.operationId,
    });
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/move-failed');
  }
}

async function bulkWordOperation(worldId, rankId, gateId, action, items, options) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    if (!['publish', 'archive', 'move'].includes(action)) {
      throw adminCloudError('admin/invalid-argument', 'Bulk action is invalid.');
    }
    const canonicalItems = requireBulkWordItems(items);
    const settings = requireOptions(
      options,
      new Set(['operationId', 'target']),
      'Bulk operation options must be an object.',
      action !== 'move'
    );
    const destination = action === 'move' ? requireWordTarget(settings.target) : null;
    if (
      destination &&
      destination.worldId === parentWorldId &&
      destination.rankId === parentRankId &&
      destination.gateId === parentGateId
    ) {
      throw adminCloudError('admin/invalid-argument', 'The target gate must differ from the source gate.');
    }
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify([
        'bulkUpdateContentWords',
        action,
        parentWorldId,
        parentRankId,
        parentGateId,
        canonicalItems,
        destination,
      ]),
      context.uid
    );
    const payload = {
      action,
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: parentGateId,
      items: canonicalItems,
      operationId: operationToken.operationId,
    };
    if (destination) {
      payload.targetWorldId = destination.worldId;
      payload.targetRankId = destination.rankId;
      payload.targetGateId = destination.gateId;
    }
    assertAdminContext(context);
    const response = await bulkUpdateContentWords(payload);
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/bulk-update-failed');
  }
}

async function bulkPublishWords(worldId, rankId, gateId, items, options) {
  requireOptions(options, new Set(['operationId']), 'Bulk publish options must be an object.', true);
  return bulkSetWordStatus(worldId, rankId, gateId, 'published', items);
}

async function bulkArchiveWords(worldId, rankId, gateId, items, options) {
  requireOptions(options, new Set(['operationId']), 'Bulk archive options must be an object.', true);
  return bulkSetWordStatus(worldId, rankId, gateId, 'archived', items);
}

async function bulkMoveWords(worldId, rankId, gateId, items, target, options) {
  const settings = requireOptions(
    options,
    new Set(['operationId']),
    'Bulk move options must be an object.',
    true
  );
  return bulkWordOperation(worldId, rankId, gateId, 'move', items, {
    ...settings,
    target,
  });
}

async function requestDeleteWord(worldId, rankId, gateId, contentWordId, options) {
  try {
    const context = await requireAdminContext();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const id = requireContentWordId(contentWordId);
    const settings = requireOptions(
      options,
      new Set(['confirmationWord', 'expectedVersion', 'operationId']),
      'Delete confirmation data is required.'
    );
    if (typeof settings.confirmationWord !== 'string' || !settings.confirmationWord) {
      throw adminCloudError('admin/invalid-argument', 'An exact confirmationWord is required.');
    }
    const version = requireExpectedVersion(settings.expectedVersion);
    const operationToken = resolveOperationToken(
      settings,
      JSON.stringify([
        'deleteContentWord',
        parentWorldId,
        parentRankId,
        parentGateId,
        id,
        version,
        settings.confirmationWord,
      ]),
      context.uid
    );
    assertAdminContext(context);
    const response = await deleteContentWord({
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: parentGateId,
      contentWordId: id,
      confirmationWord: settings.confirmationWord,
      expectedVersion: version,
      operationId: operationToken.operationId,
    });
    assertAdminContext(context);
    completeOperationToken(operationToken);
    return response.data;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/delete-failed');
  }
}

window.getLootLinguaAdminState = () => ({ ...adminState });
window.refreshLootLinguaAdminAccess = refreshAdminAccess;
window.ensureLootLinguaAdminAccess = ensureAdminAccess;
window.requireLootLinguaAdminAccess = requireAdminAccess;
window.LootLinguaAdminCloud = Object.freeze({
  listWorlds,
  getWorld,
  createWorld,
  updateWorld,
  setWorldStatus,
  requestDeleteWorld,
  listRanks,
  getRank,
  createRank,
  updateRank,
  setRankStatus,
  duplicateRankAsDraft,
  requestDeleteRank,
  listGates,
  getGate,
  createGate,
  updateGate,
  setGateStatus,
  duplicateGateAsDraft,
  moveGate,
  requestDeleteGate,
  listWords,
  getWord,
  inspectWordDuplicates,
  createWord,
  updateWord,
  setWordStatus,
  archiveWord,
  duplicateWord,
  moveWord,
  bulkWordOperation,
  bulkPublishWords,
  bulkArchiveWords,
  bulkMoveWords,
  requestDeleteWord,
});

window.addEventListener('lootlingua:auth-state', () => {
  refreshAdminAccess({ forceRefresh: true });
});

// The main Auth event may have fired before this deferred module evaluated.
queueMicrotask(() => refreshAdminAccess({ forceRefresh: true }));
