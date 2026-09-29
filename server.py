"""Hong Pick API. Upstream failures never become invented market data."""
from flask import Flask, jsonify, request, send_from_directory
from pathlib import Path
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
import os
import requests

app = Flask(__name__, static_folder=None)
BASE = Path(__file__).resolve().parent
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': 'HongPick/4.0 (personal dashboard; contact: ' + os.getenv('SEC_CONTACT', 'hongpick@example.com') + ')'})
CACHE = {}
LOCK = Lock()
ALIASES = {'삼성전자': ('005930.KS', 'Samsung Electronics'), 'sk하이닉스': ('000660.KS', 'SK Hynix'), '현대차': ('005380.KS', 'Hyundai Motor'), '기아': ('000270.KS', 'Kia'), '네이버': ('035420.KS', 'NAVER'), '카카오': ('035720.KS', 'Kakao'), '테슬라': ('TSLA', 'Tesla'), '애플': ('AAPL', 'Apple'), '엔비디아': ('NVDA', 'NVIDIA'), '마이크로소프트': ('MSFT', 'Microsoft'), '아마존': ('AMZN', 'Amazon')}
KNOWN_US = {'TSLA':'NASDAQ','AAPL':'NASDAQ','NVDA':'NASDAQ','MSFT':'NASDAQ','AMZN':'NASDAQ','META':'NASDAQ','GOOGL':'NASDAQ','AMD':'NASDAQ','SOXL':'AMEX'}
EXCHANGES = {'NMS': 'NASDAQ', 'NGM': 'NASDAQ', 'NCM': 'NASDAQ', 'NAS': 'NASDAQ', 'NYQ': 'NYSE', 'ASE': 'AMEX', 'PCX': 'AMEX', 'BTS': 'AMEX', 'KSC': 'KRX', 'KOE': 'KRX'}

def cached(key, ttl, fn):
    now = datetime.now(timezone.utc).timestamp()
    with LOCK:
        item = CACHE.get(key)
        if item and item[0] > now: return item[1]
    result = fn()
    with LOCK: CACHE[key] = (now + ttl, result)
    return result

def yahoo_symbol(symbol):
    symbol = symbol.upper().strip()
    if symbol.startswith('KRX:'): return symbol.split(':')[1] + '.KS'
    if ':' in symbol: return symbol.split(':', 1)[1]
    if symbol.isdigit() and len(symbol) == 6: return symbol + '.KS'
    return symbol

def tv_symbol(symbol, exchange=None):
    symbol = symbol.upper()
    if symbol.endswith(('.KS', '.KQ')): return 'KRX:' + symbol[:6]
    prefix = EXCHANGES.get(exchange)
    if prefix: return prefix + ':' + symbol
    if symbol in KNOWN_US: return KNOWN_US[symbol] + ':' + symbol
    return None

def quote_history(symbol, range_='1y'):
    r = SESSION.get('https://query1.finance.yahoo.com/v8/finance/chart/' + requests.utils.quote(symbol, safe=''), params={'range': range_, 'interval': '1d'}, timeout=8)
    r.raise_for_status()
    d = r.json()['chart']['result'][0]
    quotes = d['indicators']['quote'][0]
    closes = [float(x) for x in quotes['close'] if x is not None]
    return d['meta'], closes, quotes

def rsi14(closes):
    if len(closes) < 15: return None
    diffs = [b-a for a,b in zip(closes, closes[1:])]
    gains = [max(d, 0) for d in diffs]
    losses = [max(-d, 0) for d in diffs]
    avg_g, avg_l = sum(gains[:14])/14, sum(losses[:14])/14
    for gain, loss in zip(gains[14:], losses[14:]):
        avg_g = (avg_g*13 + gain)/14
        avg_l = (avg_l*13 + loss)/14
    return round(100 if avg_l == 0 and avg_g else 50 if avg_l == avg_g == 0 else 100-100/(1+avg_g/avg_l), 1)

