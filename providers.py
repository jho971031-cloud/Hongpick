"""Public market providers. No credentials, fabricated numbers or inferred exchanges."""
import ast, math, os, re, requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from cache import cached
SESSION = requests.Session()
SESSION.headers['User-Agent'] = 'HongPick personal dashboard; contact: ' + os.getenv('SEC_CONTACT', 'hongpick@example.com')
ALIASES = {'테슬라':'TSLA','애플':'AAPL','엔비디아':'NVDA','마이크로소프트':'MSFT','아마존':'AMZN','메타':'META','구글':'GOOGL','알파벳':'GOOGL','삼성전자':'005930','sk하이닉스':'000660','하이닉스':'000660','현대차':'005380','네이버':'035420','카카오':'035720','기아':'000270'}
COLUMNS = ['name','description','exchange','type','close','change','volume','Value.Traded','RSI','price_52_week_high','relative_volume_10d_calc','currency','update_mode']

def now(): return datetime.now(timezone.utc).isoformat()
def finite(x): return float(x) if isinstance(x,(int,float)) and math.isfinite(x) else None

def scan(market, columns, tickers=None, limit=50):
    payload={'columns':columns,'options':{'lang':'ko' if market=='kr' else 'en'},'range':[0,limit]}
    if tickers: payload['symbols']={'tickers':tickers,'query':{'types':[]}}
    else:
        payload['sort']={'sortBy':'Value.Traded','sortOrder':'desc'}
        payload['filter']=[{'left':'type','operation':'in_range','right':['stock','fund']},{'left':'exchange','operation':'in_range','right':['KRX'] if market=='kr' else ['NASDAQ','NYSE','AMEX']}]
    r=SESSION.post('https://scanner.tradingview.com/'+('korea' if market=='kr' else 'america')+'/scan',json=payload,timeout=15);r.raise_for_status()
    return r.json()

def item(row):
    d=dict(zip(COLUMNS,row['d']));tv=row['s'];sym=tv.split(':',1)[1];price=finite(d.get('close'));hi=finite(d.get('price_52_week_high'))
    name=d.get('description') or sym
    if tv.startswith('KRX:'): name=re.sub(r'(보통주|우선주)$','',name)
    return {'tv':tv,'symbol':tv,'ticker':sym,'name':name,'exchange':d.get('exchange'),'type':d.get('type'),'price':price,'change':finite(d.get('change')),'volume':finite(d.get('volume')),'turnover':finite(d.get('Value.Traded')),'rsi':finite(d.get('RSI')),'drawdown':(price/hi-1)*100 if price and hi else None,'high52':hi,'relativeVolume':finite(d.get('relative_volume_10d_calc')),'surge':(finite(d.get('relative_volume_10d_calc')) or 0)>=2,'currency':d.get('currency'),'delay':d.get('update_mode')}

def turnover(market):
    def load():
        d=scan(market,COLUMNS)
        rows=[dict(item(x),rank=i+1)for i,x in enumerate(d['data'])]
        if not rows: raise ValueError('Empty screener')
        return {'rows':rows,'source':'TradingView Screener','sourceUrl':'https://www.tradingview.com/screener/','updated':now(),'coverage':'상장 주식·ETF, NASDAQ/NYSE/AMEX' if market=='us' else 'KRX 상장 주식·ETF','method':'거래대금은 현재가 × 당일 누적 거래량 추정값. RSI(14)와 52주 고점은 제공원 가격 데이터 기반. 급증: 동시간대 상대거래량(10일) ≥ 2배. 지연 시세.'}
    return cached('turnover:'+market,90,load,'data-turnover-'+market+'.json')

def directory(market):
    def load():
        cols=['name','description','exchange','type']
        d=scan(market,cols,limit=25000)
        rows=[]
        for x in d['data']:
            sym,name,exchange,typ=x['d'];rows.append({'symbol':x['s'],'tv':x['s'],'ticker':sym,'name':re.sub(r'(보통주|우선주)$','',name) if market=='kr' else name,'exchange':exchange,'type':typ})
        return {'rows':rows,'source':'TradingView symbol directory','updated':now()}
    return cached('directory:'+market,86400,load,'data-directory-'+market+'.json')

