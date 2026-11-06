(function attachStartupRecovery(root) {
  'use strict';
  let completed = false;
  let recovery = null;
  let failed = false;
  let continuing = false;
  const timer = setTimeout(() => showRecovery(false), 12000);

  function canContinueGuest() {
    return root.__lootlinguaAuthResolved === true && root.__lootlinguaAuthUser === null &&
      Boolean(root.auth) && root.auth.currentUser === null && root.__lootlinguaInitialDataReady === true &&
      typeof root.loadGuestDictionaryState === 'function' &&
      typeof root.LootLinguaEntryExperienceController?.boot === 'function';
  }

  function refresh() {
    if (!recovery || completed) return;
    const unresolved = root.__lootlinguaAuthResolved !== true;
    recovery.querySelector('[data-startup-message]').textContent = unresolved
      ? 'لم نتمكن بعد من تأكيد حالة تسجيل الدخول. تحقق من اتصالك ثم أعد المحاولة؛ لن نفتح بيانات الحساب كضيف.'
      : root.__lootlinguaAuthUser
        ? 'تعذّر إكمال تحميل حسابك. بياناتك محفوظة؛ تحقق من اتصالك وأعد المحاولة.'
        : 'تعذّر إكمال التحميل. يمكنك إعادة المحاولة، أو متابعة بيانات الضيف المحلية بعد تأكيد جاهزيتها.';
    const guest = recovery.querySelector('[data-startup-guest]');
    guest.hidden = !canContinueGuest();
    guest.disabled = continuing;
  }

  async function continueGuest() {
    if (completed || continuing || !canContinueGuest()) return false;
    continuing = true;
    refresh();
    try {
      // This reads the explicit guest scope only. Entry still owns classification
      // and first-screen selection; neither auth nor readiness flags are invented.
      root.loadGuestDictionaryState({ renderView: false });
      if (!canContinueGuest()) return false;
      await root.LootLinguaEntryExperienceController.boot();
      return completed;
    } catch (_) {
      showRecovery(true);
      return false;
    } finally {
      continuing = false;
      refresh();
    }
  }

  function showRecovery(isFailure) {
    if (completed) return;
    failed ||= Boolean(isFailure);
    const overlay = document.getElementById('smartLoadingOverlay');
    if (!overlay) return;
    if (!recovery) {
      recovery = document.createElement('section');
      recovery.id = 'startupRecovery';
      recovery.setAttribute('role', 'alert');
      recovery.setAttribute('aria-label', 'تعذّر إكمال التحميل');
      recovery.style.cssText = 'display:grid;gap:12px;max-width:380px;margin:16px auto 0;text-align:center;color:var(--text-white,#f8fafc)';
      const message = document.createElement('p');
      message.dataset.startupMessage = '';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'entry-primary';
      retry.textContent = 'إعادة المحاولة';
      retry.style.cssText = 'min-height:44px;border:1px solid var(--border,#334155);border-radius:10px;padding:10px 14px;background:var(--surface-bg,#1e293b);color:var(--text-white,#f8fafc);font:inherit;font-weight:700;cursor:pointer';
      retry.dataset.startupRetry = '';
      retry.addEventListener('click', () => root.location.reload());
      const guest = document.createElement('button');
      guest.type = 'button';
      guest.className = 'entry-secondary';
      guest.dataset.startupGuest = '';
      guest.textContent = 'متابعة بيانات الضيف على هذا الجهاز';
      guest.style.cssText = retry.style.cssText;
      guest.hidden = true;
      guest.addEventListener('click', continueGuest);
      recovery.append(message, retry, guest);
      (overlay.querySelector('.smart-loading-content') || overlay).appendChild(recovery);
    }
    refresh();
  }

  function complete() {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    recovery?.remove();
    root.performance?.mark?.('lootlingua:startup-ready');
    root.dispatchEvent(new CustomEvent('lootlingua:startup-complete'));
    const loadDecorations = () => {
      document.querySelectorAll('template[data-startup-script]').forEach(template => {
        const script = document.createElement('script');
        script.src = template.dataset.startupScript;
        script.async = true;
        template.replaceWith(script);
      });
    };
    if (root.requestIdleCallback) root.requestIdleCallback(loadDecorations, { timeout: 1500 });
    else setTimeout(loadDecorations, 0);
  }

  root.addEventListener('error', event => {
    if (event.target?.tagName === 'SCRIPT' && event.target.hasAttribute('data-startup-critical')) showRecovery(true);
  }, true);
  root.addEventListener('unhandledrejection', () => showRecovery(true));
  root.addEventListener('lootlingua:auth-state', refresh);
  root.addEventListener('lootlingua:initial-data-ready', refresh);
  root.LootLinguaStartupRecovery = Object.freeze({
    complete,
    continueGuest,
    getStatus: () => ({ completed, failed, canContinueGuest: canContinueGuest() }),
  });
})(window);
