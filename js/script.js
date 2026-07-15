let currentFilter    = 'all';
let editId           = null;
let isReorderMode    = false;
let selectedIndices  = [];
let dictionarySortMode = 'auto';
let dictionarySortCategory = 'all';
const WORD_CATEGORY_OPTIONS = [
  { value: 'عام', label: 'عام' },
  { value: 'فعل', label: 'فعل' },
  { value: 'اسم', label: 'اسم' },
  { value: 'صفة', label: 'صفة' },
  { value: 'أداة', label: 'أداة' },
  { value: 'ظرف', label: 'ظرف' },
  { value: 'جمل', label: 'جمل شائعة' },
];
const CATEGORY_SORT_ORDER = ['عام', 'اسم', 'فعل', 'صفة', 'أداة', 'ظرف', 'جمل', 'لعبة'];
const SEARCH_FILTER_LABELS = {
  all: 'بحث في الكل',
  word: 'الكلمة فقط',
  meaning: 'المعنى فقط',
  example: 'الجملة فقط',
};
let _wordOrderSyncTimer = null;

function getDictSortStorageKey() {
  return 'lootlinguaDictSort_' + getStorageUserId() + '_' + getActiveDictionaryStorageScope();
}

function loadDictionarySortPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(getDictSortStorageKey()) || '{}');
    const validModes = ['auto', 'newest', 'oldest', 'alpha', 'category'];
    if (validModes.includes(saved.mode)) dictionarySortMode = saved.mode;
    if (saved.category) dictionarySortCategory = String(saved.category);
  } catch {}
  if (document.body) {
    syncDictionarySortUI();
    syncAppDropdownLabels();
  }
}

function saveDictionarySortPrefs() {
  localStorage.setItem(getDictSortStorageKey(), JSON.stringify({
    mode: dictionarySortMode,
    category: dictionarySortCategory,
  }));
}

function reindexWordOrder(words = window.words) {
  if (!Array.isArray(words)) return [];
  words.forEach((word, index) => { word.order = index; });
  return words;
}

function applyStoredWordOrder(words) {
  const arr = Array.isArray(words) ? [...words] : [];
  if (!arr.length) return arr;
  if (arr.some((word) => Number.isFinite(word?.order))) {
    arr.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
    return reindexWordOrder(arr);
  }
  return reindexWordOrder(arr);
}

function scheduleWordOrderCloudSync() {
  clearTimeout(_wordOrderSyncTimer);
  _wordOrderSyncTimer = setTimeout(() => {
    syncWordOrdersToCloud().catch(() => {});
  }, 450);
}

async function syncWordOrdersToCloud() {
  const user = window.auth?.currentUser;
  if (!user || !Array.isArray(window.words)) return;
  if (isCustomWorldView()) {
    if (!window.updateCustomWorldWordInCloud) return;
    await Promise.all(
      window.words.map((word, index) => window.updateCustomWorldWordInCloud(activeCustomWorldId, word.id, { order: index }))
    );
    return;
  }
  if (!window.updateWordInCloud) return;
  await Promise.all(
    window.words.map((word, index) => window.updateWordInCloud(word.id, { order: index }))
  );
}

function closeAppDropdowns(exceptWrap = null) {
  document.querySelectorAll('.app-dropdown-menu.open').forEach((menu) => {
    const wrap = menu.closest('.app-dropdown-wrap');
    if (exceptWrap && wrap === exceptWrap) return;
    menu.classList.remove('open');
    wrap?.querySelector('.app-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
    wrap?.querySelector('.app-dropdown-trigger-icon')?.setAttribute('aria-expanded', 'false');
  });
}

function syncAppDropdownLabels() {
  const searchFilter = document.getElementById('searchFilter');
  const searchBtn = document.getElementById('searchFilterBtn');
  if (searchFilter && searchBtn) {
    const label = SEARCH_FILTER_LABELS[searchFilter.value] || SEARCH_FILTER_LABELS.all;
    searchBtn.setAttribute('aria-label', `إعدادات البحث: ${label}`);
    searchBtn.removeAttribute('title');
    searchBtn.dataset.tip = 'إعدادات البحث';
  }
  const categoryInput = document.getElementById('categoryInput');
  const categoryBtn = document.getElementById('categoryDropdownBtn');
  if (categoryInput && categoryBtn) {
    const option = WORD_CATEGORY_OPTIONS.find((item) => item.value === categoryInput.value);
    categoryBtn.textContent = option?.label || categoryInput.value || 'عام';
  }
}

function setSearchFilterValue(value) {
  const input = document.getElementById('searchFilter');
  const menu = document.getElementById('searchFilterMenu');
  if (!input) return;
  input.value = value;
  menu?.querySelectorAll('[data-value]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
  syncAppDropdownLabels();
  renderLimit = 20;
  render();
}

function setCategoryDropdownValue(value) {
  const input = document.getElementById('categoryInput');
  const menu = document.getElementById('categoryDropdownMenu');
  if (!input) return;
  input.value = value;
  menu?.querySelectorAll('[data-value]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
  syncAppDropdownLabels();
  if (typeof window.saveActiveAddFormDraft === 'function') window.saveActiveAddFormDraft();
}

function initAppDropdowns() {
  initSearchFilterDropdown();
  initCategoryDropdown();

  document.querySelectorAll('.app-dropdown-wrap').forEach((wrap) => {
    if (wrap.dataset.dropdownReady === '1') return;
    if (wrap.id === 'searchFilterWrap' || wrap.id === 'categoryDropdownWrap') return;
    const trigger = wrap.querySelector('.app-dropdown-trigger');
    const menu = wrap.querySelector('.app-dropdown-menu');
    if (!trigger || !menu) return;
    wrap.dataset.dropdownReady = '1';
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = !menu.classList.contains('open');
      closeAppDropdowns(wrap);
      menu.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  });
}

function initSearchFilterDropdown() {
  const searchWrap = document.getElementById('searchFilterWrap');
  const searchTrigger = document.getElementById('searchFilterBtn');
  const searchMenu = document.getElementById('searchFilterMenu');
  if (!searchWrap || !searchTrigger || !searchMenu || searchWrap.dataset.dropdownReady === '1') return;
  searchWrap.dataset.dropdownReady = '1';
  searchTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = !searchMenu.classList.contains('open');
    closeAppDropdowns(searchWrap);
    searchMenu.classList.toggle('open', willOpen);
    searchTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  searchMenu.querySelectorAll('[data-value]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      setSearchFilterValue(btn.dataset.value || 'all');
      searchMenu.classList.remove('open');
      searchTrigger.setAttribute('aria-expanded', 'false');
    });
  });
}

function initCategoryDropdown() {
  const categoryWrap = document.getElementById('categoryDropdownWrap');
  const categoryTrigger = document.getElementById('categoryDropdownBtn');
  const categoryMenu = document.getElementById('categoryDropdownMenu');
  if (!categoryWrap || !categoryTrigger || !categoryMenu || categoryWrap.dataset.dropdownReady === '1') return;
  categoryWrap.dataset.dropdownReady = '1';
  categoryTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = !categoryMenu.classList.contains('open');
    closeAppDropdowns(categoryWrap);
    categoryMenu.classList.toggle('open', willOpen);
    categoryTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  categoryMenu.querySelectorAll('[data-value]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      setCategoryDropdownValue(btn.dataset.value || 'عام');
      categoryMenu.classList.remove('open');
      categoryTrigger.setAttribute('aria-expanded', 'false');
    });
  });
}

window.toggleSortCategorySubmenu = function(event) {
  event?.preventDefault();
  event?.stopPropagation();
  document.querySelector('.sort-submenu-wrap')?.classList.toggle('open');
};
let isBulkDeleteMode = false;
let bulkSelectedWordIds = new Set();
let suppressDeleteClickOnce = false;
let currentQuizWords = [];
let quizIndex        = 0;
let currentStreak    = 0;
let pendingDeleteId  = null;
let userXP           = parseInt(localStorage.getItem('userXP')) || 0;
let dailyStreak      = loadInt('dailyStreak', 0);
let lastActivity     = localStorage.getItem('lastActivityDate') || '';
let currentView      = 'personal'; // 'personal' | 'customWorld' | 'worlds' | 'minecraft' | 'pubg' | 'starred' | 'quiz' | 'treasure'
let customWorlds     = readCustomWorldsFromStorage();
let activeCustomWorldId = null;
let pendingCustomWorldModalMode = 'create';
let pendingCustomWorldEditId = null;
let pendingWorldManageAction = 'move';
let pendingWorldManageCreateAction = null;
let pendingDeleteWorldId = null;
let renderLimit      = 20;  // عدد الكلمات التي تظهر في البداية
const WORD_RENDER_FAST_MODE = true;
const WORD_DOM_WINDOW_SIZE = 48;
const WORD_DOM_BUFFER = 8;
const WORD_DOM_EDGE_BUFFER = 8;
const WORD_RENDER_TRANSITION_MS = 48;
const WORD_RENDER_SCROLL_THROTTLE_MS = 120;
let wordVirtualState = {
  key: '',
  start: 0,
  end: 0,
  rowHeight: 126,
  listTop: 0,
  lastHtmlKey: '',
  total: 0,
  isTransitioning: false,
  transitionTargetY: null,
  transitionPinnedY: null,
  transitionTimer: null,
  loadingTimer: null,
  programmaticScroll: false
};
let currentQuizMistakes = 0;
let isInitialLoad = true;
window.isInitialLoad = true;
window.__initialFeatureLoadPending = new Set();
window.__suppressUnlockNotices = true;
window.beginInitialFeatureLoad = function(parts = []) {
  isInitialLoad = true;
  window.isInitialLoad = true;
  window.__suppressUnlockNotices = true;
  window.__initialFeatureLoadPending = new Set(Array.isArray(parts) ? parts : []);
};
window.finishInitialFeatureLoad = function() {
  isInitialLoad = false;
  window.isInitialLoad = false;
  window.__suppressUnlockNotices = false;
  window.__initialFeatureLoadPending?.clear?.();
  if (typeof tryStartEmptyOnboarding === 'function') tryStartEmptyOnboarding();
};
window.markInitialFeatureLoadPartDone = function(part) {
  if (part && window.__initialFeatureLoadPending instanceof Set) {
    window.__initialFeatureLoadPending.delete(part);
  }
  if (!(window.__initialFeatureLoadPending instanceof Set) || window.__initialFeatureLoadPending.size === 0) {
    setTimeout(() => {
      if (!(window.__initialFeatureLoadPending instanceof Set) || window.__initialFeatureLoadPending.size === 0) {
        window.finishInitialFeatureLoad();
      }
    }, 250);
  }
};

function shouldSuppressUnlockNotices() {
  return isInitialLoad === true || window.__suppressUnlockNotices === true || window.__applyingCloudProfile === true;
}

function safeVibrate(duration = 80) {
  try {
    if (navigator?.vibrate) navigator.vibrate(duration);
  } catch {}
}

function triggerShakeEffect(target, duration = 320) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return;
  el.classList.remove('shake-effect');
  void el.offsetWidth;
  el.classList.add('shake-effect');
  setTimeout(() => el.classList.remove('shake-effect'), duration);
}

function triggerAttentionFeedback(target, duration = 280) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (el) {
    el.classList.remove('attention-shake-effect');
    void el.offsetWidth;
    el.classList.add('attention-shake-effect');
    setTimeout(() => el.classList.remove('attention-shake-effect'), duration);
  }
  safeVibrate([35, 25, 35]);
}

