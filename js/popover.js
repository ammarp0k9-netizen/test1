(function attachLootLinguaPopover(root) {
  'use strict';

  let active = null;

  function position(element, anchor) {
    if (!element || !anchor?.getBoundingClientRect) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    element.style.position = 'fixed';
    element.style.maxWidth = `${Math.max(220, window.innerWidth - margin * 2)}px`;
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
    current.anchor?.setAttribute?.('aria-expanded', 'false');
    window.removeEventListener('resize', current.reposition);
    window.removeEventListener('scroll', current.reposition, true);
    document.removeEventListener('pointerdown', current.onPointerDown, true);
    document.removeEventListener('keydown', current.onKeydown, true);
    current.onClose?.();
    if (!options.silent && current.anchor?.isConnected) {
      requestAnimationFrame(() => current.anchor.focus?.({ preventScroll: true }));
    }
  }

  function open({ id, className, anchor, content, labelledBy, onClose }) {
    if (!anchor) return null;
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
    const reposition = () => position(element, anchor);
    const onPointerDown = (event) => {
      if (!element.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    };
    active = { element, anchor, reposition, onPointerDown, onKeydown, onClose };
    anchor.setAttribute('aria-expanded', 'true');
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeydown, true);
    return element;
  }

  Object.defineProperty(root, 'LootLinguaPopover', {
    value: Object.freeze({ open, close, position }), configurable: false, enumerable: true, writable: false,
  });
})(window);
