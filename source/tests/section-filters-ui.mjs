// Actual application UI with isolated local data; no production requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../',import.meta.url).pathname,web=path.join(root,'web');
const groups=[{id:'g1',name:'Група 1'},{id:'g2',name:'Група 2'}];
const assigned=name=>'[[LK-GROUPS:'+Buffer.from(JSON.stringify([name])).toString('base64')+']]';
const tests=[{id:'t1',title:'Спільна назва',description:assigned('Група 1')},{id:'t2',title:'Спільна назва',description:assigned('Група 2')},{id:'t3',title:'Загальний курс',description:''},{id:'t4',title:'Для першої групи',description:assigned('Група 1')}].map(t=>({...t,published:true,mode:'training',passingPercent:70,questionCount:3}));
const cadets=Array.from({length:4},(_,i)=>({id:'c'+i,username:'cadet'+i,fullName:'Навчальний Курсант '+i,role:'cadet',groupName:groups[i%2].name,active:true}));
const results=groups.map((g,i)=>({id:'r'+i,userId:'c'+i,userName:cadets[i].fullName,groupName:g.name,testId:'t'+(i+1),testTitle:'Спільна назва',correct:2,total:3,choiceTotal:3,score:67,passed:false,durationSeconds:180,completedAt:'2026-11-08T12:00:00Z'}));
const materials=[{id:'m1',title:'Посібник першої групи',groupIds:['g1'],testId:'t1'},{id:'m2',title:'Посібник другої групи',groupIds:['g2'],testId:'t2'},{id:'m3',title:'Загальний посібник',groupIds:['g1','g2'],testId:''}].map(m=>({...m,topic:'Підготовка',description:'Навчальний матеріал',revision:1,pageCount:3,size:1024,sha256:'a'.repeat(64)}));
const user={id:'teacher',username:'teacher',fullName:'Інструктор перевірки',role:'instructor'};
let state={version:1,theme:'light',session:{token:'section-filter-fixture',user},groups,accounts:{teacher:{tests,cadets,results,materials,fullTests:{},pending:[],reviews:{},resultTotal:results.length,sharedFilters:{groupId:'g1',testId:'t1'}}}},journal={};
const calls=[],errors=[],checks=[];
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');
  if(['/state','/journal'].includes(route)){
   if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;if(route==='/state')state=JSON.parse(raw);else journal=JSON.parse(raw);res.end('{"ok":true}');}
   else res.end(JSON.stringify(route==='/state'?state:journal));return;
  }
  if(route==='/clock'){res.end(JSON.stringify({ok:true,uptime:1000000+performance.now(),launchId:'section-filters'}));return;}
  if(route.startsWith('/updates/')){res.end('{"ok":true,"state":2,"message":"Актуальна версія"}');return;}
  if(route==='/rpc'){
   let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);calls.push(p);let reply={ok:true};
   if(p.path==='/api/workspace')Object.assign(reply,{workspaceProtocol:1,user,revisions:{groups:'g1',tests:'t1',cadets:'c1',results:'r1'},changes:{groups,tests,cadets,results},resultTotal:results.length,resultScope:p.body.allResults?'all':'recent',snapshotStable:true,capabilities:{filteredAnalytics:true,materials:true}});
   else if(p.path==='/api/groups')reply.groups=groups;
   else if(p.path==='/api/instructor/results')reply.results=results;
   else if(p.path==='/api/instructor/reviews')Object.assign(reply,{results:[],resultsRevision:'r1'});
   else if(p.path==='/api/instructor/exam-recoveries')reply.recoveries=[];
   else if(p.path==='/api/materials')Object.assign(reply,{materials,progress:[]});
   else if(p.path==='/api/instructor/instructors')reply.instructors=[{...user,active:true}];
   else if(p.path==='/api/instructor/analytics'){
    const rows=results.filter(r=>(!p.body.groupName||r.groupName===p.body.groupName)&&(!p.body.testId||r.testId===p.body.testId));
    Object.assign(reply,{attempts:rows.length,average:67,passRate:0,groups:groups.filter(g=>rows.some(r=>r.groupName===g.name)).map(g=>({name:g.name,attempts:1,average:67,passed:0})),hardestQuestions:[]});
   }else if(p.path==='/api/account-state')Object.assign(reply,{accountSyncProtocol:1,userId:user.id,cursor:'filters',documents:[],stable:true});
   else if(p.path==='/api/account-state/document')Object.assign(reply,{accountSyncProtocol:1,userId:user.id,document:{key:p.body.key,revision:1,value:p.body.value??null}});
   else throw Error('Unexpected fixture request: '+p.path);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));return;
  }
  const file=path.resolve(web,route==='/'?'index.html':route.slice(1));if(!file.startsWith(web+path.sep)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(x){errors.push(String(x));res.writeHead(500);res.end('Local fixture error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;
const click=action=>page.locator(`[data-action="${action}"]`).first().click();
async function nav(name){await page.evaluate(async name=>(await import('/app.js')).navigate(name),name);}
async function settled(){await page.locator('.topbar [data-action="refresh"]:not([disabled])').waitFor();}
async function count(selector,n){await page.waitForFunction(({selector,n})=>document.querySelectorAll(selector).length===n,{selector,n});}
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
async function analyticsPage(){await nav('more');await click('analytics');await page.getByRole('heading',{name:'Аналітика',exact:true}).waitFor();}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.LITAKOVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1440,height:1000},locale:'uk-UA'});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?key=section-filters`);await page.locator('.layout').waitFor();await settled();
 await check('One update button shares a single workspace and account sync across repeated clicks',async()=>{
  assert.equal(await page.locator('.topbar [data-action="sync-account"]').count(),0);assert.equal(await page.locator('.topbar [data-action="refresh"]').count(),1);await page.waitForFunction(()=>document.querySelector('.topbar [data-action="refresh"]:not([disabled])')?.textContent.includes('Оновити дані'));
  const first=calls.length;await page.evaluate(async()=>{const m=await import('/app.js'),button=document.querySelector('.topbar [data-action="refresh"]');await Promise.all([m.clickAction(button),m.clickAction(button),m.clickAction(button)]);});
  const delta=calls.slice(first);assert.equal(delta.filter(p=>p.path==='/api/workspace').length,1);assert.equal(delta.filter(p=>p.path==='/api/account-state').length,1);
 });
 await check('Home shows the complete overview without inheriting the old shared filters',async()=>{
  assert.equal(await page.locator('#shared-group,#shared-test,.shared-filters').count(),0);
  assert.deepEqual(await page.locator('.cards .value').allTextContents(),['4','4','2','2']);
  assert.equal(calls.find(p=>p.path==='/api/workspace').body.allResults,false);
  await page.screenshot({path:path.join(root,'verification/section-filters-home.png'),fullPage:true});
 });
 await check('Upgrade retains legacy group and test selection only in Results',async()=>{
  await nav('results');await settled();assert.equal(await page.locator('#shared-group').inputValue(),'g1');assert.equal(await page.locator('#shared-test').inputValue(),'t1');await count('.compact-results tbody tr',1);
  assert.match(await page.locator('#shared-test option:checked').innerText(),/#t1/);
 });
 await check('Tests have an independent group and name search without a redundant test selector',async()=>{
  await nav('tests');assert.equal(await page.locator('#shared-group').inputValue(),'');assert.equal(await page.locator('#shared-test').count(),0);await count('#test-list .test-card',4);
  await page.locator('#shared-group').selectOption('g2');await count('#test-list .test-card',2);await page.locator('#filter').fill('Загальний');await count('#test-list .test-card',1);
  await page.screenshot({path:path.join(root,'verification/section-filters-tests.png'),fullPage:true});
 });
 await check('Cadets use only their own group and remembered name search',async()=>{
  await nav('cadets');assert.equal(await page.locator('#shared-group').inputValue(),'');assert.equal(await page.locator('#shared-test').count(),0);await count('.table-wrap tbody tr',4);
  await page.locator('#shared-group').selectOption('g1');await count('.table-wrap tbody tr',2);await page.locator('#filter').fill('cadet0');await count('.table-wrap tbody tr',1);
  await nav('tests');assert.equal(await page.locator('#shared-group').inputValue(),'g2');assert.equal(await page.locator('#filter').inputValue(),'Загальний');
  await click('reset-filters');await count('#test-list .test-card',4);assert.equal(await page.locator('#filter').inputValue(),'');
  await nav('cadets');assert.equal(await page.locator('#shared-group').inputValue(),'g1');assert.equal(await page.locator('#filter').inputValue(),'cadet0');await count('.table-wrap tbody tr',1);
 });
 await check('Materials reveal their local filters with an accessible button and show active selection while collapsed',async()=>{
  await nav('materials');await count('.test-card',3);const toggle=page.locator('[data-action="toggle-material-filters"]');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#material-filters').isVisible(),false);
  await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await toggle.evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'false');await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#shared-group').inputValue(),'');assert.equal(await page.locator('#shared-test').inputValue(),'');
  await page.locator('#shared-group').selectOption('g2');await count('.test-card',2);await page.locator('#shared-test').selectOption('t2');await count('.test-card',1);await page.locator('#material-search').fill('Посібник другої');
  await click('toggle-material-filters');assert.equal(await page.locator('#material-filters').isVisible(),false);assert.match(await page.locator('.material-filter-toggle').innerText(),/Фільтри\s+2/);assert.match(await page.locator('.material-filter-toggle').innerText(),/Група 2/);
  await page.screenshot({path:path.join(root,'verification/section-filters-materials.png'),fullPage:true});
  await nav('results');await settled();assert.equal(await page.locator('#shared-group').inputValue(),'g1');assert.equal(await page.locator('#shared-test').inputValue(),'t1');
 });
 await check('Analytics sends its own group and test selection to the real application request handler',async()=>{
  await analyticsPage();assert.equal(await page.locator('#shared-group').inputValue(),'');assert.equal(await page.locator('#shared-test').inputValue(),'');assert.deepEqual(calls.filter(p=>p.path==='/api/instructor/analytics').at(-1).body,{groupName:'',testId:''});
  await page.locator('#shared-group').selectOption('g2');await page.waitForFunction(()=>document.querySelector('.cards .value')?.textContent==='1');
  const analyticsResponse=page.waitForResponse(response=>{if(!response.url().endsWith('/rpc'))return false;const p=response.request().postDataJSON();return p?.path==='/api/instructor/analytics'&&p.body.testId==='t2';});
  await page.locator('#shared-test').selectOption('t2');await analyticsResponse;
  await page.waitForFunction(()=>document.querySelector('#shared-test')?.value==='t2'&&document.querySelector('.cards .value')?.textContent==='1');
  await nav('results');assert.equal(await page.locator('#shared-group').inputValue(),'g1');assert.equal(await page.locator('#shared-test').inputValue(),'t1');
  const request=calls.filter(p=>p.path==='/api/instructor/analytics').at(-1);assert.deepEqual(request.body,{groupName:'Група 2',testId:'t2'});
 });
 await check('Resetting material filters leaves Results, Analytics and Cadets selections intact',async()=>{
  await nav('materials');await click('toggle-material-filters');await click('reset-filters');await page.waitForFunction(()=>document.querySelector('#shared-group')?.value===''&&document.querySelector('#shared-test')?.value==='');assert.equal(await page.locator('.material-filter-toggle .result-tab-count').count(),0);
  await nav('cadets');assert.equal(await page.locator('#shared-group').inputValue(),'g1');assert.equal(await page.locator('#filter').inputValue(),'cadet0');
  await analyticsPage();assert.equal(await page.locator('#shared-group').inputValue(),'g2');assert.equal(await page.locator('#shared-test').inputValue(),'t2');
 });
 await check('Restart restores each section separately while Home remains unfiltered',async()=>{
  await nav('tests');await page.locator('#shared-group').selectOption('g2');await page.locator('#filter').fill('Загальний');await nav('home');await settled();assert.deepEqual(await page.locator('.cards .value').allTextContents(),['4','4','2','2']);
  await page.waitForFunction(async()=>{const state=await(await fetch('/state')).json();return state.accounts.teacher.sectionSearches?.tests==='Загальний';});
  await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();await settled();assert.equal(await page.locator('#shared-group,#shared-test').count(),0);
  await nav('tests');assert.equal(await page.locator('#shared-group').inputValue(),'g2');assert.equal(await page.locator('#filter').inputValue(),'Загальний');
  await nav('cadets');assert.equal(await page.locator('#shared-group').inputValue(),'g1');assert.equal(await page.locator('#filter').inputValue(),'cadet0');
  await nav('results');assert.equal(await page.locator('#shared-group').inputValue(),'g1');assert.equal(await page.locator('#shared-test').inputValue(),'t1');
  await nav('materials');assert.equal(await page.locator('#material-search').inputValue(),'Посібник другої');
  await analyticsPage();assert.equal(await page.locator('#shared-group').inputValue(),'g2');assert.equal(await page.locator('#shared-test').inputValue(),'t2');
 });
 await check('A delayed analytics reply cannot replace statistics for the currently selected group',async()=>{
  await analyticsPage();
  let entered,release;const reached=new Promise(r=>entered=r),held=new Promise(r=>release=r);
  const delay=async route=>{const p=route.request().postDataJSON();if(p?.path==='/api/instructor/analytics'&&p.body.groupName==='Група 1'){entered();await held;}await route.continue();};
  await page.route('**/rpc',delay);
  try{
   await page.locator('#shared-group').selectOption('g1');await reached;
   await page.locator('#shared-group').selectOption('g2');await page.waitForFunction(()=>document.querySelector('.cards .value')?.textContent==='1');
   const oldReply=page.waitForResponse(r=>r.url().endsWith('/rpc')&&r.request().postDataJSON()?.path==='/api/instructor/analytics'&&r.request().postDataJSON().body.groupName==='Група 1');
   release();await oldReply;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.locator('#shared-group').inputValue(),'g2');assert.equal(await page.locator('.cards .value').first().innerText(),'1');
  }finally{release();await page.unroute('**/rpc',delay);}
 });
 await check('Leaving Settings while analytics loads cannot navigate the application back after a slow reply',async()=>{
  await nav('more');let entered,release;const reached=new Promise(r=>entered=r),held=new Promise(r=>release=r);
  const delay=async route=>{if(route.request().postDataJSON()?.path==='/api/instructor/analytics'){entered();await held;}await route.continue();};
  await page.route('**/rpc',delay);
  try{
   await click('analytics');await reached;await nav('tests');
   const oldReply=page.waitForResponse(r=>r.url().endsWith('/rpc')&&r.request().postDataJSON()?.path==='/api/instructor/analytics');release();await oldReply;
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('#test-list').count(),1);
  }finally{release();await page.unroute('**/rpc',delay);}
 });
 await check('Local controls fit narrow windows in both themes, including expanded material filters',async()=>{
  for(const theme of ['light','dark']){
   if(theme==='dark')await click('theme');
   for(const screen of ['home','tests','cadets','results','materials','analytics']){
    if(screen==='analytics')await analyticsPage();else await nav(screen);
    if(screen==='materials'&&await page.locator('[data-action="toggle-material-filters"]').getAttribute('aria-expanded')==='false')await click('toggle-material-filters');
    for(const width of [1440,900,640,480,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,screen+' '+width+' '+theme);}
   }
  }
  await page.screenshot({path:path.join(root,'verification/section-filters-narrow.png'),fullPage:true});
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'verification/section-filters-ui.json'),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0},null,2));console.log('Section filters UI: '+checks.length+' checks passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
