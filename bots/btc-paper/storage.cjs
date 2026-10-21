const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function atomicWrite(file,text){
 const temp=file+'.'+process.pid+'.tmp',fd=fs.openSync(temp,'w',0o600);
 try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function save(file,payload){
 const body=JSON.stringify(payload,(_,v)=>v===Infinity?'__INF__':v),record=JSON.stringify({format:2,sha256:hash(body),body});
 if(fs.existsSync(file)){const old=fs.readFileSync(file,'utf8');decode(old);atomicWrite(file+'.backup',old);}
 atomicWrite(file,record);
}
function decode(text){
 const e=JSON.parse(text);if(e.format!==2||typeof e.body!=='string'||hash(e.body)!==e.sha256)throw Error('Checkpoint checksum mismatch');
 return JSON.parse(e.body,(_,v)=>v==='__INF__'?Infinity:v);
}
function load(file){return decode(fs.readFileSync(file,'utf8'));}
function validateState(s){
 if(!s||!Number.isFinite(s.cash)||s.cash<0||!Array.isArray(s.positions)||s.positions.length>2||!Array.isArray(s.events)||!Array.isArray(s.trades)||!Array.isArray(s.pending))throw Error('Invalid checkpoint state');
 const frames=new Set();for(const [frame,p] of s.positions){
  if(![900,3600].includes(frame)||frames.has(frame)||![1,2].includes(p.legs)||!['qty','cost','margin','legMargin','fees'].every(k=>Number.isFinite(p[k])&&p[k]>=0)||p.qty<=0||p.margin<=0)throw Error('Invalid checkpoint position');frames.add(frame);
 }
 for(const o of s.pending)if(!['entry','average','exit'].includes(o.type)||![900,3600].includes(o.frame)||(o.type!=='entry'&&!frames.has(o.frame)))throw Error('Invalid pending paper order');
 if(!s.liquidation){const wallet=s.cash+s.positions.reduce((sum,[,p])=>sum+p.margin,0),ledger=1000+s.trades.reduce((sum,t)=>sum+t.pnl,0)-s.positions.reduce((sum,[,p])=>sum+p.fees,0);if(!Number.isFinite(ledger)||Math.abs(wallet-ledger)>1e-6)throw Error('Checkpoint ledger mismatch');}
}
async function acquireLock(file){
 const child=spawn('flock',['--exclusive','--nonblock',file,process.execPath,'-e',"process.stdout.write('LOCKED\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],{stdio:['pipe','pipe','pipe']});
 let released=false;
 await new Promise((resolve,reject)=>{let output='';child.once('error',reject);child.once('exit',code=>reject(Error('Another process holds the paper lock (or flock unavailable): '+code)));child.stdout.on('data',d=>{output+=d;if(output.includes('LOCKED\n'))resolve();});});
 child.on('exit',()=>{if(!released){console.error('Paper lock lost; stopping');process.exit(1);}});
 return async()=>{released=true;child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});};
}
module.exports={atomicWrite,save,load,decode,validateState,acquireLock};
