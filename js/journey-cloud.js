import { getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = getApps()[0];
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const ACTIVE_JOURNEY_META_ID = 'active_content_journey';
const MAX_LOADED_WORD_IDS = 2000;
const PLACEMENT_SOURCE = Object.freeze({
  source: 'placement',
  suppressRewards: true,
});

const cache = {
  uid: '',
  active: undefined,
  journeys: new Map(),
  gateProgress: new Map(),
  rankGateProgress: new Map(),
  gateWords: new Map(),
  placementSessions: new Map(),
  levelPlacementSessions: new Map(),
  gateClearAttempts: new Map(),
};
const levelPlacementStartRequests = new Map();

function core() {
  const api = window.LootLinguaJourney;
  if (!api) throw journeyCloudError('journey/unavailable', 'Journey contract is unavailable.');
  return api;
}

function contentApi() {
  const api = window.LootLinguaPublishedContent;
  if (!api) throw journeyCloudError('journey/unavailable', 'Published content is unavailable.');
  return api;
}

function placementCore() {
  const api = window.LootLinguaPlacement;
  if (!api) throw journeyCloudError('placement/unavailable', 'Placement contract is unavailable.');
  return api;
}

function evidenceCore() {
  const api = window.LootLinguaLearningEvidence;
  if (!api) throw journeyCloudError('evidence/unavailable', 'Learning Evidence contract is unavailable.');
  return api;
}

function gateClearCore() {
  const api = window.LootLinguaGateClear;
  if (!api) throw journeyCloudError('gate-clear/unavailable', 'Gate Clear contract is unavailable.');
  return api;
}

function levelPlacementCore() {
  const api = window.LootLinguaLevelPlacement;
  if (!api) {
    throw journeyCloudError(
      'level-placement/unavailable',
      'Level Placement contract is unavailable.'
    );
  }
  return api;
}

function schemaApi() {
  const api = window.LootLinguaContentSchema;
  if (!api) throw journeyCloudError('journey/unavailable', 'Content schema is unavailable.');
  return api;
}

function journeyCloudError(code, message, cause) {
  const error = new Error(message || code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function journeyOperationError(error, operation, details) {
  const source = error && typeof error === 'object'
    ? error
    : new Error(String(error || 'Journey operation failed.'));
  const wrapped = journeyCloudError(
    String(source.code || 'journey/operation-failed'),
    String(source.message || 'Journey operation failed.'),
    source
  );
  wrapped.operation = String(source.operation || operation || 'journey');
  if (source.stack) wrapped.stack = source.stack;
  Object.assign(wrapped, details || {});
  return wrapped;
}

function diagnosticField(value) {
  if (Array.isArray(value)) return { type: 'array', value: value.map(String) };
  if (value === null) return { type: 'null', value: null };
  if (value instanceof Date) return { type: 'timestamp', value: value.toISOString() };
  if (typeof value?.toDate === 'function') {
    return { type: 'timestamp', value: value.toDate().toISOString() };
  }
  if (value && typeof value === 'object') return { type: 'map', value };
  return { type: typeof value, value };
}

function logJourneyProgressionCommit(details) {
  if (window.__LOOTLINGUA_JOURNEY_DIAGNOSTICS__ !== true) return;
  const fields = (payload) => Object.fromEntries(
    Object.entries(payload || {}).map(([key, value]) => [key, diagnosticField(value)])
  );
  console.info('[LootLingua journey progression]', {
    authUid: String(details.authUid || ''),
    operations: (details.operations || []).map((operation) => ({
      type: operation.type,
      path: operation.path,
      fields: fields(operation.fields),
    })),
    activePointer: fields(details.activePointer),
    parentBefore: fields(details.parentBefore),
    parentProposed: fields(details.parentProposed),
  });
}

function logJourneyOperationStage(details) {
  if (window.__LOOTLINGUA_JOURNEY_DIAGNOSTICS__ !== true) return;
  const source = details && typeof details === 'object' ? details : {};
  console.info('[LootLingua journey operation]', {
    operation: String(source.operation || 'journey'),
    stage: String(source.stage || ''),
    worldId: String(source.worldId || ''),
    assessmentId: String(source.assessmentId || ''),
    sessionStatusBefore: String(source.sessionStatusBefore || ''),
    sessionStatusAfter: String(source.sessionStatusAfter || ''),
    resultApplied: source.resultApplied === true,
    saveWordChoice: String(source.saveWordChoice || ''),
    questionCount: Number(source.questionCount) || 0,
    answerCount: Number(source.answerCount) || 0,
    targetCount: Number(source.targetCount) || 0,
    savedCount: Number(source.savedCount) || 0,
    failureCount: Number(source.failureCount) || 0,
    commitSucceeded: source.commitSucceeded === true,
    destination: {
      rankId: String(source.destination?.rankId || ''),
      gateId: String(source.destination?.gateId || ''),
      completedCurrentContent: source.destination?.completedCurrentContent === true,
    },
    failureCode: String(source.failureCode || ''),
  });
}

function requireServices() {
  if (!auth || !db) {
    throw journeyCloudError('journey/unavailable', 'Journey storage is unavailable.');
  }
  return { auth, db };
}

function requireUser() {
  const user = requireServices().auth.currentUser;
  if (!user) {
    throw journeyCloudError(
      'journey/sign-in-required',
      'Sign in before starting a published journey.'
    );
  }
  if (cache.uid !== user.uid) resetCache(user.uid);
  return user;
}

function resetCache(uid) {
  cache.uid = String(uid || '');
  cache.active = undefined;
  cache.journeys.clear();
  cache.gateProgress.clear();
  cache.rankGateProgress.clear();
  cache.gateWords.clear();
  cache.placementSessions.clear();
  cache.levelPlacementSessions.clear();
  cache.gateClearAttempts.clear();
}

function record(snapshot, idField) {
  if (!snapshot.exists()) return null;
  return { ...(snapshot.data() || {}), [idField]: snapshot.id };
}

function journeyRef(uid, worldId) {
  return doc(db, 'users', uid, 'contentProgress', core().cleanId(worldId, 'World'));
}

function activeJourneyRef(uid) {
  return doc(db, 'users', uid, 'meta', ACTIVE_JOURNEY_META_ID);
}

function gateProgressRef(uid, worldId, rankId, gateId) {
  return doc(
    journeyRef(uid, worldId),
    'ranks',
    core().cleanId(rankId, 'Rank'),
    'gates',
    core().cleanId(gateId, 'Gate')
  );
}

function gateProgressCollection(uid, worldId, rankId) {
  return collection(
    journeyRef(uid, worldId),
    'ranks',
    core().cleanId(rankId, 'Rank'),
    'gates'
  );
}

function placementSessionRef(uid, worldId, assessmentId) {
  return doc(
    journeyRef(uid, worldId),
    'placementSessions',
    placementCore().cleanId(assessmentId, 'Assessment')
  );
}

function levelPlacementSessionRef(uid, worldId, assessmentId) {
  return doc(
    journeyRef(uid, worldId),
    'levelPlacementSessions',
    levelPlacementCore().cleanId(assessmentId, 'Assessment')
  );
}

function levelPlacementSessionsCollection(uid, worldId) {
  return collection(journeyRef(uid, worldId), 'levelPlacementSessions');
}

function quizEvidenceSessionRef(uid, sessionId) {
  return doc(db, 'users', uid, 'quizEvidenceSessions', core().cleanId(sessionId, 'Quiz session'));
}

function wordEvidenceEventRef(uid, wordKey, eventId) {
  return doc(
    db,
    'users',
    uid,
    'contentWords',
    core().cleanId(wordKey, 'Word key'),
    'evidence',
    core().cleanId(eventId, 'Evidence event')
  );
}

function gateClearAttemptRef(uid, worldId, attemptId) {
  return doc(
    db,
    'users',
    uid,
    'contentProgress',
    core().cleanId(worldId, 'World'),
    'gateClearAttempts',
    gateClearCore().cleanId(attemptId, 'Attempt')
  );
}

function contentWorldRef(worldId) {
  return doc(db, 'content_worlds', core().cleanId(worldId, 'World'));
}

function contentRankRef(worldId, rankId) {
  return doc(contentWorldRef(worldId), 'ranks', core().cleanId(rankId, 'Rank'));
}

function contentGateRef(worldId, rankId, gateId) {
  return doc(
    contentRankRef(worldId, rankId),
    'gates',
    core().cleanId(gateId, 'Gate')
  );
}

function gateCacheKey(worldId, rankId, gateId) {
  return core().gateProgressPathKey(worldId, rankId, gateId);
}

function rankCacheKey(worldId, rankId) {
  return `${core().cleanId(worldId, 'World')}/${core().cleanId(rankId, 'Rank')}`;
}

function assertPublished(snapshot, code) {
  if (!snapshot.exists() || snapshot.data()?.status !== 'published') {
    throw journeyCloudError(code || 'journey/content-unavailable', 'Published content is unavailable.');
  }
  return snapshot.data();
}

function assertInitiallyAvailable(data, code) {
  if (core().initialAccessStatus(data) !== 'available') {
    throw journeyCloudError(code || 'journey/locked', 'This content is locked.');
  }
}

async function getJourney(worldId, options) {
  const user = requireUser();
  const id = core().cleanId(worldId, 'World');
  if (!options?.force && cache.journeys.has(id)) return cache.journeys.get(id);
  const snapshot = await getDoc(journeyRef(user.uid, id));
  const value = record(snapshot, 'worldId');
  cache.journeys.set(id, value);
  return value;
}

async function getPointedJourney(options) {
  const user = requireUser();
  const pointer = await getDoc(activeJourneyRef(user.uid));
  const worldId = pointer.exists() ? String(pointer.data()?.worldId || '') : '';
  return worldId ? getJourney(worldId, options) : null;
}

async function listJourneyRecords(options) {
  const user = requireUser();
  const snapshot = await getDocs(collection(db, 'users', user.uid, 'contentProgress'));
  const journeys = snapshot.docs.map((item) => ({
    ...(item.data() || {}),
    worldId: item.id,
  }));
  journeys.forEach((journey) => {
    cache.journeys.set(String(journey.worldId || ''), journey);
  });
  return journeys.sort((left, right) => (
    timestampMillis(right?.updatedAt) - timestampMillis(left?.updatedAt)
  ));
}

function accountDestination(destination, journey, pointerWorldId, source) {
  const resolved = destination || { type: 'unavailable' };
  return {
    ...resolved,
    classification: core().classifyJourneyDestination(resolved),
    worldId: String(resolved.worldId || journey?.worldId || ''),
    journey: journey || null,
    pointerWorldId: String(pointerWorldId || ''),
    source: String(source || 'active-pointer'),
  };
}

async function resolveAccountJourneyDestination(options) {
  const pointedJourney = await getPointedJourney(options);
  const pointerWorldId = String(pointedJourney?.worldId || '');
  let resolvedPointer = null;
  if (pointedJourney) {
    const pointerDestination = await resolveActiveJourneyDestination(pointerWorldId, options);
    resolvedPointer = accountDestination(
      pointerDestination,
      pointedJourney,
      pointerWorldId,
      'active-pointer'
    );
    if (resolvedPointer.classification === 'actionable-journey') {
      return resolvedPointer;
    }
  }

  const journeys = await listJourneyRecords(options);
  const activeCandidates = journeys.filter((journey) => (
    journey?.status === 'active' &&
    String(journey.worldId || '') !== pointerWorldId
  ));
  let terminalCandidate = null;
  for (const candidate of activeCandidates) {
    const destination = await resolveActiveJourneyDestination(candidate.worldId, options);
    const resolved = accountDestination(
      destination,
      candidate,
      pointerWorldId,
      'active-journey-scan'
    );
    if (resolved.classification === 'actionable-journey') return resolved;
    if (!terminalCandidate && resolved.classification === 'world-completed') {
      terminalCandidate = { ...resolved, source: 'terminal-journey-scan' };
    }
  }

  if (resolvedPointer?.classification === 'world-completed') {
    return { ...resolvedPointer, source: 'terminal-pointer' };
  }
  if (terminalCandidate) return terminalCandidate;
  if (resolvedPointer) return { ...resolvedPointer, source: 'inactive-pointer' };
  return accountDestination(
    { type: 'unavailable', reason: 'no-actionable-journey' },
    null,
    pointerWorldId,
    'journey-scan'
  );
}

async function getActiveJourney(options) {
  if (!options?.force && cache.active !== undefined) return cache.active;
  const destination = await resolveAccountJourneyDestination(options);
  cache.active = destination.classification === 'actionable-journey'
    ? destination.journey
    : null;
  return cache.active;
}

async function hasAnyJourneyProgress() {
  const user = requireUser();
  const snapshot = await getDocs(query(
    collection(db, 'users', user.uid, 'contentProgress'),
    limit(1)
  ));
  return !snapshot.empty;
}

async function getGateProgress(worldId, rankId, gateId, options) {
  const user = requireUser();
  const key = gateCacheKey(worldId, rankId, gateId);
  if (!options?.force && cache.gateProgress.has(key)) {
    return cache.gateProgress.get(key);
  }
  const snapshot = await getDoc(gateProgressRef(user.uid, worldId, rankId, gateId));
  const value = record(snapshot, 'gateId');
  cache.gateProgress.set(key, value);
  return value;
}

async function listRankGateProgress(worldId, rankId, options) {
  const user = requireUser();
  const key = rankCacheKey(worldId, rankId);
  if (!options?.force && cache.rankGateProgress.has(key)) {
    return new Map(cache.rankGateProgress.get(key));
  }
  const snapshot = await getDocs(gateProgressCollection(user.uid, worldId, rankId));
  const values = new Map(snapshot.docs.map((item) => [
    item.id,
    { ...(item.data() || {}), gateId: item.id },
  ]));
  cache.rankGateProgress.set(key, values);
  values.forEach((value, gateId) => {
    cache.gateProgress.set(gateCacheKey(worldId, rankId, gateId), value);
  });
  return new Map(values);
}

function timestampMillis(value) {
  return Math.max(0, Number(value?.toMillis?.() ?? value) || 0);
}

async function listLevelPlacementSessions(worldId, options) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const snapshot = await getDocs(levelPlacementSessionsCollection(user.uid, world));
  return snapshot.docs.map((item) => ({
    ...(item.data() || {}),
    assessmentId: item.id,
  })).sort((left, right) => (
    timestampMillis(right.updatedAt) - timestampMillis(left.updatedAt)
  ));
}

function latestLevelPlacementHistory(sessions, cefrLevel, preferredAssessmentId) {
  const level = levelPlacementCore().assertClassifiedLevel(cefrLevel);
  const matching = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => String(session?.cefrLevel || '') === level)
    .filter((session) => (
      session?.resultApplied === true ||
      ['awaiting-decision', 'paused', 'completed'].includes(String(session?.status || ''))
    ));
  const preferred = String(preferredAssessmentId || '');
  return matching.find((session) => String(session.assessmentId || '') === preferred) ||
    matching[0] || null;
}

function deriveLevelPlacementHistory(level, journey, sessions, ranks, graph) {
  const preferredId = journey?.levelPlacementAssessmentIds?.[level] || '';
  const history = latestLevelPlacementHistory(sessions, level, preferredId);
  const hasPlacementEvidence = Boolean(
    history ||
    (journey?.passedCefrLevels || []).includes(level) ||
    (journey?.partialCefrLevels || []).includes(level)
  );
  if (!hasPlacementEvidence) return null;
  const derived = levelPlacementCore().deriveLegacyRankCoverage({
    cefrLevel: level,
    journey,
    sessions,
    ranks,
    gatesByRank: graph?.gatesByRank,
    progressByRank: graph?.progressByRank,
  });
  return {
    ...(history || {}),
    ...derived,
    assessmentId: String(history?.assessmentId || preferredId || ''),
    legacyDerived: !history?.assessedRankIds || !history?.testedRankIds ||
      !history?.publishedRankSetHash,
  };
}

function buildLevelPlacementOverviews(journey, publishedRanks, sessions, graph) {
  const overviews = new Map();
  schemaApi().CEFR_LEVELS.filter((level) => level !== 'unclassified').forEach((level) => {
    const levelRanks = core().stableRankOrder(publishedRanks).filter((rank) =>
      schemaApi().normalizeCefrLevel(rank.cefrLevel) === level
    );
    if (!levelRanks.length) return;
    const history = deriveLevelPlacementHistory(level, journey, sessions, levelRanks, graph);
    const unassessedRanks = history
      ? levelPlacementCore().getUnassessedPublishedRanks(level, levelRanks, history)
      : [];
    overviews.set(level, {
      level,
      ranks: levelRanks,
      history,
      unassessedRanks,
      unassessedRankIds: unassessedRanks.map((rank) => String(rank.rankId)),
      publishedSnapshot: levelPlacementCore().rankSetSnapshot(levelRanks),
    });
  });
  return overviews;
}

async function getLevelPlacementOverview(worldId, cefrLevel, options) {
  const [journey, ranks, sessions] = await Promise.all([
    getJourney(worldId, options),
    contentApi().listPublishedRanks(worldId, options),
    listLevelPlacementSessions(worldId, options),
  ]);
  const level = levelPlacementCore().assertClassifiedLevel(cefrLevel);
  const graph = await loadJourneyGraph(worldId, { ...(options || {}), ranks });
  const overview = buildLevelPlacementOverviews(journey, ranks, sessions, graph).get(level);
  if (overview) return overview;
  const levelRanks = core().stableRankOrder(ranks).filter((rank) =>
    schemaApi().normalizeCefrLevel(rank.cefrLevel) === level
  );
  return {
    level,
    ranks: levelRanks,
    history: null,
    unassessedRanks: levelRanks.slice(),
    unassessedRankIds: levelRanks.map((rank) => String(rank.rankId)),
    publishedSnapshot: levelPlacementCore().rankSetSnapshot(levelRanks),
  };
}

async function getLevelPlacementOverviews(worldId, ranks, options) {
  const [journey, publishedRanks, sessions] = await Promise.all([
    getJourney(worldId, options),
    Array.isArray(ranks)
      ? Promise.resolve(ranks)
      : contentApi().listPublishedRanks(worldId, options),
    listLevelPlacementSessions(worldId, options),
  ]);
  const graph = await loadJourneyGraph(worldId, { ...(options || {}), ranks: publishedRanks });
  return buildLevelPlacementOverviews(journey, publishedRanks, sessions, graph);
}

async function resolveJourneyStart(worldId) {
  const api = contentApi();
  const world = await api.getPublishedWorld(worldId);
  const ranks = core().stableRankOrder(await api.listPublishedRanks(world.worldId));
  const firstRank = ranks.find((rank) => core().canAccessRank(rank, null));
  if (!firstRank) {
    throw journeyCloudError('journey/rank-locked', 'No published rank is available.');
  }
  const gates = core().stableContentOrder(
    await api.listPublishedGates(world.worldId, firstRank.rankId),
    'gateId'
  );
  const selection = core().selectJourneyStart(
    [firstRank],
    { [firstRank.rankId]: gates }
  );
  if (!selection) {
    throw journeyCloudError('journey/gate-locked', 'The first gate is locked.');
  }
  return { world, rank: selection.rank, gate: selection.gate };
}

async function resolveNextContentTarget(worldId, rankId, gateId) {
  const api = contentApi();
  const ranks = core().stableRankOrder(await api.listPublishedRanks(worldId));
  const gatesByRank = new Map();
  await Promise.all(ranks.map(async (rank) => {
    const id = String(rank.rankId || '');
    if (!id) return;
    gatesByRank.set(
      id,
      core().stableContentOrder(
        await api.listPublishedGates(worldId, id),
        'gateId'
      )
    );
  }));
  return core().selectNextJourneyTarget(ranks, gatesByRank, rankId, gateId);
}

async function startJourney(worldId) {
  const user = requireUser();
  const id = core().cleanId(worldId, 'World');
  const existing = await getJourney(id, { force: true });
  const selection = existing
    ? {
      world: await contentApi().getPublishedWorld(id),
      rank: await contentApi().getPublishedRank(id, existing.activeRankId),
      gate: await contentApi().getPublishedGate(
        id,
        existing.activeRankId,
        existing.activeGateId
      ),
    }
    : await resolveJourneyStart(id);
  const seed = existing || core().createJourneySeed(
    id,
    selection.rank.rankId,
    selection.gate.gateId
  );
  const targetRef = journeyRef(user.uid, id);
  const pointerRef = activeJourneyRef(user.uid);
  const progressRef = gateProgressRef(
    user.uid,
    id,
    seed.activeRankId,
    seed.activeGateId
  );

  try {
    await runTransaction(db, async (transaction) => {
      const [pointerSnapshot, targetSnapshot, worldSnapshot, rankSnapshot, gateSnapshot, progressSnapshot] =
        await Promise.all([
          transaction.get(pointerRef),
          transaction.get(targetRef),
          transaction.get(contentWorldRef(id)),
          transaction.get(contentRankRef(id, seed.activeRankId)),
          transaction.get(contentGateRef(id, seed.activeRankId, seed.activeGateId)),
          transaction.get(progressRef),
        ]);
      assertPublished(worldSnapshot, 'journey/world-unavailable');
      const rankData = assertPublished(rankSnapshot, 'journey/rank-unavailable');
      assertPublished(gateSnapshot, 'journey/gate-unavailable');
      if (!targetSnapshot.exists()) {
        assertInitiallyAvailable(rankData, 'journey/rank-locked');
      }

      const previousWorldId = pointerSnapshot.exists()
        ? String(pointerSnapshot.data()?.worldId || '')
        : '';
      let previousSnapshot = null;
      let previousRef = null;
      if (previousWorldId && previousWorldId !== id) {
        previousRef = journeyRef(user.uid, previousWorldId);
        previousSnapshot = await transaction.get(previousRef);
      }

      if (previousRef && previousSnapshot?.exists()) {
        transaction.update(previousRef, {
          status: 'paused',
          updatedAt: serverTimestamp(),
        });
      }

      if (targetSnapshot.exists()) {
        transaction.update(targetRef, {
          status: 'active',
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.set(targetRef, {
          ...seed,
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (!progressSnapshot.exists()) {
        transaction.set(progressRef, {
          worldId: id,
          rankId: seed.activeRankId,
          gateId: seed.activeGateId,
          status: 'available',
          journeyVersion: core().JOURNEY_VERSION,
          lastActivityAt: serverTimestamp(),
          readyEvidenceCount: 0,
          clearAttempts: 0,
        });
      }

      transaction.set(pointerRef, {
        worldId: id,
        journeyVersion: core().JOURNEY_VERSION,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    throw journeyOperationError(error, 'start-journey-transaction', {
      uid: user.uid,
      worldId: id,
      rankId: seed.activeRankId,
      gateId: seed.activeGateId,
    });
  }

  resetCache(user.uid);
  const journey = await getJourney(id, { force: true });
  cache.active = journey;
  window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
    detail: { worldId: id, type: existing ? 'resumed' : 'started' },
  }));
  return journey;
}

async function switchActiveJourney(worldId) {
  return startJourney(worldId);
}

function personalWordsCollection(uid) {
  return collection(db, 'users', uid, 'words');
}

async function readPersonalWordIndex(uid) {
  const snapshot = await getDocs(personalWordsCollection(uid));
  const schema = schemaApi();
  const index = new Map();
  snapshot.docs.forEach((item) => {
    const data = item.data() || {};
    const identity = schema.normalizeWordIdentity(data.text || data.word || '');
    if (identity.wordKey && !index.has(identity.wordKey)) {
      index.set(identity.wordKey, { id: item.id, data });
    }
  });
  return index;
}

function deterministicLegacyWordId(wordKey) {
  return `published_${core().cleanId(wordKey, 'Word key')}`.slice(0, 500);
}

const USER_WORD_EDUCATIONAL_FIELDS = Object.freeze([
  'word',
  'normalizedWord',
  'wordKey',
  'translation',
  'definition',
  'definition_ar',
  'example',
  'exampleTranslation',
  'partOfSpeech',
  'category',
  'level',
  'tags',
  'synonyms',
  'pronunciation',
  'notes',
]);

function contentWordToUserWordFields(word, normalizedIdentity) {
  const identity = normalizedIdentity || schemaApi().normalizeWordIdentity(word);
  return {
    word: String(word?.word || ''),
    normalizedWord: String(identity.normalizedWord || ''),
    wordKey: String(identity.wordKey || ''),
    translation: String(word?.translation || word?.meaning || ''),
    definition: String(word?.definition || ''),
    definition_ar: String(word?.definition_ar || word?.definitionAr || ''),
    example: String(word?.example || ''),
    exampleTranslation: String(word?.exampleTranslation || ''),
    partOfSpeech: String(word?.partOfSpeech || ''),
    category: String(word?.category || ''),
    level: String(word?.level || word?.difficulty || ''),
    tags: Array.isArray(word?.tags) ? word.tags.map(String).filter(Boolean) : [],
    synonyms: Array.isArray(word?.synonyms) ? word.synonyms.map(String).filter(Boolean) : [],
    pronunciation: String(word?.pronunciation || ''),
    notes: String(word?.notes || ''),
  };
}

function missingEducationalWordPatch(existing, incoming) {
  const patch = {};
  USER_WORD_EDUCATIONAL_FIELDS.forEach((field) => {
    const current = existing?.[field];
    const next = incoming?.[field];
    const currentEmpty = Array.isArray(current)
      ? current.length === 0
      : !String(current ?? '').trim() || (field === 'category' && current === 'عام');
    const nextPresent = Array.isArray(next)
      ? next.length > 0
      : Boolean(String(next ?? '').trim());
    if (currentEmpty && nextPresent) patch[field] = next;
  });
  if ((!existing?.text && !existing?.word) && incoming.word) patch.text = incoming.word;
  if (!existing?.meaning && incoming.translation) patch.meaning = incoming.translation;
  return patch;
}

function canonicalWordPayload(word, identity, legacyWordId, source, options) {
  const sourceId = String(options?.sourceId || core().contentSourceId(source));
  const addedFrom = String(options?.sourceType || 'published-gate');
  const educational = contentWordToUserWordFields(word, identity);
  return {
    word: educational.word,
    normalizedWord: educational.normalizedWord,
    wordKey: educational.wordKey,
    translation: educational.translation,
    canonicalId: identity.wordKey,
    normalizationVersion: identity.normalizationVersion,
    masteryKey: identity.wordKey,
    legacyWordId,
    meaning: educational.translation,
    difficulty: educational.level,
    forgetCount: 0,
    contentRefPath: `content_worlds/${source.worldId}/ranks/${source.rankId}/gates/${source.gateId}/words/${source.contentWordId}`,
    primarySource: {
      worldId: source.worldId,
      rankId: source.rankId,
      gateId: source.gateId,
      contentWordId: source.contentWordId,
      sourceId,
      addedFrom,
    },
    sourceCount: 1,
    eligibleEvidenceCount: 0,
    lastEligibleEvidenceAt: null,
    lastEvidenceEventId: '',
    evidenceVersion: evidenceCore().EVIDENCE_VERSION,
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function legacyWordPayload(uid, word) {
  const educational = contentWordToUserWordFields(word);
  return {
    ...educational,
    text: educational.word,
    category: educational.category || 'عام',
    meaning: educational.translation,
    starred: false,
    forgetCount: 0,
    userId: uid,
    xpValue: 0,
    mastery_status: 'New',
    mastery_streak: 0,
    last_recalled_at: null,
    first_recalled_at: null,
    last_recall_day: '',
    last_recall_session_id: '',
    last_quizzed_at: null,
    quiz_seen_count: 0,
    mastered_once: false,
    firstMasteredAt: null,
    hasEarnedMasteryXP: false,
    earnedTransitions: [],
    remasteryAwardCount: 0,
    xpEconomyVersion: 0,
    order: 0,
    createdAt: serverTimestamp(),
  };
}

async function linkPublishedWord(uid, word, personalIndex, operationId, options) {
  let savedWord;
  try {
    savedWord = options?.sourceType === 'level-placement'
      ? levelPlacementCore().normalizeSavedWordSnapshot(word)
      : word;
  } catch (error) {
    throw journeyCloudError('journey/invalid-word', error?.message, error);
  }
  const identity = schemaApi().normalizeWordIdentity(savedWord);
  if (!identity.normalizedWord || !identity.wordKey) {
    throw journeyCloudError('journey/invalid-word', 'Published word identity is invalid.');
  }
  // Preserve a legacy server-written value without ever creating or consulting it.
  // Rules require this field to remain unchanged on every client update.
  if (
    savedWord.normalizedWord !== identity.normalizedWord ||
    savedWord.wordKey !== identity.wordKey
  ) {
    throw journeyCloudError('journey/invalid-word', 'Published word identity is inconsistent.');
  }

  const source = {
    worldId: core().cleanId(savedWord.worldId, 'World'),
    rankId: core().cleanId(savedWord.rankId, 'Rank'),
    gateId: core().cleanId(savedWord.gateId, 'Gate'),
    contentWordId: core().cleanId(savedWord.contentWordId, 'Word'),
  };
  const sourceType = options?.sourceType === 'level-placement'
    ? 'level-placement'
    : 'published-gate';
  const assessmentId = sourceType === 'level-placement'
    ? levelPlacementCore().cleanId(options?.assessmentId, 'Assessment')
    : '';
  const sourceId = sourceType === 'level-placement'
    ? core().levelPlacementSourceId({ assessmentId, contentWordId: source.contentWordId })
    : core().contentSourceId(source);
  const lifecycleCloud = window.LootLinguaWordLifecycleCloud;
  if (lifecycleCloud?.upsertUserWordWithSource) {
    const indexedWord = personalIndex.get(identity.wordKey);
    const result = await lifecycleCloud.upsertUserWordWithSource({
      uid,
      word: savedWord,
      existingWordId: indexedWord?.id,
      operationId,
      restoreHidden: options?.restoreHidden === true,
      source: {
        ...source,
        type: sourceType,
        ...(sourceType === 'level-placement'
          ? {
            assessmentId,
            cefrLevel: levelPlacementCore().assertClassifiedLevel(options?.cefrLevel),
            placementResult: options?.placementResult === 'correct' ? 'correct' : 'incorrect',
          }
          : {}),
        ...(options?.placementAssessmentId
          ? { placementAssessmentId: String(options.placementAssessmentId) }
          : {}),
      },
    });
    personalIndex.set(identity.wordKey, {
      id: result.wordId,
      data: {
        ...(indexedWord?.data || {}),
        ...contentWordToUserWordFields(savedWord, identity),
        hiddenFromDictionary: result.hiddenPreserved,
      },
    });
    return result;
  }
  const canonicalRef = doc(db, 'users', uid, 'contentWords', identity.wordKey);
  const sourceRef = doc(canonicalRef, 'sources', sourceId);
  const indexedWord = personalIndex.get(identity.wordKey);

  try {
    const result = await runTransaction(db, async (transaction) => {
      const [canonicalSnapshot, sourceSnapshot] = await Promise.all([
        transaction.get(canonicalRef),
        transaction.get(sourceRef),
      ]);
      const canonicalData = canonicalSnapshot.exists() ? canonicalSnapshot.data() : null;
      const legacyWordId = String(
        canonicalData?.legacyWordId ||
        indexedWord?.id ||
        deterministicLegacyWordId(identity.wordKey)
      );
      const legacyRef = doc(db, 'users', uid, 'words', legacyWordId);
      const legacySnapshot = await transaction.get(legacyRef);
      const restoredReady = Boolean(canonicalSnapshot.exists() && !legacySnapshot.exists() && !indexedWord);
      const created = Boolean(!canonicalSnapshot.exists() && !legacySnapshot.exists() && !indexedWord);

      if (!canonicalSnapshot.exists()) {
        transaction.set(
          canonicalRef,
          canonicalWordPayload(savedWord, identity, legacyWordId, source, {
            sourceId,
            sourceType,
          })
        );
      }
      const incomingWord = legacyWordPayload(uid, savedWord);
      const legacyProjectionPending = !legacySnapshot.exists();
      if (legacySnapshot.exists()) {
        const educationalPatch = missingEducationalWordPatch(
          legacySnapshot.data() || {},
          incomingWord
        );
        if (Object.keys(educationalPatch).length) {
          transaction.update(legacyRef, educationalPatch);
        }
      }
      if (!sourceSnapshot.exists()) {
        transaction.set(sourceRef, {
          ...source,
          addedFrom: sourceType,
          operationId,
          linkedAt: serverTimestamp(),
          ...(sourceType === 'level-placement'
            ? {
              type: sourceType,
              assessmentId,
              cefrLevel: levelPlacementCore().assertClassifiedLevel(options?.cefrLevel),
              placementResult: options?.placementResult === 'correct' ? 'correct' : 'incorrect',
            }
            : {}),
          ...(options?.placementAssessmentId
            ? {
              placementAssessmentId: String(options.placementAssessmentId),
              placementSeenAt: serverTimestamp(),
            }
            : {}),
        });
      }
      personalIndex.set(identity.wordKey, {
        id: legacyWordId,
        data: legacySnapshot.exists()
          ? { ...legacySnapshot.data(), ...missingEducationalWordPatch(legacySnapshot.data(), incomingWord) }
          : incomingWord,
      });
      return {
        linked: !sourceSnapshot.exists(),
        existingWord: Boolean(indexedWord || legacySnapshot.exists()),
        contentWordId: source.contentWordId,
        created,
        sourceLinked: !created && !restoredReady && !sourceSnapshot.exists(),
        alreadyLinked: sourceSnapshot.exists(),
        restoredReady,
        legacyProjectionPending,
        legacyProjection: legacyProjectionPending
          ? { reference: legacyRef, payload: incomingWord }
          : null,
      };
    });
    if (result.legacyProjectionPending && result.legacyProjection) {
      const projection = result.legacyProjection;
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(projection.reference);
        if (snapshot.exists()) return;
        transaction.set(projection.reference, projection.payload);
      });
    }
    delete result.legacyProjection;
    delete result.legacyProjectionPending;
    return result;
  } catch (error) {
    throw journeyOperationError(error, 'link-published-word-source-transaction', {
      uid,
      ...source,
      wordKey: identity.wordKey,
    });
  }
}

async function listAllGateWords(worldId, rankId, gateId, options) {
  const key = gateCacheKey(worldId, rankId, gateId);
  if (!options?.force && cache.gateWords.has(key)) {
    return cache.gateWords.get(key).slice();
  }
  let words;
  try {
    words = await contentApi().listAllPublishedGateWords(worldId, rankId, gateId);
  } catch (error) {
    throw journeyOperationError(error, 'read-all-published-gate-words', {
      worldId: String(worldId),
      rankId: String(rankId),
      gateId: String(gateId),
    });
  }
  cache.gateWords.set(key, words.slice());
  return words;
}

function deterministicPrivateMembershipId(wordKey) {
  return `published_${core().cleanId(wordKey, 'Word key')}`.slice(0, 500);
}

async function ensureQuizEvidenceSession(user, input, entries) {
  const sessionId = core().cleanId(input?.sessionId, 'Quiz session');
  const source = String(input?.source || 'personal');
  const privateWorldId = source.startsWith('custom:') ? source.slice(7) : '';
  const sourceType = privateWorldId ? 'private-world' : 'personal';
  const wordKeys = Array.from(new Set(entries.map((entry) =>
    window.LootLinguaWordLifecycle?.wordKeyOf?.(entry.word)
  ).filter(Boolean)));
  const correctWordKeys = Array.from(new Set(entries
    .filter((entry) => entry.result?.correct === true)
    .map((entry) => window.LootLinguaWordLifecycle?.wordKeyOf?.(entry.word))
    .filter(Boolean)));
  const targetRef = quizEvidenceSessionRef(user.uid, sessionId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(targetRef);
    if (snapshot.exists()) {
      const saved = snapshot.data() || {};
      if (
        saved.status !== 'completed' ||
        saved.sourceType !== sourceType ||
        String(saved.privateWorldId || '') !== privateWorldId
      ) {
        throw journeyCloudError('evidence/session-conflict', 'Evidence session identity changed.');
      }
      return;
    }
    transaction.set(targetRef, {
      sessionId,
      status: 'completed',
      mode: String(input?.mode || ''),
      sourceType,
      privateWorldId,
      wordKeys,
      correctWordKeys,
      totalCount: wordKeys.length,
      correctCount: correctWordKeys.length,
      evidenceVersion: evidenceCore().EVIDENCE_VERSION,
      completedAt: serverTimestamp(),
    });
  });
  return { sessionId, sourceType, privateWorldId, wordKeys, correctWordKeys };
}

async function recordQuizEvidenceBatch(input = {}) {
  const user = requireUser();
  const entries = Array.isArray(input.entries) ? input.entries : [];
  window.LootLinguaOperations?.diagnostic?.('recordQuizEvidenceBatch', {
    ownerId: user.uid,
    sessionId: String(input.sessionId || ''),
    entryCount: entries.length,
  });
  if (!entries.length || input.completed !== true) {
    return { recorded: 0, duplicate: 0, ineligible: entries.length };
  }
  const session = await ensureQuizEvidenceSession(user, input, entries);
  const correctEntries = entries.filter((entry) => entry.result?.correct === true);
  const results = await Promise.all(correctEntries.map(async (entry) => {
    const lifecycle = window.LootLinguaWordLifecycle;
    const wordKey = lifecycle?.wordKeyOf?.(entry.word);
    const eventId = evidenceCore().evidenceEventId(user.uid, session.sessionId, wordKey);
    if (!wordKey || !eventId) return 'ineligible';
    const canonicalRef = doc(db, 'users', user.uid, 'contentWords', wordKey);
    const eventRef = wordEvidenceEventRef(user.uid, wordKey, eventId);
    return runTransaction(db, async (transaction) => {
      const [canonicalSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(canonicalRef),
        transaction.get(eventRef),
      ]);
      if (eventSnapshot.exists()) return 'duplicate';
      if (!canonicalSnapshot.exists()) return 'ineligible';
      const canonical = canonicalSnapshot.data() || {};
      const legacyWordId = String(canonical.legacyWordId || '');
      const legacyRef = legacyWordId
        ? doc(db, 'users', user.uid, 'words', legacyWordId)
        : null;
      const membershipId = session.privateWorldId
        ? deterministicPrivateMembershipId(wordKey)
        : '';
      const membershipRef = session.privateWorldId
        ? doc(db, 'users', user.uid, 'customWorlds', session.privateWorldId, 'words', membershipId)
        : null;
      const [legacySnapshot, membershipSnapshot] = await Promise.all([
        legacyRef ? transaction.get(legacyRef) : Promise.resolve(null),
        membershipRef ? transaction.get(membershipRef) : Promise.resolve(null),
      ]);
      if (
        session.sourceType === 'personal' &&
        (!legacySnapshot?.exists() || lifecycle?.isEligibleForPersonalDictionaryQuiz(legacySnapshot.data()) === false)
      ) return 'ineligible';
      if (session.sourceType === 'private-world' && !membershipSnapshot?.exists()) return 'ineligible';
      const answeredAt = Math.max(0, Number(entry.result?.answeredAt) || Date.now());
      const timezoneOffsetMinutes = evidenceCore().normalizeTimezoneOffsetMinutes(
        canonical.evidenceTimezoneOffsetMinutes ??
        input.timezoneOffsetMinutes ??
        new Date(answeredAt).getTimezoneOffset()
      );
      const evidenceLocalDayKey = evidenceCore().localDayKey(
        answeredAt,
        timezoneOffsetMinutes
      );
      const eligible = evidenceCore().isEligibleRecall({
        uid: user.uid,
        word: canonical,
        wordKey,
        sessionId: session.sessionId,
        sourceType: session.sourceType,
        mode: input.mode,
        correct: true,
        completed: true,
        answeredAt,
        timezoneOffsetMinutes,
      });
      if (!eligible) return 'ineligible';
      const previousCount = Math.max(0, Number(canonical.eligibleEvidenceCount) || 0);
      const nextCount = previousCount + 1;
      transaction.set(eventRef, {
        eventId,
        sessionId: session.sessionId,
        wordKey,
        sourceType: session.sourceType,
        privateWorldId: session.privateWorldId,
        membershipWordId: membershipId,
        mode: String(input.mode || ''),
        correct: true,
        completed: true,
        sequence: nextCount,
        evidenceVersion: evidenceCore().EVIDENCE_VERSION,
        timezoneOffsetMinutes,
        localDayKey: evidenceLocalDayKey,
        occurredAt: serverTimestamp(),
      });
      transaction.update(canonicalRef, {
        eligibleEvidenceCount: nextCount,
        lastEligibleEvidenceAt: serverTimestamp(),
        lastEvidenceEventId: eventId,
        evidenceVersion: evidenceCore().EVIDENCE_VERSION,
        evidenceTimezoneOffsetMinutes: timezoneOffsetMinutes,
        lastEvidenceLocalDayKey: evidenceLocalDayKey,
        updatedAt: serverTimestamp(),
      });
      return 'recorded';
    });
  }));
  const summary = {
    recorded: results.filter((result) => result === 'recorded').length,
    duplicate: results.filter((result) => result === 'duplicate').length,
    ineligible: results.filter((result) => result === 'ineligible').length +
      Math.max(0, entries.length - correctEntries.length),
  };
  if (input.projectReadiness === false) return { ...summary, readinessError: null };
  return projectQuizEvidenceReadiness(summary);
}

async function projectQuizEvidenceReadiness(summary = {}) {
  let readinessError = null;
  if (Number(summary.recorded) > 0 || Number(summary.duplicate) > 0) {
    try {
      await evaluateActiveJourneyReadiness();
    } catch (error) {
      readinessError = journeyOperationError(error, 'project-quiz-evidence-readiness');
      console.warn('[Journey] Quiz evidence committed; readiness projection remains retryable.', {
        code: readinessError.code,
        operation: readinessError.operation,
        recordedCount: Number(summary.recorded) || 0,
      });
    }
  }
  return { ...summary, readinessError };
}

let journeyReadinessEvaluation = null;

async function evaluateActiveJourneyReadiness() {
  if (journeyReadinessEvaluation) return journeyReadinessEvaluation;
  const task = (async () => {
    const user = requireUser();
    const journey = await getActiveJourney();
    if (!journey?.activeRankId || !journey?.activeGateId) {
      return { ready: false, reason: 'no-active-gate' };
    }
    const worldId = String(journey.worldId);
    const rankId = String(journey.activeRankId);
    const gateId = String(journey.activeGateId);
    const key = gateCacheKey(worldId, rankId, gateId);
    const progress = await getGateProgress(worldId, rankId, gateId);
    if (!['learning', 'ready'].includes(progress?.status)) {
      return { ready: false, reason: 'gate-not-learning' };
    }
    const wordKeys = Array.from(new Set((progress.loadedWordKeys || []).map(String).filter(Boolean)));
    if (!wordKeys.length) return { ready: false, reason: 'gate-has-no-words' };
    const snapshots = await Promise.all(wordKeys.map((wordKey) =>
      getDoc(doc(db, 'users', user.uid, 'contentWords', wordKey))
    ));
    const words = snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => snapshot.data());
    if (words.length !== wordKeys.length) return { ready: false, reason: 'word-record-missing' };
    const timezoneOffsetMinutes = evidenceCore().normalizeTimezoneOffsetMinutes(
      words.find((word) => Number.isInteger(Number(word?.evidenceTimezoneOffsetMinutes)))
        ?.evidenceTimezoneOffsetMinutes ?? new Date().getTimezoneOffset()
    );
    const readiness = evidenceCore().computeGateReadiness(
      words,
      progress,
      undefined,
      Date.now(),
      timezoneOffsetMinutes
    );
    const unchanged = progress.status === readiness.status &&
      Number(progress.readyWordCount) === readiness.readyWordCount &&
      Number(progress.requiredWordCount) === readiness.requiredWordCount &&
      Number(progress.availableForReviewNowCount) === readiness.availableForReviewNow &&
      Number(progress.waitingLaterTodayCount) === readiness.waitingLaterToday &&
      Number(progress.waitingNextDayCount) === readiness.waitingNextDay;
    if (unchanged) return readiness;
    const targetRef = gateProgressRef(user.uid, worldId, rankId, gateId);
    const saved = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(targetRef);
      const current = snapshot.data() || {};
      if (!snapshot.exists() || !['learning', 'ready'].includes(current.status)) return null;
      transaction.update(targetRef, {
        status: readiness.status,
        readyEvidenceCount: readiness.readyWordCount,
        readyWordCount: readiness.readyWordCount,
        requiredWordCount: readiness.requiredWordCount,
        needsEvidenceWordCount: readiness.needsEvidenceWordCount,
        availableForReviewNowCount: readiness.availableForReviewNow,
        waitingLaterTodayCount: readiness.waitingLaterToday,
        waitingNextDayCount: readiness.waitingNextDay,
        readinessNextAt: readiness.nextAvailabilityAt
          ? new Date(readiness.nextAvailabilityAt)
          : null,
        readinessTimezoneOffsetMinutes: timezoneOffsetMinutes,
        readinessVersion: readiness.readinessVersion,
        readyAt: readiness.ready && !current.readyAt ? serverTimestamp() : (current.readyAt || null),
        lastActivityAt: serverTimestamp(),
      });
      return {
        ...current,
        ...readiness,
        gateId,
      };
    });
    if (!saved) return { ready: false, reason: 'state-changed' };
    cache.gateProgress.set(key, saved);
    cache.rankGateProgress.delete(rankCacheKey(worldId, rankId));
    window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
      detail: { worldId, rankId, gateId, type: readiness.ready ? 'gate-ready' : 'gate-readiness' },
    }));
    return readiness;
  })();
  journeyReadinessEvaluation = task;
  try {
    return await task;
  } finally {
    if (journeyReadinessEvaluation === task) journeyReadinessEvaluation = null;
  }
}

