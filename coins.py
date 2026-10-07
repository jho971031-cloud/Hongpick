"""Binance spot USDT markets. Prices/turnover never come from another exchange."""
import math, os, re, requests
from datetime import datetime, timezone
from cache import cached
from symbols import COINS

BASE = os.getenv('BINANCE_DATA_URL', 'https://data-api.binance.vision').rstrip('/')
SESSION = requests.Session()
SESSION.headers['User-Agent'] = 'HongPick public market data'
NAMES = {ticker: (ko, en) for ticker, en, ko in COINS}
NAMES.update({k:(v,k) for k,v in {'USDC':'USD코인','PAXG':'팍스골드','TRX':'트론','TON':'톤코인','SUI':'수이','PEPE':'페페','SHIB':'시바이누','APT':'앱토스','ARB':'아비트럼','OP':'옵티미즘','NEAR':'니어프로토콜','POL':'폴리곤','UNI':'유니스왑','ETC':'이더리움클래식','XLM':'스텔라루멘','HBAR':'헤데라','FIL':'파일코인','AAVE':'에이브','INJ':'인젝티브','SEI':'세이','WLD':'월드코인','TAO':'비트텐서','RENDER':'렌더토큰','BONK':'봉크','FLOKI':'플로키','FET':'페치','ENA':'에테나','ONDO':'온도파이낸스','ALGO':'알고랜드','ATOM':'코스모스','VET':'비체인','ICP':'인터넷컴퓨터','JUP':'주피터','WIF':'도그위프햇','CRV':'커브','GRT':'더그래프','MANA':'디센트럴랜드','SAND':'샌드박스','AXS':'엑시인피니티','IMX':'이뮤터블엑스','EOS':'이오스','XTZ':'테조스','ZEC':'지캐시','DASH':'대시'}.items()})

def now(): return datetime.now(timezone.utc).isoformat()
def norm(q): return re.sub(r'[\s/.:_\-]', '', str(q).casefold())
def get(path, params=None):
    r=SESSION.get(BASE+'/api/v3/'+path,params=params,timeout=15);r.raise_for_status();d=r.json()
    if isinstance(d,dict) and 'code' in d and d['code']<0: raise ValueError('Binance market data unavailable')
    return d

def names():
    def load():
        result=dict(NAMES)
        try:
            r=SESSION.get('https://api.upbit.com/v1/market/all',timeout=8);r.raise_for_status()
            for x in r.json():
                ticker=x['market'].split('-')[-1]
                result.setdefault(ticker,(x['korean_name'],x['english_name']))
        except Exception: pass
        return result
    return cached('binance-name-metadata-v1',86400,load)

def directory():
    def load():
        labels=names();rows=[]
        for x in get('exchangeInfo')['symbols']:
            if x['quoteAsset']!='USDT' or x['status']!='TRADING' or not x.get('isSpotTradingAllowed',False):continue
            base=x['baseAsset'];ko,en=labels.get(base,(base,base));tv='BINANCE:'+x['symbol']
            rows.append(dict(tv=tv,symbol=tv,ticker=x['symbol'],baseAsset=base,name=ko,englishName=en,type='crypto',exchange='BINANCE',currency='USDT',nameAvailable=base in labels))
        if not rows:raise ValueError('Binance USDT directory unavailable')
        return dict(rows=rows,source='Binance 현물 USDT 상장 목록',sourceUrl='https://www.binance.com/en/markets/overview',updated=now(),nameSource='한글명: 기본 별칭 / Upbit 공개 종목명 메타데이터 · 가격은 Binance만 사용')
    return cached('binance-directory-v1',3600,load,'data-binance-directory.json')

