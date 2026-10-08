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
  const frame=settings.interval||'W',daily=frame==='D',monthly=frame==='M',near=monthly?1:3,major=monthly?2:8,minBars=monthly?18:60,minGap=monthly?3:daily?20:26,maxGap=monthly?24:daily?252:208,touchLookback=monthly?6:26,touchSpread=monthly?2:daily?5:8,minTouches=monthly?2:3,retrace=daily?.08:.15,minSwing=daily?.18:monthly?.20:.30;
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
   const peakWindow=monthly?3:daily?10:13;
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
    found.push({mode,a,b,c,turn,slope,width,zone,score:swing*100+Math.min(b-a,156)*.12+touches.length*.5-(n-1-c)*(daily?.06:monthly?1:.3),anchors:[a,b,c].map((index,j)=>({point:j+1,index,time:source[index].time,price:mode==='high'?source[index].high:source[index].low}))});
   }
  }
  const final=new Map();for(const x of found){const key=x.a+':'+x.c,old=final.get(key);if(!old||x.b>old.b)final.set(key,x)}
  const candidates=[...final.values()];
  if(frame!=='W'&&settings.currentPrice>0)for(const x of candidates){const fit=channelFit(x,source,settings.currentPrice,source.at(-1).time);x.score-=fit.distance*100+Math.abs(x.width)*20;x.score+=x.c*.10}
  return candidates.sort((a,b)=>b.score-a.score)[0]||null;
 }
};
class IchimokuCloud {
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
// After the last real bar, continue the visible tangent by chart bar index.
// The time scale spaces bars equally even across weekends and market holidays.
function channelProjection(candidate,reference,points,actualCount){
 const lastPosition=referencePosition(points[actualCount-1].time,reference);
 const priorPosition=referencePosition(points[actualCount-2].time,reference);
 const logLast=Math.log(candidate.anchors[0].price)+candidate.slope*(lastPosition-candidate.a);
 const logStep=candidate.slope*(lastPosition-priorPosition);
 return (index,ratio=0)=>index<actualCount
  ?channelPrice(candidate,reference,points[index].time,ratio)
  :Math.exp(logLast+logStep*(index-actualCount+1)+ratio*candidate.width);
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
 const candles=data.candles.filter(c=>['5m','15m'].includes(frame)?c.time*1000+parseInt(frame)*60000<=asOf:frame==='M'?String(c.time).slice(0,7)<month:frame==='D'?String(c.time)<today:true);
 return {...data,candles,interval:frame};
}
class FibonacciBands {
 constructor(candles,candidate,priceAt){this.priceAt=priceAt;this.candles=candles;this.candidate=candidate;this.rows=[];this.colors=['rgba(82,189,88,.07)','rgba(255,81,91,.07)','rgba(0,169,141,.07)','rgba(255,173,22,.07)','rgba(0,189,217,.07)','rgba(146,152,159,.06)'];this.view={zOrder:()=> 'bottom',renderer:()=>({draw:target=>target.useMediaCoordinateSpace(({context:ctx})=>{for(let i=1;i<this.rows.length;i++){const left=this.rows[i-1],right=this.rows[i];if(!left||!right)continue;for(let band=0;band<6;band++){ctx.fillStyle=this.colors[band];ctx.beginPath();ctx.moveTo(left.x,left.y[band]);ctx.lineTo(right.x,right.y[band]);ctx.lineTo(right.x,right.y[band+1]);ctx.lineTo(left.x,left.y[band+1]);ctx.closePath();ctx.fill()}}})})}}
 attached({chart,series,requestUpdate}){this.chart=chart;this.series=series;requestUpdate()}
 updateAllViews(){const ratios=[0,.5,1,1.5,2,2.5,3];this.rows=[];for(let i=0;i<this.candles.length;i++){const x=this.chart.timeScale().timeToCoordinate(this.candles[i].time),y=ratios.map(r=>this.series.priceToCoordinate(this.priceAt(i,r)));this.rows.push(x==null||y.some(v=>v==null)?null:{x,y})}}
 paneViews(){return[this.view]}
}
window.HongChart=class {
 constructor(element,controls){this.element=element;this.controls=controls;this.options={ma:new Set([20]),rsi:false,ichi:false,fib:'off',fibFrame:'AUTO'};this.interval='D';this.series=[];this.token=0;this.item=null;this.referenceCache=new Map();this.expandedTool=null;this.panelDraft=null;}
 destroy(){if(this.chart)this.chart.remove();this.chart=null;this.series=[];this.cloud=null;this.fibCloud=null;this.fibMarkers=null;this.fibCandidate=null;this.candles=null;this.volume=null;}
 async load(item){this.item=item;this.data=null;const token=++this.token;this.destroy();this.element.innerHTML='<div class="chart-unavailable">실제 가격 데이터를 불러오는 중…</div>';this.renderControls();try{
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
 if(token!==this.token)return;if(wantsFib&&!scalp)this.channelSelection={key:selectionKey,reference:selected,frame:selectedFrame,candidate,reason};this.data=interval==='W'&&selectedFrame==='W'?selected:viewing;this.referenceData=selected;this.fibBasis=selectedFrame;this.selectedCandidate=candidate;this.fibReason=reason;this.draw();this.renderControls();

 }catch(e){if(token!==this.token)return;this.element.innerHTML='<div class="chart-unavailable"><b>차트 데이터 없음</b><p>'+escapeHtml(e.message)+'</p></div>';this.renderControls()}}

 draw(){const last=this.data.candles.at(-1)?.close||1,precision=this.item?.type==='crypto'?Math.min(12,Math.max(2,4-Math.floor(Math.log10(last)))):2;this.priceFormat={type:'price',precision,minMove:10**-precision};this.destroy();this.element.replaceChildren();const L=LightweightCharts;this.chart=L.createChart(this.element,{autoSize:true,layout:{background:{color:'#0b1927'},textColor:'#8194a7',attributionLogo:true,panes:{separatorColor:'#183247'}},grid:{vertLines:{color:'#132a3c'},horzLines:{color:'#132a3c'}},rightPriceScale:{borderColor:'#183247',mode:this.options.fib==='off'?L.PriceScaleMode.Normal:L.PriceScaleMode.Logarithmic},timeScale:{borderColor:'#183247',rightOffset:4,timeVisible:this.interval.endsWith('m'),secondsVisible:false},localization:{locale:'ko-KR'},crosshair:{mode:L.CrosshairMode.Normal}});this.candles=this.chart.addSeries(L.CandlestickSeries,{priceFormat:this.priceFormat,upColor:'#16d79b',downColor:'#ff526d',borderVisible:false,wickUpColor:'#16d79b',wickDownColor:'#ff526d'});this.candles.setData(this.data.candles);this.candles.priceScale().applyOptions({scaleMargins:{top:0.08,bottom:0.2}});this.volume=this.chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});this.volume.setData(this.data.candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'#16d79b38':'#ff526d38'})));this.volume.priceScale().applyOptions({scaleMargins:{top:0.82,bottom:0}});this.applyIndicators();const count=this.data.candles.length,from=this.fibCandidate&&this.interval===this.fibBasis?Math.max(0,this.fibCandidate.zone.from-16):Math.max(0,count-120);this.chart.timeScale().setVisibleLogicalRange({from,to:count+(this.fibCandidate?18:5)});}
 applyIndicators(){
  if(!this.chart)return;
  for(const series of this.series)this.chart.removeSeries(series);this.series=[];
  if(this.cloud){this.candles.detachPrimitive(this.cloud);this.cloud=null}
  if(this.fibCloud){this.candles.detachPrimitive(this.fibCloud);this.fibCloud=null}
  if(this.fibMarkers){this.candles.detachPrimitive(this.fibMarkers);this.fibMarkers=null}
  this.fibCandidate=null;this.fibStatus='';
  const L=LightweightCharts,add=(data,color,pane=0,extra={})=>{const series=this.chart.addSeries(L.LineSeries,{priceFormat:this.priceFormat,color,lineWidth:1,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,...extra},pane);series.setData(data);this.series.push(series);return series};
  const colors={20:'#f4c95d',60:'#58adff',120:'#b58eff',200:'#f790ad'};
  for(const period of this.options.ma)add(HongIndicators.ma(this.data.candles,period),colors[period]);
  if(this.options.ichi){const d=HongIndicators.ichimoku(this.data.candles,this.interval,this.item?.type==='crypto');add(d.conversion,'#4d9bff');add(d.base,'#ff765d');add(d.spanA,'#16d79b');add(d.spanB,'#ff526d');add(d.lag,'#bb8ae8');this.cloud=new IchimokuCloud(d.spanA,d.spanB);this.candles.attachPrimitive(this.cloud)}
  if(this.options.fib!=='off'){
   const candidate=this.selectedCandidate;this.fibCandidate=candidate;
   if(candidate){
    const palette={0:'#92989f',.5:'#52bd58',1:'#ff515b',1.5:'#00a98d',2:'#ffad16',2.5:'#00bdd9',3:'#92989f'},extended=channelExtension(this.data.candles,this.interval,52,this.item?.type==='crypto');
    const priceAt=channelProjection(candidate,this.referenceData.candles,extended,this.data.candles.length);
    for(const [ratio,color] of Object.entries(palette)){const r=Number(ratio),data=[];for(let i=0;i<extended.length;i++){const value=priceAt(i,r);if(Number.isFinite(value)&&value>0)data.push({time:extended[i].time,value})}add(data,color,0,{lineWidth:r===0||r===1?2:1,lastValueVisible:true,title:String(r),autoscaleInfoProvider:()=>null})}
    const first=chartSeconds(this.data.candles[0].time),last=chartSeconds(this.data.candles.at(-1).time),markers=candidate.anchors.filter(x=>chartSeconds(x.time)>=first&&chartSeconds(x.time)<=last).map((x,i)=>{const nearest=this.data.candles.reduce((best,row)=>Math.abs(chartSeconds(row.time)-chartSeconds(x.time))<Math.abs(chartSeconds(best.time)-chartSeconds(x.time))?row:best);return {time:nearest.time,position:this.options.fib==='high'?'aboveBar':'belowBar',color:'#edf7ff',shape:'circle',text:['①','②','③'][x.point-1]}});
    this.fibMarkers=L.createSeriesMarkers(this.candles,markers);

    this.fibCloud=new FibonacciBands(extended,candidate,priceAt);this.candles.attachPrimitive(this.fibCloud);
    this.fibStatus=(this.fibReason?this.fibReason+' · ':'')+(this.options.fib==='high'?'고–고–고':'저–저–저')+' · 오른쪽 연장 · ① '+anchorTime(candidate.anchors[0].time)+' · ② '+anchorTime(candidate.anchors[1].time)+' · 변곡 '+anchorTime(this.referenceData.candles[candidate.turn].time)+' · ③ '+anchorTime(candidate.anchors[2].time)+(candidate.active?' · 수집 기준 진행 구간'+(candidate.provisional?' · ③ 잠정':' · ③ 반전 확인'):'');
   }else this.fibStatus=(this.fibReason?this.fibReason+' · ':'')+basisLabel(this.fibBasis||this.options.fibFrame)+' 기준에서 조건을 충족하는 후보가 없습니다.';
  }
  if(this.options.rsi){const rsi=HongIndicators.rsi(this.data.candles),series=add(rsi,'#b58eff',1,{priceScaleId:'right',priceFormat:{type:'price',precision:1,minMove:.1},lastValueVisible:true});series.priceScale().applyOptions({mode:L.PriceScaleMode.Normal,autoScale:true,scaleMargins:{top:.12,bottom:.12}});series.applyOptions({autoscaleInfoProvider:(base)=>{const range=base()?.priceRange;return {priceRange:{minValue:Math.min(20,range?.minValue??20),maxValue:Math.max(80,range?.maxValue??80)}}}});for(const value of [30,70])series.createPriceLine({price:value,color:'#71899c',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});const panes=this.chart.panes();panes[0].setStretchFactor(4);panes[1].setStretchFactor(1.5)}
  this.renderControls();
 }
 renderControls(){
  if(!this.item)return;const saved=state.watch.some(x=>x.tv===this.item.tv),fibLabel=this.options.fib==='high'?'고–고–고':this.options.fib==='low'?'저–저–저':'OFF';
  this.controls.innerHTML='<div class="indicator-buttons"><button data-tool="ma" class="'+(this.options.ma.size?'on':'')+'">이동평균선 '+[...this.options.ma].sort((a,b)=>a-b).join('/')+'</button><button data-tool="rsi" class="'+(this.options.rsi?'on':'')+'">RSI(14) '+(this.options.rsi?'ON':'OFF')+'</button><button data-tool="ichi" class="'+(this.options.ichi?'on':'')+'">일목균형표 '+(this.options.ichi?'ON':'OFF')+'</button><button data-tool="fib" class="'+(this.options.fib!=='off'?'on':'')+'">자동 빗각 '+fibLabel+(this.options.fib!=='off'?' · '+basisLabel(this.fibBasis||this.options.fibFrame):'')+'</button><button data-tool="scalp5" class="'+(this.options.fibFrame==='5m'&&this.options.fib!=='off'?'on':'')+'">5분 단타 빗각'+(this.options.fibFrame==='5m'&&this.options.fib!=='off'?' ON':' OFF')+'</button><button data-tool="scalp" class="'+(this.options.fibFrame==='15m'&&this.options.fib!=='off'?'on':'')+'">15분 단타 빗각'+(this.options.fibFrame==='15m'&&this.options.fib!=='off'?' ON':' OFF')+'</button><button data-tool="fullscreen">⛶ 전체화면</button><button data-watch="'+escapeHtml(this.item.tv)+'" class="'+(saved?'on':'')+'">'+(saved?'★ 저장됨':'☆ 관심 저장')+'</button></div><div class="filters timeframe">'+['1m','5m','15m','D','W','M'].map((v,i)=>'<button data-interval="'+v+'" class="'+(v===this.interval?'sel':'')+'">'+['1분','5분','15분','일봉','주봉','월봉'][i]+'</button>').join('')+'</div><small class="data-source">'+(this.data?escapeHtml(this.data.source)+' · 마지막 봉 '+this.data.lastBar+' · 수집 '+formatDate(this.data.updated)+(this.data.stale?' · 이전 데이터':''):'가격 데이터')+(this.data&&[...this.options.ma].some(p=>p>this.data.candles.length)?'<br>선택한 MA 중 봉 수가 부족한 기간은 데이터가 없습니다.':'')+(this.fibStatus?'<br><span class="fib-status">'+basisLabel(this.fibBasis||this.options.fibFrame)+' 기준 · 봉 전환 시 유지: '+escapeHtml(this.fibStatus)+'</span>':'')+'<br>일목: 9 / 26 / 52 / 26 · 구름 불투명도 30% · <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Chart by TradingView Lightweight Charts</a></small>';
  this.controls.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>{const key=button.dataset.tool;if(key==='fullscreen')this.openFullscreen();else if(key==='ma')this.maMenu();else if(key==='fib')this.fibMenu();else if(key==='scalp')this.fibMenu('15m');else if(key==='scalp5')this.fibMenu('5m');else{this.options[key==='ichi'?'ichi':'rsi']=!this.options[key==='ichi'?'ichi':'rsi'];this.applyIndicators()}});
  this.renderSettings();
  this.controls.querySelectorAll('[data-interval]').forEach(button=>button.onclick=()=>{this.interval=button.dataset.interval;this.data=null;this.load(this.item)})
 }
 maMenu(){this.toggleSettings('ma')}
 fibMenu(defaultFrame=null){this.toggleSettings(defaultFrame==='5m'?'scalp5':defaultFrame==='15m'?'scalp':'fib',defaultFrame)}
 toggleSettings(tool,frame=null){
  if(this.expandedTool===tool){this.expandedTool=null;this.panelDraft=null}else{this.expandedTool=tool;this.panelDraft={frame:frame||this.options.fibFrame,mode:this.options.fib==='off'?'high':this.options.fib,enabled:this.options.fib!=='off',ma:new Set(this.options.ma)}}
  this.renderControls();this.controls.querySelector('[data-settings-panel] input')?.focus({preventScroll:true});
 }
 renderSettings(){
  for(const button of this.controls.querySelectorAll('[data-tool]'))if(['ma','fib','scalp','scalp5'].includes(button.dataset.tool)){button.setAttribute('aria-expanded',String(this.expandedTool===button.dataset.tool));button.textContent+=' '+(this.expandedTool===button.dataset.tool?'▴':'▾')}
  if(!this.expandedTool||!this.panelDraft)return;
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

 async refreshScalp(){const range=this.chart?.timeScale().getVisibleLogicalRange();await this.load(this.item);if(range&&this.chart)this.chart.timeScale().setVisibleLogicalRange(range)}
 resize(){if(this.chart)this.chart.resize(this.element.clientWidth,this.element.clientHeight)}
};



