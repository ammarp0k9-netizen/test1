(function attachLootLinguaAdminWordImport(root) {
  'use strict';

  const FORMAT = 'lootlingua-content-words';
  const VERSION = 1;
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_WORDS = 100;
  const IMPORT_FIELDS = Object.freeze([
    'word', 'translation', 'definition', 'definition_ar', 'example',
    'exampleTranslation', 'category', 'partOfSpeech', 'level', 'tags',
    'synonyms', 'pronunciation', 'audioUrl', 'imageUrl', 'notes', 'order'
  ]);
  const TECHNICAL_FIELDS = Object.freeze([
    'contentWordId', 'worldId', 'rankId', 'gateId', 'normalizedWord',
    'wordKey', 'normalizationVersion', 'version', 'createdAt', 'updatedAt',
    'createdBy', 'updatedBy', 'status'
  ]);
  const importFieldSet = new Set(IMPORT_FIELDS);
  const technicalFieldSet = new Set(TECHNICAL_FIELDS);

  function makeError(code, message, details) {
    const error = new Error(message || code);
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.prototype.toString.call(value) === '[object Object]';
  }

  function assertFileSize(size) {
    if (!Number.isSafeInteger(size) || size < 0) {
      throw makeError('import/invalid-file-size', 'File size is invalid.');
    }
    if (size > MAX_FILE_BYTES) {
      throw makeError('import/file-too-large', 'The JSON file exceeds 2 MB.');
    }
    return size;
  }

  function parseJsonText(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw makeError('import/empty-file', 'The JSON file is empty.');
    }
    let decoded;
    try {
      decoded = JSON.parse(text);
    } catch (error) {
      throw makeError('import/invalid-json', 'The file is not valid JSON.');
    }

    let words;
    let source;
    if (Array.isArray(decoded)) {
      words = decoded;
      source = 'bare-array';
    } else if (isPlainObject(decoded)) {
      if (decoded.format !== FORMAT) {
        throw makeError('import/unsupported-format', 'The import format is not supported.');
      }
      if (decoded.version !== VERSION) {
        throw makeError('import/unsupported-version', 'The import version is not supported.');
      }
      if (!Array.isArray(decoded.words)) {
        throw makeError('import/words-array-required', 'The words field must be an array.');
      }
      words = decoded.words;
      source = 'official';
    } else {
      throw makeError('import/unsupported-format', 'The JSON root must be the official object or an array.');
    }

    if (words.length === 0) {
      throw makeError('import/empty-file', 'The import contains no words.');
    }
    if (words.length > MAX_WORDS) {
      throw makeError('import/too-many-words', 'One import may contain at most 100 words.');
    }
    return { format: FORMAT, version: VERSION, source, words };
  }

  function requireSchema(schema) {
    const candidate = schema || root.LootLinguaContentSchema;
    if (
      !candidate || typeof candidate.validateWord !== 'function' ||
      typeof candidate.compactForStorage !== 'function' ||
      typeof candidate.normalizeWordIdentity !== 'function'
    ) {
      throw makeError('import/schema-unavailable', 'The content schema is unavailable.');
    }
    return candidate;
  }

  function issue(path, code, message, severity) {
    return {
      path: String(path || 'word'),
      code: String(code || 'import/invalid-word'),
      message: String(message || code || 'Invalid word.'),
      severity: severity === 'warning' ? 'warning' : 'error'
    };
  }

  function cloneIssue(source, fallbackSeverity) {
    return issue(
      source && source.path,
      source && source.code,
      source && source.message,
      source && source.severity || fallbackSeverity
    );
  }

  function recalculateStats(entries) {
    return {
      total: entries.length,
      valid: entries.filter((entry) => entry.state === 'valid').length,
      invalid: entries.filter((entry) => entry.state === 'invalid').length,
      duplicateInFile: entries.filter((entry) => entry.state === 'duplicate-file').length,
      duplicateInGate: entries.filter((entry) => entry.state === 'duplicate-gate').length,
      warnings: entries.reduce((count, entry) => count + entry.warnings.length, 0)
    };
  }

  function preparePreview(parsedInput, options) {
    const settings = options || {};
    const parsed = typeof parsedInput === 'string'
      ? parseJsonText(parsedInput)
      : (Array.isArray(parsedInput)
        ? {
            format: FORMAT,
            version: VERSION,
            source: 'bare-array',
            words: parsedInput
          }
        : parsedInput);
    if (!parsed || !Array.isArray(parsed.words)) {
      throw makeError('import/invalid-input', 'Parsed import data is required.');
    }
    if (parsed.words.length === 0 || parsed.words.length > MAX_WORDS) {
      throw makeError(
        parsed.words.length ? 'import/too-many-words' : 'import/empty-file',
        parsed.words.length ? 'One import may contain at most 100 words.' : 'The import contains no words.'
      );
    }
    const schema = requireSchema(settings.schema);
    const context = {
      worldId: String(settings.worldId || ''),
      rankId: String(settings.rankId || ''),
      gateId: String(settings.gateId || '')
    };
    const existing = new Set((settings.existingWords || []).map((word) =>
      String(word && word.normalizedWord || '')
    ).filter(Boolean));
    const seen = new Set();

    const entries = parsed.words.map((raw, index) => {
      const path = `words[${index}]`;
      const errors = [];
      const warnings = [];
      const payload = {};
      if (!isPlainObject(raw)) {
        errors.push(issue(path, 'import/plain-object-required', 'Each word must be an object.'));
      } else {
        Object.keys(raw).forEach((field) => {
          if (technicalFieldSet.has(field)) {
            warnings.push(issue(
              `${path}.${field}`,
              'import/technical-field-ignored',
              `Technical field ${field} was ignored.`,
              'warning'
            ));
          } else if (!importFieldSet.has(field)) {
            errors.push(issue(
              `${path}.${field}`,
              'import/unsupported-field',
              `Field ${field} is not supported.`
            ));
          } else {
            payload[field] = raw[field];
          }
        });
      }

      const candidate = {
        ...payload,
        worldId: context.worldId,
        rankId: context.rankId,
        gateId: context.gateId,
        contentWordId: `import-preview-${index + 1}`,
        status: 'draft',
        version: 1
      };
      const validation = schema.validateWord(candidate, {
        worldId: context.worldId,
        rankId: context.rankId,
        gateId: context.gateId,
        contentWordId: candidate.contentWordId,
        path
      });
      (validation.errors || []).forEach((item) => errors.push(cloneIssue(item, 'error')));
      (validation.warnings || []).forEach((item) => warnings.push(cloneIssue(item, 'warning')));
      const cleaned = validation.value || {};
      const normalizedWord = String(cleaned.normalizedWord || '');
      let state = errors.length ? 'invalid' : 'valid';
      if (normalizedWord && state === 'valid') {
        if (seen.has(normalizedWord)) {
          state = 'duplicate-file';
          errors.push(issue(path, 'import/duplicate-in-file', 'Duplicate normalized word in the file.'));
        } else {
          seen.add(normalizedWord);
        }
        if (state === 'valid' && existing.has(normalizedWord)) {
          state = 'duplicate-gate';
          errors.push(issue(path, 'import/duplicate-in-gate', 'The word already exists in this gate.'));
        }
      }

      const cleanPayload = {};
      IMPORT_FIELDS.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(cleaned, field)) cleanPayload[field] = cleaned[field];
      });
      return {
        index,
        word: String(cleaned.word || raw && raw.word || ''),
        translation: String(cleaned.translation || raw && raw.translation || ''),
        level: String(cleaned.level || ''),
        normalizedWord,
        state,
        payload: schema.compactForStorage(cleanPayload),
        errors,
        warnings
      };
    });

    return {
      format: FORMAT,
      version: VERSION,
      source: parsed.source || 'official',
      context,
      entries,
      stats: recalculateStats(entries)
    };
  }

  async function inspectDuplicates(preview, options) {
    const settings = options || {};
    if (!preview || !Array.isArray(preview.entries) || typeof settings.inspect !== 'function') {
      throw makeError('import/duplicate-inspector-required', 'A duplicate inspector is required.');
    }
    const entries = preview.entries.map((entry) => ({
      ...entry,
      errors: entry.errors.slice(),
      warnings: entry.warnings.slice()
    }));
    const eligible = entries.filter((entry) => entry.state === 'valid');
    const concurrency = Math.max(1, Math.min(4, Number(settings.concurrency) || 3));
    let cursor = 0;

    async function worker() {
      while (cursor < eligible.length) {
        const entry = eligible[cursor++];
        try {
          const result = await settings.inspect(
            preview.context.worldId,
            preview.context.rankId,
            preview.context.gateId,
            entry.payload.word
          );
          if (result && result.duplicateInGate) {
            entry.state = 'duplicate-gate';
            entry.errors.push(issue(
              `words[${entry.index}]`,
              'import/duplicate-in-gate',
              'The word already exists in this gate.'
            ));
          } else if (result && (result.duplicateInRank || result.duplicateInWorld)) {
            entry.warnings.push(issue(
              `words[${entry.index}]`,
              result.duplicateInRank ? 'import/duplicate-in-rank' : 'import/duplicate-in-world',
              'The word exists elsewhere in this rank or world.',
              'warning'
            ));
          }
        } catch (error) {
          entry.state = 'invalid';
          entry.errors.push(issue(
            `words[${entry.index}]`,
            String(error && error.code || 'import/duplicate-check-failed'),
            'Duplicate inspection failed.'
          ));
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, eligible.length) }, worker));
    return { ...preview, entries, stats: recalculateStats(entries) };
  }

  async function commit(preview, options) {
    const settings = options || {};
    if (!preview || !Array.isArray(preview.entries) || typeof settings.createWord !== 'function') {
      throw makeError('import/create-word-required', 'createWord is required.');
    }
    const entries = preview.entries.map((entry) => ({
      ...entry,
      errors: entry.errors.slice(),
      warnings: entry.warnings.slice()
    }));
    const eligible = entries.filter((entry) => entry.state === 'valid');
    let succeeded = 0;
    let failed = 0;
    let skippedDuplicates = entries.filter((entry) =>
      entry.state === 'duplicate-file' || entry.state === 'duplicate-gate'
    ).length;

    for (let index = 0; index < eligible.length; index += 1) {
      const entry = eligible[index];
      try {
        await settings.createWord(
          preview.context.worldId,
          preview.context.rankId,
          preview.context.gateId,
          entry.payload
        );
        entry.state = 'imported';
        succeeded += 1;
      } catch (error) {
        const code = String(error && error.code || 'admin/import-word-failed');
        if (code === 'content/duplicate-word-in-gate') {
          entry.state = 'duplicate-gate';
          skippedDuplicates += 1;
        } else {
          entry.state = 'failed';
          failed += 1;
        }
        entry.errors.push(issue(`words[${entry.index}]`, code, String(error && error.message || code)));
      }
      if (typeof settings.onProgress === 'function') {
        settings.onProgress({
          completed: index + 1,
          total: eligible.length,
          succeeded,
          failed,
          skippedDuplicates
        });
      }
    }

    return {
      ...preview,
      entries,
      summary: {
        total: entries.length,
        attempted: eligible.length,
        succeeded,
        failed,
        skippedDuplicates,
        skippedInvalid: entries.filter((entry) => entry.state === 'invalid').length
      }
    };
  }

  const API = Object.freeze({
    FORMAT,
    VERSION,
    MAX_FILE_BYTES,
    MAX_WORDS,
    IMPORT_FIELDS,
    TECHNICAL_FIELDS,
    assertFileSize,
    parseJsonText,
    preparePreview,
    inspectDuplicates,
    commit
  });

  Object.defineProperty(root, 'LootLinguaAdminWordImport', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false
  });
}(typeof window !== 'undefined' ? window : globalThis));
