"""Validate the packaged Windows image, imports, icons and relocations."""
import struct,pathlib,hashlib,json,re
root=pathlib.Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version']
exe=root/'build'/json.loads((root/'package.json').read_text())['executableName'];b=exe.read_bytes()
assert b[:2]==b'MZ'
pe=struct.unpack_from('<I',b,60)[0];assert b[pe:pe+4]==b'PE\x00\x00'
machine,nsections,ts,symptr,syms,optsize,flags=struct.unpack_from('<HHIIIHH',b,pe+4)
assert ts==0, 'Use deterministic PE timestamps for release builds'
assert machine==0x8664 and flags&2
opt=pe+24;assert struct.unpack_from('<H',b,opt)[0]==0x20b
entry=struct.unpack_from('<I',b,opt+16)[0];base=struct.unpack_from('<Q',b,opt+24)[0]
assert struct.unpack_from('<H',b,opt+68)[0]==2
assert struct.unpack_from('<H',b,opt+70)[0]&0x140==0x140
sections=[]
for i in range(nsections):
    pos=opt+optsize+40*i;name=b[pos:pos+8].split(b'\x00')[0].decode();vsize,rva,rawsize,raw=struct.unpack_from('<IIII',b,pos+8);chars=struct.unpack_from('<I',b,pos+36)[0]
    assert rva%4096==0 and (raw==0 or raw%512==0)
    assert raw+rawsize<=len(b)
    # PE section names occupy eight bytes, so different input sections can
    # have the same truncated name. Keep all their address ranges.
    sections.append((rva,max(vsize,rawsize),raw,rawsize,chars))
assert any(rva<=entry<rva+size and chars&0x20000000 for rva,size,raw,rawsize,chars in sections)
def offset(rva):
    for start,size,raw,rawsize,_ in sections:
        if start<=rva<start+size:
            assert rva-start<rawsize
            return raw+rva-start
    raise AssertionError(hex(rva))
def cstring(rva):
    p=offset(rva);return b[p:b.index(0,p)].decode()
imports_rva,imports_size=struct.unpack_from('<II',b,opt+112+8)
imports={};p=offset(imports_rva)
while any(b[p:p+20]):
    lookup,stamp,forward,name,iat=struct.unpack_from('<IIIII',b,p);dll=cstring(name);items=[];lp=offset(lookup);ip=offset(iat)
    while True:
        address=struct.unpack_from('<Q',b,lp)[0]
        if not address:break
        assert not address>>63
        items.append(cstring(address+2));assert struct.unpack_from('<Q',b,ip)[0]==address
        lp+=8;ip+=8
    imports[dll]=items;p+=20
assert set(imports)=={'KERNEL32.dll','USER32.dll','SHELL32.dll','WINHTTP.dll','WS2_32.dll','CRYPT32.dll','BCRYPT.dll','ADVAPI32.dll'}
assert all(f in imports['SHELL32.dll'] for f in ['SHGetFileInfoW','SHUpdateImageW','SHChangeNotify'])
for dll,functions in {'WINHTTP.dll':['WinHttpSendRequest','WinHttpReceiveResponse'],'CRYPT32.dll':['CryptProtectData','CryptUnprotectData'],'KERNEL32.dll':['GetTickCount64','MoveFileExW','CopyFileW','OpenProcess','QueryFullProcessImageNameW','WaitForSingleObject'],'BCRYPT.dll':['BCryptGenRandom'],'ADVAPI32.dll':['CryptAcquireContextW','CryptCreateHash','CryptImportKey','CryptVerifySignatureW'],'WINHTTP.dll':['WinHttpSendRequest','WinHttpReceiveResponse','WinHttpSetOption']}.items():
    assert all(f in imports[dll] for f in functions)
assert not any('CRT' in dll for dll in imports)
reloc_rva,reloc_size=struct.unpack_from('<II',b,opt+112+5*8)
assert reloc_size>0
relocs=0;p=offset(reloc_rva);end=p+reloc_size
while p<end:
    page,size=struct.unpack_from('<II',b,p);assert size>=8
    for q in range(p+8,p+size,2):
        value=struct.unpack_from('<H',b,q)[0];typ=value>>12
        assert typ in (0,10), ('Unexpected base relocation',typ)
        if typ==10:
            addr=struct.unpack_from('<Q',b,offset(page+(value&4095)))[0]
            assert base<=addr<base+struct.unpack_from('<I',b,opt+56)[0]
            relocs+=1
    p+=size
rsrc_rva,rsrc_size=struct.unpack_from('<II',b,opt+112+2*8);rsrc_offset=offset(rsrc_rva)
assert rsrc_size>0
def entries(relative):
    p=rsrc_offset+relative;named,count=struct.unpack_from('<HH',b,p+12)
    return [struct.unpack_from('<II',b,p+16+8*i) for i in range(named+count)]
root_entries=entries(0);assert {n for n,o in root_entries}=={3,14}
blobs=[];icon_sizes=[]
for typ,branch in root_entries:
    for rid,langs in entries(branch&0x7fffffff):
        for lang,entrypos in entries(langs&0x7fffffff):
            rva,size,cp,reserved=struct.unpack_from('<IIII',b,rsrc_offset+entrypos)
            blob=b[offset(rva):offset(rva)+size];assert len(blob)==size
            if typ==3:
                assert blob.startswith(b'\x89PNG\r\n\x1a\n')
                width,height=struct.unpack_from('>II',blob,16);assert width==height;icon_sizes.append(width)
            blobs.append((typ,rid,lang,size))
assert sum(t==3 for t,*_ in blobs)==6
assert sorted(icon_sizes)==[16,32,48,64,128,256]
for file in (root/'web').rglob('*'):
    if file.is_file() and not any(part.startswith('.') for part in file.relative_to(root/'web').parts):
        assert file.read_bytes() in b, str(file)
stack=(root/'build/native.su').read_text()
max_stack=max(int(line.split('\t')[1]) for line in stack.splitlines())
assert max_stack<4096, 'A native stack frame would need additional probing'
report={'file':exe.name,'sha256':hashlib.sha256(b).hexdigest(),'sizeBytes':len(b),'architecture':'Windows x64 PE32+','subsystem':'GUI','aslr':True,'nx':True,'imports':imports,'baseRelocations':relocs,'iconResources':blobs,'iconSizes':sorted(icon_sizes),'maxNativeStackFrame':max_stack,'assetsEmbedded':True,'windowsRuntimeVerified':False,'productionSyncVerified':False}
(root/'verification').mkdir(exist_ok=True)
(root/'verification/native-image.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('Windows image validated:',len(imports),'system DLLs,',relocs,'ASLR fixups, 6 icon sizes. Max frame:',max_stack)
