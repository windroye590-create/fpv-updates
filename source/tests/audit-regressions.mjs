// Full-audit regressions. Synthetic Sheets and identities; no production calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,spreadsheet,instructorToken,credential ,seedLegacyRetry}=await import('./fixtures/server_model.mjs');
const checks=[],failures=[];
async function check(name,fn){try{await fn();checks.push(name);console.log('PASS '+name);}catch(error){failures.push({name,error:error.message,code:error.code});console.error('FAIL '+name+': '+error.message);}}
const props=context.PropertiesService.getScriptProperties();
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Audit isolated group'}).group;
const cadet=api('POST','/api/register','',{username:'audit_regression',fullName:'Audit Synthetic Cadet',groupId:group.id,...credential('audit-original-password')});
await check('Another instructor cannot read current or legacy invitation secrets through the shared audit log',()=>{
 const consumed=api('POST','/api/instructor/invite',instructorToken).code;
 const other=api('POST','/api/instructor/register','',{username:'audit_other_teacher',fullName:'Audit Other Teacher',inviteCode:consumed,...credential('audit-other-teacher-password')});
 const live=api('POST','/api/instructor/invite',instructorToken).code;
 const raw=spreadsheet.getSheetByName('_Журнал_дій');assert.equal(raw.rows.some(row=>row[5]===live),false);
 // Keep the private historical row to test redaction without migrating data.
 raw.appendRow(['audit-legacy-invite','teacher','Synthetic teacher','INVITE_CREATE','instructor-invite',live,'Код запрошення інструктора','Legacy synthetic secret',new Date()]);
 const log=api('GET','/api/instructor/audit',other.token);assert.equal(JSON.stringify(log).includes(live),false);
 assert.equal(api('GET','/api/instructor/invite',other.token).code,'');assert.equal(api('GET','/api/instructor/invite',instructorToken).code,live);
});
await check('A transient public spreadsheet failure cannot replace the configured book or its sharing',()=>{
 const id=props.getProperty('PUBLIC_RESULTS_SPREADSHEET_ID'),open=context.SpreadsheetApp.openById,create=context.SpreadsheetApp.create;let created=0;
 context.publicResultsSpreadsheetCache_=null;context.publicResultsSheetCache_=null;
 context.SpreadsheetApp.openById=function(value){if(value===id)throw Error('Synthetic Sheets outage');return open.call(this,value);};
 context.SpreadsheetApp.create=function(...args){created++;return create.apply(this,args);};
 try{assert.throws(()=>context.publicResultsSpreadsheet_(true),e=>e.code==='PUBLIC_RESULTS_UNAVAILABLE');assert.equal(created,0);assert.equal(props.getProperty('PUBLIC_RESULTS_SPREADSHEET_ID'),id);}
 finally{context.SpreadsheetApp.openById=open;context.SpreadsheetApp.create=create;props.setProperty('PUBLIC_RESULTS_SPREADSHEET_ID',id);context.publicResultsSpreadsheetCache_=null;context.publicResultsSheetCache_=null;}
});
await check('An unavailable public book remains configured and reopens after the service recovers',()=>{
 const id=props.getProperty('PUBLIC_RESULTS_SPREADSHEET_ID'),open=context.SpreadsheetApp.openById;context.publicResultsSpreadsheetCache_=null;
 context.SpreadsheetApp.openById=function(value){if(value===id)throw Error('Synthetic read outage');return open.call(this,value);};
 try{assert.equal(context.publicResultsSpreadsheet_(false),null);assert.equal(props.getProperty('PUBLIC_RESULTS_SPREADSHEET_ID'),id);}
 finally{context.SpreadsheetApp.openById=open;}
 assert.equal(context.publicResultsSpreadsheet_(true).getId(),id);
});
await check('Failure to revoke sessions leaves the previous password and session intact',()=>{
 const before=context.findUserById_(cadet.user.id),set=props.setProperty;
 props.setProperty=function(key,value){if(key==='SESSION_VERSION_'+cadet.user.id)throw Error('Synthetic session-version write failure');return set.call(this,key,value);};
 try{assert.throws(()=>api('POST','/api/instructor/users/'+cadet.user.id+'/password',instructorToken,credential('audit-new-password')));assert.equal(context.findUserById_(cadet.user.id).passwordHash,before.passwordHash);assert.equal(context.findUserById_(cadet.user.id).passwordSalt,before.passwordSalt);assert.equal(String(context.requireSession_(cadet.token).id),String(cadet.user.id));}
 finally{props.setProperty=set;}
});
await check('A delayed login checked against the old password cannot issue a usable session after a password change',()=>{
 const stale=context.findUserById_(cadet.user.id);
 const challenge=api('POST','/api/challenge','',{username:stale.username,groupName:stale.groupName});
 const proof=crypto.createHmac('sha256',Buffer.from(stale.passwordHash,'base64')).update(challenge.nonce).digest('base64');
 const verify=context.hmacPasswordProof_;let changed=false,delayed;
 context.hmacPasswordProof_=function(...args){const expected=verify.apply(this,args);if(!changed&&args[0]===challenge.nonce){changed=true;api('POST','/api/instructor/users/'+cadet.user.id+'/password',instructorToken,credential('audit-final-password'));}return expected;};
 try{delayed=api('POST','/api/login','',{username:stale.username,groupName:stale.groupName,nonce:challenge.nonce,proof}).token;}
 finally{context.hmacPasswordProof_=verify;}
 assert.ok(changed);assert.throws(()=>context.requireSession_(delayed),e=>e.code==='SESSION_EXPIRED');
 assert.throws(()=>context.requireSession_(cadet.token),e=>e.code==='SESSION_EXPIRED');
 cadet.token=context.issueToken_(context.findUserById_(cadet.user.id));assert.equal(String(context.requireSession_(cadet.token).id),String(cadet.user.id));
});
await check('Existing signed sessions remain compatible until their credential version is revoked',()=>{
 const current=context.issueToken_(context.findUserById_(cadet.user.id)),payload=JSON.parse(context.base64UrlToText_(current.split('.')[0]));delete payload.c;
 const encoded=context.base64UrlText_(JSON.stringify(payload)),legacy=encoded+'.'+context.signText_(encoded);
 assert.equal(String(context.requireSession_(legacy).id),String(cadet.user.id));
 api('POST','/api/instructor/users/'+cadet.user.id+'/password',instructorToken,credential('audit-later-password'));
 assert.throws(()=>context.requireSession_(legacy),e=>e.code==='SESSION_EXPIRED');cadet.token=context.issueToken_(context.findUserById_(cadet.user.id));
});
const questions=Array.from({length:60},(_,i)=>({text:('Audit question '+i+' ').padEnd(1000,'Q'),answers:[{text:'Yes',isCorrect:true},{text:'No',isCorrect:false}]}));
const make=title=>api('POST','/api/instructor/tests',instructorToken,{title,mode:'training',published:true,questions}).test;
const first=make('Audit retained first');
const result=api('POST','/api/results',cadet.token,{testId:first.id,submissionId:'audit-long-submission-12345',writtenProtocol:1,choiceProtocol:2,durationSeconds:60,answers:first.questions.map(q=>({questionId:q.id,answerId:q.answers[0].id}))}).result;
const retry=seedLegacyRetry(first,cadet.user.id,result.id);
const last=make('Audit retained after private retry');
const parts=spreadsheet.getSheetByName('_Частини_тестів'),catalog=spreadsheet.getSheetByName('_Тести');
await check('A valid 200-question draft above 2M characters synchronizes within the documented 2.8M limit',()=>{
 const value={localId:'audit-large-sync',title:'Audit escaped draft',description:'',questions:Array.from({length:200},()=>({text:'"'.repeat(1000),explanation:'"'.repeat(2000),rubric:'"'.repeat(1000),answers:Array.from({length:6},(_,i)=>({text:'A'.repeat(500),isCorrect:i===0}))}))};
 assert.ok(JSON.stringify(value).length>2000000&&JSON.stringify(value).length<2800000);
 const old=api('GET','/api/account-state/document',instructorToken,{key:'test-draft'}).document;
 const reply=api('POST','/api/account-state/document',instructorToken,{key:'test-draft',expectedRevision:old.revision,requestId:'audit-large-draft-sync-12345',value});
 assert.equal(JSON.stringify(reply.document.value),JSON.stringify(value));
 const again=api('GET','/api/account-state/document',instructorToken,{key:'test-draft'}).document;assert.equal(JSON.stringify(again.value),JSON.stringify(value));
 assert.throws(()=>api('POST','/api/account-state/document',instructorToken,{key:'test-draft',expectedRevision:again.revision,requestId:'audit-overlarge-sync-12345',value:{...value,overflow:'X'.repeat(700000)}}),e=>e.code==='PAYLOAD_TOO_LARGE');
 assert.equal(api('GET','/api/account-state/document',instructorToken,{key:'test-draft'}).document.revision,again.revision);
});
await check('A retained large test is readable after orphan part rows were deleted by an older cleanup',()=>{
 const saved=structuredClone(parts.rows);
 try{for(let i=parts.rows.length-1;i>=1;i--)if(String(parts.rows[i][0])===String(retry.id))parts.deleteRow(i+1);assert.deepEqual(JSON.parse(JSON.stringify(context.getTestById_(last.id).questions)),last.questions);}
 finally{parts.rows=saved;}
});
await check('Relocation recovery still rejects modified question bytes instead of accepting an unverified test',()=>{
 const saved=structuredClone(parts.rows);
 try{for(let i=parts.rows.length-1;i>=1;i--)if(String(parts.rows[i][0])===String(retry.id))parts.deleteRow(i+1);const row=parts.rows.find(r=>String(r[0])===String(last.id));row[4]=row[4].replace('Audit question','ALTERED QUESTION');assert.throws(()=>context.getTestById_(last.id),e=>e.code==='TEST_DATA_INCOMPLETE');}
 finally{parts.rows=saved;}
});
await check('New-intake cleanup keeps large public tests readable even when clearing orphan chunks loses its acknowledgement',()=>{
 const before=JSON.parse(catalog.rows.find(r=>String(r[0])===String(last.id))[7].slice('[[LK-TEST-PARTS:1]]'.length));
 const preview=api('GET','/api/instructor/intake',instructorToken);let job=api('POST','/api/instructor/intake/start',instructorToken,{requestId:'audit-cleanup-request-12345',confirmation:'НОВИЙ НАБІР',previewToken:preview.previewToken}).intake;
 let attempts=0,injected=false;
 while(job.state!=='completed'){
  assert.ok(++attempts<100);
  const getRange=parts.getRange;
  parts.getRange=function(...args){const range=getRange.apply(this,args),set=range.setValues;if(!injected&&args[0]>=2)range.setValues=function(values){const answer=set.call(this,values);if(values.every(row=>row.every(x=>x===''))){injected=true;throw Error('Synthetic lost cleanup acknowledgement');}return answer;};return range;};
  try{job=api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}).intake;}
  catch(error){if(!injected||!String(error.message).includes('Synthetic lost cleanup'))throw error;}
  finally{parts.getRange=getRange;}
 }
 assert.ok(injected);assert.deepEqual(JSON.parse(JSON.stringify(context.getTestById_(first.id).questions)),first.questions);assert.deepEqual(JSON.parse(JSON.stringify(context.getTestById_(last.id).questions)),last.questions);
 const after=JSON.parse(catalog.rows.find(r=>String(r[0])===String(last.id))[7].slice('[[LK-TEST-PARTS:1]]'.length));assert.equal(after.firstRow,before.firstRow);
 assert.equal(parts.rows.some(r=>String(r[0])===String(retry.id)),false);assert.equal(context.findUserById_(cadet.user.id),null);
});
const report={status:failures.length?'failed':'passed',passed:checks.length,failed:failures.length,checks,failures,productionRequests:0};
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/audit-regressions.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(failures.length)process.exitCode=1;
