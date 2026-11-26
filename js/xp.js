// XP & GAMIFICATION
// ═══════════════════════════════════════════════════════
const XP_RANKS = [
  {min:0,   max:25,       label:'Noob',     iconClass:'fa-solid fa-seedling', color:'var(--text-gray)'},
  {min:26,  max:49,       label:'Wanderer', iconClass:'fa-solid fa-compass', color:'var(--header-grad)'},
  {min:50,  max:79,       label:'Learner',  iconClass:'fa-solid fa-book-open', color:'var(--accent)'},
  {min:80,  max:149,      label:'Explorer', iconClass:'fa-solid fa-binoculars', color:'var(--accent2)'},
  {min:150, max:249,      label:'Pro',      iconClass:'fa-solid fa-award', color:'var(--success)'},
  {min:250, max:399,      label:'Veteran',  iconClass:'fa-solid fa-shield-halved', color:'var(--success)'},
  {min:400, max:599,      label:'Elite',    iconClass:'fa-solid fa-fire', color:'var(--star)'},
  {min:600, max:899,      label:'Master',   iconClass:'fa-solid fa-star', color:'var(--star)'},
  {min:900, max:1299,     label:'Legend',   iconClass:'fa-solid fa-crown', color:'var(--accent)'},
  {min:1300,max:2999, label:'Linguaer', iconClass:'fa-solid fa-brain', color:'var(--accent2)'},
  {min:3000,max:5679, label:'Wordsmith', iconClass:'fa-solid fa-graduation-cap', color:'var(--star)'},
  {min:5680,max:9769, label:'Linguist', iconClass:'fa-solid fa-pen-fancy', color:'var(--accent2)'},
  {min:9770,max:Infinity, label:'Virtuoso', iconClass:'fa-solid fa-trophy', color:'var(--success)'},

];

// userXP already declared in State section above — just reload from localStorage
userXP = loadInt('userXP', 0);

function getRank(xp)     { return [...XP_RANKS].reverse().find(r=>xp>=r.min)||XP_RANKS[0]; }
function getNextRank(xp) { return XP_RANKS.find(r=>r.min>xp)||null; }

const THEME_UNLOCK_LEVELS = {
  lootlingua: 1,
  golden: 2,
  scroll: 3,
  // Oasis is a core appearance choice in Product Entry, not an XP reward.
  ocean: 1,
  glass: 5,
};

const THEME_DISPLAY_NAMES = {
  lootlingua: 'LootLingua',
  golden: 'الكنز الذهبي',
  scroll: 'المخطوطة القديمة',
  ocean: 'واحة الهدوء',
  glass: 'الثيم الزجاجي',
};

/** ثيمات/ميزات معطّلة مؤقتاً — تظهر باهتة مع «قريباً» */
const THEMES_COMING_SOON = new Set(['glass']);
function isThemeComingSoon(theme) {
  return THEMES_COMING_SOON.has(theme);
}

function getThemeDisplayName(theme) {
  return THEME_DISPLAY_NAMES[theme] || theme;
}

function showGlassThemeComingSoonMessage() {
  showToast(`«${getThemeDisplayName('glass')}» قريباً — ما زال قيد التطوير. ترقّب التحديث! ✨`, 'warning');
}

function ensureThemeStatusLabel(opt) {
  let label = opt.querySelector('.theme-status-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'theme-status-label';
    label.setAttribute('aria-hidden', 'true');
    opt.appendChild(label);
  }
  return label;
}

function updateThemeOptionLabels(opt, theme, comingSoon, unlocked) {
  const displayName = getThemeDisplayName(theme);
  const nameEl = opt.querySelector('.theme-display-name') || opt.querySelector('.theme-name');
  if (nameEl) nameEl.textContent = displayName;

  const label = ensureThemeStatusLabel(opt);
  const required = THEME_UNLOCK_LEVELS[theme] || 1;

  if (comingSoon) {
    label.className = 'theme-status-label theme-status-label--soon';
    label.textContent = 'قريباً';
    label.removeAttribute('aria-hidden');
    opt.title = `${displayName} — قريباً (غير متاح بعد)`;
  } else if (!unlocked) {
    label.className = 'theme-status-label theme-status-label--level';
    label.textContent = `مقفل — Level ${required}`;
    label.removeAttribute('aria-hidden');
    opt.title = `${displayName} — يفتح عند Level ${required}`;
  } else {
    label.className = 'theme-status-label theme-status-label--open';
    label.textContent = '';
    label.setAttribute('aria-hidden', 'true');
  }
}

