const test=require('node:test'),assert=require('node:assert/strict');
const {scoreMetrics,completedDaily,analyze,goldenCross,build}=require('./rank_hongpicks');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const bars=prices=>prices.map((close,i)=>({time:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:close,high:close*1.01,low:close*.99,close,volume:100}));
test('RSI oversold has more weight than all later conditions combined; missing values do not invent points',()=>{
 assert.ok(scoreMetrics(30,null,null,null).score>scoreMetrics(31,{distance:0},{matched:true},10).score);
 assert.deepEqual(scoreMetrics(null,null,null,null),{points:{rsi:0,weekly:0,golden:0,rally:0},score:0,stars:0});
 assert.equal(scoreMetrics(20,{distance:0},{matched:true},10).stars,5);
 assert.equal(scoreMetrics(31,{distance:5},{matched:false},9.99).score,0);
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
 assert.equal(result.rsi,0);assert.equal(result.price,136);assert.equal(result.weekly,null);assert.equal(result.points.weekly,0);assert.ok(result.missing.includes('주봉 채널 없음'));
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
