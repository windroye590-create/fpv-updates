// Real application, real Apps Script logic, isolated local transport and identities.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const {api,context,instructorToken,credential,regressionTest,regressionBody}=await import('./fixtures/server_model.mjs');
const root=new URL('../',import.meta.url).pathname,web=path.join(root,'web'),teacher=context.publicUser_(context.requireSession_(instructorToken));
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Група для Excel UI'}).group;
const cadet=api('POST','/api/register','',{fullName:'Курсант Excel Інтерфейс',username:'excel_ui_cadet',groupId:group.id,...credential('excel-ui-password')});
const test=regressionTest('Тест Excel інтерфейс');api('POST','/api/results',cadet.token,regressionBody(test,'excel-ui-result'));
let state={version:1,theme:'light',session:{token:instructorToken,user:teacher},groups:[],accounts:{}},journal={},dropArchiveOnce=false;
const checks=[],errors=[],calls=[];
const server=http.createServer(async(req,res)=>{try{
 const route=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');const json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
 if(['/state','/journal'].includes(route)){if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;if(route==='/state')state=JSON.parse(raw);else journal=JSON.parse(raw);json({ok:true});}else json(route==='/state'?state:journal);return;}
 if(route==='/clock'){json({ok:true,uptime:100000+performance.now(),launchId:'excel-ui'});return;}
 if(route.startsWith('/updates/')){json({ok:true,state:2,message:'Актуальна версія'});return;}
 if(route==='/rpc'){let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);calls.push(p);if(dropArchiveOnce&&p.path==='/api/instructor/intake/archive'){dropArchiveOnce=false;json({ok:false,code:'NETWORK',error:'Ізольовано втрачено завантаження архіву'});return;}res.setHeader('Content-Type','application/json');res.end(context.doPost({postData:{contents:raw}}).text);return;}
 const file=path.resolve(web,route==='/'?'index.html':route.slice(1));if(!file.startsWith(web+path.sep)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(e){errors.push(String(e));res.writeHead(500);res.end('Isolated fixture failure');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,page;
const nav=async name=>page.evaluate(async name=>(await import('/app.js')).navigate(name),name);
const click=action=>page.locator(`[data-action="${action}"]`).first().click();
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
async function downloaded(event,name){await event.saveAs(path.join(root,'verification',name));const raw=fs.readFileSync(path.join(root,'verification',name));assert.equal(raw.subarray(0,2).toString(),'PK');assert.ok(event.suggestedFilename().endsWith('.xlsx'));return raw;}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.LITAKOVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1440,height:1000},locale:'uk-UA',timezoneId:'Europe/Simferopol'});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?key=excel-ui');await page.locator('.layout').waitFor();
 await check('The actual Results screen exports a filtered three-sheet Excel workbook',async()=>{
  await nav('results');await page.locator('.topbar [data-action=refresh]:not([disabled])').waitFor();await page.locator('#shared-group').selectOption(String(group.id));
  const waiting=page.waitForEvent('download');await click('export-xlsx');const event=await waiting;await downloaded(event,'excel-ui-results.xlsx');
  const request=calls.filter(p=>p.path==='/api/instructor/reports/results').at(-1);assert.equal(request.body.groupId,String(group.id));
  execFileSync('python3',['-c',"import sys;from openpyxl import load_workbook;w=load_workbook(sys.argv[1]);assert w.sheetnames==['Результати','Відомість групи','Зведення'];s=w['Результати'];assert s.max_row==4;assert s.cell(4,2).value=='Група для Excel UI';assert s.cell(4,4).value.hour>=0",path.join(root,'verification/excel-ui-results.xlsx')]);
  await page.screenshot({path:path.join(root,'verification/excel-results-ui.png'),fullPage:true});
 });
 let jobId,automatic;
 await check('The intake dialog records a useful archive name before requesting cleanup',async()=>{
  await nav('cadets');await click('new-intake');await page.locator('[name=intakeArchiveName]').fill('Набір UI автозбереження');await page.locator('[name=intakeReviewed]').check();await page.locator('[name=intakeConfirmation]').fill('НОВИЙ НАБІР');dropArchiveOnce=true;await page.locator('#dialog-form button.primary').click();await page.getByText('Ізольовано втрачено завантаження архіву',{exact:false}).waitFor();
  const active=api('GET','/api/instructor/intake',instructorToken).intake;jobId=active.id;assert.equal(active.archiveName,'Набір UI автозбереження');assert.equal(active.phase,0);assert.ok(active.archive?.sha256);assert.ok(context.findUserById_(cadet.user.id));assert.ok(context.listResults_(null).length>0);
 });
 await check('A download failure pauses before erasure and Resume downloads the verified archive first',async()=>{
  const waiting=page.waitForEvent('download');await click('resume-intake');automatic=await downloaded(await waiting,'excel-ui-intake.xlsx');await page.locator('.intake-status').waitFor({state:'hidden'});assert.equal(context.listResults_(null).length,0);assert.equal(context.findUserById_(cadet.user.id),null);
  const recorded=calls.find(p=>p.path==='/api/instructor/intake/start');assert.equal(recorded.body.archiveName,'Набір UI автозбереження');assert.equal(recorded.body.timezoneOffsetMinutes,-180);
 });
 await check('Settings lists the saved intake and downloads the original identical Excel again',async()=>{
  await nav('more');await click('intake-archives');await page.getByText('Набір UI автозбереження',{exact:true}).waitFor();const waiting=page.waitForEvent('download');await click('download-intake-archive');const again=await downloaded(await waiting,'excel-ui-intake-again.xlsx');assert.equal(crypto.createHash('sha256').update(again).digest('hex'),crypto.createHash('sha256').update(automatic).digest('hex'));assert.equal(calls.filter(p=>p.path==='/api/instructor/intake/archive'&&p.body.jobId===jobId).length>=3,true);await page.screenshot({path:path.join(root,'verification/excel-archives-ui.png'),fullPage:true});await page.locator('#dialog-form button.primary').click();
 });
 await check('Excel controls fit a narrow window and dark theme without page errors',async()=>{
  await click('theme');await page.setViewportSize({width:900,height:800});await nav('results');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 });
 fs.writeFileSync(path.join(root,'verification/excel-report-ui.json'),JSON.stringify({status:'passed',passed:checks.length,checks,actualChromiumRendered:true,actualAppAndServer:true,productionRequests:0,pageErrors:errors},null,2));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
