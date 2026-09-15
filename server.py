from flask import Flask, jsonify, send_from_directory
from pathlib import Path
import os,requests
app=Flask(__name__,static_folder=None); BASE=Path(__file__).resolve().parent
@app.get('/')
def home(): return send_from_directory(BASE,'index.html')
@app.get('/<path:name>')
def files(name):
 p=BASE/name
 return send_from_directory(BASE,name) if p.exists() and p.is_file() else send_from_directory(BASE,'index.html')
@app.get('/api/fng')
def fng():
 try:
  d=requests.get('https://api.alternative.me/fng/?limit=1',timeout=4).json()['data'][0]
  return jsonify(demo=False,value=int(d['value']),classification=d['value_classification'])
 except Exception:return jsonify(demo=True,value=72,classification='Greed')
if __name__=='__main__':app.run(host='0.0.0.0',port=int(os.environ.get('PORT',5000)))
