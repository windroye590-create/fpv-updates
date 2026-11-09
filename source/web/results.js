import {esc, id, nameOf, choiceCount, pendingReview, resultLabel, groupsFrom, marker} from './core.js';

// Only automatically checked choice questions contribute to the group ranking.
// Written points and the final percentage remain part of the individual work.
export function choiceSummary(result) {
 const total=choiceCount(result),correct=result.correct;
 return Number.isInteger(total)&&total>=0&&Number.isInteger(correct)&&correct>=0&&correct<=total
  ?{total,correct,wrong:total-correct}:null;
}

export function compactResults(rows,{instructor=false,allowDelete=false,groupSelected=false,testSelected=false,formatTime=seconds=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,formatDate=value=>value||'—'}={}) {
 const action=instructor?'grade-result':'review-result';
 const canDelete=instructor&&allowDelete;
 return `<div class="table-wrap compact-results${canDelete?' has-result-actions':''}" tabindex="0" role="region" aria-label="Таблиця результатів"><table><colgroup><col><col class="result-count-col"><col class="result-count-col"><col class="result-score-col"><col class="result-time-col">${canDelete?'<col class="result-actions-col">':''}</colgroup><thead><tr><th scope="col">${instructor?'ПІБ курсанта':'Тест'}</th><th scope="col" title="Правильні відповіді на запитання з варіантами">Правильні</th><th scope="col" title="Помилки та пропуски в запитаннях з варіантами">Помилки</th><th scope="col">Результат</th><th scope="col" class="result-time">Час</th>${canDelete?'<th scope="col" class="result-actions">Дії</th>':''}</tr></thead><tbody>${rows.map(r=>{
  const choice=choiceSummary(r),pending=pendingReview(r),label=instructor?r.userName:r.testTitle;
  const deleteCell=canDelete?`<td class="actions-cell"><button class="icon danger" data-action="delete-result" data-id="${esc(r.id)}" title="Видалити результат" aria-label="Видалити результат ${esc(r.userName)} · ${esc(r.testTitle)}">×</button></td>`:'';
  return `<tr><td><button class="result-link" data-action="${action}" data-id="${esc(r.id)}" aria-label="${instructor?'Переглянути роботу':'Перевірка відповідей'}: ${esc(label)}">${esc(label)}</button>${instructor&&!groupSelected?`<small>${esc(r.groupName)}</small>`:''}${instructor&&!testSelected?`<small>${esc(r.testTitle)}</small>`:''}${r.examRecovered?'<small>Підтверджено інструктором</small>':''}</td><td class="result-number">${choice?.total?choice.correct:'—'}</td><td class="result-number">${choice?.total?choice.wrong:'—'}</td><td><strong class="tag result-score ${pending?'review-pending':''}">${esc(resultLabel(r))}</strong><small>${pending?'Письмових без оцінки: '+esc(r.pendingWritten):r.passed?'Складено':'Не складено'}</small></td><td class="result-number result-time" title="${esc((r.examRecovered?'Час зі збереженої роботи. ':'')+'Завершено: '+formatDate(r.completedAt))}">${esc(formatTime(r.durationSeconds))}</td>${deleteCell}</tr>`;
 }).join('')}</tbody></table></div>`;
}

const compare=(a,b)=>String(a).localeCompare(String(b),'uk');
const newer=(a,b)=>(Date.parse(a.completedAt)||0)-(Date.parse(b.completedAt)||0)||compare(id(a.id),id(b.id));

