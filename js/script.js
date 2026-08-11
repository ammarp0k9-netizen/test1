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
  window.__lootlinguaInitialDataReady = false;
};
window.finishInitialFeatureLoad = function() {
  isInitialLoad = false;
  window.isInitialLoad = false;
  window.__suppressUnlockNotices = false;
  window.__initialFeatureLoadPending?.clear?.();
  window.__lootlinguaInitialDataReady = true;
  window.dispatchEvent(new CustomEvent('lootlingua:initial-data-ready', {
    detail: {
      uid: window.auth?.currentUser?.uid || '',
      generation: Number(window.__lootlinguaAuthGeneration) || 0,
    },
  }));
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

window.exitBulkDeleteMode = function(options = {}) {
  if (isReorderMode) isReorderMode = false;
  isBulkDeleteMode = false;
  bulkSelectedWordIds.clear();
  selectedIndices = [];
  document.body.classList.remove('selection-mode-active');
  clearBulkSelectionInDom();
  if (options.renderView !== false) render();
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

function currentThemeIdentity() {
  return window.auth?.currentUser?.uid ? { uid: window.auth.currentUser.uid } : {};
}

function currentThemeOwner() {
  return window.LootLinguaEntryExperience?.storageOwner(currentThemeIdentity()) ||
    (window.auth?.currentUser?.uid ? `user:${window.auth.currentUser.uid}` : 'guest');
}

function currentThemePreferenceKey() {
  return window.LootLinguaEntryExperience?.themeStorageKey(currentThemeIdentity()) ||
    `lootlingua:theme:${currentThemeOwner()}`;
}

function currentOasisModePreferenceKey() {
  return window.LootLinguaEntryExperience?.oasisModeStorageKey(currentThemeIdentity()) ||
    `lootlingua:oasis-mode:${currentThemeOwner()}`;
}

function themeSeenKey(type, theme) {
  return `lootlingua:${type}:theme:${currentThemeOwner()}:${theme}`;
}

function getThemeIntroSeenList() {
  return Object.keys(THEME_USE_MESSAGES).filter((theme) =>
    localStorage.getItem(themeSeenKey('used', theme)) === '1'
  );
}

function showThemeUseMessageOnce(theme) {
  if (!THEME_USE_MESSAGES[theme]) return;
  const intro = window.LootLinguaEntryExperience?.resolveThemeIntro?.(
    getThemeIntroSeenList(),
    theme
  );
  if (intro && !intro.shouldAnnounce) return;
  const key = themeSeenKey('used', theme);
  if (localStorage.getItem(key) === '1') return;
  localStorage.setItem(key, '1');
  requestProfileCloudSave();
  setTimeout(() => showToast(THEME_USE_MESSAGES[theme], 'success', 5200), 2400);
}

function bootstrapThemeNotificationKeysOnce() {
  const bootKey = `lootlingua:themeNotifyBootstrapped:${currentThemeOwner()}`;
  if (localStorage.getItem(bootKey) === '1') return;
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
  const previousTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'lootlingua';
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
  localStorage.setItem(currentThemePreferenceKey(), theme);
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === theme);
  });
  refreshThemeLockUI();
  syncOasisAppearanceControls();
  if (!skipLockCheck && theme !== previousTheme) showThemeUseMessageOnce(theme);
  if (!skipLockCheck) requestProfileCloudSave();
  return true;
};

function loadTheme() {
  const saved = localStorage.getItem(currentThemePreferenceKey()) ||
    (!window.auth?.currentUser ? localStorage.getItem('theme') : '') ||
    'lootlingua';
  let candidate = saved;
  if (isThemeComingSoon(candidate) || !isThemeUnlocked(candidate)) candidate = 'lootlingua';
  setTheme(candidate, true);
  refreshThemeLockUI();
  const savedMode = localStorage.getItem(currentOasisModePreferenceKey()) ||
    localStorage.getItem('lootlinguaOasisMode') || 'light';
  applyOasisMode(savedMode, false);
}

