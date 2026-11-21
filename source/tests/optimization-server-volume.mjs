// Isolated Apps Script read-volume measurement; never contacts production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
process.env.LITAKOVA_SERVER_SOURCE=process.env.LITAKOVA_OPT_SERVER_SOURCE||new URL('../Code.gs',import.meta.url).pathname;
const {api,context,instructorToken}=await import('./fixtures/server_model.mjs');
const sheet=context.sheet_('results');sheet.rows=sheet.rows.slice(0,1);
for(let i=0;i<12000;i++)sheet.appendRow(['bench-r'+i,'bench-u'+i%300,'Курсант '+i%300,'Група','bench-test','Тест',80,8,10,60,'2026-11-20T00:00:00Z',true,'bench-s'+i,'{}',0,false,i<20?'pending_review':'graded',8,10,10,i<20?1:0,0,'',false,'','','']);
context.PropertiesService.getScriptProperties().setProperty('LK_REV_results','benchmark-stable');context.invalidatePublicSync_();
for(let i=0;i<300;i++)context.sheet_('users').appendRow(['bench-u'+i,'bench-login'+i,'Курсант '+i,'Група','cadet','','',true,'','']);
let calls=0,cells=0,bytes=0,responseBytes=0;
const proto=Object.getPrototypeOf(sheet.getRange(1,1)),original=proto.getValues;
proto.getValues=function(){const rows=original.call(this);calls++;cells+=this.rowCount*this.columnCount;bytes+=Buffer.byteLength(JSON.stringify(rows));return rows;};
let rpc=0;
function request(known){rpc++;const r=api('GET','/api/instructor/reviews',instructorToken,{reviewQueueProtocol:2,includeRecoveries:true,...(known===undefined?{}:{knownResultsRevision:known})});responseBytes+=Buffer.byteLength(JSON.stringify(r));if(r.reviewQueueProtocol!==2){rpc++;const extra=api('GET','/api/instructor/exam-recoveries',instructorToken);responseBytes+=Buffer.byteLength(JSON.stringify(extra));}return r;}
const first=request();assert.equal(first.results.length,20);
calls=0;cells=0;bytes=0;responseBytes=0;rpc=0;const at=performance.now();
for(let i=0;i<4;i++){const r=request(first.resultsRevision);if(r.reviewQueueProtocol===2)assert.equal(r.unchanged,true);else assert.equal(r.results.length,20);}
proto.getValues=original;
const report={kind:'isolated_spreadsheet_read_volume',results:12000,unchangedRefreshes:4,rpc,rangeReads:calls,cells,readBytes:bytes,responseBytes,milliseconds:performance.now()-at,liveGoogleCapacityMeasured:false};
fs.writeFileSync(process.env.LITAKOVA_OPT_OUTPUT||new URL('../verification/optimization-server-volume.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
