"""Refresh OGE transactions without inventing rows from ambiguous scanned documents."""
import argparse, hashlib, json, os, re, subprocess, tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse
import requests

BASE=Path(__file__).resolve().parent
LIVE='https://jho971031-cloud.github.io/Hongpick/'
PARSER_VERSION=2
RANGES={1001:15000,15001:50000,50001:100000,100001:250000,250001:500000,500001:1000000,1000001:5000000,5000001:25000000,25000001:50000000}


def stamp():return datetime.now(timezone.utc).isoformat()
def identity(row):return (unquote(row['sourceUrl']),row['id'])
def issuer_key(name):
    name=name.upper().replace('&',' AND ')
    name=re.sub(r'\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|PLC|LTD|LIMITED|THE|COM|COMMON|STOCK|NEW)\b','',name)
    return re.sub('[^A-Z0-9]','',name)


def map_equity(name,directory):
    # A debt or preferred-security name must never become the issuer's common stock.
    if re.search(r'\b(PERP|PFD|PREFERRED|NOTES?|BONDS?|DUE|ETF|FUND|REV|CUSIP|SERIES)\b|%',name,re.I):return None
    matches={x['tv']:x for x in directory if x.get('type')=='stock' and issuer_key(x['name'])==issuer_key(name)}
    return next(iter(matches.values())) if len(matches)==1 else None


def parse_lines(text,public_date):
    """Require a complete row, legal amount band, valid date and explicit transaction type."""
    rows={}
    pattern=re.compile(r'^\s*(\d{1,4})\s+(.+?)\s+(purchas[eo]|sal[eo](?:\s*\((?:partial|full)\))?)\s+(\d{1,2}/\d{1,2}/\d{4})\s+(?:yes|no)\s+\$?([\d, ]+)\s*[-–]\s*\$?([\d, ]+)\s*$',re.I)
    for line in text.splitlines():
        line=line.replace('•','-').replace('−','-').replace('|',' ')
        line=re.sub(r'(\d)/\s+(?=\d)',r'\1/',line)
        m=pattern.fullmatch(line)
        if not m:continue
        i,name,action,day,lo,hi=m.groups()
        try:
            trade=datetime.strptime(day,'%m/%d/%Y').date();lower=int(re.sub('[, ]','',lo));upper=int(re.sub('[, ]','',hi))
        except ValueError:continue
        if trade>date.fromisoformat(public_date) or RANGES.get(lower)!=upper:continue
        row={'id':int(i),'sourceName':name.strip(),'action':'buy' if action.lower().startswith('purchas') else 'sell','tradeDate':trade.isoformat(),'amount':f'${lower:,}–${upper:,}'}
        # Duplicate row IDs in one page are ambiguous, even if an OCR engine repeats them.
        if row['id'] in rows:rows[row['id']]=None
        else:rows[row['id']]=row
    return {k:v for k,v in rows.items() if v}


def agreed_rows(text,ocr,public_date):
    a,b=parse_lines(text,public_date),parse_lines(ocr,public_date)
    return [v for k,v in a.items() if k in b and all(v[f]==b[k][f] for f in ('action','tradeDate','amount')) and issuer_key(v['sourceName'])==issuer_key(b[k]['sourceName'])]


def download_pdf(url):
    if urlparse(url).hostname!='extapps2.oge.gov':raise ValueError('Unexpected disclosure host')
    data=bytearray();total=None
    # Resume truncated responses; validate each Content-Range before appending.
    for _ in range(5):
        headers={'Range':f'bytes={len(data)}-'} if data else {}
        with requests.get(url,headers=headers,stream=True,timeout=(10,30)) as r:
            r.raise_for_status()
            if data:
                cr=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)',r.headers.get('Content-Range',''))
                if r.status_code!=206 or not cr or int(cr[1])!=len(data):raise ValueError('Invalid PDF resume range')
                total=int(cr[3])
            else:total=int(r.headers['Content-Length']) if r.headers.get('Content-Length') else None
            try:
                for chunk in r.iter_content(8192):
                    data.extend(chunk)
                    if len(data)>35_000_000:raise ValueError('Disclosure PDF exceeds limit')
            except requests.RequestException:pass
        if (total is None or len(data)==total) and data.startswith(b'%PDF-') and data.rstrip().endswith(b'%%EOF'):return bytes(data)
    raise ValueError('Incomplete PDF download')


def extract_report(pdf_bytes,report,directory):
    """Require agreement across two OCR segmentation passes; native-field conflicts fail closed."""
    rows=[];candidates=0
    with tempfile.TemporaryDirectory() as folder:
        folder=Path(folder);pdf=folder/'report.pdf';pdf.write_bytes(pdf_bytes)
        result=subprocess.run(['pdftotext','-layout',str(pdf),'-'],capture_output=True,text=True,check=True,timeout=60)
        pages=result.stdout.split('\f')
        for pno,text in enumerate(pages,1):
            parsed=parse_lines(text,report['publicDate']);candidates+=len(parsed)
            if pno==1 or 'Summary of Contents' in text or not text.strip():continue
            image=folder/'page'
            subprocess.run(['pdftoppm','-f',str(pno),'-l',str(pno),'-r','300','-singlefile','-png',str(pdf),str(image)],capture_output=True,check=True,timeout=45)
            ocr=subprocess.run(['tesseract',str(image)+'.png','stdout','--psm','3'],capture_output=True,text=True,check=True,timeout=60).stdout
            second=subprocess.run(['tesseract',str(image)+'.png','stdout','--psm','4'],capture_output=True,text=True,check=True,timeout=60).stdout
            for row in agreed_rows(ocr,second,report['publicDate']):
                native=parsed.get(row['id'])
                if native and any(native[f]!=row[f] for f in ('action','tradeDate','amount')):continue
                mapped=map_equity(row['sourceName'],directory)
                if not mapped:continue
                rows.append(dict(row,name=mapped['name'],ticker=mapped['ticker'],tv=mapped['tv'],symbol=mapped['tv'],page=pno,publicDate=report['publicDate'],sourceUrl=report['sourceUrl'],verified='두 OCR 판독 일치 · 자동 추출',validation='ocr-two-pass-agreement-v2'))
    keys=[identity(x) for x in rows]
    if len(keys)!=len(set(keys)):raise ValueError('Repeated transaction IDs across PDF pages')
    return rows,candidates


