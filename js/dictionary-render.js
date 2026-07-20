function highlightText(text, query) {
  if (!query || !text) return text || '';
  try {
    return text.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, "gi"), '<span class="highlight">$1</span>');
  } catch { return text; }
}

function getWordRenderKey(query, searchType, filtered) {
  return [
    getActiveDictionaryStorageScope(),
    query,
    searchType,
    currentFilter,
    dictionarySortMode,
    dictionarySortCategory,
    isBulkDeleteMode ? 'bulk' : 'normal',
    [...bulkSelectedWordIds].join(','),
    window.words.length,
    filtered.length,
    filtered[0]?.id || '',
    filtered[filtered.length - 1]?.id || ''
  ].join('|');
}

function getCenteredWordWindowStart(firstVisible, viewportRows, total) {
  const maxStart = Math.max(0, total - WORD_DOM_WINDOW_SIZE);
  const sideBuffer = Math.max(WORD_DOM_BUFFER, Math.floor((WORD_DOM_WINDOW_SIZE - viewportRows) / 2));
  return Math.max(0, Math.min(maxStart, firstVisible - sideBuffer));
}

function getWordWindowRange(total, listEl, resetWindow, scrollYOverride) {
  if (resetWindow) {
    wordVirtualState.start = 0;
    wordVirtualState.end = 0;
    wordVirtualState.listTop = 0;
    wordVirtualState.lastHtmlKey = '';
    wordVirtualState.total = total;
  }
  if (!WORD_RENDER_FAST_MODE || total <= WORD_DOM_WINDOW_SIZE || isReorderMode) {
    wordVirtualState.total = total;
    return { start: 0, end: total, topSpacer: 0, bottomSpacer: 0 };
  }

  const rect = listEl.getBoundingClientRect();
  const listTop = wordVirtualState.listTop || (rect.top + window.scrollY);
  wordVirtualState.listTop = listTop;

  const rowH = Math.max(86, wordVirtualState.rowHeight || 126);
  const scrollY = typeof scrollYOverride === 'number' ? scrollYOverride : window.scrollY;
  const viewportStart = Math.max(0, scrollY - listTop);
  const viewportRows = Math.ceil(window.innerHeight / rowH);
  const firstVisible = Math.max(0, Math.floor(viewportStart / rowH));
  const lastVisible = Math.min(total - 1, firstVisible + viewportRows);
  let start = wordVirtualState.start || 0;
  const canReuseWindow =
    !resetWindow &&
    wordVirtualState.total === total &&
    wordVirtualState.end > wordVirtualState.start &&
    firstVisible >= wordVirtualState.start + WORD_DOM_BUFFER &&
    lastVisible <= wordVirtualState.end - WORD_DOM_EDGE_BUFFER;

  if (!canReuseWindow) {
    start = getCenteredWordWindowStart(firstVisible, viewportRows, total);
  }
  const end = Math.min(total, start + WORD_DOM_WINDOW_SIZE);
  wordVirtualState.total = total;

  return {
    start,
    end,
    topSpacer: start * rowH,
    bottomSpacer: Math.max(0, (total - end) * rowH)
  };
}

function wordDetailText(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join('، ');
  return String(value || '').trim();
}

function renderWordDetailRow(label, value, options = {}) {
  const text = wordDetailText(value);
  if (!text) return '';
  const dir = options.dir ? ` dir="${options.dir}"` : '';
  const lang = options.lang ? ` lang="${options.lang}"` : '';
  return `
    <div class="word-detail-row"${dir}${lang}>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(text)}</span>
    </div>`;
}

function renderWordCardDetails(w) {
  const meaning = wordDetailText(w.meaning);
  const definitionAr = wordDetailText(w.definition_ar || w.definitionAr);
  const definition = wordDetailText(w.definition);
  const rows = [];
  if (definitionAr && definitionAr !== meaning) {
    rows.push(renderWordDetailRow('التعريف بالعربية', definitionAr));
  }
  if (definition && definition !== meaning && definition !== definitionAr) {
    rows.push(renderWordDetailRow('Definition', definition, { dir: 'ltr', lang: 'en' }));
  }
  rows.push(renderWordDetailRow('Example', w.example, { dir: 'ltr', lang: 'en' }));
  rows.push(renderWordDetailRow('ترجمة المثال', w.exampleTranslation));
  rows.push(renderWordDetailRow('النطق', w.pronunciation, { dir: 'ltr', lang: 'en' }));
  rows.push(renderWordDetailRow('المستوى', w.level));
  rows.push(renderWordDetailRow('المرادفات', w.synonyms, { dir: 'ltr', lang: 'en' }));
  rows.push(renderWordDetailRow('الوسوم', w.tags));
  rows.push(renderWordDetailRow('ملاحظات', w.notes));
  const content = rows.filter(Boolean).join('');
  return content ? `<div class="example-box word-card-details">${content}</div>` : '';
}

