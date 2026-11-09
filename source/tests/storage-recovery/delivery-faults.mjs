import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {audit,C,model,install,clone} from './support.mjs';
const {api,check,finish}=audit('delivery-faults');
const teacher=model.instructorToken;
const group=api('POST','/api/instructor/groups',teacher,{name:'Аудит відновлення відповідей'}).group;
const t=api('POST','/api/instructor/tests',teacher,{title:'Збереження після збоїв',accessProtocol:1,questions:[...Array.from({length:188},(_,i)=>({text:'Вибір '+i,answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]})),...Array.from({length:12},(_,i)=>({type:'written',text:'Пояснення '+i,maxPoints:5,answers:[]}))]}).test;
api('POST','/api/instructor/tests/'+t.id+'/access',teacher,{expectedRevision:1,scope:'all',open:true});
let number=0,bodyChecks=0,ackLost=0,reloads=0;
const people=[];
function person(){const i=++number;const c=api('POST','/api/register','',{username:'audit_delivery_'+i,fullName:'Синтетична робота '+i,groupId:group.id,...model.credential('synthetic-delivery-password')});people.push(c);return c;}
function make(c,stored){
 let state=stored?clone(stored):null;
 if(!state){const sid='pc-'+crypto.randomUUID(),begun=api('POST','/api/tests/'+t.id+'/start',c.token,{submissionId:sid}),answers={};
  for(const q of t.questions)answers[q.id]=C.isWritten(q)?('Робота '+number+' · '+q.id+'\n"Україна" 🇺🇦 <tag> & =SUM(A1)\\\t').repeat(24):[q.answers[(number+Number(q.id.match(/q(\d+)/)[1]))%2].id];
  const a={tests:[begun.test],fullTests:{[t.id]:begun.test},pending:[],results:[],reviews:{},run:{test:begun.test,startPermit:begun.startPermit,answers,submissionId:sid,userId:String(c.user.id),startedUptime:1000,lastElapsed:0,localRevision:0}};
  state={version:1,session:{token:c.token,user:c.user},groups:[group],accounts:{[c.user.id]:a}};
 }
 let disk=clone(state);const diskPlan=[],networkPlan=[],sent=[];const a=()=>box.S.accounts[String(c.user.id)];
 const error=code=>Object.assign(Error('Synthetic '+code),{code,...(code==='STORAGE_WRITE'?{localSave:true}:{})});
 const box=install({C,crypto,structuredClone,S:state,user:()=>box.S.session?.user,instructor:()=>false,alive:()=>true,account:a,id:C.id,working:false,updateApplying:false,syncing:false,page:'runner',lastResult:null,lastError:'',document:{fullscreenElement:null},render:()=>{},uptime:()=>61000,getClock:async()=>({uptime:61000}),
  persist:async()=>{const f=diskPlan.shift();if(f==='before')throw error('STORAGE_WRITE');disk=clone(box.S);if(f==='after')throw error('STORAGE_WRITE');},
  rpc:async(m,p,b,token)=>{const f=networkPlan.shift();sent.push(clone(b));if(f&&f!=='lost'&&f!=='foreign')throw error(f);const r=api(m,p,token,b);if(f==='lost'){ackLost++;throw error('NETWORK');}if(f==='foreign')return {...r,result:{...r.result,userId:'another-user'}};return r;}
 },['finishRun','syncQueue','runCheckpoint','stamp']);
 return {box,account:a,disk:()=>clone(disk),diskPlan,networkPlan,sent,reload(){reloads++;return make(c,disk);}};
}
function verify(c,expected){const records=api('GET','/api/my-results',c.token).results.filter(r=>String(r.testId)===String(t.id));assert.equal(records.length,1);const record=model.context.resultRecordById_(records[0].id),saved=JSON.parse(record.row[13]);for(const q of t.questions){const want=expected[q.id];assert.deepEqual(saved[q.id],!C.isWritten(q)&&Array.isArray(want)&&want.length===1?want[0]:want);bodyChecks++;}return records[0];}
await check('A failed local save keeps the complete active work and makes no result request',async()=>{
 const c=person(),client=make(c),run=clone(client.account().run);client.diskPlan.push('before');await assert.rejects(()=>client.box.finishRun(false,61000));assert.equal(client.account().pending.length,0);assert.deepEqual(clone(client.account().run.answers),run.answers);assert.equal(client.sent.length,0);
 const again=client.reload();again.networkPlan.push('NETWORK');await again.box.finishRun(false,61000);assert.equal(again.account().pending.length,1);await again.box.syncQueue(true);verify(c,run.answers);
});
await check('A crash after disk commit but before its acknowledgement restores the saved queue',async()=>{
 const c=person(),client=make(c),expected=clone(client.account().run.answers);client.diskPlan.push('after');await assert.rejects(()=>client.box.finishRun(false,61000));assert.equal(client.disk().accounts[c.user.id].pending.length,1);assert.equal(client.sent.length,0);const again=client.reload();await again.box.syncQueue(true);assert.equal(again.account().pending.length,0);verify(c,expected);
});
await check('A fully offline finish survives a serialized reload without changing answer bytes',async()=>{
 const c=person(),client=make(c),expected=clone(client.account().run.answers);client.networkPlan.push('NETWORK');await client.box.finishRun(false,61000);const pending=clone(client.account().pending[0].body);assert.equal(client.disk().accounts[c.user.id].pending.length,1);const again=client.reload();assert.deepEqual(clone(again.account().pending[0].body),pending);await again.box.syncQueue(true);verify(c,expected);
});
await check('BUSY, HTTP errors, malformed replies and lost acknowledgements keep the same submission key',async()=>{
 const c=person(),client=make(c),expected=clone(client.account().run.answers);client.networkPlan.push('BUSY','HTTP_429','HTTP_502','HTTP_503','EMPTY','BAD_JSON','lost');await client.box.finishRun(false,61000);const body=clone(client.account().pending[0].body);
 for(let i=0;i<6;i++){await client.box.syncQueue(true);assert.equal(client.account().pending.length,1);assert.deepEqual(clone(client.account().pending[0].body),body);}
 const again=client.reload();await again.box.syncQueue(true);assert.equal(again.account().pending.length,0);verify(c,expected);assert.ok([...client.sent,...again.sent].every(b=>b.submissionId===body.submissionId));
});
await check('An accepted foreign acknowledgement cannot remove this cadet’s queued answers',async()=>{
 const c=person(),client=make(c),expected=clone(client.account().run.answers);client.networkPlan.push('foreign');await client.box.finishRun(false,61000);assert.equal(client.account().pending.length,1);assert.equal(client.account().results.length,0);await client.box.syncQueue(true);assert.equal(client.account().pending.length,0);verify(c,expected);
});
await check('A disk failure after server acceptance keeps an exact retry and creates no duplicate',async()=>{
 const c=person(),client=make(c),expected=clone(client.account().run.answers);client.diskPlan.push(null,'before');await client.box.finishRun(false,61000);assert.equal(client.account().pending.length,1);assert.equal(client.disk().accounts[c.user.id].pending.length,1);const again=client.reload();await again.box.syncQueue(true);verify(c,expected);assert.equal(again.account().pending.length,0);
});
await check('A result committed before an auxiliary failure retains every answer on retry',async()=>{
 const c=person(),client=make(c),expected=clone(client.account().run.answers),original=model.context.invalidatePublicSync_;let once=true;
 model.context.invalidatePublicSync_=function(){if(once){once=false;throw Error('Synthetic failure after the authoritative row write');}return original();};
 try{await client.box.finishRun(false,61000);}finally{model.context.invalidatePublicSync_=original;}
 assert.equal(client.account().pending.length,1);await client.box.syncQueue(true);verify(c,expected);assert.equal(client.account().pending.length,0);
});
await check('Repeated retries after a lost server reply return exactly one authoritative result',async()=>{
 const c=person(),client=make(c),expected=clone(client.account().run.answers);client.networkPlan.push('lost');await client.box.finishRun(false,61000);const body=clone(client.account().pending[0].body);for(let i=0;i<25;i++)api('POST','/api/results',c.token,body);await client.box.syncQueue(true);verify(c,expected);
});
await check('A crash checkpoint restores the last input and rejects older or foreign checkpoints',()=>{
 const c=person(),client=make(c),saved=client.disk(),q=t.questions.at(-1);client.account().run.answers[q.id]='Останній ввід перед закриттям 🇺🇦\n'.repeat(45);const expected=client.account().run.answers[q.id],journal=clone(client.box.stamp(client.box.runCheckpoint(true)));
 assert.equal(C.applyCheckpoint(saved,journal),true);assert.equal(saved.accounts[c.user.id].run.answers[q.id],expected);assert.equal(C.applyCheckpoint(saved,journal),false);assert.equal(C.applyCheckpoint(saved,{...journal,revision:journal.revision+1,userId:'foreign'}),false);
});
await check('Twelve mixed 200-question works survive independent failures and simulated restarts',async()=>{
 for(let i=0;i<12;i++){const c=person(),client=make(c),expected=clone(client.account().run.answers);client.networkPlan.push(i%3===0?'lost':i%3===1?'HTTP_429':'NETWORK');await client.box.finishRun(false,61000);const again=client.reload();await again.box.syncQueue(true);assert.equal(again.account().pending.length,0);assert.equal(again.disk().accounts[c.user.id].pending.length,0);verify(c,expected);}
});
finish({syntheticCadets:people.length,authoritativeAnswersCompared:bodyChecks,lostAcknowledgements:ackLost,serializedRestarts:reloads,usesActualApplicationFunctions:['finishRun','syncQueue','runCheckpoint','stamp'],realBrowserExecuted:false});