function getLevelFromXP(xp) {
  const level = XP_RANKS.filter(r => xp >= r.min).length;
  return Math.max(1, level);
}

function isThemeUnlocked(theme) {
  if (isThemeComingSoon(theme)) return false;
  const required = THEME_UNLOCK_LEVELS[theme] || 1;
  return getLevelFromXP(userXP) >= required;
}

function getThemeLockedMessage(theme) {
  const name = getThemeDisplayName(theme);
  const required = THEME_UNLOCK_LEVELS[theme] || 1;
  return required === 1
    ? `${name} متاح الآن.`
    : `${name} مقفل — ارفع مستواك إلى Level ${required} لفتحه`;
}

function refreshThemeLockUI() {
  const suppressUnlockNotice = shouldSuppressUnlockNotices();
  let activeThemeLocked = false;
  const activeTheme = localStorage.getItem('theme') || document.documentElement.getAttribute('data-theme') || 'lootlingua';

  document.querySelectorAll('.theme-option').forEach(opt => {
    const theme = opt.dataset.theme;
    const comingSoon = isThemeComingSoon(theme);
    const unlocked = isThemeUnlocked(theme);
    opt.classList.toggle('theme-coming-soon', comingSoon);
    opt.classList.toggle('theme-locked', !unlocked && !comingSoon);
    opt.classList.toggle('theme-locked-level', !unlocked && !comingSoon);
    opt.setAttribute('aria-disabled', unlocked && !comingSoon ? 'false' : 'true');
    updateThemeOptionLabels(opt, theme, comingSoon, unlocked);
    if (comingSoon) opt.classList.remove('active');
    else if (unlocked) opt.removeAttribute('title');
    if (theme === activeTheme && (!unlocked || comingSoon)) activeThemeLocked = true;
  });

  if (activeThemeLocked) {
    document.documentElement.setAttribute('data-theme', 'lootlingua');
    localStorage.setItem('theme', 'lootlingua');
    document.querySelectorAll('.theme-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.theme === 'lootlingua');
    });
    if (!suppressUnlockNotice) {
      const noticeKey = `lootlingua:themeRelockNotice:${activeTheme}`;
      if (!sessionStorage.getItem(noticeKey)) {
        sessionStorage.setItem(noticeKey, '1');
        setTimeout(() => showToast('الثيم هذا رجع للخزنة مؤقتًا. ارجع ارفع مستواك وبتفتحه من جديد.', 'warning', 5600), 600);
      }
    }
  }
  const selectedTheme = document.documentElement.getAttribute('data-theme') || 'lootlingua';
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.setAttribute('aria-pressed', String(!isThemeComingSoon(opt.dataset.theme) && opt.dataset.theme === selectedTheme));
  });
}

const XP_ECONOMY_VERSION = 2;
const XP_REWARDS = Object.freeze({
  newToLearning: 2,
  learningToReviewing: 4,
  reviewingToMastered: 8,
  remastered: 3,
});
const XP_EVENT_LOG_KEY = 'lootlinguaXpEventLog';
const PENDING_XP_EVENTS_KEY = 'lootlinguaPendingXpEvents';
const xpAwardsInFlight = new Set();
function captureXPAwardOwner() {
  return {
    uid: window.auth?.currentUser?.uid || '',
    generation: Number(window.__lootlinguaAuthGeneration) || 0,
  };
}

function isXPAwardOwnerCurrent(owner) {
  return owner.uid === (window.auth?.currentUser?.uid || '') &&
    owner.generation === (Number(window.__lootlinguaAuthGeneration) || 0);
}

function xpAwardInFlightKey(owner, eventId) {
  return JSON.stringify([owner.uid, owner.generation, eventId]);
}
const XP_ALLOWED_REASONS = new Set([
  'word_transition_new_learning',
  'word_transition_learning_reviewing',
  'word_mastered_first',
  'word_remastered',
  'daily_chest_unlock',
]);
const XP_REASON_AMOUNTS = Object.freeze({
  word_transition_new_learning: XP_REWARDS.newToLearning,
  word_transition_learning_reviewing: XP_REWARDS.learningToReviewing,
  word_mastered_first: XP_REWARDS.reviewingToMastered,
  word_remastered: XP_REWARDS.remastered,
});

