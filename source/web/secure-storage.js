// Private account objects are encrypted by the Windows host. The profile and
// its backups contain references and password-wrapped keys, never account data.
const ITERATIONS=600000,PART=250000,MAX_TEXT=32*1024*1024;
const encode=new TextEncoder();
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(message,code='STORAGE_READ')=>Object.assign(Error(message),{code});
const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const unhex=value=>Uint8Array.from(String(value).match(/../g)||[],x=>parseInt(x,16));
const random=n=>crypto.getRandomValues(new Uint8Array(n));
function b64(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
function unb64(text,maximum=4096){if(typeof text!=='string'||text.length>maximum||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw fail('Пошкоджено ключ локальної копії.');return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
const keyId=async key=>hex(await crypto.subtle.digest('SHA-256',unhex(key)));
async function manifestKey(key){const material=await crypto.subtle.importKey('raw',unhex(key),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encode.encode('LK-PC-VAULT:1'),info:encode.encode('manifest')},material,{name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);}
const aad=user=>encode.encode('LK-PC-PASSWORD-WRAP:1\n'+String(user.id)+'\n'+String(user.role)+'\n'+String(user.username));
async function passwordKey(password,salt,iterations){if(typeof password!=='string'||!password||password.length>1024)throw fail('Введіть пароль для розблокування локальної копії.','LOCAL_PASSWORD');const material=await crypto.subtle.importKey('raw',encode.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function wrapKey(key,password,user){const salt=random(16),iv=random(12),derived=await passwordKey(password,salt,ITERATIONS);const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(user),tagLength:128},derived,unhex(key));return {version:1,iterations:ITERATIONS,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};}
async function unwrapKey(record,password){const w=record.wrap;if(!w||w.version!==1||!Number.isInteger(w.iterations)||w.iterations<100000||w.iterations>1000000)throw fail('Не вдалося прочитати захищений ключ.');const salt=unb64(w.salt),iv=unb64(w.iv),cipher=unb64(w.ciphertext);if(salt.length!==16||iv.length!==12||cipher.length!==48)throw fail('Пошкоджено захищений ключ.');const derived=await passwordKey(password,salt,w.iterations);try{return hex(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(record.user),tagLength:128},derived,cipher));}catch{throw fail('Пароль не розблокував збережену копію.','LOCAL_PASSWORD');}}
function unsigned(record){const {mac,...value}=record;return value;}
async function sign(record,key){return {...record,mac:b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encode.encode(canonical(record)))))};}
async function verify(record,key){try{return typeof record.mac==='string'&&await crypto.subtle.verify('HMAC',key,unb64(record.mac),encode.encode(canonical(unsigned(record))));}catch{return false;}}
function publicUser(user){return {id:String(user.id),username:String(user.username),role:String(user.role),groupName:String(user.groupName||''),...(user.groupId?{groupId:String(user.groupId)}:{})};}
function validRecord(record,id){return record&&record.version===1&&record.user&&String(record.user.id)===String(id)&&['instructor','cadet'].includes(record.user.role)&&typeof record.user.username==='string'&&/^[a-f0-9]{64}$/.test(record.keyId)&&record.fields&&typeof record.fields==='object'&&!Array.isArray(record.fields)&&(!record.history||Array.isArray(record.history)&&record.history.length<=3);}
function globalState(S){return Object.fromEntries(['version','groups','theme','deviceId','journalSerial','updateReturnPage','updateTargetCode'].filter(k=>S[k]!==undefined).map(k=>[k,clone(S[k])]));}
function validRoot(value){if(value?.ok===false)throw fail(value.error||'Не вдалося прочитати локальний профіль.',value.code);if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0)return {storageProtocol:2,revision:0,global:{version:1,groups:[],theme:'light'},accounts:{}};if(value?.storageProtocol!==2||!Number.isSafeInteger(value.revision)||value.revision<0||!value.global||typeof value.global!=='object'||!value.accounts||typeof value.accounts!=='object'||Array.isArray(value.accounts))throw fail('Пошкоджено структуру локального профілю.');return value;}
function fieldDescriptor(d){return d&&Number.isSafeInteger(d.length)&&d.length>=0&&d.length<=MAX_TEXT&&Array.isArray(d.chunks)&&d.chunks.length>=1&&d.chunks.length<=256&&d.chunks.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id));}

