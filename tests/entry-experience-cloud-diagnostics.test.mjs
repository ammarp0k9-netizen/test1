import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [contractSource, cloudModuleSource] = await Promise.all([
  readFile(new URL('../js/entry-experience-contract.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/entry-experience-cloud.js', import.meta.url), 'utf8'),
]);

function timestamp(millis) {
  return Object.freeze({
    toMillis: () => Number(millis),
    toDate: () => new Date(Number(millis)),
  });
}

function completedEntryState(overrides = {}) {
  return {
    contractVersion: 2,
    experienceVersion: 2,
    status: 'completed',
    audience: 'returning',
    classification: 'returning-with-progress',
    currentStep: 'destination',
    interestsStatus: 'selected',
    interestIds: ['study'],
    themeStatus: 'preserved',
    themeId: 'lootlingua',
    oasisMode: 'light',
    themeExplicit: false,
    journeyStatus: 'return-reviewed',
    selectedWorldId: '',
    gamerStatus: 'not-applicable',
    source: 'app-entry',
    startedAt: 1000,
    updatedAt: 2000,
    completedAt: 3000,
    skippedAt: 0,
    ...overrides,
  };
}

function createHarness(options = {}) {
  const auth = { currentUser: { uid: 'entry-cloud-user' } };
  const values = new Map();
  const diagnostics = [];
  const logs = [];
  const controls = {
    writeError: null,
    hideReadback: false,
  };
  const db = { path: '' };
  const doc = (_db, ...parts) => ({ path: parts.map(String).join('/') });
  const snapshot = (reference) => ({
    exists: () => !controls.hideReadback && values.has(reference.path),
    data: () => values.get(reference.path),
  });
  const root = {
    __LOOTLINGUA_ENTRY_CONTRACT_DIAGNOSTICS__: options.contractDiagnostics === true,
    __firebase: {
      Timestamp: { fromMillis: timestamp },
      doc,
      getApps: () => [{}],
      getAuth: () => auth,
      getFirestore: () => db,
      getDoc: async (reference) => snapshot(reference),
      serverTimestamp: () => timestamp(9000),
      setDoc: async (reference, data) => {
        if (controls.writeError) throw controls.writeError;
        values.set(reference.path, data);
      },
    },
    dispatchEvent(event) {
      if (event.type === 'lootlingua:entry-persistence-error') {
        diagnostics.push(event.detail);
      }
      return true;
    },
  };
  const TestCustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };
  const testConsole = {
    ...console,
    error(...args) { logs.push(args); },
    info(...args) { logs.push(args); },
    warn(...args) { logs.push(args); },
  };
  new Function('window', 'globalThis', contractSource)(root, root);
  const executableCloudSource = [
    'const { Timestamp, doc, getApps, getAuth, getDoc, getFirestore, serverTimestamp, setDoc } = window.__firebase;',
    cloudModuleSource.slice(cloudModuleSource.indexOf('const app =')),
  ].join('\n');
  new Function('window', 'globalThis', 'CustomEvent', 'console', executableCloudSource)(
    root,
    root,
    TestCustomEvent,
    testConsole
  );
  if (options.existingDocument) {
    values.set('users/entry-cloud-user/entryExperiences/v2', options.existingDocument);
  }
  return {
    api: root.LootLinguaEntryExperienceCloud,
    auth,
    controls,
    diagnostics,
    logs,
    values,
    save(state, options) {
      return root.LootLinguaEntryExperienceCloud.save(
        state,
        auth.currentUser,
        options
      );
    },
  };
}

test('completed-user Product Entry payload writes and verifies through the real cloud adapter contract', async () => {
  const harness = createHarness();
  const result = await harness.save(
    completedEntryState(),
    { operation: 'entry-completion', verify: true }
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.currentStep, 'destination');
  assert.equal(result.journeyStatus, 'return-reviewed');
  assert.equal(harness.diagnostics.length, 0);
  const stored = harness.values.get('users/entry-cloud-user/entryExperiences/v2');
  assert.deepEqual(Object.keys(stored).sort(), [
    'audience', 'classification', 'completedAt', 'contractVersion', 'currentStep',
    'experienceVersion', 'gamerStatus', 'interestIds', 'interestsStatus',
    'journeyStatus', 'oasisMode', 'selectedWorldId', 'skippedAt', 'source',
    'startedAt', 'status', 'themeExplicit', 'themeId', 'themeStatus', 'updatedAt',
  ].sort());
});

test('Firestore rejection retains its safe code, operation, phase, and redacted document path', async () => {
  const harness = createHarness();
  const failure = new Error('sensitive backend detail');
  failure.code = 'permission-denied';
  harness.controls.writeError = failure;

  await assert.rejects(
    harness.save(
      completedEntryState(),
      { operation: 'entry-completion', verify: true }
    ),
    (error) => {
      assert.equal(error.code, 'entry/write-failed');
      assert.equal(error.diagnostic.operation, 'entry-completion');
      assert.equal(error.diagnostic.phase, 'firestore-write');
      assert.equal(error.diagnostic.documentPath, 'users/{account}/entryExperiences/v2');
      assert.equal(error.diagnostic.firebaseCode, 'permission-denied');
      assert.equal(error.message.includes('sensitive backend detail'), false);
      return true;
    }
  );
  assert.equal(harness.diagnostics.length, 1);
  assert.equal(JSON.stringify(harness.logs).includes('entry-cloud-user'), false);
  assert.equal(JSON.stringify(harness.logs).includes('sensitive backend detail'), false);
});

