/* Research-informed, explicit screens; scores are rule strength, not probabilities. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {completedDaily,validCandles}=require('./rank_hongpicks');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'charts.js'),'utf8'),ctx);
const ind=ctx.window.HongIndicators;
const strategies={trend:'이동평균 추세 · Fidelity 교육 원칙',recovery:'와일더 RSI · 회복 필터',breakout:'오닐 돌파 · 가격·거래량 필터'};
const rationale={
 trend:{author:'Fidelity Trading Strategy 교육 자료',url:'https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/sma',thesis:'상승하는 장기 이동평균과 단기·중기 정렬로 하락 추세 종목을 걸러냅니다.',applied:'MA20/60/200 정렬·MA60 상승·RSI 범위는 앱의 구체화 규칙입니다.',unverified:'수익 성장·기업 가치·시장 전체 추세는 이 필터가 검증하지 않습니다.'},
 recovery:{author:'J. Welles Wilder의 RSI · Fidelity 공식 해설',url:'https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI',thesis:'과매도 상태에서 매수세가 회복되는지를 확인합니다. RSI가 낮다는 사실만으로는 매수 근거가 부족합니다.',applied:'최근 5일 RSI 30 상향 회복과 종가 상승은 앱의 회복 필터입니다.',unverified:'와일더의 실패스윙·다이버전스 패턴 전체를 구현한 것은 아닙니다.'},
 breakout:{author:'William J. O’Neil / Investor’s Business Daily',url:'https://www.investors.com/how-to-invest/investors-corner/a-stock-rises-again-after-its-first-breakout-fails-should-you-buy-again/',thesis:'저항 위로 가격이 올라가고 거래량도 증가해야 수요의 강도를 확인할 수 있습니다. 저항에 닿기만 한 종목은 통과시키지 않습니다.',applied:'직전 252일 고가를 돌파 기준으로 사용하고 직전 50일 평균 거래량의 1.4배 이상, 기준 가격 위 5% 이내만 통과시킵니다.',unverified:'정식 베이스·컵위드핸들·EPS/매출 성장·IBD 상대강도·시장 방향은 미검증입니다. CAN SLIM 전체 통과를 뜻하지 않습니다.'}
};
function screen(item,daily,now=new Date()){
 if(!validCandles(daily?.candles))throw Error('가격 데이터 오류');
 const collected=new Date(daily.updated),age=now-collected;
 if(!Number.isFinite(age)||age<0||age>7*86400000||daily.stale)throw Error('일봉 수집 데이터 만료');
 const bars=completedDaily(daily.candles,item.market,collected).filter(x=>x.time<=now.toISOString().slice(0,10));
 if(bars.length<21)throw Error('일봉 계산 기간 부족');
 if(now-new Date(bars.at(-1).time+'T00:00:00Z')>7*86400000)throw Error('최근 완료 일봉 없음');
 const last=bars.at(-1),prev=bars.at(-2),r=ind.rsi(bars),rsi=r.at(-1)?.value;
 const ma=n=>ind.ma(bars,n),m20=ma(20).at(-1)?.value,m60=ma(60),m200=ma(200).at(-1)?.value;
 const rising=m60.length>=6&&m60.at(-1).value>m60.at(-6).value;
 const trend=Number.isFinite(m200)&&last.close>m20&&m20>m60.at(-1)?.value&&m60.at(-1).value>m200&&rising;
 const volumeBars=bars.slice(-51,-1),volumeValid=volumeBars.length===50&&volumeBars.every(x=>Number.isFinite(x.volume)&&x.volume>=0)&&Number.isFinite(last.volume)&&last.volume>=0;
 const avgVolume=volumeValid?volumeBars.reduce((s,x)=>s+x.volume,0)/50:null,volumeRatio=avgVolume>0?last.volume/avgVolume:null;
 const priorHigh=bars.length>=253?Math.max(...bars.slice(-253,-1).map(x=>x.high)):null;
 const nearest=item.weeklyNearest||item.weekly;
 const channelContext=!item.stale&&nearest?{...nearest,state:nearest.distance>3?'distant':nearest.line>last.close?'resistance':'supportCandidate'}:null;
 const signals=[],add=(key,score,reasons,invalidation)=>signals.push({key,name:strategies[key],score,reasons,invalidation,...rationale[key]});
 if(trend&&rsi>=40&&rsi<=70)add('trend',60+(rsi<=60?10:0)+(last.close/m20<=1.05?10:0)+(item.golden?.matched?10:0),['종가 > MA20 > MA60 > MA200','MA60 최근 5거래일 상승',`일봉 RSI ${rsi.toFixed(1)}`,`MA20 대비 +${((last.close/m20-1)*100).toFixed(1)}%`],`종가가 MA60 ${m60.at(-1).value.toFixed(2)} 아래로 내려가면 추세 조건 재검토`);
 let crossed=false,crossDate=null;
 for(let i=Math.max(1,r.length-5);i<r.length;i++)if(r[i-1].value<=30&&r[i].value>30){crossed=true;crossDate=r[i].time;}
 if(crossed&&rsi>30&&rsi<=50&&last.close>prev.close)add('recovery',60+(last.close>m20?15:0)+(m200&&last.close>m200?15:0),[`RSI 30 상향 회복 ${crossDate}`,`현재 RSI ${rsi.toFixed(1)}`,'최근 완료 일봉 종가 상승',last.close>m20?'MA20 상회':'MA20 회복 대기'],`RSI가 다시 30 이하이면 회복 조건 해제`);
 if(priorHigh&&last.close>priorHigh&&last.close/priorHigh<=1.05&&prev.close<=priorHigh&&volumeRatio>=1.4)add('breakout',80+(volumeRatio>=2?10:0)+(trend?10:0),[`직전 252거래일 고가 ${priorHigh.toFixed(2)} 돌파`,`거래량 / 직전 50일 평균 ${volumeRatio.toFixed(2)}배`,`돌파 기준 위 ${((last.close/priorHigh-1)*100).toFixed(2)}%`,'완료 일봉 종가로 확인'],`종가가 돌파 기준 ${priorHigh.toFixed(2)} 아래로 돌아오면 돌파 실패 재검토`);
 const score=signals.length?Math.max(...signals.map(x=>x.score)):0;
 return {...item,price:last.close,sessionDate:last.time,rsi,signals,channelContext,score,stars:score>=90?5:score>=75?4:score>=60?3:score?2:0,dailySource:daily.source,dailyUpdated:daily.updated,metrics:{ma20:m20??null,ma60:m60.at(-1)?.value??null,ma200:m200??null,volumeRatio,priorHigh},missing:[...(!m200?['MA200 기간 부족']:[]),...(priorHigh===null?['252거래일 고점 기간 부족']:[]),...(volumeRatio===null?['50일 거래량 계산 데이터 없음']:[])]};
}
function build(root,manifest,now=new Date()){
 const read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8')),base=read(manifest.resources.hongpicks),rows=[],excluded=[...(base.failures||[])];
 if(base.error||!Array.isArray(base.rows))throw Error('분석 기초 데이터 없음');
 for(const item of base.rows||[])try{const d=read(manifest.histories[item.tv].file),x=screen(item,d,now);if(x.signals.length)rows.push(x);else excluded.push({tv:item.tv,reason:'선별 조건 미충족'});}catch(e){excluded.push({tv:item.tv,reason:e.code?'일봉 파일 없음':e.message});}
 rows.sort((a,b)=>b.score-a.score||b.signals.length-a.signals.length||a.tv.localeCompare(b.tv));
 return {rows,excluded,candidateCount:base.candidateCount,analyzedCount:(base.rows||[]).length,coverage:base.coverage,source:base.source,updated:base.updated,generatedAt:now.toISOString(),strategies,ruleVersion:'2.0',method:'완료 일봉으로 Fidelity 이동평균 추세, 와일더 RSI 회복 원리, 오닐 가격·거래량 돌파 원칙의 일부를 검증. 구체적 점수는 앱 자체 규칙. 주봉 채널은 참고 설명만 제공하며 선별·점수에 사용하지 않음. 미충족 종목 제외, 전략 점수 중 최대값으로 정렬. 만료 일봉 제외.'};
}
if(require.main===module){const root=path.resolve(process.argv[2]||'public'),m=JSON.parse(fs.readFileSync(path.join(root,'data-manifest.json'),'utf8'));fs.writeFileSync(path.join(root,'data-codexpicks.json'),JSON.stringify(build(root,m)));}
module.exports={screen,build};
