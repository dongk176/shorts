import { windows, number, percent, clock, relative, kstDay, routeCoverage, safeText as esc } from "./model.js";
const sampleNote=s=>!s?"미확인":s[1]?`${number(s[0])}/${number(s[1])}건 성공`:"표본 없음";
const priority={"교체 검토":0,"관찰":1,"미확인":2,"표본 부족":3,"유지":4,"일시 제외":5};
export function ipOverview(d,hours,icon,preview) {
  const enabled=d.routes.filter(r=>r.enabled!==false),valid=enabled.map(r=>r.samples[hours]).filter(Boolean);
  const total=valid.length===enabled.length&&valid.length?valid.reduce((a,s)=>[a[0]+s[0],a[1]+s[1]],[0,0]):null;
  const routes=[...d.routes].sort((a,b)=>(priority[a.recommendation]??6)-(priority[b.recommendation]??6)||a.id.localeCompare(b.id));
  const attention=routes.filter(r=>["교체 검토","관찰"].includes(r.recommendation));
  return `<p class="live-note">${preview?"가상 데이터 미리보기":`30초마다 자동 확인 · ${clock(d.checkedAt)} 기준`}</p>
    <div class="operation-summary"><section class="card"><div class="hero-label">사용 중 IP 성공률</div><div class="metric-value">${percent(total)}</div><p class="metric-note">${sampleNote(total)} · 재시도 포함</p><p class="metric-note">${valid.length}/${enabled.length}개 경로 확인</p></section>
    <section class="card"><div class="hero-label">제작 최종 성공률</div><div class="metric-value">${percent(d.jobs?.sample)}</div><p class="metric-note">${sampleNote(d.jobs?.sample)} · ${esc(d.jobs?.window||"미확인")}</p></section></div>
    ${attention.length>=3?`<div class="notice-box ip-notice">${attention.length}개 IP에서 실패가 이어지고 있어요.<br>교체 전에 전체 수집 상태도 함께 확인해주세요.</div>`:""}
    <div class="overview-grid"><section><div class="section-head"><h2>IP 상태</h2><span>${enabled.length}개 사용 중 · ${attention.length}개 확인 필요</span></div><div class="route-list">
    ${routes.map(r=>`<button class="route-row ${r.enabled===false?"route-disabled":""}" data-action="route" data-id="${esc(r.id)}">
      <span class="route-avatar">${esc(r.id.slice(-2))}</span><span class="route-info"><strong>${esc(r.id)}</strong>
      <small>${sampleNote(r.samples[hours])}${r.consecutiveFailures?` · ${r.consecutiveFailures}${r.consecutiveFailures>=20?"+":""}회 연속 실패`:""}</small>
      <small>${r.lastSuccess?`최근 성공 ${relative(r.lastSuccess,d.checkedAt)}`:r.identity?"72시간 내 성공 기록 없음":"현재 IP 이력 미확인"}${r.coolingDown?" · 잠시 대기":""}</small></span>
      <span class="route-right"><strong>${percent(r.samples[hours],0)}</strong><small class="${["교체 검토","관찰"].includes(r.recommendation)?"warning":""}">${esc(r.recommendation)}</small></span>${icon("chevron","row-chevron")}</button>`).join("")||'<div class="card"><p>IP 상태를 확인하지 못했어요.</p></div>'}
    </div><p class="card-note">확인이 필요한 IP부터 보여드려요. IP를 누르면 4개 구간의 추세를 비교할 수 있어요.</p></section>
    <section class="card"><div class="section-head"><h2>제작 흐름</h2><span>${esc(d.jobs?.window||"미확인")}</span></div><div class="detail-row"><span>완료 / 종료된 작업</span><strong>${sampleNote(d.jobs?.sample)}</strong></div><div class="detail-list"><div class="detail-row"><span>대기 중</span><strong>${number(d.jobs?.waiting)}건</strong></div><div class="detail-row"><span>현재 제작 중</span><strong>${number(d.jobs?.running)}건</strong></div><div class="detail-row"><span>최장 대기</span><strong>${number(d.jobs?.oldestWaitMinutes)}분</strong></div></div><p class="card-note">영상 수집은 재시도할 수 있어요. IP 시도 성공률과 최종 제작 성공률은 달라요.</p></section></div>`;
}
export function ipDetail(r,d,icon,preview) {
  return `<div class="event-icon sheet-hero-icon ${r.recommendation==="유지"?"recovery":"attention"}">${icon("activity")}</div><div class="eyebrow">${esc(r.recommendation)}</div><h3 class="sheet-title">${esc(r.id)}</h3><p class="sheet-text">${esc(r.reason)}</p><p class="live-note">${preview?"미리보기":`30초 자동 확인 · ${clock(d.checkedAt)}`}</p>
    <div class="window-grid">${windows.map(h=>`<div class="window-card"><span>최근 ${h}시간</span><strong>${percent(r.samples[h])}</strong><small>${sampleNote(r.samples[h])}<br>${routeCoverage(r,h,d.checkedAt)}${r.excluded?.[h]?`<br>실패 유형 미분류 ${r.excluded[h]}건`:""}</small></div>`).join("")}</div>
    <div class="detail-list"><div class="detail-row"><span>현재 IP 식별자</span><strong>${esc(r.identity||"미확인")}</strong></div>
    <div class="detail-row"><span>${r.assignmentExact?"IP 변경 확인":"이력 확인 시작"}</span><strong>${r.assignedAt?`${kstDay(r.assignedAt).slice(5).replace("-",".")} ${clock(r.assignedAt)}`:"미확인"}</strong></div>
    <div class="detail-row"><span>마지막 성공 · 72시간 내</span><strong>${r.lastSuccess?relative(r.lastSuccess,d.checkedAt):r.identity?"기록 없음":"미확인"}</strong></div>
    <div class="detail-row"><span>연속 봇 확인 실패</span><strong>${number(r.consecutiveFailures)}${r.consecutiveFailures>=20?"+":""}회</strong></div>
    <div class="detail-row"><span>상태</span><strong>${r.enabled===false?"사용 중지":r.coolingDown?"잠시 대기 중":"사용 중"}</strong></div>
    ${r.coolingDown&&r.cooldownUntil?`<div class="detail-row"><span>대기 해제 예정</span><strong>${clock(r.cooldownUntil)}</strong></div>`:""}
    ${r.failures.map(f=>`<div class="detail-row"><span>${esc(f.name)}</span><strong>${f.count}건</strong></div>`).join("")}</div>
    <p class="card-note">교체 이전 기록과 교체 전 시작한 작업은 제외해요. 실패 원인이 불명확한 구간은 성공률을 확정하지 않아요.</p>`;
}