function renderWordCard(w, query, indexMap) {
  const ri   = indexMap?.get(String(w.id)) ?? window.words.findIndex(x => x.id === w.id);
  const drag = isReorderMode
    ? `draggable="true" ondragstart="drag(event,${ri})" ondragover="allowDrop(event)" ondrop="drop(event,${ri})"`
    : '';
  const cls = ['word-card', isReorderMode ? 'reorder-mode-li' : '',
               selectedIndices.includes(ri) ? 'selected-for-move' : '',
               isBulkDeleteMode && bulkSelectedWordIds.has(String(w.id)) ? 'bulk-selected' : '',
               w.expanded ? 'show-example' : '']
    .filter(Boolean).join(' ');
  const safeId = w.id.replace(/'/g, "\\'");

  return `
    <li ${drag} class="${cls}" data-action="toggle-expand" data-index="${ri}" data-id="${safeId}" aria-expanded="${Boolean(w.expanded)}">
      <div class="word-body" style="flex:1;min-width:0;" data-action="toggle-expand" data-index="${ri}">
        <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;">
          <button class="star-btn ${w.starred ? 'active' : ''}" data-tip="صعبة"
                  data-action="star" data-id="${safeId}">
            <i class="fas fa-star"></i>
          </button>
          <div>
            <div class="word-text">
              ${highlightText(w.word, query)}
              ${w.category ? `<span class="cat-tag tag-${safeClassToken(w.category)}">${escapeHtml(w.category)}</span>` : ''}
              ${w.partOfSpeech ? `<span class="pos-tag">${escapeHtml(w.partOfSpeech)}</span>` : ''}
              ${renderMasteryIndicator(w)}
            </div>
            <div class="meaning-text">${highlightText(w.meaning, query)}</div>
          </div>
        </div>
        ${renderWordCardDetails(w)}
      </div>
      ${isReorderMode
        ? '<span style="font-size:20px;color:var(--text-gray);padding:0 8px;flex-shrink:0;">☰</span>'
        : isBulkDeleteMode
          ? `<span class="selection-state">${bulkSelectedWordIds.has(String(w.id)) ? 'محدد' : 'تحديد'}</span>`
        : `<div class="actions">
             <button class="icon-circle sound-btn" data-tip="نطق" data-action="sound" data-id="${safeId}"><i class="fas fa-volume-up"></i></button>
             <button class="icon-circle edit-btn"  data-tip="تعديل" data-action="edit" data-id="${safeId}"><i class="fas fa-edit"></i></button>
             <button class="icon-circle del-btn"   data-tip="حذف" data-action="delete" data-id="${safeId}"><i class="fas fa-trash-alt"></i></button>
           </div>`
      }
    </li>`;
}

function updateWordRowHeight(listEl) {
  requestAnimationFrame(() => {
    const card = listEl.querySelector('.word-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.height > 40) {
      wordVirtualState.rowHeight = Math.round(rect.height + 12);
    }
  });
}

function getWordRenderMetrics(listEl) {
  if (!listEl || !wordVirtualState.total) return null;
  const rowH = Math.max(86, wordVirtualState.rowHeight || 126);
  const listTop = wordVirtualState.listTop || (listEl.getBoundingClientRect().top + window.scrollY);
  const visibleRows = Math.ceil(window.innerHeight / rowH);
  return { rowH, listTop, visibleRows };
}

function getWordScrollWindowState(listEl, scrollY = window.scrollY) {
  const metrics = getWordRenderMetrics(listEl);
  if (!metrics) return null;
  const firstVisible = Math.max(0, Math.floor(Math.max(0, scrollY - metrics.listTop) / metrics.rowH));
  const lastVisible = firstVisible + metrics.visibleRows;
  return { ...metrics, firstVisible, lastVisible };
}

function showWordRenderLoading(show) {
  let loader = document.getElementById('wordRenderLoading');
  if (!loader && show) {
    loader = document.createElement('div');
    loader.id = 'wordRenderLoading';
    loader.className = 'word-render-loading';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>جاري تجهيز الكلمات...</span>';
    document.body.appendChild(loader);
  }
  if (loader) loader.classList.toggle('show', !!show);
}

function cancelWordWindowTransition() {
  clearTimeout(wordVirtualState.transitionTimer);
  clearTimeout(wordVirtualState.loadingTimer);
  wordVirtualState.isTransitioning = false;
  wordVirtualState.transitionTargetY = null;
  wordVirtualState.transitionPinnedY = null;
  showWordRenderLoading(false);
}

function setWordProgrammaticScroll(top) {
  wordVirtualState.programmaticScroll = true;
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  requestAnimationFrame(() => {
    wordVirtualState.programmaticScroll = false;
  });
}

function finishWordWindowTransition(targetY) {
  clearTimeout(wordVirtualState.transitionTimer);
  wordVirtualState.transitionTimer = setTimeout(() => {
    clearTimeout(wordVirtualState.loadingTimer);
    setWordProgrammaticScroll(targetY);
    wordVirtualState.isTransitioning = false;
    wordVirtualState.transitionTargetY = null;
    wordVirtualState.transitionPinnedY = null;
    showWordRenderLoading(false);
  }, WORD_RENDER_TRANSITION_MS);
}

function requestWordWindowTransition(targetY, pinnedY) {
  if (wordVirtualState.isTransitioning) return true;
  wordVirtualState.isTransitioning = true;
  wordVirtualState.transitionTargetY = Math.max(0, targetY);
  wordVirtualState.transitionPinnedY = Math.max(0, pinnedY);
  clearTimeout(wordVirtualState.loadingTimer);
  wordVirtualState.loadingTimer = setTimeout(() => showWordRenderLoading(true), 90);
  setWordProgrammaticScroll(wordVirtualState.transitionPinnedY);
  requestAnimationFrame(() => {
    render({
      scrollYOverride: wordVirtualState.transitionTargetY,
      forceWindowRefresh: true
    });
    requestAnimationFrame(() => finishWordWindowTransition(wordVirtualState.transitionTargetY || 0));
  });
  return true;
}

function prepareWordWindowForTopJump() {
  if (!isEditableDictionaryView() || isReorderMode) return;
  const listEl = document.getElementById('list');
  if (!listEl || !WORD_RENDER_FAST_MODE) return;
  showWordRenderLoading(true);
  render({ scrollYOverride: 0, forceWindowRefresh: true });
  requestAnimationFrame(() => {
    setWordProgrammaticScroll(0);
    setTimeout(() => showWordRenderLoading(false), WORD_RENDER_TRANSITION_MS);
  });
}

function render(options = {}) {
  // لو مش على قاموس قابل للتحرير ما نرندر
  if (!isEditableDictionaryView()) {
    refreshFeatureUnlockUI();
    return;
  }

  const searchEl = document.getElementById('searchInput');
  const filterEl = document.getElementById('searchFilter');
  if (!searchEl) {
    refreshFeatureUnlockUI();
    return;
  }

  const query      = searchEl.value.toLowerCase().trim();
  const searchType = filterEl ? filterEl.value : 'all';

  let filtered = window.words.filter(w => {
    if (!w.word) return false;
    const wm = w.word.toLowerCase().includes(query);
    const mm = (w.meaning  || '').toLowerCase().includes(query);
    const em = (w.example  || '').toLowerCase().includes(query);
    const matches = searchType === 'word'    ? wm
                  : searchType === 'meaning' ? mm
                  : searchType === 'example' ? em
                  : wm || mm || em;
    return matches && (currentFilter === 'all' || w.starred);
  });

  // ترتيب ذكي: الكلمات اللي تبدأ بالـ query تجي أول
  if (query) {
    filtered.sort((a, b) => {
      const aStarts = a.word.toLowerCase().startsWith(query);
      const bStarts = b.word.toLowerCase().startsWith(query);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.word.localeCompare(b.word);
    });
  } else if (!isReorderMode) {
    filtered = sortDictionaryWords(filtered);
  }

  const listEl = document.getElementById('list');
  if (!listEl) return;
  const listWasCleared =
    !listEl.querySelector('.word-card') &&
    !listEl.querySelector('.virtual-list-spacer');

  const renderKey = getWordRenderKey(query, searchType, filtered);
  const resetWindow = renderKey !== wordVirtualState.key || renderLimit <= 20 || listWasCleared;
  if (resetWindow) {
    if (!options.forceWindowRefresh) cancelWordWindowTransition();
    wordVirtualState.key = renderKey;
    wordVirtualState.listTop = 0;
    wordVirtualState.start = 0;
    wordVirtualState.end = 0;
    wordVirtualState.lastHtmlKey = '';
    renderLimit = WORD_DOM_WINDOW_SIZE;
  }

  if (filtered.length === 0) {
    cancelWordWindowTransition();
    wordVirtualState.lastHtmlKey = '';
    listEl.innerHTML = `
      <li style="list-style:none;text-align:center;padding:40px 20px;color:var(--text-gray);">
        <div style="font-size:32px;margin-bottom:10px;"><i class="fa-solid fa-book-open" aria-hidden="true"></i></div>
        ${query ? 'ما في نتائج للبحث' : 'قاموسك فاضي، ابدأ بإضافة كلمة!'}
      </li>`;
    refreshFeatureUnlockUI();
    return;
  }

  const restoredPersonalScroll =
    listWasCleared && viewScrollY && typeof viewScrollY[getActiveDictionaryStorageScope()] === 'number'
      ? viewScrollY[getActiveDictionaryStorageScope()]
      : undefined;
  const scrollYOverride =
    typeof options.scrollYOverride === 'number'
      ? options.scrollYOverride
      : restoredPersonalScroll;
  const range = getWordWindowRange(filtered.length, listEl, resetWindow, scrollYOverride);
  const displayWords = filtered.slice(range.start, range.end);
  const wordIndexMap = new Map(window.words.map((item, index) => [String(item.id), index]));
  const htmlKey = [
    renderKey,
    range.start,
    range.end,
    Math.round(range.topSpacer),
    Math.round(range.bottomSpacer),
    isReorderMode ? 'reorder' : 'normal',
    selectedIndices.join(',')
  ].join('|');

  let didRenderWindow = false;
  if (options.forceWindowRefresh || htmlKey !== wordVirtualState.lastHtmlKey || listWasCleared) {
    const topSpacer = range.topSpacer
      ? `<li class="virtual-list-spacer" aria-hidden="true" style="height:${Math.round(range.topSpacer)}px"></li>`
      : '';
    const bottomSpacer = range.bottomSpacer
      ? `<li class="virtual-list-spacer" aria-hidden="true" style="height:${Math.round(range.bottomSpacer)}px"></li>`
      : '';
    listEl.innerHTML = topSpacer + displayWords.map(w => renderWordCard(w, query, wordIndexMap)).join('') + bottomSpacer;
    wordVirtualState.start = range.start;
    wordVirtualState.end = range.end;
    wordVirtualState.lastHtmlKey = htmlKey;
    updateWordRowHeight(listEl);
    didRenderWindow = true;
  }
  if (didRenderWindow || resetWindow) refreshFeatureUnlockUI();
}

// ── تفويض أزرار نتائج AI (إضافة + اقتراح) ───────────────
document.addEventListener('click', (e) => {
  const addBtn = e.target.closest('[data-action="add-ai-meaning"]');
  if (addBtn) {
    e.preventDefault();
    e.stopPropagation();
    addAiMeaningCore({
      word: decodeSugAttr(addBtn.dataset.word),
      ar: decodeSugAttr(addBtn.dataset.ar),
      pos: decodeSugAttr(addBtn.dataset.pos),
      ex: decodeSugAttr(addBtn.dataset.ex),
      game: decodeSugAttr(addBtn.dataset.game) || getSuggestionGameLabel(),
    }, addBtn);
    return;
  }
  const sugBtn = e.target.closest('[data-action="submit-suggestion"]');
  if (sugBtn) {
    e.preventDefault();
    e.stopPropagation();
    submitSuggestionFromUI(sugBtn.dataset.word, sugBtn.dataset.ar, sugBtn.dataset.game, e);
  }
});

// ── Centralized Click Handling (Event Delegation) ───────
document.addEventListener('DOMContentLoaded', () => {
  initEmptyOnboardingInputWatcher();
  initAppDropdowns();
  syncAppDropdownLabels();
  bindSearchLockOverlays();
  refreshGuestSearchLocks();
  syncDictionarySortUI();
  updateBulkDeleteBar();
  renderCustomWorldCards();
  document.getElementById('customWorldEmojiPicker')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-emoji]');
    if (!btn) return;
    setEmojiPickerValue(btn.dataset.emoji);
    const icon = document.getElementById('customWorldModalIcon');
    if (icon) icon.textContent = btn.dataset.emoji;
  });

  const list = document.getElementById('list');
  if (!list) return;

  list.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id     = target.dataset.id;
    const index  = target.dataset.index;

    // Stop propagation if it's a button action to prevent li toggle
    if (action !== 'toggle-expand') e.stopPropagation();

    if (isBulkDeleteMode) {
      e.preventDefault();
      if (suppressDeleteClickOnce) {
        suppressDeleteClickOnce = false;
        return;
      }
      const row = target.closest('.word-card');
      const selectedId = id || row?.dataset.id;
      if (selectedId) toggleBulkWordSelection(selectedId);
      return;
    }

    switch (action) {
      case 'star':   window.toggleStar(id, e); break;
      case 'sound':  window.playSound(id, e);  break;
      case 'edit':   window.editWord(id, e);   break;
      case 'delete':
        if (suppressDeleteClickOnce) {
          suppressDeleteClickOnce = false;
          return;
        }
        window.deleteWord(id, e);
        break;
      case 'toggle-expand': 
        if (!isReorderMode) handleLiClick(parseInt(index), target.closest('li')); 
        break;
    }
  });

  // تصفير العداد عند كتابة أي شيء في البحث لتبدأ النتائج من الأعلى
  document.getElementById('searchInput')?.addEventListener('input', () => {
    renderLimit = 20;
  });
});

