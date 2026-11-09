// Real server and client controller; synthetic accounts, no live requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createReviewPresence,reviewPresenceMarkup} from '../web/review-presence.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const clone=v=>JSON.parse(JSON.stringify(v));
let serverNow=Date.now(),mono=1000;
const RealDate=Date;context.Date=class extends RealDate{constructor(...v){super(...(v.length?v:[serverNow]));}static now(){return serverNow;}};
const props=context.PropertiesService.getScriptProperties();
const first={token:instructorToken,user:api('GET','/api/workspace',instructorToken).user};
const group=api('POST','/api/instructor/groups',first.token,{name:'Присутність інструкторів'}).group;
const invite=api('POST','/api/instructor/invite',first.token).code;
const second=api('POST','/api/instructor/register','',{fullName:'Другий <викладач>',username:'presence_second',inviteCode:invite,...credential('presence-second-password')});
const cadet=api('POST','/api/register','',{fullName:'Курсант спільної перевірки',username:'presence_cadet',groupId:group.id,...credential('presence-cadet-password')});
const questions=[{text:'Виберіть правильне',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]},{type:'written',text:'Перше пояснення',maxPoints:3,answers:[]},{type:'written',text:'Друге пояснення',maxPoints:4,answers:[]}];
function work(title='Окрема робота',qs=questions){const test=api('POST','/api/instructor/tests',first.token,{title,questions:qs}).test;return {test,result:api('POST','/api/results',cadet.token,{testId:test.id,submissionId:'presence-'+test.id,writtenProtocol:1,choiceProtocol:2,answers:[]}).result};}
const a=work('Перший тест'),b=work('Другий тест');
const path=id=>'/api/instructor/results/'+id+'/review-session';
const open=(id,actor=first,clientId='first-client-000000')=>api('POST',path(id),actor.token,{action:'open',clientId});
const post=(id,action,actor,clientId,leaseId)=>api('POST',path(id),actor.token,{action,clientId,leaseId});
const grade=(w,actor,lease,extra={})=>api('POST','/api/instructor/results/'+w.result.id+'/grade',actor.token,{requestId:'presence-grade-'+crypto.randomUUID(),expectedRevision:api('GET','/api/results/'+w.result.id+'/review',actor.token).result.gradingRevision,grades:[{questionId:w.test.questions[1].id,points:2,comment:'Перший коментар'}],...(lease?{reviewLease:lease}:{}),...extra});
const deny=(fn,code)=>assert.throws(fn,e=>e.code===code);
let leaseA,leaseB,accepted;
await check('A claim names the instructor and hides its credential from the other instructor',()=>{
 leaseA=open(a.result.id).reviewSession;assert.equal(leaseA.state,'owned');assert.ok(leaseA.leaseId);assert.equal(leaseA.expiresAt-serverNow,120000);
 const other=open(a.result.id,second,'second-client-00000').reviewSession;assert.equal(other.state,'busy');assert.equal(other.reviewerName,first.user.fullName);assert.equal(other.leaseId,undefined);
});
await check('Two instructors can check two tests belonging to the same cadet',()=>{leaseB=open(b.result.id,second,'second-client-00000').reviewSession;assert.equal(leaseB.state,'owned');assert.equal(leaseB.resultId,String(b.result.id));});
await check('Another window of the same instructor cannot acquire the occupied work',()=>assert.equal(open(a.result.id,first,'first-other-window').reviewSession.state,'busy'));
await check('The shared queue contains the owner but no secret or device identifier',()=>{
 const rows=api('GET','/api/instructor/reviews',second.token).results;
 for(const rid of [a.result.id,b.result.id]){const state=rows.find(r=>String(r.id)===String(rid)).reviewPresence;assert.equal(state.state,'busy');assert.ok(state.reviewerName);assert.equal(state.leaseId,undefined);assert.equal(state.clientId,undefined);}
});
await check('Legacy PCs and forged owner credentials cannot overwrite occupied work',()=>{
 deny(()=>grade(a,second), 'REVIEW_IN_PROGRESS');
 deny(()=>grade(a,second,{clientId:'first-client-000000',leaseId:leaseA.leaseId}), 'REVIEW_IN_PROGRESS');
 deny(()=>grade(a,first,{clientId:'first-client-000000',leaseId:'wrong'}), 'REVIEW_IN_PROGRESS');
});
await check('The current owner can save a partial grade with an attributable author',()=>{
 accepted=grade(a,first,{clientId:'first-client-000000',leaseId:leaseA.leaseId},{requestId:'accepted-presence-grade'});assert.equal(accepted.result.pendingWritten,1);assert.equal(accepted.result.gradingRevision,1);assert.equal(accepted.review[1].reviewerName,first.user.fullName);
});
await check('A stale release or renewal cannot change a new session for the same window',()=>{
 const newer=open(a.result.id).reviewSession;assert.notEqual(newer.leaseId,leaseA.leaseId);
 post(a.result.id,'release',first,'first-client-000000',leaseA.leaseId);
 const stale=post(a.result.id,'renew',first,'first-client-000000',leaseA.leaseId).reviewSession;assert.equal(stale.state,'busy');assert.equal(stale.leaseId,undefined);
 const actual=JSON.parse(props.getProperty(context.reviewLeaseKey_(a.result.id)));assert.equal(actual.leaseId,newer.leaseId);leaseA=newer;
});
await check('Replaying an accepted save is idempotent even after its lease was released',()=>{
 post(a.result.id,'release',first,'first-client-000000',leaseA.leaseId);
 open(a.result.id,second,'second-client-00000');
 const replay=grade(a,first,{clientId:'first-client-000000',leaseId:leaseA.leaseId},{requestId:'accepted-presence-grade',expectedRevision:0});assert.equal(replay.result.gradingRevision,1);
});
await check('Server expiry releases abandoned work and rejects the expired owner',()=>{
 serverNow+=120001;
 deny(()=>grade(b,second,{clientId:'second-client-00000',leaseId:leaseB.leaseId}),'REVIEW_LEASE_EXPIRED');
 const next=open(b.result.id).reviewSession;assert.equal(next.state,'owned');
 post(b.result.id,'release',second,'second-client-00000',leaseB.leaseId);
 assert.equal(open(b.result.id,second,'second-client-00000').reviewSession.state,'busy');
 post(b.result.id,'release',first,'first-client-000000',next.leaseId);
});
await check('Expired properties are collected without touching application secrets or grades',()=>{
 const before=api('GET','/api/results/'+a.result.id+'/review',first.token).result;
 props.setProperty('PRESENCE_TEST_SENTINEL','keep');serverNow+=120001;open(a.result.id);
 assert.equal(props.getProperty('PRESENCE_TEST_SENTINEL'),'keep');assert.deepEqual(api('GET','/api/results/'+a.result.id+'/review',first.token).result,before);
});
await check('Choice-only viewing creates no reservation',()=>{
 const plain=work('Без ручної перевірки',questions.slice(0,1));assert.equal(open(plain.result.id).reviewSession.state,'view');assert.equal(props.getProperty(context.reviewLeaseKey_(plain.result.id)),null);
});
await check('Cadets and anonymous callers cannot claim, read or release a review session',()=>{
 for(const actor of [cadet,{token:''}])for(const method of ['GET','POST'])deny(()=>api(method,path(a.result.id),actor.token,{clientId:'cadet-client-000000',action:'release'}),actor.token?'FORBIDDEN':'SESSION_EXPIRED');
});
await check('Malformed clients and nonexistent work do not create sessions',()=>{
 deny(()=>open(a.result.id,first,'x'),'BAD_REQUEST');deny(()=>open('nonexistent'),'RESULT_NOT_FOUND');assert.equal(props.getProperty(context.reviewLeaseKey_('nonexistent')),null);
});
await check('A corrupt state fails closed instead of silently allowing another reviewer',()=>{
 const key=context.reviewLeaseKey_(b.result.id);props.setProperty(key,'bad json');deny(()=>open(b.result.id),'REVIEW_STATE_ERROR');props.deleteProperty(key);
});
await check('Review writes require the existing short script lock; queue reads remain read-only',()=>{
 assert.equal(context.requiresWriteLock_({action:'api',method:'POST',path:path(a.result.id)}),true);assert.equal(context.requiresWriteLock_({action:'api',method:'GET',path:path(a.result.id)}),false);
});
await check('Heartbeats do not invalidate grades and status polls never scan result history',()=>{
 const owned=open(a.result.id).reviewSession;
 const before=api('GET','/api/workspace',first.token).revisions.results;
 post(a.result.id,'renew',first,'first-client-000000',owned.leaseId);
 assert.equal(api('GET','/api/workspace',first.token).revisions.results,before);
 const saved=context.listResults_;context.listResults_=()=>{throw Error('A status poll scanned result history');};
 try{const reply=api('GET','/api/instructor/review-presence',second.token);assert.ok(Array.isArray(reply.sessions));assert.equal(reply.stable,true);assert.ok(reply.sessions.every(s=>!s.leaseId&&!s.clientId));}finally{context.listResults_=saved;}
 post(a.result.id,'release',first,'first-client-000000',owned.leaseId);
});

