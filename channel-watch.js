/* Observe only price crossings of the channel lines already drawn on this chart. */
window.HongChannelWatch=(()=>{
 function create(){
  let previous=null;
  return {
   reset(){previous=null;},
   observe(sample){
    if(!sample||!Number.isFinite(sample.time)||!Number.isFinite(sample.price)||sample.price<=0||typeof sample.key!=='string'||!Array.isArray(sample.lines)||sample.lines.some(x=>!Number.isFinite(x.ratio)||!Number.isFinite(x.price)||x.price<=0)){previous=null;return [];}
    const old=previous;previous=sample;
    if(!old||old.key!==sample.key||sample.time<=old.time||sample.time-old.time>15000)return [];
    const before=new Map(old.lines.map(x=>[x.ratio,x.price])),events=[];
    for(const line of sample.lines){const prior=before.get(line.ratio);if(!Number.isFinite(prior))continue;const a=old.price-prior,b=sample.price-line.price;
     if(a>0&&b<=0)events.push({ratio:line.ratio,direction:'down',price:sample.price,line:line.price,time:sample.time});
     else if(a<0&&b>=0)events.push({ratio:line.ratio,direction:'up',price:sample.price,line:line.price,time:sample.time});
    }
    return events;
   }
  };
 }
 return {create};
})();
