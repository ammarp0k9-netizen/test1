const LOOT_BOX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LOOT_STATE_KEY = 'lootlinguaDailyLootState';
const TITLE_STATE_KEY = 'lootlinguaTitlesState';
const ACTIVE_TITLE_KEY = 'lootlinguaActiveTitleId';
const ACTIVE_TITLE_NONE = '__none';
const STREAK_FREEZE_KEY = 'lootlinguaStreakFreezes';
const FREEZE_SAVES_KEY = 'lootlinguaFreezeSaves';
const GAME_DICT_ADDS_KEY = 'lootlinguaGameDictAdds';
const EXTRA_CHESTS_KEY = 'lootlinguaExtraChests';

const TITLE_DEFS = [
  {
    id: 'first_spark',
    icon: 'fa-solid fa-bolt',
    color: '#facc15',
    name: 'أول شرارة',
    how: 'افتح أول صندوق يومي.',
    unlocked: () => getLootState().totalOpens >= 1,
  },
  {
    id: 'loot_hunter',
    icon: 'fa-solid fa-box-open',
    color: '#f59e0b',
    name: 'صياد اللوت',
    how: 'افتح 7 صناديق يومية متتالية.',
    unlocked: () => getLootState().streak >= 7,
  },
  {
    id: 'streak_savior',
    icon: 'fa-solid fa-shield-halved',
    color: '#38bdf8',
    name: 'درع الستريك',
    how: 'خلّي Streak Freeze ينقذ سلسلتك مرة واحدة.',
    unlocked: () => loadInt(FREEZE_SAVES_KEY, 0) >= 1,
  },
  {
    id: 'game_explorer',
    icon: 'fa-solid fa-dice-d20',
    color: '#a78bfa',
    name: 'رحّالة الألعاب',
    how: 'أضف كلمة من أي قاموس ألعاب إلى قاموسك.',
    unlocked: () => loadInt(GAME_DICT_ADDS_KEY, 0) >= 1,
  },
  {
    id: 'word_collector',
    icon: 'fa-solid fa-layer-group',
    color: '#22c55e',
    name: 'جامع الكلمات',
    how: 'اجمع 25 كلمة في قاموسك.',
    unlocked: () => getDictionaryWordCount() >= 25,
  },
  {
    id: 'dictionary_keeper',
    icon: 'fa-solid fa-book-bookmark',
    color: '#06b6d4',
    name: 'أمين القاموس',
    how: 'وصل قاموسك إلى 50 كلمة.',
    unlocked: () => getDictionaryWordCount() >= 50,
  },
  {
    id: 'star_chaser',
    icon: 'fa-solid fa-star',
    color: '#fbbf24',
    name: 'صائد الصعب',
    how: 'علّم 10 كلمات ككلمات صعبة.',
    unlocked: () => getPersonalDictionaryWordsSnapshot().filter(w => w.starred).length >= 10,
  },
  {
    id: 'first_mastery',
    icon: 'fa-solid fa-gem',
    color: '#22d3ee',
    name: 'صاقل الجوهرة',
    how: 'أتقن أول كلمة في قاموسك.',
    unlocked: () => getPersonalDictionaryWordsSnapshot().filter(w => getWordMasteryState(w).mastery_status === 'Mastered').length >= 1,
  },
  {
    id: 'mastery_circle',
    icon: 'fa-solid fa-crown',
    color: '#eab308',
    name: 'تاج الإتقان',
    how: 'أتقن 10 كلمات في قاموسك.',
    unlocked: () => getPersonalDictionaryWordsSnapshot().filter(w => getWordMasteryState(w).mastery_status === 'Mastered').length >= 10,
  },
  {
    id: 'strategist',
    icon: 'fa-solid fa-chess-knight',
    color: '#f472b6',
    name: 'الخبير الاستراتيجي',
    how: 'أنهِ 10 اختبارات كاملة بدون ولا غلطة.',
    unlocked: () => loadInt('lootlinguaPerfectQuizzes', 0) >= 10,
  },
  {
    id: 'streak_guard',
    icon: 'fa-solid fa-fire-flame-curved',
    color: '#fb7185',
    name: 'لهيب الأسبوع',
    how: 'حافظ على Streak لمدة 7 أيام.',
    unlocked: () => loadInt('dailyStreak', 0) >= 7,
  },
  {
    id: 'level_climber',
    icon: 'fa-solid fa-mountain-sun',
    color: '#84cc16',
    name: 'متسلّق المستويات',
    how: 'وصل إلى Level 5.',
    unlocked: () => getLevelFromXP(loadInt('userXP', 0)) >= 5,
  },
];

const TITLE_CUSTOM_ICON_URLS = {
  first_spark: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/26a1.svg',
  loot_hunter: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f4e6.svg',
  streak_savior: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f6e1.svg',
  game_explorer: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f3b2.svg',
  word_collector: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f5c2.svg',
  dictionary_keeper: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f4d6.svg',
  star_chaser: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/2b50.svg',
  strategist: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/265f.svg',
  streak_guard: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f525.svg',
  level_climber: 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/26f0.svg',
};

function getTitleIconUrl(def) {
  return def?.iconUrl || TITLE_CUSTOM_ICON_URLS[def?.id] || '';
}

function renderTitleIcon(def, className = 'title-custom-icon') {
  const color = escapeHtml(def?.color || 'var(--accent)');
  return `<i class="${escapeHtml(className)} ${escapeHtml(def?.icon || 'fa-solid fa-medal')}" style="--title-color:${color};" aria-hidden="true"></i>`;
}

function getUnlockedTitleDefs() {
  const unlocked = new Set(getTitleState().unlocked || []);
  return TITLE_DEFS.filter(def => unlocked.has(def.id));
}

function getActiveTitleId() {
  const unlocked = new Set(getTitleState().unlocked || []);
  const saved = localStorage.getItem(ACTIVE_TITLE_KEY) || '';
  if (saved === ACTIVE_TITLE_NONE) return '';
  if (saved && unlocked.has(saved)) return saved;
  return [...unlocked][0] || '';
}

function getActiveTitleDef() {
  const id = getActiveTitleId();
  return id ? TITLE_DEFS.find(def => def.id === id) || null : null;
}

window.setActiveLootlinguaTitle = function(titleId) {
  const unlocked = new Set(getTitleState().unlocked || []);
  const next = unlocked.has(titleId) ? titleId : '';
  if (next) localStorage.setItem(ACTIVE_TITLE_KEY, next);
  else localStorage.setItem(ACTIVE_TITLE_KEY, ACTIVE_TITLE_NONE);
  markGuestProfileDataDirty(ACTIVE_TITLE_KEY);
  requestProfileCloudSave();
  syncHeroAvatar();
};

function renderProfileTitlePicker() {
  const picker = document.getElementById('profileTitlePicker');
  if (!picker) return;
  const unlocked = getUnlockedTitleDefs();
  if (!unlocked.length) {
    picker.innerHTML = '<p class="profile-title-empty">افتح أول لقب من صفحة الكنز حتى يظهر هنا.</p>';
    return;
  }
  picker.innerHTML = `
    <button type="button" class="profile-title-choice ${!activeId ? 'active' : ''}" onclick="setActiveLootlinguaTitle('')" aria-pressed="${!activeId}">
      <span class="profile-title-choice-icon"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i></span>
      <span>بدون لقب</span>
    </button>
    ${unlocked.map(def => `
      <button type="button" class="profile-title-choice ${activeId === def.id ? 'active' : ''}" onclick="setActiveLootlinguaTitle('${escapeHtml(def.id)}')" aria-pressed="${activeId === def.id}">
        <span class="profile-title-choice-icon">${renderTitleIcon(def, 'profile-title-choice-img')}</span>
        <span>${escapeHtml(def.name)}</span>
      </button>
    `).join('')}
  `;
}

function getLootState() {
  return loadJSON(LOOT_STATE_KEY, {
    lastOpenAt: 0,
    streak: 0,
    totalOpens: 0,
    lastOpenDay: '',
    rewards: [],
    freezesEarned: 0,
    lockedXP: 0,
    lockStartedAt: 0,
    lockResolvedAt: 0,
    lockMasteredWordIds: [],
    lockHighAccuracyQuizIds: []
  });
}

function renderProfileTitlePicker() {
  const picker = document.getElementById('profileTitlePicker');
  if (!picker) return;
  const unlocked = getUnlockedTitleDefs();
  if (!unlocked.length) {
    picker.innerHTML = '<p class="profile-title-empty">افتح أول لقب من صفحة الكنز حتى يظهر هنا.</p>';
    return;
  }
  picker.innerHTML = unlocked.map(def => `
    <span class="profile-title-chip" title="${escapeHtml(def.name)}">
      ${renderTitleIcon(def, 'profile-title-choice-img')}
      <span>${escapeHtml(def.name)}</span>
    </span>
  `).join('');
}

function saveLootState(state) {
  saveJSON(LOOT_STATE_KEY, state);
  if (!hasSignedInUser()) markGuestDataDirty();
  requestProfileCloudSave();
}

function getTitleState() {
  return loadJSON(TITLE_STATE_KEY, { unlocked: [], lastUnlockedAt: {} });
}

function saveTitleState(state) {
  saveJSON(TITLE_STATE_KEY, state);
  if (!hasSignedInUser()) markGuestDataDirty();
  requestProfileCloudSave();
}

function formatLootTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}س ${String(m).padStart(2, '0')}د`;
  if (m > 0) return `${m}د ${String(s).padStart(2, '0')}ث`;
  return `${s}ث`;
}

function getLootAvailability() {
  const state = getLootState();
  const lockedXP = Number(state.lockedXP) || 0;
  const nextAt = (state.lastOpenAt || 0) + LOOT_BOX_COOLDOWN_MS;
  const remaining = nextAt - Date.now();
  return { state, ready: lockedXP <= 0 && (!state.lastOpenAt || remaining <= 0), remaining: Math.max(0, remaining), lockedXP };
}

function pickDailyLootReward() {
  const roll = Math.random();
  if (roll < 0.04) return { type: 'freeze', freezes: 1, label: 'حماية السلسلة اليومية' };
  if (roll < 0.58) return { type: 'xp', xp: 5 + Math.floor(Math.random() * 16), label: 'XP سريع' };
  if (roll < 0.88) return { type: 'xp', xp: 21 + Math.floor(Math.random() * 20), label: 'XP محترم' };
  return { type: 'xp', xp: 41 + Math.floor(Math.random() * 10), label: 'ضربة ذهبية' };
}

function updateLootStreak(state) {
  const today = todayStr();
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (state.lastOpenDay === today) return state.streak || 0;
  if (state.lastOpenDay === yesterday) return (state.streak || 0) + 1;
  return 1;
}

function getStreakFreezeCount() {
  return loadInt(STREAK_FREEZE_KEY, 0);
}

function saveStreakFreezeCount(count) {
  saveInt(STREAK_FREEZE_KEY, Math.max(0, Number(count) || 0));
  if (!hasSignedInUser()) markGuestDataDirty();
  requestProfileCloudSave();
}

function recordGameDictionaryAdd() {
  saveInt(GAME_DICT_ADDS_KEY, loadInt(GAME_DICT_ADDS_KEY, 0) + 1);
  if (!hasSignedInUser()) markGuestDataDirty();
  if (typeof evaluateTitleUnlocks === 'function') evaluateTitleUnlocks(true);
  requestProfileCloudSave();
}

function describeLootReward(reward) {
  if (!reward) return 'لوت غامض';
  if (reward.type === 'freeze') return `${reward.label}: يحمي السلسلة اليومية يوم غياب واحد`;
  return `${reward.label} +${reward.xp || 0} XP مقفولة`;
}

const CHEST_MASTERED_WORDS_REQUIRED = 2;
const CHEST_XP_UNLOCK_TEXT = `أتقن ${CHEST_MASTERED_WORDS_REQUIRED} كلمات أو أكمل اختبارين موثقين بدقة 90%+ لفتح XP هذا الصندوق.`;

function saveChestProgressState(state) {
  saveLootState(state);
  if (typeof renderLootSummary === 'function' && currentView === 'treasure') renderLootSummary();
}

let chestXPUnlockInFlight = null;

async function unlockChestXP(reason = '') {
  if (chestXPUnlockInFlight) return chestXPUnlockInFlight;
  chestXPUnlockInFlight = (async () => {
  const state = getLootState();
  const amount = Number(state.lockedXP) || 0;
  if (amount <= 0) return false;
  const eventId = `daily_chest_unlock:${state.lockStartedAt || state.lastOpenAt || todayStr()}`;
  const metadata = { eventId };
  const awarded = await awardXP(amount, 'daily_chest_unlock', metadata);
  if (metadata.awardStatus === 'unavailable') return false;
  state.lockedXP = 0;
  state.lockStartedAt = 0;
  state.lockResolvedAt = Date.now();
  state.lockMasteredWordIds = [];
  state.lockHighAccuracyQuizIds = [];
  saveChestProgressState(state);
  if (awarded > 0) {
    showXPBadge(awarded, 'dailyLootChest', false);
    showToast(`انفتح XP الصندوق! +${awarded} XP${reason ? ` — ${reason}` : ''}`, 'success', 5200);
  }
  return true;
  })();
  try {
    return await chestXPUnlockInFlight;
  } finally {
    chestXPUnlockInFlight = null;
  }
}

function evaluateChestXPUnlock(state = getLootState()) {
  if ((Number(state.lockedXP) || 0) <= 0) return false;
  const mastered = new Set(state.lockMasteredWordIds || []).size;
  const quizzes = new Set(state.lockHighAccuracyQuizIds || []).size;
  if (mastered >= CHEST_MASTERED_WORDS_REQUIRED) return unlockChestXP(`أتقنت ${CHEST_MASTERED_WORDS_REQUIRED} كلمات`);
  if (quizzes >= 2) return unlockChestXP('أكملت اختبارين بدقة عالية');
  return false;
}

function recordChestMasteredWords(wordIds) {
  const ids = [...(wordIds instanceof Set ? wordIds : new Set(wordIds || []))].filter(Boolean);
  if (!ids.length) return;
  const state = getLootState();
  if ((Number(state.lockedXP) || 0) <= 0) return;
  state.lockMasteredWordIds = [...new Set([...(state.lockMasteredWordIds || []), ...ids])];
  saveChestProgressState(state);
  evaluateChestXPUnlock(state);
}

function recordHighAccuracyVerifiedQuiz(sessionId) {
  if (!sessionId) return;
  const state = getLootState();
  if ((Number(state.lockedXP) || 0) <= 0) return;
  state.lockHighAccuracyQuizIds = [...new Set([...(state.lockHighAccuracyQuizIds || []), sessionId])];
  saveChestProgressState(state);
  evaluateChestXPUnlock(state);
}

function revealDailyLootReward(state, reward) {
  if ((Number(state.lockedXP) || 0) > 0) {
    showToast(`عندك ${Number(state.lockedXP) || 0} XP مقفولة. افتح المكافأة الحالية أولا قبل صندوق جديد.`, 'warning', 5200);
    renderTreasureRoom();
    return;
  }
  state.streak = updateLootStreak(state);
  state.totalOpens = (state.totalOpens || 0) + 1;
  state.lastOpenAt = Date.now();
  state.lastOpenDay = todayStr();
  if (reward.type === 'freeze') {
    saveStreakFreezeCount(getStreakFreezeCount() + (reward.freezes || 1));
    state.freezesEarned = (state.freezesEarned || 0) + (reward.freezes || 1);
  }
  state.rewards = [{ at: state.lastOpenAt, ...reward }, ...(state.rewards || [])].slice(0, 12);

  if (reward.xp) {
    state.lockedXP = (Number(state.lockedXP) || 0) + (Number(reward.xp) || 0);
    state.lockStartedAt = state.lockStartedAt || state.lastOpenAt;
    state.lockResolvedAt = 0;
    state.lockMasteredWordIds = state.lockMasteredWordIds || [];
    state.lockHighAccuracyQuizIds = state.lockHighAccuracyQuizIds || [];
  }
  saveLootState(state);
  launchConfetti();
  setTimeout(() => showToast(`طلع لك: ${describeLootReward(reward)}. ${CHEST_XP_UNLOCK_TEXT}`, 'success', 6500), 90);
  evaluateTitleUnlocks(true);
  markDailyQuestFlag('openLoot');
  updateDailyQuestsBadge();
  renderTreasureRoom();
  requestProfileCloudSave();
}

window.startLootChestCharge = function(event) {
  if (event?.pointerType !== 'touch') event?.preventDefault();
  window.__lootPointerStart = event ? { x: event.clientX, y: event.clientY } : null;
  const chest = document.getElementById('dailyLootChest');
  const preview = document.getElementById('lootRewardPreview');
  const availability = getLootAvailability();
  if (availability.lockedXP > 0) {
    window.__lootPointerStart = null;
    window.openDailyLootBox();
    return;
  }
  if (!availability.ready) {
    window.__lootPointerStart = null;
    window.openDailyLootBox();
    return;
  }
  if (window.__lootOpening || window.__lootHoldTimer) {
    window.__lootPointerStart = null;
    return;
  }
  chest?.classList.add('is-charging');
  if (preview) preview.textContent = 'ثبّت ضغطتك شوي... الصندوق بدأ يتشقق.';
  window.__lootHoldTimer = setTimeout(() => {
    window.__lootHoldTimer = null;
    window.openDailyLootBox();
  }, 820);
};

window.moveLootChestCharge = function(event) {
  if (!window.__lootHoldTimer || !window.__lootPointerStart || !event) return;
  const dx = event.clientX - window.__lootPointerStart.x;
  const dy = event.clientY - window.__lootPointerStart.y;
  if (Math.hypot(dx, dy) > 14) {
    window.cancelLootChestCharge();
  }
};

window.releaseLootChestCharge = function(event) {
  if (event?.pointerType !== 'touch') event?.preventDefault();
  window.__lootPointerStart = null;
  if (!window.__lootHoldTimer) return;
  clearTimeout(window.__lootHoldTimer);
  window.__lootHoldTimer = null;
  document.getElementById('dailyLootChest')?.classList.remove('is-charging');
  const preview = document.getElementById('lootRewardPreview');
  if (preview) preview.textContent = 'ثبّت الضغط شوي عشان الصندوق يفقع.';
};

window.cancelLootChestCharge = function(event) {
  window.__lootPointerStart = null;
  window.releaseLootChestCharge(event);
};

window.openDailyLootBox = function() {
  const availability = getLootAvailability();
  if (availability.lockedXP > 0) {
    showToast(`عندك ${availability.lockedXP} XP مقفولة. افتح المكافأة الحالية أولا قبل صندوق جديد.`, 'warning', 5200);
    renderTreasureRoom();
    return;
  }
  if (!availability.ready) {
    showToast(`الصندوق يستنى الرسبون: ${formatLootTime(availability.remaining)}`, 'info', 3600);
    renderTreasureRoom();
    return;
  }
  if (window.__lootOpening) return;
  window.__lootOpening = true;
  clearTimeout(window.__lootHoldTimer);
  window.__lootHoldTimer = null;
  const chest = document.getElementById('dailyLootChest');
  const preview = document.getElementById('lootRewardPreview');
  chest?.classList.remove('is-charging');
  chest?.classList.add('is-opening');
  if (preview) preview.textContent = 'الصندوق فتح... بنفرز اللوت الآن!';
  const state = availability.state;
  const reward = pickDailyLootReward();
  setTimeout(() => {
    revealDailyLootReward(state, reward);
    chest?.classList.remove('is-opening');
    window.__lootOpening = false;
  }, 900);
};

function getTitleProgress(def) {
  const loot = getLootState();
  const words = getPersonalDictionaryWordsSnapshot();
  const starred = words.filter(w => w.starred).length;
  const perfect = loadInt('lootlinguaPerfectQuizzes', 0);
  const freezeSaves = loadInt(FREEZE_SAVES_KEY, 0);
  const gameAdds = loadInt(GAME_DICT_ADDS_KEY, 0);
  const level = getLevelFromXP(loadInt('userXP', 0));
  const streak = loadInt('dailyStreak', 0);
  const masteredWords = words.filter(w => getWordMasteryState(w).mastery_status === 'Mastered').length;
  const map = {
    first_spark: `${Math.min(loot.totalOpens || 0, 1)} / 1`,
    loot_hunter: `${Math.min(loot.streak || 0, 7)} / 7`,
    streak_savior: `${Math.min(freezeSaves, 1)} / 1`,
    game_explorer: `${Math.min(gameAdds, 1)} / 1`,
    word_collector: `${Math.min(words.length, 25)} / 25`,
    dictionary_keeper: `${Math.min(words.length, 50)} / 50`,
    star_chaser: `${Math.min(starred, 10)} / 10`,
    first_mastery: `${Math.min(masteredWords, 1)} / 1`,
    mastery_circle: `${Math.min(masteredWords, 10)} / 10`,
    strategist: `${Math.min(perfect, 10)} / 10`,
    streak_guard: `${Math.min(streak, 7)} / 7`,
    level_climber: `${Math.min(level, 5)} / 5`,
  };
  return map[def.id] || '';
}

function evaluateTitleUnlocks(celebrate = false) {
  const state = getTitleState();
  const unlocked = new Set(state.unlocked || []);
  const newly = [];
  TITLE_DEFS.forEach(def => {
    if (!unlocked.has(def.id) && def.unlocked()) {
      unlocked.add(def.id);
      state.lastUnlockedAt[def.id] = Date.now();
      newly.push(def);
    }
  });
  state.unlocked = [...unlocked];
  if (localStorage.getItem(ACTIVE_TITLE_KEY) &&
      localStorage.getItem(ACTIVE_TITLE_KEY) !== ACTIVE_TITLE_NONE &&
      !unlocked.has(localStorage.getItem(ACTIVE_TITLE_KEY))) {
    localStorage.removeItem(ACTIVE_TITLE_KEY);
  }
  if (newly.length) saveTitleState(state);
  if (newly.length && celebrate && !isJsonImportBatchActive()) {
    const first = newly[0];
    launchConfetti();
    showToast(`لقب جديد: ${first.name}`, 'success', 5200);
  }
  renderTitlesGrid();
  syncHeroAvatar();
  return newly;
}

function renderTitlesGrid() {
  const grid = document.getElementById('titlesGrid');
  if (!grid) return;
  const state = getTitleState();
  const unlocked = new Set(state.unlocked || []);
  const unlockedCount = TITLE_DEFS.filter(def => unlocked.has(def.id)).length;
  const progress = document.getElementById('titleProgressText');
  if (progress) progress.textContent = `فتحت ${unlockedCount} من ${TITLE_DEFS.length} ألقاب.`;
  grid.innerHTML = TITLE_DEFS.map(def => {
    const isUnlocked = unlocked.has(def.id);
    const cls = isUnlocked ? 'title-card unlocked' : 'title-card locked';
    const progressText = getTitleProgress(def);
    return `
      <article class="${cls}" title="${escapeHtml(def.how)}">
        <div class="title-icon">${renderTitleIcon(def)}</div>
        <div class="title-info">
          <h3>${escapeHtml(isUnlocked ? def.name : 'لقب مخفي')}</h3>
          <p>${escapeHtml(def.how)}</p>
          <span>${escapeHtml(progressText)}</span>
        </div>
      </article>`;
  }).join('');
}

function renderLootSummary() {
  const { state, ready, remaining } = getLootAvailability();
  const chest = document.getElementById('dailyLootChest');
  const status = document.getElementById('lootStatusText');
  const count = document.getElementById('lootCountdownText');
  const preview = document.getElementById('lootRewardPreview');
  const slots = document.getElementById('treasureSlots');
  const lockedXP = Number(state.lockedXP) || 0;
  if (chest) chest.classList.toggle('is-locked', lockedXP > 0 || !ready);
  const statusHtml = lockedXP > 0
    ? `<i class="fa-solid fa-lock" aria-hidden="true"></i> ${lockedXP} XP مقفولة`
    : (ready
      ? '<i class="fa-solid fa-box-open" aria-hidden="true"></i> الصندوق اليومي جاهز'
      : '<i class="fa-regular fa-clock" aria-hidden="true"></i> الصندوق يرجع بعد');
  if (status && status.innerHTML !== statusHtml) status.innerHTML = statusHtml;
  if (count) {
    const countHtml = lockedXP > 0
      ? `الإتقان: ${(state.lockMasteredWordIds || []).length}/${CHEST_MASTERED_WORDS_REQUIRED} <button type="button" class="mastery-help-btn" onclick="showMasteryHelp(event)" aria-label="ما معنى إتقان الكلمة؟"><i class="fa-solid fa-question" aria-hidden="true"></i></button> | الاختبارات: ${(state.lockHighAccuracyQuizIds || []).length}/2`
      : (ready ? 'افتحه الآن' : formatLootTime(remaining));
    if (count.innerHTML !== countHtml) count.innerHTML = countHtml;
  }
  if (preview) {
    const previewText = lockedXP > 0
      ? CHEST_XP_UNLOCK_TEXT
      : ready
      ? 'فيه XP عشوائي، ومعه فرصة نادرة لـ Streak Freeze. ثبّت ضغطتك وافتحه.'
      : `سلسلة صناديقك: ${state.streak || 0} يوم | Freeze عندك: ${getStreakFreezeCount()} | مجموع الفتحات: ${state.totalOpens || 0}`;
    if (preview.textContent !== previewText) preview.textContent = previewText;
  }
  if (slots) {
    const rewards = state.rewards || [];
    const slotRenderKey = JSON.stringify([
      ready,
      state.streak || 0,
      getStreakFreezeCount(),
      getTitleState().unlocked?.length || 0,
      rewards[0] || null,
    ]);
    if (slots.dataset.renderKey !== slotRenderKey) {
      slots.dataset.renderKey = slotRenderKey;
      slots.innerHTML = `
      <article class="treasure-slot ${ready ? 'treasure-slot-ready' : 'treasure-slot-locked'}">
        <i class="fa-solid ${ready ? 'fa-box-open' : 'fa-lock'}" aria-hidden="true"></i>
        <h3>الصندوق اليومي</h3>
        <p>${ready ? 'جاهز للفتح الآن.' : 'مقفول مؤقتاً حتى الرسبون.'}</p>
      </article>
      <article class="treasure-slot">
        <i class="fa-solid fa-fire-flame-curved" aria-hidden="true"></i>
        <h3>سلسلة اللوت</h3>
        <p>${state.streak || 0} يوم متتالي | Freeze: ${getStreakFreezeCount()}.</p>
      </article>
      <article class="treasure-slot">
        <i class="fa-solid fa-medal" aria-hidden="true"></i>
        <h3>الألقاب المفتوحة</h3>
        <p>${getTitleState().unlocked?.length || 0} لقب حالياً.</p>
      </article>
      <article class="treasure-slot">
        <i class="fa-solid fa-scroll" aria-hidden="true"></i>
        <h3>آخر لوت</h3>
        <p>${rewards[0] ? describeLootReward(rewards[0]) : 'لسه ما فتحت ولا صندوق.'}</p>
      </article>`;
    }
  }
  return { ready, lockedXP };
}

function renderTreasureRoom() {
  evaluateTitleUnlocks(false);
  const summary = renderLootSummary();
  clearInterval(window.__lootCountdownTimer);
  window.__lootCountdownTimer = null;
  if (!summary || summary.ready || summary.lockedXP > 0) return;
  window.__lootCountdownTimer = setInterval(() => {
    if (currentView !== 'treasure') {
      clearInterval(window.__lootCountdownTimer);
      window.__lootCountdownTimer = null;
      return;
    }
    const nextSummary = renderLootSummary();
    if (nextSummary.ready || nextSummary.lockedXP > 0) {
      clearInterval(window.__lootCountdownTimer);
      window.__lootCountdownTimer = null;
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════
// Game Dictionaries
// ═══════════════════════════════════════════════════════

// ── صور موثوقة من Wikimedia Commons وروابط مستقرة ──────
// Minecraft: نستخدم Wikimedia مباشرة
// PUBG: نستخدم SVG icons من cdnjs / svg repos

const gameData = {
  minecraft: {
    title: "Minecraft Dictionary",
    titleIcon: "https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/26cf.svg", // ⛏
    desc:  "اجمع الموارد وافهم كل مصطلحات اللعبة!",
    bg:    "https://images.alphacoders.com/109/1099238.png",
    words: [
      {
        text: "Obsidian",
        meaning: "حجر بركاني صلب جداً — يتكوّن من تلاقي الماء مع الحمم",
        example: "You need Obsidian to build a Nether portal.",
        img: "https://minecraft.wiki/images/Obsidian_JE3_BE2.png?format=original"
      },
      {
        text: "Creeper",
        meaning: "وحش أخضر صامت يقترب منك وينفجر",
        example: "A Creeper snuck up behind me and exploded!",
        img: "https://minecraft.wiki/images/Creeper_face_1.png?b6233"
      },
      {
        text: "Nether",
        meaning: "العالم السفلي — بيئة جهنمية تحت عالم العادي",
        example: "Build a portal to travel to the Nether.",
        img: "https://minecraft.wiki/images/Netherrack_JE4_BE2.png?8a940"
      },
      {
        text: "Enchant",
        meaning: "تحسين الأسلحة والأدوات بقوى سحرية",
        example: "Enchant your sword with Sharpness V.",
        img: "https://minecraft.wiki/images/Enchanting_Table_JE4_BE2.png?format=original"
      },
      {
        text: "Respawn",
        meaning: "العودة للحياة من جديد بعد الموت",
        example: "Set your respawn point using a bed.",
        img: "https://minecraft.wiki/images/thumb/Respawn_Anchor_%280%29_JE1.png/150px-Respawn_Anchor_%280%29_JE1.png?23b57"
      },
      {
        text: "Crafting",
        meaning: "صنع الأدوات والأسلحة من الموارد المجموعة",
        example: "Open the crafting table to build a sword.",
        img: "https://minecraft.wiki/images/Crafting_Table_JE4_BE3.png?format=original"
      },
      {
        text: "Biome",
        meaning: "منطقة جغرافية في العالم لها طبيعة وكائنات خاصة",
        example: "The desert biome is dry and sandy.",
        img: "https://minecraft.wiki/images/thumb/Biome_preview.png/350px-Biome_preview.png?4d6f7"
      },
      {
        text: "Mob",
        meaning: "كائن حي متحرك في اللعبة — عدائي أو ودّي",
        example: "Zombies are hostile mobs that spawn at night.",
        img: "https://minecraft.wiki/images/NPCFace.png?2fe0f"
      },
      { 
        text: "Spawn Point", 
        meaning: "مكان إعادة الإحياء بعد الموت", 
        example: "I slept in the bed to reset my spawn point near the village.", 
        img: "https://minecraft.wiki/images/White_Bed_JE2_BE2.png" 
      },
      { 
        text: "Mob Spawner", 
        meaning: "قفص توليد الوحوش التلقائي", 
        example: "We found a spider mob spawner and turned it into an XP farm.", 
        img: "https://minecraft.wiki/images/thumb/Monster_Spawner_JE4.png/150px-Monster_Spawner_JE4.png?64df6" 
      },
      { 
        text: "Hardcore Mode", 
        meaning: "طور اللعبة بحياة واحدة فقط", 
        example: "I've survived for 500 days in my Hardcore mode world!", 
        img: "https://minecraft.wiki/images/Hardcore_Heart.svg?dcc51" 
      },
      { 
        text: "Durability", 
        meaning: "مدى تحمل الأداة قبل الكسر", 
        example: "My diamond pickaxe has low durability, I need to mend it.", 
        img: "https://minecraft.wiki/images/thumb/Durability_bars.png/544px-Durability_bars.png?dda91" 
      },
      { 
        text: "XP (Experience)", 
        meaning: "نقاط الخبرة: النقاط اللي بتجمعها عشان تطور أسلحتك.", 
        example: "I need to kill more mobs to get XP for my sword enchantments.", 
        img: "https://minecraft.wiki/images/Experience_Orb_Value_3-6.png?6de8c" 
      },
      { 
        text: "AFK (Away From Keyboard)", 
        meaning: "بعيد عن الجهاز: لما تترك اللعبة شغالة وتروح تعمل إشي ثاني.", 
        example: "I’ll be AFK for 10 minutes at the iron farm.", 
        img: "https://minecraft.wiki/images/Human_face.png?db4dc" 
      },
      { 
        text: "Smelting", 
        meaning: "صهر: عملية تحويل الخامات (زي الحديد) لسبائك باستخدام الفرن.", 
        example: "I’m smelting the iron ore in the furnace to get iron ingots.", 
        img: "https://minecraft.wiki/images/Furnace_GUI.png?8d780" 
      },
      { 
        text: "Inventory", 
        meaning: "قائمة الأغراض: الشاشة اللي بتعرض كل الأغراض اللي معك.", 
        example: "My inventory is full of dirt; I need to throw some away.", 
        img: "https://minecraft.wiki/images/thumb/Inventory.png/176px-Inventory.png?9e5ea" 
      },
      { 
        text: "Pillagers", 
        meaning: "النهّابون: الأعداء اللي بشنوا غارات على القرى.", 
        example: "A group of Pillagers is attacking the village, get your bow!", 
        img: "https://minecraft.wiki/images/Pillager_face.png?7f2f5" 
      },
      { 
        text: "Enderman", 
        meaning: "أندرمان: وحش طويل القامة ينتقل آنياً، ويهاجمك إذا نظرت في عينيه.", 
        example: "Don't look the Enderman in the eyes, or he will teleport and attack you!", 
        img: "https://minecraft.wiki/images/Enderman_face.png?8ebeb" 
      },
      { 
        text: "Stronghold", 
        meaning: "الحصن: بناء تحت الأرض يحتوي على بوابة عالم الإند(The End).", 
        example: "We used Eyes of Ender to locate the stronghold and find the End Portal.", 
        img: "https://minecraft.wiki/images/thumb/StrongholdPortalRoom.png/250px-StrongholdPortalRoom.png?ff423" 
      },
      { 
        text: "Beacon", 
        meaning: "المنارة: بلوكة نادرة تعطي اللاعبين القريبين منها قدرات خارقة (بوفات).", 
        example: "A beacon provides powerful status effects like Haste and Strength to nearby players.", 
        img: "https://minecraft.wiki/images/thumb/Beacon_JE6_BE2.png/150px-Beacon_JE6_BE2.png?684bf" 
      },
      { 
        text: "Iron Golem", 
        meaning: "جولم الحديد: الحارس العملاق اللي بيحمي القرويين من الوحوش.", 
        example: "The Iron Golem attacked the zombies to protect the village.", 
        img: "https://minecraft.wiki/images/Iron_Golem_face.png?e15db" 
      },
      { 
        text: "Warden", 
        meaning: "وحش أعمى قوي جداً يعيش في الـ Ancient City", 
        example: "Keep quiet! The Warden can hear your footsteps from far away.", 
        img: "https://minecraft.wiki/images/thumb/Warden_face.png/120px-Warden_face.png?1b626" 
      },
      { 
        text: "Elder Guardian", 
        meaning: "وحش بحري ضخم يحرس معبد المحيط", 
        example: "The Elder Guardian gave me a mining fatigue effect in the temple.", 
        img: "https://minecraft.wiki/images/Guardian_face_1.png?2168d" 
      },
      { 
        text: "Ender Dragon", 
        meaning: "تنين عالم النهاية وهو زعيم اللعبة", 
        example: "We need many beds and arrows to defeat the Ender Dragon.", 
        img: "https://minecraft.wiki/images/Ender_Dragon_face.png?0c1e7" 
      },
      { 
        text: "Ancient City", 
        meaning: "مدينة قديمة غامضة في أعمق نقطة تحت الأرض", 
        example: "The Ancient City is full of loot, but beware of the Warden.", 
        img: "https://minecraft.wiki/images/thumb/Deep_Dark_Light.png/480px-Deep_Dark_Light.png?12f2a" 
      },
      { 
        text: "Copper", 
        meaning: "معدن النحاس المستخدم في البناء والصواعق", 
        example: "I used copper blocks to build the roof of my house.", 
        img: "https://minecraft.wiki/images/Invicon_Block_of_Copper.png?60e78" 
      },
      { 
        text: "Villager", 
        meaning: "سكان القرى المسالمين الذين يمكنك التجارة معهم", 
        example: "I traded some paper with the Villager to get emeralds.", 
        img: "https://minecraft.wiki/images/Villager_face.png?c2d14" 
      },
      { 
        text: "Skeleton", 
        meaning: "هيكل عظمي: وحش سريع بستخدم القوس والسهم وبحترق تحت الشمس", 
        example: "The Skeleton shot me with an arrow from behind the tree.", 
        img: "https://minecraft.wiki/images/Skeleton_face.png?652cd" 
      },
      { 
        text: "Silverfish", 
        meaning: "سمكة الفضة: حشرات صغيرة ومزعجة بتطلع من البلوكات في الحصون.", 
        example: "Don't break that block! It might hide a silverfish.", 
        img: "https://minecraft.wiki/images/Silverfish_face.png?1f7e0" 
      }
    ]
  },
  pubg: {
    title: "PUBG Terms",
    titleIcon: "https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1fa82.svg", // 🪂
    desc:  "دليلك للنجاة والحصول على عشاء الدجاج!",
    bg:    "https://images.alphacoders.com/901/901375.jpg",
    words: [
      {
        text: "Airdrop",
        meaning: "صندوق إمدادات نادر يسقط من طائرة — يحتوي على أسلحة قوية",
        example: "Rush the airdrop before the enemy gets there!",
        icon: "fa-solid fa-parachute-box"
      },
      {
        text: "Flank",
        meaning: "الالتفاف حول العدو من الجانب أو الخلف",
        example: "Let's flank them from the left side.",
        icon: "fa-solid fa-route"
      },
      {
        text: "Loot",
        meaning: "جمع الغنائم والأسلحة والمعدات من الخريطة",
        example: "Good loot spawns in military compounds.",
        icon: "fa-solid fa-box-open"
      },
      {
        text: "Snipe",
        meaning: "القنص والاستهداف من مسافة بعيدة جداً",
        example: "He sniped me from 400 meters away.",
        icon: "fa-solid fa-crosshairs"
      },
      {
        text: "Revive",
        meaning: "إنقاذ زميلك الساقط وإعادته للمعركة",
        example: "Quick, revive me before they push!",
        icon: "fa-solid fa-kit-medical"
      },
      {
        text: "Zone",
        meaning: "الدائرة الآمنة — يجب البقاء داخلها أو تضرر من السم",
        example: "The zone is closing in, move now!",
        icon: "fa-solid fa-circle-dot"
      },
      {
        text: "Prone",
        meaning: "الاستلقاء على الأرض للاختباء أو تفادي الرصاص",
        example: "Go prone in the grass to stay hidden.",
        icon: "fa-solid fa-person-rifle"
      },
      {
        text: "Push",
        meaning: "الهجوم على العدو والتقدم نحوه بقوة",
        example: "They're reloading — push them now!",
        icon: "fa-solid fa-forward-fast"
      }
    ]
  }
};

// ── متغير يحفظ الكلمات المفلترة الحالية للبحث ──
let currentGameWords = [];
const viewScrollY = { personal: 0, worlds: 0, minecraft: 0, pubg: 0, starred: 0, quiz: 0, treasure: 0 };

function saveCurrentViewScroll() {
  viewScrollY[isEditableDictionaryView() ? getActiveDictionaryStorageScope() : currentView] = window.scrollY || window.pageYOffset || 0;
}

function restoreViewScroll(viewKey) {
  const targetY = viewScrollY[viewKey] || 0;
  requestAnimationFrame(() => {
    window.scrollTo({ top: targetY, behavior: 'auto' });
  });
}

function setTreasureMode(active) {
  document.body.classList.toggle('treasure-mode', Boolean(active));
  if (active) {
    closeSidebarIfOpen();
    document.getElementById('overlay')?.classList.remove('show');
  }
}

function setTreasureEntryVisible(visible) {
  document.body.classList.toggle('treasure-dock-visible', Boolean(visible));
  document.body.classList.toggle('legend-dock-visible', Boolean(visible));
  document.body.classList.remove('treasure-side-next-visible', 'treasure-side-back-visible');
  const dock = document.getElementById('legendDock') || document.getElementById('treasureDock');
  if (dock) dock.style.display = visible ? 'flex' : 'none';
}

function setTreasureDockActive(viewKey) {
  const dockKey = viewKey === 'minecraft' || viewKey === 'pubg' || viewKey === 'starred' ? 'worlds' : viewKey;
  const buttons = document.querySelectorAll('#legendDock .treasure-dock-btn, #treasureDock .treasure-dock-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active', 'dock-tip-show');
    btn.removeAttribute('aria-current');
  });
  buttons.forEach(btn => {
    if (btn.dataset.dockView === dockKey) {
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
    }
  });
  if (document.activeElement?.classList?.contains('treasure-dock-btn')) {
    document.activeElement.blur();
  }
}

function unloadListForView(nextView) {
  const usesList = ['personal', 'starred', 'minecraft', 'pubg'];
  if (!usesList.includes(nextView)) {
    const list = document.getElementById('list');
    if (list) list.innerHTML = '';
  }
}

function animateTreasureRoute(direction) {
  document.body.classList.remove('treasure-route-next', 'treasure-route-back');
  void document.body.offsetWidth;
  document.body.classList.add(direction === 'back' ? 'treasure-route-back' : 'treasure-route-next');
  clearTimeout(window.__treasureRouteTimer);
  window.__treasureRouteTimer = setTimeout(() => {
    document.body.classList.remove('treasure-route-next', 'treasure-route-back');
  }, 360);
}

const WORLDS_VIEWS = new Set(['worlds', 'minecraft', 'pubg', 'starred', 'customWorld']);

function animateWorldsRoute(direction) {
  document.body.classList.remove('worlds-route-next', 'worlds-route-back');
  void document.body.offsetWidth;
  document.body.classList.add(direction === 'back' ? 'worlds-route-back' : 'worlds-route-next');
  clearTimeout(window.__worldsRouteTimer);
  window.__worldsRouteTimer = setTimeout(() => {
    document.body.classList.remove('worlds-route-next', 'worlds-route-back');
  }, 360);
}

function unloadPersonalListForTreasure() {
  const list = document.getElementById('list');
  if (list) list.innerHTML = '';
}

let appSwipeStartX = null;
let appSwipeStartY = null;
let appSwipeTracking = false;
let appSwipeHorizontal = false;
let appSwipeTargetView = null;

function isMobileSwipeDevice() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function isAppSwipeNavigationAvailable() {
  const dock = document.getElementById('legendDock');
  if (!dock || getComputedStyle(dock).display === 'none') return false;
  return document.body.classList.contains('legend-dock-visible') ||
    document.body.classList.contains('treasure-dock-visible');
}

function isSwipeBlockedTarget(target) {
  if (!target?.closest) return false;
  return Boolean(target.closest([
    'input',
    'textarea',
    'select',
    '.legend-dock',
    '.legend-top-bar',
    '.custom-modal',
    '.profile-modal.open',
    '.sidebar.open',
    '.onboarding-box',
    '.onboarding-tooltip',
    '.notif-hub',
    '.daily-quests-sheet.open',
    '.sound-btn',
    '.edit-btn',
    '.del-btn',
    '.star-btn',
    '.btn-add-mine',
    '.performance-level-slider'
  ].join(', ')));
}

function getSwipeTargetView(direction) {
  const view = currentView;
  const rightToLeftTargets = {
    personal: 'treasure',
    worlds: 'personal',
    minecraft: 'worlds',
    pubg: 'worlds',
    starred: 'worlds',
    quiz: 'worlds'
  };
  const leftToRightTargets = {
    treasure: 'personal',
    personal: 'worlds',
    worlds: 'quiz',
    minecraft: 'quiz',
    pubg: 'quiz',
    starred: 'quiz'
  };
  return direction === 'right-to-left' ? rightToLeftTargets[view] : leftToRightTargets[view];
}

function goToSwipeTarget(viewKey) {
  if (!viewKey || viewKey === currentView) return;
  if (viewKey === 'treasure') loadTreasureView();
  else if (viewKey === 'personal') loadPersonalDictionary();
  else if (viewKey === 'worlds') loadWorldsView();
  else if (viewKey === 'quiz') loadQuizView();
}

function resetAppSwipeState() {
  appSwipeStartX = null;
  appSwipeStartY = null;
  appSwipeTracking = false;
  appSwipeHorizontal = false;
  appSwipeTargetView = null;
}

function initTreasureSwipeNavigation() {
  if (window.__treasureSwipeReady) return;
  window.__treasureSwipeReady = true;
  document.addEventListener('touchstart', (event) => {
    if (!isMobileSwipeDevice()) return;
    if (event.touches?.length !== 1) return;
    if (!isAppSwipeNavigationAvailable()) return;
    if (isSwipeBlockedTarget(event.target)) return;
    const t = event.touches && event.touches[0];
    if (!t) return;
    appSwipeStartX = t.clientX;
    appSwipeStartY = t.clientY;
    appSwipeTracking = true;
    appSwipeHorizontal = false;
    appSwipeTargetView = null;
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (!appSwipeTracking || appSwipeStartX == null || appSwipeStartY == null) return;
    const t = event.touches && event.touches[0];
    if (!t) return;
    const dx = t.clientX - appSwipeStartX;
    const dy = t.clientY - appSwipeStartY;
    if (!appSwipeHorizontal && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.15) {
      resetAppSwipeState();
      return;
    }
    if (!appSwipeHorizontal && Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      appSwipeHorizontal = true;
      appSwipeTargetView = getSwipeTargetView(dx < 0 ? 'right-to-left' : 'left-to-right');
    }
    if (appSwipeHorizontal) {
      const direction = dx < 0 ? 'right-to-left' : 'left-to-right';
      appSwipeTargetView = getSwipeTargetView(direction);
      if (appSwipeTargetView) event.preventDefault();
    }
  }, { passive: false });
  document.addEventListener('touchend', (event) => {
    if (!appSwipeTracking || appSwipeStartX == null || appSwipeStartY == null) return;
    const t = event.changedTouches && event.changedTouches[0];
    if (!t) {
      resetAppSwipeState();
      return;
    }
    const dx = t.clientX - appSwipeStartX;
    const dy = t.clientY - appSwipeStartY;
    const wasHorizontal = appSwipeHorizontal;
    const targetView = appSwipeTargetView || getSwipeTargetView(dx < 0 ? 'right-to-left' : 'left-to-right');
    resetAppSwipeState();
    if (!wasHorizontal || Math.abs(dx) < 46 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
    goToSwipeTarget(targetView);
  }, { passive: true });
  document.addEventListener('touchcancel', resetAppSwipeState, { passive: true });
}

initTreasureSwipeNavigation();

window.loadGameDictionary = function(gameKey) {
  window.saveActiveAddFormDraft?.();
  cleanupQuizSessionIfActive();
  if (!isFeatureUnlocked(gameKey)) {
    openUnlockExplainModal(gameKey);
    refreshFeatureUnlockUI();
    return;
  }
  const fromPersonal = currentView === 'personal';
  const fromWorlds = currentView === 'worlds';
  if (fromPersonal || fromWorlds) animateWorldsRoute('next');
  beginViewSwitch();
  saveCurrentViewScroll();
  closeSidebarIfOpen();
  setTreasureMode(false);
  const game = gameData[gameKey];
  if (!game) return;

  unloadListForView(gameKey);
  currentView      = gameKey;
  currentGameWords = [...game.words];
  viewBackTarget = 'worlds';

  setActiveNavLink(gameKey);
  document.body.classList.add('game-bg-active');
  document.body.setAttribute('data-game', gameKey);

  hideAllViewElements();
  setViewBackBar(true, 'رجوع لعوالم الأساطير');
  setTreasureEntryVisible(true);
  setTreasureDockActive('worlds');
  document.getElementById('list').style.display = '';

  // إظهار search bar الألعاب وتفريغه
  const gameSearch = document.getElementById('gameSearchBar');
  gameSearch.style.display = 'block';
  gameSearch.querySelector('input').value = '';

  // تحديث العنوان
  document.querySelector('.page-header h1').innerHTML =
    `<img src="${game.titleIcon}" width="24" height="24" style="vertical-align:middle;margin-left:6px;" alt=""> ${game.title}`;

  clearGameGamerAiPanel();
  renderGameWords(currentGameWords);
  restoreViewScroll(gameKey);
  refreshFeatureUnlockUI();
  setAppViewRoute(gameKey);
};

function renderGameWords(words) {
  const query = (document.getElementById('gameSearchInput')?.value || '').toLowerCase().trim();

  let filtered = words.filter(w =>
    w.text.toLowerCase().includes(query) || w.meaning.includes(query)
  );

  // ترتيب ذكي: الكلمات اللي تبدأ بالـ query أول
  if (query) {
    filtered.sort((a, b) => {
      const aStarts = a.text.toLowerCase().startsWith(query);
      const bStarts = b.text.toLowerCase().startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.text.localeCompare(b.text);
    });
  }

  document.getElementById('list').innerHTML = filtered.length === 0
    ? `<li class="game-empty-search" style="list-style:none;">
         <div class="game-empty-icon">🔍</div>
         <p>ما لقيت مصطلحك بالقاموس</p>
         <p class="game-empty-hint">ما لقيته؟ استخدم زر «اسأل الـ AI» فوق عشان تبحث عن معنى أي مصطلح.</p>
       </li>`
    : filtered.map(w => {
        const safeWord = w.text.replace(/'/g,"\\'");
        const safeMeaning = w.meaning.replace(/'/g,"\\'");
        const safeExample = (w.example||'').replace(/'/g,"\\'");
        // highlight النص إذا فيه query
        const dispText    = query ? hlGame(w.text, query)    : escapeHtml(w.text);
        const dispMeaning = query ? hlGame(w.meaning, query) : escapeHtml(w.meaning);
        const exEsc = escapeHtml(w.example || '');
        const media = w.icon
          ? `<span class="game-icon game-icon-symbol" aria-hidden="true"><i class="${escapeHtml(w.icon)}"></i></span>`
          : `<img src="${escapeHtml(w.img)}" class="game-icon" alt="${escapeHtml(w.text)}"
                   onerror="this.src='https://cdn-icons-png.flaticon.com/512/686/686589.png'">`;
        return `
          <li class="game-card">
            <div class="game-info">
              ${media}
              <div>
                <div class="word-text">${dispText}</div>
                <div class="meaning-text">${dispMeaning}</div>
                ${w.example ? `<div class="game-example">"${exEsc}"</div>` : ''}
              </div>
            </div>
            <div class="game-card-actions">
              <div class="tooltip-wrap">
                <button class="icon-circle sound-btn game-sound-btn"
                        onclick="playGameSound('${safeWord}',event)">
                  <i class="fas fa-volume-up"></i>
                </button>
                <span class="tooltip-text">استمع</span>
              </div>
              <div class="tooltip-wrap">
                <button class="btn-add-mine ${wordExists(w.text)?' btn-already-added':''}"
                        onclick="addFromGame('${safeWord}','${safeMeaning}','${safeExample}',this)"
                        ${wordExists(w.text)?'disabled':''}>
                  ${wordExists(w.text)?'✓':'➕'}
                </button>
                <span class="tooltip-text">${wordExists(w.text)?'موجودة في قاموسك':'أضف للقاموس'}</span>
              </div>
            </div>
          </li>`;
      }).join('');
}

// highlight للألعاب
function hlGame(text, query) {
  if (!query || !text) return text || '';
  try {
    return text.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'),
      '<span class="highlight">$1</span>');
  } catch { return text; }
}

// صوت مباشر للكلمة (بدون id)
window.playGameSound = function(word, event) {
  if (event) event.stopPropagation();
  if (!word || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utt   = new SpeechSynthesisUtterance(word.trim());
  utt.lang    = 'en-US';
  utt.rate    = 0.9;
  const voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('en'));
  if (voice) utt.voice = voice;
  window.speechSynthesis.speak(utt);
};

// البحث داخل قاموس اللعبة
window.searchGameWords = function() {
  clearGameGamerAiPanel();
  renderGameWords(currentGameWords);
};

// ── Hide all non-personal view elements ──
function hideAllViewElements() {
  document.body.classList.remove('admin-mode');
  document.getElementById('personalControls').style.display = 'none';
  document.querySelector('.search-bar-row').style.display   = 'none';
  document.getElementById('selectionActionBar').hidden      = true;
  document.getElementById('bulkDeleteBar').style.display    = 'none';
  document.querySelector('.backup-zone').style.display      = 'none';
  document.getElementById('gameSearchBar').style.display    = 'none';
  document.getElementById('starredSearchBar').style.display = 'none';
  document.getElementById('quizView').style.display         = 'none';
  const treasureView = document.getElementById('treasureView');
  if (treasureView) treasureView.style.display = 'none';
  const worldsView = document.getElementById('worldsView');
  if (worldsView) worldsView.style.display = 'none';
  const adminView = document.getElementById('adminView');
  if (adminView) {
    adminView.hidden = true;
    adminView.style.display = 'none';
  }
  setTreasureEntryVisible(false);
  document.getElementById('list').style.display = 'none';
}


// ── Worlds Hub ──
const publishedContentState = {
  tab: 'published',
  route: { key: 'worlds', params: {} },
  world: null,
  rank: null,
  gate: null,
  ranks: [],
  gates: [],
  journey: null,
  activeJourney: null,
  gateProgress: null,
  gateProgressById: new Map(),
  newGateWords: [],
  journeyAction: null,
  journeyError: null,
  placementBundle: null,
  placementPending: false,
  placementFeedback: null,
  placementFinalizationKey: '',
  levelPlacementBundle: null,
  levelPlacementPending: false,
  levelPlacementFeedback: null,
  levelPlacementReviewOpen: false,
  wordPager: null,
  wordSnapshot: null,
  wordPageRequest: null,
  generation: 0,
  loading: false,
  error: null,
};

const WORLDS_TOUCH_TARGET_SELECTOR = [
  '.published-card',
  '.published-word-card',
  '.world-card',
  '.worlds-tab',
].join(', ');

function isCoarseWorldsPointer(event) {
  return event?.pointerType === 'touch' ||
    (event?.pointerType === 'pen' && window.matchMedia?.('(pointer: coarse)').matches);
}

function initWorldsTouchFeedback() {
  if (window.__worldsTouchFeedbackReady) return;
  const root = document.getElementById('worldsView');
  if (!root) return;
  window.__worldsTouchFeedbackReady = true;
  const activeTargets = new Map();

  root.addEventListener('pointerdown', (event) => {
    if (!isCoarseWorldsPointer(event)) return;
    const target = event.target.closest?.(WORLDS_TOUCH_TARGET_SELECTOR);
    if (!target || target.matches(':disabled')) return;
    target.classList.remove('is-touch-pop');
    target.classList.add('is-touch-pressed');
    activeTargets.set(event.pointerId, target);
    target.setPointerCapture?.(event.pointerId);
  }, { passive: true });

  const finishTouch = (event, shouldPop) => {
    const target = activeTargets.get(event.pointerId);
    if (!target) return;
    activeTargets.delete(event.pointerId);
    target.classList.remove('is-touch-pressed');
    if (!shouldPop || !target.isConnected) return;
    void target.offsetWidth;
    target.classList.add('is-touch-pop');
    clearTimeout(target.__worldsTouchPopTimer);
    target.__worldsTouchPopTimer = setTimeout(() => {
      target.classList.remove('is-touch-pop');
    }, 260);
  };

  root.addEventListener('pointerup', (event) => finishTouch(event, true), { passive: true });
  root.addEventListener('pointercancel', (event) => finishTouch(event, false), { passive: true });
  root.addEventListener('lostpointercapture', (event) => finishTouch(event, false), { passive: true });
}

initWorldsTouchFeedback();

function publishedRouteDepth(key) {
  return { worlds: 0, world: 1, rank: 2, gate: 3 }[key] ?? 0;
}

function animatePublishedRouteChange(nextKey) {
  const currentKey = publishedContentState.route?.key || 'worlds';
  if (currentKey === nextKey) return;
  animateWorldsRoute(
    publishedRouteDepth(nextKey) < publishedRouteDepth(currentKey) ? 'back' : 'next'
  );
}

function getPublishedContentApi() {
  const api = window.LootLinguaPublishedContent;
  if (!api) {
    const error = new Error('Published content API is unavailable.');
    error.code = 'published/unavailable';
    throw error;
  }
  return api;
}

function getJourneyContract() {
  const api = window.LootLinguaJourney;
  if (!api) {
    const error = new Error('Journey contract is unavailable.');
    error.code = 'journey/unavailable';
    throw error;
  }
  return api;
}

function getJourneyCloudApi() {
  const api = window.LootLinguaJourneyCloud;
  if (!api) {
    const error = new Error('Journey storage is unavailable.');
    error.code = 'journey/unavailable';
    throw error;
  }
  return api;
}

function getPlacementContract() {
  const api = window.LootLinguaPlacement;
  if (!api) {
    const error = new Error('Placement contract is unavailable.');
    error.code = 'placement/unavailable';
    throw error;
  }
  return api;
}

function getLevelPlacementContract() {
  const api = window.LootLinguaLevelPlacement;
  if (!api) {
    const error = new Error('Level Placement contract is unavailable.');
    error.code = 'level-placement/unavailable';
    throw error;
  }
  return api;
}

function setPublishedPlacementMode(active) {
  document.body.classList.toggle('published-placement-mode', Boolean(active));
  if (active) setTreasureEntryVisible(false);
}

function clearPublishedJourneyViewState(options) {
  publishedContentState.journey = null;
  publishedContentState.activeJourney = null;
  publishedContentState.gateProgress = null;
  publishedContentState.gateProgressById = new Map();
  publishedContentState.newGateWords = [];
  publishedContentState.journeyAction = null;
  publishedContentState.placementBundle = null;
  publishedContentState.placementPending = false;
  publishedContentState.placementFeedback = null;
  publishedContentState.placementFinalizationKey = '';
  publishedContentState.levelPlacementBundle = null;
  publishedContentState.levelPlacementPending = false;
  publishedContentState.levelPlacementFeedback = null;
  publishedContentState.levelPlacementReviewOpen = false;
  if (options?.clearError) publishedContentState.journeyError = null;
  setPublishedPlacementMode(false);
}

async function readPublishedJourneyContext(worldId, options) {
  if (!window.auth?.currentUser) {
    return { journey: null, activeJourney: null };
  }
  try {
    const api = getJourneyCloudApi();
    const [journey, activeJourney] = await Promise.all([
      api.getJourney(worldId, options),
      api.getActiveJourney(options),
    ]);
    return { journey, activeJourney };
  } catch (error) {
    logPublishedContentError('journey-read', error);
    return { journey: null, activeJourney: null };
  }
}

async function readActivePublishedJourney(options) {
  if (!window.auth?.currentUser) return null;
  try {
    return await getJourneyCloudApi().getActiveJourney(options);
  } catch (error) {
    logPublishedContentError('active-journey-read', error);
    return null;
  }
}

async function readPublishedRankGateProgress(worldId, rankId, journey, options) {
  if (!journey || !window.auth?.currentUser) return new Map();
  try {
    return await getJourneyCloudApi().listRankGateProgress(worldId, rankId, options);
  } catch (error) {
    logPublishedContentError('gate-progress-list', error);
    return new Map();
  }
}

async function readPublishedGateProgress(worldId, rankId, gateId, journey, options) {
  if (!journey || !window.auth?.currentUser) return null;
  try {
    return await getJourneyCloudApi().getGateProgress(
      worldId,
      rankId,
      gateId,
      options
    );
  } catch (error) {
    logPublishedContentError('gate-progress-read', error);
    return null;
  }
}

function firstJourneyRank(ranks) {
  return getJourneyContract()
    .stableRankOrder(ranks)
    .find((rank) => getJourneyContract().canAccessRank(rank, null)) || null;
}

function publishedGateJourneyState(gate, rank, gates, ranks, journey, progress) {
  const contract = getJourneyContract();
  const orderedGates = contract.stableContentOrder(gates, 'gateId');
  const firstRank = firstJourneyRank(ranks);
  const firstGate = orderedGates[0] || null;
  const isFirstEligibleGate = Boolean(
    !journey &&
    firstRank &&
    firstGate &&
    String(firstRank.rankId) === String(rank?.rankId) &&
    String(firstGate.gateId) === String(gate?.gateId)
  );
  return contract.getJourneyGateState(journey, progress, gate, {
    rank,
    isFirstEligibleGate,
  });
}

function canRevealPublishedGateWords(gateState, journey) {
  const adminState = typeof window.getLootLinguaAdminState === 'function'
    ? window.getLootLinguaAdminState()
    : null;
  if (adminState?.resolved && adminState.isAdmin) return true;
  return Boolean(journey && gateState !== 'locked');
}

function rerenderPublishedRoute() {
  const routeKey = publishedContentState.route?.key;
  if (routeKey === 'world' && publishedContentState.world) {
    renderPublishedRanks(
      publishedContentState.world,
      publishedContentState.ranks,
      publishedContentState.journey,
      publishedContentState.activeJourney
    );
  } else if (routeKey === 'rank' && publishedContentState.world && publishedContentState.rank) {
    renderPublishedGates(
      publishedContentState.world,
      publishedContentState.rank,
      publishedContentState.gates,
      publishedContentState.ranks,
      publishedContentState.journey,
      publishedContentState.activeJourney,
      publishedContentState.gateProgressById
    );
  } else if (
    routeKey === 'gate' &&
    publishedContentState.world &&
    publishedContentState.rank &&
    publishedContentState.gate
  ) {
    renderPublishedGateWords(
      publishedContentState.world,
      publishedContentState.rank,
      publishedContentState.gate,
      publishedContentState.wordSnapshot
    );
  }
}

function requestJourneySignIn() {
  showToast('سجّل دخولك أولًا لبدء رحلة المحتوى الجاهز.', 'info', 4200);
  const profileModal = document.getElementById('profileModal');
  if (
    typeof window.toggleProfileModal === 'function' &&
    profileModal &&
    !profileModal.classList.contains('open')
  ) {
    window.toggleProfileModal();
  }
}

function publishedJourneyErrorText(error) {
  const code = String(error?.code || '');
  const operation = String(error?.operation || '');
  if (
    (code === 'permission-denied' || code === 'firestore/permission-denied') &&
    (
      operation === 'save-placement-gate-result' ||
      operation === 'complete-placement-session' ||
      operation === 'advance-placement-journey'
    )
  ) {
    return 'أضيفت الكلمات، لكن تعذر حفظ نتيجة الاختبار وتقدم الرحلة.';
  }
  if (
    (code === 'permission-denied' || code === 'firestore/permission-denied') &&
    operation === 'save-placement-answer'
  ) {
    return 'تعذر تثبيت إجابتك الأخيرة. أعد محاولة الحفظ.';
  }
  const messages = {
    'journey/sign-in-required': 'سجّل دخولك أولًا لبدء الرحلة.',
    'journey/rank-locked': 'لا توجد رتبة متاحة لبدء الرحلة.',
    'journey/gate-locked': 'البوابة الأولى مقفلة من إعدادات المحتوى.',
    'journey/not-active': 'فعّل هذه الرحلة أولًا ثم أعد المحاولة.',
    'placement/choice-required': 'اختر اختبار تحديد المستوى أو ابدأ من البداية.',
    'placement/content-changed': 'تغيّرت كلمات البوابة. ألغِ الاختبار وابدأ من البداية.',
    'placement/gate-load-incomplete': 'لم يكتمل تحميل كلمات البوابة. أعد المحاولة.',
    'level-placement/locked': 'أكمل المستوى السابق قبل بدء هذا الاختبار.',
    'level-placement/legacy-active': 'لديك اختبار بوابة قديم غير مكتمل. أكمله أو ألغِه أولًا.',
    'level-placement/no-words': 'لا توجد كلمات كافية لبناء اختبار هذا المستوى.',
    'level-placement/session-active': 'لديك اختبار مستوى نشط بالفعل.',
    'journey/no-published-words': 'لا توجد كلمات منشورة في هذه البوابة لتحميلها.',
    'permission-denied': 'تعذر حفظ كلمات الرحلة في حسابك. أعد المحاولة.',
    'firestore/permission-denied': 'تعذر حفظ كلمات الرحلة في حسابك. أعد المحاولة.',
  };
  return messages[error?.code] || 'تعذر إكمال العملية الآن. أعد المحاولة.';
}

function setPublishedJourneyError(error, operation, retry, worldId) {
  const journeyError = {
    code: String(error?.code || 'journey/operation-failed'),
    message: String(error?.message || 'Journey operation failed.'),
    stack: String(error?.stack || ''),
    operation: String(error?.operation || operation || 'journey'),
    worldId: String(
      worldId ||
      publishedContentState.world?.worldId ||
      publishedContentState.journey?.worldId ||
      ''
    ),
    text: publishedJourneyErrorText(error),
    retry: typeof retry === 'function' ? retry : null,
  };
  publishedContentState.journeyError = journeyError;
  return journeyError;
}

function clearPublishedJourneyError() {
  publishedContentState.journeyError = null;
}

function currentPublishedJourneyError(worldId) {
  const error = publishedContentState.journeyError;
  if (!error) return null;
  if (!error.worldId || String(error.worldId) === String(worldId || '')) return error;
  return null;
}

async function retryPublishedJourneyError() {
  const error = publishedContentState.journeyError;
  if (!error?.retry) return;
  const retry = error.retry;
  clearPublishedJourneyError();
  await retry();
}

async function startOrResumePublishedJourney(world) {
  if (!window.auth?.currentUser) {
    requestJourneySignIn();
    return null;
  }
  const activeJourney = publishedContentState.activeJourney ||
    await getJourneyCloudApi().getActiveJourney();
  if (
    activeJourney &&
    String(activeJourney.worldId) !== String(world.worldId) &&
    !window.confirm('لديك رحلة نشطة في عالم آخر. هل تريد تبديل الرحلة النشطة؟')
  ) {
    return null;
  }

  const journey = publishedContentState.journey ||
    await getJourneyCloudApi().getJourney(world.worldId, { force: true });
  if (!journey || journey.placementStatus === 'not-started') {
    publishedContentState.journeyAction = { type: 'choose-start', pending: false };
    rerenderPublishedRoute();
    return null;
  }
  if (journey.placementStatus === 'active') {
    await showPublishedPlacementResume(world.worldId);
    return journey;
  }

  publishedContentState.journeyAction = { type: 'start', pending: true };
  rerenderPublishedRoute();
  try {
    const api = getJourneyCloudApi();
    const resumed = activeJourney && String(activeJourney.worldId) !== String(world.worldId)
      ? await api.switchActiveJourney(world.worldId)
      : await api.startJourney(world.worldId);
    publishedContentState.journey = resumed;
    publishedContentState.activeJourney = resumed;
    publishedContentState.journeyAction = null;
    clearPublishedJourneyError();
    window.openPublishedGate(
      resumed.worldId,
      resumed.activeRankId,
      resumed.activeGateId
    );
    return resumed;
  } catch (error) {
    const journeyError = setPublishedJourneyError(
      error,
      'start-journey',
      () => startOrResumePublishedJourney(world),
      world.worldId
    );
    publishedContentState.journeyAction = {
      type: 'start',
      pending: false,
    };
    rerenderPublishedRoute();
    showToast(journeyError.text, 'danger', 4800);
    return null;
  }
}

async function beginPublishedJourneyFromStart(world) {
  if (!window.auth?.currentUser) {
    requestJourneySignIn();
    return null;
  }
  const activeJourney = publishedContentState.activeJourney ||
    await getJourneyCloudApi().getActiveJourney();
  if (
    activeJourney &&
    String(activeJourney.worldId) !== String(world.worldId) &&
    !window.confirm('لديك رحلة نشطة في عالم آخر. هل تريد تبديل الرحلة النشطة؟')
  ) {
    return null;
  }
  publishedContentState.journeyAction = { type: 'beginning', pending: true };
  rerenderPublishedRoute();
  try {
    const journey = await getJourneyCloudApi().beginJourneyFromStart(world.worldId);
    publishedContentState.journey = journey;
    publishedContentState.activeJourney = journey;
    publishedContentState.journeyAction = null;
    clearPublishedJourneyError();
    showToast('بدأت رحلتك من البوابة الأولى.', 'success', 3600);
    window.openPublishedGate(
      journey.worldId,
      journey.activeRankId,
      journey.activeGateId
    );
    return journey;
  } catch (error) {
    const journeyError = setPublishedJourneyError(
      error,
      'begin-journey-from-start',
      () => beginPublishedJourneyFromStart(world),
      world.worldId
    );
    publishedContentState.journeyAction = {
      type: 'beginning',
      pending: false,
    };
    rerenderPublishedRoute();
    showToast(journeyError.text, 'danger', 4800);
    return null;
  }
}

async function beginPublishedPlacement(world) {
  if (!window.auth?.currentUser) {
    requestJourneySignIn();
    return null;
  }
  const activeJourney = publishedContentState.activeJourney ||
    await getJourneyCloudApi().getActiveJourney();
  if (
    activeJourney &&
    String(activeJourney.worldId) !== String(world.worldId) &&
    !window.confirm('لديك رحلة نشطة في عالم آخر. هل تريد تبديل الرحلة النشطة؟')
  ) {
    return null;
  }
  publishedContentState.journeyAction = { type: 'placement-start', pending: true };
  rerenderPublishedRoute();
  try {
    const bundle = await getJourneyCloudApi().startPlacement(world.worldId);
    publishedContentState.journey = bundle.journey;
    publishedContentState.activeJourney = bundle.journey;
    publishedContentState.journeyAction = null;
    clearPublishedJourneyError();
    renderPublishedPlacementAssessment(bundle);
    return bundle;
  } catch (error) {
    const journeyError = setPublishedJourneyError(
      error,
      'start-placement',
      () => beginPublishedPlacement(world),
      world.worldId
    );
    publishedContentState.journeyAction = {
      type: 'placement-start',
      pending: false,
    };
    rerenderPublishedRoute();
    showToast(journeyError.text, 'danger', 4800);
    return null;
  }
}

function publishedLevelState(cefrLevel, journey) {
  const level = getLevelPlacementContract().normalizeLevel(cefrLevel);
  if (level === 'unclassified') return 'unclassified';
  if ((journey?.passedCefrLevels || []).includes(level)) return 'passed';
  if (
    String(journey?.activeLevelPlacementCefrLevel || '') === level &&
    ['active', 'awaiting-decision', 'paused'].includes(journey?.levelPlacementStatus)
  ) return 'in-progress';
  if ((journey?.partialCefrLevels || []).includes(level)) return 'partially-passed';
  return getLevelPlacementContract().canStartLevelPlacement(level, journey)
    ? 'available'
    : 'locked';
}

async function beginPublishedLevelPlacement(world, cefrLevel) {
  if (!window.auth?.currentUser) {
    requestJourneySignIn();
    return null;
  }
  if (publishedContentState.levelPlacementPending) return null;
  publishedContentState.levelPlacementPending = true;
  rerenderPublishedRoute();
  try {
    const bundle = await getJourneyCloudApi().startLevelPlacement(
      world.worldId,
      cefrLevel
    );
    publishedContentState.levelPlacementPending = false;
    publishedContentState.levelPlacementBundle = bundle;
    publishedContentState.journey = bundle.journey;
    publishedContentState.activeJourney = bundle.journey;
    clearPublishedJourneyError();
    renderPublishedLevelPlacementAssessment(bundle);
    return bundle;
  } catch (error) {
    publishedContentState.levelPlacementPending = false;
    const journeyError = setPublishedJourneyError(
      error,
      'start-level-placement',
      () => beginPublishedLevelPlacement(world, cefrLevel),
      world.worldId
    );
    rerenderPublishedRoute();
    showToast(journeyError.text, 'danger', 4800);
    return null;
  }
}

async function maybeRenderPublishedLevelPlacementResume(journey, generation) {
  const placement = getLevelPlacementContract();
  if (!placement.shouldResumeLevelPlacement(null, journey)) return false;
  try {
    const bundle = await getJourneyCloudApi().resumeLevelPlacement(journey.worldId);
    if (generation !== publishedContentState.generation) return true;
    if (!placement.shouldResumeLevelPlacement(bundle.session, bundle.journey)) return false;
    publishedContentState.levelPlacementBundle = bundle;
    renderPublishedLevelPlacementResumePrompt(bundle);
    return true;
  } catch (error) {
    if (generation !== publishedContentState.generation) return true;
    setPublishedJourneyError(
      error,
      'resume-level-placement',
      () => showPublishedLevelPlacementResume(journey.worldId),
      journey.worldId
    );
    return false;
  }
}

async function showPublishedLevelPlacementResume(worldId) {
  try {
    const bundle = await getJourneyCloudApi().resumeLevelPlacement(worldId);
    publishedContentState.levelPlacementBundle = bundle;
    if (bundle.session.status === 'active') renderPublishedLevelPlacementResumePrompt(bundle);
    else renderPublishedLevelPlacementResult(bundle);
    return bundle;
  } catch (error) {
    setPublishedJourneyError(
      error,
      'resume-level-placement',
      () => showPublishedLevelPlacementResume(worldId),
      worldId
    );
    rerenderPublishedRoute();
    return null;
  }
}

function renderPublishedLevelPlacementResumePrompt(bundle) {
  const root = publishedViewRoot();
  if (!root) return;
  setPublishedPlacementMode(false);
  const session = bundle.session;
  const section = publishedElement('section', 'published-placement-resume published-level-placement-resume');
  const icon = publishedElement('span', 'published-placement-resume-icon');
  icon.append(publishedIcon('fa-solid fa-chart-line'));
  const copy = publishedElement('div', 'published-placement-resume-copy');
  copy.append(
    publishedElement('strong', '', 'لديك اختبار مستوى غير مكتمل'),
    publishedElement(
      'p',
      '',
      `${session.cefrLevel} · السؤال ${Number(session.currentQuestionIndex) + 1} من ${session.orderedQuestionIds.length}`
    )
  );
  const actions = publishedElement('div', 'published-placement-resume-actions');
  actions.append(
    publishedButton(
      'متابعة الاختبار',
      'published-action-btn published-placement-primary',
      () => renderPublishedLevelPlacementAssessment(bundle),
      'fa-solid fa-play'
    ),
    publishedButton(
      'إلغاء الاختبار',
      'published-action-btn published-placement-secondary',
      () => abandonPublishedLevelPlacement(bundle),
      'fa-solid fa-xmark'
    )
  );
  section.append(icon, copy, actions);
  root.replaceChildren(section);
}

function renderPublishedLevelPlacementAssessment(bundle) {
  const root = publishedViewRoot();
  if (!root) return;
  const session = bundle.session;
  if (session.status !== 'active') {
    renderPublishedLevelPlacementResult(bundle);
    return;
  }
  const question = getLevelPlacementContract().buildQuestion(session);
  if (!question) {
    renderPublishedLevelPlacementResult(bundle);
    return;
  }
  setPublishedPlacementMode(true);
  publishedContentState.levelPlacementBundle = bundle;
  const feedback = publishedContentState.levelPlacementFeedback;
  const pending = publishedContentState.levelPlacementPending;
  const section = publishedElement('section', 'published-placement-view published-level-placement-view');
  const top = publishedElement('header', 'published-placement-top');
  const identity = publishedElement('div', 'published-placement-identity');
  identity.append(
    publishedElement('small', '', bundle.world.title || 'العالم'),
    publishedElement('strong', '', `اختبار مستوى ${session.cefrLevel}`),
    publishedElement('span', '', 'اختبار مختصر موزع على رتب المستوى')
  );
  const exit = publishedElement('button', 'published-placement-exit');
  exit.type = 'button';
  exit.title = 'الخروج من اختبار المستوى';
  exit.setAttribute('aria-label', 'الخروج من اختبار المستوى');
  exit.append(publishedIcon('fa-solid fa-xmark'));
  exit.addEventListener('click', () => renderPublishedLevelPlacementExit(bundle));
  top.append(identity, exit);

  const progress = publishedElement('div', 'published-placement-progress');
  const progressLabel = publishedElement('span', 'published-placement-progress-label');
  progressLabel.append(
    publishedElement('strong', '', `${question.questionNumber} / ${question.totalQuestions}`),
    publishedElement('small', '', session.adaptiveRound ? 'جولة التحديد الإضافية' : 'السؤال الحالي')
  );
  const track = publishedElement('span', 'published-placement-progress-track');
  const fill = publishedElement('span', 'published-placement-progress-fill');
  fill.style.width = `${Math.max(4, (session.currentQuestionIndex / question.totalQuestions) * 100)}%`;
  track.append(fill);
  progress.append(progressLabel, track);

  const questionBox = publishedElement('div', 'published-placement-question');
  questionBox.append(
    publishedElement('small', '', 'اختر المعنى الصحيح'),
    publishedElement('h3', '', question.prompt)
  );
  questionBox.querySelector('h3')?.setAttribute('dir', 'ltr');
  const options = publishedElement('div', 'published-placement-options');
  question.options.forEach((option, index) => {
    const button = publishedElement('button', 'published-placement-option');
    button.type = 'button';
    button.disabled = pending || Boolean(feedback);
    button.append(
      publishedElement('span', 'published-placement-option-key', String(index + 1)),
      publishedElement('span', 'published-placement-option-text', option.text)
    );
    if (feedback) {
      const isCorrect = option.questionId === question.questionId;
      const isSelected = option.questionId === feedback.selectedId;
      if (isCorrect) button.classList.add('is-correct');
      if (isSelected && !isCorrect) button.classList.add('is-incorrect');
    }
    button.addEventListener('click', () => submitPublishedLevelPlacementAnswer(
      bundle,
      question,
      option.questionId
    ));
    options.append(button);
  });
  const feedbackText = publishedElement(
    'p',
    'published-placement-feedback',
    feedback ? (feedback.correct ? 'إجابة صحيحة.' : 'تم تثبيت الإجابة.') : ''
  );
  feedbackText.setAttribute('aria-live', 'polite');
  section.append(top, progress, questionBox, options, feedbackText);
  root.replaceChildren(section);
}

async function submitPublishedLevelPlacementAnswer(bundle, question, selectedId) {
  if (publishedContentState.levelPlacementPending || publishedContentState.levelPlacementFeedback) return;
  const correct = String(selectedId) === String(question.questionId);
  publishedContentState.levelPlacementPending = true;
  publishedContentState.levelPlacementFeedback = { selectedId: String(selectedId), correct };
  renderPublishedLevelPlacementAssessment(bundle);
  try {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 100 : 620));
    const beforeRound = Number(bundle.session.adaptiveRound || 0);
    const next = await getJourneyCloudApi().answerLevelPlacementQuestion(
      bundle.journey.worldId,
      bundle.session.assessmentId,
      selectedId
    );
    publishedContentState.levelPlacementPending = false;
    publishedContentState.levelPlacementFeedback = null;
    publishedContentState.levelPlacementBundle = next;
    publishedContentState.journey = next.journey;
    publishedContentState.activeJourney = next.journey;
    if (next.session.status === 'active') {
      if (Number(next.session.adaptiveRound || 0) > beforeRound) {
        showToast('نحتاج سؤالين إضافيين لتحديد مكانك بدقة.', 'info', 3600);
      }
      renderPublishedLevelPlacementAssessment(next);
      return;
    }
    renderPublishedLevelPlacementResult(next);
  } catch (error) {
    publishedContentState.levelPlacementPending = false;
    publishedContentState.levelPlacementFeedback = null;
    showToast(publishedJourneyErrorText(error), 'danger', 4800);
    renderPublishedLevelPlacementAssessment(bundle);
  }
}

function appendPublishedLevelPlacementStats(section, session) {
  if (!publishedContentState.levelPlacementReviewOpen) return;
  const list = publishedElement('div', 'published-level-result-list');
  (session.orderedRankIds || []).forEach((rankId) => {
    const stat = session.perRankStats?.[rankId] || {};
    const row = publishedElement('div', 'published-level-result-row');
    row.append(
      publishedElement('strong', '', session.rankTitles?.[rankId] || rankId),
      publishedElement('span', '', `${Number(stat.correct) || 0} / ${Number(stat.asked) || 0}`),
      publishedElement('small', '', {
        passed: 'متجاوزة',
        failed: 'نقطة تعلم',
        ambiguous: 'تحتاج مراجعة',
        'insufficient-sample': 'عينة محدودة',
      }[stat.status] || '')
    );
    list.append(row);
  });
  section.append(list);
}

function renderPublishedLevelPlacementResult(bundle) {
  const root = publishedViewRoot();
  if (!root) return;
  setPublishedPlacementMode(false);
  const session = bundle.session;
  const passedLevel = Boolean(session.passedLevel);
  const rankName = session.rankTitles?.[session.recommendedStartRankId] || 'الرتبة المقترحة';
  const section = publishedElement(
    'section',
    `published-placement-result published-level-placement-result ${passedLevel ? 'is-passed' : 'is-learning'}`
  );
  section.append(
    publishedIcon(passedLevel ? 'fa-solid fa-circle-check' : 'fa-solid fa-location-dot'),
    publishedElement(
      'strong',
      '',
      passedLevel
        ? `اجتزت مستوى ${session.cefrLevel}.`
        : 'حددنا أفضل نقطة لبداية رحلتك.'
    ),
    publishedElement(
      'p',
      '',
      passedLevel
        ? 'تم حفظ نتيجة المستوى وفتح المستوى التالي دون بدء اختبار جديد تلقائيًا.'
        : `أساسياتك جيدة. أفضل نقطة تبدأ منها هي رتبة «${rankName}».`
    ),
    publishedElement(
      'span',
      'published-placement-result-score',
      `${Number(session.correctCount) || 0} / ${(session.answers || []).length}`
    )
  );

  const savePanel = publishedElement('div', 'published-level-save-panel');
  savePanel.append(publishedElement('strong', '', 'هل تريد حفظ كلمات الاختبار للمراجعة؟'));
  const saveActions = publishedElement('div', 'published-placement-resume-actions');
  const pendingWordIds = session.saveWordPendingIds || [];
  const saveChoiceResolved = session.saveWordChoice !== 'undecided';
  const saveDecisionComplete = saveChoiceResolved && pendingWordIds.length === 0;
  if (pendingWordIds.length) {
    saveActions.append(publishedButton(
      'إعادة حفظ الكلمات المتعثرة',
      'published-action-btn published-placement-primary',
      () => savePublishedLevelPlacementWords(bundle, session.saveWordChoice),
      'fa-solid fa-rotate-right'
    ));
  } else if (!saveChoiceResolved) {
    saveActions.append(
      publishedButton(
        'حفظ الكلمات التي أخطأت بها فقط',
        'published-action-btn published-placement-primary',
        () => savePublishedLevelPlacementWords(bundle, 'incorrect-only'),
        'fa-solid fa-bookmark'
      ),
      publishedButton(
        'حفظ جميع كلمات الاختبار',
        'published-action-btn',
        () => savePublishedLevelPlacementWords(bundle, 'all'),
        'fa-solid fa-layer-group'
      ),
      publishedButton(
        'عدم حفظ الكلمات',
        'published-action-btn published-placement-secondary',
        () => savePublishedLevelPlacementWords(bundle, 'none'),
        'fa-solid fa-ban'
      )
    );
  } else {
    const summary = session.saveWordSummary || {};
    savePanel.append(publishedElement(
      'span',
      'published-level-save-summary',
      session.saveWordChoice === 'none'
        ? 'اخترت عدم حفظ كلمات الاختبار.'
        : levelPlacementSaveSummaryText(summary)
    ));
    if (session.saveWordChoice !== 'none' && (session.saveWordSavedIds || []).length) {
      saveActions.append(publishedButton(
        'إنشاء عالم للكلمات',
        'published-action-btn',
        () => openLevelPlacementWorldSuggestion(bundle),
        'fa-solid fa-plus'
      ));
    }
  }
  savePanel.append(saveActions);
  section.append(savePanel);

  const actions = publishedElement('div', 'published-placement-resume-actions');
  if (saveDecisionComplete && passedLevel && session.nextCefrLevel) {
    actions.append(publishedButton(
      `اختبار مستوى ${session.nextCefrLevel}`,
      'published-action-btn published-placement-primary',
      () => continueToNextPublishedLevel(bundle),
      'fa-solid fa-chart-line'
    ));
  } else if (
    saveDecisionComplete &&
    session.recommendedStartRankId &&
    session.recommendedStartGateId
  ) {
    actions.append(publishedButton(
      'ابدأ من هذه الرتبة',
      'published-action-btn published-placement-primary',
      () => beginPublishedJourneyAtLevelResult(bundle),
      'fa-solid fa-play'
    ));
  }
  actions.append(
    publishedButton(
      publishedContentState.levelPlacementReviewOpen ? 'إخفاء النتيجة' : 'مراجعة النتيجة',
      'published-action-btn',
      () => {
        publishedContentState.levelPlacementReviewOpen = !publishedContentState.levelPlacementReviewOpen;
        renderPublishedLevelPlacementResult(bundle);
      },
      'fa-solid fa-list-check'
    ),
    publishedButton(
      'التوقف هنا',
      'published-action-btn published-placement-secondary',
      () => pausePublishedLevelPlacement(bundle),
      'fa-regular fa-clock'
    )
  );
  section.append(actions);
  appendPublishedLevelPlacementStats(section, session);
  root.replaceChildren(section);
}

function levelPlacementSaveSummaryText(summary) {
  const parts = [
    `${Number(summary?.created) || 0} جديدة`,
    `${Number(summary?.sourceLinked) || 0} موجودة وربطناها بالاختبار`,
    `${Number(summary?.alreadyLinked) || 0} مرتبطة مسبقًا`,
  ];
  if (Number(summary?.updatedMissingFields) > 0) {
    parts.push(`أكملنا بيانات ${Number(summary.updatedMissingFields)} موجودة`);
  }
  if (Number(summary?.restored) > 0) {
    parts.push(`استعدنا ${Number(summary.restored)} مخفية مع تقدمها`);
  }
  return `تم حفظ كلمات الاختبار: ${parts.join('، ')}.`;
}

async function savePublishedLevelPlacementWords(bundle, choice) {
  if (publishedContentState.levelPlacementPending) return;
  publishedContentState.levelPlacementPending = true;
  try {
    const result = await getJourneyCloudApi().saveLevelPlacementWords(
      bundle.journey.worldId,
      bundle.session.assessmentId,
      choice
    );
    publishedContentState.levelPlacementPending = false;
    const next = { ...bundle, session: result.session };
    publishedContentState.levelPlacementBundle = next;
    const summary = result.summary;
    const message = result.partial
      ? `تم حفظ ${result.saved} من ${result.total} كلمات. تعذر حفظ ${result.failures.length} ويمكنك إعادة المحاولة.`
      : (choice === 'none'
        ? 'لم تُحفظ أي كلمة من الاختبار.'
        : levelPlacementSaveSummaryText(summary));
    showToast(message, result.partial ? 'warning' : 'success', 6200);
    renderPublishedLevelPlacementResult(next);
  } catch (error) {
    publishedContentState.levelPlacementPending = false;
    showToast(publishedJourneyErrorText(error), 'danger', 5200);
    renderPublishedLevelPlacementResult(bundle);
  }
}

async function beginPublishedJourneyAtLevelResult(bundle) {
  const journey = await getJourneyCloudApi().finishLevelPlacement(
    bundle.journey.worldId,
    bundle.session.assessmentId,
    'complete'
  );
  publishedContentState.journey = journey;
  publishedContentState.activeJourney = journey;
  window.openPublishedGate(journey.worldId, journey.activeRankId, journey.activeGateId);
}

async function continueToNextPublishedLevel(bundle) {
  const journey = await getJourneyCloudApi().finishLevelPlacement(
    bundle.journey.worldId,
    bundle.session.assessmentId,
    'complete'
  );
  publishedContentState.journey = journey;
  publishedContentState.activeJourney = journey;
  await beginPublishedLevelPlacement(bundle.world, bundle.session.nextCefrLevel);
}

async function pausePublishedLevelPlacement(bundle) {
  await getJourneyCloudApi().finishLevelPlacement(
    bundle.journey.worldId,
    bundle.session.assessmentId,
    'pause'
  );
  setPublishedPlacementMode(false);
  window.openPublishedWorldsRoot();
}

function renderPublishedLevelPlacementExit(bundle) {
  const root = publishedViewRoot();
  if (!root) return;
  setPublishedPlacementMode(false);
  const section = publishedElement('section', 'published-placement-exit-view');
  section.append(
    publishedIcon('fa-solid fa-door-open'),
    publishedElement('strong', '', 'ماذا تريد أن تفعل؟'),
    publishedElement('p', '', 'يمكنك متابعة الاختبار من السؤال نفسه لاحقًا، أو إلغاؤه صراحةً.')
  );
  const actions = publishedElement('div', 'published-placement-exit-actions');
  actions.append(
    publishedButton('متابعة الاختبار', 'published-action-btn published-placement-primary', () => renderPublishedLevelPlacementAssessment(bundle), 'fa-solid fa-play'),
    publishedButton('متابعة لاحقًا', 'published-action-btn', () => window.openPublishedWorld(bundle.journey.worldId), 'fa-regular fa-clock'),
    publishedButton('إلغاء الاختبار', 'published-action-btn published-placement-secondary', () => abandonPublishedLevelPlacement(bundle), 'fa-solid fa-xmark')
  );
  section.append(actions);
  root.replaceChildren(section);
}

async function abandonPublishedLevelPlacement(bundle) {
  if (!window.confirm('إلغاء اختبار المستوى؟ ستبقى رحلة العالم محفوظة.')) return;
  await getJourneyCloudApi().abandonLevelPlacement(bundle.journey.worldId);
  setPublishedPlacementMode(false);
  window.openPublishedWorld(bundle.journey.worldId);
}

function openLevelPlacementWorldSuggestion(bundle) {
  window.__pendingLevelPlacementWorldContext = {
    assessmentId: bundle.session.assessmentId,
    worldId: bundle.session.worldId,
    cefrLevel: bundle.session.cefrLevel,
    selectedContentWordIds: bundle.session.selectedContentWordIds,
  };
  window.openCustomWorldModal({
    suggestedName: `ثغراتي في ${bundle.session.cefrLevel}`,
    suggestedDescription: 'كلمات من اختبار تحديد المستوى',
    levelPlacementAssessmentId: bundle.session.assessmentId,
  });
}

function updatePublishedGateProgressText(progress) {
  const target = document.querySelector('.published-journey-progress');
  if (!target) return;
  target.textContent = `تم تحميل ${progress.completed} من ${progress.total}`;
}

async function runPublishedGateLoad(syncOnly) {
  const { world, rank, gate } = publishedContentState;
  if (!world || !rank || !gate) return;
  if (!window.auth?.currentUser) {
    requestJourneySignIn();
    return;
  }
  const activeForWorld = String(publishedContentState.activeJourney?.worldId || '') ===
    String(world.worldId);
  if (!activeForWorld) {
    await startOrResumePublishedJourney(world);
    return;
  }

  publishedContentState.journeyAction = {
    type: syncOnly ? 'sync' : 'load',
    pending: true,
    completed: 0,
    total: syncOnly ? publishedContentState.newGateWords.length : Number(gate.wordCount) || 0,
  };
  rerenderPublishedRoute();
  try {
    const api = getJourneyCloudApi();
    const options = {
      onProgress(progress) {
        publishedContentState.journeyAction = {
          ...publishedContentState.journeyAction,
          ...progress,
        };
        updatePublishedGateProgressText(progress);
      },
    };
    const result = syncOnly
      ? await api.syncNewGateWords(world.worldId, rank.rankId, gate.gateId, options)
      : await api.loadGateWords(world.worldId, rank.rankId, gate.gateId, options);
    if (result.advancement?.advanced) {
      const journeyContext = await readPublishedJourneyContext(world.worldId, { force: true });
      publishedContentState.journey = journeyContext.journey;
      publishedContentState.activeJourney = journeyContext.activeJourney;
    }
    publishedContentState.gateProgress = await api.getGateProgress(
      world.worldId,
      rank.rankId,
      gate.gateId,
      { force: true }
    );
    publishedContentState.gateProgressById.set(
      String(gate.gateId),
      publishedContentState.gateProgress
    );
    publishedContentState.newGateWords = result.partial
      ? publishedContentState.newGateWords
      : [];
    if (result.partial) {
      const partialError = new Error(
        result.errorMessage ||
          `Gate loaded ${result.completed} of ${result.total} words.`
      );
      partialError.code = result.errorCode || 'journey/gate-load-incomplete';
      partialError.operation = result.errorOperation || 'link-published-word';
      const journeyError = setPublishedJourneyError(
        partialError,
        partialError.operation,
        () => runPublishedGateLoad(syncOnly),
        world.worldId
      );
      publishedContentState.journeyAction = {
        type: syncOnly ? 'sync' : 'load',
        pending: false,
        completed: result.completed,
        total: result.total,
        partial: true,
      };
    } else {
      publishedContentState.journeyAction = null;
      clearPublishedJourneyError();
    }
    rerenderPublishedRoute();
    if (!result.advancement?.advanced) {
      const summary = result.summary || {};
      const parts = [
        Number(summary.created) ? `${Number(summary.created)} جديدة` : '',
        Number(summary.sourceLinked) ? `${Number(summary.sourceLinked)} موجودة رُبطت بالرحلة` : '',
        Number(summary.updatedMissingFields) ? `${Number(summary.updatedMissingFields)} اكتملت بياناتها` : '',
        Number(summary.alreadyLinked) ? `${Number(summary.alreadyLinked)} مرتبطة مسبقًا` : '',
        Number(summary.hiddenPreserved) ? `${Number(summary.hiddenPreserved)} مخفية بقيت محفوظة` : '',
      ].filter(Boolean);
      showToast(
        result.partial
          ? `تمت معالجة ${result.completed} من ${result.total}. تعذر حفظ ${result.failures.length} ويمكنك إعادة المحاولة.`
          : (parts.length
            ? `أصبحت البوابة جاهزة: ${parts.join('، ')}.`
            : (syncOnly ? 'تمت مزامنة الكلمات الجديدة.' : 'تم تحميل البوابة وبدء التعلم.')),
        result.partial ? 'warning' : 'success',
        5600
      );
    }
  } catch (error) {
    const journeyError = setPublishedJourneyError(
      error,
      syncOnly ? 'sync-gate-words' : 'load-gate-words',
      () => runPublishedGateLoad(syncOnly),
      world.worldId
    );
    publishedContentState.journeyAction = {
      type: syncOnly ? 'sync' : 'load',
      pending: false,
    };
    rerenderPublishedRoute();
    showToast(journeyError.text, 'danger', 4800);
  }
}

function syncPublishedPlacementRoute(bundle) {
  const params = {
    worldId: String(bundle?.journey?.worldId || ''),
    rankId: String(bundle?.session?.rankId || ''),
    gateId: String(bundle?.session?.currentGateId || ''),
  };
  if (!params.worldId || !params.rankId || !params.gateId) return;
  publishedContentState.route = { key: 'gate', params };
  setPublishedContentRoute('gate', params, {
    replace: true,
    source: 'placement',
  });
}

async function showPublishedPlacementResume(worldId) {
  try {
    const bundle = await getJourneyCloudApi().resumePlacement(worldId);
    clearPublishedJourneyError();
    renderPublishedPlacementResumePrompt(bundle);
    return bundle;
  } catch (error) {
    setPublishedJourneyError(
      error,
      'resume-placement',
      () => showPublishedPlacementResume(worldId),
      worldId
    );
    rerenderPublishedRoute();
    return null;
  }
}

function renderPublishedPlacementResumePrompt(bundle) {
  const root = publishedViewRoot();
  if (!root) return;
  if (['submitting', 'completed'].includes(bundle?.session?.status)) {
    retryPublishedPlacementFinalization(bundle);
    return;
  }
  setPublishedPlacementMode(false);
  publishedContentState.placementBundle = bundle;
  publishedContentState.journey = bundle.journey;
  publishedContentState.activeJourney = bundle.journey;
  syncPublishedPlacementRoute(bundle);

  const section = publishedElement('section', 'published-placement-resume');
  const icon = publishedElement('span', 'published-placement-resume-icon');
  icon.append(publishedIcon('fa-solid fa-location-crosshairs'));
  const copy = publishedElement('div', 'published-placement-resume-copy');
  copy.append(
    publishedElement('strong', '', 'لديك اختبار تحديد غير مكتمل'),
    publishedElement(
      'p',
      '',
      `${bundle.rank.title || 'الرتبة'} · ${bundle.gate.title || 'البوابة'} · السؤال ${Number(bundle.session.currentQuestionIndex) + 1} من ${bundle.session.totalQuestions}`
    )
  );
  const actions = publishedElement('div', 'published-placement-resume-actions');
  actions.append(
    publishedButton(
      'متابعة الاختبار',
      'published-action-btn published-placement-primary',
      () => renderPublishedPlacementAssessment(bundle),
      'fa-solid fa-play'
    ),
    publishedButton(
      'إلغاء والبدء من البداية',
      'published-action-btn published-placement-secondary',
      () => abandonPublishedPlacement(bundle),
      'fa-solid fa-arrow-rotate-left'
    )
  );
  section.append(icon, copy, actions);
  root.replaceChildren(section);
}

function renderPublishedPlacementAssessment(bundle) {
  const root = publishedViewRoot();
  if (!root) return;
  if (['submitting', 'completed'].includes(bundle?.session?.status)) {
    retryPublishedPlacementFinalization(bundle);
    return;
  }
  const question = getPlacementContract().buildQuestion(bundle.words, bundle.session);
  if (!question) {
    renderPublishedPlacementResult({
      passed: false,
      journeyCompleted: false,
      bundle,
      error: 'تعذر العثور على السؤال الحالي.',
    });
    return;
  }
  publishedContentState.placementBundle = bundle;
  setPublishedPlacementMode(true);
  syncPublishedPlacementRoute(bundle);

  const session = bundle.session;
  const feedback = publishedContentState.placementFeedback;
  const pending = publishedContentState.placementPending;
  const section = publishedElement('section', 'published-placement-view');
  const top = publishedElement('header', 'published-placement-top');
  const identity = publishedElement('div', 'published-placement-identity');
  identity.append(
    publishedElement('small', '', bundle.world.title || 'العالم'),
    publishedElement('strong', '', bundle.rank.title || 'الرتبة'),
    publishedElement('span', '', bundle.gate.title || 'البوابة')
  );
  const exit = publishedElement('button', 'published-placement-exit');
  exit.type = 'button';
  exit.title = 'الخروج من اختبار تحديد المستوى';
  exit.setAttribute('aria-label', 'الخروج من اختبار تحديد المستوى');
  exit.append(publishedIcon('fa-solid fa-xmark'));
  exit.addEventListener('click', () => renderPublishedPlacementExit(bundle));
  top.append(identity, exit);

  const progress = publishedElement('div', 'published-placement-progress');
  const progressLabel = publishedElement('span', 'published-placement-progress-label');
  progressLabel.append(
    publishedElement('strong', '', `${question.questionNumber} / ${question.totalQuestions}`),
    publishedElement('small', '', 'السؤال الحالي')
  );
  const track = publishedElement('span', 'published-placement-progress-track');
  const fill = publishedElement('span', 'published-placement-progress-fill');
  fill.style.width = `${Math.max(
    4,
    (Number(session.currentQuestionIndex) / Number(session.totalQuestions)) * 100
  )}%`;
  track.append(fill);
  progress.append(progressLabel, track);

  const questionBox = publishedElement('div', 'published-placement-question');
  questionBox.append(
    publishedElement('small', '', 'اختر المعنى الصحيح'),
    publishedElement('h3', '', question.prompt)
  );
  questionBox.querySelector('h3')?.setAttribute('dir', 'ltr');

  const options = publishedElement('div', 'published-placement-options');
  question.options.forEach((option, index) => {
    const button = publishedElement('button', 'published-placement-option');
    button.type = 'button';
    button.disabled = pending || Boolean(feedback);
    button.dataset.optionId = option.contentWordId;
    button.append(
      publishedElement('span', 'published-placement-option-key', String(index + 1)),
      publishedElement('span', 'published-placement-option-text', option.text)
    );
    if (feedback) {
      const isCorrect = option.contentWordId === question.contentWordId;
      const isSelected = option.contentWordId === feedback.selectedId;
      if (isCorrect) button.classList.add('is-correct');
      if (isSelected && !isCorrect) button.classList.add('is-incorrect');
    }
    button.addEventListener('click', () => submitPublishedPlacementAnswer(
      bundle,
      question,
      option.contentWordId
    ));
    options.append(button);
  });

  const feedbackText = publishedElement(
    'p',
    'published-placement-feedback',
    feedback
      ? (feedback.correct ? 'إجابة صحيحة.' : 'تم تثبيت الإجابة. نكمل للسؤال التالي.')
      : ''
  );
  feedbackText.setAttribute('aria-live', 'polite');
  section.append(top, progress, questionBox, options, feedbackText);
  root.replaceChildren(section);
}

async function submitPublishedPlacementAnswer(bundle, question, selectedId) {
  if (publishedContentState.placementPending || publishedContentState.placementFeedback) return;
  const correct = String(selectedId) === String(question.contentWordId);
  const finalAnswer = question.questionNumber === question.totalQuestions;
  publishedContentState.placementPending = true;
  publishedContentState.placementFeedback = { selectedId: String(selectedId), correct };
  renderPublishedPlacementAssessment(bundle);
  try {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 120 : 820));
    if (finalAnswer) renderPublishedPlacementSaving(bundle);
    const result = await getJourneyCloudApi().answerPlacementQuestion(
      bundle.journey.worldId,
      bundle.session.assessmentId,
      selectedId
    );
    publishedContentState.placementPending = false;
    publishedContentState.placementFeedback = null;
    publishedContentState.placementFinalizationKey = '';
    if (!result.completed) {
      renderPublishedPlacementAssessment(result.bundle);
      return;
    }
    if (result.continuationAvailable) {
      renderPublishedPlacementDecision(result);
      return;
    }
    renderPublishedPlacementResult(result);
  } catch (error) {
    publishedContentState.placementPending = false;
    publishedContentState.placementFeedback = null;
    if (finalAnswer) {
      renderPublishedPlacementSaveError(bundle, selectedId, error);
      return;
    }
    showToast(publishedJourneyErrorText(error), 'danger', 4800);
    renderPublishedPlacementAssessment(bundle);
  }
}

function renderPublishedPlacementSaving(bundle) {
  const root = publishedViewRoot();
  if (!root) return;
  setPublishedPlacementMode(true);
  if (bundle) syncPublishedPlacementRoute(bundle);
  const state = publishedElement('section', 'published-placement-transition');
  state.append(
    publishedIcon('fa-solid fa-circle-notch fa-spin'),
    publishedElement('strong', '', 'جارٍ حفظ نتيجتك وكلمات البوابة...'),
    publishedElement('span', '', 'لن تحتاج إلى إعادة الإجابة عن السؤال الأخير.')
  );
  state.setAttribute('role', 'status');
  state.setAttribute('aria-live', 'polite');
  root.replaceChildren(state);
}

function renderPublishedPlacementSaveError(bundle, selectedId, error) {
  const root = publishedViewRoot();
  if (!root) return;
  setPublishedPlacementMode(true);
  const operation = String(error?.operation || '');
  const answerWasSaved = operation === 'save-placement-gate-result' ||
    operation === 'complete-placement-session' ||
    operation === 'advance-placement-journey';
  const gateResultWasSaved = operation === 'complete-placement-session' ||
    operation === 'advance-placement-journey';
  const sessionWasCompleted = operation === 'advance-placement-journey';
  const state = publishedElement('section', 'published-placement-result is-learning');
  state.append(
    publishedIcon('fa-solid fa-triangle-exclamation'),
    publishedElement('strong', '', 'تعذر إكمال حفظ نتيجة الاختبار.'),
    publishedElement(
      'p',
      '',
      sessionWasCompleted
        ? 'حُفظت نتيجة البوابة واكتملت الجلسة، لكن تعذر تحديث نقطة الرحلة. أعد محاولة هذه الخطوة فقط.'
        : gateResultWasSaved
          ? 'حُفظت نتيجة البوابة، لكن تعذر إتمام الجلسة. أعد محاولة هذه الخطوة فقط.'
        : answerWasSaved
          ? 'أضيفت كلمات البوابة وثُبتت إجابتك الأخيرة، لكن تعذر حفظ نتيجة البوابة. أعد محاولة هذه الخطوة فقط.'
        : 'لم نتلق تأكيد تثبيت الإجابة الأخيرة. أعد المحاولة؛ إن كانت وصلت إلى الخادم فسيُستكمل الحفظ دون تكرارها.'
    )
  );
  const code = String(error?.code || '').trim();
  if (code) state.append(publishedElement('span', 'published-placement-result-score', code));
  state.append(publishedButton(
    'إعادة محاولة الحفظ',
    'published-action-btn published-placement-primary',
    () => retryPublishedPlacementFinalization(bundle, selectedId),
    'fa-solid fa-rotate-right'
  ));
  root.replaceChildren(state);
}

async function retryPublishedPlacementFinalization(bundle, selectedId) {
  if (!bundle?.journey?.worldId || !bundle?.session?.assessmentId) return;
  if (publishedContentState.placementPending) return;
  const key = `${bundle.journey.worldId}/${bundle.session.assessmentId}`;
  publishedContentState.placementPending = true;
  publishedContentState.placementFinalizationKey = key;
  renderPublishedPlacementSaving(bundle);
  try {
    const api = getJourneyCloudApi();
    const result = selectedId
      ? await api.answerPlacementQuestion(
        bundle.journey.worldId,
        bundle.session.assessmentId,
        selectedId
      )
      : await api.finalizePlacementResult(
        bundle.journey.worldId,
        bundle.session.assessmentId
      );
    publishedContentState.placementPending = false;
    publishedContentState.placementFeedback = null;
    publishedContentState.placementFinalizationKey = '';
    if (result.continuationAvailable) {
      renderPublishedPlacementDecision(result);
    } else {
      renderPublishedPlacementResult(result);
    }
  } catch (error) {
    publishedContentState.placementPending = false;
    publishedContentState.placementFinalizationKey = '';
    renderPublishedPlacementSaveError(bundle, selectedId, error);
  }
}

function renderPublishedPlacementDecision(result) {
  const root = publishedViewRoot();
  if (!root) return;
  setPublishedPlacementMode(false);
  const session = result.session || {};
  const nextGateName = result.nextGate?.title || 'البوابة التالية';
  const nextRankName = result.nextRank?.title || '';
  const section = publishedElement('section', 'published-placement-result is-passed');
  section.append(
    publishedIcon('fa-solid fa-circle-check'),
    publishedElement('strong', '', 'أحسنت، اجتزت هذه البوابة.'),
    publishedElement(
      'p',
      '',
      nextRankName
        ? `نقطة التحديد التالية: ${nextRankName} · ${nextGateName}`
        : `نقطة التحديد التالية: ${nextGateName}`
    ),
    publishedElement(
      'span',
      'published-placement-result-score',
      `${Number(session.correctCount) || 0} / ${Number(session.totalQuestions) || 0}`
    )
  );
  const actions = publishedElement('div', 'published-placement-resume-actions');
  actions.append(
    publishedButton(
      'اختبر البوابة التالية',
      'published-action-btn published-placement-primary',
      () => continuePublishedPlacement(result),
      'fa-solid fa-arrow-left'
    ),
    publishedButton(
      'توقف هنا وابدأ رحلتك',
      'published-action-btn published-placement-secondary',
      () => stopPublishedPlacement(result),
      'fa-solid fa-book-open-reader'
    )
  );
  section.append(actions);
  root.replaceChildren(section);
}

async function continuePublishedPlacement(result) {
  if (publishedContentState.placementPending) return;
  publishedContentState.placementPending = true;
  const root = publishedViewRoot();
  if (root) {
    const state = publishedElement('section', 'published-placement-transition');
    state.append(
      publishedIcon('fa-solid fa-circle-notch fa-spin'),
      publishedElement('strong', '', 'جارٍ تجهيز البوابة التالية...'),
      publishedElement('span', '', result.nextGate?.title || 'البوابة التالية')
    );
    root.replaceChildren(state);
  }
  try {
    const bundle = await getJourneyCloudApi().continuePlacement(result.journey.worldId);
    publishedContentState.placementPending = false;
    publishedContentState.journey = bundle.journey;
    publishedContentState.activeJourney = bundle.journey;
    renderPublishedPlacementAssessment(bundle);
  } catch (error) {
    publishedContentState.placementPending = false;
    showToast(publishedJourneyErrorText(error), 'danger', 4800);
    renderPublishedPlacementDecision(result);
  }
}

async function stopPublishedPlacement(result) {
  if (publishedContentState.placementPending) return;
  publishedContentState.placementPending = true;
  try {
    const journey = await getJourneyCloudApi().stopPlacement(result.journey.worldId);
    publishedContentState.placementPending = false;
    publishedContentState.journey = journey;
    publishedContentState.activeJourney = journey;
    setPublishedPlacementMode(false);
    window.openPublishedGate(
      journey.worldId,
      journey.activeRankId,
      journey.activeGateId
    );
  } catch (error) {
    publishedContentState.placementPending = false;
    showToast(publishedJourneyErrorText(error), 'danger', 4800);
    renderPublishedPlacementDecision(result);
  }
}

function renderPublishedPlacementResult(result) {
  const root = publishedViewRoot();
  if (!root) return;
  setPublishedPlacementMode(false);
  const passed = Boolean(result.passed);
  const resultSession = result.session || result.bundle?.session || null;
  const section = publishedElement(
    'section',
    `published-placement-result ${passed ? 'is-passed' : 'is-learning'}`
  );
  section.append(publishedIcon(
    passed ? 'fa-solid fa-flag-checkered' : 'fa-solid fa-location-dot'
  ));
  section.append(publishedElement(
    'strong',
    '',
    result.error
      ? result.error
      : passed
        ? 'تم تحديد مستواك عند نهاية المحتوى المتاح.'
        : 'هذه أفضل نقطة لبدء رحلتك.'
  ));
  section.append(publishedElement(
    'p',
    '',
    passed
      ? 'تم اجتياز المحتوى المتاح في اختبار التحديد، وتبقى الكلمات ضمن رحلة المراجعة.'
      : 'أصبحت كلمات هذه البوابة في قاموسك، ويمكنك البدء بتعلّمها الآن.'
  ));
  if (resultSession?.totalQuestions) {
    section.append(publishedElement(
      'span',
      'published-placement-result-score',
      `${Number(resultSession.correctCount) || 0} / ${Number(resultSession.totalQuestions) || 0}`
    ));
  }
  const action = publishedButton(
    passed ? 'مراجعة العالم' : 'ابدأ رحلة التعلم',
    'published-action-btn published-placement-primary',
    () => {
      if (passed) {
        window.openPublishedWorld(result.journey?.worldId || result.session?.worldId);
      } else {
        window.loadPersonalDictionary();
      }
    },
    passed ? 'fa-solid fa-earth-americas' : 'fa-solid fa-book-open-reader'
  );
  section.append(action);
  root.replaceChildren(section);
}

function renderPublishedPlacementExit(bundle) {
  const root = publishedViewRoot();
  if (!root) return;
  const section = publishedElement('section', 'published-placement-exit-view');
  section.append(
    publishedIcon('fa-solid fa-door-open'),
    publishedElement('strong', '', 'ماذا تريد أن تفعل؟'),
    publishedElement('p', '', 'يمكنك متابعة الاختبار لاحقًا من نفس السؤال، أو إلغاؤه والبدء من أول بوابة.')
  );
  const actions = publishedElement('div', 'published-placement-exit-actions');
  actions.append(
    publishedButton(
      'متابعة الاختبار',
      'published-action-btn published-placement-primary',
      () => renderPublishedPlacementAssessment(bundle),
      'fa-solid fa-play'
    ),
    publishedButton(
      'متابعة لاحقًا',
      'published-action-btn',
      () => {
        setPublishedPlacementMode(false);
        window.openPublishedWorldsRoot();
      },
      'fa-regular fa-clock'
    ),
    publishedButton(
      'إلغاء والبدء من البداية',
      'published-action-btn published-placement-secondary',
      () => abandonPublishedPlacement(bundle),
      'fa-solid fa-arrow-rotate-left'
    )
  );
  section.append(actions);
  root.replaceChildren(section);
}

async function abandonPublishedPlacement(bundle) {
  if (publishedContentState.placementPending) return;
  publishedContentState.placementPending = true;
  try {
    const journey = await getJourneyCloudApi().abandonPlacementAndStartBeginning(
      bundle.journey.worldId
    );
    publishedContentState.placementPending = false;
    publishedContentState.placementBundle = null;
    publishedContentState.journey = journey;
    publishedContentState.activeJourney = journey;
    setPublishedPlacementMode(false);
    showToast('تم إلغاء اختبار التحديد وبدء الرحلة من البداية.', 'info', 4200);
    window.openPublishedGate(
      journey.worldId,
      journey.activeRankId,
      journey.activeGateId
    );
  } catch (error) {
    publishedContentState.placementPending = false;
    showToast(publishedJourneyErrorText(error), 'danger', 4800);
    renderPublishedPlacementExit(bundle);
  }
}

async function maybeRenderPublishedPlacementResume(journey, generation) {
  if (!journey || journey.placementStatus !== 'active') return false;
  try {
    const bundle = await getJourneyCloudApi().resumePlacement(journey.worldId);
    if (generation !== publishedContentState.generation) return true;
    clearPublishedJourneyError();
    renderPublishedPlacementResumePrompt(bundle);
  } catch (error) {
    if (generation !== publishedContentState.generation) return true;
    setPublishedJourneyError(
      error,
      'resume-placement',
      () => showPublishedPlacementResume(journey.worldId),
      journey.worldId
    );
    return false;
  }
  return true;
}

function publishedElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function publishedIcon(className) {
  const icon = publishedElement('i', className || 'fa-solid fa-book-open');
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function publishedButton(label, className, onClick, iconClass) {
  const button = publishedElement('button', className);
  button.type = 'button';
  if (iconClass) button.append(publishedIcon(iconClass));
  button.append(document.createTextNode(label));
  button.addEventListener('click', onClick);
  return button;
}

function setPublishedTabState(tab) {
  const published = tab !== 'custom';
  const nextTab = published ? 'published' : 'custom';
  const changed = publishedContentState.tab !== nextTab;
  publishedContentState.tab = nextTab;
  const publishedTab = document.getElementById('publishedWorldsTab');
  const customTab = document.getElementById('customWorldsTab');
  const publishedPanel = document.getElementById('publishedWorldsPanel');
  const customPanel = document.getElementById('customWorldsPanel');
  const tabs = document.querySelector('#worldsView .worlds-tabs');
  if (tabs) tabs.dataset.activeTab = nextTab;
  publishedTab?.classList.toggle('active', published);
  customTab?.classList.toggle('active', !published);
  publishedTab?.setAttribute('aria-selected', String(published));
  customTab?.setAttribute('aria-selected', String(!published));
  if (publishedPanel) publishedPanel.hidden = !published;
  if (customPanel) customPanel.hidden = published;
  const activePanel = published ? publishedPanel : customPanel;
  if (changed && activePanel) {
    activePanel.classList.remove('worlds-tab-panel-enter');
    void activePanel.offsetWidth;
    activePanel.classList.add('worlds-tab-panel-enter');
    clearTimeout(activePanel.__worldsTabEnterTimer);
    activePanel.__worldsTabEnterTimer = setTimeout(() => {
      activePanel.classList.remove('worlds-tab-panel-enter');
    }, 280);
  }
}

function setPublishedTabsVisible(visible) {
  const tabs = document.querySelector('#worldsView .worlds-tabs');
  if (tabs) tabs.hidden = !visible;
}

function publishedViewRoot() {
  return document.getElementById('publishedContentView');
}

function renderPublishedLoading(message) {
  const root = publishedViewRoot();
  if (!root) return;
  const loading = publishedElement('div', 'published-loading');
  const state = publishedElement('div', 'published-state published-state-loading');
  state.setAttribute('role', 'status');
  state.setAttribute('aria-live', 'polite');
  state.append(publishedIcon('fa-solid fa-circle-notch fa-spin'));
  state.append(publishedElement('strong', '', message || 'جارٍ تحميل المحتوى الجاهز...'));
  const skeletons = publishedElement('div', 'published-skeleton-list');
  for (let index = 0; index < 3; index += 1) {
    const skeleton = publishedElement('div', 'published-skeleton-card');
    skeleton.append(
      publishedElement('span', 'published-skeleton-visual'),
      publishedElement('span', 'published-skeleton-lines')
    );
    skeletons.append(skeleton);
  }
  loading.append(state, skeletons);
  root.replaceChildren(loading);
}

function logPublishedContentError(context, error) {
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (localHost) console.error(`[published-content:${context}]`, error);
}

function publishedErrorMessage(level, error) {
  if (error?.code === 'published/not-found') return 'هذا المحتوى غير موجود أو لم يعد منشورًا.';
  const messages = {
    worlds: 'تعذر تحميل العوالم الجاهزة.',
    ranks: 'تعذر تحميل الرتب.',
    gates: 'تعذر تحميل البوابات.',
    words: 'تعذر تحميل كلمات البوابة.',
  };
  return messages[level] || 'تعذر تحميل المحتوى الجاهز.';
}

function renderPublishedError(level, error, retry) {
  const root = publishedViewRoot();
  if (!root) return;
  const notFound = error?.code === 'published/not-found';
  const state = publishedElement('div', 'published-state published-state-error');
  state.setAttribute('role', 'alert');
  state.append(publishedIcon(notFound
    ? 'fa-solid fa-map-location-dot'
    : 'fa-solid fa-triangle-exclamation'));
  state.append(publishedElement('strong', '', notFound ? 'المحتوى غير موجود' : 'تعذر التحميل'));
  state.append(publishedElement('p', '', publishedErrorMessage(level, error)));
  if (!notFound && typeof retry === 'function') {
    state.append(publishedButton(
      'إعادة المحاولة',
      'published-action-btn',
      retry,
      'fa-solid fa-rotate-right'
    ));
  } else {
    state.append(publishedButton(
      'العودة للعوالم الجاهزة',
      'published-action-btn',
      () => window.openPublishedWorldsRoot(),
      'fa-solid fa-arrow-right'
    ));
  }
  root.replaceChildren(state);
}

function renderPublishedEmpty(message, iconClass) {
  const state = publishedElement('div', 'published-state published-state-empty');
  state.setAttribute('role', 'status');
  state.append(publishedIcon(iconClass || 'fa-regular fa-folder-open'));
  state.append(publishedElement('strong', '', message));
  return state;
}

function appendMetaChip(container, text, iconClass) {
  if (text === undefined || text === null || text === '') return;
  const chip = publishedElement('span', 'published-meta-chip');
  if (iconClass) chip.append(publishedIcon(iconClass));
  chip.append(document.createTextNode(String(text)));
  container.append(chip);
}

function getPublishedVisualFallback(item, kind) {
  const identity = [
    item?.title,
    item?.name,
    item?.category,
    item?.theme,
    item?.description,
  ].filter(Boolean).join(' ').toLowerCase();
  const themed = [
    { match: /game|gaming|minecraft|pubg|لعب|ألعاب/, theme: 'games', icon: 'fa-solid fa-gamepad' },
    { match: /film|movie|cinema|فيلم|سينما/, theme: 'cinema', icon: 'fa-solid fa-film' },
    { match: /treasure|loot|chest|كنز|صندوق/, theme: 'loot', icon: 'fa-solid fa-box-open' },
    { match: /battle|combat|war|sword|fantasy|قتال|حرب|سيف/, theme: 'adventure', icon: 'fa-solid fa-shield-halved' },
    { match: /space|science|planet|فضاء|علوم|كوكب/, theme: 'science', icon: 'fa-solid fa-rocket' },
    { match: /star|legend|hero|نجم|أسطور|بطل/, theme: 'legend', icon: 'fa-solid fa-star' },
    { match: /book|language|dictionary|word|كتاب|لغة|قاموس|كلمات/, theme: 'knowledge', icon: 'fa-solid fa-book-open' },
  ].find((entry) => entry.match.test(identity));
  if (themed) return themed;
  const defaults = {
    world: { theme: 'world', icon: 'fa-solid fa-earth-americas' },
    rank: { theme: 'rank', icon: 'fa-solid fa-ranking-star' },
    gate: { theme: 'gate', icon: 'fa-solid fa-dungeon' },
  };
  return defaults[kind] || { theme: 'knowledge', icon: 'fa-solid fa-book-open' };
}

function appendPublishedVisual(card, item, kind) {
  const visual = publishedElement('span', 'published-card-visual');
  const cover = String(item.cover || item.coverUrl || item.imageUrl || item.image || '').trim();
  const icon = String(item.icon || '').trim();
  const fallback = getPublishedVisualFallback(item, kind);
  visual.classList.add(`published-visual-${fallback.theme}`);
  const showFallback = () => {
    visual.replaceChildren(publishedIcon(fallback.icon));
    visual.classList.add('published-card-visual-fallback');
  };
  if (cover) {
    const image = document.createElement('img');
    image.src = cover;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', showFallback, { once: true });
    visual.append(image);
  } else if (/^(fa-|fas |far |fab )/.test(icon)) {
    visual.append(publishedIcon(icon));
  } else if (icon && /\p{Extended_Pictographic}/u.test(icon)) {
    visual.append(publishedElement('span', 'published-card-emoji', icon));
  } else {
    showFallback();
  }
  card.append(visual);
}

function makePublishedHierarchyCard(kind, item, onClick, options) {
  const journeyState = String(options?.journeyState || '');
  const blocked = Boolean(options?.blocked);
  const stateClass = journeyState ? ` published-card-journey-${journeyState}` : '';
  const card = publishedElement(
    'button',
    `published-card published-card-${kind}${stateClass}`
  );
  card.type = 'button';
  if (blocked) {
    card.setAttribute('aria-disabled', 'true');
    card.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.remove('published-card-lock-nudge');
      void card.offsetWidth;
      card.classList.add('published-card-lock-nudge');
      clearTimeout(card.__publishedLockTimer);
      card.__publishedLockTimer = setTimeout(() => {
        card.classList.remove('published-card-lock-nudge');
      }, 360);
      showToast('أكمل البوابة السابقة لفتح هذه البوابة.', 'info', 3200);
    });
  } else {
    card.addEventListener('click', onClick);
  }
  appendPublishedVisual(card, item, kind);
  if (journeyState === 'locked') {
    const lock = publishedElement('span', 'published-card-lock');
    lock.append(
      publishedIcon('fa-solid fa-lock'),
      publishedElement('span', '', kind === 'rank' ? 'رتبة مقفلة' : 'بوابة مقفلة')
    );
    card.append(lock);
  }

  const body = publishedElement('span', 'published-card-body');
  body.append(publishedElement('strong', 'published-card-title', item.title || item.name || 'بدون اسم'));
  const description = item.description || item.subtitle;
  if (description) body.append(publishedElement('span', 'published-card-description', description));
  const meta = publishedElement('span', 'published-card-meta');
  if (item.difficulty) appendMetaChip(meta, item.difficulty, 'fa-solid fa-signal');
  if (item.category) appendMetaChip(meta, item.category, 'fa-solid fa-tag');
  if (kind === 'world' && Number.isFinite(Number(item.rankCount))) {
    appendMetaChip(meta, `${Number(item.rankCount)} رتبة`, 'fa-solid fa-ranking-star');
  }
  if (kind === 'rank' && Number.isFinite(Number(item.gateCount))) {
    appendMetaChip(meta, `${Number(item.gateCount)} بوابة`, 'fa-solid fa-dungeon');
  }
  if (kind === 'gate' && Number.isFinite(Number(item.wordCount))) {
    appendMetaChip(meta, `${Number(item.wordCount)} كلمة`, 'fa-solid fa-language');
  }
  if (kind !== 'world' && Number.isFinite(Number(item.order))) {
    appendMetaChip(meta, `الترتيب ${Number(item.order) + 1}`, 'fa-solid fa-arrow-down-1-9');
  }
  if (item.comingSoon === true || item.isComingSoon === true) {
    appendMetaChip(meta, 'قريبًا', 'fa-regular fa-clock');
  }
  if (journeyState) {
    const stateIcons = {
      locked: 'fa-solid fa-lock',
      available: 'fa-solid fa-unlock-keyhole',
      learning: 'fa-solid fa-book-open-reader',
      ready: 'fa-solid fa-circle-check',
      cleared: 'fa-solid fa-flag-checkered',
      mastered: 'fa-solid fa-crown',
    };
    appendMetaChip(
      meta,
      getJourneyContract().gateStatusLabel(journeyState),
      stateIcons[journeyState] || 'fa-solid fa-lock'
    );
  }
  const footer = publishedElement('span', 'published-card-footer');
  footer.append(meta);
  const actionLabels = {
    world: 'استكشف العالم',
    rank: 'عرض البوابات',
    gate: 'معاينة الكلمات',
  };
  const action = publishedElement('span', 'published-card-action');
  action.append(
    document.createTextNode(actionLabels[kind] || 'فتح'),
    publishedIcon('fa-solid fa-arrow-left')
  );
  footer.append(action);
  body.append(footer);
  card.append(body);
  return card;
}

function makePublishedJourneyPanel(world, ranks, journey, activeJourney) {
  const panel = publishedElement('section', 'published-journey-panel');
  const copy = publishedElement('div', 'published-journey-copy');
  const existing = Boolean(journey);
  const active = existing &&
    String(activeJourney?.worldId || '') === String(world.worldId || '');
  const firstRank = firstJourneyRank(ranks);
  const journeyError = currentPublishedJourneyError(world.worldId);
  copy.append(
    publishedElement(
      'strong',
      '',
      existing ? 'رحلتك في هذا العالم محفوظة' : 'ابدأ رحلة هذا العالم'
    ),
    publishedElement(
      'span',
      '',
      existing
        ? (active
          ? 'تابع من البوابة النشطة دون فقدان تقدمك.'
          : 'يمكنك جعل هذا العالم رحلتك النشطة مع بقاء تقدم العالم الآخر محفوظًا.')
        : (!window.auth?.currentUser
          ? 'سجّل دخولك لبدء الرحلة وحفظ تقدم البوابات.'
          : 'تبدأ من أول رتبة وبوابة متاحتين، ثم تختار متى تحمّل الكلمات.')
    )
  );
  panel.append(copy);

  const choosing = publishedContentState.journeyAction?.type === 'choose-start';
  const pending = Boolean(
    ['start', 'beginning', 'placement-start'].includes(
      publishedContentState.journeyAction?.type
    ) && publishedContentState.journeyAction.pending
  );
  if (choosing) {
    const choices = publishedElement('div', 'published-journey-start-choices');
    const beginning = publishedButton(
      'ابدأ من البداية',
      'published-action-btn published-journey-btn published-journey-cta',
      () => beginPublishedJourneyFromStart(world),
      'fa-solid fa-forward-step'
    );
    beginning.disabled = !firstRank;
    choices.append(beginning);
    panel.append(choices);
  } else {
  const button = publishedButton(
    pending
      ? 'جارٍ تجهيز الرحلة'
      : (existing && journey?.placementStatus !== 'not-started'
        ? 'تابع الرحلة'
        : 'ابدأ الرحلة'),
    'published-action-btn published-journey-btn published-journey-cta',
    () => startOrResumePublishedJourney(world),
    pending ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-route'
  );
  button.disabled = pending || (!existing && !firstRank);
  panel.append(button);
  }
  if (!existing && !firstRank) {
    panel.append(publishedElement(
      'small',
      'published-journey-message',
      'لا توجد رتبة متاحة لبدء الرحلة حاليًا.'
    ));
  } else if (publishedContentState.journeyAction?.error || journeyError) {
    panel.append(
      publishedElement(
        'small',
        'published-journey-message published-journey-error',
        publishedContentState.journeyAction?.error || journeyError.text
      )
    );
    if (journeyError?.retry) {
      panel.append(publishedButton(
        'إعادة المحاولة',
        'published-action-btn published-journey-retry-btn',
        () => retryPublishedJourneyError(),
        'fa-solid fa-rotate-right'
      ));
    }
  }
  return panel;
}

function makeActiveJourneyBanner(activeJourney, worlds) {
  if (!activeJourney) return null;
  const world = (Array.isArray(worlds) ? worlds : []).find(
    (item) => String(item.worldId) === String(activeJourney.worldId)
  );
  const banner = publishedElement('section', 'published-active-journey');
  const copy = publishedElement('span', 'published-active-journey-copy');
  copy.append(
    publishedElement('small', '', 'الرحلة النشطة'),
    publishedElement('strong', '', world?.title || 'عالم المحتوى الجاهز')
  );
  banner.append(
    publishedIcon('fa-solid fa-route'),
    copy,
    publishedButton(
      'متابعة',
      'published-action-btn',
      () => window.openPublishedGate(
        activeJourney.worldId,
        activeJourney.activeRankId,
        activeJourney.activeGateId
      ),
      'fa-solid fa-arrow-left'
    )
  );
  return banner;
}

function makePublishedGateJourneyPanel(world, rank, gate) {
  const progress = publishedContentState.gateProgress;
  const state = publishedGateJourneyState(
    gate,
    rank,
    publishedContentState.gates,
    publishedContentState.ranks,
    publishedContentState.journey,
    progress
  );
  const panel = publishedElement(
    'section',
    `published-gate-journey published-gate-journey-${state}`
  );
  const copy = publishedElement('div', 'published-journey-copy');
  const stateTitles = {
    locked: 'هذه البوابة مقفلة',
    available: 'هذه البوابة متاحة',
    learning: 'البوابة قيد التعلم',
    cleared: 'اكتملت هذه البوابة',
  };
  const stateDescriptions = {
    locked: 'أكمل البوابة السابقة لفتحها.',
    available: publishedContentState.journey
      ? 'حمّل كلمات البوابة إلى قاموسك عندما تكون مستعدًا.'
      : 'ابدأ الرحلة أولًا، ثم حمّل كلمات البوابة إلى قاموسك.',
    learning: 'كلمات البوابة مرتبطة بقاموسك وحالة SRS الحالية.',
    cleared: 'اجتزت هذه البوابة وحُفظ تقدمك في الرحلة.',
  };
  copy.append(
    publishedElement('strong', '', stateTitles[state] || getJourneyContract().gateStatusLabel(state)),
    publishedElement('span', '', stateDescriptions[state] || '')
  );
  panel.append(copy);

  const action = publishedContentState.journeyAction;
  const journeyError = currentPublishedJourneyError(world.worldId);
  const pending = Boolean(action?.pending);
  const actions = publishedElement('div', 'published-journey-actions');
  const activeForWorld = String(publishedContentState.activeJourney?.worldId || '') ===
    String(world.worldId);
  const needsPlacementChoice =
    publishedContentState.journeyAction?.type === 'choose-start' ||
    publishedContentState.journey?.placementStatus === 'not-started';

  if (state === 'locked') {
    const locked = publishedButton(
      'تحميل البوابة',
      'published-action-btn published-journey-btn',
      () => {},
      'fa-solid fa-lock'
    );
    locked.disabled = true;
    actions.append(locked);
  } else if (needsPlacementChoice) {
    const beginning = publishedButton(
      pending ? 'جارٍ تجهيز الرحلة' : 'ابدأ من البداية',
      'published-action-btn published-journey-btn published-journey-cta',
      () => beginPublishedJourneyFromStart(world),
      pending ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-forward-step'
    );
    beginning.disabled = pending;
    actions.append(beginning);
  } else if (!publishedContentState.journey || !activeForWorld) {
    const start = publishedButton(
      pending ? 'جارٍ تجهيز الرحلة' : 'ابدأ الرحلة',
      'published-action-btn published-journey-btn published-journey-cta',
      () => startOrResumePublishedJourney(world),
      pending ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-route'
    );
    start.disabled = pending;
    actions.append(start);
  } else if (state === 'available') {
    const load = publishedButton(
      pending ? 'جارٍ تحميل الكلمات' : 'تحميل البوابة',
      'published-action-btn published-journey-btn published-journey-cta',
      () => runPublishedGateLoad(false),
      pending ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-download'
    );
    load.disabled = pending;
    actions.append(load);
  } else if (state === 'learning') {
    actions.append(publishedButton(
      'متابعة التعلم',
      'published-action-btn published-journey-btn published-journey-cta',
      () => window.loadPersonalDictionary(),
      'fa-solid fa-book-open-reader'
    ));
    if (publishedContentState.newGateWords.length) {
      const sync = publishedButton(
        pending ? 'جارٍ مزامنة الكلمات' : 'مزامنة الكلمات الجديدة',
        'published-action-btn published-journey-sync-btn',
        () => runPublishedGateLoad(true),
        pending ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-rotate'
      );
      sync.disabled = pending;
      actions.append(sync);
    }
  } else if (
    state === 'cleared' &&
    publishedContentState.activeJourney?.activeGateId &&
    String(publishedContentState.activeJourney.activeGateId) !== String(gate.gateId)
  ) {
    actions.append(publishedButton(
      'الانتقال للبوابة المفتوحة',
      'published-action-btn published-journey-btn published-journey-cta',
      () => window.openPublishedGate(
        publishedContentState.activeJourney.worldId,
        publishedContentState.activeJourney.activeRankId,
        publishedContentState.activeJourney.activeGateId
      ),
      'fa-solid fa-arrow-left'
    ));
  }
  panel.append(actions);

  if (state === 'learning' && publishedContentState.newGateWords.length) {
    panel.append(publishedElement(
      'small',
      'published-journey-message published-journey-new-words',
      `توجد كلمات جديدة في هذه البوابة (${publishedContentState.newGateWords.length}).`
    ));
  }
  if (pending) {
    panel.append(publishedElement(
      'small',
      'published-journey-progress',
      `تم تحميل ${Number(action?.completed) || 0} من ${Number(action?.total) || 0}`
    ));
  } else if (action?.error || journeyError) {
    panel.append(
      publishedElement(
        'small',
        'published-journey-message published-journey-error',
        action?.error || journeyError.text
      ),
      publishedButton(
        'إعادة المحاولة',
        'published-action-btn published-journey-retry-btn',
        () => journeyError?.retry
          ? retryPublishedJourneyError()
          : runPublishedGateLoad(action?.type === 'sync'),
        'fa-solid fa-rotate-right'
      )
    );
  }
  return panel;
}

function appendPublishedHeader(root, options) {
  const header = publishedElement('header', 'published-view-header');
  if (options.back) {
    header.append(publishedButton(
      options.backLabel || 'رجوع',
      'published-back-btn',
      options.back,
      'fa-solid fa-arrow-right'
    ));
  }
  if (options.breadcrumbs?.length) {
    const breadcrumbs = publishedElement('nav', 'published-breadcrumb');
    breadcrumbs.setAttribute('aria-label', 'مسار المحتوى');
    options.breadcrumbs.forEach((item, index) => {
      if (index > 0) {
        breadcrumbs.append(publishedElement('span', 'published-breadcrumb-separator', '›'));
      }
      if (item.onClick) {
        breadcrumbs.append(publishedButton(
          item.label,
          'published-breadcrumb-link',
          item.onClick,
          item.iconClass
        ));
      } else {
        breadcrumbs.append(publishedElement('span', 'published-breadcrumb-current', item.label));
      }
    });
    header.append(breadcrumbs);
  }
  const heading = publishedElement('div', 'published-heading');
  heading.append(publishedElement('h3', '', options.title));
  if (options.description) heading.append(publishedElement('p', '', options.description));
  header.append(heading);
  root.append(header);
}

function renderPublishedWorlds(items, activeJourney) {
  const root = publishedViewRoot();
  if (!root) return;
  const content = document.createDocumentFragment();
  if (!items.length) {
    content.append(renderPublishedEmpty(
      'لا توجد عوالم منشورة حاليًا.',
      'fa-solid fa-earth-americas'
    ));
  } else {
    const activeBanner = makeActiveJourneyBanner(activeJourney, items);
    if (activeBanner) content.append(activeBanner);
    const intro = publishedElement('header', 'published-hub-intro');
    const introIcon = publishedElement('span', 'published-hub-icon');
    introIcon.append(publishedIcon('fa-solid fa-compass'));
    const introCopy = publishedElement('span', 'published-hub-copy');
    introCopy.append(
      publishedElement('strong', '', 'اختر عالمك التالي'),
      publishedElement('span', '', 'محتوى مرتب على رتب وبوابات، جاهز للتصفح كلمة بكلمة.')
    );
    intro.append(
      introIcon,
      introCopy,
      publishedElement('span', 'published-hub-count', `${items.length} عوالم`)
    );
    content.append(intro);
    const grid = publishedElement('div', 'published-card-grid');
    items.forEach((world) => {
      grid.append(makePublishedHierarchyCard(
        'world',
        world,
        () => window.openPublishedWorld(world.worldId)
      ));
    });
    content.append(grid);
  }
  root.replaceChildren(content);
}

function makePublishedLevelSection(world, cefrLevel, ranks, journey) {
  const schema = window.LootLinguaContentSchema;
  const meta = schema.CEFR_LEVEL_META[cefrLevel];
  const state = publishedLevelState(cefrLevel, journey);
  const section = publishedElement(
    'section',
    `published-level-section published-level-${cefrLevel.toLowerCase()} published-level-state-${state}`
  );
  const header = publishedElement('header', 'published-level-header');
  const copy = publishedElement('div', 'published-level-header-copy');
  copy.append(
    publishedElement('strong', '', meta.label),
    publishedElement('span', '', meta.name),
    publishedElement('small', '', meta.description)
  );
  const gateCount = ranks.reduce((sum, rank) => sum + (Number(rank.gateCount) || 0), 0);
  const wordCount = ranks.reduce((sum, rank) => sum + (Number(rank.wordCount) || 0), 0);
  const summary = publishedElement('div', 'published-level-summary');
  summary.append(publishedElement(
    'span',
    '',
    `${ranks.length} رتب · ${gateCount} بوابة${wordCount ? ` · ${wordCount} كلمة` : ''}`
  ));
  if (cefrLevel !== 'unclassified') {
    const labels = {
      locked: 'اختبار المستوى مقفل',
      available: `اختبار مستوى ${cefrLevel}`,
      'in-progress': 'متابعة اختبار المستوى',
      passed: 'تم اجتياز المستوى',
      'partially-passed': 'متابعة من نقطة البداية',
    };
    const button = publishedButton(
      labels[state] || `اختبار مستوى ${cefrLevel}`,
      'published-action-btn published-level-test-btn',
      () => {
        if (state === 'in-progress') showPublishedLevelPlacementResume(world.worldId);
        else if (state === 'partially-passed' && journey?.activeRankId && journey?.activeGateId) {
          window.openPublishedGate(world.worldId, journey.activeRankId, journey.activeGateId);
        }
        else beginPublishedLevelPlacement(world, cefrLevel);
      },
      state === 'passed'
        ? 'fa-solid fa-circle-check'
        : (state === 'locked' ? 'fa-solid fa-lock' : 'fa-solid fa-location-crosshairs')
    );
    button.disabled = state === 'locked' || state === 'passed' ||
      publishedContentState.levelPlacementPending;
    summary.append(button);
  }
  header.append(copy, summary);
  section.append(header);
  const grid = publishedElement('div', 'published-card-grid published-level-rank-grid');
  const initialRank = firstJourneyRank(ranks);
  ranks.forEach((rank) => {
    const rankState = (
      journey
        ? getJourneyContract().canAccessRank(rank, journey)
        : String(rank.rankId || '') === String(initialRank?.rankId || '')
    ) ? 'available' : 'locked';
    grid.append(makePublishedHierarchyCard(
      'rank',
      rank,
      () => window.openPublishedRank(world.worldId, rank.rankId),
      { journeyState: rankState }
    ));
  });
  section.append(grid);
  return section;
}

function renderPublishedRanks(world, ranks, journey, activeJourney) {
  const root = publishedViewRoot();
  if (!root) return;
  const content = document.createDocumentFragment();
  const section = publishedElement('section', 'published-route-view');
  appendPublishedHeader(section, {
    title: world.title || 'العالم',
    description: world.description || world.subtitle || '',
    backLabel: 'العودة للعوالم',
    back: () => window.openPublishedWorldsRoot(),
    breadcrumbs: [
      {
        label: 'العوالم الجاهزة',
        onClick: () => window.openPublishedWorldsRoot(),
        iconClass: 'fa-solid fa-earth-americas',
      },
      { label: world.title || 'العالم' },
    ],
  });
  section.append(makePublishedJourneyPanel(world, ranks, journey, activeJourney));
  if (!ranks.length) {
    section.append(renderPublishedEmpty('لا توجد رتب منشورة في هذا العالم.', 'fa-solid fa-ranking-star'));
  } else {
    const groups = window.LootLinguaContentSchema.groupRanksByCefrLevel(ranks);
    window.LootLinguaContentSchema.CEFR_LEVELS.forEach((level) => {
      const levelRanks = groups.get(level) || [];
      if (levelRanks.length) {
        section.append(makePublishedLevelSection(world, level, levelRanks, journey));
      }
    });
  }
  content.append(section);
  root.replaceChildren(content);
}

function renderPublishedGates(
  world,
  rank,
  gates,
  ranks,
  journey,
  activeJourney,
  gateProgressById
) {
  const root = publishedViewRoot();
  if (!root) return;
  const section = publishedElement('section', 'published-route-view');
  appendPublishedHeader(section, {
    title: rank.title || 'الرتبة',
    description: rank.description || rank.subtitle || '',
    backLabel: 'العودة للرتب',
    back: () => window.openPublishedWorld(world.worldId),
    breadcrumbs: [
      {
        label: 'العوالم الجاهزة',
        onClick: () => window.openPublishedWorldsRoot(),
        iconClass: 'fa-solid fa-earth-americas',
      },
      { label: world.title || 'العالم', onClick: () => window.openPublishedWorld(world.worldId) },
      { label: rank.title || 'الرتبة' },
    ],
  });
  if (!gates.length) {
    section.append(renderPublishedEmpty('لا توجد بوابات منشورة في هذه الرتبة.', 'fa-solid fa-dungeon'));
  } else {
    const grid = publishedElement('div', 'published-card-grid');
    gates.forEach((gate) => {
      const progress = gateProgressById?.get(String(gate.gateId)) || null;
      const gateState = publishedGateJourneyState(
        gate,
        rank,
        gates,
        ranks,
        journey,
        progress
      );
      grid.append(makePublishedHierarchyCard(
        'gate',
        gate,
        () => window.openPublishedGate(world.worldId, rank.rankId, gate.gateId),
        {
          journeyState: gateState,
          activeJourney,
          blocked: gateState === 'locked',
        }
      ));
    });
    section.append(grid);
  }
  root.replaceChildren(section);
}

function publishedDetailText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('، ');
  if (value && typeof value === 'object') {
    return Object.values(value).filter(Boolean).join('، ');
  }
  return String(value || '').trim();
}

function getPublishedPersonalWords() {
  return readWordsFromStorage('normal', window.auth?.currentUser?.uid);
}

function getPublishedUserWord(word) {
  return window.LootLinguaWordLifecycle?.findUserWordByKey(
    getPublishedPersonalWords(),
    word
  ) || null;
}

async function restorePublishedGateWord(userWord, publishedWord, button) {
  if (!userWord || !isDictionaryWordHidden(userWord)) return;
  if (button) button.disabled = true;
  try {
    await window.restoreDictionaryWordById(userWord.id, { notify: false });
    const word = publishedWord?.word || userWord.word || userWord.text || '';
    showToast(`تمت استعادة كلمة ”${word}“ إلى قاموسك، وتقدمها السابق محفوظ.`, 'success', 4800);
    renderPublishedGateWords(
      publishedContentState.world,
      publishedContentState.rank,
      publishedContentState.gate,
      publishedContentState.wordSnapshot
    );
  } catch (error) {
    if (button) button.disabled = false;
    showToast('تعذر استعادة الكلمة الآن. لم يتغير تقدمها.', 'danger', 4400);
  }
}

function makePublishedWordCard(word) {
  const userWord = getPublishedUserWord(word);
  const hidden = isDictionaryWordHidden(userWord);
  const card = publishedElement(
    'article',
    `published-word-card${hidden ? ' published-word-hidden' : ''}`
  );
  const content = publishedElement('div', 'published-word-content');
  const identity = publishedElement('div', 'published-word-identity');
  const wordText = publishedElement('strong', 'published-word-text', word.word || '');
  wordText.setAttribute('dir', 'ltr');
  wordText.setAttribute('lang', 'en');
  const translation = publishedElement(
    'span',
    'published-word-translation',
    word.translation || word.meaning || ''
  );
  translation.setAttribute('dir', 'rtl');
  identity.append(wordText, translation);
  content.append(identity);

  const meta = publishedElement('div', 'published-word-meta');
  appendMetaChip(meta, word.level, 'fa-solid fa-signal');
  appendMetaChip(meta, word.partOfSpeech, 'fa-solid fa-font');
  appendMetaChip(meta, word.category, 'fa-solid fa-tag');
  if (hidden) appendMetaChip(meta, 'مخفية من قاموسك', 'fa-solid fa-eye-slash');
  if (meta.childElementCount) content.append(meta);

  if (word.example) {
    const example = publishedElement('p', 'published-word-example');
    example.setAttribute('dir', 'ltr');
    example.setAttribute('lang', 'en');
    example.append(
      publishedIcon('fa-solid fa-quote-left'),
      document.createTextNode(String(word.example))
    );
    content.append(example);
  }

  const detailValues = [
    ['التعريف', word.definition],
    ['التعريف بالعربية', word.definition_ar || word.definitionAr],
    ['المثال', word.example],
    ['ترجمة المثال', word.exampleTranslation],
    ['الوسوم', word.tags],
    ['المرادفات', word.synonyms],
  ].map(([label, value]) => [label, publishedDetailText(value)])
    .filter((item) => item[1]);

  const actions = publishedElement('div', 'published-word-actions');
  const spokenWord = String(word.word || '').trim();
  const soundAvailable = Boolean(
    spokenWord &&
    'speechSynthesis' in window &&
    typeof window.playGameSound === 'function'
  );
  const sound = publishedElement('button', 'published-word-icon-btn published-word-sound');
  sound.type = 'button';
  sound.setAttribute('aria-label', soundAvailable ? `لفظ ${spokenWord}` : 'اللفظ غير متاح');
  sound.title = soundAvailable ? 'استمع إلى اللفظ' : 'اللفظ غير متاح على هذا الجهاز';
  sound.disabled = !soundAvailable;
  sound.append(publishedIcon('fa-solid fa-volume-high'));
  if (soundAvailable) {
    sound.addEventListener('click', (event) => {
      sound.classList.add('is-speaking');
      window.playGameSound(spokenWord, event);
      clearTimeout(sound.__publishedSpeakingTimer);
      sound.__publishedSpeakingTimer = setTimeout(() => {
        sound.classList.remove('is-speaking');
      }, 1100);
    });
  }
  actions.append(sound);
  if (hidden) {
    const restore = publishedButton(
      'استعادة إلى القاموس',
      'published-word-restore',
      () => restorePublishedGateWord(userWord, word, restore),
      'fa-solid fa-rotate-left'
    );
    actions.append(restore);
  }

  let details = null;
  if (detailValues.length) {
    details = publishedElement('div', 'published-word-details');
    details.hidden = true;
    detailValues.forEach(([label, value]) => {
      const row = publishedElement('p', '');
      row.append(publishedElement('strong', '', `${label}: `));
      row.append(document.createTextNode(value));
      details.append(row);
    });
    const toggle = publishedElement(
      'button',
      'published-word-icon-btn published-word-toggle'
    );
    toggle.type = 'button';
    toggle.title = 'عرض التفاصيل';
    toggle.setAttribute('aria-label', 'عرض تفاصيل الكلمة');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(publishedIcon('fa-solid fa-circle-info'));
    toggle.addEventListener('click', () => {
      details.hidden = !details.hidden;
      const expanded = !details.hidden;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', expanded ? 'إخفاء تفاصيل الكلمة' : 'عرض تفاصيل الكلمة');
      toggle.title = expanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل';
      card.classList.toggle('published-word-expanded', expanded);
    });
    actions.append(toggle);
  }

  card.append(content, actions);
  if (details) card.append(details);
  return card;
}

function getPublishedWordPageMeta(gate, snapshot) {
  const page = snapshot?.currentPage;
  const pageNumber = Math.max(1, Number(snapshot?.currentPageIndex ?? 0) + 1);
  const pageSize = Math.max(1, Number(snapshot?.pageSize) || 25);
  const countValue = gate?.wordCount;
  const rawCount = Number(countValue);
  const knownCount = countValue !== undefined &&
    countValue !== null &&
    String(countValue).trim() !== '' &&
    Number.isFinite(rawCount) &&
    rawCount >= 0
    ? rawCount
    : null;
  const observedCount = ((pageNumber - 1) * pageSize) + (page?.items?.length || 0);
  const reachedPublishedEnd = Boolean(page) && !page.hasNext;
  const countMatchesPublishedPages = knownCount !== null &&
    !(reachedPublishedEnd && knownCount > observedCount);
  const totalPages = page?.hasNext
    ? (knownCount !== null
      ? Math.max(pageNumber + 1, Math.ceil(knownCount / pageSize))
      : null)
    : pageNumber;
  const countLabel = countMatchesPublishedPages
    ? `${knownCount} كلمة منشورة`
    : (knownCount !== null && reachedPublishedEnd
      ? `${knownCount} كلمة في البوابة · ${observedCount} منشورة حاليًا`
    : (page?.hasNext
      ? `أكثر من ${pageNumber * pageSize} كلمة`
      : `${observedCount} كلمة منشورة`));
  return {
    pageNumber,
    totalPages,
    indicator: totalPages ? `${pageNumber} / ${totalPages}` : `${pageNumber} / …`,
    countLabel,
  };
}

function makePublishedPagination(snapshot, meta) {
  const page = snapshot?.currentPage;
  if (!page) return null;
  const controls = publishedElement('nav', 'published-pagination');
  controls.setAttribute('aria-label', 'التنقل بين صفحات كلمات البوابة');
  const previous = publishedButton(
    'السابق',
    'published-page-btn published-page-previous',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      loadPublishedWordPage('previous');
    },
    'fa-solid fa-chevron-right'
  );
  const next = publishedButton(
    'التالي',
    'published-page-btn published-page-next',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      loadPublishedWordPage('next');
    },
    'fa-solid fa-chevron-left'
  );
  previous.disabled = !page.hasPrevious;
  next.disabled = !page.hasNext;

  const status = publishedElement('span', 'published-page-status');
  status.append(
    publishedElement('strong', '', meta.indicator),
    publishedElement('small', '', 'صفحة')
  );
  controls.append(previous, status, next);
  return controls;
}

function renderPublishedGateWords(world, rank, gate, snapshot) {
  const root = publishedViewRoot();
  if (!root) return;
  const section = publishedElement('section', 'published-route-view');
  appendPublishedHeader(section, {
    title: gate.title || 'البوابة',
    description: gate.description || gate.subtitle || '',
    backLabel: 'العودة للبوابات',
    back: () => window.openPublishedRank(world.worldId, rank.rankId),
    breadcrumbs: [
      {
        label: 'العوالم الجاهزة',
        onClick: () => window.openPublishedWorldsRoot(),
        iconClass: 'fa-solid fa-earth-americas',
      },
      { label: world.title || 'العالم', onClick: () => window.openPublishedWorld(world.worldId) },
      {
        label: rank.title || 'الرتبة',
        onClick: () => window.openPublishedRank(world.worldId, rank.rankId)
      },
      { label: gate.title || 'البوابة' },
    ],
  });
  section.append(makePublishedGateJourneyPanel(world, rank, gate));
  const gateState = publishedGateJourneyState(
    gate,
    rank,
    publishedContentState.gates,
    publishedContentState.ranks,
    publishedContentState.journey,
    publishedContentState.gateProgress
  );
  if (!canRevealPublishedGateWords(gateState, publishedContentState.journey)) {
    section.append(renderPublishedEmpty(
      gateState === 'locked'
        ? 'أكمل البوابة السابقة لفتح كلمات هذه البوابة.'
        : 'تظهر كلمات هذه البوابة بعد بدء التعلم.',
      'fa-solid fa-lock'
    ));
    root.replaceChildren(section);
    return;
  }

  const pageMeta = getPublishedWordPageMeta(gate, snapshot);
  const toolbar = publishedElement('div', 'published-word-toolbar');
  const summary = publishedElement('div', 'published-word-summary');
  summary.setAttribute('aria-live', 'polite');
  summary.append(
    publishedElement('strong', '', 'كلمات البوابة'),
    publishedElement('span', '', pageMeta.countLabel)
  );
  toolbar.append(summary);
  section.append(toolbar);

  const hiddenWordKeys = new Set(getPublishedPersonalWords()
    .filter((word) => isDictionaryWordHidden(word))
    .map((word) => window.LootLinguaWordLifecycle?.wordKeyOf(word))
    .filter(Boolean));
  const gateWordKeys = new Set(
    (publishedContentState.gateProgress?.loadedWordKeys || []).map(String)
  );
  const hiddenCount = [...hiddenWordKeys].filter((key) => gateWordKeys.has(key)).length;
  if (hiddenCount) {
    const notice = publishedElement('div', 'published-hidden-words-note');
    notice.append(
      publishedIcon('fa-solid fa-eye-slash'),
      document.createTextNode(
        hiddenCount === 1
          ? 'لديك كلمة مخفية من هذه البوابة. تقدمها محفوظ وستظل تظهر في المراجعات والاختبارات.'
          : `لديك ${hiddenCount} كلمات مخفية من هذه البوابة. تقدمها محفوظ وستظل تظهر في المراجعات والاختبارات.`
      )
    );
    section.append(notice);
  }

  const page = snapshot?.currentPage;
  if (!page || !page.items.length) {
    section.append(renderPublishedEmpty('لا توجد كلمات منشورة في هذه البوابة.', 'fa-solid fa-language'));
  } else {
    const list = publishedElement('div', 'published-word-list');
    page.items.forEach((word) => list.append(makePublishedWordCard(word)));
    section.append(list);
  }

  const pagination = makePublishedPagination(snapshot, pageMeta);
  if (pagination) section.append(pagination);
  root.replaceChildren(section);
}

function createPublishedWordPager(worldId, rankId, gateId) {
  const listData = window.LootLinguaWordListData;
  if (!listData || typeof listData.createPagedWordSource !== 'function') {
    const error = new Error('Published word pagination is unavailable.');
    error.code = 'published/unavailable';
    throw error;
  }
  const api = getPublishedContentApi();
  const queryState = {
    sourceType: 'published-gate-words',
    worldId,
    rankId,
    gateId,
    sort: 'order',
    filters: { status: 'published' },
    pageSize: api.PAGE_SIZE,
  };
  return listData.createPagedWordSource({
    query: queryState,
    pageSize: api.PAGE_SIZE,
    maxCachedPages: 3,
    getItemId: (item) => String(item?.contentWordId || ''),
    fetchPage: ({ pageSize, direction, cursor }) =>
      api.listPublishedGateWords(worldId, rankId, gateId, {
        pageSize,
        direction,
        cursor,
      }),
  });
}

async function loadPublishedWordPage(direction) {
  const pager = publishedContentState.wordPager;
  if (!pager) return null;
  const pageDirection = direction === 'previous' ? 'previous' : 'next';
  const currentSnapshot = pager.getSnapshot();
  const currentPage = currentSnapshot.currentPage;
  if (!currentPage) return currentSnapshot;
  if (pageDirection === 'previous' && !currentPage.hasPrevious) return currentSnapshot;
  if (pageDirection === 'next' && !currentPage.hasNext) return currentSnapshot;
  if (publishedContentState.wordPageRequest) {
    return publishedContentState.wordPageRequest;
  }

  const generation = publishedContentState.generation;
  const previousPageIndex = currentSnapshot.currentPageIndex;
  const method = pageDirection === 'previous' ? 'loadPreviousPage' : 'loadNextPage';
  const task = pager[method]();
  publishedContentState.wordPageRequest = task;

  try {
    const result = await task;
    if (generation !== publishedContentState.generation) return result;
    publishedContentState.wordSnapshot = result;
    renderPublishedGateWords(
      publishedContentState.world,
      publishedContentState.rank,
      publishedContentState.gate,
      result
    );
    if (result.currentPageIndex !== previousPageIndex) {
      requestAnimationFrame(() => {
        const list = document.querySelector('.published-word-list') ||
          document.querySelector('.published-word-summary');
        if (!list) return;
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        list.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }
    return result;
  } catch (error) {
    if (generation !== publishedContentState.generation) return null;
    logPublishedContentError('words-page', error);
    renderPublishedError('words', error, () => loadPublishedWordPage(pageDirection));
    return null;
  } finally {
    if (publishedContentState.wordPageRequest === task) {
      publishedContentState.wordPageRequest = null;
    }
  }
}

function prepareWorldsShell() {
  window.saveActiveAddFormDraft?.();
  cleanupQuizSessionIfActive();
  if (currentView === 'personal') animateWorldsRoute('next');
  else if (WORLDS_VIEWS.has(currentView) && currentView !== 'worlds') animateWorldsRoute('back');
  beginViewSwitch();
  saveCurrentViewScroll();
  closeSidebarIfOpen();
  if (window.stopCustomWorldWordsCloudListener) window.stopCustomWorldWordsCloudListener();
  activeCustomWorldId = null;
  unloadListForView('worlds');
  currentView = 'worlds';

  setActiveNavLink(null);
  document.body.classList.remove('game-bg-active');
  document.body.removeAttribute('data-game');
  setTreasureMode(false);

  hideAllViewElements();
  setViewBackBar(false);
  setTreasureEntryVisible(true);
  setTreasureDockActive('worlds');

  const worldsView = document.getElementById('worldsView');
  if (worldsView) worldsView.style.display = 'block';

  syncWorldCardsLockUi();
  renderCustomWorldCards();

  document.querySelector('.page-header h1').innerHTML =
    '<i class="fa-solid fa-earth-americas" aria-hidden="true"></i> عوالم الأساطير';
  refreshFeatureUnlockUI();
}

async function loadPublishedWorlds(options) {
  const settings = options || {};
  const generation = ++publishedContentState.generation;
  publishedContentState.route = { key: 'worlds', params: {} };
  publishedContentState.wordPager?.invalidate();
  publishedContentState.wordPager = null;
  publishedContentState.wordSnapshot = null;
  publishedContentState.wordPageRequest = null;
  publishedContentState.ranks = [];
  publishedContentState.gates = [];
  clearPublishedJourneyViewState();
  publishedContentState.loading = true;
  renderPublishedLoading('جارٍ تحميل العوالم الجاهزة...');
  try {
    const [items, activeJourney] = await Promise.all([
      getPublishedContentApi().listPublishedWorlds({ force: settings.force }),
      readActivePublishedJourney({ force: settings.force }),
    ]);
    if (generation !== publishedContentState.generation) return;
    publishedContentState.activeJourney = activeJourney;
    renderPublishedWorlds(items, activeJourney);
  } catch (error) {
    if (generation !== publishedContentState.generation) return;
    logPublishedContentError('worlds', error);
    renderPublishedError('worlds', error, () => loadPublishedWorlds({ force: true }));
  } finally {
    if (generation === publishedContentState.generation) publishedContentState.loading = false;
  }
}

window.showPublishedWorldsTab = function() {
  setPublishedTabState('published');
  setPublishedTabsVisible(true);
  if (publishedContentState.route.key !== 'worlds') {
    setAppViewRoute('worlds');
  }
  loadPublishedWorlds();
};

window.showCustomWorldsTab = function() {
  ++publishedContentState.generation;
  publishedContentState.wordPager?.invalidate();
  publishedContentState.wordPager = null;
  publishedContentState.wordSnapshot = null;
  publishedContentState.wordPageRequest = null;
  publishedContentState.ranks = [];
  publishedContentState.gates = [];
  clearPublishedJourneyViewState();
  setPublishedTabState('custom');
  setPublishedTabsVisible(true);
  renderCustomWorldCards();
  setAppViewRoute('worlds');
};

window.loadWorldsView = function() {
  prepareWorldsShell();
  setPublishedTabState('published');
  setPublishedTabsVisible(true);
  loadPublishedWorlds();
  restoreViewScroll('worlds');
  setAppViewRoute('worlds');
};

async function loadPublishedRouteData(route, options) {
  const key = route?.key || 'not-found';
  const params = route?.params || {};
  const generation = ++publishedContentState.generation;
  publishedContentState.route = { key, params: { ...params } };
  publishedContentState.wordPager?.invalidate();
  publishedContentState.wordPager = null;
  publishedContentState.wordSnapshot = null;
  publishedContentState.wordPageRequest = null;
  publishedContentState.ranks = [];
  publishedContentState.gates = [];
  clearPublishedJourneyViewState();
  publishedContentState.loading = true;
  const level = key === 'world' ? 'ranks' : key === 'rank' ? 'gates' : 'words';
  renderPublishedLoading(
    key === 'world'
      ? 'جارٍ تحميل الرتب...'
      : key === 'rank'
        ? 'جارٍ تحميل البوابات...'
        : 'جارٍ تحميل كلمات البوابة...'
  );
  try {
    const api = getPublishedContentApi();
    if (key === 'not-found') {
      const notFound = new Error('Published route was not found.');
      notFound.code = 'published/not-found';
      throw notFound;
    }
    const world = await api.getPublishedWorld(params.worldId);
    if (generation !== publishedContentState.generation) return;
    publishedContentState.world = world;
    if (key === 'world') {
      const [ranks, journeyContext] = await Promise.all([
        api.listPublishedRanks(params.worldId, options),
        readPublishedJourneyContext(params.worldId, options),
      ]);
      if (generation !== publishedContentState.generation) return;
      publishedContentState.ranks = ranks;
      publishedContentState.journey = journeyContext.journey;
      publishedContentState.activeJourney = journeyContext.activeJourney;
      if (await maybeRenderPublishedLevelPlacementResume(journeyContext.journey, generation)) {
        return;
      }
      if (await maybeRenderPublishedPlacementResume(journeyContext.journey, generation)) {
        return;
      }
      renderPublishedRanks(
        world,
        ranks,
        journeyContext.journey,
        journeyContext.activeJourney
      );
      return;
    }
    const rank = await api.getPublishedRank(params.worldId, params.rankId);
    if (generation !== publishedContentState.generation) return;
    publishedContentState.rank = rank;
    if (key === 'rank') {
      const [gates, ranks, journeyContext] = await Promise.all([
        api.listPublishedGates(params.worldId, params.rankId, options),
        api.listPublishedRanks(params.worldId, options),
        readPublishedJourneyContext(params.worldId, options),
      ]);
      if (generation !== publishedContentState.generation) return;
      const gateProgressById = await readPublishedRankGateProgress(
        params.worldId,
        params.rankId,
        journeyContext.journey,
        options
      );
      if (generation !== publishedContentState.generation) return;
      publishedContentState.ranks = ranks;
      publishedContentState.gates = gates;
      publishedContentState.journey = journeyContext.journey;
      publishedContentState.activeJourney = journeyContext.activeJourney;
      publishedContentState.gateProgressById = gateProgressById;
      if (await maybeRenderPublishedLevelPlacementResume(journeyContext.journey, generation)) {
        return;
      }
      if (await maybeRenderPublishedPlacementResume(journeyContext.journey, generation)) {
        return;
      }
      renderPublishedGates(
        world,
        rank,
        gates,
        ranks,
        journeyContext.journey,
        journeyContext.activeJourney,
        gateProgressById
      );
      return;
    }
    const gate = await api.getPublishedGate(params.worldId, params.rankId, params.gateId);
    if (generation !== publishedContentState.generation) return;
    publishedContentState.gate = gate;
    const [ranks, gates, journeyContext] = await Promise.all([
      api.listPublishedRanks(params.worldId, options),
      api.listPublishedGates(params.worldId, params.rankId, options),
      readPublishedJourneyContext(params.worldId, options),
    ]);
    if (generation !== publishedContentState.generation) return;
    const gateProgress = await readPublishedGateProgress(
      params.worldId,
      params.rankId,
      params.gateId,
      journeyContext.journey,
      options
    );
    if (generation !== publishedContentState.generation) return;
    publishedContentState.ranks = ranks;
    publishedContentState.gates = gates;
    publishedContentState.journey = journeyContext.journey;
    publishedContentState.activeJourney = journeyContext.activeJourney;
    publishedContentState.gateProgress = gateProgress;
    if (gateProgress) {
      publishedContentState.gateProgressById.set(String(params.gateId), gateProgress);
    }
    if (await maybeRenderPublishedLevelPlacementResume(journeyContext.journey, generation)) {
      return;
    }
    if (await maybeRenderPublishedPlacementResume(journeyContext.journey, generation)) {
      return;
    }
    const gateState = publishedGateJourneyState(
      gate,
      rank,
      gates,
      ranks,
      journeyContext.journey,
      gateProgress
    );
    if (!canRevealPublishedGateWords(gateState, journeyContext.journey)) {
      renderPublishedGateWords(world, rank, gate, null);
      return;
    }
    const pager = createPublishedWordPager(params.worldId, params.rankId, params.gateId);
    publishedContentState.wordPager = pager;
    const snapshot = await pager.loadInitialPage();
    if (generation !== publishedContentState.generation) return;
    publishedContentState.wordSnapshot = snapshot;
    renderPublishedGateWords(world, rank, gate, snapshot);
    if (gateProgress?.status === 'learning' && window.auth?.currentUser) {
      getJourneyCloudApi().findNewGateWords(
        params.worldId,
        params.rankId,
        params.gateId
      ).then((newWords) => {
        if (generation !== publishedContentState.generation) return;
        publishedContentState.newGateWords = newWords;
        renderPublishedGateWords(world, rank, gate, publishedContentState.wordSnapshot);
      }).catch((error) => logPublishedContentError('gate-new-words', error));
    }
  } catch (error) {
    if (generation !== publishedContentState.generation) return;
    logPublishedContentError(key, error);
    renderPublishedError(level, error, () => loadPublishedRouteData(route, { force: true }));
  } finally {
    if (generation === publishedContentState.generation) publishedContentState.loading = false;
  }
}

window.loadPublishedContentRoute = function(route) {
  animatePublishedRouteChange(route?.key || 'not-found');
  prepareWorldsShell();
  setPublishedTabState('published');
  setPublishedTabsVisible(false);
  window.scrollTo({ top: 0, behavior: 'auto' });
  loadPublishedRouteData(route);
};

window.openPublishedWorldsRoot = function() {
  animatePublishedRouteChange('worlds');
  setAppViewRoute('worlds');
  window.loadWorldsView();
};

window.openPublishedWorld = function(worldId) {
  const route = { key: 'world', params: { worldId: String(worldId || '') } };
  setPublishedContentRoute(route.key, route.params);
  window.loadPublishedContentRoute(route);
};

window.openPublishedRank = function(worldId, rankId) {
  const route = {
    key: 'rank',
    params: { worldId: String(worldId || ''), rankId: String(rankId || '') },
  };
  setPublishedContentRoute(route.key, route.params);
  window.loadPublishedContentRoute(route);
};

window.openPublishedGate = function(worldId, rankId, gateId) {
  const route = {
    key: 'gate',
    params: {
      worldId: String(worldId || ''),
      rankId: String(rankId || ''),
      gateId: String(gateId || ''),
    },
  };
  setPublishedContentRoute(route.key, route.params);
  window.loadPublishedContentRoute(route);
};

window.addEventListener('lootlingua:auth-state', () => {
  clearPublishedJourneyViewState({ clearError: true });
  if (currentView !== 'worlds' || publishedContentState.tab !== 'published') return;
  const route = publishedContentState.route;
  if (!route || route.key === 'worlds') {
    loadPublishedWorlds({ force: true });
  } else {
    loadPublishedRouteData(route, { force: true });
  }
});

window.addEventListener('lootlingua:journey-advanced', (event) => {
  const detail = event.detail || {};
  const message = detail.journeyCompleted
    ? 'أحسنت! أكملت آخر بوابة في هذا العالم.'
    : detail.rankUnlocked
      ? `فُتحت رتبة ${detail.nextRankTitle || 'جديدة'} وأول بوابة فيها.`
      : `فُتحت بوابة ${detail.nextGateTitle || 'جديدة'}.`;
  if (typeof pushNotification === 'function') pushNotification(message, 'success');
  showToast(message, 'success', 6500);
  if (typeof launchConfetti === 'function') launchConfetti();
});

function normalizeCustomWorldPayload({ name, description, emoji, id } = {}) {
  const cleanName = String(name || '').trim().slice(0, 40);
  const cleanId = String(id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    .replace(/\//g, '_')
    .slice(0, 500);
  return {
    id: cleanId,
    name: cleanName,
    description: String(description || '').trim().slice(0, 140),
    emoji: String(emoji || '📘').trim().slice(0, 4) || '📘',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function renderCustomWorldCards() {
  const grid = document.getElementById('worldsGrid');
  if (!grid) return;
  grid.querySelectorAll('.custom-world-generated, .world-card-add').forEach(el => el.remove());
  const frag = document.createDocumentFragment();
  customWorlds = dedupeCustomWorlds(customWorlds);
  customWorlds.forEach((world) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'world-card custom-world-generated world-card-custom';
    card.dataset.worldId = world.id;
    card.onclick = () => loadCustomWorld(world.id);
    card.innerHTML = `
      <span class="world-card-icon custom-world-emoji" aria-hidden="true">${escapeHtml(world.emoji || '📘')}</span>
      <strong>${escapeHtml(world.name || 'عالم جديد')}</strong>
      <span class="world-card-desc">${escapeHtml(world.description || 'قاموس خاص بك')}</span>
    `;
    frag.appendChild(card);
  });
  const addCard = document.createElement('button');
  addCard.type = 'button';
  addCard.className = 'world-card world-card-add';
  addCard.setAttribute('aria-label', 'إنشاء عالم جديد');
  addCard.onclick = () => openCustomWorldModal();
  addCard.innerHTML = '<span class="world-add-plus" aria-hidden="true">+</span>';
  frag.appendChild(addCard);
  grid.appendChild(frag);
}

function setEmojiPickerValue(emoji) {
  const input = document.getElementById('customWorldEmojiInput');
  if (input) input.value = emoji || '📘';
  document.querySelectorAll('#customWorldEmojiPicker [data-emoji]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.emoji === (emoji || '📘'));
  });
}

window.openCustomWorldModal = function(options = {}) {
  pendingCustomWorldModalMode = options.mode || 'create';
  pendingCustomWorldEditId = options.worldId || null;
  pendingWorldManageCreateAction = options.afterCreateAction || null;
  const world = pendingCustomWorldEditId
    ? customWorlds.find(item => String(item.id) === String(pendingCustomWorldEditId))
    : null;
  const title = document.getElementById('customWorldModalTitle');
  const saveBtn = document.getElementById('customWorldSaveBtn');
  const icon = document.getElementById('customWorldModalIcon');
  const nameInput = document.getElementById('customWorldNameInput');
  const descInput = document.getElementById('customWorldDescInput');
  if (title) title.textContent = world ? 'تعديل العالم' : 'إنشاء عالم جديد';
  if (saveBtn) saveBtn.textContent = world ? 'حفظ التعديل' : 'إنشاء عالم';
  if (icon) icon.textContent = world?.emoji || '+';
  if (nameInput) nameInput.value = world?.name || String(options.suggestedName || '');
  if (descInput) descInput.value = world?.description || String(options.suggestedDescription || '');
  if (options.levelPlacementAssessmentId) {
    document.getElementById('customWorldModal')?.setAttribute(
      'data-level-placement-assessment-id',
      String(options.levelPlacementAssessmentId)
    );
  } else {
    document.getElementById('customWorldModal')?.removeAttribute(
      'data-level-placement-assessment-id'
    );
  }
  setEmojiPickerValue(world?.emoji || '📘');
  showModal('customWorldModal');
  setTimeout(() => nameInput?.focus(), 60);
};

window.closeCustomWorldModal = function() {
  hideModal('customWorldModal');
  pendingWorldManageCreateAction = null;
};

window.saveCustomWorldFromModal = async function() {
  const nameInput = document.getElementById('customWorldNameInput');
  const descInput = document.getElementById('customWorldDescInput');
  const emojiInput = document.getElementById('customWorldEmojiInput');
  const saveBtn = document.getElementById('customWorldSaveBtn');
  const name = String(nameInput?.value || '').trim();
  if (!name) {
    showToast('اسم العالم مطلوب');
    nameInput?.focus();
    return;
  }
  const existing = pendingCustomWorldEditId
    ? customWorlds.find(world => String(world.id) === String(pendingCustomWorldEditId))
    : null;
  const next = {
    ...normalizeCustomWorldPayload({
      id: existing?.id,
      name,
      description: descInput?.value || '',
      emoji: emojiInput?.value || '📘',
    }),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  const uid = window.auth?.currentUser?.uid;
  const signedIn = Boolean(uid);
  let cloudSaved = !signedIn;
  let cloudError = '';
  const offlineAtSave = signedIn && navigator.onLine === false;
  if (saveBtn) saveBtn.disabled = true;
  if (signedIn) {
    console.info('[LootLingua customWorlds] save requested', {
      uid,
      worldId: next.id,
      path: `users/${uid}/customWorlds/${next.id}`,
      mode: existing ? 'edit' : 'create',
    });
    cloudSaved = window.saveCustomWorldToCloud
      ? await window.saveCustomWorldToCloud(next)
      : false;
    if (cloudSaved === true && !offlineAtSave) {
      clearPendingCustomWorld(next.id, uid);
      delete next.syncStatus;
      delete next.lastSyncError;
    } else {
      cloudError = offlineAtSave ? 'offline-pending-server-confirmation' : (window.__lastCustomWorldSaveError || 'cloud-save-failed');
      next.syncStatus = 'pending';
      next.lastSyncError = cloudError;
      upsertPendingCustomWorld(next, cloudError, uid);
    }
  }
  if (existing) {
    customWorlds = customWorlds.map(world => String(world.id) === String(existing.id) ? next : world);
  } else {
    customWorlds = dedupeCustomWorlds([...customWorlds, next]);
  }
  writeCustomWorldsToStorage(customWorlds, uid);
  console.info('[LootLingua customWorlds] local state saved', {
    uid: uid || 'guest',
    worldId: next.id,
    cloudSaved,
    syncStatus: next.syncStatus || 'synced-or-guest',
    cloudError,
  });
  renderCustomWorldCards();
  if (saveBtn) saveBtn.disabled = false;
  hideModal('customWorldModal');
  if (pendingWorldManageCreateAction) {
    const action = pendingWorldManageCreateAction;
    pendingWorldManageCreateAction = null;
    await window.applyWorldManageToTarget(next.id, action);
    return;
  }
  if (isCustomWorldView() && String(activeCustomWorldId) === String(next.id)) updateCustomWorldHeader();
  if (signedIn && (cloudSaved !== true || offlineAtSave)) {
    showToast('تم حفظ العالم على هذا الجهاز، لكن تعذرت مزامنته مع السحابة. سنحتفظ به حتى تنجح المزامنة.', 'warning', 6200);
  } else {
    showToast(existing ? 'تم تعديل العالم' : 'تم إنشاء العالم', 'success');
  }
};

function updateCustomWorldHeader() {
  const world = getActiveCustomWorld();
  const title = document.querySelector('.page-header h1');
  if (!title || !world) return;
  title.innerHTML = `
    <span class="custom-world-title-emoji">${escapeHtml(world.emoji || '📘')}</span>
    <span>${escapeHtml(world.name || 'عالم جديد')}</span>
    <button type="button" class="custom-world-title-action" onclick="openCustomWorldModal({ mode: 'edit', worldId: '${escapeHtml(String(world.id))}' })" aria-label="تعديل العالم" title="تعديل العالم"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
    <button type="button" class="custom-world-title-action danger" onclick="openDeleteCustomWorldModal('${escapeHtml(String(world.id))}')" aria-label="حذف العالم" title="حذف العالم"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
  `;
}

window.loadCustomWorld = function(worldId) {
  window.saveActiveAddFormDraft?.();
  const world = customWorlds.find(item => String(item.id) === String(worldId));
  if (!world) {
    showToast('هذا العالم غير موجود');
    renderCustomWorldCards();
    return;
  }
  cleanupQuizSessionIfActive();
  if (isBulkDeleteMode) window.exitBulkDeleteMode();
  if (currentView === 'worlds' || currentView === 'personal') animateWorldsRoute('next');
  beginViewSwitch();
  saveCurrentViewScroll();
  closeSidebarIfOpen();
  activeCustomWorldId = String(world.id);
  currentView = 'customWorld';
  viewBackTarget = 'worlds';
  currentFilter = 'all';
  loadDictionarySortPrefs();
  window.words = applyStoredWordOrder(readCustomWorldWordsFromStorage(activeCustomWorldId));
  if (dictionarySortMode !== 'auto') window.words = sortDictionaryWords(window.words);
  renderLimit = 20;
  document.body.classList.remove('game-bg-active');
  document.body.removeAttribute('data-game');
  setTreasureMode(false);
  hideAllViewElements();
  document.getElementById('personalControls').style.display = 'block';
  document.querySelector('.search-bar-row').style.display   = '';
  document.getElementById('selectionActionBar').hidden = true;
  document.getElementById('bulkDeleteBar').style.display    = 'none';
  document.querySelector('.backup-zone').style.display      = '';
  document.getElementById('list').style.display             = '';
  restoreActiveAddFormDraft();
  setViewBackBar(true, 'رجوع لعوالم الأساطير');
  setTreasureEntryVisible(true);
  setTreasureDockActive('worlds');
  updateCustomWorldHeader();
  setActiveNavLink(null);
  clearInterval(window.__lootCountdownTimer);
  render();
  restoreViewScroll(getActiveDictionaryStorageScope());
  refreshFeatureUnlockUI();
  if (window.listenCustomWorldWordsFromCloud) window.listenCustomWorldWordsFromCloud(activeCustomWorldId);
  setAppViewRoute('worlds');
};

function getSelectedWordsForWorldManage() {
  return [...bulkSelectedWordIds]
    .map(id => window.words.find(word => String(word.id) === String(id)))
    .filter(Boolean);
}

function makeCopiedWord(word) {
  return applyKnownSharedMastery({
    ...word,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    order: 0,
    createdAt: new Date().toISOString(),
  });
}

function getTargetDictionaryWords(targetId) {
  const uid = window.auth?.currentUser?.uid;
  if (targetId === 'personal') return readWordsFromStorage('normal', uid);
  return window.isActiveCustomWorld?.(targetId)
    ? getActiveDictionaryWords()
    : readCustomWorldWordsFromStorage(targetId, uid);
}

function getTargetDictionaryLabel(targetId) {
  if (targetId === 'personal') return 'القاموس الشخصي';
  const world = customWorlds.find(item => String(item.id) === String(targetId));
  return world ? `${world.emoji || '📘'} ${world.name || 'العالم'}` : 'العالم المحدد';
}

function splitWordsByExistingInTarget(targetId, words) {
  const existing = new Set(getTargetDictionaryWords(targetId)
    .map(word => normalizeWord(word.word || word.text))
    .filter(Boolean));
  const movable = [];
  const skipped = [];
  words.forEach((word) => {
    const key = normalizeWord(word.word || word.text);
    if (key && existing.has(key)) {
      skipped.push(word);
      return;
    }
    movable.push(word);
    if (key) existing.add(key);
  });
  return { movable, skipped };
}

function getWorldManageTargets() {
  const targets = [];
  if (isCustomWorldView()) {
    targets.push({ type: 'personal', id: 'personal', label: 'القاموس الشخصي', emoji: '📘', desc: 'قاموسك الأساسي' });
  }
  customWorlds.forEach((world) => {
    if (isCustomWorldView() && String(world.id) === String(activeCustomWorldId)) return;
    targets.push({
      type: 'custom',
      id: world.id,
      label: world.name || 'عالم جديد',
      emoji: world.emoji || '📘',
      desc: world.description || 'عالم خاص',
    });
  });
  return targets;
}

function renderWorldManageTargets() {
  const wrap = document.getElementById('worldManageTargets');
  const summary = document.getElementById('worldManageSummary');
  if (!wrap) return;
  const selectedCount = bulkSelectedWordIds.size;
  if (summary) summary.textContent = `الكلمات المحددة: ${selectedCount}`;
  const targets = getWorldManageTargets();
  const targetHtml = targets.map(target => `
    <button type="button" class="world-manage-target" onclick="applyWorldManageToTarget('${escapeHtml(String(target.id))}', '${pendingWorldManageAction}')">
      <span>${escapeHtml(target.emoji)}</span>
      <strong>${escapeHtml(target.label)}</strong>
      <small>${escapeHtml(target.desc)}</small>
    </button>
  `).join('');
  wrap.innerHTML = `
    ${targetHtml || '<p class="world-manage-empty">لا يوجد عوالم خاصة بعد.</p>'}
    <button type="button" class="world-manage-target world-manage-add" onclick="openCustomWorldModal({ afterCreateAction: '${pendingWorldManageAction}' })">
      <span>+</span>
    </button>
  `;
}

window.openWorldManageModal = function() {
  if (!isEditableDictionaryView()) return;
  if (!bulkSelectedWordIds.size) {
    window.enterSelectionMode();
  }
  if (!bulkSelectedWordIds.size) return;
  pendingWorldManageAction = 'move';
  document.querySelectorAll('.world-manage-tabs [data-world-action]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.worldAction === pendingWorldManageAction);
  });
  renderWorldManageTargets();
  showModal('worldManageModal');
};

window.setWorldManageAction = function(action) {
  pendingWorldManageAction = action === 'copy' ? 'copy' : 'move';
  document.querySelectorAll('.world-manage-tabs [data-world-action]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.worldAction === pendingWorldManageAction);
  });
  renderWorldManageTargets();
};

async function saveWordsToTarget(targetId, wordsToAdd) {
  if (!wordsToAdd.length) return [];
  const uid = window.auth?.currentUser?.uid;
  const signedIn = Boolean(window.auth?.currentUser);
  if (targetId === 'personal') {
    const currentPersonal = isCustomWorldView()
      ? readWordsFromStorage('normal', uid)
      : window.words;
    if (signedIn && window.saveWordToCloud) {
      for (const word of wordsToAdd) {
        const realId = await window.saveWordToCloud(
          word.word,
          word.category || 'عام',
          word.meaning || '',
          word.example || '',
          word.order ?? 0,
          {
            ...word,
            lifecycleSource: isCustomWorldView()
              ? { type: 'private-world', customWorldId: String(activeCustomWorldId) }
              : { type: 'manual' },
          }
        );
        if (!realId) throw new Error('target-personal-upload-failed');
        word.id = realId;
      }
    }
    const next = [...wordsToAdd, ...currentPersonal];
    reindexWordOrder(next);
    writeWordsToStorage(next, 'normal', uid);
    if (!isCustomWorldView()) window.words = next;
    return next;
  }
  const targetWords = window.isActiveCustomWorld?.(targetId)
    ? window.words
    : readCustomWorldWordsFromStorage(targetId, uid);
  if (signedIn && window.saveCustomWorldWordToCloud) {
    for (const word of wordsToAdd) {
      const realId = await window.saveCustomWorldWordToCloud(targetId, word);
      if (!realId) throw new Error('target-world-upload-failed');
      word.id = realId;
    }
  }
  const next = [...wordsToAdd, ...targetWords];
  reindexWordOrder(next);
  writeCustomWorldWordsToStorage(targetId, next, uid);
  if (window.isActiveCustomWorld?.(targetId)) window.words = next;
  return next;
}

function showSkippedDuplicateWordsNotice(skipped, targetId = 'personal') {
  if (!skipped?.length) return;
  const names = skipped.map(word => word.word).filter(Boolean).slice(0, 5).join('، ');
  const more = skipped.length > 5 ? ` و${skipped.length - 5} غيرها` : '';
  showToast(`لم يتم نقل ${skipped.length} كلمة لأنها موجودة مسبقاً في ${getTargetDictionaryLabel(targetId)}: ${names}${more}`, 'warning', 6200);
}

window.applyWorldManageToTarget = async function(targetId, action = pendingWorldManageAction) {
  const selected = getSelectedWordsForWorldManage();
  if (!selected.length) return;
  const mode = action === 'copy' ? 'copy' : 'move';
  try {
    const { movable, skipped } = splitWordsByExistingInTarget(targetId, selected);
    if (!movable.length) {
      showSkippedDuplicateWordsNotice(skipped, targetId);
      return;
    }
    const copiedWords = movable.map(makeCopiedWord);
    await saveWordsToTarget(targetId, copiedWords);
    if (mode === 'move') {
      const selectedSet = new Set(movable.map(word => String(word.id)));
      const sourceIds = movable.map(word => String(word.id));
      window.words = window.words.filter(word => !selectedSet.has(String(word.id)));
      reindexWordOrder(window.words);
      writeActiveWordsToStorage(window.words);
      if (window.auth?.currentUser) {
        await Promise.all(sourceIds.map(id => deleteActiveWordFromCloud(id)));
      }
    }
    hideModal('worldManageModal');
    window.exitSelectionMode();
    renderCustomWorldCards();
    renderLimit = 20;
    render();
    if (skipped.length) showSkippedDuplicateWordsNotice(skipped, targetId);
    showToast(mode === 'copy' ? `تم نسخ ${movable.length} كلمة` : `تم نقل ${movable.length} كلمة`, 'success');
  } catch (err) {
    console.warn('worldManage:', err);
    showToast('ما قدرنا نكمل العملية سحابياً. الكلمات بقيت في مكانها.', 'danger', 5200);
  }
};

window.openDeleteCustomWorldModal = function(worldId) {
  const world = customWorlds.find(item => String(item.id) === String(worldId));
  if (!world) return;
  pendingDeleteWorldId = String(worldId);
  const title = document.getElementById('deleteWorldTitle');
  if (title) title.textContent = `حذف ${world.emoji || '📘'} ${world.name || 'العالم'}`;
  showModal('deleteWorldModal');
};

window.confirmDeleteCustomWorld = async function(action) {
  const worldId = pendingDeleteWorldId;
  if (!worldId) return;
  const uid = window.auth?.currentUser?.uid;
  try {
    const worldWords = window.isActiveCustomWorld?.(worldId)
      ? [...window.words]
      : readCustomWorldWordsFromStorage(worldId, uid);
    let skippedDuplicates = [];
    if (action === 'move' && worldWords.length) {
      const { movable, skipped } = splitWordsByExistingInTarget('personal', worldWords);
      skippedDuplicates = skipped;
      if (movable.length) await saveWordsToTarget('personal', movable.map(makeCopiedWord));
    }
    if (window.auth?.currentUser && window.deleteCustomWorldFromCloud) {
      const deleted = await window.deleteCustomWorldFromCloud(worldId);
      if (!deleted) throw new Error('delete-world-cloud-failed');
    }
    customWorlds = customWorlds.filter(world => String(world.id) !== String(worldId));
    clearPendingCustomWorld(worldId, uid);
    writeCustomWorldsToStorage(customWorlds, uid);
    removeCustomWorldWordsFromStorage(worldId, uid);
    hideModal('deleteWorldModal');
    pendingDeleteWorldId = null;
    renderCustomWorldCards();
    if (window.isActiveCustomWorld?.(worldId)) loadWorldsView();
    if (skippedDuplicates.length) showSkippedDuplicateWordsNotice(skippedDuplicates, 'personal');
    else showToast(action === 'move' ? 'تم نقل كل الكلمات وحذف العالم' : 'تم حذف العالم', 'success');
  } catch (err) {
    console.warn('deleteCustomWorld:', err);
    showToast('ما قدرنا نحذف العالم سحابياً الآن. لم يتم حذف بياناته.', 'danger', 5200);
  }
};

// ── Treasure Full-Page View ──
window.loadTreasureView = function() {
  window.saveActiveAddFormDraft?.();
  cleanupQuizSessionIfActive();
  if (!isFeatureUnlocked('treasure')) {
    openUnlockExplainModal('treasure');
    refreshFeatureUnlockUI();
    return;
  }
  animateTreasureRoute('next');
  beginViewSwitch();
  saveCurrentViewScroll();
  closeSidebarIfOpen();
  unloadListForView('treasure');
  unloadPersonalListForTreasure();
  currentView = 'treasure';

  setActiveNavLink(null);
  document.body.classList.remove('game-bg-active');
  document.body.removeAttribute('data-game');

  hideAllViewElements();
  setViewBackBar(false);
  setTreasureMode(true);
  setTreasureEntryVisible(true);
  setTreasureDockActive('treasure');

  const view = document.getElementById('treasureView');
  if (view) view.style.display = 'block';
  renderTreasureRoom();

  document.querySelector('.page-header h1').innerHTML = '<i class="fa-solid fa-gem" aria-hidden="true"></i> صفحة الكنز';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  refreshFeatureUnlockUI();
  setAppViewRoute('treasure');
};

// ── Starred Words View ──
window.loadStarredView = function() {
  window.saveActiveAddFormDraft?.();
  cleanupQuizSessionIfActive();
  if (!isFeatureUnlocked('starred')) {
    openUnlockExplainModal('starred');
    refreshFeatureUnlockUI();
    return;
  }
  if (currentView === 'personal' || currentView === 'worlds') animateWorldsRoute('next');
  beginViewSwitch();
  saveCurrentViewScroll();
  closeSidebarIfOpen();
  currentView = 'starred';
  viewBackTarget = 'worlds';

  setActiveNavLink('starred');

  document.body.classList.remove('game-bg-active');
  document.body.removeAttribute('data-game');
  setTreasureMode(false);

  hideAllViewElements();
  setViewBackBar(true, 'رجوع لعوالم الأساطير');
  setTreasureEntryVisible(true);
  setTreasureDockActive('worlds');
  document.getElementById('starredSearchBar').style.display = 'block';
  document.getElementById('starredSearchInput').value = '';
  document.getElementById('bulkDeleteBar').style.display = '';
  document.getElementById('list').style.display = '';

  document.querySelector('.page-header h1').innerHTML = '<i class="fas fa-star" aria-hidden="true"></i> الكلمات الصعبة';

  renderStarredWords();
  restoreViewScroll('starred');
  refreshFeatureUnlockUI();
  setAppViewRoute('starred');
};

function renderStarredWords() {
  const query = (document.getElementById('starredSearchInput')?.value || '').toLowerCase().trim();
  let starred = window.words.filter(w =>
    w.starred && window.LootLinguaWordLifecycle?.isVisibleInDictionaryList(w) !== false
  );

  if (query) {
    starred = starred.filter(w =>
      w.word.toLowerCase().includes(query) ||
      (w.meaning || '').toLowerCase().includes(query)
    );
    starred.sort((a, b) => {
      const aStarts = a.word.toLowerCase().startsWith(query);
      const bStarts = b.word.toLowerCase().startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.word.localeCompare(b.word);
    });
  }

  const listEl = document.getElementById('list');
  if (!listEl) return;

  if (starred.length === 0) {
    listEl.innerHTML = `
      <li style="list-style:none;text-align:center;padding:40px 20px;color:var(--text-gray);">
        <div style="font-size:32px;margin-bottom:10px;"><i class="fas fa-star" aria-hidden="true"></i></div>
        ${query ? 'ما في نتائج للبحث' : 'ما عندك كلمات صعبة بعد!'}
      </li>`;
    return;
  }

  listEl.innerHTML = starred.map(w => {
    const ri = window.words.findIndex(x => x.id === w.id);
    const safeId = w.id.replace(/'/g, "\\'");
    const dispWord   = query ? highlightText(w.word, query) : escapeHtml(w.word);
    const dispMeaning = query ? highlightText(w.meaning, query) : escapeHtml(w.meaning);
    const cls = ['word-card',
      isBulkDeleteMode && bulkSelectedWordIds.has(String(w.id)) ? 'bulk-selected' : '',
      w.expanded ? 'show-example' : ''
    ].filter(Boolean).join(' ');
    return `
      <li class="${cls}" data-action="toggle-expand" data-index="${ri}" data-id="${safeId}">
        <div class="word-body" style="flex:1;min-width:0;" data-action="toggle-expand" data-index="${ri}">
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;">
            <button class="star-btn active" data-tip="صعبة" data-action="star" data-id="${safeId}">
              <i class="fas fa-star"></i>
            </button>
            <div>
              <div class="word-text">
                ${dispWord}
                <span class="cat-tag tag-${safeClassToken(w.category)}">${escapeHtml(w.category)}</span>
                ${renderMasteryIndicator(w)}
              </div>
              <div class="meaning-text">${dispMeaning}</div>
            </div>
          </div>
          ${w.example ? `<div class="example-box"><b>Ex:</b> ${highlightText(w.example, query)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="icon-circle sound-btn" data-tip="نطق" data-action="sound" data-id="${safeId}"><i class="fas fa-volume-up"></i></button>
          <button class="icon-circle edit-btn"  data-tip="تعديل" data-action="edit" data-id="${safeId}"><i class="fas fa-edit"></i></button>
          <button class="icon-circle del-btn"   data-tip="حذف" data-action="delete" data-id="${safeId}"><i class="fas fa-trash-alt"></i></button>
        </div>
      </li>`;
  }).join('');
}

