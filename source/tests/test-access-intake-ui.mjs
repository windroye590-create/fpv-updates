// Four isolated PC profiles; synthetic accounts and the real application/server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as C from '../web/core.js';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const first={token:instructorToken,user:api('GET','/api/workspace',instructorToken).user};
const second=api('POST','/api/instructor/register','',{fullName:'Інструктор нового набору',username:'intake-ui-resumer',inviteCode:api('POST','/api/instructor/invite',instructorToken).code,...credential('test-intake-ui')});
const ga=api('POST','/api/instructor/groups',instructorToken,{name:'Набір UI А'}).group,gb=api('POST','/api/instructor/groups',instructorToken,{name:'Набір UI Б'}).group;
const createCadet=(name,username,g=ga)=>api('POST','/api/register','',{fullName:name,username,groupId:g.id,...credential('test-intake-ui')});
const ca=createCadet('Курсант UI А','intake-ui-a'),cb=createCadet('Курсант UI Б','intake-ui-b',gb);
const draft=C.newDraft();Object.assign(draft,{title:'Каталог нового набору UI',randomizeQuestions:false,randomizeAnswers:false});
Object.assign(draft.questions[0],{text:'Питання керованого доступу?',answers:[{text:'Правильна відповідь',isCorrect:true},{text:'Інша відповідь',isCorrect:false}]});
const test=api('POST','/api/instructor/tests',instructorToken,C.draftAPI(draft,true)).test;
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
const root=new URL('../web/',import.meta.url).pathname,checks=[],errors=[],states=new Map(),journals=new Map(),offline=new Set(),calls=[];
let dropCleanupReply=false;const cleanupReplies=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.mjs':'text/javascript','.wasm':'application/wasm'};
function seed(key,actor){states.set(key,{version:1,theme:'light',session:{token:actor.token,user:actor.user},groups:[ga,gb],accounts:{[actor.user.id]:{tests:[],results:[],cadets:[],fullTests:{},pending:[],reviews:{}}}});journals.set(key,{});}
seed('instructor',first);seed('resumer',second);seed('cadet-a',ca);seed('cadet-b',cb);
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local'),key=req.headers['x-lk-key'];res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/clock'){res.end(JSON.stringify({ok:true,uptime:100000+performance.now(),launchId:'intake-ui'}));return;}
 if(url.pathname.startsWith('/updates/')){res.end(JSON.stringify({ok:true,state:2,currentVersion:version.version,currentCode:version.versionCode,message:'Установлено актуальну версію.'}));return;}
 if(url.pathname==='/state'||url.pathname==='/journal'){
  const target=url.pathname==='/state'?states:journals;
  if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);target.set(key,JSON.parse(Buffer.concat(chunks).toString()));res.end('{"ok":true}');}else res.end(JSON.stringify(target.get(key)||{}));return;
 }
 if(url.pathname==='/rpc'){
  const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString(),p=JSON.parse(raw);calls.push({key,...p});
  if(offline.has(key)){res.end(JSON.stringify({ok:false,code:'NETWORK',error:'Тестова втрата зв’язку'}));return;}
  const reply=context.doPost({postData:{contents:raw}}).text;
  if(p.path.includes('/intake'))cleanupReplies.push({path:p.path,...JSON.parse(reply)});
  if(dropCleanupReply&&p.path==='/api/instructor/intake/continue'){dropCleanupReply=false;res.end(JSON.stringify({ok:false,code:'NETWORK',error:'Тестова втрата підтвердження очищення'}));return;}
  res.setHeader('Content-Type','application/json');res.end(reply);return;
 }
 const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)),file=path.resolve(root,name);
 if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){res.writeHead(500);res.end(String(error));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
const origin='http://127.0.0.1:'+server.address().port;
async function pc(key){const c=await browser.newContext({viewport:{width:1360,height:900}});const page=await c.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?key='+key);await page.locator('.layout').waitFor();await page.locator('.topbar').filter({hasText:'Оновлено'}).waitFor();return {context:c,page,key};}
const instructor=await pc('instructor'),resumer=await pc('resumer'),one=await pc('cadet-a'),two=await pc('cadet-b');
const action=(page,name)=>page.locator(`[data-action="${name}"]`),card=page=>page.locator('.test-card').filter({hasText:test.title});
const nav=(page,name)=>page.locator(`.nav [data-page="${name}"]`).click();
async function refresh(page){const response=page.waitForResponse(r=>r.url().endsWith('/rpc')&&r.request().postDataJSON()?.path==='/api/workspace');await action(page,'refresh').click();await (await response).finished();await page.locator('[data-action=refresh]:not([disabled])').waitFor();}
async function access(open,groupId='all'){
 await nav(instructor.page,'tests');await card(instructor.page).locator('[data-action=test-access]').click();await instructor.page.locator('[name=accessScope]').selectOption(String(groupId));await instructor.page.locator('[name=accessState]').selectOption(open?'open':'closed');await instructor.page.locator('#modal button.primary').click();await instructor.page.locator('#modal').waitFor({state:'hidden'});
}
async function newIntakeDialog(){await action(instructor.page,'new-intake').click();await instructor.page.locator('#modal').waitFor({state:'visible'});}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
 await check('Closed catalog cards are readable but cannot be started or downloaded on either PC',async()=>{
  for(const pc of [one,two]){await nav(pc.page,'tests');await card(pc.page).getByText('Очікує відкриття інструктором',{exact:true}).waitFor();assert.equal(await card(pc.page).locator('[data-action=start]').isDisabled(),true);assert.equal(await card(pc.page).locator('[data-action=download]').count(),0);}
  await one.page.screenshot({path:new URL('../verification/intake-catalog-closed.png',import.meta.url).pathname,fullPage:true});
 });
 await check('Instructor opening one group enables only that group’s new attempts',async()=>{
  await access(true,ga.id);await refresh(one.page);await refresh(two.page);assert.equal(await card(one.page).locator('[data-action=start]').isEnabled(),true);assert.equal(await card(two.page).locator('[data-action=start]').isDisabled(),true);
 });
 await check('A downloaded test cannot begin offline and a failed start leaves no local attempt',async()=>{
  await card(one.page).locator('[data-action=download]').click();await one.page.locator('#toast').filter({hasText:'збережено'}).waitFor();offline.add('cadet-a');
  await card(one.page).locator('[data-action=start]').click();await one.page.locator('#modal button.primary').click();await one.page.locator('#toast').filter({hasText:'Для початку тесту підключіться'}).waitFor();
  assert.ok(!states.get('cadet-a').accounts[ca.user.id].run);assert.equal(await one.page.locator('.runner').count(),0);await one.page.locator('#modal [data-action=cancel-modal]').click();offline.delete('cadet-a');
 });
 await check('A start confirmed online can finish offline after the instructor closes the gate',async()=>{
  await card(one.page).locator('[data-action=start]').click();await one.page.locator('#modal button.primary').click();await one.page.locator('.runner').waitFor();assert.ok(states.get('cadet-a').accounts[ca.user.id].run.startPermit);
  await access(false);offline.add('cadet-a');await one.page.getByText('Правильна відповідь',{exact:true}).click();await action(one.page,'finish').click();await one.page.locator('#modal button.primary').click();await one.page.getByText(/^Результат у черзі\./).waitFor();
  const a=states.get('cadet-a').accounts[ca.user.id];assert.equal(a.pending.length,1);assert.ok(a.pending[0].body.startPermit);assert.ok(!a.run);
  offline.delete('cadet-a');await one.page.getByRole('button',{name:'До результатів',exact:true}).click();await action(one.page,'sync').first().click();await one.page.locator('#toast').filter({hasText:'Чергу надіслано'}).waitFor();assert.equal(states.get('cadet-a').accounts[ca.user.id].pending.length,0);assert.equal(api('GET','/api/my-results',ca.token).results.find(r=>r.testId===test.id).score,100);
 });
 await check('Cleanup is clearly scoped to all groups and cancelling it changes nothing',async()=>{
  await nav(instructor.page,'cadets');const count=context.listUsers_().filter(u=>u.role==='cadet').length;
  await newIntakeDialog();await instructor.page.locator('#modal').getByText('Усі навчальні групи',{exact:true}).waitFor();await instructor.page.locator('#modal').getByText(String(count),{exact:true}).waitFor();
  await instructor.page.screenshot({path:new URL('../verification/intake-confirmation.png',import.meta.url).pathname});await instructor.page.locator('#modal [data-action=cancel-modal]').click();assert.equal(context.listUsers_().filter(u=>u.role==='cadet').length,count);
 });
 await check('The optional export downloads all current results before cleanup',async()=>{
  await newIntakeDialog();const waiting=instructor.page.waitForEvent('download');await action(instructor.page,'intake-export').click();const file=await waiting;assert.match(file.suggestedFilename(),/\.xlsx$/);const bytes=fs.readFileSync(await file.path());assert.equal(bytes.subarray(0,2).toString(),'PK');assert.ok(bytes.toString('utf8').includes('Курсант UI А'));await instructor.page.locator('#modal [data-action=cancel-modal]').click();
 });
 await check('Cleanup requires the checkbox and exact phrase; a changed roster invalidates the preview',async()=>{
  await newIntakeDialog();const before=calls.filter(p=>p.path==='/api/instructor/intake/start').length;
  await instructor.page.locator('[name=intakeConfirmation]').fill('так');await instructor.page.locator('#modal button.primary').click();assert.equal(calls.filter(p=>p.path==='/api/instructor/intake/start').length,before);
  await instructor.page.locator('[name=intakeReviewed]').check();await instructor.page.locator('#modal button.primary').click();await instructor.page.locator('#toast').filter({hasText:'введіть «НОВИЙ НАБІР»'}).waitFor();assert.equal(calls.filter(p=>p.path==='/api/instructor/intake/start').length,before);
  createCadet('Після попереднього перегляду','intake-ui-late');await instructor.page.locator('[name=intakeConfirmation]').fill('НОВИЙ НАБІР');await instructor.page.locator('#modal button.primary').click();await instructor.page.locator('#toast').filter({hasText:'змінилися'}).waitFor();assert.equal(context.PropertiesService.getScriptProperties().getProperty('LK_INTAKE_ACTIVE'),null);await instructor.page.locator('#modal [data-action=cancel-modal]').click();
 });
 await check('A lost cleanup reply retains a resumable operation across PC restart',async()=>{
  await newIntakeDialog();await instructor.page.locator('[name=intakeReviewed]').check();await instructor.page.locator('[name=intakeConfirmation]').fill('НОВИЙ НАБІР');dropCleanupReply=true;await instructor.page.locator('#modal button.primary').click();await instructor.page.locator('#toast').filter({hasText:'можна продовжити'}).waitFor();
  await instructor.page.locator('[data-action=resume-intake]:not([disabled])').waitFor();const before=states.get('instructor').accounts[first.user.id].intake;assert.equal(before.phase,0);assert.ok(before.archive?.sha256);await instructor.page.reload();await instructor.page.locator('[data-action=resume-intake]:not([disabled])').waitFor();assert.equal(states.get('instructor').accounts[first.user.id].intake.id,before.id);
 });
 await check('Another instructor can finish cleanup without deleting instructors, groups or the test catalog',async()=>{
  await refresh(resumer.page);await action(resumer.page,'resume-intake').click();await resumer.page.locator('#toast').filter({hasText:'Новий набір підготовлено'}).waitFor({timeout:30000});
  assert.equal(context.listUsers_().filter(u=>u.role==='cadet').length,0);assert.ok(context.findUserById_(first.user.id));assert.ok(context.findUserById_(second.user.id));assert.ok(context.findGroupById_(ga.id));assert.ok(context.getTestById_(test.id));
  await refresh(instructor.page);await nav(instructor.page,'tests');await card(instructor.page).getByText('Закритий',{exact:true}).waitFor();assert.equal(api('GET','/api/instructor/results',instructorToken).results.length,0);
 });
 await check('A newly registered cadet has a fresh ID and sees the retained tests closed',async()=>{
  const fresh=createCadet('Новий курсант UI','intake-ui-a');assert.notEqual(String(fresh.user.id),String(ca.user.id));seed('cadet-fresh',fresh);const next=await pc('cadet-fresh');await nav(next.page,'tests');await card(next.page).getByText('Очікує відкриття інструктором',{exact:true}).waitFor();assert.equal(await card(next.page).locator('[data-action=start]').isDisabled(),true);await next.context.close();
 });
 await check('Access controls remain usable in the dark theme and narrow PC windows',async()=>{
  await action(instructor.page,'theme').first().click();await instructor.page.setViewportSize({width:620,height:900});await card(instructor.page).locator('[data-action=test-access]').click();assert.ok(await instructor.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await instructor.page.locator('[name=accessScope]').selectOption(String(ga.id));await instructor.page.screenshot({path:new URL('../verification/intake-access-dark.png',import.meta.url).pathname});await instructor.page.locator('#modal [data-action=cancel-modal]').click();
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(new URL('../verification/test-access-intake-ui.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,errors,liveAccountsModified:false},null,2));console.log(JSON.stringify({status:'passed',passed:checks.length}));
}catch(error){console.error('Cleanup state at failure:',JSON.stringify(context.intakeStatus_()));console.error('Cleanup replies:',JSON.stringify(cleanupReplies.map(({previewToken,...r})=>r)));fs.writeFileSync(new URL('../verification/intake-ui-failure.html',import.meta.url),await instructor.page.content());fs.writeFileSync(new URL('../verification/intake-ui-failure-state.json',import.meta.url),JSON.stringify({state:states.get('instructor'),calls:calls.slice(-25),errors},null,2));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
