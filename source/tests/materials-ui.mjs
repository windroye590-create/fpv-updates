// This suite tests only our own local application, with the real Code.gs logic
// in an isolated in-memory model. It never logs into or mutates the live service.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,instructorToken,credential}=await import('./fixtures/server_model.mjs');
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
let state={},journal={},offline=false,dropAfterCommit=false,foreignDeleteAck=false,launchId='local-ui-test',uptimeOffset=100000,updateState=2;
const start=performance.now(),rpcCalls=[],failures=[],checks=[];
const group=api('POST','/api/instructor/groups',instructorToken,{name:'ПК — перевірка інтерфейсу'}).group;
const mime={'.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(url.pathname.startsWith('/updates/')){if(url.pathname==='/updates/check')updateState=3;res.end(JSON.stringify({ok:true,state:updateState,version:updateState===3?'1.0.13':'',message:updateState===3?'Оновлення завантажено й перевірено. Застосується під час наступного запуску програми.':'Установлено актуальну версію.'}));return;}
  if(url.pathname==='/clock'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,uptime:uptimeOffset+performance.now()-start,launchId}));return;}
  if(url.pathname==='/state'||url.pathname==='/journal'){
   if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const value=JSON.parse(Buffer.concat(chunks).toString());if(url.pathname==='/journal'){if((value.serial||0)>(journal.serial||0))journal=value;}else state=value;res.end('{"ok":true}');}else res.end(JSON.stringify(url.pathname==='/journal'?journal:state));return;
  }
  if(url.pathname==='/rpc'){
   const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();const p=JSON.parse(raw);rpcCalls.push(p);
   if(offline){res.end(JSON.stringify({ok:false,code:'NETWORK',error:'Тестовий обрив мережі'}));return;}
   if(foreignDeleteAck&&p.method==='DELETE'&&p.path.startsWith('/api/instructor/users/')){res.end(JSON.stringify({ok:true,deleted:true,userId:'different-user'}));return;}
   const reply=context.doPost({postData:{contents:raw}}).text;
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
state={version:1,session:{token:instructorToken,user:context.requireSession_(instructorToken)},groups:[group],accounts:{}};
const linked=api('POST','/api/instructor/tests',instructorToken,{title:'Тест після матеріалу',description:'',mode:'training',durationMinutes:10,passingPercent:50,published:true,questions:[{text:'Чи переглянули матеріал?',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]}).test;
const pdfPath=new URL('./fixtures/materials/three-slides.pdf',import.meta.url).pathname,pdfBytes=fs.readFileSync(pdfPath);
const cadet=api('POST','/api/register','',{fullName:'Тестовий Курсант PDF',username:'pdf-ui-cadet',groupId:group.id,...credential('materials-ui-password')});
let browser,page;
async function mark(label,fn){console.log('RUN '+label);await fn();checks.push(label);console.log('PASS '+checks.length+': '+label);}
async function click(act){await page.locator(`[data-action="${act}"]`).first().click();}
async function list(){await page.locator('.nav [data-action=nav][data-page=materials]').click();await page.getByRole('heading',{name:'Навчальні матеріали',exact:true}).waitFor();await page.waitForTimeout(300);}
try {
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
 page=await browser.newPage({viewport:{width:1360,height:900},locale:'ru-RU'});page.setDefaultTimeout(10000);page.on('pageerror',x=>failures.push(x.message));page.on('console',m=>{if(m.type()==='error')console.log('Browser console: '+m.text());});
 await page.goto(origin+'/?key=materials-test');await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();await list();
 await mark('Instructor can select PDF and preview first slide without uploading',async()=>{
  const before=rpcCalls.filter(p=>p.method!=='GET').length;await click('material-new');await page.locator('#modal [name=title]').fill('Матеріали інструктора');await page.locator('#modal [name=topic]').fill('Метеорологія');await page.locator('#modal [type=file]').setInputFiles(pdfPath);
  await page.waitForFunction(()=>document.querySelector('#pdf-info')?.textContent.includes('3 стор.'));
  assert.ok(await page.locator('#pdf-preview').isVisible());assert.equal(rpcCalls.filter(p=>p.method!=='GET').length,before);await page.locator('#modal [name=materialGroup][value="'+String(group.id)+'"]').check();await page.locator('#modal [name=testId]').selectOption(String(linked.id));
 });
 let material,linkedSubmission;
 await mark('Malformed PDF stays unpublished and can be replaced in the same form',async()=>{
  const before=rpcCalls.filter(p=>p.path==='/api/instructor/materials').length;
  await page.locator('#modal [type=file]').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-broken-without-eof')});
  await page.waitForFunction(()=>document.querySelector('#pdf-info')?.textContent.includes('Оберіть PDF'));
  assert.equal(rpcCalls.filter(p=>p.path==='/api/instructor/materials').length,before);
  await page.locator('#modal [type=file]').setInputFiles(pdfPath);await page.waitForFunction(()=>document.querySelector('#pdf-info')?.textContent.includes('3 стор.'));
 });
 await mark('Publish commits verified PDF and group assignment once',async()=>{
  await page.locator('#modal .primary').click();await page.locator('#modal').waitFor({state:'hidden'});await page.getByRole('heading',{name:'Матеріали інструктора',exact:true}).waitFor();
  material=api('GET','/api/materials',cadet.token).materials.find(m=>m.title==='Матеріали інструктора');assert.equal(material.pageCount,3);assert.equal(material.size,pdfBytes.length);
  assert.equal(rpcCalls.filter(p=>p.path==='/api/instructor/materials').length,1);
 });
 await mark('In-app viewer renders PDF under native CSP and navigates slides',async()=>{
  await click('material-open');await page.waitForFunction(()=>document.querySelector('#material-page')?.textContent==='1 / 3');await click('material-next');await page.waitForFunction(()=>document.querySelector('#material-page')?.textContent==='2 / 3');await click('material-plus');await page.waitForFunction(()=>document.querySelector('#material-zoom')?.textContent==='125%');await click('material-fullscreen');await page.waitForFunction(()=>Boolean(document.fullscreenElement));await click('material-fullscreen');await page.waitForFunction(()=>!document.fullscreenElement);
  // Fullscreen state changes before PDF.js finishes the resize repaint. Keep
  // the original pixel assertions, but wait for the fixture to be painted.
  await page.waitForFunction(()=>{
   const canvas=document.querySelector('#material-canvas');if(!canvas||canvas.width<=10||canvas.height<=10)return false;
   const pixel=canvas.getContext('2d').getImageData(10,10,1,1).data;
   return pixel[3]>0&&pixel.slice(0,3).some(value=>value!==255);
  });
  const pixels=await page.locator('#material-canvas').evaluate(c=>{const p=c.getContext('2d').getImageData(10,10,1,1).data;return [...p];});assert.ok(pixels[3]>0);assert.notDeepEqual(pixels.slice(0,3),[255,255,255]);await click('material-close');
 });
 await mark('Instructor sees cadets who have not opened material',async()=>{await click('material-readers');await page.getByRole('heading',{name:/Перегляди: Матеріали/}).waitFor();assert.ok((await page.locator('#modal').textContent()).includes('Тестовий Курсант PDF'));assert.ok((await page.locator('#modal').textContent()).includes('Ще не відкривав'));await page.locator('#modal .primary').click();});
 await click('logout');await page.getByRole('heading',{name:'Вхід до кабінету',exact:true}).waitFor();await page.locator('[data-action=role][data-role=cadet]').click();await page.locator('#auth-form [name=username]').fill('pdf-ui-cadet');await page.locator('#auth-form [name=password]').fill('materials-ui-password');await page.locator('#auth-form [name=group]').selectOption({label:group.name});await page.locator('#auth-form .primary').click();await page.getByRole('heading',{name:/Вітаємо/}).waitFor();await list();
 await mark('Cadet sees assigned PDF without instructor management actions',async()=>{assert.equal(await page.locator('[data-action=material-new]').count(),0);assert.equal(await page.locator('[data-action=material-edit]').count(),0);assert.ok(await page.getByRole('heading',{name:'Матеріали інструктора',exact:true}).isVisible());});
 await mark('Cadet saves encrypted offline bytes outside main app state',async()=>{
  await click('material-download');await page.waitForFunction(()=>document.querySelector('[data-action=material-remove-offline]'));
  assert.ok(state.accounts[String(cadet.user.id)].materialKey);assert.ok(!JSON.stringify(state).includes(pdfBytes.toString('base64')));
  const record=await page.evaluate(async()=>{const d=await new Promise(resolve=>{const q=indexedDB.open('fpv-materials-v1',1);q.onsuccess=()=>resolve(q.result);});return new Promise(resolve=>{const q=d.transaction('pdf').objectStore('pdf').getAll();q.onsuccess=()=>resolve(q.result.map(v=>({iv:v.iv.length,encrypted:v.data.byteLength})));});});assert.equal(record[0].iv,12);assert.ok(record[0].encrypted>pdfBytes.length);
 });
 await mark('Offline viewing records last page locally without server writes',async()=>{
  offline=true;await click('material-open');await page.waitForFunction(()=>document.querySelector('#material-page')?.textContent==='1 / 3');await click('material-next');await page.waitForFunction(()=>document.querySelector('#material-page')?.textContent==='2 / 3');await click('material-close');
  await page.waitForFunction(()=>document.querySelector('.test-card')?.textContent.includes('Остання сторінка: 2/3'));assert.equal(state.accounts[String(cadet.user.id)].materialProgress[material.id].pending,true);
 });
 await mark('Restart preserves encrypted PDF and resumes last viewed page',async()=>{
  await page.reload();await page.getByRole('heading',{name:/Вітаємо/}).waitFor();await list();await click('material-open');await page.waitForFunction(()=>document.querySelector('#material-page')?.textContent==='2 / 3');await click('material-close');
 });
 await mark('Restored network synchronizes viewing progress',async()=>{offline=false;await click('refresh');await page.waitForTimeout(500);const r=api('GET',`/api/instructor/materials/${material.id}/progress`,instructorToken).readers.find(v=>v.userId===String(cadet.user.id));assert.equal(r.lastPage,2);assert.equal(r.maxPage,2);assert.equal(state.accounts[String(cadet.user.id)].materialProgress[material.id].pending,false);});
 await mark('Linked material test finishes offline and survives a restart',async()=>{
  await click('material-open');await page.waitForFunction(()=>document.querySelector('#material-page')?.textContent==='2 / 3');
  await click('material-test');await page.getByRole('heading',{name:'Почати тренування?',exact:true}).waitFor();await page.locator('#modal .primary').click();await page.locator('[data-action=finish]').waitFor();await page.getByRole('checkbox',{name:'Так',exact:true}).check();
  offline=true;await click('finish');await page.locator('#modal .primary').click();await page.waitForFunction(()=>document.body.textContent.includes('Результат у черзі.'));
  const saved=state.accounts[String(cadet.user.id)];assert.equal(saved.pending.length,1);assert.equal(saved.run,null);linkedSubmission=structuredClone(saved.pending[0].body);
  assert.equal(api('GET','/api/my-results',cadet.token).results.filter(r=>String(r.testId)===String(linked.id)).length,0);
  await page.reload();await page.getByRole('heading',{name:/Вітаємо/}).waitFor();assert.deepEqual(state.accounts[String(cadet.user.id)].pending[0].body,linkedSubmission);
 });
 await mark('Restored network preserves the queue when the server acknowledgement is lost',async()=>{
  offline=false;dropAfterCommit=true;await page.locator('[data-action=nav][data-page=more]').click();await click('sync');await page.waitForFunction(()=>document.body.textContent.includes('Результати залишаються у черзі.'));
  assert.equal(dropAfterCommit,false);assert.equal(state.accounts[String(cadet.user.id)].pending.length,1);
  assert.equal(api('GET','/api/my-results',cadet.token).results.filter(r=>String(r.testId)===String(linked.id)).length,1);
 });
 await mark('Retry delivers one shared result and another device cannot repeat the test',async()=>{
  await click('sync');await page.waitForFunction(()=>document.body.textContent.includes('Чергу надіслано.'));
  assert.equal(state.accounts[String(cadet.user.id)].pending.length,0);
  const results=api('GET','/api/instructor/results',instructorToken).results.filter(r=>String(r.userId)===String(cadet.user.id)&&String(r.testId)===String(linked.id));assert.equal(results.length,1);assert.equal(results[0].score,100);
  assert.throws(()=>api('POST','/api/results',cadet.token,{...linkedSubmission,submissionId:'second-pc-extra-'+crypto.randomUUID()}),x=>x.code==='ALREADY_COMPLETED');
  const sent=rpcCalls.filter(p=>p.path==='/api/results'&&String(p.body.testId)===String(linked.id));assert.ok(sent.length>=3);assert.ok(sent.every(p=>JSON.stringify(p.body)===JSON.stringify(linkedSubmission)));await list();
 });
 await mark('Published update invalidates the saved old revision',async()=>{api('POST','/api/instructor/materials',instructorToken,{...material,title:'Оновлені матеріали',expectedRevision:material.revision});await click('refresh');await page.getByRole('heading',{name:'Оновлені матеріали',exact:true}).waitFor();assert.equal(await page.locator('[data-action=material-remove-offline]').count(),0);assert.ok(!state.accounts[String(cadet.user.id)].materialSaved[material.id]);});
 await mark('Revoked group assignment removes cached material',async()=>{const current=api('GET','/api/materials',cadet.token).materials.find(m=>m.id===material.id);const other=api('POST','/api/instructor/groups',instructorToken,{name:'Недоступні матеріали'}).group;api('POST','/api/instructor/materials',instructorToken,{...current,expectedRevision:current.revision,groupIds:[String(other.id)]});await click('refresh');await page.waitForFunction(()=>!document.querySelector('[data-action=material-open]'));assert.equal(state.accounts[String(cadet.user.id)].materials.length,0);});
 await click('logout');await page.getByRole('heading',{name:'Вхід до кабінету',exact:true}).waitFor();await page.locator('[data-action=role][data-role=instructor]').click();await page.locator('#auth-form [name=username]').fill('WindRoy');await page.locator('#auth-form [name=password]').fill('instructor-password');await page.locator('#auth-form .primary').click();await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();await list();
 await mark('Ukrainian embedded fonts render from a real seven-page PDF',async()=>{
  await click('material-new');await page.locator('#modal [type=file]').setInputFiles(new URL('./fixtures/materials/ukrainian-seven-pages.pdf',import.meta.url).pathname);await page.waitForFunction(()=>document.querySelector('#pdf-info')?.textContent.includes('7 стор.'));
  await page.locator('#pdf-preview').screenshot({path:new URL('../verification/pdf-ukrainian-preview.png',import.meta.url).pathname});await page.locator('#modal [data-action=cancel-modal]').click();
 });
 assert.deepEqual(failures,[]);
 fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/materials-ui.json',import.meta.url),JSON.stringify({passed:checks.length,checks,errors:failures,engine:'Chromium',nativeOSRuntime:false},null,2));
} catch(x){console.error(x);if(page){await page.screenshot({path:new URL('../verification/materials-ui-failure.png',import.meta.url).pathname});console.error((await page.locator('body').textContent()).slice(-3500));console.error(failures);}process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
