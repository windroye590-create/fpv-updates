import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
export const root=path.resolve(process.env.LITAKOVA_AUDIT_SOURCE||new URL('../../',import.meta.url).pathname);
process.env.LITAKOVA_SERVER_SOURCE=path.join(root,'Code.gs');
export const C=await import(pathToFileURL(path.join(root,'web/core.js')));
export const model=await import(pathToFileURL(path.join(root,'tests/fixtures/server_model.mjs')));
export const app=fs.readFileSync(path.join(root,'web/app.js'),'utf8');
export const evidence=pathToFileURL(path.join(root,'verification/storage-recovery/'));
fs.mkdirSync(evidence,{recursive:true});
export const clone=v=>JSON.parse(JSON.stringify(v));
export function appFunction(name){const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));if(start<0)throw Error('Missing application function '+name);const next=app.slice(start+1).search(/\n(?:async )?function /);return next<0?app.slice(start):app.slice(start,start+1+next);}
export function install(box,names){vm.createContext(box);for(const name of names)vm.runInContext(appFunction(name),box);return box;}
export function audit(name){
 const checks=[],requests=[];
 function raw(method,path,token='',body={},extra={}){const reply=JSON.parse(model.context.doPost({postData:{contents:JSON.stringify({action:'api',method,path,token,body,writtenProtocol:1,choiceProtocol:2,...extra})}}).text);requests.push({method,path,ok:reply.ok,code:reply.code||null});return reply;}
 function api(...args){const r=raw(...args);if(!r.ok)throw Object.assign(Error(r.error),{code:r.code,retryAfterSeconds:r.retryAfterSeconds});return r;}
 async function check(label,fn){try{await fn();checks.push({name:label,status:'passed'});console.log('PASS '+label);}catch(e){checks.push({name:label,status:'failed',error:e.stack});console.log('FAIL '+label+' — '+e.message);}}
 function finish(details={}){const passed=checks.filter(x=>x.status==='passed').length;const result={scope:name,status:passed===checks.length?'passed':'findings',passed,failed:checks.length-passed,checks,requests:requests.length,requestLog:requests,sourceSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'Code.gs'))).digest('hex'),productionRequests:0,windowsRuntimeVerified:false,...details};fs.writeFileSync(new URL(name+'.json',evidence),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({scope:name,passed,failed:result.failed,requests:requests.length}));if(result.failed)process.exitCode=1;return result;}
 return {raw,api,check,finish,requests};
}
