"""Run the production replacement/resume functions with Windows API doubles."""
from pathlib import Path
import subprocess,json,tempfile,datetime
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='lk-native-updater-') as tmp:
    exe=Path(tmp)/'test'
    subprocess.run(['gcc','-std=c11','-O1','-fshort-wchar','-ffunction-sections','-fdata-sections','-Wl,--gc-sections','-I'+str(root/'native'),str(root/'tests/update_native_model.c'),'-o',str(exe)],check=True)
    result=subprocess.run([str(exe)],capture_output=True,text=True,check=True)
    print(result.stdout,end='')
    checks=[line[5:] for line in result.stdout.splitlines() if line.startswith('PASS ')]
    report={'status':'passed','passed':len(checks),'checks':checks,'implementation':'actual native/updater.h and native/icon_cache.h','platform':'Linux, in-memory Win32 and controllable crypto API doubles','actualWindowsProcessRestartVerified':False,'windowsShellIconCacheRuntimeVerified':False,'realRSAValidation':'separate update_protocol.py suite','testedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (root/'verification/update-native.json').write_text(json.dumps(report,indent=2)+'\n')
