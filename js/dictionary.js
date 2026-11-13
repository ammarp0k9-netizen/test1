function normalizeWord(w) {
  return String(w||'').toLowerCase().trim().replace(/\s+/g,' ');
}
function wordExists(text) {
  return wordExistsInWords(text, getPersonalDictionaryWordsSnapshot());
}
function wordExistsInWords(text, sourceWords) {
  const k = normalizeWord(text);
  return Boolean(k) && (Array.isArray(sourceWords) ? sourceWords : [])
    .some(w => normalizeWord(w.word || w.text) === k);
}
function activeDictionaryWordExists(text) {
  return wordExistsInWords(text, getActiveDictionaryWords());
}
function getWordLifecycleContract() {
  return window.LootLinguaWordLifecycle;
}
function findActiveDictionaryWord(text) {
  const lifecycle = getWordLifecycleContract();
  return lifecycle?.findUserWordByKey
    ? lifecycle.findUserWordByKey(getActiveDictionaryWords(), text)
    : getActiveDictionaryWords().find(w => normalizeWord(w.word || w.text) === normalizeWord(text)) || null;
}
function isDictionaryWordHidden(word) {
  // In the personal add flow a moved word is restorable, not an already
  // visible duplicate. Its membership remains visible inside its own world.
  if (isCustomWorldView()) return false;
  return word?.hiddenFromDictionary === true || getWordLifecycleContract()?.isHiddenFromDictionary?.(word) === true ||
    word?.personalDictionaryState === 'moved-to-private-world';
}
function getActiveDictionaryMessageLabel() {
  return isCustomWorldView() ? 'هذا العالم' : 'قاموسك الشخصي';
}

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeClassToken(v) {
  return String(v ?? 'عام').replace(/[^\w\u0600-\u06FF-]/g, '_');
}

// ── Stats Panel ───────────────────────────────────────
let statsPanelRequest = 0;
let statsPanelHideTimer = null;
window.cancelPendingStatsPanel = function() { statsPanelRequest++; clearTimeout(statsPanelHideTimer); };
async function openStatsPanel() {
  const request = ++statsPanelRequest;
  const owner = window.auth?.currentUser?.uid || 'guest';
  const generation = Number(window.__lootlinguaAuthGeneration) || 0;
  if (await window.LootLinguaDictionaryPages?.requireComplete() === false) return;
  if (request !== statsPanelRequest || owner !== (window.auth?.currentUser?.uid || 'guest') ||
      generation !== (Number(window.__lootlinguaAuthGeneration) || 0)) return;
  const p=document.getElementById('statsPanel'); if(!p)return;
  clearTimeout(statsPanelHideTimer);
  lockBackgroundScroll('stats');
  p.style.display='flex'; p.setAttribute('aria-hidden', 'false');
  setTimeout(()=>{ if (request === statsPanelRequest) p.classList.add('show'); },10);
  window.LootLinguaModalFocus?.open(p, { dialog: p.querySelector('.stats-box') || p, onEscape: closeStatsPanel });
  renderHeatmap(); renderStatsNumbers();
  setAppRoute('overlay', 'stats');
}
function closeStatsPanel(silent = false) {
  statsPanelRequest++;
  const close = () => {
    const p=document.getElementById('statsPanel'); if(!p)return;
    p.classList.remove('show');
    p.setAttribute('aria-hidden', 'true');
    unlockBackgroundScroll('stats');
    window.LootLinguaModalFocus?.close(p);
    clearTimeout(statsPanelHideTimer);
    statsPanelHideTimer = setTimeout(()=>p.style.display='none',300);
  };
  if (silent === true) close();
  else {
    window.dispatchEvent(new CustomEvent('lootlingua:profile-guide-closed'));
    closeRouteEntry('overlay', 'stats', close);
  }
}
function renderHeatmap() {
  const container=document.getElementById('heatmapGrid'); if(!container)return;
  const map  =loadJSON('activityMap',{});
  const today=new Date(); const days=365;
  const start=new Date(today); start.setDate(start.getDate()-days+1);
  const vals =Object.values(map).filter(v=>v>0);
  const maxV =vals.length?Math.max(...vals):1;
  container.innerHTML='';
  const frag=document.createDocumentFragment();
  for(let i=0;i<days;i++){
    const d=new Date(start); d.setDate(d.getDate()+i);
    const key=localDateKey(d);
    const cnt=map[key]||0;
    const cell=document.createElement('div'); cell.className='hm-cell';
    // level 0 = no activity, 1-4 = intensity
    cell.dataset.level = cnt===0 ? 0 : Math.ceil((cnt/maxV)*4);
    cell.title=key+' — '+cnt+' كلمة';
    frag.appendChild(cell);
  }
  container.appendChild(frag);
}
function renderStatsNumbers() {
  const run = () => renderStatsNumbersFromData();
  return typeof window.withWordMasterySnapshot === 'function' ? window.withWordMasterySnapshot(run) : run();
}
function renderStatsNumbersFromData() {
  const personalWords = getPersonalDictionaryWordsSnapshot();
  const map =loadJSON('activityMap',{});
  const vals=Object.values(map).filter(v=>v>0);
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  s('statTotal',   personalWords.length);
  s('statStreak',  dailyStreak+' يوم');
  s('statStarred', personalWords.filter(w=>w.starred).length);
  s('statForgot',  personalWords.filter(w => getWordMasteryState(w).mastery_status === 'Mastered').length);
  s('statDays',    Object.keys(map).filter(k=>map[k]>0).length+' يوم');
  s('statBest',    (vals.length?Math.max(...vals):0)+' كلمات');
}

// ═══════════════════════════════════════════════════════
// Save & Render helpers
// ═══════════════════════════════════════════════════════
function persistDictionary() {
  if (dictionarySortMode === 'auto' && Array.isArray(window.words) &&
      (!window.LootLinguaDictionaryPages?.current() || window.LootLinguaDictionaryPages.current().state().complete)) {
    reindexWordOrder(window.words);
  }
  writeActiveWordsToStorage(window.words);
  window.dispatchEvent(new CustomEvent('lootlingua:learning-data-changed', {
    detail: { source: 'dictionary-save' },
  }));
  if (typeof evaluateTitleUnlocks === 'function') evaluateTitleUnlocks(false);
  refreshFeatureUnlockUI();
}

function saveAndRender() {
  persistDictionary();
  if (!isReorderMode && !isBulkDeleteMode) selectedIndices = [];
  renderLimit = 20; // العودة للحد الأول عند الحفظ
  render();
  if (isJsonImportBatchActive()) return;
}
window.saveAndRender = saveAndRender;

function wordsSnapshotNeedsFullRender(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (String(a?.id) !== String(b?.id)) return true;
    if ((a?.word || '') !== (b?.word || '')) return true;
    if ((a?.meaning || '') !== (b?.meaning || '')) return true;
    if ((a?.example || '') !== (b?.example || '')) return true;
    if ((a?.category || '') !== (b?.category || '')) return true;
    if ((a?.partOfSpeech || '') !== (b?.partOfSpeech || '')) return true;
    if ((a?.definition || '') !== (b?.definition || '')) return true;
    if ((a?.definition_ar || '') !== (b?.definition_ar || '')) return true;
    if ((a?.exampleTranslation || '') !== (b?.exampleTranslation || '')) return true;
    if ((a?.level || '') !== (b?.level || '')) return true;
    if (JSON.stringify(a?.tags || []) !== JSON.stringify(b?.tags || [])) return true;
    if (JSON.stringify(a?.synonyms || []) !== JSON.stringify(b?.synonyms || [])) return true;
    if ((a?.pronunciation || '') !== (b?.pronunciation || '')) return true;
    if ((a?.notes || '') !== (b?.notes || '')) return true;
    if (Boolean(a?.hiddenFromDictionary) !== Boolean(b?.hiddenFromDictionary)) return true;
    if ((a?.personalDictionaryState || 'active') !== (b?.personalDictionaryState || 'active')) return true;
    if ((a?.hiddenFromDictionaryAt || null) !== (b?.hiddenFromDictionaryAt || null)) return true;
    if ((a?.order ?? null) !== (b?.order ?? null)) return true;
    if ((a?.createdAt || '') !== (b?.createdAt || '')) return true;
  }
  return false;
}

function syncWordMetaInDom() {
  if (!Array.isArray(window.words)) return;
  const byId = new Map(window.words.map(word => [String(word.id), word]));
  document.querySelectorAll('#list [data-action="star"]').forEach((starBtn) => {
    const word = byId.get(starBtn.dataset.id);
    if (!word) return;
    starBtn.classList.toggle('active', !!word.starred);
    starBtn.setAttribute('aria-pressed', String(Boolean(word.starred)));
  });
}

window.applyCloudWordsFromSnapshot = function(cloudWords, options = {}) {
  const prev = Array.isArray(window.words) ? window.words : [];
  const uid = window.auth?.currentUser?.uid;
  let normalized = options.paged ? [...cloudWords].sort((a, b) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)) : applyStoredWordOrder(cloudWords);
  if (!isCustomWorldView()) {
    const expanded = new Set(prev.filter(word => word.expanded).map(word => String(word.id)));
    normalized = normalized.map(word => ({ ...word, expanded: expanded.has(String(word.id)) }));
  }
  if (!isCustomWorldView()) {
    loadDictionarySortPrefs();
  }
  if (!isCustomWorldView() && dictionarySortMode !== 'auto') {
    normalized = sortDictionaryWords(normalized);
  }
  if (isCustomWorldView()) {
    if (typeof window.writeWordsToStorage === 'function') {
      window.writeWordsToStorage(normalized, 'normal', uid);
    }
    return;
  }
  window.words = normalized;
  if (typeof window.writeWordsToStorage === 'function') {
    window.writeWordsToStorage(normalized, 'normal', uid);
  }
  const needsFullRender =
    wordsSnapshotNeedsFullRender(prev, normalized) ||
    currentView !== 'personal' ||
    isReorderMode ||
    isBulkDeleteMode;
  if (needsFullRender) {
    renderLimit = 20;
    if (currentView === 'personal') render();
    else refreshFeatureUnlockUI();
    return;
  }
  refreshFeatureUnlockUI();
  syncWordMetaInDom();
};

