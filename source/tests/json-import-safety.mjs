import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../web/core.js';
const checks=[];
async function check(name,run){try{await run();checks.push({name,status:'passed'});}catch(e){checks.push({name,status:'failed',error:e.message});}}
const encoded=value=>C.b64(new TextEncoder().encode(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const tag=value=>'[[LK-GROUPS:'+encoded(value)+']]';
const question={text:'Питання',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]};
const sample={title:'Імпортований тест',description:'',questions:[question]};
await check('Legacy group markers retain their group restrictions',()=>{
 assert.deepEqual(C.groupsFrom(tag('Група А|Група Б')),['Група А','Група Б']);
 const draft=C.draftFrom({...sample,description:tag('Група А|Група Б')});
 assert.deepEqual(C.groupsFrom(C.draftAPI(draft).description),['Група А','Група Б']);
});
await check('Group decoding always returns an array, including object-shaped legacy names',()=>{
 const value=C.groupsFrom(tag('{"name":"Група"}'));assert.ok(Array.isArray(value));
});
await check('Corrupt or unterminated group markers cannot silently become access for all groups',()=>{
 for(const description of ['[[LK-GROUPS:@@@]]','[[LK-GROUPS:unfinished',tag('[]')])assert.throws(()=>C.draftFrom({...sample,description}));
});
await check('Non-string group values in JSON markers are rejected before replacing a draft',()=>{
 for(const values of ['[1]','[{"id":"a"}]','[true]'])assert.throws(()=>C.draftFrom({...sample,description:tag(values)}));
});
await check('Oversized JSON question lists are rejected before rendering',()=>assert.throws(()=>C.draftFrom({...sample,questions:Array.from({length:201},()=>question)})));
await check('Malformed question and answer values cannot poison the saved editor',()=>{
 for(const input of [null,[],{...sample,title:{}},{...sample,questions:{}},{...sample,questions:[null]},{...sample,questions:[{...question,text:5}]},{...sample,questions:[{...question,answers:{}}]},{...sample,questions:[{...question,answers:[{text:{},isCorrect:true},{text:'Ні',isCorrect:false}]}]}])assert.throws(()=>C.draftFrom(input));
});
await check('The string false cannot become a second correct answer',()=>{
 assert.throws(()=>C.draftFrom({...sample,questions:[{...question,answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:'false'}]}]}));
});
await check('An incomplete but structurally valid draft can still be exported and reimported',()=>{
 const draft=C.newDraft();draft.title='Чернетка';draft.questions[0].text='';draft.questions[0].answers[0].text='';
 const restored=C.draftFrom(C.draftAPI(draft));assert.equal(restored.title,'Чернетка');assert.equal(restored.questions[0].text,'');
});
await check('An already saved invalid group shape cannot be published or exported without correction',()=>{
 const draft={...C.newDraft(),title:'Чернетка',assignedGroups:{group:'a'}};
 assert.match(C.validateDraft(draft),/груп/i);assert.throws(()=>C.draftAPI(draft));
});
await check('A malformed key in an older saved draft cannot be published or silently changed by export',()=>{
 const draft=C.draftFrom(sample);draft.questions[0].answers[1].isCorrect='false';
 assert.ok(C.validateDraft(draft));assert.throws(()=>C.draftAPI(draft));
});
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {api,instructorToken,credential}=await import('./fixtures/server_model.mjs');
await check('Editing and republishing a legacy restricted test does not expose it to another group',()=>{
 const own=api('POST','/api/instructor/groups',instructorToken,{name:'Група спадкового тесту'}).group;
 const outside=api('POST','/api/instructor/groups',instructorToken,{name:'Стороння група'}).group;
 const cadet=api('POST','/api/register','',{username:'import_group_guard',fullName:'Курсант іншої групи',groupId:outside.id,...credential('synthetic-password')});
 const original=api('POST','/api/instructor/tests',instructorToken,{...sample,description:tag(own.name)}).test;
 assert.ok(!api('GET','/api/cadet/workspace',cadet.token).tests.some(t=>t.id===original.id));
 const edited=C.draftFrom(original,original.id);const replacement=api('POST','/api/instructor/tests/'+original.id+'/replace',instructorToken,C.draftAPI(edited)).test;
 assert.ok(!api('GET','/api/cadet/workspace',cadet.token).tests.some(t=>t.id===replacement.id));
});
const report={status:checks.every(c=>c.status==='passed')?'passed':'failed',passed:checks.filter(c=>c.status==='passed').length,total:checks.length,checks};
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/json-import-safety.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
for(const c of checks)console.log(c.status.toUpperCase()+' '+c.name+(c.error?' — '+c.error.split('\n')[0]:''));
if(report.status!=='passed')process.exitCode=1;
