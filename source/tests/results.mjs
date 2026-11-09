import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
import {choiceSummary,compactResults,buildRanking,searchRanking,rankingTable,rankingCSV} from '../web/results.js';

const checks=[];
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
const cadet=(id,name='Курсант '+id,groupName='Група 1')=>({id,role:'cadet',username:'login_'+id,fullName:name,groupName});
const result=(userId,testId,correct=2,extra={})=>({id:userId+'-'+testId,userId,userName:'Курсант '+userId,groupName:'Група 1',testId,testTitle:'Тест '+testId,total:3,choiceTotal:3,correct,score:67,passed:false,durationSeconds:89,completedAt:'2026-10-26T10:00:00Z',...extra});
const source=()=>({cadets:[cadet('a'),cadet('b'),cadet('c')],tests:[{id:'1',title:'Тест 1',published:true},{id:'2',title:'Тест 2',published:true}],results:[result('a','1',2),result('a','2',1),result('b','1',3)]});
const row=(ranking,id)=>ranking.rows.find(r=>r.userId===id);

await check('Ranking adds correct choice answers across all tests, ignoring percentages and written points',()=>{
 const s=source();s.results[0]={...s.results[0],total:5,choiceTotal:3,earnedPoints:200,maxPoints:250,score:99};s.sharedFilters={testId:'1'};
 const r=buildRanking(s,'Група 1');assert.equal(row(r,'a').total,3);assert.equal(row(r,'b').total,3);assert.equal(r.tests.length,2);
});
await check('Equal totals share a place and search preserves their original ranking positions',()=>{
 const s=source();s.results.push(result('c','1',1));const r=buildRanking(s,'Група 1');
 assert.deepEqual(r.rows.map(x=>x.rank),[1,1,3]);assert.equal(searchRanking(r,'Курсант c').rows[0].rank,3);
});
await check('An unattempted test is absent while a submitted zero remains a real zero',()=>{
 const s=source();s.results=[result('a','1',0)];const r=buildRanking(s,'Група 1');
 assert.equal(row(r,'a').total,0);assert.equal(row(r,'a').rank,1);assert.equal(row(r,'b').total,null);assert.equal(row(r,'b').rank,null);assert.equal(row(r,'a').cells[1].result,null);
});
await check('Cadets with identical names remain separate by user ID',()=>{
 const s=source();s.cadets=[cadet('a','Однаковий Курсант'),cadet('b','Однаковий Курсант')];
 const r=buildRanking(s,'Група 1');assert.equal(r.rows.length,2);assert.equal(row(r,'a').total,3);assert.equal(row(r,'b').total,3);assert.match(rankingTable(r),/login_a/);assert.match(rankingTable(r),/login_b/);
});
await check('Scores from other groups never leak into a group total',()=>{
 const s=source();s.cadets.push(cadet('d','Інша Група','Група 2'));s.results.push(result('a','2',3,{id:'other',groupName:'Група 2'}),result('d','1',3,{groupName:'Група 2'}));
 const r=buildRanking(s,'Група 1');assert.equal(row(r,'a').total,3);assert.equal(row(r,'d'),undefined);
});
await check('Transferred cadets retain their historical group result without borrowing another group score',()=>{
 const s=source();s.cadets[0].groupName='Група 2';const old=buildRanking(s,'Група 1'),next=buildRanking(s,'Група 2');
 assert.equal(row(old,'a').total,3);assert.equal(row(old,'a').historical,true);assert.equal(row(next,'a').total,null);
});
await check('Legacy duplicate attempts contribute only the latest result per user and test',()=>{
 const s=source();s.results.push(result('a','1',3,{id:'new',completedAt:'2026-10-27T10:00:00Z'}));
 assert.equal(row(buildRanking(s,'Група 1'),'a').total,4);s.results.reverse();assert.equal(row(buildRanking(s,'Група 1'),'a').total,4);
});
await check('Unpublished and unrelated assigned tests are excluded; deleted tests with group results remain',()=>{
 const s=source(),assigned='[[LK-GROUPS:'+Buffer.from(JSON.stringify(['Група 2'])).toString('base64')+']]';
 s.tests.push({id:'draft',title:'Чернетка',published:false},{id:'other',title:'Інша група',description:assigned},{id:'retry',title:'Повтор',description:'[[LK-RETRY:a]]'});s.results.push(result('a','deleted',1));
 assert.deepEqual(buildRanking(s,'Група 1').tests.map(t=>t.id),['1','2','deleted']);
});
await check('Mixed work awaiting manual grading still counts only its known choice answers',()=>{
 const s=source();s.results=[result('a','1',2,{total:5,choiceTotal:3,gradingStatus:'pending_review',pendingWritten:2,score:null,passed:null})];
 const r=buildRanking(s,'Група 1');assert.equal(row(r,'a').total,2);assert.match(rankingTable(r),/Письмові на перевірці/);assert.doesNotMatch(rankingTable(r),/null%/);
});
await check('Written-only work has no choice total or false zero and can still be opened',()=>{
 const s=source();s.results=[result('a','1',0,{total:2,choiceTotal:0,earnedPoints:10,maxPoints:10})];const r=buildRanking(s,'Група 1');
 assert.equal(row(r,'a').total,null);assert.match(rankingTable(r),/Письмовий/);assert.match(rankingTable(r),/data-action="grade-result"/);
 const html=compactResults(s.results,{instructor:true});assert.equal((html.match(/class="result-number">—<\/td>/g)||[]).length,2);
});
await check('Unconfirmed recoveries and local pending work are excluded from the official ranking',()=>{
 const s=source();s.examRecoveries=[{...result('a','2',3),status:'pending'}];s.pending=[{...result('a','2',3)}];
 assert.equal(row(buildRanking(s,'Група 1'),'a').total,3);
});
await check('Malformed counts cannot inflate a ranking or create negative errors',()=>{
 for(const extra of [{correct:4},{correct:-1},{correct:NaN},{choiceTotal:-2},{choiceTotal:'3'}])assert.equal(choiceSummary(result('a','1',2,extra)),null);
 const s=source();s.results=[result('a','1',100)];assert.equal(row(buildRanking(s,'Група 1'),'a').total,null);
});
await check('The complete group is retained, including 27 cadets and larger groups',()=>{
 const s=source();s.cadets=Array.from({length:28},(_,i)=>cadet(String(i)));s.results=[];
 assert.equal(buildRanking(s,'Група 1').rows.length,28);
});
await check('Duplicate test titles get distinct columns and identifiers',()=>{
 const s=source();s.tests[1].title='Тест 1';const r=buildRanking(s,'Група 1');
 assert.equal(new Set(r.tests.map(t=>t.label)).size,2);assert.ok(r.tests.every(t=>t.label.includes('№')));
});
await check('Rendering and export escape supplied names, tests, and formula-like spreadsheet content',()=>{
 const s=source();s.cadets[0].fullName='<img src=x onerror=alert(1)>';s.tests[0].title='=HYPERLINK("x")';s.cadets[1].fullName='  =SUM(A1:A2)';
 const r=buildRanking(s,'Група 1');assert.doesNotMatch(rankingTable(r),/<img/);assert.match(rankingTable(r),/&lt;img/);const csv=rankingCSV(r);
 assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/'=HYPERLINK\(""x""\)/);assert.match(csv,/'  =SUM/);
});
await check('CSV exports the chosen visible ranking and preserves blank totals rather than invented zero',()=>{
 const r=searchRanking(buildRanking(source(),'Група 1'),'Курсант c'),csv=rankingCSV(r);
 assert.equal(csv.split('\r\n').length,2);assert.equal(csv.split('\r\n')[1].split(';')[2],'""');assert.doesNotMatch(csv,/Курсант a/);
 assert.deepEqual(csv.slice(1).split('\r\n')[0].split(';').slice(0,3),['"Місце"','"ПІБ курсанта"','"Усього правильних"']);
});
await check('Group summaries retain the complete group while searching or paging the ranking',()=>{
 const ranking=buildRanking(source(),'Група 1');
 assert.deepEqual(ranking.summary,{participants:3,tests:2,completedAll:1,best:3});
 const selected=searchRanking(ranking,'Курсант c');
 assert.equal(selected.matched,1);assert.deepEqual(selected.summary,ranking.summary);
 const paged=rankingTable({...selected,rows:selected.rows.slice(0,1)});
 assert.match(paged,/Показано курсантів: 1/);assert.match(paged,/>3<\/strong><span>Курсантів у групі/);
});
await check('A duplicate name remains identified after searching by a single login',()=>{
 const s=source();s.cadets=[cadet('a','Однаковий Курсант'),cadet('b','Однаковий Курсант')];
 const selected=searchRanking(buildRanking(s,'Група 1'),'login_a');
 assert.equal(selected.rows.length,1);assert.match(rankingTable(selected),/login_a/);
});
await check('Completion indicators count submitted written work without inventing choice points',()=>{
 const s=source();s.results=[result('a','1',0,{total:2,choiceTotal:0}),result('a','2',0)];
 const ranking=buildRanking(s,'Група 1');
 assert.equal(row(ranking,'a').completed,2);assert.equal(row(ranking,'a').total,0);assert.equal(ranking.summary.completedAll,1);
 const html=rankingTable(ranking);assert.match(html,/Пройдено: 2 із 2/);assert.match(html,/Не пройдено/);
});
await check('A group with no tests has no false completion or ranking table',()=>{
 const s=source();s.tests=[];s.results=[];const ranking=buildRanking(s,'Група 1');
 assert.equal(ranking.summary.completedAll,0);assert.equal(ranking.summary.best,null);
 assert.match(rankingTable(ranking),/Для групи ще немає тестів/);assert.doesNotMatch(rankingTable(ranking),/<table/);
});
await check('The compact instructor table has exactly five columns and opens work from the cadet name',()=>{
 const html=compactResults([result('a','1')],{instructor:true,groupSelected:true,testSelected:true});
 assert.equal((html.match(/<th scope="col"/g)||[]).length,5);assert.match(html,/ПІБ курсанта/);assert.match(html,/data-action="grade-result"/);assert.doesNotMatch(html,/<th[^>]*>Тест/);assert.doesNotMatch(html,/<small>Група 1/);
});
await check('Unfiltered compact rows retain their test and group context without additional columns',()=>{
 const html=compactResults([result('a','1')],{instructor:true});assert.match(html,/<small>Група 1<\/small>/);assert.match(html,/<small>Тест 1<\/small>/);
});
await check('Cadets open their own work from the test title, with no instructor actions',()=>{
 const html=compactResults([result('a','1')]);assert.match(html,/<th scope="col">Тест/);assert.match(html,/data-action="review-result"/);assert.doesNotMatch(html,/grade-result/);
});
await check('Compact results keep pending grading and recovered-work provenance visible',()=>{
 const html=compactResults([result('a','1',2,{gradingStatus:'pending_review',pendingWritten:1,score:null,passed:null,examRecovered:true})],{instructor:true});
 assert.match(html,/Очікує перевірки/);assert.match(html,/Підтверджено інструктором/);assert.match(html,/Час зі збереженої роботи/);assert.doesNotMatch(html,/null%|>0%/);
});
await check('Building and filtering a ranking never modifies authoritative scores or source arrays',()=>{
 const s=source(),before=JSON.stringify(s);const r=buildRanking(s,'Група 1');rankingTable(r);rankingCSV(searchRanking(r,'a'));assert.equal(JSON.stringify(s),before);
});

