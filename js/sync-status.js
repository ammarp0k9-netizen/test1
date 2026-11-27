(function bindSyncStatus(root) {
  'use strict';
  const bar = document.getElementById('syncStatusBar');
  const header = document.getElementById('legendTopBar');
  if (!bar || !header) return;
  const icon = bar.querySelector('i');
  const title = bar.querySelector('[data-sync-title]');
  const copy = bar.querySelector('[data-sync-copy]');
  const close = bar.querySelector('button');
  const quizBar = document.getElementById('quizSyncStatus');
  let owner = '';
  let phase = '';
  const phaseKey = uid => 'lootlingua:quota-recovery:v1:' + encodeURIComponent(uid);
  function readPhase(uid) {
    try { return uid && root.localStorage?.getItem(phaseKey(uid)) || ''; }
    catch (_) { return ''; }
  }
  function setPhase(next) {
    if (phase === next) return;
    phase = next;
    try {
      if (next) root.localStorage?.setItem(phaseKey(owner), next);
      else root.localStorage?.removeItem(phaseKey(owner));
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
      rejected: 'تعذّر اعتماد بعض التغييرات.', choice: 'إزالة الكلمة تحتاج اختيارك.',
      choiceCopy: 'افتح العالم الخاص واضغط حذف بجانب الكلمة لاختيار مصيرها.',
      denied: 'رفض الخادم الصلاحية لهذه العملية. تحقّق من حسابك.',
      invalid: 'لم تعد البيانات صالحة لهذا الإجراء. افتح العنصر وأعد المحاولة.',
      unexpected: 'راجع العملية في قسمها. ستتابع المزامنة للتغييرات المستقلة.', close: 'إغلاق حالة المزامنة',
      scopes: { dictionary: 'القاموس', 'custom-worlds': 'عالم خاص', 'custom-world-remove': 'حذف عالم خاص',
        'gate-lesson': 'حفظ الدرس', 'level-placement': 'إجابات التقييم', 'quiz-draft': 'مسودة الاختبار', 'quiz-result': 'نتيجة الاختبار',
        entry: 'الأونبوردنج', profile: 'الملف الشخصي', notifications: 'الإشعارات' },
      actions: { add: 'إضافة كلمة', edit: 'تعديل كلمة', remove: 'إزالة كلمة', 'remove-private': 'إزالة كلمة من عالم خاص', transfer: 'نسخ أو نقل كلمة' },
    },
    en: {
      waiting: 'Your progress is saved on this device.', quota: 'Changes will sync automatically when the quota resets.',
      offline: 'Changes will sync automatically when you reconnect.', service: 'Changes will sync automatically when the service returns.',
      capacity: 'Sync will resume automatically when capacity is available.',
      active: 'Syncing your data and progress…', activeCopy: 'You can keep using the site.',
      success: 'Your data and progress are synced.', fail: 'Could not save to this device.',
      failCopy: 'Check your browser storage settings or available space, then try again.',
      rejected: 'Some changes could not be confirmed.', choice: 'Choose how to remove this word.',
      choiceCopy: 'Open the private world and select Delete next to the word to see the choices.', denied: 'The server denied permission. Check your account.',
      invalid: 'The data is no longer valid for this action. Open the item and try again.',
      unexpected: 'Review the action in its section. Other changes will keep syncing.', close: 'Dismiss sync status',
      scopes: { dictionary: 'Dictionary', 'custom-worlds': 'Private world', 'custom-world-remove': 'Private world removal',
        'gate-lesson': 'Lesson checkpoint', 'level-placement': 'Assessment answers', 'quiz-draft': 'Quiz checkpoint', 'quiz-result': 'Quiz result',
        entry: 'Onboarding', profile: 'Profile', notifications: 'Notifications' },
      actions: { add: 'Add a word', edit: 'Edit a word', remove: 'Remove a word', 'remove-private': 'Remove a private world word', transfer: 'Copy or move a word' },
    },
  };

  function layout() {
    const visible = !bar.hidden && bar.getClientRects().length > 0;
    if (visible) {
      const bounds = header.getBoundingClientRect();
      bar.style.top = Math.round(bounds.bottom + 5) + 'px';
      bar.style.left = (bounds.left + bounds.width / 2) + 'px';
      bar.style.width = bounds.width + 'px';
    }
    document.body.style.setProperty('--sync-status-offset', visible ? `${bar.offsetHeight + 6}px` : '0px');
  }

  function presentation(status, unavailable, recovering, text) {
    let kind = '', heading = '', message = '';
    if (status?.localFailure) {
      kind = 'error'; heading = text.fail; message = text.failCopy;
    } else if (status?.rejected) {
      const rejection = status.rejections?.[0];
      const reason = rejection?.reason;
      kind = 'error'; heading = text.rejected;
      if (reason === 'private-disposition') heading = text.choice;
      message = reason === 'private-disposition' ? text.choiceCopy
        : ['permission-denied', 'unauthenticated'].includes(reason) ? text.denied
        : ['invalid-argument', 'failed-precondition', 'not-found'].includes(reason) ? text.invalid : text.unexpected;
      const description = text.actions[rejection?.type] || text.scopes[rejection?.scope];
      if (description) message = description + (rejection.name ? ` «${rejection.name}»` : '') + '. ' + message;
    } else if (status?.pending && unavailable) {
      kind = 'pending'; heading = text.waiting; message = text[unavailable] || text.service;
    } else if (recovering && !unavailable && (status?.pending || status?.active)) {
      kind = 'active'; heading = text.active; message = text.activeCopy;
    }
    return { kind, heading, message };
  }

  function render() {
    const uid = root.auth?.currentUser?.uid || '';
    if (uid !== owner) {
      owner = uid; phase = readPhase(uid);
    }
    const status = root.LootLinguaOperations?.syncStatus(uid);
    const text = labels[arabic() ? 'ar' : 'en'];
    let kind = '', heading = '', message = '';
    const unavailable = root.navigator?.onLine === false ? 'offline' : root.LootLinguaCloudBackoff?.reason() || '';
    // Pending counts come from durable queues. Normal writes never open a recovery.
    if (uid && status && !status.localFailure) {
      if (status.pending && unavailable === 'quota') setPhase('waiting');
      else if (phase === 'waiting' && !unavailable && status.pending && status.active) setPhase('recovering');
      else if (!status.pending && !status.rejected && !status.active && document.readyState === 'complete') {
        if (phase === 'recovering') setPhase('success');
        else if (phase === 'waiting' && !unavailable) setPhase('');
      }
    }
    ({ kind, heading, message } = presentation(status, unavailable, phase === 'recovering', text));
    if (!kind && phase === 'success') {
      kind = 'success'; heading = text.success;
    }
    bar.hidden = !kind;
    bar.dataset.state = kind;
    bar.dir = arabic() ? 'rtl' : 'ltr';
    if (title.textContent !== heading) title.textContent = heading;
    if (copy.textContent !== message) copy.textContent = message;
    copy.hidden = !message;
    close.hidden = kind !== 'success';
    close.setAttribute('aria-label', text.close);
    icon.className = 'fa-solid ' + ({ error: 'fa-triangle-exclamation', active: 'fa-rotate', success: 'fa-circle-check' }[kind] || 'fa-cloud');
    if (quizBar) {
      const quizActive = document.body.classList?.contains('quiz-active');
      const assessment = root.LootLinguaOperations?.syncStatus(uid, ['quiz-result', 'quiz-draft', 'quiz-checkpoint', 'level-placement']);
      const state = presentation(assessment, unavailable, phase === 'recovering', text);
      quizBar.hidden = !quizActive || !state.kind;
      quizBar.dataset.state = state.kind;
      quizBar.dir = bar.dir;
      quizBar.querySelector('i').className = 'fa-solid ' + ({ error: 'fa-triangle-exclamation', active: 'fa-rotate' }[state.kind] || 'fa-cloud');
      const quizTitle = quizBar.querySelector('[data-sync-title]');
      if (quizTitle.textContent !== state.heading) quizTitle.textContent = state.heading;
      const quizCopy = quizBar.querySelector('[data-sync-copy]');
      if (quizCopy.textContent !== state.message) quizCopy.textContent = state.message;
      quizCopy.hidden = !state.message;
      const exit = document.querySelector?.('[data-quiz-result-exit]');
      if (exit) exit.textContent = arabic() ? 'متابعة التعلّم' : 'Keep learning';
    }
    layout();
  }
  close.addEventListener('click', () => { setPhase(''); render(); });
  root.addEventListener('storage', event => {
    if (owner && event.key === phaseKey(owner)) { phase = readPhase(owner); render(); }
  });
  for (const event of ['load', 'lootlingua:sync-state', 'lootlingua:quiz-mode-changed', 'lootlingua:auth-state', 'lootlingua:cloud-capacity-change', 'online', 'offline']) {
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
