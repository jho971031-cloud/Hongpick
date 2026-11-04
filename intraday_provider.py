"""Intraday OHLCV from real providers; 4h stock bars aggregate 1h session bars."""
from datetime import datetime, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from cache import cached
import providers

def aggregate_four_hours(rows, zone_name):
    """Group by exchange-local session date and elapsed 4h from its first bar."""
    try: zone=ZoneInfo(zone_name or 'UTC')
    except ZoneInfoNotFoundError: zone=timezone.utc
    groups={};starts={}
    for row in sorted(rows,key=lambda x:x['time']):
        day=datetime.fromtimestamp(row['time'],zone).date()
        starts.setdefault(day,row['time'])
        bucket=(row['time']-starts[day])//14400
        key=(day,bucket)
        if key not in groups:groups[key]=row.copy()
        else:
            group=groups[key]
            group['high']=max(group['high'],row['high']);group['low']=min(group['low'],row['low'])
            group['close']=row['close'];group['volume']+=row['volume']
    return list(groups.values())

def intraday_history(tv,interval='1m'):
    if interval not in ('1m','5m','15m','1h','4h'):raise ValueError('지원하지 않는 시간봉')
    if tv.startswith('BINANCE:'):return providers.coins.history(tv,interval)
    def load():
        ticker=tv.split(':',1)[1]
        symbols=[ticker+'.KS',ticker+'.KQ'] if tv.startswith('KRX:') else [providers.provider_symbol(tv)]
        for symbol in symbols:
            try:
                provider_interval='60m' if interval in ('1h','4h') else interval
                data_range='1y' if interval in ('1h','4h') else '1mo' if interval in ('5m','15m') else '5d'
                response=providers.SESSION.get('https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol,safe=''),params={'range':data_range,'interval':provider_interval,'includePrePost':'false'},timeout=12)
                response.raise_for_status();result=response.json()['chart']['result'][0];values=result['indicators']['quote'][0];rows=[]
                for i,t in enumerate(result.get('timestamp',[])):
                    prices=[providers.finite(values[k][i]) for k in ['open','high','low','close']]
                    if all(v is not None and v>0 for v in prices):rows.append(dict(zip(['open','high','low','close'],prices),time=int(t),volume=providers.finite(values['volume'][i]) or 0))
                rows=sorted({c['time']:c for c in rows}.values(),key=lambda c:c['time'])
                if not rows:continue
                zone=result['meta'].get('exchangeTimezoneName','UTC')
                if interval=='4h':rows=aggregate_four_hours(rows,zone)
                source='Yahoo Finance 60m 기반 4시간 집계' if interval=='4h' else 'Yahoo Finance '+interval+' OHLCV'
                span='최근 1년 · 본장 시간봉' if interval in ('1h','4h') else '최근 1개월 · 본장 '+interval[:-1]+'분봉' if interval in ('5m','15m') else '최근 5거래일 · 장중 분봉'
                return {'candles':rows,'interval':interval,'source':source+' · 지연 시세','sourceUrl':'https://finance.yahoo.com/quote/'+symbol,'updated':providers.now(),'lastBar':datetime.fromtimestamp(rows[-1]['time'],timezone.utc).isoformat(),'exchangeTimezone':zone,'providerSymbol':symbol,'range':span,'delaySeconds':result['meta'].get('dataGranularity')}
            except Exception:continue
        raise RuntimeError('분봉 제공원 데이터 없음')
    prefix=('data-intraday'+interval+'-' if interval in ('1h','4h') else 'data-intraday'+interval[:-1]+'-' if interval in ('5m','15m') else 'data-intraday-')
    return cached('intraday-'+interval+'-v2:'+tv,120 if interval!='1m' else 60,load,prefix+tv.replace(':','-')+'.json')


