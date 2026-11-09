"""Differential fuzzing of the shipped bounded JSON scanner under ASAN/UBSAN."""
from pathlib import Path
import hashlib
import json
import os
import random
import struct
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
rng = random.Random(20261103)
cases = []


def add(raw, expected=None):
    if isinstance(raw, str):
        raw = raw.encode()
    if expected is None:
        try:
            json.loads(raw.decode("utf-8"))
            expected = True
        except (ValueError, UnicodeError, RecursionError):
            expected = False
    cases.append((raw, expected))


for raw in ['', '{}', '[]', 'null', 'false', 'true', '0', '-1', '1.25e+6',
            '01', '[1,]', '{"x":}', '{"x":1,}', 'truefalse', '"\\u0000"',
            '"\\u006fwner"', '"\\u12"', '"\\x12"', '"unterminated',
            '{"owner":"teacher"}', '{"owner":"a","owner":"b"}',
            '{"owner":"a","\\u006fwner":"b"}',
            '{"nested":{"owner":"foreign"},"owner":"own"}',
            '{"owner":"\\u0000"}', '{"owner":9007199254740991}',
            '{"owner":9007199254740992}', '{"owner":1e2}', '{"owner":-1}']:
    add(raw)
add('[' * 63 + '0' + ']' * 63, True)
add('[' * 65 + '0' + ']' * 65, False)


def value(depth=0):
    options = ['leaf'] if depth >= 6 else ['leaf', 'array', 'object']
    kind = rng.choice(options)
    if kind == 'array':
        return [value(depth + 1) for _ in range(rng.randrange(5))]
    if kind == 'object':
        return {rng.choice(['owner', 'userId', 'accounts', 'a', 'b', 'c']) + str(i):
                value(depth + 1) for i in range(rng.randrange(5))}
    return rng.choice([None, True, False, rng.randrange(-10**12, 10**12),
                       rng.random() * 100, ''.join(rng.choices('a\\"\n\tЖІ✈', k=rng.randrange(40)))])


for _ in range(3500):
    raw = json.dumps(value(), ensure_ascii=True, separators=(',', ':')).encode()
    add(raw, True)
    for _ in range(3):
        mutated = bytearray(raw)
        for _ in range(rng.randrange(1, 5)):
            at = rng.randrange(len(mutated) + 1)
            operation = rng.randrange(3)
            if operation == 0 and at < len(mutated):
                mutated[at] = rng.randrange(128)
            elif operation == 1:
                mutated[at:at] = bytes([rng.randrange(128)])
            elif at < len(mutated):
                del mutated[at]
        add(bytes(mutated))
for _ in range(4000):
    add(bytes(rng.randrange(128) for _ in range(rng.randrange(256))))

driver = r'''
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef uint8_t BYTE;typedef uint32_t DWORD;typedef uint32_t UINT;typedef uint64_t QWORD;
static int same(const char*a,const char*b){return strcmp(a,b)==0;}
#include "storage_json.h"
int main(void){uint32_t n;
 while(fread(&n,4,1,stdin)==1){BYTE*input=malloc(n?n:1);if(fread(input,1,n,stdin)!=n)return 3;
  SJ_VALUE root,owner;int valid=sj_valid(input,n,&root),found=0,text=0,integer=0;char out[81];QWORD number;
  if(valid&&root.type=='{'){found=sj_member(input,n,root,"owner",&owner);if(found==1){text=sj_text(input,owner,out,sizeof(out));integer=sj_integer(input,owner,&number);}}
  printf("%d,%d,%d,%d\n",valid,found,text,integer);free(input);
 }return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='lk-json-fuzz-') as folder:
    folder = Path(folder)
    source, exe = folder / 'driver.c', folder / 'driver'
    source.write_text(driver)
    subprocess.run(['gcc', '-std=c11', '-g', '-O1', '-fsanitize=address,undefined',
                    '-fno-omit-frame-pointer', '-no-pie', '-Wall', '-Wextra', '-Werror',
                    '-I' + str(root / 'native'), str(source), '-o', str(exe)], check=True)
    payload = b''.join(struct.pack('<I', len(raw)) + raw for raw, _ in cases)
    env = {**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0:halt_on_error=1',
           'UBSAN_OPTIONS': 'halt_on_error=1:print_stacktrace=1'}
    result = subprocess.run([str(exe)], input=payload, capture_output=True, env=env, timeout=60)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    rows = [tuple(map(int, line.split(','))) for line in result.stdout.decode().splitlines()]
    assert len(rows) == len(cases)
    for index, ((raw, expected), row) in enumerate(zip(cases, rows)):
        assert bool(row[0]) == expected, (index, repr(raw), row, expected)
    for raw in [b'{"owner":"a","owner":"b"}', b'{"owner":"a","\\u006fwner":"b"}']:
        i = next(i for i, c in enumerate(cases) if c[0] == raw)
        assert rows[i][1] == -1, 'Ambiguous owner was accepted'

report = {'status': 'passed', 'cases': len(cases), 'seed': 20261103,
          'actualNativeScannerExecuted': True, 'addressSanitizer': True,
          'undefinedBehaviorSanitizer': True, 'differentialOracle': 'Python json',
          'duplicateEscapedOwnerRejected': True,
          'nativeScannerSHA256': hashlib.sha256((root / 'native/storage_json.h').read_bytes()).hexdigest()}
destination = root / 'verification/storage-json.json'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, indent=2) + '\n')
print('PASS native JSON scanner: ' + str(len(cases)) + ' differential cases, ASAN and UBSAN clean')