function getXPEventLogStorageKey() {
  return `${XP_EVENT_LOG_KEY}_${getStorageUserId()}`;
}

function getPendingXPEventsStorageKey() {
  return `${PENDING_XP_EVENTS_KEY}_${getStorageUserId()}`;
}
window.LootLinguaOperations?.setSyncSource?.('xp', uid => ({
  pending: (loadJSON(`${PENDING_XP_EVENTS_KEY}_${uid}`, []) || []).length,
}));

function queuePendingXPEvent(amount, reason, metadata) {
  if (!metadata?.queueOnFailure || !metadata.eventId) return;
  const key = getPendingXPEventsStorageKey();
  const pending = loadJSON(key, []);
  if (pending.some(event => event?.eventId === metadata.eventId)) return;
  try { saveJSON(key, [...pending, {
    amount,
    reason,
    eventId: metadata.eventId,
    wordKey: metadata.wordKey || '',
    sessionId: metadata.sessionId || '',
  }]);
    window.LootLinguaOperations?.syncStorageFailure?.(getStorageUserId(), 'xp', false);
  } catch (error) {
    window.LootLinguaOperations?.syncStorageFailure?.(getStorageUserId(), 'xp', true);
    throw error;
  }
}

async function retryPendingXPEvents() {
  const owner = captureXPAwardOwner();
  const key = getPendingXPEventsStorageKey();
  const pending = loadJSON(key, []);
  if (!Array.isArray(pending) || !pending.length) return;
  if (window.LootLinguaCloudBackoff?.reason?.()) return;
  const confirmed = new Set();
  for (const event of pending) {
    if (!isXPAwardOwnerCurrent(owner)) return;
    const metadata = { ...event, queueOnFailure: false };
    await awardXP(event.amount, event.reason, metadata);
    if (!isXPAwardOwnerCurrent(owner)) return;
    if (metadata.awardStatus === 'awarded' || metadata.awardStatus === 'duplicate') confirmed.add(event.eventId);
    if (window.LootLinguaCloudBackoff?.reason?.()) break;
  }
  if (!isXPAwardOwnerCurrent(owner)) return;
  if (confirmed.size) saveJSON(key, loadJSON(key, []).filter(event => !confirmed.has(event.eventId)));
  window.LootLinguaOperations?.syncNotify?.();
}
window.retryPendingXPEvents = () => {
  const owner = captureXPAwardOwner();
  if (!owner.uid) return Promise.resolve();
  return window.navigator?.locks
    ? window.navigator.locks.request('lootlingua:xp:' + owner.uid, { ifAvailable: true }, lock => lock && retryPendingXPEvents())
    : window.LootLinguaOperations?.runExclusive?.('xp:' + owner.uid, retryPendingXPEvents) || retryPendingXPEvents();
};
window.addEventListener('online', () => {
  window.retryPendingXPEvents();
  evaluateChestXPUnlock();
});
let xpCapacityRetry;
window.addEventListener('lootlingua:cloud-capacity-change', () => {
  clearTimeout(xpCapacityRetry);
  if (!loadJSON(getPendingXPEventsStorageKey(), []).length) return;
  xpCapacityRetry = setTimeout(() => window.retryPendingXPEvents(), Math.max(800, window.LootLinguaCloudBackoff?.remaining() || 0));
});

function recordXPEvent(reason, amount, metadata = {}) {
  const storageKey = getXPEventLogStorageKey();
  const current = loadJSON(storageKey, []);
  const event = {
    reason,
    amount,
    at: Date.now(),
    eventId: String(metadata.eventId || ''),
    wordKey: String(metadata.wordKey || ''),
    sessionId: String(metadata.sessionId || ''),
  };
  saveJSON(storageKey, [event, ...(Array.isArray(current) ? current : [])].slice(0, 80));
  console.info('[LootLingua XP]', event);
}

function hasLocalXPEvent(eventId) {
  if (!eventId) return false;
  return loadJSON(getXPEventLogStorageKey(), []).some(event => event?.eventId === eventId);
}

