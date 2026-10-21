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



class TrumpDisclosureTests(unittest.TestCase):
    def test_catalog_filters_filer_and_preserves_publication_date(self):
        from disclosures import parse_oge_records
        records=[{'name':'Trump, Donald J','docDate':'2026-10-08T04:21:11','type':"<a href='https://extapps2.oge.gov/report.pdf'>278 Transaction</a>"}, {'name':'Trump, Ivanka','docDate':'2026-10-20','type':"<a href='https://extapps2.oge.gov/other.pdf'>Annual</a>"}]
        result=parse_oge_records(records)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['publicDate'],'2026-10-08')

    def test_catalog_pages_sorts_and_uses_current_api(self):
        from disclosures import oge_catalog
        def response(date,url):
            return SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'data':[{'name':'Trump, Donald J','docDate':date,'type':f"<a href='https://extapps2.oge.gov/{url}.pdf'>278 Transaction</a>"}],'recordsFiltered':2})
        with patch('disclosures.cached',side_effect=lambda key,ttl,load,seed:load()),patch('disclosures.SESSION.get',side_effect=[response('2026-09-22','old'),response('2026-10-08','new')]) as get:
            result=oge_catalog()
        self.assertEqual(get.call_count,2)
        self.assertTrue(get.call_args.args[0].endswith('/v3/rest'))
        self.assertEqual(result['reports'][0]['publicDate'],'2026-10-08')

    def test_new_unverified_document_is_visible_and_does_not_redate_rows(self):
        from disclosures import format_trump
        old={'publicDate':'2026-09-22','sourceUrl':'old','type':'278 Transaction'}
        new={'publicDate':'2026-10-08','sourceUrl':'new','type':'278 Transaction'}
        row={'publicDate':'2026-09-22','tradeDate':'2026-07-23','sourceUrl':'old','id':1}
        result=format_trump({'reports':[new],'updated':'2026-10-21','stale':True},{'reports':[old],'rows':[row],'coverageStartDate':'2026-09-22'})
        self.assertEqual(result['latestReportDate'],'2026-10-08')
        self.assertEqual(result['latestVerifiedPublicDate'],'2026-09-22')
        self.assertEqual(result['pendingReports'],[new])
        self.assertTrue(result['catalogStale'])
        self.assertEqual(result['rows'],[row])
        self.assertEqual(len(result['reports']),2)

    def test_verified_rows_have_unique_source_identity_and_correct_dates(self):
        import json
        from pathlib import Path
        data=json.loads((Path(__file__).parent/'data-trump-transactions.json').read_text())
        rows=data['rows'];keys=[(x['sourceUrl'],x['id']) for x in rows]
        self.assertEqual(len(keys),len(set(keys)))
        for row in rows:
            self.assertLessEqual(row['tradeDate'],row['publicDate'])
            if row['publicDate']>='2026-10-08':
                self.assertTrue(row.get('sourceSha256'))
                self.assertEqual(row.get('validation'),'ocr-two-pass-agreement-v2')

if __name__=='__main__':unittest.main()
