import assert from 'node:assert/strict';import fs from 'node:fs';
import {learningUnits,learningSummary} from '../web/learning.js';
const test={id:'1',title:'Тема'},m={id:'m',testId:'1',revision:2,pageCount:10},checks=[];
function check(n,f){f();checks.push(n);}
const units=(progress={},results=[],pending=[],running=null)=>learningUnits([test],[m],progress,results,pending,running);
check('Unopened material offers the first test attempt',()=>{const [u]=units();assert.equal(u.reading[0].page,0);assert.equal(u.canStart,true);});
check('Progress from an old material revision is not reused',()=>assert.equal(units({m:{revision:1,maxPage:10}})[0].reading[0].page,0));
check('Partial reading is distinct from a completed test',()=>{const u=units({m:{revision:2,maxPage:3}})[0];assert.equal(u.status,'Перегляд матеріалів');assert.equal(learningSummary([u]).completed,0);});
check('Viewing the final page never claims the test is passed',()=>{const u=units({m:{revision:2,maxPage:10}})[0];assert.ok(u.status.includes('тест попереду'));assert.equal(learningSummary([u]).passed,0);});
check('Pending saved answers cannot start another attempt',()=>{const u=units({},[],[{body:{testId:1}}])[0];assert.equal(u.canStart,false);assert.equal(u.queued,true);});
check('A running test is resumed instead of duplicated',()=>assert.equal(units({},[],[],{test:{id:'1'}})[0].canStart,false));
check('An unsuccessful accepted attempt is completed and needs review',()=>{const u=units({},[{testId:'1',passed:false,score:30}])[0];assert.equal(u.canStart,false);const s=learningSummary([u]);assert.equal(s.completed,1);assert.equal(s.passed,0);assert.equal(s.needsAttention.length,1);});
check('An accepted successful attempt stays completed',()=>assert.equal(learningSummary(units({},[{testId:'1',passed:true}])).passed,1));
check('Unlinked or foreign material does not alter a learning unit',()=>assert.equal(learningUnits([test],[{...m,testId:'2'}],{},[])[0].reading.length,0));
check('Legacy duplicates use the latest accepted attempt for progress',()=>{const old={testId:'1',passed:false,completedAt:'2026-01-01T00:00:00Z'},latest={testId:'1',passed:true,completedAt:'2026-02-01T00:00:00Z'};for(const results of [[old,latest],[latest,old]])assert.equal(learningSummary(units({},results)).passed,1);});
fs.writeFileSync(new URL('../verification/learning.json',import.meta.url),JSON.stringify({passed:checks.length,checks,testedAt:new Date().toISOString()},null,2));console.log('Learning progress: '+checks.length+' passed.');
