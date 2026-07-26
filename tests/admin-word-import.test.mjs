import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({ console, URL });
for (const file of ['../js/content-schema.js', '../js/admin-word-import.js']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  new vm.Script(source, { filename: file }).runInContext(context);
}
const schema = context.LootLinguaContentSchema;
const importer = context.LootLinguaAdminWordImport;

function options(extra = {}) {
  return {
    schema,
    worldId: 'world_1',
    rankId: 'rank_1',
    gateId: 'gate_1',
    existingWords: [],
    ...extra
  };
}

function assertCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

test('accepts the official object and the bare array formats', () => {
  const official = importer.parseJsonText(JSON.stringify({
    format: 'lootlingua-content-words',
    version: 1,
    words: [{ word: 'Treasure', translation: 'كنز' }]
  }));
  assert.equal(official.source, 'official');
  assert.equal(official.words.length, 1);

  const bare = importer.parseJsonText(JSON.stringify([{ word: 'Map', translation: 'خريطة' }]));
  assert.equal(bare.source, 'bare-array');
  assert.equal(bare.words.length, 1);
});

test('rejects invalid JSON, unsupported envelopes, empty files, and oversized imports', () => {
  assertCode(() => importer.parseJsonText('{'), 'import/invalid-json');
  assertCode(() => importer.parseJsonText('{}'), 'import/unsupported-format');
  assertCode(() => importer.parseJsonText(JSON.stringify({
    format: 'another-format', version: 1, words: [{}]
  })), 'import/unsupported-format');
  assertCode(() => importer.parseJsonText(JSON.stringify({
    format: 'lootlingua-content-words', version: 2, words: [{}]
  })), 'import/unsupported-version');
  assertCode(() => importer.parseJsonText('[]'), 'import/empty-file');
  assertCode(() => importer.parseJsonText(JSON.stringify(Array.from({ length: 101 }, () => ({})))), 'import/too-many-words');
  assertCode(() => importer.assertFileSize(importer.MAX_FILE_BYTES + 1), 'import/file-too-large');
});

test('requires word and translation while accepting supported optional fields', () => {
  const preview = importer.preparePreview([
    { word: 'Missing translation' },
    {
      word: 'Treasure',
      translation: 'كنز',
      definition: 'Something valuable.',
      definition_ar: 'شيء ثمين.',
      example: 'We found treasure.',
      exampleTranslation: 'وجدنا كنزًا.',
      category: 'Adventure',
      partOfSpeech: 'noun',
      level: 'A2',
      tags: ['adventure'],
      synonyms: ['wealth'],
      pronunciation: '/treasure/',
      audioUrl: 'https://example.test/treasure.mp3',
      imageUrl: '/assets/treasure.png',
      notes: 'Review later.',
      order: 1
    }
  ], options());
  assert.equal(preview.entries[0].state, 'invalid');
  assert.equal(preview.entries[1].state, 'valid');
  assert.equal(preview.entries[1].payload.definition_ar, 'شيء ثمين.');
  assert.equal(preview.entries[1].payload.order, 1);
});

test('ignores technical fields, forces draft centrally, and never forwards IDs or audit data', () => {
  const technicalValues = Object.fromEntries(
    Array.from(importer.TECHNICAL_FIELDS, (field) => [field, 'untrusted'])
  );
  const preview = importer.preparePreview([{
    word: 'Compass',
    translation: 'بوصلة',
    ...technicalValues
  }], options());
  const entry = preview.entries[0];
  assert.equal(entry.state, 'valid');
  assert.equal(
    entry.warnings.filter((item) => item.code === 'import/technical-field-ignored').length,
    importer.TECHNICAL_FIELDS.length
  );
  for (const field of importer.TECHNICAL_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(entry.payload, field), false, field);
  }
});

test('rejects unsupported fields, unsafe values, HTML, control characters, and wrong array types', () => {
  const preview = importer.preparePreview([
    { word: 'Map', translation: 'خريطة', extra: true },
    { word: '<b>Map</b>', translation: 'خريطة' },
    { word: 'Map\u0001', translation: 'خريطة' },
    { word: 'Map', translation: 'خريطة', tags: 'adventure' },
    { word: 'Map', translation: 'خريطة', audioUrl: 'javascript:alert(1)' },
    { word: 'Map', translation: undefined }
  ], options());
  assert.deepEqual(Array.from(preview.entries, (entry) => entry.state), Array(6).fill('invalid'));
});

