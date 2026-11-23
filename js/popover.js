(function attachLootLinguaPopover(root) {
  'use strict';

  let active = null;
  const resumeOffers = new Map();

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

  function positionGuide(element, anchor) {
    const rect = anchor.getBoundingClientRect();
    const viewport = root.visualViewport;
    const topEdge = (viewport?.offsetTop || 0) + 12;
    const viewportBottom = (viewport?.offsetTop || 0) + (viewport?.height || innerHeight);
    const dock = document.getElementById('legendDock')?.getBoundingClientRect();
    const bottomEdge = (dock?.height && dock.top > topEdge ? Math.min(viewportBottom, dock.top) : viewportBottom) - 12;
    const gap = 12;
    const width = element.getBoundingClientRect().width;
    const side = rect.left - gap - width >= 12 ? rect.left - gap - width :
      rect.right + gap + width <= innerWidth - 12 ? rect.right + gap : null;
    const above = Math.max(0, rect.top - gap - topEdge);
    const below = Math.max(0, bottomEdge - rect.bottom - gap);
    const naturalHeight = element.scrollHeight + (element.offsetHeight - element.clientHeight);
    const beside = side !== null && naturalHeight > Math.max(above, below);
    const upper = above >= naturalHeight || above >= below;
    const available = beside ? bottomEdge - topEdge : upper ? above : below;
    const height = Math.max(60, available);
    element.style.maxHeight = height + 'px';
    element.style.top = (beside ? Math.max(topEdge, Math.min(rect.top, bottomEdge - element.offsetHeight)) :
      upper ? Math.max(topEdge, rect.top - gap - element.offsetHeight) : rect.bottom + gap) + 'px';
    if (beside) element.style.left = side + 'px';
  }

  function close(options = {}) {
    if (!active) return;
    const current = active;
    active = null;
    current.element.remove();
    if (current.highlighted) current.anchor?.classList?.remove('coach-highlight-target');
    if (current.managesExpanded) current.anchor?.setAttribute?.('aria-expanded', 'false');
    window.removeEventListener('resize', current.reposition);
    window.removeEventListener('scroll', current.reposition, true);
    if (current.guideFrame) cancelAnimationFrame(current.guideFrame);
    window.visualViewport?.removeEventListener('resize', current.reposition);
    document.removeEventListener('pointerdown', current.onPointerDown, true);
    document.removeEventListener('keydown', current.onKeydown, true);
    if (current.onClick) document.removeEventListener('click', current.onClick, true);
    clearTimeout(current.readTimer);
    current.onClose?.(options);
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

  function companionFor(surface) {
    return active?.persistent && surface?.contains(active.anchor) ? active.element : null;
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
    if (resume) resumeOffers.set(id, resume);
    else resumeOffers.delete(id);
    const [coach, next] = [...resumeOffers.entries()].reduce((best, entry) =>
      (entry[1].priority || 0) > (best[1]?.priority || 0) || !best[1] ? entry : best, []);
    const label = next?.label || '';
    const text = banner.querySelector('span');
    if (banner.hidden !== !next) banner.hidden = !next;
    if (banner.dataset.coach !== (coach || '')) banner.dataset.coach = coach || '';
    if (text.textContent !== label) text.textContent = label;
    banner.onclick = next?.open || null;
  }

  function open({ id, className, anchor, content, labelledBy, describedBy, onClose, persistent = false,
    reading, yieldToHelp = false, escapeCloses = false, managesExpanded = true, avoidAnchor = false, highlight = persistent }) {
    if (!anchor || anchor.isConnected === false || (anchor.getClientRects && !anchor.getClientRects().length)) return null;
    if (active?.persistent && active.id !== id && !(active.yieldToHelp && !persistent)) return null;
    const sameStep = reading?.step && active?.id === id && active.readStep === reading.step;
    if (sameStep && active.anchor === anchor) return active.element;
    const previousReadUntil = sameStep ? active.readUntil : 0;
    close({ silent: true });
    const element = document.createElement('section');
    if (id) element.id = id;
    element.className = className || 'lootlingua-popover';
    element.setAttribute('role', 'dialog');
    element.setAttribute('tabindex', '-1');
    if (escapeCloses) element.dataset.escapeCloses = '';
    if (labelledBy) element.setAttribute('aria-labelledby', labelledBy);
    if (describedBy) element.setAttribute('aria-describedby', describedBy);
    if (content instanceof Node) element.append(content);
    else element.textContent = String(content || '');
    document.body.append(element);
    const highlighted = highlight && !anchor.classList?.contains('coach-highlight-target');
    if (highlighted) anchor.classList?.add('coach-highlight-target');
    const reposition = () => {
      position(element, anchor);
      if (avoidAnchor && element.isConnected) positionGuide(element, anchor);
    };
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
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && escapeCloses && (element.contains(event.target) || anchor.contains(event.target))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close({ escape: true });
        return;
      }
      if (event.key === 'Escape' && !persistent) { event.preventDefault(); close(); }
      if (['Enter', ' '].includes(event.key)) onClick?.(event);
    };
    active = { id: id || '', element, anchor, reposition, onPointerDown, onKeydown, onClick, onClose,
      persistent, highlighted, reading, yieldToHelp, managesExpanded };
    if (reading) {
      const duration = String(reading.text || '').length >= 105 ? 4000 : 3000;
      const now = Date.now();
      active.readUntil = previousReadUntil || now + duration;
      active.readStep = reading.step;
      const remaining = active.readUntil - now;
      if (remaining > 0) {
        element.classList.add('coach-reading');
        const hint = document.createElement('small');
        hint.className = 'coach-reading-hint';
        hint.textContent = reading.actionLabel ? `اقرأ أولًا، ثم اضغط «${reading.actionLabel}».` : 'اقرأ الخطوة، ثم تابع.';
        element.append(hint);
        active.readTimer = setTimeout(() => {
          element.classList.remove('coach-reading');
          hint.remove();
          reposition();
        }, remaining);
        document.addEventListener('click', onClick, true);
      }
    }
    if (managesExpanded) anchor.setAttribute('aria-expanded', 'true');
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    if (avoidAnchor && active?.element === element) {
      window.visualViewport?.addEventListener('resize', reposition);
      const coach = active;
      const deadline = performance.now() + 300;
      const settle = () => {
        if (active !== coach) return;
        reposition();
        if (performance.now() < deadline) coach.guideFrame = requestAnimationFrame(settle);
      };
      coach.guideFrame = requestAnimationFrame(settle);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeydown, true);
    return element;
  }

  Object.defineProperty(root, 'LootLinguaPopover', {
    value: Object.freeze({ open, close, closeIf, getActiveId, companionFor, canAct, isReadingAction, offerResume, position,
      reposition: id => { if (active?.id === id) active.reposition(); },
    }), configurable: false, enumerable: true, writable: false,
  });
})(window);
