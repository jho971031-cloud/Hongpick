(()=>{
 const original=HongData.api.bind(HongData);
 HongData.api=async path=>{
  const url=new URL(path,location.origin);
  if(url.pathname!=='/api/fib-history'||!HongData.staticMode)return original(path);
  const tv=url.searchParams.get('symbol');let cause;
  try{const m=await HongData.manifest(),record=m.fibHistories?.[tv];if(record){const r=await fetch(HongData.asset(record.file),{cache:'no-store'});if(!r.ok)throw Error('주봉 스냅샷을 불러오지 못했습니다.');return await r.json()}}catch(e){cause=e}
  if(HongData.fallback){const r=await fetch('https://hongpick.onrender.com/api/fib-history?symbol='+encodeURIComponent(tv));const d=await r.json();if(!r.ok)throw Error(d.error||'자동 작도용 주봉 데이터 없음');return d}
  throw cause||Error('자동 작도용 10년 주봉 데이터가 아직 수집되지 않았습니다.');
 };
 const style=document.createElement('style');style.textContent='.fib-mode-list{display:grid;gap:8px;margin:18px 0}.fib-mode-list button{display:flex;flex-direction:column;gap:5px;text-align:left;padding:13px;border:1px solid #244258;border-radius:11px;background:#07131f}.fib-mode-list button:hover,.fib-mode-list button:focus-visible{border-color:#16d79b;background:#0d2933}.fib-mode-list b{font-size:13px}.fib-mode-list span{color:#8194a7;font-size:10px;line-height:1.5}.fib-status{color:#77d8bc}';document.head.append(style);
})();
