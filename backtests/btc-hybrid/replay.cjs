const fs=require('fs'),vm=require('vm'),readline=require('readline');
const input='tick-input/',out='tick-output/';fs.mkdirSync(out,{recursive:true});
const read=n=>JSON.parse(fs.readFileSync(input+n+'.json'));
const manifest=read('manifest'),mins=read('futures-1m'),marks=read('mark-1m');if(manifest.symbol!=='BTCUSDT')throw Error('Wrong symbol');
const START=Date.parse(manifest.start_utc)/1000,END=Date.parse(manifest.end_utc_exclusive)/1000;
const box={window:{}};vm.createContext(box);vm.runInContext(fs.readFileSync(input+'charts-source.js','utf8'),box);
const I=box.window.HongIndicators;
function buildSignals(bars,seconds){
 const rsis=new Map(I.rsi(bars).map(r=>[r.time,r.value])),signals=new Map();
 for(let i=288;i<bars.length;i++){
  const history=bars.slice(0,i),rsi=rsis.get(history.at(-1).time);
  if(rsi>30&&rsi<70)continue;
  signals.set(bars[i].time,{rsi,channels:['high','low'].map(m=>I.intradayFibonacci(history,m)).filter(Boolean).map(c=>{
   const [a,b,d]=c.anchors,slope=Math.log(b.price/a.price)/((b.time-a.time)/seconds);
   return {...c,frameSeconds:seconds,origin:a.price,epoch:a.time,slope,width:Math.log(d.price/a.price)-slope*(d.time-a.time)/seconds};
  })});
 }
 return signals;
}
const signalSets={900:buildSignals(read('futures-15m'),900),3600:buildSignals(read('futures-60m'),3600)};
const ratios=[0,.5,1,1.5,2,2.5,3];
const levels=(c,t)=>ratios.map(r=>c.origin*Math.exp(c.slope*(t-c.epoch)/c.frameSeconds+r*c.width)).sort((a,b)=>a-b);

