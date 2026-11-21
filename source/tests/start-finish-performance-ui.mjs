import {handleHostWindow} from './fixtures/host-window.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,credential,instructorToken,regressionTest}=await import('./fixtures/server_model.mjs');
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Інтерфейс: 50 питань'}).group;
const p=api('POST','/api/register','',{username:'fast-start-ui',fullName:'Курсант швидкого старту',groupId:group.id,...credential('fast-start-ui-password')});
const training=regressionTest('Швидке тренування — 50 питань',50);
const exam=api('POST','/api/instructor/tests',instructorToken,{title:'Швидкий іспит — 50 питань',mode:'exam',durationMinutes:30,published:true,questions:training.questions}).test;
const root=new URL('../web/',import.meta.url),calls=[],errors=[],checks=[];
let state={version:1,session:p,accounts:{},groups:[group]},journal={},blockStats=true,critical=false,criticalWrites=0;
const details=context.sheet_('resultDetails'),ledger=context.sheet_('sync'),rangeProto=Object.getPrototypeOf(details.getRange(1,1)),setValues=rangeProto.setValues,append=ledger.appendRow,drain=context.drainPublicResults_;
context.drainPublicResults_=function(...args){if(!blockStats)return drain.apply(this,args);};
ledger.appendRow=function(...args){if(critical){criticalWrites++;throw Error('Synchronous auxiliary write');}return append.apply(this,args);};
rangeProto.setValues=function(rows){if(critical&&this.sheet===details){criticalWrites++;throw Error('Synchronous statistics write');}return setValues.call(this,rows);};
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.ttf':'font/ttf'};
const server=http.createServer(async(req,res)=>{
 try{
  if(handleHostWindow(req,res))return;const route=new URL(req.url,'http://local').pathname;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  if(route==='/clock'){res.end(JSON.stringify({ok:true,uptime:100000+performance.now(),launchId:'fast-start-ui'}));return;}
  if(route.startsWith('/updates/')){res.end(JSON.stringify({ok:true,state:2,message:'Актуальна версія'}));return;}
  if(route==='/state'||route==='/journal'){
   if(req.method==='POST'){let data='';for await(const c of req)data+=c;const v=JSON.parse(data);if(route==='/state')state=v;else journal=v;res.end('{"ok":true}');}else res.end(JSON.stringify(route==='/state'?state:journal));return;
  }
  if(route==='/rpc'){
   let data='';for await(const c of req)data+=c;const request=JSON.parse(data);calls.push(request);
   critical=request.method==='POST'&&(request.path==='/api/results'||/\/start$/.test(request.path)||/\/finish$/.test(request.path));
   let reply;try{reply=context.doPost({postData:{contents:data}}).text;}finally{critical=false;}
   res.end(reply);return;
  }
  const name=route==='/'?'index.html':route.slice(1);if(name.includes('..')){res.writeHead(404);res.end();return;}const file=new URL(name,root);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){errors.push(error.message);res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
async function until(test){for(let i=0;i<200;i++){if(test())return;await new Promise(r=>setTimeout(r,50));}throw Error('State did not become ready');}
const saved=()=>state.accounts[p.user.id];
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});page=await browser.newPage({viewport:{width:1440,height:1000},locale:'uk-UA'});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?key=fast-start-ui');await page.locator('.layout').waitFor();await page.locator('.nav [data-page=tests]').click();await page.locator('[data-action=start][data-id="'+training.id+'"]').waitFor();
 await check('The real cold training start opens question one with a single cloud call',async()=>{
  assert.equal(saved()?.fullTests?.[training.id],undefined);await page.locator('[data-action=start][data-id="'+training.id+'"]').click();await page.locator('#modal[open]').waitFor();const first=calls.length;
  await page.locator('#modal button.primary').click();await page.locator('.runner').waitFor();
  const action=calls.slice(first).filter(r=>r.path==='/api/workspace'||r.path==='/api/tests/'+training.id||r.path.endsWith('/start'));
  assert.deepEqual(action.map(r=>r.path),['/api/tests/'+training.id+'/start']);assert.equal(saved().run.test.questions.length,50);
 });
 await check('Fifty actual answer selections and Next actions retain every local answer',async()=>{
  for(let i=0;i<50;i++){
   await page.locator('.question-nav [data-q="'+i+'"].current').waitFor();
   await page.locator('[data-run-answer]').first().check();
   if(i<49){await page.locator('[data-action=next]').click();await page.locator('.question-nav [data-q="'+(i+1)+'"].current').waitFor();}
  }
  await until(()=>Object.keys(saved()?.run?.answers||{}).length===50);assert.equal(saved().run.index,49);
 });
 let result;
 await check('The completed work appears while auxiliary statistics are unavailable',async()=>{
  await page.locator('[data-action=finish]').click();await page.locator('#modal button.primary').click();await page.locator('.result-card').waitFor();await until(()=>saved()?.pending?.length===0&&saved()?.results?.some(r=>String(r.testId)===String(training.id)));
  result=context.listResults_(p.user.id).find(r=>String(r.testId)===String(training.id));assert.ok(result);assert.equal(details.rows.filter(row=>String(row[0])===String(result.id)).length,0);assert.equal(Object.keys(JSON.parse(context.resultRecordById_(result.id).row[13])).length,50);assert.equal(criticalWrites,0);
 });
 await check('Background synchronization fills 50 details once after the statistics service recovers',async()=>{
  blockStats=false;await page.locator('.result-card [data-action=nav][data-page=results]').click();await page.locator('.topbar [data-action=refresh]:not([disabled])').waitFor();await page.locator('.topbar [data-action=refresh]').click();await until(()=>details.rows.filter(row=>String(row[0])===String(result.id)).length===50);assert.equal(context.listResults_(p.user.id).filter(r=>String(r.testId)===String(training.id)).length,1);
 });
 await check('A newly owned exam also reaches question one without discovery or claim calls',async()=>{
  await page.locator('.nav [data-page=tests]').click();await page.locator('[data-action=start][data-id="'+exam.id+'"]').click();await page.locator('#modal[open]').waitFor();const first=calls.length;await page.locator('#modal button.primary').click();await page.locator('.runner').waitFor();
  const action=calls.slice(first).filter(r=>r.path==='/api/workspace'||r.path==='/api/tests/'+exam.id||r.path.startsWith('/api/exam-session'));
  assert.deepEqual(action.map(r=>r.path),['/api/exam-session/start']);assert.equal(saved().run.test.questions.length,50);assert.equal(saved().run.locked,false);
  await page.screenshot({path:new URL('../verification/fast-start-50-question-exam.png',import.meta.url).pathname});
 });
 assert.deepEqual(errors,[]);
}finally{
 fs.writeFileSync(new URL('../verification/start-finish-performance-ui.json',import.meta.url),JSON.stringify({status:checks.length===5&&!errors.length?'passed':'failed',passed:checks.length,checks,errors,criticalAuxiliaryWrites:criticalWrites,questions:50,productionRequests:0},null,2)+'\n');
 await browser?.close();await new Promise(resolve=>server.close(resolve));context.drainPublicResults_=drain;ledger.appendRow=append;rangeProto.setValues=setValues;
}