function clearInputs() {
  ['wordInput','meaningInput','exampleInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const cat = document.getElementById('categoryInput');
  if (cat) cat.value = 'عام';
  setCategoryDropdownValue('عام');
  const list = document.getElementById('suggestionsList');
  if (list) list.innerHTML = '';
  const box = document.getElementById('suggestionsBox');
  if (box) box.style.display = 'none';
  resetActiveAddFormDraft();
}

async function saveActiveWordToCloud(word) {
  if (isCustomWorldView()) {
    return window.saveCustomWorldWordToCloud
      ? await window.saveCustomWorldWordToCloud(activeCustomWorldId, word)
      : null;
  }
  return window.saveWordToCloud
    ? await window.saveWordToCloud(word.word, word.category || 'عام', word.meaning || '', word.example || '', word.order ?? 0, word)
    : null;
}

function captureDictionaryWriteContext() {
  return {
    owner: window.auth?.currentUser?.uid || 'guest',
    generation: Number(window.__lootlinguaAuthGeneration) || 0,
    scope: getActiveDictionaryStorageScope(),
    worldId: isCustomWorldView() ? String(activeCustomWorldId) : '',
    view: currentView,
  };
}

function isDictionaryWriteContextCurrent(context) {
  return context.owner === (window.auth?.currentUser?.uid || 'guest') &&
    context.generation === (Number(window.__lootlinguaAuthGeneration) || 0) &&
    context.scope === getActiveDictionaryStorageScope() && context.view === currentView;
}

function dictionaryWriteErrorMessage(error) {
  if (error?.code === 'resource-exhausted') return 'بلغت السحابة حصة الاستخدام أو حد الطلبات. لم نؤكد حفظ الكلمة؛ بقيت المدخلات للمحاولة لاحقًا.';
  if (error?.code === 'permission-denied') return 'رفضت السحابة حفظ الكلمة لهذا الحساب. أعد تسجيل الدخول وحاول مجددًا؛ بقيت المدخلات محفوظة هنا.';
  if (['unavailable', 'deadline-exceeded', 'dictionary/offline'].includes(error?.code)) return 'تعذّر الاتصال بالسحابة لحفظ الكلمة. بقيت المدخلات للمحاولة عند عودة الاتصال.';
  if (['auth/identity-changed', 'word-lifecycle/sign-in-required'].includes(error?.code)) return 'تغيّرت جلسة الحساب. افتح القاموس من حسابك الحالي وحاول مجددًا.';
  if (error?.code === 'dictionary/identity-change') return 'هذا التعديل يغيّر هوية الكلمة وتقدمها. أضف الكلمة المختلفة ككلمة جديدة؛ بقيت الحقول كما هي.';
  if (error?.code === 'dictionary/invalid-patch') return 'تعذّر حفظ هذه القيم. تحقق من طول الحقول وصحتها؛ بقيت المدخلات للمحاولة مجددًا.';
  return 'تعذّر حفظ الكلمة الآن. بقيت المدخلات للمحاولة مجددًا.';
}

async function updateActiveWordInCloud(id, data, context = captureDictionaryWriteContext()) {
  if (!isDictionaryWriteContextCurrent(context)) throw Object.assign(new Error('Dictionary context changed.'), { code: 'dictionary/context-changed' });
  if (context.owner === 'guest') return true;
  const update = context.worldId ? window.updateCustomWorldDictionaryWordInCloud : window.updateDictionaryWordInCloud;
  if (typeof update !== 'function') throw Object.assign(new Error('Dictionary writer unavailable.'), { code: 'dictionary/unavailable' });
  const saved = await (context.worldId ? update(context.worldId, id, data) : update(id, data));
  if (saved !== true) throw Object.assign(new Error('Dictionary write was not acknowledged.'), { code: 'dictionary/save-failed' });
  return true;
}

async function deleteActiveWordFromCloud(id) {
  if (isCustomWorldView()) {
    if (!window.deleteCustomWorldWordFromCloud) return !hasSignedInUser();
    const word = window.words.find((item) => String(item.id) === String(id));
    return await window.deleteCustomWorldWordFromCloud(activeCustomWorldId, id, word);
  }
  if (!window.deleteWordFromCloud) return !hasSignedInUser();
  return await window.deleteWordFromCloud(id);
}

async function deleteWordFromCapturedScope(id, customWorldId, word, sourceSummary, options = {}) {
  if (!hasSignedInUser()) return true;
  if (customWorldId) {
    if (!window.deleteCustomWorldWordFromCloud) return false;
    return await window.deleteCustomWorldWordFromCloud(customWorldId, id, word, options);
  }
  if (window.deletePersonalUserWord) {
    const result = await window.deletePersonalUserWord(id, word, sourceSummary);
    return result?.deleted === true;
  }
  if (!window.deleteWordFromCloud) return false;
  return await window.deleteWordFromCloud(id);
}

async function restoreExistingDictionaryWord(existingWord, incomingWord, sourceType = 'manual') {
  if (!existingWord) return null;
  const context = captureDictionaryWriteContext();
  let result = null;
  if (hasSignedInUser()) {
    if (!window.upsertUserWordWithSource) throw new Error('Dictionary restoration unavailable.');
    result = await window.upsertUserWordWithSource({
      word: { ...incomingWord, id: existingWord.id },
      existingWordId: existingWord.id,
      source: { type: sourceType },
      restoreHidden: true,
      personalDictionaryState: 'active',
      operationId: `${sourceType}:restore`,
    });
    if (!isDictionaryWriteContextCurrent(context)) throw Object.assign(new Error('Dictionary context changed.'), { code: 'dictionary/context-changed' });
    if (!result?.wordId || result.failed) throw new Error('Dictionary restoration was not acknowledged.');
  } else {
    result = {
      status: 'restored',
      restored: true,
      wordId: existingWord.id,
      wordKey: getWordLifecycleContract()?.wordKeyOf?.(existingWord) || '',
    };
  }
  const previousWords = window.words;
  window.words = window.words.map((word) => String(word.id) === String(existingWord.id)
    ? {
      ...word,
      hiddenFromDictionary: false,
      hiddenFromDictionaryAt: null,
      personalDictionaryState: 'active',
      meaning: word.meaning || incomingWord.meaning || '',
      example: word.example || incomingWord.example || '',
      category: word.category && word.category !== 'عام'
        ? word.category
        : (incomingWord.category || word.category || 'عام'),
    }
    : word);
  try { persistDictionary(); }
  catch (error) {
    if (context.owner === 'guest') {
      const stored = readWordsFromStorage('normal', 'guest');
      if (!stored.some(word => String(word.id) === String(existingWord.id) && word.hiddenFromDictionary === false)) {
        window.words = previousWords;
        throw error;
      }
    }
    console.warn('[Dictionary] Restored; optional local refresh failed.', error?.message);
  }
  return result;
}

window.restoreDictionaryWordById = function(wordId, options = {}) {
  const scope = `dictionary-restore:${String(wordId || '')}`;
  const runner = window.LootLinguaOperations?.runExclusive || ((key, task) => task());
  return runner(scope, async () => {
    if (await window.LootLinguaDictionaryPages?.requireComplete() === false) return null;
    const personalWords = readWordsFromStorage('normal', window.auth?.currentUser?.uid);
    const existing = personalWords.find((word) => String(word.id) === String(wordId));
    if (!existing) return null;
    if (hasSignedInUser()) await window.restoreUserWordToDictionary?.(existing.id);
    const restored = { ...existing, hiddenFromDictionary: false, hiddenFromDictionaryAt: null };
    const next = personalWords.map((word) => String(word.id) === String(existing.id) ? restored : word);
    writeWordsToStorage(next, 'normal', window.auth?.currentUser?.uid);
    if (!isCustomWorldView()) window.words = next;
    if (currentView === 'personal') render();
    if (options.notify !== false) {
      showToast(`تمت استعادة كلمة ”${existing.word || existing.text}“ إلى قاموسك، وتقدمها السابق محفوظ.`, 'success', 4800);
    }
    return restored;
  });
};

let isExpanded = false;
window.isExpanded = isExpanded;
const addFormDrafts = new Map();
const normalSearchRecords = new Map();
const normalSearchRequests = new Map();
const DICTIONARY_DRAFT_PREFIX = 'lootlingua:dictionary-draft:v1:';
const DICTIONARY_SEARCH_PREFIX = 'lootlingua:dictionary-search:v1:';

function getAddFormDraftScope() {
  const uid = window.auth?.currentUser?.uid;
  const owner = uid ? `user:${uid}` : 'guest';
  return `${owner}:${isCustomWorldView() ? `custom:${activeCustomWorldId}` : 'personal'}`;
}

function readDictionaryDraft(records, prefix, scope) {
  if (records.has(scope)) return records.get(scope);
  try { return JSON.parse(localStorage.getItem(prefix + scope) || 'null'); }
  catch (_) { return null; }
}

function writeDictionaryDraft(records, prefix, scope, value) {
  records.set(scope, value);
  try {
    if (value) localStorage.setItem(prefix + scope, JSON.stringify(value));
    else localStorage.removeItem(prefix + scope);
  } catch (_) { /* Keep the current tab usable when storage is unavailable. */ }
}

function readAddFormDraftFromDom() {
  return {
    word: document.getElementById('wordInput')?.value || '',
    meaning: document.getElementById('meaningInput')?.value || '',
    example: document.getElementById('exampleInput')?.value || '',
    category: document.getElementById('categoryInput')?.value || 'عام',
    expanded: Boolean(isExpanded),
  };
}

function writeAddFormDraftToDom(draft = {}) {
  window.__restoringAddFormDraft = true;
  try {
    const wordInput = document.getElementById('wordInput');
    const meaningInput = document.getElementById('meaningInput');
    const exampleInput = document.getElementById('exampleInput');
    if (wordInput) wordInput.value = draft.word || '';
    if (meaningInput) meaningInput.value = draft.meaning || '';
    if (exampleInput) exampleInput.value = draft.example || '';
    setCategoryDropdownValue(draft.category || 'عام');
    setAddFormExpanded(Boolean(draft.expanded));
    const list = document.getElementById('suggestionsList');
    if (list) list.innerHTML = '';
    const box = document.getElementById('suggestionsBox');
    if (box) box.style.display = 'none';
    resetAddFormEditState();
  } finally {
    window.__restoringAddFormDraft = false;
  }
}

function resetAddFormEditState() {
  editId = null;
  const btn = document.getElementById('addBtn');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = 'إضافة للقاموس <i class="fa-solid fa-floppy-disk"></i>';
  btn.style.background = '';
}

window.saveActiveAddFormDraft = function() {
  if (window.__restoringAddFormDraft || !isEditableDictionaryView()) return;
  writeDictionaryDraft(addFormDrafts, DICTIONARY_DRAFT_PREFIX, getAddFormDraftScope(), readAddFormDraftFromDom());
};

function restoreActiveAddFormDraft() {
  const scope = getAddFormDraftScope();
  writeAddFormDraftToDom(readDictionaryDraft(addFormDrafts, DICTIONARY_DRAFT_PREFIX, scope) || {});
  restoreNormalSearch(scope);
}

function resetActiveAddFormDraft() {
  const scope = getAddFormDraftScope();
  writeDictionaryDraft(addFormDrafts, DICTIONARY_DRAFT_PREFIX, scope, null);
  writeDictionaryDraft(normalSearchRecords, DICTIONARY_SEARCH_PREFIX, scope, null);
}

function initAddFormDraftTracking() {
  ['wordInput', 'meaningInput', 'exampleInput'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.draftTracked === '1') return;
    el.dataset.draftTracked = '1';
    el.addEventListener('input', () => {
      window.saveActiveAddFormDraft();
      if (id === 'wordInput' && isEditableDictionaryView()) renderNormalSearch(getAddFormDraftScope());
      if (id === 'meaningInput' && isEditableDictionaryView() && !isCustomWorldView()) {
        window.dispatchEvent(new CustomEvent('lootlingua:dictionary-meaning-edited'));
      }
    });
    el.addEventListener('change', () => window.saveActiveAddFormDraft());
  });
}

function syncAddFormExpanded() {
  const form = document.getElementById('personalControls');
  const advanced = document.getElementById('addFormAdvancedFields');
  const toggle = document.getElementById('addFormToggle');
  const searchBtn = document.getElementById('searchBtn');

  if (form) form.classList.toggle('is-expanded', isExpanded);
  if (advanced) {
    advanced.setAttribute('aria-hidden', String(!isExpanded));
    advanced.inert = !isExpanded;
  }
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(isExpanded));
    const icon = toggle.querySelector('i[aria-hidden="true"]');
    const label = toggle.querySelector('.sr-only');
    if (icon) {
      icon.classList.toggle('fa-chevron-down', !isExpanded);
      icon.classList.toggle('fa-chevron-up', isExpanded);
    }
    if (label) label.textContent = isExpanded ? 'إخفاء الحقول الإضافية' : 'إظهار الحقول الإضافية';
  }
  if (searchBtn && !searchBtn.disabled) {
    searchBtn.textContent = 'ابحث عن معنى';
  }
}

function setAddFormExpanded(expanded) {
  isExpanded = Boolean(expanded);
  window.isExpanded = isExpanded;
  syncAddFormExpanded();
  if (typeof window.saveActiveAddFormDraft === 'function') window.saveActiveAddFormDraft();
}

window.setAddFormExpanded = setAddFormExpanded;
window.toggleAddFormExpanded = function() {
  setAddFormExpanded(!isExpanded);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setAddFormExpanded(false);
    initAddFormDraftTracking();
    initWordHunterUI();
  });
} else {
  setAddFormExpanded(false);
  initAddFormDraftTracking();
  initWordHunterUI();
}

// ═══════════════════════════════════════════════════════
// Add / Edit Word
// ═══════════════════════════════════════════════════════
window.addWord = async function() {
  if (window.LootLinguaPopover?.isReadingAction?.(document.getElementById('addBtn'))) return false;
  const context = captureDictionaryWriteContext();
  const key = JSON.stringify([context.owner, context.generation, context.scope]);
  if (window.__dictionarySaveInFlight?.key === key) return false;
  const operation = { key };
  window.__dictionarySaveInFlight = operation;
  const btn = document.getElementById('addBtn');
  let savedWord = null, beforeWords = null, persisted = false;
  try {
    const w = document.getElementById('wordInput').value.trim();
    const m = document.getElementById('meaningInput').value.trim();
    const ex = document.getElementById('exampleInput').value.trim();
    const c = document.getElementById('categoryInput').value;
    const editingId = editId;
    const sameDraft = () => editId === editingId && document.getElementById('wordInput').value.trim() === w &&
      document.getElementById('meaningInput').value.trim() === m && document.getElementById('exampleInput').value.trim() === ex && document.getElementById('categoryInput').value === c;
    if (!w || !m) { showToast('عبّي الكلمة ومعناها يا بطل!'); return false; }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> جارٍ الحفظ…';
    if (await window.LootLinguaDictionaryPages?.requireComplete({ personal: !context.worldId }) === false ||
        !isDictionaryWriteContextCurrent(context) || !sameDraft()) return false;
    if (editingId) {
      const existing = window.words.find(word => String(word.id) === String(editingId));
      if (!existing) throw new Error('Dictionary word no longer exists.');
      const lifecycle = getWordLifecycleContract();
      if (lifecycle && lifecycle.wordKeyOf(existing) !== lifecycle.normalizeIdentity(w).wordKey) {
        throw Object.assign(new Error('Word identity changed.'), { code: 'dictionary/identity-change' });
      }
      await updateActiveWordInCloud(editingId, { word: w, meaning: m, example: ex, category: c }, context);
      if (!isDictionaryWriteContextCurrent(context)) return false;
      beforeWords = [...window.words];
      window.words = window.words.map(word => String(word.id) === String(editingId)
        ? { ...word, word: w, text: w, meaning: m, translation: m, example: ex, category: c } : word);
    } else {
      if (!rateLimit('addWord', 30, 60000)) return false;
      const existing = findActiveDictionaryWord(w);
      if (existing && !isDictionaryWordHidden(existing)) { showToast('هذه الكلمة موجودة بالفعل في هذا القاموس!'); return false; }
      if (existing && !context.worldId) {
        const restored = await restoreExistingDictionaryWord(existing, { word: w, meaning: m, example: ex, category: c }, 'manual');
        if (!restored || !isDictionaryWriteContextCurrent(context)) return false;
        savedWord = window.words.find(word => String(word.id) === String(existing.id));
      } else {
        const newWord = applyKnownSharedMastery({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, word: w, meaning: m, example: ex, category: c, starred: false, forgetCount: 0, xpValue: 0, order: 0, createdAt: new Date().toISOString() });
        if (context.owner !== 'guest') {
          const realId = await saveActiveWordToCloud(newWord);
          if (!isDictionaryWriteContextCurrent(context)) return false;
          if (typeof realId !== 'string' || !realId.trim()) throw new Error('Dictionary write was not acknowledged.');
          newWord.id = realId;
        }
        savedWord = window.words.find(word => String(word.id) === String(newWord.id)) || newWord;
        if (savedWord === newWord) { beforeWords = [...window.words]; window.words = [newWord, ...window.words]; }
      }
    }
    persisted = context.owner !== 'guest';
    renderLimit = 20;
    try { saveAndRender(); persisted = true; }
    catch (error) {
      if (!persisted) {
        const stored = context.worldId ? readCustomWorldWordsFromStorage(context.worldId, context.owner) : readWordsFromStorage('normal', context.owner);
        const targetId = savedWord?.id || editingId;
        persisted = stored.some(word => String(word.id) === String(targetId) && word.word === w && word.meaning === m &&
          (word.example || '') === ex && (word.category || '') === c);
      }
      if (!persisted) throw error;
      showToast('حُفظت الكلمة، لكن تعذّر تحديث العرض المحلي بالكامل.', 'warning', 4500);
    }
    if (savedWord && window.words?.some(word => String(word.id) === String(savedWord.id)) &&
        isDictionaryWriteContextCurrent(context)) window.dispatchEvent(new CustomEvent('lootlingua:dictionary-word-saved', {
      detail: { id: savedWord.id, owner: context.owner, scope: context.worldId ? 'custom-world' : 'personal' },
    }));
    if (!isDictionaryWriteContextCurrent(context) || !sameDraft()) return true;
    editId = null;
    btn.innerHTML = 'إضافة للقاموس <i class="fa-solid fa-floppy-disk"></i>';
    btn.style.background = '';
    clearInputs();
    setAddFormExpanded(false);
    return true;
  } catch (error) {
    if (isDictionaryWriteContextCurrent(context)) {
      if (persisted) {
        console.warn('[Dictionary] Saved; optional UI update failed.', error?.message);
        showToast('حُفظت الكلمة، لكن تعذّر تحديث العرض المحلي بالكامل.', 'warning', 4500);
        return true;
      }
      if (beforeWords && !persisted) { window.words = beforeWords; if (dictionarySortMode === 'auto') reindexWordOrder(window.words); }
      showToast(dictionaryWriteErrorMessage(error), 'danger');
    }
    return false;
  } finally {
    if (window.__dictionarySaveInFlight === operation) {
      delete window.__dictionarySaveInFlight;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = editId ? 'تحديث الكلمة <i class="fa-solid fa-floppy-disk"></i>' : 'إضافة للقاموس <i class="fa-solid fa-floppy-disk"></i>';
    }
  }
};