function applyOasisMode(mode, persist = true) {
  const next = mode === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-oasis-mode', next);
  if (persist) {
    localStorage.setItem(currentOasisModePreferenceKey(), next);
    localStorage.setItem('lootlinguaOasisMode', next);
  }
  syncOasisAppearanceControls();
  return next;
}

function syncOasisAppearanceControls() {
  const theme = document.documentElement.getAttribute('data-theme') || 'lootlingua';
  const mode = document.documentElement.getAttribute('data-oasis-mode') || 'light';
  const setting = document.getElementById('profileOasisModeSetting');
  if (setting) setting.hidden = theme !== 'ocean';
  document.querySelectorAll('[data-profile-oasis-mode]').forEach((button) => {
    const selected = button.dataset.profileOasisMode === mode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', selected ? 'true' : 'false');
  });
}

window.setProfileOasisMode = function(mode) {
  if ((document.documentElement.getAttribute('data-theme') || '') !== 'ocean') return false;
  applyOasisMode(mode, true);
  requestProfileCloudSave();
  return true;
};

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
const APP_PROJECT_BASE_PATH = (() => {
  const segments = location.pathname
    .split('/')
    .filter(Boolean);
  if (location.hostname.endsWith('.github.io')) {
    if (!segments.length) return '';
    return segments[1] === 'app' ? `/${segments[0]}/app` : `/${segments[0]}`;
  }
  return segments[0] === 'app' ? '/app' : '';
})();
let appRouteSyncing = false;
let appRoutingReady = false;

function getAppBasePath() {
  return APP_PROJECT_BASE_PATH;
}

function getAppRoutePath(kind, key) {
  if (kind === 'published') {
    const params = key && typeof key === 'object' ? key : {};
    const parts = ['worlds'];
    if (params.worldId) parts.push(encodeURIComponent(params.worldId));
    if (params.rankId) parts.push('ranks', encodeURIComponent(params.rankId));
    if (params.gateId) parts.push('gates', encodeURIComponent(params.gateId));
    return getAppBasePath() + '/' + parts.join('/');
  }
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
  const parts = slug.split('/').filter(Boolean);
  if (parts[0] === APP_VIEW_ROUTES.worlds && parts.length > 1) {
    if (parts.length === 2) {
      return {
        kind: 'published',
        key: 'world',
        params: { worldId: parts[1] }
      };
    }
    if (parts.length === 4 && parts[2] === 'ranks') {
      return {
        kind: 'published',
        key: 'rank',
        params: { worldId: parts[1], rankId: parts[3] }
      };
    }
    if (parts.length === 6 && parts[2] === 'ranks' && parts[4] === 'gates') {
      return {
        kind: 'published',
        key: 'gate',
        params: { worldId: parts[1], rankId: parts[3], gateId: parts[5] }
      };
    }
    return { kind: 'published', key: 'not-found', params: {} };
  }
  if (APP_ROUTE_TO_VIEW[slug]) return { kind: 'view', key: APP_ROUTE_TO_VIEW[slug] };
  if (APP_ROUTE_TO_MODAL[slug]) return { kind: 'modal', key: APP_ROUTE_TO_MODAL[slug] };
  if (APP_ROUTE_TO_OVERLAY[slug]) return { kind: 'overlay', key: APP_ROUTE_TO_OVERLAY[slug] };
  return { kind: 'view', key: 'personal' };
}

