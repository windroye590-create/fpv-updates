"""Run both actual Windows apps and inspect their native browser window identity.

Uses isolated LOCALAPPDATA and fresh login screens. No accounts are created,
passwords entered or learning records changed. Initial public group reads may
occur through the normal app startup.
"""
import ctypes as c
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

assert sys.platform == 'win32'
fpv, previous, litakova = map(lambda p: Path(p).resolve(), sys.argv[1:4])
out = Path(sys.argv[4]).resolve()
out.mkdir(parents=True, exist_ok=True)
u, g, kernel, shell, ole = (c.WinDLL(n) for n in ['user32', 'gdi32', 'kernel32', 'shell32', 'ole32'])
u.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
u.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
u.GetDC.argtypes = [w.HWND]; u.GetDC.restype = w.HDC
u.ReleaseDC.argtypes = [w.HWND, w.HDC]
u.IsWindow.argtypes = [w.HWND]
u.SendMessageTimeoutW.argtypes = [w.HWND, w.UINT, c.c_size_t, c.c_ssize_t, w.UINT, w.UINT, c.POINTER(c.c_size_t)]
u.SendMessageTimeoutW.restype = c.c_ssize_t
u.GetClassLongPtrW.argtypes = [w.HWND, c.c_int]; u.GetClassLongPtrW.restype = c.c_size_t
g.GetObjectW.argtypes = [w.HANDLE, c.c_int, c.c_void_p]
g.GetDIBits.argtypes = [w.HDC, w.HBITMAP, w.UINT, w.UINT, c.c_void_p, c.c_void_p, w.UINT]
g.DeleteObject.argtypes = [w.HANDLE]
kernel.GetTickCount64.restype = c.c_uint64

class IconInfo(c.Structure):
    _fields_ = [('icon', w.BOOL), ('x', w.DWORD), ('y', w.DWORD), ('mask', w.HBITMAP), ('color', w.HBITMAP)]
class Bitmap(c.Structure):
    _fields_ = [('type', w.LONG), ('width', w.LONG), ('height', w.LONG), ('stride', w.LONG), ('planes', w.WORD), ('bits', w.WORD), ('data', c.c_void_p)]
class BitmapHeader(c.Structure):
    _fields_ = [('size', w.DWORD), ('width', w.LONG), ('height', w.LONG), ('planes', w.WORD), ('bits', w.WORD), ('compression', w.DWORD), ('imageSize', w.DWORD), ('x', w.LONG), ('y', w.LONG), ('used', w.DWORD), ('important', w.DWORD)]
u.GetIconInfo.argtypes = [w.HICON, c.POINTER(IconInfo)]
callback = c.WINFUNCTYPE(w.BOOL, w.HWND, c.c_ssize_t)
u.EnumWindows.argtypes = [callback, c.c_ssize_t]

def windows(title):
    found = []
    @callback
    def visit(hwnd, _):
        text, kind = c.create_unicode_buffer(256), c.create_unicode_buffer(64)
        u.GetWindowTextW(hwnd, text, len(text)); u.GetClassNameW(hwnd, kind, len(kind))
        if text.value == title and kind.value == 'Chrome_WidgetWin_1': found.append(hwnd)
        return True
    u.EnumWindows(visit, 0)
    return found

def wait_for(test, message, seconds=45):
    end = time.monotonic()+seconds
    while time.monotonic() < end:
        value = test()
        if value: return value
        time.sleep(.2)
    raise AssertionError(message)

def message(hwnd, code, word=0):
    result = c.c_size_t()
    return result.value if not u.SendMessageTimeoutW(hwnd, code, word, 0, 2, 1000, c.byref(result)) else result.value

def icon_hash(hwnd, handle=None):
    handle = handle or next((h for h in [message(hwnd, 0x007f, 2), message(hwnd, 0x007f, 0), message(hwnd, 0x007f, 1), u.GetClassLongPtrW(hwnd, -34)] if h), 0)
    if not handle: return None
    info = IconInfo()
    if not u.GetIconInfo(handle, c.byref(info)): return None
    dc = u.GetDC(None)
    try:
        if not info.color: return None
        bitmap = Bitmap()
        assert g.GetObjectW(info.color, c.sizeof(bitmap), c.byref(bitmap))
        assert 0 < bitmap.width <= 512 and 0 < bitmap.height <= 512
        header = BitmapHeader(size=40, width=bitmap.width, height=-bitmap.height, planes=1, bits=32)
        raw = c.create_string_buffer(bitmap.width*bitmap.height*4)
        assert g.GetDIBits(dc, info.color, 0, bitmap.height, raw, c.byref(header), 0)
        return hashlib.sha256(raw.raw).hexdigest()
    finally:
        u.ReleaseDC(None, dc)
        if info.color: g.DeleteObject(info.color)
        if info.mask: g.DeleteObject(info.mask)

