"""Public market providers. No credentials, fabricated numbers or inferred exchanges."""
import ast, math, os, re, requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from cache import cached
from symbols import CRYPTO_ROWS, crypto_rows, provider_symbol
import coins
SESSION = requests.Session()
SESSION.headers['User-Agent'] = 'HongPick personal dashboard; contact: ' + (os.getenv('SEC_CONTACT') or 'hongpick@example.com')
ALIASES = {'테슬라':'TSLA','애플':'AAPL','엔비디아':'NVDA','마이크로소프트':'MSFT','아마존':'AMZN','메타':'META','구글':'GOOGL','알파벳':'GOOGL','삼성전자':'005930','sk하이닉스':'000660','하이닉스':'000660','현대차':'005380','네이버':'035420','카카오':'035720','기아':'000270'}
ALIASES.update({'리게티':'RGTI','리게티컴퓨팅':'RGTI','리게티 컴퓨팅':'RGTI'})
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

def normalized(q):return re.sub(r'[\s.,&\-]','',str(q or '').casefold())
def remote_search(q):
    """Additional candidates only; never guess an exchange for an unknown ticker."""
    def load():
        r=SESSION.get('https://query1.finance.yahoo.com/v1/finance/search',params={'q':ALIASES.get(q.casefold(),q),'quotesCount':20,'newsCount':0},timeout=8);r.raise_for_status()
        exchanges={'NMS':'NASDAQ','NGM':'NASDAQ','NCM':'NASDAQ','NAS':'NASDAQ','NYQ':'NYSE','NYSE':'NYSE','ASE':'AMEX','AMEX':'AMEX','PCX':'AMEX','BTS':'AMEX'}
        out=[]
        for x in r.json().get('quotes',[]):
            symbol=x.get('symbol','');name=x.get('longname') or x.get('shortname') or symbol;typ=x.get('quoteType')
            if not symbol:continue
            if typ=='CRYPTOCURRENCY' and symbol.endswith('-USD'):
                tv='CRYPTO:'+symbol;out.append(dict(tv=tv,symbol=tv,ticker=symbol[:-4],name=name,exchange='암호화폐 USD 종합',type='crypto',providerSymbol=symbol));continue
            if typ not in ('EQUITY','ETF'):continue
            exchange=exchanges.get(x.get('exchange'))
            if symbol.endswith(('.KS','.KQ')):exchange='KRX';symbol=symbol[:-3]
            if not exchange:continue
            tv=exchange+':'+symbol;out.append(dict(tv=tv,symbol=tv,ticker=symbol,name=name,exchange=exchange,type='fund' if typ=='ETF' else 'stock'))
        return out
    return cached('search-candidates-v1:'+q.casefold(),3600,load)
def search(q):
    q=q.strip()
    if not q:return {'results':[]}
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
    if not any(score==0 for score,x in results):
        try:results.extend((0 if normalized(x['ticker'])==nq else 3,x) for x in remote_search(q))
        except Exception:errors.append('additional-search')
    prefix=q.split(':',1)[0].upper() if ':' in q else None
    results.sort(key=lambda x:(x[0],len(x[1]['name']),x[1]['tv']))
    unique={}
    for score,x in results:
        if x.get('type')=='crypto':continue
        if prefix and not x['tv'].startswith(prefix+':'):continue
        unique.setdefault(x['tv'],x)
    return {'results':list(unique.values())[:20],'source':'TradingView / Yahoo Finance symbol search / crypto identifiers','error':'일부 제공원 연결 오류' if errors else None}

def resolve(symbol):
    s=symbol.upper().strip()
    if re.fullmatch(r'BINANCE:[A-Z0-9]{2,30}USDT',s):return s
    if re.fullmatch(r'CRYPTO:[A-Z0-9]{1,20}-USD',s):return s
    if re.fullmatch(r'(NASDAQ|NYSE|AMEX|KRX):[A-Z0-9.\-]{1,20}',s):return s
    s=re.sub(r'\.(KS|KQ)$','',s)
    found=search(s)['results'];exact=[x for x in found if x['ticker']==s]
    if len(exact)!=1:raise ValueError('거래소 후보를 선택해 주세요')
    return exact[0]['tv']