// ── Virtualized Scroll Logic ─────────────────────────────
let wordRenderScrollRaf = null;
let wordRenderScrollTimer = null;
let wordRenderLastScrollCheck = 0;
function shouldRenderWordWindowForScroll() {
  const listEl = document.getElementById('list');
  if (!listEl) return false;
  if (!listEl.querySelector('.word-card')) return true;
  if (!WORD_RENDER_FAST_MODE || !wordVirtualState.total || wordVirtualState.total <= WORD_DOM_WINDOW_SIZE) return false;

  const state = getWordScrollWindowState(listEl);
  if (!state) return false;
  const { firstVisible, lastVisible } = state;

  return (
    (wordVirtualState.start > 0 && firstVisible < wordVirtualState.start + WORD_DOM_BUFFER) ||
    (wordVirtualState.end < wordVirtualState.total && lastVisible > wordVirtualState.end - WORD_DOM_EDGE_BUFFER)
  );
}

function getWordWindowBoundaryState(listEl) {
  const state = getWordScrollWindowState(listEl);
  if (!state || wordVirtualState.end <= wordVirtualState.start) return null;
  const aboveWindow = wordVirtualState.start > 0 && state.firstVisible < wordVirtualState.start;
  const belowWindow = wordVirtualState.end < wordVirtualState.total && state.lastVisible > wordVirtualState.end;
  const nearTop = wordVirtualState.start > 0 && state.firstVisible < wordVirtualState.start + WORD_DOM_BUFFER;
  const nearBottom = wordVirtualState.end < wordVirtualState.total && state.lastVisible > wordVirtualState.end - WORD_DOM_EDGE_BUFFER;
  return { ...state, aboveWindow, belowWindow, nearTop, nearBottom };
}