class PropertyKey(c.Structure):
    _fields_ = [('guid', c.c_ubyte*16), ('pid', w.DWORD)]
class VariantData(c.Union):
    _fields_ = [('ptr', c.c_void_p), ('alignment', c.c_uint64*2)]
class PropVariant(c.Structure):
    _fields_ = [('kind', w.WORD), ('reserved', w.WORD*3), ('data', VariantData)]

def app_id(hwnd, property_id=5):
    iid = (c.c_ubyte*16).from_buffer_copy(uuid.UUID('886d8eeb-8cf2-4446-8d02-cdba1dbdcf99').bytes_le)
    store = c.c_void_p()
    shell.SHGetPropertyStoreForWindow.argtypes = [w.HWND, c.c_void_p, c.POINTER(c.c_void_p)]
    assert shell.SHGetPropertyStoreForWindow(hwnd, c.byref(iid), c.byref(store)) == 0
    methods = c.cast(store, c.POINTER(c.POINTER(c.c_void_p))).contents
    get = c.WINFUNCTYPE(w.LONG, c.c_void_p, c.POINTER(PropertyKey), c.POINTER(PropVariant))(methods[5])
    release = c.WINFUNCTYPE(w.ULONG, c.c_void_p)(methods[2])
    key = PropertyKey((c.c_ubyte*16).from_buffer_copy(uuid.UUID('9f4c2855-9f79-4b39-a8d0-e1d42de1d5f3').bytes_le), property_id)
    value = PropVariant()
    try:
        assert get(store, c.byref(key), c.byref(value)) == 0
        return c.wstring_at(value.data.ptr) if value.kind == 31 and value.data.ptr else ''
    finally:
        ole.PropVariantClear(c.byref(value)); release(store)

class Resume(c.Structure):
    _fields_ = [('magic', w.DWORD), ('created', c.c_uint64), ('nonce', c.c_char*65), ('target', w.WCHAR*1100)]
class Blob(c.Structure):
    _fields_ = [('size', w.DWORD), ('data', c.c_void_p)]

def receipt(target, nonce, path):
    data = Resume(magic=0x31524b4c, created=kernel.GetTickCount64(), nonce=nonce.encode(), target=str(target))
    source, sealed = Blob(c.sizeof(data), c.addressof(data)), Blob()
    assert c.WinDLL('crypt32').CryptProtectData(c.byref(source), None, None, None, None, 1, c.byref(sealed))
    try: path.write_bytes(c.string_at(sealed.data, sealed.size))
    finally:
        kernel.LocalFree.argtypes = [c.c_void_p]; kernel.LocalFree(sealed.data)

def launch_data(path):
    try:
        parsed = urllib.parse.urlsplit(path.read_bytes().decode('utf-16-le').rstrip('\0'))
        key = urllib.parse.parse_qs(parsed.query)['key'][0]
        origin = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))
        with urllib.request.urlopen(urllib.request.Request(origin+'/clock', headers={'X-LK-Key': key}), timeout=2) as r:
            value = json.load(r)
        return {'url': origin, 'key': key, 'clock': value} if value.get('storageProtocol') == 2 else None
    except (OSError, ValueError, KeyError, urllib.error.URLError): return None

