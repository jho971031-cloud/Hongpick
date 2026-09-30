"""Checks the architectural guarantees, without hitting external providers."""
import json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import cache, build_static, server

class ArchitectureTests(unittest.TestCase):
    def test_public_export_is_offline_and_excludes_server_files(self):
        with tempfile.TemporaryDirectory() as folder, patch('requests.Session.request',side_effect=AssertionError('Offline export made a network request')):
            manifest=build_static.build(folder)
            root=Path(folder)
            self.assertFalse(any(root.glob('*.py')))
            self.assertFalse((root/'.env').exists())
            for name in manifest['resources'].values():self.assertTrue((root/name).is_file())
            for tv,record in manifest['histories'].items():
                source=build_static.read(record['file']);out=json.loads((root/record['file']).read_text())
                self.assertEqual(source['candles'],out['candles'])
                self.assertEqual(source['updated'],out['updated'])
            self.assertEqual(len(json.loads((root/'data-turnover-kr.json').read_text())['rows']),50)
    def test_cache_survives_restart_and_failure_preserves_collection_time(self):
        with tempfile.TemporaryDirectory() as folder,patch.dict(os.environ,{'HONGPICK_CACHE_DIR':folder,'HONGPICK_SYNC_COLLECTION':'1'}):
            key='architecture-test';cache.remember(key,3600,{'updated':'2026-09-20T00:00:00+00:00','value':7})
            cache._items.pop(key)
            self.assertEqual(cache.cached(key,3600,lambda:self.fail('Fresh persisted cache was ignored'))['value'],7)
            cache.remember(key,-1,{'updated':'2026-09-20T00:00:00+00:00','value':7})
            def fail():raise OSError('Provider offline')
            result=cache.cached(key,3600,fail)
            self.assertTrue(result['stale']);self.assertEqual(result['updated'],'2026-09-20T00:00:00+00:00')
            cache._items.pop(key,None)
    def test_only_existing_pages_origin_gets_public_api_cors(self):
        client=server.app.test_client()
        self.assertEqual(client.get('/api/turnover?market=invalid',headers={'Origin':'https://jho971031-cloud.github.io'}).headers.get('Access-Control-Allow-Origin'),'https://jho971031-cloud.github.io')
        self.assertIsNone(client.get('/api/turnover?market=invalid',headers={'Origin':'https://other.example'}).headers.get('Access-Control-Allow-Origin'))
        self.assertEqual(client.get('/api/history?symbol=NVDA&interval=BAD').status_code,400)

if __name__=='__main__':unittest.main()
