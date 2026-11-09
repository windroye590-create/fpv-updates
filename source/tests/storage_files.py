"""Run actual backup/CAS functions with fault-injected Win32 I/O doubles."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'native/main.c').read_text()
serial = source[source.index('static QWORD serial_from('):source.index('static BOOL save_blob(')]
with tempfile.TemporaryDirectory(prefix='lk-storage-files-') as directory:
    directory = Path(directory)
    (directory / 'serial_under_test.h').write_text(serial)
    exe = directory / 'model'
    subprocess.run(['gcc', '-std=c11', '-g', '-O1', '-fsanitize=address,undefined',
                    '-fno-omit-frame-pointer', '-no-pie', '-Wall', '-Wextra',
                    '-Wno-unused-function', '-Werror', '-fshort-wchar', '-I' + str(root / 'native'), '-I' + str(directory),
                    str(root / 'tests/storage_files_model.c'), '-o', str(exe)], check=True)
    run = subprocess.run([str(exe)], capture_output=True, text=True, timeout=30,
                         env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0:halt_on_error=1',
                              'UBSAN_OPTIONS': 'halt_on_error=1:print_stacktrace=1'})
    print(run.stdout, end='')
    assert run.returncode == 0, run.stderr
checks = [line[5:] for line in run.stdout.splitlines() if line.startswith('PASS ')]
report = {'status': 'passed', 'passed': len(checks), 'checks': checks,
          'actualBackupFunctionsExecuted': True, 'faultInjectedWin32FileOperations': True,
          'actualWindowsRuntimeExecuted': False, 'actualCryptographyVerified': False,
          'addressSanitizer': True, 'undefinedBehaviorSanitizer': True,
          'nativeFilesSHA256': hashlib.sha256((root / 'native/storage_files.h').read_bytes()).hexdigest()}
(root / 'verification').mkdir(exist_ok=True)
(root / 'verification/storage-files.json').write_text(json.dumps(report, indent=2) + '\n')
subprocess.run([sys.executable, str(root / 'tests/native_state_route.py')], check=True)
