const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const auth = require('firebase-tools/lib/auth');
const rules = require('firebase-tools/lib/gcp/rules');

function normalize(source) {
  return String(source || '').replace(/\s+/g, ' ').trim();
}

function fingerprint(source) {
  return createHash('sha256').update(normalize(source)).digest('hex').slice(0, 16);
}

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const next = source.indexOf('\n    function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

async function main() {
  const projectRoot = process.cwd();
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
  const deployed = String(files?.[0]?.content || '');
  const local = readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');
  const functionNames = ['validEntryExperienceV2', 'validEntryExperienceV2Update'];
  const entryFunctions = Object.fromEntries(functionNames.map((name) => {
    const expected = functionBlock(local, name);
    const actual = functionBlock(deployed, name);
    return [name, {
      deployed: Boolean(actual),
      matchesLocal: Boolean(actual) && normalize(actual) === normalize(expected),
      localFingerprint: fingerprint(expected),
      deployedFingerprint: fingerprint(actual),
    }];
  }));
  const release = releases.find((item) => item.rulesetName === rulesetName);
  const report = {
    projectId,
    releaseCreateTime: String(release?.createTime || ''),
    fullRulesMatchLocal: normalize(deployed) === normalize(local),
    entryMatchAllowsV2: deployed.includes(
      'validEntryExperienceV2Update(resource.data, request.resource.data, versionId)'
    ),
    entryFunctions,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    !report.entryMatchAllowsV2 ||
    Object.values(entryFunctions).some((item) => !item.matchesLocal)
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
