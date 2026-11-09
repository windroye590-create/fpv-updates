import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.LITAKOVA_SERVER_SOURCE=new URL('../Code.gs',import.meta.url).pathname;
const {context,api,instructorToken,publicRows}=await import('./fixtures/server_model.mjs');
const checks=[];function check(name,run){run();checks.push(name);console.log('PASS '+name);}
const sheet=context.publicResultsSheet_(),book=context.publicResultsSpreadsheet_(false),props=context.PropertiesService.getScriptProperties(),cache=context.CacheService.getScriptCache();
const ready='LK_PUBLIC_LAYOUT_READY_V4_'+book.getId(),backup='LK_PUBLIC_LAYOUT_BACKUP_V1_'+book.getId();
const old=publicRows(sheet),privateBefore=JSON.stringify(context.listResults_(null));
check('The managed layout puts group, date, status and final grade first',()=>{assert.deepEqual(sheet.rows[0].slice(0,9),['ПІБ курсанта','Група','Тест','Дата завершення','Результат','Підсумковий бал, %','Набрано балів','Максимум балів','Час проходження']);assert.ok(sheet.hiddenColumns.has(14)&&sheet.hiddenColumns.has(15));});
sheet.rows=old.map((r,i)=>r.slice(0,12).concat(i===0?'Ручна формула':'=SUM(1,'+i+')'));sheet.maxColumns=13;
props.deleteProperty(ready);props.deleteProperty(backup);props.deleteProperty('LK_EXCEL_LAYOUT_ARMED_V1');cache.remove('LK_SCHEMA_EXCEL_V1');context.publicLayouts_=[];context.publicResultsSheetCache_=null;
check('Background traffic cannot migrate the sheet before deployment health is confirmed',()=>{api('GET','/api/groups');assert.equal(sheet.rows[0][1],'Правильних');assert.equal(JSON.parse(context.doGet().text).formattedResultsReady,false);});
check('The new server can still publish into the previous layout while rollout is unarmed',()=>{
 const result=context.listResults_(null)[0];context.publishVisibleResult_(result);const row=sheet.rows.find(r=>String(r[7])===String(result.id));assert.equal(row[4],result.choiceTotal?Math.round(result.correct*100/result.choiceTotal):'');assert.equal(row[3],context.formatDuration_(result.durationSeconds));
});
const move=sheet.moveColumns;let moved=0;
sheet.moveColumns=function(...args){move.apply(this,args);if(++moved===1)throw Error('Lost move acknowledgement');};
check('A partial column move keeps a recoverable backup and does not block private results',()=>{
 api('GET','/api/groups','',{initializeReports:true});assert.equal(JSON.parse(context.doGet().text).formattedResultsReady,false);assert.ok(book.getSheetByName(props.getProperty(backup)));assert.equal(JSON.stringify(context.listResults_(null)),privateBefore);assert.ok(api('GET','/api/workspace',instructorToken).user);
});
sheet.moveColumns=move;props.deleteProperty('LK_PUBLIC_FORMAT_RETRY_V4');
check('Retry resumes the same migration and preserves result identities and manual formulas',()=>{
 api('GET','/api/groups','',{initializeReports:true});assert.equal(JSON.parse(context.doGet().text).formattedResultsReady,true);
 const rows=publicRows(sheet);assert.equal(rows.length,old.length);const note=sheet.rows[0].indexOf('Ручна формула');assert.equal(note,15);
 old.slice(1).forEach((r,i)=>{assert.deepEqual(rows[i+1].slice(6,8),r.slice(6,8));assert.equal(sheet.rows[i+1][note],'=SUM(1,'+(i+1)+')');});
 assert.equal(JSON.stringify(context.listResults_(null)),privateBefore);
});
check('Repeating formatting creates neither duplicates nor extra migration copies',()=>{const rows=JSON.stringify(sheet.rows),count=book.getSheets().length;context.ensurePublicResultsSheet_(book);context.ensurePublicResultsSheet_(book);assert.equal(JSON.stringify(sheet.rows),rows);assert.equal(book.getSheets().length,count);assert.equal(sheet.getConditionalFormatRules().length,3);});
check('A manual column inserted between managed columns is preserved by reconciliation',()=>{
 const saved=sheet.rows.map(r=>[...r]),capacity=sheet.maxColumns;
 try{sheet.insertColumnsAfter(2,1);sheet.rows[0][2]='Нотатка всередині';sheet.rows.slice(1).forEach(r=>r[2]='Зберегти');context.publicLayouts_=[];const result=context.listResults_(null)[0],rid=sheet.rows[0].indexOf('_ID результату'),index=sheet.rows.findIndex(r=>String(r[rid])===String(result.id));context.writePublicRows_(sheet,index+1,[context.publicResultValues_(result)]);assert.equal(sheet.rows[index][2],'Зберегти');assert.equal(publicRows(sheet)[index][11],result.score);}finally{sheet.rows=saved;sheet.maxColumns=capacity;context.publicLayouts_=[];}
});
check('Google Sheets Date-valued durations are read through their displayed total minutes',()=>{
 const time=sheet.rows[0].indexOf('Час проходження'),row=sheet.rows[1],saved=row[time],proto=Object.getPrototypeOf(sheet.getRange(1,1)),display=proto.getDisplayValues;
 try{row[time]=new Date(Date.UTC(1899,11,30,1,1,1));proto.getDisplayValues=function(){if(this.sheet===sheet&&this.column===time+1)return Array.from({length:this.rowCount},()=>['61:01']);return display.call(this);};assert.equal(publicRows(sheet)[1][3],context.formatDuration_(3661));}finally{row[time]=saved;proto.getDisplayValues=display;}
});
check('Growing the sheet extends its filter and preserves existing criteria',()=>{
 const saved=sheet.rows.map(r=>[...r]),capacity=sheet.maxColumns,height=sheet.maxRows,filter=sheet.filter,bandings=sheet.bandings.slice(),rules=sheet.rules.slice();
 try{sheet.maxRows=sheet.getLastRow();sheet.filter=null;const selection={kind:'opaque-filter-criterion'};sheet.getRange(1,1,sheet.maxRows,15).createFilter().setColumnFilterCriteria(2,selection);const previous=sheet.maxRows;context.appendPublicRow_(sheet,context.publicPlaceholder_({id:'grid-test',fullName:'Новий рядок',groupName:'А'}));assert.equal(sheet.maxRows,previous+250);assert.equal(sheet.getFilter().getRange().getNumRows(),sheet.maxRows);assert.equal(sheet.getFilter().getColumnFilterCriteria(2),selection);}finally{sheet.rows=saved;sheet.maxColumns=capacity;sheet.maxRows=height;sheet.filter=filter;sheet.bandings=bandings;sheet.rules=rules;context.publicLayouts_=[];}
});
check('Duplicate managed headers are rejected before a writer can confuse identities',()=>{
 const saved=sheet.rows[0].slice();try{sheet.rows[0][15]='_ID курсанта';assert.throws(()=>context.ensurePublicResultsSheet_(book),e=>e.code==='PUBLIC_RESULTS_SCHEMA');}finally{sheet.rows[0]=saved;context.publicLayouts_=[];}
});
fs.writeFileSync(new URL('../verification/public-sheet-v4.json',import.meta.url),JSON.stringify({status:'passed',passed:checks.length,checks,productionRequests:0,partialMigrationRecovery:true},null,2));
