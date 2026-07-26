import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [worldsSource, cloudSource, htmlSource, styleSource, scriptSource] = await Promise.all([
  readFile(new URL('../js/worlds.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/journey-cloud.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../style.css', import.meta.url), 'utf8'),
  readFile(new URL('../js/script.js', import.meta.url), 'utf8'),
]);

test('gate readiness is computed from every loaded gate word, not the visible page', () => {
  const evaluation = cloudSource.slice(
    cloudSource.indexOf('async function evaluateActiveJourneyReadiness'),
    cloudSource.indexOf('function createGateClearAttemptId')
  );
  assert.match(evaluation, /progress\.loadedWordKeys/);
  assert.match(evaluation, /words\.length !== wordKeys\.length/);
  assert.match(evaluation, /computeGateReadiness\(\s*words/);
  assert.doesNotMatch(evaluation, /wordPager|currentPage|pageSize/);
});

test('the gate card exposes one aggregate progress bar and the three user categories', () => {
  const panel = worldsSource.slice(
    worldsSource.indexOf('function makePublishedGateJourneyPanel'),
    worldsSource.indexOf('function appendPublishedHeader')
  );
  assert.match(panel, /published-gate-readiness-track/);
  assert.match(panel, /published-gate-readiness-fill/);
  assert.match(panel, /جاهز:/);
  assert.match(panel, /مراجعة اليوم:/);
  assert.match(panel, /انتظار الغد:/);
  assert.doesNotMatch(panel, /published-word-readiness|word-readiness-indicator/);
});

test('readiness help explains the difference from SRS and mastery accessibly', () => {
  assert.match(htmlSource, /id="gateReadinessInfoModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(htmlSource, /ألوان الكلمات وحالة SRS/);
  assert.match(htmlSource, /أما الإتقان فهو هدف أبعد/);
  assert.match(worldsSource, /aria-label', 'شرح الاستعداد لاجتياز البوابة'/);
  assert.match(scriptSource, /function showModal[\s\S]*getModalFocusableElements/);
  assert.match(worldsSource, /event\.key === 'Escape'[\s\S]*hideModal\('gateReadinessInfoModal'\)/);
});

test('readiness uses one local gate timer and performs no Firestore read when it ticks', () => {
  const timer = worldsSource.slice(
    worldsSource.indexOf('function schedulePublishedReadinessTimer'),
    worldsSource.indexOf('window.openGateReadinessInfo')
  );
  assert.match(timer, /clearTimeout\(publishedContentState\.readinessTimer\)/);
  assert.match(timer, /setTimeout\(update, Math\.min\(remaining, 60000\)\)/);
  assert.doesNotMatch(timer, /getDoc|onSnapshot|force|listAllPublishedGateWords/);
});

test('readiness presentation includes mobile and dark-theme rules', () => {
  assert.match(styleSource, /\.published-gate-readiness/);
  assert.match(styleSource, /\.published-gate-readiness-heading strong[\s\S]*var\(--text-white\)/);
  assert.match(styleSource, /\.published-gate-readiness-copy[\s\S]*var\(--text-gray\)/);
  assert.match(styleSource, /\.published-gate-readiness-counts[\s\S]*flex-wrap: wrap/);
  assert.match(styleSource, /\.gate-readiness-info-modal \.modal-content[\s\S]*calc\(100vw - 28px\)/);
});
