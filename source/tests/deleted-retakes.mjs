// Instructor-authorized new starts after deletion; real protocol, isolated data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
import {createExamSession} from '../web/exam-session.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken,regressionTest,regressionBody}=await import('./fixtures/server_model.mjs');
const checks=[];async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
function raw(method,path,token='',body={}){
 const r=JSON.parse(context.doPost({postData:{contents:JSON.stringify(C.payload(method,path,token,body))}}).text);
 if(!r.ok)throw Object.assign(Error(r.error),{code:r.code});return r;
}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Повтор після видалення'}).group;
const person=api('POST','/api/register','',{username:'deleted-retake',fullName:'Курсант повторної спроби',groupId:group.id,...credential('deleted-retake-password')});
const test=regressionTest('Повторне тренування після видалення');
const oldBody=regressionBody(test,'historical-deleted-submission');
const old=api('POST','/api/results',person.token,oldBody).result;
const erase=result=>raw('DELETE','/api/instructor/results/'+result.id,instructorToken,{confirmResultId:String(result.id)});
let start,firstBody,first;
await check('An existing historical deletion permits a fresh start but never resurrects its old queued submission',()=>{
 erase(old);
 assert.throws(()=>raw('POST','/api/results',person.token,oldBody),x=>x.code==='RESULT_DELETED');
 const id='pc-'+crypto.randomUUID();start=raw('POST','/api/tests/'+test.id+'/start',person.token,{submissionId:id});
 assert.equal(start.submissionId,id);assert.ok(start.startPermit);
 assert.throws(()=>raw('POST','/api/results',person.token,oldBody),x=>x.code==='RESULT_DELETED');
 firstBody={...regressionBody(test,id),startPermit:start.startPermit};first=raw('POST','/api/results',person.token,firstBody).result;
 assert.notEqual(first.id,old.id);assert.equal(context.listResults_(person.user.id).filter(r=>r.testId===test.id).length,1);
 assert.equal(raw('POST','/api/results',person.token,firstBody).result.id,first.id);
});
await check('Completing a live result does not grant unlimited retakes or change another cadet',()=>{
 assert.throws(()=>raw('POST','/api/tests/'+test.id+'/start',person.token,{submissionId:'pc-'+crypto.randomUUID()}),x=>x.code==='ALREADY_COMPLETED');
 assert.throws(()=>raw('DELETE','/api/instructor/results/'+first.id,person.token,{confirmResultId:String(first.id)}),x=>x.code==='FORBIDDEN');
});
let deletions;
await check('A second deletion invalidates the previous signed permit and fresh work remains available',()=>{
 erase(first);deletions=raw('GET','/api/workspace',person.token,{known:{}}).deletedResults;
 assert.equal(deletions.filter(d=>d.testId===String(test.id)).length,2);
 assert.ok(deletions.find(d=>d.testId===String(test.id)).retakeEpoch);
 assert.throws(()=>raw('POST','/api/results',person.token,firstBody),x=>x.code==='RESULT_DELETED');
 assert.throws(()=>raw('POST','/api/tests/'+test.id+'/start',person.token,{submissionId:firstBody.submissionId,startPermit:firstBody.startPermit,resumeProtocol:1}),x=>x.code==='RESULT_DELETED');
 const id='pc-'+crypto.randomUUID(),again=raw('POST','/api/tests/'+test.id+'/start',person.token,{submissionId:id});
 assert.notEqual(again.startPermit,firstBody.startPermit);
 assert.throws(()=>raw('POST','/api/results',person.token,{...firstBody,startPermit:again.startPermit}),x=>x.code==='RESULT_DELETED');
 firstBody={...regressionBody(test,id),startPermit:again.startPermit};
 raw('POST','/api/results',person.token,firstBody);
});
await check('A stale local training run is backed up and cleared, while a fresh retake survives refresh',()=>{
 const a={run:{test,submissionId:oldBody.submissionId,startPermit:start.startPermit,answers:{q:'Збережена відповідь'}},pcSync:{revisions:{training:9},shadow:{},requests:{training:{requestId:'old'}},conflicts:{training:{}},cursor:'old'}};
 a.pcSync.shadow.training=structuredClone(a.run);
 assert.equal(C.resetDeletedTraining(a,deletions),true);assert.equal(a.run,null);assert.equal(a.retakeBackups[0].answers.q,'Збережена відповідь');assert.equal(a.pcSync.revisions.training,undefined);assert.equal(a.pcSync.cursor,'');
 a.run={test,submissionId:firstBody.submissionId,startPermit:firstBody.startPermit,answers:{q:'Нова відповідь'}};
 assert.equal(C.resetDeletedTraining(a,deletions),false);assert.equal(a.run.answers.q,'Нова відповідь');
});
await check('Legacy clients keep their historical deletion guard and cannot upload stale work',()=>{
 assert.throws(()=>api('POST','/api/results',person.token,oldBody),x=>['RESULT_DELETED','ALREADY_COMPLETED'].includes(x.code));
});
const exam=api('POST','/api/instructor/tests',instructorToken,{title:'Повторний іспит',mode:'exam',durationMinutes:20,published:true,questions:[{type:'written',text:'Відповідь',maxPoints:2,answers:[]}]}).test;
function computer(initial={}){
 const a={run:null,...initial},finished=[],saved=[];let ticks=10000,drop=false;
 const controller=createExamSession({session:()=>person,account:()=>a,deviceId:()=> 'retake-device',now:()=>ticks,random:()=>0,persist:async()=>saved.push(structuredClone(a)),completed:async r=>finished.push(r),rpc:async(m,p,b,t)=>{
  const reply=raw(m,p,t,b);if(drop&&p.endsWith('/finish')){drop=false;throw Object.assign(Error('lost acknowledgement'),{code:'NETWORK'});}return reply;
 }});
 return {a,controller,finished,saved,lose:()=>drop=true,advance:n=>ticks+=n};
}
const pc=computer();let stale,firstExam;
await check('A completed exam deleted after a lost acknowledgement clears its stale pending finish and keeps a local backup',async()=>{
 await pc.controller.start(exam.id);pc.a.run.answers[exam.questions[0].id]='Перша письмова робота';pc.lose();
 await assert.rejects(()=>pc.controller.finish(),x=>x.code==='NETWORK');stale=structuredClone(pc.a);
 firstExam=context.listResults_(person.user.id).find(r=>r.testId===exam.id);assert.ok(firstExam);erase(firstExam);
 await assert.rejects(()=>pc.controller.sync(),x=>x.code==='RESULT_DELETED');assert.equal(pc.a.run,null);
 assert.equal(pc.a.examBackups[0].answers[exam.questions[0].id],'Перша письмова робота');
});
await check('Reloading another stale PC discovers the instructor deletion without restoring the removed attempt',async()=>{
 const other=computer(stale);await other.controller.discover();assert.equal(other.a.run,null);assert.equal(other.a.examRequest,undefined);assert.equal(other.a.examBackups[0].answers[exam.questions[0].id],'Перша письмова робота');
});
await check('The same exam starts with a fresh attempt and accepts one new authoritative result',async()=>{
 await pc.controller.start(exam.id);assert.notEqual(pc.a.run.submissionId,stale.run.submissionId);
 pc.a.run.answers[exam.questions[0].id]='Нова письмова робота';await pc.controller.finish();
 assert.equal(pc.a.run,null);assert.equal(pc.finished.length,1);assert.equal(pc.finished[0].review[0].text,'Нова письмова робота');
 assert.notEqual(pc.finished[0].result.id,firstExam.id);assert.equal(context.listResults_(person.user.id).filter(r=>r.testId===exam.id).length,1);
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/deleted-retakes.json',import.meta.url),JSON.stringify({passed:checks.length,checks,backend:'actual Code.gs with Sheets doubles',liveDataChanged:false},null,2));
console.log('Deleted-result retakes: '+checks.length+' checks passed.');
