// Keyboard shortcuts
// ═══════════════════════════════════════════════════════
const DOCK_SHORTCUT_VIEWS = ['treasure', 'personal', 'worlds', 'quiz'];

window.showKeyboardShortcutsModal = function() {
  showModal('keyboardShortcutsModal');
};

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
}

function isElementVisible(el) {
  if (!el) return false;
  return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function getActiveDockView() {
  const activeDockBtn = document.querySelector('#legendDock .treasure-dock-btn.active');
  return activeDockBtn?.dataset?.dockView || currentView || 'personal';
}

function navigateDockByKeyboard(direction) {
  const currentDockView = getActiveDockView();
  const currentIndex = Math.max(0, DOCK_SHORTCUT_VIEWS.indexOf(currentDockView));
  const nextIndex = (currentIndex + direction + DOCK_SHORTCUT_VIEWS.length) % DOCK_SHORTCUT_VIEWS.length;
  const nextView = DOCK_SHORTCUT_VIEWS[nextIndex];
  const nextBtn = document.querySelector(`#legendDock [data-dock-view="${nextView}"]`);
  if (nextBtn) {
    nextBtn.click();
    nextBtn.focus({ preventScroll: true });
  }
}

function getVisibleSearchInput() {
  const preferredByView = {
    personal: 'searchInput',
    customWorld: 'searchInput',
    minecraft: 'gameSearchInput',
    pubg: 'gameSearchInput',
    starred: 'starredSearchInput'
  };
  const preferred = document.getElementById(preferredByView[currentView]);
  if (isElementVisible(preferred)) return preferred;
  return ['searchInput', 'gameSearchInput', 'starredSearchInput']
    .map(id => document.getElementById(id))
    .find(isElementVisible);
}

function clearSearchInput(input) {
  if (!input) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (input.id === 'searchInput' && typeof render === 'function') render();
  else if (input.id === 'gameSearchInput' && typeof searchGameWords === 'function') searchGameWords();
  else if (input.id === 'starredSearchInput' && typeof renderStarredWords === 'function') renderStarredWords();
}

function closeOpenModalByShortcut() {
  const visibleCustomModal = Array.from(document.querySelectorAll('.custom-modal'))
    .reverse()
    .find(modal => getComputedStyle(modal).display !== 'none');
  if (visibleCustomModal) {
    if (visibleCustomModal.id === 'welcomeModal' && typeof dismissWelcomeModal === 'function') {
      dismissWelcomeModal();
    } else {
      hideModal(visibleCustomModal.id);
      if (visibleCustomModal.id === 'deleteModal') {
        document.querySelector('#deleteModal .xp-delete-warn')?.remove();
      }
    }
    return true;
  }
  const profileModal = document.getElementById('profileModal');
  if (profileModal?.classList.contains('open')) {
    closeProfileModal();
    return true;
  }
  const dailyQuestsSheet = document.getElementById('dailyQuestsSheet');
  if (dailyQuestsSheet?.classList.contains('open')) {
    closeDailyQuestsSheet();
    return true;
  }
  const statsPanel = document.getElementById('statsPanel');
  if (statsPanel && getComputedStyle(statsPanel).display !== 'none') {
    closeStatsPanel();
    return true;
  }
  return false;
}

function handleEscapeShortcut(e) {
  const active = document.activeElement;
  if (active && ['searchInput', 'gameSearchInput', 'starredSearchInput'].includes(active.id)) {
    if (active.value) {
      e.preventDefault();
      clearSearchInput(active);
      return true;
    }
  }
  if (closeOpenModalByShortcut()) {
    e.preventDefault();
    return true;
  }
  return false;
}

document.addEventListener('keydown', function(e) {
  if (currentView === 'admin' && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    return;
  }

  if (currentView === 'admin' && (e.key === '/' || e.key === 'Enter')) return;

  if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    navigateDockByKeyboard(e.key === 'ArrowRight' ? -1 : 1);
    return;
  }

  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) {
    const searchInput = getVisibleSearchInput();
    if (searchInput) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select?.();
    }
    return;
  }

  if (e.key === 'Escape' && handleEscapeShortcut(e)) return;

  if (e.key !== 'Enter') return;
  const active = document.activeElement;
  if (active.id === 'wordInput') { e.preventDefault(); window.fetchSuggestions(); }
  else if (active.id === 'scrambleInput') { e.preventDefault(); submitScrambleAnswer(); }
  else if (active.id === 'gameSearchInput') { /* لا شيء - oninput يتعامل معه */ }
  else if (!['INPUT','TEXTAREA','BUTTON','SELECT'].includes(active.tagName)) {
    e.preventDefault();
    document.getElementById('addBtn')?.click();
  }
});

