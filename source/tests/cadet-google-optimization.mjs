// Real server, controller and encrypted-profile code; isolated identities only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as C from '../web/core.js';
import {createExamSession} from '../web/exam-session.js';
import {createSecureStorage} from '../web/secure-storage.js';
import {nativeStorageV2} from './fixtures/native-storage-v2.mjs';
import {context,api,instructorToken,credential,regressionTest} from './fixtures/server_model.mjs';
const checks=[],measurements={};
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Ізольована оптимізація Google'}).group;let sequence=0;
const person=()=>api('POST','/api/register','',{username:'google-optimization-'+(++sequence),fullName:'Курсант перевірки '+sequence,groupId:group.id,...credential('synthetic-google-optimization-password')});
const cadet=person(),test=regressionTest('Перевірка адреси рядка',50),other=regressionTest('Інший рядок');
const tests=context.sheet_('tests'),parts=context.sheet_('testParts'),proto=Object.getPrototypeOf(tests.getRange(1,1)),get=proto.getValues;
const cache=context.CacheService.getScriptCache(),hintKey=id=>'LK_TEST_ROW_V1_'+context.sha256Hex_(String(id));
let active=null;
proto.getValues=function(){const out=get.call(this);if(active){active.reads++;if(this.sheet===tests)active.catalogReads++;if(this.sheet===parts)active.questionPartReads++;}return out;};
function request(method,path,body={},owner=cadet){const reply=JSON.parse(context.doPost({postData:{contents:JSON.stringify(C.payload(method,path,owner.token,body))}}).text);if(!reply.ok)throw Object.assign(Error(reply.error),{code:reply.code});return reply;}
function measure(name,run){active={reads:0,catalogReads:0,questionPartReads:0};try{const value=run();measurements[name]=active;return value;}finally{active=null;}}
const start=(id=test.id,owner=cadet)=>request('POST','/api/tests/'+id+'/start',{submissionId:'pc-'+crypto.randomUUID()},owner);
try{
 await check('A cold row lookup falls back safely; the next start reads the current row once',()=>{
  cache.remove(hintKey(test.id));measure('coldTrainingStart',()=>start());const warm=measure('warmTrainingStart',()=>start());
  assert.equal(measurements.coldTrainingStart.catalogReads,3);assert.equal(measurements.warmTrainingStart.catalogReads,1);assert.equal(warm.test.questions.length,50);
 });
 await check('A warm locator never caches publication, question content or teacher access',()=>{
  const row=tests.rows.find(r=>String(r[0])===String(test.id)),before=row[7],questions=JSON.parse(before);questions[0].text='Актуальне питання після зміни';row[7]=JSON.stringify(questions);
  assert.equal(start().test.questions[0].text,'Актуальне питання після зміни');row[7]=before;
  row[6]=false;try{assert.throws(()=>start(),e=>e.code==='FORBIDDEN');}finally{row[6]=true;}
  const policy=api('GET','/api/instructor/tests/'+test.id+'/access',instructorToken).test.access;
  api('POST','/api/instructor/tests/'+test.id+'/access',instructorToken,{expectedRevision:policy.revision,scope:'all',open:false});
  assert.throws(()=>start(),e=>e.code==='TEST_CLOSED');
  api('POST','/api/instructor/tests/'+test.id+'/access',instructorToken,{expectedRevision:policy.revision+1,scope:'all',open:true});assert.ok(start().startPermit);
 });
 await check('A foreign locator or locator-cache outage cannot select another test or reject a valid start',()=>{
  start();const hint=JSON.parse(cache.get(hintKey(test.id))),otherRow=tests.rows.findIndex(r=>String(r[0])===String(other.id))+1;
  cache.put(hintKey(test.id),JSON.stringify({...hint,row:otherRow}));assert.equal(String(start().test.id),String(test.id));
  const read=cache.get,write=cache.put;
  cache.get=function(key){if(key.startsWith('LK_TEST_ROW_V1_'))throw Error('Synthetic cache outage');return read.call(this,key);};
  cache.put=function(key,...args){if(key.startsWith('LK_TEST_ROW_V1_'))throw Error('Synthetic cache outage');return write.call(this,key,...args);};
  try{assert.equal(String(start().test.id),String(test.id));}finally{cache.get=read;cache.put=write;}
 });
 await check('Replacement ancestry remains correct after a locator is refreshed',()=>{
  const replacement=api('POST','/api/instructor/tests/'+other.id+'/replace',instructorToken,{title:'Нова версія з тією ж історією',mode:'training',published:true,questions:other.questions}).test;
  const one=start(replacement.id),two=start(replacement.id);assert.equal(one.test.canonicalTestId,String(other.id));assert.equal(two.test.canonicalTestId,String(other.id));
 });
 const question={text:'П'.repeat(1000),explanation:'К'.repeat(2000),answers:Array.from({length:6},(_,i)=>({text:'В'.repeat(500),isCorrect:i<2}))};
 const large=api('POST','/api/instructor/tests',instructorToken,{title:'200 довгих питань — ізольована перевірка',mode:'exam',published:true,durationMinutes:30,questions:Array.from({length:200},()=>structuredClone(question))}).test;
 let began;
 await check('A 200-question start verifies and downloads its immutable parts once per request',()=>{
  cache.remove(hintKey(large.id));began=measure('largeExamStart',()=>request('POST','/api/exam-session/start',{testId:large.id,deviceId:'synthetic-google-device',requestId:crypto.randomUUID()}));
  assert.equal(measurements.largeExamStart.questionPartReads,1);assert.equal(began.document.value.test.questions.length,200);
  assert.ok(began.document.value.test.questions.every(q=>!Object.hasOwn(q,'explanation')&&q.answers.every(a=>!Object.hasOwn(a,'isCorrect'))));
  for(const key of ['sourceTest','sourceQuestions','questionOrder','answerOrder'])assert.equal(began.document.value[key],undefined);
 });
 const finish={testId:large.id,deviceId:'synthetic-google-device',requestId:crypto.randomUUID(),submissionId:began.document.value.submissionId,fence:began.document.value.fence,expectedRevision:began.document.revision,
  checkpoint:{answers:Object.fromEntries(large.questions.map(q=>[q.id,q.answers.filter(a=>a.isCorrect).map(a=>a.id)])),index:199,exitCount:0}};
 await check('Verified question reuse expires at the request boundary and corruption still blocks grading',()=>{
  const row=parts.rows.find(r=>String(r[0])===String(large.id)),before=row[4];row[4]='json:corrupted';
  try{assert.throws(()=>request('POST','/api/exam-session/finish',finish),e=>e.code==='TEST_DATA_INCOMPLETE');assert.equal(context.findResultRecord_(cadet.user.id,large.id),null);}finally{row[4]=before;}
 });
 await check('Both finish commits reuse the verified source and retain all 200 two-answer selections',()=>{
  const done=measure('largeExamFinish',()=>request('POST','/api/exam-session/finish',finish));assert.equal(done.completion.result.correct,200);assert.equal(done.document.value.status,'completed');
  assert.equal(measurements.largeExamFinish.questionPartReads,1);assert.equal(Object.keys(JSON.parse(context.resultRecordById_(done.completion.result.id).row[13])).length,200);
  assert.equal(request('POST','/api/exam-session/finish',finish).completion.result.id,done.completion.result.id);
 });
 await check('A private profile stores one full exam and restores its exact question order offline',async()=>{
  const owner=person(),a={run:null},S={version:1,session:owner,accounts:{[owner.user.id]:a},groups:[group]};
  const native=nativeStorageV2({authorize:async(id,token)=>id===String(owner.user.id)&&token===owner.token}),storage=createSecureStorage({local:native.local});
  await storage.load();await storage.unlockOnline(owner,'synthetic-private-password',{localStorageProtocol:2,userId:String(owner.user.id),key:'ab'.repeat(32)});await storage.save(S);
  const beginAt=native.requests.length;
  const controller=createExamSession({session:()=>S.session,account:()=>a,deviceId:()=> 'synthetic-profile-device',rpc:async(m,p,b)=>request(m,p,b,owner),persist:()=>storage.save(S),now:()=>10000});
  await controller.start(large.id);
  const fields=native.profile.accounts[String(owner.user.id)].fields;
  assert.equal(fields.examAvailable,undefined);assert.equal(a.examAvailable,undefined);assert.ok(fields.run.length>500000);assert.equal(a.run.test.questions.length,200);
  const order=a.run.test.questions.map(q=>q.id);await storage.lock();const opened=await storage.unlockOffline({username:owner.user.username,password:'synthetic-private-password',role:'cadet',group:group.name});
  assert.deepEqual(opened.account.run.test.questions.map(q=>q.id),order);
  measurements.privateExamStart={objectWrites:native.requests.slice(beginAt).filter(r=>r.path.startsWith('/vault/objects/')&&r.method==='POST').length,accountJsonCharacters:JSON.stringify(a).length,duplicateFullExamFields:0};
 });
}finally{
 proto.getValues=get;
 fs.writeFileSync(new URL('../verification/cadet-google-optimization.json',import.meta.url),JSON.stringify({status:checks.length===8?'passed':'failed',passed:checks.length,checks,measurements,questions:200,productionRequests:0,liveGoogleLoadMeasured:false},null,2)+'\n');
}