export function createSecureStorage({local,keepalive=()=>false}){
 let enabled=false,rememberedSessions=false,root=null,active=null,pendingRoot=null,pendingOwner=null,generation=0,tail=Promise.resolve(),recovered=0,migrationWarning='';
 const checked=async(path,body,headers)=>{const r=await local(path,body,headers);if(r?.ok===false)throw fail(r.error||'Не вдалося відкрити локальну копію.',r.code);return r;};
 const headers=a=>({'X-LK-Vault':a.capability});
 const current=a=>a&&a===active&&a.generation===generation;
 const serial=work=>{const result=tail.catch(()=>{}).then(work);tail=result;return result;};
 function status(){return {enabled,rememberedSessions,locked:enabled&&!active,recoveredCopies:recovered,migrationWarning};}
 async function load(){
  const clock=await checked('/clock');enabled=clock?.storageProtocol===2;if(!enabled)return checked('/state');
  const info=await checked('/storage/status');if(info.storageProtocol!==2)throw fail('Захищене сховище Windows не відповідає.');rememberedSessions=info.rememberedSessions===true;
  recovered=Number(info.recoveredCopies)||0;root=validRoot(await checked('/storage/profile'));recovered=Math.max(recovered,Number((await checked('/storage/status')).recoveredCopies)||0);
  const state={...clone(root.global),session:null,accounts:{}};if(!rememberedSessions)return state;
  try{
   const saved=await checked('/vault/remembered');if(saved.rememberedAccountProtocol!==1)throw fail('Не вдалося прочитати збережений вхід.');if(saved.remembered===false)return state;
   if(saved.remembered!==true||typeof saved.owner!=='string'||!/^[a-f0-9]{64}$/.test(saved.key))throw fail('Не вдалося прочитати збережений вхід.');
   const kid=await keyId(saved.key);let opened;
   for(const record of await candidates(saved.owner)){if(record.keyId!==kid)continue;try{opened=await openRecord(record,saved.key);if(record!==root.accounts[saved.owner])recovered++;break;}catch{}}
   if(!opened)throw fail('Не вдалося відкрити збережений акаунт.');opened.active.remembered=true;opened.active.legacySources=[...(opened.active.record.migrationSources||[])];
   return {...state,session:opened.session,accounts:{[saved.owner]:opened.account}};
  }catch(error){
   if(active)await lock({forget:false}).catch(()=>{});
   await checked('/vault/forget',{}).catch(()=>{});migrationWarning='Не вдалося відновити збережений вхід. Увійдіть знову; локальні дані збережено.';
   return {...state,localResumeWarning:migrationWarning};
  }
 }
 async function readJournal(){return enabled?(active?checked('/vault/journal',undefined,headers(active)):{}):checked('/journal');}
 async function candidates(id){
  const values=[],seen=new Set();function add(record){if(!validRecord(record,id))return;for(const value of [record,...(record.history||[])])if(validRecord(value,id)&&!seen.has(value.mac)){seen.add(value.mac);values.push(value);}}
  add(root.accounts[id]);for(let i=1;i<=3&&values.length<16;i++){try{const backup=validRoot(await checked('/storage/profile/backup/'+i));add(backup.accounts[id]);}catch{}}
  return values.slice(0,16);
 }
 async function readField(a,d){if(!fieldDescriptor(d))throw fail('Пошкоджено посилання на збережені дані.');const pieces=[];let length=0;for(const id of d.chunks){if(!current(a))throw fail('Обліковий запис змінився.','SESSION_CHANGED');const r=await checked('/vault/objects/'+id,undefined,headers(a));if(r.storageChunkProtocol!==1||typeof r.data!=='string'||r.data.length>PART+1)throw fail('Не вдалося прочитати частину локальної копії.');pieces.push(r.data);length+=r.data.length;if(length>d.length)throw fail('Пошкоджено розмір локальної копії.');}if(length!==d.length)throw fail('Локальна копія завантажена не повністю.');const raw=pieces.join('');let value;try{value=JSON.parse(raw);}catch{throw fail('Пошкоджено вміст локальної копії.');}return {raw,value,descriptor:clone(d)};}
 async function openRecord(record,key){
  const mk=await manifestKey(key);if(!await verify(record,mk))throw fail('Захист локальної копії не підтверджено.');
  const a={id:String(record.user.id),user:clone(record.user),key,keyId:record.keyId,capability:hex(random(32)),manifestKey:mk,wrap:clone(record.wrap),record:clone(record),cache:new Map(),generation:++generation,legacySources:[]};active=a;
  await checked('/vault/open',{owner:a.id,key,capability:a.capability});const account=Object.create(null);let session;
  try{for(const [name,d] of Object.entries(record.fields)){const field=await readField(a,d);a.cache.set(name,field);if(name==='__session')session=field.value;else if(/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(name))account[name]=field.value;else throw fail('Пошкоджено поле локального акаунта.');}
   if(!session||String(session.user?.id)!==a.id||session.user.role!==a.user.role||typeof session.token!=='string'||!session.token)throw fail('Не вдалося прочитати збережений сеанс.');a.session=session;return {account,session,active:a};
  }catch(error){await checked('/vault/close',{},headers(a)).catch(()=>{});if(active===a)active=null;throw error;}
 }
 async function fresh(session,key,password){
  const user=publicUser(session.user),a={id:user.id,user,key,keyId:await keyId(key),capability:hex(random(32)),manifestKey:await manifestKey(key),wrap:await wrapKey(key,password,user),record:null,cache:new Map(),generation:++generation,legacySources:[],session:clone(session)};
  active=a;await checked('/vault/open',{owner:a.id,key,capability:a.capability});return a;
 }
 async function loadLegacy(a,session,hasRecord){
  const list=await checked('/legacy/list');if(!Array.isArray(list.snapshots)||list.snapshots.length>128)throw fail('Не вдалося перевірити старі локальні копії.');
  a.legacySources=[...(a.record?.migrationSources||[])];
  const already=new Set(a.legacySources);
  const snapshots=[];for(const item of [...list.snapshots].sort((x,y)=>y.changedAt-x.changedAt)){if(!item||!/^[a-f0-9]{32}$/.test(item.id))throw fail('Пошкоджено список старих копій.');if(already.has(item.id))continue;const old=await checked('/legacy/'+item.id+'/account',{userId:a.id,token:session.token});if(old.account!==null&&(typeof old.account!=='object'||Array.isArray(old.account)))throw fail('Не вдалося прочитати старий акаунт.');if(old.account||old.journal)snapshots.push({id:item.id,changedAt:item.changedAt,account:old.account,journal:old.journal});}
  if(!snapshots.length)return null;a.legacySources=[...new Set([...a.legacySources,...snapshots.map(x=>x.id)])];
  if(hasRecord)return {additionalSnapshots:snapshots.map(x=>clone(x)),journals:[]};
  const value=clone(snapshots.find(x=>x.account)?.account||{});value.legacySnapshots=snapshots.map(x=>clone(x));return {account:value,journals:snapshots.map(x=>x.journal).filter(Boolean).sort((x,y)=>(x.serial||0)-(y.serial||0))};
 }
 async function unlockOnline(session,password,reply){return serial(async()=>{
  if(!enabled)return {account:null,journals:[],session};if(reply?.localStorageProtocol!==2||String(reply.userId)!==String(session.user.id)||!/^[a-f0-9]{64}$/.test(reply.key))throw fail('Для захищених локальних копій оновіть сервер до API 22.','UPDATE_REQUIRED');
  const id=String(session.user.id),kid=await keyId(reply.key),stored=await candidates(id);let opened=null;
  for(const record of stored){if(record.keyId!==kid||record.user.role!==session.user.role)continue;try{opened=await openRecord(record,reply.key);if(record!==root.accounts[id])recovered++;break;}catch{}}
  if(stored.length&&!opened)throw fail('Не вдалося розблокувати наявну копію. Дані та резервні копії залишилися без змін.','LOCAL_COPY_UNAVAILABLE');
  const a=opened?.active||await fresh(session,reply.key,password);a.user=publicUser(session.user);a.wrap=await wrapKey(reply.key,password,a.user);a.session=clone(session);
  const legacy=await loadLegacy(a,session,!!opened);const account=opened?.account||legacy?.account||{};if(legacy?.additionalSnapshots?.length){account.legacySnapshots=[...(account.legacySnapshots||[]),...legacy.additionalSnapshots];migrationWarning='Збережено додаткову копію даних із попередньої версії. Поточну роботу залишено без змін.';}const j=await checked('/vault/journal',undefined,headers(a));recovered=Math.max(recovered,Number((await checked('/storage/status')).recoveredCopies)||0);
  return {account,session,journals:[...(legacy?.journals||[]),...(j.kind?[j]:[])],recoveredCopies:recovered};
 });}
 async function unlockOffline({username,password,role,group}){return serial(async()=>{
  if(!enabled)throw fail('Для входу потрібне підключення.','NETWORK');const records=Object.values(root.accounts).filter(r=>validRecord(r,r?.user?.id)&&r.user.role===role&&normalize(r.user.username)===normalize(username)&&(role==='instructor'||normalize(r.user.groupName)===normalize(group)||String(r.user.groupId||'')===String(group)));
  if(records.length!==1)throw fail('На цьому ПК немає однозначної захищеної копії цього акаунта. Для першого входу підключіться до інтернету.','LOCAL_COPY_UNAVAILABLE');
  const id=String(records[0].user.id),key=await unwrapKey(records[0],password),kid=await keyId(key);if(kid!==records[0].keyId)throw fail('Пошкоджено ключ локальної копії.');
  for(const record of await candidates(id)){if(record.keyId!==kid||record.user.role!==role||normalize(record.user.username)!==normalize(username))continue;try{const opened=await openRecord(record,key);if(record!==root.accounts[id])recovered++;const j=await checked('/vault/journal',undefined,headers(opened.active));recovered=Math.max(recovered,Number((await checked('/storage/status')).recoveredCopies)||0);return {account:opened.account,session:opened.session,journals:j.kind?[j]:[],offline:true};}catch{}}
  throw fail('Пароль не розблокував локальну копію або копія пошкоджена. Підключіться до інтернету та повторіть вхід.','LOCAL_PASSWORD');
 });}
 async function writeField(a,raw){if(raw.length>MAX_TEXT)throw fail('Локальний документ завеликий. Незбережені дані залишилися у вікні програми.','STATE_TOO_LARGE');const chunks=[];for(let start=0;start<raw.length;){let end=Math.min(start+PART,raw.length);if(end<raw.length&&raw.charCodeAt(end-1)>=0xd800&&raw.charCodeAt(end-1)<=0xdbff)end--;const id=hex(random(32));await checked('/vault/objects/'+id,{storageChunkProtocol:1,data:raw.slice(start,end)},headers(a));if(!current(a))throw fail('Обліковий запис змінився.','SESSION_CHANGED');chunks.push(id);start=end;}return {length:raw.length,chunks};}
 async function commit(){if(!pendingRoot)return;await checked('/storage/profile',pendingRoot);root=pendingRoot;if(current(pendingOwner)&&root.accounts[pendingOwner.id])pendingOwner.record=root.accounts[pendingOwner.id];pendingRoot=null;pendingOwner=null;}
 async function save(S){return serial(async()=>{
  if(!enabled)return checked('/state',S);await commit();const a=active;let record;
  if(a){if(S.session&&String(S.session.user?.id)!==a.id)throw fail('Локальне сховище іншого акаунта заблоковано.','SESSION_CHANGED');const account=S.accounts[a.id];if(!account||typeof account!=='object')throw fail('Немає розблокованих даних для збереження.');const fields=Object.create(null),values={...account,__session:clone(S.session||a.session)};
   for(const [name,value] of Object.entries(values)){if(name!=='__session'&&!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(name))throw fail('Некоректне поле локального акаунта.');const raw=JSON.stringify(value);if(raw===undefined)continue;const cached=a.cache.get(name);if(cached?.raw===raw)fields[name]=cached.descriptor;else{const descriptor=await writeField(a,raw);a.cache.set(name,{raw,value:JSON.parse(raw),descriptor});fields[name]=descriptor;}}
   const prior=a.record,core={version:1,user:a.user,keyId:a.keyId,wrap:a.wrap,fields,migrationSources:[...a.legacySources]};
   const priorCore=prior?Object.fromEntries(Object.entries(prior).filter(([k])=>!['history','mac'].includes(k))):null;
   if(priorCore&&canonical(priorCore)===canonical(core))record=prior;
   else{const history=[];if(prior){const flat={...prior};delete flat.history;delete flat.mac;history.push(await sign(flat,a.manifestKey));for(const old of prior.history||[])if(history.length<3&&!history.some(x=>x.mac===old.mac))history.push(old);}record=await sign({...core,history},a.manifestKey);}
   if(!current(a))throw fail('Обліковий запис змінився.','SESSION_CHANGED');
  }
  const accounts={...root.accounts,...(record?{[a.id]:record}:{})};pendingOwner=a;pendingRoot={storageProtocol:2,revision:root.revision+1,expectedRevision:root.revision,requestId:crypto.randomUUID(),global:globalState(S),accounts};await commit();if(record&&current(a))a.record=record;
  if(rememberedSessions&&current(a)&&S.session&&!a.remembered){await checked('/vault/remember',{},headers(a));a.remembered=true;}return {ok:true};
 });}
 async function saveJournal(value){if(!enabled)return checked('/journal',value);const a=active;if(!current(a)||String(value.userId)!==a.id)throw fail('Журнал іншого акаунта заблоковано.','SESSION_CHANGED');return checked('/vault/journal',value,headers(a));}
 function beacon(value){if(!enabled)return false;const a=active;if(!current(a)||String(value.userId)!==a.id)return false;return keepalive('/vault/journal',value,headers(a));}
 async function finishMigration(){return serial(async()=>{const a=active;if(!enabled||!a?.legacySources.length)return;try{for(const [name,d] of Object.entries(a.record.fields)){const stored=await readField(a,d);if(stored.raw!==a.cache.get(name)?.raw)throw fail('Нова локальна копія ще не підтверджена.');}for(const id of a.legacySources)await checked('/legacy/'+id+'/complete',{userId:a.id,token:a.session.token},headers(a));a.legacySources=[];migrationWarning='';}catch(error){migrationWarning='Старі копії збережено для повторного перенесення. '+error.message;}});}
 async function lock({forget=true}={}){return serial(async()=>{const a=active;if(!enabled)return;if(forget&&rememberedSessions)await checked('/vault/forget',{});if(!a)return;try{await checked('/vault/close',{},headers(a));}finally{if(current(a)){active=null;generation++;}}});}
 async function collect(){return serial(async()=>{if(enabled&&active)await checked('/storage/gc',{},headers(active));});}
 return {load,readJournal,save,saveJournal,beacon,unlockOnline,unlockOffline,finishMigration,lock,collect,status,get enabled(){return enabled;}};
}
