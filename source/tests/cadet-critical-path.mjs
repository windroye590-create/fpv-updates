// Actual Code.gs against isolated Sheets, including large shared histories.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as C from '../web/core.js';
import {context,api,credential,instructorToken,regressionTest,regressionBody} from './fixtures/server_model.mjs';

const checks=[],measurements={};
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Ізольована перевірка швидкості курсанта'}).group;
let serial=0;
const person=()=>api('POST','/api/register','',{username:'critical-cadet-'+(++serial),fullName:'Курсант перевірки '+serial,groupId:group.id,...credential('synthetic-critical-password')});
const cadet=person(),other=person();
const training=regressionTest('Швидкість тренування',50);
const exam=api('POST','/api/instructor/tests',instructorToken,{title:'Швидкість іспиту',mode:'exam',durationMinutes:30,published:true,questions:training.questions}).test;
const results=context.sheet_('results'),states=context.sheet_('pcState'),details=context.sheet_('resultDetails'),ledger=context.sheet_('sync');
for(let i=0;i<12000;i++){
 const row=Array(27).fill('');Object.assign(row,{0:'synthetic-history-'+i,1:'synthetic-user-'+i%300,2:'Синтетичний запис',4:training.id,6:50,7:25,8:50,13:'{}',16:'graded'});results.appendRow(row);
}
for(let i=0;i<3000;i++){
 const row=['synthetic-user-'+i%300,'training',i,'generation-'+i,0,1,'2026-01-01','request-'+i,'unused','json:null'];
 states.appendRow(row);states.appendRow([...row.slice(0,4),-1,...row.slice(5,9),'']);
}
// A prefix belonging to somebody else must not count as this cadet's result.
const prefix=Array(27).fill('');Object.assign(prefix,{0:'synthetic-prefix',1:String(other.user.id)+'0',4:training.id,13:'{}',16:'graded'});results.appendRow(prefix);
const proto=Object.getPrototypeOf(results.getRange(1,1)),get=proto.getValues,finder=proto.createTextFinder,set=proto.setValues,scan=context.scanPublicSync_;
let active=null,afterSearch=null;
proto.getValues=function(){const value=get.call(this);if(active){active.rangeReads++;active.cells+=this.rowCount*this.columnCount;const sheet=active.sheets[this.sheet.name]??={reads:0,cells:0};sheet.reads++;sheet.cells+=this.rowCount*this.columnCount;}return value;};
proto.createTextFinder=function(text){const search=finder.call(this,text),all=search.findAll,range=this;search.findAll=function(){if(active)active.searches++;const found=all.call(this);afterSearch?.(range,found);return found;};return search;};
proto.setValues=function(value){if(active&&(this.sheet===details||this.sheet===ledger))active.auxiliaryWrites++;return set.call(this,value);};
context.scanPublicSync_=function(...args){if(active)active.reportScans++;return scan.apply(this,args);};
function request(method,path,body={},owner=cadet){const out=JSON.parse(context.doPost({postData:{contents:JSON.stringify(C.payload(method,path,owner.token,body))}}).text);if(!out.ok)throw Object.assign(Error(out.error),{code:out.code});return out;}
function measure(name,run){context.invalidatePublicSync_();active={rangeReads:0,searches:0,cells:0,reportScans:0,auxiliaryWrites:0,sheets:{}};try{const reply=run();measurements[name]=active;assert.equal(active.reportScans,0);assert.equal(active.auxiliaryWrites,0);return reply;}finally{active=null;}}
let start,accepted,examStart,examFinish;
const submissionId='pc-'+crypto.randomUUID(),deviceId='synthetic-critical-device';
try{
 await check('A new cadet starts without downloading the 12000 historical result keys',()=>{
  start=measure('trainingStart',()=>request('POST','/api/tests/'+training.id+'/start',{submissionId}));
  assert.equal(start.test.questions.length,50);assert.ok(start.startPermit);assert.equal(measurements.trainingStart.sheets[results.name],undefined);
  assert.equal(start.publicTableSync,undefined);
 });
 const body={...regressionBody(training,submissionId),startPermit:start.startPermit};
 await check('Training acceptance retains all answers and defers only report publication',()=>{
  accepted=measure('trainingFinish',()=>request('POST','/api/results',body));
  assert.equal(accepted.result.correct,50);assert.equal(accepted.tableSynced,false);
  const stored=context.resultRecordById_(accepted.result.id);assert.equal(Object.keys(JSON.parse(stored.row[13])).length,50);assert.equal(stored.row[26],'pending');
  assert.ok(measurements.trainingFinish.cells<1000);
 });
 await check('A lost training acknowledgement returns the same committed work',()=>{
  const again=request('POST','/api/results',body);assert.equal(again.result.id,accepted.result.id);assert.equal(again.alreadyAccepted,true);
  assert.equal(results.rows.filter(r=>String(r[0])===String(accepted.result.id)).length,1);
 });
 await check('Negative lookup caches expire before another start and ID prefixes do not match',()=>{
  assert.throws(()=>request('POST','/api/tests/'+training.id+'/start',{submissionId:'pc-'+crypto.randomUUID()}),e=>e.code==='ALREADY_COMPLETED');
  const otherStart=request('POST','/api/tests/'+training.id+'/start',{submissionId:'pc-'+crypto.randomUUID()},other);assert.ok(otherStart.startPermit);
  measure('trainingAccountSave',()=>request('POST','/api/account-state/document',{key:'training',expectedRevision:0,requestId:crypto.randomUUID(),value:{test:otherStart.test,submissionId:otherStart.submissionId,startPermit:otherStart.startPermit,answers:{},index:0}},other));
 });
 await check('Exam start finds only its owner and never leaks the private metadata snapshot',()=>{
  examStart=measure('examStart',()=>request('POST','/api/exam-session/start',{testId:exam.id,deviceId,requestId:crypto.randomUUID()}));
  assert.equal(examStart.document.value.test.questions.length,50);assert.equal(examStart.document.value.sourceTest,undefined);
  assert.ok(!JSON.stringify(examStart).includes('synthetic-user-'));assert.ok(!JSON.stringify(examStart).includes('pcStateObserved'));
  assert.equal(measurements.examStart.sheets[states.name],undefined);
 });
 await check('An active exam heartbeat never publishes other work while cadets are taking tests',()=>{
  const heartbeat=measure('examHeartbeat',()=>request('GET','/api/exam-session'));assert.equal(heartbeat.document.value.status,'active');
  assert.equal(context.resultRecordById_(accepted.result.id).row[26],'pending');
 });
 const finishBody={submissionId:examStart.document.value.submissionId,testId:exam.id,deviceId,requestId:crypto.randomUUID(),fence:examStart.document.value.fence,expectedRevision:examStart.document.revision,
  checkpoint:{answers:Object.fromEntries(exam.questions.map(q=>[String(q.id),q.answers[0].id])),index:49,exitCount:0}};
 await check('Exam finish reads its snapshot once and acknowledges both durable commits',()=>{
  examFinish=measure('examFinish',()=>request('POST','/api/exam-session/finish',finishBody));
  assert.equal(examFinish.completion.result.correct,50);assert.equal(examFinish.document.value.status,'completed');assert.equal(examFinish.tableSynced,false);
  assert.equal(measurements.examFinish.sheets[states.name].reads,2);assert.ok(measurements.examFinish.cells<1000);
  const stored=context.resultRecordById_(examFinish.completion.result.id);assert.equal(Object.keys(JSON.parse(stored.row[13])).length,50);
 });
 await check('A lost exam acknowledgement is idempotent with a large shared history',()=>{
  const again=request('POST','/api/exam-session/finish',finishBody);assert.equal(again.completion.result.id,examFinish.completion.result.id);assert.equal(again.document.value.status,'completed');
  assert.equal(results.rows.filter(r=>String(r[0])===String(again.completion.result.id)).length,1);
 });
 await check('Sparse row offsets survive multiple saves and a lost cleanup acknowledgement',()=>{
  const initial=request('POST','/api/exam-session/start',{testId:exam.id,deviceId,requestId:crypto.randomUUID()},other),value=initial.document.value;
  let revision=initial.document.revision;
  const answers=Object.fromEntries(exam.questions.map(q=>[String(q.id),q.answers[0].id]));
  for(let i=0;i<4;i++)revision=request('POST','/api/exam-session/save',{submissionId:value.submissionId,testId:exam.id,deviceId,requestId:crypto.randomUUID(),fence:value.fence,expectedRevision:revision,checkpoint:{answers,index:i,exitCount:0}},other).document.revision;
  const foreignBefore=JSON.stringify(states.rows.filter(row=>String(row[0])!==String(other.user.id))),remove=states.deleteRow;let dropped=false;
  states.deleteRow=function(number){const owned=String(this.rows[number-1]?.[0])===String(other.user.id);const out=remove.call(this,number);if(owned&&!dropped){dropped=true;throw Error('Lost cleanup acknowledgement');}return out;};
  try{
   const done=request('POST','/api/exam-session/finish',{submissionId:value.submissionId,testId:exam.id,deviceId,requestId:crypto.randomUUID(),fence:value.fence,expectedRevision:revision,checkpoint:{answers,index:49,exitCount:0}},other);
   assert.equal(dropped,true);assert.equal(done.document.value.status,'completed');assert.equal(done.completion.result.correct,50);
   const saved=context.examDocument_(context.findUserById_(other.user.id));assert.equal(saved.value.status,'completed');assert.equal(Object.keys(saved.value.answers).length,50);
   assert.equal(states.rows.filter(row=>String(row[0])===String(other.user.id)&&row[1]==='exam-attempt'&&row[4]===-1).length,3);
   assert.equal(JSON.stringify(states.rows.filter(row=>String(row[0])!==String(other.user.id))),foreignBefore);
  }finally{states.deleteRow=remove;}
 });
 await check('A failed write-cache flush cannot acknowledge completion and retries keep one result',()=>{
  for(const failAt of [1,2]){
  const third=person(),started=request('POST','/api/exam-session/start',{testId:exam.id,deviceId,requestId:crypto.randomUUID()},third),v=started.document.value;
  const body={submissionId:v.submissionId,testId:exam.id,deviceId,requestId:crypto.randomUUID(),fence:v.fence,expectedRevision:started.document.revision,checkpoint:{answers:Object.fromEntries(exam.questions.map(q=>[String(q.id),q.answers[0].id])),index:49,exitCount:0}};
  const flush=context.SpreadsheetApp.flush;let attempts=0,failed=false;
  context.SpreadsheetApp.flush=()=>{if(++attempts===failAt){failed=true;throw Error('Injected write-cache failure');}return flush();};
  try{
   assert.throws(()=>request('POST','/api/exam-session/finish',body,third),e=>e.message==='Injected write-cache failure');assert.equal(failed,true);
   assert.equal(results.rows.filter(r=>String(r[1])===String(third.user.id)).length,failAt-1);
   const done=request('POST','/api/exam-session/finish',body,third);assert.equal(done.document.value.status,'completed');assert.equal(done.completion.result.correct,50);
   assert.equal(request('POST','/api/exam-session/finish',body,third).completion.result.id,done.completion.result.id);
   assert.equal(results.rows.filter(r=>String(r[1])===String(third.user.id)).length,1);
  }finally{context.SpreadsheetApp.flush=flush;}
  }
 });
 await check('The public-table observer preserves a previous pending count until polling',async()=>{
  const {createPublicTableSync}=await import('../web/public-table-sync.js');const account={publicTableSync:{protocol:1,state:'pending',pendingCount:4}};
  const sync=createPublicTableSync({session:()=>cadet,account:()=>account,rpc:async()=>{}});sync.observe(examFinish,cadet.token);assert.equal(account.publicTableSync.pendingCount,4);
 });
 await check('A row shifted during a read cannot return another cadet result',()=>{
  const row=Array(27).fill('');Object.assign(row,{0:'synthetic-shift',1:'shift-owner',4:training.id,13:'{}',16:'graded'});results.appendRow(row);
  results.appendRow(['synthetic-after-shift','other-shift-owner','','',training.id]);
  afterSearch=(range,found)=>{if(range.sheet===results&&found.length&&String(results.rows[found[0].row-1][1])==='shift-owner'){afterSearch=null;results.deleteRow(found[0].row);}};
  assert.throws(()=>context.findResultRecord_('shift-owner',training.id),e=>e.code==='BUSY');
 });
}finally{
 proto.getValues=get;proto.createTextFinder=finder;proto.setValues=set;context.scanPublicSync_=scan;
 fs.writeFileSync(new URL('../verification/cadet-critical-path.json',import.meta.url),JSON.stringify({status:checks.length===12?'passed':'failed',passed:checks.length,checks,questionsPerTest:50,historicalResults:12000,otherAccountStateRows:6000,measurements,productionRequests:0,liveGoogleLoadMeasured:false},null,2)+'\n');
}
