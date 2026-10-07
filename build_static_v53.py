"""Build Hong Pick static files, then add completed 10-year weekly snapshots."""
import argparse, json, shutil, subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from build_static import build as base_build
import fib_provider as p
import intraday_provider

def build(output,refresh=False,cache_dir=None):
    output=Path(output);base_build(output,refresh,cache_dir)
    shutil.copy2(Path(__file__).resolve().parent/'fib-client.js',output/'fib-client.js')
    path=output/'data-manifest.json';manifest=json.loads(path.read_text(encoding='utf-8'))
    manifest['version']='6.0';manifest['fibHistories']={};symbols=sorted(manifest.get('histories',{}))
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
    manifest['intradayHistories']={}
    if refresh:
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs={pool.submit(intraday_provider.intraday_history,tv):tv for tv in symbols}
            for job in as_completed(jobs):
                tv=jobs[job]
                try:
                    data=job.result();name='data-intraday-'+tv.replace(':','-')+'.json'
                    (output/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
                    manifest['intradayHistories'][tv]={'file':name,'updated':data['updated'],'lastBar':data['lastBar']}
                except Exception:manifest.setdefault('failures',[]).append('intraday:'+tv)
    path.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    try:
        subprocess.run(['node',str(Path(__file__).resolve().parent/'rank_hongpicks.js'),str(output)],check=True,timeout=120)
        manifest['resources']['hongpicks']='data-hongpicks.json'
    except (OSError,subprocess.SubprocessError):
        manifest.setdefault('failures',[]).append('hongpicks')
        (output/'data-hongpicks.json').write_text(json.dumps({'error':'추천 계산 데이터 없음 · 다음 수집에서 다시 시도합니다.','source':'Hong Pick'}),encoding='utf-8')
        manifest['resources']['hongpicks']='data-hongpicks.json'
    path.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='public');parser.add_argument('--refresh',action='store_true');parser.add_argument('--cache-dir')
    args=parser.parse_args();result=build(args.output,args.refresh,args.cache_dir);print(json.dumps({'generatedAt':result['generatedAt'],'failures':result['failures'],'fibHistories':len(result['fibHistories'])},ensure_ascii=False))

