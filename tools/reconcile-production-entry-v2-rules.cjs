const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const auth = require('firebase-tools/lib/auth');
const rules = require('firebase-tools/lib/gcp/rules');

const ENTRY_ROOTS = Object.freeze([
  'validEntryExperienceV2',
  'validEntryExperienceV2Update',
]);

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

function namedFunction(source, name) {
  return balancedBlock(source, source.indexOf(`function ${name}(`));
}

function allNamedFunctions(source) {
  const result = new Map();
  const pattern = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    result.set(match[1], balancedBlock(source, match.index));
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
    const block = functions.get(name);
    if (!block) throw new Error(`Missing local Rules function: ${name}`);
    closure.add(name);
    for (const dependency of functionDependencies(block, functions)) {
      if (!closure.has(dependency)) pending.push(dependency);
    }
  }
  return [...closure];
}

function functionDiffs(productionFunctions, localFunctions) {
  const productionNames = new Set(productionFunctions.keys());
  const localNames = new Set(localFunctions.keys());
  return {
    localOnly: [...localNames].filter((name) => !productionNames.has(name)).sort(),
    productionOnly: [...productionNames].filter((name) => !localNames.has(name)).sort(),
    changed: [...localNames].filter((name) => productionNames.has(name) &&
      normalize(localFunctions.get(name)) !== normalize(productionFunctions.get(name))).sort(),
    unchangedCount: [...localNames].filter((name) => productionNames.has(name) &&
      normalize(localFunctions.get(name)) === normalize(productionFunctions.get(name))).length,
  };
}

