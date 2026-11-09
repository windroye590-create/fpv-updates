import base64
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bootstrap_commission as boot
import appscript_deploy as gas

class GoogleDouble:
    def __init__(self,lost=None):self.files=[];self.project=None;self.source=[];self.deploy=None;self.calls=[];self.lost=lost;self.versions=0
    def request(self,method,service,path,body=None):
        self.calls.append((method,service,path,copy.deepcopy(body)))
        if service=='drive':
            if method=='GET':return {'files':self.files if 'spreadsheet' in path else ([{'id':self.project}] if self.project else [])}
            self.files.append({'id':'fpv-database-isolated-1234567890'});result=self.files[-1];point='database'
        elif path=='/projects':self.project='fpv-script-isolated-1234567890';result={'scriptId':self.project};point='script'
        elif path.endswith('/content'):
            if method=='GET':return {'files':copy.deepcopy(self.source)}
            self.source=copy.deepcopy(body['files']);result={};point='source'
        elif path.endswith('/versions'):self.versions+=1;return {'versionNumber':self.versions}
        elif path.endswith('/deployments'):
            if method=='GET':return {'deployments':[] if self.deploy is None else [copy.deepcopy(self.deploy)]}
            self.deploy={'deploymentId':'fpv-deployment-isolated-1234567890','deploymentConfig':body};result=self.deploy;point='deployment'
        elif '/deployments/' in path:self.deploy['deploymentConfig']=body['deploymentConfig'];return self.deploy
        else:raise AssertionError((method,service,path))
        if self.lost==point:self.lost=None;raise OSError('Lost acknowledgement: '+point)
        return copy.deepcopy(result)

class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        for name in ['source/Code.gs','source/web/core.js','source/native/main.c']:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((boot.ROOT/name).read_bytes())
        self.profile=json.loads((boot.ROOT/'profiles/fpv.json').read_text())
        self.state={};self.saved=[];self.invite='a'*64;self.until=9999999999999
        self.override=patch.object(boot,'ROOT',self.root);self.override.start();self.addCleanup(self.override.stop)
    def save(self,p,s):self.saved.append((copy.deepcopy(p),copy.deepcopy(s)))
    def run_provision(self,client):return boot.provision(client,self.profile,self.state,self.invite,self.until,self.save)
    def test_new_resources_have_separate_database_script_deployment_and_both_client_endpoints(self):
        client=GoogleDouble();result=self.run_provision(client)
        self.assertEqual(result['phase'],'awaiting_owner_authorization');self.assertEqual(len(client.files),1)
        self.assertEqual(self.profile['cloud']['webAppUrl'],'https://script.google.com/macros/s/'+client.deploy['deploymentId']+'/exec')
        self.assertIn(self.profile['cloud']['webAppUrl'],(self.root/'source/web/core.js').read_text())
        self.assertIn('/macros/s/'+client.deploy['deploymentId']+'/exec',(self.root/'source/native/main.c').read_text())
        self.assertNotIn(boot.OLD_DATABASE,(self.root/'source/Code.gs').read_text())
        manifest=json.loads(next(f['source'] for f in client.source if f['name']=='appsscript'))
        self.assertEqual(manifest['oauthScopes'],['https://www.googleapis.com/auth/spreadsheets'])
        self.assertTrue(all('register' not in c[2] and 'intake' not in c[2] for c in client.calls))
    def test_retries_after_lost_creation_and_upload_acknowledgements_reuse_the_same_resources(self):
        for point in ['database','script','source','deployment']:
            with self.subTest(point=point):
                self.profile['cloud']={k:None for k in self.profile['cloud']};self.state={};self.saved=[];client=GoogleDouble(point)
                with self.assertRaises(OSError):self.run_provision(client)
                self.run_provision(client)
                self.assertEqual(len(client.files),1)
                self.assertEqual(sum(c[0]=='POST' and c[2]=='/projects' for c in client.calls),1)
                self.assertEqual(sum(c[0]=='POST' and c[2].endswith('/deployments') for c in client.calls),1)
    def test_a_manual_source_edit_is_not_overwritten(self):
        client=GoogleDouble();self.run_provision(client)
        client.source[0]['source']+='\n// edited by owner\n';before=copy.deepcopy(client.source);calls=len(client.calls)
        with self.assertRaisesRegex(ValueError,'edited outside'):self.run_provision(client)
        self.assertEqual(before,client.source);self.assertFalse(any(c[0]=='PUT' for c in client.calls[calls:]))
    def test_original_commission_identifiers_are_rejected_before_source_changes(self):
        self.profile['cloud']['spreadsheetId']=boot.OLD_DATABASE
        before=(self.root/'source/Code.gs').read_bytes()
        with self.assertRaisesRegex(ValueError,'original commission'):self.run_provision(GoogleDouble())
        self.assertEqual(before,(self.root/'source/Code.gs').read_bytes())
    def test_a_wrong_google_account_is_rejected_before_creating_any_resources(self):
        answers=[{'access_token':'synthetic-token'},{'email':'another@example.invalid','verified_email':True}]
        with patch.object(gas,'config',return_value={'ownerEmail':'fpv.training.center@gmail.com'}),patch.object(gas,'read_json',side_effect=answers) as read:
            with self.assertRaisesRegex(ValueError,'FPV Google owner'):gas.Google(json.dumps({'client_id':'id','client_secret':'secret','refresh_token':'refresh'}))
            self.assertEqual(read.call_count,2)

