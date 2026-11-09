/* Downloads are never executed before RSA signature, version and SHA-256 checks.
 * Manual installation preserves the authenticated browser window. */
#include "update_key.h"
#include "update_protocol.h"
#include "icon_cache.h"
static CRITICAL_SECTION update_lock;
static WCHAR update_dir[1100],update_exe[1200],update_meta[1200],update_failed[1200],update_ack[1200],update_resume_path[1200],update_resume_temp[1200];
static volatile LONG update_busy,update_closing,update_applying,update_restart_requested;
static int update_state; /* 0 unknown, 1 checking, 2 current, 3 ready, 4 unavailable, 5 blocked */
static UPDATE_RELEASE update_available;
static QWORD update_checked_at;
static int update_verify_signature(const BYTE*data,DWORD n,const BYTE*signature,DWORD length){
 QWORD provider=0,hash=0,key=0;BYTE little[384];BOOL ok=0;
 if(length!=384)return 0;
 for(UINT i=0;i<384;i++)little[i]=signature[383-i]; /* CryptoAPI RSA uses little-endian signatures. */
 if(CryptAcquireContextW(&provider,0,0,24,0xf0000000u)&&CryptCreateHash(provider,0x800c,0,0,&hash)&&CryptHashData(hash,data,n,0)&&CryptImportKey(provider,update_public_blob,sizeof(update_public_blob),0,0,&key))ok=CryptVerifySignatureW(hash,little,384,key,0,0);
 if(key)CryptDestroyKey(key);
 if(hash)CryptDestroyHash(hash);
 if(provider)CryptReleaseContext(provider,0);
 return ok;
}
static BYTE*update_read(const WCHAR*path,DWORD maximum,DWORD*length){
 HANDLE file=CreateFileW(path,0x80000000u,1,0,3,0x80,0);BYTE*buf=0;QWORD size=0;DWORD done=0;
 if(file==INVALID_HANDLE)return 0;
 if(GetFileSizeEx(file,&size)&&size>0&&size<=maximum){buf=allocate(size+1);if(!buf||!ReadFile(file,buf,(DWORD)size,&done,0)||done!=size){release(buf);buf=0;}else{buf[size]=0;*length=(DWORD)size;}}
 CloseHandle(file);return buf;
}
static BOOL update_write(const WCHAR*path,const BYTE*bytes,DWORD n){
 HANDLE f=CreateFileW(path,0x40000000u,0,0,2,0x80,0);if(f==INVALID_HANDLE)return 0;
 DWORD done=0;BOOL ok=WriteFile(f,bytes,n,&done,0)&&done==n;ok=FlushFileBuffers(f)&&ok;CloseHandle(f);return ok;
}
static int update_hash_matches(const WCHAR*file,const UPDATE_RELEASE*r){
 HANDLE f=CreateFileW(file,0x80000000u,1,0,3,0x80,0);if(f==INVALID_HANDLE)return 0;
 QWORD size=0,provider=0,hash=0;BYTE*buffer=0;BYTE digest[32];DWORD length=32;BOOL ok=0;
 if(GetFileSizeEx(f,&size)&&size==r->size&&CryptAcquireContextW(&provider,0,0,24,0xf0000000u)&&CryptCreateHash(provider,0x800c,0,0,&hash)){
  buffer=allocate(65536);ok=buffer!=0;
  while(ok){DWORD got=0;if(!ReadFile(f,buffer,65536,&got,0)){ok=0;break;}if(!got)break;ok=CryptHashData(hash,buffer,got,0);}
  if(ok)ok=CryptGetHashParam(hash,2,digest,&length,0)&&length==32;
  if(ok){const char*hex="0123456789abcdef";for(UINT i=0;i<32;i++)if(r->sha256[2*i]!=hex[digest[i]>>4]||r->sha256[2*i+1]!=hex[digest[i]&15])ok=0;}
 }
 release(buffer);if(hash)CryptDestroyHash(hash);if(provider)CryptReleaseContext(provider,0);CloseHandle(f);return ok;
}
static int update_ready(UPDATE_RELEASE*r,int helper){
 DWORD n=0;BYTE*meta=update_read(update_meta,16384,&n);if(!meta)return 0;
 int ok=update_parse(meta,n,r);release(meta);
 if(!ok||(helper?r->code!=PC_VERSION_CODE:r->code<=PC_VERSION_CODE))return 0;
 return update_hash_matches(update_exe,r);
}
static int update_fetch(const WCHAR*path,BYTE*memory,DWORD maximum,HANDLE output,DWORD*length){
 HINTERNET session=WinHttpOpen(L"FPV-Komisiia-Updater/1",4,0,0,0),conn=0,req=0;BYTE*buffer=0;
 /* Follow GitHub asset redirects over HTTPS only. Do not send cookies or
  * automatic credentials to the public download service. */
 DWORD used=0,status=0,status_size=4,redirect=1,max_redirects=5,disabled=5;BOOL ok=0;QWORD deadline=GetTickCount64()+180000u;
 if(session){WinHttpSetTimeouts(session,10000,10000,15000,30000);conn=WinHttpConnect(session,UPDATE_HOST,443,0);}
 if(conn)req=WinHttpOpenRequest(conn,L"GET",path,0,0,0,0x00800000);
 if(req&&WinHttpSetOption(req,88,&redirect,4)&&WinHttpSetOption(req,89,&max_redirects,4)&&WinHttpSetOption(req,63,&disabled,4)&&WinHttpSendRequest(req,L"Accept-Encoding: identity\r\nCache-Control: no-cache\r\n",(DWORD)-1,0,0,0,0)&&WinHttpReceiveResponse(req,0)&&WinHttpQueryHeaders(req,19|0x20000000u,0,&status,&status_size,0)&&status==200){
  buffer=allocate(65536);ok=buffer!=0;
  while(ok){DWORD got=0,done=0;if(__atomic_load_n(&update_closing,__ATOMIC_SEQ_CST)||GetTickCount64()>deadline||!WinHttpReadData(req,buffer,65536,&got)){ok=0;break;}if(!got)break;if(got>maximum-used){ok=0;break;}
   if(memory)copy(memory+used,buffer,got);
   else if(!WriteFile(output,buffer,got,&done,0)||done!=got){ok=0;break;}
   used+=got;
  }
 }
 if(req)WinHttpCloseHandle(req);
 if(conn)WinHttpCloseHandle(conn);
 if(session)WinHttpCloseHandle(session);
 release(buffer);if(ok)*length=used;return ok&&used>0;
}
static void update_release_path(WCHAR*out,const char*file){
 wcopy(out,UPDATE_PATH_PREFIX);widen(out+sizeof(UPDATE_PATH_PREFIX)/sizeof(WCHAR)-1,file);
}
static DWORD update_check_worker(void*unused){
 (void)unused;BYTE*meta=allocate(16384);DWORD n=0;UPDATE_RELEASE r,cached;BOOL ready=update_ready(&cached,0),ok=0;
 EnterCriticalSection(&update_lock);update_state=1;LeaveCriticalSection(&update_lock);
 if(meta&&update_fetch(UPDATE_PATH_PREFIX L"updates.txt",meta,16384,0,&n)&&update_parse(meta,n,&r)){
  if(ready&&cached.code>=r.code){r=cached;ok=1;}
  else if(r.code<=PC_VERSION_CODE){ok=1;ready=0;}
  else {
   WCHAR*paths=allocate(2u*1250u*2u);if(paths){WCHAR*partial=paths,*url=paths+1250;wcopy(partial,update_dir);wcat(partial,L"\\update.part");update_release_path(url,r.file);
    HANDLE f=CreateFileW(partial,0x40000000u,0,0,2,0x80,0);DWORD size=0;
    if(f!=INVALID_HANDLE){BOOL downloaded=update_fetch(url,0,r.size,f,&size);downloaded=FlushFileBuffers(f)&&downloaded;CloseHandle(f);
     if(downloaded&&size==r.size&&update_hash_matches(partial,&r)&&MoveFileExW(partial,update_exe,9)){
      wcopy(partial,update_dir);wcat(partial,L"\\release.part");if(update_write(partial,meta,n)&&MoveFileExW(partial,update_meta,9)){ready=1;ok=1;}
     }
    }
    wcopy(partial,update_dir);wcat(partial,L"\\update.part");DeleteFileW(partial);release(paths);
   }
  }
 }
 if(!ok)ready=update_ready(&cached,0);
 EnterCriticalSection(&update_lock);
 if(ready){update_available=ok?r:cached;DWORD length=0;BYTE*failed=update_read(update_failed,24,&length);update_state=failed&&update_number((char*)failed,10000000u)==update_available.code?5:3;release(failed);}else update_state=ok?2:4;
 __atomic_store_n(&update_checked_at,GetTickCount64(),__ATOMIC_SEQ_CST);LeaveCriticalSection(&update_lock);
 release(meta);__atomic_store_n(&update_busy,0,__ATOMIC_SEQ_CST);__atomic_sub_fetch(&workers,1,__ATOMIC_SEQ_CST);return 0;
}
static void update_start(void){
 if(update_applying||__atomic_exchange_n(&update_busy,1,__ATOMIC_SEQ_CST))return;
 EnterCriticalSection(&update_lock);update_state=1;LeaveCriticalSection(&update_lock);
 __atomic_add_fetch(&workers,1,__ATOMIC_SEQ_CST);HANDLE t=CreateThread(0,0,update_check_worker,0,0,0);
 if(t)CloseHandle(t);else{__atomic_sub_fetch(&workers,1,__ATOMIC_SEQ_CST);__atomic_store_n(&update_busy,0,__ATOMIC_SEQ_CST);}
}
static void update_status(SOCKET s){
 char out[1000];EnterCriticalSection(&update_lock);int state=update_state;const char*message=state==1?"Перевіряємо й завантажуємо оновлення…":state==2?"Установлено актуальну версію.":state==3?"Оновлення завантажено й перевірено. Натисніть «Перевірити оновлення», щоб установити його й перезапустити застосунок.":state==5?"Не вдалося встановити оновлення. Перевірте доступ на запис до папки програми та повторіть перевірку.":"Канал оновлень тимчасово недоступний. Спробуємо знову автоматично.";
 char*p=append(out,"{\"ok\":true,\"currentVersion\":\"" PC_VERSION_NAME "\",\"currentCode\":");p=decimal(p,PC_VERSION_CODE);p=append(p,",\"state\":");p=decimal(p,(DWORD)state);p=append(p,",\"code\":");p=decimal(p,(state==3||state==5)?update_available.code:0);p=append(p,",\"version\":\"");if(state==3||state==5)p=append(p,update_available.name);p=append(p,"\",\"message\":\"");p=append(p,message);append(p,"\"}");LeaveCriticalSection(&update_lock);json(s,out);
}
static int update_wsame(const WCHAR*a,const WCHAR*b){while(*a&&*b){WCHAR x=*a++,y=*b++;if(x>='A'&&x<='Z')x+=32;if(y>='A'&&y<='Z')y+=32;if(x!=y)return 0;}return *a==*b;}
static void update_failure(DWORD code){char b[24];char*end=decimal(b,code);update_write(update_failed,(BYTE*)b,(DWORD)(end-b));}
static int update_wide_path(const WCHAR*s){UINT n=0;while(s[n]){if(s[n]=='"'||s[n]<32||n>=1000)return 0;n++;}return n>7&&s[1]==':'&&s[2]=='\\'&&(s[n-4]=='.')&&(s[n-3]=='e'||s[n-3]=='E')&&(s[n-2]=='x'||s[n-2]=='X')&&(s[n-1]=='e'||s[n-1]=='E');}

