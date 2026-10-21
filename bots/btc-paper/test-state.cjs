const assert=require('node:assert/strict');
const {create,completed,quote,stringify,parse}=require('./bot.cjs');
function setup(ctx){for(const [frame,price] of [[900,100],[3600,97.5]])ctx.signals[frame].set(0,{rsi:20,channels:[{origin:price,epoch:0,slope:0,width:0,frameSeconds:frame,score:1,anchors:[]}]});}
function feed(ctx,prices,start){prices.forEach((price,i)=>{const q={id:start+i,time:start+i,price,bid:price,ask:price,mark:price};ctx.engine.setMark(q);ctx.engine.onTick(q);});}
const a=create();setup(a);feed(a,[101,99,98],1);
const saved=parse(stringify(a.engine.snapshot())),b=create();b.engine.restore(saved);setup(b);
feed(a,[97,96.9,99,99.1],4);feed(b,[97,96.9,99,99.1],4);
assert.equal(stringify(a.engine.snapshot()),stringify(b.engine.snapshot()),'Restart must preserve pending orders, positions and PnL');
assert.equal(a.engine.snapshot().positions.length,0);
assert.throws(()=>quote({ts:'1',lastPr:'100',bidPr:'99',askPr:'101',markPrice:'100'},Date.now()),/Stale/);
const rows=Array.from({length:290},(_,i)=>[i*900000,100,101,99,i===289?999999:100,1]);
const bars=completed(rows,900,289*900);assert.equal(bars.length,289);assert.equal(bars.at(-1).close,100,'Unclosed candle must not enter the signal');
assert.throws(()=>completed(rows.filter((_,i)=>i!==100),900,289*900),/gapped/);
const paused=create();setup(paused);feed(paused,[101,99,98],1);paused.engine.resetGap();assert.equal(paused.engine.snapshot().paused,true);assert.deepEqual(Array.from(paused.engine.snapshot().pending),[]);
console.log('PASS: restart equivalence, future candle exclusion, candle gap, stale quotes, restart entry pause');
