// Execute the application's real analytics loader with deliberately reordered replies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const start=source.indexOf('async function loadAnalytics('),end=source.indexOf('\nfunction ',start);
assert.ok(start>=0&&end>start);
const code=source.slice(start,end),checks=[];
function fixture(){
 const a={capabilities:{filteredAnalytics:true}},filters={groupId:'a',testId:'t'},requests=[];
 const box={S:{session:{token:'session-a',user:{id:'a',role:'instructor'}}},page:'analytics',analytics:null,account:()=>a,instructor:()=>box.S.session?.user.role==='instructor',sharedFilters:()=>filters,selectedGroup:()=>({name:filters.groupId}),alive:()=>true,render:()=>{},rpc:(_method,_path,body,token)=>new Promise((resolve,reject)=>requests.push({body,token,resolve,reject}))};
 vm.createContext(box);vm.runInContext(code,box);return {box,a,filters,requests};
}
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
await check('The request captures its session token and only shows the acknowledged selection',async()=>{
 const f=fixture(),p=f.box.loadAnalytics();assert.equal(f.requests[0].token,'session-a');assert.deepEqual({...f.requests[0].body},{groupName:'a',testId:'t'});assert.equal(f.box.analytics,null);f.requests[0].resolve({attempts:2});assert.equal(await p,true);assert.equal(f.box.analytics.attempts,2);
});
await check('A slower old group reply cannot replace a newer group result',async()=>{
 const f=fixture(),old=f.box.loadAnalytics();f.filters.groupId='b';const next=f.box.loadAnalytics();f.requests[1].resolve({attempts:3});assert.equal(await next,true);f.requests[0].resolve({attempts:1});assert.equal(await old,false);assert.equal(f.box.analytics.attempts,3);
});
await check('Changing a filter before the next request starts also invalidates an old reply',async()=>{
 const f=fixture(),p=f.box.loadAnalytics();f.filters.testId='different';f.requests[0].resolve({attempts:1});assert.equal(await p,false);assert.equal(f.box.analytics,null);
});
await check('Changing accounts discards a delayed response without touching the new account view',async()=>{
 const f=fixture(),p=f.box.loadAnalytics();f.box.S.session={token:'session-b',user:{id:'b',role:'instructor'}};f.box.analytics={attempts:7};f.requests[0].resolve({attempts:1});assert.equal(await p,false);assert.equal(f.box.analytics.attempts,7);
});
await check('Leaving the originating page prevents delayed analytics navigation',async()=>{
 const f=fixture();f.box.page='more';const p=f.box.loadAnalytics();f.box.page='tests';f.requests[0].resolve({attempts:1});assert.equal(await p,false);assert.equal(f.box.page,'tests');assert.equal(f.box.analytics,null);
});
await check('An obsolete network failure cannot replace the current successful analytics',async()=>{
 const f=fixture(),old=f.box.loadAnalytics(),next=f.box.loadAnalytics();f.requests[1].resolve({attempts:4});await next;f.requests[0].reject(Error('Old connection failure'));assert.equal(await old,false);assert.equal(f.box.analytics.attempts,4);assert.equal(f.box.loadAnalytics.error,'');
});
await check('A current failure reports the error instead of retaining statistics under a different filter',async()=>{
 const f=fixture();f.box.analytics={attempts:9};const p=f.box.loadAnalytics();f.requests[0].reject(Error('Offline'));await assert.rejects(p,/Offline/);assert.equal(f.box.analytics,null);assert.equal(f.box.loadAnalytics.error,'Offline');assert.equal(f.box.loadAnalytics.flight,null);
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/analytics-requests.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,actualApplicationFunction:true,productionRequests:0},null,2));
