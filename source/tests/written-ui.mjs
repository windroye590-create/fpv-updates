// This suite tests only our own local application, with the real Code.gs logic
// in an isolated in-memory model. It never logs into or mutates the live service.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,instructorToken}=await import('./fixtures/server_model.mjs');
let dropGrade=false;let state={},journal={},offline=false,dropAfterCommit=false,foreignDeleteAck=false,transferMode='',stateWritesFail=false,launchId='local-ui-test',uptimeOffset=100000,updateState=2;
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
   if(dropGrade&&p.path.endsWith('/grade')){dropGrade=false;res.end('{"ok":false,"code":"NETWORK","error":"Втрачено підтвердження перевірки"}');return;}
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
const reportURL=new URL('../verification/written-ui.json',import.meta.url);
fs.rmSync(reportURL,{force:true});
async function mark(label,run){currentCheck=label;await run();checks.push(label);console.log('PASS '+checks.length+': '+label);}
async function assertSidebarFits(){const boxes=await page.locator('.sidebar').evaluate(el=>{const edge=el.getBoundingClientRect().right;return [...el.querySelectorAll('.sidebar-footer .user,.sidebar-footer button')].map(child=>({element:child.className,right:child.getBoundingClientRect().right,edge}));});assert.ok(boxes.every(b=>b.right<=b.edge+1),JSON.stringify(boxes));}
async function click(action){await page.locator(`button[data-action="${action}"]`).first().click();}
async function login(role,username,password,groupName){await page.locator(`button[data-role="${role}"]`).click();if(await page.locator('input[name=fullName]').count())await click('auth-mode');await page.locator('input[name=username]').fill(username);await page.locator('input[name=password]').fill(password);if(role==='cadet')await page.locator('select[name=group]').selectOption({label:groupName});await page.locator('#auth-form button.primary').click();await page.getByRole('heading',{name:role==='instructor'?'Кабінет інструктора':/Вітаємо/}).waitFor();await page.waitForFunction(()=>document.querySelector('.topbar')?.textContent.includes('Оновлено'));}try {
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',x=>failures.push(x.message));
 await page.goto(origin+'/?key=local');await login('instructor','WindRoy','instructor-password');
 await mark('Instructor creates a mixed test and restores its local editor draft',async()=>{
  await click('new-test');await page.locator('[data-draft=title]').fill('Письмові відповіді — UI');
  await page.locator('[data-question="0"][data-prop=text]').fill('Що показує висотомір?');await page.locator('[data-question="0"][data-prop=maxPoints]').fill('2');
  await page.locator('[data-answer="0"][data-a="0"]').fill('Висоту');await page.locator('[data-answer="0"][data-a="1"]').fill('Курс');
  for(const [i,text,max] of [[1,'Опишіть перевірку висотоміра.',5],[2,'Опишіть дії курсанта.',3]]) {
   await click('add-question');await page.locator(`[data-question-type="${i}"]`).selectOption('written');
   await page.locator(`[data-question="${i}"][data-prop=text]`).fill(text);await page.locator(`[data-question="${i}"][data-prop=maxPoints]`).fill(String(max));await page.locator(`[data-question="${i}"][data-prop=rubric]`).fill('Приватні критерії викладача '+i);
  }
  await page.locator('[data-draft=randomizeQuestions]').uncheck();await page.locator('[data-draft=randomizeAnswers]').uncheck();await page.waitForTimeout(400);await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора'}).waitFor();await click('edit-draft');
  assert.equal(await page.locator('[data-question-type="1"]').inputValue(),'written');assert.equal(await page.locator('[data-question="1"][data-prop=rubric]').inputValue(),'Приватні критерії викладача 1');await click('publish-test');await page.getByRole('heading',{name:'Тести',exact:true}).waitFor();
 });
 const test=api('GET','/api/instructor/dashboard',instructorToken).tests.find(t=>t.title==='Письмові відповіді — UI');
 api('POST','/api/instructor/tests/'+test.id+'/access',instructorToken,{expectedRevision:test.access.revision,scope:'all',open:true});
 const creds=await (await import('../web/core.js')).credential('written-ui-password');
 const cadet=api('POST','/api/register','',{fullName:'Письмовий Курсант UI',username:'written_ui',groupId:group.id,...creds});const full=api('GET','/api/tests/'+test.id,cadet.token).test;
 await click('logout');await login('cadet','written_ui','written-ui-password',group.name);
 await mark('Cadet writes multiline text without seeing the model answer',async()=>{
  await page.locator('.nav button[data-page=tests]').click();const card=page.locator('.test-card').filter({hasText:test.title});await card.locator('[data-action=start]').click();await page.locator('#modal button.primary').click();await page.locator('.runner').waitFor();await page.getByText('Висоту',{exact:true}).click();await click('next');await page.locator('[data-run-written]').fill('Перший крок.\nДругий крок. <script>alert(1)</script>');assert.ok(!(await page.locator('body').textContent()).includes('Приватні критерії'));await page.waitForTimeout(450);assert.equal(state.accounts[String(cadet.user.id)].run.answers[String(full.questions[1].id)],'Перший крок.\nДругий крок. <script>alert(1)</script>');
 });
 await mark('Written response survives application reload',async()=>{await page.reload();await page.getByRole('heading',{name:/Вітаємо/}).waitFor();await click('resume');await page.locator(`[data-run-written="${full.questions[1].id}"]`).waitFor();assert.ok((await page.locator(`[data-run-written="${full.questions[1].id}"]`).inputValue()).includes('Другий крок.'));await click('next');await page.locator(`[data-run-written="${full.questions[2].id}"]`).fill('Дія курсанта');});
 await mark('Offline submit saves the complete typed response',async()=>{offline=true;await click('finish');await page.locator('#modal button.primary').click();await page.waitForFunction(()=>document.body.textContent.includes('Результат у черзі.'));const pending=state.accounts[String(cadet.user.id)].pending[0];assert.equal(pending.body.writtenProtocol,1);assert.ok(pending.body.answers[1].text.includes('<script>'),JSON.stringify(pending.body.answers));assert.equal(state.accounts[String(cadet.user.id)].run,null);});
 await page.locator('button[data-page=results]').first().click();offline=false;await click('sync');await page.waitForFunction(()=>document.body.textContent.includes('Очікує перевірки'));
 const result=api('GET','/api/my-results',cadet.token).results.find(r=>String(r.testId)===String(test.id));
 await mark('Pending result has no false zero or failure label and displays text safely',async()=>{await page.locator('[data-action=review-result]').click();await page.locator('.grading-pending').waitFor();assert.equal(await page.locator('.score').count(),0);assert.equal(await page.locator('.written-review').count(),2);assert.ok((await page.locator('.written-review').first().textContent()).includes('<script>alert(1)</script>'));assert.equal(await page.locator('.written-review script').count(),0);});
 await page.locator('button[data-page=results]').first().click();await click('logout');await login('instructor','WindRoy','instructor-password');await page.locator('.nav button[data-page=results]').click();await page.locator('#filter').fill('Письмовий Курсант UI');await page.locator(`[data-action=grade-result][data-id="${result.id}"]`).click();
 await mark('Instructor sees the response and private grading rubric',async()=>{await page.getByRole('heading',{name:'Перевірка письмової роботи'}).waitFor();await page.locator('summary').first().click();await page.getByText('Приватні критерії викладача 1',{exact:true}).waitFor();assert.equal(await page.locator('[data-grade-prop=points]').count(),2);});
 const firstId=full.questions[1].id,lastId=full.questions[2].id;
 await page.locator(`[data-grade="${firstId}"][data-grade-prop=points]`).fill('4');await page.locator(`[data-grade="${firstId}"][data-grade-prop=comment]`).fill('Додайте останній крок.');
 await mark('A lost grading acknowledgement retains the same retry key and points',async()=>{dropGrade=true;await click('save-grades');await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Втрачено підтвердження'));const request=structuredClone(state.accounts[String(state.session.user.id)].gradingDrafts[String(result.id)].request);assert.ok(request.requestId);assert.equal(context.findResultById_(result.id).gradingRevision,1);await click('save-grades');await page.locator('[data-view=compact][aria-selected=true]').waitFor();assert.equal(await page.locator('#filter').inputValue(),'Письмовий Курсант UI');assert.equal(context.findResultById_(result.id).gradingRevision,1);const sent=rpcCalls.filter(p=>p.path.endsWith('/grade')).at(-1).body;const {reviewLease,...gradeRequest}=sent;assert.deepEqual(gradeRequest,request);assert.ok(reviewLease.clientId&&reviewLease.leaseId);assert.equal(context.findResultById_(result.id).pendingWritten,1);});
 await page.locator(`[data-action=grade-result][data-id="${result.id}"]`).click();await page.locator(`[data-grade="${lastId}"][data-grade-prop=points]`).fill('2');
 await mark('A narrow grading screen supports finishing a partially graded work',async()=>{await page.setViewportSize({width:390,height:844});await page.screenshot({path:new URL('../verification/written-grading-narrow.png',import.meta.url).pathname,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await click('save-grades');await page.locator('[data-view=compact][aria-selected=true]').waitFor();assert.equal(await page.locator('#filter').inputValue(),'Письмовий Курсант UI');assert.equal(context.findResultById_(result.id).score,80);await page.locator('[data-action=results-view][data-view=pending]').click();await page.getByRole('heading',{name:'Перевірка робіт',exact:true}).waitFor();assert.equal(await page.locator(`[data-action=grade-result][data-id="${result.id}"]`).count(),0);await page.setViewportSize({width:1440,height:1000});});
 await click('logout');await login('cadet','written_ui','written-ui-password',group.name);await page.locator('.nav button[data-page=results]').click();
 await mark('Cadet retrieves final weighted points and comments from the server',async()=>{await page.locator('[data-action=review-result]').click();await page.locator('.score').filter({hasText:'80'}).waitFor();await page.getByText('Коментар: Додайте останній крок.',{exact:true}).waitFor();await page.getByText('Бали: 4 / 5',{exact:true}).waitFor();await page.screenshot({path:new URL('../verification/written-result.png',import.meta.url).pathname,fullPage:true});});
 assert.deepEqual(failures,[]);fs.writeFileSync(reportURL,JSON.stringify({status:'passed',passed:checks.length,checks,pageErrors:failures,testedAt:new Date().toISOString(),productionWrites:false},null,2));console.log('Written UI: '+checks.length+' passed.');
} catch(error) {console.error(currentCheck,error);fs.writeFileSync(reportURL,JSON.stringify({status:'failed',passed:checks.length,checks,pageErrors:failures,error:String(error),currentCheck},null,2));process.exitCode=1;}
finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
