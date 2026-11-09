// An isolated protocol model. Windows CI separately exercises the real CNG/DPAPI host.
import {webcrypto as crypto} from 'node:crypto';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const clone=value=>structuredClone(value),hex=bytes=>Buffer.from(bytes).toString('hex');
const error=(code='STORAGE_READ')=>Object.assign(Error('Synthetic '+code),{code});
export function nativeStorageV2({authorize=async()=>false,rememberedSessions=false}={}){
 let profile=null,backups=[],active=null,opens=0,rootWrites=0,completions=0,recovered=0,rememberedPacket=null;
 const deviceKey=crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const objects=new Map(),journals=new Map(),legacy=new Map(),requests=[],faults={};
 function allowed(headers){if(!active||headers?.['X-LK-Vault']!==active.capability)throw error('FORBIDDEN');return active;}
 async function seal(owner,id,key,value){const iv=crypto.getRandomValues(new Uint8Array(12));const data=encoder.encode(JSON.stringify(value)),aad=encoder.encode(owner+'\n'+id);return {owner,iv,cipher:new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,data))};}
 async function read(id,key,packet){if(!packet)throw error();try{return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:packet.iv,additionalData:encoder.encode(active.owner+'\n'+id)},key,packet.cipher)));}catch{throw error();}}
 async function local(path,body,headers={}){
  const method=body===undefined?'GET':'POST';requests.push({path,method,bytes:body===undefined?0:Buffer.byteLength(JSON.stringify(body))});
  if(faults.failPath===path)throw error(faults.failCode||'STORAGE_READ');
  if(path==='/clock')return {ok:true,storageProtocol:2,uptime:10000,launchId:'synthetic-native-v2'};
  if(path==='/storage/status')return {ok:true,storageProtocol:2,recoveredCopies:recovered,rememberedSessions};
  if(path==='/storage/profile'){
   if(method==='GET')return clone(profile||{});
   if(profile&&JSON.stringify(profile)===JSON.stringify(body))return {ok:true};
   if(body.storageProtocol!==2||body.expectedRevision!==(profile?.revision||0)||body.revision!==body.expectedRevision+1)throw error('STORAGE_CONFLICT');
   if(profile)backups=[clone(profile),...backups].slice(0,3);profile=clone(body);rootWrites++;
   if(faults.loseRootReply){faults.loseRootReply=false;throw error('NETWORK');}return {ok:true};
  }
  if(path.startsWith('/storage/profile/backup/')){const p=backups[+path.at(-1)-1];if(!p)throw error();return clone(p);}
  if(path==='/vault/open'){if(!/^[a-f0-9]{64}$/.test(body.key)||!/^[a-f0-9]{64}$/.test(body.capability))throw error('FORBIDDEN');active={owner:String(body.owner),capability:body.capability,keyHex:body.key,key:await crypto.subtle.importKey('raw',Buffer.from(body.key,'hex'),'AES-GCM',false,['encrypt','decrypt'])};opens++;return {ok:true};}
  if(path==='/vault/remembered'){
   if(!rememberedSessions)throw error('NOT_FOUND');if(!rememberedPacket)return {rememberedAccountProtocol:1,remembered:false};
   try{return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:rememberedPacket.iv},await deviceKey,rememberedPacket.cipher)));}catch{throw error('REMEMBERED_READ');}
  }
  if(path==='/vault/forget'){
   if(!rememberedSessions)throw error('NOT_FOUND');const iv=crypto.getRandomValues(new Uint8Array(12));rememberedPacket={iv,cipher:new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await deviceKey,encoder.encode(JSON.stringify({rememberedAccountProtocol:1,remembered:false}))))};return {ok:true};
  }
  if(path==='/legacy/list')return {ok:true,snapshots:[...legacy].map(([id,v])=>({id,changedAt:v.changedAt||1}))};
  const old=path.match(/^\/legacy\/([a-f0-9]{32})\/(account|complete)$/);
  if(old){if(!await authorize(body.userId,body.token))throw error('FORBIDDEN');const v=legacy.get(old[1]);if(old[2]==='account')return {ok:true,account:clone(v?.accounts?.[body.userId]||null),journal:v?.journal?.userId===body.userId?clone(v.journal):null};const a=allowed(headers);if(a.owner!==body.userId||!profile?.accounts?.[body.userId])throw error('FORBIDDEN');if(v){delete v.accounts[body.userId];if(v.journal?.userId===body.userId)delete v.journal;if(!Object.keys(v.accounts).length&&!v.journal)legacy.delete(old[1]);}completions++;return {ok:true};}
  const a=allowed(headers);
  if(path==='/vault/remember'){
   if(!rememberedSessions||!profile?.accounts?.[a.owner])throw error('STORAGE_WRITE');const iv=crypto.getRandomValues(new Uint8Array(12));rememberedPacket={iv,cipher:new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await deviceKey,encoder.encode(JSON.stringify({rememberedAccountProtocol:1,remembered:true,owner:a.owner,key:a.keyHex}))))};return {ok:true};
  }
  if(path==='/vault/close'){active=null;return {ok:true};}
  if(path.startsWith('/vault/objects/')){const id=path.split('/').at(-1);if(!/^[a-f0-9]{64}$/.test(id))throw error('FORBIDDEN');if(method==='GET')return read(id,a.key,objects.get(id));if(requests.at(-1).bytes>8*1024*1024)throw error('STORAGE_WRITE');if(objects.has(id)){const existing=await read(id,a.key,objects.get(id));if(JSON.stringify(existing)===JSON.stringify(body))return {ok:true};throw error('STORAGE_WRITE');}objects.set(id,await seal(a.owner,id,a.key,body));return {ok:true};}
  if(path==='/vault/journal'){
   const old=journals.get(a.owner);if(method==='GET'){if(!old)return {};for(const packet of old){try{return await read('journal',a.key,packet);}catch{recovered++;}}throw error();}
   if(body.userId!==a.owner)throw error('FORBIDDEN');let serial=0;if(old?.length)serial=(await read('journal',a.key,old[0])).serial||0;if(body.serial>serial)journals.set(a.owner,[await seal(a.owner,'journal',a.key,body),...(old||[])].slice(0,4));return {ok:true};
  }
  if(path==='/storage/gc'){const referenced=new Set();const scan=v=>{if(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))referenced.add(v);else if(v&&typeof v==='object')for(const x of Object.values(v))scan(x);};for(const p of [profile,...backups])scan(p);let removed=0;for(const id of objects.keys())if(!referenced.has(id)){objects.delete(id);removed++;}return {ok:true,removed};}
  throw error('NOT_FOUND');
 }
 return {local,objects,journals,legacy,requests,faults,setRememberedSessions:value=>{rememberedSessions=value;},get profile(){return clone(profile);},get backups(){return clone(backups);},get opens(){return opens;},get rootWrites(){return rootWrites;},get completions(){return completions;},get activeCapability(){return active?.capability;},corruptRemembered:()=>{if(rememberedPacket)rememberedPacket.cipher[0]^=1;},snapshot:()=>({rememberedSession:rememberedPacket?{iv:hex(rememberedPacket.iv),cipher:hex(rememberedPacket.cipher)}:null,profile:clone(profile),backups:clone(backups),objects:[...objects].map(([id,v])=>({id,owner:v.owner,iv:hex(v.iv),cipher:hex(v.cipher)})),journals:[...journals].map(([owner,values])=>({owner,values:values.map(v=>({iv:hex(v.iv),cipher:hex(v.cipher)}))}))})};
}