// ═══════════════════════════════════════════════════════
// Edit Word
// ═══════════════════════════════════════════════════════
window.editWord = function(id, event) {
  if (event) event.stopPropagation();
  const item = window.words.find(w => w.id === id);
  if (!item) return;
  suppressStrayQuizUi();
  // Editable dictionaries share the same inputs. Non-editable views go back to personal.
  if (!isEditableDictionaryView()) loadPersonalDictionary();
  document.getElementById('wordInput').value     = item.word;
  document.getElementById('meaningInput').value  = item.meaning;
  document.getElementById('exampleInput').value  = item.example || '';
  setCategoryDropdownValue(item.category || 'عام');
  setAddFormExpanded(true);
  editId = id;
  const btn = document.getElementById('addBtn');
  btn.innerHTML = 'تحديث الكلمة <i class="fa-solid fa-floppy-disk"></i>';
  btn.style.background = 'var(--accent)';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ═══════════════════════════════════════════════════════
// Delete Word (modal)
// ═══════════════════════════════════════════════════════
window.deleteWord = function(id, event) {
  if (event) event.stopPropagation();
  pendingDeleteId = id;
  const wordObj = window.words.find(w => w.id === id);
  const xpLoss  = 0;
  const modalBody = document.querySelector('#deleteModal .modal-content');
  let warnEl = modalBody?.querySelector('.xp-delete-warn');
  if (xpLoss > 0 && modalBody) {
    if (!warnEl) {
      warnEl = document.createElement('div');
      warnEl.className = 'xp-delete-warn';
      modalBody.querySelector('p').after(warnEl);
    }
    warnEl.textContent = '⚠️ ستخسر -' + xpLoss + ' XP عند الحذف';
  } else if (warnEl) warnEl.remove();

  document.getElementById('deleteConfirmBtn').onclick = async function() {
    hideModal('deleteModal');

    // البحث عن العنصر في الواجهة لعمل أنيميشن التلاشي قبل الحذف
    const li = document.querySelector(`[data-id="${pendingDeleteId}"]`)?.closest('.word-card');
    if (li) {
      li.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
      li.style.transform = 'scale(0.9) translateY(10px)';
      li.style.opacity = '0';
    }

    setTimeout(async () => {
      window.words = window.words.filter(w => w.id !== pendingDeleteId);
      await deleteActiveWordFromCloud(pendingDeleteId);
      pendingDeleteId = null;
      document.querySelector('#deleteModal .xp-delete-warn')?.remove();
      
      // تحديث البيانات في الخلفية ورسم القائمة من جديد (بعد اكتمال الأنيميشن)
      persistDictionary();
      if (typeof reconcileEmptyGuestSessionState === 'function') reconcileEmptyGuestSessionState();
      if (currentView === 'starred') renderStarredWords();
      else render();
    }, 300);
  };
  const cBtn = document.getElementById('deleteCancelBtn');
  if (cBtn) cBtn.onclick = () => { hideModal('deleteModal'); document.querySelector('#deleteModal .xp-delete-warn')?.remove(); };
  showModal('deleteModal');
};

// ═══════════════════════════════════════════════════════
function resetDeleteModalCopy() {
  const modal = document.querySelector('#deleteModal .modal-content');
  const title = modal?.querySelector('h2');
  const text = modal?.querySelector('p');
  const confirm = document.getElementById('deleteConfirmBtn');
  if (title) title.textContent = 'حذف الكلمة؟';
  if (text) text.textContent = 'هذا الإجراء لا يمكن التراجع عنه';
  if (confirm) confirm.textContent = 'نعم، احذف';
}

function configureDeleteModal(wordsToDelete, journeyLinkedCount = 0) {
  const modal = document.querySelector('#deleteModal .modal-content');
  const title = modal?.querySelector('h2');
  const text = modal?.querySelector('p');
  const confirm = document.getElementById('deleteConfirmBtn');
  if (wordsToDelete.length === 1 && journeyLinkedCount === 1) {
    if (title) title.textContent = 'إخفاء الكلمة؟';
    if (text) text.textContent = 'هذه الكلمة مرتبطة برحلة تعليمية. سيتم إخفاؤها من قاموسك مع الاحتفاظ بتقدمها وارتباطها بالرحلة.';
    if (confirm) confirm.textContent = 'إخفاء الكلمة';
  } else if (wordsToDelete.length > 1) {
    if (title) title.textContent = `هل أنت متأكد من حذف ${wordsToDelete.length} من الكلمات؟`;
    if (text) text.textContent = journeyLinkedCount
      ? `سيتم إخفاء ${journeyLinkedCount} مرتبطة برحلة، وحذف ${wordsToDelete.length - journeyLinkedCount} كلمة شخصية.`
      : 'هذا الإجراء لا يمكن التراجع عنه';
    if (confirm) confirm.textContent = journeyLinkedCount ? 'تنفيذ' : 'نعم، احذف';
  } else {
    resetDeleteModalCopy();
  }

  modal?.querySelector('.xp-delete-warn')?.remove();
}

let pendingPrivateMembershipDisposition = null;

window.cancelPrivateMembershipDisposition = function() {
  pendingPrivateMembershipDisposition = null;
  hideModal('privateMembershipDispositionModal');
  pendingDeleteId = null;
};

window.confirmPrivateMembershipDisposition = function(disposition) {
  const pending = pendingPrivateMembershipDisposition;
  if (!pending) return;
  pendingPrivateMembershipDisposition = null;
  hideModal('privateMembershipDispositionModal');
  confirmDeleteWords(pending.ids, {
    fromBulk: pending.fromBulk,
    privateDisposition: disposition,
    privateDispositionIds: pending.dispositionIds,
  });
};

function showPrivateMembershipDisposition(words, impacts, ids, fromBulk) {
  const journeyLinked = impacts.some((impact) => impact.hasJourneySource);
  const count = impacts.length;
  const title = document.getElementById('privateMembershipDispositionTitle');
  const text = document.getElementById('privateMembershipDispositionText');
  const returnBtn = document.getElementById('privateMembershipReturnBtn');
  const removeBtn = document.getElementById('privateMembershipRemoveBtn');
  if (title) title.textContent = count === 1
    ? 'هذه آخر عضوية خاصة للكلمة'
    : `هذه آخر عضوية خاصة لـ ${count} كلمات`;
  if (text) text.textContent = journeyLinked
    ? 'بعض الكلمات مرتبطة برحلة تعليمية، لذلك يمكن إعادتها لقاموسك أو إبقاؤها خارج القائمة مع حفظ التقدم.'
    : 'اختر إعادتها إلى قاموسك الشخصي أو حذفها نهائيًا بعد إزالتها من هذا العالم.';
  if (returnBtn) {
    returnBtn.onclick = () => window.confirmPrivateMembershipDisposition('return-personal');
  }
  if (removeBtn) {
    const disposition = journeyLinked ? 'keep-hidden' : 'delete';
    const label = removeBtn.querySelector('span');
    if (label) label.textContent = journeyLinked ? 'إبقاؤها خارج القاموس' : 'حذفها نهائيًا';
    removeBtn.onclick = () => window.confirmPrivateMembershipDisposition(disposition);
  }
  pendingPrivateMembershipDisposition = {
    ids,
    fromBulk,
    dispositionIds: impacts.map((impact) => impact.wordId),
  };
  showModal('privateMembershipDispositionModal');
}

async function confirmDeleteWords(ids, {
  fromBulk = false,
  privateDisposition = '',
  privateDispositionIds = [],
} = {}) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean))];
  const wordsToDelete = uniqueIds
    .map(id => window.words.find(w => String(w.id) === id))
    .filter(Boolean);
  if (!wordsToDelete.length) return;

  pendingDeleteId = uniqueIds[0];
  const deleteCustomWorldId = isCustomWorldView() ? String(activeCustomWorldId) : null;
  const deleteScopeKey = deleteCustomWorldId ? `custom:${deleteCustomWorldId}` : 'personal';
  const removalOperationId = [
    'dictionary-remove',
    deleteScopeKey,
    ...uniqueIds.slice().sort(),
  ].join(':');
  const actionById = new Map(uniqueIds.map((id) => [id, 'delete']));
  const sourceSummaryById = new Map();
  const privateImpactById = new Map();
  const dispositionIdSet = new Set(privateDispositionIds.map(String));
  if (deleteCustomWorldId && hasSignedInUser()) {
    try {
      const impacts = await Promise.all(wordsToDelete.map(async (word) => ({
        wordId: String(word.id),
        ...(await window.getPrivateWorldRemovalImpact?.(deleteCustomWorldId, word)),
      })));
      impacts.forEach((impact) => privateImpactById.set(impact.wordId, impact));
      const requiringDisposition = impacts.filter((impact) => impact.requiresDisposition);
      if (!privateDisposition && requiringDisposition.length) {
        showPrivateMembershipDisposition(
          wordsToDelete,
          requiringDisposition,
          uniqueIds,
          fromBulk
        );
        return;
      }
    } catch (error) {
      showToast('تعذر التحقق من عضوية الكلمات. لم نغيّر هذا العالم.', 'danger', 5200);
      pendingDeleteId = null;
      return;
    }
  }
  if (!deleteCustomWorldId && hasSignedInUser()) {
    try {
      const summaries = await Promise.all(wordsToDelete.map((word) =>
        window.getUserWordSourceSummary?.(word) || Promise.resolve({ hasJourneySource: false })
      ));
      summaries.forEach((summary, index) => {
        sourceSummaryById.set(String(wordsToDelete[index].id), summary);
        if (summary?.hasJourneySource) {
          actionById.set(String(wordsToDelete[index].id), 'hide');
        }
      });
    } catch (error) {
      showToast('تعذر التحقق من ارتباط الكلمة بالرحلة. لم نغيّر قاموسك.', 'danger', 5200);
      pendingDeleteId = null;
      return;
    }
  }
  const journeyLinkedCount = [...actionById.values()].filter((action) => action === 'hide').length;
  configureDeleteModal(wordsToDelete, journeyLinkedCount);

  document.getElementById('deleteConfirmBtn').onclick = async function() {
    hideModal('deleteModal');
    uniqueIds.forEach((id) => {
      const li = document.querySelector(`[data-id="${cssEscapeValue(id)}"]`)?.closest('.word-card');
      if (li) {
        li.style.transition = 'all 0.28s cubic-bezier(0.4, 0, 0.2, 1)';
        li.style.transform = 'scale(0.96) translateY(8px)';
        li.style.opacity = '0';
      }
    });

    setTimeout(async () => {
      const results = await Promise.all(uniqueIds.map(async (id) => {
        const action = actionById.get(id) || 'delete';
        const word = wordsToDelete.find((item) => String(item.id) === id);
        try {
          if (action === 'hide' && typeof window.hideUserWordFromDictionary !== 'function') {
            const unavailable = new Error('Dictionary visibility service is unavailable.');
            unavailable.code = 'word-lifecycle/visibility-unavailable';
            throw unavailable;
          }
          const result = action === 'hide'
            ? await window.hideUserWordFromDictionary(id)
            : await deleteWordFromCapturedScope(
              id,
              deleteCustomWorldId,
              word,
              sourceSummaryById.get(id),
              deleteCustomWorldId ? {
                impact: privateImpactById.get(id),
                disposition: dispositionIdSet.has(id) ? privateDisposition : '',
              } : {}
            );
          return { id, action, ok: action === 'hide' ? Boolean(result) : result === true };
        } catch (error) {
          console.error('[Dictionary] word removal operation failed.', {
            operation: action,
            wordId: id,
            code: error?.code || 'unknown',
            message: error?.message || String(error),
          }, error);
          return { id, action, ok: false, error };
        }
      }));
      const failed = results.filter((result) => !result.ok);
      if (failed.length) {
        failed.forEach(({ id }) => {
          const card = document.querySelector(`.word-card[data-id="${cssEscapeValue(id)}"]`);
          if (card) {
            card.style.opacity = '';
            card.style.transform = '';
          }
        });
        const failureDetails = failed.map(({ id, error }) => {
          const word = wordsToDelete.find((item) => String(item.id) === String(id));
          const code = String(error?.code || '');
          const reason = code.includes('permission')
            ? 'لا توجد صلاحية كافية'
            : (code.includes('unavailable') || code.includes('network')
              ? 'تعذر الاتصال بالخدمة'
              : (code.includes('not-found') ? 'لم تعد الكلمة موجودة' : 'تعذر حفظ التغيير'));
          return `${word?.word || word?.text || 'كلمة غير معروفة'}: ${reason}`;
        });
        showToast(
          `نجحت معالجة ${results.length - failed.length} من ${results.length}. فشل حفظ ${failed.length}. الأسباب: ${failureDetails.join('؛ ')}. يمكنك إعادة المحاولة بأمان.`,
          'warning',
          6200,
          {
            importance: 'partial-failure',
            partialFailure: true,
            resultCount: results.length,
            operationId: removalOperationId,
            dedupeKey: `${removalOperationId}:partial`,
          }
        );
      }

      const successful = results.filter((result) => result.ok);
      const deleteSet = new Set(successful
        .filter((result) => result.action === 'delete')
        .map((result) => result.id));
      const hideSet = new Set(successful
        .filter((result) => result.action === 'hide')
        .map((result) => result.id));
      const stillInDeleteScope = getActiveDictionaryStorageScope() === deleteScopeKey;
      if (stillInDeleteScope) {
        window.words = window.words
          .filter(w => !deleteSet.has(String(w.id)))
          .map((word) => hideSet.has(String(word.id))
            ? { ...word, hiddenFromDictionary: true, hiddenFromDictionaryAt: new Date().toISOString() }
            : word);
        persistDictionary();
      } else if (deleteCustomWorldId) {
        const stored = readCustomWorldWordsFromStorage(deleteCustomWorldId)
          .filter(w => !deleteSet.has(String(w.id)));
        writeCustomWorldWordsToStorage(deleteCustomWorldId, reindexWordOrder(stored));
      } else {
        const stored = readWordsFromStorage('normal')
          .filter(w => !deleteSet.has(String(w.id)));
        writeWordsToStorage(reindexWordOrder(stored), 'normal');
      }
      pendingDeleteId = null;
      document.querySelector('#deleteModal .xp-delete-warn')?.remove();
      resetDeleteModalCopy();
      if (fromBulk || isBulkDeleteMode) window.exitBulkDeleteMode();
      if (typeof reconcileEmptyGuestSessionState === 'function') reconcileEmptyGuestSessionState();
      if (currentView === 'starred') renderStarredWords();
      else if (stillInDeleteScope) render();
      refreshFeatureUnlockUI();
      if (!failed.length) {
        if (successful.length === 1 && successful[0].action === 'hide') {
          const word = wordsToDelete[0];
          showToast(`أُخفيت كلمة ”${word.word || word.text}“ من قائمة قاموسك. ستظل تظهر في المراجعات والاختبارات.`, 'success', 5200);
        } else if (successful.length === 1) {
          const word = wordsToDelete[0];
          showToast(`حُذفت كلمة ”${word.word || word.text}“ من قاموسك.`, 'success', 4200);
        } else {
          showToast(
            `تم إخفاء ${hideSet.size} وحذف ${deleteSet.size} من الكلمات.`,
            'success',
            4800,
            {
              importance: 'multi-result',
              resultCount: successful.length,
              operationId: removalOperationId,
              dedupeKey: `${removalOperationId}:success`,
            }
          );
        }
      }
    }, 300);
  };

  const cBtn = document.getElementById('deleteCancelBtn');
  if (cBtn) cBtn.onclick = () => {
    hideModal('deleteModal');
    document.querySelector('#deleteModal .xp-delete-warn')?.remove();
    resetDeleteModalCopy();
  };
  showModal('deleteModal');
}

