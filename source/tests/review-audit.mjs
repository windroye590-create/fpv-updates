import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
import {createReviewPresence,reviewPresenceMarkup} from '../web/review-presence.js';

process.env.LITAKOVA_SERVER_SOURCE = new URL('../Code.gs', import.meta.url).pathname;
const {api, instructorToken, credential} = await import('./fixtures/server_model.mjs');
const checks = [];
async function check(name, run) {
  try { await run(); checks.push({name, status:'passed'}); }
  catch (error) { checks.push({name, status:'failed', error:error.message}); }
}
const group = api('POST', '/api/instructor/groups', instructorToken, {name:'Перевірка двома інструкторами'}).group;
const cadet = api('POST', '/api/register', '', {fullName:'Курсант діагностики', username:'review_audit_cadet', groupId:group.id, ...credential('synthetic-review-password')});
const inviteCode = api('POST', '/api/instructor/invite', instructorToken).code;
const other = api('POST', '/api/instructor/register', '', {fullName:'Другий перевіряльник · Викладач', username:'review_audit_teacher', inviteCode, ...credential('synthetic-teacher-password')});
const choice = {text:'Два правильні варіанти', maxPoints:2, answers:[{text:'Перший <варіант>', isCorrect:true}, {text:'Другий & варіант', isCorrect:true}, {text:'Зайвий', isCorrect:false}]};
const makeTest = (title, questions) => api('POST', '/api/instructor/tests', instructorToken, {title, questions}).test;
const submit = test => api('POST', '/api/results', cadet.token, {testId:test.id, submissionId:'review-audit-'+test.id, writtenProtocol:1, choiceProtocol:2, answers:[{questionId:test.questions[0].id, answerIds:test.questions[0].answers.slice(0,2).map(a=>a.id)}]}).result;
const plain = makeTest('Лише варіанти відповідей', [choice]);
const plainResult = submit(plain);
const mixed = makeTest('Спільна письмова перевірка', [choice, {type:'written', text:'Перше письмове', maxPoints:3, answers:[]}, {type:'written', text:'Друге письмове', maxPoints:5, answers:[]}]);
const mixedResult = submit(mixed);
const gradePath = '/api/instructor/results/'+mixedResult.id+'/grade';
let first;
await check('Two distinct instructor accounts can read the same pending work', () => {
  assert.notEqual(String(other.user.id), String(cadet.user.id));
  const a = api('GET', '/api/results/'+mixedResult.id+'/review', instructorToken);
  const b = api('GET', '/api/results/'+mixedResult.id+'/review', other.token);
  assert.equal(a.result.gradingRevision, b.result.gradingRevision);
  assert.equal(b.review.length, 3);
  assert.equal(b.review[0].isCorrect, true);
});
await check('The first instructor can save one written grade without finalizing the other', () => {
  first = api('POST', gradePath, instructorToken, {requestId:'audit-first', expectedRevision:0, grades:[{questionId:mixed.questions[1].id, points:2, comment:'Перший коментар'}]});
  assert.equal(first.result.pendingWritten, 1);
  assert.equal(first.result.gradingRevision, 1);
});
await check('A stale second instructor cannot overwrite the first instructor’s grade', () => {
  assert.throws(() => api('POST', gradePath, other.token, {requestId:'audit-stale', expectedRevision:0, grades:[{questionId:mixed.questions[1].id, points:0, comment:'Застаріле'}]}), e=>e.code==='REVISION_CONFLICT');
  const saved = api('GET', '/api/results/'+mixedResult.id+'/review', other.token);
  assert.equal(saved.review[1].points, 2);
  assert.equal(saved.review[1].comment, 'Перший коментар');
});
const finalRequest = {requestId:'audit-second', expectedRevision:1, grades:[{questionId:mixed.questions[2].id, points:4, comment:'Другий коментар'}]};
await check('After refreshing, the second instructor completes grading and preserves both authors', () => {
  const latest = api('GET', '/api/results/'+mixedResult.id+'/review', other.token);
  assert.equal(latest.result.gradingRevision, finalRequest.expectedRevision);
  const final = api('POST', gradePath, other.token, finalRequest);
  assert.equal(final.result.score, 80);
  assert.equal(final.result.correct, 1);
  assert.equal(final.result.pendingWritten, 0);
  assert.equal(final.review[1].comment, 'Перший коментар');
  assert.equal(final.review[2].comment, 'Другий коментар');
  assert.notEqual(final.review[1].reviewerName, final.review[2].reviewerName);
  assert.equal(final.review[2].reviewerName, other.user.fullName);
});
await check('Retrying the accepted grade is idempotent and the cadet sees the final score', () => {
  const retry = api('POST', gradePath, other.token, finalRequest);
  assert.equal(retry.result.gradingRevision, 2);
  assert.equal(api('GET', '/api/results/'+mixedResult.id+'/review', cadet.token).result.score, 80);
  assert.throws(() => api('POST', gradePath, cadet.token, finalRequest), e=>e.code==='FORBIDDEN');
});

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
function appFunction(name) {
  const start = app.search(new RegExp('^(?:async )?function '+name+'\\(', 'm'));
  if (start < 0) return '';
  const next = app.slice(start+1).search(/\n(?:async )?function /);
  return next < 0 ? app.slice(start) : app.slice(start, start+1+next);
}
const account = {gradingDrafts:{}, results:[plainResult, mixedResult], fullTests:{}, reviews:{}};
const sandbox = {C, e:C.esc, id:C.id, S:{session:{token:instructorToken}}, account:()=>account,
  persist:async()=>{}, render:()=>{}, restoreWorkPosition:()=>{}, grading:null, working:false,
  rpc:async(method,path,body={})=>api(method,path,instructorToken,body),
  head:(title,subtitle,actions)=>'<header><h1>'+title+'</h1><p>'+subtitle+'</p>'+actions+'</header>',
  empty:text=>text};
