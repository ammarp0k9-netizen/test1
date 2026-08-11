const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const auth = require('firebase-tools/lib/auth');
const rules = require('firebase-tools/lib/gcp/rules');

const NOTIFICATION_ROOTS = Object.freeze([
  'validNotificationStatus',
  'notificationTerminal',
  'validNotificationCta',
  'validNotification',
  'validNotificationUpdate',
]);
const CURRENT_CONTRACTS = Object.freeze([
  'validEntryExperienceV2',
  'validEntryExperienceV2Update',
  'validQuizEvidenceSession',
]);
const DEFAULT_CANDIDATE = 'rules-candidates/firestore.production-plus-entry-matching-notifications.rules';

function normalize(source) {
  return String(source || '').replace(/\s+/g, ' ').trim();
}

function fingerprint(source) {
  return createHash('sha256').update(normalize(source)).digest('hex').slice(0, 16);
}

function balancedBlock(source, declarationIndex) {
  if (declarationIndex < 0) return '';
  const declarationLineEnd = source.indexOf('\n', declarationIndex);
  const open = source.lastIndexOf(
    '{',
    declarationLineEnd < 0 ? source.length : declarationLineEnd
  );
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      const lineStart = source.lastIndexOf('\n', declarationIndex) + 1;
      return source.slice(lineStart, index + 1);
    }
  }
  return '';
}

function allNamedFunctions(source) {
  const result = new Map();
  const pattern = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    result.set(match[1], {
      block: balancedBlock(source, match.index),
      index: match.index,
    });
  }
  return result;
}

function functionDependencies(block, knownFunctions) {
  const dependencies = new Set();
  for (const match of String(block).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (knownFunctions.has(match[1])) dependencies.add(match[1]);
  }
  return dependencies;
}

function dependencyClosure(functions, roots) {
  const closure = new Set();
  const pending = [...roots];
  while (pending.length) {
    const name = pending.shift();
    if (closure.has(name)) continue;
    const item = functions.get(name);
    if (!item?.block) throw new Error(`Missing local Rules function: ${name}`);
    closure.add(name);
    for (const dependency of functionDependencies(item.block, functions)) {
      if (!closure.has(dependency)) pending.push(dependency);
    }
  }
  return [...closure];
}

function matchDeclarations(source) {
  return [...String(source).matchAll(/\bmatch\s+([^\s{]+(?:\/\{[^}]+\})?)/g)]
    .map((match) => match[1]);
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function insertNotificationFunctions(production, localFunctions, missingNames) {
  const anchor = localFunctions.has('optionalMap') ? 'optionalMap' : 'optionalList';
  const productionFunctions = allNamedFunctions(production);
  const anchorBlock = productionFunctions.get(anchor)?.block || '';
  if (!anchorBlock) throw new Error(`Production ${anchor} insertion anchor was not found.`);
  const insertionIndex = production.indexOf(anchorBlock) + anchorBlock.length;
  const ordered = [...missingNames].sort(
    (left, right) => localFunctions.get(left).index - localFunctions.get(right).index
  );
  const blocks = ordered.map((name) => localFunctions.get(name).block).join('\n\n');
  return {
    source: `${production.slice(0, insertionIndex)}\n\n${blocks}${production.slice(insertionIndex)}`,
    ordered,
  };
}

function insertNotificationMatch(candidate, local) {
  const declaration = 'match /notifications/{notificationId}';
  if (candidate.includes(declaration)) {
    throw new Error('Production already contains Notifications; no additive candidate is needed.');
  }
  const localBlock = balancedBlock(local, local.indexOf(declaration));
  if (!localBlock) throw new Error('Local Notifications match block was not found.');
  const usersIndex = candidate.indexOf('match /users/{uid}');
  const wordsIndex = candidate.indexOf('      match /words/{wordId}', usersIndex);
  if (usersIndex < 0 || wordsIndex < 0) {
    throw new Error('Production user/words insertion anchors were not found.');
  }
  return `${candidate.slice(0, wordsIndex)}${localBlock}\n\n${candidate.slice(wordsIndex)}`;
}

async function fetchProductionRules(projectRoot) {
  const projectConfig = JSON.parse(readFileSync(path.join(projectRoot, '.firebaserc'), 'utf8'));
  const projectId = String(projectConfig?.projects?.default || '');
  if (!projectId) throw new Error('No default Firebase project is configured.');
  const account = auth.getProjectDefaultAccount(projectRoot) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error('Firebase CLI is not authenticated. Run firebase login first.');
  }
  auth.setRefreshToken(account.tokens.refresh_token);
  const releases = await rules.listAllReleases(projectId);
  const rulesetName = await rules.getLatestRulesetName(projectId, 'cloud.firestore', releases);
  if (!rulesetName) throw new Error('No deployed Firestore ruleset was found.');
  const files = await rules.getRulesetContent(rulesetName);
  const source = String(files?.[0]?.content || '');
  const release = releases.find((item) => item.rulesetName === rulesetName);
  return { projectId, rulesetName, releaseCreateTime: release?.createTime || '', source };
}

