/* Weekly display scale must use real major anchors without changing signal/scalp rules. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const box={window:{},formatDate:x=>x,escapeHtml:x=>x,setTimeout,clearTimeout};vm.createContext(box);
vm.runInContext(fs.readFileSync('charts.js','utf8')+'\nthis.project=channelProjection;this.seconds=chartSeconds;this.extend=channelExtension;',box);
const indicators=box.window.HongIndicators;
assert.equal(box.seconds({year:2026,month:11,day:2}),box.seconds('2026-11-02'));
assert.equal(box.extend([{time:{year:2026,month:11,day:2}}],'W',2,true).at(-1).time,'2026-11-16');
const turns=[[0,130],[38,170],[44,185],[60,200],[82,100],[100,115],[115,90],[140,145],[157,85],[170,149],[182,170],[210,240],[225,180],[260,190],[299,185]];
const bars=Array.from({length:300},(_,i)=>{const next=turns.findIndex(p=>p[0]>=i),right=turns[next],left=turns[Math.max(0,next-1)],close=left[0]===right[0]?right[1]:left[1]+(right[1]-left[1])*(i-left[0])/(right[0]-left[0]);return {time:new Date(Date.UTC(2020,0,6)+i*7*86400000).toISOString().slice(0,10),open:close*.99,high:close*1.02,low:close*.95,close,volume:100};});
const original=JSON.stringify(bars),large=indicators.fibonacci(bars,'high',{interval:'W',scale:'major',currentPrice:bars.at(-1).close});
assert(large,'The multi-year structure must produce a channel');assert.equal(large.scale,'major');
assert(large.b-large.a>=52);assert(large.c-large.a>=104);assert(large.zone.to-large.zone.from>=13);
assert.equal(large.a,60);assert.equal(large.b,140);assert.equal(large.c,210);
for(const a of large.anchors)assert.equal(a.price,bars[a.index].high,'Anchor prices must stay on actual highs');
const at=box.project(large,bars);assert(Math.abs(at(large.a,0)-bars[large.a].high)<1e-8);assert(Math.abs(at(large.b,0)-bars[large.b].high)<1e-8);assert(Math.abs(at(large.c,1)-bars[large.c].high)<1e-8);
const inverted=bars.map(x=>({...x,open:1/x.open,high:1/x.low,low:1/x.high,close:1/x.close}));
const low=indicators.fibonacci(inverted,'low',{interval:'W',scale:'major',currentPrice:inverted.at(-1).close});
assert(low);assert.equal(low.a,large.a);assert.equal(low.b,large.b);assert.equal(low.c,large.c);assert(low.width<0);assert(low.zone.floor<low.zone.ceiling);
for(const a of low.anchors)assert.equal(a.price,inverted[a.index].low);
for(const interval of ['D','M','5m','15m']){
 const plain=indicators.fibonacci(bars,'high',{interval}),withScale=indicators.fibonacci(bars,'high',{interval,scale:'major'});
 assert.equal(JSON.stringify(withScale),JSON.stringify(plain),'Weekly scale must not alter '+interval);
}
assert.equal(JSON.stringify(bars),original,'Input bars must remain unchanged');
assert(!indicators.fibonacci(bars,'high',{interval:'W'})?.scale,'Existing scans keep the original scale unless the chart asks for major');
(async()=>{
 const calls=[],originalFib=indicators.fibonacci;
 indicators.fibonacci=function(candles,mode,settings){calls.push(settings);return originalFib.call(this,candles,mode,settings)};
 box.HongIndicators=indicators;box.HongLevels={read:()=>({})};box.api=async()=>({candles:bars,updated:new Date().toISOString(),source:'Synthetic geometry fixture'});
 const chart=new box.window.HongChart({},{});chart.draw=()=>{};chart.renderControls=()=>{};chart.options.fib='high';chart.options.fibFrame='W';chart.interval='W';
 await chart.load({tv:'NASDAQ:FIXTURE'});assert.equal(calls.at(-1).scale,'major');assert.equal(chart.selectedCandidate.scale,'major');
 chart.channelSelection=null;chart.options.fibFrame='D';chart.interval='D';await chart.load({tv:'NASDAQ:FIXTURE'});assert.equal(calls.at(-1).scale,undefined);
 console.log('PASS: major weekly base/span, actual anchors/projection, low-direction symmetry, unchanged other frames/scan defaults, weekly chart wiring');
})().catch(error=>{console.error(error);process.exitCode=1});
