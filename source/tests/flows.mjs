/* Drive the actual application state machine. DOM and native Windows storage
 * are thin test doubles; all API responses use unchanged Code.gs logic.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,instructorToken}=await import('./fixtures/server_model.mjs');
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Перевірка черги ПК'}).group;
const creds=await C.credential('test-pc-password');
const cadet=api('POST','/api/register','',{fullName:'Перевірка станів ПК',username:'pc_flows',groupId:group.id,...creds});
const draft=C.newDraft();draft.title='Перевірка черги';draft.questions[0].text='Правильна відповідь?';draft.questions[0].answers[0].text='Так';draft.questions[0].answers[1].text='Ні';
// These queue/restart fixtures represent existing unmanaged attempts.
const makeTest=(title)=>api('POST','/api/instructor/tests',instructorToken,{...C.draftAPI(draft),accessProtocol:0,title}).test;
let storage={version:1,session:{token:cadet.token,user:cadet.user},groups:[],accounts:{},theme:'light'},journal={},offline=false,lostReply=false,diskFailure=false,launchId='flow-boot-1',ticks=1000000;
const calls=[],reports=[],nodes={};
const listeners={};
function node(selector){return nodes[selector]??={innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},querySelector(){return {disabled:false}},showModal(){},close(){},style:{},addEventListener(){}};}
globalThis.document={querySelector:node,body:{classList:{toggle(){}}},addEventListener:(n,f)=>listeners[n]=f,documentElement:{},hidden:false};
globalThis.window={addEventListener:(n,f)=>listeners[n]=f};
globalThis.location={href:'http://127.0.0.1:18747/?key=flow-key'};
const localData=new Map();globalThis.localStorage={setItem:(k,v)=>localData.set(k,v),getItem:k=>localData.get(k)};
Object.defineProperty(globalThis,'navigator',{value:{sendBeacon(){}},configurable:true});
globalThis.setInterval=()=>0;
globalThis.fetch=async(path,options)=>{
 if(path==='/clock')return new Response(JSON.stringify({ok:true,uptime:ticks,launchId}));
 if(path==='/state'){
  if(options?.method==='POST'){if(diskFailure)return new Response('{"ok":false,"code":"STORAGE_WRITE","error":"Injected disk error"}');storage=JSON.parse(options.body);return new Response('{"ok":true}');}
  return new Response(JSON.stringify(storage));
 }
 if(path==='/journal'){if(options?.method==='POST'){const value=JSON.parse(options.body);if((value.serial||0)>(journal.serial||0))journal=value;return new Response('{"ok":true}');}return new Response(JSON.stringify(journal));}
 if(path==='/rpc'){
  const p=JSON.parse(options.body);calls.push(p);
  if(offline)return new Response('{"ok":false,"code":"NETWORK","error":"Injected offline"}');
  const reply=context.doPost({postData:{contents:options.body}}).text;
  if(lostReply&&p.path==='/api/results'){lostReply=false;return new Response('{"ok":false,"code":"NETWORK","error":"Injected lost reply after commit"}');}
  return new Response(reply);
 }
 throw Error('Unexpected local route: '+path);
};
const A=await import('../web/app.js');
await new Promise(resolve=>setTimeout(resolve,30));
await A.refresh();await A.persist();
async function check(label,run){await run();reports.push(label);}
function runFor(test,mode='training'){return {test:{...test,mode},answers:{[test.questions[0].id]:test.questions[0].answers[0].id},index:0,startedUptime:ticks-20000,launchId,submissionId:'pc-'+crypto.randomUUID(),exitCount:0,userId:String(cadet.user.id),lastElapsed:20};}
await check('Finish saves queue before attempting network',async()=>{const test=makeTest('Офлайн-черга');A.account().run=runFor(test);offline=true;await A.finishRun(false);const a=storage.accounts[String(cadet.user.id)];assert.equal(a.pending.length,1);assert.equal(a.run,null);assert.ok(a.pending[0].body.submissionId.startsWith('pc-'));assert.equal(a.pending[0].body.durationSeconds,20);});
await check('Retry sends the durable body and drains queue',async()=>{const body=structuredClone(storage.accounts[String(cadet.user.id)].pending[0].body);offline=false;await A.syncQueue(true);assert.equal(A.account().pending.length,0);const sent=calls.filter(p=>p.path==='/api/results').at(-1);assert.deepEqual(sent.body,body);assert.equal(A.account().results.filter(r=>String(r.testId)===String(body.testId)).length,1);});
await check('Acknowledgement loss is recovered without duplicate result',async()=>{const test=makeTest('Втрачена відповідь');A.account().run=runFor(test);lostReply=true;await A.finishRun(false);assert.equal(A.account().pending.length,1);await A.syncQueue(true);assert.equal(A.account().pending.length,0);assert.equal(api('GET','/api/my-results',cadet.token).results.filter(r=>r.testId===test.id).length,1);});
await check('Disk failure prevents network submission and preserves answers',async()=>{const test=makeTest('Перевірка диска');A.account().run=runFor(test);const before=calls.filter(p=>p.path==='/api/results').length;diskFailure=true;await assert.rejects(()=>A.finishRun(false),/disk error/);assert.equal(calls.filter(p=>p.path==='/api/results').length,before);assert.ok(A.account().run);assert.equal(A.account().run.answers[test.questions[0].id],test.questions[0].answers[0].id);diskFailure=false;A.account().run=null;await A.persist();});
await check('Second PC-completed attempt reconciles authoritative result',async()=>{const test=makeTest('Телефон завершив першим');const r=runFor(test);api('POST','/api/results',cadet.token,{...C.submission(r,ticks),submissionId:'secondPC-first'});A.account().run=r;await A.finishRun(false);assert.equal(A.account().pending.length,0);assert.equal(A.account().results.filter(v=>v.testId===test.id).length,1);});
await check('Same-title queued tests show the score for the current submission',async()=>{const older=makeTest('Однакова назва'),current=makeTest('Однакова назва');A.account().run=runFor(older);offline=true;await A.finishRun(false);assert.equal(A.account().pending.length,1);A.account().run=runFor(current);A.account().run.answers[current.questions[0].id]=current.questions[0].answers[1].id;offline=false;await A.finishRun(false);assert.equal(A.account().pending.length,0);assert.ok(nodes['#app'].innerHTML.includes('<div class="score">0<small>%</small>'), 'Current result screen must show the current 0% attempt, not the older 100% attempt with the same title');});
await check('Reconciling an older secondPC result leaves the current offline result queued',async()=>{const older=makeTest('Старий результат з телефона'),current=makeTest('Новий тест у черзі');const olderRun=runFor(older);api('POST','/api/results',cadet.token,{...C.submission(olderRun,ticks),submissionId:'secondPC-older-result'});A.account().run=olderRun;offline=true;await A.finishRun(false);A.account().run=runFor(current);const originalFetch=globalThis.fetch;globalThis.fetch=async(path,options)=>{const p=path==='/rpc'?JSON.parse(options.body):null;if(p?.path==='/api/results'&&String(p.body.testId)===String(current.id))return new Response('{"ok":false,"code":"NETWORK","error":"Current attempt is offline"}');return originalFetch(path,options);};offline=false;try{await A.finishRun(false);assert.equal(A.account().pending.length,1);assert.equal(String(A.account().pending[0].body.testId),String(current.id));assert.ok(nodes['#app'].innerHTML.includes('Новий тест у черзі'));assert.ok(nodes['#app'].innerHTML.includes('Результат у черзі.'));assert.ok(!nodes['#app'].innerHTML.includes('<div class="score">'), 'Reconciling another attempt must not display its score for the current attempt');}finally{globalThis.fetch=originalFetch;}await A.syncQueue(true);});
await check('Restarted legacy exam preserves answers and goes to instructor confirmation',async()=>{const test=api('POST','/api/instructor/tests',instructorToken,{...C.draftAPI(draft),accessProtocol:0,mode:'exam',title:'Іспит після перезапуску'}).test;A.account().run=runFor(test,'exam');A.account().run.launchId='previous-app-process';await A.persist();await A.recoverRun();assert.equal(A.account().run.legacyRecovery,true);assert.equal(A.account().run.test.id,test.id);assert.equal(A.account().run.answers[test.questions[0].id],test.questions[0].answers[0].id);assert.ok(!A.account().results.some(v=>v.testId===test.id));await A.clickAction({dataset:{action:'resume'}});await A.finishRun(false);assert.equal(A.account().run,null);assert.ok(!A.account().results.some(v=>v.testId===test.id));assert.ok(A.account().examRecoveries.some(v=>String(v.testId)===String(test.id)));});
await check('Training resumes elapsed time after restart',async()=>{const test=makeTest('Відновлення тренування');A.account().run=runFor(test);A.account().run.launchId='previous-app-process';await A.recoverRun();assert.equal(A.account().run.launchId,launchId);assert.equal(A.account().run.startedUptime,ticks-20000);A.account().run=null;await A.persist();});
await check('Unavailable authoritative result remains retryable after ALREADY_COMPLETED',async()=>{
 const test=makeTest('Підтвердження тимчасово недоступне'),run=runFor(test);
 api('POST','/api/results',cadet.token,{...C.submission(run,ticks),submissionId:'secondPC-before-pc'});
 A.account().run=run;const originalFetch=globalThis.fetch;
 globalThis.fetch=async(path,options)=>{const p=path==='/rpc'?JSON.parse(options.body):null;if(p?.path==='/api/my-results')return new Response('{"ok":false,"code":"NETWORK","error":"Confirmation unavailable"}');return originalFetch(path,options);};
 try{await A.finishRun(false);assert.equal(A.account().pending.length,1);assert.ok(!A.account().pending[0].permanent,'A failed confirmation request must not permanently disable this submission');assert.ok(A.account().pending[0].nextAt>Date.now());}
 finally{globalThis.fetch=originalFetch;}
 await A.syncQueue(true);assert.equal(A.account().pending.length,0);assert.equal(A.account().results.filter(r=>String(r.testId)===String(test.id)).length,1);
});
await check('Malformed acknowledgement retains the exact saved answers for retry',async()=>{
 const test=makeTest('Неповне підтвердження'),run=runFor(test),originalFetch=globalThis.fetch;
 A.account().run=run;
 globalThis.fetch=async(path,options)=>{const p=path==='/rpc'?JSON.parse(options.body):null;if(p?.path==='/api/results')return new Response('{"ok":true,"result":{"id":"incorrect","userId":"another-user","testId":"another-test","total":1,"correct":1,"score":100}}');return originalFetch(path,options);};
 try{await A.finishRun(false);assert.equal(A.account().pending.length,1,'An unrelated acknowledgement must not delete saved answers');assert.deepEqual(A.account().pending[0].body.answers,C.submission(run,ticks).answers);assert.ok(!A.account().pending[0].permanent);}
 finally{globalThis.fetch=originalFetch;}
 await A.syncQueue(true);assert.equal(A.account().pending.length,0);
});
await check('Unsafe server strings are escaped in generated HTML',async()=>{api('POST','/api/instructor/groups',instructorToken,{name:'<img src=x onerror=alert(1)>'});await A.refresh();await A.clickAction({dataset:{action:'logout'}});await A.clickAction({dataset:{action:'role',role:'cadet'}});assert.ok(nodes['#app'].innerHTML.includes('&lt;img src=x'));assert.ok(!nodes['#app'].innerHTML.includes('<img src=x'));});
// Session expiry must retain pending data; test in a fresh module instance.
storage.session={token:'expired.invalid',user:cadet.user};storage.accounts[String(cadet.user.id)].pending=[{body:{testId:'kept',submissionId:'pc-kept',answers:[]},testTitle:'Збережено',attempts:0,nextAt:0}];
const B=await import('../web/app.js?expiry-check');await new Promise(resolve=>setTimeout(resolve,30));
await check('Expired session does not discard offline results',async()=>{assert.equal(storage.session,null);assert.equal(storage.accounts[String(cadet.user.id)].pending[0].body.submissionId,'pc-kept');});
storage.session={token:cadet.token,user:cadet.user};storage.accounts[String(cadet.user.id)].pending=[];
const D=await import('../web/app.js?submit-expiry-check');await new Promise(resolve=>setTimeout(resolve,30));
await check('Session expiry during finish preserves queue and re-enables login',async()=>{const test=makeTest('Вхід завершився під час відправлення');D.account().run=runFor(test);api('POST','/api/instructor/users/'+cadet.user.id+'/password',instructorToken,await C.credential('new-password'));await D.finishRun(false);assert.equal(storage.session,null);assert.equal(storage.accounts[String(cadet.user.id)].pending.length,1);assert.ok(!nodes['#app'].innerHTML.includes('<button class="primary" disabled>'));});
await check('Login restores an interrupted exam for continuation without completing it',async()=>{
 const test=api('POST','/api/instructor/tests',instructorToken,{...C.draftAPI(draft),accessProtocol:0,mode:'exam',title:'Перерваний іспит перед входом'}).test;storage.session=null;
 const saved=storage.accounts[String(cadet.user.id)];saved.pending=[];saved.run=runFor({...test,durationMinutes:20},'exam');saved.run.launchId='previous-launch';saved.run.interrupted=true;
 const E=await import('../web/app.js?login-recovery-check');await new Promise(resolve=>setTimeout(resolve,30));
 await E.clickAction({dataset:{action:'role',role:'cadet'}});
 const NativeFormData=globalThis.FormData;globalThis.FormData=class{constructor(form){return Object.entries(form.fields)[Symbol.iterator]();}};
 try{await E.authSubmit({fields:{username:'pc_flows',password:'new-password',group:group.name},querySelector(){return {disabled:false};},reset(){}});}
 finally{globalThis.FormData=NativeFormData;}
 assert.equal(E.account().run.legacyRecovery,true);assert.equal(String(E.account().run.test.id),String(test.id));
 assert.equal(E.account().results.filter(r=>String(r.testId)===String(test.id)).length,0);
 await E.clickAction({dataset:{action:'resume'}});await E.finishRun(false);assert.equal(E.account().run,null);
});
await check('Login renews an expired challenge without losing the saved account',async()=>{
 storage.session=null;
 const F=await import('../web/app.js?challenge-retry-check');await new Promise(resolve=>setTimeout(resolve,30));
 await F.clickAction({dataset:{action:'role',role:'cadet'}});
 const originalFetch=globalThis.fetch,nonces=[];let loginCalls=0;
 globalThis.fetch=async(path,options)=>{
  const p=path==='/rpc'?JSON.parse(options.body):null;
  if(p?.path==='/api/login'){nonces.push(p.body.nonce);if(++loginCalls===1)return new Response('{"ok":false,"code":"CHALLENGE_EXPIRED","error":"Challenge evicted from cache"}');}
  return originalFetch(path,options);
 };
 const NativeFormData=globalThis.FormData;globalThis.FormData=class{constructor(form){return Object.entries(form.fields)[Symbol.iterator]();}};
 try{await F.authSubmit({fields:{username:'pc_flows',password:'new-password',group:group.name},querySelector(){return {disabled:false};},reset(){}});}
 finally{globalThis.FormData=NativeFormData;globalThis.fetch=originalFetch;}
 assert.equal(String(storage.session?.user.id),String(cadet.user.id),'A temporary challenge eviction must not leave the user unable to sign in');
 assert.equal(loginCalls,2);assert.notEqual(nonces[0],nonces[1],'Never replay a consumed proof');
});
await check('Wrong password is not retried and keeps the username and group visible',async()=>{
 storage.session=null;
 const G=await import('../web/app.js?wrong-password-check');await new Promise(resolve=>setTimeout(resolve,30));
 await G.clickAction({dataset:{action:'role',role:'cadet'}});
 const originalFetch=globalThis.fetch;let loginCalls=0;
 globalThis.fetch=async(path,options)=>{const p=path==='/rpc'?JSON.parse(options.body):null;if(p?.path==='/api/login')loginCalls++;return originalFetch(path,options);};
 const NativeFormData=globalThis.FormData;globalThis.FormData=class{constructor(form){return Object.entries(form.fields)[Symbol.iterator]();}};
 try{await G.authSubmit({fields:{username:'pc_flows',password:'incorrect-password',group:group.name},querySelector(){return {disabled:false};},reset(){}});}
 finally{globalThis.FormData=NativeFormData;globalThis.fetch=originalFetch;}
 assert.equal(storage.session,null);assert.equal(loginCalls,1);
 assert.ok(nodes['#app'].innerHTML.includes('value="pc_flows"'));
 assert.ok(nodes['#app'].innerHTML.includes('value="'+C.esc(group.name)+'" selected'));
 assert.ok(!JSON.stringify(storage).includes('incorrect-password'));
});
fs.writeFileSync(new URL('../verification/flows.json',import.meta.url),JSON.stringify({kind:'application_state_machine_with_real_server_logic',productionVerified:false,windowsRuntimeVerified:false,passed:reports.length,checks:reports},null,2));
console.log('Application state flows: '+reports.length+'/'+reports.length+' passed.');
