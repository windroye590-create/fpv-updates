import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,spreadsheet,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const props=context.PropertiesService.getScriptProperties(),teacher=api('GET','/api/workspace',instructorToken).user;
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Стрес нового набору'}).group;
const questions=Array.from({length:200},(_,i)=>({text:('Велике питання '+i+' '+('а'.repeat(1000))).slice(0,1000),explanation:'Пояснення '.repeat(100),answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}));
const test=api('POST','/api/instructor/tests',instructorToken,{title:'200 питань залишаються після очищення',published:true,mode:'training',questions}).test;
const expectedQuestions=JSON.stringify(context.getTestById_(test.id).questions);
const cadetCount=2000,resultCount=10000,users=spreadsheet.getSheetByName('_Користувачі'),results=spreadsheet.getSheetByName('_Результати_дані'),state=spreadsheet.getSheetByName('_Чернетки_ПК');
const creds=credential('synthetic-stress-password');
const draft={localId:'stress-draft',title:'Зберегти чернетку інструктора',description:'',questions:[]};
const json=JSON.stringify(draft),digest=crypto.createHash('sha256').update(json).digest('hex');
const retained=[];
for(let i=0;i<cadetCount;i++){
 const id=String(20000+i);users.appendRow([id,'intake-stress-'+i,'Стрес курсант '+i,group.name,'cadet',creds.passwordHash,creds.passwordSalt,true,new Date()]);
 const value=[teacher.id,'test-draft',i+1,'teacher-stress-'+i,0,1,new Date(),'stress-'+i,digest,'json:'+json];
 const header=[...value];header[4]=-1;header[9]='';state.appendRow(value);state.appendRow(header);retained.push([...value],[...header]);
 state.appendRow([id,'training',1,'cadet-'+i,0,1,new Date(),'request-'+i,digest,'json:'+json]);state.appendRow([id,'training',1,'cadet-'+i,-1,1,new Date(),'request-'+i,digest,'']);
 props.setProperty('LK_PC_STATE_'+id,'stress');
}
props.setProperty('NEXT_ID_USER','22000');
for(let i=0;i<resultCount;i++){
 const id=String(20000+i%cadetCount);results.appendRow(['stress-result-'+i,id,'Стрес курсант '+i,group.name,test.id,test.title,50,100,200,120,new Date(),false,'stress-submission-'+i,'{}',0,false,'auto',100,200,200,0,0,'[]',false,'','']);
}
const privateBook=context.publicResultsSpreadsheet_(false),publicResults=privateBook.getSheetByName('Результати курсантів');
for(let i=0;i<resultCount;i++)publicResults.appendRow(['Стрес курсант '+i,100,100,'02:00',50,test.title,String(20000+i%cadetCount),'stress-result-'+i,'auto',100,200,50]);
const secret=props.getProperty('APP_SECRET'),instructorDraftBefore=JSON.stringify(state.rows.filter(r=>String(r[0])===String(teacher.id)&&r[1]==='test-draft'));
let deleteCalls=0,propertyCalls=0,maxDeletes=0,maxProperties=0;
for(const sheet of spreadsheet.getSheets().concat(privateBook.getSheets())){
 const original=sheet.deleteRows;sheet.deleteRows=function(...args){deleteCalls++;return original.apply(this,args);};
}
const deleteProperty=props.deleteProperty;props.deleteProperty=function(...args){propertyCalls++;return deleteProperty.apply(this,args);};
const preview=api('GET','/api/instructor/intake',instructorToken);
assert.ok(preview.preview.cadets>=cadetCount);assert.ok(preview.preview.results>=resultCount);
const started=performance.now();
let job=api('POST','/api/instructor/intake/start',instructorToken,{requestId:crypto.randomUUID(),previewToken:preview.previewToken,confirmation:'НОВИЙ НАБІР'}).intake,calls=0;
while(job.state!=='completed'){
 assert.ok(++calls<500,'Cleanup must make bounded forward progress');deleteCalls=0;propertyCalls=0;
 job=api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}).intake;
 maxDeletes=Math.max(maxDeletes,deleteCalls);maxProperties=Math.max(maxProperties,propertyCalls);
 assert.ok(deleteCalls<=20,'One batch exceeds the spreadsheet operation limit');assert.ok(propertyCalls<=32,'One batch exceeds the property operation limit');
}
assert.equal(context.listUsers_().filter(u=>u.role==='cadet').length,0);
assert.equal(results.getLastRow(),1);assert.equal(publicResults.getLastRow(),1);
assert.equal(JSON.stringify(context.getTestById_(test.id).questions),expectedQuestions);
assert.equal(api('GET','/api/instructor/tests/'+test.id+'/access',instructorToken).test.access.defaultOpen,false);
assert.equal(JSON.stringify(state.rows.filter(r=>String(r[0])===String(teacher.id)&&r[1]==='test-draft')),instructorDraftBefore);
assert.equal(props.getProperty('APP_SECRET'),secret);assert.ok(context.findUserById_(teacher.id));assert.ok(context.findGroupById_(group.id));
const report={status:'passed',syntheticCadets:cadetCount,syntheticResults:resultCount,questionCount:200,requests:calls,maxRowDeletesPerRequest:maxDeletes,maxPropertyDeletesPerRequest:maxProperties,localModelMs:Math.round(performance.now()-started),liveAccountsModified:false};
fs.writeFileSync(new URL('../verification/intake-stress.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