test('normalizes identity centrally and trims and de-duplicates tags and synonyms', () => {
  const preview = importer.preparePreview([{
    word: '  Hidden   Treasure  ',
    translation: 'كنز مخفي',
    tags: [' Adventure ', 'adventure', ' objects '],
    synonyms: [' Wealth ', 'wealth', ' Riches ']
  }], options());
  const entry = preview.entries[0];
  assert.equal(entry.normalizedWord, schema.normalizeWord('  Hidden   Treasure  '));
  assert.deepEqual(Array.from(entry.payload.tags), ['Adventure', 'objects']);
  assert.deepEqual(Array.from(entry.payload.synonyms), ['Wealth', 'Riches']);
  assert.ok(entry.warnings.some((item) => item.code === 'duplicate_array_item'));
});

test('detects duplicates inside the file with the central normalized identity', () => {
  const preview = importer.preparePreview([
    { word: 'Treasure', translation: 'كنز' },
    { word: ' treasure ', translation: 'ثروة' }
  ], options());
  assert.equal(preview.entries[0].state, 'valid');
  assert.equal(preview.entries[1].state, 'duplicate-file');
  assert.equal(preview.stats.duplicateInFile, 1);
});

test('skips duplicates in the current gate and keeps rank or world duplicates as warnings', async () => {
  let preview = importer.preparePreview([
    { word: 'Treasure', translation: 'كنز' },
    { word: 'Compass', translation: 'بوصلة' }
  ], options());
  preview = await importer.inspectDuplicates(preview, {
    inspectGate: async (_worldId, _rankId, _gateId, word) => word === 'Treasure'
      ? { duplicateInGate: true, duplicateInRank: true, duplicateInWorld: true }
      : { duplicateInGate: false, duplicateInRank: true, duplicateInWorld: true }
  });
  assert.equal(preview.entries[0].state, 'duplicate-gate');
  assert.equal(preview.entries[1].state, 'valid');
  assert.ok(preview.entries[1].warnings.some((item) => item.code === 'import/duplicate-in-rank'));
});

test('keeps a word valid when the current-gate inspection finds no duplicate', async () => {
  let preview = importer.preparePreview([
    { word: 'Lantern', translation: 'ÙØ§Ù†ÙˆØ³' }
  ], options());
  preview = await importer.inspectDuplicates(preview, {
    inspectGate: async () => ({ duplicateInGate: false })
  });
  assert.equal(preview.entries[0].state, 'valid');
  assert.equal(preview.blockingIssue, null);
});

test('blocks the import once when current-gate inspection fails without poisoning every row', async () => {
  let preview = importer.preparePreview([
    { word: 'Lantern', translation: 'ÙØ§Ù†ÙˆØ³' },
    { word: 'Torch', translation: 'Ø´Ø¹Ù„Ø©' }
  ], options());
  preview = await importer.inspectDuplicates(preview, {
    inspectGate: async () => {
      const error = new Error('permission denied');
      error.code = 'admin/permission-denied';
      throw error;
    }
  });
  assert.equal(preview.blockingIssue.code, 'import/gate-duplicate-check-failed');
  assert.deepEqual(Array.from(preview.entries, (entry) => entry.state), ['valid', 'valid']);
  assert.equal(
    preview.entries.flatMap((entry) => entry.errors).some((item) =>
      item.code === 'admin/permission-denied'
    ),
    false
  );
  await assert.rejects(
    importer.commit(preview, { createWord: async () => {} }),
    (error) => error && error.code === 'import/gate-duplicate-check-failed'
  );
});

