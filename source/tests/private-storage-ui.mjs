// Real app modules and Chromium. All transport and identities are synthetic;
// when PACKED_EXE is supplied every displayed asset comes from that exact PE.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {nativeStorageV2} from './fixtures/native-storage-v2.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../',import.meta.url).pathname;
if(process.env.PACKED_EXE){execFileSync('python3',[path.join(root,'tests/packed_image.py'),process.env.PACKED_EXE,'--root',root,'--metadata',process.env.PACKED_METADATA,'--output',path.join(root,'web'),'--check']);}
const group={id:'synthetic-group',name:'Ізольована група'};
const teacher={token:'synthetic-ui-teacher-token',user:{id:'teacher',username:'teacher',role:'instructor',fullName:'Модельний інструктор'}};
const cadet={token:'synthetic-ui-cadet-token',user:{id:'cadet',username:'cadet',role:'cadet',fullName:'Модельний курсант',groupId:group.id,groupName:group.name}};
const keys={teacher:'ab'.repeat(32),cadet:'cd'.repeat(32)},password='Synthetic-password-18';
let native,offline=false,expiry=false,browser,context,page;
const requests=[],checks=[],errors=[];
const makeNative=(rememberedSessions=false)=>nativeStorageV2({rememberedSessions,authorize:async(id,token)=>[teacher,cadet].some(s=>s.user.id===id&&s.token===token)});
native=makeNative();
function rpc(p){
 if(offline)return {ok:false,code:'NETWORK',error:'Ізольована відсутність мережі'};
 if(p.path==='/api/groups')return {ok:true,groups:[group]};
 if(p.path==='/api/challenge')return {ok:true,salt:'AAAAAAAAAAAAAAAAAAAAAA==',nonce:'isolated-ui-nonce'};
 if(p.path==='/api/login')return {ok:true,...(p.body.username==='cadet'?cadet:teacher)};
 if(expiry&&p.token)return {ok:false,code:'SESSION_EXPIRED',error:'Сеанс завершився. Увійдіть повторно.'};
 const s=p.token===cadet.token?cadet:teacher;
 if(p.path==='/api/instructor/question-bank')return s.user.role==='instructor'?{ok:true,questions:[{id:'private-bank',category:'Приватна категорія',question:{type:'choice',text:'PRIVATE-INSTRUCTOR-BANK',answers:[{id:'1',text:'PRIVATE-CORRECT-ANSWER',isCorrect:true},{id:'2',text:'Інша відповідь',isCorrect:false}],explanation:'PRIVATE-INSTRUCTOR-EXPLANATION'}}]}:{ok:false,code:'FORBIDDEN',error:'Лише для інструктора'};
 if(p.path==='/api/local-storage/key')return {ok:true,localStorageProtocol:2,userId:s.user.id,key:keys[s.user.id]};
 if(p.path==='/api/workspace')return {ok:true,workspaceProtocol:1,user:s.user,revisions:{groups:'ci',tests:'ci',results:'ci:recent'},changes:{groups:[group],tests:[],results:[],...(s.user.role==='instructor'?{cadets:[]}: {})},snapshotStable:true,resultTotal:0,capabilities:{}};
 if(p.path==='/api/account-state')return {ok:true,accountSyncProtocol:1,userId:s.user.id,cursor:'isolated',documents:[],stable:true};
 if(p.path==='/api/materials')return {ok:true,materials:[]};
 return {ok:false,code:'NOT_FOUND',error:'Ізольований маршрут перевірки'};
}
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://local').pathname;requests.push({route,method:req.method});
  res.setHeader('Content-Security-Policy',csp);res.setHeader('Cache-Control','no-store');
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  let body;if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);body=JSON.parse(Buffer.concat(chunks));}
  if(route==='/rpc'){requests.at(-1).rpcPath=body.path;json(rpc(body));return;}
  if(route.startsWith('/updates/')){json({ok:true,state:2,currentCode:143,currentVersion:'1.2.20',message:'Установлено актуальну версію.'});return;}
  if(route==='/ping'){json({ok:true});return;}
  if(route==='/clock'||/^\/(storage|vault|legacy)\//.test(route)){json(await native.local(route,body,req.headers['x-lk-vault']?{'X-LK-Vault':req.headers['x-lk-vault']}:{}));return;}
  if(route==='/state'||route==='/journal'){json({ok:false,code:'FORBIDDEN',error:'Global private storage is disabled'});return;}
  const name=route==='/'?'index.html':route.slice(1),file=path.resolve(root,'web',name);
  if(!file.startsWith(path.join(root,'web')+path.sep)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,code:error.code||'SERVER_ERROR',error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
async function check(name,fn){try{await fn();}catch(error){console.error('UI_FAILURE '+name+'\n'+(await page.locator('body').innerText()).slice(0,2500)+'\nPAGE_ERRORS '+JSON.stringify(errors)+'\nRECENT_ROUTES '+JSON.stringify(requests.slice(-20)));throw error;}checks.push(name);console.log('PASS '+name);}
async function open(){if(context)await context.close();context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(origin+'/?key=synthetic-ui-launch');await page.locator('#auth-form').waitFor();}
async function login(s,local=false,pass=password){await page.locator(`button[data-role="${s.user.role}"]`).click();await page.locator('[name=username]').fill(s.user.username);await page.locator('[name=password]').fill(pass);if(s.user.role==='cadet')await page.locator('[name=group]').selectOption({label:group.name});await page.locator(local?'[data-action=unlock-local]':'#auth-form button.primary').click();await page.getByRole('heading',{name:s.user.role==='instructor'?'Кабінет інструктора':/Вітаємо/}).waitFor();}
async function logout(){await page.locator('[data-action=logout]').click();await Promise.race([page.locator('#auth-form').waitFor(),page.getByRole('heading',{name:'Зміни ще не надіслані'}).waitFor()]);if(await page.locator('#modal').isVisible())await page.locator('#modal button.primary').click();await page.locator('#auth-form').waitFor();}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...((process.env.CHROMIUM_PATH||process.env.LITAKOVA_CHROMIUM_EXECUTABLE)?{executablePath:process.env.CHROMIUM_PATH||process.env.LITAKOVA_CHROMIUM_EXECUTABLE}:{})});
 await check('A real protocol-2 page starts locked and creates an encrypted account on online login',async()=>{await open();assert.equal(await page.locator('[data-action=unlock-local]').count(),1);await login(teacher);assert.ok(native.profile.accounts.teacher.fields.__session);});
 await check('A valid 200-question draft and answer-key cache save as bounded private chunks',async()=>{
  await page.evaluate(async()=>{const {account,persist}=await import('/app.js'),C=await import('/core.js');const a=account(),d={...C.newDraft(),title:'PRIVATE-UI-LARGE'};d.questions=Array.from({length:200},(_,i)=>({id:String(i+1),type:'choice',maxPoints:1,rubric:'',text:'П'.repeat(1000),explanation:'Р'.repeat(2000),answers:Array.from({length:6},(_,j)=>({id:String(j+1),text:'В'.repeat(500),isCorrect:j===0}))}));if(C.validateDraft(d))throw Error(C.validateDraft(d));a.draft=d;a.fullTests={'private-test':{questions:[{answers:[{text:'PRIVATE-ANSWER-KEY',isCorrect:true}]}]}};a.pcSync={revisions:{},shadow:{'test-draft':structuredClone(d)},requests:{},conflicts:{},cursor:''};await persist();});
  assert.ok(JSON.stringify(native.profile).length<100000);assert.ok(native.requests.every(r=>r.bytes<8*1024*1024));
  const disk=JSON.stringify(native.snapshot());for(const secret of ['PRIVATE-UI-LARGE','PRIVATE-ANSWER-KEY',teacher.token,password,keys.teacher])assert.equal(disk.includes(secret),false,secret);
 });
 await check('Logout removes private drafts and transient instructor views before a cadet signs in',async()=>{
  await page.evaluate(async()=>(await import('/app.js')).navigate('bank'));await page.getByText('PRIVATE-INSTRUCTOR-BANK',{exact:true}).waitFor();
  await logout();await login(cadet);const a=await page.evaluate(async()=>{const {account}=await import('/app.js');return account();});assert.equal(a.draft,null);assert.deepEqual(a.fullTests,{});
  await page.evaluate(async()=>(await import('/app.js')).navigate('bank'));const text=await page.locator('body').innerText();
  for(const secret of ['PRIVATE-UI-LARGE','PRIVATE-INSTRUCTOR-BANK','PRIVATE-CORRECT-ANSWER','PRIVATE-INSTRUCTOR-EXPLANATION'])assert.equal(text.includes(secret),false,secret);
  await page.getByRole('heading',{name:/Вітаємо/}).waitFor();await logout();
 });
 await check('A cold offline launch refuses a wrong password before opening private objects',async()=>{offline=true;await open();const before=native.opens;await page.locator('[name=username]').fill('teacher');await page.locator('[name=password]').fill('wrong-password');await page.locator('[data-action=unlock-local]').click();await page.getByText('Пароль не розблокував збережену копію.',{exact:false}).waitFor();assert.equal(native.opens,before);assert.equal(await page.locator('#auth-form').count(),1);});
 await check('Offline password unlock restores the full large draft without a login RPC',async()=>{const count=requests.filter(r=>r.route==='/rpc').length;await login(teacher,true);assert.equal(requests.filter(r=>r.route==='/rpc').length,count);assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft.questions.length),200);await page.locator('[data-action=edit-draft]').first().click();await page.locator('input[data-draft=title]').waitFor();assert.equal(await page.locator('input[data-draft=title]').inputValue(),'PRIVATE-UI-LARGE');});
 await check('A committed private journal restores the latest input when the full profile save fails',async()=>{native.faults.failPath='/storage/profile';const acknowledged=page.waitForResponse(r=>r.url().endsWith('/vault/journal')&&r.request().method()==='POST');await page.locator('input[data-draft=title]').fill('Latest private journal title');await acknowledged;await page.reload();native.faults.failPath='';await page.locator('#auth-form').waitFor();await login(teacher,true);assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft.title),'Latest private journal title');assert.equal(requests.some(r=>['/state','/journal'].includes(r.route)&&r.method==='POST'),false);});
 await check('Damage to the newest object restores a prior authenticated snapshot with a visible notice',async()=>{await page.evaluate(async()=>{const {account,persist}=await import('/app.js');account().draft.title='Backup UI A';await persist();account().draft.title='Backup UI B';await persist();});const id=native.profile.accounts.teacher.fields.draft.chunks[0];native.objects.get(id).cipher[0]^=1;await page.reload();await page.locator('#auth-form').waitFor();await login(teacher,true);assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft.title),'Backup UI A');await page.getByText('Дані відновлено з перевіреної резервної копії.',{exact:false}).waitFor();});
 await check('Session expiry locks private caches and requires a fresh unlock',async()=>{offline=false;const cap=native.activeCapability;expiry=true;await page.locator('[data-action=refresh]').first().click();await page.locator('#auth-form').waitFor();const id=native.profile.accounts.teacher.fields.draft.chunks[0];assert.equal(native.activeCapability,undefined);await assert.rejects(native.local('/vault/objects/'+id,undefined,{'X-LK-Vault':cap}),e=>e.code==='FORBIDDEN');expiry=false;});
 await check('A profile write failure cannot keep an expired session or native vault unlocked',async()=>{
  await login(teacher);const cap=native.activeCapability,id=native.profile.accounts.teacher.fields.draft.chunks[0];native.faults.failPath='/storage/profile';expiry=true;
  try{
   await page.evaluate(async()=>(await import('/app.js')).refresh(true));await page.locator('#auth-form').waitFor();assert.equal(native.activeCapability,undefined);
   await assert.rejects(native.local('/vault/objects/'+id,undefined,{'X-LK-Vault':cap}),e=>e.code==='FORBIDDEN');
   assert.equal(native.profile.accounts.teacher.fields.draft.chunks[0],id);assert.equal((await page.locator('body').innerText()).includes('Backup UI A'),false);
  }finally{native.faults.failPath='';expiry=false;}
 });
 await check('The real login migration preserves both owners and removes only a verified imported account',async()=>{await context.close();context=null;native=makeNative();const legacyId='12'.repeat(16);native.legacy.set(legacyId,{accounts:{teacher:{tests:[],results:[],cadets:[],fullTests:{},reviews:{},run:null,updatedAt:0,resultTotal:0,draft:{title:'Owned legacy draft',questions:[],localId:'legacy',localRevision:0},pending:[]},cadet:{pending:[{body:{submissionId:'preserved-foreign'}}]}},journal:{serial:5,kind:'draft',userId:'teacher',localId:'legacy',revision:1,patch:{scope:'root',prop:'title',value:'Last legacy journal input'}}});await open();await login(teacher);assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft.title),'Last legacy journal input');await page.waitForFunction(()=>!document.querySelector('[data-action=logout]')?.disabled);assert.equal(native.legacy.get(legacyId).accounts.teacher,undefined);assert.equal(native.legacy.get(legacyId).accounts.cadet.pending[0].body.submissionId,'preserved-foreign');assert.ok(native.completions>0);});
 await check('The last signed-in account opens after a real page restart without entering a password',async()=>{await context.close();context=null;native=makeNative(true);offline=false;expiry=false;await open();await login(teacher);await page.evaluate(async()=>{const {account,persist}=await import('/app.js');account().draft={...(await import('/core.js')).newDraft(),title:'REMEMBERED UI PRIVATE'};await persist();});const before=requests.filter(r=>r.rpcPath==='/api/login').length;await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();assert.equal(requests.filter(r=>r.rpcPath==='/api/login').length,before);assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft.title),'REMEMBERED UI PRIVATE');});
 await check('The saved account and its private draft open after restarting without internet',async()=>{offline=true;await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft.title),'REMEMBERED UI PRIVATE');});
 await check('Logout clears remembered login and another restart stays at the login screen',async()=>{await logout();await page.reload();await page.locator('#auth-form').waitFor();assert.equal((await native.local('/vault/remembered')).remembered,false);});
 await check('A different account becomes the only automatically restored account',async()=>{offline=false;await login(cadet);await page.reload();await page.getByRole('heading',{name:/Вітаємо/}).waitFor();assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft),null);assert.equal((await native.local('/vault/remembered')).owner,'cadet');assert.equal((await page.locator('body').innerText()).includes('REMEMBERED UI PRIVATE'),false);});
 await check('An expired remembered session is forgotten instead of reopening on every restart',async()=>{expiry=true;await page.reload();await page.locator('#auth-form').waitFor();expiry=false;await page.reload();await page.locator('#auth-form').waitFor();assert.equal((await native.local('/vault/remembered')).remembered,false);});
 await check('A damaged remembered-login file allows a fresh login and keeps the private draft',async()=>{await login(teacher);native.corruptRemembered();await page.reload();await page.locator('#auth-form').waitFor();assert.equal(await page.locator('[data-startup-error]').count(),0);await login(teacher);assert.equal(await page.evaluate(async()=>(await import('/app.js')).account().draft.title),'REMEMBERED UI PRIVATE');await page.reload();await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).waitFor();});
 await check('A failed forget write keeps the account open and visibly reports the failed logout',async()=>{native.faults.failPath='/vault/forget';await page.locator('[data-action=logout]').click();await Promise.race([page.getByRole('heading',{name:'Зміни ще не надіслані'}).waitFor(),page.locator('#toast').filter({hasText:'Synthetic'}).waitFor()]);if(await page.locator('#modal').isVisible())await page.locator('#modal button.primary').click();await page.locator('#toast').filter({hasText:'Synthetic'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Кабінет інструктора',exact:true}).count(),1);assert.equal((await native.local('/vault/remembered')).remembered,true);native.faults.failPath='';await logout();await page.reload();await page.locator('#auth-form').waitFor();});
 assert.deepEqual(errors,[]);
 const report={status:'passed',passed:checks.length,checks,actualChromiumRendered:true,nativeProtocol:2,actualAppExecuted:true,packedAssets:!!process.env.PACKED_EXE,actualWindowsHostExecuted:false,productionRPCRequests:0,pageErrors:errors};
 fs.mkdirSync(path.join(root,'verification'),{recursive:true});fs.writeFileSync(path.join(root,'verification/private-storage-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