serverNow+=120001;
const c=work('Клієнтський контролер'),d=work('Інша клієнтська робота');
const rpcFor=actor=>async(m,p,body,token)=>api(m,p,token||actor.token,body);
let active=first;
const one=createReviewPresence({session:()=>active,rpc:rpcFor(first),now:()=>mono,clientId:'controller-one-0000'});
const two=createReviewPresence({session:()=>second,rpc:rpcFor(second),now:()=>mono,clientId:'controller-two-0000'});
await check('The real controller acquires one work and turns occupied work into read-only mode',async()=>{
 await one.open(c.result.id);assert.equal(one.canEdit(),true);await two.open(c.result.id);assert.equal(two.status().state,'busy');assert.equal(two.canEdit(),false);deny(()=>two.credentials(),'REVIEW_LEASE_EXPIRED');
});
await check('Leaving a review makes it available without automatically claiming it for observers',async()=>{
 await one.stop();await two.tick();assert.equal(two.status().state,'free');assert.equal(two.canEdit(),false);await two.open(c.result.id);assert.equal(two.canEdit(),true);await two.stop();
});
await check('An unavailable server immediately disables saves and a valid renewal restores ownership',async()=>{
 let offline=false;const realRpc=rpcFor(first);
 const ctl=createReviewPresence({session:()=>first,rpc:async(...args)=>{if(offline)throw Error('offline');return realRpc(...args);},now:()=>mono,clientId:'offline-controller'});
 await ctl.open(c.result.id);offline=true;await ctl.tick();assert.equal(ctl.canEdit(),false);assert.equal(ctl.status().state,'lost');offline=false;await ctl.tick();assert.equal(ctl.canEdit(),true);await ctl.stop();
});
await check('A local monotonic deadline disables saves before an expired session can be reused',async()=>{
 await one.open(c.result.id);mono+=115001;one.expire();assert.equal(one.canEdit(),false);serverNow+=120001;await one.tick();assert.equal(one.status().state,'lost');await one.open(c.result.id);assert.equal(one.canEdit(),true);await one.stop();
});
await check('A delayed open response cannot extend the lease beyond server expiry',async()=>{
 const ctl=createReviewPresence({session:()=>first,rpc:async(...args)=>{const r=await rpcFor(first)(...args);mono+=121000;return r;},now:()=>mono,clientId:'delayed-controller'});
 await ctl.open(c.result.id);assert.equal(ctl.canEdit(),false);assert.equal(ctl.status().state,'lost');await ctl.stop();
});
const gate=()=>{let done;return {promise:new Promise(r=>done=r),open:()=>done()};};
await check('A late claim after navigation releases the abandoned work',async()=>{
 const entered=gate(),waiting=gate();const ctl=createReviewPresence({session:()=>first,now:()=>mono,clientId:'late-controller-00',rpc:async(...args)=>{const r=await rpcFor(first)(...args);if(args[2]?.action==='open'){entered.open();await waiting.promise;}return r;}});
 const opening=ctl.open(c.result.id);await entered.promise;await ctl.stop();waiting.open();assert.equal(await opening,null);await Promise.resolve();assert.equal(props.getProperty(context.reviewLeaseKey_(c.result.id)),null);
});
await check('Out-of-order opens for the same work cannot release or renew a newer claim',async()=>{
 const firstEntered=gate(),waiting=gate();let calls=0;
 const ctl=createReviewPresence({session:()=>first,now:()=>mono,clientId:'reorder-controller',rpc:async(...args)=>{const r=await rpcFor(first)(...args);if(args[2]?.action==='open'&&++calls===1){firstEntered.open();await waiting.promise;}return r;}});
 const old=ctl.open(c.result.id);await firstEntered.promise;await ctl.open(c.result.id);const newest=ctl.credentials();waiting.open();assert.equal(await old,null);assert.equal(ctl.credentials().leaseId,newest.leaseId);await ctl.tick();assert.equal(ctl.canEdit(),true);await ctl.stop();
});
await check('Account changes cannot inherit the previous instructor’s ownership',async()=>{
 await one.open(c.result.id);active=second;assert.equal(one.canEdit(),false);await one.stop();active=first;
});
await check('Old servers retain existing revision checks and show an explicit upgrade notice',async()=>{
 const ctl=createReviewPresence({session:()=>first,now:()=>mono,clientId:'legacy-controller0',rpc:async(m,p,b,t)=>{if(p.endsWith('/review-session'))throw Object.assign(Error('old'),{code:'NOT_FOUND'});return rpcFor(first)(m,p,b,t);}});
 const r=await ctl.open(c.result.id);assert.ok(r.review);assert.equal(ctl.status().state,'unsupported');assert.equal(ctl.credentials(),undefined);assert.match(reviewPresenceMarkup(ctl.status()),/API 18/);await ctl.stop();
});
await check('Invalid replies cannot enable editing',async()=>{
 const ctl=createReviewPresence({session:()=>first,now:()=>mono,clientId:'malformed-control0',rpc:async()=>({reviewSession:{state:'owned',resultId:'other',serverNow}})});await assert.rejects(()=>ctl.open(c.result.id));assert.equal(ctl.canEdit(),false);
});
await check('Instructor names are escaped in the queue and in the read-only banner',()=>{
 for(const queue of [true,false]){const html=reviewPresenceMarkup({state:'busy',reviewerName:'<img src=x onerror=alert(1)>'},{queue});assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);}
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/review-presence.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,liveAccountsModified:false},null,2));
console.log(JSON.stringify({status:'passed',passed:checks.length,liveAccountsModified:false}));
