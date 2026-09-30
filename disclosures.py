"""Official SEC 13F snapshots and OGE public disclosure document catalogue."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import html, json, re, time, xml.etree.ElementTree as ET
from cache import cached, BASE
from providers import SESSION, directory, now
INVESTORS=[('1067983','Berkshire Hathaway','Warren Buffett / Berkshire'),('1336528','Pershing Square','Bill Ackman'),('1536411','Duquesne Family Office','Stanley Druckenmiller'),('1656456','Appaloosa','David Tepper'),('1061768','Baupost Group','Seth Klarman'),('1167483','Tiger Global','Chase Coleman')]

def get(url):
    r=SESSION.get(url,timeout=20);r.raise_for_status();return r

def clean_name(s):
    s=s.upper().replace('&','AND')
    s=re.sub(r'\b(INCORPORATED|INC|CORPORATION|CORP|CO|COMPANY|PLC|LTD|LIMITED|HOLDINGS|HLDGS|NEW|COM|CLASS|CL|ORD|SHS)\b','',s)
    return re.sub(r'[^A-Z0-9]','',s)

def symbol_map():
    def load():
        rows=directory('us')['rows'];by_ticker={x['ticker']:x for x in rows};names={}
        for x in rows:names.setdefault(clean_name(x['name']),[]).append(x)
        # SEC issuer titles establish company identity; exchanges still come from the scanner.
        try:
            issuers=get('https://www.sec.gov/files/company_tickers.json').json()
            for x in issuers.values():
                if x['ticker'] in by_ticker:names.setdefault(clean_name(x['title']),[]).append(by_ticker[x['ticker']])
        except Exception:pass
        names={k:list({x['tv']:x for x in v}.values()) for k,v in names.items()}
        return {'names':names,'tickers':by_ticker}
    return cached('sec-symbols',86400,load)

def match_name(name,cusip=None):
    m=symbol_map();key=clean_name(name);matches=m['names'].get(key,[])
    classes={'02079K305':'GOOGL','02079K107':'GOOG','084670702':'BRK.B','084670108':'BRK.A','874039100':'TSM'}
    if cusip in classes:return m['tickers'].get(classes[cusip])
    # Issuer names in EDGAR are often shortened; these explicit issuer aliases do not infer exchange.
    aliases={'ALPHABET':'GOOGL','META PLATFORMS':'META','AMAZON COM':'AMZN','OCCIDENTAL PETE':'OXY','COCA COLA':'KO','AMERICAN EXPRESS':'AXP','BERKSHIRE HATHAWAY':'BRK.B','TAIWAN SEMICONDUCTOR MFG':'TSM','UNITEDHEALTH GROUP':'UNH','BANK AMER':'BAC','BANK OF AMERICA':'BAC','CHEVRON':'CVX','APPLE':'AAPL','NVIDIA':'NVDA','MICROSOFT':'MSFT','TESLA':'TSLA','CHENIERE ENERGY':'LNG','STRATEGY':'MSTR','KLA':'KLAC','ROYAL GOLD':'RGLD'}
    if len(matches)==1:return matches[0]
    if key in {clean_name(k):v for k,v in aliases.items()}:
        return m['tickers'].get({clean_name(k):v for k,v in aliases.items()}[key])
    return None

def text(node,tag):
    x=next((x for x in node.iter()if x.tag.rsplit('}',1)[-1]==tag),None)
    return x.text.strip() if x is not None and x.text else ''

def filing(cik, accession, report, filed):
    def load():
        base='https://www.sec.gov/Archives/edgar/data/'+str(int(cik))+'/'+accession.replace('-','')+'/'
        files=get(base+'index.json').json()['directory']['item'];rows=[];primary=None;source=None
        for f in files:
            if not f['name'].lower().endswith('.xml'):continue
            root=ET.fromstring(get(base+f['name']).content)
            if any(x.tag.rsplit('}',1)[-1]=='informationTable' for x in root.iter()):source=base+f['name'];info=root
            else:primary=root
        if not source:raise ValueError('SEC information table not found')
        aggregate={}
        for node in info.iter():
            if node.tag.rsplit('}',1)[-1]!='infoTable':continue
            # Options and principal amounts remain separate from common share ownership.
            if text(node,'putCall') or text(node,'sshPrnamtType')!='SH':continue
            cusip=text(node,'cusip');cls=text(node,'titleOfClass');key=cusip+'|'+cls
            value=float(text(node,'value').replace(',',''));shares=float(text(node,'sshPrnamt').replace(',',''))
            if key not in aggregate:aggregate[key]={'key':key,'cusip':cusip,'name':text(node,'nameOfIssuer'),'class':cls,'value':0,'shares':0}
            aggregate[key]['value']+=value;aggregate[key]['shares']+=shares
        # Retain reported values, whose units can vary between filings. They are used only
        # within each filing for portfolio weights; no USD total is inferred.
        multiplier=1
        for x in aggregate.values():x['value']*=multiplier
        total=sum(x['value']for x in aggregate.values())
        for x in aggregate.values():
            x['weight']=x['value']/total*100 if total else 0
            mapped=match_name(x['name'],x['cusip'])
            if mapped:x.update(tv=mapped['tv'],symbol=mapped['tv'],ticker=mapped['ticker'])
        return {'holdings':list(aggregate.values()),'total':total,'valueUnit':'원문 신고값 (비중 계산용)','quarter':report,'filed':filed,'accession':accession,'sourceUrl':base+accession+'-index.htm','tableUrl':source}
    return cached('filing:'+accession,604800,load)

def investor(cik,name,person):
    def load():
        def submissions():return get('https://data.sec.gov/submissions/CIK'+cik.zfill(10)+'.json').json()
        d=cached('submission:'+cik,21600,submissions);r=d['filings']['recent'];indices=[i for i,f in enumerate(r['form'])if f=='13F-HR'];selected=[];seen=set()
        for i in indices:
            report=r['reportDate'][i]
            if report and report not in seen:selected.append(i);seen.add(report)
            if len(selected)==2:break
        if len(selected)<2:raise ValueError('Comparison filings unavailable')
        snapshots=[filing(cik,r['accessionNumber'][i],r['reportDate'][i],r['filingDate'][i])for i in selected]
        current,previous=snapshots;old={x['key']:x for x in previous['holdings']};new={x['key']:x for x in current['holdings']};rows=[]
        for key in new.keys()|old.keys():
            a,b=new.get(key),old.get(key);row=dict(a or b);row['previousShares']=b['shares']if b else 0;row['previousWeight']=b['weight']if b else 0
            row['status']='new'if not b else 'sold'if not a else 'increase'if a['shares']>b['shares'] else 'reduce'if a['shares']<b['shares'] else 'unchanged'
            row['shareChange']=((a['shares']/b['shares']-1)*100)if a and b and b['shares'] else None
            if not a:row.update(shares=0,value=0,weight=0)
            row['weightChange']=row['weight']-row['previousWeight'];rows.append(row)
        rows.sort(key=lambda x:x['value'],reverse=True)
        return {'cik':cik,'name':name,'person':person,'quarter':current['quarter'],'filed':current['filed'],'previousQuarter':previous['quarter'],'sourceUrl':current['sourceUrl'],'previousUrl':previous['sourceUrl'],'tableUrl':current['tableUrl'],'total':current['total'],'holdings':rows,'counts':{k:sum(x['status']==k for x in rows)for k in ['new','increase','reduce','sold','unchanged']},'updated':now()}
    return cached('investor:'+cik,21600,load,'data-guru-'+cik+'.json')

def gurus():
    rows=[]
    # SEC fair access: use only two workers, at most a few requests per second.
    with ThreadPoolExecutor(max_workers=2)as pool:
        jobs=[(args,pool.submit(investor,*args))for args in INVESTORS]
        for args,job in jobs:
            try:rows.append(job.result())
            except Exception:rows.append({'cik':args[0],'name':args[1],'person':args[2],'error':'SEC 공시를 불러오지 못했습니다','holdings':[]})
    quarters={x.get('quarter')for x in rows if x.get('quarter')};consensus={}
    for inv in rows:
        for x in inv['holdings']:
            if not x.get('shares'):continue
            key=x['cusip'];c=consensus.setdefault(key,{'name':x['name'],'cusip':key,'tv':x.get('tv'),'symbol':x.get('symbol'),'ticker':x.get('ticker'),'held':0,'increase':0,'new':0,'investors':[],'quarters':[]})
            c['held']+=1;c['increase']+=x['status']=='increase';c['new']+=x['status']=='new';c['investors'].append(inv['name']);c['quarters'].append(inv['quarter'])
    consensus=sorted(consensus.values(),key=lambda x:(x['increase']+x['new'],x['held']),reverse=True)
    return {'rows':rows,'consensus':consensus,'source':'SEC EDGAR 13F-HR','updated':now(),'notice':'분기말 미국 13F 신고대상 보유주식. 주식수 증감은 분할·이전 등의 영향을 받을 수 있어 실제 체결 매수/매도와 같지 않습니다. 현금·공매도·해외자산 등은 포함하지 않습니다.','mixedQuarters':len(quarters)>1}

OGE_API='https://extapps2.oge.gov/201/Presiden.nsf/API.xsp/v2/rest'
def oge_catalog():
    def load():
        params={'draw':1,'start':0,'length':100,'search[value]':'Trump','search[regex]':'false','order[0][column]':0,'order[0][dir]':'desc'}
        for i,name in enumerate(['docDate','title','type','name','agency','position']):
            params.update({f'columns[{i}][data]':name,f'columns[{i}][name]':'',f'columns[{i}][searchable]':'true',f'columns[{i}][orderable]':'true',f'columns[{i}][search][value]':'',f'columns[{i}][search][regex]':'false'})
        r=SESSION.get(OGE_API,params=params,timeout=20);r.raise_for_status();records=r.json()['data'];rows=[]
        for x in records:
            if 'trump'not in x.get('name','').lower():continue
            links=re.findall(r'href=[\"\x27]([^\"\x27]+)',x.get('type',''))
            for link in links:
                url=html.unescape(link)
                if url.startswith('https://extapps2.oge.gov/')and '.pdf'in url.lower():rows.append({'publicDate':x['docDate'][:10],'name':x['name'],'type':re.sub('<[^>]+>','',x['type']),'sourceUrl':url})
        if not rows:raise ValueError('No official catalogue records')
        return {'reports':rows,'source':'US Office of Government Ethics','updated':now()}
    return cached('oge-catalog',3600,load,'data-trump-catalog.json')

def trump():
    catalog=oge_catalog();data=json.loads((BASE/'data-trump-transactions.json').read_text()) if (BASE/'data-trump-transactions.json').exists() else {'rows':[]}
    return dict(data,reports=catalog['reports'],catalogUpdated=catalog.get('updated'),catalogStale=catalog.get('stale',False),notice='공개된 신고 거래입니다. 제3자 독립 운용 거래가 포함될 수 있으며 트럼프 본인의 직접 투자 결정을 의미하지 않습니다. 금액은 신고 구간으로 실제 체결 금액과 다릅니다. 검증된 행만 표시하며 신규 스캔 원문은 문서 목록에서 확인할 수 있습니다.')
