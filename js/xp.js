// XP & GAMIFICATION
// ═══════════════════════════════════════════════════════
const XP_RANKS = [
  {min:0,   max:14,       label:'Noob',     iconClass:'fa-solid fa-seedling', color:'var(--text-gray)'},
  {min:15,  max:39,       label:'Wanderer', iconClass:'fa-solid fa-compass', color:'var(--header-grad)'},
  {min:40,  max:79,       label:'Learner',  iconClass:'fa-solid fa-book-open', color:'var(--accent)'},
  {min:80,  max:149,      label:'Explorer', iconClass:'fa-solid fa-binoculars', color:'var(--accent2)'},
  {min:150, max:249,      label:'Pro',      iconClass:'fa-solid fa-award', color:'var(--success)'},
  {min:250, max:399,      label:'Veteran',  iconClass:'fa-solid fa-shield-halved', color:'var(--success)'},
  {min:400, max:599,      label:'Elite',    iconClass:'fa-solid fa-fire', color:'var(--star)'},
  {min:600, max:899,      label:'Master',   iconClass:'fa-solid fa-star', color:'var(--star)'},
  {min:900, max:1299,     label:'Legend',   iconClass:'fa-solid fa-crown', color:'var(--accent)'},
  {min:1300,max:Infinity, label:'Linguaer', iconClass:'fa-solid fa-trophy', color:'var(--accent2)'},
];

// userXP already declared in State section above — just reload from localStorage
userXP = loadInt('userXP', 0);

function getRank(xp)     { return [...XP_RANKS].reverse().find(r=>xp>=r.min)||XP_RANKS[0]; }
function getNextRank(xp) { return XP_RANKS.find(r=>r.min>xp)||null; }

