import { FieldValue } from 'firebase-admin/firestore';
import '../js/content-schema.js';
import '../js/level-placement.js';
import '../js/journey.js';

const placement = globalThis.LootLinguaLevelPlacement;
const schema = globalThis.LootLinguaContentSchema;
const journeyCore = globalThis.LootLinguaJourney;
const levels = schema.CEFR_LEVELS.filter(level => level !== 'unclassified');
const union = (earlier = [], incoming = []) => [...new Set([...earlier, ...incoming])];
const sameOrder = (left, right) => Array.isArray(left) && left.length === right.length &&
  left.every((value, index) => value === right[index]);

function requireValid(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'level-placement/unverified-outcome' });
}

export function calculateLevelPlacementReceipt({ session, journey, rankBundles, historicalSessions = [], progressByRank }) {
  const { worldId, assessmentId, cefrLevel, assessmentSeed } = session;
  requireValid(session.placementVersion === 2 &&
    ['paused', 'awaiting-decision'].includes(session.status) && !session.resultApplied &&
    journey.worldId === worldId && journey.status === 'active' &&
    journey.activeLevelPlacementAssessmentId === assessmentId &&
    journey.activeLevelPlacementCefrLevel === cefrLevel &&
    assessmentId === placement.assessmentId(worldId, cefrLevel, assessmentSeed),
  'This assessment is no longer the active attempt for the journey.');

  const ranks = journeyCore.stableRankOrder(rankBundles.map(bundle => bundle.rank));
  const gatesByRank = new Map(rankBundles.map(({ rank, gates }) => [
    rank.rankId, journeyCore.stableContentOrder(gates.map(({ gate }) => gate), 'gateId')
  ]));
  const levelRanks = ranks.filter(rank => schema.normalizeCefrLevel(rank.cefrLevel) === cefrLevel);
  const history = placement.deriveLegacyRankCoverage({
    cefrLevel, journey, ranks: levelRanks, gatesByRank, progressByRank,
    sessions: historicalSessions.filter(attempt => attempt.resultApplied === true)
  });
  requireValid(['full-level', 'new-ranks'].includes(session.assessmentMode) &&
    (session.assessmentMode === 'new-ranks'
      ? (journey.passedCefrLevels || []).includes(cefrLevel)
      : placement.canStartLevelPlacement(cefrLevel, journey)),
  'Journey history does not authorize this Level Placement.');

  const testedRanks = session.assessmentMode === 'new-ranks'
    ? placement.getUnassessedPublishedRanks(cefrLevel, levelRanks, history) : levelRanks;
  const eligible = new Set(testedRanks.map(rank => rank.rankId));
  const sample = placement.buildLevelSample({
    cefrLevel, assessmentSeed, rankBundles: rankBundles.filter(bundle => eligible.has(bundle.rank.rankId))
  });
  requireValid(sameOrder(session.orderedRankIds, sample.orderedRankIds) &&
    sameOrder(session.selectedContentWordIds, sample.selectedContentWordIds) &&
    sample.orderedRankIds.every(id => session.rankVersions?.[id] === sample.rankVersions[id]) &&
    Array.isArray(session.answers) && session.answers.length === session.currentQuestionIndex &&
    session.answers.length <= placement.LEVEL_PLACEMENT_CONFIG.maximumTotalQuestions,
  'The saved assessment cannot be matched to its published question set.');

  let verified = { ...sample, assessmentMode: session.assessmentMode, status: 'active',
    answers: [], currentQuestionIndex: 0, correctCount: 0, adaptiveRound: 0, adaptiveRankIds: [] };
  for (const answer of session.answers) {
    const expected = verified.selectedWords.find(word => word.questionId === verified.orderedQuestionIds[verified.currentQuestionIndex]);
    requireValid(expected && ['questionId', 'rankId', 'gateId', 'contentWordId', 'wordKey'].every(key =>
      answer[key] === expected[key]), 'A saved answer does not match the published question.');
    verified = placement.answerSession(verified, answer.selectedQuestionId);
    if (verified.currentQuestionIndex === verified.orderedQuestionIds.length) {
      verified = placement.finalizeRound(verified);
    }
  }
  requireValid(verified.status === 'awaiting-decision' &&
    sameOrder(session.orderedQuestionIds, verified.orderedQuestionIds) && session.answersCompletedAt,
  'The saved assessment has unanswered questions.');

  let nextTarget = null;
  if (verified.passedLevel) {
    for (const level of levels.slice(levels.indexOf(cefrLevel) + 1)) {
      const rank = ranks.find(candidate => schema.normalizeCefrLevel(candidate.cefrLevel) === level &&
        gatesByRank.get(candidate.rankId)?.length);
      if (!rank) continue;
      nextTarget = { rank, gate: gatesByRank.get(rank.rankId)[0], cefrLevel: level };
      break;
    }
  }
  const result = journeyCore.planPlacementOutcome({ session: verified, journey, nextLevelTarget: nextTarget, gatesByRank });
  const passedLevels = union(journey.passedCefrLevels, verified.passedLevel ? [cefrLevel] : [])
    .sort((left, right) => schema.getCefrLevelOrder(left) - schema.getCefrLevelOrder(right));
  const partialLevels = union(journey.partialCefrLevels,
    !verified.passedLevel && verified.passedRankIds.length ? [cefrLevel] : [])
    .filter(level => !passedLevels.includes(level));
  const sessionResult = {
    status: 'completed', resultApplied: true, correctCount: verified.correctCount,
    passedLevel: verified.passedLevel, passedRankIds: verified.passedRankIds,
    passedPrefixLength: verified.passedPrefixLength, perRankStats: verified.perRankStats,
    recommendedStartRankId: verified.recommendedStartRankId, recommendedStartGateId: verified.recommendedStartGateId,
    nextCefrLevel: nextTarget?.cefrLevel || '', resultStartRankId: result.destination.rankId,
    resultStartGateId: result.destination.gateId, completedCurrentContent: result.completedCurrentContent,
    resultUnlockedRankIds: result.resultUnlockedRankIds, resultUnlockedGateIds: result.resultUnlockedGateIds,
    resultClearedGateIds: result.resultClearedGateIds,
  };
  const journeyResult = {
    activeRankId: result.destination.rankId || journey.activeRankId,
    activeGateId: result.destination.gateId || journey.activeGateId,
    unlockedRankIds: union(journey.unlockedRankIds, result.resultUnlockedRankIds),
    unlockedGateIds: union(journey.unlockedGateIds, result.resultUnlockedGateIds),
    passedCefrLevels: passedLevels, partialCefrLevels: partialLevels,
    levelPlacementAssessmentIds: { ...journey.levelPlacementAssessmentIds, [cefrLevel]: assessmentId },
    levelPlacementPassedRankIds: union(journey.levelPlacementPassedRankIds, verified.passedRankIds),
    levelPlacementClearedGateIds: union(journey.levelPlacementClearedGateIds, result.resultClearedGateIds),
    levelPlacementStatus: 'completed', activeLevelPlacementAssessmentId: '', activeLevelPlacementCefrLevel: '',
    contentJourneyStatus: result.completedCurrentContent ? 'completed-current-content' : 'in-progress',
  };
  const worldCompletion = result.completedCurrentContent && !journey.worldCompletion
    ? journeyCore.createWorldCompletionAchievement({ worldId, ranks, completedBy: 'level-placement' })
    : null;
  return { sessionResult, journeyResult, worldCompletion };
}

