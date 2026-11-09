"""Publish an immutable signed UI preview without changing the public update channel."""
import json
import os
from pathlib import Path
import subprocess
import sys

import github_release as release

ROOT = Path(__file__).resolve().parents[1]


def publish(client, bundle, extras, tag, commit, notes):
    previous = release.ensure_newer(client, bundle, ROOT / 'release-tools/update-public.pem')
    candidate = client.find(tag) or client.request('POST', '/releases', {
        'tag_name': tag, 'target_commitish': commit,
        'name': 'Попередній перегляд: результати та перевірка · ' + bundle.version,
        'body': notes, 'draft': True, 'prerelease': True, 'make_latest': 'false',
    })
    release.require(candidate.get('prerelease') is True, 'Preview must remain a prerelease')
    assets = {**bundle.assets, **extras}
    existing = {a['name']: a for a in candidate['assets']}
    release.require(len(existing) == len(candidate['assets']) and set(existing).issubset(assets),
                    'Unexpected preview assets')
    for name, raw in assets.items():
        asset = existing.get(name)
        if asset and client.download(asset) != raw:
            release.require(candidate['draft'], 'Use a new preview run; published bytes are immutable')
            client.delete_asset(asset)
            asset = None
        if not asset:
            release.require(candidate['draft'], 'Published preview is incomplete')
            asset = client.upload(candidate['id'], name, raw)
        release.require(client.download(asset) == raw, 'Preview upload differs: ' + name)
        print('Verified preview asset:', name, release.digest(raw))
    actual = client.release(candidate['id'])
    release.require({a['name'] for a in actual['assets']} == set(assets), 'Preview assets are incomplete')
    if candidate['draft']:
        client.request('PATCH', '/releases/' + str(candidate['id']), {
            'draft': False, 'prerelease': True, 'make_latest': 'false',
        })
    published = client.release(candidate['id'])
    release.require(published['prerelease'] and not published['draft'], 'Preview was not published correctly')
    current = client.latest()
    release.require(current and previous and current['id'] == previous['id'], 'Public update channel changed')
    return published


def main():
    release.require(os.environ.get('GITHUB_REF') == 'refs/heads/preview/results-workspace',
                    'This preview workflow is limited to its review branch')
    directory = Path(sys.argv[1])
    bundle = release.read_bundle(directory, ROOT / 'release-tools/update-public.pem')
    release.require('export const PREVIEW_BUILD=true;' in (ROOT / 'source/web/core.js').read_text(),
                    'The preview must be visibly marked')
    client = release.GitHub(release.REPOSITORY, os.environ['GITHUB_TOKEN'])
    ref = client.request('GET', '/git/ref/heads/preview/results-workspace')
    if ref['object']['sha'] != os.environ['GITHUB_SHA']:
        print('A newer review commit exists; this superseded build will not be published.')
        return
    tag = 'v' + bundle.version + '-preview.' + str(int(os.environ['GITHUB_RUN_NUMBER']))
    archive = Path(os.environ['RUNNER_TEMP']) / ('FPV-Komisiia-PC-' + tag[1:] + '-source.zip')
    subprocess.run(['python3', str(ROOT / 'source/release-tools/package_source.py'), str(archive)], check=True)
    extras = {archive.name: archive.read_bytes()}
    for name in ['results-workspace-all.png', 'results-pending.png', 'results-pending-dark.png',
                 'results-pending-narrow.png', 'results-ranking.png']:
        file = ROOT / 'source/verification' / name
        release.require(file.is_file(), 'Preview screenshot is missing: ' + name)
        extras[name] = file.read_bytes()
    result = publish(client, bundle, extras, tag, os.environ['GITHUB_SHA'],
                     (ROOT / 'docs/RESULTS-PREVIEW-UA.md').read_text())
    report = {'status': 'passed', 'tag': tag, 'url': result['html_url'],
              'version': bundle.version, 'code': bundle.code, 'prerelease': True,
              'publicUpdateChannelUnchanged': True, 'assets': [a['name'] for a in result['assets']]}
    (ROOT / 'source/verification/preview-publication.json').write_text(json.dumps(report, indent=2) + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write('Preview: [' + tag + '](' + result['html_url'] + '). Public update channel unchanged.\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
