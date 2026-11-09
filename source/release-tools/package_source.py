"""Package the complete desktop source, including the vendor's build folder."""
import argparse
import os
from pathlib import Path
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    'web/excel-report.js', 'release-tools/sync_report.py',
    'web/results.js', 'web/exam-session.js', 'web/account-sync.js', 'build_windows.py', 'package.json', 'native/main.c', 'web/app.js', 'web/updater.js', 'web/workspace.js', 'web/durability.js', 'web/learning.js',
    'web/vendor/pdfjs/build/pdf.mjs',
    'web/vendor/pdfjs/build/pdf.worker.mjs',
    'tests/fixtures/materials/three-slides.pdf',
    'tests/fixtures/materials/ukrainian-seven-pages.pdf',
    'Code.gs',
}


def package(destination):
    destination = Path(destination).resolve()
    if destination.is_relative_to(ROOT):
        raise ValueError('Place the archive outside the source directory')
    files = []
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT)
        # Only the project's generated build directory is omitted.
        if relative.parts[0] in {'build','verification'}:
            continue
        if relative.parts[0] == 'verification' and path.suffix.lower() in {'.png', '.jpg', '.webp'}:
            continue
        if any(part in {'node_modules', '__pycache__'} for part in relative.parts):
            continue
        if any(part.startswith('.') and part not in {'.github', '.gitignore', '.gitattributes', '.editorconfig'} for part in relative.parts):
            continue
        if path.suffix.lower() in {'.jks', '.keystore', '.p12', '.pfx', '.key'}:
            continue
        if path.name in {'storepass.txt', 'keypass.txt', 'local.properties'}:
            continue
        files.append((path, relative.as_posix()))
    if not REQUIRED.issubset({name for _, name in files}):
        raise ValueError('Required source or PDF test fixture is missing')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix='.tmp', delete=False) as staged:
        staging = Path(staged.name)
    try:
        with zipfile.ZipFile(staging, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path, name in files:
                archive.write(path, name)
        with zipfile.ZipFile(staging) as archive:
            assert archive.testzip() is None
            assert REQUIRED.issubset(archive.namelist())
            for name in REQUIRED:
                assert archive.read(name) == (ROOT / name).read_bytes()
        with staging.open('rb') as complete:
            os.fsync(complete.fileno())
        os.replace(staging, destination)
    finally:
        staging.unlink(missing_ok=True)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination')
    print(package(parser.parse_args().destination))
