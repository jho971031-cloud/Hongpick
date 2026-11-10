/* Descriptive weekly volume/price screen. Scores are not odds or evidence of ownership. */
const fs=require('node:fs'),path=require('node:path');
const {validCandles}=require('./rank_hongpicks');
const WINDOW=52,VOLUME_WEEKS=20,RECENT_WEEKS=13;
const pct=(a,b)=>(a/b-1)*100;
function detectEvents(bars){
 if(!validCandles(bars))throw Error('주봉 가격 데이터 오류');
 const events=[];
 for(let i=WINDOW;i<bars.length;i++){
  const c=bars[i],prior=bars.slice(i-WINDOW,i),volumes=bars.slice(i-VOLUME_WEEKS,i).map(x=>x.volume);
  if(!Number.isFinite(c.volume)||c.volume<=0||volumes.length!==VOLUME_WEEKS||volumes.some(x=>!Number.isFinite(x)||x<=0))continue;
  const avg=volumes.reduce((a,b)=>a+b,0)/VOLUME_WEEKS,ratio=c.volume/avg,priorLow=Math.min(...prior.map(x=>x.low)),priorHigh=Math.max(...prior.map(x=>x.high));
  const fall=(1-c.low/priorHigh)*100,distance=pct(c.low,priorLow),span=c.high-c.low,closePosition=span>0?(c.close-c.low)/span:null,bodyReturn=pct(c.close,c.open),prevReturn=pct(c.close,bars[i-1].close);
  if(ratio<2||fall<25||distance>12||closePosition===null||!(closePosition>=.5||prevReturn>=0))continue;
  const score=Math.min(100,Math.round(25+Math.min(20,(ratio-2)*10)+Math.min(20,Math.max(0,(fall-25)*.5))+(distance<=0?15:Math.max(0,15-distance))+(closePosition>=.7?15:closePosition>=.5?10:0)+(bodyReturn>=0?5:0)));
  events.push({index:i,date:c.time,low:c.low,high:c.high,open:c.open,close:c.close,volume:c.volume,averageVolume:avg,volumeRatio:ratio,priorLow,priorHigh,lowDistancePct:distance,declinePct:fall,closePosition,bodyReturn,prevReturn,score});
 }
 return events;
}
function screen(item,weekly,now=new Date()){
 if(!weekly?.completeWeeksOnly||!weekly.updated||weekly.stale)throw Error('완료 주봉 또는 최신 수집 정보 없음');
 const collected=Date.parse(weekly.updated),clock=now.getTime();if(!Number.isFinite(collected)||collected>clock+120000||clock-collected>14*86400000)throw Error('주봉 수집 데이터 만료');
 const bars=weekly.candles;if(!Array.isArray(bars)||bars.length<WINDOW+1)throw Error('주봉 계산 기간 부족');
 const monday=new Date(now);monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
 // Only the 52-week baseline and 13-week candidate window affect the result;
 // an unrelated malformed candle from years ago must not exclude a valid symbol.
 const today=monday.toISOString().slice(0,10),complete=bars.filter(x=>x.time<today).slice(-(WINDOW+RECENT_WEEKS));
 if(!complete.length||clock-Date.parse(complete.at(-1).time+'T00:00:00Z')>21*86400000)throw Error('최근 완료 주봉 없음');
 const events=detectEvents(complete).filter(e=>e.index>=complete.length-RECENT_WEEKS);if(!events.length)return null;
 const event=events.at(-1),after=complete.slice(event.index+1),latest=complete.at(-1);
 const broken=after.some(x=>x.close<event.low),confirmed=!broken&&after.some(x=>x.close>event.high);
 const state=broken?'저점 이탈 이력':confirmed?'고가 돌파 이력':'관찰 중';
 return {...item,market:item.tv.startsWith('KRX:')?'kr':'us',event:{...event,index:undefined},state,price:latest.close,priceDate:latest.time,priceSource:weekly.source,updated:weekly.updated,sourceUrl:weekly.sourceUrl,score:event.score};
}
function build(root,manifest,now=new Date()){
 const read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8')),candidates=new Map(),rows=[],failures=[];let example=null;
 for(const market of ['kr','us']){
  const rec=manifest.resources?.['turnover-'+market];if(!rec){failures.push({market,reason:'거래대금 목록 없음'});continue;}
  const d=read(rec);if(d.stale||d.error){failures.push({market,reason:'거래대금 목록 만료'});continue;}
  for(const item of d.rows||[])if(['stock','fund'].includes(item.type)&&item.tv)candidates.set(item.tv,item);
 }
 // Explicit reference instrument; include only when its own weekly data exists.
 if(manifest.fibHistories?.['AMEX:SOXL']&&!candidates.has('AMEX:SOXL'))candidates.set('AMEX:SOXL',{tv:'AMEX:SOXL',ticker:'SOXL',name:'Direxion 반도체 3배 ETF',type:'fund',currency:'USD'});
 let analyzed=0;for(const item of candidates.values())try{
  const info=manifest.fibHistories?.[item.tv];if(!info)throw Error('주봉 데이터 없음');
  const data=read(info.file),r=screen(item,data,now);analyzed++;if(r)rows.push(r);
  if(item.tv==='AMEX:SOXL'){
   const historical=data.candles.filter(b=>b.time<='2025-04-13');
   const event=detectEvents(historical).find(e=>e.date>='2025-04-07'&&e.date<='2025-04-11');
   if(event)example={...item,event:{...event,index:undefined},priceSource:data.source,updated:data.updated};
  }
 }catch(e){failures.push({tv:item.tv,reason:e.code?'주봉 파일 없음':e.message});}
 rows.sort((a,b)=>(a.state==='저점 이탈 이력')-(b.state==='저점 이탈 이력')||b.score-a.score||b.event.date.localeCompare(a.event.date)||a.tv.localeCompare(b.tv));
 return {rows:rows.slice(0,50),example,candidateCount:candidates.size,analyzedCount:analyzed,failures,generatedAt:now.toISOString(),source:'Yahoo Finance / NAVER Finance 완료 주봉',method:'한국·미국 거래대금 상위 50개 주식·ETF와 SOXL을 대상으로 최근 13개 완료 주봉에서 직전 52주 저점 대비 12% 이내, 고점 대비 25% 이상 하락, 직전 20주 평균 거래량 2배 이상, 주봉 저점 회복 또는 전주 종가 이상을 탐색. 점수는 관찰 조건의 강도이며 매집 확인이나 수익 확률이 아닙니다.',version:'1.0'};
}
if(require.main===module){const root=path.resolve(process.argv[2]||'public'),m=JSON.parse(fs.readFileSync(path.join(root,'data-manifest.json'),'utf8'));fs.writeFileSync(path.join(root,'data-absorption.json'),JSON.stringify(build(root,m)));}
module.exports={detectEvents,screen,build};
