import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {audit,model,clone} from './support.mjs';
const {api,check,finish}=audit('instructor-concurrency');
const one={token:model.instructorToken,user:api('GET','/api/workspace',model.instructorToken).user};
const code=api('POST','/api/instructor/invite',one.token).code;
const two=api('POST','/api/instructor/register','',{username:'audit_second_instructor',fullName:'Другий синтетичний інструктор',inviteCode:code,...model.credential('synthetic-teacher-password')});
const groups=['A','B'].map(n=>api('POST','/api/instructor/groups',one.token,{name:'Спільна перевірка '+n}).group);
const cadet=api('POST','/api/register','',{username:'audit_concurrent_cadet',fullName:'Курсант паралельної перевірки',groupId:groups[0].id,...model.credential('synthetic-cadet-password')});
const works=Array.from({length:12},(_,i)=>{const test=api('POST','/api/instructor/tests',one.token,{title:'Паралельна робота '+i,questions:Array.from({length:3},(_,j)=>({type:'written',text:'Відповідь '+j,maxPoints:5,answers:[]}))}).test;return {test,result:api('POST','/api/results',cadet.token,{testId:test.id,submissionId:'audit-concurrent-'+i,writtenProtocol:1,answers:test.questions.map(q=>({questionId:q.id,text:'Оригінальна відповідь '+q.id}))}).result};});
const path=w=>'/api/instructor/results/'+w.result.id;
let httpRequests=0,lostAcknowledgements=0;
const httpLog=[];
const server=http.createServer(async(req,res)=>{const chunks=[];for await(const p of req)chunks.push(p);const input=JSON.parse(Buffer.concat(chunks));httpRequests++;await new Promise(r=>setTimeout(r,Number(req.headers['x-audit-delay']||0)));
 const r=JSON.parse(model.context.doPost({postData:{contents:JSON.stringify(input)}}).text);httpLog.push({path:input.path,ok:r.ok,code:r.code||null});
 if(req.headers['x-audit-drop']==='yes'&&r.ok){lostAcknowledgements++;req.socket.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(r));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const post=async(p,actor,body,delay=0,drop=false)=>{const r=await fetch(origin,{method:'POST',headers:{'x-audit-delay':String(delay),...(drop?{'x-audit-drop':'yes'}:{})},body:JSON.stringify({action:'api',method:'POST',path:p,token:actor.token,body,writtenProtocol:1,choiceProtocol:2})});return r.json();};
let randomState=541219;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
let now=Date.now();model.context.Date=class extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
const winners=[];
try{
 await check('Concurrent claims by two instructors reserve each work for exactly one owner',async()=>{
  for(const w of works){const replies=await Promise.all([post(path(w)+'/review-session',one,{action:'open',clientId:'audit-first-window-00'},Math.floor(random()*5)),post(path(w)+'/review-session',two,{action:'open',clientId:'audit-second-window-0'},Math.floor(random()*5))]);assert.equal(replies.filter(r=>r.reviewSession.state==='owned').length,1);assert.equal(replies.filter(r=>r.reviewSession.state==='busy').length,1);const index=replies[0].reviewSession.state==='owned'?0:1,owner=index?two:one,clientId=index?'audit-second-window-0':'audit-first-window-00';assert.equal(replies[1-index].reviewSession.leaseId,undefined);api('POST',path(w)+'/review-session',owner.token,{action:'release',clientId,leaseId:replies[index].reviewSession.leaseId});}
 });
 await check('Four simultaneous stale saves cannot overwrite the first accepted grade',async()=>{
  for(const [i,w] of works.entries()){const proposals=Array.from({length:4},(_,n)=>({actor:n%2?two:one,body:{expectedRevision:0,requestId:'race-'+i+'-'+n,grades:[{questionId:w.test.questions[0].id,points:n+1,comment:'author-'+n}]}}));const r=await Promise.all(proposals.map(v=>post(path(w)+'/grade',v.actor,v.body,Math.floor(random()*7))));assert.equal(r.filter(v=>v.ok).length,1);assert.ok(r.filter(v=>!v.ok).every(v=>v.code==='REVISION_CONFLICT'));const win=r.findIndex(v=>v.ok),review=api('GET','/api/results/'+w.result.id+'/review',one.token);assert.equal(review.result.gradingRevision,1);assert.equal(review.review[0].points,proposals[win].body.grades[0].points);assert.equal(review.review[0].reviewerName,proposals[win].actor.user.fullName);winners.push(proposals[win].actor.user.username);}
 });
 await check('Concurrent retries of the exact same grade commit only one revision',async()=>{
  for(const [i,w] of works.entries()){const body={expectedRevision:1,requestId:'same-grade-'+i,grades:[{questionId:w.test.questions[1].id,points:4,comment:'Другий коментар'}]};const r=await Promise.all([post(path(w)+'/grade',two,body,2),post(path(w)+'/grade',two,body,0)]);assert.ok(r.every(x=>x.ok&&x.result.gradingRevision===2));}
 });
 await check('Reusing an accepted request ID with changed points is rejected without mutation',()=>{
  for(const [i,w] of works.entries()){const before=clone(model.context.resultRecordById_(w.result.id).row);assert.throws(()=>api('POST',path(w)+'/grade',two.token,{expectedRevision:2,requestId:'same-grade-'+i,grades:[{questionId:w.test.questions[1].id,points:0,comment:'Другий коментар'}]}),e=>e.code==='REVISION_CONFLICT');assert.deepEqual(clone(model.context.resultRecordById_(w.result.id).row),before);}
 });
 await check('A lost grade acknowledgement can be retried without losing the other instructor’s prior grades',async()=>{
  for(const [i,w] of works.entries()){const body={expectedRevision:2,requestId:'lost-grade-'+i,grades:[{questionId:w.test.questions[2].id,points:3,comment:'Третій коментар'}]};await assert.rejects(()=>post(path(w)+'/grade',one,body,0,true));const retry=await post(path(w)+'/grade',one,body);assert.equal(retry.result.gradingRevision,3);assert.equal(retry.review[1].points,4);assert.equal(retry.review[2].points,3);assert.equal(retry.review[2].reviewerName,one.user.fullName);assert.equal(retry.result.pendingWritten,0);}
 });
 await check('An expired reviewer cannot overwrite the instructor who acquired the work next',()=>{
  const w=works[0],old=api('POST',path(w)+'/review-session',one.token,{action:'open',clientId:'audit-old-window-000'}).reviewSession;now+=120001;const current=api('POST',path(w)+'/review-session',two.token,{action:'open',clientId:'audit-new-window-000'}).reviewSession;
  assert.throws(()=>api('POST',path(w)+'/grade',one.token,{requestId:'expired-owner-update',expectedRevision:3,reviewLease:{clientId:'audit-old-window-000',leaseId:old.leaseId},grades:[{questionId:w.test.questions[0].id,points:0}]}),e=>e.code==='REVIEW_IN_PROGRESS');
  api('POST',path(w)+'/review-session',one.token,{action:'release',clientId:'audit-old-window-000',leaseId:old.leaseId});assert.equal(api('POST',path(w)+'/review-session',one.token,{action:'open',clientId:'audit-old-window-000'}).reviewSession.state,'busy');api('POST',path(w)+'/review-session',two.token,{action:'release',clientId:'audit-new-window-000',leaseId:current.leaseId});
 });
 await check('A failure after writing the authoritative grade is retried as the same accepted revision',()=>{
  const w=works[1],body={requestId:'postcommit-grade-fault',expectedRevision:3,grades:[{questionId:w.test.questions[2].id,points:5,comment:'Після збою'}]},original=model.context.logAudit_;let fail=true;
  model.context.logAudit_=function(...args){if(fail){fail=false;throw Error('Synthetic audit failure after grade commit');}return original(...args);};
  try{assert.throws(()=>api('POST',path(w)+'/grade',two.token,body),e=>e.code==='SERVER_ERROR');}finally{model.context.logAudit_=original;}
  const retry=api('POST',path(w)+'/grade',two.token,body);assert.equal(retry.result.gradingRevision,4);assert.equal(retry.review[2].points,5);
 });
 await check('Test access races use the same revision protection as grade writes',async()=>{
  const test=api('POST','/api/instructor/tests',one.token,{title:'Паралельний доступ',accessProtocol:1,questions:[{text:'Питання',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]}).test;
  for(let i=0;i<20;i++){const revision=api('GET','/api/instructor/tests/'+test.id+'/access',one.token).test.access.revision;const actions=[{actor:one,body:{expectedRevision:revision,scope:'all',open:i%2===0}},{actor:two,body:{expectedRevision:revision,scope:'group',groupId:groups[1].id,open:i%2!==0}}];const r=await Promise.all(actions.map(a=>post('/api/instructor/tests/'+test.id+'/access',a.actor,a.body,Math.floor(random()*5))));assert.equal(r.filter(x=>x.ok).length,1);assert.equal(r.find(x=>!x.ok).code,'REVISION_CONFLICT');const current=api('GET','/api/instructor/tests/'+test.id+'/access',one.token).test.access;assert.equal(current.revision,revision+1);const winner=r.findIndex(x=>x.ok),policy=model.context.testAccessPolicy_(test.id);if(actions[winner].body.scope==='all'){assert.equal(policy.defaultOpen,actions[winner].body.open);assert.equal(Object.keys(policy.groups).length,0);}else assert.equal(policy.groups[groups[1].id]??policy.defaultOpen,actions[winner].body.open);}
 });
 await check('All concurrent grade writes retain the original cadet answer text',()=>{
  for(const w of works){const row=model.context.resultRecordById_(w.result.id).row,answers=JSON.parse(row[13]);for(const q of w.test.questions)assert.equal(answers[q.id],'Оригінальна відповідь '+q.id);}
 });
 await check('Shared review queue and presence polls expose no lease credentials to observers',()=>{
  const body=JSON.stringify(api('GET','/api/instructor/reviews',two.token));assert.ok(!body.includes('leaseId'));const presence=JSON.stringify(api('GET','/api/instructor/review-presence',one.token));assert.ok(!presence.includes('leaseId'));assert.ok(!presence.includes('clientId'));
 });
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
finish({parallelTransport:'local HTTP, real Code.gs, synthetic serialized Apps Script lock model',works:works.length,httpRequests,lostAcknowledgements,winningAccounts:[...new Set(winners)],httpLog,liveGoogleCapacityMeasured:false});