def stock_details(symbol, display=None, exchange=None):
    meta, closes, quotes = quote_history(symbol)
    tv = tv_symbol(symbol, exchange or meta.get('exchangeName'))
    if not tv: return None
    price = meta.get('regularMarketPrice') or (closes[-1] if closes else None)
    previous = meta.get('chartPreviousClose') or meta.get('previousClose')
    highs = [x for x in quotes.get('high', []) if x is not None]
    high = max(highs) if highs else None
    volume = (quotes.get('volume') or [None])[-1]
    return {'symbol': symbol, 'tv': tv, 'name': display or meta.get('longName') or meta.get('shortName') or symbol, 'price': price, 'change': round((price/previous-1)*100, 2) if price and previous else None, 'turnover': round(price*volume) if price and volume else None, 'rsi': rsi14(closes), 'drawdown': round((price/high-1)*100, 2) if price and high else None, 'source': 'Yahoo Finance daily chart', 'updated': datetime.fromtimestamp(meta.get('regularMarketTime', 0), timezone.utc).isoformat() if meta.get('regularMarketTime') else None}

@app.get('/api/search')
def search():
    q = request.args.get('q', '').strip()[:80]
    if not q: return jsonify(results=[])
    matches = []
    alias = ALIASES.get(q.lower())
    if alias:
        sym, name = alias
        matches.append({'symbol': sym, 'name': name, 'tv': tv_symbol(sym)})
    if q.isdigit() and len(q) == 6:
        for suffix in ('.KS', '.KQ'):
            try:
                meta, _, _ = quote_history(q+suffix, '5d')
                matches.append({'symbol': q+suffix, 'name': meta.get('longName') or meta.get('shortName') or q, 'tv': tv_symbol(q+suffix)})
            except Exception: pass
    try:
        data = SESSION.get('https://query1.finance.yahoo.com/v1/finance/search', params={'q': q, 'quotesCount': 12, 'newsCount': 0}, timeout=6).json()
        for item in data.get('quotes', []):
            sym = item.get('symbol', '')
            tv = tv_symbol(sym, item.get('exchange'))
            if tv and sym and not any(x['symbol'] == sym for x in matches):
                matches.append({'symbol': sym, 'name': item.get('shortname') or item.get('longname') or sym, 'tv': tv})
    except Exception: pass
    return jsonify(results=matches[:12], source='Yahoo Finance search / curated aliases')

@app.get('/api/stock')
def stock():
    symbol = yahoo_symbol(request.args.get('symbol', '')[:30])
    if not symbol or not all(c.isalnum() or c in '.-' for c in symbol): return jsonify(error='Invalid symbol'), 400
    try: return jsonify(cached('stock:'+symbol, 300, lambda: stock_details(symbol) or {'error':'Exchange mapping unavailable'}))
    except Exception: return jsonify(error='Price data unavailable'), 503

@app.get('/api/fng')
def fng():
    def fetch():
        r = SESSION.get('https://api.alternative.me/fng/', params={'limit': 31}, timeout=6)
        r.raise_for_status()
        records = r.json()['data']
        return {'value': int(records[0]['value']), 'classification': records[0]['value_classification'], 'history': [{'date': datetime.fromtimestamp(int(x['timestamp']), timezone.utc).date().isoformat(), 'value': int(x['value'])} for x in reversed(records)], 'source': 'Alternative.me Crypto Fear & Greed Index', 'updated': datetime.fromtimestamp(int(records[0]['timestamp']), timezone.utc).isoformat()}
    try: return jsonify(cached('fng', 3600, fetch))
    except Exception: return jsonify(error='Fear & Greed data unavailable', source='Alternative.me Crypto Fear & Greed Index'), 503

@app.get('/api/turnover')
def turnover():
    market = request.args.get('market', 'us')
    if market not in ('us', 'kr'): return jsonify(error='Invalid market'), 400
    # A ranked TOP 50 requires a licensed, complete market-wide turnover feed.
    # No partial screener or hand-picked list is passed off as a market ranking.
    return jsonify(rows=[], source=None, updated=None, error='실제 거래대금 TOP 50 데이터 제공자 연결 필요 (한국/미국)')

@app.get('/api/gurus')
def gurus():
    return jsonify(rows=[], source='SEC EDGAR 13F', updated=None, error='13F 원문 보유 내역 수집·검증 전')

@app.get('/api/trump')
def trump():
    return jsonify(rows=[], source='Official public financial disclosures', updated=None, error='공식 공시 거래일·공개일 검증 전')

@app.get('/health')
def health(): return jsonify(status='ok')

@app.get('/')
def home(): return send_from_directory(BASE, 'index.html')

@app.get('/<path:name>')
def files(name):
    if name in ('app.js', 'style.css', 'manifest.json'): return send_from_directory(BASE, name)
    return send_from_directory(BASE, 'index.html')

if __name__ == '__main__': app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