checks, processes = [], []
def passed(name): checks.append(name); print('PASS '+name, flush=True)
ole.CoInitializeEx(None, 2)
with tempfile.TemporaryDirectory(prefix='fpv-windows-identity-', ignore_cleanup_errors=True) as temp:
    data = Path(temp)/'data'; data.mkdir()
    env = {**os.environ, 'LOCALAPPDATA': str(data)}
    fpv_launch, old_launch = data/'FPVKomisiiaPC/launch.txt', data/'LitakovaKomisiiaPC/launch.txt'
    try:
        # Reproduce a live update from the shipped version, using a genuine
        # one-use DPAPI receipt. Replacement/RSA is covered by the updater suite.
        old = subprocess.Popen([str(previous)], env=env); processes.append(old)
        legacy = wait_for(lambda: launch_data(fpv_launch), 'The old FPV host did not start')
        legacy_window = wait_for(lambda: windows('FPV Комісія | ПК'), 'The old FPV window did not appear')[0]
        assert ':18747' in legacy['url']
        old.terminate(); old.wait(10)
        receipt(fpv, legacy['key'], data/'FPVKomisiiaPC/updates/resume.bin')
        new = subprocess.Popen([str(fpv), '--resume-update', legacy['key']], env=env); processes.append(new)
        current = wait_for(lambda: launch_data(fpv_launch), 'Migrated FPV did not start')
        assert current['url'].endswith(':18748') and current['key'] == legacy['key']
        wait_for(lambda: not u.IsWindow(legacy_window), 'The obsolete FPV window remained open')
        fpv_window = wait_for(lambda: windows('FPV Комісія | ПК'), 'The new FPV window did not appear')[0]
        passed('The real 1.0.0 browser migrates to the isolated origin and its obsolete window closes')
        assert (data/'FPVKomisiiaPC/browser').is_dir()
        passed('The running browser creates the FPV-only profile')
        other = subprocess.Popen([str(litakova)], env=env); processes.append(other)
        original = wait_for(lambda: launch_data(old_launch), 'Litakova could not start alongside FPV')
        litakova_window = wait_for(lambda: windows('Літакова Комісія | ПК'), 'The Litakova window did not appear')[0]
        assert original['url'].endswith(':18747') and original['key'] != current['key']
        assert new.poll() is None and other.poll() is None
        passed('Both actual apps run simultaneously on their separate local listeners')
        for target, foreign in [(current, original), (original, current)]:
            try:
                urllib.request.urlopen(urllib.request.Request(target['url']+'/clock', headers={'X-LK-Key': foreign['key']}), timeout=3)
            except urllib.error.HTTPError as error: assert json.load(error)['code'] == 'FORBIDDEN'
            else: raise AssertionError('One commission accepted the other launch secret')
        passed('Both listeners reject the other commission secret')
        def icons():
            left, right = icon_hash(fpv_window), icon_hash(litakova_window)
            return (left, right) if left and right and left != right else None
        fpv_icon, original_icon = wait_for(icons, 'Both native browser windows still have the same icon', 60)
        passed('The real Windows browser windows display different icon bitmaps')
        kernel.LoadLibraryExW.argtypes = [w.LPCWSTR, w.HANDLE, w.DWORD]; kernel.LoadLibraryExW.restype = w.HMODULE
        kernel.FreeLibrary.argtypes = [w.HMODULE]
        u.LoadImageW.argtypes = [w.HINSTANCE, c.c_void_p, w.UINT, c.c_int, c.c_int, w.UINT]; u.LoadImageW.restype = w.HANDLE
        u.DestroyIcon.argtypes = [w.HICON]
        module = kernel.LoadLibraryExW(str(fpv), None, 2)
        assert module
        expected_icon = u.LoadImageW(module, 1, 1, 32, 32, 0)
        assert expected_icon
        try: assert fpv_icon == icon_hash(None, expected_icon), 'The window does not show the FPV executable logo'
        finally: u.DestroyIcon(expected_icon); kernel.FreeLibrary(module)
        passed('The FPV window icon matches the actual drone icon embedded in its EXE')
        ids = {'fpv': app_id(fpv_window), 'litakova': app_id(litakova_window)}
        assert ids['fpv'] == 'FPVKomisiiaPC' and ids['fpv'] != ids['litakova'], ids
        passed('Windows gives the apps separate taskbar AppUserModelIDs')
        assert app_id(fpv_window, 2).casefold() == ('"'+str(fpv)+'"').casefold()
        assert app_id(fpv_window, 3).casefold() == (str(fpv)+',0').casefold()
        passed('Taskbar pinning relaunches the FPV EXE with its own icon instead of an expiring browser URL')
        from PIL import ImageGrab
        ImageGrab.grab().save(out/'two-commissions.png')
        result = {'status': 'passed', 'passed': len(checks), 'checks': checks,
                  'actualWindowsRuntimeVerified': True, 'actualBrowserWindowsVerified': True,
                  'fpvIconSHA256': fpv_icon, 'litakovaIconSHA256': original_icon,
                  'appUserModelIds': ids, 'accountRegistrationOrLearningWrites': False,
                  'fpvExeSHA256': hashlib.sha256(fpv.read_bytes()).hexdigest()}
        (out/'windows-edition-identity.json').write_text(json.dumps(result, indent=2)+'\n')
    except Exception:
        from PIL import ImageGrab
        ImageGrab.grab().save(out/'failed-window-state.png')
        raise
    finally:
        for title in ['FPV Комісія | ПК', 'Літакова Комісія | ПК']:
            for hwnd in windows(title): message(hwnd, 0x0010)
        for process in reversed(processes):
            if process.poll() is None: process.terminate(); process.wait(10)