function createGateClearAttemptId(worldId, rankId, gateId) {
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `gate_clear_v1_${String(worldId)}_${String(rankId)}_${String(gateId)}_${suffix}`
    .replace(/\//g, '_')
    .slice(0, 500);
}

async function getGateClearAttempt(worldId, attemptId, options) {
  const user = requireUser();
  const key = `${String(worldId)}/${String(attemptId)}`;
  if (!options?.force && cache.gateClearAttempts.has(key)) {
    return cache.gateClearAttempts.get(key);
  }
  const snapshot = await getDoc(gateClearAttemptRef(user.uid, worldId, attemptId));
  const value = record(snapshot, 'attemptId');
  cache.gateClearAttempts.set(key, value);
  return value;
}

async function gateClearBundle(worldId, rankId, gateId, attempt) {
  const words = await listAllGateWords(worldId, rankId, gateId);
  return {
    attempt,
    words,
    question: gateClearCore().buildQuestion(attempt, words),
  };
}

async function startGateClearAttempt(worldId, rankId, gateId) {
  const user = requireUser();
  const [journey, progress, gate, words] = await Promise.all([
    getJourney(worldId),
    getGateProgress(worldId, rankId, gateId),
    contentApi().getPublishedGate(worldId, rankId, gateId),
    listAllGateWords(worldId, rankId, gateId),
  ]);
  if (!journey || String(journey.activeGateId || '') !== String(gateId)) {
    throw journeyCloudError('gate-clear/gate-mismatch', 'Only the active journey gate can be cleared.');
  }
  if (progress?.status !== 'ready') {
    throw journeyCloudError('gate-clear/not-ready', 'This gate is not ready for its clear attempt.');
  }
  if (progress.activeClearAttemptId) {
    const active = await getGateClearAttempt(worldId, progress.activeClearAttemptId, { force: true });
    if (active && ['active', 'submitting'].includes(active.status)) {
      return gateClearBundle(worldId, rankId, gateId, active);
    }
  }
  const attemptId = createGateClearAttemptId(worldId, rankId, gateId);
  const passRatio = gateClearCore().resolvePassThreshold(gate, schemaApi());
  const seed = gateClearCore().createSessionSeed({
    attemptId,
    worldId,
    rankId,
    gateId,
    words,
    passRatio,
  });
  const attemptRef = gateClearAttemptRef(user.uid, worldId, attemptId);
  const progressRef = gateProgressRef(user.uid, worldId, rankId, gateId);
  await runTransaction(db, async (transaction) => {
    const [progressSnapshot, attemptSnapshot] = await Promise.all([
      transaction.get(progressRef),
      transaction.get(attemptRef),
    ]);
    const current = progressSnapshot.data() || {};
    if (!progressSnapshot.exists() || current.status !== 'ready') {
      throw journeyCloudError('gate-clear/not-ready', 'Gate readiness changed before the attempt started.');
    }
    if (current.activeClearAttemptId) {
      throw journeyCloudError('gate-clear/session-active', 'Another Gate Clear attempt is already active.');
    }
    if (attemptSnapshot.exists()) {
      throw journeyCloudError('gate-clear/session-exists', 'Gate Clear attempt already exists.');
    }
    transaction.set(attemptRef, {
      ...seed,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.update(progressRef, {
      activeClearAttemptId: attemptId,
      clearAttempts: Math.max(0, Number(current.clearAttempts) || 0) + 1,
      lastActivityAt: serverTimestamp(),
    });
  });
  const attempt = { ...seed, attemptId };
  cache.gateClearAttempts.set(`${String(worldId)}/${attemptId}`, attempt);
  cache.gateProgress.delete(gateCacheKey(worldId, rankId, gateId));
  cache.rankGateProgress.delete(rankCacheKey(worldId, rankId));
  return gateClearBundle(worldId, rankId, gateId, attempt);
}

async function resumeGateClearAttempt(worldId, rankId, gateId) {
  const progress = await getGateProgress(worldId, rankId, gateId, { force: true });
  const attemptId = String(progress?.activeClearAttemptId || '');
  if (!attemptId) return null;
  const attempt = await getGateClearAttempt(worldId, attemptId, { force: true });
  if (!attempt || !['active', 'submitting'].includes(attempt.status)) return null;
  return gateClearBundle(worldId, rankId, gateId, attempt);
}

async function finalizeGateClearAttempt(worldId, rankId, gateId, attemptId) {
  const user = requireUser();
  const [nextTarget, currentRank, publishedRanks] = await Promise.all([
    resolveNextContentTarget(worldId, rankId, gateId),
    contentApi().getPublishedRank(worldId, rankId),
    contentApi().listPublishedRanks(worldId),
  ]);
  const attemptRef = gateClearAttemptRef(user.uid, worldId, attemptId);
  const progressRef = gateProgressRef(user.uid, worldId, rankId, gateId);
  const targetJourneyRef = journeyRef(user.uid, worldId);
  const pointerRef = activeJourneyRef(user.uid);
  const nextProgressRef = nextTarget
    ? gateProgressRef(user.uid, worldId, nextTarget.rank.rankId, nextTarget.gate.gateId)
    : null;
  let committed = null;
  await runTransaction(db, async (transaction) => {
    const reads = [
      transaction.get(attemptRef),
      transaction.get(progressRef),
      transaction.get(targetJourneyRef),
      transaction.get(pointerRef),
    ];
    if (nextProgressRef) reads.push(transaction.get(nextProgressRef));
    const snapshots = await Promise.all(reads);
    const attempt = snapshots[0].data() || {};
    const progress = snapshots[1].data() || {};
    const journey = snapshots[2].data() || {};
    const pointer = snapshots[3].data() || {};
    const nextProgressSnapshot = nextProgressRef ? snapshots[4] : null;
    if (
      !snapshots[0].exists() ||
      attempt.status !== 'submitting' ||
      attempt.currentQuestionIndex !== attempt.totalCount ||
      attempt.answers?.length !== attempt.totalCount
    ) {
      throw journeyCloudError('gate-clear/not-submitting', 'Gate Clear answers are incomplete.');
    }
    if (
      !snapshots[1].exists() ||
      progress.status !== 'ready' ||
      String(progress.activeClearAttemptId || '') !== String(attemptId)
    ) {
      throw journeyCloudError('gate-clear/progress-changed', 'Gate progress changed before submission.');
    }
    if (
      !snapshots[2].exists() ||
      journey.status !== 'active' ||
      String(journey.activeGateId || '') !== String(gateId) ||
      String(pointer.worldId || '') !== String(worldId)
    ) {
      throw journeyCloudError('gate-clear/journey-changed', 'The active journey changed.');
    }
    const result = gateClearCore().resultFor(attempt);
    transaction.update(attemptRef, {
      status: result.result,
      result: result.result,
      score: result.score,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (!result.passed) {
      transaction.update(progressRef, {
        activeClearAttemptId: '',
        lastClearAttemptId: attemptId,
        lastClearResult: 'failed',
        lastActivityAt: serverTimestamp(),
      });
      committed = { result, journey, nextTarget: null };
      return;
    }
    const completesRank = !nextTarget ||
      String(nextTarget.rank?.rankId || '') !== String(rankId);
    const wasRankCompleted = (journey.completedRankIds || [])
      .map(String)
      .includes(String(rankId));
    const completedRankIds = completesRank && !wasRankCompleted
      ? Array.from(new Set([...(journey.completedRankIds || []), String(rankId)]))
      : (journey.completedRankIds || []);
    const rankCompletionVersions = completesRank && !wasRankCompleted
      ? {
        ...(journey.rankCompletionVersions || {}),
        [String(rankId)]: Math.max(1, Number(currentRank?.version) || 1),
      }
      : (journey.rankCompletionVersions || {});
    const worldCompletionRecorded = Boolean(!nextTarget && !journey.worldCompletion);
    const worldCompletion = worldCompletionRecorded
      ? core().createWorldCompletionAchievement({
        worldId,
        ranks: publishedRanks,
        completedBy: 'gate-clear',
        completedAt: serverTimestamp(),
      })
      : journey.worldCompletion;
    transaction.update(progressRef, {
      status: 'cleared',
      activeClearAttemptId: '',
      lastClearAttemptId: attemptId,
      lastClearResult: 'passed',
      clearScore: result.score,
      clearCorrect: Number(attempt.correctCount),
      clearTotal: Number(attempt.totalCount),
      clearedBy: 'gate-clear',
      clearedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
    });
    let nextJourney = journey;
    if (nextTarget) {
      const nextRankId = String(nextTarget.rank.rankId);
      const nextGateId = String(nextTarget.gate.gateId);
      const unlockedRankIds = Array.from(new Set([...(journey.unlockedRankIds || []), nextRankId]));
      const unlockedGateIds = Array.from(new Set([...(journey.unlockedGateIds || []), nextGateId]));
      nextJourney = {
        ...journey,
        activeRankId: nextRankId,
        activeGateId: nextGateId,
        unlockedRankIds,
        unlockedGateIds,
        ...(completesRank ? { completedRankIds, rankCompletionVersions } : {}),
      };
      transaction.update(targetJourneyRef, {
        activeRankId: nextRankId,
        activeGateId: nextGateId,
        unlockedRankIds,
        unlockedGateIds,
        ...(completesRank ? { completedRankIds, rankCompletionVersions } : {}),
        updatedAt: serverTimestamp(),
      });
      if (!nextProgressSnapshot?.exists()) {
        transaction.set(nextProgressRef, {
          worldId: String(worldId),
          rankId: nextRankId,
          gateId: nextGateId,
          status: 'available',
          journeyVersion: core().JOURNEY_VERSION,
          unlockedByGateId: String(gateId),
          unlockedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          readyEvidenceCount: 0,
          clearAttempts: 0,
        });
      }
      transaction.update(pointerRef, { updatedAt: serverTimestamp() });
    } else {
      nextJourney = {
        ...journey,
        completedRankIds,
        rankCompletionVersions,
        contentJourneyStatus: 'completed-current-content',
        ...(worldCompletion ? { worldCompletion } : {}),
      };
      transaction.update(targetJourneyRef, {
        completedRankIds,
        rankCompletionVersions,
        contentJourneyStatus: 'completed-current-content',
        ...(worldCompletionRecorded ? { worldCompletion } : {}),
        updatedAt: serverTimestamp(),
      });
      transaction.update(pointerRef, { updatedAt: serverTimestamp() });
    }
    committed = {
      result,
      journey: nextJourney,
      nextTarget,
      rankCompleted: completesRank,
      rankCompletionRecorded: completesRank && !wasRankCompleted,
      completedCurrentContent: !nextTarget,
      worldCompleted: !nextTarget,
      worldCompletionRecorded,
      worldCompletionId: String(worldCompletion?.completionId || ''),
      rankCompletionVersion: completesRank
        ? Math.max(1, Number(rankCompletionVersions[String(rankId)]) || 1)
        : 0,
    };
  });
  cache.gateClearAttempts.delete(`${String(worldId)}/${String(attemptId)}`);
  cache.gateProgress.delete(gateCacheKey(worldId, rankId, gateId));
  cache.rankGateProgress.delete(rankCacheKey(worldId, rankId));
  cache.journeys.delete(String(worldId));
  cache.active = undefined;
  if (committed?.nextTarget) {
    cache.gateProgress.delete(gateCacheKey(
      worldId,
      committed.nextTarget.rank.rankId,
      committed.nextTarget.gate.gateId
    ));
  }
  window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
    detail: {
      worldId: String(worldId),
      rankId: String(rankId),
      gateId: String(gateId),
      nextRankId: String(committed?.nextTarget?.rank?.rankId || ''),
      nextGateId: String(committed?.nextTarget?.gate?.gateId || ''),
      type: committed?.completedCurrentContent ? 'world-completed' : 'gate-clear',
    },
  }));
  return committed;
}

async function answerGateClearQuestion(worldId, rankId, gateId, attemptId, selectedContentWordId) {
  const user = requireUser();
  const attemptRef = gateClearAttemptRef(user.uid, worldId, attemptId);
  let nextSession = null;
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(attemptRef);
    if (!snapshot.exists()) throw journeyCloudError('gate-clear/not-found', 'Gate Clear attempt was not found.');
    const current = { ...(snapshot.data() || {}), attemptId: snapshot.id };
    nextSession = gateClearCore().answerSession(current, selectedContentWordId);
    transaction.update(attemptRef, {
      answers: nextSession.answers,
      currentQuestionIndex: nextSession.currentQuestionIndex,
      correctCount: nextSession.correctCount,
      status: nextSession.status,
      updatedAt: serverTimestamp(),
    });
  });
  cache.gateClearAttempts.set(`${String(worldId)}/${String(attemptId)}`, nextSession);
  if (nextSession.status === 'submitting') {
    const result = await finalizeGateClearAttempt(worldId, rankId, gateId, attemptId);
    try {
      return { ...await gateClearBundle(worldId, rankId, gateId, nextSession), result };
    } catch (error) {
      console.warn('[Journey] Gate Clear committed; result decoration failed.', {
        code: error?.code || error?.message || 'unavailable',
        worldId: String(worldId),
        rankId: String(rankId),
        gateId: String(gateId),
        attemptId: String(attemptId),
      });
      return { attempt: nextSession, words: [], question: null, result };
    }
  }
  return gateClearBundle(worldId, rankId, gateId, nextSession);
}