function makeEngine(cfg){
 const signals=signalSets[cfg.frameSeconds];
 const out='tick-output/'+cfg.id+'/';fs.mkdirSync(out,{recursive:true});
const FEE=.0005,MMR=.004;
let peakMark=1000,maxMarkDD=0,fillVersion=0,minuteFillVersion=-1,minuteStartPosition=null,firstUnsafe=null,liquidation=null,halted=false;
function markSnapshot(){if(minuteKey===null)return;const m=markMap.get(minuteKey);if(!m)throw Error('Missing mark');const equity=cash+(pos?pos.margin+pos.side*(pos.qty*m.close-pos.cost):0);peakMark=Math.max(peakMark,equity);maxMarkDD=Math.max(maxMarkDD,(peakMark-equity)/peakMark);curve.push({time:minuteKey,equity});}
let cash=1000,pos=null,pending=null,previous=null,totalTicks=0,firstTick=null,lastTick=null;
let minHeadroom=Infinity,maxDD=0,peak=1000,minuteKey=null,ohlc=null,mismatches=0,checkedMinutes=0,ambiguousLiquidation=false,idGapCount=0,unusedIdCount=0;
const events=[],trades=[],curve=[],audit=[],minutesMap=new Map(mins.map(x=>[x.time,x])),markMap=new Map(marks.map(x=>[x.time,x]));
const record=(obj)=>{events.push(obj);audit.push({event:obj,previousTick:previous});};
function finishMinute(){
 if(!ohlc)return;markSnapshot();
 const expected=minutesMap.get(minuteKey);checkedMinutes++;
 if(!expected||(['open','high','low','close'].some(k=>Math.abs(expected[k]-ohlc[k])>1e-6)||Math.abs(expected.volume-ohlc.volume)>1e-5))mismatches++;
 if(pos&&minuteStartPosition&&minuteFillVersion===fillVersion&&!liquidation){
  const m=markMap.get(minuteKey),p=pos,worst=p.side===1?m.low:m.high;
  const equityAt=x=>cash+p.margin+p.side*(p.qty*x-p.cost);
  const head=equityAt(worst)-p.qty*worst*MMR;
  if(head<=0){
   const threshold=(cash+p.margin-p.side*p.cost)/(p.qty*(MMR-p.side));
   liquidation={interval:{start:minuteKey,endExclusive:minuteKey+60},firstUnsafe,position:JSON.parse(JSON.stringify(p)),cash,mark:m,theoreticalLiquidationPrice:threshold,equityAtThreshold:equityAt(threshold),maintenanceAtThreshold:p.qty*threshold*MMR,assumedClearanceRate:.0125,clearanceFeeNotional:p.qty*threshold*.0125,walletBefore:p.startEquity,hypotheticalLastTradeNet:-p.startEquity,settlement:'Full liquidation simplification: remaining collateral consumed by clearance fee capped at available funds. Zero balance, no further entries. Not an actual exchange liquidation fill.',proof:'Position unchanged for the entire recorded mark-price minute with zero fills/rejections. Actual adverse mark extreme breaches maintenance without guessing OHLC order.'};
   if(Math.abs(1000+trades.reduce((a,t)=>a+t.pnl,0)-p.startEquity)>1e-6)throw Error('Pre-liquidation ledger mismatch');
   record({time:minuteKey+60,action:'cross-liquidation-model',interval:liquidation.interval,theoreticalLiquidationPrice:threshold,net:-p.startEquity});
   halted=true;cash=0;pos=null;pending=null;maxDD=1;maxMarkDD=1;curve.push({time:minuteKey,equity:0,modeledLiquidation:true});
  }
 }

}
function fill(tick){
 fillVersion++;
 const order=pending;pending=null;
 if(order.type==='entry')pos={side:order.side,channel:order.channel,k:order.k,legMargin:cash*.10,startEquity:cash,margin:0,cost:0,qty:0,fees:0,legs:0,time:tick.time,rsi:order.rsi,firstPrice:tick.price};
 if(order.type==='entry'||order.type==='average'){
  const margin=pos.legMargin,notional=margin*100,existingPnl=pos.side*(pos.qty*tick.price-pos.cost);
  if(cash+existingPnl<margin+notional*FEE){record({...tick,action:'order-rejected',type:order.type});if(!pos.legs)pos=null;else pos.averageBlocked=true;return;}
  const qty=notional/tick.price;cash-=margin+notional*FEE;pos.margin+=margin;pos.cost+=notional;pos.qty+=qty;pos.fees+=notional*FEE;pos.legs++;
  if(order.type==='average')pos.k=order.k;
  record({...tick,action:order.type,side:pos.side,legs:pos.legs,qty,margin,anchors:pos.channel.anchors,rsi:pos.rsi,trigger:order.trigger});
 }else {
  const gross=pos.side*(pos.qty*tick.price-pos.cost),exitFee=pos.qty*tick.price*FEE,net=gross-exitFee-pos.fees;
  cash+=pos.margin+gross-exitFee;
  trades.push({startEquity:pos.startEquity,lossLimit:.1*pos.startEquity,quantity:pos.qty,initialMargin:pos.legMargin,side:pos.side===1?'LONG':'SHORT',entryTime:pos.time,exitTime:tick.time,entryPrice:pos.firstPrice,averagePrice:pos.cost/pos.qty,exitPrice:tick.price,exitTradeId:tick.id,legs:pos.legs,margin:pos.margin,pnl:net,fees:pos.fees+exitFee,reason:order.reason||(pos.legs===1?'roi100':'fee-inclusive-breakeven'),balance:cash,trigger:order.trigger,anchors:pos.channel.anchors});
  record({...tick,action:'exit',reason:order.reason||(pos.legs===1?'roi100':'fee-inclusive-breakeven'),legs:pos.legs,net,netAtTrigger:order.netAtTrigger,lossLimit:order.lossLimit,trigger:order.trigger});pos=null;
 }
}
function onTick(tick){
 if(tick.time<START||tick.time>=END)return;
 if(previous&&(tick.id<=previous.id||tick.time<previous.time))throw Error('Raw trade order diagnostic '+JSON.stringify({previous,current:tick,idDelta:tick.id-previous.id,timeDelta:tick.time-previous.time}));
 if(previous&&tick.id>previous.id+1){idGapCount++;unusedIdCount+=tick.id-previous.id-1;}
 totalTicks++;if(!firstTick)firstTick=tick;lastTick=tick;
 const minute=Math.floor(tick.time/60)*60;
 if(minute!==minuteKey){finishMinute();minuteKey=minute;minuteFillVersion=fillVersion;minuteStartPosition=pos?JSON.parse(JSON.stringify(pos)):null;ohlc={open:tick.price,high:tick.price,low:tick.price,close:tick.price,volume:tick.qty};}
 else {ohlc.high=Math.max(ohlc.high,tick.price);ohlc.low=Math.min(ohlc.low,tick.price);ohlc.close=tick.price;ohlc.volume+=tick.qty;}
 if(halted){previous=tick;return;}
 let justFilled=false;
 if(pending){fill(tick);justFilled=true;}
 if(pos){
  const mark=markMap.get(minute);if(!mark)throw Error('No mark bound');
  // Bounds are audit-only. Future minute extrema never select entries/exits.
  const worst=pos.side===1?mark.low:mark.high,headroom=cash+pos.margin+pos.side*(pos.qty*worst-pos.cost)-pos.qty*worst*MMR;
  minHeadroom=Math.min(minHeadroom,headroom);if(headroom<=0){ambiguousLiquidation=true;if(!firstUnsafe)firstUnsafe={time:tick.time,minute,mark,cash,position:JSON.parse(JSON.stringify(pos)),headroom};}
  const equity=cash+pos.margin+pos.side*(pos.qty*tick.price-pos.cost);peak=Math.max(peak,equity);maxDD=Math.max(maxDD,(peak-equity)/peak);
  if(!justFilled){
   const target=pos.legs===1?(pos.cost+pos.side*1*pos.margin)/pos.qty:(pos.side===1?(pos.cost+pos.fees)/(pos.qty*(1-FEE)):(pos.cost-pos.fees)/(pos.qty*(1+FEE)));
   const gross=pos.side*(pos.qty*tick.price-pos.cost),net=gross-pos.qty*tick.price*FEE-pos.fees;
   if(pos.legs===1&&gross/pos.legMargin>=.5&&!pos.protected){pos.protected=true;record({...tick,action:'protection-activated',netFloor:.25*pos.legMargin});}
   if(cfg.stop&&net<=-.1*pos.startEquity)pending={type:'exit',reason:'account-loss10',trigger:tick,netAtTrigger:net,lossLimit:.1*pos.startEquity};
   else if(pos.side===1?tick.price>=target:tick.price<=target)pending={type:'exit',trigger:tick,target};
   else if(pos.legs===1&&pos.protected&&net<=.25*pos.legMargin)pending={type:'exit',reason:'profit-lock-net25',trigger:tick};
   else if(pos.legs<2&&!pos.averageBlocked&&!pos.protected){
    const k=pos.k-pos.side;if(k>=0&&k<7){const price=levels(pos.channel,tick.time)[k];
     if(pos.side===1?tick.price<=price:tick.price>=price)pending={type:'average',k,trigger:tick};}
   }
  }
 }else if(!justFilled&&previous){
  const sig=signals.get(Math.floor(tick.time/cfg.frameSeconds)*cfg.frameSeconds);
  if(sig&&(!cfg.longOnly||sig.rsi<=30)){const side=sig.rsi<=30?1:-1,candidates=[];
   for(const channel of sig.channels){const now=levels(channel,tick.time),before=levels(channel,Math.max(previous.time,Math.floor(tick.time/cfg.frameSeconds)*cfg.frameSeconds));
    for(let k=0;k<7;k++)if(side===1?(previous.price>before[k]&&tick.price<=now[k]):(previous.price<before[k]&&tick.price>=now[k]))candidates.push({channel,k});}
   candidates.sort((a,b)=>b.channel.score-a.channel.score);
   if(candidates.length)pending={type:'entry',side,...candidates[0],rsi:sig.rsi,trigger:tick};
  }
 }
 
 previous=tick;
}

 return {onTick,finish:()=>{
 finishMinute();const markPrice=marks.at(-1).close;
 const openPosition=pos?{side:pos.side===1?'LONG':'SHORT',entryTime:pos.time,entryPrice:pos.firstPrice,anchors:pos.channel.anchors,legs:pos.legs,margin:pos.margin,averagePrice:pos.cost/pos.qty,markPrice,unrealized:pos.side*(pos.qty*markPrice-pos.cost),entryFees:pos.fees}:null;
 const final=cash+(openPosition?openPosition.margin+openPosition.unrealized:0);
 const ledger=1000+trades.reduce((s,t)=>s+t.pnl,0)+(liquidation?liquidation.hypotheticalLastTradeNet:0)+(openPosition?openPosition.unrealized-openPosition.entryFees:0);
 if(Math.abs(ledger-final)>1e-6)throw Error('Ledger does not reconcile');
 if(checkedMinutes!==(END-START)/60||mismatches)throw Error('Raw trade OHLC does not match all requested minutes: '+checkedMinutes+' mismatches '+mismatches);
 if(ambiguousLiquidation&&!liquidation)throw Error('Mark-price bounds permit liquidation; higher-resolution mark data required. Do not report final return.');
 const summary={initial:1000,final,returnPct:(final/1000-1)*100,closedTrades:trades.length,wins:trades.filter(t=>t.pnl>1e-6).length,losses:trades.filter(t=>t.pnl< -1e-6).length,breakevens:trades.filter(t=>Math.abs(t.pnl)<=1e-6).length,liquidationsRuledOut:!ambiguousLiquidation,liquidations:liquidation?1:0,minMaintenanceHeadroom:minHeadroom,maxMarkMinuteDrawdownPct:maxMarkDD*100,maxTradePriceDrawdownPct:maxDD*100,totalTicks,idGapCount,unusedIdCount,checkedMinutes,ohlcMismatches:mismatches,firstTick,lastTick,fees:trades.reduce((s,t)=>s+t.fees,0)+(openPosition?.entryFees||0)+(liquidation?.position.fees||0),modeledLiquidationFee:liquidation?Math.min(Math.max(0,liquidation.equityAtThreshold),liquidation.clearanceFeeNotional):0};
 if(cfg.longOnly&&(trades.some(t=>t.side!=='LONG')||events.some(e=>e.action==='entry'&&e.side!==1)))throw Error('Unexpected short entry');
 const result={config:cfg,summary,liquidation,openPosition,trades,events,audit,curve,assumptions:{execution:'Signal on observed raw trade; market fill on next recorded raw trade. Hypothetical fills, zero latency beyond next tick and no order-book impact.',signal:'Previous completed '+(cfg.frameSeconds/60)+'m Wilder RSI14 and Hong Pick intraday channel on that same frame; anchors frozen at entry. Same 240-candle channel search and 288-candle RSI warmup.',margin:cfg.longOnly?('Cross 100x, LONG ONLY. Initial 10% plus one equal 10% average. '+(cfg.stop?'Instant fee-inclusive loss10% of pre-entry wallet stop.':'No discretionary stop.')):cfg.stop?'Cross 100x. LONG initial 10% plus one equal 10%; SHORT initial '+(cfg.shortFraction*100)+'% plus one equal amount. Instant fee-inclusive loss10% of pre-entry wallet stop. No channel-break stop.':'Cross 100x. LONG initial 10% plus one equal 10%; SHORT initial '+(cfg.shortFraction*100)+'% plus one equal amount. No discretionary stop.',exit:'First leg gross margin ROI +100%; after gross +50% activate fixed net +25% initial margin floor, no averaging after activation; after one average fee-inclusive breakeven.',fees:'0.05% taker each fill; funding and slippage/order-book effects excluded.',mark:'Actual 1m mark adverse bounds audit liquidation. Confirmed persistent-position breach settles under explicit full-liquidation model; no fabricated mark intraminute sequence. MMR fixed 0.4% model assumption, historical account-specific bracket not reconstructed.'}};
 fs.writeFileSync(out+'result.json',JSON.stringify(result,null,2));console.log('TICK_REPLAY_RESULT '+JSON.stringify({config:cfg,...summary}));return result;

 }};
}