sandbox.S.session.user=api('GET','/api/workspace',instructorToken).user;
sandbox.instructor=()=>true;sandbox.resultsView=()=>account.resultsView||'compact';sandbox.filter='';sandbox.page='results';
sandbox.reviewPresence=createReviewPresence({session:()=>sandbox.S.session,rpc:sandbox.rpc,clientId:'review-audit-window'});
sandbox.reviewPresenceMarkup=reviewPresenceMarkup;
vm.createContext(sandbox);
for (const name of ['openGrading','gradingScreen','choiceReview','gradingRecovery','publicTableSyncNotice']) {
  const source = appFunction(name); if (source) vm.runInContext(source, sandbox);
}
await check('Viewing an ordinary test does not create an unfinished grading draft', async() => {
  await sandbox.openGrading(plainResult.id);
  assert.equal(Object.hasOwn(account.gradingDrafts, plainResult.id), false);
});
await check('Reopening an ordinary test removes its legacy empty grading draft', async() => {
  account.gradingDrafts[plainResult.id] = {revision:0, items:{}, request:null};
  await sandbox.openGrading(plainResult.id);
  assert.equal(Object.hasOwn(account.gradingDrafts, plainResult.id), false);
});
await check('Account migration removes empty artifacts while preserving unfinished written comments', () => {
  const data = {tests:[], gradingDrafts:{old:{revision:0, items:{}}, written:{revision:1, items:{question:{points:'', comment:'Незбережений коментар'}}}}};
  const migration = {S:{accounts:{teacher:data}}, user:()=>({id:'teacher',role:'instructor'}), id:C.id, C, cadetViews:new WeakMap()};
  vm.createContext(migration);
  vm.runInContext(appFunction('account'), migration);
  migration.account();
  assert.equal(Object.hasOwn(data.gradingDrafts,'old'),false);
  assert.equal(data.gradingDrafts.written.items.question.comment,'Незбережений коментар');
});
await check('Ordinary results show correctness and have no unusable grading action', () => {
  const html = sandbox.gradingScreen();
  assert.match(html, /Відповідь правильна/);
  assert.match(html, /Правильна відповідь/);
  assert.doesNotMatch(html, /data-action="save-grades"/);
  assert.doesNotMatch(html, /data-grade=/);
});
await check('The shared review distinguishes full matches, partial answers, wrong answers and skips', () => {
  assert.equal(typeof sandbox.choiceReview, 'function');
  const row = api('GET', '/api/results/'+plainResult.id+'/review', instructorToken).review[0];
  const correct = sandbox.choiceReview(row, true);
  assert.match(correct, /choice-review correct/);
  assert.match(correct, /Перший &lt;варіант&gt;/);
  assert.match(correct, /Другий &amp; варіант/);
  assert.doesNotMatch(correct, /Перший <варіант>/);
  const partial = sandbox.choiceReview({...row, selectedAnswerIds:row.selectedAnswerIds.slice(0,1)});
  assert.match(partial, /choice-review incorrect/);
  const wrong = sandbox.choiceReview({...row, selectedAnswerIds:[plain.questions[0].answers[2].id]});
  assert.match(wrong, /Відповідь неправильна/);
  const skipped = sandbox.choiceReview({...row, selectedAnswerIds:[], selectedAnswerText:''});
  assert.match(skipped, /choice-review skipped/);
  assert.match(skipped, /Питання пропущено/);
});
await check('Written grading keeps editable scores and comments without choice coloring', async() => {
  await sandbox.openGrading(mixedResult.id);
  const html = sandbox.gradingScreen();
  assert.match(html, /data-action="save-grades"/);
  assert.match(html, /data-grade-prop="points"/);
  assert.match(html, /data-grade-prop="comment"/);
  assert.equal((html.match(/choice-review /g)||[]).length, 1);
});
await check('The cadet result uses the same review without requiring a full-test cache', () => {
  sandbox.lastResult = api('GET','/api/results/'+plainResult.id+'/review',cadet.token);
  sandbox.lastResult.testId = plain.id;
  sandbox.stat = (label,value)=>label+': '+value;
  sandbox.time = seconds=>String(seconds);
  sandbox.writtenReview = ()=>{throw Error('No written answer expected');};
  vm.runInContext(appFunction('resultScreen'), sandbox);
  const html = sandbox.resultScreen();
  assert.match(html,/choice-review correct/);
  assert.match(html,/Ваша відповідь/);
  assert.match(html,/Другий &amp; варіант/);
});
await check('Reloading after another instructor’s change preserves local unsaved comments for comparison', async() => {
  const questionId = mixed.questions[1].id;
  const draft = account.gradingDrafts[mixedResult.id];
  draft.revision = 1;
  draft.items[questionId] = {points:'3',comment:'Незбережена <правка>'};
  await sandbox.openGrading(mixedResult.id,true);
  const latest = account.gradingDrafts[mixedResult.id];
  assert.equal(latest.items[questionId].points,'2');
  assert.equal(latest.items[questionId].comment,'Перший коментар');
  assert.equal(latest.previousItems?.[questionId]?.comment,'Незбережена <правка>');
  assert.match(sandbox.gradingScreen(),/Незбережена &lt;правка&gt;/);
  await sandbox.openGrading(mixedResult.id,true);
  assert.equal(account.gradingDrafts[mixedResult.id].previousItems[questionId].comment,'Незбережена <правка>');
  assert.equal(api('GET','/api/results/'+mixedResult.id+'/review',other.token).result.gradingRevision,2);
});
await check('Recovered local comments can synchronize through the unchanged account-state API', () => {
  const key='grading:'+mixedResult.id;
  api('POST','/api/account-state/document',instructorToken,{key,expectedRevision:0,requestId:'audit-recovery-document',value:account.gradingDrafts[mixedResult.id]});
  const document=api('GET','/api/account-state/document',instructorToken,{key}).document;
  assert.equal(document.value.previousItems[mixed.questions[1].id].comment,'Незбережена <правка>');
  assert.equal(document.value.items[mixed.questions[1].id].comment,'Перший коментар');
});
const report = {status:checks.every(c=>c.status==='passed')?'passed':'failed', checks, passed:checks.filter(c=>c.status==='passed').length, total:checks.length, liveAccountsModified:false};
fs.mkdirSync(new URL('../verification/',import.meta.url), {recursive:true});
fs.writeFileSync(new URL('../verification/review-audit.json',import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if (report.status !== 'passed') process.exitCode = 1;
