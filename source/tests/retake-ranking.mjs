import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
import {latestResults,testSeriesResolver} from '../web/result-attempts.js';
import {buildRanking} from '../web/results.js';
import {reportModel} from '../web/excel-report.js';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,context,credential,instructorToken,regressionTest,regressionBody}=await import('./fixtures/server_model.mjs');
const checks=[];async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
const group=api('POST','/api/instructor/groups',instructorToken,{name:'Перездача метеорології'}).group;
const cadet=api('POST','/api/register','',{username:'meteo-ranking',fullName:'Курсант перездачі',groupId:group.id,...credential('retake-ranking-password')});
const oldTest=regressionTest('Метеорологія з опискою'),oldResult=api('POST','/api/results',cadet.token,regressionBody(oldTest,'meteo-original')).result;
let editedTest,newResult,results,tests;
await check('Correcting words creates an explicit version link, without exposing creation receipts',async()=>{
 const body={title:'Метеорологія',questions:oldTest.questions.map(q=>({...q,text:'Виправлений текст'})),mode:'training',published:true,requestId:crypto.randomUUID()};
 editedTest=api('POST','/api/instructor/tests/'+oldTest.id+'/replace',instructorToken,body).test;
 const payload=regressionBody(editedTest,'meteo-retake');payload.answers[0].answerId=editedTest.questions[0].answers[1].id;
 newResult=api('POST','/api/results',cadet.token,payload).result;
 results=api('GET','/api/my-results',cadet.token).results;
 tests=api('GET','/api/tests',cadet.token).tests.filter(t=>String(t.id)===String(editedTest.id));
 assert.equal(String(editedTest.id)===String(oldTest.id),false);
 assert.equal(results.find(r=>String(r.id)===String(newResult.id)).canonicalTestId,String(oldTest.id));
 assert.equal(tests.find(t=>String(t.id)===String(editedTest.id)).canonicalTestId,String(oldTest.id));
 assert.equal(JSON.stringify(tests).includes(body.requestId),false);
 assert.ok(results.some(r=>String(r.id)===String(oldResult.id)),'The original work is retained');
});
await check('The latest lower result replaces the previous higher score, independently of input order',()=>{
 for(const rows of [results,[...results].reverse()]){
  const latest=latestResults(rows,tests);assert.equal(latest.length,1);assert.equal(String(latest[0].id),String(newResult.id));assert.equal(latest[0].correct,0);
  const ranking=buildRanking({results:rows,tests,cadets:[cadet.user]},group.name);
  assert.equal(ranking.tests.length,1);assert.equal(ranking.rows[0].total,0);assert.equal(String(ranking.rows[0].cells[0].result.id),String(newResult.id));
 }
});
await check('Repeated replacement versions resolve to the original even for an older client without requestId',()=>{
 const next=api('POST','/api/instructor/tests/'+editedTest.id+'/replace',instructorToken,{title:'Метеорологія: уточнення',mode:'training',questions:editedTest.questions,published:true}).test;
 const catalog=api('GET','/api/tests',cadet.token).tests,metadata=catalog.find(t=>String(t.id)===String(next.id));
 assert.equal(metadata.canonicalTestId,String(oldTest.id));
 assert.equal(testSeriesResolver(catalog)(next.id),String(oldTest.id));
});
await check('A separately created same-title test and another group remain independent',()=>{
 const copy={...newResult,id:'separate-result',testId:'separate-test',canonicalTestId:'separate-test'};
 const elsewhere={...newResult,id:'elsewhere',groupName:'Інша група'};
 assert.equal(latestResults([...results,copy,elsewhere],tests).length,3);
 assert.equal(latestResults([...results,elsewhere],tests,{byGroup:false}).length,1);
 const ranking=buildRanking({results:[...results,copy,elsewhere],tests,cadets:[cadet.user]},group.name);
 assert.equal(ranking.tests.length,2);assert.equal(ranking.rows[0].completed,2);
});
await check('Equal completion timestamps use a stable numeric result ID; corrupt links do not merge tests',()=>{
 const a={...newResult,id:'9'},b={...newResult,id:'10'};
 for(const input of [[a,b],[b,a]])assert.equal(latestResults(input)[0].id,'10');
 const resolve=testSeriesResolver([{id:'a',replacesId:'b'},{id:'b',replacesId:'a'}]);assert.equal(resolve('a'),'a');assert.equal(resolve('b'),'b');
});
await check('The actual My Results filter removes superseded attempts before search and pagination',()=>{
 const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 const handler=app.match(/^function filteredResults\(\).*$/m)[0];
 const box={latestResults,account:()=>({results,tests}),instructor:()=>false,matchesResultQuery:()=>true};vm.createContext(box);vm.runInContext(handler,box);
 assert.equal(box.filteredResults().length,1);assert.equal(String(box.filteredResults()[0].id),String(newResult.id));
 box.instructor=()=>true;assert.equal(box.filteredResults().length,2,'The teacher keeps the work history');
});
await check('An Excel matrix counts the last version once while preserving both original works',()=>{
 const model=reportModel({results,tests,cadets:[cadet.user]});
 assert.equal(model.sheets[0].rows.length,2);assert.equal(model.sheets[1].columns.length,6);
 assert.equal(model.sheets[1].rows[0][3].v,0);assert.equal(model.sheets[1].rows[0].at(-2),1);
});
await check('Upgrading an existing report fills canonical keys without replaying a stale backup or changing manual cells',()=>{
 const sheet=context.publicResultsSheet_(),book=context.publicResultsSpreadsheet_(false),props=context.PropertiesService.getScriptProperties();
 const column=sheet.rows[0].indexOf('_Ключ тесту');assert.ok(column>=0);
 sheet.rows[0][column]='Ручна нотатка';for(const row of sheet.rows.slice(1))row[column]='Зберегти';
 const before=JSON.stringify(sheet.rows),count=sheet.rows.length,width=sheet.maxColumns;
 props.deleteProperty('LK_PUBLIC_TEST_KEYS_V1_'+book.getId());context.publicLayouts_=[];
 context.ensurePublicResultsSheet_(book);
 assert.equal(sheet.rows.length,count);assert.equal(sheet.maxColumns,width+1);
 const key=sheet.rows[0].indexOf('_Ключ тесту'),resultId=sheet.rows[0].indexOf('_ID результату');
 assert.equal(JSON.stringify(sheet.rows.map(row=>row.slice(0,width))),before);
 for(const result of [oldResult,newResult])assert.equal(String(sheet.rows.find(row=>String(row[resultId])===String(result.id))[key]),String(oldTest.id));
 context.ensurePublicResultsSheet_(book);assert.equal(sheet.maxColumns,width+1);
});
fs.writeFileSync(new URL('../verification/retake-ranking.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0},null,2)+'\n');
