import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../web/core.js';
const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8'),checks=[];
function appFunction(name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0);const next=source.slice(start+1).search(/\n(?:async )?function /);return next<0?source.slice(start):source.slice(start,start+1+next);}
async function check(name,run){await run();checks.push(name);console.log('PASS '+name);}
function box(){
 const draft=C.newDraft();draft.title='ПК';draft.questions[0].text='Питання <ПК>';draft.questions[0].answers[0].text='Так';draft.questions[0].answers[1].text='Ні';
 const S={session:{token:'teacher-A',user:{id:'A',role:'instructor'}}},a={draft},calls=[];
 const x={C,S,structuredClone,crypto,id:C.id,e:C.esc,account:()=>a,user:()=>S.session?.user,instructor:()=>S.session?.user.role==='instructor',updateApplying:false,working:false,page:'editor',bank:[],materials:{action:async()=>false},persist:async()=>calls.push('persist'),toast:()=>{},render:()=>{},rpc:async(method,path,body,token)=>{calls.push({method,path,body,token});return {question:{id:'bank-1',category:body.category,question:body.question}};},dialog:(title,html,callback)=>{x.confirm=callback;x.dialogHTML=html;}};
 vm.createContext(x);for(const name of ['saveBankQuestion','clickAction'])vm.runInContext(appFunction(name),x);
 return {x,a,S,calls};
}
await check('Windows interface text contains no retired platform prompts',()=>{
 for(const name of ['app.js','core.js','index.html'])assert.doesNotMatch(fs.readFileSync(new URL('../web/'+name,import.meta.url),'utf8'),/телефон\p{L}*|мобільн\p{L}*|\bandroid\b|\biphone\b|\bios\b|\bapk\b/iu,name);
});
await check('An incomplete question cannot open a bank save or send a request',async()=>{
 const {x,a,calls}=box();a.draft.questions[0].text='';await assert.rejects(x.saveBankQuestion(0));assert.equal(x.confirm,undefined);assert.deepEqual(calls,[]);
});
await check('Bank save captures the question and session and escapes its preview',async()=>{
 const {x,a,calls}=box();await x.saveBankQuestion(0);assert.ok(x.dialogHTML.includes('&lt;ПК&gt;'));a.draft.questions[0].text='Інша правка';await x.confirm({category:'  Категорія ПК  ',difficulty:'hard'});assert.equal(calls[0].token,'teacher-A');assert.equal(calls[0].body.question.text,'Питання <ПК>');assert.equal(calls[0].body.category,'Категорія ПК');assert.equal(x.bank.length,1);
});
await check('A delayed bank confirmation cannot save as another instructor',async()=>{
 const {x,S,calls}=box();await x.saveBankQuestion(0);S.session={token:'teacher-B',user:{id:'B',role:'instructor'}};await assert.rejects(x.confirm({category:'ПК',difficulty:'medium'}),/Обліковий запис змінився/);assert.deepEqual(calls,[]);assert.equal(x.bank.length,0);
});
await check('A mismatched bank acknowledgement cannot become a saved item',async()=>{
 const {x}=box();x.rpc=async()=>({question:{id:'wrong',category:'ПК',question:{text:'Чуже питання'}}});await x.saveBankQuestion(0);await assert.rejects(x.confirm({category:'ПК',difficulty:'medium'}),/не підтвердив/);assert.equal(x.bank.length,0);
});
await check('Adding from the bank respects the 200-question limit without a write',async()=>{
 const {x,a,calls}=box();a.draft.questions=Array.from({length:200},()=>structuredClone(a.draft.questions[0]));x.bank=[{id:'b',question:structuredClone(a.draft.questions[0])}];const before=JSON.stringify(a.draft);await assert.rejects(x.clickAction({dataset:{action:'bank-add',id:'b'}}),/200/);assert.equal(JSON.stringify(a.draft),before);assert.deepEqual(calls,[]);
});
await check('An unavailable bank question cannot create or corrupt a draft',async()=>{
 const {x,a,calls}=box();a.draft=null;await assert.rejects(x.clickAction({dataset:{action:'bank-add',id:'missing'}}),/не знайдено/);assert.equal(a.draft,null);assert.deepEqual(calls,[]);
});
await check('A written bank question preserves its rubric and points and advances the draft revision',async()=>{
 const {x,a,calls}=box();a.draft=C.newDraft();x.bank=[{id:'b',question:{id:'bank-b',type:'written',text:'Письмове питання',maxPoints:5,rubric:'Критерії',explanation:'Пояснення',answers:[]}}];await x.clickAction({dataset:{action:'bank-add',id:'b'}});assert.equal(a.draft.questions.length,1);assert.equal(a.draft.questions[0].id,'0');assert.equal(a.draft.questions[0].rubric,'Критерії');assert.equal(a.draft.questions[0].maxPoints,5);assert.equal(a.draft.localRevision,1);assert.equal(x.bank[0].question.id,'bank-b');assert.deepEqual(calls,['persist']);
});
fs.mkdirSync(new URL('../verification/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../verification/pc-only.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks},null,2)+'\n');
