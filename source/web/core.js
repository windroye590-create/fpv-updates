export const APP_VERSION='1.0.0';
export const PREVIEW_BUILD=false;
export const CLOUD_URL='https://script.google.com/macros/s/AKfycbx18jQ0GMTxLODwnA7QIe79fEYmy0nLAobGJaYxrUJA4BHUXvpEtai4hj5ZHUqRXyRsPQ/exec';
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const id=v=>String(v??'');
export const LIST_PAGE_SIZE=50;
export function pageSlice(items,index=1){
 const pages=Math.max(1,Math.ceil(items.length/LIST_PAGE_SIZE)),page=Math.max(1,Math.min(pages,Math.floor(Number(index)||1))),start=(page-1)*LIST_PAGE_SIZE;
 return {items:items.slice(start,start+LIST_PAGE_SIZE),page,pages,start:items.length?start+1:0,end:Math.min(start+LIST_PAGE_SIZE,items.length),total:items.length};
}
export function completedTestIds(results,pending,run,recoveries=[],deletedTests=[]){return new Set([...results.map(r=>id(r.testId)),...pending.map(p=>id(p.body.testId)),...recoveries.map(x=>id(x.testId)),...deletedTests.map(id),...(run?[id(run.test.id)]:[])]);}
const bytes=s=>new TextEncoder().encode(s);
export const b64=b=>btoa(Array.from(new Uint8Array(b),v=>String.fromCharCode(v)).join(''));
export const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),v=>v.charCodeAt(0));
export async function keyFor(password,salt){
 const key=await crypto.subtle.importKey('raw',bytes(password),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unb64(salt),iterations:120000,hash:'SHA-256'},key,256));
}
export async function credential(password){const salt=b64(crypto.getRandomValues(new Uint8Array(16)));return {passwordSalt:salt,passwordHash:b64(await keyFor(password,salt))};}
export async function proof(password,salt,nonce){const key=await crypto.subtle.importKey('raw',await keyFor(password,salt),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(await crypto.subtle.sign('HMAC',key,bytes(nonce)));}
export async function signIn(username,password,groupName,request,pause=()=>new Promise(resolve=>setTimeout(resolve,400))){
 const transient=new Set(['CHALLENGE_EXPIRED','NETWORK','TIMEOUT','BUSY','HTTP_408','HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_504']);
 for(let attempt=0;attempt<2;attempt++){
  try{
   const identity={username:username.trim(),groupName};
   const challenge=await request('/api/challenge',identity);
   if(typeof challenge.salt!=='string'||!challenge.salt||typeof challenge.nonce!=='string'||!challenge.nonce)throw Object.assign(Error('Сервер не повернув дані для безпечного входу.'),{code:'BAD_LOGIN_RESPONSE'});
   const value=await proof(password,challenge.salt,challenge.nonce);
   return await request('/api/login',{...identity,nonce:challenge.nonce,proof:value});
  }catch(error){if(attempt!==0||!transient.has(error.code))throw error;await pause();}
 }
}
export function payload(method,path,token='',body={}){if(!['GET','POST','DELETE'].includes(method)||!path.startsWith('/api/')||path.includes('..'))throw Error('Некоректний запит');return {action:'api',method,path,token,body,writtenProtocol:1,choiceProtocol:2,testAccessProtocol:1};}
export function marker(description,name){return String(description??'').match(new RegExp('\\[\\[LK-'+name+':(.*?)\\]\\]'))?.[1]??'';}
export function cleanDescription(d){return String(d??'').replace(/\[\[LK-(?:GROUPS|RANDOM|RETRY|PC-WRITTEN|PC-MULTICHOICE):.*?\]\]\n?/g,'').replace(/\[\[LK-ARCHIVED\]\]/g,'').trim();}
export function groupsFrom(d,strict=false){
 try{const raw=marker(d,'GROUPS');if(!raw){if(String(d??'').includes('[[LK-GROUPS:'))throw Error('Invalid group marker');return [];}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(unb64(raw)),values=text.startsWith('[')?JSON.parse(text):text.split('|');
  if(!Array.isArray(values)||values.some(v=>typeof v!=='string'))throw Error('Invalid group list');
  const groups=[...new Set(values.map(v=>v.trim()).filter(Boolean))];if(!groups.length)throw Error('Empty group restriction');return groups;
 }catch{if(strict)throw Error('Некоректно вказані групи у тесті. Виправте файл перед імпортом.');return [];}
}
export function blankQuestion(){return {id:'0',type:'choice',maxPoints:1,rubric:'',text:'',explanation:'',answers:[{id:'0',text:'',isCorrect:true},{id:'0',text:'',isCorrect:false}]};}
export function newDraft(){return {localId:crypto.randomUUID(),localRevision:0,replacesId:'',title:'',description:'',mode:'training',durationMinutes:20,passingPercent:70,published:true,assignedGroups:[],randomizeQuestions:true,randomizeAnswers:true,questions:[blankQuestion()]};}
export function draftFrom(test,replacesId=''){
 if(!test||typeof test!=='object'||Array.isArray(test))throw Error('Файл має містити об’єкт тесту.');
 if(isRetakeTest(test))throw Error('Повторне проходження тестів вимкнено. Цей файл повторної спроби не можна імпортувати.');
 if(test.title!=null&&typeof test.title!=='string'||test.description!=null&&typeof test.description!=='string')throw Error('Назва й опис тесту мають бути текстом.');
 if(!Array.isArray(test.questions)||test.questions.length<1||test.questions.length>200)throw Error('У тесті має бути від 1 до 200 питань.');
 for(const q of test.questions){
  if(!q||typeof q!=='object'||typeof q.text!=='string'||q.type!=null&&!['choice','written'].includes(q.type))throw Error('Перевірте тип і текст кожного питання у JSON.');
  if(q.rubric!=null&&typeof q.rubric!=='string'||q.explanation!=null&&typeof q.explanation!=='string')throw Error('Критерії та пояснення мають бути текстом.');
  const answers=q.answers??[];
  if(!Array.isArray(answers)||answers.length>6||!isWritten(q)&&answers.length<2)throw Error('У питанні з вибором потрібно від 2 до 6 відповідей.');
  if(answers.some(a=>!a||typeof a.text!=='string'||a.isCorrect!==undefined&&typeof a.isCorrect!=='boolean'))throw Error('Перевірте тексти відповідей та isCorrect: true або false.');
 }
 const random=marker(test.description,'RANDOM');
 return {...newDraft(),title:String(test.title??''),description:cleanDescription(test.description),mode:test.mode==='exam'?'exam':'training',durationMinutes:test.durationMinutes||20,passingPercent:test.passingPercent??70,published:test.published!==false,replacesId,assignedGroups:groupsFrom(test.description,true),randomizeQuestions:!random||random.includes('Q'),randomizeAnswers:!random||random.includes('A'),questions:(test.questions??[]).map(q=>({...q,id:'0',answers:(q.answers??[]).map(a=>({...a,id:'0'}))}))};
}
export function validateDraft(d){
 if(isRetakeTest(d))return 'Повторне проходження тестів вимкнено. Стару чернетку повторної спроби не можна опублікувати.';
 if(!d||typeof d.title!=='string'||typeof d.description!=='string'||!Array.isArray(d.questions))return 'Некоректна структура чернетки тесту.';
 if(!Array.isArray(d.assignedGroups)||d.assignedGroups.some(v=>typeof v!=='string'))return 'Перевірте групи доступу: повторно оберіть їх у налаштуваннях тесту.';
 if(d.importSource&&!d.importReviewed)return 'Перевірте розпізнані питання та підтвердьте перевірку імпорту.';
 if(!d.title.trim()||d.title.length>180)return 'Назва тесту: від 1 до 180 символів.';
 if(d.description.length>2000)return 'Опис тесту перевищує 2000 символів.';
 if(!d.questions.length||d.questions.length>200)return 'Додайте від 1 до 200 питань.';
 if(!Number.isInteger(+d.passingPercent)||+d.passingPercent<1||+d.passingPercent>100)return 'Прохідний бал має бути від 1 до 100%.';
 if(d.mode==='exam'&&(!Number.isInteger(+d.durationMinutes)||+d.durationMinutes<1||+d.durationMinutes>600))return 'Тривалість іспиту: від 1 до 600 хвилин.';
 for(const [i,q] of d.questions.entries()){
  if(!q||typeof q.text!=='string'||!q.text.trim()||q.text.trim().length>1000)return `Перевірте текст питання ${i+1}.`;
  if(!['choice','written'].includes(q.type||'choice')||!Number.isInteger(+(q.maxPoints??1))||+(q.maxPoints??1)<1||+(q.maxPoints??1)>100)return `Максимум балів за питання ${i+1}: від 1 до 100.`;
  if(String(q.rubric??'').length>2000)return `Критерії питання ${i+1} перевищують 2000 символів.`;
  if(String(q.explanation??'').trim().length>2000)return `Пояснення питання ${i+1} перевищує 2000 символів.`;
  if(isWritten(q))continue;
  if(!Array.isArray(q.answers)||q.answers.length<2||q.answers.length>6||q.answers.some(a=>!a||typeof a.text!=='string'||!a.text.trim()||a.text.trim().length>500))return `У питанні ${i+1} потрібно 2–6 заповнених відповідей.`;
  if(q.answers.some(a=>a.isCorrect!==undefined&&typeof a.isCorrect!=='boolean'))return `Перевірте позначки правильних відповідей у питанні ${i+1}.`;
  if(![1,2].includes(q.answers.filter(a=>a.isCorrect).length))return `Позначте одну або дві правильні відповіді у питанні ${i+1}.`;
 }
 return '';
}
export async function publicationBody(d,published=d.published){
 if(typeof d.localId!=='string'||!d.localId)throw Error('Не вдалося визначити чернетку. Збережіть її та повторіть публікацію.');
 const body=draftAPI(d,published),raw=JSON.stringify([d.localId,String(d.replacesId||''),body]);
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(raw)))].map(v=>v.toString(16).padStart(2,'0')).join('');
 return {...body,requestId:'pc-test-'+digest};
}
export function draftAPI(d,published=d.published){
 if(isRetakeTest(d))throw Error('Повторне проходження тестів вимкнено.');
 if(!Array.isArray(d.assignedGroups)||d.assignedGroups.some(v=>typeof v!=='string'))throw Error('Перевірте групи доступу перед збереженням або експортом.');
 if(d.questions.some(q=>!isWritten(q)&&q.answers.some(a=>a.isCorrect!==undefined&&typeof a.isCorrect!=='boolean')))throw Error('Перевірте позначки правильних відповідей перед збереженням або експортом.');
 const markers=[];
 if(d.assignedGroups.length)markers.push('[[LK-GROUPS:'+b64(bytes(JSON.stringify([...new Set(d.assignedGroups)]))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')+']]');
 markers.push('[[LK-RANDOM:'+(d.randomizeQuestions?'Q':'')+(d.randomizeAnswers?'A':'')+(!d.randomizeQuestions&&!d.randomizeAnswers?'N':'')+']]');
 return {id:0,accessProtocol:1,title:d.title.trim(),description:[...markers,d.description.trim()].filter(Boolean).join('\n'),mode:d.mode,durationMinutes:d.mode==='exam'?+d.durationMinutes:0,passingPercent:+d.passingPercent,published:!!published,questionCount:d.questions.length,questions:d.questions.map(q=>({id:'0',type:isWritten(q)?'written':'choice',maxPoints:+(q.maxPoints??1),rubric:String(q.rubric??'').trim(),text:q.text.trim(),explanation:String(q.explanation??'').trim(),answers:isWritten(q)?[]:q.answers.map(a=>({id:'0',text:a.text.trim(),isCorrect:!!a.isCorrect}))}))};
}
export function shuffled(test){const t=structuredClone(test),settings=marker(t.description,'RANDOM');const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};if(!settings||settings.includes('Q'))shuffle(t.questions);if(!settings||settings.includes('A'))t.questions.forEach(q=>shuffle(q.answers));return t;}
export function answerStorageLength(test,answers){
 const selected=Object.fromEntries(test.questions.map(q=>{
  const value=answers[id(q.id)];
  return [id(q.id),isWritten(q)?String(value??'').replace(/\u0000/g,''):choiceValue(q,value)];
 }));
 return JSON.stringify(selected).length;
}
export function submission(run,uptime){if(answerStorageLength(run.test,run.answers)>48000)throw Error('Сумарний обсяг відповідей перевищує 48 000 символів. Скоротіть письмові відповіді.');return {...(run.startPermit?{startPermit:run.startPermit}:{}),writtenProtocol:1,choiceProtocol:2,testId:run.test.id,submissionId:run.submissionId,durationSeconds:Math.max(1,Math.round(Math.max(0,uptime-run.startedUptime)/1000)),examExitCount:run.exitCount||0,examPinned:false,answers:run.test.questions.map(q=>(isWritten(q)?{questionId:q.id,text:run.answers[id(q.id)]??''}:choiceSubmission(q,run.answers[id(q.id)])))};}
export function validateResult(result,userId,testId){
 if(!result||!id(result.id)||id(result.id)==='0'||id(result.userId)!==id(userId)||id(result.testId)!==id(testId)||
  !Number.isInteger(result.total)||result.total<1||result.total>200||!Number.isInteger(result.correct)||result.correct<0||result.correct>result.total||!(pendingReview(result)?result.score===null&&result.passed===null&&Number.isInteger(result.pendingWritten)&&result.pendingWritten>0:Number.isInteger(result.score)&&result.score>=0&&result.score<=100))
  throw Object.assign(Error('Сервер не підтвердив збереження результату. Спробуємо повторно.'),{code:'BAD_RESULT_RESPONSE'});
 return result;
}
export function validateRecovery(value,userId,testId,submissionId){
 if(!value||!id(value.id)||id(value.userId)!==id(userId)||id(value.testId)!==id(testId)||value.submissionId!==submissionId||!['pending','approved'].includes(value.status)||value.timeVerified!==false)
  throw Object.assign(Error('Сервер не підтвердив отримання збереженої роботи. Відповіді залишено на цьому ПК.'),{code:'BAD_RESULT_RESPONSE'});
 return value;
}
export function isRetakeTest(test){return !!test?.retryUserId||String(test?.description||'').includes('[[LK-RETRY:');}
export function cadetTests(tests){return (tests||[]).filter(t=>!isRetakeTest(t));}
export function enrichReview(rows,test){
 const questions=new Map((test?.questions||[]).map(q=>[id(q.id),q]));
 return (Array.isArray(rows)?rows:[]).filter(row=>row&&typeof row==='object').map(row=>{
  if(row.type==='written')return {...row,questionText:row.questionText||questions.get(id(row.questionId))?.text||''};
  const q=questions.get(id(row.questionId)),selected=reviewIds(row.selectedAnswerIds??row.selectedAnswerId),correct=reviewIds(row.correctAnswerIds??row.correctAnswerId);
  const text=values=>values.map(answerId=>q?.answers?.find(a=>id(a.id)===answerId)?.text||'Відповідь недоступна').join('; ');
  return {...row,questionText:row.questionText||q?.text||'',selectedAnswerIds:selected,correctAnswerIds:correct,selectedAnswerText:row.selectedAnswerText||(selected.length?text(selected):'Без відповіді'),correctAnswerText:row.correctAnswerText||text(correct)||'Відповідь недоступна'};
 });
}
export function retryable(code){return ['NETWORK','TIMEOUT','BUSY','HTTP_408','HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_AUTH','SERVER_ERROR','EMPTY','BAD_JSON','BAD_RESULT_RESPONSE','RESULT_DELETION_PENDING'].includes(code);}
export function retryDelay(n,random=Math.random){const cap=Math.min(10000*2**Math.min(Math.max(n-1,0),5),300000);return Math.round(cap*(.5+random()*.5));}
export function mergeResults(a,b){return [...new Map([...a,...b].map(r=>[id(r.id),r])).values()].sort((x,y)=>Date.parse(y.completedAt)-Date.parse(x.completedAt));}
export function completed(testId,results,pending,run,deletedTests=[]){return deletedTests.includes(id(testId))||results.some(r=>id(r.testId)===id(testId))||pending.some(p=>id(p.body.testId)===id(testId))||(run&&id(run.test.id)===id(testId));}
export function resultCSV(results){const value=v=>{let s=String(v??'');if(/^[\t\r\n ]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['ПІБ','Група','Тест','Правильних з вибором','Неправильних з вибором','Час, с','Підсумковий бал, %','Дата','Стан перевірки','Набрано балів','Максимум балів','Підтвердження збереженої роботи'],...results.map(r=>[r.userName,r.groupName,r.testTitle,r.correct,choiceCount(r)-r.correct,r.durationSeconds,pendingReview(r)?'':r.score,r.completedAt,pendingReview(r)?'Очікує перевірки':'Перевірено',r.earnedPoints??r.correct,r.maxPoints??r.total,r.examRecovered?'Підтвердив інструктор: '+r.recoveredBy+'; час не перевірено сервером':''])];return '\uFEFF'+rows.map(row=>row.map(value).join(';')).join('\r\n');}

export function nameOf(u){return String(u?.fullName||u?.username||'').replace(/ · (Розробник(?:\/Інструктор)?|Старший викладач|Викладач|Старший інструктор|Інструктор)$/,'');}
export function titleOf(u){return u.role==='cadet'?u.groupName||'Курсант':u.username.toLowerCase()==='windroy'?'Розробник':u.fullName.split(' · ')[1]||'Інструктор';}
export function transferredCadet(response,previous,target){const u=response?.user;if(response?.transferred!==true||!u||String(u.id)!==String(previous.id)||u.role!=='cadet'||u.username!==previous.username||u.groupName!==target.name)throw Object.assign(Error('Сервер не підтвердив переведення цього курсанта. Оновіть список.'),{code:'BAD_RESPONSE'});return u;}
// Full snapshots make the current journal independently recoverable after a crash.
// Incomplete drafts are valid here; publication validation remains separate.
function recoverableDraft(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||typeof d.localId!=='string'||!d.localId||typeof d.title!=='string'||typeof d.description!=='string'||!Array.isArray(d.questions)||!d.questions.length||d.questions.length>200)return false;
 if(!Array.isArray(d.assignedGroups)||d.assignedGroups.some(g=>typeof g!=='string'))return false;
 return d.questions.every(q=>q&&typeof q==='object'&&!Array.isArray(q)&&typeof q.text==='string'&&(!q.type||['choice','written'].includes(q.type))&&Array.isArray(q.answers)&&q.answers.length<=6&&q.answers.every(a=>a&&typeof a==='object'&&typeof a.text==='string'&&(a.isCorrect===undefined||typeof a.isCorrect==='boolean')));
}
export function draftJournalSnapshot(d){
 const raw=JSON.stringify(d);if(raw.length>2000000||!recoverableDraft(d))throw Error('Не вдалося підготувати журнал чернетки. Збережіть або виправте чернетку.');
 return JSON.parse(raw);
}
export function applyCheckpoint(state,j){
 const a=state.accounts?.[id(j?.userId)];if(!a||!Number.isSafeInteger(j.revision)||j.revision<1)return false;
 if(j.kind==='run'){
  const r=a.run;if(!r||r.submissionId!==j.submissionId||j.revision<=(r.localRevision||0))return false;
  if(j.answers&&typeof j.answers==='object'){r.answers={};for(const q of r.test.questions){const value=j.answers[id(q.id)];if(isWritten(q)&&typeof value==='string'&&value.length<=3000)r.answers[id(q.id)]=value;else if(!isWritten(q)){const selected=choiceValue(q,value);if(selected!=='0')r.answers[id(q.id)]=selected;}}}
  if(Number.isInteger(j.index)&&j.index>=0&&j.index<r.test.questions.length)r.index=j.index;
  if(Number.isInteger(j.lastElapsed)&&j.lastElapsed>=0)r.lastElapsed=j.lastElapsed;
  if(Number.isInteger(j.exitCount)&&j.exitCount>=0)r.exitCount=Math.max(r.exitCount||0,j.exitCount);
  if(j.interrupted===true)r.interrupted=true;r.localRevision=j.revision;return true;
 }
 if(j.kind==='draft'){
  const d=a.draft,p=j.patch;if(!d||d.localId!==j.localId||j.revision<=(d.localRevision||0))return false;
  if(j.draft!==undefined){if(!recoverableDraft(j.draft)||j.draft.localId!==d.localId||j.draft.localRevision!==j.revision||JSON.stringify(j.draft).length>2000000)return false;a.draft=JSON.parse(JSON.stringify(j.draft));return true;}
  if(!p)return false;
  if(p.scope==='root'&&['title','description','mode','durationMinutes','passingPercent','randomizeQuestions','randomizeAnswers','assignedGroups','importReviewed'].includes(p.prop))d[p.prop]=p.value;
  else if(p.scope==='question'&&['text','explanation','maxPoints','rubric'].includes(p.prop)&&d.questions[p.q])d.questions[p.q][p.prop]=p.value;
  else if(p.scope==='question-replace'&&d.questions[p.q]&&['choice','written'].includes(p.value?.type)&&Array.isArray(p.value.answers)&&p.value.answers.length<=6)d.questions[p.q]=p.value;
  else if(p.scope==='answer'&&d.questions[p.q]?.answers[p.a])d.questions[p.q].answers[p.a].text=p.value;
  else if(p.scope==='corrects'&&d.questions[p.q]&&Array.isArray(p.indices)&&p.indices.length<=2&&p.indices.every(i=>Number.isInteger(i)&&d.questions[p.q].answers[i]))d.questions[p.q].answers.forEach((v,i)=>v.isCorrect=p.indices.includes(i));
  else if(p.scope==='correct'&&d.questions[p.q]?.answers[p.a])d.questions[p.q].answers.forEach((v,i)=>v.isCorrect=i===p.a);
  else return false;
  d.localRevision=j.revision;return true;
 }
 return false;
}