// Two strategy sleeves share ONE cross-margin wallet and aggregate liquidation risk.
function makeHybrid(cfg){
 const FEE=.0005,MMR=.004,positions=new Map(),events=[],trades=[],curve=[];
 const markMap=new Map(marks.map(m=>[m.time,m]));
 let cash=1000,previous=null,pending=[],serial=0,minute=null,version=0,startVersion=0;
 let peak=1000,peakMark=1000,maxDD=0,maxMarkDD=0,minHeadroom=Infinity,totalTicks=0;
 let maxPositions=0,maxMarginPct=0,maxNotionalEquity=0,overlapMinutes=0,firstUnsafe=null,liquidation=null,halted=false;
 const wallet=()=>cash+[...positions.values()].reduce((s,p)=>s+p.margin,0);
 const equity=x=>cash+[...positions.values()].reduce((s,p)=>s+p.margin+p.qty*x-p.cost,0);
 const net=(p,x)=>p.qty*x-p.cost-p.fees-p.qty*x*FEE;
 const record=(action,tick,extra={})=>events.push({action,...tick,...extra});
 function signal(frame,tick){
  if(!previous)return null;
  const start=Math.floor(tick.time/frame)*frame,s=signalSets[frame].get(start);
  if(!s||!Number.isFinite(s.rsi)||s.rsi>30)return null;
  const candidates=[];
  for(const channel of s.channels){
   const now=levels(channel,tick.time),before=levels(channel,Math.max(previous.time,start));
   for(let k=0;k<7;k++)if(previous.price>before[k]&&tick.price<=now[k])candidates.push({channel,k});
  }
  candidates.sort((a,b)=>b.channel.score-a.channel.score);
  return candidates.length?{...candidates[0],rsi:s.rsi,frame,trigger:tick}:null;
 }
 function finishMinute(){
  if(minute===null)return;
  const m=markMap.get(minute);if(!m)throw Error('Missing hybrid mark minute');
  const e=equity(m.close);peakMark=Math.max(peakMark,e);maxMarkDD=Math.max(maxMarkDD,(peakMark-e)/peakMark);
  curve.push({time:minute,equity:e,wallet:wallet(),positions:positions.size});
  if(positions.size===2)overlapMinutes++;
  // Full minute adverse mark is used only AFTER the minute, never for a signal.
  const q=[...positions.values()].reduce((s,p)=>s+p.qty,0),head=equity(m.low)-q*m.low*MMR;
  minHeadroom=Math.min(minHeadroom,head);
  if(q&&head<=0){
   const proof={minute,mark:m,cash,positions:[...positions.values()],headroom:head};
   if(!firstUnsafe)firstUnsafe=proof;
   if(startVersion===version){
    const cost=[...positions.values()].reduce((s,p)=>s+p.cost,0),threshold=(cost-wallet())/(q*(1-MMR));
    liquidation={...proof,theoreticalLiquidationPrice:threshold,settlement:'Simplified full cross liquidation, collateral consumed; not actual exchange fills.'};
    halted=true;cash=0;positions.clear();pending=[];maxDD=1;maxMarkDD=1;
    record('cross-liquidation-model',{time:minute+60,price:threshold});
   }
  }
 }
 function execute(order,tick){
  version++;
  if(order.type==='entry'){
   if(positions.has(order.frame))throw Error('Duplicate sleeve entry');
   const w=wallet(),margin=.10*w,notional=margin*100;
   const unreal=equity(tick.price)-w;
   if(cash+Math.min(0,unreal)<margin+notional*FEE){record('order-rejected',tick,{frame:order.frame,type:order.type});return;}
   const p={id:++serial,frame:order.frame,channel:order.channel,k:order.k,rsi:order.rsi,startWallet:w,legMargin:margin,margin,cost:notional,qty:notional/tick.price,fees:notional*FEE,legs:1,time:tick.time,firstPrice:tick.price};
   positions.set(order.frame,p);cash-=margin+notional*FEE;
   record('entry',tick,{positionId:p.id,frame:p.frame,margin,qty:p.qty,notional,allocationWallet:w,anchors:p.channel.anchors,rsi:p.rsi,trigger:order.trigger});
  }else{
   const p=positions.get(order.frame);if(!p)throw Error('Order for nonexistent sleeve');
   if(order.type==='average'){
    const margin=p.legMargin,notional=margin*100,unreal=equity(tick.price)-wallet();
    if(cash+Math.min(0,unreal)<margin+notional*FEE){p.averageBlocked=true;record('order-rejected',tick,{frame:p.frame,type:order.type});return;}
    cash-=margin+notional*FEE;p.margin+=margin;p.cost+=notional;p.qty+=notional/tick.price;p.fees+=notional*FEE;p.legs++;p.k=order.k;
    record('average',tick,{positionId:p.id,frame:p.frame,margin,notional,qty:notional/tick.price,trigger:order.trigger});
   }else{
    const gross=p.qty*tick.price-p.cost,exitFee=p.qty*tick.price*FEE,pnl=gross-exitFee-p.fees;
    cash+=p.margin+gross-exitFee;positions.delete(p.frame);
    trades.push({positionId:p.id,frame:p.frame,entryTime:p.time,exitTime:tick.time,entryPrice:p.firstPrice,averagePrice:p.cost/p.qty,exitPrice:tick.price,quantity:p.qty,initialMargin:p.legMargin,margin:p.margin,legs:p.legs,pnl,fees:p.fees+exitFee,reason:order.reason,trigger:order.trigger,anchors:p.channel.anchors,walletAfter:wallet()});
    record('exit',tick,{positionId:p.id,frame:p.frame,pnl,reason:order.reason,netAtTrigger:order.netAtTrigger,trigger:order.trigger});
   }
  }
  maxPositions=Math.max(maxPositions,positions.size);
  const allocated=[...positions.values()].reduce((s,p)=>s+p.margin,0);
  maxMarginPct=Math.max(maxMarginPct,100*allocated/wallet());
  maxNotionalEquity=Math.max(maxNotionalEquity,[...positions.values()].reduce((s,p)=>s+p.qty*tick.price,0)/equity(tick.price));
 }
 function manage(p,tick){
  const gross=p.qty*tick.price-p.cost,n=net(p,tick.price),roi=p.frame===900?cfg.quickROI:1;
  const target=p.legs===1?(p.cost+roi*p.margin)/p.qty:(p.cost+p.fees)/(p.qty*(1-FEE));
  if(p.legs===1&&gross/p.legMargin>=.5&&!p.protected){p.protected=true;record('protection-activated',tick,{positionId:p.id,frame:p.frame});}
  if(tick.price>=target)return {type:'exit',frame:p.frame,reason:p.legs===1?'roi'+(roi*100):'fee-inclusive-breakeven',trigger:tick,netAtTrigger:n};
  if(p.legs===1&&p.protected&&n<=.25*p.legMargin)return {type:'exit',frame:p.frame,reason:'profit-lock-net25',trigger:tick,netAtTrigger:n};
  if(p.legs<2&&!p.averageBlocked&&!p.protected){const k=p.k-1;if(k>=0&&tick.price<=levels(p.channel,tick.time)[k])return {type:'average',frame:p.frame,k,trigger:tick};}
  return null;
 }
 function onTick(tick){
  if(tick.time<START||tick.time>=END)return;
  totalTicks++;const key=Math.floor(tick.time/60)*60;
  if(key!==minute){finishMinute();minute=key;startVersion=version;}
  if(halted){previous=tick;return;}
  let filled=false;
  if(pending.length){const orders=pending;pending=[];for(const order of orders)execute(order,tick);filled=true;}
  const e=equity(tick.price);peak=Math.max(peak,e);maxDD=Math.max(maxDD,(peak-e)/peak);
  if(!filled){
   const management=new Map();for(const p of positions.values()){const order=manage(p,tick);if(order)management.set(p.frame,order);}
   // Detect the hourly crossing even while the 15m sleeve remains open.
   const hourly=!positions.has(3600)?signal(3600,tick):null;
   if(hourly){
    const p=positions.get(900);
    if(p){const n=net(p,tick.price);if(n>0){management.set(900,{type:'exit',frame:900,reason:'switch-to-hourly-profit',trigger:tick,netAtTrigger:n});record('hourly-switch-profit',tick,{positionId:p.id,net:n});}
     else record('hourly-retain-losing-15m',tick,{positionId:p.id,net:n});}
    pending=[...management.values()].sort((a,b)=>(a.type==='exit'?0:1)-(b.type==='exit'?0:1));
    pending.push({type:'entry',...hourly});
   }else{
    pending=[...management.values()];
    if(!positions.has(3600)&&!positions.has(900)){const s=signal(900,tick);if(s)pending.push({type:'entry',...s});}
   }
  }
  previous=tick;
 }
 return {onTick,finish:()=>{
  finishMinute();
  if(firstUnsafe&&!liquidation)throw Error('Hybrid liquidation ambiguous within a fill minute; higher-resolution mark data required');
  const mark=marks.at(-1).close,openPositions=[...positions.values()].map(p=>({...p,channel:undefined,averagePrice:p.cost/p.qty,unrealized:p.qty*mark-p.cost,netUnrealizedAfterEntryFees:p.qty*mark-p.cost-p.fees}));
  const final=equity(mark),ledger=1000+trades.reduce((s,t)=>s+t.pnl,0)+openPositions.reduce((s,p)=>s+p.netUnrealizedAfterEntryFees,0);
  if(!liquidation&&Math.abs(ledger-final)>1e-6)throw Error('Hybrid ledger mismatch');
  if(trades.some(t=>t.legs>2)||maxPositions>2)throw Error('Position cap violated');
  const entries=events.filter(e=>e.action==='entry');
  if(entries.some(e=>Math.abs(e.margin/e.allocationWallet-.10)>1e-10||Math.abs(e.notional/e.margin-100)>1e-10))throw Error('Allocation/leverage mismatch');
  const summary={initial:1000,final,returnPct:(final/1000-1)*100,closedTrades:trades.length,hourlyTrades:trades.filter(t=>t.frame===3600).length,quickTrades:trades.filter(t=>t.frame===900).length,maxTradePriceDrawdownPct:maxDD*100,maxMarkMinuteDrawdownPct:maxMarkDD*100,maxPositions,maxMarginPct,maxNotionalEquity,overlapMinutes,totalTicks,minMaintenanceHeadroom:minHeadroom,liquidations:liquidation?1:0,liquidationsRuledOut:!firstUnsafe,fees:trades.reduce((s,t)=>s+t.fees,0)+openPositions.reduce((s,p)=>s+p.fees,0),switchProfits:events.filter(e=>e.action==='hourly-switch-profit').length,retainLosses:events.filter(e=>e.action==='hourly-retain-losing-15m').length};
  const result={config:cfg,summary,openPositions,liquidation,trades,events,curve,assumptions:{execution:'Signal on observed raw trade, all queued fills on next actual trade; no intrabar OHLC ordering guesses.',priority:'Hourly takes priority; no fresh 15m entries while hourly position exists. At most one sleeve of each frame. Fee-inclusive profitable 15m closes on hourly signal; losing 15m remains managed independently.',margin:'ONE wallet, cross 100x; initial 10% of wallet excluding unrealized PnL; one equal-margin average per sleeve. Aggregate maintenance test at fixed 0.4%.',exit:'Hourly retains original gross ROI100/protection50/net floor25/after-average fee-inclusive breakeven. Quick sleeve gross ROI'+cfg.quickROI*100+'%, otherwise same original management.',excluded:'Funding, bid/ask spread, order-book impact, tick/lot constraints; Binance data proxy, NOT a Bitget execution replay.'}};
  const folder=out+cfg.id+'/';fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(folder+'result.json',JSON.stringify(result,null,2));console.log('HYBRID_RESULT '+JSON.stringify({config:cfg,...summary}));return result;
 }};
}