function cssEscapeValue(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function getWordSortStamp(word) {
  const created = word?.createdAt || word?.timestamp || word?.addedAt;
  if (created?.toMillis) return created.toMillis();
  const parsed = Date.parse(created || '');
  if (Number.isFinite(parsed)) return parsed;
  const numericId = parseInt(word?.id, 10);
  return Number.isFinite(numericId) ? numericId : 0;
}

function sortDictionaryWords(wordsToSort) {
  const sorted = [...wordsToSort];
  if (dictionarySortMode === 'auto') {
    if (sorted.some((word) => Number.isFinite(word?.order))) {
      sorted.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
    }
    return sorted;
  }
  if (dictionarySortMode === 'oldest') {
    sorted.sort((a, b) => getWordSortStamp(a) - getWordSortStamp(b));
  } else if (dictionarySortMode === 'alpha') {
    sorted.sort((a, b) => String(a.word || '').localeCompare(String(b.word || ''), undefined, { sensitivity: 'base' }));
  } else if (dictionarySortMode === 'newest') {
    sorted.sort((a, b) => getWordSortStamp(b) - getWordSortStamp(a));
  } else if (dictionarySortMode === 'category') {
    sorted.sort((a, b) => {
      const catA = a.category || 'عام';
      const catB = b.category || 'عام';
      if (dictionarySortCategory && dictionarySortCategory !== 'all') {
        const priA = catA === dictionarySortCategory ? 0 : 1;
        const priB = catB === dictionarySortCategory ? 0 : 1;
        if (priA !== priB) return priA - priB;
      } else {
        const idxA = CATEGORY_SORT_ORDER.indexOf(catA);
        const idxB = CATEGORY_SORT_ORDER.indexOf(catB);
        const orderA = idxA === -1 ? CATEGORY_SORT_ORDER.length : idxA;
        const orderB = idxB === -1 ? CATEGORY_SORT_ORDER.length : idxB;
        if (orderA !== orderB) return orderA - orderB;
      }
      return String(a.word || '').localeCompare(String(b.word || ''), undefined, { sensitivity: 'base' });
    });
  }
  return sorted;
}

function syncDictionarySortUI() {
  const btn = document.getElementById('dictionarySortBtn');
  const menu = document.getElementById('dictionarySortMenu');
  if (btn) btn.setAttribute('aria-expanded', String(menu?.classList.contains('open') || false));
  menu?.querySelectorAll('[data-sort-mode]').forEach((item) => {
    const mode = item.dataset.sortMode;
    const category = item.dataset.sortCategory;
    let active = false;
    if (mode === 'category') {
      active = dictionarySortMode === 'category' &&
        (category ? category === dictionarySortCategory : false);
    } else {
      active = dictionarySortMode === mode;
    }
    item.classList.toggle('active', active);
  });
  document.querySelector('.sort-submenu-wrap')?.classList.toggle('open', dictionarySortMode === 'category');
}

window.toggleDictionarySortMenu = function() {
  const menu = document.getElementById('dictionarySortMenu');
  if (!menu) return;
  const willOpen = !menu.classList.contains('open');
  closeAppDropdowns(document.querySelector('.sort-dropdown-wrap'));
  menu.classList.toggle('open', willOpen);
  syncDictionarySortUI();
};

window.setDictionarySortMode = function(mode, category) {
  const validModes = ['auto', 'newest', 'oldest', 'alpha', 'category'];
  dictionarySortMode = validModes.includes(mode) ? mode : 'auto';
  if (mode === 'category') {
    dictionarySortCategory = category || 'all';
  } else {
    dictionarySortCategory = 'all';
  }
  window.words = sortDictionaryWords(window.words);
  saveDictionarySortPrefs();
  if (dictionarySortMode === 'auto') {
    persistDictionary();
  }
  document.getElementById('dictionarySortMenu')?.classList.remove('open');
  document.querySelector('.sort-submenu-wrap')?.classList.toggle('open', dictionarySortMode === 'category');
  renderLimit = 20;
  render();
  syncDictionarySortUI();
};

document.addEventListener('click', (event) => {
  if (!event.target.closest('.sort-dropdown-wrap') && !event.target.closest('.app-dropdown-wrap')) {
    closeAppDropdowns();
    document.getElementById('dictionarySortMenu')?.classList.remove('open');
    syncDictionarySortUI();
  }
});

window.words = applyStoredWordOrder(readWordsFromStorage('normal'));
loadDictionarySortPrefs();
if (dictionarySortMode !== 'auto') {
  window.words = sortDictionaryWords(window.words);
}

window.startVoiceSearch = function() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('voiceSearchBtn');
  if (!Recognition || !input) {
    showToast('البحث الصوتي غير مدعوم في هذا المتصفح.');
    return;
  }
  if (window.__activeVoiceRecognition) {
    try { window.__activeVoiceRecognition.abort(); } catch (_) {}
    window.__activeVoiceRecognition = null;
  }
  const recognition = new Recognition();
  window.__activeVoiceRecognition = recognition;
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 5;
  btn?.classList.add('is-listening');
  safeVibrate(35);
  recognition.onresult = (event) => {
    const result = event.results?.[0];
    if (!result) return;
    let bestText = '';
    let bestScore = -1;
    for (let i = 0; i < result.length; i++) {
      const candidate = normalizeVoiceTranscript(result[i].transcript);
      if (!candidate) continue;
      const score = scoreVoiceSearchCandidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestText = pickBestVoiceQuery(result[i].transcript);
      }
    }
    if (!bestText) return;
    input.value = bestText;
    renderLimit = 20;
    render();
    showToast(`سمّعنا: ${bestText}`, 'success', 1800);
  };
  recognition.onerror = (event) => {
    if (event?.error === 'aborted') return;
    showToast('تعذر التقاط الصوت. جرّب مرة ثانية.');
  };
  recognition.onend = () => {
    btn?.classList.remove('is-listening');
    if (window.__activeVoiceRecognition === recognition) window.__activeVoiceRecognition = null;
  };
  try {
    recognition.start();
  } catch (_) {
    btn?.classList.remove('is-listening');
    showToast('تعذر تشغيل الميكروفون. جرّب مرة ثانية.');
  }
};

function normalizeVoiceTranscript(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, '')
    .replace(/\s+/g, ' ');
}

function scoreVoiceSearchCandidate(normalized) {
  if (!normalized) return -1;
  let score = normalized.length;
  const dictWords = Array.isArray(window.words) ? window.words : [];
  dictWords.forEach((entry) => {
    const word = normalizeVoiceTranscript(entry.word);
    if (!word) return;
    if (word === normalized) score += 120;
    else if (word.startsWith(normalized) || normalized.startsWith(word)) score += 60;
  });
  return score;
}

function pickBestVoiceQuery(rawText) {
  const normalized = normalizeVoiceTranscript(rawText);
  if (!normalized) return '';
  const dictWords = Array.isArray(window.words) ? window.words : [];
  const exact = dictWords.find((entry) => normalizeVoiceTranscript(entry.word) === normalized);
  if (exact?.word) return exact.word.trim();
  const partial = dictWords.find((entry) => {
    const word = normalizeVoiceTranscript(entry.word);
    return word.startsWith(normalized) || normalized.startsWith(word);
  });
  if (partial?.word) return partial.word.trim();
  return normalized;
}

function updateBulkDeleteBar() {
  const legacyBar = document.getElementById('bulkDeleteBar');
  const bar = document.getElementById('selectionActionBar');
  const reorderBtn = document.getElementById('selectionReorderBtn');
  const count = bulkSelectedWordIds.size;
  if (legacyBar) legacyBar.hidden = true;
  if (bar) {
    bar.hidden = !isBulkDeleteMode;
    bar.dataset.count = String(count);
  }
  if (reorderBtn) reorderBtn.textContent = isReorderMode ? 'حفظ الترتيب' : 'ترتيب يدوي';
  document.querySelectorAll('.selection-reorder-step').forEach(btn => {
    btn.hidden = !isBulkDeleteMode || !isReorderMode;
  });
  document.body.classList.toggle('selection-mode-active', isBulkDeleteMode);
  const searchBar = document.querySelector('.search-bar-row');
  if (searchBar) searchBar.style.display = isBulkDeleteMode ? 'none' : (isEditableDictionaryView() ? '' : 'none');
  const personalControls = document.getElementById('personalControls');
  if (personalControls && isEditableDictionaryView()) {
    personalControls.classList.toggle('selection-hidden', isBulkDeleteMode);
  }
}

function syncBulkSelectionInDom(id) {
  const cards = id
    ? [document.querySelector(`.word-card[data-id="${cssEscapeValue(String(id))}"]`)].filter(Boolean)
    : [...document.querySelectorAll('.word-card')];
  cards.forEach((card) => {
    const cardId = card.dataset.id;
    if (!cardId) return;
    const selected = bulkSelectedWordIds.has(String(cardId));
    card.classList.toggle('bulk-selected', selected);
    const state = card.querySelector('.selection-state');
    if (state) state.textContent = selected ? 'محدد' : 'تحديد';
  });
  updateBulkDeleteBar();
}

function clearBulkSelectionInDom() {
  document.querySelectorAll('.word-card.bulk-selected').forEach((card) => {
    card.classList.remove('bulk-selected');
  });
  document.querySelectorAll('.word-card.selected-for-move').forEach((card) => {
    card.classList.remove('selected-for-move');
  });
  updateBulkDeleteBar();
}

function enterBulkDeleteMode(id) {
  if (!id) return;
  if (isReorderMode) toggleReorderMode();
  isBulkDeleteMode = true;
  bulkSelectedWordIds.add(String(id));
  syncSelectedIndicesFromBulkSelection();
  safeVibrate(50);
  syncBulkSelectionInDom(id);
}

window.enterSelectionMode = function(id) {
  if (!isEditableDictionaryView()) return;
  const firstId = id ||
    document.querySelector('#list .word-card[data-id]')?.dataset.id ||
    getActiveDictionaryWords()[0]?.id;
  if (!firstId) {
    showToast('ما في كلمات لتحديدها');
    return;
  }
  enterBulkDeleteMode(firstId);
  render();
};

window.exitBulkDeleteMode = function() {
  if (isReorderMode) isReorderMode = false;
  isBulkDeleteMode = false;
  bulkSelectedWordIds.clear();
  selectedIndices = [];
  document.body.classList.remove('selection-mode-active');
  clearBulkSelectionInDom();
  render();
};

window.exitSelectionMode = window.exitBulkDeleteMode;

function toggleBulkWordSelection(id) {
  if (!id) return;
  const key = String(id);
  if (bulkSelectedWordIds.has(key)) bulkSelectedWordIds.delete(key);
  else bulkSelectedWordIds.add(key);
  if (!bulkSelectedWordIds.size) {
    window.exitBulkDeleteMode();
    return;
  }
  syncBulkSelectionInDom(key);
  syncSelectedIndicesFromBulkSelection();
}

function syncSelectedIndicesFromBulkSelection() {
  selectedIndices = window.words
    .map((word, index) => bulkSelectedWordIds.has(String(word.id)) ? index : -1)
    .filter(index => index >= 0);
}

// ── MOBILE LONG-PRESS TOOLTIP (تفويض — يعمل مع الكروت المُعاد رسمها) ──
(function initTouchTooltips() {
  const coarse = window.matchMedia('(pointer: coarse)');
  if (!coarse.matches) return;

  const LONG_MS = 520;
  const SKIP_SEL = '.sidebar-legacy-hidden, .legend-top-bar, .legend-dock, .notif-hub, .sound-btn, .edit-btn, .del-btn, .btn-audio, .btn-edit, .btn-delete';
  let pressTimer = null;
  let activeTipEl = null;
  let activeTooltipText = null;

  function clearTip() {
    if (activeTipEl) {
      activeTipEl.classList.remove('tip-show');
      activeTipEl = null;
    }
    if (activeTooltipText) {
      activeTooltipText.classList.remove('show');
      activeTooltipText = null;
    }
  }

  document.addEventListener('touchstart', (e) => {
    if (e.target.closest(SKIP_SEL)) return;
    const wrap = e.target.closest('.tooltip-wrap');
    const tipEl = e.target.closest('[data-tip]');
    if (!wrap && !tipEl) return;
    if ((tipEl || wrap)?.closest('.sidebar-legacy-hidden, .legend-top-bar, .legend-dock, .notif-hub')) return;

    clearTimeout(pressTimer);
    const target = tipEl || wrap;
    pressTimer = setTimeout(() => {
      clearTip();
      if (wrap) {
        activeTooltipText = wrap.querySelector('.tooltip-text');
        if (activeTooltipText) activeTooltipText.classList.add('show');
      } else if (tipEl) {
        activeTipEl = tipEl;
        tipEl.classList.add('tip-show');
      }
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
    }, LONG_MS);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
    setTimeout(clearTip, 140);
  }, { passive: true });
  document.addEventListener('touchcancel', () => {
    clearTimeout(pressTimer);
    clearTip();
  }, { passive: true });
  document.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });
})();

// ── تسميات الـ dock: ضغط مطوّل فقط على اللمس ──
(function initDockLongPressLabels() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const HOLD_MS = 520;
  let dockTimer = null;
  let dockTipBtn = null;

  function clearDockTip() {
    if (dockTipBtn) {
      dockTipBtn.classList.remove('dock-tip-show');
      dockTipBtn = null;
    }
  }

  document.addEventListener('touchstart', (e) => {
    const btn = e.target.closest('.treasure-dock-btn');
    if (!btn) return;
    clearTimeout(dockTimer);
    dockTimer = setTimeout(() => {
      clearDockTip();
      dockTipBtn = btn;
      btn.classList.add('dock-tip-show');
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
    }, HOLD_MS);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    clearTimeout(dockTimer);
    setTimeout(clearDockTip, 160);
  }, { passive: true });
  document.addEventListener('touchcancel', () => {
    clearTimeout(dockTimer);
    clearDockTip();
  }, { passive: true });
  document.addEventListener('touchmove', () => clearTimeout(dockTimer), { passive: true });
})();

// Global variables for scroll lock during onboarding
let mainContentScrollArea = null;
let originalMainContentScrollAreaOverflow = '';

function setActiveNavLink(key) {
  // key: 'personal' | 'minecraft' | 'pubg'
  document.querySelectorAll('.nav-link[data-view]').forEach(l => {
    l.classList.toggle('active', l.dataset.view === key);
  });
}

// ═══════════════════════════════════════════════════════
// Feature unlocks — UI sync (rules: optional window.getUnlockedFeatures / window.unlockedFeatures)
// ═══════════════════════════════════════════════════════

function getUnlockProgressSnapshot() {
  const words = getPersonalDictionaryWordsSnapshot();
  return {
    wordCount: words.length,
    starredCount: words.filter(w => w.starred).length,
    userXP: loadInt('userXP', 0),
    userLevel: getLevelFromXP(loadInt('userXP', 0)),
    dailyStreak: loadInt('dailyStreak', 0),
    dailyAdded: typeof getDailyCount === 'function' ? getDailyCount() : 0,
  };
}

/** Default gates if host page does not define `getUnlockedFeatures` or `unlockedFeatures`. */
function computeDefaultUnlockedFeatures() {
  const p = getUnlockProgressSnapshot();
  const u = new Set(['personal', 'stats']);
  if (p.wordCount >= 1) {
    u.add('starred');
    u.add('treasure');
  }
  if (p.wordCount >= 2 || p.userXP >= 10) u.add('minecraft');
  if (p.wordCount >= 2 || p.userXP >= 10) u.add('pubg');
  if (p.wordCount >= 5) u.add('quiz');
  return u;
}

