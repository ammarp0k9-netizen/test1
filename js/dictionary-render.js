function highlightText(text, query) {
  const value = String(text ?? '');
  if (!query || !value) return escapeHtml(value);
  const needle = String(query).toLowerCase();
  const lower = value.toLowerCase();
  let cursor = 0, match, html = '';
  while ((match = lower.indexOf(needle, cursor)) !== -1) {
    html += escapeHtml(value.slice(cursor, match)) + '<span class="highlight">' +
      escapeHtml(value.slice(match, match + needle.length)) + '</span>';
    cursor = match + needle.length;
  }
  return html + escapeHtml(value.slice(cursor));
}

let dictionaryRenderRevision = 0;
let dictionaryListCache = null;
let dictionaryMeasurements = new Map();
let dictionaryMeasurementScope = '';
let dictionaryResizeObserver = null;
let dictionaryMeasureFrame = null;
let dictionaryRenderWidth = 0;
let dictionaryFullDataRequest = null;
let dictionaryDraggedCard = null;
window.releaseDictionaryDraggedCard = function() {
  if (dictionaryDraggedCard?.classList.contains('dictionary-drag-parked')) dictionaryDraggedCard.remove();
  dictionaryDraggedCard = null;
};
window.cancelDictionaryFullDataRequest = function() {
  dictionaryFullDataRequest?.controller.abort();
  dictionaryFullDataRequest = null;
};

window.invalidateDictionaryRender = function() { dictionaryRenderRevision += 1; };
window.addEventListener('lootlingua:learning-data-changed', window.invalidateDictionaryRender);
window.addEventListener('lootlingua:auth-state', () => {
  window.cancelDictionaryFullDataRequest();
  window.releaseDictionaryDraggedCard();
  dictionaryListCache = null;
  dictionaryMeasurements.clear();
  dictionaryRenderRevision += 1;
});

