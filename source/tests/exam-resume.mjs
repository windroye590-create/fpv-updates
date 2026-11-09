import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createExamSession} from '../web/exam-session.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,credential,spreadsheet}=await import('./fixtures/server_model.mjs');
const checks=[];const check=async(name,f)=>{await f();checks.push(name);console.log('PASS '+name);};
let serverTime=Date.now();
context.Date=class extends Date{constructor(...args){super(...(args.length?args:[serverTime]));}static now(){return serverTime;}};
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Продовження іспиту'}).group;
const user=api('POST','/api/register','',{username:'exam-transfer',fullName:'Курсант передачі',groupId:group.id,...credential('exam-transfer-password')});
const other=api('POST','/api/register','',{username:'exam-other',fullName:'Інший курсант',groupId:group.id,...credential('exam-other-password')});
const question={type:'choice',text:'Оберіть правильне',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]};
const makeTest=(title,durationMinutes=20)=>api('POST','/api/instructor/tests',instructorToken,{title,mode:'exam',durationMinutes,published:true,questions:[question,{type:'written',text:'Поясніть',maxPoints:3,rubric:'Прихований критерій',answers:[]}]}).test;
const direct=(action,body={},token=user.token)=>api(action==='read'?'GET':'POST','/api/exam-session'+(action==='read'?'':'/'+action),token,body);
function computer(token=user.token,initial={}){
 let s={token,user:user.user},online=true,hook=null,ticks=10000;
 const a={run:null,results:[],...initial},device=crypto.randomUUID(),finished=[];
 const rpc=async(m,p,b,t)=>{if(!online)throw Object.assign(Error('offline'),{code:'NETWORK'});return hook?hook(m,p,b,t):api(m,p,t,b);};
 const controller=createExamSession({session:()=>s,account:()=>a,deviceId:()=>device,rpc,persist:async()=>{},now:()=>ticks,completed:async c=>finished.push(c)});
 return {a,device,controller,finished,offline:()=>online=false,online:()=>online=true,hook:f=>hook=f,advance:n=>ticks+=n,switch:()=>s={token:'other-token',user:other.user}};
}
const a=computer(),b=computer(context.issueToken_(user.user)),test=makeTest('Іспит з двох ПК');
await check('Server creates one account-owned attempt with fixed deadline and no answer key',async()=>{
 await a.controller.start(test.id);const r=a.a.run;assert.equal(r.examProtocol,1);assert.equal(r.deadline-r.startedAt,20*60000);assert.ok(!('sourceTest' in r));assert.ok(r.test.questions.every(q=>!q.rubric&&q.answers.every(x=>!('isCorrect' in x))));
});
const initialDeadline=a.a.run.deadline;
await check('Saved written answers, selections and exact question order load on a clean second PC',async()=>{
 a.a.run.answers={[test.questions[0].id]:test.questions[0].answers[0].id,[test.questions[1].id]:'Відповідь\nна першому ПК'};a.a.run.index=1;await a.controller.sync();await b.controller.discover();assert.deepEqual(b.a.run.answers,a.a.run.answers);assert.deepEqual(b.a.run.test.questions,a.a.run.test.questions);assert.equal(b.a.run.index,1);assert.equal(b.controller.owned(),false);
});
await check('Claiming on PC 2 preserves deadline and fences off PC 1',async()=>{
 serverTime+=25000;await b.controller.claim();assert.equal(b.controller.owned(),true);assert.equal(b.a.run.deadline,initialDeadline);a.a.run.answers[test.questions[1].id]='Застаріла зміна';await assert.rejects(()=>a.controller.sync(),x=>x.code==='EXAM_TAKEN');assert.equal(a.controller.owned(),false);assert.notEqual(direct('read').document.value.answers[test.questions[1].id],'Застаріла зміна');
});
await check('Only one claim with the same old fence can win',()=>{
 const v=direct('read').document.value;direct('claim',{submissionId:v.submissionId,deviceId:b.device,fence:v.fence,requestId:crypto.randomUUID()});assert.throws(()=>direct('claim',{submissionId:v.submissionId,deviceId:a.device,fence:v.fence,requestId:crypto.randomUUID()}),x=>x.code==='EXAM_TAKEN');
});
await check('A clean handoff saves new answers and releases the editor',async()=>{
 await b.controller.claim();b.a.run.answers[test.questions[1].id]='Доопрацьовано на другому ПК';await b.controller.release();assert.equal(direct('read').document.value.ownerId,'');await a.controller.claim();assert.equal(a.controller.owned(),true);assert.equal(a.a.run.answers[test.questions[1].id],'Доопрацьовано на другому ПК');assert.equal(a.a.run.deadline,initialDeadline);
});
await check('Changing the PC wall clock cannot reset elapsed exam time',async()=>{
 const before=a.controller.elapsed();a.advance(30000);assert.equal(Math.floor(a.controller.elapsed()-before),30);assert.equal(a.a.run.deadline,initialDeadline);
});
await check('Offline changes remain local and upload after reconnecting',async()=>{
 a.offline();a.a.run.answers[test.questions[1].id]='Локальна відповідь';await assert.rejects(()=>a.controller.sync(),/offline/);assert.ok(a.controller.status().pending);a.online();await a.controller.sync();assert.equal(direct('read').document.value.answers[test.questions[1].id],'Локальна відповідь');
});
await check('Lost save acknowledgement retries exactly once without a duplicate revision',async()=>{
 let dropped=false;a.a.run.answers[test.questions[1].id]='Втрачено підтвердження';const before=direct('read').document.revision;
 a.hook((m,p,body,t)=>{const r=api(m,p,t,body);if(!dropped&&p.endsWith('/save')){dropped=true;throw Object.assign(Error('lost reply'),{code:'NETWORK'});}return r;});await assert.rejects(()=>a.controller.sync(),/lost reply/);await a.controller.sync();a.hook(null);assert.equal(direct('read').document.revision,before+1);assert.equal(a.controller.status().pending,false);
});
await check('Edits made during an in-flight save remain pending and are uploaded',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),start=new Promise(r=>entered=r);let blocked=false;
 a.a.run.answers[test.questions[1].id]='Перша версія';a.hook(async(m,p,body,t)=>{const r=api(m,p,t,body);if(!blocked&&p.endsWith('/save')){blocked=true;entered();await gate;}return r;});const run=a.controller.sync();await start;a.a.run.answers[test.questions[1].id]='Нова версія під час запиту';release();await run;a.hook(null);assert.equal(direct('read').document.value.answers[test.questions[1].id],'Нова версія під час запиту');
});
await check('A request ID cannot acknowledge a different set of answers',()=>{
 const doc=direct('read'),v=doc.document.value,body={deviceId:a.device,submissionId:v.submissionId,fence:v.fence,expectedRevision:doc.document.revision,requestId:crypto.randomUUID(),checkpoint:{answers:v.answers,index:0,exitCount:0}};direct('save',body);assert.throws(()=>direct('save',{...body,checkpoint:{...body.checkpoint,index:1}}),x=>x.code==='REQUEST_CONFLICT');
});
await check('Legacy result endpoint cannot bypass ownership of an active cloud exam',()=>{
 const v=direct('read').document.value;assert.throws(()=>api('POST','/api/results',user.token,{testId:test.id,submissionId:v.submissionId,writtenProtocol:1,answers:[]}),x=>x.code==='EXAM_SESSION_REQUIRED');
});
await check('Anonymous users, instructors and other cadets cannot access the attempt',()=>{
 assert.throws(()=>direct('read',{},''),x=>x.code==='SESSION_EXPIRED');assert.throws(()=>direct('read',{},instructorToken),x=>x.code==='FORBIDDEN');assert.equal(direct('read',{userId:user.user.id},other.token).document.value,null);assert.ok(!api('GET','/api/account-state',user.token).documents.some(d=>d.key==='exam-attempt'));assert.throws(()=>api('GET','/api/account-state/document',user.token,{key:'exam-attempt'}),x=>x.code==='FORBIDDEN');
});
await check('Reloading the app preserves an active exam without submitting it',async()=>{
 const fresh=computer(context.issueToken_(user.user));await fresh.controller.discover();assert.equal(fresh.a.run.submissionId,a.a.run.submissionId);assert.equal(fresh.a.run.deadline,initialDeadline);assert.equal(fresh.finished.length,0);
});
await check('A changed test does not change the active attempt or its grading key',async()=>{
 const rows=spreadsheet.getSheetByName('_Тести').rows,row=rows.find(r=>String(r[0])===String(test.id)),questions=JSON.parse(row[7]);questions[0].answers.reverse();questions[0].answers.forEach((x,i)=>x.isCorrect=i===0);row[7]=JSON.stringify(questions);
 await a.controller.claim();a.a.run.answers[test.questions[0].id]=test.questions[0].answers[0].id;await a.controller.finish();assert.equal(a.a.run,null);assert.equal(a.finished.at(-1).result.correct,1);assert.equal(a.finished.at(-1).result.gradingStatus,'pending_review');
});
await check('Finishing is idempotent and a completed exam cannot be started again',()=>{
 const v=direct('read').document.value;const body={deviceId:a.device,submissionId:v.submissionId,fence:v.fence,expectedRevision:0,requestId:crypto.randomUUID(),checkpoint:{answers:{},index:0}};const one=direct('finish',body),two=direct('finish',body);assert.equal(one.completion.result.id,two.completion.result.id);assert.equal(api('GET','/api/my-results',user.token).results.filter(r=>r.testId===test.id).length,1);assert.throws(()=>direct('start',{deviceId:a.device,requestId:crypto.randomUUID(),testId:test.id}),x=>x.code==='ALREADY_COMPLETED');
});
await check('An expired attempt uses the fixed deadline and ignores late answer changes',async()=>{
 const t=makeTest('Строк іспиту',1);await a.controller.start(t.id);a.a.run.answers[t.questions[1].id]='До завершення часу';await a.controller.sync();serverTime+=61000;a.a.run.answers[t.questions[1].id]='Після завершення часу';await a.controller.finish();const done=a.finished.at(-1);assert.equal(done.result.durationSeconds,60);assert.equal(done.review.find(q=>q.questionId===t.questions[1].id).text,'До завершення часу');
});
await check('An expired attempt can be finalized from a new PC without a new allowance',async()=>{
 const t=makeTest('Строк між ПК',1);await a.controller.start(t.id);serverTime+=61000;await b.controller.discover();await b.controller.claim();assert.equal(b.a.run,null);assert.equal(b.finished.at(-1).result.durationSeconds,60);
});
await check('A legacy local exam cannot prefill a fresh server-timed attempt',async()=>{
 const t=makeTest('Стара локальна спроба');await assert.rejects(()=>a.controller.start(t.id,{answers:{[t.questions[1].id]:'Стара відповідь'},index:1,exitCount:2,lastElapsed:44,submissionId:'pc-legacy-test'}),x=>x.code==='EXAM_RECOVERY_REQUIRED');
});
await check('Lost release acknowledgement can be retried after ownership is released',async()=>{
 const t=makeTest('Передача без підтвердження');await a.controller.start(t.id);let dropped=false;a.hook((m,p,body,t)=>{const r=api(m,p,t,body);if(!dropped&&p.endsWith('/release')){dropped=true;throw Object.assign(Error('lost release'),{code:'NETWORK'});}return r;});await assert.rejects(()=>a.controller.release());await a.controller.release();a.hook(null);assert.equal(direct('read').document.value.ownerId,'');await b.controller.claim();await b.controller.finish();
});
await check('Finishing offline stays pending and completes after reconnecting',async()=>{const t=makeTest('Завершення без мережі');await a.controller.start(t.id);a.a.run.answers[t.questions[1].id]='Збережена відповідь';a.offline();await assert.rejects(()=>a.controller.finish(),/offline/);assert.ok(a.a.run.finishRequested);a.online();await a.controller.sync();assert.equal(a.a.run,null);assert.equal(a.finished.at(-1).result.testId,t.id);});
await check('A lost finish acknowledgement returns one authoritative result on retry',async()=>{const t=makeTest('Повтор завершення');await a.controller.start(t.id);let dropped=false;a.hook((m,p,body,token)=>{const r=api(m,p,token,body);if(!dropped&&p.endsWith('/finish')){dropped=true;throw Object.assign(Error('lost finish'),{code:'NETWORK'});}return r;});await assert.rejects(()=>a.controller.finish(),/lost finish/);await a.controller.sync();a.hook(null);assert.equal(a.a.run,null);assert.equal(api('GET','/api/my-results',user.token).results.filter(r=>r.testId===t.id).length,1);});
await check('An in-flight response cannot replace state after switching accounts',async()=>{
 const t=makeTest('Перехід акаунта');const c=computer();let release,entered;const gate=new Promise(r=>release=r),start=new Promise(r=>entered=r);c.hook(async(m,p,body,t)=>{const r=api(m,p,t,body);entered();await gate;return r;});const running=c.controller.start(t.id);await start;c.switch();release();await running;assert.equal(c.a.run,null);
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/exam-resume.json',import.meta.url),JSON.stringify({passed:checks.length,checks,backend:'actual Code.gs with Sheets doubles',clients:'actual exam-session.js; independent PCs and session tokens',physicalWindowsVerified:false,productionDeploymentVerified:false},null,2));console.log('Exam continuation: '+checks.length+' checks passed.');
