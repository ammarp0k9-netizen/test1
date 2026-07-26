import { getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  endBefore,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  limitToLast,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
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
const contentWordImportStaging = db ? collection(db, 'content_word_import_staging') : null;
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
  'cefrLevel',
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
const MAX_GATE_DRAFT_PUBLISH_BATCHES = 100;
const WORD_CURSOR_PREFIX = 'llw1_';
const STAGING_CURSOR_PREFIX = 'lls1_';
const STAGING_IMPORT_LIMIT = 100;
const WORD_SORTS = Object.freeze({
  newest: Object.freeze([
    Object.freeze({ field: 'createdAt', direction: 'desc' }),
  ]),
  oldest: Object.freeze([
    Object.freeze({ field: 'createdAt', direction: 'asc' }),
  ]),
  order: Object.freeze([
    Object.freeze({ field: 'order', direction: 'asc' }),
  ]),
  'word-asc': Object.freeze([
    Object.freeze({ field: 'normalizedWord', direction: 'asc' }),
  ]),
  'word-desc': Object.freeze([
    Object.freeze({ field: 'normalizedWord', direction: 'desc' }),
  ]),
  updated: Object.freeze([
    Object.freeze({ field: 'updatedAt', direction: 'desc' }),
  ]),
});
const STAGING_SORTS = Object.freeze({
  newest: Object.freeze([
    Object.freeze({ field: 'importedAt', direction: 'desc' }),
    Object.freeze({ field: 'importBatchId', direction: 'desc' }),
    Object.freeze({ field: 'sourceOrder', direction: 'asc' }),
  ]),
  oldest: Object.freeze([
    Object.freeze({ field: 'importedAt', direction: 'asc' }),
    Object.freeze({ field: 'importBatchId', direction: 'asc' }),
    Object.freeze({ field: 'sourceOrder', direction: 'asc' }),
  ]),
  'file-order': Object.freeze([
    Object.freeze({ field: 'sourceFileName', direction: 'asc' }),
    Object.freeze({ field: 'importBatchId', direction: 'asc' }),
    Object.freeze({ field: 'sourceOrder', direction: 'asc' }),
  ]),
  'word-asc': Object.freeze([
    Object.freeze({ field: 'normalizedWord', direction: 'asc' }),
  ]),
  'word-desc': Object.freeze([
    Object.freeze({ field: 'normalizedWord', direction: 'desc' }),
  ]),
});
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
  if (sourceCode === 'failed-precondition' || sourceCode === 'functions/failed-precondition') {
    const message = String(error?.message || '');
    const failedPrecondition = adminCloudError(
      /\bindex\b/i.test(message) ? 'admin/index-required' : 'admin/failed-precondition',
      message || 'The request requires a Firestore precondition that is not ready.',
      error?.details
    );
    failedPrecondition.sourceCode = sourceCode;
    return failedPrecondition;
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

function getWordListDataApi() {
  const api = window.LootLinguaWordListData;
  if (
    !api ||
    typeof api.normalizeQuery !== 'function' ||
    typeof api.createQuerySignature !== 'function'
  ) {
    throw adminCloudError(
      'admin/query-normalizer-unavailable',
      'The shared word-list query normalizer is unavailable.'
    );
  }
  return api;
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

function requireStagingWordId(value) {
  const stagingWordId = typeof value === 'string' ? value : '';
  if (
    !stagingWordId ||
    stagingWordId.length > 128 ||
    !/^staging_[a-f0-9]{64}$/.test(stagingWordId)
  ) {
    throw adminCloudError('admin/invalid-argument', 'A valid stagingWordId is required.');
  }
  return stagingWordId;
}

function requireImportBatchId(value) {
  const importBatchId = typeof value === 'string' ? value : '';
  if (
    !importBatchId ||
    importBatchId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(importBatchId)
  ) {
    throw adminCloudError('admin/invalid-argument', 'A valid importBatchId is required.');
  }
  return importBatchId;
}

function requireSourceFileName(value) {
  const sourceFileName = typeof value === 'string' ? value.trim() : '';
  if (!sourceFileName || sourceFileName.length > 240 || /[\u0000-\u001f\u007f]/.test(sourceFileName)) {
    throw adminCloudError('admin/invalid-argument', 'A valid sourceFileName is required.');
  }
  return sourceFileName;
}

function requireWordPageSize(value) {
  const pageSize = Number(value === undefined ? WORD_PAGE_SIZE_DEFAULT : value);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > WORD_PAGE_SIZE_MAX) {
    throw adminCloudError(
      'admin/invalid-argument',
      `pageSize must be an integer from 1 to ${WORD_PAGE_SIZE_MAX}.`
    );
  }
  return pageSize;
}

function requireWordListDirection(value) {
  if (value === undefined) return 'forward';
  if (value !== 'forward' && value !== 'backward') {
    throw adminCloudError('admin/invalid-argument', 'direction must be forward or backward.');
  }
  return value;
}

function requireListSort(value, definitions, fallback) {
  const sort = getWordListDataApi().normalizeQuery({
    sourceType: 'list-sort',
    sort: value,
  }).sort || fallback;
  if (!Object.prototype.hasOwnProperty.call(definitions, sort)) {
    throw adminCloudError('admin/invalid-argument', 'The requested list sort is invalid.');
  }
  return sort;
}

function requireListFilters(value, allowedFields) {
  const source = getWordListDataApi().normalizeQuery({
    sourceType: 'list-filters',
    filters: value,
  }).filters;
  requireOptions(source, allowedFields, 'List filters must be an object.', true);
  const output = {};
  Object.keys(source).forEach((field) => {
    const filterValue = source[field];
    if (
      typeof filterValue !== 'string' ||
      !filterValue.trim() ||
      filterValue.length > 240
    ) {
      throw adminCloudError('admin/invalid-argument', 'List filter values must be non-empty strings.');
    }
    output[field] = filterValue.trim();
  });
  if (Object.keys(output).length > 1) {
    throw adminCloudError(
      'admin/unsupported-filter-combination',
      'Use one server-side filter at a time to keep the index contract bounded.'
    );
  }
  return Object.freeze(output);
}

function requirePrefixSearch(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 200) {
    throw adminCloudError('admin/invalid-argument', 'Search text is invalid.');
  }
  return getContentSchema().normalizeWord(value);
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
  if (!value || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) {
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

function serializeCursorValue(value) {
  if (
    value &&
    typeof value === 'object' &&
    Number.isSafeInteger(value.seconds) &&
    Number.isSafeInteger(value.nanoseconds)
  ) {
    return { t: 'timestamp', s: value.seconds, n: value.nanoseconds };
  }
  if (typeof value === 'string') return { t: 'string', v: encodeURIComponent(value) };
  if (typeof value === 'number' && Number.isFinite(value)) return { t: 'number', v: value };
  throw adminCloudError('admin/corrupt-data', 'A paginated record has an invalid sort value.');
}

function deserializeCursorValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw adminCloudError('admin/invalid-argument', 'The page cursor contains invalid data.');
  }
  if (
    value.t === 'timestamp' &&
    Number.isSafeInteger(value.s) &&
    Number.isSafeInteger(value.n) &&
    value.n >= 0 &&
    value.n < 1000000000
  ) {
    return new Timestamp(value.s, value.n);
  }
  if (value.t === 'string' && typeof value.v === 'string' && value.v.length <= 3000) {
    try {
      const decoded = decodeURIComponent(value.v);
      if (decoded.length <= 500) return decoded;
    } catch {
      // Fall through to the canonical cursor error.
    }
  }
  if (value.t === 'number' && typeof value.v === 'number' && Number.isFinite(value.v)) {
    return value.v;
  }
  throw adminCloudError('admin/invalid-argument', 'The page cursor contains invalid data.');
}

function encodePageToken(prefix, scope, querySignature, sortFields, record, recordId) {
  return prefix + encodeBase64UrlAscii(JSON.stringify({
    v: 2,
    s: scope,
    q: querySignature,
    k: sortFields.map((item) => serializeCursorValue(record[item.field])),
    i: recordId,
  }));
}

function decodePageToken(token, prefix, scope, querySignature, sortFields, requireId) {
  if (typeof token !== 'string' || !token.startsWith(prefix)) {
    throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid.');
  }
  let cursor;
  try {
    cursor = JSON.parse(decodeBase64UrlAscii(token.slice(prefix.length)));
  } catch (error) {
    if (error?.code === 'admin/invalid-argument') throw error;
    throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid.');
  }
  const keys = cursor && typeof cursor === 'object' && !Array.isArray(cursor)
    ? Object.keys(cursor).sort()
    : [];
  if (
    keys.join(',') !== 'i,k,q,s,v' ||
    cursor.v !== 2 ||
    cursor.s !== scope ||
    cursor.q !== querySignature ||
    !Array.isArray(cursor.k) ||
    cursor.k.length !== sortFields.length
  ) {
    throw adminCloudError('admin/invalid-argument', 'The page cursor is invalid for this query.');
  }
  return Object.freeze([
    ...cursor.k.map(deserializeCursorValue),
    requireId(cursor.i),
  ]);
}

function encodeWordPageToken(worldId, rankId, gateId, querySignature, sortFields, word) {
  return encodePageToken(
    WORD_CURSOR_PREFIX,
    `${worldId}/${rankId}/${gateId}`,
    querySignature,
    sortFields,
    word,
    word.contentWordId
  );
}

function decodeWordPageToken(
  token,
  worldId,
  rankId,
  gateId,
  querySignature,
  sortFields
) {
  return decodePageToken(
    token,
    WORD_CURSOR_PREFIX,
    `${worldId}/${rankId}/${gateId}`,
    querySignature,
    sortFields,
    requireContentWordId
  );
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

async function deriveStagingWordId(normalizedWord, normalizationVersion) {
  const contentWordId = await deriveContentWordId(normalizedWord, normalizationVersion);
  return requireStagingWordId(contentWordId.replace(/^word_/, 'staging_'));
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
  return getContentSchema().comparePublishedRanks(left, right);
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

async function findGateWordDuplicate(
  context,
  worldId,
  rankId,
  gateId,
  normalizedWord,
  excludedContentWordId
) {
  const contentWordId = await deriveContentWordId(normalizedWord, 1);
  const snapshot = await getDoc(doc(
    wordsCollection(worldId, rankId, gateId),
    contentWordId
  ));
  assertAdminContext(context);
  const duplicateInGate = snapshot.exists() && contentWordId !== excludedContentWordId;
  const matched = duplicateInGate ? wordRecord(snapshot, worldId, rankId, gateId) : null;
  return Object.freeze({
    normalizedWord,
    duplicateInGate,
    duplicateInRank: false,
    duplicateInWorld: false,
    duplicateScopes: Object.freeze(duplicateInGate ? ['gate'] : []),
    matches: Object.freeze(matched ? [{
      worldId,
      rankId,
      gateId,
      contentWordId,
      status: matched.status,
    }] : []),
    hasMore: false,
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
    let publishedDraftWordCount = 0;
    if (status === 'published') {
      const parentWorldId = requireWorldId(worldId);
      const parentRankId = requireRankId(rankId);
      const id = requireGateId(gateId);
      const version = requireExpectedVersion(expectedVersion);
      const snapshot = await getDoc(doc(gatesCollection(parentWorldId, parentRankId), id));
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
      if (existing.status !== 'draft') {
        throw adminCloudError(
          'content/invalid-status-transition',
          'Only a draft gate can be published.'
        );
      }
      publishedDraftWordCount = await publishDraftWordsForGate(
        context,
        parentWorldId,
        parentRankId,
        id
      );
    }
    const result = await updateGate(worldId, rankId, gateId, { status }, expectedVersion);
    assertAdminContext(context);
    return status === 'published'
      ? { ...result, publishedDraftWordCount }
      : result;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/status-update-failed');
  }
}

async function publishDraftWordsForGate(context, worldId, rankId, gateId) {
  let publishedDraftWordCount = 0;
  for (let batchIndex = 0; batchIndex < MAX_GATE_DRAFT_PUBLISH_BATCHES; batchIndex += 1) {
    const snapshot = await getDocs(query(
      wordsCollection(worldId, rankId, gateId),
      where('status', '==', 'draft'),
      limit(BULK_WORD_LIMIT)
    ));
    assertAdminContext(context);
    if (!snapshot.docs.length) return publishedDraftWordCount;

    const draftWords = snapshot.docs.map((item) =>
      wordRecord(item, worldId, rankId, gateId)
    );
    draftWords.forEach((word) => assertStoredWord(
      word,
      worldId,
      rankId,
      gateId,
      word.contentWordId
    ));
    await bulkSetWordStatus(
      worldId,
      rankId,
      gateId,
      'published',
      draftWords.map((word) => ({
        contentWordId: word.contentWordId,
        expectedVersion: word.version,
      }))
    );
    assertAdminContext(context);
    publishedDraftWordCount += draftWords.length;
  }
  throw adminCloudError(
    'admin/publish-incomplete',
    'Gate draft publication exceeded the safe batch limit.',
    { publishedDraftWordCount }
  );
}

async function publishGateDraftWords(worldId, rankId, gateId) {
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
    const gate = snapshot.data() || {};
    assertStoredGate(gate, parentWorldId, parentRankId, id);
    if (gate.status !== 'published') {
      throw adminCloudError(
        'content/invalid-status-transition',
        'Draft-word repair is only available for a published gate.'
      );
    }
    const publishedDraftWordCount = await publishDraftWordsForGate(
      context,
      parentWorldId,
      parentRankId,
      id
    );
    assertAdminContext(context);
    return { publishedDraftWordCount };
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/bulk-update-failed');
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

function stagingWordRecord(snapshot) {
  return {
    ...(snapshot.data() || {}),
    stagingWordId: snapshot.id,
  };
}

function buildStagingEducationalFields(payload, uid) {
  const cleaned = buildWordCreateCandidate(
    payload,
    'staging-world',
    'staging-rank',
    'staging-gate',
    'staging-preview',
    uid
  );
  const output = {
    schemaVersion: cleaned.schemaVersion,
    normalizationVersion: cleaned.normalizationVersion,
    word: cleaned.word,
    normalizedWord: cleaned.normalizedWord,
    wordKey: cleaned.wordKey,
    translation: cleaned.translation,
    order: cleaned.order,
  };
  WORD_EDITABLE_FIELDS.forEach((field) => {
    if (field !== 'status' && Object.prototype.hasOwnProperty.call(cleaned, field)) {
      output[field] = cleaned[field];
    }
  });
  return output;
}

function stagingCreatePayload(record, metadata, uid) {
  return {
    ...record,
    stagingWordId: metadata.stagingWordId,
    importBatchId: metadata.importBatchId,
    sourceFileName: metadata.sourceFileName,
    sourceOrder: metadata.sourceOrder,
    stagingStatus: 'pending',
    importedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
  };
}

async function importStagingWords(entries, options) {
  try {
    const context = await requireAdminContext();
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > STAGING_IMPORT_LIMIT) {
      throw adminCloudError(
        'admin/invalid-argument',
        `A staging import requires from 1 to ${STAGING_IMPORT_LIMIT} words.`
      );
    }
    const settings = requireOptions(
      options,
      new Set(['importBatchId', 'sourceFileName']),
      'Staging import options must be an object.'
    );
    const importBatchId = settings.importBatchId
      ? requireImportBatchId(settings.importBatchId)
      : requireImportBatchId(`import_${generateOperationId()}`);
    const sourceFileName = requireSourceFileName(settings.sourceFileName);
    const prepared = [];
    const seen = new Set();
    for (let index = 0; index < entries.length; index += 1) {
      const source = requireOptions(
        entries[index],
        new Set(['payload', 'sourceOrder', 'index']),
        'Each staging import entry must contain a payload and sourceOrder.'
      );
      const sourceOrder = source.sourceOrder === undefined ? index : source.sourceOrder;
      if (!Number.isSafeInteger(sourceOrder) || sourceOrder < 0 || sourceOrder > 1000000) {
        throw adminCloudError('admin/invalid-argument', 'sourceOrder is invalid.');
      }
      const educational = buildStagingEducationalFields(source.payload, context.uid);
      if (seen.has(educational.normalizedWord)) {
        throw adminCloudError('import/duplicate-in-file', 'The import contains a duplicate word.');
      }
      seen.add(educational.normalizedWord);
      const stagingWordId = await deriveStagingWordId(
        educational.normalizedWord,
        educational.normalizationVersion
      );
      prepared.push({
        sourceIndex: Number.isSafeInteger(source.index) ? source.index : index,
        sourceOrder,
        educational,
        stagingWordId,
        reference: doc(contentWordImportStaging, stagingWordId),
      });
    }
    assertAdminContext(context);
    const result = await runTransaction(db, async (transaction) => {
      const snapshots = await Promise.all(prepared.map((item) =>
        transaction.get(item.reference)
      ));
      assertAdminContext(context);
      const results = prepared.map((item, index) => {
        const existing = snapshots[index];
        if (existing.exists()) {
          const duplicate = stagingWordRecord(existing);
          return {
            index: item.sourceIndex,
            stagingWordId: item.stagingWordId,
            state: 'duplicate-staging',
            importBatchId: duplicate.importBatchId || '',
            sourceFileName: duplicate.sourceFileName || '',
          };
        }
        transaction.set(item.reference, stagingCreatePayload(item.educational, {
          stagingWordId: item.stagingWordId,
          importBatchId,
          sourceFileName,
          sourceOrder: item.sourceOrder,
        }, context.uid));
        return {
          index: item.sourceIndex,
          stagingWordId: item.stagingWordId,
          state: 'staged',
          importBatchId,
          sourceFileName,
        };
      });
      return results;
    });
    assertAdminContext(context);
    return {
      importBatchId,
      sourceFileName,
      results: result,
      summary: {
        total: result.length,
        staged: result.filter((item) => item.state === 'staged').length,
        duplicates: result.filter((item) => item.state === 'duplicate-staging').length,
      },
    };
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/staging-import-failed');
  }
}

async function listStagingWords(options) {
  try {
    const context = await requireAdminContext();
    const listData = getWordListDataApi();
    const settings = requireOptions(
      options,
      new Set(['pageSize', 'pageToken', 'cursor', 'direction', 'sort', 'filters']),
      'Staging list options must be an object.',
      true
    );
    const normalizedQuery = listData.normalizeQuery({
      sourceType: 'admin-content-word-import-staging',
      sort: settings.sort,
      filters: settings.filters,
      pageSize: settings.pageSize === undefined ? WORD_PAGE_SIZE_DEFAULT : settings.pageSize,
    });
    const pageSize = requireWordPageSize(normalizedQuery.pageSize);
    const direction = requireWordListDirection(settings.direction);
    const sort = requireListSort(normalizedQuery.sort, STAGING_SORTS, 'newest');
    const filters = requireListFilters(
      normalizedQuery.filters,
      new Set(['level', 'partOfSpeech', 'sourceFileName', 'importBatchId'])
    );
    if (Object.keys(filters).length && sort !== 'newest') {
      throw adminCloudError(
        'admin/unsupported-sort-combination',
        'Filtered staging lists use newest-first sorting.'
      );
    }
    if (
      settings.pageToken !== undefined &&
      settings.cursor !== undefined &&
      settings.pageToken !== settings.cursor
    ) {
      throw adminCloudError('admin/invalid-argument', 'pageToken and cursor must match.');
    }
    const pageToken = settings.pageToken ?? settings.cursor ?? '';
    const sortFields = STAGING_SORTS[sort];
    const querySignature = listData.createQuerySignature({
      ...normalizedQuery,
      sort,
      filters,
      pageSize,
    });
    const constraints = [];
    Object.entries(filters).forEach(([field, value]) => {
      constraints.push(where(field, '==', value));
    });
    sortFields.forEach((item) => constraints.push(orderBy(item.field, item.direction)));
    const documentDirection = sortFields[sortFields.length - 1].direction;
    constraints.push(orderBy(documentId(), documentDirection));
    if (pageToken) {
      const values = decodePageToken(
        pageToken,
        STAGING_CURSOR_PREFIX,
        'content_word_import_staging',
        querySignature,
        sortFields,
        requireStagingWordId
      );
      constraints.push(direction === 'backward'
        ? endBefore(...values)
        : startAfter(...values));
    }
    constraints.push(direction === 'backward' ? limitToLast(pageSize + 1) : limit(pageSize + 1));
    const snapshot = await getDocs(query(contentWordImportStaging, ...constraints));
    assertAdminContext(context);
    const hasPrevious = direction === 'backward'
      ? snapshot.docs.length > pageSize
      : Boolean(pageToken);
    const hasNext = direction === 'backward' ? true : snapshot.docs.length > pageSize;
    const pageDocs = direction === 'backward' && hasPrevious
      ? snapshot.docs.slice(1)
      : snapshot.docs.slice(0, pageSize);
    const items = pageDocs.map(stagingWordRecord);
    const encode = (item) => encodePageToken(
      STAGING_CURSOR_PREFIX,
      'content_word_import_staging',
      querySignature,
      sortFields,
      item,
      item.stagingWordId
    );
    const startCursor = items.length ? encode(items[0]) : null;
    const endCursor = items.length ? encode(items[items.length - 1]) : null;
    const beforeCursor = direction === 'backward'
      ? (hasPrevious ? encode(stagingWordRecord(snapshot.docs[0])) : null)
      : (pageToken || null);
    return {
      items,
      pageSize,
      direction,
      sort,
      filters,
      querySignature,
      hasMore: hasNext,
      hasNext,
      hasPrevious,
      beforeCursor,
      firstCursor: startCursor,
      startCursor,
      endCursor,
      nextCursor: hasNext ? endCursor : null,
      nextPageToken: hasNext ? endCursor : null,
    };
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/staging-list-failed');
  }
}

async function countStagingWords() {
  try {
    const context = await requireAdminContext();
    const snapshot = await getCountFromServer(contentWordImportStaging);
    assertAdminContext(context);
    return Number(snapshot.data().count) || 0;
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/staging-count-failed');
  }
}

async function getStagingWord(stagingWordId) {
  try {
    const context = await requireAdminContext();
    const id = requireStagingWordId(stagingWordId);
    const snapshot = await getDoc(doc(contentWordImportStaging, id));
    assertAdminContext(context);
    if (!snapshot.exists()) {
      throw adminCloudError('admin/not-found', 'Staging word not found.');
    }
    return stagingWordRecord(snapshot);
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/staging-read-failed');
  }
}

async function deleteStagingWords(stagingWordIds) {
  try {
    const context = await requireAdminContext();
    if (
      !Array.isArray(stagingWordIds) ||
      stagingWordIds.length < 1 ||
      stagingWordIds.length > BULK_WORD_LIMIT
    ) {
      throw adminCloudError('admin/invalid-argument', 'Select from 1 to 100 staging words.');
    }
    const ids = Array.from(new Set(stagingWordIds.map(requireStagingWordId)));
    if (ids.length !== stagingWordIds.length) {
      throw adminCloudError('admin/invalid-argument', 'Staging word IDs must be unique.');
    }
    const references = ids.map((id) => doc(contentWordImportStaging, id));
    const deleted = await runTransaction(db, async (transaction) => {
      const snapshots = await Promise.all(references.map((reference) =>
        transaction.get(reference)
      ));
      assertAdminContext(context);
      let count = 0;
      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) return;
        transaction.delete(references[index]);
        count += 1;
      });
      return count;
    });
    assertAdminContext(context);
    return { requested: ids.length, deleted };
  } catch (error) {
    throw mapAdminCloudError(error, 'admin/staging-delete-failed');
  }
}

function stagingDistributionPayload(staging) {
  const payload = {};
  WORD_EDITABLE_FIELDS.forEach((field) => {
    if (field !== 'status' && Object.prototype.hasOwnProperty.call(staging, field)) {
      payload[field] = staging[field];
    }
  });
  payload.schemaVersion = staging.schemaVersion;
  payload.normalizationVersion = staging.normalizationVersion;
  payload.status = 'draft';
  return payload;
}

async function distributeStagingWords(stagingWordIds, target, options) {
  const context = await requireAdminContext();
  const destination = requireWordTarget(target);
  const settings = requireOptions(
    options,
    new Set(['onProgress']),
    'Distribution options must be an object.',
    true
  );
  if (
    !Array.isArray(stagingWordIds) ||
    stagingWordIds.length < 1 ||
    stagingWordIds.length > BULK_WORD_LIMIT
  ) {
    throw adminCloudError('admin/invalid-argument', 'Select from 1 to 100 staging words.');
  }
  const ids = Array.from(new Set(stagingWordIds.map(requireStagingWordId)));
  if (ids.length !== stagingWordIds.length) {
    throw adminCloudError('admin/invalid-argument', 'Staging word IDs must be unique.');
  }
  const operationId = generateOperationId();
  const results = [];
  for (let index = 0; index < ids.length; index += 1) {
    const stagingWordId = ids[index];
    const reference = doc(contentWordImportStaging, stagingWordId);
    let result;
    try {
      const snapshot = await getDoc(reference);
      assertAdminContext(context);
      if (!snapshot.exists()) {
        result = { stagingWordId, state: 'missing' };
      } else {
        const staging = stagingWordRecord(snapshot);
        const previousTarget = staging.distributionTarget || {};
        const sameTarget =
          previousTarget.worldId === destination.worldId &&
          previousTarget.rankId === destination.rankId &&
          previousTarget.gateId === destination.gateId;
        let recoveredContentWordId = '';
        if (staging.stagingStatus === 'distributing' && sameTarget) {
          const targetContentWordId = await deriveContentWordId(
            staging.normalizedWord,
            staging.normalizationVersion
          );
          const targetDocument = await getDoc(doc(
            wordsCollection(destination.worldId, destination.rankId, destination.gateId),
            targetContentWordId
          ));
          assertAdminContext(context);
          if (
            targetDocument.exists() &&
            targetDocument.data().normalizedWord === staging.normalizedWord
          ) {
            recoveredContentWordId = targetContentWordId;
            await updateDoc(reference, {
              stagingStatus: 'distributed',
              distributionTarget: destination,
              distributionOperationId: operationId,
              distributedContentWordId: targetContentWordId,
              distributedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              updatedBy: context.uid,
            });
          }
        }
        if (
          (staging.stagingStatus === 'distributed' && sameTarget) ||
          recoveredContentWordId
        ) {
          await deleteDoc(reference);
          result = {
            stagingWordId,
            state: 'recovered',
            contentWordId: recoveredContentWordId || staging.distributedContentWordId || '',
          };
        } else {
          await updateDoc(reference, {
            stagingStatus: 'distributing',
            distributionTarget: destination,
            distributionOperationId: operationId,
            updatedAt: serverTimestamp(),
            updatedBy: context.uid,
          });
          let created;
          try {
            created = await createWord(
              destination.worldId,
              destination.rankId,
              destination.gateId,
              stagingDistributionPayload(staging)
            );
          } catch (error) {
            await updateDoc(reference, {
              stagingStatus: 'pending',
              updatedAt: serverTimestamp(),
              updatedBy: context.uid,
            }).catch(() => {});
            if (error?.code === 'content/duplicate-word-in-gate') {
              result = { stagingWordId, state: 'duplicate-gate' };
            } else {
              throw error;
            }
          }
          if (created) {
            await updateDoc(reference, {
              stagingStatus: 'distributed',
              distributionTarget: destination,
              distributionOperationId: operationId,
              distributedContentWordId: created.contentWordId,
              distributedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              updatedBy: context.uid,
            });
            try {
              await deleteDoc(reference);
              result = {
                stagingWordId,
                state: 'distributed',
                contentWordId: created.contentWordId,
              };
            } catch {
              result = {
                stagingWordId,
                state: 'distributed-pending-cleanup',
                contentWordId: created.contentWordId,
              };
            }
          }
        }
      }
    } catch (error) {
      result = {
        stagingWordId,
        state: 'failed',
        code: String(error?.code || 'admin/staging-distribution-failed'),
      };
    }
    results.push(result);
    if (typeof settings.onProgress === 'function') {
      settings.onProgress({
        completed: index + 1,
        total: ids.length,
        distributed: results.filter((item) =>
          item.state === 'distributed' || item.state === 'recovered'
        ).length,
        duplicates: results.filter((item) => item.state === 'duplicate-gate').length,
        failed: results.filter((item) =>
          item.state === 'failed' || item.state === 'distributed-pending-cleanup'
        ).length,
      });
    }
  }
  assertAdminContext(context);
  return {
    operationId,
    target: destination,
    results,
    summary: {
      total: results.length,
      distributed: results.filter((item) =>
        item.state === 'distributed' || item.state === 'recovered'
      ).length,
      duplicates: results.filter((item) => item.state === 'duplicate-gate').length,
      failed: results.filter((item) =>
        item.state === 'failed' || item.state === 'distributed-pending-cleanup'
      ).length,
      remaining: results.filter((item) =>
        item.state !== 'distributed' && item.state !== 'recovered' && item.state !== 'missing'
      ).length,
    },
  };
}

async function listWords(worldId, rankId, gateId, options) {
  try {
    const context = await requireAdminContext();
    const listData = getWordListDataApi();
    const parentWorldId = requireWorldId(worldId);
    const parentRankId = requireRankId(rankId);
    const parentGateId = requireGateId(gateId);
    const settings = requireOptions(
      options,
      new Set(['pageSize', 'pageToken', 'cursor', 'direction', 'sort', 'filters', 'search']),
      'Word list options must be an object.',
      true
    );
    const normalizedQuery = listData.normalizeQuery({
      sourceType: 'admin-content-words',
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: parentGateId,
      sort: settings.sort,
      filters: settings.filters,
      search: settings.search,
      pageSize: settings.pageSize === undefined ? WORD_PAGE_SIZE_DEFAULT : settings.pageSize,
    });
    const pageSize = requireWordPageSize(normalizedQuery.pageSize);
    const direction = requireWordListDirection(settings.direction);
    const filters = requireListFilters(
      normalizedQuery.filters,
      new Set(['status', 'level', 'partOfSpeech', 'category'])
    );
    const search = requirePrefixSearch(normalizedQuery.search);
    if (search && Object.keys(filters).length) {
      throw adminCloudError(
        'admin/unsupported-filter-combination',
        'Prefix search cannot be combined with another filter.'
      );
    }
    const sort = requireListSort(normalizedQuery.sort, WORD_SORTS, 'newest');
    if (search && sort !== 'word-asc') {
      throw adminCloudError(
        'admin/unsupported-sort-combination',
        'Prefix search requires alphabetical sorting.'
      );
    }
    if (Object.keys(filters).length && sort !== 'newest') {
      throw adminCloudError(
        'admin/unsupported-sort-combination',
        'Filtered word lists use newest-first sorting.'
      );
    }
    const sortFields = WORD_SORTS[sort];
    const querySignature = listData.createQuerySignature({
      ...normalizedQuery,
      sort,
      filters,
      search,
      pageSize,
    });
    if (
      settings.pageToken !== undefined &&
      settings.cursor !== undefined &&
      settings.pageToken !== settings.cursor
    ) {
      throw adminCloudError('admin/invalid-argument', 'pageToken and cursor must match.');
    }
    const pageToken = settings.pageToken ?? settings.cursor ?? '';
    const constraints = [];
    Object.entries(filters).forEach(([field, value]) => {
      constraints.push(where(field, '==', value));
    });
    if (search) {
      constraints.push(where('normalizedWord', '>=', search));
      constraints.push(where('normalizedWord', '<=', `${search}\uf8ff`));
    }
    sortFields.forEach((item) => constraints.push(orderBy(item.field, item.direction)));
    const documentDirection = sortFields[sortFields.length - 1].direction;
    constraints.push(orderBy(documentId(), documentDirection));
    if (pageToken) {
      const cursorValues = decodeWordPageToken(
        pageToken,
        parentWorldId,
        parentRankId,
        parentGateId,
        querySignature,
        sortFields
      );
      if (direction === 'backward') {
        constraints.push(endBefore(...cursorValues));
      } else {
        constraints.push(startAfter(...cursorValues));
      }
    }
    constraints.push(direction === 'backward' ? limitToLast(pageSize + 1) : limit(pageSize + 1));
    const snapshot = await getDocs(query(
      wordsCollection(parentWorldId, parentRankId, parentGateId),
      ...constraints
    ));
    assertAdminContext(context);
    const hasPrevious = direction === 'backward'
      ? snapshot.docs.length > pageSize
      : Boolean(pageToken);
    const hasNext = direction === 'backward'
      ? true
      : snapshot.docs.length > pageSize;
    const pageDocs = direction === 'backward' && hasPrevious
      ? snapshot.docs.slice(1)
      : snapshot.docs.slice(0, pageSize);
    const items = pageDocs.map((item) =>
      wordRecord(item, parentWorldId, parentRankId, parentGateId)
    );
    items.forEach((item) => assertStoredWord(
      item,
      parentWorldId,
      parentRankId,
      parentGateId,
      item.contentWordId
    ));
    const firstCursor = items.length
      ? encodeWordPageToken(
        parentWorldId,
        parentRankId,
        parentGateId,
        querySignature,
        sortFields,
        items[0]
      )
      : null;
    const endCursor = items.length
      ? encodeWordPageToken(
        parentWorldId,
        parentRankId,
        parentGateId,
        querySignature,
        sortFields,
        items[items.length - 1]
      )
      : null;
    const beforeCursor = direction === 'backward'
      ? (hasPrevious
        ? encodeWordPageToken(
          parentWorldId,
          parentRankId,
          parentGateId,
          querySignature,
          sortFields,
          wordRecord(snapshot.docs[0], parentWorldId, parentRankId, parentGateId)
        )
        : null)
      : (pageToken || null);
    return {
      items,
      pageSize,
      direction,
      sort,
      filters,
      search,
      querySignature,
      hasMore: hasNext,
      hasNext,
      hasPrevious,
      beforeCursor,
      firstCursor,
      startCursor: firstCursor,
      endCursor,
      nextPageToken: hasNext ? endCursor : null,
      nextCursor: hasNext ? endCursor : null,
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
    return await findGateWordDuplicate(
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
    return savedWord;
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
  publishGateDraftWords,
  duplicateGateAsDraft,
  moveGate,
  requestDeleteGate,
  importStagingWords,
  listStagingWords,
  countStagingWords,
  getStagingWord,
  deleteStagingWords,
  distributeStagingWords,
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
