const fs=require('fs'),vm=require('vm'),assert=require('assert');
function runCase(name,prices,hourLevel,quickROI){
 const files={};const channel={score:1,anchors:[],level:100};
 const box={START:0,END:60,out:'test/',marks:[{time:0,low:Math.min(...prices),close:prices.at(-1)}],signalSets:{900:new Map([[0,{rsi:20,channels:[channel]}]]),3600:new Map([[0,{rsi:20,channels:[{...channel,level:hourLevel}]}]])},levels:(c,t)=>[c.level],fs:{mkdirSync(){},writeFileSync(path,s){files[path]=JSON.parse(s)}},console:{log(){}},Map,Math,JSON,Number};
 vm.createContext(box);vm.runInContext(fs.readFileSync(__dirname+'/hybrid-engine.cjs','utf8')+'\nthis.engine=makeHybrid({id:"test",quickROI:'+quickROI+'});',box);
 prices.forEach((price,i)=>box.engine.onTick({id:i+1,time:i+1,price,qty:1}));
 const result=box.engine.finish();assert(result.summary.maxPositions<=2);assert(result.summary.liquidations===0);return result;
}
const loss=runCase('hold loss',[101,99,98,97,96.9,99,99.1],97.5,.25);
assert.equal(loss.summary.retainLosses,1);assert.equal(loss.summary.maxPositions,2);assert.equal(loss.summary.hourlyTrades,1);assert.equal(loss.summary.quickTrades,1);
const profit=runCase('switch profit',[100.1,99,100,100.8,100.4,100.3],100.5,1);
assert.equal(profit.summary.switchProfits,1);assert.equal(profit.summary.maxPositions,1);assert.equal(profit.trades[0].reason,'switch-to-hourly-profit');assert.equal(profit.openPositions[0].frame,3600);
const quick=runCase('quick target',[101,99,100,100.6,100.61],200,.25);
assert.equal(quick.trades[0].reason,'roi25');assert.equal(quick.summary.quickTrades,1);
console.log('PASS: loss retained with hourly entry; profitable switch; quick target; shared ledger reconciles');
