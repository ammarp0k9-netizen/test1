(function bindWorkspaceEdges() {
  const header = document.getElementById('legendTopBar');
  const status = document.getElementById('syncStatusBar');
  const dock = document.getElementById('legendDock');
  const heading = document.getElementById('pageTitle').parentElement;
  const viewportEdges = document.querySelector('.viewport-edges');
  const workspace = document.querySelector('.dictionary-workspace');
  const scroller = document.querySelector('.dictionary-workspace-scroll');
  const content = scroller.firstElementChild;
  const workspaceEdges = workspace.querySelector('.workspace-edges');
  const desktop = matchMedia('(min-width: 940px) and (min-height: 421px)');
  const menus = [
    [document.getElementById('searchFilterMenu'), document.getElementById('searchFilterBtn')],
    [document.getElementById('dictionarySortMenu'), document.getElementById('dictionarySortBtn')],
  ];
  const sortSubmenu = document.querySelector('.sort-submenu-wrap');
  let frame = 0;

  function markEdges(layer, position, remaining) {
    layer.toggleAttribute('data-top', position > 2);
    layer.toggleAttribute('data-bottom', remaining > 2);
  }

  function setPixels(element, property, value) {
    const pixels = Math.round(value) + 'px';
    if (element.style.getPropertyValue(property) !== pixels) element.style.setProperty(property, pixels);
  }

  function layoutMenus(headerBottom, height) {
    const opened = menus.find(([menu]) => menu.classList.contains('open'));
    if (!opened) return;
    const [menu, trigger] = opened;
    const viewport = window.visualViewport;
    let bottom = viewport ? viewport.offsetTop + viewport.height : height;
    const dockBox = dock.getBoundingClientRect();
    if (dockBox.height && dockBox.top > headerBottom) bottom = Math.min(bottom, dockBox.top);
    const top = Math.max(viewport?.offsetTop || 0, headerBottom);
    const left = (viewport?.offsetLeft || 0) + 8;
    const right = left + (viewport?.width || document.documentElement.clientWidth) - 16;
    const rect = trigger.getBoundingClientRect();
    const above = rect.top - top - 14;
    const below = bottom - rect.bottom - 14;
    const openUp = above > below && menu.scrollHeight > below;
    menu.toggleAttribute('data-open-up', openUp);
    setPixels(menu, '--dictionary-menu-room', Math.max(0, openUp ? above : below));
    const box = menu.getBoundingClientRect();
    const offset = Number.parseFloat(menu.style.getPropertyValue('--dictionary-menu-shift')) || 0;
    const originalLeft = box.left - offset;
    const boundedLeft = Math.max(left, Math.min(originalLeft, right - box.width));
    setPixels(menu, '--dictionary-menu-shift', boundedLeft - originalLeft);
  }

  function measure() {
    frame = 0;
    const page = document.scrollingElement;
    const height = document.documentElement.clientHeight;
    const statusBounds = status.getBoundingClientRect();
    const headerBottom = Math.max(header.getBoundingClientRect().bottom, statusBounds.bottom);
    const toolsTop = Math.ceil(headerBottom + 8);
    const titleHeight = Math.ceil(heading.getBoundingClientRect().height);
    const stickyTop = toolsTop + titleHeight + 8;
    const available = desktop.matches && scroller.offsetWidth > 0;
    const workspaceTop = available ? Math.max(workspace.getBoundingClientRect().top, stickyTop) : 0;
    const room = Math.floor(height - workspaceTop - 12);
    markEdges(viewportEdges, page.scrollTop, page.scrollHeight - page.scrollTop - height);
    setPixels(document.body, '--shell-content-top', headerBottom + 14);
    setPixels(document.body, '--dictionary-tools-top', toolsTop);
    layoutMenus(headerBottom, height);
    if (!available) return;
    setPixels(workspace, '--workspace-top', stickyTop);
    const workspaceHeight = Math.max(110, room);
    setPixels(workspace, '--workspace-height', workspaceHeight);
    scroller.toggleAttribute('data-end-buffer', content.offsetHeight + 14 > workspaceHeight);
    const position = scroller.scrollTop;
    const remaining = scroller.scrollHeight - scroller.clientHeight - position;
    markEdges(workspaceEdges, position, remaining);
    markEdges(scroller, position, remaining);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(measure);
  }
  for (const event of ['scroll', 'resize', 'pageshow']) window.addEventListener(event, schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  scroller.addEventListener('scroll', schedule, { passive: true });
  desktop.addEventListener('change', schedule);
  if (window.ResizeObserver) {
    const resize = new ResizeObserver(schedule);
    for (const node of [document.body, header, heading, status, scroller, ...scroller.children]) resize.observe(node);
  }
  const menuObserver = new MutationObserver(() => {
    sortSubmenu.querySelector('button').setAttribute('aria-expanded', String(sortSubmenu.classList.contains('open')));
    schedule();
  });
  for (const node of [...menus.map(([menu]) => menu), sortSubmenu]) {
    menuObserver.observe(node, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('lootlingua:dictionary-navigation', () => closeAppDropdowns());
  schedule();
})();

(function bindDictionaryTooltips() {
  const actionable = ':is(#list, #dictionaryWordDetail) :is(.icon-circle, .star-btn), #viewBackBar';
  const tip = document.createElement('span');
  tip.className = 'dictionary-tooltip';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  document.body.append(tip);
  let anchor = null;
  let pending = 0;

  function clear() {
    clearTimeout(pending);
    anchor = null;
    tip.hidden = true;
  }

  function show(button, delay) {
    clear();
    const label = button.dataset.tip || button.getAttribute('aria-label');
    if (!label || button.closest('[inert]') || (button.id === 'viewBackBar' && !isEditableDictionaryView())) return;
    anchor = button;
    pending = setTimeout(() => {
      if (anchor !== button || !button.isConnected || !button.getClientRects().length) return clear();
      const target = button.getBoundingClientRect();
      tip.textContent = label;
      tip.hidden = false;
      const { width, height } = tip.getBoundingClientRect();
      const x = target.left + (target.width - width) / 2;
      tip.style.left = Math.max(6, Math.min(x, document.documentElement.clientWidth - width - 6)) + 'px';
      tip.style.top = Math.max(6, target.top - height - 8) + 'px';
    }, delay);
  }

  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const button = event.target.closest(actionable);
    if (button && button !== anchor) show(button, 190);
    else if (!button && anchor) clear();
  });
  document.addEventListener('pointerout', event => {
    if (anchor && event.pointerType === 'mouse' && anchor.contains(event.target) && !anchor.contains(event.relatedTarget)) clear();
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest(actionable);
    if (button?.matches(':focus-visible')) show(button, 0);
    else if (anchor) clear();
  });
  document.addEventListener('focusout', clear);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') clear(); });
  document.addEventListener('pointerdown', clear, { passive: true });
  window.addEventListener('scroll', clear, { capture: true, passive: true });
  window.addEventListener('resize', clear);
  window.addEventListener('blur', clear);
  window.addEventListener('lootlingua:dictionary-navigation', clear);
})();
