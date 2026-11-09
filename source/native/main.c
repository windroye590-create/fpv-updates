/* Native Windows x64 host. No third-party runtime and no console window.
 * Serves only 127.0.0.1 and relays only to the configured commission API URL.
 * All saved application state is encrypted with the Windows user's DPAPI.
 */
#include "winapi.h"
#include "web_assets.h"
#define MAX_BODY (8u*1024u*1024u)
// Full draft checkpoints use the same bounded JSON body limit as profile writes.
#define MAX_JOURNAL_BODY MAX_BODY
#define MAX_HEADER 16384u
#define TITLE L"FPV Комісія — ПК"
static char launch_key[65],host[64];
static WCHAR directory[1024],state_path[1100],temp_path[1100],launch_path[1100],journal_path[1100],journal_temp[1100];
static CRITICAL_SECTION store_lock;
static volatile LONG workers;
static QWORD last_ping;
static HANDLE process_heap;
static QWORD journal_serial;
static SIZE_T slen(const char *s){SIZE_T n=0;while(s[n])n++;return n;}
static void copy(void *d,const void*s,SIZE_T n){BYTE*a=d;const BYTE*b=s;for(SIZE_T i=0;i<n;i++)a[i]=b[i];}
static void zero(void*d,SIZE_T n){BYTE*a=d;for(SIZE_T i=0;i<n;i++)a[i]=0;}
static int same(const char*a,const char*b){while(*a&&*a==*b){a++;b++;}return *a==*b;}
static char lower(char c){return c>='A'&&c<='Z'?c+32:c;}
static int header_name(const char*a,const char*b){while(*b){if(lower(*a++)!=*b++)return 0;}return *a==':';}
static char*append(char*p,const char*s){while(*s)*p++=*s++;*p=0;return p;}
static char*decimal(char*p,QWORD n){char b[24];UINT c=0;do{b[c++]=(char)('0'+n%10);n/=10;}while(n);while(c)*p++=b[--c];*p=0;return p;}
static void wcopy(WCHAR*d,const WCHAR*s){while((*d++=*s++));}
static void wcat(WCHAR*d,const WCHAR*s){while(*d)d++;wcopy(d,s);}
static void widen(WCHAR*d,const char*s){while((*d++=(BYTE)*s++));}
static void*allocate(SIZE_T n){return HeapAlloc(process_heap,8,n);}
static void release(void*p){if(p)HeapFree(process_heap,0,p);}
static int send_all(SOCKET s,const char*b,DWORD n){while(n){int sent=send(s,b,(int)n,0);if(sent<=0)return 0;b+=sent;n-=(DWORD)sent;}return 1;}
static void response(SOCKET s,int status,const char*mime,const void*data,DWORD n){
 char h[1024];char*p=append(h,status==200?"HTTP/1.1 200 OK\r\n":"HTTP/1.1 400 Bad Request\r\n");
 p=append(p,"Content-Type: ");p=append(p,mime);p=append(p,"\r\nContent-Length: ");p=decimal(p,n);
 p=append(p,"\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'\r\n\r\n");
 send_all(s,h,(DWORD)(p-h));send_all(s,data,n);
}
static void json(SOCKET s,const char*body){response(s,200,"application/json; charset=utf-8",body,(DWORD)slen(body));}
static void error(SOCKET s,const char*body){response(s,400,"application/json; charset=utf-8",body,(DWORD)slen(body));}
static QWORD serial_from(const BYTE*bytes,DWORD length){
 const char*prefix="{\"serial\":";DWORD pos=0;while(prefix[pos]){if(pos>=length||bytes[pos]!=(BYTE)prefix[pos])return 0;pos++;}
 QWORD value=0;DWORD digits=0;
 while(pos<length&&bytes[pos]>='0'&&bytes[pos]<='9'){if(value>900719925474099u)return 0;value=value*10+(bytes[pos++]-'0');digits++;}
 if(!digits||value>9007199254740991u||pos>=length||bytes[pos]!=',')return 0;
 return value;
}
static BOOL save_blob(const WCHAR*path,const WCHAR*temp,const BYTE*bytes,DWORD length){
 DATA_BLOB in={length,(BYTE*)bytes},out={0,0};BOOL ok=0;
 EnterCriticalSection(&store_lock);
 QWORD serial=path==journal_path?serial_from(bytes,length):0;
 if(path==journal_path&&!serial){LeaveCriticalSection(&store_lock);return 0;}
 if(path==journal_path&&serial<=journal_serial){LeaveCriticalSection(&store_lock);return 1;}
 if(CryptProtectData(&in,TITLE,0,0,0,1,&out)){
  HANDLE file=CreateFileW(temp,0x40000000u,0,0,2,0x80,0);
  if(file!=INVALID_HANDLE){DWORD done=0;ok=WriteFile(file,out.pbData,out.cbData,&done,0)&&done==out.cbData;ok=FlushFileBuffers(file)&&ok;CloseHandle(file);if(ok)ok=MoveFileExW(temp,path,9);}
  LocalFree(out.pbData);
 }
 if(ok&&path==journal_path)journal_serial=serial;
 LeaveCriticalSection(&store_lock);return ok;
}
static void load_blob(SOCKET s,const WCHAR*path){
 EnterCriticalSection(&store_lock);
 HANDLE file=CreateFileW(path,0x80000000u,1,0,3,0x80,0);
 if(file==INVALID_HANDLE){DWORD failure=GetLastError();LeaveCriticalSection(&store_lock);if(failure==2u||failure==3u)json(s,"{}");else json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\",\"error\":\"Не вдалося відкрити збережені дані Windows. Повторіть запуск.\"}");return;}
 QWORD size=0;DWORD done=0;BYTE*buf=0;DATA_BLOB out={0,0};BOOL ok=0;
 if(GetFileSizeEx(file,&size)&&size>0&&size<MAX_BODY+1024u){buf=allocate(size);if(buf&&ReadFile(file,buf,(DWORD)size,&done,0)&&done==size){DATA_BLOB in={(DWORD)size,buf};ok=CryptUnprotectData(&in,0,0,0,0,1,&out);}}
 if(ok&&path==journal_path){QWORD serial=serial_from(out.pbData,out.cbData);if(serial>journal_serial)journal_serial=serial;}
 CloseHandle(file);release(buf);LeaveCriticalSection(&store_lock);
 if(ok){response(s,200,"application/json; charset=utf-8",out.pbData,out.cbData);LocalFree(out.pbData);}
 else json(s,"{\"ok\":false,\"code\":\"STORAGE_READ\",\"error\":\"Не вдалося прочитати збережені дані Windows.\"}");
}
static BYTE*commission_request(char*body,DWORD length,DWORD*replyLength,DWORD*replyStatus){
 HINTERNET session=WinHttpOpen(L"FPV-Komisiia-PC/1.0.15",4,0,0,0),conn=0,req=0;char*buf=0;DWORD used=0,status=0,statussize=4;BOOL ok=0;
 if(session){WinHttpSetTimeouts(session,10000,10000,15000,45000);conn=WinHttpConnect(session,L"script.google.com",443,0);}
 if(conn)req=WinHttpOpenRequest(conn,L"POST",L"/macros/s/FPV_DEPLOYMENT_NOT_CONNECTED/exec",0,0,0,0x00800000);
 if(req&&WinHttpSendRequest(req,L"Content-Type: application/json; charset=utf-8\r\nAccept: application/json\r\n",(DWORD)-1,body,length,length,0)&&WinHttpReceiveResponse(req,0)){
  WinHttpQueryHeaders(req,19|0x20000000u,0,&status,&statussize,0);
  if(status>=200&&status<300){buf=allocate(MAX_BODY+1);ok=buf!=0;while(ok){DWORD available=0,got=0;if(!WinHttpQueryDataAvailable(req,&available)){ok=0;break;}if(!available)break;if(available>MAX_BODY-used){ok=0;break;}if(!WinHttpReadData(req,buf+used,available,&got)||!got){ok=0;break;}used+=got;}if(ok){buf[used]=0;DWORD first=0;while(first<used&&(buf[first]==' '||buf[first]=='\r'||buf[first]=='\n'))first++;ok=first<used&&buf[first]=='{';}}
 }
 if(req)WinHttpCloseHandle(req);
 if(conn)WinHttpCloseHandle(conn);
 if(session)WinHttpCloseHandle(session);
 if(replyStatus)*replyStatus=status;
 if(ok){*replyLength=used;return (BYTE*)buf;}if(buf){zero(buf,used);}release(buf);return 0;
}
static void relay(SOCKET s,char*body,DWORD length){
 DWORD n=0,status=0;BYTE*buf=commission_request(body,length,&n,&status);
 if(buf)response(s,200,"application/json; charset=utf-8",buf,n);
 else if(status==429)json(s,"{\"ok\":false,\"code\":\"HTTP_429\",\"error\":\"Сервер зайнятий. Повторимо відправлення автоматично.\"}");
 else if(status==401||status==403)json(s,"{\"ok\":false,\"code\":\"HTTP_AUTH\",\"error\":\"Google обмежив доступ до сервера. Перевірте чинне розгортання.\"}");
 else if(status>=500)json(s,"{\"ok\":false,\"code\":\"HTTP_500\",\"error\":\"Сервер тимчасово недоступний. Результат залишиться у черзі.\"}");
 else json(s,"{\"ok\":false,\"code\":\"NETWORK\",\"error\":\"Не вдалося зв’язатися із сервером. Перевірте інтернет; збережені дані доступні.\"}");
 if(buf){zero(buf,n);}release(buf);
}
#include "updater.h"
#include "storage.h"

