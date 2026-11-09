// Actual client publication handler and real server routes, isolated identities.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,spreadsheet,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const draft=()=>({...C.newDraft(),title:'Audit publication',questions:[{...C.blankQuestion(),text:'Question',answers:[{text:'Yes',isCorrect:true},{text:'No',isCorrect:false}]}]});
const one=draft(),catalog=spreadsheet.getSheetByName('_Тести');let body,created;
await check('One persisted draft has the same publication key after a complete JSON restart',async()=>{body=await C.publicationBody(one);assert.deepEqual(await C.publicationBody(JSON.parse(JSON.stringify(one))),body);const next=draft();assert.notEqual((await C.publicationBody(next)).requestId,body.requestId);});
await check('An acknowledgement lost after the authoritative catalog commit does not publish a second test',()=>{
 const before=catalog.getLastRow(),append=catalog.appendRow;let lost=false;
 catalog.appendRow=function(row){const result=append.call(this,row);if(row[1]===one.title&&!lost){lost=true;throw Error('Synthetic reply lost after test commit');}return result;};
 try{assert.throws(()=>api('POST','/api/instructor/tests',instructorToken,body));}finally{catalog.appendRow=append;}
 assert.ok(lost);created=api('POST','/api/instructor/tests',instructorToken,body).test;assert.equal(catalog.getLastRow(),before+1);assert.equal(api('POST','/api/instructor/tests',instructorToken,body).test.id,created.id);
});
await check('Reusing a creation key with changed questions is rejected without another catalog write',()=>{const before=catalog.getLastRow();assert.throws(()=>api('POST','/api/instructor/tests',instructorToken,{...body,title:'Different payload'}),e=>e.code==='REQUEST_CONFLICT');assert.equal(catalog.getLastRow(),before);});
await check('Editing a draft produces a distinct publication request while its previous retry remains stable',async()=>{const changed=structuredClone(one);changed.questions[0].text='New question';assert.notEqual((await C.publicationBody(changed)).requestId,body.requestId);assert.equal((await C.publicationBody(one)).requestId,body.requestId);});
await check('Publication receipts belong to one instructor and cannot be used by a cadet',()=>{
 const code=api('POST','/api/instructor/invite',instructorToken).code,other=api('POST','/api/instructor/register','',{username:'audit_publish_other',fullName:'Publication Other',inviteCode:code,...credential('publication-other-password')});
 const second=api('POST','/api/instructor/tests',other.token,body).test;assert.notEqual(String(second.id),String(created.id));
 const group=api('POST','/api/instructor/groups',instructorToken,{name:'Audit publication group'}).group,cadet=api('POST','/api/register','',{username:'audit_publish_cadet',fullName:'Publication Cadet',groupId:group.id,...credential('publication-cadet-password')});
 assert.throws(()=>api('POST','/api/instructor/tests',cadet.token,body),e=>e.code==='FORBIDDEN');
 assert.equal(JSON.stringify(api('GET','/api/tests',cadet.token)).includes(body.requestId),false);
});
await check('Older clients keep creating distinct tests when they do not supply a publication key',()=>{const legacy=C.draftAPI(draft()),a=api('POST','/api/instructor/tests',instructorToken,legacy).test,b=api('POST','/api/instructor/tests',instructorToken,legacy).test;assert.notEqual(String(a.id),String(b.id));});
const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8'),start=source.indexOf('async function publish(published)'),end=source.indexOf('\nasync function clickAction',start),handler=source.slice(start,end);
assert.ok(start>0&&end>start);
function app(){
 const a={draft:draft(),capabilities:{chunkedTests:true,writtenTests:true,testAccess:true}},S={session:{token:instructorToken,user:{role:'instructor',id:'synthetic'}}};
 const box={S,C,id:C.id,account:()=>a,structuredClone,working:false,render:()=>{},persist:async()=>{},rpc:async(m,p,b,token)=>api(m,p,token,b),refresh:async()=>{},toast:()=>{},page:'editor'};vm.createContext(box);vm.runInContext(handler,box);return {a,S,box};
}
await check('The real publish handler keeps its draft after a lost reply and clears it after an idempotent retry',async()=>{
 const {a,box}=app(),before=catalog.getLastRow();let lose=true;box.rpc=async(m,p,b,token)=>{const reply=api(m,p,token,b);if(lose){lose=false;throw Error('Synthetic network loss');}return reply;};
 await assert.rejects(box.publish(true));assert.ok(a.draft);await box.publish(true);assert.equal(a.draft,null);assert.equal(catalog.getLastRow(),before+1);
});
await check('A disk error before publication prevents sending a test that cannot be recovered locally',async()=>{const {a,box}=app();let sent=0;box.persist=async()=>{throw Error('Synthetic disk failure');};box.rpc=async()=>{sent++;};await assert.rejects(box.publish(true));assert.equal(sent,0);assert.ok(a.draft);});
await check('Changing accounts during publication preparation never publishes with the next account token',async()=>{
 const {a,S,box}=app();let proceed,entered;const ready=new Promise(r=>entered=r),waiting=new Promise(r=>proceed=r);let sent=0;
 box.C={...C,publicationBody:async(...args)=>{entered();await waiting;return C.publicationBody(...args);}};box.rpc=async()=>{sent++;};
 const running=box.publish(true);await ready;S.session={token:'new-account-token',user:{id:'new',role:'instructor'}};proceed();await running;assert.equal(sent,0);assert.ok(a.draft);
});
await check('New local edits made during a successful publication remain in the draft',async()=>{const {a,box}=app();box.rpc=async(m,p,b,token)=>{a.draft.title='A later local edit';return api(m,p,token,b);};await box.publish(true);assert.equal(a.draft.title,'A later local edit');});
const report={status:'passed',passed:checks.length,checks,actualClientHandler:true,productionRequests:0};fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/test-publication.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