def stock(tv):
    if tv.startswith('BINANCE:'):return coins.stock(tv)
    if tv.startswith('CRYPTO:'):
        def crypto_quote():
            data=history(tv);rows=data['candles'];last=rows[-1];prior=rows[-2]['close'];price=last['close'];hi=max(x['high'] for x in rows[-365:])
            gain=loss=0
            for i in range(1,len(rows)):
                change=rows[i]['close']-rows[i-1]['close'];g=max(change,0);l=max(-change,0)
                if i<=14:
                    gain+=g;loss+=l
                    if i==14:gain/=14;loss/=14
                else:gain=(gain*13+g)/14;loss=(loss*13+l)/14
            rsi=(100 if gain else 50) if loss==0 else 100-100/(1+gain/loss)
            coin=next((x for x in CRYPTO_ROWS if x['tv']==tv),{'name':provider_symbol(tv),'ticker':provider_symbol(tv)[:-4]})
            return dict(coin,tv=tv,symbol=tv,price=price,change=(price/prior-1)*100,rsi=rsi,drawdown=(price/hi-1)*100,high52=hi,currency='USD',turnover=None,volume=last['volume'],source=data['source'],updated=data['updated'],stale=data.get('stale',False),method='암호화폐 USD 종합 일봉 · 진행 중인 UTC 일봉 포함 · 거래대금 순위 없음')
        return cached('crypto-quote:'+tv,90,crypto_quote)
    market='kr' if tv.startswith('KRX:') else 'us'
    def load():
        d=scan(market,COLUMNS,[tv]);rows=d.get('data',[])
        if not rows:raise ValueError('Price unavailable')
        return dict(item(rows[0]),source='TradingView Screener',updated=now(),method='지연 시세 · 거래대금은 현재가 × 거래량 추정값')
    return cached('quote:'+tv,90,load)

def history(tv,interval='D'):
    def load():
        if tv.startswith('BINANCE:'):return coins.history(tv,'D')
        ticker=tv.split(':',1)[1];candles=[]
        if tv.startswith('KRX:'):
            start=(datetime.now(timezone.utc)-timedelta(days=780)).strftime('%Y%m%d');end=datetime.now(timezone.utc).strftime('%Y%m%d')
            r=SESSION.get('https://api.finance.naver.com/siseJson.naver',params={'symbol':ticker,'requestType':1,'startTime':start,'endTime':end,'timeframe':'day'},timeout=15);r.raise_for_status();rows=ast.literal_eval(r.text.strip())
            for x in rows[1:]:
                if len(x)>=6 and all(isinstance(v,(int,float)) for v in x[1:6]):
                    candles.append({'time':datetime.strptime(str(x[0]),'%Y%m%d').date().isoformat(),'open':x[1],'high':x[2],'low':x[3],'close':x[4],'volume':x[5]})
            source='NAVER Finance daily OHLCV';source_url='https://finance.naver.com/item/main.naver?code='+ticker
        else:
            r=SESSION.get('https://query1.finance.yahoo.com/v8/finance/chart/'+quote(provider_symbol(tv),safe=''),params={'range':'2y','interval':'1d'},timeout=15);r.raise_for_status();d=r.json()['chart']['result'][0];z=d['indicators']['quote'][0]
            for i,t in enumerate(d.get('timestamp',[])):
                vals=[finite(z[k][i]) for k in ['open','high','low','close']]
                if all(v is not None for v in vals):candles.append(dict(zip(['open','high','low','close'],vals),time=datetime.fromtimestamp(t,timezone.utc).date().isoformat(),volume=finite(z['volume'][i]) or 0))
            source='Yahoo Finance crypto USD daily OHLCV' if tv.startswith('CRYPTO:') else 'Yahoo Finance daily OHLCV';source_url='https://finance.yahoo.com/quote/'+quote(provider_symbol(tv),safe='')
        candles=sorted({x['time']:x for x in candles if x['close']>0}.values(),key=lambda x:x['time'])
        if len(candles)<2:raise ValueError('OHLCV unavailable')
        return {'candles':candles,'source':source,'sourceUrl':source_url,'updated':now(),'lastBar':candles[-1]['time'],'interval':'D','adjustment':'제공원 OHLCV 기준. 기업행사에 따라 제공원별 조정 방식이 다를 수 있습니다.'}
    data=cached('history:'+tv,int(os.getenv('HONGPICK_HISTORY_TTL','900')),load,'data-history-'+tv.replace(':','-')+'.json')
    if interval=='D':return data
    groups={}
    for c in data['candles']:
        date=datetime.fromisoformat(c['time']);key=date.strftime('%G-%V') if interval=='W' else date.strftime('%Y-%m')
        if key not in groups:groups[key]=dict(c)
        else:
            b=groups[key];b['high']=max(b['high'],c['high']);b['low']=min(b['low'],c['low']);b['close']=c['close'];b['volume']+=c['volume']
    return dict(data,candles=list(groups.values()),interval=interval)

