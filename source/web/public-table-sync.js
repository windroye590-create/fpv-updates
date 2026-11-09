// Shared-table publication is independent of accepting the cadet's answers.
export function createPublicTableSync({session,account,rpc,changed=()=>{},now=Date.now}){
 let flight=null,lastPoll=0;
 function observe(reply,token){
  if(!session()||session().token!==token)return false;
  let value=reply?.publicTableSync;
  if(value){
   if(value.protocol!==1||!['pending','synced'].includes(value.state)||!Number.isSafeInteger(value.pendingCount)||value.pendingCount<0||(value.state==='synced')!==(value.pendingCount===0))return false;
   value={protocol:1,state:value.state,pendingCount:value.pendingCount};
  }else if(reply?.tableSynced===false)value={protocol:1,state:'pending',pendingCount:Math.max(1,account().publicTableSync?.pendingCount||0)};
  else return false;
  const a=account();if(JSON.stringify(a.publicTableSync)===JSON.stringify(value))return false;
  a.publicTableSync=value;changed();return true;
 }
 async function tick(force=false){
  const s=session();if(!s||account().publicTableSync?.state!=='pending')return;
  if(flight?.token===s.token)return flight.promise;
  if(!force&&now()-lastPoll<10000)return;
  lastPoll=now();const current={token:s.token,promise:null};
  current.promise=(async()=>{try{const r=await rpc('GET','/api/public-table-sync',{},s.token);observe(r,s.token);}catch{/* Keep the warning until a valid acknowledgement. */}finally{if(flight===current)flight=null;}})();
  flight=current;return current.promise;
 }
 return {observe,tick};
}
