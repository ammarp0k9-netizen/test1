(function attachLootLinguaPopover(root) {
  'use strict';

  let active = null;

  function position(element, anchor) {
    if (!element || !anchor?.getBoundingClientRect) return;
    if (anchor.isConnected === false || (anchor.getClientRects && !anchor.getClientRects().length)) {
      close({ silent: true });
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    element.style.position = 'fixed';
    // Coordinates below describe the box's left edge. Legacy help styles used
    // translateX(-50%), which shifted half the measured box off a narrow screen.
    element.style.transform = 'none';
    element.style.boxSizing = 'border-box';
    element.style.maxWidth = `${Math.max(0, window.innerWidth - margin * 2)}px`;
    element.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
    element.style.overflowY = 'auto';
    element.style.overflowWrap = 'anywhere';
    const box = element.getBoundingClientRect();
    const below = rect.bottom + 10;
    const above = rect.top - box.height - 10;
    const top = above >= margin || below + box.height > window.innerHeight - margin
      ? Math.max(margin, Math.min(above, window.innerHeight - box.height - margin))
      : below;
    const center = rect.left + rect.width / 2;
    const left = Math.max(margin, Math.min(center - box.width / 2, window.innerWidth - box.width - margin));
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
  }

  function close(options = {}) {
    if (!active) return;
    const current = active;
    active = null;
    current.element.remove();
    if (current.highlighted) current.anchor?.classList?.remove('coach-highlight-target');
    current.anchor?.setAttribute?.('aria-expanded', 'false');
    window.removeEventListener('resize', current.reposition);
    window.removeEventListener('scroll', current.reposition, true);
    document.removeEventListener('pointerdown', current.onPointerDown, true);
    document.removeEventListener('keydown', current.onKeydown, true);
    if (current.onClick) document.removeEventListener('click', current.onClick, true);
    clearTimeout(current.readTimer);
    current.onClose?.();
    window.dispatchEvent(new CustomEvent('lootlingua:popover-closed', { detail: { id: current.id || '' } }));
    if (!options.silent && current.anchor?.isConnected) {
      requestAnimationFrame(() => current.anchor.focus?.({ preventScroll: true }));
    }
  }

  function closeIf(id, options = {}) {
    if (!active || active.id !== id) return false;
    close(options);
    return true;
  }

  function getActiveId() {
    return active?.id || '';
  }

  function canAct(id) {
    return active?.id === id && (!active.readUntil || Date.now() >= active.readUntil);
  }
  function isReadingAction(target) {
    if (!active?.reading || !target || canAct(active.id)) return false;
    return active.element.contains(target) || active.reading.actions?.some((action) => action === target || action.contains(target));
  }

  function offerResume(id, resume) {
    const banner = document.getElementById('onboardingResume');
    if (!banner) return;
    if (!resume) {
      if (banner.dataset.coach === id) banner.hidden = true;
      return;
    }
    banner.dataset.coach = id;
    banner.hidden = false;
    banner.textContent = resume.label;
    banner.onclick = resume.open;
  }

  function open({ id, className, anchor, content, labelledBy, onClose, persistent = false, reading }) {
    if (!anchor || anchor.isConnected === false || (anchor.getClientRects && !anchor.getClientRects().length)) return null;
    if (active?.persistent && active.id !== id) return null;
    if (reading?.step && active?.id === id && active.anchor === anchor && active.readStep === reading.step) return active.element;
    close({ silent: true });
    const element = document.createElement('section');
    if (id) element.id = id;
    element.className = className || 'lootlingua-popover';
    element.setAttribute('role', 'dialog');
    element.setAttribute('tabindex', '-1');
    if (labelledBy) element.setAttribute('aria-labelledby', labelledBy);
    if (content instanceof Node) element.append(content);
    else element.textContent = String(content || '');
    document.body.append(element);
    const highlighted = persistent && !anchor.classList?.contains('coach-highlight-target');
    if (highlighted) anchor.classList?.add('coach-highlight-target');
    const reposition = () => position(element, anchor);
    const onPointerDown = (event) => {
      if (!persistent && !element.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const onClick = reading ? (event) => {
      const target = event.target?.closest?.('button, a, [role="button"], [data-action="select-ai-meaning"]');
      if (isReadingAction(target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    } : null;
    const onKeydown = (event) => {
      if (event.key === 'Escape' && !persistent) { event.preventDefault(); close(); }
      if (['Enter', ' '].includes(event.key)) onClick?.(event);
    };
    active = { id: id || '', element, anchor, reposition, onPointerDown, onKeydown, onClick, onClose, persistent, highlighted, reading };
    if (reading) {
      const duration = String(reading.text || '').length >= 105 ? 4000 : 3000;
      active.readUntil = Date.now() + duration;
      active.readStep = reading.step;
      element.classList.add('coach-reading');
      const hint = document.createElement('small');
      hint.className = 'coach-reading-hint';
      hint.textContent = 'اقرأ الخطوة، ثم تابع.';
      element.append(hint);
      active.readTimer = setTimeout(() => {
        element.classList.remove('coach-reading');
        hint.remove();
        reposition();
      }, duration);
      document.addEventListener('click', onClick, true);
    }
    anchor.setAttribute('aria-expanded', 'true');
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeydown, true);
    return element;
  }

  Object.defineProperty(root, 'LootLinguaPopover', {
    value: Object.freeze({ open, close, closeIf, getActiveId, canAct, isReadingAction, offerResume, position }), configurable: false, enumerable: true, writable: false,
  });
})(window);
