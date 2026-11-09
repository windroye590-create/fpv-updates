"""Prepare, sign and record a reproducible Windows/Apps Script release."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import appscript_deploy as gas
import github_release as github

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'source'
SECRETS = ['GAS_CREDENTIALS', 'LK_SIGNING_PKCS12_BASE64', 'LK_SIGNING_PASSWORD']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def secret_check():
    missing = [name for name in SECRETS if not os.environ.get(name)]
    require(not missing, 'Configure GitHub Actions secrets: ' + ', '.join(missing))
    gas.credentials(os.environ['GAS_CREDENTIALS'])
    load_key()
    print('Google credential format and original signing certificate verified.')


def load_key():
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.serialization import pkcs12
    data = base64.b64decode(os.environ['LK_SIGNING_PKCS12_BASE64'].strip(), validate=True)
    require(0 < len(data) < 256 * 1024, 'Invalid signing container size')
    password = os.environ['LK_SIGNING_PASSWORD'].strip().encode()
    key, certificate, _ = pkcs12.load_key_and_certificates(data, password)
    require(key is not None and key.key_size == 3072, 'Use the original RSA-3072 signing key')
    require(certificate.fingerprint(hashes.SHA256()).hex() ==
            json.loads((Path(__file__).resolve().parents[1]/'commission.json').read_text())['signing']['certificateSha256'],
            'Signing certificate differs from the installed application')
    return data, password


def version_tuple(value):
    require(bool(re.fullmatch(r'\d+\.\d+\.\d+', value)) and len(value) <= 31, 'Use version X.Y.Z')
    return tuple(map(int, value.split('.')))


def rewrite(path, pattern, replacement):
    old = path.read_text(encoding='utf-8')
    new, count = re.subn(pattern, lambda _: replacement, old, flags=re.M)
    require(count == 1, 'Expected one version declaration in ' + str(path))
    path.write_text(new, encoding='utf-8')


def prepare(version, current_code, current_name):
    require(version_tuple(version) > version_tuple(current_name), 'New version must exceed the published version')
    path = SOURCE / 'package.json'
    package = json.loads(path.read_text())
    require(version_tuple(version) >= version_tuple(package['version']), 'Source already targets a newer version')
    code = max(current_code + 1, package['versionCode'] if version == package['version'] else package['versionCode'] + 1)
    require(code <= 10000000, 'Version code exceeds the installed parser limit')
    package.update(version=version, versionCode=code)
    path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    rewrite(SOURCE / 'web/core.js', r"^export const APP_VERSION='[^']+';", "export const APP_VERSION='" + version + "';")
    core = SOURCE / 'web/core.js'
    core.write_text(re.sub(r'^export const PREVIEW_BUILD=(?:true|false);',
                          'export const PREVIEW_BUILD=false;', core.read_text(), flags=re.M), encoding='utf-8')
    rewrite(SOURCE / 'native/update_protocol.h', r'^#define PC_VERSION_CODE \d+u', '#define PC_VERSION_CODE ' + str(code) + 'u')
    rewrite(SOURCE / 'native/update_protocol.h', r'^#define PC_VERSION_NAME "[^"]+"', '#define PC_VERSION_NAME "' + version + '"')
    rewrite(SOURCE / 'Code.gs', r'^const LATEST_APP_VERSION_CODE = \d+;', 'const LATEST_APP_VERSION_CODE = ' + str(code) + ';')
    rewrite(SOURCE / 'Code.gs', r"^const LATEST_APP_VERSION_NAME = '[^']+';", "const LATEST_APP_VERSION_NAME = '" + version + "';")
    gas.source_info((SOURCE / 'Code.gs').read_text(), gas.config())
    return package


def published_version():
    client = github.GitHub(github.REPOSITORY, os.environ.get('GITHUB_TOKEN'))
    latest = client.latest()
    if latest is None:return 0,'0.0.0'
    require(not latest['draft'], 'No public release to compare')
    assets = [a for a in latest['assets'] if a['name'] == 'updates.txt']
    require(len(assets) == 1, 'Published release has no unique catalog')
    fields = github.verify_catalog(client.download(assets[0]), ROOT / 'release-tools/update-public.pem')
    code = int(fields['windows.code'])
    # A stable build must also update PCs that tried a signed preview.
    for release in client.request('GET', '/releases?per_page=100'):
        if release.get('draft') or not release.get('prerelease'):
            continue
        catalogs = [a for a in release['assets'] if a['name'] == 'updates.txt']
        if len(catalogs) != 1:
            continue
        raw = client.download(catalogs[0])
        try:
            preview = github.verify_catalog(raw, ROOT / 'release-tools/update-public.pem')
        except ValueError:
            continue
        code = max(code, int(preview['windows.code']))
    return code, fields['windows.name']


def sign(output):
    data, password = load_key()
    package = json.loads((SOURCE / 'package.json').read_text())
    with tempfile.TemporaryDirectory(prefix='lk-sign-', dir=os.environ.get('RUNNER_TEMP')) as scratch:
        private = Path(scratch) / 'key.p12'
        password_file = Path(scratch) / 'password.txt'
        private.write_bytes(data)
        password_file.write_bytes(password)
        private.chmod(0o600)
        password_file.chmod(0o600)
        subprocess.run(['python3', str(SOURCE / 'release-tools/publish_updates.py'),
                        '--windows-exe', str(SOURCE / 'build/FPV-Komisiia-PC.exe'),
                        '--windows-code', str(package['versionCode']), '--windows-name', package['version'],
                        '--pkcs12', str(private), '--password-file', str(password_file),
                        '--output', str(output), '--icon', str(SOURCE / 'web/icon.png')], check=True)
    return github.read_bundle(output, ROOT / 'release-tools/update-public.pem')


def snapshot(bundle_dir, receipt, dry_run=False):
    bundle = github.read_bundle(bundle_dir, ROOT / 'release-tools/update-public.pem')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'Release snapshots require main')
    require(os.environ.get('GITHUB_REPOSITORY') == github.REPOSITORY, 'Unexpected release repository')
    plan = json.loads(receipt.read_text())
    stage = ROOT / 'release-staging' / bundle.tag
    stage.mkdir(parents=True, exist_ok=True)
    archive = stage / ('FPV-Komisiia-PC-' + bundle.version + '-source.zip')
    subprocess.run(['python3', str(SOURCE / 'release-tools/package_source.py'), str(archive)], check=True)
    for name in github.FILES:
        shutil.copyfile(Path(bundle_dir) / name, ROOT / 'channel' / name)
    notes = (ROOT / 'next-release-notes.md').read_text().strip()
    require(notes and 'Напишіть зміни' not in notes, 'Describe this release in next-release-notes.md first')
    notes = '# FPV Комісія ' + bundle.version + ' / ' + str(bundle.code) + '\n\n' + notes + '\n\n'
    notes += '[Вихідний код](https://github.com/' + github.REPOSITORY + '/blob/main/release-staging/' + bundle.tag + '/' + archive.name + ')\n'
    (ROOT / 'release-notes.md').write_text(notes)
    report = {'version': bundle.version, 'code': bundle.code, 'sourceZipSHA256': github.digest(archive.read_bytes()),
              'exeSHA256': github.digest(bundle.assets[github.FILES[0]]), 'serverWillChange': plan['changed'],
              'targetServerBuild': plan['targetBuild'], 'initialCommit': os.environ.get('GITHUB_SHA')}
    (stage / 'candidate.json').write_text(json.dumps(report, indent=2) + '\n')
    paths = ['source/package.json', 'source/web/core.js', 'source/native/update_protocol.h', 'source/Code.gs',
             'channel', 'release-notes.md', 'release-staging/' + bundle.tag]
    if dry_run:
        return paths
    token = os.environ['GITHUB_TOKEN']
    env = {**os.environ, 'GIT_CONFIG_COUNT': '1',
           'GIT_CONFIG_KEY_0': 'http.https://github.com/.extraheader',
           'GIT_CONFIG_VALUE_0': 'AUTHORIZATION: basic ' + base64.b64encode(('x-access-token:' + token).encode()).decode()}
    def git(*args, authenticated=False):
        return subprocess.check_output(['git', *args], cwd=ROOT,
                                       env=env if authenticated else os.environ, text=True).strip()
    git('fetch', 'origin', 'main', authenticated=True)
    require(git('rev-parse', 'origin/main') == os.environ['GITHUB_SHA'],
            'main changed while testing; rerun before deploying the server')
    git('add', '--', *paths)
    git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'Prepare verified release ' + bundle.tag + '/' + str(bundle.code))
    commit = git('rev-parse', 'HEAD')
    git('push', 'origin', 'HEAD:main', authenticated=True)
    return commit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['check-secrets', 'prepare', 'sign', 'snapshot', 'check-newer'])
    parser.add_argument('--version')
    parser.add_argument('--bundle')
    parser.add_argument('--receipt')
    args = parser.parse_args()
    if args.operation == 'check-secrets':
        secret_check()
    elif args.operation == 'prepare':
        code, name = published_version()
        package = prepare(args.version or '', code, name)
        print('Prepared', package['version'], '/', package['versionCode'])
    elif args.operation == 'sign':
        sign(Path(args.bundle))
    elif args.operation == 'check-newer':
        bundle = github.read_bundle(args.bundle, ROOT / 'release-tools/update-public.pem')
        github.ensure_newer(github.GitHub(github.REPOSITORY, os.environ['GITHUB_TOKEN']),
                            bundle, ROOT / 'release-tools/update-public.pem')
    else:
        commit = snapshot(args.bundle, Path(args.receipt))
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('commit=' + commit + '\n')
        print('Recorded release source commit:', commit)


if __name__ == '__main__':
    main()