function setAppRoute(kind, key, options = {}) {
  if (!appRoutingReady || appRouteSyncing) return;
  const routeKey = kind === 'published' ? (options.params || {}) : key;
  const path = getAppRoutePath(kind, routeKey);
  const state = {
    lootlingua: true,
    kind,
    key,
    ...(kind === 'published' ? { params: routeKey } : {}),
    source: options.source || (options.replace ? 'replace' : 'push')
  };
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

function setPublishedContentRoute(key, params, options = {}) {
  setAppRoute('published', key, { ...options, params });
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
  } else if (route.kind === 'published') {
    if (typeof window.loadPublishedContentRoute === 'function') {
      window.loadPublishedContentRoute(route);
    } else {
      openRouteView('worlds');
    }
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
    const path = getAppRoutePath(
      route.kind,
      route.kind === 'published' ? route.params : route.key
    );
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

let activeModalFocusContext = null;

function getModalFocusableElements(modal) {
  return [...modal.querySelectorAll(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && getComputedStyle(element).display !== 'none');
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (activeModalFocusContext?.modal && activeModalFocusContext.modal !== modal) {
    activeModalFocusContext.modal.removeEventListener('keydown', activeModalFocusContext.trap);
  }
  const returnFocus = document.activeElement;
  const trap = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = getModalFocusableElements(modal);
    if (!focusable.length) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  modal.addEventListener('keydown', trap);
  activeModalFocusContext = { modal, returnFocus, trap };
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  if (!modal.hasAttribute('tabindex')) modal.tabIndex = -1;
  requestAnimationFrame(() => {
    const focusable = getModalFocusableElements(modal);
    (focusable[0] || modal).focus({ preventScroll: true });
  });
  if (APP_MODAL_ROUTES[id]) setAppRoute('modal', id);
}

function hideModal(id) {
  const close = () => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    if (activeModalFocusContext?.modal === modal) {
      modal?.removeEventListener('keydown', activeModalFocusContext.trap);
      const returnFocus = activeModalFocusContext.returnFocus;
      activeModalFocusContext = null;
      if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
    }
  };
  if (APP_MODAL_ROUTES[id]) closeRouteEntry('modal', id, close);
  else close();
}

function findInFlightToast(toastDedupeKey, { includeDeferred = true } = {}) {
  if (!toastDedupeKey) return null;
  const active = window.__toastActive;
  if (active?.toastDedupeKey === toastDedupeKey) return active;
  const queued = window.__toastQueue || [];
  const queuedMatch = queued.find((entry) => entry?.toastDedupeKey === toastDedupeKey);
  if (queuedMatch || !includeDeferred) return queuedMatch || null;
  const deferred = window.__entryDeferredToastQueue || [];
  return deferred.find((entry) => entry?.toastDedupeKey === toastDedupeKey) || null;
}

function displayNextToast() {
  const t = document.getElementById('toastMessage');
  const queue = window.__toastQueue || (window.__toastQueue = []);
  if (!t || window.__toastActive || queue.length === 0) return;
  const entry = queue.shift();
  window.__toastActive = entry;
  const content = document.createElement('span');
  content.className = 'toast-text';
  content.textContent = entry.preview;
  t.replaceChildren(content);
  if (entry.notificationId) {
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'toast-details-btn';
    details.textContent = 'التفاصيل';
    details.addEventListener('click', (event) => {
      window.openNotificationDetails?.(entry.notificationId, event);
    });
    t.append(details);
  }
  t.classList.toggle('toast-interactive', Boolean(entry.notificationId));
  t.classList.remove(
    'show',
    'toast-success', 'toast-warning', 'toast-danger', 'toast-info',
    'toast-attention-shake'
  );
  t.classList.add(
    entry.type === 'success' ? 'toast-success' :
      entry.type === 'danger' ? 'toast-danger' :
        entry.type === 'warning' ? 'toast-warning' : 'toast-info'
  );
  // Commit the centered, off-screen state before starting the vertical entrance.
  // This also makes queued toasts restart the same animation reliably.
  void t.offsetWidth;
  t.classList.add('show');
  if (entry.type === 'warning' || entry.type === 'danger') {
    t.classList.add('toast-attention-shake');
    triggerAttentionFeedback(document.querySelector('.main-content') || document.body);
  }
  clearTimeout(window.__toastHideTimer);
  window.__toastHideTimer = setTimeout(() => {
    t.classList.remove('show');
    clearTimeout(window.__toastTransitionTimer);
    window.__toastTransitionTimer = setTimeout(() => {
      window.__toastActive = null;
      displayNextToast();
    }, 430);
  }, entry.duration);
}

function showToast(msg, type = 'info', duration = 2500, options = {}) {
  const settings = duration && typeof duration === 'object'
    ? duration
    : (options && typeof options === 'object' ? options : {});
  const displayDuration = duration && typeof duration === 'object'
    ? Number(duration.duration)
    : Number(duration);
  const fullText = String(settings.fullText || settings.details || msg || '').trim();
  if (!fullText) return '';
  const toastDedupeKey = window.LootLinguaNotificationPolicy?.toastDedupeKey(fullText, type, settings) || (
    settings.toastDedupe === false
      ? ''
      : `toast:${String(settings.toastDedupeKey || `${type}:${fullText}`).replace(/\s+/g, ' ').trim().toLowerCase()}`
  );
  const notificationId = window.recordNotificationForToast?.(
    fullText,
    type,
    settings
  ) || '';
  const duplicate = findInFlightToast(toastDedupeKey);
  if (duplicate) return notificationId || duplicate.notificationId || '';
  const preview = window.LootLinguaNotificationPolicy?.toastPreview(fullText) || fullText;
  const queuedEntry = {
    preview,
    type,
    duration: Math.min(12000, Math.max(1200, displayDuration || 2500)),
    notificationId,
    toastDedupeKey,
  };
  if (window.__entryExperienceActive && type !== 'danger' && settings.critical !== true) {
    const deferred = window.__entryDeferredToastQueue || (window.__entryDeferredToastQueue = []);
    deferred.push(queuedEntry);
    if (deferred.length > 12) deferred.splice(0, deferred.length - 12);
    return notificationId;
  }
  const queue = window.__toastQueue || (window.__toastQueue = []);
  queue.push(queuedEntry);
  if (queue.length > 20) queue.splice(0, queue.length - 20);
  displayNextToast();
  return notificationId;
}

window.flushDeferredEntryToasts = function() {
  const deferred = window.__entryDeferredToastQueue || [];
  if (!deferred.length) return;
  const queue = window.__toastQueue || (window.__toastQueue = []);
  // The full messages already live in Notification Center. Surface only one
  // low-priority preview after Entry so completion never releases a toast storm.
  const pending = deferred.splice(0, deferred.length);
  const first = pending.find(
    (candidate) => !findInFlightToast(candidate?.toastDedupeKey, { includeDeferred: false })
  );
  if (first) queue.push(first);
  if (queue.length > 20) queue.splice(0, queue.length - 20);
  displayNextToast();
};

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
function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function previousLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}
function localDayBounds(value = new Date()) {
  const start = value instanceof Date ? new Date(value) : new Date(value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startAt: start.getTime(), endAt: end.getTime() };
}
function todayStr() { return localDateKey(new Date()); }
window.LootLinguaLocalTime = Object.freeze({ localDateKey, previousLocalDateKey, localDayBounds });

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
    theme:            document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'lootlingua',
    oasisMode:        document.documentElement.getAttribute('data-oasis-mode') || 'light',
    themeIntroSeen:   getThemeIntroSeenList(),
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
  if (clearDisplayName) localStorage.removeItem('lootlinguaDisplayName');
  if (resetTheme) {
    localStorage.setItem('theme', 'lootlingua');
    document.documentElement.setAttribute('data-theme', 'lootlingua');
    syncOasisAppearanceControls();
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
  if (Array.isArray(d.themeIntroSeen)) {
    d.themeIntroSeen.slice(0, 12).forEach((theme) => {
      if (Object.prototype.hasOwnProperty.call(THEME_USE_MESSAGES, theme)) {
        localStorage.setItem(themeSeenKey('used', theme), '1');
      }
    });
  }
  if (d.theme) {
    const nextTheme = isThemeComingSoon(d.theme) || !isThemeUnlocked(d.theme) ? 'lootlingua' : d.theme;
    if (typeof setTheme === 'function') setTheme(nextTheme, true);
  } else if (typeof refreshThemeLockUI === 'function') {
    refreshThemeLockUI();
  }
  if (d.oasisMode) applyOasisMode(d.oasisMode, true);
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
  const mastery = typeof readSharedWordMasteryStore === 'function'
    ? readSharedWordMasteryStore('guest')
    : {};
  const seen = new Set();
  return [...normal, ...gamer].filter((word) => {
    const key = normalizeMigrationWordKey(word);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((word) => {
    if (typeof getWordMasteryKey !== 'function' || typeof mergePermanentWordMasteryState !== 'function') return word;
    const key = getWordMasteryKey(word);
    return mastery[key] ? { ...word, ...mergePermanentWordMasteryState(word, mastery[key]) } : word;
  });
}

function getGuestProgressSnapshot() {
  // Legacy profile keys (XP, streak, titles...) are unscoped. They are safe to
  // treat as guest-owned only when a signed-out write marked that namespace as
  // dirty. Account hydration also uses these keys and is not guest evidence.
  if (typeof hasDirtyGuestData !== 'function' || !hasDirtyGuestData()) return {};
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
    decline.textContent = 'ليس الآن، احتفظ به هنا';
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
  const guestSnapshotId = ensureGuestMigrationSnapshotId(loot);
  const words = loot.words;
  const profile = loot.profile;
  const hasGuestData = hasMeaningfulGuestLoot(loot);
  // Presence of meaningful guest data is the authoritative signal. Legacy
  // releases could create it without invalidating handled/completed markers,
  // so reusing those markers here could silently purge a newer snapshot.
  const shouldPrompt = hasGuestData;
  window.__guestMigrationSummary = { ...loot, words, profile, user, guestSnapshotId };

  if (!shouldPrompt) {
    window.__guestMigrationPromise = Promise.resolve('none');
    return window.__guestMigrationPromise;
  }

  window.__guestMigrationPromise = new Promise((resolve) => {
    window.__resolveGuestMigration = resolve;
  });
  window.__guestMigrationSessionDecision = {
    uid: user.uid,
    guestSnapshotId,
    status: 'prompted',
  };
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
    if (window.auth?.currentUser?.uid !== user.uid) {
      const identityError = new Error('Authenticated user changed during guest migration');
      identityError.code = 'auth/identity-changed';
      throw identityError;
    }
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
        ? await window.saveWordToCloud(
          word.word || word.text,
          word.category || 'عام',
          word.meaning || '',
          word.example || '',
          word.order ?? 0,
          {
            ...word,
            lifecycleSource: { type: 'import', importId: 'guest-migration' },
            operationId: 'guest-migration',
          }
        )
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

    const guestWorlds = dedupeCustomWorlds([
      ...readCustomWorldsFromStorage('guest'),
      ...(Array.isArray(summary.pendingCustomWorlds) ? summary.pendingCustomWorlds : []),
    ]);
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

    const guestMastery = summary.wordMastery && typeof summary.wordMastery === 'object'
      ? summary.wordMastery
      : {};
    for (const [wordKey, state] of Object.entries(guestMastery)) {
      if (!wordKey || !state || typeof window.saveGlobalWordMasteryToCloud !== 'function') continue;
      const saved = await window.saveGlobalWordMasteryToCloud(wordKey, state);
      if (!saved) throw new Error('word-mastery-upload-failed');
    }
    if (Object.keys(guestMastery).length && typeof window.applyGlobalWordMasterySnapshot === 'function') {
      window.applyGlobalWordMasterySnapshot(guestMastery);
    }

    const guestQuizSession = summary.activeQuizSession || loadJSON('active_quiz_session', null);
    if (
      guestQuizSession &&
      typeof isResumableQuizSession === 'function' &&
      isResumableQuizSession(guestQuizSession) &&
      typeof window.saveActiveQuizSessionToCloud === 'function'
    ) {
      const accountQuizSession = typeof window.loadActiveQuizSessionFromCloud === 'function'
        ? await window.loadActiveQuizSessionFromCloud()
        : null;
      if (accountQuizSession && isResumableQuizSession(accountQuizSession)) {
        localStorage.setItem(
          `lootlingua:migrated-quiz-draft:${user.uid}`,
          JSON.stringify(guestQuizSession)
        );
      } else {
        const saved = await window.saveActiveQuizSessionToCloud(guestQuizSession);
        if (!saved) throw new Error('quiz-session-upload-failed');
      }
    }

    writeWordsToStorage(window.words, 'normal', user.uid);
    const profileMigrationKey = window.LootLinguaEntryExperience?.profileMigrationStorageKey({ uid: user.uid }) ||
      `lootlingua:guest-profile-migration:v1:user:${user.uid}`;
    let previousProfileMigration = null;
    try {
      previousProfileMigration = JSON.parse(localStorage.getItem(profileMigrationKey) || 'null');
    } catch (_) {}
    const previousProfiles = previousProfileMigration?.uid === user.uid
      ? (
        Array.isArray(previousProfileMigration.profiles)
          ? previousProfileMigration.profiles
          : [previousProfileMigration.profile]
      ).filter((profile) => profile && typeof profile === 'object' && !Array.isArray(profile))
      : [];
    const currentGuestProfile = summary.profile && typeof summary.profile === 'object'
      ? summary.profile
      : {};
    const isSameProfile = (left, right) => {
      try { return JSON.stringify(left) === JSON.stringify(right); } catch (_) { return false; }
    };
    const uniquePreviousProfiles = previousProfiles.filter(
      (profile, index, profiles) => profiles.findIndex((item) => isSameProfile(item, profile)) === index
    );
    const acceptedProfileMigration = {
      version: 1,
      uid: user.uid,
      profile: currentGuestProfile,
      profiles: isSameProfile(uniquePreviousProfiles[uniquePreviousProfiles.length - 1], currentGuestProfile)
        ? uniquePreviousProfiles
        : [...uniquePreviousProfiles, currentGuestProfile],
      createdAt: Number(previousProfileMigration?.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };
    // The learning uploads above and this account-scoped recovery record must
    // both exist before the guest namespace is purged. profile-cloud removes
    // the recovery record only after the merged profile is durably saved.
    localStorage.setItem(profileMigrationKey, JSON.stringify(acceptedProfileMigration));
    window.__acceptedGuestProfileMigration = acceptedProfileMigration;
    const profileCommitted = typeof window.commitPendingGuestProfileMigration === 'function'
      ? await window.commitPendingGuestProfileMigration(user)
      : false;
    if (!profileCommitted) {
      const profileError = new Error('guest-profile-commit-failed');
      profileError.code = window.__lootlinguaLastProfileSaveFailure?.code || 'profile/commit-failed';
      throw profileError;
    }
    const notificationsMigrated = await window.LootLinguaNotificationStore?.migrateGuestToOwner?.(user.uid);
    if (notificationsMigrated === false) {
      const notificationError = new Error('guest-notification-migration-failed');
      notificationError.code = 'notification/migration-failed';
      throw notificationError;
    }
    markGuestMigrationCompleteFlag(user, 'accepted', summary.guestSnapshotId);
    purgeStaleGuestLocalData();
    saveAndRender();
    hideModal('guestMigrationModal');
    showToast(uploaded > 0 ? `تم نقل ${uploaded} كلمات لحسابك` : 'ما في كلمات جديدة للنقل، وتم حفظ تقدمك', 'success', 4200);
    window.__resolveGuestMigration?.('accepted');
  } catch (err) {
    console.error('guestMigration:', err);
    localStorage.removeItem(GUEST_MIGRATION_COMPLETE_KEY);
    localStorage.removeItem(GUEST_MIGRATION_HANDLED_KEY);
    window.__guestMigrationSessionComplete = false;
    window.__guestMigrationSessionDecision = {
      uid: user.uid,
      guestSnapshotId: summary.guestSnapshotId,
      status: 'failed',
    };
    if (accept) {
      accept.disabled = false;
      accept.textContent = 'نعم، انقل اللوت!';
    }
    if (decline) decline.disabled = false;
    showToast('ما قدرنا ننقل اللوت الآن. خليناه محفوظ على الجهاز.', 'danger', 4600);
  }
};

window.declineGuestMigration = function() {
  const summary = window.__guestMigrationSummary;
  const user = window.auth?.currentUser;
  if (!user?.uid || summary?.user?.uid !== user.uid || !summary?.guestSnapshotId) return;
  markGuestMigrationCompleteFlag(user, 'declined', summary.guestSnapshotId);
  hideModal('guestMigrationModal');
  showToast('احتفظنا بلوت الضيف على هذا الجهاز، ولن نسألك عنه مجددًا لهذا الحساب.', 'info', 4200);
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
