"""Provision a fresh FPV edition under its verified Google owner.

This never copies learning data or authorizes Google on the owner's behalf.
After provisioning, the owner runs setupCommission once in the Google editor
to grant the new script its Spreadsheet permission, then uses release.yml.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import time
from urllib.parse import urlencode
from urllib.request import Request

import appscript_deploy as gas
import github_release as releases
import release_pipeline as pipeline

ROOT=Path(__file__).resolve().parents[1]
OLD_DATABASE='1acfLVVoxCYs75ruUgTEIvwBLgb072QVz1MgEIW2b1sI'
OLD_DEPLOYMENT='AKfycbxthXT1noK9KVJGiqgLOu8L5HgUI8olKC4cySBYM8Yaj4Um8Usm0OgqzZeC1pt5csh7VQ'

def require(value,message):
    if not value:raise ValueError(message)

def write_json(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

class OwnerGoogle:
    def __init__(self,credential):
        # Google() verifies the actual account email before any resource write.
        self.google=gas.Google(credential)

    def request(self,method,service,path,body=None):
        bases={'drive':'https://www.googleapis.com/drive/v3','script':'https://script.googleapis.com/v1'}
        require(service in bases and path.startswith('/'),'Unexpected Google resource')
        return gas.read_json(Request(bases[service]+path,method=method,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+self.google.token,'Content-Type':'application/json'}))

def checkpoint(profile,state):
    for name in ['commission.json','source/commission.json']:write_json(ROOT/name,profile)
    settings=json.loads((ROOT/'automation.json').read_text())
    settings.update({k:v for k,v in profile['cloud'].items() if v});settings['ownerEmail']=profile['ownerEmail']
    write_json(ROOT/'automation.json',settings);write_json(ROOT/'bootstrap-state.json',state)
    paths=['commission.json','source/commission.json','automation.json','bootstrap-state.json','source/Code.gs','source/web/core.js','source/native/main.c','source/native/update_key.h','release-tools/update-public.pem']
    pipeline.git('add','--',*paths)
    if pipeline.git('diff','--cached','--name-only'):
        pipeline.git('-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','Configure isolated FPV owner resources')
        pipeline.git('push','origin','HEAD:main',authenticated=True)

def pin_signing(profile,encoded,password):
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.serialization import pkcs12
    raw=base64.b64decode(encoded.strip(),validate=True)
    require(0<len(raw)<256*1024,'Invalid FPV signing container')
    key,certificate,_=pkcs12.load_key_and_certificates(raw,password.strip().encode())
    require(key is not None and certificate is not None and key.key_size==3072,'FPV requires an RSA-3072 certificate')
    require(key.public_key().public_numbers()==certificate.public_key().public_numbers(),'The certificate and private key differ')
    digest=certificate.fingerprint(hashes.SHA256()).hex();expected=profile['signing'].get('certificateSha256')
    require(expected is None or expected==digest,'The original FPV signing certificate must be preserved')
    require(digest!='c03ab1e2f80212ead6619a733443c2a227cf563effee776689ab27f74c133dad','Use a separate FPV key')
    profile['signing']['certificateSha256']=digest
    public=key.public_key();numbers=public.public_numbers()
    blob=struct.pack('<BBHIIII',6,2,0,0x2400,0x31415352,3072,numbers.e)+numbers.n.to_bytes(384,'little')
    (ROOT/'source/native/update_key.h').write_text('/* FPV RSA-3072 release verification key. */\nstatic const BYTE update_public_blob[]={'+','.join(map(str,blob))+'};\n')
    (ROOT/'release-tools/update-public.pem').write_bytes(public.public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo))
    return digest

def configure_source(profile,invite_hash,invite_until):
    cloud=profile['cloud'];require(cloud['spreadsheetId'] and cloud['spreadsheetId']!=OLD_DATABASE,'Refusing the original commission database')
    code=ROOT/'source/Code.gs';text=code.read_text()
    fields=[(r"^const SPREADSHEET_ID = '[^']+';","const SPREADSHEET_ID = '"+cloud['spreadsheetId']+"';"),
            (r"^const OWNER_SETUP_INVITE_HASH = '[^']*';","const OWNER_SETUP_INVITE_HASH = '"+invite_hash+"';"),
            (r'^const OWNER_SETUP_INVITE_UNTIL = \d+;','const OWNER_SETUP_INVITE_UNTIL = '+str(invite_until)+';')]
    for pattern,replacement in fields:
        text,count=re.subn(pattern,lambda _:replacement,text,flags=re.M);require(count==1,'Server configuration contract changed')
    build='pc-api26-'+gas.semantic_hash(text)[:16]
    text,count=re.subn(r"serverBuild:\s*'[^']+'","serverBuild: '"+build+"'",text);require(count==1,'Missing unique server identity')
    code.write_text(text)
    if cloud['deploymentId']:
        require(cloud['deploymentId']!=OLD_DEPLOYMENT,'Refusing the original deployment')
        url='https://script.google.com/macros/s/'+cloud['deploymentId']+'/exec';cloud['webAppUrl']=url
        core=ROOT/'source/web/core.js';updated,count=re.subn(r"^export const CLOUD_URL='[^']+';","export const CLOUD_URL='"+url+"';",core.read_text(),flags=re.M);require(count==1,'Missing cloud endpoint');core.write_text(updated)
        native=ROOT/'source/native/main.c';updated,count=re.subn(r'L"/macros/s/[A-Za-z0-9_-]+/exec"','L"/macros/s/'+cloud['deploymentId']+'/exec"',native.read_text());require(count==1,'Missing native endpoint');native.write_text(updated)
    return build

def provision(client,profile,state,invite_hash,invite_until,save=checkpoint):
    cloud=profile['cloud'];repo=profile['repository']
    require(profile['id']=='fpv' and repo=='windroye590-create/fpv-updates','Unexpected commission')
    if not cloud.get('spreadsheetId'):
        query="trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='commissionRepository' and value='"+repo+"' }"
        existing=client.request('GET','drive','/files?'+urlencode({'q':query,'fields':'files(id,name)','pageSize':100})).get('files',[])
        require(len(existing)<=1,'More than one FPV database exists; review before continuing')
        file=existing[0] if existing else client.request('POST','drive','/files?fields=id',{'name':profile['name']+' — Службова база','mimeType':'application/vnd.google-apps.spreadsheet','appProperties':{'commissionRepository':repo}})
        cloud['spreadsheetId']=file['id'];state['phase']='database_created';save(profile,state)
    require(cloud['spreadsheetId']!=OLD_DATABASE,'Refusing the original commission database')
    if not cloud.get('scriptId'):
        title=profile['name']+' — сервер '+cloud['spreadsheetId'][-8:]
        query="trashed = false and mimeType = 'application/vnd.google-apps.script' and name='"+title+"'"
        existing=client.request('GET','drive','/files?'+urlencode({'q':query,'fields':'files(id,name)','pageSize':100})).get('files',[])
        require(len(existing)<=1,'More than one FPV script matches this database')
        cloud['scriptId']=existing[0]['id'] if existing else client.request('POST','script','/projects',{'title':title})['scriptId']
        state['phase']='script_created';state['scriptUrl']='https://script.google.com/home/projects/'+cloud['scriptId']+'/edit';save(profile,state)
    base='/projects/'+cloud['scriptId']
    previous=client.request('GET','script',base+'/content').get('files',[])
    existing=next((f['source'] for f in previous if f.get('name')=='Code' and f.get('type')=='SERVER_JS'),None)
    if existing and not re.fullmatch(r'\s*function myFunction\(\)\s*\{\s*\}\s*',existing):
        require(hashlib.sha256(existing.encode()).hexdigest() in {state.get('sourceSha256'),state.get('previousSourceSha256')},'The Google source was edited outside this FPV bootstrap; review before replacing it')
    build=configure_source(profile,invite_hash,invite_until)
    text=(ROOT/'source/Code.gs').read_text();state['previousSourceSha256']=state.get('sourceSha256');state['sourceSha256']=hashlib.sha256(text.encode()).hexdigest()
    manifest={'timeZone':'Europe/Kyiv','exceptionLogging':'STACKDRIVER','runtimeVersion':'V8','oauthScopes':['https://www.googleapis.com/auth/spreadsheets'],'webapp':{'executeAs':'USER_DEPLOYING','access':'ANYONE_ANONYMOUS'}}
    files=[{'name':'Code','type':'SERVER_JS','source':text},{'name':'appsscript','type':'JSON','source':json.dumps(manifest)}]
    require(all(f.get('name') in {'Code','appsscript'} for f in previous),'Unexpected Google files would be replaced')
    state['phase']='source_pending';save(profile,state)
    client.request('PUT','script',base+'/content',{'files':files})
    state['phase']='source_created';save(profile,state)
    version=client.request('POST','script',base+'/versions',{'description':'FPV initial owner setup'})['versionNumber']
    config={'versionNumber':version,'manifestFileName':'appsscript','description':'FPV initial owner setup'}
    if cloud.get('deploymentId'):
        require(cloud['deploymentId']!=OLD_DEPLOYMENT,'Refusing the original deployment')
        client.request('PUT','script',base+'/deployments/'+cloud['deploymentId'],{'deploymentConfig':config})
    else:
        deployments=client.request('GET','script',base+'/deployments').get('deployments',[])
        matches=[d for d in deployments if d.get('deploymentConfig',{}).get('description')==config['description']]
        require(len(matches)<=1,'Multiple FPV bootstrap deployments exist')
        if matches:cloud['deploymentId']=matches[0]['deploymentId'];client.request('PUT','script',base+'/deployments/'+cloud['deploymentId'],{'deploymentConfig':config})
        else:cloud['deploymentId']=client.request('POST','script',base+'/deployments',config)['deploymentId']
    configure_source(profile,invite_hash,invite_until)
    state.update(phase='awaiting_owner_authorization',serverBuild=build,deploymentVersion=version,scriptUrl='https://script.google.com/home/projects/'+cloud['scriptId']+'/edit')
    save(profile,state);return state

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--invite-hash',required=True);parser.add_argument('--invite-until',required=True,type=int);args=parser.parse_args()
    require(re.fullmatch(r'[a-f0-9]{64}',args.invite_hash),'Expected a SHA-256 first-registration verifier')
    require(time.time()*1000<args.invite_until<=time.time()*1000+2*86400000,'The owner invitation must expire within two days')
    profile=json.loads((ROOT/'commission.json').read_text());require(os.environ.get('GITHUB_REPOSITORY')==profile['repository'],'Refusing another release repository')
    require(releases.GitHub(profile['repository'],os.environ['GITHUB_TOKEN']).latest() is None,'FPV is already published; use the regular release process')
    client=OwnerGoogle(os.environ['GAS_CREDENTIALS'])
    pin_signing(profile,os.environ['LK_SIGNING_PKCS12_BASE64'],os.environ['LK_SIGNING_PASSWORD'])
    path=ROOT/'bootstrap-state.json';state=json.loads(path.read_text()) if path.exists() else {'commission':'fpv'}
    result=provision(client,profile,state,args.invite_hash,args.invite_until)
    summary='FPV підготовлено. Власник Google відкриває '+result['scriptUrl']+' і один раз запускає setupCommission для надання доступу до таблиць. Після успішного виконання можна випустити 1.0.0 через release.yml.\n'
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:f.write(summary)
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
