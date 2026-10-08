"""Real one-minute bars; coarser minutes are aggregated from the same source."""
from datetime import datetime, timezone
from urllib.parse import quote
from cache import cached
import providers

def intraday_history(tv,interval='1m'):
    if interval not in ('1m','15m'):raise ValueError('지원하지 않는 분봉')
    if tv.startswith('BINANCE:'):return providers.coins.history(tv,interval)
    def load():
        ticker=tv.split(':',1)[1]
        symbols=[ticker+'.KS',ticker+'.KQ'] if tv.startswith('KRX:') else [providers.provider_symbol(tv)]
        for symbol in symbols:
            try:
                response=providers.SESSION.get('https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol,safe=''),params={'range':'1mo' if interval=='15m' else '5d','interval':interval,'includePrePost':'false'},timeout=12)
                response.raise_for_status();result=response.json()['chart']['result'][0];values=result['indicators']['quote'][0];rows=[]
                for i,t in enumerate(result.get('timestamp',[])):
                    prices=[providers.finite(values[k][i]) for k in ['open','high','low','close']]
                    if all(v is not None and v>0 for v in prices):rows.append(dict(zip(['open','high','low','close'],prices),time=int(t),volume=providers.finite(values['volume'][i]) or 0))
                rows=sorted({c['time']:c for c in rows}.values(),key=lambda c:c['time'])
                if not rows:continue
                return {'candles':rows,'interval':interval,'source':'Yahoo Finance '+interval+' OHLCV · 지연 시세','sourceUrl':'https://finance.yahoo.com/quote/'+symbol,'updated':providers.now(),'lastBar':datetime.fromtimestamp(rows[-1]['time'],timezone.utc).isoformat(),'exchangeTimezone':result['meta'].get('exchangeTimezoneName','UTC'),'providerSymbol':symbol,'range':'최근 1개월 · 본장 15분봉' if interval=='15m' else '최근 5거래일 · 장중 분봉','delaySeconds':result['meta'].get('dataGranularity')}
            except Exception:continue
        raise RuntimeError('분봉 제공원 데이터 없음')
    return cached(('intraday-v1:' if interval=='1m' else 'intraday15-v1:')+tv,120 if interval=='15m' else 60,load,('data-intraday15-' if interval=='15m' else 'data-intraday-')+tv.replace(':','-')+'.json')

