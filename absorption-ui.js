/* Hong Pick low-area volume/price explorer. It never accesses private accounts. */
(()=>{
 pages.push('absorption');
 let data=null,pending=null,market='all',lastLoad=0;
 const $abs=id=>document.getElementById(id),safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function openChart(item){if(charts.search)charts.search.interval='D';openStock(item);}
 const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
 const signed=v=>(v>0?'+':'')+fmt(v)+'%';
 function showExample(){
  const root=$abs('absExample'),x=data?.example;
  if(!x){root.innerHTML='<div class="empty">SOXL 과거 주봉 자료가 없어 현재 사례를 표시할 수 없습니다.</div>';return;}
  const e=x.event;root.innerHTML=`<article class="absorption-card"><button class="absorption-main" id="absExampleOpen"><span class="absorption-body"><span class="absorption-title"><b>SOXL · 2025년 4월 둘째 주</b><span class="absorption-state">과거 사례</span></span><small class="absorption-meta">주봉 기준 ${safe(e.date)} · 과거 자료를 현재 기준으로 재확인</small></span><span class="absorption-score">${fmt(e.score,0)}점<small>차트에서 보기 →</small></span></button><div class="absorption-metrics"><span>거래량 ${fmt(e.volumeRatio)}배</span><span>주봉 저가 ${fmt(e.low)} USD</span><span>주봉 종가 ${fmt(e.close)} USD</span></div><p class="absorption-detail">기준: 직전 20주 평균 거래량 · 주봉 완료 후 탐지 가능 · 점수는 수익 확률이나 세력 매집 확인이 아닙니다.</p></article>`;
  $abs('absExampleOpen').onclick=()=>openChart({...x,market:'us',absorptionEvent:e});
 }
 function showRows(){
  if(!data)return;showExample();const root=$abs('absList'),rows=(data.rows||[]).filter(x=>market==='all'||x.market===market);
  $abs('absCount').textContent=`후보 ${rows.length}개 · 분석 ${data.analyzedCount}/${data.candidateCount}개`;
  const skipped=(data.failures||[]).length;$abs('absSource').textContent=`${data.source||'주봉 데이터'} · 계산 ${formatDate(data.generatedAt)} · 자료 미확인 ${skipped}개 · 완료 주봉 기준`;
  if(!data.analyzedCount){root.innerHTML='<div class="empty">분석 가능한 주봉 데이터가 없습니다. 다음 수집에서 다시 확인합니다.</div>';return;}
  if(!rows.length){root.innerHTML='<div class="empty">현재 조건에 맞는 후보가 없습니다. 조건 완화 없이 다음 완료 주봉을 기다립니다.</div>';return;}
  root.innerHTML='<div class="absorption-notice">가격·거래량 패턴으로 찾은 관찰 후보입니다. 실제 세력 매집 여부와 수익 확률은 확인할 수 없습니다.</div>'+rows.map((x,i)=>{const e=x.event,dis=e.lowDistancePct<=0?'직전 52주 신저가':'직전 52주 저점 +'+fmt(e.lowDistancePct)+'%';return `<article class="absorption-card"><button class="absorption-main" data-abs-index="${i}"><span class="absorption-rank">${i+1}</span><span class="absorption-body"><span class="absorption-title"><b>${safe(x.name||x.ticker)}</b><span class="absorption-state ${x.state==='저점 이탈 이력'?'broken':''}">${safe(x.state)}</span></span><small class="absorption-meta">${safe(x.ticker)} · ${x.market==='kr'?'한국':'미국'} · ${x.type==='fund'?'ETF':'주식'} · 주봉 기준 ${safe(e.date)}</small></span><span class="absorption-score">${fmt(x.score,0)}점<small>조건 점수 · 차트 보기 →</small></span></button><div class="absorption-metrics"><span>거래량 ${fmt(e.volumeRatio)}배</span><span>고점 대비 −${fmt(e.declinePct)}%</span><span>종가 위치 ${fmt(e.closePosition*100,0)}%</span></div><details class="absorption-detail"><summary>점수 근거와 가격 보기</summary><p>${safe(dis)} · 주봉 거래량 ${fmt(e.volume,0)} / 직전 20주 평균 ${fmt(e.averageVolume,0)}<br>신호 봉 저가 ${fmt(e.low)} · 고가 ${fmt(e.high)} · 종가 ${fmt(e.close)} ${safe(x.currency||'')}<br>봉 시가 대비 ${signed(e.bodyReturn)} · 전주 종가 대비 ${signed(e.prevReturn)} · 최근 완료 주봉 종가 ${fmt(x.price)} (${safe(x.priceDate)})<br>출처 ${safe(x.priceSource)} · 수집 ${safe(formatDate(x.updated))}</p></details></article>`;}).join('');
  root.querySelectorAll('[data-abs-index]').forEach(button=>button.onclick=()=>{const row=rows[+button.dataset.absIndex];openChart({...row,absorptionEvent:row.event});});
 }
 async function load(force=false){
  if(pending)return pending;if(data&&!force&&Date.now()-lastLoad<90000){showRows();return;}
  pending=(async()=>{try{data=await api('/api/absorption');if(!Array.isArray(data.rows))throw Error('후보 데이터 형식 오류');lastLoad=Date.now();showRows();}catch(e){data=null;notice($abs('absList'),e.message||'탐색 데이터를 불러오지 못했습니다.');$abs('absCount').textContent='';$abs('absSource').textContent='데이터 없음 · 다음 수집에서 다시 확인합니다.';notice($abs('absExample'),'과거 주봉 데이터를 불러오지 못했습니다.');}finally{pending=null;}})();return pending;
 }
 document.querySelectorAll('[data-abs-market]').forEach(button=>button.onclick=()=>{market=button.dataset.absMarket;document.querySelectorAll('[data-abs-market]').forEach(b=>b.classList.toggle('sel',b===button));showRows();});
 const page=$abs('absorption');new MutationObserver(()=>{if(page.classList.contains('active'))load();}).observe(page,{attributes:true,attributeFilter:['class']});
 $abs('refresh').addEventListener('click',()=>{if(page.classList.contains('active')){HongData.clear();load(true);}});
 setInterval(()=>{if(!document.hidden&&page.classList.contains('active'))load(true);},300000);
 if(location.hash==='#absorption')show('absorption',false,true);
})();
