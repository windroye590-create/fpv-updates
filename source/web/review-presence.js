import {esc} from './core.js';

// A lease belongs to one result (one cadet's submission), never to a whole cadet.
export function createReviewPresence({session,rpc,onChange=()=>{},now=()=>performance.now(),clientId=crypto.randomUUID()}) {
 let state={state:'idle'},entry=null,generation=0,flight=null;
 const path=id=>'/api/instructor/results/'+encodeURIComponent(id)+'/review-session';
 const current=e=>entry===e&&session()?.token===e.token;
 const publish=value=>{state=value;onChange();};
 const release=async e=>{if(e?.leaseId)try{await rpc('POST',path(e.resultId),{action:'release',clientId,leaseId:e.leaseId},e.token);}catch{}};
 function accept(reply,e,renew=false,sentAt=now()){
  const value=reply?.reviewSession;
  if(!value||String(value.resultId)!==e.resultId||!['owned','busy','free','view'].includes(value.state)||!Number.isFinite(value.serverNow))throw Error('Сервер не підтвердив стан перевірки. Спробуйте ще раз.');
  if(value.state==='owned'||value.state==='busy'){
   if(typeof value.reviewerName!=='string'||!Number.isFinite(value.expiresAt)||value.expiresAt<=value.serverNow||value.expiresAt-value.serverNow>125000)throw Error('Сервер повернув некоректний строк перевірки.');
   if(value.state==='owned'&&(typeof value.leaseId!=='string'||!value.leaseId))throw Error('Сервер не підтвердив право збереження.');
  }
  if(value.state==='owned')e.leaseId=value.leaseId;
  const deadline=value.expiresAt ? sentAt+Math.max(0,value.expiresAt-value.serverNow-5000) : 0;
  publish({...value,state:(renew&&value.state==='free')||(value.state==='owned'&&now()>=deadline)?'lost':value.state,deadline});
 }
 async function open(resultId){
  resultId=String(resultId);const epoch=++generation,previous=entry,s=session();flight=null;
  if(!s||s.user?.role!=='instructor')throw Error('Перевірка доступна лише інструктору.');
  if(previous&&(previous.resultId!==resultId||previous.token!==s.token))void release(previous);
  const e={resultId,token:s.token,leaseId:previous?.resultId===resultId&&previous.token===s.token?previous.leaseId:null};entry=e;publish({state:'checking',resultId});
  try{
   let reply;const sentAt=now();
   try{reply=await rpc('POST',path(resultId),{action:'open',clientId},e.token);}
   catch(error){
    if(error.code!=='NOT_FOUND')throw error;
    reply=await rpc('GET','/api/results/'+encodeURIComponent(resultId)+'/review',{},e.token);
    if(epoch===generation&&current(e))publish({state:'unsupported',resultId});
    return epoch===generation&&current(e)?reply:null;
   }
   if(epoch!==generation||!current(e)){
    // A late response cannot hold an abandoned work or affect a new account.
    if(reply.reviewSession?.state==='owned'&&(!entry||entry.resultId!==e.resultId||entry.token!==e.token))void release({...e,leaseId:reply.reviewSession.leaseId});
    return null;
   }
   accept(reply,e,false,sentAt);return reply;
  }catch(error){if(epoch===generation&&current(e))publish({state:'lost',resultId,error:error.message});throw error;}
 }
 function expire(){if(state.state==='owned'&&(!entry||!current(entry)||now()>=state.deadline))publish({...state,state:'lost',error:'Зв’язок із сервером не підтверджено. Чернетку збережено.'});}
 function canEdit(){return Boolean(entry&&current(entry)&&(state.state==='unsupported'||(state.state==='owned'&&now()<state.deadline)));}
 function credentials(){
  expire();if(!canEdit())throw Object.assign(Error('Почніть перевірку або відновіть зв’язок перед збереженням. Чернетку збережено.'),{code:'REVIEW_LEASE_EXPIRED'});
  return state.state==='unsupported'?undefined:{clientId,leaseId:entry.leaseId};
 }
 async function tick(){
  expire();const e=entry;if(!e||!current(e)||state.state==='unsupported'||state.state==='view'||flight)return;
  const epoch=generation;
  const request=(async()=>{
   try{
    const renew=Boolean(e.leaseId),sentAt=now();
    const reply=await rpc(renew?'POST':'GET',path(e.resultId),{clientId,...(renew?{action:'renew',leaseId:e.leaseId}:{})},e.token);
    if(epoch===generation&&current(e))accept(reply,e,renew,sentAt);
   }catch(error){if(epoch===generation&&current(e))publish({...state,state:'lost',error:'Не вдалося підтвердити зв’язок. Чернетку збережено.'});}
  })();flight=request;try{await request;}finally{if(flight===request)flight=null;}
 }
 async function stop(resultId){
  if(resultId!==undefined&&entry?.resultId!==String(resultId))return;
  ++generation;const old=entry;entry=null;flight=null;publish({state:'idle'});await release(old);
 }
 function invalidate(error){if(entry)publish({...state,state:'lost',error:error?.message||'Почніть перевірку знову. Чернетку збережено.'});}
 return {open,tick,stop,expire,canEdit,credentials,invalidate,status:()=>({...state}),clientId};
}

export function reviewPresenceMarkup(value,{queue=false}={}) {
 const state=value?.state;
 if(queue){
  if(state==='busy'||state==='owned')return `<p class="review-presence-line busy"><span class="review-presence-dot" aria-hidden="true"></span>Перевіряє: <strong>${esc(value.reviewerName)}</strong></p>`;
  if(state==='unknown')return '<p class="review-presence-line">Статус потребує оновлення</p>';
  return state==='free'?'<p class="review-presence-line free"><span class="review-presence-dot" aria-hidden="true"></span>Вільна для перевірки</p>':'';
 }
 if(!state||state==='idle'||state==='view')return '';
 const owned=state==='owned',busy=state==='busy',unsupported=state==='unsupported';
 const title=owned?'Ви перевіряєте цю роботу':busy?'Роботу вже перевіряють':state==='checking'?'Підтверджуємо право перевірки…':unsupported?'Спільний статус недоступний':'Перевірка призупинена';
 const detail=owned?'Інші інструктори бачать ваше ім’я. Зміни збережуться після натискання кнопки.':busy?`Перевіряє: ${value.reviewerName}. Відповіді доступні для перегляду.`:unsupported?'Оновіть сервер комісії до API 18. Зберігається попередній захист оцінок від перезапису.':state==='checking'?'Це займе кілька секунд.':value.error||'Робота доступна. Натисніть «Почати перевірку»; вашу чернетку збережено.';
 return `<div class="review-presence ${owned?'owned':busy?'busy':'paused'}" role="status"><span class="review-presence-dot" aria-hidden="true"></span><div><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>${!owned&&!busy&&!unsupported&&state!=='checking'?'<button class="small" data-action="claim-review">Почати перевірку</button>':''}</div>`;
}
