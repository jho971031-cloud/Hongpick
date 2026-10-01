/* TradingView Lightweight Charts 5.2.1. Indicators calculated from returned OHLCV. */
window.HongIndicators = {
 ma(candles, period) { let sum=0;const rows=[];candles.forEach((c,i)=>{sum+=c.close;if(i>=period)sum-=candles[i-period].close;if(i>=period-1)rows.push({time:c.time,value:sum/period})});return rows; },
 rsi(candles,period=14) {let g=0,l=0;const out=[];for(let i=1;i<candles.length;i++){const d=candles[i].close-candles[i-1].close;if(i<=period){g+=Math.max(d,0);l+=Math.max(-d,0);if(i<period)continue;g/=period;l/=period}else{g=(g*(period-1)+Math.max(d,0))/period;l=(l*(period-1)+Math.max(-d,0))/period}out.push({time:candles[i].time,value:l===0?(g===0?50:100):100-100/(1+g/l)})}return out;},
 ichimoku(candles,interval='D') {
  const times=candles.map(c=>c.time),minute=interval.endsWith('m');let d=new Date(minute?times.at(-1)*1000:times.at(-1)+'T12:00:00Z');for(let i=0;i<26;i++){if(minute)d=new Date(d.getTime()+parseInt(interval)*60000);else if(interval==='M')d.setUTCMonth(d.getUTCMonth()+1);else if(interval==='W')d.setUTCDate(d.getUTCDate()+7);else{do{d.setUTCDate(d.getUTCDate()+1)}while([0,6].includes(d.getUTCDay()))}times.push(minute?Math.floor(d.getTime()/1000):d.toISOString().slice(0,10))}
  const midpoint=(i,p)=>{if(i<p-1)return null;let hi=-Infinity,lo=Infinity;for(let j=i-p+1;j<=i;j++){hi=Math.max(hi,candles[j].high);lo=Math.min(lo,candles[j].low)}return(hi+lo)/2};const conversion=[],base=[],spanA=[],spanB=[],lag=[];
  candles.forEach((c,i)=>{const t=midpoint(i,9),k=midpoint(i,26),b=midpoint(i,52);if(t!=null)conversion.push({time:c.time,value:t});if(k!=null)base.push({time:c.time,value:k});if(t!=null&&k!=null)spanA.push({time:times[i+26],value:(t+k)/2});if(b!=null)spanB.push({time:times[i+26],value:b});if(i>=26)lag.push({time:times[i-26],value:c.close})});
  return {conversion,base,spanA,spanB,lag};
 },
 fibonacci(candles,mode='high',settings={}) {
  const frame=settings.interval||'W',daily=frame==='D',monthly=frame==='M',near=monthly?1:3,major=monthly?2:8,minBars=monthly?18:60,minGap=monthly?3:daily?20:26,maxGap=monthly?24:daily?252:208,touchLookback=monthly?6:26,touchSpread=monthly?2:daily?5:8,minTouches=monthly?2:3,retrace=daily?.08:.15,minSwing=daily?.18:monthly?.20:.30;
  if(!['high','low'].includes(mode)||candles.length<minBars)return null;
  const source=candles,rows=mode==='low'?source.map(c=>({...c,open:1/c.open,high:1/c.low,low:1/c.high,close:1/c.close})):source,n=rows.length;
  const piv=[];for(let i=near;i<n-near-1;i++)if(rows[i].high===Math.max(...rows.slice(i-near,i+near+1).map(x=>x.high)))piv.push(i);
  const found=[];
  for(const b of piv){
   const next=piv.find(i=>i>b)??n,ks=[];for(let i=b+1;i<Math.min(b+(monthly?7:21),next+1,n-1);i++)if(rows[i].close>rows[b].high*1.01&&rows[i+1].close>rows[b].high*1.01)ks.push(i);
   if(!ks.length)continue;const turn=ks[0],prior=piv.filter(i=>i<turn).at(-1);if(prior!==b)continue;
   const cs=piv.filter(i=>i>turn+1&&i>=major&&i+major<n&&rows[i].high===Math.max(...rows.slice(i-major,i+major+1).map(x=>x.high))&&Math.min(...rows.slice(i+1,i+major+1).map(x=>x.low))<=rows[i].high*(1-retrace));
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
    found.push({mode,a,b,c,turn,slope,width,zone,score:swing*100+Math.min(b-a,156)*.12+touches.length*.5+c*.015,anchors:[a,b,c].map((index,j)=>({point:j+1,index,time:source[index].time,price:mode==='high'?source[index].high:source[index].low}))});
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
function channelExtension(candles,interval,count=52){
 const result=candles.map(c=>({time:c.time})),minute=interval.endsWith('m');let date=new Date(minute?candles.at(-1).time*1000:candles.at(-1).time+'T12:00:00Z');
 for(let i=0;i<count;i++){if(minute)date=new Date(date.getTime()+parseInt(interval)*60000);else if(interval==='M'){date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1)}else if(interval==='W')date.setUTCDate(date.getUTCDate()+7);else{do{date.setUTCDate(date.getUTCDate()+1)}while([0,6].includes(date.getUTCDay()))}result.push({time:minute?Math.floor(date.getTime()/1000):date.toISOString().slice(0,10)})}return result;
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
const basisLabel=frame=>({AUTO:'자동',D:'일봉',W:'주봉',M:'월봉'}[frame]||frame);
function completedReference(data,frame){
 const today=new Date().toISOString().slice(0,10),month=today.slice(0,7);
 const candles=data.candles.filter(c=>frame==='M'?String(c.time).slice(0,7)<month:frame==='D'?String(c.time)<today:true);
 return {...data,candles,interval:frame};
}
class FibonacciBands {
 constructor(candles,candidate,priceAt){this.priceAt=priceAt;this.candles=candles;this.candidate=candidate;this.rows=[];this.colors=['rgba(82,189,88,.07)','rgba(255,81,91,.07)','rgba(0,169,141,.07)','rgba(255,173,22,.07)','rgba(0,189,217,.07)','rgba(146,152,159,.06)'];this.view={zOrder:()=> 'bottom',renderer:()=>({draw:target=>target.useMediaCoordinateSpace(({context:ctx})=>{for(let i=1;i<this.rows.length;i++){const left=this.rows[i-1],right=this.rows[i];if(!left||!right)continue;for(let band=0;band<6;band++){ctx.fillStyle=this.colors[band];ctx.beginPath();ctx.moveTo(left.x,left.y[band]);ctx.lineTo(right.x,right.y[band]);ctx.lineTo(right.x,right.y[band+1]);ctx.lineTo(left.x,left.y[band+1]);ctx.closePath();ctx.fill()}}})})}}
 attached({chart,series,requestUpdate}){this.chart=chart;this.series=series;requestUpdate()}
 updateAllViews(){const ratios=[0,.5,1,1.5,2,2.5,3];this.rows=[];for(let i=0;i<this.candles.length;i++){const x=this.chart.timeScale().timeToCoordinate(this.candles[i].time),y=ratios.map(r=>this.series.priceToCoordinate(this.priceAt(i,r)));this.rows.push(x==null||y.some(v=>v==null)?null:{x,y})}}
 paneViews(){return[this.view]}
}
window.HongChart=class {
 constructor(element,controls){this.element=element;this.controls=controls;this.options={ma:new Set([20]),rsi:false,ichi:false,fib:'off',fibFrame:'AUTO'};this.interval='D';this.series=[];this.token=0;this.item=null;this.referenceCache=new Map();}
 destroy(){if(this.chart)this.chart.remove();this.chart=null;this.series=[];this.cloud=null;this.fibCloud=null;this.fibMarkers=null;this.fibCandidate=null;this.candles=null;this.volume=null;}
 async load(item){this.item=item;this.data=null;const token=++this.token;this.destroy();this.element.innerHTML='<div class="chart-unavailable">실제 가격 데이터를 불러오는 중…</div>';this.renderControls();try{
 const wantsFib=this.options.fib!=='off',interval=this.interval;
 const getReference=async frame=>{const key=item.tv+':'+frame;if(this.referenceCache.has(key))return this.referenceCache.get(key);const d=completedReference(await api((frame==='W'?'/api/fib-history?symbol=':'/api/history?symbol=')+encodeURIComponent(item.tv)+(frame==='W'?'':'&interval='+frame)),frame);this.referenceCache.set(key,d);return d};
 const viewing=await api('/api/history?symbol='+encodeURIComponent(item.tv)+'&interval='+interval);if(token!==this.token)return;
 let selected=null,selectedFrame=null,candidate=null,reason='';
 const selectionKey=item.tv+':'+this.options.fib+':'+this.options.fibFrame;
 if(wantsFib&&this.channelSelection?.key===selectionKey){({reference:selected,frame:selectedFrame,candidate,reason}=this.channelSelection)}
 else if(wantsFib){
  const frames=this.options.fibFrame==='AUTO'?['W','D']: [this.options.fibFrame],price=viewing.candles.at(-1).close,time=viewing.candles.at(-1).time;
  for(const frame of frames){try{const reference=await getReference(frame),found=HongIndicators.fibonacci(reference.candles,this.options.fib,{interval:frame,currentPrice:price});
   if(this.options.fibFrame==='AUTO'&&frame==='W'&&!channelFit(found,reference.candles,price,time).useful){reason=found?'주봉 채널이 현재가에서 멀어 일봉으로 전환':'주봉 후보가 없어 일봉으로 전환';continue}
   selected=reference;selectedFrame=frame;candidate=found;break;
  }catch(error){reason=basisLabel(frame)+' 데이터 없음';if(this.options.fibFrame!=='AUTO')break}}
 }
 if(token!==this.token)return;if(wantsFib)this.channelSelection={key:selectionKey,reference:selected,frame:selectedFrame,candidate,reason};this.data=interval==='W'&&selectedFrame==='W'?selected:viewing;this.referenceData=selected;this.fibBasis=selectedFrame;this.selectedCandidate=candidate;this.fibReason=reason;this.draw();this.renderControls();

 }catch(e){if(token!==this.token)return;this.element.innerHTML='<div class="chart-unavailable"><b>차트 데이터 없음</b><p>'+escapeHtml(e.message)+'</p></div>';this.renderControls()}}

 draw(){this.destroy();this.element.replaceChildren();const L=LightweightCharts;this.chart=L.createChart(this.element,{autoSize:true,layout:{background:{color:'#0b1927'},textColor:'#8194a7',attributionLogo:true,panes:{separatorColor:'#183247'}},grid:{vertLines:{color:'#132a3c'},horzLines:{color:'#132a3c'}},rightPriceScale:{borderColor:'#183247',mode:this.options.fib==='off'?L.PriceScaleMode.Normal:L.PriceScaleMode.Logarithmic},timeScale:{borderColor:'#183247',rightOffset:4,timeVisible:this.interval.endsWith('m'),secondsVisible:false},localization:{locale:'ko-KR'},crosshair:{mode:L.CrosshairMode.Normal}});this.candles=this.chart.addSeries(L.CandlestickSeries,{upColor:'#16d79b',downColor:'#ff526d',borderVisible:false,wickUpColor:'#16d79b',wickDownColor:'#ff526d'});this.candles.setData(this.data.candles);this.candles.priceScale().applyOptions({scaleMargins:{top:0.08,bottom:0.2}});this.volume=this.chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});this.volume.setData(this.data.candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'#16d79b38':'#ff526d38'})));this.volume.priceScale().applyOptions({scaleMargins:{top:0.82,bottom:0}});this.applyIndicators();const count=this.data.candles.length,from=this.fibCandidate&&this.interval===this.fibBasis?Math.max(0,this.fibCandidate.zone.from-16):Math.max(0,count-120);this.chart.timeScale().setVisibleLogicalRange({from,to:count+(this.fibCandidate?18:5)});}
 applyIndicators(){
  if(!this.chart)return;
  for(const series of this.series)this.chart.removeSeries(series);this.series=[];
  if(this.cloud){this.candles.detachPrimitive(this.cloud);this.cloud=null}
  if(this.fibCloud){this.candles.detachPrimitive(this.fibCloud);this.fibCloud=null}
  if(this.fibMarkers){this.candles.detachPrimitive(this.fibMarkers);this.fibMarkers=null}
  this.fibCandidate=null;this.fibStatus='';
  const L=LightweightCharts,add=(data,color,pane=0,extra={})=>{const series=this.chart.addSeries(L.LineSeries,{color,lineWidth:1,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false,...extra},pane);series.setData(data);this.series.push(series);return series};
  const colors={20:'#f4c95d',60:'#58adff',120:'#b58eff',200:'#f790ad'};
  for(const period of this.options.ma)add(HongIndicators.ma(this.data.candles,period),colors[period]);
  if(this.options.ichi){const d=HongIndicators.ichimoku(this.data.candles,this.interval);add(d.conversion,'#4d9bff');add(d.base,'#ff765d');add(d.spanA,'#16d79b');add(d.spanB,'#ff526d');add(d.lag,'#bb8ae8');this.cloud=new IchimokuCloud(d.spanA,d.spanB);this.candles.attachPrimitive(this.cloud)}
  if(this.options.fib!=='off'){
   const candidate=this.selectedCandidate;this.fibCandidate=candidate;
   if(candidate){
    const palette={0:'#92989f',.5:'#52bd58',1:'#ff515b',1.5:'#00a98d',2:'#ffad16',2.5:'#00bdd9',3:'#92989f'},extended=channelExtension(this.data.candles,this.interval);
    const priceAt=channelProjection(candidate,this.referenceData.candles,extended,this.data.candles.length);
    for(const [ratio,color] of Object.entries(palette)){const r=Number(ratio),data=[];for(let i=0;i<extended.length;i++){const value=priceAt(i,r);if(Number.isFinite(value)&&value>0)data.push({time:extended[i].time,value})}add(data,color,0,{lineWidth:r===0||r===1?2:1,lastValueVisible:true,title:String(r),autoscaleInfoProvider:()=>null})}
    const first=chartSeconds(this.data.candles[0].time),last=chartSeconds(this.data.candles.at(-1).time),markers=candidate.anchors.filter(x=>chartSeconds(x.time)>=first&&chartSeconds(x.time)<=last).map((x,i)=>{const nearest=this.data.candles.reduce((best,row)=>Math.abs(chartSeconds(row.time)-chartSeconds(x.time))<Math.abs(chartSeconds(best.time)-chartSeconds(x.time))?row:best);return {time:nearest.time,position:this.options.fib==='high'?'aboveBar':'belowBar',color:'#edf7ff',shape:'circle',text:['①','②','③'][x.point-1]}});
    this.fibMarkers=L.createSeriesMarkers(this.candles,markers);

    this.fibCloud=new FibonacciBands(extended,candidate,priceAt);this.candles.attachPrimitive(this.fibCloud);
    this.fibStatus=(this.fibReason?this.fibReason+' · ':'')+(this.options.fib==='high'?'고–고–고':'저–저–저')+' · 오른쪽 연장 · ① '+candidate.anchors[0].time+' · ② '+candidate.anchors[1].time+' · 변곡 '+this.referenceData.candles[candidate.turn].time+' · ③ '+candidate.anchors[2].time;
   }else this.fibStatus=(this.fibReason?this.fibReason+' · ':'')+basisLabel(this.fibBasis||this.options.fibFrame)+' 기준에서 조건을 충족하는 후보가 없습니다.';
  }
  if(this.options.rsi){const rsi=HongIndicators.rsi(this.data.candles),series=add(rsi,'#b58eff',1,{priceScaleId:'right',priceFormat:{type:'price',precision:1,minMove:.1},lastValueVisible:true});series.priceScale().applyOptions({mode:L.PriceScaleMode.Normal,autoScale:true,scaleMargins:{top:.12,bottom:.12}});series.applyOptions({autoscaleInfoProvider:(base)=>{const range=base()?.priceRange;return {priceRange:{minValue:Math.min(20,range?.minValue??20),maxValue:Math.max(80,range?.maxValue??80)}}}});for(const value of [30,70])series.createPriceLine({price:value,color:'#71899c',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});const panes=this.chart.panes();panes[0].setStretchFactor(4);panes[1].setStretchFactor(1.5)}
  this.renderControls();
 }
 renderControls(){
  if(!this.item)return;const saved=state.watch.some(x=>x.tv===this.item.tv),fibLabel=this.options.fib==='high'?'고–고–고':this.options.fib==='low'?'저–저–저':'OFF';
  this.controls.innerHTML='<div class="indicator-buttons"><button data-tool="ma" class="'+(this.options.ma.size?'on':'')+'">이동평균선 '+[...this.options.ma].sort((a,b)=>a-b).join('/')+'</button><button data-tool="rsi" class="'+(this.options.rsi?'on':'')+'">RSI(14) '+(this.options.rsi?'ON':'OFF')+'</button><button data-tool="ichi" class="'+(this.options.ichi?'on':'')+'">일목균형표 '+(this.options.ichi?'ON':'OFF')+'</button><button data-tool="fib" class="'+(this.options.fib!=='off'?'on':'')+'">자동 빗각 '+fibLabel+(this.options.fib!=='off'?' · '+basisLabel(this.fibBasis||this.options.fibFrame):'')+'</button><button data-watch="'+escapeHtml(this.item.tv)+'" class="'+(saved?'on':'')+'">'+(saved?'★ 저장됨':'☆ 관심 저장')+'</button></div><div class="filters timeframe">'+['1m','5m','15m','D','W','M'].map((v,i)=>'<button data-interval="'+v+'" class="'+(v===this.interval?'sel':'')+'">'+['1분','5분','15분','일봉','주봉','월봉'][i]+'</button>').join('')+'</div><small class="data-source">'+(this.data?escapeHtml(this.data.source)+' · 마지막 봉 '+this.data.lastBar+' · 수집 '+formatDate(this.data.updated)+(this.data.stale?' · 이전 데이터':''):'가격 데이터')+(this.data&&[...this.options.ma].some(p=>p>this.data.candles.length)?'<br>선택한 MA 중 봉 수가 부족한 기간은 데이터가 없습니다.':'')+(this.fibStatus?'<br><span class="fib-status">'+basisLabel(this.fibBasis||this.options.fibFrame)+' 기준 · 봉 전환 시 유지: '+escapeHtml(this.fibStatus)+'</span>':'')+'<br>일목: 9 / 26 / 52 / 26 · 구름 불투명도 30% · <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Chart by TradingView Lightweight Charts</a></small>';
  this.controls.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>{const key=button.dataset.tool;if(key==='ma')this.maMenu();else if(key==='fib')this.fibMenu();else{this.options[key==='ichi'?'ichi':'rsi']=!this.options[key==='ichi'?'ichi':'rsi'];this.applyIndicators()}});
  this.controls.querySelectorAll('[data-interval]').forEach(button=>button.onclick=()=>{this.interval=button.dataset.interval;this.data=null;this.load(this.item)})
 }
 maMenu(){const back=document.createElement('div');back.className='modal-back';back.innerHTML='<section class="modal" role="dialog" aria-modal="true" aria-label="이동평균선 선택"><div class="modal-head"><h2>이동평균선</h2><button aria-label="닫기">×</button></div><div class="check-list">'+[20,60,120,200].map(p=>'<label><input type="checkbox" value="'+p+'" '+(this.options.ma.has(p)?'checked':'')+'> MA '+p+'</label>').join('')+'</div><small class="data-source">현재 차트 봉의 종가로 계산합니다.</small></section>';const close=()=>back.remove();back.onclick=e=>{if(e.target===back)close()};back.querySelector('button').onclick=close;back.querySelectorAll('input').forEach(input=>input.onchange=()=>{input.checked?this.options.ma.add(+input.value):this.options.ma.delete(+input.value);this.applyIndicators()});back.onkeydown=e=>{if(e.key==='Escape')close()};document.body.append(back);back.querySelector('input').focus()}
 fibMenu(){
 const back=document.createElement('div');back.className='modal-back';
 back.innerHTML='<section class="modal" role="dialog" aria-modal="true" aria-label="자동 빗각 선택"><div class="modal-head"><div><h2>자동 빗각</h2><p>작도 기준 봉과 화면에 보는 봉을 따로 선택합니다.</p></div><button aria-label="닫기">×</button></div><label class="fib-basis-label" style="display:grid;gap:8px;margin-top:16px;font-size:12px">작도 기준 <select aria-label="작도 기준 봉" style="width:100%;padding:12px;background:#07131f;color:#edf5fb;border:1px solid #244258;border-radius:10px">'+['AUTO','W','D','M'].map(frame=>'<option value="'+frame+'" '+(frame===this.options.fibFrame?'selected':'')+'>'+basisLabel(frame)+(frame==='AUTO'?' · 주봉 → 일봉':'')+'</option>').join('')+'</select></label><div class="fib-mode-list"><button data-fib="high"><b>고–고–고</b><span>저항 고점 → 변곡 직전 마지막 고점 → 변곡 이후 고점</span></button><button data-fib="low"><b>저–저–저</b><span>지지 저점 → 변곡 직전 마지막 저점 → 변곡 이후 저점</span></button><button data-fib="off"><b>끄기</b><span>자동 채널을 숨깁니다.</span></button></div><small class="data-source">자동은 주봉을 먼저 확인하고, 채널이 현재가에서 멀거나 후보가 없으면 일봉으로 전환합니다. 주봉의 기존 작도 조건과 ① → ② → 변곡 → ③ 순서는 유지합니다. 일봉은 짧은 구간의 고점·저점을 확인합니다. 월봉은 최근 2년 자료를 사용하므로 후보가 부족할 수 있습니다. 선택 후 화면 봉을 바꿔도 기준점은 유지됩니다.</small></section>';
 const close=()=>back.remove();back.onclick=e=>{if(e.target===back)close()};back.querySelector('.modal-head>button').onclick=close;
 back.querySelectorAll('[data-fib]').forEach(button=>button.onclick=()=>{const mode=button.dataset.fib,frame=back.querySelector('select').value;this.options.fib=mode;this.options.fibFrame=frame;this.channelSelection=null;close();this.load(this.item)});
 back.onkeydown=e=>{if(e.key==='Escape')close()};document.body.append(back);back.querySelector('select').focus();
 }

 resize(){if(this.chart)this.chart.resize(this.element.clientWidth,this.element.clientHeight)}
};


