import ast, os
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from cache import cached
import providers
SESSION=providers.SESSION
finite=providers.finite
now=providers.now

def fibonacci_history(tv):
    if tv.startswith('BINANCE:'):return providers.coins.history(tv,'W')
    """Completed 10-year weekly bars used only by the automatic channel tool."""
    def load():
        ticker=tv.split(':',1)[1];candles=[];today=datetime.now(timezone.utc)
        monday=(today-timedelta(days=today.weekday())).date()
        if tv.startswith('KRX:'):
            start=(today-timedelta(days=3653)).strftime('%Y%m%d');end=today.strftime('%Y%m%d')
            r=SESSION.get('https://api.finance.naver.com/siseJson.naver',params={'symbol':ticker,'requestType':1,'startTime':start,'endTime':end,'timeframe':'week'},timeout=18);r.raise_for_status();rows=ast.literal_eval(r.text.strip())
            for x in rows[1:]:
                if len(x)>=6 and all(isinstance(v,(int,float)) for v in x[1:6]):
                    candles.append({'time':datetime.strptime(str(x[0]),'%Y%m%d').date().isoformat(),'open':x[1],'high':x[2],'low':x[3],'close':x[4],'volume':x[5]})
            source='NAVER Finance 10-year weekly OHLCV';source_url='https://finance.naver.com/item/main.naver?code='+ticker
        else:
            r=SESSION.get('https://query1.finance.yahoo.com/v8/finance/chart/'+quote(providers.provider_symbol(tv),safe=''),params={'range':'10y','interval':'1wk'},timeout=18);r.raise_for_status();d=r.json()['chart']['result'][0];z=d['indicators']['quote'][0]
            for i,t in enumerate(d.get('timestamp',[])):
                vals=[finite(z[k][i]) for k in ['open','high','low','close']]
                if all(v is not None for v in vals):candles.append(dict(zip(['open','high','low','close'],vals),time=datetime.fromtimestamp(t,timezone.utc).date().isoformat(),volume=finite(z['volume'][i]) or 0))
            source='Yahoo Finance crypto USD 10-year weekly OHLCV' if tv.startswith('CRYPTO:') else 'Yahoo Finance 10-year weekly OHLCV';source_url='https://finance.yahoo.com/quote/'+quote(providers.provider_symbol(tv),safe='')
        candles=sorted({x['time']:x for x in candles if x['close']>0 and datetime.fromisoformat(x['time']).date()<monday}.values(),key=lambda x:x['time'])
        if len(candles)<52:raise ValueError('주봉 데이터가 부족합니다')
        return {'candles':candles,'source':source,'sourceUrl':source_url,'updated':now(),'lastBar':candles[-1]['time'],'interval':'W','range':'10y','completeWeeksOnly':True,'adjustment':'제공원 주봉 OHLCV 기준. 진행 중인 주는 제외합니다.'}
    return cached('fib-history-v1:'+tv,int(os.getenv('HONGPICK_FIB_HISTORY_TTL','86400')),load,'data-fib-history-'+tv.replace(':','-')+'.json')

