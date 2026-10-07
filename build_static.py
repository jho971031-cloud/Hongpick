"""Export dated public data only; no API server is needed to serve the result."""
import argparse, json, os, shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import providers as p
import disclosures as d

BASE=Path(__file__).resolve().parent
ASSETS=('index.html','style.css','app.js','data-client.js','charts.js','lightweight-charts.js','LICENSE-lightweight-charts.txt','manifest.json','responsive-check.html')

def read(name):return json.loads((BASE/name).read_text())

def build(output,refresh=False,cache_dir=None):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    if refresh:
        os.environ['HONGPICK_SYNC_COLLECTION']='1'
        os.environ['HONGPICK_CACHE_DIR']=str(cache_dir or BASE/'.snapshot-cache')
        os.environ['HONGPICK_HISTORY_TTL']='21600'
    manifest={'version':'5.2','generatedAt':p.now(),'resources':{},'histories':{},'failures':[],
              'schedule':'시장 데이터 약 30분 · 일봉/13F 6시간 · 공시 목록 1시간. 예약 실행이 지연될 수 있습니다.'}
    def write(name,data):
        (output/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        return data
    def collect(key,loader,seed=None):
        try:data=loader() if refresh else read(seed)
        except Exception as error:
            manifest['failures'].append(key)
            if seed and (BASE/seed).exists():
                data=read(seed);data['stale']=True;data['notice']='제공원 연결 오류 · 마지막 수집 실제 데이터'
            else:data={'error':'데이터 없음 · 제공원 연결 오류','source':key}
        name='data-'+key+'.json';write(name,data);manifest['resources'][key]=name
        return data
    turns={m:collect('turnover-'+m,lambda m=m:p.turnover(m),'data-turnover-'+m+'.json') for m in ('kr','us')}
    for m in ('kr','us'):collect('directory-'+m,lambda m=m:p.directory(m),'data-directory-'+m+'.json')
    write('data-directory-crypto.json',{'rows':p.CRYPTO_ROWS,'source':'Yahoo Finance crypto USD identifiers','updated':p.now()});manifest['resources']['directory-crypto']='data-directory-crypto.json'
    write('data-aliases.json',p.ALIASES);manifest['resources']['aliases']='data-aliases.json'
    indexes=[collect('index-'+seed,lambda t=t,n=n,s=seed:p.index_quote(t,n,s),'data-index-'+seed+'.json') for t,n,seed in p.INDEXES]
    write('data-overview.json',{'rows':indexes});manifest['resources']['overview']='data-overview.json'
    collect('fng-crypto',lambda:p.fear_greed('crypto'),'data-fng-crypto.json')
    collect('fng-stock',lambda:p.fear_greed('stock'),'data-fng-stock.json')
    investors=[]
    for args in d.INVESTORS:
        investors.append(collect('guru-'+args[0],lambda args=args:d.investor(*args),'data-guru-'+args[0]+'.json'))
    gurus=d.summarize_gurus(investors)
    # This is the time of the underlying collection, not the export time.
    gurus['updated']=max((x.get('updated','') for x in investors),default=None)
    write('data-gurus.json',gurus);manifest['resources']['gurus']='data-gurus.json'
    catalog=collect('trump-catalog',d.oge_catalog,'data-trump-catalog.json')
    trump=d.format_trump(catalog,read('data-trump-transactions.json'))
    write('data-trump.json',trump);manifest['resources']['trump']='data-trump.json'
    selected={x['tv'] for data in turns.values() for x in data.get('rows',[])}
    selected.update(x['tv'] for inv in investors for x in inv.get('holdings',[])[:10] if x.get('tv'))
    selected.update(x['tv'] for x in trump.get('rows',[]) if x.get('tv'))
    selected.update(('KRX:005930','KRX:000660','NASDAQ:NVDA','NASDAQ:AAPL','NASDAQ:TSLA','NYSE:IBM','AMEX:SPY'))
    selected.update(('NYSE:GS','NASDAQ:RGTI'))
    coin_directory=collect('binance-directory',p.coins.directory,'data-binance-directory.json')
    coin_turnover=collect('binance-turnover',p.coins.tickers,'data-binance-turnover.json')
    selected.update(x['tv'] for x in coin_turnover.get('rows',[])[:50])
    selected.update(('BINANCE:BTCUSDT','BINANCE:ETHUSDT','BINANCE:SOLUSDT'))
    quotes={x['tv']:dict(x,source=data['source'],updated=data.get('updated'),stale=data.get('stale',False),method=data.get('method')) for data in turns.values() for x in data.get('rows',[])}
    if refresh:
        for market in ('kr','us'):
            missing=[tv for tv in selected if not tv.startswith(('CRYPTO:','BINANCE:')) and (tv.startswith('KRX:'))==(market=='kr') and tv not in quotes]
            if missing:
                try:
                    rows=p.scan(market,p.COLUMNS,missing,limit=len(missing))['data']
                    for row in rows:
                        x=p.item(row);quotes[x['tv']]=dict(x,source='TradingView Screener',updated=p.now(),method='지연 시세 · 현재가 × 거래량 추정값')
                except Exception:manifest['failures'].append('quotes-'+market)
    for x in coin_turnover.get('rows',[]):
        quotes[x['tv']]=dict(x,source=coin_turnover['source'],stale=coin_turnover.get('stale',False),method=coin_turnover['method'])
    write('data-quotes.json',{'quotes':quotes});manifest['resources']['quotes']='data-quotes.json'
    def history(tv):
        name='data-history-'+tv.replace(':','-')+'.json'
        if refresh:return tv,name,p.history(tv)
        if (BASE/name).exists():return tv,name,read(name)
        return tv,name,None
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs={pool.submit(history,tv):tv for tv in sorted(selected)}
        for job in as_completed(jobs):
            try:
                tv,name,data=job.result()
                if data and data.get('candles'):
                    write(name,data);manifest['histories'][tv]={'file':name,'updated':data.get('updated'),'lastBar':data.get('lastBar')}
            except Exception:manifest['failures'].append('history:'+jobs[job])
    for name in ASSETS:shutil.copy2(BASE/name,output/name)
    (output/'.nojekyll').touch()
    write('data-manifest.json',manifest)
    print(json.dumps({'output':str(output),'histories':len(manifest['histories']),'quotes':len(quotes),'failures':manifest['failures']},ensure_ascii=False))
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='public');parser.add_argument('--refresh',action='store_true');parser.add_argument('--cache-dir')
    args=parser.parse_args();build(args.output,args.refresh,args.cache_dir)


