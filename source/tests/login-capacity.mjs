// Exercise the real Apps Script login endpoints on synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
const {api,context,credential,instructorToken,spreadsheet,lock}=await import('./fixtures/server_model.mjs');
const checks=[];
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
const props=context.PropertiesService.getScriptProperties();
const prefix='LK_LOGIN_';
const keys=()=>Object.keys(props.getProperties()).filter(k=>k.startsWith(prefix));
const clear=()=>keys().forEach(k=>props.deleteProperty(k));
const key=name=>prefix+context.signText_('login:'+context.normalize_(name));
let now=Date.now();
context.Date=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Місткість входу — ізольована група'}).group;
const password='synthetic-capacity-password';
const cadet=api('POST','/api/register','',{username:'capacity_cadet',fullName:'Курсант ізольованої перевірки',groupId:group.id,...credential(password)});
const bad=(username,groupName=group.name)=>{
 const c=api('POST','/api/challenge','',{username,groupName});
 return api('POST','/api/login','',{username,groupName,nonce:c.nonce,proof:'invalid-proof'});
};
const expectCode=(run,expected)=>assert.throws(run,error=>error.code===expected);
const signInCadet=()=>C.signIn('capacity_cadet',password,group.name,(p,b)=>api('POST',p,'',b));
const signInInstructor=()=>C.signIn('WindRoy','instructor-password','',(p,b)=>api('POST',p,'',b));
const seed=(count,age=10000)=>{
 clear();
 // Deliberately insert newest first: eviction must use time, not enumeration order.
 for(let i=count-1;i>=0;i--)props.setProperty(key('seed_'+i),JSON.stringify([now-age+i,1,0]));
};
const sheetSnapshot=()=>JSON.stringify([...spreadsheet.sheets].map(([name,sheet])=>[name,sheet.rows]));
const beforeSheets=sheetSnapshot();
const nonLogin=()=>Object.fromEntries(Object.entries(props.getProperties()).filter(([k])=>!k.startsWith(prefix)));
const beforeProps=nonLogin();

