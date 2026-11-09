import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken}=await import('./fixtures/server_model.mjs');
const root=new URL('../',import.meta.url).pathname,web=path.join(root,'web'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const user=api('GET','/api/workspace',instructorToken).user;
let state={version:1,session:{token:instructorToken,user},accounts:{},groups:[]},journal={};
const errors=[],calls=[],checks=[];let largestRequest=0;
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://local').pathname;
  const read=async()=>{const chunks=[];for await(const c of req)chunks.push(c);return Buffer.concat(chunks);};
  res.setHeader('Cache-Control','no-store');
  if(route==='/state'||route==='/journal'){
   if(req.method==='POST'){const value=JSON.parse(await read());if(route==='/state')state=value;else journal=value;res.end('{"ok":true}');}else res.end(JSON.stringify(route==='/state'?state:journal));return;
  }
  if(route==='/clock'){res.end(JSON.stringify({ok:true,uptime:1000000+performance.now(),launchId:'large-tests-ui'}));return;}
  if(route.startsWith('/updates/')){res.end(JSON.stringify({ok:true,state:2,currentVersion:version.version,currentCode:version.versionCode,message:'Актуальна версія'}));return;}
  if(route==='/rpc'){
   const raw=await read();assert.ok(raw.length<=8*1024*1024);largestRequest=Math.max(largestRequest,raw.length);const p=JSON.parse(raw);calls.push(p.path);
   res.setHeader('Content-Type','application/json');res.end(context.doPost({postData:{contents:raw.toString('utf8')}}).text);return;
  }
  const file=path.resolve(web,route==='/'?'index.html':route.slice(1));if(!file.startsWith(web+path.sep))throw Error('Invalid path');
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(e){errors.push(e.message);res.statusCode=500;res.end('Local fixture failed');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1366,height:900},locale:'uk-UA'});page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/?key=large-tests-ui');await page.locator('.layout').waitFor();await page.locator('[data-action="refresh"]:not([disabled])').waitFor();
 const failure=await page.evaluate(async()=>{
  const a=await import('/app.js'),c=await import('/core.js');
  const q={type:'choice',maxPoints:1,text:'П'.repeat(1000),explanation:'П'.repeat(2000),answers:Array.from({length:6},(_,i)=>({text:'В'.repeat(500),isCorrect:i<2}))};
  a.account().draft={...c.newDraft(),title:'Великий тест через ПК',questions:Array.from({length:200},()=>structuredClone(q))};
  await a.persist();a.account().capabilities.chunkedTests=false;
  try{await a.clickAction({dataset:{action:'publish-test'}});return '';}catch(e){return e.message;}
 });
 assert.match(failure,/API 17/);assert.equal(calls.filter(p=>p==='/api/instructor/tests').length,0);
 assert.equal(state.accounts[user.id].draft.questions.length,200);checks.push('An old server is explained before a large publish, preserving the whole draft');
 await page.reload();await page.locator('.layout').waitFor();await page.locator('[data-action="refresh"]:not([disabled])').waitFor();
 assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft.questions.length),200);checks.push('Restarting retains the complete large draft');
 await page.evaluate(async()=>{const a=await import('/app.js');await a.refresh();await a.clickAction({dataset:{action:'publish-test'}});});
 const test=api('GET','/api/tests',instructorToken).tests.find(t=>t.title==='Великий тест через ПК');assert.ok(test);
 const full=api('GET','/api/tests/'+test.id,instructorToken).test;assert.equal(full.questions.length,200);assert.equal(full.questions[199].answers[5].text,'В'.repeat(500));
 assert.ok(largestRequest>2000000);assert.equal(state.accounts[user.id].draft,null);
 assert.deepEqual(errors,[]);checks.push('The actual PC publish flow sends more than 2 MB of Ukrainian text and reloads all 200 questions');
 fs.writeFileSync(path.join(root,'verification/large-tests-ui.json'),JSON.stringify({passed:checks.length,checks,largestRequestBytes:largestRequest,productionWrites:false,windowsRuntimeVerified:false},null,2));console.log('Large test browser UI: '+checks.length+' passed; largest request '+largestRequest+' bytes.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
