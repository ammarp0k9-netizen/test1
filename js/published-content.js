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
const CACHE_PREFIX = 'lootlingua:published-cache:v1:' + String(app?.options?.projectId || '') + ':';
const FRESH_MS = 5 * 60 * 1000;
const OFFLINE_MS = 14 * 86400000;
const MAX_SAVED_CHARS = 750000;
const publicReads = new Map();
const publicPending = new Map();
let cacheGeneration = 0;

function savedPublicRead(key) {
  try { return JSON.parse(window.localStorage?.getItem(CACHE_PREFIX + key) || 'null'); }
  catch (_) { return null; }
}

function rememberPublicRead(key, value, persist = true) {
  const at = Date.now();
  const entry = { at, value };
  publicReads.delete(key);
  publicReads.set(key, entry);
  if (publicReads.size > 180) publicReads.delete(publicReads.keys().next().value);
  if (!persist) return;
  try {
    const storage = window.localStorage;
    if (!storage) return;
    const serialized = JSON.stringify(entry);
    if (serialized.length > MAX_SAVED_CHARS) return;
    const keys = [];
    const storageKey = CACHE_PREFIX + key;
    for (let offset = 0; offset < storage.length; offset++) {
      const candidate = storage.key(offset);
      if (!candidate?.startsWith(CACHE_PREFIX) || candidate === storageKey) continue;
      const raw = storage.getItem(candidate);
      keys.push({ key: candidate, size: raw?.length || 0, at: JSON.parse(raw || '{}').at || 0 });
    }
    let total = serialized.length;
    for (const item of keys.sort((a, b) => b.at - a.at)) {
      total += item.size;
      if (total > MAX_SAVED_CHARS || at - item.at > OFFLINE_MS) storage.removeItem(item.key);
    }
    storage.setItem(storageKey, serialized);
  } catch (_) { /* Storage limits never prevent an online read. */ }
}

function temporaryPublicRead(error) {
  const backoff = window.LootLinguaCloudBackoff;
  if (backoff?.classify) return backoff.classify(error).temporary;
  return /(^|\/)(resource-exhausted|unavailable|deadline-exceeded|offline)$/.test(String(error?.cause?.code || error?.code || ''));
}

async function readPublic(scope, args, loader, { force = false, requireFresh = false } = {}) {
  const key = scope + ':' + JSON.stringify(args);
  const now = Date.now();
  const saved = publicReads.get(key) || savedPublicRead(key);
  if (!force && !requireFresh && saved && now - saved.at < FRESH_MS) return saved.value;
  const generation = cacheGeneration;
  const pendingKey = force || requireFresh ? key + ':server' : key;
  let pending = publicPending.get(pendingKey);
  if (!pending) {
    const refresh = async () => {
      if (!force && !requireFresh) {
        const shared = savedPublicRead(key);
        if (shared && Date.now() - shared.at < FRESH_MS) return shared.value;
      }
      window.LootLinguaCloudBackoff?.assertAvailable();
      const value = await loader();
      if (generation === cacheGeneration) rememberPublicRead(key, value);
      return value;
    };
    const locks = window.navigator?.locks;
    pending = Promise.resolve().then(() => {
      if (locks && !force && !requireFresh) return locks.request(CACHE_PREFIX + key, refresh);
      return refresh();
    }).catch(error => {
      window.LootLinguaCloudBackoff?.pause(error);
      throw error;
    }).finally(() => {
      if (publicPending.get(pendingKey) === pending) publicPending.delete(pendingKey);
    });
    publicPending.set(pendingKey, pending);
  }
  try { return await pending; }
  catch (error) {
    if (!requireFresh && generation === cacheGeneration && saved && now - saved.at < OFFLINE_MS && temporaryPublicRead(error)) return saved.value;
    if (error?.code === 'published/not-found') {
      publicReads.delete(key);
      try { window.localStorage?.removeItem(CACHE_PREFIX + key); } catch (_) {}
    }
    throw error;
  }
}

