"""Check Windows-only release output and the installed catalog contract."""
from pathlib import Path
import importlib.util,json,re,subprocess,sys
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release_pc',root/'release-tools/publish_updates.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
reference=json.loads((root/'release-tools/catalog-reference.json').read_text())
windows=module.release(130,'1.2.8','FPV-Komisiia-PC.exe',100,'a'*64,'exe')
checks=[]
def check(name,run):
    run();checks.append(name);print('PASS '+name)
def contract():
    wire=module.catalog_payload(windows,reference)
    assert wire.endswith(b'\n') and wire.decode().splitlines()[0]=='schema=1'
    fields=dict(line.split('=',1) for line in wire.decode().splitlines()[1:])
    assert len(fields)==10
    for key,value in reference.items():assert fields['android.'+key]==str(value)
    for key,value in windows.items():assert fields['windows.'+key]==str(value)
check('Windows catalog preserves the installed signed field layout',contract)
def page():
    output=module.release_page(windows)
    assert re.findall(r'href="([^"]+)"',output)==['icon.png','FPV-Komisiia-PC.exe']
    assert 'Windows 1.2.8' in output
    assert not re.search(r'телефон|мобільн|\bandroid\b|\bapk\b|\bios\b|\biphone\b',output,re.I)
check('Release page offers the Windows executable and its icon only',page)
def cli():
    result=subprocess.run([sys.executable,str(root/'release-tools/publish_updates.py'),'--help'],capture_output=True,text=True,check=True)
    assert '--windows-exe' in result.stdout and '--catalog-reference' in result.stdout
    assert not re.search(r'android|apk|iphone|\bios\b',result.stdout,re.I)
check('Release command exposes the PC workflow only',cli)
def invalid():
    for args in [(True,'1.2.8','FPV-Komisiia-PC.exe',100,'a'*64,'exe'),(130,'1.2.8','../bad.exe',100,'a'*64,'exe'),(130,'1.2.8','FPV-Komisiia-PC.exe',0,'a'*64,'exe')]:
        try:module.release(*args)
        except AssertionError:continue
        raise AssertionError('Invalid release accepted')
check('Invalid release paths codes and sizes remain rejected',invalid)
(root/'verification').mkdir(exist_ok=True);(root/'verification/release-pc.json').write_text(json.dumps({'status':'passed','passed':len(checks),'checks':checks},indent=2)+'\n')
