// Browser integration against this application's own local native-host double.
// It changes the served version only after simulated replacement; no live data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import * as C from '../web/core.js';
const release=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));const installed=release.versionCode,next=installed+1,currentName=release.version,nextName=currentName.split('.').map((n,i)=>i===2?Number(n)+1:n).join('.');
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,instructorToken}=await import('./fixtures/server_model.mjs');
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Оновлення — тестова група'}).group;
const cadet=api('POST','/api/register','',{fullName:'Курсант перевірки оновлення',username:'restart_ui',groupId:group.id,...await C.credential('test-update-password')});
const draft=C.newDraft();draft.title='Збереження перед оновленням';draft.questions[0].text='Відповідь?';draft.questions[0].answers[0].text='Так';draft.questions[0].answers[1].text='Ні';
const test=api('POST','/api/instructor/tests',instructorToken,{...C.draftAPI(draft),accessProtocol:0}).test;
let state={},journal={},events=[],currentCode=installed,stage=2,diskFailure=false,journalFailure=false,helperFailure=false,offline=false,restarting=false,applyCount=0,versionReloads=0;
const failures=[],checks=[],web=new URL('../web/',import.meta.url).pathname;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://local').pathname;
  res.setHeader('Cache-Control','no-store');
  if(restarting){req.socket.destroy();return;}
  if(route.startsWith('/updates/')){
   if(route==='/updates/check'){stage=1;setTimeout(()=>stage=3,120);}
   if(route==='/updates/apply'){
    applyCount++;events.push('apply');assert.ok(events.includes('state-saved'));assert.equal(state.updateTargetCode,next);
    if(helperFailure){res.end(JSON.stringify({ok:false,error:'Не вдалося підготувати встановлення'}));return;}
    res.end('{"ok":true,"restarting":true}');restarting=true;
    setTimeout(()=>{restarting=false;currentCode=next;stage=2;},1100);return;
   }
   res.end(JSON.stringify({ok:true,state:stage,code:stage===3?next:0,currentCode,currentVersion:currentCode===installed?currentName:nextName,version:stage===3?nextName:'',message:stage===1?'Перевіряємо й завантажуємо оновлення…':stage===3?'Оновлення готове.':'Установлено актуальну версію.'}));return;
  }
  if(route==='/clock'){res.end(JSON.stringify({ok:true,uptime:100000+performance.now(),launchId:'preserved-native-key'}));return;}
  if(route==='/state'||route==='/journal'){
   if(req.method==='POST'){
    let raw='';for await(const part of req)raw+=part;const value=JSON.parse(raw);
    if((route==='/state'&&diskFailure)||(route==='/journal'&&journalFailure)){res.end('{"ok":false,"error":"Не вдалося зберегти дані на диску."}');return;}
    if(route==='/state'){state=value;events.push('state-saved');}else if((value.serial||0)>(journal.serial||0)){journal=value;events.push('journal-saved');}
    res.end('{"ok":true}');return;
   }
   res.end(JSON.stringify(route==='/state'?state:journal));return;
  }
  if(route==='/rpc'){
   let raw='';for await(const part of req)raw+=part;
   if(offline){res.end('{"ok":false,"code":"NETWORK","error":"Тестова мережа недоступна"}');return;}
   res.end(context.doPost({postData:{contents:raw}}).text);return;
  }
  const file=path.resolve(web,route==='/'?'index.html':route.slice(1));if(!file.startsWith(web)){res.writeHead(404);res.end();return;}
  let bytes=fs.readFileSync(file);if(route==='/core.js'&&currentCode===next){bytes=Buffer.from(bytes.toString().replace("APP_VERSION='"+currentName+"'","APP_VERSION='"+nextName+"'"));versionReloads++;}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(bytes);
 }catch(x){failures.push(String(x));res.writeHead(500);res.end('Local test failure');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
const ctx=await browser.newContext({viewport:{width:1360,height:1000},locale:'uk-UA'});const page=await ctx.newPage();page.on('pageerror',e=>failures.push(e.message));
async function mark(name,f){await f();checks.push(name);console.log('PASS '+checks.length+': '+name);}
async function reset(){if(page.url().startsWith(origin))await page.evaluate(()=>localStorage.setItem('lk-pc-window','test-reset'));state={version:1,theme:'dark',groups:[group],session:{token:instructorToken,user:{id:'1',username:'WindRoy',fullName:'Інструктор перевірки',role:'instructor'}},accounts:{}};journal={};events=[];currentCode=installed;stage=2;diskFailure=false;journalFailure=false;helperFailure=false;offline=false;applyCount=0;versionReloads=0;}
async function open(){await page.goto(origin+'/?key=preserved-native-key');await page.locator('.nav button[data-page=more]').click();await page.getByRole('heading',{name:'Про застосунок'}).waitFor();await page.waitForTimeout(200);}
const check=()=>page.locator('button[data-action=check-update]').click();
try{
 await reset();await open();
 await mark('About and sidebar show the same installed version',async()=>{assert.match(await page.locator('.sidebar-footer').textContent(),new RegExp(currentName.replaceAll('.','\\.')));assert.match(await page.locator('.settings-grid').textContent(),new RegExp('версія '+currentName.replaceAll('.','\\.')));});
 await mark('One click installs, survives backend downtime and reloads the same window',async()=>{
  await check();await page.locator('.boot').filter({hasText:'Оновлення застосунку'}).waitFor();await page.getByRole('heading',{name:'Про застосунок'}).waitFor({timeout:20000});await page.getByText('Windows · версія '+nextName,{exact:false}).waitFor();assert.equal(applyCount,1);assert.equal(versionReloads,1);assert.equal(ctx.pages().length,1);assert.equal(page.url(),origin+'/?key=preserved-native-key');assert.ok(events.indexOf('state-saved')<events.indexOf('apply'));
 });
 await mark('Session, theme, draft and queued results survive automatic reload',async()=>{
  await reset();const a=state.accounts['1']={tests:[],results:[],cadets:[],fullTests:{},pending:[{body:{testId:'queued',submissionId:'unchanged'},testTitle:'Черга',permanent:true}],reviews:{},draft:{...C.newDraft(),title:'Моя незавершена чернетка'},run:null};await open();await page.evaluate(async()=>{const d=await new Promise((resolve,reject)=>{const q=indexedDB.open('restart-proof',1);q.onupgradeneeded=()=>q.result.createObjectStore('pdf');q.onsuccess=()=>resolve(q.result);q.onerror=reject;});await new Promise((resolve,reject)=>{const t=d.transaction('pdf','readwrite');t.objectStore('pdf').put('збережений PDF','offline');t.oncomplete=resolve;t.onerror=reject;});d.close();});
  await check();await page.getByText('Windows · версія '+nextName,{exact:false}).waitFor({timeout:20000});assert.equal(state.session.token,instructorToken);assert.equal(state.theme,'dark');assert.equal(state.accounts['1'].draft.title,a.draft.title);assert.equal(state.accounts['1'].pending[0].body.submissionId,'unchanged');assert.equal(await page.evaluate(async()=>{const d=await new Promise(r=>{const q=indexedDB.open('restart-proof');q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=d.transaction('pdf').objectStore('pdf').get('offline');q.onsuccess=()=>r(q.result);});}),'збережений PDF');
 });
 await mark('A failed full-state save prevents replacement and leaves the UI usable',async()=>{await reset();await open();diskFailure=true;await check();await page.locator('#update-message').filter({hasText:'Не вдалося зберегти'}).waitFor({timeout:10000});assert.equal(applyCount,0);assert.equal(currentCode,installed);await page.locator('.nav button[data-page=home]').click();await page.getByRole('heading',{name:'Кабінет інструктора'}).waitFor();});
 await mark('An unacknowledged native helper does not close or reload the app',async()=>{await reset();await open();helperFailure=true;await check();await page.locator('#update-message').filter({hasText:'Не вдалося підготувати'}).waitFor({timeout:10000});assert.equal(currentCode,installed);assert.equal(versionReloads,0);assert.equal(await page.locator('button[data-action=check-update]').isEnabled(),true);});
 await mark('An active test is preserved and installation waits until its result is saved',async()=>{
  await reset();state.session={token:cadet.token,user:cadet.user};state.accounts[String(cadet.user.id)]={tests:[test],results:[],cadets:[],fullTests:{[test.id]:test},pending:[],reviews:{},draft:null,run:{test,answers:{[test.questions[0].id]:test.questions[0].answers[0].id},submissionId:crypto.randomUUID(),index:0,startedUptime:90000,launchId:'preserved-native-key',lastElapsed:10,exitCount:0}};await open();await check();await page.locator('#update-message').filter({hasText:'після завершення поточного тесту'}).waitFor({timeout:10000});assert.equal(applyCount,0);assert.ok(state.accounts[String(cadet.user.id)].run);offline=true;await page.evaluate(async()=>{await(await import('/app.js')).finishRun(false);});await page.getByText('Windows · версія '+nextName,{exact:false}).waitFor({timeout:20000});const a=state.accounts[String(cadet.user.id)];assert.equal(a.run,null);assert.equal(a.pending.length,1);assert.ok(a.pending[0].body.answers.length);assert.equal(applyCount,1);
 });
 assert.deepEqual(failures,[]);fs.writeFileSync(new URL('../verification/updates-ui.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,pageErrors:failures,testedAt:new Date().toISOString(),browser:await browser.version(),actualWindowsProcessRestartVerified:false},null,2));
}catch(x){console.error(x);console.error((await page.locator('body').textContent()).slice(-2500));console.error(failures);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.close(r));}
