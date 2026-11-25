const DAY_MS = 86400000;
const dayFormat = /^\d{4}-\d{2}-\d{2}$/;
const formatters = new Map();

function calendarTime(day) {
  if (!dayFormat.test(day || '')) return NaN;
  const time = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : NaN;
}

function dateFormatter(timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    ...(timeZone ? { timeZone } : {}), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return formatters.get(timeZone);
}

export function streakTimeZone(profile, fallback) {
  for (const candidate of [profile?.streakState?.timeZone, fallback, Intl.DateTimeFormat().resolvedOptions().timeZone]) {
    if (typeof candidate !== 'string' || !candidate || candidate.length > 100) continue;
    try { return dateFormatter(candidate).resolvedOptions().timeZone; } catch (_) { /* Try the device zone. */ }
  }
  return 'UTC';
}

export function streakCalendar(at, timeZone) {
  const { year, month, day, hour, minute, second } = Object.fromEntries(dateFormatter(timeZone).formatToParts(at)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { today: `${year}-${month}-${day}`, minutesLeft: 1440 - Number(hour) * 60 - Number(minute) - Number(second) / 60 };
}

const count = value => Math.max(0, Math.floor(Number(value) || 0));

function latestDay(profile) {
  const active = profile.lastActivityDate;
  const settled = profile.streakState?.settledThrough;
  return Number.isFinite(calendarTime(settled)) && (!Number.isFinite(calendarTime(active)) || settled > active) ? settled : active;
}

export function needsStreakSettlement(profile, today) {
  return count(profile.dailyStreak) > 0 && calendarTime(today) - calendarTime(latestDay(profile)) > DAY_MS;
}

export function settleDailyStreak(profile, today, timeZone) {
  if (!needsStreakSettlement(profile, today)) return 0;
  const throughTime = calendarTime(today) - DAY_MS;
  const missed = (throughTime - calendarTime(latestDay(profile))) / DAY_MS;
  const used = Math.min(count(profile.streakFreezes), missed);
  if (used) {
    profile.streakFreezes = count(profile.streakFreezes) - used;
    profile.freezeSaves = count(profile.freezeSaves) + used;
  }
  if (used < missed) profile.dailyStreak = 0;
  profile.streakState = { timeZone, settledThrough: new Date(throughTime).toISOString().slice(0, 10) };
  return used;
}

export function recordDailyStreak(profile, day, timeZone, advanceAfterFreeze = true) {
  const last = profile.lastActivityDate;
  if (!Number.isFinite(calendarTime(day)) || (Number.isFinite(calendarTime(last)) && day <= last)) return 0;
  const frontier = latestDay(profile);
  if (Number.isFinite(calendarTime(frontier)) && day <= frontier) {
    // An already-protected day can still receive a late confirmation. The
    // range since the last activity was entirely protected if the streak lives.
    if (!count(profile.dailyStreak) || !count(profile.freezeSaves)) return 0;
    profile.streakFreezes = count(profile.streakFreezes) + 1;
    profile.freezeSaves = count(profile.freezeSaves) - 1;
    profile.dailyStreak = count(profile.dailyStreak) + 1;
    profile.lastActivityDate = day;
    profile.maxStreak = Math.max(count(profile.maxStreak), profile.dailyStreak);
    return 0;
  }
  const used = settleDailyStreak(profile, day, timeZone);
  if (!Number.isFinite(calendarTime(frontier))) profile.dailyStreak = 0;
  profile.dailyStreak = count(profile.dailyStreak) + (used && count(profile.dailyStreak) && !advanceAfterFreeze ? 0 : 1);
  profile.lastActivityDate = day;
  profile.maxStreak = Math.max(count(profile.maxStreak), profile.dailyStreak);
  profile.streakState = { timeZone, settledThrough: day };
  return used;
}

if (typeof window === 'object') {
  window.LootLinguaDailyStreak = Object.freeze({ streakTimeZone, streakCalendar, needsStreakSettlement, settleDailyStreak, recordDailyStreak });
}