await check('A thousand distinct invalid logins fill the bounded store',()=>{
 clear();
 for(let i=0;i<1000;i++){now++;expectCode(()=>bad('missing_capacity_'+i),'INVALID_CREDENTIALS');}
 assert.equal(keys().length,1000);
});
await check('The next new login evicts the oldest bucket instead of globally throttling',()=>{
 const newest=props.getProperty(key('missing_capacity_999'));
 expectCode(()=>bad('missing_capacity_1000'),'INVALID_CREDENTIALS');
 assert.equal(keys().length,1000);
 assert.equal(props.getProperty(key('missing_capacity_0')),null);
 assert.equal(props.getProperty(key('missing_capacity_999')),newest);
 assert.ok(props.getProperty(key('missing_capacity_1000')));
});
await check('Cadet and instructor can authenticate while all buckets are occupied',async()=>{
 seed(1000);assert.equal((await signInCadet()).user.id,cadet.user.id);
 assert.equal(props.getProperty(key('capacity_cadet')),null);assert.equal(keys().length,999);
 seed(1000);assert.equal((await signInInstructor()).user.username,'WindRoy');
 assert.equal(props.getProperty(key('WindRoy')),null);assert.equal(keys().length,999);
});
await check('Repeated saturation stays bounded and fresh valid logins remain available',async()=>{
 seed(1000);
 for(let i=0;i<1500;i++){
  now++;expectCode(()=>bad('churn_capacity_'+i),'INVALID_CREDENTIALS');assert.ok(keys().length<=1000);
  if(i%250===249){assert.equal((await signInCadet()).user.id,cadet.user.id);assert.equal((await signInInstructor()).user.username,'WindRoy');}
 }
});
await check('The oldest timestamp wins even when property enumeration is reversed',()=>{
 seed(1000);expectCode(()=>bad('new_after_reversed_seed'),'INVALID_CREDENTIALS');
 assert.equal(props.getProperty(key('seed_0')),null);
 assert.ok(props.getProperty(key('seed_1')));assert.ok(props.getProperty(key('seed_999')));
 assert.equal(keys().length,1000);
});
await check('A pre-existing oversized store is reduced enough to admit one new bucket',()=>{
 seed(1005);expectCode(()=>bad('new_after_oversized_seed'),'INVALID_CREDENTIALS');
 assert.equal(keys().length,1000);
 for(let i=0;i<6;i++)assert.equal(props.getProperty(key('seed_'+i)),null);
 assert.ok(props.getProperty(key('seed_6')));
});
await check('Expired and malformed buckets are reclaimed before any active bucket',()=>{
 seed(998);
 props.setProperty(key('expired'),JSON.stringify([now-300000,7,0]));
 props.setProperty(key('malformed'),'{broken');
 expectCode(()=>bad('new_after_expiry'),'INVALID_CREDENTIALS');
 assert.equal(keys().length,999);assert.equal(props.getProperty(key('expired')),null);assert.equal(props.getProperty(key('malformed')),null);
 for(let i=0;i<998;i++)assert.ok(props.getProperty(key('seed_'+i)));
});
await check('An existing account bucket still reaches eight attempts without eviction',()=>{
 seed(999);props.setProperty(key('capacity_cadet'),JSON.stringify([now,7,0]));
 const before=keys().sort();expectCode(()=>bad('CAPACITY_CADET'),'INVALID_CREDENTIALS');
 assert.deepEqual(keys().sort(),before);
 assert.deepEqual(JSON.parse(props.getProperty(key('capacity_cadet'))),[now,8,now+60000]);
 expectCode(()=>bad('capacity_cadet'),'LOGIN_THROTTLED');
 expectCode(()=>bad('capacity_cadet','інша група'),'LOGIN_THROTTLED');
});
await check('Account cooldown survives cache loss and expires normally at capacity',async()=>{
 context.CacheService.getScriptCache().values.clear();expectCode(()=>bad('capacity_cadet'),'LOGIN_THROTTLED');
 now+=60000;assert.equal((await signInCadet()).user.id,cadet.user.id);
 assert.equal(props.getProperty(key('capacity_cadet')),null);
});
await check('A busy script lock rejects without evicting data or consuming a challenge',()=>{
 seed(1000);const before=props.getProperties(),c=api('POST','/api/challenge','',{username:'locked_capacity',groupName:group.name});
 const original=lock.tryLock;lock.tryLock=()=>false;
 try{expectCode(()=>api('POST','/api/login','',{username:'locked_capacity',groupName:group.name,nonce:c.nonce,proof:'invalid-proof'}),'BUSY');}
 finally{lock.tryLock=original;}
 assert.deepEqual(props.getProperties(),before);
 expectCode(()=>api('POST','/api/login','',{username:'locked_capacity',groupName:group.name,nonce:c.nonce,proof:'invalid-proof'}),'INVALID_CREDENTIALS');
 expectCode(()=>api('POST','/api/login','',{username:'locked_capacity',groupName:group.name,nonce:c.nonce,proof:'invalid-proof'}),'CHALLENGE_EXPIRED');
});
await check('Eviction failure releases the script lock and cannot authenticate a bad proof',()=>{
 seed(1000);const remove=props.deleteProperty,release=lock.releaseLock;let released=0;
 props.deleteProperty=function(k){if(k.startsWith(prefix))throw Error('Synthetic eviction write failure');return remove.call(this,k);};
 lock.releaseLock=()=>released++;
 try{expectCode(()=>bad('eviction_write_failure'),'SERVER_ERROR');}
 finally{props.deleteProperty=remove;lock.releaseLock=release;}
 assert.equal(released,1);assert.equal(keys().length,1000);
 expectCode(()=>bad('eviction_write_failure'),'INVALID_CREDENTIALS');
});
await check('Saturation and eviction leave accounts, results and unrelated properties unchanged',()=>{
 assert.equal(sheetSnapshot(),beforeSheets);assert.deepEqual(nonLogin(),beforeProps);
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/login-capacity.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,realServerSource:true,syntheticDataOnly:true,productionRequests:false,physicalWindowsRuntimeVerified:false},null,2));
console.log(JSON.stringify({status:'passed',passed:checks.length,productionRequests:false}));