// ── Quiz Full-Page View ──
window.loadQuizView = function() {
  window.saveActiveAddFormDraft?.();
  if (!isFeatureUnlocked('quiz')) {
    openUnlockExplainModal('quiz');
    refreshFeatureUnlockUI();
    return;
  }
  beginViewSwitch();
  saveCurrentViewScroll();
  closeSidebarIfOpen();
  unloadListForView('quiz');
  currentView = 'quiz';

  setActiveNavLink('quiz');

  // Remove game background
  document.body.classList.remove('game-bg-active');
  document.body.removeAttribute('data-game');
  setTreasureMode(false);

  // Hide personal controls, show only quiz view
  hideAllViewElements();
  setViewBackBar(false);
  setTreasureEntryVisible(true);
  setTreasureDockActive('quiz');
  document.getElementById('quizView').style.display = 'block';
  showQuizModes();
  loadStoredActiveQuizSession().then((session) => {
    if (currentView !== 'quiz') return;
    if (!isResumableQuizSession(session)) {
      if (session) clearActiveQuizSessionStorage();
      return;
    }
    window.__pendingQuizResumeSession = session;
    showQuizResumePrompt();
  });

  document.querySelector('.page-header h1').innerHTML = '<i class="fas fa-gamepad" aria-hidden="true"></i> الاختبار';

  // Update available words count
  refreshQuizAvailableCount();

  restoreViewScroll('quiz');
  refreshFeatureUnlockUI();
  setAppViewRoute('quiz');
};

