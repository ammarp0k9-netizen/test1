const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function feedbackBlock(source) {
 const marker = 'match /feedback/{feedbackId}';
 const start = source.indexOf(marker);
 if (start < 0) return null;
 const open = source.indexOf('{', start + marker.length);
 let depth = 1, end = open + 1;
 while (end < source.length && depth) { if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++; }
 if(depth)throw Error('Unbalanced feedback rules block');
 return {start,end,text:source.slice(start,end)};
}
function patchFeedbackRules(deployed, local) {
 const desired=feedbackBlock(local);if(!desired)throw Error('Local feedback rules missing');
 const existing=feedbackBlock(deployed);
 if(existing)return deployed.slice(0,existing.start)+desired.text+deployed.slice(existing.end);
 const deny=deployed.lastIndexOf('match /{document=**}');if(deny<0)throw Error('Expected deny-all boundary missing; refusing to patch');
 return deployed.slice(0,deny)+desired.text+'\n\n    '+deployed.slice(deny);
}
const hash=source=>crypto.createHash('sha256').update(source).digest('hex');
async function main(){
 const root=path.resolve(__dirname,'..');
 const project=JSON.parse(fs.readFileSync(path.join(root,'.firebaserc'),'utf8')).projects.default;
 const publish=process.argv.includes('--publish');
 if(publish&&project!=='quizapp-ede17')throw Error('Refusing publication outside the explicitly approved project.');
 const auth=require('firebase-tools/lib/auth');
 const rules=require('firebase-tools/lib/gcp/rules');
 const account=auth.getProjectDefaultAccount(root)||auth.getGlobalDefaultAccount();
 if(!account?.tokens?.refresh_token)throw Error('Firebase CLI is not signed in; no remote rules were read or changed.');
 auth.setRefreshToken(account.tokens.refresh_token);
 const releases=await rules.listAllReleases(project);
 const name=await rules.getLatestRulesetName(project,'cloud.firestore',releases);
 if(!name)throw Error('No deployed ruleset found.');
 const files=await rules.getRulesetContent(name);
 if(files.length!==1)throw Error('Multiple rules files; refusing an automatic patch.');
 const deployed=String(files[0].content||''),local=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
 const candidate=patchFeedbackRules(deployed,local);
 const compilation=await rules.testRuleset(project,[{name:'firestore.rules',content:candidate}]);
 const issues=compilation.body?.issues||[];
 if(issues.some(issue=>issue.severity==='ERROR'))throw Error('Feedback candidate did not compile: '+JSON.stringify(issues));
 const directory=path.join(root,'reports','feedback-rules-review');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'deployed-before.rules'),deployed);
 fs.writeFileSync(path.join(directory,'firestore.feedback-only.rules'),candidate);
 fs.writeFileSync(path.join(directory,'firebase.json'),JSON.stringify({firestore:{rules:'firestore.feedback-only.rules'}},null,2));
 const report={projectId:project,sourceRuleset:name,beforeSha256:hash(deployed),candidateSha256:hash(candidate),scope:'Only feedback match is inserted/replaced; every other deployed rule is preserved.',compilation:{passed:true,issues},published:false};
 if(publish&&candidate!==deployed){
  const current=await rules.getLatestRulesetName(project,'cloud.firestore',await rules.listAllReleases(project));
  if(current!==name)throw Error('Production changed during review; refusing publication.');
  const created=await rules.createRuleset(project,[{name:'firestore.rules',content:candidate}]);
  const stillCurrent=await rules.getLatestRulesetName(project,'cloud.firestore',await rules.listAllReleases(project));
  if(stillCurrent!==name)throw Error('Production changed before release; refusing publication.');
  await rules.updateRelease(project,created,'cloud.firestore');
  const released=await rules.getLatestRulesetName(project,'cloud.firestore',await rules.listAllReleases(project));
  const verified=await rules.getRulesetContent(released);
  if(hash(String(verified[0]?.content||''))!==hash(candidate))throw Error('Published rules verification failed.');
  report.published=true;report.deployedRuleset=released;report.verified=true;
 }else if(publish){report.published=true;report.deployedRuleset=name;report.verified=true;report.alreadyCurrent=true;}
 fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
module.exports={feedbackBlock,patchFeedbackRules};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});