window.confirmBulkDeleteSelection = function() {
  if (!bulkSelectedWordIds.size) return;
  confirmDeleteWords([...bulkSelectedWordIds], { fromBulk: true });
};

window.deleteWord = function(id, event) {
  if (event) event.stopPropagation();
  confirmDeleteWords([id]);
};

// Star Toggle
// ═══════════════════════════════════════════════════════
window.toggleStar = async function(id, event) {
  if (event) event.stopPropagation();
  const context = captureDictionaryWriteContext();
  const word = window.words.find(item => String(item.id) === String(id));
  if (!word) return false;
  const pending = window.__dictionaryStarWrites ||= new Map();
  const key = JSON.stringify([context.owner, context.generation, context.scope, String(id)]);
  if (pending.has(key)) return false;
  pending.set(key, true);
  const previous = Boolean(word.starred), next = !previous;
  const btn = event?.target?.closest?.('.star-btn') || [...document.querySelectorAll('[data-action="star"]')].find(button => String(button.dataset.id) === String(id));
  const paint = value => { btn?.classList.toggle('active', value); btn?.setAttribute('aria-pressed', String(value)); };
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  paint(next);
  let persisted = false, updatedWord = null;
  try {
    await updateActiveWordInCloud(id, { starred: next }, context);
    if (!isDictionaryWriteContextCurrent(context)) return false;
    updatedWord = window.words.find(item => String(item.id) === String(id));
    if (!updatedWord) return false;
    updatedWord.starred = next;
    persisted = context.owner !== 'guest';
    try { persistDictionary(); persisted = true; }
    catch (error) {
      if (!persisted) {
        const stored = context.worldId ? readCustomWorldWordsFromStorage(context.worldId, 'guest') : readWordsFromStorage('normal', 'guest');
        persisted = stored.some(item => String(item.id) === String(id) && Boolean(item.starred) === next);
      }
      if (!persisted) throw error;
      console.warn('[Dictionary] Star saved; optional refresh failed.', error?.message);
    }
    paint(next);
    if (currentView === 'starred') renderStarredWords();
    else if (currentFilter === 'starred') render();
    return true;
  } catch (error) {
    if (isDictionaryWriteContextCurrent(context)) {
      if (updatedWord && !persisted) updatedWord.starred = previous;
      paint(persisted ? next : previous);
      if (!persisted) showToast('تعذّر حفظ النجمة. حاول مجددًا؛ لم نؤكد حفظها في حسابك.', 'warning', 4500);
    }
    return persisted;
  } finally {
    pending.delete(key);
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
};

// ═══════════════════════════════════════════════════════
// Sound
// ═══════════════════════════════════════════════════════
window.playSound = function(identifier, event) {
  if (event) event.stopPropagation();
  const obj = window.words.find(w => String(w.id) === String(identifier));
  const wordToPlay = obj ? obj.word.trim() : (typeof identifier === 'string' ? identifier.trim() : '');
  if (!wordToPlay || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utt   = new SpeechSynthesisUtterance(wordToPlay);
  utt.lang    = 'en-US';
  utt.rate    = 0.9;
  const voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('en'));
  if (voice) utt.voice = voice;
  window.speechSynthesis.speak(utt);
};

// ═══════════════════════════════════════════════════════
// AI Suggestions
// ═══════════════════════════════════════════════════════
const DICT_API_BASE = 'https://dictionary7-ayes.onrender.com';
const GUEST_LS_NORMAL = 'hasUsedNormalGuestShot';
const GUEST_LS_GAMER = 'hasUsedGamerGuestShot';

function isAiUserLoggedIn() {
  return !!window.auth?.currentUser;
}

function isGuestSearchLocked(type) {
  if (isAiUserLoggedIn()) return false;
  const key = type === 'gamer' ? GUEST_LS_GAMER : GUEST_LS_NORMAL;
  return localStorage.getItem(key) === '1';
}

function markGuestSearchUsed(type) {
  const key = type === 'gamer' ? GUEST_LS_GAMER : GUEST_LS_NORMAL;
  localStorage.setItem(key, '1');
  refreshGuestSearchLocks();
}

function clearGuestSearchLocks() {
  localStorage.removeItem(GUEST_LS_NORMAL);
  localStorage.removeItem(GUEST_LS_GAMER);
  refreshGuestSearchLocks();
}

function applySearchZoneLock(zoneEl, locked) {
  if (!zoneEl) return;
  const searchType = zoneEl.dataset.searchType || '';
  zoneEl.classList.toggle('search-locked', locked);
  zoneEl.querySelectorAll('input, button, textarea, select').forEach((el) => {
    if (el.classList.contains('search-lock-overlay')) return;
    if (searchType === 'normal' && el.matches('input, textarea, select')) {
      el.disabled = false;
      el.removeAttribute('aria-disabled');
      return;
    }
    el.disabled = locked;
    if (locked) el.setAttribute('aria-disabled', 'true');
    else el.removeAttribute('aria-disabled');
  });
  const overlay = zoneEl.querySelector('.search-lock-overlay');
  if (overlay) overlay.setAttribute('aria-hidden', locked ? 'false' : 'true');
}

window.refreshGuestSearchLocks = function() {
  const loggedIn = isAiUserLoggedIn();
  applySearchZoneLock(document.getElementById('normalSearchZone'), !loggedIn && isGuestSearchLocked('normal'));
  applySearchZoneLock(document.getElementById('gamerAiSearchZone'), !loggedIn && isGuestSearchLocked('gamer'));
  applySearchZoneLock(document.getElementById('gamerMeaningBubble'), !loggedIn && isGuestSearchLocked('gamer'));
};

function showGuestTrialBlocked() {
  pushNotification('عذراً يا بطل! ميزة البحث مخصصة للأساطير المسجلين فقط. سجل الآن مجاناً!', 'warning');
  window.openAppAuth?.('login');
}

function showSearchLockRegisterHint() {
  pushNotification('عذراً يا بطل! ميزة البحث مخصصة للأساطير المسجلين فقط. سجل الآن مجاناً!', 'warning');
  window.openAppAuth?.('login');
}

function guardGuestAiSearch(type) {
  if (isAiUserLoggedIn()) return true;
  if (isGuestSearchLocked(type)) {
    showGuestTrialBlocked();
    return false;
  }
  return true;
}

function announceDictionarySearchResult(type, status, word) {
  window.dispatchEvent(new CustomEvent('lootlingua:dictionary-search-result', {
    detail: {
      type: type === 'gamer' ? 'gamer' : 'normal',
      status: String(status || 'error'),
      word: String(word || '').trim(),
      scope: type === 'normal' ? getAddFormDraftScope() : '',
    },
  }));
}

async function buildAiRequestHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const user = window.auth?.currentUser;
  const generation = Number(window.__lootlinguaAuthGeneration) || 0;
  if (user) {
    let token;
    try {
      token = await user.getIdToken();
    } catch {
      throw Object.assign(new Error('تعذّر تأكيد جلسة الدخول. تحقق من اتصالك وأعد البحث.'), { code: 401 });
    }
    if (window.auth?.currentUser?.uid !== user.uid ||
        generation !== (Number(window.__lootlinguaAuthGeneration) || 0)) {
      throw Object.assign(new Error('تغيّر الحساب. أعد البحث من الحساب الحالي.'), { code: 401 });
    }
    if (typeof token !== 'string' || !token.trim()) {
      throw Object.assign(new Error('تعذّر تأكيد جلسة الدخول. سجّل الدخول مجددًا أو أعد المحاولة.'), { code: 401 });
    }
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function bindSearchLockOverlays() {
  document.querySelectorAll('.search-zone .search-lock-overlay').forEach((overlay) => {
    if (overlay.dataset.bound) return;
    overlay.dataset.bound = '1';
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!overlay.closest('.search-zone')?.classList.contains('search-locked')) return;
      showSearchLockRegisterHint();
    });
  });
}

/**
 * جلب معاني AI: كاش Firestore → API (بعد فحص الضيف/التوكن على السيرفر).
 */
async function fetchAiMeaningsWithCache(word, type, { requestId, recover = false } = {}) {
  const trimmed = String(word || '').trim();
  if (!trimmed) return { ok: false, data: [], error: 'empty' };
  const owner = window.auth?.currentUser?.uid || 'guest';
  const generation = Number(window.__lootlinguaAuthGeneration) || 0;
  const assertOwner = () => {
    if (owner !== (window.auth?.currentUser?.uid || 'guest') || generation !== (Number(window.__lootlinguaAuthGeneration) || 0)) {
      throw Object.assign(new Error('تغيّر الحساب. أعد البحث من الحساب الحالي.'), { code: 401 });
    }
  };

  if (!recover && !guardGuestAiSearch(type)) {
    const err = new Error('Forbidden');
    err.code = 403;
    throw err;
  }

  if (!recover && typeof window.getAiGlobalCache === 'function') {
    try {
      const cached = await window.getAiGlobalCache(trimmed, type);
      assertOwner();
      if (Array.isArray(cached) && cached.length) {
        return { ok: true, data: cached, fromCache: true };
      }
    } catch (e) {
      if (e.code === 401) throw e;
      console.warn('fetchAiMeaningsWithCache: cache read', e);
    }
  }

  if (!recover && !guardGuestAiSearch(type)) {
    const err = new Error('Forbidden');
    err.code = 403;
    throw err;
  }

  const endpoint = recover ? '/api/dictionary/guest-result' : type === 'gamer' ? '/api/gamer-dictionary' : '/api/dictionary';
  const headers = await buildAiRequestHeaders();
  assertOwner();
  const response = await fetch(`${DICT_API_BASE}${endpoint}`, {
    method: 'POST', headers,
    body: JSON.stringify({ word: trimmed, ...(requestId ? { requestId } : {}) }),
    ...(requestId && !recover ? { keepalive: true } : {}),
  });
  const status = response.status;
  const payload = await response.json().catch(() => ({}));
  assertOwner();
  if (requestId && status === 202) return { pending: true };
  if (recover && status === 404) return { missing: true };
  if (status === 401) {
    throw Object.assign(new Error('تعذّر تأكيد جلسة الدخول. سجّل الدخول مجددًا أو أعد البحث.'), { code: 401 });
  }
  if (status === 403) {
    if (owner !== 'guest') {
      throw Object.assign(new Error(payload.error || 'تعذّر إكمال البحث من هذا الحساب. أعد المحاولة.'), { code: 'dictionary/forbidden', status: 403 });
    }
    if (!recover) markGuestSearchUsed(type);
    if (!recover && (type !== 'normal' || !requestId)) showGuestTrialBlocked();
    const err = new Error('Forbidden');
    err.code = 403;
    throw err;
  }
  if (status < 200 || status >= 300) {
    if (status === 502 || status === 503 || status === 504) {
      throw new Error('sleeping');
    }
    throw new Error(payload.error || 'server error');
  }

  if (recover && response.headers?.get('X-Dictionary-Source') == null) return { missing: true };
  const data = Array.isArray(payload) ? payload : [];
  const fromCache = response.headers?.get('X-Dictionary-Source') === 'saved';
  if (!isAiUserLoggedIn() && !fromCache) {
    markGuestSearchUsed(type);
  }
  if (data.length && typeof window.saveAiGlobalCache === 'function') {
    window.saveAiGlobalCache(trimmed, type, data).catch((e) => {
      console.warn('fetchAiMeaningsWithCache: cache save', e);
    });
  }

  return { ok: true, data, fromCache };
}

