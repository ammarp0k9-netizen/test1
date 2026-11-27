import { GUIDE_TOUR, mergeGuideCoverage } from './guide-coverage.mjs';
import { applyProfileIntent } from './profile-sync-policy.mjs?v=streak-migration-1';

export const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
export const time = value => number(value?.toMillis?.() ?? value);
export const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];
const unionMap = (target, source) => ({ ...source, ...target });
const maxMap = (target, source) => Object.fromEntries(union(Object.keys(target || {}), Object.keys(source || {}))
  .map(key => [key, Math.max(number(target?.[key]), number(source?.[key]))]));

export function mergeProfile(target, source, duplicateXP, consumedIds, countedGates) {
  const { profile: imported } = applyProfileIntent(target, { type: 'guest-import', profile: source }, { consumedExtraIds: consumedIds });
  const profile = { ...target };
  for (const [key, value] of Object.entries(imported)) {
    if (JSON.stringify(value) !== JSON.stringify(target[key])) profile[key] = value;
  }
  profile.userXP = number(target.userXP) + Math.max(0, number(source.userXP) - duplicateXP);
  for (const key of ['theme', 'oasisMode', 'interestIds', 'displayName', 'activeTitleId']) {
    if (target[key] == null && source[key] != null) profile[key] = source[key];
  }
  profile.themeIntroSeen = union(target.themeIntroSeen, source.themeIntroSeen);
  const coverage = mergeGuideCoverage(target.onboardingProgress?.[GUIDE_TOUR], source.onboardingProgress?.[GUIDE_TOUR]);
  if (coverage) profile.onboardingProgress = { ...target.onboardingProgress, [GUIDE_TOUR]: coverage };
  if (target.lootBots?.audio) profile.lootBots = { ...profile.lootBots, audio: { ...profile.lootBots?.audio, ...target.lootBots.audio } };
  if (profile.extraChests) profile.extraChests = profile.extraChests.filter(item => !consumedIds.has(String(item.id)));
  if (profile.extraChestState?.transferred) {
    profile.extraChestState.transferred = profile.extraChestState.transferred.filter(item => !consumedIds.has(String(item.id)));
  }
  // Previously counted gates remain counted once. Historical totals without
  // receipts are preserved without estimating the missing gate identities.
  if (target.motivationRewards || source.motivationRewards || countedGates.size) {
    const left = target.motivationRewards || {}, right = source.motivationRewards || {};
    const worlds = {};
    for (const key of union(union(Object.keys(left.worlds || {}), Object.keys(right.worlds || {})), countedGates.keys())) {
      const a = left.worlds?.[key] || {}, b = right.worlds?.[key] || {};
      worlds[key] = { ...b, ...a, worldId: key.slice(6), count: Math.max(number(a.count), number(b.count), countedGates.get(key) || 0) };
    }
    profile.motivationRewards = {
      version: 1, masteredKeys: union(left.masteredKeys, right.masteredKeys).slice(0, 100),
      worlds, rewards: unionMap(left.rewards, right.rewards),
    };
  }
  return profile;
}

const masteryOrder = ['New', 'Learning', 'Reviewing', 'Mastered'];
// Older dictionaries kept mastery on the personal word itself. Keep a
// complete historical state if no shared mastery entry has replaced it.
export function legacyWordMastery(words) {
  const entries = {};
  for (const word of words) {
    const streak = Math.min(3, Math.floor(number(word.mastery_streak ?? word.masteryStreak)));
    const status = word.mastery_status || word.masteryStatus || (streak === 3 ? 'Mastered' : masteryOrder[streak]);
    const known = masteryOrder.includes(status) ? status : 'New';
    if (known === 'New' && !word.mastered_once && !word.masteredOnce && !word.earnedTransitions?.length) continue;
    const wordKey = word.wordKey || globalThis.LootLinguaContentSchema.normalizeWordIdentity(word.word || word.text || '').wordKey;
    if (!wordKey) continue;
    const state = {
      mastery_status: known, mastery_streak: streak,
      last_recalled_at: word.last_recalled_at ?? word.lastRecalledAt ?? null,
      first_recalled_at: word.first_recalled_at ?? word.firstRecalledAt ?? null,
      last_recall_day: word.last_recall_day || word.lastRecallDay || '',
      last_recall_session_id: word.last_recall_session_id || word.lastRecallSessionId || '',
      last_quizzed_at: word.last_quizzed_at ?? word.lastQuizzedAt ?? null,
      quiz_seen_count: number(word.quiz_seen_count ?? word.quizSeenCount),
      mastered_once: Boolean(word.mastered_once || word.masteredOnce || known === 'Mastered'),
      firstMasteredAt: word.firstMasteredAt ?? null, hasEarnedMasteryXP: Boolean(word.hasEarnedMasteryXP || known === 'Mastered'),
      earnedTransitions: Array.isArray(word.earnedTransitions) ? word.earnedTransitions : [],
      remasteryAwardCount: number(word.remasteryAwardCount), xpEconomyVersion: number(word.xpEconomyVersion),
    };
    entries[wordKey] = mergeMastery({ [wordKey]: entries[wordKey] }, { [wordKey]: state })[wordKey];
  }
  return entries;
}

