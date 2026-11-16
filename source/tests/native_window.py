"""Run the shipped window lifetime and request parser under ASAN/UBSAN.

Windows system calls are doubles; this does not claim a Windows runtime test.
"""
from pathlib import Path
import json
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'native/main.c').read_text()
start = source.index('static void window_route(')
route = source[start:source.index('\nstatic DWORD serve(', start)]
driver = r'''
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef unsigned char BYTE;
typedef unsigned int DWORD,UINT;
typedef uint64_t QWORD;
typedef int SOCKET;
static int store_lock,lock_depth,status;
static QWORD tick;
static char reply[256];
static size_t slen(const char*s){return strlen(s);}
static void copy(void*d,const void*s,size_t n){memcpy(d,s,n);}
static int same(const char*a,const char*b){return !strcmp(a,b);}
static void EnterCriticalSection(int*lock){(void)lock;assert(!lock_depth++);}
static void LeaveCriticalSection(int*lock){(void)lock;assert(lock_depth--==1);}
static QWORD GetTickCount64(void){return tick;}
static void json(SOCKET s,const char*body){(void)s;status=200;strcpy(reply,body);}
static void error(SOCKET s,const char*body){(void)s;status=400;strcpy(reply,body);}
#include "storage_json.h"
#include "window_lifecycle.h"
''' + route + r'''
static void event(const char*body,int opened){
 status=0;window_route(1,(const BYTE*)body,(DWORD)strlen(body),opened);
 assert(!lock_depth);
}
int main(void){
 /* Reproduce the old policy while its host polls normally and the browser
    has suspended all timers. The window can still be open at this point. */
 QWORD last_ping=1000,last_poll=1000,stopped=0;
 for(QWORD now=2000;now<=301000;now+=1000){
  if(now-last_poll>5000u)last_ping=now;
  last_poll=now;
  if(now-last_ping>=240000u){stopped=now;break;}
 }
 assert(stopped==241000);
 window_started=1000;
 assert(!window_should_exit(240999));assert(window_should_exit(241000));
 window_touch(20000);
 assert(!window_should_exit(259999));assert(window_should_exit(260000));
 tick=1100;
 event("{\"windowId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\"}",1);
 assert(status==200&&strstr(reply,"windowLifecycleProtocol"));
 assert(!window_should_exit(241000));
 assert(!window_should_exit(864001000)); /* ten days without browser timers */
 tick=864001000;
 event("{\"windowId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\"}",0);
 assert(status==200&&!window_should_exit(tick+14999));
 window_touch(tick+10000); /* late saves cannot cancel an explicit close */
 assert(window_should_exit(tick+15000));
 event("{\"windowId\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\"}",1);
 assert(status==200&&!window_should_exit(tick+30000));
 /* A delayed close from the replaced page cannot stop its new window. */
 event("{\"windowId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\"}",0);
 assert(status==200&&!window_should_exit(tick+30000));
 const char*bad[]={"{}","[]","{\"windowId\":1}",
  "{\"windowId\":\"not-a-uuid\"}",
  "{\"windowId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"windowId\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\"}",
  "{\"windowId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\"}junk"};
 for(unsigned i=0;i<sizeof(bad)/sizeof(bad[0]);i++){
  event(bad[i],0);assert(status==400&&!window_should_exit(tick+30000));
 }
 char huge[160];memset(huge,' ',sizeof(huge));huge[159]=0;
 event(huge,1);assert(status==400);
 event("{\"windowId\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\"}",0);
 assert(status==200&&window_should_exit(tick+15000));
 puts("PASS old 4-minute shutdown reproduced; active, reloaded and replaced windows; 7 malformed messages rejected");
}
'''
with tempfile.TemporaryDirectory(prefix='lk-window-') as directory:
    directory = Path(directory)
    c, exe = directory / 'window.c', directory / 'window'
    c.write_text(driver)
    subprocess.run(['gcc', '-std=c11', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
                    '-Wno-unused-function', '-fsanitize=address,undefined',
                    '-fno-omit-frame-pointer', '-no-pie', '-I'+str(root/'native'),
                    str(c), '-o', str(exe)], check=True)
    run = subprocess.run([str(exe)], capture_output=True, text=True, timeout=15,
                         env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0:halt_on_error=1',
                              'UBSAN_OPTIONS': 'halt_on_error=1'})
    assert run.returncode == 0, run.stderr
    print(run.stdout, end='')
(root/'verification').mkdir(exist_ok=True)
(root/'verification/native-window.json').write_text(json.dumps({
    'status':'passed', 'oldIdleShutdownReproduced':True,
    'activeWindowSurvivesWithoutTimersDays':10, 'closeGraceSeconds':15,
    'actualNativeRouteExecuted':True, 'addressSanitizer':True,
    'undefinedBehaviorSanitizer':True, 'actualWindowsRuntimeExecuted':False
}, indent=2)+'\n')
