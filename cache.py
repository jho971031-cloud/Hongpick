"""Single-flight cache with stale-while-revalidate; real dated snapshots survive outages."""
from threading import Lock, Thread
from time import time
from copy import deepcopy
from pathlib import Path
from datetime import datetime
import json
BASE=Path(__file__).resolve().parent
_items,_locks,_pending,_guard={},{},set(),Lock()

def cached(key,ttl,load,seed=None):
    with _guard:
        lock=_locks.setdefault(key,Lock())
        if key not in _items and seed and (BASE/seed).exists():
            data=json.loads((BASE/seed).read_text());stamp=data.get('updated')
            try:expiry=datetime.fromisoformat(stamp).timestamp()+ttl
            except Exception:expiry=0
            _items[key]=(expiry,data)
        old=_items.get(key)
        if old:
            if old[0]>time():return deepcopy(old[1])
            data=deepcopy(old[1]);data['stale']=True;data['notice']='이전 수집 실제 데이터 · 제공원에서 갱신 중'
            if key not in _pending:
                _pending.add(key)
                def refresh():
                    try:
                        result=load()
                        with _guard:_items[key]=(time()+ttl,deepcopy(result))
                    except Exception:
                        prior=deepcopy(old[1]);prior['stale']=True;prior['notice']='제공원 연결 오류 · 마지막 수집 실제 데이터'
                        with _guard:_items[key]=(time()+60,prior)
                    finally:
                        with _guard:_pending.discard(key)
                Thread(target=refresh,daemon=True).start()
            return data
    with lock:
        with _guard:old=_items.get(key)
        if old:return deepcopy(old[1])
        data=load()
        with _guard:_items[key]=(time()+ttl,deepcopy(data))
        return data
