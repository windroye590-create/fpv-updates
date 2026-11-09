import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compactResults} from '../web/results.js';
import {completedTestIds} from '../web/core.js';

process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken,spreadsheet,regressionTest,regressionBody,publicRows:canonicalRows}=await import('./fixtures/server_model.mjs');
const checks=[];
function check(name,run){run();checks.push(name);console.log('PASS '+name);}
function rejected(run,code){assert.throws(run,error=>error.code===code);}

const group=api('POST','/api/instructor/groups',instructorToken,{name:'Видалення результату'}).group;
function register(username,fullName='Курсант Тезка'){
 return api('POST','/api/register','',{username,fullName,groupId:group.id,...credential('delete-work-password')});
}
const a=register('delete_work_a'), b=register('delete_work_b');
const target=regressionTest('Видалений тест'), live=regressionTest('Активний тест');
const targetBody=regressionBody(target,'remove-result-a');
const removed=api('POST','/api/results',a.token,targetBody).result;
const other=api('POST','/api/results',b.token,regressionBody(target,'remove-result-b')).result;
const retained=api('POST','/api/results',a.token,regressionBody(live,'retained-result')).result;
const publicSheet=context.publicResultsSheet_();
const hasPublic=id=>canonicalRows(publicSheet).slice(1).some(row=>String(row[7])===String(id));
const route=id=>'/api/instructor/results/'+id;
const erase=(id,token=instructorToken)=>api('DELETE',route(id),token,{confirmResultId:String(id)});

check('Only an instructor can delete a confirmed result ID',()=>{
 rejected(()=>erase(removed.id,''),'SESSION_EXPIRED');
 rejected(()=>erase(removed.id,a.token),'FORBIDDEN');
 rejected(()=>api('DELETE',route(removed.id),instructorToken,{confirmResultId:String(other.id)}),'CONFIRMATION_REQUIRED');
 rejected(()=>erase('missing-result'),'RESULT_NOT_FOUND');
 assert.ok(hasPublic(removed.id));
});

check('Ambiguous old rows without IDs prevent deletion before any data is changed',()=>{
 const legacy=spreadsheet.insertSheet('Результати курсантів');
 legacy.maxColumns=5;
 legacy.rows=[canonicalRows(publicSheet)[0].slice(0,5),Array.from(context.publicResultValues_(removed)).slice(0,5)];
 try{
  rejected(()=>erase(removed.id),'PUBLIC_RESULTS_ID_REQUIRED');
  assert.ok(hasPublic(removed.id));
  assert.ok(context.findResultById_(removed.id));
  assert.equal(legacy.getLastRow(),2);
 }finally{spreadsheet.sheets.delete('Результати курсантів');}
});

const before=api('GET','/api/workspace',a.token);
check('A result of an archived test is removed while other people and work stay intact',()=>{
 api('DELETE','/api/instructor/tests/'+target.id,instructorToken);
 assert.equal(erase(removed.id).deleted,true);
 assert.equal(context.findResultById_(removed.id),null);
 assert.ok(!hasPublic(removed.id));
 assert.ok(hasPublic(other.id)&&hasPublic(retained.id));
 assert.equal(context.findUserById_(a.user.id).active,true);
 assert.ok(!context.dataRows_('resultDetails').some(row=>String(row[0])===String(removed.id)));
 assert.ok(!context.dataRows_('sync').some(row=>row[1]==='result:'+removed.id));
 assert.ok(context.dataRows_('resultDetails').some(row=>String(row[0])===String(other.id)));
 for(const token of [a.token,instructorToken]){
  rejected(()=>api('GET','/api/results/'+removed.id+'/review',token),'RESULT_NOT_FOUND');
 }
});

check('Refresh removes the work and publishes a private attempt marker to its owner',()=>{
 const reply=api('GET','/api/workspace',a.token,{known:before.revisions});
 assert.ok(reply.changes.results.some(result=>result.id===retained.id));
 assert.ok(!reply.changes.results.some(result=>result.id===removed.id));
 assert.deepEqual(reply.deletedResults.map(item=>[item.id,item.testId]),[[String(removed.id),String(target.id)]]);
 assert.equal(api('GET','/api/workspace',b.token).deletedResults.length,0);
 assert.ok(completedTestIds([],[],null,[],reply.deletedResults.map(item=>item.testId)).has(String(target.id)));
});

check('Replays and repair never republish removed scores',()=>{
 assert.equal(erase(removed.id).alreadyDeleted,true);
 rejected(()=>api('POST','/api/results',a.token,targetBody),'RESULT_DELETED');
 rejected(()=>api('POST','/api/results',a.token,{...targetBody,submissionId:'new-deleted-attempt'}),'RESULT_DELETED');
 api('POST','/api/instructor/results-sheet/sync',instructorToken);
 assert.ok(!hasPublic(removed.id));
 assert.equal(context.dataRows_('deletedResults').filter(row=>String(row[0])===String(removed.id)).length,1);
});

