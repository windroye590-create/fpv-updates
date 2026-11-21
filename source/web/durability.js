// A failed write remains visible until a later disk acknowledgement succeeds.
export function createDurableWriter(write,changed=()=>{}){
 let requested=0,accepted=0,error='',running=false,queued=[];
 const status=()=>({pending:requested>accepted,error,requested,accepted});
 function schedule(){if(running)return;running=true;void Promise.resolve().then(drain);}
 async function drain(){
  try{while(queued.length){
   const batch=queued;queued=[];const target=batch[batch.length-1].n;
   // All callers in this batch requested the same still-pending full snapshot.
   // Requests arriving during the write need a separate disk acknowledgement.
   try{await write();accepted=target;error='';for(const w of batch)w.resolve();}
   catch(x){error=x.message||'Не вдалося зберегти дані на диску.';for(const w of batch)w.reject(x);}
   changed(status());
  }}finally{running=false;if(queued.length)schedule();}
 }
 return {status,save(){const n=++requested;
  const promise=new Promise((resolve,reject)=>queued.push({n,resolve,reject}));changed(status());schedule();
  return promise;
 }};
}
