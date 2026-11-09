import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildStatement,statementTests,statementLayout} from '../web/statement.js';
const raw=JSON.parse(fs.readFileSync(new URL('./fixtures/group-statement.json',import.meta.url))),source={...raw,tests:statementTests(raw.tests,raw.results)},checks=[];
function check(name,run){run();checks.push(name);}
const make=(s=source)=>buildStatement(s,'g1','t1',raw.date);
check('All 27 current cadets are retained; other groups are excluded',()=>{const p=make();assert.equal(p.rows.length,27);assert.ok(!p.rows.some(r=>r.userId==='foreign'));});
check('Same names remain different cadets',()=>{const rows=make().rows.filter(r=>r.name==='Курсант Однаковий Приклад');assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.identifier)).size,2);assert.ok(rows.every(r=>r.identifier.startsWith('Логін: ')));});
check('Duplicate test titles use IDs and latest result only',()=>{assert.equal(source.tests.length,2);const p=make(),r=p.rows.find(r=>r.userId==='u1').result;assert.ok(p.test.endsWith(' · №t1'));assert.equal(r.testId,'t1');assert.equal(r.score,40);assert.equal(r.id,'r1');});
check('Missing results have explicit empty rows',()=>assert.equal(make().rows.filter(r=>!r.result).length,2));
check('A 28th cadet fails instead of silently truncating',()=>assert.throws(()=>make({...source,cadets:[...source.cadets,{...source.cadets[0],id:'extra'}]}),/до 27/));
check('Deleted or moved cadet is absent after fresh data',()=>assert.equal(make({...source,cadets:source.cadets.filter(u=>u.id!=='u1')}).rows.length,26));
check('Empty group, missing test and cadet role are rejected',()=>{assert.throws(()=>buildStatement(source,'g2','missing',raw.date));assert.throws(()=>make({...source,cadets:[]}));assert.throws(()=>make({...source,instructor:{role:'cadet'}}));});
check('Malformed grading is rejected',()=>assert.throws(()=>make({...source,results:source.results.map(r=>r.id==='r1'?{...r,correct:99}:r)}),/некоректні/));
check('27 rows and the signature fit in one A4 plan',()=>{const plan=statementLayout(make(),(s,size)=>s.length*size*.6);assert.ok(plan.tableBottom<=735);assert.ok(plan.bodySize>=7);assert.equal(plan.texts.filter(t=>t.text==='Немає результату').length,2);assert.ok(plan.texts.every(t=>t.y>0&&t.y<842));assert.ok(plan.lines.some(l=>l.y1===804));});
fs.writeFileSync(new URL('../verification/statement.json',import.meta.url),JSON.stringify({passed:checks.length,checks},null,2)+'\n');console.log('Group statement: '+checks.length+' checks passed');
