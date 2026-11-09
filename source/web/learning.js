export function learningUnits(tests,materials,progress,results,pending=[],running=null,recoveries=[],deletedTests=[]){
 const byTest=new Map();for(const r of results){const key=String(r.testId),previous=byTest.get(key);if(!previous||String(r.completedAt||'')>String(previous.completedAt||''))byTest.set(key,r);}
 return tests.map(test=>{
  const linked=materials.filter(m=>String(m.testId)===String(test.id));
  const reading=linked.map(material=>{const p=progress[material.id];return {material,page:p?.revision===material.revision?Math.min(material.pageCount,Math.max(0,p.maxPage||0)):0};});
  const result=byTest.get(String(test.id)),queued=pending.some(p=>String(p.body?.testId??p.testId)===String(test.id)),active=String(running?.test?.id)===String(test.id),recovery=recoveries.some(r=>String(r.testId)===String(test.id)),used=deletedTests.map(String).includes(String(test.id));
  const status=result?(result.gradingStatus==='pending_review'?'Очікує перевірки':result.passed?'Складено':'Завершено · повторіть матеріал'):queued?'Збережено · очікує сервера':active?'Тест розпочато':recovery?'Очікує підтвердження інструктора':used?'Спробу використано':test.access?.open===false?'Очікує відкриття інструктором':reading.length&&reading.every(r=>r.page>=r.material.pageCount)?'Матеріали переглянуто · тест попереду':reading.some(r=>r.page>0)?'Перегляд матеріалів':'Почніть навчання';
  return {test,reading,result,queued,active,recovery,used,status,canStart:!result&&!queued&&!active&&!recovery&&!used&&test.access?.open!==false};
 });
}
export function learningSummary(units){return {total:units.length,completed:units.filter(u=>u.result).length,passed:units.filter(u=>u.result?.passed).length,pending:units.filter(u=>u.queued).length,needsAttention:units.filter(u=>u.result&&u.result.gradingStatus!=='pending_review'&&!u.result.passed)};}
