// Profile synchronization operations are not XP awards. XP remains owned by
// the existing XP-event transactions; only a receipted guest import can seed it.
const number = (value) => Math.max(0, Number(value) || 0);
const copy = (value) => JSON.parse(JSON.stringify(value));
const unique = (values = []) => [...new Set(values.filter(Boolean))];
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function calendarTime(day) {
  if (!dayPattern.test(day || '')) return NaN;
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? date.getTime() : NaN;
}
export const PROFILE_SYNC_VERSION = 1;
export function profileOperationId(intent) {
  if (intent.type === 'learning-day') return `learning-day:${intent.day}`;
  if (intent.eventId) return `${intent.type}:${intent.eventId}`;
  return null;
}
export function previousCalendarDay(day, amount = 1) {
  if (!dayPattern.test(day || '')) return '';
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - amount);
  return date.toISOString().slice(0, 10);
}
function learn(profile, day, advanceAfterFreeze = true) {
  if (!Number.isFinite(calendarTime(day)) || day <= String(profile.lastActivityDate || '')) return false;
  const last = profile.lastActivityDate || '';
  const missed = Math.floor((calendarTime(day) - calendarTime(last)) / 86400000) - 1;
  if (missed === 0) profile.dailyStreak = number(profile.dailyStreak) + 1;
  else if (missed > 0 && Number.isFinite(missed) && number(profile.streakFreezes) >= missed) {
    profile.streakFreezes = number(profile.streakFreezes) - missed;
    profile.freezeSaves = number(profile.freezeSaves) + missed;
    profile.dailyStreak = Math.max(1, number(profile.dailyStreak)) + (advanceAfterFreeze ? 1 : 0);
  } else profile.dailyStreak = 1;
  profile.lastActivityDate = day;
  profile.maxStreak = Math.max(number(profile.maxStreak), profile.dailyStreak);
  return true;
}
function quest(profile, day, patch) {
  if (!dayPattern.test(day || '')) return;
  const byDay = { ...(profile.dailyQuestsByDay || {}) };
  const old = byDay[day] || (profile.dailyQuestDate === day ? profile.dailyQuestState : null) || {};
  const state = {
    claimed: { ...(old.claimed || {}) }, flags: { ...(old.flags || {}) },
  };
  for (const field of ['claimed', 'flags']) {
    for (const [key, value] of Object.entries(patch?.[field] || {})) if (value === true) state[field][key] = true;
  }
  byDay[day] = state;
  // Keep legacy readers on the newest date; old queued claims never reset it.
  profile.dailyQuestsByDay = Object.fromEntries(Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a)).slice(0, 60));
  if (!profile.dailyQuestDate || day >= profile.dailyQuestDate) {
    profile.dailyQuestDate = day;
    profile.dailyQuestState = state;
  }
}
function lootOpen(profile, intent) {
  const loot = { ...(profile.dailyLootState || {}) };
  const at = number(intent.at);
  if (number(loot.lockedXP) > 0) return 'chest-locked';
  if (number(loot.lastOpenAt) > 0 && at < number(loot.lastOpenAt) + 24 * 60 * 60 * 1000) return 'chest-cooldown';
  const reward = intent.reward || {};
  if (reward.type === 'freeze' && number(reward.freezes) === 1) {
    profile.streakFreezes = number(profile.streakFreezes) + 1;
    loot.freezesEarned = number(loot.freezesEarned) + 1;
  } else if (reward.type === 'xp' && number(reward.xp) > 0 && number(reward.xp) <= 50) {
    loot.lockedXP = number(reward.xp);
    loot.lockStartedAt = at;
    loot.lockResolvedAt = 0;
    loot.lockMasteredWordIds = [];
    loot.lockHighAccuracyQuizIds = [];
  } else return 'invalid-reward';
  if (loot.lastOpenDay !== intent.day) {
    loot.streak = loot.lastOpenDay === previousCalendarDay(intent.day) ? number(loot.streak) + 1 : 1;
  }
  loot.lastOpenDay = intent.day;
  loot.lastOpenAt = at;
  loot.totalOpens = number(loot.totalOpens) + 1;
  loot.rewards = [{ at, ...reward }, ...(loot.rewards || [])].slice(0, 12);
  profile.dailyLootState = loot;
  quest(profile, intent.day, { flags: { openLoot: true } });
  return '';
}
export function applyProfileIntent(remote, intent, context = {}) {
  const profile = copy(remote || {});
  const before = JSON.stringify(profile);
  let reason = '';
  const effects = {};
  switch (intent.type) {
    case 'acknowledge': break;
    case 'wallet-delta': {
      if (!['runnerCoins', 'streakFreezes'].includes(intent.field) || !Number.isFinite(intent.amount)) { reason = 'invalid-wallet'; break; }
      const balance = number(profile[intent.field]) + intent.amount;
      if (balance < 0) { reason = 'insufficient-balance'; break; }
      profile[intent.field] = balance;
      break;
    }
    case 'learning-day': learn(profile, intent.day, intent.advanceAfterFreeze !== false); break;
    case 'quiz-activity': {
      if (!dayPattern.test(intent.day || '') || !(number(intent.answers) > 0)) { reason = 'invalid-activity'; break; }
      profile.activityMap = { ...(profile.activityMap || {}), [intent.day]: number(profile.activityMap?.[intent.day]) + number(intent.answers) };
      if (intent.perfect) {
        profile.perfectQuizzes = number(profile.perfectQuizzes) + 1;
        quest(profile, intent.day, { flags: { perfectQuiz: true } });
      }
      learn(profile, intent.day, intent.advanceAfterFreeze !== false);
      break;
    }
    case 'counter-delta':
      if (['gameDictAdds', 'perfectQuizzes', 'freezeSaves'].includes(intent.field) && number(intent.amount) > 0) {
        profile[intent.field] = number(profile[intent.field]) + number(intent.amount);
      } else reason = 'invalid-counter';
      break;
    case 'max':
      if (['maxStreak', 'runnerBestDistance', 'xpEconomyVersion'].includes(intent.field)) {
        profile[intent.field] = Math.max(number(profile[intent.field]), number(intent.value));
      } else reason = 'invalid-max';
      break;
    case 'quest': quest(profile, intent.day, intent.state); break;
    case 'titles': {
      const old = profile.titlesState || {};
      const timestamps = { ...(old.lastUnlockedAt || {}) };
      for (const [key, value] of Object.entries(intent.state?.lastUnlockedAt || {})) timestamps[key] = Math.max(number(timestamps[key]), number(value));
      profile.titlesState = { unlocked: unique([...(old.unlocked || []), ...(intent.state?.unlocked || [])]), lastUnlockedAt: timestamps };
      break;
    }
    case 'union':
      if (['addedGameWords', 'themeIntroSeen'].includes(intent.field)) profile[intent.field] = unique([...(profile[intent.field] || []), ...(intent.values || [])]);
      else reason = 'invalid-union';
      break;
    case 'appearance':
      for (const key of ['theme', 'oasisMode', 'displayName', 'activeTitleId']) if (Object.hasOwn(intent.patch || {}, key)) profile[key] = intent.patch[key];
      if (intent.patch?.themeIntroSeen) profile.themeIntroSeen = unique([...(profile.themeIntroSeen || []), ...intent.patch.themeIntroSeen]);
      break;
    case 'exposure': {
      const byId = new Map((profile.quizExposureHistory || []).map((entry) => [entry.sessionId, entry]));
      for (const entry of intent.entries || []) if (entry.sessionId && number(entry.at) >= number(byId.get(entry.sessionId)?.at)) byId.set(entry.sessionId, entry);
      profile.quizExposureHistory = [...byId.values()].sort((a, b) => number(b.at) - number(a.at)).slice(0, 3);
      break;
    }
    case 'loot-open': reason = lootOpen(profile, intent); break;
    case 'loot-progress': {
      const loot = { ...(profile.dailyLootState || {}) };
      const lockId = number(loot.lockStartedAt) || number(loot.lastOpenAt);
      if (!number(loot.lockedXP) || lockId !== number(intent.lockId)) break;
      loot.lockMasteredWordIds = unique([...(loot.lockMasteredWordIds || []), ...(intent.mastered || [])]);
      loot.lockHighAccuracyQuizIds = unique([...(loot.lockHighAccuracyQuizIds || []), ...(intent.quizzes || [])]);
      if (intent.resolved) {
        if (!context.confirmedXP) { reason = 'xp-not-confirmed'; break; }
        loot.lockedXP = 0; loot.lockStartedAt = 0; loot.lockResolvedAt = number(intent.at);
        loot.lockMasteredWordIds = []; loot.lockHighAccuracyQuizIds = [];
      }
      profile.dailyLootState = loot;
      break;
    }
    case 'extra-add': {
      const existing = new Map((profile.extraChests || []).map((chest) => [String(chest.id), chest]));
      for (const chest of intent.chests || []) if (chest.id && !context.consumedExtraIds?.has(String(chest.id)) && !existing.has(String(chest.id))) existing.set(String(chest.id), chest);
      profile.extraChests = [...existing.values()];
      break;
    }
    case 'extra-remove': {
      const id = String(intent.chestId || '');
      const chest = (profile.extraChests || []).find((item) => String(item.id) === id);
      if (!chest || context.consumedExtraIds?.has(id)) { reason = 'extra-chest-unavailable'; break; }
      profile.extraChests = (profile.extraChests || []).filter((item) => String(item.id) !== id);
      effects.consumedExtraId = id;
      break;
    }
    case 'guest-import': {
      // A durable receipt, scoped by the immutable guest snapshot ID, protects
      // this import even after local recovery markers have been finalized.
      const guest = intent.profile || {};
      profile.userXP = Math.max(number(profile.userXP), number(guest.userXP));
      for (const field of ['runnerCoins', 'streakFreezes']) profile[field] = number(profile[field]) + number(guest[field]);
      for (const field of ['freezeSaves', 'gameDictAdds', 'perfectQuizzes', 'maxStreak', 'runnerBestDistance']) profile[field] = Math.max(number(profile[field]), number(guest[field]));
      if (String(guest.lastActivityDate || '') > String(profile.lastActivityDate || '')) {
        profile.lastActivityDate = guest.lastActivityDate;
        profile.dailyStreak = number(guest.dailyStreak);
      }
      for (const [day, amount] of Object.entries(guest.activityMap || {})) profile.activityMap = { ...(profile.activityMap || {}), [day]: Math.max(number(profile.activityMap?.[day]), number(amount)) };
      profile.addedGameWords = unique([...(profile.addedGameWords || []), ...(guest.addedGameWords || [])]);
      const titles = applyProfileIntent(profile, { type: 'titles', state: guest.titlesState || {} }).profile;
      profile.titlesState = titles.titlesState;
      const extras = applyProfileIntent(profile, { type: 'extra-add', chests: guest.extraChests || [] }, context).profile;
      profile.extraChests = extras.extraChests;
      if (!profile.dailyLootState && guest.dailyLootState) profile.dailyLootState = copy(guest.dailyLootState);
      if (guest.dailyQuestDate) quest(profile, guest.dailyQuestDate, guest.dailyQuestState);
      break;
    }
    default: reason = 'unsupported-intent';
  }
  return { profile: reason ? copy(remote || {}) : profile, applied: !reason && JSON.stringify(profile) !== before, reason, effects: reason ? {} : effects };
}

