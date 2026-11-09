import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {audit,C,model,clone} from './support.mjs';
const {api,raw,check,finish,requests}=audit('access-matrix');
const teacher=model.instructorToken;
const groups=['A','B'].map(n=>api('POST','/api/instructor/groups',teacher,{name:'Аудит доступу '+n}).group);
const people=groups.map((g,i)=>api('POST','/api/register','',{username:'audit_access_'+i,fullName:'Синтетичний курсант '+i,groupId:g.id,...model.credential('synthetic-access-password')}));
const question=[{text:'Питання',explanation:'SECRET_CHOICE_EXPLANATION',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]},{type:'written',text:'Письмова відповідь',rubric:'SECRET_RUBRIC',explanation:'SECRET_WRITTEN_EXPLANATION',maxPoints:5,answers:[]}];
const t=api('POST','/api/instructor/tests',teacher,{title:'Аудит ключів',mode:'training',questions:question,accessProtocol:1}).test;
api('POST','/api/instructor/tests/'+t.id+'/access',teacher,{expectedRevision:1,scope:'all',open:true});
const run=api('POST','/api/tests/'+t.id+'/start',people[1].token,{submissionId:'pc-'+crypto.randomUUID()});
const result=api('POST','/api/results',people[1].token,{testId:t.id,submissionId:run.submissionId,startPermit:run.startPermit,writtenProtocol:1,choiceProtocol:2,answers:[{questionId:t.questions[1].id,text:'PRIVATE_OTHER_CADET_ANSWER'}]}).result;
const rid=result.id,uid=people[1].user.id;
const fingerprint=()=>JSON.stringify([...model.spreadsheet.sheets].map(([name,s])=>[name,s.rows]));
const paths=[
 ['GET','/api/instructor/dashboard'],['GET','/api/instructor/results'],['GET','/api/instructor/instructors'],['GET','/api/instructor/reviews'],['GET','/api/instructor/review-presence'],['GET','/api/instructor/question-bank'],['GET','/api/instructor/analytics'],['GET','/api/instructor/audit'],['GET','/api/instructor/invite'],['POST','/api/instructor/invite'],['GET','/api/instructor/results-sheet'],['POST','/api/instructor/results-sheet/sync'],['GET','/api/instructor/intake'],['POST','/api/instructor/intake/start'],['POST','/api/instructor/intake/continue'],['GET','/api/instructor/exam-recoveries'],['GET','/api/instructor/exam-recoveries/nonexistent'],['POST','/api/instructor/exam-recoveries/nonexistent/approve'],
 ['GET','/api/instructor/tests/'+t.id+'/access'],['POST','/api/instructor/tests/'+t.id+'/access'],['GET','/api/instructor/lesson/'+t.id+'/'+groups[1].id],['GET','/api/instructor/results/'+rid+'/review-session'],['POST','/api/instructor/results/'+rid+'/review-session'],['POST','/api/instructor/results/'+rid+'/grade'],['POST','/api/instructor/results/'+rid+'/retry'],['POST','/api/instructor/groups'],['DELETE','/api/instructor/groups/'+groups[1].id],['POST','/api/instructor/groups/'+groups[1].id+'/archive'],['POST','/api/instructor/tests'],['POST','/api/instructor/tests/assign'],['POST','/api/instructor/tests/'+t.id+'/replace'],['DELETE','/api/instructor/tests/'+t.id],['POST','/api/instructor/users'],['POST','/api/instructor/users/'+uid+'/status'],['POST','/api/instructor/users/'+uid+'/group'],['POST','/api/instructor/users/'+uid+'/password'],['DELETE','/api/instructor/users/'+uid],['POST','/api/instructor/question-bank'],['POST','/api/instructor/question-bank/nonexistent'],['DELETE','/api/instructor/question-bank/nonexistent'],['POST','/api/instructor/material-uploads'],['POST','/api/instructor/material-uploads/nonexistent/parts'],['POST','/api/instructor/materials'],['GET','/api/instructor/materials/nonexistent/progress'],['DELETE','/api/instructor/materials/nonexistent']
];
const attack={userId:'1',role:'instructor',expectedRevision:0,requestId:'audit-forbidden-operation',grades:[{questionId:t.questions[1].id,points:5}],clientId:'audit-attacker-window',action:'open',scope:'all',open:true,active:false,groupId:groups[1].id,confirmation:'НОВИЙ НАБІР'};
for(const actor of [{name:'cadet A',token:people[0].token,code:'FORBIDDEN'},{name:'cadet B',token:people[1].token,code:'FORBIDDEN'},{name:'anonymous',token:'',code:'SESSION_EXPIRED'}]){
 await check(actor.name+' cannot execute any of the '+paths.length+' instructor operations',()=>{
  const before=fingerprint();
  for(const [method,path] of paths){const reply=raw(method,path,actor.token,attack);assert.equal(reply.ok,false,method+' '+path);assert.equal(reply.code,actor.code,method+' '+path);}
  assert.equal(fingerprint(),before,'An unauthorized request mutated a data sheet');
 });
}
await check('Foreign result IDs cannot expose answers, mistakes or grading through encoded IDs',()=>{
 for(const id of [String(rid),encodeURIComponent(rid),'0'+rid,String(rid)+'%2F..%2F'+rid])for(const suffix of ['review','mistakes']){
  const r=raw('GET','/api/results/'+id+'/'+suffix,people[0].token,{userId:uid,role:'instructor'});
  assert.equal(r.ok,false);assert.ok(['FORBIDDEN','RESULT_NOT_FOUND','NOT_FOUND','BAD_REQUEST'].includes(r.code));
  assert.ok(!JSON.stringify(r).includes('PRIVATE_OTHER_CADET_ANSWER'));
 }
});
await check('Unsubmitted test downloads and start replies contain no keys, rubrics or explanations',()=>{
 for(const reply of [api('GET','/api/tests/'+t.id,people[0].token),api('POST','/api/tests/'+t.id+'/start',people[0].token,{submissionId:'pc-'+crypto.randomUUID()})]){
  const text=JSON.stringify(reply);assert.ok(!/SECRET_|isCorrect|correctAnswer|rubric|explanation/.test(text));
 }
});
await check('User and role fields cannot expand the cadet workspace or personal results',()=>{
 for(const path of ['/api/workspace','/api/cadet/workspace','/api/my-results']){
  const reply=api('GET',path,people[0].token,{userId:uid,role:'instructor',allResults:true,known:{}});
  assert.ok(!JSON.stringify(reply).includes('PRIVATE_OTHER_CADET_ANSWER'));
  for(const r of reply.results||reply.changes?.results||[])assert.equal(String(r.userId),String(people[0].user.id));
  assert.equal(reply.changes?.cadets,undefined);
 }
});
await check('A cadet cannot use instructor draft keys or another account ID',()=>{
 for(const key of ['test-draft','grading:'+rid,'exam-attempt','training/../grading:'+rid])for(const method of ['GET','POST']){
  const r=raw(method,'/api/account-state/document',people[0].token,{key,userId:uid,expectedRevision:0,requestId:'forbidden-state-write',value:null});assert.equal(r.ok,false);assert.equal(r.code,'FORBIDDEN');
 }
 const r=api('GET','/api/account-state',people[0].token,{userId:uid});assert.equal(r.userId,String(people[0].user.id));
});
await check('Signature, role and user changes in session tokens do not authenticate',()=>{
 const [payload,signature]=people[0].token.split('.');const original=JSON.parse(Buffer.from(payload,'base64url').toString());
 const forged=[ '', 'unsigned', payload+'.bad',payload+'.'+signature+'.extra',Buffer.from(JSON.stringify({...original,r:'instructor'})).toString('base64url')+'.'+signature,Buffer.from(JSON.stringify({...original,u:uid})).toString('base64url')+'.'+signature ];
 for(let i=0;i<64;i++)forged.push(payload+'.'+signature.slice(0,i%signature.length)+'!'+signature.slice(i%signature.length+1));
 for(const token of forged){const r=raw('GET','/api/workspace',token);assert.equal(r.ok,false);assert.equal(r.code,'SESSION_EXPIRED');}
});
await check('Alternate methods and route encodings cannot reach instructor data as a cadet',()=>{
 for(const path of ['/api/instructor%2Fresults','/api/%69nstructor/results','/api//instructor/results','/api/instructor/results/','/api/instructor/../results','/api/instructor/results?role=instructor'])for(const method of ['GET','POST','DELETE','PUT','PATCH']){
  const r=raw(method,path,people[0].token,attack);assert.equal(r.ok,false);assert.ok(['FORBIDDEN','BAD_REQUEST','NOT_FOUND'].includes(r.code));
 }
});
await check('Legacy non-API actions cannot invoke editor-only functions',()=>{
 const before=fingerprint();
 for(const action of ['setupCommission','getResultsTableLink','createInitialInstructorCode','generateInvite','listResults','registerInstructor','export']){
  const r=JSON.parse(model.context.doPost({postData:{contents:JSON.stringify({action,token:people[0].token})}}).text);assert.equal(r.ok,false);assert.equal(r.code,'UNSUPPORTED_CLIENT');
 }
 assert.equal(fingerprint(),before);
});
await check('Closing a managed test blocks downloads and new starts without leaking questions',()=>{
 api('POST','/api/instructor/tests/'+t.id+'/access',teacher,{expectedRevision:2,scope:'all',open:false});
 for(const [method,path,body] of [['GET','/api/tests/'+t.id,{}],['POST','/api/tests/'+t.id+'/start',{submissionId:'pc-'+crypto.randomUUID()}]]){const r=raw(method,path,people[0].token,body);assert.equal(r.ok,false);assert.equal(r.code,'TEST_CLOSED');assert.ok(!JSON.stringify(r).includes('SECRET_'));}
});
await check('An account disabled by an instructor cannot reuse its existing session',()=>{
 api('POST','/api/instructor/users/'+people[0].user.id+'/status',teacher,{active:false});
 for(const path of ['/api/workspace','/api/tests','/api/my-results','/api/account-state']){const r=raw('GET',path,people[0].token);assert.equal(r.ok,false);assert.equal(r.code,'SESSION_EXPIRED');}
});
await check('The owner may read their submitted work and instructors retain legitimate shared access',()=>{
 assert.equal(api('GET','/api/results/'+rid+'/review',people[1].token).review[1].text,'PRIVATE_OTHER_CADET_ANSWER');
 assert.equal(api('GET','/api/results/'+rid+'/review',teacher).review[1].rubric,'SECRET_RUBRIC');
 assert.ok(api('GET','/api/instructor/results',teacher).results.some(r=>String(r.id)===String(rid)));
});
finish({instructorOperations:paths.length,negativeResponses:requests.filter(r=>!r.ok).length,existingOwnPostSubmissionReviewIsIntended:true});