async function abandonGateClearAttempt(worldId, rankId, gateId, attemptId) {
  const user = requireUser();
  const attemptRef = gateClearAttemptRef(user.uid, worldId, attemptId);
  const progressRef = gateProgressRef(user.uid, worldId, rankId, gateId);
  await runTransaction(db, async (transaction) => {
    const [attemptSnapshot, progressSnapshot] = await Promise.all([
      transaction.get(attemptRef),
      transaction.get(progressRef),
    ]);
    const attempt = attemptSnapshot.data() || {};
    const progress = progressSnapshot.data() || {};
    if (!attemptSnapshot.exists() || attempt.status !== 'active') return;
    if (String(progress.activeClearAttemptId || '') !== String(attemptId)) return;
    transaction.update(attemptRef, {
      status: 'abandoned',
      abandonedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.update(progressRef, {
      activeClearAttemptId: '',
      lastActivityAt: serverTimestamp(),
    });
  });
  cache.gateClearAttempts.delete(`${String(worldId)}/${String(attemptId)}`);
  cache.gateProgress.delete(gateCacheKey(worldId, rankId, gateId));
  cache.rankGateProgress.delete(rankCacheKey(worldId, rankId));
  return true;
}

async function validateGateOperation(worldId, rankId, gateId, options) {
  const [activeJourney, journey, rank, gate, progress] = await Promise.all([
    getActiveJourney({ force: true }),
    getJourney(worldId, { force: true }),
    contentApi().getPublishedRank(worldId, rankId),
    contentApi().getPublishedGate(worldId, rankId, gateId),
    getGateProgress(worldId, rankId, gateId, { force: true }),
  ]);
  if (!activeJourney || activeJourney.worldId !== String(worldId) || activeJourney.status !== 'active') {
    throw journeyCloudError('journey/not-active', 'This world is not the active journey.');
  }
  if (!journey || !core().canAccessRank(rank, journey)) {
    throw journeyCloudError('journey/rank-locked', 'This rank is locked.');
  }
  if (!core().canAccessGate(gate, journey, { rank })) {
    throw journeyCloudError('journey/gate-locked', 'This gate is locked.');
  }
  const isPlacement = options?.source === PLACEMENT_SOURCE.source &&
    options?.suppressRewards === true;
  if (isPlacement) {
    if (
      journey.placementStatus !== 'active' ||
      String(journey.activeRankId || '') !== String(rankId) ||
      String(journey.activeGateId || '') !== String(gateId)
    ) {
      throw journeyCloudError(
        'placement/gate-mismatch',
        'Only the current Placement gate can be loaded.'
      );
    }
  } else if (
    journey.placementStatus === 'not-started' ||
    journey.placementStatus === 'active'
  ) {
    throw journeyCloudError(
      'placement/choice-required',
      'Choose Placement or start from the beginning first.'
    );
  }
  const optionalPlacementLoad = progress?.status === 'cleared' &&
    progress?.clearedBy === 'level-placement' &&
    !progress?.loadedAt;
  if (progress && !['available', 'learning'].includes(progress.status) && !optionalPlacementLoad) {
    throw journeyCloudError('journey/gate-locked', 'This gate cannot be loaded.');
  }
  return { journey, rank, gate, progress, optionalPlacementLoad };
}

function createOperationId(gateId) {
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `gate_${String(gateId)}_${suffix}`.slice(0, 180);
}

async function updateGateProgress(worldId, rankId, gateId, values, options) {
  const user = requireUser();
  const current = await getGateProgress(worldId, rankId, gateId, { force: true });
  const status = String(values?.status || current?.status || 'available');
  if (!core().canTransitionGateProgress(current?.status, status, options)) {
    throw journeyCloudError('journey/invalid-transition', 'Gate progress transition is invalid.');
  }
  const payload = {
    worldId: core().cleanId(worldId, 'World'),
    rankId: core().cleanId(rankId, 'Rank'),
    gateId: core().cleanId(gateId, 'Gate'),
    status,
    journeyVersion: core().JOURNEY_VERSION,
    lastActivityAt: serverTimestamp(),
    readyEvidenceCount: Math.max(0, Number(values?.readyEvidenceCount ?? current?.readyEvidenceCount) || 0),
    clearAttempts: Math.max(0, Number(values?.clearAttempts ?? current?.clearAttempts) || 0),
  };
  if (
    current?.masteryComplete === true &&
    current?.placementClearedWithoutLoad !== true
  ) payload.masteryComplete = true;
  if (current?.placementAssessmentId) {
    Object.assign(payload, {
      placementAssessmentId: String(current.placementAssessmentId),
      placementScore: Number(current.placementScore) || 0,
      placementCorrect: Math.max(0, Number(current.placementCorrect) || 0),
      placementTotal: Math.max(1, Number(current.placementTotal) || 1),
    });
  }
  if (current?.levelPlacementAssessmentId) {
    Object.assign(payload, {
      clearedAt: current.clearedAt,
      clearedBy: 'level-placement',
      levelPlacementAssessmentId: String(current.levelPlacementAssessmentId),
      levelPlacementScore: Math.max(0, Math.min(1, Number(current.levelPlacementScore) || 0)),
      placementClearedWithoutLoad: Boolean(
        values?.placementClearedWithoutLoad ?? current.placementClearedWithoutLoad
      ),
    });
  }
  if (status === 'learning' || status === 'ready' || status === 'cleared') {
    const ids = Array.from(new Set(
      (values?.loadedContentWordIds || current?.loadedContentWordIds || []).map(String)
    ));
    const wordKeys = Array.from(new Set(
      (values?.loadedWordKeys || current?.loadedWordKeys || []).map(String)
    )).filter(Boolean);
    if (ids.length > MAX_LOADED_WORD_IDS || wordKeys.length > MAX_LOADED_WORD_IDS) {
      throw journeyCloudError('journey/gate-too-large', 'Gate progress exceeds its safe word limit.');
    }
    Object.assign(payload, {
      loadedAt: current?.loadedAt || serverTimestamp(),
      wordCountAtLoad: Math.max(0, Number(values?.wordCountAtLoad) || 0),
      contentVersion: Math.max(1, Number(values?.contentVersion) || 1),
      snapshotVersion: Math.max(1, Number(values?.snapshotVersion) || 1),
      loadedContentWordIds: ids,
      loadedWordKeys: wordKeys,
      nextRankId: String(values?.nextRankId ?? current?.nextRankId ?? '').slice(0, 128),
      nextGateId: String(values?.nextGateId ?? current?.nextGateId ?? '').slice(0, 128),
      loadStrategy: 'deterministic-source-docs-v1',
      operationId: String(values?.operationId || current?.operationId || '').slice(0, 180),
      readyWordCount: Math.max(0, Number(values?.readyWordCount ?? current?.readyWordCount) || 0),
      requiredWordCount: Math.max(0, Number(values?.requiredWordCount ?? current?.requiredWordCount ?? ids.length) || 0),
      needsEvidenceWordCount: Math.max(0, Number(values?.needsEvidenceWordCount ?? current?.needsEvidenceWordCount ?? ids.length) || 0),
      availableForReviewNowCount: Math.max(0, Number(
        values?.availableForReviewNowCount ?? current?.availableForReviewNowCount ?? ids.length
      ) || 0),
      waitingLaterTodayCount: Math.max(0, Number(
        values?.waitingLaterTodayCount ?? current?.waitingLaterTodayCount
      ) || 0),
      waitingNextDayCount: Math.max(0, Number(
        values?.waitingNextDayCount ?? current?.waitingNextDayCount
      ) || 0),
      readinessNextAt: values?.readinessNextAt ?? current?.readinessNextAt ?? null,
      readinessTimezoneOffsetMinutes: evidenceCore().normalizeTimezoneOffsetMinutes(
        values?.readinessTimezoneOffsetMinutes ??
        current?.readinessTimezoneOffsetMinutes ??
        new Date().getTimezoneOffset()
      ),
      readinessVersion: Math.max(1, Number(values?.readinessVersion ?? current?.readinessVersion) || evidenceCore().EVIDENCE_VERSION),
    });
    if (current?.readyAt) payload.readyAt = current.readyAt;
  }
  try {
    await setDoc(gateProgressRef(user.uid, worldId, rankId, gateId), payload);
  } catch (error) {
    throw journeyOperationError(error, 'update-gate-progress', {
      uid: user.uid,
      worldId: String(worldId),
      rankId: String(rankId),
      gateId: String(gateId),
    });
  }
  cache.gateProgress.delete(gateCacheKey(worldId, rankId, gateId));
  cache.rankGateProgress.delete(rankCacheKey(worldId, rankId));
  const fresh = await getGateProgress(worldId, rankId, gateId, { force: true });
  window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
    detail: { worldId: String(worldId), rankId: String(rankId), gateId: String(gateId), type: 'gate-progress' },
  }));
  return fresh;
}

