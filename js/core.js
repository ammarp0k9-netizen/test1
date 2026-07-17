// ═══════════════════════════════════════════════════════
// Smart Loading Overlay - Handles authentication and data-fetching delay
// Full-screen blurred overlay that appears instantly on page load
// and dismisses the moment user data arrives (300ms opacity fade-out).
// Includes slow connection/offline detection (5s warning).
// ═══════════════════════════════════════════════════════
(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  // Guest storage key matches: WORDS_NORMAL_PREFIX + 'guest' = 'words_normal_guest'
  const GUEST_STORAGE_KEY = 'words_normal_guest';
  const LEGACY_DICTIONARY_KEY = 'lootlinguaDict';
  const LOADING_TEXT = 'جارٍ التحميل...';
  const SLOW_CONNECTION_TEXT = 'يبدو أن التحميل يستغرق وقتًا أطول من المعتاد. يرجى التحقق من اتصالك بالإنترنت.';
  const OVERLAY_ID = 'smartLoadingOverlay';
  const SLOW_WARNING_ID = 'smartLoadingSlowWarning';

  // Timing constants
  const SLOW_CONNECTION_THRESHOLD_MS = 5000; // Time before showing slow connection warning
  const FADE_OUT_DURATION_MS = 300;        // CSS transition duration (must match CSS)

  // ============================================
  // STATE
  // ============================================
  let overlayElement = null;
  let slowWarningElement = null;
  let isOverlayVisible = false;
  let slowWarningTimer = null;
  let dismissPending = false;

  // ============================================
  // CREATE OVERLAY HTML
  // ============================================
  function createOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'smart-loading-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', LOADING_TEXT);
    
    overlay.innerHTML = `
      <div class="smart-loading-backdrop"></div>
      <div class="smart-loading-content">
        <div class="smart-loading-spinner" aria-hidden="true"></div>
        <p class="smart-loading-text">${LOADING_TEXT}</p>
        <p id="${SLOW_WARNING_ID}" class="smart-loading-slow-warning" aria-live="assertive" style="display: none; opacity: 0;">${SLOW_CONNECTION_TEXT}</p>
      </div>
    `;

    document.body.appendChild(overlay);
    overlayElement = overlay;
    slowWarningElement = document.getElementById(SLOW_WARNING_ID);
    return overlay;
  }

  // ============================================
  // CHECK FOR GUEST DATA (SYNCHRONOUS, INSTANT)
  // ============================================
  function checkGuestDataExists() {
    try {
      // Check for guest words in localStorage
      const guestWords = localStorage.getItem(GUEST_STORAGE_KEY);
      const legacyDict = localStorage.getItem(LEGACY_DICTIONARY_KEY);
      
      // Also check for any guest profile data
      const guestXP = localStorage.getItem('userXP');
      const guestStreak = localStorage.getItem('dailyStreak');
      
      // Guest exists if they have words OR profile data
      const hasGuestWords = guestWords && guestWords !== '[]' && JSON.parse(guestWords).length > 0;
      const hasLegacyWords = legacyDict && legacyDict !== '[]' && JSON.parse(legacyDict).length > 0;
      const hasGuestProfile = (guestXP && parseInt(guestXP) > 0) || (guestStreak && parseInt(guestStreak) > 0);
      
      return hasGuestWords || hasLegacyWords || hasGuestProfile;
    } catch (e) {
      console.warn('SmartLoadingOverlay: Error checking guest data:', e);
      return false;
    }
  }

  // ============================================
  // SHOW OVERLAY
  // ============================================
  function showOverlay() {
    if (isOverlayVisible) return;
    
    if (!overlayElement) createOverlay();
    
    isOverlayVisible = true;
    overlayElement.style.transition = 'none';
    overlayElement.style.opacity = '1';
    overlayElement.classList.add('visible');
    document.body.classList.add('smart-loading-active');
    
    // Prevent scrolling while loading
    document.body.style.overflow = 'hidden';
    
    // Start the slow connection warning timer
    startSlowConnectionTimer();
  }

  // ============================================
  // SLOW CONNECTION WARNING TIMER
  // ============================================
  function startSlowConnectionTimer() {
    // Clear any existing timer
    if (slowWarningTimer) {
      clearTimeout(slowWarningTimer);
      slowWarningTimer = null;
    }
    
    slowWarningTimer = setTimeout(() => {
      if (isOverlayVisible && slowWarningElement) {
        // Fade in the slow connection warning
        slowWarningElement.style.display = 'block';
        // Force reflow for transition
        slowWarningElement.offsetHeight;
        slowWarningElement.style.opacity = '1';
        slowWarningElement.style.transition = 'opacity 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
        console.log('SmartLoadingOverlay: Slow connection warning displayed');
      }
    }, SLOW_CONNECTION_THRESHOLD_MS);
  }

  function clearSlowConnectionTimer() {
    if (slowWarningTimer) {
      clearTimeout(slowWarningTimer);
      slowWarningTimer = null;
    }
    // Also hide the warning if it was shown
    if (slowWarningElement) {
      slowWarningElement.style.opacity = '0';
      slowWarningElement.style.display = 'none';
    }
  }

  // ============================================
  // SCHEDULE DISMISSAL (instant trigger + smooth fade)
  // ============================================
  function scheduleDismiss() {
    if (dismissPending || !isOverlayVisible) return;
    dismissPending = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        hideOverlay();
      });
    });
  }

  // ============================================
  // HIDE OVERLAY (with smooth fade out)
  // ============================================
  function hideOverlay() {
    if (!isOverlayVisible || !overlayElement) return;
    
    clearSlowConnectionTimer();
    
    isOverlayVisible = false;
    overlayElement.style.transition = `opacity ${FADE_OUT_DURATION_MS}ms ease, visibility ${FADE_OUT_DURATION_MS}ms ease`;
    overlayElement.style.opacity = '0';
    overlayElement.classList.remove('visible');
    document.body.classList.remove('smart-loading-active');
    document.body.style.overflow = '';
    
    // Remove from DOM after transition
    setTimeout(() => {
      if (overlayElement && !isOverlayVisible) {
        overlayElement.remove();
        overlayElement = null;
        slowWarningElement = null;
      }
      dismissPending = false;
    }, FADE_OUT_DURATION_MS);
  }

  // ============================================
  // SMART DETECTION LOGIC
  // ============================================
  function runSmartDetection() {
    const isGuest = checkGuestDataExists();
    console.log(
      isGuest
        ? 'SmartLoadingOverlay: Guest data present, waiting for auth resolution'
        : 'SmartLoadingOverlay: No guest data, waiting for Firebase Auth...'
    );
    return isGuest;
  }

  // ============================================
  // PUBLIC API
  // ============================================
  window.SmartLoadingOverlay = {
    // Call this ASAP on page load (before Firebase initializes)
    init: function() {
      showOverlay();
      const bypassed = runSmartDetection();
      return bypassed;
    },

    // Call this when Firebase Auth state is resolved (user or null)
    onAuthResolved: function(user) {
      if (!user) {
        console.log('SmartLoadingOverlay: Auth resolved - no user, dismissing');
        scheduleDismiss();
        return;
      }
      
      console.log('SmartLoadingOverlay: Auth resolved - user found, waiting for data...');
    },

    // Call this when user words data is fully loaded from Firebase
    onUserDataLoaded: function() {
      console.log('SmartLoadingOverlay: User data loaded, dismissing');
      scheduleDismiss();
    },

    // Force hide (emergency fallback)
    forceHide: function() {
      hideOverlay();
    },

    // Check if overlay is currently visible
    isVisible: function() {
      return isOverlayVisible;
    }
  };

  // ============================================
  // AUTO-INITIALIZE ON SCRIPT LOAD
  // ============================================
  // Show overlay immediately when this script loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.SmartLoadingOverlay.init();
    }, { once: true });
  } else {
    window.SmartLoadingOverlay.init();
  }

})();
// Performance mode
// ═══════════════════════════════════════════════════════
const PERFORMANCE_MODE_KEY = 'lootlinguaPerformanceMode';
const PERFORMANCE_MODE_NOTICE_KEY = 'lootlinguaPerformanceModeNoticeSeen';
const PERFORMANCE_LEVELS = ['ultra', 'balanced', 'stable', 'turbo'];
const PERFORMANCE_LEVEL_LABELS = {
  ultra: 'أقصى جرافيك',
  balanced: 'متوازن',
  stable: 'أداء مستقر',
  turbo: 'تربو',
};