// ═══════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════
window.onload = function() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    if (speechSynthesis.onvoiceschanged !== undefined)
      speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
  // Gamification init
  bootstrapThemeNotificationKeysOnce();
  // checkAndUpdateStreak يشتغل هنا فقط لو مش مسجل دخول
  // لو مسجل دخول، يشتغل بعد loadProfileFromCloud (في index.html)
  loadTheme();
  renderXPBar();
  syncHeroAvatar();
  renderDailyGoal();
  renderStreak();
  renderProfileModalStats();
  render();
  updateDailyQuestsBadge();
  initOnboarding();
  handleInitialRouting();
  // استدعيها بعد تأخير 0 عشان تعطي Firebase فرصة
  // لو المستخدم مش مسجل دخول، ستشتغل مباشرة
  setTimeout(() => {
    if (!window._profileLoaded) checkAndUpdateStreak();
  }, 1200);
  refreshFeatureUnlockUI();
};

// ═══════════════════════════════════════════════════════
// Sidebar Tooltip (JS — bypasses overflow clipping)
// ═══════════════════════════════════════════════════════
(function(){
  const tip = document.createElement('div');
  tip.className = 'sidebar-tip';
  document.body.appendChild(tip);

  function showTip(e) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar.classList.contains('open')) return;
    const el = e.currentTarget;
    if (!el.dataset.tip) return;
    const rect = el.getBoundingClientRect();
    tip.textContent = el.dataset.tip;
    tip.style.top = (rect.top + rect.height / 2) + 'px';
    tip.style.right = (window.innerWidth - rect.left + 10) + 'px';
    tip.style.left = '';
    tip.style.transform = 'translateY(-50%)';
    tip.classList.add('show');
  }
  function hideTip() { tip.classList.remove('show'); }

  document.querySelectorAll('[data-tip]').forEach(el => {
    if (el.closest('.sidebar')) {
      el.addEventListener('mouseenter', showTip);
      el.addEventListener('mouseleave', hideTip);
    }
  });
})();

// ═══════════════════════════════════════════════════════
// Sidebar toggle (must be defined BEFORE any code that wraps window.toggleSidebar)
// ═══════════════════════════════════════════════════════
if (typeof window.toggleSidebar !== 'function') {
  window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('show', isOpen);
  };
}

if (typeof window.closeSidebarIfOpen !== 'function') {
  window.closeSidebarIfOpen = function() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    if (sidebar && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('show');
    }
  };
}

