import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const count={tests:2000,results:10000,cadets:2000,materials:1200};
const groups=[{id:'g',name:'Група 1'}],user={id:'i',username:'instructor',fullName:'Інструктор перевірки',role:'instructor'};
const tests=Array.from({length:count.tests},(_,i)=>({id:'t'+i,title:'Тест '+i,description:'Навчальні питання',published:true,mode:'training',passingPercent:70,questionCount:10}));
const results=Array.from({length:count.results},(_,i)=>({id:'r'+i,testId:'t'+(i%count.tests),testTitle:'Тест '+(i%count.tests),userId:'c'+(i%count.cadets),userName:'Курсант '+i,groupName:'Група 1',score:80,correct:8,total:10,durationSeconds:60,completedAt:'2026-10-18T10:00:00Z',passed:true}));
const cadets=Array.from({length:count.cadets},(_,i)=>({id:'c'+i,fullName:'Курсант '+i,username:'cadet'+i,role:'cadet',groupName:'Група 1',active:true}));
const original=fs.readFileSync(new URL('./fixtures/materials/three-slides.pdf',import.meta.url));
const split=original.lastIndexOf('startxref');
const pdf=Buffer.concat([original.subarray(0,split),Buffer.from('%'+'.'.repeat(2*1024*1024)+'\n'),original.subarray(split)]);
const digest=crypto.createHash('sha256').update(pdf).digest('hex');
const materials=Array.from({length:count.materials},(_,i)=>({id:'m'+i,title:'Матеріал '+i,topic:'Тема '+(i%10),description:'Навчальний PDF',groupIds:['g'],revision:1,pageCount:3,size:pdf.length,sha256:digest}));
const a={tests,results,cadets,materials,fullTests:{},pending:[],reviews:{},materialProgress:{},materialSaved:{},run:null,draft:null,updatedAt:Date.now(),resultTotal:results.length};
let state={version:1,session:{token:'perf',user},groups,accounts:{i:a}},calls=[],active=0,maxActive=0,revoked=false,jitter=false,corrupt=false,finished=[];
const delay=100;
const server=http.createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(['/state','/journal','/clock'].includes(path)){
   if(req.method==='POST'){const b=[];for await(const c of req)b.push(c);if(path==='/state')state=JSON.parse(Buffer.concat(b));res.end('{"ok":true}');}
   else res.end(JSON.stringify(path==='/state'?state:path==='/clock'?{ok:true,uptime:performance.now()+1000,launchId:'perf'}:{}));return;
  }
  if(path.startsWith('/updates/')){res.end('{"ok":true,"message":"Актуальна версія"}');return;}
  if(path==='/rpc'){
   const chunks=[];for await(const c of req)chunks.push(c);const p=JSON.parse(Buffer.concat(chunks));calls.push(p.path);
   active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,jitter&&p.path.includes('/chunks/')?(+p.path.split('/').pop()%2?30:170):delay));active--;finished.push(p.path);
   let body={ok:true};
   if(p.path==='/api/groups')body.groups=groups;
   else if(p.path==='/api/workspace')Object.assign(body,{workspaceProtocol:1,user,revisions:{groups:'g1',tests:'t1',cadets:'c1',results:'r1'},changes:{groups,tests,cadets,results},resultTotal:results.length,snapshotStable:true,capabilities:{multipleChoice:true,writtenTests:true,materials:true}});
   else if(p.path==='/api/account-state')Object.assign(body,{accountSyncProtocol:1,userId:user.id,cursor:'performance-fixture',documents:[],stable:true});
   else if(p.path==='/api/account-state/document')Object.assign(body,{accountSyncProtocol:1,userId:user.id,document:{key:p.body.key,revision:(p.body.expectedRevision||0)+1,value:p.body.value??null}});
   else if(p.path==='/api/instructor/dashboard')Object.assign(body,{tests,results,cadets,resultTotal:results.length});
   else if(p.path==='/api/instructor/results')body.results=results;
   else if(p.path==='/api/materials')Object.assign(body,{materials,progress:[]});
   else if(/^\/api\/materials\/m\d+$/.test(p.path)){body.material=materials.find(m=>m.id===p.path.split('/').pop());if(revoked)body={ok:false,code:'MATERIAL_NOT_FOUND',error:'Матеріал недоступний вашій групі.'};}
   else if(p.path.includes('/chunks/')){const batch=+p.path.split('/').pop(),start=batch*16,total=Math.ceil(pdf.length/24576);Object.assign(body,{revision:1,sha256:digest,totalParts:total,parts:Array.from({length:Math.min(16,total-start)},(_,j)=>({index:start+j,data:pdf.subarray((start+j)*24576,Math.min((start+j+1)*24576,pdf.length)).toString('base64')}))});}
   else if(p.method==='GET'){body={ok:false,code:'NOT_FOUND',error:'Not found'};}
   if(corrupt&&body.parts?.[0])body.parts[0].index=999;
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return;
  }
  const name=path==='/'?'index.html':decodeURIComponent(path.slice(1));
  if(name.includes('..'))throw Error('Invalid path');
  const file=new URL('../web/'+name,import.meta.url),ext=name.split('.').pop();res.setHeader('Content-Type',({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',png:'image/png',wasm:'application/wasm'})[ext]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1360,height:900}});page.setDefaultTimeout(60000);
const failures=[];page.on('pageerror',e=>failures.push(e.message));
const report={kind:'local_chromium_synthetic_performance',networkDelayMs:delay,count,lists:{},pdf:{}};
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/?key=perf');await page.locator('.topbar').filter({hasText:'Оновлено'}).waitFor();
 for(const name of ['tests','cadets','results','materials']){
  const times=[];let nodes=0;
  for(let i=0;i<3;i++){
   const data=await page.evaluate(async name=>{const a=await import('/app.js'),t=performance.now();await a.navigate(name);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {ms:performance.now()-t,nodes:document.querySelectorAll('#app *').length};},name);
   times.push(Math.round(data.ms));nodes=data.nodes;
  }
  report.lists[name]={medianMs:times.sort((a,b)=>a-b)[1],samplesMs:times,nodes};console.log(name,report.lists[name]);
 }
 for(const name of ['cold','warm']){
  const at=calls.length;maxActive=0;const begin=performance.now();await page.locator('[data-action=material-open][data-id=m0]').click();
  await page.waitForFunction(()=>document.querySelector('#modal')?.open && document.querySelector('#material-page')?.textContent==='1 / 3');
  report.pdf[name]={ms:Math.round(performance.now()-begin),requests:calls.slice(at),maxActive};
  await page.locator('[data-action=material-close]').click();await page.locator('#modal').waitFor({state:'hidden'});
 }
 if(process.env.LITAKOVA_PERFORMANCE_VALIDATE!=='0'){
  report.checks=[];
  await page.evaluate(async()=>(await import('/app.js')).navigate('tests'));
  assert.equal(await page.locator('#shared-test').count(),0);
  await page.locator('#filter').fill('Тест 1999');await page.waitForFunction(()=>document.querySelectorAll('.test-card').length===1);
  await page.evaluate(async()=>(await import('/app.js')).navigate('results'));assert.equal(await page.locator('#shared-test').inputValue(),'');
  assert.ok(await page.locator('#shared-test option').count()<=52);
  await page.locator('#shared-test-search').fill('Тест 1999');await page.locator('#shared-test').selectOption('t1999');
  await page.waitForFunction(()=>document.querySelectorAll('.compact-results tbody tr').length===5);
  await page.evaluate(async()=>(await import('/app.js')).navigate('tests'));assert.equal(await page.locator('#filter').inputValue(),'Тест 1999');assert.equal(await page.locator('#shared-test').count(),0);
  await page.evaluate(async()=>(await import('/app.js')).navigate('results'));assert.equal(await page.locator('#shared-test').inputValue(),'t1999');
  await page.locator('#shared-test-search').fill('Тест 12');assert.equal(await page.locator('#shared-test').inputValue(),'t1999');
  await page.locator('#shared-test-search').fill('немає такого тесту');assert.equal(await page.locator('#shared-test').inputValue(),'t1999');await page.locator('#shared-test-matches').filter({hasText:'не знайдено'}).waitFor();
  assert.ok(await page.locator('#shared-test option').count()<=52);
  await page.locator('[data-action=reset-filters]').click();await page.waitForFunction(()=>document.querySelector('#shared-test')?.value==='');assert.equal(await page.locator('#shared-test-search').inputValue(),'');
  report.checks.push('A bounded section selector finds the last test, survives search misses, and keeps Results separate from the Tests name search');
  for(const [name,action,query,lastId]of [['tests','preview','Тест 1999','t1999'],['cadets','delete-cadet','Курсант 1999','c1999'],['results',null,'Курсант 9999',null],['materials','material-open','Матеріал 1199','m1199']]){
   await page.evaluate(async n=>(await import('/app.js')).navigate(n),name);
   await page.locator(name==='materials'?'#material-search':'#filter').fill('');
   assert.ok(await page.locator('#app *').count()<1500);
   await page.locator('[data-action=list-page][data-index="2"]').click();
   await page.locator('.list-pager').filter({hasText:'51–100'}).waitFor();
   await page.locator(name==='materials'?'#material-search':'#filter').fill(query);
   if(action)assert.equal(await page.locator(`[data-action="${action}"][data-id="${lastId}"]`).count(),1);
   else assert.ok((await page.locator('tbody').textContent()).includes(query));
   assert.equal(await page.locator('.list-pager').count(),0);report.checks.push(name+': bounded DOM, second page, search finds last record');
  }
  await page.evaluate(async()=>(await import('/app.js')).navigate('results'));await page.locator('#filter').fill('Курсант 9999');
  const waitDownload=page.waitForEvent('download');await page.locator('[data-action=export-csv]').click();const exported=await (await waitDownload).path();
  const csv=fs.readFileSync(exported,'utf8');
  assert.equal(csv.split('\r\n').length,2);assert.match(csv,/Курсант 9999/);assert.doesNotMatch(csv,/Курсант 9998/);
  report.checks.push('CSV exports exactly the matching record from 10000 results');
  await page.locator('#filter').fill('');
  const allDownload=page.waitForEvent('download');await page.locator('[data-action=export-csv]').click();
  assert.equal(fs.readFileSync(await (await allDownload).path(),'utf8').split('\r\n').length,10001);
  report.checks.push('Clearing the search exports all 10000 results');
  await page.evaluate(async()=>(await import('/app.js')).navigate('materials'));await page.locator('#material-search').fill('');jitter=true;finished=[];
  await page.locator('[data-action=material-open][data-id=m1]').click();await page.waitForFunction(()=>document.querySelector('#modal')?.open&&document.querySelector('#material-page')?.textContent==='1 / 3');
  const done=finished.filter(p=>p.includes('/chunks/'));assert.ok(done.indexOf('/api/materials/m1/chunks/1')<done.indexOf('/api/materials/m1/chunks/0'));
  await page.locator('[data-action=material-close]').click();await page.locator('#modal').waitFor({state:'hidden'});report.checks.push('Out-of-order parallel batches reconstruct a valid PDF');
  corrupt=true;await page.locator('[data-action=material-open][data-id=m2]').click();await page.getByText('Пошкоджений порядок сторінок PDF.',{exact:true}).waitFor();assert.equal(await page.locator('#modal').evaluate(el=>el.open),false);corrupt=false;const retryAt=calls.length;await page.locator('[data-action=material-open][data-id=m2]').click();await page.waitForFunction(()=>document.querySelector('#modal')?.open&&document.querySelector('#material-page')?.textContent==='1 / 3');assert.equal(calls.slice(retryAt).filter(p=>p.includes('/chunks/')).length,6);await page.locator('[data-action=material-close]').click();await page.locator('#modal').waitFor({state:'hidden'});report.checks.push('Damaged parallel batch cannot create a partial cache; a fresh retry succeeds');
  revoked=true;const at=calls.length;await page.locator('[data-action=material-open][data-id=m2]').click();await page.getByText('Матеріал недоступний вашій групі.',{exact:true}).waitFor();
  assert.equal(await page.locator('#modal').evaluate(el=>el.open),false);assert.ok(!calls.slice(at).some(p=>p.includes('/chunks/')));report.checks.push('Revoked access blocks the verified in-memory PDF cache');
 }
 assert.deepEqual(failures,[]);report.failures=failures;
 fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(process.env.LITAKOVA_PERF_OUTPUT||new URL('../verification/performance-ui.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report.pdf));
}finally{await browser.close();await new Promise(r=>server.close(r));}
