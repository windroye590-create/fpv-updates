// Regression tests use the production Apps Script source with isolated Sheets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,credential,instructorToken,spreadsheet,lock}=await import('./fixtures/server_model.mjs');
const props=context.PropertiesService.getScriptProperties(),checks=[];
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Reliability repairs'}).group;
let serial=0;
const cadet=()=>api('POST','/api/register','',{fullName:'Reliability Cadet '+serial,username:'reliability_cadet_'+(++serial),groupId:group.id,...credential('reliability-password')});
const draft=()=>({...C.newDraft(),title:'Reliability Test '+(++serial),questions:[{...C.blankQuestion(),text:'Question?',answers:[{text:'Yes',isCorrect:true},{text:'No',isCorrect:false}]}]});
async function create(){return api('POST','/api/instructor/tests',instructorToken,await C.publicationBody(draft(),true)).test;}
const users=spreadsheet.getSheetByName('_Користувачі'),catalog=spreadsheet.getSheetByName('_Тести');
const publicSheet=context.publicResultsSheet_(),userRow=u=>users.rows.find(row=>String(row[0])===String(u.user.id));
const publicRows=u=>Array.from(context.publicRowsFromSheet_(publicSheet)).filter(row=>String(row[6])===String(u.user.id));
const pending=u=>api('GET','/api/public-table-sync',u?.token||instructorToken).publicTableSync;
const one=cadet(),test=await create();
api('POST',`/api/instructor/tests/${test.id}/access`,instructorToken,{expectedRevision:1,scope:'all',open:true});
await check('Archiving and restoring a group refreshes conditional test access immediately',()=>{
 const initial=api('GET','/api/workspace',one.token,{});
 assert.equal(initial.changes.tests.find(t=>t.id===test.id).access.open,true);
 api('POST',`/api/instructor/groups/${group.id}/archive`,instructorToken,{archived:true,expectedRevision:1});
 const archived=api('GET','/api/workspace',one.token,{known:initial.revisions});
 assert.notEqual(archived.revisions.tests,initial.revisions.tests);
 assert.equal(archived.changes.tests.find(t=>t.id===test.id).access.open,false);
 api('POST',`/api/instructor/groups/${group.id}/archive`,instructorToken,{archived:false,expectedRevision:2});
 const restored=api('GET','/api/workspace',one.token,{known:archived.revisions});
 assert.equal(restored.changes.tests.find(t=>t.id===test.id).access.open,true);
});
await check('A revision failure retains a durable scope plan and the next read completes it',()=>{
 const before=api('GET','/api/workspace',instructorToken,{}),set=props.setProperty;
 props.setProperty=function(key,value){if(key==='LK_REV_tests')throw Error('Transient revision fault');return set.call(this,key,value);};
 try{assert.ok(api('POST','/api/instructor/groups',instructorToken,{name:'Recovered revision group'}).group);}finally{props.setProperty=set;}
 const marker=JSON.parse(props.getProperty('LK_WORKSPACE_WRITE'));
 assert.deepEqual(marker.scopes,['groups','tests']);
 const recovered=api('GET','/api/workspace',instructorToken,{known:before.revisions});
 assert.equal(recovered.snapshotStable,true);assert.equal(props.getProperty('LK_WORKSPACE_WRITE'),null);
 assert.equal(props.getProperty('LK_REV_groups'),marker.nonce);assert.equal(props.getProperty('LK_REV_tests'),marker.nonce);
 assert.ok(recovered.changes.groups.some(g=>g.name==='Recovered revision group'));assert.ok(recovered.changes.tests);
});
await check('Failure while clearing a committed marker safely retries without duplicating data',()=>{
 const remove=props.deleteProperty;let fail=true;
 props.deleteProperty=function(key){if(key==='LK_WORKSPACE_WRITE'&&fail){fail=false;throw Error('Transient marker deletion fault');}return remove.call(this,key);};
 try{api('POST','/api/instructor/groups',instructorToken,{name:'Recovered marker cleanup'});}finally{props.deleteProperty=remove;}
 assert.ok(props.getProperty('LK_WORKSPACE_WRITE'));
 assert.equal(api('GET','/api/workspace',instructorToken).snapshotStable,true);
 assert.equal(props.getProperty('LK_WORKSPACE_WRITE'),null);
 assert.equal(context.listGroups_().filter(g=>g.name==='Recovered marker cleanup').length,1);
});
await check('A live writer keeps its marker until the script lock can be acquired',()=>{
 const marker=JSON.stringify({v:1,nonce:'test-live-writer',scopes:['groups']}),take=lock.tryLock;
 props.setProperty('LK_WORKSPACE_WRITE',marker);lock.tryLock=()=>false;
 try{assert.equal(api('GET','/api/workspace',instructorToken).snapshotStable,false);assert.equal(props.getProperty('LK_WORKSPACE_WRITE'),marker);}finally{lock.tryLock=take;}
 assert.equal(api('GET','/api/workspace',instructorToken).snapshotStable,true);
 assert.equal(props.getProperty('LK_REV_groups'),'test-live-writer');
});
await check('An old server marker invalidates every scope before it is retired',()=>{
 const scopes=['groups','tests','cadets','results','materials','progress'];
 const before=Object.fromEntries(scopes.map(k=>[k,props.getProperty('LK_REV_'+k)]));
 props.setProperty('LK_WORKSPACE_WRITE','legacy-orphan-nonce');
 assert.equal(api('GET','/api/workspace',instructorToken).snapshotStable,true);
 assert.equal(props.getProperty('LK_WORKSPACE_WRITE'),null);
 for(const k of scopes)assert.notEqual(props.getProperty('LK_REV_'+k),before[k]);
});
await check('A failed recovery cannot discard its obligation or acknowledge a stable snapshot',()=>{
 const marker=JSON.stringify({v:1,nonce:'test-recovery-retry',scopes:['groups','tests']}),set=props.setProperty;
 props.setProperty('LK_WORKSPACE_WRITE',marker);
 props.setProperty=function(key,value){if(key==='LK_REV_tests')throw Error('Recovery write fault');return set.call(this,key,value);};
 try{assert.throws(()=>api('GET','/api/workspace',instructorToken),/Recovery write fault/);assert.equal(props.getProperty('LK_WORKSPACE_WRITE'),marker);}finally{props.setProperty=set;}
 assert.equal(api('GET','/api/workspace',instructorToken).snapshotStable,true);assert.equal(props.getProperty('LK_WORKSPACE_WRITE'),null);
});
await check('A replacement replays its receipt after the original is archived',async()=>{
 const original=await create(),body=await C.publicationBody(draft(),true),before=catalog.getLastRow();
 const replaced=api('POST',`/api/instructor/tests/${original.id}/replace`,instructorToken,body).test;
 const replay=api('POST',`/api/instructor/tests/${original.id}/replace`,instructorToken,JSON.parse(JSON.stringify(body))).test;
 assert.equal(replay.id,replaced.id);assert.equal(catalog.getLastRow(),before+1);
 assert.equal(context.isArchivedTest_(context.getTestById_(original.id)),true);
 assert.throws(()=>api('POST',`/api/instructor/tests/${original.id}/replace`,instructorToken,{...body,title:'Changed payload'}),e=>e.code==='REQUEST_CONFLICT');
});
await check('A lost replacement append acknowledgement resumes the same version',async()=>{
 const original=await create(),body=await C.publicationBody(draft(),true),append=catalog.appendRow,before=catalog.getLastRow();let lost=false;
 catalog.appendRow=function(row){const out=append.call(this,row);if(row[1]===body.title&&!lost){lost=true;throw Error('Replacement commit acknowledgement lost');}return out;};
 try{assert.throws(()=>api('POST',`/api/instructor/tests/${original.id}/replace`,instructorToken,body),/acknowledgement lost/);}finally{catalog.appendRow=append;}
 assert.equal(context.isArchivedTest_(context.getTestById_(original.id)),false);
 const replay=api('POST',`/api/instructor/tests/${original.id}/replace`,instructorToken,body).test;
 assert.equal(catalog.getLastRow(),before+1);assert.equal(context.isArchivedTest_(context.getTestById_(original.id)),true);assert.ok(replay.id);
});
await check('A failed original archive write resumes instead of creating another replacement',async()=>{
 const original=await create(),body=await C.publicationBody(draft(),true),proto=Object.getPrototypeOf(catalog.getRange(1,1)),set=proto.setValue,before=catalog.getLastRow();
 // createTest responses omit rowNumber; locate the authoritative original.
 const originalRow=context.getTestById_(original.id).rowNumber;
 proto.setValue=function(value){if(this.sheet===catalog&&this.row===originalRow&&this.column===3)throw Error('Original archive fault');return set.call(this,value);};
 try{assert.throws(()=>api('POST',`/api/instructor/tests/${original.id}/replace`,instructorToken,body),/Original archive fault/);}finally{proto.setValue=set;}
 assert.equal(catalog.getLastRow(),before+1);
 const replay=api('POST',`/api/instructor/tests/${original.id}/replace`,instructorToken,body).test;
 assert.equal(catalog.getLastRow(),before+1);assert.ok(replay.id);assert.equal(context.isArchivedTest_(context.getTestById_(original.id)),true);
});
await check('A replacement request key is bound to its original test',async()=>{
 const a=await create(),b=await create(),body=await C.publicationBody(draft(),true);
 api('POST',`/api/instructor/tests/${a.id}/replace`,instructorToken,body);
 assert.throws(()=>api('POST',`/api/instructor/tests/${b.id}/replace`,instructorToken,body),e=>e.code==='REQUEST_CONFLICT');
 assert.equal(context.isArchivedTest_(context.getTestById_(b.id)),false);
});
let missing;
await check('An interrupted cadet publication remains pending in the committed user row and sync status',()=>{
 const append=publicSheet.appendRow;publicSheet.appendRow=()=>{throw Error('Public table unavailable');};
 try{missing=cadet();}finally{publicSheet.appendRow=append;}
 assert.equal(missing.tableSynced,false);assert.equal(userRow(missing)[9],'pending');assert.equal(publicRows(missing).length,0);
 const status=pending(missing);assert.equal(status.state,'pending');assert.equal(status.pendingCount,1);assert.equal(pending(one).pendingCount,0);
});
await check('The background worker retries a missing cadet and acknowledges it only after publication',()=>{
 props.deleteProperty('LK_PUBLIC_SYNC_RETRY_V1');
 const status=pending(missing);assert.equal(status.state,'synced');assert.equal(status.pendingCount,0);
 assert.equal(userRow(missing)[9],'');assert.equal(publicRows(missing).length,1);
});
await check('A lost public append acknowledgement retries without duplicating the cadet',()=>{
 const append=publicSheet.appendRow;let lost=false,account;
 publicSheet.appendRow=function(row){const out=append.call(this,row);if(!lost){lost=true;throw Error('Public append acknowledgement lost');}return out;};
 try{account=cadet();}finally{publicSheet.appendRow=append;}
 assert.equal(account.tableSynced,false);assert.equal(userRow(account)[9],'pending');assert.equal(publicRows(account).length,1);
 props.deleteProperty('LK_PUBLIC_SYNC_RETRY_V1');assert.equal(pending(account).state,'synced');assert.equal(publicRows(account).length,1);
});
await check('A failed publication flag acknowledgement preserves retry and avoids duplicate public rows',()=>{
 const proto=Object.getPrototypeOf(users.getRange(1,1)),set=proto.setValue;let account;
 proto.setValue=function(value){if(this.sheet===users&&this.column===10&&value==='')throw Error('Publication flag acknowledgement lost');return set.call(this,value);};
 try{account=cadet();}finally{proto.setValue=set;}
 assert.equal(account.tableSynced,false);assert.equal(userRow(account)[9],'pending');assert.equal(publicRows(account).length,1);
 props.deleteProperty('LK_PUBLIC_SYNC_RETRY_V1');assert.equal(pending(account).state,'synced');assert.equal(publicRows(account).length,1);
});
await check('Placeholder catch-up preserves the two-publication request limit',()=>{
 const append=publicSheet.appendRow,accounts=[];publicSheet.appendRow=()=>{throw Error('Batch public outage');};
 try{for(let i=0;i<5;i++)accounts.push(cadet());}finally{publicSheet.appendRow=append;}
 props.deleteProperty('LK_PUBLIC_SYNC_RETRY_V1');
 assert.equal(pending().pendingCount,3);assert.equal(pending().pendingCount,1);assert.equal(pending().pendingCount,0);
 for(const account of accounts)assert.equal(publicRows(account).length,1);
});
await check('Deleting cadets are excluded from placeholder publication and status',()=>{
 const append=publicSheet.appendRow;let account;publicSheet.appendRow=()=>{throw Error('Public outage before deletion');};
 try{account=cadet();}finally{publicSheet.appendRow=append;}
 props.setProperty('DELETING_CADET_'+account.user.id,'1');props.deleteProperty('LK_PUBLIC_SYNC_RETRY_V1');context.invalidatePublicSync_();
 assert.equal(pending().pendingCount,0);assert.equal(publicRows(account).length,0);
 props.deleteProperty('DELETING_CADET_'+account.user.id);context.invalidatePublicSync_();
 assert.equal(pending().pendingCount,0);assert.equal(publicRows(account).length,1);
});
await check('Upgrade queues prior cadets once and repairs a previously missing placeholder',()=>{
 const account=cadet(),row=publicSheet.rows.findIndex(r=>String(r[publicSheet.rows[0].indexOf('_ID курсанта')])===String(account.user.id));publicSheet.rows.splice(row,1);
 props.deleteProperty('LK_CADET_PUBLIC_MIGRATED_V1');context.CacheService.getScriptCache().remove('LK_SCHEMA_READY_PUBLIC_CADETS_V1');
 api('GET','/api/app-info');assert.equal(userRow(account)[9],'pending');
 const queued=users.rows.slice(1).filter(r=>r[9]==='pending').length;assert.ok(queued>0);
 for(let i=0;i<Math.ceil(queued/2)+1;i++)pending();
 assert.equal(publicRows(account).length,1);assert.equal(userRow(account)[9],'');
 const before=JSON.stringify(users.rows);api('GET','/api/app-info');assert.equal(JSON.stringify(users.rows),before);
});
await check('Manual full repair also acknowledges pending cadet publication',()=>{
 const append=publicSheet.appendRow;let account;publicSheet.appendRow=()=>{throw Error('Manual recovery outage');};
 try{account=cadet();}finally{publicSheet.appendRow=append;}
 assert.equal(userRow(account)[9],'pending');api('POST','/api/instructor/results-sheet/sync',instructorToken);
 assert.equal(userRow(account)[9],'');assert.equal(publicRows(account).length,1);assert.equal(pending(account).state,'synced');
});
const report={status:'passed',passed:checks.length,checks,isolatedRealServerSource:true,productionRequests:0};
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/fix-server-reliability.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
