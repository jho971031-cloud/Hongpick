/* Horizontal support/resistance candidates and local manual drawings. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.HongLevels=api;api.install(root.HongChart)}})(typeof window==='object'?window:globalThis,()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function normalize(value){const s=value&&typeof value==='object'?value:{};return {show:s.show!==false,auto:s.auto===true,frame:s.frame==='W'?'W':'D',manual:(Array.isArray(s.manual)?s.manual:[]).filter(x=>x&&Number.isFinite(x.price)&&x.price>0&&x.price<1e15).slice(0,30).map((x,i)=>({id:String(x.id||i).slice(0,70),price:x.price,kind:['support','resistance'].includes(x.kind)?x.kind:'reference',label:String(x.label||'').slice(0,18)}))}}
 function read(tv,storage){try{return normalize(JSON.parse((storage||localStorage).getItem('hongpick.levels.v1.'+tv)||'{}'))}catch{return normalize(null)}}
 function save(tv,state,storage){try{(storage||localStorage).setItem('hongpick.levels.v1.'+tv,JSON.stringify(normalize(state)));return true}catch{return false}}
 function detect(candles,price){
  const rows=(candles||[]).slice(-500);if(rows.length<30||!(price>0)||rows.some(x=>!['open','high','low','close'].every(k=>Number.isFinite(x[k])&&x[k]>0)||x.high<Math.max(x.open,x.close,x.low)||x.low>Math.min(x.open,x.close)))return [];
  const ranges=rows.slice(-15).slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-rows[rows.length-15+i]?.close||0),Math.abs(c.low-rows[rows.length-15+i]?.close||0)));
  const atr=ranges.reduce((a,b)=>a+b,0)/ranges.length,tolerance=Math.min(price*.03,Math.max(price*.003,atr*.4)),points=[];
  for(let i=3;i<rows.length-3;i++)for(const kind of ['high','low']){const value=rows[i][kind],near=rows.slice(i-3,i+4).map(c=>c[kind]);if((kind==='high'?value===Math.max(...near)&&near.some(x=>x<value):value===Math.min(...near)&&near.some(x=>x>value)))points.push({price:value,index:i,time:rows[i].time})}
  const groups=[];
  for(const p of points){let g=groups.find(g=>Math.abs(g.price-p.price)<=tolerance);if(!g){groups.push({price:p.price,touches:[p]});continue}if(g.touches.some(x=>Math.abs(x.index-p.index)<4))continue;g.touches.push(p);g.price=g.touches.reduce((a,b)=>a+b.price,0)/g.touches.length}
  const valid=groups.filter(g=>g.touches.length>=2&&Math.abs(g.price/price-1)<=.4).map(g=>({price:g.price,count:g.touches.length,lastTime:g.touches.at(-1).time,kind:g.price<=price?'support':'resistance',distance:Math.abs(g.price/price-1)*100}));
  const pick=kind=>valid.filter(x=>x.kind===kind).sort((a,b)=>a.distance-b.distance||b.count-a.count).slice(0,3);
  return [...pick('support'),...pick('resistance')];
 }
 function install(Chart){
  if(!Chart)return;
  Object.assign(Chart.prototype,{
   toggleLevels(){this.expandedTool=this.expandedTool==='sr'?null:'sr';this.panelDraft=null;this.srPicker=false;this.element.classList.remove('sr-drawing');this.renderControls()},
   persistLevels(){this.srMessage=save(this.item.tv,this.srState)?'이 브라우저·사이트에 저장됨':'저장 공간 접근 불가 · 현재 화면에서만 유지';this.paintLevels()},
   initLevels(){
    this.srLines=[];this.srPicker=false;this.element.classList.remove('sr-drawing');
    this.chart.subscribeClick(p=>{if(!this.srPicker||p.paneIndex!==0||!p.point||!this.candles)return;const price=this.candles.coordinateToPrice(p.point.y);if(!(Number.isFinite(price)&&price>0))return;this.addLevel(price);this.srPicker=false;this.element.classList.remove('sr-drawing');this.renderControls()});
    this.paintLevels();if(this.srState?.auto&&this.srState.show)this.loadAutoLevels();
   },
   paintLevels(){
    if(!this.candles||!this.srState)return;
    for(const line of this.srLines||[])this.candles.removePriceLine(line);this.srLines=[];
    if(!this.srState.show)return;
    const colors={support:'#73d8a0',resistance:'#ff7588',reference:'#8faaff'},names={support:'지지',resistance:'저항',reference:'기준'};
    const auto=this.srState.auto?(this.srAuto?.rows||[]).map(x=>({...x,auto:true})):[];
    for(const x of [...auto,...this.srState.manual]){this.srLines.push(this.candles.createPriceLine({price:x.price,color:colors[x.kind],lineWidth:x.auto?1:2,lineStyle:x.auto?2:0,lineVisible:true,axisLabelVisible:true,title:(x.auto?'자동 ':'')+(x.label||names[x.kind])}))}
   },
   async loadAutoLevels(){
    if(!this.srState?.auto||!this.srState.show||!this.item)return;
    const tv=this.item.tv,frame=this.srState.frame,seq=this.srSeq=(this.srSeq||0)+1;this.srPending=true;this.srAuto=null;this.paintLevels();this.srError='';
    try{const d=frame===this.interval&&this.data?this.data:await api((frame==='W'?'/api/fib-history?symbol=':'/api/history?interval=D&symbol=')+encodeURIComponent(tv));if(seq!==this.srSeq||this.item?.tv!==tv||this.srState.frame!==frame)return;
     const rows=HongScenario.completed(d,frame,tv),price=this.data?.candles.at(-1)?.close||rows.at(-1)?.close;this.srAuto={rows:detect(rows,price),source:d.source,updated:d.updated,last:rows.at(-1)?.time,stale:d.stale};
    }catch(e){if(seq===this.srSeq)this.srError=e.message||'후보 데이터 없음'}finally{if(seq===this.srSeq){this.srPending=false;this.paintLevels();if(this.expandedTool==='sr'){const old=this.controls.querySelector('[data-level-settings]');old?.remove();this.renderLevelSettings()}}}
   },
   addLevel(price){
    if(!this.srState)return;const panel=this.controls.querySelector('[data-level-settings]'),input=panel?.querySelector('[data-level-price]');
    price=Number(price);if(!(Number.isFinite(price)&&price>0&&price<1e15)){this.srMessage='0보다 큰 가격을 입력하세요.';return false}if(this.srState.manual.length>=30){this.srMessage='직접 그린 선은 종목당 30개까지 저장합니다.';return false}
    const step=this.priceFormat?.minMove||.01;price=Number((Math.round(price/step)*step).toFixed(this.priceFormat?.precision??2));if(!(price>0)){this.srMessage='종목의 최소 가격 단위보다 큰 값을 입력하세요.';return false}
    this.srState.manual.push({id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),price,kind:panel?.querySelector('[data-level-kind]')?.value||'support',label:(panel?.querySelector('[data-level-label]')?.value||'').slice(0,18)});this.srState.show=true;this.persistLevels();return true;
   },
   renderLevelSettings(){
    if(!this.srState)return;const s=this.srState,panel=document.createElement('section');panel.className='indicator-settings level-settings';panel.dataset.levelSettings='';panel.setAttribute('aria-label','지지·저항선 설정');
    const money=p=>number(p,this.priceFormat?.precision??2),names={support:'지지',resistance:'저항',reference:'기준'};
    panel.innerHTML=`<div class="settings-head"><b>주요 지지·저항 · 수평선</b><button data-level-close aria-label="지지 저항 설정 접기">접기 ▴</button></div><div class="settings-checks"><label><input type="checkbox" data-level-show ${s.show?'checked':''}> 수평선 표시</label><label><input type="checkbox" data-level-auto ${s.auto?'checked':''}> 자동 후보선</label><label>자동 기준 <select data-level-frame aria-label="지지 저항 자동 기준 봉"><option value="D" ${s.frame==='D'?'selected':''}>일봉</option><option value="W" ${s.frame==='W'?'selected':''}>주봉</option></select></label></div><p class="data-source">자동: 완료된 최근 최대 500봉의 좌우 3봉 고점·저점을 가격 구간으로 묶고, 4봉 이상 떨어진 반응 2회 이상만 표시합니다. 현재 차트 가격과 가까운 지지·저항 각 최대 3개입니다. 확정 지지·저항이나 매수 신호는 아닙니다.</p><div class="level-add"><label>가격 <input type="number" min="0" step="any" data-level-price aria-label="수평선 추가 가격" placeholder="가격 입력"></label><label>구분 <select data-level-kind aria-label="수평선 종류"><option value="support" ${!this.srDraft?.kind||this.srDraft.kind==='support'?'selected':''}>지지</option><option value="resistance" ${this.srDraft?.kind==='resistance'?'selected':''}>저항</option><option value="reference" ${this.srDraft?.kind==='reference'?'selected':''}>기준</option></select></label><label>이름 <input data-level-label maxlength="18" aria-label="수평선 이름" placeholder="선택 입력" value="${esc(this.srDraft?.label||'')}"></label><button data-level-add>선 추가</button><button data-level-pick class="${this.srPicker?'on':''}" aria-pressed="${!!this.srPicker}">${this.srPicker?'클릭 작도 취소':'차트 클릭으로 추가'}</button></div><p class="level-message" role="status">${esc(this.srPicker?'가격 차트의 원하는 높이를 한 번 누르세요. RSI 영역은 제외합니다.':this.srMessage||'직접 그린 선은 종목별로 저장되며, 봉 전환·전체화면에서도 유지됩니다.')}</p><div class="level-manual-list">${s.manual.length?s.manual.map(x=>`<div class="level-row" data-level-id="${esc(x.id)}"><span class="level-kind ${x.kind}">${esc(x.label||names[x.kind])}</span><input type="number" min="0" step="any" value="${x.price}" aria-label="${esc(x.label||names[x.kind])} 수평선 가격"><button data-level-edit>변경</button><button data-level-delete aria-label="${esc(x.label||names[x.kind])} ${x.price} 수평선 삭제">삭제</button></div>`).join(''):'<small class="data-source">직접 그린 선 없음</small>'}</div>${s.auto?`<div class="level-auto-list"><b>자동 후보 · ${s.frame==='W'?'주봉':'일봉'}</b>${this.srPending?'<p class="data-source">실제 고점·저점 확인 중…</p>':this.srError?'<p class="data-source">'+esc(this.srError)+'</p>':(this.srAuto?.rows||[]).map(x=>`<span class="level-kind ${x.kind}">${names[x.kind]} ${money(x.price)} · ${x.count}회 · ${number(x.distance,1)}%</span>`).join('')||'<p class="data-source">반복 반응 조건에 맞는 후보 없음</p>'}<small class="data-source">${this.srAuto?esc(this.srAuto.source)+' · 수집 '+formatDate(this.srAuto.updated)+(this.srAuto.stale?' · 이전 수집':'')+' · 마지막 완료 봉 '+esc(this.srAuto.last||'없음'):''}</small></div>`:''}<small class="data-source">직접 선: 실선 · 자동 후보: 점선. 색상은 지지 초록 / 저항 분홍 / 기준 파랑입니다. 수평선은 모의 진입의 채널 계산과 별개로 표시됩니다.</small>`;
    this.controls.querySelector('.indicator-buttons').after(panel);
    panel.querySelector('[data-level-kind]').onchange=e=>{this.srDraft={...this.srDraft,kind:e.target.value}};panel.querySelector('[data-level-label]').oninput=e=>{this.srDraft={...this.srDraft,label:e.target.value}};
    const rerender=()=>this.renderControls();panel.querySelector('[data-level-close]').onclick=()=>{this.expandedTool=null;this.srPicker=false;this.element.classList.remove('sr-drawing');rerender()};
    panel.querySelector('[data-level-show]').onchange=e=>{s.show=e.target.checked;if(!s.show){this.srPicker=false;this.element.classList.remove('sr-drawing')}this.persistLevels();if(s.auto&&s.show)this.loadAutoLevels();rerender()};
    panel.querySelector('[data-level-auto]').onchange=e=>{s.auto=e.target.checked;this.srSeq=(this.srSeq||0)+1;this.srPending=false;this.srAuto=null;this.persistLevels();if(s.auto&&s.show)this.loadAutoLevels();rerender()};
    panel.querySelector('[data-level-frame]').onchange=e=>{s.frame=e.target.value;this.srSeq=(this.srSeq||0)+1;this.srAuto=null;this.persistLevels();if(s.auto&&s.show)this.loadAutoLevels();rerender()};
    panel.querySelector('[data-level-add]').onclick=()=>{this.addLevel(panel.querySelector('[data-level-price]').value);rerender()};
    panel.querySelector('[data-level-price]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.addLevel(e.target.value);rerender()}};
    panel.querySelector('[data-level-pick]').onclick=()=>{this.srPicker=!this.srPicker;if(this.srPicker)s.show=true;this.element.classList.toggle('sr-drawing',this.srPicker);this.persistLevels();rerender()};
    for(const row of panel.querySelectorAll('[data-level-id]')){row.querySelector('[data-level-delete]').onclick=()=>{s.manual=s.manual.filter(x=>x.id!==row.dataset.levelId);this.persistLevels();rerender()};row.querySelector('[data-level-edit]').onclick=()=>{const price=Number(row.querySelector('input').value),x=s.manual.find(x=>x.id===row.dataset.levelId);if(x&&Number.isFinite(price)&&price>0&&price<1e15){x.price=price;this.persistLevels()}else this.srMessage='0보다 큰 가격을 입력하세요.';rerender()}}
   }
  });
 }
 return {normalize,read,save,detect,install};
});