function resolveUnlockedFeatures() {
  if (typeof window.getUnlockedFeatures === 'function') {
    const r = window.getUnlockedFeatures();
    if (r instanceof Set) return r;
    if (Array.isArray(r)) return new Set(r);
  }
  if (window.unlockedFeatures instanceof Set) return window.unlockedFeatures;
  if (Array.isArray(window.unlockedFeatures)) return new Set(window.unlockedFeatures);
  return computeDefaultUnlockedFeatures();
}

function isFeatureUnlocked(featureId) {
  return resolveUnlockedFeatures().has(featureId);
}

const UNLOCK_EXPLAIN = {
  personal: {
    title: 'قاموسك الشخصي',
    why: 'هذه البداية الأساسية — متاحة دائماً.',
    how: 'لا يوجد شرط.',
    progress: () => '',
  },
  stats: {
    title: 'إحصائياتي',
    why: 'لوحة الإحصائيات متاحة لمتابعة تقدّمك.',
    how: 'لا يوجد شرط.',
    progress: () => '',
  },
  starred: {
    title: 'الكلمات الصعبة',
    why: 'نفعّل قائمة الكلمات الصعبة بعد ما يصير عندك كلمات تقدر تعلّم عليها نجمة.',
    how: 'أضف كلمة واحدة على الأقل إلى قاموسك.',
    progress: (p) => {
      const need = 1;
      const n = p.wordCount;
      return n >= need ? `تقدّمك: ${n} كلمة (تم استيفاء الشرط).` : `تقدّمك: ${n} من ${need} كلمة في القاموس.`;
    },
  },
  minecraft: {
    title: 'قاموس Minecraft',
    why: 'قاموس اللعبة يفتح بسرعة بعد شوية كلمات جديدة.',
    how: 'أضف 2 كلمة فقط إلى قاموسك.',
    progress: (p) => {
      const ok = p.wordCount >= 2 || p.userXP >= 10;
      return ok
        ? `تقدّمك: ${p.wordCount} كلمة، ${p.userXP} XP (تم استيفاء الشرط).`
        : `تقدّمك: ${p.wordCount} من 2 كلمات، و${p.userXP} من 10 XP.`;
    },
  },
  pubg: {
    title: 'مصطلحات PUBG',
    why: 'قاموس PUBG يفتح بسرعة بعد شوية كلمات جديدة.',
    how: 'أضف 2 كلمة فقط إلى قاموسك.',
    progress: (p) => {
      const ok = p.wordCount >= 2 || p.userXP >= 10;
      return ok
        ? `تقدّمك: ${p.wordCount} كلمة، ${p.userXP} XP (تم استيفاء الشرط).`
        : `تقدّمك: ${p.wordCount} من 2 كلمات، و${p.userXP} من 10 XP.`;
    },
  },
  quiz: {
    title: 'الاختبار',
    why: 'الاختبار يحتاج مجموعة كلمات كافية عشان يكون مفيد.',
    how: 'أضف 5 كلمات على الأقل إلى قاموسك.',
    progress: (p) => {
      const need = 5;
      return p.wordCount >= need
        ? `تقدّمك: ${p.wordCount} كلمة (تم استيفاء الشرط).`
        : `تقدّمك: ${p.wordCount} من ${need} كلمات في القاموس.`;
    },
  },
  treasure: {
    title: 'صندوق المكافآت',
    why: 'صندوق المكافآت يفتح بعد ما تضيف أول كلمة لقاموسك.',
    how: 'ابحث عن كلمة وأضفها لقاموسك الشخصي.',
    progress: (p) => {
      const need = 1;
      return p.wordCount >= need
        ? `تقدّمك: ${p.wordCount} كلمة (تم استيفاء الشرط).`
        : `تقدّمك: ${p.wordCount} من ${need} كلمة في القاموس.`;
    },
  },
};

function openUnlockExplainModal(featureId) {
  const meta = UNLOCK_EXPLAIN[featureId] || {
    title: 'ميزة مقفلة',
    why: 'هذه الميزة غير متاحة حالياً.',
    how: 'تابع التعلّم وإضافة الكلمات لفتح المزيد.',
    progress: (p) => `XP: ${p.userXP} — كلمات القاموس: ${p.wordCount}`,
  };
  const snap = getUnlockProgressSnapshot();
  const tTitle = document.getElementById('unlockExplainTitle');
  const tWhy = document.getElementById('unlockExplainWhy');
  const tHow = document.getElementById('unlockExplainHow');
  const tPr = document.getElementById('unlockExplainProgress');
  if (tTitle) tTitle.textContent = meta.title;
  if (tWhy) tWhy.textContent = meta.why;
  if (tHow) tHow.textContent = meta.how;
  if (tPr) tPr.textContent = typeof meta.progress === 'function' ? meta.progress(snap) : (meta.progress || '');
  showModal('unlockExplainModal');
}

function handleLockedFeatureClick(featureId, fn, options = {}) {
  if (!isFeatureUnlocked(featureId)) {
    openUnlockExplainModal(featureId);
    return false;
  }
  if (options.closeSidebar && featureId !== 'personal') {
    if (typeof closeSidebarIfOpen === 'function') closeSidebarIfOpen();
  }
  if (typeof fn === 'function') fn();
  return true;
}

window.onSidebarFeatureClick = function(ev, featureId, fn) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  handleLockedFeatureClick(featureId, fn, { closeSidebar: true });
  return false;
};

window.onWorldCardClick = function(ev, featureId, fn) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  handleLockedFeatureClick(featureId, fn);
  return false;
};

window.onDockFeatureClick = function(ev, featureId, fn) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  handleLockedFeatureClick(featureId, fn);
  return false;
};

function triggerUnlockPulseOnLink(link) {
  if (!link) return;
  link.classList.remove('unlock-pulse');
  void link.offsetWidth;
  const finish = () => {
    link.classList.remove('unlock-pulse');
  };
  const onEnd = (e) => {
    if (e.animationName !== 'unlockPulse') return;
    link.removeEventListener('animationend', onEnd);
    finish();
  };
  link.addEventListener('animationend', onEnd);
  link.classList.add('unlock-pulse');
  setTimeout(() => {
    link.removeEventListener('animationend', onEnd);
    finish();
  }, 520);
}

function playUnlockSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 520;
    osc.connect(gain);
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.onended = () => { ctx.close().catch(() => {}); };
  } catch (e) {
    // Autoplay or audio failure is okay; fail silently.
  }
}

function playQuizCompletionSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
    gain.connect(ctx.destination);
    [440, 660, 880].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.09);
      osc.connect(gain);
      osc.start(ctx.currentTime + index * 0.09);
      osc.stop(ctx.currentTime + index * 0.09 + 0.16);
      if (index === 2) osc.onended = () => ctx.close().catch(() => {});
    });
  } catch (e) {
    // Audio is optional; browsers may block it in some contexts.
  }
}

function syncNavLockUi() {
  const unlocked = resolveUnlockedFeatures();
  const currentLocks = {};
  document.querySelectorAll('.nav-link[data-feature]').forEach((link) => {
    const id = link.getAttribute('data-feature');
    if (id) currentLocks[id] = !unlocked.has(id);
  });

  const prev = window.__navLockPrev;
  const pulseIds = [];
  const suppressUnlockNotice = shouldSuppressUnlockNotices();
  if (!suppressUnlockNotice && window.__navLockAnimSeeded && prev) {
    for (const id of Object.keys(currentLocks)) {
      if (prev[id] === true && currentLocks[id] === false) pulseIds.push(id);
    }
  }
  if (!window.__navLockAnimSeeded) window.__navLockAnimSeeded = true;

  document.querySelectorAll('.nav-link[data-feature]').forEach((link) => {
    const id = link.getAttribute('data-feature');
    if (!id) return;
    const locked = !unlocked.has(id);
    link.classList.toggle('feature-locked', locked);
    link.setAttribute('aria-disabled', locked ? 'true' : 'false');
    let badge = link.querySelector('.feature-lock-badge');
    if (locked) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'feature-lock-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.innerHTML = '<i class="fa-solid fa-lock"></i>';
        link.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  });

  for (const id of pulseIds) {
    document.querySelectorAll('.nav-link[data-feature]').forEach((link) => {
      if (link.getAttribute('data-feature') === id) triggerUnlockPulseOnLink(link);
    });
  }
  if (pulseIds.length > 0) {
    playUnlockSound();
    const firstTitle = UNLOCK_EXPLAIN[pulseIds[0]]?.title || 'ميزة جديدة';
    const suffix = pulseIds.length > 1 ? ` و${pulseIds.length - 1} ميزة أخرى` : '';
    showToast(`🎉 تم فتح ميزة: ${firstTitle}${suffix}`, 'success');
  }

  window.__navLockPrev = { ...currentLocks };
}

function syncWorldCardsLockUi() {
  document.querySelectorAll('.world-card[data-feature]').forEach((card) => {
    const feat = card.dataset.feature;
    const locked = feat && !isFeatureUnlocked(feat);
    card.classList.toggle('locked', locked);
    card.setAttribute('aria-disabled', locked ? 'true' : 'false');
    const overlay = card.querySelector('.world-card-lock-overlay');
    if (overlay) overlay.style.display = locked ? '' : 'none';
  });
}

function syncDockLockUi() {
  document.querySelectorAll('.treasure-dock-btn[data-feature]').forEach((btn) => {
    const id = btn.getAttribute('data-feature');
    if (!id) return;
    const locked = !isFeatureUnlocked(id);
    btn.classList.toggle('dock-feature-locked', locked);
    btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
    const overlay = btn.querySelector('.dock-lock-overlay');
    if (overlay) overlay.style.display = locked ? 'flex' : 'none';
  });
}

function refreshFeatureUnlockUI() {
  if (typeof syncNavLockUi === 'function') syncNavLockUi();
  syncWorldCardsLockUi();
  syncDockLockUi();
}

// ── Theme Switching ──────────────────────────────
const THEME_USE_MESSAGES = {
  lootlingua: 'رجعنا للستايل الأصلي.. جميل ومرتب .',
  golden: 'الكنز الذهبي اشتغل. واضح إن القاموس صار داخل غرفة loot.',
  scroll: 'المخطوطة القديمة جاهزة. جو دراسة، بس بدون غبار المكتبات.',
  ocean: 'واحة الهدوء مفعلة. هذا الثيم معمول للدراسة براحة.',
  glass: 'Liquid Glass اشتغل. هيك دخلنا مرحلة الستايل الفاخر.',
};

const THEME_UNLOCK_MESSAGES = {
  golden: 'فتحت ثيم الكنز الذهبي. أول إنجاز بصري محترم.',
  scroll: 'فتحت ثيم المخطوطة القديمة. القاموس صار عنده تاريخ.',
  ocean: 'فتحت ثيم واحة الهدوء. مكافأة لطيفة بعد التقدم.',
  glass: 'فتحت Liquid Glass. وصلت للستايل الثقيل.',
};

function themeSeenKey(type, theme) {
  return `lootlingua:${type}:theme:${theme}`;
}

function showThemeUseMessageOnce(theme) {
  if (!THEME_USE_MESSAGES[theme]) return;
  const key = themeSeenKey('used', theme);
  if (localStorage.getItem(key) === '1') return;
  localStorage.setItem(key, '1');
  setTimeout(() => showToast(THEME_USE_MESSAGES[theme], 'success', 5200), 2400);
}

function bootstrapThemeNotificationKeysOnce() {
  const bootKey = 'lootlingua:themeNotifyBootstrapped';
  if (localStorage.getItem(bootKey) === '1') return;
  Object.keys(THEME_UNLOCK_LEVELS).forEach((theme) => {
    if (isThemeComingSoon(theme) || !isThemeUnlocked(theme)) return;
    localStorage.setItem(themeSeenKey('unlocked', theme), '1');
  });
  const activeTheme = localStorage.getItem('theme') || document.documentElement.getAttribute('data-theme') || 'lootlingua';
  if (THEME_USE_MESSAGES[activeTheme] && isThemeUnlocked(activeTheme)) {
    localStorage.setItem(themeSeenKey('used', activeTheme), '1');
  }
  localStorage.setItem(bootKey, '1');
}

function checkThemeUnlocksAfterXP(prevXP, nextXP) {
  if (shouldSuppressUnlockNotices()) return;
  const oldLevel = getLevelFromXP(prevXP);
  const newLevel = getLevelFromXP(nextXP);
  if (newLevel <= oldLevel) return;
  Object.entries(THEME_UNLOCK_LEVELS).forEach(([theme, requiredLevel]) => {
    if (isThemeComingSoon(theme)) return;
    if (oldLevel >= requiredLevel || newLevel < requiredLevel) return;
    const unlockKey = themeSeenKey('unlocked', theme);
    if (localStorage.getItem(unlockKey) === '1') return;
    localStorage.setItem(unlockKey, '1');
    sessionStorage.removeItem(`lootlingua:themeRelockNotice:${theme}`);
    playUnlockSound();
    const msg = THEME_UNLOCK_MESSAGES[theme];
    if (msg) setTimeout(() => showToast(msg, 'success', 5200), 420);
  });
}