test('a failed rank or world warning check does not block import or repeat permission errors', async () => {
  for (const scope of ['rank', 'world']) {
    let preview = importer.preparePreview([
      { word: `${scope} lantern`, translation: 'ÙØ§Ù†ÙˆØ³' },
      { word: `${scope} torch`, translation: 'Ø´Ø¹Ù„Ø©' }
    ], options());
    preview = await importer.inspectDuplicates(preview, {
      inspectGate: async () => ({ duplicateInGate: false }),
      inspectOutside: async () => {
        const error = new Error('permission denied');
        error.code = 'admin/permission-denied';
        throw error;
      }
    });
    assert.equal(preview.blockingIssue, null);
    assert.deepEqual(Array.from(preview.entries, (entry) => entry.state), ['valid', 'valid']);
    assert.equal(preview.generalWarnings.length, 1);
    assert.equal(preview.generalWarnings[0].code, 'import/outside-duplicate-check-unavailable');
    assert.equal(
      preview.entries.flatMap((entry) => entry.errors).some((item) =>
        item.code === 'admin/permission-denied'
      ),
      false
    );
  }
});

test('imports only valid words sequentially and continues after a word failure', async () => {
  const preview = importer.preparePreview([
    { word: 'One', translation: 'واحد' },
    { word: 'Broken', translation: 'مكسور' },
    { word: 'Two', translation: 'اثنان' },
    { word: ' one ', translation: 'مكرر' },
    { word: '', translation: 'فارغ' }
  ], options());
  const calls = [];
  const progress = [];
  const result = await importer.commit(preview, {
    createWord: async (worldId, rankId, gateId, payload) => {
      calls.push({ worldId, rankId, gateId, payload });
      if (payload.word === 'Broken') {
        const error = new Error('write failed');
        error.code = 'admin/write-failed';
        throw error;
      }
    },
    onProgress: (state) => progress.push({ ...state })
  });
  assert.deepEqual(calls.map((call) => call.payload.word), ['One', 'Broken', 'Two']);
  assert.equal(result.summary.succeeded, 2);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.skippedDuplicates, 1);
  assert.equal(result.summary.skippedInvalid, 1);
  assert.equal(progress.length, 3);
  assert.equal(progress.at(-1).completed, 3);
});

test('staging preview validates with no destination IDs in its public context', () => {
  const preview = importer.preparePreview([
    { word: 'Unassigned', translation: 'غير موزعة' }
  ], options({ destination: 'staging', worldId: '', rankId: '', gateId: '' }));
  assert.equal(preview.destination, 'staging');
  assert.deepEqual(
    JSON.parse(JSON.stringify(preview.context)),
    { worldId: '', rankId: '', gateId: '' }
  );
  assert.equal(preview.entries[0].state, 'valid');
  assert.equal('worldId' in preview.entries[0].payload, false);
});

test('staging commit sends one validated batch and reports existing staging duplicates', async () => {
  const preview = importer.preparePreview([
    { word: 'Fresh', translation: 'جديدة' },
    { word: 'Existing', translation: 'موجودة' }
  ], options({ destination: 'staging' }));
  let received = null;
  const result = await importer.commitToStaging(preview, {
    sourceFileName: 'words.json',
    importWords: async (entries, metadata) => {
      received = { entries, metadata };
      return {
        importBatchId: 'import_batch',
        results: [
          { index: 0, state: 'staged', stagingWordId: 'staging-a' },
          {
            index: 1,
            state: 'duplicate-staging',
            stagingWordId: 'staging-b',
            sourceFileName: 'older.json',
            importBatchId: 'older-batch'
          }
        ]
      };
    }
  });
  assert.equal(received.entries.length, 2);
  assert.equal(received.metadata.sourceFileName, 'words.json');
  assert.equal('worldId' in received.entries[0].payload, false);
  assert.equal(result.entries[0].state, 'staged');
  assert.equal(result.entries[1].state, 'duplicate-staging');
  assert.equal(result.summary.succeeded, 1);
  assert.equal(result.summary.skippedDuplicates, 1);
});

test('contains no callable or direct Firestore write path', () => {
  const source = readFileSync(new URL('../js/admin-word-import.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /httpsCallable|firebase\.functions|setDoc|updateDoc|writeBatch/);
  assert.match(source, /await settings\.createWord\(/);
});
