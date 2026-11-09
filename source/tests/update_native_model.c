/* Execute the production updater with an in-memory Windows API double.
 * Signature/hash API results are controllable here; update_protocol.py separately
 * checks real RSA signatures and the production public key. No Windows claim. */
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include "winapi.h"
#define TITLE L"Test"
static char launch_key[65];static WCHAR directory[1024];static volatile LONG workers;
static void *allocate(SIZE_T n){return calloc(1,n);}static void release(void*p){free(p);}
static void copy(void*d,const void*s,SIZE_T n){memcpy(d,s,n);}static SIZE_T slen(const char*s){return strlen(s);}
static int same(const char*a,const char*b){return !strcmp(a,b);}static char*append(char*p,const char*s){while(*s)*p++=*s++;*p=0;return p;}
static char*decimal(char*p,QWORD n){char b[24];snprintf(b,sizeof(b),"%llu",n);return append(p,b);}
static void wcopy(WCHAR*d,const WCHAR*s){while((*d++=*s++));}static void wcat(WCHAR*d,const WCHAR*s){while(*d)d++;wcopy(d,s);}static void widen(WCHAR*d,const char*s){while((*d++=(BYTE)*s++));}
static int weq(const WCHAR*a,const WCHAR*b){while(*a&&*a==*b){a++;b++;}return *a==*b;}
typedef struct {WCHAR path[1300];BYTE*bytes;DWORD size,pos;int used;} MEMFILE;
static int shell_items,shell_images,shell_lookup_ok=1;static WCHAR shell_path[1250];
static MEMFILE files[40];static WCHAR self_path[1250],parent_path[1250],last_args[1500];
static int signature_ok=1,digest_ok=1,parent_ok=1,wait_ok=1,copy_ok=1,move_ok=1,receipt_ok=1,ack_ok=1,launch_failures=0,launches=0,parent_waited=0;static QWORD ticks=100000;
static MEMFILE*find(const WCHAR*p,int create){for(int i=0;i<40;i++)if(files[i].used&&weq(files[i].path,p))return &files[i];if(create)for(int i=0;i<40;i++)if(!files[i].used){files[i].used=1;wcopy(files[i].path,p);return &files[i];}return 0;}
HANDLE CreateFileW(const WCHAR*p,DWORD access,DWORD share,void*sec,DWORD mode,DWORD flags,HANDLE extra){MEMFILE*f=find(p,mode==2);if(!f)return INVALID_HANDLE;if(mode==2){free(f->bytes);f->bytes=0;f->size=0;}f->pos=0;return f;}
BOOL GetFileSizeEx(HANDLE h,QWORD*n){*n=((MEMFILE*)h)->size;return 1;}
BOOL ReadFile(HANDLE h,void*b,DWORD n,DWORD*got,void*o){MEMFILE*f=h;*got=n<f->size-f->pos?n:f->size-f->pos;if(*got)memcpy(b,f->bytes+f->pos,*got);f->pos+=*got;return 1;}
BOOL WriteFile(HANDLE h,const void*b,DWORD n,DWORD*done,void*o){MEMFILE*f=h;f->bytes=realloc(f->bytes,f->pos+n);memcpy(f->bytes+f->pos,b,n);f->pos+=n;f->size=f->pos;*done=n;return 1;}
BOOL FlushFileBuffers(HANDLE h){return 1;}BOOL CloseHandle(HANDLE h){return 1;}
BOOL DeleteFileW(const WCHAR*p){MEMFILE*f=find(p,0);if(!f)return 0;free(f->bytes);memset(f,0,sizeof(*f));return 1;}
BOOL CopyFileW(const WCHAR*a,const WCHAR*b,BOOL fail){if(!copy_ok)return 0;MEMFILE*f=find(a,0);if(!f)return 0;MEMFILE*g=find(b,1);free(g->bytes);g->bytes=malloc(f->size);memcpy(g->bytes,f->bytes,f->size);g->size=f->size;return 1;}
BOOL MoveFileExW(const WCHAR*a,const WCHAR*b,DWORD flags){if(!move_ok)return 0;MEMFILE*f=find(a,0);if(!f)return 0;DeleteFileW(b);wcopy(f->path,b);return 1;}
BOOL CreateDirectoryW(const WCHAR*p,void*s){return 1;}
void InitializeCriticalSection(CRITICAL_SECTION*p){}void EnterCriticalSection(CRITICAL_SECTION*p){}void LeaveCriticalSection(CRITICAL_SECTION*p){}
DWORD GetModuleFileNameW(HANDLE h,WCHAR*p,DWORD n){wcopy(p,self_path);DWORD k=0;while(p[k])k++;return k;}
DWORD GetCurrentProcessId(void){return 42;}
HANDLE OpenProcess(DWORD access,BOOL inherit,DWORD pid){return parent_ok&&pid==42?(HANDLE)123:0;}
BOOL QueryFullProcessImageNameW(HANDLE h,DWORD flags,WCHAR*p,DWORD*n){wcopy(p,parent_path);return 1;}
DWORD WaitForSingleObject(HANDLE h,DWORD ms){parent_waited=1;return wait_ok?0:258;}
QWORD GetTickCount64(void){return ticks;}void Sleep(DWORD ms){ticks+=ms;}
void*LocalFree(void*p){free(p);return 0;}
BOOL CryptUnprotectData(DATA_BLOB*in,WCHAR**d,DATA_BLOB*e,void*r,void*p,DWORD flags,DATA_BLOB*out){if(in->cbData<4||memcmp(in->pbData,"DPAP",4))return 0;out->cbData=in->cbData-4;out->pbData=malloc(out->cbData);memcpy(out->pbData,in->pbData+4,out->cbData);return 1;}
static BOOL save_blob(const WCHAR*path,const WCHAR*temp,const BYTE*bytes,DWORD n){if(!receipt_ok)return 0;MEMFILE*f=find(path,1);free(f->bytes);f->bytes=malloc(n+4);memcpy(f->bytes,"DPAP",4);memcpy(f->bytes+4,bytes,n);f->size=n+4;return 1;}
BOOL CryptAcquireContextW(QWORD*p,const WCHAR*a,const WCHAR*b,DWORD c,DWORD d){*p=1;return 1;}BOOL CryptReleaseContext(QWORD p,DWORD f){return 1;}
BOOL CryptCreateHash(QWORD p,DWORD a,QWORD k,DWORD f,QWORD*out){*out=1;return 1;}BOOL CryptHashData(QWORD h,const BYTE*d,DWORD n,DWORD f){return 1;}
BOOL CryptGetHashParam(QWORD h,DWORD p,BYTE*out,DWORD*n,DWORD f){memset(out,digest_ok?0:1,32);*n=32;return 1;}BOOL CryptDestroyHash(QWORD h){return 1;}
BOOL CryptImportKey(QWORD p,const BYTE*b,DWORD n,QWORD k,DWORD f,QWORD*out){*out=1;return 1;}BOOL CryptDestroyKey(QWORD k){return 1;}
BOOL CryptVerifySignatureW(QWORD h,const BYTE*s,DWORD n,QWORD k,const WCHAR*d,DWORD f){return signature_ok;}
int MessageBoxW(HANDLE h,const WCHAR*m,const WCHAR*t,UINT f){return 1;}
static void json(SOCKET s,const char*b){}
#include "updater.h"
QWORD SHGetFileInfoW(const WCHAR*p,DWORD attrs,void*out,UINT bytes,UINT flags){assert(flags==0x4000u&&bytes==696);if(!shell_lookup_ok)return 0;((LK_SHFILEINFO*)out)->index=37;return 1;}
void SHUpdateImageW(const WCHAR*p,int file_index,UINT flags,int image_index){assert(file_index==0&&flags==0&&image_index==37);wcopy(shell_path,p);shell_images++;}
void SHChangeNotify(LONG event,UINT flags,const void*p,const void*other){assert(event==0x2000&&flags==0x3005u&&!other);wcopy(shell_path,p);shell_items++;}
HANDLE ShellExecuteW(HANDLE h,const WCHAR*verb,const WCHAR*target,const WCHAR*args,const WCHAR*dir,int show){
 if(args)wcopy(last_args,args);else last_args[0]=0;
 if(weq(target,update_exe)){if(ack_ok)update_write(update_ack,(BYTE*)launch_key,64);return (HANDLE)33;}
 launches++;assert(parent_waited);if(launch_failures){launch_failures--;return (HANDLE)5;}return (HANDLE)33;
}
static void put(const WCHAR*p,const char*b){assert(update_write(p,(const BYTE*)b,strlen(b)));}
static void manifest(DWORD code){char text[3000],zeros[65];memset(zeros,'0',64);zeros[64]=0;char*e=append(text,"LKUPDATE1\n");for(int i=0;i<512;i++)*e++='A';*e++='\n';snprintf(e,sizeof(text)-(e-text),"schema=1\nandroid.code=66\nandroid.name=3.1.15\nandroid.file=FPV-Komisiia-3.1.15.apk\nandroid.size=6\nandroid.sha256=%s\nwindows.code=%u\nwindows.name=1.0.15\nwindows.file=FPV-Komisiia-PC.exe\nwindows.size=6\nwindows.sha256=%s\n",zeros,code,zeros);put(update_meta,text);}
static void reset(DWORD code){for(int i=0;i<40;i++){free(files[i].bytes);memset(&files[i],0,sizeof(files[i]));}memset(launch_key,'a',64);launch_key[64]=0;wcopy(directory,L"C:\\Data");update_init();wcopy(parent_path,L"C:\\Apps\\FPV-Komisiia-PC.exe");wcopy(self_path,update_exe);put(update_exe,"NEWDAT");put(parent_path,"OLDDAT");manifest(code);signature_ok=digest_ok=parent_ok=wait_ok=copy_ok=move_ok=receipt_ok=ack_ok=1;launch_failures=launches=parent_waited=0;shell_items=shell_images=0;shell_lookup_ok=1;shell_path[0]=0;ticks=100000;update_busy=update_applying=update_restart_requested=0;}
static WCHAR nonce[65];
static WCHAR**args(int reuse){static WCHAR*argv[7];widen(nonce,launch_key);argv[0]=update_exe;argv[1]=L"--apply-update";argv[2]=parent_path;argv[3]=L"42";argv[4]=nonce;argv[5]=reuse?L"--reuse-window":0;argv[6]=0;return argv;}
static void check(int ok,const char*name){assert(ok);printf("PASS %s\n",name);}
int main(void){
 reset(PC_VERSION_CODE);update_helper(5,args(0));check(launches==1&&!find(update_resume_path,0)&&weq(last_args,L""),"Legacy five-argument startup remains compatible");
 reset(PC_VERSION_CODE);update_helper(6,args(1));check(launches==1&&find(update_resume_path,0),"Manual helper replaces the verified EXE and seals a resume receipt");
 WCHAR*resume[]={parent_path,L"--resume-update",nonce};wcopy(self_path,parent_path);memset(launch_key,0,65);check(update_resume(3,resume)==1&&launch_key[0]=='a'&&!find(update_resume_path,0),"A matching one-use receipt restores the same browser secret");check(update_resume(3,resume)==-1,"The receipt cannot be replayed");
 reset(PC_VERSION_CODE);wcopy(self_path,parent_path);WCHAR*bad[]={parent_path,L"--resume-update",L"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"};check(update_resume(3,bad)==-1,"A command-line key without DPAPI receipt is rejected");
 update_receipt_write(parent_path,launch_key);ticks+=120001;check(update_resume(3,bad)==-1,"Expired resume receipts are rejected");
 reset(PC_VERSION_CODE);update_receipt_write(parent_path,launch_key);wcopy(self_path,L"C:\\Other.exe");check(update_resume(3,bad)==-1,"A receipt cannot authorize another executable path");
 reset(PC_VERSION_CODE);signature_ok=0;update_helper(6,args(1));check(!launches&&!find(update_ack,0),"A failed signature check cannot acknowledge or launch an update");
 reset(PC_VERSION_CODE);digest_ok=0;update_helper(6,args(1));check(!launches&&!find(update_ack,0),"A failed EXE digest cannot acknowledge or launch an update");
 reset(PC_VERSION_CODE);parent_ok=0;update_helper(6,args(1));check(!launches&&!find(update_ack,0),"A different parent process cannot trigger replacement");
 reset(PC_VERSION_CODE);WCHAR**a=args(1);a[3]=L"42949672960";update_helper(6,a);check(!launches&&!find(update_ack,0),"An overflowing parent PID is rejected");
 reset(PC_VERSION_CODE);copy_ok=0;update_helper(6,args(1));check(launches==1&&find(update_failed,0)&&!memcmp(find(parent_path,0)->bytes,"OLDDAT",6),"A copy failure keeps the old executable and resumes its window");
 reset(PC_VERSION_CODE);launch_failures=1;update_helper(6,args(1));check(launches==2&&find(update_failed,0)&&!memcmp(find(parent_path,0)->bytes,"OLDDAT",6),"A launch failure restores the previous executable before retrying");
 reset(PC_VERSION_CODE+1);wcopy(self_path,parent_path);check(update_launch_helper(1)==1,"Only a verified newer helper with a matching acknowledgement permits shutdown");
 reset(PC_VERSION_CODE+1);wcopy(self_path,parent_path);ack_ok=0;check(update_launch_helper(1)==0&&!update_restart_requested,"A missing helper acknowledgement leaves the old host running");
 reset(PC_VERSION_CODE);update_helper(6,args(1));check(shell_images==1&&shell_items==1&&weq(shell_path,parent_path),"Verified replacement refreshes the target EXE image and desktop item");
 reset(PC_VERSION_CODE);launch_failures=1;update_helper(6,args(1));check(shell_images==2&&shell_items==2&&!memcmp(find(parent_path,0)->bytes,"OLDDAT",6),"Rollback refreshes the restored old executable icon too");
 reset(PC_VERSION_CODE);signature_ok=0;update_helper(6,args(1));check(!shell_items&&!shell_images,"Rejected update never refreshes an untrusted file");
 reset(PC_VERSION_CODE);copy_ok=0;update_helper(6,args(1));check(!shell_items&&!shell_images,"A failed copy does not report an icon replacement");
 reset(PC_VERSION_CODE);shell_lookup_ok=0;update_helper(6,args(1));check(!shell_images&&shell_items==1&&launches==1,"A Shell lookup failure still notifies the item and permits launch");
 reset(PC_VERSION_CODE);wcopy(self_path,parent_path);workers=1;icon_refresh_worker(0);check(!workers&&shell_items==1&&shell_images==1&&weq(shell_path,parent_path),"Normal launch repairs a previously cached desktop icon asynchronously");
 reset(PC_VERSION_CODE);WCHAR long_path[261];for(int i=0;i<260;i++)long_path[i]='x';long_path[260]=0;icon_refresh_path(long_path);check(!shell_items&&!shell_images,"Paths beyond the Shell API limit are skipped safely");
 return 0;
}