function getDictionaryListSnapshot(query, searchType) {
  const scope = getStorageUserId() + ':' + getActiveDictionaryStorageScope();
  const key = JSON.stringify([scope, query, searchType, currentFilter, dictionarySortMode, dictionarySortCategory, isReorderMode]);
  const source = window.words;
  if (dictionaryListCache && dictionaryListCache.key === key &&
      dictionaryListCache.source === source && dictionaryListCache.revision === dictionaryRenderRevision && renderLimit > 20) {
    return dictionaryListCache;
  }
  let filtered = source.filter(word => {
    if (!word.word || window.LootLinguaWordLifecycle?.isVisibleInDictionaryList(word) === false) return false;
    if (currentFilter !== 'all' && !word.starred) return false;
    if (!query) return true;
    const matchesWord = String(word.word).toLowerCase().includes(query);
    const matchesMeaning = String(word.meaning || '').toLowerCase().includes(query);
    const matchesExample = String(word.example || '').toLowerCase().includes(query);
    return searchType === 'word' ? matchesWord : searchType === 'meaning' ? matchesMeaning :
      searchType === 'example' ? matchesExample : matchesWord || matchesMeaning || matchesExample;
  });
  if (query) {
    filtered.sort((a, b) => Number(String(b.word).toLowerCase().startsWith(query)) -
      Number(String(a.word).toLowerCase().startsWith(query)) || String(a.word).localeCompare(String(b.word)));
  } else if (!isReorderMode && window.LootLinguaDictionaryPages?.current()?.state().complete !== false) filtered = sortDictionaryWords(filtered);
  if (scope !== dictionaryMeasurementScope) {
    dictionaryMeasurements.clear();
    dictionaryMeasurementScope = scope;
  }
  const previous = dictionaryListCache;
  const sameOrder = previous?.scope === scope && previous.filtered.length === filtered.length &&
    previous.filtered.every((word, index) => String(word.id) === String(filtered[index].id));
  const heights = sameOrder ? previous.heights : window.LootLinguaDictionaryWindow.createHeightIndex(filtered.length);
  if (!sameOrder) filtered.forEach((word, index) => {
    const measured = dictionaryMeasurements.get(String(word.id));
    if (measured && measured.expanded === Boolean(word.expanded)) heights.measure(index, measured.height);
  });
  dictionaryListCache = {
    key, scope, source, revision: dictionaryRenderRevision, filtered, heights,
    indexMap: new Map(source.map((word, index) => [String(word.id), index])),
    filteredIndex: new Map(filtered.map((word, index) => [String(word.id), index])),
    queryChanged: Boolean(previous && previous.scope === scope && previous.key !== key),
  };
  renderLimit = WORD_DOM_WINDOW_SIZE;
  window.LootLinguaOperations?.diagnostic?.('dictionary-filter-pass', { wordCount: source.length });
  return dictionaryListCache;
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
  const safeId = escapeHtml(String(w.id));
  const returnToPersonalAction = isCustomWorldView() &&
    window.LootLinguaWordLifecycle?.isMovedToPrivateWorld?.(w)
    ? `<button class="icon-circle return-personal-btn" data-tip="إعادة للقاموس الشخصي" data-action="return-personal" data-id="${safeId}"><i class="fa-solid fa-arrow-rotate-left"></i></button>`
    : '';

  return `
    <li ${drag} class="${cls}" tabindex="0" data-action="toggle-expand" data-index="${ri}" data-id="${safeId}" aria-expanded="${Boolean(w.expanded)}">
      <div class="word-body" style="flex:1;min-width:0;" data-action="toggle-expand" data-index="${ri}">
        <div class="dictionary-word-heading" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;">
          <button class="star-btn ${w.starred ? 'active' : ''}" data-tip="صعبة"
                  aria-label="كلمة صعبة" aria-pressed="${Boolean(w.starred)}" data-action="star" data-id="${safeId}">
            <i class="fas fa-star"></i>
          </button>
          <div class="dictionary-word-copy">
            <div class="word-text">
              <span class="dictionary-word-label" dir="ltr" lang="en">${highlightText(w.word, query)}</span>
              ${w.category ? `<span class="cat-tag tag-${safeClassToken(w.category)}">${escapeHtml(w.category)}</span>` : ''}
              ${w.partOfSpeech ? `<span class="pos-tag">${escapeHtml(w.partOfSpeech)}</span>` : ''}
              ${renderMasteryIndicator(w)}
            </div>
            <div class="meaning-text">${highlightText(w.meaning, query)}</div>
          </div>
        </div>
        ${w.expanded ? renderWordCardDetails(w) : ''}
      </div>
      ${isReorderMode
        ? '<span style="font-size:20px;color:var(--text-gray);padding:0 8px;flex-shrink:0;">☰</span>'
        : isBulkDeleteMode
          ? `<span class="selection-state">${bulkSelectedWordIds.has(String(w.id)) ? 'محدد' : 'تحديد'}</span>`
        : `<div class="actions">
             <button class="icon-circle sound-btn" aria-label="نطق الكلمة" data-tip="نطق" data-action="sound" data-id="${safeId}"><i class="fas fa-volume-up" aria-hidden="true"></i></button>
             ${returnToPersonalAction}
             <button class="icon-circle edit-btn" aria-label="تعديل الكلمة" data-tip="تعديل" data-action="edit" data-id="${safeId}"><i class="fas fa-edit" aria-hidden="true"></i></button>
             <button class="icon-circle del-btn" aria-label="حذف الكلمة" data-tip="حذف" data-action="delete" data-id="${safeId}"><i class="fas fa-trash-alt" aria-hidden="true"></i></button>
           </div>`
      }
    </li>`;
}

function ensureWordCardDetails(word, card) {
  if (!card || card.querySelector('.word-card-details')) return;
  card.querySelector('.word-body')?.insertAdjacentHTML('beforeend', renderWordCardDetails(word));
}
window.ensureWordCardDetails = ensureWordCardDetails;

function cancelWordWindowTransition() {
  // Retained for view cleanup; scrolling no longer has a pinned/loading phase.
  clearTimeout(wordVirtualState.transitionTimer);
  clearTimeout(wordVirtualState.loadingTimer);
  wordVirtualState.isTransitioning = false;
  document.getElementById('wordRenderLoading')?.remove();
}

function prepareWordWindowForTopJump() {
  if (isEditableDictionaryView() && !isReorderMode) render({ scrollYOverride: 0 });
}

function updateDictionarySpacers(list, snapshot) {
  const top = list.querySelector('[data-word-spacer="top"]');
  const bottom = list.querySelector('[data-word-spacer="bottom"]');
  if (top) top.style.height = snapshot.heights.offset(wordVirtualState.start) + 'px';
  if (bottom) bottom.style.height = Math.max(0, snapshot.heights.offset(snapshot.filtered.length) -
    snapshot.heights.offset(wordVirtualState.end)) + 'px';
}

