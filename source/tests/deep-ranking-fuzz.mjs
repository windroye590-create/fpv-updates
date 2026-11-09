import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {buildRanking,searchRanking,rankingTable,rankingCSV} from '../web/results.js';
let seed=987654321;const rnd=n=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
let generated=0,verified=0;const timings=[];
for(let round=0;round<150;round++){
 const n=27+rnd(90),nt=1+rnd(40),s={cadets:[],tests:[],results:[]};
 for(let i=0;i<n;i++)s.cadets.push({id:'u'+i,role:'cadet',username:'login_'+i,fullName:i%9===0?'Однаковий Курсант':i%11===0?'=SUM(A1:A2)':'Курсант '+i,groupName:'Група'});
 for(let i=0;i<nt;i++)s.tests.push({id:'t'+i,title:i%4===0?'<img src=x onerror=bad>':'Тест '+i,published:true});
 const latest=new Map();
 for(let i=0;i<n*nt*2;i++){
  const u='u'+rnd(n),t='t'+rnd(nt),choiceTotal=rnd(31),correct=rnd(choiceTotal+1),valid=rnd(10)!==0;
  const r={id:'r'+String(i).padStart(9,'0'),userId:u,userName:u,groupName:rnd(8)===0?'Інша':'Група',testId:t,testTitle:t,total:choiceTotal+2,choiceTotal,correct:valid?correct:choiceTotal+1,completedAt:new Date(1790000000000+i).toISOString(),pendingWritten:2,gradingStatus:'pending_review',score:null};
  s.results.push(r);
  if(r.groupName==='Група')latest.set(u+':'+t,r);
 }
 const before=hash(s),at=performance.now(),ranking=buildRanking(s,'Група');timings.push(performance.now()-at);
 for(const row of ranking.rows){
  let total=null,completed=0;
  for(const t of s.tests){const r=latest.get(row.userId+':'+t.id);if(!r)continue;completed++;if(r.choiceTotal>0&&r.correct<=r.choiceTotal)total=(total??0)+r.correct;}
  assert.equal(row.total,total);assert.equal(row.completed,completed);verified++;
 }
 const totals=ranking.rows.map(r=>r.total).filter(v=>v!==null);
 assert.deepEqual(totals,totals.toSorted((a,b)=>b-a));
 for(let i=0;i<ranking.rows.length;i++){const row=ranking.rows[i];if(row.total!==null)assert.equal(row.rank,totals.indexOf(row.total)+1);}
 const selected=searchRanking(ranking,'login_0');assert.equal(selected.rows.length,1);assert.deepEqual(selected.summary,ranking.summary);
 assert.doesNotMatch(rankingTable(ranking),/<img/);assert.doesNotMatch(rankingCSV(ranking),/;"=SUM/);
 assert.equal(hash(s),before);generated+=s.results.length;
}
const large={cadets:Array.from({length:270},(_,i)=>({id:'u'+i,role:'cadet',fullName:'Курсант '+i,groupName:'Група'})),tests:Array.from({length:200},(_,i)=>({id:'t'+i,title:'Тест '+i,published:true})),results:[]};
for(let i=0;i<50000;i++)large.results.push({id:'r'+i,userId:'u'+(i%270),userName:'u'+(i%270),testId:'t'+(i%200),testTitle:'t'+(i%200),groupName:'Група',choiceTotal:20,total:20,correct:i%21,completedAt:new Date(1790000000000+i).toISOString()});
const at=performance.now(),ranking=buildRanking(large,'Група');assert.equal(ranking.rows.length,270);assert.equal(ranking.tests.length,200);
const largeMs=Math.round(performance.now()-at);
const report={status:'passed',deterministicSeed:987654321,rounds:150,generatedRecords:generated,totalsVerifiedAgainstIndependentOracle:verified,sourceMutation:false,large:{cadets:270,tests:200,records:50000,cells:54000,buildMilliseconds:largeMs},roundMaxMilliseconds:Math.round(Math.max(...timings))};
fs.mkdirSync(new URL('../verification/stress/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../verification/stress/ranking-fuzz.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