function detectPerformanceLevel() {
  const cores = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent || '');
  if ((cores && cores <= 2) || (memory && memory <= 2)) return 'turbo';
  if (isMobile || (cores && cores < 4) || (memory && memory <= 4)) return 'stable';
  if ((cores && cores >= 8) && (!memory || memory >= 8)) return 'ultra';
  return 'balanced';
}

function getPerformanceModePreference() {
  const pref = localStorage.getItem(PERFORMANCE_MODE_KEY);
  if (PERFORMANCE_LEVELS.includes(pref)) return pref;
  if (pref === 'on') {
    localStorage.setItem(PERFORMANCE_MODE_KEY, 'turbo');
    return 'turbo';
  }
  if (pref === 'off') {
    localStorage.setItem(PERFORMANCE_MODE_KEY, 'ultra');
    return 'ultra';
  }
  const autoLevel = detectPerformanceLevel();
  localStorage.setItem(PERFORMANCE_MODE_KEY, autoLevel);
  return autoLevel;
}

function syncPerformanceModeToggle() {
  const slider = document.getElementById('performanceLevelSlider');
  const text = document.getElementById('performanceModeState');
  const level = getPerformanceModePreference();
  const index = Math.max(0, PERFORMANCE_LEVELS.indexOf(level));
  if (slider) {
    slider.value = String(index);
    slider.setAttribute('aria-valuetext', PERFORMANCE_LEVEL_LABELS[level]);
    slider.style.setProperty('--perf-progress', `${(index / (PERFORMANCE_LEVELS.length - 1)) * 100}%`);
  }
  if (text) {
    text.textContent = PERFORMANCE_LEVEL_LABELS[level];
  }
}

function getPerformanceSliderPercent(slider, clientX) {
  const rect = slider.getBoundingClientRect();
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

function setPerformanceSliderHover(slider, clientX) {
  const pct = getPerformanceSliderPercent(slider, clientX) * 100;
  slider.style.setProperty('--perf-hover', `${pct}%`);
}

function previewPerformanceLevelFromPointer(slider, clientX) {
  const pct = getPerformanceSliderPercent(slider, clientX);
  const max = Number(slider.max) || PERFORMANCE_LEVELS.length - 1;
  const min = Number(slider.min) || 0;
  const value = min + pct * (max - min);
  slider.value = String(value);
  slider.style.setProperty('--perf-progress', `${pct * 100}%`);
}

function snapPerformanceLevelFromPointer(slider, clientX) {
  const pct = getPerformanceSliderPercent(slider, clientX);
  const max = Number(slider.max) || PERFORMANCE_LEVELS.length - 1;
  const min = Number(slider.min) || 0;
  const value = Math.round(min + pct * (max - min));
  setPerformanceLevel(value);
}

function initPerformanceSliderInteraction() {
  const slider = document.getElementById('performanceLevelSlider');
  if (!slider || slider.dataset.pointerReady === '1') return;
  slider.dataset.pointerReady = '1';

  let dragging = false;

  slider.addEventListener('pointerenter', (e) => {
    slider.classList.add('is-hovering');
    setPerformanceSliderHover(slider, e.clientX);
  });

  slider.addEventListener('pointermove', (e) => {
    setPerformanceSliderHover(slider, e.clientX);
    if (dragging) {
      e.preventDefault();
      previewPerformanceLevelFromPointer(slider, e.clientX);
    }
  });

  slider.addEventListener('pointerleave', () => {
    if (!dragging) slider.classList.remove('is-hovering');
  });

  slider.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    slider.classList.add('is-hovering', 'is-dragging');
    slider.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    setPerformanceSliderHover(slider, e.clientX);
    previewPerformanceLevelFromPointer(slider, e.clientX);
  });

  slider.addEventListener('pointerup', (e) => {
    dragging = false;
    slider.classList.remove('is-dragging');
    slider.releasePointerCapture?.(e.pointerId);
    snapPerformanceLevelFromPointer(slider, e.clientX);
  });

  slider.addEventListener('pointercancel', (e) => {
    dragging = false;
    slider.classList.remove('is-dragging', 'is-hovering');
    slider.releasePointerCapture?.(e.pointerId);
    syncPerformanceModeToggle();
  });

  slider.addEventListener('input', () => {
    const max = Number(slider.max) || PERFORMANCE_LEVELS.length - 1;
    const min = Number(slider.min) || 0;
    const raw = Math.min(max, Math.max(min, Number(slider.value) || 0));
    slider.style.setProperty('--perf-progress', `${((raw - min) / (max - min)) * 100}%`);
  });

  slider.addEventListener('change', () => {
    setPerformanceLevel(slider.value);
  });
}

