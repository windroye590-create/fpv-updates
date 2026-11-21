// Real application handlers, exam controller and Code.gs; isolated data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createExamSession} from '../web/exam-session.js';
import {C,model,install,clone} from './storage-recovery/support.mjs';
const {context,api,instructorToken,credential,regressionTest,regressionBody}=model;
const checks=[];async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
function raw(method,path,token='',body={}){const reply=JSON.parse(context.doPost({postData:{contents:JSON.stringify(C.payload(method,path,token,body))}}).text);if(!reply.ok)throw Object.assign(Error(reply.error),{code:reply.code});return reply;}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Швидкий старт — 50 питань'}).group;
const creds=credential('synthetic-fast-start-password');let sequence=0;
const person=()=>api('POST','/api/register','',{username:'fast-start-'+(++sequence),fullName:'Курсант перевірки '+sequence,groupId:group.id,...creds});
const training=regressionTest('Тренування: 50 питань',50);
const exam=api('POST','/api/instructor/tests',instructorToken,{title:'Іспит: 50 питань',mode:'exam',durationMinutes:30,published:true,questions:training.questions}).test;
function client(p,test,{fast=true}={}){
 const a={tests:[{id:test.id,title:test.title,mode:test.mode,questionCount:test.questions.length,durationMinutes:test.durationMinutes}],fullTests:{},results:[],pending:[],examRecoveries:[],run:null,capabilities:{fastTestStart:fast,multipleChoice:true,testAccess:true}};
 let current=a,dialog=null,hook=null,diskHook=null,clock=100000;const calls=[],saved=[];
 const box={C,crypto,structuredClone,id:C.id,e:C.esc,S:{session:p},account:()=>current,user:()=>box.S.session?.user,
  page:'tests',render:()=>{},persist:async()=>{if(diskHook)await diskHook();saved.push(clone(current));},getClock:async()=>({uptime:clock,launchId:'fast-start-test'}),
  document:{documentElement:{requestFullscreen:()=>Promise.resolve()}},resumeRun:()=>{throw Error('A newly owned exam must not be claimed again');},
  confirmAction:(title,text,accept)=>{dialog={title,text,accept};},
  rpc:async(method,path,body={},token=p.token)=>{calls.push({method,path,body:clone(body)});return hook?hook(method,path,body,token):raw(method,path,token,body);}
 };
 box.refresh=async()=>box.rpc('GET','/api/workspace',{});
 box.examSession=createExamSession({session:()=>box.S.session,account:()=>current,deviceId:()=> 'fast-start-device-'+p.user.id,rpc:box.rpc,persist:box.persist,now:()=>clock,changed:()=>{}});
 install(box,['fetchTest','startFastTest','start']);
 return {a,box,calls,saved,dialog:()=>dialog,hook:f=>hook=f,diskHook:f=>diskHook=f,advance:n=>clock+=n,switch:()=>{box.S.session={token:'next-account',user:{id:'next-account',role:'cadet'}};current={run:null};}};
}
async function begin(pc,test=training){await pc.box.start(test.id);await pc.dialog().accept();return pc.a.run;}
function answer(run,test=training){run.answers=Object.fromEntries(test.questions.map(q=>[String(q.id),q.answers[0].id]));return C.submission(run,101000);}
const props=context.PropertiesService.getScriptProperties(),details=context.sheet_('resultDetails'),ledger=context.sheet_('sync'),results=context.sheet_('results');
const detailsFor=id=>details.rows.slice(1).filter(row=>String(row[0])===String(id));
const ledgerFor=id=>ledger.rows.slice(1).filter(row=>String(row[1])==='result:'+String(id));
function poll(){props.deleteProperty('LK_PUBLIC_SYNC_RETRY_V1');return raw('GET','/api/public-table-sync',instructorToken);}
function flush(){for(let i=0;i<100&&context.scanPublicSync_(true).summary.count;i++)poll();assert.equal(context.scanPublicSync_(true).summary.count,0);}
await check('Cancelling the confirmation does not fetch questions or start a server attempt',async()=>{const pc=client(person(),training);await pc.box.start(training.id);assert.equal(pc.calls.length,0);assert.ok(pc.dialog().text.includes('50'));assert.equal(pc.a.run,null);});
let baselineCalls;
await check('Legacy fallback retains three cloud calls; a cold fast training start uses one',async()=>{
 const old=client(person(),training,{fast:false});await begin(old);baselineCalls=old.calls.length;assert.equal(baselineCalls,3);
 const pc=client(person(),training);await begin(pc);assert.deepEqual(pc.calls.map(c=>c.path),['/api/tests/'+training.id+'/start']);assert.equal(pc.a.run.test.questions.length,50);assert.ok(pc.a.run.startPermit);assert.equal(pc.box.page,'runner');
 assert.ok(pc.a.run.test.questions.every(q=>q.answers.every(a=>!Object.hasOwn(a,'isCorrect'))));
});
await check('A cold 50-question exam starts with one cloud request and no redundant discovery or claim',async()=>{
 const pc=client(person(),exam);await begin(pc,exam);assert.deepEqual(pc.calls.map(c=>c.path),['/api/exam-session/start']);assert.equal(pc.a.run.test.questions.length,50);assert.equal(pc.box.page,'runner');assert.equal(pc.box.examSession.owned(pc.a.run),true);
});
await check('A stale open catalog cannot bypass a teacher closing the test',async()=>{
 const t=regressionTest('Закриття перед підтвердженням'),p=person(),pc=client(p,t);await pc.box.start(t.id);
 const policy=api('GET','/api/instructor/tests/'+t.id+'/access',instructorToken).test.access;
 api('POST','/api/instructor/tests/'+t.id+'/access',instructorToken,{expectedRevision:policy.revision,scope:'all',open:false});
 await assert.rejects(()=>pc.dialog().accept(),e=>e.code==='TEST_CLOSED');assert.equal(pc.a.run,null);
});
await check('A stale empty result cache cannot bypass a completed attempt on another PC',async()=>{
 const p=person(),pc=client(p,training);await pc.box.start(training.id);api('POST','/api/results',p.token,regressionBody(training,'already-on-another-pc'));
 await assert.rejects(()=>pc.dialog().accept(),e=>e.code==='ALREADY_COMPLETED');assert.equal(pc.a.run,null);
});
await check('Account changes during the request or local save cannot open another cadet runner',async()=>{
 for(const during of ['request','disk']){const p=person(),pc=client(p,training);if(during==='request')pc.hook((m,path,b,t)=>{const r=raw(m,path,t,b);pc.switch();return r;});else pc.diskHook(async()=>pc.switch());await begin(pc);assert.equal(pc.box.page,'tests');assert.equal(pc.box.account().run,null);}
});
await check('Repeated confirmation joins one pending start request',async()=>{
 const p=person(),pc=client(p,training);let release;const gate=new Promise(r=>release=r);pc.hook(async(m,path,b,t)=>{await gate;return raw(m,path,t,b);});await pc.box.start(training.id);
 const one=pc.dialog().accept(),two=pc.dialog().accept();assert.equal(one,two);release();await one;assert.equal(pc.calls.length,1);
});
await check('A malformed start reply or failed disk save cannot display a started test',async()=>{
 const bad=client(person(),training);bad.hook(()=>({test:{id:'foreign'},submissionId:'wrong',startPermit:'wrong'}));await bad.box.start(training.id);await assert.rejects(()=>bad.dialog().accept());assert.equal(bad.a.run,null);
 const disk=client(person(),training);disk.diskHook(async()=>{throw Error('Disk unavailable');});await disk.box.start(training.id);await assert.rejects(()=>disk.dialog().accept());assert.equal(disk.box.page,'tests');assert.ok(disk.a.run.startPermit);
});
const people=Array.from({length:20},person),accepted=[],bodies=[];flush();
let critical=false,criticalAuxWrites=0,ledgerDrop=false,detailsDrop=false,targetId='';
const appendLedger=ledger.appendRow,rangeProto=Object.getPrototypeOf(details.getRange(1,1)),setValues=rangeProto.setValues;
ledger.appendRow=function(row){if(critical){criticalAuxWrites++;throw Error('Ledger write on the acceptance path');}const r=appendLedger.call(this,row);if(ledgerDrop&&String(row[1])==='result:'+targetId){ledgerDrop=false;throw Error('Lost ledger acknowledgement after commit');}return r;};
rangeProto.setValues=function(rows){if(this.sheet===details){if(critical){criticalAuxWrites++;throw Error('Detail write on the acceptance path');}const r=setValues.call(this,rows);if(detailsDrop&&rows.some(r=>String(r[0])===targetId)){detailsDrop=false;throw Error('Lost detail acknowledgement after commit');}return r;}return setValues.call(this,rows);};
try{
 await check('Twenty 50-question starts and finishes acknowledge without auxiliary sheet writes',async()=>{
  for(const p of people){const pc=client(p,training);critical=true;try{await begin(pc);const body=answer(pc.a.run);bodies.push(clone(body));accepted.push(raw('POST','/api/results',p.token,body).result);const again=raw('POST','/api/results',p.token,body);assert.equal(again.result.id,accepted.at(-1).id);assert.equal(again.alreadyAccepted,true);}finally{critical=false;}}
  assert.equal(criticalAuxWrites,0);for(const r of accepted){assert.equal(detailsFor(r.id).length,0);assert.equal(ledgerFor(r.id).length,0);const record=context.resultRecordById_(r.id);assert.equal(Object.keys(JSON.parse(record.row[13])).length,50);assert.equal(record.row[26],'pending');assert.equal(r.correct,50);}
 });
 await check('Lost ledger and detail acknowledgements retain the pending job and rebuild each record once',()=>{
  targetId=String(accepted[0].id);ledgerDrop=true;detailsDrop=true;poll();assert.equal(ledgerFor(targetId).length,1);assert.equal(context.resultRecordById_(targetId).row[26],'pending');
  poll();assert.equal(detailsFor(targetId).length,50);assert.equal(context.resultRecordById_(targetId).row[26],'pending');poll();
  assert.equal(ledgerFor(targetId).length,1);assert.equal(detailsFor(targetId).length,50);assert.equal(context.resultRecordById_(targetId).row[26],'');
 });
 await check('Background polling completes all 1000 question details without duplicate official results',()=>{
  flush();for(let i=0;i<people.length;i++){const r=accepted[i];assert.equal(detailsFor(r.id).length,50);assert.equal(new Set(detailsFor(r.id).map(r=>String(r[4]))).size,50);assert.ok(detailsFor(r.id).every(row=>row[6]===true));assert.equal(ledgerFor(r.id).length,1);assert.equal(context.listResults_(people[i].user.id).length,1);assert.deepEqual(JSON.parse(JSON.stringify(bodies[i])),bodies[i]);}
 });
 await check('A partially committed statistics batch is completed without changing another cadet',async()=>{
  const p=person(),pc=client(p,training);await begin(pc);const r=raw('POST','/api/results',p.token,answer(pc.a.run)).result;let partial=true;
  const active=rangeProto.setValues;rangeProto.setValues=function(rows){if(partial&&this.sheet===details&&rows.some(row=>String(row[0])===String(r.id))){partial=false;const short=details.getRange(this.row,this.column,7,this.columnCount);setValues.call(short,rows.slice(0,7));throw Error('Partial write');}return active.call(this,rows);};
  try{poll();assert.equal(detailsFor(r.id).length,7);poll();assert.equal(detailsFor(r.id).length,50);assert.equal(ledgerFor(r.id).length,1);assert.equal(detailsFor(accepted[1].id).length,50);}finally{rangeProto.setValues=active;}
 });
 await check('Retries remove duplicate derived rows and repair a wrong count from the immutable answers',()=>{
  const r=accepted[0],record=context.resultRecordById_(r.id),before=JSON.stringify(context.resultRecordById_(accepted[1].id).row);
  const index=details.rows.findIndex(row=>String(row[0])===String(r.id));details.rows[index][6]=false;details.appendRow([...details.rows[index]]);details.appendRow([...details.rows[index].slice(0,4),'foreign-question',...details.rows[index].slice(5)]);
  results.getRange(record.rowNumber,27).setValue('pending');context.invalidatePublicSync_();poll();assert.equal(detailsFor(r.id).length,50);assert.ok(detailsFor(r.id).every(row=>row[6]===true));assert.equal(JSON.stringify(context.resultRecordById_(accepted[1].id).row),before);
 });
 await check('Manual table synchronization completes pending statistics before clearing publication flags',async()=>{
  const p=person(),pc=client(p,training);await begin(pc);const r=raw('POST','/api/results',p.token,answer(pc.a.run)).result;assert.equal(detailsFor(r.id).length,0);
  api('POST','/api/instructor/results-sheet/sync',instructorToken);assert.equal(detailsFor(r.id).length,50);assert.equal(context.resultRecordById_(r.id).row[26],'');
 });
 await check('Deleting a result before its background job cannot resurrect its result or details',async()=>{
  const p=person(),pc=client(p,training);await begin(pc);const body=answer(pc.a.run),r=raw('POST','/api/results',p.token,body).result;
  raw('DELETE','/api/instructor/results/'+r.id,instructorToken,{confirmResultId:String(r.id)});flush();assert.equal(context.resultRecordById_(r.id),null);assert.equal(detailsFor(r.id).length,0);assert.throws(()=>raw('POST','/api/results',p.token,body),e=>e.code==='RESULT_DELETED');
 });
 await check('Historical work without an answer snapshot keeps its original auxiliary data',()=>{
  const p=person(),r=api('POST','/api/results',p.token,regressionBody(training,'legacy-statistics-snapshot')).result,record=context.resultRecordById_(r.id),before=JSON.stringify(detailsFor(r.id));results.getRange(record.rowNumber,14).setValue('');results.getRange(record.rowNumber,27).setValue('pending');context.invalidatePublicSync_();poll();assert.equal(JSON.stringify(detailsFor(r.id)),before);
 });
 await check('Mixed written and two-answer work retains its text and derives only choice statistics',async()=>{
  const t=api('POST','/api/instructor/tests',instructorToken,{title:'Змішаний швидкий результат',mode:'training',published:true,questions:[{text:'Оберіть обидві відповіді',answers:[{text:'А',isCorrect:true},{text:'Б',isCorrect:true}]},{type:'written',text:'Поясніть',maxPoints:3,answers:[]}]}).test;
  const p=person(),pc=client(p,t);await begin(pc,t);pc.a.run.answers={[String(t.questions[0].id)]:t.questions[0].answers.map(a=>String(a.id)),[String(t.questions[1].id)]:'Письмова відповідь без змін'};
  const r=raw('POST','/api/results',p.token,C.submission(pc.a.run,101000)).result;assert.equal(r.gradingStatus,'pending_review');assert.equal(detailsFor(r.id).length,0);poll();assert.equal(detailsFor(r.id).length,1);assert.equal(detailsFor(r.id)[0][6],true);assert.equal(JSON.parse(context.resultRecordById_(r.id).row[13])[String(t.questions[1].id)],'Письмова відповідь без змін');
 });
 await check('Replacing a test before the worker runs preserves the original question IDs and grading key',async()=>{
  const t=regressionTest('Початковий ключ для фонового запису',2),p=person(),pc=client(p,t);await begin(pc,t);const r=raw('POST','/api/results',p.token,answer(pc.a.run,t)).result;
  api('POST','/api/instructor/tests/'+t.id+'/replace',instructorToken,{title:'Змінений ключ',mode:'training',published:true,questions:[{text:'Нове питання',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]});flush();assert.equal(detailsFor(r.id).length,2);assert.deepEqual(detailsFor(r.id).map(row=>String(row[4])).sort(),t.questions.map(q=>String(q.id)).sort());assert.ok(detailsFor(r.id).every(row=>row[6]===true));
 });
 await check('An unauthenticated poll cannot start the statistics worker',async()=>{
  const p=person(),pc=client(p,training);await begin(pc);const r=raw('POST','/api/results',p.token,answer(pc.a.run)).result;
  assert.throws(()=>raw('GET','/api/public-table-sync'),e=>e.code==='SESSION_EXPIRED');assert.equal(detailsFor(r.id).length,0);flush();assert.equal(detailsFor(r.id).length,50);
 });
}finally{ledger.appendRow=appendLedger;rangeProto.setValues=setValues;}
fs.writeFileSync(new URL('../verification/start-finish-performance.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,questionsPerTest:50,cadets:20,legacyTrainingStartCloudRequests:baselineCalls,fastTrainingStartCloudRequests:1,fastExamStartCloudRequests:1,criticalAuxiliaryWrites:criticalAuxWrites,backgroundQuestionDetails:1000,liveGoogleLoadMeasured:false,productionRequests:0},null,2)+'\n');
