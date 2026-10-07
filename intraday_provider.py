"""Real one-minute bars; coarser minutes are aggregated from the same source."""
from datetime import datetime, timezone
from urllib.parse import quote
from cache import cached
import providers

def intraday_history(tv):
    def load():
        ticker=tv.split(':',1)[1]
        symbols=[ticker+'.KS',ticker+'.KQ'] if tv.startswith('KRX:') else [providers.provider_symbol(tv)]
        for symbol in symbols:
            try:
                response=providers.SESSION.get('https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol,safe=''),params={'range':'5d','interval':'1m','includePrePost':'false'},timeout=12)
                response.raise_for_status();result=response.json()['chart']['result'][0];values=result['indicators']['quote'][0];rows=[]
                for i,t in enumerate(result.get('timestamp',[])):
                    prices=[providers.finite(values[k][i]) for k in ['open','high','low','close']]
                    if all(v is not None and v>0 for v in prices):rows.append(dict(zip(['open','high','low','close'],prices),time=int(t),volume=providers.finite(values['volume'][i]) or 0))
                rows=sorted({c['time']:c for c in rows}.values(),key=lambda c:c['time'])
                if not rows:continue
                return {'candles':rows,'interval':'1m','source':'Yahoo Finance 1-minute OHLCV · 지연 시세','sourceUrl':'https://finance.yahoo.com/quote/'+symbol,'updated':providers.now(),'lastBar':datetime.fromtimestamp(rows[-1]['time'],timezone.utc).isoformat(),'exchangeTimezone':result['meta'].get('exchangeTimezoneName','UTC'),'providerSymbol':symbol,'range':'최근 5거래일 · 장중 분봉','delaySeconds':result['meta'].get('dataGranularity')}
            except Exception:continue
        raise RuntimeError('분봉 제공원 데이터 없음')
    return cached('intraday-v1:'+tv,60,load,'data-intraday-'+tv.replace(':','-')+'.json')

