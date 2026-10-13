/* Channel-only paper scenario. No probabilities, orders or synthetic price forecasts. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HongScenario=api})(typeof window==='object'?window:globalThis,()=>{
 function plan({price,levels,units=1}){
  if(!(Number.isFinite(price)&&price>0&&Number.isFinite(units)&&units>0))throw Error('유효한 진입가격과 수량이 필요합니다.');
  const lines=levels.filter(x=>Number.isFinite(x.price)&&x.price>0).sort((a,b)=>a.price-b.price).filter((x,i,a)=>!i||Math.abs(x.price-a[i-1].price)>price*1e-8);
  if(lines.length<2)throw Error('서로 다른 채널선이 두 개 이상 필요합니다.');
  const floor=lines[0],ceiling=lines.at(-1),outside=price<floor.price,above=price>=ceiling.price;
  const upper=lines.find(x=>x.price>price)||null,baseIndex=lines.findLastIndex(x=>x.price<=price),lower=baseIndex>=0?lines.slice(0,baseIndex).reverse():[];
  let cost=price*units,quantity=units;const initialAverage=price;
  const make=(line,average,qty)=>line?{line,average,quantity:qty,pnl:(line.price-average)*qty,percent:(line.price/average-1)*100}:null;
  const stages=[];
  if(!outside&&!above)for(const line of lower){cost+=line.price*units;quantity+=units;const average=cost/quantity,target=lines.find(x=>x.price>line.price);stages.push({line,average,quantity,added:units,exit:make(target,average,quantity),floorLoss:(floor.price-average)*quantity})}
  return {price,units,lines,floor,ceiling,outside,above,initialAverage,exit:outside||above?null:make(upper,price,units),stages,maxQuantity:quantity,totalCost:cost,boundaryPnl:(floor.price-cost/quantity)*quantity,boundaryPercent:(floor.price/(cost/quantity)-1)*100};
 }
 function completed(data,frame,tv){
  const asOf=new Date(Math.min(Date.now(),Date.parse(data.updated)||Date.now())),crypto=tv.startsWith('BINANCE:'),kr=tv.startsWith('KRX:');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:crypto?'UTC':kr?'Asia/Seoul':'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(asOf).map(x=>[x.type,x.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`,clock=Number(parts.hour)*60+Number(parts.minute),closed=!crypto&&clock>=(kr?945:975);
  return data.candles.filter(c=>c.time!==data.formingTime).filter(c=>{
   if(frame.endsWith('m'))return typeof c.time==='number'&&c.time*1000+parseInt(frame)*60000<=asOf.getTime();
   if(frame==='M')return String(c.time).slice(0,7)<today.slice(0,7);
   if(frame==='W'){const end=new Date(c.time+'T00:00:00Z'),weekday=(end.getUTCDay()+6)%7;end.setUTCDate(end.getUTCDate()+(crypto?7-weekday:4-weekday));const day=end.toISOString().slice(0,10);return crypto?day<=today:day<today||day===today&&closed;}
   return c.time<today||c.time===today&&closed;
  });
 }
 return {plan,completed};
});