static DWORD serve(void*argument){
 SOCKET s=(SOCKET)argument;DWORD timeout=10000;setsockopt(s,0xffff,0x1006,(char*)&timeout,4);setsockopt(s,0xffff,0x1005,(char*)&timeout,4);
 char*buf=allocate(MAX_BODY+MAX_HEADER+1);DWORD used=0,head=0,length=0;char method[16]={0},path[1024]={0},client_host[64]={0},key[80]={0},origin[128]={0},capability[65]={0};int bad=0;
 if(!buf)goto done;
 while(used<MAX_HEADER){int n=recv(s,buf+used,(int)(MAX_HEADER-used),0);if(n<=0)goto done;used+=(DWORD)n;buf[used]=0;for(DWORD i=3;i<used;i++)if(buf[i-3]=='\r'&&buf[i-2]=='\n'&&buf[i-1]=='\r'&&buf[i]=='\n'){head=i+1;break;}if(head)break;}
 if(!head)goto done;
 char*p=buf;UINT j=0;while(*p&&*p!=' '&&j<15)method[j++]=*p++;if(*p++!=' ')goto done;j=0;while(*p&&*p!=' '&&j<1023)path[j++]=*p++;if(*p!=' ')goto done;
 while(p<buf+head&&*p!='\n')p++;
 if(p<buf+head)p++;
 while(p<buf+head-2){char*line=p;while(p<buf+head&&*p!='\r')p++;if(p>=buf+head)goto done;*p=0;p+=2;char*v=line;while(*v&&*v!=':')v++;if(*v)v++;while(*v==' ')v++;
  if(header_name(line,"content-length")){if(length)bad=1;while(*v){if(*v<'0'||*v>'9'){bad=1;break;}if(length>MAX_BODY/10){bad=1;break;}length=length*10+(DWORD)(*v++-'0');}if(length>MAX_BODY)bad=1;}
  else if(header_name(line,"transfer-encoding"))bad=1;
  else if(header_name(line,"host")){if(slen(v)>63)bad=1;else copy(client_host,v,slen(v)+1);}
  else if(header_name(line,"x-lk-key")){if(slen(v)>79)bad=1;else copy(key,v,slen(v)+1);}
  else if(header_name(line,"origin")){if(slen(v)>127)bad=1;else copy(origin,v,slen(v)+1);}
  else if(header_name(line,"x-lk-vault")){if(slen(v)!=64)bad=1;else copy(capability,v,65);}
 }
 if(bad||!same(client_host,host)){error(s,"{\"ok\":false,\"code\":\"BAD_REQUEST\"}");goto done;}
 char*query=path;while(*query&&*query!='?')query++;if(*query){*query++=0;if(!same(key,launch_key)&&slen(query)==68&&query[0]=='k'&&query[1]=='e'&&query[2]=='y'&&query[3]=='=')copy(key,query+4,65);}
 char expected_origin[96];append(append(expected_origin,"http://"),host);
 const WebExtra*extra=0;for(UINT i=0;i<web_extra_count;i++)if(same(path,web_extras[i].path)){extra=&web_extras[i];break;}
 int static_asset=same(method,"GET")&&(extra!=0||same(path,"/office-import.js")||same(path,"/test-import-sample.docx")||same(path,"/test-import-sample.xlsx")||same(path,"/statement.js")||same(path,"/vendor/jspdf.umd.min.js")||same(path,"/statement-font.ttf")||same(path,"/app.js")||same(path,"/core.js")||same(path,"/style.css")||same(path,"/icon.png")||same(path,"/favicon.ico"));
 if((origin[0]&&!same(origin,expected_origin))||(!static_asset&&!same(key,launch_key))){error(s,"{\"ok\":false,\"code\":\"FORBIDDEN\"}");goto done;}
 last_ping=GetTickCount64();
 if(same(method,"GET")){
  if(storage_route(s,method,path,0,0,capability))goto done;
  if(extra)response(s,200,extra->mime,extra->data,extra->size);
  else if(same(path,"/"))response(s,200,"text/html; charset=utf-8",asset_html,asset_html_size);
  else if(same(path,"/app.js"))response(s,200,"text/javascript; charset=utf-8",asset_js,asset_js_size);
  else if(same(path,"/office-import.js"))response(s,200,"text/javascript; charset=utf-8",asset_office,asset_office_size);
  else if(same(path,"/test-import-sample.docx"))response(s,200,"application/vnd.openxmlformats-officedocument.wordprocessingml.document",asset_word_sample,asset_word_sample_size);
  else if(same(path,"/test-import-sample.xlsx"))response(s,200,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",asset_excel_sample,asset_excel_sample_size);
  else if(same(path,"/statement.js"))response(s,200,"text/javascript; charset=utf-8",asset_statement,asset_statement_size);
  else if(same(path,"/vendor/jspdf.umd.min.js"))response(s,200,"text/javascript; charset=utf-8",asset_jspdf,asset_jspdf_size);
  else if(same(path,"/statement-font.ttf"))response(s,200,"font/ttf",asset_font,asset_font_size);
  else if(same(path,"/core.js"))response(s,200,"text/javascript; charset=utf-8",asset_core,asset_core_size);
  else if(same(path,"/style.css"))response(s,200,"text/css; charset=utf-8",asset_css,asset_css_size);
  else if(same(path,"/icon.png")||same(path,"/favicon.ico"))response(s,200,"image/png",asset_icon,asset_icon_size);
  else if(same(path,"/state"))load_blob(s,state_path);
  else if(same(path,"/journal"))storage_failure(s,"FORBIDDEN");
  else if(same(path,"/updates/status"))update_status(s);
  else if(same(path,"/clock")){char out[192];char*x=append(out,"{\"ok\":true,\"storageProtocol\":2,\"uptime\":");x=decimal(x,GetTickCount64());x=append(x,",\"launchId\":\"");x=append(x,launch_key);append(x,"\"}");json(s,out);}
  else json(s,"{\"ok\":true}");
 }else if(same(method,"POST")){
  while(used<head+length){int n=recv(s,buf+used,(int)(head+length-used),0);if(n<=0)goto done;used+=(DWORD)n;}buf[head+length]=0;
  if(storage_route(s,method,path,(BYTE*)buf+head,length,capability))goto done;
  if(same(path,"/state")){EnterCriticalSection(&store_lock);int r=sf_profile_write((BYTE*)buf+head,length);if(r==1)json(s,"{\"ok\":true}");else storage_failure(s,r<0?"STORAGE_CONFLICT":"STORAGE_WRITE");LeaveCriticalSection(&store_lock);}
  else if(same(path,"/journal"))storage_failure(s,"FORBIDDEN");
  else if(same(path,"/rpc")&&length<=MAX_BODY)relay(s,buf+head,length);
  else if(same(path,"/updates/check")){if(!update_applying){DeleteFileW(update_failed);update_start();}update_status(s);}
  else if(same(path,"/updates/apply"))update_apply_now(s);
  else json(s,"{\"ok\":false,\"code\":\"NOT_FOUND\"}");
 }else error(s,"{\"ok\":false,\"code\":\"BAD_METHOD\"}");
done: if(buf){zero(buf,used);}zero(capability,sizeof(capability));zero(key,sizeof(key));release(buf);closesocket(s);__atomic_sub_fetch(&workers,1,__ATOMIC_SEQ_CST);return 0;
}
static int launch_browser(const WCHAR*url){
 WCHAR*memory=allocate((1024u+1200u+2400u)*2u);
 if(!memory)return 0;
 WCHAR*base=memory,*app=memory+1024,*params=memory+2224;
 const WCHAR*envs[]={L"ProgramFiles(x86)",L"ProgramFiles",L"LOCALAPPDATA"};
 const WCHAR*paths[]={L"\\Microsoft\\Edge\\Application\\msedge.exe",L"\\Google\\Chrome\\Application\\chrome.exe"};
 for(UINT kind=0;kind<2;kind++)for(UINT e=0;e<3;e++){
  DWORD base_length=GetEnvironmentVariableW(envs[e],base,1024);
  if(!base_length||base_length>900)continue;
  wcopy(app,base);wcat(app,paths[kind]);
  if(GetFileAttributesW(app)==0xffffffffu)continue;
  wcopy(params,L"--no-first-run --no-default-browser-check --app=\"");wcat(params,url);wcat(params,L"\" --window-size=1360,900");
  if((QWORD)ShellExecuteW(0,L"open",app,params,0,1)>32){release(memory);return 1;}
 }
 release(memory);return (QWORD)ShellExecuteW(0,L"open",url,0,0,1)>32;
}
static int open_existing(void){
 WCHAR url[180]={0};DWORD done=0;
 HANDLE file=CreateFileW(launch_path,0x80000000u,1,0,3,0x80,0);
 if(file==INVALID_HANDLE)return 0;
 BOOL ok=ReadFile(file,url,sizeof(url)-2,&done,0);CloseHandle(file);
 const WCHAR*prefix=L"http://127.0.0.1:18747/?key=";UINT at=0;
 if(!ok)return 0;
 while(prefix[at]){if(url[at]!=prefix[at])return 0;at++;}
 for(UINT i=0;i<64;i++){WCHAR c=url[at+i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return 0;}
 if(url[at+64])return 0;
 return launch_browser(url);
}
void mainCRTStartup(void){
 process_heap=GetProcessHeap();InitializeCriticalSection(&store_lock);
 DWORD directory_length=GetEnvironmentVariableW(L"LOCALAPPDATA",directory,1024);
 if(!directory_length||directory_length>900){MessageBoxW(0,L"Не вдалося визначити папку даних Windows.",TITLE,16);ExitProcess(1);}
 wcat(directory,L"\\FPVKomisiiaPC");CreateDirectoryW(directory,0);wcopy(state_path,directory);wcat(state_path,L"\\profile-v2.bin");wcopy(temp_path,directory);wcat(temp_path,L"\\profile-v2.tmp");wcopy(launch_path,directory);wcat(launch_path,L"\\launch.txt");
 wcopy(journal_path,directory);wcat(journal_path,L"\\journal-v2.meta.bin");wcopy(journal_temp,directory);wcat(journal_temp,L"\\journal-v2.meta.tmp");
 update_init();int argc=0;WCHAR**argv=CommandLineToArgvW(GetCommandLineW(),&argc);int helper=argv?update_helper(argc,argv):0;int resumed=!helper&&argv?update_resume(argc,argv):0;if(argv)LocalFree(argv);if(helper)ExitProcess(0);if(resumed<0){MessageBoxW(0,L"Не вдалося відновити вікно після оновлення. Запустіть програму знову.",TITLE,48);ExitProcess(1);}
 storage_ready=sl_initialize();
 icon_refresh_start();
 if(!resumed){BYTE random[32];if(BCryptGenRandom(0,random,32,2)<0){MessageBoxW(0,L"Не вдалося створити захищений сеанс.",TITLE,16);ExitProcess(1);}
 const char*hex="0123456789abcdef";for(UINT i=0;i<32;i++){launch_key[i*2]=hex[random[i]>>4];launch_key[i*2+1]=hex[random[i]&15];}}
 BYTE wsa[512];if(WSAStartup(0x0202,wsa)){MessageBoxW(0,L"Не вдалося запустити мережевий модуль Windows.",TITLE,16);ExitProcess(1);}
 SOCKADDR_IN address;zero(&address,sizeof(address));address.family=2;address.address=htonl(0x7f000001);UINT port=18747;address.port=htons((WORD)port);
 SOCKET server=INVALID_SOCKET;
 for(UINT retry=0;;retry++){
  server=socket(2,1,6);DWORD exclusive=1;
  if(server!=INVALID_SOCKET){setsockopt(server,0xffff,0xfffffffb,(char*)&exclusive,4);if(!bind(server,&address,sizeof(address))&&!listen(server,8))break;closesocket(server);}
  /* Old connections may need a moment to release the fixed local port.
   * A resumed update must never open a second browser window on that race. */
  if(!resumed||retry>=120){WSACleanup();if(!resumed&&open_existing())ExitProcess(0);MessageBoxW(0,L"Локальний порт зайнятий. Завершіть поточний тест, закрийте попереднє вікно програми та спробуйте ще раз.",TITLE,48);ExitProcess(1);}
  Sleep(250);
 }
 if(!resumed&&update_apply_on_start()){closesocket(server);WSACleanup();ExitProcess(0);}
 update_start();
 char url8[160];char*x=append(host,"127.0.0.1:");decimal(x,port);x=append(url8,"http://");x=append(x,host);x=append(x,"/?key=");append(x,launch_key);WCHAR url[180];widen(url,url8);
 HANDLE launch_file=CreateFileW(launch_path,0x40000000u,1,0,2,0x80,0);
 if(launch_file!=INVALID_HANDLE){DWORD length=0,done=0;while(url[length])length++;WriteFile(launch_file,url,(length+1)*2,&done,0);CloseHandle(launch_file);}
 if(!resumed&&!launch_browser(url)){MessageBoxW(0,L"Для інтерфейсу потрібен Microsoft Edge або Google Chrome.",TITLE,16);ExitProcess(1);}
 last_ping=GetTickCount64();QWORD last_poll=last_ping;
 for(;;){if(__atomic_load_n(&update_restart_requested,__ATOMIC_SEQ_CST))break;QWORD now=GetTickCount64();if(now-__atomic_load_n(&update_checked_at,__ATOMIC_SEQ_CST)>21600000u&&!update_busy)update_start();if(now-last_poll>5000u)last_ping=now;last_poll=now;if(now-last_ping>=240000u)break;FD_SET readset;readset.count=1;readset.sockets[0]=server;TIMEVAL wait={1,0};int ready=select(0,&readset,0,0,&wait);if(ready>0){SOCKET client=accept(server,0,0);if(client!=INVALID_SOCKET){if(__atomic_add_fetch(&workers,1,__ATOMIC_SEQ_CST)>8){__atomic_sub_fetch(&workers,1,__ATOMIC_SEQ_CST);closesocket(client);}else{HANDLE thread=CreateThread(0,0,serve,(void*)client,0,0);if(thread)CloseHandle(thread);else{__atomic_sub_fetch(&workers,1,__ATOMIC_SEQ_CST);closesocket(client);}}}}}
 __atomic_store_n(&update_closing,1,__ATOMIC_SEQ_CST);closesocket(server);while(workers)Sleep(100);WSACleanup();ExitProcess(0);
}
