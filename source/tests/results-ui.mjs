// Actual desktop UI, synthetic accounts only. No requests reach a live service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../',import.meta.url).pathname,web=path.join(root,'web');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const groups=[{id:'g1',name:'Група 1'},{id:'g2',name:'Група 2'}];
const names=['Іваненко Денис','Петренко Олег','Коваленко Андрій','Мельник Максим','Романюк Ігор'];
const cadets=Array.from({length:27},(_,i)=>({id:'c'+(i+1),username:'cadet_'+(i+1),fullName:names[i]||'Курсант Навчальний '+String(i+1).padStart(2,'0'),groupName:'Група 1',role:'cadet',active:true}));
const tests=['Вхідний контроль','Проміжний тест','Підсумковий тест'].map((title,i)=>({id:'t'+(i+1),title,published:true,questionCount:20,description:'',mode:'training'}));
const make=(user,test,correct,extra={})=>({id:'r'+user+test,userId:'c'+user,userName:cadets[user-1].fullName,groupName:'Група 1',testId:'t'+test,testTitle:tests[test-1].title,total:20,choiceTotal:20,correct,score:correct*5,passed:correct>=14,durationSeconds:480+user*12,completedAt:'2026-10-27T10:00:00Z',earnedPoints:correct,maxPoints:20,gradingRevision:0,...extra});
const results=[make(1,1,18,{durationSeconds:36009}),make(1,2,17,{durationSeconds:0}),make(2,1,20),make(2,2,15),make(3,1,0),make(4,3,5,{total:11,choiceTotal:10,gradingStatus:'pending_review',pendingWritten:1,score:null,passed:null}),make(5,3,0,{total:1,choiceTotal:0,gradingStatus:'pending_review',pendingWritten:1,score:null,passed:null})];
const recoveries=[{id:'recovery-1',userName:'Савченко Ірина',groupName:'Група 2',testId:'t2',testTitle:tests[1].title,durationSeconds:123}];
const user={id:'teacher',username:'WindRoy',fullName:'Розробник',role:'instructor'};
let state={version:1,theme:'light',session:{token:'local-results-fixture',user},groups,accounts:{teacher:{tests,results,cadets,fullTests:{},pending:[],reviews:{},resultTotal:results.length}}},journal={},truncated=false,deletionEnabled=false,resultRevision=1;
const calls=[],errors=[],checks=[];
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://local').pathname;res.setHeader('Cache-Control','no-store');
  if(route==='/state'||route==='/journal'){
   if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;const value=JSON.parse(raw);if(route==='/state')state=value;else journal=value;res.end('{"ok":true}');}else res.end(JSON.stringify(route==='/state'?state:journal));return;
  }
  if(route==='/clock'){res.end(JSON.stringify({ok:true,uptime:1000000+performance.now(),launchId:'results-ui'}));return;}
  if(route.startsWith('/updates/')){res.end(JSON.stringify({ok:true,state:2,currentVersion:version.version,currentCode:version.versionCode,message:'Установлено актуальну версію.'}));return;}
  if(route==='/rpc'){
   let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);calls.push(p);let reply={ok:true};
   if(p.path==='/api/groups')reply.groups=groups;
   else if(p.path==='/api/instructor/reviews')Object.assign(reply,{results:results.filter(result=>Number(result.pendingWritten)>0),resultsRevision:'r'+resultRevision});
   else if(p.path==='/api/instructor/exam-recoveries')Object.assign(reply,{recoveries});
   else if(p.path==='/api/instructor/review-presence')Object.assign(reply,{sessions:[],serverNow:Date.now(),resultsRevision:'r'+resultRevision,stable:true});
   else if(p.path==='/api/workspace')Object.assign(reply,{workspaceProtocol:1,user,revisions:{groups:'g1',tests:'t1',cadets:'c1',results:'r'+resultRevision+':'+(p.body.allResults?'all':'recent')},changes:{groups,tests,cadets,results:truncated?results.slice(0,2):results},resultTotal:truncated?10000:results.length,resultScope:p.body.allResults?'all':'recent',snapshotStable:true,capabilities:{writtenTests:true,multipleChoice:true,resultDeletion:deletionEnabled}});
   else if(p.method==='DELETE'&&/^\/api\/instructor\/results\/[^/]+$/.test(p.path)){
    const resultId=p.path.split('/').at(-1),index=results.findIndex(result=>result.id===resultId);
    assert.equal(p.body.confirmResultId,resultId);
    assert.ok(deletionEnabled&&index>=0);
    results.splice(index,1);resultRevision++;
    Object.assign(reply,{deleted:true,resultId});
   }
   else if(p.path==='/api/account-state')Object.assign(reply,{accountSyncProtocol:1,userId:user.id,cursor:'results-ui',documents:[],stable:true});
   else if(p.path==='/api/account-state/document')Object.assign(reply,{accountSyncProtocol:1,userId:user.id,document:{key:p.body.key,revision:1,value:p.body.value??null}});
   else if(p.path.endsWith('/review-session'))Object.assign(reply,{ok:false,code:'NOT_FOUND',error:'Fixture server without shared review sessions'});
   else if(/^\/api\/results\/[^/]+\/review$/.test(p.path)){
    const result=results.find(r=>r.id===p.path.split('/')[3]);
    Object.assign(reply,{result,review:[{questionId:'q1',type:'choice',questionText:'Приклад питання',selectedAnswerId:'a',correctAnswerId:'a',selectedAnswerText:'Обраний варіант',correctAnswerText:'Обраний варіант',isCorrect:true}]});
   }else throw Error('Unexpected API fixture request: '+p.path);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));return;
  }
  const file=path.resolve(web,route==='/'?'index.html':route.slice(1));if(!file.startsWith(web+path.sep)){res.writeHead(404);res.end();return;}
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(x){errors.push(String(x));res.writeHead(500);res.end('Local test fixture error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
const click=action=>page.locator(`[data-action="${action}"]`).first().click();
async function view(mode){await page.locator(`[data-action="results-view"][data-view="${mode}"]`).click();await page.waitForFunction(value=>document.querySelector(`[data-action="results-view"][data-view="${value}"]`)?.getAttribute('aria-selected')==='true',mode);}
async function refreshed(){await page.locator('.topbar [data-action="refresh"]:not([disabled])').waitFor();}
async function fit(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.LITAKOVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1440,height:1000},locale:'uk-UA'});page.setDefaultTimeout(12000);page.on('pageerror',x=>errors.push(x.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?key=results-ui`);await page.locator('.layout').waitFor();await refreshed();
 await page.locator('.nav [data-page="results"]').click();await page.locator('.compact-results').waitFor();await refreshed();
 await check('One sidebar section contains three accessible results and review tabs',async()=>{
  assert.equal(await page.locator('.nav [data-page="results"]').count(),1);
  assert.equal(await page.locator('.nav [data-page="reviews"]').count(),0);
  await page.getByRole('heading',{name:'Результати та перевірка',exact:true}).waitFor();
  assert.equal(await page.getByRole('tab').count(),3);
  for(const name of ['Усі результати','Очікують перевірки','Рейтинг'])assert.equal(await page.getByRole('tab',{name:new RegExp(name)}).count(),1);
  assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'),'results-tab-compact');
  await page.screenshot({path:path.join(root,'verification/results-workspace-all.png'),fullPage:true});
 });
 await check('The pending tab searches written work and recovered exams with shared group and test filters',async()=>{
  await view('pending');await page.waitForFunction(()=>document.querySelectorAll('.review-queue-item').length===3);
  assert.equal(await page.locator('#pending-review-count').innerText(),'3');
  assert.equal(await page.locator('[data-action="export-csv"]').count(),0);
  await page.locator('#shared-group').selectOption('g2');await page.locator('.recovery-queue-item').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.review-queue-item').length===1);
  assert.equal(await page.locator('#pending-review-count').innerText(),'1');
  await page.locator('#filter').fill('Савченко');assert.equal(await page.locator('.recovery-queue-item').count(),1);
  await page.locator('#shared-test').selectOption('t3');await page.getByRole('heading',{name:'Немає неперевірених робіт',exact:true}).waitFor();
  await page.locator('#filter').fill('');await click('reset-filters');await page.waitForFunction(()=>document.querySelectorAll('.review-queue-item').length===3);
  await page.screenshot({path:path.join(root,'verification/results-pending.png'),fullPage:true});
 });
 await check('Reviewing a work returns to the same pending tab, search, group and test',async()=>{
  await page.locator('#shared-group').selectOption('g1');await page.locator('#shared-test').selectOption('t3');await page.locator('#filter').fill('Романюк');
  await page.locator('[data-action="grade-result"][data-id="r53"]').click();await page.getByRole('heading',{name:'Перегляд роботи',exact:true}).waitFor();
  assert.equal(await page.locator('.nav [data-page="results"]').getAttribute('aria-current'),'page');
  await page.locator('.page-head [data-page="results"]').click();await page.locator('.review-queue-item').waitFor();
  assert.equal(await page.locator('[data-view="pending"]').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#shared-group').inputValue(),'g1');assert.equal(await page.locator('#shared-test').inputValue(),'t3');assert.equal(await page.locator('#filter').inputValue(),'Романюк');
  assert.equal(await page.locator('.review-queue-item').count(),1);
  await page.locator('#filter').fill('');await click('reset-filters');await view('compact');
 });
 await check('Keyboard arrows switch tabs and keep focus on the active tab',async()=>{
  await page.locator('#results-tab-compact').focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.activeElement?.id==='results-tab-pending'&&document.activeElement.getAttribute('aria-selected')==='true');
  await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.activeElement?.id==='results-tab-ranking'&&document.activeElement.getAttribute('aria-selected')==='true');
  await page.keyboard.press('Home');await page.waitForFunction(()=>document.activeElement?.id==='results-tab-compact'&&document.activeElement.getAttribute('aria-selected')==='true');
 });
 await check('The unified pending queue fits narrow and wide windows in both themes',async()=>{
  await view('pending');await page.locator('.review-queue-item').first().waitFor();
  for(const dark of [false,true]){
   if(dark)await click('theme');
   for(const width of [1920,1440,1024,800,640,480,320]){await page.setViewportSize({width,height:900});await fit();}
   if(dark){await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(root,'verification/results-pending-dark.png'),fullPage:true});await click('theme');}
  }
  await page.setViewportSize({width:480,height:900});await page.screenshot({path:path.join(root,'verification/results-pending-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await view('compact');await refreshed();
 });
 await check('Compact view has five columns, including known zero and pending written scores',async()=>{
  assert.deepEqual(await page.locator('.compact-results thead th').allTextContents(),['ПІБ курсанта','Правильні','Помилки','Результат','Час']);
  const pending=page.locator('.compact-results tr').filter({hasText:'Романюк Ігор'});assert.match(await pending.innerText(),/Очікує перевірки/);assert.equal(await pending.locator('td').nth(1).innerText(),'—');
  const zero=page.locator('.compact-results tr').filter({hasText:'Коваленко Андрій'});assert.equal(await zero.locator('td').nth(1).innerText(),'0');
 });
 await page.locator('#shared-group').selectOption('g1');await page.locator('#shared-test').selectOption('t1');await refreshed();
 await check('Selecting a group and test removes repeated context without removing review access',async()=>{
  await page.waitForFunction(()=>document.querySelectorAll('.compact-results tbody tr').length===3);assert.equal(await page.locator('.compact-results tbody tr').count(),3);
  const first=page.locator('.compact-results tbody tr').first();assert.equal(await first.locator('td').first().innerText(),names[0]);
  await first.locator('[data-action="grade-result"]').click();await page.getByRole('heading',{name:'Перегляд роботи',exact:true}).waitFor();await page.locator('.page-head [data-page="results"]').click();await page.locator('.compact-results').waitFor();
 });
 await check('Compact CSV contains exactly the searched group and test results',async()=>{
  await page.locator('#filter').fill('Іваненко');const [download]=await Promise.all([page.waitForEvent('download'),click('export-csv')]);
  const file=path.join(root,'verification/results-filtered.csv');await download.saveAs(file);const text=fs.readFileSync(file,'utf8');assert.match(text,/Іваненко/);assert.doesNotMatch(text,/Петренко/);assert.doesNotMatch(text,/Проміжний тест/);
 });
 await page.locator('#filter').fill('');await page.screenshot({path:path.join(root,'verification/results-compact.png'),fullPage:true});
 await view('ranking');await page.locator('.group-ranking').waitFor();await refreshed();
 await check('Ranking ignores the previously selected single test and shows all 27 cadets',async()=>{
  assert.equal(await page.locator('#shared-test').count(),0);assert.equal(await page.locator('.group-ranking tbody tr').count(),27);assert.equal(await page.locator('.group-ranking thead th').count(),6);
  const first=page.locator('.group-ranking tbody tr').filter({hasText:names[0]});assert.equal(await first.locator('.ranking-total').innerText(),'35');assert.equal(await first.locator('td').first().innerText(),'1');
  const second=page.locator('.group-ranking tbody tr').filter({hasText:names[1]});assert.equal(await second.locator('td').first().innerText(),'1');
  assert.ok(calls.some(p=>p.path==='/api/workspace'&&p.body.allResults===true));
 });
 await check('The total is next to the cadet name and the group summary includes all 27 cadets',async()=>{
  const headers=await page.locator('.group-ranking thead th').allTextContents();
  assert.deepEqual(headers.slice(0,2),['Місце','ПІБ курсанта']);assert.match(headers[2],/^Правильних/);
  assert.deepEqual(await page.locator('.ranking-overview strong').allTextContents(),['27','3','0','35']);
  assert.match(await page.locator('.group-ranking tbody tr').filter({hasText:names[0]}).innerText(),/Пройдено: 2 із 3/);
  const zero=page.locator('.group-ranking tbody tr').filter({hasText:names[2]});
  assert.equal(await zero.locator('.ranking-total').innerText(),'0');assert.equal(await zero.locator('.ranking-points strong').first().innerText(),'0');
  assert.ok(await zero.getByText('Не пройдено',{exact:true}).count()>0);
 });
 await check('Opening a test cell preserves access to the submitted work',async()=>{
  await page.locator('.group-ranking tbody tr').filter({hasText:names[0]}).locator('.ranking-result-button').first().click();
  await page.getByRole('heading',{name:'Перегляд роботи',exact:true}).waitFor();
  await page.locator('.page-head [data-page="results"]').click();await page.locator('.group-ranking').waitFor();
 });
 await check('Place, name and total remain visible while the tests scroll, and headers stay above rows',async()=>{
  await page.setViewportSize({width:1024,height:700});await refreshed();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const table=page.locator('.group-ranking');await table.evaluate(el=>el.scrollIntoView({block:'nearest'}));
  const first=table.locator('tbody tr').first();
  const fixed=['.ranking-place','.ranking-person','.ranking-total'];
  const before=await Promise.all(fixed.map(selector=>first.locator(selector).boundingBox()));
  await table.evaluate(el=>{el.scrollLeft=el.scrollWidth;el.scrollTop=160;});await page.waitForTimeout(100);
  const after=await Promise.all(fixed.map(selector=>first.locator(selector).boundingBox()));
  for(let i=0;i<fixed.length;i++){assert.ok(Math.abs(before[i].x-after[i].x)<2);if(i)assert.ok(after[i].x>=after[i-1].x+after[i-1].width-2);}
  const region=await table.boundingBox(),header=await table.locator('thead').boundingBox(),firstHeader=await table.locator('thead th').first().boundingBox();
  assert.ok(Math.abs(firstHeader.y-region.y-1)<2);
  assert.ok(await table.evaluate(el=>el.scrollLeft>0&&el.scrollTop>0));
  await table.evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});await page.setViewportSize({width:1440,height:1000});
 });
 await check('Ranking search retains the real place and spreadsheet export matches the search',async()=>{
  await page.locator('#filter').fill('Коваленко');assert.equal(await page.locator('.group-ranking tbody tr').count(),1);assert.equal(await page.locator('.group-ranking tbody tr td').first().innerText(),'4');
  assert.deepEqual(await page.locator('.ranking-overview strong').allTextContents(),['27','3','0','35']);
  const [download]=await Promise.all([page.waitForEvent('download'),click('export-ranking')]);const file=path.join(root,'verification/ranking-filtered.csv');await download.saveAs(file);const text=fs.readFileSync(file,'utf8');assert.match(text,/Коваленко/);assert.doesNotMatch(text,/Іваненко/);assert.equal(text.split('\r\n').length,2);
 });
 await page.locator('#filter').fill('');await page.screenshot({path:path.join(root,'verification/results-ranking.png'),fullPage:true});
 await check('Both light and dark result views fit normal, narrow, and short PC windows',async()=>{
  for(const mode of ['ranking','compact']){
   await view(mode);for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:1366,height:400},{width:1024,height:600},{width:800,height:600},{width:640,height:480},{width:480,height:640},{width:320,height:480}]){await page.setViewportSize(size);await fit();}
   await click('theme');await fit();await click('theme');
  }
 });
 await page.setViewportSize({width:1440,height:1000});
 await check('Selected compact test survives switching to ranking and back',async()=>{assert.equal(await page.locator('#shared-test').inputValue(),'t1');});
 await check('An empty selected group shows an empty ranking without borrowing another group',async()=>{
  await view('ranking');await page.locator('#shared-group').selectOption('g2');await page.getByRole('heading',{name:'Курсантів не знайдено',exact:true}).waitFor();assert.equal(await page.locator('.group-ranking').count(),0);
 });
 await check('Resetting the group prevents an unscoped ranking or spreadsheet export',async()=>{
  await click('reset-filters');await page.getByRole('heading',{name:'Оберіть групу для рейтингу',exact:true}).waitFor();await click('export-ranking');await page.locator('#toast').filter({hasText:'Оберіть групу для рейтингу'}).waitFor();
 });
 await check('Truncated history is never presented or exported as a complete ranking',async()=>{
  truncated=true;await page.locator('#shared-group').selectOption('g1');await click('refresh');await refreshed();await page.getByRole('heading',{name:'Потрібна повна історія результатів',exact:true}).waitFor();assert.equal(await page.locator('.group-ranking').count(),0);await click('export-ranking');await page.locator('#toast').filter({hasText:'Спочатку оновіть повну історію'}).waitFor();truncated=false;await click('refresh');await refreshed();await page.locator('.group-ranking').waitFor();
 });
 await check('The preferred results view and group survive restarting the application window',async()=>{
  await page.reload();await page.locator('.layout').waitFor();await page.locator('.nav [data-page="results"]').click();await page.locator('.group-ranking').waitFor();assert.equal(await page.locator('#shared-group').inputValue(),'g1');
 });
 await check('Time and delete controls keep separate columns at every supported window width',async()=>{
  await view('compact');await click('reset-filters');
  deletionEnabled=true;await click('refresh');await refreshed();
  assert.deepEqual(await page.locator('.compact-results thead th').allTextContents(),['ПІБ курсанта','Правильні','Помилки','Результат','Час','Дії']);
  for(const dark of [false,true]){
   if(dark)await click('theme');
   for(const width of [1920,1440,1280,1024,800,640,480,320]){
    await page.setViewportSize({width,height:900});await fit();
    await page.locator('.compact-results table').waitFor({state:'visible'});
    const layout=await page.evaluate(()=>{
     const table=document.querySelector('.compact-results table');
     const bounds=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width};};
     const textBounds=el=>{const range=document.createRange();range.selectNodeContents(el);return [...range.getClientRects()].filter(r=>r.width>0).map(r=>({left:r.left,right:r.right,width:r.width}));};
     const headers=[...table.querySelectorAll('thead th')],row=table.querySelector('tbody tr'),time=row.cells[4],actions=row.cells[5],button=actions.querySelector('button');
     return {time:bounds(time),actions:bounds(actions),button:bounds(button),timeText:textBounds(time),timeHeading:textBounds(headers[4]),actionsHeading:textBounds(headers[5])};
    });
    assert.ok(layout.time.width>=90,`Time column collapsed at ${width}px: ${JSON.stringify(layout)}`);
    assert.ok(layout.actions.width>=70,`Delete column too narrow at ${width}px`);
    assert.equal(layout.timeText.length,1,`Time wraps at ${width}px`);
    assert.equal(layout.timeHeading.length,1,`Time heading wraps at ${width}px`);
    assert.equal(layout.actionsHeading.length,1,`Actions heading wraps at ${width}px`);
    assert.ok(layout.timeText[0].left>=layout.time.left&&layout.timeText[0].right<=layout.time.right,`Time overflows its cell at ${width}px`);
    assert.ok(layout.time.right<=layout.actions.left+1&&layout.button.left>=layout.actions.left&&layout.button.right<=layout.actions.right,`Delete button overlaps time at ${width}px`);
   }
   if(dark)await click('theme');
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(root,'verification/results-actions-layout.png'),fullPage:true});
 });
 await check('Confirming one result deletion removes only the selected work',async()=>{
  await view('compact');await click('reset-filters');
  deletionEnabled=true;await click('refresh');await refreshed();
  const target=page.locator('[data-action="delete-result"][data-id="r11"]');
  await target.click();
  const dialog=page.locator('dialog[open]');
  await dialog.getByRole('heading',{name:'Видалити результат?'}).waitFor();
  assert.match(await dialog.innerText(),/Іваненко Денис.*Вхідний контроль/s);
  await dialog.getByRole('button',{name:'Скасувати'}).click();
  assert.equal(calls.filter(call=>call.method==='DELETE').length,0);
  await target.click();
  await dialog.getByRole('button',{name:'Видалити результат',exact:true}).click();
  await target.waitFor({state:'detached'});
  await page.locator('[data-action="delete-result"][data-id="r21"]').waitFor();
  assert.deepEqual(calls.filter(call=>call.method==='DELETE').map(call=>call.path),['/api/instructor/results/r11']);
  await refreshed();
 });
 assert.ok(calls.some(call=>call.path==='/api/instructor/reviews'),'The current review queue route must be exercised');
 assert.ok(calls.some(call=>call.path==='/api/instructor/exam-recoveries'),'The current exam recovery route must be exercised');
 assert.deepEqual(errors,[]);
}finally{
 fs.mkdirSync(path.join(root,'verification'),{recursive:true});fs.writeFileSync(path.join(root,'verification/results-ui.json'),JSON.stringify({status:errors.length||checks.length<21?'failed':'passed',passed:checks.length,checks,errors},null,2)+'\n');
 await browser?.close();await new Promise(resolve=>server.close(resolve));
}
