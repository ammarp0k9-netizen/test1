(function bindSyncStatus(root) {
  'use strict';
  const bar = document.getElementById('syncStatusBar');
  const header = document.getElementById('legendTopBar');
  if (!bar || !header) return;
  const icon = bar.querySelector('i');
  const title = bar.querySelector('[data-sync-title]');
  const copy = bar.querySelector('[data-sync-copy]');
  const close = bar.querySelector('button');
  let owner = '';
  let awaiting = false;
  let done = false;
  const phaseKey = uid => 'lootlingua:sync-banner:v1:' + encodeURIComponent(uid);
  function rememberPhase() {
    if (!owner) return;
    try {
      if (awaiting || done) root.sessionStorage?.setItem(phaseKey(owner), awaiting ? 'waiting' : 'done');
      else root.sessionStorage?.removeItem(phaseKey(owner));
    } catch (_) {}
  }
  const arabic = () => !document.documentElement.lang?.toLowerCase().startsWith('en');
  const labels = {
    ar: {
      waiting: 'تقدمك محفوظ على هذا الجهاز.', quota: 'سنزامن تغييراتك تلقائيًا عند تجدد الحصة.',
      offline: 'سنزامن تغييراتك تلقائيًا عند عودة الاتصال.', service: 'سنزامن تغييراتك تلقائيًا عند عودة الخدمة.',
      capacity: 'سنستأنف المزامنة تلقائيًا عندما تتاح سعة الخدمة.',
      active: 'جارٍ مزامنة بياناتك وتقدمك...', activeCopy: 'يمكنك متابعة استخدام الموقع.',
      success: 'تمت مزامنة بياناتك وتقدمك بنجاح.', fail: 'تعذّر الحفظ على هذا الجهاز.',
      failCopy: 'تحقّق من مساحة التخزين أو إعدادات المتصفح، ثم أعد المحاولة.',
      rejected: 'تعذّر اعتماد بعض التغييرات.',
      denied: 'رفض الخادم الصلاحية لهذه العملية. تحقّق من حسابك.',
      invalid: 'لم تعد البيانات صالحة لهذا الإجراء. افتح العنصر وأعد المحاولة.',
      unexpected: 'راجع العملية في قسمها. ستتابع المزامنة للتغييرات المستقلة.', close: 'إغلاق حالة المزامنة',
      scopes: { dictionary: 'القاموس', 'custom-worlds': 'عالم خاص', 'custom-world-remove': 'حذف عالم خاص',
        'gate-lesson': 'حفظ الدرس', 'level-placement': 'إجابات التقييم', 'quiz-draft': 'مسودة الاختبار',
        entry: 'الأونبوردنج', profile: 'الملف الشخصي', notifications: 'الإشعارات' },
      actions: { add: 'إضافة كلمة', edit: 'تعديل كلمة', remove: 'إزالة كلمة', transfer: 'نسخ أو نقل كلمة' },
    },
    en: {
      waiting: 'Your progress is saved on this device.', quota: 'Changes will sync automatically when the quota resets.',
      offline: 'Changes will sync automatically when you reconnect.', service: 'Changes will sync automatically when the service returns.',
      capacity: 'Sync will resume automatically when capacity is available.',
      active: 'Syncing your data and progress…', activeCopy: 'You can keep using the site.',
      success: 'Your data and progress are synced.', fail: 'Could not save to this device.',
      failCopy: 'Check your browser storage settings or available space, then try again.',
      rejected: 'Some changes could not be confirmed.', denied: 'The server denied permission. Check your account.',
      invalid: 'The data is no longer valid for this action. Open the item and try again.',
      unexpected: 'Review the action in its section. Other changes will keep syncing.', close: 'Dismiss sync status',
      scopes: { dictionary: 'Dictionary', 'custom-worlds': 'Private world', 'custom-world-remove': 'Private world removal',
        'gate-lesson': 'Lesson checkpoint', 'level-placement': 'Assessment answers', 'quiz-draft': 'Quiz checkpoint',
        entry: 'Onboarding', profile: 'Profile', notifications: 'Notifications' },
      actions: { add: 'Add a word', edit: 'Edit a word', remove: 'Remove a word', transfer: 'Copy or move a word' },
    },
  };

  function layout() {
    const visible = !bar.hidden && bar.getClientRects().length > 0;
    if (visible) {
      const bounds = header.getBoundingClientRect();
      bar.style.top = Math.round(bounds.bottom + 5) + 'px';
      bar.style.width = Math.min(Math.round(bounds.width), Math.max(0, document.documentElement.clientWidth - 20)) + 'px';
    }
    document.body.style.setProperty('--sync-status-offset', visible ? `${bar.offsetHeight + 6}px` : '0px');
  }

  function render() {
    const uid = root.auth?.currentUser?.uid || '';
    if (uid !== owner) {
      owner = uid; awaiting = false; done = false;
      try {
        const previous = owner && root.sessionStorage?.getItem(phaseKey(owner));
        awaiting = previous === 'waiting';
        done = previous === 'done';
      } catch (_) {}
    }
    const status = root.LootLinguaOperations?.syncStatus(uid);
    const text = labels[arabic() ? 'ar' : 'en'];
    let kind = '', heading = '', message = '';
    const unavailable = root.LootLinguaCloudBackoff?.reason() || status?.reason;
    if (status?.pending && unavailable) { awaiting = true; done = false; }
    else if (awaiting && !status?.pending && !status?.localFailure && !status?.rejected && !status?.active && uid) { done = true; awaiting = false; }
    rememberPhase();
    if (status?.localFailure) {
      kind = 'error'; heading = text.fail; message = text.failCopy;
    } else if (status?.rejected) {
      const rejection = status.rejections?.[0];
      const reason = rejection?.reason;
      kind = 'error'; heading = text.rejected;
      message = ['permission-denied', 'unauthenticated'].includes(reason) ? text.denied
        : ['invalid-argument', 'failed-precondition', 'not-found'].includes(reason) ? text.invalid : text.unexpected;
      const description = text.actions[rejection?.type] || text.scopes[rejection?.scope];
      if (description) message = description + (rejection.name ? ` «${rejection.name}»` : '') + '. ' + message;
    } else if (status?.pending) {
      const reason = unavailable;
      if (!reason) {
        kind = 'active'; heading = text.active; message = text.activeCopy;
      } else {
        kind = 'pending'; heading = text.waiting; message = text[reason] || text.service;
      }
    } else if (done) {
      kind = 'success'; heading = text.success;
    }
    bar.hidden = !kind;
    bar.dataset.state = kind;
    bar.dir = arabic() ? 'rtl' : 'ltr';
    title.textContent = heading;
    copy.textContent = message;
    copy.hidden = !message;
    close.hidden = kind !== 'success';
    close.setAttribute('aria-label', text.close);
    icon.className = 'fa-solid ' + ({ error: 'fa-triangle-exclamation', active: 'fa-rotate', success: 'fa-circle-check' }[kind] || 'fa-cloud');
    layout();
  }
  close.addEventListener('click', () => { done = false; rememberPhase(); render(); });
  for (const event of ['lootlingua:sync-state', 'lootlingua:auth-state', 'lootlingua:cloud-capacity-change', 'online', 'offline']) {
    root.addEventListener(event, render);
  }
  root.addEventListener('resize', layout);
  if (root.ResizeObserver) {
    const observer = new ResizeObserver(layout);
    observer.observe(header);
    observer.observe(bar);
  }
  render();
})(window);