function clearGamerSuggestionsUI() {
  document.getElementById('gamerMeaningBubble')?.remove();
  document.getElementById('gamerSuggestionsPanel')?.remove();
}


function sugAttr(str) {
  return encodeURIComponent(suggestionText(str));
}

function suggestionText(value) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
  return String(value).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    unit => unit.length === 2 ? unit : '\uFFFD');
}

function decodeSugAttr(str) {
  if (str == null || str === '') return '';
  try { return decodeURIComponent(String(str)); } catch { return String(str); }
}

function pickSuggestionFields(s) {
  const source = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  const firstText = (...values) => values.map(suggestionText).find(Boolean) || '';
  const stars = Number(suggestionText(source.stars));
  return {
    ar: firstText(source.ar, source.arabic, source.meaning_ar, source.translation, source.meaning),
    pos: firstText(source.pos, source.partOfSpeech, source.category) || 'مصطلح ألعاب',
    ex: firstText(source.ex, source.example, source.sentence),
    exAr: suggestionText(source.ex_ar),
    game: suggestionText(source.game),
    stars: Number.isFinite(stars) ? Math.max(1, Math.min(3, Math.round(stars))) : 1,
  };
}

function getSuggestionGameLabel() {
  return '';
}

window.submitSuggestionFromUI = async function(wordEnc, arEnc, gameEnc, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (!rateLimit('submitSuggestion', 10, 60000)) return;
  if (typeof window.submitWordSuggestion !== 'function') {
    pushNotification('خدمة الاقتراحات غير جاهزة. حدّث الصفحة.', 'warning');
    return;
  }
  const user = window.auth?.currentUser;
  if (!user) {
    pushNotification('سجل دخولك أولاً يا بطل عشان تقدر ترسل اقتراحك! 🚀', 'warning');
    const profileModal = document.getElementById('profileModal');
    if (typeof window.toggleProfileModal === 'function' && profileModal && !profileModal.classList.contains('open')) {
      window.toggleProfileModal();
    }
    return;
  }
  const word = decodeSugAttr(wordEnc);
  const ar = decodeSugAttr(arEnc);
  const game = decodeSugAttr(gameEnc);
  const btn = ev?.target?.closest?.('[data-action="submit-suggestion"]') || ev?.currentTarget;
  if (btn?.classList) { btn.disabled = true; btn.classList.add('loading'); }
  const result = await window.submitWordSuggestion({ word, ar, game });
  if (btn?.classList) { btn.disabled = false; btn.classList.remove('loading'); }
  if (result?.ok) {
    pushNotification('وصل الاقتراح لغرفة العمليات.. كفو يا أسطورة! 🔥', 'success');
  } else {
    pushNotification(result?.error || 'ما قدرنا نرسل الاقتراح.', 'danger');
  }
};

async function addAiMeaningCore({ word, ar, pos, ex, game }, btn) {
  const context = captureDictionaryWriteContext();
  if (await window.LootLinguaDictionaryPages?.requireComplete({ personal: !context.worldId }) === false || !isDictionaryWriteContextCurrent(context)) return;
  if (!word || !ar) {
    pushNotification('بيانات ناقصة للإضافة', 'warning');
    return;
  }
  const existingWord = findActiveDictionaryWord(word);
  if (existingWord && !isDictionaryWordHidden(existingWord)) {
    pushNotification('هذه الكلمة موجودة أصلاً في هذا القاموس', 'warning');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span>مضافة مسبقاً</span>';
      btn.classList.add('sug-added');
    }
    return;
  }
  if (!rateLimit('addAiMeaningToPersonal', 12, 30000)) return;

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

  const xpGain = 0;
  const category = pos || 'مصطلح ألعاب';
  let added = false;
  let cloudAccepted = false;
  let guestWord = null;
  let guestPersisted = false;

  try {
    if (existingWord && isDictionaryWordHidden(existingWord) && !isCustomWorldView()) {
      await restoreExistingDictionaryWord(existingWord, {
        word,
        meaning: ar,
        example: ex || '',
        category,
      }, 'dictionary-search');
      if (!isDictionaryWriteContextCurrent(context)) return;
      cloudAccepted = context.owner !== 'guest';
      if (isEditableDictionaryView()) render();
      pushNotification(`تمت استعادة كلمة ”${word}“. كانت مرتبطة برحلة تعليمية، وتقدمها السابق محفوظ.`, 'success');
      added = true;
    } else if (window.auth?.currentUser) {
      const tempWord = applyKnownSharedMastery({ id: Date.now().toString(), word, meaning: ar, example: ex || '', category, starred: false, forgetCount: 0, xpValue: xpGain, createdAt: new Date().toISOString() });
      const realId = isCustomWorldView()
        ? await saveActiveWordToCloud(tempWord)
        : await window.saveWordToCloud?.(
          tempWord.word,
          tempWord.category,
          tempWord.meaning,
          tempWord.example,
          tempWord.order ?? 0,
          { ...tempWord, lifecycleSource: { type: 'dictionary-search' } }
        );
      if (!isDictionaryWriteContextCurrent(context)) return;
      if (typeof realId === 'string' && realId.trim()) {
        cloudAccepted = true;
        if (!window.words.some(item => String(item.id) === realId)) window.words.unshift(applyKnownSharedMastery({
          id: realId, word, meaning: ar, example: ex || '', category,
          starred: false, forgetCount: 0, xpValue: xpGain, createdAt: tempWord.createdAt,
        }));
        persistDictionary();
        if (isEditableDictionaryView()) render();
        pushNotification(`تمت الإضافة إلى ${getActiveDictionaryMessageLabel()}!`, 'success');
        added = true;
      } else {
        throw new Error('Dictionary write was not acknowledged.');
      }
    } else {
      const nw = applyKnownSharedMastery({ id: Date.now().toString(), word, meaning: ar, example: ex || '', category, starred: false, forgetCount: 0, xpValue: xpGain, createdAt: new Date().toISOString() });
      guestWord = nw;
      window.words.unshift(nw);
      persistDictionary();
      guestPersisted = true;
      if (isEditableDictionaryView()) render();
      pushNotification(`تمت الإضافة إلى ${getActiveDictionaryMessageLabel()}!`, 'success');
      added = true;
    }
    if (added && btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span>تمت الإضافة</span>';
      btn.classList.add('sug-added');
    }
  } catch (err) {
    if (!isDictionaryWriteContextCurrent(context)) return;
    if (guestWord && !guestPersisted) {
      const stored = context.worldId ? readCustomWorldWordsFromStorage(context.worldId, context.owner) : readWordsFromStorage('normal', context.owner);
      guestPersisted = stored.some(item => String(item.id) === String(guestWord.id) && item.word === guestWord.word &&
        item.meaning === guestWord.meaning && (item.example || '') === guestWord.example && (item.category || '') === guestWord.category);
      if (!guestPersisted) window.words = window.words.filter(item => item !== guestWord);
    }
    if (cloudAccepted || guestPersisted) {
      pushNotification('حُفظت الكلمة في حسابك، لكن تعذّر تحديث العرض المحلي بالكامل.', 'warning');
      if (btn) { btn.disabled = true; btn.classList.add('sug-added'); btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span>تمت الإضافة</span>'; }
      return;
    }
    console.error('addAiMeaningCore:', err);
    pushNotification('ما قدرنا نضيف الكلمة. جرّب مرة ثانية.', 'danger');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-book" aria-hidden="true"></i><span>إضافة للقاموسك الشخصي</span>';
    }
  }
}

window.addAiMeaningToPersonal = async function(wordEnc, arEnc, posEnc, exEnc, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  await addAiMeaningCore({
    word: decodeSugAttr(wordEnc),
    ar: decodeSugAttr(arEnc),
    pos: decodeSugAttr(posEnc),
    ex: decodeSugAttr(exEnc),
    game: getSuggestionGameLabel(),
  }, ev?.currentTarget);
};

function injectGamerMeaningBubble() {
  const list = document.getElementById('suggestionsList');
  const box = document.getElementById('suggestionsBox');
  if (!list || !box || !list.querySelector('.sug-item')) return;

  clearGamerSuggestionsUI();

  const bubble = document.createElement('div');
  bubble.id = 'gamerMeaningBubble';
  bubble.className = 'gamer-meaning-bubble search-zone';
  bubble.setAttribute('data-search-type', 'gamer');
  bubble.innerHTML = `
    <button type="button" class="gamer-meaning-btn" onclick="fetchGamerSuggestions()">
      <span class="gamer-meaning-icon" aria-hidden="true"><i class="fa-solid fa-gamepad"></i></span>
      <span class="gamer-meaning-text">
        <strong>معنى ألعاب؟</strong>
        <span>طيّب شوف الترجمة الصح (جيمر → جيمر)</span>
      </span>
      <i class="fa-solid fa-chevron-up gamer-meaning-chevron" aria-hidden="true"></i>
    </button>
    <button type="button" class="search-lock-overlay" aria-label="بحث الألعاب مقفل — سجّل دخولك" tabindex="-1">
      <i class="fa-solid fa-lock" aria-hidden="true"></i>
    </button>`;
  list.insertAdjacentElement('afterend', bubble);
  refreshGuestSearchLocks();
  bindSearchLockOverlays();
}

let suggestionInteractionsBound = false;

