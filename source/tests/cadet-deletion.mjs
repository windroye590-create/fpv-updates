import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
import {api,context,credential,instructorToken,regressionTest,regressionBody,spreadsheet,publicRows as canonicalRows} from './fixtures/server_model.mjs';

const group=api('POST','/api/instructor/groups',instructorToken,{name:'Повне видалення акаунта'}).group;
const publicSheet=context.publicResultsSpreadsheet_(false).getSheetByName('Результати курсантів');
const props=context.PropertiesService.getScriptProperties();
const checks=[];
const check=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name);};
const reject=(run,code)=>assert.throws(run,error=>error.code===code);
const cadet=(username,fullName)=>api('POST','/api/register','',{
 username,fullName,groupId:group.id,...credential('cadet-deletion-fixture-password')
});
const path=person=>'/api/instructor/users/'+person.user.id;
const remove=person=>api('DELETE',path(person),instructorToken,{confirmUserId:String(person.user.id)});
const submit=(person,test,key)=>api('POST','/api/results',person.token,regressionBody(test,key)).result;
const publicRows=()=>canonicalRows(publicSheet).slice(1);
const matchesId=(row,result)=>String(row[7])===String(result.id);
const withoutIds=result=>Array.from(context.publicResultValues_(result),(value,index)=>index===6||index===7?'':value);

await check('A copied legacy row in the shared spreadsheet is removed with its account and a namesake is preserved',()=>{
 const a=cadet('legacy_copy_target','Однакове ім’я в таблиці'),b=cadet('legacy_copy_keep',a.user.fullName);
 const removed=submit(a,regressionTest('Робота для видалення'),'same-submission-key');
 const kept=submit(b,regressionTest('Робота іншого курсанта'),'same-submission-key');
 const legacyRow=withoutIds(removed);
 context.appendPublicRow_(publicSheet,legacyRow);
 assert.equal(remove(a).deleted,true);
 assert.ok(!publicRows().some(row=>matchesId(row,removed)||row===legacyRow||row[5]===removed.testTitle));
 assert.ok(publicRows().some(row=>matchesId(row,kept)));
 assert.ok(context.dataRows_('sync').some(row=>row[1]==='result:'+kept.id));
 assert.ok(context.findUserById_(b.user.id).active);
});

await check('Ambiguous rows in the current spreadsheet and conflicting IDs stop before erasure',()=>{
 const a=cadet('ambiguous_target','Два однакові рядки'),b=cadet('ambiguous_keep',a.user.fullName);
 const test=regressionTest('Однакові оцінки');
 const first=submit(a,test,'ambiguous-shared-a'),second=submit(b,test,'ambiguous-shared-b');
 context.appendPublicRow_(publicSheet,withoutIds(first));
 try{reject(()=>remove(a),'PUBLIC_RESULTS_ID_REQUIRED');}
 finally{publicSheet.deleteRows(publicSheet.getLastRow(),1);}
 const row=publicSheet.rows.find(row=>String(row[publicSheet.rows[0].indexOf('_ID результату')])===String(first.id)),owner=publicSheet.rows[0].indexOf('_ID курсанта');
 row[owner]=String(b.user.id);
 try{reject(()=>remove(a),'PUBLIC_RESULTS_SCHEMA');}
 finally{row[owner]=String(a.user.id);}
 assert.ok(context.findUserById_(a.user.id).active);
 assert.ok(publicRows().some(row=>matchesId(row,second)));
});

await check('Legacy-only scores and a historical registration row are removed from both spreadsheets',()=>{
 const a=cadet('legacy_only_target','Ім’я в чинному акаунті');
 const oldName='Ім’я в старій таблиці',oldTitle='Старе проходження';
 spreadsheet.getSheetByName('_Результати').appendRow([
  'legacy-score','legacy-device','1','legacy-result',a.user.id,oldName,group.name,'legacy-test',oldTitle,50,1,2,true,17,new Date(),new Date()
 ]);
 const legacy=spreadsheet.insertSheet('Результати курсантів');
 const row=[oldName,1,1,context.formatDuration_(17),50];
 legacy.maxColumns=5;
 legacy.rows=[canonicalRows(publicSheet)[0].slice(0,5),row];
 context.appendPublicRow_(publicSheet,[...row,oldTitle,'','']);
 context.appendPublicRow_(publicSheet,[a.user.fullName,'','','','','','','']);
 try{
  assert.equal(remove(a).deleted,true);
  assert.equal(legacy.getLastRow(),1);
  assert.ok(!publicRows().some(row=>[oldName,a.user.fullName].includes(row[0])));
 }finally{spreadsheet.sheets.delete('Результати курсантів');}
});

