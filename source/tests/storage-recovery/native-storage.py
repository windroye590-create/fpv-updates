"""Compile the actual native load_blob with synthetic Win32 I/O responses."""
from pathlib import Path
import os,json,hashlib,subprocess,tempfile
root=Path(os.environ.get('LITAKOVA_AUDIT_SOURCE',Path(__file__).resolve().parents[2]))
source=(root/'native/main.c').read_text()
start=source.index('static void load_blob(');end=source.index('\nstatic BYTE*commission_request(',start)
actual=source[start:end]
harness=r'''
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
typedef uint8_t BYTE;typedef uint32_t DWORD;typedef uint64_t QWORD;typedef wchar_t WCHAR;typedef void* HANDLE;typedef int BOOL;typedef int SOCKET;
typedef struct {DWORD cbData;BYTE*pbData;} DATA_BLOB;
#define MAX_BODY (8u*1024u*1024u)
#define INVALID_HANDLE ((void*)(intptr_t)-1)
static int scenario,store_lock,enters,leaves;static WCHAR journal_path[8];static QWORD journal_serial;
static const char payload[]="{\"accounts\":{\"saved\":{\"pending\":[\"kept\"]}}}";
static void EnterCriticalSection(int*p){(void)p;enters++;}static void LeaveCriticalSection(int*p){(void)p;leaves++;}
static HANDLE CreateFileW(const WCHAR*a,DWORD b,DWORD c,void*d,DWORD e,DWORD f,void*g){(void)a;(void)b;(void)c;(void)d;(void)e;(void)f;(void)g;return scenario<=3?INVALID_HANDLE:(void*)1;}
static DWORD GetLastError(void){return scenario==0?2:scenario==1?3:scenario==2?5:32;}
static BOOL GetFileSizeEx(HANDLE h,QWORD*n){(void)h;*n=sizeof(payload)-1;return 1;}
static void*allocate(QWORD n){return malloc(n);}static void release(void*p){free(p);}static void LocalFree(void*p){free(p);}
static BOOL ReadFile(HANDLE h,BYTE*b,DWORD n,DWORD*done,void*x){(void)h;(void)x;memcpy(b,payload,n);*done=n;return 1;}
static BOOL CryptUnprotectData(DATA_BLOB*in,void*a,void*b,void*c,void*d,DWORD e,DATA_BLOB*out){(void)a;(void)b;(void)c;(void)d;(void)e;if(scenario==4)return 0;out->cbData=in->cbData;out->pbData=malloc(in->cbData);memcpy(out->pbData,in->pbData,in->cbData);return 1;}
static void CloseHandle(HANDLE h){(void)h;}static QWORD serial_from(const BYTE*b,DWORD n){(void)b;(void)n;return 1;}
static void json(SOCKET s,const char*x){(void)s;fputs(x,stdout);}static void response(SOCKET s,int status,const char*m,const void*b,DWORD n){(void)s;(void)status;(void)m;fwrite(b,1,n,stdout);}
'''
checks=[]
with tempfile.TemporaryDirectory(prefix='lk-storage-audit-') as tmp:
 c=Path(tmp)/'native.c';exe=Path(tmp)/'native'
 c.write_text(harness+actual+'\nint main(int argc,char**argv){(void)argc;scenario=atoi(argv[1]);load_blob(1,L"state");if(enters!=1||leaves!=1)return 7;return 0;}\n')
 subprocess.run(['gcc','-std=c11','-O2','-Wall',str(c),'-o',str(exe)],check=True,capture_output=True,text=True)
 for index,name,should_error in [(0,'A missing state file starts a new profile',False),(1,'A missing profile directory starts a new profile',False),(2,'Access denied must report a storage read error instead of an empty profile',True),(3,'A sharing violation must report a storage read error instead of an empty profile',True),(4,'A DPAPI failure reports a storage read error',True),(5,'A readable saved profile returns its queued work',False)]:
  response=json.loads(subprocess.check_output([str(exe),str(index)],text=True))
  actual_error=response.get('ok') is False and response.get('code')=='STORAGE_READ'
  passed=actual_error==should_error
  if index==5:passed=passed and response.get('accounts',{}).get('saved',{}).get('pending')==['kept']
  checks.append({'name':name,'status':'passed' if passed else 'failed','actualResponse':response})
  print(('PASS ' if passed else 'FAIL ')+name)
report={'scope':'native-storage','passed':sum(c['status']=='passed' for c in checks),'failed':sum(c['status']=='failed' for c in checks),'checks':checks,'implementation':'actual native/main.c load_blob compiled with Win32 I/O doubles','nativeSourceSHA256':hashlib.sha256(source.encode()).hexdigest(),'windowsRuntimeVerified':False,'productionRequests':0,'realDPAPIRuntimeVerified':False}
out=root/'verification/storage-recovery/native-storage.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report['passed'],'failed':report['failed']}))
raise SystemExit(1 if report['failed'] else 0)
