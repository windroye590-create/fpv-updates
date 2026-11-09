import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createUpdater} from '../web/updater.js';
const checks=[];
const ready={ok:true,state:3,currentCode:114,currentVersion:'1.0.14',code:115,version:'1.0.15',message:'Готове'};
async function scenario(name,options={},run){
 let elapsed=0,reason=options.reason||'',latest={},reloaded=0,frozen=false,saved=false,applied=0,statusCalls=0;const events=[];
 const u=createUpdater({restartTimeout:2100,now:()=>elapsed,pause:async ms=>{elapsed+=ms;},
  canApply:()=>reason,info:v=>latest=v,freeze:v=>{frozen=v;events.push(v?'freeze':'unfreeze');},
  save:async()=>{events.push('save');if(options.diskError)throw Error('Диск недоступний');saved=true;},reload:()=>{reloaded++;events.push('reload');},
  local:async path=>{events.push(path);if(path==='/updates/check')return {ok:true};if(path==='/updates/apply'){applied++;assert.ok(saved&&frozen);return options.helperFailure?{ok:false,error:'Не вдалося підготувати встановлення'}:{ok:true,restarting:true};}
   statusCalls++;if(!applied)return options.initial||ready;
   if(options.offline||(!options.rollback&&statusCalls<3))throw Error('Restart downtime');
   return options.rollback?{...ready,state:5,message:'Оновлення не встановлено'}:{...ready,currentCode:115,currentVersion:'1.0.15',state:2};
  }});
 try{await run({u,get state(){return {latest,reloaded,frozen,saved,applied,events};},unblock:()=>reason=''});checks.push(name);console.log('PASS '+name);}
 finally{u.dispose();}
}
await scenario('Ready background downloads do not restart the app',{},async t=>{await t.u.status();assert.equal(t.state.applied,0);});
await scenario('Explicit check saves before apply, waits through downtime and reloads once',{},async t=>{await t.u.check();assert.equal(t.state.applied,1);assert.equal(t.state.reloaded,1);assert.ok(t.state.events.indexOf('save')<t.state.events.indexOf('/updates/apply'));});
await scenario('Active tests defer installation until they finish',{reason:'Після завершення тесту'},async t=>{await t.u.check();assert.equal(t.state.applied,0);assert.equal(t.state.latest.message,'Після завершення тесту');t.unblock();await t.u.status();assert.equal(t.state.reloaded,1);});
await scenario('Busy editing or synchronization defers the same request',{reason:'Чекаємо завершення дії'},async t=>{await t.u.check();assert.equal(t.state.applied,0);t.unblock();await t.u.status();assert.equal(t.state.applied,1);});
await scenario('Storage failure prevents any install or restart',{diskError:true},async t=>{await t.u.check();assert.equal(t.state.applied,0);assert.equal(t.state.reloaded,0);assert.equal(t.state.frozen,false);assert.match(t.state.latest.message,/Диск/);});
await scenario('Helper failure keeps the current window usable',{helperFailure:true},async t=>{await t.u.check();assert.equal(t.state.reloaded,0);assert.equal(t.state.frozen,false);assert.equal(t.u.requested,false);});
await scenario('Rollback is reported as failure rather than a successful update',{rollback:true},async t=>{await t.u.check();assert.equal(t.state.reloaded,0);assert.match(t.state.latest.message,/не встановлено/);assert.equal(t.state.frozen,false);});
await scenario('An unreachable restarted backend times out without a false reload',{offline:true},async t=>{await t.u.check();assert.equal(t.state.reloaded,0);assert.match(t.state.latest.message,/Не вдалося підтвердити/);});
for(const state of [2,4,5])await scenario('State '+state+' does not attempt replacement',{initial:{...ready,state}},async t=>{await t.u.check();assert.equal(t.state.applied,0);assert.equal(t.u.requested,false);});
await scenario('Malformed target versions cannot trigger installation',{initial:{...ready,code:undefined}},async t=>{await t.u.check();assert.equal(t.state.applied,0);assert.match(t.state.latest.message,/номер/);});
fs.writeFileSync(new URL('../verification/updater.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,testedAt:new Date().toISOString()},null,2));
