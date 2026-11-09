"""Check the shipped /clock formatter at long Windows uptimes under ASAN."""
from pathlib import Path
import json
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'native/main.c').read_text()
append = source[source.index('static char*append('):source.index('static void wcopy(')]
start = source.index('else if(same(path,"/clock")){') + len('else if(same(path,"/clock"))')
end = source.index('\n  else json(', start)
body = source[start:end].strip()
driver = '''
#include <stdint.h>
#include <stdio.h>
typedef unsigned int UINT;typedef uint64_t QWORD;
static QWORD tick;static char launch_key[65];
static QWORD GetTickCount64(void){return tick;}
static void json(int socket,const char*text){(void)socket;puts(text);}
''' + append + '\nstatic void clock_under_test(int s)' + body + '''
int main(void){for(int i=0;i<64;i++)launch_key[i]='a';QWORD cases[]={0,999999,864000000,1234567890,UINT64_MAX};
 for(unsigned int i=0;i<sizeof(cases)/sizeof(cases[0]);i++){tick=cases[i];clock_under_test(1);}return 0;}
'''
with tempfile.TemporaryDirectory(prefix='lk-clock-') as directory:
    directory = Path(directory)
    c, exe = directory / 'clock.c', directory / 'clock'
    c.write_text(driver)
    subprocess.run(['gcc', '-std=c11', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
                    '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-no-pie',
                    str(c), '-o', str(exe)], check=True)
    result = subprocess.run([str(exe)], capture_output=True, text=True, timeout=15,
                            env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0:halt_on_error=1',
                                 'UBSAN_OPTIONS': 'halt_on_error=1'})
    assert result.returncode == 0, result.stderr
    rows = [json.loads(line) for line in result.stdout.splitlines()]
    assert [row['uptime'] for row in rows] == [0, 999999, 864000000, 1234567890, 2**64 - 1]
    assert all(row['storageProtocol'] == 2 and row['launchId'] == 'a' * 64 for row in rows)
(root / 'verification/native-clock.json').write_text(json.dumps({
    'status': 'passed', 'passed': len(rows), 'actualNativeFormatterExecuted': True,
    'addressSanitizer': True, 'undefinedBehaviorSanitizer': True,
    'actualWindowsRuntimeExecuted': False, 'maximumFormattedBytes': max(len(json.dumps(r, separators=(',', ':'))) for r in rows)
}, indent=2) + '\n')
print('PASS native clock: 5 uptime boundaries through UINT64_MAX, ASAN/UBSAN clean')
