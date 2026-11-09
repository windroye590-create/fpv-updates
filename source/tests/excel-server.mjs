import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as C from '../web/core.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken,regressionTest,regressionBody}=await import('./fixtures/server_model.mjs');
const checks=[];function check(name,run){run();checks.push(name);console.log('PASS '+name);}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Excel — група'}).group;
const cadet=api('POST','/api/register','',{groupId:group.id,username:'excel_cadet',fullName:'Курсант Excel',...credential('excel-password')});
const test=regressionTest('Тест Excel');api('POST','/api/results',cadet.token,regressionBody(test,'excel-one-result'));
check('Report endpoints require an instructor and do not expose credentials or answer keys',()=>{
 for(const path of ['/api/instructor/reports/results','/api/instructor/intake/archives','/api/instructor/intake/archive'])assert.throws(()=>api('GET',path,cadet.token),e=>e.code==='FORBIDDEN');
 const r=api('GET','/api/instructor/reports/results',instructorToken);assert.equal(r.reportProtocol,1);assert.equal(String(r.userId),String(context.requireSession_(instructorToken).id));assert.doesNotMatch(JSON.stringify(r),/passwordHash|passwordSalt|"isCorrect"|"questions"/);
});
check('Group, test and search filters select the complete intended export',()=>{
 const r=api('GET','/api/instructor/reports/results',instructorToken,{groupId:String(group.id),testId:String(test.id),query:'Курсант Excel'});assert.equal(r.results.length,1);assert.equal(r.cadets.length,1);assert.equal(r.tests.length,1);
 assert.throws(()=>api('GET','/api/instructor/reports/results',instructorToken,{groupId:'missing'}),e=>e.code==='GROUP_NOT_FOUND');
});
const preview=api('GET','/api/instructor/intake',instructorToken),before=JSON.stringify(context.listResults_(null)),count=context.listUsers_().filter(u=>u.role==='cadet').length;
let job=api('POST','/api/instructor/intake/start',instructorToken,{requestId:'excel-archive-request-123',previewToken:preview.previewToken,confirmation:'НОВИЙ НАБІР',archiveName:'Навчальний набір Excel',archiveRequired:false,timezoneOffsetMinutes:-180}).intake;
check('A new cleanup cannot disable its automatic archive',()=>{assert.equal(job.archiveRequired,true);assert.equal(job.archive,null);assert.equal(job.phase,0);assert.equal(job.archiveName,'Навчальний набір Excel');});
let created=0;const create=context.SpreadsheetApp.create,zip=context.Utilities.zip;
context.SpreadsheetApp.create=(...a)=>{created++;return create(...a);};
check('An archive write failure leaves every result and account available',()=>{
 context.Utilities.zip=()=>{throw Error('Injected ZIP failure');};try{assert.throws(()=>api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}),/Injected ZIP/);}finally{context.Utilities.zip=zip;}
 assert.equal(api('GET','/api/instructor/intake',instructorToken).intake.phase,0);assert.equal(JSON.stringify(context.listResults_(null)),before);assert.equal(context.listUsers_().filter(u=>u.role==='cadet').length,count);assert.equal(created,1);
});
const sheet=context.sheet_('intakeJobs'),append=sheet.appendRow;
check('A lost archive commit acknowledgement is recoverable without clearing data',()=>{
 sheet.appendRow=function(row){const value=append.call(this,row);if(row[1]==='archive-meta')throw Error('Lost archive metadata acknowledgement');return value;};
 try{assert.throws(()=>api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}),/Lost archive/);}finally{sheet.appendRow=append;}
 assert.equal(JSON.stringify(context.listResults_(null)),before);assert.equal(created,1);
});
const archiveBook=()=>context.SpreadsheetApp.openById(context.intakeJob_(job.id).value.archiveBookId);
const chunkCount=()=>archiveBook().getSheetByName('_Файл_Excel').getLastRow()-1;
const stored=chunkCount();
check('Retry reuses the committed archive, original book and exact saved chunks',()=>{
 job=api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}).intake;assert.ok(job.archive);assert.equal(job.phase,0);assert.equal(chunkCount(),stored);assert.equal(created,1);assert.equal(job.archive.name.endsWith('.xlsx'),true);
 assert.deepEqual(Array.from(context.SpreadsheetApp.openById(job.archive.id).getSheets()).filter(s=>!s.isSheetHidden()).map(s=>s.getName()),['Результати','Відомість групи','Зведення']);
});
let downloaded;
check('The archived Excel downloads with a matching checksum before any erasure',()=>{
 const first=api('GET','/api/instructor/intake/archive',instructorToken,{jobId:job.id,part:0}),parts=[first.data];for(let i=1;i<first.totalParts;i++)parts.push(api('GET','/api/instructor/intake/archive',instructorToken,{jobId:job.id,part:i}).data);
 downloaded=Buffer.from(parts.join(''),'base64');assert.equal(crypto.createHash('sha256').update(downloaded).digest('hex'),job.archive.sha256);assert.equal(downloaded.length,job.archive.size);assert.equal(downloaded.subarray(0,2).toString(),'PK');assert.equal(JSON.stringify(context.listResults_(null)),before);
 const path=new URL('../verification/intake-archive.xlsx',import.meta.url);fs.writeFileSync(path,downloaded);
 execFileSync('python3',['-c',"import sys,zipfile;from openpyxl import load_workbook;p=sys.argv[1];z=zipfile.ZipFile(p);assert z.testzip() is None;w=load_workbook(p);assert w.sheetnames==['Результати','Відомість групи','Зведення']",path.pathname],{stdio:'pipe'});
});
check('Corrupt archive chunks block both downloading and the first destructive step',()=>{
 const row=archiveBook().getSheetByName('_Файл_Excel').rows[1],old=row[3];row[3]='base64:A'+old.slice(8);
 try{assert.throws(()=>api('GET','/api/instructor/intake/archive',instructorToken,{jobId:job.id,part:0}),e=>e.code==='ARCHIVE_UNAVAILABLE');assert.throws(()=>api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}),e=>e.code==='ARCHIVE_UNAVAILABLE');assert.equal(JSON.stringify(context.listResults_(null)),before);}finally{row[3]=old;}
});
check('Archive requests validate the job and part instead of accepting arbitrary file IDs',()=>{
 assert.throws(()=>api('GET','/api/instructor/intake/archive',instructorToken,{jobId:'file-other',part:0}),e=>e.code==='BAD_REQUEST');assert.throws(()=>api('GET','/api/instructor/intake/archive',instructorToken,{jobId:job.id,part:-1}),e=>e.code==='BAD_REQUEST');
});
check('Completed cleanup preserves a downloadable historical workbook',()=>{
 let attempts=0;while(job.state!=='completed'){assert.ok(++attempts<200);job=api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}).intake;}
 assert.equal(context.listResults_(null).length,0);const all=api('GET','/api/instructor/intake/archives',instructorToken);assert.ok(all.archives.some(a=>a.jobId===job.id));
 const r=api('GET','/api/instructor/intake/archive',instructorToken,{jobId:job.id,part:0});assert.equal(r.sha256,crypto.createHash('sha256').update(downloaded).digest('hex'));
});
check('An empty intake still creates a valid three-sheet archive',()=>{
 const p=api('GET','/api/instructor/intake',instructorToken);let empty=api('POST','/api/instructor/intake/start',instructorToken,{requestId:'excel-empty-intake-123',previewToken:p.previewToken,confirmation:'НОВИЙ НАБІР'}).intake;
 empty=api('POST','/api/instructor/intake/continue',instructorToken,{jobId:empty.id}).intake;assert.equal(empty.results,0);assert.equal(empty.cadets,0);assert.ok(empty.archive.sha256);assert.equal(context.SpreadsheetApp.openById(empty.archive.id).getSheets().filter(s=>!s.isSheetHidden()).length,3);
});
context.SpreadsheetApp.create=create;
fs.writeFileSync(new URL('../verification/excel-server.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0,archiveChecksumVerified:true,independentExcelParser:true},null,2));
