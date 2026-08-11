import { AUTH_MODES } from './auth-controller.js';
import { createAuthSurface } from './auth-surface.js';

let activeSurface = null;

export async function mountAppAuth({ gateway } = {}) {
  if (activeSurface) return activeSurface;
  const root = document.getElementById('appAuthDialogShell');
  if (!root) throw new Error('App Auth surface is missing.');

  activeSurface = createAuthSurface({
    root,
    triggerRoot: document,
    gateway,
    bodyClass: 'app-auth-dialog-open',
    onAuthenticated(user, source) {
      if (!user || source === 'existing') return;
      window.showToast?.('تم تسجيل الدخول بنجاح', 'success', 3200);
    },
  });

  window.openAppAuth = (mode = AUTH_MODES.LOGIN) => activeSurface.open(mode);
  window.closeAppAuth = () => activeSurface.close();
  await activeSurface.initialize();
  return activeSurface;
}