// Use the application's own screen functions to verify full-history and group
// guards, rather than rendering an incomplete official ranking from recent rows.
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
function appFunction(name){const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0);const next=app.slice(start+1).search(/\n(?:async )?function /);return next<0?app.slice(start):app.slice(start,start+1+next);}
const state={...source(),resultsView:'ranking',resultTotal:3},box={C,e:C.esc,filter:'',account:()=>state,instructor:()=>true,selectedGroup:()=>({name:'Група 1'}),searchRanking,buildRanking,rankingTable,compactResults,paginate:(_,items)=>({items,controls:''}),empty:(name,description)=>name+' '+description};
vm.createContext(box);for(const name of ['resultsView','rankingActive','pendingReviewsActive','groupRanking','resultsTable'])vm.runInContext(appFunction(name),box);
await check('The real ranking screen refuses a truncated history until every result is loaded',()=>{
 state.resultTotal=10000;assert.match(box.resultsTable(),/Потрібна повна історія/);assert.doesNotMatch(box.resultsTable(),/<table/);state.resultTotal=3;assert.match(box.resultsTable(),/<table/);
});
await check('The real ranking screen requires an explicit group',()=>{
 box.selectedGroup=()=>undefined;assert.match(box.resultsTable(),/Оберіть групу/);assert.doesNotMatch(box.resultsTable(),/<table/);
});

fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/results.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks},null,2)+'\n');
