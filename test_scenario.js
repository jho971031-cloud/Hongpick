const {test}=require('node:test'),assert=require('node:assert/strict'),{plan,completed}=require('./scenario');
const levels=[80,90,100,110,120].map((price,i)=>({price,ratio:i*.5}));
test('Long plan uses adjacent upper resistance and next support below the entry band',()=>{
 const p=plan({price:105,levels,units:2});assert.equal(p.exit.line.price,110);assert.deepEqual(p.stages.map(s=>s.line.price),[90,80]);assert.equal(p.stages[0].average,97.5);assert.equal(p.stages[0].quantity,4);assert.equal(p.stages[0].exit.line.price,100);assert.equal(p.stages[1].quantity,6);assert.equal(p.totalCost,550);assert.ok(Math.abs(p.boundaryPnl+70)<1e-9);
});
test('Averaging does not label a loss exit as profit; duplicates and ordering handled',()=>{
 const p=plan({price:119,levels:[...levels].reverse().concat(levels[0]),units:1});assert.equal(p.lines.length,5);assert.equal(p.stages.at(-1).exit.line.price,90);assert.ok(p.stages.at(-1).exit.pnl<0);
});
test('Outside-channel entry has no averaging or fictional take-profit',()=>{
 for(const price of [79,121]){const p=plan({price,levels});assert.equal(p.stages.length,0);assert.equal(p.exit,null)}assert.throws(()=>plan({price:0,levels}));assert.throws(()=>plan({price:100,levels,units:NaN}));
});
test('Entry exactly on support skips that already entered level',()=>{const p=plan({price:100,levels});assert.deepEqual(p.stages.map(x=>x.line.price),[90,80]);});
test('Indicators exclude forming daily/minute/weekly candles at collection time',()=>{
 const candles=['2026-10-12','2026-10-13'].map(time=>({time}));assert.equal(completed({candles,updated:'2026-10-13T02:00:00Z'},'D','KRX:TEST').length,1);assert.equal(completed({candles,updated:'2026-10-13T08:00:00Z'},'D','KRX:TEST').length,2);
 assert.equal(completed({candles,updated:'2026-10-13T08:00:00Z'},'D','BINANCE:BTCUSDT').length,1);
 assert.equal(completed({candles:[{time:'2026-10-12'}],updated:'2026-10-13T08:00:00Z'},'W','NASDAQ:TEST').length,0);
 const time=Date.parse('2026-10-13T08:00:00Z')/1000;assert.equal(completed({candles:[{time}],updated:'2026-10-13T08:02:00Z'},'5m','BINANCE:BTCUSDT').length,0);
});