test('local validation and post-write verification failures are classified separately', async () => {
  const invalid = createHarness();
  await assert.rejects(
    invalid.save(null, {
      operation: 'entry-completion', verify: true,
    }),
    (error) => error.code === 'entry/validation-failed' &&
      error.diagnostic?.phase === 'local-validation'
  );

  const missing = createHarness();
  missing.controls.hideReadback = true;
  await assert.rejects(
    missing.save(completedEntryState(), {
      operation: 'entry-completion', verify: true,
    }),
    (error) => error.code === 'entry/verification-failed' &&
      error.diagnostic?.phase === 'post-write-verification' &&
      error.diagnostic?.firebaseCode === 'entry/verification-missing'
  );
});

test('auth readiness failures are diagnostic without exposing the account identifier', async () => {
  const harness = createHarness();
  harness.auth.currentUser = null;
  await assert.rejects(
    harness.save(completedEntryState(), {
      operation: 'entry-completion', verify: true,
    }),
    (error) => error.code === 'entry/auth-changed' &&
      error.diagnostic?.phase === 'auth-readiness' &&
      error.diagnostic?.firebaseCode === 'entry/auth-changed'
  );
  assert.equal(JSON.stringify(harness.logs).includes('entry-cloud-user'), false);
});

test('dev diagnostics compare the actual update shape with an existing document safely', async () => {
  const existing = completedEntryState({
    status: 'in-progress',
    currentStep: 'return',
    journeyStatus: 'pending',
    completedAt: 0,
  });
  const harness = createHarness({
    contractDiagnostics: true,
    existingDocument: {
      ...existing,
      startedAt: timestamp(existing.startedAt),
      updatedAt: timestamp(existing.updatedAt),
      completedAt: null,
      skippedAt: null,
    },
  });
  const failure = new Error('backend detail must stay private');
  failure.code = 'permission-denied';
  harness.controls.writeError = failure;

  await assert.rejects(
    harness.save(completedEntryState(), {
      operation: 'entry-completion', verify: true,
    }),
    (error) => {
      const shape = error.diagnostic?.contractShape;
      assert.equal(shape?.documentExists, true);
      assert.equal(shape?.writeMode, 'update');
      assert.equal(shape?.checks?.payloadHasOnlyAllowedFields, true);
      assert.equal(shape?.checks?.payloadHasExactFieldCount, true);
      assert.equal(shape?.checks?.currentVersion, true);
      assert.equal(shape?.checks?.completionShape, true);
      assert.equal(shape?.checks?.statusTransitionAllowed, true);
      assert.deepEqual(shape?.checks?.immutableFieldsPreserved, {
        contractVersion: true,
        experienceVersion: true,
        audience: true,
        classification: true,
        startedAt: true,
        completedAt: true,
      });
      assert.deepEqual(shape?.attempted?.fields, [
        'audience', 'classification', 'completedAt', 'contractVersion', 'currentStep',
        'experienceVersion', 'gamerStatus', 'interestIds', 'interestsStatus',
        'journeyStatus', 'oasisMode', 'selectedWorldId', 'skippedAt', 'source',
        'startedAt', 'status', 'themeExplicit', 'themeId', 'themeStatus', 'updatedAt',
      ]);
      assert.equal(Object.hasOwn(shape?.attempted?.enumValues || {}, 'selectedWorldId'), false);
      return true;
    }
  );
  const serialized = JSON.stringify(harness.logs);
  assert.equal(serialized.includes('entry-cloud-user'), false);
  assert.equal(serialized.includes('backend detail must stay private'), false);
});

test('dev diagnostics expose a legacy structural mismatch without logging field values', async () => {
  const harness = createHarness({
    contractDiagnostics: true,
    existingDocument: {
      status: 'in-progress',
      currentStep: 'return',
      actionStatus: 'ready',
      startedAt: timestamp(1000),
      updatedAt: timestamp(2000),
    },
  });
  const failure = new Error('denied');
  failure.code = 'permission-denied';
  harness.controls.writeError = failure;

  await assert.rejects(
    harness.save(completedEntryState(), {
      operation: 'entry-completion', verify: true,
    }),
    (error) => {
      const shape = error.diagnostic?.contractShape;
      assert.equal(shape?.writeMode, 'update');
      assert.deepEqual(shape?.existing?.fields, [
        'actionStatus', 'currentStep', 'startedAt', 'status', 'updatedAt',
      ]);
      assert.equal(shape?.checks?.immutableFieldsPreserved?.contractVersion, false);
      assert.equal(shape?.checks?.immutableFieldsPreserved?.experienceVersion, false);
      assert.equal(shape?.existing?.enumValues?.status, 'in-progress');
      assert.equal(Object.hasOwn(shape?.existing?.enumValues || {}, 'actionStatus'), false);
      return true;
    }
  );
});
