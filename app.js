const $=id=>document.getElementById(id);
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v,digits=2)=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:digits});
const percent=v=>v==null?'—':`${v>0?'+':''}${number(v)}%`;
const formatDate=v=>{if(!v)return'시각 없음';const d=new Date(v);return isNaN(d)?v:d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST'};
function readWatch(){try{return JSON.parse(localStorage.getItem('hongpick.watch.v1')||'[]').filter(x=>x?.tv).slice(0,100)}catch{return[]}}
function readFngKind(){try{return localStorage.getItem('hongpick.fng.kind')==='crypto'?'crypto':'stock'}catch{return 'stock'}}
const state={market:'us',rank:50,filters:new Set(),rows:[],watch:readWatch(),search:null,current:null,gurus:null,guruIndex:0,guruFilter:'all',trump:null,trumpFilter:'all',trumpQuery:'',fngKind:readFngKind(),loaded:new Set(),page:'home'};
const charts={};
let overviewBtc=null;
let coinLiveClient=null,coinLiveKey='',coinLiveState='연결 대기',liveQuotes=new Map(),livePaintTimer=null;
let coinData=null,coinSelected=null,coinPending=null,coinSearchToken=0,watchMarket='stock';
let picksPending=null,picksData=null,picksMarket='all',picksOversold=false,picksEntryOnly=false;
let codexPending=null,codexData=null,codexMarket='all',codexStrategy='all';
let chartPicksKind='hong';
async function api(path){
 return HongData.api(path);
}
let chartScripts;
function ensureCharts(){if(!chartScripts)chartScripts=(async()=>{for(const name of ['fib-client.js?v=6.4.2','lightweight-charts.js','scenario.js?v=6.8.1','charts.js?v=6.8.1'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=HongData.asset(name);script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('차트 모듈을 불러오지 못했습니다.'))};document.head.append(script)})})().catch(error=>{chartScripts=null;throw error});return chartScripts}
function notice(root,text){root.innerHTML='<div class="empty">'+escapeHtml(text)+'</div>'}
function source(d){return `${d.source||''}${d.kind||/13F|OGE|CNN|Fear|Alternative/.test(d.source||'')?'':' · 지연·주기 수집'} · 기준시각 ${formatDate(d.updated)}${d.stale?' · 이전 데이터':''}`}
const pages=['menu','hongpicks','codexpicks','home','search','coins','gurus','turnover','fng','trump','watchlist'];
const pageScrolls=new Map();let scrollSaveFrame=null,scrollRestore=null,navigationSerial=0;
history.scrollRestoration='manual';
function rememberPageScroll(){
 if(scrollRestore)return;const y=window.scrollY;pageScrolls.set(state.page,y);
 const old=history.state||{},nav=old.hongNavigation;
 if(nav?.page===state.page)history.replaceState({...old,hongNavigation:{...nav,y}},'');
}
function cancelScrollRestore(){if(!scrollRestore)return;scrollRestore.observer?.disconnect();scrollRestore=null;rememberPageScroll()}
for(const event of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(event,cancelScrollRestore,{passive:true});
window.addEventListener('scroll',()=>{
 if(scrollRestore||scrollSaveFrame!==null)return;
 const key=history.state?.hongNavigation?.key,page=state.page;
 scrollSaveFrame=requestAnimationFrame(()=>{scrollSaveFrame=null;if(key===history.state?.hongNavigation?.key&&page===state.page)rememberPageScroll()});
},{passive:true});
function restorePageScroll(y,tasks){
 const target={page:state.page,y:Math.max(0,Number(y)||0)};scrollRestore=target;
 const apply=()=>{if(scrollRestore===target&&state.page===target.page)window.scrollTo({top:target.y,left:0,behavior:'instant'})};
 if(window.ResizeObserver){target.observer=new ResizeObserver(apply);target.observer.observe($(target.page))}
 requestAnimationFrame(apply);
 Promise.allSettled(tasks).then(()=>requestAnimationFrame(()=>{apply();requestAnimationFrame(()=>{if(scrollRestore===target){target.observer?.disconnect();scrollRestore=null;rememberPageScroll()}})}));
}
function show(id,updateHash=true,restore=false){
 if(!pages.includes(id))id='home';
 if(updateHash)rememberPageScroll();
 if(scrollSaveFrame!==null){cancelAnimationFrame(scrollSaveFrame);scrollSaveFrame=null}
 scrollRestore?.observer?.disconnect();scrollRestore=null;
 const saved=history.state?.hongNavigation,restoreY=restore?(saved?.page===id?saved.y:pageScrolls.get(id)||0):0;
 state.page=id;const tasks=[];
 document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));
 document.querySelectorAll('header [data-go]').forEach(b=>{b.classList.toggle('active',b.dataset.go===id);b.setAttribute('aria-current',b.dataset.go===id?'page':'false')});
 if(updateHash&&location.hash!=='#'+id)history.pushState({hongNavigation:{page:id,y:0,key:Date.now()+':'+(++navigationSerial)}},'','#'+id);
 else if(history.state?.hongNavigation?.page!==id)history.replaceState({...history.state,hongNavigation:{page:id,y:restoreY,key:Date.now()+':'+(++navigationSerial)}},'');
 if(!restore)window.scrollTo({top:0,left:0,behavior:'instant'});
 if(id==='watchlist')tasks.push(renderWatch());if(id==='turnover')tasks.push(loadTurnover());if(id==='gurus')tasks.push(loadGurus());if(id==='trump'&&!state.trump)tasks.push(loadTrump());if(id==='fng')tasks.push(loadFng());
 if(id==='coins'){tasks.push(loadCoins());if(coinSelected&&!charts.coins)tasks.push(openCoin(coinSelected))}
 if(id==='home')tasks.push(loadOverview(),loadFng(),loadGurus(),loadPicks(),loadCodexPicks());if(id==='hongpicks')tasks.push(loadPicks());if(id==='codexpicks')tasks.push(loadCodexPicks());
 if(id==='search'&&!charts.search)tasks.push(renderChart(state.search||{tv:'NASDAQ:NVDA',symbol:'NASDAQ:NVDA',name:'NVIDIA',ticker:'NVDA'},'search'));
 if(id==='search')tasks.push(loadChartPicks());
 if(restore)restorePageScroll(restoreY,tasks);
 requestAnimationFrame(()=>{Object.values(charts).forEach(x=>{x.resize();if(x.item?.tv.startsWith('BINANCE:')){if(id==='coins')x.startLive();else x.stopLive()}});syncLiveQuotes()});
}
window.addEventListener('popstate',()=>show(location.hash.slice(1)||'home',false,true));
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1)||'home';if(id!==state.page)show(id,false,true)});
async function renderChart(item,mode='search'){if(!item?.tv)return;const searchMode=mode==='search',key=searchMode?'search':'current';state[key]=item;$(searchMode?'searchTitle':'chartTitle').textContent=item.name||item.ticker||item.symbol;$(searchMode?'searchSub':'turnChartSub').textContent=item.tv;const target=$(searchMode?'searchChart':'chart'),controls=$(searchMode?'searchIndicators':'turnIndicators');if(searchMode){loadDetails(item);renderChartPicks()}try{await ensureCharts();if(state[key]?.tv!==item.tv)return;if(!charts[mode])charts[mode]=new HongChart(target,controls);charts[mode].load(item)}catch(e){notice(target,e.message)}}
function openStock(item){if(item?.type==='crypto'||/^(BINANCE|CRYPTO):/.test(item?.tv||'')){show('coins');openCoin(item);return}state.search=item;const ready=!!charts.search;show('search');if(ready)renderChart(item,'search');renderChartPicks()}
async function loadCoins(){
 if(coinPending)return coinPending;
 if(!coinChartVisible())$('coinStatus').textContent='바이낸스 현물 거래대금을 불러오는 중…';
 coinPending=(async()=>{try{coinData=await api('/api/coins?kind=turnover');if(!coinChartVisible())$('coinStatus').textContent=source(coinData);$('coinMethod').textContent=coinData.method;if(!coinChartVisible()||!$('coinRows').querySelector('[data-coin-row]'))renderCoins()}catch(e){if(!coinChartVisible()||!coinData){$('coinStatus').textContent=e.message;notice($('coinRows'),e.message)}}finally{coinPending=null}})();return coinPending;
}
function renderCoins(){
 const n=Number($('coinLimit').value)||Infinity,rows=(coinData?.rows||[]).map(liveCoinRow).sort((a,b)=>b.turnover-a.turnover).map((x,i)=>({...x,rank:i+1})).slice(0,n);$('coinStatus').textContent='Binance Spot · '+coinLiveState+' · 순위: 24시간 체결대금 · 미수신 종목은 수집본'+(coinData?' · 수집 '+formatDate(coinData.updated):'');$('coinCount').textContent=rows.length+'개 / '+(coinData?.rows.length||0)+'개 USDT 현물';
 $('coinRows').innerHTML=rows.map((x,i)=>`<tr tabindex="0" data-coin-row="${i}"><td>${x.rank}</td><td><b>${escapeHtml(x.name)} / ${escapeHtml(x.ticker)}</b>${x.nameAvailable?'':'<br><small>한글명 확인 전</small>'}</td><td>${number(x.price,10)}<small> USDT · ${x.live?'실시간':'수집본'}<br>${formatDate(x.updated)}</small></td><td class="${x.change<0?'down':'up'}">${percent(x.change)}</td><td>${number(x.turnover/1e6,2)}M<small> USDT</small></td></tr>`).join('')||'<tr><td colspan="5" class="empty">바이낸스 실제 데이터 없음</td></tr>';
 $('coinRows').querySelectorAll('[data-coin-row]').forEach(b=>{const action=()=>{openCoin(rows[+b.dataset.coinRow]);$('coinChartPanel').scrollIntoView({behavior:'smooth',block:'start'})};b.onclick=action;b.onkeydown=e=>{if(e.key==='Enter')action()}});
}
async function searchCoins(){
 const q=$('coinSearchInput').value.trim();if(!q)return;const token=++coinSearchToken;notice($('coinSearchResults'),'코인 검색 중…');
 try{const d=await api('/api/coins?kind=search&q='+encodeURIComponent(q));if(token!==coinSearchToken)return;const root=$('coinSearchResults');root.replaceChildren();if(!d.results.length){notice(root,'거래 중인 바이낸스 USDT 현물을 찾지 못했습니다.');return}for(const x of d.results){const b=document.createElement('button');b.innerHTML=`${escapeHtml(x.name)} / ${escapeHtml(x.ticker)}<small>바이낸스 · USDT 현물</small>`;b.onclick=()=>{root.replaceChildren();$('coinSearchInput').value=x.ticker;openCoin(x);$('coinChartPanel').scrollIntoView({behavior:'smooth',block:'start'})};root.append(b)}}catch(e){if(token===coinSearchToken)notice($('coinSearchResults'),e.message)}
}
async function openCoin(item){
 try{
  if(!item.tv.startsWith('BINANCE:')){const base=item.ticker||item.tv.split(':').at(-1).replace('-USD','');const d=await api('/api/coins?kind=search&q='+encodeURIComponent(base.replace('-USD','')+'USDT'));item=d.results.find(x=>x.baseAsset===base.replace('-USD',''));if(!item)throw Error('기존 코인과 일치하는 바이낸스 USDT 현물 없음')}
  coinSelected=item;syncLiveQuotes();$('coinChartPanel').hidden=false;$('coinChartTitle').textContent=item.name+' / '+item.ticker;$('coinChartSub').textContent='Binance · USDT 현물';
  await ensureCharts();if(coinSelected?.tv!==item.tv)return;if(!charts.coins)charts.coins=new HongChart($('coinChart'),$('coinIndicators'));charts.coins.load(item);
  try{const d=await api('/api/stock?symbol='+encodeURIComponent(item.tv));if(coinSelected?.tv!==item.tv)return;$('coinChartSub').textContent=number(d.price,10)+' USDT · 24시간 '+percent(d.change)+' · 거래대금 순위 '+d.rank;$('coinQuoteSource').textContent=source(d)}catch(e){$('coinQuoteSource').textContent=e.message}
 }catch(e){notice($('coinChart'),e.message)}
}
let searchToken=0;
async function search(){const q=$('searchInput').value.trim();if(!q)return;const token=++searchToken;notice($('searchResults'),'검색 중…');try{const d=await api('/api/search?q='+encodeURIComponent(q));if(token!==searchToken)return;const root=$('searchResults');root.replaceChildren();if(!d.results.length){notice(root,d.error||'검색 결과가 없습니다. 종목명 또는 티커를 확인해 주세요.');return}for(const item of d.results){const b=document.createElement('button');b.innerHTML=`${escapeHtml(item.name)}<small>${escapeHtml(item.ticker)} · ${escapeHtml(item.tv)} · ${item.type==='crypto'?'암호화폐 · USD 종합':item.type==='fund'?'ETF':'주식'}</small>`;b.onclick=()=>{renderChart(item,'search');root.replaceChildren();$('searchInput').value=item.ticker||item.name};root.append(b)}}catch(e){if(token===searchToken)notice($('searchResults'),e.message)}}
async function loadDetails(item){try{const d=await api('/api/stock?symbol='+encodeURIComponent(item.tv));if(state.search?.tv!==item.tv)return;$('searchSub').textContent=`${item.tv} · ${number(d.price)} ${d.currency} · ${percent(d.change)} · RSI ${number(d.rsi,1)} · 고점 ${percent(d.drawdown)} · 지연 시세`;$('searchQuoteSource').textContent=source(d)}catch(e){if(state.search?.tv===item.tv)$('searchQuoteSource').textContent=e.message}}
let turnoverToken=0;
async function loadTurnover(){const token=++turnoverToken,market=state.market;if(state.rowMarket!==market){state.rows=[];$('rows').innerHTML='<tr><td colspan="7" class="empty">선택한 시장을 불러오는 중…</td></tr>'}$('turnTitle').textContent=(market==='kr'?'한국':'미국')+' 거래대금 TOP '+state.rank+' · 추정';$('turnStatus').textContent='불러오는 중…';try{const d=await api('/api/turnover?market='+market);if(token!==turnoverToken)return;state.rows=d.rows;state.rowMarket=market;$('turnStatus').textContent=source(d);$('turnMethod').textContent=d.coverage+' · '+d.method+(d.notice?' · '+d.notice:'');renderRows();if(!state.current||(state.current.tv.startsWith('KRX:')?'kr':'us')!==market)renderChart(d.rows[0],'turn')}catch(e){if(token!==turnoverToken)return;state.rows=[];$('turnStatus').textContent=e.message;renderRows()}}
function renderRows(){let rows=state.rows.slice(0,state.rank);const tests={rsi30:x=>x.rsi!=null&&x.rsi<=30,rsi25:x=>x.rsi!=null&&x.rsi>=25&&x.rsi<=35,rsi40:x=>x.rsi!=null&&x.rsi<=40,dd30:x=>x.drawdown!=null&&x.drawdown<=-30,dd50:x=>x.drawdown!=null&&x.drawdown<=-50,surge:x=>x.surge===true};rows=rows.filter(x=>[...state.filters].every(f=>tests[f](x)));$('turnTitle').textContent=(state.market==='kr'?'한국':'미국')+' 거래대금 TOP '+state.rank+' · 추정';$('filterCount').textContent=`${rows.length}개 결과 · 선택한 조건 모두 충족`;const root=$('rows');root.innerHTML=rows.length?rows.map((x,i)=>`<tr tabindex="0" data-index="${i}"><td>${x.rank}</td><td>${escapeHtml(x.name)}<br><small>${escapeHtml(x.tv)}</small></td><td>${number(x.price)}<small> ${x.currency}</small></td><td class="${x.change<0?'down':'up'}">${percent(x.change)}</td><td>${compactMoney(x.turnover,x.currency)}</td><td>${number(x.rsi,1)}</td><td>${percent(x.drawdown)}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">'+(state.rows.length?'조건을 충족하는 종목이 없습니다. 필터를 조정해 주세요.':'거래대금 데이터 없음')+'</td></tr>';root.querySelectorAll('[data-index]').forEach(row=>{const action=()=>{renderChart(rows[+row.dataset.index],'turn');$('chart').scrollIntoView({behavior:'smooth',block:'center'})};row.onclick=action;row.onkeydown=e=>{if(e.key==='Enter')action()}})}
function compactMoney(v,c){if(v==null)return'—';if(c==='KRW')return number(v/1e8,1)+'억';return'$'+number(v/1e6,1)+'M'}
async function loadOverview(){
 const cards=document.querySelectorAll('.markets article');
 try{const d=await api('/api/overview');overviewBtc=d.rows[2];d.rows.forEach((x,i)=>{cards[i].querySelector('b').textContent=x.price==null?'데이터 없음':number(x.price);cards[i].querySelector('em').textContent=percent(x.change);cards[i].querySelector('em').classList.toggle('down',x.change<0);cards[i].title=source(x)});$('overviewSource').textContent=d.rows.slice(0,2).map(x=>x.name+' · 지연·수집 시세 · '+(x.price==null?'데이터 없음':formatDate(x.updated)+(x.stale?' · 이전 데이터':''))).join(' / ')+' · Yahoo Finance';paintLiveCoins()}
 catch(e){cards.forEach((x,i)=>{if(i<3){x.querySelector('b').textContent='데이터 없음';x.querySelector('em').textContent='—'}});$('overviewSource').textContent=e.message}
}
function sentimentLabels(kind){
 const stock=kind==='stock';$('homeFngTitle').textContent=(stock?'미국 주식':'암호화폐')+' Fear & Greed';$('fngDescription').textContent=stock?'미국 주식시장 심리':'암호화폐 시장 심리';
 document.querySelectorAll('[data-fng-kind]').forEach(b=>b.classList.toggle('sel',b.dataset.fngKind===kind));
 $('fngOfficial').href=stock?'https://www.cnn.com/markets/fear-and-greed':'https://alternative.me/crypto/fear-and-greed-index/';$('fngOfficial').textContent=(stock?'CNN':'Alternative.me')+' 공식 지표 ↗';
}
function clearFng(kind,message,loading=false){
 sentimentLabels(kind);$('fngValue').textContent=$('homeFng').textContent='—';$('fngLabel').textContent=$('homeFngLabel').textContent=loading?'불러오는 중…':'데이터 없음';$('homeGaugeValue').textContent=loading?'불러오는 중…':'데이터 없음';$('fngSource').textContent=$('homeFngSource').textContent=message;
 $('homeFngComparisons').replaceChildren();$('homeFngSummary').textContent=loading?'미국 주식과 암호화폐 지표를 구분해 제공합니다.':message;$('fngHistory').replaceChildren();$('fngHistoryDates').textContent='';$('fngMarker').style.display=$('homeGaugeMarker').style.display='none';
}
let fngToken=0;
async function loadFng(){
 const kind=state.fngKind,token=++fngToken;clearFng(kind,'제공원에서 시장 심리를 확인하는 중…',true);
 try{const d=await api('/api/fng?kind='+kind);if(token!==fngToken)return;const v=d.value==null?NaN:Number(d.value);if(!Number.isFinite(v)||v<0||v>100)throw Error('유효한 지표 데이터 없음');
 $('fngValue').textContent=$('homeFng').textContent=$('homeGaugeValue').textContent=number(v,0);$('fngLabel').textContent=$('homeFngLabel').textContent=d.classification;$('fngSource').textContent=$('homeFngSource').textContent=source(d);
 const labels={'Extreme Fear':'극단적 공포','Fear':'공포','Neutral':'중립','Greed':'탐욕','Extreme Greed':'극단적 탐욕'};$('homeFngSummary').textContent=(labels[d.classification]||d.classification)+' · '+(kind==='stock'?'미국 주식시장':'암호화폐 시장')+' 심리'+(d.stale?' · 이전 수집 데이터':'');$('homeFngComparisons').innerHTML=Object.entries({previous_close:'전일',previous_1_week:'1주 전',previous_1_month:'1개월 전'}).map(([key,label])=>`<span>${label}<b>${number(d.comparisons?.[key],0)}</b></span>`).join('');
 for(const id of ['fngMarker','homeGaugeMarker']){$(id).style.left=v+'%';$(id).style.display='block'}
 $('fngHistory').innerHTML=(d.history||[]).slice(-90).map(x=>`<span class="${x.value<40?'low':''}" style="height:${x.value}%" title="${escapeHtml(x.date)}: ${number(x.value,0)}"></span>`).join('');$('fngHistoryDates').textContent=d.history.length?d.history.slice(-90)[0].date+' → '+d.history.at(-1).date+' · 최근 90일':'';
 }catch(e){if(token===fngToken)clearFng(kind,e.message)}
}
const statusNames={scope_change:'범위 변경',new:'신규',increase:'추가',reduce:'감축',sold:'전량매도',unchanged:'유지'};
async function loadGurus(){notice($('guruCards'),'SEC 공시를 불러오는 중…');try{state.gurus=await api('/api/gurus');const d=state.gurus;$('guruCards').innerHTML=d.rows.map((x,i)=>`<button class="guru ${i===state.guruIndex?'sel':''}" data-guru="${i}"><b>${escapeHtml(x.name)}</b><span>${escapeHtml(x.person)}<br>${x.quarter||'데이터 없음'} · 공시 ${x.filed||'—'}</span><strong>${x.comparisonAvailable===false?'보고 범위 변경 · 비교 제외':x.counts?'신규 '+x.counts.new+' · 추가 '+x.counts.increase:escapeHtml(x.error)}</strong>${x.stale?'<small>이전 수집 데이터</small>':''}</button>`).join('');$('guruSource').textContent=d.notice+(d.mixedQuarters?' · 투자자별 보고 분기가 다릅니다.':'');renderGuru();const render=(rows,id)=>{const root=$(id);root.innerHTML=rows.map((x,i)=>`<button class="consensus-stock" data-consensus="${i}"><b>${escapeHtml(x.ticker||x.name)}</b><span>${x.held}명 보유 · ${x.increase}명 추가 · ${x.new}명 신규</span><small>${[...new Set(x.quarters)].join(' / ')}</small></button>`).join('');root.querySelectorAll('button').forEach(b=>b.onclick=()=>{const x=rows[+b.dataset.consensus];if(x.tv)openStock(x);else{$('searchInput').value=x.name;show('search');search()}})};render(d.consensus.slice(0,30),'consensus');render(d.consensus.filter(x=>x.new+x.increase>=2).slice(0,4),'homeStocks');if(!$('homeStocks').children.length)notice($('homeStocks'),'복수 투자자의 주식수 증가 신호가 없습니다.')}catch(e){notice($('guruCards'),e.message);notice($('homeStocks'),e.message)}}
function renderGuru(){const inv=state.gurus?.rows[state.guruIndex];if(!inv)return;$('guruTitle').textContent=inv.name;$('guruQuarter').innerHTML=inv.quarter?`분기말 ${inv.quarter} · 보고일 ${inv.filed} · 이전 ${inv.previousQuarter} · <a href="${escapeHtml(inv.sourceUrl)}" target="_blank" rel="noopener noreferrer">SEC 원문 ↗</a>`:escapeHtml(inv.error);if(inv.reportingNotice){$('guruQuarter').innerHTML+=`<br>보고 주체: ${escapeHtml(inv.reportingManager)} · <a href="${escapeHtml(inv.reportingNotice.sourceUrl)}" target="_blank" rel="noopener noreferrer">보고 주체 변경 공시 ↗</a>`}if(inv.filings?.some(x=>x.type!=='13F-HR')){$('guruQuarter').innerHTML+='<br>정정공시 반영: '+inv.filings.map(x=>`<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(x.type)} (${x.filed})</a>`).join(' · ')}if(inv.comparisonNote)$('guruQuarter').innerHTML+='<br>'+escapeHtml(inv.comparisonNote)+' · 이전 분기와 보고 범위가 달라 매수·매도 신호로 해석하지 않습니다.';const rows=inv.holdings.filter(x=>state.guruFilter==='all'||x.status===state.guruFilter);$('guruRows').innerHTML=rows.length?rows.map((x,i)=>`<tr data-holding="${i}" tabindex="0"><td>${escapeHtml(x.name)}<br><small>${escapeHtml(x.ticker||('CUSIP '+x.cusip))} · ${escapeHtml(x.class)}</small></td><td><span class="badge ${x.status}">${statusNames[x.status]}</span></td><td>${number(x.shares,0)}</td><td>${percent(x.shareChange)}</td><td>${number(x.weight)}%</td><td>${x.previousWeight==null?'비교 없음':number(x.previousWeight)+'% → '+number(x.weight)+'%<br>'+percent(x.weightChange)+'p'}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">해당 공시 내역 없음</td></tr>';$('guruRows').querySelectorAll('[data-holding]').forEach(b=>{const action=()=>{const x=rows[+b.dataset.holding];if(x.tv)openStock(x);else{$('searchInput').value=x.name;show('search');search()}};b.onclick=action;b.onkeydown=e=>{if(e.key==='Enter')action()}})}
async function loadTrump(){notice($('trumpData'),'공식 OGE 공시를 불러오는 중…');try{state.trump=await api('/api/trump');const d=state.trump;$('trumpCoverage').textContent=d.coverage+' · '+source(d)+' · 전체 거래는 아래 공식 PDF에서 확인 · 검증되지 않은 행은 목록에 포함하지 않습니다.';$('trumpReports').innerHTML=d.reports.map(r=>`<a class="report" href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener noreferrer"><b>공개일 ${r.publicDate}</b><span>${escapeHtml(r.type)} · 공식 PDF ↗</span></a>`).join('');$('trumpCatalogSource').textContent='OGE 공식 목록 · 확인 '+formatDate(d.catalogUpdated)+(d.catalogStale?' · 이전 수집 목록':'');renderTrump()}catch(e){notice($('trumpData'),e.message)}}
function renderTrump(){const rows=state.trump.rows.filter(x=>(state.trumpFilter==='all'||x.action===state.trumpFilter)&&(!state.trumpQuery||(x.name+' '+x.ticker).toLowerCase().includes(state.trumpQuery)));$('trumpCount').textContent=`검증된 ${state.trump.rows.length}건 중 ${rows.length}건 표시`;if(!rows.length){notice($('trumpData'),'조건에 맞는 공시 내역이 없습니다.');return}$('trumpData').innerHTML='<div class="table"><table><thead><tr><th>종목</th><th>구분</th><th>거래일</th><th>공개일</th><th>신고 금액 범위</th><th>공개 이후 주가</th><th>원문</th></tr></thead><tbody>'+rows.map((x,i)=>`<tr><td><button data-trump-stock="${i}">${escapeHtml(x.name)}<small> ${x.ticker}</small></button></td><td class="${x.action==='buy'?'up':'down'}">${x.action==='buy'?'매수':'매도'}</td><td>${x.tradeDate}</td><td>${x.publicDate}</td><td>${escapeHtml(x.amount)}</td><td><button data-performance="${i}">계산</button></td><td><a href="${escapeHtml(x.sourceUrl)}#page=${x.page}" target="_blank" rel="noopener noreferrer">p.${x.page} #${x.id} ↗</a></td></tr>`).join('')+'</tbody></table></div>';$('trumpData').querySelectorAll('[data-trump-stock]').forEach(b=>b.onclick=()=>openStock(rows[+b.dataset.trumpStock]));$('trumpData').querySelectorAll('[data-performance]').forEach(b=>b.onclick=async()=>{const x=rows[+b.dataset.performance];b.disabled=true;b.textContent='계산 중';try{const d=await api('/api/disclosure-performance?symbol='+encodeURIComponent(x.tv)+'&date='+x.publicDate);b.textContent=percent(d.change);b.title=`${d.baselineDate} 종가 ${number(d.baseline)} → ${d.latestDate} 종가 ${number(d.latest)} · ${d.source} · 배당 미포함`}catch(e){b.textContent='데이터 없음';b.title=e.message}finally{b.disabled=false}})}
function saveWatch(){syncLiveQuotes();try{localStorage.setItem('hongpick.watch.v1',JSON.stringify(state.watch))}catch{alert('브라우저 저장 공간에 접근할 수 없습니다.')}Object.values(charts).forEach(c=>c.renderControls());if(state.page==='watchlist')renderWatch()}
let watchToken=0;
async function renderWatch(){
 const token=++watchToken,root=$('watch');root.replaceChildren();if(!state.watch.length){notice(root,'종목 검색 또는 차트 아래 ☆ 버튼으로 관심종목을 저장하세요.');return}
 const isCoin=x=>x.type==='crypto'||/^(BINANCE|CRYPTO):/.test(x.tv),items=state.watch.filter(x=>isCoin(x)===(watchMarket==='coin'));if(!items.length){notice(root,watchMarket==='coin'?'저장한 코인이 없습니다. 코인 차트 아래 ☆ 버튼으로 저장하세요.':'저장한 주식이 없습니다. 주식 차트 아래 ☆ 버튼으로 저장하세요.');return}const ranks={},rankReady={},entries=items.map(item=>{const div=document.createElement('div');div.className='stock';div.dataset.watchTv=item.tv;div.innerHTML=`<button class="stock-name"><b>${escapeHtml(item.name||item.ticker||item.symbol)}</b><span>${escapeHtml(item.tv)}</span></button><div class="right">시세 확인 중…</div><button data-remove="${escapeHtml(item.tv)}" aria-label="관심종목 삭제">×</button>`;div.querySelector('.stock-name').onclick=()=>openStock(item);root.append(div);return{item,div,quote:null,error:null}});
 let guruReady=!!state.gurus;
 const paint=entry=>{if(token!==watchToken)return;const {item,div,quote:x,error}=entry;if(error){div.querySelector('.right').textContent=error;return}if(!x)return;if(isCoin(item)){div.querySelector('.right').innerHTML=`${number(x.price,10)} ${escapeHtml(x.currency)} · <span class="${x.change<0?'down':'up'}">24시간 ${percent(x.change)}</span><small>${item.tv.startsWith('BINANCE:')?'바이낸스 거래대금':'USD 종합 시세 · 바이낸스 순위'} ${x.rank?'TOP '+x.rank:'데이터 없음'}<br>${escapeHtml(source(x))}</small>`;return}const market=item.tv.startsWith('KRX:')?'kr':'us',signal=state.gurus?.consensus.find(y=>y.tv===item.tv);div.querySelector('.right').innerHTML=`${number(x.price)} ${x.currency} · <span class="${x.change<0?'down':'up'}">${percent(x.change)}</span><small>RSI ${number(x.rsi,1)} · 52주 고점 ${percent(x.drawdown)}<br>거래대금 ${ranks[item.tv]?'TOP '+ranks[item.tv]:rankReady[market]?'TOP50 밖/데이터 없음':'순위 확인 중…'}<br>${signal?signal.held+'명 보유 · 추가 '+signal.increase+' · 신규 '+signal.new:guruReady?'13F 보유 신호 없음/미확인':'13F 확인 중…'}<br>${escapeHtml(source(x))}</small>`};
 const enrichment=watchMarket==='coin'?Promise.resolve():Promise.all([
  ...['us','kr'].filter(m=>entries.some(x=>(x.item.tv.startsWith('KRX:')?'kr':'us')===m)).map(async m=>{try{const r=await api('/api/turnover?market='+m);r.rows.forEach(x=>ranks[x.tv]=x.rank)}catch{}finally{rankReady[m]=true;entries.forEach(paint)}}),
  (async()=>{if(!state.gurus)try{state.gurus=await api('/api/gurus')}catch{}guruReady=true;entries.forEach(paint)})()
 ]);
 let cursor=0;await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{while(cursor<entries.length){const entry=entries[cursor++];try{entry.quote=await api('/api/stock?symbol='+encodeURIComponent(entry.item.tv))}catch(e){entry.error=e.message}paint(entry)}}));await enrichment;
}
document.addEventListener('click',e=>{const wm=e.target.closest('[data-watch-market]');if(wm){watchMarket=wm.dataset.watchMarket;syncLiveQuotes();document.querySelectorAll('[data-watch-market]').forEach(b=>b.classList.toggle('sel',b===wm));renderWatch()}const go=e.target.closest('[data-go]');if(go)show(go.dataset.go);const market=e.target.closest('[data-market]');if(market){state.market=market.dataset.market;document.querySelectorAll('[data-market]').forEach(b=>b.classList.toggle('sel',b===market));loadTurnover()}const filter=e.target.closest('[data-filter]');if(filter){const f=filter.dataset.filter;if(f==='all')state.filters.clear();else{if(f.startsWith('rsi'))for(const v of [...state.filters])if(v.startsWith('rsi'))state.filters.delete(v);if(f.startsWith('dd'))for(const v of [...state.filters])if(v.startsWith('dd'))state.filters.delete(v);filter.classList.contains('sel')?state.filters.delete(f):state.filters.add(f)}document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('sel',b.dataset.filter==='all'?state.filters.size===0:state.filters.has(b.dataset.filter)));renderRows()}const rank=e.target.closest('[data-rank]');if(rank){state.rank=+rank.dataset.rank;document.querySelectorAll('[data-rank]').forEach(b=>b.classList.toggle('sel',b===rank));renderRows()}for(const [attr,id,key]of[['data-search-size','searchChart','search'],['data-size','chart','turn'],['data-coin-size','coinChart','coins']]){const size=e.target.closest('['+attr+']');if(size){size.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('sel',b===size));$(id).className='chart '+size.getAttribute(attr);charts[key]?.resize()}}const hint=e.target.closest('[data-symbol]');if(hint){$('searchInput').value=hint.dataset.name||hint.dataset.symbol;show('search');search()}const add=e.target.closest('[data-watch]');if(add){const item=[state.search,state.current,coinSelected].find(x=>x?.tv===add.dataset.watch);if(item){state.watch=state.watch.some(x=>x.tv===item.tv)?state.watch.filter(x=>x.tv!==item.tv):[...state.watch,item];saveWatch()}}const remove=e.target.closest('[data-remove]');if(remove){state.watch=state.watch.filter(x=>x.tv!==remove.dataset.remove);saveWatch()}const guru=e.target.closest('[data-guru]');if(guru){state.guruIndex=+guru.dataset.guru;document.querySelectorAll('[data-guru]').forEach(b=>b.classList.toggle('sel',b===guru));renderGuru()}const gf=e.target.closest('[data-guru-filter]');if(gf){state.guruFilter=gf.dataset.guruFilter;document.querySelectorAll('[data-guru-filter]').forEach(b=>b.classList.toggle('sel',b===gf));renderGuru()}const tf=e.target.closest('[data-trump-filter]');if(tf){state.trumpFilter=tf.dataset.trumpFilter;document.querySelectorAll('[data-trump-filter]').forEach(b=>b.classList.toggle('sel',b===tf));if(state.trump)renderTrump()}const kind=e.target.closest('[data-fng-kind]');if(kind){state.fngKind=kind.dataset.fngKind;try{localStorage.setItem('hongpick.fng.kind',state.fngKind)}catch{}loadFng()}});
$('trumpSearch').oninput=e=>{state.trumpQuery=e.target.value.trim().toLowerCase();if(state.trump)renderTrump()};
$('coinSearchBtn').onclick=searchCoins;$('coinSearchInput').onkeydown=e=>{if(e.key==='Enter')searchCoins()};$('coinLimit').onchange=renderCoins;
$('searchBtn').onclick=search;$('searchInput').onkeydown=e=>{if(e.key==='Enter')search()};$('refresh').onclick=()=>{HongData.clear();if(state.page==='coins'){loadCoins();if(coinSelected)openCoin(coinSelected)}else if(state.page==='hongpicks')loadPicks();else if(state.page==='codexpicks')loadCodexPicks();else if(state.page==='turnover')loadTurnover();else if(state.page==='gurus')loadGurus();else if(state.page==='trump')loadTrump();else if(state.page==='search'&&state.search)renderChart(state.search,'search');else if(state.page==='watchlist')renderWatch();else{loadOverview();loadFng();if(state.page==='home'){loadGurus();loadPicks();loadCodexPicks()}}};
$('status').textContent=HongData.staticMode?'● 주기 수집 · 실제 데이터':'● 공개 제공원 · 지연 시세';if(HongData.staticMode){$('dataMode').hidden=false;$('apiFallback').checked=HongData.fallback;$('apiFallback').onchange=e=>{HongData.setFallback(e.target.checked);$('dataModeStatus').textContent=HongData.fallback?'· API 보완 켜짐':'· Render 요청 없음'};$('dataModeStatus').textContent=HongData.fallback?'· API 보완 켜짐':'· Render 요청 없음'}const initial=location.hash.slice(1);show(pages.includes(initial)?initial:'home',false,true);setInterval(()=>{if(document.hidden)return;if(state.page==='coins')loadCoins();if(state.page==='turnover')loadTurnover();if(state.page==='watchlist')renderWatch();if(state.page==='home'){loadOverview();loadPicks();loadCodexPicks()}if(state.page==='hongpicks')loadPicks();if(state.page==='codexpicks')loadCodexPicks();if(state.page==='search'&&state.search)loadDetails(state.search)},HongData.staticMode?300000:90000);setInterval(()=>{if(!document.hidden&&['home','fng'].includes(state.page))loadFng()},1800000);setInterval(()=>{if(!document.hidden&&state.page==='gurus')loadGurus()},21600000);setInterval(()=>{if(!document.hidden&&state.page==='trump')loadTrump()},3600000);