function checkThemeRelocksAfterXP(prevXP, nextXP) {
  const oldLevel = getLevelFromXP(prevXP);
  const newLevel = getLevelFromXP(nextXP);
  if (newLevel >= oldLevel) return;
  Object.entries(THEME_UNLOCK_LEVELS).forEach(([theme, requiredLevel]) => {
    if (isThemeComingSoon(theme)) return;
    if (oldLevel >= requiredLevel && newLevel < requiredLevel) {
      localStorage.removeItem(themeSeenKey('unlocked', theme));
      localStorage.removeItem(themeSeenKey('used', theme));
    }
  });
}

window.setTheme = function(theme, skipLockCheck = false) {
  const previousTheme = localStorage.getItem('theme') || document.documentElement.getAttribute('data-theme') || 'lootlingua';
  if (!skipLockCheck && isThemeComingSoon(theme)) {
    showGlassThemeComingSoonMessage();
    return false;
  }
  if (!skipLockCheck && !isThemeUnlocked(theme)) {
    showToast(getThemeLockedMessage(theme), 'warning');
    return false;
  }
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === theme);
  });
  refreshThemeLockUI();
  if (!skipLockCheck && theme !== previousTheme) showThemeUseMessageOnce(theme);
  if (!skipLockCheck) requestProfileCloudSave();
  return true;
};

function loadTheme() {
  const saved = localStorage.getItem('theme') || 'lootlingua';
  let candidate = saved;
  if (isThemeComingSoon(candidate) || !isThemeUnlocked(candidate)) candidate = 'lootlingua';
  setTheme(candidate, true);
  refreshThemeLockUI();
}

// ═══════════════════════════════════════════════════════
// Modal & Toast
// ═══════════════════════════════════════════════════════
const APP_VIEW_ROUTES = {
  personal: 'dictionary',
  treasure: 'treasure',
  worlds: 'worlds',
  minecraft: 'minecraft',
  pubg: 'pubg',
  starred: 'hard-words',
  quiz: 'quiz',
  admin: 'admin',
};
const APP_MODAL_ROUTES = {
  deleteModal: 'delete-word',
  unlockExplainModal: 'locked-feature',
  logoutModal: 'logout',
  guestMigrationModal: 'guest-loot-transfer',
  performanceModeInfoModal: 'performance',
  keyboardShortcutsModal: 'keyboard-shortcuts',
  welcomeModal: 'welcome',
};
const APP_OVERLAY_ROUTES = {
  profile: 'profile',
  stats: 'stats',
  quests: 'daily-quests',
  notifications: 'notifications',
};
const APP_ROUTE_TO_VIEW = Object.fromEntries(Object.entries(APP_VIEW_ROUTES).map(([k, v]) => [v, k]));
const APP_ROUTE_TO_MODAL = Object.fromEntries(Object.entries(APP_MODAL_ROUTES).map(([k, v]) => [v, k]));
const APP_ROUTE_TO_OVERLAY = Object.fromEntries(Object.entries(APP_OVERLAY_ROUTES).map(([k, v]) => [v, k]));
const APP_PROJECT_BASE_PATH = '/LootLingua';
let appRouteSyncing = false;
let appRoutingReady = false;

function getAppBasePath() {
  const pathname = location.pathname || '/';
  const isGithubPages = location.hostname.endsWith('github.io');
  const isProjectPath = pathname === APP_PROJECT_BASE_PATH || pathname.startsWith(APP_PROJECT_BASE_PATH + '/');
  return isGithubPages || isProjectPath ? APP_PROJECT_BASE_PATH : '';
}

function getAppRoutePath(kind, key) {
  const slug = kind === 'modal'
    ? APP_MODAL_ROUTES[key]
    : kind === 'overlay'
      ? APP_OVERLAY_ROUTES[key]
      : APP_VIEW_ROUTES[key || 'personal'];
  return getAppBasePath() + '/' + (slug || APP_VIEW_ROUTES.personal);
}

function parseAppRoute() {
  const basePath = getAppBasePath();
  let pathname = decodeURIComponent(location.pathname || '');
  if (basePath && (pathname === basePath || pathname === basePath + '/')) {
    pathname = '';
  } else if (basePath && pathname.startsWith(basePath + '/')) {
    pathname = pathname.slice(basePath.length);
  }
  const slug = pathname.replace(/^\/+|\/+$/g, '');
  if (!slug) return { kind: 'view', key: 'personal' };
  if (APP_ROUTE_TO_VIEW[slug]) return { kind: 'view', key: APP_ROUTE_TO_VIEW[slug] };
  if (APP_ROUTE_TO_MODAL[slug]) return { kind: 'modal', key: APP_ROUTE_TO_MODAL[slug] };
  if (APP_ROUTE_TO_OVERLAY[slug]) return { kind: 'overlay', key: APP_ROUTE_TO_OVERLAY[slug] };
  return { kind: 'view', key: 'personal' };
}

function setAppRoute(kind, key, options = {}) {
  if (!appRoutingReady || appRouteSyncing) return;
  const path = getAppRoutePath(kind, key);
  const state = { lootlingua: true, kind, key, source: options.source || (options.replace ? 'replace' : 'push') };
  try {
    if (location.pathname === path) {
      history.replaceState({ ...state, source: history.state?.source || state.source }, '', path);
      return;
    }
    history[options.replace ? 'replaceState' : 'pushState'](state, '', path);
  } catch (err) {
    console.warn('route:', err.message);
  }
}

function setAppViewRoute(viewKey, options = {}) {
  setAppRoute('view', viewKey, options);
}

function closeRouteOverlays() {
  document.querySelectorAll('.custom-modal').forEach(modal => {
    modal.style.display = 'none';
  });
  const profile = document.getElementById('profileModal');
  if (profile) {
    profile.classList.remove('open');
    profile.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('profile-modal-open');
    unlockBackgroundScroll('profile');
  }
  const stats = document.getElementById('statsPanel');
  if (stats) {
    stats.classList.remove('show');
    stats.style.display = 'none';
    unlockBackgroundScroll('stats');
  }
  const wordHunterModal = document.getElementById('wordHunterModal');
  if (wordHunterModal?.classList.contains('open')) {
    if (typeof window.closeWordHunterModal === 'function') {
      window.closeWordHunterModal();
    } else {
      wordHunterModal.classList.remove('open');
      wordHunterModal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('word-hunter-open');
      unlockBackgroundScroll('wordHunter');
    }
  }
  if (typeof closeDailyQuestsSheet === 'function') closeDailyQuestsSheet(true);
  if (typeof closeNotificationsPanel === 'function') closeNotificationsPanel(true);
}

function openRouteOverlay(kind, key) {
  if (kind === 'modal') {
    const modal = document.getElementById(key);
    if (modal) modal.style.display = 'flex';
    return;
  }
  if (key === 'profile') {
    const modal = document.getElementById('profileModal');
    if (modal && !modal.classList.contains('open')) toggleProfileModal();
  } else if (key === 'stats') {
    openStatsPanel();
  } else if (key === 'quests') {
    const sheet = document.getElementById('dailyQuestsSheet');
    if (sheet && !sheet.classList.contains('open')) toggleDailyQuestsSheet();
  } else if (key === 'notifications') {
    const panel = document.getElementById('notificationsPanel');
    if (panel && !panel.classList.contains('open')) toggleNotificationsPanel();
  }
}

function openRouteView(viewKey) {
  if (viewKey === 'treasure') loadTreasureView();
  else if (viewKey === 'worlds') loadWorldsView();
  else if (viewKey === 'minecraft') loadGameDictionary('minecraft');
  else if (viewKey === 'pubg') loadGameDictionary('pubg');
  else if (viewKey === 'starred') loadStarredView();
  else if (viewKey === 'quiz') loadQuizView();
  else if (viewKey === 'admin') {
    if (typeof window.loadAdminView === 'function') {
      window.loadAdminView();
    } else {
      currentView = 'admin';
      const adminView = document.getElementById('adminView');
      if (adminView) {
        adminView.hidden = false;
        adminView.style.display = 'block';
        adminView.replaceChildren();
        const message = document.createElement('p');
        message.className = 'admin-route-error';
        message.textContent = 'تعذر تحميل واجهة الإدارة. لم يتم منح أي صلاحية.';
        adminView.append(message);
      }
    }
  }
  else loadPersonalDictionary();
}

function canLeaveCurrentRoute(nextRoute) {
  if (currentView !== 'admin') return true;
  if (nextRoute?.kind === 'view' && nextRoute.key === 'admin') return true;
  if (typeof window.canLeaveAdminView !== 'function') return true;
  return window.canLeaveAdminView('route') !== false;
}

function applyAppRoute(route = parseAppRoute()) {
  if (!canLeaveCurrentRoute(route)) {
    setAppViewRoute('admin', { source: 'blocked-dirty-leave' });
    return false;
  }
  appRouteSyncing = true;
  closeRouteOverlays();
  if (route.kind === 'view') {
    openRouteView(route.key);
  } else {
    openRouteView(currentView || 'personal');
    openRouteOverlay(route.kind, route.key);
  }
  appRouteSyncing = false;
  return true;
}

function handleInitialRouting() {
  if (appRoutingReady) return;
  const route = parseAppRoute();
  appRoutingReady = true;
  try {
    const path = getAppRoutePath(route.kind, route.key);
    const state = { lootlingua: true, ...route, source: 'initial' };
    if (location.pathname === path) {
      history.replaceState(state, '', location.href);
    } else {
      history.replaceState(state, '', path);
    }
  } catch (err) {
    console.warn('route:', err.message);
  }
  applyAppRoute(route);
}

window.addEventListener('popstate', () => {
  if (!appRoutingReady) return;
  if (currentView === 'quiz' && activeQuizSession && isVerifiedQuizMode(activeQuizSession.mode)) {
    setAppViewRoute('quiz', { replace: true, source: 'guarded-exit' });
    window.requestQuizExit('personal');
    return;
  }
  applyAppRoute(parseAppRoute());
});

function closeRouteEntry(kind, key, fallbackClose) {
  if (!appRouteSyncing && history.state?.lootlingua && history.state.kind === kind && history.state.key === key) {
    if (history.state.source === 'push') {
      history.back();
      return;
    }
    fallbackClose();
    setAppViewRoute(currentView || 'personal', { replace: true, source: 'close' });
    return;
  }
  fallbackClose();
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.style.display = 'flex';
  if (APP_MODAL_ROUTES[id]) setAppRoute('modal', id);
}

function hideModal(id) {
  const close = () => {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
  };
  if (APP_MODAL_ROUTES[id]) closeRouteEntry('modal', id, close);
  else close();
}

