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
const MAX_NOTIFICATION_RECORDS = 100;
let notificationOwner = '';
window.__notifications = [];
let expandedNotificationIds = new Set();
let notificationStoreUnsubscribe = null;

// Escape dynamic notification text before inserting it into HTML.
// Kept local to core.js so notification rendering cannot fail if another helper is absent.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function currentNotificationOwner() {
  return String(window.auth?.currentUser?.uid || 'guest');
}

function persistNotifications() {
  // v3 persistence is owned by NotificationStore. This remains as a no-op
  // compatibility hook for older callers.
}

function loadNotificationsForCurrentOwner() {
  notificationOwner = currentNotificationOwner();
  const store = window.LootLinguaNotificationStore;
  window.__notifications = store?.switchOwner(notificationOwner) || [];
  window.__notifications = store?.getDisplayRecords?.() || window.__notifications;
  expandedNotificationIds.clear();
  updateNotificationsBadge();
  renderNotificationsPanel();
}

function pushNotification(msg, type = 'info', meta = {}) {
  const policy = window.LootLinguaNotificationPolicy;
  if (!policy) return '';
  const notification = policy.createRecord(msg, type, meta, Date.now());
  const store = window.LootLinguaNotificationStore;
  if (store) {
    store.upsert({
      ...notification,
      ownerId: notificationOwner || currentNotificationOwner(),
      kind: 'legacy',
      notificationType: 'legacy.notice',
      occurrenceKey: notification.meta?.dedupeKey
        ? `legacy:${notification.meta.dedupeKey}`
        : `legacy:${notification.id}`,
      status: 'active',
      createdAt: notification.time,
      updatedAt: notification.time,
      showCount: notification.count || 1,
    }, { reason: 'legacy-notice' });
    window.__notifications = store.getDisplayRecords();
  } else {
    window.__notifications = policy.mergeRecord(window.__notifications, notification, MAX_NOTIFICATION_RECORDS);
  }
  updateNotificationsBadge();
  renderNotificationsPanel();
  return notification.id;
}

function notificationNeedsDetails(msg) {
  return String(msg || '').length >
    (window.LootLinguaNotificationPolicy?.LONG_MESSAGE_THRESHOLD || 82);
}

window.pushNotification = pushNotification;
window.recordNotificationForToast = function(msg, type, options) {
  const policy = window.LootLinguaNotificationPolicy;
  if (!policy?.shouldPersist(msg, options)) return '';
  return pushNotification(msg, type, options);
};

function getUnreadNotifCount() {
  return window.LootLinguaNotificationStore?.getUnreadCount?.() ??
    window.__notifications.filter(n => !n.read).length;
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
    ? '<li class="notif-empty">لا توجد إشعارات الآن.</li>'
    : window.__notifications.map(n => {
      const visualType = n.visualType || n.type || 'info';
      const message = n.message || n.msg || '';
      const icon = visualType === 'success' ? 'fa-circle-check' : visualType === 'danger' ? 'fa-circle-xmark' : visualType === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info';
      const countBadge = (n.count || 1) > 1
        ? `<span class="notif-stack-count" aria-label="${n.count} إشعارات مماثلة">${n.count}</span>`
        : '';
      const isExpanded = expandedNotificationIds.has(String(n.id));
      const longClass = notificationNeedsDetails(message) ? ' notif-long' : '';
      const expandedClass = isExpanded ? ' notif-expanded' : '';
      const unreadClass = n.readAt || n.read ? '' : ' notif-unread';
      const title = n.title ? `<span class="notif-title">${escapeHtml(n.title)}</span>` : '';
      const cta = n.cta?.id && n.cta?.label
        ? `<button type="button" class="notif-cta-btn" onclick="handleNotificationAction('${escapeHtml(String(n.id))}', event)">${escapeHtml(n.cta.label)}</button>`
        : '';
      return `<li class="notif-item notif-${visualType}${longClass}${expandedClass}${unreadClass}" data-notif-id="${escapeHtml(String(n.id))}">
        <span class="notif-item-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
        <span class="notif-content">
          ${title}
          <span class="notif-msg">${escapeHtml(message)}${countBadge}</span>
          <span class="notif-item-actions">
            ${cta}
            ${notificationNeedsDetails(message) ? `<button type="button" class="notif-details-btn" onclick="toggleNotificationDetails('${escapeHtml(String(n.id))}', event)">${isExpanded ? 'أقل' : 'التفاصيل'}</button>` : ''}
          </span>
        </span>
        <span class="notif-time">${formatNotifTime(n.time)}</span>
        <button type="button" class="notif-dismiss-btn" onclick="dismissNotification('${escapeHtml(String(n.id))}', event)" aria-label="إخفاء الإشعار"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </li>`;
    }).join('');
}

