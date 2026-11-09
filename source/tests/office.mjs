import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateDraft,newDraft,applyCheckpoint} from '../web/core.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('./fixtures/office/',import.meta.url),cases=JSON.parse(fs.readFileSync(new URL('cases.json',root)));
const server=http.createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'");if(req.url==='/office-import.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(new URL('../web/office-import.js',import.meta.url)));}else res.end('<!doctype html><meta charset="utf-8"><title>Office parser verification</title>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const checks=[],parserChecks=[];
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.LITAKOVA_CHROMIUM_EXECUTABLE});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 for(const test of cases){const bytes=fs.readFileSync(new URL(test.file,root));const result=await page.evaluate(async({file,bytes})=>{try{const mod=await import('/office-import.js'),r=await mod.importOffice(file,Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));return {count:r.questions.length,keys:r.questions.map(q=>q.answers.findIndex(a=>a.isCorrect)),ready:r.questions.filter(q=>!mod.importQuestionError(q)).length,warnings:r.warnings,text:r.questions.map(q=>q.text).join('\n')};}catch(error){return {error:error.message};}},{file:test.file,bytes:bytes.toString('base64')});
  if(test.error)assert.ok(result.error?.toLowerCase().includes(test.error.toLowerCase()),JSON.stringify({test,result}));
  else{assert.ok(!result.error,JSON.stringify({test,result}));assert.equal(result.count,test.count,test.file);assert.equal(result.ready,test.ready,test.file);if(test.keys)assert.deepEqual(result.keys,test.keys,test.file);if(test.warnings)assert.ok(result.warnings.length,test.file);if(test.contains)assert.ok(result.text.includes(test.contains),test.file);}
  checks.push(test.file);console.log('PASS Office '+test.file);
 }
 const variants=await page.evaluate(async()=>{
  const mod=await import('/office-import.js'),out=[];
  for(const format of ['word','excel'])for(const labels of [['А','Б'],['А','Б','В'],['А','В']]){
   const result=format==='word'
    ?mod.parseWordLines(['1. Питання?',...labels.map(label=>label+') Варіант '+label),'Правильна відповідь: А'],'variants.docx')
    :mod.parseSheetRows([{name:'Тест',rows:[['Питання',...labels,'Правильна відповідь'],['Питання?',...labels.map(label=>'Варіант '+label),'А']]}],'variants.xlsx');
   const q=result.questions[0];out.push({format,labels,answers:q.answers.map(a=>a.text),correct:q.answers.findIndex(a=>a.isCorrect),error:mod.importQuestionError(q)});
  }
  // A declared but empty final answer must still be reviewed as a missing option.
  const q=mod.parseSheetRows([{name:'Тест',rows:[['Питання','А','Б','В','Правильна відповідь'],['Питання?','Так','Ні','','А']]}],'missing.xlsx').questions[0];
  out.push({format:'excel-empty-final',labels:['А','Б','В'],answers:q.answers.map(a=>a.text),correct:q.answers.findIndex(a=>a.isCorrect),error:mod.importQuestionError(q)});
  return out;
 });
 for(const result of variants){
  assert.equal(result.correct,0,JSON.stringify(result));
  const gap=result.labels.join('')==='АВ',missing=result.format==='excel-empty-final';
  assert.equal(result.answers.length,gap?3:result.labels.length,JSON.stringify(result));
  if(gap){assert.equal(result.answers[1],'');assert.ok(result.error,JSON.stringify(result));}
  else if(missing){assert.equal(result.answers[2],'');assert.ok(result.error,JSON.stringify(result));}
  else assert.equal(result.error,'',JSON.stringify(result));
  const label=result.format+' '+result.labels.join('/')+(missing?' empty final':'');parserChecks.push(label);console.log('PASS Office variants '+label);
 }
 const draft={...newDraft(),title:'Імпорт',questions:[{id:'0',text:'Питання?',answers:['1','2','3','4'].map((text,i)=>({id:'0',text,isCorrect:i===2}))}],importSource:'sample.docx',importWarnings:['Перевірте текст.'],importReviewed:false};
 assert.ok(validateDraft(draft));draft.importReviewed=true;assert.equal(validateDraft(draft),'');draft.questions[0].answers.forEach(a=>a.isCorrect=false);assert.ok(validateDraft(draft));
 const state={accounts:{u:{draft}}};assert.ok(applyCheckpoint(state,{kind:'draft',userId:'u',localId:draft.localId,revision:1,patch:{scope:'root',prop:'importReviewed',value:false}}));assert.equal(draft.importReviewed,false);
 fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
 fs.writeFileSync(new URL('../verification/office-import.json',import.meta.url),JSON.stringify({passed:checks.length+parserChecks.length,files:checks,parserCases:parserChecks,reviewGate:true,checkpointPreserved:true,engine:'Chromium actual office-import.js'},null,2)+'\n');
 console.log('Office import: '+checks.length+' files, '+parserChecks.length+' option-count cases and review gate passed');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
