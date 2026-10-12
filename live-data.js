/* Public Binance Spot market streams. No account, secrets or order endpoints. */
window.HongLive=(()=>{
 const frame={D:'1d',W:'1w',M:'1M','1m':'1m','5m':'5m','15m':'15m'};
 const clients=new Set();
 function ticker(x){
  if(!['24hrTicker','24hrMiniTicker'].includes(x?.e)||!String(x.s).endsWith('USDT'))return null;
  const price=Number(x.c),change=x.e==='24hrMiniTicker'&&Number(x.o)>0?(Number(x.c)/Number(x.o)-1)*100:Number(x.P),turnover=Number(x.q),event=Number(x.E);
  if(![price,change,turnover,event].every(Number.isFinite)||price<=0||turnover<0||Math.abs(Date.now()-event)>60000)return null;
  return {ticker:x.s,tv:'BINANCE:'+x.s,price,change,turnover,updated:new Date(event).toISOString(),receivedAt:Date.now(),currency:'USDT',source:'Binance Spot WebSocket',live:true};
 }
 function candle(x,interval){
  const k=x?.k;if(x?.e!=='kline'||k?.i!==frame[interval]||!k.s?.endsWith('USDT')||Math.abs(Date.now()-Number(x.E))>60000)return null;
  const row={time:interval.endsWith('m')?Math.floor(k.t/1000):new Date(k.t).toISOString().slice(0,10),open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c),volume:Number(k.v)};
  if(![row.open,row.high,row.low,row.close,row.volume].every(Number.isFinite)||row.low<=0||row.volume<0||row.high<Math.max(row.open,row.close,row.low)||row.low>Math.min(row.open,row.close))return null;
  return {row,closed:k.x===true,updated:new Date(x.E).toISOString(),symbol:k.s};
 }
 function subscribe(streams,onData,onStatus=()=>{}){
  let socket=null,timer=null,watchdog=null,disposed=false,attempt=0,last=0;
  const status=mode=>onStatus({mode,lastReceived:last?new Date(last).toISOString():null});
  function stop(){clearTimeout(timer);clearInterval(watchdog);timer=watchdog=null;if(socket){const old=socket;socket=null;old.onclose=old.onerror=old.onmessage=null;old.close()}}
  function retry(){if(disposed||document.hidden||navigator.onLine===false)return;status('reconnecting');timer=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempt++,5))+Math.random()*500)}
  function connect(){stop();if(disposed||document.hidden||navigator.onLine===false){status('paused');return}last=0;status('connecting');
   try{socket=new WebSocket('wss://data-stream.binance.vision/stream?streams='+streams.join('/'));const current=socket;
    socket.onmessage=event=>{if(socket!==current)return;try{const packet=JSON.parse(event.data);if(packet.data?.e==='serverShutdown'){stop();retry();return}last=Date.now();attempt=0;onData(packet.data);status('receiving')}catch{}};
    socket.onerror=()=>{if(socket===current){stop();retry()}};socket.onclose=()=>{if(socket===current){stop();retry()}};
    const started=Date.now();watchdog=setInterval(()=>{if(Date.now()-(last||started)>20000){stop();retry()}},5000);
   }catch{retry()}
  }
  const client={resume:connect,pause:()=>{stop();status('paused')},close:()=>{disposed=true;stop();clients.delete(client)}};clients.add(client);connect();return client;
 }
 document.addEventListener('visibilitychange',()=>clients.forEach(c=>document.hidden?c.pause():c.resume()));
 window.addEventListener('offline',()=>clients.forEach(c=>c.pause()));window.addEventListener('online',()=>clients.forEach(c=>c.resume()));
 return {subscribe,ticker,candle,frame};
})();
