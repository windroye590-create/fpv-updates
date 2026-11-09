// This suite tests only our own local application, with the real Code.gs logic
// in an isolated in-memory model. It never logs into or mutates the live service.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,instructorToken,seedLegacyRetry}=await import('./fixtures/server_model.mjs');
let state={},journal={},offline=false,dropAfterCommit=false,foreignDeleteAck=false,transferMode='',stateWritesFail=false,launchId='local-ui-test',uptimeOffset=100000,updateState=2;
const start=performance.now(),rpcCalls=[],failures=[],checks=[];
const group=api('POST','/api/instructor/groups',instructorToken,{name:'ПК — перевірка інтерфейсу'}).group;
const mime={'.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(url.pathname.startsWith('/updates/')){if(url.pathname==='/updates/check')updateState=2;res.end(JSON.stringify({ok:true,state:updateState,version:updateState===3?'1.0.13':'',message:updateState===3?'Оновлення завантажено й перевірено. Застосується під час наступного запуску програми.':'Установлено актуальну версію.'}));return;}
  if(url.pathname==='/clock'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,uptime:uptimeOffset+performance.now()-start,launchId}));return;}
  if(url.pathname==='/state'||url.pathname==='/journal'){
   if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const value=JSON.parse(Buffer.concat(chunks).toString());if(url.pathname==='/state'&&stateWritesFail){res.end('{"ok":false,"error":"Тестова помилка запису на диск"}');return;}if(url.pathname==='/journal'){if((value.serial||0)>(journal.serial||0))journal=value;}else state=value;res.end('{"ok":true}');}else res.end(JSON.stringify(url.pathname==='/journal'?journal:state));return;
  }
  if(url.pathname==='/rpc'){
   const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();const p=JSON.parse(raw);rpcCalls.push(p);
   if(offline){res.end(JSON.stringify({ok:false,code:'NETWORK',error:'Тестовий обрив мережі'}));return;}
   if(foreignDeleteAck&&p.method==='DELETE'&&p.path.startsWith('/api/instructor/users/')){res.end(JSON.stringify({ok:true,deleted:true,userId:'different-user'}));return;}
   if(p.path.endsWith('/group')&&transferMode==='foreign'){res.end(JSON.stringify({ok:true,transferred:true,user:{id:'different-user'}}));return;}
   if(p.path.endsWith('/group')&&transferMode==='unsupported'){res.end(JSON.stringify({ok:false,code:'NOT_FOUND',error:'Old server'}));return;}
   const reply=context.doPost({postData:{contents:raw}}).text;
   if(p.path.endsWith('/group')&&transferMode==='lost'){transferMode='';res.end(JSON.stringify({ok:false,code:'NETWORK',error:'Втрачено відповідь переведення'}));return;}
   if(dropAfterCommit&&p.path==='/api/results'){dropAfterCommit=false;res.end('{"ok":false,"code":"NETWORK","error":"Відповідь втрачена після запису"}');return;}
   res.setHeader('Content-Type','application/json');res.end(reply);return;
  }
  const name=url.pathname==='/'?'index.html':url.pathname.slice(1),file=new URL('../web/'+name,import.meta.url);
  if(!['excel-report.js','secure-storage.js','boot.js','public-table-sync.js','review-presence.js','results.js','exam-session.js','account-sync.js','learning.js','workspace.js','durability.js','updater.js','materials.js','cadet-card.js','office-import.js','test-import-sample.docx','test-import-sample.xlsx','index.html','app.js','core.js','statement.js','vendor/jspdf.umd.min.js','statement-font.ttf','style.css','icon.png'].includes(name)&&!name.startsWith('vendor/pdfjs/')){res.writeHead(404);res.end();return;}
  const ext=name.substring(name.lastIndexOf('.'));res.setHeader('Content-Type',mime[ext]);res.end(fs.readFileSync(file));
 }catch(x){res.writeHead(500);res.end(String(x));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser,page,currentCheck='Browser launch';
const reportURL=new URL('../verification/ui.json',import.meta.url);
fs.rmSync(reportURL,{force:true});
async function mark(label,run){currentCheck=label;await run();assert.doesNotMatch(await page.locator('#app').innerText(),/телефон\p{L}*|мобільн\p{L}*|\bandroid\b|\biphone\b|\bios\b|\bapk\b/iu,'Windows screens must describe the PC workflow');checks.push(label);console.log('PASS '+checks.length+': '+label);}
async function assertSidebarFits(){const boxes=await page.locator('.sidebar').evaluate(el=>{const edge=el.getBoundingClientRect().right;return [...el.querySelectorAll('.sidebar-footer .user,.sidebar-footer button')].map(child=>({element:child.className,right:child.getBoundingClientRect().right,edge}));});assert.ok(boxes.every(b=>b.right<=b.edge+1),JSON.stringify(boxes));}
async function click(action){await page.locator(`button[data-action="${action}"]`).first().click();}
async function login(role,username,password,groupName){await page.locator(`button[data-role="${role}"]`).click();if(await page.locator('input[name=fullName]').count())await click('auth-mode');await page.locator('input[name=username]').fill(username);await page.locator('input[name=password]').fill(password);if(role==='cadet')await page.locator('select[name=group]').selectOption({label:groupName});await page.locator('#auth-form button.primary').click();await page.getByRole('heading',{name:role==='instructor'?'Кабінет інструктора':/Вітаємо/}).waitFor();await page.waitForFunction(()=>document.querySelector('.topbar')?.textContent.includes('Оновлено'));}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.LITAKOVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1440,height:1000},locale:'ru-RU'});
 page.on('pageerror',x=>failures.push(x.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+'/?key=local');await page.getByRole('heading',{name:'Вхід до кабінету'}).waitFor();
 await mark('Instructor registration explains where to obtain the code',async()=>{await click('auth-mode');await page.getByText('Отримати можливо у інших інструкторів',{exact:true}).waitFor();await click('auth-mode');});
 await mark('Registration validation stays Ukrainian in a Russian-language browser',async()=>{
  await click('auth-mode');await page.locator('#auth-form button.primary').click();
  for(const name of ['fullName','username','password','inviteCode'])assert.equal(await page.locator(`input[name=${name}]`).evaluate(el=>el.validationMessage),'Заповніть це поле.');
  await page.locator('input[name=password]').fill('12');await page.locator('#auth-form button.primary').click();assert.equal(await page.locator('input[name=password]').evaluate(el=>el.validationMessage),'Введіть щонайменше 6 символів.');
  await page.locator('input[name=password]').fill('valid-password');assert.equal(await page.locator('input[name=password]').evaluate(el=>el.validationMessage),'');
  await page.locator('button[data-role=cadet]').click();await page.locator('#auth-form button.primary').click();assert.equal(await page.locator('select[name=group]').evaluate(el=>el.validationMessage),'Оберіть значення зі списку.');
  await page.locator('button[data-role=instructor]').click();await click('auth-mode');
 });
 await mark('Instructor signs in with existing account via real challenge proof',()=>login('instructor','WindRoy','instructor-password'));
 await mark('FPV branding uses the supplied icon and the Developer account label',async()=>{assert.equal(await page.title(),'FPV Комісія | ПК');assert.match(await page.locator('.sidebar .brand').innerText(),/FPV/);assert.equal(await page.locator('.sidebar-footer .user strong').innerText(),'Розробник');assert.equal(await page.locator('.sidebar-footer .user small').count(),0);await page.screenshot({path:new URL('../verification/fpv-home.png',import.meta.url).pathname,fullPage:true});});
 await mark('Update status stays in the app and does not navigate to a download page',async()=>{
  await page.locator('.nav button[data-page=more]').click();const before=page.url();await click('check-update');await page.locator('#update-message').filter({hasText:'Установлено актуальну версію'}).waitFor();assert.equal(page.url(),before);assert.equal(rpcCalls.some(p=>p.path==='/api/app-info'),false);await page.locator('.nav button[data-page=home]').click();
 });
 await mark('Modal forms also use Ukrainian validation',async()=>{
  await page.locator('.nav button[data-page=cadets]').click();await click('add-cadet');await page.locator('#modal button.primary').click();assert.equal(await page.locator('#modal input[name=fullName]').evaluate(el=>el.validationMessage),'Заповніть це поле.');assert.equal(await page.locator('#modal select[name=groupName]').evaluate(el=>el.validationMessage),'Оберіть значення зі списку.');await page.locator('#modal button[data-action=cancel-modal]').click();await page.locator('.nav button[data-page=home]').click();
 });
 await mark('Desktop editor saves incomplete draft across reload',async()=>{await click('new-test');await page.locator('input[data-draft=title]').fill('Синхронізація між ПК');await page.locator('textarea[data-question="0"][data-prop=text]').fill('Який пристрій показує висоту?');await page.waitForFunction(()=>document.querySelector('input[data-draft=title]')?.value.length>0);await page.waitForTimeout(250);await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора'}).waitFor();await click('edit-draft');assert.equal(await page.locator('input[data-draft=title]').inputValue(),'Синхронізація між ПК');assert.equal(await page.locator('textarea[data-question="0"][data-prop=text]').inputValue(),'Який пристрій показує висоту?');});
 await mark('Publishing desktop test makes it available to the cadet API',async()=>{await page.locator('input[data-answer="0"][data-a="0"]').fill('Висотомір');await page.locator('input[data-answer="0"][data-a="1"]').fill('Компас');await page.locator('input[data-draft=randomizeQuestions]').uncheck();await page.locator('input[data-draft=randomizeAnswers]').uncheck();for(const [i,text,right,wrong] of [[1,'Який прилад показує напрямок?','Компас','Висотомір'],[2,'Який прилад показує швидкість?','Спідометр','Термометр']]){await click('add-question');await page.locator(`textarea[data-question="${i}"][data-prop=text]`).fill(text);await page.locator(`input[data-answer="${i}"][data-a="0"]`).fill(right);await page.locator(`input[data-answer="${i}"][data-a="1"]`).fill(wrong);}await click('publish-test');await page.getByRole('heading',{name:'Тести',exact:true}).waitFor();await page.getByRole('heading',{name:'Синхронізація між ПК'}).waitFor();assert.ok(api('GET','/api/instructor/dashboard',instructorToken).tests.some(t=>t.title==='Синхронізація між ПК'));});
 const test=api('GET','/api/instructor/dashboard',instructorToken).tests.find(t=>t.title==='Синхронізація між ПК');
 await mark('New test is closed until the instructor opens access',async()=>{assert.equal(test.access.defaultOpen,false);const card=page.locator('.test-card').filter({hasText:test.title});await card.locator('[data-action=test-access]').click();await page.locator('[name=accessState]').selectOption('open');await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});assert.equal(api('GET','/api/instructor/tests/'+test.id+'/access',instructorToken).test.access.defaultOpen,true);});
 await mark('Registration uses group dropdown and interoperable password hash',async()=>{await click('logout');await page.locator('button[data-role=cadet]').click();await click('auth-mode');await page.locator('input[name=fullName]').fill('Перевірка ПК Курсант');await page.locator('input[name=username]').fill('pc_ui');await page.locator('input[name=password]').fill('ui-password-2026');await page.locator('select[name=group]').selectOption(String(group.id));await page.locator('#auth-form button.primary').click();await page.getByRole('heading',{name:/Вітаємо/}).waitFor();await page.waitForFunction(()=>document.querySelector('.topbar')?.textContent.includes('Оновлено'));});
 await mark('Cadets cannot create instructor statements',async()=>{await page.locator('.nav button[data-page=results]').click();assert.equal(await page.locator('button[data-action=group-statement]').count(),0);await page.locator('.nav button[data-page=home]').click();});
 const cadetToken=state.session.token;
 await mark('Download for offline and question navigation',async()=>{await page.locator('.nav button[data-page=tests]').click();const card=page.locator('.test-card').filter({hasText:'Синхронізація між ПК'});await card.locator('button[data-action=download]').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('збережено'));await card.locator('button[data-action=start]').click();await page.locator('#modal button.primary').click();await page.locator('.runner').waitFor();offline=true;await page.getByText('Висотомір',{exact:true}).click();await click('next');await page.locator('.question-text').filter({hasText:'Який прилад показує напрямок?'}).waitFor();await page.getByText('Висотомір',{exact:true}).click();await click('unanswered');await page.locator('.question-text').filter({hasText:'Який прилад показує швидкість?'}).waitFor();});
 await mark('Lost reply keeps durable result and retry avoids duplicate',async()=>{offline=false;dropAfterCommit=true;await click('finish');await page.locator('#modal button.primary').click();await page.getByRole('heading',{name:'Синхронізація між ПК'}).waitFor();await page.waitForFunction(()=>document.body.textContent.includes('Результат у черзі'));assert.equal(state.accounts[String(state.session.user.id)].pending.length,1);await page.getByRole('button',{name:'До результатів',exact:true}).click();await click('sync');await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Чергу надіслано'));await page.waitForFunction(()=>document.body.textContent.includes('33%'));assert.equal(state.accounts[String(state.session.user.id)].pending.length,0);const r=api('GET','/api/my-results',cadetToken).results.filter(r=>String(r.testId)===String(test.id));assert.equal(r.length,1);});
 await mark('Cadet sees selected and correct answers, including skips, after restart',async()=>{
  async function assertReview(){await page.locator('button[data-action=review-result]').first().click();await page.locator('.review').filter({hasText:'Який пристрій показує висоту?'}).getByText('Ваша відповідь: Висотомір',{exact:true}).waitFor();const wrong=page.locator('.review').filter({hasText:'Який прилад показує напрямок?'});await wrong.getByText('Ваша відповідь: Висотомір',{exact:true}).waitFor();await wrong.getByText('Правильна відповідь: Компас',{exact:true}).waitFor();const skipped=page.locator('.review').filter({hasText:'Який прилад показує швидкість?'});await skipped.getByText('Ваша відповідь: Без відповіді',{exact:true}).waitFor();await skipped.getByText('Правильна відповідь: Спідометр',{exact:true}).waitFor();assert.equal(await page.locator('.review').count(),3);await page.screenshot({path:new URL('../verification/answers-preview.png',import.meta.url).pathname});}
  await assertReview();await page.reload();await page.getByRole('heading',{name:/Вітаємо/}).waitFor();await page.locator('.nav button[data-page=results]').click();await assertReview();await page.getByRole('button',{name:'До результатів',exact:true}).click();
 });
 await mark('Learning overview distinguishes an accepted failed attempt from a new attempt',async()=>{
  await page.locator('.nav button[data-page=home]').click();await page.getByRole('heading',{name:'Навчальний прогрес',exact:true}).waitFor();
  const unit=page.locator('.learning-unit').filter({hasText:'Синхронізація між ПК'});await unit.getByText('Завершено · повторіть матеріал',{exact:true}).waitFor();assert.equal(await unit.locator('button[data-action=start]').count(),0);await unit.getByRole('button',{name:'Перевірка відповідей',exact:true}).waitFor();
 });
 await mark('Completed test blocks repeat across PCs',async()=>{await page.locator('.nav button[data-page=tests]').click();const card=page.locator('.test-card').filter({hasText:'Синхронізація між ПК'});assert.ok(await card.locator('button[data-action=start]').isDisabled());assert.throws(()=>api('POST','/api/results',cadetToken,{testId:test.id,submissionId:'second-pc-repeat',answers:[]}),x=>x.code==='ALREADY_COMPLETED');});
 await mark('Previously granted personal retake is absent from cadet UI',async()=>{const result=api('GET','/api/my-results',cadetToken).results.find(r=>String(r.testId)===String(test.id));assert.throws(()=>api('POST','/api/instructor/results/'+result.id+'/retry',instructorToken),e=>e.code==='RETAKES_DISABLED');const retry=seedLegacyRetry(test,result.userId,result.id);const refreshed=page.waitForResponse(r=>r.url().endsWith('/rpc')&&['/api/cadet/workspace','/api/workspace'].includes(r.request().postDataJSON()?.path));await click('refresh');await refreshed;await page.locator('button[data-action=refresh]:not([disabled])').waitFor();assert.equal(await page.getByRole('heading',{name:retry.title,exact:true}).count(),0);});
 await mark('Instructor sees cadet result submitted from PC',async()=>{await click('logout');await login('instructor','WindRoy','instructor-password');await page.locator('.nav button[data-page=results]').click();await page.getByRole('heading',{name:'Результати та перевірка'}).waitFor();await page.locator('#filter').fill('Перевірка ПК Курсант');await page.waitForFunction(()=>document.querySelector('#results-table')?.textContent.includes('33%'));});
 await mark('Instructor results have no action to grant retakes',async()=>{assert.equal(await page.locator('button[data-action=allow-retry]').count(),0);assert.equal(await page.getByRole('button',{name:/Дозволити повтор/}).count(),0);});
 await mark('Theme and account cache survive restart',async()=>{await click('theme');await page.waitForFunction(()=>document.body.classList.contains('dark'));assert.equal(state.theme,'dark');await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора'}).waitFor();assert.ok(await page.locator('body').evaluate(el=>el.classList.contains('dark')));});
 await mark('Cached instructor cabinet remains usable while offline',async()=>{offline=true;await click('refresh');await page.waitForFunction(()=>document.querySelector('.notice')?.textContent.includes('обрив'));assert.ok((await page.locator('.stat').count())>=4);offline=false;await click('refresh');await page.waitForFunction(()=>document.querySelector('.topbar')?.textContent.includes('Оновлено'));});
 const otherGroup=api('POST','/api/instructor/groups',instructorToken,{name:'ПК — інша група для видалення'}).group;
 const deletionPassword=await (await import('../web/core.js')).credential('deletion-ui-password');
 const deletionCadets=[group,otherGroup,otherGroup].map((g,i)=>api('POST','/api/register','',{fullName:'Перевірка видалення '+(i+1),username:'ui_delete_'+i,groupId:g.id,...deletionPassword}));
 for(const [i,c] of deletionCadets.entries()){const submissionId='pc-ui-delete-'+crypto.randomUUID(),started=api('POST','/api/tests/'+test.id+'/start',c.token,{submissionId});api('POST','/api/results',c.token,{testId:test.id,durationSeconds:1,submissionId,startPermit:started.startPermit,answers:[]});}
 await click('refresh');await page.locator('.nav button[data-page=cadets]').click();
 const transferCadet=api('POST','/api/register','',{fullName:'Перевірка переведення ПК',username:'ui_transfer',groupId:group.id,...deletionPassword});
 const transferArchived=api('POST','/api/instructor/groups',instructorToken,{name:'Архів для переведення ПК'}).group;
 api('POST',`/api/instructor/groups/${transferArchived.id}/archive`,instructorToken,{archived:true,expectedRevision:1});
 await click('refresh');
 const moveButton=()=>page.locator(`button[data-action=cadet-group][data-id="${transferCadet.user.id}"]`);
 await mark('Transfer dialog identifies the cadet and excludes current and archived groups; cancel does not write',async()=>{
  const before=rpcCalls.filter(p=>p.path.endsWith('/group')).length;
  await moveButton().click();await page.locator('#modal').getByText(transferCadet.user.fullName,{exact:true}).waitFor();
  const options=await page.locator('#modal select[name=groupId] option').allTextContents();assert.ok(!options.includes(group.name));assert.ok(!options.includes(transferArchived.name));assert.equal(await page.locator('#modal select[name=groupId]').inputValue(),'');
  assert.ok((await page.locator('#modal').textContent()).includes('У старих результатах залишиться група'));await page.locator('#modal button[data-action=cancel-modal]').click();assert.equal(rpcCalls.filter(p=>p.path.endsWith('/group')).length,before);
 });
 await mark('Foreign transfer acknowledgement and an old server leave cached membership intact',async()=>{
  for(const mode of ['foreign','unsupported']){
   transferMode=mode;try{await moveButton().click();await page.locator('#modal select[name=groupId]').selectOption(String(otherGroup.id));await page.locator('#modal button.primary').click();await page.locator('#toast').filter({hasText:mode==='foreign'?'Сервер не підтвердив':'оновіть серверний Код.gs'}).waitFor();assert.equal(context.findUserById_(transferCadet.user.id).groupName,group.name);assert.equal(state.accounts[String(state.session.user.id)].cadets.find(u=>String(u.id)===String(transferCadet.user.id)).groupName,group.name);await page.locator('#modal button[data-action=cancel-modal]').click();}finally{transferMode='';}
  }
 });
 await mark('Lost transfer response retries safely and updates the cadet row and cache',async()=>{
  transferMode='lost';await moveButton().click();await page.locator('#modal select[name=groupId]').selectOption(String(otherGroup.id));await page.locator('#modal button.primary').click();await page.locator('#toast').filter({hasText:'Втрачено відповідь переведення'}).waitFor();assert.equal(context.findUserById_(transferCadet.user.id).groupName,otherGroup.name);
  await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});await moveButton().locator('xpath=ancestor::tr').getByText(otherGroup.name,{exact:true}).waitFor();assert.equal(state.accounts[String(state.session.user.id)].cadets.find(u=>String(u.id)===String(transferCadet.user.id)).groupName,otherGroup.name);
 });
 await mark('A concurrent transfer refreshes the directory instead of overwriting the other instructor',async()=>{
  await moveButton().click();await page.locator('#modal select[name=groupId]').selectOption(String(group.id));
  const third=api('POST','/api/instructor/groups',instructorToken,{name:'Конфлікт переведення ПК'}).group;
  api('POST',`/api/instructor/users/${transferCadet.user.id}/group`,instructorToken,{groupId:third.id,expectedGroupName:otherGroup.name});
  await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});await moveButton().locator('xpath=ancestor::tr').getByText(third.name,{exact:true}).waitFor();assert.equal(context.findUserById_(transferCadet.user.id).groupName,third.name);
 });
 const deleteButton=c=>page.locator('button[data-action=delete-cadet][data-id="'+c.user.id+'"]');
 await mark('Delete confirmation names the exact cadet and group; cancel performs no request',async()=>{
  const c=deletionCadets[1],before=rpcCalls.filter(p=>p.method==='DELETE').length;
  await deleteButton(c).click();await page.locator('#modal').getByText(c.user.fullName,{exact:true}).waitFor();assert.ok((await page.locator('#modal').textContent()).includes(c.user.username));assert.ok((await page.locator('#modal').textContent()).includes(otherGroup.name));
  await page.locator('#modal button[data-action=cancel-modal]').click();assert.equal(rpcCalls.filter(p=>p.method==='DELETE').length,before);assert.ok(context.findUserById_(c.user.id));
 });
 for(const c of deletionCadets.slice(0,2))await mark('Confirmed full deletion from group: '+c.user.groupName,async()=>{
  await deleteButton(c).click();await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});assert.equal(await deleteButton(c).count(),0);assert.equal(context.findUserById_(c.user.id),null);
  assert.equal(api('GET','/api/instructor/results',instructorToken).results.some(r=>String(r.userId)===String(c.user.id)),false);assert.throws(()=>api('GET','/api/my-results',c.token),x=>x.code==='SESSION_EXPIRED');
 });
 await mark('Foreign deletion acknowledgement cannot clear the selected account',async()=>{
  const c=deletionCadets[2];foreignDeleteAck=true;
  try{await deleteButton(c).click();await page.locator('#modal button.primary').click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Сервер не підтвердив'));assert.equal(await deleteButton(c).count(),1);assert.ok(context.findUserById_(c.user.id));assert.ok(state.accounts[String(state.session.user.id)].cadets.some(u=>String(u.id)===String(c.user.id)));await page.locator('#modal button[data-action=cancel-modal]').click();}
  finally{foreignDeleteAck=false;}
 });
 await mark('Deletion by another instructor disappears from cached results after refresh',async()=>{
  const c=deletionCadets[2];await page.locator('.nav button[data-page=results]').click();await page.getByRole('heading',{name:'Результати та перевірка'}).waitFor();await page.locator('#filter').fill(c.user.fullName);await page.locator('#results-table').getByText(c.user.fullName,{exact:true}).waitFor();
  api('DELETE','/api/instructor/users/'+c.user.id,instructorToken,{confirmUserId:String(c.user.id)});await click('refresh');await page.getByRole('heading',{name:'Результатів не знайдено'}).waitFor();assert.equal(state.accounts[String(state.session.user.id)].results.some(r=>String(r.userId)===String(c.user.id)),false);assert.ok(context.findUserById_(state.session.user.id));
 });
 await mark('Server text is escaped in rendering',async()=>{api('POST','/api/instructor/groups',instructorToken,{name:'<img src=x onerror=alert(1)>'});await click('refresh');await page.locator('.nav button[data-page=groups]').click();await page.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();assert.equal(await page.locator('img[src=x]').count(),0);});
 await page.locator('.nav button[data-page=home]').click();await page.getByRole('heading',{name:'Кабінет інструктора'}).waitFor();await page.setViewportSize({width:1440,height:1000});
 await mark('Long account name and logout fit inside sidebar',assertSidebarFits);
 await page.screenshot({path:new URL('../verification/desktop-preview.png',import.meta.url).pathname});
 await mark('Compact viewport has no horizontal document overflow',async()=>{await page.setViewportSize({width:800,height:800});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);await assertSidebarFits();});

 // The PDF path uses real server reads and the same bundled generator shipped in the EXE.
 await page.setViewportSize({width:1440,height:1000});
 const statementGroup=api('POST','/api/instructor/groups',instructorToken,{name:'Відомість - приклад (тестові дані)'}).group;
 const reportPassword=await page.evaluate(async()=>{const C=await import('/core.js');return C.credential('statement-password');});
 const reportTest=api('POST','/api/instructor/tests',instructorToken,{title:'Підсумковий тест (приклад)',description:'',mode:'training',durationMinutes:0,passingPercent:70,published:true,questions:[{text:'Чи завершена підготовка?',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]},{text:'Чи перевірено обладнання?',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]}).test;
 const sameTitleTest=api('POST','/api/instructor/tests',instructorToken,{title:reportTest.title,description:'',mode:'training',durationMinutes:0,passingPercent:70,published:true,questions:[{text:'Інший тест із такою самою назвою',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]}).test;
 const reportFull=api('GET','/api/tests/'+reportTest.id,instructorToken).test;
 const reportCadets=[];
 for(let i=1;i<=27;i++){
  const fullName=i>=26?'Курсант Однаковий Приклад':i===1?'Ївженко Євгеній Ґнатович':i===2?'Шевченко-Петренко Олександр-Євгеній Володимирович':'Курсант Навчальний Приклад '+String(i).padStart(2,'0');
  const cadet=api('POST','/api/register','',{fullName,username:'pdf_demo_'+i,groupId:statementGroup.id,...reportPassword});reportCadets.push(cadet);
  if(i!==4&&i!==11)api('POST','/api/results',cadet.token,{testId:reportTest.id,submissionId:'pdf-demo-'+i,durationSeconds:120+i*7,answers:reportFull.questions.map((q,j)=>({questionId:q.id,answerId:q.answers.find(a=>a.isCorrect===(i%3===0||j===0)).id}))});
 }
 await page.locator('.nav button[data-page=results]').click();await page.getByRole('heading',{name:'Результати та перевірка'}).waitFor();
 await mark('Statement requires explicit group and test and disambiguates duplicate titles',async()=>{
  await click('group-statement');await page.locator('#modal select[name=groupId]').waitFor();assert.equal(await page.locator('#modal button.primary').isDisabled(),true);
  await page.locator('#modal select[name=groupId]').selectOption(String(statementGroup.id));assert.equal(await page.locator('#modal button.primary').isDisabled(),true);
  const labels=await page.locator('#modal select[name=testId] option').allTextContents();assert.ok(labels.filter(t=>t.startsWith(reportTest.title)).every(t=>t.includes('№')));
  await page.locator('#modal button[data-action=cancel-modal]').click();
 });
 await mark('Statement downloads a true PDF with all 27 cadets and read-only server access',async()=>{
  await click('group-statement');await page.locator('#modal select[name=groupId]').selectOption(String(statementGroup.id));await page.locator('#modal select[name=testId]').selectOption(String(reportTest.id));
  await page.locator('#statement-count').filter({hasText:'27'}).waitFor();const start=rpcCalls.length;
  const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#modal button.primary').click()]);
  await file.saveAs(new URL('../verification/Vidomist-grupy-27-demo.pdf',import.meta.url).pathname);assert.ok(fs.readFileSync(new URL('../verification/Vidomist-grupy-27-demo.pdf',import.meta.url)).subarray(0,5).equals(Buffer.from('%PDF-')));
  assert.ok(rpcCalls.slice(start).some(p=>p.path==='/api/instructor/results'));assert.ok(rpcCalls.slice(start).every(p=>p.method==='GET'));await page.locator('#modal').waitFor({state:'hidden'});
 });
 await mark('PDF export refuses stale cached data after a network failure',async()=>{
  await click('group-statement');await page.locator('#modal select[name=groupId]').selectOption(String(statementGroup.id));await page.locator('#modal select[name=testId]').selectOption(String(reportTest.id));
  let downloaded=false;const listener=()=>{downloaded=true;};page.on('download',listener);offline=true;
  try{await page.locator('#modal button.primary').click();await page.locator('#toast').filter({hasText:'Тестовий обрив мережі'}).waitFor();assert.equal(downloaded,false);assert.equal(await page.locator('#modal').isVisible(),true);}finally{offline=false;page.off('download',listener);}
 });
 await mark('Fresh export excludes a cadet deleted after the dialog was opened',async()=>{
  const deleted=reportCadets[0];api('DELETE','/api/instructor/users/'+deleted.user.id,instructorToken,{confirmUserId:String(deleted.user.id)});
  const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#modal button.primary').click()]);await file.saveAs(new URL('../verification/statement-after-delete.pdf',import.meta.url).pathname);await page.locator('#modal').waitFor({state:'hidden'});
 });
 await mark('Groups with more than 27 cadets cannot silently lose rows',async()=>{
  for(let i=0;i<2;i++)api('POST','/api/register','',{fullName:'Додатковий Курсант '+i,username:'pdf_extra_'+i,groupId:statementGroup.id,...reportPassword});
  await click('group-statement');await page.locator('#modal select[name=groupId]').selectOption(String(statementGroup.id));await page.locator('#modal select[name=testId]').selectOption(String(reportTest.id));await page.locator('#statement-count').filter({hasText:'28'}).waitFor();assert.equal(await page.locator('#modal button.primary').isDisabled(),true);await page.locator('#modal button[data-action=cancel-modal]').click();
 });
 // Office import uses the actual File chooser, native-state adapter and live server model.
 const officeFile=name=>new URL('./fixtures/office/'+name,import.meta.url).pathname;
 async function selectOffice(name,preview=true){
  await page.locator('.nav button[data-page=tests]').click();await click('import');
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#modal button.primary').click()]);
  await chooser.setFiles(officeFile(name));if(preview)await page.locator('.import-review').waitFor();
 }
 await mark('Import dialog provides bundled Word Excel and JSON samples',async()=>{
  await page.locator('.nav button[data-page=tests]').click();await click('import');
  for(const format of ['docx','xlsx']){const [file]=await Promise.all([page.waitForEvent('download'),page.locator(`button[data-action=sample-office][data-format=${format}]`).click()]);const path=new URL('../verification/download-sample.'+format,import.meta.url).pathname;await file.saveAs(path);assert.deepEqual(fs.readFileSync(path),fs.readFileSync(new URL('../web/test-import-sample.'+format,import.meta.url)));}
  assert.equal(await page.locator('button[data-action=sample-json]').count(),1);await click('cancel-modal');
 });
 await mark('Word import previews all questions and exact keys without a server write',async()=>{
  const start=rpcCalls.length;await selectOffice('sample.docx');
  assert.equal(await page.locator('.question').count(),3);await page.locator('#import-summary').filter({hasText:'Готові: 3.'}).waitFor();
  for(const [q,key]of [[0,2],[1,0],[2,1]])assert.equal(await page.locator(`input[data-correct="${q}"][data-a="${key}"]`).isChecked(),true);
  assert.equal(await page.locator('button[data-action=publish-test]').isDisabled(),true);
  assert.equal(rpcCalls.slice(start).some(p=>p.method==='POST'&&p.path.startsWith('/api/instructor/tests')),false);
 });
 await mark('Reviewed Word test publishes once and is available through the cadet API',async()=>{
  await page.locator('input[data-draft=title]').fill('Word — перевірка імпорту');await page.locator('input[data-draft=importReviewed]').check();
  const start=rpcCalls.length;await click('publish-test');await page.getByRole('heading',{name:'Word — перевірка імпорту',exact:true}).waitFor();
  assert.equal(rpcCalls.slice(start).filter(p=>p.method==='POST'&&p.path==='/api/instructor/tests').length,1);
  const imported=api('GET','/api/instructor/dashboard',instructorToken).tests.find(t=>t.title==='Word — перевірка імпорту');assert.equal(imported.questionCount,3);
  assert.ok(api('GET','/api/cadet/workspace',cadetToken).tests.some(t=>String(t.id)===String(imported.id)));
 });
 await mark('Excel missing key stays unselected and incomplete import survives reload',async()=>{
  await selectOffice('sample-missing.xlsx');assert.equal(await page.locator('input[data-correct="1"]:checked').count(),0);
  await page.locator('#import-summary').filter({hasText:'Потребують перевірки: 1.'}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();await click('edit-draft');
  await page.locator('.import-review').waitFor();assert.equal(await page.locator('input[data-correct="1"]:checked').count(),0);assert.equal(await page.locator('input[data-draft=importReviewed]').isChecked(),false);
  assert.equal(await page.locator('button[data-action=publish-test]').isDisabled(),true);
 });
 await mark('Fixing the Excel key updates validation and reordering keeps the selected answer',async()=>{
  await page.locator('input[data-draft=importReviewed]').check();assert.equal(await page.locator('button[data-action=publish-test]').isDisabled(),true);
  await page.locator('input[data-correct="1"][data-a="0"]').check();await page.locator('#import-summary').filter({hasText:'Потребують перевірки: 0.'}).waitFor();
  await page.locator('button[data-action=move-question][data-q="1"][data-direction="-1"]').click();
  await page.waitForFunction(()=>document.querySelector('textarea[data-question="0"][data-prop=text]')?.value.includes('хвилин'));
  assert.equal(await page.locator('input[data-correct="0"][data-a="0"]').isChecked(),true);assert.equal(await page.locator('input[data-correct="1"][data-a="2"]').isChecked(),true);
  await page.locator('button[data-action=delete-answer][data-q="1"][data-a="2"]').click();await page.waitForFunction(()=>document.querySelectorAll('input[data-answer="1"]').length===3);assert.equal(await page.locator('input[data-correct="1"]:checked').count(),0);assert.equal(await page.locator('button[data-action=publish-test]').isDisabled(),true);
  await page.locator('input[data-correct="1"][data-a="0"]').check();await page.locator('input[data-draft=title]').fill('Excel — перевірка імпорту');
  await click('publish-test');await page.getByRole('heading',{name:'Excel — перевірка імпорту',exact:true}).waitFor();
 });
 await mark('Cancel replacement and corrupt files preserve the existing local draft',async()=>{
  await selectOffice('sample.docx');const before=JSON.stringify(state.accounts[String(state.session.user.id)].draft);
  await selectOffice('sample.xlsx',false);await page.getByRole('heading',{name:'Замінити чернетку?',exact:true}).waitFor();await click('cancel-modal');assert.equal(JSON.stringify(state.accounts[String(state.session.user.id)].draft),before);
  await selectOffice('corrupt.docx',false);await page.locator('#toast').filter({hasText:'пошкоджено'}).waitFor();assert.equal(JSON.stringify(state.accounts[String(state.session.user.id)].draft),before);
  await click('new-test');await page.locator('.import-review').waitFor();await page.setViewportSize({width:800,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:new URL('../verification/office-preview.png',import.meta.url).pathname});await page.setViewportSize({width:1440,height:1000});
 });
 await mark('Malformed JSON cannot replace or corrupt the existing draft',async()=>{
  const before=JSON.stringify(state.accounts[String(state.session.user.id)].draft);
  const q={text:'Питання',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]};
  const cases=[{title:'Неправильний ключ',questions:[{...q,answers:[q.answers[0],{text:'Ні',isCorrect:'false'}]}]},
   {title:'Забагато питань',questions:Array.from({length:201},()=>q)},
   {title:'Пошкоджені групи',description:'[[LK-GROUPS:broken',questions:[q]},
   {title:'Неправильне питання',questions:[null]}];
  for(const [i,value] of cases.entries()){
   const file=new URL('../verification/invalid-import-'+i+'.json',import.meta.url);fs.writeFileSync(file,JSON.stringify(value));
   await page.locator('.nav button[data-page=tests]').click();await click('import');
   const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#modal button.primary').click()]);await chooser.setFiles(file.pathname);
   await page.locator('#toast').filter({hasText:['isCorrect','200','групи','тип і текст'][i]}).waitFor();
   assert.equal(JSON.stringify(state.accounts[String(state.session.user.id)].draft),before);
   assert.equal(await page.getByRole('heading',{name:'Замінити чернетку?',exact:true}).count(),0);
  }
  await click('new-test');await page.locator('.import-review').waitFor();assert.equal(await page.locator('.question').count(),3);
 });
 await page.locator('.nav button[data-page=tests]').click();
 await mark('Disk failure stays visible until an acknowledged retry succeeds',async()=>{
  const before=state.theme;stateWritesFail=true;await click('theme');await page.locator('#durability-status').filter({hasText:'Не збережено на диску'}).waitFor();assert.equal(state.theme,before);
  stateWritesFail=false;await click('retry-save');await page.waitForFunction(()=>!document.querySelector('#durability-status [data-action=retry-save]')&&!document.querySelector('#durability-status')?.textContent.includes('Не збережено на диску'));assert.notEqual(state.theme,before);
 });
 const toolsGroup=api('POST','/api/instructor/groups',instructorToken,{name:'Група інструментів UI'}).group;
 const toolsTemplate={description:'',published:true,questions:[{text:'Питання призначення?',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]};
 const toolsTests=[1,2].map(i=>api('POST','/api/instructor/tests',instructorToken,{...toolsTemplate,title:'UI призначення '+i}).test);
 await click('refresh');await page.locator('button[data-action=refresh]:not([disabled])').waitFor();await page.locator('.nav button[data-page=groups]').click();
 await mark('Archiving a group moves it to a restorable archive',async()=>{
  await page.locator(`button[data-action=archive-group][data-id="${toolsGroup.id}"]`).click();await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});
  assert.equal(await page.getByRole('heading',{name:toolsGroup.name,exact:true}).count(),0);
  await click('toggle-archive');await page.getByRole('heading',{name:toolsGroup.name,exact:true}).waitFor();
  assert.equal(api('GET','/api/groups').groups.find(g=>String(g.id)===String(toolsGroup.id)).archived,true);
  await page.locator(`button[data-action=archive-group][data-id="${toolsGroup.id}"]`).click();await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});await click('toggle-archive');await page.getByRole('heading',{name:toolsGroup.name,exact:true}).waitFor();
 });
 await page.locator('.nav button[data-page=tests]').click();
 await mark('Bulk assignment requires explicit tests groups and review',async()=>{
  await click('bulk-assign');await page.locator('#modal button.primary').click();assert.equal(await page.locator('#modal').evaluate(el=>el.open),true);
  for(const t of toolsTests)await page.locator(`#modal input[name=assignTest][value="${t.id}"]`).check();
  await page.locator(`#modal input[name=assignGroup][value="${toolsGroup.id}"]`).check();await page.locator('#modal input[name=assignmentReviewed]').check();await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});
  for(const t of toolsTests)assert.deepEqual(Array.from(context.assignedGroups_(context.getTestById_(t.id).description)),[toolsGroup.name]);
 });
 await mark('Section filters survive restart without leaking to Home or other lists',async()=>{
  await page.locator('#shared-group').selectOption(String(toolsGroup.id));assert.equal(await page.locator('#shared-test').count(),0);await page.locator('#filter').fill(toolsTests[1].title);
  await page.locator('.nav button[data-page=results]').click();assert.equal(await page.locator('#shared-group').inputValue(),'');await page.locator('#shared-group').selectOption(String(toolsGroup.id));await page.locator('#shared-test').selectOption(String(toolsTests[1].id));
  await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();assert.equal(await page.locator('#shared-group,#shared-test').count(),0);
  await page.locator('.nav button[data-page=results]').click();assert.equal(await page.locator('#shared-test').inputValue(),String(toolsTests[1].id));await click('reset-filters');
 });
 await mark('PC editor saves a two-answer question to the bank and restores both keys',async()=>{
  await page.locator('.nav button[data-page=tests]').click();await click('new-test');await click('discard-draft');await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});await click('new-test');
  await page.locator('[data-draft=title]').fill('Банк питань — ПК');await page.locator('[data-question="0"][data-prop=text]').fill('Питання банку з двома правильними відповідями');
  await page.locator('[data-question="0"][data-prop=maxPoints]').fill('2');await page.locator('[data-answer="0"][data-a="0"]').fill('Перший');await page.locator('[data-answer="0"][data-a="1"]').fill('Другий');await click('add-answer');await page.locator('[data-answer="0"][data-a="2"]').fill('Зайвий');await page.locator('[data-correct="0"][data-a="1"]').check();
  const before=rpcCalls.filter(p=>p.path==='/api/instructor/question-bank'&&p.method==='POST').length;
  await page.locator('[data-action=bank-save][data-q="0"]').click();await page.locator('#modal [name=category]').fill('Категорія ПК');await click('cancel-modal');assert.equal(rpcCalls.filter(p=>p.path==='/api/instructor/question-bank'&&p.method==='POST').length,before);
  await page.locator('[data-action=bank-save][data-q="0"]').click();await page.locator('#modal [name=category]').fill('Категорія ПК');await page.locator('#modal [name=difficulty]').selectOption('hard');await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});
  const saved=api('GET','/api/instructor/question-bank',instructorToken).questions.find(q=>q.question.text==='Питання банку з двома правильними відповідями');assert.equal(saved.category,'Категорія ПК');assert.equal(saved.difficulty,'hard');assert.equal(saved.question.answers.filter(a=>a.isCorrect).length,2);
  await page.locator('.nav button[data-page=bank]').click();const card=page.locator('.test-card').filter({hasText:saved.question.text});await card.getByText(saved.createdByName,{exact:true}).waitFor();await card.locator('[data-action=bank-add]').click();await click('edit-draft');await page.locator('[data-question="1"][data-prop=maxPoints]').waitFor();assert.equal(await page.locator('.question').count(),2);assert.equal(await page.locator('[data-correct="1"]:checked').count(),2);assert.equal(await page.locator('[data-question="1"][data-prop=maxPoints]').inputValue(),'2');
 });
 await mark('PC editor saves and reuses written bank questions with points and private rubric',async()=>{
  await click('add-question');await page.locator('[data-question-type="2"]').selectOption('written');await page.locator('[data-question="2"][data-prop=text]').fill('Письмове питання банку ПК');await page.locator('[data-question="2"][data-prop=maxPoints]').fill('5');await page.locator('[data-question="2"][data-prop=rubric]').fill('Критерії для викладача');
  await page.locator('[data-action=bank-save][data-q="2"]').click();await page.locator('#modal [name=category]').fill('Категорія ПК');await page.locator('#modal button.primary').click();await page.locator('#modal').waitFor({state:'hidden'});
  const saved=api('GET','/api/instructor/question-bank',instructorToken).questions.find(q=>q.question.text==='Письмове питання банку ПК');assert.equal(saved.question.type,'written');assert.equal(saved.question.maxPoints,5);assert.equal(saved.question.rubric,'Критерії для викладача');
  await page.locator('.nav button[data-page=bank]').click();await page.locator('.test-card').filter({hasText:saved.question.text}).locator('[data-action=bank-add]').click();await click('edit-draft');assert.equal(await page.locator('[data-question-type="3"]').inputValue(),'written');assert.equal(await page.locator('[data-question="3"][data-prop=rubric]').inputValue(),'Критерії для викладача');assert.equal(await page.locator('[data-question="3"][data-prop=maxPoints]').inputValue(),'5');
 });
 assert.deepEqual(failures,[]);
 fs.writeFileSync(reportURL,JSON.stringify({status:'passed',testedAt:new Date().toISOString(),browserVersion:browser.version(),kind:'local_browser_with_real_server_logic',productionVerified:false,windowsRuntimeVerified:false,passed:checks.length,checks,pageErrors:failures},null,2));
 console.log('Desktop UI: '+checks.length+'/'+checks.length+' scenarios passed.');
}catch(error){
 fs.writeFileSync(reportURL,JSON.stringify({status:'failed',testedAt:new Date().toISOString(),kind:'local_browser_with_real_server_logic',productionVerified:false,windowsRuntimeVerified:false,passed:checks.length,checks,failedCheck:currentCheck,error:error.message,pageErrors:failures},null,2));
 throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
