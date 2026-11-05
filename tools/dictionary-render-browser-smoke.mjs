import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import WebSocket from 'ws';
const root=path.resolve(import.meta.dirname,'..');
const baseline=process.argv.includes('--baseline'),mode=baseline?'before':'after';
const baselineRef=process.argv.find(argument=>argument.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length)||'b27ecf5a';
const evidenceDir=path.join(root,'reports','dictionary-render-evidence');
const browserPath=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if(!browserPath)throw Error('Chrome/Edge not found');
const sources=new Map();
function read(file){if(!sources.has(file)){let source;try{source=baseline?execFileSync('git',['show',baselineRef+':'+file],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}):fs.readFileSync(path.join(root,file),'utf8')}catch{source=fs.readFileSync(path.join(root,file),'utf8')}sources.set(file,source)}return sources.get(file)}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=http.createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 if(pathname==='/app'){
  let html=read('index.html').replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/g,'').replace(/<script\b[^>]*src="https?:[^"]+"[^>]*>[\s\S]*?<\/script>/g,'');
  const seed='<script>localStorage.setItem("lootlinguaPerformanceMode","turbo");localStorage.setItem("lootlinguaPerformanceModeNoticeSeen","1");window.__feedbackFirestore={writes:[],reject:false,db:{},auth:{currentUser:null},collection:()=>({}),doc:()=>({id:"abcdefghijklmnopqrst"}),setDoc:async function(ref,data){if(this.reject)throw Object.assign(new Error("denied"),{code:"permission-denied"});this.writes.push(data)},serverTimestamp:()=>new Date()};</script>';
  html=html.replace('<head>','<head>'+seed);
  if(!baseline)html=html.replace('</body>','<script type="module" src="/feedback-test.js"></script></body>');
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);return;
 }
 if(pathname==='/feedback-test.js'){
  let source=read('js/feedback.js').replace(/^import\s+[^;]+from\s+['"]https:[^;]+;\s*/gm,'').replace("from './feedback-transport.js","from '/js/feedback-transport.js");
  source='const {db,auth,collection,doc,serverTimestamp}=window.__feedbackFirestore;const getApps=()=>[{}],getFirestore=()=>db,getAuth=()=>auth;const setDoc=(...args)=>window.__feedbackFirestore.setDoc(...args);\n'+source;
  response.writeHead(200,{'Content-Type':'application/javascript'}).end(source);return;
 }
 const relative=pathname.replace(/^\/+/,''),target=path.resolve(root,relative);
 if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){response.writeHead(404).end();return}
 const extension=path.extname(target),types={'.js':'application/javascript','.css':'text/css','.png':'image/png'};
 response.writeHead(200,{'Content-Type':types[extension]||'application/octet-stream'});
 response.end(['.js','.css'].includes(extension)?read(relative.replaceAll('\\','/')):fs.readFileSync(target));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,debugPort=11000+process.pid%3000;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'lootlingua-render-'));
