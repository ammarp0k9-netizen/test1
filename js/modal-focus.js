(function(root) {
  'use strict';
  const frames = new Map();
  const isolated = new Map();
  const focusSelector = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]';
  let observer = null, scheduled = null, activeSurface = null;

  function visible(node) {
    return Boolean(node?.isConnected && !node.closest('[hidden], [aria-hidden="true"]') &&
      getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length);
  }
  function surfaceFor(dialog) {
    for (const frame of frames.values()) if (frame.root === dialog || frame.root.contains(dialog)) return frame.root;
    return dialog.closest('.custom-modal, .app-auth-dialog-shell, .feedback-dialog-shell, .word-hunter-modal, #entryExperienceRoot') || dialog;
  }
  function inTopLayer(dialog) {
    if (dialog.tagName !== 'DIALOG' || !dialog.open) return false;
    try { return dialog.matches(':modal'); }
    catch { return dialog.hasAttribute('data-native-modal'); }
  }
  function layer() {
    const candidates = [];
    document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog[open]').forEach(dialog => {
      if (!visible(dialog)) return;
      const surface = surfaceFor(dialog);
      let z = 0;
      for (let node = dialog; node && node !== document.body; node = node.parentElement) {
        z = Math.max(z, Number.parseInt(getComputedStyle(node).zIndex, 10) || 0);
      }
      candidates.push({ surface, z, topLayer: inTopLayer(dialog), frame: frames.get(surface) });
    });
    // showModal() puts a native dialog above every CSS stacking context.
    candidates.sort((a, b) => Number(a.topLayer) - Number(b.topLayer) || (!a.topLayer ? a.z - b.z : 0));
    return candidates[candidates.length - 1] || null;
  }
  function restoreIsolation() {
    isolated.forEach((value, node) => { node.inert = value; });
    isolated.clear();
  }
  function companion(surface) {
    return root.LootLinguaPopover?.companionFor?.(surface);
  }
  function contains(surface, node) {
    return surface.contains(node) || companion(surface)?.contains(node);
  }
  function reconcile() {
    const previousSurface = activeSurface;
    restoreIsolation();
    const current = layer();
    activeSurface = current?.surface || null;
    if (!current || !frames.size) return current;
    for (let branch = current.surface; branch && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of branch.parentElement?.children || []) {
        if (sibling === branch || sibling === companion(current.surface) || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
        if (!isolated.has(sibling)) isolated.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }
    if (current.surface !== previousSurface && !contains(current.surface, document.activeElement)) {
      requestAnimationFrame(() => {
        if (layer()?.surface !== current.surface || contains(current.surface, document.activeElement)) return;
        const frame = current.frame || { root: current.surface, dialog: current.surface.querySelector('[role="dialog"]') || current.surface };
        if (!frame.dialog.hasAttribute('tabindex')) frame.dialog.tabIndex = -1;
        if (visible(frame.lastFocused) && !frame.lastFocused.closest('[inert]')) frame.lastFocused.focus({ preventScroll: true });
        else focusInside(frame);
      });
    }
    return current;
  }
  function focusable(frame) {
    return [...frame.dialog.querySelectorAll(focusSelector), ...(companion(frame.root)?.querySelectorAll(focusSelector) || [])].filter(node =>
      node.tabIndex >= 0 && !node.closest('[inert]') && visible(node));
  }
  function focusInside(frame, last = false) {
    const items = focusable(frame);
    const target = last ? items[items.length - 1] : items[0];
    (target || frame.dialog).focus({ preventScroll: true });
  }
  function onFocus(event) {
    const current = layer();
    if (!current?.frame) return;
    if (contains(current.surface, event.target)) current.frame.lastFocused = event.target;
    else focusInside(current.frame);
  }
  function onKey(event) {
    if (event.defaultPrevented || !['Escape', 'Tab'].includes(event.key)) return;
    const current = reconcile();
    if (!current?.frame) return;
    const frame = current.frame;
    if (event.key === 'Escape' && typeof frame.onEscape === 'function') {
      event.preventDefault(); event.stopImmediatePropagation(); frame.onEscape(); return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(frame), first = items[0], last = items[items.length - 1];
    if (companion(frame.root) && items.length) {
      const index = items.indexOf(document.activeElement);
      const next = index < 0 ? (event.shiftKey ? last : first)
        : items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length];
      event.preventDefault();
      next.focus({ preventScroll: true });
      return;
    }
    if (!items.length || document.activeElement === frame.dialog || !frame.dialog.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault(); focusInside(frame, event.shiftKey);
    }
  }
  function watch() {
    if (observer) return;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    observer = new MutationObserver(() => {
      if (scheduled !== null) return;
      scheduled = requestAnimationFrame(() => { scheduled = null; reconcile(); });
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'] });
  }
  function stop() {
    observer?.disconnect(); observer = null;
    if (scheduled !== null) cancelAnimationFrame(scheduled);
    scheduled = null; activeSurface = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocus, true);
    restoreIsolation();
  }
  function open(element, options = {}) {
    if (!element || frames.has(element)) return;
    const dialog = options.dialog || element;
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    const frame = { root: element, dialog, onEscape: options.onEscape, returnFocus: document.activeElement };
    frames.set(element, frame); watch(); reconcile();
    const enter = (attempt = 0) => {
      if (frames.get(element) !== frame) return;
      const current = reconcile();
      if (current?.surface === element) { focusInside(frame); return; }
      // CSS visibility transitions can leave the opening layer hidden during
      // the synchronous reconciliation and its first animation frame. Computed
      // style changing later does not emit a DOM mutation. Reconcile again so
      // entering the layer also establishes background isolation.
      if (attempt < 30 && !visible(element) && !element.closest('[hidden], [aria-hidden="true"]')) {
        requestAnimationFrame(() => enter(attempt + 1));
      }
    };
    requestAnimationFrame(() => enter());
  }
  function close(element, options = {}) {
    const frame = frames.get(element);
    if (!frame) return;
    const wasActive = activeSurface === element;
    frames.delete(element);
    const next = frames.size ? reconcile() : (stop(), null);
    if (options.restoreFocus === false || !wasActive || (next && !next.frame)) return;
    requestAnimationFrame(() => {
      const target = frame.returnFocus;
      if (target?.isConnected && !target.closest('[inert]') && visible(target)) target.focus({ preventScroll: true });
      else if (next?.frame) focusInside(next.frame);
    });
  }
  root.LootLinguaModalFocus = Object.freeze({ open, close,
    closeAll() { frames.clear(); stop(); },
  });
})(window);
