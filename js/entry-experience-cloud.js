import { getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  Timestamp,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const app = getApps()[0];
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

function contract() {
  const api = window.LootLinguaEntryExperience;
  if (!api) throw entryError('entry/contract-unavailable', 'Entry Experience contract is unavailable.');
  return api;
}

function entryError(code, message, cause, diagnostic) {
  const error = new Error(message || code);
  error.code = code;
  if (cause) error.cause = cause;
  if (diagnostic) error.diagnostic = diagnostic;
  return error;
}

function firebaseErrorCode(error) {
  const code = String(error?.code || error?.name || 'unknown').trim();
  return code || 'unknown';
}

function entryDocumentPath(version = contract().EXPERIENCE_VERSION) {
  return `users/{account}/entryExperiences/v${version}`;
}

const ENTRY_V2_FIELDS = Object.freeze([
  'contractVersion', 'experienceVersion', 'status', 'audience',
  'classification', 'currentStep', 'interestsStatus', 'interestIds',
  'themeStatus', 'themeId', 'oasisMode', 'themeExplicit',
  'journeyStatus', 'selectedWorldId', 'gamerStatus', 'source',
  'startedAt', 'updatedAt', 'completedAt', 'skippedAt',
]);

const ENTRY_DIAGNOSTIC_ENUM_FIELDS = Object.freeze([
  'contractVersion', 'experienceVersion', 'status', 'audience',
  'classification', 'currentStep', 'interestsStatus', 'themeStatus',
  'themeId', 'oasisMode', 'themeExplicit', 'journeyStatus',
  'gamerStatus', 'source',
]);

function entryContractDiagnosticsEnabled() {
  const hostname = String(window.location?.hostname || '').toLowerCase();
  return window.__LOOTLINGUA_ENTRY_CONTRACT_DIAGNOSTICS__ === true ||
    hostname === 'localhost' || hostname === '127.0.0.1';
}

function safeValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value && typeof value.toMillis === 'function') return 'timestamp';
  if (value instanceof Date) return 'timestamp';
  if (value && typeof value === 'object') return 'map';
  return typeof value;
}

function safeDocumentShape(data) {
  if (!data || typeof data !== 'object') return null;
  const fields = Object.keys(data).sort();
  const fieldTypes = Object.fromEntries(fields.map((field) => [field, safeValueType(data[field])]));
  const enumValues = Object.fromEntries(ENTRY_DIAGNOSTIC_ENUM_FIELDS
    .filter((field) => Object.hasOwn(data, field))
    .map((field) => [field, data[field]]));
  return Object.freeze({ fields, fieldTypes, enumValues });
}

function safeTimestampEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (typeof left.isEqual === 'function') return left.isEqual(right);
  const leftMillis = contract().timestampMillis(left);
  const rightMillis = contract().timestampMillis(right);
  return leftMillis > 0 && leftMillis === rightMillis;
}

function safeEntryWriteContract(snapshot, payload) {
  const exists = snapshot?.exists?.() === true;
  const before = exists ? (snapshot.data() || {}) : null;
  const payloadFields = Object.keys(payload).sort();
  const allowed = new Set(ENTRY_V2_FIELDS);
  const currentStatus = String(before?.status || '');
  const nextStatus = String(payload?.status || '');
  const statusTransitionAllowed = !exists ||
    (currentStatus === 'in-progress' && ['in-progress', 'completed'].includes(nextStatus)) ||
    (currentStatus === 'completed' && nextStatus === 'completed');
  return Object.freeze({
    documentExists: exists,
    writeMode: exists ? 'update' : 'create',
    documentPath: entryDocumentPath(),
    pathDerivedFromAuthenticatedUser: true,
    attempted: safeDocumentShape(payload),
    existing: safeDocumentShape(before),
    checks: Object.freeze({
      payloadHasOnlyAllowedFields: payloadFields.every((field) => allowed.has(field)),
      payloadHasExactFieldCount: payloadFields.length === ENTRY_V2_FIELDS.length,
      currentVersion: payload.contractVersion === 2 && payload.experienceVersion === 2,
      completionShape: payload.status !== 'completed' || (
        payload.currentStep === 'destination' &&
        ['structure-explored', 'return-reviewed'].includes(payload.journeyStatus) &&
        safeValueType(payload.completedAt) === 'timestamp'
      ),
      statusTransitionAllowed,
      immutableFieldsPreserved: exists ? Object.freeze({
        contractVersion: payload.contractVersion === before.contractVersion,
        experienceVersion: payload.experienceVersion === before.experienceVersion,
        audience: payload.audience === before.audience,
        classification: payload.classification === before.classification,
        startedAt: safeTimestampEqual(payload.startedAt, before.startedAt),
        completedAt: before.completedAt == null ||
          safeTimestampEqual(payload.completedAt, before.completedAt),
      }) : null,
    }),
  });
}