// The caller supplies an authenticated UID and an Admin SDK instance. No client
// result payload participates in the decision. This writes only the receipt.
export function issueLevelPlacementReceipt(db, uid, worldId, assessmentId) {
  const owner = journeyCore.cleanId(uid, 'Owner');
  const world = journeyCore.cleanId(worldId, 'World');
  const id = placement.cleanId(assessmentId, 'Assessment');
  const journeyRef = db.doc(`users/${owner}/contentProgress/${world}`);
  const sessionRef = journeyRef.collection('levelPlacementSessions').doc(id);
  const receiptRef = journeyRef.collection('levelPlacementOutcomeReceipts').doc(id);
  const worldRef = db.doc(`content_worlds/${world}`);
  const published = ref => ref.where('status', '==', 'published');

  return db.runTransaction(async transaction => {
    const [journeyRow, sessionRow, worldRow, ranks, sessions] = await Promise.all([
      transaction.get(journeyRef), transaction.get(sessionRef), transaction.get(worldRef),
      transaction.get(published(worldRef.collection('ranks'))),
      transaction.get(journeyRef.collection('levelPlacementSessions'))
    ]);
    const journey = journeyRow.data();
    const session = sessionRow.data();
    requireValid(journey && session && worldRow.data()?.status === 'published' && session.assessmentId === id,
      'The account, content, or attempt could not be verified.');
    if (session.resultApplied === true && session.status === 'completed') return { alreadyApplied: true };
    const progressByRank = new Map();
    const rankBundles = await Promise.all(ranks.docs.map(async rankDoc => {
      const rank = { ...rankDoc.data(), rankId: rankDoc.id };
      const [gates, progress] = await Promise.all([
        transaction.get(published(rankDoc.ref.collection('gates'))),
        transaction.get(journeyRef.collection('ranks').doc(rankDoc.id).collection('gates'))
      ]);
      progressByRank.set(rankDoc.id, progress.docs.map(item => ({ ...item.data(), gateId: item.id })));
      const bundles = await Promise.all(gates.docs.map(async gateDoc => {
        const words = schema.normalizeCefrLevel(rank.cefrLevel) === session.cefrLevel
          ? await transaction.get(published(gateDoc.ref.collection('words'))) : null;
        return { gate: { ...gateDoc.data(), gateId: gateDoc.id },
          words: (words?.docs || []).map(item => ({ ...item.data(), contentWordId: item.id })) };
      }));
      return { rank, gates: bundles };
    }));
    const outcome = calculateLevelPlacementReceipt({ session, journey, rankBundles, progressByRank,
      historicalSessions: sessions.docs.filter(item => item.id !== id).map(item => item.data()) });
    transaction.set(receiptRef, {
      ...outcome, sessionBefore: session, journeyBefore: journey, approvedAt: FieldValue.serverTimestamp()
    });
    return { alreadyApplied: false };
  });
}
