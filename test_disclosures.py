"""Financial-data regression tests: amendment semantics and manager notices."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from disclosures import merge_filings, reporting_manager


def report(kind, positions, date='2026-08-14'):
    return {'amendmentType':kind,'holdings':[{'key':k,'shares':s,'value':v} for k,s,v in positions], 'sourceUrl':'https://www.sec.gov/test/'+date,'filed':date}


class FilingTests(unittest.TestCase):
    def test_additional_confidential_holdings_recompute_portfolio_weight(self):
        result=merge_filings([report('', [('A',10,900)]),report('NEW HOLDINGS',[('B',2,100)])])
        self.assertEqual({x['key']:x['weight'] for x in result['holdings']},{'A':90,'B':10})
        self.assertEqual(len(result['filings']),2)

    def test_restatement_removes_superseded_positions(self):
        result=merge_filings([report('',[('A',10,900)]),report('NEW HOLDINGS',[('B',2,100)]),report('RESTATEMENT',[('B',3,150)]),report('NEW HOLDINGS',[('C',1,50)])])
        self.assertEqual({x['key']:x['weight'] for x in result['holdings']},{'B':75,'C':25})
        self.assertEqual(len(result['filings']),2)

    def test_additional_rows_in_same_share_class_accumulate(self):
        result=merge_filings([report('',[('A',10,900)]),report('NEW HOLDINGS',[('A',2,180)])])
        self.assertEqual(result['holdings'][0]['shares'],12)
        self.assertEqual(result['holdings'][0]['weight'],100)

    def test_unknown_amendment_is_not_silently_treated_as_complete_report(self):
        with self.assertRaises(ValueError):merge_filings([report('UNKNOWN',[('A',10,900)])])

    def test_notice_follows_only_explicit_reporting_cik(self):
        notice={'form':'13F-NT','reportDate':'2026-06-30','filingDate':'2026-08-14','accessionNumber':'0000000001-26-000001','primaryDocument':'xsl/primary_doc.xml'}
        holdings=dict(notice,form='13F-HR')
        def rows(cik):return ('Old manager',[notice]) if cik=='1' else ('Parent',[holdings])
        xml=b'<form><otherManager><cik>0002</cik></otherManager></form>'
        with patch('disclosures.submission_rows',side_effect=rows),patch('disclosures.get',return_value=SimpleNamespace(content=xml)):
            cik,name,_,source=reporting_manager('1')
        self.assertEqual((cik,name),('2','Parent'))
        self.assertEqual(source['quarter'],'2026-06-30')

    def test_notice_with_multiple_managers_does_not_guess(self):
        notice={'form':'13F-NT','reportDate':'2026-06-30','filingDate':'2026-08-14','accessionNumber':'0000000001-26-000001','primaryDocument':'primary_doc.xml'}
        xml=b'<form><otherManager><cik>2</cik></otherManager><otherManager><cik>3</cik></otherManager></form>'
        with patch('disclosures.submission_rows',return_value=('Manager',[notice])),patch('disclosures.get',return_value=SimpleNamespace(content=xml)):
            with self.assertRaises(ValueError):reporting_manager('1')

if __name__=='__main__':unittest.main()
