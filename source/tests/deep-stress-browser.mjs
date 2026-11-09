// Isolated real Chromium + unmodified app + unmodified Code.gs. No external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken}=await import('./fixtures/server_model.mjs');
const root=new URL('../',import.meta.url).pathname;
const output=path.resolve(root,'verification/stress/browser-27.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
const release=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Ізольований стрес 27 ПК'}).group;
const creds=credential('synthetic-stress-password');
const cadets=Array.from({length:27},(_,i)=>api('POST','/api/register','',{fullName:'Стрес Курсант '+i,username:'stress_browser_'+i,groupId:group.id,...creds}));
const choice=i=>({text:'Навантаження '+i,type:'choice',maxPoints:1,answers:[{text:'А',isCorrect:true},{text:'Б',isCorrect:i%2===0},{text:'В',isCorrect:false},{text:'Г',isCorrect:false}]});
const heavy=api('POST','/api/instructor/tests',instructorToken,{title:'Стрес: 200 питань',mode:'training',published:true,passingPercent:70,choiceProtocol:2,questions:Array.from({length:200},(_,i)=>({text:'Q'+i,answers:[{text:'А',isCorrect:true},{text:'Б',isCorrect:false}]}))}).test;
const mixed=api('POST','/api/instructor/tests',instructorToken,{title:'Стрес: великі письмові',mode:'training',published:true,passingPercent:70,choiceProtocol:2,writtenProtocol:1,questions:[...Array.from({length:20},(_,i)=>choice(i)),...Array.from({length:15},(_,i)=>({type:'written',text:'Письмова '+i,maxPoints:5,rubric:'Синтетичний еталон',answers:[]}))]}).test;
const text='Українська відповідь, <svg onload=bad> & =SUM(A1)\n'.repeat(80).slice(0,2999);
const stores=cadets.map(c=>({version:1,theme:'light',session:{user:c.user,token:c.token},groups:[group],accounts:{[c.user.id]:{tests:[],results:[],cadets:[],fullTests:{},reviews:{},pending:[],run:null,resultTotal:0}}}));
const journals=stores.map(()=>({})),counts=new Map(),errors=[],unexpected=[],metrics={requests:0,peakActive:0,busy:0,quota:0,lostReplies:0,offlineReplies:0,stateWrites:0};
let active=0,phase='initial',offline=false;
const started=performance.now();
const server=http.createServer(async(req,res)=>{
 active++;metrics.peakActive=Math.max(active,metrics.peakActive);
 try{
  const index=Number(/stressClient=(\d+)/.exec(req.headers.cookie||'')?.[1]??-1);
  const route=new URL(req.url,'http://local').pathname;
  const read=async()=>{const chunks=[];for await(const p of req)chunks.push(p);return Buffer.concat(chunks).toString('utf8');};
  const json=value=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
  if(['/state','/journal'].includes(route)){
   assert.ok(index>=0);if(req.method==='POST'){const data=JSON.parse(await read());if(route==='/state'){stores[index]=data;metrics.stateWrites++;}else journals[index]=data;json({ok:true});}else json(route==='/state'?stores[index]:journals[index]);return;
  }
  if(route==='/clock'){json({ok:true,uptime:1000000+performance.now(),launchId:'stress-'+index});return;}
  if(route.startsWith('/updates/')){json({ok:true,state:2,currentVersion:'1.2.11',currentCode:134,message:'Актуальна версія'});return;}
  if(route==='/rpc'){
   metrics.requests++;const raw=await read(),p=JSON.parse(raw);
   await new Promise(r=>setTimeout(r,10+(index%7)*3));
   if(offline){metrics.offlineReplies++;json({ok:false,code:'NETWORK',error:'Synthetic offline'});return;}
   if(phase==='faults'&&p.path==='/api/results'){
    const key=index+':'+p.body.testId,n=counts.get(key)||0;counts.set(key,n+1);
    if(n===0&&index%3===0){metrics.busy++;json({ok:false,code:'BUSY',error:'Synthetic busy'});return;}
    if(n===0&&index%3===1){metrics.quota++;res.statusCode=429;json({ok:false,code:'NETWORK',error:'Synthetic 429'});return;}
    const reply=context.doPost({postData:{contents:raw}}).text;
    if(n===0&&index%3===2){assert.ok(JSON.parse(reply).ok);metrics.lostReplies++;req.socket.destroy();return;}
    res.setHeader('Content-Type','application/json');res.end(reply);return;
   }
   const value=context.doPost({postData:{contents:raw}}).text;res.setHeader('Content-Type','application/json');res.end(value);return;
  }
  const file=path.resolve(root,'web',route==='/'?'index.html':route.slice(1));
  if(!file.startsWith(path.resolve(root,'web')+path.sep))throw Error('Invalid local path');
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.wasm':'application/wasm','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(e){errors.push(String(e));if(!res.headersSent)res.statusCode=500;res.end('Isolated harness error');}
 finally{active--;}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const pages=[],contexts=[],checks=[],latencies=[];
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
async function drain(){for(let attempt=0;attempt<15;attempt++){
 const pending=await Promise.all(pages.map(p=>p.evaluate(async()=>{const a=await import('/app.js');await a.syncQueue(true);return a.account().pending.length;})));
 if(pending.every(n=>n===0))return;await new Promise(r=>setTimeout(r,50));
}throw Error('Queues did not drain');}
async function submit(test,wave){await Promise.all(pages.map(async(p,i)=>{
 const at=performance.now();await p.evaluate(async({test,i,text,wave})=>{
  const a=await import('/app.js'),c=await import('/core.js'),run={test,answers:{},index:0,startedUptime:a.uptime()-30000,launchId:'stress-'+i,submissionId:'browser-stress-'+wave+'-'+i,userId:String(a.account().userId||''),exitCount:0,lastElapsed:30};
  for(const q of test.questions)run.answers[q.id]=q.type==='written'?text:q.answers.filter(x=>x.isCorrect).map(x=>String(x.id));
  a.account().fullTests[String(test.id)]=test;a.account().run=run;await a.persist();await a.finishRun(false);
 },{test,i,text,wave});latencies.push(performance.now()-at);
}));}
try{
 // Limit startup fan-out; all 27 sessions stay alive for simultaneous finish/retry.
 for(let base=0;base<27;base+=3)await Promise.all(Array.from({length:Math.min(3,27-base)},async(_,offset)=>{
  const i=base+offset,ctx=await browser.newContext({viewport:{width:1100,height:760},locale:'uk-UA'});
  await ctx.addCookies([{name:'stressClient',value:String(i),url:origin}]);
  await ctx.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){unexpected.push(route.request().url());return route.abort();}return route.continue();});
  const p=await ctx.newPage();p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push('page '+i+': '+e.message));
  contexts[i]=ctx;pages[i]=p;await p.goto(origin+'/?key=synthetic-'+i);await p.locator('.layout').waitFor();await p.waitForFunction(async()=>{const a=await import('/app.js');return !!a.account().capabilities?.multipleChoice;});
 }));
 check('27 separate Chromium sessions initialized with real server authentication',()=>assert.equal(pages.length,27));
 phase='faults';await submit(heavy,1);
 await Promise.all(pages.filter((_,i)=>i%3===0).map(p=>p.reload()));
 await Promise.all(pages.filter((_,i)=>i%3===0).map(p=>p.locator('.layout').waitFor()));await drain();
 const results1=api('GET','/api/instructor/results',instructorToken).results.filter(r=>String(r.testId)===String(heavy.id));
 check('27 simultaneous 200-question submissions survive BUSY, 429, lost replies and restarts',()=>{assert.equal(results1.length,27);assert.equal(new Set(results1.map(r=>String(r.userId))).size,27);assert.ok(results1.every(r=>r.correct===200&&r.score===100));assert.equal(metrics.lostReplies,9);assert.equal(metrics.busy,9);assert.equal(metrics.quota,9);});
 phase='mixed';offline=true;await submit(mixed,2);
 check('All 27 large written submissions stay on disk during a total outage',()=>{for(let i=0;i<27;i++){const a=stores[i].accounts[cadets[i].user.id];assert.equal(a.pending.length,1);assert.equal(a.pending[0].body.answers.filter(x=>x.text).length,15);}});
 await Promise.all(pages.map(p=>p.reload()));await Promise.all(pages.map(p=>p.locator('.layout').waitFor()));
 check('Reopening all application windows preserves every offline answer',()=>{for(let i=0;i<27;i++){const a=stores[i].accounts[cadets[i].user.id];assert.equal(a.pending.length,1);assert.equal(a.pending[0].body.answers.find(x=>x.text).text,text);}});
 offline=false;await drain();
 const results2=api('GET','/api/instructor/results',instructorToken).results.filter(r=>String(r.testId)===String(mixed.id));
 check('Restored connection commits 27 mixed works once, with pending manual grades',()=>{assert.equal(results2.length,27);assert.ok(results2.every(r=>r.correct===20&&r.pendingWritten===15&&r.score===null));});
 check('405 large written answers remain byte-for-byte identical in authoritative storage',()=>{for(const r of results2){const record=context.resultRecordById_(r.id),answers=JSON.parse(record.row[13]);for(const q of mixed.questions.filter(q=>q.type==='written'))assert.equal(answers[q.id],text);}});
 check('Every saved queue is empty only after a server acknowledgement',()=>{for(let i=0;i<27;i++)assert.equal(stores[i].accounts[cadets[i].user.id].pending.length,0);});
 await Promise.all(pages.map(p=>p.evaluate(async()=>{const a=await import('/app.js');for(const name of ['tests','results','home'])await a.navigate(name);}))); 
 check('No application exceptions, leaked cross-account requests or external traffic',()=>{assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);});
 const sorted=latencies.toSorted((a,b)=>a-b);
 const report={status:'passed',kind:'isolated_27_chromium_clients_real_app_and_real_Code_gs',version:release.version,productionWrites:false,liveGoogleCapacityMeasured:false,windowsRuntimeVerified:false,clients:27,committedResults:54,choiceAnswersChecked:5940,writtenAnswersChecked:405,writtenChars:text.length*405,checks,metrics,wallSeconds:Math.round((performance.now()-started)/1000),localFinishMilliseconds:{median:Math.round(sorted[Math.floor(sorted.length/2)]),p95:Math.round(sorted[Math.floor(sorted.length*.95)])}};
 fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){fs.writeFileSync(output,JSON.stringify({status:'failed',error:e.stack,checks,metrics,errors,unexpected},null,2));throw e;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