function bindSuggestionInteractions() {
  if (suggestionInteractionsBound) return;
  suggestionInteractionsBound = true;
  const handleAction = (event) => {
    const control = event.target?.closest?.('[data-action="select-ai-meaning"], [data-action="toggle-ai-meanings"]');
    if (!control || !control.closest('#suggestionsList, #gamerSuggestionsPanel')) return;
    if (event.type === 'keydown') {
      if (control.dataset.action !== 'select-ai-meaning' ||
          (event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
    }
    event.preventDefault();
    if (control.dataset.action === 'select-ai-meaning') {
      selectSuggestion(decodeSugAttr(control.dataset.ar), decodeSugAttr(control.dataset.pos),
        decodeSugAttr(control.dataset.ex));
      document.getElementById('meaningInput')?.focus();
      return;
    }
    const expanded = control.getAttribute('aria-expanded') !== 'true';
    const extra = control.parentElement.querySelectorAll('.extra-meaning');
    extra.forEach(item => { item.style.display = expanded ? 'block' : 'none'; });
    control.setAttribute('aria-expanded', String(expanded));
    control.textContent = expanded ? 'عرض أقل ▲' : `عرض المزيد (${extra.length}) ▼`;
  };
  document.addEventListener('click', handleAction);
  document.addEventListener('keydown', handleAction);
}

function renderSuggestionHtml(suggestions, itemClass, options = {}) {
  const {
    sourceWord = window.__lastDictSearchWord || '',
    game = getSuggestionGameLabel(),
    allowSelect = true,
    showActions = false,
    listSelector = '',
  } = options;

  bindSuggestionInteractions();
  const items = Array.isArray(suggestions) ? suggestions : [];
  const wordEnc = sugAttr(sourceWord);
  let html = '';

  items.forEach((s, i) => {
    const fields = pickSuggestionFields(s);
    const arEsc = escapeHtml(fields.ar);
    const posEsc = escapeHtml(fields.pos);
    const exEsc = escapeHtml(fields.ex);
    const exArEsc = escapeHtml(fields.exAr);
    const gameTag = escapeHtml(fields.game || suggestionText(game));
    const starsNum = fields.stars;
    const starsHtml = '★'.repeat(starsNum) + '☆'.repeat(3 - starsNum);
    const extraClass = i >= 4 ? 'extra-meaning' : '';
    const extraStyle = i >= 4 ? 'style="display:none"' : '';
    const itemGameEnc = sugAttr(fields.game || game || '');
    const selection = allowSelect
      ? `role="button" tabindex="0" data-action="select-ai-meaning" data-ar="${sugAttr(fields.ar)}" data-pos="${sugAttr(fields.pos)}" data-ex="${sugAttr(fields.ex)}"`
      : '';

    html += `
      <div class="sug-result-card ${extraClass}" ${extraStyle}>
        <div class="${escapeHtml(itemClass)} sug-item ${allowSelect ? 'sug-item-clickable' : ''}" ${selection}>
          <div class="sug-main">
            <span class="sug-ar">${arEsc}</span>
            <span class="sug-pos">${posEsc}</span>
            ${gameTag ? `<span class="sug-game-tag">${gameTag}</span>` : ''}
          </div>
          <div class="sug-stars">${starsHtml}</div>
          ${fields.ex ? `
            <div class="sug-ex">
              <div class="sug-ex-en">"${exEsc}"</div>
              ${exArEsc ? `<div class="sug-ex-ar">${exArEsc}</div>` : ''}
            </div>
          ` : ''}
        </div>
        ${showActions ? `<div class="sug-actions">
          <button type="button" class="sug-gamer-action-btn sug-add-personal-btn" data-action="add-ai-meaning"
            data-word="${wordEnc}" data-ar="${sugAttr(fields.ar)}" data-pos="${sugAttr(fields.pos)}" data-ex="${sugAttr(fields.ex)}" data-game="${itemGameEnc}">
            <i class="fa-solid fa-book" aria-hidden="true"></i>
            <span>إضافة لقاموسك الشخصي</span>
          </button>
          <button type="button" class="sug-gamer-action-btn sug-suggest-btn" data-action="submit-suggestion"
            title="اقترح إضافة هذه الكلمة للموقع"
            aria-label="اقترح إضافة للموقع"
            data-word="${wordEnc}" data-ar="${sugAttr(fields.ar)}" data-game="${itemGameEnc}">
            <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
          </button>
        </div>` : ''}
      </div>`;
  });

  if (listSelector && items.length > 4) {
    html += `<button type="button" class="sug-toggle gamer-sug-toggle" data-action="toggle-ai-meanings" aria-expanded="false">
      عرض المزيد (${items.length - 4}) ▼</button>`;
  }

  return html;
}

window.fetchGamerSuggestions = async function() {
  const word = window.__lastDictSearchWord || document.getElementById('wordInput')?.value.trim();
  if (!word) {
    showToast('اكتب كلمة وابحث أولاً!');
    return;
  }
  if (!guardGuestAiSearch('gamer')) {
    announceDictionarySearchResult('gamer', 'blocked', word);
    return;
  }
  if (!rateLimit('fetchGamerSuggestions', 4, 45000)) {
    announceDictionarySearchResult('gamer', 'error', word);
    return;
  }

  const bubbleBtn = document.querySelector('#gamerMeaningBubble .gamer-meaning-btn');
  let panel = document.getElementById('gamerSuggestionsPanel');

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'gamerSuggestionsPanel';
    panel.className = 'gamer-suggestions-panel';
    document.getElementById('gamerMeaningBubble')?.insertAdjacentElement('afterend', panel);
  }

  if (bubbleBtn) {
    bubbleBtn.disabled = true;
    bubbleBtn.classList.add('loading');
  }
  panel.style.display = 'block';
  panel.innerHTML = '<p class="gamer-suggestions-loading"><i class="fas fa-spinner fa-spin"></i> جاري جلب معنى الألعاب...</p>';

  try {
    const { data, fromCache } = await fetchAiMeaningsWithCache(word, 'gamer');
    if (!data.length) {
      panel.innerHTML = '<p class="gamer-suggestions-empty">ما لقينا معنى ألعاب واضح لهالكلمة.</p>';
      announceDictionarySearchResult('gamer', 'empty', word);
      return;
    }

    const cacheNote = fromCache
      ? ' <span class="ai-cache-tag">من الذاكرة المشتركة</span>'
      : '';
    let html = `<p class="gamer-suggestions-title"><i class="fa-solid fa-gamepad"></i> معنى الألعاب (جيمر → جيمر)${cacheNote}</p>`;
    html += '<div class="gamer-suggestions-results">';
    html += renderSuggestionHtml(data, 'gamer-sug-item', {
      sourceWord: word,
      game: getSuggestionGameLabel() || 'ألعاب',
      allowSelect: true,
      showActions: true,
      listSelector: '.gamer-suggestions-results',
    });
    html += '</div>';
    panel.innerHTML = html;
    announceDictionarySearchResult('gamer', 'success', word);
  } catch (err) {
    if (err.code === 403) {
      announceDictionarySearchResult('gamer', 'blocked', word);
      return;
    }
    const msg = err.message === 'sleeping' || String(err.message).includes('fetch')
      ? 'السيرفر كان نايم.. جرّب بعد شوي.'
      : (err.message || 'فشل جلب معنى الألعاب');
    panel.innerHTML = `<p class="gamer-suggestions-error">${escapeHtml(msg)}</p>`;
    announceDictionarySearchResult('gamer', 'error', word);
  } finally {
    if (bubbleBtn) {
      bubbleBtn.disabled = false;
      bubbleBtn.classList.remove('loading');
    }
  }
};

function normalSearchRecord(scope) {
  return readDictionaryDraft(normalSearchRecords, DICTIONARY_SEARCH_PREFIX, scope);
}

function writeNormalSearch(scope, record) {
  writeDictionaryDraft(normalSearchRecords, DICTIONARY_SEARCH_PREFIX, scope, record);
}

function renderNormalSearch(scope) {
  if (!isEditableDictionaryView() || getAddFormDraftScope() !== scope) return;
  const input = document.getElementById('wordInput');
  const button = document.getElementById('searchBtn');
  const box = document.getElementById('suggestionsBox');
  const list = document.getElementById('suggestionsList');
  if (!input || !button || !box || !list) return;
  const word = input.value.trim();
  const record = normalSearchRecord(scope);
  const locked = isGuestSearchLocked('normal');
  const pending = record?.status === 'pending';
  const matches = word === record?.word;
  const heading = document.getElementById('suggestionsHeading');
  if (heading) heading.hidden = !(matches && record.status === 'success');
  button.disabled = locked || pending;
  button.setAttribute('aria-busy', String(pending));
  button.textContent = pending ? 'جارٍ البحث…' : 'ابحث عن معنى';
  list.replaceChildren();
  box.style.display = 'none';
  clearGamerSuggestionsUI();

  function addAction(label, callback) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'entry-secondary dictionary-search-recovery';
    action.textContent = label;
    action.addEventListener('click', callback);
    list.append(action);
  }

  if (record && !matches && ['success', 'pending', 'interrupted'].includes(record.status)) {
    box.style.display = 'block';
    addAction(`العودة إلى البحث عن «${record.word}»`, () => {
      input.value = record.word;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return;
  }
  if (matches && record.selected && record.status === 'success' && !document.getElementById('meaningInput')?.value.trim()) {
    writeNormalSearch(scope, { ...record, selected: false });
    renderNormalSearch(scope);
    return;
  }
  if (!word || (matches && record.selected) || (!matches && !locked)) return;
  box.style.display = 'block';
  if (matches && record.status === 'success') {
    window.__lastDictSearchWord = word;
    list.innerHTML = `<div class="dict-suggestions-results">${renderSuggestionHtml(record.data, 'sug-item', {
      sourceWord: word,
      game: '',
      allowSelect: true,
      listSelector: '.dict-suggestions-results',
    })}</div>`;
    injectGamerMeaningBubble();
    announceDictionarySearchResult('normal', 'success', word);
    return;
  }

  const status = matches ? record.status : 'blocked';
  const message = document.createElement('p');
  message.className = 'dictionary-search-status';
  message.setAttribute('role', 'status');
  message.textContent = {
    pending: 'جارٍ جلب المعاني. يمكنك العودة إلى القاموس لمتابعة البحث.',
    empty: 'لم نجد معنى لهذه الكلمة.',
    blocked: 'استخدمت محاولة البحث المتاحة للضيف. يمكنك إضافة المعنى يدويًا.',
    interrupted: 'تعذّر استرجاع نتيجة البحث. يمكنك التحقق منها مجددًا.',
    error: 'تعذّر جلب المعاني. يمكنك إعادة المحاولة أو كتابة المعنى يدويًا.',
  }[status];
  list.append(message);
  if (status === 'interrupted' && record.requestId) {
    addAction('استرجع نتيجة البحث', () => void runNormalSearch(scope, record, true));
  }
  if (!pending) addAction('اكتب المعنى يدويًا', () => {
    if (matches) writeNormalSearch(scope, { ...record, selected: true });
    setAddFormExpanded(true);
    box.style.display = 'none';
    document.getElementById('meaningInput')?.focus();
    window.dispatchEvent(new CustomEvent('lootlingua:dictionary-meaning-selected', { detail: { scope } }));
  });
  announceDictionarySearchResult('normal', status, word);
}

async function runNormalSearch(scope, record, recover = false) {
  if (normalSearchRequests.has(scope)) return;
  const generation = Number(window.__lootlinguaAuthGeneration) || 0;
  const sameOwner = () => generation === (Number(window.__lootlinguaAuthGeneration) || 0);
  const pending = { ...record, selected: false, status: 'pending' };
  normalSearchRequests.set(scope, generation);
  writeNormalSearch(scope, pending);
  renderNormalSearch(scope);
  let result;
  try {
    result = await fetchAiMeaningsWithCache(record.word, 'normal', { requestId: record.requestId, recover });
    for (let attempt = 0; record.requestId && attempt < 30 &&
      (result.pending || (recover && result.missing && attempt < 2)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4500));
      if (!sameOwner()) return;
      result = await fetchAiMeaningsWithCache(record.word, 'normal', { requestId: record.requestId, recover: true });
    }
  } catch (error) {
    result = { status: recover ? 'interrupted' : error.code === 403 ? 'blocked' : 'error' };
  } finally {
    if (normalSearchRequests.get(scope) === generation) normalSearchRequests.delete(scope);
    if (sameOwner() && normalSearchRecord(scope) === pending) {
      const data = result?.data || [];
      const status = result?.status || (result?.pending || result?.missing ? 'interrupted' : data.length ? 'success' : 'empty');
      writeNormalSearch(scope, { ...pending, status, data });
      renderNormalSearch(scope);
    }
  }
}

function restoreNormalSearch(scope) {
  const record = normalSearchRecord(scope);
  const generation = Number(window.__lootlinguaAuthGeneration) || 0;
  if (record?.status === 'pending' && normalSearchRequests.get(scope) !== generation) {
    normalSearchRequests.delete(scope);
    if (record.requestId && !isAiUserLoggedIn()) {
      void runNormalSearch(scope, record, true);
      return;
    }
    writeNormalSearch(scope, { ...record, status: 'error' });
  }
  renderNormalSearch(scope);
}

window.getPersonalDictionarySearchDraft = () => {
  if (!isEditableDictionaryView() || isCustomWorldView()) return null;
  const scope = getAddFormDraftScope();
  const draft = readAddFormDraftFromDom();
  const record = normalSearchRecord(scope);
  return {
    ...draft,
    status: draft.word.trim() === record?.word ? record.status : '',
    locked: isGuestSearchLocked('normal'),
  };
};

window.fetchSuggestions = async function() {
  const popover = window.LootLinguaPopover;
  if (popover?.isReadingAction?.(document.getElementById('searchBtn'))) return;
  const word = document.getElementById('wordInput')?.value.trim();
  if (!word) { showToast('اكتب الكلمة أولاً!'); return; }
  const scope = getAddFormDraftScope();
  const previous = normalSearchRecord(scope);
  if (previous?.word === word && previous.status === 'success') {
    writeNormalSearch(scope, { ...previous, selected: false });
    renderNormalSearch(scope);
    return;
  }
  if (!isEditableDictionaryView() || normalSearchRequests.has(scope) || !rateLimit('fetchSuggestions', 5, 30000)) return;
  if (isGuestSearchLocked('normal')) {
    if (previous?.requestId && previous.word === word && previous.status === 'interrupted') {
      await runNormalSearch(scope, previous, true);
    } else renderNormalSearch(scope);
    return;
  }
  const uuid = window.crypto?.randomUUID?.();
  const requestId = isAiUserLoggedIn() ? undefined
    : (previous?.word === word ? previous.requestId : undefined) || uuid;
  window.saveActiveAddFormDraft();
  await runNormalSearch(scope, { word, requestId });
};

function selectSuggestion(ar, pos, ex) {
  document.getElementById('meaningInput').value  = ar;
  setCategoryDropdownValue(pos || 'عام');
  document.getElementById('exampleInput').value  = ex;
  setAddFormExpanded(true);
  const scope = getAddFormDraftScope();
  const record = normalSearchRecord(scope);
  if (record && record.word === document.getElementById('wordInput')?.value.trim()) {
    writeNormalSearch(scope, { ...record, selected: true });
  }
  const box = document.getElementById('suggestionsBox');
  if (box) box.style.display = 'none';
  clearGamerSuggestionsUI();
  window.dispatchEvent(new CustomEvent('lootlingua:dictionary-meaning-selected', { detail: { scope } }));
}

const WORD_HUNTER_MIN_CONFIDENCE = 45;
let wordHunterImageFile = null;
let wordHunterNatural = { width: 1, height: 1 };
let wordHunterActiveWord = null;
let wordHunterObjectUrl = '';

function cleanOcrWord(text) {
  return String(text || '').replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '').trim();
}

function setWordHunterStatus(message, loading = false) {
  const status = document.getElementById('wordHunterStatus');
  if (!status) return;
  status.innerHTML = message
    ? `${loading ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ' : ''}${message}`
    : '';
}

window.openWordHunterModal = function() {
  const modal = document.getElementById('wordHunterModal');
  if (!modal) return;
  suppressStrayQuizUi();
  lockBackgroundScroll('wordHunter');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('word-hunter-open');
  closeAppDropdowns();
  document.getElementById('dictionarySortMenu')?.classList.remove('open');
};

window.closeWordHunterModal = function() {
  const modal = document.getElementById('wordHunterModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('word-hunter-open');
  unlockBackgroundScroll('wordHunter');
  resetWordHunterModal();
};

function resetWordHunterModal() {
  const dropzone = document.getElementById('wordHunterDropzone');
  const stage = document.getElementById('wordHunterStage');
  const image = document.getElementById('wordHunterImage');
  const overlay = document.getElementById('wordHunterOverlay');
  const popover = document.getElementById('wordHunterPopover');
  dropzone?.classList.remove('is-hidden', 'drag-over');
  if (stage) stage.hidden = true;
  if (overlay) overlay.innerHTML = '';
  if (popover) {
    popover.hidden = true;
    popover.innerHTML = '';
  }
  if (image) image.removeAttribute('src');
  if (wordHunterObjectUrl) {
    URL.revokeObjectURL(wordHunterObjectUrl);
    wordHunterObjectUrl = '';
  }
  wordHunterImageFile = null;
  wordHunterActiveWord = null;
  wordHunterNatural = { width: 1, height: 1 };
  setWordHunterStatus('');
}

function initWordHunterUI() {
  const dropzone = document.getElementById('wordHunterDropzone');
  const fileInput = document.getElementById('wordHunterFileInput');
  if (!dropzone || !fileInput || dropzone.dataset.ready === '1') return;
  dropzone.dataset.ready = '1';

  const pickFile = () => fileInput.click();
  dropzone.addEventListener('click', pickFile);
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickFile();
    }
  });
  ['dragenter', 'dragover'].forEach(type => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(type => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) handleWordHunterFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleWordHunterFile(file);
    fileInput.value = '';
  });
}