async function runGateWordOperation(worldId, rankId, gateId, options) {
  const user = requireUser();
  const context = await validateGateOperation(worldId, rankId, gateId, options);
  const allWords = await listAllGateWords(worldId, rankId, gateId, {
    force: Boolean(options?.force),
  });
  if (!allWords.length) {
    throw journeyOperationError(
      journeyCloudError(
        'journey/no-published-words',
        'This gate has no published words to load.'
      ),
      'read-all-published-gate-words',
      {
        worldId: String(worldId),
        rankId: String(rankId),
        gateId: String(gateId),
      }
    );
  }
  if (allWords.length > MAX_LOADED_WORD_IDS) {
    throw journeyCloudError(
      'journey/gate-too-large',
      'This gate exceeds the current Journey progress limit.'
    );
  }
  const wantedIds = options?.onlyNew
    ? new Set(core().detectNewContentWordIds(allWords, context.progress))
    : null;
  const targetWords = wantedIds
    ? allWords.filter((word) => wantedIds.has(String(word.contentWordId || '')))
    : allWords;
  const operationId = createOperationId(gateId);
  const personalIndex = await readPersonalWordIndex(user.uid);
  const failures = [];
  let firstFailure = null;
  let completed = 0;
  let linkedSources = 0;
  let existingWords = 0;
  const lifecycleSummary = window.LootLinguaWordLifecycle?.emptySummary?.() || {
    created: 0,
    restored: 0,
    sourceLinked: 0,
    alreadyLinked: 0,
    updatedMissingFields: 0,
    failed: 0,
    hiddenPreserved: 0,
  };

  for (const word of targetWords) {
    try {
      const result = await linkPublishedWord(
        user.uid,
        word,
        personalIndex,
        operationId,
        options
      );
      completed += 1;
      if (result.linked) linkedSources += 1;
      if (result.existingWord) existingWords += 1;
      window.LootLinguaWordLifecycle?.addResultToSummary?.(lifecycleSummary, result);
    } catch (error) {
      const failure = journeyOperationError(
        error,
        'link-published-word-source-transaction',
        {
          contentWordId: String(word?.contentWordId || ''),
          wordKey: String(word?.wordKey || ''),
        }
      );
      if (!firstFailure) firstFailure = failure;
      failures.push({
        contentWordId: failure.contentWordId,
        wordKey: failure.wordKey,
        code: failure.code,
        message: failure.message,
        operation: failure.operation,
      });
      lifecycleSummary.failed += 1;
    }
    options?.onProgress?.({
      completed,
      failed: failures.length,
      total: targetWords.length,
    });
  }

  if (failures.length && completed === 0) throw firstFailure;

  if (!failures.length) {
    const nextTarget = await resolveNextContentTarget(worldId, rankId, gateId);
    const loadedIds = Array.from(new Set([
      ...(context.progress?.loadedContentWordIds || []),
      ...allWords.map((word) => String(word.contentWordId || '')).filter(Boolean),
    ]));
    const loadedWordKeys = Array.from(new Set([
      ...(context.progress?.loadedWordKeys || []),
      ...allWords.map((word) => String(word.wordKey || '')).filter(Boolean),
    ]));
    const nextStatus = context.optionalPlacementLoad ? 'cleared' : 'learning';
    await updateGateProgress(worldId, rankId, gateId, {
      status: nextStatus,
      wordCountAtLoad: allWords.length,
      contentVersion: context.gate.version,
      snapshotVersion: context.gate.version,
      loadedContentWordIds: loadedIds,
      loadedWordKeys,
      nextRankId: nextTarget?.rank?.rankId || '',
      nextGateId: nextTarget?.gate?.gateId || '',
      operationId,
      readyEvidenceCount: 0,
      readyWordCount: 0,
      requiredWordCount: allWords.length,
      needsEvidenceWordCount: allWords.length,
      availableForReviewNowCount: allWords.length,
      waitingLaterTodayCount: 0,
      waitingNextDayCount: 0,
      readinessNextAt: null,
      readinessTimezoneOffsetMinutes: new Date().getTimezoneOffset(),
      readinessVersion: evidenceCore().EVIDENCE_VERSION,
      placementClearedWithoutLoad: false,
    }, options);
  }

  return {
    operationId,
    completed,
    total: targetWords.length,
    linkedSources,
    existingWords,
    summary: lifecycleSummary,
    failures,
    errorCode: firstFailure?.code || '',
    errorMessage: firstFailure?.message || '',
    errorOperation: firstFailure?.operation || '',
    partial: failures.length > 0,
    status: failures.length
      ? (context.progress?.status || 'available')
      : (context.optionalPlacementLoad ? 'cleared' : 'learning'),
    advancement: null,
    executionContext: {
      source: options?.source || 'journey',
      suppressRewards: Boolean(options?.suppressRewards),
    },
  };
}

let journeyProgressEvaluation = null;

function currentPersonalMasteryIndex(uid) {
  const words = typeof window.readWordsFromStorage === 'function'
    ? window.readWordsFromStorage('normal', uid)
    : [];
  const schema = schemaApi();
  const index = new Map();
  (Array.isArray(words) ? words : []).forEach((word) => {
    const identity = schema.normalizeWordIdentity(word?.word || word?.text || '');
    if (identity.wordKey) index.set(identity.wordKey, word || {});
  });
  return index;
}

function currentMasteryIndexForGateWords(words, loadedWordKeys) {
  const index = new Map();
  const wordsByKey = new Map();
  (Array.isArray(words) ? words : []).forEach((word) => {
    const wordKey = String(word?.wordKey || '');
    if (!wordKey) return;
    wordsByKey.set(wordKey, word);
  });
  const keys = new Set([
    ...(Array.isArray(loadedWordKeys) ? loadedWordKeys : []).map(String),
    ...wordsByKey.keys(),
  ]);
  let personalFallback = null;
  keys.forEach((wordKey) => {
    if (!wordKey) return;
    const word = wordsByKey.get(wordKey);
    let mastery = window.getSharedWordMasteryByKey?.(wordKey) ||
      (word && window.getWordMasteryState?.(word));
    if (!mastery) {
      personalFallback ||= currentPersonalMasteryIndex(auth?.currentUser?.uid);
      mastery = personalFallback.get(wordKey);
    }
    index.set(wordKey, mastery || {});
  });
  return index;
}

async function getGateMasteryView(worldId, rankId, gateId, options) {
  requireUser();
  const [progress, words] = await Promise.all([
    options?.progress
      ? Promise.resolve(options.progress)
      : getGateProgress(worldId, rankId, gateId, options),
    listAllGateWords(worldId, rankId, gateId, options),
  ]);
  const view = core().deriveGateMasteryView(
    progress,
    words,
    currentMasteryIndexForGateWords(words, progress?.loadedWordKeys)
  );
  const newContentWordIds = new Set(core().detectNewContentWordIds(words, progress));
  return {
    ...view,
    newContentWords: words.filter((word) =>
      newContentWordIds.has(String(word?.contentWordId || ''))
    ),
  };
}

// Read-only notification projection. Practice is derived from the canonical
// trusted-evidence counter and the exact published source link.
async function getGateNotificationFacts(worldId, rankId, gateId, options) {
  const user = requireUser();
  const progress = options?.progress || await getGateProgress(worldId, rankId, gateId, options);
  if (!progress?.loadedAt || !['learning', 'ready', 'cleared'].includes(String(progress.status || ''))) {
    return { unpracticedCount: 0, unpracticedWordKeys: [], newestLinkedAt: 0 };
  }
  const words = await listAllGateWords(worldId, rankId, gateId, options);
  const loadedKeys = new Set((progress.loadedWordKeys || []).map(String));
  const loadedIds = new Set((progress.loadedContentWordIds || []).map(String));
  const effective = words.filter((word) => (
    loadedKeys.has(String(word?.wordKey || '')) || loadedIds.has(String(word?.contentWordId || ''))
  ));
  const evidence = await Promise.all(effective.map(async (word) => {
    const wordKey = String(word?.wordKey || '');
    const source = {
      worldId: core().cleanId(worldId, 'World'),
      rankId: core().cleanId(rankId, 'Rank'),
      gateId: core().cleanId(gateId, 'Gate'),
      contentWordId: core().cleanId(word?.contentWordId, 'Word'),
    };
    const sourceId = core().contentSourceId(source);
    const [canonical, link] = await Promise.all([
      getDoc(doc(db, 'users', user.uid, 'contentWords', core().cleanId(wordKey, 'Word key'))),
      getDoc(doc(db, 'users', user.uid, 'contentWords', core().cleanId(wordKey, 'Word key'), 'sources', sourceId)),
    ]);
    if (!canonical.exists() || !link.exists()) return null;
    return {
      wordKey,
      eligibleEvidenceCount: Math.max(0, Number(canonical.data()?.eligibleEvidenceCount) || 0),
      linkedAt: timestampMillis(link.data()?.linkedAt),
    };
  }));
  const trustedLinks = evidence.filter(Boolean);
  const unpracticed = trustedLinks.filter((item) => item.eligibleEvidenceCount < 1);
  return {
    unpracticedCount: unpracticed.length,
    unpracticedWordKeys: unpracticed.map((item) => item.wordKey),
    newestLinkedAt: trustedLinks.reduce(
      (latest, item) => Math.max(latest, item.linkedAt),
      timestampMillis(progress.loadedAt)
    ),
  };
}

function subscribeGateProgress(worldId, rankId, gateId, listener, onError) {
  const user = requireUser();
  const key = gateCacheKey(worldId, rankId, gateId);
  return onSnapshot(
    gateProgressRef(user.uid, worldId, rankId, gateId),
    (snapshot) => {
      const progress = record(snapshot, 'gateId');
      if (progress) cache.gateProgress.set(key, progress);
      else cache.gateProgress.delete(key);
      cache.rankGateProgress.delete(rankCacheKey(worldId, rankId));
      if (typeof listener === 'function') listener(progress);
    },
    (error) => {
      if (typeof onError === 'function') onError(error);
    }
  );
}

async function evaluateActiveJourneyMastery() {
  if (journeyProgressEvaluation) return journeyProgressEvaluation;
  const task = (async () => {
    requireUser();
    const journey = await getActiveJourney({ force: true });
    if (!journey?.activeRankId || !journey?.activeGateId) {
      return { masteryAchieved: false, crownEarned: false, reason: 'no-active-gate' };
    }

    const worldId = String(journey.worldId);
    const rankId = String(journey.activeRankId);
    const gateId = String(journey.activeGateId);
    const progress = await getGateProgress(worldId, rankId, gateId, { force: true });
    if (!['learning', 'ready', 'cleared'].includes(progress?.status)) {
      return { masteryAchieved: false, crownEarned: false, reason: 'gate-not-loaded' };
    }
    const view = await getGateMasteryView(worldId, rankId, gateId, {
      progress,
      force: true,
    });
    return {
      masteryAchieved: view.masteryAchieved,
      crownEarned: view.crownEarned,
      changed: false,
      reason: view.masteryAchieved ? 'derived-from-srs-history' : 'words-not-mastered-once',
      worldId,
      rankId,
      gateId,
      gapCount: view.gapCount,
    };
  })();
  journeyProgressEvaluation = task;
  try {
    return await task;
  } finally {
    if (journeyProgressEvaluation === task) journeyProgressEvaluation = null;
  }
}

const evaluateActiveJourneyProgress = evaluateActiveJourneyMastery;

async function loadGateWords(worldId, rankId, gateId, options) {
  return runGateWordOperation(worldId, rankId, gateId, {
    ...(options || {}),
    onlyNew: false,
  });
}

async function syncNewGateWords(worldId, rankId, gateId, options) {
  return runGateWordOperation(worldId, rankId, gateId, {
    ...(options || {}),
    onlyNew: true,
    force: true,
  });
}

