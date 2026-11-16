// Isolated UI fixtures model the native window endpoints separately from files
// and cloud RPC. The native parser and window state have their own C tests.
export function handleHostWindow(req,res){
 const path=new URL(req.url,'http://fixture').pathname;
 if(req.method!=='POST'||!['/window/open','/window/close'].includes(path))return false;
 req.resume();
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({ok:true,windowLifecycleProtocol:1}));
 return true;
}
