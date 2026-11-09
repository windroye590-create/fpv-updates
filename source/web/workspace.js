export function workspaceRequest(a,allResults=false,force=false,now=Date.now()){
 const full=force||!a.workspaceFullAt||now-a.workspaceFullAt>=300000;
 const known=full?{}:{...a.workspaceRevisions};
 if(!full&&allResults&&a.fullResultsRevision)known.results=a.fullResultsRevision+':all';
 return {known,allResults};
}
export function readWorkspace(r,s){
 const bad=()=>{throw Object.assign(Error('Сервер повернув некоректні дані кабінету.'),{code:'BAD_WORKSPACE'});};
 if(r.workspaceProtocol!==1||!r.user||String(r.user.id)!==String(s.user.id)||r.user.role!==s.user.role||!r.revisions||!r.changes)bad();
 for(const [k,v] of Object.entries(r.revisions))if(typeof v!=='string'||!v.length)bad();
 for(const [k,v] of Object.entries(r.changes))if(!['groups','tests','cadets','results'].includes(k)||!Array.isArray(v))bad();
 if(s.user.role==='cadet'&&(r.changes.cadets||r.changes.results?.some(v=>String(v.userId)!==String(s.user.id))))bad();
 if(r.resultTotal!==undefined&&(!Number.isInteger(r.resultTotal)||r.resultTotal<0))bad();
 if(r.deletedResults!==undefined&&(!Array.isArray(r.deletedResults)||r.deletedResults.some(item=>
  !item||typeof item.id!=='string'||!item.id||(s.user.role==='cadet'&&(typeof item.testId!=='string'||!item.testId))
 )))bad();
 return r;
}