let tesseractLoadPromise = null;

function loadTesseract() {
  if (window.Tesseract?.recognize) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => window.Tesseract?.recognize
      ? resolve(window.Tesseract)
      : reject(new Error('tesseract-api-unavailable'));
    script.onerror = () => reject(new Error('tesseract-load-failed'));
    document.head.appendChild(script);
  }).catch((error) => {
    tesseractLoadPromise = null;
    throw error;
  });
  return tesseractLoadPromise;
}

async function handleWordHunterFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('ارفع صورة فقط يا بطل.', 'warning');
    return;
  }
  wordHunterImageFile = file;
  const dropzone = document.getElementById('wordHunterDropzone');
  const image = document.getElementById('wordHunterImage');
  const stage = document.getElementById('wordHunterStage');
  const overlay = document.getElementById('wordHunterOverlay');
  const popover = document.getElementById('wordHunterPopover');
  if (!image || !stage || !overlay) return;

  overlay.innerHTML = '';
  popover?.setAttribute('hidden', '');
  stage.hidden = false;
  dropzone?.classList.add('is-hidden');
  if (wordHunterObjectUrl) URL.revokeObjectURL(wordHunterObjectUrl);
  wordHunterObjectUrl = URL.createObjectURL(file);
  image.src = wordHunterObjectUrl;
  await new Promise(resolve => {
    image.onload = () => {
      wordHunterNatural = {
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
      };
      resolve();
    };
  });

  setWordHunterStatus('جاري استخراج الكلمات من الصورة محلياً...', true);
  try {
    const Tesseract = await loadTesseract();
    const result = await Tesseract.recognize(wordHunterImageFile, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          setWordHunterStatus(`جاري قراءة الصورة... ${pct}%`, true);
        }
      },
    });
    const words = Array.isArray(result?.data?.words) ? result.data.words : [];
    renderWordHunterWords(words);
  } catch (error) {
    console.error('word hunter OCR:', error);
    setWordHunterStatus('تعذر استخراج النص من الصورة. جرّب صورة أوضح.', false);
  }
}

function getOcrBox(word) {
  const box = word?.bbox || word;
  const x0 = Number(box?.x0 ?? box?.left ?? box?.x ?? 0);
  const y0 = Number(box?.y0 ?? box?.top ?? box?.y ?? 0);
  const x1 = Number(box?.x1 ?? (x0 + Number(box?.width || 0)));
  const y1 = Number(box?.y1 ?? (y0 + Number(box?.height || 0)));
  return { x0, y0, x1, y1 };
}

function renderWordHunterWords(ocrWords) {
  const overlay = document.getElementById('wordHunterOverlay');
  if (!overlay) return;
  const seen = [];
  overlay.innerHTML = '';
  const frag = document.createDocumentFragment();
  ocrWords.forEach((item, index) => {
    const text = cleanOcrWord(item.text);
    if (!text || text.length > 40) return;
    if (Number(item.confidence ?? 100) < WORD_HUNTER_MIN_CONFIDENCE) return;
    const box = getOcrBox(item);
    const width = Math.max(0, box.x1 - box.x0);
    const height = Math.max(0, box.y1 - box.y0);
    if (width < 4 || height < 4) return;
    seen.push(text);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'word-hunter-word';
    btn.textContent = text;
    btn.style.left = `${(box.x0 / wordHunterNatural.width) * 100}%`;
    btn.style.top = `${(box.y0 / wordHunterNatural.height) * 100}%`;
    btn.style.width = `${(width / wordHunterNatural.width) * 100}%`;
    btn.style.height = `${(height / wordHunterNatural.height) * 100}%`;
    btn.dataset.word = text;
    btn.dataset.index = String(index);
    btn.addEventListener('click', (event) => handleWordHunterWordClick(event, btn));
    frag.appendChild(btn);
  });
  overlay.appendChild(frag);
  setWordHunterStatus(
    seen.length
      ? `تم تجهيز ${seen.length} كلمة. اضغط على أي كلمة لمعناها.`
      : 'لم تظهر كلمات واضحة. جرّب صورة أوضح أو قصّ الجزء الذي يحتوي النص.',
    false
  );
}

async function handleWordHunterWordClick(event, btn) {
  event.preventDefault();
  event.stopPropagation();
  const word = cleanOcrWord(btn.dataset.word);
  if (!word) return;
  if (!rateLimit('wordHunterLookup', 12, 60000)) return;
  wordHunterActiveWord = word;
  document.querySelectorAll('.word-hunter-word.active').forEach(el => el.classList.remove('active'));
  btn.classList.add('active');
  showWordHunterPopover(btn, { word, loading: true });

  const local = (window.words || []).find(item => String(item.word || '').toLowerCase() === word.toLowerCase());
  if (local) {
    showWordHunterPopover(btn, {
      word,
      meaning: local.meaning || '',
      category: local.category || 'عام',
      example: local.example || '',
      local: true,
    });
    return;
  }

  try {
    const { data, fromCache } = await fetchAiMeaningsWithCache(word, 'normal');
    const fields = pickSuggestionFields(data?.[0] || {});
    showWordHunterPopover(btn, {
      word,
      meaning: fields.ar || 'لم نجد معنى واضح.',
      category: fields.pos || 'عام',
      example: fields.ex || '',
      fromCache,
      empty: !fields.ar,
      canAskGamer: Boolean(fields.ar),
    });
  } catch (error) {
    if (error.code === 403) {
      showWordHunterPopover(btn, { word, meaning: 'سجل دخولك لاستخدام البحث الذكي بعد التجربة.', empty: true });
      return;
    }
    showWordHunterPopover(btn, { word, meaning: error.code === 401 ? error.message : 'تعذر جلب المعنى الآن.', empty: true });
  }
}

function showWordHunterPopover(anchor, data) {
  const popover = document.getElementById('wordHunterPopover');
  if (!popover || !anchor) return;
  const anchorRect = anchor.getBoundingClientRect();
  popover.hidden = false;
  const existingWord = findActiveDictionaryWord(data.word);
  const restore = Boolean(existingWord && isDictionaryWordHidden(existingWord) && !isCustomWorldView());
  const disabled = data.empty || Boolean(existingWord && !restore) || Boolean(data.local && !restore);
  popover.innerHTML = data.loading
    ? `<div class="word-hunter-popover-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><strong>${escapeHtml(data.word)}</strong></div>`
    : `
      <strong>${escapeHtml(data.word)}</strong>
      <p>${escapeHtml(data.meaning || '')}</p>
      ${data.example ? `<small>${escapeHtml(data.example)}</small>` : ''}
      <div class="word-hunter-popover-meta">${data.local ? 'موجودة في قاموسك' : (data.fromCache ? 'من الكاش المشترك' : 'فحص كلمة واحدة فقط')}</div>
      <button type="button" ${disabled ? 'disabled' : ''} onclick="addWordHunterResult(event)"
        data-word="${sugAttr(data.word)}" data-ar="${sugAttr(data.meaning || '')}" data-pos="${sugAttr(data.category || 'عام')}" data-ex="${sugAttr(data.example || '')}">
        <i class="fa-solid fa-plus" aria-hidden="true"></i>
        <span>${restore ? 'استعادة إلى القاموس' : (disabled ? 'مضافة مسبقاً' : 'إضافة للقاموس')}</span>
      </button>
      ${data.canAskGamer ? `<button type="button" class="word-hunter-gamer-btn" onclick="fetchWordHunterGamerMeaning(event)" data-word="${sugAttr(data.word)}">
        <i class="fa-solid fa-gamepad" aria-hidden="true"></i>
        <span>عرض معنى الألعاب</span>
      </button>` : ''}
    `;

  const margin = 12;
  const popoverWidth = popover.offsetWidth || Math.min(360, window.innerWidth - 24);
  const popoverHeight = popover.offsetHeight || 220;
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  const left = Math.max(
    margin + (popoverWidth / 2),
    Math.min(anchorCenter, window.innerWidth - margin - (popoverWidth / 2))
  );
  const belowTop = anchorRect.bottom + 10;
  const aboveTop = anchorRect.top - popoverHeight - 10;
  const canFitBelow = belowTop + popoverHeight <= window.innerHeight - margin;
  const canFitAbove = aboveTop >= margin;
  popover.style.left = `${left}px`;
  popover.style.top = `${canFitBelow ? belowTop : canFitAbove ? aboveTop : Math.max(margin, Math.min(belowTop, window.innerHeight - popoverHeight - margin))}px`;
  popover.style.transform = 'translateX(-50%)';
}

window.addWordHunterResult = async function(event) {
  event.preventDefault();
  event.stopPropagation();
  const btn = event.currentTarget;
  await addAiMeaningCore({
    word: decodeSugAttr(btn.dataset.word),
    ar: decodeSugAttr(btn.dataset.ar),
    pos: decodeSugAttr(btn.dataset.pos),
    ex: decodeSugAttr(btn.dataset.ex),
    game: '',
  }, btn);
};

window.fetchWordHunterGamerMeaning = async function(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!guardGuestAiSearch('gamer')) return;
  const btn = event?.currentTarget;
  const word = decodeSugAttr(btn?.dataset?.word || wordHunterActiveWord || '');
  if (!word || !rateLimit('wordHunterGamerLookup', 6, 60000)) return;
  const activeAnchor = document.querySelector('.word-hunter-word.active');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>جاري جلب معنى الألعاب...</span>';
  }
  try {
    const { data, fromCache } = await fetchAiMeaningsWithCache(word, 'gamer');
    const fields = pickSuggestionFields(data?.[0] || {});
    if (!fields.ar) {
      showToast('ما لقينا معنى ألعاب واضح لهالكلمة.', 'info', 3200);
      return;
    }
    if (activeAnchor) {
      showWordHunterPopover(activeAnchor, {
        word,
        meaning: fields.ar,
        category: fields.pos || 'مصطلح ألعاب',
        example: fields.ex || '',
        fromCache,
        gameMeaning: true,
      });
    }
  } catch (err) {
    if (err.code !== 403) showToast(err.code === 401 ? err.message : 'تعذر جلب معنى الألعاب الآن.', 'warning', 3600);
  }
};

// Filter
// ═══════════════════════════════════════════════════════
function setFilter(f) {
  currentFilter = f;
  renderLimit = 20; // إعادة التصفير عند تغيير الفلتر
  render();
}

// ═══════════════════════════════════════════════════════
// Reorder (Drag & Drop)
// ═══════════════════════════════════════════════════════
async function toggleReorderMode() {
  if (!isReorderMode && await window.LootLinguaDictionaryPages?.requireComplete({ personal: !isCustomWorldView() }) === false) return;
  if (!isEditableDictionaryView()) return;
  if (!isReorderMode && !isBulkDeleteMode) {
    window.enterSelectionMode();
  }
  isReorderMode = !isReorderMode;
  if (isReorderMode) {
    syncSelectedIndicesFromBulkSelection();
  } else {
    dictionarySortMode = 'auto';
    reindexWordOrder(window.words);
    saveDictionarySortPrefs();
    scheduleWordOrderCloudSync();
    selectedIndices = [];
  }
  updateBulkDeleteBar();
  if (!isReorderMode) persistDictionary();
  render();
  if (!isReorderMode && isBulkDeleteMode) window.exitBulkDeleteMode();
}

window.moveSelectedWordsByStep = function(direction) {
  if (!isReorderMode || !bulkSelectedWordIds.size || !Array.isArray(window.words)) return;
  const dir = direction < 0 ? -1 : 1;
  syncSelectedIndicesFromBulkSelection();
  const selectedSet = new Set(selectedIndices);
  if (!selectedSet.size) return;
  if (dir < 0) {
    for (let i = 1; i < window.words.length; i++) {
      if (selectedSet.has(i) && !selectedSet.has(i - 1)) {
        [window.words[i - 1], window.words[i]] = [window.words[i], window.words[i - 1]];
      }
    }
  } else {
    for (let i = window.words.length - 2; i >= 0; i--) {
      if (selectedSet.has(i) && !selectedSet.has(i + 1)) {
        [window.words[i + 1], window.words[i]] = [window.words[i], window.words[i + 1]];
      }
    }
  }
  reindexWordOrder(window.words);
  dictionarySortMode = 'auto';
  saveDictionarySortPrefs();
  persistDictionary();
  scheduleWordOrderCloudSync();
  syncSelectedIndicesFromBulkSelection();
  render();
};

function allowDrop(ev) { ev.preventDefault(); }

function drag(ev, index) {
  syncSelectedIndicesFromBulkSelection();
  if (!selectedIndices.includes(index)) selectedIndices = [index];
  ev.dataTransfer.setData("draggedIndices", JSON.stringify(selectedIndices));
}

function drop(ev, dropIndex) {
  ev.preventDefault();
  const dragged = JSON.parse(ev.dataTransfer.getData("draggedIndices")).sort((a, b) => b - a);
  const items   = dragged.map(i => window.words.splice(i, 1)[0]).reverse();
  let target    = dropIndex;
  dragged.forEach(i => { if (i < dropIndex) target--; });
  window.words.splice(Math.max(target, 0), 0, ...items);
  reindexWordOrder(window.words);
  dictionarySortMode = 'auto';
  saveDictionarySortPrefs();
  persistDictionary();
  scheduleWordOrderCloudSync();
  syncSelectedIndicesFromBulkSelection();
  render();
}

function handleLiClick(index, el) {
  if (isReorderMode) {
    const word = window.words[index];
    if (!word) return;
    const key = String(word.id);
    if (bulkSelectedWordIds.has(key)) {
      bulkSelectedWordIds.delete(key);
      el.classList.remove('selected-for-move');
    } else {
      bulkSelectedWordIds.add(key);
      el.classList.add('selected-for-move');
    }
    if (!bulkSelectedWordIds.size) bulkSelectedWordIds.add(key);
    syncSelectedIndicesFromBulkSelection();
    syncBulkSelectionInDom(key);
  } else {
    const word = window.words[index];
    if (word) {
      word.expanded = !word.expanded;
      if (word.expanded) window.ensureWordCardDetails?.(word, el);
      // Expansion is transient UI state; preserve the virtual window and scroll position.
      el.classList.toggle('show-example', word.expanded);
      el.setAttribute('aria-expanded', String(word.expanded));
    }
  }
}

