"""Update the existing Apps Script deployment, preserving its other files and URL."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, build_opener

from github_release import SafeRedirect

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def config():
    value = json.loads((ROOT / 'automation.json').read_text())
    require(re.fullmatch(r'[A-Za-z0-9_-]{20,150}', value['scriptId']), 'Invalid Script ID')
    require(re.fullmatch(r'[A-Za-z0-9_-]{20,150}', value['deploymentId']), 'Invalid deployment ID')
    expected = 'https://script.google.com/macros/s/' + value['deploymentId'] + '/exec'
    require(value['webAppUrl'] == expected, 'Deployment URL and ID differ')
    return value


def credentials(raw):
    value = json.loads(raw)
    if 'tokens' in value:
        value = value['tokens'].get('fpv-release') or value['tokens'].get('default')
        require(isinstance(value, dict), 'No fpv-release/default Google credentials')
    elif 'token' in value and 'oauth2ClientSettings' in value:
        settings = value['oauth2ClientSettings']
        value = {**value['token'], 'client_id': settings.get('clientId'),
                 'client_secret': settings.get('clientSecret')}
    fields = ['client_id', 'client_secret', 'refresh_token']
    require(all(isinstance(value.get(k), str) and value[k] for k in fields),
            'GAS_CREDENTIALS needs client_id, client_secret and refresh_token')
    return {k: value[k] for k in fields}


def read_json(request):
    try:
        with build_opener(SafeRedirect()).open(request, timeout=30) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
    except HTTPError as error:
        # Do not print an OAuth response, credentials or request headers.
        raise RuntimeError('Google request failed: HTTP ' + str(error.code)) from None
    require(len(raw) <= 8 * 1024 * 1024, 'Google response too large')
    return json.loads(raw)


class Google:
    def __init__(self, raw):
        data = {**credentials(raw), 'grant_type': 'refresh_token'}
        token = read_json(Request('https://oauth2.googleapis.com/token',
                                 data=urlencode(data).encode(), method='POST'))
        require(isinstance(token.get('access_token'), str), 'Google returned no access token')
        self.token = token['access_token']
        expected=config().get('ownerEmail')
        if expected:
            identity=read_json(Request('https://www.googleapis.com/oauth2/v2/userinfo',headers={'Authorization':'Bearer '+self.token}))
            require(identity.get('verified_email') is True and str(identity.get('email','')).casefold()==expected.casefold(),'Authorize the configured FPV Google owner account')

    def call(self, method, path, data=None):
        require(path.startswith('/v1/projects/'), 'Unexpected Apps Script API path')
        request = Request('https://script.googleapis.com' + path,
                          data=None if data is None else json.dumps(data).encode(),
                          method=method, headers={'Authorization': 'Bearer ' + self.token,
                                                  'Content-Type': 'application/json'})
        return read_json(request)


def content_files(content):
    files = [{k: f[k] for k in ['name', 'type', 'source']} for f in content['files']]
    require(len({f['name'] for f in files}) == len(files), 'Duplicate Apps Script filenames')
    require(any(f['name'] == 'appsscript' and f['type'] == 'JSON' for f in files),
            'Existing Apps Script manifest is missing')
    return files


def content_hash(files):
    raw = json.dumps(sorted(files, key=lambda f: json.dumps(f, sort_keys=True)), sort_keys=True,
                     ensure_ascii=False, separators=(',', ':')).encode()
    return hashlib.sha256(raw).hexdigest()


def semantic_hash(source):
    # UI-only releases need no server deployment just to advertise a new EXE number.
    source = re.sub(r"^const LATEST_APP_VERSION_(?:CODE|NAME) = [^\n]+;\s*$", '', source,
                    flags=re.M)
    source = re.sub(r"serverBuild:\s*'[^']+'", "serverBuild: 'BUILD'", source)
    return hashlib.sha256(source.replace('\r\n', '\n').strip().encode()).hexdigest()


def source_info(source, settings):
    def one(pattern):
        found = re.findall(pattern, source)
        require(len(found) == 1, 'Missing or duplicate server identity field')
        return found[0]
    require(one(r"const SPREADSHEET_ID = '([^']+)';") == settings['spreadsheetId'],
            'Refusing to change the commission database')
    api = int(one(r'const API_VERSION = (\d+);'))
    require(api == settings['apiVersion'], 'API migration requires an explicit compatibility update')
    build = one(r"serverBuild:\s*'([^']+)'")
    require(re.fullmatch(r'[A-Za-z0-9._-]{1,100}', build), 'Invalid server build identifier')
    return {'api': api, 'build': build, 'sha256': semantic_hash(source)}


def server_file(files):
    candidates = [f for f in files if f['type'] == 'SERVER_JS'
                  and re.search(r'\bfunction doGet\s*\(', f['source'])
                  and 'const API_VERSION = ' in f['source']]
    require(len(candidates) == 1, 'Cannot uniquely identify the commission server file')
    return candidates[0]


def deployment_config(deployment, version):
    old = deployment['deploymentConfig']
    return {'versionNumber': version, 'manifestFileName': old.get('manifestFileName', 'appsscript'),
            'description': old.get('description', 'FPV Комісія')}


def health(settings, build, attempts=1, pause=time.sleep):
    last = 'No response'
    for attempt in range(attempts):
        try:
            url = settings['webAppUrl'] + '?release_check=' + str(time.time_ns())
            reply = read_json(Request(url, headers={'Cache-Control': 'no-cache'}))
            require(reply.get('ok') is True and reply.get('status') == 'online', 'Server is not online')
            require(reply.get('version') == settings['apiVersion'], 'Public API version differs')
            require(reply.get('serverBuild') == build, 'Public server build differs')
            require(all(reply.get(key) is True for key in settings['requiredCapabilities']),
                    'Required server capability is missing')
            return {'status': 'passed', 'api': reply['version'], 'serverBuild': build}
        except (ValueError, RuntimeError, OSError) as error:
            last = str(error)
            if attempt + 1 < attempts:
                pause(2)
    raise RuntimeError('Server health check failed: ' + last)


def inspect(client, settings):
    base = '/v1/projects/' + settings['scriptId']
    deployment = client.call('GET', base + '/deployments/' + settings['deploymentId'])
    version = deployment['deploymentConfig']['versionNumber']
    require(isinstance(version, int) and version > 0, 'Use an existing versioned deployment')
    head = content_files(client.call('GET', base + '/content'))
    deployed = content_files(client.call('GET', base + '/content?versionNumber=' + str(version)))
    info = source_info(server_file(deployed)['source'], settings)
    return base, deployment, version, head, deployed, info


def plan(client, settings, path, check=health):
    _, deployment, version, head, deployed, live = inspect(client, settings)
    local = path.read_text(encoding='utf-8')
    target = source_info(local, settings)
    changed = target['sha256'] != live['sha256']
    require(not changed or content_hash(head) == content_hash(deployed),
            'Apps Script contains unpublished edits; publish or save them before automatic release')
    build = 'pc-api' + str(target['api']) + '-' + target['sha256'][:16] if changed else live['build']
    local = re.sub(r"serverBuild:\s*'[^']+'", "serverBuild: '" + build + "'", local)
    path.write_text(local, encoding='utf-8')
    check(settings, live['build'])
    return {'changed': changed, 'previousVersion': version, 'previousBuild': live['build'],
            'targetBuild': build, 'headSHA256': content_hash(head),
            'serverSHA256': target['sha256'], 'sourceSHA256': hashlib.sha256(local.encode()).hexdigest(),
            'entryPointsSHA256': content_hash(deployment.get('entryPoints', []))}


def apply(client, settings, path, receipt, check=health):
    base, previous, version, head, deployed, live = inspect(client, settings)
    require(version == receipt['previousVersion'] and content_hash(head) == receipt['headSHA256'],
            'Apps Script changed after preparation; rerun the release')
    local = path.read_text(encoding='utf-8')
    require(hashlib.sha256(local.encode()).hexdigest() == receipt['sourceSHA256'],
            'Prepared server source changed after inspection')
    if not receipt['changed']:
        require(semantic_hash(local) == live['sha256'], 'Server code differs from verified plan')
        return {**check(settings, live['build'], attempts=15), 'deployed': False, 'version': version}
    require(content_hash(head) == content_hash(deployed), 'Unpublished server edits appeared')
    files = copy.deepcopy(head)
    server_file(files)['source'] = local
    new_version = None
    content_attempted = False
    deployment_attempted = False
    try:
        content_attempted = True
        client.call('PUT', base + '/content', {'files': files})
        require(content_hash(content_files(client.call('GET', base + '/content'))) == content_hash(files),
                'Uploaded Apps Script content differs')
        new_version = client.call('POST', base + '/versions',
                                  {'description': 'Automatic release ' + receipt['targetBuild']})['versionNumber']
        deployment_attempted = True
        updated = client.call('PUT', base + '/deployments/' + settings['deploymentId'],
                              {'deploymentConfig': deployment_config(previous, new_version)})
        require(content_hash(updated.get('entryPoints', [])) == receipt['entryPointsSHA256'],
                'Deployment URL or access settings changed')
        result = check(settings, receipt['targetBuild'], attempts=20)
        return {**result, 'deployed': True, 'version': new_version, 'previousVersion': version}
    except Exception as error:
        try:
            if deployment_attempted:
                current = client.call('GET', base + '/deployments/' + settings['deploymentId'])
                require(current['deploymentConfig']['versionNumber'] in {version, new_version},
                        'Another user changed the deployment; automatic rollback stopped')
                client.call('PUT', base + '/deployments/' + settings['deploymentId'],
                            {'deploymentConfig': deployment_config(previous, version)})
            if content_attempted:
                current = content_files(client.call('GET', base + '/content'))
                require(content_hash(current) in {content_hash(head), content_hash(files)},
                        'Another user changed the source; automatic rollback stopped')
                if content_hash(current) != content_hash(head):
                    client.call('PUT', base + '/content', {'files': head})
            check(settings, live['build'], attempts=15)
        except Exception as rollback_error:
            raise RuntimeError('Server release failed; rollback needs attention: ' + str(rollback_error)) from None
        raise RuntimeError('Server release failed; previous deployment restored: ' + str(error)) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['plan', 'apply', 'check'])
    parser.add_argument('--source', default=str(ROOT / 'source/Code.gs'))
    parser.add_argument('--receipt', required=True)
    args = parser.parse_args()
    settings = config()
    client = Google(os.environ.get('GAS_CREDENTIALS', ''))
    path, receipt_path = Path(args.source), Path(args.receipt)
    if args.operation in {'plan', 'check'}:
        if args.operation == 'check':
            _, _, version, _, _, info = inspect(client, settings)
            result = {**health(settings, info['build']), 'deploymentVersion': version}
        else:
            result = plan(client, settings, path)
    else:
        result = apply(client, settings, path, json.loads(receipt_path.read_text()))
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
