"""Execute the shipped compatibility writer branch with a real thread mutex.

The file storage/CAS implementation is separately tested by storage_files.py.
This test checks that the HTTP route holds its shared lock while calling it.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'native/main.c').read_text()
start = source.index('if(same(path,"/state")){')
end = source.index('\n  else if(same(path,"/journal"))', start)
branch = source[start:end].strip()
limits = '\n'.join(line for line in source.splitlines()
                   if line.startswith('#define MAX_BODY ') or
                   line.startswith('#define MAX_JOURNAL_BODY '))
harness = r'''
#define _XOPEN_SOURCE 700
#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
typedef unsigned char BYTE;typedef unsigned int DWORD;
static pthread_mutex_t store_lock=PTHREAD_MUTEX_INITIALIZER;
static _Thread_local int lock_depth;
static unsigned revision,accepted,conflicts,enters,leaves;
static int same(const char*a,const char*b){return !strcmp(a,b);}
static void EnterCriticalSection(pthread_mutex_t*lock){assert(!pthread_mutex_lock(lock));lock_depth++;enters++;}
static void LeaveCriticalSection(pthread_mutex_t*lock){assert(lock_depth==1);lock_depth--;leaves++;assert(!pthread_mutex_unlock(lock));}
static int sf_profile_write(const BYTE*body,DWORD length){
 assert(lock_depth==1);assert(length==2&&!memcmp(body,"{}",2));
 if(revision)return -1;
 struct timespec pause={0,1000000};nanosleep(&pause,0);revision=1;return 1;
}
static void json(int socket,const char*body){(void)socket;assert(!strcmp(body,"{\"ok\":true}"));accepted++;}
static void storage_failure(int socket,const char*code){(void)socket;assert(!strcmp(code,"STORAGE_CONFLICT"));conflicts++;}
'''
harness += '\n' + limits + '\n'
harness += '_Static_assert(MAX_JOURNAL_BODY==MAX_BODY,"Full checkpoints must fit the bounded HTTP body limit");\n'
harness += 'static void route(int s,const char*path,char*buf,DWORD head,DWORD length){' + branch + '}\n'
harness += r'''
static void*request(void*unused){(void)unused;char body[]="{}";route(1,"/state",body,0,2);assert(!lock_depth);return 0;}
int main(void){
 for(unsigned round=0;round<20;round++){
  revision=accepted=conflicts=enters=leaves=0;pthread_t threads[8];
  for(unsigned i=0;i<8;i++)assert(!pthread_create(&threads[i],0,request,0));
  for(unsigned i=0;i<8;i++)assert(!pthread_join(threads[i],0));
  assert(revision==1&&accepted==1&&conflicts==7&&enters==8&&leaves==8);
 }
 puts("PASS compatibility /state writer serializes 160 concurrent requests and rejects every conflicting revision");
 return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='lk-state-route-') as directory:
    directory = Path(directory)
    c, exe = directory / 'route.c', directory / 'route'
    c.write_text(harness)
    subprocess.run(['gcc', '-std=c11', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
                    '-pthread', str(c), '-o', str(exe)], check=True)
    result = subprocess.run([str(exe)], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    print(result.stdout, end='')
report = {'status': 'passed', 'requests': 160, 'rounds': 20,
          'actualCompatibilityRouteExecuted': True,
          'actualWindowsRuntimeExecuted': False,
          'implementation': 'shipped native/main.c route with pthread-backed critical section and CAS double',
          'nativeSourceSHA256': hashlib.sha256(source.encode()).hexdigest()}
(root / 'verification').mkdir(exist_ok=True)
(root / 'verification/native-state-route.json').write_text(json.dumps(report, indent=2) + '\n')
