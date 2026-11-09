import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildStatement} from '../web/statement.js';

process.env.LITAKOVA_SERVER_SOURCE=process.env.LITAKOVA_RECENT_SERVER_SOURCE||new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,credential,regressionTest}=await import('./fixtures/server_model.mjs');
const announcementBefore=api('GET','/api/app-info');
const checks=[];const check=(name,run)=>{run();checks.push(name);};
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Перевірка повної історії'}).group;
const cadet=api('POST','/api/register','',{fullName:'Курсант Старий Результат',username:'recent_history_cadet',groupId:group.id,...credential('history-password')});
const oldTest=regressionTest('Давній завершений тест');
const sheet=context.sheet_('results'),header=sheet.rows[0].slice();
context.sheet_('resultDetails').rows=context.sheet_('resultDetails').rows.slice(0,1);
function seed(count){
 sheet.rows=[header];
 for(let i=0;i<count;i++)sheet.appendRow(['load-r-'+i,i===0?cadet.user.id:'other-'+i,i===0?cadet.user.fullName:'Курсант '+i,group.name,i===0?oldTest.id:'other-test','Тест '+i,80,8,10,60,new Date(Date.UTC(2026,0,1)+i*1000).toISOString(),true,'submission-'+i,'{}',0,false]);
}
const prototype=Object.getPrototypeOf(sheet.getRange(2,1)),read=prototype.getValues;
let ranges=[];
prototype.getValues=function(){if(this.sheet===sheet)ranges.push({row:this.row,column:this.column,rows:this.rowCount,columns:this.columnCount});return read.call(this);};
function capture(body={},token=instructorToken,path='/api/workspace'){
 ranges=[];const start=performance.now(),response=api('GET',path,token,body);
 return {response,reads:ranges.slice(),cells:ranges.reduce((sum,r)=>sum+r.rows*r.columns,0),milliseconds:Math.round(performance.now()-start)};
}

