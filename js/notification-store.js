(function attachLootLinguaNotificationStore(root) {
  'use strict';

  const SCHEMA_VERSION = 3;
  const STORAGE_PREFIX = 'lootlingua_notifications_v3_';
  const LEGACY_PREFIX = 'lootlingua_notifications_v2_';
  const MAX_RECORDS = 250;
  const DISPLAY_LIMIT = 100;
  const VALID_STATUSES = new Set(['pending', 'active', 'resolved', 'dismissed']);
  const TERMINAL_STATUSES = new Set(['resolved', 'dismissed']);
  const listeners = new Set();
  let owner = 'guest';
  let records = [];
  let cloudAdapter = null;
  const deferredCloudWrites = new Map();
  let cloudRetryTimer = null;

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function timeValue(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value?.toMillis === 'function') return Math.max(0, value.toMillis());
    if (typeof value?.toDate === 'function') return Math.max(0, value.toDate().getTime());
    if (value instanceof Date) return Math.max(0, value.getTime());
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  function hashText(value) {
    const source = String(value ?? '');
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function deterministicId(ownerId, occurrenceKey) {
    return `nt${SCHEMA_VERSION}_${hashText(`${cleanText(ownerId) || 'guest'}|${cleanText(occurrenceKey)}`)}`;
  }

  function storageKey(ownerId) {
    return `${STORAGE_PREFIX}${encodeURIComponent(cleanText(ownerId) || 'guest')}`;
  }

  function legacyStorageKey(ownerId) {
    return `${LEGACY_PREFIX}${encodeURIComponent(cleanText(ownerId) || 'guest')}`;
  }

  function normalizeCta(value) {
    const source = value && typeof value === 'object' ? value : {};
    const id = cleanText(source.id || source.ctaId);
    const label = cleanText(source.label || source.ctaLabel);
    if (!id && !label) return null;
    return {
      id,
      label,
      args: source.args && typeof source.args === 'object' && !Array.isArray(source.args)
        ? { ...source.args }
        : {},
    };
  }

  function normalizeRecord(value, fallbackOwner) {
    const source = value && typeof value === 'object' ? value : {};
    const ownerId = cleanText(source.ownerId || source.owner || fallbackOwner) || 'guest';
    const kind = source.kind === 'smart' || source.channelKind === 'smart' ? 'smart' : 'legacy';
    const notificationType = cleanText(source.notificationType) || (kind === 'legacy' ? 'legacy.notice' : '');
    const occurrenceKey = cleanText(source.occurrenceKey || source.meta?.dedupeKey || source.id) ||
      `${notificationType || 'legacy.notice'}:${timeValue(source.createdAt || source.time) || Date.now()}`;
    const createdAt = timeValue(source.createdAt || source.time) || Date.now();
    const status = VALID_STATUSES.has(source.status) ? source.status : 'active';
    const readAt = Math.max(
      timeValue(source.readAt),
      source.read === true ? (timeValue(source.updatedAt || source.time) || createdAt) : 0
    );
    const message = cleanText(source.message || source.msg);
    const record = {
      id: cleanText(source.id) || deterministicId(ownerId, occurrenceKey),
      schemaVersion: SCHEMA_VERSION,
      ownerId,
      kind,
      notificationType,
      occurrenceKey,
      actionGroup: cleanText(source.actionGroup),
      priority: Math.max(0, Math.min(100, Number(source.priority) || 0)),
      severity: cleanText(source.severity) || 'normal',
      status,
      visualType: ['success', 'warning', 'danger', 'info'].includes(source.visualType || source.type)
        ? (source.visualType || source.type)
        : 'info',
      title: cleanText(source.title),
      message,
      cta: normalizeCta(source.cta || source),
      context: source.context && typeof source.context === 'object' && !Array.isArray(source.context)
        ? { ...source.context }
        : {},
      createdAt,
      updatedAt: timeValue(source.updatedAt) || createdAt,
      eligibleSince: timeValue(source.eligibleSince),
      eligibleAt: timeValue(source.eligibleAt),
      firstShownAt: timeValue(source.firstShownAt),
      lastShownAt: timeValue(source.lastShownAt),
      showCount: Math.max(0, Number(source.showCount ?? source.count) || 0),
      shownSlots: Array.isArray(source.shownSlots)
        ? [...new Set(source.shownSlots.map(cleanText).filter(Boolean))].slice(0, 12)
        : [],
      readAt,
      resolvedAt: timeValue(source.resolvedAt),
      dismissedAt: timeValue(source.dismissedAt),
      resolutionReason: cleanText(source.resolutionReason),
      expiresAt: timeValue(source.expiresAt),
      policyVersion: Math.max(0, Number(source.policyVersion) || 0),
    };
    // Compatibility fields are derived, never authoritative lifecycle state.
    record.msg = record.message;
    record.type = record.visualType;
    record.time = record.createdAt;
    record.count = Math.max(1, record.showCount || Number(source.count) || 1);
    record.read = record.readAt > 0;
    return record;
  }

  function terminalAt(record) {
    return Math.max(timeValue(record?.resolvedAt), timeValue(record?.dismissedAt), timeValue(record?.updatedAt));
  }

  function minPositive(...values) {
    const positive = values.map(timeValue).filter((value) => value > 0);
    return positive.length ? Math.min(...positive) : 0;
  }

  function chooseLifecycle(left, right) {
    const leftTerminal = TERMINAL_STATUSES.has(left.status);
    const rightTerminal = TERMINAL_STATUSES.has(right.status);
    if (leftTerminal || rightTerminal) {
      // When both are terminal, the current/server-side terminal kind wins.
      // Firestore forbids terminal -> different terminal (or active) updates.
      if (leftTerminal && rightTerminal) return left.status === right.status
        ? (terminalAt(right) >= terminalAt(left) ? right : left)
        : left;
      return rightTerminal ? right : left;
    }
    if (left.status === 'active' && right.status === 'pending') return left;
    if (right.status === 'active' && left.status === 'pending') return right;
    return right.updatedAt >= left.updatedAt ? right : left;
  }

  function mergePair(current, incoming, fallbackOwner) {
    if (!current) return normalizeRecord(incoming, fallbackOwner);
    if (!incoming) return normalizeRecord(current, fallbackOwner);
    const left = normalizeRecord(current, fallbackOwner);
    const right = normalizeRecord(incoming, fallbackOwner);
    const newer = right.updatedAt >= left.updatedAt ? right : left;
    const lifecycle = chooseLifecycle(left, right);
    const createdAt = Math.min(left.createdAt || Infinity, right.createdAt || Infinity);
    const merged = normalizeRecord({
      ...newer,
      id: left.id || right.id,
      ownerId: left.ownerId || right.ownerId,
      occurrenceKey: left.occurrenceKey || right.occurrenceKey,
      status: lifecycle.status,
      createdAt: Number.isFinite(createdAt) ? createdAt : Math.max(left.createdAt, right.createdAt),
      updatedAt: Math.max(left.updatedAt, right.updatedAt),
      eligibleSince: minPositive(left.eligibleSince, right.eligibleSince),
      eligibleAt: Math.max(left.eligibleAt, right.eligibleAt),
      firstShownAt: minPositive(left.firstShownAt, right.firstShownAt),
      lastShownAt: Math.max(left.lastShownAt, right.lastShownAt),
      showCount: Math.max(left.showCount, right.showCount),
      shownSlots: [...new Set([...left.shownSlots, ...right.shownSlots])].slice(0, 12),
      readAt: Math.max(left.readAt, right.readAt),
      resolvedAt: Math.max(left.resolvedAt, right.resolvedAt),
      dismissedAt: Math.max(left.dismissedAt, right.dismissedAt),
      resolutionReason: lifecycle.resolutionReason || newer.resolutionReason,
      count: Math.max(left.count, right.count),
    }, fallbackOwner);
    return merged;
  }

  function sortRecords(values) {
    return values.sort((a, b) => (
      Math.max(b.lastShownAt, b.createdAt, b.updatedAt) - Math.max(a.lastShownAt, a.createdAt, a.updatedAt)
    ));
  }

  function mergeMany(base, incoming, fallbackOwner) {
    const byOccurrence = new Map();
    [...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])]
      .filter(Boolean)
      .forEach((value) => {
        const normalized = normalizeRecord(value, fallbackOwner);
        const identity = normalized.occurrenceKey || normalized.id;
        byOccurrence.set(identity, mergePair(byOccurrence.get(identity), normalized, fallbackOwner));
      });
    return sortRecords([...byOccurrence.values()]).slice(0, MAX_RECORDS);
  }

  function persist(ownerId = owner, values = records) {
    try {
      localStorage.setItem(storageKey(ownerId), JSON.stringify(values.slice(0, MAX_RECORDS)));
    } catch (error) {
      console.warn('[NotificationStore] Local cache unavailable.', error?.message || error);
    }
  }

  function importLegacy(ownerId) {
    try {
      const parsed = JSON.parse(localStorage.getItem(legacyStorageKey(ownerId)) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item.id === 'string').map((item) => normalizeRecord({
        ...item,
        kind: 'legacy',
        notificationType: 'legacy.notice',
        occurrenceKey: item.meta?.dedupeKey ? `legacy:${item.meta.dedupeKey}` : `legacy:${item.id}`,
        status: 'active',
        createdAt: item.time,
        updatedAt: item.time,
        showCount: item.count || 1,
      }, ownerId));
    } catch (_) {
      return [];
    }
  }

  function readOwner(ownerId) {
    let parsed = [];
    try {
      const value = JSON.parse(localStorage.getItem(storageKey(ownerId)) || '[]');
      if (Array.isArray(value)) parsed = value;
    } catch (_) {}
    return mergeMany(parsed, importLegacy(ownerId), ownerId)
      .filter((record) => record.ownerId === ownerId);
  }

  function emit(reason) {
    const snapshot = getAll();
    root.__notifications = getDisplayRecords();
    listeners.forEach((listener) => {
      try { listener(snapshot, reason); } catch (error) { console.error('[NotificationStore] listener:', error); }
    });
    try {
      root.dispatchEvent?.(new CustomEvent('lootlingua:notifications-changed', {
        detail: { ownerId: owner, reason },
      }));
    } catch (_) {}
  }

  function switchOwner(nextOwner) {
    const normalizedOwner = cleanText(nextOwner) || 'guest';
    owner = normalizedOwner;
    records = readOwner(owner);
    persist();
    emit('owner-switch');
    return getAll();
  }

  function getAll() {
    return records.map((record) => ({ ...record, context: { ...record.context }, cta: record.cta ? { ...record.cta, args: { ...record.cta.args } } : null }));
  }

  function getDisplayRecords() {
    return records.filter((record) => record.status === 'active').slice(0, DISPLAY_LIMIT).map((record) => ({ ...record }));
  }

  function getUnreadCount() {
    return records.filter((record) => record.status === 'active' && !record.readAt).length;
  }

  function find(idOrOccurrence) {
    const key = cleanText(idOrOccurrence);
    const record = records.find((item) => item.id === key || item.occurrenceKey === key);
    return record ? { ...record } : null;
  }

  function deferredCloudKey(ownerId, recordId) {
    return `${cleanText(ownerId)}\u0000${cleanText(recordId)}`;
  }

  function clearDeferredCloudRecords(values, ownerId) {
    (Array.isArray(values) ? values : []).forEach((record) => {
      const key = deferredCloudKey(ownerId, record?.id);
      const deferred = deferredCloudWrites.get(key);
      if (!deferred || timeValue(deferred.updatedAt) <= timeValue(record?.updatedAt)) {
        deferredCloudWrites.delete(key);
      }
    });
  }

  function deferCloudRecords(values, ownerId) {
    (Array.isArray(values) ? values : []).forEach((record) => {
      const current = owner === ownerId ? records.find((item) => item.id === record?.id) : null;
      const deferredRecord = normalizeRecord(current || record, ownerId);
      const key = deferredCloudKey(ownerId, deferredRecord.id);
      deferredCloudWrites.set(
        key,
        mergePair(deferredCloudWrites.get(key), deferredRecord, ownerId)
      );
    });
  }

  function scheduleCloudRetry() {
    if (cloudRetryTimer || typeof root.setTimeout !== 'function') return;
    cloudRetryTimer = root.setTimeout(() => {
      cloudRetryTimer = null;
      retryDeferredCloudWrites();
    }, 15000);
  }

  async function retryDeferredCloudWrites() {
    if (!cloudAdapter?.writeRecords || owner === 'guest') return false;
    const ownerId = owner;
    const pending = [...deferredCloudWrites.entries()]
      .filter(([key]) => key.startsWith(`${ownerId}\u0000`))
      .map(([, record]) => record);
    if (!pending.length) return true;
    try {
      const saved = await cloudAdapter.writeRecords(pending);
      if (saved === false) throw new Error('Notification cloud adapter did not accept the deferred write.');
      clearDeferredCloudRecords(pending, ownerId);
      return true;
    } catch (error) {
      console.warn('[NotificationStore] Deferred cloud write retry failed.', error?.message || error);
      scheduleCloudRetry();
      return false;
    }
  }

  function syncCloudRecords(values, label) {
    if (!cloudAdapter?.writeRecords || owner === 'guest') return;
    const ownerId = owner;
    const outgoing = (Array.isArray(values) ? values : [])
      .map((record) => normalizeRecord(record, ownerId));
    Promise.resolve()
      .then(() => cloudAdapter.writeRecords(outgoing))
      .then((saved) => {
        if (saved === false) throw new Error('Notification cloud adapter did not accept the write.');
        clearDeferredCloudRecords(outgoing, ownerId);
      })
      .catch((error) => {
        deferCloudRecords(outgoing, ownerId);
        console.warn(`[NotificationStore] ${label} deferred.`, error?.message || error);
        scheduleCloudRetry();
      });
  }

  function applyRecords(incoming, reason, options = {}) {
    const scopedIncoming = (Array.isArray(incoming) ? incoming : [incoming])
      .filter(Boolean)
      .map((item) => ({ ...item, ownerId: owner }));
    const next = mergeMany(records, scopedIncoming, owner);
    const changed = JSON.stringify(next) !== JSON.stringify(records);
    records = next;
    if (!changed) return getAll();
    persist();
    emit(reason);
    if (options.sync !== false && cloudAdapter?.writeRecords && owner !== 'guest') {
      syncCloudRecords(scopedIncoming, 'Cloud write');
    }
    return getAll();
  }

  function upsert(value, options = {}) {
    return applyRecords([value], options.reason || 'upsert', options);
  }

  function upsertMany(values, options = {}) {
    return applyRecords(Array.isArray(values) ? values : [], options.reason || 'upsert-many', options);
  }

  function mergeCloud(values) {
    return applyRecords(values, 'cloud-merge', { sync: false });
  }

  function mutate(ids, updater, reason) {
    const idSet = new Set((Array.isArray(ids) ? ids : [ids]).map(cleanText).filter(Boolean));
    const changed = [];
    const now = Date.now();
    records = records.map((record) => {
      if (!idSet.has(record.id) && !idSet.has(record.occurrenceKey)) return record;
      const next = normalizeRecord(updater({ ...record }, now) || record, owner);
      if (JSON.stringify(next) !== JSON.stringify(record)) changed.push(next);
      return next;
    });
    if (!changed.length) return getAll();
    records = sortRecords(records).slice(0, MAX_RECORDS);
    persist();
    emit(reason);
    if (cloudAdapter?.writeRecords && owner !== 'guest') {
      syncCloudRecords(changed, 'Cloud mutation');
    }
    return getAll();
  }

  function markVisibleRead(ids, at = Date.now()) {
    const timestamp = timeValue(at) || Date.now();
    return mutate(ids, (record) => record.status === 'active' && !record.readAt ? {
      ...record,
      readAt: timestamp,
      read: true,
      updatedAt: Math.max(record.updatedAt, timestamp),
    } : record, 'mark-read');
  }

  function dismiss(ids, at = Date.now(), reason = 'user-dismissed') {
    const timestamp = timeValue(at) || Date.now();
    return mutate(ids, (record) => (record.status === 'active' || record.status === 'pending') ? {
      ...record,
      status: 'dismissed',
      dismissedAt: timestamp,
      readAt: Math.max(record.readAt, timestamp),
      resolutionReason: reason,
      updatedAt: timestamp,
    } : record, 'dismiss');
  }

  function dismissAllActive(at = Date.now()) {
    return dismiss(records.filter((record) => record.status === 'active').map((record) => record.id), at, 'clear-all');
  }

  function resolve(ids, reason = 'source-cleared', at = Date.now()) {
    const timestamp = timeValue(at) || Date.now();
    return mutate(ids, (record) => (record.status === 'active' || record.status === 'pending') ? {
      ...record,
      status: 'resolved',
      resolvedAt: timestamp,
      resolutionReason: reason,
      updatedAt: timestamp,
    } : record, 'resolve');
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function registerCloudAdapter(adapter) {
    cloudAdapter = adapter && typeof adapter === 'object' ? adapter : null;
    if (cloudAdapter) retryDeferredCloudWrites();
    return cloudAdapter;
  }

  async function migrateGuestToOwner(targetOwner) {
    const ownerId = cleanText(targetOwner);
    if (!ownerId || ownerId === 'guest') return false;
    const guestRecords = readOwner('guest').filter((record) => record.kind === 'smart');
    if (!guestRecords.length) return true;
    const migrated = guestRecords.map((record) => normalizeRecord({
      ...record,
      id: deterministicId(ownerId, record.occurrenceKey),
      ownerId,
      updatedAt: Math.max(record.updatedAt, Date.now()),
    }, ownerId));
    const accountRecords = readOwner(ownerId);
    const next = mergeMany(accountRecords, migrated, ownerId);
    persist(ownerId, next);
    if (owner === ownerId) {
      records = next;
      emit('guest-migration');
    }
    if (cloudAdapter?.migrateRecords) await cloudAdapter.migrateRecords(migrated);
    else if (cloudAdapter?.writeRecords) await cloudAdapter.writeRecords(migrated);
    return true;
  }

  function purgeOwner(ownerId) {
    const target = cleanText(ownerId) || 'guest';
    try { localStorage.removeItem(storageKey(target)); } catch (_) {}
    [...deferredCloudWrites.keys()]
      .filter((key) => key.startsWith(`${target}\u0000`))
      .forEach((key) => deferredCloudWrites.delete(key));
    if (owner === target) {
      records = [];
      emit('purge-owner');
    }
  }

  const API = Object.freeze({
    SCHEMA_VERSION,
    STORAGE_PREFIX,
    deterministicId,
    normalizeRecord,
    mergePair,
    mergeMany,
    switchOwner,
    currentOwner: () => owner,
    getAll,
    getDisplayRecords,
    getUnreadCount,
    find,
    upsert,
    upsertMany,
    mergeCloud,
    markVisibleRead,
    dismiss,
    dismissAllActive,
    resolve,
    subscribe,
    registerCloudAdapter,
    retryDeferredCloudWrites,
    deferredCloudWriteCount: () => deferredCloudWrites.size,
    migrateGuestToOwner,
    purgeOwner,
  });

  Object.defineProperty(root, 'LootLinguaNotificationStore', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
