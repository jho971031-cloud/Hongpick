(()=>{
 const original=HongData.api.bind(HongData);
 HongData.api=async path=>{
  const url=new URL(path,location.origin);
  if(url.pathname==='/api/history'&&['1m','5m','15m'].includes(url.searchParams.get('interval'))){
   const tv=url.searchParams.get('symbol'),interval=url.searchParams.get('interval');let data;
   if(HongData.staticMode){try{const m=await HongData.manifest(),record=m.intradayHistories?.[tv];if(record){const r=await fetch(HongData.asset(record.file),{cache:'no-store'});if(r.ok)data=await r.json()}}catch{}}
   if(!data&&tv.startsWith('BINANCE:')&&HongData.fallback)data=await HongData.binanceBars(tv,'1m');
   if(!data){if(HongData.staticMode&&!HongData.fallback)throw Error('해당 종목 분봉 데이터 없음 · 다음 수집을 기다리거나 API 보완을 켜 주세요.');const base=HongData.staticMode?'https://hongpick.onrender.com':location.origin,r=await fetch(base+'/api/intraday?symbol='+encodeURIComponent(tv));data=await r.json();if(!r.ok)throw Error(data.error||'분봉 데이터 없음')}
   const seconds=parseInt(interval)*60,groups=new Map();for(const c of data.candles){const time=Math.floor(c.time/seconds)*seconds,old=groups.get(time);if(!old)groups.set(time,{...c,time});else{old.high=Math.max(old.high,c.high);old.low=Math.min(old.low,c.low);old.close=c.close;old.volume+=c.volume}}
   return {...data,candles:[...groups.values()],interval};
  }
  if(url.pathname!=='/api/fib-history'||!HongData.staticMode)return original(path);
  const tv=url.searchParams.get('symbol');let cause;
  try{const m=await HongData.manifest(),record=m.fibHistories?.[tv];if(record){const r=await fetch(HongData.asset(record.file),{cache:'no-store'});if(!r.ok)throw Error('주봉 스냅샷을 불러오지 못했습니다.');return await r.json()}}catch(e){cause=e}
  if(HongData.fallback){if(tv.startsWith('BINANCE:'))return HongData.binanceBars(tv,'W');const r=await fetch('https://hongpick.onrender.com/api/fib-history?symbol='+encodeURIComponent(tv));const d=await r.json();if(!r.ok)throw Error(d.error||'자동 작도용 주봉 데이터 없음');return d}
  throw cause||Error('자동 작도용 10년 주봉 데이터가 아직 수집되지 않았습니다.');
 };
 const style=document.createElement('style');style.textContent='.fib-mode-list{display:grid;gap:8px;margin:18px 0}.fib-mode-list button{display:flex;flex-direction:column;gap:5px;text-align:left;padding:13px;border:1px solid #244258;border-radius:11px;background:#07131f}.fib-mode-list button:hover,.fib-mode-list button:focus-visible{border-color:#16d79b;background:#0d2933}.fib-mode-list b{font-size:13px}.fib-mode-list span{color:#8194a7;font-size:10px;line-height:1.5}.fib-status{color:#77d8bc}';document.head.append(style);
})();