function applyXPDelta(amount) {
  if (!amount) return;
  const prevXP = userXP;
  const oldRank = getRank(prevXP);
  userXP = Math.max(0, userXP + amount);
  saveInt('userXP', userXP);
  if (!hasSignedInUser()) markGuestDataDirty();
  requestProfileCloudSave();
  checkThemeRelocksAfterXP(prevXP, userXP);
  checkThemeUnlocksAfterXP(prevXP, userXP);
  renderXPBar();
  if (isJsonImportBatchActive()) return;
  if (amount > 0 && getRank(userXP).label !== oldRank.label)
    setTimeout(()=>showRankUp(getRank(userXP)), 400);
  if (typeof evaluateTitleUnlocks === 'function') evaluateTitleUnlocks(false);
  refreshFeatureUnlockUI();
}

async function awardXP(amount, reason, metadata = {}) {
  const owner = captureXPAwardOwner();
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  const eventId = String(metadata.eventId || '');
  metadata.awardStatus = 'invalid';
  if (!value || !eventId || !XP_ALLOWED_REASONS.has(reason)) return 0;
  const fixedAmount = XP_REASON_AMOUNTS[reason];
  if ((fixedAmount && value !== fixedAmount) || (reason === 'daily_chest_unlock' && value > 50)) return 0;
  if (hasLocalXPEvent(eventId)) {
    metadata.awardStatus = 'duplicate';
    return 0;
  }
  const inFlightKey = xpAwardInFlightKey(owner, eventId);
  if (xpAwardsInFlight.has(inFlightKey)) {
    metadata.awardStatus = 'unavailable';
    queuePendingXPEvent(value, reason, metadata);
    return 0;
  }

  xpAwardsInFlight.add(inFlightKey);
  try {
    if (hasSignedInUser()) {
      if (typeof window.claimXPEventInCloud !== 'function') {
        metadata.awardStatus = 'unavailable';
        queuePendingXPEvent(value, reason, metadata);
        return 0;
      }
      const result = await window.claimXPEventInCloud({
        eventId,
        amount: value,
        reason,
        baselineXP: userXP,
        xpEconomyVersion: XP_ECONOMY_VERSION,
      });
      if (!isXPAwardOwnerCurrent(owner)) {
        metadata.awardStatus = 'unavailable';
        return 0;
      }
      if (!result?.awarded) {
        metadata.awardStatus = result?.duplicate ? 'duplicate' : result?.invalid ? 'invalid' : 'unavailable';
        if (metadata.awardStatus === 'duplicate') {
          recordXPEvent(reason, 0, { ...metadata, eventId });
        }
        if (metadata.awardStatus === 'unavailable') queuePendingXPEvent(value, reason, metadata);
        if (Number.isFinite(result?.userXP) && result.userXP > userXP) {
          applyXPDelta(result.userXP - userXP);
        }
        return 0;
      }
      const nextXP = Math.max(userXP, Number(result.userXP) || (userXP + value));
      const delta = nextXP - userXP;
      if (delta > 0) applyXPDelta(delta);
    } else {
      applyXPDelta(value);
    }
    if (!isXPAwardOwnerCurrent(owner)) {
      metadata.awardStatus = 'unavailable';
      return 0;
    }
    saveInt('xpEconomyVersion', XP_ECONOMY_VERSION);
    recordXPEvent(reason, value, { ...metadata, eventId });
    metadata.awardStatus = 'awarded';
    return value;
  } catch (error) {
    metadata.awardStatus = 'unavailable';
    if (!isXPAwardOwnerCurrent(owner)) return 0;
    queuePendingXPEvent(value, reason, metadata);
    console.warn('[LootLingua XP] award failed', { eventId, reason, error: error?.message || error });
    return 0;
  } finally {
    xpAwardsInFlight.delete(inFlightKey);
  }
}

