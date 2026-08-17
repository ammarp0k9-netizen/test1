import { getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const app = getApps()[0];
const submitFeedback = app ? httpsCallable(getFunctions(app), 'submitFeedback') : null;

function ownerId() {
  return String(window.auth?.currentUser?.uid || 'guest');
}

function submittedKey() { return `lootlingua_feedback_submitted_v1_${ownerId()}`; }
function dismissedKey() { return `lootlingua_feedback_dismissed_at_v1_${ownerId()}`; }

function close(shell, returnFocus) {
  shell?.remove();
  if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
}

function feedbackError(error) {
  const code = String(error?.code || '');
  if (code.includes('resource-exhausted')) return 'وصلت الحد المؤقت لإرسال التقييمات. جرّب لاحقًا.';
  return 'تعذّر إرسال التقييم الآن. جرّب مرة أخرى.';
}

function open(notificationId = '') {
  if (!submitFeedback || document.getElementById('feedbackDialogShell')) return;
  const returnFocus = document.activeElement;
  const guest = !window.auth?.currentUser;
  const shell = document.createElement('div');
  shell.id = 'feedbackDialogShell';
  shell.className = 'feedback-dialog-shell';
  shell.innerHTML = `
    <button type="button" class="feedback-dialog-backdrop" aria-label="إغلاق نافذة التقييم"></button>
    <section class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedbackDialogTitle" aria-describedby="feedbackDialogIntro">
      <button type="button" class="feedback-dialog-close" aria-label="إغلاق">×</button>
      <p class="feedback-eyebrow">رأيك يهمنا</p>
      <h2 id="feedbackDialogTitle">كيف كانت تجربتك؟</h2>
      <p id="feedbackDialogIntro">اختر تقييمًا سريعًا، واكتب ما تريد إن أحببت.</p>
      <form novalidate>
        <fieldset class="feedback-rating" aria-label="التقييم من 1 إلى 5 نجوم">
          ${[1, 2, 3, 4, 5].map((rating) => `<button type="button" data-rating="${rating}" aria-label="${rating} من 5" aria-pressed="false">★</button>`).join('')}
        </fieldset>
        ${guest ? '<label>اسم مختصر (اختياري)<input name="optionalName" maxlength="80" autocomplete="nickname"></label>' : ''}
        <label>احكِ لنا أكثر (اختياري)<textarea name="message" maxlength="1600" rows="4"></textarea></label>
        <p class="feedback-status" role="status" aria-live="polite"></p>
        <button class="feedback-submit" type="submit" disabled>إرسال التقييم</button>
      </form>
    </section>`;
  document.body.append(shell);
  const form = shell.querySelector('form');
  const submit = shell.querySelector('.feedback-submit');
  const status = shell.querySelector('.feedback-status');
  let rating = 0;
  const setRating = (next) => {
    rating = next;
    shell.querySelectorAll('[data-rating]').forEach((button) => {
      const active = Number(button.dataset.rating) <= rating;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(Number(button.dataset.rating) === rating));
    });
    submit.disabled = !rating;
  };
  shell.querySelectorAll('[data-rating]').forEach((button) => button.addEventListener('click', () => setRating(Number(button.dataset.rating))));
  const dismiss = () => close(shell, returnFocus);
  shell.querySelector('.feedback-dialog-backdrop').addEventListener('click', dismiss);
  shell.querySelector('.feedback-dialog-close').addEventListener('click', dismiss);
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      document.removeEventListener('keydown', onKeydown, true);
      dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...shell.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeydown, true);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!rating || submit.disabled) return;
    submit.disabled = true;
    status.textContent = 'جارٍ إرسال تقييمك…';
    try {
      await submitFeedback({
        rating,
        message: String(form.elements.message?.value || '').trim(),
        optionalName: String(form.elements.optionalName?.value || '').trim(),
      });
      localStorage.setItem(submittedKey(), '1');
      if (notificationId) window.LootLinguaNotificationStore?.resolve?.([notificationId], 'feedback-submitted', Date.now());
      window.LootLinguaNotificationRuntime?.requestEvaluation?.('feedback-submitted', 0);
      window.showToast?.('شكرًا لتقييمك!', 'success', 3000);
      document.removeEventListener('keydown', onKeydown, true);
      dismiss();
    } catch (error) {
      status.textContent = feedbackError(error);
      submit.disabled = false;
    }
  });
  requestAnimationFrame(() => shell.querySelector('[data-rating="1"]')?.focus());
}

const API = Object.freeze({
  open,
  markDismissed() {
    localStorage.setItem(dismissedKey(), String(Date.now()));
    window.LootLinguaNotificationRuntime?.requestEvaluation?.('feedback-dismissed', 0);
  },
});

Object.defineProperty(window, 'LootLinguaFeedback', { value: API, configurable: false, enumerable: true, writable: false });
