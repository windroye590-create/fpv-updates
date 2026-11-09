import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken,regressionTest,regressionBody}=await import('./fixtures/server_model.mjs');
const checks=[];function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Картки — перша'}).group;
const second=api('POST','/api/instructor/groups',instructorToken,{name:'Картки — друга'}).group;
const make=name=>api('POST','/api/register','',{fullName:'Однакове Ім’я Курсанта',username:name,groupId:group.id,...credential('card-fixture-secret')});
const a=make('card-student-a'),b=make('card-student-b'),path='/api/instructor/cadets/'+a.user.id;
const test=regressionTest('Історія картки');
const result=api('POST','/api/results',a.token,{...regressionBody(test,'card-result'),testId:test.id}).result;
check('Only instructors can load or annotate a cadet card',()=>{
 for(const token of ['',a.token,b.token]){assert.throws(()=>api('GET',path,token),e=>['SESSION_EXPIRED','FORBIDDEN'].includes(e.code));assert.throws(()=>api('POST',path+'/notes',token,{text:'Примітка',requestId:'blocked-note'}),e=>['SESSION_EXPIRED','FORBIDDEN'].includes(e.code));}
});
check('A complete card uses IDs and never exposes credentials or another namesake history',()=>{
 const r=api('GET',path,instructorToken);assert.equal(String(r.cadet.id),String(a.user.id));assert.equal(r.cadetCardProtocol,1);assert.ok(r.results.some(v=>v.id===result.id));assert.ok(r.results.every(v=>String(v.userId)===String(a.user.id)));for(const key of ['passwordHash','passwordSalt','rowNumber'])assert.ok(!(key in r.cadet));assert.equal(api('GET','/api/instructor/cadets/'+b.user.id,instructorToken).results.length,0);
});
check('Instructor accounts and missing IDs cannot be mistaken for cadets',()=>{assert.throws(()=>api('GET','/api/instructor/cadets/1',instructorToken),e=>e.code==='NOT_FOUND');assert.throws(()=>api('GET','/api/instructor/cadets/missing',instructorToken),e=>e.code==='NOT_FOUND');});
check('Notes retain their author and retry exactly once after a lost acknowledgement',()=>{
 const body={text:'=SUM(1,2)\nПотребує повторення теми <script>',requestId:'card-note-001'};
 const first=api('POST',path+'/notes',instructorToken,body),again=api('POST',path+'/notes',instructorToken,body);assert.equal(first.note.id,again.note.id);assert.equal(first.note.text,body.text);assert.ok(first.note.authorId&&first.note.authorName&&first.note.createdAt);assert.equal(api('GET',path,instructorToken).notes.length,1);assert.ok(String(context.dataRows_('cadetNotes')[0][3]).startsWith('{'));
});
check('A request key cannot silently change its note or cadet',()=>{
 for(const [url,text]of [[path,'Інший текст'],['/api/instructor/cadets/'+b.user.id,'=SUM(1,2)\nПотребує повторення теми <script>']])assert.throws(()=>api('POST',url+'/notes',instructorToken,{text,requestId:'card-note-001'}),e=>e.code==='NOTE_CONFLICT');
});
check('Empty and oversized notes never create records',()=>{
 for(const text of ['', ' ', 'x'.repeat(2001)])assert.throws(()=>api('POST',path+'/notes',instructorToken,{text,requestId:'invalid-note'}),e=>e.code==='INVALID_NOTE');assert.equal(api('GET',path,instructorToken).notes.length,1);
});
check('Group transfer retains historical scores and notes under the same cadet ID',()=>{
 api('POST','/api/instructor/users/'+a.user.id+'/group',instructorToken,{groupId:second.id,expectedGroupName:group.name});const r=api('GET',path,instructorToken);assert.equal(r.cadet.groupName,second.name);assert.ok(r.results.some(v=>v.groupName===group.name));assert.equal(r.notes.length,1);
});
check('Current material progress cannot borrow another cadet or an earlier revision',()=>{
 const uid=String(a.user.id),m=['card-pdf','Навчальний PDF','','Тема',JSON.stringify([String(second.id)]),'','file',2,10,'a'.repeat(64),5,'1',new Date(),new Date(),true];context.sheet_('materials').appendRow(m);context.sheet_('materialProgress').appendRow(['card-pdf',1,uid,5,5,5,new Date(),new Date()]);context.sheet_('materialProgress').appendRow(['card-pdf',2,String(b.user.id),3,3,5,new Date(),new Date()]);
 let r=api('GET',path,instructorToken);assert.equal(r.materials.find(v=>v.material.id==='card-pdf').progress,null);context.sheet_('materialProgress').appendRow(['card-pdf',2,uid,2,4,5,new Date(),new Date()]);r=api('GET',path,instructorToken);assert.equal(r.materials.find(v=>v.material.id==='card-pdf').progress.maxPage,4);
});
check('Deleting a cadet removes their notes and makes the old card unavailable',()=>{
 api('DELETE', '/api/instructor/users/'+a.user.id,instructorToken,{confirmUserId:String(a.user.id)});
 assert.equal(context.dataRows_('cadetNotes').filter(r=>String(r[0])===String(a.user.id)).length,0);assert.throws(()=>api('GET',path,instructorToken),e=>e.code==='NOT_FOUND');
});
check('Preparing a new intake clears shared notes before the next cohort',()=>{
 api('POST','/api/instructor/cadets/'+b.user.id+'/notes',instructorToken,{text:'Примітка попереднього набору',requestId:'previous-intake-note'});
 const preview=api('GET','/api/instructor/intake',instructorToken);
 let job=api('POST','/api/instructor/intake/start',instructorToken,{requestId:crypto.randomUUID(),previewToken:preview.previewToken,confirmation:'НОВИЙ НАБІР'}).intake;
 let steps=0;while(job.state!=='completed'){assert.ok(++steps<200);job=api('POST','/api/instructor/intake/continue',instructorToken,{jobId:job.id}).intake;}
 assert.equal(context.dataRows_('cadetNotes').length,0);
});
fs.writeFileSync(new URL('../verification/cadet-card-server.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0},null,2));
