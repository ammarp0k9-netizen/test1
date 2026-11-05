import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createFeedbackWriter } from '../js/feedback-transport.js';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('variable-height window finds the correct rows after expansion and far jumps',()=>{
 const root={};vm.runInNewContext(read('js/dictionary-window.js'),{window:root});
 const heights=root.LootLinguaDictionaryWindow.createHeightIndex(2000,100);
 heights.measure(0,400);heights.measure(8,260);heights.measure(1000,350);
 assert.equal(heights.offset(1),400);assert.equal(heights.offset(9),1360);
 assert.equal(heights.indexAt(399),0);assert.equal(heights.indexAt(400),1);
 const position=heights.offset(1500)+23,range=heights.range(position,900,12);
 assert.ok(range.start<=1500&&range.end>1508);assert.ok(range.end-range.start<50);
 assert.equal(heights.measure(0,400),false);assert.equal(heights.measure(0,NaN),false);
 heights.measure(0,100);assert.equal(heights.offset(1),100);
});

test('highlighting preserves text and never interprets imported markup as HTML',()=>{
 const source=read('js/dictionary-render.js');const context={escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')};
 vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf('let dictionaryRenderRevision')),context);
 assert.equal(context.highlightText('<b>word</b>','word'),'&lt;b&gt;<span class="highlight">word</span>&lt;/b&gt;');
 assert.equal(context.highlightText('<b>word</b>',''),'&lt;b&gt;word&lt;/b&gt;');
 assert.equal(context.highlightText('Sword sword','sword'),'<span class="highlight">Sword</span> <span class="highlight">sword</span>');
});

function masteryHarness(){
 const root={auth:{currentUser:{uid:'a'}},addEventListener(){}};let reads=0,wordReads=0;
 let entries={},copies=Array.from({length:2000},(_,i)=>({word:'term'+i,mastery_status:'Learning',mastery_streak:1,xpEconomyVersion:2}));
 const context=vm.createContext({window:root,XP_ECONOMY_VERSION:2,customWorlds:[],getStorageUserId:()=>root.auth.currentUser?.uid||'guest',normalizeWord:value=>String(value).toLowerCase().trim(),loadJSON:()=>{reads++;return structuredClone(entries)},readWordsFromStorage:()=>{wordReads++;return copies},localStorage:{setItem(){}},hasSignedInUser:()=>true});
 vm.runInContext(read('js/srs.js'),context);
 return{root,context,counts:()=>({reads,wordReads}),setEntries:value=>{entries=value}};
}

test('2000 mastery lookups share one store and one fallback index per synchronous pass',()=>{
 const h=masteryHarness();h.root.withWordMasterySnapshot(()=>{for(let i=0;i<2000;i++)assert.equal(h.context.getWordMasteryState({word:'term'+i}).mastery_status,'Learning')});
 assert.deepEqual(h.counts(),{reads:1,wordReads:1});
 h.setEntries({term0:{mastery_status:'Mastered',mastery_streak:3,xpEconomyVersion:2}});
 h.root.withWordMasterySnapshot(()=>assert.equal(h.context.getWordMasteryState({word:'term0'}).mastery_status,'Mastered'));
 assert.equal(h.counts().reads,2);
});

test('mastery snapshot is released after exceptions and cannot cross account identities',()=>{
 const h=masteryHarness();assert.throws(()=>h.root.withWordMasterySnapshot(()=>{throw Error('render failed')}));
 h.root.auth.currentUser={uid:'b'};
 h.root.withWordMasterySnapshot(()=>h.context.getWordMasteryState({word:'term0'}));
 assert.equal(h.counts().reads,2);
 h.context.getWordMasteryState({word:'term0'});assert.equal(h.counts().reads,3);
});

function feedbackHarness(){const writes=[];const auth={currentUser:null};const writer=createFeedbackWriter({db:{},auth,collection:(_db,name)=>{assert.equal(name,'feedback');return{}},doc:()=>({id:'abcdefghijklmnopqrst'}),setDoc:async(ref,payload)=>writes.push({ref,payload}),serverTimestamp:()=> 'server-time'});return{writes,auth,writer}}

test('guest feedback writes only the small v2 public payload without a Function',async()=>{
 const h=feedbackHarness();const result=await h.writer({rating:5,message:' جميل ',optionalName:' زائر ',metadata:{admin:true}},'guest');
 assert.equal(result.accepted,true);assert.equal(h.writes.length,1);
 assert.deepEqual(h.writes[0].payload,{schemaVersion:2,rating:5,message:'جميل',optionalName:'زائر',ownerId:'guest',submittedAt:'server-time'});
});

test('account feedback derives its owner from auth and rejects a stale dialog',async()=>{
 const h=feedbackHarness();h.auth.currentUser={uid:'member-a'};await h.writer({rating:4,ownerId:'forged',optionalName:'forged'},'member-a');
 assert.equal(h.writes[0].payload.ownerId,'member-a');assert.equal(h.writes[0].payload.optionalName,'');
 h.auth.currentUser={uid:'member-b'};await assert.rejects(h.writer({rating:4},'member-a'),{code:'feedback/auth-changed'});assert.equal(h.writes.length,1);
});

test('invalid feedback does not write and a rejected database write cannot report success',async()=>{
 const h=feedbackHarness();for(const input of [{rating:0},{rating:6},{rating:1.5},{rating:4,message:'x'.repeat(1601)}])await assert.rejects(h.writer(input),{code:'feedback/invalid-input'});
 assert.equal(h.writes.length,0);
 const writer=createFeedbackWriter({db:{},auth:h.auth,collection:()=>({}),doc:()=>({id:'id'}),setDoc:async()=>{throw Object.assign(Error('denied'),{code:'permission-denied'})},serverTimestamp:()=>0});
 await assert.rejects(writer({rating:5}),{code:'permission-denied'});
});

test('current and production-candidate feedback rules use the same narrow create-only contract',()=>{
 const sources=[read('firestore.rules'),read('rules-candidates/firestore.production-plus-entry-matching-notifications.rules')];
 const block=source=>source.slice(source.indexOf('    match /feedback/{feedbackId}'),source.indexOf('\n    }',source.indexOf('    match /feedback/{feedbackId}'))+6).replace(/\s+/g,' ');
 assert.equal(block(sources[0]),block(sources[1]));
 assert.match(block(sources[0]),/allow update, delete: if false/);assert.match(block(sources[0]),/data.submittedAt == request.time/);assert.match(block(sources[0]),/allow read: if isAdmin\(\)/);
});
