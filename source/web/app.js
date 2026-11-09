import * as C from './core.js';
import {reportModel,xlsxBytes,reportFilename,XLSX_MIME} from './excel-report.js';
import {learningUnits,learningSummary} from './learning.js';
import {readWorkspace,workspaceRequest} from './workspace.js';
import {createDurableWriter} from './durability.js';
import {createSecureStorage} from './secure-storage.js';
import {createAccountSync} from './account-sync.js';
import {createExamSession} from './exam-session.js';
import {createUpdater} from './updater.js';
import {createMaterials} from './materials.js';
import {createCadetCard} from './cadet-card.js';
import {createReviewPresence,reviewPresenceMarkup} from './review-presence.js';
import {createPublicTableSync} from './public-table-sync.js';
import {importOffice,importQuestionError,OFFICE_MAX_BYTES} from './office-import.js';
import {statementTests,buildStatement,statementPdf} from './statement.js';
import {compactResults,buildRanking,searchRanking,rankingTable,rankingCSV} from './results.js';
const $=s=>document.querySelector(s),app=$('#app'),modal=$('#modal');
// Native browser prompts otherwise follow Windows/browser language, even with lang=uk.
document.addEventListener('invalid',event=>{
 const el=event.target;if(typeof el.setCustomValidity!=='function')return;
 el.setCustomValidity('');const v=el.validity;
 const message=v.valueMissing?(el.tagName==='SELECT'?'Оберіть значення зі списку.':el.type==='checkbox'?'Позначте цей пункт.':'Заповніть це поле.'):
  v.typeMismatch?(el.type==='email'?'Введіть правильну електронну адресу.':'Введіть правильне значення.'):
  v.tooShort?`Введіть щонайменше ${el.minLength} символів.`:
  v.tooLong?`Введіть не більше ${el.maxLength} символів.`:
  v.rangeUnderflow?`Введіть число, не менше ${el.min}.`:
  v.rangeOverflow?`Введіть число, не більше ${el.max}.`:
  v.stepMismatch?'Введіть допустиме числове значення.':
  v.patternMismatch?'Дотримуйтеся вказаного формату.':v.badInput?'Введіть правильне число.':'';
 if(message)el.setCustomValidity(message);
},true);
for(const type of ['input','change'])document.addEventListener(type,event=>{
 if(typeof event.target.setCustomValidity==='function')event.target.setCustomValidity('');
},true);
const key=new URL(location.href).searchParams.get('key')||'';
const windowId=crypto.randomUUID();
let reviewClientId=windowId;try{reviewClientId=sessionStorage.getItem('lk-review-client')||windowId;sessionStorage.setItem('lk-review-client',reviewClientId);}catch{}
const leaseKey='lk-pc-window';localStorage.setItem(leaseKey,windowId);
let replaced=false,menuOpen=false;
window.addEventListener('storage',e=>{if(e.key===leaseKey&&e.newValue!==windowId){replaced=true;app.innerHTML='<div class="boot">Відкрито нове вікно програми.<small>Продовжуйте роботу в ньому.</small></div>';}});
let S={version:1,session:null,groups:[],accounts:{},theme:'light'},page='home',authRole='instructor',authMode='login',lastError='',working=false,refreshing=false,saving=Promise.resolve(),clock=null,filter='',preview=null,lastResult=null,bank=[],audit=[],analytics=null,reviewQueue=[],examRecoveryQueue=[],grading=null;
let diskStateLoaded=false;
let workspaceUnavailableUntil=0,refreshQueued=false,forceQueued=false,journalError='',scheduledSave=false,journalPending=0;
let intakeRunning='';
let authUsername='',authGroup='',updateInfo={message:'Оновлення перевіряються й завантажуються автоматично.'};
let updateApplying=false,rpcFlights=0;
let saveTimer,timerInterval,syncing=false,away=false,lastTimerSaved=0,checkpoint=null,journalSaving=Promise.resolve();
let cloudRenderNeeded=false;
const icons={menu:'M4 6h16M4 12h16M4 18h16',home:'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1z',tests:'M8 3h9a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2M9 8h6M9 12h6M9 16h4',groups:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',results:'M5 20V10M12 20V4M19 20v-7M2 21h20',more:'M12 3v2M12 19v2M3 12h2M19 12h2M6 6l1 1M17 17l1 1M6 18l1-1M17 7l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',bank:'M3 3h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v17h-6a4 4 0 0 0-3 1 4 4 0 0 0-3-1H3zM12 5v16',cadets:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 6 0 0 1 16 0v2'};
const svg=n=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[n]||icons.tests}"/></svg>`;
const brandArt='<img class="brand-art" src="/icon.png" alt="" aria-hidden="true">';
const e=C.esc,id=C.id;
const user=()=>S.session?.user;
const instructor=()=>user()?.role==='instructor';
const listPages=Object.create(null),cadetViews=new WeakMap(),sharedTestSearches=new WeakMap();
const instructorRequests=new Map();
function resetPage(name){listPages[name]=1;}
function paginate(name,items){const p=C.pageSlice(items,listPages[name]);listPages[name]=p.page;return {...p,controls:p.total>C.LIST_PAGE_SIZE?`<nav class="list-pager" aria-label="Сторінки списку"><span role="status">${p.start}–${p.end} із ${p.total}</span><div class="actions"><button data-action="list-page" data-list="${e(name)}" data-index="${p.page-1}" ${p.page===1?'disabled':''}>← Попередні</button><span>Сторінка ${p.page} із ${p.pages}</span><button data-action="list-page" data-list="${e(name)}" data-index="${p.page+1}" ${p.page===p.pages?'disabled':''}>Наступні →</button></div></nav>`:''};}
const reviewPresence=createReviewPresence({session:()=>S.session,rpc,onChange:updateReviewPresenceUI,clientId:reviewClientId});
const publicTableSync=createPublicTableSync({session:()=>S.session,account,rpc,changed:()=>{scheduleSave();updatePublicTableSyncUI();}});
let reviewQueueFlight=null,reviewQueueError='',reviewQueueAt=0,reviewQueueRevision=null,reviewPollFlight=null,reviewPollUnavailableUntil=0,reviewQueueToken='',reviewQueueUpdatedAt=0;
const materials=createMaterials({matches:m=>matchesMaterial(m),paginate,resetPage,account,session:()=>S.session,rpc,persist,toast,render,dialog,confirmAction,modal,esc:C.esc,groups:()=>S.groups,tests:()=>account().tests,startTest:start,alive,filters:materialFilterControls,scheduleSave});
const cadetCard=createCadetCard({account,session:()=>S.session,rpc,persist,render,toast,paginate,resetPage,scheduleSave,openGrading,isOpen:()=>page==='cadet-card'});
function account(){const k=id(user()?.id),a=S.accounts[k]??= {tests:[],results:[],cadets:[],fullTests:{},pending:[],reviews:{},draft:null,run:null,updatedAt:0,resultTotal:0};a.reviews??={};a.examRecoveries??=[];for(const [rid,draft] of Object.entries(a.gradingDrafts||{})){if(draft?.items&&Object.keys(draft.items).length===0)delete a.gradingDrafts[rid];}{if(!cadetViews.has(a.tests)){const safe=C.cadetTests(a.tests);cadetViews.set(a.tests,safe);cadetViews.set(safe,safe);}a.tests=cadetViews.get(a.tests);}return a;}
function resetSessionViews(){
 bank=[];audit=[];analytics=null;preview=null;lastResult=null;grading=null;filter='';menuOpen=false;
 reviewQueue=[];examRecoveryQueue=[];reviewQueueFlight=null;reviewQueueToken='';reviewQueueUpdatedAt=0;reviewQueueAt=0;reviewQueueRevision=null;reviewQueueError='';
 loadAnalytics.flight=null;loadAnalytics.error='';exportResultsXlsx.flight=null;downloadIntakeArchive.flights?.clear();instructorRequests.clear();
 for(const name of Object.keys(listPages))delete listPages[name];
 materials.reset();modal.close();modal.innerHTML='';
}
function instructorsPanel(){
 const a=account(),state=instructorRequests.get(S.session.token)||{},all=a.instructors||[];
 const items=all.filter(u=>[C.nameOf(u),u.username,C.titleOf(u)].join(' ').toLocaleLowerCase('uk-UA').includes(filter.toLocaleLowerCase('uk-UA'))),p=paginate('more',items);
 const stamp=a.instructorsAt?'Оновлено '+date(a.instructorsAt):'Список ще не завантажено.';
 return `<section class="panel" id="instructors-panel" style="margin-bottom:20px"><div class="panel-heading"><h2>Викладачі та інструктори</h2><button data-action="refresh-instructors" ${state.pending?'disabled':''}>${state.pending?'Оновлюємо…':'Оновити список'}</button></div><p>Усі зареєстровані викладачі та інструктори цієї комісії.</p><div class="toolbar"><input id="filter" aria-label="Пошук викладачів та інструкторів" placeholder="ПІБ, логін або посада…" value="${e(filter)}"></div><p class="muted" role="status">${e(state.pending?'Завантажуємо список…':stamp)}${a.instructorsAt?' · Усього: '+all.length:''}</p>${state.error?`<div class="notice warn" role="alert">${e(state.error)}${a.instructorsAt?' Показано останній збережений список.':''}</div>`:''}${p.items.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Список викладачів та інструкторів"><table><thead><tr><th>ПІБ</th><th>ЛОГІН</th><th>ПОСАДА</th><th>СТАТУС</th><th>ЗАРЕЄСТРОВАНИЙ</th></tr></thead><tbody>${p.items.map(u=>`<tr><td><strong>${e(C.nameOf(u))}</strong></td><td>${e(u.username)}</td><td>${e(C.titleOf(u))}</td><td>${u.active?'Активний':'Вимкнено'}</td><td>${e(date(u.createdAt))}</td></tr>`).join('')}</tbody></table></div>${p.controls}`:state.pending&&!a.instructorsAt?'<p>Завантажуємо зареєстровані облікові записи…</p>':a.instructorsAt?empty(all.length?'Нікого не знайдено':'Список порожній',all.length?'Змініть пошуковий запит.':'Зареєстрованих викладачів та інструкторів поки немає.'):'<p>Натисніть «Оновити список», щоб завантажити облікові записи.</p>'}</section>`;
}
async function loadInstructors(){
 if(!instructor())return;
 const session=S.session,a=account(),previous=instructorRequests.get(session.token);
 if(previous?.pending)return previous.promise;
 const state={pending:true,error:'',promise:null};instructorRequests.set(session.token,state);
 const current=()=>S.session?.token===session.token&&instructor();
 state.promise=(async()=>{
  try{
   const reply=await rpc('GET','/api/instructor/instructors',{},session.token);
   if(!current())return;
   const seen=new Set(),bad=()=>{throw Error('Сервер повернув некоректний список викладачів та інструкторів.');};
   if(!Array.isArray(reply.instructors))bad();
   const items=reply.instructors.map(u=>{
    if(!u||!id(u.id).trim()||seen.has(id(u.id))||u.role!=='instructor'||typeof u.username!=='string'||!u.username.trim()||typeof u.fullName!=='string'||typeof u.active!=='boolean')bad();
    seen.add(id(u.id));
    return {id:id(u.id),fullName:u.fullName,username:u.username,role:'instructor',active:u.active,createdAt:u.createdAt&&Number.isFinite(new Date(u.createdAt).getTime())?String(u.createdAt):''};
   });
   const changed=!a.instructorsAt||JSON.stringify(a.instructors)!==JSON.stringify(items);
   a.instructors=items;a.instructorsAt=Date.now();if(changed)await persist();
  }catch(x){if(current())state.error=x.message;}
  finally{state.pending=false;state.promise=null;if(current()&&page==='more')render();}
 })();
 if(page==='more')render();return state.promise;
}
const date=v=>v?new Date(v).toLocaleString('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const time=n=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
const groupOptions=(value='',useId=false,empty='Оберіть групу')=>`<option value="">${empty}</option>`+S.groups.filter(g=>!(authMode==='register'&&!user()&&g.archived)).map(g=>`<option value="${e(useId?g.id:g.name)}" ${id(value)===id(useId?g.id:g.name)?'selected':''}>${e(g.name)}</option>`).join('');
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function alive(){return !replaced&&localStorage.getItem(leaseKey)===windowId;}
async function local(path,body,headers={}){
 if(!alive())throw Error('Програму відкрито в іншому вікні.');
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),path==='/rpc'||path.startsWith('/legacy/')?90000:15000);
 try{const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'X-LK-Key':key,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});if(!r.ok)throw Error('Локальний модуль не відповідає. Закрийте вікно та запустіть EXE знову.');return await r.json();}catch(x){if(x.name==='AbortError'){const err=Error('Запит триває надто довго. Дані залишаються збереженими.');err.code='TIMEOUT';throw err;}throw x;}finally{clearTimeout(timeout);}
}
const secureStorage=createSecureStorage({local,keepalive:(path,value,headers)=>{
 const raw=JSON.stringify(value);if(new TextEncoder().encode(raw).length>=60000)return false;
 fetch(path,{method:'POST',headers:{'X-LK-Key':key,'Content-Type':'application/json',...headers},body:raw,keepalive:true}).catch(()=>{});return true;
}});
function storageNotice(compact=false){
 const v=diskWriter.status(),pending=user()?account().pending:[],problem=v.error||journalError;
 const cloud=accountSync.status();
 const protectedStatus=typeof secureStorage!=='undefined'?secureStorage.status():{},recoveryMessage=protectedStatus.migrationWarning||(protectedStatus.recoveredCopies?'Дані відновлено з перевіреної резервної копії. Перегляньте останні зміни перед продовженням роботи.':'');
 const message=problem?'Не збережено на диску: '+problem:(v.pending||scheduledSave||journalPending)?'Зберігаємо на цьому ПК…':pending.some(p=>p.permanent)?'Потрібна дія: перевірте результати в черзі.':pending.length?'Збережено на ПК · очікують сервера: '+pending.length:cloud.conflicts.length?'Є інша версія чернетки з другого ПК. Оберіть, яку продовжити.':cloud.error?cloud.error+' Дані на цьому ПК збережено.':cloud.busy?'Синхронізуємо акаунт…':cloud.pending?'Збережено на ПК · чекаємо синхронізації з акаунтом.':cloud.ready?'Синхронізовано з акаунтом · можна продовжити на іншому ПК.':'Завантажуємо дані акаунта…';
 const warning=problem||cloud.error||cloud.conflicts.length||pending.some(p=>p.permanent);
 if(compact&&!warning&&!recoveryMessage)return '<div id="durability-status" hidden></div>';
 return `<div id="durability-status" class="sync-status ${problem||cloud.error||cloud.conflicts.length||pending.some(p=>p.permanent)?'warn':''}" role="status"><span>${e(message)}</span>${problem?'<button class="small" data-action="retry-save">Повторити збереження</button>':cloud.conflicts.length?'<button class="small" data-action="sync-conflicts">Переглянути зміни</button>':compact?'':'<button class="small" data-action="refresh" '+(cloud.busy?'disabled':'')+'>Оновити дані</button>'}${recoveryMessage?'<span class="storage-recovery">'+e(recoveryMessage)+'</span>':''}</div>`;
}
function syncAccountButton(){
 const cloud=accountSync.status(),message=cloud.error||cloud.conflicts.length?'Потрібна увага: перегляньте повідомлення про синхронізацію.':cloud.busy?'Синхронізуємо акаунт…':cloud.pending?'Є зміни, які очікують синхронізації.':cloud.ready?'Синхронізовано з акаунтом · можна продовжити на іншому ПК.':'Завантажуємо дані акаунта…';
 const busy=updateData.flight?.token===S.session?.token||refreshing===S.session?.token||cloud.busy||syncing===S.session?.token||page==='cadet-card'&&(cadetCard.loading||cadetCard.saving);
 return `<button id="account-sync-button" data-action="refresh" title="${e(message)}" ${busy?'disabled aria-busy="true"':''}>${busy?'Оновлюємо…':'↻ Оновити дані'}</button>`;
}
function updateData(){
 if(updateApplying||!user()||!alive())return Promise.resolve();
 const token=S.session.token,a=account();if(updateData.flight?.token===token)return updateData.flight.promise;
 const flight={token,promise:null},current=()=>S.session?.token===token&&account()===a&&alive()&&!updateApplying;
 updateData.flight=flight;refresh.manualToken=token;
 flight.promise=Promise.resolve().then(async()=>{
  render();await persist();if(!current())return;
  const queue=syncQueue.completion;if(queue?.token===token)await queue.promise;if(!current())return;
  await syncQueue(true);if(!current())return;
  await materials.syncProgress();if(!current())return;
  await refresh(true);const workspace=refresh.completion;if(workspace?.token===token)await workspace.promise;if(!current())return;
  if(pendingReviewsPage()&&reviewQueueFlight?.token===token)await reviewQueueFlight.promise;if(!current())return;
  if(page==='bank')await navigate('bank');else if(page==='analytics')await loadAnalytics();if(!current())return;
  await accountSync.sync(true);if(!current())return;
  await publicTableSync.tick(true);
 }).finally(()=>{if(refresh.manualToken===token)delete refresh.manualToken;if(updateData.flight===flight){updateData.flight=null;if(current())render();}});
 return flight.promise;
}
function updateStorageNotice(){const b=$('#account-sync-button'),n=$('#durability-status');if(n)n.outerHTML=storageNotice(Boolean(b));if(b)b.outerHTML=syncAccountButton();}
function publicTableSyncNotice(){const pending=account().publicTableSync?.state==='pending';return `<div id="public-table-sync-status" ${pending?'class="notice warn" role="status"':'hidden'}>${pending?'Результати збережено в застосунку. Спільна Google Таблиця очікує синхронізації; повторимо автоматично після відновлення зв’язку.':''}</div>`;}
function updatePublicTableSyncUI(){const n=$('#public-table-sync-status');if(n)n.outerHTML=publicTableSyncNotice();}
const diskWriter=createDurableWriter(async()=>{if(!alive())throw Error('Програму відкрито в іншому вікні.');if(!diskStateLoaded)throw Object.assign(Error('Спочатку потрібно прочитати збережені дані. Повторіть запуск.'),{code:'STORAGE_READ'});const r=typeof secureStorage!=='undefined'?await secureStorage.save(S):await local('/state',S);if(r.ok===false)throw Object.assign(Error(r.error||'Не вдалося зберегти дані на диску.'),{code:r.code});},updateStorageNotice);
const accountSync=createAccountSync({session:()=>S.session,account,snapshot:accountDocuments,apply:applyAccountDocument,rpc,
 persist:()=>diskWriter.save(),changed:()=>{updateStorageNotice();if(cloudRenderNeeded&&!accountSync.status().busy){cloudRenderNeeded=false;if(!modal.open&&page!=='runner'&&page!=='result')render();}}});
const examSession=createExamSession({session:()=>S.session,account,deviceId:()=>S.deviceId??=(crypto.randomUUID()),rpc,now:uptime,persist:()=>diskWriter.save(),
 changed:()=>{updateStorageNotice();if(user()&&page==='runner'&&account().run?.examProtocol===1){const block=$('#exam-state');if(block)block.outerHTML=examNotice();const r=account().run,disabled=!examSession.editable(r),fields=$('.run-answers');if(fields)fields.disabled=disabled;for(const action of ['finish','handoff-exam']){const b=$(`[data-action="${action}"]`);if(b)b.disabled=disabled;}document.querySelectorAll('[data-action="question"],[data-action="prev"],[data-action="next"],[data-action="unanswered"]').forEach(b=>{b.disabled=disabled||(b.dataset.action==='prev'&&(r.index||0)===0)||(b.dataset.action==='next'&&(r.index||0)===r.test.questions.length-1);});}},
 completed:async(reply,session,a)=>{C.validateResult(reply.result,session.user.id,reply.result.testId);a.results=C.mergeResults(a.results,[reply.result]);a.resultWriteVersion=(a.resultWriteVersion||0)+1;const review=C.enrichReview(reply.review,a.fullTests[id(reply.result.testId)]);a.reviews[id(reply.result.id)]=review;if(page==='runner'||page==='result'){lastResult={...reply,review,testId:id(reply.result.testId)};page='result';render();document.exitFullscreen?.().catch(()=>{});}}
});
function examNotice(){const r=account().run,v=examSession.status();if(r?.examProtocol!==1)return '';const message=r.releaseRequested?'Зберігаємо відповіді й передаємо іспит на інший ПК. Дочекайтеся підтвердження.':r.locked?'Іспит відкрито на іншому ПК. Щоб продовжити тут, поверніть редагування.':r.finishRequested?'Завершуємо іспит. Очікуємо підтвердження сервера.':v.error?v.error+' Незбережені відповіді залишилися на цьому ПК.':v.busy?'Зберігаємо спробу в акаунті…':v.pending?'Є нові відповіді. Очікуємо збереження в акаунті.':'Спробу збережено в акаунті. Можна продовжити з іншого ПК.';return `<div id="exam-state" class="sync-status ${r.locked||v.error?'warn':''}" role="status"><span>${e(message)}</span><button data-action="${r.locked?'resume':'sync-exam'}" ${v.busy?'disabled':''}>${r.locked?'Продовжити тут':'Зберегти зараз'}</button></div>`;}
async function resumeRun(){
 const session=S.session,r=account().run;if(!session||!r)return;
 if(C.isRetakeTest(r.test))throw Error('Повторне проходження тестів вимкнено. Збережені відповіді залишаються на цьому ПК.');
 if(r.test.mode==='exam'&&r.examProtocol===1){
  if(S.session?.token!==session.token)return;
  if(!account().run)return render();
  const take=async()=>{if(S.session?.token!==session.token)return;await examSession.claim();if(S.session?.token!==session.token)return;if(account().run){page='runner';render();document.documentElement.requestFullscreen?.().catch(()=>{});}else render();};
  if(account().run.ownerId&&account().run.ownerId!==S.deviceId)return confirmAction('Продовжити іспит на цьому ПК?','Завантажимо останні збережені відповіді. Попередній ПК більше не зможе змінювати цю спробу. Початковий час завершення залишається тим самим.',take,'Продовжити тут');
  return take();
 }
 await getClock();if(S.session?.token!==session.token)return;page='runner';render();
}
function unfinishedWork(){const a=account(),cards=[];
 if(instructor()){
  if(a.draft)cards.push(`<div class="row"><div><strong>${e(a.draft.title||'Новий тест')}</strong><p>Редагування · питання ${(a.draft.resumeQuestion||0)+1}</p></div><button data-action="edit-draft">Продовжити</button></div>`);
  for(const rid of Object.keys(a.gradingDrafts||{})){const result=a.results.find(r=>id(r.id)===rid);cards.push(`<div class="row"><div><strong>${e(result?.testTitle||'Письмова робота №'+rid)}</strong><p>Перевірка ${e(result?.userName||'')}</p></div><button data-action="grade-result" data-id="${e(rid)}">Продовжити</button></div>`);}
 }else if(a.run)cards.push(`<div class="row"><div><strong>${e(a.run.test.title)}</strong><p>${a.run.test.mode==='exam'?'Іспит':'Тренування'} · питання ${(a.run.index||0)+1} із ${a.run.test.questions.length}</p></div><button data-action="resume">Продовжити на цьому ПК</button></div>`);
 return cards.length?`<section class="panel unfinished-work"><h2>Незавершена робота</h2>${cards.join('')}</section>`:'';
}
function restoreWorkPosition(){if(page==='editor'){const n=account().draft?.resumeQuestion||0;document.querySelectorAll('.question')[n]?.scrollIntoView({block:'center'});}else if(page==='grading'&&grading?.draft.resumeQuestion){document.querySelector(`[data-grade="${CSS.escape(grading.draft.resumeQuestion)}"]`)?.scrollIntoView({block:'center'});}}
function accountDocuments(a){
 if(instructor())return {'test-draft':a.draft??null,...Object.fromEntries(Object.entries(a.gradingDrafts||{}).map(([k,v])=>['grading:'+k,v]))};
 const r=a.run;return {training:r?.test?.mode==='training'?{test:r.test,...(r.startPermit?{startPermit:r.startPermit}:{}),answers:r.answers,index:r.index||0,submissionId:r.submissionId,exitCount:r.exitCount||0,userId:r.userId,lastElapsed:r.lastElapsed||0}:null};
}
async function applyAccountDocument(key,value,a,options={}){
 if(key==='test-draft'){a.draft=value;cloudRenderNeeded=true;}
 else if(key.startsWith('grading:')){a.gradingDrafts??={};const rid=key.slice(8);if(value===null)delete a.gradingDrafts[rid];else a.gradingDrafts[rid]=value;if(grading&&id(grading.result.id)===rid&&value){grading.draft=value;cloudRenderNeeded=true;}}
 else if(key==='training'&&a.run?.test?.mode!=='exam'){
  if(page==='runner'&&a.run&&!options.resolved)return false;
  if(value===null){a.run=null;return;}
  if(C.completed(value.test.id,a.results,a.pending,null,a.deletedTestIds)||!a.tests.some(t=>id(t.id)===id(value.test.id)))return;
  const token=S.session.token,previousRun=a.run,previousSnapshot=JSON.stringify(a.run??null),resultVersion=a.resultWriteVersion||0;
  const unchanged=()=>S.session?.token===token&&a.run===previousRun&&JSON.stringify(a.run??null)===previousSnapshot&&(a.resultWriteVersion||0)===resultVersion&&(options.resolved||page!=='runner'||!a.run)&&!C.completed(value.test.id,a.results,a.pending,null,a.deletedTestIds)&&a.tests.some(t=>id(t.id)===id(value.test.id));
  const existing=a.run&&id(a.run.test?.id)===id(value.test.id)&&a.run.submissionId===value.submissionId?a.run.startPermit:null;
  const permit=value.startPermit||existing;let test,startPermit=permit;
  if(permit){
   const reply=await rpc('POST','/api/tests/'+encodeURIComponent(value.test.id)+'/start',{submissionId:value.submissionId,startPermit:permit,resumeProtocol:1},token);
   if(!unchanged())return false;
   if(reply.trainingResumeProtocol!==1||reply.submissionId!==value.submissionId||id(reply.test?.id)!==id(value.test.id)||reply.startPermit!==permit)throw Object.assign(Error('Для продовження тренування оновіть сервер до API 21. Відповіді збережено.'),{code:'UPDATE_REQUIRED'});
   test=reply.test;startPermit=reply.startPermit;
  }else{
   test=await fetchTest(value.test.id,true);if(!unchanged())return false;
   if(test.access?.revision>0)throw Object.assign(Error('Цю роботу потрібно повторно синхронізувати з початкового ПК. Відповіді збережено.'),{code:'TRAINING_PERMIT_REQUIRED'});
  }
  if(test.mode!=='training'||!Array.isArray(test.questions)||!Array.isArray(value.test.questions))throw Error('Не вдалося підтвердити збережене тренування.');
  const questions=new Map(test.questions.map(q=>[id(q.id),q])),order=value.test.questions.map(q=>id(q.id));
  if(order.length!==questions.size||new Set(order).size!==order.length||order.some(q=>!questions.has(q)))throw Error('Питання збереженої роботи не збігаються з тестом. Відповіді збережено.');
  if(!unchanged())return false;
  a.run={...value,test:{...test,questions:order.map(q=>questions.get(q))},...(startPermit?{startPermit}:{}),startedUptime:uptime()-Math.max(0,value.lastElapsed||0)*1000,launchId:clock.launchId};cloudRenderNeeded=true;
 }
}
let examSaveTimer;
function persist(){scheduledSave=false;saving=diskWriter.save().catch(x=>{x.localSave=true;throw x;});saving.then(()=>{if(user()){accountSync.changed();if(!instructor()&&account().run?.examProtocol===1){clearTimeout(examSaveTimer);examSaveTimer=setTimeout(()=>examSession.sync().catch(()=>{}),1500);}}},x=>toast(x.message));return saving;}
async function retrySave(){if(checkpoint){const r=typeof secureStorage!=='undefined'&&secureStorage.enabled?await secureStorage.saveJournal(checkpoint):await local('/journal',checkpoint);if(r.ok===false)throw Error(r.error||'Не вдалося зберегти журнал.');journalError='';}await persist();updateStorageNotice();}

function scheduleSave(){scheduledSave=true;updateStorageNotice();clearTimeout(saveTimer);saveTimer=setTimeout(()=>persist(),100);}
function stamp(value){S.journalSerial=(S.journalSerial||0)+1;return {serial:S.journalSerial,...structuredClone(value)};}
function journal(value){if(value.kind==='draft'){const d=account().draft;if(!d||d.localId!==value.localId||d.localRevision!==value.revision)return;value={kind:'draft',userId:value.userId,localId:value.localId,revision:value.revision,draft:C.draftJournalSnapshot(d)};}if(new TextEncoder().encode(JSON.stringify(value)).length>7*1024*1024)throw Error('Журнал завеликий. Збережіть чернетку перед продовженням.');journalPending++;checkpoint=stamp(value);const snapshot=checkpoint;journalSaving=journalSaving.catch(()=>{}).then(()=>typeof secureStorage!=='undefined'&&secureStorage.enabled?secureStorage.saveJournal(snapshot):local('/journal',snapshot)).then(r=>{if(r.ok===false)throw Error(r.error||'Не вдалося зберегти дані на диску.');});journalSaving.then(()=>{journalPending--;journalError='';updateStorageNotice();},x=>{journalPending--;journalError=x.message;updateStorageNotice();toast(x.message);});}
function runCheckpoint(interrupted=false){const r=account().run;if(!r)return;const value={kind:'run',userId:id(user().id),submissionId:r.submissionId,revision:(r.localRevision||0)+1,answers:r.answers,index:r.index||0,lastElapsed:Math.floor(r.examProtocol===1?examSession.elapsed(r):Math.max(0,(uptime()-r.startedUptime)/1000)),exitCount:r.exitCount||0,interrupted};r.localRevision=value.revision;r.lastElapsed=value.lastElapsed;if(interrupted)r.interrupted=true;return value;}
async function rpc(method,path,body={},token=S.session?.token||''){
 if(updateApplying)throw Error('Застосунок оновлюється.');
 rpcFlights++;let r;try{r=await local('/rpc',C.payload(method,path,token,body));}catch(x){x.code??='NETWORK';throw x;}finally{rpcFlights--;}
 if(token&&S.session?.token!==token)throw Object.assign(Error('Обліковий запис змінився. Повторіть дію.'),{code:'SESSION_CHANGED'});
 if(!r.ok){
  const x=Object.assign(Error(r.error||'Сервер відхилив запит.'),{code:r.code||'API_ERROR'});
  if(x.code==='SESSION_EXPIRED'&&token===S.session?.token){
   S.session=null;resetSessionViews();
   try{await persist();}catch(saveError){x.message+=' '+saveError.message;}
   if(typeof secureStorage!=='undefined'&&secureStorage.enabled){
    try{await secureStorage.lock();}catch(error){await secureStorage.lock({forget:false}).catch(()=>{});x.message+=' '+error.message;}
    S.accounts={};checkpoint=null;
   }
   lastError=x.message;render();
  }
  throw x;
 }
 if(token&&typeof publicTableSync!=='undefined')publicTableSync.observe(r,token);
 return r;
}
async function getClock(){const r=await local('/clock');clock={uptime:r.uptime,launchId:r.launchId,at:performance.now()};return r;}
function uptime(){return clock?clock.uptime+performance.now()-clock.at:0;}
function status(){const a=account();return `<span class="${lastError?'':'online'}"><span class="dot"></span>${lastError?'Збережені дані':a.updatedAt?'Оновлено '+new Date(a.updatedAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}):'Підключаємося…'}</span>`;}
function notice(){return lastError?`<div class="notice warn">${e(lastError)}${user()?' Показано останні збережені дані.':''}</div>`:'';}
const stat=(label,value,sub='')=>`<div class="stat"><div class="eyebrow">${label}</div><div class="value">${e(value)}</div><small>${sub}</small></div>`;
const empty=(title,text='')=>`<div class="empty"><h3>${title}</h3><p>${text}</p></div>`;
const head=(title,text='',buttons='')=>`<div class="page-head"><div><h1>${title}</h1><p>${text}</p></div><div class="actions">${buttons}</div></div>`;
// Keep the legacy selection in Results; other sections start with their own empty filters.
function sharedFilters(scope='results'){const a=account();a.sectionFilters??={results:{groupId:a.sharedFilters?.groupId||'',testId:a.sharedFilters?.testId||''}};return a.sectionFilters[scope]??={groupId:'',testId:''};}
function selectedGroup(scope='results'){return S.groups.find(g=>id(g.id)===id(sharedFilters(scope).groupId));}
function matchesTest(t){if(!instructor())return true;const g=selectedGroup('tests'),groups=C.groupsFrom(t.description);return !g||!groups.length||groups.includes(g.name);}
function matchesResult(r){if(!instructor())return true;const f=sharedFilters(),g=selectedGroup();return (!g||r.groupName===g.name)&&(!f.testId||id(r.testId)===id(f.testId));}
function matchesMaterial(m){if(!instructor())return true;const f=sharedFilters('materials');return (!f.groupId||m.groupIds.map(id).includes(id(f.groupId)))&&(!f.testId||id(m.testId)===id(f.testId));}
function sharedTestChoices(scope='results'){
 const a=account(),f=sharedFilters(scope),all=statementTests(a.tests,a.results),search=sharedTestSearches.get(a)?.[scope]||'',query=search.trim().toLocaleLowerCase('uk-UA');
 const matches=query?all.filter(t=>[t.title,id(t.id)].join(' ').toLocaleLowerCase('uk-UA').includes(query)):all,visible=matches.slice(0,C.LIST_PAGE_SIZE),selected=all.find(t=>id(t.id)===id(f.testId));
 if(selected&&!visible.some(t=>id(t.id)===id(selected.id)))visible.unshift(selected);
 const hint=matches.length>C.LIST_PAGE_SIZE?`Показано ${C.LIST_PAGE_SIZE} із ${matches.length}. Уточніть назву або номер тесту.`:matches.length?`Знайдено тестів: ${matches.length}.`:'Тестів за цим запитом не знайдено.';
 return {search,searchable:all.length>C.LIST_PAGE_SIZE,hint,options:`<option value="">Усі тести</option>${visible.map(t=>`<option value="${e(t.id)}" ${id(f.testId)===id(t.id)?'selected':''}>${e(t.title)} · #${e(t.id)}</option>`).join('')}`};
}
function groupFilterControl(scope){const f=sharedFilters(scope);return `<label class="field group-filter">Група<select id="shared-group"><option value="">Усі групи</option>${S.groups.map(g=>`<option value="${e(g.id)}" ${id(f.groupId)===id(g.id)?'selected':''}>${e(g.name)}${g.archived?' · архів':''}</option>`).join('')}</select></label>`;}
function sharedFilterBar(scope='results'){if(!instructor())return '';const choices=sharedTestChoices(scope);return `<section class="shared-filters" aria-label="Фільтри розділу">${groupFilterControl(scope)}<div class="field shared-test-picker">${choices.searchable?`<label for="shared-test-search">Знайти тест для фільтра</label><input id="shared-test-search" aria-controls="shared-test" placeholder="Назва або номер тесту…" value="${e(choices.search)}">`:''}<label for="shared-test">Тест</label><select id="shared-test" ${choices.searchable?'aria-describedby="shared-test-matches"':''}>${choices.options}</select>${choices.searchable?`<small id="shared-test-matches" role="status">${e(choices.hint)}</small>`:''}</div><button data-action="reset-filters">Скинути фільтри</button></section>`;}
function materialFilterControls(){if(!instructor())return '';const a=account(),f=sharedFilters('materials'),count=Number(!!f.groupId)+Number(!!f.testId),group=selectedGroup('materials'),test=statementTests(a.tests,a.results).find(t=>id(t.id)===id(f.testId)),summary=[group?.name,test?.title].filter(Boolean).join(' · ');return `<div class="material-filter-toggle"><button data-action="toggle-material-filters" aria-expanded="${!!a.materialFiltersOpen}" aria-controls="material-filters">Фільтри${count?` <span class="result-tab-count">${count}</span>`:''}</button>${count?`<span class="muted">${e(summary||'Застосовано фільтри')}</span>`:''}</div><div id="material-filters" ${a.materialFiltersOpen?'':'hidden'}>${sharedFilterBar('materials')}</div>`;}
async function loadAnalytics(){
 const session=S.session;if(!session||!instructor())return false;
 const a=account(),f={...sharedFilters('analytics')},origin=page;
 if((f.groupId||f.testId)&&!a.capabilities?.filteredAnalytics)throw Error('Фільтрована аналітика стане доступною після оновлення сервера.');
 const flight={token:session.token};loadAnalytics.flight=flight;loadAnalytics.error='';analytics=null;
 const current=()=>loadAnalytics.flight===flight&&S.session?.token===session.token&&account()===a&&page===origin&&sharedFilters('analytics').groupId===f.groupId&&sharedFilters('analytics').testId===f.testId&&alive();
 if(page==='analytics')render();
 try{
  const reply=await rpc('GET','/api/instructor/analytics',{groupName:selectedGroup('analytics')?.name||'',testId:f.testId||''},session.token);
  if(!current())return false;analytics=reply;return true;
 }catch(x){if(!current())return false;loadAnalytics.error=x.message;throw x;}
 finally{if(loadAnalytics.flight===flight){loadAnalytics.flight=null;if(S.session?.token===session.token&&page==='analytics')render();}}
}
async function bulkAssignment(){
 if(!account().capabilities?.bulkAssignment)throw Error('Спочатку оновіть серверний код.');
 const session=S.session,tests=account().tests.filter(t=>!C.marker(t.description,'RETRY')),groups=S.groups.filter(g=>!g.archived);
 dialog('Масове призначення тестів',`<p>Доступ вибраних тестів буде змінено на точно вибрані групи. Питання та результати збережуться.</p><fieldset><legend>Тести</legend>${tests.map(t=>`<label class="check"><input type="checkbox" name="assignTest" value="${e(t.id)}">${e(t.title)} · #${e(t.id)}</label>`).join('')}</fieldset><fieldset><legend>Групи</legend>${groups.map(g=>`<label class="check"><input type="checkbox" name="assignGroup" value="${e(g.id)}">${e(g.name)}</label>`).join('')}</fieldset><label class="check"><input name="assignmentReviewed" type="checkbox" required>Я перевірив тести та групи; попередні призначення буде замінено</label>`,async()=>{
  if(S.session?.token!==session.token)throw Error('Обліковий запис змінився.');
  const selected=[...modal.querySelectorAll('[name=assignTest]:checked')].map(el=>tests.find(t=>id(t.id)===el.value));
  const groupIds=[...modal.querySelectorAll('[name=assignGroup]:checked')].map(el=>el.value);
  if(!selected.length||!groupIds.length)throw Error('Оберіть хоча б один тест і одну групу.');
  const r=await rpc('POST','/api/instructor/tests/assign',{tests:selected.map(t=>({testId:id(t.id),expectedDescription:t.description||''})),groupIds},session.token);
  if(r.assignedCount!==selected.length||JSON.stringify((r.assignedTestIds||[]).map(id).sort())!==JSON.stringify(selected.map(t=>id(t.id)).sort()))throw Error('Сервер не підтвердив усі призначення. Оновіть каталог.');
  await refresh(true);toast('Призначено тестів: '+r.assignedCount);
 },'Застосувати призначення');
}
function layout(content){
 const nav=instructor()?[['home','Головна'],['tests','Тести'],['materials','Матеріали'],['groups','Групи'],['cadets','Курсанти'],['results','Результати'],['bank','Банк питань']]:[['home','Головна'],['tests','Мої тести'],['materials','Матеріали'],['results','Мої результати'],['more','Профіль']];
 const u=user(),a=account(),navPage=page==='cadet-card'||page==='grading'&&grading?.origin?.page==='cadet-card'?'cadets':instructor()&&['grading','reviews'].includes(page)?'results':page;
 return `<div class="layout"><aside class="sidebar${menuOpen?' menu-open':''}"><div class="sidebar-top"><div class="brand"><img src="/icon.png" alt=""><div><strong>FPV<br>Комісія</strong><small>Версія для ПК</small></div></div><button class="menu-toggle" data-action="toggle-menu" aria-expanded="${menuOpen}" aria-controls="primary-navigation">${svg('menu')}<span>${menuOpen?'Закрити меню':'Меню'}</span></button></div><div class="sidebar-panel" id="primary-navigation"><div><div class="eyebrow" style="margin:0 12px 10px">${instructor()?'Кабінет інструктора':'Кабінет курсанта'}</div><nav class="nav" aria-label="Головне меню">${nav.map(([n,l])=>`<button data-action="nav" data-page="${n}" class="${navPage===n?'active':''}" ${navPage===n?'aria-current="page"':''}>${svg(n)}${l}${n==='results'&&instructor()?reviewCountBadge():''}</button>`).join('')}</nav></div><div class="sidebar-footer">${instructor()?`<nav class="nav nav-settings" aria-label="Налаштування"><button data-action="nav" data-page="more" class="${page==='more'?'active':''}" ${page==='more'?'aria-current="page"':''}>${svg('more')}Налаштування</button></nav>`:''}<div class="user"><div class="avatar">${e(C.nameOf(u).split(' ').map(w=>w[0]||'').slice(0,2).join(''))}</div><div class="info"><strong>${e(C.nameOf(u))}</strong>${C.titleOf(u)===C.nameOf(u)?'':'<small>'+e(C.titleOf(u))+'</small>'}</div></div><button data-action="logout" class="small">Вийти з облікового запису</button><small style="font-size:10px">Windows · ${e(C.APP_VERSION)}${C.PREVIEW_BUILD?' · Перегляд':''}</small></div></div></aside><main class="main${page==='results'&&rankingActive()?' ranking-page':''}"><header class="topbar"><small>${status()}</small><div class="top-actions">${a.pending.length?`<button data-action="sync">Черга: ${a.pending.length}</button>`:''}<button data-action="theme" aria-label="Змінити тему">${S.theme==='dark'?'☀ Світла':'◐ Темна'}</button>${syncAccountButton()}</div></header>${storageNotice(true)}${publicTableSyncNotice()}${notice()}${intakeNotice()}${content}</main></div>`;
}
function renderAuth(){
 const reg=authMode==='register';
 return `<div class="auth"><section class="auth-art"><div class="brand"><img src="/icon.png" alt=""><div><strong>FPV Комісія</strong><small>Навчання · Іспити · Результати</small></div></div><div class="statement"><div class="eyebrow">Навчальна система для Windows</div><h1 style="margin-top:18px">Навчання та іспити.<br>Усе під контролем.</h1><p>Створюйте тести, проходьте навчання й переглядайте результати зі спільного сервера.</p><div class="art">${brandArt}</div></div><small>Розробник</small></section><section class="auth-form"><div><h2>${reg?'Реєстрація':'Вхід до кабінету'}</h2><p>${reg?'Після реєстрації можна одразу розпочати роботу на ПК.':'Увійдіть за логіном і паролем свого облікового запису.'}</p><div class="tabs"><button data-action="role" data-role="instructor" class="${authRole==='instructor'?'active':''}">Інструктор</button><button data-action="role" data-role="cadet" class="${authRole==='cadet'?'active':''}">Курсант</button></div>${notice()}<form id="auth-form">${reg?'<label class="field">ПІБ<input name="fullName" required maxlength="160" autocomplete="name"></label>':''}<label class="field">Логін<input name="username" required maxlength="80" autocomplete="username" value="${e(authUsername)}"></label><label class="field">Пароль<div class="password"><input name="password" type="password" required minlength="${reg?6:1}" autocomplete="${reg?'new-password':'current-password'}"><button type="button" data-action="show-password">Показати</button></div></label>${authRole==='cadet'?`<label class="field">Навчальна група<select name="group" required>${groupOptions(authGroup,reg)}</select></label>`:reg?'<label class="field">Звання<select name="title"><option>Інструктор</option><option>Старший інструктор</option><option>Викладач</option><option>Старший викладач</option></select></label><label class="field">Код запрошення<input name="inviteCode" required autocomplete="off"><small>Отримати можливо у інших інструкторів</small></label>':''}<button class="primary" ${working?'disabled':''}>${working?'Зачекайте…':reg?'Створити обліковий запис':'Увійти'}</button>${!reg&&secureStorage.enabled?'<button type="button" data-action="unlock-local">Відкрити локальну копію без мережі</button>':''}</form><div class="auth-switch">${reg?'Уже є обліковий запис?':'Ще немає облікового запису?'} <button data-action="auth-mode">${reg?'Увійти':'Зареєструватися'}</button></div><p class="muted" style="font-size:10px;text-align:center;margin-top:28px">${secureStorage.enabled?'Вхід зберігається на цьому ПК. Щоб увійти в інший акаунт, натисніть «Вийти». Пароль не зберігається.':'Сеанс зберігається на цьому ПК. Пароль не зберігається.'}</p></div></section></div>`;
}
function home(){
 const a=account(),u=user(),latest=a.results.slice(0,5),draft=a.draft;
 const completed=C.completedTestIds(a.results,a.pending,a.run,a.examRecoveries,a.deletedTestIds),testCount=a.tests.length,available=a.tests.filter(t=>!completed.has(id(t.id))&&t.access?.open!==false).length;
 return head(instructor()?'Кабінет інструктора':'Вітаємо, '+e(C.nameOf(u).split(' ')[1]||C.nameOf(u).split(' ')[0]),instructor()?'Тести, групи й результати — в одному місці.':e(u.groupName||'Ваше навчання'))+`<section class="hero"><div><div class="eyebrow">${instructor()?'Підготовка без зайвих кроків':'Ваш навчальний простір'}</div><h2>${instructor()?'Навчання під контролем':'Готові до наступного тесту?'}</h2><p>${instructor()?'Тести, чернетки й перевірка робіт доступні з різних ПК після входу в акаунт. Дочекайтеся підтвердження синхронізації перед зміною комп’ютера.':'Тести й результати доступні на всіх ПК після входу в акаунт. Кожен тест можна пройти один раз.'}</p><button data-action="${instructor()?'new-test':'nav'}" ${instructor()?'':'data-page="tests"'}>${instructor()?'+ Створити тест':'Перейти до тестів'} →</button></div></section><div class="cards">${stat('Тести',testCount,instructor()?'Доступні у вашому кабінеті':'У вашій навчальній групі')}${stat(instructor()?'Курсанти':'Можна пройти',instructor()?a.cadets.length:available,instructor()?'У спільній системі':'Без завершених спроб')}${stat('Результати',instructor()?(a.resultTotal||a.results.length):a.results.length,'Синхронізовані проходження')}${stat(instructor()?'Групи':'У черзі',instructor()?S.groups.length:a.pending.length,instructor()?'Навчальні групи':'Очікують відправлення')}</div><div class="grid"><section class="panel"><div class="panel-heading"><h2>Останні результати</h2><button class="small" data-action="nav" data-page="results">Усі →</button></div>${latest.length?latest.map(r=>`<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:12px 0"><div><h3>${e(r.testTitle)}</h3><small>${e(instructor()?r.userName:date(r.completedAt))}</small></div><strong>${e(C.resultLabel(r))}</strong></div>`).join(''):'<p class="muted" style="font-size:12px">Результати з’являться після проходження тестів.</p>'}</section><section class="panel"><div class="panel-heading"><h2>${instructor()?'Швидкі дії':'Продовжити навчання'}</h2></div>${instructor()?`<p class="muted" style="font-size:12px;margin-bottom:20px">Робота автоматично зберігається в акаунті після підключення.</p><div class="actions"><button data-action="new-test">+ Новий тест</button><button data-action="nav" data-page="groups">Групи</button><button data-action="nav" data-page="bank">Банк питань</button></div>${draft?`<div class="notice" style="margin-top:20px;margin-bottom:0"><strong>${e(draft.title||'Незавершений тест')}</strong><br>${draft.questions.length} пит. · незавершена чернетка <button data-action="edit-draft" class="small" style="margin:10px 0 0">Продовжити →</button></div>`:''}`:a.run?`<p>Незавершений тест: ${e(a.run.test.title)}</p><button data-action="resume" style="margin-top:15px">Продовжити →</button>`:`<p class="muted" style="font-size:12px;margin-bottom:20px">Для початку тесту потрібне підключення й відкритий доступ. Розпочате тренування можна завершити без інтернету; результат надішлеться після підключення.</p><button data-action="download-all">Завантажити доступні тести</button>`}</section></div>`;
}
function learning(){
 const a=account(),units=learningUnits(a.tests,a.materials||[],a.materialProgress||{},a.results,a.pending,a.run,a.examRecoveries,a.deletedTestIds),summary=learningSummary(units),p=paginate('learning',units);
 return `<section class="learning-overview"><div class="page-head"><div><h2>Навчальний прогрес</h2><p>Матеріал → тест → перевірка відповідей</p></div><button data-action="nav" data-page="materials">Усі матеріали</button></div><div class="panel"><strong>Завершено тестів: ${summary.completed} із ${summary.total} · складено: ${summary.passed}</strong><progress max="${summary.total||1}" value="${summary.completed}" aria-label="Завершено тестів"></progress><p>Перегляд сторінок показує роботу з матеріалом. Знання перевіряє тест.</p></div>${summary.needsAttention.length?`<div class="notice warn"><strong>Що повторити</strong>${summary.needsAttention.slice(0,5).map(u=>`<p>${e(u.test.title)} · ${u.result.score}%</p>`).join('')}<p>Перегляньте матеріали та свої відповіді. Повторне проходження недоступне.</p></div>`:''}<div class="grid">${p.items.map(u=>`<article class="test-card learning-unit"><h3>${e(u.test.title)}</h3><span class="tag ${u.result?.passed?'done':''}">${e(u.status)}</span>${u.reading.map(({material:m,page})=>`<div><strong>${e(m.title)}</strong><small>Переглянуто до ${page} із ${m.pageCount} стор.</small><button class="small" data-action="material-open" data-id="${e(m.id)}">${page?'Продовжити матеріал':'Відкрити матеріал'}</button></div>`).join('')}<div class="actions">${u.result?`<button data-action="review-result" data-id="${e(u.result.id)}">Перевірка відповідей</button>`:u.active?'<button data-action="resume">Продовжити тест</button>':u.canStart?`<button class="primary" data-action="start" data-id="${e(u.test.id)}">До тесту</button>`:''}</div></article>`).join('')||empty('Навчальний план порожній','Тести з’являться після призначення інструктором.')}</div>${p.controls}</section>`;
}
function catalogTestState(t){
 if(!t.published)return {label:'Чернетка',kind:'draft',note:''};
 const access=t.access||{},rules=access.groups||{},fallback=typeof access.defaultOpen==='boolean'?access.defaultOpen:access.open!==false,group=selectedGroup('tests');
 const isOpen=g=>Object.hasOwn(rules,id(g.id))?rules[id(g.id)]===true:fallback;
 if(group)return {label:isOpen(group)?'Відкритий':'Закритий',kind:isOpen(group)?'open':'closed',note:'Для групи «'+group.name+'»'};
 const assigned=C.groupsFrom(t.description),groups=S.groups.filter(g=>!g.archived&&(!assigned.length||assigned.includes(g.name)));
 const values=groups.length?groups.map(isOpen):assigned.length?[]:[fallback,...Object.values(rules).filter(v=>typeof v==='boolean')],open=values.some(Boolean),mixed=open&&values.some(v=>!v);
 return {label:open?'Відкритий':'Закритий',kind:open?'open':'closed',note:mixed?'Для частини груп':''};
}
function testCard(t,a,completed){
 const done=completed.has(id(t.id)),running=id(a.run?.test.id)===id(t.id),offline=!!a.fullTests[id(t.id)],closed=t.access?.open===false;
 const catalog=instructor()?catalogTestState(t):null;
 const label=instructor()?catalog.label:running?'Незавершений':a.deletedTestIds?.includes(id(t.id))?'Спробу використано':done?'Пройдено / у черзі':closed?'Очікує відкриття інструктором':offline?'Завантажено на ПК':'Готовий до проходження';
 return `<article class="test-card"><div class="meta"><span class="tag ${t.mode==='exam'?'exam':''}">${t.mode==='exam'?'ІСПИТ':'ТРЕНУВАННЯ'}</span><small>${t.questionCount??t.questions?.length??0} пит. ${t.mode==='exam'?'· '+t.durationMinutes+' хв':''}</small></div><div><h3>${e(t.title)}</h3><p style="margin-top:8px">${e(C.cleanDescription(t.description))||'Без опису'}</p></div><div class="meta"><small>Прохідний бал ${t.passingPercent}%</small><span class="tag ${catalog?'test-state test-state-'+catalog.kind:done?'done':''}" ${catalog?.note?'title="'+e(catalog.note)+'"':''}>${e(label)}</span>${catalog?.note?'<small class="test-access-note">'+e(catalog.note)+'</small>':''}</div>${!instructor()&&!done&&!running&&t.access?'<small class="muted">Для початку потрібне підключення. Розпочате тренування можна завершити без інтернету.</small>':''}<div class="actions">${instructor()?`<button data-action="test-access" data-id="${e(t.id)}" ${a.capabilities?.testAccess?'':'disabled'}>Керувати доступом</button><button data-action="preview" data-id="${e(t.id)}">Перегляд</button><button data-action="edit-test" data-id="${e(t.id)}">Редагувати</button><button class="icon danger" data-action="delete-test" data-id="${e(t.id)}" aria-label="Видалити тест">×</button>`:`<button class="primary" data-action="${running?'resume':'start'}" data-id="${e(t.id)}" ${(done||closed)&&!running?'disabled':''}>${running?'Продовжити':closed?'Тест закрито':'Почати тест →'}</button>${!done&&!closed?`<button class="small" data-action="download" data-id="${e(t.id)}">${offline?'↻ Оновити на ПК':'↓ Завантажити'}</button>`:''}`}</div></article>`;
}
function testsList(){const a=account(),q=filter.toLowerCase(),p=paginate('tests',a.tests.filter(t=>matchesTest(t)&&t.title.toLowerCase().includes(q))),done=C.completedTestIds(a.results,a.pending,a.run,a.examRecoveries,a.deletedTestIds);return `<div class="grid">${p.items.map(t=>testCard(t,a,done)).join('')||empty('Тестів не знайдено','Створіть тест або змініть пошук.')}</div>${p.controls}`;}
function tests(){return head(instructor()?'Тести':'Мої тести',instructor()?'Єдиний каталог тестів для всіх ПК комісії.':'Одна спроба для кожного тесту на всіх ПК.',instructor()?'<button data-action="bulk-assign">Призначити групам</button><button data-action="import">Імпортувати файл</button><button class="primary" data-action="new-test">+ Створити тест</button>':'<button data-action="download-all">↓ Завантажити доступні</button>')+`<div class="toolbar list-filters">${instructor()?groupFilterControl('tests'):''}<label class="field">Назва тесту<input id="filter" placeholder="Знайти тест…" value="${e(filter)}" aria-label="Знайти тест"></label>${instructor()?'<button data-action="reset-filters">Скинути</button>':''}</div><div id="test-list">${testsList()}</div>`;}
function resultsView(){return instructor()&&['pending','ranking'].includes(account().resultsView)?account().resultsView:'compact';}
function rankingActive(){return instructor()&&resultsView()==='ranking';}
function pendingReviewsActive(){return instructor()&&resultsView()==='pending';}
function pendingReviewsPage(){return page==='results'&&pendingReviewsActive();}
function matchesResultQuery(r){return matchesResult(r)&&[r.userName,r.groupName,r.testTitle].join(' ').toLocaleLowerCase('uk-UA').includes(filter.trim().toLocaleLowerCase('uk-UA'));}
function filteredResults(){return account().results.filter(matchesResultQuery);}
function groupRanking(){const group=selectedGroup();return group?searchRanking(buildRanking(account(),group.name),filter):null;}
function pendingReviewBadge(){const known=reviewQueueToken===S.session?.token,count=reviewQueue.filter(matchesResult).length+examRecoveryQueue.filter(matchesResult).length;return `<span id="pending-review-count" class="result-tab-count" title="Робіт у вибраній групі та тесті">${known?count:'…'}</span>`;}
function resultsTabs(){const selected=resultsView();return `<div class="results-switch" role="tablist" aria-label="Результати та перевірка">${[['compact','Усі результати'],['pending','Очікують перевірки'],['ranking','Рейтинг']].map(([view,label])=>`<button id="results-tab-${view}" role="tab" type="button" data-action="results-view" data-view="${view}" aria-selected="${selected===view}" aria-controls="results-panel" tabindex="${selected===view?0:-1}" class="${selected===view?'selected':''}">${label}${view==='pending'?pendingReviewBadge():''}</button>`).join('')}</div>`;}
function resultsTable(){
 const a=account();
 if(pendingReviewsActive())return reviewQueueContent();
 if(rankingActive()){
  const ranking=groupRanking();
  if(!ranking)return empty('Оберіть групу для рейтингу','Тести будуть розташовані в окремих колонках.');
  if(a.resultTotal>a.results.length)return empty('Потрібна повна історія результатів','Натисніть «Оновити» та дочекайтеся завантаження всіх результатів.');
  const p=paginate('ranking',ranking.rows);
  return p.items.length?rankingTable({...ranking,rows:p.items})+`<p class="search-note">${e(ranking.groupName)} · Однакова сума — однакове місце. Натисніть результат тесту, щоб відкрити роботу.</p>`+p.controls:empty('Курсантів не знайдено','Змініть пошук або оберіть іншу групу.');
 }
 const rows=filteredResults(),p=paginate('results',rows),f=instructor()?sharedFilters():{};
 return p.items.length?compactResults(p.items,{instructor:instructor(),allowDelete:a.capabilities?.resultDeletion===true,groupSelected:!!selectedGroup(),testSelected:!!f.testId,formatTime:time,formatDate:date})+`<p class="search-note">Результатів: ${rows.length}. Натисніть ${instructor()?'ПІБ':'назву тесту'}, щоб відкрити роботу. Правильні та помилки — лише запитання з варіантами відповідей.</p>`+p.controls:empty('Результатів не знайдено','Спробуйте інший пошук або оновіть дані.');
}
function rankingControls(){
 const f=sharedFilters();
 return `<div class="ranking-controls" aria-label="Фільтри рейтингу"><label class="field">Навчальна група<select id="shared-group"><option value="">Оберіть групу</option>${S.groups.map(g=>`<option value="${e(g.id)}" ${id(f.groupId)===id(g.id)?'selected':''}>${e(g.name)}${g.archived?' · архів':''}</option>`).join('')}</select></label><label class="field">Знайти курсанта<input id="filter" placeholder="ПІБ або логін…" value="${e(filter)}" aria-label="Пошук результатів"></label><button data-action="reset-filters">Скинути</button></div>`;
}
function results(){
 const a=account(),ranking=rankingActive(),pending=pendingReviewsActive();
 const actions=pending?'':excelReportButton()+(instructor()&&!ranking?'<button class="primary" data-action="group-statement">Відомість групи PDF</button>':'')+`<button data-action="${ranking?'export-ranking':'export-csv'}">↓ ${ranking?'Рейтинг':'CSV'} для Excel</button>`;
 const controls=ranking?rankingControls():(instructor()?sharedFilterBar():'')+`<div class="toolbar"><input id="filter" placeholder="ПІБ, група або назва тесту…" value="${e(filter)}" aria-label="Пошук результатів"></div>`;
 const incomplete=instructor()&&!pending&&a.resultTotal>a.results.length?'<div class="notice">Показано останні результати. Натисніть «Оновити», щоб завантажити повний список для рейтингу.</div>':'';
 const queue=!ranking&&!pending&&a.pending.length?`<div class="notice"><strong>Очікують відправлення: ${a.pending.length}</strong>${a.pending.map(p=>`<p style="margin-top:7px">${e(p.testTitle)} · ${p.failure?e(p.failure):'Результат збережено на ПК'} ${p.permanent?'':'<button data-action="sync" class="small">Повторити зараз</button>'}</p>`).join('')}</div>`:'';
 return head(instructor()?'Результати та перевірка':'Мої результати',instructor()?'Результати, перевірка письмових робіт і рейтинг групи.':'Результати зберігаються у спільній базі комісії.',actions)+(instructor()?resultsTabs():'')+`<section id="results-panel"${instructor()?` role="tabpanel" aria-labelledby="results-tab-${resultsView()}"`:''}>${controls}${incomplete}${!ranking&&!pending?examRecoveryNotices():''}${queue}<div id="results-table">${resultsTable()}</div></section>`;
}

function groups(){const counts=new Map();for(const u of account().cadets)counts.set(u.groupName,(counts.get(u.groupName)||0)+1);const show=account().showArchived===true,items=S.groups.filter(g=>!!g.archived===show),p=paginate('groups',items);return head('Навчальні групи','Архів зберігає облікові записи та всі результати.','<button data-action="toggle-archive">'+(show?'Активні групи':'Архів груп')+'</button><button class="primary" data-action="add-group">+ Створити групу</button>')+(items.length?`<div class="grid">${p.items.map(g=>`<section class="panel"><div class="panel-heading"><h2>${e(g.name)}</h2><span class="tag">${g.archived?'Архів':'Активна'}</span></div><p class="muted">${counts.get(g.name)||0} курсантів</p><div class="actions"><button data-action="archive-group" data-id="${e(g.id)}" ${account().capabilities?.groupArchive?'':'disabled'}>${g.archived?'Повернути з архіву':'До архіву'}</button><button class="small danger" data-action="delete-group" data-id="${e(g.id)}">Видалити</button></div></section>`).join('')}</div>${p.controls}`:empty(show?'Архів порожній':'Активних груп поки немає','Створіть нову групу або відкрийте архів.'))+(!account().capabilities?.groupArchive?'<div class="notice">Архівування потребує оновлення серверного коду.</div>':'');}

function cadets(){const p=paginate('cadets',account().cadets.filter(u=>(!selectedGroup('cadets')||u.groupName===selectedGroup('cadets').name)&&[u.fullName,u.username,u.groupName].join(' ').toLowerCase().includes(filter.toLowerCase())));return head('Курсанти','Облікові записи курсантів і навчальні групи.','<button data-action="new-intake" '+(account().capabilities?.newIntake?'':'disabled')+'>Підготувати новий набір</button><button class="primary" data-action="add-cadet">+ Додати курсанта</button>')+`<div class="toolbar list-filters">${groupFilterControl('cadets')}<label class="field">ПІБ або логін<input id="filter" aria-label="Пошук курсантів" placeholder="ПІБ, логін або група…" value="${e(filter)}"></label><button data-action="reset-filters">Скинути</button></div><div class="table-wrap" tabindex="0" role="region" aria-label="Таблиця з горизонтальним прокручуванням"><table><thead><tr><th>ПІБ</th><th>ЛОГІН</th><th>ГРУПА</th><th>СТАТУС</th><th></th></tr></thead><tbody>${p.items.map(u=>`<tr><td><button class="cadet-name" data-action="cadet-card" data-id="${e(u.id)}">${e(u.fullName)}</button></td><td>${e(u.username)}</td><td>${e(u.groupName)}</td><td>${u.active?'Активний':'Вимкнено'}</td><td class="actions-cell"><div class="actions"><button class="small" data-action="cadet-status" data-id="${e(u.id)}" data-active="${u.active?'false':'true'}">${u.active?'Вимкнути':'Увімкнути'}</button><button class="small" data-action="cadet-group" data-id="${e(u.id)}">Змінити групу</button><button class="small" data-action="cadet-password" data-id="${e(u.id)}">Новий пароль</button><button class="small danger" data-action="delete-cadet" data-id="${e(u.id)}">Видалити повністю</button></div></td></tr>`).join('')}</tbody></table></div>${p.controls}`;}
function editor(){const d=account().draft;if(!d)return empty('Чернетка відсутня');return head(d.replacesId?'Редагування тесту':'Новий тест','Автозбереження на ПК та синхронізація з акаунтом.','<button data-action="nav" data-page="tests">← До тестів</button>')+`${officeReview(d)}<div class="editor-layout editor"><div><section class="panel" style="margin-bottom:20px"><label class="field">Назва тесту<input data-draft="title" value="${e(d.title)}" maxlength="180" placeholder="Наприклад, Метеорологія: основи"></label><label class="field" style="margin-bottom:0">Опис<textarea data-draft="description" maxlength="2000">${e(d.description)}</textarea></label></section><div id="questions">${d.questions.map((q,i)=>`<section class="panel question" data-import-card="${i}"><p class="import-error" data-import-error="${i}" ${d.importSource&&importQuestionError(q)?'':'hidden'}>${d.importSource?e(importQuestionError(q)):''}</p><div class="question-head"><h2>Питання ${i+1}</h2><div class="actions"><button class="small" data-action="move-question" data-direction="-1" data-q="${i}" ${i===0?'disabled':''} aria-label="Перемістити вище">↑</button><button class="small" data-action="move-question" data-direction="1" data-q="${i}" ${i===d.questions.length-1?'disabled':''} aria-label="Перемістити нижче">↓</button><button class="small" data-action="bank-save" data-q="${i}">До банку</button><button class="small" data-action="copy-question" data-q="${i}">Копія</button><button class="small danger" data-action="delete-question" data-q="${i}">Видалити</button></div></div><label class="field">Тип питання<select data-question-type="${i}"><option value="choice" ${!C.isWritten(q)?'selected':''}>Вибір відповіді</option><option value="written" ${C.isWritten(q)?'selected':''}>Письмова відповідь</option></select></label><label class="field">Максимум балів<input type="number" min="1" max="100" step="1" data-question="${i}" data-prop="maxPoints" value="${e(q.maxPoints??1)}"></label><label class="field">Текст питання<textarea data-question="${i}" data-prop="text" maxlength="1000">${e(q.text)}</textarea></label>${C.isWritten(q)?`<label class="field">Зразок відповіді / критерії для викладача<textarea data-question="${i}" data-prop="rubric" maxlength="2000">${e(q.rubric??'')}</textarea></label><p>Письмову відповідь перевіряє викладач.</p>`:`<p class="muted" style="font-size:11px;margin-bottom:12px">Позначте одну або дві правильні відповіді.</p>${q.answers.map((a,j)=>`<div class="answer-edit"><input type="checkbox" name="correct-${i}" data-correct="${i}" data-a="${j}" ${a.isCorrect?'checked':''} aria-label="Відповідь ${j+1} правильна"><input type="text" data-answer="${i}" data-a="${j}" value="${e(a.text)}" maxlength="500" placeholder="Варіант відповіді ${j+1}"><button class="icon danger" data-action="delete-answer" data-q="${i}" data-a="${j}" aria-label="Видалити відповідь">×</button></div>`).join('')}<button class="small" data-action="add-answer" data-q="${i}" ${q.answers.length>=6?'disabled':''}>+ Відповідь</button>`}<label class="field" style="margin-top:18px;margin-bottom:0">Пояснення після тесту<textarea data-question="${i}" data-prop="explanation" maxlength="2000" style="min-height:60px">${e(q.explanation??'')}</textarea></label></section>`).join('')}</div><div class="actions"><button data-action="add-question">+ Додати питання</button><button data-action="import">Імпортувати файл</button><button data-action="nav" data-page="bank">Із банку питань</button></div></div><aside class="panel editor-aside"><h2>Налаштування</h2><label class="field" style="margin-top:22px">Режим<select data-draft="mode"><option value="training" ${d.mode==='training'?'selected':''}>Тренування</option><option value="exam" ${d.mode==='exam'?'selected':''}>Іспит</option></select></label><label class="field">Тривалість іспиту, хв<input type="number" data-draft="durationMinutes" min="1" max="600" value="${e(d.durationMinutes)}" ${d.mode==='exam'?'':'disabled'}></label><label class="field">Прохідний бал, %<input type="number" data-draft="passingPercent" min="1" max="100" value="${e(d.passingPercent)}"></label><div class="editor-options"><label class="check"><input type="checkbox" data-draft="randomizeQuestions" ${d.randomizeQuestions?'checked':''}>Перемішувати питання</label><label class="check"><input type="checkbox" data-draft="randomizeAnswers" ${d.randomizeAnswers?'checked':''}>Перемішувати відповіді</label></div><h3>Доступ для груп</h3><p style="margin:8px 0">${Array.isArray(d.assignedGroups)?'Без вибору — для всіх груп.':'Не вдалося відновити групи. Повторно оберіть доступ перед збереженням.'}</p><div class="editor-options">${S.groups.map(g=>`<label class="check"><input type="checkbox" data-group="${e(g.name)}" ${(Array.isArray(d.assignedGroups)?d.assignedGroups:[]).includes(g.name)?'checked':''}>${e(g.name)}</label>`).join('')}</div><div class="actions"><button class="primary" data-action="publish-test" ${working||(d.importSource&&C.validateDraft(d))?'disabled':''}>${working?'Зберігаємо…':'Опублікувати'}</button><button data-action="cloud-draft" ${working||(d.importSource&&C.validateDraft(d))?'disabled':''}>У хмарні чернетки</button><button class="small" data-action="export-test">↓ JSON</button><button class="small danger" data-action="discard-draft">Видалити чернетку</button></div><p class="draft-status" style="margin-top:18px">${d.questions.length} пит. · автозбереження ввімкнено</p>${d.replacesId?'<p style="margin-top:16px">Редагування створить оновлену версію тесту. Старі результати зберігаються.</p>':''}</aside></div>`;}
function previewScreen(){return head(e(preview.title),'Перегляд тесту для інструктора.','<button data-action="nav" data-page="tests">← До тестів</button>')+preview.questions.map((q,i)=>`<section class="panel" style="margin-bottom:15px"><h3>${i+1}. ${e(q.text)}</h3><div style="margin-top:17px">${C.isWritten(q)?`<p>Письмова відповідь · максимум ${q.maxPoints??1} балів</p><p class="preserve-text">${e(q.rubric??'')}</p>`:q.answers.map(a=>`<p style="font-size:13px;padding:7px 0">${a.isCorrect?'✓':'○'} ${e(a.text)}</p>`).join('')}</div>${q.explanation?`<p class="muted" style="margin-top:12px;font-size:12px">${e(q.explanation)}</p>`:''}</section>`).join('');}
function runner(){const r=account().run;if(!r)return '';const q=r.test.questions[r.index||0],answered=r.test.questions.filter(q=>C.answered(q,r.answers)).length;return `<div class="runner">${r.examProtocol===1?examNotice():r.test.mode==='exam'?'<div class="notice warn">Збережена робота з попередньої версії. Після завершення її підтвердить інструктор.</div>':storageNotice()}<div class="runner-top"><div><div class="eyebrow">${r.test.mode==='exam'?'Іспит':'Тренування'}</div><h2 style="margin-top:8px">${e(r.test.title)}</h2><small>${e(C.nameOf(user()))} · ${e(user().groupName)}</small></div><div style="text-align:right"><div class="timer" id="timer">—</div><small>${r.test.mode==='exam'?'Залишилося часу':'Час проходження'}</small></div></div><div class="progress"><span style="width:${answered/r.test.questions.length*100}%"></span></div><div class="question-nav">${r.test.questions.map((q,i)=>`<button data-action="question" data-q="${i}" class="${C.answered(q,r.answers)?'answered':''} ${i===(r.index||0)?'current':''}">${i+1}${C.answered(q,r.answers)?' ✓':''}</button>`).join('')}</div><div class="panel"><div class="row" style="justify-content:space-between"><small>Питання ${(r.index||0)+1} із ${r.test.questions.length}</small><small>Відповіли: ${answered}</small></div><div class="question-text">${e(q.text)}</div><fieldset class="run-answers" ${r.examProtocol===1&&!examSession.editable(r)?'disabled':''}>${C.isWritten(q)?`<label class="field">Ваша відповідь<textarea data-run-written="${e(q.id)}" maxlength="3000" rows="8">${e(r.answers[id(q.id)]??'')}</textarea><small>До 3000 символів · зберігається автоматично · максимум ${q.maxPoints??1} балів</small></label>`:`<p class="muted">Оберіть одну або дві відповіді. Бал нараховується лише за повний збіг правильних варіантів.</p>`+q.answers.map(a=>`<label class="answer ${C.choiceIds(q,r.answers[id(q.id)]).includes(id(a.id))?'chosen':''}"><input type="checkbox" name="answer" data-run-answer="${e(a.id)}" ${C.choiceIds(q,r.answers[id(q.id)]).includes(id(a.id))?'checked':''}><span>${e(a.text)}</span></label>`).join('')}</fieldset><div class="runner-bottom"><button data-action="prev" ${(r.index||0)===0?'disabled':''}>← Назад</button><button data-action="unanswered">До пропущеного</button><button data-action="next" ${(r.index||0)===r.test.questions.length-1?'disabled':''}>Далі →</button></div></div><div class="runner-bottom"><small class="muted">${r.test.mode==='exam'?'Перехід до іншого вікна фіксується. Час іспиту продовжує спливати.':'Відповіді синхронізуються з акаунтом.'}</small><div class="actions">${r.examProtocol===1?`<button data-action="handoff-exam" ${!examSession.editable(r)?'disabled':''}>Зберегти й перейти на інший ПК</button>`:''}<button class="primary" data-action="finish" ${r.examProtocol===1&&!examSession.editable(r)?'disabled':''}>Завершити тест</button></div></div></div>`;}
function resultScreen(){const r=lastResult?.result;return `<section class="panel result-card">${publicTableSyncNotice()}<div class="eyebrow">${r?'Тест завершено':lastResult?.recovery?'Роботу передано інструктору':'Результат збережено на ПК'}</div><h2 style="margin-top:12px">${e(r?.testTitle||lastResult?.testTitle||'Тест')}</h2>${r?`${C.pendingReview(r)?`<h3 class="grading-pending">Очікує перевірки викладачем</h3><p>Письмових без оцінки: ${r.pendingWritten}. Остаточний результат з’явиться після перевірки.</p>`:`<div class="score">${r.score}<small>%</small></div><span class="tag ${r.passed?'':'exam'}">${r.passed?'СКЛАДЕНО':'НЕ СКЛАДЕНО'}</span>`}<div class="cards">${stat('Правильних з вибором',r.correct)}${r.total>C.choiceCount(r)?stat('Бали',r.earnedPoints+'/'+r.maxPoints):''}${stat('Неправильних з вибором',C.choiceCount(r)-r.correct)}${stat('Час',time(r.durationSeconds))}</div><p class="muted" style="font-size:12px">Результат прийнято сервером комісії.</p>${r.examRecovered?`<p class="notice">Збережену роботу підтвердив інструктор: ${e(r.recoveredBy)}. Час не перевірено серверним таймером.</p>`:''}`:lastResult?.recovery?'<p>Відповіді збережено на сервері. Робота очікує підтвердження інструктора, оскільки її час не перевіряв серверний таймер.</p>':'<p class="muted" style="margin-top:25px">Результат у черзі. Програма відправить його після відновлення інтернету та покаже оцінку, яку обчислить сервер.</p>'}<div class="actions"><button class="primary" data-action="nav" data-page="results">До результатів</button><button data-action="nav" data-page="tests">До тестів</button></div>${C.enrichReview(lastResult?.review,account().fullTests[id(lastResult?.testId)]).map(q=>C.isWritten(q)?writtenReview(q):choiceReview(q)).join('')}</section>`;}
function more(){const a=account();return head(instructor()?'Налаштування':'Профіль','Налаштування та додаткові можливості.')+(instructor()?instructorsPanel():'')+`<div class="settings-grid"><section class="panel"><h2>${e(C.nameOf(user()))}</h2><p>${C.titleOf(user())===C.nameOf(user())?'':e(C.titleOf(user()))+'<br>'}Логін: ${e(user().username)}</p><div class="actions"><button data-action="theme">${S.theme==='dark'?'Світла':'Темна'} тема</button><button data-action="logout">Вийти</button></div></section>${instructor()?'<section class="panel"><h2>Таблиця результатів</h2><p>Спільна таблиця результатів усіх навчальних груп.</p><div class="actions"><button data-action="open-sheet">Відкрити таблицю</button><button data-action="sync-sheet">Оновити таблицю</button></div></section><section class="panel"><h2>Архіви наборів</h2><p>Книги Excel зі збереженими результатами попередніх наборів.</p><button data-action="intake-archives">Відкрити архіви</button></section><section class="panel"><h2>Доступ інструкторів</h2><p>Новий інструктор реєструється за кодом від головного інструктора.</p><button data-action="invite">Код запрошення</button></section><section class="panel"><h2>Аналітика та журнал</h2><p>Статистика навчання й дії інструкторів зі спільного сервера.</p><div class="actions"><button data-action="analytics">Аналітика</button><button data-action="audit">Журнал дій</button></div></section>':`<section class="panel"><h2>Робота без інтернету</h2><p>Для початку потрібні підключення й дозвіл інструктора. Розпочате тренування можна завершити офлайн. Очікують відправлення: ${a.pending.length}.</p><button data-action="download-all">Завантажити тести</button><button data-action="sync">Надіслати чергу</button></section>`}<section class="panel"><h2>Оновлення</h2><p id="update-message">${e(updateInfo.message)}</p><button data-action="check-update">Перевірити оновлення</button></section><section class="panel"><h2>Про застосунок</h2><p>FPV Комісія для Windows · версія ${e(C.APP_VERSION)}<br>Тести, навчальні матеріали та спільні результати для роботи на ПК.</p><div class="about-credit">Розробник</div></section></div>`;}
function bankScreen(){const p=paginate('bank',bank);return head('Банк питань','Банк питань комісії: зберігайте питання з редактора та додавайте їх до тестів.','<button data-action="edit-draft">До редактора →</button>')+(bank.length?`<div class="grid">${p.items.map(q=>`<article class="test-card"><div class="meta"><span class="tag">${e(q.category)}</span><small>${e(q.createdByName||q.authorName||q.author||'')}</small></div><h3>${e(q.question.text)}</h3><div class="actions"><button data-action="bank-add" data-id="${e(q.id)}">+ До чернетки</button></div></article>`).join('')}</div>${p.controls}`:empty('Банк порожній','Створіть питання в редакторі тесту та натисніть «До банку».'));}
function analyticsScreen(){const a=analytics||{},header=head('Аналітика','Дані спільного сервера.','<button data-action="nav" data-page="more">← Назад</button>')+sharedFilterBar('analytics');if(!analytics)return header+`<div class="notice${loadAnalytics.error?' warn':''}" role="status">${e(loadAnalytics.flight?'Завантажуємо аналітику…':loadAnalytics.error||'Оновіть дані, щоб завантажити аналітику.')}</div>`;return header+`<div class="cards">${stat('Проходжень',a.attempts??0)}${stat('Середній бал',String(a.average??0)+'%')}${stat('Склали',String(a.passRate??0)+'%')}${stat('Груп',a.groups?.length??0)}</div><div class="table-wrap" tabindex="0" role="region" aria-label="Таблиця з горизонтальним прокручуванням"><table><thead><tr><th>ГРУПА</th><th>ПРОХОДЖЕНЬ</th><th>СЕРЕДНІЙ БАЛ</th><th>СКЛАЛИ</th></tr></thead><tbody>${(a.groups??[]).map(g=>`<tr><td>${e(g.name)}</td><td>${g.attempts??0}</td><td>${g.average??0}%</td><td>${g.passed??0}</td></tr>`).join('')}</tbody></table></div><section class="panel" style="margin-top:20px"><h2>Питання, які варто повторити з групою</h2><p>Відсоток помилок за надісланими відповідями. Ураховано вибрану групу й тест.</p>${(a.hardestQuestions||[]).map(q=>`<div class="question-stat"><strong>${e(q.text)}</strong><small>${e(q.testTitle)} · #${e(q.testId)}</small><p>Помилок: ${q.attempts-q.correct} із ${q.attempts} · ${100-q.percent}%</p><progress max="100" value="${100-q.percent}" aria-label="Відсоток помилок"></progress></div>`).join('')||'<p>Ще немає детальних відповідей для цього вибору.</p>'}</section>`;}
function auditScreen(){const p=paginate('audit',audit);return head('Журнал дій','Історія змін, зроблених інструкторами.','<button data-action="nav" data-page="more">← Назад</button>')+`<div class="table-wrap" tabindex="0" role="region" aria-label="Таблиця з горизонтальним прокручуванням"><table><thead><tr><th>ДАТА</th><th>ІНСТРУКТОР</th><th>ДІЯ</th><th>ОБ’ЄКТ</th><th>ДЕТАЛІ</th></tr></thead><tbody>${p.items.map(r=>`<tr><td>${date(r.createdAt)}</td><td>${e(r.instructorName||r.actorName)}</td><td>${e(r.action)}</td><td>${e(r.targetName)}</td><td>${e(r.details)}</td></tr>`).join('')}</tbody></table></div>${p.controls}`;}
let renderedPage='';
function render(){if(!alive()||updateApplying)return;const active=document.activeElement,tabFocus=page===renderedPage&&active?.matches('.results-switch [role=tab]')?active.id:'',keep=page===renderedPage&&['filter','material-search','cadet-note'].includes(active?.id)&&!(active?.id==='cadet-note'&&cadetCard.saving)?{el:active,start:active.selectionStart,end:active.selectionEnd}:null;if(keep&&active.id==='filter')filter=active.value;document.body.classList.toggle('dark',S.theme==='dark');if(!user()){app.innerHTML=renderAuth();return;}if(page==='runner'){app.innerHTML=runner();tick();return;}if(page==='result'){app.innerHTML=resultScreen();return;}const fn={home:()=>unfinishedWork()+home()+(!instructor()?learning():''),tests,results,groups,cadets,'cadet-card':cadetCard.html,editor,preview:previewScreen,reviews:results,grading:gradingScreen,more,bank:bankScreen,analytics:analyticsScreen,audit:auditScreen,materials:materials.html}[page]||home;app.innerHTML=layout(fn());renderedPage=page;if(tabFocus)document.getElementById(tabFocus)?.focus({preventScroll:true});if(keep){const field=document.getElementById(keep.el.id);if(field){field.replaceWith(keep.el);keep.el.focus({preventScroll:true});keep.el.setSelectionRange(keep.start,keep.end);}}}
async function refresh(force=false){
 if(updateApplying||!user()||page==='runner')return;
 // The token identifies the owner of the in-flight workspace request.
 if(refreshing===S.session.token){refreshQueued=true;forceQueued=forceQueued||force;return;}
 if(refreshing){refreshQueued=false;forceQueued=false;}
 const session=S.session,a=account(),resultWriteVersion=a.resultWriteVersion||0;let completion=refresh.completion;if(completion?.token!==session.token){let resolve;const promise=new Promise(done=>resolve=done);completion={token:session.token,promise,resolve};refresh.completion=completion;}const finish=()=>{completion.resolve();if(refresh.completion===completion)refresh.completion=null;};refreshing=session.token;if(force)render();
 try{
  let response=null,request;
  if(force||Date.now()>=workspaceUnavailableUntil){
   request=workspaceRequest(a,instructor()&&page==='results',force);
   try{response=readWorkspace(await rpc('GET','/api/workspace',request,session.token),session);workspaceUnavailableUntil=0;}
   catch(x){if(x.code!=='NOT_FOUND')throw x;workspaceUnavailableUntil=Date.now()+300000;}
  }
  if(S.session?.token!==session.token)return;
  if(response){
   const oldRevisions=a.workspaceRevisions,oldFull=a.workspaceFullAt,oldResultsRevision=a.fullResultsRevision,c=response.changes;
   const resultSnapshotCurrent=(a.resultWriteVersion||0)===resultWriteVersion;
   const oldUser=JSON.stringify(S.session.user);S.session.user=response.user;
   if(c.groups)S.groups=c.groups;if(c.tests){if(a.testCacheRevision!==response.revisions.tests){a.fullTests={};a.testCacheRevision=response.revisions.tests;}a.tests=c.tests;}
   if(c.cadets){
    if(!resultSnapshotCurrent)refreshQueued=true;
    else{
     if(instructor()&&response.snapshotStable){
      const present=new Set(c.cadets.map(cadet=>id(cadet.id)));
      const removed=new Set(a.cadets.map(cadet=>id(cadet.id)).filter(cadetId=>!present.has(cadetId)));
      if(removed.size)forgetCadetResults(a,removed);
     }
     a.cadets=c.cadets;
    }
   }
   if(c.results){
    if(instructor()&&!resultSnapshotCurrent)refreshQueued=true;
    else if(instructor()){
     const base=response.revisions.results.replace(/:(all|recent)$/,'');
     if(response.resultScope==='all'){a.results=c.results;a.fullResultsRevision=base;}
     else if(a.fullResultsRevision!==base){a.results=c.results;delete a.fullResultsRevision;}
    }else if((a.resultWriteVersion||0)===resultWriteVersion&&response.snapshotStable===true)a.results=c.results;
    else{a.results=C.mergeResults(a.results,c.results);refreshQueued=true;}
   }
   if(Array.isArray(response.examRecoveries))a.examRecoveries=response.examRecoveries;
   if(response.resultTotal!==undefined&&resultSnapshotCurrent)a.resultTotal=response.resultTotal;
   if(response.resultsSheetUrl)a.resultsSheetUrl=response.resultsSheetUrl;
   const intakeChanged=JSON.stringify(a.intake||null)!==JSON.stringify(response.intake||null),generationChanged=typeof response.intakeGeneration==='string'&&clearOldIntakeState(response.intakeGeneration);if(instructor())a.intake=response.intake||null;a.capabilities=response.capabilities||{};a.updatedAt=Date.now();lastError='';
   if(response.deletedResults&&resultSnapshotCurrent){
    for(const item of response.deletedResults)forgetResultDetails(a,item.id);
    if(!instructor())a.deletedTestIds=[...new Set(response.deletedResults.map(item=>item.testId))];
    if(grading&&response.deletedResults.some(item=>item.id===id(grading.result.id))){
     void reviewPresence.stop(grading.result.id);
     grading=null;
     if(page==='grading')page='results';
    }
   }
   if(response.snapshotStable===true){a.workspaceRevisions=response.revisions;if(!Object.keys(request.known).length)a.workspaceFullAt=Date.now();}
   if(Object.keys(c).length||response.examRecoveries||intakeChanged||generationChanged||JSON.stringify(response.user)!==oldUser){
    try{await persist();}catch(x){a.workspaceRevisions=oldRevisions;a.workspaceFullAt=oldFull;a.fullResultsRevision=oldResultsRevision;throw x;}
   }
  }else{
   const groups=(await rpc('GET','/api/groups',{},session.token)).groups;
   let r;if(session.user.role==='instructor')r=await rpc('GET','/api/instructor/dashboard',{},session.token);
   else{try{r=await rpc('GET','/api/cadet/workspace',{},session.token);}catch(x){if(x.code!=='NOT_FOUND')throw x;const tests=(await rpc('GET','/api/tests',{},session.token)).tests;const results=(await rpc('GET','/api/my-results',{},session.token)).results;r={tests,results};}}
   if(S.session?.token!==session.token)return;
   S.groups=groups||[];a.fullTests={};a.tests=r.tests||[];a.results=session.user.role==='instructor'||(a.resultWriteVersion||0)===resultWriteVersion?(r.results||[]):C.mergeResults(a.results||[],r.results||[]);a.cadets=r.cadets||[];a.resultTotal=r.resultTotal??a.results.length;a.resultsSheetUrl=r.resultsSheetUrl||a.resultsSheetUrl;a.updatedAt=Date.now();lastError='';
   if(instructor()&&page==='results'){const all=await rpc('GET','/api/instructor/results',{},session.token);if(S.session?.token===session.token){a.results=all.results||[];a.resultTotal=a.results.length;}}
   await persist();
  }
  if(S.session?.token!==session.token)return;
  if(instructor())void loadReviewQueue(true,true,force);
  if(page==='materials'||(!instructor()&&page==='home'&&(force||a.materialCatalogRevision!==response?.revisions.materials))){await materials.refresh();if(response)a.materialCatalogRevision=response.revisions.materials;}
  if(page==='more'&&instructor())await loadInstructors();
  if(page==='cadet-card'&&instructor())await cadetCard.load();
  if(S.session?.token===session.token){if(refresh.manualToken!==session.token)await accountSync.sync(force);if(!instructor())await examSession.discover();}
 }catch(x){if(S.session?.token===session.token)lastError=x.message;}
 finally{if(refreshing===session.token){refreshing=false;if(user()&&page!=='editor'&&page!=='runner'&&page!=='result'&&page!=='grading')render();
  if(refreshQueued){const again=forceQueued;refreshQueued=false;forceQueued=false;if(S.session?.token===session.token&&!updateApplying)setTimeout(()=>{if(S.session?.token===session.token&&!updateApplying&&page!=='runner')refresh(again);else finish();},0);else finish();}else finish();
 }else finish();}
}

async function loadGroups(){try{S.groups=(await rpc('GET','/api/groups')).groups||[];lastError='';await persist();}catch(x){lastError=x.message;}if(!user()&&!working)render();}
async function authSubmit(form,localOnly=false){
 if(updateApplying||working)return;const role=authRole,mode=authMode;const data=Object.fromEntries(new FormData(form));authUsername=data.username||'';authGroup=data.group||'';working=true;lastError='';form.querySelector('button.primary').disabled=true;
 const protectedLocal=typeof secureStorage!=='undefined'&&secureStorage.enabled;
 try{
  let r,opened,offline=false;
  if(localOnly){if(!protectedLocal||mode!=='login')throw Error('Для першого входу потрібен інтернет.');opened=await secureStorage.unlockOffline({username:data.username,password:data.password,role,group:data.group});r=opened.session;offline=true;}
  else{
   try{
    if(mode==='register'){
     const creds=await C.credential(data.password);const body={fullName:data.fullName.trim(),username:data.username.trim(),...creds};
     if(role==='cadet')body.groupId=data.group;else{body.fullName+=' · '+data.title;body.instructorTitle=data.title;body.inviteCode=data.inviteCode.trim();}
     r=await rpc('POST',role==='cadet'?'/api/register':'/api/instructor/register',body,'');
    }else r=await C.signIn(data.username,data.password,role==='cadet'?data.group:'',(path,body)=>rpc('POST',path,body,''));
   }catch(error){
    if(!protectedLocal||mode!=='login'||!['NETWORK','TIMEOUT','HTTP_500','HTTP_502','HTTP_503','HTTP_504'].includes(error.code))throw error;
    opened=await secureStorage.unlockOffline({username:data.username,password:data.password,role,group:data.group});r=opened.session;offline=true;
   }
   if(r.user?.role!==role)throw Error('Оберіть правильний режим входу: інструктор або курсант.');
   if(protectedLocal&&!offline){const reply=await local('/rpc',C.payload('GET','/api/local-storage/key',r.token,{}));if(!reply.ok)throw Object.assign(Error(reply.error||'Не вдалося розблокувати локальні дані.'),{code:reply.code});opened=await secureStorage.unlockOnline({token:r.token,user:r.user},data.password,reply);}
  }
  if(r.user?.role!==role)throw Error('Оберіть правильний режим входу: інструктор або курсант.');
  if(protectedLocal){S.accounts={};if(opened?.account&&Object.keys(opened.account).length)S.accounts[id(r.user.id)]=opened.account;checkpoint=null;}
  S.session={token:r.token,user:r.user};resetSessionViews();accountSync.reset();examSession.reset();account();
  for(const j of opened?.journals||[]){S.journalSerial=Math.max(S.journalSerial||0,j.serial||0);C.applyCheckpoint(S,j);}
  form.reset();page='home';await persist();
  if(protectedLocal&&!offline){await secureStorage.finishMigration();await persist();await secureStorage.collect().catch(()=>{});}
  working=false;if(offline)lastError='Відкрито захищену локальну копію. Нові зміни надішлемо після відновлення інтернету.';render();await recoverRun(offline);if(!offline){await refresh(true);syncQueue(true);}
 }catch(x){if(protectedLocal&&!S.session){await secureStorage.lock().catch(()=>{});S.accounts={};}lastError=x.message;render();}finally{working=false;if(!user())render();}
}

async function refreshResults(){return refresh(false);}
async function navigate(next){
 if(!user()||!instructor()&&!['home','tests','materials','results','more'].includes(next))return;
 loadAnalytics.flight=null;
 menuOpen=false;const fromCard=page==='cadet-card'&&next==='cadets',origin=page==='grading'?grading?.origin:null;
 if(page==='editor'||page==='runner'||page==='grading')await persist();
 if(next==='reviews'){if(instructor())account().resultsView='pending';next='results';}
 if(next!=='grading'){void reviewPresence.stop();if(page==='grading')grading=null;}
 if(next==='cadet-card'&&origin?.page==='cadet-card')account().openCadetId=origin.cadetId;
 page=next;
 if(next==='results'&&instructor()){
  if(origin&&!origin.page){account().resultsView=origin.view;filter=origin.filter;}
  else filter=account().resultsSearches?.[resultsView()]||'';
 }else filter=['tests','cadets'].includes(next)?account().sectionSearches?.[next]||'':'';
 if(!origin&&!fromCard)resetPage(next);render();
 if(next==='cadet-card'&&instructor())return cadetCard.load();
 if(next==='more'&&instructor())return loadInstructors();
 if(next==='materials')return materials.openList();
 if(next==='results')return pendingReviewsActive()?loadReviewQueue():refreshResults();
 if(next==='bank'){try{bank=(await rpc('GET','/api/instructor/question-bank')).questions||[];render();}catch(x){toast(x.message);}}
}

function dialog(title,content,callback,label='Зберегти'){
 modal.innerHTML=`<form id="dialog-form"><h2>${title}</h2>${content}<div class="actions"><button type="button" data-action="cancel-modal">Скасувати</button><button class="primary">${label}</button></div></form>`;
 modal.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,btn=form.querySelector('.primary');btn.disabled=true;try{const result=await callback(Object.fromEntries(new FormData(form)));if(result!==false){form.reset();modal.close();}else btn.disabled=false;}catch(x){toast(x.message);btn.disabled=false;}};modal.showModal();
}
function confirmAction(title,text,callback,label='Підтвердити'){dialog(title,`<p>${text}</p>`,callback,label);}
function forgetResultDetails(a,resultId){
 delete a.reviews[resultId];
 delete a.gradingDrafts?.[resultId];
 for(const field of ['revisions','shadow','requests','conflicts'])delete a.pcSync?.[field]?.['grading:'+resultId];
}
function forgetCadetResults(a,cadetIds,resultIds=[]){
 if(a.cadetCardCache&&cadetIds.has(id(a.cadetCardCache.cadet.id)))delete a.cadetCardCache;
 for(const uid of Object.keys(a.cadetNoteDrafts||{}))if(cadetIds.has(id(uid)))delete a.cadetNoteDrafts[uid];
 const removedResults=new Set(resultIds.map(id));
 const count=a.results.length;
 function keepResult(result){
  if(!cadetIds.has(id(result.userId)))return true;
  removedResults.add(id(result.id));
  return false;
 }
 a.results=a.results.filter(keepResult);
 a.resultTotal=Math.max(a.results.length,(a.resultTotal??count)-(count-a.results.length));
 reviewQueue=reviewQueue.filter(keepResult);
 examRecoveryQueue=examRecoveryQueue.filter(work=>!cadetIds.has(id(work.userId)));
 if(grading&&cadetIds.has(id(grading.result.userId))){
  removedResults.add(id(grading.result.id));
  void reviewPresence.stop(grading.result.id);
  grading=null;
  if(page==='grading')page='results';
 }
 for(const resultId of removedResults)forgetResultDetails(a,resultId);
}

function confirmResultDeletion(resultId){
 if(!instructor()||!account().capabilities?.resultDeletion)return;
 const session=S.session,a=account(),result=a.results.find(item=>id(item.id)===resultId);
 if(!result)throw Error('Результат не знайдено. Оновіть список.');
 const details=`<strong>${e(result.userName)}</strong><br>${e(result.groupName)} · ${e(result.testTitle)}<br><br>Роботу та її оцінку буде видалено зі списку результатів і спільної Google Таблиці. Спробу тесту залишено використаною.`;
 return confirmAction('Видалити результат?',details,async()=>{
  const reply=await rpc('DELETE','/api/instructor/results/'+encodeURIComponent(resultId),{confirmResultId:resultId},session.token);
  if(S.session?.token!==session.token)return;
  if(reply.deleted!==true||id(reply.resultId)!==resultId)throw Error('Сервер не підтвердив видалення вибраної роботи. Оновіть дані.');
  const previousCount=a.results.length;
  a.results=a.results.filter(item=>id(item.id)!==resultId);
  a.resultTotal=Math.max(a.results.length,(a.resultTotal||previousCount)-(previousCount-a.results.length));
  a.resultWriteVersion=(a.resultWriteVersion||0)+1;
  delete a.workspaceRevisions?.results;
  delete a.fullResultsRevision;
  forgetResultDetails(a,resultId);
  reviewQueue=reviewQueue.filter(item=>id(item.id)!==resultId);
  await persist();
  render();
  toast('Результат видалено із застосунка та спільної таблиці.');
  await refresh(true);
 },'Видалити результат');
}
let statementOpening=false;
async function statementSource(session){
 const groups=(await rpc('GET','/api/groups',{},session.token)).groups||[];
 const dashboard=await rpc('GET','/api/instructor/dashboard',{},session.token);
 const results=(await rpc('GET','/api/instructor/results',{},session.token)).results||[];
 if(S.session?.token!==session.token||session.user.role!=='instructor')throw Error('Обліковий запис змінився. Повторіть створення відомості.');
 return {groups,tests:statementTests(dashboard.tests||[],results),cadets:dashboard.cadets||[],results,instructor:session.user};
}
async function openGroupStatement(){
 if(!instructor()||statementOpening)return;statementOpening=true;const session=S.session;
 try{
  const source=await statementSource(session);
  if(!source.groups.length||!source.tests.length)throw Error('Для відомості потрібні навчальна група й тест.');
  const tests=source.tests.map(t=>`<option value="${e(t.id)}">${e(t.title)}${source.tests.filter(v=>v.title===t.title).length>1?' · №'+e(t.id):''}</option>`).join('');
  dialog('Відомість групи',`<p>Один PDF на аркуші А4: до 27 курсантів, дата та місце для підпису.</p><label class="field">Група<select name="groupId" required><option value="">Оберіть групу</option>${source.groups.map(g=>`<option value="${e(g.id)}">${e(g.name)}</option>`).join('')}</select></label><label class="field">Тест<select name="testId" required><option value="">Оберіть тест</option>${tests}</select></label><p id="statement-count">Оберіть групу та тест.</p><p>Перед створенням результати оновляться із сервера. Ненадіслані результати позначаються «Немає результату».</p>`,async data=>{
   const current=await statementSource(session),statement=buildStatement(current,data.groupId,data.testId,new Date().toLocaleDateString('uk-UA'));
   const pdf=await statementPdf(statement);
   if(S.session?.token!==session.token)throw Error('Обліковий запис змінився. Повторіть створення відомості.');
   download(pdf.bytes,`Vidomist-${String(data.groupId).replace(/[^A-Za-z0-9-]/g,'_')}-${String(data.testId).replace(/[^A-Za-z0-9-]/g,'_')}-${new Date().toLocaleDateString('sv-SE')}.pdf`,'application/pdf');toast('Відомість збережено: один аркуш А4.');
  },'Зберегти PDF');
  const form=modal.querySelector('form'),button=form.querySelector('.primary');
  const update=()=>{const group=source.groups.find(g=>String(g.id)===form.elements.groupId.value),count=source.cadets.filter(u=>u.role==='cadet'&&u.groupName===group?.name).length;form.querySelector('#statement-count').textContent=group?`Курсантів у відомості: ${count}.`+(count>27?' Максимум для однієї відомості - 27.':''): 'Оберіть групу та тест.';button.disabled=!group||!form.elements.testId.value||count<1||count>27;};
  form.addEventListener('change',update);update();
 }finally{statementOpening=false;}
}
function accessLabel(t){if(!t.published)return 'Чернетка';if(!t.access)return 'Доступ за публікацією';return Object.keys(t.access.groups||{}).length?'Доступ за групами':t.access.defaultOpen?'Відкрито для проходження':'Закрито для проходження';}
async function openTestAccess(testId){
 if(!instructor()||!account().capabilities?.testAccess)throw Error('Для керування доступом оновіть сервер комісії.');
 const session=S.session,response=await rpc('GET','/api/instructor/tests/'+encodeURIComponent(testId)+'/access',{},session.token),test=response.test;
 if(id(test?.id)!==id(testId)||test.access?.protocol!==1||!Number.isSafeInteger(test.access.revision)||typeof test.access.defaultOpen!=='boolean'||!test.access.groups||!Array.isArray(response.groups))throw Error('Не вдалося підтвердити поточні правила доступу.');
 const assigned=C.groupsFrom(test.description),groups=response.groups.filter(g=>!g.archived&&(!assigned.length||assigned.includes(g.name))),current=selectedGroup('tests'),scope=groups.some(g=>id(g.id)===id(current?.id))?id(current.id):'all';
 const state=g=>Object.hasOwn(test.access.groups,id(g.id))?test.access.groups[id(g.id)]:test.access.defaultOpen;
 dialog('Доступ до тесту',`<p><strong>${e(test.title)}</strong></p><p>${e(accessLabel(test))}. Закриття зупиняє початок нових спроб. Розпочаті роботи можна завершити.</p><label class="field">Для кого<select name="accessScope"><option value="all" ${scope==='all'?'selected':''}>Усі призначені групи</option>${groups.map(g=>`<option value="${e(g.id)}" ${scope===id(g.id)?'selected':''}>${e(g.name)} · ${state(g)?'відкрито':'закрито'}</option>`).join('')}</select></label><label class="field">Доступ<select name="accessState"><option value="closed">Закрити для проходження</option><option value="open" ${!test.published?'disabled':''}>Відкрити для проходження</option></select></label><p class="muted">Вибір усіх груп замінить окремі правила цього тесту. Призначення тесту навчальним групам збережеться.</p>`,async data=>{
  if(!['open','closed'].includes(data.accessState))throw Error('Оберіть стан доступу.');
  const reply=await rpc('POST','/api/instructor/tests/'+encodeURIComponent(testId)+'/access',{expectedRevision:test.access.revision,scope:data.accessScope==='all'?'all':'group',groupId:data.accessScope==='all'?'':data.accessScope,open:data.accessState==='open'},session.token);
  if(id(reply.test?.id)!==id(testId)||reply.test.access?.revision!==test.access.revision+1)throw Error('Сервер не підтвердив зміну доступу. Оновіть каталог.');
  await refresh(true);toast(data.accessState==='open'?'Тест відкрито для нових спроб.':'Тест закрито. Розпочаті роботи можна завершити.');
 },'Застосувати');
}
function excelReportButton(){const busy=exportResultsXlsx.flight?.token===S.session?.token;return instructor()?`<button data-action="export-xlsx" ${busy?'disabled aria-busy="true"':''}>${busy?'Готуємо Excel…':'↓ Excel (.xlsx)'}</button>`:'';}
function exportResultsXlsx(all=false){
 if(!instructor())return Promise.resolve();const token=S.session.token,a=account();if(exportResultsXlsx.flight?.token===token)return exportResultsXlsx.flight.promise;
 const f=all?{}:{...sharedFilters('results')},query=all?'':filter,flight={token,promise:null};exportResultsXlsx.flight=flight;
 flight.promise=Promise.resolve().then(async()=>{
  render();toast('Готуємо Excel: результати, відомість групи та зведення…');
  const reply=await rpc('GET','/api/instructor/reports/results',{groupId:f.groupId||'',testId:!all&&rankingActive()?'':f.testId||'',query},token);
  if(S.session?.token!==token||account()!==a)return;
  if(reply.reportProtocol!==1||id(reply.userId)!==id(user().id)||!Array.isArray(reply.results)||!Array.isArray(reply.cadets)||!Array.isArray(reply.tests)||!Number.isFinite(Date.parse(reply.generatedAt)))throw Error('Сервер повернув некоректні дані для Excel.');
  const model=reportModel(reply,{timezoneOffsetMinutes:new Date(reply.generatedAt).getTimezoneOffset()});
  download(xlsxBytes(model),reportFilename(reply.scope,reply.generatedAt,new Date(reply.generatedAt).getTimezoneOffset()),XLSX_MIME);toast('Excel підготовлено · 3 аркуші · робіт: '+reply.results.length);
 }).finally(()=>{if(exportResultsXlsx.flight===flight){exportResultsXlsx.flight=null;if(S.session?.token===token)render();}});
 return flight.promise;
}
function validArchivePart(reply,jobId,part,first){
 if(reply?.archiveProtocol!==1||reply.jobId!==jobId||reply.part!==part||!Number.isSafeInteger(reply.size)||reply.size<1||reply.size>64*1024*1024||!Number.isSafeInteger(reply.totalParts)||reply.totalParts<1||reply.totalParts>200||typeof reply.name!=='string'||!reply.name.endsWith('.xlsx')||reply.name.length>240||/[\\/]/.test(reply.name)||!/^[a-f0-9]{64}$/.test(reply.sha256)||typeof reply.data!=='string'||reply.data.length>480000||!/^[A-Za-z0-9+/]*={0,2}$/.test(reply.data))throw Error('Сервер повернув некоректну частину архіву.');
 if(first&&['name','size','sha256','totalParts'].some(k=>reply[k]!==first[k]))throw Error('Архів змінився під час завантаження. Повторіть завантаження.');return reply;
}
function downloadIntakeArchive(jobId){
 if(!instructor())return Promise.resolve();const token=S.session.token,a=account(),flights=downloadIntakeArchive.flights??=new Map(),key=token+'|'+jobId;if(flights.has(key))return flights.get(key);
 const promise=Promise.resolve().then(async()=>{
  toast('Завантажуємо збережений архів набору…');const first=validArchivePart(await rpc('GET','/api/instructor/intake/archive',{jobId,part:0},token),jobId,0),parts=[first.data];
  for(let part=1;part<first.totalParts;part++)parts.push(validArchivePart(await rpc('GET','/api/instructor/intake/archive',{jobId,part},token),jobId,part,first).data);
  if(S.session?.token!==token||account()!==a)return;
  let decoded;try{decoded=atob(parts.join(''));}catch{throw Error('Не вдалося прочитати архів Excel. Повторіть завантаження.');}
  const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0)),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==first.size||sha!==first.sha256)throw Error('Архів не пройшов перевірку цілісності. Очищення призупинено; збережений файл можна завантажити повторно.');
  if(S.session?.token!==token||account()!==a)return;
  download(bytes,first.name,XLSX_MIME);a.intakeArchiveDownloads??={};a.intakeArchiveDownloads[jobId]=sha;await diskWriter.save();toast('Архів Excel перевірено й підготовлено до збереження.');
 }).finally(()=>{if(flights.get(key)===promise)flights.delete(key);});flights.set(key,promise);return promise;
}
async function openIntakeArchives(){
 if(!instructor())return;const token=S.session.token,reply=await rpc('GET','/api/instructor/intake/archives',{},token);if(S.session?.token!==token)return;
 if(reply.archiveProtocol!==1||!Array.isArray(reply.archives)||reply.archives.length>50)throw Error('Не вдалося отримати список архівів.');
 const rows=reply.archives;dialog('Архіви наборів',rows.length?`<p>Збережені книги Excel: результати, відомість групи та зведення. Архів створюється перед очищенням набору.</p><div class="intake-archive-list">${rows.map(r=>`<article class="intake-archive-entry"><div><strong>${e(r.name)}</strong><small>${e(date(r.startedAt))}</small><p>Курсантів: ${e(r.cadets)} · Робіт: ${e(r.results)}</p></div><button type="button" data-action="download-intake-archive" data-id="${e(r.jobId)}">↓ Excel</button></article>`).join('')}</div>`:'<p>Архівів ще немає. Перший з’явиться після підготовки нового набору.</p>',async()=>{},'Закрити');modal.querySelector('[data-action="cancel-modal"]').hidden=true;
}


function validIntake(value){
 if(!value||typeof value.id!=='string'||!value.id.startsWith('intake-')||!['running','completed'].includes(value.state)||!Number.isInteger(value.phase)||!Number.isInteger(value.steps)||value.steps<1||value.steps>100||value.phase<0||value.phase>value.steps||['cadets','results','tests'].some(k=>!Number.isInteger(value[k])||value[k]<0)||(value.state==='completed')!==(value.phase===value.steps))throw Error('Сервер не підтвердив стан підготовки набору.');
 return value;
}
function intakeNotice(){
 const value=instructor()?account().intake:null;if(!value)return '';
 return `<section class="notice intake-status" role="status"><div><strong>Підготовка нового набору${value.state==='completed'?' · завершення':''}</strong><p>${value.archiveRequired&&!value.archive?'Створюємо та перевіряємо архів Excel перед очищенням. ':value.archive?'Архів Excel збережено. ':''}Крок ${value.phase} із ${value.steps}. Реєстрацію та зміни тимчасово призупинено.${value.error?' '+e(value.error):''}</p><progress max="${value.steps}" value="${value.phase}" aria-label="Підготовка нового набору"></progress></div><button data-action="resume-intake" ${intakeRunning?'disabled':''}>${intakeRunning?'Виконуємо…':'Продовжити підготовку'}</button></section>`;
}
function clearOldIntakeState(generation){
 const a=account();if((a.intakeGeneration||'0')===generation)return false;
 a.deletedTestIds=[];
 if(instructor()){
  a.gradingDrafts={};a.reviews={};a.cadetNoteDrafts={};delete a.cadetCardCache;reviewQueue=[];examRecoveryQueue=[];reviewQueueToken='';reviewQueueUpdatedAt=0;grading=null;void reviewPresence.stop();
  if(page==='grading'||page==='cadet-card')page='cadets';
  if(a.pcSync){for(const key of ['revisions','shadow','requests','conflicts'])for(const name of Object.keys(a.pcSync[key]||{}))if(name.startsWith('grading:'))delete a.pcSync[key][name];a.pcSync.cursor='';}
  accountSync.reset();
 }
 a.intakeGeneration=generation;return true;
}
async function runIntake(jobId){
 if(!instructor()||intakeRunning)return;const session=S.session,a=account();intakeRunning=session.token;render();
 try{
  while(S.session?.token===session.token){
   const response=await rpc('POST','/api/instructor/intake/continue',{jobId},session.token),value=validIntake(response.intake);
   if(value.id!==jobId)throw Error('Сервер повернув іншу операцію. Оновіть дані.');
   a.intake=value;await diskWriter.save();render();
   if(value.archive&&a.intakeArchiveDownloads?.[jobId]!==value.archive.sha256){await downloadIntakeArchive(jobId);if(S.session?.token!==session.token)return;}
   if(value.state==='completed'){a.intake=null;clearOldIntakeState(value.id);a.workspaceRevisions={};a.workspaceFullAt=0;await persist();await refresh(true);toast('Новий набір підготовлено. Курсанти й проходження очищені, тести збережені та закриті.');break;}
  }
 }catch(x){if(S.session?.token===session.token){try{const r=await rpc('GET','/api/instructor/intake',{},session.token);if(r.intake){a.intake=validIntake(r.intake);await diskWriter.save();}}catch{}toast(x.message+' Підготовку можна продовжити з цього кроку.');}}
 finally{if(intakeRunning===session.token)intakeRunning='';if(S.session?.token===session.token)render();}
}
async function openNewIntake(){
 if(!instructor()||!account().capabilities?.newIntake)throw Error('Для підготовки нового набору оновіть сервер комісії.');
 const session=S.session,response=await rpc('GET','/api/instructor/intake',{},session.token);
 if(response.intake){account().intake=validIntake(response.intake);render();return runIntake(response.intake.id);}
 const preview=response.preview;if(!preview||['cadets','results','tests'].some(k=>!Number.isInteger(preview[k])||preview[k]<0)||typeof response.previewToken!=='string')throw Error('Не вдалося підтвердити обсяг очищення.');
 const requestId=crypto.randomUUID();
 dialog('Підготувати новий набір',`<div class="intake-summary"><strong>Усі навчальні групи</strong><p>Буде видалено курсантів: <b>${preview.cadets}</b><br>Результатів проходження: <b>${preview.results}</b><br>Тестів залишиться в каталозі: <b>${preview.tests}</b></p></div><p>Облікові записи курсантів, відповіді, проходження, перегляди матеріалів та незавершені спроби буде очищено. Тести буде закрито. Інструктори, групи, матеріали та банк питань збережуться.</p><label class="field">Назва набору для архіву<input name="intakeArchiveName" maxlength="80" value="Набір ${e(new Date().toLocaleDateString('uk-UA'))}" required></label><p>Перед очищенням автоматично збережеться перевірений архів Excel у Google Drive та почнеться його завантаження на цей ПК.</p><button type="button" data-action="intake-export">Завантажити Excel зараз</button><label class="check"><input type="checkbox" name="intakeReviewed" required>Підтверджую очищення всіх курсантів у всіх групах. Дію неможливо скасувати.</label><label class="field">Введіть НОВИЙ НАБІР<input name="intakeConfirmation" required autocomplete="off" spellcheck="false" placeholder="НОВИЙ НАБІР"></label><p class="muted">Якщо підготовка перерветься, будь-який інструктор зможе продовжити її в розділі «Курсанти».</p>`,async data=>{
  if(data.intakeReviewed!=='on'||data.intakeConfirmation.trim()!=='НОВИЙ НАБІР')throw Error('Перевірте підтвердження та введіть «НОВИЙ НАБІР».');
  const reply=await rpc('POST','/api/instructor/intake/start',{requestId,previewToken:response.previewToken,confirmation:data.intakeConfirmation.trim(),archiveName:data.intakeArchiveName?.trim(),timezoneOffsetMinutes:new Date().getTimezoneOffset()},session.token),value=validIntake(reply.intake);
  account().intake=value;await diskWriter.save();setTimeout(()=>runIntake(value.id).catch(x=>toast(x.message)),0);
 },'Очистити та підготувати');
}
async function fetchTest(testId,force=false){const session=S.session,a=account();if(!force&&a.fullTests[id(testId)])return a.fullTests[id(testId)];const r=await rpc('GET','/api/tests/'+encodeURIComponent(testId),{},session.token);a.fullTests[id(testId)]=r.test;await persist();if(S.session?.token!==session.token)throw Object.assign(Error('Обліковий запис змінився. Повторіть дію.'),{code:'SESSION_CHANGED'});return r.test;}
async function downloadTest(testId){await fetchTest(testId,true);toast('Тест збережено для офлайну.');if(page==='tests')render();}
async function start(testId){
 const session=S.session,a=account();if(!session)return;if(C.isRetakeTest(a.tests.find(t=>id(t.id)===id(testId)))||C.isRetakeTest(a.fullTests[id(testId)]))throw Error('Повторне проходження тестів недоступне.');if(a.run)return resumeRun();if(C.completed(testId,a.results,a.pending,null,a.deletedTestIds)||a.examRecoveries?.some(x=>id(x.testId)===id(testId)))throw Error('Цей тест уже пройдено або робота очікує підтвердження.');
 await refresh();if(S.session?.token!==session.token)return;if(C.completed(testId,a.results,a.pending,null,a.deletedTestIds))throw Error('Цей тест уже пройдено на іншому пристрої.');
 const catalogTest=a.tests.find(t=>id(t.id)===id(testId));if(catalogTest?.access?.open===false)throw Error('Тест закрито. Дочекайтеся відкриття інструктором.');const test=await fetchTest(testId);if(S.session?.token!==session.token)return;if(C.isRetakeTest(test))throw Error('Повторне проходження тестів недоступне.');if(!test.questions?.length)throw Error('У тесті немає питань.');if(!a.capabilities?.multipleChoice)throw Error('Для вибору до двох відповідей оновіть серверний Code.gs до API 14.');
 confirmAction(test.mode==='exam'?'Почати іспит?':'Почати тренування?',`${e(test.title)}<br>${test.questions.length} питань${test.mode==='exam'?', '+test.durationMinutes+' хвилин. Переходи до інших вікон фіксуються. Відповіді зберігаються в акаунті. Можна продовжити на іншому ПК; таймер продовжує відлік.':'. Відповіді синхронізуються з акаунтом.'}`,async()=>{
  if(S.session?.token!==session.token)return;
  if(test.mode==='exam'){await examSession.start(test.id);return resumeRun();}
  const submissionId='pc-'+crypto.randomUUID();let confirmed=test,startPermit;if(a.capabilities?.testAccess||test.access?.protocol===1){let reply;try{reply=await rpc('POST','/api/tests/'+encodeURIComponent(test.id)+'/start',{submissionId},session.token);}catch(x){if(x.code==='NETWORK')x.message='Для початку тесту підключіться до інтернету та дочекайтеся відкриття інструктором.';throw x;}if(reply.submissionId!==submissionId||id(reply.test?.id)!==id(test.id)||typeof reply.startPermit!=='string'||!reply.startPermit.includes('.'))throw Error('Сервер не підтвердив початок цієї спроби.');confirmed=reply.test;startPermit=reply.startPermit;}const now=await getClock();if(S.session?.token!==session.token)return;a.run={test:C.shuffled(confirmed),...(startPermit?{startPermit}:{}),answers:{},index:0,startedUptime:now.uptime,launchId:now.launchId,submissionId,exitCount:0,userId:id(user().id)};await persist();page='runner';render();if(test.mode==='exam')document.documentElement.requestFullscreen?.().catch(()=>{});
 },'Почати');
}
function tick(){if(!alive()||!user()||page!=='runner')return;const r=account().run;if(!r)return;const elapsed=Math.floor(r.examProtocol===1?examSession.elapsed(r):Math.max(0,(uptime()-r.startedUptime)/1000)),remaining=Math.max(0,(r.examProtocol===1?(r.deadline-r.startedAt)/1000:r.test.durationMinutes*60)-elapsed);if($('#timer')){$('#timer').textContent=time(r.test.mode==='exam'?remaining:elapsed);$('#timer').classList.toggle('bad',r.test.mode==='exam'&&remaining<60);}r.lastElapsed=elapsed;if(r.test.mode==='exam'&&remaining===0&&(!r.examProtocol||examSession.owned(r))&&!examSession.status().busy){if(r.examProtocol===1&&!examSession.expired(r)){if($('#timer'))$('#timer').textContent='Уточнюємо час…';examSession.sync().catch(x=>toast(x.message));}else finishRun(false).catch(x=>toast(x.message));}}
async function recoverRun(offline=false){const session=S.session,a=account(),r=a.run,native=await getClock();if(S.session?.token!==session.token)return;try{if(r?.test.mode==='exam'){if(r.examProtocol===1){if(!offline)await examSession.discover();}else{r.startedUptime=native.uptime-Math.max(0,r.lastElapsed||0)*1000;r.launchId=native.launchId;r.legacyRecovery=true;await persist();}}else if(r?.test.mode==='training'&&r.launchId!==clock.launchId){r.startedUptime=native.uptime-Math.max(0,r.lastElapsed||0)*1000;r.launchId=native.launchId;await persist();}else if(!instructor()&&!offline)await examSession.discover();}catch(x){if(S.session?.token===session.token)lastError=x.message;}}
async function finishRun(ask=true,forcedUptime=null){
 const session=S.session,a=account(),r=a.run;if(!r||working)return;
 if(ask){const missing=r.test.questions.filter(q=>!C.answered(q,r.answers)).length;confirmAction('Завершити тест?',missing?`Без відповіді залишилося ${missing} пит. Після завершення повторне проходження буде заблоковане.`:'Усі питання отримали відповіді. Результат буде надіслано на спільний сервер.',()=>{if(S.session?.token===session.token&&account().run===r)return finishRun(false);},'Завершити');return;}
 working=true;
 try{if(r.examProtocol===1){await examSession.finish();return;}const now=forcedUptime??(await getClock()).uptime;if(S.session?.token!==session.token||a.run!==r)return;const body=C.submission(r,now);const pending={body,testTitle:r.test.title,userId:id(session.user.id),attempts:0,nextAt:0,createdAt:Date.now()};a.pending.push(pending);a.run=null;try{await persist();}catch(x){a.run=r;a.pending=a.pending.filter(p=>p!==pending);throw x;}if(S.session?.token!==session.token)return;lastResult={testTitle:r.test.title,testId:id(r.test.id),submissionId:r.submissionId};page='result';render();if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});await syncQueue(true);}
 finally{working=false;if(!user())render();}
}
async function syncQueue(force=false){
 // A pending result request belongs to its originating account.
 if(updateApplying||!user()||instructor()||syncing===S.session.token||!alive())return;const session=S.session,a=account();let resolve;const completion={token:session.token,promise:new Promise(done=>resolve=done)};syncQueue.completion=completion;syncing=session.token;
 try{
  for(const p of [...a.pending]){
   if(S.session?.token!==session.token)break;if((p.permanent&&!force)||(!force&&p.nextAt>Date.now()))continue;
   try{let r;try{r=await rpc('POST','/api/results',p.body,session.token);}catch(x){if(x.code!=='EXAM_SESSION_REQUIRED')throw x;r=await rpc('POST','/api/exam-recoveries',p.body,session.token);}
    if(S.session?.token!==session.token)break;
    if(r.examRecoveryProtocol===1&&r.recovery){
     const recovery=C.validateRecovery(r.recovery,session.user.id,p.body.testId,p.body.submissionId);
     a.examRecoveries=[...(a.examRecoveries||[]).filter(x=>id(x.id)!==id(recovery.id)),recovery];
     a.pending=a.pending.filter(q=>q.body.submissionId!==p.body.submissionId);a.resultWriteVersion=(a.resultWriteVersion||0)+1;lastError='';
     if(page==='result'&&lastResult?.submissionId===p.body.submissionId)lastResult={recovery,testTitle:p.testTitle,testId:id(p.body.testId),submissionId:p.body.submissionId};
     try{await persist();}catch(x){if(!a.pending.some(q=>q.body.submissionId===p.body.submissionId))a.pending.push(p);throw x;}continue;
    }
    C.validateResult(r.result,session.user.id,p.body.testId);const review=C.enrichReview(r.review,a.fullTests[id(p.body.testId)]);if(review.length)a.reviews[id(r.result.id)]=review;a.results=C.mergeResults(a.results,[r.result]);a.pending=a.pending.filter(q=>q.body.submissionId!==p.body.submissionId);a.resultWriteVersion=(a.resultWriteVersion||0)+1;a.updatedAt=Date.now();lastError='';if(page==='result'&&lastResult?.submissionId===p.body.submissionId)lastResult={...r,review:a.reviews[id(r.result.id)]||[],testId:id(p.body.testId),submissionId:p.body.submissionId};try{await persist();}catch(x){if(!a.pending.some(q=>q.body.submissionId===p.body.submissionId))a.pending.push(p);throw x;}}
   catch(x){
    if(S.session?.token!==session.token)break;p.attempts++;p.failure=x.message;p.failureCode=x.code;
    if(x.code==='RESULT_DELETED'){
     const testId=id(p.body.testId);
     a.deletedTestIds=[...new Set([...(a.deletedTestIds||[]),testId])];
     for(const item of a.results)if(id(item.testId)===testId)forgetResultDetails(a,id(item.id));
     a.results=a.results.filter(item=>id(item.testId)!==testId);
     a.pending=a.pending.filter(item=>item.body.submissionId!==p.body.submissionId);
     a.resultWriteVersion=(a.resultWriteVersion||0)+1;
     if(page==='result'&&lastResult?.submissionId===p.body.submissionId){lastResult=null;page='results';}
     await persist();
     toast(x.message);
     continue;
    }
    if(x.code==='ALREADY_COMPLETED'){
     try{const r=await rpc('GET','/api/my-results',{},session.token);if(S.session?.token!==session.token)break;const authoritative=r.results.find(v=>id(v.testId)===id(p.body.testId));if(authoritative){C.validateResult(authoritative,session.user.id,p.body.testId);a.results=C.mergeResults(a.results,[authoritative]);a.pending=a.pending.filter(q=>q.body.submissionId!==p.body.submissionId);if(page==='result'&&lastResult?.submissionId===p.body.submissionId)lastResult={result:authoritative,review:a.reviews[id(authoritative.id)]||[],testId:id(p.body.testId),submissionId:p.body.submissionId};lastError='';try{await persist();}catch(x){if(!a.pending.some(q=>q.body.submissionId===p.body.submissionId))a.pending.push(p);throw x;}continue;}p.failure='Очікуємо підтвердження сервера.';}
     catch(problem){if(S.session?.token!==session.token)break;p.failure=problem.message;}
     p.permanent=false;p.nextAt=Date.now()+C.retryDelay(p.attempts);
    }else if((x.localSave||C.retryable(x.code))){p.permanent=false;p.nextAt=Date.now()+C.retryDelay(p.attempts);}else p.permanent=true;
    await persist();lastError=p.failure;break;
   }
  }
 }finally{resolve();if(syncQueue.completion===completion)syncQueue.completion=null;if(syncing===session.token){syncing=false;if(S.session?.token===session.token&&page!=='runner'&&page!=='editor')render();}}
}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function officeReview(d){
 if(!d.importSource)return '';
 const errors=d.questions.filter(q=>importQuestionError(q)).length;
 return `<section class="panel import-review"><h2>Перевірка імпорту</h2><p>${e(d.importSource)}</p><p id="import-summary">Знайдено ${d.questions.length} питань. Готові: ${d.questions.length-errors}. Потребують перевірки: ${errors}.</p>${(d.importWarnings||[]).map(w=>`<p class="muted">${e(w)}</p>`).join('')}<p>Перевірте текст і ключі в кожній картці. Чернетка зберігається автоматично. Стан синхронізації з акаунтом показано вгорі.</p><label class="check"><input type="checkbox" data-draft="importReviewed" ${d.importReviewed?'checked':''}>Я перевірив питання та правильні відповіді</label></section>`;
}
function refreshImportReview(){
 const d=account().draft;if(!d?.importSource)return;
 const errors=d.questions.filter(q=>importQuestionError(q)).length;
 const summary=$('#import-summary');if(summary)summary.textContent=`Знайдено ${d.questions.length} питань. Готові: ${d.questions.length-errors}. Потребують перевірки: ${errors}.`;
 d.questions.forEach((q,i)=>{const el=document.querySelector(`[data-import-error="${i}"]`);if(el){const error=importQuestionError(q);el.textContent=error;el.hidden=!error;}});
 for(const name of ['publish-test','cloud-draft']){const button=document.querySelector(`button[data-action="${name}"]`);if(button)button.disabled=working||!!C.validateDraft(d);}
}
function importTest(){
 if(!instructor())throw Error('Імпорт доступний лише інструктору.');
 dialog('Імпортувати файл',`<p>Word (.docx), Excel (.xlsx) або JSON. До 200 питань, файл до 8 МБ. Спочатку відкриється чернетка для перевірки.</p><p>У Word потрібні нумеровані питання, варіанти А/Б/В/Г та ключі. У Excel — таблиця за зразком. Для сканів спочатку розпізнайте текст.</p><p>Завантажити зразок:</p><div class="actions"><button type="button" data-action="sample-office" data-format="docx">Word</button><button type="button" data-action="sample-office" data-format="xlsx">Excel</button><button type="button" data-action="sample-json">JSON</button></div>`,()=>{modal.close();chooseImportFile();return false;},'Обрати файл');
}
function chooseImportFile(){
 const session=S.session;if(!session||session.user.role!=='instructor')return;
 const validSession=()=>alive()&&S.session?.token===session.token&&id(user()?.id)===id(session.user.id)&&instructor();
 const input=document.createElement('input');input.type='file';input.accept='.docx,.xlsx,.json,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 input.onchange=async()=>{try{
  const file=input.files[0];if(!file)return;if(file.size>OFFICE_MAX_BYTES)throw Error('Файл завеликий. Максимум — 8 МБ.');toast('Розпізнавання файлу…');let draft;
  if(/\.(docx|xlsx)$/i.test(file.name)){const result=await importOffice(file.name,await file.arrayBuffer());draft={...C.newDraft(),title:result.title,questions:result.questions,published:false,importSource:result.source,importWarnings:result.warnings,importReviewed:false};}
  else{if(!/\.json$/i.test(file.name))throw Error('Оберіть файл .docx, .xlsx або JSON.');if(file.size>2000000)throw Error('JSON завеликий.');const value=JSON.parse((await file.text()).replace(/^\uFEFF/,''));draft=C.draftFrom(value.test??value);if(!draft.questions.length)throw Error('У JSON немає питань.');}
  if(!validSession())throw Error('Обліковий запис змінився. Повторіть імпорт.');
  const apply=async()=>{if(!validSession())throw Error('Обліковий запис змінився. Повторіть імпорт.');account().draft=draft;await persist();page='editor';render();toast('Файл розпізнано. Перевірте питання та правильні відповіді.');};
  if(account().draft)confirmAction('Замінити чернетку?','Поточну чернетку буде замінено питаннями з вибраного файлу.',apply);else await apply();
 }catch(x){toast(x.message);}};input.click();
}
async function sampleOffice(format){
 if(!['docx','xlsx'].includes(format))return;
 const response=await fetch('/test-import-sample.'+format);if(!response.ok)throw Error('Не вдалося відкрити зразок. Перезапустіть програму.');
 download(new Uint8Array(await response.arrayBuffer()),'FPV-test-zrazok.'+format,format==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
async function saveBankQuestion(index){
 if(!instructor())throw Error('Банк питань доступний лише інструктору.');
 const session=S.session,source=account().draft?.questions[index];if(!source)throw Error('Питання не знайдено.');
 const question=structuredClone(source),error=C.validateDraft({...C.newDraft(),title:'Питання банку',questions:[question]});if(error)throw Error(error);
 dialog('Зберегти питання до банку',`<p>${e(question.text)}</p><label class="field">Категорія<input name="category" required maxlength="80" placeholder="Наприклад, Метеорологія"></label><label class="field">Складність<select name="difficulty"><option value="easy">Легка</option><option value="medium" selected>Середня</option><option value="hard">Висока</option></select></label>`,async data=>{
  if(S.session?.token!==session.token||!instructor())throw Error('Обліковий запис змінився. Повторіть дію.');
  const category=data.category.trim();if(!category)throw Error('Укажіть категорію питання.');
  const reply=await rpc('POST','/api/instructor/question-bank',{category,difficulty:data.difficulty,question},session.token),saved=reply.question;
  if(!saved?.id||saved.category!==category||saved.question?.text!==question.text.trim())throw Error('Сервер не підтвердив збереження питання. Оновіть банк перед повтором.');
  bank=[saved,...bank.filter(item=>id(item.id)!==id(saved.id))];toast('Питання збережено до банку.');
 },'Зберегти до банку');
}
async function publish(published){
 const session=S.session,a=account(),d=a.draft,error=C.validateDraft(d);if(error)throw Error(error);
 if(JSON.stringify(C.draftAPI(d,published).questions).length>48000&&!a.capabilities?.chunkedTests){await persist();throw Error('Для великих тестів потрібне оновлення сервера комісії до API 17. Чернетку збережено.');}
 if(d.questions.some(q=>C.isWritten(q)||+(q.maxPoints??1)!==1)&&!a.capabilities?.writtenTests)throw Error('Спочатку оновіть серверний Код.gs до версії 3.3.0.');
 const snapshot=structuredClone(d),revision=JSON.stringify(d);working=true;render();
 try{
  const body=await C.publicationBody(snapshot,published);if(S.session?.token!==session.token)return;
  await persist();if(S.session?.token!==session.token)return;
  const reply=await rpc('POST',snapshot.replacesId?'/api/instructor/tests/'+encodeURIComponent(snapshot.replacesId)+'/replace':'/api/instructor/tests',body,session.token);
  if(!reply.test||!id(reply.test.id)||id(reply.test.id)==='0'||reply.test.title!==body.title)throw Error('Сервер не підтвердив публікацію тесту. Чернетку збережено; повторіть дію.');
  if(JSON.stringify(a.draft)===revision)a.draft=null;await persist();page='tests';
  toast(published?(a.capabilities?.testAccess?'Тест опубліковано та закрито. Відкрийте доступ перед заняттям.':'Тест опубліковано. Курсантам він доступний після оновлення каталогу.'):'Чернетку збережено на сервері.');await refresh(true);
 }finally{working=false;render();}
}
async function clickAction(button){
 if(updateApplying)return;
 const act=button.dataset.action,q=+button.dataset.q,j=+button.dataset.a,tid=button.dataset.id;
 if(act==='toggle-menu'){setMenu(!menuOpen);return;}
 if(act==='cancel-modal'){modal.close();return;}
 if(working&&(act==='role'||act==='auth-mode'))return;
 if(act==='role'){authRole=button.dataset.role;lastError='';render();return;}
 if(act==='unlock-local')return authSubmit(button.closest('form'),true);
 if(act==='auth-mode'){authMode=authMode==='login'?'register':'login';lastError='';render();return;}
 if(act==='show-password'){const field=button.previousElementSibling;field.type=field.type==='password'?'text':'password';button.textContent=field.type==='password'?'Показати':'Сховати';return;}
 if(act==='theme'){S.theme=S.theme==='dark'?'light':'dark';await persist();render();return;}
 if(!user())return;
 if(act==='list-page'){listPages[button.dataset.list]=+button.dataset.index;render();document.querySelector('.main')?.scrollTo(0,0);return;}
 const a=account();
 if(page==='runner'&&a.run?.examProtocol===1&&!examSession.editable(a.run)&&['question','prev','next','unanswered','finish','handoff-exam'].includes(act))return;
 if(await materials.action(act,tid))return;
 if(act==='cadet-card'){if(!instructor())return;a.openCadetId=tid;return navigate('cadet-card');}
 if(act.startsWith('card-')&&await cadetCard.action(act,button))return;
 if(act==='grade-result')return openGrading(tid);
 if(act==='delete-result')return confirmResultDeletion(id(tid));
 if(act==='save-grades')return saveGrading();
 if(act==='reload-grading')return openGrading(grading.result.id,true);
 if(act==='claim-review')return openGrading(grading.result.id);
 if(act==='refresh-instructors')return loadInstructors();
 if(act==='nav')return navigate(button.dataset.page);
 if(act==='results-view'){
  if(!instructor()||!['compact','pending','ranking'].includes(button.dataset.view))return;
  const keepFocus=!!document.activeElement?.closest('.results-switch');a.resultsSearches??={};a.resultsSearches[resultsView()]=filter;
  a.resultsView=button.dataset.view;page='results';filter=a.resultsSearches[resultsView()]||'';await persist();render();
  if(keepFocus)$('#results-tab-'+resultsView())?.focus({preventScroll:true});
  return pendingReviewsActive()?loadReviewQueue(false,false,true):refreshResults();
 }
 if(act==='review-recovery')return openExamRecovery(tid);
 if(act==='refresh'||act==='sync-account')return updateData();
 if(act==='toggle-material-filters'){const focused=document.activeElement===button;a.materialFiltersOpen=!a.materialFiltersOpen;scheduleSave();render();if(focused)$('[data-action="toggle-material-filters"]')?.focus({preventScroll:true});return;}
 if(act==='reset-filters'){Object.assign(sharedFilters(page),{groupId:'',testId:''});delete sharedTestSearches.get(a)?.[page];if(['tests','cadets'].includes(page)){filter='';a.sectionSearches??={};a.sectionSearches[page]='';}resetPage(page);if(page==='results')resetPage('ranking');await persist();if(page==='analytics')await loadAnalytics();render();return;}
 if(act==='toggle-archive'){a.showArchived=!a.showArchived;resetPage('groups');await persist();render();return;}
 if(act==='bulk-assign'){await bulkAssignment();return;}
 if(act==='test-access')return openTestAccess(tid);
 if(act==='new-intake')return openNewIntake();
 if(act==='resume-intake')return runIntake(a.intake?.id);
 if(act==='intake-export')return exportResultsXlsx(true);
 if(act==='export-xlsx')return exportResultsXlsx();
 if(act==='intake-archives')return openIntakeArchives();
 if(act==='download-intake-archive')return downloadIntakeArchive(tid);
 if(act==='archive-group'){const g=S.groups.find(v=>id(v.id)===id(tid));if(!g)throw Error('Групу не знайдено.');return confirmAction(g.archived?'Повернути групу?':'Архівувати групу?',`<strong>${e(g.name)}</strong><p>Курсанти та результати збережуться.${g.archived?' Реєстрація в групу знову стане доступною.':' Нові курсанти не зможуть обрати цю групу.'}</p>`,async()=>{const r=await rpc('POST','/api/instructor/groups/'+encodeURIComponent(g.id)+'/archive',{archived:!g.archived,expectedRevision:g.revision||1});if(id(r.group?.id)!==id(g.id)||r.group.archived===g.archived)throw Error('Сервер не підтвердив зміну групи.');await refresh(true);},g.archived?'Повернути':'Архівувати');}
 if(act==='retry-save'){await retrySave();return;}
 if(act==='sync-conflicts'){
  const conflicts=accountSync.status().conflicts;
  dialog('Зміни з іншого ПК',`<p>Обидві версії збережено. Оберіть, яку продовжити. Копія попередньої версії залишиться на цьому ПК.</p>${conflicts.map(({key,document:d})=>`<section class="panel"><strong>${e(key==='test-draft'?'Чернетка тесту':key==='training'?'Тренування':'Перевірка роботи №'+key.slice(8))}</strong><p>Інший ПК: ${e(date(d.updatedAt))}${d.value?.title?' · '+e(d.value.title):''}</p><div class="actions"><button type="button" data-action="sync-use-local" data-id="${e(key)}">Зберегти цю версію</button><button type="button" data-action="sync-use-remote" data-id="${e(key)}">Продовжити з іншого ПК</button></div></section>`).join('')}`,()=>{},'Закрити');return;
 }
 if(act==='sync-use-local'||act==='sync-use-remote'){await accountSync.resolve(tid,act==='sync-use-local'?'local':'remote');modal.close();render();return;}
 if(act==='sync'){await syncQueue(true);toast(a.pending.length?'Результати залишаються у черзі.':'Чергу надіслано.');return;}
 if(act==='logout'){
  await persist();await syncQueue(true);await accountSync.sync(true);
  const leave=async()=>{void reviewPresence.stop();await materials.close();await persist();if(typeof secureStorage!=='undefined'&&secureStorage.enabled){await secureStorage.collect().catch(()=>{});try{await secureStorage.lock();}catch(error){if(!secureStorage.status().locked)throw error;toast(error.message);}S.accounts={};checkpoint=null;}S.session=null;resetSessionViews();accountSync.reset();examSession.reset();page='home';lastError='';try{await persist();}finally{render();}};
  const cloud=accountSync.status();if(cloud.pending||cloud.conflicts.length||account().pending.length||(!instructor()&&examSession.status().pending))return confirmAction('Зміни ще не надіслані','На іншому ПК ці зміни з’являться після синхронізації. Локальна копія залишиться тут. Вийти зараз?',leave,'Вийти');await leave();return;
 }
 if(act==='new-test'){if(a.draft){page='editor';toast('Відкрито вашу незавершену чернетку.');}else{a.draft=C.newDraft();await persist();page='editor';}render();return;}
 if(act==='edit-draft'){a.draft??=C.newDraft();await persist();page='editor';render();restoreWorkPosition();return;}
 if(act==='discard-draft')return confirmAction('Видалити чернетку?','Чернетку буде видалено з акаунта після синхронізації. Опубліковані тести збережуться.',async()=>{a.draft=null;await persist();page='tests';render();},'Видалити');
 if(act==='import')return importTest();
 if(act==='sample-office')return sampleOffice(button.dataset.format);
 if(act==='sample-json')return download(JSON.stringify({test:C.draftAPI({...C.newDraft(),title:'Зразок тесту',questions:[{id:'0',text:'Скільки секунд в одній хвилині?',answers:['10','30','60','100'].map((text,i)=>({id:'0',text,isCorrect:i===2}))}]})},null,2),'FPV-test-zrazok.json','application/json');
 if(act==='group-statement')return openGroupStatement();
 if(act==='export-test')return download(JSON.stringify({application:'FPV Комісія',version:3,test:C.draftAPI(a.draft)},null,2),'FPV-test.json','application/json');
 if(act==='export-csv')return download(C.resultCSV(filteredResults()),'FPV-results.csv','text/csv;charset=utf-8');
 if(act==='export-ranking'){if(!instructor())return;const ranking=groupRanking();if(!ranking)throw Error('Оберіть групу для рейтингу.');if(a.resultTotal>a.results.length)throw Error('Спочатку оновіть повну історію результатів.');return download(rankingCSV(ranking),'FPV-ranking.csv','text/csv;charset=utf-8');}
 if(act==='preview'){preview=await fetchTest(tid,true);page='preview';render();return;}
 if(act==='edit-test'){const t=await fetchTest(tid,true);const apply=async()=>{a.draft=C.draftFrom(t,tid);await persist();page='editor';render();};if(a.draft)return confirmAction('Відкрити інший тест?','Наявну чернетку буде замінено після синхронізації. За потреби спершу експортуйте її в JSON.',apply);return apply();}
 if(act==='delete-test')return confirmAction('Видалити тест?','Тест стане недоступним для курсантів. Сервер збереже історію вже отриманих результатів.',async()=>{await rpc('DELETE','/api/instructor/tests/'+encodeURIComponent(tid));delete a.fullTests[id(tid)];await refresh(true);},'Видалити');
 if(act==='publish-test')return publish(true);
 if(act==='cloud-draft')return publish(false);
 if(act==='add-question'){if(a.draft.questions.length>=200)throw Error('Максимум 200 питань.');a.draft.questions.push(C.blankQuestion());}
 else if(act==='move-question'){const target=q+Number(button.dataset.direction);if(target>=0&&target<a.draft.questions.length){const item=a.draft.questions.splice(q,1)[0];a.draft.questions.splice(target,0,item);}}
 else if(act==='copy-question'){if(a.draft.questions.length>=200)throw Error('Максимум 200 питань.');a.draft.questions.splice(q+1,0,structuredClone(a.draft.questions[q]));}
 else if(act==='delete-question'){a.draft.questions.splice(q,1);if(!a.draft.questions.length)a.draft.questions.push(C.blankQuestion());}
 else if(act==='add-answer'){if(a.draft.questions[q].answers.length>=6)throw Error('Максимум 6 відповідей у питанні.');a.draft.questions[q].answers.push({id:'0',text:'',isCorrect:false});}
 else if(act==='delete-answer'){const answers=a.draft.questions[q].answers;if(answers.length<=2)throw Error('Потрібні щонайменше дві відповіді.');answers.splice(j,1);}
  else if(act==='bank-save')return saveBankQuestion(q);
  else if(act==='bank-add'){if(!instructor())throw Error('Банк питань доступний лише інструктору.');const source=bank.find(v=>id(v.id)===id(tid));if(!source?.question)throw Error('Питання банку не знайдено. Оновіть список.');if(a.draft?.questions.length>=200)throw Error('Максимум 200 питань.');const question=structuredClone(source.question),error=C.validateDraft({...C.newDraft(),title:'Питання банку',questions:[question]});if(error)throw Error(error);a.draft??=C.newDraft();question.id='0';question.answers.forEach(v=>v.id='0');if(a.draft.questions.length===1&&!a.draft.questions[0].text)a.draft.questions=[];a.draft.questions.push(question);a.draft.localRevision=(a.draft.localRevision||0)+1;await persist();toast('Питання додано до чернетки.');return;}
 else if(act==='add-group')return dialog('Нова навчальна група','<label class="field">Назва<input name="name" required maxlength="80" autofocus></label>',async d=>{await rpc('POST','/api/instructor/groups',{name:d.name.trim()});await refresh(true);});
 else if(act==='delete-group')return confirmAction('Видалити групу?','Сервер перевірить, чи групу можна видалити без втрати облікових записів і результатів.',async()=>{await rpc('DELETE','/api/instructor/groups/'+encodeURIComponent(tid));await refresh(true);},'Видалити');
 else if(act==='add-cadet')return dialog('Додати курсанта',`<label class="field">ПІБ<input name="fullName" required maxlength="160"></label><label class="field">Логін<input name="username" required maxlength="80" autocomplete="off"></label><label class="field">Група<select name="groupName" required>${groupOptions()}</select></label><label class="field">Пароль<input type="password" name="password" required minlength="6" autocomplete="new-password"></label>`,async d=>{const password=d.password;delete d.password;await rpc('POST','/api/instructor/users',{...d,...await C.credential(password)});await refresh(true);});
 else if(act==='cadet-group'){
  const session=S.session,u=a.cadets.find(u=>id(u.id)===id(tid));
  if(!u)throw Error('Курсанта не знайдено. Оновіть список.');
  const targets=S.groups.filter(g=>!g.archived&&g.name!==u.groupName);
  if(!targets.length)throw Error('Спочатку створіть іншу активну навчальну групу.');
  return dialog('Змінити групу курсанта',`<p><strong>${e(u.fullName)}</strong><br>Логін: ${e(u.username)}<br>Поточна група: ${e(u.groupName)}</p><label class="field">Нова група<select name="groupId" required><option value="">Оберіть групу</option>${targets.map(g=>`<option value="${e(g.id)}">${e(g.name)}</option>`).join('')}</select></label><p>Логін, пароль і результати збережуться. У старих результатах залишиться група на момент проходження. Нові тести й матеріали визначатимуться новою групою.</p><p>Перед переведенням курсант має завершити поточний тест і надіслати результати з черги.</p>`,async d=>{
   const target=targets.find(g=>id(g.id)===id(d.groupId));if(!target)throw Error('Оберіть групу зі списку.');
   let response;try{response=await rpc('POST','/api/instructor/users/'+encodeURIComponent(tid)+'/group',{groupId:target.id,expectedGroupName:u.groupName},session.token);}
   catch(x){if(x.code==='NOT_FOUND')throw Error('Для зміни групи оновіть серверний Код.gs до версії 3.2.1.');if(x.code==='REVISION_CONFLICT'){modal.close();await refresh(true);}throw x;}
   if(S.session?.token!==session.token)return;
   const updated=C.transferredCadet(response,u,target);a.cadets=a.cadets.map(v=>id(v.id)===id(tid)?updated:v);
   await persist();render();await refresh(true);toast('Курсанта переведено до групи «'+target.name+'».');
  },'Перевести');
 }
 else if(act==='cadet-status')return confirmAction(button.dataset.active==='true'?'Увімкнути обліковий запис?':'Вимкнути обліковий запис?','Зміна доступу застосовується на всіх ПК.',async()=>{await rpc('POST','/api/instructor/users/'+encodeURIComponent(tid)+'/status',{active:button.dataset.active==='true'});await refresh(true);});
 else if(act==='cadet-password')return dialog('Новий пароль курсанта','<p>Попередні сеанси курсанта завершаться на всіх пристроях.</p><label class="field">Новий пароль<input type="password" name="password" required minlength="6" autocomplete="new-password"></label>',async d=>{await rpc('POST','/api/instructor/users/'+encodeURIComponent(tid)+'/password',await C.credential(d.password));toast('Пароль змінено.');});
 else if(act==='delete-cadet'){
  if(!instructor())return;
  const session=S.session,cadetId=id(tid),u=a.cadets.find(cadet=>id(cadet.id)===cadetId);
  if(!u)throw Error('Курсанта не знайдено. Оновіть список.');
  return confirmAction('Видалити курсанта повністю?',`<strong>${e(u.fullName)}</strong><br>Логін: ${e(u.username)}<br>Група: ${e(u.groupName)}<br><br>Акаунт, усі проходження й відповіді буде видалено із застосунка, а результати також зі спільної Google Таблиці. Цю дію неможливо скасувати.`,async()=>{
   let r;
   try{r=await rpc('DELETE','/api/instructor/users/'+encodeURIComponent(cadetId),{confirmUserId:cadetId},session.token);}
   catch(x){if(S.session?.token!==session.token)return;if(x.code==='NOT_FOUND')x.message='Оновіть серверний Code.gs, щоб увімкнути повне видалення.';await refresh(true);throw x;}
   if(S.session?.token!==session.token)return;
   if(r.deleted!==true||id(r.userId)!==cadetId)throw Error('Сервер не підтвердив видалення цього курсанта. Оновіть дані й перевірте обліковий запис.');
   forgetCadetResults(a,new Set([cadetId]),Array.isArray(r.resultIds)?r.resultIds:[]);
   a.cadets=a.cadets.filter(cadet=>id(cadet.id)!==cadetId);
   a.resultWriteVersion=(a.resultWriteVersion||0)+1;
   delete a.workspaceRevisions?.cadets;
   delete a.workspaceRevisions?.results;
   delete a.fullResultsRevision;
   delete S.accounts[cadetId];
   await persist();render();toast('Акаунт курсанта й результати видалено, спільну Google Таблицю очищено.');await refresh(true);
  },'Видалити повністю');
 }

 else if(act==='review-result'){const result=a.results.find(r=>id(r.id)===id(tid)&&id(r.userId)===id(user().id));if(!result||instructor())return;const session=S.session;let review=a.reviews[id(result.id)]||[];try{const response=await rpc('GET','/api/results/'+encodeURIComponent(result.id)+'/review');if(S.session?.token!==session.token)return;a.results=C.mergeResults(a.results,[response.result]);review=response.review||[];a.reviews[id(result.id)]=review;Object.assign(result,response.result);await persist();}catch(x){if(!review.length)throw x;toast('Показано збережену перевірку. '+x.message);}if(!review.length){toast('Деталі цього старого результату недоступні.');return;}lastResult={result,review,testId:id(result.testId)};page='result';render();return;}
 else if(act==='download')return downloadTest(tid);
 else if(act==='download-all'){let count=0;for(const t of a.tests){if(t.access?.open!==false&&!C.completed(t.id,a.results,a.pending,a.run,a.deletedTestIds)){await fetchTest(t.id,true);count++;}}toast('Завантажено тестів: '+count);render();return;}
 else if(act==='start')return start(tid);
 else if(act==='resume')return resumeRun();
 else if(act==='sync-exam'){await examSession.sync();render();return;}
 else if(act==='handoff-exam'){await examSession.release();page='home';render();document.exitFullscreen?.().catch(()=>{});toast('Спробу збережено. Увійдіть у той самий акаунт на іншому ПК.');return;}
 else if(act==='question'){a.run.index=q;await persist();render();return;}
 else if(act==='prev'||act==='next'){a.run.index+=(act==='prev'?-1:1);await persist();render();return;}
 else if(act==='unanswered'){const r=a.run,n=r.test.questions.length;for(let delta=1;delta<=n;delta++){const i=(r.index+delta)%n;if(!C.answered(r.test.questions[i],r.answers)){r.index=i;await persist();render();return;}}toast('На всі питання вже відповіли.');return;}
 else if(act==='finish')return finishRun();
 else if(act==='open-sheet'){const r=await rpc('GET','/api/instructor/results-sheet');if(!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(r.url))throw Error('Таблицю ще не налаштовано.');window.open(r.url,'_blank','noopener,noreferrer');return;}
 else if(act==='check-update'){await updater.check();return;}
 else if(act==='sync-sheet'){await rpc('POST','/api/instructor/results-sheet/sync');toast('Таблицю оновлено з історії результатів.');return;}
 else if(act==='invite'){const r=await rpc('GET','/api/instructor/invite');if(!r.primary)throw Error('Код може створити лише головний інструктор.');dialog('Код для нового інструктора',`<p>${r.code?e(r.code)+'<br>Діє до '+date(r.expiresAt):'Код ще не створено.'}</p>`,async()=>{const r=await rpc('POST','/api/instructor/invite');modal.querySelector('p').textContent='Код: '+r.code+' · діє до '+date(r.expiresAt);return false;},'Створити новий код');return;}
 else if(act==='analytics'){if(await loadAnalytics()){page='analytics';render();}return;}
 else if(act==='audit'){audit=(await rpc('GET','/api/instructor/audit')).entries||[];page='audit';render();return;}
 else return;
 if(page==='editor'&&a.draft){a.draft.localRevision=(a.draft.localRevision||0)+1;journal({kind:'draft',userId:id(user().id),localId:a.draft.localId,revision:a.draft.localRevision});}
 await persist();render();
}
function setMenu(open,focus=false){
 menuOpen=open;$('.sidebar')?.classList.toggle('menu-open',open);const button=$('[data-action="toggle-menu"]');
 if(button){button.setAttribute('aria-expanded',String(open));button.querySelector('span').textContent=open?'Закрити меню':'Меню';if(focus)button.focus();}
}
document.addEventListener('keydown',event=>{
 const current=event.target.closest?.('.results-switch [role=tab]');if(!current)return;
 const tabs=[...document.querySelectorAll('.results-switch [role=tab]')],index=tabs.indexOf(current);let next;
 if(event.key==='ArrowRight')next=(index+1)%tabs.length;
 else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;
 else if(event.key==='Home')next=0;
 else if(event.key==='End')next=tabs.length-1;
 else return;
 event.preventDefault();tabs[next].click();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menuOpen&&!modal.open){event.preventDefault();setMenu(false,true);}});
window.matchMedia?.('(max-width:900px)').addEventListener('change',()=>setMenu(false));
document.addEventListener('click',event=>{const b=event.target.closest('button[data-action]');if(b&&!b.disabled)clickAction(b).catch(x=>toast(x.message));});
document.addEventListener('submit',event=>{if(event.target.id==='auth-form'){event.preventDefault();authSubmit(event.target);}});
document.addEventListener('input',event=>{
 if(!alive()||updateApplying)return;const el=event.target;
 if(page==='cadet-card')cadetCard.input(el);
 if(el.id==='shared-test-search'&&user()&&instructor()){const a=account(),searches=sharedTestSearches.get(a)||{};searches[page]=el.value;sharedTestSearches.set(a,searches);const choices=sharedTestChoices(page);$('#shared-test').innerHTML=choices.options;$('#shared-test-matches').textContent=choices.hint;return;}
 if(el.id==='filter'){filter=el.value;if(user()&&['tests','cadets'].includes(page)){account().sectionSearches??={};account().sectionSearches[page]=filter;scheduleSave();}resetPage(page);if(page==='results'){if(instructor()){account().resultsSearches??={};account().resultsSearches[resultsView()]=filter;scheduleSave();}resetPage('ranking');resetPage('reviews');$('#results-table').innerHTML=resultsTable();}else if(page==='tests')$('#test-list').innerHTML=testsList();else if(page==='cadets'||page==='more'){const at=el.selectionStart;render();const f=$('#filter');f?.focus();f?.setSelectionRange(at,at);}return;}
 if(!user())return;const a=account(),d=a.draft;
 if(page==='grading'&&grading&&el.dataset.grade){if(!reviewPresence.canEdit()){updateReviewPresenceUI();return;}const item=grading.draft.items[el.dataset.grade]??={points:'',comment:''};item[el.dataset.gradeProp]=el.value;grading.draft.request=null;scheduleSave();return;}
 if(page==='runner'&&el.dataset.runWritten){const r=a.run;if(r.examProtocol===1&&!examSession.editable(r))return;const q=r.test.questions.find(q=>id(q.id)===el.dataset.runWritten);if(!q||!C.isWritten(q))return;if(el.value.length>3000||(C.answerStorageLength(r.test,{...r.answers,[id(q.id)]:el.value})>48000&&C.answerStorageLength(r.test,{...r.answers,[id(q.id)]:el.value})>=C.answerStorageLength(r.test,r.answers))){el.value=r.answers[id(q.id)]??'';toast('До 3000 символів на питання і до 48 000 символів загалом.');return;}r.answers[id(q.id)]=el.value;journal(runCheckpoint());scheduleSave();return;}
 if(page==='editor'&&d){let patch;if(el.dataset.draft){const prop=el.dataset.draft;d[prop]=el.type==='checkbox'?el.checked:el.value;patch={scope:'root',prop,value:d[prop]};if(prop==='mode'){scheduleSave();render();}}
  if(el.dataset.question!==undefined){const value=el.dataset.prop==='maxPoints'?(el.value===''?'':Number(el.value)):el.value;d.questions[+el.dataset.question][el.dataset.prop]=value;patch={scope:'question',q:+el.dataset.question,prop:el.dataset.prop,value};}
  if(el.dataset.answer!==undefined){d.questions[+el.dataset.answer].answers[+el.dataset.a].text=el.value;patch={scope:'answer',q:+el.dataset.answer,a:+el.dataset.a,value:el.value};}
  if(el.dataset.correct!==undefined){const q=d.questions[+el.dataset.correct];if(el.checked&&q.answers.filter(a=>a.isCorrect).length>=2){el.checked=false;toast('Можна позначити максимум дві правильні відповіді.');return;}q.answers[+el.dataset.a].isCorrect=el.checked;patch={scope:'corrects',q:+el.dataset.correct,indices:q.answers.flatMap((a,i)=>a.isCorrect?[i]:[])};}
  if(el.dataset.group){const selected=Array.isArray(d.assignedGroups)?d.assignedGroups:[];d.assignedGroups=el.checked?[...new Set([...selected,el.dataset.group])]:selected.filter(g=>g!==el.dataset.group);patch={scope:'root',prop:'assignedGroups',value:d.assignedGroups};}
  if(patch){d.localRevision=(d.localRevision||0)+1;journal({kind:'draft',userId:id(user().id),localId:d.localId,revision:d.localRevision,patch});}
  refreshImportReview();scheduleSave();
 }
 if(page==='runner'&&el.dataset.runAnswer){const q=a.run.test.questions[a.run.index||0];if(a.run.examProtocol===1&&!examSession.editable(a.run))return;let value;try{value=C.toggleChoice(q,a.run.answers[id(q.id)],el.dataset.runAnswer,el.checked);}catch(x){el.checked=false;toast(x.message);return;}const next={...a.run.answers,[id(q.id)]:value};if(C.answerStorageLength(a.run.test,next)>48000&&C.answerStorageLength(a.run.test,next)>=C.answerStorageLength(a.run.test,a.run.answers)){render();toast('Скоротіть письмові відповіді, щоб додати цей вибір: загальний обсяг перевищує 48 000 символів.');return;}a.run.answers=next;journal(runCheckpoint());scheduleSave();render();}
});
function markAway(){if(updateApplying||!alive()||!user()||away)return;away=true;const r=account().run;if(r?.test.mode==='exam'){r.exitCount++;journal(runCheckpoint());scheduleSave();}}
document.addEventListener('visibilitychange',()=>{if(updateApplying||!alive()||!user())return;if(document.hidden)markAway();else{away=false;getClock().then(()=>tick()).catch(()=>{});if(!account().run)refresh();accountSync.sync(true);}});
window.addEventListener('blur',markAway);
window.addEventListener('focus',()=>{if(!document.hidden)away=false;});
window.addEventListener('beforeunload',event=>{if(!alive())return;if(scheduledSave||journalPending||diskWriter.status().pending||journalError||(user()?.role==='cadet'&&examSession.status().pending)){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{if(diskStateLoaded&&alive()&&!updateApplying){clearTimeout(saveTimer);if(user()&&account().run)checkpoint=stamp(runCheckpoint(account().run.test.mode==='exam'));else if(checkpoint)checkpoint={serial:++S.journalSerial,...Object.fromEntries(Object.entries(checkpoint).filter(([k])=>k!=='serial'))};if(typeof secureStorage!=='undefined'&&secureStorage.enabled){if(checkpoint)secureStorage.beacon(checkpoint);}else{if(checkpoint)navigator.sendBeacon('/journal?key='+encodeURIComponent(key),JSON.stringify(checkpoint));const raw=JSON.stringify(S);if(new TextEncoder().encode(raw).length<60000)navigator.sendBeacon('/state?key='+encodeURIComponent(key),raw);}}});
const updater=createUpdater({local,
 canApply:()=>user()&&account().run?'Оновлення готове. Установимо його автоматично після завершення поточного тесту.':working||refreshing||syncing||updateData.flight||exportResultsXlsx.flight||downloadIntakeArchive.flights?.size||intakeRunning||rpcFlights||modal.open||materials.busy?'Оновлення готове. Чекаємо завершення поточної дії…':'',
 save:async release=>{clearTimeout(saveTimer);S.updateReturnPage='more';S.updateTargetCode=release.code;await journalSaving.catch(()=>{});if(checkpoint){const r=secureStorage.enabled?await secureStorage.saveJournal(checkpoint):await local('/journal',checkpoint);if(r.ok===false)throw Error(r.error||'Не вдалося зберегти дані на диску.');}await persist();},
 freeze:(active,message)=>{updateApplying=active;if(active){modal.close();app.innerHTML=`<div class="boot" role="status">Оновлення застосунку<small>${e(message)}</small></div>`;}else{delete S.updateReturnPage;delete S.updateTargetCode;render();}},
 info:value=>{updateInfo=value;const label=$('#update-message');if(label)label.textContent=value.message;const button=$('button[data-action="check-update"]');if(button)button.disabled=updater.requested||updater.applying;},
 reload:()=>location.reload()
});
async function updateStatus(){if(alive())await updater.status();}
async function init(){
 diskStateLoaded=false;
 try{const raw=typeof secureStorage!=='undefined'?await secureStorage.load():await local('/state');if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.ok===false)throw Error(raw?.error||'Не вдалося прочитати збережені дані.');
 const j=typeof secureStorage!=='undefined'&&secureStorage.enabled?await secureStorage.readJournal():await local('/journal');if(!j||typeof j!=='object'||Array.isArray(j)||j.ok===false)throw Error(j?.error||'Не вдалося прочитати журнал відповідей.');
 S={...S,...raw};if(raw.localResumeWarning)lastError=raw.localResumeWarning;S.accounts??={};S.groups??=[];S.journalSerial=Math.max(S.journalSerial||0,j.serial||0);const restored=C.applyCheckpoint(S,j);diskStateLoaded=true;if(restored)await persist();
 await getClock();if(S.updateReturnPage==='more'){page='more';delete S.updateReturnPage;delete S.updateTargetCode;await persist();}render();updateStatus();if(user()){await recoverRun();await refresh();await syncQueue();}else loadGroups();
 setInterval(()=>{if(alive()&&!updateApplying)updateStatus();},10000);
 timerInterval=setInterval(()=>{if(updateApplying)return;reviewPresence.expire();tick();if(user()?.role==='cadet'&&account().run&&uptime()-lastTimerSaved>=10000){lastTimerSaved=uptime();scheduleSave();}},1000);
 setInterval(()=>{if(alive()&&!updateApplying)getClock().then(()=>tick()).catch(()=>{});},10000);
 setInterval(()=>{if(updateApplying||!alive()||!instructor())return;if(page==='grading')reviewPresence.tick();else if(pendingReviewsPage()&&!document.hidden)pollReviewPresence();},25000);
 setInterval(()=>{if(!updateApplying&&!document.hidden&&alive()){if(user()&&updateData.flight?.token!==S.session.token){syncQueue();if(page!=='runner'&&page!=='editor')refresh();}}},45000+Math.floor(Math.random()*15000));
 setInterval(()=>{if(!updateApplying&&alive()){if(diskWriter.status().error||journalError)retrySave().catch(()=>{});if(user()){if(updateData.flight?.token!==S.session.token){syncQueue();publicTableSync.tick();materials.syncProgress();accountSync.sync();}if(!instructor())examSession.sync().then(()=>{if(page==='home')render();}).catch(()=>{});}}},10000);
 }catch(x){diskStateLoaded=false;window.dispatchEvent(new Event('lk:startup-failed'));if(!document.querySelector('[data-startup-error]'))app.innerHTML=`<div class="boot">Не вдалося відкрити програму<small>${e(x.message)}</small></div>`;}
}
init();
export {account,refresh,persist,syncQueue,finishRun,recoverRun,navigate,clickAction,uptime,authSubmit};

document.addEventListener('change',event=>{const el=event.target;if(user()&&page==='editor'&&el.dataset.questionType!==undefined){const q=account().draft.questions[+el.dataset.questionType];q.type=el.value;if(q.type==='choice'&&q.answers.length<2)q.answers=C.blankQuestion().answers;const d=account().draft;d.localRevision=(d.localRevision||0)+1;journal({kind:'draft',userId:id(user().id),localId:d.localId,revision:d.localRevision,patch:{scope:'question-replace',q:+el.dataset.questionType,value:structuredClone(q)}});scheduleSave();render();return;}if(!user()||!['tests','cadets','results','materials','analytics'].includes(page)||!['shared-group','shared-test'].includes(el.id))return;const scope=page,token=S.session.token,f=sharedFilters(scope);f[el.id==='shared-group'?'groupId':'testId']=el.value;resetPage(scope);if(scope==='results')resetPage('ranking');persist().then(async()=>{if(page!==scope||S.session?.token!==token)return;if(scope==='analytics')await loadAnalytics();if(page!==scope||S.session?.token!==token)return;render();if(scope==='results')refresh(false);}).catch(x=>toast(x.message));});

document.addEventListener('focusin',event=>{if(!user())return;const el=event.target;if(page==='editor'&&account().draft&&el.closest('.question')){const cards=[...document.querySelectorAll('.question')];account().draft.resumeQuestion=cards.indexOf(el.closest('.question'));scheduleSave();}else if(page==='grading'&&grading&&el.dataset.grade){grading.draft.resumeQuestion=el.dataset.grade;scheduleSave();}});

function choiceReview(row,isInstructor=false){const q=C.enrichReview([row],null)[0],correct=C.reviewCorrect(q),skipped=C.reviewSkipped(q),state=correct?'correct':skipped?'skipped':'incorrect',status=correct?'Відповідь правильна.':skipped?'Питання пропущено.':'Відповідь неправильна.';return `<section class="review choice-review ${state}" aria-label="${e(status)}"><strong>${correct?'✓':skipped?'○':'✕'} ${e(q.questionText)}</strong><p class="review-status">${status}</p><p class="selected-answer">${isInstructor?'Відповідь курсанта':'Ваша відповідь'}: ${e(q.selectedAnswerText)}</p><p class="correct-answer">Правильна відповідь: ${e(q.correctAnswerText)}</p>${q.explanation?`<p class="muted">${e(q.explanation)}</p>`:''}</section>`;}
function gradingRecovery(){const previous=grading?.draft.previousItems;if(!previous)return '';const rows=grading.review.filter(C.isWritten).filter(q=>previous[id(q.questionId)]);return rows.length?`<details class="panel grading-recovery"><summary>Попередні незбережені правки</summary><p>Збережені оцінки оновлено. Порівняйте попередні правки з поточними оцінками перед повторним збереженням.</p>${rows.map(q=>{const item=previous[id(q.questionId)];return `<div class="review"><h4>${e(q.questionText)}</h4><p>Бали: ${e(item.points===''?'Не вказано':item.points)}</p><p class="preserve-text">${e(item.comment||'Без коментаря')}</p></div>`;}).join('')}</details>`:'';}
function writtenReview(q){return `<div class="review written-review"><strong>✎ ${e(q.questionText)}</strong><p class="preserve-text">${e(q.text||'Без відповіді')}</p><p>${q.points==null?'Очікує перевірки':`Бали: ${q.points} / ${q.maxPoints}`}</p>${q.comment?`<p class="preserve-text">Коментар: ${e(q.comment)}</p>`:''}${q.reviewerName?`<small>${e(q.reviewerName)} · ${date(q.reviewedAt)}</small>`:''}</div>`;}
function reviewCountBadge(){
 const known=reviewQueueToken===S.session?.token,count=known?reviewQueue.length+examRecoveryQueue.length:0;
 return `<span id="review-count" class="nav-count" ${count?'':'hidden'} title="${reviewQueueError?'Останній підтверджений список. Оновіть для актуального стану.':'Робіт очікує перевірки'}">${count?'· '+count:''}</span>`;
}
function updateReviewCount(){const badge=$('#review-count');if(badge)badge.outerHTML=reviewCountBadge();const tab=$('#pending-review-count');if(tab)tab.outerHTML=pendingReviewBadge();}
function reviewQueueContent(){
 const known=reviewQueueToken===S.session?.token,rows=reviewQueue.filter(matchesResultQuery),recoveries=examRecoveryQueue.filter(matchesResultQuery);
 const banner='<div id="review-queue-status">'+(reviewQueueError?'<div class="notice warn" role="status">'+e(reviewQueueError)+'</div>':'')+'</div>';
 const heading='<div class="results-section-heading"><div><h2>Перевірка робіт</h2><p>Письмові відповіді та збережені іспити для підтвердження.</p></div></div>';
 if(!known)return heading+banner+`<div class="empty" role="status"><h3>${reviewQueueError?'Список робіт не завантажено':'Завантажуємо роботи…'}</h3><p>Натисніть «Оновити дані», щоб отримати актуальні роботи.</p></div>`;
 const items=[...recoveries.map(value=>({kind:'recovery',value})),...rows.map(value=>({kind:'written',value}))],p=paginate('reviews',items);
 const content=p.items.map(({kind,value:r})=>kind==='recovery'?`<article class="panel review-queue-item recovery-queue-item"><span class="tag">Підтвердження іспиту</span><h3>${e(r.userName)}</h3><small>${e(r.groupName)}</small><p>${e(r.testTitle)}</p><p class="muted">Збережений іспит · час потребує підтвердження.</p><button data-action="review-recovery" data-id="${e(r.id)}">Переглянути збережену роботу</button></article>`:`<article class="panel review-queue-item"><span class="tag">Письмова робота</span><h3>${e(r.userName)}</h3><small>${e(r.groupName)}</small><p>${e(r.testTitle)}</p><small>${date(r.completedAt)} · Письмових без оцінки: ${r.pendingWritten}</small><div data-review-presence="${e(r.id)}">${reviewPresenceMarkup(queueReviewPresence(r),{queue:true})}</div><button data-action="grade-result" data-id="${e(r.id)}">${queueReviewPresence(r)?.state==='busy'?'Переглянути':'Почати перевірку'}</button></article>`).join('');
 return heading+banner+(items.length?`<div class="review-queue-grid">${content}</div><p class="search-note">Робіт у списку: ${items.length}. Оцінки та коментарі зберігаються окремо для кожної роботи.</p>`+p.controls:empty('Немає неперевірених робіт','Перевірте вибрану групу, тест і пошуковий запит.'));
}

function examRecoveryNotices(){
 const pending=(account().examRecoveries||[]).filter(r=>r.status==='pending');
 return pending.length?`<section class="notice"><strong>Очікують підтвердження інструктора: ${pending.length}</strong>${pending.map(r=>`<p>${e(r.testTitle)} · відповіді збережено на сервері. Після підтвердження тут з’явиться результат.</p>`).join('')}</section>`:'';
}
async function openExamRecovery(recoveryId){
 const token=S.session.token,reply=await rpc('GET','/api/instructor/exam-recoveries/'+encodeURIComponent(recoveryId));
 if(S.session?.token!==token)return;
 const r=reply.recovery;if(!r||id(r.id)!==id(recoveryId)||!Array.isArray(reply.review))throw Error('Сервер повернув некоректну роботу.');
 dialog('Підтвердження збереженого іспиту',`<p><strong>${e(r.userName)}</strong> · ${e(r.groupName)}</p><p>${e(r.testTitle)}</p><div class="notice warn">Цю роботу завершено попереднім способом. Заявлений час: ${time(r.durationSeconds)}. Серверний таймер його не перевіряв. Підтвердження додасть роботу до результатів комісії.</div>${reply.review.map(q=>C.isWritten(q)?writtenReview(q):choiceReview(q,true)).join('')}`,async()=>{
  if(S.session?.token!==token)return false;
  const accepted=await rpc('POST','/api/instructor/exam-recoveries/'+encodeURIComponent(recoveryId)+'/approve',{confirmTimeUnverified:true},token);
  if(S.session?.token!==token)return false;
  C.validateResult(accepted.result,r.userId,r.testId);account().results=C.mergeResults(account().results,[accepted.result]);await persist();await loadReviewQueue();toast('Роботу підтверджено. Результат збережено.');
 },'Підтвердити роботу');
}
async function loadReviewQueue(quiet=false,background=false,force=false){
 const token=S.session?.token;if(!token||!instructor()||(quiet&&!background&&!pendingReviewsPage()))return;
 if(background&&!force&&reviewQueueToken===token&&Date.now()-reviewQueueUpdatedAt<30000)return;
 if(reviewQueueFlight?.token===token)return reviewQueueFlight.promise;
 const flight={token,promise:null};reviewQueueFlight=flight;
 const resultVersion=account().resultWriteVersion||0;
 flight.promise=(async()=>{const sentAt=performance.now();try{
  const r=await rpc('GET','/api/instructor/reviews',{},token);if(S.session?.token!==token)return;
  let extra;try{extra=await rpc('GET','/api/instructor/exam-recoveries',{},token);}catch(x){if(x.code!=='NOT_FOUND')throw x;extra={recoveries:[]};}
  if(S.session?.token!==token)return;
  if((account().resultWriteVersion||0)!==resultVersion){
   setTimeout(()=>{if(S.session?.token===token)void loadReviewQueue(true,true,true);},0);
   return;
  }
  reviewQueue=r.results||[];reviewQueueAt=sentAt;reviewQueueRevision=r.resultsRevision??null;reviewQueueError='';examRecoveryQueue=extra.recoveries||[];reviewQueueToken=token;reviewQueueUpdatedAt=Date.now();updateReviewCount();if(pendingReviewsPage())render();
 }catch(x){if(S.session?.token!==token)return;reviewQueueError='Не вдалося оновити список. Поточний статус перевірок не підтверджено.';updateReviewCount();if(pendingReviewsPage())render();if(!quiet)throw x;
 }finally{if(reviewQueueFlight===flight)reviewQueueFlight=null;}})();return flight.promise;
}
async function pollReviewPresence(){
 const token=S.session?.token;if(!token||!instructor()||!pendingReviewsPage()||performance.now()<reviewPollUnavailableUntil)return;
 if(reviewPollFlight?.token===token)return;
 const flight={token},sentAt=performance.now();reviewPollFlight=flight;
 try{
  const r=await rpc('GET','/api/instructor/review-presence',{},token);
  if(S.session?.token!==token||!pendingReviewsPage())return;
  if(!Array.isArray(r.sessions)||!Number.isFinite(r.serverNow)||typeof r.resultsRevision!=='string')throw Error('Некоректний стан перевірок.');
  if(!r.stable)throw Error('Оцінки оновлюються. Статус буде перевірено повторно.');
  if(r.resultsRevision!==reviewQueueRevision)return await loadReviewQueue(true);
  const sessions=new Map(r.sessions.map(v=>[String(v.resultId),v]));
  for(const row of reviewQueue)row.reviewPresence=sessions.get(String(row.id))||{state:'free',serverNow:r.serverNow};
  reviewQueueAt=sentAt;reviewQueueError='';updateReviewQueuePresenceUI();
 }catch(error){
  if(S.session?.token!==token)return;
  if(error.code==='NOT_FOUND'){reviewPollUnavailableUntil=performance.now()+300000;return;}
  reviewQueueError='Статуси перевірок не оновлено. Перед початком роботи сервер перевірить доступ.';updateReviewQueuePresenceUI();
 }finally{if(reviewPollFlight===flight)reviewPollFlight=null;}
}
function updateReviewQueuePresenceUI(){
 if(!pendingReviewsPage())return;
 const banner=$('#review-queue-status');if(banner)banner.innerHTML=reviewQueueError?'<div class="notice warn" role="status">'+e(reviewQueueError)+'</div>':'';
 const rows=new Map(reviewQueue.map(r=>[String(r.id),r]));
 document.querySelectorAll('[data-review-presence]').forEach(el=>{const r=rows.get(el.dataset.reviewPresence);if(!r)return;const value=queueReviewPresence(r);el.innerHTML=reviewPresenceMarkup(value,{queue:true});const button=el.parentElement.querySelector('[data-action="grade-result"]');if(button)button.textContent=value?.state==='busy'?'Переглянути':'Почати перевірку';});
}
function queueReviewPresence(result){const value=result.reviewPresence;if(reviewQueueError)return {state:'unknown'};if(value?.expiresAt&&performance.now()-reviewQueueAt>=value.expiresAt-value.serverNow)return {state:'unknown'};return value;}
function updateReviewPresenceUI(){
 if(page!=='grading'||!grading)return;
 const box=$('#review-presence-status');if(box)box.innerHTML=reviewPresenceMarkup(reviewPresence.status());
 const blocked=working||!reviewPresence.canEdit();document.querySelectorAll('[data-grade],[data-action="save-grades"]').forEach(el=>{el.disabled=blocked;});
}

async function openGrading(resultId,reload=false){if(!instructor())return;const origin=page==='grading'?grading?.origin:page==='cadet-card'?{page:'cadet-card',cadetId:id(account().openCadetId),filter:''}:page==='results'?{view:resultsView(),filter}:null;const token=S.session.token;const r=await reviewPresence.open(resultId);if(!r||S.session?.token!==token)return;const a=account(),review=C.enrichReview(r.review,null),written=review.filter(C.isWritten);a.gradingDrafts??={};let draft=a.gradingDrafts[id(resultId)];if(!written.length){delete a.gradingDrafts[id(resultId)];draft={items:{}};}else if(reload||!draft||draft.revision!==r.result.gradingRevision){const items=Object.fromEntries(written.map(q=>[id(q.questionId),{points:q.points==null?'':String(q.points),comment:q.comment||''}])),previousItems={...(draft?.previousItems||{})};for(const [qid,item] of Object.entries(draft?.items||{})){const saved=items[qid];if(saved&&(String(item.points??'')!==saved.points||String(item.comment||'')!==saved.comment))previousItems[qid]={points:String(item.points??''),comment:String(item.comment||'')};}draft={revision:r.result.gradingRevision,items,request:null,...(Object.keys(previousItems).length?{previousItems}:{})};a.gradingDrafts[id(resultId)]=draft;}grading={...r,review,draft,origin:origin||{view:written.length?'pending':'compact',filter:''}};page='grading';await persist();render();restoreWorkPosition();}
function gradingScreen(){if(!grading)return empty('Роботу не відкрито');const r=grading.result,hasWritten=grading.review.some(C.isWritten),readOnly=hasWritten&&!reviewPresence.canEdit();return head(hasWritten?'Перевірка письмової роботи':'Перегляд роботи',e(r.userName)+' · '+e(r.groupName)+' · '+e(r.testTitle),`<button data-action="nav" data-page="${grading.origin?.page==='cadet-card'?'cadet-card':'results'}">${grading.origin?.page==='cadet-card'?'← До картки':'← До списку'}</button>`)+`<div class="notice">${e(C.resultLabel(r))} · правильних з вибором: ${r.correct}/${C.choiceCount(r)} · бали: ${r.earnedPoints}/${r.maxPoints}.${hasWritten?' Чернетка перевірки зберігається в акаунті після синхронізації.':''}</div>`+(hasWritten?'<div id="review-presence-status">'+reviewPresenceMarkup(reviewPresence.status())+'</div>':'')+gradingRecovery()+(grading.review||[]).map(q=>!C.isWritten(q)?choiceReview(q,true):`<section class="panel grading-question"><h3>${e(q.questionText)}</h3><h4>Відповідь курсанта</h4><p class="preserve-text">${e(q.text||'Без відповіді')}</p>${q.rubric?`<details><summary>Зразок відповіді / критерії</summary><p class="preserve-text">${e(q.rubric)}</p></details>`:''}<label class="field">Бали (0–${q.maxPoints})<input type="number" min="0" max="${q.maxPoints}" step="1" data-grade="${e(q.questionId)}" data-grade-prop="points" value="${e(grading.draft.items[id(q.questionId)]?.points??'')}" ${working||readOnly?'disabled':''}></label><label class="field">Коментар<textarea maxlength="1000" data-grade="${e(q.questionId)}" data-grade-prop="comment" ${working||readOnly?'disabled':''}>${e(grading.draft.items[id(q.questionId)]?.comment||'')}</textarea></label></section>`).join('')+(hasWritten?`<div class="actions"><button class="primary" data-action="save-grades" ${working||readOnly?'disabled':''}>${working?'Зберігаємо…':'Зберегти перевірку'}</button><button data-action="reload-grading" ${working||readOnly?'disabled':''}>Завантажити збережені оцінки</button></div><p>Порожнє поле балів означає «ще не перевірено». Можна зберегти частину оцінок.</p>`:'');}
async function saveGrading(){if(!grading||working)return;reviewPresence.credentials();const session=S.session,source=grading,d=source.draft;const grades=source.review.filter(C.isWritten).filter(q=>String(d.items[id(q.questionId)]?.points??'').trim()!=='').map(q=>{const v=d.items[id(q.questionId)],points=Number(v.points);if(!Number.isInteger(points)||points<0||points>q.maxPoints)throw Error('Перевірте бали за кожне питання.');return {questionId:q.questionId,points,comment:v.comment||''};});if(!grades.length)throw Error('Укажіть хоча б одну оцінку.');d.request??={expectedRevision:d.revision,requestId:crypto.randomUUID(),grades};await persist();working=true;render();try{const r=await rpc('POST','/api/instructor/results/'+encodeURIComponent(source.result.id)+'/grade',{...d.request,reviewLease:reviewPresence.credentials()},session.token);if(S.session?.token!==session.token)return;C.validateResult(r.result,source.result.userId,source.result.testId);account().resultWriteVersion=(account().resultWriteVersion||0)+1;if(C.pendingReview(r.result)){d.revision=r.result.gradingRevision;d.request=null;}else delete account().gradingDrafts[id(source.result.id)];account().results=C.mergeResults(account().results,[r.result]);void reviewPresence.stop(source.result.id);grading=null;page=source.origin?.page==='cadet-card'?'cadet-card':'results';if(page==='cadet-card')account().openCadetId=source.origin.cadetId;if(page==='results')account().resultsView=source.origin?.view||'pending';filter=source.origin?.filter||'';reviewQueue=reviewQueue.filter(v=>id(v.id)!==id(r.result.id));if(C.pendingReview(r.result))reviewQueue.push(r.result);await persist();toast(C.pendingReview(r.result)?'Частину оцінок збережено.':'Роботу перевірено. Результат доступний курсанту.');await loadReviewQueue();if(page==='cadet-card')await cadetCard.load();}catch(x){if(['REVIEW_IN_PROGRESS','REVIEW_LEASE_EXPIRED'].includes(x.code))reviewPresence.invalidate(x);if(x.code==='REVISION_CONFLICT')x.message+=' Натисніть «Завантажити збережені оцінки».';throw x;}finally{working=false;render();}}

