const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const storage=require('./storage.cjs'),{create}=require('./bot.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-io-')),file=path.join(dir,'state.json');
 const state=create().engine.snapshot();storage.validateState(state);storage.save(file,{version:'test',state});assert.equal(storage.load(file).state.minHeadroom,Infinity);
 storage.save(file,{version:'second',state});assert.equal(storage.load(file+'.backup').version,'test');
 const e=JSON.parse(fs.readFileSync(file,'utf8'));e.body=e.body.replace('1000','999');fs.writeFileSync(file,JSON.stringify(e));assert.throws(()=>storage.load(file),/checksum/);assert.equal(storage.load(file+'.backup').state.cash,1000);
 assert.throws(()=>storage.validateState({...state,cash:999}),/ledger/);
 const release=await storage.acquireLock(path.join(dir,'lock'));await assert.rejects(()=>storage.acquireLock(path.join(dir,'lock')),/holds/);await release();
 const again=await storage.acquireLock(path.join(dir,'lock'));await again();
 // No price observations between restart and an observed adverse mark may trigger a new entry.
 const ctx=create();ctx.signals[900].set(0,{rsi:20,channels:[{origin:100,epoch:0,slope:0,width:0,frameSeconds:900,score:1,anchors:[]}]});
 for(const [i,price] of [101,99,100].entries()){const q={time:i+1,price,mark:price};ctx.engine.setMark(q);ctx.engine.observeRisk(q);ctx.engine.onTick(q);}
 assert.equal(ctx.engine.snapshot().positions.length,1);
 const q={time:4,price:70,mark:70};ctx.engine.setMark(q);ctx.engine.observeRisk(q);ctx.engine.onTick(q);
 assert.equal(ctx.engine.snapshot().halted,true);assert.equal(ctx.engine.snapshot().cash,0);assert.equal(ctx.engine.snapshot().positions.length,0);assert.equal(ctx.engine.snapshot().pending.length,0);
 storage.validateState(ctx.engine.snapshot());
 console.log('PASS: durable checkpoints, corruption rejection, backup preservation, exclusive process lock, observed mark liquidation halt');
})().catch(e=>{console.error(e);process.exitCode=1;});