async function loadPicks(){
 if(picksPending)return picksPending;
 picksPending=(async()=>{try{picksData=await api('/api/hongpicks');renderPicks()}catch(error){for(const id of ['picksList','homePicks','homeEntries'])notice($(id),error.message);for(const id of ['picksSource','homePicksSource'])$(id).textContent='추천 데이터 없음 · 다른 메뉴는 계속 사용할 수 있습니다.';if(chartPicksKind==='hong'){notice($('chartPicksList'),error.message);$('chartPicksSource').textContent='TOP10 데이터 없음'}}finally{picksPending=null}})();return picksPending;
}
async function loadCodexPicks(){
 if(codexPending)return codexPending;
 codexPending=(async()=>{try{codexData=await api('/api/codexpicks');renderCodexPicks()}catch(e){for(const id of ['codexList','homeCodex'])notice($(id),e.message);$('codexSource').textContent='선별 데이터 없음 · 다음 수집에서 다시 시도합니다.';if(chartPicksKind==='codex'){notice($('chartPicksList'),e.message);$('chartPicksSource').textContent='TOP10 데이터 없음'}}finally{codexPending=null}})();return codexPending;
}
function loadChartPicks(){renderChartPicks();return chartPicksKind==='hong'?loadPicks():loadCodexPicks()}
function renderChartPicks(){
 const data=chartPicksKind==='hong'?picksData:codexData,rows=(data?.rows||[]).slice(0,10);
 $('chartPicksTitle').textContent=(chartPicksKind==='hong'?'홍픽종목':'Codex 픽')+' TOP10';
 document.querySelectorAll('[data-chart-picks]').forEach(b=>b.classList.toggle('sel',b.dataset.chartPicks===chartPicksKind));
 $('chartPicksList').innerHTML=rows.length?rows.map((x,i)=>chartPicksKind==='hong'?pickRow(x,i,true):codexRow(x,i,true)).join(''):'<div class="empty">'+(data?'현재 표시할 픽 종목이 없습니다.':'TOP10을 불러오는 중…')+'</div>';
 $('chartPicksSource').textContent=data?source(data)+' · 전체 순위 TOP10 · 종목을 누르면 위 차트가 변경됩니다.':'선택한 픽 목록을 불러오는 중…';
 $('chartPicksList').querySelectorAll('[data-pick-tv],[data-codex-tv]').forEach(b=>{const tv=b.dataset.pickTv||b.dataset.codexTv,item=rows.find(x=>x.tv===tv),current=state.search?.tv===tv;b.classList.toggle('current-pick',current);if(current)b.setAttribute('aria-current','true');b.onclick=()=>{if(current)return;chartPicksKind==='hong'?openPick(item):openCodexPick(item)}});
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-chart-picks]');if(b){chartPicksKind=b.dataset.chartPicks;loadChartPicks()}});
function codexRow(x,index,compact=false){
 const signals=codexStrategy==='all'||compact?x.signals:x.signals.filter(s=>s.key===codexStrategy),best=[...signals].sort((a,b)=>b.score-a.score)[0],score=best.score,stars=score>=90?5:score>=75?4:score>=60?3:2;
 return `<article class="codex-card"><button class="pick-row ${compact?'compact':''}" data-codex-tv="${escapeHtml(x.tv)}"><span class="pick-rank">${index+1}</span><span class="pick-info"><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.ticker)} · ${x.market==='kr'?'한국':'미국'} · ${number(x.price)} ${escapeHtml(x.currency||'')} · ${escapeHtml(x.sessionDate)} 종가</small><span class="pick-signals">${signals.map(s=>'<span class="met">'+escapeHtml(s.name)+'</span>').join('')}</span><small>${escapeHtml(best.reasons.join(' · '))}</small></span><span class="pick-rating"><span class="pick-stars" aria-label="조건 강도 ${stars}개 / 5개">${'★'.repeat(stars)+'☆'.repeat(5-stars)}</span><small>${score} / 100</small><small>차트 보기 →</small></span></button>${compact?'':`<details class="codex-evidence"><summary>선정 근거 · 조건 해제 기준 · 데이터</summary>${signals.map(s=>`<p><b>${escapeHtml(s.name)} · ${s.score}점</b><br>${escapeHtml(s.thesis||'')}<br>${s.reasons.map(escapeHtml).join('<br>')}<br><span class="data-source">${escapeHtml(s.invalidation)}</span><br><a href="${escapeHtml(s.url||'')}" target="_blank" rel="noopener">${escapeHtml(s.author||'기법 설명')}</a><br>${escapeHtml(s.applied||'')}<br><span class="data-source">미검증: ${escapeHtml(s.unverified||'')}</span></p>`).join('')}${x.channelContext?`<p class="codex-channel-note">주봉 빗각 참고 · 선별 가점 없음<br>${escapeHtml(x.channelContext.state==='resistance'?'종가 위 저항 후보에 접근 중입니다. 아래에서 접촉하는 것만으로 매수 근거가 되지 않습니다. 돌파와 지지 확인은 별도 검증이 필요합니다.':x.channelContext.state==='supportCandidate'?'종가 아래 지지 후보가 있습니다. 가까이 있다는 사실만으로 실제 지지 반등이 확인되지는 않습니다.':'가까운 채널 접촉 조건이 없습니다.')}<br>레벨 ${x.channelContext.ratio} · ${number(x.channelContext.line)} ${escapeHtml(x.currency||'')} · 종가와 ${number(x.channelContext.distance)}%</p>`:''}<p class="data-source">${escapeHtml(x.dailySource)} · 수집 ${formatDate(x.dailyUpdated)}${x.weeklySource?'<br>'+escapeHtml(x.weeklySource)+' · 주봉 수집 '+formatDate(x.weeklyUpdated):''}${x.missing?.length?'<br>미확인 항목: '+x.missing.map(escapeHtml).join(' · '):''}</p></details>`}</article>`;
}
function renderCodexPicks(){
 if(!codexData)return;
 const all=codexData.rows||[],filtered=all.filter(x=>(codexMarket==='all'||x.market===codexMarket)&&(codexStrategy==='all'||x.signals.some(s=>s.key===codexStrategy)));
 const score=x=>codexStrategy==='all'?x.score:x.signals.find(s=>s.key===codexStrategy).score;
 filtered.sort((a,b)=>score(b)-score(a)||b.signals.length-a.signals.length||a.tv.localeCompare(b.tv));const rows=filtered.slice(0,50);
 $('codexCount').textContent=`${rows.length}개 표시 · ${codexData.analyzedCount}/${codexData.candidateCount}개 분석 · 통과 ${all.length}개`;
 $('codexList').innerHTML=rows.length?rows.map((x,i)=>codexRow(x,i)).join(''):'<div class="empty">현재 선택한 조건을 통과한 종목이 없습니다. 조건이 충족되면 자동으로 표시됩니다.</div>';
 $('homeCodex').innerHTML=all.length?all.slice(0,5).map((x,i)=>codexRow(x,i,true)).join(''):'<div class="empty">현재 선별 조건을 통과한 종목이 없습니다.</div>';
 for(const id of ['codexSource','homeCodexSource'])$(id).textContent=source(codexData)+' · 완료 일봉 기준 · 약 30분마다 계산 · 규칙 '+codexData.ruleVersion;
 $('codexExcluded').innerHTML=(codexData.excluded||[]).map(x=>'<p>'+escapeHtml(x.tv)+' · '+escapeHtml(x.reason)+'</p>').join('')||'<p>제외 종목 없음</p>';
 document.querySelectorAll('[data-codex-tv]').forEach(b=>b.onclick=()=>openCodexPick(all.find(x=>x.tv===b.dataset.codexTv)));
 if(chartPicksKind==='codex')renderChartPicks();
}
async function openCodexPick(item){
 chartPicksKind='codex';
 if(!item)return;try{await ensureCharts();if(!charts.search)charts.search=new HongChart($('searchChart'),$('searchIndicators'));const chart=charts.search;chart.options.ma=new Set([20,60,200]);chart.options.rsi=true;chart.options.fib='off';chart.options.fibFrame='W';chart.channelSelection=null;chart.interval='D';openStock(item)}catch{openStock(item)}
}
for(const [id,key]of [['codexMarket','market'],['codexStrategy','strategy']])$(id).onchange=e=>{if(key==='market')codexMarket=e.target.value;else codexStrategy=e.target.value;renderCodexPicks()};
function entryLabel(e){return !e?'빗각 매매자리 없음':({confirmed:'지지 반등 확인',approach:'지지 접근 · 관찰',late:'반등 후 이격 · 저항 주의',broken:'지지 이탈'}[e.status])+(e.provisional?' · ③ 잠정':'')}
function isDailyOversold(x){return Number.isFinite(x.rsi)&&x.rsi<=30}
function entrySparkline(entry){
 const candles=(entry.reference||[]).slice(-48),prices=candles.map(x=>x.close).filter(Number.isFinite);if(prices.length<2)return '';
 const lo=Math.min(...prices),hi=Math.max(...prices),span=hi-lo||1,pts=prices.map((x,i)=>`${(i/(prices.length-1)*280+4).toFixed(1)},${(66-(x-lo)/span*56).toFixed(1)}`).join(' ');
 return `<span class="entry-spark"><svg viewBox="0 0 288 76" role="img" aria-label="실제 수집 ${entry.frame==='W'?'주봉':'일봉'} 종가 추이"><polyline points="${pts}"/></svg><small>${entry.frame==='W'?'주봉':'일봉'} 종가 추이 · 실제 수집</small></span>`;
}
function pickRow(x,index,compact=false){
 const stars='★'.repeat(x.stars)+'☆'.repeat(5-x.stars),week=x.weekly,entry=x.entry;
 const badges=[`<span class="${entry?.active?'met':''}">${escapeHtml(entryLabel(entry))}${entry?' · '+(entry.frame==='W'?'주봉':'일봉')+' '+number(entry.distance,1)+'%':''}</span>`,`<span class="${isDailyOversold(x)?'met':''}">일봉 RSI ${number(x.rsi,1)}${isDailyOversold(x)?' · 과매도':''}</span>`,`<span class="${entry?.active?'met':''}">${entry?'매매자리 지지선 '+number(entry.line)+' '+escapeHtml(x.currency||''):week?'주봉 지지 후보 '+number(week.distance,1)+'%':'주봉 지지 후보 없음'}</span>`,`<span class="${x.golden?.matched?'met':''}">${x.golden?.matched?'골든크로스 '+x.golden.date:x.golden?'골든크로스 없음':'MA 데이터 없음'}</span>`,`<span class="${x.rally>=10?'met':''}">본장 ${percent(x.rally)}</span>`];
 return `<button class="pick-row ${compact?'compact':''} ${compact&&entry?.active?'entry-card':''}" data-pick-tv="${escapeHtml(x.tv)}"><span class="pick-rank">${index+1}</span><span class="pick-info"><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.ticker)} · ${x.market==='kr'?'한국':'미국'} · ${number(x.price)} ${escapeHtml(x.currency||'')}</small><span class="pick-signals">${badges.join('')}</span>${compact&&entry?.active?entrySparkline(entry):''}${compact?'':`<small>본장 기준 ${escapeHtml(x.sessionDate)}${x.stale?' · 이전 수집 데이터':''}${entry?' · 접촉 '+(entry.touchDate||'대기')+' · 반등 확인 '+(entry.confirmationDate||'대기')+' · 위 저항 여유 '+(entry.headroom==null?'미확인':number(entry.headroom,1)+'%'):''}${entry?' · '+(entry.mode==='high'?'고–고–고':'저–저–저')+' '+(entry.frame==='W'?'주봉':'일봉')+' 레벨 '+entry.ratio+' · '+number(entry.line)+' '+escapeHtml(x.currency||''):week?' · '+(week.mode==='high'?'고–고–고':'저–저–저')+' 레벨 '+week.ratio+' · '+number(week.line)+' '+escapeHtml(x.currency||''):''}</small>`}</span><span class="pick-rating"><span class="pick-stars" aria-label="추천 별 ${x.stars}개 / 5개">${stars}</span><small>${number(x.score)} / 100</small>${x.score===0?'<small>신호 없음</small>':''}</span></button>`;
}
function renderPicks(){
 if(!picksData)return;const all=picksData.rows||[],rows=all.filter(x=>(picksMarket==='all'||x.market===picksMarket)&&(!picksOversold||isDailyOversold(x))&&(!picksEntryOnly||x.entry?.active)).sort((a,b)=>picksEntryOnly?(({confirmed:0,approach:1}[a.entry.status])-({confirmed:0,approach:1}[b.entry.status])||b.points.weekly-a.points.weekly||b.score-a.score):b.score-a.score).slice(0,50);
 $('picksTitle').textContent=(picksMarket==='all'?'전체':picksMarket==='us'?'미국':'한국')+' 홍픽종목 TOP50';$('picksCount').textContent=`${rows.length}개 표시${picksEntryOnly?' · 빗각 매매자리':''}${picksOversold?' · 일봉 RSI(14) ≤30 과매도':''} · ${all.length}/${picksData.candidateCount}개 분석`;
 $('picksList').innerHTML=rows.length?rows.map((x,i)=>pickRow(x,i)).join(''):'<div class="empty">'+(all.length&&picksEntryOnly?'현재 선택한 조건에서 지지 접근·최근 반등 확인 종목이 없습니다.':all.length&&picksOversold?'선택한 시장에서 일봉 과매도 조건을 충족하는 종목이 없습니다.':'분석 가능한 실제 데이터가 없습니다.')+'</div>'; 
 const entries=all.filter(x=>x.entry?.active).sort((a,b)=>({confirmed:0,approach:1}[a.entry.status])-({confirmed:0,approach:1}[b.entry.status])||b.points.weekly-a.points.weekly);$('homeEntries').innerHTML=entries.length?entries.slice(0,5).map((x,i)=>pickRow(x,i,true)).join(''):'<div class="empty">현재 지지 접근·최근 반등 확인 조건을 통과한 종목이 없습니다.</div>';
 $('homeEntryCount').textContent=`지지 접근 ${entries.filter(x=>x.entry.status==='approach').length} · 반등 확인 ${entries.filter(x=>x.entry.status==='confirmed').length}`;
 $('homePicks').innerHTML=all.length?all.slice(0,10).map((x,i)=>pickRow(x,i,true)).join(''):'<div class="empty">분석 가능한 실제 데이터가 없습니다.</div>';
 for(const id of ['picksSource','homePicksSource'])$(id).textContent=source(picksData)+' · 일봉 종가 기준 · 약 30분마다 수집'+(picksData.failures?.length?' · '+picksData.failures.length+'개 종목 일봉 데이터 없음':'');
 document.querySelectorAll('[data-pick-tv]').forEach(b=>b.onclick=()=>openPick(all.find(x=>x.tv===b.dataset.pickTv)));
 if(chartPicksKind==='hong')renderChartPicks();
}
async function openPick(item){
 chartPicksKind='hong';
 if(!item)return;try{await ensureCharts();if(!charts.search)charts.search=new HongChart($('searchChart'),$('searchIndicators'));const chart=charts.search,e=item.entry;chart.options.fib=e?.active?e.mode:item.weekly?.mode||'off';chart.options.fibFrame=e?.active?e.frame:'W';chart.channelSelection=e?.active?{key:item.tv+':'+e.mode+':'+e.frame,frame:e.frame,reference:{candles:e.reference,source:e.referenceSource,updated:e.referenceUpdated,lastBar:e.reference.at(-1).time,interval:e.frame},candidate:e.candidate,reason:'매매자리 탐지 기준 고정 · '+entryLabel(e)}:null;chart.interval=e?.active?'D':'W';chart.options.rsi=true;openStock(item)}catch(error){openStock(item)}
}
document.addEventListener('click',e=>{const button=e.target.closest('[data-pick-market]');if(button){picksMarket=button.dataset.pickMarket;document.querySelectorAll('[data-pick-market]').forEach(b=>b.classList.toggle('sel',b===button));renderPicks()}});