function initPerformanceControls() {
  applyPerformanceMode();
  initPerformanceSliderInteraction();
}

function applyPerformanceMode() {
  const hadPreference = localStorage.getItem(PERFORMANCE_MODE_KEY) !== null;
  const level = getPerformanceModePreference();
  document.body.classList.remove('low-end-device', ...PERFORMANCE_LEVELS.map(l => `perf-${l}`));
  document.body.classList.add(`perf-${level}`);
  document.body.classList.toggle('low-end-device', level === 'turbo');
  syncPerformanceModeToggle();
  if (!hadPreference && level !== 'ultra' && !localStorage.getItem(PERFORMANCE_MODE_NOTICE_KEY)) {
    localStorage.setItem(PERFORMANCE_MODE_NOTICE_KEY, '1');
    setTimeout(() => {
      if (typeof showToast === 'function') {
        showToast(`اخترنا مستوى الأداء ${PERFORMANCE_LEVEL_LABELS[level]} تلقائياً. تقدر تغيّره من الإعدادات.`, 'info', 5600);
      }
    }, 900);
  }
}

window.setPerformanceLevel = function(value) {
  const index = Math.round(Math.min(PERFORMANCE_LEVELS.length - 1, Math.max(0, Number(value) || 0)));
  localStorage.setItem(PERFORMANCE_MODE_KEY, PERFORMANCE_LEVELS[index]);
  applyPerformanceMode();
};

window.togglePerformanceMode = function() {
  const current = getPerformanceModePreference();
  const next = current === 'turbo' ? 'balanced' : 'turbo';
  localStorage.setItem(PERFORMANCE_MODE_KEY, next);
  applyPerformanceMode();
};

window.showPerformanceModeHelp = function(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  showModal('performanceModeInfoModal');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPerformanceControls);
} else {
  initPerformanceControls();
}

// إشعارات عصرية
// ═══════════════════════════════════════════════════════
window.__notifications = [];
let expandedNotificationIds = new Set();

function pushNotification(msg, type = 'info', meta = {}) {
  const now = Date.now();
  const existing = window.__notifications.find(n => n.msg === msg && n.type === type);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.time = now;
    existing.read = false;
    window.__notifications = [
      existing,
      ...window.__notifications.filter(n => n.id !== existing.id),
    ];
    updateNotificationsBadge();
    renderNotificationsPanel();
    return existing.id;
  } else {
    const notification = {
      msg,
      type,
      meta,
      time: now,
      count: 1,
      read: false,
      id: now + '_' + Math.random().toString(36).slice(2),
    };
    window.__notifications.unshift(notification);
    updateNotificationsBadge();
    renderNotificationsPanel();
    return notification.id;
  }
}

function notificationNeedsDetails(msg) {
  return String(msg || '').length > 82;
}

function getUnreadNotifCount() {
  return window.__notifications
    .filter(n => !n.read)
    .reduce((sum, n) => sum + (n.count || 1), 0);
}

function updateNotificationsBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const count = getUnreadNotifCount();
  badge.textContent = count;
  badge.style.opacity = count > 0 ? '1' : '0';
  badge.style.display = count > 0 ? 'inline-block' : 'none';
}

function renderNotificationsPanel() {
  const panel = document.getElementById('notificationsPanel');
  const list = document.getElementById('notificationsList');
  const clearBtn = document.getElementById('notifClearAllBtn');
  if (!panel || !list) return;
  if (clearBtn) clearBtn.style.display = window.__notifications.length > 0 ? 'inline-flex' : 'none';
  list.innerHTML = window.__notifications.length === 0
    ? '<li class="notif-empty">لا يوجد إشعارات بعد.</li>'
    : window.__notifications.map(n => {
      const icon = n.type === 'success' ? 'fa-circle-check' : n.type === 'danger' ? 'fa-circle-xmark' : n.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info';
      const countBadge = (n.count || 1) > 1
        ? `<span class="notif-stack-count" aria-label="${n.count} إشعارات مماثلة">${n.count}</span>`
        : '';
      const isExpanded = expandedNotificationIds.has(String(n.id));
      const longClass = notificationNeedsDetails(n.msg) ? ' notif-long' : '';
      const expandedClass = isExpanded ? ' notif-expanded' : '';
      return `<li class="notif-item notif-${n.type}${longClass}${expandedClass}" data-notif-id="${escapeHtml(String(n.id))}">
        <span class="notif-item-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
        <span class="notif-content">
          <span class="notif-msg">${escapeHtml(n.msg)}${countBadge}</span>
          ${notificationNeedsDetails(n.msg) ? `<button type="button" class="notif-details-btn" onclick="openNotificationDetails('${escapeHtml(String(n.id))}', event)">${isExpanded ? 'أقل' : 'التفاصيل'}</button>` : ''}
        </span>
        <span class="notif-time">${formatNotifTime(n.time)}</span>
      </li>`;
    }).join('');
}

