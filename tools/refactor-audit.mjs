import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const indexPath = path.join(root, 'index.html');
const baselinePath = path.join(root, 'reports', 'refactor-baseline.json');
const mode = process.argv[2] || 'print';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function countLines(value) {
  return value === '' ? 0 : value.split(/\r?\n/).length;
}

function normalizeCode(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function extractScriptTags(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || 'classic';
    scripts.push({
      index: scripts.length,
      type,
      src,
      inlineBytes: src ? 0 : Buffer.byteLength(body),
      inlineLines: src ? 0 : countLines(body),
      body,
    });
  }
  return scripts;
}

function getAppJavaScript(html, scriptTags) {
  const sources = [];
  for (const tag of scriptTags) {
    if (!tag.src) {
      sources.push({ name: `index.html#script-${tag.index}`, type: tag.type, code: tag.body });
      continue;
    }
    if (/^(?:https?:)?\/\//i.test(tag.src)) continue;
    const cleanSrc = tag.src.split(/[?#]/)[0];
    const fullPath = path.join(root, cleanSrc);
    if (!fs.existsSync(fullPath)) continue;
    sources.push({ name: cleanSrc.replaceAll('\\', '/'), type: tag.type, code: fs.readFileSync(fullPath, 'utf8') });
  }
  return sources;
}

function extractAttributes(html, attribute) {
  const values = [];
  const re = new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']*)["']`, 'gi');
  let match;
  while ((match = re.exec(html))) values.push(match[1]);
  return values;
}

function extractInlineHandlers(html) {
  const handlers = [];
  const re = /\b(on[a-z]+)\s*=\s*(["'])([\s\S]*?)\2/gi;
  let match;
  while ((match = re.exec(html))) handlers.push({ attribute: match[1].toLowerCase(), code: normalizeCode(match[3]) });
  return handlers;
}

function extractHandlerCalls(handlers) {
  const ignored = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof']);
  const calls = [];
  for (const handler of handlers) {
    const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let match;
    while ((match = re.exec(handler.code))) {
      if (!ignored.has(match[1])) calls.push(match[1]);
    }
  }
  return sortedUnique(calls);
}

function extractFunctionDeclarations(code) {
  return [...code.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]);
}

function extractWindowExports(code) {
  return [...code.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map(match => match[1]);
}

function extractNamedConstants(code, suffixPattern) {
  const values = [];
  const re = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*(?:${suffixPattern}))\\s*=\\s*(["'])([^"']+)\\2`, 'g');
  let match;
  while ((match = re.exec(code))) values.push(`${match[1]}=${match[3]}`);
  return sortedUnique(values);
}

function extractStorageCalls(code) {
  return sortedUnique([...code.matchAll(/\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\s*\(([^\n;)]*)/g)]
    .map(match => normalizeCode(match[0])));
}

function findMatchingParen(code, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

function extractCalls(code, callNames) {
  const results = [];
  const names = [...callNames].join('|');
  const re = new RegExp(`\\b(${names})\\s*\\(`, 'g');
  let match;
  while ((match = re.exec(code))) {
    const openIndex = code.indexOf('(', match.index);
    const closeIndex = findMatchingParen(code, openIndex);
    if (closeIndex < 0) continue;
    results.push(normalizeCode(code.slice(match.index, closeIndex + 1)));
    re.lastIndex = closeIndex + 1;
  }
  return sortedUnique(results);
}

function countValues(values) {
  return values.reduce((result, value) => {
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function capture() {
  const html = read('index.html');
  const markupHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const style = read('style.css');
  const scriptTags = extractScriptTags(html);
  const appSources = getAppJavaScript(html, scriptTags);
  const combinedJs = appSources.map(source => source.code).join('\n');
  const inlineHandlers = extractInlineHandlers(markupHtml);
  const handlerCalls = extractHandlerCalls(inlineHandlers);
  const functionDeclarations = extractFunctionDeclarations(combinedJs);
  const windowExports = extractWindowExports(combinedJs);
  const availableGlobals = new Set([...functionDeclarations, ...windowExports]);
  const duplicateFunctionDeclarations = Object.entries(countValues(functionDeclarations))
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
  const duplicateWindowAssignments = Object.entries(countValues(windowExports))
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
  const ids = extractAttributes(markupHtml, 'id');
  const classes = extractAttributes(markupHtml, 'class').flatMap(value => value.trim().split(/\s+/).filter(Boolean));
  const quizModes = sortedUnique([
    ...extractAttributes(html, 'data-quiz-source'),
    ...extractAttributes(html, 'data-quiz-count'),
    ...[...combinedJs.matchAll(/\b(?:mode|selectedQuizMode)\s*===?\s*["']([^"']+)["']/g)].map(match => match[1]),
  ]);
  const srsStatuses = ['New', 'Learning', 'Reviewing', 'Mastered'];
  const srsStatusOccurrences = Object.fromEntries(srsStatuses.map(status => [status, (combinedJs.match(new RegExp(`["']${status}["']`, 'g')) || []).length]));
  const xpRewardBlock = combinedJs.match(/const\s+XP_REWARDS\s*=\s*Object\.freeze\s*\(\s*\{([\s\S]*?)\}\s*\)/)?.[1] || '';

  return {
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(['index.html', 'script.js', 'style.css'].map(file => {
      const value = read(file);
      return [file, { bytes: Buffer.byteLength(value), lines: countLines(value), sha256: sha256(value) }];
    })),
    appJavaScriptFiles: appSources.map(source => ({
      name: source.name,
      type: source.type,
      bytes: Buffer.byteLength(source.code),
      lines: countLines(source.code),
      sha256: sha256(source.code),
    })),
    scriptOrder: scriptTags.map(({ index, type, src, inlineBytes, inlineLines }) => ({ index, type, src, inlineBytes, inlineLines })),
    inlineJavaScript: {
      blocks: scriptTags.filter(tag => !tag.src).length,
      bytes: scriptTags.reduce((sum, tag) => sum + tag.inlineBytes, 0),
      lines: scriptTags.reduce((sum, tag) => sum + tag.inlineLines, 0),
    },
    inlineHandlers: {
      count: inlineHandlers.length,
      attributes: countValues(inlineHandlers.map(handler => handler.attribute)),
      requiredGlobals: handlerCalls,
      missingStaticGlobals: handlerCalls.filter(name => !availableGlobals.has(name)),
      entries: inlineHandlers,
    },
    globals: {
      functionDeclarationCount: functionDeclarations.length,
      windowExportCount: sortedUnique(windowExports).length,
      windowExports: sortedUnique(windowExports),
      duplicateFunctionDeclarations,
      duplicateWindowAssignments,
    },
    domContract: {
      idCount: ids.length,
      duplicateIds: Object.entries(countValues(ids)).filter(([, count]) => count > 1).map(([id, count]) => ({ id, count })),
      ids: sortedUnique(ids),
      classes: sortedUnique(classes),
    },
    storageContract: {
      namedKeysAndPrefixes: extractNamedConstants(combinedJs, '(?:KEY|PREFIX)'),
      calls: extractStorageCalls(combinedJs),
    },
    firestoreContract: {
      pathCalls: extractCalls(combinedJs, new Set(['collection', 'doc'])),
    },
    behaviorContract: {
      quizModes,
      srsStatusOccurrences,
      xpRewardsSource: normalizeCode(xpRewardBlock),
    },
    immutableStyleHash: sha256(style),
  };
}

function stableContract(snapshot) {
  return {
    inlineHandlers: snapshot.inlineHandlers,
    globals: snapshot.globals,
    domContract: snapshot.domContract,
    storageContract: snapshot.storageContract,
    firestoreContract: snapshot.firestoreContract,
    behaviorContract: snapshot.behaviorContract,
    immutableStyleHash: snapshot.immutableStyleHash,
  };
}

function diffValues(before, after, prefix = '') {
  const diffs = [];
  if (JSON.stringify(before) === JSON.stringify(after)) return diffs;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) {
    diffs.push(prefix || '(root)');
    return diffs;
  }
  const keys = sortedUnique([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) diffs.push(...diffValues(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  return diffs;
}

const snapshot = capture();

if (mode === 'snapshot') {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Baseline written: ${path.relative(root, baselinePath)}`);
  console.log(JSON.stringify({
    files: snapshot.files,
    inlineHandlers: snapshot.inlineHandlers.count,
    requiredGlobals: snapshot.inlineHandlers.requiredGlobals.length,
    missingStaticGlobals: snapshot.inlineHandlers.missingStaticGlobals,
    inlineJavaScript: snapshot.inlineJavaScript,
    duplicateFunctionDeclarations: snapshot.globals.duplicateFunctionDeclarations,
  }, null, 2));
} else if (mode === 'refresh-markup-contract') {
  if (!fs.existsSync(baselinePath)) throw new Error(`Missing baseline: ${baselinePath}`);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  baseline.inlineHandlers = snapshot.inlineHandlers;
  baseline.domContract = snapshot.domContract;
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log('Baseline markup contract refreshed (script contents excluded).');
} else if (mode === 'verify') {
  if (!fs.existsSync(baselinePath)) throw new Error(`Missing baseline: ${baselinePath}`);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const differences = diffValues(stableContract(baseline), stableContract(snapshot));
  if (differences.length) {
    console.error('Refactor contract changed:');
    differences.forEach(item => console.error(`- ${item}`));
    process.exitCode = 1;
  } else {
    console.log('Refactor contract verified: unchanged.');
  }
  console.log(JSON.stringify({
    scriptOrder: snapshot.scriptOrder,
    appJavaScriptFiles: snapshot.appJavaScriptFiles,
    globals: {
      windowExportCount: snapshot.globals.windowExportCount,
      duplicateFunctionDeclarations: snapshot.globals.duplicateFunctionDeclarations,
    },
    inlineJavaScript: snapshot.inlineJavaScript,
  }, null, 2));
} else {
  console.log(JSON.stringify(snapshot, null, 2));
}
