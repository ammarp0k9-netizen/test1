const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const auth = require('firebase-tools/lib/auth');
const rules = require('firebase-tools/lib/gcp/rules');

const PROJECT_ID = 'quizapp-ede17';
const CANDIDATE_RELATIVE = 'rules-candidates/firestore.production-plus-entry-matching-notifications.rules';
const NOTIFICATION_FUNCTIONS = Object.freeze([
  'validNotificationStatus',
  'notificationTerminal',
  'validNotificationCta',
  'validNotification',
  'validNotificationUpdate',
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

function removeBlock(source, declaration) {
  const block = balancedBlock(source, source.indexOf(declaration));
  if (!block) throw new Error(`Candidate block not found: ${declaration}`);
  return source.replace(block, '');
}

function productionBaseFromCandidate(candidate) {
  let base = candidate;
  for (const name of NOTIFICATION_FUNCTIONS) {
    base = removeBlock(base, `function ${name}(`);
  }
  return removeBlock(base, 'match /notifications/{notificationId}');
}

async function currentProduction() {
  const releases = await rules.listAllReleases(PROJECT_ID);
  const rulesetName = await rules.getLatestRulesetName(PROJECT_ID, 'cloud.firestore', releases);
  if (!rulesetName) throw new Error('No deployed Firestore ruleset was found.');
  const files = await rules.getRulesetContent(rulesetName);
  return { rulesetName, source: String(files?.[0]?.content || '') };
}

async function existingCandidateRuleset(candidate) {
  const history = await rules.listAllRulesets(PROJECT_ID);
  for (const item of history.slice(0, 12)) {
    const files = await rules.getRulesetContent(item.name);
    if (normalize(files?.[0]?.content) === normalize(candidate)) return item.name;
  }
  return '';
}

async function main() {
  const projectRoot = process.cwd();
  const account = auth.getProjectDefaultAccount(projectRoot) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not authenticated.');
  auth.setRefreshToken(account.tokens.refresh_token);

  const candidatePath = path.resolve(projectRoot, CANDIDATE_RELATIVE);
  const candidate = readFileSync(candidatePath, 'utf8');
  const before = await currentProduction();
  if (normalize(before.source) === normalize(candidate)) {
    process.stdout.write(`${JSON.stringify({
      projectId: PROJECT_ID,
      skipped: true,
      reason: 'already-deployed',
      rulesetName: before.rulesetName,
      fingerprint: fingerprint(before.source),
    }, null, 2)}\n`);
    return;
  }
  const expectedBase = productionBaseFromCandidate(candidate);
  if (normalize(before.source) !== normalize(expectedBase)) {
    throw new Error('Production changed outside Notifications after candidate verification; refusing direct release.');
  }

  const reusableRulesetName = await existingCandidateRuleset(candidate);
  const createdRulesetName = reusableRulesetName || await rules.createRuleset(PROJECT_ID, [{
      name: CANDIDATE_RELATIVE,
      content: candidate,
    }]);
  await rules.updateRelease(PROJECT_ID, createdRulesetName, 'cloud.firestore');
  const after = await currentProduction();
  if (after.rulesetName !== createdRulesetName || normalize(after.source) !== normalize(candidate)) {
    throw new Error('Post-release Firestore Rules verification did not match the candidate.');
  }
  process.stdout.write(`${JSON.stringify({
    projectId: PROJECT_ID,
    skipped: false,
    previousRulesetName: before.rulesetName,
    previousFingerprint: fingerprint(before.source),
    rulesetName: after.rulesetName,
    fingerprint: fingerprint(after.source),
    reusedRuleset: Boolean(reusableRulesetName),
    deployedOnly: 'firestore.rules',
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