window.openNotificationDetails = function(id, ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const panel = document.getElementById('notificationsPanel');
  if (!panel?.classList.contains('open')) toggleNotificationsPanel(ev);
  const key = String(id);
  if (expandedNotificationIds.has(key)) expandedNotificationIds.delete(key);
  else expandedNotificationIds.add(key);
  renderNotificationsPanel();
  requestAnimationFrame(() => {
    const item = document.querySelector(`.notif-item[data-notif-id="${cssEscapeValue(key)}"]`);
    if (!item) return;
    item.classList.remove('notif-focus-flash');
    item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    requestAnimationFrame(() => {
      item.classList.add('notif-focus-flash');
      setTimeout(() => item.classList.remove('notif-focus-flash'), 2000);
    });
  });
};

window.clearAllNotifications = function(ev) {
  if (ev) ev.stopPropagation();
  window.__notifications = [];
  updateNotificationsBadge();
  renderNotificationsPanel();
};

function formatNotifTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function positionNotifPopover() {
  const panel = document.getElementById('notificationsPanel');
  const btn = document.getElementById('notifBtn');
  if (!panel || !btn || !panel.classList.contains('open')) return;
  if (window.matchMedia('(max-width: 768px)').matches) {
    panel.style.position = 'fixed';
    panel.style.top = 'calc(var(--legend-top-h, 52px) + env(safe-area-inset-top, 0px) + 14px)';
    panel.style.right = '12px';
    panel.style.left = '12px';
    panel.style.width = 'auto';
    panel.style.transform = 'translateY(0) scale(1)';
    return;
  }
  panel.style.position = '';
  panel.style.top = '';
  panel.style.right = '';
  panel.style.left = '';
  panel.style.width = '';
  panel.style.transform = '';
}

function toggleNotificationsPanel(ev) {
  if (ev) ev.stopPropagation();
  const panel = document.getElementById('notificationsPanel');
  const btn = document.getElementById('notifBtn');
  const hub = document.getElementById('notifHub');
  if (!panel) return;
  const opening = !panel.classList.contains('open');
  if (!opening) {
    closeNotificationsPanel();
    return;
  }
  if (opening) closeDailyQuestsSheet(true);
  panel.classList.toggle('open', opening);
  panel.style.display = opening ? 'block' : 'none';
  btn?.setAttribute('aria-expanded', opening ? 'true' : 'false');
  hub?.classList.toggle('notif-open', opening);
  if (opening) {
    window.__notifications.forEach(n => n.read = true);
    updateNotificationsBadge();
    renderNotificationsPanel();
    requestAnimationFrame(positionNotifPopover);
  }
}

window.addEventListener('resize', () => {
  if (document.getElementById('notificationsPanel')?.classList.contains('open')) positionNotifPopover();
});

function closeNotificationsPanel(silent) {
  const close = () => {
    const panel = document.getElementById('notificationsPanel');
    const btn = document.getElementById('notifBtn');
    const hub = document.getElementById('notifHub');
    if (!panel) return;
    panel.classList.remove('open');
    panel.style.display = 'none';
    panel.style.position = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.left = '';
    panel.style.width = '';
    panel.style.transform = '';
    btn?.setAttribute('aria-expanded', 'false');
    hub?.classList.remove('notif-open');
    expandedNotificationIds.clear();
    renderNotificationsPanel();
  };
  close();
}

document.addEventListener('click', (e) => {
  const hub = document.getElementById('notifHub');
  if (!hub?.classList.contains('notif-open')) return;
  if (hub.contains(e.target)) return;
  closeNotificationsPanel();
});

// ═══════════════════════════════════════════════════════
// Profile modal (Hero avatar)
// ═══════════════════════════════════════════════════════
window.toggleProfileModal = function() {
  const modal = document.getElementById('profileModal');
  if (!modal) return;
  const open = !modal.classList.contains('open');
  if (!open) {
    closeProfileModal();
    return;
  }
  modal.classList.toggle('open', open);
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body.classList.toggle('profile-modal-open', open);
  lockBackgroundScroll('profile');
  syncHeroAvatar();
  renderProfileModalStats();
  renderXPBar();
  refreshFeatureUnlockUI();
  closeSidebarIfOpen();
  setAppRoute('overlay', 'profile');
};

