/* Build-time ranking. Reuse the chart's exact RSI and weekly channel engine. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context={window:{}};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'charts.js'),'utf8'),context);
const indicators=context.window.HongIndicators;
const project=vm.runInContext('channelPrice',context);
const projection=vm.runInContext('channelProjection',context),position=vm.runInContext('referencePosition',context);
const {scanEntries}=require('./entry_signals');
const RULES={rsi:60,weekly:25,golden:10,rally:5};
function completedDaily(candles,market,now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:market==='kr'?'Asia/Seoul':'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`,clock=Number(parts.hour)*60+Number(parts.minute),closed=clock>=(market==='kr'?945:975);
 return candles.filter(c=>c.time<today||c.time===today&&closed);
}
function validCandles(rows){return Array.isArray(rows)&&rows.every((c,i)=>/^\d{4}-\d{2}-\d{2}$/.test(c.time)&&['open','high','low','close'].every(k=>Number.isFinite(c[k])&&c[k]>0)&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close)&&(!i||rows[i-1].time<c.time));}
function selectWeeklyLevels(choices,price){
 const valid=choices.filter(x=>Number.isFinite(x.line)&&x.line>0&&Number.isFinite(x.distance)&&x.distance>=0).sort((a,b)=>a.distance-b.distance);
 const support=valid.find(x=>x.line<=price)||null,nearest=valid[0]||null;
 return {support:support?{...support,side:'support'}:null,nearest:nearest?{...nearest,side:nearest.line<=price?'support':'resistance'}:null};
}
function weeklyDistance(reference,price,time,kind='support'){
 if(!validCandles(reference)||reference.length<60)return null;
 const choices=[];
 for(const mode of ['high','low']){
  const channel=indicators.fibonacci(reference,mode,{interval:'W'});if(!channel)continue;
  for(const ratio of [0,.5,1,1.5,2,2.5,3]){
   const line=project(channel,reference,time,ratio);if(!Number.isFinite(line)||line<=0)continue;
   choices.push({distance:Math.abs(line/price-1)*100,line,ratio,mode,anchors:channel.anchors});
  }
 }
 const levels=selectWeeklyLevels(choices,price);return kind==='both'?levels:levels.support;
}
function goldenCross(candles){
 if(candles.length<61)return null;
 const fast=indicators.ma(candles,20),slow=indicators.ma(candles,60),values=new Map(fast.map(x=>[x.time,x.value]));
 // A recent cross must still have MA20 above MA60 today.
 if(fast.at(-1).value<=slow.at(-1).value)return {matched:false,date:null};
 for(let i=slow.length-1;i>=Math.max(1,slow.length-5);i--)if(values.get(slow[i-1].time)<=slow[i-1].value&&values.get(slow[i].time)>slow[i].value)return {matched:true,date:slow[i].time};
 return {matched:false,date:null};
}
function scoreMetrics(rsi,weekly,golden,rally){
 const points={rsi:rsi!=null&&rsi<=30?Math.min(60,45+(30-rsi)*1.5):0,weekly:weekly?.side==='support'&&Number.isFinite(weekly.distance)&&weekly.distance>=0?25*Math.max(0,1-weekly.distance/5):0,golden:golden?.matched?10:0,rally:rally!=null&&rally>=10?5:0};
 const score=Number(Object.values(points).reduce((a,b)=>a+b,0).toFixed(2));
 return {points,score,stars:score>=80?5:score>=60?4:score>=40?3:score>=20?2:score>0?1:0};
}
function analyze(item,daily,weekly,now=new Date()){
 const market=item.tv.startsWith('KRX:')?'kr':'us';
 if(!validCandles(daily?.candles))return null;
 // A cached bar collected during the session does not become a closing bar later.
 const collected=new Date(daily.updated),asOf=Number.isFinite(collected.getTime())?new Date(Math.min(now.getTime(),collected.getTime())):now;
 const candles=completedDaily(daily.candles,market,asOf);if(candles.length<15)return null;
 const last=candles.at(-1),rsi=indicators.rsi(candles).at(-1)?.value??null;
 const weekRows=weekly?.candles?.filter(c=>c.time<=last.time)||[];
 const levels=weeklyDistance(weekRows,last.close,last.time,'both'),channel=levels?.support??null,golden=goldenCross(candles),rally=(last.close/candles.at(-2).close-1)*100;
 const fresh=Number.isFinite(collected.getTime())&&now-collected<=7*86400000&&now-new Date(last.time+'T00:00:00Z')<=7*86400000&&!daily.stale;
 const entryProject=(candidate,reference,time,ratio)=>projection(candidate,candles)(position(time,candles),ratio);
 const entry=fresh?scanEntries(candles,!weekly?.stale&&validCandles(weekRows)?weekRows:[],indicators,entryProject):null;
 const ranking=scoreMetrics(rsi,null,golden,rally);ranking.points.weekly=entry?.points||0;ranking.score=Number(Object.values(ranking.points).reduce((a,b)=>a+b,0).toFixed(2));ranking.stars=ranking.score>=80?5:ranking.score>=60?4:ranking.score>=40?3:ranking.score>=20?2:ranking.score>0?1:0;
 return {...item,market,price:last.close,change:rally,sessionDate:last.time,rsi,weekly:channel,weeklyNearest:levels?.nearest??null,entry:entry?{...entry,referenceSource:entry.frame==='W'?weekly.source:daily.source,referenceUpdated:entry.frame==='W'?weekly.updated:daily.updated}:null,golden,rally,...ranking,missing:[...(!channel?['주봉 지지 후보 없음']:[]),...(!golden?['MA60 계산 기간 부족']:[])],dailySource:daily.source,dailyUpdated:daily.updated,weeklySource:levels?.nearest?weekly.source:null,weeklyUpdated:levels?.nearest?weekly.updated:null,stale:!!(daily.stale||weekly?.stale||item.stale)};
}
function build(root,manifest){
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
 const candidates=new Map(),coverage={},failures=[];let stale=false;
 for(const market of ['kr','us']){
  const data=read(manifest.resources['turnover-'+market]);coverage[market]={source:data.source,updated:data.updated,stale:!!data.stale};stale||=!!data.stale;
  for(const item of data.rows||[])if(item.type==='stock')candidates.set(item.tv,{...item,stale:!!data.stale});
 }
 const rows=[];for(const item of candidates.values()){
  try{const entry=manifest.histories[item.tv],week=manifest.fibHistories?.[item.tv];if(!entry)throw Error('일봉 데이터 없음');
   let weekly=null;if(week)try{weekly=read(week.file)}catch{}
   const result=analyze(item,read(entry.file),weekly);if(!result)throw Error('일봉 계산 기간 부족 또는 가격 데이터 오류');rows.push(result);
  }catch(error){failures.push({tv:item.tv,reason:error.code?'일봉 데이터 파일 없음':error.message})}
 }
 rows.sort((a,b)=>b.score-a.score||a.rsi-b.rsi||(a.weekly?.distance??Infinity)-(b.weekly?.distance??Infinity)||a.tv.localeCompare(b.tv));
 rows.forEach((x,i)=>x.rank=i+1);
 const updated=[...Object.values(coverage).map(x=>x.updated),...rows.map(x=>x.dailyUpdated)].filter(Boolean).sort().at(-1)||null;
 return {rows,source:'TradingView Screener / NAVER Finance / Yahoo Finance · 실제 OHLCV 계산',updated,generatedAt:new Date().toISOString(),stale:stale||rows.some(x=>x.stale),coverage,failures,candidateCount:candidates.size,rules:RULES,method:'한국·미국 거래대금 TOP50의 주식 대상. 완료된 일봉 RSI(14) ≤30: 45~60점 · 주봉·일봉 ③ 이후 지지 접근·최근 반등 확인: 0~25점. 최근 5일 접촉 탐색, 2일 이내 접촉봉 고가 종가 돌파, 확인 후 3일 이내·지지 위 5% 이내·위 저항 여유 3% 초과. 초기 ③은 이후 2봉 탐색으로 잠정 표시하며 탐지일 이후 데이터로 기준점을 소급 선택하지 않음 · 최근 5거래일 MA20/60 골든크로스 유지: 10점 · 최근 완료 본장 종가의 전일 대비 +10% 이상: 5점. 주봉 채널 레벨 0 / 0.5 / 1 / 1.5 / 2 / 2.5 / 3. 미확인 항목은 0점이며 데이터 없음으로 표시. 별 5개 80점 이상 / 4개 60점 이상 / 3개 40점 이상 / 2개 20점 이상 / 1개 0점 초과 / 0개 신호 없음.'};
}
if(require.main===module){const root=path.resolve(process.argv[2]||'public'),manifest=JSON.parse(fs.readFileSync(path.join(root,'data-manifest.json'),'utf8'));fs.writeFileSync(path.join(root,'data-hongpicks.json'),JSON.stringify(build(root,manifest)));}
module.exports={analyze,scoreMetrics,goldenCross,weeklyDistance,selectWeeklyLevels,completedDaily,validCandles,build};
