import concurrent.futures,csv,datetime as dt,hashlib,io,json,pathlib,urllib.request,zipfile,time,shutil
p=pathlib.Path('tick-input');p.mkdir(exist_ok=True)
shutil.copy('source-reference/tick-input/charts-source.js',p/'charts-source.js')
shutil.copy('source-reference/tick-input/source-commit.txt',p/'source-commit.txt')
start=dt.datetime(2026,8,31,15,tzinfo=dt.timezone.utc);end=dt.datetime(2026,9,30,15,tzinfo=dt.timezone.utc);warm=start-dt.timedelta(days=12)
def fetch(url):
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=90) as f:return f.read()
  except Exception:
   if attempt==2:raise
   time.sleep(1)
def collect(task):
 kind,day=task;directory='klines' if kind=='futures' else 'markPriceKlines';lower=int((warm if kind=='futures' else start).timestamp());upper=int(end.timestamp())
 url=f'https://data.binance.vision/data/futures/um/daily/{directory}/BTCUSDT/1m/BTCUSDT-1m-{day}.zip'
 data=fetch(url);sha=hashlib.sha256(data).hexdigest();assert sha==fetch(url+'.CHECKSUM').decode().split()[0]
 rows=[]
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  names=[n for n in z.namelist() if n.endswith('.csv')];assert len(names)==1
  for x in csv.reader(io.StringIO(z.read(names[0]).decode('utf-8-sig'))):
   if not x or not x[0].isdigit():continue
   t=int(x[0])//1000
   if lower<=t<upper:
    o,h,l,c,v=map(float,x[1:6]);assert 0<l<=min(o,c)<=max(o,c)<=h and v>=0
    rows.append(dict(time=t,open=o,high=h,low=l,close=c,volume=v))
 print('Collected',kind,day,len(rows),flush=True)
 return kind,rows,dict(kind=kind,date=str(day),source=url,sha256=sha,rows=len(rows))
tasks=[]
for kind,first in [('futures',warm),('mark',start)]:
 day=first.date()
 while dt.datetime.combine(day,dt.time(0),dt.timezone.utc)<end:
  tasks.append((kind,day));day+=dt.timedelta(days=1)
series={'futures':[],'mark':[]};sources=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for kind,rows,info in pool.map(collect,tasks):series[kind].extend(rows);sources.append(info)
for kind,lower in [('futures',warm),('mark',start)]:
 rows=sorted(series[kind],key=lambda x:x['time']);assert len(rows)==int((end-lower).total_seconds()/60)
 assert rows[0]['time']==int(lower.timestamp()) and rows[-1]['time']==int(end.timestamp())-60
 assert all(b['time']-a['time']==60 for a,b in zip(rows,rows[1:]))
 series[kind]=rows;(p/(kind+'-1m.json')).write_text(json.dumps(rows,separators=(',',':')))
hourly=[];rows=series['futures']
for i in range(0,len(rows),60):
 g=rows[i:i+60];assert len(g)==60 and g[0]['time']%3600==0
 hourly.append(dict(time=g[0]['time'],open=g[0]['open'],high=max(x['high'] for x in g),low=min(x['low'] for x in g),close=g[-1]['close'],volume=sum(x['volume'] for x in g)))
assert len(hourly)==1008 and sum(x['time']<start.timestamp() for x in hourly)==288
(p/'futures-60m.json').write_text(json.dumps(hourly,separators=(',',':')))
manifest=dict(symbol='BTCUSDT',start_utc=start.isoformat(),end_utc_exclusive=end.isoformat(),warmup_start_utc=warm.isoformat(),timezone='Asia/Seoul',warmup_hours=288,period_hours=720,files=sources,coverage={'futures':len(series['futures']),'mark':len(series['mark']),'hourly':len(hourly)},collected_at_utc=dt.datetime.now(dt.timezone.utc).isoformat())
(p/'manifest.json').write_text(json.dumps(manifest,indent=2));print('BTC_INPUT_VERIFIED',json.dumps(manifest['coverage']))


quarter=[];rows=series['futures']
for i in range(0,len(rows),15):
 g=rows[i:i+15];assert len(g)==15 and g[0]['time']%900==0
 quarter.append(dict(time=g[0]['time'],open=g[0]['open'],high=max(x['high'] for x in g),low=min(x['low'] for x in g),close=g[-1]['close'],volume=sum(x['volume'] for x in g)))
assert len(quarter)==4032
(p/'futures-15m.json').write_text(json.dumps(quarter,separators=(',',':')))
# Confirm freshly collected overlapping bars against the prior verified BTC artifact.
for name in ['futures-1m','mark-1m','futures-60m']:
 old={x['time']:x for x in json.loads((pathlib.Path('source-reference/tick-input')/(name+'.json')).read_text())}
 new=json.loads((p/(name+'.json')).read_text());count=0
 for row in new:
  if row['time'] in old:
   assert all(abs(row[k]-old[row['time']][k])<1e-7 for k in ['open','high','low','close','volume']),('Historical data changed',name,row['time']);count+=1
 print('Original BTC bars matched',name,count,flush=True)
