"use client";

import { useEffect, useRef, useState } from "react";
import { AdminBillingCalendar, billingMoney } from "../admin-billing-calendar";
import { currentBillingMonth, type BillingCurrency } from "@/lib/admin-billing-calendar";
import { paddleAdminProduct } from "@/lib/admin-paddle-contract";
import type { OverseasBillingData } from "@/lib/admin-overseas-billing";
import styles from "../admin-billing.module.css";
import overseas from "./overseas.module.css";

const labels: Record<string,string> = { completed:"승인",refunded:"환불 완료",partially_refunded:"부분 환불",chargeback:"차지백" };
export function OverseasBilling({ initialQuery = "" }: { initialQuery?: string }) {
  const [month, setMonth] = useState(currentBillingMonth);
  const [currency, setCurrency] = useState<BillingCurrency>("USD");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [filters, setFilters] = useState({ provider:"all",query:initialQuery });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OverseasBillingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const selectDay = (day: string | null) => {
    setSelectedDay(day); setPage(1);
    if (day) requestAnimationFrame(() => { heading.current?.scrollIntoView({behavior:"smooth",block:"start"}); heading.current?.focus({preventScroll:true}); });
  };
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(),8_000);
    setLoading(true); setError(null); setData(null);
    const params = new URLSearchParams({month,currency,provider:filters.provider,q:filters.query,page:String(page)});
    if (selectedDay) params.set("day",selectedDay);
    void fetch(`/api/admin/overseas/billing?${params}`,{credentials:"same-origin",cache:"no-store",signal:controller.signal})
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.rows)) throw new Error(result.detail || "해외 결제를 불러오지 못했습니다.");
        if (active) setData(result);
      }).catch(cause => {
        if (active) setError(controller.signal.aborted ? "응답이 늦어 조회를 중단했어요. 다시 시도해 주세요." : cause instanceof Error ? cause.message : "해외 결제를 불러오지 못했습니다.");
      }).finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active=false; window.clearTimeout(timeout); controller.abort(); };
  },[month,currency,filters,selectedDay,page,attempt]);
  return <div className={styles.dashboard}>
    <div className={styles.intro}><div><h2>해외 매출 흐름을 한눈에</h2><p>통화별 매출을 확인하고, 날짜를 눌러 결제 내역을 살펴보세요.</p></div><span>해외 결제 전용 · KST</span></div>
    <form className={styles.filters} onSubmit={event => {
      event.preventDefault(); const values=new FormData(event.currentTarget);
      setFilters({provider:String(values.get("provider") || "all"),query:String(values.get("q") || "").trim()});
      setSelectedDay(null); setPage(1);
    }}>
      <span className={styles.filterLabel}>조회 조건</span>
      <input aria-label="해외 결제 검색" name="q" type="search" maxLength={100} defaultValue={initialQuery} placeholder="이메일·이름·상품·거래번호" className="h-10 rounded-xl border border-white/10 px-3 text-sm" />
      <select aria-label="해외 결제사" name="provider" className="h-10 rounded-xl border border-white/10 bg-[#1b1e24] px-3 text-sm"><option value="all">모든 결제사</option><option value="paddle">Paddle</option><option value="paypal">PayPal</option></select>
      <button className="h-10 rounded-xl bg-[#3182f6] px-4 text-sm font-bold text-white">조회</button>
    </form>
    <AdminBillingCalendar overseas month={month} currency={currency} selectedDay={selectedDay} provider={filters.provider} query={filters.query}
      onMonthChange={value => {setMonth(value);setSelectedDay(null);setPage(1);}}
      onCurrencyChange={value => {setCurrency(value);setSelectedDay(null);setPage(1);}} onSelectDay={selectDay}/>
    <section className={overseas.panel} aria-busy={loading}>
      <div className={overseas.panelHeading}><div>
        <h2 ref={heading} tabIndex={-1} className="scroll-mt-28 outline-none">{selectedDay ? `${Number(selectedDay.slice(5,7))}월 ${Number(selectedDay.slice(8))}일 결제 내역` : "해외 결제 내역"}</h2>
        <p className={overseas.muted}>{loading ? "불러오는 중…" : error ? "조회하지 못했습니다" : `총 ${(data?.total || 0).toLocaleString("ko-KR")}건 · ${currency} · 환불된 결제 포함`}</p>
        {selectedDay && <button type="button" className={styles.clearDay} onClick={()=>selectDay(null)}>월 전체 내역 보기 ×</button>}
      </div><span className={overseas.pill}>{currency}</span></div>
      {error ? <div className={styles.calendarMessage} role="alert"><p>{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>다시 시도</button></div> : <div className={overseas.tableWrap}><table className={overseas.table}>
        <thead><tr><th>고객</th><th>상품 / 거래번호</th><th>상태</th><th>결제 금액</th><th>환불·차지백</th><th>승인 / 기록 시각 · KST</th></tr></thead>
        <tbody>{data?.rows.map(row=><tr key={row.id}>
          <td><strong>{row.name || row.email}</strong>{row.name && <small>{row.email}</small>}</td>
          <td><span className={overseas.rowLabel}>{paddleAdminProduct(row.label)}</span><small>{row.id}</small></td>
          <td><span className={overseas.status}>{labels[row.status] || row.status}</span></td>
          <td>{billingMoney(row.amount || 0,currency)}</td>
          <td>{billingMoney((row.refunded || 0)+(row.chargeback || 0),currency)}{(row.pending || 0)>0 && <small>환불 대기 {billingMoney(row.pending!,currency)}</small>}</td>
          <td>{new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"short",timeStyle:"short"}).format(new Date(row.createdAt))}</td>
        </tr>)}</tbody>
      </table>{!loading && !data?.rows.length && <div className={overseas.empty}><h3>조건에 맞는 결제 내역이 없어요</h3><p>다른 날짜나 조회 조건을 선택해 주세요.</p></div>}</div>}
      {data && data.pages>1 && <div className={overseas.pagination}><span>{data.page} / {data.pages} 페이지</span><div>
        <button type="button" disabled={data.page<=1 || loading} onClick={()=>setPage(data.page-1)}>← 이전</button>
        <button type="button" disabled={data.page>=data.pages || loading} onClick={()=>setPage(data.page+1)}>다음 →</button>
      </div></div>}
    </section>
  </div>;
}
