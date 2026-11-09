import json
import base64
import hashlib
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release_pipeline as pipeline


class VersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name)
        for name in ['package.json', 'web/core.js', 'native/update_protocol.h', 'Code.gs']:
            destination = self.source / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(pipeline.SOURCE / name, destination)
        package_path = self.source / 'package.json'
        package = json.loads(package_path.read_text())
        package.update(version='1.2.27', versionCode=150)
        package_path.write_text(json.dumps(package))
        self.override = patch.object(pipeline, 'SOURCE', self.source)
        self.override.start()
        self.addCleanup(self.override.stop)

    def test_prepared_version_matches_frontend_native_and_server(self):
        result = pipeline.prepare('1.2.28', 150, '1.2.27')
        self.assertEqual((result['version'], result['versionCode']), ('1.2.28', 151))
        self.assertIn("APP_VERSION='1.2.28'", (self.source / 'web/core.js').read_text())
        self.assertIn('PC_VERSION_CODE 151u', (self.source / 'native/update_protocol.h').read_text())
        self.assertIn("LATEST_APP_VERSION_NAME = '1.2.28'", (self.source / 'Code.gs').read_text())

    def test_failed_release_retry_reuses_its_prepared_code(self):
        first = pipeline.prepare('1.2.28', 150, '1.2.27')
        retry = pipeline.prepare('1.2.28', 150, '1.2.27')
        self.assertEqual(first['versionCode'], retry['versionCode'])

    def test_remote_newer_code_is_never_replaced_with_local_old_counter(self):
        self.assertEqual(pipeline.prepare('1.2.30', 170, '1.2.29')['versionCode'], 171)

    def test_stable_build_updates_an_installed_preview_and_clears_its_label(self):
        core=self.source/'web/core.js'
        core.write_text(core.read_text().replace('export const PREVIEW_BUILD=false;',
                                                'export const PREVIEW_BUILD=true;'))
        if 'export const PREVIEW_BUILD=' not in core.read_text():
            core.write_text(core.read_text()+'\nexport const PREVIEW_BUILD=true;\n')
        result=pipeline.prepare('1.2.28',151,'1.2.27')
        self.assertEqual(result['versionCode'],152)
        self.assertIn('export const PREVIEW_BUILD=false;',core.read_text())

    def test_invalid_or_old_versions_do_not_modify_sources(self):
        before = (self.source / 'package.json').read_bytes()
        for version in ['1.2.27', '1.2.26', '1.2.28; command', '../1.2.28', 'v1.2.28']:
            with self.assertRaises(ValueError):
                pipeline.prepare(version, 150, '1.2.27')
        self.assertEqual((self.source / 'package.json').read_bytes(), before)


class SnapshotTests(unittest.TestCase):
    def test_candidate_records_complete_source_without_publishing_or_private_files(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / 'release-tools').mkdir()
            from cryptography.hazmat.primitives import hashes,serialization
            from cryptography.hazmat.primitives.asymmetric import padding,rsa
            key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
            (root/'release-tools/update-public.pem').write_bytes(key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo))
            (root / 'next-release-notes.md').write_text('Verified release fixture')
            receipt = root / 'plan.json'
            receipt.write_text(json.dumps({'changed': False, 'targetBuild': 'existing-server'}))
            bundle=root/'input-bundle';bundle.mkdir()
            executable=b'MZsynthetic snapshot executable';(bundle/'FPV-Komisiia-PC.exe').write_bytes(executable)
            (bundle/'icon.png').write_bytes(b'\x89PNG\r\n\x1a\nsynthetic-icon')
            (bundle/'index.html').write_text('FPV-Komisiia-PC.exe 1.0.0')
            payload=('schema=1\nandroid.code=1\nandroid.name=1.0.0\nandroid.file=FPV-Komisiia-reserved.apk\nandroid.size=1\nandroid.sha256='+('0'*64)+'\nwindows.code=1\nwindows.name=1.0.0\nwindows.file=FPV-Komisiia-PC.exe\nwindows.size='+str(len(executable))+'\nwindows.sha256='+hashlib.sha256(executable).hexdigest()+'\n').encode()
            wire=b'LKUPDATE1\n'+base64.b64encode(key.sign(payload,padding.PKCS1v15(),hashes.SHA256()))+b'\n'+payload
            (bundle/'updates.txt').write_bytes(wire)
            self.assertFalse((root/'channel').exists())
            with patch.object(pipeline, 'ROOT', root), patch.dict('os.environ', {
                'GITHUB_REF': 'refs/heads/main', 'GITHUB_REPOSITORY': pipeline.github.REPOSITORY,
            }):
                paths = pipeline.snapshot(bundle, receipt, dry_run=True)
            import zipfile
            archives = list((root / 'release-staging').rglob('*.zip'))
            self.assertEqual(len(archives), 1)
            with zipfile.ZipFile(archives[0]) as archive:
                self.assertIn('web/vendor/pdfjs/build/pdf.mjs', archive.namelist())
                self.assertEqual(archive.read('web/results.js'), (pipeline.SOURCE / 'web/results.js').read_bytes())
                self.assertFalse(any(Path(name).suffix in {'.jks', '.p12', '.key'} for name in archive.namelist()))
            self.assertEqual((root / 'channel/FPV-Komisiia-PC.exe').read_bytes(), (bundle / 'FPV-Komisiia-PC.exe').read_bytes())
            self.assertIn('channel', paths)
            self.assertFalse((root / '.git').exists())


class PublishedPreviewVersionTests(unittest.TestCase):
    def test_a_first_fpv_release_starts_without_an_existing_published_catalog(self):
        class Client:
            def latest(self):return None
        with patch.object(pipeline.github,'GitHub',return_value=Client()):
            self.assertEqual(pipeline.published_version(),(0,'0.0.0'))
    def test_signed_public_previews_reserve_their_build_codes(self):
        stable={'id':1,'draft':False,'assets':[{'name':'updates.txt','code':150}]}
        previews=[{'draft':False,'prerelease':True,'assets':[{'name':'updates.txt','code':151}]},
                  {'draft':True,'prerelease':True,'assets':[{'name':'updates.txt','code':999}]},
                  {'draft':False,'prerelease':True,'assets':[{'name':'updates.txt','code':888,'invalid':True}]}]
        class Client:
            def latest(self):return stable
            def request(self,method,path):return previews
            def download(self,asset):return asset
        def verify(asset,key):
            if asset.get('invalid'):raise ValueError('Invalid signature')
            return {'windows.code':str(asset['code']),'windows.name':'1.2.27'}
        with patch.object(pipeline.github,'GitHub',return_value=Client()),patch.object(pipeline.github,'verify_catalog',side_effect=verify):
            self.assertEqual(pipeline.published_version(),(151,'1.2.27'))

    def test_failure_to_read_a_preview_cannot_reuse_its_counter(self):
        class Client:
            def latest(self):return {'draft':False,'assets':[{'name':'updates.txt','stable':True}]}
            def request(self,method,path):return [{'draft':False,'prerelease':True,'assets':[{'name':'updates.txt'}]}]
            def download(self,asset):
                if not asset.get('stable'):raise OSError('Network interrupted')
                return {'windows.code':'150','windows.name':'1.2.27'}
        with patch.object(pipeline.github,'GitHub',return_value=Client()),patch.object(pipeline.github,'verify_catalog',side_effect=lambda raw,key:raw):
            with self.assertRaises(OSError):pipeline.published_version()


if __name__ == '__main__':
    unittest.main()
