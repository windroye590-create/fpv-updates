#!/usr/bin/env python3
"""Build a dependency-free Windows x64 PE using GCC and GNU ld.

Translate ELF relocation addends explicitly; objcopy alone drops ELF section
symbols and is not a safe conversion for this build.
"""
import pathlib,struct,subprocess,json,hashlib,io,mimetypes,re,os
ROOT=pathlib.Path(__file__).resolve().parent
BUILD=ROOT/'build'
CONFIG=json.loads((ROOT/'package.json').read_text())
VERSION=CONFIG['version']
EXE_NAME=CONFIG['executableName']

def elf_to_coff(src,dst):
    b=pathlib.Path(src).read_bytes()
    assert b[:6]==b'\x7fELF\x02\x01'
    eh=struct.unpack_from('<HHIQQQIHHHHHH',b,16)
    assert eh[0]==1 and eh[1]==62
    shoff,shentsize,shnum,shstr=eh[5],eh[10],eh[11],eh[12]
    sections=[struct.unpack_from('<IIQQQQIIQQ',b,shoff+i*shentsize) for i in range(shnum)]
    def data(s): return b[s[4]:s[4]+s[5]]
    names=data(sections[shstr])
    def string(table,at): return table[at:table.index(0,at)].decode()
    selected={}
    cs=[]
    for i,s in enumerate(sections):
        if s[2]&2 and s[1] in (1,8):
            selected[i]=len(cs)+1
            cs.append(dict(name=string(names,s[0]),size=s[5],align=s[8],bss=s[1]==8,flags=s[2],raw=bytearray(data(s) if s[1]!=8 else b''),relocs=[]))
    symindex=next(i for i,s in enumerate(sections) if s[1]==2)
    syms=sections[symindex]; strings=data(sections[syms[6]])
    symbols=[]
    symbolmap={}
    for i in range(syms[5]//syms[9]):
        name,info,other,section,value,size=struct.unpack_from('<IBBHQQ',b,syms[4]+i*syms[9])
        text=string(strings,name) if name else ''
        typ=info&15; binding=info>>4
        if section not in (0,0xfff1) and section not in selected: continue
        if not text and typ==3: text=cs[selected[section]-1]['name']
        if not text: text='elf_null_'+str(i)
        symbolmap[i]=len(symbols)
        symbols.append((text,value,0 if section==0 else -1 if section==0xfff1 else selected[section],32 if typ==2 else 0,2 if binding else 3))
    audit=[]
    for s in sections:
        if s[1]!=4 or s[7] not in selected: continue
        target=cs[selected[s[7]]-1]
        for p in range(s[4],s[4]+s[5],s[9]):
            at,info,addend=struct.unpack_from('<QQq',b,p)
            typ=info&0xffffffff; sym=info>>32
            assert sym in symbolmap
            ct,width,adj={1:(1,8,0),2:(4,4,4),4:(4,4,4),10:(2,4,0),11:(2,4,0)}[typ]
            assert at+width<=len(target['raw'])
            target['raw'][at:at+width]=((addend+adj)&((1<<(width*8))-1)).to_bytes(width,'little')
            target['relocs'].append((at,symbolmap[sym],ct))
            audit.append(dict(section=target['name'],offset=at,target=symbols[symbolmap[sym]][0],addend=addend,type=typ))
    pool=bytearray(b'\x00\x00\x00\x00'); intern={}
    def name8(name,section=False):
        raw=name.encode()
        if len(raw)<=8: return raw.ljust(8,b'\x00')
        if name not in intern:
            intern[name]=len(pool);pool.extend(raw+b'\x00')
        off=intern[name]
        return ('/'+str(off)).encode().ljust(8,b'\x00') if section else struct.pack('<II',0,off)
    payload=bytearray(b'\x00'*(20+40*len(cs)))
    headers=[]
    for s in cs:
        while len(payload)%4:payload.append(0)
        rawpos=0 if s['bss'] else len(payload)
        payload.extend(s['raw'])
        relocpos=len(payload) if s['relocs'] else 0
        for r in s['relocs']:payload.extend(struct.pack('<IIH',*r))
        align=max(1,s['align']); ab=align.bit_length()<<20
        flags=(0x60000020 if s['flags']&4 else 0xc0000080 if s['bss'] else 0xc0000040 if s['flags']&1 else 0x40000040)|ab
        assert len(s['relocs'])<65535
        headers.append(struct.pack('<8sIIIIIIHHI',name8(s['name'],True),0,0,s['size'],rawpos,relocpos,0,len(s['relocs']),0,flags))
    sympos=len(payload)
    for name,val,sec,typ,cl in symbols:payload.extend(struct.pack('<8sIhHBB',name8(name),val,sec,typ,cl,0))
    struct.pack_into('<I',pool,0,len(pool));payload.extend(pool)
    struct.pack_into('<HHIIIHH',payload,0,0x8664,len(cs),0,sympos,len(symbols),0,0)
    for i,h in enumerate(headers):payload[20+i*40:60+i*40]=h
    pathlib.Path(dst).write_bytes(payload)
    return audit

def assets():
    for required in ['vendor/pdfjs/build/pdf.mjs','vendor/pdfjs/build/pdf.worker.mjs']:
        if not (ROOT/'web'/required).is_file():
            raise FileNotFoundError('PDF.js source is incomplete: '+required)
    files={'office':('office-import.js','text/javascript; charset=utf-8'),'word_sample':('test-import-sample.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),'excel_sample':('test-import-sample.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),'statement':('statement.js','text/javascript; charset=utf-8'),'jspdf':('vendor/jspdf.umd.min.js','text/javascript; charset=utf-8'),'font':('statement-font.ttf','font/ttf'),'html':('index.html','text/html; charset=utf-8'),'js':('app.js','text/javascript; charset=utf-8'),'core':('core.js','text/javascript; charset=utf-8'),'css':('style.css','text/css; charset=utf-8'),'icon':('icon.png','image/png')}
    lines=[]
    for key,(name,mime) in files.items():
        raw=(ROOT/'web'/name).read_bytes()
        lines.append(f'static const unsigned char asset_{key}[]={{'+','.join(map(str,raw))+'};')
        lines.append(f'static const unsigned int asset_{key}_size={len(raw)};')
    extras=[]
    # The web directory is the public bundle. Discover its complete contents
    # instead of maintaining a second manual list of JavaScript modules.
    primary={name for name,mime in files.values()}
    for path in sorted((ROOT/'web').rglob('*')):
        relative=path.relative_to(ROOT/'web')
        if not path.is_file() or relative.as_posix() in primary or any(part.startswith('.') for part in relative.parts): continue
        name='/'+path.relative_to(ROOT/'web').as_posix();key='extra_'+str(len(extras));raw=path.read_bytes()
        mime='text/javascript; charset=utf-8' if path.suffix in ['.js','.mjs'] else 'application/wasm' if path.suffix=='.wasm' else mimetypes.guess_type(name)[0] or 'application/octet-stream'
        lines.append(f'static const unsigned char asset_{key}[]={{'+','.join(map(str,raw))+'};')
        extras.append((name,mime,key,len(raw)))
    lines.append('typedef struct {const char*path;const char*mime;const unsigned char*data;unsigned int size;} WebExtra;')
    lines.append('static const WebExtra web_extras[]={'+','.join('{'+json.dumps(n)+','+json.dumps(m)+',asset_'+k+','+str(size)+'}' for n,m,k,size in extras)+'};')
    lines.append('static const unsigned int web_extra_count='+str(len(extras))+';')
    (BUILD/'web_assets.h').write_text('\n'.join(lines))

def icon_resource():
    from PIL import Image
    image=Image.open(ROOT/'web/icon.png').convert('RGBA')
    icons=[]
    for size in [16,32,48,64,128,256]:
        out=io.BytesIO();image.resize((size,size),Image.Resampling.LANCZOS).save(out,format='PNG')
        icons.append((size,out.getvalue()))
    group=bytearray(struct.pack('<HHH',0,1,len(icons)))
    for i,(size,raw) in enumerate(icons,1):group.extend(struct.pack('<BBBBHHIH',size%256,size%256,0,0,1,32,len(raw),i))
    tree={3:{i:{1058:raw} for i,(_,raw) in enumerate(icons,1)},14:{1:{1058:bytes(group)}}}
    data=bytearray();relocations=[]
    def directory(children):
        while len(data)%4:data.append(0)
        at=len(data);data.extend(struct.pack('<IIHHHH',0,0,0,0,0,len(children)));data.extend(b'\x00'*(8*len(children)))
        for n,(rid,value) in enumerate(sorted(children.items())):
            if isinstance(value,dict):offset=0x80000000|directory(value)
            else:
                while len(data)%4:data.append(0)
                offset=len(data);data.extend(b'\x00'*16);blob=len(data);data.extend(value)
                struct.pack_into('<IIII',data,offset,blob,len(value),0,0);relocations.append(offset)
            struct.pack_into('<II',data,at+16+n*8,rid,offset)
        return at
    assert directory(tree)==0
    rawpos=60;relocpos=rawpos+len(data);sympos=relocpos+10*len(relocations)
    header=struct.pack('<HHIIIHH',0x8664,1,0,sympos,1,0,0)
    section=struct.pack('<8sIIIIIIHHI',b'.rsrc\x00\x00\x00',0,0,len(data),rawpos,relocpos,0,len(relocations),0,0x40300040)
    symbols=struct.pack('<8sIhHBB',b'.rsrc\x00\x00\x00',0,1,0,3,0)
    (BUILD/'resources.obj').write_bytes(header+section+data+b''.join(struct.pack('<IIH',off,0,3) for off in relocations)+symbols+struct.pack('<I',4))

def build():
    commission=json.loads((ROOT/'commission.json').read_text())
    if os.environ.get('COMMISSION_ALLOW_UNCONFIGURED_TEST')!='1':
        assert commission['signing']['certificateSha256'] and all(commission['cloud'].values()), 'Complete FPV owner setup before building a release'
        assert commission['cloud']['webAppUrl'] in (ROOT/'web/core.js').read_text(), 'The release endpoint differs from its FPV profile'
    assert "export const APP_VERSION='"+VERSION+"';" in (ROOT/'web/core.js').read_text(), 'Desktop versions disagree'
    protocol=(ROOT/'native/update_protocol.h').read_text()
    assert '#define PC_VERSION_NAME "'+VERSION+'"' in protocol, 'Native version name disagrees'
    assert re.search(r'#define PC_VERSION_CODE '+str(CONFIG['versionCode'])+r'u\b',protocol), 'Native version code disagrees'
    assert EXE_NAME=='FPV-Komisiia-PC.exe', 'Keep the public executable filename stable'
    BUILD.mkdir(exist_ok=True);assets();icon_resource()
    elf=BUILD/'native.elf';obj=BUILD/'native.obj';exe=BUILD/EXE_NAME
    args=['gcc','-c',str(ROOT/'native/main.c'),'-o',str(elf),'-I'+str(BUILD),'-std=c11','-mabi=ms','-mcmodel=large','-fshort-wchar','-ffreestanding','-fno-builtin','-fno-stack-protector','-fno-pie','-fno-pic','-fno-asynchronous-unwind-tables','-fcf-protection=none','-fstack-usage','-mno-red-zone','-Wall','-Wextra','-Werror','-O2']
    subprocess.run(args,check=True)
    audit=elf_to_coff(elf,obj)
    subprocess.run(['ld','-mi386pep','--no-insert-timestamp','--subsystem','windows','--entry','mainCRTStartup','--image-base','0x140000000','--major-subsystem-version','6','--minor-subsystem-version','0','--enable-reloc-section','--dynamicbase','--nxcompat','--disable-auto-import','-o',str(exe),str(obj),str(BUILD/'resources.obj'),str(ROOT/'native/imports.def')],check=True)
    (BUILD/'relocations.json').write_text(json.dumps(audit,indent=2))
    print(str(exe),len(exe.read_bytes()),hashlib.sha256(exe.read_bytes()).hexdigest())

if __name__=='__main__':build()
