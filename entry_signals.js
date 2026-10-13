/* Signals use only completed candles known at the touch date. No hindsight anchors. */
const RATIOS=[0,.5,1,1.5,2,2.5,3];
function evaluateTouch(days,t,at,meta){
 const last=days.at(-1),touch=days[t],prior=days[t-1];if(!prior||touch.time<=meta.thirdTime||touch.time<meta.knownAt)return null;
 const support=at(touch.time),current=at(last.time),priorLine=at(prior.time);
 if(![support,current,priorLine].every(x=>Number.isFinite(x)&&x>0))return null;
 // Approach from above, tolerate a wick under support, require a close back above it.
 if(prior.close<priorLine*1.01||touch.low>support*1.01||touch.low<support*.97||touch.close<support)return null;
 let confirmed=-1;
 for(let j=t;j<=Math.min(t+2,days.length-1);j++)if(days[j].close>touch.high&&days[j].close>days[j-1].close){confirmed=j;break;}
 const distance=(last.close/current-1)*100;
 const broken=last.close<current||days.slice(t).some(x=>x.close<at(x.time)*.99);
 const late=distance>(confirmed>=0?5:3)||!Number.isFinite(meta.headroom)||meta.headroom<=3||(confirmed>=0?days.length-1-confirmed>3:days.length-1-t>2);
 const status=broken?'broken':late?'late':confirmed>=0?'confirmed':'approach';
 return {...meta,status,active:status==='confirmed'||status==='approach',touchDate:touch.time,touchLow:touch.low,touchLine:support,confirmationDate:confirmed>=0?days[confirmed].time:null,distance,line:current,points:status==='confirmed'?(meta.provisional?20:25):status==='approach'&&distance>=0&&distance<=3?(meta.provisional?10:15):0};
}
function scanEntries(days,weekly,indicators,project){
 const found=[],last=days.at(-1);if(!last||days.length<60)return null;
 for(const frame of ['W','D']){
  const full=(frame==='W'?weekly:days).filter(x=>x.time<=last.time);if(full.length<60)continue;
  for(let t=Math.max(1,days.length-5);t<days.length;t++){
   const known=full.filter(x=>x.time<=days[t].time);
   for(const mode of ['high','low']){
    const candidate=indicators.fibonacci(known,mode,{interval:frame,currentPrice:days[t].close,early:true});if(!candidate)continue;
    const knownAt=known[candidate.c+2]?.time;if(!knownAt||knownAt>days[t].time)continue;
    const levels=RATIOS.map(ratio=>({ratio,line:project(candidate,full,last.time,ratio)})).filter(x=>Number.isFinite(x.line)&&x.line>0);
    const resistance=levels.filter(x=>x.line>last.close).sort((a,b)=>a.line-b.line)[0];
    const headroom=resistance?(resistance.line/last.close-1)*100:null;
    for(const ratio of RATIOS){
     const at=time=>project(candidate,full,time,ratio);
     const meta={frame,mode,ratio,knownAt,thirdTime:candidate.anchors[2].time,provisional:!!candidate.provisional,headroom,resistance:resistance?.line??null};
     let signal=evaluateTouch(days,t,at,meta);
     // Current pullback near a line is a watch candidate, not a confirmed bounce.
     if(!signal&&t===days.length-1){const line=at(last.time),distance=(last.close/line-1)*100,prior=days[t-1];
      if(days[t].time>meta.thirdTime&&Number.isFinite(line)&&line>0&&distance>=0&&distance<=3&&last.close<prior.close&&prior.close>at(prior.time)*1.01&&Math.max(...days.slice(Math.max(0,t-10),t).map(x=>x.high))>last.close*1.03)
       signal={...meta,status:meta.headroom<=3?'late':'approach',active:meta.headroom>3,touchDate:null,confirmationDate:null,line,distance,points:meta.headroom>3?(meta.provisional?10:15):0};
     }
     if(signal)found.push({...signal,headroom:Number.isFinite(meta.headroom)?meta.headroom:null,candidate,reference:full});
    }
   }
  }
 }
 const priority={confirmed:0,approach:1,late:2,broken:3};
 return found.sort((a,b)=>priority[a.status]-priority[b.status]||Number(a.provisional)-Number(b.provisional)||(a.frame==='W'?0:1)-(b.frame==='W'?0:1)||Math.abs(a.distance)-Math.abs(b.distance))[0]||null;
}
module.exports={scanEntries,evaluateTouch};