async function findNewGateWords(worldId, rankId, gateId) {
  const progress = await getGateProgress(worldId, rankId, gateId);
  if (!['learning', 'ready', 'cleared'].includes(progress?.status) || !progress.loadedAt) return [];
  const words = await listAllGateWords(worldId, rankId, gateId, { force: true });
  const newIds = new Set(core().detectNewContentWordIds(words, progress));
  return words.filter((word) => newIds.has(String(word.contentWordId || '')));
}

async function getPlacementSession(worldId, assessmentId, options) {
  const user = requireUser();
  const id = placementCore().cleanId(assessmentId, 'Assessment');
  const key = `${core().cleanId(worldId, 'World')}/${id}`;
  if (!options?.force && cache.placementSessions.has(key)) {
    return cache.placementSessions.get(key);
  }
  const snapshot = await getDoc(placementSessionRef(user.uid, worldId, id));
  const session = record(snapshot, 'assessmentId');
  cache.placementSessions.set(key, session);
  return session;
}

async function makePlacementBundle(journey, session) {
  if (
    !journey ||
    journey.placementStatus !== 'active' ||
    !session ||
    !['active', 'submitting', 'completed'].includes(session.status) ||
    String(journey.activePlacementAssessmentId || '') !== String(session.assessmentId || '') ||
    String(journey.activeRankId || '') !== String(session.rankId || '') ||
    String(journey.activeGateId || '') !== String(session.currentGateId || '')
  ) {
    throw journeyCloudError(
      'placement/session-mismatch',
      'Placement session does not match the active journey gate.'
    );
  }
  const [world, rank, gate, words] = await Promise.all([
    contentApi().getPublishedWorld(journey.worldId),
    contentApi().getPublishedRank(journey.worldId, session.rankId),
    contentApi().getPublishedGate(journey.worldId, session.rankId, session.currentGateId),
    listAllGateWords(journey.worldId, session.rankId, session.currentGateId, { force: true }),
  ]);
  const publishedIds = new Set(words.map((word) => String(word.contentWordId || '')));
  if (
    session.orderedContentWordIds.length !== words.length ||
    session.orderedContentWordIds.some((id) => !publishedIds.has(String(id)))
  ) {
    throw journeyCloudError(
      'placement/content-changed',
      'Placement content changed after the session started.'
    );
  }
  return {
    journey,
    session,
    world,
    rank,
    gate,
    words,
    executionContext: { ...PLACEMENT_SOURCE },
  };
}

async function preparePlacementGate(worldId, rankId, gateId) {
  const user = requireUser();
  const id = placementCore().assessmentId(rankId, gateId);
  const loadResult = await runGateWordOperation(worldId, rankId, gateId, {
    ...PLACEMENT_SOURCE,
    placementAssessmentId: id,
    onlyNew: false,
    force: true,
  });
  if (loadResult.partial) {
    throw journeyOperationError(
      journeyCloudError(
        loadResult.errorCode || 'placement/gate-load-incomplete',
        loadResult.errorMessage ||
          `Placement loaded ${loadResult.completed} of ${loadResult.total} words.`
      ),
      loadResult.errorOperation || 'link-published-word-source-transaction',
      { failures: loadResult.failures }
    );
  }

  const [gate, words] = await Promise.all([
    contentApi().getPublishedGate(worldId, rankId, gateId),
    listAllGateWords(worldId, rankId, gateId, { force: true }),
  ]);
  const seed = placementCore().createSessionSeed({
    assessmentId: id,
    worldId,
    rankId,
    gateId,
    words,
    passThreshold: placementCore().resolvePassThreshold(gate, schemaApi()),
  });
  const targetJourneyRef = journeyRef(user.uid, worldId);
  const sessionRef = placementSessionRef(user.uid, worldId, id);

  await runTransaction(db, async (transaction) => {
    const [journeySnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(targetJourneyRef),
      transaction.get(sessionRef),
    ]);
    const journey = journeySnapshot.data() || {};
    if (
      !journeySnapshot.exists() ||
      journey.status !== 'active' ||
      journey.placementStatus !== 'active' ||
      String(journey.activeRankId || '') !== String(rankId) ||
      String(journey.activeGateId || '') !== String(gateId)
    ) {
      throw journeyCloudError(
        'placement/gate-mismatch',
        'Placement can only prepare the active gate.'
      );
    }
    const activeId = String(journey.activePlacementAssessmentId || '');
    if (activeId && activeId !== id) {
      throw journeyCloudError(
        'placement/session-active',
        'Another Placement session is already active.'
      );
    }
    if (sessionSnapshot.exists()) {
      if (!['active', 'submitting'].includes(sessionSnapshot.data()?.status)) {
        throw journeyCloudError(
          'placement/session-complete',
          'This Placement gate has already been completed.'
        );
      }
    } else {
      transaction.set(sessionRef, {
        ...seed,
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    if (activeId !== id) {
      transaction.update(targetJourneyRef, {
        activePlacementAssessmentId: id,
        updatedAt: serverTimestamp(),
      });
    }
  });

  resetCache(user.uid);
  const journey = await getJourney(worldId, { force: true });
  cache.active = journey;
  const session = await getPlacementSession(worldId, id, { force: true });
  return makePlacementBundle(journey, session);
}

async function setPlacementChoice(worldId, choice) {
  const user = requireUser();
  const id = core().cleanId(worldId, 'World');
  const journey = await startJourney(id);
  const nextStatus = choice === 'placement' ? 'active' : 'declined';
  if (journey.placementStatus === nextStatus) return journey;
  if (journey.placementStatus !== 'not-started') {
    throw journeyCloudError(
      'placement/already-decided',
      'Placement has already been started or completed for this journey.'
    );
  }
  await runTransaction(db, async (transaction) => {
    const targetRef = journeyRef(user.uid, id);
    const snapshot = await transaction.get(targetRef);
    const current = snapshot.data() || {};
    if (!snapshot.exists() || current.placementStatus !== 'not-started') {
      throw journeyCloudError('placement/already-decided', 'Placement choice has changed.');
    }
    transaction.update(targetRef, {
      placementStatus: nextStatus,
      activePlacementAssessmentId: '',
      updatedAt: serverTimestamp(),
    });
  });
  resetCache(user.uid);
  const fresh = await getJourney(id, { force: true });
  cache.active = fresh;
  return fresh;
}

async function beginJourneyFromStart(worldId) {
  const journey = await setPlacementChoice(worldId, 'beginning');
  window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
    detail: { worldId: journey.worldId, type: 'placement-declined' },
  }));
  return journey;
}

async function startPlacement(worldId) {
  let journey = await startJourney(worldId);
  if (journey.placementStatus === 'not-started') {
    journey = await setPlacementChoice(worldId, 'placement');
  }
  if (journey.placementStatus !== 'active') {
    throw journeyCloudError(
      'placement/already-decided',
      'Placement is no longer available for this journey.'
    );
  }
  const activeAssessmentId = String(journey.activePlacementAssessmentId || '');
  if (activeAssessmentId) {
    const session = await getPlacementSession(
      journey.worldId,
      activeAssessmentId,
      { force: true }
    );
    if (['active', 'submitting', 'completed'].includes(session?.status)) {
      return makePlacementBundle(journey, session);
    }
  }
  return preparePlacementGate(
    journey.worldId,
    journey.activeRankId,
    journey.activeGateId
  );
}

async function resumePlacement(worldId) {
  const journey = await getJourney(worldId, { force: true });
  if (!journey || journey.placementStatus !== 'active') {
    throw journeyCloudError('placement/not-active', 'There is no active Placement session.');
  }
  const assessmentId = String(journey.activePlacementAssessmentId || '');
  if (!assessmentId) {
    return preparePlacementGate(
      journey.worldId,
      journey.activeRankId,
      journey.activeGateId
    );
  }
  const session = await getPlacementSession(journey.worldId, assessmentId, { force: true });
  if (!session || !['active', 'submitting', 'completed'].includes(session.status)) {
    throw journeyCloudError('placement/not-active', 'There is no active Placement session.');
  }
  return makePlacementBundle(journey, session);
}

function placementResultFields(session, answered) {
  const total = Number(answered.totalQuestions) || 0;
  const correct = Number(answered.correctCount) || 0;
  return {
    placementScore: placementCore().placementScore(correct, total),
    placementCorrect: correct,
    placementTotal: total,
    placementAssessmentId: session.assessmentId,
  };
}

async function placementResultFromSaved(worldId, assessmentId) {
  const [journey, session] = await Promise.all([
    getJourney(worldId, { force: true }),
    getPlacementSession(worldId, assessmentId, { force: true }),
  ]);
  if (!journey || !session || session.status !== 'completed') {
    throw journeyCloudError(
      'placement/result-incomplete',
      'Placement result has not finished saving.'
    );
  }

  const passed = session.outcome === 'passed';
  const continuationAvailable = passed &&
    journey.placementStatus === 'active' &&
    !String(journey.activePlacementAssessmentId || '');
  let nextRank = null;
  let nextGate = null;
  if (continuationAvailable) {
    [nextRank, nextGate] = await Promise.all([
      contentApi().getPublishedRank(worldId, journey.activeRankId),
      contentApi().getPublishedGate(
        worldId,
        journey.activeRankId,
        journey.activeGateId
      ),
    ]);
  }
  cache.active = journey;
  return {
    completed: true,
    passed,
    journeyCompleted: passed && journey.placementStatus === 'completed',
    continuationAvailable,
    journey,
    session,
    nextRank,
    nextGate,
    bundle: null,
  };
}