def search(q):
    query=norm(q.split(':')[-1]);found=[]
    if not query:return {'results':[]}
    for x in directory()['rows']:
        labels=[norm(x[k]) for k in ('ticker','baseAsset','name','englishName')]
        if query in labels:score=0
        elif any(v.startswith(query) for v in labels):score=1
        elif any(query in v for v in labels):score=2
        else:continue
        found.append((score,x))
    return dict(results=[x for _,x in sorted(found,key=lambda v:(v[0],len(v[1]['ticker']),v[1]['ticker']))[:30]],source='Binance USDT 현물 검색')

def resolve(tv):
    symbol=tv.split(':')[-1].upper()
    if not re.fullmatch(r'[A-Z0-9]{2,30}USDT',symbol):raise ValueError('바이낸스 USDT 현물 심볼을 선택해 주세요')
    return symbol

def tickers():
    def load():
        listed={x['ticker']:x for x in directory()['rows']};rows=[]
        for x in get('ticker/24hr'):
            if x['symbol'] not in listed:continue
            price,change,turnover=[float(x[k]) for k in ('lastPrice','priceChangePercent','quoteVolume')]
            if price<=0 or turnover<0 or not all(math.isfinite(v) for v in (price,change,turnover)):continue
            rows.append(dict(listed[x['symbol']],price=price,change=change,turnover=turnover,volume=float(x['volume']),updated=datetime.fromtimestamp(x['closeTime']/1000,timezone.utc).isoformat(),windowStart=datetime.fromtimestamp(x['openTime']/1000,timezone.utc).isoformat()))
        if not rows:raise ValueError('Binance turnover unavailable')
        rows.sort(key=lambda x:(-x['turnover'],x['ticker']))
        return dict(rows=[dict(x,rank=i+1) for i,x in enumerate(rows)],source='Binance Spot 24h ticker · quoteVolume',sourceUrl='https://www.binance.com/en/markets/overview',updated=max(x['updated'] for x in rows),collectedAt=now(),method='최근 24시간 실제 USDT 체결대금 합계 · 거래 중인 USDT 현물만 포함 · 선물 제외')
    return cached('binance-turnover-v1',120,load,'data-binance-turnover.json')

def stock(tv):
    sym=resolve(tv);d=tickers();row=next((x for x in d['rows'] if x['ticker']==sym),None)
    if not row:raise ValueError('바이낸스 거래 중인 현물 데이터 없음')
    return dict(row,source=d['source'],sourceUrl=d['sourceUrl'],stale=d.get('stale',False),method=d['method'])

def history(tv,frame='D'):
    symbol=resolve(tv);interval={'D':'1d','W':'1w','1m':'1m'}[frame]
    def load():
        rows=[];stamp=datetime.now(timezone.utc).timestamp()*1000
        for x in get('klines',{'symbol':symbol,'interval':interval,'limit':1000}):
            if frame=='W' and x[6]>=stamp:continue
            vals=[float(v) for v in x[1:5]]
            if not all(math.isfinite(v) and v>0 for v in vals):continue
            time=int(x[0]/1000) if frame=='1m' else datetime.fromtimestamp(x[0]/1000,timezone.utc).date().isoformat()
            rows.append(dict(zip(('open','high','low','close'),vals),time=time,volume=float(x[5])))
        if len(rows)<2:raise ValueError('바이낸스 캔들 데이터 부족')
        return dict(candles=rows,interval=frame,source='Binance Spot '+interval+' OHLCV',sourceUrl='https://www.binance.com/en/trade/'+symbol[:-4]+'_USDT?type=spot',updated=now(),lastBar=rows[-1]['time'],exchangeTimezone='UTC',completeWeeksOnly=frame=='W',adjustment='Binance 현물 원본 가격 · UTC · 일봉/분봉 진행 중인 봉 포함 · 주봉은 완료된 봉만 사용')
    prefix={'D':'data-history-','W':'data-fib-history-','1m':'data-intraday-'}[frame]
    return cached('binance-history-v1:'+symbol+':'+frame,120 if frame=='1m' else 21600 if frame=='W' else 900,load,prefix+tv.replace(':','-')+'.json')
