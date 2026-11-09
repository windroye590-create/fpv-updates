"""Exercise the actual protocol-2 EXE, CNG and DPAPI on isolated Windows files."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

if sys.platform != 'win32':
    raise SystemExit('This verification requires Windows')
exe = Path(sys.argv[1]).resolve()
checks = []
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
crypt = ctypes.WinDLL('crypt32', use_last_error=True)
kernel.CreateFileW.restype = ctypes.c_void_p
kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32,
                              ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
kernel.CloseHandle.argtypes = [ctypes.c_void_p]
kernel.LocalFree.argtypes = [ctypes.c_void_p]


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def dpapi(raw, protect):
    buf = ctypes.create_string_buffer(raw)
    value = Blob(len(raw), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    if protect:
        ok = crypt.CryptProtectData(ctypes.byref(value), None, None, None, None, 1, ctypes.byref(output))
    else:
        ok = crypt.CryptUnprotectData(ctypes.byref(value), None, None, None, None, 1, ctypes.byref(output))
    assert ok, ctypes.get_last_error()
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel.LocalFree(output.data)


def passed(name):
    checks.append(name)
    print('PASS ' + name, flush=True)


with tempfile.TemporaryDirectory(prefix='lk-vault-windows-') as scratch:
    scratch = Path(scratch)
    data = scratch / 'data'
    data.mkdir()
    browser = scratch / 'programs/Microsoft/Edge/Application/msedge.exe'
    browser.parent.mkdir(parents=True)
    # No rendered browser and no production RPC. This trusted system program
    # only lets the normal host finish launching its isolated local listener.
    shutil.copyfile(Path(os.environ['SystemRoot']) / 'System32/whoami.exe', browser)
    env = {**os.environ, 'LOCALAPPDATA': str(data), 'ProgramFiles': str(scratch / 'programs'),
           'ProgramFiles(x86)': str(scratch / 'programs')}
    folder = data / 'FPVKomisiiaPC'
    folder.mkdir()
    # The upgrade must archive v1 data before exposing protocol 2. Only an
    # invalid token is tested here, so this script cannot call the live API.
    legacy = {'version': 1, 'accounts': {'old-owner': {'draft': {'title': 'LEGACY PRIVATE'}}}}
    (folder / 'state.bin').write_bytes(dpapi(json.dumps(legacy).encode(), True))
    process = subprocess.Popen([str(exe)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        launch = folder / 'launch.txt'
        until = time.monotonic() + 30
        while time.monotonic() < until:
            assert process.poll() is None, 'The host exited before initialization'
            if launch.exists():
                parsed = urllib.parse.urlsplit(launch.read_bytes().decode('utf-16-le').rstrip('\0'))
                origin = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))
                launch_key = urllib.parse.parse_qs(parsed.query)['key'][0]
                break
            time.sleep(.1)
        else:
            raise AssertionError('Missing native launch receipt')

        def request(path, value=None, capability=None):
            raw = None if value is None else json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
            headers = {'X-LK-Key': launch_key, 'Content-Type': 'application/json'}
            if capability:
                headers['X-LK-Vault'] = capability
            req = urllib.request.Request(origin + path, data=raw, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read())

        assert request('/clock')['storageProtocol'] == 2
        assert request('/storage/profile') == {}
        assert request('/journal').get('code') == 'FORBIDDEN'
        assert request('/journal', {'serial': 1, 'userId': 'old-owner'}).get('code') == 'FORBIDDEN'
        snapshots = request('/legacy/list')['snapshots']
        assert len(snapshots) == 1 and 'LEGACY PRIVATE' not in json.dumps(snapshots)
        old_id = snapshots[0]['id']
        assert not (folder / 'state.bin').exists()
        assert request('/legacy/' + old_id + '/account', {'userId': 'old-owner', 'token': 'invalid!'}).get('code') == 'FORBIDDEN'
        assert len(list((folder / 'legacy-v1').glob('*.profile'))) == 1
        passed('Upgrade archives old data and refuses anonymous legacy or global journal access')

        owner, key, cap = 'ci-teacher', secrets.token_hex(32), secrets.token_hex(32)
        assert request('/vault/open', {'owner': owner, 'key': key, 'capability': cap})['ok']
        object_id = secrets.token_hex(32)
        payload = {'storageChunkProtocol': 1, 'data': json.dumps({'answer': 'ПРИВАТНА ВІДПОВІДЬ', 'token': 'SYNTHETIC-BEARER'})}
        path = '/vault/objects/' + object_id
        assert request(path, payload, cap)['ok']
        assert request(path, capability=cap) == payload
        objectfile = folder / 'objects-v2' / (object_id + '.bin')
        protected = objectfile.read_bytes()
        inner = dpapi(protected, False)
        assert inner[:8] == b'LKVAULT1'
        for secret in [payload['data'].encode(), b'SYNTHETIC-BEARER', bytes.fromhex(key)]:
            assert secret not in protected and secret not in inner
        passed('Real AES-256-GCM and Windows DPAPI round-trip a private account object')
        assert request(path, payload, cap)['ok']
        assert request(path, {**payload, 'data': 'different'}, cap).get('ok') is False
        assert request(path, capability=cap) == payload
        passed('Lost object acknowledgements retry idempotently without allowing overwrite')
        assert request(path).get('code') == 'FORBIDDEN'
        assert request(path, capability='f' * 64).get('code') == 'FORBIDDEN'
        for position in [8, 20, len(inner) - 1]:
            altered = bytearray(inner)
            altered[position] ^= 1
            objectfile.write_bytes(dpapi(bytes(altered), True))
            assert request(path, capability=cap).get('code') == 'STORAGE_READ'
        objectfile.write_bytes(protected)
        passed('Changing a nonce, GCM tag or ciphertext is rejected even after valid DPAPI rewrapping')
        other_id = secrets.token_hex(32)
        (objectfile.parent / (other_id + '.bin')).write_bytes(protected)
        assert request('/vault/objects/' + other_id, capability=cap).get('code') == 'STORAGE_READ'
        assert request('/vault/open', {'owner': 'ci-cadet', 'key': key, 'capability': cap})['ok']
        assert request(path, capability=cap).get('code') == 'STORAGE_READ'
        assert request('/vault/open', {'owner': owner, 'key': secrets.token_hex(32), 'capability': cap})['ok']
        assert request(path, capability=cap).get('code') == 'STORAGE_READ'
        assert request('/vault/open', {'owner': owner, 'key': key, 'capability': cap})['ok']
        assert request(path, capability=cap) == payload
        passed('The GCM identity binds both the account owner and the immutable object identifier')

        backup_only = secrets.token_hex(32)
        assert request('/vault/objects/' + backup_only, payload, cap)['ok']
        profile = None
        for revision in range(1, 6):
            profile = {'storageProtocol': 2, 'revision': revision, 'expectedRevision': revision - 1,
                       'requestId': secrets.token_hex(16), 'global': {'version': 1, 'theme': 'light'},
                       'accounts': {owner: {'fields': {'draft': {'length': 10, 'chunks': [object_id]}}}}}
            if revision == 2:
                profile['accounts'][owner]['fields']['oldOnly'] = {'length': 10, 'chunks': [backup_only]}
            assert request('/storage/profile', profile)['ok']
            assert request('/storage/profile', profile)['ok']
        assert request('/storage/profile') == profile
        assert [request('/storage/profile/backup/' + str(i))['revision'] for i in range(1, 4)] == [4, 3, 2]
        stale = {**profile, 'revision': 5, 'expectedRevision': 4, 'requestId': 'stale'}
        assert request('/storage/profile', stale).get('code') == 'STORAGE_CONFLICT'
        passed('The profile keeps three distinct backups and rejects conflicting commits')
        statefile = folder / 'profile-v2.bin'
        good = statefile.read_bytes()
        statefile.write_bytes(b'broken-profile')
        assert request('/storage/profile')['revision'] == 4
        statefile.write_bytes(good)
        handle = kernel.CreateFileW(str(statefile), 0x80000000, 0, None, 3, 0x80, None)
        assert handle not in (None, ctypes.c_void_p(-1).value)
        try:
            assert request('/storage/profile').get('code') == 'STORAGE_READ'
        finally:
            kernel.CloseHandle(handle)
        assert request('/storage/profile') == profile
        passed('Corrupt profiles restore a verified backup while sharing violations remain visible errors')
        retained = {file: file.read_bytes() for file in folder.glob('profile-v2.bin*') if file.is_file()}
        for file in retained:
            file.write_bytes(b'bad-copy')
        try:
            assert request('/storage/profile').get('code') == 'STORAGE_READ'
            assert request('/storage/profile', {**profile, 'revision': 6, 'expectedRevision': 5}).get('ok') is False
        finally:
            for file, raw in retained.items():
                file.write_bytes(raw)
        passed('If every profile copy is damaged the host refuses an empty reset or overwrite')

        journal = {'serial': 10, 'kind': 'run', 'userId': owner, 'submissionId': 'synthetic-attempt',
                   'revision': 1, 'answers': {'written': 'Ж' * 48000}}
        for serial in range(10, 14):
            journal = {**journal, 'serial': serial, 'revision': serial}
            assert request('/vault/journal', journal, cap)['ok']
        assert request('/vault/journal', capability=cap) == journal
        journalfile = objectfile.parent / ('journal-' + owner + '.bin')
        journalfile.write_bytes(b'broken-newest-journal')
        assert request('/vault/journal', capability=cap)['serial'] == 12
        replacement = {**journal, 'answers': {'written': 'Replacement after backup recovery'}}
        assert request('/vault/journal', replacement, cap)['ok']
        assert request('/vault/journal', capability=cap) == replacement
        assert request('/vault/journal', {**journal, 'serial': 11}, cap)['ok']
        assert request('/vault/journal', capability=cap) == replacement
        assert request('/vault/journal', {**journal, 'userId': 'foreign'}, cap).get('ok') is False
        passed('A large Unicode journal restores backups and never falsely acknowledges a rolled-back serial')
        orphan = secrets.token_hex(32)
        assert request('/vault/objects/' + orphan, payload, cap)['ok']
        assert request('/storage/gc', {}, cap)['ok']
        assert objectfile.exists()
        assert (objectfile.parent / (backup_only + '.bin')).exists()
        assert not (objectfile.parent / (orphan + '.bin')).exists()
        assert journalfile.exists()
        passed('Collection removes orphan objects and preserves every referenced object and account journal')
        assert request('/vault/close', {}, cap)['ok']
        assert request(path, capability=cap).get('code') == 'FORBIDDEN'
        assert request('/vault/journal', capability=cap).get('code') == 'FORBIDDEN'
        assert request('/storage/status')['recoveredCopies'] >= 2
        passed('Closing the native vault invalidates its capability and exposes backup recovery status')
        assert request('/storage/status')['rememberedSessions'] is True
        assert request('/vault/open', {'owner': owner, 'key': key, 'capability': cap})['ok']
        assert request('/vault/remember', {}, cap)['ok']
        rememberedfile = folder / 'remembered-v1.bin'
        raw = rememberedfile.read_bytes()
        assert key.encode() not in raw and bytes.fromhex(key) not in raw
        remembered = json.loads(dpapi(raw, False))
        assert remembered['owner'] == owner and remembered['key'] == key
        assert 'password' not in remembered and 'token' not in remembered
        passed('The remembered vault key is DPAPI-protected and contains no password or bearer token')

        def restart():
            global process, origin, launch_key
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            process.wait(timeout=10)
            launch.unlink(missing_ok=True)
            process = subprocess.Popen([str(exe)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            until = time.monotonic() + 30
            while time.monotonic() < until:
                assert process.poll() is None
                if launch.exists():
                    parsed = urllib.parse.urlsplit(launch.read_bytes().decode('utf-16-le').rstrip('\0'))
                    origin = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))
                    launch_key = urllib.parse.parse_qs(parsed.query)['key'][0]
                    return
                time.sleep(.1)
            raise AssertionError('Restart did not create a native launch receipt')

        restart()
        restored = request('/vault/remembered')
        assert restored['remembered'] is True and restored['owner'] == owner and restored['key'] == key
        assert request(path).get('code') == 'FORBIDDEN'
        cap = secrets.token_hex(32)
        assert request('/vault/open', {'owner': restored['owner'], 'key': restored['key'], 'capability': cap})['ok']
        assert request(path, capability=cap) == payload
        assert request('/vault/journal', capability=cap) == replacement
        passed('A complete Windows host restart restores the saved key, private objects and last journal')
        handle = kernel.CreateFileW(str(rememberedfile), 0x80000000, 0, None, 3, 0x80, None)
        assert handle not in (None, ctypes.c_void_p(-1).value)
        try:
            assert request('/vault/remembered').get('code') == 'REMEMBERED_READ'
            assert request('/vault/forget', {}).get('ok') is False
        finally:
            kernel.CloseHandle(handle)
        assert request('/vault/remembered')['remembered'] is True
        passed('A locked saved-login file reports an error and never falsely acknowledges logout')
        rememberedfile.write_bytes(b'corrupt-remembered-cache')
        assert request('/vault/remembered').get('code') == 'REMEMBERED_READ'
        assert request(path, capability=cap) == payload
        assert request('/vault/remember', {}, cap)['ok']
        passed('A corrupt saved-login cache cannot erase private data and can be repaired by a valid owner')
        assert request('/vault/forget', {})['ok']
        assert request('/vault/close', {}, cap)['ok']
        restart()
        assert request('/vault/remembered')['remembered'] is False
        assert 'key' not in json.loads(dpapi(rememberedfile.read_bytes(), False))
        passed('Explicit logout remains forgotten after another complete Windows restart')
        report = {'status': 'passed', 'passed': len(checks), 'checks': checks,
                  'actualWindowsHostExecuted': True, 'realDPAPIVerified': True,
                  'realCNGGCMVerified': True, 'productionRPCRequests': 0, 'browserRendered': False}
        print(json.dumps(report, ensure_ascii=False), flush=True)
        if len(sys.argv) > 2:
            Path(sys.argv[2]).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        if process.poll() is None:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        until = time.monotonic() + 10
        while browser.exists():
            try:
                browser.unlink()
            except PermissionError:
                if time.monotonic() >= until:
                    raise
                time.sleep(.1)
