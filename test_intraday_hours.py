import unittest
from datetime import datetime,timezone
from intraday_provider import aggregate_four_hours

class StockFourHourTests(unittest.TestCase):
    def test_ohlcv_and_session_reset(self):
        def row(date,hour,close):
            t=int(datetime(2026,11,date,hour,30,tzinfo=timezone.utc).timestamp())
            return {'time':t,'open':close-.5,'high':close+1,'low':close-1,'close':close,'volume':10}
        # November US regular session starts 14:30 UTC. No bars cross into tomorrow.
        bars=[row(2,14+i,100+i) for i in range(7)]+[row(3,14+i,110+i) for i in range(4)]
        result=aggregate_four_hours(bars,'America/New_York')
        self.assertEqual(len(result),3)
        self.assertEqual([x['volume'] for x in result],[40,30,40])
        self.assertEqual(result[0]['open'],99.5)
        self.assertEqual(result[0]['close'],103)
        self.assertEqual(result[0]['high'],104)
        self.assertEqual(result[0]['low'],99)
        self.assertEqual(result[1]['time'],bars[4]['time'])
        self.assertEqual(result[2]['time'],bars[7]['time'])
        self.assertEqual(bars[0]['high'],101,'Aggregation must not mutate input bars')

if __name__=='__main__':unittest.main()
