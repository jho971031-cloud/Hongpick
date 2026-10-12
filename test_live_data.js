const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const listeners={},timers=new Map(),sockets=[];let id=0;
class Socket {constructor(url){this.url=url;sockets.push(this)}close(){this.closed=true}message(data){this.onmessage?.({data:JSON.stringify({data})})}}
const context={window:{addEventListener:(name,fn)=>listeners[name]=fn},document:{hidden:false,addEventListener:(name,fn)=>listeners[name]=fn},navigator:{onLine:true},WebSocket:Socket,Date,Math,console,setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:i=>timers.delete(i),setInterval:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearInterval:i=>timers.delete(i)};
vm.createContext(context);vm.runInContext(fs.readFileSync('live-data.js','utf8'),context);const live=context.window.HongLive;
const tick={e:'24hrTicker',s:'BTCUSDT',c:'90000',P:'-2.5',q:'123456789',E:Date.now()};
assert.equal(live.ticker(tick).turnover,123456789);assert.equal(live.ticker({...tick,E:Date.now()-120000}),null);assert.equal(live.ticker({...tick,c:'NaN'}),null);assert.equal(live.ticker({...tick,s:'BTCBUSD'}),null);
assert.equal(live.ticker({...tick,e:'24hrMiniTicker',c:'110',o:'100',P:undefined}).change.toFixed(2),'10.00');
assert.equal(live.ticker({...tick,e:'24hrMiniTicker',o:'0',P:undefined}),null);
const event={e:'kline',E:Date.now(),k:{s:'BTCUSDT',i:'5m',t:Math.floor(Date.now()/300000)*300000,o:'100',h:'110',l:'90',c:'105',v:'4',x:false}};
assert.equal(live.candle(event,'5m').row.volume,4);assert.equal(live.candle(event,'15m'),null);assert.equal(live.candle({...event,k:{...event.k,l:'109'}},'5m'),null);
let messages=0;const states=[];const client=live.subscribe(['btcusdt@ticker'],()=>messages++,s=>states.push(s.mode));
assert.equal(states.at(-1),'connecting');assert.ok(sockets[0].url.startsWith('wss://data-stream.binance.vision/'));
sockets[0].message(tick);assert.equal(messages,1);assert.equal(states.at(-1),'receiving');
context.document.hidden=true;listeners.visibilitychange();assert.ok(sockets[0].closed);assert.equal(states.at(-1),'paused');assert.equal(timers.size,0);
context.document.hidden=false;listeners.visibilitychange();assert.equal(sockets.length,2);
sockets[1].onerror();assert.equal(states.at(-1),'reconnecting');const retry=[...timers.values()].find(x=>x.ms<2000);assert.ok(retry);retry.fn();assert.equal(sockets.length,3);
client.close();assert.equal(timers.size,0);listeners.online();assert.equal(sockets.length,3);
// The chart must update only its own symbol, frame and current load generation.
let callback;context.HongLive=context.window.HongLive={...live,subscribe:(s,data)=>{callback=data;return{close(){}}}};
vm.runInContext(fs.readFileSync('charts.js','utf8'),context);const Chart=context.window.HongChart,c=new Chart({},{}),updates=[];
c.item={tv:'BINANCE:BTCUSDT'};c.interval='5m';c.chart={};c.data={nativeBinance:true,candles:[{time:event.k.t/1000,open:100,high:110,low:90,close:100,volume:1}]};c.candles={update:r=>updates.push(r)};c.volume={update(){}};let controlsRendered=0;c.renderControls=()=>controlsRendered++;c.applyIndicators=()=>{};c.startLive();
callback(event);assert.equal(c.data.candles.length,1);assert.equal(c.data.candles[0].close,105);assert.equal(updates.length,1);assert.equal(controlsRendered,0,'stream updates must not replace clickable controls');
callback({...event,k:{...event.k,s:'ETHUSDT'}});assert.equal(updates.length,1);
callback({...event,k:{...event.k,t:event.k.t-300000}});assert.equal(updates.length,1);
c.stopLive();callback(event);assert.equal(updates.length,1);assert.equal(timers.size,0);
console.log('PASS: real-event validation, pause/resume, reconnect/dispose, no stale/wrong-symbol/wrong-frame candle updates.');
// Keep the same indicator series, cloud primitives and RSI pane on live ticks.
let logical={from:15.25,to:75.25},timeRange={from:100,to:200},added=0,removed=0,attached=0,detached=0,priceLines=0,paneChanges=0,markerSets=0,restores=0;
const scale={getVisibleLogicalRange:()=>({...logical}),setVisibleLogicalRange:r=>{logical={...r};restores++},getVisibleRange:()=>({...timeRange}),setVisibleRange:r=>{timeRange={...r};restores++}};
const fakeChart={timeScale:()=>scale,addSeries(){added++;return{setData(){logical={from:logical.from+1,to:logical.to+1}},priceScale:()=>({applyOptions(){}}),applyOptions(){},createPriceLine(){priceLines++}}},removeSeries(){removed++},panes:()=>[{setStretchFactor(){paneChanges++}},{setStretchFactor(){paneChanges++}}]};
context.LightweightCharts={LineSeries:{},PriceScaleMode:{Normal:0},createSeriesMarkers:(series,markers)=>({setMarkers(){markerSets++}})};
context.HongIndicators=context.window.HongIndicators;context.formatDate=x=>x;context.escapeHtml=x=>x;
const stable=new Chart({},{}),bars=Array.from({length:90},(_,i)=>({time:Math.floor(Date.now()/300000)*300-90*300+i*300,open:100+i*.1,high:102+i*.1,low:98+i*.1,close:101+i*.1,volume:100}));
stable.chart=fakeChart;stable.candles={attachPrimitive(p){attached++;p.attached({chart:fakeChart,series:this,requestUpdate(){}})},detachPrimitive(){detached++}};
stable.item={tv:'BINANCE:BTCUSDT',type:'crypto'};stable.interval='5m';stable.data={candles:bars};stable.referenceData={candles:bars};stable.options={ma:new Set([20,60]),rsi:true,ichi:true,fib:'high',fibFrame:'5m'};stable.fibBasis='5m';stable.selectedCandidate={anchors:[{time:bars[10].time,price:100,point:1},{time:bars[30].time,price:90,point:2},{time:bars[65].time,price:120,point:3}],turn:45};stable.renderControls=()=>{};
stable.applyIndicators();const identities=stable.series.slice(),cloud=stable.cloud,bands=stable.fibCloud;logical={from:15.25,to:75.25};
for(let tick=0;tick<3;tick++){bars.at(-1).close+=.01;stable.preserveViewport(()=>stable.applyIndicators(true));assert.equal(JSON.stringify(logical),JSON.stringify({from:15.25,to:75.25}));}
assert.equal(added,identities.length);assert.equal(removed,0);assert.equal(attached,2);assert.equal(detached,0);assert.equal(priceLines,2);assert.equal(paneChanges,2);assert.equal(stable.cloud,cloud);assert.equal(stable.fibCloud,bands);assert.ok(stable.series.every((s,i)=>s===identities[i]));assert.equal(markerSets,3);assert.equal(restores,3);
stable.preserveViewport(()=>{timeRange={from:150,to:250}},true);assert.equal(JSON.stringify(timeRange),JSON.stringify({from:100,to:200}));
console.log('PASS: live indicators reuse series/panes/primitives and retain zoom/time range across ticks and resync.');