function showToast(msg, type = 'info', duration = 2500) {
  const t = document.getElementById('toastMessage');
  if (!t) return;
  const text = String(msg ?? '');
  const detailId = window.__toastDetailNotifId || '';
  const needsDetails = notificationNeedsDetails(text);
  t.innerHTML = needsDetails
    ? `<span class="toast-text">${escapeHtml(text)}</span><button type="button" class="toast-details-btn" onclick="openNotificationDetails('${escapeHtml(String(detailId))}', event)">التفاصيل</button>`
    : `<span class="toast-text">${escapeHtml(text)}</span>`;
  window.__toastDetailNotifId = '';
  t.style.background = '';
  t.style.color = '';
  t.classList.remove('toast-success', 'toast-warning', 'toast-danger', 'toast-info', 'toast-attention-shake');
  t.classList.add(type === 'success' ? 'toast-success' : type === 'danger' ? 'toast-danger' : type === 'warning' ? 'toast-warning' : 'toast-info');
  t.classList.add('show');
  if (type === 'warning' || type === 'danger') {
    void t.offsetWidth;
    t.classList.add('toast-attention-shake');
    triggerAttentionFeedback(document.querySelector('.main-content') || document.body);
  }
  clearTimeout(window.__toastHideTimer);
  window.__toastHideTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ═══════════════════════════════════════════════════════
// ONBOARDING — Event-driven, simple, step-based
// ═══════════════════════════════════════════════════════
const ONBOARDING_STORAGE_KEY = 'lootlinguaOnboarding';

const ONBOARDING_STEPS = [
  { id: 'welcome', type: 'modal', title: 'مرحباً في LootLingua', text: 'LootLingua هو قاموسك الشخصي (إنجليزي - عربي).' },
  { id: 'wordInput', target: '#wordInput', text: '✍️ هنا تكتب الكلمة بالإنجليزي. سنستخدم كلمة جاهزة لتسهيل البداية.', action: 'fill' },
  { id: 'searchBtn', target: '#searchBtn', text: '🔍 اضغط هنا لجلب معنى الكلمة وجملة عليها.' },
  { id: 'selectSug', target: '#suggestionsBox', text: '✨ اختر أحد المعاني المقترحة لتعبئة البيانات.', preferredSide: 'left' },
  { id: 'addBtn', target: '#addBtn', text: '⭐ اضغط هنا لإضافة الكلمة إلى القاموس.' },
  { id: 'sound', target: '#list .word-card:first-child .sound-btn', text: '🔊 اضغط هنا لتسمع نطق الكلمة.' },
  { id: 'starBtn', target: '#list .word-card:first-child .star-btn', text: '⭐ هاي النجمة بتخليك تضيف الكلمة لقائمة "الكلمات الصعبة" عشان ترجع تراجعها' },
  { id: 'dictSearch', target: '#searchInput', text: '🔎 من هون تقدر تبحث داخل قاموسك بسهولة' },
  { id: 'legendDock', target: '#legendDock', text: '👇 هذا شريط التنقل الرئيسي — من هون تتحكم بكل أقسام التطبيق', dockStep: true },
  { id: 'worldsBtn', target: '#legendDock [data-dock-view="worlds"]', text: '🌍 ادخل على "العوالم" عشان تستكشف قواميس الألعاب أو تراجع الكلمات الصعبة', dockStep: true, openOnNext: 'worlds' },
  { id: 'quizBtn', target: '#legendDock [data-dock-view="quiz"]', text: '🎮 جرب "الاختبار" واختبر نفسك بالكلمات اللي تعلمتها', dockStep: true, openOnNext: 'quiz' },
  { id: 'treasureBtn', target: '#legendDock [data-dock-view="treasure"]', text: '💎 افتح "الكنز" يوميًا وخذ مكافآت و XP', dockStep: true, openOnNext: 'treasure' },
  { id: 'treasureTitles', target: '#treasureView .treasure-title-strip', text: 'هون بتقدر تتثبت إنك ما كنت قاعد بتتفرج، هون بتفتح ألقاب حسب تعبك 🔥', view: 'treasure' },
  { id: 'streak', target: '#streakWrap', text: '🔥 هذا الـ Streak — استخدم التطبيق كل يوم وخليه يزيد', topBarStep: true },
  { id: 'dailyQuests', target: '#dailyQuestsBtn', text: '🎯 عندك مهام يومية تساعدك تتابع تعلّمك', topBarStep: true },
  { id: 'notifBtn', target: '#notifBtn', text: '🔔 هون بتشوف كل الإشعارات والأحداث اللي صارت معك', topBarStep: true },
  { id: 'profileAvatar', target: '#heroAvatarBtn', text: '👤 هذا ملفك الشخصي — فيه مستواك، XP، وإحصائياتك', topBarStep: true, openOnNext: 'profile' },
  { id: 'profileThemes', target: '.profile-theme-selector', text: '🎨 تقدر تغير شكل التطبيق من الثيمات حسب ذوقك', view: 'profile' },
  { id: 'profileLogin', target: '#loginBtn', text: '☁️ سجل دخولك عشان تحفظ كلماتك على كل أجهزتك', view: 'profile' },
  { id: 'finish', type: 'finish', text: '🎉 خلصنا!\nضيف كلمات، جرب الكويز، واصير Legend 👑', requiresPersonal: true }
];

const ONBOARDING_SKIP_AFTER = 6;

let onboardState = {
  active: false,
  stepIndex: -1,
  currentStep: null,
  _cleanups: []
};

let onboardingHighlightRing = null;
let onboardingRingTarget = null;

function getSafeWord() {
  const options = ['book', 'go', 'learn', 'run', 'jump', 'play', 'see', 'look'];
  const existing = new Set(window.words.map(w => (w.word || '').toLowerCase().trim()));
  return options.find(w => !existing.has(w.toLowerCase())) || 'go';
}

let currentHighlightedElement = null; // Track the currently highlighted element

function onboardingCleanup() {
  onboardState._cleanups.forEach(fn => { try { fn(); } catch (_) {} });
  onboardState._cleanups = [];
}

function clearOnboardingHighlight() {
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove('onboarding-active-target');
    currentHighlightedElement = null;
  }
  onboardingRingTarget = null;
  if (onboardingHighlightRing) {
    onboardingHighlightRing.remove();
    onboardingHighlightRing = null;
  }
}

function updateOnboardingHighlightRing(target, pad = 8) {
  if (!onboardingHighlightRing || !target) return;
  const rect = target.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  const radius = Math.min(20, Math.max(10, Math.min(rect.width, rect.height) * 0.2));
  onboardingHighlightRing.style.top = `${Math.max(0, rect.top - pad)}px`;
  onboardingHighlightRing.style.left = `${Math.max(0, rect.left - pad)}px`;
  onboardingHighlightRing.style.width = `${rect.width + pad * 2}px`;
  onboardingHighlightRing.style.height = `${rect.height + pad * 2}px`;
  onboardingHighlightRing.style.borderRadius = `${radius}px`;
}

function applyOnboardingHighlight(target, step = {}) {
  clearOnboardingHighlight();
  if (!target) return;
  const pad = step.highlightPad ?? (target.closest('.legend-dock') ? 6 : 8);
  target.classList.add('onboarding-active-target');
  currentHighlightedElement = target;
  onboardingRingTarget = target;

  onboardingHighlightRing = document.createElement('div');
  onboardingHighlightRing.id = 'onboardingHighlightRing';
  onboardingHighlightRing.className = 'onboarding-highlight-ring';
  onboardingHighlightRing.setAttribute('aria-hidden', 'true');
  document.body.appendChild(onboardingHighlightRing);
  updateOnboardingHighlightRing(target, pad);

  const reposition = () => {
    if (onboardingRingTarget) updateOnboardingHighlightRing(onboardingRingTarget, pad);
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  onboardState._cleanups.push(() => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
  });
}

function onboardingWaitLayout(step = {}) {
  const delay = step.dockStep ? 300 : step.view === 'profile' ? 380 : step.view === 'treasure' ? 320 : step.topBarStep ? 120 : 200;
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, delay)));
  });
}

function executeOnboardingOpen(openKey) {
  if (openKey === 'worlds' && typeof loadWorldsView === 'function') loadWorldsView();
  else if (openKey === 'quiz' && typeof loadQuizView === 'function') loadQuizView();
  else if (openKey === 'treasure' && typeof loadTreasureView === 'function') loadTreasureView();
  else if (openKey === 'profile' && typeof toggleProfileModal === 'function') {
    const modal = document.getElementById('profileModal');
    if (modal && !modal.classList.contains('open')) toggleProfileModal();
  }
}

function scrollOnboardingTarget(el, step) {
  if (!el) return;
  if (step.topBarStep) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (step.dockStep) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    return;
  }
  if (step.view === 'profile') {
    const body = document.querySelector('.profile-modal-body');
    if (body && el) body.scrollTo({ top: Math.max(0, el.offsetTop - 28), behavior: 'smooth' });
    return;
  }
  if (step.view === 'treasure') {
    window.scrollTo({ top: 0, behavior: 'auto' });
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: step.scrollBlock || 'center', inline: 'nearest' });
}

function ensureOnboardingBackdrop() {
  const backdrop = document.getElementById('onboardingBackdrop');
  if (backdrop) backdrop.classList.add('visible');
}

function prepareOnboardingView(step) {
  if (!step) return;
  const dockIds = ['legendDock', 'worldsBtn', 'quizBtn', 'treasureBtn'];
  const topBarIds = ['streak', 'dailyQuests', 'notifBtn', 'profileAvatar'];
  const profileSteps = ['profileThemes', 'profileLogin'];

  if (typeof closeDailyQuestsSheet === 'function') closeDailyQuestsSheet();
  if (typeof closeNotificationsPanel === 'function') closeNotificationsPanel();

  if (step.view === 'treasure' && typeof loadTreasureView === 'function') {
    loadTreasureView();
    return;
  }

  if (profileSteps.includes(step.id)) {
    if (typeof toggleProfileModal === 'function') {
      const modal = document.getElementById('profileModal');
      if (modal && !modal.classList.contains('open')) toggleProfileModal();
    }
    return;
  }

  if (typeof closeProfileModal === 'function') closeProfileModal();

  if (step.requiresPersonal || step.id === 'finish' || topBarIds.includes(step.id) || dockIds.includes(step.id)) {
    if (currentView !== 'personal' && typeof loadPersonalDictionary === 'function') {
      loadPersonalDictionary();
    }
    if (typeof setTreasureEntryVisible === 'function') setTreasureEntryVisible(true);
  }
}

function appendOnboardingNav(container, step) {
  const row = document.createElement('div');
  row.className = 'onboarding-nav-row';

  if (onboardState.stepIndex > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'onboarding-back-btn';
    back.textContent = 'السابق';
    back.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      prevStep();
    });
    row.appendChild(back);
  }

  if (onboardState.stepIndex >= ONBOARDING_SKIP_AFTER) {
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'onboarding-skip-btn';
    skip.textContent = 'تخطي الشرح';
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOnboardingStatus('skipped');
      endOnboarding();
    });
    row.appendChild(skip);
  }

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'onboarding-next-btn';
  next.textContent = 'التالي';
  next.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (step?.openOnNext) {
      executeOnboardingOpen(step.openOnNext);
      await onboardingWaitLayout({ view: step.openOnNext === 'profile' ? 'profile' : step.openOnNext, dockStep: step.dockStep });
    }
    nextStep();
  }, { once: true });
  row.appendChild(next);

  if (row.children.length) container.appendChild(row);
}

