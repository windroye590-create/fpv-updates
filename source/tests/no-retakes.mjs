// Real client and Code.gs logic; isolated synthetic Sheets only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken,spreadsheet,regressionTest,regressionBody,seedLegacyRetry}=await import('./fixtures/server_model.mjs');
const checks=[];
function check(name,run){run();checks.push(name);console.log('PASS '+name);}
function rejected(run,code){assert.throws(run,e=>e.code===code);}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Одна спроба — перевірка'}).group;
const cadet=api('POST','/api/register','',{fullName:'Курсант Однієї Спроби',username:'no_retakes',groupId:group.id,...credential('OneAttempt-2026!')});
const test=regressionTest('Незмінний результат');
const body=regressionBody(test,'single-attempt-first');
body.answers.forEach(a=>{a.answerId='0';});
const completion=api('POST','/api/results',cadet.token,body);
check('A failed test still consumes the only completed attempt',()=>{
 assert.equal(completion.result.passed,false);
 rejected(()=>api('POST','/api/results',cadet.token,{...body,submissionId:'single-attempt-second'}),'ALREADY_COMPLETED');
});
check('The same delivery acknowledgement remains idempotent',()=>{
 const again=api('POST','/api/results',cadet.token,body);
 assert.equal(again.result.id,completion.result.id);assert.equal(again.alreadyAccepted,true);
 assert.equal(api('GET','/api/my-results',cadet.token).results.filter(r=>r.testId===test.id).length,1);
});
check('A new training start on another PC cannot bypass completion',()=>{
 rejected(()=>api('POST','/api/tests/'+test.id+'/start',cadet.token,{submissionId:'pc-another-device-2026'}),'ALREADY_COMPLETED');
});
check('Instructor grants are disabled without creating or editing any tests',()=>{
 const before=JSON.stringify(spreadsheet.getSheetByName('_Тести').rows);
 const links=JSON.stringify(spreadsheet.getSheetByName('_Повторні_спроби').rows);
 for(let i=0;i<2;i++)rejected(()=>api('POST','/api/instructor/results/'+completion.result.id+'/retry',instructorToken),'RETAKES_DISABLED');
 assert.equal(JSON.stringify(spreadsheet.getSheetByName('_Тести').rows),before);
 assert.equal(JSON.stringify(spreadsheet.getSheetByName('_Повторні_спроби').rows),links);
});
check('Cadets and anonymous callers cannot grant retries',()=>{
 rejected(()=>api('POST','/api/instructor/results/'+completion.result.id+'/retry',cadet.token),'FORBIDDEN');
 rejected(()=>api('POST','/api/instructor/results/'+completion.result.id+'/retry',''),'SESSION_EXPIRED');
});
const legacy=seedLegacyRetry(test,cadet.user.id,completion.result.id);
check('Previously granted repeats are excluded from both catalogs and dashboards',()=>{
 for(const token of [cadet.token,instructorToken])assert.ok(!api('GET','/api/tests',token).tests.some(t=>String(t.id)===String(legacy.id)));
 assert.equal(api('GET','/api/instructor/dashboard',instructorToken).retries.length,0);
});
check('A direct legacy-test URL and a raw result submission are blocked',()=>{
 rejected(()=>api('GET','/api/tests/'+legacy.id,cadet.token),'RETAKES_DISABLED');
 rejected(()=>api('POST','/api/results',cadet.token,regressionBody(legacy,'legacy-forged-submit')),'RETAKES_DISABLED');
});
check('An old cached repeat cannot be started',()=>{
 rejected(()=>api('POST','/api/tests/'+legacy.id+'/start',cadet.token,{submissionId:'pc-legacy-cached-2026'}),'RETAKES_DISABLED');
});
check('Editing or importing a legacy repeat cannot create a new attempt',()=>{
 rejected(()=>api('POST','/api/instructor/tests/'+legacy.id+'/replace',instructorToken,{...legacy,description:''}),'RETAKES_DISABLED');
 rejected(()=>api('POST','/api/instructor/tests',instructorToken,{...legacy,id:0}),'RETAKES_DISABLED');
 rejected(()=>api('POST','/api/instructor/tests',instructorToken,{...test,id:0,retryUserId:String(cadet.user.id)}),'RETAKES_DISABLED');
});
check('Client imports, old persisted drafts and direct export reject retry metadata',()=>{
 assert.throws(()=>C.draftFrom(legacy),/Повторне проходження/);
 const draft={...C.newDraft(),title:'Стара чернетка',retryUserId:String(cadet.user.id)};
 assert.match(C.validateDraft(draft),/Повторне проходження/);
 assert.throws(()=>C.draftAPI(draft),/Повторне проходження/);
 assert.equal(Object.hasOwn(C.newDraft(),'retryUserId'),false);
});
check('Empty legacy recipient markers cannot turn a hidden repeat into a shared test',()=>{
 const malformed={...test,description:'[[LK-RETRY:]]'};
 assert.equal(C.cadetTests([malformed,test]).length,1);
 assert.throws(()=>C.draftFrom(malformed),/Повторне проходження/);
 rejected(()=>api('POST','/api/instructor/tests',instructorToken,malformed),'RETAKES_DISABLED');
});
const historic=seedLegacyRetry(test,cadet.user.id,completion.result.id,cadet.token);
check('Historical retry results and answer reviews remain available',()=>{
 const saved=api('GET','/api/my-results',cadet.token).results.find(r=>String(r.testId)===String(historic.id));
 assert.ok(saved);
 const replay=api('POST','/api/results',cadet.token,{...regressionBody(historic,'historical-'+historic.id)});
 assert.equal(replay.result.id,saved.id);assert.equal(replay.alreadyAccepted,true);assert.ok(replay.review.length);
});
const resumable=regressionTest('Продовження тієї самої роботи');
const first=api('POST','/api/tests/'+resumable.id+'/start',cadet.token,{submissionId:'pc-one-resumable-2026'});
check('A normal unfinished training resumes with the original attempt permit',()=>{
 const resumed=api('POST','/api/tests/'+resumable.id+'/start',cadet.token,{submissionId:first.submissionId,startPermit:first.startPermit,resumeProtocol:1});
 assert.equal(resumed.startPermit,first.startPermit);assert.equal(resumed.submissionId,first.submissionId);
 const sent=api('POST','/api/results',cadet.token,{...regressionBody(resumable,first.submissionId),startPermit:first.startPermit});
 assert.ok(sent.result.id);
});
const exam=api('POST','/api/instructor/tests',instructorToken,{...test,title:'Іспит — одна спроба',mode:'exam',durationMinutes:10}).test;
const device={deviceId:'single-exam-device',requestId:'single-exam-start',testId:exam.id};
const started=api('POST','/api/exam-session/start',cadet.token,device);
check('An interrupted normal exam retains the original submission and deadline',()=>{
 const repeated=api('POST','/api/exam-session/start',cadet.token,{...device,requestId:'single-exam-resume'});
 assert.equal(repeated.document.value.submissionId,started.document.value.submissionId);
 assert.equal(repeated.document.value.deadline,started.document.value.deadline);
});
const v=started.document.value;
const finished=api('POST','/api/exam-session/finish',cadet.token,{...device,requestId:'single-exam-finish',submissionId:v.submissionId,fence:v.fence,expectedRevision:started.document.revision,checkpoint:{answers:{},index:0,exitCount:0}});
check('A completed exam cannot be restarted after failure',()=>{
 assert.equal(finished.completion.result.passed,false);
 rejected(()=>api('POST','/api/exam-session/start',cadet.token,{...device,requestId:'single-exam-new'}),'ALREADY_COMPLETED');
});
fs.mkdirSync(new URL('../verification',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/no-retakes.json',import.meta.url),JSON.stringify({passed:checks.length,checks,productionDataWrites:0},null,2)+'\n');
console.log('Single-attempt policy: '+checks.length+' checks passed.');
