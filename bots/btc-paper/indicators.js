/* TradingView Lightweight Charts 5.2.1. Indicators calculated from returned OHLCV. */
window.HongIndicators = {
 ma(candles, period) { let sum=0;const rows=[];candles.forEach((c,i)=>{sum+=c.close;if(i>=period)sum-=candles[i-period].close;if(i>=period-1)rows.push({time:c.time,value:sum/period})});return rows; },
 rsi(candles,period=14) {let g=0,l=0;const out=[];for(let i=1;i<candles.length;i++){const d=candles[i].close-candles[i-1].close;if(i<=period){g+=Math.max(d,0);l+=Math.max(-d,0);if(i<period)continue;g/=period;l/=period}else{g=(g*(period-1)+Math.max(d,0))/period;l=(l*(period-1)+Math.max(-d,0))/period}out.push({time:candles[i].time,value:l===0?(g===0?50:100):100-100/(1+g/l)})}return out;},
 ichimoku(candles,interval='D',continuous=false) {
  const times=candles.map(c=>c.time),minute=interval.endsWith('m');let d=new Date(minute?times.at(-1)*1000:times.at(-1)+'T12:00:00Z');for(let i=0;i<26;i++){if(minute)d=new Date(d.getTime()+parseInt(interval)*60000);else if(interval==='M')d.setUTCMonth(d.getUTCMonth()+1);else if(interval==='W')d.setUTCDate(d.getUTCDate()+7);else{do{d.setUTCDate(d.getUTCDate()+1)}while(!continuous&&[0,6].includes(d.getUTCDay()))}times.push(minute?Math.floor(d.getTime()/1000):d.toISOString().slice(0,10))}
  const midpoint=(i,p)=>{if(i<p-1)return null;let hi=-Infinity,lo=Infinity;for(let j=i-p+1;j<=i;j++){hi=Math.max(hi,candles[j].high);lo=Math.min(lo,candles[j].low)}return(hi+lo)/2};const conversion=[],base=[],spanA=[],spanB=[],lag=[];
  candles.forEach((c,i)=>{const t=midpoint(i,9),k=midpoint(i,26),b=midpoint(i,52);if(t!=null)conversion.push({time:c.time,value:t});if(k!=null)base.push({time:c.time,value:k});if(t!=null&&k!=null)spanA.push({time:times[i+26],value:(t+k)/2});if(b!=null)spanB.push({time:times[i+26],value:b});if(i>=26)lag.push({time:times[i-26],value:c.close})});
  return {conversion,base,spanA,spanB,lag};
 },
 intradayFibonacci(candles,mode='high',settings={}) {
  if(!['high','low'].includes(mode)||candles.length<30)return null;
  // Work only with completed bars. The forming candle is never an anchor.
  const source=candles.slice(-240),offset=candles.length-source.length,n=source.length;
  const rows=mode==='low'?source.map(c=>({...c,open:1/c.open,high:1/c.low,low:1/c.high,close:1/c.close})):source;
  const ranges=rows.slice(-30).map((c,j)=>{const i=n-Math.min(30,n)+j,prev=rows[Math.max(0,i-1)].close;return Math.max(Math.log(c.high/c.low),Math.abs(Math.log(c.high/prev)),Math.abs(Math.log(c.low/prev)))});
  const noise=Math.max(.0005,Math.min(.04,ranges.reduce((a,b)=>a+b,0)/ranges.length)),piv=[];
  for(let i=2;i<n-2;i++)if(rows[i].high===Math.max(...rows.slice(i-2,i+3).map(x=>x.high)))piv.push(i);
  const found=[];
  for(const b of piv){
   if(b<6||b+3>=n||b<n-140||rows[b].high<Math.max(...rows.slice(b-3,b+4).map(x=>x.high))*Math.exp(-noise*.2))continue;
   let turn=null;
   for(let i=b+2;i<Math.min(b+40,n-2);i++)if(rows[i].close>rows[b].high*Math.exp(noise*.25)&&rows[i+1].close>rows[b].high*Math.exp(noise*.25)){turn=i;break}
   if(turn==null||turn<n-100||piv.some(i=>i>b&&i<turn&&rows[i].high>=rows[b].high*Math.exp(-noise*.2)))continue;
   if(Math.min(...rows.slice(b+1,turn+1).map(x=>x.low))>rows[b].high*Math.exp(-noise))continue;
   // The first meaningful post-turn pivot is point 3, not a later, higher peak.
   const peaks=piv.filter(i=>i>turn+1&&i+3<n&&rows[i].high===Math.max(...rows.slice(i-3,i+4).map(x=>x.high))&&Math.min(...rows.slice(i+1,i+4).map(x=>x.low))<rows[i].high*Math.exp(-noise*.8));
   let c=peaks[0],provisional=false;
   if(c==null){c=turn+2;for(let i=c+1;i<n;i++)if(rows[i].high>rows[c].high)c=i;provisional=true}
   if(c>=n||c-turn>48||n-1-c>64)continue;
   for(const a of piv){
    if(b-a<6||b-a>120||rows[b].high>=rows[a].high*Math.exp(-noise*.6))continue;
    const ceiling=rows[a].high,touches=[];
    for(let i=Math.max(0,a-12);i<=a+2;i++)if(Math.abs(Math.log(rows[i].high/ceiling))<=noise*.8)touches.push(i);
    if(touches.length<2||touches.at(-1)-touches[0]<2)continue;
    if(Math.max(...rows.slice(a+1,b+1).map(x=>x.high))>ceiling*Math.exp(noise))continue;
    const swing=Math.log(ceiling/Math.min(...rows.slice(a+1,b+1).map(x=>x.low)));if(swing<noise*3)continue;
    let slope=Math.log(rows[b].high/ceiling)/(b-a),width=Math.log(rows[c].high/ceiling)-slope*(c-a);
    if(width<noise*.75||width>Math.max(.15,noise*12))continue;
    const current=settings.currentPrice>0?(mode==='low'?1/settings.currentPrice:settings.currentPrice):rows.at(-1).close;
    const position=(Math.log(current/ceiling)-slope*(n-1-a))/width;
    if(position<-.35||position>3.35)continue;
    const outside=rows.slice(-4).filter((x,j)=>{const p=(Math.log(x.close/ceiling)-slope*(n-4+j-a))/width;return p<-.75||p>3.75}).length;
    if(outside>=3)continue;
    let zone={from:touches[0]+offset,to:touches.at(-1)+offset,floor:ceiling*Math.exp(-noise*.8),ceiling:ceiling*Math.exp(noise*.8)};
    if(mode==='low'){slope=-slope;width=-width;zone={...zone,floor:1/zone.ceiling,ceiling:1/zone.floor}}
    const distance=Math.min(...[0,.5,1,1.5,2,2.5,3].map(r=>Math.abs(position-r)))*Math.abs(width);
    found.push({mode,a:a+offset,b:b+offset,c:c+offset,turn:turn+offset,slope,width,zone,provisional,active:true,score:swing/noise-(n-1-turn)*.45-(n-1-c)*.2-distance/noise*2,anchors:[a,b,c].map((i,j)=>({point:j+1,index:i+offset,time:source[i].time,price:mode==='high'?source[i].high:source[i].low}))});
   }
  }
  return found.sort((a,b)=>b.score-a.score||b.turn-a.turn)[0]||null;
 },
 fibonacci(candles,mode='high',settings={}) {
  if(['5m','15m'].includes(settings.interval))return this.intradayFibonacci(candles,mode,settings);
  const frame=settings.interval||'W',daily=frame==='D',monthly=frame==='M',near=monthly?1:settings.early?1:3,major=monthly?2:8,minBars=monthly?18:60,minGap=monthly?3:daily?20:26,maxGap=monthly?24:daily?252:208,touchLookback=monthly?6:26,touchSpread=monthly?2:daily?5:8,minTouches=monthly?2:3,retrace=daily?.08:.15,minSwing=daily?.18:monthly?.20:.30;
  if(!['high','low'].includes(mode)||candles.length<minBars)return null;
  const source=candles,rows=mode==='low'?source.map(c=>({...c,open:1/c.open,high:1/c.low,low:1/c.high,close:1/c.close})):source,n=rows.length;
  const piv=[];for(let i=near;i<n-near-1;i++)if(rows[i].high===Math.max(...rows.slice(i-near,i+near+1).map(x=>x.high)))piv.push(i);
  const found=[];
  for(const b of piv){
   // A structural rebound high may be followed by several smaller pivots.
   // Keep the last significant resistance before the sustained reversal.
   const prominence=monthly?1:daily?5:8;
   if(b<prominence||b+prominence>=n||rows[b].high<Math.max(...rows.slice(b-prominence,b+prominence+1).map(x=>x.high))*.995)continue;
   let turn=null;const wait=monthly?12:daily?100:52;
   for(let i=b+2;i<Math.min(b+wait,n-1);i++){
    if(rows[i].close>rows[b].high*1.01&&rows[i+1].close>rows[b].high*1.01){turn=i;break}
   }
   if(turn==null)continue;
   if(piv.some(i=>i>b&&i<turn&&rows[i].high>=rows[b].high*.995))continue;
   const baseLow=Math.min(...rows.slice(b+1,turn+1).map(x=>x.low));
   if(baseLow>rows[b].high*(1-(daily?.04:monthly?.06:.08)))continue;
   const fullPeakWindow=monthly?3:daily?10:13,peakWindow=settings.early&&!monthly?2:fullPeakWindow;
   const cs=piv.filter(i=>i>turn+1&&i>=peakWindow&&i+peakWindow<n&&rows[i].high===Math.max(...rows.slice(i-peakWindow,i+peakWindow+1).map(x=>x.high))&&Math.min(...rows.slice(i+1,i+peakWindow+1).map(x=>x.low))<=rows[i].high*(1-retrace));
   if(!cs.length)continue;const c=cs[0];if(c-turn>(monthly?12:65))continue;
   for(const a of piv){
    if(b-a<minGap||b-a>maxGap||rows[b].high>=rows[a].high*.98)continue;
    if(rows[a].high<Math.max(...rows.slice(Math.max(0,a-(monthly?12:52)),a+1).map(x=>x.high))*.98)continue;
    if(Math.max(...rows.slice(a+1,b+1).map(x=>x.high))>rows[a].high*1.05)continue;
    const ceiling=rows[a].high,touches=[];for(let i=Math.max(0,a-touchLookback);i<=a;i++)if(rows[i].high>=ceiling*.94&&rows[i].high<=ceiling*1.01)touches.push(i);
    if(touches.length<minTouches||touches.at(-1)-touches[0]<touchSpread)continue;
    const swing=1-Math.min(...rows.slice(a+1,b+1).map(x=>x.low))/ceiling;if(swing<minSwing)continue;
    let slope=(Math.log(rows[b].high)-Math.log(ceiling))/(b-a),width=Math.log(rows[c].high)-Math.log(ceiling)-slope*(c-a);if(width<=0)continue;
    let zone={from:touches[0],to:touches.at(-1),floor:ceiling*.94,ceiling:ceiling*1.01};
    if(mode==='low'){slope=-slope;width=-width;zone={from:zone.from,to:zone.to,floor:1/zone.ceiling,ceiling:1/zone.floor}}
    found.push({mode,a,b,c,turn,slope,width,zone,...(settings.early?{active:true,provisional:c+fullPeakWindow>=n}:{}),score:swing*100+Math.min(b-a,156)*.12+touches.length*.5-(n-1-c)*(daily?.06:monthly?1:.3),anchors:[a,b,c].map((index,j)=>({point:j+1,index,time:source[index].time,price:mode==='high'?source[index].high:source[index].low}))});
   }
  }
  const final=new Map();for(const x of found){const key=x.a+':'+x.c,old=final.get(key);if(!old||x.b>old.b)final.set(key,x)}
  const candidates=[...final.values()];
  if(frame!=='W'&&settings.currentPrice>0)for(const x of candidates){const fit=channelFit(x,source,settings.currentPrice,source.at(-1).time);x.score-=fit.distance*100+Math.abs(x.width)*20;x.score+=x.c*.10}
  return candidates.sort((a,b)=>b.score-a.score)[0]||null;
 }
};
class IchimokuCloud {
 setData(a,b){const values=new Map(b.map(x=>[x.time,x.value]));this.points=a.filter(x=>values.has(x.time)).map(x=>({time:x.time,a:x.value,b:values.get(x.time)}));this.requestUpdate?.()}
 constructor(a,b){this.points=a.map(x=>{const y=b.find(y=>y.time===x.time);return y?{time:x.time,a:x.value,b:y.value}:null}).filter(Boolean);this.coordinates=[];this.view={zOrder:()=> 'bottom',renderer:()=>({draw:target=>target.useMediaCoordinateSpace(({context:ctx})=>{for(let i=1;i<this.coordinates.length;i++){const p=this.coordinates[i-1],q=this.coordinates[i];if(!p||!q)continue;const polygon=(left,right,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(left.x,left.a);ctx.lineTo(right.x,right.a);ctx.lineTo(right.x,right.b);ctx.lineTo(left.x,left.b);ctx.closePath();ctx.fill()};const diff=p.a-p.b,next=q.a-q.b;if(diff*next<0){const f=diff/(diff-next);const cross={x:p.x+(q.x-p.x)*f,a:p.a+(q.a-p.a)*f,b:p.b+(q.b-p.b)*f};polygon(p,cross,diff<0?'rgba(22,215,155,0.3)':'rgba(255,82,109,0.3)');polygon(cross,q,next<0?'rgba(22,215,155,0.3)':'rgba(255,82,109,0.3)')}else polygon(p,q,next<0?'rgba(22,215,155,0.3)':'rgba(255,82,109,0.3)')}})})}; }
 attached({chart,series,requestUpdate}){this.chart=chart;this.series=series;this.requestUpdate=requestUpdate;requestUpdate()}
 updateAllViews(){this.coordinates=this.points.map(p=>{const x=this.chart.timeScale().timeToCoordinate(p.time),a=this.series.priceToCoordinate(p.a),b=this.series.priceToCoordinate(p.b);return x==null||a==null||b==null?null:{x,a,b}})}
 paneViews(){return[this.view]}
}
const chartSeconds=t=>typeof t==='number'?t:Date.parse(t+'T00:00:00Z')/1000;
function referencePosition(time,weekly){
 const t=chartSeconds(time),n=weekly.length;
 let lo=0,hi=n-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(chartSeconds(weekly[mid].time)<=t)lo=mid;else hi=mid-1}
 const i=Math.min(lo,n-2),a=chartSeconds(weekly[i].time),b=chartSeconds(weekly[i+1].time);
 return i+(t-a)/(b-a);
}
// Drawing-only future coordinates; no fabricated OHLCV candles.
function channelExtension(candles,interval,count=52,continuous=false){
 const result=candles.map(c=>({time:c.time})),minute=interval.endsWith('m');let date=new Date(minute?candles.at(-1).time*1000:candles.at(-1).time+'T12:00:00Z');
 for(let i=0;i<count;i++){if(minute)date=new Date(date.getTime()+parseInt(interval)*60000);else if(interval==='M'){date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1)}else if(interval==='W')date.setUTCDate(date.getUTCDate()+7);else{do{date.setUTCDate(date.getUTCDate()+1)}while(!continuous&&[0,6].includes(date.getUTCDay()))}result.push({time:minute?Math.floor(date.getTime()/1000):date.toISOString().slice(0,10)})}return result;
}
function channelPrice(candidate,weekly,time,ratio=0){return Math.exp(Math.log(candidate.anchors[0].price)+candidate.slope*(referencePosition(time,weekly)-candidate.a)+ratio*candidate.width)}
// A channel is one straight line on the chart's logarithmic/bar-index axes.
// Calendar gaps must not change the slope at the real/future boundary.
// Include every indicator timestamp: all series share one logical time scale.
function channelProjection(candidate,points){
 const [a,b,c]=candidate.anchors;
 const pa=referencePosition(a.time,points),pb=referencePosition(b.time,points),pc=referencePosition(c.time,points);
 const origin=Math.log(a.price),slope=(Math.log(b.price)-origin)/(pb-pa);
 const width=Math.log(c.price)-(origin+slope*(pc-pa));
 return (index,ratio=0)=>Math.exp(origin+slope*(index-pa)+ratio*width);
}
function channelFit(candidate,reference,price,time){
 if(!candidate||!reference?.length||!(price>0))return {useful:false,distance:Infinity};
 const levels=[0,.5,1,1.5,2,2.5,3].map(r=>channelPrice(candidate,reference,time,r)),distance=Math.min(...levels.map(value=>Math.abs(Math.log(value/price))));
 return {distance,useful:distance<=Math.log(1.25)&&Math.abs(candidate.width)*.5<=Math.log(1.8)};
}
const anchorTime=time=>typeof time==='number'?formatDate(new Date(time*1000).toISOString()):time;
const basisLabel=frame=>({AUTO:'자동',D:'일봉',W:'주봉',M:'월봉','5m':'5분 단타','15m':'15분 단타'}[frame]||frame);
function completedReference(data,frame){
 const today=new Date().toISOString().slice(0,10),month=today.slice(0,7);
 const asOf=Math.min(Date.now(),Date.parse(data.updated)||Date.now());
 const candles=data.candles.filter(c=>c.time!==data.formingTime).filter(c=>['5m','15m'].includes(frame)?c.time*1000+parseInt(frame)*60000<=asOf:frame==='M'?String(c.time).slice(0,7)<month:frame==='D'?String(c.time)<today:true);
 return {...data,candles,interval:frame};
}
class FibonacciBands {
 constructor(candles,candidate,priceAt){this.priceAt=priceAt;this.candles=candles;this.candidate=candidate;this.rows=[];this.colors=['rgba(82,189,88,.07)','rgba(255,81,91,.07)','rgba(0,169,141,.07)','rgba(255,173,22,.07)','rgba(0,189,217,.07)','rgba(146,152,159,.06)'];this.view={zOrder:()=> 'bottom',renderer:()=>({draw:target=>target.useMediaCoordinateSpace(({context:ctx})=>{for(let i=1;i<this.rows.length;i++){const left=this.rows[i-1],right=this.rows[i];if(!left||!right)continue;for(let band=0;band<6;band++){ctx.fillStyle=this.colors[band];ctx.beginPath();ctx.moveTo(left.x,left.y[band]);ctx.lineTo(right.x,right.y[band]);ctx.lineTo(right.x,right.y[band+1]);ctx.lineTo(left.x,left.y[band+1]);ctx.closePath();ctx.fill()}}})})}}
 attached({chart,series,requestUpdate}){this.chart=chart;this.series=series;this.requestUpdate=requestUpdate;requestUpdate()}
 updateAllViews(){const ratios=[0,.5,1,1.5,2,2.5,3];this.rows=[];for(let i=0;i<this.candles.length;i++){const x=this.chart.timeScale().timeToCoordinate(this.candles[i].time),y=ratios.map(r=>this.series.priceToCoordinate(this.priceAt(i,r)));this.rows.push(x==null||y.some(v=>v==null)?null:{x,y})}}
 paneViews(){return[this.view]}
}
window.HongChart=class {
 constructor(element,controls){this.element=element;this.controls=controls;this.options={ma:new Set([20]),rsi:false,ichi:false,fib:'off',fibFrame:'AUTO'};this.interval='D';this.series=[];this.token=0;this.item=null;this.referenceCache=new Map();this.expandedTool=null;this.panelDraft=null;}
 destroy(){this.srSeq=(this.srSeq||0)+1;this.srLines=[];this.stopLive();if(this.chart)this.chart.remove();this.chart=null;this.series=[];this.indicatorSeries=new Map();this.cloud=null;this.fibCloud=null;this.fibMarkers=null;this.fibCandidate=null;this.candles=null;this.volume=null;}
 async load(item){this.scenarioRoot?.remove();this.scenarioRoot=null;this.scenarioEpoch=(this.scenarioEpoch||0)+1;if(this.srTv!==item.tv){this.srTv=item.tv;this.srState=HongLevels.read(item.tv);this.srDraft=null;this.srAuto=null;this.srMessage=''}this.srPicker=false;this.srSeq=(this.srSeq||0)+1;this.item=item;this.lastLive=null;this.liveMode='연결 대기';this.data=null;const token=++this.token;this.destroy();this.element.innerHTML='<div class="chart-unavailable">실제 가격 데이터를 불러오는 중…</div>';this.renderControls();try{
 const wantsFib=this.options.fib!=='off',interval=this.interval;
 const getReference=async frame=>{const key=item.tv+':'+frame;if(!['5m','15m'].includes(frame)&&this.referenceCache.has(key))return this.referenceCache.get(key);const d=completedReference(['5m','15m'].includes(frame)&&viewing.interval===frame?viewing:await api((frame==='W'?'/api/fib-history?symbol=':'/api/history?symbol=')+encodeURIComponent(item.tv)+(frame==='W'?'':'&interval='+frame)),frame);if(!['5m','15m'].includes(frame))this.referenceCache.set(key,d);return d};
 const viewing=await api('/api/history?symbol='+encodeURIComponent(item.tv)+'&interval='+interval);if(token!==this.token)return;
 let selected=null,selectedFrame=null,candidate=null,reason='';
 const scalp=['5m','15m'].includes(this.options.fibFrame),selectionKey=item.tv+':'+this.options.fib+':'+this.options.fibFrame;
 if(wantsFib&&!scalp&&this.channelSelection?.key===selectionKey){({reference:selected,frame:selectedFrame,candidate,reason}=this.channelSelection)}
 else if(wantsFib){
  const frames=this.options.fibFrame==='AUTO'?['W','D']: [this.options.fibFrame],price=viewing.candles.at(-1).close,time=viewing.candles.at(-1).time;
  for(const frame of frames){try{const reference=await getReference(frame),found=HongIndicators.fibonacci(reference.candles,this.options.fib,{interval:frame,currentPrice:['5m','15m'].includes(frame)&&interval!==frame?reference.candles.at(-1)?.close:price});
   if(this.options.fibFrame==='AUTO'&&frame==='W'&&!channelFit(found,reference.candles,price,time).useful){reason=found?'주봉 채널이 현재가에서 멀어 일봉으로 전환':'주봉 후보가 없어 일봉으로 전환';continue}
   selected=reference;selectedFrame=frame;candidate=found;break;
  }catch(error){reason=basisLabel(frame)+' 데이터 없음';if(this.options.fibFrame!=='AUTO')break}}
 }
 if(token!==this.token)return;if(wantsFib&&!scalp)this.channelSelection={key:selectionKey,reference:selected,frame:selectedFrame,candidate,reason};this.data=interval==='W'&&selectedFrame==='W'?selected:viewing;this.referenceData=selected;this.fibBasis=selectedFrame;this.selectedCandidate=candidate;this.fibReason=reason;this.draw();this.renderControls();this.startLive();

 }catch(e){if(token!==this.token)return;this.element.innerHTML='<div class="chart-unavailable"><b>차트 데이터 없음</b><p>'+escapeHtml(e.message)+'</p></div>';this.renderControls()}}

 stopLive(){this.liveEpoch=(this.liveEpoch||0)+1;this.liveClient?.close();this.liveClient=null;clearTimeout(this.liveIndicatorTimer);this.liveIndicatorTimer=null;}
 startLive(){
  if(this.liveClient||!this.chart||!this.item?.tv.startsWith('BINANCE:')||!window.HongLive)return;
  if(this.element.closest&&!this.fullscreenState&&!this.element.closest('.page.active'))return;
  if(!this.data?.nativeBinance){this.liveMode='연결 불가 · 수집본 유지';this.renderControls();return}
  const interval=this.interval,symbol=this.item.tv.split(':')[1],token=this.token,epoch=this.liveEpoch;
  let seen=false,syncing=false,pending=null;
  const apply=message=>{
   if(token!==this.token||epoch!==this.liveEpoch||!this.chart)return;const parsed=HongLive.candle(message,interval);if(!parsed||parsed.symbol!==symbol)return;
   if(syncing){pending=message;return}const row=parsed.row,last=this.data.candles.at(-1);
   if(chartSeconds(row.time)<chartSeconds(last.time))return;
   if(row.time===last.time)this.data.candles[this.data.candles.length-1]=row;else this.data.candles.push(row);
   this.data.updated=parsed.updated;this.data.lastBar=row.time;this.data.formingTime=parsed.closed?null:row.time;this.data.stale=false;this.lastLive=parsed.updated;this.liveMode='실시간';seen=true;
   this.preserveViewport(()=>{this.candles.update(row);this.volume.update({time:row.time,value:row.volume,color:row.close>=row.open?'#16d79b38':'#ff526d38'})});
   if(!this.liveIndicatorTimer)this.liveIndicatorTimer=setTimeout(()=>{this.liveIndicatorTimer=null;if(token===this.token&&epoch===this.liveEpoch&&this.chart)this.preserveViewport(()=>this.applyIndicators(true))},3000);
   this.renderLiveSource();
  };
  this.liveClient=HongLive.subscribe([symbol.toLowerCase()+'@kline_'+HongLive.frame[interval]],apply,async status=>{
   if(token!==this.token||epoch!==this.liveEpoch)return;
   if(status.mode==='connecting'&&(seen||Date.now()-Date.parse(this.data.updated)>15000)&&!syncing){syncing=true;try{const fresh=await HongData.binanceBars(this.item.tv,interval);if(token!==this.token||epoch!==this.liveEpoch||!this.chart)return;this.preserveViewport(()=>{this.data=fresh;this.candles.setData(fresh.candles);this.volume.setData(fresh.candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'#16d79b38':'#ff526d38'})));this.applyIndicators(true)},true)}catch{this.liveMode='복구 대기 · 이전 수신값'}finally{syncing=false;if(pending){const p=pending;pending=null;apply(p)}}}
   if(status.mode!=='receiving')this.liveMode={connecting:'연결 중',reconnecting:'재연결 중 · 이전 수신값',paused:'일시정지 · 이전 수신값'}[status.mode]||'수집본';
   if(this.item?.tv.startsWith('BINANCE:'))this.renderLiveSource();
  });
 }
 preserveViewport(action,byTime=false){
  const scale=this.chart?.timeScale?.(),get=()=>byTime?scale?.getVisibleRange?.():scale?.getVisibleLogicalRange?.();
  const before=get(),result=action(),after=get();
  if(before&&JSON.stringify(before)!==JSON.stringify(after)){if(byTime)scale.setVisibleRange(before);else scale.setVisibleLogicalRange(before)}
  return result;
 }
 draw(){const last=this.data.candles.at(-1)?.close||1,precision=this.item?.type==='crypto'?Math.min(12,Math.max(2,4-Math.floor(Math.log10(last)))):2;this.priceFormat={type:'price',precision,minMove:10**-precision};this.destroy();this.element.replaceChildren();const L=LightweightCharts;this.chart=L.createChart(this.element,{autoSize:true,layout:{background:{color:'#111317'},textColor:'#959ba5',attributionLogo:true,panes:{separatorColor:'#2b2e35'}},grid:{vertLines:{color:'#202329'},horzLines:{color:'#202329'}},rightPriceScale:{borderColor:'#2b2e35',mode:this.options.fib==='off'?L.PriceScaleMode.Normal:L.PriceScaleMode.Logarithmic},timeScale:{borderColor:'#2b2e35',rightOffset:4,shiftVisibleRangeOnNewBar:false,allowShiftVisibleRangeOnWhitespaceReplacement:false,timeVisible:this.interval.endsWith('m'),secondsVisible:false},localization:{locale:'ko-KR'},crosshair:{mode:L.CrosshairMode.Normal}});this.candles=this.chart.addSeries(L.CandlestickSeries,{priceFormat:this.priceFormat,upColor:'#16d79b',downColor:'#ff526d',borderVisible:false,wickUpColor:'#16d79b',wickDownColor:'#ff526d'});this.candles.setData(this.data.candles);this.candles.priceScale().applyOptions({scaleMargins:{top:0.08,bottom:0.2}});this.volume=this.chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});this.volume.setData(this.data.candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'#16d79b38':'#ff526d38'})));this.volume.priceScale().applyOptions({scaleMargins:{top:0.82,bottom:0}});this.applyIndicators();const count=this.data.candles.length,from=this.fibCandidate&&this.interval===this.fibBasis?Math.max(0,this.fibCandidate.zone.from-16):Math.max(0,count-120);this.chart.timeScale().setVisibleLogicalRange({from,to:count+(this.fibCandidate?18:5)});this.initLevels();}
 applyIndicators(streamUpdate=false){
  if(!this.chart)return;
  const updating=streamUpdate,used=new Set();
  if(!updating){for(const series of this.series)this.chart.removeSeries(series);this.series=[];this.indicatorSeries=new Map();
   if(this.cloud){this.candles.detachPrimitive(this.cloud);this.cloud=null}
   if(this.fibCloud){this.candles.detachPrimitive(this.fibCloud);this.fibCloud=null}
   if(this.fibMarkers){this.candles.detachPrimitive(this.fibMarkers);this.fibMarkers=null}
  }
  this.indicatorSeries??=new Map();this.fibCandidate=null;this.fibStatus='';
  const L=LightweightCharts,add=(data,color,pane=0,extra={})=>{
   const key=pane+':'+color+':'+(extra.title??'');used.add(key);let series=this.indicatorSeries.get(key);
   if(!series){series=this.chart.addSeries(L.LineSeries,{priceFormat:this.priceFormat,color,lineWidth:1,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,...extra},pane);this.series.push(series);this.indicatorSeries.set(key,series)}
   series.setData(data);return series;
  };
  const channelTimes=this.data.candles.map(c=>({time:c.time}));
  const colors={20:'#f4c95d',60:'#58adff',120:'#b58eff',200:'#f790ad'};
  for(const period of this.options.ma)add(HongIndicators.ma(this.data.candles,period),colors[period]);
  if(this.options.ichi){const d=HongIndicators.ichimoku(this.data.candles,this.interval,this.item?.type==='crypto');channelTimes.push(...d.spanA,...d.spanB);add(d.conversion,'#4d9bff');add(d.base,'#ff765d');add(d.spanA,'#16d79b');add(d.spanB,'#ff526d');add(d.lag,'#bb8ae8');if(this.cloud)this.cloud.setData(d.spanA,d.spanB);else{this.cloud=new IchimokuCloud(d.spanA,d.spanB);this.candles.attachPrimitive(this.cloud)}}
  if(this.options.fib!=='off'){
   const candidate=this.selectedCandidate;this.fibCandidate=candidate;
   if(candidate){
    const palette={0:'#92989f',.5:'#52bd58',1:'#ff515b',1.5:'#00a98d',2:'#ffad16',2.5:'#00bdd9',3:'#92989f'},future=channelExtension(this.data.candles,this.interval,52,this.item?.type==='crypto'),extended=[...new Map([...future,...channelTimes].map(c=>[chartSeconds(c.time),{time:c.time}])).values()].sort((a,b)=>chartSeconds(a.time)-chartSeconds(b.time));
    const priceAt=channelProjection(candidate,extended);
    for(const [ratio,color] of Object.entries(palette)){const r=Number(ratio),data=[];for(let i=0;i<extended.length;i++){const value=priceAt(i,r);if(Number.isFinite(value)&&value>0)data.push({time:extended[i].time,value})}add(data,color,0,{lineWidth:r===0||r===1?2:1,lastValueVisible:true,title:String(r),autoscaleInfoProvider:()=>null})}
    const first=chartSeconds(this.data.candles[0].time),last=chartSeconds(this.data.candles.at(-1).time),markers=candidate.anchors.filter(x=>chartSeconds(x.time)>=first&&chartSeconds(x.time)<=last).map((x,i)=>{const nearest=this.data.candles.reduce((best,row)=>Math.abs(chartSeconds(row.time)-chartSeconds(x.time))<Math.abs(chartSeconds(best.time)-chartSeconds(x.time))?row:best);return {time:nearest.time,position:this.options.fib==='high'?'aboveBar':'belowBar',color:'#edf7ff',shape:'circle',text:['①','②','③'][x.point-1]}});
    if(this.fibMarkers)this.fibMarkers.setMarkers(markers);else this.fibMarkers=L.createSeriesMarkers(this.candles,markers);

    if(this.fibCloud){this.fibCloud.candles=extended;this.fibCloud.candidate=candidate;this.fibCloud.priceAt=priceAt;this.fibCloud.requestUpdate?.()}else{this.fibCloud=new FibonacciBands(extended,candidate,priceAt);this.candles.attachPrimitive(this.fibCloud)}
    this.fibStatus=(this.fibReason?this.fibReason+' · ':'')+(this.options.fib==='high'?'고–고–고':'저–저–저')+' · 오른쪽 연장 · ① '+anchorTime(candidate.anchors[0].time)+' · ② '+anchorTime(candidate.anchors[1].time)+' · 변곡 '+anchorTime(this.referenceData.candles[candidate.turn].time)+' · ③ '+anchorTime(candidate.anchors[2].time)+(candidate.active?' · 수집 기준 진행 구간'+(candidate.provisional?' · ③ 잠정':' · ③ 반전 확인'):'');
   }else{if(this.fibCloud){this.candles.detachPrimitive(this.fibCloud);this.fibCloud=null}if(this.fibMarkers){this.candles.detachPrimitive(this.fibMarkers);this.fibMarkers=null}this.fibStatus=(this.fibReason?this.fibReason+' · ':'')+basisLabel(this.fibBasis||this.options.fibFrame)+' 기준에서 조건을 충족하는 후보가 없습니다.';}
  }
  if(this.options.rsi){const rsi=HongIndicators.rsi(this.data.candles),series=add(rsi,'#b58eff',1,{priceScaleId:'right',priceFormat:{type:'price',precision:1,minMove:.1},lastValueVisible:true});if(!updating){series.priceScale().applyOptions({mode:L.PriceScaleMode.Normal,autoScale:true,scaleMargins:{top:.12,bottom:.12}});series.applyOptions({autoscaleInfoProvider:(base)=>{const range=base()?.priceRange;return {priceRange:{minValue:Math.min(20,range?.minValue??20),maxValue:Math.max(80,range?.maxValue??80)}}}});for(const value of [30,70])series.createPriceLine({price:value,color:'#71899c',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});const panes=this.chart.panes();panes[0].setStretchFactor(4);panes[1].setStretchFactor(1.5)}}
  if(updating)for(const [key,series] of this.indicatorSeries)if(!used.has(key)){this.chart.removeSeries(series);this.indicatorSeries.delete(key);this.series=this.series.filter(x=>x!==series)}
  if(streamUpdate)this.renderLiveSource();else this.renderControls();
 }
 renderLiveSource(){
  const root=this.controls.querySelector?.(':scope > small.data-source');if(!root||!this.data)return;
  root.innerHTML=escapeHtml(this.data.source)+' · 마지막 봉 '+anchorTime(this.data.lastBar)+' · 수신 '+formatDate(this.data.updated)+(this.data.stale?' · 이전 데이터':'')+' · '+escapeHtml(this.liveMode||'연결 대기')+(this.lastLive?' · 마지막 스트림 '+formatDate(this.lastLive):'')+(this.fibStatus?'<br><span class="fib-status">'+basisLabel(this.fibBasis||this.options.fibFrame)+' 기준 · '+escapeHtml(this.fibStatus)+'</span>':'')+'<br>일목: 9 / 26 / 52 / 26 · 구름 불투명도 30% · <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Chart by TradingView Lightweight Charts</a>';
 }
 async openScenario(){
  const item=this.item,candidate=this.selectedCandidate;const epoch=this.scenarioEpoch=(this.scenarioEpoch||0)+1;
  this.scenarioRoot?.remove();const root=document.createElement('section');root.className='scenario-panel';root.setAttribute('aria-live','polite');this.controls.append(root);this.scenarioRoot=root;
  root.innerHTML='<div class="pt"><h2>모의 진입 시나리오</h2><button data-scenario-close aria-label="시나리오 닫기">닫기 ×</button></div><div class="scenario-content">현재가 확인 중…</div>';
  root.querySelector('[data-scenario-close]').onclick=()=>{this.scenarioEpoch++;root.remove();this.scenarioRoot=null};const content=root.querySelector('.scenario-content');
  if(!candidate||!this.data){content.innerHTML='<p>차트의 자동 빗각을 켜고 채널이 그려진 뒤 시나리오를 확인하세요. 채널이 없으면 익절·추가 진입·손절 가격을 계산하지 않습니다.</p><button data-enable-channel>자동 빗각 설정 열기</button>';content.querySelector('button').onclick=()=>this.fibMenu();return}
  let quote=null,quoteError='';const crypto=item.tv.startsWith('BINANCE:');
  if(crypto){const live=liveCoinRow(item);if(live.live&&Number.isFinite(live.price))quote={...live,source:'Binance Spot WebSocket',delivery:'실시간 수신'};else if(this.lastLive&&this.data.candles.at(-1)?.close)quote={price:this.data.candles.at(-1).close,currency:'USDT',source:'Binance Kline WebSocket',updated:this.lastLive,delivery:'차트 마지막 수신'}}
  if(!quote)try{quote=await api('/api/stock?symbol='+encodeURIComponent(item.tv))}catch(e){quoteError=e.message}
  if(epoch!==this.scenarioEpoch||this.item?.tv!==item.tv||!root.isConnected)return;
  if(!(quote?.price>0)){content.innerHTML='<p>현재가 데이터 없음 · '+escapeHtml(quoteError||'제공원 확인 필요')+'</p>';return}
  const data=this.data,interval=this.interval,stamp=data.candles.at(-1).time,axis=channelExtension(data.candles,interval,52,crypto),at=channelProjection(candidate,axis),idx=referencePosition(stamp,axis);
  const levels=[0,.5,1,1.5,2,2.5,3].map(ratio=>({ratio,price:at(idx,ratio)}));let units=1;
  // Direction checks use completed bars from the selected chart timeframe only.
  const known=HongScenario.completed(data,interval,item.tv),rsi=HongIndicators.rsi(known).at(-1)?.value,ma20=HongIndicators.ma(known,20).at(-1)?.value,ma60=HongIndicators.ma(known,60).at(-1)?.value,last=known.at(-1),prior=known.at(-2);
  const safeTime=quote.updated,referenceTime=data.updated,currency=quote.currency||(crypto?'USDT':item.tv.startsWith('KRX:')?'KRW':'USD'),money=v=>number(v,crypto?8:2)+' '+escapeHtml(currency),pct=v=>percent(v),frame=basisLabel(interval),basis=basisLabel(this.fibBasis||this.options.fibFrame);
  const draw=()=>{
   let p;try{p=HongScenario.plan({price:Number(quote.price),levels,units})}catch(e){content.innerHTML='<p>'+escapeHtml(e.message)+'</p>';return}
   const signal=p.outside?'채널 하단 밖 · 진입 시나리오 중단':p.above?'채널 상단 밖 · 다음 저항선 없음':p.exit&&p.exit.percent<=3?'바로 위 저항이 가까움 · 추격 주의':last&&prior&&last.close>prior.high?'최근 완료 봉 고점 돌파 · 지지 유지 관찰':ma20&&ma60&&last?.close>ma20&&ma20>ma60?'상승 추세 안의 눌림 · 반등 확인 대기':'반등 확인 대기 · 지지 이탈 함께 확인';
   const headroom=p.exit?.percent,low=[...p.lines].reverse().find(x=>x.price<=p.price),supportText=low?'현재 아래 채널 지지 '+money(low.price)+' (레벨 '+low.ratio+')':'아래 지지선 없음';
   const up=p.exit?'현재 아래 채널 지지를 유지하고 최근 완료 봉 고점 '+(last?money(last.high):'데이터 없음')+'을 다음 '+frame+' 종가로 넘으면 반등 근거가 강화됩니다. 바로 위 레벨 '+p.exit.line.ratio+' '+money(p.exit.line.price)+'에 닿는 경우 첫 청산 후보입니다.':'그려진 채널 안에 다음 위 저항이 없어 익절 가격을 제시하지 않습니다.';
   const flat=low&&p.exit?'지지 '+money(low.price)+'와 위 저항 '+money(p.exit.line.price)+' 사이에 머물면 횡보 시나리오입니다. 지지 접촉만으로 반등 확인이라고 표시하지 않습니다.':'채널 안으로 복귀하고 지지·저항 관계가 생길 때 다시 계산합니다.';
   const down=p.stages.length?'진입 구간 지지선 다음 아래 레벨 '+p.stages[0].line.ratio+' '+money(p.stages[0].line.price)+' 접촉에서 같은 수량을 추가한다고 가정합니다. 이후 아래 선마다 한 번씩 반복하고, 최하단 '+money(p.floor.price)+' 아래로 '+frame+' 종가가 마감하면 모의 손절 조건입니다.':'추가 진입할 아래 채널선이 없습니다. 최하단 아래 '+frame+' 종가 마감이 모의 손절 조건입니다.';
   content.innerHTML=`<span class="scenario-eyebrow">CHANNEL PAPER PLAN · 실제 주문 없음</span><h3>${escapeHtml(item.name||item.ticker||item.tv)}</h3><div class="scenario-verdict">${escapeHtml(signal)}</div><div class="scenario-prices"><div><small>현재가 · 진입 가정</small><strong>${money(p.price)}</strong></div><div><small>첫 청산 후보 · 다음 위 채널</small><strong>${p.exit?money(p.exit.line.price):'데이터 없음'}</strong><small>${p.exit?pct(headroom)+' · 레벨 '+p.exit.line.ratio:'상단 밖 / 다음 선 없음'}</small></div><div><small>손절 경계 · 최하단 채널</small><strong>${money(p.floor.price)}</strong><small>${frame} 종가가 하단 밖으로 마감할 때</small></div></div><p>${supportText}</p><p class="scenario-indicators">${frame} RSI(14) ${rsi==null?'데이터 없음':number(rsi,1)} · MA20 ${ma20==null?'데이터 없음':money(ma20)} · MA60 ${ma60==null?'데이터 없음':money(ma60)}${candidate.provisional?' · ③ 잠정 채널':''}</p><div class="scenario-inputs"><label>진입·추가 수량 <input type="number" min="0.000001" step="any" value="${units}" aria-label="매회 모의 진입 수량"></label><button data-apply-units>수량 적용</button><span>매 선당 동일 수량 · 최대 추가 ${p.stages.length}회</span><button data-reprice>현재가로 다시 계산</button></div><div class="scenario-branches"><article><b>↗ 상승</b><p>${up}</p></article><article><b>→ 횡보</b><p>${flat}</p></article><article><b>↘ 하락</b><p>${down}</p></article></div><h4>추가 진입하면 평균단가는 어떻게 바뀔까?</h4>${p.outside||p.above?'<p>현재가가 채널 밖이므로 추가 진입 계획을 만들지 않습니다.</p>':`<div class="table"><table><thead><tr><th>단계 / 진입 선</th><th>추가 가격</th><th>누적 수량</th><th>평균단가</th><th>반등 시 다음 위 선</th><th>청산 손익</th></tr></thead><tbody><tr><td>최초 진입</td><td>${money(p.price)}</td><td>${number(units,8)}</td><td>${money(p.price)}</td><td>${p.exit?money(p.exit.line.price):'없음'}</td><td>${p.exit?money(p.exit.pnl)+' / '+pct(p.exit.percent):'미확인'}</td></tr>${p.stages.map((x,i)=>`<tr><td>추가 ${i+1} · 레벨 ${x.line.ratio}</td><td>${money(x.line.price)}</td><td>${number(x.quantity,8)}</td><td>${money(x.average)}</td><td>${x.exit?money(x.exit.line.price):'없음'}</td><td class="${x.exit?.pnl<0?'down':'up'}">${x.exit?money(x.exit.pnl)+' / '+pct(x.exit.percent)+(x.exit.pnl<0?'<br><small>평균단가 아래 · 손실 청산</small>':'<br><small>익절 후보</small>'):'미확인'}</td></tr>`).join('')}</tbody></table></div><p class="scenario-exposure">모든 아래 선에서 추가 시 총 ${number(p.maxQuantity,8)} 수량 · 투입 ${money(p.totalCost)}. 하단 경계에서 계산한 손익 ${money(p.boundaryPnl)} (${pct(p.boundaryPercent)}). 실제 하단 이탈 체결 가격은 알 수 없어 이 값이 최대 손실은 아닙니다.</p>`}<details class="pick-rules"><summary>익절 시점 · 반등 근거 · 계산 방식</summary><p>청산 시점은 날짜보다 다음 위 채널선 접촉을 기준으로 합니다. 다음 1~3개 ${frame} 완료 봉에서 지지 유지와 직전 완료 봉 고점 돌파를 점검하는 관찰 계획이며, 도달 기간·반등 확률 예측값은 없습니다.</p><p>${frame} 완료 봉 RSI(14) ${rsi==null?'데이터 없음':number(rsi,1)} · MA20 ${ma20==null?'데이터 없음':money(ma20)} · MA60 ${ma60==null?'데이터 없음':money(ma60)}. RSI 과매도는 단독 반등 확인이 아닙니다.</p><p>현재 그려진 ${basis} 채널의 레벨 0~3을 가격순으로 정렬합니다. 차트 ${frame} 마지막 봉 ${escapeHtml(anchorTime(stamp))} 위치의 채널 가격을 현재 시나리오에 고정합니다. 시간이 지나면 기울기에 따라 채널 가격이 달라지므로 다시 계산하세요. 잠정 ③ 또는 단기 진행 채널은 기준점이 바뀔 수 있습니다.</p><p>최초 구간의 지지선 다음 아래 선부터 같은 수량을 한 번씩 추가하고, 추가 뒤 바로 위 인접 채널선을 청산 후보로 계산합니다. 평균단가 아래 청산은 손실입니다. 수수료·세금·슬리피지·갭·레버리지는 계산에 포함하지 않습니다. 물타기할수록 총 투입금과 하단 이탈 손실 금액이 늘어납니다.</p><p><a href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI" target="_blank" rel="noopener">RSI 참고 교육</a> · <a href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/support-and-" target="_blank" rel="noopener">지지·저항 교육</a>. 추가 진입·청산 단계는 사용자 채널 규칙을 구현한 자체 모의 계획입니다.</p></details><small class="data-source">가격: ${escapeHtml(quote.source||'공개 제공원')} · ${escapeHtml(quote.delivery||'지연·수집 시세')} · ${formatDate(safeTime)}${quote.stale?' · 이전 수집':''}<br>채널·지표: ${escapeHtml(data.source)} · 수집 ${formatDate(referenceTime)}${data.stale?' · 이전 수집':''} · 생성 ${formatDate(new Date().toISOString())}</small>`;
   content.querySelector('[data-apply-units]').onclick=()=>{const input=content.querySelector('input'),value=Number(input.value);if(!(Number.isFinite(value)&&value>0)){input.setCustomValidity('0보다 큰 수량을 입력하세요.');input.reportValidity();return}input.setCustomValidity('');units=value;draw()};content.querySelector('[data-reprice]').onclick=()=>{HongData.clear();this.openScenario()};
  };draw();
 }

 renderControls(){
  if(!this.item)return;if(this.fullscreenState)this.fullscreenState.root.querySelector('.chart-screen-toolbar b small').textContent=this.interval;const saved=state.watch.some(x=>x.tv===this.item.tv),fibLabel=this.options.fib==='high'?'고–고–고':this.options.fib==='low'?'저–저–저':'OFF';
  this.controls.innerHTML='<div class="indicator-buttons"><button data-tool="ma" class="'+(this.options.ma.size?'on':'')+'">이동평균선 '+[...this.options.ma].sort((a,b)=>a-b).join('/')+'</button><button data-tool="rsi" class="'+(this.options.rsi?'on':'')+'">RSI(14) '+(this.options.rsi?'ON':'OFF')+'</button><button data-tool="ichi" class="'+(this.options.ichi?'on':'')+'">일목균형표 '+(this.options.ichi?'ON':'OFF')+'</button><button data-tool="fib" class="'+(this.options.fib!=='off'?'on':'')+'">자동 빗각 '+fibLabel+(this.options.fib!=='off'?' · '+basisLabel(this.fibBasis||this.options.fibFrame):'')+'</button><button data-tool="scalp5" class="'+(this.options.fibFrame==='5m'&&this.options.fib!=='off'?'on':'')+'">5분 단타 빗각'+(this.options.fibFrame==='5m'&&this.options.fib!=='off'?' ON':' OFF')+'</button><button data-tool="scalp" class="'+(this.options.fibFrame==='15m'&&this.options.fib!=='off'?'on':'')+'">15분 단타 빗각'+(this.options.fibFrame==='15m'&&this.options.fib!=='off'?' ON':' OFF')+'</button><button data-tool="sr" class="'+(this.srState?.show&&(this.srState?.auto||this.srState?.manual.length)?'on':'')+'">지지·저항선</button><button data-tool="scenario" class="scenario-trigger">↗ 모의 진입 시나리오</button><button data-tool="fullscreen">⛶ 전체화면</button><button data-watch="'+escapeHtml(this.item.tv)+'" class="'+(saved?'on':'')+'">'+(saved?'★ 저장됨':'☆ 관심 저장')+'</button></div><div class="filters timeframe">'+['1m','5m','15m','D','W','M'].map((v,i)=>'<button data-interval="'+v+'" class="'+(v===this.interval?'sel':'')+'">'+['1분','5분','15분','일봉','주봉','월봉'][i]+'</button>').join('')+'</div><small class="data-source">'+(this.data?escapeHtml(this.data.source)+' · 마지막 봉 '+anchorTime(this.data.lastBar)+' · 수집 '+formatDate(this.data.updated)+(this.data.stale?' · 이전 데이터':''):'가격 데이터')+(this.item.tv.startsWith('BINANCE:')?' · '+escapeHtml(this.liveMode||'REST 수신 · 연결 대기')+(this.lastLive?' · 마지막 스트림 '+formatDate(this.lastLive):''):' · 지연·주기 수집 시세')+(this.data&&[...this.options.ma].some(p=>p>this.data.candles.length)?'<br>선택한 MA 중 봉 수가 부족한 기간은 데이터가 없습니다.':'')+(this.fibStatus?'<br><span class="fib-status">'+basisLabel(this.fibBasis||this.options.fibFrame)+' 기준 · 봉 전환 시 유지: '+escapeHtml(this.fibStatus)+'</span>':'')+'<br>일목: 9 / 26 / 52 / 26 · 구름 불투명도 30% · <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Chart by TradingView Lightweight Charts</a></small>';
  this.controls.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>{const key=button.dataset.tool;if(key==='sr')this.toggleLevels();else if(key==='scenario')this.openScenario();else if(key==='fullscreen')this.openFullscreen();else if(key==='ma')this.maMenu();else if(key==='fib')this.fibMenu();else if(key==='scalp')this.fibMenu('15m');else if(key==='scalp5')this.fibMenu('5m');else{this.options[key==='ichi'?'ichi':'rsi']=!this.options[key==='ichi'?'ichi':'rsi'];this.applyIndicators()}});
  this.renderSettings();if(this.expandedTool==='sr')this.renderLevelSettings();
  this.controls.querySelectorAll('[data-interval]').forEach(button=>button.onclick=()=>{this.interval=button.dataset.interval;this.data=null;this.load(this.item)})
 }
 maMenu(){this.toggleSettings('ma')}
 fibMenu(defaultFrame=null){this.toggleSettings(defaultFrame==='5m'?'scalp5':defaultFrame==='15m'?'scalp':'fib',defaultFrame)}
 toggleSettings(tool,frame=null){this.srPicker=false;this.element.classList.remove('sr-drawing');
  if(this.expandedTool===tool){this.expandedTool=null;this.panelDraft=null}else{this.expandedTool=tool;this.panelDraft={frame:frame||this.options.fibFrame,mode:this.options.fib==='off'?'high':this.options.fib,enabled:this.options.fib!=='off',ma:new Set(this.options.ma)}}
  this.renderControls();this.controls.querySelector('[data-settings-panel] input')?.focus({preventScroll:true});
 }
 renderSettings(){
  for(const button of this.controls.querySelectorAll('[data-tool]'))if(['ma','fib','scalp','scalp5','sr'].includes(button.dataset.tool)){button.setAttribute('aria-expanded',String(this.expandedTool===button.dataset.tool));button.textContent+=' '+(this.expandedTool===button.dataset.tool?'▴':'▾')}
  if(this.expandedTool==='sr'||!this.expandedTool||!this.panelDraft)return;
  const d=this.panelDraft,ma=this.expandedTool==='ma',panel=document.createElement('section');panel.className='indicator-settings';panel.dataset.settingsPanel='';panel.setAttribute('aria-label',ma?'이동평균선 설정':'자동 빗각 설정');
  const checks=(values,group,selected)=>values.map(([value,label])=>'<label><input type="checkbox" data-group="'+group+'" value="'+value+'" '+(selected(value)?'checked':'')+'> '+label+'</label>').join('');
  panel.innerHTML='<div class="settings-head"><b>'+(ma?'이동평균선':'자동 빗각 · 단타 / 장기')+'</b><button data-close-settings aria-label="설정 접기">접기 ▴</button></div>'+(ma?'<fieldset><legend>기간 · 여러 개 선택 가능</legend><div class="settings-checks">'+checks([20,60,120,200].map(p=>[String(p),'MA '+p]),'ma',v=>d.ma.has(+v))+'</div></fieldset>':'<label class="settings-enable"><input type="checkbox" data-enable '+(d.enabled?'checked':'')+'> 자동 빗각 표시</label><fieldset><legend>작도 기준 봉 · 하나 선택</legend><div class="settings-checks">'+checks(['5m','15m','AUTO','W','D','M'].map(f=>[f,basisLabel(f)]),'frame',v=>d.frame===v)+'</div></fieldset><fieldset><legend>기준점 방향 · 하나 선택</legend><div class="settings-checks">'+checks([['high','고–고–고'],['low','저–저–저']],'mode',v=>d.mode===v)+'</div></fieldset><small class="data-source">① → ② → 변곡 → ③ 순서 유지. 5분·15분 단타는 최근 완료된 240봉에서 진행 구간을 탐색하며, 미확정 ③은 잠정 표시합니다. 새 봉 수집 시 재탐색하고 다른 봉으로 전환해도 작도 기준을 유지합니다. 자동은 주봉 → 일봉 순서입니다.</small>')+'<small class="data-source settings-instant">체크하면 즉시 적용됩니다.</small>';
  this.controls.querySelector('.indicator-buttons').after(panel);
  const close=()=>{this.expandedTool=null;this.panelDraft=null;this.renderControls()};panel.querySelector('[data-close-settings]').onclick=close;
  panel.querySelectorAll('[data-group]').forEach(input=>input.onchange=()=>{const group=input.dataset.group;if(group==='ma'){input.checked?d.ma.add(+input.value):d.ma.delete(+input.value);this.options.ma=new Set(d.ma);this.applyIndicators();this.renderControls()}else{d[group]=input.value;d.enabled=true;this.commitFibSettings(d)}});
  if(!ma)panel.querySelector('[data-enable]').onchange=e=>{d.enabled=e.target.checked;this.commitFibSettings(d)};
 }
 commitFibSettings(d){
  this.options.fib=d.enabled?d.mode:'off';this.options.fibFrame=d.frame;this.channelSelection=null;
  this.lastScalpRefreshBucket=Math.floor(Date.now()/(parseInt(d.frame)*60000||900000));
  if(this.chart&&this.data&&(!d.enabled||this.fibBasis===d.frame&&this.referenceData)){
   if(d.enabled)this.selectedCandidate=HongIndicators.fibonacci(this.referenceData.candles,d.mode,{interval:d.frame,currentPrice:this.interval===d.frame?this.data.candles.at(-1).close:this.referenceData.candles.at(-1)?.close});
   this.chart.priceScale('right').applyOptions({mode:d.enabled?LightweightCharts.PriceScaleMode.Logarithmic:LightweightCharts.PriceScaleMode.Normal});this.applyIndicators();this.renderControls();
  }else{if(['5m','15m'].includes(d.frame)&&d.enabled)this.interval=d.frame;this.load(this.item)}
 }
 openFullscreen(){
  if(this.fullscreenState)return;
  const root=document.createElement('section');root.className='chart-screen chart-screen-landscape';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','차트 전체화면');
  root.innerHTML='<div class="chart-screen-toolbar"><b>'+escapeHtml(this.item.name||this.item.tv)+' <small>'+escapeHtml(this.interval)+'</small></b><div><button data-screen-landscape aria-pressed="true">가로보기 ON</button><button data-screen-settings aria-expanded="false">설정</button><button data-screen-close aria-label="전체화면 닫기">닫기 ×</button></div></div><div class="chart-screen-chart"></div><div class="chart-screen-controls" hidden></div>';
  const chartSlot=document.createComment('chart'),controlSlot=document.createComment('controls');this.element.before(chartSlot);this.controls.before(controlSlot);
  const state={root,chartSlot,controlSlot,scroll:window.scrollY,overflow:document.body.style.overflow,htmlOverflow:document.documentElement.style.overflow,range:this.chart?.timeScale().getVisibleLogicalRange(),opening:true,native:false,locked:false,focus:document.activeElement};this.fullscreenState=state;
  root.querySelector('.chart-screen-chart').append(this.element);root.querySelector('.chart-screen-controls').append(this.controls);document.body.append(root);document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';
  const resize=()=>{const range=state.opening?state.range:this.chart?.timeScale().getVisibleLogicalRange();requestAnimationFrame(()=>{this.resize();requestAnimationFrame(()=>{if(range&&this.fullscreenState===state&&this.chart)this.chart.timeScale().setVisibleLogicalRange(range);state.opening=false})})};
  state.resize=resize;window.addEventListener('resize',resize);window.addEventListener('orientationchange',resize);state.key=e=>{if(e.key==='Escape'){e.preventDefault();this.closeFullscreen()}};document.addEventListener('keydown',state.key);
  state.change=()=>{if(state.native&&document.fullscreenElement!==root)this.closeFullscreen();else resize()};document.addEventListener('fullscreenchange',state.change);
  root.querySelector('[data-screen-close]').onclick=()=>this.closeFullscreen();root.querySelector('[data-screen-settings]').onclick=e=>{const controls=root.querySelector('.chart-screen-controls');controls.hidden=!controls.hidden;e.currentTarget.setAttribute('aria-expanded',String(!controls.hidden));resize()};
  root.querySelector('[data-screen-landscape]').onclick=e=>{const landscape=root.classList.toggle('chart-screen-landscape');e.currentTarget.textContent='가로보기 '+(landscape?'ON':'OFF');e.currentTarget.setAttribute('aria-pressed',String(landscape));if(!landscape&&state.locked){screen.orientation?.unlock?.();state.locked=false}resize()};
  root.querySelector('[data-screen-close]').focus({preventScroll:true});resize();
  if(root.requestFullscreen&&!document.fullscreenElement){try{const entered=root.requestFullscreen();Promise.resolve(entered).then(async()=>{if(this.fullscreenState!==state){if(document.fullscreenElement===root)await document.exitFullscreen();return}state.native=true;try{await screen.orientation?.lock?.('landscape');state.locked=!!screen.orientation?.lock;if(this.fullscreenState!==state&&state.locked)screen.orientation?.unlock?.()}catch{}resize()}).catch(()=>resize())}catch{resize()}}
 }
 closeFullscreen(){
  const state=this.fullscreenState;if(!state)return;this.fullscreenState=null;const range=this.chart?.timeScale().getVisibleLogicalRange();
  document.removeEventListener('fullscreenchange',state.change);document.removeEventListener('keydown',state.key);window.removeEventListener('resize',state.resize);window.removeEventListener('orientationchange',state.resize);
  if(state.locked)try{screen.orientation?.unlock?.()}catch{}
  if(document.fullscreenElement===state.root)try{document.exitFullscreen()?.catch(()=>{})}catch{}
  state.chartSlot.replaceWith(this.element);state.controlSlot.replaceWith(this.controls);state.root.remove();document.body.style.overflow=state.overflow;document.documentElement.style.overflow=state.htmlOverflow;window.scrollTo(0,state.scroll);this.controls.querySelector('[data-tool="fullscreen"]')?.focus({preventScroll:true});requestAnimationFrame(()=>{this.resize();requestAnimationFrame(()=>{if(range&&this.chart)this.chart.timeScale().setVisibleLogicalRange(range)})});
 }

 async refreshScalp(){
  if(this.item?.tv.startsWith('BINANCE:')&&this.data?.nativeBinance&&this.chart){
   const token=this.token,frame=this.options.fibFrame,mode=this.options.fib;
   const reference=completedReference(frame===this.interval?this.data:await HongData.binanceBars(this.item.tv,frame),frame);
   if(token!==this.token||!this.chart||mode!==this.options.fib||frame!==this.options.fibFrame)return;
   this.referenceData=reference;this.fibBasis=frame;this.selectedCandidate=HongIndicators.fibonacci(reference.candles,mode,{interval:frame,currentPrice:this.data.candles.at(-1).close});
   this.preserveViewport(()=>this.applyIndicators(true));return;
  }
  const range=this.chart?.timeScale().getVisibleLogicalRange();await this.load(this.item);if(range&&this.chart)this.chart.timeScale().setVisibleLogicalRange(range);
 }
 resize(){if(this.chart)this.chart.resize(this.element.clientWidth,this.element.clientHeight)}
};



