import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {chromium} from 'playwright';
import {handleHostWindow} from './fixtures/host-window.mjs';

const release=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/group-statement.json',import.meta.url)));
const library='/vendor/jspdf.umd.min.js',font='/statement-font.ttf',checks=[],pageErrors=[],external=[],pending=new Set();
let mode='valid',requests=[];
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');requests.push(url.pathname);
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',csp);res.setHeader('X-Content-Type-Options','nosniff');
 if(handleHostWindow(req,res))return;
 const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 try{
  if(url.pathname==='/storage/status'){json({ok:true,storageProtocol:1});return;}
  if(url.pathname==='/state'||url.pathname==='/journal'){for await(const part of req){}json({});return;}
  if(url.pathname==='/clock'){json({ok:true,uptime:100000,launchId:'pdf-export-isolated'});return;}
  if(url.pathname.startsWith('/updates/')){json({ok:true,state:2,currentCode:release.versionCode,currentVersion:release.version,message:'Актуальна версія.'});return;}
  if(url.pathname==='/rpc'){
   const parts=[];for await(const part of req)parts.push(part);const p=JSON.parse(Buffer.concat(parts));
   json(p.path==='/api/groups'?{ok:true,groups:[]}:{ok:false,code:'NOT_FOUND'});return;
  }
  if(url.pathname===library){
   if(mode==='network-error'){res.writeHead(503);res.end('Temporarily unavailable');return;}
   if(mode==='invalid'){res.setHeader('Content-Type','text/javascript');res.end('/* No PDF constructor */');return;}
   if(mode==='stall'){pending.add(res);res.on('close',()=>pending.delete(res));return;}
  }
  const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(relative.split('/').includes('..'))throw Error('Invalid path');
  const ext=relative.slice(relative.lastIndexOf('.'));
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.wasm':'application/wasm'})[ext]||'application/octet-stream');
  res.end(fs.readFileSync(new URL('../web/'+relative,import.meta.url)));
 }catch(error){res.statusCode=500;res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.LITAKOVA_CHROMIUM_EXECUTABLE?{executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE}:{})});
const count=path=>requests.filter(value=>value===path).length;
function pass(name){checks.push(name);console.log('PASS '+name);}
async function open(clock=false){
 mode='valid';requests=[];
 const context=await browser.newContext();
 await context.route('**/*',route=>{
  if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
 if(clock)await page.clock.install();
 await page.goto(origin+'/?key=isolated-pdf-export');await page.locator('#auth-form').waitFor();
 await page.evaluate(async raw=>{
  const m=await import('/statement.js');
  globalThis.pdfTestStatement=m.buildStatement({...raw,tests:m.statementTests(raw.tests,raw.results)},'g1','t1',raw.date);
 },fixture);
 return {context,page};
}
async function exportPdf(page,copies=1){
 return page.evaluate(async copies=>{
  try{
   const {statementPdf}=await import('/statement.js');
   const values=await Promise.all(Array.from({length:copies},()=>statementPdf(globalThis.pdfTestStatement)));
   return {pdfs:values.map(({bytes})=>({header:new TextDecoder().decode(bytes.slice(0,5)),size:bytes.length,pages:(new TextDecoder('latin1').decode(bytes).match(/\/Type\s*\/Page\b/g)||[]).length}))};
  }catch(error){return {error:error.message};}
 },copies);
}
function valid(result,copies=1){
 assert.equal(result.error,undefined);assert.equal(result.pdfs.length,copies);
 for(const pdf of result.pdfs){assert.equal(pdf.header,'%PDF-');assert.equal(pdf.pages,1);assert.ok(pdf.size>10000);}
}
try{
 const first=await open();
 try{
  assert.equal(count(library),0);assert.equal(count(font),0);assert.equal(requests.some(path=>path.startsWith('/vendor/pdfjs/')),false);
  pass('The real application reaches sign-in without loading PDF export, its font or the materials viewer');
  valid(await exportPdf(first.page,3),3);assert.equal(count(library),1);assert.equal(count(font),1);
  pass('Three concurrent exports share one local library and font load and produce real one-page PDFs');
  valid(await exportPdf(first.page));assert.equal(count(library),1);assert.equal(count(font),1);
  pass('Further exports reuse the loaded library even when HTTP caching is disabled');
 }finally{await first.context.close();}
 for(const failure of ['network-error','invalid']){
  const run=await open();
  try{
   await run.page.locator('#auth-form input').first().fill('Збережений ввід');mode=failure;
   const result=await exportPdf(run.page);assert.match(result.error,/модуль PDF/);assert.equal(count(library),1);
   assert.equal(await run.page.locator('#auth-form input').first().inputValue(),'Збережений ввід');
   mode='valid';valid(await exportPdf(run.page));assert.equal(count(library),2);assert.equal(count(font),1);
   pass((failure==='invalid'?'A malformed local module':'A failed local module request')+' preserves the page and allows retry without restarting');
  }finally{await run.context.close();}
 }
 const stalled=await open(true);
 try{
  mode='stall';const received=stalled.page.waitForRequest(request=>new URL(request.url()).pathname===library);
  const result=exportPdf(stalled.page);await received;await stalled.page.clock.fastForward(15001);
  assert.match((await result).error,/модуль PDF/);assert.equal(count(library),1);
  mode='valid';valid(await exportPdf(stalled.page));assert.equal(count(library),2);
  pass('A stalled module load times out and the next export can load it again');
 }finally{await stalled.context.close();}
 assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);
 const root=new URL('../verification/',import.meta.url);fs.mkdirSync(root,{recursive:true});
 fs.writeFileSync(new URL('pdf-export-ui.json',root),JSON.stringify({status:'passed',version:release.version,checks,passed:checks.length,jspdfRequestsBeforeExport:0,avoidedStartupBytes:fs.statSync(new URL('../web'+library,import.meta.url)).size,actualChromiumRendered:true,productionRequests:0},null,2)+'\n');
}finally{
 for(const response of pending)response.destroy();
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
