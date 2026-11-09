const encode=value=>JSON.stringify(value??null);
const copy=value=>JSON.parse(encode(value));
const fingerprint=async raw=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const keyAllowed=(key,role)=>role==='instructor'?(key==='test-draft'||/^grading:[A-Za-z0-9_-]{1,80}$/.test(key)):key==='training';
const transient=code=>['NETWORK','TIMEOUT','BUSY','STATE_BUSY','SERVER_ERROR','HTTP_408','HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_504'].includes(code);

// Each computer keeps the last acknowledged value and revision. A remote write
// can replace a clean local copy, never an unacknowledged local change.
export function createAccountSync({session,account,snapshot,apply,rpc,persist,changed=()=>{},now=Date.now,uuid=()=>crypto.randomUUID(),delay=3000}){
 let generation=0,readyToken='',running=null,timer=null,busy=false,error='',unsupported=false,lastAt=0,retryAt=0;
 const owner=()=>session()?{...session(),generation}:null;
 const current=s=>s&&s.generation===generation&&session()?.token===s.token&&String(session()?.user?.id)===String(s.user.id);
 const state=a=>a.pcSync??={revisions:{},shadow:{},requests:{},conflicts:{},cursor:''};
 const dirty=(a=account())=>{
  const s=state(a),values=snapshot(a);
  return [...new Set([...Object.keys(s.shadow),...Object.keys(values)])]
   .filter(k=>keyAllowed(k,session()?.user?.role)&&encode(values[k])!==encode(s.shadow[k]));
 };
 function status(){
  if(!session())return {pending:0,busy:false,error:'',conflicts:[],ready:false,lastAt:0};
  const a=account(),s=state(a);
  return {pending:dirty(a).length,busy,error,unsupported,lastAt,ready:readyToken===session().token,
   conflicts:Object.keys(s.conflicts).map(key=>({key,document:s.conflicts[key]}))};
 }
 function notify(){changed(status());}
 function schedule(){
  clearTimeout(timer);timer=setTimeout(()=>sync().catch(()=>{}),delay);
 }
 function localChanged(){
  if(!session())return;
  notify();if(dirty().length)schedule();
 }
 function validate(r,s){
  if(r?.accountSyncProtocol!==1||String(r.userId)!==String(s.user.id))throw Object.assign(Error('Сервер повернув дані іншого облікового запису.'),{code:'BAD_ACCOUNT_STATE'});
  return r;
 }
 function validDocument(d,s){
  if(!d||!keyAllowed(d.key,s.user.role)||!Number.isSafeInteger(d.revision)||d.revision<0||!Object.prototype.hasOwnProperty.call(d,'value')||d.value!==null&&(typeof d.value!=='object'||Array.isArray(d.value)))throw Object.assign(Error('Сервер повернув некоректну чернетку.'),{code:'BAD_ACCOUNT_STATE'});
  return d;
 }
 async function pull(s,a,force){
  const st=state(a),index=validate(await rpc('GET','/api/account-state',{known:force?'':st.cursor},s.token),s);
  if(!current(s))return;
  if(typeof index.cursor!=='string'||!Array.isArray(index.documents)||index.documents.length>10000)throw Object.assign(Error('Некоректний список чернеток.'),{code:'BAD_ACCOUNT_STATE'});
  for(const item of index.documents){
   if(!current(s))return;
   if(!item||!keyAllowed(item.key,s.user.role)||!Number.isSafeInteger(item.revision)||item.revision<1)throw Object.assign(Error('Некоректна версія чернетки.'),{code:'BAD_ACCOUNT_STATE'});
   if(item.revision<=(st.revisions[item.key]||0))continue;
   const r=item.deleted===true?{accountSyncProtocol:1,userId:String(s.user.id),document:{...item,value:null}}:validate(await rpc('GET','/api/account-state/document',{key:item.key},s.token),s);
   if(!current(s))return;
   const d=validDocument(r.document,s);
   if(d.key!==item.key||d.revision<item.revision)throw Object.assign(Error('Чернетка зараз оновлюється. Повторіть синхронізацію.'),{code:'STATE_BUSY'});
   const local=snapshot(a)[d.key]??null,base=st.shadow[d.key]??null;
   if(d.revision<(st.revisions[d.key]||0))continue;
   const unknownBase=!Object.prototype.hasOwnProperty.call(st.revisions,d.key);
   if(encode(local)!==encode(base)&&(unknownBase||encode(d.value)!==encode(base))&&encode(d.value)!==encode(local)){
    st.conflicts[d.key]=copy(d);delete st.requests[d.key];continue;
   }
   if(encode(local)===encode(base)||encode(local)===encode(d.value)){
    const applied=await apply(d.key,copy(d.value),a);if(!current(s))return;
    if(applied===false){st.conflicts[d.key]=copy(d);delete st.requests[d.key];continue;}
    delete st.requests[d.key];
   }
   st.revisions[d.key]=d.revision;st.shadow[d.key]=copy(d.value);delete st.conflicts[d.key];
  }
  if(!current(s))return;
  if(index.stable===true)st.cursor=index.cursor;else st.cursor='';
  readyToken=s.token;unsupported=false;await persist();
 }
 async function work(force){
  const s=owner();if(!s)return;const a=account(),st=state(a);
  if(!force&&now()<retryAt)return;
  busy=true;error='';notify();
  try{
   await pull(s,a,force||readyToken!==s.token);
   if(!current(s))return;
   for(const key of dirty(a)){
    if(!current(s))return;if(st.conflicts[key])continue;
    const value=copy(snapshot(a)[key]),raw=encode(value),revision=st.revisions[key]||0;
    if(raw.length>2800000)throw Object.assign(Error('Чернетка завелика для синхронізації. Дані на цьому ПК збережено.'),{code:'STATE_TOO_LARGE'});
    const digest=await fingerprint(raw);if(!current(s))return;
    let request=st.requests[key];
    const same=request&&request.expectedRevision===revision&&(request.digest===digest||request.raw===raw);
    if(!same||request.value!==undefined||request.raw!==undefined){request={key,expectedRevision:revision,requestId:same?request.requestId:uuid(),digest};st.requests[key]=request;await persist();}
    const body={key,expectedRevision:revision,requestId:request.requestId,value};
    let r;
    try{r=validate(await rpc('POST','/api/account-state/document',body,s.token),s);}
    catch(x){if(x.code==='REVISION_CONFLICT'){st.cursor='';await pull(s,a,true);continue;}throw x;}
    if(!current(s))return;
    const d=validDocument(r.document,s);
    if(d.key!==key||d.revision<revision+1||encode(d.value)!==raw)throw Object.assign(Error('Сервер не підтвердив збереження чернетки.'),{code:'BAD_ACCOUNT_STATE'});
    st.revisions[key]=d.revision;st.shadow[key]=copy(d.value);delete st.requests[key];delete st.conflicts[key];await persist();
   }
   if(current(s)){lastAt=now();retryAt=0;}
  }catch(x){
   if(current(s)){
    unsupported=x.code==='NOT_FOUND';
    error=unsupported?'Для синхронізації між ПК потрібно оновити серверний Code.gs.':x.message;
    retryAt=now()+(transient(x.code)?10000:30000);
   }
  }finally{
   if(current(s)){
    busy=false;notify();
    if(!error&&dirty(a).some(k=>!st.conflicts[k]))schedule();
   }
  }
 }
 function sync(force=false){
  clearTimeout(timer);timer=null;
  if(running)return running.then(()=>force?sync(true):undefined);
  const epoch=generation;
  running=work(force).finally(()=>{if(epoch===generation)running=null;});return running;
 }
 async function resolve(key,choice){
  const s=owner();if(!s)return;const a=account(),st=state(a),remote=st.conflicts[key];if(!remote||!['local','remote'].includes(choice))return;
  a.syncBackups??=[];a.syncBackups.unshift({key,value:copy(choice==='remote'?snapshot(a)[key]:remote.value),at:now()});a.syncBackups=a.syncBackups.slice(0,20);
  if(choice==='remote'&&await apply(key,copy(remote.value),a,{resolved:true})===false)return;
  if(!current(s))return;
  st.revisions[key]=remote.revision;st.shadow[key]=copy(remote.value);delete st.conflicts[key];delete st.requests[key];
  await persist();if(current(s))await sync(true);
 }
 function reset(){generation++;clearTimeout(timer);timer=null;running=null;busy=false;readyToken='';error='';unsupported=false;lastAt=0;retryAt=0;notify();}
 return {changed:localChanged,status,sync,resolve,reset};
}
