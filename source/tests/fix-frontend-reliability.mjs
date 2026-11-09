import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
import {createExamSession} from '../web/exam-session.js';
import {learningUnits} from '../web/learning.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const checks=[];
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function appFunction(name){const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0);const next=app.slice(start+1).search(/\n(?:async )?function /);return next<0?app.slice(start):app.slice(start,start+1+next);}
const training={id:'training-one',mode:'training',questions:[{id:'written-one',type:'written',text:'Поясніть',answers:[]}]};
const remote={test:training,submissionId:'training-submission',startPermit:'signed.permit',answers:{'written-one':'Older cloud answer'},index:0,userId:'owner-one'};
function restoreFixture(){
 const entered=gate(),waiting=gate(),a={run:clone(remote),results:[],pending:[],tests:[training]};
 const box={C,S:{session:{token:'session-one',user:{id:'owner-one',role:'cadet'}}},page:'home',id:C.id,clock:{launchId:'launch'},uptime:()=>1000,cloudRenderNeeded:false,rpc:async()=>{entered.resolve();await waiting.promise;return {trainingResumeProtocol:1,submissionId:remote.submissionId,startPermit:remote.startPermit,test:training};}};
 vm.createContext(box);vm.runInContext(appFunction('applyAccountDocument'),box);
 return {box,a,entered,waiting};
}
await check('A training restore cannot overwrite edits made after Continue was pressed',async()=>{
 const f=restoreFixture(),old=f.a.run,flight=f.box.applyAccountDocument('training',clone(remote),f.a);await f.entered.promise;
 f.box.page='runner';old.answers['written-one']='New local answer';f.waiting.resolve();
 assert.equal(await flight,false);assert.equal(f.a.run,old);assert.equal(old.answers['written-one'],'New local answer');
});
await check('A training restore cannot revive work completed while validation was in flight',async()=>{
 const f=restoreFixture(),flight=f.box.applyAccountDocument('training',clone(remote),f.a);await f.entered.promise;
 f.a.deletedTestIds=[training.id];f.waiting.resolve();assert.equal(await flight,false);
});
await check('An unchanged training restore still applies a verified cloud document',async()=>{
 const f=restoreFixture(),old=f.a.run,flight=f.box.applyAccountDocument('training',clone(remote),f.a);await f.entered.promise;f.waiting.resolve();await flight;
 assert.notEqual(f.a.run,old);assert.equal(f.a.run.answers['written-one'],'Older cloud answer');
});
await check('An account switch during training validation cannot replace local work',async()=>{
 const f=restoreFixture(),old=f.a.run,flight=f.box.applyAccountDocument('training',clone(remote),f.a);await f.entered.promise;f.box.S.session.token='different-token';f.waiting.resolve();assert.equal(await flight,false);assert.equal(f.a.run,old);
});
await check('The current journal independently restores every uncommitted draft field',async()=>{
 const original=C.newDraft(),a={draft:clone(original)},entries=[];
 const box={C,TextEncoder,structuredClone,account:()=>a,journalPending:0,checkpoint:null,journalSaving:Promise.resolve(),journalError:'',secureStorage:{enabled:true,saveJournal:async value=>{entries.push(clone(value));return {ok:true};}},stamp:value=>({serial:entries.length+1,...structuredClone(value)}),updateStorageNotice:()=>{},toast:()=>{}};
 vm.createContext(box);vm.runInContext(appFunction('journal'),box);
 a.draft.title='New title';a.draft.localRevision=1;box.journal({kind:'draft',userId:'owner-one',localId:original.localId,revision:1,patch:{scope:'root',prop:'title',value:a.draft.title}});
 a.draft.questions[0].text='New question';a.draft.localRevision=2;box.journal({kind:'draft',userId:'owner-one',localId:original.localId,revision:2,patch:{scope:'question',q:0,prop:'text',value:a.draft.questions[0].text}});
 await box.journalSaving;assert.equal(entries.length,2);assert.equal(entries[0].draft.questions[0].text,'');
 const state={accounts:{'owner-one':{draft:original}}};assert.equal(C.applyCheckpoint(state,entries.at(-1)),true);
 assert.equal(state.accounts['owner-one'].draft.title,'New title');assert.equal(state.accounts['owner-one'].draft.questions[0].text,'New question');
});
await check('Full draft recovery includes structural edits and accepts incomplete editor content',()=>{
 const original=C.newDraft(),draft=clone(original);draft.questions.push(C.blankQuestion());draft.questions[1].text='Second question';draft.localRevision=4;
 const state={accounts:{owner:{draft:original}}};assert.equal(C.applyCheckpoint(state,{kind:'draft',userId:'owner',localId:draft.localId,revision:4,draft:C.draftJournalSnapshot(draft)}),true);assert.equal(state.accounts.owner.draft.questions.length,2);
});
await check('Older patch journals remain compatible and foreign or stale snapshots are rejected',()=>{
 const draft=C.newDraft(),state={accounts:{owner:{draft}}};
 assert.equal(C.applyCheckpoint(state,{kind:'draft',userId:'owner',localId:draft.localId,revision:1,patch:{scope:'root',prop:'title',value:'Legacy title'}}),true);
 assert.equal(draft.title,'Legacy title');const snapshot=C.draftJournalSnapshot(draft);
 assert.equal(C.applyCheckpoint(state,{kind:'draft',userId:'other',localId:draft.localId,revision:1,draft:snapshot}),false);
 assert.equal(C.applyCheckpoint(state,{kind:'draft',userId:'owner',localId:draft.localId,revision:1,draft:snapshot}),false);
 snapshot.localRevision=2;snapshot.questions='corrupt';assert.equal(C.applyCheckpoint(state,{kind:'draft',userId:'owner',localId:draft.localId,revision:2,draft:snapshot}),false);
});
await check('Oversized draft journals fail explicitly instead of acknowledging an unusable checkpoint',()=>{
 const draft=C.newDraft();draft.questions[0].text='x'.repeat(2000001);assert.throws(()=>C.draftJournalSnapshot(draft),/журнал/);
});
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Frontend reliability'}).group;
let serial=0;
const cadet=()=>api('POST','/api/register','',{username:'frontend-fix-'+(++serial),fullName:'Frontend Reliability',groupId:group.id,...credential('frontend-reliability-password')});
const makeTest=()=>api('POST','/api/instructor/tests',instructorToken,{title:'Frontend exam '+serial,mode:'exam',durationMinutes:1,published:true,questions:[{type:'written',text:'Поясніть',maxPoints:5,answers:[]}]}).test;
let serverTime=Date.now();context.Date=class extends Date{constructor(...args){super(...(args.length?args:[serverTime]));}static now(){return serverTime;}};
function computer(user){
 let ticks=0,hook=null;const a={run:null},session={token:user.token,user:user.user},calls=[];
 const controller=createExamSession({session:()=>session,account:()=>a,deviceId:()=> 'reliability-device',persist:async()=>{},now:()=>ticks,rpc:async(m,p,b,t)=>{calls.push(p);return hook?hook(m,p,b,t):api(m,p,t,b);}});
 return {a,calls,controller,advance:n=>{ticks+=n;serverTime+=n;},hook:fn=>hook=fn};
}
await check('Handoff freezes editing immediately and the saved checkpoint reaches the next PC',async()=>{
 const user=cadet(),test=makeTest(),pc=computer(user);await pc.controller.start(test.id);const key=String(test.questions[0].id);pc.a.run.answers[key]='Final answer';
 const entered=gate(),waiting=gate();pc.hook(async(m,p,b,t)=>{const r=api(m,p,t,b);if(p.endsWith('/release')){entered.resolve();await waiting.promise;}return r;});
 const flight=pc.controller.release();assert.equal(pc.controller.editable(),false);await entered.promise;assert.equal(pc.controller.editable(),false);waiting.resolve();await flight;
 assert.equal(pc.a.run.locked,true);assert.equal(api('GET','/api/exam-session',user.token).document.value.answers[key],'Final answer');
});
await check('A delayed response cannot create extra time in the displayed countdown',async()=>{
 const user=cadet(),test=makeTest(),pc=computer(user);let delayed=true;pc.hook((m,p,b,t)=>{const r=api(m,p,t,b);if(delayed){delayed=false;pc.advance(12000);}return r;});
 await pc.controller.start(test.id);pc.advance(49000);assert.ok(pc.controller.elapsed()>=61);await pc.controller.sync();assert.equal(pc.a.run,null);
});
await check('Slow request processing cannot submit an exam before its actual deadline',async()=>{
 const user=cadet(),test=makeTest(),pc=computer(user);let delayed=true;pc.hook((m,p,b,t)=>{if(delayed){delayed=false;pc.advance(12000);}return api(m,p,t,b);});
 await pc.controller.start(test.id);pc.advance(49000);assert.ok(pc.controller.elapsed()>=61);assert.equal(pc.controller.expired(),false);
 const key=String(test.questions[0].id);pc.a.run.answers[key]='Still within the server deadline';await pc.controller.sync();assert.ok(pc.a.run);assert.equal(pc.calls.at(-1),'/api/exam-session/save');
 assert.equal(api('GET','/api/exam-session',user.token).document.value.answers[key],'Still within the server deadline');
});
await check('A later fast reply never makes the displayed countdown move backwards',async()=>{
 const user=cadet(),test=makeTest(),pc=computer(user);let delayed=true;pc.hook((m,p,b,t)=>{if(delayed){delayed=false;pc.advance(8000);}return api(m,p,t,b);});
 await pc.controller.start(test.id);const before=pc.controller.elapsed();await pc.controller.discover();assert.ok(pc.controller.elapsed()>=before);
});
await check('Learning cards hide used attempts and show pending instructor recoveries',()=>{
 const tests=[{id:'used',access:{open:true}},{id:'recovery',access:{open:true}},{id:'new',access:{open:true}}];
 const units=learningUnits(tests,[],{},[],[],null,[{testId:'recovery'}],['used']);assert.equal(units[0].canStart,false);assert.equal(units[0].status,'Спробу використано');assert.equal(units[1].canStart,false);assert.equal(units[1].status,'Очікує підтвердження інструктора');assert.equal(units[2].canStart,true);
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/fix-frontend-reliability.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0},null,2)+'\n');
console.log('Frontend reliability fixes: '+checks.length+' checks passed.');