function reportEntryWriteContract(contractShape) {
  if (!contractShape || !entryContractDiagnosticsEnabled()) return;
  console.info('[LootLingua Entry write contract]', contractShape);
  window.dispatchEvent(new CustomEvent('lootlingua:entry-write-contract', {
    detail: contractShape,
  }));
}

function entryFailureDiagnostic(operation, phase, error, contractShape) {
  return Object.freeze({
    operation: String(operation || 'entry-state-write'),
    phase: String(phase || 'unknown'),
    documentPath: entryDocumentPath(),
    firebaseCode: firebaseErrorCode(error),
    ...(entryContractDiagnosticsEnabled() && contractShape
      ? { contractShape }
      : {}),
  });
}

function reportEntryFailure(operation, phase, error, contractShape) {
  const diagnostic = entryFailureDiagnostic(operation, phase, error, contractShape);
  console.error('[LootLingua Entry persistence]', diagnostic);
  window.dispatchEvent(new CustomEvent('lootlingua:entry-persistence-error', {
    detail: diagnostic,
  }));
  return diagnostic;
}

function requireUser(expectedUser) {
  const user = auth?.currentUser;
  if (!user || (expectedUser?.uid && expectedUser.uid !== user.uid)) {
    throw entryError('entry/auth-changed', 'Authentication changed while loading Entry Experience.');
  }
  return user;
}

function entryRef(uid, version = contract().EXPERIENCE_VERSION) {
  return doc(db, 'users', uid, 'entryExperiences', `v${version}`);
}

function timestampOrNull(value) {
  const millis = contract().timestampMillis(value);
  return millis ? Timestamp.fromMillis(millis) : null;
}

function cloudPayload(state) {
  const normalized = contract().normalizeEntryState(state);
  if (!normalized) throw entryError('entry/invalid-state', 'Entry Experience state is invalid.');
  return {
    contractVersion: normalized.contractVersion,
    experienceVersion: normalized.experienceVersion,
    status: normalized.status,
    audience: normalized.audience,
    classification: normalized.classification,
    currentStep: normalized.currentStep,
    interestsStatus: normalized.interestsStatus,
    interestIds: normalized.interestIds,
    themeStatus: normalized.themeStatus,
    themeId: normalized.themeId,
    oasisMode: normalized.oasisMode,
    themeExplicit: normalized.themeExplicit,
    journeyStatus: normalized.journeyStatus,
    selectedWorldId: normalized.selectedWorldId,
    gamerStatus: normalized.gamerStatus,
    source: normalized.source,
    startedAt: timestampOrNull(normalized.startedAt) || serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: normalized.status === 'completed'
      ? (timestampOrNull(normalized.completedAt) || serverTimestamp())
      : null,
    skippedAt: normalized.status === 'skipped'
      ? (timestampOrNull(normalized.skippedAt) || serverTimestamp())
      : null,
  };
}

async function load(user) {
  if (!db) throw entryError('entry/storage-unavailable', 'Entry Experience storage is unavailable.');
  const current = requireUser(user);
  try {
    const snapshot = await getDoc(entryRef(current.uid));
    requireUser(current);
    if (!snapshot.exists()) return { exists: false, state: null };
    const state = contract().normalizeEntryState(snapshot.data());
    return { exists: true, state };
  } catch (error) {
    if (error?.code === 'entry/auth-changed') throw error;
    throw entryError('entry/read-failed', 'Could not read Entry Experience.', error);
  }
}

