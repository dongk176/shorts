import { periods, windows, money, number, percent, kstDay, shiftDay, clock, relative, periodSales, salesSummary, routeCoverage, safeText } from "./model.js";

const PREVIEW = new URLSearchParams(location.search).get("preview") === "1";
  const tabs = [{id:"today",name:"오늘",icon:"grid"},{id:"operations",name:"운영",icon:"activity"},{id:"revenue",name:"매출",icon:"chart"},{id:"inbox",name:"알림",icon:"bell"}];
  const app = document.getElementById("app"), sheet = document.getElementById("sheet"), toastEl = document.getElementById("toast");
  const kindNames = {urgent:"긴급",attention:"주의",payment:"결제",recovery:"복구"};
  const state = {tab:tabs.some(t=>t.id===location.hash.slice(1))?location.hash.slice(1):"today",data:null,period:7,window:1,currency:"KRW",paymentFilter:"all",inboxFilter:"all",error:"",loading:false,push:null,registration:null};
  let toastTimer, pollTimer, refreshTask, lastFocus, installPrompt;
  const paths = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',chart:'<path d="M4 4v16h17M8 15v-3m5 3V7m5 8v-5"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    settings:'<path d="M3 6h8m4 0h6M3 12h2m4 0h12M3 18h12m4 0h2"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',chevron:'<path d="m9 5 7 7-7 7"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
    down:'<path d="m17 7-10 10M7 7v10h10"/>',up:'<path d="m7 17 10-10M7 7h10v10"/>',repeat:'<path d="M20 7H7a4 4 0 0 0-4 4m1 6h13a4 4 0 0 0 4-4M17 4l3 3-3 3M7 14l-3 3 3 3"/>',
    check:'<path d="m5 12 4 4 10-10"/>',alert:'<path d="M12 5v8M12 18h.01"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m2 9v-2a6 6 0 0 0-2-4"/>',
    phone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',share:'<path d="M7 9H4v12h16V9h-3M12 15V2m-4 4 4-4 4 4"/>',
    moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',wifi:'<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0M12 20h.01"/>',
    shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-5"/>',
  };
  const icon = (name,cls="") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.grid}</svg>`;
  const esc = safeText;
  const eventIcon = kind => icon({urgent:"alert",attention:"activity",payment:"down",recovery:"check"}[kind]);
  const sampleNote = sample => !sample ? "미확인" : sample[1] ? `${number(sample[0])}/${number(sample[1])}건 성공` : "표본 없음";
  const activeEvents = () => state.data.events.filter(e=>["urgent","attention"].includes(e.kind)&&!e.resolved);
  const unchecked = () => activeEvents().filter(e=>!e.acknowledged).length;
  function stored(key, fallback=null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function persist(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch { /* Private browsing may disable storage. */ } }
  function applyTheme() {
    const theme=stored("easycut.admin.theme","system");
    document.documentElement.dataset.theme=theme==="system"?(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"):theme;
    document.querySelector('meta[name="theme-color"]').content=document.documentElement.dataset.theme==="dark"?"#14141b":"#f7f8fc";
  }
  function toast(text) { clearTimeout(toastTimer);toastEl.textContent=text;toastEl.classList.add("visible");toastTimer=setTimeout(()=>toastEl.classList.remove("visible"),3600); }
  function switchTab(tab) { if(!tabs.some(t=>t.id===tab))return;state.tab=tab;history.replaceState(null,"","#"+tab);closeSheet();render();window.scrollTo({top:0,behavior:"instant"});document.querySelector("h1")?.focus({preventScroll:true}); }
  function openSheet(title, content) {
    lastFocus=document.activeElement;
    sheet.innerHTML=`<div class="sheet-header"><h2 id="sheet-title">${esc(title)}</h2><button class="icon-button" data-action="close" aria-label="닫기">${icon("close")}</button></div><div class="sheet-body">${content}</div>`;
    if(!sheet.open)sheet.showModal();
    document.body.style.overflow="hidden";
  }
  function closeSheet() { if(sheet.open)sheet.close();document.body.style.overflow=""; }
  sheet.addEventListener("close",()=>{document.body.style.overflow="";if(lastFocus?.isConnected)lastFocus.focus();});
  sheet.addEventListener("click",event=>{if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeSheet();}});
  function segments(options,selected,action) {
    return `<div class="segments" role="group" aria-label="${action==="period"?"매출 기간":action==="window"?"성공률 기간":"목록 필터"}">${options.map(([value,label])=>`<button data-action="${action}" data-value="${esc(value)}" aria-pressed="${String(value)===String(selected)}">${esc(label)}</button>`).join("")}</div>`;
  }
  function empty(title,description="",symbol="check") { return `<div class="empty">${icon(symbol)}<strong>${esc(title)}</strong>${description?`<p>${esc(description)}</p>`:""}</div>`; }
  function heading(title,description) {
    return `<div class="page-heading"><div><h1 tabindex="-1">${title}</h1><p>${description}</p></div><div class="sync-label ${state.error?"stale":""}"><i></i>${PREVIEW?"미리보기":`${clock(state.data.checkedAt)} 확인`}</div></div>`;
  }
  function eventRow(event) {
    return `<button class="event-row" data-action="event" data-id="${esc(event.id)}"><span class="event-icon ${esc(event.kind)}">${eventIcon(event.kind)}</span><span class="event-copy"><span class="event-meta"><span class="${esc(event.kind)}">${kindNames[event.kind]}</span><span>${event.acknowledged?"확인 중":relative(event.occurredAt,state.data.checkedAt)}</span>${!event.read?'<i class="unread-dot"></i>':""}</span><strong class="event-title">${esc(event.title)}</strong><span class="event-sub">${esc(event.subtitle)}</span></span>${icon("chevron","row-chevron")}</button>`;
  }
  function paymentRow(payment) {
    const label={new:"새로운 구독",renewal:"구독 갱신",other:"결제 완료"}[payment.kind]||"결제 완료";
    return `<button class="payment-row" data-action="payment" data-id="${esc(payment.id)}"><span class="event-icon">${icon(payment.kind==="renewal"?"repeat":"down")}</span><span class="payment-copy"><strong>${label}</strong><small>${kstDay(payment.occurredAt).slice(5).replace("-",".")} · ${clock(payment.occurredAt)}${payment.entitlement===false?" · 이용권 확인 필요":""}</small></span><span class="payment-amount">${money(payment.amountMinor,payment.currency)}</span></button>`;
  }
  function chart(days=7,large=false) {
    const data=state.data;
    const last=kstDay(data.checkedAt),start=shiftDay(last,-days+1);
    const rows=periodSales(data,days,state.currency);
    const points=Array.from({length:days},(_,i)=>{const day=shiftDay(start,i);return {day,value:rows.find(p=>p.day===day)?.gross||0};});
    if(days===1)return `<div class="notice-box">오늘 ${number(salesSummary(data,1,state.currency).count)}건의 결제가 승인됐어요.</div>`;
    const max=Math.max(1,...points.map(p=>p.value))*1.22,w=480,h=132,pad=5;
    const coordinates=points.map((p,i)=>[pad+i*(w-pad*2)/(points.length-1),h-10-(p.value/max)*(h-20)]);
    const line=coordinates.map(([x,y],i)=>`${i?"L":"M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const lastPoint=coordinates.at(-1),id=large?"sales-large":"sales-small";
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${days}일간 일별 결제 승인액"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".13"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="M5 120H475" stroke="var(--line)" fill="none"/><path d="${line} L475,${h} L5,${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="3" fill="var(--accent)"/>${coordinates.map(([x],i)=>`<rect class="chart-hit" data-chart-day="${points[i].day}" data-chart-value="${points[i].value}" x="${Math.max(0,x-w/points.length/2)}" y="0" width="${w/points.length}" height="${h}" fill="transparent"><title>${points[i].day}: ${money(points[i].value,state.currency)}</title></rect>`).join("")}</svg><div class="chart-labels"><span>${start.slice(5).replace("-",".")}</span><span>${shiftDay(start,Math.floor(days/2)).slice(5).replace("-",".")}</span><span>오늘</span></div>${large?'<div class="chart-caption" id="chart-readout" aria-live="polite">일별 결제 승인액 · 차트를 눌러 확인</div>':""}`;
  }
  function revenueHero(days=1,large=false) {
    const summary=salesSummary(state.data,days,state.currency);
    const yesterday=state.data.dailySales.find(r=>r.currency===state.currency&&r.day===shiftDay(kstDay(state.data.checkedAt),-1));
    const change=yesterday?.gross?((summary.gross/yesterday.gross-1)*100):null;
    return `<section class="card revenue-hero"><div class="hero-top"><span class="hero-label">${days===1?"오늘":`최근 ${days}일`} 결제 승인액</span><span class="status-pill">${state.currency}</span></div><div class="hero-total">${state.data.availability.billing?money(summary.gross,state.currency):"미확인"}</div><div class="change">${days===1&&change!==null?`<strong class="${change<0?"down":""}">${change>=0?"+":""}${change.toFixed(1)}%</strong><span>전일 전체 승인액 대비</span>`:`<span>${number(summary.count)}건 · 신규 ${number(summary.newCount)} / 갱신 ${number(summary.renewalCount)}</span>`}</div>${state.data.availability.billing?chart(large?days:7,large):empty("결제 정보를 확인하지 못했어요","잠시 후 새로고침해주세요.","wifi")}</section>`;
  }
  function today() {
    const d=state.data,events=activeEvents();
    return heading("오늘의 흐름","한눈에 보는 이지컷.")+`<div class="overview-grid"><div class="stack">${revenueHero()}<div class="metric-pair"><section class="card mini-metric"><div class="metric-top"><span>제작 성공률</span>${icon("activity")}</div><div class="metric-value">${percent(d.jobs?.sample)}</div><p class="metric-note">${sampleNote(d.jobs?.sample)} · ${esc(d.jobs?.window||"미확인")}</p></section><section class="card mini-metric"><div class="metric-top"><span>활성 구독</span>${icon("users")}</div><div class="metric-value">${number(d.stats.activeSubscriptions)}<small>명</small></div><p class="metric-note">오늘 신규 가입 <strong>${number(d.stats.newMembers)}명</strong></p></section></div></div><div class="stack"><section class="card event-card"><div class="section-head"><h2>확인할 일</h2><span class="attention-count">${events.length}건</span></div>${!d.availability.alerts?empty("알림 상태 미확인","연결 상태를 확인해주세요.","wifi"):events.length?events.slice(0,3).map(eventRow).join(""):empty("지금은 여유로워요","확인할 운영 알림이 없어요.")}<p class="card-note">${events.length?"사건을 누르면 영향과 확인할 내용을 볼 수 있어요.":"문제가 생기면 이곳에 알려드릴게요."}</p></section><section class="card queue-strip" aria-label="작업 현황"><div class="queue-item"><span>대기 중</span><strong>${number(d.jobs?.waiting)}<small>건</small></strong></div><div class="queue-item"><span>제작 중</span><strong>${number(d.jobs?.running)}<small>건</small></strong></div><div class="queue-item"><span>최장 대기</span><strong>${number(d.jobs?.oldestWaitMinutes)}<small>분</small></strong></div></section></div></div><div class="feed-heading"><h2>최근 결제</h2><button class="text-link" data-action="tab" data-value="revenue">전체 보기 ${icon("chevron")}</button></div><section class="card payment-table">${d.payments.slice(0,3).map(paymentRow).join("")||empty("아직 결제 내역이 없어요")}</section>`;
  }
  function operations() {
    const d=state.data,valid=d.routes.map(r=>r.samples[state.window]).filter(Boolean);
    const total=valid.length===d.routes.length&&valid.length?valid.reduce((a,s)=>[a[0]+s[0],a[1]+s[1]],[0,0]):null;
    return heading("차분하게, 운영","수집부터 제작 완료까지.")+`<div class="screen-top-controls">${segments(windows.map(h=>[h,`${h}시간`]),state.window,"window")}</div><div class="operation-summary"><section class="card"><div class="hero-label">IP 시도 성공률</div><div class="metric-value">${percent(total)}</div><p class="metric-note">${sampleNote(total)} · 재시도 포함</p></section><section class="card"><div class="hero-label">제작 최종 성공률</div><div class="metric-value">${percent(d.jobs?.sample)}</div><p class="metric-note">${sampleNote(d.jobs?.sample)} · ${esc(d.jobs?.window||"미확인")}</p></section></div><div class="overview-grid"><section><div class="section-head"><h2>IP 상태</h2><span>${d.routes.length}개 경로</span></div><div class="route-list">${d.routes.map((r,i)=>`<button class="route-row" data-action="route" data-id="${esc(r.id)}"><span class="route-avatar">${String(i+1).padStart(2,"0")}</span><span class="route-info"><strong>${esc(r.id)}</strong><small>${r.samples[state.window]?`${sampleNote(r.samples[state.window])}`:"할당 이력 확인 필요"}</small></span><span class="route-right"><strong>${percent(r.samples[state.window],0)}</strong><small class="${r.recommendation!=="유지"?"warning":""}">${esc(r.recommendation)}</small></span>${icon("chevron","row-chevron")}</button>`).join("")||`<div class="card">${empty("IP 상태 미확인","수집 경로가 연결되면 표시돼요.","wifi")}</div>`}</div><p class="card-note">교체 이후 기록만 집계해요. 영상 자체의 접근 제한은 별도로 봅니다.</p></section><section class="card"><div class="section-head"><h2>제작 흐름</h2><span>${esc(d.jobs?.window||"미확인")}</span></div>${d.stages.length?`<div class="pipeline">${d.stages.map((s,i)=>`<div class="pipeline-row"><span class="stage-index">${i+1}</span><div><strong>${esc(s.title)}</strong><small>${esc(s.duration)}</small></div><span>${percent(s.sample,0)}</span></div>`).join("")}</div>`:`<div class="detail-row"><span>완료 / 종료된 작업</span><strong>${sampleNote(d.jobs?.sample)}</strong></div><p class="card-note">단계별 소요 시간은 집계 연결 후 표시됩니다.</p>`}<div class="detail-list"><div class="detail-row"><span>대기 중</span><strong>${number(d.jobs?.waiting)}건</strong></div><div class="detail-row"><span>현재 제작 중</span><strong>${number(d.jobs?.running)}건</strong></div><div class="detail-row"><span>최장 대기</span><strong>${number(d.jobs?.oldestWaitMinutes)}분</strong></div></div></section></div>`;
  }
  function revenue() {
    const d=state.data,summary=salesSummary(d,state.period,state.currency),start=shiftDay(kstDay(d.checkedAt),-state.period+1);
    const payments=d.payments.filter(p=>p.currency===state.currency&&kstDay(p.occurredAt)>=start&&(state.paymentFilter==="all"||state.paymentFilter==="refund"&&p.refundedMinor>0||p.kind===state.paymentFilter));
    const currencies=[...new Set(["KRW",...d.dailySales.map(p=>p.currency)])];
    return heading("쌓여가는 매출","결제와 구독의 흐름을 살펴보세요.")+`<div class="screen-top-controls">${segments(periods.map(p=>[p,p===1?"오늘":`최근 ${p}일`]),state.period,"period")}${currencies.length>1?segments(currencies.map(c=>[c,c]),state.currency,"currency"):""}</div><div class="revenue-layout">${revenueHero(state.period,true)}<div class="revenue-stats"><section class="card"><div class="section-head"><h2>결제 요약</h2><span>${state.currency}</span></div><div class="stat-line"><span>승인 건수</span><strong>${number(summary.count)}건</strong></div><div class="stat-line"><span>신규 결제</span><strong>${number(summary.newCount)}건</strong></div><div class="stat-line"><span>갱신 결제</span><strong>${number(summary.renewalCount)}건</strong></div><div class="stat-line"><span>해당 결제 환불액</span><strong>${money(summary.refunds,state.currency)}</strong></div><p class="card-note">선택 기간에 승인된 결제 기준입니다.<br>통화별 금액은 따로 집계해요.</p></section></div></div><div class="feed-heading"><h2>결제 내역</h2><small>최근 ${d.payments.length}건에서 조회</small></div>${segments([["all","전체"],["new","신규"],["renewal","갱신"],["refund","환불"]],state.paymentFilter,"payment-filter")}<section class="card payment-table" style="margin-top:16px">${payments.slice(0,50).map(paymentRow).join("")||empty("해당 결제 내역이 없어요")}</section>`;
  }
  function inbox() {
    const events=state.data.events.filter(e=>state.inboxFilter==="all"||state.inboxFilter==="urgent"&&["urgent","attention"].includes(e.kind)||state.inboxFilter==="payment"&&e.kind==="payment").sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
    return heading("놓치지 않도록","발생부터 복구까지, 한곳에서.")+`<div class="inbox-layout"><div class="screen-top-controls">${segments([["all","전체"],["urgent","확인 필요"],["payment","결제"]],state.inboxFilter,"inbox-filter")}</div><section class="card inbox-group">${events.map(eventRow).join("")||empty("알림을 모두 확인했어요","새로운 소식이 생기면 알려드릴게요.")}</section></div>`;
  }
  function render() {
    if(!state.data)return;
    const navigation=tabs.map(t=>`<button class="nav-button ${state.tab===t.id?"active":""}" data-action="tab" data-value="${t.id}" ${state.tab===t.id?'aria-current="page"':""}>${icon(t.icon)}<span>${t.name}</span>${t.id==="inbox"&&unchecked()?'<i class="nav-dot" aria-label="확인할 알림 있음"></i>':""}</button>`).join("");
    app.innerHTML=`<aside class="sidebar"><div class="wordmark"><span class="brand-mark">e.</span><span>EasyCut<small>ADMIN SPACE</small></span></div><p class="sidebar-label">WORKSPACE</p><nav class="nav-list" aria-label="주 메뉴">${navigation}</nav><button class="nav-button" style="margin-top:26px" data-action="install">${icon("phone")}<span>홈 화면에 추가</span></button><div class="sidebar-bottom"><span class="avatar">EC</span><span>개인 관리자<br><small>EasyCut workspace</small></span></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb"><span>워크스페이스</span>${icon("chevron")}<strong>${tabs.find(t=>t.id===state.tab).name}</strong></div><div class="mobile-brand"><span class="brand-mark">e.</span>EasyCut</div><div class="top-actions">${PREVIEW?'<span class="preview-tag">미리보기</span>':""}<button class="icon-button ${state.loading?"spinning":""}" data-action="refresh" aria-label="새로고침">${icon("refresh")}</button><button class="icon-button" data-action="settings" aria-label="설정">${icon("settings")}</button></div></header><main class="main" id="main">${state.error?`<div class="banner" role="status">${esc(state.error)}</div>`:""}${({today,operations,revenue,inbox}[state.tab])()}<p class="neutral-note">${PREVIEW?"가상 데이터로 보는 화면 미리보기":"서울 시간 기준 · "+clock(state.data.checkedAt)+" 확인"}</p></main></div><nav class="mobile-nav" aria-label="모바일 메뉴">${navigation}</nav>`;
  }
  function eventDetail(id) {
    const event=state.data.events.find(e=>e.id===id);if(!event)return;
    const wasUnread=!event.read;event.read=true;
    if(wasUnread)saveReceipt(event,false).catch(()=>toast("읽음 상태를 저장하지 못했어요."));
    openSheet("알림 상세",`<div class="event-icon sheet-hero-icon ${esc(event.kind)}">${eventIcon(event.kind)}</div><div class="eyebrow">${kindNames[event.kind]}${event.resolved?" · 복구됨":event.acknowledged?" · 확인 중":""}</div><h3 class="sheet-title">${esc(event.title)}</h3><p class="sheet-text">${esc(event.detail)}</p><div class="detail-list"><div class="detail-row"><span>영향 범위</span><strong>${esc(event.impact)}</strong></div><div class="detail-row"><span>발생 시각</span><strong>${clock(event.occurredAt)}</strong></div></div><div class="next-step"><small>먼저 확인할 내용</small><p>${esc(event.nextStep)}</p></div>${event.timeline?.length?`<div class="timeline">${event.timeline.map(item=>`<div class="timeline-row"><i></i><span>${esc(item.title)}</span><small>${clock(item.date)}</small></div>`).join("")}</div>`:""}${["urgent","attention"].includes(event.kind)&&!event.resolved?`<button class="primary-button" data-action="ack" data-id="${esc(event.id)}">${icon(event.acknowledged?"check":"shield")}${event.acknowledged?"확인 중 · 미해결":"확인 중으로 표시"}</button>`:""}${event.paymentId?`<button class="secondary-button" data-action="payment" data-id="${esc(event.paymentId)}">결제 내역 확인 ${icon("arrow")}</button>`:""}${event.routeId?`<button class="secondary-button" data-action="route" data-id="${esc(event.routeId)}">IP 상태 확인 ${icon("arrow")}</button>`:""}`);
    render();
  }
  function paymentDetail(id) {
    const p=state.data.payments.find(p=>p.id===id);
    if(!p){toast("이전 결제는 관리자 페이지에서 확인할 수 있어요.");return;}
    openSheet("결제 상세",`<div class="event-icon sheet-hero-icon">${icon(p.kind==="renewal"?"repeat":"down")}</div><div class="eyebrow">${p.kind==="new"?"신규 결제":p.kind==="renewal"?"구독 갱신":"결제 승인"}</div><h3 class="sheet-title" style="font-size:35px">${money(p.amountMinor,p.currency)}</h3><p class="sheet-text">${clock(p.occurredAt)} 승인</p><div class="detail-list"><div class="detail-row"><span>주문</span><strong>${esc(p.id)}</strong></div><div class="detail-row"><span>결제 상태</span><strong>승인 완료</strong></div><div class="detail-row"><span>이용권 지급</span><strong>${p.entitlement===true?"지급 기록 확인":p.entitlement===false?"확인 필요":"해당 없음 / 미확인"}</strong></div><div class="detail-row"><span>누적 환불</span><strong>${money(p.refundedMinor,p.currency)}</strong></div></div>${!PREVIEW?'<a class="secondary-button" href="/admin/easycutcutcutcutcutcut?tab=billing">관리자에서 자세히 보기</a>':""}`);
  }
  function routeDetail(id) {
    const r=state.data.routes.find(r=>r.id===id);if(!r)return;
    openSheet("IP 상세",`<div class="event-icon sheet-hero-icon ${r.recommendation==="유지"?"recovery":"attention"}">${icon("activity")}</div><div class="eyebrow">${esc(r.recommendation)}</div><h3 class="sheet-title">${esc(r.id)}</h3><p class="sheet-text">${esc(r.reason)}</p><div class="window-grid">${windows.map(h=>`<div class="window-card"><span>최근 ${h}시간</span><strong>${percent(r.samples[h])}</strong><small>${sampleNote(r.samples[h])}<br>${routeCoverage(r,h,state.data.checkedAt)}</small></div>`).join("")}</div><div class="detail-list"><div class="detail-row"><span>마지막 성공</span><strong>${r.lastSuccess?relative(r.lastSuccess,state.data.checkedAt):"미확인"}</strong></div><div class="detail-row"><span>연속 실패</span><strong>${number(r.consecutiveFailures)}회</strong></div><div class="detail-row"><span>상태</span><strong>${r.coolingDown?"잠시 대기 중":"대기 제한 없음"}</strong></div>${r.failures.map(f=>`<div class="detail-row"><span>${esc(f.name)}</span><strong>${f.count}건</strong></div>`).join("")}</div><p class="card-note">IP 교체 권고는 추세와 고객 영향을 함께 확인한 뒤 결정해요.</p>`);
  }
  async function saveReceipt(event,ack) {
    if(PREVIEW){persist("easycut.admin.preview.receipts",state.data.events.map(e=>({id:e.id,read:e.read,acknowledged:e.acknowledged})));return;}
    await api("/events",{method:"PATCH",body:JSON.stringify({eventId:event.id,acknowledged:ack?event.acknowledged:undefined,read:true})});
  }
  function toggleRow(key,title,note,checked) {
    return `<div class="setting-row"><label for="setting-${key}">${title}${note?`<small>${note}</small>`:""}</label><label class="switch"><input id="setting-${key}" data-setting="${key}" type="checkbox" ${checked?"checked":""}><span></span></label></div>`;
  }
  async function settings() {
    openSheet("내 설정",`<p class="sheet-text">설정을 불러오는 중이에요.</p>`);
    const subscription=state.registration?await state.registration.pushManager?.getSubscription().catch(()=>null):null;
    state.subscription=subscription;
    const device=subscription?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(subscription.endpoint))),b=>b.toString(16).padStart(2,"0")).join(""):"";
    if(!PREVIEW){try{state.push=await api("/push"+(device?"?device="+device:""));}catch{state.push=null;}}
    const current=state.push?.preferences||stored("easycut.admin.preview.preferences",{payments:true,operations:true,quietNight:true,showAmount:true});
    const enabled=!!subscription&&!!state.push?.subscribed;
    openSheet("내 설정",`<section class="settings-section"><h3>알림</h3><div class="setting-row"><span>이 기기 푸시알림<small>${PREVIEW?"미리보기에서는 발송하지 않아요.":enabled?"알림을 받을 준비가 됐어요.":state.push?.configured?"알림을 허용하면 앱을 닫아도 받을 수 있어요.":"서버 연결 상태를 확인해주세요."}</small></span><span class="status-pill ${enabled?"":"unknown"}">${enabled?"연결됨":PREVIEW?"예시":"연결 전"}</span></div>${toggleRow("payments","결제 알림","신규 · 갱신 결제마다",current.payments)}${toggleRow("operations","운영 알림","제작 실패 · 대기 지연",current.operations)}${toggleRow("quietNight","야간에는 긴급만","23:00–08:00 · 일반 알림은 알림함에만",current.quietNight)}${toggleRow("showAmount","알림에 금액 표시","고객 개인정보는 표시하지 않아요.",current.showAmount)}<button class="primary-button" style="margin-top:20px" data-action="${enabled?"test-push":"enable-push"}">${icon("bell")}${enabled?"테스트 알림 받기":"푸시알림 켜기"}</button>${enabled?'<button class="text-link" style="margin:12px auto 0;display:flex" data-action="disable-push">이 기기 알림 끄기</button>':""}</section><section class="settings-section"><h3>화면</h3>${segments([["system","자동"],["light","라이트"],["dark","다크"]],stored("easycut.admin.theme","system"),"theme")}</section><section class="settings-section"><h3>앱</h3><button class="setting-row" style="width:100%;text-align:left" data-action="install"><span>홈 화면에 추가<small>다시 설치할 필요 없이 업데이트돼요.</small></span>${icon("chevron","row-chevron")}</button><button class="setting-row" style="width:100%;text-align:left" data-action="refresh"><span>최신 상태 확인</span>${icon("refresh")}</button></section><p class="neutral-note">EasyCut Admin · ${PREVIEW?"미리보기":"개인 관리자"}</p>`);
  }
  function install() {
    if(installPrompt){installPrompt.prompt();installPrompt=null;return;}
    const installed=matchMedia("(display-mode:standalone)").matches||navigator.standalone;
    openSheet("홈 화면에 추가",`<div class="event-icon sheet-hero-icon">${icon("phone")}</div><h3 class="sheet-title">${installed?"이미 앱으로 사용 중이에요":"더 가깝게, EasyCut"}</h3><p class="sheet-text">${installed?"업데이트는 다음 실행에 자동으로 반영돼요.":"아이폰 홈 화면에서 바로 열어보세요."}</p>${installed?"":`<ol class="install-steps"><li><b>1</b><span>Safari에서 이 페이지를 열어요.</span></li><li><b>2</b><span>공유 ${icon("share")} 메뉴를 눌러요.</span></li><li><b>3</b><span><strong>홈 화면에 추가</strong>를 선택해요.</span></li><li><b>4</b><span>앱을 열고 설정에서 알림을 켜요.</span></li></ol>`}<div class="notice-box">새 버전도 같은 아이콘으로 열 수 있어요.<br>앱스토어에서 다시 받을 필요가 없어요.</div>`);
  }
  async function api(path,options={}) {
    const response=await fetch("/api/admin/mobile"+path,{...options,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...(options.headers||{})},signal:AbortSignal.timeout(18000)});
    if(response.status===401||response.status===403){state.data=null;closeSheet();auth(response.status);throw new Error("로그인이 필요해요.");}
    const body=await response.json();
    if(!response.ok)throw new Error(body.detail||"잠시 후 다시 시도해주세요.");
    return body;
  }
  function auth(status=401) {
    app.innerHTML=`<div class="auth-page"><div><section class="card auth-card"><span class="brand-mark">e.</span><h1>${status===403?"관리자 전용 공간이에요":"나의 작은 운영실."}</h1><p>${status===403?"관리자 권한이 있는 계정으로 로그인해주세요.":"로그인하고 이지컷의 오늘을 확인하세요."}</p><a class="primary-button" href="/auth/sign-in?next=%2Fadmin-app%2Findex.html">관리자 로그인 ${icon("arrow")}</a><a class="text-link" href="?preview=1">화면 미리보기</a></section><p class="auth-foot">EasyCut Admin</p></div></div>`;
  }
  async function refresh(manual=false) {
    if(PREVIEW){if(manual)toast("가상 데이터 미리보기예요.");return;}
    if(refreshTask)return refreshTask;
    state.loading=true;if(state.data)render();
    refreshTask=(async()=>{try{
      const data=await api("/overview");
      state.data=data;state.error="";
      if(!data.dailySales.some(p=>p.currency===state.currency)&&data.dailySales.length)state.currency=data.dailySales[0].currency;
      render();if(manual)toast("최신 상태를 확인했어요.");
    }catch(error){
      if(state.data){state.error="연결이 잠시 끊겼어요. 마지막 확인 상태를 보고 있어요.";render();}
      else if(!app.querySelector(".auth-page"))app.innerHTML=`<div class="auth-page"><section class="card auth-card"><h1>연결을 확인해주세요</h1><p>운영 정보를 불러오지 못했어요.</p><button class="primary-button" data-action="refresh">다시 시도</button><a class="text-link" href="?preview=1">화면 미리보기</a></section></div>`;
      if(manual)toast(error.message);
    }finally{state.loading=false;refreshTask=null;document.querySelector('[data-action="refresh"]')?.classList.remove("spinning");}})();
    return refreshTask;
  }
  function base64Bytes(value) { return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0)); }
  async function enablePush() {
    if(PREVIEW){toast("실제 알림은 관리자 로그인 후 켤 수 있어요.");return;}
    if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)){install();toast("홈 화면에 추가한 앱에서 알림을 켜주세요.");return;}
    const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    if(isiOS&&!matchMedia("(display-mode:standalone)").matches&&!navigator.standalone){install();return;}
    if(Notification.permission==="denied"){toast("브라우저 설정에서 알림을 허용해주세요.");return;}
    // Settings preloads the key so Safari sees subscribe() directly in this gesture.
    const config=state.push,registration=state.registration;
    if(!config?.configured||!config.publicKey)throw new Error("푸시 서버 연결을 확인해주세요.");
    if(!registration?.active)throw new Error("앱을 준비하고 있어요. 잠시 후 다시 눌러주세요.");
    const subscription=state.subscription||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64Bytes(config.publicKey)});
    await api("/push",{method:"POST",body:JSON.stringify({subscription:subscription.toJSON()})});
    toast("이 기기에 푸시알림을 연결했어요.");await settings();
  }
  async function disablePush() {
    const subscription=await state.registration?.pushManager.getSubscription();
    if(subscription){await api("/push",{method:"DELETE",body:JSON.stringify({endpoint:subscription.endpoint})});await subscription.unsubscribe();}
    toast("이 기기의 알림을 껐어요.");await settings();
  }
  async function testPush() {
    const subscription=await state.registration?.pushManager.getSubscription();if(!subscription)throw new Error("먼저 이 기기에 알림을 연결해주세요.");
    await api("/push/test",{method:"POST",body:JSON.stringify({endpoint:subscription.endpoint})});
    toast("테스트 알림을 보냈어요.");
  }
  document.addEventListener("click",async event=>{
    const target=event.target.closest("[data-action]");if(!target||target.disabled)return;
    const action=target.dataset.action,value=target.dataset.value,id=target.dataset.id;
    try {
      if(action==="tab")switchTab(value);
      else if(action==="close")closeSheet();
      else if(action==="event")eventDetail(id);
      else if(action==="payment")paymentDetail(id);
      else if(action==="route")routeDetail(id);
      else if(action==="settings")await settings();
      else if(action==="install")install();
      else if(action==="refresh")await refresh(true);
      else if(action==="period"){state.period=Number(value);render();}
      else if(action==="window"){state.window=Number(value);render();}
      else if(action==="currency"){state.currency=value;render();}
      else if(action==="payment-filter"){state.paymentFilter=value;render();}
      else if(action==="inbox-filter"){state.inboxFilter=value;render();}
      else if(action==="theme"){persist("easycut.admin.theme",value);applyTheme();await settings();}
      else if(action==="ack"){
        target.disabled=true;const e=state.data.events.find(e=>e.id===id);const previous=e.acknowledged;e.acknowledged=!previous;
        try{await saveReceipt(e,true);}catch(error){e.acknowledged=previous;throw error;}
        eventDetail(id);toast(e.acknowledged?"확인 중으로 표시했어요.":"확인 중 표시를 해제했어요.");
      }else if(action==="enable-push"||action==="test-push"||action==="disable-push"){
        target.disabled=true;await ({ "enable-push":enablePush,"test-push":testPush,"disable-push":disablePush }[action])();
      }
    }catch(error){toast(error.message||"잠시 후 다시 시도해주세요.");}
    finally{if(target.isConnected)target.disabled=false;}
  });
  document.addEventListener("change",async event=>{
    const input=event.target;if(!input.dataset.setting)return;
    const preferences=Object.fromEntries([...sheet.querySelectorAll("[data-setting]")].map(i=>[i.dataset.setting,i.checked]));
    try{if(PREVIEW)persist("easycut.admin.preview.preferences",preferences);else await api("/push",{method:"PATCH",body:JSON.stringify({preferences})});toast("설정을 저장했어요.");}
    catch(error){input.checked=!input.checked;toast(error.message);}
  });
  document.addEventListener("pointermove",event=>{
    const target=event.target.closest("[data-chart-day]");if(!target)return;
    const output=document.getElementById("chart-readout");if(output)output.textContent=`${target.dataset.chartDay.slice(5).replace("-",".")} · ${money(Number(target.dataset.chartValue),state.currency)}`;
  });
  window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;});
  window.addEventListener("hashchange",()=>switchTab(location.hash.slice(1)));
  window.addEventListener("offline",()=>{if(state.data){state.error="인터넷 연결이 끊겼어요. 마지막 확인 상태를 보고 있어요.";render();}});
  window.addEventListener("online",()=>refresh());
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){refresh();state.registration?.update().catch(()=>{});}});
  matchMedia("(prefers-color-scheme:dark)").addEventListener("change",applyTheme);
  async function start() {
    applyTheme();
    if("serviceWorker" in navigator){
      try{state.registration=await navigator.serviceWorker.register("/admin-app/sw.js",{scope:"/admin-app/",updateViaCache:"none"});}catch{/* The app still works without installation support. */}
    }
    if(PREVIEW){
      const {previewSnapshot}=await import("./preview.js");state.data=previewSnapshot();
      for(const receipt of stored("easycut.admin.preview.receipts",[])){const e=state.data.events.find(e=>e.id===receipt.id);if(e){e.read=!!receipt.read;e.acknowledged=!!receipt.acknowledged;}}
      render();
    }else{await refresh();pollTimer=setInterval(()=>{if(!document.hidden)refresh();},60_000);}
  }
  window.addEventListener("pagehide",()=>{clearInterval(pollTimer);});
  window.addEventListener("pageshow",event=>{if(event.persisted&&!PREVIEW){refresh();clearInterval(pollTimer);pollTimer=setInterval(()=>{if(!document.hidden)refresh();},60_000);}});
  start();
