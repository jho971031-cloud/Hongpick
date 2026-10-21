const fs=require('node:fs'),path=require('node:path'),{load,validateState}=require('./storage.cjs');
const directory=path.resolve(process.env.PAPER_DATA_DIR||path.join(__dirname,'paper-data'));
try{
 const d=load(path.join(directory,'state.json'));validateState(d.state);const s=d.state,p=s.positions.map(([,v])=>v),mark=s.marks.at(-1)?.close;
 const wallet=s.cash+p.reduce((sum,v)=>sum+v.margin,0),qty=p.reduce((sum,v)=>sum+v.qty,0),equity=wallet+p.reduce((sum,v)=>sum+v.qty*mark-v.cost,0),maintenance=qty*(mark||0)*.004;
 let health=null;try{health=JSON.parse(fs.readFileSync(path.join(directory,'health.json'),'utf8'));}catch{}
 const ageMs=Date.now()-Date.parse(d.savedAt),healthy=!!health?.marketHealthy&&ageMs<15000&&!s.halted&&!s.paused;
 console.log(JSON.stringify({mode:'PAPER_ONLY',savedAt:d.savedAt,healthy,ageSeconds:Math.round(ageMs/1000),entryPaused:s.paused,halted:s.halted,wallet,equity,maintenance,modeledLiquidationPrice:qty?(qty*mark-equity)/(qty*(1-.004)):null,positions:p.map(v=>({frameMinutes:v.frame/60,legs:v.legs,averagePrice:v.cost/v.qty,margin:v.margin,quantity:v.qty})),closedTrades:s.trades.length,netClosedPnl:s.trades.reduce((sum,t)=>sum+t.pnl,0),market:health},null,2));
 if(process.argv.includes('--check')&&!healthy)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
