import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
import {learningUnits} from '../web/learning.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,credential,instructorToken,spreadsheet,lock}=await import('./fixtures/server_model.mjs');
const checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const deny=(fn,code)=>assert.throws(fn,x=>x.code===code);
const props=context.PropertiesService.getScriptProperties();
const group=name=>api('POST','/api/instructor/groups',instructorToken,{name}).group;
const a=group('Новий набір А'),b=group('Новий набір Б');
const cadet=(name,g=a)=>api('POST','/api/register','',{fullName:name,username:'intake-'+crypto.randomUUID(),groupId:g.id,...credential('test-intake-password')});
const one=cadet('Курсант набору А'),two=cadet('Курсант набору Б',b),three=cadet('Курсант незавершеної роботи');
const draft=C.newDraft();Object.assign(draft,{title:'Постійний каталог',randomizeQuestions:false,randomizeAnswers:false});
Object.assign(draft.questions[0],{text:'Питання нового набору?',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]});
const make=(title,extra={})=>api('POST','/api/instructor/tests',instructorToken,{...C.draftAPI(draft,true),title,...extra}).test;
const training=make('Тренування до нового набору');
const policy=t=>api('GET','/api/instructor/tests/'+t.id+'/access',instructorToken).test.access;
function gate(t,open,scope='all',g=a){return api('POST','/api/instructor/tests/'+t.id+'/access',instructorToken,{expectedRevision:policy(t).revision,scope,groupId:String(g.id),open});}
const start=(t,user=one,submissionId='pc-'+crypto.randomUUID())=>api('POST','/api/tests/'+t.id+'/start',user.token,{submissionId});
const body=(t,started)=>C.submission({test:t,submissionId:started.submissionId,startPermit:started.startPermit,startedUptime:0,answers:{[t.questions[0].id]:t.questions[0].answers[0].id}},23000);
const snapshot=()=>JSON.stringify([...spreadsheet.sheets].map(([name,s])=>[name,s.rows]));