function runWordScrollWindowCheck() {
  wordRenderScrollRaf = null;
  wordRenderScrollTimer = null;
  wordRenderLastScrollCheck = performance.now();

  if (!isEditableDictionaryView() || isReorderMode) return;
  if (wordVirtualState.programmaticScroll || wordVirtualState.isTransitioning) return;
  if (!shouldRenderWordWindowForScroll()) return;

  const listEl = document.getElementById('list');
  const state = getWordWindowBoundaryState(listEl);
  if (state && (state.aboveWindow || state.belowWindow)) {
    const goingUp = state.aboveWindow;
    const safeFirst = goingUp
      ? Math.max(0, wordVirtualState.start)
      : Math.max(0, wordVirtualState.end - state.visibleRows);
    const pinnedY = state.listTop + (safeFirst * state.rowH);
    if (requestWordWindowTransition(window.scrollY, pinnedY)) return;
  }
  render();
}

function scheduleWordScrollWindowCheck() {
  if (wordRenderScrollRaf || wordRenderScrollTimer) return;
  const elapsed = performance.now() - wordRenderLastScrollCheck;
  const delay = Math.max(0, WORD_RENDER_SCROLL_THROTTLE_MS - elapsed);
  const scheduleFrame = () => {
    wordRenderScrollTimer = null;
    wordRenderScrollRaf = requestAnimationFrame(runWordScrollWindowCheck);
  };
  if (delay > 0) wordRenderScrollTimer = setTimeout(scheduleFrame, delay);
  else scheduleFrame();
}

window.addEventListener('scroll', () => {
  if (!isEditableDictionaryView() || isReorderMode) return;
  if (wordVirtualState.programmaticScroll) return;
  if (wordVirtualState.isTransitioning) {
    const pinnedY = wordVirtualState.transitionPinnedY ?? window.scrollY;
    if (Math.abs(window.scrollY - pinnedY) > 4) {
      wordVirtualState.transitionTargetY = window.scrollY;
    }
    setWordProgrammaticScroll(pinnedY);
    return;
  }
  scheduleWordScrollWindowCheck();
}, { passive: true });

// ═══════════════════════════════════════════════════════
