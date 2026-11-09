import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import publish_preview as preview
import github_release as release


class Client:
    def __init__(self):
        self.current={'id':1}
        self.candidate=None
        self.raw={}
        self.corrupt=False
        self.fail=False
    def latest(self):return self.current
    def find(self,tag):return copy.deepcopy(self.candidate)
    def request(self,method,path,body):
        if method=='POST':
            self.candidate={'id':2,'draft':True,'prerelease':body['prerelease'],'assets':[], 'html_url':'fixture-preview'}
        else:
            assert body['make_latest']=='false'
            self.candidate.update(draft=body['draft'],prerelease=body['prerelease'])
        return copy.deepcopy(self.candidate)
    def upload(self,rid,name,raw):
        if self.fail:raise OSError('Upload interrupted')
        aid=len(self.raw)+1
        self.raw[aid]=raw+(b'wrong' if self.corrupt else b'')
        result={'id':aid,'name':name}
        self.candidate['assets'].append(result)
        return result
    def download(self,asset):return self.raw[asset['id']]
    def release(self,rid):return copy.deepcopy(self.candidate)
    def delete_asset(self,asset):raise AssertionError('Published asset must not be replaced')


class PreviewPublicationTests(unittest.TestCase):
    def setUp(self):
        self.client=Client()
        self.bundle=release.Bundle('1.2.28',151,{'updates.txt':b'signed-fixture','FPV-Komisiia-PC.exe':b'MZfixture'})
        self.guard=patch.object(preview.release,'ensure_newer',return_value=self.client.current)
        self.guard.start();self.addCleanup(self.guard.stop)
    def publish(self):
        return preview.publish(self.client,self.bundle,{'screen.png':b'fixture'},'v1.2.28-preview.1','a'*40,'Review build')
    def test_preview_is_public_prerelease_and_keeps_stable_latest(self):
        result=self.publish()
        self.assertTrue(result['prerelease'])
        self.assertFalse(result['draft'])
        self.assertEqual(self.client.latest()['id'],1)
        self.assertEqual(len(result['assets']),3)
    def test_corrupt_download_never_publishes_preview(self):
        self.client.corrupt=True
        with self.assertRaisesRegex(ValueError,'differs'):self.publish()
        self.assertTrue(self.client.candidate['draft'])
        self.assertEqual(self.client.latest()['id'],1)
    def test_interrupted_upload_keeps_public_update_channel(self):
        self.client.fail=True
        with self.assertRaises(OSError):self.publish()
        self.assertTrue(self.client.candidate['draft'])
        self.assertEqual(self.client.latest()['id'],1)
    def test_published_preview_bytes_are_immutable(self):
        self.publish()
        self.client.raw[1]=b'old-public-bytes'
        with self.assertRaisesRegex(ValueError,'immutable'):self.publish()