await check('New tests retain visible metadata while closed and expose no questions or grading keys',()=>{
 const visible=api('GET','/api/cadet/workspace',one.token).tests.find(t=>t.id===training.id);
 assert.equal(visible.access.open,false);assert.equal(visible.access.protocol,1);assert.ok(!visible.questions);assert.ok(!visible.access.groups);
 deny(()=>api('GET','/api/tests/'+training.id,one.token),'TEST_CLOSED');deny(()=>start(training),'TEST_CLOSED');
 assert.ok(api('GET','/api/tests/'+training.id,instructorToken).test.questions[0].answers[0].isCorrect);
 const unit=learningUnits([visible],[],{},[])[0];assert.equal(unit.canStart,false);assert.match(unit.status,/відкриття/);
});
await check('Only instructors may change a gate and revision conflicts preserve the current rules',()=>{
 deny(()=>api('POST','/api/instructor/tests/'+training.id+'/access',one.token,{expectedRevision:1,scope:'all',open:true}),'FORBIDDEN');
 deny(()=>api('GET','/api/instructor/tests/'+training.id+'/access',''),'SESSION_EXPIRED');
 gate(training,true,'group',a);assert.equal(policy(training).defaultOpen,false);
 assert.equal(api('GET','/api/tests',one.token).tests.find(t=>t.id===training.id).access.open,true);
 assert.equal(api('GET','/api/tests',two.token).tests.find(t=>t.id===training.id).access.open,false);
 deny(()=>start(training,two),'TEST_CLOSED');
 deny(()=>api('POST','/api/instructor/tests/'+training.id+'/access',instructorToken,{expectedRevision:1,scope:'all',open:true}),'REVISION_CONFLICT');
 assert.equal(policy(training).defaultOpen,false);
});
await check('Global opening resets group overrides and closing one group leaves the others available',()=>{
 gate(training,true);assert.deepEqual(policy(training).groups,{});gate(training,false,'group',b);
 assert.equal(api('GET','/api/tests',one.token).tests.find(t=>t.id===training.id).access.open,true);
 assert.equal(api('GET','/api/tests',two.token).tests.find(t=>t.id===training.id).access.open,false);
});
let begun;
await check('A signed start is tied to one cadet, test and stable submission key',()=>{
 begun=start(training);assert.ok(begun.startPermit.includes('.'));assert.ok(!begun.test.questions[0].answers[0].isCorrect);
 deny(()=>api('POST','/api/results',two.token,body(training,begun)),'INVALID_START_PERMIT');
 deny(()=>api('POST','/api/results',one.token,{...body(training,begun),submissionId:'different'}),'INVALID_START_PERMIT');
 deny(()=>api('POST','/api/results',one.token,{...body(training,begun),startPermit:begun.startPermit+'x'}),'INVALID_START_PERMIT');
 const another=make('Інший тест');gate(another,true);
 deny(()=>api('POST','/api/results',one.token,{...body(another,begun),testId:another.id}),'INVALID_START_PERMIT');
});
await check('Closing a test blocks cached new starts while an already started training can finish once',()=>{
 gate(training,false);deny(()=>start(training,three),'TEST_CLOSED');
 const legacy={...body(training,begun)};delete legacy.startPermit;
 deny(()=>api('POST','/api/results',three.token,legacy),'TEST_CLOSED');
 api('POST','/api/account-state/document',one.token,{key:'training',expectedRevision:0,requestId:crypto.randomUUID(),value:{test:begun.test,answers:{},submissionId:begun.submissionId,startPermit:begun.startPermit}});
 const accepted=api('POST','/api/results',one.token,body(training,begun));assert.equal(accepted.result.score,100);
 assert.equal(api('POST','/api/results',one.token,body(training,begun)).result.id,accepted.result.id);
 deny(()=>api('POST','/api/results',one.token,{...body(training,begun),submissionId:'pc-another-finished'}),'ALREADY_COMPLETED');
});
await check('Old clients cannot submit an unconfirmed training after its access becomes managed',()=>{
 gate(training,true);
 deny(()=>api('POST','/api/results',three.token,{...body(training,begun),startPermit:undefined,submissionId:'legacy-cached-attempt'}),'UPDATE_REQUIRED');
 gate(training,false);
});
await check('Archived groups and assignments cannot be bypassed by an all-groups gate',()=>{
 const assigned=make('Лише група А',{description:C.draftAPI({...draft,assignedGroups:[a.name]},true).description});gate(assigned,true);
 deny(()=>api('POST','/api/instructor/tests/'+assigned.id+'/access',instructorToken,{expectedRevision:policy(assigned).revision,scope:'group',groupId:b.id,open:true}),'BAD_GROUP_ASSIGNMENT');
 deny(()=>start(assigned,two),'FORBIDDEN');
 api('POST','/api/instructor/groups/'+b.id+'/archive',instructorToken,{archived:true,expectedRevision:1});
 gate(training,true);deny(()=>start(training,two),'TEST_CLOSED');
 api('POST','/api/instructor/groups/'+b.id+'/archive',instructorToken,{archived:false,expectedRevision:2});
});
await check('Corrupt or duplicated access rows fail closed and failed creation does not publish an open test',()=>{
 const sheet=spreadsheet.getSheetByName('_Доступ_до_тестів'),row=sheet.rows.find(r=>String(r[0])===String(training.id)),saved=row[2];
 row[2]='broken';deny(()=>start(training,three),'ACCESS_STATE_ERROR');row[2]=saved;
 const duplicate=[...row];sheet.appendRow(duplicate);try{deny(()=>start(training,three),'ACCESS_STATE_ERROR');}finally{sheet.rows.pop();}
 const count=context.listTests_(false).length,original=sheet.appendRow;sheet.appendRow=()=>{throw Error('Injected gate write failure');};
 try{assert.throws(()=>make('Неопублікований через помилку'),/gate write failure/);assert.equal(context.listTests_(false).length,count);}finally{sheet.appendRow=original;}
});
await check('Existing exams can finish after closing while new cadets cannot start them',()=>{
 const exam=make('Іспит із закриттям',{mode:'exam',durationMinutes:20}),deviceId='intake-exam-device',requestId=crypto.randomUUID();
 deny(()=>api('POST','/api/exam-session/start',two.token,{testId:exam.id,deviceId,requestId}),'TEST_CLOSED');
 gate(exam,true);const opened=api('POST','/api/exam-session/start',two.token,{testId:exam.id,deviceId,requestId});gate(exam,false);
 deny(()=>api('POST','/api/exam-session/start',three.token,{testId:exam.id,deviceId,requestId:crypto.randomUUID()}),'TEST_CLOSED');
 const value=opened.document.value;
 const finished=api('POST','/api/exam-session/finish',two.token,{deviceId,requestId:crypto.randomUUID(),submissionId:value.submissionId,fence:value.fence,expectedRevision:opened.document.revision,checkpoint:{answers:{[exam.questions[0].id]:exam.questions[0].answers[0].id},index:0,exitCount:0}});
 assert.equal(finished.completion.result.score,100);
});