window.loadPersonalDictionary = function() {
  if (currentView === 'admin' && typeof window.canLeaveAdminView === 'function' &&
      window.canLeaveAdminView('personal') === false) return false;
  window.saveActiveAddFormDraft?.();
  cleanupQuizSessionIfActive();
  if (isBulkDeleteMode) window.exitBulkDeleteMode();
  const returningFromTreasure = currentView === 'treasure';
  const returningFromWorlds = WORLDS_VIEWS.has(currentView) || currentView === 'quiz';
  if (returningFromTreasure) animateTreasureRoute('back');
  else if (returningFromWorlds) animateWorldsRoute('back');
  beginViewSwitch();
  saveCurrentViewScroll();
  if (window.stopCustomWorldWordsCloudListener) window.stopCustomWorldWordsCloudListener();
  activeCustomWorldId = null;
  closeSidebarIfOpen();
  currentView = 'personal';
  loadDictionarySortPrefs();
  window.words = applyStoredWordOrder(readWordsFromStorage('normal', window.auth?.currentUser?.uid));
  if (dictionarySortMode !== 'auto') {
    window.words = sortDictionaryWords(window.words);
  }
  // لو كان فلتر الصعبة مفعّل — يرجع للكل
  if (currentFilter !== 'all') {
    currentFilter = 'all';
  }

  // إزالة خلفية اللعبة
  document.body.classList.remove('game-bg-active');
  document.body.classList.remove('admin-mode');
  document.body.removeAttribute('data-game');
  setTreasureMode(false);

  // إظهار كل عناصر القاموس الشخصي
  document.getElementById('personalControls').style.display = 'block';
  document.querySelector('.search-bar-row').style.display   = '';
  document.getElementById('bulkDeleteBar').style.display    = '';
  document.querySelector('.backup-zone').style.display      = '';
  document.getElementById('list').style.display             = '';
  restoreActiveAddFormDraft();

  // إخفاء search bar الألعاب والكلمات الصعبة والكويز
  document.getElementById('gameSearchBar').style.display    = 'none';
  document.getElementById('starredSearchBar').style.display = 'none';
  document.getElementById('quizView').style.display         = 'none';
  const treasureView = document.getElementById('treasureView');
  if (treasureView) treasureView.style.display = 'none';
  const worldsView = document.getElementById('worldsView');
  if (worldsView) worldsView.style.display = 'none';
  const adminView = document.getElementById('adminView');
  if (adminView) {
    adminView.hidden = true;
    adminView.style.display = 'none';
  }
  setTreasureEntryVisible(true);
  setTreasureDockActive('personal');

  document.querySelector('.page-header h1').innerHTML = '<i class="fa-solid fa-sword" aria-hidden="true"></i> قاموسك الشخصي';
  setActiveNavLink('personal');
  setViewBackBar(false);
  clearInterval(window.__lootCountdownTimer);
  render();
  updateDailyQuestsBadge();
  restoreViewScroll('personal');
  refreshFeatureUnlockUI();
  setAppViewRoute('personal');
  return true;
};

