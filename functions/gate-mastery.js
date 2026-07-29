'use strict';

const MASTERY_STATUS = 'Mastered';
const ELIGIBLE_GATE_STATUSES = new Set(['learning', 'ready', 'cleared']);

function masteryStatus(entry) {
  return String(entry?.mastery_status || entry?.masteryStatus || '');
}

function newlyMasteredWordKeys(beforeData, afterData) {
  const before = beforeData?.entries && typeof beforeData.entries === 'object'
    ? beforeData.entries
    : {};
  const after = afterData?.entries && typeof afterData.entries === 'object'
    ? afterData.entries
    : {};
  return Object.keys(after).filter((wordKey) =>
    wordKey &&
    masteryStatus(after[wordKey]) === MASTERY_STATUS &&
    masteryStatus(before[wordKey]) !== MASTERY_STATUS
  );
}

function gateTargetFromSource(source) {
  if (source?.addedFrom !== 'published-gate') return null;
  const worldId = String(source.worldId || '');
  const rankId = String(source.rankId || '');
  const gateId = String(source.gateId || '');
  if (!worldId || !rankId || !gateId) return null;
  return { worldId, rankId, gateId };
}

function gateTargetKey(target) {
  return [target?.worldId, target?.rankId, target?.gateId].map(String).join('/');
}

function uniqueGateTargets(sources) {
  const targets = new Map();
  (Array.isArray(sources) ? sources : []).forEach((source) => {
    const target = gateTargetFromSource(source);
    if (target) targets.set(gateTargetKey(target), target);
  });
  return [...targets.values()];
}

function dedupeGateTargets(targets) {
  const unique = new Map();
  (Array.isArray(targets) ? targets : []).forEach((target) => {
    const normalized = {
      worldId: String(target?.worldId || ''),
      rankId: String(target?.rankId || ''),
      gateId: String(target?.gateId || ''),
    };
    if (!normalized.worldId || !normalized.rankId || !normalized.gateId) return;
    unique.set(gateTargetKey(normalized), normalized);
  });
  return [...unique.values()];
}

function effectiveLoadedWordKeys(progress, publishedWords) {
  if (!progress?.loadedAt || !ELIGIBLE_GATE_STATUSES.has(String(progress.status || ''))) {
    return [];
  }
  if (progress.placementClearedWithoutLoad === true) return [];
  const loadedWordKeys = new Set(
    (Array.isArray(progress.loadedWordKeys) ? progress.loadedWordKeys : [])
      .map(String)
      .filter(Boolean)
  );
  if (!loadedWordKeys.size) return [];
  const loadedContentWordIds = new Set(
    (Array.isArray(progress.loadedContentWordIds) ? progress.loadedContentWordIds : [])
      .map(String)
      .filter(Boolean)
  );
  const effective = new Set();
  (Array.isArray(publishedWords) ? publishedWords : []).forEach((word) => {
    if (!word || (word.status && word.status !== 'published')) return;
    const contentWordId = String(word.contentWordId || word.id || '');
    const wordKey = String(word.wordKey || '');
    if (!wordKey || !loadedWordKeys.has(wordKey)) return;
    if (loadedContentWordIds.size && !loadedContentWordIds.has(contentWordId)) return;
    effective.add(wordKey);
  });
  return [...effective];
}

function allWordsMastered(wordKeys, masteryEntries) {
  return wordKeys.length > 0 && wordKeys.every((wordKey) =>
    masteryStatus(masteryEntries?.[wordKey]) === MASTERY_STATUS
  );
}

function sameStringSet(left, right) {
  const a = new Set((Array.isArray(left) ? left : []).map(String).filter(Boolean));
  const b = new Set((Array.isArray(right) ? right : []).map(String).filter(Boolean));
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function shouldReconcileGateWrite(before, after) {
  if (!after?.loadedAt || !ELIGIBLE_GATE_STATUSES.has(String(after.status || ''))) return false;
  if (after.placementClearedWithoutLoad === true) return false;
  if (!before?.loadedAt || before?.placementClearedWithoutLoad === true) return true;
  return !sameStringSet(before.loadedWordKeys, after.loadedWordKeys) ||
    !sameStringSet(before.loadedContentWordIds, after.loadedContentWordIds);
}

function shouldReconcileContentWordWrite(before, after) {
  const beforePublished = before?.status === 'published';
  const afterPublished = after?.status === 'published';
  return beforePublished !== afterPublished ||
    (beforePublished && afterPublished && String(before?.wordKey || '') !== String(after?.wordKey || ''));
}

async function mapWithConcurrency(items, limit, worker) {
  const values = Array.isArray(items) ? items : [];
  const results = new Array(values.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, Number(limit) || 1), values.length) },
    run
  ));
  return results;
}