export function buildRanking(source,groupName) {
 const results=(source.results||[]).filter(r=>r.groupName===groupName&&id(r.userId)&&id(r.testId));
 const members=new Map();
 for(const u of source.cadets||[])if(u.role==='cadet'&&u.groupName===groupName&&id(u.id)&&!members.has(id(u.id)))
  members.set(id(u.id),{userId:id(u.id),name:nameOf(u),username:u.username||'',historical:false,attempts:new Map()});
 // Historical rows keep the group recorded when the work was submitted.
 for(const r of [...results].sort((a,b)=>newer(b,a)))if(!members.has(id(r.userId)))
  members.set(id(r.userId),{userId:id(r.userId),name:r.userName||'Курсант',username:'',historical:true,attempts:new Map()});
 const tests=new Map();
 for(const t of source.tests||[]) {
  const assigned=groupsFrom(t.description);
  if(id(t.id)&&t.published!==false&&!marker(t.description,'RETRY')&&(!assigned.length||assigned.includes(groupName)))
   tests.set(id(t.id),{id:id(t.id),title:t.title||'Тест'});
 }
 for(const r of results) {
  if(!tests.has(id(r.testId)))tests.set(id(r.testId),{id:id(r.testId),title:r.testTitle||'Тест'});
  const attempts=members.get(id(r.userId)).attempts,previous=attempts.get(id(r.testId));
  if(!previous||newer(r,previous)>0)attempts.set(id(r.testId),r);
 }
 const columns=[...tests.values()].sort((a,b)=>compare(a.title,b.title)||compare(a.id,b.id));
 const rows=[...members.values()].map(row=>{
  const cells=columns.map(test=>{const result=row.attempts.get(test.id)||null;return {result,choice:result?choiceSummary(result):null};});
  const counted=cells.filter(c=>c.choice?.total>0),total=counted.length?counted.reduce((sum,c)=>sum+c.choice.correct,0):null;
  const {attempts,...person}=row;
  return {...person,cells,total,completed:cells.filter(c=>c.result).length,rank:null};
 }).sort((a,b)=>(b.total!==null)-(a.total!==null)||(b.total??0)-(a.total??0)||compare(a.name,b.name)||compare(a.userId,b.userId));
 let previous;
 rows.forEach((row,index)=>{if(row.total!==null){row.rank=previous?.total===row.total?previous.rank:index+1;previous=row;}});
 const names=new Map();for(const row of rows)names.set(row.name,(names.get(row.name)||0)+1);
 for(const row of rows)row.duplicateName=names.get(row.name)>1;
 const titles=new Map();for(const t of columns)titles.set(t.title,(titles.get(t.title)||0)+1);
 for(const t of columns)t.label=t.title+(titles.get(t.title)>1?' · №'+t.id:'');
 const summary={participants:rows.length,tests:columns.length,completedAll:columns.length?rows.filter(row=>row.completed===columns.length).length:0,best:rows[0]?.total??null};
 return {groupName,tests:columns,rows,summary,matched:rows.length};
}

export function searchRanking(ranking,query='') {
 const text=query.trim().toLocaleLowerCase('uk-UA');
 const rows=ranking.rows.filter(r=>[r.name,r.username].join(' ').toLocaleLowerCase('uk-UA').includes(text));
 return {...ranking,rows,matched:rows.length};
}