function showTooltip(target, text, options = {}) {
  const { preferredSide, dockStep, step } = options;
  const tooltip = document.getElementById('onboardingTooltip');
  if (!tooltip || !target) return;

  ensureOnboardingBackdrop();
  const isMobile = window.innerWidth <= 768;

  applyOnboardingHighlight(target, step || onboardState.currentStep);

  const displayText = text;

  tooltip.style.opacity = '0';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.left = '-9999px';
  tooltip.style.top = '0px';
  tooltip.style.right = 'auto';
  tooltip.style.bottom = 'auto';
  tooltip.style.transform = '';
  const body = document.createElement('div');
  body.className = 'onboarding-tip-text';
  body.innerHTML = displayText.replace(/\n/g, '<br>');
  tooltip.innerHTML = '';
  tooltip.appendChild(body);
  appendOnboardingNav(tooltip, step || onboardState.currentStep);
  tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right', 'mobile-sheet', 'kb-active', 'dock-step', 'profile-step');
  tooltip.classList.add('visible');

  void tooltip.offsetWidth;

  if (isMobile) {
    tooltip.classList.add('mobile-sheet');
    if (dockStep) tooltip.classList.add('dock-step');
    if (step?.view === 'profile') tooltip.classList.add('profile-step');
    const activeEl = document.activeElement;
    if ((activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.type !== 'button') {
      tooltip.classList.add('kb-active');
    }
    tooltip.style.left = '';
    tooltip.style.top = '';
    tooltip.style.opacity = '1';
    tooltip.style.pointerEvents = 'auto';
    requestAnimationFrame(() => updateOnboardingHighlightRing(target, step?.highlightPad ?? 8));
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  let tipW = tooltipRect.width || tooltip.offsetWidth;
  let tipH = tooltipRect.height || tooltip.offsetHeight;
  const margin = 15;

  // Guard against stale/zero layout readings without waiting on timers.
  if (!tipW || tipW < 1) tipW = Math.min(280, window.innerWidth - margin * 2);
  if (!tipH || tipH < 1) tipH = 80;

  let top = 0, left = 0, arrowClass = '';
  const isRTL = document.dir === 'rtl' || getComputedStyle(document.body).direction === 'rtl';

  if (preferredSide === 'viewport-right') {
    top = targetRect.bottom + margin;
    left = window.innerWidth - tipW - margin;
    arrowClass = 'arrow-top';
  } else if (target.id === 'sidebar' || target.id === 'menuBtn') {
    left = isRTL ? (targetRect.left - tipW - margin) : (targetRect.right + margin);
    top = targetRect.top + Math.min(40, Math.max(0, targetRect.height / 2 - tipH / 2));
    arrowClass = isRTL ? 'arrow-left' : 'arrow-right';
  } else if (preferredSide) {
    top = targetRect.top + (targetRect.height / 2) - (tipH / 2);
    left = (preferredSide === 'left') ? (targetRect.left - tipW - margin) : (targetRect.right + margin);
    arrowClass = (preferredSide === 'left') ? 'arrow-left' : 'arrow-right';
  } else if (dockStep || target.closest('.legend-dock')) {
    top = Math.max(margin, targetRect.top - tipH - margin);
    left = targetRect.left + (targetRect.width / 2) - (tipW / 2);
    arrowClass = 'arrow-top';
  } else if (target.closest('.legend-top-bar') || step?.topBarStep) {
    top = targetRect.bottom + margin;
    left = targetRect.left + (targetRect.width / 2) - (tipW / 2);
    arrowClass = 'arrow-bottom';
  } else if (targetRect.bottom + tipH + margin < window.innerHeight) {
    top = targetRect.bottom + margin;
    left = targetRect.left + (targetRect.width / 2) - (tipW / 2);
    arrowClass = 'arrow-bottom';
  } else {
    top = targetRect.top - tipH - margin;
    left = targetRect.left + (targetRect.width / 2) - (tipW / 2);
    arrowClass = 'arrow-top';
  }

  left = Math.max(margin, Math.min(left, window.innerWidth - tipW - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - tipH - margin));

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right');
  if (arrowClass) tooltip.classList.add(arrowClass);
  tooltip.style.opacity = '1';
  tooltip.style.pointerEvents = 'auto';
}
function hideTooltip() {
  const tooltip = document.getElementById('onboardingTooltip');
  if (tooltip) {
    tooltip.classList.remove('visible');
    tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right');
    tooltip.innerHTML = '';
  }
  clearOnboardingHighlight();
}

// دالة مخصصة لعرض التلميح على يسار الزر (داخل الصفحة)
function setOnboardingStatus(status) {
  localStorage.setItem(ONBOARDING_STORAGE_KEY, status);
}

function getOnboardingStatus() {
  return localStorage.getItem(ONBOARDING_STORAGE_KEY);
}

function hasOnboardingState() {
  return ['completed', 'skipped'].includes(getOnboardingStatus());
}

let isProcessingNextStep = false; // لمنع تكرار الخطوات على الهاتف
let onboardingStepAdvanceTimer = null;

window.startOnboarding = function(force = false) {
  if (isOnboardingComingSoon()) {
    showOnboardingComingSoonMessage();
    return;
  }
  if (force) setOnboardingStatus('new');

  hideAllEmptyOnboardingTooltips();
  emptyOnboardingState.active = false;
  emptyOnboardingState.phase = 0;

  if (typeof closeProfileModal === 'function') closeProfileModal();
  if (typeof closeSidebarIfOpen === 'function') closeSidebarIfOpen();
  if (typeof loadPersonalDictionary === 'function') loadPersonalDictionary();

  onboardingCleanup();
  onboardState.active = true;
  onboardState.stepIndex = 0;
  document.documentElement.classList.add('onboarding-active');
  document.body.classList.add('onboarding-active');
  if (mainContentScrollArea) mainContentScrollArea.style.overflow = 'hidden';

  window.addEventListener('wheel', preventScroll, { passive: false });
  window.addEventListener('touchmove', preventScroll, { passive: false });

  runStep();
};

function prevStep() {
  if (!onboardState.active || onboardState.stepIndex <= 0) return;
  if (isProcessingNextStep) return;
  isProcessingNextStep = true;
  onboardingCleanup();
  onboardState.stepIndex--;
  runStep();
  setTimeout(() => { isProcessingNextStep = false; }, 500);
}

function nextStep(expectedStepIndex = null) {
  expectedStepIndex = Number.isInteger(expectedStepIndex) ? expectedStepIndex : null;
  if (expectedStepIndex !== null && onboardState.stepIndex !== expectedStepIndex) return;
  if (isProcessingNextStep) return;
  isProcessingNextStep = true;

  if (onboardingStepAdvanceTimer) {
    clearTimeout(onboardingStepAdvanceTimer);
    onboardingStepAdvanceTimer = null;
  }

  onboardingCleanup();
  onboardState.stepIndex++;
  runStep();

  setTimeout(() => { isProcessingNextStep = false; }, 700);
}

window.onboardingEvent = function(eventName) {
  if (!onboardState.active || !onboardState.currentStep) return;
  if (onboardState.currentStep.waitFor === eventName) {
    const expectedStepIndex = onboardState.stepIndex;
    onboardState.waitingFor = null;
    if (onboardingStepAdvanceTimer) clearTimeout(onboardingStepAdvanceTimer);
    onboardingStepAdvanceTimer = setTimeout(() => {
      onboardingStepAdvanceTimer = null;
      nextStep(expectedStepIndex);
    }, 100);
  }
};

async function runStep() {
  hideTooltip();
  onboardingCleanup();

  const step = ONBOARDING_STEPS[onboardState.stepIndex];
  if (!step) {
    endOnboarding();
    return;
  }

  onboardState.currentStep = step;
  prepareOnboardingView(step);
  await onboardingWaitLayout(step);

  if (step.type === 'modal') {
    showOnboardingBox(step);
    return;
  }

  if (step.type === 'finish') {
    const box = document.getElementById('onboardingBox');
    if (box) { box.classList.add('hidden'); box.style.display = 'none'; }
    if (typeof closeProfileModal === 'function') closeProfileModal();
    if (typeof loadPersonalDictionary === 'function') loadPersonalDictionary();
    setTimeout(() => showFinishTooltip(step.text), 320);
    return;
  }

  const box = document.getElementById('onboardingBox');
  const backdrop = document.getElementById('onboardingBackdrop');
  if (backdrop) backdrop.classList.remove('modal-backdrop');
  if (box) { box.classList.add('hidden'); box.style.display = 'none'; }

  let el = document.querySelector(step.target);
  if (!el) {
    setTimeout(() => runStep(), 150);
    return;
  }

  scrollOnboardingTarget(el, step);
  await onboardingWaitLayout(step);
  el = document.querySelector(step.target);
  if (!el) {
    setTimeout(() => runStep(), 150);
    return;
  }

  if (step.action === 'fill') {
    applyOnboardingHighlight(el, step);
    el.value = getSafeWord();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(nextStep, 1500);
    return;
  }

  showTooltip(el, step.text, { preferredSide: step.preferredSide, step, dockStep: step.dockStep });
}

function showOnboardingBox(step) {
  const box = document.getElementById('onboardingBox');
  const backdrop = document.getElementById('onboardingBackdrop');
  const title = document.getElementById('onboardingTitle');
  const text = document.getElementById('onboardingText');
  const primary = document.getElementById('onboardingPrimaryBtn');
  const secondary = document.getElementById('onboardingSecondaryBtn');

  title.textContent = step.title;
  text.innerHTML = step.text;
  backdrop.classList.toggle('modal-backdrop', step.id === 'welcome');
  
  if (step.id === 'welcome') {
    primary.textContent = 'ابدأ الشرح';
    primary.addEventListener('click', () => nextStep(), { once: true });
    secondary.textContent = 'لاحقًا';
    secondary.style.display = 'inline-flex';
    secondary.addEventListener('click', () => {
      endOnboarding();
      setOnboardingStatus('skipped');
    }, { once: true });
  } else {
    primary.textContent = 'تمام';
    primary.addEventListener('click', () => {
      setOnboardingStatus('completed');
      hideOnboarding();
      showToast('الشرح انتهى بنجاح!', 'success');
    }, { once: true });
    secondary.style.display = 'none';
  }

  primary.style.display = 'inline-flex';
  box.classList.remove('hidden');
  backdrop.classList.add('visible');
}

function initOnboarding() {
  // حقن تنسيقات الاحترافية للموبايل والـ Spotlight
  const style = document.createElement('style');
  style.textContent = `
    .onboarding-highlight-ring {
      position: fixed;
      z-index: 100005;
      pointer-events: none;
      box-shadow: 0 0 0 max(120vh, 120vw) rgba(0, 0, 0, 0.84);
    }
    .onboarding-active-target {
      z-index: 100007 !important;
      pointer-events: auto !important;
      isolation: isolate;
    }
    .legend-dock .onboarding-active-target,
    .legend-top-bar .onboarding-active-target,
    #heroAvatarBtn.onboarding-active-target,
    .treasure-dock-btn.onboarding-active-target,
    .profile-modal .onboarding-active-target {
      z-index: 100008 !important;
    }
    body.onboarding-active .profile-modal.open {
      pointer-events: auto !important;
    }
    #onboardingTooltip {
      z-index: 100020 !important; /* فوق الـ backdrop والسايدبار وأي overlay داخلي */
    }
    #onboardingBackdrop.visible {
      background: rgba(0, 0, 0, 0.64) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    #onboardingBackdrop.visible.modal-backdrop {
      background: rgba(0, 0, 0, 0.68) !important;
      backdrop-filter: blur(4px) saturate(0.85) !important;
      -webkit-backdrop-filter: blur(4px) saturate(0.85) !important;
    }
    #onboardingBox {
      z-index: 100030 !important;
      filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    body.onboarding-active .main-content,
    body.onboarding-active .sidebar,
    body.onboarding-active .menu-btn,
    body.onboarding-active .legend-top-bar,
    body.onboarding-active .legend-dock {
      pointer-events: none;
    }
    body.onboarding-active .profile-modal:not(.open) {
      pointer-events: none !important;
    }
    body.onboarding-active .onboarding-active-target,
    body.onboarding-active #onboardingTooltip,
    body.onboarding-active #onboardingBox,
    body.onboarding-active #onboardingBackdrop {
      pointer-events: auto !important;
    }
    body.onboarding-active #sidebar:has(.onboarding-active-target),
    body.onboarding-active #sidebar.onboarding-active-target {
      z-index: 100006 !important;
    }
    body.onboarding-active .word-card:has(.sound-btn.onboarding-active-target) .edit-btn,
    body.onboarding-active .word-card:has(.sound-btn.onboarding-active-target) .del-btn,
    body.onboarding-active .word-card:has(.sound-btn.onboarding-active-target) .star-btn {
      position: relative !important;
      z-index: 1 !important;
    }
    /* تجميد محتوى السايدبار أثناء خطوة الشرح لمنع العجقة */
    body.onboarding-active #overlay.show {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    #sidebar.onboarding-active-target * {
      pointer-events: none !important;
    }

    /* القفل الحديدي للسكرول */
    html.onboarding-active, body.onboarding-active {
      overflow: hidden !important;
      overscroll-behavior: none !important; /* يمنع الارتداد في الموبايل */
    }
    /* تأثير انتقالي ناعم للنص عند تغير الخطوات */
    #onboardingTooltip div {
      animation: onboardingTextFade 0.4s ease-out forwards;
    }
    @keyframes onboardingTextFade {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 768px) {
      #onboardingTooltip.mobile-sheet {
        position: fixed !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        top: auto !important;
        width: 100% !important;
        max-width: none !important;
        border-radius: 1.5rem 1.5rem 0 0 !important;
        padding: 0.8rem 1rem !important; /* تقليل الحشو ليكون الصندوق أصغر */
        background: var(--card-bg) !important;
        border: none !important;
        border-top: 3px solid var(--accent) !important;
        box-shadow: 0 -10px 30px rgba(0,0,0,0.5) !important;
        transform: translateY(0) !important;
        margin: 0 !important;
        text-align: center !important;
        z-index: 100020 !important;
      }
      #onboardingTooltip.mobile-sheet div {
        font-size: 0.95rem !important; /* تصغير حجم الخط */
        line-height: 1.4 !important; /* تحسين تباعد الأسطر للحجم الجديد */
      }
      #onboardingTooltip.mobile-sheet.kb-active {
        bottom: auto !important;
        top: 0 !important;
        border-top: none !important;
        border-bottom: 3px solid var(--accent) !important;
        border-radius: 0 0 1.5rem 1.5rem !important;
      }
      .onboarding-next-btn,
      .onboarding-back-btn,
      .onboarding-skip-btn {
        width: auto !important;
        min-width: 88px !important;
        margin-top: 0.55rem !important;
        padding: 0.65rem 0.9rem !important;
        font-size: 0.88rem !important;
      }
      .onboarding-nav-row {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 8px !important;
        justify-content: center !important;
        margin-top: 0.65rem !important;
      }
      #onboardingTooltip.mobile-sheet.dock-step {
        bottom: calc(96px + env(safe-area-inset-bottom)) !important;
        border-radius: 1.2rem !important;
        max-height: 38vh !important;
        overflow-y: auto !important;
      }
      #onboardingTooltip.mobile-sheet.profile-step {
        bottom: 12px !important;
        max-height: 42vh !important;
      }
      #onboardingTooltip.mobile-sheet.finish-step {
        bottom: auto !important;
        top: 50% !important;
        left: 12px !important;
        right: 12px !important;
        width: auto !important;
        transform: translateY(-50%) !important;
        border-radius: 1.2rem !important;
        max-height: 55vh !important;
      }
    }
  `;
  document.head.appendChild(style);

  // مراقبة لوحة المفاتيح لتحديث مكان التلميح
  // تحديد العنصر الرئيسي القابل للتمرير بعد تحميل DOM
  // **هام:** يجب تغيير 'app-main-scroll-area' إلى الـ ID الفعلي للعنصر الذي يحتوي على المحتوى القابل للتمرير في صفحتك.
  // إذا كان الـ body هو العنصر الوحيد القابل للتمرير، اتركه كما هو (document.body).
  mainContentScrollArea = document.getElementById('app-main-scroll-area') || document.body;
  originalMainContentScrollAreaOverflow = mainContentScrollArea.style.overflow;


  window.addEventListener('focusin', (e) => {
    if (!onboardState.active || window.innerWidth > 768) return;
    const activeEl = document.activeElement;
    const tip = document.getElementById('onboardingTooltip');
    if (tip && tip.classList.contains('mobile-sheet') && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      tip.classList.add('kb-active');
    }
  });
  window.addEventListener('focusout', (e) => {
    const tip = document.getElementById('onboardingTooltip');
    if (tip) tip.classList.remove('kb-active');
  });

  // ترحيب أول زيارة فقط — لا شرح تفاعلي تلقائي
  scheduleWelcomeModalIfNeeded();
}

function hasSeenWelcomeModal() {
  return localStorage.getItem(WELCOME_STORAGE_KEY) === '1';
}

function markWelcomeModalSeen() {
  localStorage.setItem(WELCOME_STORAGE_KEY, '1');
  if (!getOnboardingStatus() || getOnboardingStatus() === 'new') {
    setOnboardingStatus('skipped');
  }
}

function scheduleWelcomeModalIfNeeded() {
  if (hasSeenWelcomeModal()) return;
  setTimeout(() => showWelcomeModalOnce(), 1400);
}

function showWelcomeModalOnce() {
  if (hasSeenWelcomeModal()) return;
  showModal('welcomeModal');
}

window.dismissWelcomeModal = function() {
  markWelcomeModalSeen();
  hideModal('welcomeModal');
};

function preventScroll(e) {
  if (onboardState.active) e.preventDefault();
}

function endOnboarding() {
  onboardState.active = false;
  hideOnboarding();
}

function hideOnboarding() {
  onboardingCleanup();
  hideTooltip();
  const box = document.getElementById('onboardingBox');
  const backdrop = document.getElementById('onboardingBackdrop');
  const tooltip = document.getElementById('onboardingTooltip');

  if (box) box.classList.add('hidden');
  if (backdrop) backdrop.classList.remove('visible', 'modal-backdrop');
  if (tooltip) {
    tooltip.classList.remove('visible', 'mobile-sheet', 'dock-step', 'profile-step', 'finish-step');
    tooltip.style.animation = '';
    tooltip.innerHTML = '';
  }

  document.documentElement.classList.remove('onboarding-active');
  document.body.classList.remove('onboarding-active');
  if (mainContentScrollArea) mainContentScrollArea.style.overflow = originalMainContentScrollAreaOverflow;

  window.removeEventListener('wheel', preventScroll);
  window.removeEventListener('touchmove', preventScroll);
  if (typeof closeProfileModal === 'function') closeProfileModal();
}

// دالة لعرض tooltip في منتصف الشاشة للخطوة الأخيرة
function showFinishTooltip(text) {
  const tooltip = document.getElementById('onboardingTooltip');
  const backdrop = document.getElementById('onboardingBackdrop');
  if (!tooltip) return;
  if (backdrop) backdrop.classList.add('visible', 'modal-backdrop');

  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove('onboarding-active-target');
    currentHighlightedElement = null;
  }

  const isMobile = window.innerWidth <= 768;
  const body = document.createElement('div');
  body.className = 'onboarding-tip-text finish-tip';
  body.innerHTML = text.replace(/\n/g, '<br>');
  tooltip.innerHTML = '';
  tooltip.appendChild(body);

  const nav = document.createElement('div');
  nav.className = 'onboarding-nav-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'onboarding-next-btn';
  btn.textContent = 'تمام';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOnboardingStatus('completed');
    endOnboarding();
    showToast('الشرح انتهى بنجاح! 🎉', 'success');
    if (typeof launchConfetti === 'function') launchConfetti();
  }, { once: true });
  nav.appendChild(btn);
  tooltip.appendChild(nav);

  tooltip.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right', 'dock-step', 'profile-step', 'kb-active');
  tooltip.style.opacity = '0';
  tooltip.style.pointerEvents = 'none';

  if (isMobile) {
    tooltip.classList.add('mobile-sheet', 'finish-step');
    tooltip.style.left = '';
    tooltip.style.top = '';
    tooltip.style.right = '';
    tooltip.style.bottom = '';
    tooltip.style.transform = '';
  } else {
    tooltip.classList.remove('mobile-sheet', 'finish-step');
    void tooltip.offsetWidth;
    const tooltipRect = tooltip.getBoundingClientRect();
    const tipW = tooltipRect.width || 280;
    const tipH = tooltipRect.height || 120;
    const left = Math.max(12, (window.innerWidth - tipW) / 2);
    const top = Math.max(12, (window.innerHeight - tipH) / 2 - 40);
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  tooltip.classList.add('visible');
  tooltip.style.opacity = '1';
  tooltip.style.pointerEvents = 'auto';
  tooltip.style.animation = 'tooltipPopIn 0.5s ease-out';
}