class SigningTests(unittest.TestCase):
    def test_the_new_key_is_pinned_and_a_later_replacement_is_rejected(self):
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes,serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives.serialization import pkcs12
        from cryptography.x509.oid import NameOID
        with tempfile.TemporaryDirectory() as directory,patch.object(boot,'ROOT',Path(directory)):
            (boot.ROOT/'source/native').mkdir(parents=True);(boot.ROOT/'release-tools').mkdir()
            key=rsa.generate_private_key(public_exponent=65537,key_size=3072);name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Synthetic FPV test')]);now=datetime.datetime.now(datetime.timezone.utc)
            cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=1)).sign(key,hashes.SHA256())
            wire=base64.b64encode(pkcs12.serialize_key_and_certificates(b'fpv',key,cert,None,serialization.BestAvailableEncryption(b'test-password'))).decode();p={'signing':{'certificateSha256':None}}
            first=boot.pin_signing(p,wire,'test-password');self.assertEqual(boot.pin_signing(p,wire,'test-password'),first)
            self.assertEqual((boot.ROOT/'release-tools/update-public.pem').read_bytes(),key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo))
            p['signing']['certificateSha256']='0'*64
            with self.assertRaisesRegex(ValueError,'must be preserved'):boot.pin_signing(p,wire,'test-password')

class CheckpointTests(unittest.TestCase):
    def test_real_git_checkpoints_record_both_resource_ids_and_resume_without_duplicate_commits(self):
        profile=json.loads((boot.ROOT/'profiles/fpv.json').read_text());profile['cloud']['spreadsheetId']='fpv-checkpoint-database'
        with tempfile.TemporaryDirectory() as directory:
            remote=Path(directory)/'remote.git';working=Path(directory)/'working';working.mkdir()
            def run(*args,cwd=working):return subprocess.check_output(['git',*args],cwd=cwd,stderr=subprocess.DEVNULL,text=True).strip()
            run('init','--bare',str(remote));run('init','-b','main');run('remote','add','origin',str(remote))
            for name in ['source/Code.gs','source/web/core.js','source/native/main.c','source/native/update_key.h','release-tools/update-public.pem']:
                p=working/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('synthetic source')
            (working/'automation.json').write_bytes((boot.ROOT/'automation.json').read_bytes());(working/'private-untracked.txt').write_text('must remain outside the commit')
            state={'phase':'database_created'}
            with patch.object(boot,'ROOT',working),patch.dict(os.environ,{'GITHUB_TOKEN':'synthetic-checkpoint-token'}):
                boot.checkpoint(profile,state);first=run('rev-parse','HEAD')
                self.assertEqual(run('rev-parse','refs/heads/main',cwd=remote),first)
                self.assertEqual(json.loads(run('show','HEAD:commission.json'))['cloud']['spreadsheetId'],profile['cloud']['spreadsheetId'])
                self.assertNotIn('private-untracked.txt',run('ls-tree','--name-only','HEAD'))
                boot.checkpoint(profile,state);self.assertEqual(run('rev-parse','HEAD'),first)
                profile['cloud']['scriptId']='fpv-checkpoint-script';state['phase']='script_created';boot.checkpoint(profile,state)
                self.assertNotEqual(run('rev-parse','HEAD'),first)
                self.assertEqual(json.loads(run('show','HEAD:bootstrap-state.json'))['phase'],'script_created')
                self.assertEqual(run('rev-parse','refs/heads/main',cwd=remote),run('rev-parse','HEAD'))

    def test_git_authentication_uses_a_scoped_environment_header_and_preserves_existing_config(self):
        environment={'GITHUB_TOKEN':'synthetic-private-token','GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'core.quotepath','GIT_CONFIG_VALUE_0':'false'}
        with patch.dict(os.environ,environment),patch.object(boot.subprocess,'check_output',return_value='ok\n') as call:
            self.assertEqual(boot.git('push','origin','HEAD:main',authenticated=True),'ok')
            args=call.call_args;self.assertNotIn('synthetic-private-token',' '.join(args.args[0]))
            self.assertEqual(args.kwargs['env']['GIT_CONFIG_COUNT'],'2')
            self.assertEqual(args.kwargs['env']['GIT_CONFIG_KEY_0'],'core.quotepath')
            self.assertEqual(args.kwargs['env']['GIT_CONFIG_KEY_1'],'http.https://github.com/.extraheader')
            self.assertTrue(args.kwargs['env']['GIT_CONFIG_VALUE_1'].startswith('AUTHORIZATION: basic '))

if __name__=='__main__':unittest.main()
