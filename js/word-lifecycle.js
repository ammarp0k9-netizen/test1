(function attachLootLinguaWordLifecycle(root) {
  'use strict';

  const RESULT_TYPES = Object.freeze([
    'created',
    'restored',
    'source-linked',
    'already-linked',
    'updated-missing-fields',
    'failed',
  ]);
  const JOURNEY_SOURCE_TYPES = Object.freeze([
    'published-gate',
    'level-placement',
  ]);
  const PERSONAL_SOURCE_TYPES = Object.freeze([
    'manual',
    'dictionary-search',
    'private-world',
    'import',
  ]);

  function schemaApi() {
    return root.LootLinguaContentSchema || null;
  }

  function normalizeIdentity(wordOrText) {
    const schema = schemaApi();
    if (schema?.normalizeWordIdentity) return schema.normalizeWordIdentity(wordOrText);
    const text = wordOrText && typeof wordOrText === 'object'
      ? (wordOrText.word || wordOrText.text || '')
      : wordOrText;
    const normalizedWord = String(text || '').toLowerCase().trim().replace(/\s+/g, ' ');
    return {
      normalizedWord,
      wordKey: normalizedWord
        .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 180),
      normalizationVersion: 1,
    };
  }

  function wordKeyOf(wordOrText) {
    if (wordOrText && typeof wordOrText === 'object' && wordOrText.wordKey) {
      return String(wordOrText.wordKey);
    }
    return normalizeIdentity(wordOrText).wordKey;
  }

  function isHiddenFromDictionary(word) {
    return word?.hiddenFromDictionary === true;
  }

  function isVisibleInDictionaryList(word) {
    return Boolean(word) && !isHiddenFromDictionary(word);
  }

  function hasLearnableContent(word) {
    return Boolean(
      String(word?.word || word?.text || '').trim() &&
      String(word?.meaning || word?.translation || '').trim()
    );
  }

  function isEligibleForPersonalDictionaryQuiz(word) {
    return hasLearnableContent(word);
  }

  function isEligibleForSrsReview(word) {
    return hasLearnableContent(word);
  }

  function findUserWordByKey(words, wordOrText) {
    const key = wordKeyOf(wordOrText);
    if (!key) return null;
    return (Array.isArray(words) ? words : []).find((word) => wordKeyOf(word) === key) || null;
  }

  function normalizeSourceType(value) {
    const type = String(value || 'manual').trim().toLowerCase();
    return [...JOURNEY_SOURCE_TYPES, ...PERSONAL_SOURCE_TYPES].includes(type)
      ? type
      : 'manual';
  }

  function isJourneySourceType(value) {
    return JOURNEY_SOURCE_TYPES.includes(normalizeSourceType(value));
  }

  function summarizeSources(sources) {
    const items = (Array.isArray(sources) ? sources : []).map((source) => ({
      ...source,
      addedFrom: normalizeSourceType(source?.addedFrom || source?.type),
    }));
    const journeySources = items.filter((source) => isJourneySourceType(source.addedFrom));
    return Object.freeze({
      count: items.length,
      sources: items,
      journeySources,
      hasJourneySource: journeySources.length > 0,
      hasOnlyManualSources: items.length > 0 && items.every((source) =>
        ['manual', 'dictionary-search', 'import'].includes(source.addedFrom)
      ),
    });
  }

  function resultType(flags) {
    if (flags?.failed) return 'failed';
    if (flags?.created) return 'created';
    if (flags?.restored) return 'restored';
    if (flags?.sourceLinked) return 'source-linked';
    if (flags?.updatedMissingFields) return 'updated-missing-fields';
    return 'already-linked';
  }

  function emptySummary() {
    return {
      created: 0,
      restored: 0,
      sourceLinked: 0,
      alreadyLinked: 0,
      updatedMissingFields: 0,
      failed: 0,
      hiddenPreserved: 0,
    };
  }

  function addResultToSummary(summary, result) {
    const next = summary || emptySummary();
    const status = result?.status || resultType(result);
    if (status === 'created') next.created += 1;
    else if (status === 'restored') next.restored += 1;
    else if (status === 'source-linked') next.sourceLinked += 1;
    else if (status === 'updated-missing-fields') next.updatedMissingFields += 1;
    else if (status === 'failed') next.failed += 1;
    else next.alreadyLinked += 1;
    if (result?.hiddenPreserved) next.hiddenPreserved += 1;
    return next;
  }

  const API = Object.freeze({
    RESULT_TYPES,
    JOURNEY_SOURCE_TYPES,
    PERSONAL_SOURCE_TYPES,
    normalizeIdentity,
    wordKeyOf,
    isHiddenFromDictionary,
    isVisibleInDictionaryList,
    isEligibleForPersonalDictionaryQuiz,
    isEligibleForSrsReview,
    findUserWordByKey,
    normalizeSourceType,
    isJourneySourceType,
    summarizeSources,
    resultType,
    emptySummary,
    addResultToSummary,
  });

  Object.defineProperty(root, 'LootLinguaWordLifecycle', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
