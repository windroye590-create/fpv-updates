import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
const {api,context,credential,instructorToken}=await import('./fixtures/server_model.mjs');
const checks=[];
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Захист і відновлення'}).group;
const password='synthetic-recovery-password';
const register=name=>api('POST','/api/register','',{username:name,fullName:'Тестовий '+name,groupId:group.id,...credential(password)});
const cadet=register('auth_recovery'),other=register('auth_other');
let now=Date.now();context.Date=class extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
const challenge=(username,groupName=group.name)=>api('POST','/api/challenge','',{username,groupName});
const badLogin=(username,groupName=group.name)=>{const c=challenge(username,groupName);return api('POST','/api/login','',{username,groupName,nonce:c.nonce,proof:'invalid-proof'});};
const code=(run,expected)=>assert.throws(run,x=>x.code===expected);
await check('Known and missing account salts are stable across case and group variations',()=>{
 for(const name of ['auth_recovery','WindRoy','missing_auth_account']){
  const salt=challenge(name,'').salt;
  for(const groupName of ['',group.name,'wrong group'])assert.equal(challenge(name.toUpperCase(),groupName).salt,salt);
 }
});
await check('Wrong proofs do not reveal whether an account is disabled',()=>{
 api('POST','/api/instructor/users/'+cadet.user.id+'/status',instructorToken,{active:false});
 code(()=>badLogin('auth_recovery'),'INVALID_CREDENTIALS');code(()=>badLogin('missing_auth_account'),'INVALID_CREDENTIALS');
});
await check('Only a correct password reveals disabled status',async()=>{
 await assert.rejects(()=>C.signIn('auth_recovery',password,group.name,(p,b)=>api('POST',p,'',b)),x=>x.code==='USER_DISABLED');
 api('POST','/api/instructor/users/'+cadet.user.id+'/status',instructorToken,{active:true});
});
await check('Successful desktop authentication still works and resets the counter',async()=>{
 const reply=await C.signIn('auth_recovery',password,group.name,(p,b)=>api('POST',p,'',b));assert.equal(reply.user.id,cadet.user.id);cadet.token=reply.token;
});
await check('Eight wrong proofs cause a temporary account-specific throttle',()=>{
 for(let i=0;i<8;i++)code(()=>badLogin('auth_recovery'),'INVALID_CREDENTIALS');
 code(()=>badLogin('AUTH_RECOVERY','different group'),'LOGIN_THROTTLED');
 code(()=>badLogin('auth_other'),'INVALID_CREDENTIALS');
});
await check('Discarding the challenge cache does not clear the throttle',()=>{
 context.CacheService.getScriptCache().values.clear();code(()=>badLogin('auth_recovery'),'LOGIN_THROTTLED');
});
await check('Throttle expires and a correct password restores access',async()=>{
 now+=61000;const reply=await C.signIn('auth_recovery',password,group.name,(p,b)=>api('POST',p,'',b));assert.equal(reply.user.id,cadet.user.id);cadet.token=reply.token;
});
await check('A challenge is consumed once and is bound to its original group',async()=>{
 const c=challenge('auth_recovery');const proof=await C.proof(password,c.salt,c.nonce);
 code(()=>api('POST','/api/login','',{username:'auth_recovery',groupName:'other',nonce:c.nonce,proof}),'INVALID_CREDENTIALS');
 code(()=>api('POST','/api/login','',{username:'auth_recovery',groupName:group.name,nonce:c.nonce,proof}),'CHALLENGE_EXPIRED');
});
await check('Twenty-seven independent cadets can authenticate without a shared failure bucket',async()=>{
 const people=Array.from({length:27},(_,i)=>register('auth_class_'+i));
 const replies=await Promise.all(people.map(p=>C.signIn(p.user.username,password,group.name,(path,body)=>api('POST',path,'',body))));
 assert.equal(new Set(replies.map(r=>String(r.user.id))).size,27);
});
const question={text:'Оберіть правильне',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]};
const makeTest=(title,mixed=false)=>api('POST','/api/instructor/tests',instructorToken,{title,mode:'exam',durationMinutes:1,questions:mixed?[question,{type:'written',text:'Поясніть',maxPoints:3,rubric:'Таємний критерій',answers:[]}]:[question]}).test;
const bodyFor=test=>({testId:test.id,submissionId:'old-'+crypto.randomUUID(),writtenProtocol:1,choiceProtocol:2,durationSeconds:45,answers:test.questions.map(q=>C.isWritten(q)?{questionId:q.id,text:'Збережена письмова відповідь'}:{questionId:q.id,answerId:q.answers[0].id})});
const test=makeTest('Відновлення старої роботи',true),body=bodyFor(test);
let receipt;
await check('A direct exam result remains blocked and recovery returns no score or answer key',()=>{
 code(()=>api('POST','/api/results',cadet.token,body),'EXAM_SESSION_REQUIRED');
 const reply=api('POST','/api/exam-recoveries',cadet.token,body);receipt=reply.recovery;
 C.validateRecovery(receipt,cadet.user.id,test.id,body.submissionId);
 assert.equal(reply.result,undefined);assert.equal(reply.review,undefined);assert.equal(receipt.status,'pending');
 assert.equal(api('GET','/api/my-results',cadet.token).results.filter(r=>r.testId===test.id).length,0);
});
await check('Lost acknowledgements create one immutable recovery and preserve written answers',()=>{
 const again=api('POST','/api/exam-recoveries',cadet.token,body).recovery;assert.equal(again.id,receipt.id);
 const record=context.examRecoveryRecord_(receipt.id);assert.equal(JSON.parse(record.row[8])[test.questions[1].id],'Збережена письмова відповідь');
 const changed=structuredClone(body);changed.answers[0].answerId=test.questions[0].answers[1].id;
 code(()=>api('POST','/api/exam-recoveries',cadet.token,changed),'REQUEST_CONFLICT');
});
await check('Cadets cannot read or approve other people’s recoveries',()=>{
 assert.equal(api('GET','/api/exam-recoveries',other.token).recoveries.length,0);
 code(()=>api('GET','/api/instructor/exam-recoveries/'+receipt.id,cadet.token),'FORBIDDEN');
 code(()=>api('POST','/api/instructor/exam-recoveries/'+receipt.id+'/approve',cadet.token,{confirmTimeUnverified:true}),'FORBIDDEN');
});
await check('A pending old exam cannot be started again or injected as a new timed attempt',()=>{
 const request={testId:test.id,deviceId:crypto.randomUUID(),requestId:crypto.randomUUID()};
 code(()=>api('POST','/api/exam-session/start',cadet.token,request),'EXAM_RECOVERY_PENDING');
 code(()=>api('POST','/api/exam-session/start',other.token,{...request,legacy:{answers:{},index:0,lastElapsed:0}}),'EXAM_RECOVERY_REQUIRED');
});
let accepted;
await check('An instructor sees the preserved answers and must explicitly confirm the unverified time',()=>{
 const review=api('GET','/api/instructor/exam-recoveries/'+receipt.id,instructorToken);assert.equal(review.review[1].text,'Збережена письмова відповідь');
 code(()=>api('POST','/api/instructor/exam-recoveries/'+receipt.id+'/approve',instructorToken,{}),'CONFIRMATION_REQUIRED');
 accepted=api('POST','/api/instructor/exam-recoveries/'+receipt.id+'/approve',instructorToken,{confirmTimeUnverified:true});
 assert.equal(accepted.result.examRecovered,true);assert.ok(accepted.result.recoveredBy);assert.equal(accepted.result.gradingStatus,'pending_review');
});
await check('Repeated confirmation does not duplicate the result or change its approval author',()=>{
 const invite=api('POST','/api/instructor/invite',instructorToken).code;
 const second=api('POST','/api/instructor/register','',{username:'auth_second_teacher',fullName:'Інший інструктор',inviteCode:invite,...credential(password)});
 const retry=api('POST','/api/instructor/exam-recoveries/'+receipt.id+'/approve',second.token,{confirmTimeUnverified:true});
 assert.equal(retry.result.id,accepted.result.id);assert.equal(retry.result.recoveredBy,accepted.result.recoveredBy);
 assert.equal(api('GET','/api/my-results',cadet.token).results.filter(r=>String(r.testId)===String(test.id)).length,1);
 assert.equal(api('GET','/api/instructor/exam-recoveries',instructorToken).recoveries.some(x=>x.id===receipt.id),false);
});
await check('Written grading preserves recovery provenance in result summaries',()=>{
 const done=api('POST','/api/instructor/results/'+accepted.result.id+'/grade',instructorToken,{expectedRevision:0,requestId:crypto.randomUUID(),grades:[{questionId:test.questions[1].id,points:3,comment:'Перевірено'}]});
 assert.equal(done.result.score,100);assert.equal(done.result.examRecovered,true);
 const list=api('GET','/api/my-results',cadet.token).results.find(x=>x.id===done.result.id);assert.equal(list.recoveredBy,accepted.result.recoveredBy);
});
await check('A result committed before a failed recovery acknowledgement is confirmed once on retry',()=>{
 const t=makeTest('Перерване підтвердження'),b=bodyFor(t),v=api('POST','/api/exam-recoveries',other.token,b).recovery;
 const sheet=context.sheet_('examRecoveries'),get=sheet.getRange;let fail=true;
 sheet.getRange=function(...args){const range=get.apply(this,args);if(args[1]===13&&fail){range.setValues=()=>{fail=false;throw Error('Injected receipt failure');};}return range;};
 try{code(()=>api('POST','/api/instructor/exam-recoveries/'+v.id+'/approve',instructorToken,{confirmTimeUnverified:true}),'SERVER_ERROR');}finally{sheet.getRange=get;}
 api('POST','/api/instructor/exam-recoveries/'+v.id+'/approve',instructorToken,{confirmTimeUnverified:true});
 assert.equal(api('GET','/api/my-results',other.token).results.filter(x=>String(x.testId)===String(t.id)).length,1);
});
const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
function appFunction(name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0);const next=source.slice(start+1).search(/\n(?:async )?function /);return next<0?source.slice(start):source.slice(start,start+1+next);}
await check('The actual PC queue transfers an old exam and survives a failed local save',async()=>{
 const t=makeTest('Стара черга ПК'),b=bodyFor(t),a={pending:[{body:b,testTitle:t.title,attempts:0,nextAt:0}],fullTests:{},results:[],reviews:{},examRecoveries:[]};let diskFails=true;
 const box=vm.createContext({C,S:{session:{token:cadet.token,user:cadet.user}},account:()=>a,user:()=>cadet.user,instructor:()=>false,alive:()=>true,updateApplying:false,syncing:false,page:'more',lastError:'',id:C.id,rpc:async(m,p,body,token)=>api(m,p,token,body),persist:async()=>{if(diskFails){diskFails=false;throw Object.assign(Error('disk failed'),{localSave:true});}},render:()=>{}});
 vm.runInContext(appFunction('syncQueue'),box);await box.syncQueue(true);assert.equal(a.pending.length,1);await box.syncQueue(true);
 assert.equal(a.pending.length,0);assert.equal(a.examRecoveries.length,1);assert.equal(a.examRecoveries[0].status,'pending');
 const remote=api('GET','/api/exam-recoveries',cadet.token).recoveries.filter(x=>String(x.testId)===String(t.id));assert.equal(remote.length,1);
});
await check('The actual instructor dialog explains the time limitation and confirms the selected work',async()=>{
 const t=makeTest('Робота для діалогу'),b=bodyFor(t),receipt=api('POST','/api/exam-recoveries',other.token,b).recovery;
 let confirm,html='',label='',posts=0;const account={results:[]},S={session:{token:instructorToken}};
 const box=vm.createContext({C,S,e:C.esc,id:C.id,time:n=>String(n),account:()=>account,persist:async()=>{},loadReviewQueue:async()=>{},toast:()=>{},writtenReview:q=>C.esc(q.text),choiceReview:q=>C.esc(q.questionText),dialog:(title,body,action,button)=>{html=body;confirm=action;label=button;},rpc:async(m,p,body={},token)=>{if(m==='POST')posts++;return api(m,p,token||S.session.token,body);}});
 vm.runInContext(appFunction('openExamRecovery'),box);await box.openExamRecovery(receipt.id);
 assert.match(html,/Серверний таймер його не перевіряв/);assert.equal(label,'Підтвердити роботу');assert.equal(posts,0);
 await confirm();assert.equal(posts,1);assert.equal(account.results[0].examRecovered,true);
});
await check('Switching accounts cancels a pending instructor confirmation',async()=>{
 const t=makeTest('Підтвердження після зміни акаунта'),receipt=api('POST','/api/exam-recoveries',other.token,bodyFor(t)).recovery;
 let confirm,posts=0;const S={session:{token:instructorToken}};
 const box=vm.createContext({C,S,e:C.esc,id:C.id,time:n=>String(n),account:()=>({results:[]}),persist:async()=>{},loadReviewQueue:async()=>{},toast:()=>{},writtenReview:()=>'',choiceReview:()=>'',dialog:(title,body,action)=>confirm=action,rpc:async(m,p,body={},token)=>{if(m==='POST')posts++;return api(m,p,token||S.session.token,body);}});
 vm.runInContext(appFunction('openExamRecovery'),box);await box.openExamRecovery(receipt.id);S.session={token:'different-account'};
 assert.equal(await confirm(),false);assert.equal(posts,0);
});
await check('A recovery cannot replace a live server-timed attempt',()=>{
 const t=makeTest('Активний іспит');api('POST','/api/exam-session/start',other.token,{testId:t.id,deviceId:crypto.randomUUID(),requestId:crypto.randomUUID()});
 code(()=>api('POST','/api/exam-recoveries',other.token,bodyFor(t)),'EXAM_ACTIVE');
});
await check('Full cadet deletion also erases their recovery answers',()=>{
 api('DELETE','/api/instructor/users/'+cadet.user.id,instructorToken,{confirmUserId:String(cadet.user.id)});
 assert.equal(context.dataRows_('examRecoveries').some(row=>String(row[1])===String(cadet.user.id)),false);
});
await check('Legacy update properties cannot advertise an obsolete app version',()=>{
 context.setAppDownloadUrl('',1,'0.0.0');
 const expected=api('GET','/api/app-info').latestVersionName;
 const props=context.PropertiesService.getScriptProperties();props.setProperty('APP_DOWNLOAD_VERSION_CODE','900');props.setProperty('APP_DOWNLOAD_VERSION_NAME','3.2.3');
 context.setAppDownloadUrl('',133,C.APP_VERSION);const info=api('GET','/api/app-info');assert.equal(info.latestVersionName,expected);assert.equal(info.platform,'windows-x64');
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/auth-recovery.json',import.meta.url),JSON.stringify({passed:checks.length,checks,productionVerified:false,backend:'actual Code.gs with isolated Sheets services',client:'actual PC proof and result queue'},null,2));
console.log('Authentication and exam recovery: '+checks.length+' checks passed.');
