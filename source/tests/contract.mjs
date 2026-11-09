import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as C from '../web/core.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,instructorToken}=await import('./fixtures/server_model.mjs');
const results=[];
function check(label,run){run();results.push(label);}
const password='Пароль-PC-2026!';
const cred=await C.credential(password);
check('PBKDF2 120000 SHA256 matches the server credential',()=>assert.equal(cred.passwordHash,crypto.pbkdf2Sync(password,Buffer.from(cred.passwordSalt,'base64'),120000,32,'sha256').toString('base64')));
const group=api('POST','/api/instructor/groups',instructorToken,{name:'ПК — група синхронізації'}).group;
const cadet=api('POST','/api/register','',{fullName:'Тестовий Курсант ПК',username:'pc_contract',groupId:group.id,...cred});
const challenge=api('POST','/api/challenge','',{username:'pc_contract',groupName:group.name});
const login=api('POST','/api/login','',{username:'pc_contract',groupName:group.name,nonce:challenge.nonce,proof:await C.proof(password,challenge.salt,challenge.nonce)});
check('Desktop challenge proof accepted by unchanged server',()=>assert.equal(String(login.user.id),String(cadet.user.id)));
const d=C.newDraft();d.title='Тест із ПК';d.assignedGroups=[group.name];d.questions[0].text='Що вимірює висотомір?';d.questions[0].answers[0].text='Висоту';d.questions[0].answers[1].text='Курс';d.mode='training';d.durationMinutes=20;
check('Editor validation and group encoding',()=>{assert.equal(C.validateDraft(d),'');assert.deepEqual(C.groupsFrom(C.draftAPI(d).description),[group.name]);});
check('Maximum editor content survives the real server and seven answers are rejected locally',()=>{
 const boundary=structuredClone(d);boundary.title='Граничні значення ПК';boundary.description='О'.repeat(2000);
 boundary.questions[0].text='П'.repeat(1000);boundary.questions[0].explanation='П'.repeat(2000);
 boundary.questions[0].answers=Array.from({length:6},(_,i)=>({id:'0',text:'В'.repeat(500),isCorrect:i===0}));
 assert.equal(C.validateDraft(boundary),'');const stored=api('POST','/api/instructor/tests',instructorToken,C.draftAPI(boundary)).test;
 assert.equal(stored.questions[0].answers.length,6);assert.equal(stored.questions[0].text.length,1000);
 boundary.questions[0].answers.push({id:'0',text:'Сьома',isCorrect:false});assert.ok(C.validateDraft(boundary),'Seven answers must be rejected before contacting a six-answer server');
});
check('Overlong question, answer, explanation and description fail before upload',()=>{
 for(const change of [v=>v.questions[0].text='П'.repeat(1001),v=>v.questions[0].answers[0].text='В'.repeat(501),v=>v.questions[0].explanation='П'.repeat(2001),v=>v.description='О'.repeat(2001)]){
  const invalid=structuredClone(d);change(invalid);assert.ok(C.validateDraft(invalid),'Desktop validation must match the server limits');
 }
});
check('Completed answer review resolves correct, incorrect and skipped options by ID',()=>{
 const questions=[{id:'q',text:'Висота?',answers:[{id:'b',text:'Компас'},{id:'a',text:'Висотомір'}]}];
 const rows=['a','b','0'].map(selectedAnswerId=>({questionId:'q',selectedAnswerId,correctAnswerId:'a'}));
 const review=C.enrichReview(rows,{questions});
 assert.deepEqual(review.map(r=>r.selectedAnswerText),['Висотомір','Компас','Без відповіді']);
 assert.ok(review.every(r=>r.correctAnswerText==='Висотомір'));
 assert.ok(rows.every(r=>!('selectedAnswerText' in r)));
});
check('Stored review survives loss of full-test cache',()=>{
 const row={questionId:'q',selectedAnswerId:'b',correctAnswerId:'a',selectedAnswerText:'Компас',correctAnswerText:'Висотомір'};
 const review=C.enrichReview([row],null)[0];assert.equal(review.selectedAnswerText,'Компас');assert.equal(review.correctAnswerText,'Висотомір');
 assert.equal(C.enrichReview([{questionId:'q',selectedAnswerId:'unknown'}],null)[0].selectedAnswerText,'Відповідь недоступна');
});
check('Legacy personal retakes are excluded from cadet tests',()=>{
 const original={id:'original',description:''},retake={id:'retry',description:'[[LK-RETRY:cadet-1]]'};
 assert.deepEqual(C.cadetTests([original,retake]),[original]);
});
const test=api('POST','/api/instructor/tests',instructorToken,C.draftAPI(d)).test;
const workspace=api('GET','/api/cadet/workspace',cadet.token);
check('Test created on PC visible to the cadet workspace',()=>assert.ok(workspace.tests.some(v=>String(v.id)===String(test.id))));
check('New desktop test is visible but closed until an instructor opens it',()=>assert.equal(workspace.tests.find(v=>String(v.id)===String(test.id)).access.open,false));
api('POST','/api/instructor/tests/'+test.id+'/access',instructorToken,{expectedRevision:1,scope:'all',open:true});
const started=api('POST','/api/tests/'+test.id+'/start',login.token,{submissionId:'pc-contract-stable-id'}),full=started.test;
check('Cadet response omits correct answers',()=>assert.ok(!Object.hasOwn(full.questions[0].answers[0],'isCorrect')));
const run={test:full,startPermit:started.startPermit,startedUptime:10000,answers:{[full.questions[0].id]:full.questions[0].answers[0].id},submissionId:'pc-contract-stable-id',exitCount:1};
const body=C.submission(run,40000);
check('Wire body uses the configured server fields and monotonic duration',()=>{assert.equal(body.durationSeconds,30);assert.equal(body.examExitCount,1);assert.equal(body.examPinned,false);assert.ok(!JSON.stringify(C.payload('POST','/api/results',login.token,body)).includes(password));});
const accepted=api('POST','/api/results',login.token,body);
check('Score computed by server',()=>assert.equal(accepted.result.score,100));
check('Result shared with cadet and instructor',()=>{assert.ok(api('GET','/api/my-results',cadet.token).results.some(r=>r.id===accepted.result.id));assert.ok(api('GET','/api/instructor/results',instructorToken).results.some(r=>r.id===accepted.result.id));});
const retry=api('POST','/api/results',login.token,body);
check('Lost reply retry is idempotent',()=>assert.equal(retry.result.id,accepted.result.id));
check('Retake from another device is rejected globally',()=>assert.throws(()=>api('POST','/api/results',cadet.token,{...body,submissionId:'another-device-id'}),x=>x.code==='ALREADY_COMPLETED'));
check('Merge retains acknowledgements during refresh',()=>assert.equal(C.mergeResults([accepted.result],[accepted.result]).length,1));
check('CSV quotes and protects spreadsheet formulas',()=>{const csv=C.resultCSV([{...accepted.result,userName:' =HYPERLINK("x")'}]);assert.ok(csv.includes('"\' =HYPERLINK(""x"")"'));assert.equal(csv.charCodeAt(0),0xfeff);});
check('Transient failures keep the queue retryable',()=>{for(const code of ['BUSY','HTTP_429','NETWORK','HTTP_AUTH','SERVER_ERROR'])assert.ok(C.retryable(code));assert.ok(!C.retryable('TEST_NOT_FOUND'));assert.equal(C.retryDelay(1,()=>0),5000);});
check('Existing instructor username title retained',()=>assert.equal(C.titleOf({role:'instructor',username:'WindRoy',fullName:'Денис'}),'Розробник'));
check('Closing journal restores last editor field and avoids stale overwrite',()=>{const draft=C.newDraft(),s={accounts:{'1':{draft}}};const j={kind:'draft',userId:'1',localId:draft.localId,revision:1,patch:{scope:'question',q:0,prop:'text',value:'Остання правка'}};assert.ok(C.applyCheckpoint(s,j));assert.equal(draft.questions[0].text,'Остання правка');draft.questions[0].text='Новіша';assert.ok(!C.applyCheckpoint(s,j));assert.equal(draft.questions[0].text,'Новіша');});
check('Close checkpoint restores exam answers and interruption flag',()=>{const r={...run,localRevision:0},s={accounts:{'1':{run:r}}};assert.ok(C.applyCheckpoint(s,{kind:'run',userId:'1',submissionId:r.submissionId,revision:2,answers:run.answers,index:0,lastElapsed:25,exitCount:3,interrupted:true}));assert.equal(r.interrupted,true);assert.equal(r.lastElapsed,25);assert.deepEqual(r.answers,run.answers);assert.equal(C.submission(r,40000).examExitCount,3);});
check('Checkpoint cannot mutate another account or unrelated test',()=>{const s={accounts:{'1':{run:structuredClone(run)}}};assert.ok(!C.applyCheckpoint(s,{kind:'run',userId:'2',submissionId:run.submissionId,revision:1}));assert.ok(!C.applyCheckpoint(s,{kind:'run',userId:'1',submissionId:'different',revision:1}));});
check('Native and web endpoints use the same HTTPS commission API',()=>{const url=new URL(C.CLOUD_URL),native=fs.readFileSync(new URL('../native/main.c',import.meta.url),'utf8');assert.equal(url.protocol,'https:');assert.equal(url.hostname,'script.google.com');assert.ok(native.includes(url.hostname));assert.ok(native.includes(url.pathname));});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/contract.json',import.meta.url),JSON.stringify({kind:'real_server_logic_local_model',productionVerified:false,passed:results.length,checks:results},null,2));
console.log('Desktop/server contract: '+results.length+'/'+results.length+' checks passed.');
