// Real desktop UI and Code.gs, with synthetic accounts and local transport only.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,credential,instructorToken}=await import('./fixtures/server_model.mjs');
const credentials=credential('synthetic-staff-password');
const titles=['Інструктор','Старший інструктор','Викладач','Старший викладач'];
for(let i=0;i<58;i++)context.createUser_({fullName:(i===0?'Викладач <img src=x onerror=alert(1)>':'Викладач '+String(i).padStart(2,'0'))+' · '+titles[i%4],username:'staff_'+String(i).padStart(2,'0'),role:'instructor',...credentials});
const inactive=context.listUsers_().find(u=>u.username==='staff_06');context.sheet_('users').getRange(inactive.rowNumber,8).setValue(false);
const actor=api('GET','/api/workspace',instructorToken,{}).user;
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Група перевірки доступу'}).group;
const cadet=api('POST','/api/register','',{fullName:'Модельний курсант',username:'staff_check_cadet',groupId:group.id,...credentials});
const currentList=()=>api('GET','/api/instructor/instructors',instructorToken).instructors;
assert.ok(currentList().length>50);
assert.throws(()=>api('GET','/api/instructor/instructors',cadet.token),error=>error.code==='FORBIDDEN');
let state={version:1,session:{token:instructorToken,user:actor},accounts:{},groups:[]},journal={},mode='',requestCount=0,releaseHeld=null;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(url.pathname==='/state'||url.pathname==='/journal'){
   if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const value=JSON.parse(Buffer.concat(chunks));if(url.pathname==='/state')state=value;else journal=value;res.end('{"ok":true}');}
   else res.end(JSON.stringify(url.pathname==='/state'?state:journal));return;
  }
  if(url.pathname==='/clock'){res.end(JSON.stringify({ok:true,uptime:performance.now()+100000,launchId:'staff-ui'}));return;}
  if(url.pathname.startsWith('/updates/')){res.end('{"ok":true,"state":2,"message":"Актуальна версія"}');return;}
  if(url.pathname==='/rpc'){
   const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString(),request=JSON.parse(raw);
   if(request.path==='/api/instructor/instructors'){
    requestCount++;
    if(mode==='held')await new Promise(resolve=>{releaseHeld=resolve;});
    if(mode==='offline'){res.end('{"ok":false,"code":"NETWORK","error":"Перевірка обриву мережі"}');return;}
    if(mode==='bad'){res.end(JSON.stringify({ok:true,instructors:[{id:'foreign-cadet',role:'cadet',username:'bad',fullName:'Чужі дані',active:true}]}));return;}
    if(mode==='empty'){res.end('{"ok":true,"instructors":[]}');return;}
   }
   res.setHeader('Content-Type','application/json');res.end(context.doPost({postData:{contents:raw}}).text);return;
  }
  const name=url.pathname==='/'?'index.html':url.pathname.slice(1),file=new URL('../web/'+name,import.meta.url);
  if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const checks=[],errors=[];let browser,page;
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const panel=()=>page.locator('#instructors-panel');
async function loaded(){await page.locator('[data-action=refresh-instructors]:not([disabled])').waitFor();}
async function refresh(){await page.locator('[data-action=refresh-instructors]').click();await loaded();}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
 page=await browser.newPage({viewport:{width:1366,height:900},locale:'ru-RU'});page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('heading',{name:'Кабінет інструктора'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.topbar')?.textContent.includes('Оновлено'));
 await check('No staff request delays the main cabinet',async()=>assert.equal(requestCount,0));
 await page.locator('.nav [data-page=more]').click();await loaded();
 await check('More loads registered staff from the existing API',async()=>{assert.ok(requestCount>=1);assert.equal(await panel().locator('tbody tr').count(),50);assert.equal(state.accounts[actor.id].instructors.length,currentList().length);});
 await check('Names logins titles and primary developer are visible',async()=>{assert.ok(await panel().getByText('WindRoy',{exact:true}).count());assert.ok(await panel().getByText('Розробник',{exact:true}).count());for(const title of titles)assert.ok(await panel().getByText(title,{exact:true}).count());});
 await check('Inactive staff remains listed with its status',async()=>{assert.ok((await panel().locator('tr').filter({hasText:'staff_06'}).textContent()).includes('Вимкнено'));});
 await check('Names are escaped and no password data is cached',async()=>{assert.equal(await panel().locator('img').count(),0);assert.ok(await panel().getByText('Викладач <img src=x onerror=alert(1)>',{exact:true}).count());for(const u of state.accounts[actor.id].instructors){assert.equal(u.passwordHash,undefined);assert.equal(u.passwordSalt,undefined);}});
 await check('Search covers staff outside the first page',async()=>{await panel().locator('#filter').fill('staff_57');assert.equal(await panel().locator('tbody tr').count(),1);assert.ok((await panel().textContent()).includes('staff_57'));await panel().locator('#filter').fill('');});
 await check('Paging preserves the full staff list',async()=>{await panel().locator('[data-action=list-page][data-index="2"]').click();assert.equal(await panel().locator('tbody tr').count(),currentList().length-50);await panel().locator('[data-action=list-page][data-index="1"]').click();});
 await check('An instructor registered later appears on refresh',async()=>{context.createUser_({fullName:'Новий викладач · Викладач',username:'staff_new',role:'instructor',...credentials});await refresh();assert.equal(state.accounts[actor.id].instructors.length,currentList().length);await panel().locator('#filter').fill('staff_new');assert.equal(await panel().locator('tbody tr').count(),1);await panel().locator('#filter').fill('');});
 await check('Malformed staff data preserves the verified cache',async()=>{const before=JSON.stringify(state.accounts[actor.id].instructors);mode='bad';await refresh();assert.ok((await panel().textContent()).includes('некоректний список'));assert.equal(JSON.stringify(state.accounts[actor.id].instructors),before);mode='';});
 await check('Offline refresh keeps cached staff visible',async()=>{mode='offline';await refresh();assert.equal(await panel().locator('tbody tr').count(),50);assert.ok((await panel().textContent()).includes('останній збережений список'));});
 await check('Cached staff survives a native state reload',async()=>{await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора'}).waitFor();await page.locator('.nav [data-page=more]').click();await loaded();assert.equal(await panel().locator('tbody tr').count(),50);assert.ok((await panel().textContent()).includes('останній збережений список'));mode='';await refresh();});
 await check('A 320px window scrolls the staff table within its region',async()=>{await page.setViewportSize({width:320,height:480});const layout=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,table:document.querySelector('#instructors-panel .table-wrap').scrollWidth}));assert.ok(layout.body<=layout.width+1,JSON.stringify(layout));await page.setViewportSize({width:1366,height:900});});
 await check('A real empty response has an explicit empty state',async()=>{mode='empty';await refresh();assert.ok((await panel().textContent()).includes('Список порожній'));assert.ok(!(await panel().textContent()).includes('Завантажуємо'));mode='';await refresh();});
 await check('A response arriving after logout cannot replace account data',async()=>{const before=JSON.stringify(state.accounts[actor.id].instructors);mode='held';await page.locator('[data-action=refresh-instructors]').click();await page.waitForTimeout(50);assert.ok(releaseHeld);await page.locator('[data-action=logout]').first().click();await page.locator('#auth-form').waitFor();mode='';releaseHeld();await page.waitForTimeout(150);assert.equal(state.session,null);assert.equal(await panel().count(),0);assert.equal(JSON.stringify(state.accounts[actor.id].instructors),before);});
 await check('Cadets cannot see or request the instructor directory',async()=>{const before=requestCount;await page.locator('[data-role=cadet]').click();await page.locator('input[name=username]').fill('staff_check_cadet');await page.locator('input[name=password]').fill('synthetic-staff-password');await page.locator('select[name=group]').selectOption({label:group.name});await page.locator('#auth-form button.primary').click();await page.getByRole('heading',{name:/Вітаємо/}).waitFor();await page.waitForFunction(()=>document.querySelector('.topbar')?.textContent.includes('Оновлено'));await page.locator('.nav [data-page=more]').click();assert.equal(await panel().count(),0);assert.equal(requestCount,before);});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(new URL('../verification/instructors-ui.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,pageErrors:errors,serverSource:'API v10 / 3.2.1-opt1, isolated Code.gs',nativeWindowsVerified:false},null,2)+'\n');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