window.addFromGame = async function(text, meaning, example, btnEl) {
  const xpGain = 0;
  const existingWord = window.LootLinguaWordLifecycle?.findUserWordByKey(
    getPersonalDictionaryWordsSnapshot(),
    text
  );
  // تحقق من التكرار
  if (existingWord && !isDictionaryWordHidden(existingWord)) {
    showToast('هذه الكلمة موجودة بالفعل في قاموسك');
    if (btnEl) { btnEl.textContent='✓'; btnEl.disabled=true; btnEl.classList.add('btn-already-added'); }
    return;
  }
  // Spam protection
  if (!rateLimit('addFromGame', 10, 30000)) return;

  if (btnEl) { btnEl.textContent='...'; btnEl.disabled=true; }

  const canUseCloud = Boolean(window.auth?.currentUser && window.saveWordToCloud);
  const refreshAfterGameDictionaryAdd = () => {
    if (currentView === 'personal') render();
    else if (currentView === 'minecraft' || currentView === 'pubg') renderGameWords(currentGameWords);
    refreshFeatureUnlockUI();
  };
  if (canUseCloud) {
    const realId = await window.saveWordToCloud(
      text,
      'لعبة',
      meaning,
      example || '',
      0,
      { lifecycleSource: { type: 'dictionary-search' }, existingWordId: existingWord?.id }
    );
    if (realId) {
      if (existingWord) {
        window.words = window.words.map((word) => String(word.id) === String(existingWord.id)
          ? { ...word, hiddenFromDictionary: false, hiddenFromDictionaryAt: null }
          : word);
      } else {
        window.words.unshift({id:realId,word:text,meaning,example:example||'',category:'لعبة',starred:false,forgetCount:0,xpValue:xpGain});
      }
      persistDictionary();
      showToast(existingWord
        ? `تمت استعادة كلمة ”${text}“، وتقدمها السابق محفوظ.`
        : 'تمت الإضافة لقاموسك');
      recordGameDictionaryAdd();
      refreshAfterGameDictionaryAdd();
      if (btnEl) { btnEl.textContent='✓'; btnEl.classList.add('btn-already-added'); }
    } else {
      const nw={id:Date.now().toString(),word:text,meaning,example:example||'',category:'لعبة',starred:false,forgetCount:0,xpValue:xpGain};
      window.words.unshift(nw);
      persistDictionary();
      showToast('تمت الإضافة محلياً');
      recordGameDictionaryAdd();
      refreshAfterGameDictionaryAdd();
      if (btnEl) { btnEl.textContent='✓'; btnEl.classList.add('btn-already-added'); }
    }
  } else {
    const nw={id:Date.now().toString(),word:text,meaning,example:example||'',category:'لعبة',starred:false,forgetCount:0,xpValue:xpGain};
    window.words.unshift(nw);
    persistDictionary();
    showToast('تمت الإضافة للقاموس المحلي');
    recordGameDictionaryAdd();
    refreshAfterGameDictionaryAdd();
    if (btnEl) { btnEl.textContent='✓'; btnEl.classList.add('btn-already-added'); }
  }
};

// ═══════════════════════════════════════════════════════
// Render (القاموس الشخصي)
// ═══════════════════════════════════════════════════════
