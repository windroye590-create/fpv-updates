import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {chromium} from 'playwright';

const release=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
const events=[];
let state={},dropWrites=false;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://local');
  const parts=[];for await(const part of req)parts.push(part);
  const raw=Buffer.concat(parts).toString();
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(url.pathname.startsWith('/window/')){
   events.push({event:url.pathname,body:JSON.parse(raw),key:req.headers['x-lk-key']||url.searchParams.get('key')});
   json({ok:true,windowLifecycleProtocol:1});return;
  }
  if(url.pathname==='/storage/status'){json({ok:true,storageProtocol:1});return;}
  if(url.pathname==='/state'){
   if(req.method==='POST'){if(dropWrites){req.socket.destroy();return;}state=JSON.parse(raw);json({ok:true});}
   else json(state);return;
  }
  if(url.pathname==='/journal'){json({});return;}
  if(url.pathname==='/clock'){json({ok:true,uptime:100000,launchId:'isolated-host-test'});return;}
  if(url.pathname.startsWith('/updates/')){json({ok:true,state:2,currentCode:release.versionCode,currentVersion:release.version,message:'Актуальна версія.'});return;}
  if(url.pathname==='/rpc'){const p=JSON.parse(raw);json(p.path==='/api/groups'?{ok:true,groups:[]}:{ok:false,code:'NOT_FOUND'});return;}
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(relative.split('/').includes('..'))throw Error('Invalid path');
  const file=new URL('../web/'+relative,import.meta.url);
  const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.wasm':'application/wasm'};
  res.setHeader('Content-Type',mime[relative.slice(relative.lastIndexOf('.'))]||'application/octet-stream');
  res.end(fs.readFileSync(file));
 }catch(error){res.statusCode=400;res.end(JSON.stringify({ok:false,error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext();
try{
 const page=await context.newPage();await page.goto(origin+'/?key=synthetic-host-key');
 await page.locator('#auth-form').waitFor();
 assert.equal(events[0].event,'/window/open');
 const first=events[0].body.windowId;
 await page.reload();await page.locator('#auth-form').waitFor();
 await page.waitForFunction(()=>Boolean(document.querySelector('#auth-form')));
 const second=events.filter(e=>e.event==='/window/open').at(-1).body.windowId;
 assert.notEqual(first,second);
 assert.ok(events.some(e=>e.event==='/window/close'&&e.body.windowId===first));
 console.log('PASS real page load and reload register distinct window IDs and close only the previous window');
 dropWrites=true;
 const error=await page.evaluate(async()=>{
  try{await (await import('/app.js')).persist();return null;}
  catch(error){return {code:error.code,message:error.message};}
 });
 assert.equal(error.code,'LOCAL_HOST_UNAVAILABLE');assert.match(error.message,/локальним модулем/);
 await page.locator('#toast').filter({hasText:'Втрачено зв’язок із локальним модулем'}).waitFor();
 dropWrites=false;
 console.log('PASS an actual lost local connection shows a Ukrainian recovery message');
 const next=await context.newPage();await next.goto(origin+'/?key=synthetic-host-key');await next.locator('#auth-form').waitFor();
 const active=events.filter(e=>e.event==='/window/open').at(-1).body.windowId;
 await page.locator('.boot').filter({hasText:'Відкрито нове вікно'}).waitFor();
 const closeCount=events.filter(e=>e.event==='/window/close').length;
 await page.close();
 assert.equal(events.filter(e=>e.event==='/window/close').length,closeCount);
 const closed=new Promise(resolve=>server.on('request',req=>{if(req.url.startsWith('/window/close'))resolve();}));
 await next.close();await closed;
 // The request event fires before its body is consumed; wait for server work.
 for(let n=0;n<20&&!events.some(e=>e.event==='/window/close'&&e.body.windowId===active);n++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(events.some(e=>e.event==='/window/close'&&e.body.windowId===active));
 assert.ok(events.every(e=>e.key==='synthetic-host-key'));
 console.log('PASS replacing and closing actual tabs cannot close the active replacement window; beacons retain local authentication');
 fs.writeFileSync(new URL('../verification/host-window-ui.json',import.meta.url),JSON.stringify({status:'passed',browser:'headless Chromium on Linux',checks:4,actualWindowsRuntimeExecuted:false,productionRequests:0},null,2));
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
