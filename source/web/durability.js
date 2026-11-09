// A failed write remains visible until a later disk acknowledgement succeeds.
export function createDurableWriter(write,changed=()=>{}){
 let tail=Promise.resolve(),requested=0,accepted=0,error='';
 const status=()=>({pending:requested>accepted,error,requested,accepted});
 return {status,save(){const n=++requested;changed(status());
  tail=tail.catch(()=>{}).then(async()=>{try{await write();accepted=n;error='';}catch(x){error=x.message||'Не вдалося зберегти дані на диску.';throw x;}finally{changed(status());}});
  return tail;
 }};
}