function focusNotificationDetails(id, ev, toggle) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const panel = document.getElementById('notificationsPanel');
  if (!panel?.classList.contains('open')) toggleNotificationsPanel(ev);
  const key = String(id);
  const notification = window.__notifications.find((record) => String(record.id) === key);
  if (notification && !notification.readAt && !notification.read) {
    window.LootLinguaNotificationStore?.markVisibleRead?.([notification.id]);
    notification.read = true;
    notification.readAt = Date.now();
    updateNotificationsBadge();
  }
  if (toggle && expandedNotificationIds.has(key)) expandedNotificationIds.delete(key);
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
  window.LootLinguaNotificationStore?.dismissAllActive?.(Date.now());
  window.__notifications = window.LootLinguaNotificationStore?.getDisplayRecords?.() || [];
  updateNotificationsBadge();
  renderNotificationsPanel();
};

function formatNotifTime(ts) {
  const d = new Date(ts || Date.now());
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
    renderNotificationsPanel();
    // Acknowledge exactly the records rendered by this opening. Read state is
    // independent from resolution/dismissal, so every item remains visible.
    window.LootLinguaNotificationStore?.markVisibleRead?.(
      window.__notifications.map((record) => record.id),
      Date.now()
    );
    window.__notifications = window.LootLinguaNotificationStore?.getDisplayRecords?.() || window.__notifications;
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

loadNotificationsForCurrentOwner();
notificationStoreUnsubscribe = window.LootLinguaNotificationStore?.subscribe?.((records, reason) => {
  window.__notifications = window.LootLinguaNotificationStore.getDisplayRecords();
  updateNotificationsBadge();
  renderNotificationsPanel();
  const panel = document.getElementById('notificationsPanel');
  // A cloud/local arrival while the center is already open is visible too.
  if (panel?.classList.contains('open') && reason !== 'mark-read') {
    window.LootLinguaNotificationStore.markVisibleRead(window.__notifications.map((record) => record.id));
  }
});
window.addEventListener('lootlingua:auth-state', () => {
  queueMicrotask(loadNotificationsForCurrentOwner);
});

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
  if (window.__entryExperienceActive || document.getElementById('journeyAuthPrompt')) return;
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
  const def = DAILY_QUEST_DEFS.find(q => q.id === id);
  if (!def || !isDailyQuestDone(id)) return;
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
  const close = () => {
    const backdrop = document.getElementById('dailyQuestsBackdrop');
    const btn = document.getElementById('dailyQuestsBtn');
    if (!sheet) return;
    sheet.classList.remove('open');
    backdrop?.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    btn?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('daily-quests-open');
  };
  if (silent) close();
  else closeRouteEntry('overlay', 'quests', close);
};

function updateDailyQuestsBadge() {
  const badge = document.getElementById('dailyQuestsBadge');
  if (!badge) return;
  const defs = DAILY_QUEST_DEFS;
  const done = defs.filter(q => isDailyQuestDone(q.id)).length;
  badge.textContent = done + '/' + defs.length;
  const btn = document.getElementById('dailyQuestsBtn');
  if (btn) btn.classList.toggle('has-pending', done < defs.length);
}

function renderDailyQuests() {
  const list = document.getElementById('dailyQuestsList');
  if (!list) return;
  updateDailyQuestsBadge();
  const defs = DAILY_QUEST_DEFS;
  const hint = document.getElementById('dailyQuestsResetHint');
  if (hint) hint.textContent = 'تتجدد كل يوم — أنجزها لمتابعة تقدّمك اليومي';
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
    const st = getDailyQuestState();
    if (!st.claimed[id]) {
      el.style.cursor = 'pointer';
      el.onclick = () => claimDailyQuest(id);
    }
  });
}

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
}

window.openNotificationDetails = function(id, ev) {
  focusNotificationDetails(id, ev, false);
};

window.toggleNotificationDetails = function(id, ev) {
  focusNotificationDetails(id, ev, true);
};

window.toggleSidebar = function() {
  if (typeof window.toggleProfileModal === 'function') window.toggleProfileModal();
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
