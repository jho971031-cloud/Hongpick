"""Single-flight cache with stale-while-revalidate; real dated snapshots survive outages."""
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
from time import time
from copy import deepcopy
from pathlib import Path
from datetime import datetime
import json, os, hashlib, tempfile
BASE=Path(__file__).resolve().parent
_items,_locks,_pending,_guard={},{},set(),Lock()
_pool=ThreadPoolExecutor(max_workers=4)

def disk_path(key):
    folder=os.getenv('HONGPICK_CACHE_DIR')
    if not folder:return None
    path=Path(folder);path.mkdir(parents=True,exist_ok=True)
    return path/('cache-'+hashlib.sha256(key.encode()).hexdigest()+'.json')

def remember(key,ttl,data):
    expiry=time()+ttl
    with _guard:_items[key]=(expiry,deepcopy(data))
    path=disk_path(key)
    if path:
        handle,tmp=tempfile.mkstemp(dir=path.parent,suffix='.tmp')
        try:
            with os.fdopen(handle,'w') as f:json.dump({'expiry':expiry,'data':data},f,ensure_ascii=False)
            os.replace(tmp,path)
        finally:
            if os.path.exists(tmp):os.unlink(tmp)

def cached(key,ttl,load,seed=None):
    with _guard:
        lock=_locks.setdefault(key,Lock())
        if key not in _items:
            path=disk_path(key)
            if path and path.exists():
                try:
                    record=json.loads(path.read_text());_items[key]=(record['expiry'],record['data'])
                except (ValueError,KeyError,OSError):pass
        if key not in _items and seed and (BASE/seed).exists():
            data=json.loads((BASE/seed).read_text());stamp=data.get('updated')
            try:expiry=datetime.fromisoformat(stamp).timestamp()+ttl
            except Exception:expiry=0
            _items[key]=(expiry,data)
        old=_items.get(key)
        if old and not os.getenv('HONGPICK_SYNC_COLLECTION'):
            if old[0]>time():return deepcopy(old[1])
            data=deepcopy(old[1]);data['stale']=True;data['notice']='이전 수집 실제 데이터 · 제공원에서 갱신 중'
            if key not in _pending:
                _pending.add(key)
                def refresh():
                    try:
                        result=load()
                        remember(key,ttl,result)
                    except Exception:
                        prior=deepcopy(old[1]);prior['stale']=True;prior['notice']='제공원 연결 오류 · 마지막 수집 실제 데이터'
                        with _guard:_items[key]=(time()+60,prior)
                    finally:
                        with _guard:_pending.discard(key)
                _pool.submit(refresh)
            return data
    with lock:
        with _guard:old=_items.get(key)
        if old and old[0]>time():return deepcopy(old[1])
        try:data=load()
        except Exception:
            if not old:raise
            data=deepcopy(old[1]);data['stale']=True;data['notice']='제공원 연결 오류 · 마지막 수집 실제 데이터'
            remember(key,60,data)
            return data
        remember(key,ttl,data)
        return data
