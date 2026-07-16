import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const stage = process.argv[2];

function requireMarker(source, marker) {
  const first = source.indexOf(marker);
  if (first < 0) throw new Error(`Missing marker: ${marker}`);
  if (source.indexOf(marker, first + marker.length) >= 0) throw new Error(`Marker is not unique: ${marker}`);
  return first;
}

function write(relativePath, value) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

if (stage === 'stage-b') {
  const scriptPath = path.join(root, 'script.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const storageHeading = '// State';
  const appHeading = 'let currentFilter';
  const storageHeadingIndex = requireMarker(source, storageHeading);
  const storageStart = source.lastIndexOf('\n', storageHeadingIndex - 1) + 1;
  const appStart = requireMarker(source, appHeading);
  const core = source.slice(0, storageStart);
  const storage = source.slice(storageStart, appStart);
  const app = source.slice(appStart);
  if (`${core}${storage}${app}` !== source) throw new Error('Stage B split changed source bytes');
  write('js/core.js', core);
  write('js/storage.js', storage);
  write('script.js', app);
  console.log(JSON.stringify({
    sourceBytes: Buffer.byteLength(source),
    coreBytes: Buffer.byteLength(core),
    storageBytes: Buffer.byteLength(storage),
    scriptBytes: Buffer.byteLength(app),
    recombined: `${core}${storage}${app}` === source,
  }, null, 2));
} else if (stage === 'stage-c') {
  const indexPath = path.join(root, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const specs = [
    { comment: '<!-- ══ FIREBASE ══ -->', file: 'js/cloud.js' },
    { comment: '<!-- ══ FIREBASE PROFILE SYNC ══ -->', file: 'js/profile-cloud.js' },
  ];
  const replacements = specs.map(spec => {
    const commentIndex = requireMarker(html, spec.comment);
    const openTag = '<script type="module">';
    const openIndex = html.indexOf(openTag, commentIndex + spec.comment.length);
    if (openIndex < 0) throw new Error(`Missing module after ${spec.comment}`);
    const bodyStart = openIndex + openTag.length;
    const closeIndex = html.indexOf('</script>', bodyStart);
    if (closeIndex < 0) throw new Error(`Missing module close after ${spec.comment}`);
    const body = html.slice(bodyStart, closeIndex);
    write(spec.file, body);
    return {
      ...spec,
      start: openIndex,
      end: closeIndex + '</script>'.length,
      replacement: `<script type="module" src="${spec.file}"></script>`,
      bytes: Buffer.byteLength(body),
    };
  });
  let nextHtml = html;
  replacements.sort((a, b) => b.start - a.start).forEach(item => {
    nextHtml = `${nextHtml.slice(0, item.start)}${item.replacement}${nextHtml.slice(item.end)}`;
  });
  fs.writeFileSync(indexPath, nextHtml);
  console.log(JSON.stringify({
    indexBytesBefore: Buffer.byteLength(html),
    indexBytesAfter: Buffer.byteLength(nextHtml),
    modules: replacements.map(({ file, bytes }) => ({ file, bytes })),
  }, null, 2));
} else if (stage === 'stage-d') {
  const scriptPath = path.join(root, 'script.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const xpHeadingIndex = requireMarker(source, '// XP & GAMIFICATION');
  const xpStart = source.lastIndexOf('\n', xpHeadingIndex - 1) + 1;
  const appBeforeSrsStart = requireMarker(source, 'function normalizeWord(w)');
  const srsHeadingIndex = requireMarker(source, '// QUIZ — Modes + Settings');
  const srsStart = source.lastIndexOf('\n', srsHeadingIndex - 1) + 1;
  const appAfterSrsStart = requireMarker(source, 'function getQuizDay(ts = Date.now())');
  const bootstrap = source.slice(0, xpStart);
  const xp = source.slice(xpStart, appBeforeSrsStart);
  const appBeforeSrs = source.slice(appBeforeSrsStart, srsStart);
  const srs = source.slice(srsStart, appAfterSrsStart);
  const appAfterSrs = source.slice(appAfterSrsStart);
  const recombined = `${bootstrap}${xp}${appBeforeSrs}${srs}${appAfterSrs}`;
  if (recombined !== source) throw new Error('Stage D split changed source bytes');
  write('script.js', bootstrap);
  write('js/xp.js', xp);
  write('js/app-before-srs.js', appBeforeSrs);
  write('js/srs.js', srs);
  write('js/app-after-srs.js', appAfterSrs);
  console.log(JSON.stringify({
    sourceBytes: Buffer.byteLength(source),
    scriptBytes: Buffer.byteLength(bootstrap),
    xpBytes: Buffer.byteLength(xp),
    appBeforeSrsBytes: Buffer.byteLength(appBeforeSrs),
    srsBytes: Buffer.byteLength(srs),
    appAfterSrsBytes: Buffer.byteLength(appAfterSrs),
    recombined: recombined === source,
  }, null, 2));
} else if (stage === 'stage-d-transitions') {
  const sourcePath = path.join(root, 'js', 'app-after-srs.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transitionsStart = requireMarker(source, 'function computeSrsUpdate');
  const afterTransitionsStart = requireMarker(source, 'async function commitVerifiedQuizResults');
  const quizBeforeTransitions = source.slice(0, transitionsStart);
  const transitions = source.slice(transitionsStart, afterTransitionsStart);
  const appAfterTransitions = source.slice(afterTransitionsStart);
  const recombined = `${quizBeforeTransitions}${transitions}${appAfterTransitions}`;
  if (recombined !== source) throw new Error('Stage D transition split changed source bytes');
  write('js/app-quiz-before-srs-transitions.js', quizBeforeTransitions);
  write('js/srs-transitions.js', transitions);
  write('js/app-after-srs.js', appAfterTransitions);
  console.log(JSON.stringify({
    sourceBytes: Buffer.byteLength(source),
    quizBeforeTransitionsBytes: Buffer.byteLength(quizBeforeTransitions),
    transitionsBytes: Buffer.byteLength(transitions),
    appAfterTransitionsBytes: Buffer.byteLength(appAfterTransitions),
    recombined: recombined === source,
  }, null, 2));
} else if (stage === 'stage-e') {
  const sourcePath = path.join(root, 'js', 'app-before-srs.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const worldsStart = requireMarker(source, 'const LOOT_BOX_COOLDOWN_MS');
  const dictionaryRenderStart = requireMarker(source, 'function highlightText(text, query)');
  const dictionary = source.slice(0, worldsStart);
  const worlds = source.slice(worldsStart, dictionaryRenderStart);
  const dictionaryRender = source.slice(dictionaryRenderStart);
  const recombined = `${dictionary}${worlds}${dictionaryRender}`;
  if (recombined !== source) throw new Error('Stage E split changed source bytes');
  write('js/dictionary.js', dictionary);
  write('js/worlds.js', worlds);
  write('js/dictionary-render.js', dictionaryRender);
  console.log(JSON.stringify({
    sourceBytes: Buffer.byteLength(source),
    dictionaryBytes: Buffer.byteLength(dictionary),
    worldsBytes: Buffer.byteLength(worlds),
    dictionaryRenderBytes: Buffer.byteLength(dictionaryRender),
    recombined: recombined === source,
  }, null, 2));
} else if (stage === 'stage-f') {
  const quizBeforePath = path.join(root, 'js', 'app-quiz-before-srs-transitions.js');
  const afterSrsPath = path.join(root, 'js', 'app-after-srs.js');
  const quizBefore = fs.readFileSync(quizBeforePath, 'utf8');
  const afterSrs = fs.readFileSync(afterSrsPath, 'utf8');
  const coreHeadingIndex = requireMarker(afterSrs, '// Keyboard shortcuts');
  const coreRuntimeStart = afterSrs.lastIndexOf('\n', coreHeadingIndex - 1) + 1;
  const quizRuntime = afterSrs.slice(0, coreRuntimeStart);
  const coreRuntime = afterSrs.slice(coreRuntimeStart);
  if (`${quizRuntime}${coreRuntime}` !== afterSrs) throw new Error('Stage F split changed source bytes');
  write('js/quiz.js', quizBefore);
  write('js/quiz-runtime.js', quizRuntime);
  write('js/core-runtime.js', coreRuntime);
  console.log(JSON.stringify({
    quizBytes: Buffer.byteLength(quizBefore),
    afterSrsBytes: Buffer.byteLength(afterSrs),
    quizRuntimeBytes: Buffer.byteLength(quizRuntime),
    coreRuntimeBytes: Buffer.byteLength(coreRuntime),
    recombined: `${quizRuntime}${coreRuntime}` === afterSrs,
  }, null, 2));
} else {
  throw new Error(`Unknown split stage: ${stage || '(missing)'}`);
}
