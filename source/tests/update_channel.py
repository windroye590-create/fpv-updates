"""Check the actual updater transport configuration with WinHTTP API doubles."""
from pathlib import Path
import datetime
import json
import subprocess
import tempfile

root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='lk-channel-tests-') as temporary:
    executable=Path(temporary)/'channel-test'
    subprocess.run(['gcc','-std=c11','-O1','-fshort-wchar','-ffunction-sections','-fdata-sections','-Wl,--gc-sections','-I'+str(root/'native'),str(root/'tests/update_channel_model.c'),'-o',str(executable)],check=True)
    result=subprocess.run([str(executable)],capture_output=True,text=True,check=True)
    print(result.stdout,end='')
    checks=[line[5:] for line in result.stdout.splitlines() if line.startswith('PASS ')]
    report={'status':'passed','passed':len(checks),'checks':checks,'implementation':'actual native/updater.h','platform':'Linux with WinHTTP API doubles','windowsNetworkRuntimeVerified':False,'githubReleasePublished':False,'testedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (root/'verification/update-channel.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
