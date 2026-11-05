import { getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { createFeedbackWriter } from './feedback-transport.js?v=20261105-feedback-1';

const app = getApps()[0];
const submitFeedback = createFeedbackWriter({
  db: app ? getFirestore(app) : null,
  auth: app ? getAuth(app) : null,
  collection, doc, setDoc, serverTimestamp,
});

function ownerId() {
  return String(window.auth?.currentUser?.uid || 'guest');
}

function submittedKey(owner = ownerId()) { return `lootlingua_feedback_submitted_v1_${owner}`; }
function dismissedKey() { return `lootlingua_feedback_dismissed_at_v1_${ownerId()}`; }

function feedbackError(error) {
  const code = String(error?.code || '');
  if (code.includes('resource-exhausted')) return 'وصلت الحد المؤقت لإرسال التقييمات. جرّب لاحقًا.';
  if (code.includes('permission-denied')) return 'إرسال التقييمات غير مفعّل في قواعد قاعدة البيانات بعد. حاول لاحقًا.';
  if (code === 'feedback/auth-changed') return 'تغيّر الحساب. أغلق النافذة وافتحها من جديد لإرسال تقييمك.';
  if (code.includes('unavailable')) return 'تعذّر الاتصال. تأكد من الإنترنت وحاول مرة أخرى.';
  return 'تعذّر إرسال التقييم الآن. جرّب مرة أخرى.';
}

function open(notificationId = '') {
  if (!submitFeedback || document.getElementById('feedbackDialogShell')) return;
  const returnFocus = document.activeElement;
  const openedOwnerId = ownerId();
  const guest = openedOwnerId === 'guest';
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
  let busy = false;
  let waitTimer = null;
  const setRating = (next) => {
    if (busy) return;
    rating = next;
    shell.querySelectorAll('[data-rating]').forEach((button) => {
      const active = Number(button.dataset.rating) <= rating;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(Number(button.dataset.rating) === rating));
    });
    submit.disabled = !rating;
  };
  shell.querySelectorAll('[data-rating]').forEach((button) => button.addEventListener('click', () => setRating(Number(button.dataset.rating))));
  const dismiss = () => {
    clearTimeout(waitTimer);
    document.removeEventListener('keydown', onKeydown, true);
    shell.remove();
    if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
  };
  shell.querySelector('.feedback-dialog-backdrop').addEventListener('click', dismiss);
  shell.querySelector('.feedback-dialog-close').addEventListener('click', dismiss);
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
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
    if (!rating || busy) return;
    busy = true;
    submit.disabled = true;
    status.textContent = 'جارٍ إرسال تقييمك…';
    waitTimer = setTimeout(() => {
      if (shell.isConnected) status.textContent = 'ما زلنا بانتظار تأكيد الإرسال. تحقق من اتصالك؛ يمكنك إغلاق النافذة.';
    }, 8000);
    try {
      await submitFeedback({
        rating,
        message: String(form.elements.message?.value || '').trim(),
        optionalName: String(form.elements.optionalName?.value || '').trim(),
      }, openedOwnerId);
      try { localStorage.setItem(submittedKey(openedOwnerId), '1'); } catch (_) {}
      if (ownerId() !== openedOwnerId) { dismiss(); return; }
      try {
        if (notificationId) window.LootLinguaNotificationStore?.resolve?.(notificationId, 'feedback-submitted', Date.now());
        window.LootLinguaNotificationRuntime?.requestEvaluation?.('feedback-submitted', 0);
        if (shell.isConnected) window.showToast?.('شكرًا لتقييمك!', 'success', 3000);
      } catch (error) {
        console.warn('[Feedback] Saved; optional UI update failed.', error?.message || error);
      }
      dismiss();
    } catch (error) {
      status.textContent = feedbackError(error);
      submit.disabled = false;
    } finally {
      clearTimeout(waitTimer);
      busy = false;
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
