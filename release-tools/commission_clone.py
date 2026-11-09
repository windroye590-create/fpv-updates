"""Generate an isolated commission edition from an explicitly pinned common source.

No production files, Google resources, credentials or release assets are copied.
The generated provenance allows a future common fix to be reviewed against the
exact upstream revision, while commission-specific changes stay in this repo.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

TEXT={'.py','.js','.mjs','.json','.gs','.c','.h','.md','.html','.css','.yml','.yaml','.txt','.ps1','.def','.xml'}
OLD_SHEET='1acfLVVoxCYs75ruUgTEIvwBLgb072QVz1MgEIW2b1sI'
OLD_DEPLOY='AKfycbxthXT1noK9KVJGiqgLOu8L5HgUI8olKC4cySBYM8Yaj4Um8Usm0OgqzZeC1pt5csh7VQ'
OLD_SCRIPT='1IeUxTygw89IDekw0K1vr-XYVFwNGTYE1nU1jM7wWjsfu8CEmo6pFW4RY'
MIRROR='https://raw.githubusercontent.com/windroye590-create/litakova-updates/6ed911b3cf28bf3f7401e0b80c79b8713d7ff61f/release-tools/vendor/'

def transform(text,profile):
    # The shared portable build-tool mirror is a pinned dependency, not an app channel.
    text=text.replace(MIRROR,'__PINNED_TOOL_MIRROR__')
    for old,new in [('windroye590-create/litakova-updates',profile['repository']),
                    (OLD_DEPLOY,profile['cloud'].get('deploymentId') or 'FPV_DEPLOYMENT_NOT_CONNECTED'),
                    (OLD_SCRIPT,profile['cloud'].get('scriptId') or 'FPV_SCRIPT_NOT_CONNECTED'),
                    (OLD_SHEET,profile['cloud'].get('spreadsheetId') or 'FPV_DATABASE_NOT_CONNECTED'),
                    ('LitakovaKomisiiaPC',profile['storageDirectory']),
                    ('Літакова Комісія',profile['name']),('Літакова<br>Комісія','FPV<br>Комісія'),
                    ('Літакова','FPV'),('Litakova','FPV'),('litakova','fpv'),
                    ('Дзюбленко Денис Олександрович',profile['developerName'])]:
        text=text.replace(old,new)
    return text.replace('__PINNED_TOOL_MIRROR__',MIRROR)

def generate(upstream,profile,destination):
    upstream=Path(upstream).resolve();destination=Path(destination).resolve()
    if destination==upstream or destination.is_relative_to(upstream):raise ValueError('Use a separate commission checkout')
    if destination.exists() and any(destination.iterdir()):raise ValueError('The target must be empty; review existing commission changes before updating')
    if profile['id']!='fpv' or not re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+',profile['repository']):raise ValueError('Invalid FPV profile')
    revision=profile['upstream']['commit']
    raw=subprocess.check_output(['git','archive','--format=zip',revision],cwd=upstream)
    destination.mkdir(parents=True,exist_ok=True);files={}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            name=entry.filename;parts=Path(name).parts
            if entry.is_dir() or '..' in parts:continue
            keep=parts[0] in {'source','release-tools','.github'} or name in {'.gitignore','.gitattributes','automation.json'}
            if not keep or any(p in {'build','verification','node_modules','__pycache__','legacy-workflows'} for p in parts[:2]):continue
            if name.endswith('.zip') or name.endswith(('.p12','.pfx','.jks','.key')):continue
            data=archive.read(entry)
            if Path(name).suffix in TEXT:data=transform(data.decode('utf-8'),profile).encode('utf-8')
            target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
            files[name]={'upstreamSha256':hashlib.sha256(archive.read(entry)).hexdigest(),'generatedSha256':hashlib.sha256(data).hexdigest()}
    def read(name):return (destination/name).read_text()
    def write(name,value):
        p=destination/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value)
    def replace(name,old,new):
        text=read(name)
        if old not in text:raise ValueError('Upstream contract changed: '+name+' '+old[:80])
        write(name,text.replace(old,new))
    package=json.loads(read('source/package.json'));package.update(name='fpv-komisiia-pc',version=profile['version'],versionCode=profile['versionCode'],executableName=profile['executableName'])
    write('source/package.json',json.dumps(package,ensure_ascii=False,indent=2)+'\n')
    for name in ['source/web/core.js','source/native/update_protocol.h','source/Code.gs']:
        text=read(name)
        text=re.sub(r"export const APP_VERSION='[^']+';","export const APP_VERSION='"+profile['version']+"';",text)
        text=re.sub(r'#define PC_VERSION_NAME "[^"]+"','#define PC_VERSION_NAME "'+profile['version']+'"',text)
        text=re.sub(r'#define PC_VERSION_CODE \d+u','#define PC_VERSION_CODE '+str(profile['versionCode'])+'u',text)
        text=re.sub(r'const LATEST_APP_VERSION_CODE = \d+;','const LATEST_APP_VERSION_CODE = '+str(profile['versionCode'])+';',text)
        text=re.sub(r"const LATEST_APP_VERSION_NAME = '[^']+';","const LATEST_APP_VERSION_NAME = '"+profile['version']+"';",text)
        write(name,text)
    replace('source/web/core.js',"?'Розробник/Інструктор':","?'Розробник':")
    # A fresh signing container is generated on the owner's PC; the original
    # commission certificate is never an accepted FPV release credential.
    old="'c03ab1e2f80212ead6619a733443c2a227cf563effee776689ab27f74c133dad'"
    for name in ['release-tools/release_pipeline.py','source/release-tools/publish_updates.py']:
        replace(name,old,"json.loads((Path(__file__).resolve().parents[1]/'commission.json').read_text())['signing']['certificateSha256']" if name.startswith('release-tools/') else "json.loads((pathlib.Path(__file__).resolve().parents[1]/'commission.json').read_text())['signing']['certificateSha256']")
    replace('release-tools/release_pipeline.py',"    require(latest is not None and not latest['draft'], 'No existing public release to compare')", "    if latest is None:return 0,'0.0.0'\n    require(not latest['draft'], 'No public release to compare')")
    # The source-only verification must not require a previous published binary.
    replace('release-tools/tests/test_release_pipeline.py',"class SnapshotTests(unittest.TestCase):","@unittest.skipUnless((pipeline.ROOT/'channel/updates.txt').exists(),'No previously published FPV catalog yet')\nclass SnapshotTests(unittest.TestCase):")
    ref={'code':1,'name':'1.0.0','file':'FPV-Komisiia-reserved.apk','size':1,'sha256':'0'*64}
    write('source/release-tools/catalog-reference.json',json.dumps(ref,indent=2)+'\n')
    # Runtime identity and bootstrap configuration are reviewed before building.
    for name in ['commission.json','source/commission.json']:write(name,json.dumps(profile,ensure_ascii=False,indent=2)+'\n')
    write('upstream-source.json',json.dumps({'upstream':profile['upstream'],'files':files},ensure_ascii=False,indent=2)+'\n')
    write('next-release-notes.md','Перший окремий випуск FPV Комісії. Повний функціонал спільної основи '+profile['upstream']['version']+': тести, письмові роботи, матеріали, Excel, архіви та захищені локальні дані.\n')
    write('source/release-notes.md',read('next-release-notes.md'))
    # The original release is unchanged. Google and release credentials are
    # supplied only after the owner signs into this edition's setup process.
    return {'commission':profile['name'],'files':len(files),'destination':str(destination),'upstream':revision}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--upstream',required=True,type=Path);p.add_argument('--profile',required=True,type=Path);p.add_argument('--destination',required=True,type=Path);a=p.parse_args()
    print(json.dumps(generate(a.upstream,json.loads(a.profile.read_text()),a.destination)))