function createGateMasteryProjector(dependencies) {
  const listWordSources = dependencies?.listWordSources;
  const listContentWordMemberships = dependencies?.listContentWordMemberships;
  const commitGateMastery = dependencies?.commitGateMastery;
  if (typeof listWordSources !== 'function' || typeof commitGateMastery !== 'function') {
    throw new TypeError('Gate mastery projector dependencies are incomplete.');
  }

  async function reconcileTargets(uid, targets) {
    return mapWithConcurrency(dedupeGateTargets(targets), 10, (target) =>
      commitGateMastery(String(uid), target)
    );
  }

  async function projectMasteryTransitions(uid, beforeData, afterData) {
    const wordKeys = newlyMasteredWordKeys(beforeData, afterData);
    if (!wordKeys.length) return { wordKeys, gateCount: 0, results: [] };
    const sourcesByWord = await mapWithConcurrency(wordKeys, 10, (wordKey) =>
      listWordSources(String(uid), wordKey)
    );
    const targets = uniqueGateTargets(sourcesByWord.flat());
    const results = await reconcileTargets(uid, targets);
    return { wordKeys, gateCount: targets.length, results };
  }

  async function projectLoadedGate(uid, target, before, after) {
    if (!shouldReconcileGateWrite(before, after)) {
      return { gateCount: 0, results: [], skipped: true };
    }
    const results = await reconcileTargets(uid, [{
      worldId: String(target?.worldId || ''),
      rankId: String(target?.rankId || ''),
      gateId: String(target?.gateId || ''),
      addedFrom: 'published-gate',
    }]);
    return { gateCount: 1, results, skipped: false };
  }

  async function projectContentWordChange(target, before, after) {
    if (!shouldReconcileContentWordWrite(before, after) || typeof listContentWordMemberships !== 'function') {
      return { userCount: 0, gateCount: 0, results: [], skipped: true };
    }
    const memberships = await listContentWordMemberships(target);
    const byUser = new Map();
    (Array.isArray(memberships) ? memberships : []).forEach((membership) => {
      const uid = String(membership?.uid || '');
      if (!uid) return;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(membership.target);
    });
    const groups = [...byUser.entries()];
    const nestedResults = await mapWithConcurrency(groups, 10, ([uid, targets]) =>
      reconcileTargets(uid, targets)
    );
    return {
      userCount: groups.length,
      gateCount: nestedResults.reduce((total, results) => total + results.length, 0),
      results: nestedResults.flat(),
      skipped: false,
    };
  }

  return Object.freeze({
    projectMasteryTransitions,
    projectLoadedGate,
    projectContentWordChange,
    reconcileTargets,
  });
}

function createFirestoreGateMasteryDependencies({ db, FieldValue }) {
  function progressRef(uid, target) {
    return db.collection('users').doc(uid)
      .collection('contentProgress').doc(target.worldId)
      .collection('ranks').doc(target.rankId)
      .collection('gates').doc(target.gateId);
  }

  function publishedWordsQuery(target) {
    return db.collection('content_worlds').doc(target.worldId)
      .collection('ranks').doc(target.rankId)
      .collection('gates').doc(target.gateId)
      .collection('words').where('status', '==', 'published');
  }

  return {
    async listWordSources(uid, wordKey) {
      const snapshot = await db.collection('users').doc(uid)
        .collection('contentWords').doc(String(wordKey))
        .collection('sources').get();
      return snapshot.docs.map((document) => document.data() || {});
    },

    async listContentWordMemberships(target) {
      const snapshot = await db.collectionGroup('sources')
        .where('contentWordId', '==', String(target.contentWordId || ''))
        .get();
      return snapshot.docs.map((document) => {
        const source = document.data() || {};
        const path = document.ref.path.split('/');
        if (
          path[0] !== 'users' ||
          source.addedFrom !== 'published-gate' ||
          String(source.worldId || '') !== String(target.worldId || '') ||
          String(source.rankId || '') !== String(target.rankId || '') ||
          String(source.gateId || '') !== String(target.gateId || '')
        ) return null;
        return {
          uid: path[1],
          target: {
            worldId: String(source.worldId),
            rankId: String(source.rankId),
            gateId: String(source.gateId),
          },
        };
      }).filter(Boolean);
    },

    async commitGateMastery(uid, target) {
      const gateRef = progressRef(uid, target);
      const masteryRef = db.collection('users').doc(uid).collection('meta').doc('word_mastery');
      const wordsQuery = publishedWordsQuery(target);
      return db.runTransaction(async (transaction) => {
        const gateSnapshot = await transaction.get(gateRef);
        if (!gateSnapshot.exists) return { changed: false, reason: 'gate-missing', target };
        const progress = gateSnapshot.data() || {};
        if (progress.masteryComplete === true) {
          return { changed: false, masteryComplete: true, reason: 'already-complete', target };
        }
        if (
          !ELIGIBLE_GATE_STATUSES.has(String(progress.status || '')) ||
          !progress.loadedAt ||
          progress.placementClearedWithoutLoad === true
        ) {
          return { changed: false, reason: 'gate-ineligible', target };
        }

        const masterySnapshot = await transaction.get(masteryRef);
        const wordsSnapshot = await transaction.get(wordsQuery);
        const words = wordsSnapshot.docs.map((document) => ({
          contentWordId: document.id,
          ...(document.data() || {}),
        }));
        const wordKeys = effectiveLoadedWordKeys(progress, words);
        const entries = masterySnapshot.exists
          ? (masterySnapshot.data()?.entries || {})
          : {};
        if (!allWordsMastered(wordKeys, entries)) {
          return {
            changed: false,
            reason: wordKeys.length ? 'words-not-mastered' : 'no-effective-words',
            wordCount: wordKeys.length,
            target,
          };
        }
        transaction.update(gateRef, {
          masteryComplete: true,
          lastActivityAt: FieldValue.serverTimestamp(),
        });
        return {
          changed: true,
          masteryComplete: true,
          wordCount: wordKeys.length,
          target,
        };
      });
    },
  };
}

module.exports = {
  MASTERY_STATUS,
  ELIGIBLE_GATE_STATUSES,
  masteryStatus,
  newlyMasteredWordKeys,
  gateTargetFromSource,
  uniqueGateTargets,
  dedupeGateTargets,
  effectiveLoadedWordKeys,
  allWordsMastered,
  shouldReconcileGateWrite,
  shouldReconcileContentWordWrite,
  createGateMasteryProjector,
  createFirestoreGateMasteryDependencies,
};
