// Exercise the real UI at desktop, narrow, and short window sizes. The local
// service supplies synthetic records only; no live accounts are used or changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import * as C from '../web/core.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../',import.meta.url).pathname,web=path.join(root,'web');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const word=process.env.LITAKOVA_RESPONSIVE_VISUAL?'':'Надзвичайнодовганазвабезпробілів'.repeat(5),title='Передпольотна підготовка та безпека виконання навчальних завдань '+word;
const groups=Array.from({length:61},(_,i)=>({id:'g'+i,name:'Навчальна група '+i+' — '+word}));
const questions=Array.from({length:60},(_,i)=>({id:'q'+i,text:'Питання '+(i+1)+': поясніть порядок перевірки приладів. '+word,explanation:'Пояснення '+word,answers:[{id:'yes'+i,text:'Правильна відповідь '+word,isCorrect:true},{id:'no'+i,text:'Інша відповідь '+word,isCorrect:false}]}));
const fullTest={id:'t0',title,description:'Розгорнутий опис навчального тесту. '+word,mode:'training',published:true,durationMinutes:30,passingPercent:70,randomizeQuestions:false,randomizeAnswers:false,questions};
const tests=Array.from({length:63},(_,i)=>({...fullTest,id:'t'+i,title:i?'Тест '+i+' — '+word:title,questionCount:questions.length}));
const results=Array.from({length:84},(_,i)=>({id:'r'+i,userId:'c',userName:'Шевченко-Петренко Олександр Володимирович '+word,groupName:groups[0].name,testId:'completed'+i,testTitle:title,total:60,correct:45,score:75,passed:true,durationSeconds:1732,completedAt:new Date().toISOString()}));
const cadets=Array.from({length:76},(_,i)=>({id:'c'+i,username:'long_username_'+word,fullName:'Шевченко-Петренко Олександр Володимирович '+word,groupName:groups[0].name,active:true,role:'cadet'}));
const pdf=fs.readFileSync(new URL('./fixtures/materials/three-slides.pdf',import.meta.url)),hash=crypto.createHash('sha256').update(pdf).digest('hex');
const materials=Array.from({length:54},(_,i)=>({id:'m'+i,title,description:'Опис матеріалу '+word,topic:'Тема '+word,revision:1,pageCount:3,sha256:hash,size:pdf.length,groupIds:['g0'],testId:'t0'}));
const checks=[],failures=[],pageErrors=[];let state={},journal={},offline=false,role='instructor';
function seed(next){role=next;state={version:1,theme:'light',groups,session:next==='auth'?null:{token:'responsive-fixture',user:{id:next==='cadet'?'c':'i',username:'WindRoy',fullName:'Шевченко-Петренко Олександр Володимирович '+word,role:next,title:'Інструктор',groupName:groups[0].name}},accounts:{}};if(next!=='auth')state.accounts[next==='cadet'?'c':'i']={tests,results,cadets,materials,materialProgress:{},materialSaved:{},fullTests:{t0:fullTest},pending:[],reviews:{r0:[{questionId:'q0',questionText:questions[0].text,selectedAnswerId:'no0',correctAnswerId:'yes0',selectedAnswerText:questions[0].answers[1].text,correctAnswerText:questions[0].answers[0].text,explanation:word}]},run:null,draft:null,capabilities:{multipleChoice:true,writtenTests:true},updatedAt:Date.now()};journal={};offline=false;}
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://local').pathname;res.setHeader('Cache-Control','no-store');
  if(route==='/state'||route==='/journal'){
   if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;const v=JSON.parse(raw);if(route==='/state')state=v;else if((v.serial||0)>(journal.serial||0))journal=v;res.end('{"ok":true}');}else res.end(JSON.stringify(route==='/state'?state:journal));return;
  }
  if(route==='/clock'){res.end(JSON.stringify({ok:true,uptime:1000000+performance.now(),launchId:'responsive-boot'}));return;}
  if(route.startsWith('/updates/')){res.end(JSON.stringify({ok:true,state:2,currentVersion:version.version,currentCode:version.versionCode,message:'Установлено актуальну версію.'}));return;}
  if(route==='/rpc'){
   let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);let b={ok:true};
   if(offline){res.end('{"ok":false,"code":"NETWORK","error":"Тестова мережа недоступна"}');return;}
   if(p.path==='/api/groups')b.groups=groups;
   else if(p.path==='/api/workspace')Object.assign(b,{workspaceProtocol:1,user:state.session.user,revisions:{groups:'g1',tests:'t1',cadets:'c1',results:'r1'},changes:{groups,tests,results,...(role==='instructor'?{cadets}:{})},resultTotal:results.length,snapshotStable:true,capabilities:{multipleChoice:true,writtenTests:true,materials:true,groupArchive:true,bulkAssignment:true,filteredAnalytics:true}});
   else if(p.path==='/api/account-state')Object.assign(b,{accountSyncProtocol:1,userId:state.session.user.id,cursor:'responsive-fixture',documents:[],stable:true});
   else if(p.path==='/api/account-state/document')Object.assign(b,{accountSyncProtocol:1,userId:state.session.user.id,document:{key:p.body.key,revision:(p.body.expectedRevision||0)+1,value:p.body.value??null}});
   else if(['/api/instructor/dashboard','/api/cadet/workspace'].includes(p.path))Object.assign(b,{tests,results,cadets,resultTotal:results.length});
   else if(['/api/instructor/results','/api/my-results'].includes(p.path))b.results=results;
   else if(p.path.startsWith('/api/tests/'))b.test=fullTest;
   else if(p.path==='/api/materials')Object.assign(b,{materials,progress:[]});
   else if(/^\/api\/materials\/m\d+$/.test(p.path))b.material=materials.find(m=>m.id===p.path.split('/').pop());
   else if(p.path.includes('/chunks/')){const batch=+p.path.split('/').pop(),start=batch*16,total=Math.ceil(pdf.length/24576);Object.assign(b,{revision:1,sha256:hash,totalParts:total,parts:Array.from({length:Math.min(16,total-start)},(_,j)=>({index:start+j,data:pdf.subarray((start+j)*24576,Math.min((start+j+1)*24576,pdf.length)).toString('base64')}))});}
   else if(p.path.endsWith('/progress'))b.readers=cadets.map(c=>({...c,lastPage:1,pageCount:3,maxPage:2}));
   else if(p.path==='/api/instructor/question-bank')b.questions=Array.from({length:53},(_,i)=>({id:'b'+i,category:word,authorName:word,question:questions[0]}));
   else if(p.path==='/api/instructor/analytics')Object.assign(b,{attempts:84,average:75,passRate:80,groups:groups.map(g=>({...g,attempts:5,average:75,passed:4}))});
   else if(p.path==='/api/instructor/audit')b.entries=Array.from({length:61},()=>({createdAt:new Date().toISOString(),instructorName:word,action:word,targetName:word,details:word}));
   else if(p.path==='/api/instructor/invite')Object.assign(b,{primary:true,code:'DEMO-CODE',expiresAt:new Date().toISOString()});
   res.end(JSON.stringify(b));return;
  }
  const file=path.resolve(web,route==='/'?'index.html':route.slice(1));if(!file.startsWith(web+path.sep)){res.writeHead(404);res.end();return;}
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.wasm':'application/wasm'};res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(x){failures.push(String(x));res.writeHead(500);res.end('Local test fixture error');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
let ctx,page;const sizes=[{width:1920,height:1080},{width:1366,height:768},{width:1366,height:400},{width:1024,height:600},{width:901,height:700},{width:900,height:700},{width:800,height:600},{width:650,height:900},{width:480,height:480},{width:360,height:640},{width:320,height:480}];
async function open(next){if(ctx){await page.evaluate(()=>localStorage.setItem('lk-pc-window','fixture-reset'));await ctx.close();}seed(next);ctx=await browser.newContext({viewport:{width:1366,height:768},locale:'uk-UA'});page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',x=>pageErrors.push(x.message));await page.goto(origin+'/?key=responsive');await page.locator(next==='auth'?'#auth-form':'.layout').waitFor();await page.waitForTimeout(100);}
async function audit(name){
 assert.doesNotMatch(await page.locator('#app').innerText(),/телефон\p{L}*|мобільн\p{L}*|\bandroid\b|\biphone\b|\bios\b|\bapk\b/iu);
 const d=await page.evaluate(()=>{
  const allowed='.table-wrap,.pdf-scroll,.question-nav,.sidebar-panel';
  const offenders=[...document.querySelectorAll('#app *,dialog[open] *')].filter(el=>{
   if(!(el instanceof HTMLElement)||el.closest(allowed)||!el.getClientRects().length)return false;
   const r=el.getBoundingClientRect();return r.width&&r.height&&(r.left<-.9||r.right>innerWidth+1);
  }).slice(0,10).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,60),left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right)}));
  const m=document.querySelector('dialog[open]'),r=m?.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,offenders,modal:r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom}:null,height:innerHeight};
 });
 if(process.env.LITAKOVA_RESPONSIVE_BASELINE){console.log(JSON.stringify({name,...d},null,2));return;}
 assert.ok(d.scrollWidth<=d.width+1,`${name}: whole window scrolls horizontally ${JSON.stringify(d)}`);assert.deepEqual(d.offenders,[],`${name}: controls or text extend outside the window`);
 if(d.modal){assert.ok(d.modal.left>=0&&d.modal.right<=d.width+1&&d.modal.top>=0&&d.modal.bottom<=d.height+1,name+' dialog must fit the visible window');}
 checks.push(name);
}
async function allSizes(name){for(const size of sizes){await page.setViewportSize(size);await audit(name+` ${size.width}×${size.height}`);}}
async function navigate(next){await page.evaluate(async n=>(await import('/app.js')).navigate(n),next);}
const action=act=>page.locator(`button[data-action="${act}"]`).first().click();
try{
 await open('instructor');
 if(process.env.LITAKOVA_RESPONSIVE_VISUAL){for(const size of [{width:1366,height:768},{width:650,height:900},{width:320,height:480}]){await page.setViewportSize(size);await page.screenshot({path:path.join(root,'../tmp',`responsive-${size.width}.png`)});}await page.setViewportSize({width:650,height:900});await action('toggle-menu');await page.screenshot({path:path.join(root,'../tmp/responsive-menu.png')});}
 else if(process.env.LITAKOVA_RESPONSIVE_BASELINE){await page.setViewportSize({width:650,height:900});await audit('Original layout at screenshot width');}
 else{
  await allSizes('Instructor home');await action('theme');await page.setViewportSize({width:650,height:800});await audit('Dark theme at narrow width');await action('theme');
  for(const section of ['tests','groups','cadets','results','bank','more','materials']){await navigate(section);await allSizes('Instructor '+section);}
  for(const section of ['analytics','audit']){await navigate('more');await action(section);await allSizes('Instructor '+section);}
  await navigate('cadets');await page.setViewportSize({width:360,height:640});const table=page.locator('.table-wrap');await table.focus();await page.keyboard.press('End');await table.evaluate(el=>el.scrollLeft=el.scrollWidth);const last=page.locator('[data-action=delete-cadet]').first();await last.scrollIntoViewIfNeeded();const rect=await last.boundingBox();assert.ok(rect&&rect.x>=0&&rect.x+rect.width<=360,'Table actions must remain reachable through their own scroll area');checks.push('Narrow tables scroll locally and preserve their last action');
  await navigate('home');await page.setViewportSize({width:1366,height:400});const exit=page.locator('.sidebar-footer [data-action=logout]');await exit.scrollIntoViewIfNeeded();const exitRect=await exit.boundingBox();assert.ok(exitRect&&exitRect.y>=0&&exitRect.y+exitRect.height<=400,'Short desktop sidebar must scroll to its footer');checks.push('A short desktop window keeps all sidebar actions reachable');
  await navigate('tests');await action('new-test');await page.locator('[data-draft=title]').fill('Чернетка збережена при зміні розміру');await allSizes('Test editor and question controls');assert.equal(await page.locator('[data-draft=title]').inputValue(),'Чернетка збережена при зміні розміру');
  await page.locator('[data-question="0"][data-prop=text]').fill('Питання банку '+word);await page.locator('[data-answer="0"][data-a="0"]').fill('Перший варіант');await page.locator('[data-answer="0"][data-a="1"]').fill('Другий варіант');await action('bank-save');await page.locator('dialog[open]').waitFor();for(const size of [{width:650,height:600},{width:360,height:480},{width:320,height:360}]){await page.setViewportSize(size);await audit(`Bank save dialog ${size.width}×${size.height}`);const button=page.locator('#modal button').last();await button.scrollIntoViewIfNeeded();const r=await button.boundingBox();assert.ok(r&&r.x>=0&&r.x+r.width<=size.width+1&&r.y>=0&&r.y+r.height<=size.height+1);}await action('cancel-modal');
  for(const [section,act]of [['tests','import'],['groups','add-group'],['cadets','add-cadet'],['cadets','cadet-group'],['cadets','delete-cadet'],['results','group-statement'],['materials','material-new'],['materials','material-readers']]){
   await navigate(section);await action(act);await page.locator('dialog[open]').waitFor();for(const size of [{width:650,height:600},{width:360,height:480},{width:320,height:360}]){await page.setViewportSize(size);await audit(act+` dialog ${size.width}×${size.height}`);const button=page.locator('#modal button').last();await button.scrollIntoViewIfNeeded();const r=await button.boundingBox();assert.ok(r&&r.x>=0&&r.x+r.width<=size.width+1&&r.y>=0&&r.y+r.height<=size.height+1,act+' footer action must be reachable');}await action('cancel-modal');
  }
  await navigate('tests');await action('preview');await allSizes('Instructor test preview');
  await navigate('materials');await action('material-open');await page.locator('#material-page').filter({hasText:'1 / 3'}).waitFor();
  for(const size of [{width:1366,height:768},{width:650,height:900},{width:320,height:480},{width:800,height:360}]){
   await page.setViewportSize(size);await page.waitForTimeout(400);await audit(`PDF viewer ${size.width}×${size.height}`);
   const fit=await page.locator('.pdf-scroll').evaluate(el=>({wrap:el.getBoundingClientRect().width,canvas:el.querySelector('canvas').getBoundingClientRect().width,height:el.clientHeight,canvasHeight:el.querySelector('canvas').getBoundingClientRect().height}));assert.ok(fit.canvas<=fit.wrap-10&&fit.canvasHeight<=fit.height-10,`PDF must re-fit after resizing: ${JSON.stringify(fit)}`);
  }
  await action('material-plus');await page.setViewportSize({width:360,height:480});await page.waitForTimeout(400);assert.equal(await page.locator('#material-zoom').textContent(),'125%');await audit('PDF preserves explicit zoom after resize');await action('material-close');
  await navigate('home');await page.setViewportSize({width:650,height:800});
  const menu=page.locator('[data-action=toggle-menu]');assert.equal(await menu.isVisible(),true);await menu.click();assert.equal(await menu.getAttribute('aria-expanded'),'true');
  for(const next of ['tests','materials','groups','cadets','results','bank','more','home']){if(await menu.getAttribute('aria-expanded')==='false')await menu.click();const button=page.locator(`.nav [data-page=${next}]`);await button.scrollIntoViewIfNeeded();await button.click();assert.equal(await menu.getAttribute('aria-expanded'),'false');await audit('Compact menu opens '+next);}
  await page.setViewportSize({width:320,height:360});for(const next of ['tests','materials','groups','cadets','results','bank','more','home']){if(await menu.getAttribute('aria-expanded')==='false')await menu.click();const b=page.locator(`.nav [data-page=${next}]`);await b.scrollIntoViewIfNeeded();await b.click();await audit('Short compact menu opens '+next);}
  await menu.click();await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');assert.equal(await menu.evaluate(el=>el===document.activeElement),true);checks.push('Compact menu supports Escape and returns keyboard focus');
  await menu.click();await page.locator('.sidebar-footer [data-action=logout]').scrollIntoViewIfNeeded();assert.equal(await page.locator('.sidebar-footer [data-action=logout]').isVisible(),true);checks.push('Compact menu keeps profile and logout reachable');
  await open('cadet');for(const section of ['home','tests','results','more','materials']){await navigate(section);await allSizes('Cadet '+section);}
  await navigate('results');await action('review-result');await allSizes('Cadet result and answer review');
  await navigate('tests');await action('start');await page.locator('#modal button.primary').click();await page.locator('.runner').waitFor();await allSizes('Cadet test runner');await page.locator('[data-run-answer]').first().check();const answer=await page.locator('[data-run-answer]').first().getAttribute('data-run-answer');await page.setViewportSize({width:1366,height:768});assert.equal(await page.locator('[data-run-answer]').first().isChecked(),true);checks.push('Resizing preserves the current answer');offline=true;await page.evaluate(async()=>(await import('/app.js')).finishRun(false));await allSizes('Cadet queued result');assert.equal(Object.values(state.accounts).find(a=>a.pending.length)?.pending.length,1);checks.push('A test finished after resizing remains in the durable queue');
  await open('auth');await allSizes('Sign in');await action('auth-mode');await allSizes('Instructor registration');await page.locator('[data-role=cadet]').click();await allSizes('Cadet registration');
  assert.deepEqual(failures,[]);assert.deepEqual(pageErrors,[]);
  const report={version:version.version,status:'passed',passed:checks.length,checks,viewports:sizes,pageErrors,testedAt:new Date().toISOString(),browser:await browser.version(),data:'Synthetic local UI fixtures only',actualWindowsRuntimeVerified:false};fs.writeFileSync(path.join(root,'verification/responsive-ui.json'),JSON.stringify(report,null,2)+'\n');console.log(`Responsive UI: ${checks.length} checks passed.`);
 }
}catch(x){console.error(x);console.error('Body:',(await page.locator('body').textContent()).slice(-1300));console.error(pageErrors,failures);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.close(r));}
