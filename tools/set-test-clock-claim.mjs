import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const uid = String(process.argv[2] || '').trim();
const mode = String(process.argv[3] || 'grant').trim().toLowerCase();
const shouldGrant = !['revoke', 'false', '0', 'remove'].includes(mode);

if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) {
  console.error('Usage: npm run set-test-clock-claim -- <firebase-uid> [grant|revoke]');
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  try {
    const auth = getAuth();
    const user = await auth.getUser(uid);
    const claims = { ...(user.customClaims || {}) };
    if (shouldGrant) {
      if (claims.admin !== true) {
        throw new Error('The testClock claim can only be granted to an existing admin account.');
      }
      claims.testClock = true;
    } else {
      delete claims.testClock;
    }
    await auth.setCustomUserClaims(uid, claims);
    console.log(`Test Clock claim ${shouldGrant ? 'granted to' : 'revoked from'} UID ${uid}.`);
    console.log('The user must refresh their ID token or sign in again.');
  } catch (error) {
    console.error(error?.code || 'test-clock/claim-update-failed', error?.message || error);
    process.exitCode = 1;
  }
}
