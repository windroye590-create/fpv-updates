"""Exercise the actual launcher and migration helpers with bounded Win32 doubles."""
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
main = (root / 'native/main.c').read_text()
helpers = main[main.index('static int launch_browser('):main.index('void mainCRTStartup(')]
prefix = next(line for line in main.splitlines() if line.startswith('#define LOCAL_URL_PREFIX '))
model = r'''
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "winapi.h"
static WCHAR directory[1024]=L"C:\\User Space\\FPVKomisiiaPC",launch_path[1100]=L"receipt";
static char launch_key[65];
static WCHAR stored[180],captured[2400],caption[96],kind[48];
static DWORD stored_size;static int launches,closed,edge=1;
static void *allocate(SIZE_T n){return calloc(1,n);}static void release(void*p){free(p);}
static void zero(void*p,SIZE_T n){memset(p,0,n);}
static void wcopy(WCHAR*d,const WCHAR*s){while((*d++=*s++));}
static void wcat(WCHAR*d,const WCHAR*s){while(*d)d++;wcopy(d,s);}
static SIZE_T wl(const WCHAR*s){SIZE_T n=0;while(s[n])n++;return n;}
static int update_wsame(const WCHAR*a,const WCHAR*b){while(*a&&*a==*b){a++;b++;}return *a==*b;}
static int has(const WCHAR*s,const WCHAR*part){for(;*s;s++){SIZE_T n=0;while(part[n]&&s[n]==part[n])n++;if(!part[n])return 1;}return 0;}
DWORD GetEnvironmentVariableW(const WCHAR*n,WCHAR*b,DWORD size){(void)n;(void)size;wcopy(b,L"C:\\Program Files");return (DWORD)wl(b);}
DWORD GetFileAttributesW(const WCHAR*p){return !edge&&has(p,L"msedge.exe")?0xffffffffu:0;}
HANDLE ShellExecuteW(HANDLE h,const WCHAR*op,const WCHAR*app,const WCHAR*params,const WCHAR*cwd,int show){(void)h;(void)op;(void)app;(void)cwd;(void)show;launches++;if(params)wcopy(captured,params);return (HANDLE)64;}
HANDLE CreateFileW(const WCHAR*p,DWORD a,DWORD b,void*c,DWORD d,DWORD e,HANDLE f){(void)p;(void)a;(void)b;(void)c;(void)d;(void)e;(void)f;return (HANDLE)1;}
BOOL ReadFile(HANDLE f,void*p,DWORD n,DWORD*done,void*o){(void)f;(void)o;*done=stored_size<n?stored_size:n;memcpy(p,stored,*done);return 1;}
BOOL CloseHandle(HANDLE f){(void)f;return 1;}
int GetWindowTextW(HANDLE h,WCHAR*b,int n){(void)h;(void)n;wcopy(b,caption);return (int)wl(b);}
int GetClassNameW(HANDLE h,WCHAR*b,int n){(void)h;(void)n;wcopy(b,kind);return (int)wl(b);}
QWORD SendMessageTimeoutW(HANDLE h,UINT message,QWORD w,QWORD l,UINT flags,UINT timeout,QWORD*r){(void)h;(void)w;(void)l;(void)flags;(void)timeout;(void)r;assert(message==0x0010);closed++;return 1;}
'''
cases = r'''
static void receipt(const WCHAR*prefix,char key){wcopy(stored,prefix);SIZE_T at=wl(stored);for(int i=0;i<64;i++)stored[at+i]=(BYTE)key;stored[at+64]=0;stored_size=(DWORD)((at+65)*2);}
static int passed;
static void check(int ok,const char*name){assert(ok);passed++;printf("PASS %s\n",name);}
int main(void){
 memset(launch_key,'a',64);
 receipt(LOCAL_URL_PREFIX,'a');launch_browser(stored);
 check(has(captured,L"--user-data-dir=\"C:\\User Space\\FPVKomisiiaPC\\browser\"")&&has(captured,L"--app=\"http://127.0.0.1:18748/?key="),"Edge uses the isolated FPV origin and a quoted FPV-only browser profile");
 edge=0;launch_browser(stored);check(launches==2&&has(captured,L"FPVKomisiiaPC\\browser"),"Chrome fallback retains the same isolated profile");
 check(open_existing()&&launches==3,"A second FPV launch reopens only a complete current-edition receipt");
 receipt(L"http://127.0.0.1:18747/?key=",'a');check(!open_existing()&&launches==3,"An old receipt cannot open the other commission's listener");
 check(migrating_browser(),"An authenticated update recognizes its own saved legacy origin");
 receipt(L"http://127.0.0.1:18747/?key=",'b');check(!migrating_browser(),"A different launch secret cannot authorize closing a legacy window");
 receipt(LOCAL_URL_PREFIX,'a');check(!migrating_browser(),"Ordinary future updates preserve their existing FPV window");
 stored_size-=2;check(!open_existing(),"A truncated launch receipt is rejected");
 receipt(LOCAL_URL_PREFIX,'z');check(!open_existing(),"Invalid receipt secrets are rejected");
 receipt(L"http://example.com:18748/?key=",'a');check(!open_existing(),"A receipt cannot redirect the launcher to an external host");
 wcopy(kind,L"Chrome_WidgetWin_1");wcopy(caption,L"FPV Комісія | ПК");close_migrated_window((HANDLE)1,0);
 check(closed==1,"Legacy migration requests a normal close of the saved FPV browser window");
 wcopy(caption,L"Літакова Комісія | ПК");close_migrated_window((HANDLE)1,0);
 wcopy(caption,L"FPV Комісія | ПК");wcopy(kind,L"OtherWindow");close_migrated_window((HANDLE)1,0);
 check(closed==1,"Migration leaves the other commission and unrelated windows untouched");
 printf("Native edition identity: %d checks passed\n",passed);return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='fpv-identity-') as temp:
    temp = Path(temp)
    code = temp / 'test.c'
    code.write_text(model + '\n' + prefix + '\n' + helpers + cases)
    binary = temp / 'test'
    subprocess.run(['gcc', '-std=c11', '-fshort-wchar', '-Wall', '-Wextra', '-Werror',
                    '-fsanitize=address,undefined', '-I' + str(root/'native'), str(code),
                    '-o', str(binary)], check=True)
    result = subprocess.run([str(binary)], capture_output=True, text=True, check=True)
    print(result.stdout, end='')
    checks = [line[5:] for line in result.stdout.splitlines() if line.startswith('PASS ')]
    (root/'verification').mkdir(exist_ok=True)
    (root/'verification/native-identity.json').write_text(json.dumps({
        'status': 'passed', 'passed': len(checks), 'checks': checks,
        'implementation': 'actual native/main.c launch and migration helpers',
        'sanitizers': ['address', 'undefined'], 'actualWindowsRuntimeVerified': False
    }, indent=2)+'\n')