// ═══════════════════════════════════════════════════════
// PERSISTENCE HELPERS
// ═══════════════════════════════════════════════════════
function loadInt(k,d)  { const v=parseInt(localStorage.getItem(k)); return isNaN(v)?d:v; }
function saveInt(k,v)  {
  localStorage.setItem(k,String(v));
  markGuestProfileDataDirty(k);
}
function loadJSON(k,d) { try{const r=JSON.parse(localStorage.getItem(k));return r??d;}catch{return d;} }
function saveJSON(k,v) {
  localStorage.setItem(k,JSON.stringify(v));
  markGuestProfileDataDirty(k);
}
function todayStr()    { return new Date().toISOString().slice(0,10); }

function requestProfileCloudSave() {
  if (!window.saveProfileToCloud) return;
  if (window.__applyingCloudProfile || isInitialLoad || window.__suppressUnlockNotices) return;
  window.saveProfileToCloud();
}

// بيانات الملف الشخصي للسحابة (وحدات ES تتصل بهذا بدل `let` من السكربت العادي)
window.getLootlinguaProfilePayload = function() {
  const dailyQuestDate = todayStr();
  return {
    userXP,
    xpEconomyVersion: XP_ECONOMY_VERSION,
    dailyStreak,
    maxStreak:        loadInt('lootlinguaMaxStreak', dailyStreak),
    lastActivityDate: lastActivity,
    activityMap:      loadJSON('activityMap', {}),
    quizExposureHistory: typeof readQuizExposureHistory === 'function' ? readQuizExposureHistory() : [],
    theme:            localStorage.getItem('theme') || document.documentElement.getAttribute('data-theme') || 'lootlingua',
    displayName:      localStorage.getItem('lootlinguaDisplayName') || '',
    addedGameWords:   loadJSON('addedGameWords', []),
    dailyLootState:   typeof getLootState === 'function' ? getLootState() : loadJSON('lootlinguaDailyLootState', {}),
    titlesState:      typeof getTitleState === 'function' ? getTitleState() : loadJSON('lootlinguaTitlesState', {}),
    activeTitleId:    localStorage.getItem('lootlinguaActiveTitleId') || '',
    dailyQuestDate,
    dailyQuestState:  loadJSON(getDailyQuestStorageKey(dailyQuestDate), { claimed: {}, flags: {} }),
    streakFreezes:    loadInt('lootlinguaStreakFreezes', 0),
    freezeSaves:      loadInt('lootlinguaFreezeSaves', 0),
    gameDictAdds:     loadInt('lootlinguaGameDictAdds', 0),
    perfectQuizzes:   loadInt('lootlinguaPerfectQuizzes', 0),
    extraChests:      loadJSON('lootlinguaExtraChests', []),
  };
};

function clearDailyQuestStorage() {
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith('lootlinguaDailyQuests_')) localStorage.removeItem(key);
  });
}

window.resetLootlinguaProfileState = function(options = {}) {
  const { clearDisplayName = true, resetTheme = true } = options;
  userXP = 0;
  dailyStreak = 0;
  lastActivity = '';
  [
    'userXP',
    'dailyStreak',
    'lootlinguaMaxStreak',
    'lastActivityDate',
    'activityMap',
    'addedGameWords',
    'lootlinguaDailyLootState',
    'lootlinguaTitlesState',
    'lootlinguaActiveTitleId',
    'lootlinguaStreakFreezes',
    'lootlinguaFreezeSaves',
    'lootlinguaGameDictAdds',
    'lootlinguaPerfectQuizzes',
    'lootlinguaExtraChests',
  ].forEach((key) => localStorage.removeItem(key));
  clearDailyQuestStorage();
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith('lootlingua:used:theme:') || key.startsWith('lootlingua:unlocked:theme:')) {
      localStorage.removeItem(key);
    }
  });
  if (clearDisplayName) localStorage.removeItem('lootlinguaDisplayName');
  if (resetTheme) {
    localStorage.setItem('theme', 'lootlingua');
    if (typeof setTheme === 'function') setTheme('lootlingua', true);
    else document.documentElement.setAttribute('data-theme', 'lootlingua');
  }
  if (typeof renderStreak === 'function') renderStreak();
  if (typeof renderDailyGoal === 'function') renderDailyGoal();
  if (typeof renderXPBar === 'function') renderXPBar();
  if (typeof syncHeroAvatar === 'function') syncHeroAvatar();
  if (typeof renderProfileModalStats === 'function') renderProfileModalStats();
  if (typeof updateDailyQuestsBadge === 'function') updateDailyQuestsBadge();
  if (typeof refreshFeatureUnlockUI === 'function') refreshFeatureUnlockUI();
  if (typeof renderTreasureRoom === 'function' && currentView === 'treasure') renderTreasureRoom();
};