/* A one-use DPAPI receipt authorizes retaining the existing loopback secret.
 * A caller-supplied --resume-update key alone never grants that authorization. */
typedef struct {DWORD magic;QWORD created;char nonce[65];WCHAR target[1100];} UPDATE_RESUME;
static int update_nonce(const WCHAR*wide,char*ascii){
 for(UINT i=0;i<64;i++){WCHAR c=wide[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return 0;ascii[i]=(char)c;}ascii[64]=0;return wide[64]==0;
}
static int update_receipt_write(const WCHAR*target,const char*nonce){
 UPDATE_RESUME*r=allocate(sizeof(*r));if(!r)return 0;
 r->magic=0x31524b4cu;r->created=GetTickCount64();copy(r->nonce,nonce,65);wcopy(r->target,target);
 int ok=save_blob(update_resume_path,update_resume_temp,(BYTE*)r,sizeof(*r));release(r);return ok;
}
static int update_resume(int argc,WCHAR**argv){
 if(argc<2||!update_wsame(argv[1],L"--resume-update"))return 0;
 char nonce[65];if(argc!=3||!update_nonce(argv[2],nonce))return -1;
 DWORD size=0;BYTE*bytes=update_read(update_resume_path,16384,&size);DATA_BLOB plain={0,0};int ok=0;
 if(bytes){DATA_BLOB sealed={size,bytes};if(CryptUnprotectData(&sealed,0,0,0,0,1,&plain)&&plain.cbData==sizeof(UPDATE_RESUME)){
  UPDATE_RESUME*r=(UPDATE_RESUME*)plain.pbData;WCHAR*self=allocate(1250u*2u);DWORD n=self?GetModuleFileNameW(0,self,1250):0;QWORD now=GetTickCount64();
  if(r->magic==0x31524b4cu&&r->nonce[64]==0&&r->target[1099]==0&&now>=r->created&&now-r->created<=120000u&&n&&n<1250&&same(r->nonce,nonce)&&update_wsame(self,r->target)&&DeleteFileW(update_resume_path)){copy(launch_key,nonce,65);ok=1;}
  release(self);
 }}
 if(plain.pbData)LocalFree(plain.pbData);
 release(bytes);return ok?1:-1;
}
static int update_launch_target(const WCHAR*target,const char*nonce,int reuse){
 WCHAR params[100];const WCHAR*args=0;
 if(reuse){if(!update_receipt_write(target,nonce))return 0;wcopy(params,L"--resume-update ");WCHAR wide[65];widen(wide,nonce);wcat(params,wide);args=params;}
 int ok=(QWORD)ShellExecuteW(0,L"open",target,args,0,1)>32;
 if(!ok&&reuse)DeleteFileW(update_resume_path);
 return ok;
}
static int update_helper(int argc,WCHAR**argv){
 if(argc<2||!update_wsame(argv[1],L"--apply-update"))return 0;
 UPDATE_RELEASE r;WCHAR*mem=allocate(5u*1250u*2u);BOOL ok=0;HANDLE parent=0;int reuse=argc==6&&update_wsame(argv[5],L"--reuse-window");
 /* argc == 5 is the startup protocol used by already-installed older releases. */
 if((argc!=5&&!reuse)||!mem||!update_wide_path(argv[2])||!update_ready(&r,1))goto finish;
 WCHAR*self=mem,*parent_path=mem+1250,*temp=mem+2500,*backup=mem+3750;
 DWORD n=GetModuleFileNameW(0,self,1250);if(!n||n>=1250||!update_wsame(self,update_exe))goto finish;
 DWORD pid=0;for(UINT i=0;argv[3][i];i++){DWORD digit=(DWORD)(argv[3][i]-'0');if(digit>9||pid>429496729u||(pid==429496729u&&digit>5))goto finish;pid=pid*10+digit;}if(!pid)goto finish;
 parent=OpenProcess(0x00101000u,0,pid);n=1250;
 if(!parent||!QueryFullProcessImageNameW(parent,0,parent_path,&n)||!update_wsame(parent_path,argv[2]))goto finish;
 char nonce[65];if(!update_nonce(argv[4],nonce))goto finish;
 if(!update_write(update_ack,(BYTE*)nonce,64)||WaitForSingleObject(parent,120000)!=0)goto finish;
 wcopy(temp,argv[2]);wcat(temp,L".update.tmp");wcopy(backup,argv[2]);wcat(backup,L".previous");
 if(CopyFileW(update_exe,temp,0)&&update_hash_matches(temp,&r)&&CopyFileW(argv[2],backup,0)&&MoveFileExW(temp,argv[2],9))ok=1;
 DeleteFileW(temp);if(!ok)update_failure(r.code);else{DeleteFileW(update_failed);icon_refresh_path(argv[2]);}
 if(!update_launch_target(argv[2],nonce,reuse)){
  if(ok){update_failure(r.code);ok=0;if(CopyFileW(backup,temp,0)&&MoveFileExW(temp,argv[2],9)){icon_refresh_path(argv[2]);update_launch_target(argv[2],nonce,reuse);}DeleteFileW(temp);}
  MessageBoxW(0,L"Не вдалося запустити оновлення. Запустіть FPV Комісію знову; збережені дані залишаються на цьому ПК.",TITLE,48);
 }
finish:
 if(parent)CloseHandle(parent);
 if(!ok&&argc==5)MessageBoxW(0,L"Автооновлення не застосовано. Збережені дані залишаються доступними у попередній версії.",TITLE,48);
 release(mem);return 1;
}
static int update_launch_helper(int reuse){
 UPDATE_RELEASE r;if(__atomic_load_n(&update_busy,__ATOMIC_SEQ_CST)||!update_ready(&r,0))return 0;
 DWORD n=0;BYTE*failed=update_read(update_failed,24,&n);DWORD failed_code=failed?update_number((char*)failed,10000000u):0;release(failed);
 if(failed_code==r.code){update_state=5;return 0;}
 WCHAR*mem=allocate(2u*1250u*2u);if(!mem)return 0;WCHAR*target=mem,*params=mem+1250;
 n=GetModuleFileNameW(0,target,1100);int launched=0;
 if(n&&n<1100&&update_wide_path(target)&&!update_wsame(target,update_exe)){
  wcopy(params,L"--apply-update \"");wcat(params,target);wcat(params,L"\" ");char pid[24];decimal(pid,GetCurrentProcessId());WCHAR digits[24];widen(digits,pid);wcat(params,digits);wcat(params,L" ");WCHAR nonce[65];widen(nonce,launch_key);wcat(params,nonce);if(reuse)wcat(params,L" --reuse-window");
  DeleteFileW(update_ack);
  if((QWORD)ShellExecuteW(0,L"open",update_exe,params,0,0)>32){
   for(UINT attempt=0;attempt<100;attempt++){DWORD size=0;BYTE*ack=update_read(update_ack,64,&size);int matches=ack&&size==64&&same((char*)ack,launch_key);release(ack);if(matches){launched=1;break;}Sleep(50);}
  }
 }
 release(mem);return launched;
}
static int update_apply_on_start(void){return update_launch_helper(0);}
static void update_apply_now(SOCKET s){
 if(__atomic_exchange_n(&update_applying,1,__ATOMIC_SEQ_CST)){json(s,"{\"ok\":false,\"error\":\"Оновлення вже встановлюється.\"}");return;}
 if(update_launch_helper(1)){json(s,"{\"ok\":true,\"restarting\":true}");__atomic_store_n(&update_restart_requested,1,__ATOMIC_SEQ_CST);}
 else{__atomic_store_n(&update_applying,0,__ATOMIC_SEQ_CST);json(s,"{\"ok\":false,\"error\":\"Не вдалося підготувати встановлення. Перевірте доступ на запис до папки програми й повторіть перевірку.\"}");}
}
static void update_init(void){
 InitializeCriticalSection(&update_lock);wcopy(update_dir,directory);wcat(update_dir,L"\\updates");CreateDirectoryW(update_dir,0);
 wcopy(update_exe,update_dir);wcat(update_exe,L"\\update.exe");wcopy(update_meta,update_dir);wcat(update_meta,L"\\release.txt");wcopy(update_failed,update_dir);wcat(update_failed,L"\\failed.txt");
 wcopy(update_ack,update_dir);wcat(update_ack,L"\\apply.ready");wcopy(update_resume_path,update_dir);wcat(update_resume_path,L"\\resume.bin");wcopy(update_resume_temp,update_dir);wcat(update_resume_temp,L"\\resume.tmp");
}