export function rankingTable(ranking) {
 const summary=ranking.summary||{participants:ranking.rows.length,tests:ranking.tests.length,completedAll:0,best:ranking.rows[0]?.total??null};
 const overview=`<section class="ranking-overview" aria-label="Підсумок групи"><div><strong>${summary.participants}</strong><span>Курсантів у групі</span></div><div><strong>${summary.tests}</strong><span>Тестів у рейтингу</span></div><div><strong>${summary.completedAll}</strong><span>Пройшли всі тести</span></div><div><strong>${summary.best??'—'}</strong><span>Найбільше правильних</span></div></section>`;
 if(!ranking.tests.length)return overview+'<div class="empty"><h3>Для групи ще немає тестів</h3><p>Опублікуйте тест для цієї групи, щоб почати рейтинг.</p></div>';
 return overview+`<div class="ranking-caption"><strong>${esc(ranking.groupName)}</strong><span>Показано курсантів: ${ranking.matched??ranking.rows.length} · За сумою правильних відповідей</span></div><div class="table-wrap group-ranking" style="--ranking-tests:${ranking.tests.length}" tabindex="0" role="region" aria-label="Рейтинг групи за всіма тестами"><table><colgroup><col class="ranking-place-col"><col class="ranking-person-col"><col class="ranking-total-col">${ranking.tests.map(()=>'<col>').join('')}</colgroup><thead><tr><th scope="col" class="ranking-place">Місце</th><th scope="col" class="ranking-person">ПІБ курсанта</th><th scope="col" class="ranking-total">Правильних<small>За всіма тестами</small></th>${ranking.tests.map((t,index)=>`<th scope="col" class="ranking-test" title="${esc(t.label)}"><span class="ranking-test-number">Тест ${String(index+1).padStart(2,'0')}</span><span class="ranking-test-title">${esc(t.label)}</span></th>`).join('')}</tr></thead><tbody>${ranking.rows.map(row=>`<tr${row.rank===1?' class="ranking-leader"':''}><td class="result-number ranking-place"><span class="ranking-place-badge${row.rank===1?' first':row.rank&&row.rank<=3?' podium':''}">${row.rank??'—'}</span></td><th scope="row" class="ranking-person"><span class="ranking-name">${esc(row.name)}</span>${row.historical?'<small>Результати в цій групі</small>':row.duplicateName?`<small>${esc(row.username||row.userId)}</small>`:''}<div class="ranking-completion"><span>Пройдено: ${row.completed??row.cells.filter(c=>c.result).length} із ${ranking.tests.length}</span><progress value="${row.completed??row.cells.filter(c=>c.result).length}" max="${ranking.tests.length}" aria-label="Пройдено тестів: ${esc(row.name)}"></progress></div></th><td class="result-number ranking-total"><strong>${row.total??'—'}</strong></td>${row.cells.map(cell=>{
  if(!cell.result)return '<td class="ranking-result"><span class="ranking-missing"><strong>—</strong><small>Не пройдено</small></span></td>';
  if(!cell.choice)return '<td class="ranking-result"><span class="ranking-missing"><strong>—</strong><small>Оновіть дані</small></span></td>';
  const pending=pendingReview(cell.result);
  const label=cell.choice.total?`Правильних: ${cell.choice.correct} із ${cell.choice.total}`:'Лише письмові запитання';
  return `<td class="result-number ranking-result"><button class="ranking-result-button${!cell.choice.total?' written':''}" data-action="grade-result" data-id="${esc(cell.result.id)}" aria-label="Переглянути роботу: ${esc(row.name)}, ${esc(cell.result.testTitle)}. ${esc(label)}" title="${esc(label)}">${cell.choice.total?`<span class="ranking-points"><strong>${cell.choice.correct}</strong><span>/ ${cell.choice.total}</span></span><progress value="${cell.choice.correct}" max="${cell.choice.total}" aria-hidden="true"></progress>`:'<span class="ranking-written-label">Письмовий</span>'}</button>${pending?'<small class="ranking-status">Письмові на перевірці</small>':''}${cell.result.examRecovered?'<small class="ranking-status">Підтверджено інструктором</small>':''}</td>`;
 }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function rankingCSV(ranking) {
 const value=v=>{let text=String(v??'');if(/^[\t\r\n ]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
 const rows=[['Місце','ПІБ курсанта','Усього правильних',...ranking.tests.map(t=>t.label)],...ranking.rows.map(r=>[r.rank,r.name,r.total,...r.cells.map(c=>!c.result?'Не пройдено':!c.choice?'Оновіть дані':!c.choice.total?'Лише письмові':`${c.choice.correct} / ${c.choice.total}${pendingReview(c.result)?' (письмові на перевірці)':''}`)])];
 return '\uFEFF'+rows.map(row=>row.map(value).join(';')).join('\r\n');
}