function confirmedPublicSnapshot(snapshot) {
  if (snapshot.metadata?.fromCache) throw publishedError('unavailable', 'A server snapshot is unavailable.');
  return snapshot;
}

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

function worldRecord(snapshot) {
  const item = record(snapshot, 'worldId');
  const schema = window.LootLinguaContentSchema;
  return {
    ...item,
    primaryInterest: typeof schema?.normalizeWorldInterest === 'function'
      ? schema.normalizeWorldInterest(item.primaryInterest)
      : 'unknown',
    interestTags: typeof schema?.normalizeWorldInterestTags === 'function'
      ? schema.normalizeWorldInterestTags(item.interestTags)
      : [],
  };
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

async function fetchPublishedWorlds() {
  try {
    const snapshot = confirmedPublicSnapshot(await getDocs(orderedPublishedQuery(contentWorldsCollection())));
    const items = snapshot.docs.map(worldRecord);
    items.forEach(item => rememberPublicRead('world:' + JSON.stringify([item.worldId]), item, false));
    return items.slice();
  } catch (error) {
    throw mapReadError(error, false);
  }
}

async function fetchPublishedWorld(worldId) {
  const id = requireId(worldId, 'World');
  try {
    const snapshot = confirmedPublicSnapshot(await getDoc(doc(contentWorldsCollection(), id)));
    if (!snapshot.exists() || snapshot.data().status !== PUBLISHED) {
      throw publishedError('published/not-found', 'Published world was not found.');
    }
    const item = worldRecord(snapshot);
    return item;
  } catch (error) {
    throw mapReadError(error, true);
  }
}

async function fetchPublishedRanks(worldId) {
  const parentWorldId = requireId(worldId, 'World');
  try {
    const snapshot = confirmedPublicSnapshot(await getDocs(orderedPublishedQuery(ranksCollection(parentWorldId))));
    const items = snapshot.docs.map((item) =>
      record(item, 'rankId', { worldId: parentWorldId })
    ).sort((left, right) => {
      const compare = window.LootLinguaContentSchema?.comparePublishedRanks;
      return typeof compare === 'function'
        ? compare(left, right)
        : Number(left.order || 0) - Number(right.order || 0);
    });
    items.forEach(item => rememberPublicRead('rank:' + JSON.stringify([parentWorldId, item.rankId]), item, false));
    return items.slice();
  } catch (error) {
    throw mapReadError(error, false);
  }
}

async function fetchPublishedRank(worldId, rankId) {
  const parentWorldId = requireId(worldId, 'World');
  const id = requireId(rankId, 'Rank');
  try {
    const snapshot = confirmedPublicSnapshot(await getDoc(doc(ranksCollection(parentWorldId), id)));
    if (!snapshot.exists() || snapshot.data().status !== PUBLISHED) {
      throw publishedError('published/not-found', 'Published rank was not found.');
    }
    const item = record(snapshot, 'rankId', { worldId: parentWorldId });
    return item;
  } catch (error) {
    throw mapReadError(error, true);
  }
}

async function fetchPublishedGates(worldId, rankId) {
  const parentWorldId = requireId(worldId, 'World');
  const parentRankId = requireId(rankId, 'Rank');
  try {
    const snapshot = confirmedPublicSnapshot(await getDocs(orderedPublishedQuery(
      gatesCollection(parentWorldId, parentRankId)
    )));
    const items = snapshot.docs.map((item) =>
      record(item, 'gateId', { worldId: parentWorldId, rankId: parentRankId })
    );
    items.forEach(item => rememberPublicRead('gate:' + JSON.stringify([parentWorldId, parentRankId, item.gateId]), item, false));
    return items.slice();
  } catch (error) {
    throw mapReadError(error, false);
  }
}

async function fetchPublishedGate(worldId, rankId, gateId) {
  const parentWorldId = requireId(worldId, 'World');
  const parentRankId = requireId(rankId, 'Rank');
  const id = requireId(gateId, 'Gate');
  try {
    const snapshot = confirmedPublicSnapshot(await getDoc(doc(
      gatesCollection(parentWorldId, parentRankId),
      id
    )));
    if (!snapshot.exists() || snapshot.data().status !== PUBLISHED) {
      throw publishedError('published/not-found', 'Published gate was not found.');
    }
    const item = record(snapshot, 'gateId', {
      worldId: parentWorldId,
      rankId: parentRankId,
    });
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

async function fetchPublishedGateWords(worldId, rankId, gateId, options) {
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
    const snapshot = confirmedPublicSnapshot(await getDocs(query(
      wordsCollection(parentWorldId, parentRankId, parentGateId),
      ...constraints
    )));
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

const listPublishedWorlds = options => readPublic('worlds', [], fetchPublishedWorlds, options).then(items => items.slice());
const getPublishedWorld = (world, options) => readPublic('world', [world], () => fetchPublishedWorld(world), options);
const listPublishedRanks = (world, options) => readPublic('ranks', [world], () => fetchPublishedRanks(world), options).then(items => items.slice());
const getPublishedRank = (world, rank, options) => readPublic('rank', [world, rank], () => fetchPublishedRank(world, rank), options);
const listPublishedGates = (world, rank, options) => readPublic('gates', [world, rank], () => fetchPublishedGates(world, rank), options).then(items => items.slice());
const getPublishedGate = (world, rank, gate, options) => readPublic('gate', [world, rank, gate], () => fetchPublishedGate(world, rank, gate), options);
const listPublishedGateWords = (world, rank, gate, options = {}) => {
  const settings = normalizeWordPageOptions(options);
  return readPublic('words', [world, rank, gate, settings], () => fetchPublishedGateWords(world, rank, gate, settings), options)
    .then(page => ({ ...page, items: page.items.slice() }));
};

async function listAllPublishedGateWords(worldId, rankId, gateId, options = {}) {
  const items = [];
  const seen = new Set();
  let cursor = null;
  let pageCount = 0;

  while (pageCount < 100) {
    const page = await listPublishedGateWords(worldId, rankId, gateId, {
      pageSize: PAGE_SIZE,
      direction: 'forward',
      cursor,
      force: options.force,
      requireFresh: options.requireFresh,
    });
    page.items.forEach((item) => {
      const id = String(item.contentWordId || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push(item);
    });
    pageCount += 1;
    if (!page.hasNext) return items;
    if (!page.endCursor) {
      throw publishedError(
        'published/unavailable',
        'Published word pagination ended without a cursor.'
      );
    }
    cursor = page.endCursor;
  }

  throw publishedError(
    'published/unavailable',
    'Published gate word pagination exceeded its safe page limit.'
  );
}

function invalidate(scope) {
  const target = String(scope || 'all');
  cacheGeneration++;
  const aliases = { worlds: ['worlds', 'world'], ranks: ['ranks', 'rank'], gates: ['gates', 'gate', 'words'] };
  const invalid = key => target === 'all' || (aliases[target] || [target]).includes(key.split(':', 1)[0]);
  for (const key of publicReads.keys()) if (invalid(key)) publicReads.delete(key);
  for (const key of publicPending.keys()) if (invalid(key)) publicPending.delete(key);
  try {
    const storage = window.localStorage;
    for (let index = (storage?.length || 0) - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(CACHE_PREFIX) && invalid(key.slice(CACHE_PREFIX.length))) storage.removeItem(key);
    }
  } catch (_) {}
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
  listAllPublishedGateWords,
  invalidate,
});

Object.defineProperty(window, 'LootLinguaPublishedContent', {
  value: API,
  configurable: false,
  enumerable: true,
  writable: false,
});

window.dispatchEvent(new CustomEvent('lootlingua:published-content-ready'));