function renderXpRanksGuide() {
  const list = document.getElementById('xpRanksGuideList');
  const summary = document.getElementById('xpRanksGuideSummary');
  if (!list) return;
  const current = getRank(userXP);
  if (summary) summary.textContent = current.label;
  list.innerHTML = XP_RANKS.map((rank, index) => {
    const level = index + 1;
    const reached = userXP >= rank.min;
    const isCurrent = rank.label === current.label;
    const reqLabel = rank.min === 0 ? '0 XP' : `${rank.min} XP`;
    return `<li class="xp-rank-row${reached ? ' reached' : ''}${isCurrent ? ' current' : ''}">
      <span class="xp-rank-level">Level ${level}</span>
      <span class="xp-rank-name"><i class="${rank.iconClass}" aria-hidden="true"></i> ${rank.label}</span>
      <span class="xp-rank-req">${reqLabel}</span>
    </li>`;
  }).join('');
}

window.toggleXpRanksGuide = function(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const panel = document.getElementById('xpRanksGuidePanel');
  const btn = document.getElementById('xpRanksGuideToggle');
  const wrap = document.querySelector('.xp-ranks-setting');
  if (!panel || !btn) return;
  const open = panel.hidden;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  wrap?.classList.toggle('open', open);
};

function renderXPBar() {
  const rank=getRank(userXP), next=getNextRank(userXP);
  const pct=next?Math.min(((userXP-rank.min)/(next.min-rank.min))*100,100):100;
  const el = {
    fill: document.getElementById('xpFill'),
    lbl:  document.getElementById('xpRankLabel'),
    ico:  document.getElementById('xpRankIcon'),
    val:  document.getElementById('xpValue'),
    nxt:  document.getElementById('xpNext'),
  };
  if (!el.fill) return;
  el.fill.style.width      = pct+'%';
  el.fill.style.background = rank.color;
  refreshThemeLockUI();
  if (el.lbl) { el.lbl.textContent=rank.label; el.lbl.style.color=rank.color; }
  if (el.ico)   el.ico.innerHTML = `<i class="${rank.iconClass}" aria-hidden="true"></i>`;
  if (el.val)   el.val.textContent = userXP+' XP';
  if (el.nxt)   el.nxt.innerHTML = next ? `${next.min} XP` : `MAX <i class="fa-solid fa-trophy" aria-hidden="true"></i>`;
  renderXpRanksGuide();
  syncHeroAvatar();
}

function showXPBadge(amount, anchorId, isNeg) {
  if (isJsonImportBatchActive()) return;
  const b = document.getElementById('xpBadge');
  if (!b) return;
  b.textContent      = (isNeg?'-':'+')+amount+' XP';
  const root = getComputedStyle(document.documentElement);
  b.style.background = isNeg ? 'var(--danger)' : 'var(--star)';
  b.style.color      = isNeg ? 'var(--text-on-accent)' : 'var(--text-on-star)';
  const a = anchorId ? document.getElementById(anchorId) : null;
  if (a) {
    const r=a.getBoundingClientRect();
    b.style.left=(r.left+r.width/2)+'px'; b.style.bottom=(window.innerHeight-r.top+12)+'px';
    b.style.transform='translateX(-50%)';
  } else { b.style.left='50%'; b.style.bottom='90px'; b.style.transform='translateX(-50%)'; }
  b.classList.remove('fly'); void b.offsetWidth; b.classList.add('fly');
  const ic=document.getElementById('xpRankIcon');
  if (ic){ic.classList.add('pop');setTimeout(()=>ic.classList.remove('pop'),350);}
}

function showRankUp(rank) {
  const t=document.getElementById('toastMessage'); if(!t)return;
  t.textContent='ترقية! أصبحت '+rank.label;
  t.style.background='var(--accent)'; t.style.color='var(--text-on-accent)'; t.classList.add('show');
  try {
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [523,659,784].forEach((f,i)=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);o.type='sine';o.frequency.value=f;
      g.gain.setValueAtTime(0.15,ctx.currentTime+i*0.13);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.13+0.35);
      o.start(ctx.currentTime+i*0.13); o.stop(ctx.currentTime+i*0.13+0.35);
    });
  } catch(e){}
  setTimeout(()=>{t.classList.remove('show');t.style.background='';t.style.color='';},3500);
}

// ── Daily Streak ──────────────────────────────────────
function localDailyStreakProfile() {
  return {
    dailyStreak, lastActivityDate: lastActivity,
    streakFreezes: loadInt('lootlinguaStreakFreezes', 0),
    freezeSaves: loadInt('lootlinguaFreezeSaves', 0),
    maxStreak: loadInt('lootlinguaMaxStreak', 0),
    streakState: loadJSON('lootlinguaDailyStreakState', null),
  };
}