const browser=spawn(browserPath,['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--disable-default-apps','--disable-gpu','--no-sandbox','--remote-allow-origins=*','--remote-debugging-port='+debugPort,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
let socket,nextId=0;const pending=new Map(),exceptions=[];
function send(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},30000);pending.set(id,{resolve(value){clearTimeout(timer);resolve(value)},reject(error){clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value}
async function waitFor(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100)}throw Error('Browser condition timed out: '+expression)}
const report={mode,externalNetwork:'blocked; cloud modules removed; feedback uses in-memory adapter',cases:[]};
try{
 for(let i=0;;i++){try{await fetch('http://127.0.0.1:'+debugPort+'/json/version');break}catch(error){if(i>60)throw error;await delay(100)}}
 const target=await(await fetch('http://127.0.0.1:'+debugPort+'/json/new?about:blank',{method:'PUT'})).json();
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.once('open',resolve));
 socket.on('message',data=>{const message=JSON.parse(String(data));if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);if(message.error)waiter.reject(Error(message.error.message));else waiter.resolve(message.result)}});
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*']});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/app'});await waitFor('typeof render === "function" && typeof getWordMasteryState === "function"');
 report.initial=await evaluate(String.raw`(()=>{
 window.SmartLoadingOverlay.forceHide();document.documentElement.classList.remove('startup-pending');document.getElementById('entryExperienceRoot').hidden=true;document.body.style.overflow='';
 currentView='personal';currentFilter='all';dictionarySortMode='auto';customWorlds=[];
 window.words=Array.from({length:2000},(_,i)=>({id:'audit-'+i,word:'vocabulary-'+String(i).padStart(4,'0'),meaning:i%4===0?'معنى عربي طويل لاختبار اختلاف ارتفاع البطاقات والتفاف السطر '.repeat(4):'معنى الكلمة '+i,example:'A detailed example for this vocabulary item. '.repeat(3),definition:'An English definition.',notes:'ملاحظات توضيحية '.repeat(3),category:'اسم',starred:i%5===0,order:i,expanded:i%31===0,mastery_status:'Learning',mastery_streak:1,xpEconomyVersion:2}));
 writeWordsToStorage(window.words,'normal','guest');writeSharedWordMasteryStore(Object.fromEntries(window.words.map(word=>[getWordMasteryKey(word),{mastery_status:'Learning',mastery_streak:1,xpEconomyVersion:2}])),'guest');
 let parses=0;const original=JSON.parse;JSON.parse=function(...args){parses++;return original.apply(this,args)};window.__parseCount=()=>parses;window.__resetParseCount=()=>{parses=0};window.__lootlinguaPerformanceDebug=true;
 const started=performance.now();renderLimit=20;render();return{renderMs:performance.now()-started,parses,cards:document.querySelectorAll('#list .word-card').length};
 })()`);
 await delay(400);
 for(const width of [1280,390,320]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await evaluate('window.scrollTo(0,0)');await delay(200);const steps=[];
  for(const y of [1500,2200,2800,3500,4100,20000,65000,120000,6000]){
   await evaluate('window.__resetParseCount();window.__oldCards=new Set(document.querySelectorAll("#list .word-card"));window.scrollTo(0,'+y+')');await delay(220);
   steps.push(await evaluate(String.raw`(()=>{const cards=[...document.querySelectorAll('#list .word-card')];const visible=cards.filter(card=>{const r=card.getBoundingClientRect();return r.bottom>120&&r.top<innerHeight-70});return{scrollY,cards:cards.length,visible:visible.length,retained:cards.filter(card=>window.__oldCards.has(card)).length,parses:window.__parseCount(),first:visible[0]?.dataset.id,overflow:document.documentElement.scrollWidth>innerWidth}})()`));
  }
  report.cases.push({width,steps});
  if(!baseline){assert.ok(steps.every(step=>step.visible>0),'Blank visible window at width '+width);assert.ok(steps.every(step=>step.cards<70),'Unbounded cards');assert.ok(steps.every(step=>!step.overflow),'Horizontal overflow');assert.ok(steps.some(step=>step.retained>0),'All cards recreated')}
 }
 if(!baseline){
  report.interactions=await evaluate(String.raw`(async()=>{scrollTo(0,0);render({scrollYOverride:0});await new Promise(r=>setTimeout(r,100));const card=document.querySelector('#list .word-card'),index=Number(card.dataset.index),word=window.words[index];word.expanded=false;card.classList.remove('show-example');const oldY=scrollY;handleLiClick(index,card);await new Promise(r=>setTimeout(r,100));const expansion={sameNode:card===document.querySelector('#list .word-card'),details:!!card.querySelector('.word-card-details'),scrollDelta:Math.abs(scrollY-oldY)};const input=document.getElementById('searchInput');input.value='1999';render();const found=[...document.querySelectorAll('#list .word-card')].map(card=>card.dataset.id);input.value='';render();return{expansion,found}})()`);
  assert.equal(report.interactions.expansion.sameNode,true);assert.equal(report.interactions.expansion.details,true);assert.deepEqual(report.interactions.found,['audit-1999']);
  report.updates=await evaluate(String.raw`(()=>{
    const cards=[...document.querySelectorAll('#list .word-card')];const card=cards[1],neighbor=cards[2],word=window.words.find(item=>String(item.id)===card.dataset.id);
    word.meaning='تعديل لاختبار تحديث بطاقة واحدة';window.invalidateDictionaryRender();renderLimit=20;render();
    const changed=card===document.querySelector('#list .word-card[data-id="'+card.dataset.id+'"]')&&card.querySelector('.meaning-text').textContent==='تعديل لاختبار تحديث بطاقة واحدة';
    const retained=neighbor===document.querySelector('#list .word-card[data-id="'+neighbor.dataset.id+'"]');
    const first=window.words[0];first.expanded=true;
    window.applyCloudWordsFromSnapshot(window.words.map(item=>{const {expanded,...data}=item;return data}));
    return{changed,retained,expandedAfterSnapshot:window.words[0].expanded};
  })()`);
  assert.equal(report.updates.changed,true);assert.equal(report.updates.retained,true);assert.equal(report.updates.expandedAfterSnapshot,true);
  await waitFor('Boolean(window.LootLinguaFeedback)');
  report.feedback=await evaluate(String.raw`(async()=>{const listeners=new Set(),add=document.addEventListener,remove=document.removeEventListener;document.addEventListener=function(type,handler,...args){if(type==='keydown')listeners.add(handler);return add.call(this,type,handler,...args)};document.removeEventListener=function(type,handler,...args){if(type==='keydown')listeners.delete(handler);return remove.call(this,type,handler,...args)};window.LootLinguaFeedback.open();document.querySelector('[data-rating="5"]').click();const form=document.querySelector('#feedbackDialogShell form');form.elements.message.value='Browser test feedback';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,100));const success={writes:window.__feedbackFirestore.writes.length,closed:!document.getElementById('feedbackDialogShell'),schema:window.__feedbackFirestore.writes[0]?.schemaVersion};window.__feedbackFirestore.reject=true;window.LootLinguaFeedback.open();document.querySelector('[data-rating="4"]').click();document.querySelector('#feedbackDialogShell form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,100));const failure={open:!!document.getElementById('feedbackDialogShell'),retry:!document.querySelector('.feedback-submit').disabled,message:document.querySelector('.feedback-status').textContent};document.querySelector('.feedback-dialog-close').click();return{success,failure,remainingKeyListeners:listeners.size}})()`);
  assert.equal(report.feedback.success.writes,1);assert.equal(report.feedback.success.closed,true);assert.equal(report.feedback.success.schema,2);assert.equal(report.feedback.failure.retry,true);assert.equal(report.feedback.remainingKeyListeners,0);
 }
 report.exceptions=exceptions;assert.deepEqual(exceptions,[]);
 fs.mkdirSync(evidenceDir,{recursive:true});const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidenceDir,mode+'-320.png'),Buffer.from(screenshot.data,'base64'));fs.writeFileSync(path.join(evidenceDir,mode+'.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{socket?.close();browser.kill();server.close()}