window.closeProfileModal = function(silent) {
  const close = () => {
    const modal = document.getElementById('profileModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('profile-modal-open');
    unlockBackgroundScroll('profile');
  };
  if (silent) close();
  else closeRouteEntry('overlay', 'profile', close);
};

const backgroundScrollLocks = new Set();
let backgroundScrollY = 0;
let backgroundScrollStyles = null;

function lockBackgroundScroll(key) {
  if (backgroundScrollLocks.has(key)) return;
  if (backgroundScrollLocks.size === 0) {
    backgroundScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    backgroundScrollStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.documentElement.classList.add('modal-scroll-locked');
    document.body.classList.add('modal-scroll-locked');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${backgroundScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }
  backgroundScrollLocks.add(key);
}

function unlockBackgroundScroll(key) {
  backgroundScrollLocks.delete(key);
  if (backgroundScrollLocks.size > 0) return;
  document.documentElement.classList.remove('modal-scroll-locked');
  document.body.classList.remove('modal-scroll-locked');
  if (backgroundScrollStyles) {
    document.body.style.position = backgroundScrollStyles.position;
    document.body.style.top = backgroundScrollStyles.top;
    document.body.style.left = backgroundScrollStyles.left;
    document.body.style.right = backgroundScrollStyles.right;
    document.body.style.width = backgroundScrollStyles.width;
    document.body.style.overflow = backgroundScrollStyles.overflow;
    backgroundScrollStyles = null;
  }
  window.scrollTo(0, backgroundScrollY);
}

function syncHeroAvatar() {
  const rank = getRank(userXP);
  const letterEl = document.getElementById('heroAvatarLetter');
  const iconEl = document.getElementById('heroAvatarIcon');
  const levelEl = document.getElementById('heroLevelBadge');
  const heroTitleBadge = document.getElementById('heroActiveTitleBadge');
  const xpMini = document.getElementById('heroXpMini');
  const profileAv = document.getElementById('profileModalAvatar');
  const profileTitle = document.getElementById('profileModalTitle');
  const profileBadge = document.getElementById('profileActiveTitleBadge');
  const name = (typeof getProfileDisplayName === 'function') ? getProfileDisplayName() : '';
  const initial = name ? name.trim().charAt(0).toUpperCase() : '';
  if (letterEl) {
    if (initial) {
      letterEl.textContent = initial;
      letterEl.style.display = 'grid';
      if (iconEl) iconEl.style.display = 'none';
    } else {
      letterEl.style.display = 'none';
      if (iconEl) iconEl.style.display = '';
    }
  }
  if (levelEl) { levelEl.textContent = rank.label; levelEl.style.color = rank.color; }
  if (heroTitleBadge && typeof getActiveTitleDef === 'function') {
    const unlockedTitles = getUnlockedTitleDefs();
    if (unlockedTitles.length) {
      heroTitleBadge.hidden = false;
      heroTitleBadge.innerHTML = unlockedTitles.map(def => renderTitleIcon(def, 'hero-active-title-icon')).join('');
      heroTitleBadge.title = unlockedTitles.map(def => def.name).join('، ');
    } else {
      heroTitleBadge.hidden = true;
      heroTitleBadge.innerHTML = '';
    }
  }
  if (xpMini) xpMini.textContent = userXP + ' XP';
  if (profileAv) {
    profileAv.textContent = '';
    if (initial) {
      const span = document.createElement('span');
      span.className = 'profile-avatar-letter';
      span.textContent = initial;
      profileAv.appendChild(span);
    } else {
      profileAv.innerHTML = '<i class="fa-solid fa-user"></i>';
    }
  }
  if (profileTitle) profileTitle.textContent = name || 'ملفك الشخصي';
  if (profileBadge && typeof getActiveTitleDef === 'function') {
    const unlockedTitles = getUnlockedTitleDefs();
    if (unlockedTitles.length) {
      profileBadge.hidden = false;
      profileBadge.innerHTML = unlockedTitles.map(def => renderTitleIcon(def, 'profile-active-title-icon')).join('');
      profileBadge.title = unlockedTitles.map(def => def.name).join('، ');
    } else {
      profileBadge.hidden = true;
      profileBadge.innerHTML = '';
    }
  }
  if (typeof renderProfileTitlePicker === 'function') renderProfileTitlePicker();
}

function getProfileDisplayName() {
  return window.auth?.currentUser?.displayName || localStorage.getItem('lootlinguaDisplayName') || '';
}

window.setLootlinguaDisplayName = function(name) {
  if (name) localStorage.setItem('lootlinguaDisplayName', name);
  syncHeroAvatar();
};

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (handleEscapeShortcut(e)) return;
  closeNotificationsPanel();
});

function renderProfileModalStats() {
  const wordsEl = document.getElementById('profileStatWords');
  const streakEl = document.getElementById('profileStatStreak');
  if (wordsEl) wordsEl.textContent = getPersonalDictionaryWordsSnapshot().length;
  if (streakEl) streakEl.textContent = loadInt('lootlinguaMaxStreak', dailyStreak) + ' يوم';
}

// ═══════════════════════════════════════════════════════
// Daily quests
// ═══════════════════════════════════════════════════════
const DAILY_QUEST_DEFS = [
  { id: 'add3', label: 'راجع 3 كلمات في اختبار موثوق', reward: 0, icon: 'fa-brain' },
  { id: 'perfectQuiz', label: 'حل اختبار موثوق بدون أخطاء', reward: 0, icon: 'fa-circle-check' },
  { id: 'openLoot', label: 'افتح صندوق اللوت اليومي', reward: 0, icon: 'fa-box-open' },
];

const ONBOARDING_INTRO_QUEST_DEFS = [
  { id: 'introSearch', label: 'ابحث عن أول كلمة إلك في صندوق البحث.', reward: 0, icon: 'fa-magnifying-glass', introOnly: true },
  { id: 'introAdd', label: 'ضيف الكلمة لقاموسك عشان تفتح أولى ميزات الموقع.', reward: 0, icon: 'fa-plus', introOnly: true },
];

const EMPTY_ONBOARDING_STORAGE_KEY = 'hasCompletedOnboarding';

const EMPTY_ONBOARDING_COPY = {
  questTip: '🎯 ابدأ من هون! عندك مهام ترحيبية بسيطة بتستناك.',
  searchTip: '💡 محتار بأول كلمة؟ جرب اكتب Sword أو Book وشوف شو بيصير! ⚔️',
  firstWordToast: 'دخلت أول كلمة في رحلتك! راجعها باختبار موثوق، ولما يتطور حفظك إلها رح تكسب XP وتفتح مكافآت جديدة.',
  treasureUnlock: '🔓 انفتحت لك ميزة الصندوق! روح شوف خانة المكافآت بالأسفل وافتح صندوقك اليومي لتكسب مكافآت جديدة وتثبت حماسلك!',
};

let emptyOnboardingState = {
  active: false,
  phase: 0,
  questTip: null,
  searchTip: null,
  repositionHandler: null,
};

function hasCompletedEmptyOnboarding() {
  return localStorage.getItem(EMPTY_ONBOARDING_STORAGE_KEY) === 'true';
}

function getPersonalDictionaryWordsSnapshot() {
  if (typeof readWordsFromStorage === 'function') {
    try {
      const stored = readWordsFromStorage('normal');
      if (Array.isArray(stored)) return stored;
    } catch (_) {}
  }
  return Array.isArray(window.words) ? window.words : [];
}

function getDictionaryWordCount() {
  return getPersonalDictionaryWordsSnapshot().length;
}

function shouldRunEmptyOnboarding() {
  if (hasCompletedEmptyOnboarding()) return false;
  if (getDictionaryWordCount() > 0) return false;
  if (document.documentElement.classList.contains('onboarding-active')) return false;
  return true;
}

function isIntroQuestMode() {
  return shouldRunEmptyOnboarding();
}

function getActiveQuestDefs() {
  return isIntroQuestMode() ? ONBOARDING_INTRO_QUEST_DEFS : DAILY_QUEST_DEFS;
}

function canStartEmptyOnboardingNow() {
  if (isInitialLoad || window.isInitialLoad) return false;
  if (window.__initialFeatureLoadPending instanceof Set && window.__initialFeatureLoadPending.has('words')) return false;
  return true;
}

