export function publicLandingPath(locationLike = {}) {
  const hostname = String(locationLike.hostname || '');
  const pathname = String(locationLike.pathname || '/');
  if (!hostname.endsWith('.github.io')) return '/';
  const segments = pathname.split('/').filter(Boolean);
  return segments.length ? `/${segments[0]}/` : '/';
}

export async function runLogoutSequence(operations = {}) {
  // The durable, account-scoped outbox survives sign-out. An unavailable
  // network must not hold the authentication action hostage indefinitely.
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => operations.savePendingProfile?.()).catch(() => {}),
      new Promise(resolve => { timer = setTimeout(resolve, operations.saveTimeoutMs ?? 2000); }),
    ]);
  } finally { clearTimeout(timer); }
  operations.prepareLogout?.();
  const accountCleanup = operations.waitForAccountCleanup?.() || Promise.resolve();

  await operations.signOut?.();
  await accountCleanup;

  await operations.clearAccountState?.();
  await operations.purgeGuestIsolationState?.();
  await operations.resetProfileState?.();
  await operations.closeLogoutUi?.();
  await operations.afterCleanup?.();
  await operations.navigateToLanding?.();
}