window.getDailyStreakStatus = function(at = Date.now()) {
  const helper = window.LootLinguaDailyStreak;
  const snapshot = window.__lootlinguaProfileSnapshot;
  const uid = window.auth?.currentUser?.uid;
  const profile = uid && snapshot?.uid === uid && !snapshot.readFailed && snapshot.data
    ? { ...snapshot.data } : localDailyStreakProfile();
  const timeZone = helper?.streakTimeZone(profile);
  const calendar = helper?.streakCalendar(at, timeZone);
  if (calendar) helper.settleDailyStreak(profile, calendar.today, timeZone);
  return {
    ...calendar, count: Math.max(0, Number(profile.dailyStreak) || 0),
    lastActivityDate: String(profile.lastActivityDate || ''),
    freezeCount: Math.max(0, Number(profile.streakFreezes) || 0),
  };
};

window.announceDailyStreakFreeze = function(count) {
  showToast(`استخدمنا ${count} من رصيد التجميد لحماية أيام الغياب.`, 'success', 5600);
};

function checkAndUpdateStreak(options = {}) {
  const at = options.at || Date.now();
  const learning = options.learningEvent === true;
  if (hasSignedInUser()) {
    renderStreak();
    renderProfileModalStats();
    return learning ? window.recordCloudStreakLearningDay?.(at) : window.checkCloudDailyStreak?.(at);
  }
  const helper = window.LootLinguaDailyStreak;
  if (!helper) { renderStreak(); return; }
  const profile = localDailyStreakProfile();
  const timeZone = helper.streakTimeZone(profile);
  const { today } = helper.streakCalendar(at, timeZone);
  if (learning || helper.needsStreakSettlement(profile, today)) {
    const previousDay = profile.lastActivityDate;
    const used = learning
      ? helper.recordDailyStreak(profile, today, timeZone)
      : helper.settleDailyStreak(profile, today, timeZone);
    if (learning && profile.lastActivityDate === previousDay) { renderStreak(); return; }
    dailyStreak = profile.dailyStreak;
    lastActivity = profile.lastActivityDate;
    saveInt('dailyStreak', dailyStreak);
    localStorage.setItem('lastActivityDate', lastActivity);
    saveInt('lootlinguaStreakFreezes', profile.streakFreezes);
    saveInt('lootlinguaFreezeSaves', profile.freezeSaves);
    saveInt('lootlinguaMaxStreak', profile.maxStreak);
    saveJSON('lootlinguaDailyStreakState', profile.streakState);
    if (learning && !isJsonImportBatchActive() && !used && dailyStreak > 1) {
      const length = dailyStreak;
      setTimeout(() => showToast('Streak ' + length + ' يوم!'), 1000);
    }
    if (used && !isJsonImportBatchActive()) window.announceDailyStreakFreeze(used);
    if (used && typeof evaluateTitleUnlocks === 'function') evaluateTitleUnlocks(!isJsonImportBatchActive());
  }
  renderStreak();
  renderProfileModalStats();
}

function renderStreakFreezeStatus(count = window.getDailyStreakStatus().freezeCount) {
  document.querySelectorAll('[data-streak-freeze-count]').forEach(node => { node.textContent = count > 0 ? `${count} فريز` : 'بدون فريز'; });
  document.querySelectorAll('[data-streak-freeze-status]').forEach(node => { node.classList.toggle('has-freezes', count > 0); });
  document.querySelectorAll('.streak-freeze-help').forEach(node => { node.setAttribute('aria-label', `شرح حماية الستريك بالفريز. رصيدك ${count} فريز`); });
  const balance = document.getElementById('streakFreezeHelpBalance');
  if (balance) balance.textContent = `رصيدك الحالي: ${count} فريز`;
}

window.showStreakFreezeHelp = function(event) {
  event?.preventDefault(); event?.stopPropagation();
  renderStreakFreezeStatus(); showModal('streakFreezeHelpModal');
  const modal = document.getElementById('streakFreezeHelpModal');
  if (modal) window.LootLinguaModalFocus?.open(modal, {
    dialog: modal.querySelector('.modal-content') || modal,
    onEscape: () => hideModal('streakFreezeHelpModal'),
  });
};

