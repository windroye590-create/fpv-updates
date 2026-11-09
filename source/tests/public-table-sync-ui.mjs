import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as C from '../web/core.js';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken,credential}=await import('./fixtures/server_model.mjs');
let now=Date.now();const RealDate=Date;context.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Надійна таблиця UI'}).group;
const first={token:instructorToken,user:api('GET','/api/workspace',instructorToken).user};
const creds=credential('public-sync-ui-only');
const cadet=api('POST','/api/register','',{fullName:'Курсант перевірки UI',username:'public_sync_ui',groupId:group.id,...creds});
const other=api('POST','/api/register','',{fullName:'Інший курсант UI',username:'public_sync_ui_other',groupId:group.id,...creds});
function test(title){const d={...C.newDraft(),title,randomizeQuestions:false,randomizeAnswers:false,questions:[{text:'Оберіть правильну відповідь',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]}]};const t=api('POST','/api/instructor/tests',instructorToken,C.draftAPI(d,true)).test;const a=api('GET','/api/instructor/tests/'+t.id+'/access',instructorToken).test.access;api('POST','/api/instructor/tests/'+t.id+'/access',instructorToken,{scope:'all',open:true,expectedRevision:a.revision});return t;}
const t=test('Збереження без втрати відповідей');
const pub=context.publicResultsSheet_(),proto=Object.getPrototypeOf(pub.getRange(1,1)),set=proto.setValues,append=pub.appendRow;
let outage=false;
proto.setValues=function(...a){if(this.sheet===pub&&this.row>1&&outage)throw Error('Isolated public sheet failure');return set.apply(this,a);};
pub.appendRow=function(...a){if(outage)throw Error('Isolated public sheet failure');return append.apply(this,a);};
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))),root=new URL('../web/',import.meta.url).pathname,states=new Map(),journals=new Map(),errors=[];
for(const [key,actor] of [['cadet',cadet],['instructor',first],['other',other]]){states.set(key,{version:1,theme:'light',session:actor,groups:[group],accounts:{[actor.user.id]:{tests:[],results:[],cadets:[],fullTests:{},pending:[],reviews:{}}}});journals.set(key,{});}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.mjs':'text/javascript','.wasm':'application/wasm'};
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local'),key=req.headers['x-lk-key'];res.setHeader('Cache-Control','no-store');
 if(u.pathname==='/clock'){res.end(JSON.stringify({ok:true,uptime:100000+performance.now(),launchId:'public-sync-ui'}));return;}
 if(u.pathname.startsWith('/updates/')){res.end(JSON.stringify({ok:true,state:2,currentVersion:version.version,currentCode:version.versionCode,message:'Актуальна версія'}));return;}
 if(u.pathname==='/state'||u.pathname==='/journal'){const target=u.pathname==='/state'?states:journals;if(req.method==='POST'){const c=[];for await(const b of req)c.push(b);target.set(key,JSON.parse(Buffer.concat(c)));res.end('{"ok":true}');}else res.end(JSON.stringify(target.get(key)||{}));return;}
 if(u.pathname==='/rpc'){const c=[];for await(const b of req)c.push(b);res.end(context.doPost({postData:{contents:Buffer.concat(c).toString()}}).text);return;}
 const file=path.resolve(root,u.pathname==='/'?'index.html':u.pathname.slice(1));if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(e){errors.push(String(e));res.statusCode=500;res.end('Isolated harness error');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE}),origin='http://127.0.0.1:'+server.address().port;
async function pc(key){const c=await browser.newContext({viewport:{width:1360,height:900}}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/?key='+key);await p.locator('.topbar').filter({hasText:'Оновлено'}).waitFor();return {c,p};}
const checks=[];async function check(name,f){await f();checks.push(name);console.log('PASS '+name);}
const warning=p=>p.locator('#public-table-sync-status');let one=await pc('cadet');
try{
 await check('A real submission keeps its accepted result and shows a separate public-table warning',async()=>{await one.p.locator('.nav [data-page=tests]').click();await one.p.locator(`[data-action=start][data-id="${t.id}"]`).click();await one.p.locator('#modal button.primary').click();await one.p.locator('.runner').waitFor();await one.p.getByText('Так',{exact:true}).click();outage=true;await one.p.locator('[data-action=finish]').click();await one.p.locator('#modal button.primary').click();await warning(one.p).waitFor({state:'visible'});await one.p.getByText('Результат прийнято сервером комісії.',{exact:true}).waitFor();assert.equal(states.get('cadet').accounts[cadet.user.id].pending.length,0);assert.equal(api('GET','/api/my-results',cadet.token).results.find(r=>r.testId===t.id).score,100);});
 await check('Restarting the application preserves the warning without duplicating the submission',async()=>{await one.c.close();one=await pc('cadet');await warning(one.p).waitFor({state:'visible'});assert.equal(api('GET','/api/my-results',cadet.token).results.filter(r=>r.testId===t.id).length,1);});
 await check('Another cadet has no warning about someone else’s result',async()=>{const p=await pc('other');assert.equal(await warning(p.p).isVisible(),false);await p.c.close();});
 await check('The normal background poll clears the warning and publishes the missing row',async()=>{outage=false;now+=31000;await warning(one.p).waitFor({state:'hidden',timeout:20000});const r=api('GET','/api/my-results',cadet.token).results.find(r=>r.testId===t.id);assert.equal(Array.from(context.publicRowsFromSheet_(pub)).filter(x=>String(x[7])===String(r.id)).length,1);});
 const instructor=await pc('instructor');
 await check('The actual refresh-table button corrects ordinary result values and keeps custom notes',async()=>{const h=pub.rows[0],uid=h.indexOf('_ID курсанта'),rid=h.indexOf('_ID результату'),correct=h.indexOf('Правильних'),percent=h.indexOf('Правильних, %'),note=h.length;pub.maxColumns=Math.max(pub.maxColumns,note+1);h[note]='Примітка';const row=pub.rows.find(x=>String(x[uid])===String(cadet.user.id)&&String(x[rid]));row[correct]=0;row[percent]=0;row[note]='Зберегти примітку';await instructor.p.locator('.nav [data-page=more]').click();await instructor.p.locator('[data-action=sync-sheet]').click();await instructor.p.locator('#toast').filter({hasText:'Таблицю оновлено'}).waitFor();assert.equal(row[correct],1);assert.equal(row[percent],1);assert.equal(row[note],'Зберегти примітку');});
 await check('The warning fits a narrow dark window without changing results',async()=>{const next=test('Ще одна робота для таблиці'),sid='pc-ui-warning-'+crypto.randomUUID(),start=api('POST','/api/tests/'+next.id+'/start',cadet.token,{submissionId:sid});outage=true;api('POST','/api/results',cadet.token,{testId:next.id,submissionId:sid,startPermit:start.startPermit,writtenProtocol:1,choiceProtocol:2,answers:[{questionId:next.questions[0].id,answerId:next.questions[0].answers[0].id}]});await one.p.locator('[data-action=refresh]').click();await warning(one.p).waitFor({state:'visible'});await one.p.locator('[data-action=theme]').click();await one.p.setViewportSize({width:620,height:900});assert.ok(await one.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.equal(await warning(one.p).isVisible(),true);});
 assert.deepEqual(errors,[]);fs.writeFileSync(new URL('../verification/public-table-sync-ui.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,errors,productionWrites:false},null,2));console.log(JSON.stringify({status:'passed',passed:checks.length}));
}finally{proto.setValues=set;pub.appendRow=append;await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
