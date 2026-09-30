"""Build Hong Pick static files, then add completed 10-year weekly snapshots."""
import argparse, json, shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from build_static import build as base_build
import fib_provider as p

def build(output,refresh=False,cache_dir=None):
    output=Path(output);base_build(output,refresh,cache_dir)
    shutil.copy2(Path(__file__).resolve().parent/'fib-client.js',output/'fib-client.js')
    path=output/'data-manifest.json';manifest=json.loads(path.read_text(encoding='utf-8'))
    manifest['version']='5.3';manifest['fibHistories']={};symbols=sorted(manifest.get('histories',{}))
    if refresh:
        with ThreadPoolExecutor(max_workers=3) as pool:
            jobs={pool.submit(p.fibonacci_history,tv):tv for tv in symbols}
            for job in as_completed(jobs):
                tv=jobs[job]
                try:
                    data=job.result();name='data-fib-history-'+tv.replace(':','-')+'.json'
                    (output/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
                    manifest['fibHistories'][tv]={'file':name,'updated':data.get('updated'),'lastBar':data.get('lastBar')}
                except Exception:manifest.setdefault('failures',[]).append('fib-history:'+tv)
    path.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='public');parser.add_argument('--refresh',action='store_true');parser.add_argument('--cache-dir')
    args=parser.parse_args();result=build(args.output,args.refresh,args.cache_dir);print(json.dumps({'generatedAt':result['generatedAt'],'failures':result['failures'],'fibHistories':len(result['fibHistories'])},ensure_ascii=False))
