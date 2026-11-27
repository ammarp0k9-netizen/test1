(function bindWorkspaceEdges() {
  const header = document.getElementById('legendTopBar');
  const status = document.getElementById('syncStatusBar');
  const title = document.getElementById('pageTitle');
  const viewportEdges = document.querySelector('.viewport-edges');
  const workspace = document.querySelector('.dictionary-workspace');
  const scroller = document.querySelector('.dictionary-workspace-scroll');
  const content = scroller.firstElementChild;
  const workspaceEdges = workspace.querySelector('.workspace-edges');
  const desktop = matchMedia('(min-width: 940px) and (min-height: 421px)');
  let frame = 0;

  function markEdges(layer, position, remaining) {
    layer.toggleAttribute('data-top', position > 2);
    layer.toggleAttribute('data-bottom', remaining > 2);
  }

  function setPixels(element, property, value) {
    const pixels = Math.round(value) + 'px';
    if (element.style.getPropertyValue(property) !== pixels) element.style.setProperty(property, pixels);
  }

  function measure() {
    frame = 0;
    const page = document.scrollingElement;
    const height = document.documentElement.clientHeight;
    const statusBounds = status.getBoundingClientRect();
    const headerBottom = Math.max(header.getBoundingClientRect().bottom, statusBounds.bottom);
    const toolsTop = Math.ceil(headerBottom + 8);
    const titleHeight = Math.ceil(title.getBoundingClientRect().height);
    const stickyTop = toolsTop + titleHeight + 8;
    const available = desktop.matches && scroller.offsetWidth > 0;
    const workspaceTop = available ? Math.max(workspace.getBoundingClientRect().top, stickyTop) : 0;
    const room = Math.floor(height - workspaceTop - 12);
    markEdges(viewportEdges, page.scrollTop, page.scrollHeight - page.scrollTop - height);
    setPixels(document.body, '--shell-content-top', headerBottom + 14);
    setPixels(document.body, '--dictionary-tools-top', toolsTop);
    setPixels(document.body, '--dictionary-title-height', titleHeight);
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
  scroller.addEventListener('scroll', schedule, { passive: true });
  desktop.addEventListener('change', schedule);
  if (window.ResizeObserver) {
    const resize = new ResizeObserver(schedule);
    for (const node of [document.body, header, title, status, scroller, ...scroller.children]) resize.observe(node);
  }
  schedule();
})();
