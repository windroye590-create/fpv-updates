import hashlib
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[2]

class EditionIsolationTests(unittest.TestCase):
    def test_runtime_targets_never_point_to_the_litakova_database_or_deployment(self):
        for name in ['source/web/core.js','source/native/main.c','source/Code.gs','automation.json']:
            content=(ROOT/name).read_text()
            self.assertNotIn('1acfLVVoxCYs75ruUgTEIvwBLgb072QVz1MgEIW2b1sI',content,name)
            self.assertNotIn('AKfycbxthXT1noK9KVJGiqgLOu8L5HgUI8olKC4cySBYM8Yaj4Um8Usm0OgqzZeC1pt5csh7VQ',content,name)
    def test_native_storage_and_updates_are_scoped_to_the_fpv_edition(self):
        native=(ROOT/'source/native/main.c').read_text();protocol=(ROOT/'source/native/update_protocol.h').read_text()
        self.assertIn('FPVKomisiiaPC',native);self.assertNotIn('LitakovaKomisiiaPC',native)
        self.assertIn('/windroye590-create/fpv-updates/releases/latest/download/',protocol)
        self.assertIn('FPV-Komisiia-',protocol)
    def test_frontend_native_server_and_package_advertise_one_fpv_release(self):
        p=json.loads((ROOT/'source/package.json').read_text())
        self.assertEqual(p['executableName'],'FPV-Komisiia-PC.exe')
        self.assertIn("APP_VERSION='"+p['version']+"'",(ROOT/'source/web/core.js').read_text())
        self.assertIn('#define PC_VERSION_NAME "'+p['version']+'"',(ROOT/'source/native/update_protocol.h').read_text())
        self.assertIn("LATEST_APP_VERSION_NAME = '"+p['version']+"'",(ROOT/'source/Code.gs').read_text())
    def test_an_unconfigured_edition_cannot_build_a_production_executable(self):
        profile=json.loads((ROOT/'source/commission.json').read_text())
        if profile['signing']['certificateSha256'] and all(profile['cloud'].values()):self.skipTest('The FPV owner has completed setup')
        executable=ROOT/'source/build/FPV-Komisiia-PC.exe';before=hashlib.sha256(executable.read_bytes()).hexdigest() if executable.exists() else None
        environment=dict(os.environ);environment.pop('COMMISSION_ALLOW_UNCONFIGURED_TEST',None)
        result=subprocess.run(['python3',str(ROOT/'source/build_windows.py')],env=environment,capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0);self.assertIn('Complete FPV owner setup',result.stderr)
        self.assertEqual(before,hashlib.sha256(executable.read_bytes()).hexdigest() if executable.exists() else None)

if __name__=='__main__':unittest.main()
