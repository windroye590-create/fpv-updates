import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../',import.meta.url).pathname;
const release=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
const work=path.resolve(root,'..');
const fixed=path.join(root,'build/packed-browser');
const broken=path.join(root,'build/packed-broken');
function unpack(exe,source,out,metadata){
 const summary=JSON.parse(execFileSync('python3',[path.join(root,'tests/packed_image.py'),exe,'--root',source,'--output',out,...(metadata?['--metadata',metadata]:[])],{encoding:'utf8'}));
 return {summary,dir:out,manifest:JSON.parse(fs.readFileSync(path.join(out,'manifest.json')))};
}
const next=unpack(process.env.PACKED_EXE||path.join(root,'build/FPV-Komisiia-PC.exe'),root,fixed,process.env.PACKED_METADATA);
let previous=null;
if(process.env.BROKEN_EXE&&process.env.BROKEN_SOURCE)previous=unpack(process.env.BROKEN_EXE,process.env.BROKEN_SOURCE,broken,process.env.BROKEN_METADATA);
assert.deepEqual(next.summary.missing,[]);
// Deliberately synthetic local RPC replies. No backend source, production
// identifiers, real accounts or Google services are used by this smoke test.
const group={id:'ci-group',name:'Ізольований тест запуску'};
const instructor={id:'ci-instructor',username:'fake_ci_instructor',fullName:'Інструктор ізольованого тесту',role:'instructor'};
const cadet={token:'isolated-cadet-token',user:{id:'ci-cadet',username:'fake_ci_cadet',fullName:'Курсант тестового запуску',role:'cadet',groupId:group.id,groupName:group.name}};
function mockRPC(p){
 const user=p.token===cadet.token?cadet.user:instructor;
 if(p.path==='/api/challenge')return {ok:true,salt:'AAAAAAAAAAAAAAAAAAAAAA==',nonce:'isolated-ci-challenge'};
 if(p.path==='/api/login')return {ok:true,token:'isolated-instructor-token',user:instructor};
 if(p.path==='/api/groups')return {ok:true,groups:[group]};
 if(p.path==='/api/workspace')return {ok:true,workspaceProtocol:1,user,revisions:{groups:'ci-1',tests:'ci-1',results:'ci-1:recent'},changes:{groups:[group],tests:[],results:[],...(user.role==='instructor'?{cadets:[]}: {})},snapshotStable:true,resultTotal:0,capabilities:{}};
 if(p.path==='/api/account-state')return {ok:true,accountSyncProtocol:1,userId:user.id,cursor:'ci-1',documents:[],stable:true};
 if(p.path==='/api/app-info')return {ok:true,platform:'windows-x64',latestVersionCode:release.versionCode,latestVersionName:release.version,downloadUrl:''};
 if(p.path==='/api/materials')return {ok:true,materials:[]};
 return {ok:false,code:'NOT_FOUND',error:'Isolated startup-only test route'};
}
const answer='Збережена письмова відповідь. '.repeat(90);
const pending={testTitle:'Збережена письмова робота',attempts:0,body:{submissionId:'pc-packed-pending',testId:'cached-work',userId:cadet.user.id,answers:[{questionId:'written-1',writtenAnswer:answer}],durationSeconds:5}};
const cached={version:1,theme:'dark',session:cadet,groups:[group],accounts:{[cadet.user.id]:{tests:[],results:[],cadets:[],fullTests:{},pending:[pending],reviews:{},draft:{title:'Збережена чернетка',questions:[]}}}};
const states=new Map(),journals=new Map(),requests=[],checks=[];
let active=next,blockModule=false,offline=false,slow=false,failRead=false,failJournal=false,slowJournal=false,waiting=[];
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://local'),key=req.headers['x-lk-key']||u.searchParams.get('key');
  requests.push({method:req.method,path:u.pathname,key});res.setHeader('Content-Security-Policy',csp);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(u.pathname==='/state'||u.pathname==='/journal'){
   const map=u.pathname==='/state'?states:journals;
   if(req.method==='POST'){const parts=[];for await(const part of req)parts.push(part);map.set(key,JSON.parse(Buffer.concat(parts)));json({ok:true});return;}
   if(failRead&&u.pathname==='/state'){json({ok:false,code:'STORAGE_READ',error:'Ізольована помилка читання збережених даних'});return;}
   if(failJournal&&u.pathname==='/journal'){json({ok:false,code:'STORAGE_READ',error:'Ізольована помилка читання журналу'});return;}
   if(slowJournal&&u.pathname==='/journal'){waiting.push(()=>json(map.get(key)||{}));return;}
   if(slow&&u.pathname==='/state'){waiting.push(()=>json(map.get(key)||{}));return;}
   json(map.get(key)||{});return;
  }
  if(u.pathname==='/clock'){json({ok:true,uptime:100000+performance.now(),launchId:'packed-browser'});return;}
  if(u.pathname.startsWith('/updates/')){json({ok:true,state:2,currentVersion:release.version,currentCode:release.versionCode,message:'Установлено актуальну версію.'});return;}
  if(u.pathname==='/rpc'){
   const parts=[];for await(const part of req)parts.push(part);const p=JSON.parse(Buffer.concat(parts));
   if(offline){json({ok:false,code:'NETWORK',error:'Ізольований тест без мережі'});return;}
   json(mockRPC(p));return;
  }
  if(u.pathname==='/ping'){json({ok:true});return;}
  const asset=blockModule&&u.pathname==='/public-table-sync.js'?null:active.manifest[u.pathname];
  if(asset){res.setHeader('Content-Type',asset.mime);res.end(fs.readFileSync(path.join(active.dir,asset.file)));return;}
  res.statusCode=400;json({ok:false,code:'FORBIDDEN'});
 }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:error.message,code:error.code||'SERVER_ERROR'}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
