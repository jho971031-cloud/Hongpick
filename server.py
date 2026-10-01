"""Hong Pick Flask API. Errors are isolated; unavailable values never become demo prices."""
from flask import Flask, jsonify, request, send_from_directory
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import os, re
import providers, disclosures, fib_provider, intraday_provider
app=Flask(__name__,static_folder=None)
BASE=Path(__file__).resolve().parent




@app.after_request
def pages_cors(response):
    if request.path.startswith('/api/') and request.method=='GET' and request.headers.get('Origin')=='https://jho971031-cloud.github.io':
        response.headers['Access-Control-Allow-Origin']='https://jho971031-cloud.github.io'
        response.headers.add('Vary','Origin')
    return response




def fail(message,source=None):return jsonify(error=message,source=source),503
@app.get('/api/search')
def search():
    q=request.args.get('q','').strip()[:80]
    return jsonify(providers.search(q)if q else {'results':[]})
@app.get('/api/stock')
def stock():
    try:return jsonify(providers.stock(providers.resolve(request.args.get('symbol','')[:40])))
    except ValueError as e:return jsonify(error=str(e)),400
    except Exception:return fail('시세 제공원 연결 오류 · 데이터 없음','TradingView Screener')
@app.get('/api/history')
def history():
    interval=request.args.get('interval','D')
    if interval not in ['D','W','M']:return jsonify(error='지원하지 않는 주기'),400
    try:return jsonify(providers.history(providers.resolve(request.args.get('symbol','')[:40]),interval))
    except ValueError as e:return jsonify(error=str(e)),400
    except Exception:return fail('일봉 제공원 연결 오류 · 차트 데이터 없음','NAVER Finance / Yahoo Finance')
@app.get('/api/intraday')
def intraday():
    try:symbol=providers.resolve(request.args.get('symbol','')[:40])
    except ValueError as e:return jsonify(error=str(e)),400
    try:return jsonify(intraday_provider.intraday_history(symbol))
    except Exception:
        try:
            name='data-intraday-'+symbol.replace(':','-')+'.json'
            response=providers.SESSION.get('https://jho971031-cloud.github.io/Hongpick/'+name,timeout=12);response.raise_for_status();data=response.json()
            if not data.get('candles'):raise ValueError('분봉 없음')
            return jsonify(data)
        except Exception:return fail('해당 종목 분봉 제공원 연결 오류 · 데이터 없음','Yahoo Finance / Hong Pick Pages snapshot')
@app.get('/api/fib-history')
def fib_history():
    try:symbol=providers.resolve(request.args.get('symbol','')[:40])
    except ValueError as e:return jsonify(error=str(e)),400
    try:return jsonify(fib_provider.fibonacci_history(symbol))
    except Exception:
        try:
            name='data-fib-history-'+symbol.replace(':','-')+'.json'
            response=providers.SESSION.get('https://jho971031-cloud.github.io/Hongpick/'+name,timeout=12);response.raise_for_status()
            data=response.json()
            if not data.get('candles'):raise ValueError('주봉 데이터 없음')
            return jsonify(data)
        except Exception:return fail('자동 작도용 10년 주봉 데이터 없음','NAVER Finance / Yahoo Finance / Hong Pick Pages snapshot')
@app.get('/api/turnover')
def turnover():
    market=request.args.get('market','us')
    if market not in ['kr','us']:return jsonify(error='지원하지 않는 시장'),400
    try:return jsonify(providers.turnover(market))
    except Exception:return fail('거래대금 제공원 연결 오류 · 데이터 없음','TradingView Screener')
@app.get('/api/hongpicks')
def hongpicks():
    def load():
        response=providers.SESSION.get('https://jho971031-cloud.github.io/Hongpick/data-hongpicks.json',timeout=12)
        response.raise_for_status();data=response.json()
        if data.get('error') or not isinstance(data.get('rows'),list):raise ValueError('추천 데이터 없음')
        return data
    try:return jsonify(providers.cached('hongpicks-v56',900,load))
    except Exception:return fail('추천 실제 데이터 없음 · 다른 메뉴는 계속 사용할 수 있습니다.','Hong Pick collected OHLCV')
@app.get('/api/fng')
def fng():
    kind=request.args.get('kind','stock')
    if kind not in ['stock','crypto']:return jsonify(error='지원하지 않는 지표'),400
    try:return jsonify(providers.fear_greed(kind))
    except Exception:return fail('CNN 제공원 접근 제한 · 데이터 없음. 암호화폐 지표는 별도 탭에서 확인할 수 있습니다.'if kind=='stock'else'암호화폐 심리 데이터 없음','CNN'if kind=='stock'else'Alternative.me')
@app.get('/api/overview')
def overview():return jsonify(providers.overview())
@app.get('/api/gurus')
def gurus():return jsonify(disclosures.gurus())
@app.get('/api/trump')
def trump():
    try:return jsonify(disclosures.trump())
    except Exception:return fail('OGE 공시 제공원 연결 오류 · 데이터 없음','US Office of Government Ethics')
@app.get('/api/disclosure-performance')
def performance():
    # Return since the first trading day's close on/after the verified public date.
    from datetime import date
    try:
        start=request.args.get('date','');date.fromisoformat(start);tv=providers.resolve(request.args.get('symbol','')[:40]);d=providers.history(tv)
        rows=[x for x in d['candles']if x['time']>=start]
        if len(rows)<2:return jsonify(error='공개 이후 가격 데이터 없음'),404
        return jsonify(change=(rows[-1]['close']/rows[0]['close']-1)*100,baselineDate=rows[0]['time'],baseline=rows[0]['close'],latestDate=rows[-1]['time'],latest=rows[-1]['close'],source=d['source'],method='공개일 이후 첫 거래일 종가 → 최신 일봉 종가. 배당 미포함 가격 변화.')
    except Exception:return fail('공개 이후 가격 변화 데이터 없음')
@app.get('/health')
def health():return jsonify(status='ok',version='5.7')
@app.get('/')
def home():return send_from_directory(BASE,'index.html')
@app.get('/<path:name>')
def files(name):
    if name in ['app.js','data-client.js','fib-client.js','charts.js','style.css','manifest.json','lightweight-charts.js','LICENSE-lightweight-charts.txt','responsive-check.html']:return send_from_directory(BASE,name)
    if re.fullmatch(r'data-[A-Za-z0-9-]+\.json',name):
        public=BASE/'public'
        return send_from_directory(public if (public/name).exists() else BASE,name)
    if name.startswith('api/'):return jsonify(error='API not found'),404
    return send_from_directory(BASE,'index.html')
if __name__=='__main__':app.run(host='0.0.0.0',port=int(os.environ.get('PORT',5000)))