function measureDictionaryCards() {
  const list = document.getElementById('list');
  const snapshot = dictionaryListCache;
  if (!snapshot || !list || !isEditableDictionaryView()) return;
  const listTop = list.getBoundingClientRect().top + window.scrollY;
  const viewportOffset = Math.max(0, window.scrollY - listTop);
  const anchorIndex = snapshot.heights.indexAt(viewportOffset);
  const beforeAnchor = snapshot.heights.offset(anchorIndex);
  // Read layout in one pass, then update spacer styles once.
  const measurements = [...list.querySelectorAll('.word-card:not(.dictionary-drag-parked)')].map(card => ({
    card, height: card.getBoundingClientRect().height + parseFloat(getComputedStyle(card).marginBottom || 0),
  }));
  let changed = false;
  measurements.forEach(({ card, height }) => {
    const index = snapshot.filteredIndex.get(card.dataset.id);
    if (index === undefined) return;
    const word = snapshot.filtered[index];
    dictionaryMeasurements.set(card.dataset.id, { height, expanded: Boolean(word.expanded) });
    changed = snapshot.heights.measure(index, height) || changed;
  });
  if (!changed) return;
  updateDictionarySpacers(list, snapshot);
  const anchorDelta = snapshot.heights.offset(anchorIndex) - beforeAnchor;
  // Correct only measured geometry above the viewport, never pin wheel/touch input.
  if (Math.abs(anchorDelta) > 0.5 && window.scrollY > listTop) {
    window.scrollBy({ top: anchorDelta, behavior: 'instant' });
  }
  scheduleWordScrollWindowCheck();
}

function scheduleDictionaryMeasurement() {
  if (dictionaryMeasureFrame !== null) return;
  dictionaryMeasureFrame = requestAnimationFrame(() => {
    dictionaryMeasureFrame = null;
    measureDictionaryCards();
  });
}

function reconcileDictionaryCards(list, displayWords, snapshot, query, start, end) {
  dictionaryResizeObserver ||= typeof ResizeObserver === 'function'
    ? new ResizeObserver(scheduleDictionaryMeasurement) : null;
  const existing = new Map([...list.querySelectorAll('.word-card')].map(card => [card.dataset.id, card]));
  const template = document.createElement('template');
  const nodes = [];
  function spacer(position) {
    let element = list.querySelector('[data-word-spacer="' + position + '"]');
    if (!element) {
      element = document.createElement('li');
      element.className = 'virtual-list-spacer';
      element.dataset.wordSpacer = position;
      element.setAttribute('aria-hidden', 'true');
    }
    nodes.push(element);
  }
  spacer('top');
  let created = 0, updated = 0;
  displayWords.forEach((word, offset) => {
    const id = String(word.id);
    const markup = renderWordCard(word, query, snapshot.indexMap);
    let card = existing.get(id);
    if (!card || card.__wordMarkup !== markup) {
      template.innerHTML = markup.trim();
      const replacement = template.content.firstElementChild;
      if (card) {
        card.className = replacement.className;
        card.innerHTML = replacement.innerHTML;
        [...replacement.attributes].forEach(attribute => card.setAttribute(attribute.name, attribute.value));
        if (!isReorderMode) card.removeAttribute('draggable');
        updated += 1;
      } else {
        card = replacement;
        created += 1;
      }
      card.__wordMarkup = markup;
    }
    card.setAttribute('aria-posinset', String(start + offset + 1));
    card.classList.remove('dictionary-drag-parked');
    card.setAttribute('aria-setsize', String(snapshot.filtered.length));
    dictionaryResizeObserver?.observe(card);
    nodes.push(card);
    existing.delete(id);
  });
  spacer('bottom');
  if (dictionaryDraggedCard && !nodes.includes(dictionaryDraggedCard)) {
    dictionaryResizeObserver?.unobserve(dictionaryDraggedCard);
    dictionaryDraggedCard.classList.add('dictionary-drag-parked');
    nodes.push(dictionaryDraggedCard);
  }
  const wanted = new Set(nodes);
  [...list.children].forEach(node => {
    if (!wanted.has(node)) {
      dictionaryResizeObserver?.unobserve(node);
      node.remove();
    }
  });
  let cursor = list.firstElementChild;
  nodes.forEach(node => {
    if (node === cursor) cursor = cursor.nextElementSibling;
    else list.insertBefore(node, cursor);
  });
  wordVirtualState.start = start;
  wordVirtualState.end = end;
  wordVirtualState.total = snapshot.filtered.length;
  updateDictionarySpacers(list, snapshot);
  window.LootLinguaOperations?.diagnostic?.('dictionary-window-render', { created, updated, retained: displayWords.length - created, visibleCards: displayWords.length });
}