document.querySelector('.brand').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show('home')}});


setInterval(()=>{if(document.hidden||document.querySelector('.modal-back'))return;for(const c of Object.values(charts)){const bucket=Math.floor(Date.now()/(parseInt(c.options.fibFrame)*60000||900000));if(['5m','15m'].includes(c.options.fibFrame)&&!c.expandedTool&&c.options.fib!=='off'&&(c.fullscreenState||c.element.closest('.page.active'))&&c.lastScalpRefreshBucket!==bucket){c.lastScalpRefreshBucket=bucket;c.refreshScalp()}}},60000);

$('picksEntryOnly').onchange=e=>{picksEntryOnly=e.target.checked;renderPicks()};document.addEventListener('click',e=>{if(e.target.closest('[data-show-entries]')){picksEntryOnly=true;$('picksEntryOnly').checked=true;show('hongpicks');renderPicks()}});
$('picksOversold').onchange=e=>{picksOversold=e.target.checked;renderPicks()};

function liveCoinRow(row){const quote=liveQuotes.get(row.ticker||row.tv?.split(':')[1]);return quote&&coinLiveState.startsWith('실시간')&&Date.now()-quote.receivedAt<20000?{...row,...quote}: {...row,live:false}}
function coinChartVisible(){const panel=$('coinChartPanel');if(panel.hidden)return false;if(charts.coins?.fullscreenState)return true;const r=panel.getBoundingClientRect();return r.top<window.innerHeight&&r.bottom>100}
function paintLiveCoins(){
 if(state.page==='coins'){
  if(coinData&&!coinChartVisible())renderCoins();const quote=coinSelected&&liveCoinRow(coinSelected);
  if(quote?.live){$('coinChartSub').textContent=number(quote.price,10)+' USDT · 24시간 '+percent(quote.change)+' · 실시간';$('coinQuoteSource').textContent='Binance Spot WebSocket · 마지막 수신 '+formatDate(quote.updated)+' · 24시간 체결대금 '+number(quote.turnover/1e6,2)+'M USDT'}
  else if(coinSelected)$('coinQuoteSource').textContent='Binance Spot · '+coinLiveState+' · 이전 시세 유지';
 }
 if(state.page==='home'){
  const quote=liveCoinRow({ticker:'BTCUSDT'}),cached=liveQuotes.get('BTCUSDT'),card=document.querySelectorAll('.markets article')[2];
  card.querySelector('span').textContent=cached?'BTC / USDT · '+(quote.live?'실시간':coinLiveState):'BTC / USD · 수집본';
  if(cached){card.querySelector('b').textContent=number(cached.price);card.querySelector('em').textContent='24h '+percent(cached.change);card.querySelector('em').classList.toggle('down',cached.change<0);card.title='Binance Spot WebSocket · '+formatDate(cached.updated)}
  $('homeBtcSource').textContent=cached?'Binance · 마지막 수신 '+formatDate(cached.updated):'Yahoo Finance · 수집 '+formatDate(overviewBtc?.updated)+' · '+coinLiveState;
 }
 if(state.page==='watchlist'&&watchMarket==='coin')for(const div of $('watch').querySelectorAll('[data-watch-tv]')){
  const quote=liveCoinRow({tv:div.dataset.watchTv});if(quote.live)div.querySelector('.right').innerHTML=number(quote.price,10)+' USDT · <span class="'+(quote.change<0?'down':'up')+'">24시간 '+percent(quote.change)+'</span><small>실시간 · Binance Spot WebSocket<br>마지막 수신 '+formatDate(quote.updated)+'</small>';else {div.querySelector('.stream-state')?.remove();const mark=document.createElement('small');mark.className='stream-state';mark.textContent=coinLiveState;div.querySelector('.right').append(mark)}
 }
}
function syncLiveQuotes(){
 if(!window.HongLive)return;
 const streams=state.page==='coins'?['!miniTicker@arr']:state.page==='home'?['btcusdt@ticker']:state.page==='watchlist'&&watchMarket==='coin'?state.watch.filter(x=>x.tv.startsWith('BINANCE:')).map(x=>x.tv.split(':')[1].toLowerCase()+'@ticker'):[];
 const key=streams.join('/');if(key===coinLiveKey)return;coinLiveClient?.close();coinLiveClient=null;coinLiveKey=key;clearTimeout(livePaintTimer);livePaintTimer=null;
 if(!key){coinLiveState='일시정지';return}
 coinLiveClient=HongLive.subscribe(streams,data=>{
  let accepted=false;for(const x of Array.isArray(data)?data:[data]){const quote=HongLive.ticker(x);if(quote){liveQuotes.set(quote.ticker,quote);accepted=true}}
  if(accepted){coinLiveState='실시간 수신';if(!livePaintTimer)livePaintTimer=setTimeout(()=>{livePaintTimer=null;paintLiveCoins()},1000)}
 },status=>{if(status.mode!=='receiving'){coinLiveState={connecting:'연결 중',reconnecting:'재연결 중 · 수집본/이전 시세',paused:'일시정지 · 이전 시세'}[status.mode]||'수집본';paintLiveCoins()}});
}