window.mergeLootlinguaProfileFromCloud = function(d) {
  // Track if we loaded from cloud to avoid double checkAndUpdateStreak
  window._profileLoaded = true;
  if (!d) return;
  const wasApplyingCloudProfile = window.__applyingCloudProfile === true;
  window.__applyingCloudProfile = true;
  try {
  if (d.userXP !== undefined && d.userXP !== null) {
    const cloud = Number(d.userXP) || 0;
    userXP = Math.max(cloud, userXP);
    saveInt('userXP', userXP);
  }
  saveInt('xpEconomyVersion', Math.max(XP_ECONOMY_VERSION, Number(d.xpEconomyVersion) || 0));
  if (d.dailyStreak !== undefined) {
    dailyStreak = Math.max(Number(d.dailyStreak) || 0, dailyStreak);
    saveInt('dailyStreak', dailyStreak);
  }
  if (d.maxStreak !== undefined) {
    saveInt('lootlinguaMaxStreak', Math.max(loadInt('lootlinguaMaxStreak', 0), Number(d.maxStreak) || 0));
  }
  if (d.lastActivityDate) {
    // خُّد الأحدث بين المحلي والسحابة
    if (!lastActivity || d.lastActivityDate > lastActivity) {
      lastActivity = d.lastActivityDate;
      localStorage.setItem('lastActivityDate', lastActivity);
    }
  }
  if (d.activityMap) {
    const localMap = loadJSON('activityMap', {});
    const merged   = { ...d.activityMap };
    Object.entries(localMap).forEach(([k, v]) => { merged[k] = Math.max(merged[k] || 0, v); });
    saveJSON('activityMap', merged);
  }
  if (Array.isArray(d.quizExposureHistory) && typeof writeQuizExposureHistory === 'function') {
    const bySession = new Map();
    [...d.quizExposureHistory, ...readQuizExposureHistory()].forEach((entry) => {
      if (!entry?.sessionId) return;
      const key = String(entry.sessionId);
      const previous = bySession.get(key);
      if (!previous || (Number(entry.at) || 0) > (Number(previous.at) || 0)) bySession.set(key, entry);
    });
    writeQuizExposureHistory([...bySession.values()]
      .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
      .slice(0, 3));
  }
  if (d.addedGameWords && Array.isArray(d.addedGameWords)) {
    const local  = loadJSON('addedGameWords', []);
    const merged = [...new Set([...d.addedGameWords, ...local])];
    saveJSON('addedGameWords', merged);
  }
  if (d.dailyLootState && typeof d.dailyLootState === 'object') {
    const localLoot = typeof getLootState === 'function' ? getLootState() : loadJSON('lootlinguaDailyLootState', {});
    const cloudLoot = d.dailyLootState;
    const byRewardKey = new Map();
    [...(cloudLoot.rewards || []), ...(localLoot.rewards || [])].forEach((r) => {
      if (!r || typeof r !== 'object') return;
      const key = `${r.at || 0}|${r.type || ''}|${r.label || ''}|${r.xp || 0}|${r.freezes || 0}`;
      if (!byRewardKey.has(key)) byRewardKey.set(key, r);
    });
    const cloudLockStamp = Math.max(Number(cloudLoot.lockStartedAt) || 0, Number(cloudLoot.lockResolvedAt) || 0);
    const localLockStamp = Math.max(Number(localLoot.lockStartedAt) || 0, Number(localLoot.lockResolvedAt) || 0);
    const newestLock = localLockStamp > cloudLockStamp ? localLoot : cloudLoot;
    const mergedLoot = {
      ...localLoot,
      ...cloudLoot,
      lastOpenAt: Math.max(Number(cloudLoot.lastOpenAt) || 0, Number(localLoot.lastOpenAt) || 0),
      totalOpens: Math.max(Number(cloudLoot.totalOpens) || 0, Number(localLoot.totalOpens) || 0),
      streak: Math.max(Number(cloudLoot.streak) || 0, Number(localLoot.streak) || 0),
      freezesEarned: Math.max(Number(cloudLoot.freezesEarned) || 0, Number(localLoot.freezesEarned) || 0),
      lockedXP: Math.max(0, Number(newestLock.lockedXP) || 0),
      lockStartedAt: Number(newestLock.lockStartedAt) || 0,
      lockResolvedAt: Number(newestLock.lockResolvedAt) || 0,
      lockMasteredWordIds: [...new Set(newestLock.lockMasteredWordIds || [])],
      lockHighAccuracyQuizIds: [...new Set(newestLock.lockHighAccuracyQuizIds || [])],
      lastOpenDay: [cloudLoot.lastOpenDay || '', localLoot.lastOpenDay || ''].sort().pop() || '',
      rewards: [...byRewardKey.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12),
    };
    if (typeof saveLootState === 'function') saveLootState(mergedLoot);
    else saveJSON('lootlinguaDailyLootState', mergedLoot);
  }
  if (d.titlesState && typeof d.titlesState === 'object') {
    const localTitles = typeof getTitleState === 'function' ? getTitleState() : loadJSON('lootlinguaTitlesState', { unlocked: [], lastUnlockedAt: {} });
    const unlocked = [...new Set([...(d.titlesState.unlocked || []), ...(localTitles.unlocked || [])])];
    const lastUnlockedAt = { ...(d.titlesState.lastUnlockedAt || {}) };
    Object.entries(localTitles.lastUnlockedAt || {}).forEach(([k, v]) => {
      lastUnlockedAt[k] = Math.max(Number(lastUnlockedAt[k]) || 0, Number(v) || 0);
    });
    const mergedTitles = { unlocked, lastUnlockedAt };
    if (typeof saveTitleState === 'function') saveTitleState(mergedTitles);
    else saveJSON('lootlinguaTitlesState', mergedTitles);
  }
  if (d.streakFreezes !== undefined) saveInt('lootlinguaStreakFreezes', Math.max(loadInt('lootlinguaStreakFreezes', 0), Number(d.streakFreezes) || 0));
  if (d.freezeSaves !== undefined) saveInt('lootlinguaFreezeSaves', Math.max(loadInt('lootlinguaFreezeSaves', 0), Number(d.freezeSaves) || 0));
  if (d.gameDictAdds !== undefined) saveInt('lootlinguaGameDictAdds', Math.max(loadInt('lootlinguaGameDictAdds', 0), Number(d.gameDictAdds) || 0));
  if (d.perfectQuizzes !== undefined) saveInt('lootlinguaPerfectQuizzes', Math.max(loadInt('lootlinguaPerfectQuizzes', 0), Number(d.perfectQuizzes) || 0));
  if (Array.isArray(d.extraChests)) {
    const localExtra = loadJSON('lootlinguaExtraChests', []);
    const seen = new Set();
    const mergedExtra = [...d.extraChests, ...localExtra].filter((c) => {
      const key = `${c?.id || ''}|${c?.type || ''}|${c?.earnedAt || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    saveJSON('lootlinguaExtraChests', mergedExtra);
  }
  if (d.dailyQuestDate === todayStr() && d.dailyQuestState && typeof d.dailyQuestState === 'object') {
    const localQuest = loadJSON(getDailyQuestStorageKey(), { claimed: {}, flags: {} });
    saveJSON(getDailyQuestStorageKey(), {
      claimed: { ...(d.dailyQuestState.claimed || {}), ...(localQuest.claimed || {}) },
      flags: { ...(d.dailyQuestState.flags || {}), ...(localQuest.flags || {}) },
    });
  }
  if (d.displayName) localStorage.setItem('lootlinguaDisplayName', d.displayName);
  if (d.activeTitleId) localStorage.setItem('lootlinguaActiveTitleId', String(d.activeTitleId));
  if (d.theme) {
    const nextTheme = isThemeComingSoon(d.theme) || !isThemeUnlocked(d.theme) ? 'lootlingua' : d.theme;
    if (typeof setTheme === 'function') setTheme(nextTheme, true);
  } else if (typeof refreshThemeLockUI === 'function') {
    refreshThemeLockUI();
  }
  if (typeof evaluateTitleUnlocks === 'function') evaluateTitleUnlocks(false);
  renderStreak();
  renderDailyGoal();
  renderXPBar();
  syncHeroAvatar();
  updateDailyQuestsBadge();
  refreshFeatureUnlockUI();
  if (typeof renderStatsNumbers === 'function' &&
      document.getElementById('statsPanel')?.style.display !== 'none') {
    renderStatsNumbers();
    renderHeatmap();
  }
  } finally {
    window.__applyingCloudProfile = wasApplyingCloudProfile;
  }
};

function normalizeMigrationWordKey(word) {
  return String(word?.word || word?.text || '').toLowerCase().trim();
}

function getGuestMigrationWords() {
  const normal = readWordsFromStorage('normal', 'guest');
  const gamer = readWordsFromStorage('gamer', 'guest');
  const seen = new Set();
  return [...normal, ...gamer].filter((word) => {
    const key = normalizeMigrationWordKey(word);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getGuestProgressSnapshot() {
  return window.getLootlinguaProfilePayload ? window.getLootlinguaProfilePayload() : {};
}

function getGuestProgressSummary(profile) {
  const titles = Array.isArray(profile?.titlesState?.unlocked) ? profile.titlesState.unlocked.length : 0;
  const chests = Number(profile?.dailyLootState?.totalOpens) || 0;
  const stats = [];
  if ((Number(profile?.userXP) || 0) > 0) stats.push({ label: `${profile.userXP} XP`, hint: 'خبرة مخزنة' });
  if ((Number(profile?.dailyStreak) || 0) > 0) stats.push({ label: `${profile.dailyStreak} يوم`, hint: 'سلسلة يومية' });
  if (titles > 0) stats.push({ label: `${titles} ألقاب`, hint: 'إنجازات مفتوحة' });
  if (chests > 0) stats.push({ label: `${chests} صناديق`, hint: 'لوت يومي' });
  if ((Number(profile?.streakFreezes) || 0) > 0) stats.push({ label: `${profile.streakFreezes} تجميد`, hint: 'حماية الستريك' });
  return stats;
}

function hasGuestProgress(profile) {
  return getGuestProgressSummary(profile).length > 0 ||
    (Array.isArray(profile?.addedGameWords) && profile.addedGameWords.length > 0) ||
    (Array.isArray(profile?.extraChests) && profile.extraChests.length > 0);
}

function clearGuestWordsStorage() {
  localStorage.removeItem(getWordsStorageKey('normal', 'guest'));
  localStorage.removeItem(getWordsStorageKey('gamer', 'guest'));
  localStorage.removeItem(getCustomWorldsStorageKey('guest'));
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith(`${WORDS_CUSTOM_PREFIX}guest_`)) localStorage.removeItem(key);
  });
  localStorage.removeItem(LEGACY_DICTIONARY_KEY);
}

function resetGuestProgressState() {
  if (typeof window.resetLootlinguaProfileState === 'function') {
    window.resetLootlinguaProfileState({ clearDisplayName: false, resetTheme: true });
  }
}

function renderGuestMigrationModal(summary) {
  const wordCount = summary.words.length;
  const progressStats = getGuestProgressSummary(summary.profile);
  const msg = document.getElementById('guestMigrationMessage');
  const stats = document.getElementById('guestMigrationStats');
  const confirm = document.getElementById('guestMigrationConfirm');
  const decline = document.getElementById('guestMigrationDeclineBtn');
  const accept = document.getElementById('guestMigrationAcceptBtn');
  if (msg) {
    const progressText = progressStats.length ? ' ولقينا كمان XP وتقدم وألقاب مخزنة' : '';
    msg.textContent = `يا بطل! لقينا ${wordCount} كلمات مخبأة في جهازك${progressText}.. بدك تنقلهم لحسابك الأسطوري الجديد عشان ما يضيعوا؟`;
  }
  if (stats) {
    const allStats = [{ label: `${wordCount} كلمات`, hint: 'قاموس الضيف' }, ...progressStats];
    stats.innerHTML = allStats.map((item) => `<div class="guest-migration-stat">${item.label}<small>${item.hint}</small></div>`).join('');
  }
  if (confirm) confirm.style.display = 'none';
  if (decline) {
    decline.dataset.confirmed = '0';
    decline.textContent = 'لا، ابدأ من جديد';
    decline.disabled = false;
  }
  if (accept) {
    accept.disabled = false;
    accept.textContent = 'نعم، انقل اللوت!';
  }
  showModal('guestMigrationModal');
}

window.prepareGuestMigrationForUser = function(user) {
  if (!user) return Promise.resolve('guest');
  if (window.__guestMigrationPromise && window.__guestMigrationUid === user.uid) {
    return window.__guestMigrationPromise;
  }

  window.__guestMigrationUid = user.uid;

  if (shouldSkipGuestMigrationPrompt(user)) {
    window.__guestMigrationPromise = Promise.resolve('none');
    return window.__guestMigrationPromise;
  }

  const loot = getGuestLootSnapshot();
  const words = loot.words;
  const profile = loot.profile;
  const hasGuestData = hasMeaningfulGuestLoot(loot);
  const shouldPrompt = hasGuestData && (hasDirtyGuestData() || !hasHandledGuestMigrationForUser(user.uid));
  window.__guestMigrationSummary = { words, profile, user };

  if (!shouldPrompt) {
    if (hasMeaningfulGuestLoot(loot)) {
      window.__acceptedGuestProfileMigration = { uid: user.uid, profile };
    }
    if (hasGuestData) purgeStaleGuestLocalData();
    window.__guestMigrationPromise = Promise.resolve('none');
    return window.__guestMigrationPromise;
  }

  window.__guestMigrationPromise = new Promise((resolve) => {
    window.__resolveGuestMigration = resolve;
  });
  renderGuestMigrationModal(window.__guestMigrationSummary);
  return window.__guestMigrationPromise;
};

window.confirmGuestMigration = async function() {
  const summary = window.__guestMigrationSummary;
  const user = summary?.user || window.auth?.currentUser;
  if (!summary || !user) return;

  const accept = document.getElementById('guestMigrationAcceptBtn');
  const decline = document.getElementById('guestMigrationDeclineBtn');
  if (accept) {
    accept.disabled = true;
    accept.textContent = 'جاري نقل اللوت...';
  }
  if (decline) decline.disabled = true;

  try {
    const existing = new Set((window.words || []).map((word) => normalizeMigrationWordKey(word)).filter(Boolean));
    const toMove = summary.words.filter((word) => {
      const key = normalizeMigrationWordKey(word);
      if (!key || existing.has(key)) return false;
      existing.add(key);
      return true;
    });

    let uploaded = 0;
    for (const word of toMove) {
      const realId = window.saveWordToCloud
        ? await window.saveWordToCloud(word.word || word.text, word.category || 'عام', word.meaning || '', word.example || '', word.order ?? 0, word)
        : null;
      if (!realId) throw new Error('cloud-upload-failed');
      window.words.unshift({
        ...word,
        id: realId,
        word: word.word || word.text || '',
        category: word.category || 'عام',
        userId: user.uid,
      });
      uploaded++;
    }

    const guestWorlds = readCustomWorldsFromStorage('guest');
    const migratedWorlds = [];
    for (const world of guestWorlds) {
      const normalizedWorld = normalizeCustomWorldPayload({
        ...world,
        id: world.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      });
      migratedWorlds.push(normalizedWorld);
      if (window.saveCustomWorldToCloud) {
        const savedWorld = await window.saveCustomWorldToCloud(normalizedWorld);
        if (!savedWorld) throw new Error('custom-world-upload-failed');
      }
      const guestWorldWords = readCustomWorldWordsFromStorage(world.id, 'guest');
      const nextWords = [];
      for (const word of guestWorldWords) {
        const copy = { ...word, id: word.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
        if (window.saveCustomWorldWordToCloud) {
          const realId = await window.saveCustomWorldWordToCloud(normalizedWorld.id, copy);
          if (!realId) throw new Error('custom-world-word-upload-failed');
          copy.id = realId;
        }
        nextWords.push(copy);
      }
      writeCustomWorldWordsToStorage(normalizedWorld.id, applyStoredWordOrder(nextWords), user.uid);
    }
    if (migratedWorlds.length) {
      customWorlds = migratedWorlds;
      writeCustomWorldsToStorage(customWorlds, user.uid);
      renderCustomWorldCards();
    }

    writeWordsToStorage(window.words, 'normal', user.uid);
    markGuestMigrationCompleteFlag(user, 'accepted');
    purgeStaleGuestLocalData();
    window.__acceptedGuestProfileMigration = { uid: user.uid, profile: summary.profile };
    saveAndRender();
    hideModal('guestMigrationModal');
    showToast(uploaded > 0 ? `تم نقل ${uploaded} كلمات لحسابك` : 'ما في كلمات جديدة للنقل، وتم حفظ تقدمك', 'success', 4200);
    window.__resolveGuestMigration?.('accepted');
  } catch (err) {
    console.error('guestMigration:', err);
    localStorage.removeItem(GUEST_MIGRATION_COMPLETE_KEY);
    localStorage.removeItem(GUEST_MIGRATION_HANDLED_KEY);
    window.__guestMigrationSessionComplete = false;
    if (accept) {
      accept.disabled = false;
      accept.textContent = 'نعم، انقل اللوت!';
    }
    if (decline) decline.disabled = false;
    showToast('ما قدرنا ننقل اللوت الآن. خليناه محفوظ على الجهاز.', 'danger', 4600);
  }
};

window.declineGuestMigration = function() {
  const decline = document.getElementById('guestMigrationDeclineBtn');
  const confirm = document.getElementById('guestMigrationConfirm');
  if (decline?.dataset.confirmed !== '1') {
    if (decline) {
      decline.dataset.confirmed = '1';
      decline.textContent = 'متأكد، احذف لوت الضيف';
    }
    if (confirm) confirm.style.display = 'block';
    showToast('اضغط تأكيد مرة ثانية إذا بدك تبدأ من جديد بدون نقل.', 'warning', 4200);
    return;
  }
  const user = window.auth?.currentUser;
  markGuestMigrationCompleteFlag(user, 'declined');
  purgeStaleGuestLocalData();
  resetGuestProgressState();
  hideModal('guestMigrationModal');
  showToast('تم تجاهل بيانات الضيف وبدينا صفحة جديدة.', 'info', 3600);
  window.__resolveGuestMigration?.('declined');
};

function beginViewSwitch() {
  document.body.classList.add('view-transitioning');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => document.body.classList.remove('view-transitioning'), 50);
    });
  });
}

// ═══════════════════════════════════════════════════════
// SPAM PROTECTION
// ═══════════════════════════════════════════════════════
const _rateLimits = {};

/**
 * rate-limit any action
 * key: unique name, limit: max calls, windowMs: time window in ms
 * returns true if allowed, false if blocked
 */
function rateLimit(key, limit, windowMs) {
  const now   = Date.now();
  const state = _rateLimits[key] || { calls: [], blocked: false };

  // امسح المكالمات القديمة خارج النافذة
  state.calls = state.calls.filter(t => now - t < windowMs);

  if (state.calls.length >= limit) {
    if (!state.blocked) {
      state.blocked = true;
      const secs = Math.ceil(windowMs / 1000);
      showToast(`تم تجاوز الحد. انتظر ${secs} ث`);
      setTimeout(() => { state.blocked = false; }, windowMs);
    }
    _rateLimits[key] = state;
    return false;
  }

  state.calls.push(now);
  state.blocked = false;
  _rateLimits[key] = state;
  return true;
}

// ═══════════════════════════════════════════════════════
