// Office files are parsed locally. Only reviewed test data is sent on publication.
export const OFFICE_MAX_BYTES=8*1024*1024;
const fail=message=>{throw Error(message);};
const tidy=v=>String(v??'').replace(/\u00a0/g,' ').trim();
const normal=v=>tidy(v).toLocaleLowerCase('uk').replace(/[\s_.:—–-]/g,'');
const labels=['А','Б','В','Г','Д','Е'];
export function answerIndex(value){const s=tidy(value).toUpperCase();if(/^[1-6]$/.test(s))return +s-1;const c=labels.indexOf(s);return c>=0?c:'ABCDEF'.indexOf(s.length===1?s:'?');}
export function importQuestionError(q){
 if(!q.text.trim())return 'Заповніть текст питання.';
 if(q.text.trim().length>1000)return 'Текст питання перевищує 1000 символів.';
 if(q.type==='written')return Number.isInteger(q.maxPoints)&&q.maxPoints>=1&&q.maxPoints<=100?'':'Максимум балів: від 1 до 100.';
 if(q.answers.length<2||q.answers.length>6||q.answers.some(a=>!a.text.trim()))return 'Заповніть усі варіанти відповіді.';
 if(q.answers.some(a=>a.text.trim().length>500))return 'Варіант відповіді перевищує 500 символів.';
 if(![1,2].includes(q.answers.filter(a=>a.isCorrect).length))return 'Позначте одну або дві правильні відповіді.';
 if((q.explanation||'').length>2000)return 'Пояснення перевищує 2000 символів.';
 return '';
}
function finalize(title,questions,warnings,source){
 if(!questions.length)fail('Питань не знайдено. Скористайтеся зразком Word або Excel. Для сканів спочатку розпізнайте текст.');
 if(questions.length>200)fail('У файлі понад 200 питань. Розділіть його на окремі тести.');
 const seen=new Set();questions.forEach((q,i)=>{const key=normal(q.text);if(key&&seen.has(key))warnings.push(`Питання ${i+1}: текст повторюється. Перевірте або видаліть копію.`);seen.add(key);});
 return {title:tidy(title),questions,warnings:[...new Set(warnings)].slice(0,30),source:source.slice(0,180)};
}
function applyKey(q,key,warnings,location){
 if(!tidy(key))return;
 const direct=q.answers.map((a,i)=>normal(a.text)===normal(key)?i:-1).filter(i=>i>=0);
 const tokens=tidy(key).split(/\s*(?:[,;+\/]|\s+(?:і|та|and)\s+)\s*/iu);
 const indices=direct.length===1?[direct[0]]:tokens.map(answerIndex);
 if(indices.length<1||indices.length>2||new Set(indices).size!==indices.length||indices.some(index=>index<0||index>=q.answers.length||!q.answers[index].text.trim())){warnings.push(`${location}: не вдалося визначити одну або дві правильні відповіді «${tidy(key).slice(0,60)}». Позначте їх вручну.`);return;}
 q.answers.forEach((a,i)=>a.isCorrect=indices.includes(i));
}
function question(text='',answers=[]){return {id:'0',text,explanation:'',answers:answers.map(text=>({id:'0',text,isCorrect:false}))};}
export function parseWordLines(lines,filename){
 const questions=[],warnings=[],numbers=[],keys=new Map();let current=null,last=-1,keyMode=false,title=filename.replace(/\.[^.]+$/,'');
 function key(number,value){const n=+number,values=keys.get(n)||[];values.push(tidy(value));keys.set(n,values);}
 for(const raw of lines){for(const rawLine of String(raw).split(/\r?\n/)){
  const line=tidy(rawLine);if(!line)continue;
  const name=line.match(/^Назва\s+тесту\s*:\s*(.+)$/iu);if(name&&!current){title=name[1];continue;}
  let keyHeader=line.match(/^(?:Правильні\s+відповіді|Ключі?(?:\s+відповідей)?|Відповіді)\s*:?\s*(.*)$/iu);
  if(keyHeader&&keyHeader[1]&&!/^\d+\s*[—–\-.:)]/u.test(keyHeader[1]))keyHeader=null;
  if(keyHeader){keyMode=true;if(!keyHeader[1])continue;}
  if(keyMode){const value=keyHeader?keyHeader[1]:line;for(const entry of value.split(/[,;](?=\s*\d+\s*[—–\-.:)])/)){const m=entry.trim().match(/^(\d+)\s*[—–\-.:)]\s*(.+)$/u);if(m)key(m[1],m[2]);else warnings.push('Не розпізнано рядок ключів: '+entry.slice(0,80));}continue;}
  const correct=line.match(/^(?:Правильна\s+відповідь|Правильні\s+відповіді|Відповідь)\s*[:—–-]\s*(.+)$/iu);
  if(correct){if(current)key(numbers.at(-1),correct[1]);else warnings.push('Ключ відповіді перед першим питанням.');last=-1;continue;}
  const start=line.match(/^(?:Питання\s+)?(\d{1,4})\s*[.):]\s*(.*)$/iu);
  if(start){current=question(start[2]);questions.push(current);numbers.push(+start[1]);last=-1;if(questions.length>200)fail('У файлі понад 200 питань.');continue;}
  const option=line.match(/^([АБВГДЕABCDEF])\s*[).:—–-]\s*(.*)$/iu);
  if(option&&current){const i=answerIndex(option[1]);while(current.answers.length<=i)current.answers.push({id:'0',text:'',isCorrect:false});if(current.answers[i].text)warnings.push(`Питання ${numbers.at(-1)}: повторна позначка ${option[1]}. Перевірте варіант.`);current.answers[i].text+=(current.answers[i].text?'\n':'')+option[2];last=i;continue;}
  if(current){if(last>=0)current.answers[last].text+='\n'+line;else current.text+=(current.text?'\n':'')+line;}
 }}
 questions.forEach((q,i)=>{
  while(q.answers.length<2)q.answers.push({id:'0',text:'',isCorrect:false});
  const n=numbers[i],values=keys.get(n)||[];
  if(numbers.filter(v=>v===n).length>1){warnings.push(`Номер ${n} повторюється. Позначте правильні відповіді цих питань вручну.`);return;}
  const indices=[...new Set(values.map(v=>String(answerIndex(v)>=0?answerIndex(v):normal(v))))];
  if(indices.length>1){warnings.push(`Питання ${n}: суперечливі ключі. Позначте відповідь вручну.`);return;}
  applyKey(q,values[0],warnings,`Питання ${n}`);
 });
 for(const n of keys.keys())if(!numbers.includes(n))warnings.push(`У ключах є номер ${n}, якого немає серед питань.`);
 return finalize(title,questions,warnings,filename);
}
function headerMap(row){
 const map={answers:[]};row.forEach((cell,i)=>{const v=normal(cell.value??cell);
  if(['питання','запитання','текстпитання','question'].includes(v))map.question=i;
  if(['правильна','правильнавідповідь','відповідь','correct','correctanswer'].includes(v))map.correct=i;
  if(['пояснення','explanation'].includes(v))map.explanation=i;
  const letter=answerIndex(tidy(cell.value??cell)),n=v.match(/^(?:варіант|відповідь)([1-6])$/u);const a=n?+n[1]-1:letter;
  if(a>=0)map.answers[a]=i;
 });return map.question!==undefined&&map.answers.filter(v=>v!==undefined).length>=2?map:null;
}
export function parseSheetRows(sheets,filename){
 const questions=[],warnings=[];let used=0;
 for(const sheet of sheets){let header=null,start=-1;for(let i=0;i<Math.min(30,sheet.rows.length);i++){header=headerMap(sheet.rows[i].cells??sheet.rows[i]);if(header){start=i;break;}}
  if(!header){if(sheet.name!=='Інструкція'&&sheet.rows.some(r=>(r.cells??r).some(c=>tidy(c.value??c))))warnings.push(`Аркуш «${sheet.name}»: не знайдено таблицю питань.`);continue;}
  used++;
  for(let i=start+1;i<sheet.rows.length;i++){
   const row=sheet.rows[i],cells=row.cells??row,loc=`${sheet.name}, рядок ${row.number??i+1}`;
   const value=index=>{const cell=cells[index];if(cell?.formula){warnings.push(`${loc}: формулу потрібно замінити значенням або заповнити поле в редакторі.`);return '';}return tidy(cell?.value??cell);};
   const answers=Array.from({length:Math.max(2,header.answers.length)},(_,j)=>header.answers[j]===undefined?'':value(header.answers[j]));
   const text=value(header.question),correct=header.correct===undefined?'':value(header.correct);
   if(!text&&!answers.some(Boolean)&&!correct&&![header.question,...header.answers,header.correct].some(index=>cells[index]?.formula))continue;
   const q=question(text,answers);q.explanation=header.explanation===undefined?'':value(header.explanation);applyKey(q,correct,warnings,loc);questions.push(q);
   if(questions.length>200)fail('У файлі понад 200 питань. Розділіть його на окремі тести.');
  }
 }
 if(used>1)warnings.unshift(`Питання об’єднано з ${used} таблиць. Перевірте склад тесту.`);
 return finalize(filename.replace(/\.[^.]+$/,''),questions,warnings,filename);
}
let crcTable;
function crc32(bytes){crcTable??=Uint32Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
async function archive(bytes){
 if(bytes.length>OFFICE_MAX_BYTES)fail('Файл завеликий. Максимум — 8 МБ.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=n=>view.getUint16(n,true),u32=n=>view.getUint32(n,true);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
 if(end<0)fail('Файл Office пошкоджено або захищено паролем. Збережіть відкритий документ як .docx чи .xlsx.');
 const count=u16(end+10),size=u32(end+12),offset=u32(end+16);
 if(u16(end+4)||u16(end+6)||u16(end+8)!==count||count>512||offset+size!==end)fail('Непідтримуваний або завеликий файл Office.');
 const entries=new Map();let at=offset,total=0;
 for(let n=0;n<count;n++){
  if(at+46>end||u32(at)!==0x02014b50)fail('Пошкоджена структура файлу Office.');
  const flags=u16(at+8),method=u16(at+10),crc=u32(at+16),compressed=u32(at+20),uncompressed=u32(at+24),len=u16(at+28),extra=u16(at+30),comment=u16(at+32),local=u32(at+42);
  if(at+46+len+extra+comment>end)fail('Пошкоджений запис Office.');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at+46,at+46+len));
  if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||name.includes('\0')||entries.has(name))fail('Некоректні шляхи у файлі Office.');
  total+=uncompressed;if(flags&1||uncompressed>OFFICE_MAX_BYTES||total>32*1024*1024||local+30>offset||u32(local)!==0x04034b50)fail('Файл Office захищено або перевищує ліміт розпакування.');
  const localLen=u16(local+26),start=local+30+localLen+u16(local+28);
  if(u16(local+8)!==method||u16(local+6)!==flags||start+compressed>offset||new TextDecoder().decode(bytes.subarray(local+30,local+30+localLen))!==name)fail('Пошкоджені дані Office.');
  entries.set(name,{method,crc,compressed,uncompressed,start});at+=46+len+extra+comment;
 }
 if(at!==end)fail('Пошкоджений каталог Office.');let expanded=0;
 return {has:name=>entries.has(name),async read(name){const e=entries.get(name);if(!e)return null;let output;
  if(e.method===0)output=bytes.slice(e.start,e.start+e.compressed);
  else if(e.method===8){if(typeof DecompressionStream==='undefined')fail('Оновіть Microsoft Edge або Chrome для імпорту Office.');
   const reader=new Blob([bytes.subarray(e.start,e.start+e.compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let length=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>e.uncompressed||length>OFFICE_MAX_BYTES){await reader.cancel();fail('Перевищено ліміт розпакування Office.');}chunks.push(value);}}finally{reader.releaseLock();}
   output=new Uint8Array(length);let n=0;for(const c of chunks){output.set(c,n);n+=c.length;}
  }else fail('Непідтримуване стиснення Office. Перезбережіть файл у Word або Excel.');
  expanded+=output.length;if(output.length!==e.uncompressed||crc32(output)!==e.crc||expanded>16*1024*1024)fail('Пошкоджено вміст або перевищено ліміт Office.');return output;
 }};
}
function xml(bytes){
 if(!bytes)fail('У файлі Office бракує потрібної частини.');
 if(bytes.length>4*1024*1024)fail('Текстова частина Office завелика.');
 const utf16=(bytes[0]===255&&bytes[1]===254||bytes[0]===60&&bytes[1]===0)?'utf-16le':(bytes[0]===254&&bytes[1]===255||bytes[0]===0&&bytes[1]===60)?'utf-16be':'utf-8';const text=new TextDecoder(utf16,{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(text))fail('Документ містить непідтримувані XML-оголошення.');
 const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length||doc.getElementsByTagName('*').length>150000)fail('Некоректний або завеликий XML у файлі Office.');
 const stack=[[doc.documentElement,0]];while(stack.length){const [node,depth]=stack.pop();if(depth>128)fail('Надто складна структура документа Office.');for(const c of node.children)stack.push([c,depth+1]);}return doc;
}
const all=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
const children=(node,name)=>Array.from(node.children||[]).filter(n=>n.localName===name);
const first=(node,name)=>all(node,name)[0];
const attr=(node,name)=>node?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main',name)||node?.getAttribute(name)||'';
function wordText(p){let text='';function visit(n){if(n.nodeType!==1)return;if(n.localName==='del'||n.localName==='drawing'||n.localName==='pict')return;if(n.localName==='t'){text+=n.textContent;return;}if(n.localName==='tab'){text+=' ';return;}if(n.localName==='br'||n.localName==='cr'){text+='\n';return;}for(const child of n.childNodes)visit(child);}visit(p);return text;}
async function word(zip,name){
 const doc=xml(await zip.read('word/document.xml')),tables=all(doc,'tbl').map((t,i)=>({name:'Таблиця '+(i+1),rows:children(t,'tr').map(r=>children(r,'tc').map(c=>all(c,'p').map(wordText).join('\n')))}));
 const mapped=tables.filter(t=>t.rows.slice(0,30).some(headerMap));
 let result;
 if(mapped.length){
  if(all(doc,'p').some(p=>{let parent=p.parentElement;while(parent){if(parent.localName==='tbl')return false;parent=parent.parentElement;}return /^\s*(?:Питання\s+)?\d+\s*[.):]/iu.test(wordText(p));}))fail('У Word змішано питання в таблицях і звичайному тексті. Залиште один спосіб оформлення в одному файлі.');
  result=parseSheetRows(mapped,name);
 }
 else{
  const numbering=zip.has('word/numbering.xml')?xml(await zip.read('word/numbering.xml')):null,formats=new Map(),nums=new Map(),counters=new Map(),overrides=new Map(),styles=new Map();
  if(zip.has('word/styles.xml'))for(const s of all(xml(await zip.read('word/styles.xml')),'style'))styles.set(attr(s,'styleId'),s);
  if(numbering){for(const a of all(numbering,'abstractNum')){const levels=new Map();for(const l of children(a,'lvl'))levels.set(attr(l,'ilvl'),{format:attr(first(l,'numFmt'),'val'),start:+attr(first(l,'start'),'val')||1});formats.set(attr(a,'abstractNumId'),levels);}for(const n of all(numbering,'num')){const id=attr(n,'numId');nums.set(id,attr(first(n,'abstractNumId'),'val'));for(const l of children(n,'lvlOverride')){const v=+attr(first(l,'startOverride'),'val');if(v>0)overrides.set(id+':'+attr(l,'ilvl'),v);}}}
  const lines=all(doc,'p').map(p=>{let text=wordText(p),pr=first(p,'numPr'),style=styles.get(attr(first(p,'pStyle'),'val'));for(let i=0;!pr&&style&&i<12;i++){pr=first(style,'numPr');style=styles.get(attr(first(style,'basedOn'),'val'));}if(pr&&!/^\s*(?:(?:Питання\s+)?\d+\s*[.):]|[АБВГДЕABCDEF]\s*[).:])/iu.test(text)){const num=attr(first(pr,'numId'),'val'),level=attr(first(pr,'ilvl'),'val')||'0',f=formats.get(nums.get(num))?.get(level),key=num+':'+level;
    if(f){const count=(counters.get(key)??(overrides.get(key)??f.start)-1)+1;counters.set(key,count);for(const k of counters.keys())if(k.startsWith(num+':')&&+k.split(':')[1]>+level)counters.delete(k);text=(/letter/i.test(f.format)?String.fromCharCode(64+count)+') ':/russian/i.test(f.format)?(labels[count-1]||'?')+') ':count+'. ')+text;}}
   return text;});result=parseWordLines(lines,name);
 }
 if(all(doc,'drawing').length||all(doc,'pict').length)result.warnings.push('Зображення з Word не перенесено. Перевірте, чи всі питання зрозумілі без них.');
 if(all(doc,'del').length||all(doc,'ins').length)result.warnings.push('У Word є виправлення. Імпортовано видимий текст з урахуванням вставок; перевірте його.');return result;
}
async function excel(zip,name){
 const workbook=xml(await zip.read('xl/workbook.xml')),rels=xml(await zip.read('xl/_rels/workbook.xml.rels')),relationships=new Map();
 for(const r of all(rels,'Relationship')){if(r.getAttribute('TargetMode')==='External')continue;const target=r.getAttribute('Target');if(!target||target.includes('..')||target.includes('\\'))continue;relationships.set(r.getAttribute('Id'),target.startsWith('/')?target.slice(1):'xl/'+target);}
 const strings=zip.has('xl/sharedStrings.xml')?all(xml(await zip.read('xl/sharedStrings.xml')),'si').map(si=>all(si,'t').map(t=>t.textContent).join('')):[],sheets=[];
 for(const sheet of all(workbook,'sheet')){
  if(sheets.length>=12)fail('У книзі забагато аркушів. Залиште аркуші одного тесту.');
  const rel=Array.from(sheet.attributes).find(a=>a.localName==='id')?.value,path=relationships.get(rel);if(!path||!path.startsWith('xl/worksheets/')||!zip.has(path))fail('Не вдалося відкрити аркуш Excel.');
  const doc=xml(await zip.read(path)),rows=[];if(all(doc,'row').length>2000)fail('На аркуші понад 2000 рядків. Залиште один тест.');
  for(const row of all(doc,'row')){const cells=[];for(const c of children(row,'c')){const ref=c.getAttribute('r')||'',match=ref.match(/^([A-Z]{1,3})[1-9]\d*$/);if(!match)fail('Некоректна адреса клітинки Excel.');let col=0;for(const ch of match[1])col=col*26+ch.charCodeAt(0)-64;if(col>256)continue;
    const type=c.getAttribute('t'),v=first(c,'v')?.textContent||'';let value=type==='inlineStr'?all(c,'t').map(t=>t.textContent).join(''):v;
    if(type==='s'){if(!/^\d+$/.test(v)||+v>=strings.length)fail('Пошкоджений словник тексту Excel.');value=strings[+v];}if(type==='b')value=v==='1'?'TRUE':'FALSE';cells[col-1]={value,formula:!!first(c,'f')||type==='e'};}
   rows.push({number:+row.getAttribute('r'),cells});}sheets.push({name:sheet.getAttribute('name')||'Аркуш',rows});
 }
 return parseSheetRows(sheets,name);
}
export async function importOffice(filename,input){
 try{const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(!/\.(docx|xlsx)$/i.test(filename))fail('Оберіть .docx або .xlsx. Старі .doc і .xls спочатку перезбережіть у сучасному форматі.');const zip=await archive(bytes);
  if(/\.docx$/i.test(filename)){if(!zip.has('word/document.xml'))fail('Це не документ Word .docx.');return await word(zip,filename);}
  if(!zip.has('xl/workbook.xml'))fail('Це не книга Excel .xlsx.');return await excel(zip,filename);
 }catch(error){if(error instanceof TypeError||error instanceof RangeError||error?.name==='DataError')throw Error('Не вдалося прочитати Office. Файл може бути пошкоджений; перезбережіть його та повторіть.');throw error;}
}
