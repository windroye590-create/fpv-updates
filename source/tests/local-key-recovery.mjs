import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSecureStorage} from '../web/secure-storage.js';
import {nativeStorageV2} from './fixtures/native-storage-v2.mjs';

const checks=[];
const password='Synthetic-unchanged-owner-password';
const session={token:'synthetic-old-session',user:{id:'owner',username:'WindRoy',role:'instructor'}};
const renewed={token:'synthetic-renewed-session',user:{...session.user,username:'windroy'}};
const reply={localStorageProtocol:2,userId:'owner',key:'ab'.repeat(32)};
const changedKey={...reply,key:'cd'.repeat(32)};
const privateAccount={
 draft:{title:'Preserved unsent draft',questions:[{text:'Private question',rubric:'Private grading criteria'}]},
 pending:[{submissionId:'unsent-work',body:{answers:{q1:['a1']}}}],
 run:{submissionId:'active-exam',answers:{q1:['a1']},index:1},
 gradingDrafts:{work:{items:{q1:{points:1,comment:'Unsent grade'}}}},
};

async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
async function seed(){
 const native=nativeStorageV2();let store=createSecureStorage({local:native.local});
 const state=await store.load(),opened=await store.unlockOnline(session,password,reply);
 const S={...state,session,accounts:{owner:{...opened.account,...structuredClone(privateAccount)}}};
 await store.save(S);await store.saveJournal({serial:7,kind:'run',userId:'owner',submissionId:'active-exam',answers:{q2:['a2']}});
 await store.lock();
 return {native,S,keyId:native.profile.accounts.owner.keyId};
}
async function cold(native,local=native.local){const store=createSecureStorage({local});const state=await store.load();return {store,state};}

await check('An unchanged password opens the existing owner copy after the server key changes',async()=>{
 const {native,keyId}=await seed(),before=JSON.stringify(native.snapshot()),{store}=await cold(native);
 const opened=await store.unlockOnline(renewed,password,changedKey);
 assert.deepEqual({...opened.account},privateAccount);assert.equal(opened.session.token,renewed.token);
 assert.equal(opened.journals[0].answers.q2[0],'a2');assert.equal(native.profile.accounts.owner.keyId,keyId);
 assert.equal(JSON.stringify(native.snapshot()),before,'Opening must not rewrite any existing copy');
 await store.lock();
});

await check('A recovered login retains its original encryption key and reopens offline after saving',async()=>{
 const {native,keyId}=await seed();let {store,state}=await cold(native);
 const draftChunks=native.profile.accounts.owner.fields.draft.chunks;
 const opened=await store.unlockOnline(renewed,password,changedKey);
 await store.save({...state,session:renewed,accounts:{owner:opened.account}});
 assert.equal(native.profile.accounts.owner.keyId,keyId);
 assert.deepEqual(native.profile.accounts.owner.fields.draft.chunks,draftChunks);
 await store.lock();({store,state}=await cold(native));
 const offline=await store.unlockOffline({username:'WindRoy',password,role:'instructor'});
 assert.deepEqual({...offline.account},privateAccount);assert.equal(offline.session.token,renewed.token);
 await store.lock();({store}=await cold(native));
 const again=await store.unlockOnline(renewed,password,changedKey);assert.deepEqual({...again.account},privateAccount);
 await store.lock();
});

await check('Recovery can read an authenticated backup when the newest private object is damaged',async()=>{
 const {native,S}=await seed();let {store}=await cold(native);
 const opened=await store.unlockOnline(session,password,reply);
 S.accounts.owner=opened.account;S.accounts.owner.draft.title='Damaged newest draft';await store.save(S);await store.lock();
 native.objects.get(native.profile.accounts.owner.fields.draft.chunks[0]).cipher[0]^=1;
 const before=JSON.stringify(native.snapshot());({store}=await cold(native));
 const restored=await store.unlockOnline(renewed,password,changedKey);
 assert.equal(restored.account.draft.title,privateAccount.draft.title);
 assert.deepEqual(restored.account.pending,privateAccount.pending);assert.ok(store.status().recoveredCopies>0);
 assert.equal(JSON.stringify(native.snapshot()),before);await store.lock();
});

await check('A wrong local password cannot replace an existing copy even after online authentication',async()=>{
 const {native}=await seed(),before=JSON.stringify(native.snapshot()),{store}=await cold(native),opens=native.opens;
 await assert.rejects(store.unlockOnline(renewed,'Wrong-local-password',changedKey),e=>e.code==='LOCAL_COPY_UNAVAILABLE');
 assert.equal(native.opens,opens);assert.equal(store.status().locked,true);assert.equal(JSON.stringify(native.snapshot()),before);
});

await check('A different username or role cannot use the password recovery path',async()=>{
 const {native}=await seed(),before=JSON.stringify(native.snapshot()),{store}=await cold(native),opens=native.opens;
 for(const user of [{...renewed.user,username:'another-owner'},{...renewed.user,role:'cadet'}])
  await assert.rejects(store.unlockOnline({...renewed,user},password,changedKey),e=>e.code==='LOCAL_COPY_UNAVAILABLE');
 assert.equal(native.opens,opens);assert.equal(JSON.stringify(native.snapshot()),before);
});

await check('Knowing the password cannot bypass forged current or backup manifest authentication',async()=>{
 const {native}=await seed(),before=JSON.stringify(native.snapshot());
 const local=async(path,body,headers)=>{
  const result=await native.local(path,body,headers);
  if(body===undefined&&(path==='/storage/profile'||path.startsWith('/storage/profile/backup/'))&&result.accounts?.owner){
   result.accounts.owner.mac='AAAA';for(const h of result.accounts.owner.history||[])h.mac='AAAA';
  }
  return result;
 };
 const {store}=await cold(native,local),opens=native.opens;
 await assert.rejects(store.unlockOnline(renewed,password,changedKey),e=>e.code==='LOCAL_COPY_UNAVAILABLE');
 assert.equal(native.opens,opens);assert.equal(store.status().locked,true);assert.equal(JSON.stringify(native.snapshot()),before);
});

await check('An unchanged server key still supports an authorized password change',async()=>{
 const {native,keyId}=await seed();let {store,state}=await cold(native);
 const opened=await store.unlockOnline(renewed,'New-authorized-password',reply);
 await store.save({...state,session:renewed,accounts:{owner:opened.account}});assert.equal(native.profile.accounts.owner.keyId,keyId);
 await store.lock();({store}=await cold(native));
 const restored=await store.unlockOffline({username:'windroy',password:'New-authorized-password',role:'instructor'});
 assert.deepEqual({...restored.account},privateAccount);await store.lock();
});

await check('A malformed or foreign server key reply cannot trigger local password recovery',async()=>{
 const {native}=await seed(),before=JSON.stringify(native.snapshot()),{store}=await cold(native),opens=native.opens;
 for(const invalid of [{...changedKey,userId:'another-owner'},{...changedKey,key:'not-a-key'},{...changedKey,localStorageProtocol:1}])
  await assert.rejects(store.unlockOnline(renewed,password,invalid),e=>e.code==='UPDATE_REQUIRED');
 assert.equal(native.opens,opens);assert.equal(JSON.stringify(native.snapshot()),before);
});

const report={status:'passed',passed:checks.length,checks,actualSecureStorageExecuted:true,nativeProtocolModel:true,productionRequests:0};
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/local-key-recovery.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
