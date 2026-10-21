import csv,datetime as dt,hashlib,io,json,pathlib,subprocess,urllib.request,zipfile,time
out=pathlib.Path('tick-output');out.mkdir(exist_ok=True)
sources=[]
def fetch(url):
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=120) as r:return r.read()
  except Exception:
   if attempt==2:raise
   time.sleep(2)
proc=subprocess.Popen(['node','replay.cjs'],stdin=subprocess.PIPE,text=True,bufsize=1024*1024)
try:
 for i in range(31):
  day=dt.date(2026,8,31)+dt.timedelta(days=i)
  url=f'https://data.binance.vision/data/futures/um/daily/trades/BTCUSDT/BTCUSDT-trades-{day}.zip'
  print('Downloading raw trades',day,flush=True)
  data=fetch(url);sha=hashlib.sha256(data).hexdigest();expected=fetch(url+'.CHECKSUM').decode().split()[0]
  assert sha==expected,'SHA256 mismatch'
  count=0
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   names=[n for n in z.namelist() if n.endswith('.csv')];assert len(names)==1
   with z.open(names[0]) as f:
    for row in csv.reader(io.TextIOWrapper(f)):
     if not row or not row[0].isdigit():continue
     # Raw USDT futures trades: id, price, qty, quote_qty, time, is_buyer_maker.
     stamp=int(row[4]);stamp=stamp//1000 if stamp>10**14 else stamp
     if 1788188400000<=stamp<1790780400000:
      proc.stdin.write(f'{row[0]},{stamp},{row[1]},{row[2]}\n');count+=1
  sources.append({'day':str(day),'url':url,'sha256':sha,'zip_bytes':len(data),'selected_trades':count})
  (out/'raw-sources.json').write_text(json.dumps(sources,indent=2))
  print('Processed',day,count,'trades',len(data),'ZIP bytes',flush=True)
  del data
 proc.stdin.close();code=proc.wait();assert code==0,f'Replay exited {code}'
except BaseException:
 proc.kill();proc.wait();raise
