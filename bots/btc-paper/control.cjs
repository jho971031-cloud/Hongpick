const fs=require('node:fs'),path=require('node:path'),{atomicWrite}=require('./storage.cjs');
const command=process.argv[2],dir=path.resolve(process.env.PAPER_DATA_DIR||path.join(__dirname,'paper-data'));
if(!['pause','resume'].includes(command)){console.error('Use: node control.cjs pause|resume (paper only)');process.exitCode=1;}else{
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(command==='pause')atomicWrite(path.join(dir,'PAUSE'),new Date().toISOString());
 else {if(fs.existsSync(path.join(dir,'PAUSE')))fs.unlinkSync(path.join(dir,'PAUSE'));atomicWrite(path.join(dir,'RESUME_REQUEST'),new Date().toISOString());}
 console.log('PAPER_ONLY '+command+' requested; applied on the next healthy market observation');
}