async function loadLegacyPreferences(user) {
  if (!db) throw entryError('entry/storage-unavailable', 'Entry Experience storage is unavailable.');
  const current = requireUser(user);
  try {
    const snapshot = await getDoc(entryRef(current.uid, 1));
    requireUser(current);
    if (!snapshot.exists()) return { exists: false, preferences: null };
    return {
      exists: true,
      preferences: contract().normalizeLegacyPreferences(snapshot.data()),
    };
  } catch (error) {
    if (error?.code === 'entry/auth-changed') throw error;
    throw entryError('entry/read-failed', 'Could not read legacy Entry preferences.', error);
  }
}

function verifySavedState(expected, snapshot) {
  if (!snapshot.exists()) {
    throw entryError(
      'entry/verification-missing',
      'Entry Experience write was acknowledged but the document could not be read back.'
    );
  }
  const observed = contract().normalizeEntryState(snapshot.data());
  if (!observed) {
    throw entryError(
      'entry/verification-invalid',
      'Entry Experience write was acknowledged but the stored state is invalid.'
    );
  }
  const fields = [
    'contractVersion', 'experienceVersion', 'status', 'currentStep',
    'journeyStatus', 'audience', 'classification',
  ];
  const mismatch = fields.find((field) => observed[field] !== expected[field]);
  if (mismatch || (
    expected.status === 'completed' && !contract().isTerminalState(observed)
  )) {
    throw entryError(
      'entry/verification-mismatch',
      'Entry Experience write was acknowledged but its completion proof did not round-trip.'
    );
  }
  return observed;
}

async function save(state, user, options) {
  const operation = String(options?.operation || 'entry-state-write');
  let phase = 'storage-readiness';
  let contractShape = null;
  try {
    if (!db) {
      throw entryError('entry/storage-unavailable', 'Entry Experience storage is unavailable.');
    }
    phase = 'auth-readiness';
    const current = requireUser(user);
    phase = 'local-validation';
    const normalized = contract().normalizeEntryState(state);
    if (!normalized) {
      throw entryError('entry/invalid-state', 'Entry Experience state is invalid.');
    }
    const payload = cloudPayload(normalized);
    const reference = entryRef(current.uid);
    if (entryContractDiagnosticsEnabled()) {
      try {
        phase = 'diagnostic-read';
        const existingSnapshot = await getDoc(reference);
        phase = 'auth-readiness';
        requireUser(current);
        contractShape = safeEntryWriteContract(existingSnapshot, payload);
        reportEntryWriteContract(contractShape);
      } catch (diagnosticReadError) {
        if (diagnosticReadError?.code === 'entry/auth-changed') throw diagnosticReadError;
        console.warn('[LootLingua Entry write contract unavailable]', Object.freeze({
          operation,
          phase: 'diagnostic-read',
          documentPath: entryDocumentPath(),
          firebaseCode: firebaseErrorCode(diagnosticReadError),
        }));
      }
    }
    phase = 'firestore-write';
    await setDoc(reference, payload);
    phase = 'auth-readiness';
    requireUser(current);
    if (options?.verify === true) {
      phase = 'post-write-verification';
      const snapshot = await getDoc(reference);
      phase = 'auth-readiness';
      requireUser(current);
      phase = 'post-write-verification';
      return verifySavedState(normalized, snapshot);
    }
    return contract().normalizeEntryState({ ...normalized, updatedAt: Date.now() });
  } catch (error) {
    const diagnostic = reportEntryFailure(operation, phase, error, contractShape);
    if (['entry/auth-required', 'entry/auth-changed', 'entry/storage-unavailable'].includes(error?.code)) {
      error.diagnostic = diagnostic;
      throw error;
    }
    const code = phase === 'local-validation'
      ? 'entry/validation-failed'
      : (phase === 'post-write-verification'
        ? 'entry/verification-failed'
        : 'entry/write-failed');
    throw entryError(code, 'Could not save Entry Experience.', error, diagnostic);
  }
}

const API = Object.freeze({ load, loadLegacyPreferences, save });

Object.defineProperty(window, 'LootLinguaEntryExperienceCloud', {
  value: API,
  configurable: false,
  enumerable: true,
  writable: false,
});

window.dispatchEvent(new CustomEvent('lootlingua:entry-cloud-ready'));
