/* Shared transport: static snapshots first, single-flight requests, daily bars reused. */
window.HongData=(()=>{
 const base=new URL('./',location.href),staticMode=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).get('mode')==='static';
 const apiBase=staticMode?'https://hongpick.onrender.com':location.origin;
 const entries=new Map(),pending=new Map();let revision=null;
 let fallback=true;try{fallback=localStorage.getItem('hongpick.apiFallback')!=='off'}catch{}
 const normalize=q=>q.toLowerCase().replace(/[\s.,&\-]/g,'');
 function setFallback(value){fallback=!!value;try{localStorage.setItem('hongpick.apiFallback',fallback?'on':'off')}catch{}clear()}
 function clear(){entries.clear();revision=null}
 async function json(url,ttl=300000){
  const key=String(url),old=entries.get(key);if(old&&old.expires>Date.now())return old.data;
  if(pending.has(key))return pending.get(key);
  const job=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),staticMode&&!key.startsWith(apiBase)?20000:90000);
   try{const response=await fetch(url,{signal:controller.signal,cache:'no-cache'});if(!response.headers.get('content-type')?.includes('application/json'))throw Error('데이터 파일을 불러오지 못했습니다.');const data=await response.json();if(!response.ok||data.error&&!data.results)throw Error(data.error||'데이터 없음');entries.set(key,{expires:Date.now()+ttl,data});return data}
   catch(error){if(error.name==='AbortError')throw Error('제공원 응답이 늦어지고 있습니다. 잠시 후 새로고침해 주세요.');throw error}
   finally{clearTimeout(timer)}
  })();pending.set(key,job);try{return await job}finally{pending.delete(key)}
 }
 async function manifest(){const d=await json(new URL('data-manifest.json',base));revision=d.generatedAt;return d}
 async function file(name){const url=new URL(name,base);if(revision)url.searchParams.set('v',revision);return json(url)}
 async function resource(key){const m=await manifest();if(!m.resources[key])throw Error('데이터 없음');return file(m.resources[key])}
 async function search(q){
  const aliases=await resource('aliases'),alias=aliases[q.toLowerCase()],query=normalize(alias||q.split(':').at(-1)),nq=normalize(q);
  const markets=alias?[/^\d+$/.test(alias)?'kr':'us']:/[가-힣]/.test(q)||/^\d+$/.test(q)?['kr']:['us','kr'];
  const results=[],errors=[];
  await Promise.all(markets.map(async market=>{try{const d=await resource('directory-'+market);for(const x of d.rows){const ticker=normalize(x.ticker),name=normalize(x.name);let score;if(query===ticker)score=0;else if(nq===name)score=1;else if(ticker.startsWith(query))score=2;else if(name.includes(nq))score=3;else if(ticker.includes(query))score=4;else continue;results.push({score,x})}}catch{errors.push(market)}}));
  results.sort((a,b)=>a.score-b.score||a.x.name.length-b.x.name.length||a.x.tv.localeCompare(b.x.tv));
  if(!results.length&&fallback)return json(new URL('/api/search?q='+encodeURIComponent(q),apiBase));
  return {results:results.slice(0,20).map(v=>v.x),source:'TradingView symbol directory / Korean name aliases',error:errors.length?'일부 종목 목록 데이터 없음':null};
 }
 function aggregate(data,interval){
  if(interval==='D')return data;if(!['W','M'].includes(interval))throw Error('지원하지 않는 주기');const groups=new Map();
  for(const c of data.candles){const date=new Date(c.time+'T00:00:00Z');if(interval==='W')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);const key=interval==='M'?c.time.slice(0,7):date.toISOString().slice(0,10),old=groups.get(key);if(!old)groups.set(key,{...c});else{old.high=Math.max(old.high,c.high);old.low=Math.min(old.low,c.low);old.close=c.close;old.volume+=c.volume}}
  return {...data,candles:[...groups.values()],interval};
 }
 // Store at most 20 recent real histories. Dates/source remain unchanged when reused.
 function db(){return new Promise(resolve=>{if(!window.indexedDB){resolve(null);return}const request=indexedDB.open('hongpick.history.v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('histories',{keyPath:'tv'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null)})}
 async function saved(tv,data){try{const database=await db();if(!database)return null;return await new Promise(resolve=>{const tx=database.transaction('histories',data?'readwrite':'readonly'),store=tx.objectStore('histories');if(data){store.put({tv,data,used:Date.now()});const all=store.getAll();all.onsuccess=()=>all.result.sort((a,b)=>b.used-a.used).slice(20).forEach(x=>store.delete(x.tv));tx.oncomplete=()=>{database.close();resolve(data)}}else{const get=store.get(tv);get.onsuccess=()=>resolve(get.result?.data||null);tx.oncomplete=()=>database.close()}tx.onerror=()=>{database.close();resolve(null)}})}catch{return null}}
 async function daily(tv){
  let staticError;
  try{const m=await manifest(),record=m.histories[tv];if(record)return await file(record.file)}catch(error){staticError=error}
  if(fallback){try{const d=await json(new URL('/api/history?symbol='+encodeURIComponent(tv)+'&interval=D',apiBase));await saved(tv,d);return d}catch(error){const prior=await saved(tv);if(prior)return {...prior,stale:true,notice:'이 브라우저에 저장된 마지막 실제 일봉'};throw error}}
  const prior=await saved(tv);if(prior)return {...prior,stale:true,notice:'이 브라우저에 저장된 마지막 실제 일봉'};
  throw staticError||Error('아직 수집하지 않은 종목입니다. 미수집 종목 API 보완을 켜거나 다음 수집을 기다려 주세요.');
 }
 async function api(path){
  const url=new URL(path,location.origin),route=url.pathname.slice(5),q=url.searchParams;
  if(!staticMode){if(route==='history'){const dailyPath='/api/history?symbol='+encodeURIComponent(q.get('symbol'))+'&interval=D';return aggregate(await json(new URL(dailyPath,apiBase),900000),q.get('interval')||'D')}return json(new URL(path,apiBase),['gurus','trump'].includes(route)?3600000:90000)}
  if(route==='search')return search(q.get('q')||'');
  if(route==='history')return aggregate(await daily(q.get('symbol')),q.get('interval')||'D');
  if(route==='stock'){const d=await resource('quotes'),quote=d.quotes[q.get('symbol')];if(quote)return quote;if(fallback)return json(new URL(path,apiBase),90000);throw Error('해당 종목 시세 데이터 없음 · 미수집 종목 API 보완이 꺼져 있습니다.')}
  if(route==='disclosure-performance'){const d=await daily(q.get('symbol')),rows=d.candles.filter(x=>x.time>=q.get('date'));if(rows.length<2)throw Error('공개 이후 가격 데이터 없음');return {change:(rows.at(-1).close/rows[0].close-1)*100,baselineDate:rows[0].time,baseline:rows[0].close,latestDate:rows.at(-1).time,latest:rows.at(-1).close,source:d.source}}
  const key=route==='turnover'?'turnover-'+q.get('market'):route==='fng'?'fng-'+(q.get('kind')||'stock'):route;
  return resource(key);
 }
 function asset(name){return new URL(name,base).href}
 return {api,clear,aggregate,asset,staticMode,setFallback,get fallback(){return fallback},manifest};
})();