function renderStreak() {
  const streak = window.getDailyStreakStatus();
  renderStreakFreezeStatus(streak.freezeCount);
  const el   = document.getElementById('streakCount');
  const ico  = document.getElementById('streakIcon');
  const wrap = document.getElementById('streakWrap');
  if (!el) return;
  const count = streak.count;
  el.textContent = count + ' يوم';
  if (count >= 30)      { if (ico) ico.innerHTML = '<i class="fa-solid fa-bolt"></i>'; el.style.color = 'var(--accent)'; }
  else if (count >= 14) { if (ico) ico.innerHTML = '<i class="fa-solid fa-fire"></i>'; el.style.color = 'var(--accent2)'; }
  else if (count >= 7)  { if (ico) ico.innerHTML = '<i class="fa-solid fa-fire"></i>'; el.style.color = 'var(--star)'; }
  else { if (ico) ico.innerHTML = '<i class="fa-solid fa-fire"></i>'; el.style.color = 'var(--text-gray)'; }
  if (wrap) wrap.className = 'streak-wrap' + (count >= 7 ? ' streak-hot' : '');
}

// ── Daily Goal & Confetti ──────────────────────────────
const DAILY_GOAL = 5;

function getDailyCount() {
  const map = loadJSON('activityMap', {});
  return map[todayStr()] || 0;
}

function incrementDailyCountBy(amount = 1) {
  const n = Math.max(0, Number(amount) || 0);
  if (!n) return;
  const today = todayStr();
  const map   = loadJSON('activityMap', {});
  const before = map[today] || 0;
  map[today]  = before + n;
  saveJSON('activityMap', map);
  if (!hasSignedInUser()) markGuestDataDirty();
  requestProfileCloudSave();
  if (typeof updateDailyQuestsBadge === 'function') updateDailyQuestsBadge();
  renderDailyGoal();
  const after = map[today];
  if (!isJsonImportBatchActive() && before < DAILY_GOAL && after >= DAILY_GOAL) {
    setTimeout(launchConfetti, 400);
  }
}

function renderDailyGoal() {
  const count = getDailyCount();
  const pct   = Math.min((count / DAILY_GOAL) * 100, 100);
  const ring  = document.getElementById('goalRing');
  const txt   = document.getElementById('goalText');
  if (!ring) return;
  const circ = 100.53;
  ring.style.strokeDashoffset = circ - (pct / 100) * circ;
  ring.style.stroke = pct >= 100 ? 'var(--success)' : 'var(--accent)';
  if (txt) txt.textContent = count+'/'+DAILY_GOAL;
}

function launchConfetti() {
  try {
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [[392,0],[523,.1],[659,.2],[784,.3],[1047,.45]].forEach(([f,t])=>{
      const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);
      o.type='triangle'; o.frequency.value=f;
      g.gain.setValueAtTime(0.2,ctx.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.4);
      o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+0.4);
    });
  } catch(e) {}
  const container=document.getElementById('confettiContainer');
  if (!container) return;
  container.innerHTML='';
  const colors=['var(--star)','var(--accent)','var(--success)','var(--accent2)','var(--danger)','var(--header-grad)'];
  for(let i=0;i<70;i++){
    const p=document.createElement('div'); p.className='confetti-piece';
    p.style.cssText=`left:${Math.random()*100}%;background:${colors[i%colors.length]};width:${6+Math.random()*6}px;height:${6+Math.random()*6}px;border-radius:${Math.random()>.5?'50%':'2px'};animation-delay:${Math.random()*.5}s;animation-duration:${1.2+Math.random()*.8}s;`;
    container.appendChild(p);
  }
  container.style.display='block';
  const t=document.getElementById('toastMessage');
  if(t){t.textContent='أكملت هدفك اليوم!';t.classList.add('show');}
  setTimeout(()=>{container.style.display='none';container.innerHTML='';if(t)t.classList.remove('show');},3000);
}

// ── Combo System ──────────────────────────────────────
let comboTimestamps = [];
function checkCombo() {
  const now = Date.now();
  comboTimestamps.push(now);
  if (comboTimestamps.length > 3) comboTimestamps.shift();
  return comboTimestamps.length===3 && (comboTimestamps[2]-comboTimestamps[0])<60000;
}

// ── Word normalization & duplicate check ──────────────
