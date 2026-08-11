(function attachLootLinguaNotificationPolicy(root) {
  'use strict';

  const POLICY_VERSION = 2;
  const LONG_MESSAGE_THRESHOLD = 82;
  const TOAST_PREVIEW_LIMIT = 78;
  const IMPORTANT_KINDS = new Set([
    'achievement',
    'partial-failure',
    'multi-result',
    'action-required',
    'important',
  ]);
  let recordSequence = 0;

  function text(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function hashText(value) {
    const source = text(value);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function shouldPersist(message, options) {
    const settings = options && typeof options === 'object' ? options : {};
    if (settings.persist === false) return false;
    if (settings.persist === true) return true;
    if (text(settings.fullText || settings.details)) return true;
    if (IMPORTANT_KINDS.has(text(settings.importance))) return true;
    if (settings.partialFailure === true) return true;
    if (Math.max(0, Number(settings.resultCount) || 0) > 1) return true;
    return text(message).length > LONG_MESSAGE_THRESHOLD;
  }

  function toastPreview(message, limit) {
    const source = text(message);
    const max = Math.max(32, Number(limit) || TOAST_PREVIEW_LIMIT);
    if (source.length <= max) return source;
    const slice = source.slice(0, max - 1);
    const boundary = slice.lastIndexOf(' ');
    return `${slice.slice(0, boundary > max * 0.6 ? boundary : slice.length).trim()}…`;
  }

  function toastDedupeKey(message, type, options) {
    const settings = options && typeof options === 'object' ? options : {};
    if (settings.toastDedupe === false) return '';
    const explicitKey = text(settings.toastDedupeKey);
    const identity = explicitKey
      ? `explicit|${explicitKey}`
      : `message|${text(type || 'info').toLowerCase()}|${text(settings.fullText || settings.details || message).toLowerCase()}`;
    return `toast_${hashText(identity)}`;
  }

  function notificationId(message, type, options, now, sequence) {
    const settings = options && typeof options === 'object' ? options : {};
    const dedupeKey = text(settings.dedupeKey || settings.operationId);
    const identity = dedupeKey || [
      text(type || 'info'),
      text(settings.fullText || message),
      Math.max(0, Number(now) || 0),
      Math.max(0, Number(sequence) || 0),
    ].join('|');
    return `nt${POLICY_VERSION}_${hashText(identity)}`;
  }

  function createRecord(message, type, options, now) {
    const settings = options && typeof options === 'object' ? options : {};
    const fullText = text(settings.fullText || settings.details || message);
    const time = Math.max(0, Number(now) || Date.now());
    recordSequence += 1;
    return {
      id: notificationId(fullText, type, settings, time, recordSequence),
      msg: fullText,
      type: ['success', 'warning', 'danger', 'info'].includes(type) ? type : 'info',
      meta: {
        importance: text(settings.importance),
        operationId: text(settings.operationId),
        dedupeKey: text(settings.dedupeKey),
      },
      time,
      count: 1,
      read: false,
      policyVersion: POLICY_VERSION,
    };
  }

  function mergeRecord(records, incoming, maxRecords) {
    const values = Array.isArray(records) ? records.filter(Boolean) : [];
    const existing = values.find((record) => String(record.id) === String(incoming.id));
    const merged = existing
      ? {
        ...existing,
        ...incoming,
        count: Math.max(1, Number(existing.count) || 1),
        read: false,
      }
      : incoming;
    const next = [merged, ...values.filter((record) => String(record.id) !== String(merged.id))];
    return next.slice(0, Math.max(1, Number(maxRecords) || 100));
  }

  const API = Object.freeze({
    POLICY_VERSION,
    LONG_MESSAGE_THRESHOLD,
    TOAST_PREVIEW_LIMIT,
    shouldPersist,
    toastPreview,
    toastDedupeKey,
    notificationId,
    createRecord,
    mergeRecord,
  });

  Object.defineProperty(root, 'LootLinguaNotificationPolicy', {
    value: API,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(typeof window !== 'undefined' ? window : globalThis);
