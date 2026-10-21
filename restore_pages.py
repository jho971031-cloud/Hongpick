"""Restore the latest successful Pages artifact for this exact source revision."""
import io,json,os,tarfile,zipfile
from pathlib import Path
import requests
repo=os.environ['GITHUB_REPOSITORY'];sha=os.environ['GITHUB_SHA']
s=requests.Session();s.headers.update(Authorization='Bearer '+os.environ['GH_TOKEN'],Accept='application/vnd.github+json')
def get(path):
 r=s.get('https://api.github.com/repos/'+repo+'/'+path,timeout=30);r.raise_for_status();return r
runs=get('actions/runs?status=success&per_page=30').json()['workflow_runs']
for run in runs:
 if run['head_sha']!=sha:continue
 artifacts=get(f"actions/runs/{run['id']}/artifacts").json()['artifacts']
 found=next((a for a in artifacts if a['name']=='github-pages' and not a['expired']),None)
 if not found:continue
 archive=get(f"actions/artifacts/{found['id']}/zip").content
 with zipfile.ZipFile(io.BytesIO(archive)) as z:
  with tarfile.open(fileobj=io.BytesIO(z.read('artifact.tar'))) as tar:
   tar.extractall('public',filter='data')
 if not Path('public/index.html').exists():raise RuntimeError('Pages artifact missing index')
 print('Restored successful Pages artifact for current commit');break
else:raise RuntimeError('No successful Pages artifact for current commit; wait for the full publish workflow')
