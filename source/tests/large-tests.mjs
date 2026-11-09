// Real Code.gs, isolated Sheets only. Enforce Google's cell bound in this model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
import {createAccountSync} from '../web/account-sync.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,spreadsheet,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const checks=[],clone=x=>JSON.parse(JSON.stringify(x));
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Великі тести API17'}).group;
const cadet=api('POST','/api/register','',{fullName:'Курсант великих тестів',username:'large_tests_cadet',groupId:group.id,...credential('large-tests-password')});
const sheet=context.sheet_('tests'),parts=context.sheet_('testParts');
const proto=Object.getPrototypeOf(sheet.getRange(1,1)),setValues=proto.setValues;
proto.setValues=function(rows){for(const row of rows)for(const cell of row)assert.ok(typeof cell!=='string'||cell.length<=50000,'A Google Sheet cell cannot exceed 50000 characters');return setValues.call(this,rows);};
const q={type:'choice',text:'П'.repeat(1000),explanation:'Пояснення'.repeat(250).slice(0,2000),maxPoints:1,answers:Array.from({length:6},(_,i)=>({text:String.fromCharCode(1040+i).repeat(500),isCorrect:i<2}))};
const body={title:'200 довгих питань',mode:'training',published:true,choiceProtocol:2,writtenProtocol:1,questions:Array.from({length:200},()=>clone(q))};
const saved=api('POST','/api/instructor/tests',instructorToken,body).test;
const marker=()=>sheet.rows.find(row=>String(row[0])===String(saved.id))[7];
const expected=clone(saved.questions);
check('200 maximum-length questions and six answers save above the former one-cell limit',()=>{
 assert.equal(saved.questions.length,200);assert.ok(JSON.stringify(saved.questions).length>1000000);assert.ok(Buffer.byteLength(JSON.stringify(C.payload('POST','/api/instructor/tests',instructorToken,body)))>2000000);
 assert.ok(marker().startsWith('[[LK-TEST-PARTS:1]]'));assert.ok(parts.getLastRow()>20);
});
check('Every large test question, two-answer key and explanation round-trips exactly',()=>assert.deepEqual(clone(api('GET','/api/tests/'+saved.id,instructorToken).test.questions),expected));
check('Cadet access to a chunked test still hides the key and explanations',()=>{
 const t=api('GET','/api/tests/'+saved.id,cadet.token).test;assert.equal(t.questions.length,200);
 assert.ok(t.questions.every(q=>!Object.hasOwn(q,'explanation')&&q.answers.every(a=>!Object.hasOwn(a,'isCorrect'))));
});
check('Listing catalogs reads only metadata, never the complete question payload',()=>{
 const read=proto.getValues;proto.getValues=function(){if(this.sheet===parts)throw Error('Catalog read the question chunks');return read.call(this);};
 try{for(const token of [cadet.token,instructorToken])assert.ok(api('GET','/api/tests',token).tests.some(t=>String(t.id)===String(saved.id)&&t.questionCount===200));}finally{proto.getValues=read;}
});
const answers=saved.questions.map(q=>({questionId:q.id,answerIds:q.answers.filter(a=>a.isCorrect).map(a=>a.id)}));
const submission={testId:saved.id,submissionId:'large-test-submit',durationSeconds:60,choiceProtocol:2,writtenProtocol:1,answers};
const accepted=api('POST','/api/results',cadet.token,submission);
check('A large test grades all 200 questions and a lost acknowledgement does not duplicate it',()=>{
 assert.equal(accepted.result.correct,200);assert.equal(accepted.result.score,100);assert.equal(api('POST','/api/results',cadet.token,submission).result.id,accepted.result.id);
});
check('A missing, reordered, foreign or altered part cannot become an empty/partly graded test',()=>{
 const row=parts.rows.find(r=>String(r[0])===String(saved.id));const old=row.slice(),before=JSON.stringify(context.sheet_('results').rows);
 for(const mutation of [r=>r[0]='other-test',r=>r[1]='wrong-generation',r=>r[2]=99,r=>r[3]=99,r=>r[4]='json:changed',r=>r[4]='=IMPORTXML("x")']){
  mutation(row);assert.throws(()=>api('GET','/api/tests/'+saved.id,instructorToken),e=>e.code==='TEST_DATA_INCOMPLETE');row.splice(0,row.length,...old);
 }
 assert.equal(JSON.stringify(context.sheet_('results').rows),before);
});
check('A manifest copied from a different test is rejected before exposing its questions',()=>{
 const other=api('POST','/api/instructor/tests',instructorToken,{title:'Інший тест',questions:[q]}).test;
 const row=sheet.rows.find(r=>String(r[0])===String(other.id)),old=row[7];row[7]=marker();
 try{assert.throws(()=>api('GET','/api/tests/'+other.id,instructorToken),e=>e.code==='TEST_DATA_INCOMPLETE');}finally{row[7]=old;}
});
check('Failed or partial chunk writes publish no test; a fresh retry reads only its own generation',()=>{
 const before=sheet.getLastRow();proto.setValues=function(rows){if(this.sheet===parts){setValues.call(this,[rows[0],...rows.slice(1).map(r=>r.map(()=>''))]);throw Error('Injected incomplete chunk write');}return setValues.call(this,rows);};
 try{assert.throws(()=>api('POST','/api/instructor/tests',instructorToken,{...body,title:'Перерваний запис'}));assert.equal(sheet.getLastRow(),before);}finally{proto.setValues=function(rows){for(const row of rows)for(const cell of row)assert.ok(typeof cell!=='string'||cell.length<=50000);return setValues.call(this,rows);};}
 const retry=api('POST','/api/instructor/tests',instructorToken,{...body,title:'Після перерваного запису'}).test;assert.equal(api('GET','/api/tests/'+retry.id,instructorToken).test.questions.length,200);
});
check('Old inline JSON tests continue to load without rewriting historical rows',()=>{
 const t=api('POST','/api/instructor/tests',instructorToken,{title:'Старий формат',questions:[{text:'Коротке питання',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]}).test;
 const row=sheet.rows.find(r=>String(r[0])===String(t.id)),before=JSON.stringify(row);
 assert.ok(Array.isArray(JSON.parse(row[7])));assert.deepEqual(clone(api('GET','/api/tests/'+t.id,instructorToken).test.questions),clone(t.questions));assert.equal(JSON.stringify(row),before);
});
check('Large draft synchronization exceeds 500000 characters and preserves Unicode exactly',()=>{
 const d={...C.newDraft(),title:body.title,questions:clone(body.questions)};assert.ok(JSON.stringify(d).length>500000);
 const current=api('GET','/api/account-state/document',instructorToken,{key:'test-draft'}).document;
 const posted=api('POST','/api/account-state/document',instructorToken,{key:'test-draft',expectedRevision:current.revision,requestId:'large-draft-request',value:d});
 assert.deepEqual(posted.document.value,d);assert.deepEqual(api('GET','/api/account-state/document',instructorToken,{key:'test-draft'}).document.value,d);
});
check('A 200-question exam preserves its full private key beyond the old document limit',()=>{
 const t=api('POST','/api/instructor/tests',instructorToken,{...body,title:'Великий іспит',mode:'exam',durationMinutes:30}).test;
 const begun=api('POST','/api/exam-session/start',cadet.token,{testId:t.id,deviceId:'large-exam-device',submissionId:'large-exam-submission',requestId:'large-exam-request'});
 assert.equal(begun.document.value.test.questions.length,200);assert.equal(begun.document.value.sourceTest,undefined);
 const doc=context.examDocument_(cadet.user);assert.ok(JSON.stringify(doc.value).length>1000000);assert.deepEqual(clone(doc.value.sourceTest.questions),clone(t.questions));
});
check('Emoji at chunk boundaries never splits a UTF-16 surrogate pair',()=>{
 const emoji={...q,text:'🚁'.repeat(500),explanation:'🚁'.repeat(1000),answers:q.answers.map(a=>({...a,text:'🚁'.repeat(250)}))};
 const t=api('POST','/api/instructor/tests',instructorToken,{...body,title:'Юнікод',questions:Array.from({length:200},()=>emoji)}).test;
 assert.deepEqual(clone(api('GET','/api/tests/'+t.id,instructorToken).test.questions),clone(t.questions));
 for(const row of parts.rows.filter(r=>String(r[0])===String(t.id))){const s=row[4].slice(5),last=s.charCodeAt(s.length-1),first=s.charCodeAt(0);assert.ok(last<0xD800||last>0xDBFF);assert.ok(first<0xDC00||first>0xDFFF);}
});
check('Deleting a large test preserves the immutable parts and accepted answer review',()=>{
 const before=JSON.stringify(parts.rows);api('DELETE','/api/instructor/tests/'+saved.id,instructorToken);
 assert.equal(JSON.stringify(parts.rows),before);assert.equal(api('GET','/api/results/'+accepted.result.id+'/review',cadet.token).review.length,200);
});
check('Replacing a large test retains the original definition and result grading key',()=>{
 const old=clone(context.getTestById_(saved.id));
 const t=api('POST','/api/instructor/tests',instructorToken,{...body,title:'Замінюваний тест'}).test;
 const next=api('POST','/api/instructor/tests/'+t.id+'/replace',instructorToken,{...body,title:'Нова версія'}).test;
 assert.notEqual(next.id,t.id);assert.deepEqual(clone(context.getTestById_(t.id).questions),clone(t.questions));assert.deepEqual(clone(context.getTestById_(saved.id).questions),old.questions);
});
check('Existing schema cache cannot suppress the new parts sheet on upgrade',()=>{
 const cache=context.CacheService.getScriptCache(),before=JSON.stringify(sheet.rows),existing=spreadsheet.sheets.get('_Частини_тестів');
 spreadsheet.sheets.delete('_Частини_тестів');cache.remove('LK_SCHEMA_READY_API25');cache.put('LK_SCHEMA_READY_API23','1');
 try{context.ensureSchema_(false);assert.ok(spreadsheet.getSheetByName('_Частини_тестів'));assert.equal(JSON.stringify(sheet.rows),before);}finally{spreadsheet.sheets.set('_Частини_тестів',existing);}
});
check('Oversized question counts still fail before publishing',()=>{
 const before=sheet.getLastRow();assert.throws(()=>api('POST','/api/instructor/tests',instructorToken,{...body,questions:Array.from({length:201},()=>q)}),e=>e.code==='BAD_TEST');assert.equal(sheet.getLastRow(),before);
});
{
 const teacher=api('GET','/api/workspace',instructorToken).user,a={draft:null};
 const sync=createAccountSync({session:()=>({token:instructorToken,user:teacher}),account:()=>a,
  snapshot:a=>({'test-draft':a.draft}),apply:(key,value)=>{a.draft=value;},
  rpc:async(method,path,body,token)=>api(method,path,token,body),persist:async()=>{},delay:60000});
 try{
  await sync.sync(true);assert.ok(JSON.stringify(a.draft).length>500000);
  a.draft.description='Змінено справжнім контролером синхронізації ПК';await sync.sync(true);
  check('The actual PC sync controller uploads a changed draft above the former 500000-character limit',()=>{
   assert.equal(sync.status().error,'');assert.equal(sync.status().pending,0);
   assert.equal(api('GET','/api/account-state/document',instructorToken,{key:'test-draft'}).document.value.description,a.draft.description);
  });
 }finally{sync.reset();}
}
proto.setValues=setValues;
fs.writeFileSync(new URL('../verification/large-tests.json',import.meta.url),JSON.stringify({passed:checks.length,checks,backend:'actual Code.gs with a 50000-character cell constraint',productionWrites:false,largestQuestions:200,questionJSONCharacters:JSON.stringify(saved.questions).length,requestUTF8Bytes:Buffer.byteLength(JSON.stringify(C.payload('POST','/api/instructor/tests',instructorToken,body)))},null,2));
console.log('Large test storage: '+checks.length+' checks passed.');