function renderDictionaryWindow(options = {}) {
  if (!isEditableDictionaryView()) return;
  const search = document.getElementById('searchInput');
  const list = document.getElementById('list');
  if (!search || !list) return;
  const query = search.value.toLowerCase().trim();
  const pages = isCustomWorldView() ? null : window.LootLinguaDictionaryPages?.current();
  const serverSorted = pages?.state().queryMode === dictionarySortMode && ['auto', 'newest', 'oldest'].includes(dictionarySortMode);
  const fullDataKey = pages && (query || currentFilter !== 'all' || dictionarySortMode !== 'auto' && !serverSorted)
    ? JSON.stringify([pages.ownerId, query, currentFilter, dictionarySortMode, dictionarySortCategory]) : '';
  if (dictionaryFullDataRequest?.key !== fullDataKey) window.cancelDictionaryFullDataRequest();
  if (fullDataKey && !dictionaryFullDataRequest && !pages.state().complete && !pages.state().error) {
    const request = { key: fullDataKey, controller: new AbortController() };
    dictionaryFullDataRequest = request;
    pages.ensureComplete({ signal: request.controller.signal }).catch(() => {}).finally(() => {
      if (dictionaryFullDataRequest === request) dictionaryFullDataRequest = null;
    });
  }
  const searchType = document.getElementById('searchFilter')?.value || 'all';
  const snapshot = getDictionaryListSnapshot(query, searchType);
  const listWasCleared = !list.querySelector('.word-card, .virtual-list-spacer');
  if (listWasCleared) dictionaryResizeObserver?.disconnect();
  list.classList.add('dictionary-windowed');
  const width = list.getBoundingClientRect().width;
  if (dictionaryRenderWidth && Math.abs(width - dictionaryRenderWidth) > 1) {
    dictionaryMeasurements.clear();
    snapshot.heights = window.LootLinguaDictionaryWindow.createHeightIndex(snapshot.filtered.length);
  }
  dictionaryRenderWidth = width;
  if (!snapshot.filtered.length) {
    dictionaryResizeObserver?.disconnect();
    if (list.dataset.emptyKey !== snapshot.key || listWasCleared) {
      list.innerHTML = '<li class="dictionary-empty"><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>' +
        (pages && !pages.state().complete ? (pages.state().error ? 'تعذّر تحميل الكلمات. أعد المحاولة أدناه.' : 'جارٍ تحميل كلماتك…') :
          query ? 'ما في نتائج للبحث' : 'قاموسك فاضي، ابدأ بإضافة كلمة!') + '</span></li>';
      list.dataset.emptyKey = snapshot.key;
    }
    wordVirtualState.total = 0;
    return;
  }
  delete list.dataset.emptyKey;
  const listTop = list.getBoundingClientRect().top + window.scrollY;
  let scrollY = typeof options.scrollYOverride === 'number' ? options.scrollYOverride : window.scrollY;
  if (listWasCleared && typeof viewScrollY !== 'undefined' && typeof viewScrollY[getActiveDictionaryStorageScope()] === 'number') {
    scrollY = options.scrollYOverride ?? viewScrollY[getActiveDictionaryStorageScope()];
  }
  if (snapshot.queryChanged) {
    scrollY = Math.min(scrollY, Math.max(0, listTop - 100));
    if (window.scrollY > scrollY) window.scrollTo({ top: scrollY, behavior: 'instant' });
    snapshot.queryChanged = false;
  }
  const range = snapshot.heights.range(Math.max(0, scrollY - listTop), window.innerHeight, 12);
  const displayWords = snapshot.filtered.slice(range.start, range.end);
  reconcileDictionaryCards(list, displayWords, snapshot, query, range.start, range.end);
  if (pages) {
    const buckets = [...new Set(displayWords.map(word => Math.floor(snapshot.indexMap.get(String(word.id)) / 80)))];
    const observed = query ? displayWords : buckets.slice(0, 2).flatMap(bucket => window.words.slice(bucket * 80, bucket * 80 + 80));
    window.watchPersonalDictionaryRows?.(observed.map(word => word.id));
  }
  scheduleDictionaryMeasurement();
  scheduleDictionaryPageCheck();
}

