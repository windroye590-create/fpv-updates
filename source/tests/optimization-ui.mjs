// Real application and Chromium; synthetic local data and a controlled API delay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {handleHostWindow} from './fixtures/host-window.mjs';
const web=process.env.LITAKOVA_OPT_WEB_ROOT||new URL('../web/',import.meta.url).pathname;
const baseline=process.env.LITAKOVA_OPT_BASELINE==='1',delay=150,calls=[],errors=[];
const user={id:'i',username:'instructor',fullName:'Інструктор',role:'instructor'};
const groups=[{id:'g',name:'Група'}];
const tests=Array.from({length:60},(_,i)=>({id:'t'+i,title:'Тест '+i,published:true,mode:'training',description:'',questionCount:10}));
const cadets=Array.from({length:300},(_,i)=>({id:'u'+i,fullName:'Курсант '+i,username:'login'+i,role:'cadet',groupName:'Група',active:true}));
const results=Array.from({length:12000},(_,i)=>({id:'r'+i,userId:'u'+i%300,userName:'Курсант '+i%300,testId:'t'+Math.floor(i/300)%60,testTitle:'Тест '+Math.floor(i/300)%60,groupName:'Група',correct:i%11,total:10,score:i%11*10,passed:i%11>=7,durationSeconds:60,gradingStatus:'graded',completedAt:new Date(1790000000000+i).toISOString()}));
let state={version:1,session:{token:'synthetic-opt',user},groups,theme:'light',accounts:{i:{tests,cadets,results,pending:[],reviews:{},fullTests:{},draft:null,resultTotal:results.length,fullResultsRevision:'r1',workspaceRevisions:{groups:'g1',tests:'t1',cadets:'c1',results:'r1:all'},workspaceFullAt:Date.now(),updatedAt:Date.now(),sectionFilters:{results:{groupId:'g',testId:''}},resultsView:'ranking'}}};
const server=http.createServer(async(req,res)=>{try{
 if(handleHostWindow(req,res))return;
 const route=new URL(req.url,'http://local').pathname;res.setHeader('Cache-Control','no-store');
 const read=async()=>{let s='';for await(const b of req)s+=b;return JSON.parse(s||'{}');};
 const json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
 if(route==='/clock')return json({ok:true,uptime:100000+performance.now(),launchId:'opt'});
 if(route==='/state'||route==='/journal'){if(req.method==='POST'){const v=await read();if(route==='/state')state=v;return json({ok:true});}return json(route==='/state'?state:{});}
 if(route.startsWith('/updates/'))return json({ok:true,state:2,message:'Актуальна версія'});
 if(route==='/rpc'){
  const p=await read();calls.push(p);await new Promise(r=>setTimeout(r,delay));
  if(p.path==='/api/workspace'){
   const revisions={groups:'g1',tests:'t1',cadets:'c1',results:'r1:'+(p.body.allResults?'all':'recent')},all={groups,tests,cadets,results:p.body.allResults?results:results.slice(-500)},changes={};
   for(const k of Object.keys(all))if(p.body.known?.[k]!==revisions[k])changes[k]=all[k];
   return json({ok:true,workspaceProtocol:1,user,revisions,changes,resultTotal:results.length,resultScope:p.body.allResults?'all':'recent',snapshotStable:true,capabilities:{multipleChoice:true,writtenTests:true}});
  }
  if(p.path==='/api/instructor/reviews')return json({ok:true,results:[],resultsRevision:'r1',serverNow:Date.now(),...(p.body.reviewQueueProtocol===2?{reviewQueueProtocol:2,unchanged:false,recoveries:[]}:{})});
  if(p.path==='/api/instructor/exam-recoveries')return json({ok:true,recoveries:[]});
  if(p.path==='/api/account-state')return json({ok:true,accountSyncProtocol:1,userId:'i',cursor:'0',documents:[],stable:true});
  if(p.path==='/api/account-state/document')return json({ok:true,accountSyncProtocol:1,userId:'i',document:{key:p.body.key,revision:1,value:p.body.value}});
  return json({ok:false,code:'NOT_FOUND',error:'Synthetic unsupported route'});
 }
 const file=path.resolve(web,route==='/'?'index.html':route.slice(1));if(!file.startsWith(path.resolve(web)+path.sep))throw Error('Bad fixture path');
 res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.mjs':'text/javascript'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
}catch(e){errors.push(String(e));res.writeHead(500);res.end('Fixture failure');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1360,height:900},locale:'uk-UA'});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
const perform=async action=>{await page.evaluate(action=>{const s={done:false,error:'',ms:0};globalThis.__opt=s;const at=performance.now();import('/app.js').then(a=>{if(action==='results')return a.navigate('results');const b=document.createElement('button');b.dataset.action='results-view';b.dataset.view='pending';return a.clickAction(b);}).then(()=>{s.ms=performance.now()-at;s.done=true;},e=>{s.error=String(e.stack||e);s.done=true;});},action);await page.waitForFunction(()=>globalThis.__opt.done);const r=await page.evaluate(()=>globalThis.__opt);assert.equal(r.error,'');return r.ms;};
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/?key=opt');await page.locator('.layout').waitFor();await page.locator('.topbar').filter({hasText:'Оновлено'}).waitFor();
 await new Promise(r=>setTimeout(r,500));
 await perform('results');
 assert.equal(await page.locator('.ranking-caption').count(),1);
 // Warm the same group once, then measure the real input handler and layout.
 const samples=[];
 for(let i=0;i<11;i++){
  const q=i%2?'Курсант 298':'Курсант 299';
  const r=await page.evaluate(q=>{const field=document.querySelector('#filter'),at=performance.now();field.value=q;field.dispatchEvent(new Event('input',{bubbles:true}));const rows=document.querySelectorAll('.group-ranking tbody tr').length;const width=document.querySelector('#results-table').getBoundingClientRect().width;return {ms:performance.now()-at,rows,width};},q);
  assert.equal(r.rows,1);assert.ok(r.width>0);samples.push(r.ms);await new Promise(r=>setTimeout(r,30));
 }
 await page.locator('#filter').fill('');assert.equal(await page.locator('.group-ranking tbody tr').count(),50);
 const from=calls.length;
 const pendingMs=await perform('pending');
 const queueCalls=calls.slice(from).filter(r=>['/api/instructor/reviews','/api/instructor/exam-recoveries'].includes(r.path));assert.equal(queueCalls.length,baseline?2:1);
 await page.locator('#results-tab-ranking').click();await page.locator('.ranking-caption').waitFor();
 // Same-ID grade refresh must invalidate the warmed model, including the CSV.
 const app=await page.evaluate(async()=>{const a=await import('/app.js');const r=a.account();const before=r.results[0].correct;r.results=[{...r.results[0],correct:(before+1)%11},...r.results.slice(1)];r.resultWriteVersion=(r.resultWriteVersion||0)+1;return r.results.filter(v=>v.userId==='u0').reduce((s,v)=>s+v.correct,0);});
 await page.locator('#filter').fill('Курсант 0');assert.equal(Number(await page.locator('.group-ranking tbody td.ranking-total strong').innerText()),app);
 const waiting=page.waitForEvent('download');await page.locator('[data-action=export-ranking]').click();const csv=fs.readFileSync(await (await waiting).path(),'utf8');assert.equal(csv.split('\r\n')[1].split(';')[2],'\"'+app+'\"');
 const sorted=samples.toSorted((a,b)=>a-b),report={status:'passed',kind:'real_chromium_synthetic_data',results:12000,cadets:300,tests:60,controlledApiDelayMs:delay,rankingSearchMedianMs:sorted[5],rankingSearchSamplesMs:samples,reviewRefreshMs:pendingMs,reviewRefreshCloudRequests:queueCalls.length,pageErrors:errors,liveGoogleCapacityMeasured:false};
 assert.deepEqual(errors,[]);fs.writeFileSync(process.env.LITAKOVA_OPT_OUTPUT||new URL('../verification/optimization-ui.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