function showBackupHelp(type, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const messages = {
    export: 'التصدير يحفظ نسخة من كلماتك كملف JSON. تقدر تنقله لجهاز ثاني، تحتفظ فيه كنسخة أمان، أو تشاركه مع شخص تثق فيه.',
    import: 'الاستيراد يقرأ ملف JSON سبق وطلعته من LootLingua، ويدمج كلماته مع قاموسك بدون تكرار الكلمات الموجودة.',
  };

  const old = document.querySelector('.backup-help-popover');
  if (old) old.remove();
  unlockBackgroundScroll('backupHelp');

  const pop = document.createElement('div');
  pop.className = 'backup-help-popover';
  pop.textContent = messages[type] || 'هذه الأداة تساعدك تحفظ قاموسك أو ترجعه وقت الحاجة.';
  document.body.appendChild(pop);
  lockBackgroundScroll('backupHelp');

  const btn = event?.currentTarget;
  const rect = btn?.getBoundingClientRect();
  if (rect) {
    const gap = 10;
    const top = rect.top - pop.offsetHeight - gap;
    pop.style.top = `${Math.max(12, top)}px`;
    pop.style.left = `${Math.min(window.innerWidth - pop.offsetWidth - 12, Math.max(12, rect.left + rect.width / 2 - pop.offsetWidth / 2))}px`;
  }

  const close = (e) => {
    if (e?.target === btn || pop.contains(e?.target)) return;
    pop.remove();
    unlockBackgroundScroll('backupHelp');
    document.removeEventListener('click', close, true);
  };
  setTimeout(() => document.addEventListener('click', close, true), 0);
  setTimeout(() => {
    pop.remove();
    unlockBackgroundScroll('backupHelp');
    document.removeEventListener('click', close, true);
  }, 6500);
}
// ═══════════════════════════════════════════════════════
// Export / Import
// ═══════════════════════════════════════════════════════
const JSON_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const JSON_IMPORT_MAX_WORDS = 500;
const JSON_IMPORT_MAX_FIELD = 500;
const JSON_IMPORT_FEATURE_PRIORITY = ['quiz', 'treasure', 'starred'];

function isJsonImportBatchActive() {
  return window.__jsonImportBatchActive === true;
}

function seedFeatureUnlockBaseline() {
  const unlocked = resolveUnlockedFeatures();
  const currentLocks = {};
  document.querySelectorAll('.nav-link[data-feature]').forEach((link) => {
    const id = link.getAttribute('data-feature');
    if (id) currentLocks[id] = !unlocked.has(id);
  });
  window.__navLockPrev = { ...currentLocks };
  window.__navLockAnimSeeded = true;
}

function getHighestNewlyUnlockedFeature(beforeSet, afterSet) {
  const newly = [...afterSet].filter((id) => !beforeSet.has(id));
  if (!newly.length) return null;
  for (const id of JSON_IMPORT_FEATURE_PRIORITY) {
    if (newly.includes(id)) return id;
  }
  return newly[newly.length - 1];
}

function sanitizeImportText(value, maxLen = JSON_IMPORT_MAX_FIELD) {
  if (value == null) return '';
  let text = String(value);
  if (text.length > maxLen) text = text.slice(0, maxLen);
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  return text.trim();
}

function normalizeImportedWordEntry(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (Object.prototype.hasOwnProperty.call(item, '__proto__') ||
      Object.prototype.hasOwnProperty.call(item, 'constructor') ||
      Object.prototype.hasOwnProperty.call(item, 'prototype')) {
    return null;
  }
  const word = sanitizeImportText(item.word || item.text);
  if (!word) return null;
  const forgetCount = Number.parseInt(item.forgetCount, 10);
  return {
    id: sanitizeImportText(item.id, 80) || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    word,
    meaning: sanitizeImportText(item.meaning),
    example: sanitizeImportText(item.example, 1000),
    category: sanitizeImportText(item.category) || 'عام',
    starred: Boolean(item.starred),
    forgetCount: Number.isFinite(forgetCount) ? Math.max(0, Math.min(999, forgetCount)) : 0,
    xpValue: 0,
    mastery_status: normalizeMasteryStatus(item.mastery_status || item.masteryStatus || item.status),
    mastery_streak: Math.max(0, Math.min(3, Number(item.mastery_streak ?? item.masteryStreak) || 0)),
    last_recalled_at: item.last_recalled_at || item.lastRecalledAt || null,
    first_recalled_at: item.first_recalled_at || item.firstRecalledAt || null,
    last_recall_day: sanitizeImportText(item.last_recall_day || item.lastRecallDay, 20),
    last_recall_session_id: sanitizeImportText(item.last_recall_session_id || item.lastRecallSessionId, 120),
    last_quizzed_at: item.last_quizzed_at || item.lastQuizzedAt || null,
    quiz_seen_count: Math.max(0, Number(item.quiz_seen_count ?? item.quizSeenCount) || 0),
    mastered_once: Boolean(item.mastered_once || item.masteredOnce),
    firstMasteredAt: item.firstMasteredAt || null,
    hasEarnedMasteryXP: Boolean(item.hasEarnedMasteryXP),
    earnedTransitions: Array.isArray(item.earnedTransitions) ? item.earnedTransitions.map(String).slice(0, 8) : [],
    remasteryAwardCount: Math.max(0, Number(item.remasteryAwardCount) || 0),
    xpEconomyVersion: Math.max(0, Number(item.xpEconomyVersion) || 0),
    createdAt: typeof item.createdAt === 'string' ? sanitizeImportText(item.createdAt, 40) : null,
  };
}

function parseImportJsonWords(rawText) {
  if (typeof rawText !== 'string' || rawText.length > JSON_IMPORT_MAX_BYTES) {
    throw new Error('size');
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('parse');
  }
  let entries = parsed;
  if (!Array.isArray(entries) && parsed && typeof parsed === 'object') {
    if (parsed.format && parsed.format !== 'lootlingua-dictionary') throw new Error('shape');
    if (Array.isArray(parsed.words)) entries = parsed.words;
  }
  if (!Array.isArray(entries)) throw new Error('shape');
  if (entries.length > JSON_IMPORT_MAX_WORDS) throw new Error('limit');
  const words = [];
  for (const entry of entries) {
    const normalized = normalizeImportedWordEntry(entry);
    if (normalized) words.push(normalized);
  }
  if (!words.length) throw new Error('empty');
  return words;
}

function mergeImportedWords(importedWords) {
  const existing = new Set(window.words.map((w) => normalizeWord(w.word)));
  const batchSeen = new Set();
  const toAdd = [];
  for (const item of importedWords) {
    const key = normalizeWord(item.word);
    if (!key || existing.has(key) || batchSeen.has(key)) continue;
    batchSeen.add(key);
    existing.add(key);
    const uid = window.auth?.currentUser?.uid;
    toAdd.push({
      ...item,
      userId: uid || item.userId,
    });
  }
  return toAdd;
}

async function uploadImportedWordsToCloud(words) {
  const result = { uploaded: 0, failed: 0 };
  if (!window.auth?.currentUser || !words.length) return result;
  for (const item of words) {
    try {
      const realId = await saveActiveWordToCloud(item);
      if (!realId) {
        result.failed++;
        continue;
      }
      item.id = realId;
      const idx = window.words.findIndex((w) => normalizeWord(w.word) === normalizeWord(item.word));
      if (idx >= 0) window.words[idx].id = realId;
      result.uploaded++;
    } catch (err) {
      console.warn('import upload:', err);
      result.failed++;
    }
  }
  return result;
}

function finalizeJsonImport(ctx, uploadResult) {
  const added = ctx.added || 0;
  const skipped = ctx.skipped || 0;
  const totalXp = ctx.totalXp || 0;
  const uploaded = uploadResult?.uploaded || 0;
  const failed = uploadResult?.failed || 0;

  evaluateTitleUnlocks(false);
  window.__suppressUnlockNotices = true;
  refreshFeatureUnlockUI();
  seedFeatureUnlockBaseline();
  window.__suppressUnlockNotices = false;

  const endUnlocked = resolveUnlockedFeatures();
  const endRank = getRank(userXP);
  const endTitles = new Set(getTitleState().unlocked || []);
  const newTitleDefs = TITLE_DEFS.filter((def) => endTitles.has(def.id) && !ctx.startTitles.has(def.id));

  let toastParts = [`تم استيراد ${added} كلمة`];
  if (skipped > 0) toastParts.push(`تجاوزنا ${skipped} مكررة`);
  if (uploaded > 0) toastParts.push(`رُفع ${uploaded} إلى السحابة`);
  if (failed > 0) toastParts.push(`تعذر رفع ${failed} وبقيت محفوظة محليًا`);
  if (totalXp > 0) toastParts.push(`+${totalXp} XP`);
  showToast(toastParts.join(' — '), failed > 0 ? 'warning' : 'success', 5600, {
    importance: 'multi-result',
    partialFailure: failed > 0,
    resultCount: added + skipped,
    operationId: ctx.operationId,
    dedupeKey: `${ctx.operationId}:result`,
  });

  const featureId = getHighestNewlyUnlockedFeature(ctx.startUnlocked, endUnlocked);
  if (featureId) {
    const featureTitle = UNLOCK_EXPLAIN[featureId]?.title || 'ميزة جديدة';
    setTimeout(() => {
      playUnlockSound();
      pushNotification(`🎉 انفتحت لك: ${featureTitle}`, 'success');
    }, 450);
  }

  if (endRank.label !== ctx.startRank.label) {
    setTimeout(() => showRankUp(endRank), 900);
  }

  if (newTitleDefs.length) {
    const latestTitle = newTitleDefs[newTitleDefs.length - 1];
    setTimeout(() => pushNotification(`🏅 لقب جديد: ${latestTitle.name}`, 'success'), 1300);
  }

  const dailyBefore = ctx.dailyCountBefore || 0;
  const dailyAfter = getDailyCount();
  if (dailyBefore < DAILY_GOAL && dailyAfter >= DAILY_GOAL) {
    setTimeout(launchConfetti, 1100);
  }

  window.__suppressCloudWordsSnapshot = false;
  if (typeof window.writeWordsToStorage === 'function') {
    writeActiveWordsToStorage(window.words, window.auth?.currentUser?.uid);
  }
}

window.exportData = async function() {
  if (await window.LootLinguaDictionaryPages?.requireComplete({ personal: !isCustomWorldView() }) === false) return;
  const activeWorld = getActiveCustomWorld();
  const payload = {
    format: 'lootlingua-dictionary',
    version: 1,
    exportedAt: new Date().toISOString(),
    dictionary: activeWorld
      ? { type: 'customWorld', id: activeWorld.id, name: activeWorld.name, emoji: activeWorld.emoji }
      : { type: 'personal', name: 'قاموسك الشخصي' },
    words: Array.isArray(window.words) ? window.words : [],
  };
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
  a.download = activeWorld
    ? `lootlingua_${String(activeWorld.name || 'world').replace(/\s+/g, '_')}.json`
    : 'lootlingua_dict.json';
  a.click();
};

window.importData = async function(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (await window.LootLinguaDictionaryPages?.requireComplete({ personal: !isCustomWorldView() }) === false) return;
  event.target.value = '';

  if (!rateLimit('jsonImport', 5, 60000)) {
    showToast('استنى شوي قبل ما تستورد ملف ثاني.');
    return;
  }
  if (file.size > JSON_IMPORT_MAX_BYTES) {
    showToast('الملف كبير زيادة. الحد الأقصى 2 ميغابايت.');
    return;
  }

  let importedWords;
  try {
    importedWords = parseImportJsonWords(await file.text());
  } catch (err) {
    const code = err?.message || '';
    if (code === 'limit') showToast(`الملف فيه أكثر من ${JSON_IMPORT_MAX_WORDS} كلمة. قسّمه لملفات أصغر.`);
    else if (code === 'size') showToast('الملف كبير زيادة. الحد الأقصى 2 ميغابايت.');
    else if (code === 'empty') showToast('ما لقينا كلمات صالحة في الملف.');
    else showToast('خطأ في الملف. تأكد إنه JSON صحيح من LootLingua.');
    return;
  }

  const toAdd = mergeImportedWords(importedWords);
  if (!toAdd.length) {
    showToast('ما في كلمات جديدة — إما كلها موجودة عندك أو مكررة بالملف.');
    return;
  }

  const ctx = {
    startXp: userXP,
    startRank: getRank(userXP),
    startUnlocked: new Set(resolveUnlockedFeatures()),
    startTitles: new Set(getTitleState().unlocked || []),
    wordsBefore: window.words.length,
    dailyCountBefore: getDailyCount(),
    added: toAdd.length,
    skipped: importedWords.length - toAdd.length,
    totalXp: 0,
    operationId: `json-import:${toAdd
      .map((word) => normalizeWord(word.word))
      .filter(Boolean)
      .sort()
      .join(',')}`.slice(0, 220),
  };

  window.__jsonImportBatchActive = true;
  window.__suppressUnlockNotices = true;
  window.__suppressCloudWordsSnapshot = Boolean(window.auth?.currentUser);

  try {
    window.words = [...toAdd, ...window.words];

    const uploadResult = await uploadImportedWordsToCloud(toAdd);

    persistDictionary();
    renderLimit = 20;
    render();

    finalizeJsonImport(ctx, uploadResult);
  } catch (err) {
    console.error('importData:', err);
    showToast('صار خطأ أثناء الاستيراد. جرب مرة ثانية.');
    window.__suppressCloudWordsSnapshot = false;
  } finally {
    window.__jsonImportBatchActive = false;
    window.__suppressUnlockNotices = false;
  }
};


// ═══════════════════════════════════════════════════════
// Treasure Loot & Titles
// ═══════════════════════════════════════════════════════
