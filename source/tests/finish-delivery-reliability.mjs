// Actual application/controller and Code.gs, synthetic data; no production calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createExamSession} from '../web/exam-session.js';
import {audit,C,model,install,clone} from './storage-recovery/support.mjs';
const {api,check,finish}=audit('finish-delivery-reliability');
const group=api('POST','/api/instructor/groups',model.instructorToken,{name:'Надійне завершення'}).group;
let sequence=0;
const person=()=>api('POST','/api/register','',{username:'finish_delivery_'+(++sequence),fullName:'Перевірка завершення '+sequence,groupId:group.id,...model.credential('synthetic-finish-password')});
const question={type:'written',text:'Поясніть відповідь',maxPoints:3,answers:[]};
const training=api('POST','/api/instructor/tests',model.instructorToken,{title:'Черга після локального збою',mode:'training',published:true,questions:[question]}).test;
function gate(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()};}
function queueClient(p,stored){
 const initial={session:{token:p.token,user:p.user},accounts:{[p.user.id]:{pending:[],results:[],reviews:{},fullTests:{}}}};
 const state=clone(stored||initial);let disk=clone(state),at=100000,hook=null;const sent=[];
 const box=install({C,crypto,structuredClone,S:state,user:()=>box.S.session?.user,instructor:()=>false,alive:()=>true,account:()=>box.S.accounts[p.user.id],id:C.id,
  working:false,refreshing:false,updateApplying:false,syncing:false,page:'home',lastResult:null,lastError:'',render:()=>{},toast:()=>{},
  Date:class extends Date{static now(){return at;}},persist:async()=>{disk=clone(box.S);},
  rpc:async(m,path,body,token)=>{sent.push(clone(body));return hook?hook(m,path,body,token):api(m,path,token,body);}
 },['syncQueue']);
 return {box,a:box.account(),sent,disk:()=>clone(disk),hook:f=>hook=f,advance:n=>at+=n};
}
const queuedBody=(key,text)=>({testId:training.id,submissionId:key,durationSeconds:30,writtenProtocol:1,choiceProtocol:2,answers:[{questionId:training.questions[0].id,text}]});
await check('A temporary local transport failure retries automatically with byte-identical answers',async()=>{
 const p=person(),pc=queueClient(p),body=queuedBody('local-retry-'+crypto.randomUUID(),'Остаточна відповідь 🇺🇦');
 pc.a.pending.push({body:clone(body),attempts:0,nextAt:0});pc.hook(()=>{throw Object.assign(Error('Local connection reset'),{code:'LOCAL_HOST_UNAVAILABLE'});});
 await pc.box.syncQueue();assert.equal(pc.a.pending[0].permanent,false);assert.ok(pc.a.pending[0].nextAt>100000);
 pc.hook(null);pc.advance(400000);await pc.box.syncQueue();assert.equal(pc.a.pending.length,0);assert.deepEqual(pc.sent,[body,body]);
 assert.equal(api('GET','/api/my-results',p.token).results.filter(r=>r.testId===training.id).length,1);
});
await check('Previously permanent local-transport failures recover after a serialized restart without a manual force',async()=>{
 const p=person(),first=queueClient(p),body=queuedBody('old-permanent-'+crypto.randomUUID(),'Раніше збережена робота');
 first.a.pending.push({body,permanent:true,failureCode:'LOCAL_HOST_UNAVAILABLE',attempts:3,nextAt:999999999});await first.box.persist();
 const pc=queueClient(p,first.disk());await pc.box.syncQueue();assert.equal(pc.a.pending.length,0);assert.deepEqual(pc.sent,[body]);
});
await check('A lost acknowledgement after server commit retries the original key and creates one result',async()=>{
 const p=person(),pc=queueClient(p),body=queuedBody('local-lost-ack-'+crypto.randomUUID(),'Відповідь зі втраченим підтвердженням');
 pc.a.pending.push({body,attempts:0,nextAt:0});pc.hook((m,path,b,t)=>{api(m,path,t,b);throw Object.assign(Error('Lost local reply'),{code:'LOCAL_HOST_UNAVAILABLE'});});
 await pc.box.syncQueue();pc.hook(null);pc.advance(400000);await pc.box.syncQueue();assert.equal(pc.a.pending.length,0);
 assert.deepEqual(pc.sent,[body,body]);assert.equal(api('GET','/api/my-results',p.token).results.filter(r=>r.testId===training.id).length,1);
});
await check('A permanently invalid request is not automatically retried',async()=>{
 const p=person(),pc=queueClient(p);pc.a.pending.push({body:queuedBody('invalid-'+crypto.randomUUID(),'Invalid'),attempts:0,nextAt:0});
 pc.hook(()=>{throw Object.assign(Error('Invalid body'),{code:'BAD_REQUEST'});});await pc.box.syncQueue();pc.advance(400000);await pc.box.syncQueue();
 assert.equal(pc.sent.length,1);assert.equal(pc.a.pending[0].permanent,true);
});
function exam(p,stored){
 const a=clone(stored||{run:null}),saved=[],sent=[],completed=[];let disk=clone(a),rpcHook=null,diskHook=null,s={token:p.token,user:p.user};
 const controller=createExamSession({session:()=>s,account:()=>a,deviceId:()=> 'finish-device-'+p.user.id,now:()=>10000,random:()=>0,
  persist:async()=>{const snapshot=clone(a);if(diskHook)await diskHook(snapshot);disk=snapshot;saved.push(snapshot);},
  completed:async reply=>completed.push(reply),rpc:async(m,path,body,token)=>{sent.push({path,body:clone(body)});return rpcHook?rpcHook(m,path,body,token):api(m,path,token,body);}});
 return {a,controller,saved,sent,completed,disk:()=>clone(disk),rpcHook:f=>rpcHook=f,diskHook:f=>diskHook=f,switch:()=>{s={token:'other-session',user:{...p.user,id:'other-user'}};controller.reset();}};
}
const newExam=()=>api('POST','/api/instructor/tests',model.instructorToken,{title:'Завершення '+crypto.randomUUID(),mode:'exam',durationMinutes:20,published:true,questions:[question]}).test;
await check('Finish freezes edits and saves the exact final answer while an earlier cloud save is still in flight',async()=>{
 const p=person(),pc=exam(p),t=newExam(),entered=gate(),release=gate();let held=false;
 await pc.controller.start(t.id);pc.a.run.answers[t.questions[0].id]='Початкова відповідь';
 pc.rpcHook(async(m,path,b,token)=>{const r=api(m,path,token,b);if(path.endsWith('/save')&&!held){held=true;entered.resolve();await release.promise;}return r;});
 const saving=pc.controller.sync();await entered.promise;pc.a.run.answers[t.questions[0].id]='Остаточна відповідь';
 const finishing=pc.controller.finish();let failure;
 try{assert.equal(pc.controller.editable(),false);assert.equal(pc.a.run.finishRequested,true);await Promise.resolve();await Promise.resolve();assert.equal(pc.disk().run.finishCheckpoint.answers[t.questions[0].id],'Остаточна відповідь');}
 catch(x){failure=x;}finally{release.resolve();}
 await Promise.all([saving,finishing]);if(failure)throw failure;
 assert.equal(pc.sent.filter(r=>r.path.endsWith('/save')).length,1);assert.equal(pc.sent.filter(r=>r.path.endsWith('/finish')).length,1);
 assert.equal(pc.completed[0].review[0].text,'Остаточна відповідь');assert.equal(pc.a.run,null);
});
await check('Finish sends no network request before local intent storage has acknowledged the write',async()=>{
 const pc=exam(person()),t=newExam(),entered=gate(),release=gate();await pc.controller.start(t.id);
 pc.a.run.answers[t.questions[0].id]='На диску перед надсиланням';let first=true;
 pc.diskHook(async()=>{if(first){first=false;entered.resolve();await release.promise;}});
 const finishing=pc.controller.finish();await entered.promise;assert.equal(pc.controller.editable(),false);assert.equal(pc.sent.filter(r=>r.path.endsWith('/finish')).length,0);
 release.resolve();await finishing;assert.equal(pc.completed[0].review[0].text,'На диску перед надсиланням');
});
await check('Rapid repeated finish calls share one operation and create one result',async()=>{
 const p=person(),pc=exam(p),t=newExam();await pc.controller.start(t.id);pc.a.run.answers[t.questions[0].id]='Одна робота';
 const one=pc.controller.finish(),two=pc.controller.finish(),settled=Promise.allSettled([one,two]);await settled;assert.equal(one,two);
 assert.equal(pc.sent.filter(r=>r.path.endsWith('/finish')).length,1);assert.equal(api('GET','/api/my-results',p.token).results.filter(r=>r.testId===t.id).length,1);
});
await check('The final checkpoint stays unchanged after an interrupted finish and retries with the same request key',async()=>{
 const pc=exam(person()),t=newExam();await pc.controller.start(t.id);pc.a.run.answers[t.questions[0].id]='Зафіксована відповідь';
 pc.rpcHook(()=>{throw Object.assign(Error('Temporary local failure'),{code:'LOCAL_HOST_UNAVAILABLE'});});await assert.rejects(()=>pc.controller.finish());
 const original=clone(pc.a.examRequest);pc.a.run.answers[t.questions[0].id]='Пізня зміна поза редактором';pc.rpcHook(null);await pc.controller.sync();
 const posts=pc.sent.filter(r=>r.path.endsWith('/finish'));assert.deepEqual(posts[0].body,posts[1].body);assert.equal(posts[1].body.requestId,original.requestId);
 assert.equal(pc.completed[0].review[0].text,'Зафіксована відповідь');
});
await check('A lost autosave acknowledgement is reconciled before the same frozen final checkpoint is submitted',async()=>{
 const pc=exam(person()),t=newExam();await pc.controller.start(t.id);pc.a.run.answers[t.questions[0].id]='Перед останньою зміною';let once=true;
 pc.rpcHook((m,path,b,token)=>{const r=api(m,path,token,b);if(path.endsWith('/save')&&once){once=false;throw Object.assign(Error('Lost save'),{code:'NETWORK'});}return r;});
 await assert.rejects(()=>pc.controller.sync());pc.a.run.answers[t.questions[0].id]='Остаточна зміна';await pc.controller.finish();
 assert.equal(pc.completed[0].review[0].text,'Остаточна зміна');const saves=pc.sent.filter(r=>r.path.endsWith('/save'));assert.deepEqual(saves[0].body,saves[1].body);
});
await check('A local disk failure blocks transmission, keeps answers, and permits a later safe retry',async()=>{
 const pc=exam(person()),t=newExam();await pc.controller.start(t.id);pc.a.run.answers[t.questions[0].id]='Збережіть після відновлення диска';
 pc.diskHook(()=>{throw Object.assign(Error('Disk unavailable'),{code:'STORAGE_WRITE'});});await assert.rejects(()=>pc.controller.finish(),x=>x.localSave===true);
 assert.equal(pc.sent.filter(r=>r.path.endsWith('/finish')).length,0);assert.equal(pc.a.run.answers[t.questions[0].id],'Збережіть після відновлення диска');
 pc.diskHook(null);await pc.controller.finish();assert.equal(pc.completed[0].review[0].text,'Збережіть після відновлення диска');
});
await check('A serialized unfinished intent restores and automatically sends the frozen checkpoint',async()=>{
 const p=person(),pc=exam(p),t=newExam();await pc.controller.start(t.id);pc.a.run.answers[t.questions[0].id]='До перезапуску';
 pc.rpcHook(()=>{throw Object.assign(Error('Offline'),{code:'NETWORK'});});await assert.rejects(()=>pc.controller.finish());
 const restored=exam(p,pc.disk());await restored.controller.discover();assert.equal(restored.controller.editable(),false);await restored.controller.background();
 assert.equal(restored.a.run,null);assert.equal(restored.completed[0].review[0].text,'До перезапуску');
});
await check('A restart while finish waits behind an unacknowledged autosave preserves the final checkpoint',async()=>{
 const p=person(),pc=exam(p),t=newExam(),entered=gate(),release=gate();await pc.controller.start(t.id);
 pc.a.run.answers[t.questions[0].id]='Перша версія';let once=true;
 pc.rpcHook(async(m,path,b,token)=>{const r=api(m,path,token,b);if(path.endsWith('/save')&&once){once=false;entered.resolve();await release.promise;}return r;});
 const saving=pc.controller.sync();await entered.promise;pc.a.run.answers[t.questions[0].id]='Остаточна версія перед перезапуском';const finishing=pc.controller.finish();
 await Promise.resolve();await Promise.resolve();const stored=pc.disk();pc.switch();release.resolve();await Promise.allSettled([saving,finishing]);
 assert.equal(stored.examRequest.action,'save');assert.equal(stored.run.finishCheckpoint.answers[t.questions[0].id],'Остаточна версія перед перезапуском');
 const restored=exam(p,stored);await restored.controller.discover();await restored.controller.sync();assert.equal(restored.a.run,null);assert.equal(restored.completed[0].review[0].text,'Остаточна версія перед перезапуском');
});
await check('A local-host failure while saving the intent is a disk-path failure and cannot be reported as safely queued',async()=>{
 const pc=exam(person()),t=newExam();await pc.controller.start(t.id);pc.a.run.answers[t.questions[0].id]='Ще не підтверджено локальне збереження';
 pc.diskHook(()=>{throw Object.assign(Error('Local host stopped during persistence'),{code:'LOCAL_HOST_UNAVAILABLE'});});
 await assert.rejects(()=>pc.controller.finish(),x=>x.code==='LOCAL_HOST_UNAVAILABLE'&&x.localSave===true);
 assert.equal(pc.sent.filter(r=>r.path.endsWith('/finish')).length,0);
});
await check('An account change during a locally pending finish cannot send the old work as the new account',async()=>{
 const pc=exam(person()),t=newExam(),entered=gate(),release=gate();await pc.controller.start(t.id);let first=true;
 pc.diskHook(async()=>{if(first){first=false;entered.resolve();await release.promise;}});const finishing=pc.controller.finish();await entered.promise;pc.switch();release.resolve();await finishing;
 assert.equal(pc.sent.filter(r=>r.path.endsWith('/finish')).length,0);
});
const result=finish({productionRequests:0});
fs.writeFileSync(new URL('../verification/finish-delivery-reliability.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
