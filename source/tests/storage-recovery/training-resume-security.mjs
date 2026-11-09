import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {audit,C,model,install,clone} from './support.mjs';
const {api,raw,check,finish}=audit('training-resume-security');
const teacher=model.instructorToken;
const group=api('POST','/api/instructor/groups',teacher,{name:'Захищене продовження тренування'}).group;
const people=[0,1].map(i=>api('POST','/api/register','',{username:'resume_security_'+i,fullName:'Курсант продовження '+i,groupId:group.id,...model.credential('synthetic-resume-password')}));
const questions=[{text:'Вибір',explanation:'PRIVATE_EXPLANATION',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]},{type:'written',text:'Поясніть',rubric:'PRIVATE_RUBRIC',maxPoints:3,answers:[]}];
function begun(){const test=api('POST','/api/instructor/tests',teacher,{title:'Перевірка дозволу '+crypto.randomUUID(),accessProtocol:1,questions}).test;api('POST','/api/instructor/tests/'+test.id+'/access',teacher,{expectedRevision:1,scope:'all',open:true});const value=api('POST','/api/tests/'+test.id+'/start',people[0].token,{submissionId:'pc-'+crypto.randomUUID()});api('POST','/api/instructor/tests/'+test.id+'/access',teacher,{expectedRevision:2,scope:'all',open:false});return value;}
const work=begun();const path='/api/tests/'+work.test.id+'/start';
const body={resumeProtocol:1,submissionId:work.submissionId,startPermit:work.startPermit};
await check('A valid existing permit resumes the same submission after closure without reissuing permission',()=>{
 const r=api('POST',path,people[0].token,body);assert.equal(r.trainingResumeProtocol,1);assert.equal(r.startPermit,work.startPermit);assert.equal(r.submissionId,work.submissionId);assert.ok(!/PRIVATE_|isCorrect|rubric|explanation/.test(JSON.stringify(r)));
});
await check('A closed test cannot be newly started by claiming the resume protocol',()=>{
 for(const extra of [{},{resumeProtocol:1},{resumeProtocol:1,userId:people[0].user.id,role:'instructor'}]){const r=raw('POST',path,people[1].token,{submissionId:'pc-'+crypto.randomUUID(),...extra});assert.equal(r.ok,false);assert.equal(r.code,'TEST_CLOSED');}
});
await check('A permit for another cadet, test or submission cannot reveal the test',()=>{
 const other=begun();
 for(const [p,token,b] of [[path,people[1].token,body],[path,people[0].token,{...body,submissionId:'pc-'+crypto.randomUUID()}],['/api/tests/'+other.test.id+'/start',people[0].token,body]]){const r=raw('POST',p,token,b);assert.equal(r.ok,false);assert.equal(r.code,'INVALID_START_PERMIT');assert.equal(r.test,undefined);}
});
await check('Malformed or forged permits fail closed',()=>{
 for(const permit of ['',null,123,{},work.startPermit+'x',work.startPermit.split('.')[0]+'.bad']){const r=raw('POST',path,people[0].token,{...body,startPermit:permit});assert.equal(r.ok,false);assert.equal(r.code,'INVALID_START_PERMIT');}
});
await check('Resume protocol negotiation cannot silently issue a new permit',()=>{
 const r=raw('POST',path,people[0].token,{...body,resumeProtocol:0});assert.equal(r.ok,false);assert.equal(r.code,'UPDATE_REQUIRED');
});
await check('An instructor or anonymous request cannot impersonate a cadet’s resumed work',()=>{
 for(const [token,expected] of [[teacher,'FORBIDDEN'],['','SESSION_EXPIRED']]){const r=raw('POST',path,token,body);assert.equal(r.ok,false);assert.equal(r.code,expected);}
});
await check('A deleted test remains unavailable even with an old signed permit',()=>{
 const w=begun();api('DELETE','/api/instructor/tests/'+w.test.id,teacher);const r=raw('POST','/api/tests/'+w.test.id+'/start',people[0].token,{resumeProtocol:1,submissionId:w.submissionId,startPermit:w.startPermit});assert.equal(r.ok,false);assert.equal(r.code,'TEST_NOT_FOUND');
});
await check('The resumed closed training can finish once and cannot be restarted afterward',()=>{
 const answers=[{questionId:work.test.questions[1].id,text:'Збережена відповідь після закриття'}];
 const result=api('POST','/api/results',people[0].token,{testId:work.test.id,submissionId:work.submissionId,startPermit:work.startPermit,writtenProtocol:1,choiceProtocol:2,answers}).result;
 const retry=api('POST','/api/results',people[0].token,{testId:work.test.id,submissionId:work.submissionId,startPermit:work.startPermit,writtenProtocol:1,choiceProtocol:2,answers}).result;assert.equal(retry.id,result.id);
 const r=raw('POST',path,people[0].token,body);assert.equal(r.ok,false);assert.equal(r.code,'ALREADY_COMPLETED');
});
await check('A local valid permit repairs a matching older cloud snapshot that omitted it',async()=>{
 const w=begun(),value={test:w.test,submissionId:w.submissionId,answers:{[w.test.questions[1].id]:'Місцева відповідь'},lastElapsed:18};const a={tests:[w.test],results:[],pending:[],run:{...clone(value),startPermit:w.startPermit}};
 const box=install({C,S:{session:{token:people[0].token,user:people[0].user}},page:'home',id:C.id,clock:{launchId:'repaired'},uptime:()=>60000,cloudRenderNeeded:false,rpc:async(m,p,b,t)=>api(m,p,t,b),fetchTest:async()=>{throw Error('A valid resumed permit must bypass a fresh download gate');}},['applyAccountDocument']);
 await box.applyAccountDocument('training',value,a);assert.equal(a.run.startPermit,w.startPermit);assert.equal(a.run.answers[w.test.questions[1].id],'Місцева відповідь');
});
await check('Failure to restore an unverifiable old snapshot preserves the current local work',async()=>{
 const w=begun(),current={test:{id:'local-sentinel',mode:'training'},submissionId:'local-sentinel',answers:{written:'Не стирати'}},a={tests:[w.test],results:[],pending:[],run:current};
 const box=install({C,S:{session:{token:people[0].token,user:people[0].user}},page:'home',id:C.id,clock:{launchId:'legacy'},uptime:()=>60000,cloudRenderNeeded:false,rpc:async(m,p,b,t)=>api(m,p,t,b),fetchTest:async id=>api('GET','/api/tests/'+id,people[0].token).test},['applyAccountDocument']);
 await assert.rejects(()=>box.applyAccountDocument('training',{test:w.test,submissionId:w.submissionId,answers:{}},a),e=>e.code==='TEST_CLOSED');assert.equal(a.run,current);
});
finish();
