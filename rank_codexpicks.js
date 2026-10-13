/* Research-informed, explicit screens; scores are rule strength, not probabilities. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {completedDaily,validCandles}=require('./rank_hongpicks');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'charts.js'),'utf8'),ctx);
const ind=ctx.window.HongIndicators;
const strategies={trend:'추세 지속',recovery:'과매도 회복',breakout:'거래량 동반 신고가 돌파',channel:'주봉 빗각 지지 반등'};
function screen(item,daily,now=new Date()){
 if(!validCandles(daily?.candles))throw Error('가격 데이터 오류');
 const collected=new Date(daily.updated),age=now-collected;
 if(!Number.isFinite(age)||age<0||age>7*86400000||daily.stale)throw Error('일봉 수집 데이터 만료');
 const bars=completedDaily(daily.candles,item.market,collected).filter(x=>x.time<=now.toISOString().slice(0,10));
 if(bars.length<21)throw Error('일봉 계산 기간 부족');
 if(now-new Date(bars.at(-1).time+'T00:00:00Z')>7*86400000)throw Error('최근 완료 일봉 없음');
 const last=bars.at(-1),prev=bars.at(-2),r=ind.rsi(bars),rsi=r.at(-1)?.value,previousRsi=r.at(-2)?.value;
 const ma=n=>ind.ma(bars,n),m20=ma(20).at(-1)?.value,m60=ma(60),m200=ma(200).at(-1)?.value;
 const rising=m60.length>=6&&m60.at(-1).value>m60.at(-6).value;
 const trend=Number.isFinite(m200)&&last.close>m20&&m20>m60.at(-1)?.value&&m60.at(-1).value>m200&&rising;
 const volumeBars=bars.slice(-21,-1),volumeValid=volumeBars.every(x=>Number.isFinite(x.volume)&&x.volume>=0)&&Number.isFinite(last.volume)&&last.volume>=0;
 const avgVolume=volumeValid?volumeBars.reduce((s,x)=>s+x.volume,0)/20:null,volumeRatio=avgVolume>0?last.volume/avgVolume:null;
 const priorHigh=bars.length>=253?Math.max(...bars.slice(-253,-1).map(x=>x.high)):null;
 const weekly=item.weekly&&!item.stale&&item.weekly.line<=last.close&&item.weekly.distance<=3?item.weekly:null;
 const signals=[],add=(key,score,reasons,invalidation)=>signals.push({key,name:strategies[key],score,reasons,invalidation});
 if(trend&&rsi>=40&&rsi<=70)add('trend',60+(rsi<=60?10:0)+(last.close/m20<=1.05?10:0)+(item.golden?.matched?10:0)+(weekly?10:0),['종가 > MA20 > MA60 > MA200','MA60 최근 5거래일 상승',`일봉 RSI ${rsi.toFixed(1)}`,`MA20 대비 +${((last.close/m20-1)*100).toFixed(1)}%`],`종가가 MA60 ${m60.at(-1).value.toFixed(2)} 아래로 내려가면 추세 조건 재검토`);
 let crossed=false,crossDate=null;
 for(let i=Math.max(1,r.length-5);i<r.length;i++)if(r[i-1].value<=30&&r[i].value>30){crossed=true;crossDate=r[i].time;}
 if(crossed&&rsi>30&&rsi<=50&&last.close>prev.close)add('recovery',60+(last.close>m20?15:0)+(m200&&last.close>m200?15:0)+(weekly?10:0),[`RSI 30 상향 회복 ${crossDate}`,`현재 RSI ${rsi.toFixed(1)}`,'최근 완료 일봉 종가 상승',last.close>m20?'MA20 상회':'MA20 회복 대기'],`RSI가 다시 30 이하이면 회복 조건 해제`);
 if(priorHigh&&last.close>priorHigh&&prev.close<=priorHigh&&volumeRatio>=1.5)add('breakout',80+(volumeRatio>=2?10:0)+(trend?10:0),[`직전 252거래일 고가 ${priorHigh.toFixed(2)} 돌파`,`거래량 / 직전 20일 평균 ${volumeRatio.toFixed(2)}배`,'완료 일봉 종가로 확인'],`종가가 돌파 기준 ${priorHigh.toFixed(2)} 아래로 돌아오면 돌파 실패 재검토`);
 if(weekly&&last.close>prev.close&&rsi<=60)add('channel',55+(rsi>previousRsi?15:0)+(last.close>m20?15:0)+(rising?15:0),[`종가 아래 주봉 채널 레벨 ${weekly.ratio}`,`지지선과 거리 ${weekly.distance.toFixed(2)}%`,'최근 완료 일봉 종가 상승',rsi>previousRsi?'RSI 상승 확인':'RSI 상승 대기'],`주봉 채널 지지선 ${weekly.line.toFixed(2)} 이탈 시 재검토 · 연장선 값은 시간에 따라 변함`);
 const score=signals.length?Math.max(...signals.map(x=>x.score)):0;
 return {...item,price:last.close,sessionDate:last.time,rsi,signals,score,stars:score>=90?5:score>=75?4:score>=60?3:score?2:0,dailySource:daily.source,dailyUpdated:daily.updated,metrics:{ma20:m20??null,ma60:m60.at(-1)?.value??null,ma200:m200??null,volumeRatio,priorHigh},missing:[...(!m200?['MA200 기간 부족']:[]),...(priorHigh===null?['252거래일 고점 기간 부족']:[]),...(volumeRatio===null?['거래량 계산 데이터 없음']:[]),...(!item.weekly?['주봉 채널 없음']:[])]};
}
function build(root,manifest,now=new Date()){
 const read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8')),base=read(manifest.resources.hongpicks),rows=[],excluded=[...(base.failures||[])];
 if(base.error||!Array.isArray(base.rows))throw Error('분석 기초 데이터 없음');
 for(const item of base.rows||[])try{const d=read(manifest.histories[item.tv].file),x=screen(item,d,now);if(x.signals.length)rows.push(x);else excluded.push({tv:item.tv,reason:'선별 조건 미충족'});}catch(e){excluded.push({tv:item.tv,reason:e.code?'일봉 파일 없음':e.message});}
 rows.sort((a,b)=>b.score-a.score||b.signals.length-a.signals.length||a.tv.localeCompare(b.tv));
 return {rows,excluded,candidateCount:base.candidateCount,analyzedCount:(base.rows||[]).length,coverage:base.coverage,source:base.source,updated:base.updated,generatedAt:now.toISOString(),strategies,ruleVersion:'1.0',method:'한국·미국 거래대금 TOP50 주식 중 완료 일봉과 주봉 채널로 계산. 통과 종목만 표시하며 종목별 가장 높은 전략 점수로 정렬. 중복 지표 점수를 합산하지 않음. 별은 규칙 충족 강도이며 수익률·승률 예측값이 아님. 7일 넘거나 이전 수집 표시가 있는 일봉은 제외.'};
}
if(require.main===module){const root=path.resolve(process.argv[2]||'public'),m=JSON.parse(fs.readFileSync(path.join(root,'data-manifest.json'),'utf8'));fs.writeFileSync(path.join(root,'data-codexpicks.json'),JSON.stringify(build(root,m)));}
module.exports={screen,build};
