(function attachLootLinguaContentSchema(root) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var NORMALIZATION_VERSION = 1;

  var CONTENT_STATUSES = Object.freeze(['draft', 'published', 'archived']);
  var PROGRESS_STATUSES = Object.freeze([
    'locked',
    'available',
    'learning',
    'ready',
    'cleared',
    'mastered'
  ]);
  var UNLOCK_MODES = Object.freeze(['manual_placeholder']);

  var DEFAULT_UNLOCK_CONFIG = deepFreeze({
    mode: 'manual_placeholder',
    initialStatus: 'locked',
    requiredMasteredRatio: null,
    requiredReviewingRatio: null,
    requiredGateCount: null
  });

  var ENTRY_ASSESSMENT_DEFAULTS = deepFreeze({
    passRatio: 0.75,
    assessmentVersion: 1
  });

  var CEFR_LEVELS = Object.freeze([
    'A1',
    'A2',
    'B1',
    'B2',
    'C1',
    'C2',
    'unclassified'
  ]);

  var CEFR_LEVEL_META = deepFreeze({
    A1: { label: 'A1', name: 'المستوى المبتدئ', description: 'أساسيات اللغة والمواقف اليومية البسيطة.' },
    A2: { label: 'A2', name: 'المبتدئ الأعلى', description: 'تواصل يومي أوسع ومفردات أكثر استقلالًا.' },
    B1: { label: 'B1', name: 'المستوى المتوسط', description: 'فهم المواقف الشائعة والتعبير بوضوح.' },
    B2: { label: 'B2', name: 'المتوسط الأعلى', description: 'تواصل مرن وفهم محتوى أكثر تعقيدًا.' },
    C1: { label: 'C1', name: 'المستوى المتقدم', description: 'استخدام دقيق ومرن للغة في سياقات متنوعة.' },
    C2: { label: 'C2', name: 'مستوى الإتقان', description: 'فهم متقدم وتعبير شديد الدقة.' },
    unclassified: { label: 'غير مصنف', name: 'محتوى غير مصنف', description: 'رتب قديمة لم تُربط بمستوى لغوي بعد.' }
  });

  var START_RANK_COPY = deepFreeze({
    actionLabel: 'ابدأ الرتبة',
    description: 'ستنضم جميع كلمات هذه الرتبة إلى رحلة مراجعتك تدريجيًا.',
    previewTitle: 'معاينة الرتبة',
    confirmLabel: 'ابدأ الرتبة',
    cancelLabel: 'إلغاء',
    pendingLabel: 'جاري تجهيز الرتبة…'
  });

  var LIMITS = deepFreeze({
    id: 128,
    slug: 80,
    title: 120,
    subtitle: 180,
    description: 2000,
    icon: 80,
    token: 80,
    language: 35,
    word: 200,
    translation: 500,
    definition: 2000,
    example: 2000,
    notes: 4000,
    pronunciation: 300,
    tag: 60,
    synonym: 200,
    tags: 24,
    synonyms: 24,
    url: 2048,
    uid: 128,
    order: 1000000,
    count: 10000000,
    importBytes: 5 * 1024 * 1024,
    importWorlds: 20,
    ranksPerWorld: 100,
    gatesPerRank: 200,
    wordsPerGate: 2000,
    importWordsTotal: 20000
  });

  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var LANGUAGE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
  var CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  var RAW_HTML_RE = /<\/?[A-Za-z][^>]*>|<!--|-->|<!doctype|<\?xml/i;
  var SCRIPTABLE_TEXT_RE = /\bon[a-z]+\s*=|(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i;
  var DANGEROUS_URL_RE = /[\u0000-\u001F\u007F\s\\]/;
  var hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);

  function deepFreeze(value, seen) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
    var visited = seen || new WeakSet();
    if (visited.has(value)) return value;
    visited.add(value);
    Object.getOwnPropertyNames(value).forEach(function freezeChild(key) {
      deepFreeze(value[key], visited);
    });
    return Object.freeze(value);
  }

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function isDomLike(value) {
    if (!value || typeof value !== 'object') return false;
    if (typeof root.Node === 'function' && value instanceof root.Node) return true;
    return typeof value.nodeType === 'number' &&
      (typeof value.nodeName === 'string' || typeof value.ownerDocument === 'object');
  }

  function containsRawHtml(value) {
    var text = String(value || '');
    return RAW_HTML_RE.test(text) || SCRIPTABLE_TEXT_RE.test(text);
  }

  function createContext() {
    return { errors: [], warnings: [] };
  }

  function addIssue(context, severity, path, code, message) {
    var issue = {
      path: path || '$',
      code: code,
      message: message,
      severity: severity
    };
    if (severity === 'warning') context.warnings.push(issue);
    else context.errors.push(issue);
    return issue;
  }

  function inspectSafeValue(value, context, path, seen) {
    var valueType = typeof value;
    if (value === undefined) {
      addIssue(context, 'error', path, 'undefined_not_allowed', 'Undefined values are not allowed.');
      return;
    }
    if (value === null || valueType === 'string' || valueType === 'boolean') return;
    if (valueType === 'number') {
      if (!Number.isFinite(value)) {
        addIssue(context, 'error', path, 'non_finite_number', 'Numbers must be finite.');
      }
      return;
    }
    if (valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
      addIssue(context, 'error', path, 'unsupported_value', 'Functions, symbols, and bigint values are not allowed.');
      return;
    }
    if (isDomLike(value)) {
      addIssue(context, 'error', path, 'dom_not_allowed', 'DOM values are not allowed in content data.');
      return;
    }
    if (valueType !== 'object') {
      addIssue(context, 'error', path, 'unsupported_value', 'Unsupported value type.');
      return;
    }

    var visited = seen || new WeakSet();
    if (visited.has(value)) {
      addIssue(context, 'error', path, 'cyclic_value', 'Cyclic values are not allowed.');
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (var index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, index)) {
          addIssue(context, 'error', path + '[' + index + ']', 'array_hole_not_allowed', 'Sparse arrays are not allowed.');
        } else {
          inspectSafeValue(value[index], context, path + '[' + index + ']', visited);
        }
      }
      return;
    }

    if (!isPlainObject(value)) {
      addIssue(context, 'error', path, 'plain_object_required', 'Only plain data objects are allowed.');
      return;
    }

    Object.keys(value).forEach(function inspectKey(key) {
      inspectSafeValue(value[key], context, path + '.' + key, visited);
    });
  }

  function checkUnknownFields(input, allowed, context, path) {
    if (!isPlainObject(input)) return;
    Object.keys(input).forEach(function checkKey(key) {
      if (!allowed.has(key)) {
        addIssue(context, 'error', path + '.' + key, 'unknown_field', 'Unknown field is not allowed.');
      }
    });
  }

  function cleanString(raw, options, context, path) {
    var settings = options || {};
    if (raw === undefined || raw === null) {
      if (settings.required) {
        addIssue(context, 'error', path, 'required', 'This field is required.');
      }
      return '';
    }
    if (typeof raw !== 'string') {
      addIssue(context, 'error', path, 'string_required', 'Expected a string.');
      return '';
    }

    var value = raw.replace(/\r\n?/g, '\n').trim();
    if (CONTROL_RE.test(value)) {
      addIssue(context, 'error', path, 'control_character', 'Control characters are not allowed.');
      value = value.replace(CONTROL_RE, '');
    }
    if (containsRawHtml(value)) {
      addIssue(context, 'error', path, 'html_not_allowed', 'Raw HTML and executable text are not allowed.');
      value = '';
    }
    if (settings.singleLine && /[\n\r]/.test(value)) {
      addIssue(context, 'error', path, 'single_line_required', 'This field must be a single line.');
      value = value.replace(/\s+/g, ' ').trim();
    }
    if (settings.max && value.length > settings.max) {
      addIssue(context, 'error', path, 'too_long', 'Value exceeds the maximum length of ' + settings.max + '.');
      value = value.slice(0, settings.max);
    }
    if (settings.required && !value) {
      addIssue(context, 'error', path, 'required', 'This field is required.');
    }
    return value;
  }

  function cleanId(raw, context, path, required) {
    var value = cleanString(raw, {
      required: required !== false,
      max: LIMITS.id,
      singleLine: true
    }, context, path);
    if (value && !ID_RE.test(value)) {
      addIssue(context, 'error', path, 'invalid_id', 'IDs may contain only letters, numbers, underscore, and hyphen.');
      return '';
    }
    return value;
  }

  function cleanSlug(raw, context, path, required) {
    var value = cleanString(raw, {
      required: required === true,
      max: LIMITS.slug,
      singleLine: true
    }, context, path).toLowerCase();
    if (value && !SLUG_RE.test(value)) {
      addIssue(context, 'error', path, 'invalid_slug', 'Slug must use lowercase letters, numbers, and single hyphens.');
      return '';
    }
    return value;
  }

  function cleanLanguage(raw, context, path) {
    var value = cleanString(raw, {
      required: false,
      max: LIMITS.language,
      singleLine: true
    }, context, path);
    if (value && !LANGUAGE_RE.test(value)) {
      addIssue(context, 'error', path, 'invalid_language', 'Expected a BCP-47 style language code.');
      return '';
    }
    return value;
  }

  function cleanEnum(raw, allowed, fallback, context, path) {
    var value = raw === undefined || raw === null || raw === '' ? fallback : raw;
    if (typeof value !== 'string' || allowed.indexOf(value) === -1) {
      addIssue(context, 'error', path, 'invalid_enum', 'Value must be one of: ' + allowed.join(', ') + '.');
      return fallback;
    }
    return value;
  }

  function cleanInteger(raw, fallback, min, max, context, path) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
      addIssue(context, 'error', path, 'integer_required', 'Expected a safe integer.');
      return fallback;
    }
    if (raw < min || raw > max) {
      addIssue(context, 'error', path, 'number_out_of_range', 'Number is outside the allowed range.');
      return fallback;
    }
    return raw;
  }

  function cleanEntryAssessmentPassRatio(raw, context, path) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      addIssue(context, 'error', path, 'number_required', 'Expected a finite number.');
      return null;
    }
    if (raw <= 0 || raw > 1) {
      addIssue(context, 'error', path, 'assessment_ratio_out_of_range', 'Assessment pass ratio must be greater than 0 and at most 1.');
      return null;
    }
    return raw;
  }

  function resolveEntryAssessmentPassRatio(gateOrRatio) {
    var ratio = isPlainObject(gateOrRatio)
      ? gateOrRatio.entryAssessmentPassRatio
      : gateOrRatio;
    if (ratio === undefined || ratio === null || ratio === '') {
      return ENTRY_ASSESSMENT_DEFAULTS.passRatio;
    }
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw new RangeError('Entry assessment pass ratio must be greater than 0 and at most 1.');
    }
    return ratio;
  }

  function cleanBoolean(raw, fallback, context, path) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw !== 'boolean') {
      addIssue(context, 'error', path, 'boolean_required', 'Expected a boolean.');
      return fallback;
    }
    return raw;
  }

  function cleanUrl(raw, context, path) {
    var value = cleanString(raw, {
      required: false,
      max: LIMITS.url,
      singleLine: true
    }, context, path);
    if (!value) return '';
    if (DANGEROUS_URL_RE.test(value) || value.indexOf('//') === 0) {
      addIssue(context, 'error', path, 'unsafe_url', 'URL contains unsafe characters or is scheme-relative.');
      return '';
    }

    var absoluteScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
    try {
      var parsed = new URL(value, 'https://lootlingua.invalid/');
      if (absoluteScheme && parsed.protocol !== 'https:') {
        addIssue(context, 'error', path, 'unsafe_url_scheme', 'Only HTTPS absolute URLs are allowed.');
        return '';
      }
      if (parsed.username || parsed.password) {
        addIssue(context, 'error', path, 'url_credentials_not_allowed', 'URL credentials are not allowed.');
        return '';
      }
      if (!absoluteScheme) {
        var pathSegments = parsed.pathname.split('/');
        if (pathSegments.indexOf('..') !== -1 || value.indexOf('../') !== -1) {
          addIssue(context, 'error', path, 'url_path_traversal', 'Parent path traversal is not allowed.');
          return '';
        }
      }
    } catch (error) {
      addIssue(context, 'error', path, 'invalid_url', 'URL is invalid.');
      return '';
    }
    return value;
  }

  function cleanStringArray(raw, options, context, path) {
    var settings = options || {};
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      addIssue(context, 'error', path, 'array_required', 'Expected an array.');
      return [];
    }
    if (raw.length > settings.maxItems) {
      addIssue(context, 'error', path, 'array_too_long', 'Array exceeds the maximum item count of ' + settings.maxItems + '.');
    }

    var output = [];
    var seen = new Set();
    raw.slice(0, settings.maxItems).forEach(function cleanItem(item, index) {
      var itemPath = path + '[' + index + ']';
      var value = cleanString(item, {
        required: true,
        max: settings.maxLength,
        singleLine: true
      }, context, itemPath);
      if (!value) return;
      var key = settings.identity(value);
      if (!key) {
        addIssue(context, 'error', itemPath, 'empty_identity', 'Item has no usable normalized identity.');
        return;
      }
      if (seen.has(key)) {
        addIssue(context, 'warning', itemPath, 'duplicate_array_item', 'Duplicate array item was removed.');
        return;
      }
      seen.add(key);
      output.push(value);
    });
    return output;
  }

  function cleanTimestamp(raw, context, path) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string') {
      addIssue(context, 'error', path, 'timestamp_string_required', 'Imported timestamps must be ISO strings.');
      return null;
    }
    var value = cleanString(raw, { max: 64, singleLine: true }, context, path);
    var parsed = Date.parse(value);
    if (!value || !Number.isFinite(parsed)) {
      addIssue(context, 'error', path, 'invalid_timestamp', 'Timestamp must be a valid ISO date string.');
      return null;
    }
    return new Date(parsed).toISOString();
  }

  function normalizeWord(value) {
    return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function getWordMasteryKey(wordOrText) {
    var text = wordOrText && typeof wordOrText === 'object'
      ? (wordOrText.word || wordOrText.text || '')
      : wordOrText;
    return normalizeWord(text)
      .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 180);
  }

  function normalizeWordIdentity(wordOrText) {
    var text = wordOrText && typeof wordOrText === 'object'
      ? (wordOrText.word || wordOrText.text || '')
      : wordOrText;
    return {
      normalizedWord: normalizeWord(text),
      wordKey: getWordMasteryKey(text),
      normalizationVersion: NORMALIZATION_VERSION
    };
  }

  function normalizeCefrLevel(value) {
    var level = String(value || '').trim();
    return CEFR_LEVELS.indexOf(level) >= 0 ? level : 'unclassified';
  }

  function getCefrLevelOrder(value) {
    var index = CEFR_LEVELS.indexOf(normalizeCefrLevel(value));
    return index < 0 ? CEFR_LEVELS.length - 1 : index;
  }

  function comparePublishedRanks(left, right) {
    var levelOrder = getCefrLevelOrder(left && left.cefrLevel) -
      getCefrLevelOrder(right && right.cefrLevel);
    if (levelOrder) return levelOrder;
    var leftOrder = Number(left && left.order);
    var rightOrder = Number(right && right.order);
    var safeLeft = Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER;
    var safeRight = Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER;
    if (safeLeft !== safeRight) return safeLeft - safeRight;
    return String(left && (left.rankId || left.id) || '')
      .localeCompare(String(right && (right.rankId || right.id) || ''), 'en');
  }

  function groupRanksByCefrLevel(ranks) {
    var groups = new Map();
    CEFR_LEVELS.forEach(function createLevel(level) { groups.set(level, []); });
    (Array.isArray(ranks) ? ranks : []).slice().sort(comparePublishedRanks).forEach(function addRank(rank) {
      groups.get(normalizeCefrLevel(rank && rank.cefrLevel)).push(rank);
    });
    return groups;
  }

  function cleanSchemaVersion(raw, context, path) {
    if (raw === undefined || raw === null || raw === '') return SCHEMA_VERSION;
    if (raw !== SCHEMA_VERSION) {
      addIssue(context, 'error', path, 'unsupported_schema_version', 'Unsupported schemaVersion.');
    }
    return SCHEMA_VERSION;
  }

  function cleanNormalizationVersion(raw, context, path) {
    if (raw === undefined || raw === null || raw === '') return NORMALIZATION_VERSION;
    if (raw !== NORMALIZATION_VERSION) {
      addIssue(context, 'error', path, 'unsupported_normalization_version', 'Unsupported normalizationVersion.');
    }
    return NORMALIZATION_VERSION;
  }

  function resolveId(input, primaryName, aliases, contextValue, context, path) {
    var values = [];
    if (hasOwn(input, primaryName) && input[primaryName] !== '') {
      values.push({ name: primaryName, value: input[primaryName] });
    }
    aliases.forEach(function collectAlias(alias) {
      if (hasOwn(input, alias) && input[alias] !== '') {
        values.push({ name: alias, value: input[alias] });
      }
    });
    if (contextValue !== undefined && contextValue !== null && contextValue !== '') {
      values.push({ name: 'context.' + primaryName, value: contextValue });
    }

    var first = values.length ? values[0].value : undefined;
    values.slice(1).forEach(function detectConflict(candidate) {
      if (String(candidate.value) !== String(first)) {
        addIssue(context, 'error', path, 'id_alias_conflict', primaryName + ' values do not match.');
      }
    });
    return cleanId(first, context, path, true);
  }

  function copyMetadata(input, output, context, path) {
    ['createdAt', 'updatedAt'].forEach(function copyTimestamp(field) {
      if (hasOwn(input, field)) {
        var value = cleanTimestamp(input[field], context, path + '.' + field);
        if (value !== null) output[field] = value;
      }
    });
    ['createdBy', 'updatedBy'].forEach(function copyUid(field) {
      if (hasOwn(input, field)) {
        var value = cleanString(input[field], {
          required: false,
          max: LIMITS.uid,
          singleLine: true
        }, context, path + '.' + field);
        if (value) output[field] = value;
      }
    });
  }

  function cleanUnlockConfigInternal(raw, context, path) {
    if (raw === undefined || raw === null) {
      return {
        mode: DEFAULT_UNLOCK_CONFIG.mode,
        initialStatus: DEFAULT_UNLOCK_CONFIG.initialStatus,
        requiredMasteredRatio: null,
        requiredReviewingRatio: null,
        requiredGateCount: null
      };
    }
    if (!isPlainObject(raw)) {
      addIssue(context, 'error', path, 'plain_object_required', 'unlockConfig must be a plain object.');
      return {
        mode: DEFAULT_UNLOCK_CONFIG.mode,
        initialStatus: DEFAULT_UNLOCK_CONFIG.initialStatus,
        requiredMasteredRatio: null,
        requiredReviewingRatio: null,
        requiredGateCount: null
      };
    }
    checkUnknownFields(raw, new Set([
      'mode',
      'initialStatus',
      'requiredMasteredRatio',
      'requiredReviewingRatio',
      'requiredGateCount'
    ]), context, path);

    var mode = cleanEnum(raw.mode, UNLOCK_MODES, 'manual_placeholder', context, path + '.mode');
    var initialStatus = cleanEnum(raw.initialStatus, ['locked', 'available'], 'locked', context, path + '.initialStatus');
    ['requiredMasteredRatio', 'requiredReviewingRatio', 'requiredGateCount'].forEach(function requirePlaceholder(field) {
      if (hasOwn(raw, field) && raw[field] !== null && raw[field] !== undefined) {
        addIssue(context, 'error', path + '.' + field, 'unlock_rule_not_decided', 'Unlock thresholds must remain null placeholders.');
      }
    });
    return {
      mode: mode,
      initialStatus: initialStatus,
      requiredMasteredRatio: null,
      requiredReviewingRatio: null,
      requiredGateCount: null
    };
  }

  function makeResult(context, value) {
    return {
      ok: context.errors.length === 0,
      valid: context.errors.length === 0,
      value: value,
      errors: context.errors,
      warnings: context.warnings
    };
  }

  function getObjectInput(input, context, path) {
    inspectSafeValue(input, context, path);
    if (!isPlainObject(input)) {
      addIssue(context, 'error', path, 'plain_object_required', 'Expected a plain object.');
      return Object.create(null);
    }
    return input;
  }

  function validateWorld(input, options) {
    var settings = options || {};
    var path = settings.path || 'world';
    var context = createContext();
    var source = getObjectInput(input, context, path);
    checkUnknownFields(source, new Set([
      'schemaVersion', 'worldId', 'id', 'slug', 'title', 'subtitle', 'description',
      'icon', 'cover', 'theme', 'category', 'difficulty', 'languageFrom',
      'languageTo', 'status', 'version', 'rankCount', 'gateCount', 'wordCount',
      'order', 'isFeatured', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
    ]), context, path);

    var worldStatus = cleanEnum(source.status, CONTENT_STATUSES, 'draft', context, path + '.status');
    var output = {
      schemaVersion: cleanSchemaVersion(source.schemaVersion, context, path + '.schemaVersion'),
      worldId: resolveId(source, 'worldId', ['id'], settings.worldId, context, path + '.worldId'),
      slug: cleanSlug(source.slug, context, path + '.slug', worldStatus === 'published'),
      title: cleanString(source.title, { required: true, max: LIMITS.title, singleLine: true }, context, path + '.title'),
      subtitle: cleanString(source.subtitle, { max: LIMITS.subtitle, singleLine: true }, context, path + '.subtitle'),
      description: cleanString(source.description, { max: LIMITS.description }, context, path + '.description'),
      icon: cleanString(source.icon, { max: LIMITS.icon, singleLine: true }, context, path + '.icon'),
      cover: cleanUrl(source.cover, context, path + '.cover'),
      theme: cleanString(source.theme, { max: LIMITS.token, singleLine: true }, context, path + '.theme'),
      category: cleanString(source.category, { max: LIMITS.token, singleLine: true }, context, path + '.category'),
      difficulty: cleanString(source.difficulty, { max: LIMITS.token, singleLine: true }, context, path + '.difficulty'),
      languageFrom: cleanLanguage(source.languageFrom, context, path + '.languageFrom'),
      languageTo: cleanLanguage(source.languageTo, context, path + '.languageTo'),
      status: worldStatus,
      version: cleanInteger(source.version, 1, 1, LIMITS.count, context, path + '.version'),
      rankCount: cleanInteger(source.rankCount, 0, 0, LIMITS.count, context, path + '.rankCount'),
      gateCount: cleanInteger(source.gateCount, 0, 0, LIMITS.count, context, path + '.gateCount'),
      wordCount: cleanInteger(source.wordCount, 0, 0, LIMITS.count, context, path + '.wordCount'),
      order: cleanInteger(source.order, 0, 0, LIMITS.order, context, path + '.order'),
      isFeatured: cleanBoolean(source.isFeatured, false, context, path + '.isFeatured')
    };
    copyMetadata(source, output, context, path);
    return makeResult(context, output);
  }

  function validateRank(input, options) {
    var settings = options || {};
    var path = settings.path || 'rank';
    var context = createContext();
    var source = getObjectInput(input, context, path);
    checkUnknownFields(source, new Set([
      'schemaVersion', 'worldId', 'rankId', 'id', 'title', 'subtitle',
      'description', 'order', 'difficulty', 'cefrLevel', 'status', 'version', 'gateCount', 'wordCount',
      'unlockConfig', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
    ]), context, path);

    var output = {
      schemaVersion: cleanSchemaVersion(source.schemaVersion, context, path + '.schemaVersion'),
      worldId: resolveId(source, 'worldId', [], settings.worldId, context, path + '.worldId'),
      rankId: resolveId(source, 'rankId', ['id'], settings.rankId, context, path + '.rankId'),
      title: cleanString(source.title, { required: true, max: LIMITS.title, singleLine: true }, context, path + '.title'),
      subtitle: cleanString(source.subtitle, { max: LIMITS.subtitle, singleLine: true }, context, path + '.subtitle'),
      description: cleanString(source.description, { max: LIMITS.description }, context, path + '.description'),
      order: cleanInteger(source.order, 0, 0, LIMITS.order, context, path + '.order'),
      difficulty: cleanString(source.difficulty, { max: LIMITS.token, singleLine: true }, context, path + '.difficulty'),
      cefrLevel: cleanEnum(source.cefrLevel, CEFR_LEVELS, 'unclassified', context, path + '.cefrLevel'),
      status: cleanEnum(source.status, CONTENT_STATUSES, 'draft', context, path + '.status'),
      version: cleanInteger(source.version, 1, 1, LIMITS.count, context, path + '.version'),
      gateCount: cleanInteger(source.gateCount, 0, 0, LIMITS.count, context, path + '.gateCount'),
      wordCount: cleanInteger(source.wordCount, 0, 0, LIMITS.count, context, path + '.wordCount'),
      unlockConfig: cleanUnlockConfigInternal(source.unlockConfig, context, path + '.unlockConfig')
    };
    copyMetadata(source, output, context, path);
    return makeResult(context, output);
  }

  function validateGate(input, options) {
    var settings = options || {};
    var path = settings.path || 'gate';
    var context = createContext();
    var source = getObjectInput(input, context, path);
    checkUnknownFields(source, new Set([
      'schemaVersion', 'worldId', 'rankId', 'gateId', 'id', 'title', 'subtitle',
      'description', 'order', 'difficulty', 'status', 'version', 'wordCount',
      'entryAssessmentPassRatio',
      'unlockConfig', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
    ]), context, path);

    var output = {
      schemaVersion: cleanSchemaVersion(source.schemaVersion, context, path + '.schemaVersion'),
      worldId: resolveId(source, 'worldId', [], settings.worldId, context, path + '.worldId'),
      rankId: resolveId(source, 'rankId', [], settings.rankId, context, path + '.rankId'),
      gateId: resolveId(source, 'gateId', ['id'], settings.gateId, context, path + '.gateId'),
      title: cleanString(source.title, { required: true, max: LIMITS.title, singleLine: true }, context, path + '.title'),
      subtitle: cleanString(source.subtitle, { max: LIMITS.subtitle, singleLine: true }, context, path + '.subtitle'),
      description: cleanString(source.description, { max: LIMITS.description }, context, path + '.description'),
      order: cleanInteger(source.order, 0, 0, LIMITS.order, context, path + '.order'),
      difficulty: cleanString(source.difficulty, { max: LIMITS.token, singleLine: true }, context, path + '.difficulty'),
      status: cleanEnum(source.status, CONTENT_STATUSES, 'draft', context, path + '.status'),
      version: cleanInteger(source.version, 1, 1, LIMITS.count, context, path + '.version'),
      wordCount: cleanInteger(source.wordCount, 0, 0, LIMITS.count, context, path + '.wordCount'),
      entryAssessmentPassRatio: cleanEntryAssessmentPassRatio(
        source.entryAssessmentPassRatio,
        context,
        path + '.entryAssessmentPassRatio'
      ),
      unlockConfig: cleanUnlockConfigInternal(source.unlockConfig, context, path + '.unlockConfig')
    };
    copyMetadata(source, output, context, path);
    return makeResult(context, output);
  }

  function validateWord(input, options) {
    var settings = options || {};
    var path = settings.path || 'word';
    var context = createContext();
    var source = getObjectInput(input, context, path);
    checkUnknownFields(source, new Set([
      'schemaVersion', 'normalizationVersion', 'worldId', 'rankId', 'gateId',
      'contentWordId', 'wordId', 'id', 'word', 'normalizedWord', 'wordKey',
      'translation', 'definition', 'definition_ar', 'example', 'exampleTranslation',
      'category', 'partOfSpeech', 'level', 'tags', 'synonyms', 'pronunciation',
      'audioUrl', 'imageUrl', 'notes', 'order', 'status', 'version', 'createdAt', 'updatedAt',
      'createdBy', 'updatedBy'
    ]), context, path);

    var word = cleanString(source.word, {
      required: true,
      max: LIMITS.word,
      singleLine: true
    }, context, path + '.word');
    var identity = normalizeWordIdentity(word);
    if (hasOwn(source, 'normalizedWord') && source.normalizedWord !== identity.normalizedWord) {
      addIssue(context, 'error', path + '.normalizedWord', 'derived_identity_mismatch', 'normalizedWord must be generated by the central normalizer.');
    }
    if (hasOwn(source, 'wordKey') && source.wordKey !== identity.wordKey) {
      addIssue(context, 'error', path + '.wordKey', 'derived_identity_mismatch', 'wordKey must be generated by the current mastery-key normalizer.');
    }
    if (word && !identity.wordKey) {
      addIssue(context, 'error', path + '.word', 'empty_word_identity', 'Word has no usable mastery identity.');
    }

    var output = {
      schemaVersion: cleanSchemaVersion(source.schemaVersion, context, path + '.schemaVersion'),
      normalizationVersion: cleanNormalizationVersion(source.normalizationVersion, context, path + '.normalizationVersion'),
      worldId: resolveId(source, 'worldId', [], settings.worldId, context, path + '.worldId'),
      rankId: resolveId(source, 'rankId', [], settings.rankId, context, path + '.rankId'),
      gateId: resolveId(source, 'gateId', [], settings.gateId, context, path + '.gateId'),
      contentWordId: resolveId(source, 'contentWordId', ['wordId', 'id'], settings.contentWordId, context, path + '.contentWordId'),
      word: word,
      normalizedWord: identity.normalizedWord,
      wordKey: identity.wordKey,
      translation: cleanString(source.translation, { required: true, max: LIMITS.translation }, context, path + '.translation'),
      definition: cleanString(source.definition, { max: LIMITS.definition }, context, path + '.definition'),
      definition_ar: cleanString(source.definition_ar, { max: LIMITS.definition }, context, path + '.definition_ar'),
      example: cleanString(source.example, { max: LIMITS.example }, context, path + '.example'),
      exampleTranslation: cleanString(source.exampleTranslation, { max: LIMITS.example }, context, path + '.exampleTranslation'),
      category: cleanString(source.category, { max: LIMITS.token, singleLine: true }, context, path + '.category'),
      partOfSpeech: cleanString(source.partOfSpeech, { max: LIMITS.token, singleLine: true }, context, path + '.partOfSpeech'),
      level: cleanString(source.level, { max: LIMITS.token, singleLine: true }, context, path + '.level'),
      tags: cleanStringArray(source.tags, {
        maxItems: LIMITS.tags,
        maxLength: LIMITS.tag,
        identity: function tagIdentity(value) { return value.toLowerCase(); }
      }, context, path + '.tags'),
      synonyms: cleanStringArray(source.synonyms, {
        maxItems: LIMITS.synonyms,
        maxLength: LIMITS.synonym,
        identity: normalizeWord
      }, context, path + '.synonyms'),
      pronunciation: cleanString(source.pronunciation, { max: LIMITS.pronunciation, singleLine: true }, context, path + '.pronunciation'),
      audioUrl: cleanUrl(source.audioUrl, context, path + '.audioUrl'),
      imageUrl: cleanUrl(source.imageUrl, context, path + '.imageUrl'),
      notes: cleanString(source.notes, { max: LIMITS.notes }, context, path + '.notes'),
      order: cleanInteger(source.order, 0, 0, LIMITS.order, context, path + '.order'),
      status: cleanEnum(source.status, CONTENT_STATUSES, 'draft', context, path + '.status'),
      version: cleanInteger(source.version, 1, 1, LIMITS.count, context, path + '.version')
    };
    copyMetadata(source, output, context, path);
    return makeResult(context, output);
  }

  function validateContentSource(input, options) {
    var settings = options || {};
    var path = settings.path || 'contentSource';
    var context = createContext();
    var source = getObjectInput(input, context, path);
    checkUnknownFields(source, new Set([
      'worldId', 'rankId', 'gateId', 'contentWordId'
    ]), context, path);
    var output = {
      worldId: resolveId(source, 'worldId', [], settings.worldId, context, path + '.worldId'),
      rankId: resolveId(source, 'rankId', [], settings.rankId, context, path + '.rankId'),
      gateId: resolveId(source, 'gateId', [], settings.gateId, context, path + '.gateId'),
      contentWordId: resolveId(source, 'contentWordId', [], settings.contentWordId, context, path + '.contentWordId')
    };
    return makeResult(context, output);
  }

  function SchemaValidationError(message, diagnostics) {
    this.name = 'LootLinguaContentSchemaValidationError';
    this.message = message;
    this.diagnostics = diagnostics || [];
    if (Error.captureStackTrace) Error.captureStackTrace(this, SchemaValidationError);
  }
  SchemaValidationError.prototype = Object.create(Error.prototype);
  SchemaValidationError.prototype.constructor = SchemaValidationError;

  function cleanWith(validator, input, options) {
    var result = validator(input, options);
    if (!result.ok) {
      throw new SchemaValidationError('Content schema validation failed.', result.errors);
    }
    return result.value;
  }

  function cleanWorld(input, options) {
    return cleanWith(validateWorld, input, options);
  }

  function cleanRank(input, options) {
    return cleanWith(validateRank, input, options);
  }

  function cleanGate(input, options) {
    return cleanWith(validateGate, input, options);
  }

  function cleanWord(input, options) {
    return cleanWith(validateWord, input, options);
  }

  function cleanContentSource(input, options) {
    return cleanWith(validateContentSource, input, options);
  }

  function contentSourceKey(source) {
    return [
      source.worldId,
      source.rankId,
      source.gateId,
      source.contentWordId
    ].join('/');
  }

  function mergeContentSources(existing, additions) {
    var first = Array.isArray(existing) ? existing : [];
    var second = Array.isArray(additions) ? additions : [];
    var merged = [];
    var seen = new Set();
    first.concat(second).forEach(function mergeSource(source, index) {
      var clean = cleanContentSource(source, { path: 'contentSources[' + index + ']' });
      var key = contentSourceKey(clean);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(clean);
      }
    });
    return merged;
  }

  function omitKeys(input, keys) {
    var output = Object.create(null);
    if (!isPlainObject(input)) return output;
    Object.keys(input).forEach(function copyKey(key) {
      if (keys.indexOf(key) === -1) output[key] = input[key];
    });
    return output;
  }

  function appendValidation(targetContext, result) {
    Array.prototype.push.apply(targetContext.errors, result.errors);
    Array.prototype.push.apply(targetContext.warnings, result.warnings);
  }

  function getCollection(input, field, context, path, max, required) {
    if (!isPlainObject(input) || !hasOwn(input, field)) {
      if (required) {
        addIssue(context, 'error', path + '.' + field, 'missing_collection', 'Hierarchy collection is required.');
      }
      return [];
    }
    if (!Array.isArray(input[field])) {
      addIssue(context, 'error', path + '.' + field, 'array_required', 'Hierarchy collection must be an array.');
      return [];
    }
    if (input[field].length > max) {
      addIssue(context, 'error', path + '.' + field, 'import_limit_exceeded', 'Hierarchy collection exceeds the safe dry-run limit of ' + max + '.');
    }
    return input[field].slice(0, max);
  }

  function utf8ByteLength(value) {
    if (typeof root.TextEncoder === 'function') {
      return new root.TextEncoder().encode(value).length;
    }
    var bytes = 0;
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function parseImportInput(input, context) {
    if (typeof input !== 'string') return input;
    if (utf8ByteLength(input) > LIMITS.importBytes) {
      addIssue(context, 'error', '$', 'import_too_large', 'JSON import exceeds the safe byte limit.');
      return null;
    }
    try {
      return JSON.parse(input);
    } catch (error) {
      addIssue(context, 'error', '$', 'invalid_json', 'Import is not valid JSON.');
      return null;
    }
  }

  function getWorldsLoose(input) {
    if (Array.isArray(input)) return input;
    if (!isPlainObject(input)) return [];
    if (Array.isArray(input.worlds)) return input.worlds;
    if (hasOwn(input, 'worldId') || hasOwn(input, 'id') || hasOwn(input, 'ranks')) return [input];
    return [];
  }

  function readLooseId(input, names) {
    if (!isPlainObject(input)) return '';
    for (var index = 0; index < names.length; index += 1) {
      var value = input[names[index]];
      if (typeof value === 'string' && value) return value;
    }
    return '';
  }

  function compositeKey() {
    return Array.prototype.join.call(arguments, '\u001F');
  }

  function buildExistingIndex(existing) {
    var index = {
      worlds: new Set(),
      ranks: new Set(),
      gates: new Set(),
      words: new Set(),
      wordKeys: new Set()
    };
    getWorldsLoose(existing).forEach(function indexWorld(world) {
      var worldId = readLooseId(world, ['worldId', 'id']);
      if (worldId) index.worlds.add(worldId);
      var ranks = isPlainObject(world) && Array.isArray(world.ranks) ? world.ranks : [];
      ranks.forEach(function indexRank(rank) {
        var rankId = readLooseId(rank, ['rankId', 'id']);
        if (worldId && rankId) index.ranks.add(compositeKey(worldId, rankId));
        var gates = isPlainObject(rank) && Array.isArray(rank.gates) ? rank.gates : [];
        gates.forEach(function indexGate(gate) {
          var gateId = readLooseId(gate, ['gateId', 'id']);
          if (worldId && rankId && gateId) index.gates.add(compositeKey(worldId, rankId, gateId));
          var words = isPlainObject(gate) && Array.isArray(gate.words) ? gate.words : [];
          words.forEach(function indexWord(word) {
            var contentWordId = readLooseId(word, ['contentWordId', 'wordId', 'id']);
            if (worldId && rankId && gateId && contentWordId) {
              index.words.add(compositeKey(worldId, rankId, gateId, contentWordId));
            }
            var key = isPlainObject(word) && typeof word.wordKey === 'string'
              ? word.wordKey
              : getWordMasteryKey(isPlainObject(word) ? (word.word || word.text || '') : '');
            if (key) index.wordKeys.add(key);
          });
        });
      });
    });
    return index;
  }

  function addOccurrence(map, key, occurrence) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(occurrence);
  }

  function publicOccurrence(occurrence) {
    return {
      path: occurrence.path,
      worldId: occurrence.worldId,
      rankId: occurrence.rankId,
      gateId: occurrence.gateId,
      contentWordId: occurrence.contentWordId,
      wordKey: occurrence.wordKey
    };
  }

  function reportDuplicateMap(map, settings, context, duplicates) {
    map.forEach(function reportOccurrences(occurrences, key) {
      if (occurrences.length < 2) return;
      var distinct = new Set(occurrences.map(settings.distinct));
      if (distinct.size < 2 && settings.requireDistinct) return;
      var record = {
        scope: settings.scope,
        wordKey: occurrences[0].wordKey,
        occurrences: occurrences.map(publicOccurrence)
      };
      duplicates.push(record);
      occurrences.slice(1).forEach(function reportDuplicate(occurrence) {
        addIssue(context, settings.severity, occurrence.path + '.word', settings.code, settings.message);
      });
    });
  }

  function compareDeclaredCount(raw, field, actual, context, path) {
    if (!isPlainObject(raw) || !hasOwn(raw, field)) return;
    if (typeof raw[field] === 'number' && Number.isFinite(raw[field]) && raw[field] !== actual) {
      addIssue(context, 'warning', path + '.' + field, 'count_recalculated', field + ' was recalculated from the hierarchy.');
    }
  }

  function collisionSeverity(options) {
    return options && options.collisionPolicy === 'warning' ? 'warning' : 'error';
  }

  function reportCollision(collisions, context, severity, path, kind, key) {
    collisions.push({ path: path, kind: kind, key: key, severity: severity });
    addIssue(context, severity, path, 'existing_' + kind + '_collision', 'Import collides with an existing ' + kind + '.');
  }

  function dryRunImport(input, options) {
    var settings = options || {};
    var context = createContext();
    var parsed = parseImportInput(input, context);
    var output = {
      schemaVersion: SCHEMA_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
      worlds: []
    };
    var stats = { worlds: 0, ranks: 0, gates: 0, words: 0 };
    var duplicates = [];
    var collisions = [];

    if (parsed === null) {
      return {
        ok: false,
        canCommit: false,
        dryRun: true,
        value: output,
        stats: stats,
        duplicates: duplicates,
        collisions: collisions,
        errors: context.errors,
        warnings: context.warnings
      };
    }

    inspectSafeValue(parsed, context, '$');
    if (isPlainObject(parsed) && Array.isArray(parsed.worlds)) {
      checkUnknownFields(parsed, new Set([
        'format', 'schemaVersion', 'normalizationVersion', 'exportedAt', 'worlds'
      ]), context, '$');
      cleanSchemaVersion(parsed.schemaVersion, context, '$.schemaVersion');
      cleanNormalizationVersion(parsed.normalizationVersion, context, '$.normalizationVersion');
      if (hasOwn(parsed, 'format') && parsed.format !== 'lootlingua-content') {
        addIssue(context, 'error', '$.format', 'invalid_import_format', 'Expected lootlingua-content format.');
      }
    }

    var rawWorlds = getWorldsLoose(parsed);
    if (!rawWorlds.length) {
      addIssue(context, 'error', '$.worlds', 'missing_worlds', 'Import must contain at least one world.');
    }
    if (rawWorlds.length > LIMITS.importWorlds) {
      addIssue(context, 'error', '$.worlds', 'import_limit_exceeded', 'Import exceeds the safe world limit.');
    }
    rawWorlds = rawWorlds.slice(0, LIMITS.importWorlds);

    var existingIndex = buildExistingIndex(settings.existing);
    if (Array.isArray(settings.existingWordKeys)) {
      settings.existingWordKeys.forEach(function addExistingWordKey(key) {
        if (typeof key === 'string' && key) existingIndex.wordKeys.add(key);
      });
    }

    var worldIds = new Set();
    var gateWordMap = new Map();
    var rankWordMap = new Map();
    var worldWordMap = new Map();
    var globalWordMap = new Map();
    var severity = collisionSeverity(settings);

    rawWorlds.forEach(function processWorld(rawWorld, worldIndex) {
      var worldPath = '$.worlds[' + worldIndex + ']';
      var worldResult = validateWorld(omitKeys(rawWorld, ['ranks']), { path: worldPath });
      appendValidation(context, worldResult);
      var world = worldResult.value;
      world.ranks = [];
      stats.worlds += 1;

      if (world.worldId) {
        if (worldIds.has(world.worldId)) {
          addIssue(context, 'error', worldPath + '.worldId', 'duplicate_world_id', 'worldId is duplicated in this import.');
          duplicates.push({ scope: 'worldId', key: world.worldId, path: worldPath + '.worldId' });
        }
        worldIds.add(world.worldId);
        if (existingIndex.worlds.has(world.worldId)) {
          reportCollision(collisions, context, severity, worldPath + '.worldId', 'world_id', world.worldId);
        }
      }

      var rawRanks = getCollection(rawWorld, 'ranks', context, worldPath, LIMITS.ranksPerWorld, true);
      var rankIds = new Set();
      rawRanks.forEach(function processRank(rawRank, rankIndex) {
        var rankPath = worldPath + '.ranks[' + rankIndex + ']';
        var rankResult = validateRank(omitKeys(rawRank, ['gates']), {
          path: rankPath,
          worldId: world.worldId
        });
        appendValidation(context, rankResult);
        var rank = rankResult.value;
        rank.gates = [];
        stats.ranks += 1;

        if (rank.rankId) {
          if (rankIds.has(rank.rankId)) {
            addIssue(context, 'error', rankPath + '.rankId', 'duplicate_rank_id', 'rankId is duplicated inside this world.');
            duplicates.push({ scope: 'rankId', key: rank.rankId, path: rankPath + '.rankId' });
          }
          rankIds.add(rank.rankId);
          var rankComposite = compositeKey(world.worldId, rank.rankId);
          if (existingIndex.ranks.has(rankComposite)) {
            reportCollision(collisions, context, severity, rankPath + '.rankId', 'rank_id', rankComposite);
          }
        }

        var rawGates = getCollection(rawRank, 'gates', context, rankPath, LIMITS.gatesPerRank, true);
        var gateIds = new Set();
        rawGates.forEach(function processGate(rawGate, gateIndex) {
          var gatePath = rankPath + '.gates[' + gateIndex + ']';
          var gateResult = validateGate(omitKeys(rawGate, ['words']), {
            path: gatePath,
            worldId: world.worldId,
            rankId: rank.rankId
          });
          appendValidation(context, gateResult);
          var gate = gateResult.value;
          gate.words = [];
          stats.gates += 1;

          if (gate.gateId) {
            if (gateIds.has(gate.gateId)) {
              addIssue(context, 'error', gatePath + '.gateId', 'duplicate_gate_id', 'gateId is duplicated inside this rank.');
              duplicates.push({ scope: 'gateId', key: gate.gateId, path: gatePath + '.gateId' });
            }
            gateIds.add(gate.gateId);
            var gateComposite = compositeKey(world.worldId, rank.rankId, gate.gateId);
            if (existingIndex.gates.has(gateComposite)) {
              reportCollision(collisions, context, severity, gatePath + '.gateId', 'gate_id', gateComposite);
            }
          }

          var rawWords = getCollection(rawGate, 'words', context, gatePath, LIMITS.wordsPerGate, true);
          var contentWordIds = new Set();
          rawWords.forEach(function processWord(rawWord, wordIndex) {
            var wordPath = gatePath + '.words[' + wordIndex + ']';
            if (stats.words >= LIMITS.importWordsTotal) {
              if (stats.words === LIMITS.importWordsTotal) {
                addIssue(context, 'error', wordPath, 'import_limit_exceeded', 'Import exceeds the safe total word limit.');
              }
              return;
            }
            var wordResult = validateWord(rawWord, {
              path: wordPath,
              worldId: world.worldId,
              rankId: rank.rankId,
              gateId: gate.gateId
            });
            appendValidation(context, wordResult);
            var word = wordResult.value;
            gate.words.push(word);
            stats.words += 1;

            if (word.contentWordId) {
              if (contentWordIds.has(word.contentWordId)) {
                addIssue(context, 'error', wordPath + '.contentWordId', 'duplicate_content_word_id', 'contentWordId is duplicated inside this gate.');
                duplicates.push({ scope: 'contentWordId', key: word.contentWordId, path: wordPath + '.contentWordId' });
              }
              contentWordIds.add(word.contentWordId);
              var wordComposite = compositeKey(world.worldId, rank.rankId, gate.gateId, word.contentWordId);
              if (existingIndex.words.has(wordComposite)) {
                reportCollision(collisions, context, severity, wordPath + '.contentWordId', 'content_word_id', wordComposite);
              }
            }

            if (word.wordKey) {
              var occurrence = {
                path: wordPath,
                worldId: world.worldId,
                rankId: rank.rankId,
                gateId: gate.gateId,
                contentWordId: word.contentWordId,
                wordKey: word.wordKey
              };
              addOccurrence(gateWordMap, compositeKey(world.worldId, rank.rankId, gate.gateId, word.wordKey), occurrence);
              addOccurrence(rankWordMap, compositeKey(world.worldId, rank.rankId, word.wordKey), occurrence);
              addOccurrence(worldWordMap, compositeKey(world.worldId, word.wordKey), occurrence);
              addOccurrence(globalWordMap, word.wordKey, occurrence);
              if (existingIndex.wordKeys.has(word.wordKey)) {
                reportCollision(collisions, context, 'warning', wordPath + '.word', 'word_identity', word.wordKey);
              }
            }
          });

          compareDeclaredCount(rawGate, 'wordCount', gate.words.length, context, gatePath);
          gate.wordCount = gate.words.length;
          rank.gates.push(gate);
        });

        var rankWordCount = rank.gates.reduce(function countGateWords(total, gate) {
          return total + gate.words.length;
        }, 0);
        compareDeclaredCount(rawRank, 'gateCount', rank.gates.length, context, rankPath);
        compareDeclaredCount(rawRank, 'wordCount', rankWordCount, context, rankPath);
        rank.gateCount = rank.gates.length;
        rank.wordCount = rankWordCount;
        world.ranks.push(rank);
      });

      var worldGateCount = world.ranks.reduce(function countRankGates(total, rank) {
        return total + rank.gates.length;
      }, 0);
      var worldWordCount = world.ranks.reduce(function countRankWords(total, rank) {
        return total + rank.wordCount;
      }, 0);
      compareDeclaredCount(rawWorld, 'rankCount', world.ranks.length, context, worldPath);
      compareDeclaredCount(rawWorld, 'gateCount', worldGateCount, context, worldPath);
      compareDeclaredCount(rawWorld, 'wordCount', worldWordCount, context, worldPath);
      world.rankCount = world.ranks.length;
      world.gateCount = worldGateCount;
      world.wordCount = worldWordCount;
      output.worlds.push(world);
    });

    stats.ranks = output.worlds.reduce(function totalRanks(total, world) {
      return total + world.ranks.length;
    }, 0);
    stats.gates = output.worlds.reduce(function totalGates(total, world) {
      return total + world.gateCount;
    }, 0);

    reportDuplicateMap(gateWordMap, {
      scope: 'gate',
      severity: 'error',
      code: 'duplicate_word_in_gate',
      message: 'The same normalized word cannot appear twice in one gate.',
      requireDistinct: false,
      distinct: function sameGate(occurrence) { return occurrence.path; }
    }, context, duplicates);
    reportDuplicateMap(rankWordMap, {
      scope: 'rank',
      severity: 'warning',
      code: 'duplicate_word_in_rank',
      message: 'The same normalized word appears in multiple gates of this rank.',
      requireDistinct: true,
      distinct: function gateIdentity(occurrence) { return occurrence.gateId; }
    }, context, duplicates);
    reportDuplicateMap(worldWordMap, {
      scope: 'world',
      severity: 'warning',
      code: 'duplicate_word_in_world',
      message: 'The same normalized word appears in multiple ranks of this world.',
      requireDistinct: true,
      distinct: function rankIdentity(occurrence) { return occurrence.rankId; }
    }, context, duplicates);
    reportDuplicateMap(globalWordMap, {
      scope: 'global',
      severity: 'warning',
      code: 'duplicate_word_across_worlds',
      message: 'The same normalized word appears in multiple worlds.',
      requireDistinct: true,
      distinct: function worldIdentity(occurrence) { return occurrence.worldId; }
    }, context, duplicates);

    return {
      ok: context.errors.length === 0,
      canCommit: context.errors.length === 0,
      dryRun: true,
      value: output,
      stats: stats,
      duplicates: duplicates,
      collisions: collisions,
      errors: context.errors,
      warnings: context.warnings
    };
  }

  function validateSafeValue(value) {
    var context = createContext();
    inspectSafeValue(value, context, '$');
    return makeResult(context, value);
  }

  function compactForStorage(value) {
    if (Array.isArray(value)) {
      return value
        .map(compactForStorage)
        .filter(function keepArrayItem(item) {
          return item !== undefined && item !== '' && !(Array.isArray(item) && item.length === 0);
        });
    }
    if (!isPlainObject(value)) return value;
    var compacted = {};
    Object.keys(value).forEach(function compactField(key) {
      var item = compactForStorage(value[key]);
      if (item === undefined || item === '') return;
      if (Array.isArray(item) && item.length === 0) return;
      compacted[key] = item;
    });
    return compacted;
  }

  var API = deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    CONTENT_STATUSES: CONTENT_STATUSES,
    PROGRESS_STATUSES: PROGRESS_STATUSES,
    UNLOCK_MODES: UNLOCK_MODES,
    DEFAULT_UNLOCK_CONFIG: DEFAULT_UNLOCK_CONFIG,
    ENTRY_ASSESSMENT_DEFAULTS: ENTRY_ASSESSMENT_DEFAULTS,
    CEFR_LEVELS: CEFR_LEVELS,
    CEFR_LEVEL_META: CEFR_LEVEL_META,
    START_RANK_COPY: START_RANK_COPY,
    LIMITS: LIMITS,
    SchemaValidationError: SchemaValidationError,
    normalizeWord: normalizeWord,
    getWordMasteryKey: getWordMasteryKey,
    normalizeWordIdentity: normalizeWordIdentity,
    normalizeCefrLevel: normalizeCefrLevel,
    getCefrLevelOrder: getCefrLevelOrder,
    comparePublishedRanks: comparePublishedRanks,
    groupRanksByCefrLevel: groupRanksByCefrLevel,
    resolveEntryAssessmentPassRatio: resolveEntryAssessmentPassRatio,
    containsRawHtml: containsRawHtml,
    validateSafeValue: validateSafeValue,
    compactForStorage: compactForStorage,
    validateWorld: validateWorld,
    validateRank: validateRank,
    validateGate: validateGate,
    validateWord: validateWord,
    validateContentSource: validateContentSource,
    cleanWorld: cleanWorld,
    cleanRank: cleanRank,
    cleanGate: cleanGate,
    cleanWord: cleanWord,
    cleanContentSource: cleanContentSource,
    mergeContentSources: mergeContentSources,
    dryRunImport: dryRunImport
  });

  if (root.LootLinguaContentSchema) {
    if (root.LootLinguaContentSchema.schemaVersion === SCHEMA_VERSION) return;
    throw new Error('LootLinguaContentSchema is already defined with another version.');
  }

  Object.defineProperty(root, 'LootLinguaContentSchema', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false
  });
}(typeof window !== 'undefined' ? window : globalThis));