function getDailyQuestState() {
  return loadJSON(getDailyQuestStorageKey(), { claimed: {}, flags: {} });
}

function getDailyQuestStorageKey(date = todayStr()) {
  return 'lootlinguaDailyQuests_' + date;
}

function saveDailyQuestState(state) {
  saveJSON(getDailyQuestStorageKey(), state);
  if (!hasSignedInUser()) markGuestDataDirty();
  requestProfileCloudSave();
}

function isDailyQuestDone(id) {
  if (id === 'introSearch') {
    const wordInput = document.getElementById('wordInput');
    const suggestions = document.getElementById('suggestionsList');
    const hasInput = Boolean(wordInput?.value.trim());
    const hasSuggestions = Boolean(suggestions?.querySelector('.sug-item, .suggestion-item, li, button'));
    return hasInput || hasSuggestions;
  }
  if (id === 'introAdd') return getDictionaryWordCount() >= 1;
  const s = getDailyQuestState();
  if (id === 'add3') return getDailyCount() >= 3;
  if (id === 'perfectQuiz') return Boolean(s.flags.perfectQuiz);
  if (id === 'openLoot') return Boolean(s.flags.openLoot);
  return false;
}

function markDailyQuestFlag(flag) {
  const s = getDailyQuestState();
  s.flags[flag] = true;
  saveDailyQuestState(s);
  updateDailyQuestsBadge();
  if (document.getElementById('dailyQuestsSheet')?.classList.contains('open')) renderDailyQuests();
}

function claimDailyQuest(id) {
  const def = getActiveQuestDefs().find(q => q.id === id);
  if (!def || def.introOnly || !isDailyQuestDone(id)) return;
  const s = getDailyQuestState();
  if (s.claimed[id]) return;
  s.claimed[id] = true;
  saveDailyQuestState(s);
  showToast('مهمة مكتملة!', 'success');
  updateDailyQuestsBadge();
  if (document.getElementById('dailyQuestsSheet')?.classList.contains('open')) renderDailyQuests();
}

window.toggleDailyQuestsSheet = function() {
  const sheet = document.getElementById('dailyQuestsSheet');
  const backdrop = document.getElementById('dailyQuestsBackdrop');
  const btn = document.getElementById('dailyQuestsBtn');
  if (!sheet) return;
  const opening = !sheet.classList.contains('open');
  if (!opening) {
    closeDailyQuestsSheet();
    return;
  }
  if (opening) closeNotificationsPanel(true);
  sheet.classList.toggle('open', opening);
  backdrop?.classList.toggle('open', opening);
  sheet.setAttribute('aria-hidden', opening ? 'false' : 'true');
  btn?.setAttribute('aria-expanded', opening ? 'true' : 'false');
  document.body.classList.toggle('daily-quests-open', opening);
  if (opening) renderDailyQuests();
  setAppRoute('overlay', 'quests');
};

window.closeDailyQuestsSheet = function(silent) {
  const sheet = document.getElementById('dailyQuestsSheet');
  const wasOpen = sheet?.classList.contains('open');
  const close = () => {
    const backdrop = document.getElementById('dailyQuestsBackdrop');
    const btn = document.getElementById('dailyQuestsBtn');
    if (!sheet) return;
    sheet.classList.remove('open');
    backdrop?.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    btn?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('daily-quests-open');
    if (wasOpen && emptyOnboardingState.active && emptyOnboardingState.phase === 1) {
      startEmptyOnboardingPhase2();
    }
  };
  if (silent) close();
  else closeRouteEntry('overlay', 'quests', close);
};

function updateDailyQuestsBadge() {
  const badge = document.getElementById('dailyQuestsBadge');
  if (!badge) return;
  const defs = getActiveQuestDefs();
  const done = defs.filter(q => isDailyQuestDone(q.id)).length;
  badge.textContent = done + '/' + defs.length;
  const btn = document.getElementById('dailyQuestsBtn');
  if (btn) btn.classList.toggle('has-pending', done < defs.length);
}

function renderDailyQuests() {
  const list = document.getElementById('dailyQuestsList');
  if (!list) return;
  updateDailyQuestsBadge();
  const defs = getActiveQuestDefs();
  const hint = document.getElementById('dailyQuestsResetHint');
  if (hint) {
    hint.textContent = isIntroQuestMode()
      ? 'مهام ترحيبية بسيطة — ابدأ من أول خطوة وكمّل على مزاجك'
      : 'تتجدد كل يوم — أنجزها لمتابعة تقدّمك اليومي';
  }
  const state = getDailyQuestState();
  list.innerHTML = defs.map(q => {
    const done = isDailyQuestDone(q.id);
    const claimed = Boolean(state.claimed[q.id]);
    const rewardTxt = q.reward > 0 ? '+' + q.reward + ' XP' : '✓';
    const masteryHelp = /أتقن|اتقن|إتقان|الإتقان/.test(q.label)
      ? '<button type="button" class="daily-quest-help" onclick="showMasteryHelp(event)" aria-label="شرح إتقان الكلمة"><i class="fa-solid fa-question" aria-hidden="true"></i></button>'
      : '';
    return `<li class="daily-quest-item${done ? ' done' : ''}" data-quest="${q.id}">
      <span class="daily-quest-check">${done ? '<i class="fa-solid fa-check"></i>' : ''}</span>
      <span class="daily-quest-text"><i class="fa-solid ${q.icon}"></i> ${q.label}${masteryHelp}</span>
      <span class="daily-quest-reward">${claimed ? 'تم' : rewardTxt}</span>
    </li>`;
  }).join('');
  list.querySelectorAll('.daily-quest-item.done').forEach(el => {
    const id = el.dataset.quest;
    const def = defs.find((q) => q.id === id);
    if (def?.introOnly) return;
    const st = getDailyQuestState();
    if (!st.claimed[id]) {
      el.style.cursor = 'pointer';
      el.onclick = () => claimDailyQuest(id);
    }
  });
}

function unbindEmptyOnboardingReposition() {
  if (!emptyOnboardingState.repositionHandler) return;
  window.removeEventListener('resize', emptyOnboardingState.repositionHandler);
  window.removeEventListener('scroll', emptyOnboardingState.repositionHandler, true);
  emptyOnboardingState.repositionHandler = null;
}

