import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHostWindow} from '../web/core.js';

const requests=[],beacons=[];
let live=true,updating=false,accepted=true;
const windowId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const host=createHostWindow({windowId,key:'test&key',alive:()=>live,updating:()=>updating,
 local:async(...args)=>{requests.push(args);return {ok:true,windowLifecycleProtocol:1};},
 beacon:(...args)=>{beacons.push(args);return accepted;}});
await host.open();
assert.equal(host.needsOpen,false);
assert.deepEqual(requests,[['/window/open',{windowId}]]);
live=false;assert.equal(host.close(),false);assert.equal(beacons.length,0);
live=true;updating=true;assert.equal(host.close(),false);assert.equal(beacons.length,0);
updating=false;accepted=false;assert.equal(host.close(),false);
accepted=true;assert.equal(host.close(),true);assert.equal(host.close(),false);
assert.equal(beacons.length,2);
assert.deepEqual(beacons[1],['/window/close?key=test%26key',JSON.stringify({windowId})]);
await host.open();assert.equal(host.close(),true);
let reply={ok:false,code:'BUSY'};
const busy=createHostWindow({windowId,key:'test',alive:()=>true,updating:()=>false,beacon:()=>true,local:async()=>reply});
await busy.open();assert.equal(busy.needsOpen,true);
reply={ok:true,windowLifecycleProtocol:1};await busy.open();assert.equal(busy.needsOpen,false);
const interrupted=createHostWindow({windowId,key:'test',alive:()=>true,updating:()=>false,beacon:()=>true,local:async()=>{throw new TypeError('Failed to fetch');}});
await assert.rejects(interrupted.open());assert.equal(interrupted.needsOpen,true);
interrupted.close();assert.equal(interrupted.needsOpen,false);
console.log('PASS explicit open/close, stale-window and update guards, bounded beacons and retry after a rejected beacon');

const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const start=source.indexOf('async function local(');
const transport=source.slice(start,source.indexOf('\nconst hostWindow=',start));
let calls=0,cleared=0,failure;
const box={alive:()=>true,key:'secret',AbortController,Error,TypeError,JSON,
 setTimeout:()=>1,clearTimeout:()=>cleared++,
 fetch:async()=>{calls++;if(failure)throw failure;return {ok:true,json:async()=>({ok:true})};}};
vm.createContext(box);vm.runInContext(transport,box);
assert.equal((await box.local('/rpc',{})).ok,true);
failure=new TypeError('Failed to fetch');
await assert.rejects(box.local('/rpc',{}),e=>e.code==='LOCAL_HOST_UNAVAILABLE'&&/локальним модулем/.test(e.message));
assert.equal(calls,2,'A failed destructive request must not be replayed automatically');
failure=Object.assign(new Error('aborted'),{name:'AbortError'});
await assert.rejects(box.local('/rpc',{}),e=>e.code==='TIMEOUT');
assert.equal(cleared,3);
box.alive=()=>false;
await assert.rejects(box.local('/rpc',{}),/іншому вікні/);
assert.equal(calls,3);
console.log('PASS localized local-host failure, no automatic destructive replay, timeout and stale-window handling');
