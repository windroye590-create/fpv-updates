// Learning materials. PDF bytes are encrypted separately from the small DPAPI-backed app state.
export const MAX_PDF_BYTES=8*1024*1024,PART_BYTES=24576;
const enc=new TextEncoder();
export const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
const b64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
const unb64=s=>Uint8Array.from(atob(s),v=>v.charCodeAt(0));
export async function validatePDF(bytes,m=null){
 if(bytes.length<12||bytes.length>MAX_PDF_BYTES||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-'||!new TextDecoder().decode(bytes.slice(-2048)).includes('%%EOF'))throw Error('Оберіть PDF до 8 МБ, збережений без пароля.');
 const digest=await sha(bytes);if(m&&(m.size!==bytes.length||m.sha256!==digest))throw Error('PDF пошкоджено під час завантаження. Повторіть спробу.');return digest;
}
let dbPromise,pdfjsPromise;
async function db(){return dbPromise??=new Promise((resolve,reject)=>{const q=indexedDB.open('fpv-materials-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('pdf');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(Error('Не вдалося відкрити сховище PDF.'));});}
async function entry(mode,key,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('pdf',mode==='get'?'readonly':'readwrite'),s=t.objectStore('pdf');const q=mode==='get'?s.get(key):mode==='put'?s.put(value,key):s.delete(key);let result;q.onsuccess=()=>result=q.result;t.oncomplete=()=>resolve(result);t.onerror=()=>reject(Error('Не вдалося зберегти PDF. Перевірте вільне місце.'));t.onabort=t.onerror;});}
async function pdfLibrary(){return pdfjsPromise??=import('./vendor/pdfjs/build/pdf.mjs').then(p=>{p.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';return p;});}
async function loadPDF(bytes){
 const p=await pdfLibrary();const task=p.getDocument({data:bytes.slice(),isEvalSupported:false,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/'});
 task.onPassword=()=>task.destroy();
 try{const doc=await task.promise;if(doc.numPages<1||doc.numPages>500){await doc.loadingTask.destroy();throw Error('PDF має містити від 1 до 500 сторінок.');}return doc;}catch{throw Error('Не вдалося прочитати PDF. Збережіть файл без пароля, до 500 сторінок.');}
}
export function createMaterials(ctx){
 const {account,session,rpc,persist,toast,render,dialog,confirmAction,modal,esc:e,groups,tests,startTest}=ctx;
 let error='',busy=false,viewer=null,progressTimer,loadSerial=0,lastBytes=null,progressFlight=null;
 const same=s=>ctx.alive()&&session()?.token===s.token;
 const guard=s=>{if(!same(s))throw Error('Обліковий запис змінився. Відкрийте матеріал знову.');};
 const state=()=>{const a=account();a.materials??=[];a.materialProgress??={};a.materialSaved??={};return a;};
 const cacheId=(s,m)=>`${s.user.id}/${m.id}/${m.revision}/${m.sha256}`;
 async function cacheKey(a){if(!a.materialKey){a.materialKey=b64(crypto.getRandomValues(new Uint8Array(32)));await persist();}return crypto.subtle.importKey('raw',unb64(a.materialKey),'AES-GCM',false,['encrypt','decrypt']);}
 async function getSaved(s,a,m){const id=cacheId(s,m),v=await entry('get',id);if(!v)return null;try{const key=await cacheKey(a);const bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:v.iv,additionalData:enc.encode(id)},key,v.data));await validatePDF(bytes,m);guard(s);return bytes;}catch{await entry('delete',id);delete a.materialSaved[m.id];await persist();throw Error('Збережений PDF пошкоджений. Підключіться до інтернету й завантажте його знову.');}}
 async function saveBytes(s,a,m,bytes){const id=cacheId(s,m),iv=crypto.getRandomValues(new Uint8Array(12)),key=await cacheKey(a);guard(s);const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(id)},key,bytes);await entry('put',id,{iv,data});guard(s);a.materialSaved[m.id]={revision:m.revision,sha256:m.sha256};await persist();}
 async function removeSaved(s,a,m,save=true){if(lastBytes?.id===cacheId(s,m))lastBytes=null;await entry('delete',cacheId(s,m));delete a.materialSaved[m.id];if(save)await persist();}
 async function flushProgress(){
  if(progressFlight)return progressFlight;
  progressFlight=sendProgress();try{return await progressFlight;}finally{progressFlight=null;}
 }
 async function sendProgress(){
  const s=session();if(!s||s.user.role!=='cadet')return;const a=state();
  for(const [id,p]of Object.entries(a.materialProgress)){if(!p.pending)continue;try{await rpc('POST',`/api/materials/${encodeURIComponent(id)}/progress`,p,s.token);guard(s);if(a.materialProgress[id]===p){a.materialProgress[id]={...p,pending:false};await persist();}}catch{return;}}
 }
 async function refresh(){
  const s=session(),a=state();if(!s)return;
  try{
   const r=await rpc('GET','/api/materials',{},s.token);guard(s);error='';const items=r.materials||[];
   const current=new Map(items.map(m=>[m.id,m]));
   for(const old of a.materials){const fresh=current.get(old.id);if(!fresh||fresh.revision!==old.revision||fresh.sha256!==old.sha256){await removeSaved(s,a,old,false);delete a.materialProgress[old.id];}}
   a.materials=items;
   if(viewer&&viewer.s.token===s.token&&!items.some(m=>m.id===viewer.m.id&&m.revision===viewer.m.revision)){await closeViewer();toast('Матеріал змінено або доступ скасовано. Відкрийте актуальну версію зі списку.');}
   for(const p of r.progress||[]){const old=a.materialProgress[p.materialId];if(!old?.pending||old.revision!==p.revision)a.materialProgress[p.materialId]={...p,pending:false};}
   await persist();flushProgress();
  }catch(x){if(same(s)){error=x.code==='NOT_FOUND'?'Для навчальних матеріалів потрібно оновити серверний Код.gs до API v8.':x.message;}throw x;}
 }
 async function openList(){try{await refresh();}catch{}render();}
 function html(){
  const a=state(),instructor=session().user.role==='instructor',filter=a.sectionSearches?.materials||'',q=filter.toLocaleLowerCase('uk-UA'),p=ctx.paginate('materials',a.materials.filter(m=>(!ctx.matches||ctx.matches(m))&&(!q||(m.title+' '+m.topic).toLocaleLowerCase('uk-UA').includes(q)))),items=p.items,groupNames=new Map(groups().map(g=>[String(g.id),g.name]));
  return `<div class="page-head"><div><h1>Навчальні матеріали</h1><p>Презентації та посібники. PDF до 8 МБ, до 500 сторінок.</p></div>${instructor?'<button class="primary" data-action="material-new">+ Додати матеріал</button>':''}</div>${ctx.filters?.()||''}${error?`<div class="notice warn">${e(error)} Доступні раніше збережені матеріали.</div>`:''}<label class="field">Тема або назва<input id="material-search" value="${e(filter)}" placeholder="Пошук матеріалів"></label><div class="grid">${items.map(m=>{
   const p=a.materialProgress[m.id],saved=a.materialSaved[m.id]?.revision===m.revision;
   return `<article class="test-card"><span class="tag">${e(m.topic||'Навчальний матеріал')}</span><h3>${e(m.title)}</h3><p>${e(m.description)}</p><small>${m.pageCount} стор. · ${(m.size/1048576).toFixed(1)} МБ${saved?' · Збережено офлайн':''}</small>${p?.revision===m.revision?`<small>Остання сторінка: ${p.lastPage}/${m.pageCount}${p.pending?' · очікує синхронізації':''}</small>`:''}<div class="actions"><button data-action="material-open" data-id="${e(m.id)}">Відкрити</button><button data-action="material-${saved?'remove-offline':'download'}" data-id="${e(m.id)}">${saved?'Прибрати з ПК':'Зберегти для офлайну'}</button></div>${instructor?`<small>Групи: ${e(m.groupIds.map(id=>groupNames.get(String(id))).filter(Boolean).join(', '))}</small><div class="actions"><button data-action="material-edit" data-id="${e(m.id)}">Редагувати</button><button data-action="material-readers" data-id="${e(m.id)}">Перегляди</button><button class="danger" data-action="material-delete" data-id="${e(m.id)}">Видалити</button></div>`:''}</article>`;
  }).join('')}</div>${p.controls}${items.length?'':'<div class="empty"><h3>Матеріалів поки немає</h3><p>Опубліковані інструктором матеріали з’являться тут.</p></div>'}`;
 }
 async function content(m,keep){
  const s=session(),a=state();
  try{
   try{const r=await rpc('GET',`/api/materials/${encodeURIComponent(m.id)}`,{revision:m.revision},s.token);guard(s);if(r.material?.revision!==m.revision||r.material?.sha256!==m.sha256)throw Object.assign(Error('Матеріал змінено. Оновіть список.'),{code:'MATERIAL_CHANGED'});}
   catch(x){if(x.code!=='NOT_FOUND')throw x;await refresh();}
  }catch(x){
   if(['MATERIAL_NOT_FOUND','MATERIAL_CHANGED'].includes(x.code)){await removeSaved(s,a,m);a.materials=a.materials.filter(v=>v.id!==m.id);await persist();}
   if(!['NETWORK','TIMEOUT','HTTP_429','BUSY','HTTP_AUTH','HTTP_500'].includes(x.code))throw x;
  }
  guard(s);const fresh=a.materials.find(v=>v.id===m.id&&v.revision===m.revision&&v.sha256===m.sha256);if(!fresh)throw Error('Матеріал змінено або видалено. Оновіть список.');
  const memoryId=cacheId(s,m);
  if(lastBytes?.token===s.token&&lastBytes.id===memoryId){if(keep&&(a.materialSaved[m.id]?.revision!==m.revision||a.materialSaved[m.id]?.sha256!==m.sha256))await saveBytes(s,a,m,lastBytes.bytes);return lastBytes.bytes;}
  const cached=await getSaved(s,a,m);if(cached)return cached;
  const count=Math.ceil(m.size/PART_BYTES),chunks=new Array(count);let next=0,failed=false;
  const worker=async()=>{while(!failed){const batch=next++,start=batch*16;if(start>=count)return;try{
   const r=await rpc('GET',`/api/materials/${encodeURIComponent(m.id)}/chunks/${batch}`,{revision:m.revision},s.token);guard(s);
   if(r.revision!==m.revision||r.sha256!==m.sha256||r.parts?.length!==Math.min(16,count-start))throw Error('Матеріал оновлено або завантажено не повністю.');
   for(let i=0;i<r.parts.length;i++){const p=r.parts[i];if(p.index!==start+i)throw Error('Пошкоджений порядок сторінок PDF.');const bytes=unb64(p.data);if(bytes.length!==Math.min(PART_BYTES,m.size-(start+i)*PART_BYTES))throw Error('Пошкоджений розмір частини PDF.');chunks[start+i]=bytes;}
  }catch(x){failed=true;throw x;}}};
  const outcomes=await Promise.allSettled([worker(),worker()]);const failure=outcomes.find(v=>v.status==='rejected');if(failure)throw failure.reason;guard(s);
  const bytes=new Uint8Array(m.size);let at=0;for(const b of chunks){if(!b)throw Error('PDF завантажено не повністю.');bytes.set(b,at);at+=b.length;}await validatePDF(bytes,m);guard(s);if(keep)await saveBytes(s,a,m,bytes);lastBytes={token:s.token,id:memoryId,bytes};return bytes;
 }
 function pageSeen(s,m,page){
  if(!same(s)||s.user.role!=='cadet')return;const a=state();if(!a.materials.some(v=>v.id===m.id&&v.revision===m.revision))return;const old=a.materialProgress[m.id];
  if(old?.revision===m.revision&&old.lastPage===page&&old.maxPage>=page)return;
  a.materialProgress[m.id]={materialId:m.id,revision:m.revision,lastPage:page,maxPage:Math.max(page,old?.revision===m.revision?old.maxPage:0),pending:true};
  persist();clearTimeout(progressTimer);progressTimer=setTimeout(flushProgress,1200);
 }
 async function closeViewer(){
  const v=viewer;viewer=null;loadSerial++;if(v?.resizeObserver)v.resizeObserver.disconnect();clearTimeout(v?.resizeTimer);if(v?.renderTask)try{v.renderTask.cancel();}catch{}if(v?.doc)await v.doc.loadingTask.destroy();
  if(document.fullscreenElement?.classList.contains('material-pdf-shell'))await document.exitFullscreen().catch(()=>{});modal.classList.remove('material-viewer');modal.close();flushProgress();render();
 }
 async function showViewer(m,bytes){
  const s=session(),a=state(),doc=await loadPDF(bytes);guard(s);if(doc.numPages!==m.pageCount){await doc.loadingTask.destroy();throw Error('Кількість сторінок PDF не збігається. Завантажте його повторно.');}
  const p=a.materialProgress[m.id],v=viewer={m,s,doc,page:p?.revision===m.revision?Math.max(1,Math.min(m.pageCount,p.lastPage)):1,zoom:1,renderTask:null};
  modal.innerHTML=`<div class="material-pdf-shell"><div class="pdf-header"><h2>${e(m.title)}</h2><button data-action="material-fullscreen">На весь екран</button><button data-action="material-close">Закрити</button></div><div class="pdf-scroll"><canvas id="material-canvas" aria-label="Сторінка презентації"></canvas></div><div class="pdf-controls"><button data-action="material-prev">← Назад</button><span id="material-page"></span><button data-action="material-next">Далі →</button><button data-action="material-minus" aria-label="Зменшити слайд">−</button><span id="material-zoom"></span><button data-action="material-plus" aria-label="Збільшити слайд">+</button>${m.testId&&s.user.role==='cadet'?'<button class="primary" data-action="material-test">Перейти до тесту</button>':''}</div></div>`;
  modal.classList.add('material-viewer');modal.showModal();await drawPage(v);
  if(viewer===v&&typeof ResizeObserver!=='undefined'){
   let previous='';v.resizeObserver=new ResizeObserver(entries=>{const r=entries[0].contentRect,size=Math.round(r.width)+':'+Math.round(r.height);if(size===previous)return;previous=size;clearTimeout(v.resizeTimer);v.resizeTimer=setTimeout(()=>{if(viewer===v)drawPage(v).catch(x=>toast(x.message));},140);});v.resizeObserver.observe(modal.querySelector('.pdf-scroll'));
  }
 }
 async function drawPage(v){
  const serial=++loadSerial;if(v.renderTask){v.renderTask.cancel();try{await v.renderTask.promise;}catch{}}
  const p=await v.doc.getPage(v.page);if(viewer!==v||serial!==loadSerial)return;
  const canvas=modal.querySelector('#material-canvas'),wrap=modal.querySelector('.pdf-scroll'),base=p.getViewport({scale:1}),scale=Math.min((wrap.clientWidth-30)/base.width,(wrap.clientHeight-30)/base.height)*v.zoom;
  const viewport=p.getViewport({scale:Math.max(.1,scale)}),ratio=Math.min(2,window.devicePixelRatio||1,Math.sqrt(8000000/(viewport.width*viewport.height)));
  canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
  v.renderTask=p.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});
  try{await v.renderTask.promise;}catch(x){if(x.name==='RenderingCancelledException')return;throw x;}
  if(viewer!==v||serial!==loadSerial)return;
  modal.querySelector('#material-page').textContent=`${v.page} / ${v.m.pageCount}`;modal.querySelector('#material-zoom').textContent=Math.round(v.zoom*100)+'%';
  modal.querySelector('[data-action=material-prev]').disabled=v.page<=1;modal.querySelector('[data-action=material-next]').disabled=v.page>=v.m.pageCount;
  pageSeen(v.s,v.m,v.page);
 }
 function editor(m={id:'',revision:0,groupIds:[],title:'',description:'',topic:'',testId:'',pageCount:0}){
  const s=session();if(s.user.role!=='instructor')return;let selected=null,checking=false,selection=0;
  dialog(m.id?'Редагувати матеріал':'Новий навчальний матеріал',`<label class="field">Назва<input name="title" required maxlength="160" value="${e(m.title)}"></label><label class="field">Опис<textarea name="description" maxlength="2000">${e(m.description)}</textarea></label><label class="field">Тема / папка<input name="topic" maxlength="80" value="${e(m.topic)}"></label><label class="field">Презентація PDF<input type="file" name="pdf" accept="application/pdf,.pdf" ${m.id?'':'required'}></label><p id="pdf-info">${m.id?`Поточний PDF: ${m.pageCount} стор.`:'Збережіть PowerPoint у PDF. До 8 МБ, 500 сторінок, без пароля.'}</p><canvas id="pdf-preview" style="max-width:100%;max-height:200px;display:none"></canvas><fieldset><legend>Доступ для груп</legend>${groups().map(g=>`<label class="row"><input type="checkbox" name="materialGroup" value="${e(g.id)}" ${m.groupIds.includes(String(g.id))?'checked':''}>${e(g.name)}</label>`).join('')}</fieldset><label class="field">Тест після матеріалу<select name="testId"><option value="">Без тесту</option>${tests().filter(t=>t.published).map(t=>`<option value="${e(t.id)}" ${String(m.testId)===String(t.id)?'selected':''}>${e(t.title)}</option>`).join('')}</select></label>`,async data=>{
   guard(s);if(checking)throw Error('Зачекайте завершення перевірки PDF.');const groupIds=[...modal.querySelectorAll('[name=materialGroup]:checked')].map(el=>el.value);if(!groupIds.length)throw Error('Оберіть хоча б одну групу.');if(!m.id&&!selected)throw Error('Оберіть коректний PDF.');
   if(selected){const pdf=selected;
    await rpc('POST','/api/instructor/material-uploads',{uploadId:pdf.uploadId,size:pdf.bytes.length,sha256:pdf.sha256},s.token);guard(s);
    const count=Math.ceil(pdf.bytes.length/PART_BYTES);
    for(let start=0;start<count;start+=16){const parts=[];for(let i=start;i<Math.min(start+16,count);i++)parts.push({index:i,data:b64(pdf.bytes.slice(i*PART_BYTES,Math.min((i+1)*PART_BYTES,pdf.bytes.length)))});await rpc('POST',`/api/instructor/material-uploads/${pdf.uploadId}/parts`,{parts},s.token);guard(s);modal.querySelector('#pdf-info').textContent=`Завантаження: ${Math.round(Math.min(start+16,count)/count*100)}%`;}
   }
   const body={id:m.id,expectedRevision:m.revision,title:data.title.trim(),description:data.description.trim(),topic:data.topic.trim(),groupIds,testId:data.testId,pageCount:selected?.pages||m.pageCount,...(selected?{uploadId:selected.uploadId}:{})};
   await rpc('POST','/api/instructor/materials',body,s.token);guard(s);await refresh();render();toast('Навчальний матеріал опубліковано.');
  },'Опублікувати');
  const form=modal.querySelector('form'),input=form.elements.pdf;
  input.onchange=async()=>{
   const serial=++selection;selected=null;checking=true;input.setCustomValidity('');const button=form.querySelector('.primary');button.disabled=true;
   try{const f=input.files[0];if(!f||f.size>MAX_PDF_BYTES)throw Error('Оберіть PDF до 8 МБ.');const bytes=new Uint8Array(await f.arrayBuffer()),digest=await validatePDF(bytes),doc=await loadPDF(bytes);guard(s);
    if(serial!==selection||!modal.open){await doc.loadingTask.destroy();return;}const pages=doc.numPages,page=await doc.getPage(1),canvas=form.querySelector('#pdf-preview'),v=page.getViewport({scale:.35});canvas.width=v.width;canvas.height=v.height;await page.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;await doc.loadingTask.destroy();
    if(serial!==selection||!modal.open)return;canvas.style.display='block';selected={bytes,sha256:digest,pages,uploadId:crypto.randomUUID()};form.querySelector('#pdf-info').textContent=`${f.name} · ${pages} стор. · ${(bytes.length/1048576).toFixed(1)} МБ`;
   }catch(x){input.setCustomValidity(x.message);form.querySelector('#pdf-info').textContent=x.message;toast(x.message);}finally{if(serial===selection){checking=false;button.disabled=false;}}
  };
 }
 async function readers(m){const s=session(),r=await rpc('GET',`/api/instructor/materials/${encodeURIComponent(m.id)}/progress`,{},s.token);guard(s);dialog('Перегляди: '+e(m.title),`<p>Відкриття та остання сторінка відображають перегляд. Знання перевіряє тест.</p><div class="table-wrap" tabindex="0" role="region" aria-label="Перегляди матеріалу; таблиця з горизонтальним прокручуванням"><table><thead><tr><th>Курсант</th><th>Група</th><th>Перегляд</th><th>Тест</th></tr></thead><tbody>${(r.readers||[]).map(u=>`<tr><td>${e(u.fullName)}<br><small>${e(u.username)}</small></td><td>${e(u.groupName)}</td><td>${u.lastPage?`${u.lastPage}/${u.pageCount}<br>Дійшов до ${u.maxPage}`:'Ще не відкривав'}</td><td>${u.result?u.result.score+'%':'—'}</td></tr>`).join('')}</tbody></table></div>`,async()=>{},'Закрити');}
 async function action(act,id){
  if(!act.startsWith('material-'))return false;
  const m=state().materials.find(v=>v.id===id);
  if(act==='material-close'){await closeViewer();return true;}
  if(viewer&&act==='material-fullscreen'){if(document.fullscreenElement)await document.exitFullscreen();else await modal.querySelector('.material-pdf-shell').requestFullscreen();await drawPage(viewer);return true;}
  if(viewer&&act==='material-test'){const tid=viewer.m.testId;await closeViewer();await startTest(tid);return true;}
  if(viewer&&['material-next','material-prev','material-plus','material-minus'].includes(act)){const v=viewer;v.page=Math.max(1,Math.min(v.m.pageCount,v.page+(act==='material-next'?1:act==='material-prev'?-1:0)));v.zoom=Math.max(.5,Math.min(3,v.zoom+(act==='material-plus'?.25:act==='material-minus'?-.25:0)));await drawPage(v);return true;}
  if(busy)return true;
  if(act==='material-new'){editor();return true;}
  if(!m)return true;
  if(act==='material-edit'){editor(m);return true;}
  if(act==='material-delete'){confirmAction('Видалити матеріал?',`«${e(m.title)}» стане недоступним курсантам.`,async()=>{await rpc('DELETE',`/api/instructor/materials/${encodeURIComponent(m.id)}`,{expectedRevision:m.revision});await refresh();render();},'Видалити');return true;}
  busy=true;
  try{
   if(act==='material-readers')await readers(m);
   else if(act==='material-remove-offline'){await removeSaved(session(),state(),m);render();toast('Копію PDF прибрано з ПК.');}
   else if(act==='material-open'||act==='material-download'){toast('Завантаження PDF…');const bytes=await content(m,act==='material-download');if(act==='material-download'){toast('Матеріал збережено для перегляду без інтернету.');render();}else await showViewer(m,bytes);}
  }finally{busy=false;}
  return true;
 }
 document.addEventListener('input',ev=>{if(ev.target.id==='material-search'){const at=ev.target.selectionStart;const a=state();a.sectionSearches??={};a.sectionSearches.materials=ev.target.value;ctx.scheduleSave?.();ctx.resetPage('materials');render();const f=document.querySelector('#material-search');f?.focus();f?.setSelectionRange(at,at);}});
 modal.addEventListener('cancel',ev=>{if(viewer){ev.preventDefault();closeViewer();}});
 modal.addEventListener('keydown',ev=>{if(viewer&&['ArrowRight','ArrowLeft'].includes(ev.key)){ev.preventDefault();action(ev.key==='ArrowRight'?'material-next':'material-prev','').catch(x=>toast(x.message));}});
 return {get busy(){return busy||!!progressFlight;},html,openList,refresh,action,close:closeViewer,syncProgress:flushProgress,reset:()=>{lastBytes=null;error='';clearTimeout(progressTimer);if(viewer)void closeViewer().catch(()=>{});}};
}
