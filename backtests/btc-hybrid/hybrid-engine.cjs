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