const instructorBefore=api('GET','/api/instructor/instructors',instructorToken).instructors;
const second=api('POST','/api/instructor/register','',{fullName:'Інструктор продовження',username:'intake-resumer',inviteCode:api('POST','/api/instructor/invite',instructorToken).code,...credential('test-instructor-intake')});
const preservedDraft={...C.newDraft(),title:'Залишити чернетку інструктора'};
api('POST','/api/account-state/document',instructorToken,{key:'test-draft',expectedRevision:0,requestId:crypto.randomUUID(),value:preservedDraft});
const gradingKey='grading:'+api('GET','/api/my-results',two.token).results[0].id;
api('POST','/api/account-state/document',instructorToken,{key:gradingKey,expectedRevision:0,requestId:crypto.randomUUID(),value:{revision:0,items:{}}});
const sharedBefore=context.listTests_(false).filter(t=>!C.marker(t.description,'RETRY')).map(t=>({id:t.id,questions:context.getTestById_(t.id).questions}));
const groupsBefore=api('GET','/api/groups').groups,bankBefore=api('GET','/api/instructor/question-bank',instructorToken).questions;
const preview=()=>api('GET','/api/instructor/intake',instructorToken);
const resetBody=p=>({requestId:crypto.randomUUID(),previewToken:p.previewToken,confirmation:'НОВИЙ НАБІР'});
await check('Corrupt access rules stop the preview before any cadet can be locked or removed',()=>{
 const sheet=spreadsheet.getSheetByName('_Доступ_до_тестів'),row=sheet.rows.find(r=>String(r[0])===String(training.id)),saved=row[2];row[2]='broken';
 try{deny(()=>preview(),'ACCESS_STATE_ERROR');assert.equal(props.getProperty('LK_INTAKE_ACTIVE'),null);assert.ok(context.findUserById_(one.user.id));}finally{row[2]=saved;}
});
await check('Cleanup preview is read-only and requires a signed current review plus the exact confirmation',()=>{
 const before=snapshot(),p=preview();assert.equal(snapshot(),before);assert.ok(p.preview.cadets>0&&p.preview.results>0&&p.preview.tests>0);
 deny(()=>api('GET','/api/instructor/intake',one.token),'FORBIDDEN');
 deny(()=>api('POST','/api/instructor/intake/start',instructorToken,{...resetBody(p),confirmation:'так'}),'CONFIRMATION_REQUIRED');
 deny(()=>api('POST','/api/instructor/intake/start',instructorToken,{...resetBody(p),previewToken:p.previewToken+'x'}),'INVALID_PREVIEW');
 assert.equal(snapshot(),before);
});
await check('New registrations invalidate an older preview instead of silently adding people to the deletion',()=>{
 const p=preview();cadet('Зареєстрований після попереднього перегляду');
 deny(()=>api('POST','/api/instructor/intake/start',instructorToken,resetBody(p)),'REVISION_CONFLICT');
 assert.equal(props.getProperty('LK_INTAKE_ACTIVE'),null);
});
let job,request;
await check('Beginning cleanup is idempotent, revokes cadet access and pauses registration and other mutations',()=>{
 request=resetBody(preview());job=api('POST','/api/instructor/intake/start',instructorToken,request).intake;
 assert.equal(job.phase,0);assert.equal(api('POST','/api/instructor/intake/start',instructorToken,request).intake.id,job.id);
 deny(()=>api('GET','/api/my-results',one.token),'SESSION_EXPIRED');
 deny(()=>cadet('Не повинен реєструватися під час очищення'),'INTAKE_IN_PROGRESS');
 deny(()=>make('Не повинен публікуватися під час очищення'),'INTAKE_IN_PROGRESS');
 assert.equal(preview().intake.id,job.id);
});
await check('Cleanup mutations require the existing short script lock',()=>{
 const saved=lock.tryLock;lock.tryLock=()=>false;try{deny(()=>api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}),'BUSY');}finally{lock.tryLock=saved;}
 assert.equal(preview().intake.phase,0);
});
await check('A transient spreadsheet failure retains the exact cleanup step for another instructor to resume',()=>{
 job=api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}).intake;assert.equal(job.phase,0);assert.ok(job.archive?.sha256);
 job=api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}).intake;assert.equal(job.phase,1);
 const publicBook=context.publicResultsSpreadsheet_(false),sheet=publicBook.getSheetByName('Результати курсантів'),saved=sheet.deleteRows;
 sheet.deleteRows=()=>{throw Error('Injected interrupted public cleanup');};
 try{assert.throws(()=>api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}),/interrupted public cleanup/);assert.equal(preview().intake.phase,1);}finally{sheet.deleteRows=saved;}
 job=api('POST','/api/instructor/intake/continue',second.token,{jobId:job.id}).intake;assert.equal(job.phase,2);
});
await check('Resumable cleanup removes all cadets and attempts while preserving instructors, groups and questions',()=>{
 let calls=0;while(job.state!=='completed'){assert.ok(++calls<200);job=api('POST','/api/instructor/intake/continue',second.token,{jobId:job.id}).intake;}
 assert.equal(props.getProperty('LK_INTAKE_ACTIVE'),null);assert.equal(props.getProperty('LK_INTAKE_GENERATION'),job.id);
 assert.equal(context.listUsers_().filter(u=>u.role==='cadet').length,0);assert.equal(context.listUsers_().filter(u=>u.role==='instructor').length,instructorBefore.length+1);
 for(const name of ['_Результати_дані','_Результати','_Деталі_відповідей','_Повторні_спроби','_Перегляди_матеріалів','_Відновлення_іспитів'])assert.equal(spreadsheet.getSheetByName(name).getLastRow(),1,name);
 assert.equal(context.publicResultsSpreadsheet_(false).getSheetByName('Результати курсантів').getLastRow(),1);
 for(const original of sharedBefore){const t=context.getTestById_(original.id);assert.ok(t);assert.deepEqual(t.questions,original.questions);if(!context.isArchivedTest_(t))assert.equal(policy(t).defaultOpen,false);}
 assert.deepEqual(api('GET','/api/groups').groups,groupsBefore);assert.deepEqual(api('GET','/api/instructor/question-bank',instructorToken).questions,bankBefore);
 assert.equal(api('GET','/api/account-state/document',instructorToken,{key:'test-draft'}).document.value.title,preservedDraft.title);
 assert.equal(api('GET','/api/account-state',instructorToken).documents.some(d=>d.key.startsWith('grading:')),false);
 deny(()=>api('POST','/api/account-state/document',instructorToken,{key:gradingKey,expectedRevision:0,requestId:crypto.randomUUID(),value:{revision:0,items:{}}}),'REVIEW_UNAVAILABLE');
});
await check('Lost completion replies and repeated cleanup requests cannot erase the next intake',()=>{
 assert.equal(api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}).intake.state,'completed');
 const fresh=cadet('Новий курсант після очищення');assert.notEqual(String(fresh.user.id),String(one.user.id));
 assert.equal(api('POST','/api/instructor/intake/start',instructorToken,request).intake.state,'completed');
 assert.ok(context.findUserById_(fresh.user.id));deny(()=>api('GET','/api/my-results',one.token),'SESSION_EXPIRED');
 assert.equal(api('GET','/api/tests',fresh.token).tests.find(t=>t.id===training.id).access.open,false);
 assert.equal(api('GET','/api/my-results',fresh.token).results.length,0);gate(training,true,'group',a);assert.ok(start(training,fresh).startPermit);
});
fs.writeFileSync(new URL('../verification/test-access-intake.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,liveAccountsModified:false},null,2));
console.log(JSON.stringify({status:'passed',passed:checks.length,liveAccountsModified:false}));
