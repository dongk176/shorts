'use client';
import { AdminSelect } from "@/components/admin-select";
import { useEffect, useState } from 'react';
import { change, formatAmount, meetingLocales, percent, series, shiftDay, total, type MeetingData, type MeetingGrain, type MeetingLocale, type MeetingPeriod } from '@/lib/admin-meeting';
import { userOccupationOptions, userUsagePurposeOptions, userDiscoverySourceOptions } from '@/lib/user-onboarding';
import styles from './admin-meeting-dashboard.module.css';
const n=(v:number)=>v.toLocaleString('ko-KR');
const rate=(v:number|null)=>v===null?'자료 없음':`${v.toFixed(1)}%`;
const labels:Record<string,string>={price:'가격 부담',less_usage:'사용 빈도 감소',quality:'결과물 품질',missing_features:'필요한 기능 부족',alternative:'다른 서비스 이용',technical:'기술 문제',unknown:'기록 없음',...Object.fromEntries([...userOccupationOptions,...userUsagePurposeOptions,...userDiscoverySourceOptions].map(x=>[x.value,x.label])),ko:'한국어',ja:'일본어',en:'영어',es:'스페인어'};
function Card({label,value,hint,delta}:{label:string;value:string;hint:string;delta?:string}) {
 return <article className={styles.card}><h3>{label}</h3><strong>{value}</strong><p>{hint}</p>{delta&&<small>{delta}</small>}</article>;
}
function Trend({data,metric,title,currency='',grain}:{data:MeetingData;metric:string;title:string;currency?:string;grain:MeetingGrain}) {
 const points=series(data,metric,currency,grain),max=Math.max(...points.map(x=>x.value),1);
 const format=(v:number)=>currency?formatAmount(v,currency):`${n(v)}건`;
 const x=(i:number)=>20+i*600/Math.max(points.length-1,1),y=(v:number)=>150-v/max*130;
 return <article className={styles.panel}><header><h3>{title}</h3><span>{grain==='week'?'주간':'월간'} 합계</span></header>
 <svg className={styles.chart} viewBox="0 0 640 170" role="img" aria-label={`${title} 추이. 아래 숫자 보기에서 기간별 값을 확인할 수 있습니다.`}>
 {[0,.5,1].map(f=><line key={f} x1="20" x2="620" y1={y(max*f)} y2={y(max*f)} stroke="currentColor" opacity=".12"/>)}
 <polyline points={points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>
 {points.map((p,i)=><circle key={p.day} cx={x(i)} cy={y(p.value)} r="3.5" fill="currentColor"><title>{p.day} · {format(p.value)}</title></circle>)}
 </svg><div className={styles.chartLabels}><span>{points[0]?.day}</span><span>최고 {format(Math.max(...points.map(p=>p.value),0))}</span><span>{points.at(-1)?.day}</span></div>
 <details className={styles.chartTable}><summary>정확한 숫자 보기</summary><table><thead><tr><th>기간 시작</th><th>{title}</th></tr></thead><tbody>{points.map(p=><tr key={p.day}><td>{p.day}</td><td>{format(p.value)}</td></tr>)}</tbody></table></details></article>;
}
function Breakdown({data,category,title,hint}:{data:MeetingData;category:string;title:string;hint:string}) {
 const rows=data.breakdown.filter(x=>x.category===category),sum=rows.reduce((s,r)=>s+r.value,0),max=Math.max(...rows.map(x=>x.value),1);
 return <article className={styles.panel}><header><h3>{title}</h3><span>{rows.length}종류</span></header><p className={styles.muted}>{hint}</p>{!rows.length?<p className={styles.empty}>이 기간에 기록된 응답이 없습니다.</p>:rows.map(row=><div className={styles.barRow} key={row.label}><div><span>{labels[row.label]||row.label}</span><b>{n(row.value)} <small>({rate(percent(row.value,sum))})</small></b></div><div className={styles.track}><i style={{width:`${row.value/max*100}%`}}/></div></div>)}</article>;
}
export function AdminMeetingDashboard() {
 const [period,setPeriod]=useState<MeetingPeriod>('30'),[locale,setLocale]=useState<MeetingLocale>('all'),[grain,setGrain]=useState<MeetingGrain>('week');
 const [chartCurrency,setChartCurrency]=useState('KRW');
 const [data,setData]=useState<MeetingData|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let alive=true;
  setData(null);setError('');const timeout=setTimeout(()=>controller.abort(),30000);
  fetch(`/api/admin/meeting-dashboard?period=${period}&locale=${locale}`,{cache:'no-store',signal:controller.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.detail||'조회에 실패했습니다.');if(alive)setData(body);}).catch(e=>{if(alive)setError(e instanceof Error&&e.name==='AbortError'?'조회 시간이 길어 중단했습니다. 다시 시도해 주세요.':e.message);}).finally(()=>clearTimeout(timeout));
  return()=>{alive=false;controller.abort();clearTimeout(timeout);};
 },[period,locale,attempt]);
 const exportPdf=async()=>{await document.fonts.ready;const old=document.title;document.title=`이지컷_회의보고서_${period}일_${meetingLocales[locale]}_${data?.end||''}`;try{window.print();}finally{document.title=old;}};
 const s=data?.snapshot;
 const delta=(metric:string,currency='')=>data?.previousStart?change(total(data,metric,currency),total(data,metric,currency,true)):'전체 기간 · 비교 없음';
 const rangeLabel=data?`${data.period==='all'?'전체 기록':data.start} ~ ${shiftDay(data.end,-1)} · ${meetingLocales[data.locale]} · 한국시간`:'';
 return <div className={styles.dashboard}>
 <div className={styles.toolbar}><div><span className={styles.kicker}>MEETING ROOM</span><h1>숫자로 보는 이지컷</h1><p>얼마나 성장했고, 누가 사용하고, 어디를 개선해야 할까요?</p></div><button className={styles.export} disabled={!data} onClick={()=>void exportPdf()}>↗ PDF 저장 / 인쇄</button></div>
 <div className={styles.filters} aria-label="대시보드 조회 조건">
  <fieldset><legend>조회 기간</legend>{(['7','30','90','all'] as const).map(p=><button key={p} aria-pressed={period===p} onClick={()=>setPeriod(p)}>{p==='all'?'전체':`최근 ${p}일`}</button>)}</fieldset>
  <label>매출 차트 통화<AdminSelect value={chartCurrency} onChange={e=>setChartCurrency(e.target.value)}><option value="KRW">원화 KRW</option><option value="JPY">엔화 JPY</option><option value="USD">달러 USD</option></AdminSelect></label>
  <label>이용 언어<AdminSelect value={locale} onChange={e=>setLocale(e.target.value as MeetingLocale)}>{Object.entries(meetingLocales).map(([k,v])=><option key={k} value={k}>{v}</option>)}</AdminSelect></label>
  <fieldset><legend>차트 묶음</legend>{(['week','month'] as const).map(g=><button key={g} aria-pressed={grain===g} onClick={()=>setGrain(g)}>{g==='week'?'주간':'월간'}</button>)}</fieldset><button onClick={()=>setAttempt(v=>v+1)} disabled={!data&&!error}>다시 조회</button>
 </div><p className={styles.help}>최근 기간은 오늘을 포함합니다. PDF 버튼을 누른 뒤 인쇄 창에서 ‘PDF로 저장’을 선택하세요.</p>
 {error?<div role="alert" className={styles.error}>{error}<button onClick={()=>setAttempt(v=>v+1)}>다시 시도</button></div>:!data||!s?<div role="status" className={styles.loading}>회의 자료를 집계하고 있어요…<small>개인정보 없이 합계와 추이만 불러옵니다.</small></div>:<div className={styles.report} data-meeting-report>
 <section className={styles.reportPage}>
  <div className={styles.reportHeading}><div><span className={styles.kicker}>EASY CUT · BUSINESS REVIEW</span><h2>01. 이번 기간, 무슨 일이 있었나요?</h2><p>{rangeLabel}</p></div><small>집계 {new Date(data.generatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}<br/>최대 5분 간격 갱신 · 내부 공유용</small></div>
  <div className={styles.notice}><b>읽기 전에</b> 한국·일본·영어권 비교는 거주 국가가 아닌 <strong>처음 기록된 이용 언어</strong> 기준입니다. 전체 {n(s.totalaccounts)}명 중 {n(s.classifiedaccounts)}명({rate(percent(s.classifiedaccounts,s.totalaccounts))})만 분류되었습니다. 나머지는 ‘분류 안 됨’에 포함됩니다. 언어별 수치를 국가 전체 성과로 해석하지 마세요.</div>
  <div className={styles.moneyGrid}>{['KRW','JPY','USD'].map(currency=><Card key={currency} label={`${{KRW:'원화',JPY:'엔화',USD:'달러'}[currency]} 승인 매출`} value={formatAmount(total(data,'gross',currency),currency)} hint={`환불 차감 전 · 승인 ${n(total(data,'payments',currency))}건`} delta={delta('gross',currency)}/>)}</div>
  <div className={styles.panel}><table className={styles.moneyTable}><thead><tr><th>통화</th><th>승인 매출</th><th>누적 환불·차지백</th><th>환불 차감 후</th></tr></thead><tbody>{['KRW','JPY','USD'].map(c=><tr key={c}><th>{c}</th><td>{formatAmount(total(data,'gross',c),c)}</td><td>{formatAmount(total(data,'refunds',c),c)}</td><td>{formatAmount(total(data,'gross',c)-total(data,'refunds',c),c)}</td></tr>)}</tbody></table><p className={styles.muted}>통화를 합산하지 않습니다. 환불은 선택 기간에 결제된 주문의 현재 누적 차감액입니다. 해당 기간의 환불 현금 흐름·정산액과 다릅니다.</p></div>
  <div className={styles.metricGrid}>
   <Card label="새로 가입한 회원" value={`${n(total(data,'signups'))}명`} hint="기간 내 가입 계정" delta={delta('signups')}/><Card label="탈퇴한 회원" value={`${n(total(data,'withdrawals'))}명`} hint="기간 내 탈퇴 처리 계정" delta={delta('withdrawals')}/><Card label="만들어진 쇼츠" value={`${n(total(data,'shorts'))}개`} hint="결과 파일 생성 기록 · 예제 제외" delta={delta('shorts')}/><Card label="온보딩 완료" value={`${n(total(data,'onboarding'))}명`} hint="가입 설문을 마친 회원" delta={delta('onboarding')}/><Card label="구독 해지 요청률" value={rate(percent(s.cancelrequests,s.exposed))} hint={`기간 내 구독 ${n(s.exposed)}건 중 해지 요청 ${n(s.cancelrequests)}건`} delta={data.previousStart?`이전 기간 ${rate(percent(s.previouscancelrequests,s.previousexposed))}`:undefined}/><Card label="구독 이용 종료" value={`${n(total(data,'ended'))}건`} hint="종료일 기록 기준 · 만료 포함" delta={delta('ended')}/>
  </div><div className={styles.takeaway}><b>회의에서 먼저 볼 숫자</b><p>가입 {n(total(data,'signups'))}명 − 탈퇴 {n(total(data,'withdrawals'))}명 = 순증 {n(total(data,'signups')-total(data,'withdrawals'))}명. 제작 요청 {n(total(data,'projects'))}건, 완료 기록 {n(total(data,'completedProjects'))}건입니다. 요청일과 완료일이 달라 두 수치의 비율은 성공률이 아닙니다.</p></div>
 </section>
 <section className={styles.reportPage}><div className={styles.sectionHeading}><span className={styles.kicker}>TRENDS</span><h2>02. 성장 속도를 살펴보세요</h2><p>{grain==='week'?'월요일 시작 주간':'달력 기준 월간'} 합계 · 첫 구간과 마지막 구간은 일부 날짜만 포함될 수 있습니다. 오늘은 진행 중입니다.</p></div>
 <div className={styles.twoColumns}><Trend data={data} metric="gross" title={`${chartCurrency} 승인 매출`} currency={chartCurrency} grain={grain}/><Trend data={data} metric="signups" title="신규 가입" grain={grain}/><Trend data={data} metric="shorts" title="쇼츠 제작" grain={grain}/><Trend data={data} metric="cancellations" title="구독 해지 요청" grain={grain}/></div>
 <div className={styles.sectionHeading}><h3>현재 상태도 함께 보세요</h3><p>선택 기간 합계가 아닌 집계 시점의 상태입니다. 이용 언어 조건은 적용됩니다.</p></div><div className={styles.snapshotGrid}><Card label="현재 회원" value={`${n(s.members)}명`} hint="탈퇴하지 않은 계정"/><Card label="활성 유료 구독" value={`${n(s.active)}건`} hint={`연체 ${n(s.pastdue)}건 · 해지 예약 ${n(s.cancelscheduled)}건`}/><Card label="연결된 유튜브 채널" value={`${n(s.channels)}개`} hint={`${n(s.channelmembers)}명의 현재 연결 · 과거 증가량 아님`}/></div></section>
 <section className={styles.reportPage}><div className={styles.sectionHeading}><span className={styles.kicker}>CUSTOMERS</span><h2>03. 어떤 고객이, 왜 사용하나요?</h2><p>기간 내 온보딩 완료 회원의 응답입니다. 응답 수정 시 과거 집계도 달라질 수 있습니다.</p></div><div className={styles.twoColumns}><Breakdown data={data} category="occupation" title="어떤 일을 하나요?" hint="직업별 응답 · 응답자 중 비율"/><Breakdown data={data} category="discovery" title="어디에서 알게 됐나요?" hint="유입 경로 · 응답자 중 비율"/><Breakdown data={data} category="purpose" title="무엇을 만들고 싶나요?" hint="복수 선택 · 전체 선택 횟수 중 비율"/><Breakdown data={data} category="reason" title="왜 구독을 해지하나요?" hint="해지 설문 응답 중 비율 · 모든 해지의 이유는 아님"/></div></section>
 <section className={styles.reportPage}><div className={styles.sectionHeading}><span className={styles.kicker}>READING GUIDE</span><h2>04. 숫자를 정확하게 읽는 방법</h2><p>이 페이지까지 함께 공유하면 같은 기준으로 이야기할 수 있습니다.</p></div><div className={styles.twoColumns}><Breakdown data={data} category="outputLanguage" title="어떤 언어의 영상을 요청했나요?" hint="프로젝트 출력 언어 · 거주 국가와 다름"/><article className={styles.panel}><h3>기록이 시작된 시점</h3><dl className={styles.definitions}>{[['회원 가입',s.memberssince],['온보딩 응답',s.onboardingsince],['해지 사유 응답',s.reasonssince],['이용 언어',s.languagesince]].map(([label,date])=><div key={label}><dt>{label}</dt><dd>{date?new Date(date).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}):'기록 없음'}</dd></div>)}</dl><p className={styles.muted}>기록 시작 이전의 0은 ‘활동이 없었다’는 뜻이 아닙니다. 전체 기간도 DB에 남은 기록만 포함합니다.</p></article></div>
 <article className={styles.panel}><dl className={styles.definitions}>
 <div><dt>기간과 비교</dt><dd>한국시간 자정 기준, 오늘 포함 최근 7·30·90일. 직전 같은 일수와 비교합니다. 오늘은 부분 집계이고 전체 기간에는 비교값이 없습니다. 주간은 월요일부터, 월간은 매월 1일부터입니다.</dd></div>
 <div><dt>매출</dt><dd>국내 승인 내역과 운영용 Paddle·PayPal 결제 기록입니다. 국내는 승인일, 해외 정기 결제는 기록 수신일, PayPal 단건 결제는 완료일 기준입니다. 통화는 국가를 뜻하지 않습니다.</dd></div>
 <div><dt>구독 해지 요청률</dt><dd>기간 중 존재한 유료 구독 중 해당 기간에 마지막 해지 요청이 기록된 구독의 비율입니다. 신규 구독도 분모에 포함해 일반적인 기초 구독자 이탈률과 다릅니다. 해지 요청 뒤 이용 기간이 남을 수 있습니다. 반복 해지·철회 이력 전체는 복원할 수 없습니다.</dd></div>
 <div><dt>쇼츠 제작</dt><dd>결과 파일과 크기가 기록된 쇼츠를 최초 생성일로 셉니다. 만료·삭제된 파일도 DB 기록이 남으면 포함하며 재편집은 중복 계산하지 않습니다. 예제와 회원에 연결되지 않은 작업은 제외합니다.</dd></div>
 <div><dt>언어 구분</dt><dd>운영에서 처음 관측한 이용 언어로 회원을 분류합니다. 기록 없는 회원을 한국으로 가정하지 않습니다. 분류된 회원의 과거 활동에도 같은 분류가 적용됩니다.</dd></div>
 <div><dt>유튜브 연결과 미집계 항목</dt><dd>현재 활성 채널 수입니다. 최초 연결일·해제 이력이 충분하지 않아 기간별 신규 연결 수는 표시하지 않습니다. 과거 활성 구독 수·방문자 수·광고 효율도 추정하지 않습니다.</dd></div>
 </dl></article><footer className={styles.footer}>EASY CUT · 관리자 회의 보고서 · {rangeLabel}<br/>집계 {new Date(data.generatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · 이메일·이름·결제번호 등 개인 식별 정보는 포함하지 않습니다.</footer></section>
 </div>}</div>;
}