function positionEmptyOnboardingTooltip(tip, anchor, placement = 'above') {
  if (!tip || !anchor) return;
  tip.classList.remove('placement-above', 'placement-below', 'placement-below-bar');
  const width = tip.offsetWidth || 280;
  const height = tip.offsetHeight || 72;

  if (placement === 'below-bar') {
    const topBar = document.getElementById('legendTopBar') || anchor.closest('.legend-top-bar');
    const barRect = topBar?.getBoundingClientRect();
    const btnRect = anchor.getBoundingClientRect();
    if (!barRect) return;
    tip.classList.add('placement-below-bar');
    let top = barRect.bottom + 10;
    let left = btnRect.left + btnRect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    top = Math.max(barRect.bottom + 8, Math.min(top, window.innerHeight - height - 12));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    const arrowLeft = btnRect.left + btnRect.width / 2 - left;
    tip.style.setProperty('--tip-arrow-left', `${arrowLeft}px`);
    return;
  }

  tip.classList.add(placement === 'below' ? 'placement-below' : 'placement-above');
  const rect = anchor.getBoundingClientRect();
  let top = placement === 'below' ? rect.bottom + 14 : rect.top - height - 14;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

function bindEmptyOnboardingReposition(tip, anchor, placement) {
  unbindEmptyOnboardingReposition();
  const handler = () => positionEmptyOnboardingTooltip(tip, anchor, placement);
  emptyOnboardingState.repositionHandler = handler;
  window.addEventListener('resize', handler);
  window.addEventListener('scroll', handler, true);
}

function createEmptyOnboardingTooltip(text, anchor, placement = 'above') {
  const tip = document.createElement('div');
  tip.className = 'empty-onboarding-tip';
  tip.setAttribute('role', 'tooltip');
  tip.innerHTML = `<span class="empty-onboarding-tip-inner">${text}</span>`;
  document.body.appendChild(tip);
  positionEmptyOnboardingTooltip(tip, anchor, placement);
  requestAnimationFrame(() => {
    positionEmptyOnboardingTooltip(tip, anchor, placement);
    tip.classList.add('visible');
  });
  bindEmptyOnboardingReposition(tip, anchor, placement);
  return tip;
}

function removeEmptyOnboardingTooltip(tip, onDone) {
  if (!tip) {
    onDone?.();
    return;
  }
  tip.classList.remove('visible');
  tip.classList.add('fade-out');
  const finish = () => {
    tip.remove();
    onDone?.();
  };
  tip.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 380);
}

function hideEmptyOnboardingQuestTooltip(onDone) {
  if (!emptyOnboardingState.questTip) {
    onDone?.();
    return;
  }
  const tip = emptyOnboardingState.questTip;
  emptyOnboardingState.questTip = null;
  removeEmptyOnboardingTooltip(tip, onDone);
}

function removeOrphanEmptyOnboardingTips() {
  document.querySelectorAll('.empty-onboarding-tip').forEach((tip) => {
    if (tip !== emptyOnboardingState.questTip && tip !== emptyOnboardingState.searchTip) {
      tip.remove();
    }
  });
}

function hideEmptyOnboardingSearchTooltip() {
  unbindEmptyOnboardingSearchDismiss();
  if (emptyOnboardingState.searchTip) {
    const tip = emptyOnboardingState.searchTip;
    emptyOnboardingState.searchTip = null;
    removeEmptyOnboardingTooltip(tip);
  }
  document.querySelectorAll('.empty-onboarding-tip').forEach((tip) => {
    if (tip !== emptyOnboardingState.questTip) tip.remove();
  });
}

function hideAllEmptyOnboardingTooltips() {
  hideEmptyOnboardingQuestTooltip();
  hideEmptyOnboardingSearchTooltip();
  removeOrphanEmptyOnboardingTips();
  unbindEmptyOnboardingReposition();
}

function unbindEmptyOnboardingSearchDismiss() {
  const wordInput = document.getElementById('wordInput');
  if (!wordInput?.__emptyOnboardingDismiss) return;
  const dismiss = wordInput.__emptyOnboardingDismiss;
  wordInput.removeEventListener('input', dismiss);
  wordInput.removeEventListener('focus', dismiss);
  wordInput.removeEventListener('keydown', dismiss);
  wordInput.removeEventListener('pointerdown', dismiss);
  wordInput.removeEventListener('click', dismiss);
  wordInput.__emptyOnboardingDismiss = null;
}

function bindEmptyOnboardingSearchDismiss() {
  const wordInput = document.getElementById('wordInput');
  if (!wordInput) return;
  unbindEmptyOnboardingSearchDismiss();
  const dismiss = () => {
    hideEmptyOnboardingSearchTooltip();
    removeOrphanEmptyOnboardingTips();
  };
  wordInput.__emptyOnboardingDismiss = dismiss;
  wordInput.addEventListener('input', dismiss);
  wordInput.addEventListener('focus', dismiss);
  wordInput.addEventListener('keydown', dismiss);
  wordInput.addEventListener('pointerdown', dismiss);
  wordInput.addEventListener('click', dismiss);
}

function initEmptyOnboardingInputWatcher() {
  if (window.__emptyOnboardingInputWatcher) return;
  window.__emptyOnboardingInputWatcher = true;
  const isPersonalSearchTarget = (el) => {
    if (!el) return false;
    if (el.id === 'wordInput') return true;
    return Boolean(el.closest?.('#normalSearchZone'));
  };
  const dismissIfTyping = (e) => {
    if (!emptyOnboardingState.searchTip && !document.querySelector('.empty-onboarding-tip')) return;
    if (!isPersonalSearchTarget(e.target)) return;
    hideEmptyOnboardingSearchTooltip();
  };
  document.addEventListener('input', dismissIfTyping, true);
  document.addEventListener('keydown', dismissIfTyping, true);
  document.addEventListener('beforeinput', dismissIfTyping, true);
  document.addEventListener('compositionstart', dismissIfTyping, true);
}

