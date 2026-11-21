import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {handleHostWindow} from './fixtures/host-window.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,credential}=await import('./fixtures/server_model.mjs');
const root=new URL('../web/',import.meta.url),checks=[],errors=[],calls=[];
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Інтерфейс надійного завершення'}).group;
const person=api('POST','/api/register','',{username:'finish-reliable-ui',fullName:'Курсант перевірки інтерфейсу',groupId:group.id,...credential('finish-reliable-ui-password')});
const make=mode=>api('POST','/api/instructor/tests',instructorToken,{title:'Надійне завершення '+mode,mode,durationMinutes:20,published:true,questions:[{type:'written',text:'Напишіть відповідь',maxPoints:3,answers:[]}]}).test;
const exam=make('exam'),training=make('training'),device='finish-ui-device';
api('POST','/api/exam-session/start',person.token,{testId:exam.id,deviceId:device,requestId:crypto.randomUUID()});
let state={version:1,deviceId:device,session:{token:person.token,user:person.user},accounts:{},groups:[]},journal={},held=false,releaseSave,enteredSave,loseResult=false;
const waiting=new Promise(r=>releaseSave=r),entered=new Promise(r=>enteredSave=r);
const started=performance.now();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{
 try{
  if(handleHostWindow(req,res))return;
  const url=new URL(req.url,'http://localhost'),route=url.pathname;
  res.setHeader('Content-Type','application/json');
  if(route.startsWith('/updates/')){res.end(JSON.stringify({ok:true,state:2,message:'Актуальна версія'}));return;}
  if(route==='/clock'){res.end(JSON.stringify({ok:true,uptime:100000+performance.now()-started,launchId:'finish-ui-launch'}));return;}
  if(route==='/state'||route==='/journal'){
   if(req.method==='POST'){
    let raw='';for await(const chunk of req)raw+=chunk;const value=JSON.parse(raw);
    if(route==='/state')state=value;else if((value.serial||0)>(journal.serial||0))journal=value;
    res.end('{"ok":true}');
   }else res.end(JSON.stringify(route==='/state'?state:journal));
   return;
  }
  if(route==='/rpc'){
   let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);calls.push(request);
   const reply=context.doPost({postData:{contents:raw}}).text;
   if(request.path==='/api/exam-session/save'&&!held){held=true;enteredSave();await waiting;}
   res.end(reply);return;
  }
  const name=route==='/'?'index.html':route.slice(1);
  if(name.includes('..')){res.writeHead(404);res.end();return;}
  const file=new URL(name,root);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(x){res.writeHead(500);res.end(JSON.stringify({error:x.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
async function until(predicate,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out waiting for durable application state');}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',x=>errors.push(x.message));
 await page.route('**/rpc',async route=>{
  const request=route.request().postDataJSON();
  if(loseResult&&request?.path==='/api/results'){
   loseResult=false;await route.fetch();await route.abort('failed');return;
  }
  await route.continue();
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/?key=finish-ui');
 await page.locator('[data-action=resume]').first().click();
 const field=page.locator('[data-run-written]');await field.fill('Проміжна відповідь');
 await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('Autosave never started')),15000))]);
 await field.fill('Остаточна відповідь перед здачею');await page.locator('[data-action=finish]').click();await page.locator('#modal button.primary').click();
 await until(()=>state.accounts[person.user.id]?.run?.finishCheckpoint?.answers[exam.questions[0].id]==='Остаточна відповідь перед здачею');
 assert.equal(await field.isDisabled(),true);assert.equal(calls.filter(r=>r.path==='/api/exam-session/finish').length,0);
 checks.push('Finishing freezes the actual answer field and persists the final checkpoint while autosave acknowledgement is delayed');
 releaseSave();await until(()=>state.accounts[person.user.id]?.run===null);
 await page.locator('.result-card').waitFor();
 assert.equal(calls.filter(r=>r.path==='/api/exam-session/save').length,1);assert.equal(calls.filter(r=>r.path==='/api/exam-session/finish').length,1);
 const result=api('GET','/api/my-results',person.token).results.find(r=>r.testId===exam.id);assert.ok(result);
 assert.equal(api('GET','/api/results/'+result.id+'/review',person.token).review[0].text,'Остаточна відповідь перед здачею');
 checks.push('The visible completed exam contains the frozen final answer and no redundant autosave or duplicate finish');
 await page.locator('[data-action=nav][data-page=tests]').first().click();
 await page.locator('[data-action=start][data-id="'+training.id+'"]').click();await page.locator('#modal button.primary').click();
 await page.locator('[data-run-written]').fill('Робота після обриву локального зв’язку');loseResult=true;
 await page.locator('[data-action=finish]').click();await page.locator('#modal button.primary').click();
 await until(()=>state.accounts[person.user.id]?.pending?.[0]?.failureCode==='LOCAL_HOST_UNAVAILABLE');
 const body=structuredClone(state.accounts[person.user.id].pending[0].body);assert.equal(state.accounts[person.user.id].pending[0].permanent,false);
 checks.push('A genuine aborted HTTP reply becomes a retryable local-host error while retaining the complete queued body');
 await until(()=>state.accounts[person.user.id]?.pending?.length===0,30000);
 const deliveries=calls.filter(r=>r.path==='/api/results'&&String(r.body.testId)===String(training.id));assert.equal(deliveries.length,2);
 assert.deepEqual(deliveries[0].body,body);assert.deepEqual(deliveries[1].body,body);
 assert.equal(api('GET','/api/my-results',person.token).results.filter(r=>r.testId===training.id).length,1);
 checks.push('The real background timer resends automatically after acknowledgement loss and the server keeps one result');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',passed:checks.length,checks,errors,productionRequests:0}));
 fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/finish-delivery-ui.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,errors,productionRequests:0},null,2)+'\n');
}catch(x){
 console.error(JSON.stringify({error:x.message,checks,pending:state.accounts?.[person.user.id]?.pending?.map(p=>({failureCode:p.failureCode,permanent:p.permanent})),run:state.accounts?.[person.user.id]?.run?.test?.id,resultPosts:calls.filter(r=>r.path==='/api/results').length,errors}));throw x;
}finally{releaseSave();if(browser)await browser.close();await new Promise(r=>server.close(r));}
