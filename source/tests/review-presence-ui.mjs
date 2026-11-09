// Two isolated PC profiles, real application and real Code.gs, synthetic data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,credential}=await import('./fixtures/server_model.mjs');
let serverNow=Date.now();const RealDate=Date;
context.Date=class extends RealDate{constructor(...v){super(...(v.length?v:[serverNow]));}static now(){return serverNow;}};
const first={token:instructorToken,user:api('GET','/api/workspace',instructorToken).user};
const invite=api('POST','/api/instructor/invite',first.token).code;
const second=api('POST','/api/instructor/register','',{fullName:'Марченко Олена · Інструктор',username:'presence_ui_second',inviteCode:invite,...credential('presence-ui-second-password')});
const group=api('POST','/api/instructor/groups',first.token,{name:'Спільна перевірка'}).group;
const cadet=api('POST','/api/register','',{fullName:'Коваленко Андрій Олександрович',username:'presence_ui_cadet',groupId:group.id,...credential('presence-ui-cadet-password')});
const questions=[{type:'written',text:'Поясніть порядок підготовки.',maxPoints:3,answers:[]},{type:'written',text:'Поясніть порядок завершення.',maxPoints:4,answers:[]}];
function work(title){const test=api('POST','/api/instructor/tests',first.token,{title,questions}).test;const result=api('POST','/api/results',cadet.token,{testId:test.id,writtenProtocol:1,choiceProtocol:2,submissionId:'presence-ui-'+test.id,answers:test.questions.map(q=>({questionId:q.id,text:'Письмова відповідь курсанта для спільної перевірки.'}))}).result;return {test,result};}
const a=work('Підготовка до польоту'),b=work('Дії після польоту');
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
const root=new URL('../web/',import.meta.url).pathname,checks=[],errors=[],states=new Map(),journals=new Map(),offline=new Set();
let held=null;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.mjs':'text/javascript','.wasm':'application/wasm'};
function seed(key,actor){states.set(key,{version:1,theme:'light',session:actor,groups:[group],accounts:{[actor.user.id]:{tests:[],results:[],cadets:[],fullTests:{},pending:[],reviews:{}}}});journals.set(key,{});}
seed('pc-one',first);seed('pc-two',second);
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local'),key=req.headers['x-lk-key'];res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/clock'){res.end(JSON.stringify({ok:true,uptime:100000+performance.now(),launchId:'presence-ui'}));return;}
 if(url.pathname.startsWith('/updates/')){res.end(JSON.stringify({ok:true,state:2,currentVersion:version.version,currentCode:version.versionCode,message:'Установлено актуальну версію.'}));return;}
 if(url.pathname==='/state'||url.pathname==='/journal'){
  const target=url.pathname==='/state'?states:journals;
  if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);target.set(key,JSON.parse(Buffer.concat(chunks).toString()));res.end('{"ok":true}');}else res.end(JSON.stringify(target.get(key)||{}));return;
 }
 if(url.pathname==='/rpc'){
  const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString(),p=JSON.parse(raw);
  if(offline.has(key)){res.end(JSON.stringify({ok:false,code:'NETWORK',error:'Тестовий обрив зв’язку'}));return;}
  const reply=context.doPost({postData:{contents:raw}}).text;
  if(held&&key===held.key&&p.path.endsWith('/review-session')&&p.body.action==='open'){const wait=held;held=null;wait.enter();await wait.promise;}
  res.setHeader('Content-Type','application/json');res.end(reply);return;
 }
 const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)),file=path.resolve(root,name);
 if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){res.writeHead(500);res.end(String(error));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
const origin='http://127.0.0.1:'+server.address().port;
async function pc(key){const c=await browser.newContext({viewport:{width:1360,height:900}});await c.addInitScript(()=>{const interval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>interval(fn,ms===25000?150:ms,...args);});const page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?key='+key);await page.locator('.layout').waitFor();return {context:c,page,key};}
const one=await pc('pc-one'),two=await pc('pc-two');
const action=(p,name)=>p.locator(`[data-action="${name}"]`);
const row=(p,w)=>p.locator('.review-queue-item').filter({hasText:w.test.title});
const reviewButton=(p,w)=>p.locator(`[data-action="grade-result"][data-id="${w.result.id}"]`);
async function queue(p){await p.locator('.nav [data-page="results"]').click();await p.locator('[data-action="results-view"][data-view="pending"]').click();await p.getByRole('heading',{name:'Перевірка робіт',exact:true}).waitFor();await reviewButton(p,b).waitFor();}
async function open(p,w){await reviewButton(p,w).click();await p.locator('#review-presence-status').waitFor();}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
 // Each work contains two written answers; count works before opening the queue.
 await one.page.locator('#review-count').filter({hasText:'· 2'}).waitFor();
 await two.page.locator('#review-count').filter({hasText:'· 2'}).waitFor();
 await queue(one.page);await queue(two.page);
 await check('The owner gets an editable work and the other instructor sees their name',async()=>{
  await open(one.page,a);await one.page.getByText('Ви перевіряєте цю роботу',{exact:true}).waitFor();
  await row(two.page,a).getByText(first.user.fullName,{exact:true}).waitFor();assert.equal(await one.page.locator('[data-grade]').first().isEnabled(),true);
 });
 await check('Two tests of the same cadet are editable by two different instructors',async()=>{
  await open(two.page,b);await two.page.getByText('Ви перевіряєте цю роботу',{exact:true}).waitFor();assert.equal(await two.page.locator('[data-grade]').first().isEnabled(),true);assert.equal(await one.page.locator('[data-grade]').first().isEnabled(),true);
 });
 await check('Occupied work stays readable while grade inputs and save are disabled',async()=>{
  await queue(two.page);await open(two.page,a);await two.page.getByText('Роботу вже перевіряють',{exact:true}).waitFor();
  assert.equal(await two.page.locator('[data-grade]').first().isDisabled(),true);assert.equal(await action(two.page,'save-grades').isDisabled(),true);assert.ok(await two.page.getByText('Письмова відповідь курсанта для спільної перевірки.',{exact:true}).count());
 });
 await check('Heartbeat updates preserve the active comment field and its cursor',async()=>{
  const comment=one.page.locator('[data-grade-prop="comment"]').first();await comment.fill('Коментар першого інструктора');await comment.focus();
  await one.page.waitForFunction(()=>document.activeElement?.value==='Коментар першого інструктора');
  await two.page.getByText('Роботу вже перевіряють',{exact:true}).waitFor();
  assert.equal(await comment.inputValue(),'Коментар першого інструктора');assert.equal(await comment.evaluate(el=>el===document.activeElement),true);
 });
 await check('Partial save releases the work and preserves the next instructor’s access',async()=>{
  await one.page.locator('[data-grade-prop="points"]').first().fill('2');await action(one.page,'save-grades').click();await one.page.getByRole('heading',{name:'Перевірка робіт',exact:true}).waitFor();
  await action(two.page,'claim-review').waitFor();await action(two.page,'claim-review').click();await two.page.getByText('Ви перевіряєте цю роботу',{exact:true}).waitFor();assert.equal(await two.page.locator('[data-grade-prop="points"]').first().inputValue(),'2');
 });
 await check('The second instructor completes grading while preserving both authors',async()=>{
  await two.page.locator('[data-grade-prop="points"]').nth(1).fill('4');await two.page.locator('[data-grade-prop="comment"]').nth(1).fill('Коментар другого інструктора');await action(two.page,'save-grades').click();await two.page.getByRole('heading',{name:'Перевірка робіт',exact:true}).waitFor();
  const saved=api('GET','/api/results/'+a.result.id+'/review',first.token);assert.equal(saved.result.pendingWritten,0);await two.page.locator('#review-count').filter({hasText:'· 1'}).waitFor();assert.equal(saved.review[0].reviewerName,first.user.fullName);assert.equal(saved.review[1].reviewerName,second.user.fullName);assert.equal(await reviewButton(two.page,a).count(),0);
 });
 await check('A closed PC does not leave a permanent reservation',async()=>{
  await open(one.page,b);await one.page.getByText('Ви перевіряєте цю роботу',{exact:true}).waitFor();await one.context.close();
  await row(two.page,b).getByText(first.user.fullName,{exact:true}).waitFor();serverNow+=120001;await row(two.page,b).getByText('Вільна для перевірки',{exact:true}).waitFor();await open(two.page,b);await two.page.getByText('Ви перевіряєте цю роботу',{exact:true}).waitFor();
 });
 await check('Lost connectivity disables editing while keeping the local comment draft',async()=>{
  const comment=two.page.locator('[data-grade-prop="comment"]').first();await comment.fill('Не втратити цей коментар');offline.add('pc-two');await two.page.getByText('Перевірка призупинена',{exact:true}).waitFor();assert.equal(await comment.inputValue(),'Не втратити цей коментар');assert.equal(await action(two.page,'save-grades').isDisabled(),true);
 });
 await check('Reconnection cannot overwrite a work claimed by another instructor after expiry',async()=>{
  serverNow+=120001;const renewed=await pc('pc-one');one.context=renewed.context;one.page=renewed.page;await queue(one.page);await open(one.page,b);await one.page.getByText('Ви перевіряєте цю роботу',{exact:true}).waitFor();offline.delete('pc-two');await two.page.getByText('Роботу вже перевіряють',{exact:true}).waitFor();assert.equal(await two.page.locator('[data-grade-prop="comment"]').first().inputValue(),'Не втратити цей коментар');assert.equal(await action(two.page,'save-grades').isDisabled(),true);
 });
 await check('Read-only status fits dark and narrow windows',async()=>{
  await two.page.locator('[data-action="theme"]').first().click();await two.page.setViewportSize({width:620,height:900});assert.ok(await two.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await two.page.screenshot({path:new URL('../verification/review-presence-busy.png',import.meta.url).pathname,fullPage:true});
 });
 await queue(one.page);
 await check('Navigation during a slow claim cannot reopen an abandoned grading screen',async()=>{
  let enter,release;const entered=new Promise(r=>enter=r),promise=new Promise(r=>release=r);held={key:'pc-one',enter,promise};
  const response=one.page.waitForResponse(r=>r.url().endsWith('/rpc')&&r.request().postDataJSON()?.body?.action==='open');
  await reviewButton(one.page,b).click();await entered;await one.page.locator('.nav [data-page="home"]').click();release();await (await response).finished();await one.page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();assert.equal(await one.page.locator('#review-presence-status').count(),0);
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(new URL('../verification/review-presence-ui.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,errors,liveAccountsModified:false},null,2));console.log(JSON.stringify({status:'passed',passed:checks.length}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
