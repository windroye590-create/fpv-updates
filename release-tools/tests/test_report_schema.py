import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import verify_report_schema as schema

class ReportMigrationTests(unittest.TestCase):
    settings={'webAppUrl':'https://example.invalid/exec','apiVersion':26}
    build='pc-api26-0123456789abcdef'

    def ready(self,value=False,**extra):
        return {'ok':True,'serverBuild':self.build,'formattedReports':True,'intakeArchives':True,'formattedResultsReady':value,**extra}

    def test_ready_layout_does_not_trigger_another_write(self):
        calls=[]
        def read(request):calls.append(request);return self.ready(True)
        self.assertEqual(schema.verify(self.settings,self.build,read=read,pause=lambda _:None)['status'],'passed')
        self.assertEqual(len(calls),1);self.assertIsNone(calls[0].data)

    def test_the_apply_health_receipt_uses_server_build_after_replacing_the_plan(self):
        receipt={'status':'passed','api':26,'serverBuild':self.build,'deployed':True,'version':38,'previousVersion':37}
        responses=[self.ready(),{'ok':True,'groups':[]},self.ready(True)]
        result=schema.verify_deployment(self.settings,receipt,read=lambda _:responses.pop(0),pause=lambda _:None)
        self.assertEqual(result['serverBuild'],receipt['serverBuild'])
        self.assertEqual(result['status'],'passed')

    def test_an_unapplied_plan_cannot_start_the_migration(self):
        with self.assertRaisesRegex(ValueError,'has not passed'):
            schema.verify_deployment(self.settings,{'targetBuild':self.build,'changed':True},read=lambda _:self.fail('Unexpected request'))

    def test_an_incompatible_or_incomplete_receipt_cannot_start_the_migration(self):
        for receipt in [{'status':'passed','api':27,'serverBuild':self.build},{'status':'passed','api':26}]:
            with self.assertRaises(ValueError):schema.verify_deployment(self.settings,receipt,read=lambda _:self.fail('Unexpected request'))

    def test_initializer_is_the_normal_groups_request_and_never_starts_cleanup(self):
        responses=[self.ready(),{'ok':True,'groups':[]},self.ready(True)];calls=[]
        def read(request):calls.append(request);return responses.pop(0)
        schema.verify(self.settings,self.build,read=read,pause=lambda _:None)
        request=json.loads(calls[1].data)
        self.assertEqual((request['method'],request['path']),('GET','/api/groups'))
        self.assertEqual(request['body'],{'initializeReports':True})

    def test_busy_script_lock_is_retried(self):
        responses=[self.ready(),{'ok':False,'code':'BUSY'},self.ready(),{'ok':True,'groups':[]},self.ready(True)]
        self.assertEqual(schema.verify(self.settings,self.build,read=lambda _:responses.pop(0),pause=lambda _:None)['status'],'passed')

    def test_an_older_server_cannot_be_migrated_or_published(self):
        calls=[]
        def read(request):calls.append(request);return self.ready(formattedReports=False)
        with self.assertRaisesRegex(ValueError,'lacks Excel'):schema.verify(self.settings,self.build,read=read)
        self.assertEqual(len(calls),1)

    def test_server_change_during_migration_is_rejected(self):
        responses=[self.ready(),{'ok':True,'groups':[]},self.ready(True,serverBuild='changed')]
        with self.assertRaisesRegex(ValueError,'Server changed'):schema.verify(self.settings,self.build,read=lambda _:responses.pop(0))

    def test_a_failed_migration_remains_retryable_without_reverting_column_writers(self):
        def read(request):return {'ok':True,'groups':[]} if request.data else self.ready()
        with self.assertRaisesRegex(RuntimeError,'retains the migration backup'):schema.verify(self.settings,self.build,read=read,pause=lambda _:None,attempts=2)

if __name__=='__main__':unittest.main()
