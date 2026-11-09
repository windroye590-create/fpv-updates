const copy=x=>JSON.parse(JSON.stringify(x));
const checkpoint=r=>({answers:copy(r.answers||{}),index:r.index||0,exitCount:r.exitCount||0});
const encode=x=>JSON.stringify(x);
export function createExamSession({session,account,deviceId,rpc,persist,now,changed=()=>{},completed=async()=>{},uuid=()=>crypto.randomUUID()}){
 let flight=Promise.resolve(),busy=false,error='',anchor=null,readyToken='',generation=0;
 const requestTimes=new WeakMap();
 const current=s=>s&&session()?.token===s.token&&String(session()?.user.id)===String(s.user.id);
 function validate(reply,s){
  const d=reply?.document,v=d?.value;
  if(reply?.examProtocol!==1||String(reply.userId)!==String(s.user.id)||!Number.isFinite(reply.serverNow)||!Number.isSafeInteger(d?.revision)||d.revision<0||v&&(!v.test||v.test.mode!=='exam'||!Array.isArray(v.test.questions)||!v.test.questions.length||!v.submissionId||!Number.isSafeInteger(v.fence)||!Number.isFinite(v.startedAt)||!Number.isFinite(v.deadline)||v.deadline<=v.startedAt||!['active','finishing','completed'].includes(v.status)))throw Object.assign(Error('Некоректна відповідь сервера іспиту.'),{code:'BAD_EXAM_STATE'});
  return reply;
 }
 function elapsed(r=account().run){
  if(r?.examProtocol===1){if(anchor?.id===r.submissionId&&anchor.token===session()?.token)return Math.max(0,(anchor.server+Math.max(0,now()-anchor.local)-r.startedAt)/1000);return Math.max(0,r.lastElapsed||0);}
  return Math.max(0,(now()-(r?.startedUptime||0))/1000);
 }
 // Only a lower bound on server time may trigger automatic submission. The
 // conservative display bound can reach zero during a slow request before the
 // actual deadline, in which case sync lets the server decide whether to end.
 function expired(r=account().run){
  return !!(r?.examProtocol===1&&anchor?.id===r.submissionId&&anchor.token===session()?.token&&anchor.lower+Math.max(0,now()-anchor.local)>=r.deadline);
 }
 function owned(r=account().run){return r?.examProtocol===1&&!r.locked&&r.ownerId===deviceId()&&readyToken===session()?.token;}
 function editable(r=account().run){return owned(r)&&!r.finishRequested&&!r.releaseRequested;}
 function status(){const r=account().run;return {busy,error,owned:owned(r),releasing:!!r?.releaseRequested,pending:r?.examProtocol===1&&encode(checkpoint(r))!==r.acknowledged,ready:readyToken===session()?.token};}
 async function accept(reply,s,a,replace=false){
  validate(reply,s);if(!current(s))return false;
  const v=reply.document.value,old=a.run;
  readyToken=s.token;
  if(reply.completion){
   if(old?.submissionId===v?.submissionId||!old){a.run=null;delete a.examRequest;await completed(reply.completion,s,a);}
   a.examAvailable=null;anchor=null;await persist();return true;
  }
  if(!v){a.examAvailable=null;return true;}
  a.examAvailable={...copy(v),revision:reply.document.revision};
  const received=now(),sent=requestTimes.get(reply)??received;
  // The send time gives a conservative bound when the response is delayed.
  // A later clock sample must never move this attempt's timer backwards.
  const sameAnchor=anchor?.id===v.submissionId&&anchor.token===s.token;
  const previous=sameAnchor?anchor.server+Math.max(0,received-anchor.local):0;
  const lower=sameAnchor?anchor.lower+Math.max(0,received-anchor.local):0;
  anchor={id:v.submissionId,token:s.token,server:Math.max(previous,reply.serverNow+Math.max(0,received-sent)),lower:Math.max(lower,reply.serverNow),local:received};
  const same=old?.submissionId===v.submissionId;
  const mine=v.ownerId===deviceId();
  if(replace||!old||!same||!mine||old.locked){
   if(old?.examProtocol===1&&encode(checkpoint(old))!==old.acknowledged&&(!same||!mine)){
    a.examBackups??=[];a.examBackups.unshift({submissionId:old.submissionId,...checkpoint(old)});a.examBackups=a.examBackups.slice(0,5);
   }
   a.run={...copy(v),examProtocol:1,userId:String(s.user.id),revision:reply.document.revision,acknowledged:encode(checkpoint(v)),locked:!mine,lastElapsed:Math.max(0,(anchor.server-v.startedAt)/1000)};
  }else{old.revision=reply.document.revision;old.fence=v.fence;}
  await persist();return true;
 }
 async function request(path,body,s){const sent=now(),reply=validate(await rpc(path==='/api/exam-session'?'GET':'POST',path,body,s.token),s);requestTimes.set(reply,sent);return reply;}
 function serial(work){
  const owner=session(),epoch=generation;
  const task=flight.catch(()=>{}).then(async()=>{
   if(epoch!==generation||!current(owner)||owner.user.role!=='cadet')return false;
   busy=true;error='';changed();
   try{return await work();}catch(x){if(!current(owner))return false;error=x.code==='NOT_FOUND'?'Для продовження іспиту потрібен оновлений сервер.':x.message;
    const r=account().run;if(['EXAM_TAKEN','EXAM_REPLACED'].includes(x.code)&&r?.examProtocol===1)r.locked=true;
    changed();throw x;
   }finally{if(epoch===generation){busy=false;changed();}}
  });flight=task;return task;
 }
 async function discoverWork(){
  const s=session(),a=account(),reply=await request('/api/exam-session',{},s);
  if(!current(s))return false;
  return accept(reply,s,a);
 }
 function discover(){return serial(discoverWork);}
 function start(testId,legacy=null){return serial(async()=>{
  const s=session(),a=account();
  const reply=await request('/api/exam-session/start',{testId,deviceId:deviceId(),requestId:uuid(),...(legacy?{legacy:{...checkpoint(legacy),lastElapsed:legacy.lastElapsed||0,submissionId:legacy.submissionId}}:{})},s);
  if(!current(s))return false;
  return accept(reply,s,a,true);
 });}
 function claim(){return serial(async()=>{
  const s=session(),a=account();await discoverWork();if(!current(s)||!a.run)return false;
  let r=a.run;
  if(owned(r)){
   if(a.examClaim?.requestId===r.claimId){delete a.examClaim;await persist();return true;}
   await writeWork();r=a.run;if(!r)return true;
  }
  a.examClaim??={submissionId:r.submissionId,deviceId:deviceId(),fence:r.fence,requestId:uuid()};
  if(a.examClaim.submissionId!==r.submissionId||a.examClaim.fence!==r.fence)a.examClaim={submissionId:r.submissionId,deviceId:deviceId(),fence:r.fence,requestId:uuid()};
  await persist();
  const reply=await request('/api/exam-session/claim',a.examClaim,s);
  if(!current(s))return false;
  delete a.examClaim;return accept(reply,s,a,true);
 });}
 async function writeWork(action='save'){
  const s=session(),a=account(),r=a.run;if(!r||r.examProtocol!==1)return true;
  if(!owned(r)){await discoverWork();if(!owned()||account().run?.submissionId!==r.submissionId)throw Object.assign(Error('Продовжіть іспит на цьому ПК, щоб зберігати відповіді.'),{code:'EXAM_TAKEN'});}
  if(action==='save'&&r.releaseRequested)action='release';
  if(action==='save'&&r.finishRequested)action='finish';
  if(action==='save'&&expired(r))action='finish';
  const value=checkpoint(r),raw=encode(value);
  if(action==='save'&&raw===r.acknowledged&&elapsed(r)<(r.deadline-r.startedAt)/1000){await discoverWork();return true;}
  let pending=a.examRequest;
  if(pending&&(pending.submissionId!==r.submissionId||pending.fence!==r.fence)){delete a.examRequest;pending=null;}
  if(!pending){pending={action,submissionId:r.submissionId,deviceId:deviceId(),fence:r.fence,expectedRevision:r.revision,requestId:uuid(),checkpoint:value};a.examRequest=pending;await persist();}
  const reply=await request('/api/exam-session/'+pending.action,pending,s);
  if(!current(s))return false;
  if(reply.completion){delete a.examRequest;return accept(reply,s,a);}
  if(account().run!==r)return false;
  r.acknowledged=encode(pending.checkpoint);r.revision=reply.document.revision;delete a.examRequest;
  const release=pending.action==='release';await accept(reply,s,a,release);
  if(pending.action!==action||encode(checkpoint(r))!==r.acknowledged){if(!release)return writeWork(action);}
  return true;
 }
 const sync=()=>serial(async()=>{const r=account().run;if(r?.examProtocol===1&&owned(r))return writeWork();return discoverWork();});
 function finish(){return serial(async()=>{
  const r=account().run;if(!owned(r))throw Object.assign(Error('Спочатку продовжіть іспит на цьому ПК.'),{code:'EXAM_TAKEN'});
  r.finishRequested=true;await persist();return writeWork('finish');
 });}
 function release(){
  const s=session(),r=s&&account().run;
  // Freeze immediately, including the time spent waiting behind an earlier save.
  if(r?.examProtocol===1){r.releaseRequested=true;changed();}
  return serial(()=>writeWork('release')).catch(x=>{if(current(s)&&account().run===r&&account().examRequest?.action!=='release'){delete r.releaseRequested;changed();}throw x;});
 }
 function reset(){generation++;flight=Promise.resolve();busy=false;readyToken='';anchor=null;error='';}
 return {status,owned,editable,elapsed,expired,start,claim,discover,sync,finish,release,reset};
}