def normalized(q):return re.sub(r'[\s.,&\-]','',q.casefold())
def search(q):
    nq=normalized(q);alias=ALIASES.get(q.casefold());results=[];errors=[]
    markets=['kr'] if re.search('[가-힣]',q) or q.isdigit() else ['us','kr']
    if alias: markets=['kr'] if alias.isdigit() else ['us']
    for market in markets:
        try:
            for x in directory(market)['rows']:
                ticker=x['ticker'].casefold();name=normalized(x['name']);query=normalized(alias or q.split(':')[-1])
                if query==normalized(ticker):score=0
                elif nq==name:score=1
                elif ticker.startswith(query):score=2
                elif nq in name:score=3
                elif query in ticker:score=4
                else:continue
                results.append((score,x))
        except Exception: errors.append(market)
    results.sort(key=lambda x:(x[0],len(x[1]['name']),x[1]['tv']))
    return {'results':[x[1]for x in results[:20]],'source':'TradingView symbol directory / Korean name aliases','error':'일부 제공원 연결 오류' if errors else None}

def resolve(symbol):
    s=symbol.upper().strip()
    if re.fullmatch(r'(NASDAQ|NYSE|AMEX|KRX):[A-Z0-9.\-]{1,20}',s):return s
    s=re.sub(r'\.(KS|KQ)$','',s)
    found=search(s)['results'];exact=[x for x in found if x['ticker']==s]
    if len(exact)!=1:raise ValueError('거래소 후보를 선택해 주세요')
    return exact[0]['tv']

def stock(tv):
    market='kr' if tv.startswith('KRX:') else 'us'
    def load():
        d=scan(market,COLUMNS,[tv]);rows=d.get('data',[])
        if not rows:raise ValueError('Price unavailable')
        return dict(item(rows[0]),source='TradingView Screener',updated=now(),method='지연 시세 · 거래대금은 현재가 × 거래량 추정값')
    return cached('quote:'+tv,90,load)

def history(tv,interval='D'):
    def load():
        ticker=tv.split(':',1)[1];candles=[]
        if tv.startswith('KRX:'):
            start=(datetime.now(timezone.utc)-timedelta(days=780)).strftime('%Y%m%d');end=datetime.now(timezone.utc).strftime('%Y%m%d')
            r=SESSION.get('https://api.finance.naver.com/siseJson.naver',params={'symbol':ticker,'requestType':1,'startTime':start,'endTime':end,'timeframe':'day'},timeout=15);r.raise_for_status();rows=ast.literal_eval(r.text.strip())
            for x in rows[1:]:
                if len(x)>=6 and all(isinstance(v,(int,float)) for v in x[1:6]):
                    candles.append({'time':datetime.strptime(str(x[0]),'%Y%m%d').date().isoformat(),'open':x[1],'high':x[2],'low':x[3],'close':x[4],'volume':x[5]})
            source='NAVER Finance daily OHLCV';source_url='https://finance.naver.com/item/main.naver?code='+ticker
        else:
            r=SESSION.get('https://query1.finance.yahoo.com/v8/finance/chart/'+quote(ticker.replace('.','-'),safe=''),params={'range':'2y','interval':'1d'},timeout=15);r.raise_for_status();d=r.json()['chart']['result'][0];z=d['indicators']['quote'][0]
            for i,t in enumerate(d.get('timestamp',[])):
                vals=[finite(z[k][i]) for k in ['open','high','low','close']]
                if all(v is not None for v in vals):candles.append(dict(zip(['open','high','low','close'],vals),time=datetime.fromtimestamp(t,timezone.utc).date().isoformat(),volume=finite(z['volume'][i]) or 0))
            source='Yahoo Finance daily OHLCV';source_url='https://finance.yahoo.com/quote/'+quote(ticker.replace('.','-'),safe='')
        candles=sorted({x['time']:x for x in candles if x['close']>0}.values(),key=lambda x:x['time'])
        if len(candles)<2:raise ValueError('OHLCV unavailable')
        return {'candles':candles,'source':source,'sourceUrl':source_url,'updated':now(),'lastBar':candles[-1]['time'],'interval':'D','adjustment':'제공원 OHLCV 기준. 기업행사에 따라 제공원별 조정 방식이 다를 수 있습니다.'}
    data=cached('history:'+tv,900,load,'data-history-'+tv.replace(':','-')+'.json')
    if interval=='D':return data
    groups={}
    for c in data['candles']:
        date=datetime.fromisoformat(c['time']);key=date.strftime('%G-%V') if interval=='W' else date.strftime('%Y-%m')
        if key not in groups:groups[key]=dict(c)
        else:
            b=groups[key];b['high']=max(b['high'],c['high']);b['low']=min(b['low'],c['low']);b['close']=c['close'];b['volume']+=c['volume']
    return dict(data,candles=list(groups.values()),interval=interval)

