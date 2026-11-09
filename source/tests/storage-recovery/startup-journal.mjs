import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {audit,C,app,clone,appFunction,root,evidence} from './support.mjs';
const {check,finish}=audit('startup-journal');
const native=JSON.parse(fs.readFileSync(new URL('native-storage.json',evidence)));
assert.equal(native.nativeSourceSHA256,crypto.createHash('sha256').update(fs.readFileSync(root+'/native/main.c')).digest('hex'));
const failedNativeRead=native.checks[2].actualResponse;
const start=app.indexOf('async function init(){'),end=app.indexOf('\ninit();',start);assert.ok(start>=0&&end>start);const actual=app.slice(start,end);
const state={version:1,session:{token:'synthetic-startup-token',user:{id:'journal-user',role:'cadet'}},groups:[],accounts:{'journal-user':{run:{test:{id:'journal-test',mode:'training',questions:[{id:'written',type:'written',answers:[]}]},submissionId:'journal-submission',answers:{written:'Раніше збережена відповідь'},localRevision:0},pending:[]}}};
const latest={serial:2,kind:'run',userId:'journal-user',submissionId:'journal-submission',revision:1,answers:{written:'Остання підтверджена відповідь з журналу'},index:0,lastElapsed:12};
async function boot(journal,raw=state){let rendered=0,written=null;const warnings=[],events=[];
 const box={C,S:{accounts:{},groups:[]},diskStateLoaded:false,page:'home',updateApplying:false,lastTimerSaved:0,clock:{},key:'synthetic-key',Math,Event:class{constructor(type){this.type=type;}},window:{dispatchEvent:e=>events.push(e.type)},document:{hidden:false,querySelector:()=>null},app:{innerHTML:''},e:C.esc,
 local:async route=>route==='/state'?clone(raw):journal instanceof Error?Promise.reject(journal):clone(journal),persist:async()=>{written=clone(box.S);},getClock:async()=>{},render:()=>rendered++,updateStatus:()=>{},user:()=>box.S.session?.user,account:()=>box.S.accounts['journal-user'],recoverRun:async()=>{},refresh:async()=>{},syncQueue:async()=>{},loadGroups:()=>{},setInterval:()=>0,reviewPresence:{},toast:m=>warnings.push(m),journalError:''};
 vm.createContext(box);vm.runInContext(actual,box);await box.init();return {box,rendered,warnings,events,written};
}
await check('A readable journal restores the last acknowledged written answer',async()=>{const r=await boot(latest);assert.equal(r.box.S.accounts['journal-user'].run.answers.written,latest.answers.written);assert.equal(r.written.accounts['journal-user'].run.answers.written,latest.answers.written);});
await check('An explicitly failed journal read is surfaced instead of silently using older answers',async()=>{const r=await boot({ok:false,code:'STORAGE_READ',error:'Synthetic journal read failure'});assert.ok(r.events.includes('lk:startup-failed')||r.warnings.length||r.box.journalError,'The UI opened with old answers and no warning');});
await check('A journal transport timeout is surfaced before older state is treated as current',async()=>{const r=await boot(Object.assign(Error('Synthetic journal timeout'),{code:'TIMEOUT'}));assert.ok(r.events.includes('lk:startup-failed')||r.warnings.length||r.box.journalError,'The UI opened with old answers and no warning');});
await check('A false empty native state cannot overwrite the previous profile when the window closes',async()=>{
 const r=await boot({},failedNativeRead);let disk=clone(state),pagehide;
 Object.assign(r.box,{alive:()=>true,clearTimeout:()=>{},saveTimer:0,checkpoint:null,TextEncoder,navigator:{sendBeacon:(path,raw)=>{if(path.startsWith('/state'))disk=JSON.parse(raw);return true;}}});
 r.box.window.addEventListener=(name,fn)=>{if(name==='pagehide')pagehide=fn;};
 const line=app.split('\n').find(line=>line.startsWith("window.addEventListener('pagehide',"));assert.ok(line);vm.runInContext(line,r.box);pagehide();
 assert.ok(disk.accounts['journal-user'],'The normal close beacon replaced an existing profile with empty accounts');
});
await check('Closing after a journal timeout cannot make a newer acknowledged checkpoint permanently stale',async()=>{
 const r=await boot(Object.assign(Error('Synthetic lost journal response'),{code:'TIMEOUT'}));let disk=clone(state),pagehide;const nativeJournal=clone(latest);
 Object.assign(r.box,{alive:()=>true,clearTimeout:()=>{},saveTimer:0,checkpoint:null,TextEncoder,structuredClone,id:C.id,uptime:()=>14000,navigator:{sendBeacon:(path,raw)=>{const incoming=JSON.parse(raw);if(path.startsWith('/state'))disk=incoming;else if(path.startsWith('/journal')&&incoming.serial>nativeJournal.serial)Object.assign(nativeJournal,incoming);return true;}}});
 r.box.window.addEventListener=(name,fn)=>{if(name==='pagehide')pagehide=fn;};
 for(const name of ['runCheckpoint','stamp'])vm.runInContext(appFunction(name),r.box);
 vm.runInContext(app.split('\n').find(line=>line.startsWith("window.addEventListener('pagehide',")),r.box);pagehide();
 assert.equal(C.applyCheckpoint(disk,nativeJournal),true,'The newer acknowledged checkpoint became stale behind an older state snapshot');
 assert.equal(disk.accounts['journal-user'].run.answers.written,latest.answers.written);
});
finish({usesActualApplicationInit:true,realBrowserExecuted:false,knownOlderAnswer:state.accounts['journal-user'].run.answers.written,knownNewerJournalAnswer:latest.answers.written});