let context;
async function open(key,state={},journal={}){if(context)await context.close();states.set(key,structuredClone(state));journals.set(key,structuredClone(journal));context=await browser.newContext({viewport:{width:1200,height:800}});const p=await context.newPage();p.on('pageerror',error=>console.error('PACKED_BROWSER_ERROR '+error.message));await p.goto(origin+'/?key='+key);return p;}
async function check(name,fn){try{await fn();}catch(error){for(const p of context?.pages()||[])console.error('PACKED_UI_FAILURE '+name+'\n'+(await p.locator('body').textContent({})).slice(0,5000));throw error;}checks.push(name);console.log('PASS '+name);}
try{
 if(previous)await check('The published 1.2.15 EXE reproduces the missing module and frozen splash',async()=>{
  assert.ok(previous.summary.missing.includes('/public-table-sync.js'));active=previous;
  const p=await open('broken');await p.locator('.boot').filter({hasText:'Відкриваємо кабінет'}).waitFor();
  assert.equal(await p.locator('#auth-form').count(),0);assert.equal(requests.filter(r=>r.key==='broken'&&r.path==='/state').length,0);
  const response=await p.request.get(origin+'/public-table-sync.js');assert.equal(response.status(),400);active=next;
 });
 await check('All public assets and JavaScript routes exist in the fixed PE with exact bytes and MIME',async()=>{
  for(const [route,a] of Object.entries(next.manifest)){assert.ok(a.size>0);if(/\.(?:m?js)$/.test(route))assert.ok(a.mime.startsWith('text/javascript'));}
  assert.ok(next.manifest['/public-table-sync.js']);assert.ok(next.manifest['/boot.js']);
 });
 await check('A clean profile reaches login using only files extracted from the EXE',async()=>{
  const p=await open('fresh');await p.locator('#auth-form').waitFor();assert.equal(await p.locator('[data-startup]').count(),0);
  await p.locator('[name=username]').fill('fake_ci_instructor');await p.locator('[name=password]').fill('not-a-real-password');
  await p.locator('#auth-form button.primary').click();await p.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();
  assert.equal(states.get('fresh').session.user.role,'instructor');
 });
 await check('A saved offline session restores without losing queued answers or drafts',async()=>{
  offline=true;const p=await open('cached',cached);await p.getByRole('heading',{name:/Вітаємо/}).waitFor();
  const a=states.get('cached').accounts[cadet.user.id];assert.equal(a.pending[0].body.answers[0].writtenAnswer,answer);assert.equal(a.draft.title,cached.accounts[cadet.user.id].draft.title);
  assert.ok(await p.locator('body').evaluate(el=>el.classList.contains('dark')));
 });
 await check('The post-update return marker opens the profile and retains the queued written answer',async()=>{
  const p=await open('post-update',{...structuredClone(cached),updateReturnPage:'more',updateTargetCode:138});
  await p.getByRole('heading',{name:'Профіль',exact:true}).waitFor();
  assert.equal(states.get('post-update').updateReturnPage,undefined);
  assert.equal(states.get('post-update').accounts[cadet.user.id].pending[0].body.answers[0].writtenAnswer,answer);
 });
 await check('A failed initial read shows recovery and closing cannot overwrite saved data',async()=>{
  failRead=true;const p=await open('read-error',cached);await p.locator('[data-startup-error]').waitFor();
  await context.close();context=null;failRead=false;
  assert.deepEqual(states.get('read-error'),cached);
  assert.equal(requests.filter(r=>r.key==='read-error'&&r.method==='POST'&&r.path==='/state').length,0);
 });
 await check('A failed journal read cannot open or write an older state and retry restores the last answer',async()=>{
  const state=structuredClone(cached),uid=cadet.user.id;
  state.accounts[uid].run={test:{id:'journal-test',title:'Журнал',mode:'training',questions:[{id:'written',type:'written',text:'Пояснення',answers:[]}]},answers:{written:'Попередня відповідь'},submissionId:'journal-submission',localRevision:0,lastElapsed:10,startedUptime:0};
  const journal={serial:2,kind:'run',userId:uid,submissionId:'journal-submission',revision:1,answers:{written:'Остання відповідь після збереження'},index:0,lastElapsed:11};
  failJournal=true;const p=await open('journal-error',state,journal);await p.locator('[data-startup-error]').waitFor();
  assert.deepEqual(states.get('journal-error'),state);assert.deepEqual(journals.get('journal-error'),journal);
  assert.equal(requests.filter(r=>r.key==='journal-error'&&r.method==='POST'&&['/state','/journal'].includes(r.path)).length,0);
  failJournal=false;await p.getByRole('button',{name:'Повторити запуск',exact:true}).click();await p.getByRole('heading',{name:/Вітаємо/}).waitFor();
  assert.equal(states.get('journal-error').accounts[uid].run.answers.written,journal.answers.written);
 });
 await check('Closing during a stalled journal read preserves the complete profile and journal',async()=>{
  const journal={serial:4,kind:'run',userId:cadet.user.id,submissionId:'protected-journal',revision:2,answers:{written:'Не перезаписувати'}};
  slowJournal=true;const p=await open('journal-stalled',cached,journal);await p.locator('[data-startup-error]').waitFor({timeout:22000});
  await context.close();context=null;slowJournal=false;for(const resume of waiting.splice(0))resume();
  assert.deepEqual(states.get('journal-stalled'),cached);assert.deepEqual(journals.get('journal-stalled'),journal);
  assert.equal(requests.filter(r=>r.key==='journal-stalled'&&r.method==='POST'&&['/state','/journal'].includes(r.path)).length,0);
 });
 await check('A missing module shows recovery controls and retry opens the preserved account',async()=>{
  blockModule=true;const p=await open('retry',cached);await p.locator('[data-startup-error]').waitFor();
  assert.equal(await p.getByRole('button',{name:'Повторити запуск',exact:true}).count(),1);
  assert.equal(await p.getByRole('link',{name:'Завантажити програму',exact:true}).getAttribute('href'),'https://github.com/windroye590-create/fpv-updates/releases/latest/download/FPV-Komisiia-PC.exe');
  assert.deepEqual(states.get('retry'),cached);blockModule=false;
  await p.getByRole('button',{name:'Повторити запуск',exact:true}).click();await p.getByRole('heading',{name:/Вітаємо/}).waitFor();
  assert.equal(states.get('retry').accounts[cadet.user.id].pending[0].body.answers[0].writtenAnswer,answer);
 });
 await check('A stalled startup offers recovery and retry opens the cabinet after the disk responds',async()=>{
  slow=true;const p=await open('slow',cached);await p.locator('[data-startup-error]').waitFor({timeout:22000});
  assert.deepEqual(states.get('slow'),cached);assert.equal(requests.filter(r=>r.key==='slow'&&r.method==='POST'&&r.path==='/state').length,0);slow=false;
  await p.getByRole('button',{name:'Повторити запуск',exact:true}).click();
  await p.getByRole('heading',{name:/Вітаємо/}).waitFor();assert.equal(await p.locator('[data-startup-error]').count(),0);
  assert.equal(states.get('slow').accounts[cadet.user.id].pending[0].body.answers[0].writtenAnswer,answer);
  for(const release of waiting.splice(0))release();
 });
 await check('Errors after a successful launch cannot replace the opened cabinet with a startup warning',async()=>{
  const p=context.pages()[0];await p.evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{error:new Error('Isolated post-start test')})));
  assert.equal(await p.getByRole('heading',{name:/Вітаємо/}).count(),1);assert.equal(await p.locator('[data-startup-error]').count(),0);
 });
 fs.writeFileSync(path.join(root,'verification/packaged-startup.json'),JSON.stringify({status:'passed',version:release.version,assets:next.summary.assetCount,checks,productionWrites:false,physicalWindowsRuntimeVerified:false},null,2));
 console.log(JSON.stringify({status:'passed',passed:checks.length,packedAssets:next.summary.assetCount}));
}finally{for(const release of waiting.splice(0))release();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
