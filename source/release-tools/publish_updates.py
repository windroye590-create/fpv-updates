"""Prepare a signed Windows release using the original private key."""
import argparse,base64,hashlib,html,json,pathlib,re,shutil
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import pkcs12

def release(code,name,filename,size,digest,extension):
    assert isinstance(code,int) and not isinstance(code,bool) and 0<code<=10000000
    assert isinstance(name,str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',name) and len(name)<=31
    assert isinstance(filename,str) and len(filename)<=127 and '..' not in filename
    assert re.fullmatch(r'FPV-Komisiia-[A-Za-z0-9.-]+\.'+extension,filename)
    assert isinstance(size,int) and not isinstance(size,bool) and 0<size<=64*1024*1024
    assert isinstance(digest,str) and re.fullmatch(r'[0-9a-f]{64}',digest)
    return dict(code=code,name=name,file=filename,size=size,sha256=digest)

def catalog_payload(windows,reference):
    # The reserved section is fixed by the installed catalog format.
    reserved=release(reference['code'],reference['name'],reference['file'],reference['size'],reference['sha256'],'apk')
    lines=['schema=1']
    for section,data in [('android',reserved),('windows',windows)]:
        lines.extend(section+'.'+field+'='+str(data[field]) for field in ['code','name','file','size','sha256'])
    return ('\n'.join(lines)+'\n').encode()

def release_page(windows):
    link='<a href="'+windows['file']+'">Windows '+html.escape(windows['name'])+'</a>'
    return '''<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FPV Комісія — оновлення Windows</title><link rel="icon" href="icon.png"><style>body{font:17px/1.6 system-ui;background:#f4f4f4;color:#111;max-width:660px;margin:8vh auto;padding:24px}main{background:#fff;padding:34px;border:1px solid #ddd;border-radius:18px}a{color:#111;font-weight:650}small{color:#595959}img{object-fit:contain}</style></head><body><main><img src="icon.png" width="88" height="88" alt="Емблема"><h1>FPV Комісія для Windows</h1><p>Оновлення перевіряються за підписом і SHA-256. Облікові записи та результати зберігаються.</p><p>'''+link+'''</p><small>Розробник</small></main></body></html>'''

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['windows-exe','windows-name','pkcs12','password-file','output']:
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--catalog-reference',default=str(pathlib.Path(__file__).with_name('catalog-reference.json')))
    parser.add_argument('--windows-code',required=True,type=int)
    parser.add_argument('--icon')
    args=parser.parse_args()
    output=pathlib.Path(args.output).resolve();output.mkdir(parents=True,exist_ok=True)
    for private in [args.pkcs12,args.password_file]:
        assert not pathlib.Path(private).resolve().is_relative_to(output),'Private files must stay outside the channel'
    password=pathlib.Path(args.password_file).read_text().strip().encode()
    key,cert,_=pkcs12.load_key_and_certificates(pathlib.Path(args.pkcs12).read_bytes(),password)
    assert key.key_size==3072,'Use the original RSA release key'
    assert cert.fingerprint(hashes.SHA256()).hex()==json.loads((pathlib.Path(__file__).resolve().parents[1]/'commission.json').read_text())['signing']['certificateSha256'],'Release certificate does not match the installed app'
    reference=json.loads(pathlib.Path(args.catalog_reference).read_text())
    executable=pathlib.Path(args.windows_exe);raw=executable.read_bytes();assert raw[:2]==b'MZ'
    windows=release(args.windows_code,args.windows_name,'FPV-Komisiia-PC.exe',len(raw),hashlib.sha256(raw).hexdigest(),'exe')
    shutil.copyfile(executable,output/windows['file'])
    icon=pathlib.Path(args.icon) if args.icon else pathlib.Path(__file__).resolve().parents[1]/'web/icon.png'
    assert icon.read_bytes().startswith(b'\x89PNG\r\n\x1a\n');shutil.copyfile(icon,output/'icon.png')
    payload=catalog_payload(windows,reference);signature=key.sign(payload,padding.PKCS1v15(),hashes.SHA256())
    cert.public_key().verify(signature,payload,padding.PKCS1v15(),hashes.SHA256())
    (output/'updates.txt').write_bytes(b'LKUPDATE1\n'+base64.b64encode(signature)+b'\n'+payload)
    (output/'index.html').write_text(release_page(windows),encoding='utf-8')
    print('Prepared signed Windows release:',windows['name'],windows['sha256'])

if __name__=='__main__':main()
