import {id,esc,pendingReview,resultLabel} from './core.js';

export function createCadetCard(ctx){
 const states=new WeakMap();
 const state=()=>{const a=ctx.account();if(!states.has(a))states.set(a,{loading:false,saving:false,error:'',serial:0,tab:'results'});return states.get(a);};
 const current=(a,token,uid)=>ctx.session()?.token===token&&ctx.account()===a&&id(a.openCadetId)===uid;
 const data=()=>{const a=ctx.account(),d=a.cadetCardCache;return id(d?.cadet?.id)===id(a.openCadetId)?d:null;};
 const draft=()=>{const a=ctx.account();a.cadetNoteDrafts??={};return a.cadetNoteDrafts[id(a.openCadetId)]??={text:'',requestId:''};};
 const date=value=>value?new Date(value).toLocaleString('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 async function load(){
  const a=ctx.account(),token=ctx.session()?.token,uid=id(a.openCadetId),s=state(),serial=++s.serial,noteWrites=s.noteWrites||0;
  if(!uid||ctx.session()?.user.role!=='instructor')return;
  if(s.uid!==uid){s.uid=uid;s.tab='results';for(const key of ['results','materials','notes','assigned'])ctx.resetPage('cadet-card-'+key);}
  s.loading=true;s.error='';if(ctx.isOpen())ctx.render();
  try{
   const r=await ctx.rpc('GET','/api/instructor/cadets/'+encodeURIComponent(uid),{},token);
   if(!current(a,token,uid)||s.serial!==serial)return;
   if(r.cadetCardProtocol!==1||id(r.cadet?.id)!==uid||r.cadet.role!=='cadet'||!['results','tests','materials','notes','recoveries'].every(k=>Array.isArray(r[k]))||r.results.some(v=>id(v.userId)!==uid)||r.notes.some(v=>id(v.cadetId)!==uid)||r.recoveries.some(v=>id(v.userId)!==uid))throw Error('Сервер повернув некоректну картку курсанта.');
   if((s.noteWrites||0)!==noteWrites)return;
   a.cadetCardCache={cadet:r.cadet,results:r.results,tests:r.tests,materials:r.materials,notes:r.notes,recoveries:r.recoveries,updatedAt:r.updatedAt};
   await ctx.persist();
  }catch(x){if(current(a,token,uid)&&s.serial===serial){s.error=x.code==='NOT_FOUND'?'Курсанта не знайдено або сервер ще не підтримує картку.':x.message;if(['NOT_FOUND','DELETION_PENDING'].includes(x.code))delete a.cadetCardCache;}}
  finally{if(current(a,token,uid)&&s.serial===serial){s.loading=false;if(ctx.isOpen())ctx.render();}}
 }
 function html(){
  const a=ctx.account(),s=state(),d=data(),u=d?.cadet||a.cadets.find(u=>id(u.id)===id(a.openCadetId));
  const header=`<div class="page-head"><div><h1>Картка курсанта</h1><p>${esc(u?.fullName||'Завантажуємо…')}</p></div><div class="actions"><button data-action="nav" data-page="cadets">← До курсантів</button></div></div>`;
  if(!d)return header+(s.error?`<div class="notice warn" role="alert">${esc(s.error)}</div>`:'<p role="status">Завантажуємо історію та навчальні матеріали…</p>');
  const pending=d.results.filter(pendingReview).length,graded=d.results.filter(r=>!pendingReview(r)&&typeof r.score==='number'),passed=graded.filter(r=>r.passed===true).length;
  const stat=(label,value)=>`<div class="stat"><div class="eyebrow">${label}</div><div class="value">${value}</div></div>`;
  return header+`<section class="panel cadet-identity"><div><h2>${esc(u.fullName)}</h2><p>${esc(u.username)} · ${esc(u.groupName||'Без групи')} · ${u.active?'Активний':'Вимкнений'}</p><small>Зареєстровано: ${esc(date(u.createdAt))}</small></div><small role="status">${s.loading?'Оновлюємо картку…':'Оновлено: '+esc(date(d.updatedAt))}</small></section>${s.error?`<div class="notice warn" role="alert">${esc(s.error)} Показано останню збережену картку.</div>`:''}<div class="cards cadet-stats">${stat('Завершених робіт',d.results.length)}${stat('Складено',passed)}${stat('На перевірці',pending)}${stat('Середній бал',graded.length?Math.round(graded.reduce((n,r)=>n+r.score,0)/graded.length)+'%':'—')}</div><div class="results-switch cadet-card-tabs" role="group" aria-label="Розділи картки">${[['results','Тести й результати'],['materials','Матеріали'],['notes','Примітки']].map(([key,label])=>`<button data-action="card-tab" data-tab="${key}" aria-pressed="${s.tab===key}" class="${s.tab===key?'selected':''}">${label}</button>`).join('')}</div><section class="cadet-card-content">${s.tab==='materials'?materialList(d):s.tab==='notes'?noteList(d):resultList(d)}</section>`;
 }
 function resultList(d){
  const done=new Set(d.results.map(r=>id(r.testId))),recovering=new Set(d.recoveries.map(r=>id(r.testId))),remaining=d.tests.filter(t=>!done.has(id(t.id))),p=ctx.paginate('cadet-card-results',d.results),assigned=ctx.paginate('cadet-card-assigned',remaining);
  return `<h2>Історія робіт</h2><p class="muted">Усі роботи цього курсанта, включно з попередніми групами.</p>`+(p.items.length?`<div class="table-wrap" tabindex="0" role="region" aria-label="Історія робіт курсанта"><table><thead><tr><th>Тест</th><th>Дата</th><th>Група під час проходження</th><th>Результат</th><th></th></tr></thead><tbody>${p.items.map(r=>`<tr><td>${esc(r.testTitle)}</td><td>${esc(date(r.completedAt))}</td><td>${esc(r.groupName)}</td><td><span class="tag">${esc(resultLabel(r))}</span>${!pendingReview(r)&&typeof r.score==='number'?`<small>${r.passed===true?'Складено':'Не складено'}</small>`:''}</td><td><button class="small" data-action="card-result" data-id="${esc(r.id)}">${pendingReview(r)?'Перевірити':'Відкрити роботу'}</button></td></tr>`).join('')}</tbody></table></div>${p.controls}`:'<div class="empty"><h3>Завершених робіт ще немає</h3></div>')+`<section class="panel cadet-assigned"><h2>Тести без завершеного результату</h2>${remaining.length?assigned.items.map(t=>`<div class="row"><strong>${esc(t.title)}</strong><span class="tag">${recovering.has(id(t.id))?'Очікує підтвердження іспиту':t.access?.open===false?'Доступ закритий':'Доступний'}</span></div>`).join('')+assigned.controls:'<p>Усі призначені тести мають результат.</p>'}</section>`;
 }
 function materialList(d){const p=ctx.paginate('cadet-card-materials',d.materials);return `<h2>Навчальні матеріали</h2><p class="muted">Перегляд сторінок показує роботу з матеріалом. Знання перевіряє тест.</p><div class="grid">${p.items.map(({material:m,progress:p,assigned})=>`<section class="panel"><h3>${esc(m.title)}</h3><p>${esc(m.topic||'')}</p><p>${p?`Остання сторінка: ${p.lastPage} / ${m.pageCount}<br>Дійшов до сторінки ${p.maxPage}<br><small>Переглядав: ${esc(date(p.updatedAt))}</small>`:'Поточну версію ще не переглядав'}</p>${!assigned?'<small>Матеріал із попередніх призначень</small>':''}</section>`).join('')||'<div class="empty"><h3>Призначених матеріалів ще немає</h3></div>'}</div>${p.controls}`;}
 function noteList(d){const s=state(),v=draft(),p=ctx.paginate('cadet-card-notes',d.notes);return `<h2>Примітки інструкторів</h2><p class="muted">Ці записи бачать інструктори комісії. Курсанту вони не показуються.</p><section class="panel"><label class="field">Нова примітка<textarea id="cadet-note" maxlength="2000" rows="4" ${s.saving?'disabled':''}>${esc(v.text)}</textarea></label><button class="primary" data-action="card-note-save" ${s.saving?'disabled':''}>${s.saving?'Зберігаємо…':'Додати примітку'}</button></section><div class="cadet-note-list">${p.items.map(n=>`<article class="panel"><p class="preserve-text">${esc(n.text)}</p><small>${esc(n.authorName)} · ${esc(date(n.createdAt))}</small></article>`).join('')||'<p class="muted">Приміток поки немає.</p>'}</div>${p.controls}`;}
 async function saveNote(){
  const a=ctx.account(),s=state(),uid=id(a.openCadetId),token=ctx.session()?.token,v=draft(),text=v.text.trim();if(s.saving)return;
  if(!text||text.length>2000)throw Error('Введіть примітку від 1 до 2000 символів.');
  v.requestId||=crypto.randomUUID();const requestId=v.requestId;s.saving=true;ctx.render();
  try{
   await ctx.persist();
   if(!current(a,token,uid))return;
   const r=await ctx.rpc('POST','/api/instructor/cadets/'+encodeURIComponent(uid)+'/notes',{text,requestId},token);
   if(!current(a,token,uid))return;
   if(r.saved!==true||id(r.cadetId)!==uid||r.note?.id!==requestId||r.note.text!==text||id(r.note.authorId)!==id(ctx.session().user.id))throw Error('Сервер не підтвердив збереження примітки.');
   s.noteWrites=(s.noteWrites||0)+1;const d=data();if(d){d.notes=[r.note,...d.notes.filter(n=>n.id!==r.note.id||id(n.authorId)!==id(r.note.authorId))];}
   if(a.cadetNoteDrafts?.[uid]===v)delete a.cadetNoteDrafts[uid];ctx.resetPage('cadet-card-notes');await ctx.persist();ctx.toast('Примітку збережено.');
  }finally{s.saving=false;if(ctx.session()?.token===token&&ctx.account()===a&&ctx.isOpen())ctx.render();}
 }
 async function action(act,button){
  if(!act.startsWith('card-'))return false;
  if(ctx.session()?.user.role!=='instructor')return true;
  if(act==='card-refresh')await load();
  else if(act==='card-tab'&&['results','materials','notes'].includes(button.dataset.tab)){state().tab=button.dataset.tab;ctx.render();document.querySelector(`[data-action="card-tab"][data-tab="${button.dataset.tab}"]`)?.focus({preventScroll:true});}
  else if(act==='card-result'){const r=data()?.results.find(r=>id(r.id)===id(button.dataset.id));if(r)await ctx.openGrading(id(r.id));}
  else if(act==='card-note-save')await saveNote();
  return true;
 }
 function input(el){if(el.id!=='cadet-note'||ctx.session()?.user.role!=='instructor')return;const v=draft();v.text=el.value;v.requestId='';ctx.scheduleSave();}
 return {html,load,action,input,get loading(){return state().loading;},get saving(){return state().saving;}};
}
