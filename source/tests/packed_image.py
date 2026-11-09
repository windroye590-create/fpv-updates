"""Read the actual PE asset symbols and native WebExtra routing table."""
import argparse
import hashlib
import json
from pathlib import Path
import struct


PRIMARY = {
    '/': ('html', 'index.html', 'text/html; charset=utf-8'),
    '/app.js': ('js', 'app.js', 'text/javascript; charset=utf-8'),
    '/core.js': ('core', 'core.js', 'text/javascript; charset=utf-8'),
    '/style.css': ('css', 'style.css', 'text/css; charset=utf-8'),
    '/icon.png': ('icon', 'icon.png', 'image/png'),
    '/office-import.js': ('office', 'office-import.js', 'text/javascript; charset=utf-8'),
    '/statement.js': ('statement', 'statement.js', 'text/javascript; charset=utf-8'),
    '/statement-font.ttf': ('font', 'statement-font.ttf', 'font/ttf'),
    '/vendor/jspdf.umd.min.js': ('jspdf', 'vendor/jspdf.umd.min.js', 'text/javascript; charset=utf-8'),
    '/test-import-sample.docx': ('word_sample', 'test-import-sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    '/test-import-sample.xlsx': ('excel_sample', 'test-import-sample.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
}


def extract(executable, source, metadata=None):
    b = Path(executable).read_bytes()
    pe = struct.unpack_from('<I', b, 60)[0]
    assert b[:2] == b'MZ' and b[pe:pe + 4] == b'PE\0\0'
    machine, count, _, symbols_at, symbol_count, optional_size, _ = struct.unpack_from('<HHIIIHH', b, pe + 4)
    assert machine == 0x8664
    optional = pe + 24
    base = struct.unpack_from('<Q', b, optional + 24)[0]
    sections = []
    for i in range(count):
        pos = optional + optional_size + 40 * i
        virtual_size, rva, raw_size, raw_at = struct.unpack_from('<IIII', b, pos + 8)
        sections.append((rva, max(virtual_size, raw_size), raw_at, raw_size))

    def offset(address, size=1):
        rva = address - base
        for start, length, raw, available in sections:
            if start <= rva and rva + size <= start + available:
                return raw + rva - start
        raise ValueError('Address outside initialized PE sections')

    def read(address, size):
        at = offset(address, size)
        return b[at:at + size]

    def string(address):
        at = offset(address)
        end = b.index(0, at, at + 4096)
        return b[at:end].decode('utf-8')

    strings = symbols_at + symbol_count * 18
    symbols = {}
    i = 0
    while i < symbol_count:
        at = symbols_at + i * 18
        raw = b[at:at + 8]
        if raw[:4] == b'\0\0\0\0':
            start = strings + struct.unpack_from('<I', raw, 4)[0]
            name = b[start:b.index(0, start)].decode()
        else:
            name = raw.split(b'\0')[0].decode()
        value, section, _, _, auxiliary = struct.unpack_from('<IhHBB', b, at + 8)
        if 0 < section <= len(sections):
            symbols[name] = base + sections[section - 1][0] + value
        i += 1 + auxiliary

    assets = {}
    web = Path(source) / 'web'
    for route, (symbol, filename, mime) in PRIMARY.items():
        expected = None if metadata else (web / filename).read_bytes()
        size = metadata[filename]['size'] if metadata else len(expected)
        raw = read(symbols['asset_' + symbol], size)
        if metadata:
            assert hashlib.sha256(raw).hexdigest() == metadata[filename]['sha256'], 'Primary asset digest differs: ' + filename
        else:
            assert raw == expected, 'Primary asset differs from matching source: ' + filename
        assets[route] = (mime, raw)
    table = symbols['web_extras']
    for i in range(4096):
        try:
            name, mime, data, size = struct.unpack('<QQQI4x', read(table + i * 32, 32))
            route, mime = string(name), string(mime)
            if not route.startswith('/') or '\n' in route or '/' not in mime:
                break
        except (ValueError, UnicodeError, struct.error):
            break
        assert route not in assets and '..' not in Path(route).parts
        assert 0 < size < 64 * 1024 * 1024
        assets[route] = (mime, read(data, size))
    assert len(assets) > len(PRIMARY), 'Native extra asset table was not found'
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--metadata', type=Path)
    args = parser.parse_args()
    metadata = json.loads(args.metadata.read_text()) if args.metadata else None
    assets = extract(args.executable, args.root, metadata)
    missing = []
    files = sorted(metadata) if metadata else [file.relative_to(args.root / 'web').as_posix() for file in sorted((args.root / 'web').rglob('*')) if file.is_file() and not any(p.startswith('.') for p in file.relative_to(args.root / 'web').parts)]
    for relative in files:
        route = '/' if relative == 'index.html' else '/' + relative
        if route not in assets:
            missing.append(route)
        elif args.check:
            mime, raw = assets[route]
            if metadata:
                assert len(raw) == metadata[relative]['size'] and hashlib.sha256(raw).hexdigest() == metadata[relative]['sha256'], 'Embedded asset digest differs: ' + route
            else:
                assert raw == (args.root / 'web' / relative).read_bytes(), 'Embedded bytes differ: ' + route
            if Path(relative).suffix in {'.js', '.mjs'}:
                assert mime.startswith('text/javascript'), 'Wrong module MIME: ' + route
    if args.check:
        assert not missing, 'Missing native routes: ' + ', '.join(missing)
    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
        manifest = {}
        for route, (mime, raw) in assets.items():
            name = 'index.html' if route == '/' else route.lstrip('/')
            target = args.output / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            manifest[route] = {'file': name, 'mime': mime, 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'assetCount': len(assets), 'missing': missing, 'complete': not missing}))


if __name__ == '__main__':
    main()
