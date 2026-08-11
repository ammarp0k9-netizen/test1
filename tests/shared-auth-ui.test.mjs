import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const landing = read('landing.html');
const landingCss = read('landing.css');
const landingJs = read('js/landing.js');
const app = read('index.html');
const appCss = read('style.css');
const cloud = read('js/cloud.js');
const entry = read('js/entry-experience-controller.js');
const sharedController = read('js/auth-controller.js');
const sharedSurface = read('js/auth-surface.js');
const worlds = read('js/worlds.js');
const dictionary = read('js/dictionary.js');

test('Landing previews are real DOM mapped to the current product contracts', () => {
  for (const className of [
    'published-journey-node',
    'published-gate-switcher',
    'published-gate-state-card',
    'dictionary-search-row',
    'sug-result-card',
    'gamer-meaning-btn',
    'quizViewCard',
    'card-container',
    'card-face',
    'quiz-controls',
  ]) assert.match(landing, new RegExp(className));

  assert.match(worlds, /published-journey-node published-gate-node is-\$\{state\}/);
  assert.match(worlds, /published-gate-switcher-item is-\$\{state\}/);
  assert.match(dictionary, /gamer-meaning-bubble search-zone/);
  assert.match(app, /id="quizViewCard"/);
  assert.match(landingJs, /data-context-toggle/);
  assert.match(landingJs, /data-review-card/);
  assert.doesNotMatch(landing, /fake-browser|browser-frame|published-journey[^"']*\.(?:png|jpe?g|webp)/i);
});

test('the only raster image inside the Landing is the real LootLingua logo', () => {
  const sources = [...landing.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((match) => match[1]);
  assert.ok(sources.length >= 3);
  assert.deepEqual(new Set(sources), new Set(['Lootlingua_LOGO_2.png']));
  assert.ok(fs.existsSync(path.join(root, 'Lootlingua_LOGO_2.png')));
});

test('Landing and app mount the same Auth controller through separate UI adapters', () => {
  assert.match(landingJs, /createAuthSurface/);
  assert.match(cloud, /mountAppAuth/);
  assert.match(cloud, /signInWithEmailAndPassword\(auth, email, password\)/);
  assert.match(cloud, /createUserWithEmailAndPassword\(auth, email, password\)/);
  assert.match(cloud, /sendPasswordResetEmail\(auth, email\)/);
  assert.match(sharedSurface, /createAuthController/);
  assert.match(sharedController, /SAFE_RESET_MESSAGE/);
  assert.match(sharedController, /password !== confirmation/);
  assert.match(app, /id="appAuthDialogShell"/);
  for (const document of [landing, app]) {
    assert.match(document, /data-auth-input="email"/);
    assert.match(document, /data-auth-input="password"/);
    assert.match(document, /data-auth-input="confirmation"/);
    assert.match(document, /autocomplete="email"/);
    assert.match(document, /autocomplete="current-password"/);
    assert.match(document, /autocomplete="new-password"/);
    assert.match(document, /data-auth-google/);
    assert.match(document, /data-auth-mode="reset"/);
  }
});

test('password visibility controls are separate boxes and passwords are never persisted', () => {
  assert.match(landing, /class="password-input-row"[^>]*><input[^>]+><button/);
  assert.match(app, /class="app-password-input-row"[^>]*><input[^>]+><button/);
  assert.match(landingCss, /\.password-input-row\s*\{[^}]*grid-template-columns:/s);
  assert.match(appCss, /\.app-password-input-row\s*\{[^}]*grid-template-columns:/s);
  assert.doesNotMatch(landingCss, /\.password-input-row[^}]*position:\s*absolute/s);
  assert.doesNotMatch(appCss, /\.app-password-input-row[^}]*position:\s*absolute/s);
  assert.doesNotMatch([landingJs, cloud, sharedController, sharedSurface].join('\n'), /(?:localStorage|sessionStorage)[^\n]*(?:password|credential)|(?:password|credential)[^\n]*(?:localStorage|sessionStorage)/i);
  assert.match(sharedSurface, /input\.value = ''/);
});

test('app Auth preserves existing account hydration and guest migration ownership', () => {
  assert.match(cloud, /onAuthStateChanged\(auth, \(user\) =>/);
  assert.match(cloud, /prepareGuestMigrationForUser\(user\)/);
  assert.match(cloud, /loadWordsFromCloud\(user\)/);
  assert.match(cloud, /observeAuth: \(callback\) => onAuthStateChanged\(auth, callback\)/);
  assert.match(entry, /root\.openAppAuth\('login'\)/);
  assert.match(entry, /pendingIntentStorageKey/);
  assert.match(entry, /claimGuestPendingIntentForUser/);
  assert.match(entry, /'appAuthDialogShell'/);
});

test('identity, truthful demo labels, and non-saving review claims are consistent', () => {
  assert.equal((landing.match(/كل كلمة تفتح طريقًا/g) || []).length, 2);
  assert.doesNotMatch(landing, /تعلّم كلمة، وافتح عالمًا/);
  assert.match(landing, /Lootlingua_LOGO_2\.png/);
  assert.match(landing, /هذه بيانات عرض ثابتة؛ لا تمثل تقدّم مستخدم حقيقي/);
  assert.match(landing, /لا يحفظ نتيجة، ولا يمنح XP، ولا يغيّر streak/);
  assert.match(landing, /الترجمة تعطيك البداية/);
  assert.doesNotMatch(landing, /كل ترجمة[^<]*(?:AI|ذكاء اصطناعي)/i);
});
