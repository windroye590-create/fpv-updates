// Real client/server code, synthetic users and Sheets doubles; no live load.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
import {createExamSession} from '../web/exam-session.js';
import {createAccountSync} from '../web/account-sync.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken,lock,regressionTest,regressionBody,publicRows}=await import('./fixtures/server_model.mjs');
const checks=[];
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
function raw(method,path,token='',body={}){
 const r=JSON.parse(context.doPost({postData:{contents:JSON.stringify(C.payload(method,path,token,body))}}).text);
 if(!r.ok)throw Object.assign(Error(r.error),{code:r.code});return r;
}
function withBusy(run){const take=lock.tryLock;lock.tryLock=()=>false;try{return run();}finally{lock.tryLock=take;}}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Клас — 20 одночасно'}).group;
const password='classroom-synthetic-password',derived=credential(password);
const people=Array.from({length:20},(_,i)=>api('POST','/api/register','',{username:'classroom_'+i,fullName:'Курсант класу '+i,groupId:group.id,...derived}));
await check('Twenty real sign-in clients recover from five consecutive busy/429 replies with bounded jitter',async()=>{
 const delays=[];
 const replies=await Promise.all(people.map(async(person,i)=>{
  let tries=0;
  const reply=await C.signIn(person.user.username,password,group.name,async(path,body)=>{
   if(path==='/api/login'&&++tries<=5){
    if(i%2&&tries===2)throw Object.assign(Error('quota'),{code:'HTTP_429'});
    return withBusy(()=>raw('POST',path,'',body));
   }
   return raw('POST',path,'',body);
  },async ms=>{delays.push(ms);},()=>i/20);
  assert.equal(tries,6);assert.equal(reply.user.id,person.user.id);return reply;
 }));
 assert.equal(replies.length,20);assert.equal(delays.length,100);
 assert.ok(delays.every(ms=>ms>=750&&ms<=10000));assert.ok(new Set(delays).size>20);
});
await check('Invalid credentials and account throttling fail immediately; persistent BUSY has a finite retry budget',async()=>{
 for(const code of ['INVALID_CREDENTIALS','LOGIN_THROTTLED','USER_DISABLED']){
  let calls=0;await assert.rejects(()=>C.signIn('name','password','',async()=>{calls++;throw Object.assign(Error(code),{code});},async()=>{}),x=>x.code===code);assert.equal(calls,1);
 }
 let attempts=0,pauses=0;
 await assert.rejects(()=>C.signIn('name','password','',async()=>{attempts++;throw Object.assign(Error('busy'),{code:'BUSY'});},async()=>{pauses++;}),x=>x.code==='BUSY');
 assert.equal(attempts,7);assert.equal(pauses,6);
});
const training=regressionTest('Клас: приймання без публічної таблиці',2);
await check('Twenty test starts retry only capacity errors and keep the original request envelope',async()=>{
 await Promise.all(people.map(async(person,i)=>{
  let attempts=0;const body={submissionId:'pc-'+crypto.randomUUID()},before=JSON.stringify(body);
  const reply=await C.requestCapacity(async()=>{
   const response=()=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(C.payload('POST','/api/tests/'+training.id+'/start',person.token,body))}}).text);
   return ++attempts<5?withBusy(response):response();
  },async()=>{},()=>i/20);
  assert.equal(attempts,5);assert.equal(reply.ok,true);assert.equal(reply.submissionId,body.submissionId);assert.equal(JSON.stringify(body),before);
 }));
 let attempts=0;await C.requestCapacity(async()=>{attempts++;return {ok:false,code:'INVALID_CREDENTIALS'};});assert.equal(attempts,1);
});
const exam=api('POST','/api/instructor/tests',instructorToken,{title:'Клас: письмовий іспит',mode:'exam',durationMinutes:20,published:true,questions:[{type:'written',text:'Поясніть відповідь',maxPoints:3,answers:[]}]}).test;
const publish=context.publishVisibleResult_;let publicAttempts=0;
context.publishVisibleResult_=()=>{publicAttempts++;throw Error('Public report must not run in the submission lock');};
const bodies=people.map((_,i)=>regressionBody(training,'classroom-training-'+i));
await check('Twenty submissions keep exact answers after BUSY and lost acknowledgements without publishing report copies',async()=>{
 await Promise.all(people.map(async(person,i)=>{
  const before=JSON.stringify(bodies[i]);
  assert.throws(()=>withBusy(()=>raw('POST','/api/results',person.token,bodies[i])),x=>x.code==='BUSY');
  const accepted=raw('POST','/api/results',person.token,bodies[i]);
  // The acknowledgement may be lost after the authoritative row committed.
  const replay=raw('POST','/api/results',person.token,bodies[i]);
  assert.equal(replay.result.id,accepted.result.id);assert.equal(replay.alreadyAccepted,true);
  assert.equal(replay.tableSynced,false);assert.equal(replay.publicTableSync.state,'pending');
  assert.equal(JSON.stringify(bodies[i]),before);
  assert.equal(context.listResults_(person.user.id).filter(r=>r.testId===training.id).length,1);
 }));
 assert.equal(publicAttempts,0);
});
function computer(person){
 const a={run:null},device=crypto.randomUUID(),saved=[],completed=[];let ticks=10000,blocked=false;
 const controller=createExamSession({session:()=>person,account:()=>a,deviceId:()=>device,now:()=>ticks,random:()=>0,
  rpc:async(m,p,b,t)=>blocked?withBusy(()=>raw(m,p,t,b)):raw(m,p,t,b),persist:async()=>{saved.push(structuredClone(a));},completed:async reply=>{completed.push(reply);}});
 return {a,controller,saved,completed,advance:ms=>ticks+=ms,block:v=>blocked=v};
}
const computers=people.map(computer);
await check('Twenty BUSY exam finishes retain locally persisted answers and request IDs, then finish automatically exactly once',async()=>{
 await Promise.all(computers.map(async(pc,i)=>{
  await pc.controller.start(exam.id);pc.a.run.answers[exam.questions[0].id]='Власна відповідь '+i;
  pc.block(true);await assert.rejects(()=>pc.controller.finish(),x=>x.code==='BUSY');
  assert.equal(pc.a.run.finishRequested,true);
  assert.equal(pc.saved.at(-1).examRequest.checkpoint.answers[exam.questions[0].id],'Власна відповідь '+i);
  const requestId=pc.a.examRequest.requestId;pc.block(false);await pc.controller.background();
  assert.equal(pc.a.run,null);assert.equal(pc.completed.length,1);
  assert.equal(pc.completed[0].review[0].text,'Власна відповідь '+i);
  const result=context.listResults_(people[i].user.id).filter(r=>r.testId===exam.id);
  assert.equal(result.length,1);assert.ok(requestId);
 }));
 assert.equal(publicAttempts,0);
});
context.publishVisibleResult_=publish;
await check('Background exam polls coalesce and idle clients do not poll on every local timer tick',async()=>{
 let ticks=0,calls=0,release;
 const gate=new Promise(done=>release=done),pc=people[0];
 const controller=createExamSession({session:()=>pc,account:()=>({run:null}),deviceId:()=>crypto.randomUUID(),now:()=>ticks,random:()=>0,persist:async()=>{},rpc:async(m,p,b,t)=>{calls++;await gate;return raw(m,p,t,b);}});
 const batch=Array.from({length:30},()=>controller.background());await Promise.resolve();release();await Promise.all(batch);assert.equal(calls,1);
 ticks=59000;await controller.background();assert.equal(calls,1);ticks=60000;await controller.background();assert.equal(calls,2);
});
await check('Near-deadline changes bypass the idle autosave interval',async()=>{
 const pc=computer(people[0]),t=api('POST','/api/instructor/tests',instructorToken,{title:'Перед завершенням часу',mode:'exam',durationMinutes:1,published:true,questions:[{type:'written',text:'Відповідь перед завершенням',maxPoints:1,answers:[]}]}).test;
 await pc.controller.start(t.id);await pc.controller.background();pc.advance(40000);
 pc.a.run.answers[t.questions[0].id]='Остання відповідь';await pc.controller.background();
 pc.a.run.answers[t.questions[0].id]='Остання уточнена відповідь';await pc.controller.background();
 assert.equal(context.examDocument_(people[0].user).value.answers[t.questions[0].id],'Остання уточнена відповідь');
});
await check('Account polling yields to a user action, preserves dirty local data, and still permits an explicit sync',async()=>{
 let allowed=false,calls=0;const a={},s=people[1];
 const sync=createAccountSync({session:()=>s,account:()=>a,snapshot:()=>({}),apply:async()=>{},persist:async()=>{},canSync:()=>allowed,pollInterval:30000,now:()=>100000,
  rpc:async()=>{calls++;return {accountSyncProtocol:1,userId:s.user.id,documents:[],cursor:'clean',stable:true};}});
 await sync.sync();assert.equal(calls,0);allowed=true;await sync.sync();assert.equal(calls,1);
 await sync.sync();assert.equal(calls,1);allowed=false;await sync.sync(true);assert.equal(calls,2);
});
context.publishVisibleResult_=publish;
await check('Authenticated background polling eventually publishes every accepted training result once',()=>{
 for(let i=0;i<25;i++)raw('GET','/api/public-table-sync',instructorToken);
 for(const person of people){const r=context.listResults_(person.user.id).find(r=>r.testId===training.id);assert.equal(publicRows(context.publicResultsSheet_()).filter(row=>String(row[7])===String(r.id)).length,1);}
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/classroom-delivery.json',import.meta.url),JSON.stringify({passed:checks.length,cadets:20,checks,backend:'actual Code.gs with synthetic Sheets doubles',clients:'actual core.js, exam-session.js, account-sync.js',liveGoogleLoadMeasured:false},null,2));
console.log('Classroom delivery: '+checks.length+' checks passed.');
