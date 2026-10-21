// Read-only public Bitget data; all orders are hypothetical. No private endpoints exist here.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const storage=require('./storage.cjs');
const BASE=__dirname,VERSION='btc-paper-100x-5pct-v2';
function create(){
 const box={window:{},START:0,END:Infinity,out:'',marks:[],signalSets:{900:new Map(),3600:new Map()},levels:(c,t)=>[0,.5,1,1.5,2,2.5,3].map(r=>c.origin*Math.exp(c.slope*(t-c.epoch)/c.frameSeconds+r*c.width)).sort((a,b)=>a-b),fs:{mkdirSync(){},writeFileSync(){}},console:{log(){}}};
 vm.createContext(box);vm.runInContext(fs.readFileSync(path.join(BASE,'indicators.js'),'utf8'),box);
 vm.runInContext(fs.readFileSync(path.join(BASE,'hybrid-engine.cjs'),'utf8')+'\nthis.engine=makeHybrid({id:"paper",quickROI:.25});',box);
 return {engine:box.engine,signals:box.signalSets,indicators:box.window.HongIndicators};
}
function completed(rows,frame,now){
 const end=Math.floor(now/frame)*frame;
 const bars=rows.map(x=>({time:+x[0]/1000,open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5]})).filter(x=>x.time+frame<=end).sort((a,b)=>a.time-b.time);
 if(bars.length<288||bars.at(-1).time+frame!==end)throw Error('Incomplete/stale candle history');
 for(let i=0;i<bars.length;i++){
  const b=bars[i];if(!Object.values(b).every(Number.isFinite)||b.time%frame||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.volume<0||(i&&b.time-bars[i-1].time!==frame))throw Error('Malformed/gapped candles');
 }
 return bars;
}
function updateSignal(ctx,frame,rows,time){
 const bars=completed(rows,frame,time),rsi=ctx.indicators.rsi(bars).at(-1)?.value;
 if(!Number.isFinite(rsi))throw Error('No RSI');
 const channels=['high','low'].map(m=>ctx.indicators.intradayFibonacci(bars,m)).filter(Boolean).map(c=>{
  const [a,b,d]=c.anchors,slope=Math.log(b.price/a.price)/((b.time-a.time)/frame);
  return {...c,frameSeconds:frame,origin:a.price,epoch:a.time,slope,width:Math.log(d.price/a.price)-slope*(d.time-a.time)/frame};
 });
 ctx.signals[frame].clear();ctx.signals[frame].set(Math.floor(time/frame)*frame,{rsi,channels});
}
function quote(row,now=Date.now()){
 const q={time:+row.ts/1000,price:+row.lastPr,bid:+row.bidPr,ask:+row.askPr,mark:+row.markPrice};
 if(!Object.values(q).every(Number.isFinite)||Math.min(q.price,q.bid,q.ask,q.mark)<=0||q.bid>q.ask||now-q.time*1000>5000||q.time*1000-now>2000)throw Error('Stale/invalid ticker');
 return q;
}
async function get(endpoint,extra={},stopSignal){
 if(!['ticker','candles'].includes(endpoint))throw Error('Only public market data allowed');
 const u=new URL('https://api.bitget.com/api/v2/mix/market/'+endpoint);u.search=new URLSearchParams({symbol:'BTCUSDT',productType:'USDT-FUTURES',...extra});
 const r=await fetch(u,{method:'GET',signal:stopSignal?AbortSignal.any([AbortSignal.timeout(10000),stopSignal]):AbortSignal.timeout(10000)});if(!r.ok)throw Error('Market HTTP '+r.status);
 const d=await r.json();if(d.code!=='00000'||!Array.isArray(d.data))throw Error('Invalid market response');return d.data;
}
const stringify=d=>JSON.stringify(d,(_,v)=>v===Infinity?'__INF__':v);
const parse=s=>JSON.parse(s,(_,v)=>v==='__INF__'?Infinity:v);
async function main(){
 const args=process.argv.slice(2);if(args.some(a=>!['--once','--resume-paper'].includes(a)))throw Error('Supported: --once, --resume-paper. Live mode is not implemented.');
 const directory=path.resolve(process.env.PAPER_DATA_DIR||path.join(BASE,'paper-data'));fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const ctx=create(),stateFile=path.join(directory,'state.json');
 const releaseLock=await storage.acquireLock(path.join(directory,'process.lock'));
 const shutdown=new AbortController();
 let count=0,stopping=false,last=null,lastSaved=0,lastSavedKey='',lastLog=0,lastLogEvent=0;
 const save=(force=false)=>{const state=ctx.engine.snapshot(),key=JSON.stringify([state.events.length,state.pending,state.paused,state.halted]);if(!force&&Date.now()-lastSaved<10000&&key===lastSavedKey)return;storage.validateState(state);storage.save(stateFile,{version:VERSION,savedAt:new Date().toISOString(),state});lastSaved=Date.now();lastSavedKey=key;};
 const event=(type,detail={})=>fs.appendFileSync(path.join(directory,'events.ndjson'),JSON.stringify({time:new Date().toISOString(),type,...detail})+'\n',{mode:0o600});
 const stop=()=>{stopping=true;shutdown.abort();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  if(fs.existsSync(stateFile)){const d=storage.load(stateFile);if(d.version!==VERSION)throw Error('State configuration differs; preserve and inspect the old checkpoint');storage.validateState(d.state);ctx.engine.restore(d.state);count=d.state.events.length;ctx.engine.resetGap();event('restart-gap',{entryPaused:ctx.engine.snapshot().paused});}
  if(args.includes('--resume-paper'))ctx.engine.resume();
  do{
   try{
    const row=(await get('ticker',{},shutdown.signal))[0];if(!row||row.symbol!=='BTCUSDT')throw Error('Wrong ticker symbol');const q=quote(row);
    if(last!==null&&q.time<=last){if(args.includes('--once'))break;await new Promise(r=>setTimeout(r,1000));continue;}
    for(const [frame,granularity] of [[3600,'1H'],[900,'15m']]){
     const bucket=Math.floor(q.time/frame)*frame;
     if(!ctx.signals[frame].has(bucket)){const rows=await get('candles',{granularity,limit:'1000'},shutdown.signal);updateSignal(ctx,frame,rows,q.time);}
    }
    if(stopping)break;
    if(Date.now()-q.time*1000>5000)throw Error('Ticker expired during candle refresh');
    if(last!==null&&q.time-last>5){ctx.engine.resetGap();event('quote-gap',{seconds:q.time-last,entryPaused:ctx.engine.snapshot().paused});}
    const resumeRequest=path.join(directory,'RESUME_REQUEST');if(fs.existsSync(resumeRequest)){ctx.engine.resume();fs.unlinkSync(resumeRequest);event('operator-paper-resume');}
    if(fs.existsSync(path.join(directory,'PAUSE')))ctx.engine.pauseNewEntries();
    ctx.engine.setMark(q);ctx.engine.observeRisk(q);ctx.engine.onTick(q);last=q.time;
    const state=ctx.engine.snapshot();for(const e of state.events.slice(count))event('paper-order',e);count=state.events.length;save();
    const status={mode:'PAPER_ONLY',symbol:'BTCUSDT',leverage:100,fraction:.05,checkedAt:new Date().toISOString(),quoteTime:q.time,price:q.price,mark:q.mark,positions:state.positions.length,cash:state.cash,entryPaused:state.paused,halted:state.halted};
    storage.atomicWrite(path.join(directory,'health.json'),JSON.stringify({...status,marketHealthy:true}));
    if(Date.now()-lastLog>30000||state.events.length!==lastLogEvent){console.log(JSON.stringify(status));lastLog=Date.now();lastLogEvent=state.events.length;}
   }catch(e){if(stopping)break;ctx.engine.resetGap();save();event('market-pause',{reason:e.message});storage.atomicWrite(path.join(directory,'health.json'),JSON.stringify({mode:'PAPER_ONLY',checkedAt:new Date().toISOString(),marketHealthy:false,reason:e.message}));console.error(e.message);if(args.includes('--once'))throw e;}
   if(args.includes('--once'))break;await new Promise(r=>setTimeout(r,1000));
  }while(!stopping);
  save(true);
 }finally{await releaseLock();}
}
module.exports={create,completed,updateSignal,quote,stringify,parse};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
