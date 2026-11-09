import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const results=[];
async function check(name,run){try{await run();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:e.message});}}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Діагностика письмових робіт'}).group;
const cadet=api('POST','/api/register','',{fullName:'Діагностика ПК',username:'written_reliability',groupId:group.id,...credential('reliability-password')});
const test=api('POST','/api/instructor/tests',instructorToken,{title:'Межі письмової роботи',questions:Array.from({length:200},(_,i)=>({type:'written',text:'Питання '+i,maxPoints:1,answers:[]}))}).test;
const answers={};
for(const q of test.questions.slice(0,15))answers[C.id(q.id)]='Ж'.repeat(3000);
const last=C.id(test.questions[15].id);answers[last]='';answers[last]='Ж'.repeat(47990-JSON.stringify(answers).length);
const run={test,answers,submissionId:'canonical-limit',startedUptime:0};
await check('All skipped questions count toward the same 48000-character server limit',()=>{
 assert.ok(JSON.stringify(answers).length<48000);
 const full=Object.fromEntries(test.questions.map(q=>[C.id(q.id),answers[C.id(q.id)]??'']));
 assert.ok(JSON.stringify(full).length>48000);
 assert.throws(()=>C.submission(run,1000),/48 000/);
});
await check('A near-limit answer map can be submitted without a permanent queue rejection',()=>{
 const fullLength=JSON.stringify(Object.fromEntries(test.questions.map(q=>[C.id(q.id),answers[C.id(q.id)]??'']))).length;
 const within=structuredClone(run);within.answers[last]=within.answers[last].slice(0,-(fullLength-48000));
 const body=C.submission(within,1000);const r=api('POST','/api/results',cadet.token,body).result;
 assert.equal(r.pendingWritten,200);
 assert.equal(r.gradingStatus,'pending_review');
});
await check('Native crash journal accepts a legal long Ukrainian answer checkpoint',()=>{
 const checkpoint={serial:1,kind:'run',userId:C.id(cadet.user.id),submissionId:run.submissionId,revision:1,index:15,answers,lastElapsed:20,exitCount:0};
 const size=Buffer.byteLength(JSON.stringify(checkpoint));assert.ok(size>65536);
 const native=fs.readFileSync(new URL('../native/main.c',import.meta.url),'utf8');
 const defines=new Map([...native.matchAll(/^#define (MAX_BODY|MAX_JOURNAL_BODY)\s+([^\r\n]+)/gm)].map(m=>[m[1],m[2].trim()]));
 function constant(name,seen=new Set()){
  assert.ok(!seen.has(name),'C limit aliases must not form a cycle');seen.add(name);
  const value=defines.get(name);assert.ok(value,'Missing native limit '+name);
  if(defines.has(value))return constant(value,seen);
  assert.match(value,/^[\d\suU()*]+$/,'Unsupported C limit expression');
  return value.replace(/[uU()\s]/g,'').split('*').reduce((n,v)=>n*Number(v),1);
 }
 const limit=constant('MAX_JOURNAL_BODY');assert.ok(Number.isSafeInteger(limit)&&limit>0);
 assert.ok(size<=limit,`${size} UTF-8 bytes exceed native journal limit ${limit}`);
});
const small=api('POST','/api/instructor/tests',instructorToken,{title:'Чернетка перевірки',questions:test.questions.slice(0,2)}).test;
const result=api('POST','/api/results',cadet.token,{testId:small.id,writtenProtocol:1,submissionId:'pending-comments',answers:[]}).result;
const review=api('GET',`/api/results/${result.id}/review`,instructorToken);
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const start=app.indexOf('async function saveGrading()');assert.ok(start>=0);
const next=app.indexOf('\nfunction ',start+1),nextAsync=app.indexOf('\nasync function ',start+1);
const ends=[next,nextAsync].filter(n=>n>start);const end=ends.length?Math.min(...ends):app.length;
const source=app.slice(start,end);
const draft={revision:0,items:{[small.questions[0].id]:{points:'1',comment:'Зараховано'},[small.questions[1].id]:{points:'',comment:'Збережений коментар до наступного питання'}},request:null};
const account={gradingDrafts:{[result.id]:draft},results:[]};
const sandbox={C,crypto,grading:{...review,draft},working:false,S:{session:{token:instructorToken}},id:C.id,account:()=>account,persist:async()=>{},render:()=>{},restoreWorkPosition:()=>{},toast:()=>{},reviewQueue:[result],page:'grading',loadReviewQueue:async()=>{},rpc:async(method,path,body={},token=instructorToken)=>api(method,path,token,body)};
sandbox.S.session.user=api('GET','/api/workspace',instructorToken).user;
sandbox.instructor=()=>true;sandbox.resultsView=()=>account.resultsView||'compact';sandbox.filter='';
sandbox.reviewPresence=createReviewPresence({session:()=>sandbox.S.session,rpc:sandbox.rpc,clientId:'written-reliability-window'});
await sandbox.reviewPresence.open(result.id);
vm.createContext(sandbox);vm.runInContext(source,sandbox);
await check('Partial grading keeps the draft comment of an answer with no points yet',async()=>{
 await vm.runInContext('saveGrading()',sandbox);
 const saved=account.gradingDrafts[result.id];
 assert.ok(saved,'Partial save deleted the ungraded comment draft');
 assert.equal(saved.revision,1);assert.equal(saved.request,null);
 assert.equal(saved.items[small.questions[1].id].comment,draft.items[small.questions[1].id].comment);
 assert.equal(api('GET',`/api/results/${result.id}/review`,instructorToken).result.pendingWritten,1);
});
await check('Reopening a partial review preserves the pending comment and current revision',async()=>{
 const line=app.split('\n').find(line=>line.startsWith('async function openGrading('));assert.ok(line);
 vm.runInContext(line,sandbox);await vm.runInContext(`openGrading(${JSON.stringify(result.id)})`,sandbox);
 assert.equal(sandbox.grading.draft.items[small.questions[1].id].comment,draft.items[small.questions[1].id].comment);
 assert.equal(sandbox.grading.draft.revision,1);
});
await check('Completing a partial review stores the remaining comment and removes its local draft',async()=>{
 sandbox.grading.draft.items[small.questions[1].id].points='0';
 await vm.runInContext('saveGrading()',sandbox);
 const current=api('GET',`/api/results/${result.id}/review`,instructorToken);
 assert.equal(current.result.gradingStatus,'graded');
 assert.equal(current.review[1].comment,draft.items[small.questions[1].id].comment);
 assert.equal(account.gradingDrafts[result.id],undefined);
});
const inputStart=app.indexOf("document.addEventListener('input',");
const inputEnd=app.indexOf('\nfunction markAway',inputStart);assert.ok(inputEnd>inputStart);
function inputHarness(run){
 const state={run},messages=[],writes=[];
 const box={C,id:C.id,alive:()=>true,updateApplying:false,user:()=>cadet.user,account:()=>state,page:'runner',document:{addEventListener:(kind,fn)=>box.input=fn},journal:j=>writes.push(j),runCheckpoint:()=>({answers:structuredClone(state.run.answers)}),scheduleSave:()=>{},render:()=>{},restoreWorkPosition:()=>{},toast:m=>messages.push(m)};
 vm.createContext(box);vm.runInContext(app.slice(inputStart,inputEnd),box);return {box,state,messages,writes};
}
await check('The actual written input handler rejects overflow before it enters the run',()=>{
 const safe=structuredClone(run);safe.answers[last]='';const h=inputHarness(safe);
 const el={value:run.answers[last],dataset:{runWritten:last}};h.box.input({target:el});
 assert.equal(el.value,'');assert.equal(h.state.run.answers[last],'');assert.equal(h.writes.length,0);assert.equal(h.messages.length,1);
});
await check('An oversized draft from an older version can be shortened gradually',()=>{
 const h=inputHarness(structuredClone(run));const value=run.answers[last].slice(0,-1);
 h.box.input({target:{value,dataset:{runWritten:last}}});
 assert.equal(h.state.run.answers[last],value);assert.equal(h.writes.length,1);assert.equal(h.messages.length,0);
});
await check('A choice click cannot put a near-limit written attempt over the server limit',()=>{
 const choice={id:'choice-end',type:'choice',answers:[{id:'choice-end-answer-1',text:'Вибір',isCorrect:true}]};
 const r=structuredClone(run);r.test.questions.push(choice);r.index=r.test.questions.length-1;
 const excess=C.answerStorageLength(r.test,r.answers)-48000;r.answers[last]=r.answers[last].slice(0,-excess);
 assert.equal(C.answerStorageLength(r.test,r.answers),48000);
 const h=inputHarness(r);h.box.input({target:{checked:true,dataset:{runAnswer:choice.answers[0].id}}});
 assert.equal(h.state.run.answers[choice.id],undefined);assert.equal(h.writes.length,0);assert.equal(h.messages.length,1);
});
await check('The canonical budget matches server normalization for escaped text and invalid choice IDs',()=>{
 const t={questions:[{id:'w',type:'written',answers:[]},{id:'c',answers:[{id:'yes'}]}]};
 assert.equal(C.answerStorageLength(t,{w:'Рядок\n"текст"\u0000',c:'unknown'}),JSON.stringify({w:'Рядок\n"текст"',c:'0'}).length);
});
await check('Written explanations use the same editor limit as choice explanations',()=>{
 const d=C.newDraft();d.title='Пояснення';d.questions=[{...C.blankQuestion(),type:'written',text:'Запитання',answers:[],explanation:'Ж'.repeat(2001)}];
 assert.match(C.validateDraft(d),/Пояснення/);
});
const report={testedAt:new Date().toISOString(),productionWrites:false,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,checks:results};
fs.writeFileSync(new URL('../verification/written-reliability.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.failed)process.exitCode=1;
import {createReviewPresence} from '../web/review-presence.js';