(function() {
  const HIDDEN_CLASS = 'hide-mobile-hamburger';
  const MOBILE_QUERY = window.matchMedia('(max-width: 768px)');
  let lastScrollY = window.scrollY || 0;
  let scrollTimer = null;

  function isMobileViewport() {
    return MOBILE_QUERY.matches;
  }

  function setHamburgerVisible(visible) {
    document.body.classList.toggle(HIDDEN_CLASS, !visible);
  }

  function updateHamburgerByScroll() {
    if (!isMobileViewport()) {
      document.body.classList.remove(HIDDEN_CLASS);
      return;
    }
    if (document.body.classList.contains('sidebar-open')) {
      document.body.classList.add(HIDDEN_CLASS);
      return;
    }
    const currentY = window.scrollY || 0;
    const delta = currentY - lastScrollY;
    if (Math.abs(delta) < 10) {
      lastScrollY = currentY;
      return;
    }
    if (delta > 0 && currentY > 40) {
      setHamburgerVisible(false);
    } else if (delta < 0) {
      setHamburgerVisible(true);
    }
    lastScrollY = currentY;
  }

  window.updateMobileHamburgerState = function(open) {
    document.documentElement.classList.toggle('sidebar-open', open);
    document.body.classList.toggle('sidebar-open', open);
    if (open) {
      setHamburgerVisible(false);
    } else {
      setHamburgerVisible(true);
    }
  };

  window.addEventListener('scroll', () => {
    if (!isMobileViewport()) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(updateHamburgerByScroll, 80);
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (!isMobileViewport()) {
      document.body.classList.remove(HIDDEN_CLASS);
    }
  });

  const origCloseSidebarIfOpen = window.closeSidebarIfOpen;
  window.closeSidebarIfOpen = function() {
    if (typeof origCloseSidebarIfOpen === 'function') origCloseSidebarIfOpen();
    document.documentElement.classList.remove('sidebar-open');
    document.body.classList.remove('sidebar-open');
    setHamburgerVisible(true);
  };
})();

// ═══════════════════════════════════════════════════════
// Sidebar Book Icon → Open Icon on Hover
// ═══════════════════════════════════════════════════════
(function(){
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const headerIcon = () => sidebar.querySelector('.sidebar-header i');
  const origClass = 'fa-solid fa-book-open';
  const hoverClass = 'fa-solid fa-angles-left';

  sidebar.addEventListener('mouseenter', () => {
    const icon = headerIcon();
    if (icon && !sidebar.classList.contains('open')) icon.className = hoverClass;
  });
  sidebar.addEventListener('mouseleave', () => {
    const icon = headerIcon();
    if (icon) icon.className = origClass;
  });
  // رجّع الأيقون لما يفتح السايدبار
  const origToggle = window.toggleSidebar;
  window.toggleSidebar = function() {
    if (typeof origToggle === 'function') origToggle();
    window.updateMobileHamburgerState(sidebar.classList.contains('open'));
    const icon = headerIcon();
    if (icon) icon.className = sidebar.classList.contains('open') ? origClass : origClass;
  };
})();

// ── Back to Top Button ──────────────────────────────────
(function initBackToTop() {
  // إضافة التنسيقات الخاصة بالزر داخل الصفحة
  const style = document.createElement('style');
  style.textContent = `
    .back-to-top {
      position: fixed;
      bottom: 20px;
      right: 360px; /* نقلناه لليمين وقربناه من مصفوفة الكلمات */
      width: 30px;  /* تصغير الحجم ليكون أكثر تناسقاً */
      height: 30px;
      border-radius: 50%;
      background: var(--accent);
      color: var(--text-on-accent);
      border: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
      z-index: 9000;
    }
    .back-to-top.show {
      opacity: 0.8; /* شفافية بسيطة لكي لا يحجب النص تحت الزر */
      visibility: visible;
      bottom: 30px;
    }
    .back-to-top:hover {
      opacity: 1;
      transform: translateY(-3px);
      filter: brightness(1.1);
    }
    @media (max-width: 768px) {
      .back-to-top {
        right: 15px; /* تقريبه أكثر من الحافة في الموبايل */
        width: 35px;
        height: 35px;
      }
      .back-to-top.show {
        bottom: 25px;
      }
    }
  `;
  document.head.appendChild(style);

  // إنشاء عنصر الزر
  const btn = document.createElement('button');
  btn.className = 'back-to-top';
  btn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
  btn.setAttribute('aria-label', 'العودة للأعلى');
  document.body.appendChild(btn);

  // وظيفة النقر للعودة للأعلى
  btn.onclick = () => {
    prepareWordWindowForTopJump();
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  // مراقبة التمرير لإظهار/إخفاء الزر
  window.addEventListener('scroll', () => {
    if (window.scrollY > 400) btn.classList.add('show');
    else btn.classList.remove('show');
  }, { passive: true });
})();