async function main() {
  const projectRoot = process.cwd();
  const local = readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');
  const production = await fetchProductionRules(projectRoot);
  const localFunctions = allNamedFunctions(local);
  const productionFunctions = allNamedFunctions(production.source);
  const contractParity = Object.fromEntries(CURRENT_CONTRACTS.map((name) => {
    const localBlock = localFunctions.get(name)?.block || '';
    const productionBlock = productionFunctions.get(name)?.block || '';
    return [name, {
      deployed: Boolean(productionBlock),
      matchesLocal: Boolean(productionBlock) && normalize(productionBlock) === normalize(localBlock),
      productionFingerprint: fingerprint(productionBlock),
      localFingerprint: fingerprint(localBlock),
    }];
  }));
  if (Object.values(contractParity).some((item) => !item.matchesLocal)) {
    throw new Error('Production Entry v2 or Matching v2 is not at local parity; refusing to mix unrelated differences.');
  }
  if (!production.source.includes("(data.mode == 'matching' && data.evidenceVersion == 2)")) {
    throw new Error('Production Matching v2 marker was not found.');
  }
  if (production.source.includes('match /notifications/{notificationId}')) {
    throw new Error('Production Notifications match already exists; inspect parity instead of adding it again.');
  }

  const closure = dependencyClosure(localFunctions, NOTIFICATION_ROOTS);
  const changedDependencies = closure.filter((name) => {
    const productionBlock = productionFunctions.get(name)?.block;
    return productionBlock && normalize(productionBlock) !== normalize(localFunctions.get(name).block);
  });
  if (changedDependencies.length) {
    throw new Error(`Notification dependency differs in production: ${changedDependencies.join(', ')}`);
  }
  const missingFunctions = closure.filter((name) => !productionFunctions.has(name));
  const inserted = insertNotificationFunctions(production.source, localFunctions, missingFunctions);
  const candidate = insertNotificationMatch(inserted.source, local);
  const candidateFunctions = allNamedFunctions(candidate);
  const candidateMatches = matchDeclarations(candidate);
  const productionMatches = matchDeclarations(production.source);
  const addedMatchPaths = [...new Set(candidateMatches.filter((item) => !productionMatches.includes(item)))];
  const removedMatchPaths = [...new Set(productionMatches.filter((item) => !candidateMatches.includes(item)))];
  const productionFunctionsPreserved = [...productionFunctions].every(([name, item]) =>
    normalize(candidateFunctions.get(name)?.block) === normalize(item.block)
  );
  const notificationFunctionsMatchLocal = closure.every((name) =>
    normalize(candidateFunctions.get(name)?.block) === normalize(localFunctions.get(name)?.block)
  );
  const localNotificationBlock = balancedBlock(
    local,
    local.indexOf('match /notifications/{notificationId}')
  );
  const candidateNotificationBlock = balancedBlock(
    candidate,
    candidate.indexOf('match /notifications/{notificationId}')
  );
  const onlyNotificationDifference =
    productionFunctionsPreserved &&
    notificationFunctionsMatchLocal &&
    inserted.ordered.length === missingFunctions.length &&
    addedMatchPaths.length === 1 &&
    addedMatchPaths[0] === '/notifications/' &&
    removedMatchPaths.length === 0 &&
    normalize(candidateNotificationBlock) === normalize(localNotificationBlock);
  if (!onlyNotificationDifference) {
    throw new Error(`Candidate contains a difference outside the local Notifications contract: ${JSON.stringify({
      productionFunctionsPreserved,
      notificationFunctionsMatchLocal,
      insertedFunctions: inserted.ordered,
      missingFunctions,
      addedMatchPaths,
      removedMatchPaths,
      notificationMatchMatchesLocal:
        normalize(candidateNotificationBlock) === normalize(localNotificationBlock),
    })}`);
  }

  const candidateRelative = optionValue('--candidate') || DEFAULT_CANDIDATE;
  const candidatePath = path.resolve(projectRoot, candidateRelative);
  if (process.argv.includes('--write-candidate')) {
    writeFileSync(candidatePath, candidate, 'utf8');
  } else if (process.argv.includes('--verify-candidate')) {
    const persisted = readFileSync(candidatePath, 'utf8');
    if (normalize(persisted) !== normalize(candidate)) {
      throw new Error('Persisted Notifications candidate no longer matches production + local Notifications.');
    }
  }
  const productionSnapshotRelative = optionValue('--write-production-snapshot');
  if (productionSnapshotRelative) {
    writeFileSync(path.resolve(projectRoot, productionSnapshotRelative), production.source, 'utf8');
  }

  const report = {
    projectId: production.projectId,
    productionRulesetName: production.rulesetName,
    productionReleaseCreateTime: production.releaseCreateTime,
    productionFingerprint: fingerprint(production.source),
    candidateFingerprint: fingerprint(candidate),
    candidatePath: candidateRelative.replace(/\\/g, '/'),
    contractParity,
    notificationDependencyClosure: closure,
    addedFunctions: inserted.ordered,
    addedMatchPaths,
    removedMatchPaths,
    productionFunctionsPreserved,
    notificationFunctionsMatchLocal,
    onlyNotificationDifference,
    productionLineCount: production.source.split(/\r?\n/).length,
    candidateLineCount: candidate.split(/\r?\n/).length,
    wroteCandidate: process.argv.includes('--write-candidate'),
    verifiedCandidate: process.argv.includes('--verify-candidate'),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
