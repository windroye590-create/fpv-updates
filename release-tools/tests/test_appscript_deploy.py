import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import appscript_deploy as gas


class FakeGoogle:
    def __init__(self, files, settings):
        self.head = copy.deepcopy(files)
        self.versions = {7: copy.deepcopy(files)}
        self.settings = settings
        self.deployment = {'deploymentConfig': {'versionNumber': 7, 'manifestFileName': 'appsscript',
                                                'description': 'User deployment'},
                           'entryPoints': [{'entryPointType': 'WEB_APP', 'webApp': {
                               'url': settings['webAppUrl'], 'entryPointConfig': {
                                   'access': 'ANYONE_ANONYMOUS', 'executeAs': 'USER_DEPLOYING'}}}]}
        self.writes = []
        self.fail_content_after_write = False
        self.change_url_once = False

    def call(self, method, path, data=None):
        if method != 'GET':
            self.writes.append((method, path, copy.deepcopy(data)))
        if '/deployments/' in path:
            if method == 'PUT':
                self.deployment['deploymentConfig'] = copy.deepcopy(data['deploymentConfig'])
                self.deployment['entryPoints'][0]['webApp']['url'] = self.settings['webAppUrl']
                if self.change_url_once:
                    self.deployment['entryPoints'][0]['webApp']['url'] += '/wrong'
                    self.change_url_once = False
            return copy.deepcopy(self.deployment)
        if path.endswith('/versions') and method == 'POST':
            version = max(self.versions) + 1
            self.versions[version] = copy.deepcopy(self.head)
            return {'versionNumber': version}
        if '/content' in path:
            if method == 'PUT':
                self.head = copy.deepcopy(data['files'])
                if self.fail_content_after_write:
                    self.fail_content_after_write = False
                    raise RuntimeError('Connection lost after write')
            version = int(path.split('versionNumber=')[1]) if 'versionNumber=' in path else None
            return {'files': copy.deepcopy(self.head if version is None else self.versions[version])}
        raise AssertionError((method, path))


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.settings = gas.config()
        self.old = ("const SPREADSHEET_ID = '" + self.settings['spreadsheetId'] + "';\n"
                    "const API_VERSION = 26;\nconst LATEST_APP_VERSION_CODE = 150;\n"
                    "const LATEST_APP_VERSION_NAME = '1.2.27';\n"
                    "function doGet() { return {serverBuild: 'previous', ok:true}; }\n"
                    'function route() { return 1; }\n')
        self.files = [{'name': 'Код', 'type': 'SERVER_JS', 'source': self.old},
                      {'name': 'appsscript', 'type': 'JSON', 'source': '{"timeZone":"Europe/Kyiv"}'},
                      {'name': 'ExtraUserFile', 'type': 'SERVER_JS', 'source': 'function userTrigger() {}'}]
        self.client = FakeGoogle(self.files, self.settings)
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.path = Path(self.scratch.name) / 'Code.gs'
        self.path.write_text(self.old.replace('return 1;', 'return 2;'))

    def check(self, settings, build, **kwargs):
        live = self.client.versions[self.client.deployment['deploymentConfig']['versionNumber']]
        self.assertEqual(gas.source_info(gas.server_file(live)['source'], settings)['build'], build)
        return {'status': 'passed', 'serverBuild': build, 'api': 26}

    def plan(self):
        return gas.plan(self.client, self.settings, self.path, self.check)

    def apply(self, receipt, check=None):
        return gas.apply(self.client, self.settings, self.path, receipt, check or self.check)

    def test_update_preserves_localized_filename_other_files_manifest_and_webapp_url(self):
        receipt = self.plan()
        result = self.apply(receipt)
        self.assertTrue(result['deployed'])
        self.assertEqual(result['version'], 8)
        self.assertEqual(self.client.head[1:], self.files[1:])
        self.assertEqual(self.client.head[0]['name'], 'Код')
        self.assertIn('return 2;', self.client.head[0]['source'])
        self.assertEqual(self.client.deployment['entryPoints'][0]['webApp']['url'], self.settings['webAppUrl'])

    def test_ui_only_version_changes_perform_no_server_writes(self):
        self.path.write_text(self.old.replace('150;', '151;').replace("'1.2.27'", "'1.2.28'"))
        receipt = self.plan()
        self.assertFalse(receipt['changed'])
        self.assertFalse(self.apply(receipt)['deployed'])
        self.assertEqual(self.client.writes, [])

    def test_failed_public_health_restores_previous_version_and_complete_source(self):
        receipt = self.plan()
        def check(settings, build, **kwargs):
            if build != 'previous':
                raise RuntimeError('Bad new public response')
            return self.check(settings, build)
        with self.assertRaisesRegex(RuntimeError, 'previous deployment restored'):
            self.apply(receipt, check)
        self.assertEqual(self.client.head, self.files)
        self.assertEqual(self.client.deployment['deploymentConfig']['versionNumber'], 7)

    def test_unpublished_user_edits_block_deployment_before_writes(self):
        self.client.head[-1]['source'] += '\n// unsaved release work'
        with self.assertRaisesRegex(ValueError, 'unpublished edits'):
            self.plan()
        self.assertEqual(self.client.writes, [])

    def test_concurrent_edit_after_plan_blocks_all_writes(self):
        receipt = self.plan()
        self.client.head[-1]['source'] += '\n// a new user edit'
        with self.assertRaisesRegex(ValueError, 'changed after preparation'):
            self.apply(receipt)
        self.assertEqual(self.client.writes, [])

    def test_database_or_api_change_is_rejected(self):
        for target in [self.old.replace(self.settings['spreadsheetId'], 'different-db'),
                       self.old.replace('API_VERSION = 26', 'API_VERSION = 27')]:
            self.path.write_text(target)
            with self.assertRaises(ValueError):
                self.plan()
        self.assertEqual(self.client.writes, [])

    def test_public_url_change_triggers_rollback(self):
        receipt = self.plan()
        self.client.change_url_once = True
        with self.assertRaisesRegex(RuntimeError, 'previous deployment restored'):
            self.apply(receipt)
        self.assertEqual(self.client.deployment['deploymentConfig']['versionNumber'], 7)
        self.assertEqual(self.client.deployment['entryPoints'][0]['webApp']['url'], self.settings['webAppUrl'])

    def test_lost_response_after_content_write_restores_original_files(self):
        receipt = self.plan()
        self.client.fail_content_after_write = True
        with self.assertRaisesRegex(RuntimeError, 'previous deployment restored'):
            self.apply(receipt)
        self.assertEqual(self.client.head, self.files)
        self.assertEqual(self.client.deployment['deploymentConfig']['versionNumber'], 7)

    def test_rollback_never_overwrites_a_concurrent_user_edit(self):
        receipt = self.plan()
        def check(settings, build, **kwargs):
            self.client.head[-1]['source'] = 'User edit after deployment'
            raise RuntimeError('New health failed while a user was editing')
        with self.assertRaisesRegex(RuntimeError, 'rollback needs attention'):
            self.apply(receipt, check)
        self.assertEqual(self.client.head[-1]['source'], 'User edit after deployment')

    def test_local_source_change_after_plan_is_rejected(self):
        receipt = self.plan()
        self.path.write_text(self.path.read_text() + '\nfunction surprise() {}')
        with self.assertRaisesRegex(ValueError, 'source changed'):
            self.apply(receipt)
        self.assertEqual(self.client.writes, [])

    def test_file_order_does_not_create_false_concurrent_edits(self):
        receipt = self.plan()
        self.client.head.reverse()
        self.assertTrue(self.apply(receipt)['deployed'])


class CredentialTests(unittest.TestCase):
    def test_current_clasp_named_account_does_not_include_other_accounts(self):
        selected = {'client_id': 'selected', 'client_secret': 'private', 'refresh_token': 'refresh'}
        raw = json.dumps({'tokens': {'fpv-release': selected, 'other': {'refresh_token': 'other-secret'}}})
        self.assertEqual(gas.credentials(raw), selected)

    def test_legacy_local_credentials_are_accepted(self):
        self.assertEqual(gas.credentials(json.dumps({'token': {'refresh_token': 'r'},
                         'oauth2ClientSettings': {'clientId': 'i', 'clientSecret': 's'}})),
                         {'client_id': 'i', 'client_secret': 's', 'refresh_token': 'r'})

    def test_access_token_without_refresh_token_is_rejected(self):
        with self.assertRaises(ValueError):
            gas.credentials(json.dumps({'client_id': 'i', 'client_secret': 's', 'access_token': 'temporary'}))


if __name__ == '__main__':
    unittest.main()
