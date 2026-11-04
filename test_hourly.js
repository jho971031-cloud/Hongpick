const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const fixtures=JSON.parse(fs.readFileSync('test_hourly_fixtures.json','utf8'));
const box={window:{},console,Date,Math,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval,clearInterval};
vm.createContext(box);
vm.runInContext(fs.readFileSync('charts.js','utf8')+'\nthis.completed=completedReference;this.extend=channelExtension;this.ratios=channelRatios;',box);
const indicator=box.window.HongIndicators;
for(const [name,frame] of [['BTCUSDT-1h','1h'],['ETHUSDT-4h','4h']]){
 const bars=fixtures[name].candles,last=bars.at(-1),before=JSON.stringify(bars);
 assert.equal(bars.length,240);const candidate=indicator.fibonacci(bars,'high',{interval:frame,currentPrice:last.close});
 assert(candidate,`${name} must detect the known public-data channel`);
 assert(candidate.anchors.every(a=>a.price===bars[a.index].high),'Anchors use real high prices');
 assert(candidate.a<candidate.b&&candidate.b<candidate.c,'Three anchors stay in chronological order');
 assert.equal(JSON.stringify(bars),before,'Input candles remain unchanged');
 const seconds=frame==='1h'?3600:14400,future=box.extend([last],frame,2,true);
 assert.equal(future[1].time-last.time,seconds);assert.equal(future[2].time-last.time,seconds*2);
 const ichi=indicator.ichimoku(bars,frame,true);assert.equal(ichi.spanA.at(-1).time-last.time,26*seconds);
 const current=last.time+seconds*1.5,data={candles:[last,{...last,time:last.time+seconds}],updated:new Date(current*1000).toISOString(),formingTime:last.time+seconds};
 assert.equal(box.completed(data,frame).candles.length,1,'Incomplete hour candle is not an anchor');
}
assert.deepEqual(Array.from(box.ratios({fibExtras:new Set()})),[0,1,2]);
box.HongIndicators=indicator;box.HongLevels={read:()=>({})};let loaded=[];
const chart=new box.window.HongChart({},{});chart.load=()=>loaded.push(chart.interval);
for(const frame of ['1h','4h']){chart.commitFibSettings({enabled:true,mode:'high',frame});assert.equal(chart.options.fibFrame,frame);assert.equal(chart.interval,frame);}
assert.deepEqual(loaded,['1h','4h'],'Selecting a new channel frame immediately loads that timeframe');
const shortcut=new box.window.HongChart({},{});shortcut.toggleSettings=(tool,frame)=>{shortcut.panelDraft={frame,mode:'high',enabled:false}};shortcut.load=()=>{};shortcut.fibMenu('4h');assert.equal(shortcut.options.fib,'high');assert.equal(shortcut.interval,'4h','One shortcut click enables and loads the selected channel');
const urls=[];let fallback=false;
const ts=Math.floor(Date.now()/14400000)*14400000;
const raw=[[ts-14400000,'10','12','9','11','100',ts-1],[ts,'11','13','10','12','120',ts+14399999]];
const client={window:{},location:{href:'https://user.github.io/Hongpick/',hostname:'user.github.io',origin:'https://user.github.io'},localStorage:{getItem:()=>fallback?'on':'off',setItem(_k,v){fallback=v==='on'}},URL,URLSearchParams,AbortController,Date,Math,setTimeout,clearTimeout,console,fetch:async u=>{const url=new URL(u);urls.push(url);return {ok:true,headers:{get:()=> 'application/json'},json:async()=>url.hostname==='data-api.binance.vision'?raw:{candles:[],interval:url.searchParams.get('interval')}}}};
vm.createContext(client);vm.runInContext(fs.readFileSync('data-client.js','utf8'),client);
(async()=>{
 for(const frame of ['1h','4h']){const d=await client.window.HongData.api('/api/history?symbol=BINANCE%3ABTCUSDT&interval='+frame);assert.equal(d.interval,frame);assert.equal(typeof d.candles[0].time,'number');assert.equal(urls.at(-1).searchParams.get('interval'),frame);assert.equal(urls.at(-1).hostname,'data-api.binance.vision');}
 await assert.rejects(client.window.HongData.api('/api/history?symbol=NASDAQ%3AAAPL&interval=1h'),/API 보완/);
 client.window.HongData.setFallback(true);await client.window.HongData.api('/api/history?symbol=NASDAQ%3AAAPL&interval=4h');assert.equal(urls.at(-1).pathname,'/api/intraday');assert.equal(urls.at(-1).searchParams.get('interval'),'4h');
 const listeners={},live={window:{addEventListener(){}},document:{addEventListener(n,f){listeners[n]=f}},navigator:{onLine:true},Date,Math,console,setTimeout,clearTimeout,setInterval,clearInterval};vm.createContext(live);vm.runInContext(fs.readFileSync('live-data.js','utf8'),live);
 for(const frame of ['1h','4h']){const e={e:'kline',E:Date.now(),k:{s:'BTCUSDT',i:frame,t:ts,o:'10',h:'12',l:'9',c:'11',v:'1',x:false}},row=live.window.HongLive.candle(e,frame);assert.equal(row.row.time,ts/1000);assert.equal(typeof row.row.time,'number');}
 console.log('PASS: 1h/4h actual Binance anchors, completed bars, geometry, live candle times, channel controls and data routing');
})().catch(e=>{console.error(e);process.exitCode=1});
