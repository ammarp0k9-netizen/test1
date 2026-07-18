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
  saveTitleState(state);
  if (newly.length) requestProfileCloudSave();
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
  if (status) status.innerHTML = lockedXP > 0
    ? `<i class="fa-solid fa-lock" aria-hidden="true"></i> ${lockedXP} XP مقفولة`
    : (ready
      ? '<i class="fa-solid fa-box-open" aria-hidden="true"></i> الصندوق اليومي جاهز'
      : '<i class="fa-regular fa-clock" aria-hidden="true"></i> الصندوق يرجع بعد');
  if (count) {
    count.innerHTML = lockedXP > 0
      ? `الإتقان: ${(state.lockMasteredWordIds || []).length}/${CHEST_MASTERED_WORDS_REQUIRED} <button type="button" class="mastery-help-btn" onclick="showMasteryHelp(event)" aria-label="ما معنى إتقان الكلمة؟"><i class="fa-solid fa-question" aria-hidden="true"></i></button> | الاختبارات: ${(state.lockHighAccuracyQuizIds || []).length}/2`
      : (ready ? 'افتحه الآن' : formatLootTime(remaining));
  }
  if (preview) {
    preview.textContent = lockedXP > 0
      ? CHEST_XP_UNLOCK_TEXT
      : ready
      ? 'فيه XP عشوائي، ومعه فرصة نادرة لـ Streak Freeze. ثبّت ضغطتك وافتحه.'
      : `سلسلة صناديقك: ${state.streak || 0} يوم | Freeze عندك: ${getStreakFreezeCount()} | مجموع الفتحات: ${state.totalOpens || 0}`;
  }
  if (slots) {
    const rewards = state.rewards || [];
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

function renderTreasureRoom() {
  evaluateTitleUnlocks(false);
  renderLootSummary();
  renderTitlesGrid();
  clearInterval(window.__lootCountdownTimer);
  window.__lootCountdownTimer = setInterval(() => {
    if (currentView !== 'treasure') {
      clearInterval(window.__lootCountdownTimer);
      return;
    }
    renderLootSummary();
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
  wordPager: null,
  wordSnapshot: null,
  generation: 0,
  loading: false,
  error: null,
};

function getPublishedContentApi() {
  const api = window.LootLinguaPublishedContent;
  if (!api) {
    const error = new Error('Published content API is unavailable.');
    error.code = 'published/unavailable';
    throw error;
  }
  return api;
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
  publishedContentState.tab = published ? 'published' : 'custom';
  const publishedTab = document.getElementById('publishedWorldsTab');
  const customTab = document.getElementById('customWorldsTab');
  const publishedPanel = document.getElementById('publishedWorldsPanel');
  const customPanel = document.getElementById('customWorldsPanel');
  publishedTab?.classList.toggle('active', published);
  customTab?.classList.toggle('active', !published);
  publishedTab?.setAttribute('aria-selected', String(published));
  customTab?.setAttribute('aria-selected', String(!published));
  if (publishedPanel) publishedPanel.hidden = !published;
  if (customPanel) customPanel.hidden = published;
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
  const state = publishedElement('div', 'published-state');
  state.append(publishedIcon('fa-solid fa-circle-notch fa-spin'));
  state.append(publishedElement('strong', '', message || 'جارٍ تحميل المحتوى الجاهز...'));
  root.replaceChildren(state);
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

function appendPublishedVisual(card, item, fallbackIcon) {
  const visual = publishedElement('span', 'published-card-visual');
  const cover = String(item.cover || item.imageUrl || '').trim();
  const icon = String(item.icon || '').trim();
  if (cover) {
    const image = document.createElement('img');
    image.src = cover;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    visual.append(image);
  } else if (/^(fa-|fas |far |fab )/.test(icon)) {
    visual.append(publishedIcon(icon));
  } else if (icon) {
    visual.append(publishedElement('span', 'published-card-emoji', icon));
  } else {
    visual.append(publishedIcon(fallbackIcon));
  }
  card.append(visual);
}

function makePublishedHierarchyCard(kind, item, onClick) {
  const card = publishedElement('button', `published-card published-card-${kind}`);
  card.type = 'button';
  card.addEventListener('click', onClick);
  const fallbackIcons = {
    world: 'fa-solid fa-earth-americas',
    rank: 'fa-solid fa-ranking-star',
    gate: 'fa-solid fa-dungeon',
  };
  appendPublishedVisual(card, item, fallbackIcons[kind]);

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
  body.append(meta);
  card.append(body, publishedIcon('fa-solid fa-chevron-left published-card-chevron'));
  return card;
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
      if (index > 0) breadcrumbs.append(publishedElement('span', '', '←'));
      if (item.onClick) {
        breadcrumbs.append(publishedButton(item.label, 'published-breadcrumb-link', item.onClick));
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

function renderPublishedWorlds(items) {
  const root = publishedViewRoot();
  if (!root) return;
  const content = document.createDocumentFragment();
  if (!items.length) {
    content.append(renderPublishedEmpty(
      'لا توجد عوالم منشورة حاليًا.',
      'fa-solid fa-earth-americas'
    ));
  } else {
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

function renderPublishedRanks(world, ranks) {
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
      { label: 'العوالم الجاهزة', onClick: () => window.openPublishedWorldsRoot() },
      { label: world.title || 'العالم' },
    ],
  });
  if (!ranks.length) {
    section.append(renderPublishedEmpty('لا توجد رتب منشورة في هذا العالم.', 'fa-solid fa-ranking-star'));
  } else {
    const grid = publishedElement('div', 'published-card-grid');
    ranks.forEach((rank) => {
      grid.append(makePublishedHierarchyCard(
        'rank',
        rank,
        () => window.openPublishedRank(world.worldId, rank.rankId)
      ));
    });
    section.append(grid);
  }
  content.append(section);
  root.replaceChildren(content);
}

function renderPublishedGates(world, rank, gates) {
  const root = publishedViewRoot();
  if (!root) return;
  const section = publishedElement('section', 'published-route-view');
  appendPublishedHeader(section, {
    title: rank.title || 'الرتبة',
    description: rank.description || rank.subtitle || '',
    backLabel: 'العودة للرتب',
    back: () => window.openPublishedWorld(world.worldId),
    breadcrumbs: [
      { label: world.title || 'العالم', onClick: () => window.openPublishedWorld(world.worldId) },
      { label: rank.title || 'الرتبة' },
    ],
  });
  if (!gates.length) {
    section.append(renderPublishedEmpty('لا توجد بوابات منشورة في هذه الرتبة.', 'fa-solid fa-dungeon'));
  } else {
    const grid = publishedElement('div', 'published-card-grid');
    gates.forEach((gate) => {
      grid.append(makePublishedHierarchyCard(
        'gate',
        gate,
        () => window.openPublishedGate(world.worldId, rank.rankId, gate.gateId)
      ));
    });
    section.append(grid);
  }
  root.replaceChildren(section);
}

function makePublishedWordCard(word) {
  const card = publishedElement('article', 'published-word-card');
  const top = publishedElement('div', 'published-word-top');
  const identity = publishedElement('div', 'published-word-identity');
  identity.append(publishedElement('strong', 'published-word-text', word.word || ''));
  identity.append(publishedElement('span', 'published-word-translation', word.translation || ''));
  top.append(identity);
  const meta = publishedElement('div', 'published-word-meta');
  appendMetaChip(meta, word.partOfSpeech, 'fa-solid fa-font');
  appendMetaChip(meta, word.level, 'fa-solid fa-signal');
  appendMetaChip(meta, word.category, 'fa-solid fa-tag');
  top.append(meta);
  card.append(top);

  if (word.example) {
    card.append(publishedElement('p', 'published-word-example', word.example));
  }
  const detailValues = [
    ['التعريف', word.definition],
    ['التعريف بالعربية', word.definition_ar],
    ['ترجمة المثال', word.exampleTranslation],
    ['ملاحظات', word.notes],
  ].filter((item) => item[1]);
  if (detailValues.length) {
    const details = publishedElement('div', 'published-word-details');
    details.hidden = true;
    detailValues.forEach(([label, value]) => {
      const row = publishedElement('p', '');
      row.append(publishedElement('strong', '', `${label}: `));
      row.append(document.createTextNode(String(value)));
      details.append(row);
    });
    const toggle = publishedButton(
      'التفاصيل',
      'published-word-toggle',
      () => {
        details.hidden = !details.hidden;
        toggle.setAttribute('aria-expanded', String(!details.hidden));
        toggle.lastChild.textContent = details.hidden ? 'التفاصيل' : 'إخفاء التفاصيل';
      },
      'fa-solid fa-circle-info'
    );
    toggle.setAttribute('aria-expanded', 'false');
    card.append(toggle, details);
  }
  return card;
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
      { label: world.title || 'العالم', onClick: () => window.openPublishedWorld(world.worldId) },
      {
        label: rank.title || 'الرتبة',
        onClick: () => window.openPublishedRank(world.worldId, rank.rankId)
      },
      { label: gate.title || 'البوابة' },
    ],
  });

  const summary = publishedElement('div', 'published-word-summary');
  const pageNumber = Number(snapshot?.currentPageIndex ?? 0) + 1;
  summary.append(publishedElement('span', '', `الصفحة ${pageNumber}`));
  if (Number.isFinite(Number(gate.wordCount))) {
    summary.append(publishedElement('span', '', `${Number(gate.wordCount)} كلمة منشورة تقريبًا`));
  }
  section.append(summary);

  const page = snapshot?.currentPage;
  if (!page || !page.items.length) {
    section.append(renderPublishedEmpty('لا توجد كلمات منشورة في هذه البوابة.', 'fa-solid fa-language'));
  } else {
    const list = publishedElement('div', 'published-word-list');
    page.items.forEach((word) => list.append(makePublishedWordCard(word)));
    section.append(list);
  }

  if (page) {
    const controls = publishedElement('div', 'published-pagination');
    const previous = publishedButton(
      'السابق',
      'published-page-btn',
      () => loadPublishedWordPage('previous'),
      'fa-solid fa-chevron-right'
    );
    const next = publishedButton(
      'التالي',
      'published-page-btn',
      () => loadPublishedWordPage('next'),
      'fa-solid fa-chevron-left'
    );
    previous.disabled = !page.hasPrevious || snapshot.loading.previous;
    next.disabled = !page.hasNext || snapshot.loading.next;
    controls.append(previous, publishedElement('span', '', `صفحة ${pageNumber}`), next);
    section.append(controls);
  }
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
  if (!pager || publishedContentState.loading) return;
  const generation = publishedContentState.generation;
  publishedContentState.loading = true;
  try {
    const method = direction === 'previous' ? 'loadPreviousPage' : 'loadNextPage';
    const result = await pager[method]();
    if (generation !== publishedContentState.generation) return;
    publishedContentState.wordSnapshot = result;
    renderPublishedGateWords(
      publishedContentState.world,
      publishedContentState.rank,
      publishedContentState.gate,
      result
    );
  } catch (error) {
    if (generation !== publishedContentState.generation) return;
    logPublishedContentError('words-page', error);
    renderPublishedError('words', error, () => loadPublishedWordPage(direction));
  } finally {
    if (generation === publishedContentState.generation) publishedContentState.loading = false;
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
  publishedContentState.loading = true;
  renderPublishedLoading('جارٍ تحميل العوالم الجاهزة...');
  try {
    const items = await getPublishedContentApi().listPublishedWorlds({ force: settings.force });
    if (generation !== publishedContentState.generation) return;
    renderPublishedWorlds(items);
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
      const ranks = await api.listPublishedRanks(params.worldId, options);
      if (generation !== publishedContentState.generation) return;
      renderPublishedRanks(world, ranks);
      return;
    }
    const rank = await api.getPublishedRank(params.worldId, params.rankId);
    if (generation !== publishedContentState.generation) return;
    publishedContentState.rank = rank;
    if (key === 'rank') {
      const gates = await api.listPublishedGates(params.worldId, params.rankId, options);
      if (generation !== publishedContentState.generation) return;
      renderPublishedGates(world, rank, gates);
      return;
    }
    const gate = await api.getPublishedGate(params.worldId, params.rankId, params.gateId);
    if (generation !== publishedContentState.generation) return;
    publishedContentState.gate = gate;
    const pager = createPublishedWordPager(params.worldId, params.rankId, params.gateId);
    publishedContentState.wordPager = pager;
    const snapshot = await pager.loadInitialPage();
    if (generation !== publishedContentState.generation) return;
    publishedContentState.wordSnapshot = snapshot;
    renderPublishedGateWords(world, rank, gate, snapshot);
  } catch (error) {
    if (generation !== publishedContentState.generation) return;
    logPublishedContentError(key, error);
    renderPublishedError(level, error, () => loadPublishedRouteData(route, { force: true }));
  } finally {
    if (generation === publishedContentState.generation) publishedContentState.loading = false;
  }
}

window.loadPublishedContentRoute = function(route) {
  prepareWorldsShell();
  setPublishedTabState('published');
  setPublishedTabsVisible(false);
  window.scrollTo({ top: 0, behavior: 'auto' });
  loadPublishedRouteData(route);
};

window.openPublishedWorldsRoot = function() {
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
  if (nameInput) nameInput.value = world?.name || '';
  if (descInput) descInput.value = world?.description || '';
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
        const realId = await window.saveWordToCloud(word.word, word.category || 'عام', word.meaning || '', word.example || '', word.order ?? 0, word);
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
  let starred = window.words.filter(w => w.starred);

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
  // تحقق من التكرار
  if (wordExists(text)) {
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
    const realId = await window.saveWordToCloud(text, 'لعبة', meaning, example||'');
    if (realId) {
      window.words.unshift({id:realId,word:text,meaning,example:example||'',category:'لعبة',starred:false,forgetCount:0,xpValue:xpGain});
      persistDictionary();
      showToast('تمت الإضافة لقاموسك');
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
