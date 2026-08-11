import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const landing = read('landing.html');
const landingCss = read('landing.css');
const landingJs = read('js/landing.js');
const landingAuthController = read('js/landing-auth-controller.js');
const sharedAuthController = read('js/auth-controller.js');
const sharedAuthSurface = read('js/auth-surface.js');
const appCloud = read('js/cloud.js');
const appShell = read('js/script.js');
const appDocument = read('index.html');
const sitemap = read('sitemap.xml');
const privacy = read('privacy.html');
const robots = read('robots.txt');
const vercel = JSON.parse(read('vercel.json'));
const fallback = read('404.html');

function rewriteDestination(source) {
  return vercel.rewrites.find((entry) => entry.source === source)?.destination;
}

async function freePort() {
  const socket = net.createServer();
  socket.unref();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startStaticServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'tools', 'static-server.mjs'), String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const append = (chunk) => { output += chunk.toString(); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);

  const deadline = Date.now() + 5000;
  while (!output.includes('LootLingua audit server:')) {
    if (child.exitCode !== null) throw new Error(`Static server exited early: ${output}`);
    if (Date.now() > deadline) throw new Error(`Static server did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { child, origin: `http://127.0.0.1:${port}` };
}

async function stopStaticServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

test('landing is a standalone RTL page with accessible entry choices', () => {
  assert.match(landing, /<html lang="ar" dir="rtl">/);
  assert.match(landing, /<main id="mainContent">/);
  assert.match(landing, /class="skip-link"/);
  assert.match(landing, /data-auth-dialog/);
  assert.match(landing, /data-auth-google/);
  assert.match(landing, /تعلّم الإنجليزية من الأشياء/);
  assert.match(landing, /افهم المعنى، ثم افهم استخدامه/);
  assert.match(landing, /data-app-link/);
  assert.match(landing, /تقدر تبدأ كضيف/);
  assert.match(landing, /aria-live="polite"/);
  assert.doesNotMatch(landing, /js\/script\.js|style\.css|tesseract|font-awesome/i);
  assert.match(landingCss, /@media \(max-width: 340px\)/);
  assert.match(landingCss, /prefers-reduced-motion: reduce/);
  assert.match(landingCss, /:focus-visible/);
  assert.match(landing, /autocomplete="email"/);
  assert.match(landing, /autocomplete="current-password"/);
  assert.match(landing, /autocomplete="new-password"/);
  assert.doesNotMatch(landingJs + landingAuthController + sharedAuthController + sharedAuthSurface, /localStorage[^\n]*(?:password|credential)|(?:password|credential)[^\n]*localStorage/i);
});

test('landing reuses the production Firebase project and navigates only internally', () => {
  const projectId = /projectId:\s*["']([^"']+)/.exec(appCloud)?.[1];
  const landingProjectId = /projectId:\s*["']([^"']+)/.exec(landingJs)?.[1];
  const appId = /appId:\s*["']([^"']+)/.exec(appCloud)?.[1];
  const landingAppId = /appId:\s*["']([^"']+)/.exec(landingJs)?.[1];
  assert.equal(landingProjectId, projectId);
  assert.equal(landingAppId, appId);
  assert.match(landingJs, /authSdk\.onAuthStateChanged\(auth,/);
  assert.match(landingJs, /authSdk\.signInWithPopup\(auth, provider\)/);
  assert.match(landingJs, /authSdk\.signInWithRedirect\(auth, provider\)/);
  assert.match(landingJs, /authSdk\.signInWithEmailAndPassword\(auth, email, password\)/);
  assert.match(landingJs, /authSdk\.createUserWithEmailAndPassword\(auth, email, password\)/);
  assert.match(landingJs, /authSdk\.sendPasswordResetEmail\(auth, email\)/);
  assert.match(landingJs, /target\.origin !== location\.origin/);
  assert.match(landingJs, /endsWith\(['"]\.github\.io['"]\) \? ['"]\/privacy\.html['"] : ['"]\/privacy['"]/);
  assert.doesNotMatch(landingJs, /returnTo|redirect_uri|continueUrl/);
});

test('public metadata consistently uses the canonical production origin', () => {
  const canonicalOrigin = 'https://loot-lingua.vercel.app/';
  assert.match(landing, new RegExp(`<link rel="canonical" href="${canonicalOrigin}"`));
  assert.match(landing, new RegExp(`<meta property="og:url" content="${canonicalOrigin}"`));
  assert.match(appDocument, new RegExp(`<meta property="og:url" content="${canonicalOrigin}"`));
  assert.match(sitemap, /<loc>https:\/\/loot-lingua\.vercel\.app\/<\/loc>/);
  assert.match(privacy, /https:\/\/loot-lingua\.vercel\.app\/privacy/);
  assert.match(robots, /https:\/\/loot-lingua\.vercel\.app\/sitemap\.xml/);
  assert.doesNotMatch(
    [landing, appDocument, sitemap, privacy, robots].join('\n'),
    /https:\/\/lootlingua\.vercel\.app/,
  );
});

test('Vercel routes root to landing and app paths to the existing app document', () => {
  assert.equal(rewriteDestination('/'), '/landing.html');
  assert.equal(rewriteDestination('/app'), '/index.html');
  assert.equal(rewriteDestination('/app/:path*'), '/index.html');
  assert.equal(rewriteDestination('/privacy'), '/privacy.html');
  assert.equal(vercel.rewrites.at(-1).source, '/:path*');
  assert.equal(vercel.rewrites.at(-1).destination, '/index.html');
  assert.match(appShell, /return segments\[0\] === 'app' \? '\/app' : ''/);
  assert.match(appShell, /segments\[1\] === 'app' \? `\/\$\{segments\[0\]\}\/app`/);
});

test('GitHub Pages fallback bypasses landing when recovering app deep links', () => {
  assert.match(fallback, /projectBase\s*\+\s*['"]\/index\.html\?/);
  assert.match(fallback, /params\.set\(['"]p['"], route/);
  assert.doesNotMatch(fallback, /projectBase\s*\+\s*['"]\/\?['"]/);
});

test('local static server serves landing, app, privacy, assets, and app fallbacks', async (t) => {
  const { child, origin } = await startStaticServer();
  t.after(() => stopStaticServer(child));

  const cases = [
    ['/', 'text/html', /<title>LootLingua \| تعلّم الإنجليزية من الأشياء اللي تحبها<\/title>/],
    ['/app', 'text/html', /<title>LootLingua \| قاموس الأساطير<\/title>/],
    ['/app/worlds/example', 'text/html', /<title>LootLingua \| قاموس الأساطير<\/title>/],
    ['/worlds/example', 'text/html', /<title>LootLingua \| قاموس الأساطير<\/title>/],
    ['/privacy', 'text/html', /سياسة الخصوصية/],
    ['/landing.css', 'text/css', /\.hero-grid/],
    ['/js/landing.js', 'text/javascript', /initializeAuth/],
    ['/js/landing-auth-controller.js', 'text/javascript', /createLandingAuthController/],
    ['/js/auth-controller.js', 'text/javascript', /createAuthController/],
    ['/js/auth-surface.js', 'text/javascript', /createAuthSurface/],
  ];

  for (const [url, contentType, content] of cases) {
    const response = await fetch(origin + url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get('content-type') || '', new RegExp(contentType), url);
    assert.match(await response.text(), content, url);
  }

  const missingAsset = await fetch(origin + '/missing-file.css');
  assert.equal(missingAsset.status, 404);
});