export function mergeMastery(target = {}, source = {}) {
  const entries = { ...target };
  for (const [key, incoming] of Object.entries(source)) {
    const current = entries[key];
    if (!current) { entries[key] = incoming; continue; }
    const stage = masteryOrder.indexOf(incoming.mastery_status) - masteryOrder.indexOf(current.mastery_status);
    const useSource = stage > 0 || (stage === 0 && time(incoming.last_recalled_at) > time(current.last_recalled_at));
    const best = useSource ? incoming : current;
    entries[key] = {
      ...best,
      earnedTransitions: union(current.earnedTransitions, incoming.earnedTransitions),
      mastered_once: current.mastered_once === true || incoming.mastered_once === true,
      hasEarnedMasteryXP: current.hasEarnedMasteryXP === true || incoming.hasEarnedMasteryXP === true,
      remasteryAwardCount: Math.max(number(current.remasteryAwardCount), number(incoming.remasteryAwardCount)),
    };
  }
  return entries;
}

export const evidenceFields = ['eligibleEvidenceCount', 'lastEligibleEvidenceAt', 'lastEvidenceEventId',
  'evidenceVersion', 'evidenceTimezoneOffsetMinutes', 'lastEvidenceLocalDayKey'];

export function mergeCanonical(target, source, legacyId, evidence) {
  if (!target && !legacyId) return null;
  const count = number(source.eligibleEvidenceCount);
  const event = evidence.get(source.lastEvidenceEventId);
  const supported = count === 0 || (count <= 3 && event?.sequence === count &&
    event.wordKey === source.wordKey && time(event.occurredAt) > 0 && time(event.occurredAt) === time(source.lastEligibleEvidenceAt));
  const result = target ? { ...target } : { ...source, legacyWordId: legacyId };
  if (!target && !supported) {
    for (const field of evidenceFields) delete result[field];
    result.eligibleEvidenceCount = 0;
    result.evidenceVersion = 1;
  } else if (supported && (count > number(target?.eligibleEvidenceCount) ||
      (count > 0 && count === number(target?.eligibleEvidenceCount) && time(source.lastEligibleEvidenceAt) > time(target?.lastEligibleEvidenceAt)))) {
    for (const field of evidenceFields) if (source[field] != null) result[field] = source[field];
  }
  // A dictionary import may have just created a canonical stub.
  if (!result.legacyWordId && legacyId) result.legacyWordId = legacyId;
  return result;
}

const stage = value => ['available', 'learning', 'ready', 'cleared', 'mastered'].indexOf(value?.status);
export function pickGate(target, source, attempts) {
  const attempt = attempts.get(source.lastClearAttemptId);
  if (stage(source) >= 3 && (source.clearedBy === 'gate-clear' || source.lastClearResult === 'passed')) {
    if (attempt && (attempt.status !== 'passed' || attempt.gateId !== source.gateId || attempt.rankId !== source.rankId)) return target;
    if (!attempt && !time(source.clearedAt)) return target;
  }
  if (!target || stage(source) > stage(target)) return source;
  if (stage(source) !== stage(target) || target.activeClearAttemptId) return target;
  if (source.activeClearAttemptId || number(source.evidenceStepCount) > number(target.evidenceStepCount)) return source;
  return target;
}

export function mergeJourney(target, source, order) {
  if (!target) return source;
  const position = row => order.get(`${row.activeRankId}/${row.activeGateId}`) ?? -1;
  const complete = row => row.contentJourneyStatus === 'completed-current-content' && Boolean(row.worldCompletion);
  const leading = position(source) > position(target) || (position(source) === position(target) && complete(source) && !complete(target)) ? source : target;
  return {
    ...leading,
    status: target.status,
    unlockedRankIds: union(target.unlockedRankIds, source.unlockedRankIds),
    unlockedGateIds: union(target.unlockedGateIds, source.unlockedGateIds),
    completedRankIds: union(target.completedRankIds, source.completedRankIds),
    rankCompletionVersions: maxMap(target.rankCompletionVersions, source.rankCompletionVersions),
    passedCefrLevels: union(target.passedCefrLevels, source.passedCefrLevels),
    partialCefrLevels: union(target.partialCefrLevels, source.partialCefrLevels),
    levelPlacementClearedGateIds: union(target.levelPlacementClearedGateIds, source.levelPlacementClearedGateIds),
    levelPlacementAssessmentIds: unionMap(leading.levelPlacementAssessmentIds,
      (leading === source ? target : source).levelPlacementAssessmentIds),
    ...(target.worldCompletion || source.worldCompletion ? { worldCompletion: target.worldCompletion || source.worldCompletion } : {}),
  };
}
