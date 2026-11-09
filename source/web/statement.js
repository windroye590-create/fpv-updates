// Local, one-page PDF generation. No document contents leave the application.
export function statementTests(tests,results){
 const seen=new Set();return [...tests.filter(t=>t.published!==false&&!String(t.description||'').includes('[[LK-RETRY:')),...results.map(r=>({id:r.testId,title:r.testTitle}))]
  .filter(t=>String(t.id||'')&&!seen.has(String(t.id))&&seen.add(String(t.id))).map(t=>({id:String(t.id),title:t.title||''}))
  .sort((a,b)=>a.title.localeCompare(b.title,'uk')||a.id.localeCompare(b.id));
}
export function buildStatement(source,groupId,testId,date){
 if(source.instructor?.role!=='instructor')throw Error('Відомість доступна лише інструктору.');
 const group=source.groups.find(g=>String(g.id)===String(groupId)),test=source.tests.find(t=>String(t.id)===String(testId));
 if(!group||!test)throw Error('Групу або тест не знайдено. Відкрийте відомість знову.');
 const seen=new Set(),cadets=source.cadets.filter(u=>u.role==='cadet'&&u.groupName===group.name&&!seen.has(String(u.id))&&seen.add(String(u.id)));
 if(!cadets.length)throw Error('У вибраній групі немає курсантів.');
 if(cadets.length>27)throw Error(`У групі ${cadets.length} курсантів. Відомість на одному аркуші підтримує до 27.`);
 if(cadets.some(u=>!String(u.id||'')))throw Error('Не вдалося визначити курсанта. Оновіть дані.');
 const rows=cadets.sort((a,b)=>(a.fullName||a.username).localeCompare(b.fullName||b.username,'uk')||String(a.id).localeCompare(String(b.id))).map(u=>{
  const matches=source.results.filter(r=>String(r.userId)===String(u.id)&&String(r.testId)===String(test.id)).sort((a,b)=>(Date.parse(a.completedAt)||0)-(Date.parse(b.completedAt)||0)||String(a.id).localeCompare(String(b.id)));
  const result=matches.at(-1)||null;
  if(result&&(!Number.isInteger(result.total)||result.total<1||!Number.isInteger(result.correct)||result.correct<0||result.correct>result.total||(result.gradingStatus!=='pending_review'&&(!Number.isInteger(result.score)||result.score<0||result.score>100))||!Number.isInteger(result.durationSeconds)||result.durationSeconds<0))throw Error('Один із результатів має некоректні дані. Оновіть результати й повторіть.');
  const name=u.fullName||u.username,identifier=cadets.filter(c=>(c.fullName||c.username)===name).length>1?'Логін: '+(u.username||u.id):'';
  return {userId:String(u.id),name,result,identifier};
 });
 return {group:group.name,test:test.title+(source.tests.filter(t=>t.title===test.title).length>1?' · №'+test.id:''),date,instructor:(source.instructor.fullName||source.instructor.username).split(' · ')[0],rows};
}
export const clean=value=>String(value??'').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/gu,' ').trim();
export function statementLayout(statement,measure){
 if(statement.rows.length<1||statement.rows.length>27)throw Error('Відомість підтримує від 1 до 27 курсантів.');
 function wrap(raw,width,size){const out=[];let line='';for(const word of clean(raw).split(' ').filter(Boolean)){
  const next=line?line+' '+word:word;if(measure(next,size)<=width)line=next;
  else{if(line){out.push(line);line='';}for(const char of word){if(line&&measure(line+char,size)>width){out.push(line);line='';}line+=char;}}
 }if(line)out.push(line);return out.length?out:[''];}
 const texts=[],lines=[];const text=(x,y,value,size=9,centered=false,muted=false)=>texts.push({x,y,text:clean(value),size,centered,muted});
 text(28,31,'FPV Комісія',9,false,true);text(28,55,'ВІДОМІСТЬ РЕЗУЛЬТАТІВ ТЕСТУВАННЯ',14);
 let y=76;for(const line of wrap('Група: '+statement.group,539,10)){text(28,y,line,10);y+=12;}
 text(28,y+2,'Дата відомості: '+statement.date,9);y+=19;
 for(const line of wrap('Тест: '+statement.test,539,10)){text(28,y,line,10);y+=12;}
 text(28,y+3,`Курсантів: ${statement.rows.length}    Результатів: ${statement.rows.filter(r=>r.result).length}`,8,false,true);
 const top=y+14;let font=9,wrapped,heights;
 for(;;){wrapped=statement.rows.map(r=>[...wrap(r.name,273,font),...(r.identifier?wrap(r.identifier,273,font):[]),...(!r.result?['Немає результату']:r.result.choiceTotal<r.result.total?[(r.result.gradingStatus==='pending_review'?'Очікує перевірки · ':'')+'Бали: '+r.result.earnedPoints+' / '+r.result.maxPoints]:[])]);heights=wrapped.map(r=>Math.max(18,r.length*font*1.2+4));
  if(top+24+heights.reduce((a,b)=>a+b,0)<=735)break;font-=.25;if(font<7)throw Error('Текст надто довгий для одного аркуша А4. Перевірте довжину ПІБ і назви тесту.');}
 const cols=[28,50,331,397,452,497,567],labels=['№','ПІБ курсанта','Правильних','Помилок','%','Час'];
 labels.forEach((label,i)=>text((cols[i]+cols[i+1])/2,top+15,label,8,true));y=top+24;
 lines.push({x1:28,y1:top,x2:567,y2:top},{x1:28,y1:y,x2:567,y2:y});
 statement.rows.forEach((row,index)=>{
  const h=heights[index];text(39,y+h/2+font*.35,String(index+1),font,true);
  const start=y+(h-wrapped[index].length*font*1.2)/2+font;
  const nameLines=wrap(row.name,273,font).length;
  wrapped[index].forEach((value,i)=>text(54,start+i*font*1.2,value,font,false,i>=nameLines));
  const r=row.result,values=r?[`${r.correct} / ${r.choiceTotal??r.total}`,String((r.choiceTotal??r.total)-r.correct),r.gradingStatus==='pending_review'?'-':String(r.score),`${Math.floor(r.durationSeconds/60)}:${String(r.durationSeconds%60).padStart(2,'0')}`]:['-','-','-','-'];
  values.forEach((value,i)=>text((cols[i+2]+cols[i+3])/2,y+h/2+font*.35,value,font,true));y+=h;lines.push({x1:28,y1:y,x2:567,y2:y});
 });
 cols.forEach(x=>lines.push({x1:x,y1:top,x2:x,y2:y}));
 wrap('Інструктор: '+statement.instructor,539,9).slice(0,3).forEach((line,i)=>text(28,762+i*11,line));
 text(28,803,'Підпис інструктора:',9);lines.push({x1:144,y1:804,x2:335,y2:804});
 text(28,824,'Сформовано у застосунку «FPV Комісія»',7,false,true);text(544,824,'1 / 1',7,true,true);
 return {texts,lines,tableTop:top,tableBottom:y,bodySize:font};
}
let fontPromise;
async function font(){
 if(!fontPromise)fontPromise=fetch('/statement-font.ttf').then(r=>{if(!r.ok)throw Error('Не вдалося відкрити шрифт PDF. Перезапустіть програму.');return r.arrayBuffer();}).then(b=>{
  const bytes=new Uint8Array(b);let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(value);
 }).catch(error=>{fontPromise=null;throw error;});return fontPromise;
}
export async function statementPdf(statement){
 if(!globalThis.jspdf?.jsPDF)throw Error('Модуль PDF недоступний. Перезапустіть програму.');
 const pdf=new globalThis.jspdf.jsPDF({orientation:'portrait',unit:'pt',format:'a4',compress:true});
 pdf.addFileToVFS('statement-font.ttf',await font());pdf.addFont('statement-font.ttf','Statement','normal');pdf.setFont('Statement');
 pdf.setProperties({title:'Відомість групи',subject:'Результати тестування',creator:'FPV Комісія'});
 const layout=statementLayout(statement,(value,size)=>{pdf.setFontSize(size);return pdf.getTextWidth(value);});
 pdf.setDrawColor(170,179,189);pdf.setLineWidth(.45);for(const l of layout.lines)pdf.line(l.x1,l.y1,l.x2,l.y2);
 for(const t of layout.texts){pdf.setFontSize(t.size);pdf.setTextColor(...(t.muted?[89,101,115]:[22,34,48]));pdf.text(t.text,t.x,t.y,{align:t.centered?'center':'left'});}
 if(pdf.getNumberOfPages()!==1)throw Error('Не вдалося сформувати односторінкову відомість.');
 return {bytes:new Uint8Array(pdf.output('arraybuffer')),layout};
}
