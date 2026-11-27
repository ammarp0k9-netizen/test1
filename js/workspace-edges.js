(function bindWorkspaceEdges() {
  const header = document.getElementById('legendTopBar');
  const dock = document.getElementById('legendDock');
  const status = document.getElementById('syncStatusBar');
  const viewportEdges = document.querySelector('.viewport-edges');
  const workspace = document.querySelector('.dictionary-workspace');
  const scroller = document.querySelector('.dictionary-workspace-scroll');
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
    const dockTop = dock.getBoundingClientRect().top;
    const stickyTop = Math.ceil(headerBottom + 12);
    const available = desktop.matches && scroller.offsetWidth > 0;
    const workspaceTop = available ? Math.max(workspace.getBoundingClientRect().top, stickyTop) : 0;
    const room = Math.floor((dockTop > 0 && dockTop < height ? dockTop : height) - workspaceTop - 15);
    markEdges(viewportEdges, page.scrollTop, page.scrollHeight - page.scrollTop - height);
    setPixels(document.body, '--shell-content-top', headerBottom + 14);
    if (!available) return;
    setPixels(workspace, '--workspace-top', stickyTop);
    setPixels(workspace, '--workspace-height', Math.max(110, room));
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
    for (const node of [document.body, header, dock, status, scroller, ...scroller.children]) resize.observe(node);
  }
  schedule();
})();
