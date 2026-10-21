import json,unittest
from pathlib import Path
from unittest.mock import patch
from trump_refresh import parse_lines,agreed_rows,map_equity,collect_transactions,identity

class AutomaticDisclosureTests(unittest.TestCase):
    def test_ocr_disagreement_cannot_publish_wrong_date_action_or_amount(self):
        row='25 NVIDIA CORP purchase 8/21/2026 No $15,001 - $50,000'
        self.assertEqual(len(agreed_rows(row,row,'2026-10-08')),1)
        for changed in [row.replace('8/21','8/12'),row.replace('purchase','sale'),row.replace('15,001 - $50,000','50,001 - $100,000'),row.replace('NVIDIA','MICROSOFT')]:
            self.assertEqual(agreed_rows(row,changed,'2026-10-08'),[])

    def test_future_dates_invalid_bands_and_duplicate_ids_are_rejected(self):
        self.assertFalse(parse_lines('1 Apple purchase 12/31/2026 No $1,001 - $15,000','2026-10-08'))
        self.assertFalse(parse_lines('1 Apple purchase 8/21/2026 No $1,001 - $50,000','2026-10-08'))
        row='1 Apple purchase 8/21/2026 No $1,001 - $15,000'
        self.assertFalse(parse_lines(row+'\n'+row,'2026-10-08'))

    def test_bonds_preferred_and_ambiguous_share_classes_are_not_common_stock(self):
        directory=[{'name':'NVIDIA Corporation','ticker':'NVDA','tv':'NASDAQ:NVDA','type':'stock'}]
        self.assertEqual(map_equity('NVIDIA CORP',directory)['ticker'],'NVDA')
        for name in ['NVIDIA CORP NOTES DUE 2030','NVIDIA CORP PERP','NVIDIA CORP 5.000%','NVIDIA ETF']:
            self.assertIsNone(map_equity(name,directory))
        self.assertIsNone(map_equity('NVIDIA CORP',directory+[dict(directory[0],tv='NYSE:OTHER')]))

    def test_failed_new_report_preserves_prior_rows_and_is_retried(self):
        seed=json.loads((Path(__file__).parent/'data-trump-transactions.json').read_text())
        report={'sourceUrl':'https://extapps2.oge.gov/new.pdf','publicDate':'2026-10-20','type':'278 Transaction'}
        with patch('trump_refresh.download_pdf',side_effect=ValueError('network')):
            result=collect_transactions({'reports':[report]},seed)
        self.assertEqual({identity(x) for x in result['rows']},{identity(x) for x in seed['rows']})
        self.assertEqual(result['updated'],seed['updated'])
        self.assertEqual(result['automaticReports'][report['sourceUrl']]['status'],'retry')
        self.assertEqual(len(result['collectionErrors']),1)

    def test_new_confirmed_row_is_added_once_without_redating_existing_rows(self):
        seed=json.loads((Path(__file__).parent/'data-trump-transactions.json').read_text())
        report={'sourceUrl':'https://extapps2.oge.gov/new.pdf','publicDate':'2026-10-20','type':'278 Transaction'}
        row=dict(seed['rows'][0],id=1,sourceUrl=report['sourceUrl'],publicDate='2026-10-20')
        with patch('trump_refresh.download_pdf',return_value=b'PDF'),patch('trump_refresh.extract_report',return_value=([row],1)):
            result=collect_transactions({'reports':[report]},seed)
            second=collect_transactions({'reports':[report]},result)
        self.assertEqual(len(result['rows']),len(seed['rows'])+1)
        self.assertEqual(len(second['rows']),len(result['rows']))
        self.assertTrue(all(x in result['rows'] for x in seed['rows']))

if __name__=='__main__':unittest.main()