const THEME_UNLOCK_LEVELS = {
  lootlingua: 1,
  golden: 2,
  scroll: 3,
  ocean: 4,
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
const ONBOARDING_COMING_SOON = true;
const WELCOME_STORAGE_KEY = 'lootlingua_welcome_v1_seen';

function isThemeComingSoon(theme) {
  return THEMES_COMING_SOON.has(theme);
}

function isOnboardingComingSoon() {
  return ONBOARDING_COMING_SOON;
}

function getThemeDisplayName(theme) {
  return THEME_DISPLAY_NAMES[theme] || theme;
}

function showGlassThemeComingSoonMessage() {
  pushNotification(`«${getThemeDisplayName('glass')}» قريباً — ما زال قيد التطوير. ترقّب التحديث! ✨`, 'warning');
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

function showOnboardingComingSoonMessage() {
  pushNotification('الشرح التفاعلي قريباً! لسه بنحكيه أحلى — ترقب التحديث 🛠️', 'warning');
}

window.handleOnboardingReplayClick = function(ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (isOnboardingComingSoon()) {
    showOnboardingComingSoonMessage();
    return;
  }
  if (typeof closeProfileModal === 'function') closeProfileModal();
  startOnboarding(true);
};

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

  const replayBtn = document.getElementById('replayOnboardingBtn');
  if (replayBtn) {
    replayBtn.classList.toggle('feature-coming-soon', isOnboardingComingSoon());
    replayBtn.setAttribute('aria-disabled', isOnboardingComingSoon() ? 'true' : 'false');
    replayBtn.title = isOnboardingComingSoon() ? 'الشرح التفاعلي قريباً' : '';
  }

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

function queuePendingXPEvent(amount, reason, metadata) {
  if (!metadata?.queueOnFailure || !metadata.eventId) return;
  const key = getPendingXPEventsStorageKey();
  const pending = loadJSON(key, []);
  if (pending.some(event => event?.eventId === metadata.eventId)) return;
  saveJSON(key, [...pending, {
    amount,
    reason,
    eventId: metadata.eventId,
    wordKey: metadata.wordKey || '',
    sessionId: metadata.sessionId || '',
  }].slice(-100));
}

async function retryPendingXPEvents() {
  const key = getPendingXPEventsStorageKey();
  const pending = loadJSON(key, []);
  if (!Array.isArray(pending) || !pending.length) return;
  const remaining = [];
  for (const event of pending) {
    const metadata = { ...event, queueOnFailure: false };
    await awardXP(event.amount, event.reason, metadata);
    if (metadata.awardStatus !== 'awarded' && metadata.awardStatus !== 'duplicate') {
      remaining.push(event);
    }
  }
  saveJSON(key, remaining);
}
window.retryPendingXPEvents = retryPendingXPEvents;
window.addEventListener('online', () => {
  retryPendingXPEvents();
  evaluateChestXPUnlock();
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
  if (xpAwardsInFlight.has(eventId)) {
    metadata.awardStatus = 'duplicate';
    return 0;
  }

  xpAwardsInFlight.add(eventId);
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
    saveInt('xpEconomyVersion', XP_ECONOMY_VERSION);
    recordXPEvent(reason, value, { ...metadata, eventId });
    metadata.awardStatus = 'awarded';
    return value;
  } catch (error) {
    metadata.awardStatus = 'unavailable';
    queuePendingXPEvent(value, reason, metadata);
    console.warn('[LootLingua XP] award failed', { eventId, reason, error: error?.message || error });
    return 0;
  } finally {
    xpAwardsInFlight.delete(eventId);
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
/**
 * يُستدعى مرة واحدة عند فتح الصفحة — يسجّل اليوم ويحدث الـ streak
 */
function checkAndUpdateStreak(options = {}) {
  if (options.learningEvent !== true) {
    renderStreak();
    return;
  }
  const today     = todayStr();
  const yesterday = new Date(Date.now()-864e5).toISOString().slice(0,10);

  // A streak day now requires a completed verified learning session.
  const map = loadJSON('activityMap', {});
  if (!map[today]) map[today] = 0;
  saveJSON('activityMap', map);

  if (lastActivity === today) { renderStreak(); return; } // نفس اليوم

  if (lastActivity === yesterday) {
    dailyStreak++;
    if (!isJsonImportBatchActive()) setTimeout(()=>showToast('Streak '+dailyStreak+' يوم!'), 1000);
  } else if (lastActivity !== '') {
    const freezes = typeof getStreakFreezeCount === 'function' ? getStreakFreezeCount() : loadInt('lootlinguaStreakFreezes', 0);
    if (freezes > 0) {
      if (typeof saveStreakFreezeCount === 'function') saveStreakFreezeCount(freezes - 1);
      else saveInt('lootlinguaStreakFreezes', freezes - 1);
      saveInt('lootlinguaFreezeSaves', loadInt('lootlinguaFreezeSaves', 0) + 1);
      dailyStreak = Math.max(1, dailyStreak);
      if (!isJsonImportBatchActive()) {
        setTimeout(() => showToast('Streak Freeze اشتغل وأنقذ السلسلة. رجعت قبل ما تنكسر!', 'success', 5600), 900);
      }
      if (typeof evaluateTitleUnlocks === 'function') evaluateTitleUnlocks(!isJsonImportBatchActive());
    } else {
      dailyStreak = 1;
    }
  } else {
    dailyStreak = 1; // أول استخدام
  }

  saveInt('dailyStreak', dailyStreak);
  const maxS = loadInt('lootlinguaMaxStreak', 0);
  if (dailyStreak > maxS) saveInt('lootlinguaMaxStreak', dailyStreak);
  lastActivity = today;
  localStorage.setItem('lastActivityDate', today);
  requestProfileCloudSave();
  renderStreak();
  renderProfileModalStats();
}

function renderStreak() {
  const el   = document.getElementById('streakCount');
  const ico  = document.getElementById('streakIcon');
  const wrap = document.getElementById('streakWrap');
  if (!el) return;
  el.textContent = dailyStreak+' يوم';
  if (dailyStreak>=30)      { if(ico)ico.innerHTML='<i class="fa-solid fa-bolt"></i>'; el.style.color='var(--accent)'; }
  else if (dailyStreak>=14) { if(ico)ico.innerHTML='<i class="fa-solid fa-fire"></i>'; el.style.color='var(--accent2)'; }
  else if (dailyStreak>=7)  { if(ico)ico.innerHTML='<i class="fa-solid fa-fire"></i>'; el.style.color='var(--star)'; }
  else                      { if(ico)ico.innerHTML='<i class="fa-solid fa-fire"></i>'; el.style.color='var(--text-gray)'; }
  if (wrap) wrap.className='streak-wrap'+(dailyStreak>=7?' streak-hot':'');
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
