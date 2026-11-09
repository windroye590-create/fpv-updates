import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
import {createExamSession} from '../web/exam-session.js';
import {createAccountSync} from '../web/account-sync.js';
const checks=[];
async function check(name,run){try{await run();checks.push({name,status:'passed'});}catch(e){checks.push({name,status:'failed',error:e.message});}}
const actor=id=>({token:'token-'+id,user:{id,role:'cadet'}});
const gate=()=>{let open;const promise=new Promise(r=>open=r);return {promise,open};};
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
function appFunction(name){const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);const next=app.slice(start+1).search(/\n(?:async )?function /);return next<0?app.slice(start):app.slice(start,start+1+next);}
const test={id:'test-a',title:'Тест',description:'',mode:'training',durationMinutes:1,questions:[{id:'q1',text:'Питання',answers:[{id:'a1',text:'Варіант'}]}]};
function examReply(s,value=null){return {examProtocol:1,userId:s.user.id,serverNow:1000,document:{revision:value?1:0,value}};}
function examValue(){return {test:{...test,mode:'exam'},submissionId:'submission',fence:1,startedAt:1000,deadline:61000,status:'active',ownerId:'device',answers:{},index:0};}
await check('Queued exam start retains the account that initiated it',async()=>{
 let s=actor('A');const accounts={A:{run:null},B:{run:null}},entered=gate(),waiting=gate(),starts=[];
 const controller=createExamSession({session:()=>s,account:()=>accounts[s.user.id],deviceId:()=> 'device',persist:async()=>{},now:()=>0,rpc:async(m,p,b,t)=>{
  const requestActor=s;if(p==='/api/exam-session'){entered.open();await waiting.promise;return examReply(requestActor);}
  starts.push(t);return examReply(s,examValue());
 }});
 const reading=controller.discover();await entered.promise;const starting=controller.start(test.id);s=actor('B');controller.reset();waiting.open();await Promise.all([reading,starting]);
 assert.deepEqual(starts,[]);assert.equal(accounts.B.run,null);
});
await check('A new account is not blocked behind the previous account’s pending exam request',async()=>{
 let s=actor('A');const accounts={A:{run:null},B:{run:null}},entered=gate(),waiting=gate();let reachedB=false;
 const controller=createExamSession({session:()=>s,account:()=>accounts[s.user.id],deviceId:()=> 'device',persist:async()=>{},now:()=>0,rpc:async(m,p,b,t)=>{
  const requestActor=s;if(t==='token-A'){entered.open();await waiting.promise;return examReply(requestActor);}
  reachedB=true;return examReply(requestActor,examValue());
 }});
 const reading=controller.discover();await entered.promise;s=actor('B');controller.reset();const starting=controller.start(test.id);
 for(let i=0;i<30;i++)await Promise.resolve();const independent=reachedB;waiting.open();await Promise.all([reading,starting]);
 assert.equal(independent,true);assert.equal(controller.status().busy,false);
});
function appSandbox(){
 const accounts=Object.fromEntries(['A','B'].map(id=>[id,{tests:[test],results:[],pending:[],fullTests:{},run:null,capabilities:{multipleChoice:true}}]));
 const S={session:actor('A'),accounts,deviceId:'device'};
 const sandbox={C,S,id:C.id,e:C.esc,user:()=>S.session?.user,account:()=>accounts[S.session.user.id],refresh:async()=>{},fetchTest:async()=>test,render:()=>{},persist:async()=>{},page:'tests',confirmAction:()=>{},getClock:async()=>({uptime:10000,launchId:'launch'}),crypto,document:{documentElement:{}},clock:{launchId:'launch'},lastError:'',instructor:()=>false};
 vm.createContext(sandbox);return {sandbox,S,accounts};
}
await check('Starting a test stops after an account change during refresh',async()=>{
 const {sandbox,S}=appSandbox(),entered=gate(),waiting=gate();let confirmations=0,fetches=0;
 sandbox.refresh=async()=>{entered.open();await waiting.promise;};sandbox.fetchTest=async()=>{fetches++;return test;};sandbox.confirmAction=()=>confirmations++;
 vm.runInContext(appFunction('start'),sandbox);const pending=sandbox.start(test.id);await entered.promise;S.session=actor('B');waiting.open();await pending;
 assert.equal(fetches,0);assert.equal(confirmations,0);
});
await check('A delayed training confirmation cannot create a run in another account',async()=>{
 const {sandbox,S,accounts}=appSandbox(),entered=gate(),waiting=gate();let confirm;
 sandbox.confirmAction=(title,body,action)=>confirm=action;sandbox.getClock=async()=>{entered.open();await waiting.promise;return {uptime:10000,launchId:'launch'};};
 vm.runInContext(appFunction('start'),sandbox);await sandbox.start(test.id);const pending=confirm();await entered.promise;S.session=actor('B');waiting.open();await pending;
 assert.equal(accounts.A.run,null);assert.equal(accounts.B.run,null);assert.equal(sandbox.page,'tests');
});
await check('An authenticated response from the previous account is discarded centrally',async()=>{
 const {sandbox,S}=appSandbox(),entered=gate(),waiting=gate();sandbox.updateApplying=false;sandbox.rpcFlights=0;sandbox.local=async()=>{entered.open();await waiting.promise;return {ok:true,privateValue:'only-A'};};
 vm.runInContext(appFunction('rpc'),sandbox);const pending=sandbox.rpc('GET','/api/tests');await entered.promise;S.session=actor('B');waiting.open();
 await assert.rejects(pending,e=>e.code==='SESSION_CHANGED');assert.equal(sandbox.rpcFlights,0);
});
await check('Resuming a legacy exam does not claim a new account’s active exam',async()=>{
 const {sandbox,S,accounts}=appSandbox(),entered=gate(),waiting=gate();let claims=0;
 accounts.A.run={test:{...test,mode:'exam'}};accounts.B.run={...examValue(),examProtocol:1};
 sandbox.examSession={start:async()=>{throw Error('Legacy exams must not start a timed session');},claim:async()=>claims++};sandbox.getClock=async()=>{entered.open();await waiting.promise;return {uptime:10000,launchId:'launch'};};
 vm.runInContext(appFunction('resumeRun'),sandbox);const pending=sandbox.resumeRun();await entered.promise;S.session=actor('B');waiting.open();await pending;assert.equal(claims,0);
});
await check('Recovery stops when the account changes while reading the native clock',async()=>{
 const {sandbox,S,accounts}=appSandbox(),entered=gate(),waiting=gate();let discoveries=0;
 accounts.A.run={...examValue(),examProtocol:1};sandbox.getClock=async()=>{entered.open();await waiting.promise;return {uptime:10000,launchId:'launch'};};sandbox.examSession={discover:async()=>discoveries++};
 vm.runInContext(appFunction('recoverRun'),sandbox);const pending=sandbox.recoverRun();await entered.promise;S.session=actor('B');waiting.open();await pending;assert.equal(discoveries,0);
});
const documentReply=(s,document)=>({accountSyncProtocol:1,userId:s.user.id,document});
await check('Draft synchronization does not acknowledge an unapplied document after switching accounts',async()=>{
 let s=actor('A');s.user.role='instructor';const accounts={A:{draft:null},B:{draft:null}},entered=gate(),waiting=gate();const remote={key:'test-draft',revision:1,value:{title:'Remote'}};
 const controller=createAccountSync({session:()=>s,account:()=>accounts[s.user.id],snapshot:a=>({'test-draft':a.draft}),apply:async()=>{entered.open();await waiting.promise;},persist:async()=>{},changed:()=>{},delay:100000,rpc:async(m,p)=>p==='/api/account-state'?{accountSyncProtocol:1,userId:'A',cursor:'one',stable:true,documents:[{key:remote.key,revision:1}]}:documentReply(s,remote)});
 const pending=controller.sync();await entered.promise;s=actor('B');s.user.role='instructor';controller.reset();waiting.open();await pending;
 assert.equal(accounts.A.pcSync.revisions['test-draft'],undefined);controller.reset();
});
await check('Resolving a draft conflict preserves the conflict when applying the remote version is refused',async()=>{
 const s=actor('A');s.user.role='instructor';const remote={key:'test-draft',revision:2,value:{title:'Remote'}};
 const a={draft:{title:'Local'},pcSync:{revisions:{'test-draft':1},shadow:{'test-draft':{title:'Base'}},requests:{},conflicts:{'test-draft':remote},cursor:''}};
 const controller=createAccountSync({session:()=>s,account:()=>a,snapshot:a=>({'test-draft':a.draft}),apply:async()=>false,persist:async()=>{},rpc:async()=>{throw Error('Unexpected sync');}});
 await controller.resolve('test-draft','remote');assert.equal(a.pcSync.revisions['test-draft'],1);assert.ok(a.pcSync.conflicts['test-draft']);controller.reset();
});
await check('Conflict resolution cannot acknowledge a different account after a delayed apply',async()=>{
 let s=actor('A');s.user.role='instructor';const remote={key:'test-draft',revision:2,value:{title:'Remote'}},entered=gate(),waiting=gate();
 const a={draft:{title:'Local'},pcSync:{revisions:{'test-draft':1},shadow:{'test-draft':{title:'Base'}},requests:{},conflicts:{'test-draft':remote},cursor:''}};
 const controller=createAccountSync({session:()=>s,account:()=>a,snapshot:a=>({'test-draft':a.draft}),apply:async()=>{entered.open();await waiting.promise;},persist:async()=>{},rpc:async()=>{throw Error('Unexpected sync');}});
 const pending=controller.resolve('test-draft','remote');await entered.promise;s=actor('B');s.user.role='instructor';waiting.open();await pending;
 assert.equal(a.pcSync.revisions['test-draft'],1);assert.ok(a.pcSync.conflicts['test-draft']);controller.reset();
});
await check('A new account starts draft synchronization while the previous account request is pending',async()=>{
 let s=actor('A');s.user.role='instructor';const accounts={A:{draft:null},B:{draft:null}},entered=gate(),waiting=gate();let reachedB=false;
 const controller=createAccountSync({session:()=>s,account:()=>accounts[s.user.id],snapshot:a=>({'test-draft':a.draft}),apply:async()=>{},persist:async()=>{},changed:()=>{},delay:100000,rpc:async(m,p,b,t)=>{
  if(t==='token-A'){entered.open();await waiting.promise;}else reachedB=true;
  return {accountSyncProtocol:1,userId:t==='token-A'?'A':'B',cursor:'one',stable:true,documents:[]};
 }});
 const old=controller.sync();await entered.promise;s=actor('B');s.user.role='instructor';controller.reset();const fresh=controller.sync();
 for(let i=0;i<30;i++)await Promise.resolve();const independent=reachedB;waiting.open();await Promise.all([old,fresh]);
 assert.equal(independent,true);assert.equal(controller.status().ready,true);controller.reset();
});
await check('Finishing an old account request cannot clear the new account synchronization indicator',async()=>{
 let s=actor('A');s.user.role='instructor';const accounts={A:{draft:null},B:{draft:null}},enteredA=gate(),waitingA=gate(),waitingB=gate();let reachedB=false;
 const controller=createAccountSync({session:()=>s,account:()=>accounts[s.user.id],snapshot:a=>({'test-draft':a.draft}),apply:async()=>{},persist:async()=>{},changed:()=>{},delay:100000,rpc:async(m,p,b,t)=>{
  if(t==='token-A'){enteredA.open();await waitingA.promise;}else{reachedB=true;await waitingB.promise;}
  return {accountSyncProtocol:1,userId:t==='token-A'?'A':'B',cursor:'one',stable:true,documents:[]};
 }});
 const old=controller.sync();await enteredA.promise;s=actor('B');s.user.role='instructor';controller.reset();const fresh=controller.sync();
 for(let i=0;i<30;i++)await Promise.resolve();waitingA.open();await old;const stillBusy=controller.status().busy;waitingB.open();await fresh;
 assert.equal(reachedB,true);assert.equal(stillBusy,true);assert.equal(controller.status().busy,false);controller.reset();
});
function refreshSandbox(){
 const box=appSandbox(),x=box.sandbox;
 Object.assign(x,{updateApplying:false,refreshing:false,refreshQueued:false,forceQueued:false,workspaceUnavailableUntil:0,sharedFilters:()=>({}),workspaceRequest:()=>({known:{}}),readWorkspace:r=>r,materials:{refresh:async()=>{}},accountSync:{sync:async()=>{}},examSession:{discover:async()=>{}},setTimeout:()=>{}});
 vm.runInContext(appFunction('refresh'),x);return box;
}
function workspaceReply(s){return {user:s.user,changes:{tests:[],results:[],groups:[]},revisions:{tests:'t',results:'r:recent',materials:'m'},snapshotStable:true,resultScope:'recent',capabilities:{}};}
await check('Opening another account loads its workspace without waiting for the previous account',async()=>{
 const {sandbox:x,S,accounts}=refreshSandbox(),entered=gate(),waiting=gate();let reachedB=false;
 x.rpc=async(m,p,b,t)=>{const owner={...S.session};if(t==='token-A'){entered.open();await waiting.promise;}else reachedB=true;return workspaceReply(owner);};
 const old=x.refresh();await entered.promise;S.session=actor('B');const fresh=x.refresh();for(let i=0;i<40;i++)await Promise.resolve();const independent=reachedB;waiting.open();await Promise.all([old,fresh]);
 assert.equal(independent,true);assert.ok(accounts.B.updatedAt>0);
});
await check('An old workspace completion cannot hide a new account’s refresh in progress',async()=>{
 const {sandbox:x,S}=refreshSandbox(),entered=gate(),waitingA=gate(),waitingB=gate();
 x.rpc=async(m,p,b,t)=>{const owner={...S.session};if(t==='token-A'){entered.open();await waitingA.promise;}else await waitingB.promise;return workspaceReply(owner);};
 const old=x.refresh();await entered.promise;S.session=actor('B');const fresh=x.refresh();for(let i=0;i<30;i++)await Promise.resolve();waitingA.open();await old;const stillBusy=Boolean(x.refreshing);waitingB.open();await fresh;assert.equal(stillBusy,true);assert.equal(x.refreshing,false);
});
await check('Finishing a training attempt stops if the native clock returns after switching accounts',async()=>{
 const {sandbox:x,S,accounts}=appSandbox(),entered=gate(),waiting=gate();const run={test,answers:{},startedUptime:0,submissionId:'finish-A'};accounts.A.run=run;
 Object.assign(x,{working:false,lastResult:null,syncQueue:async()=>{},getClock:async()=>{entered.open();await waiting.promise;return {uptime:10000};}});
 vm.runInContext(appFunction('finishRun'),x);const saving=x.finishRun(false);await entered.promise;S.session=actor('B');waiting.open();await saving;
 assert.equal(accounts.A.run,run);assert.equal(accounts.A.pending.length,0);assert.equal(accounts.B.pending.length,0);assert.notEqual(x.page,'result');
});
await check('A stale finish confirmation cannot finish a different account’s active test',async()=>{
 const {sandbox:x,S,accounts}=appSandbox();let confirm;
 for(const id of ['A','B'])accounts[id].run={test,answers:{},startedUptime:0,submissionId:'finish-'+id};
 Object.assign(x,{working:false,lastResult:null,syncQueue:async()=>{},document:{fullscreenElement:null},confirmAction:(title,body,action)=>confirm=action});
 vm.runInContext(appFunction('finishRun'),x);await x.finishRun();S.session=actor('B');await confirm();
 assert.ok(accounts.B.run);assert.equal(accounts.B.pending.length,0);
});
await check('A result queue for a new account sends independently of the previous account’s pending request',async()=>{
 const {sandbox:x,S,accounts}=appSandbox(),entered=gate(),waiting=gate();let reachedB=false;
 for(const id of ['A','B'])accounts[id].pending=[{body:{testId:test.id,submissionId:'queue-'+id},attempts:0,nextAt:0}];
 Object.assign(x,{updateApplying:false,syncing:false,alive:()=>true,lastResult:null,rpc:async(m,p,b,t)=>{const userId=t==='token-A'?'A':'B';if(userId==='A'){entered.open();await waiting.promise;}else reachedB=true;return {result:{id:'result-'+userId,userId,testId:test.id,total:1,correct:1,score:100,passed:true,completedAt:'2026-10-25T00:00:00Z'},review:[]};}});
 vm.runInContext(appFunction('syncQueue'),x);const old=x.syncQueue();await entered.promise;S.session=actor('B');const fresh=x.syncQueue();for(let i=0;i<40;i++)await Promise.resolve();const independent=reachedB;waiting.open();await Promise.all([old,fresh]);
 assert.equal(independent,true);assert.equal(accounts.B.pending.length,0);assert.equal(accounts.A.pending.length,1);
});
const report={status:checks.every(c=>c.status==='passed')?'passed':'failed',passed:checks.filter(c=>c.status==='passed').length,total:checks.length,checks};
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/session-transitions.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
for(const c of checks)console.log(c.status.toUpperCase()+' '+c.name+(c.error?' — '+c.error.split('\n')[0]:''));
if(report.status!=='passed')process.exitCode=1;