def parse_cnn_fng(d, mirror=False):
    f=d['fear_and_greed'];value=finite(f.get('score'))
    stamp=datetime.fromisoformat(f['timestamp'].replace('Z','+00:00'))
    if value is None or not 0<=value<=100 or stamp.tzinfo is None or stamp>datetime.now(timezone.utc)+timedelta(minutes=5):
        raise ValueError('Invalid CNN score/timestamp')
    hist=[]
    for x in d.get('fear_and_greed_historical',{}).get('data',[]):
        v=finite(x.get('y'));date=datetime.fromtimestamp(x['x']/1000,timezone.utc).date().isoformat()
        if v is not None and 0<=v<=100 and date<=stamp.date().isoformat():hist.append({'date':date,'value':v})
    hist=sorted({x['date']:x for x in hist}.values(),key=lambda x:x['date'])
    result={'value':round(value),'classification':str(f['rating']).replace('_',' ').title(),'history':hist[-365:],
        'source':'CNN stock Fear & Greed'+(' · whit3rabbit 공개 수집본' if mirror else ' Index'),
        'sourceUrl':'https://www.cnn.com/markets/fear-and-greed','updated':stamp.isoformat(),'kind':'stock',
        'delivery':'public-mirror' if mirror else 'official','collectedAt':now(),
        'comparisons':{k:finite(f.get(k)) for k in ('previous_close','previous_1_week','previous_1_month','previous_1_year')}}
    if mirror:result['mirrorUrl']='https://github.com/whit3rabbit/fear-greed-data/blob/main/json/cnn_output.json'
    if datetime.now(timezone.utc)-stamp>timedelta(days=3):result.update(stale=True,notice='최근 갱신이 지연된 실제 CNN 데이터')
    return result

def fear_greed(kind='stock'):
    def load():
        if kind=='crypto':
            r=SESSION.get('https://api.alternative.me/fng/',params={'limit':365},timeout=12);r.raise_for_status();records=r.json()['data']
            return {'value':int(records[0]['value']),'classification':records[0]['value_classification'],'history':[{'date':datetime.fromtimestamp(int(x['timestamp']),timezone.utc).date().isoformat(),'value':int(x['value'])}for x in reversed(records)],'source':'Alternative.me Crypto Fear & Greed','sourceUrl':'https://alternative.me/crypto/fear-and-greed-index/','updated':datetime.fromtimestamp(int(records[0]['timestamp']),timezone.utc).isoformat(),'kind':kind}
        try:
            url=(os.getenv('CNN_FNG_URL') or 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata')
            r=SESSION.get(url,headers={'Accept':'application/json','Referer':'https://www.cnn.com/'},timeout=4);r.raise_for_status()
            return parse_cnn_fng(r.json())
        except (requests.RequestException,ValueError,KeyError,TypeError):
            r=SESSION.get('https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/json/cnn_output.json',timeout=10);r.raise_for_status()
            return parse_cnn_fng(r.json(),mirror=True)
    return cached('fng-v57:'+kind,1800,load,'data-fng-'+kind+'.json')

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