function render(options = {}) {
  updateDictionaryPageStatus();
  const run = () => renderDictionaryWindow(options);
  return typeof window.withWordMasterySnapshot === 'function' ? window.withWordMasterySnapshot(run) : run();
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

  list.addEventListener('dragstart', event => {
    if (isReorderMode) dictionaryDraggedCard = event.target.closest('.word-card');
  }, { capture: true });

  list.addEventListener('keydown', (event) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || !event.target.matches('.word-card')) return;
    event.preventDefault();
    handleLiClick(Number(event.target.dataset.index), event.target);
  });

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
      case 'return-personal': window.returnPrivateWordToPersonalDictionary?.(id, e); break;
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

});

// One render per animation frame; native wheel/touch scrolling stays in control.
let wordRenderScrollRaf = null;
let dictionaryPageCheckRaf = null;
function scheduleDictionaryPageCheck() {
  if (dictionaryPageCheckRaf !== null) return;
  dictionaryPageCheckRaf = requestAnimationFrame(() => {
    dictionaryPageCheckRaf = null;
    const pages = window.LootLinguaDictionaryPages?.current();
    if (!pages || currentView !== 'personal' || isReorderMode) return;
    const state = pages.state();
    if (state.complete || state.loading || state.error) return;
    const list = document.getElementById('list');
    if (list && list.getBoundingClientRect().bottom < window.innerHeight + 1800) pages.next().catch(() => {});
  });
}

function updateDictionaryPageStatus() {
  const list = document.getElementById('list');
  if (!list) return;
  let status = document.getElementById('dictionaryLoadStatus');
  if (!status) {
    status = document.createElement('div');
    status.id = 'dictionaryLoadStatus';
    status.className = 'dictionary-load-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    list.after(status);
    status.addEventListener('click', event => {
      if (event.target.closest('button')) window.LootLinguaDictionaryPages?.current()?.next().catch(() => {});
    });
  }
  const pages = currentView === 'personal' ? window.LootLinguaDictionaryPages?.current() : null;
  const state = pages?.state();
  status.hidden = !state || (state.complete && !state.offline);
  if (status.hidden) return;
  status.setAttribute('aria-busy', String(state.loading));
  if (state.offline) status.textContent = 'تعرض نسخة محفوظة على هذا الجهاز لحين عودة الاتصال.';
  else if (state.error) status.innerHTML = 'تعذّر تحميل بقية الكلمات. <button type="button">إعادة المحاولة</button>';
  else status.textContent = state.loading ? (document.getElementById('searchInput')?.value.trim() ? 'جارٍ البحث في بقية القاموس…' : 'جارٍ تحميل كلمات إضافية…') : '';
}
window.addEventListener('lootlingua:dictionary-page-state', () => {
  updateDictionaryPageStatus();
  scheduleDictionaryPageCheck();
  if (currentView === 'personal') {
    const empty = document.querySelector('#list .dictionary-empty');
    if (empty) { delete document.getElementById('list').dataset.emptyKey; render(); }
  }
  refreshFeatureUnlockUI();
});
function scheduleWordScrollWindowCheck() {
  scheduleDictionaryPageCheck();
  if (wordRenderScrollRaf !== null) return;
  wordRenderScrollRaf = requestAnimationFrame(() => {
    wordRenderScrollRaf = null;
    if (!isEditableDictionaryView() || !dictionaryListCache?.filtered.length) return;
    const list = document.getElementById('list');
    if (!list) return;
    const top = list.getBoundingClientRect().top + window.scrollY;
    const range = dictionaryListCache.heights.range(Math.max(0, window.scrollY - top), window.innerHeight, 12);
    if (range.start !== wordVirtualState.start || range.end !== wordVirtualState.end) render();
  });
}
window.addEventListener('scroll', scheduleWordScrollWindowCheck, { passive: true });
window.addEventListener('dragend', () => {
  window.releaseDictionaryDraggedCard();
  if (isEditableDictionaryView()) render();
});
window.addEventListener('resize', () => {
  // Mobile browser chrome changes height on scroll. Only a real list-width
  // change (checked by render) invalidates measured card heights.
  if (isEditableDictionaryView()) render();
}, { passive: true });

// ═══════════════════════════════════════════════════════