def fear_greed(kind='stock'):
    def load():
        if kind=='crypto':
            r=SESSION.get('https://api.alternative.me/fng/',params={'limit':365},timeout=12);r.raise_for_status();records=r.json()['data']
            return {'value':int(records[0]['value']),'classification':records[0]['value_classification'],'history':[{'date':datetime.fromtimestamp(int(x['timestamp']),timezone.utc).date().isoformat(),'value':int(x['value'])}for x in reversed(records)],'source':'Alternative.me Crypto Fear & Greed','sourceUrl':'https://alternative.me/crypto/fear-and-greed-index/','updated':datetime.fromtimestamp(int(records[0]['timestamp']),timezone.utc).isoformat(),'kind':kind}
        url=os.getenv('CNN_FNG_URL','https://production.dataviz.cnn.io/index/fearandgreed/graphdata')
        r=SESSION.get(url,timeout=12);r.raise_for_status();d=r.json();f=d['fear_and_greed'];hist=d.get('fear_and_greed_historical',{}).get('data',[])
        return {'value':round(f['score']),'classification':f['rating'].replace('_',' ').title(),'history':[{'date':datetime.fromtimestamp(x['x']/1000,timezone.utc).date().isoformat(),'value':x['y']}for x in hist],'source':'CNN stock Fear & Greed Index','sourceUrl':'https://www.cnn.com/markets/fear-and-greed','updated':f.get('timestamp'),'kind':kind}
    return cached('fng:'+kind,1800,load,'data-fng-'+kind+'.json')

INDEXES=[('^GSPC','S&P 500','sp500'),('^IXIC','NASDAQ','nasdaq'),('BTC-USD','Bitcoin','bitcoin')]
def index_quote(ticker,name,seed):
    def load():
        r=SESSION.get('https://query1.finance.yahoo.com/v8/finance/chart/'+quote(ticker,safe=''),params={'range':'5d','interval':'1d'},timeout=10);r.raise_for_status();d=r.json()['chart']['result'][0];m=d['meta'];cl=[v for v in d['indicators']['quote'][0]['close']if v is not None];price=m.get('regularMarketPrice') or cl[-1];prev=m.get('previousClose') or (cl[-2]if len(cl)>1 else None)
        return {'name':name,'price':price,'change':(price/prev-1)*100 if prev else None,'source':'Yahoo Finance','updated':datetime.fromtimestamp(m['regularMarketTime'],timezone.utc).isoformat()}
    return cached('index:'+ticker,120,load,'data-index-'+seed+'.json')

def overview():
    def one(args):
        try:return index_quote(*args)
        except Exception:return {'name':args[1],'error':'데이터 없음'}
    with ThreadPoolExecutor(max_workers=3)as pool:rows=list(pool.map(one,INDEXES))
    return {'rows':rows}
