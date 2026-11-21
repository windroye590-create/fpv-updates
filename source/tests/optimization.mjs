import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRankingCache,buildRanking,searchRanking} from '../web/results.js';
import {createDurableWriter} from '../web/durability.js';
import {compareAttempts} from '../web/result-attempts.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,regressionTest,regressionBody}=await import('./fixtures/server_model.mjs');
const checks=[];async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const tick=()=>new Promise(r=>setImmediate(r));
const source=()=>({tests:[{id:'t',title:'Тест',published:true}],cadets:[{id:'u',role:'cadet',fullName:'Курсант',groupName:'Група'}],results:[{id:'r',userId:'u',testId:'t',groupName:'Група',correct:1,total:2,completedAt:'2026-11-20T00:00:00Z'}]});
await check('Ranking search reuses a model without changing totals, ranks or saved state',()=>{
 const a=source(),read=createRankingCache(),before=JSON.stringify(a),first=read(a,'Група');
 assert.equal(read(a,'Група'),first);assert.deepEqual(first,buildRanking(a,'Група'));assert.equal(searchRanking(first,'Курсант').rows[0].rank,1);assert.equal(JSON.stringify(a),before);
});
await check('New results, same-ID grades and removals invalidate cached ranking values',()=>{
 const a=source(),read=createRankingCache();read(a,'Група');
 a.results=[{...a.results[0],correct:2}];assert.equal(read(a,'Група').rows[0].total,2);
 a.results[0].correct=0;a.resultWriteVersion=1;assert.equal(read(a,'Група').rows[0].total,0);
 a.results=[];assert.equal(read(a,'Група').rows[0].total,null);
});
await check('Roster transfers, replacement tests, revisions and separate accounts cannot reuse stale ranking data',()=>{
 const a=source(),read=createRankingCache();let previous=read(a,'Група');
 a.cadets=[{...a.cadets[0],fullName:'Нове ім’я'}];assert.equal(read(a,'Група').rows[0].name,'Нове ім’я');
 a.tests=[{id:'next',canonicalTestId:'t',title:'Оновлений тест',published:true}];assert.deepEqual(read(a,'Група'),buildRanking(a,'Група'));
 previous=read(a,'Група');a.workspaceRevisions={results:'next'};assert.notEqual(read(a,'Група'),previous);
 const b={...source(),results:[]};assert.equal(read(b,'Група').rows[0].total,null);assert.equal(read(a,'Група').rows[0].total,1);
});
await check('Equal-time attempts retain the original numeric ID tie-breaking rule',()=>{
 for(const [a,b] of [['r2','r10'],['r02','r2'],['abc','абв'],['A','a']]){
  const old=a.localeCompare(b,'en',{numeric:true});assert.equal(Math.sign(compareAttempts({id:a,completedAt:''},{id:b,completedAt:''})),Math.sign(old));
 }
});
await check('The shared report module still starts when Apps Script omits Intl',()=>{
 const code=fs.readFileSync(new URL('../web/result-attempts.js',import.meta.url),'utf8').replace(/^export /gm,'');
 const r=vm.runInNewContext(code+`;latestResults([{id:'r2',userId:'u',testId:'t'},{id:'r10',userId:'u',testId:'t'}])`,{Intl:undefined});assert.equal(r[0].id,'r10');
});
await check('A burst of 24 full saves commits once and acknowledges every caller',async()=>{
 let writes=0;const w=createDurableWriter(async()=>{writes++;});await Promise.all(Array.from({length:24},()=>w.save()));assert.equal(writes,1);assert.equal(w.status().accepted,24);assert.equal(w.status().pending,false);
});
await check('Changes during a disk write need a later acknowledgement and queued saves coalesce',async()=>{
 const release=[];let writes=0;const w=createDurableWriter(()=>{writes++;return new Promise(r=>release.push(r));});
 const first=w.save();await tick();let acknowledged=0;const later=Array.from({length:12},()=>w.save().then(()=>acknowledged++));
 release.shift()();await first;assert.equal(acknowledged,0);assert.equal(w.status().pending,true);await tick();assert.equal(writes,2);release.shift()();await Promise.all(later);assert.equal(acknowledged,12);assert.equal(w.status().pending,false);
});
await check('A failed combined save rejects its callers and stays dirty until a real retry commits',async()=>{
 let fail=true,writes=0;const w=createDurableWriter(async()=>{writes++;if(fail)throw Error('disk full');});
 const results=await Promise.allSettled(Array.from({length:8},()=>w.save()));assert.ok(results.every(r=>r.status==='rejected'));assert.equal(writes,1);assert.equal(w.status().accepted,0);assert.equal(w.status().error,'disk full');assert.equal(w.status().pending,true);
 fail=false;await w.save();assert.equal(writes,2);assert.equal(w.status().accepted,9);assert.equal(w.status().pending,false);assert.equal(w.status().error,'');
});
const user=api('GET','/api/workspace',instructorToken).user;
const query=body=>api('GET','/api/instructor/reviews',instructorToken,{reviewQueueProtocol:2,includeRecoveries:true,...body});
await check('A cold queue skips old graded history and preserves the full-history result ordering',()=>{
 const sheet=context.sheet_('results'),saved=sheet.rows;sheet.rows=[saved[0]];
 try{
  for(let i=0;i<700;i++)sheet.rows.push(['history-'+i,'u','Курсант','Група','t','Тест',80,8,10,60,new Date(1790000000000+i).toISOString(),true,'s','PRIVATE ANSWERS',0,false,i>=695?'pending_review':'graded',8,10,10,i>=695?1:0,0,'',false,'','']);
  const expected=context.listResults_(null).filter(r=>r.gradingStatus==='pending_review'),proto=Object.getPrototypeOf(sheet.getRange(1,1)),original=proto.getValues;let cells=0;
  proto.getValues=function(){if(this.sheet===sheet)cells+=this.rowCount*this.columnCount;return original.call(this);};
  try{assert.equal(JSON.stringify(context.listPendingReviewResults_()),JSON.stringify(expected));assert.ok(cells<1000);for(const row of sheet.rows.slice(1))row[16]='graded';cells=0;assert.equal(context.listPendingReviewResults_().length,0);assert.equal(cells,700);}finally{proto.getValues=original;}
 }finally{sheet.rows=saved;}
});
await check('The optimized review reply includes recoveries while legacy callers keep their full response',()=>{
 const r=query({});assert.equal(r.reviewQueueProtocol,2);assert.equal(r.unchanged,false);assert.ok(Array.isArray(r.results)&&Array.isArray(r.recoveries));
 const old=api('GET','/api/instructor/reviews',instructorToken);assert.ok(Array.isArray(old.results));assert.equal(old.unchanged,undefined);
});
await check('An unchanged review queue reads neither result summaries nor recovery rows',()=>{
 const first=query({}),proto=Object.getPrototypeOf(context.sheet_('results').getRange(1,1)),original=proto.getValues;let largeReads=0;
 proto.getValues=function(){if([context.sheet_('results'),context.sheet_('examRecoveries')].includes(this.sheet))largeReads++;return original.call(this);};
 try{const r=query({knownResultsRevision:first.resultsRevision});assert.equal(r.unchanged,true);assert.equal(r.results,undefined);assert.equal(r.recoveries,undefined);assert.equal(largeReads,0);assert.ok(Array.isArray(r.sessions));}finally{proto.getValues=original;}
});
await check('Official result mutations invalidate the cheap review cursor and return fresh work',()=>{
 const first=query({}),test=regressionTest('Оптимізація: нова робота');
 // The fixture contains an authenticated cadet and permits actual submission.
 const cadet=context.listUsers_().find(u=>u.role==='cadet'&&u.active);assert.ok(cadet);
 api('POST','/api/results',context.issueToken_(cadet),regressionBody(test,'optimization-'+test.id));
 const next=query({knownResultsRevision:first.resultsRevision});assert.equal(next.unchanged,false);assert.notEqual(next.resultsRevision,first.resultsRevision);
});
await check('Saved exam recoveries and their approval invalidate the same queue cursor',()=>{
 const cadet=context.listUsers_().find(u=>u.role==='cadet'&&u.active),first=query({});
 const test=api('POST','/api/instructor/tests',instructorToken,{title:'Оптимізація: відновлення',mode:'exam',durationMinutes:1,published:true,questions:[{text:'Питання',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]}).test;
 const saved=api('POST','/api/exam-recoveries',context.issueToken_(cadet),{testId:test.id,submissionId:'opt-recovery-'+test.id,choiceProtocol:2,answers:[]}).recovery;
 const pending=query({knownResultsRevision:first.resultsRevision});assert.equal(pending.unchanged,false);assert.ok(pending.recoveries.some(r=>r.id===saved.id));
 api('POST','/api/instructor/exam-recoveries/'+saved.id+'/approve',instructorToken,{confirmTimeUnverified:true});
 const approved=query({knownResultsRevision:pending.resultsRevision});assert.equal(approved.unchanged,false);assert.ok(!approved.recoveries.some(r=>r.id===saved.id));
});
await check('Filtered queues never treat a cursor from another filter as a complete answer',()=>{
 const first=query({}),next=query({knownResultsRevision:first.resultsRevision,groupName:'Неіснуюча група'});assert.equal(next.unchanged,false);assert.deepEqual(next.results,[]);
});
await check('Cheap queue checks still validate the active account instead of trusting a cached login',()=>{
 const first=query({}),sheet=context.sheet_('users'),row=sheet.rows.find(r=>String(r[0])===String(user.id));const active=row[7];row[7]=false;
 try{assert.throws(()=>query({knownResultsRevision:first.resultsRevision}),e=>e.code==='SESSION_EXPIRED');}finally{row[7]=active;}
});
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const queueCode=app.slice(app.indexOf('async function loadReviewQueue('),app.indexOf('\nasync function pollReviewPresence('));
function clientQueue(legacy=false){
 const calls=[];let now=Date.now(),hook=null;const a={resultWriteVersion:0};
 const box={S:{session:{token:instructorToken,user}},Date:{now:()=>now},performance:{now:()=>now},setTimeout:()=>{},
  instructor:()=>true,account:()=>a,pendingReviewsPage:()=>true,updateReviewCount:()=>{},render:()=>{},
  reviewQueue:[],examRecoveryQueue:[],reviewQueueToken:'',reviewQueueUpdatedAt:0,reviewQueueFullAt:0,reviewQueueAt:0,reviewQueueRevision:null,reviewQueueFlight:null,reviewQueueError:'',
  rpc:async(m,p,b,t)=>{calls.push({m,p,b});return hook?hook(m,p,b,t):api(m,p,t,legacy&&p==='/api/instructor/reviews'?{}:b);}};
 vm.createContext(box);vm.runInContext(queueCode,box);return {box,calls,advance:n=>{now+=n;},hook:fn=>{hook=fn;}};
}
await check('The real client loads queue and recoveries with one request and reuses unchanged rows',async()=>{
 const c=clientQueue();await c.box.loadReviewQueue();assert.equal(c.calls.length,1);const rows=c.box.reviewQueue;
 await c.box.loadReviewQueue();assert.equal(c.calls.length,2);assert.equal(c.box.reviewQueue,rows);assert.equal(typeof c.calls[1].b.knownResultsRevision,'string');
 await c.box.loadReviewQueue(false,false,true);assert.equal(c.calls[2].b.knownResultsRevision,undefined);assert.notEqual(c.box.reviewQueue,rows);
 c.advance(300001);await c.box.loadReviewQueue();assert.equal(c.calls[3].b.knownResultsRevision,undefined);
});
await check('Older deployed servers keep their two-request queue fallback',async()=>{
 const c=clientQueue(true);await c.box.loadReviewQueue();assert.deepEqual(c.calls.map(r=>r.p),['/api/instructor/reviews','/api/instructor/exam-recoveries']);assert.equal(c.box.reviewQueueError,'');
});
await check('Manual refresh during a conditional request performs one fresh read after it finishes',async()=>{
 const c=clientQueue();await c.box.loadReviewQueue();let release;const gate=new Promise(r=>release=r);
 c.hook(async(m,p,b,t)=>{if(b.knownResultsRevision!==undefined)await gate;return api(m,p,t,b);});
 const old=c.box.loadReviewQueue(),forced=c.box.loadReviewQueue(false,false,true),again=c.box.loadReviewQueue(false,false,true);
 assert.equal(c.calls.length,2);release();await Promise.all([old,forced,again]);assert.equal(c.calls.length,3);assert.equal(c.calls.at(-1).b.knownResultsRevision,undefined);
});
await check('An invalid unchanged reply cannot clear the queue or pretend a cold cache is loaded',async()=>{
 const c=clientQueue();c.hook(()=>({reviewQueueProtocol:2,unchanged:true,sessions:[],serverNow:Date.now(),resultsRevision:'foreign'}));
 await assert.rejects(()=>c.box.loadReviewQueue(),/стан перевірок/);assert.equal(c.box.reviewQueueToken,'');
});
await check('A combined reply after switching accounts never fills the next account queue',async()=>{
 const c=clientQueue();c.hook((m,p,b,t)=>{const r=api(m,p,t,b);c.box.S.session={token:'next',user};return r;});await c.box.loadReviewQueue();assert.equal(c.box.reviewQueueToken,'');assert.equal(c.box.reviewQueue.length,0);
});
fs.writeFileSync(new URL('../verification/optimization.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0},null,2)+'\n');console.log(JSON.stringify({status:'passed',passed:checks.length}));