check('A failure after public deletion leaves a retryable operation and blocks republishing',()=>{
 const details=context.sheet_('resultDetails');
 const deleteRows=details.deleteRows;
 details.deleteRows=()=>{throw Error('Temporary Sheets failure');};
 try{
  rejected(()=>erase(retained.id),'RESULT_DELETION_PENDING');
  assert.ok(context.findResultById_(retained.id));
  assert.ok(!hasPublic(retained.id));
  api('POST','/api/instructor/results-sheet/sync',instructorToken);
  assert.ok(!hasPublic(retained.id));
  rejected(()=>api('POST',route(retained.id)+'/grade',instructorToken),'RESULT_DELETION_PENDING');
 }finally{details.deleteRows=deleteRows;}
 assert.equal(erase(retained.id).deleted,true);
 assert.ok(!hasPublic(retained.id)&&hasPublic(other.id));
 rejected(()=>api('POST','/api/tests/'+live.id+'/start',a.token,{submissionId:'pc-deleted-attempt-123'}),'ALREADY_COMPLETED');
 assert.ok(canonicalRows(publicSheet).some(row=>String(row[6])===String(a.user.id)&&!row[7]));
});

check('A late written-grading draft cannot restore a deleted work',()=>{
 rejected(()=>api('POST','/api/account-state/document',instructorToken,{
  key:'grading:'+retained.id,requestId:'late-grading-draft',expectedRevision:0,
  value:{revision:0,items:{q1:{points:1,comment:'Запізніла чернетка'}}}
 }),'REVIEW_UNAVAILABLE');
});

check('Instructor result actions address the exact work and remain unavailable to cadets',()=>{
 assert.match(compactResults([other],{instructor:true,allowDelete:true}),new RegExp('data-action="delete-result" data-id="'+other.id+'"'));
 assert.doesNotMatch(compactResults([other],{instructor:true}),/data-action="delete-result"/);
 assert.doesNotMatch(compactResults([other],{allowDelete:true}),/data-action="delete-result"/);
});

check('Deleting a completed exam clears its saved attempt and blocks new exam or recovery requests',()=>{
 const exam=api('POST','/api/instructor/tests',instructorToken,{
  title:'Видалений іспит',mode:'exam',durationMinutes:10,published:true,
  questions:[{text:'Питання іспиту',answers:[{text:'Так',isCorrect:true},{text:'Ні'}]}]
 }).test;
 const deviceId='deletion-test-pc';
 const start=api('POST','/api/exam-session/start',b.token,{deviceId,requestId:'exam-start-delete',testId:exam.id});
 const done=api('POST','/api/exam-session/finish',b.token,{
  deviceId,requestId:'exam-finish-delete',submissionId:start.document.value.submissionId,
  fence:start.document.value.fence,expectedRevision:start.document.revision,
  checkpoint:{index:0,answers:{[exam.questions[0].id]:exam.questions[0].answers[0].id}}
 });
 assert.equal(erase(done.completion.result.id).deleted,true);
 assert.equal(api('GET','/api/exam-session',b.token).document.value,null);
 rejected(()=>api('POST','/api/exam-session/start',b.token,{deviceId,requestId:'exam-restart-delete',testId:exam.id}),'ALREADY_COMPLETED');
 rejected(()=>api('POST','/api/exam-recoveries',b.token,regressionBody(exam,'exam-recover-delete')),'RESULT_DELETED');
});

check('Whole-account cleanup also removes its used-attempt markers',()=>{
 api('DELETE','/api/instructor/users/'+a.user.id,instructorToken,{confirmUserId:String(a.user.id)});
 assert.equal(context.deletedResultRows_(a.user.id).length,0);
 assert.ok(hasPublic(other.id));
});

{
 const uiTest=regressionTest('Робота з таблиці результатів');
 const selected=api('POST','/api/results',b.token,regressionBody(uiTest,'ui-delete-result')).result;
 const selectedId=String(selected.id), calls=[];
 const account={capabilities:{resultDeletion:true},results:[selected,other],resultTotal:2,reviews:{},gradingDrafts:{[selectedId]:{items:{}}}};
 let confirmation;
 const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const start=source.indexOf('function forgetResultDetails('),end=source.indexOf('let statementOpening',start);
 const box={
  instructor:()=>true,account:()=>account,S:{session:{token:instructorToken}},id:String,e:String,
  reviewQueue:[selected,other],persist:async()=>{},render:()=>{},toast:()=>{},refresh:async()=>{},
  rpc:async(method,path,body,token)=>{calls.push({method,path,body});return api(method,path,token,body);},
  confirmAction:(title,details,callback)=>{confirmation={title,details,callback};}
 };
 vm.runInNewContext(source.slice(start,end)+'\nconfirmResultDeletion('+JSON.stringify(selectedId)+');',box);
 assert.equal(calls.length,0);
 assert.ok(hasPublic(selectedId));
 assert.match(confirmation.details,/Робота з таблиці результатів/);
 await confirmation.callback();
 assert.deepEqual(calls.map(call=>[call.method,call.path,call.body.confirmResultId]),[['DELETE',route(selectedId),selectedId]]);
 assert.deepEqual(Array.from(account.results,result=>result.id),[other.id]);
 assert.ok(!hasPublic(selectedId)&&hasPublic(other.id));
 assert.equal(account.gradingDrafts[selectedId],undefined);
 checks.push('Actual client confirmation removes one result through the real server model');
 console.log('PASS '+checks.at(-1));
}

fs.writeFileSync(new URL('../verification/result-deletion.json',import.meta.url),JSON.stringify({passed:checks.length,checks},null,2)+'\n');
console.log('Single-result deletion: '+checks.length+' passed.');