async function finalizePlacementResult(worldId, assessmentId) {
  const user = requireUser();
  const id = core().cleanId(worldId, 'World');
  const assessment = placementCore().cleanId(assessmentId, 'Assessment');
  const before = await getPlacementSession(id, assessment, { force: true });
  if (!before) {
    throw journeyCloudError('placement/not-active', 'Placement session was not found.');
  }
  if (before.status === 'completed') {
    const savedJourney = await getJourney(id, { force: true });
    if (String(savedJourney?.activePlacementAssessmentId || '') !== assessment) {
      return placementResultFromSaved(id, assessment);
    }
  }
  if (!['submitting', 'completed'].includes(before.status)) {
    throw journeyCloudError(
      'placement/result-not-ready',
      'Placement answers are not ready to be finalized.'
    );
  }

  const passed = placementCore().placementPassed(
    before.correctCount,
    before.totalQuestions,
    before.passThreshold
  );
  const nextTarget = passed
    ? await resolveNextContentTarget(id, before.rankId, before.currentGateId)
    : null;
  const sessionRef = placementSessionRef(user.uid, id, assessment);
  const targetJourneyRef = journeyRef(user.uid, id);
  const progressRef = gateProgressRef(
    user.uid,
    id,
    before.rankId,
    before.currentGateId
  );

  if (before.status === 'submitting') {
    try {
      await runTransaction(db, async (transaction) => {
      const snapshots = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(progressRef),
      ]);
      const session = snapshots[0].data() || {};
      const progress = snapshots[1].data() || {};
      if (
        !snapshots[0].exists() ||
        !snapshots[1].exists() ||
        session.status !== 'submitting' ||
        session.currentQuestionIndex !== session.totalQuestions
      ) {
        throw journeyCloudError(
          'placement/session-mismatch',
          'Placement session is no longer current.'
        );
      }

      const didPass = placementCore().placementPassed(
        session.correctCount,
        session.totalQuestions,
        session.passThreshold
      );
      const resultFields = placementResultFields(session, session);
      const resultAlreadySaved =
        String(progress.placementAssessmentId || '') === assessment;
      if (resultAlreadySaved) {
        const expectedStatus = didPass ? 'cleared' : 'learning';
        const savedResultMatches =
          progress.status === expectedStatus &&
          Number(progress.placementCorrect) === resultFields.placementCorrect &&
          Number(progress.placementTotal) === resultFields.placementTotal &&
          Number(progress.placementScore) === resultFields.placementScore &&
          (didPass
            ? progress.clearedBy === 'placement'
            : !progress.clearedBy);
        if (!savedResultMatches) {
          throw journeyCloudError(
            'placement/result-mismatch',
            'The saved gate result does not match the Placement session.'
          );
        }
      } else {
        transaction.update(progressRef, {
          status: didPass ? 'cleared' : 'learning',
          ...resultFields,
          ...(didPass
            ? { clearedAt: serverTimestamp(), clearedBy: 'placement' }
            : {}),
          lastActivityAt: serverTimestamp(),
        });
      }
      });
    } catch (error) {
      throw journeyOperationError(error, 'save-placement-gate-result', {
        uid: user.uid,
        worldId: id,
        assessmentId: assessment,
        rankId: before.rankId,
        gateId: before.currentGateId,
        completionStep: before.completionStep || 'answers-saved',
      });
    }
  }

  if (before.status === 'submitting') {
    try {
      await runTransaction(db, async (transaction) => {
        const sessionSnapshot = await transaction.get(sessionRef);
        const session = sessionSnapshot.data() || {};
        if (
          !sessionSnapshot.exists() ||
          session.status !== 'submitting' ||
          session.currentQuestionIndex !== session.totalQuestions
        ) {
          throw journeyCloudError(
            'placement/session-mismatch',
            'Placement session is no longer current.'
          );
        }
        const didPass = placementCore().placementPassed(
          session.correctCount,
          session.totalQuestions,
          session.passThreshold
        );
        const resultFields = placementResultFields(session, session);
        const rankCompletedByPlacement = didPass && (
          !nextTarget ||
          String(nextTarget.rank.rankId) !== String(session.rankId)
        );
        transaction.update(sessionRef, {
          status: 'completed',
          outcome: didPass ? 'passed' : 'failed',
          score: resultFields.placementScore,
          rankCompletedByPlacement,
          gateProgressSaved: true,
          placementCompleted: true,
          nextGateUnlocked: Boolean(didPass && nextTarget),
          completionStep: 'result-saved',
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      throw journeyOperationError(error, 'complete-placement-session', {
        uid: user.uid,
        worldId: id,
        assessmentId: assessment,
        rankId: before.rankId,
        gateId: before.currentGateId,
        completionStep: 'gate-result-saved',
      });
    }
  }

  try {
    await runTransaction(db, async (transaction) => {
      const [journeySnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(targetJourneyRef),
        transaction.get(sessionRef),
      ]);
      const journey = journeySnapshot.data() || {};
      const session = sessionSnapshot.data() || {};
      if (
        !journeySnapshot.exists() ||
        !sessionSnapshot.exists() ||
        session.status !== 'completed'
      ) {
        throw journeyCloudError(
          'placement/session-mismatch',
          'Placement session is no longer current.'
        );
      }
      if (String(journey.activePlacementAssessmentId || '') !== assessment) {
        if (!String(journey.activePlacementAssessmentId || '')) return;
        throw journeyCloudError(
          'placement/session-mismatch',
          'Placement session is no longer current.'
        );
      }
      if (
        journey.status !== 'active' ||
        journey.placementStatus !== 'active' ||
        String(journey.activeRankId || '') !== String(session.rankId || '') ||
        String(journey.activeGateId || '') !== String(session.currentGateId || '')
      ) {
        throw journeyCloudError(
          'placement/session-mismatch',
          'Placement session is no longer current.'
        );
      }

      const didPass = session.outcome === 'passed';
      if (didPass && nextTarget) {
        const nextRankId = String(nextTarget.rank.rankId);
        const nextGateId = String(nextTarget.gate.gateId);
        transaction.update(targetJourneyRef, {
          activeRankId: nextRankId,
          activeGateId: nextGateId,
          activePlacementAssessmentId: '',
          unlockedRankIds: Array.from(new Set([
            ...(journey.unlockedRankIds || []),
            nextRankId,
          ])),
          unlockedGateIds: Array.from(new Set([
            ...(journey.unlockedGateIds || []),
            nextGateId,
          ])),
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.update(targetJourneyRef, {
          placementStatus: 'completed',
          activePlacementAssessmentId: '',
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    throw journeyOperationError(error, 'advance-placement-journey', {
      uid: user.uid,
      worldId: id,
      assessmentId: assessment,
      rankId: before.rankId,
      gateId: before.currentGateId,
      completionStep: 'session-completed',
    });
  }

  resetCache(user.uid);
  const result = await placementResultFromSaved(id, assessment);
  window.dispatchEvent(new CustomEvent(
    result.continuationAvailable
      ? 'lootlingua:placement-gate-passed'
      : 'lootlingua:placement-completed',
    {
      detail: {
        worldId: id,
        rankId: before.rankId,
        gateId: before.currentGateId,
        nextRankId: result.nextRank?.rankId || '',
        nextGateId: result.nextGate?.gateId || '',
        passed: result.passed,
        journeyCompleted: result.journeyCompleted,
      },
    }
  ));
  return result;
}

async function answerPlacementQuestion(worldId, assessmentId, selectedContentWordId) {
  const user = requireUser();
  const id = core().cleanId(worldId, 'World');
  const assessment = placementCore().cleanId(assessmentId, 'Assessment');
  const before = await getPlacementSession(id, assessment, { force: true });
  if (!before) {
    throw journeyCloudError('placement/not-active', 'Placement session was not found.');
  }
  if (before.status === 'submitting' || before.status === 'completed') {
    return finalizePlacementResult(id, assessment);
  }
  const answeredPreview = placementCore().answerSession(before, selectedContentWordId);
  const finalAnswer = answeredPreview.currentQuestionIndex === answeredPreview.totalQuestions;
  const sessionRef = placementSessionRef(user.uid, id, assessment);
  const targetJourneyRef = journeyRef(user.uid, id);
  try {
    await runTransaction(db, async (transaction) => {
      const [journeySnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(targetJourneyRef),
        transaction.get(sessionRef),
      ]);
      const journey = journeySnapshot.data() || {};
      const session = sessionSnapshot.data() || {};
      if (
        !journeySnapshot.exists() ||
        !sessionSnapshot.exists() ||
        journey.status !== 'active' ||
        journey.placementStatus !== 'active' ||
        String(journey.activePlacementAssessmentId || '') !== assessment ||
        String(journey.activeRankId || '') !== String(session.rankId || '') ||
        String(journey.activeGateId || '') !== String(session.currentGateId || '') ||
        session.status !== 'active'
      ) {
        throw journeyCloudError(
          'placement/session-mismatch',
          'Placement session is no longer current.'
        );
      }
      const answered = placementCore().answerSession(session, selectedContentWordId);
      const isFinal = answered.currentQuestionIndex === answered.totalQuestions;
      transaction.update(sessionRef, {
        currentQuestionIndex: answered.currentQuestionIndex,
        answers: answered.answers,
        correctCount: answered.correctCount,
        ...(isFinal
          ? {
            status: 'submitting',
            answersComplete: true,
            completionStep: 'answers-saved',
          }
          : {}),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    throw journeyOperationError(error, 'save-placement-answer', {
      uid: user.uid,
      worldId: id,
      assessmentId: assessment,
      rankId: before.rankId,
      gateId: before.currentGateId,
    });
  }

  resetCache(user.uid);
  if (!finalAnswer) {
    const journey = await getJourney(id, { force: true });
    cache.active = journey;
    const session = await getPlacementSession(id, assessment, { force: true });
    return {
      completed: false,
      correct: answeredPreview.answers.at(-1).correct,
      bundle: await makePlacementBundle(journey, session),
    };
  }
  const result = await finalizePlacementResult(id, assessment);
  return {
    ...result,
    correct: answeredPreview.answers.at(-1).correct,
  };
}

async function continuePlacement(worldId) {
  const journey = await getJourney(worldId, { force: true });
  if (
    !journey ||
    journey.status !== 'active' ||
    journey.placementStatus !== 'active' ||
    String(journey.activePlacementAssessmentId || '')
  ) {
    throw journeyCloudError(
      'placement/continuation-unavailable',
      'The next Placement gate is not available.'
    );
  }
  return preparePlacementGate(
    journey.worldId,
    journey.activeRankId,
    journey.activeGateId
  );
}

async function stopPlacement(worldId) {
  const user = requireUser();
  const id = core().cleanId(worldId, 'World');
  try {
    await runTransaction(db, async (transaction) => {
      const targetRef = journeyRef(user.uid, id);
      const snapshot = await transaction.get(targetRef);
      const journey = snapshot.data() || {};
      if (
        !snapshot.exists() ||
        journey.status !== 'active' ||
        journey.placementStatus !== 'active' ||
        String(journey.activePlacementAssessmentId || '')
      ) {
        throw journeyCloudError(
          'placement/continuation-unavailable',
          'Placement cannot be stopped at this point.'
        );
      }
      transaction.update(targetRef, {
        placementStatus: 'completed',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    throw journeyOperationError(error, 'stop-placement-between-gates', {
      uid: user.uid,
      worldId: id,
    });
  }
  resetCache(user.uid);
  const journey = await getJourney(id, { force: true });
  cache.active = journey;
  window.dispatchEvent(new CustomEvent('lootlingua:placement-completed', {
    detail: {
      worldId: id,
      rankId: journey.activeRankId,
      gateId: journey.activeGateId,
      passed: true,
      journeyCompleted: false,
      stoppedByUser: true,
    },
  }));
  return journey;
}

function resettableGateProgress(data, selection) {
  if (!data?.loadedAt) {
    return {
      worldId: selection.world.worldId,
      rankId: selection.rank.rankId,
      gateId: selection.gate.gateId,
      status: 'available',
      journeyVersion: core().JOURNEY_VERSION,
      lastActivityAt: serverTimestamp(),
      readyEvidenceCount: 0,
      clearAttempts: 0,
    };
  }
  return {
    worldId: selection.world.worldId,
    rankId: selection.rank.rankId,
    gateId: selection.gate.gateId,
    status: 'learning',
    journeyVersion: core().JOURNEY_VERSION,
    lastActivityAt: serverTimestamp(),
    readyEvidenceCount: 0,
    clearAttempts: 0,
    loadedAt: data.loadedAt,
    wordCountAtLoad: Math.max(0, Number(data.wordCountAtLoad) || 0),
    contentVersion: Math.max(1, Number(data.contentVersion) || 1),
    snapshotVersion: Math.max(1, Number(data.snapshotVersion) || 1),
    loadedContentWordIds: Array.isArray(data.loadedContentWordIds)
      ? data.loadedContentWordIds.map(String)
      : [],
    loadedWordKeys: Array.isArray(data.loadedWordKeys)
      ? data.loadedWordKeys.map(String)
      : [],
    nextRankId: String(data.nextRankId || ''),
    nextGateId: String(data.nextGateId || ''),
    loadStrategy: 'deterministic-source-docs-v1',
    operationId: String(data.operationId || createOperationId(selection.gate.gateId)),
    // A Placement reset round-trips the frozen legacy field only.
    ...(typeof data.masteryComplete === 'boolean'
      ? { masteryComplete: data.masteryComplete }
      : {}),
  };
}

async function abandonPlacementAndStartBeginning(worldId) {
  const user = requireUser();
  const id = core().cleanId(worldId, 'World');
  const [journey, selection] = await Promise.all([
    getJourney(id, { force: true }),
    resolveJourneyStart(id),
  ]);
  if (!journey || journey.placementStatus !== 'active') {
    throw journeyCloudError('placement/not-active', 'There is no active Placement session.');
  }
  const assessmentId = String(journey.activePlacementAssessmentId || '');
  const targetJourneyRef = journeyRef(user.uid, id);
  const sessionRef = assessmentId
    ? placementSessionRef(user.uid, id, assessmentId)
    : null;
  const firstProgressRef = gateProgressRef(
    user.uid,
    id,
    selection.rank.rankId,
    selection.gate.gateId
  );

  await runTransaction(db, async (transaction) => {
    const reads = [
      transaction.get(targetJourneyRef),
      transaction.get(firstProgressRef),
    ];
    if (sessionRef) reads.push(transaction.get(sessionRef));
    const snapshots = await Promise.all(reads);
    const currentJourney = snapshots[0].data() || {};
    if (
      !snapshots[0].exists() ||
      currentJourney.placementStatus !== 'active' ||
      String(currentJourney.activePlacementAssessmentId || '') !== assessmentId
    ) {
      throw journeyCloudError('placement/not-active', 'Placement state has changed.');
    }
    if (sessionRef && snapshots[2]?.exists() && snapshots[2].data()?.status === 'active') {
      transaction.update(sessionRef, {
        status: 'abandoned',
        completionStep: 'abandoned',
        abandonedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    transaction.update(targetJourneyRef, {
      activeRankId: selection.rank.rankId,
      activeGateId: selection.gate.gateId,
      placementStatus: 'declined',
      activePlacementAssessmentId: '',
      unlockedRankIds: [selection.rank.rankId],
      unlockedGateIds: [selection.gate.gateId],
      updatedAt: serverTimestamp(),
    });
    transaction.set(
      firstProgressRef,
      resettableGateProgress(snapshots[1].data(), selection)
    );
  });

  resetCache(user.uid);
  const fresh = await getJourney(id, { force: true });
  cache.active = fresh;
  window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
    detail: { worldId: id, type: 'placement-abandoned' },
  }));
  return fresh;
}

async function loadPublishedLevelContent(worldId, cefrLevel, options) {
  const level = levelPlacementCore().assertClassifiedLevel(cefrLevel);
  const wantedRankIds = Array.isArray(options?.rankIds)
    ? new Set(options.rankIds.map(String))
    : null;
  const ranks = core().stableRankOrder(
    await contentApi().listPublishedRanks(worldId, options)
  ).filter((rank) => (
    schemaApi().normalizeCefrLevel(rank.cefrLevel) === level &&
    (!wantedRankIds || wantedRankIds.has(String(rank.rankId)))
  ));
  const rankBundles = await Promise.all(ranks.map(async (rank) => {
    const gates = core().stableContentOrder(
      await contentApi().listPublishedGates(worldId, rank.rankId, options),
      'gateId'
    );
    const gateBundles = await Promise.all(gates.map(async (gate) => ({
      gate,
      words: await listAllGateWords(worldId, rank.rankId, gate.gateId, options),
    })));
    return { rank, gates: gateBundles };
  }));
  return { cefrLevel: level, ranks, rankBundles };
}

async function getLevelPlacementSession(worldId, assessmentId, options) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const assessment = levelPlacementCore().cleanId(assessmentId, 'Assessment');
  const key = `${world}/${assessment}`;
  if (!options?.force && cache.levelPlacementSessions.has(key)) {
    return cache.levelPlacementSessions.get(key);
  }
  const snapshot = await getDoc(levelPlacementSessionRef(user.uid, world, assessment));
  const session = record(snapshot, 'assessmentId');
  cache.levelPlacementSessions.set(key, session);
  return session;
}

async function makeLevelPlacementBundle(journey, session) {
  const activeAssessmentMatches =
    String(journey?.activeLevelPlacementAssessmentId || '') ===
      String(session?.assessmentId || '') &&
    ['active', 'submitting', 'awaiting-decision', 'paused'].includes(session?.status);
  const completedAssessmentMatches =
    session?.status === 'completed' &&
    session?.resultApplied === true &&
    String(journey?.levelPlacementAssessmentIds?.[session?.cefrLevel] || '') ===
      String(session?.assessmentId || '');
  if (
    !journey ||
    !session ||
    String(journey.worldId || '') !== String(session.worldId || '') ||
    (!activeAssessmentMatches && !completedAssessmentMatches)
  ) {
    throw journeyCloudError(
      'level-placement/session-mismatch',
      'Level Placement session does not match the active journey.'
    );
  }
  const world = await contentApi().getPublishedWorld(journey.worldId);
  return {
    journey,
    session,
    world,
    executionContext: { source: 'level-placement', suppressRewards: true },
  };
}

async function makeCommittedLevelPlacementBundle(journey, session, details = {}) {
  let world = null;
  let postCommitRefreshError = null;
  try {
    world = await contentApi().getPublishedWorld(journey.worldId);
  } catch (error) {
    postCommitRefreshError = journeyOperationError(
      error,
      'refresh-level-placement-result',
      {
        worldId: String(journey?.worldId || session?.worldId || ''),
        assessmentId: String(session?.assessmentId || ''),
      }
    );
    logJourneyOperationStage({
      operation: 'apply-placement-outcome',
      stage: 'post-commit-refresh-failed',
      worldId: journey?.worldId || session?.worldId,
      assessmentId: session?.assessmentId,
      sessionStatusAfter: session?.status,
      resultApplied: session?.resultApplied,
      commitSucceeded: true,
      destination: {
        rankId: session?.resultStartRankId,
        gateId: session?.resultStartGateId,
        completedCurrentContent: session?.completedCurrentContent,
      },
      failureCode: postCommitRefreshError.code,
    });
  }
  return {
    journey,
    session,
    world: world || {
      worldId: String(journey?.worldId || session?.worldId || ''),
      title: '',
      status: 'published',
    },
    executionContext: { source: 'level-placement', suppressRewards: true },
    postCommitRefreshError,
    ...details,
  };
}

async function getLevelPlacementResult(worldId, assessmentId, options) {
  const [journey, session] = await Promise.all([
    getJourney(worldId, options),
    getLevelPlacementSession(worldId, assessmentId, options),
  ]);
  return makeLevelPlacementBundle(journey, session);
}

function nextClassifiedLevel(cefrLevel) {
  const levels = schemaApi().CEFR_LEVELS.filter((level) => level !== 'unclassified');
  const index = levels.indexOf(schemaApi().normalizeCefrLevel(cefrLevel));
  return index >= 0 ? (levels[index + 1] || '') : '';
}

async function resolveFirstLevelTarget(worldId, cefrLevel) {
  const level = schemaApi().normalizeCefrLevel(cefrLevel);
  if (!level || level === 'unclassified') return null;
  const ranks = core().stableRankOrder(await contentApi().listPublishedRanks(worldId))
    .filter((rank) => schemaApi().normalizeCefrLevel(rank.cefrLevel) === level);
  for (const rank of ranks) {
    const gate = core().stableContentOrder(
      await contentApi().listPublishedGates(worldId, rank.rankId),
      'gateId'
    )[0];
    if (gate) return { rank, gate };
  }
  return null;
}

async function resolveNextPublishedLevelTarget(worldId, cefrLevel) {
  const levels = schemaApi().CEFR_LEVELS.filter((level) => level !== 'unclassified');
  const currentIndex = levels.indexOf(schemaApi().normalizeCefrLevel(cefrLevel));
  for (let index = currentIndex + 1; index < levels.length; index += 1) {
    const target = await resolveFirstLevelTarget(worldId, levels[index]);
    if (target) return { ...target, cefrLevel: levels[index] };
  }
  return null;
}

async function startLevelPlacementOnce(user, world, level, options) {
  let [journey, activeJourney] = await Promise.all([
    getJourney(world, { force: true }),
    getActiveJourney({ force: true }),
  ]);
  if (
    !journey ||
    journey.status !== 'active' ||
    String(activeJourney?.worldId || '') !== world
  ) {
    journey = await startJourney(world);
  }
  if (journey.placementStatus === 'active') {
    throw journeyCloudError(
      'level-placement/legacy-active',
      'Finish or abandon the legacy Gate Placement before starting Level Placement.'
    );
  }
  const activeAssessmentId = String(journey.activeLevelPlacementAssessmentId || '');
  if (activeAssessmentId) {
    const activeSession = await getLevelPlacementSession(world, activeAssessmentId, { force: true });
    if (activeSession && ['active', 'submitting', 'awaiting-decision', 'paused'].includes(activeSession.status)) {
      if (String(activeSession.cefrLevel) !== level) {
        throw journeyCloudError(
          'level-placement/session-active',
          'Another Level Placement session is already active.'
        );
      }
      return makeLevelPlacementBundle(journey, activeSession);
    }
  }
  const overview = await getLevelPlacementOverview(world, level, {
    force: Boolean(options?.force),
  });
  const alreadyPassed = (journey.passedCefrLevels || []).includes(level);
  const assessmentMode = alreadyPassed && !options?.restart ? 'new-ranks' : 'full-level';
  if (alreadyPassed && !overview.unassessedRanks.length && !options?.restart) {
    throw journeyCloudError('level-placement/already-passed', 'This level has no new ranks to assess.');
  }
  if (!alreadyPassed && !levelPlacementCore().canStartLevelPlacement(level, journey)) {
    throw journeyCloudError('level-placement/locked', 'The previous level must be passed first.');
  }

  const testRanks = assessmentMode === 'new-ranks' && !options?.restart
    ? overview.unassessedRanks
    : overview.ranks;
  const content = await loadPublishedLevelContent(world, level, {
    force: Boolean(options?.force),
    rankIds: testRanks.map((rank) => String(rank.rankId)),
  });
  const seed = levelPlacementCore().createAssessmentSeed(
    world,
    level,
    globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`
  );
  const assessment = levelPlacementCore().assessmentId(world, level, seed);
  const sample = levelPlacementCore().buildLevelSample({
    cefrLevel: level,
    assessmentSeed: seed,
    rankBundles: content.rankBundles,
  });
  const seedData = levelPlacementCore().createSessionSeed({
    assessmentId: assessment,
    worldId: world,
    sample,
    previousHistory: overview.history,
    assessmentMode,
    publishedRankSetHash: levelPlacementCore().mergeRankCoverage(
      overview.history,
      testRanks,
      overview.ranks
    ).publishedRankSetHash,
  });
  const targetJourneyRef = journeyRef(user.uid, world);
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  let committedJourney = null;
  let committedSession = null;
  try {
    await runTransaction(db, async (transaction) => {
      const [journeySnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(targetJourneyRef),
        transaction.get(sessionRef),
      ]);
      const current = journeySnapshot.data() || {};
      if (!journeySnapshot.exists() || current.status !== 'active') {
        throw journeyCloudError('journey/not-active', 'This world is not the active journey.');
      }
      if (String(current.activeLevelPlacementAssessmentId || '')) {
        throw journeyCloudError(
          'level-placement/session-active',
          'Another Level Placement session is already active.'
        );
      }
      const currentAlreadyPassed = (current.passedCefrLevels || []).includes(level);
      if (!currentAlreadyPassed && !levelPlacementCore().canStartLevelPlacement(level, current)) {
        throw journeyCloudError('level-placement/locked', 'The previous level must be passed first.');
      }
      if (sessionSnapshot.exists()) {
        throw journeyCloudError('level-placement/session-exists', 'Level Placement session already exists.');
      }
      const sessionCreate = {
        ...seedData,
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const parentUpdate = {
        placementStatus: current.placementStatus === 'not-started'
          ? 'declined'
          : current.placementStatus,
        activeLevelPlacementAssessmentId: assessment,
        activeLevelPlacementCefrLevel: level,
        levelPlacementStatus: 'active',
        levelPlacementVersion: levelPlacementCore().LEVEL_PLACEMENT_VERSION,
        passedCefrLevels: Array.from(new Set(current.passedCefrLevels || [])),
        updatedAt: serverTimestamp(),
      };
      const committedAt = new Date();
      committedSession = {
        ...seedData,
        assessmentId: assessment,
        worldId: world,
        startedAt: committedAt,
        updatedAt: committedAt,
      };
      committedJourney = {
        ...current,
        ...parentUpdate,
        worldId: world,
        updatedAt: committedAt,
      };
      logJourneyProgressionCommit({
        authUid: user.uid,
        operations: [
          { type: 'create', path: sessionRef.path, fields: sessionCreate },
          { type: 'update', path: targetJourneyRef.path, fields: parentUpdate },
        ],
        activePointer: {
          activeRankId: current.activeRankId || '',
          activeGateId: current.activeGateId || '',
          activeLevelPlacementAssessmentId: current.activeLevelPlacementAssessmentId || '',
        },
        parentBefore: current,
        parentProposed: { ...current, ...parentUpdate },
      });
      transaction.set(sessionRef, sessionCreate);
      transaction.update(targetJourneyRef, parentUpdate);
    });
  } catch (error) {
    throw journeyOperationError(
      error,
      assessmentMode === 'new-ranks'
        ? 'start-new-ranks-placement'
        : 'start-level-placement',
      {
        uid: user.uid,
        worldId: world,
        cefrLevel: level,
        assessmentId: assessment,
        assessmentMode,
      }
    );
  }
  resetCache(user.uid);
  if (!committedJourney || !committedSession) {
    throw journeyCloudError(
      'level-placement/start-missing',
      'Level Placement started without a local commit receipt.'
    );
  }
  journey = committedJourney;
  cache.journeys.set(world, journey);
  cache.active = journey;
  cache.levelPlacementSessions.set(`${world}/${assessment}`, committedSession);
  return makeLevelPlacementBundle(journey, committedSession);
}

async function startLevelPlacement(worldId, cefrLevel, options) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const level = levelPlacementCore().assertClassifiedLevel(cefrLevel);
  const requestKey = `${user.uid}/${world}/${level}`;
  const activeRequest = levelPlacementStartRequests.get(requestKey);
  if (activeRequest) return activeRequest;

  const request = startLevelPlacementOnce(user, world, level, options);
  levelPlacementStartRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (levelPlacementStartRequests.get(requestKey) === request) {
      levelPlacementStartRequests.delete(requestKey);
    }
  }
}

async function resumeLevelPlacement(worldId) {
  const journey = await getJourney(worldId, { force: true });
  const assessment = String(journey?.activeLevelPlacementAssessmentId || '');
  if (!journey || !assessment) {
    throw journeyCloudError(
      'level-placement/not-active',
      'There is no active Level Placement session.'
    );
  }
  const session = await getLevelPlacementSession(journey.worldId, assessment, { force: true });
  return makeLevelPlacementBundle(journey, session);
}

async function continueLevelPlacement(worldId) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const journeyReference = journeyRef(user.uid, world);
  const journey = await getJourney(world, { force: true });
  const assessment = String(journey?.activeLevelPlacementAssessmentId || '');
  if (!assessment) {
    throw journeyCloudError('level-placement/not-active', 'There is no paused Level Placement session.');
  }
  const pausedSession = await getLevelPlacementSession(world, assessment, { force: true });
  const answersComplete =
    Number(pausedSession?.currentQuestionIndex) === (pausedSession?.orderedQuestionIds || []).length &&
    (pausedSession?.answers || []).length === (pausedSession?.orderedQuestionIds || []).length &&
    Boolean(pausedSession?.answersCompletedAt);
  if (pausedSession?.status === 'paused' && answersComplete) {
    return applyPlacementOutcome(world, assessment);
  }
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  let savedJourney = null;
  let savedSession = null;
  await runTransaction(db, async (transaction) => {
    const [journeySnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(journeyReference),
      transaction.get(sessionRef),
    ]);
    const currentJourney = journeySnapshot.data() || {};
    const currentSession = sessionSnapshot.data() || {};
    if (
      !journeySnapshot.exists() ||
      !sessionSnapshot.exists() ||
      String(currentJourney.activeLevelPlacementAssessmentId || '') !== assessment ||
      currentSession.status !== 'paused'
    ) {
      throw journeyCloudError('level-placement/session-mismatch', 'Paused Placement session changed.');
    }
    savedJourney = { ...currentJourney, worldId: world, levelPlacementStatus: 'active' };
    savedSession = { ...currentSession, assessmentId: assessment, status: 'active' };
    transaction.update(sessionRef, {
      status: 'active',
      resumedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.update(journeyReference, {
      levelPlacementStatus: 'active',
      updatedAt: serverTimestamp(),
    });
  });
  cache.journeys.set(world, savedJourney);
  cache.active = savedJourney;
  cache.levelPlacementSessions.set(`${world}/${assessment}`, savedSession);
  return makeLevelPlacementBundle(savedJourney, savedSession);
}

async function reconcilePlacementOutcomeProgress(user, world, assessment, session) {
  const clearedIds = new Set((session.resultClearedGateIds || []).map(String));
  const clearedTargets = [];
  await Promise.all((session.passedRankIds || []).map(async (rankId) => {
    const gates = await contentApi().listPublishedGates(world, rankId);
    gates.forEach((gate) => {
      if (clearedIds.has(String(gate.gateId))) {
        clearedTargets.push({ rankId: String(rankId), gateId: String(gate.gateId) });
      }
    });
  }));
  await Promise.all(clearedTargets.map(async (target) => {
      const progressReference = gateProgressRef(
        user.uid,
        world,
        target.rankId,
        target.gateId
      );
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(progressReference);
        const progress = snapshot.exists() ? snapshot.data() : {};
        if (progress.status === 'cleared') return;
        const rankStat = session.perRankStats?.[target.rankId] || {};
        transaction.set(progressReference, {
          worldId: world,
          rankId: target.rankId,
          gateId: target.gateId,
          status: 'cleared',
          journeyVersion: core().JOURNEY_VERSION,
          readyEvidenceCount: Math.max(0, Number(progress.readyEvidenceCount) || 0),
          clearAttempts: Math.max(0, Number(progress.clearAttempts) || 0),
          clearedAt: serverTimestamp(),
          clearedBy: 'level-placement',
          levelPlacementAssessmentId: assessment,
          levelPlacementScore: Math.max(0, Math.min(1, Number(rankStat.ratio) || 0)),
          placementClearedWithoutLoad: !progress.loadedAt,
          lastActivityAt: serverTimestamp(),
        }, { merge: true });
      });
  }));
  const targetRankId = String(session.resultStartRankId || '');
  const targetGateId = String(session.resultStartGateId || '');
  if (targetRankId && targetGateId && !clearedIds.has(targetGateId)) {
    const targetReference = gateProgressRef(user.uid, world, targetRankId, targetGateId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(targetReference);
      if (snapshot.exists()) return;
      transaction.set(targetReference, {
        worldId: world,
        rankId: targetRankId,
        gateId: targetGateId,
        status: 'available',
        journeyVersion: core().JOURNEY_VERSION,
        readyEvidenceCount: 0,
        clearAttempts: 0,
        lastActivityAt: serverTimestamp(),
      });
    });
  }
}

async function reconcilePreviouslyAppliedPlacementOutcome(user, world, assessment, session) {
  let progressReconciliationError = null;
  try {
    await reconcilePlacementOutcomeProgress(user, world, assessment, session);
  } catch (error) {
    progressReconciliationError = journeyOperationError(
      error,
      'reconcile-placement-outcome-progress',
      { uid: user.uid, worldId: world, assessmentId: assessment }
    );
  }
  let sessionReconciliationError = null;
  let savedSession = session;
  if (session.status !== 'completed') {
    try {
      await finishLevelPlacement(world, assessment, 'complete');
      savedSession = cache.levelPlacementSessions.get(`${world}/${assessment}`) || session;
    } catch (error) {
      sessionReconciliationError = journeyOperationError(
        error,
        'reconcile-placement-session-status',
        { worldId: world, assessmentId: assessment }
      );
    }
  }
  let journey = cache.journeys.get(world) || cache.active;
  let journeyRefreshError = null;
  try {
    journey = await getJourney(world, { force: true });
  } catch (error) {
    journeyRefreshError = journeyOperationError(
      error,
      'refresh-applied-placement-journey',
      { worldId: world, assessmentId: assessment }
    );
    if (!journey || String(journey.worldId || '') !== world) {
      throw journeyRefreshError;
    }
  }
  return makeCommittedLevelPlacementBundle(journey, savedSession, {
    progressReconciliationError,
    sessionReconciliationError,
    journeyRefreshError,
  });
}

async function applyPlacementOutcome(worldId, assessmentId) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const assessment = levelPlacementCore().cleanId(assessmentId, 'Assessment');
  const session = await getLevelPlacementSession(world, assessment, { force: true });
  if (session?.resultApplied === true) {
    if (session.status === 'completed') {
      return reconcilePreviouslyAppliedPlacementOutcome(user, world, assessment, session);
    }
    if (['awaiting-decision', 'paused'].includes(session.status)) {
      return reconcilePreviouslyAppliedPlacementOutcome(user, world, assessment, session);
    }
  }
  const resumesCompletedResult = session?.status === 'paused' &&
    Number(session.currentQuestionIndex) === (session.orderedQuestionIds || []).length &&
    (session.answers || []).length === (session.orderedQuestionIds || []).length &&
    Boolean(session.answersCompletedAt);
  if (!session || (session.status !== 'awaiting-decision' && !resumesCompletedResult)) {
    throw journeyCloudError(
      'level-placement/result-not-ready',
      'Level Placement result is not ready.'
    );
  }

  const [journeyBeforeResult, publishedRanks] = await Promise.all([
    getJourney(world, { force: true }),
    contentApi().listPublishedRanks(world, { force: true }),
  ]);
  const passedRankIds = Array.from(new Set((session.passedRankIds || []).map(String)));
  const passedRankGates = new Map();
  await Promise.all(passedRankIds.map(async (rankId) => {
    const gates = core().stableContentOrder(
      await contentApi().listPublishedGates(world, rankId),
      'gateId'
    );
    passedRankGates.set(rankId, gates);
  }));
  const nextTarget = session.passedLevel
    ? await resolveNextPublishedLevelTarget(world, session.cefrLevel)
    : null;
  const nextLevel = String(nextTarget?.cefrLevel || '');
  const outcome = core().planPlacementOutcome({
    session,
    journey: journeyBeforeResult,
    nextLevelTarget: nextTarget,
    gatesByRank: passedRankGates,
  });
  const targetRankId = outcome.destination.rankId;
  const targetGateId = outcome.destination.gateId;
  const completedCurrentContent = outcome.completedCurrentContent;
  const resultUnlockedRankIds = outcome.resultUnlockedRankIds;
  const resultUnlockedGateIds = outcome.resultUnlockedGateIds;
  const resultClearedGateIds = outcome.resultClearedGateIds;

  const targetJourneyRef = journeyRef(user.uid, world);
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  const pointerRef = activeJourneyRef(user.uid);
  let committedJourney = null;
  let committedSession = null;
  let worldCompletionRecorded = false;
  logJourneyOperationStage({
    operation: 'apply-placement-outcome',
    stage: 'commit-attempt',
    worldId: world,
    assessmentId: assessment,
    sessionStatusBefore: session.status,
    resultApplied: session.resultApplied,
    questionCount: session.orderedQuestionIds?.length,
    answerCount: session.answers?.length,
    destination: {
      rankId: targetRankId,
      gateId: targetGateId,
      completedCurrentContent,
    },
  });
  try {
    await runTransaction(db, async (transaction) => {
        const snapshots = await Promise.all([
          transaction.get(targetJourneyRef),
          transaction.get(sessionRef),
          transaction.get(pointerRef),
        ]);
        const journeySnapshot = snapshots[0];
        const sessionSnapshot = snapshots[1];
        const pointerSnapshot = snapshots[2];
        const journey = journeySnapshot.data() || {};
        const currentSession = sessionSnapshot.data() || {};
        if (currentSession.resultApplied === true && currentSession.status === 'completed') {
          committedJourney = { ...journey, worldId: world };
          committedSession = { ...currentSession, assessmentId: assessment };
          return;
        }
        if (
          !journeySnapshot.exists() ||
          !sessionSnapshot.exists() ||
          String(journey.activeLevelPlacementAssessmentId || '') !== assessment ||
          !(
            currentSession.status === 'awaiting-decision' ||
            (
              currentSession.status === 'paused' &&
              Number(currentSession.currentQuestionIndex) ===
                (currentSession.orderedQuestionIds || []).length &&
              (currentSession.answers || []).length ===
                (currentSession.orderedQuestionIds || []).length &&
              Boolean(currentSession.answersCompletedAt)
            )
          )
        ) {
          throw journeyCloudError(
            'level-placement/session-mismatch',
            'Level Placement result is no longer current.'
          );
        }
        const passedLevels = Array.from(new Set([
          ...(journey.passedCefrLevels || []),
          ...(currentSession.passedLevel ? [currentSession.cefrLevel] : []),
        ])).sort((left, right) => (
          schemaApi().getCefrLevelOrder(left) - schemaApi().getCefrLevelOrder(right)
        ));
        const partialLevels = Array.from(new Set([
          ...(journey.partialCefrLevels || []),
          ...(!currentSession.passedLevel && currentSession.passedRankIds?.length
            ? [currentSession.cefrLevel]
            : []),
        ])).filter((level) => !passedLevels.includes(level));
        const assessmentIds = {
          ...(journey.levelPlacementAssessmentIds || {}),
          [currentSession.cefrLevel]: assessment,
        };
        const placementPassedRankIds = Array.from(new Set([
          ...(journey.levelPlacementPassedRankIds || []),
          ...passedRankIds,
        ]));
        const placementClearedGateIds = Array.from(new Set([
          ...(journey.levelPlacementClearedGateIds || []),
          ...resultClearedGateIds,
        ]));
        worldCompletionRecorded = Boolean(
          completedCurrentContent && !journey.worldCompletion
        );
        const committedAt = new Date();
        const localWorldCompletion = worldCompletionRecorded
          ? core().createWorldCompletionAchievement({
            worldId: world,
            ranks: publishedRanks,
            completedBy: 'level-placement',
            completedAt: committedAt,
          })
          : journey.worldCompletion;
        const storedWorldCompletion = worldCompletionRecorded
          ? core().createWorldCompletionAchievement({
            worldId: world,
            ranks: publishedRanks,
            completedBy: 'level-placement',
            completedAt: serverTimestamp(),
          })
          : null;
        const proposedJourney = {
          activeRankId: targetRankId || journey.activeRankId,
          activeGateId: targetGateId || journey.activeGateId,
          unlockedRankIds: Array.from(new Set([
            ...(journey.unlockedRankIds || []),
            ...resultUnlockedRankIds,
          ])),
          unlockedGateIds: Array.from(new Set([
            ...(journey.unlockedGateIds || []),
            ...resultUnlockedGateIds,
          ])),
          contentJourneyStatus: completedCurrentContent
            ? 'completed-current-content'
            : 'in-progress',
          ...(localWorldCompletion ? { worldCompletion: localWorldCompletion } : {}),
        };
        committedJourney = {
          ...journey,
          ...proposedJourney,
          worldId: world,
          passedCefrLevels: passedLevels,
          partialCefrLevels: partialLevels,
          levelPlacementAssessmentIds: assessmentIds,
          levelPlacementPassedRankIds: placementPassedRankIds,
          levelPlacementClearedGateIds: placementClearedGateIds,
          activeLevelPlacementAssessmentId: '',
          activeLevelPlacementCefrLevel: '',
          levelPlacementStatus: 'completed',
          updatedAt: committedAt,
        };
        committedSession = {
          ...currentSession,
          assessmentId: assessment,
          status: 'completed',
          resultApplied: true,
          assessedAt: committedAt,
          completedAt: committedAt,
          nextCefrLevel: nextLevel,
          resultStartRankId: targetRankId,
          resultStartGateId: targetGateId,
          resultUnlockedRankIds,
          resultUnlockedGateIds,
          resultClearedGateIds,
          completedCurrentContent,
          updatedAt: committedAt,
        };
        logJourneyProgressionCommit({
          authUid: user.uid,
          operations: [
            {
              type: 'update',
              path: targetJourneyRef.path,
              fields: {
                ...proposedJourney,
                passedCefrLevels: passedLevels,
                partialCefrLevels: partialLevels,
                levelPlacementAssessmentIds: assessmentIds,
                levelPlacementPassedRankIds: placementPassedRankIds,
                levelPlacementClearedGateIds: placementClearedGateIds,
                activeLevelPlacementAssessmentId: '',
                activeLevelPlacementCefrLevel: '',
                levelPlacementStatus: 'completed',
                updatedAt: 'request.time',
              },
            },
            {
              type: 'update',
              path: sessionRef.path,
              fields: {
                resultApplied: true,
                resultStartRankId: targetRankId,
                resultStartGateId: targetGateId,
                resultUnlockedRankIds,
                resultUnlockedGateIds,
                resultClearedGateIds,
                completedCurrentContent,
                status: 'completed',
                updatedAt: 'request.time',
              },
            },
            {
              type: 'set',
              path: pointerRef.path,
              fields: {
                worldId: world,
                journeyVersion: core().JOURNEY_VERSION,
                updatedAt: 'request.time',
              },
            },
          ],
          activePointer: pointerSnapshot.exists() ? pointerSnapshot.data() : {},
          parentBefore: {
            activeRankId: journey.activeRankId,
            activeGateId: journey.activeGateId,
            unlockedRankIds: journey.unlockedRankIds || [],
            unlockedGateIds: journey.unlockedGateIds || [],
            contentJourneyStatus: journey.contentJourneyStatus || 'in-progress',
          },
          parentProposed: proposedJourney,
        });
        transaction.update(targetJourneyRef, {
          ...(targetRankId ? { activeRankId: targetRankId } : {}),
          ...(targetGateId ? { activeGateId: targetGateId } : {}),
          unlockedRankIds: proposedJourney.unlockedRankIds,
          unlockedGateIds: proposedJourney.unlockedGateIds,
          passedCefrLevels: passedLevels,
          partialCefrLevels: partialLevels,
          levelPlacementAssessmentIds: assessmentIds,
          levelPlacementPassedRankIds: placementPassedRankIds,
          levelPlacementClearedGateIds: placementClearedGateIds,
          contentJourneyStatus: proposedJourney.contentJourneyStatus,
          ...(storedWorldCompletion ? { worldCompletion: storedWorldCompletion } : {}),
          activeLevelPlacementAssessmentId: '',
          activeLevelPlacementCefrLevel: '',
          levelPlacementStatus: 'completed',
          updatedAt: serverTimestamp(),
        });
        transaction.update(sessionRef, {
          status: 'completed',
          resultApplied: true,
          assessedAt: serverTimestamp(),
          completedAt: serverTimestamp(),
          nextCefrLevel: nextLevel,
          resultStartRankId: targetRankId,
          resultStartGateId: targetGateId,
          resultUnlockedRankIds,
          resultUnlockedGateIds,
          resultClearedGateIds,
          completedCurrentContent,
          updatedAt: serverTimestamp(),
        });
        if (!pointerSnapshot.exists() || String(pointerSnapshot.data()?.worldId || '') !== world) {
          transaction.set(pointerRef, {
            worldId: world,
            journeyVersion: core().JOURNEY_VERSION,
            updatedAt: serverTimestamp(),
          });
        }
      });
  } catch (error) {
    logJourneyOperationStage({
      operation: 'apply-placement-outcome',
      stage: 'commit-failed',
      worldId: world,
      assessmentId: assessment,
      sessionStatusBefore: session.status,
      resultApplied: false,
      questionCount: session.orderedQuestionIds?.length,
      answerCount: session.answers?.length,
      commitSucceeded: false,
      destination: {
        rankId: targetRankId,
        gateId: targetGateId,
        completedCurrentContent,
      },
      failureCode: error?.code,
    });
    throw journeyOperationError(error, 'apply-placement-outcome', {
      uid: user.uid,
      worldId: world,
      assessmentId: assessment,
      cefrLevel: session.cefrLevel,
    });
  }

  resetCache(user.uid);
  if (!committedJourney || !committedSession) {
    throw journeyCloudError(
      'level-placement/result-missing',
      'Level Placement outcome committed without a local receipt.'
    );
  }
  const journey = committedJourney;
  const savedSession = committedSession;
  cache.journeys.set(world, journey);
  cache.active = journey.contentJourneyStatus === 'completed-current-content'
    ? undefined
    : journey;
  cache.levelPlacementSessions.set(`${world}/${assessment}`, savedSession);
  logJourneyOperationStage({
    operation: 'apply-placement-outcome',
    stage: 'commit-succeeded',
    worldId: world,
    assessmentId: assessment,
    sessionStatusBefore: session.status,
    sessionStatusAfter: savedSession.status,
    resultApplied: savedSession.resultApplied,
    questionCount: savedSession.orderedQuestionIds?.length,
    answerCount: savedSession.answers?.length,
    commitSucceeded: true,
    destination: {
      rankId: savedSession.resultStartRankId,
      gateId: savedSession.resultStartGateId,
      completedCurrentContent: savedSession.completedCurrentContent,
    },
  });
  let progressReconciliationError = null;
  try {
    await reconcilePlacementOutcomeProgress(user, world, assessment, savedSession);
  } catch (error) {
    progressReconciliationError = journeyOperationError(
      error,
      'reconcile-placement-outcome-progress',
      { uid: user.uid, worldId: world, assessmentId: assessment }
    );
    console.warn('[Journey] Placement outcome projection remains retryable.', {
      code: progressReconciliationError.code,
      operation: progressReconciliationError.operation,
      worldId: world,
      assessmentId: assessment,
    });
  }
  window.dispatchEvent(new CustomEvent('lootlingua:level-placement-result', {
    detail: {
      worldId: world,
      cefrLevel: savedSession.cefrLevel,
      passedLevel: Boolean(savedSession.passedLevel),
      recommendedStartRankId: savedSession.recommendedStartRankId || '',
    },
  }));
  window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
    detail: {
      worldId: world,
      type: savedSession.completedCurrentContent
        ? 'world-completed'
        : 'level-placement-completed',
    },
  }));
  return makeCommittedLevelPlacementBundle(journey, savedSession, {
    progressReconciliationError,
    worldCompleted: Boolean(savedSession.completedCurrentContent),
    worldCompletionRecorded,
    worldCompletionId: String(journey?.worldCompletion?.completionId || ''),
  });
}

async function applyLevelPlacementResult(worldId, assessmentId) {
  return applyPlacementOutcome(worldId, assessmentId);
}

async function answerLevelPlacementQuestion(worldId, assessmentId, selectedQuestionId) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const assessment = levelPlacementCore().cleanId(assessmentId, 'Assessment');
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  const journeyReference = journeyRef(user.uid, world);
  let preview = null;
  let savedJourney = null;
  let savedSession = null;
  let resumesSavedOutcome = false;
  const trace = window.LootLinguaOperations?.startTrace('level-placement-answer');
  try {
    await runTransaction(db, async (transaction) => {
      const [journeySnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(journeyReference),
        transaction.get(sessionRef),
      ]);
      trace?.count('firestoreReads', 2);
      const journey = journeySnapshot.data() || {};
      const session = sessionSnapshot.data() || {};
      const answersComplete =
        Number(session.currentQuestionIndex) === (session.orderedQuestionIds || []).length &&
        (session.answers || []).length === (session.orderedQuestionIds || []).length;
      const savedFinalAnswer = (session.answers || []).at(-1);
      if (
        sessionSnapshot.exists() &&
        answersComplete &&
        ['awaiting-decision', 'paused', 'completed'].includes(session.status) &&
        String(savedFinalAnswer?.selectedQuestionId || '') === String(selectedQuestionId || '')
      ) {
        savedJourney = { ...journey, worldId: world };
        savedSession = { ...session, assessmentId: assessment, worldId: world };
        resumesSavedOutcome = true;
        return;
      }
      if (
        !journeySnapshot.exists() ||
        !sessionSnapshot.exists() ||
        String(journey.activeLevelPlacementAssessmentId || '') !== assessment ||
        session.status !== 'active'
      ) {
        throw journeyCloudError(
          'level-placement/session-mismatch',
          'Level Placement session is no longer current.'
        );
      }
      preview = levelPlacementCore().answerSession(session, selectedQuestionId);
      const roundComplete = preview.currentQuestionIndex === preview.orderedQuestionIds.length;
      const next = roundComplete ? levelPlacementCore().finalizeRound(preview) : preview;
      savedJourney = { ...journey, worldId: world };
      savedSession = { ...next, assessmentId: assessment, worldId: world };
      transaction.update(sessionRef, {
        status: next.status,
        currentQuestionIndex: next.currentQuestionIndex,
        orderedQuestionIds: next.orderedQuestionIds,
        answers: next.answers,
        correctCount: next.correctCount,
        adaptiveRound: next.adaptiveRound,
        adaptiveRankIds: next.adaptiveRankIds,
        perRankStats: next.perRankStats,
        ambiguousRankIds: next.ambiguousRankIds,
        recommendedStartRankId: next.recommendedStartRankId,
        recommendedStartGateId: next.recommendedStartGateId,
        passedRankIds: next.passedRankIds,
        passedPrefixLength: next.passedPrefixLength,
        passedLevel: next.passedLevel,
        ...(next.status === 'awaiting-decision'
          ? { answersCompletedAt: serverTimestamp(), resultApplied: false }
          : {}),
        updatedAt: serverTimestamp(),
      });
      trace?.count('firestoreWrites');
    });
  } catch (error) {
    trace?.warn(error?.code || error?.message || 'level-placement-answer-failed')
      .end({ failed: true });
    throw journeyOperationError(error, 'save-level-placement-answer', {
      uid: user.uid,
      worldId: world,
      assessmentId: assessment,
    });
  }
  cache.journeys.set(world, savedJourney);
  cache.active = savedJourney;
  cache.levelPlacementSessions.set(`${world}/${assessment}`, savedSession);
  trace?.stage('transaction-complete');
  if (
    resumesSavedOutcome ||
    ['awaiting-decision', 'completed'].includes(savedSession.status) ||
    (
      savedSession.status === 'paused' &&
      Number(savedSession.currentQuestionIndex) === (savedSession.orderedQuestionIds || []).length
    )
  ) {
    trace?.stage('round-complete').end({
      finalQuestion: true,
      resumedSavedOutcome: resumesSavedOutcome,
    });
    return applyPlacementOutcome(world, assessment);
  }
  const bundle = {
    ...(await makeLevelPlacementBundle(savedJourney, savedSession)),
    correct: Boolean(preview?.answers?.at(-1)?.correct),
    adaptiveStarted: savedSession.adaptiveRound > Number(preview?.adaptiveRound || 0),
  };
  trace?.stage('bundle-ready').end({
    pageIndex: savedSession.currentQuestionIndex,
    avoidedForcedReads: 2,
  });
  return bundle;
}

async function saveLevelPlacementWords(worldId, assessmentId, choice) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const assessment = levelPlacementCore().cleanId(assessmentId, 'Assessment');
  const session = await getLevelPlacementSession(world, assessment, { force: true });
  if (!session || !['awaiting-decision', 'paused', 'completed'].includes(session.status)) {
    throw journeyCloudError(
      'level-placement/result-not-ready',
      'Level Placement words cannot be saved yet.'
    );
  }
  const selectedChoice = String(choice || session.saveWordChoice || '');
  if (
    session.saveWordChoice &&
    session.saveWordChoice !== 'undecided' &&
    session.saveWordChoice !== selectedChoice
  ) {
    throw journeyCloudError(
      'level-placement/save-choice-locked',
      'The Placement word choice has already been saved.'
    );
  }
  const initialIds = levelPlacementCore().wordIdsForSaveChoice(session, selectedChoice);
  const savedIds = new Set((session.saveWordSavedIds || []).map(String));
  const previousPending = (session.saveWordPendingIds || []).map(String);
  const targetIds = previousPending.length
    ? previousPending
    : initialIds.filter((id) => !savedIds.has(String(id)));
  logJourneyOperationStage({
    operation: 'save-level-placement-words',
    stage: 'word-writes-started',
    worldId: world,
    assessmentId: assessment,
    sessionStatusBefore: session.status,
    resultApplied: session.resultApplied,
    saveWordChoice: selectedChoice,
    questionCount: session.orderedQuestionIds?.length,
    answerCount: session.answers?.length,
    targetCount: targetIds.length,
  });
  const byId = new Map((session.selectedWords || []).map((word) => [String(word.questionId), word]));
  const answerById = new Map((session.answers || []).map((answer) => [String(answer.questionId), answer]));
  const personalIndex = targetIds.length ? await readPersonalWordIndex(user.uid) : new Map();
  const summary = {
    created: Number(session.saveWordSummary?.created) || 0,
    sourceLinked: Number(session.saveWordSummary?.sourceLinked) || 0,
    alreadyLinked: Number(session.saveWordSummary?.alreadyLinked) || 0,
    restored: Number(session.saveWordSummary?.restored) ||
      Number(session.saveWordSummary?.restoredReady) || 0,
    updatedMissingFields: Number(session.saveWordSummary?.updatedMissingFields) || 0,
    hiddenPreserved: Number(session.saveWordSummary?.hiddenPreserved) || 0,
    failed: 0,
  };
  const failures = [];
  for (const id of targetIds) {
    const word = byId.get(String(id));
    const answer = answerById.get(String(id));
    if (!word || !answer) {
      failures.push({
        questionId: String(id),
        code: 'level-placement/word-unavailable',
        message: 'Placement word is unavailable.',
      });
      continue;
    }
    try {
      const result = await linkPublishedWord(
        user.uid,
        {
          ...word,
          worldId: world,
          rankId: word.rankId,
          gateId: word.gateId,
          status: 'published',
        },
        personalIndex,
        `level-placement:${assessment}`,
        {
          sourceType: 'level-placement',
          assessmentId: assessment,
          cefrLevel: session.cefrLevel,
          placementResult: answer.correct ? 'correct' : 'incorrect',
          suppressRewards: true,
          restoreHidden: true,
        }
      );
      savedIds.add(String(id));
      window.LootLinguaWordLifecycle?.addResultToSummary?.(summary, result);
    } catch (error) {
      failures.push({
        questionId: String(id),
        code: String(error?.code || 'journey/operation-failed'),
        message: String(error?.message || 'Word save failed.'),
      });
    }
  }
  summary.failed = failures.length;
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  let committedSession = null;
  try {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      const current = snapshot.data() || {};
      if (!snapshot.exists() || String(current.assessmentId || assessment) !== assessment) {
        throw journeyCloudError('level-placement/session-mismatch', 'Placement session changed.');
      }
      const committedAt = new Date();
      committedSession = {
        ...current,
        assessmentId: assessment,
        saveWordChoice: selectedChoice,
        saveWordPendingIds: failures.map((failure) => failure.questionId),
        saveWordSavedIds: [...savedIds],
        saveWordFailures: failures,
        saveWordSummary: summary,
        wordsSaveCompletedAt: failures.length ? null : committedAt,
        updatedAt: committedAt,
      };
      transaction.update(sessionRef, {
        saveWordChoice: selectedChoice,
        saveWordPendingIds: failures.map((failure) => failure.questionId),
        saveWordSavedIds: [...savedIds],
        saveWordFailures: failures,
        saveWordSummary: summary,
        wordsSaveCompletedAt: failures.length ? null : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    logJourneyOperationStage({
      operation: 'save-level-placement-words',
      stage: 'receipt-commit-failed',
      worldId: world,
      assessmentId: assessment,
      sessionStatusBefore: session.status,
      resultApplied: session.resultApplied,
      saveWordChoice: selectedChoice,
      targetCount: targetIds.length,
      savedCount: targetIds.length - failures.length,
      failureCount: failures.length,
      commitSucceeded: false,
      failureCode: error?.code,
    });
    throw journeyOperationError(error, 'save-level-placement-word-receipt', {
      worldId: world,
      assessmentId: assessment,
    });
  }
  if (!committedSession) {
    throw journeyCloudError(
      'level-placement/save-receipt-missing',
      'Placement word save committed without a local receipt.'
    );
  }
  cache.levelPlacementSessions.set(`${world}/${assessment}`, committedSession);
  logJourneyOperationStage({
    operation: 'save-level-placement-words',
    stage: failures.length ? 'partial-receipt-committed' : 'receipt-committed',
    worldId: world,
    assessmentId: assessment,
    sessionStatusBefore: session.status,
    sessionStatusAfter: committedSession.status,
    resultApplied: committedSession.resultApplied,
    saveWordChoice: selectedChoice,
    targetCount: targetIds.length,
    savedCount: targetIds.length - failures.length,
    failureCount: failures.length,
    commitSucceeded: true,
  });
  return {
    choice: selectedChoice,
    summary,
    failures,
    partial: failures.length > 0,
    saved: targetIds.length - failures.length,
    total: targetIds.length,
    session: committedSession,
  };
}

async function finishLevelPlacement(worldId, assessmentId, action) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const assessment = levelPlacementCore().cleanId(assessmentId, 'Assessment');
  const pause = action === 'pause';
  const targetJourneyRef = journeyRef(user.uid, world);
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  let savedJourney = null;
  let savedSession = null;
  await runTransaction(db, async (transaction) => {
    const [journeySnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(targetJourneyRef),
      transaction.get(sessionRef),
    ]);
    const journey = journeySnapshot.data() || {};
    const session = sessionSnapshot.data() || {};
    if (
      !journeySnapshot.exists() ||
      !sessionSnapshot.exists() ||
      String(journey.activeLevelPlacementAssessmentId || '') !== assessment ||
      !(pause
        ? ['active', 'submitting', 'awaiting-decision', 'paused'].includes(session.status)
        : ['awaiting-decision', 'paused'].includes(session.status))
    ) {
      throw journeyCloudError('level-placement/session-mismatch', 'Placement session changed.');
    }
    if (
      pause &&
      session.status === 'paused' &&
      journey.levelPlacementStatus === 'paused'
    ) {
      savedSession = { ...session, assessmentId: assessment };
      savedJourney = { ...journey, worldId: world };
      return;
    }
    savedSession = {
      ...session,
      assessmentId: assessment,
      status: pause ? 'paused' : 'completed',
    };
    savedJourney = {
      ...journey,
      worldId: world,
      levelPlacementStatus: pause ? 'paused' : 'completed',
      ...(pause ? {} : {
        activeLevelPlacementAssessmentId: '',
        activeLevelPlacementCefrLevel: '',
      }),
    };
    transaction.update(sessionRef, {
      status: pause ? 'paused' : 'completed',
      ...(pause ? { pausedAt: serverTimestamp() } : { completedAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    });
    transaction.update(targetJourneyRef, {
      levelPlacementStatus: pause ? 'paused' : 'completed',
      ...(pause ? {} : {
        activeLevelPlacementAssessmentId: '',
        activeLevelPlacementCefrLevel: '',
      }),
      updatedAt: serverTimestamp(),
    });
  });
  cache.journeys.set(world, savedJourney);
  cache.active = savedJourney?.contentJourneyStatus === 'completed-current-content'
    ? undefined
    : (savedJourney?.status === 'active' ? savedJourney : null);
  cache.levelPlacementSessions.set(`${world}/${assessment}`, savedSession);
  window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
    detail: { worldId: world, type: pause ? 'level-placement-paused' : 'level-placement-completed' },
  }));
  return savedJourney;
}

async function abandonLevelPlacement(worldId) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const journey = await getJourney(world, { force: true });
  const assessment = String(journey?.activeLevelPlacementAssessmentId || '');
  if (!assessment) {
    throw journeyCloudError('level-placement/not-active', 'There is no active Level Placement.');
  }
  const targetJourneyRef = journeyRef(user.uid, world);
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  await runTransaction(db, async (transaction) => {
    const [journeySnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(targetJourneyRef),
      transaction.get(sessionRef),
    ]);
    if (!journeySnapshot.exists() || !sessionSnapshot.exists()) {
      throw journeyCloudError('level-placement/session-mismatch', 'Placement session changed.');
    }
    transaction.update(sessionRef, {
      status: 'abandoned',
      abandonedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.update(targetJourneyRef, {
      activeLevelPlacementAssessmentId: '',
      activeLevelPlacementCefrLevel: '',
      levelPlacementStatus: 'abandoned',
      updatedAt: serverTimestamp(),
    });
  });
  resetCache(user.uid);
  const fresh = await getJourney(world, { force: true });
  cache.active = fresh;
  return fresh;
}

async function loadJourneyGraph(worldId, options) {
  const ranks = core().stableRankOrder(Array.isArray(options?.ranks)
    ? options.ranks
    : await contentApi().listPublishedRanks(worldId, options));
  const gatesByRank = new Map();
  const progressByRank = new Map();
  await Promise.all(ranks.map(async (rank) => {
    const rankId = String(rank.rankId || '');
    if (!rankId) return;
    const [gates, progress] = await Promise.all([
      contentApi().listPublishedGates(worldId, rankId, options),
      listRankGateProgress(worldId, rankId, options),
    ]);
    gatesByRank.set(rankId, core().stableContentOrder(gates, 'gateId'));
    progressByRank.set(rankId, progress);
  }));
  return { ranks, gatesByRank, progressByRank };
}

async function reconcileLevelPlacementJourney(worldId, options) {
  const world = core().cleanId(worldId, 'World');
  const journey = await getJourney(world, options);
  if (!journey) return { journey: null, unassessedRankIds: [] };
  const [graph, sessions] = await Promise.all([
    loadJourneyGraph(world, options),
    listLevelPlacementSessions(world, options),
  ]);
  const levelPlacementOverviews = buildLevelPlacementOverviews(
    journey,
    graph.ranks,
    sessions,
    graph
  );
  const unassessedRankIds = Array.from(new Set(
    [...levelPlacementOverviews.values()].flatMap((overview) => overview.unassessedRankIds)
  ));
  return { journey, unassessedRankIds, graph, levelPlacementOverviews };
}

async function resolveActiveJourneyDestination(worldId, options) {
  const reconciliation = await reconcileLevelPlacementJourney(worldId, options);
  const journey = reconciliation.journey;
  if (!journey) return { type: 'unavailable' };
  const graph = reconciliation.graph || await loadJourneyGraph(worldId, options);
  const assessment = String(journey.activeLevelPlacementAssessmentId || '');
  const session = assessment
    ? await getLevelPlacementSession(worldId, assessment, options)
    : null;
  const legacyAssessment = String(journey.activePlacementAssessmentId || '');
  const legacySession = legacyAssessment
    ? await getPlacementSession(worldId, legacyAssessment, options)
    : null;
  return core().resolveActiveJourneyDestination({
    journey,
    ranks: graph.ranks,
    gatesByRank: graph.gatesByRank,
    progressByRank: graph.progressByRank,
    levelPlacementSession: session,
    legacyPlacementActive: journey.placementStatus === 'active',
    legacyPlacementSession: legacySession,
    resumePausedLevelPlacement: options?.resumePausedLevelPlacement === true,
    unassessedRankIds: reconciliation.unassessedRankIds,
  });
}

function invalidate(scope) {
  const target = String(scope || 'all');
  if (target === 'all' || target === 'active') cache.active = undefined;
  if (target === 'all' || target === 'journeys') cache.journeys.clear();
  if (target === 'all' || target === 'progress') {
    cache.gateProgress.clear();
    cache.rankGateProgress.clear();
  }
  if (target === 'all' || target === 'words') cache.gateWords.clear();
  if (target === 'all' || target === 'placement') cache.placementSessions.clear();
  if (target === 'all' || target === 'level-placement') cache.levelPlacementSessions.clear();
  if (target === 'all' || target === 'gate-clear') cache.gateClearAttempts.clear();
}

function installJourneyMasteryHook() {
  const original = window.updateQuizWordInSource;
  if (
    typeof original !== 'function' ||
    original.__lootlinguaJourneyMasteryHook
  ) {
    return;
  }
  let evaluationTimer = null;
  const wrapped = function journeyAwareQuizWordUpdate(...args) {
    const updatedWord = original.apply(this, args);
    if (updatedWord) {
      clearTimeout(evaluationTimer);
      evaluationTimer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent('lootlingua:gate-mastery-local-change', {
          detail: {
            wordKey: window.LootLinguaWordLifecycle?.wordKeyOf?.(updatedWord) || '',
          },
        }));
      }, 80);
    }
    return updatedWord;
  };
  Object.defineProperty(wrapped, '__lootlinguaJourneyMasteryHook', {
    value: true,
  });
  window.updateQuizWordInSource = wrapped;
}

function installQuizEvidenceBeforeRewardHook() {
  const original = window.awardWordTransitionXPBatch;
  if (
    typeof original !== 'function' ||
    original.__lootlinguaEvidenceBeforeRewardHook
  ) {
    return;
  }
  const wrapped = async function evidenceFirstQuizReward(entries, sessionId, options = {}) {
    const context = window.getActiveVerifiedQuizCommitContext?.(sessionId);
    if (!window.auth?.currentUser || !context) {
      return original.apply(this, arguments);
    }
    window.LootLinguaOperations?.diagnostic?.('evidenceFirstQuizReward', {
      ownerId: window.auth.currentUser.uid,
      sessionId: String(sessionId || ''),
      entryCount: Array.isArray(entries) ? entries.length : 0,
    });
    options.trace?.stage('evidence-write-start', { entryCount: Array.isArray(entries) ? entries.length : 0 });
    const evidence = await recordQuizEvidenceBatch({
      sessionId: context.sessionId,
      mode: context.mode,
      source: context.source,
      completed: true,
      entries,
      projectReadiness: false,
    });
    options.trace?.stage('evidence-write-end', evidence);
    options.trace?.stage('xp-journey-start');
    const reward = await original.apply(this, arguments);
    options.trace?.stage('xp-journey-end', {
      eventCount: Array.isArray(reward?.awards) ? reward.awards.filter((amount) => amount > 0).length : 0,
      pendingCount: Number(reward?.pendingCount) || 0,
    });
    if (reward && typeof reward === 'object' && Object.isExtensible(reward)) {
      Object.defineProperty(reward, 'evidence', {
        value: evidence,
        configurable: true,
        enumerable: false,
      });
      return reward;
    }
    return reward && typeof reward === 'object' ? { ...reward, evidence } : reward;
  };
  Object.defineProperty(wrapped, '__lootlinguaEvidenceBeforeRewardHook', {
    value: true,
  });
  window.awardWordTransitionXPBatch = wrapped;
}

const API = Object.freeze({
  getActiveJourney,
  resolveAccountJourneyDestination,
  hasAnyJourneyProgress,
  getJourney,
  startJourney,
  switchActiveJourney,
  beginJourneyFromStart,
  startPlacement,
  resumePlacement,
  getPlacementSession,
  answerPlacementQuestion,
  finalizePlacementResult,
  continuePlacement,
  stopPlacement,
  abandonPlacementAndStartBeginning,
  startLevelPlacement,
  resumeLevelPlacement,
  continueLevelPlacement,
  getLevelPlacementSession,
  getLevelPlacementResult,
  listLevelPlacementSessions,
  getLevelPlacementOverview,
  getLevelPlacementOverviews,
  reconcileLevelPlacementJourney,
  resolveActiveJourneyDestination,
  answerLevelPlacementQuestion,
  applyPlacementOutcome,
  applyLevelPlacementResult,
  saveLevelPlacementWords,
  finishLevelPlacement,
  abandonLevelPlacement,
  loadPublishedLevelContent,
  getGateProgress,
  listRankGateProgress,
  getJourneyGateState: core().getJourneyGateState,
  canAccessRank: core().canAccessRank,
  canAccessGate: core().canAccessGate,
  loadGateWords,
  syncNewGateWords,
  updateGateProgress,
  findNewGateWords,
  getGateMasteryView,
  getGateNotificationFacts,
  subscribeGateProgress,
  recordQuizEvidenceBatch,
  projectQuizEvidenceReadiness,
  evaluateActiveJourneyReadiness,
  getGateClearAttempt,
  startGateClearAttempt,
  resumeGateClearAttempt,
  answerGateClearQuestion,
  finalizeGateClearAttempt,
  abandonGateClearAttempt,
  evaluateActiveJourneyMastery,
  evaluateActiveJourneyProgress,
  invalidate,
});

Object.defineProperty(window, 'LootLinguaJourneyCloud', {
  value: API,
  configurable: false,
  enumerable: true,
  writable: false,
});

window.addEventListener('lootlingua:auth-state', (event) => {
  resetCache(event.detail?.user?.uid || '');
});

window.evaluateActivePublishedJourney = evaluateActiveJourneyProgress;

if (document.readyState === 'complete') {
  installJourneyMasteryHook();
  installQuizEvidenceBeforeRewardHook();
} else {
  window.addEventListener('load', () => {
    installJourneyMasteryHook();
    installQuizEvidenceBeforeRewardHook();
  }, { once: true });
}

window.dispatchEvent(new CustomEvent('lootlingua:journey-cloud-ready'));