export function profileStorageIntents(key, beforeText, afterText) {
  let before, after;
  try { before = JSON.parse(beforeText || 'null'); after = JSON.parse(afterText || 'null'); } catch { return []; }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (key === 'lootlinguaMaxStreak') return [{ type: 'max', field: 'maxStreak', value: after }];
  if (key === 'lootlinguaTitlesState') return [{ type: 'titles', state: after }];
  if (key === 'addedGameWords') return [{ type: 'union', field: 'addedGameWords', values: (after || []).filter((item) => !(before || []).includes(item)) }];
  if (key.startsWith('lootlinguaDailyQuests_')) return [{ type: 'quest', day: key.slice('lootlinguaDailyQuests_'.length), state: after }];
  if (key === 'lootlinguaExtraChests') {
    const added = (after || []).filter((chest) => !(before || []).some((old) => old.id === chest.id));
    const removed = (before || []).filter((chest) => !(after || []).some((item) => item.id === chest.id));
    return [...(added.length ? [{ type: 'extra-add', chests: added }] : []), ...removed.map((chest) => ({ type: 'extra-remove', chestId: chest.id }))];
  }
  if (key === 'lootlinguaDailyLootState' && before && after) {
    const lockId = number(before.lockStartedAt) || number(before.lastOpenAt);
    if (!lockId) return [];
    return [{ type: 'loot-progress', lockId, mastered: after.lockMasteredWordIds || [], quizzes: after.lockHighAccuracyQuizIds || [], resolved: number(before.lockedXP) > 0 && number(after.lockedXP) === 0, at: after.lockResolvedAt || 0 }];
  }
  return [];
}
