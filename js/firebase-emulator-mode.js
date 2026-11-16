export function firebaseEmulatorSelected(location, storage) {
  const requested = new URLSearchParams(location.search).get('firebaseEmulator') === '1';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (requested && !local) throw new Error('Firebase emulation requires a loopback host.');
  if (!local) return false;
  const key = 'lootlingua:firebase-emulator';
  if (requested) storage.setItem(key, '1');
  return requested || storage.getItem(key) === '1';
}

export const firebaseDemoConfig = Object.freeze({
  apiKey: 'demo-lootlingua', projectId: 'demo-lootlingua', authDomain: 'localhost', appId: 'demo-lootlingua',
});