function startEmptyOnboardingPhase1() {
  if (!shouldRunEmptyOnboarding() || emptyOnboardingState.active) return;
  initEmptyOnboardingInputWatcher();
  const btn = document.getElementById('dailyQuestsBtn');
  if (!btn) return;
  emptyOnboardingState.active = true;
  emptyOnboardingState.phase = 1;
  emptyOnboardingState.questTip = createEmptyOnboardingTooltip(EMPTY_ONBOARDING_COPY.questTip, btn, 'below-bar');
  updateDailyQuestsBadge();
}

function startEmptyOnboardingPhase2() {
  if (!emptyOnboardingState.active || emptyOnboardingState.phase !== 1) return;
  emptyOnboardingState.phase = 2;
  const wordInput = document.getElementById('wordInput');
  if (!wordInput) return;
  hideEmptyOnboardingQuestTooltip(() => {
    if (!shouldRunEmptyOnboarding()) {
      hideAllEmptyOnboardingTooltips();
      emptyOnboardingState.active = false;
      emptyOnboardingState.phase = 0;
      return;
    }
    removeOrphanEmptyOnboardingTips();
    if (emptyOnboardingState.searchTip) {
      removeEmptyOnboardingTooltip(emptyOnboardingState.searchTip);
      emptyOnboardingState.searchTip = null;
    }
    emptyOnboardingState.searchTip = createEmptyOnboardingTooltip(
      EMPTY_ONBOARDING_COPY.searchTip,
      wordInput,
      'below'
    );
    bindEmptyOnboardingSearchDismiss();
  });
}

function highlightTreasureDockForOnboarding() {
  const btn = document.querySelector('.legend-dock-btn[data-dock-view="treasure"]');
  if (!btn) return;
  btn.classList.remove('pulse-onboarding-highlight');
  void btn.offsetWidth;
  btn.classList.add('pulse-onboarding-highlight');
  setTimeout(() => btn.classList.remove('pulse-onboarding-highlight'), 4200);
}

function completeEmptyOnboardingFirstWord() {
  if (hasCompletedEmptyOnboarding()) return;
  hideAllEmptyOnboardingTooltips();
  emptyOnboardingState.active = false;
  emptyOnboardingState.phase = 3;
  showToast(EMPTY_ONBOARDING_COPY.firstWordToast, 'success', 5000);
  setTimeout(() => {
    pushNotification(EMPTY_ONBOARDING_COPY.treasureUnlock, 'success');
    refreshFeatureUnlockUI();
    highlightTreasureDockForOnboarding();
    localStorage.setItem(EMPTY_ONBOARDING_STORAGE_KEY, 'true');
    emptyOnboardingState.phase = 0;
    updateDailyQuestsBadge();
    if (document.getElementById('dailyQuestsSheet')?.classList.contains('open')) renderDailyQuests();
  }, 5200);
}

function notifyDictionaryWordAdded() {
  if (getDictionaryWordCount() !== 1) return;
  if (hasCompletedEmptyOnboarding()) return;
  completeEmptyOnboardingFirstWord();
}

window.tryStartEmptyOnboarding = function() {
  if (!canStartEmptyOnboardingNow() || !shouldRunEmptyOnboarding()) return;
  if (emptyOnboardingState.active) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!canStartEmptyOnboardingNow() || !shouldRunEmptyOnboarding() || emptyOnboardingState.active) return;
      startEmptyOnboardingPhase1();
    });
  });
};

// ── زر الرجوع (عوالم ← كلمات صعبة / قواميس) ──
let viewBackTarget = 'worlds';

function setViewBackBar(visible, label) {
  const nav = document.getElementById('viewNavBar');
  const lbl = document.getElementById('viewBackLabel');
  const btn = document.getElementById('viewBackBar');
  if (!nav) return;
  nav.style.display = '';
  document.body.classList.toggle('view-has-back', Boolean(visible));
  nav.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (label) {
    if (lbl) lbl.textContent = label;
    if (btn) {
      btn.setAttribute('aria-label', label);
      btn.dataset.tip = label;
    }
  }
}

window.goBackFromSubView = function() {
  if (typeof currentView !== 'undefined' && currentView === 'admin' &&
      typeof window.returnFromAdminView === 'function') {
    return window.returnFromAdminView();
  }
  if (viewBackTarget === 'worlds') loadWorldsView();
  else loadPersonalDictionary();
};

window.toggleSidebar = function() {
  if (typeof window.toggleProfileModal === 'function') window.toggleProfileModal();
};

// استبدال showToast ليضيف إشعار أيضاً
const __origShowToast = window.showToast;
window.showToast = function(msg, type = 'info', duration = 2500) {
  window.__toastDetailNotifId = pushNotification(msg, type);
  return __origShowToast ? __origShowToast(msg, type, duration) : undefined;
};
// ═══════════════════════════════════════════════════════
// تفاعل بوب لعناصر الكنز على الهاتف
// ═══════════════════════════════════════════════════════
function enableTreasurePopTouch() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const HOLD_MS = 520;
  setTimeout(() => {
    document.querySelectorAll('.treasure-slot, #dailyLootChest').forEach(el => {
      if (el.__popTouchEnabled) return;
      el.__popTouchEnabled = true;
      let holdTimer = null;
      let activeTag = null;
      function clearPop() {
        el.classList.remove('pop-active');
        if (activeTag) { activeTag.classList.remove('show'); activeTag = null; }
      }
      el.addEventListener('touchstart', function() {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          el.classList.add('pop-active');
          activeTag = el.querySelector('.nametag, .treasure-nametag, .treasure-details');
          if (activeTag) activeTag.classList.add('show');
        }, HOLD_MS);
      }, { passive: true });
      el.addEventListener('touchend', () => { clearTimeout(holdTimer); setTimeout(clearPop, 140); }, { passive: true });
      el.addEventListener('touchcancel', () => { clearTimeout(holdTimer); clearPop(); }, { passive: true });
      el.addEventListener('touchmove', () => clearTimeout(holdTimer), { passive: true });
    });
  }, 800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', enableTreasurePopTouch);
} else {
  enableTreasurePopTouch();
}
// ═══════════════════════════════════════════════════════
