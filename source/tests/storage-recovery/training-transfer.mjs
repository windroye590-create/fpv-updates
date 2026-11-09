import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {audit,C,model,install,clone} from './support.mjs';
const {api,check,finish}=audit('training-transfer');
const teacher=model.instructorToken;
const group=api('POST','/api/instructor/groups',teacher,{name:'Аудит перенесення тренування'}).group;
const cadet=api('POST','/api/register','',{username:'audit_transfer',fullName:'Синтетичний курсант перенесення',groupId:group.id,...model.credential('synthetic-transfer-password')});
const t=api('POST','/api/instructor/tests',teacher,{title:'Кероване тренування',mode:'training',accessProtocol:1,questions:[{text:'Вибір',answers:[{text:'Так',isCorrect:true},{text:'Ні',isCorrect:false}]},{type:'written',text:'Пояснення',maxPoints:4,answers:[]}]}).test;
api('POST','/api/instructor/tests/'+t.id+'/access',teacher,{expectedRevision:1,scope:'all',open:true});
const sid='pc-'+crypto.randomUUID();
const start=api('POST','/api/tests/'+t.id+'/start',cadet.token,{submissionId:sid});
const answer='Точна відповідь із початкового ПК\n'.repeat(30);
const run={test:start.test,startPermit:start.startPermit,submissionId:sid,answers:{[t.questions[0].id]:[t.questions[0].answers[0].id],[t.questions[1].id]:answer},index:1,lastElapsed:37,exitCount:0,userId:String(cadet.user.id),startedUptime:1000};
const session={token:cadet.token,user:cadet.user};
const local={run:clone(run),pending:[],results:[],tests:[start.test]};
const source=install({C,S:{session},instructor:()=>false},['accountDocuments']);
const transferred=source.accountDocuments(local).training;
await check('The current cross-PC snapshot preserves every answer',()=>assert.deepEqual(clone(transferred.answers),run.answers));
await check('The current cross-PC snapshot preserves the signed start permit',()=>assert.equal(transferred.startPermit,start.startPermit));
const saved=api('POST','/api/account-state/document',cadet.token,{key:'training',expectedRevision:0,requestId:'transfer-save-0001',value:transferred});
const remote=api('GET','/api/account-state/document',cadet.token,{key:'training'}).document.value;
const other={run:null,pending:[],results:[],tests:[start.test],fullTests:{},reviews:{}};
const target=install({C,S:{session},page:'home',id:C.id,clock:{launchId:'another-pc'},uptime:()=>50000,cloudRenderNeeded:false,rpc:async(m,p,b,token)=>api(m,p,token,b),fetchTest:async id=>api('GET','/api/tests/'+id,cadet.token).test},['applyAccountDocument']);
await target.applyAccountDocument('training',remote,other);
await check('Opening the synced training on another PC preserves the answer text',()=>assert.equal(other.run.answers[t.questions[1].id],answer));
await check('The restored current-client work can be submitted to the current server',()=>{
 const body=C.submission(other.run,60000);
 const r=api('POST','/api/results',cadet.token,body);
 assert.equal(r.result.pendingWritten,1);
});
await check('The real result queue can deliver a transferred managed training',async()=>{
 other.pending=[{body:C.submission(other.run,60000),testTitle:t.title,attempts:0,nextAt:0}];
 const queue=install({C,S:{session},updateApplying:false,syncing:false,user:()=>cadet.user,instructor:()=>false,alive:()=>true,account:()=>other,id:C.id,page:'more',lastResult:null,lastError:'',rpc:async(m,p,b,token)=>api(m,p,token,b),persist:async()=>{},render:()=>{}},['syncQueue']);
 await queue.syncQueue(true);
 assert.equal(other.pending.length,0,'The restored answer remains queued with '+other.pending[0]?.failureCode);
});
await check('The initial PC can still submit the same preserved answers with its permit',()=>{
 const r=api('POST','/api/results',cadet.token,C.submission(run,40000));
 const row=model.context.resultRecordById_(r.result.id).row;
 assert.equal(JSON.parse(row[13])[t.questions[1].id],answer);
});
// A separate unfinished work proves the restore failure when the gate closes.
const closed=api('POST','/api/instructor/tests',teacher,{title:'Перенесення після закриття',mode:'training',accessProtocol:1,questions:t.questions}).test;
api('POST','/api/instructor/tests/'+closed.id+'/access',teacher,{expectedRevision:1,scope:'all',open:true});
const begun=api('POST','/api/tests/'+closed.id+'/start',cadet.token,{submissionId:'pc-'+crypto.randomUUID()});
const closedRun={...run,test:begun.test,startPermit:begun.startPermit,submissionId:begun.submissionId,answers:{[closed.questions[1].id]:answer}};
const closedValue=source.accountDocuments({run:closedRun}).training;
api('POST','/api/instructor/tests/'+closed.id+'/access',teacher,{expectedRevision:2,scope:'all',open:false});
await check('Already-started work can synchronize after an instructor closes the gate',()=>api('POST','/api/account-state/document',cadet.token,{key:'training',expectedRevision:saved.document.revision,requestId:'transfer-save-closed',value:closedValue}));
await check('Already-started work restores after closure using its existing permission',async()=>{
 const a={run:null,results:[],pending:[],tests:[begun.test]};await target.applyAccountDocument('training',closedValue,a);assert.ok(a.run);
});
finish({answerCharacters:answer.length,answersRemainInLocalRun:true,originalPermitAccepted:true,findingsAreSubmissionAndRestoreFailures:true});
