// The same report model and XML run in the browser and in Apps Script.
// Values are written as numbers or explicit strings; cell text is never a formula.
const rptMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const rptId=value=>String(value??'');
const rptPending=r=>r.gradingStatus==='pending_review';
const rptScore=r=>!rptPending(r)&&typeof r.score==='number'&&Number.isFinite(r.score)?r.score/100:null;
const rptStatus=r=>rptPending(r)?'Очікує перевірки':r.passed?'Складено':'Не складено';
const rptText=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').slice(0,32767);
const rptXml=value=>rptText(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const rptNumber=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const rptCell=(v,s=0)=>({v:v??'',s});
const rptPercent=(v,s=2)=>rptCell(v,s);
function rptDate(value,offset){const ms=Date.parse(value);return Number.isFinite(ms)?(ms-offset*60000)/86400000+25569:'';}
function rptTime(value){return Number.isFinite(Number(value))?Math.max(0,Number(value))/86400:'';}
function rptTestLabel(t){return rptText(t.title||t.testTitle||'Тест')+' · #'+rptId(t.id||t.testId);}
function rptSort(a,b){return String(a).localeCompare(String(b),'uk');}
function rptChoice(r){return Number.isInteger(r.choiceTotal)?r.choiceTotal:Number(r.total)||0;}

export function reportFilename(name='',now=new Date().toISOString(),offset=0){
 const ms=Date.parse(now),local=Number.isFinite(ms)?new Date(ms-offset*60000).toISOString():String(now);
 const stamp=local.replace(/[:.]/g,'-').replace('T','_').replace(/Z$/,'');
 const title=rptText(name).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').trim().replace(/[. ]+$/,'').slice(0,80)||'Результати';
 return 'FPV-Комісія_'+title+'_'+stamp+'.xlsx';
}

export function reportModel(data,options={}){
 const results=(data.results||[]).filter(r=>r&&rptId(r.userId)&&rptId(r.testId)),cadets=data.cadets||[],tests=data.tests||[];
 const generatedAt=data.generatedAt||new Date().toISOString(),offset=Number.isFinite(options.timezoneOffsetMinutes)?options.timezoneOffsetMinutes:0;
 const scope=options.name||data.scope||'Усі групи та тести',stamp=new Date(generatedAt);
 const meta=scope+' · Сформовано '+(Number.isFinite(stamp.getTime())?new Date(stamp.getTime()-offset*60000).toISOString().slice(0,19).replace('T',' '):generatedAt)+' · UTC'+(offset<=0?'+':'−')+Math.abs(offset/60);
 const columns=[['ПІБ курсанта',34],['Група',20],['Тест',38],['Дата завершення',22],['Результат',24],['Підсумковий бал',20],['Набрано балів',17],['Максимум балів',18],['Час проходження',18],['Правильних',16,true],['Неправильних',17,true],['Правильних, %',19,true],['ID курсанта',18,true],['ID результату',18,true],['Підтвердження збереженої роботи',38]];
 const ordered=results.slice().sort((a,b)=>(Date.parse(b.completedAt)||0)-(Date.parse(a.completedAt)||0)||rptSort(a.userName,b.userName));
 const resultRows=ordered.map(r=>{const state=rptPending(r)?7:r.passed?5:6,choice=rptChoice(r);return [r.userName,r.groupName,r.testTitle,rptCell(rptDate(r.completedAt,offset),4),rptCell(rptStatus(r),state),rptPercent(rptScore(r),state===7?2:r.passed?12:13),rptNumber(r.earnedPoints)??r.correct,rptNumber(r.maxPoints)??r.total,rptCell(rptTime(r.durationSeconds),3),choice?r.correct:'',choice?Math.max(0,choice-r.correct):'',rptPercent(choice?(Number(r.correct)||0)/choice:null),rptId(r.userId),rptId(r.id),r.examRecovered?'Підтвердив: '+(r.recoveredBy||'інструктор')+'; час зі збереженої роботи':''];});
 const byTest=new Map(),members=new Map(),latest=new Map();
 for(const t of tests)if(t&&rptId(t.id))byTest.set(rptId(t.id),t);
 for(const u of cadets){if(u.role&&u.role!=='cadet')continue;const group=String(u.groupName||'');members.set(JSON.stringify([rptId(u.id),group]),{id:rptId(u.id),name:u.fullName||u.username||'',username:u.username||'',group});}
 for(const r of ordered){
  const tid=rptId(r.testId),person=JSON.stringify([rptId(r.userId),String(r.groupName||'')]);
  if(!byTest.has(tid))byTest.set(tid,{id:tid,title:r.testTitle,historical:true});
  if(!members.has(person))members.set(person,{id:rptId(r.userId),name:r.userName,group:String(r.groupName||''),historical:true});
  const key=JSON.stringify([person,tid]);if(!latest.has(key))latest.set(key,r);
 }
 const testList=[...byTest.values()].sort((a,b)=>rptSort(a.title,b.title)||rptSort(rptId(a.id),rptId(b.id)));
 const matrixColumns=[['ПІБ курсанта',34],['Група',20],['Логін / ID',20],...testList.map(t=>[rptTestLabel(t),25]),['Пройдено тестів',19],['Середній бал перевірених',27]];
 const matrixRows=[...members.entries()].sort((a,b)=>rptSort(a[1].group,b[1].group)||rptSort(a[1].name,b[1].name)||rptSort(a[1].id,b[1].id)).map(([person,u])=>{
  let completed=0;const scores=[];
  const cells=testList.map(t=>{const r=latest.get(JSON.stringify([person,rptId(t.id)]));if(r){completed++;const score=rptScore(r);if(score!==null)scores.push(score);return rptPending(r)?rptCell('Очікує перевірки',7):rptPercent(score,r.passed?12:13);}
   const assigned=Array.isArray(t.assignedGroups)?t.assignedGroups:[];
   const applicable=!t.historical&&t.published!==false&&(!assigned.length||assigned.includes(u.group));
   return rptCell(applicable?'Не проходив':'—',8);
  });
  return [u.name,u.group,u.username||'#'+u.id,...cells,completed,rptPercent(scores.length?scores.reduce((n,v)=>n+v,0)/scores.length:null)];
 });
 const groupNames=new Set([...cadets.map(u=>String(u.groupName||'')),...results.map(r=>String(r.groupName||''))]);
 const summaries=[...groupNames].sort(rptSort).map(group=>rptSummary(group,results.filter(r=>String(r.groupName||'')===group),cadets.filter(u=>String(u.groupName||'')===group)));
 const summaryColumns=[['Група',27],['Курсантів',16],['Робіт',14],['Перевірено',17],['Склали',14],['Не склали',16],['Очікують перевірки',24],['Середній бал перевірених',28],['Успішність перевірених',27]];
 summaries.push(rptSummary('Разом',results,cadets));
 return {title:'FPV Комісія',generatedAt,scope,meta,sheets:[
  {name:'Результати',columns,rows:resultRows,freezeColumns:2},
  {name:'Відомість групи',columns:matrixColumns,rows:matrixRows,freezeColumns:3},
  {name:'Зведення',columns:summaryColumns,rows:summaries,freezeColumns:1}
 ]};
}
function rptSummary(name,results,cadets){
 const graded=results.filter(r=>rptScore(r)!==null),scores=graded.map(rptScore),passed=graded.filter(r=>r.passed).length;
 const users=new Set([...cadets.map(u=>rptId(u.id)),...results.map(r=>rptId(r.userId))].filter(Boolean));
 return [name,users.size,results.length,graded.length,passed,graded.length-passed,results.filter(rptPending).length,rptPercent(scores.length?scores.reduce((n,v)=>n+v,0)/scores.length:null),rptPercent(graded.length?passed/graded.length:null)];
}
function rptColumn(index){let text='';for(let n=index+1;n;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text;}
function rptRowHeight(values,columns,minimum=32){let lines=1;values.forEach((cell,index)=>{const raw=cell&&typeof cell==='object'?cell.v:cell,width=Math.max(8,(columns[index]?.[1]||20)-2);lines=Math.max(lines,String(raw??'').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(s.length/width)),0));});return Math.min(409,Math.max(minimum,lines*14+12));}
function rptStyles(){
 const fonts='<font><sz val="11"/><name val="Calibri"/><color rgb="FF172B4D"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="17"/><name val="Calibri"/><color rgb="FF17365D"/></font><font><sz val="10"/><name val="Calibri"/><color rgb="FF64748B"/></font>';
 const fills=['<patternFill patternType="none"/>','<patternFill patternType="gray125"/>',...['17365D','E8F5EC','FDECEC','FFF4D6','F1F5F9'].map(c=>'<patternFill patternType="solid"><fgColor rgb="FF'+c+'"/><bgColor indexed="64"/></patternFill>')].map(x=>'<fill>'+x+'</fill>').join('');
 const xf=(num=0,fill=0,font=0)=>'<xf numFmtId="'+num+'" fontId="'+font+'" fillId="'+fill+'" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>';
 const formats=[xf(),xf(0,2,1),xf(164),xf(165),xf(166),xf(0,3),xf(0,4),xf(0,5),xf(0,6),xf(0,0,2),xf(0,0,3),xf(1),xf(164,3),xf(164,4),xf(164,6),xf(0,6),xf(164,6),xf(165,6),xf(166,6)];
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="0%"/><numFmt numFmtId="165" formatCode="[m]:ss"/><numFmt numFmtId="166" formatCode="dd.mm.yyyy hh:mm"/></numFmts><fonts count="4">'+fonts+'</fonts><fills count="7">'+fills+'</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1">'+xf()+'</cellStyleXfs><cellXfs count="'+formats.length+'">'+formats.join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}
function rptValue(value,index,row,banded=false){
 const cell=value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'v')?value:{v:value,s:0};
 let style=cell.s||0;if(banded)style=({0:15,2:16,3:17,4:18})[style]??style;
 const ref=rptColumn(index)+row,raw=cell.v;
 if(raw===null||raw===undefined||raw==='')return '<c r="'+ref+'" s="'+style+'"/>';
 return typeof raw==='number'&&Number.isFinite(raw)?'<c r="'+ref+'" s="'+style+'"><v>'+raw+'</v></c>':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+rptXml(raw)+'</t></is></c>';
}
function rptWorksheet(sheet,model){
 if(sheet.columns.length>16384||sheet.rows.length>1048573)throw Error('Забагато даних для одного аркуша Excel. Оберіть групу або тест.');
 const last=rptColumn(Math.max(0,sheet.columns.length-1)),lastRow=Math.max(3,sheet.rows.length+3),freeze=sheet.freezeColumns||1;
 const metaHeight=rptRowHeight([model.meta],[[null,sheet.columns.reduce((n,c)=>n+c[1],0)]],28),headerHeight=rptRowHeight(sheet.columns.map(c=>c[0]),sheet.columns,42);
 const rows='<row r="1" ht="28" customHeight="1">'+rptValue(rptCell(model.title+' · '+sheet.name,9),0,1)+'</row><row r="2" ht="'+metaHeight+'" customHeight="1">'+rptValue(rptCell(model.meta,10),0,2)+'</row><row r="3" ht="'+headerHeight+'" customHeight="1">'+sheet.columns.map((c,i)=>rptValue(rptCell(c[0],1),i,3)).join('')+'</row>'+sheet.rows.map((values,index)=>'<row r="'+(index+4)+'" ht="'+rptRowHeight(values,sheet.columns)+'" customHeight="1">'+values.map((v,i)=>rptValue(v,i,index+4,index%2===1)).join('')+'</row>').join('');
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:'+last+lastRow+'"/><sheetViews><sheetView workbookViewId="0" zoomScale="90"><pane xSplit="'+freeze+'" ySplit="3" topLeftCell="'+rptColumn(freeze)+'4" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>'+sheet.columns.map((c,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+c[1]+'" customWidth="1"'+(c[2]?' hidden="1"':'')+'/>').join('')+'</cols><sheetData>'+rows+'</sheetData><autoFilter ref="A3:'+last+lastRow+'"/><mergeCells count="2"><mergeCell ref="A1:'+last+'1"/><mergeCell ref="A2:'+last+'2"/></mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}
export function xlsxParts(model){
 const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships/',main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const parts=[{name:'[Content_Types].xml',data:xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+model.sheets.map((s,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'},
 {name:'_rels/.rels',data:xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+rel+'officeDocument" Target="xl/workbook.xml"/></Relationships>'},
 {name:'xl/workbook.xml',data:xml+'<workbook xmlns="'+main+'" xmlns:r="'+rel.slice(0,-1)+'"><bookViews><workbookView/></bookViews><sheets>'+model.sheets.map((s,i)=>'<sheet name="'+rptXml(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets><definedNames>'+model.sheets.map((s,i)=>'<definedName name="_xlnm.Print_Titles" localSheetId="'+i+'">'+rptXml("'"+s.name.replace(/'/g,"''")+"'!$1:$3")+'</definedName>').join('')+'</definedNames></workbook>'},
 {name:'xl/_rels/workbook.xml.rels',data:xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+model.sheets.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+rel+'worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(model.sheets.length+1)+'" Type="'+rel+'styles" Target="styles.xml"/></Relationships>'},
 {name:'xl/styles.xml',data:rptStyles()},...model.sheets.map((s,i)=>({name:'xl/worksheets/sheet'+(i+1)+'.xml',data:rptWorksheet(s,model)}))];
 return parts;
}
function rptCRC(bytes){let crc=0xffffffff;const table=rptCRC.table||(rptCRC.table=Array.from({length:256},(_,i)=>{let v=i;for(let n=0;n<8;n++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;}));for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function xlsxBytes(model){
 return zipReportParts(xlsxParts(model));
}
export function zipReportParts(parts){
 const encoder=new TextEncoder(),entries=parts.map(p=>({name:encoder.encode(p.name),data:encoder.encode(p.data)}));
 const total=entries.reduce((n,e)=>n+30+e.name.length+e.data.length+46+e.name.length,22);if(total>64*1024*1024)throw Error('Файл Excel перевищує 64 МБ. Оберіть групу або тест.');
 const out=new Uint8Array(total),view=new DataView(out.buffer);let pos=0;
 const u16=(at,v)=>view.setUint16(at,v,true),u32=(at,v)=>view.setUint32(at,v,true);
 for(const e of entries){e.offset=pos;e.crc=rptCRC(e.data);u32(pos,0x04034b50);u16(pos+4,20);u16(pos+6,0x800);u16(pos+8,0);u16(pos+12,0x21);u32(pos+14,e.crc);u32(pos+18,e.data.length);u32(pos+22,e.data.length);u16(pos+26,e.name.length);out.set(e.name,pos+30);out.set(e.data,pos+30+e.name.length);pos+=30+e.name.length+e.data.length;}
 const start=pos;
 for(const e of entries){u32(pos,0x02014b50);u16(pos+4,20);u16(pos+6,20);u16(pos+8,0x800);u16(pos+14,0x21);u32(pos+16,e.crc);u32(pos+20,e.data.length);u32(pos+24,e.data.length);u16(pos+28,e.name.length);u32(pos+42,e.offset);out.set(e.name,pos+46);pos+=46+e.name.length;}
 u32(pos,0x06054b50);u16(pos+8,entries.length);u16(pos+10,entries.length);u32(pos+12,pos-start);u32(pos+16,start);return out;
}
export const XLSX_MIME=rptMime;