export const isWritten=q=>q?.type==='written';
export const pendingReview=r=>r?.gradingStatus==='pending_review';
export const choiceCount=r=>r.choiceTotal??r.total;
export const answered=(q,answers)=>isWritten(q)?!!String(answers[id(q.id)]??'').trim():choiceIds(q,answers[id(q.id)]).length>0;
export const resultLabel=r=>pendingReview(r)?'Очікує перевірки':`${r.score}%`;

export function choiceIds(q,value){
 const raw=Array.isArray(value)?value:value==null||value==='0'?[]:[value];
 if(raw.length>2||raw.some(v=>!['string','number'].includes(typeof v)))return [];
 const values=raw.map(id);if(new Set(values).size!==values.length)return [];
 if(values.some(v=>!q.answers.some(a=>id(a.id)===v)))return [];
 return values.slice().sort();
}
export function choiceValue(q,value){const values=choiceIds(q,value);return values.length>1?values:values[0]||'0';}
export function choiceSubmission(q,value){const values=choiceIds(q,value);return values.length>1?{questionId:q.id,answerIds:values}:{questionId:q.id,answerId:values[0]||'0'};}
export function toggleChoice(q,value,answerId,checked){
 let values=choiceIds(q,value);answerId=id(answerId);
 if(!q.answers.some(a=>id(a.id)===answerId))throw Error('Невідомий варіант відповіді.');
 values=checked?[...new Set([...values,answerId])]:values.filter(v=>v!==answerId);
 if(values.length>2)throw Error('Можна вибрати максимум дві відповіді.');
 return choiceValue(q,values);
}
function reviewIds(value){return [...new Set((Array.isArray(value)?value:[value]).filter(v=>v!=null&&id(v)!=='0'&&id(v)!=='').map(id))].sort();}
export function reviewCorrect(row){const selected=reviewIds(row.selectedAnswerIds??row.selectedAnswerId),correct=reviewIds(row.correctAnswerIds??row.correctAnswerId);return correct.length>0&&JSON.stringify(selected)===JSON.stringify(correct);}
export function reviewSkipped(row){return reviewIds(row.selectedAnswerIds??row.selectedAnswerId).length===0;}
