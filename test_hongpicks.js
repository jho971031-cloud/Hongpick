const test=require('node:test'),assert=require('node:assert/strict');
const {scoreMetrics,completedDaily,analyze,goldenCross,selectWeeklyLevels,build}=require('./rank_hongpicks');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const bars=prices=>prices.map((close,i)=>({time:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:close,high:close*1.01,low:close*.99,close,volume:100}));
const {screen:codexScreen}=require('./rank_codexpicks');
const codexNow=new Date('2026-10-13T01:00:00Z');
const codexDaily=prices=>({candles:bars(prices).map((c,i)=>({...c,time:new Date(Date.UTC(2026,9,12)-(prices.length-1-i)*86400000).toISOString().slice(0,10)})),source:'explicit test fixture',updated:codexNow.toISOString()});
const codexItem={tv:'NASDAQ:TEST',market:'us',weekly:null};
test('Codex excludes expired, stale and invalid prices instead of promoting missing data',()=>{
 const d=codexDaily(Array.from({length:260},(_,i)=>100+i));
 assert.throws(()=>codexScreen(codexItem,{...d,updated:'2025-01-01'},codexNow),/만료/);
 assert.throws(()=>codexScreen(codexItem,{...d,stale:true},codexNow),/만료/);
 assert.throws(()=>codexScreen(codexItem,{...d,candles:bars([NaN])},codexNow),/오류/);
 assert.throws(()=>codexScreen(codexItem,{...d,candles:bars(Array(260).fill(100))},codexNow),/최근 완료 일봉 없음/);
 assert.equal(codexScreen(codexItem,d,codexNow).signals.length,0,'overextended RSI is not a trend pick');
});
test('Codex breakout excludes current bar from both prior high and volume average',()=>{
 const d=codexDaily([...Array(252).fill(100),104]);d.candles.at(-1).volume=200;
 const x=codexScreen(codexItem,d,codexNow);
 assert.equal(x.metrics.priorHigh,101);assert.equal(x.metrics.volumeRatio,2);
 assert.ok(x.signals.some(s=>s.key==='breakout'));
 d.candles.at(-1).volume=139;assert.ok(!codexScreen(codexItem,d,codexNow).signals.some(s=>s.key==='breakout'));
 d.candles.at(-1).volume=200;const extended=codexDaily([...Array(252).fill(100),120]);extended.candles.at(-1).volume=200;
 assert.ok(!codexScreen(codexItem,extended,codexNow).signals.some(s=>s.key==='breakout'),'do not chase more than 5% above the reference');
 d.candles.at(-1).volume=null;assert.equal(codexScreen(codexItem,d,codexNow).metrics.volumeRatio,null);
});
test('Codex trend requires long term alignment and moderate RSI',()=>{
 const d=codexDaily(Array.from({length:260},(_,i)=>100+i*.15+Math.sin(i)*2));
 const x=codexScreen(codexItem,d,codexNow);
 assert.ok(x.signals.some(s=>s.key==='trend'));assert.ok(x.metrics.ma20>x.metrics.ma60&&x.metrics.ma60>x.metrics.ma200);
 const short=codexScreen(codexItem,{...d,candles:d.candles.slice(-120)},codexNow);
 assert.ok(!short.signals.some(s=>s.key==='trend'));assert.ok(short.missing.includes('MA200 기간 부족'));
});
test('Codex recovery requires a real RSI recovery and a rising completed close',()=>{
 const prices=Array.from({length:250},(_,i)=>200-i*.2);prices.push(prices.at(-1)+2);prices.push(prices.at(-1)+.4);
 const x=codexScreen(codexItem,codexDaily(prices),codexNow);
 assert.ok(x.signals.some(s=>s.key==='recovery'));assert.ok(x.rsi>30&&x.rsi<=50);
 const falling=codexScreen(codexItem,codexDaily(Array.from({length:252},(_,i)=>200-i*.2)),codexNow);
 assert.equal(falling.signals.length,0,'oversold alone cannot qualify');
});
test('Codex channel context never creates a pick or changes scores; overhead lines remain resistance',()=>{
 const prices=Array.from({length:250},(_,i)=>200-i*.2);prices.push(prices.at(-1)+1);
 const d=codexDaily(prices),close=prices.at(-1);
 const x=codexScreen({...codexItem,weekly:{line:close*.99,distance:1,ratio:1}},d,codexNow);
 const base=codexScreen(codexItem,d,codexNow),overhead=codexScreen({...codexItem,weekly:{line:close*1.01,distance:1,ratio:1}},d,codexNow);
 assert.equal(x.channelContext.state,'supportCandidate');assert.equal(overhead.channelContext.state,'resistance');
 assert.deepEqual(x.signals,base.signals);assert.equal(x.score,base.score);assert.equal(overhead.score,base.score);
 const trendDaily=codexDaily(Array.from({length:260},(_,i)=>100+i*.15+Math.sin(i)*2));
 assert.equal(codexScreen({...codexItem,weekly:{line:100,distance:1}},trendDaily,codexNow).score,codexScreen(codexItem,trendDaily,codexNow).score);
});
test('RSI oversold has more weight than all later conditions combined; missing values do not invent points',()=>{
 assert.ok(scoreMetrics(30,null,null,null).score>scoreMetrics(31,{distance:0,side:'support'},{matched:true},10).score);
 assert.deepEqual(scoreMetrics(null,null,null,null),{points:{rsi:0,weekly:0,golden:0,rally:0},score:0,stars:0});
 assert.equal(scoreMetrics(20,{distance:0,side:'support'},{matched:true},10).stars,5);
 assert.equal(scoreMetrics(31,{distance:5,side:'support'},{matched:false},9.99).score,0);
});
test('Completed regular-session days use market timezone, not UTC day or after-hours price',()=>{
 const data=[{time:'2026-09-29'},{time:'2026-09-30'}];
 assert.equal(completedDaily(data,'us',new Date('2026-09-30T19:00:00Z')).length,1);
 assert.equal(completedDaily(data,'us',new Date('2026-09-30T20:16:00Z')).length,2);
 assert.equal(completedDaily(data,'kr',new Date('2026-09-30T06:00:00Z')).length,1);
 assert.equal(completedDaily(data,'kr',new Date('2026-09-30T06:46:00Z')).length,2);
});
test('Daily RSI and rally are calculated from returned closes, and weekly absence remains explicit',()=>{
 const daily={candles:bars(Array.from({length:65},(_,i)=>200-i)),source:'verified fixture',updated:'2025-03-07'};
 const result=analyze({tv:'NASDAQ:TEST',price:9999},daily,null,new Date('2026-09-30'));
 assert.equal(result.rsi,0);assert.equal(result.price,136);assert.equal(result.weekly,null);assert.equal(result.points.weekly,0);assert.ok(result.missing.includes('주봉 지지 후보 없음'));
 assert.ok(Math.abs(result.rally-(136/137-1)*100)<1e-9);
 assert.equal(analyze({tv:'NASDAQ:TEST'},{candles:bars([NaN])},null),null);
});
test('Golden cross is a real recent MA20/60 crossover and must still be maintained',()=>{
 const prices=[...Array(60).fill(100),...Array(40).fill(80),...Array(5).fill(200)];
 assert.equal(goldenCross(bars(prices)).matched,true);
 assert.equal(goldenCross(bars([...prices,...Array(10).fill(200)])).matched,false);
 assert.equal(goldenCross(bars(Array(70).fill(100))).matched,false);
 assert.equal(goldenCross(bars(Array(30).fill(100))),null);
});
test('A cached intraday candle is not promoted to a completed regular-session close the next day',()=>{
 const daily={candles:bars(Array.from({length:65},(_,i)=>200-i)),source:'prices',updated:'2025-03-06T05:00:00Z'};
 const result=analyze({tv:'KRX:005930'},daily,null,new Date('2025-03-07T12:00:00Z'));
 assert.equal(result.sessionDate,'2025-03-05');assert.equal(result.price,137);
});
test('Export excludes funds, preserves source dates, reports failed stocks and orders scores',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hongpick-rank-'));
 try{
  const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data));
  write('kr.json',{source:'scanner',updated:'2025-03-07',rows:[]});
  write('us.json',{source:'scanner',updated:'2025-03-07',rows:[{tv:'NASDAQ:LOW',type:'stock'},{tv:'NASDAQ:HIGH',type:'stock'},{tv:'AMEX:ETF',type:'fund'},{tv:'NASDAQ:MISSING',type:'stock'}]});
  write('low.json',{source:'prices',updated:'2025-03-07',candles:bars(Array.from({length:65},(_,i)=>200-i))});
  write('high.json',{source:'prices',updated:'2025-03-07',candles:bars(Array.from({length:65},(_,i)=>200+i))});
  const result=build(root,{resources:{'turnover-kr':'kr.json','turnover-us':'us.json'},histories:{'NASDAQ:LOW':{file:'low.json'},'NASDAQ:HIGH':{file:'high.json'}},fibHistories:{}});
  assert.equal(result.rows.length,2);assert.equal(result.candidateCount,3);assert.equal(result.rows[0].tv,'NASDAQ:LOW');assert.equal(result.updated,'2025-03-07');assert.equal(result.failures[0].tv,'NASDAQ:MISSING');assert.equal(result.rows[1].stars,0);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Hong picks chooses support below price even when resistance is closer; resistance gets zero points',()=>{
 const levels=selectWeeklyLevels([{line:101,distance:1},{line:97,distance:3},{line:96,distance:4}],100);
 assert.equal(levels.support.line,97);assert.equal(levels.nearest.side,'resistance');
 assert.equal(scoreMetrics(null,levels.support,null,null).points.weekly,10);
 assert.equal(scoreMetrics(null,levels.nearest,null,null).points.weekly,0);
 assert.equal(selectWeeklyLevels([{line:101,distance:1}],100).support,null);
 assert.equal(scoreMetrics(null,{side:'support',distance:5},null,null).points.weekly,0);
});
