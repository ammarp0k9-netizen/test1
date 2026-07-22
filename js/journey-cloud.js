import { getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
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
};

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

async function getActiveJourney(options) {
  const user = requireUser();
  if (!options?.force && cache.active !== undefined) return cache.active;
  const pointer = await getDoc(activeJourneyRef(user.uid));
  const worldId = pointer.exists() ? String(pointer.data()?.worldId || '') : '';
  if (!worldId) {
    cache.active = null;
    return null;
  }
  const journey = await getJourney(worldId, options);
  cache.active = journey?.status === 'active' ? journey : null;
  return cache.active;
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
    ...educational,
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
  const identity = schemaApi().normalizeWordIdentity(word);
  if (!identity.normalizedWord || !identity.wordKey) {
    throw journeyCloudError('journey/invalid-word', 'Published word identity is invalid.');
  }
  if (
    word.normalizedWord !== identity.normalizedWord ||
    word.wordKey !== identity.wordKey
  ) {
    throw journeyCloudError('journey/invalid-word', 'Published word identity is inconsistent.');
  }

  const source = {
    worldId: core().cleanId(word.worldId, 'World'),
    rankId: core().cleanId(word.rankId, 'Rank'),
    gateId: core().cleanId(word.gateId, 'Gate'),
    contentWordId: core().cleanId(word.contentWordId, 'Word'),
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
  const canonicalRef = doc(db, 'users', uid, 'contentWords', identity.wordKey);
  const sourceRef = doc(canonicalRef, 'sources', sourceId);
  const indexedWord = personalIndex.get(identity.wordKey);

  try {
    return await runTransaction(db, async (transaction) => {
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
          canonicalWordPayload(word, identity, legacyWordId, source, {
            sourceId,
            sourceType,
          })
        );
      }
      const incomingWord = legacyWordPayload(uid, word);
      if (!legacySnapshot.exists() && !indexedWord) {
        transaction.set(legacyRef, incomingWord);
      } else if (legacySnapshot.exists()) {
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
      };
    });
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
  if (progress && !['available', 'learning'].includes(progress.status)) {
    throw journeyCloudError('journey/gate-locked', 'This gate cannot be loaded.');
  }
  return { journey, rank, gate, progress };
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
    readyEvidenceCount: 0,
    clearAttempts: 0,
  };
  if (typeof (values?.masteryComplete ?? current?.masteryComplete) === 'boolean') {
    payload.masteryComplete = Boolean(values?.masteryComplete ?? current?.masteryComplete);
  }
  if (current?.placementAssessmentId) {
    Object.assign(payload, {
      placementAssessmentId: String(current.placementAssessmentId),
      placementScore: Number(current.placementScore) || 0,
      placementCorrect: Math.max(0, Number(current.placementCorrect) || 0),
      placementTotal: Math.max(1, Number(current.placementTotal) || 1),
    });
  }
  if (status === 'learning') {
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
    });
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
    await updateGateProgress(worldId, rankId, gateId, {
      status: 'learning',
      wordCountAtLoad: allWords.length,
      contentVersion: context.gate.version,
      snapshotVersion: context.gate.version,
      loadedContentWordIds: loadedIds,
      loadedWordKeys,
      nextRankId: nextTarget?.rank?.rankId || '',
      nextGateId: nextTarget?.gate?.gateId || '',
      operationId,
    }, options);
    await evaluateActiveJourneyMastery();
  }

  return {
    operationId,
    completed,
    total: targetWords.length,
    linkedSources,
    existingWords,
    failures,
    errorCode: firstFailure?.code || '',
    errorMessage: firstFailure?.message || '',
    errorOperation: firstFailure?.operation || '',
    partial: failures.length > 0,
    status: failures.length ? (context.progress?.status || 'available') : 'learning',
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

async function evaluateActiveJourneyMastery() {
  if (journeyProgressEvaluation) return journeyProgressEvaluation;
  const task = (async () => {
    const user = requireUser();
    const journey = await getActiveJourney({ force: true });
    if (!journey?.activeRankId || !journey?.activeGateId) {
      return { masteryComplete: false, reason: 'no-active-gate' };
    }

    const worldId = String(journey.worldId);
    const rankId = String(journey.activeRankId);
    const gateId = String(journey.activeGateId);
    const progress = await getGateProgress(worldId, rankId, gateId, { force: true });
    if (!['learning', 'cleared'].includes(progress?.status)) {
      return { masteryComplete: false, reason: 'gate-not-learning' };
    }

    let wordKeys = Array.from(new Set(
      (progress.loadedWordKeys || []).map(String).filter(Boolean)
    ));
    if (!wordKeys.length) {
      const words = await listAllGateWords(worldId, rankId, gateId, { force: true });
      wordKeys = Array.from(new Set(words.map((word) => String(word.wordKey || '')).filter(Boolean)));
    }
    if (!wordKeys.length) return { masteryComplete: false, reason: 'gate-has-no-words' };

    const masteryIndex = currentPersonalMasteryIndex(user.uid);
    const allMastered = wordKeys.every(
      (wordKey) => masteryIndex.get(wordKey)?.mastery_status === 'Mastered'
    );
    if (!allMastered) return { masteryComplete: false, reason: 'words-not-mastered' };
    if (progress.masteryComplete === true) {
      return { masteryComplete: true, changed: false };
    }

    const currentProgressRef = gateProgressRef(user.uid, worldId, rankId, gateId);

    const committed = await runTransaction(db, async (transaction) => {
      const progressSnapshot = await transaction.get(currentProgressRef);
      const savedProgress = progressSnapshot.data() || {};
      if (
        !progressSnapshot.exists() ||
        !['learning', 'cleared'].includes(savedProgress.status)
      ) {
        return false;
      }
      transaction.update(currentProgressRef, {
        masteryComplete: true,
        loadedWordKeys: wordKeys,
        lastActivityAt: serverTimestamp(),
      });
      return true;
    });
    if (!committed) return { masteryComplete: false, reason: 'state-changed' };

    cache.gateProgress.delete(gateCacheKey(worldId, rankId, gateId));
    cache.rankGateProgress.delete(rankCacheKey(worldId, rankId));
    const detail = {
      masteryComplete: true,
      changed: true,
      worldId,
      rankId,
      gateId,
    };
    window.dispatchEvent(new CustomEvent('lootlingua:journey-changed', {
      detail: { ...detail, type: 'mastery-complete' },
    }));
    return detail;
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
  if (progress?.status !== 'learning') return [];
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
  const ranks = core().stableRankOrder(
    await contentApi().listPublishedRanks(worldId, options)
  ).filter((rank) => schemaApi().normalizeCefrLevel(rank.cefrLevel) === level);
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
  if (
    !journey ||
    !session ||
    String(journey.worldId || '') !== String(session.worldId || '') ||
    String(journey.activeLevelPlacementAssessmentId || '') !== String(session.assessmentId || '') ||
    !['active', 'submitting', 'awaiting-decision', 'paused'].includes(session.status)
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

async function startLevelPlacement(worldId, cefrLevel, options) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const level = levelPlacementCore().assertClassifiedLevel(cefrLevel);
  let journey = await startJourney(world);
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
  if ((journey.passedCefrLevels || []).includes(level) && !options?.restart) {
    throw journeyCloudError(
      'level-placement/already-passed',
      'This level has already been passed.'
    );
  }
  if (!levelPlacementCore().canStartLevelPlacement(level, journey)) {
    throw journeyCloudError('level-placement/locked', 'The previous level must be passed first.');
  }

  const content = await loadPublishedLevelContent(world, level, { force: Boolean(options?.force) });
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
  });
  const targetJourneyRef = journeyRef(user.uid, world);
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
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
      if (!levelPlacementCore().canStartLevelPlacement(level, current)) {
        throw journeyCloudError('level-placement/locked', 'The previous level must be passed first.');
      }
      if (sessionSnapshot.exists()) {
        throw journeyCloudError('level-placement/session-exists', 'Level Placement session already exists.');
      }
      transaction.set(sessionRef, {
        ...seedData,
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.update(targetJourneyRef, {
        placementStatus: current.placementStatus === 'not-started'
          ? 'declined'
          : current.placementStatus,
        activeLevelPlacementAssessmentId: assessment,
        activeLevelPlacementCefrLevel: level,
        levelPlacementStatus: 'active',
        levelPlacementVersion: levelPlacementCore().LEVEL_PLACEMENT_VERSION,
        passedCefrLevels: Array.from(new Set(current.passedCefrLevels || [])),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    throw journeyOperationError(error, 'start-level-placement', {
      uid: user.uid,
      worldId: world,
      cefrLevel: level,
      assessmentId: assessment,
    });
  }
  resetCache(user.uid);
  journey = await getJourney(world, { force: true });
  cache.active = journey;
  const session = await getLevelPlacementSession(world, assessment, { force: true });
  return makeLevelPlacementBundle(journey, session);
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

async function levelPlacementUnlockedIds(worldId, session) {
  const rankIds = new Set(session.passedRankIds || []);
  if (session.recommendedStartRankId) rankIds.add(session.recommendedStartRankId);
  const gateIds = new Set();
  await Promise.all([...rankIds].map(async (rankId) => {
    const gates = await contentApi().listPublishedGates(worldId, rankId);
    if ((session.passedRankIds || []).includes(rankId)) {
      gates.forEach((gate) => gateIds.add(String(gate.gateId)));
    } else {
      const first = core().stableContentOrder(gates, 'gateId')[0];
      if (first) gateIds.add(String(first.gateId));
    }
  }));
  return { rankIds, gateIds };
}

async function applyLevelPlacementResult(worldId, assessmentId) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const assessment = levelPlacementCore().cleanId(assessmentId, 'Assessment');
  const session = await getLevelPlacementSession(world, assessment, { force: true });
  if (!session || session.status !== 'awaiting-decision') {
    throw journeyCloudError(
      'level-placement/result-not-ready',
      'Level Placement result is not ready.'
    );
  }
  if (session.resultApplied === true) {
    const journey = await getJourney(world, { force: true });
    return makeLevelPlacementBundle(journey, session);
  }

  let targetRankId = String(session.recommendedStartRankId || '');
  let targetGateId = String(session.recommendedStartGateId || '');
  let nextLevel = '';
  if (session.passedLevel) {
    nextLevel = nextClassifiedLevel(session.cefrLevel);
    const nextTarget = nextLevel ? await resolveFirstLevelTarget(world, nextLevel) : null;
    targetRankId = String(nextTarget?.rank?.rankId || '');
    targetGateId = String(nextTarget?.gate?.gateId || '');
  }
  const unlocked = await levelPlacementUnlockedIds(world, session);
  if (targetRankId) unlocked.rankIds.add(targetRankId);
  if (targetGateId) unlocked.gateIds.add(targetGateId);
  const resultUnlockedRankIds = [...unlocked.rankIds];
  const resultUnlockedGateIds = [...unlocked.gateIds];

  const targetJourneyRef = journeyRef(user.uid, world);
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  const targetProgressRef = targetRankId && targetGateId
    ? gateProgressRef(user.uid, world, targetRankId, targetGateId)
    : null;
  try {
    await runTransaction(db, async (transaction) => {
      const reads = [transaction.get(targetJourneyRef), transaction.get(sessionRef)];
      if (targetProgressRef) reads.push(transaction.get(targetProgressRef));
      const snapshots = await Promise.all(reads);
      const journey = snapshots[0].data() || {};
      const currentSession = snapshots[1].data() || {};
      if (
        !snapshots[0].exists() ||
        !snapshots[1].exists() ||
        String(journey.activeLevelPlacementAssessmentId || '') !== assessment ||
        currentSession.status !== 'awaiting-decision'
      ) {
        throw journeyCloudError(
          'level-placement/session-mismatch',
          'Level Placement result is no longer current.'
        );
      }
      if (currentSession.resultApplied === true) return;
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
      transaction.update(targetJourneyRef, {
        ...(targetRankId ? { activeRankId: targetRankId } : {}),
        ...(targetGateId ? { activeGateId: targetGateId } : {}),
        unlockedRankIds: Array.from(new Set([
          ...(journey.unlockedRankIds || []),
          ...resultUnlockedRankIds,
        ])),
        unlockedGateIds: Array.from(new Set([
          ...(journey.unlockedGateIds || []),
          ...resultUnlockedGateIds,
        ])),
        passedCefrLevels: passedLevels,
        partialCefrLevels: partialLevels,
        levelPlacementStatus: 'awaiting-decision',
        updatedAt: serverTimestamp(),
      });
      transaction.update(sessionRef, {
        resultApplied: true,
        nextCefrLevel: nextLevel,
        resultStartRankId: targetRankId,
        resultStartGateId: targetGateId,
        resultUnlockedRankIds,
        resultUnlockedGateIds,
        updatedAt: serverTimestamp(),
      });
      if (targetProgressRef && !snapshots[2].exists()) {
        transaction.set(targetProgressRef, {
          worldId: world,
          rankId: targetRankId,
          gateId: targetGateId,
          status: 'available',
          journeyVersion: core().JOURNEY_VERSION,
          readyEvidenceCount: 0,
          clearAttempts: 0,
          lastActivityAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    throw journeyOperationError(error, 'apply-level-placement-result', {
      uid: user.uid,
      worldId: world,
      assessmentId: assessment,
      cefrLevel: session.cefrLevel,
    });
  }
  resetCache(user.uid);
  const journey = await getJourney(world, { force: true });
  cache.active = journey;
  const savedSession = await getLevelPlacementSession(world, assessment, { force: true });
  window.dispatchEvent(new CustomEvent('lootlingua:level-placement-result', {
    detail: {
      worldId: world,
      cefrLevel: savedSession.cefrLevel,
      passedLevel: Boolean(savedSession.passedLevel),
      recommendedStartRankId: savedSession.recommendedStartRankId || '',
    },
  }));
  return makeLevelPlacementBundle(journey, savedSession);
}

async function answerLevelPlacementQuestion(worldId, assessmentId, selectedQuestionId) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const assessment = levelPlacementCore().cleanId(assessmentId, 'Assessment');
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
  const journeyReference = journeyRef(user.uid, world);
  let preview = null;
  try {
    await runTransaction(db, async (transaction) => {
      const [journeySnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(journeyReference),
        transaction.get(sessionRef),
      ]);
      const journey = journeySnapshot.data() || {};
      const session = sessionSnapshot.data() || {};
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
    });
  } catch (error) {
    throw journeyOperationError(error, 'save-level-placement-answer', {
      uid: user.uid,
      worldId: world,
      assessmentId: assessment,
    });
  }
  resetCache(user.uid);
  let journey = await getJourney(world, { force: true });
  cache.active = journey;
  let session = await getLevelPlacementSession(world, assessment, { force: true });
  if (session.status === 'awaiting-decision') {
    return applyLevelPlacementResult(world, assessment);
  }
  return {
    ...(await makeLevelPlacementBundle(journey, session)),
    correct: Boolean(preview?.answers?.at(-1)?.correct),
    adaptiveStarted: session.adaptiveRound > Number(preview?.adaptiveRound || 0),
  };
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
  const byId = new Map((session.selectedWords || []).map((word) => [String(word.questionId), word]));
  const answerById = new Map((session.answers || []).map((answer) => [String(answer.questionId), answer]));
  const personalIndex = targetIds.length ? await readPersonalWordIndex(user.uid) : new Map();
  const summary = {
    created: Number(session.saveWordSummary?.created) || 0,
    sourceLinked: Number(session.saveWordSummary?.sourceLinked) || 0,
    alreadyLinked: Number(session.saveWordSummary?.alreadyLinked) || 0,
    restoredReady: Number(session.saveWordSummary?.restoredReady) || 0,
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
        }
      );
      savedIds.add(String(id));
      if (result.created) summary.created += 1;
      else if (result.restoredReady) summary.restoredReady += 1;
      else if (result.sourceLinked) summary.sourceLinked += 1;
      else if (result.alreadyLinked) summary.alreadyLinked += 1;
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
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    const current = snapshot.data() || {};
    if (!snapshot.exists() || String(current.assessmentId || assessment) !== assessment) {
      throw journeyCloudError('level-placement/session-mismatch', 'Placement session changed.');
    }
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
  cache.levelPlacementSessions.delete(`${world}/${assessment}`);
  return {
    choice: selectedChoice,
    summary,
    failures,
    partial: failures.length > 0,
    saved: targetIds.length - failures.length,
    total: targetIds.length,
    session: await getLevelPlacementSession(world, assessment, { force: true }),
  };
}

async function finishLevelPlacement(worldId, assessmentId, action) {
  const user = requireUser();
  const world = core().cleanId(worldId, 'World');
  const assessment = levelPlacementCore().cleanId(assessmentId, 'Assessment');
  const pause = action === 'pause';
  const targetJourneyRef = journeyRef(user.uid, world);
  const sessionRef = levelPlacementSessionRef(user.uid, world, assessment);
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
      !['awaiting-decision', 'paused'].includes(session.status)
    ) {
      throw journeyCloudError('level-placement/session-mismatch', 'Placement session changed.');
    }
    transaction.update(sessionRef, {
      status: pause ? 'paused' : 'completed',
      ...(pause ? { pausedAt: serverTimestamp() } : { completedAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    });
    transaction.update(targetJourneyRef, {
      levelPlacementStatus: pause ? 'paused' : 'completed',
      ...(pause
        ? {}
        : { activeLevelPlacementAssessmentId: '', activeLevelPlacementCefrLevel: '' }),
      updatedAt: serverTimestamp(),
    });
  });
  resetCache(user.uid);
  const journey = await getJourney(world, { force: true });
  cache.active = journey;
  return journey;
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
    if (updatedWord?.mastery_status === 'Mastered') {
      clearTimeout(evaluationTimer);
      evaluationTimer = setTimeout(() => {
        evaluateActiveJourneyMastery().catch(() => {});
      }, 80);
    }
    return updatedWord;
  };
  Object.defineProperty(wrapped, '__lootlinguaJourneyMasteryHook', {
    value: true,
  });
  window.updateQuizWordInSource = wrapped;
}

const API = Object.freeze({
  getActiveJourney,
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
  getLevelPlacementSession,
  answerLevelPlacementQuestion,
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
} else {
  window.addEventListener('load', installJourneyMasteryHook, { once: true });
}

window.dispatchEvent(new CustomEvent('lootlingua:journey-cloud-ready'));