seed(10000);
const saved=JSON.stringify(sheet.rows);
const home=capture();
const full=capture({allResults:true});
const report={kind:'isolated_real_server_logic_spreadsheet_read_volume',rows:10000,home:{returned:home.response.changes.results.length,total:home.response.resultTotal,cells:home.cells,ranges:home.reads,milliseconds:home.milliseconds},fullHistory:{returned:full.response.changes.results.length,total:full.response.resultTotal,cells:full.cells},liveServerTimingMeasured:false};
if(process.argv.includes('--benchmark-only')){
 fs.writeFileSync(process.env.LITAKOVA_RECENT_REPORT||new URL('../verification/recent-results-before.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));process.exit(0);
}

check('Home returns the latest 500 records and the full history count',()=>{
 assert.equal(home.response.changes.results.length,500);assert.equal(home.response.resultTotal,10000);assert.equal(home.response.resultsTruncated,true);
 assert.deepEqual(home.response.changes.results.map(r=>r.id),Array.from({length:500},(_,i)=>'load-r-'+(9999-i)));
});
check('Home reads at most 500 summary rows including recovery provenance and omits answer and submission columns',()=>{
 assert.equal(home.cells,11500);assert.equal(home.reads.length,3);
 for(const r of home.reads){assert.equal(r.row,9502);assert.equal(r.rows,500);assert.ok(r.column===1&&r.columns===12||r.column===15&&r.columns===8||r.column===24&&r.columns===3);}
});
check('Full workspace history retains every record including the oldest',()=>{
 assert.equal(full.response.changes.results.length,10000);assert.equal(full.response.resultTotal,10000);assert.equal(full.response.resultsTruncated,false);
 assert.ok(full.response.changes.results.some(r=>r.id==='load-r-0'));assert.equal(full.cells,230000);
});
check('Explicit instructor result endpoint remains complete',()=>{
 const all=capture({},instructorToken,'/api/instructor/results');assert.equal(all.response.results.length,10000);assert.ok(all.response.results.some(r=>r.id==='load-r-0'));
});
check('A cadet keeps an old result outside the instructor home window',()=>{
 const own=capture({},cadet.token);assert.equal(own.response.changes.results.length,1);assert.equal(own.response.resultTotal,1);assert.equal(own.response.resultsTruncated,false);assert.equal(own.response.changes.results[0].id,'load-r-0');
});
check('Analytics includes the entire history and an old filtered result',()=>{
 assert.equal(api('GET','/api/instructor/analytics',instructorToken).attempts,10000);
 const filtered=api('GET','/api/instructor/analytics',instructorToken,{groupName:group.name,testId:String(oldTest.id)});assert.equal(filtered.attempts,1);assert.equal(filtered.average,80);
});
check('Lesson and group statement retain an old result outside the home window',()=>{
 const lesson=api('GET',`/api/instructor/lesson/${oldTest.id}/${group.id}`,instructorToken);assert.ok(lesson.results.some(r=>r.id==='load-r-0'));
 const source={groups:[group],tests:[oldTest],cadets:[cadet.user],results:full.response.changes.results,instructor:context.requireSession_(instructorToken)};
 assert.equal(buildStatement(source,group.id,oldTest.id,'19.10.2026').rows[0].result.id,'load-r-0');
});
check('Read-only preview preserves authoritative scores, answers and rating inputs',()=>assert.equal(JSON.stringify(sheet.rows),saved));
check('An unchanged workspace skips result reads entirely',()=>{const quiet=capture({known:home.response.revisions});assert.equal(quiet.cells,0);assert.equal(quiet.response.changes.results,undefined);});
check('Changing from a home cursor to full history cannot reuse a truncated preview',()=>{const all=capture({known:home.response.revisions,allResults:true});assert.equal(all.response.changes.results.length,10000);assert.equal(all.response.resultTotal,10000);});
check('A new accepted result invalidates the preview and advances the latest window',()=>{
 const fresh=regressionTest('Новий результат після оновлення');const posted=api('POST','/api/results',cadet.token,{testId:fresh.id,submissionId:'recent-new-result',answers:[],durationSeconds:2});
 const changed=capture({known:home.response.revisions});assert.equal(changed.response.resultTotal,10001);assert.equal(changed.response.changes.results.length,500);assert.equal(changed.response.changes.results[0].id,posted.result.id);assert.equal(changed.cells,11500);
});
check('A concurrent mutation cannot acknowledge a stable snapshot',()=>{
 const props=context.PropertiesService.getScriptProperties(),lock=context.LockService.getScriptLock(),tryLock=lock.tryLock;props.setProperty('LK_WORKSPACE_WRITE','testing');lock.tryLock=()=>false;try{assert.equal(capture().response.snapshotStable,false);}finally{lock.tryLock=tryLock;props.deleteProperty('LK_WORKSPACE_WRITE');}
});
check('An empty result table avoids invalid zero-sized reads',()=>{seed(0);const empty=capture();assert.deepEqual(empty.response.changes.results,[]);assert.equal(empty.response.resultTotal,0);assert.equal(empty.response.resultsTruncated,false);assert.equal(empty.cells,0);});
check('A small table is returned whole with correct totals',()=>{seed(103);const small=capture();assert.equal(small.response.changes.results.length,103);assert.equal(small.response.resultTotal,103);assert.equal(small.response.resultsTruncated,false);assert.equal(small.cells,2369);});
check('Exactly 500 rows are returned without a truncation warning',()=>{seed(500);const exact=capture();assert.equal(exact.response.changes.results.length,500);assert.equal(exact.response.resultTotal,500);assert.equal(exact.response.resultsTruncated,false);assert.equal(exact.cells,11500);});
check('Home remains limited to 500 after physical deletion of a row',()=>{seed(10000);sheet.deleteRow(2);const deleted=capture();assert.equal(deleted.response.resultTotal,9999);assert.equal(deleted.response.changes.results.length,500);assert.equal(deleted.cells,11500);});
check('Health identifies the optimized build and result reads preserve client update announcements',()=>{const health=JSON.parse(context.doGet().text);assert.equal(health.recentResultsRead,true);assert.ok(Number.isInteger(health.version)&&health.version>=11);assert.match(health.serverBuild,/^pc-(?:\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?|api\d+-[a-f0-9]{16})$/);assert.deepEqual(api('GET','/api/app-info'),announcementBefore);});
report.passed=checks.length;report.checks=checks;report.testedAt=new Date().toISOString();
fs.writeFileSync(process.env.LITAKOVA_RECENT_REPORT||new URL('../verification/recent-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('Recent result window: '+checks.length+' passed. Home reads '+home.cells+' cells; full history '+full.cells+'.');
