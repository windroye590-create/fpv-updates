import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
import {createAccountSync} from '../web/account-sync.js';
import {workspaceRequest,readWorkspace} from '../web/workspace.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,spreadsheet,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const teacher=api('GET','/api/workspace',instructorToken).user;
const checks=[],controllers=[];
const clone=x=>JSON.parse(JSON.stringify(x));
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
function computer(a={},token=instructorToken,u=teacher){
 let s={token,user:u},network=true,hook=null;
 a={draft:null,gradingDrafts:{},...a};
 const rpc=async(method,path,body,token)=>{if(!network)throw Object.assign(Error('offline'),{code:'NETWORK'});if(hook)return hook(method,path,body,token);return api(method,path,token,body);};
 const sync=createAccountSync({session:()=>s,account:()=>a,delay:60000,now:()=>100000,
  snapshot:a=>u.role==='instructor'?{'test-draft':a.draft,...Object.fromEntries(Object.entries(a.gradingDrafts).map(([k,v])=>['grading:'+k,v]))}:{training:a.training??null},
  apply:(key,value,a)=>{if(key==='test-draft')a.draft=value;else if(key==='training')a.training=value;else if(value===null)delete a.gradingDrafts[key.slice(8)];else a.gradingDrafts[key.slice(8)]=value;},
  rpc,persist:async()=>{}});
 controllers.push(sync);return {a,sync,offline:()=>{network=false;},online:()=>{network=true;},hook:f=>{hook=f;},switchSession:value=>{s=value;}};
}
const doc=key=>api('GET','/api/account-state/document',instructorToken,{key}).document;
const draft=()=>({...C.newDraft(),title:'Робота з першого ПК'});
const one=computer({draft:draft()}),two=computer({},context.issueToken_(teacher));
try{
 await check('Incomplete legacy draft migrates to the account without publication',async()=>{
  assert.ok(C.validateDraft(one.a.draft));await one.sync.sync(true);
  assert.equal(one.sync.status().pending,0);assert.equal(doc('test-draft').value.title,one.a.draft.title);
 });
 await check('A clean second PC downloads the complete saved draft',async()=>{
  await two.sync.sync(true);assert.deepEqual(two.a.draft,one.a.draft);assert.equal(two.sync.status().ready,true);
 });
 await check('Changes on PC 2 appear on PC 1 after an account refresh',async()=>{
  two.a.draft.title='Редагування на другому ПК';await two.sync.sync(true);await one.sync.sync(true);
  assert.equal(one.a.draft.title,two.a.draft.title);
 });
 await check('Offline edits stay pending and synchronize after reconnecting',async()=>{
  one.offline();one.a.draft.description='Офлайн-правка';await one.sync.sync(true);
  assert.equal(one.sync.status().pending,1);assert.equal(one.sync.status().error,'offline');
  assert.notEqual(doc('test-draft').value.description,'Офлайн-правка');
  one.online();await one.sync.sync(true);await two.sync.sync(true);assert.equal(two.a.draft.description,'Офлайн-правка');
 });
 await check('A lost write acknowledgement does not duplicate a revision',async()=>{
  const before=doc('test-draft').revision;let dropped=false;
  one.a.draft.title='Втрачена відповідь';one.hook((m,p,b,t)=>{const r=api(m,p,t,b);if(m==='POST'&&!dropped){dropped=true;throw Object.assign(Error('lost ack'),{code:'NETWORK'});}return r;});
  await one.sync.sync(true);assert.equal(one.sync.status().pending,1);one.hook(null);await one.sync.sync(true);
  assert.equal(doc('test-draft').revision,before+1);assert.equal(one.sync.status().pending,0);
 });
 await check('Typing during an in-flight upload is never falsely acknowledged',async()=>{
  let release,started;const gate=new Promise(r=>{release=r;}),entered=new Promise(r=>{started=r;});
  one.a.draft.title='До запиту';one.hook(async(m,p,b,t)=>{if(m==='POST'){started();await gate;}return api(m,p,t,b);});
  const flight=one.sync.sync(true);await entered;one.a.draft.title='Після початку запиту';release();await flight;
  assert.equal(doc('test-draft').value.title,'До запиту');assert.equal(one.sync.status().pending,1);
  one.hook(null);await one.sync.sync(true);assert.equal(doc('test-draft').value.title,'Після початку запиту');
 });
 await check('Concurrent edits require a choice and never overwrite either PC silently',async()=>{
  await two.sync.sync(true);one.a.draft.title='Версія A';two.a.draft.title='Версія B';
  await one.sync.sync(true);await two.sync.sync(true);
  assert.equal(doc('test-draft').value.title,'Версія A');assert.equal(two.a.draft.title,'Версія B');assert.equal(two.sync.status().conflicts.length,1);
 });
 await check('Choosing the local version preserves a recovery copy of the other one',async()=>{
  await two.sync.resolve('test-draft','local');assert.equal(doc('test-draft').value.title,'Версія B');
  assert.equal(two.a.syncBackups[0].value.title,'Версія A');await one.sync.sync(true);assert.equal(one.a.draft.title,'Версія B');
 });
 await check('Choosing the remote version preserves a recovery copy of local edits',async()=>{
  one.a.draft.title='Нова A';two.a.draft.title='Нова B';await one.sync.sync(true);await two.sync.sync(true);
  await two.sync.resolve('test-draft','remote');assert.equal(two.a.draft.title,'Нова A');assert.equal(two.a.syncBackups[0].value.title,'Нова B');
 });
 await check('Deleting a draft propagates a tombstone to the second PC',async()=>{
  one.a.draft=null;await one.sync.sync(true);await two.sync.sync(true);assert.equal(two.a.draft,null);
  assert.equal(doc('test-draft').value,null);
 });
 await check('An old unsynchronized PC cannot silently resurrect a deleted draft',async()=>{
  const old=computer({draft:draft()});await old.sync.sync(true);assert.equal(old.sync.status().conflicts.length,1);assert.equal(doc('test-draft').value,null);
 });
 await check('Unscored grading comments travel between PCs independently of test drafts',async()=>{
  const group=api('POST','/api/instructor/groups',instructorToken,{name:'Чернетка перевірки між ПК'}).group;
  const cadet=api('POST','/api/register','',{username:'pc_sync_grading',fullName:'Курсант перевірки',groupId:group.id,...credential('test-pc-grading-password')});
  const test=api('POST','/api/instructor/tests',instructorToken,{title:'Чернетка письмової перевірки',published:true,accessProtocol:1,writtenProtocol:1,questions:[{type:'written',text:'Поясніть відповідь',maxPoints:3,answers:[]}]}).test;
  api('POST','/api/instructor/tests/'+test.id+'/access',instructorToken,{expectedRevision:1,scope:'all',open:true});
  const submissionId='pc-sync-grading-submission',start=api('POST','/api/tests/'+test.id+'/start',cadet.token,{submissionId});
  const result=api('POST','/api/results',cadet.token,{testId:test.id,submissionId,startPermit:start.startPermit,writtenProtocol:1,answers:[{questionId:test.questions[0].id,text:'Збережена відповідь курсанта'}]}).result;
  const resultId=String(result.id),questionId=String(test.questions[0].id),comment='Продовжити перевірку завтра';
  one.a.gradingDrafts[resultId]={revision:result.gradingRevision,items:{[questionId]:{points:'',comment}},request:null};
  await one.sync.sync(true);assert.equal(one.sync.status().error,'');assert.equal(one.sync.status().pending,0);
  await two.sync.sync(true);assert.equal(two.sync.status().error,'');assert.deepEqual(two.a.gradingDrafts[resultId],one.a.gradingDrafts[resultId]);
  assert.equal(two.a.gradingDrafts[resultId].items[questionId].comment,comment);
  assert.equal(doc('grading:'+resultId).value.items[questionId].comment,comment);
  assert.equal(doc('test-draft').value,null);
 });
 await check('A multichunk Unicode draft roundtrips without truncation or formula cells',()=>{
  const large=draft();large.questions=Array.from({length:20},()=>({...C.blankQuestion(),text:'🛩'.repeat(500),rubric:'Ж'.repeat(2000),explanation:'='.repeat(2000)}));
  const previous=doc('test-draft');api('POST','/api/account-state/document',instructorToken,{key:'test-draft',expectedRevision:previous.revision,requestId:crypto.randomUUID(),value:large});
  assert.deepEqual(doc('test-draft').value,large);
  const parts=spreadsheet.getSheetByName('_Чернетки_ПК').rows.filter(r=>r[1]==='test-draft'&&r[3]===doc('test-draft').generation&&r[4]>=0);
  assert.ok(parts.length>1);assert.ok(parts.every(r=>r[9].startsWith('json:')&&r[9].length<=45005));
 });
 await check('A payload written before a failed commit cannot replace the saved document',()=>{
  const table=spreadsheet.getSheetByName('_Чернетки_ПК'),append=table.appendRow,before=doc('test-draft');
  table.appendRow=function(row){if(row[4]===-1)throw Error('injected commit failure');return append.call(this,row);};
  const value=draft(),request={key:'test-draft',expectedRevision:before.revision,requestId:crypto.randomUUID(),value};
  assert.throws(()=>api('POST','/api/account-state/document',instructorToken,request));table.appendRow=append;
  assert.deepEqual(doc('test-draft').value,before.value);api('POST','/api/account-state/document',instructorToken,request);
  assert.equal(doc('test-draft').revision,before.revision+1);assert.deepEqual(doc('test-draft').value,value);
 });
 await check('Request IDs are idempotent and cannot acknowledge a different payload',()=>{
  const before=doc('test-draft'),request={key:'test-draft',expectedRevision:before.revision,requestId:crypto.randomUUID(),value:{...draft(),title:'Повтор запиту'}};
  const r=api('POST','/api/account-state/document',instructorToken,request);assert.equal(api('POST','/api/account-state/document',instructorToken,request).document.revision,r.document.revision);
  assert.throws(()=>api('POST','/api/account-state/document',instructorToken,{...request,value:draft()}),x=>x.code==='REQUEST_CONFLICT');
 });
 await check('Only the latest three committed generations are retained',()=>{
  const rows=spreadsheet.getSheetByName('_Чернетки_ПК').rows.filter(r=>String(r[0])===String(teacher.id)&&r[1]==='test-draft'&&r[4]===-1);assert.equal(rows.length,3);
 });
 await check('Unauthenticated requests cannot read account documents',()=>{
  assert.throws(()=>api('GET','/api/account-state',''),x=>x.code==='SESSION_EXPIRED');
 });
 await check('Completed grading tombstones do not exhaust the active draft limit or cause per-document downloads',async()=>{
  for(let i=0;i<201;i++)api('POST','/api/account-state/document',instructorToken,{key:'grading:completed-'+i,expectedRevision:0,requestId:crypto.randomUUID(),value:null});
  const a=computer();let downloads=0;a.hook((m,p,b,t)=>{if(p==='/api/account-state/document'&&m==='GET')downloads++;return api(m,p,t,b);});
  await a.sync.sync(true);assert.equal(a.sync.status().error,'');assert.ok(downloads<10);assert.ok(api('GET','/api/account-state',instructorToken,{}).documents.length>200);
 });
 const group=api('POST','/api/instructor/groups',instructorToken,{name:'Синхронізація ПК'}).group;
 const cadet=api('POST','/api/register','',{username:'pc-sync-cadet',fullName:'Курсант синхронізації',groupId:group.id,...credential('test-pc-sync-password')});
 await check('Account ownership and roles cannot be overridden in the request body',()=>{
  const r=api('GET','/api/account-state',cadet.token,{userId:teacher.id});assert.equal(r.userId,String(cadet.user.id));assert.equal(r.documents.length,0);
  assert.throws(()=>api('GET','/api/account-state/document',cadet.token,{key:'test-draft',userId:teacher.id}),x=>x.code==='FORBIDDEN');
 });
 const td={...C.newDraft(),title:'Спільне тренування',questions:[{...C.blankQuestion(),text:'Перевірка',answers:[{id:'0',text:'Так',isCorrect:true},{id:'0',text:'Ні',isCorrect:false}]}]};
 const training=api('POST','/api/instructor/tests',instructorToken,C.draftAPI(td,true)).test;
 api('POST','/api/instructor/tests/'+training.id+'/access',instructorToken,{expectedRevision:1,scope:'all',open:true});
 const trainingSubmission='pc-training-sync-'+crypto.randomUUID(),trainingPermit=api('POST','/api/tests/'+training.id+'/start',cadet.token,{submissionId:trainingSubmission}).startPermit;
 await check('A training attempt and written answers resume on a fresh PC',async()=>{
  const value={test:training,answers:{[training.questions[0].id]:training.questions[0].answers[0].id},submissionId:trainingSubmission,startPermit:trainingPermit,lastElapsed:22,index:0,exitCount:0};
  const a=computer({training:value},cadet.token,cadet.user),b=computer({},context.issueToken_(cadet.user),cadet.user);
  await a.sync.sync(true);await b.sync.sync(true);assert.deepEqual(b.a.training,value);
 });
 await check('An exam cannot be transferred as a training document',()=>{
  const request={key:'training',expectedRevision:1,requestId:crypto.randomUUID(),value:{test:{...training,mode:'exam'},submissionId:'exam',answers:{}}};
  assert.throws(()=>api('POST','/api/account-state/document',cadet.token,request),x=>x.code==='BAD_REQUEST');
 });
 await check('Deleting a cadet removes their account-owned drafts',()=>{
  api('DELETE','/api/instructor/users/'+cadet.user.id,instructorToken,{confirmUserId:String(cadet.user.id)});
  assert.ok(!spreadsheet.getSheetByName('_Чернетки_ПК').rows.some(r=>String(r[0])===String(cadet.user.id)));
 });
 await check('An in-flight response after switching accounts cannot replace the new account',async()=>{
  let release,entered;const gate=new Promise(r=>{release=r;}),start=new Promise(r=>{entered=r;});
  const a=computer();a.hook(async(m,p,b,t)=>{const r=api(m,p,t,b);entered();await gate;return r;});
  const flight=a.sync.sync(true);await start;a.switchSession({token:'another-account',user:{id:'another',role:'instructor'}});release();await flight;assert.equal(a.a.draft,null);
 });
 await check('Malformed or foreign responses cannot be treated as synchronized',async()=>{
  const a=computer({draft:draft()});a.hook(()=>({accountSyncProtocol:1,userId:'foreign',cursor:'x',documents:[],stable:true}));
  await a.sync.sync(true);assert.equal(a.sync.status().pending,1);assert.equal(a.sync.status().ready,false);assert.match(a.sync.status().error,/іншого/);
 });
 await check('The real refresh function prefers server grades and invalidates stale test caches',async()=>{
  const g=api('POST','/api/instructor/groups',instructorToken,{name:'Оцінки між ПК'}).group;
  const u=api('POST','/api/register','',{username:'pc-grade-refresh',fullName:'Курсант оцінки',groupId:g.id,...credential('test-grade-refresh')});
  const t=api('POST','/api/instructor/tests',instructorToken,{title:'Оцінка',published:true,questions:[{type:'written',text:'Відповідь',maxPoints:1,answers:[]}]}).test;
  const stale=api('POST','/api/results',u.token,{testId:t.id,submissionId:'pc-grade-refresh',writtenProtocol:1,answers:[{questionId:t.questions[0].id,text:'Текст'}]}).result;
  api('POST','/api/instructor/results/'+stale.id+'/grade',instructorToken,{expectedRevision:0,requestId:crypto.randomUUID(),grades:[{questionId:t.questions[0].id,points:1,comment:'Готово'}]});
  const a={tests:[],results:[stale],cadets:[],fullTests:{[t.id]:{title:'Стара копія'}},pending:[]},app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
  const code=app.slice(app.indexOf('async function refresh(force=false){'),app.indexOf('\nasync function loadGroups'));
  const box={C,Date,setTimeout:()=>{},S:{session:u},updateApplying:false,user:()=>u.user,instructor:()=>false,page:'home',grading:null,refreshing:false,refreshQueued:false,forceQueued:false,workspaceUnavailableUntil:0,lastError:'',account:()=>a,sharedFilters:()=>({}),render:()=>{},persist:async()=>{},workspaceRequest,readWorkspace,materials:{refresh:async()=>{}},accountSync:{sync:async()=>{}},examSession:{discover:async()=>{}},rpc:async(m,p,b,t)=>api(m,p,t,b)};
  const generationCode=app.slice(app.indexOf('function clearOldIntakeState('),app.indexOf('\nasync function runIntake('));
  vm.createContext(box);vm.runInContext(generationCode+'\n'+code,box);await vm.runInContext('refresh(true)',box);
  assert.equal(box.lastError,'');assert.equal(a.results.find(r=>r.id===stale.id).score,100);assert.equal(a.results.find(r=>r.id===stale.id).gradingStatus,'graded');assert.equal(Object.keys(a.fullTests).length,0);
 });
 fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
 fs.writeFileSync(new URL('../verification/account-sync.json',import.meta.url),JSON.stringify({passed:checks.length,checks,backend:'actual Code.gs with local Sheets model',clients:'independent states using actual account-sync.js',physicalWindowsVerified:false,productionDeploymentVerified:false,testedAt:new Date().toISOString()},null,2));
 console.log('Account synchronization: '+checks.length+' checks passed.');
}finally{for(const c of controllers)c.reset();}