const configs=[{id:'baseline-15m',longOnly:true,stop:false,frameSeconds:900},{id:'baseline-hourly',longOnly:true,stop:false,frameSeconds:3600}];
const engines=[...configs.map(makeEngine),makeHybrid({id:'hybrid-quick25',quickROI:.25}),makeHybrid({id:'hybrid-quick100',quickROI:1})];
const stream=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
stream.on('line',line=>{const [id,time,price,qty]=line.split(',');const tick={id:+id,time:+time/1000,price:+price,qty:+qty};for(const e of engines)e.onTick(tick);});
stream.on('close',()=>{
 const results=engines.map(e=>e.finish());
 const previous=JSON.parse(fs.readFileSync('hourly-baseline.json')).summary;
 if(Math.abs(results[1].summary.final-previous.final)>1e-6||results[1].summary.closedTrades!==previous.closedTrades)throw Error('Original BTC hourly baseline regression failed');
 if(results.some(r=>r.summary.totalTicks!==96508212))throw Error('Incomplete BTC raw trade coverage');
 fs.writeFileSync(out+'comparison.json',JSON.stringify({start:manifest.start_utc,endExclusive:manifest.end_utc_exclusive,symbol:manifest.symbol,results:results.map(r=>({config:r.config,summary:r.summary,openPositions:r.openPositions||r.openPosition,liquidation:r.liquidation}))},null,2));
 console.log('ALL_BTC_REPLAYS_COMPLETE');
});
