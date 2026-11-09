import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {payload} from '../web/core.js';
import {createExamSession} from '../web/exam-session.js';
process.env.LITAKOVA_SERVER_SOURCE = new URL('../Code.gs', import.meta.url).pathname;
const {api, context, credential, instructorToken, spreadsheet,seedLegacyRetry} = await import('./fixtures/server_model.mjs');
const checks = [];
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
const group = api('POST', '/api/instructor/groups', instructorToken, {name:'Видалення тестів'}).group;
const cadet = api('POST', '/api/register', '', {username:'delete-test-cadet', fullName:'Курсант історії тестів', groupId:group.id, ...credential('test-deletion-password')});
const other = api('POST', '/api/register', '', {username:'delete-test-other', fullName:'Інший курсант історії', groupId:group.id, ...credential('test-deletion-password')});
const question = {text:'Два правильні варіанти', type:'choice', maxPoints:2, answers:[{text:'Перший',isCorrect:true},{text:'Другий',isCorrect:true},{text:'Зайвий',isCorrect:false}]};
const make = (title, extra={}) => api('POST', '/api/instructor/tests', instructorToken, {title, mode:'training', passingPercent:75, published:true, questions:[question], ...extra}).test;
const submit = (test, token=cadet.token, extra={}) => api('POST', '/api/results', token, {testId:test.id, submissionId:'delete-test-result-'+test.id, choiceProtocol:2, writtenProtocol:1, durationSeconds:14, answers:[{questionId:test.questions[0].id,answerIds:test.questions[0].answers.slice(0,2).map(a=>a.id)}], ...extra});
const del = test => api('DELETE','/api/instructor/tests/'+test.id,instructorToken);
const fail = (action, code) => assert.throws(action,e=>e.code===code);
const clone = value => JSON.parse(JSON.stringify(value));
const finished = make('Тест зі збереженим результатом');
const accepted = submit(finished), beforeQuestions=clone(context.getTestById_(finished.id).questions);
const beforeResultRows = clone(spreadsheet.getSheetByName('_Результати_дані').rows);
const beforeDetails = clone(spreadsheet.getSheetByName('_Деталі_відповідей').rows);
const publicSheet = context.publicResultsSheet_();
const beforePublic = clone(publicSheet.rows);
await check('A completed test can be deleted without altering result, answer, detail or public grade rows',()=>{
 const r=del(finished); assert.equal(r.deleted,true); assert.equal(String(r.id),String(finished.id)); assert.equal(r.resultsPreserved,true);
 assert.deepEqual(clone(spreadsheet.getSheetByName('_Результати_дані').rows),beforeResultRows);
 assert.deepEqual(clone(spreadsheet.getSheetByName('_Деталі_відповідей').rows),beforeDetails);
 assert.deepEqual(clone(publicSheet.rows),beforePublic);
 assert.deepEqual(clone(context.getTestById_(finished.id).questions),beforeQuestions);
});
await check('Deleted tests disappear from both catalogs while both users retain accepted result history',()=>{
 for(const token of [instructorToken,cadet.token]){
  assert.ok(!api('GET','/api/tests',token).tests.some(t=>String(t.id)===String(finished.id)));
  assert.ok(!api('GET','/api/workspace',token).changes.tests.some(t=>String(t.id)===String(finished.id)));
 }
 assert.ok(api('GET','/api/my-results',cadet.token).results.some(r=>r.id===accepted.result.id));
 assert.ok(api('GET','/api/instructor/results',instructorToken).results.some(r=>r.id===accepted.result.id));
});
await check('A deleted test cannot be opened, edited or reassigned through a stale cached identifier',()=>{
 for(const token of [cadet.token,instructorToken])fail(()=>api('GET','/api/tests/'+finished.id,token),'TEST_NOT_FOUND');
 fail(()=>api('POST','/api/instructor/tests/'+finished.id+'/replace',instructorToken,{title:'Застаріле редагування',questions:[question]}),'TEST_NOT_FOUND');
 fail(()=>api('POST','/api/instructor/tests/assign',instructorToken,{tests:[{testId:finished.id,expectedDescription:finished.description}],groupIds:[group.id]}),'TEST_NOT_FOUND');
});
await check('Multi-answer historical reviews and mistake practice remain complete after deletion',()=>{
 const r=api('GET','/api/results/'+accepted.result.id+'/review',cadet.token);
 assert.equal(r.review[0].isCorrect,true); assert.equal(r.review[0].correctAnswerIds.length,2); assert.equal(r.review[0].selectedAnswerIds.length,2);
 const wrong=make('Помилки видаленого тесту'), result=submit(wrong,cadet.token,{answers:[]}); del(wrong);
 assert.equal(api('GET','/api/results/'+result.result.id+'/mistakes',cadet.token).practice.questions.length,1);
 fail(()=>api('GET','/api/results/'+result.result.id+'/review',other.token),'FORBIDDEN');
});
await check('A retry of an already accepted submission returns the same result after deletion',()=>{
 const r=submit(finished); assert.equal(r.result.id,accepted.result.id); assert.equal(r.alreadyAccepted,true); assert.equal(r.review.length,1);
 assert.equal(api('GET','/api/my-results',cadet.token).results.filter(r=>r.testId===finished.id).length,1);
});
await check('A new result cannot be submitted against a deleted cached test',()=>{
 const before=clone(spreadsheet.getSheetByName('_Результати_дані').rows);
 fail(()=>submit(finished,other.token),'TEST_NOT_FOUND');
 assert.deepEqual(clone(spreadsheet.getSheetByName('_Результати_дані').rows),before);
});
await check('Deleting a test preserves pending written answers, rubrics and later instructor grading',()=>{
 const t=make('Письмова робота після видалення',{questions:[question,{type:'written',text:'Поясніть відповідь',rubric:'Потрібне обґрунтування',maxPoints:3,answers:[]}]});
 const result=submit(t,cadet.token,{answers:[{questionId:t.questions[0].id,answerIds:t.questions[0].answers.slice(0,2).map(a=>a.id)},{questionId:t.questions[1].id,text:'Збережена письмова відповідь'}]}); del(t);
 const review=api('GET','/api/results/'+result.result.id+'/review',instructorToken);
 assert.equal(review.review[1].text,'Збережена письмова відповідь'); assert.equal(review.review[1].rubric,'Потрібне обґрунтування');
 assert.ok(api('GET','/api/instructor/reviews',instructorToken).results.some(r=>r.id===result.result.id));
 const graded=api('POST','/api/instructor/results/'+result.result.id+'/grade',instructorToken,{requestId:crypto.randomUUID(),expectedRevision:0,finalize:true,grades:[{questionId:t.questions[1].id,points:3,comment:'Перевірено після видалення'}]});
 assert.equal(graded.result.score,100); assert.equal(graded.result.gradingStatus,'graded'); assert.equal(graded.review[1].comment,'Перевірено після видалення');
});
await check('Repeated deletion is idempotent and records exactly one audit entry',()=>{
 const r=del(finished); assert.equal(r.alreadyDeleted,true);
 assert.equal(context.dataRows_('audit').filter(r=>r[3]==='TEST_DELETE'&&String(r[5])===String(finished.id)).length,1);
});
await check('Deleting one test leaves other test definitions and results unchanged',()=>{
 const keep=make('Залишити цей тест'), doomed=make('Видалити лише цей тест'), result=submit(keep), before=clone(context.getTestById_(keep.id));
 del(doomed); assert.deepEqual(clone(context.getTestById_(keep.id)),before);
 assert.equal(api('GET','/api/results/'+result.result.id+'/review',cadet.token).result.score,100);
});
await check('An unused test is removed from the catalog while retaining its original question definition',()=>{
 const t=make('Ще не проходили'), before=clone(t.questions); del(t);
 assert.equal(context.getTestById_(t.id).published,false); assert.deepEqual(clone(context.getTestById_(t.id).questions),before);
 assert.ok(!api('GET','/api/tests',instructorToken).tests.some(v=>v.id===t.id));
});
await check('Anonymous users and cadets cannot delete a test',()=>{
 const t=make('Захист видалення'); fail(()=>api('DELETE','/api/instructor/tests/'+t.id,''),'SESSION_EXPIRED');
 fail(()=>api('DELETE','/api/instructor/tests/'+t.id,cadet.token),'FORBIDDEN'); assert.equal(context.getTestById_(t.id).published,true);
});
await check('Deletion uses the write lock and invalidates the catalog cursor on other PCs',()=>{
 const t=make('Оновлення каталогу'), before=api('GET','/api/workspace',instructorToken); del(t);
 const after=api('GET','/api/workspace',instructorToken,{known:before.revisions});
 assert.notEqual(after.revisions.tests,before.revisions.tests); assert.equal(after.revisions.results,before.revisions.results);
 assert.ok(!after.changes.tests.some(v=>v.id===t.id)); assert.equal(after.capabilities.testDeletion,true);
 assert.equal(context.requiresWriteLock_({action:'api',method:'DELETE',path:'/api/instructor/tests/'+t.id}),true);
});
await check('Deleting a personal retry revokes its link without removing the original accepted result',()=>{
 const t=make('Повтор видаленого тесту'), result=submit(t), retry=seedLegacyRetry(t,cadet.user.id,result.result.id); del(retry);
 assert.ok(!context.listRetries_().some(r=>String(r.retryTestId)===String(retry.id)&&r.active));
 assert.equal(api('GET','/api/results/'+result.result.id+'/review',cadet.token).result.id,result.result.id);
});
await check('An exam already started before deletion can move to another PC and finish with its original key',async()=>{
 const t=make('Розпочатий іспит',{mode:'exam',durationMinutes:20});
 function pc(){const a={run:null},s={user:cadet.user,token:context.issueToken_(cadet.user)},done=[];const c=createExamSession({session:()=>s,account:()=>a,deviceId:()=>s.token.slice(0,32),rpc:async(m,p,b,token)=>api(m,p,token,b),persist:async()=>{},now:()=>1000,completed:async value=>done.push(value)});return {a,c,done};}
 const first=pc(),second=pc(); await first.c.start(t.id); first.a.run.answers[t.questions[0].id]=t.questions[0].answers.slice(0,2).map(a=>a.id); await first.c.release();
 const deadline=first.a.run.deadline; del(t); await second.c.discover(); await second.c.claim(); assert.equal(second.a.run.deadline,deadline); await second.c.finish();
 assert.equal(second.done[0].result.correct,1); assert.equal(second.done[0].result.score,100);
 assert.equal(api('GET','/api/results/'+second.done[0].result.id+'/review',cadet.token).review[0].isCorrect,true);
});
await check('New cadets cannot start a deleted exam',()=>{
 const t=make('Нові спроби закрито',{mode:'exam',durationMinutes:20}); del(t);
 fail(()=>api('POST','/api/exam-session/start',other.token,{testId:t.id,deviceId:crypto.randomUUID(),requestId:crypto.randomUUID()}),'TEST_NOT_FOUND');
});
await check('The current PC confirmation sends the unchanged deletion request and preserves cached results',async()=>{
 const t=make('Поточний клієнт'), result=submit(t), a={fullTests:{[String(t.id)]:t},results:[result.result]}, source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8').split('\n').find(l=>l.startsWith(" if(act==='delete-test')"));
 let confirmation, refreshes=0, calls=0;
 const box={act:'delete-test',tid:String(t.id),a,id:String,encodeURIComponent,confirmAction:(title,description,callback,label)=>{confirmation={title,description,callback,label};},rpc:async(method,path)=>{calls++;const request=payload(method,path,instructorToken);const r=JSON.parse(context.doPost({postData:{contents:JSON.stringify(request)}}).text);assert.equal(r.ok,true);return r;},refresh:async()=>{refreshes++;}};
 vm.createContext(box); vm.runInContext('(function(){'+source+'})()',box);
 assert.equal(calls,0); assert.match(confirmation.description,/збереже історію/); await confirmation.callback();
 assert.equal(calls,1); assert.equal(refreshes,1); assert.equal(a.fullTests[String(t.id)],undefined); assert.equal(a.results[0].id,result.result.id);
});
await check('Unknown test deletion reports not found instead of changing unrelated data',()=>{
 const before=clone(spreadsheet.getSheetByName('_Тести').rows); fail(()=>api('DELETE','/api/instructor/tests/no-such-test',instructorToken),'TEST_NOT_FOUND');
 assert.deepEqual(clone(spreadsheet.getSheetByName('_Тести').rows),before);
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/test-deletion.json',import.meta.url),JSON.stringify({passed:checks.length,checks,backend:'actual Code.gs in Sheets model',client:'unchanged PC 1.2.6 confirmation handler and actual exam-session.js',physicalWindowsVerified:false,productionDataDeleted:false,testedAt:new Date().toISOString()},null,2));
console.log('Test deletion: '+checks.length+' checks passed.');