def collect_transactions(catalog,previous):
    directory=json.loads((BASE/'data-directory-us.json').read_text())['rows']
    seed=json.loads((BASE/'data-trump-transactions.json').read_text())
    # Legacy rows without a PDF fingerprint cannot override a fresh original-document check.
    rows={identity(x):x for x in previous.get('rows',[]) if x.get('sourceSha256') or x['publicDate']<'2026-10-08'};rows.update({identity(x):x for x in seed['rows'] if x.get('sourceSha256') or x['publicDate']<'2026-10-08'})
    states=dict(seed.get('automaticReports',{}),**previous.get('automaticReports',{}));errors=[];added=0
    latest_seed=seed.get('automaticStartDate',max(x['publicDate'] for x in seed['rows']))
    reports=[x for x in catalog.get('reports',[]) if '278 Transaction' in x['type'] and x['publicDate']>=latest_seed]
    for report in reports[:4]:
        url=report['sourceUrl'];old=states.get(url,{})
        try:
            checked=datetime.fromisoformat(old['checkedAt'])
            if old.get('parserVersion')==PARSER_VERSION and old.get('status')=='checked' and (datetime.now(timezone.utc)-checked).total_seconds()<86400:continue
        except (KeyError,ValueError,TypeError):pass
        try:
            pdf=download_pdf(url);digest=hashlib.sha256(pdf).hexdigest()
            if old.get('sha256')==digest and old.get('parserVersion')==PARSER_VERSION and old.get('status')=='checked':
                states[url]=dict(old,checkedAt=stamp());continue
            parsed,candidates=extract_report(pdf,report,directory)
            for row in parsed:row['sourceSha256']=digest
            if not parsed:raise ValueError('No independently verified equity rows')
            # Replace legacy or superseded rows of this PDF; never retain contradicted data.
            rows={k:v for k,v in rows.items() if unquote(v['sourceUrl'])!=unquote(url)}
            for row in parsed:
                key=identity(row)
                if key not in rows:rows[key]=row;added+=1
            states[url]={'status':'checked' if parsed else 'retry','parserVersion':PARSER_VERSION,'checkedAt':stamp(),'sha256':digest,'matchedRows':len(parsed),'textCandidates':candidates,'reviewRequired':True}
        except Exception as error:
            errors.append({'publicDate':report['publicDate'],'sourceUrl':url,'reason':type(error).__name__})
            states[url]={'status':'retry','checkedAt':stamp(),'parserVersion':PARSER_VERSION}
    data=dict(seed,rows=list(rows.values()),automaticReports=states,collectionCheckedAt=stamp(),collectionErrors=errors,refreshMinutes=5)
    if added:data['updated']=stamp()
    else:data['updated']=max(previous.get('updated',''),seed.get('updated',''))
    data['coverage']='주요 주식 거래: 원문 대조 완료 행과 두 OCR 판독의 거래일·유형·금액·종목명이 일치한 자동 추출 행을 표시합니다. 전체 거래 목록이 아니며 채권·ETF·종류주 불명확 행과 판독 불일치는 공개 거래 목록에 넣지 않습니다.'
    return data


def read_previous(path,live=False):
    baseline=json.loads(path.read_text()) if path.exists() else json.loads((BASE/'data-trump-transactions.json').read_text())
    if path.exists() and not live:return baseline
    try:
        r=requests.get(LIVE+'data-trump.json',timeout=20);r.raise_for_status();latest=r.json()
        rows={identity(x):x for x in baseline.get('rows',[])};rows.update({identity(x):x for x in latest.get('rows',[])})
        return dict(latest,rows=list(rows.values()),automaticReports=dict(baseline.get('automaticReports',{}),**latest.get('automaticReports',{})))
    except (requests.RequestException,ValueError):return baseline


def refresh_public(folder):
    from disclosures import oge_catalog,format_trump
    os.environ['HONGPICK_SYNC_COLLECTION']='1'
    folder=Path(folder);catalog=oge_catalog();data=collect_transactions(catalog,read_previous(folder/'data-trump.json'))
    output=format_trump(catalog,data)
    for name,value in [('data-trump.json',output),('data-trump-catalog.json',catalog)]:
        tmp=folder/(name+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')));tmp.replace(folder/name)
    print(json.dumps({'rows':len(output['rows']),'latestReportDate':output['latestReportDate'],'catalogStale':output['catalogStale'],'errors':len(data['collectionErrors'])}))
    # Persist the visible failure state but fail the workflow so GitHub records the incident.
    return bool(catalog.get('stale') or data['collectionErrors'])


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--public',required=True);args=parser.parse_args()
    failed=refresh_public(args.public)
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('collection_failed='+str(failed).lower()+'\n')
