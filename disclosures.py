"""Official SEC 13F snapshots and OGE public disclosure document catalogue."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
import html, json, re, time, xml.etree.ElementTree as ET
from cache import cached, BASE
from providers import SESSION, directory, now
INVESTORS=[('1067983','Berkshire Hathaway','Warren Buffett / Berkshire'),('1336528','Pershing Square','Bill Ackman'),('1536411','Duquesne Family Office','Stanley Druckenmiller'),('1656456','Appaloosa','David Tepper'),('1061768','Baupost Group','Seth Klarman'),('1167483','Tiger Global','Chase Coleman')]
_sec_lock=Lock()
_sec_last=0

def get(url):
    global _sec_last
    if 'sec.gov/' in url:
        with _sec_lock:
            time.sleep(max(0,.15-(time.monotonic()-_sec_last)))
            _sec_last=time.monotonic()
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
        return {'holdings':list(aggregate.values()),'total':total,'valueUnit':'원문 신고값 (비중 계산용)','quarter':report,'filed':filed,'accession':accession,'sourceUrl':base+accession+'-index.htm','tableUrl':source,'amendmentType':text(primary,'amendmentType') if primary is not None else ''}
    return cached('filing:'+accession,604800,load)

def submission_rows(cik):
    d=cached('submission:'+cik,21600,lambda:get('https://data.sec.gov/submissions/CIK'+cik.zfill(10)+'.json').json())
    r=d['filings']['recent']
    return d['name'],[{k:r[k][i] for k in ['form','reportDate','filingDate','accessionNumber','primaryDocument']}for i,f in enumerate(r['form'])if f in ['13F-HR','13F-HR/A','13F-NT','13F-NT/A']]

def reporting_manager(cik):
    """Follow an explicit, single-manager 13F NOTICE; never infer a successor by name."""
    name,rows=submission_rows(cik);seen={cik};notice=None
    for _ in range(3):
        latest=max(rows,key=lambda x:(x['reportDate'],x['filingDate'],x['accessionNumber']))
        if not latest['form'].startswith('13F-NT'):break
        acc=latest['accessionNumber'];base='https://www.sec.gov/Archives/edgar/data/'+str(int(cik))+'/'+acc.replace('-','')+'/'
        root=ET.fromstring(get(base+latest['primaryDocument'].split('/')[-1]).content)
        managers=[x for x in root.iter()if x.tag.rsplit('}',1)[-1]=='otherManager']
        targets={text(x,'cik').lstrip('0') for x in managers if text(x,'cik')}
        if len(targets)!=1:raise ValueError('Multiple reporting managers require review')
        target=targets.pop()
        if target in seen:raise ValueError('Circular reporting manager notice')
        seen.add(target);target_name,target_rows=submission_rows(target)
        if not any(x['reportDate']==latest['reportDate']and x['form'].startswith('13F-HR') for x in target_rows):raise ValueError('Referenced report unavailable')
        last_regular=max((x['reportDate']for x in rows if x['form'].startswith('13F-HR')),default='')
        transition=min((x['reportDate']for x in rows if x['form'].startswith('13F-NT')and x['reportDate']>last_regular),default=latest['reportDate'])
        notice={'sourceUrl':base+acc+'-index.htm','quarter':latest['reportDate'],'filed':latest['filingDate'],'name':name,'transitionQuarter':transition}
        cik,name,rows=target,target_name,target_rows
    else:raise ValueError('Reporting manager chain too long')
    return cik,name,rows,notice

def merge_filings(snapshots):
    """A restatement replaces the report; NEW HOLDINGS adds disclosed positions."""
    positions={};sources=[];current=None
    for s in snapshots:
        kind=s.get('amendmentType','')
        if not kind or kind=='RESTATEMENT':
            positions={x['key']:dict(x)for x in s['holdings']};sources=[]
        elif kind=='NEW HOLDINGS':
            for x in s['holdings']:
                if x['key'] in positions:
                    positions[x['key']]['shares']+=x['shares'];positions[x['key']]['value']+=x['value']
                else:positions[x['key']]=dict(x)
        else:raise ValueError('Unsupported amendment type')
        sources.append({'url':s['sourceUrl'],'filed':s['filed'],'type':kind or '13F-HR'});current=s
    if current is None:raise ValueError('No holdings report')
    total=sum(x['value']for x in positions.values())
    for x in positions.values():x['weight']=x['value']/total*100 if total else 0
    return dict(current,holdings=list(positions.values()),total=total,filings=sources)

def quarter_snapshot(cik,rows,quarter):
    selected=sorted([x for x in rows if x['reportDate']==quarter and x['form'].startswith('13F-HR')],key=lambda x:(x['filingDate'],x['accessionNumber']))
    snapshots=[]
    for x in selected:
        s=filing(cik,x['accessionNumber'],quarter,x['filingDate'])
        if x['form']=='13F-HR/A' and not s.get('amendmentType'):raise ValueError('Amendment metadata missing')
        snapshots.append(s)
    if not any(x['form']=='13F-HR' for x in selected)and not any(x.get('amendmentType')=='RESTATEMENT' for x in snapshots):raise ValueError('Original report missing')
    return merge_filings(snapshots)

def investor(cik,name,person):
    def load():
        reporting_cik,reporting_name,r,reporting_notice=reporting_manager(cik)
        selected=sorted({x['reportDate']for x in r if x['form'].startswith('13F-HR')and x['reportDate']},reverse=True)[:2]
        if len(selected)<2:raise ValueError('Comparison filings unavailable')
        snapshots=[quarter_snapshot(reporting_cik,r,q)for q in selected]
        current,previous=snapshots;old={x['key']:x for x in previous['holdings']};new={x['key']:x for x in current['holdings']};rows=[]
        comparable=not reporting_notice or previous['quarter']>=reporting_notice['transitionQuarter']
        for key in new.keys()|old.keys():
            a,b=new.get(key),old.get(key);row=dict(a or b);row['previousShares']=b['shares']if b else 0;row['previousWeight']=b['weight']if b else 0
            row['status']='new'if not b else 'sold'if not a else 'increase'if a['shares']>b['shares'] else 'reduce'if a['shares']<b['shares'] else 'unchanged'
            row['shareChange']=((a['shares']/b['shares']-1)*100)if a and b and b['shares'] else None
            if not a:row.update(shares=0,value=0,weight=0)
            row['weightChange']=row['weight']-row['previousWeight']
            if not comparable:row.update(status='scope_change',shareChange=None,weightChange=None,previousShares=None,previousWeight=None)
            rows.append(row)
        rows.sort(key=lambda x:x['value'],reverse=True)
        return {'cik':cik,'name':name,'person':person,'reportingCik':reporting_cik,'reportingManager':reporting_name,'reportingNotice':reporting_notice,'comparisonAvailable':comparable,'comparisonNote':None if comparable else '보고 주체·보유 범위 변경 분기입니다. 현재 보유는 표시하고 신규·추가·감축 신호에서는 제외합니다.','filings':current['filings'],'previousFilings':previous['filings'],'quarter':current['quarter'],'filed':current['filed'],'previousQuarter':previous['quarter'],'sourceUrl':current['sourceUrl'],'previousUrl':previous['sourceUrl'],'tableUrl':current['tableUrl'],'total':current['total'],'holdings':rows,'counts':{k:sum(x['status']==k for x in rows)for k in ['new','increase','reduce','sold','unchanged']},'updated':now()}
    return cached('investor:'+cik,21600,load,'data-guru-'+cik+'.json')

def gurus():
    rows=[]
    # SEC fair access: use only two workers, at most a few requests per second.
    with ThreadPoolExecutor(max_workers=2)as pool:
        jobs=[(args,pool.submit(investor,*args))for args in INVESTORS]
        for args,job in jobs:
            try:rows.append(job.result())
            except Exception:rows.append({'cik':args[0],'name':args[1],'person':args[2],'error':'SEC 공시를 불러오지 못했습니다','holdings':[]})
    return summarize_gurus(rows)

def summarize_gurus(rows):
    quarters={x.get('quarter')for x in rows if x.get('quarter')};consensus={}
    for inv in rows:
        for x in inv['holdings']:
            if not x.get('shares'):continue
            key=x['cusip'];c=consensus.setdefault(key,{'name':x['name'],'cusip':key,'tv':x.get('tv'),'symbol':x.get('symbol'),'ticker':x.get('ticker'),'held':0,'increase':0,'new':0,'investors':[],'quarters':[]})
            c['held']+=1;c['increase']+=x['status']=='increase';c['new']+=x['status']=='new';c['investors'].append(inv['name']);c['quarters'].append(inv['quarter'])
    consensus=sorted(consensus.values(),key=lambda x:(x['increase']+x['new'],x['held']),reverse=True)
    return {'rows':rows,'consensus':consensus,'source':'SEC EDGAR 13F-HR','updated':now(),'notice':'분기말 미국 13F 신고대상 보유주식. 비중은 옵션·원금형 자산을 제외한 신고 주식 합계 기준입니다. 주식수 증감은 분할·이전 등의 영향을 받을 수 있어 실제 체결 매수/매도와 같지 않습니다. 현금·공매도·해외자산 등은 포함하지 않습니다.','mixedQuarters':len(quarters)>1}

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
    return format_trump(catalog,data)

def format_trump(catalog,data):
    return dict(data,reports=catalog['reports'],catalogUpdated=catalog.get('updated'),catalogStale=catalog.get('stale',False),notice='공개된 신고 거래입니다. 제3자 독립 운용 거래가 포함될 수 있으며 트럼프 본인의 직접 투자 결정을 의미하지 않습니다. 금액은 신고 구간으로 실제 체결 금액과 다릅니다. 검증된 행만 표시하며 신규 스캔 원문은 문서 목록에서 확인할 수 있습니다.')
