(function attachLootLinguaAdminUi(root) {
  'use strict';

  const STATUS_LABELS = Object.freeze({
    draft: 'مسودة',
    published: 'منشور',
    archived: 'مؤرشف'
  });
  const EDITABLE_WORLD_FIELDS = Object.freeze([
    'slug', 'title', 'subtitle', 'description', 'icon', 'cover', 'theme',
    'category', 'difficulty', 'languageFrom', 'languageTo', 'order', 'isFeatured'
  ]);
  const EDITABLE_RANK_FIELDS = Object.freeze([
    'title', 'subtitle', 'description', 'order', 'difficulty', 'unlockConfig'
  ]);
  const EDITABLE_GATE_FIELDS = Object.freeze([
    'title', 'subtitle', 'description', 'order', 'difficulty',
    'entryAssessmentPassRatio', 'unlockConfig'
  ]);
  const EDITABLE_WORD_FIELDS = Object.freeze([
    'word', 'translation', 'definition', 'definition_ar', 'example',
    'exampleTranslation', 'category', 'partOfSpeech', 'level', 'tags',
    'synonyms', 'pronunciation', 'audioUrl', 'imageUrl', 'notes', 'order'
  ]);
  const WORD_PAGE_SIZE = 25;
  const MAX_BULK_WORDS = 100;
  const WORLD_DIRTY_WARNING = 'لديك تعديلات غير محفوظة في العالم. هل تريد مغادرة المحرر وفقدانها؟';
  const RANK_DIRTY_WARNING = 'لديك تعديلات غير محفوظة في الرتبة. هل تريد مغادرة المحرر وفقدانها؟';
  const GATE_DIRTY_WARNING = 'لديك تعديلات غير محفوظة في البوابة. هل تريد مغادرة المحرر وفقدانها؟';
  const WORD_DIRTY_WARNING = 'لديك تعديلات غير محفوظة في الكلمة. هل تريد مغادرة المحرر وفقدانها؟';

  const ui = {
    worlds: [],
    ranks: [],
    gates: [],
    words: [],
    view: 'dashboard',
    activeWorldId: '',
    activeRankId: '',
    activeGateId: '',
    loading: false,
    loadRevision: 0,
    pageError: '',
    ranksLoading: false,
    rankLoadRevision: 0,
    rankPageError: '',
    gatesLoading: false,
    gateLoadRevision: 0,
    gatePageError: '',
    wordsLoading: false,
    wordLoadRevision: 0,
    wordPageError: '',
    wordNextCursor: null,
    wordHasMore: false,
    selectedWordIds: new Set(),
    wordImportPending: false,
    modal: null,
    actionKeys: new Set(),
    lastAdminState: null,
    entryBound: false,
    accessCheckPending: false,
    returnView: 'personal',
    returnCustomWorldId: ''
  };

  function makeElement(tagName, className, textValue) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (textValue !== undefined && textValue !== null) node.textContent = String(textValue);
    return node;
  }

  function appendChildren(parent, children) {
    children.forEach((child) => {
      if (child !== undefined && child !== null) parent.append(child);
    });
    return parent;
  }

  function makeButton(label, action, options) {
    const settings = options || {};
    const button = makeElement('button', settings.className || 'admin-btn', label);
    button.type = settings.type || 'button';
    if (action) button.dataset.adminAction = action;
    if (settings.worldId) button.dataset.worldId = String(settings.worldId);
    if (settings.rankId) button.dataset.rankId = String(settings.rankId);
    if (settings.gateId) button.dataset.gateId = String(settings.gateId);
    if (settings.contentWordId) button.dataset.contentWordId = String(settings.contentWordId);
    if (settings.status) button.dataset.status = String(settings.status);
    if (settings.disabled) button.disabled = true;
    if (settings.title) button.title = settings.title;
    return button;
  }

  function shortenTechnicalValue(value, maxLength) {
    const text = String(value || '');
    const limit = Math.max(16, Number(maxLength) || 30);
    if (text.length <= limit) return text;
    const tailLength = 8;
    return `${text.slice(0, limit - tailLength - 1)}…${text.slice(-tailLength)}`;
  }

  function makeTechnicalCode(value, fallback, className) {
    const fullValue = String(value || fallback || '');
    const code = makeElement(
      'code',
      className || 'admin-world-id',
      shortenTechnicalValue(fullValue, 32)
    );
    code.title = fullValue;
    code.setAttribute('aria-label', fullValue);
    return code;
  }

  function getAdminRoot() {
    const container = document.getElementById('adminView');
    if (container) container.classList.add('admin-view');
    return container;
  }

  function getAdminState() {
    if (typeof root.getLootLinguaAdminState === 'function') {
      return root.getLootLinguaAdminState();
    }
    return { resolved: false, isAdmin: false, uid: null, errorCode: '' };
  }

  function getCloudApi() {
    const api = root.LootLinguaAdminCloud;
    const required = [
      'listWorlds', 'getWorld', 'createWorld', 'updateWorld',
      'setWorldStatus', 'requestDeleteWorld',
      'listRanks', 'getRank', 'createRank', 'updateRank', 'setRankStatus',
      'duplicateRankAsDraft', 'requestDeleteRank',
      'listGates', 'getGate', 'createGate', 'updateGate', 'setGateStatus',
      'duplicateGateAsDraft', 'moveGate', 'requestDeleteGate',
      'listWords', 'getWord', 'createWord', 'updateWord', 'setWordStatus',
      'inspectWordDuplicates',
      'archiveWord', 'duplicateWord', 'moveWord', 'bulkPublishWords',
      'bulkArchiveWords', 'bulkMoveWords', 'requestDeleteWord'
    ];
    if (!api || required.some((method) => typeof api[method] !== 'function')) {
      const error = new Error('admin/cloud-unavailable');
      error.code = 'admin/cloud-unavailable';
      throw error;
    }
    return api;
  }

  function getWordImportApi() {
    const api = root.LootLinguaAdminWordImport;
    const required = ['assertFileSize', 'parseJsonText', 'preparePreview', 'inspectDuplicates', 'commit'];
    if (!api || required.some((method) => typeof api[method] !== 'function')) {
      const error = new Error('admin/word-import-unavailable');
      error.code = 'admin/word-import-unavailable';
      throw error;
    }
    return api;
  }

  function getErrorCode(error, fallback) {
    const code = error && (error.code || error.name);
    return String(code || fallback || 'admin/unknown-error').slice(0, 160);
  }

  function notify(message, type, duration) {
    if (typeof root.showToast === 'function') {
      root.showToast(message, type || 'info', duration || 3600);
    }
  }

  function normalizeWorldRecord(record) {
    if (!record || typeof record !== 'object') return null;
    let data = record;
    if (typeof record.data === 'function') {
      data = record.data() || {};
      if (!data.worldId && record.id) data = { ...data, worldId: String(record.id) };
    }
    if (!data || typeof data !== 'object') return null;
    const normalized = {};
    [
      'schemaVersion', 'worldId', 'slug', 'title', 'subtitle', 'description',
      'icon', 'cover', 'theme', 'category', 'difficulty', 'languageFrom',
      'languageTo', 'status', 'version', 'rankCount', 'gateCount', 'wordCount',
      'order', 'isFeatured', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
    ].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(data, field)) normalized[field] = data[field];
    });
    return normalized;
  }

  function normalizeRankRecord(record, worldId) {
    if (!record || typeof record !== 'object') return null;
    let data = record;
    if (typeof record.data === 'function') {
      data = record.data() || {};
      if (!data.rankId && record.id) data = { ...data, rankId: String(record.id) };
    }
    if (!data || typeof data !== 'object') return null;
    const normalized = {};
    [
      'schemaVersion', 'worldId', 'rankId', 'title', 'subtitle', 'description',
      'order', 'difficulty', 'status', 'version', 'gateCount', 'wordCount',
      'unlockConfig', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
    ].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(data, field)) normalized[field] = data[field];
    });
    if (!normalized.worldId && worldId) normalized.worldId = String(worldId);
    return normalized;
  }

  function normalizeGateRecord(record, worldId, rankId) {
    if (!record || typeof record !== 'object') return null;
    let data = record;
    if (typeof record.data === 'function') {
      data = record.data() || {};
      if (!data.gateId && record.id) data = { ...data, gateId: String(record.id) };
    }
    if (!data || typeof data !== 'object') return null;
    const normalized = {};
    [
      'schemaVersion', 'worldId', 'rankId', 'gateId', 'title', 'subtitle',
      'description', 'order', 'difficulty', 'status', 'version', 'wordCount',
      'entryAssessmentPassRatio', 'unlockConfig', 'createdAt', 'updatedAt',
      'createdBy', 'updatedBy'
    ].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(data, field)) normalized[field] = data[field];
    });
    if (!normalized.worldId && worldId) normalized.worldId = String(worldId);
    if (!normalized.rankId && rankId) normalized.rankId = String(rankId);
    return normalized;
  }

  function normalizeWordRecord(record, worldId, rankId, gateId) {
    if (!record || typeof record !== 'object') return null;
    let data = record;
    if (typeof record.data === 'function') {
      data = record.data() || {};
      if (!data.contentWordId && record.id) data = { ...data, contentWordId: String(record.id) };
    }
    if (!data || typeof data !== 'object') return null;
    const normalized = {};
    [
      'schemaVersion', 'normalizationVersion', 'worldId', 'rankId', 'gateId',
      'contentWordId', 'word', 'normalizedWord', 'wordKey', 'translation',
      'definition', 'definition_ar', 'example', 'exampleTranslation', 'category',
      'partOfSpeech', 'level', 'tags', 'synonyms', 'pronunciation', 'audioUrl',
      'imageUrl', 'notes', 'order', 'status', 'version', 'createdAt', 'updatedAt',
      'createdBy', 'updatedBy', 'duplicateScopes', 'duplicateWarnings',
      'duplicateInRank', 'duplicateInWorld', 'warnings'
    ].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(data, field)) normalized[field] = data[field];
    });
    if (!normalized.worldId && worldId) normalized.worldId = String(worldId);
    if (!normalized.rankId && rankId) normalized.rankId = String(rankId);
    if (!normalized.gateId && gateId) normalized.gateId = String(gateId);
    return normalized;
  }

  function entryAssessmentDefaultRatio() {
    const schema = root.LootLinguaContentSchema;
    const ratio = Number(schema && schema.ENTRY_ASSESSMENT_DEFAULTS && schema.ENTRY_ASSESSMENT_DEFAULTS.passRatio);
    return Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : null;
  }

  function resolveEntryAssessmentRatio(gate) {
    const schema = root.LootLinguaContentSchema;
    if (schema && typeof schema.resolveEntryAssessmentPassRatio === 'function') {
      const ratio = Number(schema.resolveEntryAssessmentPassRatio(gate));
      if (Number.isFinite(ratio) && ratio > 0 && ratio <= 1) return ratio;
    }
    return entryAssessmentDefaultRatio();
  }

  function formatAssessmentPercent(ratio) {
    const value = Number(ratio);
    if (!Number.isFinite(value) || value <= 0 || value > 1) return 'غير متاح';
    return `${new Intl.NumberFormat('ar-JO', { maximumFractionDigits: 2 }).format(value * 100)}٪`;
  }

  function cachedCount(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function expectedVersion(world) {
    const version = Number(world && world.version);
    if (!Number.isSafeInteger(version) || version < 1) {
      const error = new Error('content/invalid-version');
      error.code = 'content/invalid-version';
      throw error;
    }
    return version;
  }

  function toDate(value) {
    if (!value) return null;
    try {
      if (typeof value.toDate === 'function') return value.toDate();
      if (typeof value.toMillis === 'function') return new Date(value.toMillis());
      const parsed = value instanceof Date ? value : new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch (error) {
      return null;
    }
  }

  function formatDate(value) {
    const date = toDate(value);
    if (!date) return 'غير متوفر';
    try {
      return new Intl.DateTimeFormat('ar-JO', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch (error) {
      return date.toISOString();
    }
  }

  function schemaReadyWorld(world) {
    const copy = { ...world };
    ['createdAt', 'updatedAt'].forEach((field) => {
      const date = toDate(copy[field]);
      if (date) copy[field] = date.toISOString();
    });
    return copy;
  }

  function collectSchemaErrors(worlds) {
    const schema = root.LootLinguaContentSchema;
    if (!schema || typeof schema.validateWorld !== 'function') {
      return [{ world: 'النظام', path: 'schema', code: 'schema/unavailable' }];
    }
    const errors = [];
    worlds.forEach((world) => {
      try {
        const result = schema.validateWorld(schemaReadyWorld(world));
        (result.errors || []).forEach((issue) => {
          errors.push({
            world: String(world.title || world.worldId || 'عالم بلا عنوان'),
            path: String(issue.path || 'world'),
            code: String(issue.code || 'schema/invalid')
          });
        });
      } catch (error) {
        errors.push({
          world: String(world.title || world.worldId || 'عالم بلا عنوان'),
          path: 'world',
          code: getErrorCode(error, 'schema/validation-failed')
        });
      }
    });
    return errors;
  }

  function renderAccessMessage(container, state) {
    container.replaceChildren();
    const card = makeElement('section', 'admin-state-card');
    card.setAttribute('role', 'status');
    if (!state.resolved) {
      appendChildren(card, [
        makeElement('span', 'admin-state-icon', '⏳'),
        makeElement('h2', 'admin-state-title', 'جارٍ التحقق من صلاحية الإدارة'),
        makeElement('p', 'admin-state-copy', 'نتحقق من رمز الدخول الحالي قبل عرض المحتوى الجاهز.')
      ]);
    } else if (!state.uid) {
      appendChildren(card, [
        makeElement('span', 'admin-state-icon', '🔒'),
        makeElement('h2', 'admin-state-title', 'يلزم تسجيل الدخول'),
        makeElement('p', 'admin-state-copy', 'سجّل الدخول بحساب إداري للوصول إلى إدارة المحتوى الجاهز.')
      ]);
    } else {
      appendChildren(card, [
        makeElement('span', 'admin-state-icon', '⛔'),
        makeElement('h2', 'admin-state-title', 'لا توجد صلاحية إدارة'),
        makeElement('p', 'admin-state-copy', 'هذا الحساب مسجّل، لكنه لا يحمل صلاحية admin=true.')
      ]);
      if (state.errorCode) {
        card.append(makeElement('code', 'admin-error-code', `رمز الخطأ: ${state.errorCode}`));
      }
    }
    container.append(card);
  }

  function makeMetric(label, value, note, tone) {
    const card = makeElement('article', `admin-metric admin-metric-${tone || 'neutral'}`);
    appendChildren(card, [
      makeElement('span', 'admin-metric-label', label),
      makeElement('strong', 'admin-metric-value', value),
      makeElement('small', 'admin-metric-note', note)
    ]);
    return card;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || 'حالة غير صالحة';
  }

  function makeStatusBadge(status) {
    const safeStatus = Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? status : 'invalid';
    return makeElement('span', `admin-status admin-status-${safeStatus}`, statusLabel(status));
  }

  function renderWorldRow(world) {
    const id = String(world.worldId || '');
    const busyPrefix = `world:${id}:`;
    const isBusy = Array.from(ui.actionKeys).some((key) => key.startsWith(busyPrefix));
    const row = makeElement('article', 'admin-world-row');

    const identity = makeElement('div', 'admin-world-identity');
    const titleLine = makeElement('div', 'admin-world-title-line');
    appendChildren(titleLine, [
      makeElement('h3', 'admin-world-title', world.title || 'عالم بلا عنوان'),
      makeStatusBadge(world.status)
    ]);
    appendChildren(identity, [
      titleLine,
      makeElement('p', 'admin-world-subtitle', world.subtitle || 'لا يوجد وصف مختصر.'),
      makeTechnicalCode(id, 'معرّف مفقود', 'admin-world-id'),
      makeElement('span', 'admin-world-meta', `الترتيب: ${cachedCount(world.order)} · آخر تعديل: ${formatDate(world.updatedAt || world.createdAt)}`)
    ]);

    const counts = makeElement('div', 'admin-world-counts');
    appendChildren(counts, [
      makeElement('span', 'admin-count-chip', `${cachedCount(world.rankCount)} رتبة`),
      makeElement('span', 'admin-count-chip', `${cachedCount(world.gateCount)} بوابة`),
      makeElement('span', 'admin-count-chip', `${cachedCount(world.wordCount)} كلمة`),
      makeElement('small', 'admin-count-note', 'أعداد مخزنة مؤقتًا · لم يتم التحقق')
    ]);

    const actions = makeElement('div', 'admin-world-actions');
    appendChildren(actions, [
      makeButton('إدارة الرتب', 'open-ranks', {
        className: 'admin-btn admin-btn-primary', worldId: id, disabled: isBusy
      }),
      makeButton('تعديل', 'edit-world', {
        className: 'admin-btn admin-btn-secondary', worldId: id, disabled: isBusy
      }),
      makeButton('نسخ بيانات العالم كمسودة', 'duplicate-world', {
        className: 'admin-btn admin-btn-secondary', worldId: id, disabled: isBusy
      })
    ]);

    if (world.status === 'draft') {
      actions.append(makeButton('نشر', 'set-world-status', {
        className: 'admin-btn admin-btn-success', worldId: id, status: 'published', disabled: isBusy
      }));
      actions.append(makeButton('أرشفة', 'set-world-status', {
        className: 'admin-btn admin-btn-warning', worldId: id, status: 'archived', disabled: isBusy
      }));
    } else if (world.status === 'published') {
      actions.append(makeButton('أرشفة', 'set-world-status', {
        className: 'admin-btn admin-btn-warning', worldId: id, status: 'archived', disabled: isBusy
      }));
    } else if (world.status === 'archived') {
      actions.append(makeButton('إعادة لمسودة', 'set-world-status', {
        className: 'admin-btn admin-btn-secondary', worldId: id, status: 'draft', disabled: isBusy
      }));
      actions.append(makeButton('حذف نهائي', 'delete-world', {
        className: 'admin-btn admin-btn-danger', worldId: id, disabled: isBusy
      }));
    }

    appendChildren(row, [identity, counts, actions]);
    return row;
  }

  function renderDashboard() {
    const container = getAdminRoot();
    if (!container) return;
    const state = getAdminState();
    if (!state.resolved || !state.isAdmin) {
      renderAccessMessage(container, state);
      return;
    }

    container.replaceChildren();
    const header = makeElement('header', 'admin-dashboard-header');
    const heading = makeElement('div', 'admin-dashboard-heading');
    appendChildren(heading, [
      makeElement('span', 'admin-kicker', 'إدارة المحتوى الجاهز'),
      makeElement('h2', 'admin-dashboard-title', 'العوالم'),
      makeElement('p', 'admin-dashboard-copy', 'أنشئ عالمًا وراجعه قبل النشر، ثم افتحه لتنظيم رتبه وإدارتها.')
    ]);
    const headerActions = makeElement('div', 'admin-header-actions');
    appendChildren(headerActions, [
      makeButton(ui.loading ? 'جارٍ التحديث…' : 'تحديث', 'refresh-worlds', {
        className: 'admin-btn admin-btn-secondary', disabled: ui.loading
      }),
      makeButton('إنشاء عالم', 'create-world', {
        className: 'admin-btn admin-btn-primary', disabled: ui.loading
      })
    ]);
    appendChildren(header, [heading, headerActions]);
    container.append(header);

    if (ui.pageError) {
      const errorBox = makeElement('div', 'admin-page-error', ui.pageError);
      errorBox.setAttribute('role', 'alert');
      container.append(errorBox);
    }

    if (ui.loading && ui.worlds.length === 0) {
      const loading = makeElement('div', 'admin-loading-card');
      loading.setAttribute('role', 'status');
      appendChildren(loading, [
        makeElement('span', 'admin-spinner', '⏳'),
        makeElement('span', 'admin-loading-label', 'جارٍ تحميل العوالم…')
      ]);
      container.append(loading);
      return;
    }

    const totals = ui.worlds.reduce((sum, world) => {
      sum.ranks += cachedCount(world.rankCount);
      sum.gates += cachedCount(world.gateCount);
      sum.words += cachedCount(world.wordCount);
      if (Object.prototype.hasOwnProperty.call(sum.statuses, world.status)) {
        sum.statuses[world.status] += 1;
      }
      return sum;
    }, { ranks: 0, gates: 0, words: 0, statuses: { draft: 0, published: 0, archived: 0 } });

    const metrics = makeElement('section', 'admin-metrics');
    metrics.setAttribute('aria-label', 'ملخص المحتوى');
    appendChildren(metrics, [
      makeMetric('العوالم', ui.worlds.length, `${totals.statuses.published} منشور · ${totals.statuses.draft} مسودة · ${totals.statuses.archived} مؤرشف`, 'worlds'),
      makeMetric('الرتب', totals.ranks, 'مخزن مؤقتًا · لم يتم التحقق', 'ranks'),
      makeMetric('البوابات', totals.gates, 'مخزن مؤقتًا · لم يتم التحقق', 'gates'),
      makeMetric('الكلمات', totals.words, 'مخزن مؤقتًا · لم يتم التحقق', 'words')
    ]);
    container.append(metrics);

    const integrity = makeElement('div', 'admin-integrity-note');
    appendChildren(integrity, [
      makeElement('strong', 'admin-integrity-title', 'مطابقة العدادات:'),
      makeElement('span', 'admin-integrity-value', 'لم يتم التحقق'),
      makeElement('span', 'admin-integrity-copy', 'ستُقارن هذه الأعداد بالمجموعات الفعلية عند إضافة أداة التدقيق الخلفية.')
    ]);
    container.append(integrity);

    const schemaErrors = collectSchemaErrors(ui.worlds);
    const sideGrid = makeElement('section', 'admin-insights-grid');
    const recentCard = makeElement('article', 'admin-insight-card');
    recentCard.append(makeElement('h3', 'admin-section-title', 'آخر التعديلات'));
    const recentList = makeElement('ol', 'admin-recent-list');
    const recentWorlds = [...ui.worlds]
      .sort((first, second) => {
        const firstDate = toDate(first.updatedAt || first.createdAt);
        const secondDate = toDate(second.updatedAt || second.createdAt);
        return (secondDate ? secondDate.getTime() : 0) - (firstDate ? firstDate.getTime() : 0);
      })
      .slice(0, 6);
    if (recentWorlds.length === 0) {
      recentList.append(makeElement('li', 'admin-empty-item', 'لا توجد تعديلات بعد.'));
    } else {
      recentWorlds.forEach((world) => {
        const item = makeElement('li', 'admin-recent-item');
        appendChildren(item, [
          makeElement('strong', 'admin-recent-title', world.title || world.worldId || 'عالم بلا عنوان'),
          makeElement('span', 'admin-recent-date', formatDate(world.updatedAt || world.createdAt))
        ]);
        recentList.append(item);
      });
    }
    recentCard.append(recentList);

    const schemaCard = makeElement('article', 'admin-insight-card');
    const schemaHeading = makeElement('div', 'admin-section-heading');
    appendChildren(schemaHeading, [
      makeElement('h3', 'admin-section-title', 'أخطاء المخطط'),
      makeElement('span', schemaErrors.length ? 'admin-error-count' : 'admin-ok-count', schemaErrors.length)
    ]);
    schemaCard.append(schemaHeading);
    const schemaList = makeElement('ul', 'admin-schema-list');
    if (schemaErrors.length === 0) {
      schemaList.append(makeElement('li', 'admin-schema-ok', 'لا توجد أخطاء مكتشفة في العوالم المحمّلة.'));
    } else {
      schemaErrors.slice(0, 12).forEach((issue) => {
        const item = makeElement('li', 'admin-schema-error');
        appendChildren(item, [
          makeElement('strong', 'admin-schema-world', issue.world),
          makeElement('code', 'admin-schema-code', `${issue.path} · ${issue.code}`)
        ]);
        schemaList.append(item);
      });
      if (schemaErrors.length > 12) {
        schemaList.append(makeElement('li', 'admin-schema-more', `و${schemaErrors.length - 12} خطأ إضافيًا.`));
      }
    }
    schemaCard.append(schemaList);
    appendChildren(sideGrid, [recentCard, schemaCard]);
    container.append(sideGrid);

    const worldsSection = makeElement('section', 'admin-worlds-section');
    const worldsHeading = makeElement('div', 'admin-section-heading');
    appendChildren(worldsHeading, [
      makeElement('h3', 'admin-section-title', 'قائمة العوالم'),
      makeElement('span', 'admin-list-count', ui.worlds.length)
    ]);
    worldsSection.append(worldsHeading);
    const list = makeElement('div', 'admin-worlds-list');
    if (ui.worlds.length === 0) {
      const empty = makeElement('div', 'admin-empty-state');
      appendChildren(empty, [
        makeElement('span', 'admin-empty-icon', '🌍'),
        makeElement('strong', 'admin-empty-title', 'لا توجد عوالم جاهزة بعد'),
        makeElement('p', 'admin-empty-copy', 'أنشئ أول عالم كمسودة، ثم راجعه قبل النشر.')
      ]);
      list.append(empty);
    } else {
      [...ui.worlds]
        .sort((first, second) => cachedCount(first.order) - cachedCount(second.order) || String(first.title || '').localeCompare(String(second.title || ''), 'ar'))
        .forEach((world) => list.append(renderWorldRow(world)));
    }
    worldsSection.append(list);
    container.append(worldsSection);
  }

  function makeAdminBreadcrumb(world, rankLabel) {
    const breadcrumb = makeElement('nav', 'admin-breadcrumb');
    breadcrumb.setAttribute('aria-label', 'مسار الإدارة');
    breadcrumb.append(makeButton('الإدارة', 'show-dashboard', {
      className: 'admin-breadcrumb-link'
    }));
    breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
    if (rankLabel !== undefined) {
      breadcrumb.append(makeButton(String(world && world.title || 'العالم'), 'open-ranks', {
        className: 'admin-breadcrumb-link',
        worldId: String(world && world.worldId || '')
      }));
      breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
      const currentRank = makeElement('span', 'admin-breadcrumb-current', rankLabel || 'الرتبة');
      currentRank.setAttribute('aria-current', 'page');
      breadcrumb.append(currentRank);
    } else {
      const currentWorld = makeElement('span', 'admin-breadcrumb-current', String(world && world.title || 'العالم'));
      currentWorld.setAttribute('aria-current', 'page');
      breadcrumb.append(currentWorld);
    }
    return breadcrumb;
  }

  function makeGateBreadcrumb(world, rank, gateLabel) {
    const breadcrumb = makeElement('nav', 'admin-breadcrumb');
    breadcrumb.setAttribute('aria-label', 'مسار الإدارة');
    breadcrumb.append(makeButton('الإدارة', 'show-dashboard', {
      className: 'admin-breadcrumb-link'
    }));
    breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
    breadcrumb.append(makeButton(String(world && world.title || 'العالم'), 'open-ranks', {
      className: 'admin-breadcrumb-link',
      worldId: String(world && world.worldId || '')
    }));
    breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
    if (gateLabel !== undefined) {
      breadcrumb.append(makeButton(String(rank && rank.title || 'الرتبة'), 'open-gates', {
        className: 'admin-breadcrumb-link',
        worldId: String(world && world.worldId || ''),
        rankId: String(rank && rank.rankId || '')
      }));
      breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
      const currentGate = makeElement('span', 'admin-breadcrumb-current', gateLabel || 'البوابة');
      currentGate.setAttribute('aria-current', 'page');
      breadcrumb.append(currentGate);
    } else {
      const currentRank = makeElement('span', 'admin-breadcrumb-current', String(rank && rank.title || 'الرتبة'));
      currentRank.setAttribute('aria-current', 'page');
      breadcrumb.append(currentRank);
    }
    return breadcrumb;
  }

  function makeWordBreadcrumb(world, rank, gate, wordLabel) {
    const breadcrumb = makeElement('nav', 'admin-breadcrumb admin-word-breadcrumb');
    breadcrumb.setAttribute('aria-label', 'مسار إدارة الكلمات');
    breadcrumb.append(makeButton('الإدارة', 'show-dashboard', {
      className: 'admin-breadcrumb-link'
    }));
    breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
    breadcrumb.append(makeButton(String(world && world.title || 'العالم'), 'open-ranks', {
      className: 'admin-breadcrumb-link',
      worldId: String(world && world.worldId || '')
    }));
    breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
    breadcrumb.append(makeButton(String(rank && rank.title || 'الرتبة'), 'open-gates', {
      className: 'admin-breadcrumb-link',
      worldId: String(world && world.worldId || ''),
      rankId: String(rank && rank.rankId || '')
    }));
    breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
    if (wordLabel !== undefined) {
      breadcrumb.append(makeButton(String(gate && gate.title || 'البوابة'), 'open-words', {
        className: 'admin-breadcrumb-link',
        worldId: String(world && world.worldId || ''),
        rankId: String(rank && rank.rankId || ''),
        gateId: String(gate && gate.gateId || '')
      }));
      breadcrumb.append(makeElement('span', 'admin-breadcrumb-separator', '←'));
      const currentWord = makeElement('span', 'admin-breadcrumb-current', wordLabel || 'الكلمة');
      currentWord.setAttribute('aria-current', 'page');
      breadcrumb.append(currentWord);
    } else {
      const currentGate = makeElement('span', 'admin-breadcrumb-current', String(gate && gate.title || 'البوابة'));
      currentGate.setAttribute('aria-current', 'page');
      breadcrumb.append(currentGate);
    }
    return breadcrumb;
  }

  function renderRankRow(rank, world) {
    const worldId = String(world.worldId || '');
    const rankId = String(rank.rankId || '');
    const busyPrefix = `rank:${worldId}:${rankId}:`;
    const isBusy = Array.from(ui.actionKeys).some((key) => key.startsWith(busyPrefix));
    const row = makeElement('article', 'admin-world-row admin-rank-row');

    const identity = makeElement('div', 'admin-world-identity admin-rank-identity');
    const titleLine = makeElement('div', 'admin-world-title-line');
    appendChildren(titleLine, [
      makeElement('h3', 'admin-world-title', rank.title || 'رتبة بلا عنوان'),
      makeStatusBadge(rank.status)
    ]);
    appendChildren(identity, [
      titleLine,
      makeElement('p', 'admin-world-subtitle', rank.subtitle || 'لا يوجد وصف مختصر.'),
      makeTechnicalCode(rankId, 'معرّف مفقود', 'admin-world-id'),
      makeElement('span', 'admin-world-meta', `الترتيب: ${cachedCount(rank.order)} · الإصدار: ${String(rank.version || 'غير صالح')} · آخر تعديل: ${formatDate(rank.updatedAt || rank.createdAt)}`)
    ]);

    const counts = makeElement('div', 'admin-world-counts');
    appendChildren(counts, [
      makeElement('span', 'admin-count-chip', `${cachedCount(rank.gateCount)} بوابة`),
      makeElement('span', 'admin-count-chip', `${cachedCount(rank.wordCount)} كلمة`),
      makeElement('small', 'admin-count-note', 'أعداد مخزنة مؤقتًا · لم يتم التحقق')
    ]);

    const actions = makeElement('div', 'admin-world-actions');
    appendChildren(actions, [
      makeButton('إدارة البوابات', 'open-gates', {
        className: 'admin-btn admin-btn-primary', worldId, rankId, disabled: isBusy
      }),
      makeButton('تعديل', 'edit-rank', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, disabled: isBusy
      }),
      makeButton('نسخ كمسودة', 'duplicate-rank', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, disabled: isBusy
      })
    ]);
    if (rank.status === 'draft') {
      actions.append(makeButton('نشر', 'set-rank-status', {
        className: 'admin-btn admin-btn-success', worldId, rankId, status: 'published', disabled: isBusy
      }));
      actions.append(makeButton('أرشفة', 'set-rank-status', {
        className: 'admin-btn admin-btn-warning', worldId, rankId, status: 'archived', disabled: isBusy
      }));
    } else if (rank.status === 'published') {
      actions.append(makeButton('أرشفة', 'set-rank-status', {
        className: 'admin-btn admin-btn-warning', worldId, rankId, status: 'archived', disabled: isBusy
      }));
    } else if (rank.status === 'archived') {
      actions.append(makeButton('إعادة لمسودة', 'set-rank-status', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, status: 'draft', disabled: isBusy
      }));
      actions.append(makeButton('حذف نهائي', 'delete-rank', {
        className: 'admin-btn admin-btn-danger', worldId, rankId, disabled: isBusy
      }));
    }

    appendChildren(row, [identity, counts, actions]);
    return row;
  }

  function renderRanks() {
    const container = getAdminRoot();
    if (!container) return;
    const state = getAdminState();
    if (!state.resolved || !state.isAdmin) {
      renderAccessMessage(container, state);
      return;
    }
    const world = findWorld(ui.activeWorldId);
    if (!world) {
      ui.view = 'dashboard';
      ui.activeWorldId = '';
      ui.pageError = 'تعذر فتح العالم لإدارة رتبه. رمز الخطأ: content/world-not-found';
      renderDashboard();
      return;
    }

    container.replaceChildren();
    container.append(makeAdminBreadcrumb(world));
    const header = makeElement('header', 'admin-dashboard-header admin-ranks-header');
    const heading = makeElement('div', 'admin-dashboard-heading');
    appendChildren(heading, [
      makeElement('span', 'admin-kicker', 'إدارة رتب العالم'),
      makeElement('h2', 'admin-dashboard-title', String(world.title || 'عالم بلا عنوان')),
      makeElement('p', 'admin-dashboard-copy', 'أنشئ الرتب، رتّبها من الأسهل إلى الأصعب، ثم راجع كل رتبة قبل نشرها.')
    ]);
    const headerActions = makeElement('div', 'admin-header-actions');
    appendChildren(headerActions, [
      makeButton('العودة للعوالم', 'show-dashboard', {
        className: 'admin-btn admin-btn-secondary', disabled: ui.ranksLoading
      }),
      makeButton(ui.ranksLoading ? 'جارٍ التحديث…' : 'تحديث الرتب', 'refresh-ranks', {
        className: 'admin-btn admin-btn-secondary', worldId: world.worldId, disabled: ui.ranksLoading
      }),
      makeButton('إنشاء رتبة', 'create-rank', {
        className: 'admin-btn admin-btn-primary', worldId: world.worldId, disabled: ui.ranksLoading
      })
    ]);
    appendChildren(header, [heading, headerActions]);
    container.append(header);

    if (ui.rankPageError) {
      const errorBox = makeElement('div', 'admin-page-error', ui.rankPageError);
      errorBox.setAttribute('role', 'alert');
      container.append(errorBox);
    }
    if (ui.ranksLoading && ui.ranks.length === 0) {
      const loading = makeElement('div', 'admin-loading-card');
      loading.setAttribute('role', 'status');
      appendChildren(loading, [
        makeElement('span', 'admin-spinner', '⏳'),
        makeElement('span', 'admin-loading-label', 'جارٍ تحميل رتب العالم…')
      ]);
      container.append(loading);
      return;
    }

    const totals = ui.ranks.reduce((sum, rank) => {
      sum.gates += cachedCount(rank.gateCount);
      sum.words += cachedCount(rank.wordCount);
      if (Object.prototype.hasOwnProperty.call(sum.statuses, rank.status)) sum.statuses[rank.status] += 1;
      return sum;
    }, { gates: 0, words: 0, statuses: { draft: 0, published: 0, archived: 0 } });
    const metrics = makeElement('section', 'admin-metrics admin-rank-metrics');
    metrics.setAttribute('aria-label', 'ملخص رتب العالم');
    appendChildren(metrics, [
      makeMetric('الرتب', ui.ranks.length, `${totals.statuses.published} منشور · ${totals.statuses.draft} مسودة · ${totals.statuses.archived} مؤرشف`, 'ranks'),
      makeMetric('البوابات', totals.gates, 'مخزن مؤقتًا · لم يتم التحقق', 'gates'),
      makeMetric('الكلمات', totals.words, 'مخزن مؤقتًا · لم يتم التحقق', 'words')
    ]);
    container.append(metrics);

    const section = makeElement('section', 'admin-worlds-section admin-ranks-section');
    const sectionHeading = makeElement('div', 'admin-section-heading');
    appendChildren(sectionHeading, [
      makeElement('h3', 'admin-section-title', 'قائمة الرتب'),
      makeElement('span', 'admin-list-count', ui.ranks.length)
    ]);
    section.append(sectionHeading);
    const list = makeElement('div', 'admin-worlds-list admin-ranks-list');
    if (ui.ranks.length === 0) {
      const empty = makeElement('div', 'admin-empty-state');
      appendChildren(empty, [
        makeElement('span', 'admin-empty-icon', '🏅'),
        makeElement('strong', 'admin-empty-title', 'لا توجد رتب في هذا العالم'),
        makeElement('p', 'admin-empty-copy', 'أنشئ الرتبة الأولى كمسودة، ثم راجعها قبل النشر.')
      ]);
      list.append(empty);
    } else {
      [...ui.ranks]
        .sort((first, second) => cachedCount(first.order) - cachedCount(second.order) || String(first.title || '').localeCompare(String(second.title || ''), 'ar'))
        .forEach((rank) => list.append(renderRankRow(rank, world)));
    }
    section.append(list);
    container.append(section);
  }

  function renderGateRow(gate, world, rank) {
    const worldId = String(world.worldId || '');
    const rankId = String(rank.rankId || '');
    const gateId = String(gate.gateId || '');
    const busyPrefix = `gate:${worldId}:${rankId}:${gateId}:`;
    const isBusy = Array.from(ui.actionKeys).some((key) => key.startsWith(busyPrefix));
    const row = makeElement('article', 'admin-world-row admin-gate-row');

    const identity = makeElement('div', 'admin-world-identity admin-gate-identity');
    const titleLine = makeElement('div', 'admin-world-title-line');
    appendChildren(titleLine, [
      makeElement('h3', 'admin-world-title', gate.title || 'بوابة بلا عنوان'),
      makeStatusBadge(gate.status)
    ]);
    appendChildren(identity, [
      titleLine,
      makeElement('p', 'admin-world-subtitle', gate.subtitle || 'لا يوجد وصف مختصر.'),
      makeTechnicalCode(gateId, 'معرّف مفقود', 'admin-world-id'),
      makeElement('span', 'admin-world-meta', `الترتيب: ${cachedCount(gate.order)} · الإصدار: ${String(gate.version || 'غير صالح')} · آخر تعديل: ${formatDate(gate.updatedAt || gate.createdAt)}`)
    ]);

    const counts = makeElement('div', 'admin-world-counts admin-gate-counts');
    const usesDefault = gate.entryAssessmentPassRatio === null || gate.entryAssessmentPassRatio === undefined;
    appendChildren(counts, [
      makeElement('span', 'admin-count-chip', `${cachedCount(gate.wordCount)} كلمة`),
      makeElement('span', 'admin-threshold-chip', `عتبة الدخول: ${formatAssessmentPercent(resolveEntryAssessmentRatio(gate))}${usesDefault ? ' · افتراضية' : ' · خاصة'}`),
      makeElement('small', 'admin-count-note', 'عدد مخزن مؤقتًا · لم يتم التحقق')
    ]);

    const actions = makeElement('div', 'admin-world-actions');
    appendChildren(actions, [
      makeButton('إدارة الكلمات', 'open-words', {
        className: 'admin-btn admin-btn-primary', worldId, rankId, gateId, disabled: isBusy
      }),
      makeButton('تعديل', 'edit-gate', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, gateId, disabled: isBusy
      }),
      makeButton('نقل', 'move-gate', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, gateId, disabled: isBusy
      }),
      makeButton('نسخ كمسودة', 'duplicate-gate', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, gateId, disabled: isBusy
      })
    ]);
    if (gate.status === 'draft') {
      actions.append(makeButton('نشر', 'set-gate-status', {
        className: 'admin-btn admin-btn-success', worldId, rankId, gateId, status: 'published', disabled: isBusy
      }));
      actions.append(makeButton('أرشفة', 'set-gate-status', {
        className: 'admin-btn admin-btn-warning', worldId, rankId, gateId, status: 'archived', disabled: isBusy
      }));
    } else if (gate.status === 'published') {
      actions.append(makeButton('أرشفة', 'set-gate-status', {
        className: 'admin-btn admin-btn-warning', worldId, rankId, gateId, status: 'archived', disabled: isBusy
      }));
    } else if (gate.status === 'archived') {
      actions.append(makeButton('إعادة لمسودة', 'set-gate-status', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, gateId, status: 'draft', disabled: isBusy
      }));
      actions.append(makeButton('حذف نهائي', 'delete-gate', {
        className: 'admin-btn admin-btn-danger', worldId, rankId, gateId, disabled: isBusy
      }));
    }

    appendChildren(row, [identity, counts, actions]);
    return row;
  }

  function renderGates() {
    const container = getAdminRoot();
    if (!container) return;
    const state = getAdminState();
    if (!state.resolved || !state.isAdmin) {
      renderAccessMessage(container, state);
      return;
    }
    const world = findWorld(ui.activeWorldId);
    const rank = findRank(ui.activeRankId);
    if (!world || !rank) {
      ui.gateLoadRevision += 1;
      ui.gatesLoading = false;
      ui.gates = [];
      ui.activeRankId = '';
      if (world) {
        ui.view = 'ranks';
        ui.rankPageError = 'تعذر فتح الرتبة لإدارة بواباتها. رمز الخطأ: content/rank-not-found';
        renderRanks();
      } else {
        ui.view = 'dashboard';
        ui.activeWorldId = '';
        ui.pageError = 'تعذر فتح العالم لإدارة بواباته. رمز الخطأ: content/world-not-found';
        renderDashboard();
      }
      return;
    }

    container.replaceChildren();
    container.append(makeGateBreadcrumb(world, rank));
    const header = makeElement('header', 'admin-dashboard-header admin-gates-header');
    const heading = makeElement('div', 'admin-dashboard-heading');
    appendChildren(heading, [
      makeElement('span', 'admin-kicker', 'إدارة بوابات الرتبة'),
      makeElement('h2', 'admin-dashboard-title', String(rank.title || 'رتبة بلا عنوان')),
      makeElement('p', 'admin-dashboard-copy', `رتّب البوابات وراجعها قبل النشر. عتبة اختبار الدخول الافتراضية المركزية هي ${formatAssessmentPercent(entryAssessmentDefaultRatio())}.`)
    ]);
    const headerActions = makeElement('div', 'admin-header-actions');
    appendChildren(headerActions, [
      makeButton('العودة للرتب', 'open-ranks', {
        className: 'admin-btn admin-btn-secondary', worldId: world.worldId, disabled: ui.gatesLoading
      }),
      makeButton(ui.gatesLoading ? 'جارٍ التحديث…' : 'تحديث البوابات', 'refresh-gates', {
        className: 'admin-btn admin-btn-secondary', worldId: world.worldId, rankId: rank.rankId, disabled: ui.gatesLoading
      }),
      makeButton('إنشاء بوابة', 'create-gate', {
        className: 'admin-btn admin-btn-primary', worldId: world.worldId, rankId: rank.rankId, disabled: ui.gatesLoading
      })
    ]);
    appendChildren(header, [heading, headerActions]);
    container.append(header);

    const assessmentNote = makeElement('aside', 'admin-assessment-note');
    assessmentNote.setAttribute('role', 'note');
    appendChildren(assessmentNote, [
      makeElement('strong', 'admin-assessment-note-title', 'عتبة اختبار الدخول فقط'),
      makeElement('span', 'admin-assessment-note-copy', 'تحدد هذه العتبة نتيجة تقييم الدخول إلى البوابة، ولا تمنح XP أو إتقانًا. منطق فتح المحتوى بعد التعلّم لم يُحسم بعد.')
    ]);
    container.append(assessmentNote);

    if (ui.gatePageError) {
      const errorBox = makeElement('div', 'admin-page-error', ui.gatePageError);
      errorBox.setAttribute('role', 'alert');
      container.append(errorBox);
    }
    if (ui.gatesLoading && ui.gates.length === 0) {
      const loading = makeElement('div', 'admin-loading-card');
      loading.setAttribute('role', 'status');
      appendChildren(loading, [
        makeElement('span', 'admin-spinner', '⏳'),
        makeElement('span', 'admin-loading-label', 'جارٍ تحميل بوابات الرتبة…')
      ]);
      container.append(loading);
      return;
    }

    const totals = ui.gates.reduce((sum, gate) => {
      sum.words += cachedCount(gate.wordCount);
      if (Object.prototype.hasOwnProperty.call(sum.statuses, gate.status)) sum.statuses[gate.status] += 1;
      return sum;
    }, { words: 0, statuses: { draft: 0, published: 0, archived: 0 } });
    const metrics = makeElement('section', 'admin-metrics admin-gate-metrics');
    metrics.setAttribute('aria-label', 'ملخص بوابات الرتبة');
    appendChildren(metrics, [
      makeMetric('البوابات', ui.gates.length, `${totals.statuses.published} منشور · ${totals.statuses.draft} مسودة · ${totals.statuses.archived} مؤرشف`, 'gates'),
      makeMetric('الكلمات', totals.words, 'مخزن مؤقتًا · لم يتم التحقق', 'words'),
      makeMetric('عتبة الدخول الافتراضية', formatAssessmentPercent(entryAssessmentDefaultRatio()), 'إعداد مركزي · يمكن تخصيصه لكل بوابة', 'assessment')
    ]);
    container.append(metrics);

    const section = makeElement('section', 'admin-worlds-section admin-gates-section');
    const sectionHeading = makeElement('div', 'admin-section-heading');
    appendChildren(sectionHeading, [
      makeElement('h3', 'admin-section-title', 'قائمة البوابات'),
      makeElement('span', 'admin-list-count', ui.gates.length)
    ]);
    section.append(sectionHeading);
    const list = makeElement('div', 'admin-worlds-list admin-gates-list');
    if (ui.gates.length === 0) {
      const empty = makeElement('div', 'admin-empty-state');
      appendChildren(empty, [
        makeElement('span', 'admin-empty-icon', '🚪'),
        makeElement('strong', 'admin-empty-title', 'لا توجد بوابات في هذه الرتبة'),
        makeElement('p', 'admin-empty-copy', 'أنشئ البوابة الأولى كمسودة، ثم أضف كلماتها وراجعها قبل النشر.')
      ]);
      list.append(empty);
    } else {
      [...ui.gates]
        .sort((first, second) => cachedCount(first.order) - cachedCount(second.order) || String(first.title || '').localeCompare(String(second.title || ''), 'ar'))
        .forEach((gate) => list.append(renderGateRow(gate, world, rank)));
    }
    section.append(list);
    container.append(section);
  }

  function collectWordDuplicateScopes(word) {
    const scopes = new Set();
    const addScope = (value) => {
      const text = String(value || '').toLowerCase();
      if (text.includes('rank') || text.includes('رتبة')) scopes.add('rank');
      if (text.includes('world') || text.includes('عالم')) scopes.add('world');
    };
    if (word && word.duplicateInRank) scopes.add('rank');
    if (word && word.duplicateInWorld) scopes.add('world');
    [word && word.duplicateScopes, word && word.duplicateWarnings, word && word.warnings]
      .filter(Array.isArray)
      .flat()
      .forEach((warning) => {
        if (warning && typeof warning === 'object') {
          addScope(warning.scope);
          addScope(warning.code);
        } else {
          addScope(warning);
        }
      });
    return Array.from(scopes);
  }

  function renderWordRow(word, world, rank, gate) {
    const worldId = String(world.worldId || '');
    const rankId = String(rank.rankId || '');
    const gateId = String(gate.gateId || '');
    const contentWordId = String(word.contentWordId || '');
    const busyPrefix = `word:${worldId}:${rankId}:${gateId}:${contentWordId}:`;
    const isBusy = Array.from(ui.actionKeys).some((key) => key.startsWith(busyPrefix));
    const row = makeElement('article', 'admin-world-row admin-word-row');
    row.dataset.contentWordId = contentWordId;

    const selection = makeElement('label', 'admin-word-selection');
    const checkbox = makeElement('input', 'admin-checkbox admin-word-checkbox');
    checkbox.type = 'checkbox';
    checkbox.checked = ui.selectedWordIds.has(contentWordId);
    checkbox.disabled = isBusy || ui.wordsLoading;
    checkbox.dataset.adminAction = 'toggle-word-selection';
    checkbox.dataset.worldId = worldId;
    checkbox.dataset.rankId = rankId;
    checkbox.dataset.gateId = gateId;
    checkbox.dataset.contentWordId = contentWordId;
    checkbox.setAttribute('aria-label', `تحديد الكلمة ${String(word.word || '')}`);
    selection.append(checkbox);

    const identity = makeElement('div', 'admin-world-identity admin-word-identity');
    const titleLine = makeElement('div', 'admin-world-title-line');
    appendChildren(titleLine, [
      makeElement('h3', 'admin-world-title admin-word-title', word.word || 'كلمة بلا نص'),
      makeStatusBadge(word.status)
    ]);
    appendChildren(identity, [
      titleLine,
      makeElement('p', 'admin-world-subtitle admin-word-translation', word.translation || 'لا توجد ترجمة.'),
      makeTechnicalCode(
        word.normalizedWord || contentWordId,
        'معرّف مفقود',
        'admin-world-id admin-word-technical-value'
      ),
      makeElement('span', 'admin-world-meta', `الترتيب: ${cachedCount(word.order)} · الإصدار: ${String(word.version || 'غير صالح')} · النوع: ${String(word.partOfSpeech || 'غير محدد')} · آخر تعديل: ${formatDate(word.updatedAt || word.createdAt)}`)
    ]);
    const duplicateScopes = collectWordDuplicateScopes(word);
    if (duplicateScopes.length) {
      const warning = makeElement('div', 'admin-word-duplicate-warning');
      warning.setAttribute('role', 'note');
      warning.append(makeElement('strong', '', 'تنبيه تكرار:'));
      if (duplicateScopes.includes('rank')) warning.append(makeElement('span', 'admin-duplicate-chip', 'داخل الرتبة'));
      if (duplicateScopes.includes('world')) warning.append(makeElement('span', 'admin-duplicate-chip', 'داخل العالم'));
      identity.append(warning);
    }

    const details = makeElement('div', 'admin-world-counts admin-word-details');
    const identifierNote = makeElement('small', 'admin-count-note admin-word-id-note');
    appendChildren(identifierNote, [
      document.createTextNode('المعرّف: '),
      makeTechnicalCode(
        contentWordId,
        'مفقود',
        'admin-technical-value admin-word-content-id'
      ),
      document.createTextNode(' · مفتاح الإتقان مشتق مركزيًا')
    ]);
    appendChildren(details, [
      makeElement('span', 'admin-count-chip', String(word.category || 'بلا تصنيف')),
      makeElement('span', 'admin-count-chip', String(word.level || 'بلا مستوى')),
      identifierNote
    ]);

    const actions = makeElement('div', 'admin-world-actions admin-word-actions');
    appendChildren(actions, [
      makeButton('تعديل', 'edit-word', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, gateId, contentWordId, disabled: isBusy
      }),
      makeButton('نسخ إلى بوابة', 'duplicate-word', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, gateId, contentWordId,
        disabled: true, title: 'نسخ الكلمات لم يتم ربطه بعد.'
      }),
      makeButton('نقل', 'move-word', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, gateId, contentWordId,
        disabled: true, title: 'نقل الكلمات لم يتم ربطه بعد.'
      })
    ]);
    if (word.status === 'draft') {
      actions.append(makeButton('نشر', 'set-word-status', {
        className: 'admin-btn admin-btn-success', worldId, rankId, gateId, contentWordId,
        status: 'published', disabled: isBusy
      }));
      actions.append(makeButton('أرشفة', 'set-word-status', {
        className: 'admin-btn admin-btn-warning', worldId, rankId, gateId, contentWordId,
        status: 'archived', disabled: isBusy
      }));
    } else if (word.status === 'published') {
      actions.append(makeButton('أرشفة', 'set-word-status', {
        className: 'admin-btn admin-btn-warning', worldId, rankId, gateId, contentWordId,
        status: 'archived', disabled: isBusy
      }));
    } else if (word.status === 'archived') {
      actions.append(makeButton('إعادة لمسودة', 'set-word-status', {
        className: 'admin-btn admin-btn-secondary', worldId, rankId, gateId, contentWordId,
        status: 'draft', disabled: isBusy
      }));
      actions.append(makeButton('حذف نهائي', 'delete-word', {
        className: 'admin-btn admin-btn-danger', worldId, rankId, gateId, contentWordId,
        disabled: true, title: 'حذف الكلمات لم يتم ربطه بعد.'
      }));
    }

    appendChildren(row, [selection, identity, details, actions]);
    return row;
  }

  function renderWordBulkToolbar(world, rank, gate) {
    const selectedCount = ui.selectedWordIds.size;
    const toolbar = makeElement('section', 'admin-word-bulk-toolbar');
    toolbar.setAttribute('aria-label', 'عمليات الكلمات الجماعية');
    const summary = makeElement('div', 'admin-word-selection-summary');
    appendChildren(summary, [
      makeElement('strong', '', `${selectedCount} كلمات محددة`),
      makeElement('small', '', `الحد الأقصى للعملية الواحدة ${MAX_BULK_WORDS} كلمة مع إصدار كل كلمة.`)
    ]);
    const actions = makeElement('div', 'admin-header-actions admin-word-bulk-actions');
    const common = {
      worldId: world.worldId,
      rankId: rank.rankId,
      gateId: gate.gateId,
      disabled: ui.wordsLoading || selectedCount === 0 || selectedCount > MAX_BULK_WORDS
    };
    appendChildren(actions, [
      makeButton(selectedCount && selectedCount === ui.words.length ? 'إلغاء تحديد الكل' : 'تحديد الكل في الصفحة', 'select-page-words', {
        className: 'admin-btn admin-btn-secondary',
        worldId: world.worldId, rankId: rank.rankId, gateId: gate.gateId,
        disabled: ui.wordsLoading || ui.words.length === 0
      }),
      makeButton('نشر المحدد', 'bulk-publish-words', { ...common, className: 'admin-btn admin-btn-success' }),
      makeButton('أرشفة المحدد', 'bulk-archive-words', { ...common, className: 'admin-btn admin-btn-warning' }),
      makeButton('نقل المحدد', 'bulk-move-words', {
        ...common,
        className: 'admin-btn admin-btn-primary',
        disabled: true,
        title: 'نقل الكلمات جماعيًا لم يتم ربطه بعد.'
      })
    ]);
    appendChildren(toolbar, [summary, actions]);
    return toolbar;
  }

  function renderWords() {
    const container = getAdminRoot();
    if (!container) return;
    const state = getAdminState();
    if (!state.resolved || !state.isAdmin) {
      renderAccessMessage(container, state);
      return;
    }
    const world = findWorld(ui.activeWorldId);
    const rank = findRank(ui.activeRankId);
    const gate = findGate(ui.activeGateId);
    if (!world || !rank || !gate) {
      ui.wordLoadRevision += 1;
      ui.wordsLoading = false;
      ui.words = [];
      ui.selectedWordIds.clear();
      ui.activeGateId = '';
      if (world && rank) {
        ui.view = 'gates';
        ui.gatePageError = 'تعذر فتح البوابة لإدارة كلماتها. رمز الخطأ: content/gate-not-found';
        renderGates();
      } else {
        ui.view = world ? 'ranks' : 'dashboard';
        renderCurrentView();
      }
      return;
    }

    const loadedWordIds = new Set(ui.words.map((word) => String(word.contentWordId || '')));
    Array.from(ui.selectedWordIds).forEach((contentWordId) => {
      if (!loadedWordIds.has(contentWordId)) ui.selectedWordIds.delete(contentWordId);
    });

    container.replaceChildren();
    container.append(makeWordBreadcrumb(world, rank, gate));
    const header = makeElement('header', 'admin-dashboard-header admin-words-header');
    const heading = makeElement('div', 'admin-dashboard-heading');
    appendChildren(heading, [
      makeElement('span', 'admin-kicker', 'إدارة كلمات البوابة'),
      makeElement('h2', 'admin-dashboard-title', String(gate.title || 'بوابة بلا عنوان')),
      makeElement('p', 'admin-dashboard-copy', 'تُحمّل الكلمات صفحةً بصفحة. التكرار داخل البوابة مرفوض في طبقة البيانات، أما التكرار داخل الرتبة أو العالم فيظهر كتحذير للمراجعة.')
    ]);
    const headerActions = makeElement('div', 'admin-header-actions');
    appendChildren(headerActions, [
      makeButton('العودة للبوابات', 'open-gates', {
        className: 'admin-btn admin-btn-secondary', worldId: world.worldId, rankId: rank.rankId,
        disabled: ui.wordsLoading
      }),
      makeButton(ui.wordsLoading ? 'جارٍ التحديث…' : 'تحديث الكلمات', 'refresh-words', {
        className: 'admin-btn admin-btn-secondary', worldId: world.worldId, rankId: rank.rankId,
        gateId: gate.gateId, disabled: ui.wordsLoading || ui.wordImportPending
      }),
      makeButton('استيراد JSON', 'import-words-json', {
        className: 'admin-btn admin-btn-secondary', worldId: world.worldId, rankId: rank.rankId,
        gateId: gate.gateId, disabled: ui.wordsLoading || ui.wordImportPending
      }),
      makeButton('إنشاء كلمة', 'create-word', {
        className: 'admin-btn admin-btn-primary', worldId: world.worldId, rankId: rank.rankId,
        gateId: gate.gateId, disabled: ui.wordsLoading || ui.wordImportPending
      })
    ]);
    appendChildren(header, [heading, headerActions]);
    container.append(header);
    container.append(renderWordBulkToolbar(world, rank, gate));

    if (ui.wordPageError) {
      const errorBox = makeElement('div', 'admin-page-error', ui.wordPageError);
      errorBox.setAttribute('role', 'alert');
      container.append(errorBox);
    }
    if (ui.wordsLoading && ui.words.length === 0) {
      const loading = makeElement('div', 'admin-loading-card');
      loading.setAttribute('role', 'status');
      appendChildren(loading, [
        makeElement('span', 'admin-spinner', '⏳'),
        makeElement('span', 'admin-loading-label', 'جارٍ تحميل الصفحة الأولى من كلمات البوابة…')
      ]);
      container.append(loading);
      return;
    }

    const section = makeElement('section', 'admin-worlds-section admin-words-section');
    const sectionHeading = makeElement('div', 'admin-section-heading');
    appendChildren(sectionHeading, [
      makeElement('h3', 'admin-section-title', 'الكلمات المحملة'),
      makeElement('span', 'admin-list-count', `${ui.words.length} / ${cachedCount(gate.wordCount)}`)
    ]);
    section.append(sectionHeading);
    const list = makeElement('div', 'admin-worlds-list admin-words-list');
    if (ui.words.length === 0) {
      const empty = makeElement('div', 'admin-empty-state');
      appendChildren(empty, [
        makeElement('span', 'admin-empty-icon', '📝'),
        makeElement('strong', 'admin-empty-title', 'لا توجد كلمات في هذه البوابة'),
        makeElement('p', 'admin-empty-copy', 'أنشئ أول كلمة كمسودة ثم راجع صيغتها وترجمتها قبل النشر.')
      ]);
      list.append(empty);
    } else {
      ui.words.forEach((word) => list.append(renderWordRow(word, world, rank, gate)));
    }
    section.append(list);
    const pagination = makeElement('div', 'admin-word-pagination');
    appendChildren(pagination, [
      makeElement('small', 'admin-count-note', `المعروض ${ui.words.length} من العدد المخزن ${cachedCount(gate.wordCount)}؛ لا تُحمّل البوابة كاملة.`),
      makeButton(ui.wordsLoading ? 'جارٍ تحميل الصفحة…' : 'تحميل المزيد', 'load-more-words', {
        className: 'admin-btn admin-btn-secondary', worldId: world.worldId, rankId: rank.rankId,
        gateId: gate.gateId, disabled: ui.wordsLoading || !ui.wordHasMore
      })
    ]);
    if (!ui.wordHasMore) pagination.querySelector('[data-admin-action="load-more-words"]').hidden = true;
    section.append(pagination);
    container.append(section);
  }

  function renderCurrentView() {
    if (ui.view === 'words') renderWords();
    else if (ui.view === 'gates') renderGates();
    else if (ui.view === 'ranks') renderRanks();
    else renderDashboard();
  }

  async function refreshRanks(options) {
    const settings = options || {};
    const worldId = String(ui.activeWorldId || '');
    if (!worldId || ui.view !== 'ranks') return;
    const revision = ++ui.rankLoadRevision;
    ui.ranksLoading = true;
    if (settings.clear !== false) ui.ranks = [];
    ui.rankPageError = '';
    renderRanks();
    try {
      const records = await getCloudApi().listRanks(worldId);
      if (revision !== ui.rankLoadRevision || worldId !== ui.activeWorldId || ui.view !== 'ranks') return;
      if (!Array.isArray(records)) {
        const error = new Error('admin/invalid-rank-list');
        error.code = 'admin/invalid-rank-list';
        throw error;
      }
      ui.ranks = records.map((record) => normalizeRankRecord(record, worldId)).filter(Boolean);
    } catch (error) {
      if (revision !== ui.rankLoadRevision || worldId !== ui.activeWorldId || ui.view !== 'ranks') return;
      ui.rankPageError = `تعذر تحميل رتب العالم. رمز الخطأ: ${getErrorCode(error, 'admin/rank-list-failed')}`;
    } finally {
      if (revision === ui.rankLoadRevision && worldId === ui.activeWorldId && ui.view === 'ranks') {
        ui.ranksLoading = false;
        renderRanks();
      }
    }
  }

  async function openRanksForWorld(worldId) {
    const world = findWorld(worldId);
    if (!world) {
      setPageActionError('تعذر العثور على العالم.', { code: 'content/world-not-found' });
      return false;
    }
    if (!canLeaveAdminView()) return false;
    ui.gateLoadRevision += 1;
    ui.gatesLoading = false;
    ui.view = 'ranks';
    ui.activeWorldId = String(world.worldId);
    ui.activeRankId = '';
    ui.activeGateId = '';
    ui.ranks = [];
    ui.gates = [];
    ui.words = [];
    ui.selectedWordIds.clear();
    ui.rankPageError = '';
    ui.gatePageError = '';
    await refreshRanks({ clear: true });
    return true;
  }

  async function refreshGates(options) {
    const settings = options || {};
    const worldId = String(ui.activeWorldId || '');
    const rankId = String(ui.activeRankId || '');
    if (!worldId || !rankId || ui.view !== 'gates') return;
    const revision = ++ui.gateLoadRevision;
    ui.gatesLoading = true;
    if (settings.clear !== false) ui.gates = [];
    ui.gatePageError = '';
    renderGates();
    try {
      const records = await getCloudApi().listGates(worldId, rankId);
      if (revision !== ui.gateLoadRevision || worldId !== ui.activeWorldId || rankId !== ui.activeRankId || ui.view !== 'gates') return;
      if (!Array.isArray(records)) {
        const error = new Error('admin/invalid-gate-list');
        error.code = 'admin/invalid-gate-list';
        throw error;
      }
      ui.gates = records.map((record) => normalizeGateRecord(record, worldId, rankId)).filter(Boolean);
    } catch (error) {
      if (revision !== ui.gateLoadRevision || worldId !== ui.activeWorldId || rankId !== ui.activeRankId || ui.view !== 'gates') return;
      ui.gatePageError = `تعذر تحميل بوابات الرتبة. رمز الخطأ: ${getErrorCode(error, 'admin/gate-list-failed')}`;
    } finally {
      if (revision === ui.gateLoadRevision && worldId === ui.activeWorldId && rankId === ui.activeRankId && ui.view === 'gates') {
        ui.gatesLoading = false;
        renderGates();
      }
    }
  }

  async function openGatesForRank(worldId, rankId) {
    const world = findWorld(worldId);
    const rank = findRank(rankId);
    if (!world || !rank || String(rank.worldId || world.worldId) !== String(world.worldId)) {
      setRankActionError('تعذر العثور على الرتبة.', { code: 'content/rank-not-found' });
      return false;
    }
    if (!canLeaveAdminView()) return false;
    ui.view = 'gates';
    ui.activeWorldId = String(world.worldId);
    ui.activeRankId = String(rank.rankId);
    ui.activeGateId = '';
    ui.gates = [];
    ui.words = [];
    ui.selectedWordIds.clear();
    ui.gatePageError = '';
    await refreshGates({ clear: true });
    return true;
  }

  async function refreshWords(options) {
    const settings = options || {};
    const append = Boolean(settings.append);
    const worldId = String(ui.activeWorldId || '');
    const rankId = String(ui.activeRankId || '');
    const gateId = String(ui.activeGateId || '');
    if (!worldId || !rankId || !gateId || ui.view !== 'words' || ui.wordsLoading) return;
    const revision = ++ui.wordLoadRevision;
    const cursor = append ? ui.wordNextCursor : null;
    ui.wordsLoading = true;
    if (!append) {
      ui.words = [];
      ui.wordNextCursor = null;
      ui.wordHasMore = false;
      ui.selectedWordIds.clear();
    }
    ui.wordPageError = '';
    renderWords();
    try {
      const page = await getCloudApi().listWords(worldId, rankId, gateId, {
        pageSize: WORD_PAGE_SIZE,
        cursor
      });
      if (
        revision !== ui.wordLoadRevision || worldId !== ui.activeWorldId ||
        rankId !== ui.activeRankId || gateId !== ui.activeGateId || ui.view !== 'words'
      ) return;
      if (!page || typeof page !== 'object' || !Array.isArray(page.items)) {
        const error = new Error('admin/invalid-word-page');
        error.code = 'admin/invalid-word-page';
        throw error;
      }
      const received = page.items
        .map((record) => normalizeWordRecord(record, worldId, rankId, gateId))
        .filter((word) => word && word.contentWordId);
      if (append) {
        const byId = new Map(ui.words.map((word) => [String(word.contentWordId), word]));
        received.forEach((word) => byId.set(String(word.contentWordId), word));
        ui.words = Array.from(byId.values());
      } else {
        ui.words = received;
      }
      ui.wordNextCursor = page.nextCursor === undefined ? null : page.nextCursor;
      ui.wordHasMore = Boolean(page.hasMore && ui.wordNextCursor !== null && ui.wordNextCursor !== undefined);
    } catch (error) {
      if (
        revision !== ui.wordLoadRevision || worldId !== ui.activeWorldId ||
        rankId !== ui.activeRankId || gateId !== ui.activeGateId || ui.view !== 'words'
      ) return;
      ui.wordPageError = `تعذر تحميل صفحة الكلمات. رمز الخطأ: ${getErrorCode(error, 'admin/word-list-failed')}`;
    } finally {
      if (
        revision === ui.wordLoadRevision && worldId === ui.activeWorldId &&
        rankId === ui.activeRankId && gateId === ui.activeGateId && ui.view === 'words'
      ) {
        ui.wordsLoading = false;
        renderWords();
      }
    }
  }

  async function openWordsForGate(worldId, rankId, gateId) {
    const world = findWorld(worldId);
    const rank = findRank(rankId);
    const gate = findGate(gateId);
    if (
      !world || !rank || !gate ||
      String(gate.worldId || world.worldId) !== String(world.worldId) ||
      String(gate.rankId || rank.rankId) !== String(rank.rankId)
    ) {
      setGateActionError('تعذر العثور على البوابة.', { code: 'content/gate-not-found' });
      return false;
    }
    if (!canLeaveAdminView()) return false;
    ui.view = 'words';
    ui.activeWorldId = String(world.worldId);
    ui.activeRankId = String(rank.rankId);
    ui.activeGateId = String(gate.gateId);
    ui.words = [];
    ui.wordPageError = '';
    ui.wordNextCursor = null;
    ui.wordHasMore = false;
    ui.selectedWordIds.clear();
    await refreshWords({ append: false });
    return true;
  }

  function showAdminDashboard() {
    if (!canLeaveAdminView()) return false;
    ui.rankLoadRevision += 1;
    ui.gateLoadRevision += 1;
    ui.ranksLoading = false;
    ui.gatesLoading = false;
    ui.wordLoadRevision += 1;
    ui.wordsLoading = false;
    ui.view = 'dashboard';
    ui.activeWorldId = '';
    ui.activeRankId = '';
    ui.activeGateId = '';
    ui.gates = [];
    ui.words = [];
    ui.selectedWordIds.clear();
    renderDashboard();
    return true;
  }

  async function refreshWorlds(options) {
    const settings = options || {};
    const revision = ++ui.loadRevision;
    ui.loading = true;
    if (settings.clear !== false) ui.worlds = [];
    ui.pageError = '';
    renderCurrentView();
    try {
      const records = await getCloudApi().listWorlds();
      if (revision !== ui.loadRevision) return;
      if (!Array.isArray(records)) {
        const error = new Error('admin/invalid-world-list');
        error.code = 'admin/invalid-world-list';
        throw error;
      }
      ui.worlds = records.map(normalizeWorldRecord).filter(Boolean);
    } catch (error) {
      if (revision !== ui.loadRevision) return;
      ui.pageError = `تعذر تحميل العوالم. رمز الخطأ: ${getErrorCode(error, 'admin/list-failed')}`;
    } finally {
      if (revision === ui.loadRevision) {
        ui.loading = false;
        renderCurrentView();
      }
    }
  }

  function findWorld(worldId) {
    return ui.worlds.find((world) => String(world.worldId || '') === String(worldId || '')) || null;
  }

  function findRank(rankId) {
    return ui.ranks.find((rank) => String(rank.rankId || '') === String(rankId || '')) || null;
  }

  function findGate(gateId) {
    return ui.gates.find((gate) => String(gate.gateId || '') === String(gateId || '')) || null;
  }

  function findWord(contentWordId) {
    return ui.words.find((word) => String(word.contentWordId || '') === String(contentWordId || '')) || null;
  }

  function setActionPending(key, pending) {
    if (pending) ui.actionKeys.add(key);
    else ui.actionKeys.delete(key);
    renderCurrentView();
  }

  function setPageActionError(prefix, error) {
    ui.pageError = `${prefix} رمز الخطأ: ${getErrorCode(error)}`;
    renderDashboard();
  }

  function setRankActionError(prefix, error) {
    ui.rankPageError = `${prefix} رمز الخطأ: ${getErrorCode(error)}`;
    renderRanks();
  }

  function setGateActionError(prefix, error) {
    ui.gatePageError = `${prefix} رمز الخطأ: ${getErrorCode(error)}`;
    renderGates();
  }

  function setWordActionError(prefix, error) {
    ui.wordPageError = `${prefix} رمز الخطأ: ${getErrorCode(error)}`;
    renderWords();
  }

  function makeField(config) {
    const wrapper = makeElement('label', config.wide ? 'admin-field admin-field-wide' : 'admin-field');
    const label = makeElement('span', 'admin-field-label', config.label);
    const input = makeElement(config.multiline ? 'textarea' : 'input', 'admin-input');
    input.name = config.name;
    if (!config.multiline) input.type = config.type || 'text';
    if (config.multiline) input.rows = config.rows || 4;
    if (config.required) input.required = true;
    if (config.readOnly) input.readOnly = true;
    if (config.min !== undefined) input.min = String(config.min);
    if (config.max !== undefined) input.max = String(config.max);
    if (config.step !== undefined) input.step = String(config.step);
    if (config.maxLength) input.maxLength = config.maxLength;
    if (config.pattern) input.pattern = config.pattern;
    if (config.placeholder) input.placeholder = config.placeholder;
    if (config.value !== undefined && config.value !== null) input.value = String(config.value);
    appendChildren(wrapper, [label, input]);
    if (config.help) wrapper.append(makeElement('small', 'admin-field-help', config.help));
    return { wrapper, input };
  }

  function makeSelectField(config) {
    const wrapper = makeElement('label', config.wide ? 'admin-field admin-field-wide' : 'admin-field');
    const label = makeElement('span', 'admin-field-label', config.label);
    const select = makeElement('select', 'admin-input admin-select');
    select.name = config.name;
    if (config.required) select.required = true;
    (config.options || []).forEach((option) => {
      const node = makeElement('option', '', option.label);
      node.value = String(option.value);
      node.selected = String(option.value) === String(config.value);
      select.append(node);
    });
    appendChildren(wrapper, [label, select]);
    if (config.help) wrapper.append(makeElement('small', 'admin-field-help', config.help));
    return { wrapper, input: select };
  }

  function editorSeed(source, mode) {
    const world = source || {};
    return {
      slug: mode === 'duplicate' ? '' : String(world.slug || ''),
      title: mode === 'duplicate' ? `نسخة من ${String(world.title || 'عالم')}` : String(world.title || ''),
      subtitle: String(world.subtitle || ''),
      description: String(world.description || ''),
      icon: String(world.icon || ''),
      cover: String(world.cover || ''),
      theme: String(world.theme || ''),
      category: String(world.category || ''),
      difficulty: String(world.difficulty || ''),
      languageFrom: String(world.languageFrom || ''),
      languageTo: String(world.languageTo || ''),
      order: mode === 'duplicate' ? cachedCount(world.order) + 1 : cachedCount(world.order),
      isFeatured: mode === 'duplicate' ? false : Boolean(world.isFeatured)
    };
  }

  function collectWorldForm(form) {
    const data = new FormData(form);
    return {
      slug: String(data.get('slug') || '').trim(),
      title: String(data.get('title') || '').trim(),
      subtitle: String(data.get('subtitle') || '').trim(),
      description: String(data.get('description') || '').trim(),
      icon: String(data.get('icon') || '').trim(),
      cover: String(data.get('cover') || '').trim(),
      theme: String(data.get('theme') || '').trim(),
      category: String(data.get('category') || '').trim(),
      difficulty: String(data.get('difficulty') || '').trim(),
      languageFrom: String(data.get('languageFrom') || '').trim(),
      languageTo: String(data.get('languageTo') || '').trim(),
      order: Number(data.get('order')),
      isFeatured: data.get('isFeatured') === 'on'
    };
  }

  function formSignature(form) {
    return JSON.stringify(collectWorldForm(form));
  }

  function renderFormIssues(container, issues, prefix) {
    container.replaceChildren();
    container.hidden = false;
    container.setAttribute('role', 'alert');
    if (prefix) container.append(makeElement('strong', 'admin-form-error-title', prefix));
    const list = makeElement('ul', 'admin-form-errors');
    issues.slice(0, 10).forEach((issue) => {
      const path = String(issue.path || 'world');
      const code = String(issue.code || 'schema/invalid');
      list.append(makeElement('li', 'admin-form-error-item', `${path} · ${code}`));
    });
    container.append(list);
  }

  function validateWorldPayload(form, modalState) {
    const values = collectWorldForm(form);
    const source = modalState.world || {};
    const candidate = {
      schemaVersion: 1,
      worldId: source.worldId || 'pending-world',
      ...values,
      status: modalState.mode === 'edit' ? source.status : 'draft',
      version: modalState.mode === 'edit' ? Number(source.version) : 1,
      rankCount: modalState.mode === 'edit' ? cachedCount(source.rankCount) : 0,
      gateCount: modalState.mode === 'edit' ? cachedCount(source.gateCount) : 0,
      wordCount: modalState.mode === 'edit' ? cachedCount(source.wordCount) : 0
    };
    const schema = root.LootLinguaContentSchema;
    if (!schema || typeof schema.validateWorld !== 'function') {
      return {
        ok: false,
        errors: [{ path: 'schema', code: 'schema/unavailable' }]
      };
    }
    const result = schema.validateWorld(candidate);
    if (!result.ok) return result;
    const cleaned = result.value;
    const payload = {};
    EDITABLE_WORLD_FIELDS.forEach((field) => {
      payload[field] = cleaned[field];
    });
    payload.schemaVersion = cleaned.schemaVersion;
    if (modalState.mode !== 'edit') {
      payload.status = 'draft';
      payload.version = 1;
      payload.rankCount = 0;
      payload.gateCount = 0;
      payload.wordCount = 0;
    }
    return { ok: true, payload };
  }

  function setWorldEditorPending(modalState, pending) {
    modalState.pending = Boolean(pending);
    modalState.form.setAttribute('aria-busy', pending ? 'true' : 'false');
    modalState.saveButton.disabled = Boolean(pending);
    modalState.closeButton.disabled = Boolean(pending);
    modalState.saveButton.textContent = pending ? 'جارٍ الحفظ…' : 'حفظ العالم';
  }

  function wordImportResultLabel(entry) {
    const visualState = wordImportVisualState(entry);
    const labels = {
      valid: 'صالح',
      warning: 'تحذير',
      duplicate: 'مكرر',
      invalid: 'غير صالح'
    };
    if (entry.state === 'imported') return 'تم الاستيراد';
    if (entry.state === 'failed') return 'فشل الحفظ';
    return labels[visualState] || 'غير صالح';
  }

  function wordImportVisualState(entry) {
    if (entry.state === 'duplicate-file' || entry.state === 'duplicate-gate') return 'duplicate';
    if (entry.state === 'invalid' || entry.state === 'failed') return 'invalid';
    if (entry.state === 'valid' && entry.warnings.length) return 'warning';
    return 'valid';
  }

  function wordImportIssueText(entry) {
    const issues = entry.errors.concat(entry.warnings);
    return Array.from(new Set(issues.map((item) =>
      String(item && item.message || '').trim()
    ).filter(Boolean))).join('، ');
  }

  function renderWordImportEntries(container, entries) {
    const table = makeElement('table', 'admin-import-table');
    const head = makeElement('thead');
    const headingRow = makeElement('tr');
    ['#', 'الكلمة', 'الترجمة', 'المستوى', 'النتيجة'].forEach((label) => {
      headingRow.append(makeElement('th', '', label));
    });
    head.append(headingRow);
    const body = makeElement('tbody');
    entries.forEach((entry) => {
      const visualState = wordImportVisualState(entry);
      const row = makeElement('tr', `admin-import-row admin-import-row-${visualState}`);
      row.dataset.importState = String(entry.state || '');
      const resultCell = makeElement('td');
      resultCell.append(makeElement(
        'strong',
        `admin-import-result admin-import-result-${visualState}`,
        wordImportResultLabel(entry)
      ));
      const issueText = wordImportIssueText(entry);
      if (issueText) resultCell.append(makeElement('small', 'admin-import-issue', issueText));
      [
        String(entry.index + 1),
        String(entry.word || '—'),
        String(entry.translation || '—'),
        String(entry.level || '—')
      ].forEach((value) => row.append(makeElement('td', '', value)));
      row.append(resultCell);
      body.append(row);
    });
    appendChildren(table, [head, body]);
    container.replaceChildren(table);
  }

  function renderWordImportStats(container, preview, result) {
    const stats = preview.stats;
    const values = result ? [
      ['الإجمالي', result.summary.total],
      ['تم الاستيراد', result.summary.succeeded],
      ['فشل', result.summary.failed],
      ['تخطي مكرر', result.summary.skippedDuplicates],
      ['غير صالح', result.summary.skippedInvalid]
    ] : [
      ['الإجمالي', stats.total],
      ['صالح', stats.valid],
      ['غير صالح', stats.invalid],
      ['مكرر في الملف', stats.duplicateInFile],
      ['موجود في البوابة', stats.duplicateInGate]
    ];
    container.replaceChildren();
    values.forEach(([label, value]) => {
      const item = makeElement('div', 'admin-import-stat');
      appendChildren(item, [
        makeElement('strong', 'admin-import-stat-value', value),
        makeElement('span', 'admin-import-stat-label', label)
      ]);
      container.append(item);
    });
  }

  function renderWordImportInspectionNotice(container, preview) {
    const warnings = Array.isArray(preview.generalWarnings) ? preview.generalWarnings : [];
    container.replaceChildren();
    if (!preview.blockingIssue && warnings.length === 0) {
      container.hidden = true;
      return;
    }
    if (preview.blockingIssue) {
      const blocking = makeElement(
        'p',
        'admin-import-inspection-copy',
        'تعذر فحص تكرار الكلمات داخل البوابة الحالية. لا يمكن متابعة الاستيراد قبل اكتمال هذا الفحص.'
      );
      container.append(blocking);
    }
    if (warnings.length) {
      const warning = makeElement(
        'p',
        'admin-import-inspection-copy',
        'تعذر فحص وجود الكلمة خارج البوابة الحالية، ويمكن متابعة الاستيراد.'
      );
      container.append(warning);
    }
    container.hidden = false;
  }

  function openWordImportPreview(world, rank, gate, preview, returnFocus) {
    closeAdminModal(true);
    ui.wordImportPending = true;
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-word-import-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminWordImportTitle');

    const header = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    const title = makeElement('h2', 'admin-modal-title', 'مراجعة الكلمات قبل الاستيراد');
    title.id = 'adminWordImportTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', 'سيتم إنشاء كل الكلمات المقبولة كمسودات. الحقول التقنية الواردة في الملف لا يتم الوثوق بها.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close',
      title: 'إغلاق معاينة الاستيراد'
    });
    closeButton.setAttribute('aria-label', 'إغلاق معاينة الاستيراد');
    appendChildren(header, [heading, closeButton]);
    dialog.append(header);

    const context = makeElement('div', 'admin-import-context');
    [
      ['العالم', world.title || world.worldId],
      ['الرتبة', rank.title || rank.rankId],
      ['البوابة', gate.title || gate.gateId]
    ].forEach(([label, value]) => {
      const item = makeElement('span', 'admin-import-context-item');
      appendChildren(item, [
        makeElement('strong', '', `${label}: `),
        document.createTextNode(String(value))
      ]);
      context.append(item);
    });
    dialog.append(context);

    const stats = makeElement('div', 'admin-import-stats');
    renderWordImportStats(stats, preview, null);
    dialog.append(stats);
    const progress = makeElement('div', 'admin-import-progress', 'المعاينة جاهزة.');
    progress.setAttribute('role', 'status');
    progress.setAttribute('aria-live', 'polite');
    dialog.append(progress);
    const inspectionNotice = makeElement('div', 'admin-import-inspection-notice');
    renderWordImportInspectionNotice(inspectionNotice, preview);
    dialog.append(inspectionNotice);
    const tableWrap = makeElement('div', 'admin-import-table-wrap');
    renderWordImportEntries(tableWrap, preview.entries);
    dialog.append(tableWrap);
    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    dialog.append(errorBox);

    const form = makeElement('form', 'admin-import-form');
    const footer = makeElement('footer', 'admin-modal-footer');
    const backButton = makeButton('رجوع', 'choose-word-import-file', {
      className: 'admin-btn admin-btn-secondary'
    });
    const cancelButton = makeButton('إلغاء', 'close-modal', {
      className: 'admin-btn admin-btn-secondary'
    });
    const importButton = makeButton(`استيراد ${preview.stats.valid} كلمة`, null, {
      className: 'admin-btn admin-btn-primary',
      type: 'submit',
      disabled: preview.stats.valid === 0 || Boolean(preview.blockingIssue)
    });
    appendChildren(footer, [backButton, cancelButton, importButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);
    if (typeof lockBackgroundScroll === 'function') {
      lockBackgroundScroll('adminWordImport');
    }

    const modalState = {
      kind: 'word-import',
      overlay,
      form,
      errorBox,
      closeButton,
      backButton,
      cancelButton,
      importButton,
      progress,
      inspectionNotice,
      stats,
      tableWrap,
      preview,
      world,
      rank,
      gate,
      pending: false,
      completed: false,
      returnFocus
    };
    ui.modal = modalState;
    if (preview.blockingIssue) {
      progress.textContent = 'فشل فحص التكرار داخل البوابة. لا يمكن متابعة الاستيراد.';
    }
    form.addEventListener('submit', (event) => commitWordImport(event, modalState));
    importButton.focus();
  }

  async function commitWordImport(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending || modalState.completed) return;
    modalState.pending = true;
    modalState.form.setAttribute('aria-busy', 'true');
    modalState.importButton.disabled = true;
    modalState.closeButton.disabled = true;
    modalState.backButton.disabled = true;
    modalState.cancelButton.disabled = true;
    modalState.importButton.textContent = 'جارٍ الاستيراد…';
    modalState.errorBox.hidden = true;
    try {
      const cloud = getCloudApi();
      const result = await getWordImportApi().commit(modalState.preview, {
        createWord: cloud.createWord.bind(cloud),
        onProgress(progress) {
          if (ui.modal !== modalState) return;
          modalState.progress.textContent =
            `تمت معالجة ${progress.completed} من ${progress.total} · نجح ${progress.succeeded} · فشل ${progress.failed}`;
        }
      });
      if (ui.modal !== modalState) return;
      modalState.completed = true;
      modalState.pending = false;
      ui.wordImportPending = false;
      modalState.form.setAttribute('aria-busy', 'false');
      modalState.closeButton.disabled = false;
      modalState.backButton.disabled = false;
      modalState.cancelButton.disabled = false;
      modalState.cancelButton.textContent = 'إغلاق';
      modalState.importButton.disabled = true;
      modalState.importButton.textContent = 'اكتمل الاستيراد';
      renderWordImportStats(modalState.stats, modalState.preview, result);
      renderWordImportEntries(modalState.tableWrap, result.entries);
      modalState.progress.textContent =
        `اكتمل: نجح ${result.summary.succeeded}، فشل ${result.summary.failed}، وتُخطّي ${result.summary.skippedDuplicates} مكرر.`;
      if (result.summary.succeeded > 0) {
        await refreshWords({ append: false });
        notify(`تم استيراد ${result.summary.succeeded} كلمة كمسودات.`, 'success');
      } else {
        renderFormIssues(modalState.errorBox, [
          { path: 'import', code: 'admin/no-words-imported' }
        ], 'لم يتم حفظ أي كلمة. راجع النتائج التفصيلية:');
      }
    } catch (error) {
      if (ui.modal !== modalState) return;
      modalState.pending = false;
      ui.wordImportPending = false;
      modalState.form.setAttribute('aria-busy', 'false');
      modalState.closeButton.disabled = false;
      modalState.backButton.disabled = false;
      modalState.cancelButton.disabled = false;
      modalState.importButton.disabled = false;
      modalState.importButton.textContent = `استيراد ${modalState.preview.stats.valid} كلمة`;
      renderFormIssues(modalState.errorBox, [
        { path: 'cloud', code: getErrorCode(error, 'admin/word-import-failed') }
      ], 'تعذر إكمال الاستيراد. بقيت المعاينة والنتائج مفتوحة:');
    }
  }

  async function prepareWordImport(file, world, rank, gate, returnFocus) {
    try {
      const importer = getWordImportApi();
      importer.assertFileSize(file.size);
      if (!String(file.name || '').toLowerCase().endsWith('.json')) {
        const error = new Error('admin/json-file-required');
        error.code = 'admin/json-file-required';
        throw error;
      }
      const parsed = importer.parseJsonText(await file.text());
      let preview = importer.preparePreview(parsed, {
        schema: root.LootLinguaContentSchema,
        worldId: world.worldId,
        rankId: rank.rankId,
        gateId: gate.gateId,
        existingWords: ui.words
      });
      const cloud = getCloudApi();
      preview = await importer.inspectDuplicates(preview, {
        inspectGate: cloud.inspectWordDuplicates.bind(cloud),
        concurrency: 3
      });
      if (
        String(ui.activeWorldId) !== String(world.worldId) ||
        String(ui.activeRankId) !== String(rank.rankId) ||
        String(ui.activeGateId) !== String(gate.gateId) ||
        ui.view !== 'words'
      ) {
        throw Object.assign(new Error('admin/import-context-changed'), {
          code: 'admin/import-context-changed'
        });
      }
      openWordImportPreview(world, rank, gate, preview, returnFocus);
    } catch (error) {
      ui.wordImportPending = false;
      ui.wordPageError =
        `تعذر تجهيز ملف الاستيراد. رمز الخطأ: ${getErrorCode(error, 'admin/word-import-preview-failed')}`;
      renderWords();
    }
  }

  function chooseWordImportFile(world, rank, gate, returnFocus) {
    if (ui.wordImportPending) return;
    ui.wordImportPending = true;
    renderWords();
    const input = makeElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    let handled = false;
    function cancelSelection() {
      if (handled) return;
      handled = true;
      input.remove();
      ui.wordImportPending = false;
      if (ui.view === 'words') renderWords();
    }
    input.addEventListener('cancel', cancelSelection, { once: true });
    input.addEventListener('change', () => {
      if (handled) return;
      handled = true;
      const file = input.files && input.files[0];
      input.remove();
      if (!file) {
        ui.wordImportPending = false;
        renderWords();
        return;
      }
      prepareWordImport(file, world, rank, gate, returnFocus);
    }, { once: true });
    document.body.append(input);
    input.click();
  }

  function modalIsDirty() {
    return Boolean(ui.modal && (
      ui.modal.kind === 'world-editor' || ui.modal.kind === 'rank-editor' ||
      ui.modal.kind === 'gate-editor' || ui.modal.kind === 'move-gate'
    ) && ui.modal.dirty);
  }

  function closeAdminModal(force) {
    const modalState = ui.modal;
    if (!modalState) return true;
    if (modalState.pending && !force) return false;
    if (!force && (
      modalState.kind === 'world-editor' || modalState.kind === 'rank-editor' ||
      modalState.kind === 'gate-editor' || modalState.kind === 'move-gate'
    ) && modalState.dirty) {
      const warning = modalState.kind === 'world-editor'
        ? WORLD_DIRTY_WARNING
        : (modalState.kind === 'rank-editor' ? RANK_DIRTY_WARNING : GATE_DIRTY_WARNING);
      if (!root.confirm(warning)) return false;
    }
    modalState.dirty = false;
    modalState.overlay.remove();
    ui.modal = null;
    if (modalState.kind === 'word-import') {
      if (typeof unlockBackgroundScroll === 'function') {
        unlockBackgroundScroll('adminWordImport');
      }
      ui.wordImportPending = false;
      if (ui.view === 'words') renderWords();
    }
    if (modalState.returnFocus && typeof modalState.returnFocus.focus === 'function') {
      modalState.returnFocus.focus();
    }
    return true;
  }

  function openWorldEditor(world, mode, returnFocus) {
    closeAdminModal(true);
    const source = world || null;
    const seed = editorSeed(source, mode);
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-world-editor');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminWorldEditorTitle');

    const modalHeader = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    const title = makeElement('h2', 'admin-modal-title', mode === 'edit' ? 'تعديل العالم' : (mode === 'duplicate' ? 'نسخ بيانات العالم كمسودة' : 'إنشاء عالم'));
    title.id = 'adminWorldEditorTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', mode === 'duplicate'
        ? 'هذه نسخة غير محفوظة لبيانات بطاقة العالم فقط؛ لا تنسخ الرتب أو البوابات. اختر slug جديدًا قبل الحفظ.'
        : 'احفظ البيانات أولًا، ثم استخدم إجراء النشر من لوحة العوالم.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close', title: 'إغلاق المحرر'
    });
    closeButton.setAttribute('aria-label', 'إغلاق المحرر');
    appendChildren(modalHeader, [heading, closeButton]);
    dialog.append(modalHeader);

    if (source && mode === 'edit') {
      const identity = makeElement('div', 'admin-editor-identity');
      appendChildren(identity, [
        makeElement('span', 'admin-editor-id-label', 'معرّف العالم الثابت'),
        makeElement('code', 'admin-editor-id', String(source.worldId || 'معرّف مفقود')),
        makeElement('span', 'admin-editor-version', `الإصدار: ${String(source.version || 'غير صالح')}`),
        makeStatusBadge(source.status)
      ]);
      dialog.append(identity);
    }

    const form = makeElement('form', 'admin-world-form');
    form.noValidate = false;
    const grid = makeElement('div', 'admin-form-grid');
    const fields = [
      { name: 'title', label: 'عنوان العالم', value: seed.title, required: true, maxLength: 120, placeholder: 'مثال: عالم المغامرات' },
      { name: 'slug', label: 'Slug فريد', value: seed.slug, required: true, maxLength: 80, pattern: '[a-z0-9]+(?:-[a-z0-9]+)*', placeholder: 'adventure-world', help: 'أحرف إنجليزية صغيرة وأرقام وشرطات فقط.' },
      { name: 'subtitle', label: 'وصف مختصر', value: seed.subtitle, maxLength: 180, wide: true },
      { name: 'description', label: 'الوصف', value: seed.description, maxLength: 2000, multiline: true, rows: 5, wide: true },
      { name: 'order', label: 'الترتيب', value: seed.order, type: 'number', required: true, min: 0, max: 1000000, step: 1 },
      { name: 'icon', label: 'رمز الأيقونة', value: seed.icon, maxLength: 80, placeholder: 'fa-solid fa-earth' },
      { name: 'cover', label: 'رابط الغلاف', value: seed.cover, maxLength: 2048, wide: true, placeholder: 'https://… أو مسار محلي آمن' },
      { name: 'theme', label: 'مفتاح المظهر', value: seed.theme, maxLength: 80 },
      { name: 'category', label: 'التصنيف', value: seed.category, maxLength: 80 },
      { name: 'difficulty', label: 'الصعوبة', value: seed.difficulty, maxLength: 80 },
      { name: 'languageFrom', label: 'لغة الكلمات', value: seed.languageFrom, maxLength: 35, placeholder: 'en' },
      { name: 'languageTo', label: 'لغة الترجمة', value: seed.languageTo, maxLength: 35, placeholder: 'ar' }
    ];
    fields.forEach((definition) => grid.append(makeField(definition).wrapper));

    const featured = makeElement('label', 'admin-check-field admin-field-wide');
    const featuredInput = makeElement('input', 'admin-checkbox');
    featuredInput.type = 'checkbox';
    featuredInput.name = 'isFeatured';
    featuredInput.checked = seed.isFeatured;
    appendChildren(featured, [
      featuredInput,
      makeElement('span', 'admin-check-label', 'إبراز العالم في واجهة المحتوى الجاهز')
    ]);
    grid.append(featured);
    form.append(grid);

    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    form.append(errorBox);
    const footer = makeElement('footer', 'admin-modal-footer');
    const cancelButton = makeButton('إلغاء', 'close-modal', { className: 'admin-btn admin-btn-secondary' });
    const saveButton = makeButton('حفظ العالم', null, { className: 'admin-btn admin-btn-primary', type: 'submit' });
    appendChildren(footer, [cancelButton, saveButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);

    const modalState = {
      kind: 'world-editor',
      mode: mode === 'edit' ? 'edit' : 'create',
      world: mode === 'edit' ? source : null,
      overlay,
      form,
      errorBox,
      closeButton,
      saveButton,
      pending: false,
      dirty: mode === 'duplicate',
      forceDirty: mode === 'duplicate',
      initialSignature: '',
      returnFocus
    };
    modalState.initialSignature = formSignature(form);
    ui.modal = modalState;

    form.addEventListener('input', () => {
      modalState.dirty = modalState.forceDirty || formSignature(form) !== modalState.initialSignature;
    });
    form.addEventListener('change', () => {
      modalState.dirty = modalState.forceDirty || formSignature(form) !== modalState.initialSignature;
    });
    form.addEventListener('submit', (event) => saveWorldEditor(event, modalState));
    const firstInput = form.elements.namedItem('title');
    if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
  }

  async function saveWorldEditor(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending) return;
    modalState.errorBox.hidden = true;
    modalState.errorBox.replaceChildren();
    if (!modalState.form.checkValidity()) {
      modalState.form.reportValidity();
      return;
    }
    let validation;
    try {
      validation = validateWorldPayload(modalState.form, modalState);
    } catch (error) {
      validation = { ok: false, errors: [{ path: 'world', code: getErrorCode(error, 'schema/validation-failed') }] };
    }
    if (!validation.ok) {
      renderFormIssues(modalState.errorBox, validation.errors || [], 'تعذر التحقق من بيانات العالم:');
      return;
    }

    setWorldEditorPending(modalState, true);
    try {
      const api = getCloudApi();
      if (modalState.mode === 'edit') {
        await api.updateWorld(
          String(modalState.world.worldId),
          validation.payload,
          expectedVersion(modalState.world)
        );
      } else {
        await api.createWorld(validation.payload);
      }
      modalState.dirty = false;
      modalState.forceDirty = false;
      setWorldEditorPending(modalState, false);
      closeAdminModal(true);
      notify(modalState.mode === 'edit' ? 'تم حفظ العالم.' : 'تم إنشاء العالم كمسودة.', 'success');
      await refreshWorlds({ clear: false });
    } catch (error) {
      if (ui.modal !== modalState) return;
      setWorldEditorPending(modalState, false);
      renderFormIssues(modalState.errorBox, [
        { path: 'cloud', code: getErrorCode(error, 'admin/save-failed') }
      ], 'تعذر حفظ العالم. بقيت بياناتك في المحرر:');
    }
  }

  async function loadFreshWorldForEditor(worldId, mode, returnFocus) {
    const listed = findWorld(worldId);
    if (!listed) {
      setPageActionError('تعذر العثور على العالم.', { code: 'content/world-not-found' });
      return;
    }
    const key = `world:${worldId}:read`;
    setActionPending(key, true);
    try {
      const record = await getCloudApi().getWorld(String(worldId));
      const fresh = normalizeWorldRecord(record);
      if (!fresh || !fresh.worldId) {
        const error = new Error('content/world-not-found');
        error.code = 'content/world-not-found';
        throw error;
      }
      setActionPending(key, false);
      openWorldEditor(fresh, mode, returnFocus);
    } catch (error) {
      setActionPending(key, false);
      setPageActionError('تعذر فتح محرر العالم.', error);
    }
  }

  function rankEditorSeed(rank) {
    const source = rank || {};
    const unlockConfig = source.unlockConfig && typeof source.unlockConfig === 'object'
      ? source.unlockConfig
      : {};
    return {
      title: String(source.title || ''),
      subtitle: String(source.subtitle || ''),
      description: String(source.description || ''),
      order: cachedCount(source.order),
      difficulty: String(source.difficulty || ''),
      initialStatus: unlockConfig.initialStatus === 'available' ? 'available' : 'locked'
    };
  }

  function collectRankForm(form) {
    const data = new FormData(form);
    return {
      title: String(data.get('title') || '').trim(),
      subtitle: String(data.get('subtitle') || '').trim(),
      description: String(data.get('description') || '').trim(),
      order: Number(data.get('order')),
      difficulty: String(data.get('difficulty') || '').trim(),
      unlockConfig: {
        mode: 'manual_placeholder',
        initialStatus: data.get('initialStatus') === 'available' ? 'available' : 'locked',
        requiredMasteredRatio: null,
        requiredReviewingRatio: null,
        requiredGateCount: null
      }
    };
  }

  function rankFormSignature(form) {
    return JSON.stringify(collectRankForm(form));
  }

  function validateRankPayload(form, modalState) {
    const values = collectRankForm(form);
    const source = modalState.rank || {};
    const candidate = {
      schemaVersion: Number(source.schemaVersion) || 1,
      worldId: String(modalState.world.worldId),
      rankId: source.rankId || 'pending-rank',
      ...values,
      status: modalState.mode === 'edit' ? source.status : 'draft',
      version: modalState.mode === 'edit' ? Number(source.version) : 1,
      gateCount: modalState.mode === 'edit' ? cachedCount(source.gateCount) : 0,
      wordCount: modalState.mode === 'edit' ? cachedCount(source.wordCount) : 0
    };
    const schema = root.LootLinguaContentSchema;
    if (!schema || typeof schema.validateRank !== 'function') {
      return { ok: false, errors: [{ path: 'schema', code: 'schema/unavailable' }] };
    }
    const result = schema.validateRank(candidate, {
      worldId: String(modalState.world.worldId),
      rankId: String(candidate.rankId)
    });
    if (!result.ok) return result;
    const payload = {};
    EDITABLE_RANK_FIELDS.forEach((field) => {
      payload[field] = result.value[field];
    });
    payload.schemaVersion = result.value.schemaVersion;
    if (modalState.mode !== 'edit') {
      payload.status = 'draft';
      payload.version = 1;
      payload.gateCount = 0;
      payload.wordCount = 0;
    }
    return { ok: true, payload };
  }

  function setRankEditorPending(modalState, pending) {
    modalState.pending = Boolean(pending);
    modalState.form.setAttribute('aria-busy', pending ? 'true' : 'false');
    modalState.saveButton.disabled = Boolean(pending);
    modalState.closeButton.disabled = Boolean(pending);
    modalState.saveButton.textContent = pending ? 'جارٍ الحفظ…' : 'حفظ الرتبة';
  }

  function openRankEditor(world, rank, mode, returnFocus) {
    closeAdminModal(true);
    const source = rank || null;
    const seed = rankEditorSeed(source);
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-rank-editor');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminRankEditorTitle');

    const modalHeader = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    heading.append(makeAdminBreadcrumb(world, source ? String(source.title || 'الرتبة') : 'رتبة جديدة'));
    const title = makeElement('h2', 'admin-modal-title', mode === 'edit' ? 'تعديل الرتبة' : 'إنشاء رتبة');
    title.id = 'adminRankEditorTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', 'احفظ الرتبة كمسودة، ثم انشرها من قائمة رتب العالم بعد المراجعة.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close', title: 'إغلاق محرر الرتبة'
    });
    closeButton.setAttribute('aria-label', 'إغلاق محرر الرتبة');
    appendChildren(modalHeader, [heading, closeButton]);
    dialog.append(modalHeader);

    if (source && mode === 'edit') {
      const identity = makeElement('div', 'admin-editor-identity');
      appendChildren(identity, [
        makeElement('span', 'admin-editor-id-label', 'معرّف الرتبة الثابت'),
        makeElement('code', 'admin-editor-id', String(source.rankId || 'معرّف مفقود')),
        makeElement('span', 'admin-editor-version', `الإصدار: ${String(source.version || 'غير صالح')}`),
        makeStatusBadge(source.status)
      ]);
      dialog.append(identity);
    }

    const form = makeElement('form', 'admin-world-form admin-rank-form');
    const grid = makeElement('div', 'admin-form-grid');
    [
      { name: 'title', label: 'عنوان الرتبة', value: seed.title, required: true, maxLength: 120, placeholder: 'مثال: المبتدئ' },
      { name: 'order', label: 'الترتيب', value: seed.order, type: 'number', required: true, min: 0, max: 1000000, step: 1, help: 'الرقم الأصغر يظهر أولًا.' },
      { name: 'subtitle', label: 'وصف مختصر', value: seed.subtitle, maxLength: 180, wide: true },
      { name: 'description', label: 'الوصف', value: seed.description, maxLength: 2000, multiline: true, rows: 5, wide: true },
      { name: 'difficulty', label: 'الصعوبة', value: seed.difficulty, maxLength: 80 }
    ].forEach((definition) => grid.append(makeField(definition).wrapper));
    grid.append(makeSelectField({
      name: 'initialStatus',
      label: 'الإتاحة الأولية',
      value: seed.initialStatus,
      required: true,
      options: [
        { value: 'locked', label: 'مقفلة' },
        { value: 'available', label: 'متاحة' }
      ],
      help: 'هذا إعداد أولي فقط؛ منطق الفتح اللاحق لم يُحسم.'
    }).wrapper);
    form.append(grid);
    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    form.append(errorBox);
    const footer = makeElement('footer', 'admin-modal-footer');
    const cancelButton = makeButton('إلغاء', 'close-modal', { className: 'admin-btn admin-btn-secondary' });
    const saveButton = makeButton('حفظ الرتبة', null, { className: 'admin-btn admin-btn-primary', type: 'submit' });
    appendChildren(footer, [cancelButton, saveButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);

    const modalState = {
      kind: 'rank-editor',
      mode: mode === 'edit' ? 'edit' : 'create',
      world,
      rank: mode === 'edit' ? source : null,
      overlay,
      form,
      errorBox,
      closeButton,
      saveButton,
      pending: false,
      dirty: false,
      initialSignature: '',
      returnFocus
    };
    modalState.initialSignature = rankFormSignature(form);
    ui.modal = modalState;
    const syncDirty = () => {
      modalState.dirty = rankFormSignature(form) !== modalState.initialSignature;
    };
    form.addEventListener('input', syncDirty);
    form.addEventListener('change', syncDirty);
    form.addEventListener('submit', (event) => saveRankEditor(event, modalState));
    const firstInput = form.elements.namedItem('title');
    if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
  }

  async function saveRankEditor(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending) return;
    modalState.errorBox.hidden = true;
    modalState.errorBox.replaceChildren();
    if (!modalState.form.checkValidity()) {
      modalState.form.reportValidity();
      return;
    }
    let validation;
    try {
      validation = validateRankPayload(modalState.form, modalState);
    } catch (error) {
      validation = { ok: false, errors: [{ path: 'rank', code: getErrorCode(error, 'schema/validation-failed') }] };
    }
    if (!validation.ok) {
      renderFormIssues(modalState.errorBox, validation.errors || [], 'تعذر التحقق من بيانات الرتبة:');
      return;
    }
    setRankEditorPending(modalState, true);
    try {
      const api = getCloudApi();
      if (modalState.mode === 'edit') {
        await api.updateRank(
          String(modalState.world.worldId),
          String(modalState.rank.rankId),
          validation.payload,
          expectedVersion(modalState.rank)
        );
      } else {
        await api.createRank(String(modalState.world.worldId), validation.payload);
      }
      modalState.dirty = false;
      setRankEditorPending(modalState, false);
      closeAdminModal(true);
      notify(modalState.mode === 'edit' ? 'تم حفظ الرتبة.' : 'تم إنشاء الرتبة كمسودة.', 'success');
      if (modalState.mode !== 'edit') await refreshWorlds({ clear: false });
      await refreshRanks({ clear: false });
    } catch (error) {
      if (ui.modal !== modalState) return;
      setRankEditorPending(modalState, false);
      renderFormIssues(modalState.errorBox, [
        { path: 'cloud', code: getErrorCode(error, 'admin/rank-save-failed') }
      ], 'تعذر حفظ الرتبة. بقيت بياناتك في المحرر:');
    }
  }

  async function loadFreshRankForEditor(world, rankId, returnFocus) {
    const listed = findRank(rankId);
    if (!world || !listed) {
      setRankActionError('تعذر العثور على الرتبة.', { code: 'content/rank-not-found' });
      return;
    }
    const key = `rank:${world.worldId}:${rankId}:read`;
    if (ui.actionKeys.has(key)) return;
    setActionPending(key, true);
    try {
      const record = await getCloudApi().getRank(String(world.worldId), String(rankId));
      const fresh = normalizeRankRecord(record, world.worldId);
      if (!fresh || !fresh.rankId) {
        const error = new Error('content/rank-not-found');
        error.code = 'content/rank-not-found';
        throw error;
      }
      setActionPending(key, false);
      openRankEditor(world, fresh, 'edit', returnFocus);
    } catch (error) {
      setActionPending(key, false);
      setRankActionError('تعذر فتح محرر الرتبة.', error);
    }
  }

  function gateEditorSeed(gate) {
    const source = gate || {};
    const storedRatio = source.entryAssessmentPassRatio;
    return {
      title: String(source.title || ''),
      subtitle: String(source.subtitle || ''),
      description: String(source.description || ''),
      order: cachedCount(source.order),
      difficulty: String(source.difficulty || ''),
      entryAssessmentPassPercent: storedRatio === null || storedRatio === undefined
        ? ''
        : String(Number(storedRatio) * 100)
    };
  }

  function collectGateForm(form) {
    const data = new FormData(form);
    const rawThreshold = String(data.get('entryAssessmentPassPercent') || '').trim();
    return {
      title: String(data.get('title') || '').trim(),
      subtitle: String(data.get('subtitle') || '').trim(),
      description: String(data.get('description') || '').trim(),
      order: Number(data.get('order')),
      difficulty: String(data.get('difficulty') || '').trim(),
      entryAssessmentPassRatio: rawThreshold === '' ? null : Number(rawThreshold) / 100
    };
  }

  function gateFormSignature(form) {
    return JSON.stringify(collectGateForm(form));
  }

  function gateUnlockPlaceholder(source) {
    if (source && source.unlockConfig && typeof source.unlockConfig === 'object') {
      return { ...source.unlockConfig };
    }
    return {
      mode: 'manual_placeholder',
      initialStatus: 'locked',
      requiredMasteredRatio: null,
      requiredReviewingRatio: null,
      requiredGateCount: null
    };
  }

  function validateGatePayload(form, modalState) {
    const values = collectGateForm(form);
    const source = modalState.gate || {};
    const candidate = {
      schemaVersion: Number(source.schemaVersion) || 1,
      worldId: String(modalState.world.worldId),
      rankId: String(modalState.rank.rankId),
      gateId: source.gateId || 'pending-gate',
      ...values,
      status: modalState.mode === 'edit' ? source.status : 'draft',
      version: modalState.mode === 'edit' ? Number(source.version) : 1,
      wordCount: modalState.mode === 'edit' ? cachedCount(source.wordCount) : 0,
      unlockConfig: gateUnlockPlaceholder(source)
    };
    const schema = root.LootLinguaContentSchema;
    if (!schema || typeof schema.validateGate !== 'function') {
      return { ok: false, errors: [{ path: 'schema', code: 'schema/unavailable' }] };
    }
    const result = schema.validateGate(candidate, {
      worldId: String(modalState.world.worldId),
      rankId: String(modalState.rank.rankId),
      gateId: String(candidate.gateId)
    });
    if (!result.ok) return result;
    const payload = {};
    EDITABLE_GATE_FIELDS.forEach((field) => {
      payload[field] = result.value[field];
    });
    payload.schemaVersion = result.value.schemaVersion;
    if (modalState.mode !== 'edit') {
      payload.status = 'draft';
      payload.version = 1;
      payload.wordCount = 0;
    }
    return { ok: true, payload };
  }

  function setGateEditorPending(modalState, pending) {
    modalState.pending = Boolean(pending);
    modalState.form.setAttribute('aria-busy', pending ? 'true' : 'false');
    modalState.saveButton.disabled = Boolean(pending);
    modalState.closeButton.disabled = Boolean(pending);
    modalState.saveButton.textContent = pending ? 'جارٍ الحفظ…' : 'حفظ البوابة';
  }

  function openGateEditor(world, rank, gate, mode, returnFocus) {
    closeAdminModal(true);
    const source = gate || null;
    const seed = gateEditorSeed(source);
    const defaultRatio = entryAssessmentDefaultRatio();
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-gate-editor');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminGateEditorTitle');

    const modalHeader = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    heading.append(makeGateBreadcrumb(world, rank, source ? String(source.title || 'البوابة') : 'بوابة جديدة'));
    const title = makeElement('h2', 'admin-modal-title', mode === 'edit' ? 'تعديل البوابة' : 'إنشاء بوابة');
    title.id = 'adminGateEditorTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', 'احفظ البوابة كمسودة، ثم راجع كلماتها وعتبة اختبار الدخول قبل النشر.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close', title: 'إغلاق محرر البوابة'
    });
    closeButton.setAttribute('aria-label', 'إغلاق محرر البوابة');
    appendChildren(modalHeader, [heading, closeButton]);
    dialog.append(modalHeader);

    if (source && mode === 'edit') {
      const identity = makeElement('div', 'admin-editor-identity');
      appendChildren(identity, [
        makeElement('span', 'admin-editor-id-label', 'معرّف البوابة الثابت'),
        makeElement('code', 'admin-editor-id', String(source.gateId || 'معرّف مفقود')),
        makeElement('span', 'admin-editor-version', `الإصدار: ${String(source.version || 'غير صالح')}`),
        makeStatusBadge(source.status)
      ]);
      dialog.append(identity);
    }

    const form = makeElement('form', 'admin-world-form admin-gate-form');
    const grid = makeElement('div', 'admin-form-grid');
    [
      { name: 'title', label: 'عنوان البوابة', value: seed.title, required: true, maxLength: 120, placeholder: 'مثال: بوابة المفردات الأساسية' },
      { name: 'order', label: 'الترتيب', value: seed.order, type: 'number', required: true, min: 0, max: 1000000, step: 1, help: 'الرقم الأصغر يظهر أولًا.' },
      { name: 'subtitle', label: 'وصف مختصر', value: seed.subtitle, maxLength: 180, wide: true },
      { name: 'description', label: 'الوصف', value: seed.description, maxLength: 2000, multiline: true, rows: 5, wide: true },
      { name: 'difficulty', label: 'الصعوبة', value: seed.difficulty, maxLength: 80 },
      {
        name: 'entryAssessmentPassPercent',
        label: 'عتبة اجتياز اختبار الدخول (%)',
        value: seed.entryAssessmentPassPercent,
        type: 'number',
        min: 0.01,
        max: 100,
        step: 0.01,
        placeholder: formatAssessmentPercent(defaultRatio),
        help: `اختياري؛ اتركه فارغًا لاستخدام الافتراضي المركزي ${formatAssessmentPercent(defaultRatio)}. هذه العتبة لاختبار الدخول فقط؛ منطق الفتح بعد التعلّم لم يُحسم.`
      }
    ].forEach((definition) => grid.append(makeField(definition).wrapper));
    form.append(grid);
    const assessmentNote = makeElement('div', 'admin-assessment-note admin-assessment-note-compact');
    appendChildren(assessmentNote, [
      makeElement('strong', 'admin-assessment-note-title', 'لا يؤثر في مكافآت التعلّم'),
      makeElement('span', 'admin-assessment-note-copy', 'تقييم الدخول منفصل عن اختبارات XP والإتقان والمراجعة المتباعدة.')
    ]);
    form.append(assessmentNote);
    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    form.append(errorBox);
    const footer = makeElement('footer', 'admin-modal-footer');
    const cancelButton = makeButton('إلغاء', 'close-modal', { className: 'admin-btn admin-btn-secondary' });
    const saveButton = makeButton('حفظ البوابة', null, { className: 'admin-btn admin-btn-primary', type: 'submit' });
    appendChildren(footer, [cancelButton, saveButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);

    const modalState = {
      kind: 'gate-editor',
      mode: mode === 'edit' ? 'edit' : 'create',
      world,
      rank,
      gate: mode === 'edit' ? source : null,
      adminUid: String(getAdminState().uid || ''),
      overlay,
      form,
      errorBox,
      closeButton,
      saveButton,
      pending: false,
      dirty: false,
      initialSignature: '',
      returnFocus
    };
    modalState.initialSignature = gateFormSignature(form);
    ui.modal = modalState;
    const syncDirty = () => {
      modalState.dirty = gateFormSignature(form) !== modalState.initialSignature;
    };
    form.addEventListener('input', syncDirty);
    form.addEventListener('change', syncDirty);
    form.addEventListener('submit', (event) => saveGateEditor(event, modalState));
    const firstInput = form.elements.namedItem('title');
    if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
  }

  function adminContextMatches(uid) {
    const state = getAdminState();
    return Boolean(state.resolved && state.isAdmin && String(state.uid || '') === String(uid || ''));
  }

  async function saveGateEditor(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending) return;
    modalState.errorBox.hidden = true;
    modalState.errorBox.replaceChildren();
    if (!modalState.form.checkValidity()) {
      modalState.form.reportValidity();
      return;
    }
    let validation;
    try {
      validation = validateGatePayload(modalState.form, modalState);
    } catch (error) {
      validation = { ok: false, errors: [{ path: 'gate', code: getErrorCode(error, 'schema/validation-failed') }] };
    }
    if (!validation.ok) {
      renderFormIssues(modalState.errorBox, validation.errors || [], 'تعذر التحقق من بيانات البوابة:');
      return;
    }
    setGateEditorPending(modalState, true);
    try {
      const api = getCloudApi();
      if (modalState.mode === 'edit') {
        await api.updateGate(
          String(modalState.world.worldId),
          String(modalState.rank.rankId),
          String(modalState.gate.gateId),
          validation.payload,
          expectedVersion(modalState.gate)
        );
      } else {
        await api.createGate(
          String(modalState.world.worldId),
          String(modalState.rank.rankId),
          validation.payload
        );
      }
      if (ui.modal !== modalState || !adminContextMatches(modalState.adminUid)) return;
      modalState.dirty = false;
      setGateEditorPending(modalState, false);
      closeAdminModal(true);
      notify(modalState.mode === 'edit' ? 'تم حفظ البوابة.' : 'تم إنشاء البوابة كمسودة.', 'success');
      if (modalState.mode !== 'edit') await refreshWorlds({ clear: false });
      await refreshGates({ clear: false });
    } catch (error) {
      if (ui.modal !== modalState || !adminContextMatches(modalState.adminUid)) return;
      setGateEditorPending(modalState, false);
      renderFormIssues(modalState.errorBox, [
        { path: 'cloud', code: getErrorCode(error, 'admin/gate-save-failed') }
      ], 'تعذر حفظ البوابة. بقيت بياناتك في المحرر:');
    }
  }

  async function loadFreshGateForEditor(world, rank, gateId, returnFocus) {
    const listed = findGate(gateId);
    if (!world || !rank || !listed) {
      setGateActionError('تعذر العثور على البوابة.', { code: 'content/gate-not-found' });
      return;
    }
    const key = `gate:${world.worldId}:${rank.rankId}:${gateId}:read`;
    if (ui.actionKeys.has(key)) return;
    const adminUid = String(getAdminState().uid || '');
    setActionPending(key, true);
    try {
      const record = await getCloudApi().getGate(String(world.worldId), String(rank.rankId), String(gateId));
      if (!adminContextMatches(adminUid)) return;
      const fresh = normalizeGateRecord(record, world.worldId, rank.rankId);
      if (!fresh || !fresh.gateId) {
        const error = new Error('content/gate-not-found');
        error.code = 'content/gate-not-found';
        throw error;
      }
      setActionPending(key, false);
      openGateEditor(world, rank, fresh, 'edit', returnFocus);
    } catch (error) {
      ui.actionKeys.delete(key);
      if (!adminContextMatches(adminUid)) return;
      renderGates();
      setGateActionError('تعذر فتح محرر البوابة.', error);
    }
  }

  function splitWordList(value) {
    const seen = new Set();
    return String(value || '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => {
        const key = item.toLowerCase();
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function wordEditorSeed(word) {
    const source = word || {};
    return {
      word: String(source.word || ''),
      translation: String(source.translation || ''),
      definition: String(source.definition || ''),
      definition_ar: String(source.definition_ar || ''),
      example: String(source.example || ''),
      exampleTranslation: String(source.exampleTranslation || ''),
      category: String(source.category || ''),
      partOfSpeech: String(source.partOfSpeech || ''),
      level: String(source.level || ''),
      tags: Array.isArray(source.tags) ? source.tags.join(', ') : '',
      synonyms: Array.isArray(source.synonyms) ? source.synonyms.join('\n') : '',
      pronunciation: String(source.pronunciation || ''),
      audioUrl: String(source.audioUrl || ''),
      imageUrl: String(source.imageUrl || ''),
      notes: String(source.notes || ''),
      order: cachedCount(source.order)
    };
  }

  function collectWordForm(form) {
    const data = new FormData(form);
    return {
      word: String(data.get('word') || '').trim(),
      translation: String(data.get('translation') || '').trim(),
      definition: String(data.get('definition') || '').trim(),
      definition_ar: String(data.get('definition_ar') || '').trim(),
      example: String(data.get('example') || '').trim(),
      exampleTranslation: String(data.get('exampleTranslation') || '').trim(),
      category: String(data.get('category') || '').trim(),
      partOfSpeech: String(data.get('partOfSpeech') || '').trim(),
      level: String(data.get('level') || '').trim(),
      tags: splitWordList(data.get('tags')),
      synonyms: splitWordList(data.get('synonyms')),
      pronunciation: String(data.get('pronunciation') || '').trim(),
      audioUrl: String(data.get('audioUrl') || '').trim(),
      imageUrl: String(data.get('imageUrl') || '').trim(),
      notes: String(data.get('notes') || '').trim(),
      order: Number(data.get('order'))
    };
  }

  function wordFormSignature(form) {
    return JSON.stringify(collectWordForm(form));
  }

  function validateWordPayload(form, modalState) {
    const values = collectWordForm(form);
    const source = modalState.word || {};
    const schema = root.LootLinguaContentSchema;
    if (!schema || typeof schema.validateWord !== 'function') {
      return { ok: false, errors: [{ path: 'schema', code: 'schema/unavailable' }] };
    }
    const candidate = {
      schemaVersion: Number(source.schemaVersion) || 1,
      normalizationVersion: Number(source.normalizationVersion) || Number(schema.NORMALIZATION_VERSION) || 1,
      worldId: String(modalState.world.worldId),
      rankId: String(modalState.rank.rankId),
      gateId: String(modalState.gate.gateId),
      contentWordId: source.contentWordId || 'pending-word',
      ...values,
      status: modalState.mode === 'edit' ? source.status : 'draft',
      version: modalState.mode === 'edit' ? Number(source.version) : 1
    };
    const result = schema.validateWord(candidate, {
      worldId: candidate.worldId,
      rankId: candidate.rankId,
      gateId: candidate.gateId,
      contentWordId: candidate.contentWordId
    });
    if (!result.ok) return result;
    const payload = {};
    EDITABLE_WORD_FIELDS.forEach((field) => {
      payload[field] = result.value[field];
    });
    payload.schemaVersion = result.value.schemaVersion;
    payload.normalizationVersion = result.value.normalizationVersion;
    payload.normalizedWord = result.value.normalizedWord;
    payload.wordKey = result.value.wordKey;
    if (modalState.mode !== 'edit') {
      payload.status = 'draft';
      payload.version = 1;
    }
    return { ok: true, payload };
  }

  function setWordEditorPending(modalState, pending) {
    modalState.pending = Boolean(pending);
    modalState.form.setAttribute('aria-busy', pending ? 'true' : 'false');
    modalState.saveButton.disabled = Boolean(pending || modalState.localDuplicate);
    modalState.closeButton.disabled = Boolean(pending);
    modalState.saveButton.textContent = pending ? 'جارٍ الحفظ…' : 'حفظ الكلمة';
  }

  function syncWordIdentityPreview(modalState) {
    const input = modalState.form.elements.namedItem('word');
    const schema = root.LootLinguaContentSchema;
    const normalized = schema && typeof schema.normalizeWord === 'function'
      ? schema.normalizeWord(input && input.value)
      : String(input && input.value || '').toLowerCase().trim().replace(/\s+/g, ' ');
    modalState.identityValue.textContent = normalized || '—';
    const sourceId = String(modalState.word && modalState.word.contentWordId || '');
    modalState.localDuplicate = Boolean(normalized && ui.words.some((word) => (
      String(word.contentWordId || '') !== sourceId && String(word.normalizedWord || '') === normalized
    )));
    modalState.duplicateNote.classList.toggle('admin-word-duplicate-blocking', modalState.localDuplicate);
    modalState.duplicateNote.textContent = modalState.localDuplicate
      ? 'هذه الهوية موجودة في الصفحة المحملة من البوابة نفسها. طبقة البيانات تمنع التكرار حتى لو كانت النسخة في صفحة أخرى.'
      : 'التكرار داخل البوابة ممنوع في طبقة البيانات. التكرار داخل الرتبة أو العالم مسموح مع تحذير للمراجعة.';
    modalState.saveButton.disabled = modalState.pending || modalState.localDuplicate;
  }

  function openWordEditor(world, rank, gate, word, mode, returnFocus) {
    closeAdminModal(true);
    const source = word || null;
    const seed = wordEditorSeed(source);
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-word-editor');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminWordEditorTitle');

    const modalHeader = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    heading.append(makeWordBreadcrumb(world, rank, gate, source ? String(source.word || 'الكلمة') : 'كلمة جديدة'));
    const title = makeElement('h2', 'admin-modal-title', mode === 'edit' ? 'تعديل الكلمة' : 'إنشاء كلمة');
    title.id = 'adminWordEditorTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', 'تُشتق الهوية الموحّدة ومفتاح الإتقان مركزيًا. تصحيح يغيّر الهوية يتطلب إنشاء كلمة جديدة بدل استبدال هوية السجل الحالي.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close', title: 'إغلاق محرر الكلمة'
    });
    closeButton.setAttribute('aria-label', 'إغلاق محرر الكلمة');
    appendChildren(modalHeader, [heading, closeButton]);
    dialog.append(modalHeader);

    if (source && mode === 'edit') {
      const identity = makeElement('div', 'admin-editor-identity');
      appendChildren(identity, [
        makeElement('span', 'admin-editor-id-label', 'معرّف الكلمة الثابت'),
        makeElement('code', 'admin-editor-id', String(source.contentWordId || 'معرّف مفقود')),
        makeElement('span', 'admin-editor-version', `الإصدار: ${String(source.version || 'غير صالح')}`),
        makeStatusBadge(source.status)
      ]);
      dialog.append(identity);
    }

    const form = makeElement('form', 'admin-world-form admin-word-form');
    const grid = makeElement('div', 'admin-form-grid admin-word-form-grid');
    [
      { name: 'word', label: 'الكلمة', value: seed.word, required: true, maxLength: 180, placeholder: 'مثال: treasure', help: mode === 'edit' ? 'يمكن تغيير حالة الأحرف أو المسافات فقط إذا بقيت الهوية الموحّدة نفسها.' : 'تُستخدم لتوليد الهوية الموحّدة ومفتاح الإتقان.' },
      { name: 'translation', label: 'الترجمة', value: seed.translation, required: true, maxLength: 500 },
      { name: 'definition', label: 'التعريف', value: seed.definition, maxLength: 2000, multiline: true, rows: 4, wide: true },
      { name: 'definition_ar', label: 'التعريف العربي', value: seed.definition_ar, maxLength: 2000, multiline: true, rows: 4, wide: true },
      { name: 'example', label: 'مثال', value: seed.example, maxLength: 2000, multiline: true, rows: 3, wide: true },
      { name: 'exampleTranslation', label: 'ترجمة المثال', value: seed.exampleTranslation, maxLength: 2000, multiline: true, rows: 3, wide: true },
      { name: 'category', label: 'التصنيف', value: seed.category, maxLength: 120 },
      { name: 'partOfSpeech', label: 'نوع الكلمة', value: seed.partOfSpeech, maxLength: 120 },
      { name: 'level', label: 'المستوى', value: seed.level, maxLength: 120 },
      { name: 'order', label: 'الترتيب', value: seed.order, type: 'number', required: true, min: 0, max: 1000000, step: 1 },
      { name: 'tags', label: 'الوسوم', value: seed.tags, maxLength: 1000, wide: true, help: 'افصل الوسوم بفاصلة.' },
      { name: 'synonyms', label: 'المرادفات', value: seed.synonyms, maxLength: 2000, multiline: true, rows: 3, wide: true, help: 'مرادف واحد في كل سطر أو افصل بفاصلة.' },
      { name: 'pronunciation', label: 'النطق', value: seed.pronunciation, maxLength: 300 },
      { name: 'audioUrl', label: 'رابط الصوت', value: seed.audioUrl, type: 'url', maxLength: 2000 },
      { name: 'imageUrl', label: 'رابط الصورة', value: seed.imageUrl, type: 'url', maxLength: 2000, wide: true },
      { name: 'notes', label: 'ملاحظات الإدارة', value: seed.notes, maxLength: 3000, multiline: true, rows: 4, wide: true }
    ].forEach((definition) => grid.append(makeField(definition).wrapper));
    form.append(grid);
    const identityPreview = makeElement('div', 'admin-word-identity-preview');
    const identityValue = makeElement('code', 'admin-editor-id', '—');
    appendChildren(identityPreview, [makeElement('strong', '', 'normalizedWord:'), identityValue]);
    form.append(identityPreview);
    const duplicateNote = makeElement('div', 'admin-word-duplicate-warning');
    duplicateNote.setAttribute('role', 'note');
    form.append(duplicateNote);
    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    form.append(errorBox);
    const footer = makeElement('footer', 'admin-modal-footer');
    const cancelButton = makeButton('إلغاء', 'close-modal', { className: 'admin-btn admin-btn-secondary' });
    const saveButton = makeButton('حفظ الكلمة', null, { className: 'admin-btn admin-btn-primary', type: 'submit' });
    appendChildren(footer, [cancelButton, saveButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);

    const modalState = {
      kind: 'word-editor',
      mode: mode === 'edit' ? 'edit' : 'create',
      world,
      rank,
      gate,
      word: mode === 'edit' ? source : null,
      adminUid: String(getAdminState().uid || ''),
      overlay,
      form,
      errorBox,
      duplicateNote,
      identityValue,
      closeButton,
      saveButton,
      pending: false,
      localDuplicate: false,
      dirty: false,
      initialSignature: '',
      returnFocus
    };
    modalState.initialSignature = wordFormSignature(form);
    ui.modal = modalState;
    const syncEditor = () => {
      modalState.dirty = wordFormSignature(form) !== modalState.initialSignature;
      syncWordIdentityPreview(modalState);
    };
    form.addEventListener('input', syncEditor);
    form.addEventListener('change', syncEditor);
    form.addEventListener('submit', (event) => saveWordEditor(event, modalState));
    syncWordIdentityPreview(modalState);
    const firstInput = form.elements.namedItem('word');
    if (firstInput && typeof firstInput.focus === 'function') firstInput.focus();
  }

  async function saveWordEditor(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending || modalState.localDuplicate) return;
    modalState.errorBox.hidden = true;
    modalState.errorBox.replaceChildren();
    if (!modalState.form.checkValidity()) {
      modalState.form.reportValidity();
      return;
    }
    let validation;
    try {
      validation = validateWordPayload(modalState.form, modalState);
    } catch (error) {
      validation = { ok: false, errors: [{ path: 'word', code: getErrorCode(error, 'schema/validation-failed') }] };
    }
    if (!validation.ok) {
      renderFormIssues(modalState.errorBox, validation.errors || [], 'تعذر التحقق من بيانات الكلمة:');
      return;
    }
    setWordEditorPending(modalState, true);
    try {
      const api = getCloudApi();
      if (modalState.mode === 'edit') {
        await api.updateWord(
          String(modalState.world.worldId),
          String(modalState.rank.rankId),
          String(modalState.gate.gateId),
          String(modalState.word.contentWordId),
          validation.payload,
          expectedVersion(modalState.word)
        );
      } else {
        await api.createWord(
          String(modalState.world.worldId),
          String(modalState.rank.rankId),
          String(modalState.gate.gateId),
          validation.payload
        );
      }
      if (ui.modal !== modalState || !adminContextMatches(modalState.adminUid)) return;
      modalState.dirty = false;
      setWordEditorPending(modalState, false);
      closeAdminModal(true);
      notify(modalState.mode === 'edit' ? 'تم حفظ الكلمة.' : 'تم إنشاء الكلمة كمسودة.', 'success');
      await refreshWords({ append: false });
    } catch (error) {
      if (ui.modal !== modalState || !adminContextMatches(modalState.adminUid)) return;
      setWordEditorPending(modalState, false);
      const code = getErrorCode(error, 'admin/word-save-failed');
      renderFormIssues(modalState.errorBox, [{ path: 'cloud', code }],
        code === 'content/word-identity-immutable'
          ? 'هوية الكلمة غير قابلة للاستبدال؛ أنشئ كلمة جديدة للتصحيح الذي يغيّر normalizedWord:'
          : 'تعذر حفظ الكلمة. بقيت بياناتك في المحرر:');
    }
  }

  async function loadFreshWordForEditor(world, rank, gate, contentWordId, returnFocus) {
    const listed = findWord(contentWordId);
    if (!world || !rank || !gate || !listed) {
      setWordActionError('تعذر العثور على الكلمة.', { code: 'content/word-not-found' });
      return;
    }
    const key = `word:${world.worldId}:${rank.rankId}:${gate.gateId}:${contentWordId}:read`;
    if (ui.actionKeys.has(key)) return;
    const adminUid = String(getAdminState().uid || '');
    setActionPending(key, true);
    try {
      const record = await getCloudApi().getWord(
        String(world.worldId), String(rank.rankId), String(gate.gateId), String(contentWordId)
      );
      if (!adminContextMatches(adminUid)) return;
      const fresh = normalizeWordRecord(record, world.worldId, rank.rankId, gate.gateId);
      if (!fresh || !fresh.contentWordId) {
        const error = new Error('content/word-not-found');
        error.code = 'content/word-not-found';
        throw error;
      }
      setActionPending(key, false);
      openWordEditor(world, rank, gate, fresh, 'edit', returnFocus);
    } catch (error) {
      ui.actionKeys.delete(key);
      if (!adminContextMatches(adminUid)) return;
      renderWords();
      setWordActionError('تعذر فتح محرر الكلمة.', error);
    }
  }

  async function changeWorldStatus(world, nextStatus) {
    if (!world || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, nextStatus)) return;
    const transitions = {
      draft: ['published', 'archived'],
      published: ['archived'],
      archived: ['draft']
    };
    if (!(transitions[world.status] || []).includes(nextStatus)) {
      setPageActionError('هذا الانتقال غير مسموح.', { code: 'content/invalid-status-transition' });
      return;
    }
    const question = nextStatus === 'published'
      ? `نشر العالم «${String(world.title || '')}» للمستخدمين؟`
      : (nextStatus === 'archived'
        ? `أرشفة العالم «${String(world.title || '')}»؟ لن يظهر كمحتوى منشور.`
        : `إعادة العالم «${String(world.title || '')}» إلى مسودة؟`);
    if (!root.confirm(question)) return;
    const key = `world:${world.worldId}:status`;
    setActionPending(key, true);
    try {
      await getCloudApi().setWorldStatus(
        String(world.worldId),
        nextStatus,
        expectedVersion(world)
      );
      notify(`تم تحديث حالة العالم إلى: ${statusLabel(nextStatus)}.`, 'success');
      await refreshWorlds({ clear: false });
    } catch (error) {
      setPageActionError('تعذر تحديث حالة العالم.', error);
    } finally {
      ui.actionKeys.delete(key);
      renderDashboard();
    }
  }

  async function changeRankStatus(world, rank, nextStatus) {
    if (!world || !rank || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, nextStatus)) return;
    const transitions = {
      draft: ['published', 'archived'],
      published: ['archived'],
      archived: ['draft']
    };
    if (!(transitions[rank.status] || []).includes(nextStatus)) {
      setRankActionError('هذا الانتقال غير مسموح.', { code: 'content/invalid-status-transition' });
      return;
    }
    const question = nextStatus === 'published'
      ? `نشر الرتبة «${String(rank.title || '')}»؟`
      : (nextStatus === 'archived'
        ? `أرشفة الرتبة «${String(rank.title || '')}»؟`
        : `إعادة الرتبة «${String(rank.title || '')}» إلى مسودة؟`);
    if (!root.confirm(question)) return;
    const key = `rank:${world.worldId}:${rank.rankId}:status`;
    if (ui.actionKeys.has(key)) return;
    setActionPending(key, true);
    try {
      await getCloudApi().setRankStatus(
        String(world.worldId),
        String(rank.rankId),
        nextStatus,
        expectedVersion(rank)
      );
      notify(`تم تحديث حالة الرتبة إلى: ${statusLabel(nextStatus)}.`, 'success');
      await refreshRanks({ clear: false });
    } catch (error) {
      setRankActionError('تعذر تحديث حالة الرتبة.', error);
    } finally {
      ui.actionKeys.delete(key);
      renderRanks();
    }
  }

  async function duplicateRankAsDraft(world, rank) {
    if (!world || !rank) return;
    if (!root.confirm(`إنشاء نسخة مسودة كاملة من الرتبة «${String(rank.title || '')}»؟`)) return;
    const key = `rank:${world.worldId}:${rank.rankId}:duplicate`;
    if (ui.actionKeys.has(key)) return;
    setActionPending(key, true);
    try {
      await getCloudApi().duplicateRankAsDraft(
        String(world.worldId),
        String(rank.rankId),
        expectedVersion(rank)
      );
      notify('تم نسخ الرتبة كمسودة.', 'success');
      await refreshWorlds({ clear: false });
      await refreshRanks({ clear: false });
    } catch (error) {
      setRankActionError('تعذر نسخ الرتبة.', error);
    } finally {
      ui.actionKeys.delete(key);
      renderRanks();
    }
  }

  async function changeGateStatus(world, rank, gate, nextStatus) {
    if (!world || !rank || !gate || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, nextStatus)) return;
    const transitions = {
      draft: ['published', 'archived'],
      published: ['archived'],
      archived: ['draft']
    };
    if (!(transitions[gate.status] || []).includes(nextStatus)) {
      setGateActionError('هذا الانتقال غير مسموح.', { code: 'content/invalid-status-transition' });
      return;
    }
    const question = nextStatus === 'published'
      ? `نشر البوابة «${String(gate.title || '')}»؟`
      : (nextStatus === 'archived'
        ? `أرشفة البوابة «${String(gate.title || '')}»؟`
        : `إعادة البوابة «${String(gate.title || '')}» إلى مسودة؟`);
    if (!root.confirm(question)) return;
    const key = `gate:${world.worldId}:${rank.rankId}:${gate.gateId}:status`;
    if (ui.actionKeys.has(key)) return;
    const adminUid = String(getAdminState().uid || '');
    setActionPending(key, true);
    try {
      await getCloudApi().setGateStatus(
        String(world.worldId),
        String(rank.rankId),
        String(gate.gateId),
        nextStatus,
        expectedVersion(gate)
      );
      if (!adminContextMatches(adminUid)) return;
      notify(`تم تحديث حالة البوابة إلى: ${statusLabel(nextStatus)}.`, 'success');
      await refreshGates({ clear: false });
    } catch (error) {
      if (adminContextMatches(adminUid)) setGateActionError('تعذر تحديث حالة البوابة.', error);
    } finally {
      ui.actionKeys.delete(key);
      if (ui.view === 'gates') renderGates();
    }
  }

  async function duplicateGateAsDraft(world, rank, gate) {
    if (!world || !rank || !gate) return;
    if (!root.confirm(`إنشاء نسخة مسودة كاملة من البوابة «${String(gate.title || '')}» مع كلماتها؟`)) return;
    const key = `gate:${world.worldId}:${rank.rankId}:${gate.gateId}:duplicate`;
    if (ui.actionKeys.has(key)) return;
    const adminUid = String(getAdminState().uid || '');
    setActionPending(key, true);
    try {
      await getCloudApi().duplicateGateAsDraft(
        String(world.worldId),
        String(rank.rankId),
        String(gate.gateId),
        expectedVersion(gate)
      );
      if (!adminContextMatches(adminUid)) return;
      notify('تم نسخ البوابة وكلماتها كمسودة.', 'success');
      await refreshWorlds({ clear: false });
      await refreshGates({ clear: false });
    } catch (error) {
      if (adminContextMatches(adminUid)) setGateActionError('تعذر نسخ البوابة.', error);
    } finally {
      ui.actionKeys.delete(key);
      if (ui.view === 'gates') renderGates();
    }
  }

  function wordSelectionPayload() {
    const selected = ui.words
      .filter((word) => ui.selectedWordIds.has(String(word.contentWordId || '')));
    if (selected.length > MAX_BULK_WORDS) {
      const error = new Error('content/invalid-bulk-size');
      error.code = 'content/invalid-bulk-size';
      throw error;
    }
    return selected.map((word) => ({
      contentWordId: String(word.contentWordId),
      expectedVersion: expectedVersion(word)
    }));
  }

  async function changeWordStatus(world, rank, gate, word, nextStatus) {
    if (!world || !rank || !gate || !word || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, nextStatus)) return;
    const transitions = {
      draft: ['published', 'archived'],
      published: ['archived'],
      archived: ['draft']
    };
    if (!(transitions[word.status] || []).includes(nextStatus)) {
      setWordActionError('هذا الانتقال غير مسموح.', { code: 'content/invalid-status-transition' });
      return;
    }
    const question = nextStatus === 'published'
      ? `نشر الكلمة «${String(word.word || '')}»؟`
      : (nextStatus === 'archived'
        ? `أرشفة الكلمة «${String(word.word || '')}»؟`
        : `إعادة الكلمة «${String(word.word || '')}» إلى مسودة؟`);
    if (!root.confirm(question)) return;
    const key = `word:${world.worldId}:${rank.rankId}:${gate.gateId}:${word.contentWordId}:status`;
    if (ui.actionKeys.has(key)) return;
    const adminUid = String(getAdminState().uid || '');
    setActionPending(key, true);
    try {
      await getCloudApi().setWordStatus(
        String(world.worldId), String(rank.rankId), String(gate.gateId),
        String(word.contentWordId), nextStatus, expectedVersion(word)
      );
      if (!adminContextMatches(adminUid)) return;
      notify(`تم تحديث حالة الكلمة إلى: ${statusLabel(nextStatus)}.`, 'success');
      await refreshWords({ append: false });
    } catch (error) {
      if (adminContextMatches(adminUid)) setWordActionError('تعذر تحديث حالة الكلمة.', error);
    } finally {
      ui.actionKeys.delete(key);
      if (ui.view === 'words') renderWords();
    }
  }

  async function archiveWord(world, rank, gate, word) {
    if (!world || !rank || !gate || !word || !['draft', 'published'].includes(word.status)) return;
    if (!root.confirm(`أرشفة الكلمة «${String(word.word || '')}»؟`)) return;
    const key = `word:${world.worldId}:${rank.rankId}:${gate.gateId}:${word.contentWordId}:archive`;
    if (ui.actionKeys.has(key)) return;
    const adminUid = String(getAdminState().uid || '');
    setActionPending(key, true);
    try {
      await getCloudApi().archiveWord(
        String(world.worldId), String(rank.rankId), String(gate.gateId),
        String(word.contentWordId), expectedVersion(word)
      );
      if (!adminContextMatches(adminUid)) return;
      notify('تمت أرشفة الكلمة.', 'success');
      await refreshWords({ append: false });
    } catch (error) {
      if (adminContextMatches(adminUid)) setWordActionError('تعذر أرشفة الكلمة.', error);
    } finally {
      ui.actionKeys.delete(key);
      if (ui.view === 'words') renderWords();
    }
  }

  async function runBulkWordStatus(world, rank, gate, action) {
    if (!world || !rank || !gate || !['publish', 'archive'].includes(action)) return;
    let items;
    try {
      items = wordSelectionPayload();
    } catch (error) {
      setWordActionError('تعذر قراءة إصدارات الكلمات المحددة.', error);
      return;
    }
    if (!items.length || items.length > MAX_BULK_WORDS) {
      setWordActionError('حدد من كلمة واحدة إلى مئة كلمة.', { code: 'content/invalid-bulk-size' });
      return;
    }
    const verb = action === 'publish' ? 'نشر' : 'أرشفة';
    if (!root.confirm(`${verb} ${items.length} كلمة محددة؟`)) return;
    const key = `words:${world.worldId}:${rank.rankId}:${gate.gateId}:bulk-${action}`;
    if (ui.actionKeys.has(key)) return;
    const adminUid = String(getAdminState().uid || '');
    setActionPending(key, true);
    try {
      const api = getCloudApi();
      if (action === 'publish') {
        await api.bulkPublishWords(String(world.worldId), String(rank.rankId), String(gate.gateId), items);
      } else {
        await api.bulkArchiveWords(String(world.worldId), String(rank.rankId), String(gate.gateId), items);
      }
      if (!adminContextMatches(adminUid)) return;
      ui.selectedWordIds.clear();
      notify(`تم ${verb} الكلمات المحددة.`, 'success');
      await refreshWords({ append: false });
    } catch (error) {
      if (adminContextMatches(adminUid)) setWordActionError(`تعذر ${verb} الكلمات المحددة.`, error);
    } finally {
      ui.actionKeys.delete(key);
      if (ui.view === 'words') renderWords();
    }
  }

  function createClientOperationId(prefix) {
    const cryptoObject = root.crypto;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return `${prefix}-${cryptoObject.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

  function moveGateFormSignature(modalState) {
    return JSON.stringify({
      worldId: String(modalState.targetWorldSelect.value || ''),
      rankId: String(modalState.targetRankSelect.value || ''),
      confirmationTitle: String(modalState.confirmationInput.value || '')
    });
  }

  function syncMoveGateSubmit(modalState) {
    const targetWorldId = String(modalState.targetWorldSelect.value || '');
    const targetRankId = String(modalState.targetRankSelect.value || '');
    const sameParent = targetWorldId === String(modalState.world.worldId) && targetRankId === String(modalState.rank.rankId);
    const confirmed = modalState.confirmationInput.value === modalState.expectedTitle;
    modalState.moveButton.disabled = modalState.pending || modalState.loadingTargets || !targetWorldId || !targetRankId || sameParent || !confirmed;
    modalState.dirty = moveGateFormSignature(modalState) !== modalState.initialSignature;
  }

  function replaceRankOptions(select, ranks, selectedRankId) {
    select.replaceChildren();
    const placeholder = makeElement('option', '', ranks.length ? 'اختر الرتبة الهدف' : 'لا توجد رتبة هدف متاحة');
    placeholder.value = '';
    select.append(placeholder);
    ranks.forEach((rank) => {
      const option = makeElement('option', '', `${String(rank.title || 'رتبة بلا عنوان')} · ${statusLabel(rank.status)}`);
      option.value = String(rank.rankId || '');
      option.selected = option.value === String(selectedRankId || '');
      select.append(option);
    });
  }

  async function loadMoveGateTargetRanks(modalState) {
    if (ui.modal !== modalState || modalState.pending) return;
    const targetWorldId = String(modalState.targetWorldSelect.value || '');
    const loadRevision = ++modalState.targetLoadRevision;
    modalState.loadingTargets = true;
    modalState.targetRankSelect.disabled = true;
    modalState.targetError.hidden = true;
    modalState.targetError.replaceChildren();
    replaceRankOptions(modalState.targetRankSelect, [], '');
    syncMoveGateSubmit(modalState);
    try {
      let ranks;
      if (targetWorldId === String(modalState.world.worldId)) {
        ranks = ui.ranks.map((rank) => ({ ...rank }));
      } else {
        const records = await getCloudApi().listRanks(targetWorldId);
        if (!Array.isArray(records)) {
          const error = new Error('admin/invalid-rank-list');
          error.code = 'admin/invalid-rank-list';
          throw error;
        }
        ranks = records.map((record) => normalizeRankRecord(record, targetWorldId)).filter(Boolean);
      }
      if (ui.modal !== modalState || loadRevision !== modalState.targetLoadRevision || !adminContextMatches(modalState.adminUid)) return;
      const availableRanks = ranks
        .filter((candidate) => candidate.rankId && !(
          targetWorldId === String(modalState.world.worldId) &&
          String(candidate.rankId) === String(modalState.rank.rankId)
        ))
        .sort((first, second) => cachedCount(first.order) - cachedCount(second.order) || String(first.title || '').localeCompare(String(second.title || ''), 'ar'));
      replaceRankOptions(modalState.targetRankSelect, availableRanks, '');
    } catch (error) {
      if (ui.modal !== modalState || loadRevision !== modalState.targetLoadRevision || !adminContextMatches(modalState.adminUid)) return;
      renderFormIssues(modalState.targetError, [
        { path: 'targetRankId', code: getErrorCode(error, 'admin/move-target-ranks-failed') }
      ], 'تعذر تحميل الرتب الهدف:');
    } finally {
      if (ui.modal === modalState && loadRevision === modalState.targetLoadRevision) {
        modalState.loadingTargets = false;
        modalState.targetRankSelect.disabled = false;
        syncMoveGateSubmit(modalState);
      }
    }
  }

  function setMoveGatePending(modalState, pending) {
    modalState.pending = Boolean(pending);
    modalState.form.setAttribute('aria-busy', pending ? 'true' : 'false');
    modalState.targetWorldSelect.disabled = Boolean(pending);
    modalState.targetRankSelect.disabled = Boolean(pending || modalState.loadingTargets);
    modalState.confirmationInput.disabled = Boolean(pending);
    modalState.closeButton.disabled = Boolean(pending);
    modalState.moveButton.textContent = pending ? 'جارٍ النقل…' : 'نقل البوابة';
    syncMoveGateSubmit(modalState);
  }

  function openMoveGateDialog(world, rank, gate, returnFocus) {
    if (!world || !rank || !gate) return;
    closeAdminModal(true);
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-move-gate-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminMoveGateTitle');
    const header = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    heading.append(makeGateBreadcrumb(world, rank, String(gate.title || 'البوابة')));
    const title = makeElement('h2', 'admin-modal-title', 'نقل البوابة');
    title.id = 'adminMoveGateTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', 'ينقل هذا الإجراء البوابة وكل كلماتها إلى رتبة أخرى. راجع العالم والرتبة الهدف بعناية.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close', title: 'إغلاق نافذة نقل البوابة'
    });
    closeButton.setAttribute('aria-label', 'إغلاق نافذة نقل البوابة');
    appendChildren(header, [heading, closeButton]);
    dialog.append(header);

    const form = makeElement('form', 'admin-world-form admin-move-gate-form');
    const grid = makeElement('div', 'admin-form-grid');
    const worldOptions = [...ui.worlds]
      .filter((candidate) => candidate.worldId)
      .sort((first, second) => cachedCount(first.order) - cachedCount(second.order) || String(first.title || '').localeCompare(String(second.title || ''), 'ar'))
      .map((candidate) => ({
        value: String(candidate.worldId),
        label: `${String(candidate.title || 'عالم بلا عنوان')} · ${statusLabel(candidate.status)}`
      }));
    const targetWorld = makeSelectField({
      name: 'targetWorldId',
      label: 'العالم الهدف',
      value: String(world.worldId),
      required: true,
      options: worldOptions,
      help: 'يمكن النقل داخل العالم نفسه أو إلى عالم آخر.'
    });
    const targetRank = makeSelectField({
      name: 'targetRankId',
      label: 'الرتبة الهدف',
      value: '',
      required: true,
      options: []
    });
    const expectedTitle = String(gate.title || '');
    const confirmation = makeField({
      name: 'confirmationTitle',
      label: `اكتب عنوان البوابة حرفيًا للتأكيد: ${expectedTitle}`,
      value: '',
      required: true,
      maxLength: 120,
      wide: true,
      help: 'لا يبدأ النقل قبل اختيار أب مختلف ومطابقة العنوان بالكامل.'
    });
    confirmation.input.autocomplete = 'off';
    confirmation.input.spellcheck = false;
    appendChildren(grid, [targetWorld.wrapper, targetRank.wrapper, confirmation.wrapper]);
    form.append(grid);
    const targetError = makeElement('div', 'admin-form-error');
    targetError.hidden = true;
    form.append(targetError);
    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    form.append(errorBox);
    const footer = makeElement('footer', 'admin-modal-footer');
    const cancelButton = makeButton('إلغاء', 'close-modal', { className: 'admin-btn admin-btn-secondary' });
    const moveButton = makeButton('نقل البوابة', null, {
      className: 'admin-btn admin-btn-warning', type: 'submit', disabled: true
    });
    appendChildren(footer, [cancelButton, moveButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);

    const modalState = {
      kind: 'move-gate',
      world,
      rank,
      gate,
      expectedTitle,
      operationId: createClientOperationId('move-gate'),
      adminUid: String(getAdminState().uid || ''),
      overlay,
      form,
      targetWorldSelect: targetWorld.input,
      targetRankSelect: targetRank.input,
      confirmationInput: confirmation.input,
      targetError,
      errorBox,
      closeButton,
      moveButton,
      targetLoadRevision: 0,
      loadingTargets: false,
      pending: false,
      dirty: false,
      initialSignature: '',
      returnFocus
    };
    modalState.initialSignature = moveGateFormSignature(modalState);
    ui.modal = modalState;
    targetWorld.input.addEventListener('change', () => {
      syncMoveGateSubmit(modalState);
      loadMoveGateTargetRanks(modalState);
    });
    targetRank.input.addEventListener('change', () => syncMoveGateSubmit(modalState));
    confirmation.input.addEventListener('input', () => syncMoveGateSubmit(modalState));
    form.addEventListener('submit', (event) => moveGate(event, modalState));
    loadMoveGateTargetRanks(modalState);
    targetWorld.input.focus();
  }

  async function moveGate(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending || modalState.loadingTargets) return;
    const targetWorldId = String(modalState.targetWorldSelect.value || '');
    const targetRankId = String(modalState.targetRankSelect.value || '');
    const typedTitle = modalState.confirmationInput.value;
    const sameParent = targetWorldId === String(modalState.world.worldId) && targetRankId === String(modalState.rank.rankId);
    if (!targetWorldId || !targetRankId || sameParent || typedTitle !== modalState.expectedTitle) {
      renderFormIssues(modalState.errorBox, [
        { path: 'target', code: sameParent ? 'content/same-parent' : 'content/move-confirmation-required' }
      ], 'لم يتم تأكيد نقل البوابة:');
      return;
    }
    setMoveGatePending(modalState, true);
    try {
      await getCloudApi().moveGate(
        String(modalState.world.worldId),
        String(modalState.rank.rankId),
        String(modalState.gate.gateId),
        { worldId: targetWorldId, rankId: targetRankId },
        expectedVersion(modalState.gate),
        {
          operationId: modalState.operationId,
          confirmationTitle: typedTitle
        }
      );
      if (ui.modal !== modalState || !adminContextMatches(modalState.adminUid)) return;
      modalState.dirty = false;
      setMoveGatePending(modalState, false);
      closeAdminModal(true);
      notify('تم نقل البوابة وكل كلماتها إلى الرتبة المحددة.', 'success');
      await refreshWorlds({ clear: false });
      await refreshGates({ clear: false });
    } catch (error) {
      if (ui.modal !== modalState || !adminContextMatches(modalState.adminUid)) return;
      setMoveGatePending(modalState, false);
      renderFormIssues(modalState.errorBox, [
        { path: 'cloud', code: getErrorCode(error, 'admin/gate-move-failed') }
      ], 'تعذر تأكيد اكتمال نقل البوابة. بقي اختيارك محفوظًا؛ حدّث القوائم قبل إعادة المحاولة إن كانت النتيجة غير واضحة:');
    }
  }

  function openDeleteGateDialog(world, rank, gate, returnFocus) {
    if (!world || !rank || !gate || gate.status !== 'archived') {
      setGateActionError('الحذف النهائي متاح للبوابة المؤرشفة فقط.', { code: 'content/archive-required' });
      return;
    }
    closeAdminModal(true);
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-delete-dialog admin-delete-gate-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminDeleteGateTitle');
    const header = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    heading.append(makeGateBreadcrumb(world, rank, String(gate.title || 'البوابة')));
    const title = makeElement('h2', 'admin-modal-title', 'حذف البوابة نهائيًا');
    title.id = 'adminDeleteGateTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', 'الحذف يُنفّذ في الخلفية، ولا يتاح إلا للبوابة المؤرشفة.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close', title: 'إغلاق نافذة حذف البوابة'
    });
    closeButton.setAttribute('aria-label', 'إغلاق نافذة حذف البوابة');
    appendChildren(header, [heading, closeButton]);
    dialog.append(header);

    const impact = makeElement('div', 'admin-delete-impact');
    appendChildren(impact, [
      makeElement('strong', 'admin-delete-world-title', String(gate.title || 'بوابة بلا عنوان')),
      makeElement('span', 'admin-delete-count', `${cachedCount(gate.wordCount)} كلمة متأثرة`),
      makeElement('small', 'admin-count-note', 'هذا عدد مخزن مؤقتًا · لم يتم التحقق')
    ]);
    dialog.append(impact);

    const form = makeElement('form', 'admin-delete-form');
    const expectedTitle = String(gate.title || '');
    const field = makeField({
      name: 'confirmationTitle',
      label: `اكتب العنوان حرفيًا للتأكيد: ${expectedTitle}`,
      value: '',
      required: true,
      maxLength: 120,
      wide: true,
      help: 'يجب أن يطابق الإدخال العنوان بالكامل، بما في ذلك المسافات.'
    });
    field.input.autocomplete = 'off';
    field.input.spellcheck = false;
    form.append(field.wrapper);
    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    form.append(errorBox);
    const footer = makeElement('footer', 'admin-modal-footer');
    const cancelButton = makeButton('إلغاء', 'close-modal', { className: 'admin-btn admin-btn-secondary' });
    const deleteButton = makeButton('حذف نهائي', null, {
      className: 'admin-btn admin-btn-danger', type: 'submit', disabled: true
    });
    appendChildren(footer, [cancelButton, deleteButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);

    const modalState = {
      kind: 'delete-gate',
      world,
      rank,
      gate,
      expectedTitle,
      adminUid: String(getAdminState().uid || ''),
      overlay,
      form,
      input: field.input,
      errorBox,
      closeButton,
      deleteButton,
      pending: false,
      dirty: false,
      returnFocus
    };
    ui.modal = modalState;
    field.input.addEventListener('input', () => {
      deleteButton.disabled = modalState.pending || field.input.value !== expectedTitle;
    });
    form.addEventListener('submit', (event) => deleteGate(event, modalState));
    field.input.focus();
  }

  async function deleteGate(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending) return;
    const typedTitle = modalState.input.value;
    if (modalState.gate.status !== 'archived' || typedTitle !== modalState.expectedTitle) {
      renderFormIssues(modalState.errorBox, [
        { path: 'confirmationTitle', code: 'content/exact-title-required' }
      ], 'لم يتم تأكيد حذف البوابة:');
      return;
    }
    modalState.pending = true;
    modalState.deleteButton.disabled = true;
    modalState.closeButton.disabled = true;
    modalState.form.setAttribute('aria-busy', 'true');
    modalState.deleteButton.textContent = 'جارٍ الحذف…';
    try {
      await getCloudApi().requestDeleteGate(
        String(modalState.world.worldId),
        String(modalState.rank.rankId),
        String(modalState.gate.gateId),
        {
          confirmationTitle: typedTitle,
          expectedVersion: expectedVersion(modalState.gate)
        }
      );
      if (ui.modal !== modalState || !adminContextMatches(modalState.adminUid)) return;
      modalState.pending = false;
      closeAdminModal(true);
      notify('تم حذف البوابة المؤرشفة نهائيًا.', 'success');
      await refreshWorlds({ clear: false });
      await refreshGates({ clear: false });
    } catch (error) {
      if (ui.modal !== modalState || !adminContextMatches(modalState.adminUid)) return;
      modalState.pending = false;
      modalState.closeButton.disabled = false;
      modalState.deleteButton.disabled = modalState.input.value !== modalState.expectedTitle;
      modalState.form.setAttribute('aria-busy', 'false');
      modalState.deleteButton.textContent = 'حذف نهائي';
      renderFormIssues(modalState.errorBox, [
        { path: 'cloud', code: getErrorCode(error, 'admin/gate-delete-failed') }
      ], 'تعذر تأكيد اكتمال حذف البوابة؛ قد تكون العملية اكتملت جزئيًا. حدّث القائمة قبل إعادة المحاولة:');
    }
  }

  function openDeleteRankDialog(world, rank, returnFocus) {
    if (!world || !rank || rank.status !== 'archived') {
      setRankActionError('الحذف النهائي متاح للرتبة المؤرشفة فقط.', { code: 'content/archive-required' });
      return;
    }
    closeAdminModal(true);
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-delete-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminDeleteRankTitle');
    const header = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    heading.append(makeAdminBreadcrumb(world, String(rank.title || 'الرتبة')));
    const title = makeElement('h2', 'admin-modal-title', 'حذف الرتبة نهائيًا');
    title.id = 'adminDeleteRankTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', 'الحذف يُنفّذ في الخلفية، ولا يتاح إلا للرتبة المؤرشفة.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close', title: 'إغلاق نافذة حذف الرتبة'
    });
    closeButton.setAttribute('aria-label', 'إغلاق نافذة حذف الرتبة');
    appendChildren(header, [heading, closeButton]);
    dialog.append(header);

    const impact = makeElement('div', 'admin-delete-impact');
    appendChildren(impact, [
      makeElement('strong', 'admin-delete-world-title', String(rank.title || 'رتبة بلا عنوان')),
      makeElement('span', 'admin-delete-count', `${cachedCount(rank.gateCount)} بوابة متأثرة`),
      makeElement('span', 'admin-delete-count', `${cachedCount(rank.wordCount)} كلمة متأثرة`),
      makeElement('small', 'admin-count-note', 'هذه أعداد مخزنة مؤقتًا · لم يتم التحقق')
    ]);
    dialog.append(impact);

    const form = makeElement('form', 'admin-delete-form');
    const expectedTitle = String(rank.title || '');
    const field = makeField({
      name: 'confirmationTitle',
      label: `اكتب العنوان حرفيًا للتأكيد: ${expectedTitle}`,
      value: '',
      required: true,
      maxLength: 120,
      wide: true,
      help: 'يجب أن يطابق الإدخال العنوان بالكامل، بما في ذلك المسافات.'
    });
    field.input.autocomplete = 'off';
    field.input.spellcheck = false;
    form.append(field.wrapper);
    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    form.append(errorBox);
    const footer = makeElement('footer', 'admin-modal-footer');
    const cancelButton = makeButton('إلغاء', 'close-modal', { className: 'admin-btn admin-btn-secondary' });
    const deleteButton = makeButton('حذف نهائي', null, {
      className: 'admin-btn admin-btn-danger', type: 'submit', disabled: true
    });
    appendChildren(footer, [cancelButton, deleteButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);

    const modalState = {
      kind: 'delete-rank',
      world,
      rank,
      expectedTitle,
      overlay,
      form,
      input: field.input,
      errorBox,
      closeButton,
      deleteButton,
      pending: false,
      dirty: false,
      returnFocus
    };
    ui.modal = modalState;
    field.input.addEventListener('input', () => {
      deleteButton.disabled = modalState.pending || field.input.value !== expectedTitle;
    });
    form.addEventListener('submit', (event) => deleteRank(event, modalState));
    field.input.focus();
  }

  async function deleteRank(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending) return;
    const typedTitle = modalState.input.value;
    if (modalState.rank.status !== 'archived' || typedTitle !== modalState.expectedTitle) {
      renderFormIssues(modalState.errorBox, [
        { path: 'confirmationTitle', code: 'content/exact-title-required' }
      ], 'لم يتم تأكيد حذف الرتبة:');
      return;
    }
    modalState.pending = true;
    modalState.deleteButton.disabled = true;
    modalState.closeButton.disabled = true;
    modalState.form.setAttribute('aria-busy', 'true');
    modalState.deleteButton.textContent = 'جارٍ الحذف…';
    try {
      await getCloudApi().requestDeleteRank(
        String(modalState.world.worldId),
        String(modalState.rank.rankId),
        {
          confirmationTitle: typedTitle,
          expectedVersion: expectedVersion(modalState.rank)
        }
      );
      modalState.pending = false;
      closeAdminModal(true);
      notify('تم حذف الرتبة المؤرشفة نهائيًا.', 'success');
      await refreshWorlds({ clear: false });
      await refreshRanks({ clear: false });
    } catch (error) {
      if (ui.modal !== modalState) return;
      modalState.pending = false;
      modalState.closeButton.disabled = false;
      modalState.deleteButton.disabled = modalState.input.value !== modalState.expectedTitle;
      modalState.form.setAttribute('aria-busy', 'false');
      modalState.deleteButton.textContent = 'حذف نهائي';
      renderFormIssues(modalState.errorBox, [
        { path: 'cloud', code: getErrorCode(error, 'admin/rank-delete-failed') }
      ], 'تعذر تأكيد اكتمال حذف الرتبة؛ قد تكون العملية اكتملت جزئيًا. حدّث القائمة قبل إعادة المحاولة:');
    }
  }

  function openDeleteWorldDialog(world, returnFocus) {
    if (!world || world.status !== 'archived') {
      setPageActionError('الحذف النهائي متاح للعالم المؤرشف فقط.', { code: 'content/archive-required' });
      return;
    }
    closeAdminModal(true);
    const overlay = makeElement('div', 'admin-modal-overlay');
    const backdrop = makeElement('div', 'admin-modal-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = makeElement('section', 'admin-modal admin-delete-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'adminDeleteWorldTitle');
    const header = makeElement('header', 'admin-modal-header');
    const heading = makeElement('div', 'admin-modal-heading');
    const title = makeElement('h2', 'admin-modal-title', 'حذف العالم نهائيًا');
    title.id = 'adminDeleteWorldTitle';
    appendChildren(heading, [
      title,
      makeElement('p', 'admin-modal-copy', 'هذا إجراء دائم ولا يتاح إلا بعد أرشفة العالم.')
    ]);
    const closeButton = makeButton('×', 'close-modal', {
      className: 'admin-modal-close', title: 'إغلاق نافذة الحذف'
    });
    closeButton.setAttribute('aria-label', 'إغلاق نافذة الحذف');
    appendChildren(header, [heading, closeButton]);
    dialog.append(header);

    const impact = makeElement('div', 'admin-delete-impact');
    appendChildren(impact, [
      makeElement('strong', 'admin-delete-world-title', String(world.title || 'عالم بلا عنوان')),
      makeElement('span', 'admin-delete-count', `${cachedCount(world.rankCount)} رتبة متأثرة`),
      makeElement('span', 'admin-delete-count', `${cachedCount(world.gateCount)} بوابة متأثرة`),
      makeElement('span', 'admin-delete-count', `${cachedCount(world.wordCount)} كلمة متأثرة`),
      makeElement('small', 'admin-count-note', 'هذه أعداد مخزنة مؤقتًا · لم يتم التحقق')
    ]);
    dialog.append(impact);

    const form = makeElement('form', 'admin-delete-form');
    const expectedTitle = String(world.title || '');
    const field = makeField({
      name: 'confirmationTitle',
      label: `اكتب العنوان حرفيًا للتأكيد: ${expectedTitle}`,
      value: '',
      required: true,
      maxLength: 120,
      wide: true,
      help: 'يجب أن يطابق الإدخال العنوان بالكامل، بما في ذلك المسافات.'
    });
    field.input.autocomplete = 'off';
    field.input.spellcheck = false;
    form.append(field.wrapper);
    const errorBox = makeElement('div', 'admin-form-error');
    errorBox.hidden = true;
    form.append(errorBox);
    const footer = makeElement('footer', 'admin-modal-footer');
    const cancelButton = makeButton('إلغاء', 'close-modal', { className: 'admin-btn admin-btn-secondary' });
    const deleteButton = makeButton('حذف نهائي', null, {
      className: 'admin-btn admin-btn-danger', type: 'submit', disabled: true
    });
    appendChildren(footer, [cancelButton, deleteButton]);
    form.append(footer);
    dialog.append(form);
    appendChildren(overlay, [backdrop, dialog]);
    getAdminRoot().append(overlay);

    const modalState = {
      kind: 'delete-world',
      world,
      expectedTitle,
      overlay,
      form,
      input: field.input,
      errorBox,
      closeButton,
      deleteButton,
      pending: false,
      dirty: false,
      returnFocus
    };
    ui.modal = modalState;
    field.input.addEventListener('input', () => {
      deleteButton.disabled = modalState.pending || field.input.value !== expectedTitle;
    });
    form.addEventListener('submit', (event) => deleteWorld(event, modalState));
    field.input.focus();
  }

  async function deleteWorld(event, modalState) {
    event.preventDefault();
    if (ui.modal !== modalState || modalState.pending) return;
    const typedTitle = modalState.input.value;
    if (modalState.world.status !== 'archived' || typedTitle !== modalState.expectedTitle) {
      renderFormIssues(modalState.errorBox, [
        { path: 'confirmationTitle', code: 'content/exact-title-required' }
      ], 'لم يتم تأكيد الحذف:');
      return;
    }
    modalState.pending = true;
    modalState.deleteButton.disabled = true;
    modalState.closeButton.disabled = true;
    modalState.form.setAttribute('aria-busy', 'true');
    modalState.deleteButton.textContent = 'جارٍ الحذف…';
    try {
      await getCloudApi().requestDeleteWorld(String(modalState.world.worldId), {
        confirmationTitle: typedTitle,
        expectedVersion: expectedVersion(modalState.world)
      });
      modalState.pending = false;
      closeAdminModal(true);
      notify('تم حذف العالم المؤرشف نهائيًا.', 'success');
      await refreshWorlds({ clear: false });
    } catch (error) {
      if (ui.modal !== modalState) return;
      modalState.pending = false;
      modalState.closeButton.disabled = false;
      modalState.deleteButton.disabled = modalState.input.value !== modalState.expectedTitle;
      modalState.form.setAttribute('aria-busy', 'false');
      modalState.deleteButton.textContent = 'حذف نهائي';
      renderFormIssues(modalState.errorBox, [
        { path: 'cloud', code: getErrorCode(error, 'admin/delete-failed') }
      ], 'تعذر تأكيد اكتمال الحذف؛ قد تكون العملية اكتملت جزئيًا. حدّث القائمة قبل إعادة المحاولة:');
    }
  }

  function handleAdminClick(event) {
    const actionButton = event.target.closest('[data-admin-action]');
    if (!actionButton || actionButton.disabled) return;
    const action = actionButton.dataset.adminAction;
    if (action === 'close-modal') {
      closeAdminModal(false);
      return;
    }
    if (action === 'choose-word-import-file') {
      const modalState = ui.modal;
      if (!modalState || modalState.kind !== 'word-import' || modalState.pending) return;
      const { world, rank, gate, returnFocus } = modalState;
      closeAdminModal(true);
      chooseWordImportFile(world, rank, gate, returnFocus);
      return;
    }
    if (action === 'refresh-worlds') {
      refreshWorlds({ clear: false });
      return;
    }
    if (action === 'show-dashboard') {
      showAdminDashboard();
      return;
    }
    if (action === 'open-ranks') {
      openRanksForWorld(actionButton.dataset.worldId);
      return;
    }
    if (action === 'refresh-ranks') {
      if (String(actionButton.dataset.worldId || '') === String(ui.activeWorldId || '')) {
        refreshRanks({ clear: false });
      }
      return;
    }
    if (action === 'refresh-gates') {
      if (
        String(actionButton.dataset.worldId || '') === String(ui.activeWorldId || '') &&
        String(actionButton.dataset.rankId || '') === String(ui.activeRankId || '')
      ) {
        refreshGates({ clear: false });
      }
      return;
    }
    if (action === 'create-world') {
      if (!canLeaveAdminView()) return;
      openWorldEditor(null, 'create', actionButton);
      return;
    }
    const world = findWorld(actionButton.dataset.worldId);
    if (!world) return;
    if (action === 'create-rank') {
      if (!canLeaveAdminView()) return;
      openRankEditor(world, null, 'create', actionButton);
      return;
    }
    const rank = findRank(actionButton.dataset.rankId);
    if (action === 'open-gates') {
      if (rank) openGatesForRank(world.worldId, rank.rankId);
      return;
    }
    if (action === 'create-gate') {
      if (rank && canLeaveAdminView()) openGateEditor(world, rank, null, 'create', actionButton);
      return;
    }
    const gate = findGate(actionButton.dataset.gateId);
    if (action === 'open-words') {
      if (rank && gate) openWordsForGate(world.worldId, rank.rankId, gate.gateId);
      return;
    }
    if (action === 'refresh-words') {
      if (
        rank && gate &&
        String(actionButton.dataset.worldId || '') === String(ui.activeWorldId || '') &&
        String(actionButton.dataset.rankId || '') === String(ui.activeRankId || '') &&
        String(actionButton.dataset.gateId || '') === String(ui.activeGateId || '')
      ) {
        refreshWords({ append: false });
      }
      return;
    }
    if (action === 'load-more-words') {
      if (
        rank && gate && ui.wordHasMore &&
        String(actionButton.dataset.worldId || '') === String(ui.activeWorldId || '') &&
        String(actionButton.dataset.rankId || '') === String(ui.activeRankId || '') &&
        String(actionButton.dataset.gateId || '') === String(ui.activeGateId || '')
      ) {
        refreshWords({ append: true });
      }
      return;
    }
    if (action === 'toggle-word-selection') {
      const contentWordId = String(actionButton.dataset.contentWordId || '');
      if (rank && gate && findWord(contentWordId)) {
        if (actionButton.checked) ui.selectedWordIds.add(contentWordId);
        else ui.selectedWordIds.delete(contentWordId);
        renderWords();
      }
      return;
    }
    if (action === 'select-page-words') {
      if (!rank || !gate || ui.wordsLoading || ui.words.length === 0) return;
      const pageIds = ui.words.map((item) => String(item.contentWordId || '')).filter(Boolean);
      const pageIsSelected = pageIds.every((contentWordId) =>
        ui.selectedWordIds.has(contentWordId)
      );
      pageIds.forEach((contentWordId) => {
        if (pageIsSelected) ui.selectedWordIds.delete(contentWordId);
        else ui.selectedWordIds.add(contentWordId);
      });
      renderWords();
      return;
    }
    if (action === 'create-word') {
      if (rank && gate && canLeaveAdminView()) openWordEditor(world, rank, gate, null, 'create', actionButton);
      return;
    }
    if (action === 'import-words-json') {
      if (rank && gate && canLeaveAdminView()) {
        chooseWordImportFile(world, rank, gate, actionButton);
      }
      return;
    }
    const word = findWord(actionButton.dataset.contentWordId);
    if (action === 'edit-word') {
      if (rank && gate && word && canLeaveAdminView()) {
        loadFreshWordForEditor(world, rank, gate, word.contentWordId, actionButton);
      }
      return;
    }
    if (action === 'set-word-status') {
      if (rank && gate && word) changeWordStatus(world, rank, gate, word, actionButton.dataset.status);
      return;
    }
    if (action === 'bulk-publish-words') {
      if (rank && gate) runBulkWordStatus(world, rank, gate, 'publish');
      return;
    }
    if (action === 'bulk-archive-words') {
      if (rank && gate) runBulkWordStatus(world, rank, gate, 'archive');
      return;
    }
    if (action === 'edit-gate') {
      if (rank && gate && canLeaveAdminView()) loadFreshGateForEditor(world, rank, gate.gateId, actionButton);
      return;
    }
    if (action === 'set-gate-status') {
      if (rank && gate) changeGateStatus(world, rank, gate, actionButton.dataset.status);
      return;
    }
    if (action === 'duplicate-gate') {
      if (rank && gate) duplicateGateAsDraft(world, rank, gate);
      return;
    }
    if (action === 'move-gate') {
      if (rank && gate && canLeaveAdminView()) openMoveGateDialog(world, rank, gate, actionButton);
      return;
    }
    if (action === 'delete-gate') {
      if (rank && gate && canLeaveAdminView()) openDeleteGateDialog(world, rank, gate, actionButton);
      return;
    }
    if (action === 'edit-rank') {
      if (rank && canLeaveAdminView()) loadFreshRankForEditor(world, rank.rankId, actionButton);
      return;
    }
    if (action === 'set-rank-status') {
      if (rank) changeRankStatus(world, rank, actionButton.dataset.status);
      return;
    }
    if (action === 'duplicate-rank') {
      if (rank) duplicateRankAsDraft(world, rank);
      return;
    }
    if (action === 'delete-rank') {
      if (rank && canLeaveAdminView()) openDeleteRankDialog(world, rank, actionButton);
      return;
    }
    if (action === 'edit-world' || action === 'duplicate-world') {
      if (canLeaveAdminView()) {
        loadFreshWorldForEditor(world.worldId, action === 'edit-world' ? 'edit' : 'duplicate', actionButton);
      }
    } else if (action === 'set-world-status') {
      changeWorldStatus(world, actionButton.dataset.status);
    } else if (action === 'delete-world') {
      if (canLeaveAdminView()) openDeleteWorldDialog(world, actionButton);
    }
  }

  function switchToAdminShell() {
    const originView = typeof currentView !== 'undefined' ? String(currentView || '') : '';
    if (originView && originView !== 'admin') {
      ui.returnView = originView;
      ui.returnCustomWorldId = originView === 'customWorld' &&
        typeof activeCustomWorldId !== 'undefined'
        ? String(activeCustomWorldId || '')
        : '';
    }
    if (typeof beginViewSwitch === 'function') beginViewSwitch();
    if (typeof saveCurrentViewScroll === 'function') saveCurrentViewScroll();
    if (typeof closeSidebarIfOpen === 'function') closeSidebarIfOpen();
    if (typeof root.stopCustomWorldWordsCloudListener === 'function') root.stopCustomWorldWordsCloudListener();
    if (typeof setTreasureMode === 'function') setTreasureMode(false);
    document.body.classList.remove(
      'treasure-mode',
      'game-bg-active',
      'treasure-route-next',
      'treasure-route-back',
      'worlds-route-next',
      'worlds-route-back'
    );
    document.body.removeAttribute('data-game');
    if (typeof hideAllViewElements === 'function') hideAllViewElements();
    if (typeof currentView !== 'undefined') currentView = 'admin';
    if (typeof viewBackTarget !== 'undefined') viewBackTarget = 'admin-origin';
    if (typeof setViewBackBar === 'function') setViewBackBar(true, 'العودة إلى الصفحة السابقة');
    document.body.classList.add('admin-mode');
    const container = getAdminRoot();
    if (container) {
      container.hidden = false;
      container.style.display = 'block';
    }
    const pageTitle = document.getElementById('pageTitle') || document.querySelector('.page-header h1');
    if (pageTitle) {
      const icon = makeElement('i', 'fa-solid fa-shield-halved');
      icon.setAttribute('aria-hidden', 'true');
      pageTitle.replaceChildren(icon, document.createTextNode(' إدارة المحتوى الجاهز'));
    }
    if (typeof setAppViewRoute === 'function') setAppViewRoute('admin');
  }

  function returnFromAdminView() {
    if (!canLeaveAdminView()) return false;
    const returnView = String(ui.returnView || 'personal');
    const customWorldId = String(ui.returnCustomWorldId || '');
    document.body.classList.remove('admin-mode');
    if (returnView === 'customWorld' && customWorldId && typeof root.loadCustomWorld === 'function') {
      root.loadCustomWorld(customWorldId);
      return true;
    }
    if ((returnView === 'minecraft' || returnView === 'pubg') &&
        typeof root.loadGameDictionary === 'function') {
      root.loadGameDictionary(returnView);
      return true;
    }
    const loaders = {
      treasure: root.loadTreasureView,
      worlds: root.loadWorldsView,
      starred: root.loadStarredView,
      quiz: root.loadQuizView,
      personal: root.loadPersonalDictionary
    };
    const loader = loaders[returnView] || root.loadPersonalDictionary;
    if (typeof loader === 'function') loader();
    return true;
  }

  async function loadAdminView() {
    if (!canLeaveAdminView()) return false;
    ui.rankLoadRevision += 1;
    ui.gateLoadRevision += 1;
    ui.view = 'dashboard';
    ui.activeWorldId = '';
    ui.activeRankId = '';
    ui.ranks = [];
    ui.gates = [];
    ui.rankPageError = '';
    ui.gatePageError = '';
    switchToAdminShell();
    const container = getAdminRoot();
    if (!container) return false;
    let state = getAdminState();
    if (state.isAdmin) {
      ui.loading = true;
      renderDashboard();
    } else {
      renderAccessMessage(container, state);
    }
    if (typeof root.ensureLootLinguaAdminAccess === 'function') {
      ui.accessCheckPending = true;
      try {
        state = await root.ensureLootLinguaAdminAccess();
      } catch (error) {
        state = { resolved: true, isAdmin: false, uid: null, errorCode: getErrorCode(error) };
      } finally {
        ui.accessCheckPending = false;
      }
    }
    if (!state.isAdmin) {
      renderAccessMessage(container, state);
      return false;
    }
    await refreshWorlds({ clear: true });
    return true;
  }

  function canLeaveAdminView() {
    if ((ui.modal && ui.modal.pending) || ui.actionKeys.size > 0) {
      notify('انتظر اكتمال العملية الحالية قبل المغادرة.', 'warning');
      return false;
    }
    if (!ui.modal) return true;
    return closeAdminModal(false);
  }

  function syncAdminEntry(state) {
    const entry = document.getElementById('adminEntryBtn');
    if (!entry) return;
    const visible = Boolean(state && state.resolved && state.isAdmin);
    entry.hidden = !visible;
    entry.setAttribute('aria-hidden', visible ? 'false' : 'true');
    entry.tabIndex = visible ? 0 : -1;
    if (!ui.entryBound) {
      entry.addEventListener('click', () => {
        const currentState = getAdminState();
        if (!currentState.resolved || !currentState.isAdmin) return;
        if (typeof root.closeProfileModal === 'function') root.closeProfileModal(true);
        root.openAdminDashboard();
      });
      ui.entryBound = true;
    }
  }

  function adminViewIsVisible() {
    const container = getAdminRoot();
    return Boolean(container && !container.hidden && container.style.display !== 'none');
  }

  function handleAdminState() {
    // CustomEvents are notifications only; their detail is caller-controlled.
    // Always read the claim-derived snapshot owned by admin-cloud.js.
    const state = getAdminState();
    const previous = ui.lastAdminState;
    ui.lastAdminState = { ...state };
    syncAdminEntry(state);
    if (!adminViewIsVisible()) return;

    if (!state.resolved) {
      closeAdminModal(true);
      ui.rankLoadRevision += 1;
      ui.gateLoadRevision += 1;
      ui.view = 'dashboard';
      ui.activeWorldId = '';
      ui.activeRankId = '';
      ui.ranks = [];
      ui.gates = [];
      renderAccessMessage(getAdminRoot(), state);
      return;
    }
    if (!state.isAdmin) {
      closeAdminModal(true);
      ui.rankLoadRevision += 1;
      ui.gateLoadRevision += 1;
      ui.view = 'dashboard';
      ui.activeWorldId = '';
      ui.activeRankId = '';
      ui.worlds = [];
      ui.ranks = [];
      ui.gates = [];
      ui.actionKeys.clear();
      renderAccessMessage(getAdminRoot(), state);
      return;
    }
    if (ui.accessCheckPending) return;
    if (!previous || !previous.isAdmin || previous.uid !== state.uid) {
      ui.rankLoadRevision += 1;
      ui.gateLoadRevision += 1;
      ui.view = 'dashboard';
      ui.activeWorldId = '';
      ui.activeRankId = '';
      ui.ranks = [];
      ui.gates = [];
      refreshWorlds({ clear: true });
    }
  }

  function handleGlobalKeydown(event) {
    if (event.key !== 'Escape' || !ui.modal) return;
    event.preventDefault();
    event.stopPropagation();
    closeAdminModal(false);
  }

  function handleNavigationCapture(event) {
    if (!modalIsDirty() && !(ui.modal && ui.modal.pending) && ui.actionKeys.size === 0) return;
    const target = event.target.closest('a[href], [data-view], [data-dock-view], #viewBackBar');
    if (!target || (ui.modal && ui.modal.overlay.contains(target))) return;
    if (!canLeaveAdminView()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleBeforeUnload(event) {
    if (!modalIsDirty() && !(ui.modal && ui.modal.pending) && ui.actionKeys.size === 0) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function initializeAdminUi() {
    const container = getAdminRoot();
    if (container) container.addEventListener('click', handleAdminClick);
    syncAdminEntry(getAdminState());
  }

  root.loadAdminView = loadAdminView;
  root.openAdminDashboard = loadAdminView;
  root.returnFromAdminView = returnFromAdminView;
  root.canLeaveAdminView = canLeaveAdminView;

  root.addEventListener('lootlingua:admin-state', handleAdminState);
  root.addEventListener('keydown', handleGlobalKeydown, true);
  root.addEventListener('beforeunload', handleBeforeUnload);
  document.addEventListener('click', handleNavigationCapture, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAdminUi, { once: true });
  } else {
    initializeAdminUi();
  }
}(window));