await check('Full erasure clears instructor drafts, leases, cadet progress and login access',()=>{
 const a=cadet('full_erase_target','Пов’язана робота');
 const result=submit(a,regressionTest('Чернетка перевірки'),'full-erase-result');
 const key='grading:'+result.id;
 const save=()=>api('POST','/api/account-state/document',instructorToken,{
  key,expectedRevision:0,requestId:crypto.randomUUID(),value:{revision:0,items:{q1:{points:1,comment:'Дані роботи'}}}
 });
 save();
 const before=api('GET','/api/account-state',instructorToken);
 const leaseKey=context.reviewLeaseKey_(result.id);
 props.setProperty(leaseKey,'lease fixture');
 props.setProperty('LK_PC_STATE_'+a.user.id,'cadet cursor');
 context.sheet_('materialProgress').appendRow(['material','1',a.user.id,2,2,10,true,new Date()]);
 context.logAudit_(a.user,'EXAM_RECOVERY_SUBMIT','test','old-id','Перенесена робота','Пов’язаний запис');
 const reply=remove(a);
 assert.ok(reply.resultIds.includes(String(result.id)));
 assert.equal(remove(a).alreadyDeleted,true);
 const after=api('GET','/api/account-state',instructorToken,{known:before.cursor});
 assert.notEqual(after.cursor,before.cursor);
 assert.ok(!after.documents.some(document=>document.key===key));
 assert.equal(props.getProperty(leaseKey),null);
 assert.equal(props.getProperty('LK_PC_STATE_'+a.user.id),null);
 assert.ok(!context.dataRows_('materialProgress').some(row=>String(row[2])===String(a.user.id)));
 assert.ok(!context.dataRows_('audit').some(row=>String(row[1])===String(a.user.id)));
 reject(save,'REVIEW_UNAVAILABLE');
 reject(()=>api('GET','/api/my-results',a.token),'SESSION_EXPIRED');
});

await check('A partially deleted account cannot republish pending results or create a new placeholder',()=>{
 const a=cadet('interrupted_account','Перерване очищення таблиці');
 const test=regressionTest('Черга таблиці'),result=submit(a,test,'interrupted-account-result');
 const record=context.findResultRecord_(a.user.id,test.id);
 context.sheet_('results').rows[record.rowNumber-1][26]='pending';
 const details=context.sheet_('resultDetails'),deleteRows=details.deleteRows;
 details.deleteRows=()=>{throw Error('Temporary spreadsheet write failure');};
 try{
  reject(()=>remove(a),'DELETION_INCOMPLETE');
  reject(()=>api('POST','/api/instructor/results/'+result.id+'/grade',instructorToken,{}),'DELETION_PENDING');
  api('GET','/api/workspace',instructorToken);
  api('POST','/api/instructor/results-sheet/sync',instructorToken);
  assert.ok(!publicRows().some(row=>String(row[6])===String(a.user.id)||matchesId(row,result)));
 }finally{details.deleteRows=deleteRows;}
 assert.equal(remove(a).deleted,true);
 assert.equal(context.findResultRecord_(a.user.id,test.id),null);
});

await check('The actual confirmation handler cleans the selected cadet and work caches after a matching acknowledgement',async()=>{
 const a=cadet('client_deletion_target','Видалення з кабінету'),b=cadet('client_deletion_keep','Інший акаунт');
 const test=regressionTest('Кеш робіт'),target=submit(a,test,'client-deletion'),kept=submit(b,test,'client-keep');
 const {user}=api('GET','/api/workspace',instructorToken);
 const account={cadets:[a.user,b.user],results:[target,kept],reviews:{[target.id]:[],[kept.id]:[]},
  gradingDrafts:{[target.id]:{revision:0}},workspaceRevisions:{cadets:'old',results:'old'},cadetCardCache:{cadet:a.user,notes:[]},cadetNoteDrafts:{[a.user.id]:{text:'Прибрати'},[b.user.id]:{text:'Залишити'}}};
 const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const start=app.indexOf(" else if(act==='delete-cadet')");
 const end=app.indexOf(" else if(act==='review-result')",start);
 const sandbox={a:account,act:'delete-cadet',tid:String(a.user.id),id:C.id,e:C.esc,S:{session:{user,token:instructorToken},accounts:{}},
  instructor:()=>true,reviewQueue:[target,kept],examRecoveryQueue:[{userId:a.user.id}],grading:null,
  persist:async()=>{},render:()=>{},toast:()=>{},refresh:async()=>{},
  confirmAction:(_title,_text,action)=>action()};
 sandbox.rpc=(method,route,body,token)=>api(method,route,token,body);
 const state=vm.createContext(sandbox);
 const helpers=app.slice(app.indexOf('function forgetResultDetails('),app.indexOf('function confirmResultDeletion('));
 await vm.runInContext(helpers+'\n(async()=>{'+app.slice(start,end).replace('else if','if')+'})()',state);
 assert.deepEqual(account.cadets.map(item=>item.id),[b.user.id]);
 assert.deepEqual(Array.from(account.results,item=>item.id),[kept.id]);
 assert.equal(account.reviews[target.id],undefined);
 assert.equal(account.gradingDrafts[target.id],undefined);
 assert.equal(account.cadetCardCache,undefined);
 assert.equal(account.cadetNoteDrafts[a.user.id],undefined);
 assert.equal(account.cadetNoteDrafts[b.user.id].text,'Залишити');
 assert.equal(state.examRecoveryQueue.length,0);
 assert.equal(context.findUserById_(a.user.id),null);
 assert.ok(!publicRows().some(row=>matchesId(row,target)));
});

fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/cadet-deletion.json',import.meta.url),JSON.stringify({passed:checks.length,checks,productionRequests:0},null,2));
