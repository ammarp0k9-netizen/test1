import { getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  collection,
  doc,
  documentId,
  endBefore,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  limitToLast,
  orderBy,
  query,
  startAfter,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = getApps()[0];
const db = app ? getFirestore(app) : null;
const PAGE_SIZE = 25;
const PUBLISHED = 'published';

const cache = {
  worlds: null,
  ranks: new Map(),
  gates: new Map(),
  records: {
    worlds: new Map(),
    ranks: new Map(),
    gates: new Map(),
  },
};

function publishedError(code, message, cause) {
  const error = new Error(message || code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function requireDb() {
  if (!db) {
    throw publishedError('published/unavailable', 'Published content is unavailable.');
  }
  return db;
}

function requireId(value, field) {
  const id = String(value || '').trim();
  if (!id || id.includes('/') || id.length > 500) {
    throw publishedError('published/not-found', `${field} was not found.`);
  }
  return id;
}

function record(snapshot, idField, parents) {
  return {
    ...(snapshot.data() || {}),
    ...(parents || {}),
    [idField]: snapshot.id,
  };
}

function recordKey(...parts) {
  return parts.map((part) => String(part || '')).join('/');
}

function mapReadError(error, exactRead) {
  const sourceCode = String(error && error.code || '');
  const message = String(error && error.message || '');
  if (sourceCode === 'published/not-found' || sourceCode === 'published/unavailable') return error;
  if (sourceCode.endsWith('failed-precondition') && /index/i.test(message)) {
    return publishedError(
      'published/index-required',
      'Published content needs a Firestore index.',
      error
    );
  }
  if (exactRead && sourceCode.endsWith('permission-denied')) {
    return publishedError('published/not-found', 'Published content was not found.', error);
  }
  return publishedError('published/unavailable', 'Published content could not be loaded.', error);
}

function contentWorldsCollection() {
  return collection(requireDb(), 'content_worlds');
}

function ranksCollection(worldId) {
  return collection(doc(contentWorldsCollection(), worldId), 'ranks');
}

function gatesCollection(worldId, rankId) {
  return collection(doc(ranksCollection(worldId), rankId), 'gates');
}

function wordsCollection(worldId, rankId, gateId) {
  return collection(doc(gatesCollection(worldId, rankId), gateId), 'words');
}

function orderedPublishedQuery(reference) {
  return query(
    reference,
    where('status', '==', PUBLISHED),
    orderBy('order', 'asc'),
    orderBy(documentId(), 'asc')
  );
}

async function listPublishedWorlds(options) {
  const force = Boolean(options && options.force);
  if (!force && cache.worlds) return cache.worlds.slice();
  try {
    const snapshot = await getDocs(orderedPublishedQuery(contentWorldsCollection()));
    const items = snapshot.docs.map((item) => record(item, 'worldId'));
    cache.worlds = items;
    items.forEach((item) => cache.records.worlds.set(item.worldId, item));
    return items.slice();
  } catch (error) {
    throw mapReadError(error, false);
  }
}

async function getPublishedWorld(worldId) {
  const id = requireId(worldId, 'World');
  if (cache.records.worlds.has(id)) return cache.records.worlds.get(id);
  try {
    const snapshot = await getDoc(doc(contentWorldsCollection(), id));
    if (!snapshot.exists() || snapshot.data().status !== PUBLISHED) {
      throw publishedError('published/not-found', 'Published world was not found.');
    }
    const item = record(snapshot, 'worldId');
    cache.records.worlds.set(id, item);
    return item;
  } catch (error) {
    throw mapReadError(error, true);
  }
}

async function listPublishedRanks(worldId, options) {
  const parentWorldId = requireId(worldId, 'World');
  const force = Boolean(options && options.force);
  if (!force && cache.ranks.has(parentWorldId)) {
    return cache.ranks.get(parentWorldId).slice();
  }
  try {
    const snapshot = await getDocs(orderedPublishedQuery(ranksCollection(parentWorldId)));
    const items = snapshot.docs.map((item) =>
      record(item, 'rankId', { worldId: parentWorldId })
    );
    cache.ranks.set(parentWorldId, items);
    items.forEach((item) =>
      cache.records.ranks.set(recordKey(parentWorldId, item.rankId), item)
    );
    return items.slice();
  } catch (error) {
    throw mapReadError(error, false);
  }
}

async function getPublishedRank(worldId, rankId) {
  const parentWorldId = requireId(worldId, 'World');
  const id = requireId(rankId, 'Rank');
  const key = recordKey(parentWorldId, id);
  if (cache.records.ranks.has(key)) return cache.records.ranks.get(key);
  try {
    const snapshot = await getDoc(doc(ranksCollection(parentWorldId), id));
    if (!snapshot.exists() || snapshot.data().status !== PUBLISHED) {
      throw publishedError('published/not-found', 'Published rank was not found.');
    }
    const item = record(snapshot, 'rankId', { worldId: parentWorldId });
    cache.records.ranks.set(key, item);
    return item;
  } catch (error) {
    throw mapReadError(error, true);
  }
}

async function listPublishedGates(worldId, rankId, options) {
  const parentWorldId = requireId(worldId, 'World');
  const parentRankId = requireId(rankId, 'Rank');
  const key = recordKey(parentWorldId, parentRankId);
  const force = Boolean(options && options.force);
  if (!force && cache.gates.has(key)) return cache.gates.get(key).slice();
  try {
    const snapshot = await getDocs(orderedPublishedQuery(
      gatesCollection(parentWorldId, parentRankId)
    ));
    const items = snapshot.docs.map((item) =>
      record(item, 'gateId', { worldId: parentWorldId, rankId: parentRankId })
    );
    cache.gates.set(key, items);
    items.forEach((item) =>
      cache.records.gates.set(recordKey(parentWorldId, parentRankId, item.gateId), item)
    );
    return items.slice();
  } catch (error) {
    throw mapReadError(error, false);
  }
}

async function getPublishedGate(worldId, rankId, gateId) {
  const parentWorldId = requireId(worldId, 'World');
  const parentRankId = requireId(rankId, 'Rank');
  const id = requireId(gateId, 'Gate');
  const key = recordKey(parentWorldId, parentRankId, id);
  if (cache.records.gates.has(key)) return cache.records.gates.get(key);
  try {
    const snapshot = await getDoc(doc(
      gatesCollection(parentWorldId, parentRankId),
      id
    ));
    if (!snapshot.exists() || snapshot.data().status !== PUBLISHED) {
      throw publishedError('published/not-found', 'Published gate was not found.');
    }
    const item = record(snapshot, 'gateId', {
      worldId: parentWorldId,
      rankId: parentRankId,
    });
    cache.records.gates.set(key, item);
    return item;
  } catch (error) {
    throw mapReadError(error, true);
  }
}

function normalizeWordPageOptions(options) {
  const source = options && typeof options === 'object' ? options : {};
  const requestedSize = Number(source.pageSize);
  const pageSize = Number.isSafeInteger(requestedSize) && requestedSize > 0
    ? Math.min(requestedSize, PAGE_SIZE)
    : PAGE_SIZE;
  return {
    pageSize,
    direction: source.direction === 'backward' ? 'backward' : 'forward',
    cursor: source.cursor && typeof source.cursor === 'object' ? source.cursor : null,
  };
}

function wordCursor(item) {
  return item ? {
    // Firestore keyset cursors must retain the stored field type exactly.
    order: item.order,
    id: String(item.contentWordId || ''),
  } : null;
}

async function listPublishedGateWords(worldId, rankId, gateId, options) {
  const parentWorldId = requireId(worldId, 'World');
  const parentRankId = requireId(rankId, 'Rank');
  const parentGateId = requireId(gateId, 'Gate');
  const settings = normalizeWordPageOptions(options);
  const constraints = [
    where('status', '==', PUBLISHED),
    orderBy('order', 'asc'),
    orderBy(documentId(), 'asc'),
  ];
  if (settings.cursor) {
    const cursorOrder = settings.cursor.order;
    const cursorId = requireId(settings.cursor.id, 'Word');
    if (
      !(
        (typeof cursorOrder === 'number' && Number.isFinite(cursorOrder)) ||
        (typeof cursorOrder === 'string' && cursorOrder.length > 0)
      )
    ) {
      throw publishedError('published/unavailable', 'Published word cursor is invalid.');
    }
    if (settings.direction === 'backward') {
      constraints.push(endBefore(cursorOrder, cursorId));
    } else {
      constraints.push(startAfter(cursorOrder, cursorId));
    }
  }
  constraints.push(
    settings.direction === 'backward'
      ? limitToLast(settings.pageSize + 1)
      : limit(settings.pageSize + 1)
  );

  try {
    const snapshot = await getDocs(query(
      wordsCollection(parentWorldId, parentRankId, parentGateId),
      ...constraints
    ));
    const overflow = snapshot.docs.length > settings.pageSize;
    const pageDocs = settings.direction === 'backward' && overflow
      ? snapshot.docs.slice(1)
      : snapshot.docs.slice(0, settings.pageSize);
    const items = pageDocs.map((item) => record(item, 'contentWordId', {
      worldId: parentWorldId,
      rankId: parentRankId,
      gateId: parentGateId,
    }));
    const hasPrevious = settings.direction === 'backward'
      ? overflow
      : Boolean(settings.cursor);
    const hasNext = settings.direction === 'backward'
      ? true
      : overflow;
    return {
      items,
      pageSize: settings.pageSize,
      direction: settings.direction,
      hasNext,
      hasPrevious,
      hasMore: hasNext,
      startCursor: wordCursor(items[0]),
      endCursor: wordCursor(items[items.length - 1]),
      beforeCursor: settings.direction === 'backward'
        ? (overflow
          ? wordCursor(record(snapshot.docs[0], 'contentWordId'))
          : null)
        : settings.cursor,
    };
  } catch (error) {
    throw mapReadError(error, false);
  }
}

function invalidate(scope) {
  const target = String(scope || 'all');
  if (target === 'all' || target === 'worlds') {
    cache.worlds = null;
    cache.records.worlds.clear();
  }
  if (target === 'all' || target === 'ranks') {
    cache.ranks.clear();
    cache.records.ranks.clear();
  }
  if (target === 'all' || target === 'gates') {
    cache.gates.clear();
    cache.records.gates.clear();
  }
}

const API = Object.freeze({
  PAGE_SIZE,
  listPublishedWorlds,
  getPublishedWorld,
  listPublishedRanks,
  getPublishedRank,
  listPublishedGates,
  getPublishedGate,
  listPublishedGateWords,
  invalidate,
});

Object.defineProperty(window, 'LootLinguaPublishedContent', {
  value: API,
  configurable: false,
  enumerable: true,
  writable: false,
});

window.dispatchEvent(new CustomEvent('lootlingua:published-content-ready'));
