import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken,regressionTest,regressionBody}=await import('./fixtures/server_model.mjs');
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Картки — браузер'}).group;
const make=username=>api('POST','/api/register','',{fullName:'Навчальний Курсант Картки',username,groupId:group.id,...credential('card-browser-password')});
const a=make('card-browser-a'),b=make('card-browser-b'),choice=regressionTest('Картка — завершена робота');
const result=api('POST','/api/results',a.token,regressionBody(choice,'card-browser-result')).result;
const written=api('POST','/api/instructor/tests',instructorToken,{title:'Картка — письмова робота',published:true,questions:[{type:'written',text:'Поясніть відповідь',maxPoints:3,answers:[]}]}).test;
const pending=api('POST','/api/results',a.token,{writtenProtocol:1,testId:written.id,submissionId:'card-browser-written',answers:[{questionId:written.questions[0].id,text:'Навчальна відповідь'}]}).result;
const user=api('GET','/api/workspace',instructorToken).user,root=new URL('../',import.meta.url).pathname,web=path.join(root,'web');
context.sheet_('materials').appendRow(['card-ui-pdf','Матеріал для картки','','Навчальна тема',JSON.stringify([String(group.id)]),'','file',1,100,'a'.repeat(64),10,'1',new Date(),new Date(),true]);
context.sheet_('materialProgress').appendRow(['card-ui-pdf',1,String(a.user.id),3,7,10,new Date(),new Date()]);
let state={version:1,theme:'light',session:{token:instructorToken,user},groups:[],accounts:{}},journal={},dropNote=false,offline=false;
const errors=[],checks=[],calls=[];
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');
  if(['/state','/journal'].includes(route)){
   if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;if(route==='/state')state=JSON.parse(raw);else journal=JSON.parse(raw);res.end('{"ok":true}');}
   else res.end(JSON.stringify(route==='/state'?state:journal));return;
  }
  if(route==='/clock'){res.end(JSON.stringify({ok:true,uptime:1000000+performance.now(),launchId:'cadet-card-ui'}));return;}
  if(route.startsWith('/updates/')){res.end('{"ok":true,"state":2,"message":"Актуальна версія"}');return;}
  if(route==='/rpc'){
   let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);calls.push(p);
   if(offline&&p.path.startsWith('/api/instructor/cadets/')){res.end('{"ok":false,"code":"NETWORK","error":"Немає зв’язку для перевірки картки"}');return;}
   const reply=context.doPost({postData:{contents:raw}}).text;
   if(dropNote&&p.path.endsWith('/notes')){dropNote=false;res.end('{"ok":false,"code":"NETWORK","error":"Втрачено відповідь після збереження примітки"}');return;}
   res.setHeader('Content-Type','application/json');res.end(reply);return;
  }
  const file=path.resolve(web,route==='/'?'index.html':route.slice(1));if(!file.startsWith(web+path.sep)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(x){errors.push(String(x));res.writeHead(500);res.end('Local fixture error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;
const click=act=>page.locator(`[data-action="${act==='card-refresh'?'refresh':act}"]`).first().click();
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function card(cadet){await page.evaluate(async()=>{await(await import('/app.js')).navigate('cadets');});await page.locator('#filter').fill(cadet.user.username);await page.locator(`[data-action="cadet-card"][data-id="${cadet.user.id}"]`).click();await page.locator('.cadet-identity').waitFor();await page.locator('.topbar [data-action="refresh"]:not([disabled])').waitFor();}
async function tab(name){await page.locator(`[data-action="card-tab"][data-tab="${name}"]`).click();await page.locator(`[data-action="card-tab"][data-tab="${name}"][aria-pressed="true"]`).waitFor();}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.LITAKOVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1440,height:1000},locale:'uk-UA'});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?key=cadet-card-ui`);await page.locator('.layout').waitFor();await page.locator('.topbar [data-action="refresh"]:not([disabled])').waitFor();
 await page.evaluate(async()=>{const m=await import('/app.js');await m.navigate('results');await m.clickAction(document.querySelector('[data-action="results-view"][data-view="ranking"]'));});
 await check('Clicking the cadet name opens full history and keeps Cadets active in navigation',async()=>{await card(a);assert.match(await page.locator('.cadet-identity').innerText(),/card-browser-a/);assert.equal(await page.locator('.nav [data-page="cadets"]').getAttribute('aria-current'),'page');assert.deepEqual(await page.locator('.cadet-stats .value').allTextContents(),['2','1','1','100%']);assert.equal(await page.locator('[data-action="card-result"]').count(),2);await page.screenshot({path:path.join(root,'verification/cadet-card-results.png'),fullPage:true});});
 await check('Viewing a work returns to its original cadet card',async()=>{await page.locator(`[data-action="card-result"][data-id="${result.id}"]`).click();await page.getByRole('heading',{name:'Перегляд роботи',exact:true}).waitFor();await page.locator('.page-head [data-page="cadet-card"]').click();await page.locator('.cadet-identity').waitFor();assert.match(await page.locator('.cadet-identity').innerText(),/card-browser-a/);});
 await check('Grading a written work refreshes the card and returns without changing the selected cadet',async()=>{await page.locator(`[data-action="card-result"][data-id="${pending.id}"]`).click();await page.getByRole('heading',{name:'Перевірка письмової роботи',exact:true}).waitFor();await page.locator('[data-grade-prop="points"]').fill('3');await click('save-grades');await page.locator('.cadet-identity').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.cadet-stats .value')[2]?.textContent==='0');assert.equal(context.findResultById_(pending.id).score,100);assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().resultsView),'ranking');});
 await check('Materials show the current cadet progress rather than another reader',async()=>{await tab('materials');assert.match(await page.locator('.cadet-card-content').innerText(),/3 \/ 10/);assert.match(await page.locator('.cadet-card-content').innerText(),/сторінки 7/);await page.screenshot({path:path.join(root,'verification/cadet-card-materials.png'),fullPage:true});});
 await check('A lost note acknowledgement preserves the draft and retries without a duplicate',async()=>{await tab('notes');await page.locator('#cadet-note').fill('Перевірити тему <img src=x onerror=alert(1)>');dropNote=true;await click('card-note-save');await page.locator('#toast').filter({hasText:'Втрачено відповідь'}).waitFor();assert.match(await page.locator('#cadet-note').inputValue(),/Перевірити тему/);await click('card-note-save');await page.waitForFunction(()=>document.querySelectorAll('.cadet-note-list article').length===1&&document.querySelector('#cadet-note')?.value==='');assert.equal(context.dataRows_('cadetNotes').filter(r=>String(r[0])===String(a.user.id)).length,1);assert.equal(await page.locator('.cadet-note-list img').count(),0);});
 await check('A second instructor note is shared with its author and timestamp',async()=>{const inviteCode=api('POST','/api/instructor/invite',instructorToken).code,teacher=api('POST','/api/instructor/register','',{fullName:'Другий Інструктор Картки',username:'card-browser-teacher',inviteCode,...credential('card-browser-password')});api('POST','/api/instructor/cadets/'+a.user.id+'/notes',teacher.token,{text:'Спільна примітка з іншого ПК',requestId:'card-second-teacher'});await click('card-refresh');await page.getByText('Спільна примітка з іншого ПК',{exact:true}).waitFor();assert.match(await page.locator('.cadet-note-list').innerText(),/Другий Інструктор Картки/);await page.screenshot({path:path.join(root,'verification/cadet-card-notes.png'),fullPage:true});});
 await check('A namesake cadet gets a separate card and does not inherit notes, results or note drafts',async()=>{await page.locator('#cadet-note').fill('Незавершена примітка першого');await card(b);assert.match(await page.locator('.cadet-identity').innerText(),/card-browser-b/);assert.equal(await page.locator('[data-action="card-result"]').count(),0);await tab('notes');assert.equal(await page.locator('#cadet-note').inputValue(),'');assert.equal(await page.locator('.cadet-note-list article').count(),0);await card(a);await tab('notes');assert.equal(await page.locator('#cadet-note').inputValue(),'Незавершена примітка першого');});
 await check('Restart preserves a private note draft and return to the filtered cadet list',async()=>{await page.reload();await page.locator('.layout').waitFor();await page.locator('.topbar [data-action="refresh"]:not([disabled])').waitFor();await card(a);await tab('notes');assert.equal(await page.locator('#cadet-note').inputValue(),'Незавершена примітка першого');await page.locator('.page-head [data-page="cadets"]').click();assert.equal(await page.locator('#filter').inputValue(),a.user.username);});
 await check('Offline refresh labels the saved card while retaining its history',async()=>{await card(a);await tab('results');offline=true;await click('card-refresh');await page.getByRole('alert').filter({hasText:'Показано останню збережену картку'}).waitFor();assert.equal(await page.locator('[data-action="card-result"]').count(),2);offline=false;await click('card-refresh');await page.locator('.topbar [data-action="refresh"]:not([disabled])').waitFor();});
 await check('All card sections fit narrow windows in light and dark themes',async()=>{for(const theme of ['light','dark']){if(theme==='dark')await click('theme');for(const name of ['results','materials','notes']){await tab(name);for(const width of [1440,900,480,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' '+width+' '+theme);}}}await page.screenshot({path:path.join(root,'verification/cadet-card-narrow.png'),fullPage:true});});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'verification/cadet-card-ui.json'),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0},null,2));console.log('Cadet card UI: '+checks.length+' checks passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
