/* Actual storage_files.h with deterministic Win32 file-operation doubles.
 * Cryptography is deliberately a checksum envelope here; real CNG/DPAPI
 * verification is the separate Windows-only test, never claimed by this model. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <assert.h>
typedef uint8_t BYTE;typedef uint32_t DWORD;typedef uint32_t UINT;
typedef uint64_t QWORD;typedef size_t SIZE_T;typedef wchar_t WCHAR;
typedef void* HANDLE;typedef int BOOL;typedef int SOCKET;
typedef struct {DWORD cbData;BYTE*pbData;} DATA_BLOB;
#define MAX_BODY (8u*1024u*1024u)
#define MAX_JOURNAL_BODY MAX_BODY
#define TITLE L"Synthetic file-operation model"
#define INVALID_HANDLE ((HANDLE)(intptr_t)-1)
static WCHAR state_path[1100]=L"profile";
_Static_assert(sizeof(WCHAR)==2,"Use the Windows UTF-16 layout");
static char vault_owner[81]="owner";
static QWORD vault_journal_serial;
static void*allocate(SIZE_T n){return calloc(1,n);}
static void release(void*p){free(p);}
static void zero(void*p,SIZE_T n){memset(p,0,n);}
static void copy(void*d,const void*s,SIZE_T n){memcpy(d,s,n);}
static int same(const char*a,const char*b){return strcmp(a,b)==0;}
static void wcopy(WCHAR*d,const WCHAR*s){while((*d++=*s++));}
static void wcat(WCHAR*d,const WCHAR*s){while(*d)d++;wcopy(d,s);}
static int model_wcmp(const WCHAR*a,const WCHAR*b){while(*a&&*a==*b){a++;b++;}return *a-*b;}
static int model_contains(const WCHAR*a,const WCHAR*b){for(;*a;a++){const WCHAR*x=a,*y=b;while(*y&&*x==*y){x++;y++;}if(!*y)return 1;}return 0;}
static void widen(WCHAR*d,const char*s){while((*d++=(BYTE)*s++));}
#include "storage_json.h"
#include "serial_under_test.h"
typedef struct {WCHAR name[1250];BYTE*data;DWORD size;int exists,denied;} MODEL_FILE;
static MODEL_FILE files[64];static DWORD last_error;static int fail_write,fail_flush,fail_move;
static MODEL_FILE*find(const WCHAR*name,int create){
 for(UINT i=0;i<64;i++)if(files[i].name[0]&&model_wcmp(name,files[i].name)==0)return &files[i];
 if(create)for(UINT i=0;i<64;i++)if(!files[i].name[0]){wcopy(files[i].name,name);return &files[i];}
 return NULL;
}
static DWORD GetLastError(void){return last_error;}
static HANDLE CreateFileW(const WCHAR*name,DWORD access,DWORD share,void*a,DWORD mode,DWORD flags,void*b){
 (void)share;(void)a;(void)flags;(void)b;MODEL_FILE*f=find(name,mode==2);
 if(f&&f->denied){last_error=(DWORD)f->denied;return INVALID_HANDLE;}
 if(!f||(!f->exists&&mode!=2)){last_error=2;return INVALID_HANDLE;}
 if(mode==2){free(f->data);f->data=NULL;f->size=0;f->exists=1;}
 (void)access;return f;
}
static BOOL GetFileSizeEx(HANDLE handle,QWORD*size){*size=((MODEL_FILE*)handle)->size;return 1;}
static BOOL ReadFile(HANDLE handle,void*out,DWORD n,DWORD*done,void*unused){
 (void)unused;MODEL_FILE*f=handle;if(n>f->size)n=f->size;memcpy(out,f->data,n);*done=n;return 1;
}
static BOOL WriteFile(HANDLE handle,const void*input,DWORD n,DWORD*done,void*unused){
 (void)unused;MODEL_FILE*f=handle;if(fail_write){*done=0;return 0;}
 f->data=realloc(f->data,n);memcpy(f->data,input,n);f->size=n;*done=n;return 1;
}
static BOOL CloseHandle(HANDLE handle){(void)handle;return 1;}
static BOOL FlushFileBuffers(HANDLE handle){(void)handle;return !fail_flush;}
static BOOL MoveFileExW(const WCHAR*from,const WCHAR*to,DWORD flags){
 (void)flags;if(fail_move)return 0;MODEL_FILE*f=find(from,0),*t=find(to,1);if(!f||!f->exists||!t)return 0;
 free(t->data);t->data=f->data;t->size=f->size;t->exists=1;f->data=NULL;f->size=0;f->exists=0;return 1;
}
static BOOL DeleteFileW(const WCHAR*name){MODEL_FILE*f=find(name,0);if(!f||!f->exists)return 0;f->exists=0;free(f->data);f->data=NULL;f->size=0;return 1;}
static DWORD digest(const BYTE*data,DWORD n){DWORD h=2166136261u;for(DWORD i=0;i<n;i++)h=(h^data[i])*16777619u;return h;}
static BOOL CryptProtectData(DATA_BLOB*in,const WCHAR*title,void*a,void*b,void*c,DWORD flags,DATA_BLOB*out){
 (void)title;(void)a;(void)b;(void)c;(void)flags;out->cbData=in->cbData+8;out->pbData=allocate(out->cbData);memcpy(out->pbData,"MODL",4);DWORD h=digest(in->pbData,in->cbData);memcpy(out->pbData+4,&h,4);memcpy(out->pbData+8,in->pbData,in->cbData);return 1;
}
static BOOL CryptUnprotectData(DATA_BLOB*in,void*a,void*b,void*c,void*d,DWORD flags,DATA_BLOB*out){
 (void)a;(void)b;(void)c;(void)d;(void)flags;if(in->cbData<8||memcmp(in->pbData,"MODL",4))return 0;DWORD h;memcpy(&h,in->pbData+4,4);if(h!=digest(in->pbData+8,in->cbData-8))return 0;
 out->cbData=in->cbData-8;out->pbData=allocate(out->cbData);memcpy(out->pbData,in->pbData+8,out->cbData);return 1;
}
static void LocalFree(void*p){free(p);}
static BYTE*sc_crypt(const char*identity,const BYTE*input,DWORD n,int encrypt,DWORD*outLength){
 (void)identity;(void)encrypt;BYTE*out=allocate(n+1);memcpy(out,input,n);*outLength=n;return out;
}
static void json(SOCKET socket,const char*value){(void)socket;(void)value;}
static void response(SOCKET socket,int status,const char*mime,const void*body,DWORD n){(void)socket;(void)status;(void)mime;(void)body;(void)n;}
#include "storage_files.h"
static void corrupt(const WCHAR*name){MODEL_FILE*f=find(name,0);assert(f&&f->exists&&f->size);f->data[0]^=1;}
static void check_revision(UINT revision){DWORD n=0,reason=0;BYTE*p=sf_read(state_path,0,&n,&reason,1);QWORD v=0;assert(p&&sf_profile_version(p,n,&v)&&v==revision);release(p);}
static void mark(const char*name){printf("PASS %s\n",name);}
int main(void){
 legacy_directory[0]=0;
 DWORD n=0,reason=0;BYTE*p=sf_read(state_path,0,&n,&reason,1);assert(!p&&reason==SF_MISSING);mark("Only genuinely missing profiles start empty");
 char body[512];for(UINT i=1;i<=5;i++){snprintf(body,sizeof(body),"{\"storageProtocol\":2,\"revision\":%u,\"expectedRevision\":%u,\"requestId\":\"%u\",\"global\":{},\"accounts\":{}}",i,i-1,i);assert(sf_profile_write((BYTE*)body,(DWORD)strlen(body))==1);assert(sf_profile_write((BYTE*)body,(DWORD)strlen(body))==1);}
 check_revision(5);for(UINT i=1;i<=3;i++){WCHAR path[1250];sf_backup(path,state_path,i);p=sf_read_once(path,0,&n,&reason);QWORD v=0;assert(p&&sf_profile_version(p,n,&v)&&v==5-i);release(p);}mark("CAS retries retain three distinct acknowledged backups");
 const char*stale="{\"storageProtocol\":2,\"revision\":2,\"expectedRevision\":1}";assert(sf_profile_write((BYTE*)stale,(DWORD)strlen(stale))==-1);check_revision(5);mark("Conflicting profile commits cannot overwrite current work");
 MODEL_FILE*f=find(state_path,0);f->denied=32;p=sf_read(state_path,0,&n,&reason,1);assert(!p&&reason==32);f->denied=5;p=sf_read(state_path,0,&n,&reason,1);assert(!p&&reason==5);f->denied=0;check_revision(5);mark("Sharing and access failures never become a recovered or empty profile");
 const char*next="{\"storageProtocol\":2,\"revision\":6,\"expectedRevision\":5}";
 fail_write=1;assert(!sf_profile_write((BYTE*)next,(DWORD)strlen(next)));fail_write=0;check_revision(5);
 fail_flush=1;assert(!sf_profile_write((BYTE*)next,(DWORD)strlen(next)));fail_flush=0;check_revision(5);
 fail_move=1;assert(!sf_profile_write((BYTE*)next,(DWORD)strlen(next)));fail_move=0;check_revision(5);
 for(UINT i=0;i<64;i++)if(model_contains(files[i].name,L".tmp"))assert(!files[i].exists);
 mark("Partial writes, failed flushes and failed renames retain current work and remove temporary files");
 corrupt(state_path);check_revision(4);mark("A corrupt newest profile restores the last verified backup");
 const char*recovered="{\"storageProtocol\":2,\"revision\":5,\"expectedRevision\":4,\"requestId\":\"recovered\"}";assert(sf_profile_write((BYTE*)recovered,(DWORD)strlen(recovered))==1);check_revision(5);
 p=sf_read_once(L"profile.bak1",0,&n,&reason);QWORD v=0;assert(p&&sf_profile_version(p,n,&v)&&v==4);release(p);mark("Corrupt source data never rotates over the known-good backup");
 for(UINT i=0;i<=3;i++){WCHAR path[1250];sf_backup(path,state_path,i);corrupt(path);}p=sf_read(state_path,0,&n,&reason,1);assert(!p&&reason==SF_CORRUPT);assert(!sf_profile_write((BYTE*)next,(DWORD)strlen(next)));mark("Damage to all copies refuses both an empty reset and a new profile write");
 wcopy(object_directory,L"objects");WCHAR journal[1250];sf_journal_path(journal);
 for(UINT i=10;i<=13;i++){snprintf(body,sizeof(body),"{\"serial\":%u,\"kind\":\"run\",\"userId\":\"owner\",\"answers\":{\"w\":\"before\"}}",i);assert(sf_vault_journal_write((BYTE*)body,(DWORD)strlen(body)));}assert(vault_journal_serial==13);corrupt(journal);
 const char*replacement="{\"serial\":13,\"kind\":\"run\",\"userId\":\"owner\",\"answers\":{\"w\":\"replacement\"}}";assert(sf_vault_journal_write((BYTE*)replacement,(DWORD)strlen(replacement)));p=sf_read(journal,"journal",&n,&reason,1);assert(p&&strcmp((char*)p,replacement)==0);release(p);mark("Journal serial decisions use recovered disk contents instead of a stale in-memory high-water mark");
 const char*old="{\"serial\":11,\"userId\":\"owner\"}";assert(sf_vault_journal_write((BYTE*)old,(DWORD)strlen(old)));p=sf_read(journal,"journal",&n,&reason,1);assert(p&&strcmp((char*)p,replacement)==0);release(p);
 const char*foreign="{\"serial\":14,\"userId\":\"other\"}";assert(!sf_vault_journal_write((BYTE*)foreign,(DWORD)strlen(foreign)));mark("Older and foreign-account checkpoints cannot replace the accepted journal");
 const char*largePrefix="{\"serial\":20,\"userId\":\"owner\",\"draft\":\"";DWORD largeLength=300000;char*large=allocate((SIZE_T)largeLength+1);SIZE_T prefixLength=strlen(largePrefix);memcpy(large,largePrefix,prefixLength);memset(large+prefixLength,'A',largeLength-prefixLength-2);memcpy(large+largeLength-2,"\"}",2);assert(sf_vault_journal_write((BYTE*)large,largeLength));p=sf_read(journal,"journal",&n,&reason,1);assert(p&&n==largeLength&&!memcmp(p,large,largeLength));release(p);release(large);mark("Full draft checkpoints larger than the former 256 KiB cap round-trip without truncation");
 large=allocate((SIZE_T)MAX_JOURNAL_BODY+2);memcpy(large,largePrefix,prefixLength);assert(!sf_vault_journal_write((BYTE*)large,MAX_JOURNAL_BODY+1));release(large);mark("Journals above the HTTP profile body limit remain rejected");
 for(UINT i=0;i<64;i++)free(files[i].data);
 return 0;
}