function matchDeclarations(source) {
  return [...String(source).matchAll(/\bmatch\s+([^\s{]+(?:\/\{[^}]+\})?)/g)]
    .map((match) => match[1]);
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function insertEntryFunctions(production, localFunctions, productionFunctions) {
  const missing = ENTRY_ROOTS.filter((name) => !productionFunctions.has(name));
  if (missing.length !== ENTRY_ROOTS.length) {
    throw new Error('Production contains a partial Entry v2 contract; reconcile it manually.');
  }
  const anchor = namedFunction(production, 'validEntryExperienceUpdate');
  if (!anchor) throw new Error('Production validEntryExperienceUpdate anchor was not found.');
  const anchorIndex = production.indexOf(anchor);
  const insertionIndex = anchorIndex + anchor.length;
  const entryBlocks = ENTRY_ROOTS.map((name) => localFunctions.get(name)).join('\n\n');
  return `${production.slice(0, insertionIndex)}\n\n${entryBlocks}${production.slice(insertionIndex)}`;
}

function patchEntryMatch(source) {
  const declaration = 'match /entryExperiences/{versionId}';
  const block = balancedBlock(source, source.indexOf(declaration));
  if (!block) throw new Error('Production Entry Experience match block was not found.');
  const createNeedle = 'validEntryExperience(request.resource.data, versionId);';
  const updateNeedle = 'validEntryExperienceUpdate(resource.data, request.resource.data, versionId);';
  if (!block.includes(createNeedle) || !block.includes(updateNeedle)) {
    throw new Error('Production Entry Experience match block differs from the expected v1-only contract.');
  }
  const createReplacement = [
    '(',
    '            validEntryExperience(request.resource.data, versionId) ||',
    '            validEntryExperienceV2(request.resource.data, versionId)',
    '          );',
  ].join('\n');
  const updateReplacement = [
    '(',
    '            validEntryExperienceUpdate(resource.data, request.resource.data, versionId) ||',
    '            validEntryExperienceV2Update(resource.data, request.resource.data, versionId)',
    '          );',
  ].join('\n');
  const patchedBlock = block
    .replace(createNeedle, createReplacement)
    .replace(updateNeedle, updateReplacement);
  return source.replace(block, patchedBlock);
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
  if (process.argv.includes('--emit-production-base64')) {
    process.stdout.write(`PRODUCTION_BASE64:${Buffer.from(production.source, 'utf8').toString('base64')}\n`);
    return;
  }
  if (process.argv.includes('--print-production-entry-match')) {
    const declaration = 'match /entryExperiences/{versionId}';
    process.stdout.write(`${balancedBlock(
      production.source,
      production.source.indexOf(declaration)
    )}\n`);
    return;
  }
  const localFunctions = allNamedFunctions(local);
  const productionFunctions = allNamedFunctions(production.source);
  const closure = dependencyClosure(localFunctions, ENTRY_ROOTS);
  const closureReport = Object.fromEntries(closure.map((name) => {
    const localBlock = localFunctions.get(name);
    const productionBlock = productionFunctions.get(name) || '';
    return [name, {
      role: ENTRY_ROOTS.includes(name) ? 'entry-v2' : 'shared-helper',
      productionState: !productionBlock
        ? 'missing'
        : (normalize(productionBlock) === normalize(localBlock) ? 'same' : 'different'),
      localFingerprint: fingerprint(localBlock),
      productionFingerprint: fingerprint(productionBlock),
    }];
  }));
  const changedSharedHelpers = Object.entries(closureReport)
    .filter(([, item]) => item.role === 'shared-helper' && item.productionState !== 'same');
  if (changedSharedHelpers.length) {
    throw new Error(`Shared helper reconciliation requires manual review: ${changedSharedHelpers.map(([name]) => name).join(', ')}`);
  }

  let candidate = insertEntryFunctions(
    production.source,
    localFunctions,
    productionFunctions
  );
  candidate = patchEntryMatch(candidate);
  const candidateFunctions = allNamedFunctions(candidate);
  const productionV1Functions = [
    'validEntryExperienceInterestIds',
    'validEntryExperience',
    'validEntryExperienceUpdate',
  ];
  const preservedProductionEntryV1 = Object.fromEntries(productionV1Functions.map((name) => [
    name,
    normalize(candidateFunctions.get(name)) === normalize(productionFunctions.get(name)),
  ]));
  const productionMatches = matchDeclarations(production.source);
  const localMatches = matchDeclarations(local);
  const candidateMatches = matchDeclarations(candidate);
  const candidateFunctionDiff = functionDiffs(productionFunctions, candidateFunctions);
  const candidateV2MatchesLocal = Object.fromEntries(ENTRY_ROOTS.map((name) => [
    name,
    normalize(candidateFunctions.get(name)) === normalize(localFunctions.get(name)),
  ]));
  const productionFunctionsPreserved = [...productionFunctions.keys()].every((name) =>
    normalize(candidateFunctions.get(name)) === normalize(productionFunctions.get(name))
  );
  const candidateMatchPathsPreserved =
    JSON.stringify(productionMatches) === JSON.stringify(candidateMatches);
  const verifyCandidatePath = optionValue('--verify-candidate');
  let persistedCandidateVerification = null;
  if (verifyCandidatePath) {
    const resolvedCandidatePath = path.resolve(projectRoot, verifyCandidatePath);
    const persistedCandidate = readFileSync(resolvedCandidatePath, 'utf8');
    persistedCandidateVerification = {
      path: path.relative(projectRoot, resolvedCandidatePath).replace(/\\/g, '/'),
      exactGeneratedMatch: persistedCandidate === candidate,
      normalizedGeneratedMatch: normalize(persistedCandidate) === normalize(candidate),
      fingerprint: fingerprint(persistedCandidate),
    };
    if (!persistedCandidateVerification.normalizedGeneratedMatch) {
      throw new Error('Persisted candidate does not match the production + minimal Entry v2 reconciliation.');
    }
  }
  const report = {
    projectId: production.projectId,
    productionReleaseCreateTime: production.releaseCreateTime,
    productionFingerprint: fingerprint(production.source),
    localFingerprint: fingerprint(local),
    candidateFingerprint: fingerprint(candidate),
    fullRulesMatchLocal: normalize(production.source) === normalize(local),
    candidateMatchesLocal: normalize(candidate) === normalize(local),
    dependencyClosure: closureReport,
    preservedProductionEntryV1,
    candidateVerification: {
      persistedCandidate: persistedCandidateVerification,
      candidateV2MatchesLocal,
      productionFunctionsPreserved,
      matchPathsPreserved: candidateMatchPathsPreserved,
      functionDiffFromProduction: candidateFunctionDiff,
      expectedOnlyNewFunctions: candidateFunctionDiff.localOnly.length === ENTRY_ROOTS.length &&
        candidateFunctionDiff.localOnly.every((name) => ENTRY_ROOTS.includes(name)) &&
        candidateFunctionDiff.productionOnly.length === 0 &&
        candidateFunctionDiff.changed.length === 0,
    },
    fullDifferenceInventory: {
      functions: functionDiffs(productionFunctions, localFunctions),
      matchPathsLocalOnly: [...new Set(localMatches.filter((item) => !productionMatches.includes(item)))].sort(),
      matchPathsProductionOnly: [...new Set(productionMatches.filter((item) => !localMatches.includes(item)))].sort(),
      productionLineCount: production.source.split(/\r?\n/).length,
      localLineCount: local.split(/\r?\n/).length,
      candidateLineCount: candidate.split(/\r?\n/).length,
    },
  };

  if (process.argv.includes('--write-temp-bundle')) {
    const directory = mkdtempSync(path.join(tmpdir(), 'lootlingua-entry-v2-rules-'));
    const productionPath = path.join(directory, 'firestore.production.snapshot.rules');
    const candidatePath = path.join(directory, 'firestore.production-plus-entry-v2.rules');
    writeFileSync(productionPath, production.source, 'utf8');
    writeFileSync(candidatePath, candidate, 'utf8');
    process.stdout.write(`${JSON.stringify({
      productionPath,
      productionLength: Buffer.byteLength(production.source, 'utf8'),
      candidatePath,
      candidateLength: Buffer.byteLength(candidate, 'utf8'),
      report,
    })}\n`);
    return;
  }

  if (process.argv.includes('--emit-candidate-base64')) {
    process.stdout.write(`CANDIDATE_BASE64:${Buffer.from(candidate, 'utf8').toString('base64')}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
