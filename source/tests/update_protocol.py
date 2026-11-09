"""Exercise the actual native parser and RSA verifier with signed adversarial vectors."""
import base64,ctypes,json,pathlib,subprocess,tempfile,sys,re,struct,hashlib
root=pathlib.Path(__file__).resolve().parents[1]
fixtures=json.loads((root/'tests/fixtures/update-fixtures.json').read_text())
with tempfile.TemporaryDirectory(prefix='lk-update-tests-') as temp:
    temp=pathlib.Path(temp)
    source='''
#include <stdint.h>
#include <string.h>
#include <openssl/pem.h>
#include <openssl/evp.h>
typedef unsigned char BYTE;typedef unsigned int DWORD,UINT;typedef unsigned long long SIZE_T;
static SIZE_T slen(const char*s){return strlen(s);}
static int same(const char*a,const char*b){return strcmp(a,b)==0;}
static char*append(char*p,const char*s){while(*s)*p++=*s++;*p=0;return p;}
#include "update_protocol.h"
static int update_verify_signature(const BYTE*d,DWORD n,const BYTE*s,DWORD sn){
 const char*pem=TEST_PEM;BIO*b=BIO_new_mem_buf(pem,-1);EVP_PKEY*k=PEM_read_bio_PUBKEY(b,0,0,0);EVP_MD_CTX*c=EVP_MD_CTX_new();
 int ok=k&&c&&EVP_DigestVerifyInit(c,0,EVP_sha256(),0,k)==1&&EVP_DigestVerifyUpdate(c,d,n)==1&&EVP_DigestVerifyFinal(c,s,sn)==1;
 EVP_MD_CTX_free(c);EVP_PKEY_free(k);BIO_free(b);return ok;
}
int check_manifest(const BYTE*d,DWORD n){UPDATE_RELEASE r;return update_parse(d,n,&r);}
'''.replace('TEST_PEM',json.dumps(fixtures['pem']))
    cfile=temp/'test.c';cfile.write_text(source);lib=temp/'test.so'
    subprocess.run(['gcc','-shared','-fPIC','-Wall','-Wextra','-Werror','-O2','-I'+str(root/'native'),str(cfile),'-o',str(lib),'-lcrypto'],check=True)
    native=ctypes.CDLL(str(lib));native.check_manifest.argtypes=[ctypes.c_char_p,ctypes.c_uint];native.check_manifest.restype=ctypes.c_int
    checks=[]
    for fixture in fixtures['fixtures']:
        data=base64.b64decode(fixture['wire']);actual=bool(native.check_manifest(data,len(data)))
        assert actual==fixture['valid'],fixture['name'];checks.append(fixture['name'])
    for size in [0,1,9,10,100,522,523,16385,65536]:
        data=b'A'*size;assert not native.check_manifest(data,len(data));checks.append('length '+str(size))
    report={'passed':len(checks),'checks':checks,'parser':'actual native/update_protocol.h','rsa':'OpenSSL SHA256withRSA on Linux','windowsCryptoAPIRuntimeVerified':False}
    if len(sys.argv)>1:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        channel=pathlib.Path(sys.argv[1])
        header=(root/'native/update_key.h').read_text()
        blob=bytes(map(int,re.search(r'\{([0-9,]+)\}',header).group(1).split(',')))
        magic,bits,exponent=struct.unpack_from('<III',blob,8);assert magic==0x31415352 and bits==3072
        public=rsa.RSAPublicNumbers(exponent,int.from_bytes(blob[20:],'little')).public_key()
        pem=public.public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        cfile.write_text(source.replace(json.dumps(fixtures['pem']),json.dumps(pem)))
        production=temp/'production.so'
        subprocess.run(['gcc','-shared','-fPIC','-Wall','-Wextra','-Werror','-O2','-I'+str(root/'native'),str(cfile),'-o',str(production),'-lcrypto'],check=True)
        verifier=ctypes.CDLL(str(production));verifier.check_manifest.argtypes=[ctypes.c_char_p,ctypes.c_uint]
        wire=(channel/'updates.txt').read_bytes();assert verifier.check_manifest(wire,len(wire))
        broken=wire[:-1]+b'X';assert not verifier.check_manifest(broken,len(broken))
        fields=dict(line.split('=',1) for line in wire.split(b'\n',2)[2].decode().splitlines())
        assert len(sys.argv)==2, 'Use CHANNEL'
        binaries=[]
        for platform in ['android','windows']:
            if platform=='android':
                reference=json.loads((root/'release-tools/catalog-reference.json').read_text())
                assert all(str(reference[k])==fields['android.'+k] for k in ['code','name','file','size','sha256'])
                report['catalogReferenceVerified']=True
                continue
            artifact=channel/fields[platform+'.file'];assert artifact.stat().st_size==int(fields[platform+'.size'])
            assert hashlib.sha256(artifact.read_bytes()).hexdigest()==fields[platform+'.sha256']
            binaries.append(platform)
        report['binaryArtifactsVerified']=binaries
        report['signedReleaseBundleVerified']=True
        report['signedReleaseBundleChecks']=4
        report['networkDownloadVerified']=False
    (root/'verification/update-protocol.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Signed native update protocol:',len(checks),'checks passed')
