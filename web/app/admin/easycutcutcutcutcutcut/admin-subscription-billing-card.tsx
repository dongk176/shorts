"use client";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { kstDate, shiftTrendDate } from "@/lib/admin-trends";
import { subscriptionProduct, summarizeSubscriptionBilling, type SubscriptionBillingData } from "@/lib/admin-subscription-billing-contract";
import styles from "./admin-shell.module.css";
import filters from "./admin-subscription-billing-card.module.css";

const periods = { today: "오늘", tomorrow: "내일", "7d": "앞으로 7일", "30d": "앞으로 30일", month: "이번 달 남은 기간", nextMonth: "다음 달", all: "전체 예정", date: "날짜 선택", custom: "기간 선택" };
export function AdminSubscriptionBillingCard({ icon }: { icon: ReactNode }) {
  const [data, setData] = useState<SubscriptionBillingData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState("all");
  const [period, setPeriod] = useState<keyof typeof periods>("today");
  const [months, setMonths] = useState("all");
  const [selectedDate, setSelectedDate] = useState(kstDate());
  const [start, setStart] = useState(kstDate());
  const [end, setEnd] = useState(kstDate());
  const root = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null), first = useRef<HTMLSelectElement>(null);
  const id = useId();
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => { setError(true); controller.abort(); }, 15000);
    setError(false);
    fetch("/api/admin/overview?view=subscription-billing", { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<SubscriptionBillingData>; })
      .then(value => { if (!disposed) setData(value); }).catch(() => { if (!disposed) setError(true); })
      .finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const today = data?.today ?? kstDate();
  const nextMonth = shiftTrendDate(`${today.slice(0,7)}-01`, 32).slice(0,7);
  const nextMonthEnd = shiftTrendDate(`${nextMonth}-01`, 32).slice(0,7);
  const from = period === "date" ? selectedDate : period === "custom" ? start : period === "tomorrow" ? shiftTrendDate(today,1) : period === "nextMonth" ? `${nextMonth}-01` : today;
  const to = period === "date" ? selectedDate : period === "all" ? "" : period === "custom" ? end : period === "tomorrow" ? from : period === "7d" ? shiftTrendDate(today,6) : period === "30d" ? shiftTrendDate(today,29) : period === "month" ? shiftTrendDate(`${nextMonth}-01`,-1) : period === "nextMonth" ? shiftTrendDate(`${nextMonthEnd}-01`,-1) : today;
  const invalid = (period === "custom" && (!start || !end || start > end || start < today)) || (period === "date" && (!selectedDate || selectedDate < today));
  const rows = data?.rows ?? [];
  const products = [...new Map(rows.map(row => { const item = subscriptionProduct(row); return [item.code,item.name]; })).entries()]
    .sort(([a],[b]) => { const order = ["easycut_pro","starter","expert"]; return (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)) || a.localeCompare(b); });
  const terms = [...new Set(rows.filter(row => product === "all" || subscriptionProduct(row).code === product).map(row => row.months))].sort((a,b) => a-b);
  const summary = summarizeSubscriptionBilling(rows, product, from, to, months);
  const name = product === "all" ? "전체 상품" : products.find(([code]) => code === product)?.[1] ?? product;
  const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  return <article ref={root} className={`${styles.metricCard} ${styles.salesCard} ${open ? styles.salesCardOpen : ""}`}
    style={{ "--metric-color": "#5fd1b3" } as CSSProperties}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
    <div className={styles.metricTop}>
      <button ref={trigger} type="button" className={styles.salesTrigger} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
        구독 결제 예정액<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m4 6 4 4 4-4" /></svg>
      </button><span className={styles.metricIcon}>{icon}</span>
    </div>
    {open && <div id={id} className={filters.panel} role="group" aria-label="구독 결제 예정액 조회 조건">
      <label>상품<select ref={first} value={product} onChange={event => { setProduct(event.target.value); setMonths("all"); }}><option value="all">전체 상품</option>{products.map(([code,label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label>이용 기간<select value={months} onChange={event => setMonths(event.target.value)}><option value="all">전체 기간</option>{terms.map(term => <option key={term} value={term}>{term}개월</option>)}</select></label>
      <label>결제 예정일 · 한국시간<select value={period} onChange={event => setPeriod(event.target.value as keyof typeof periods)}>{Object.entries(periods).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {period === "date" && <label>날짜<input type="date" value={selectedDate} min={today} onChange={event => setSelectedDate(event.target.value)} /></label>}
      {period === "custom" && <div className={filters.dates}><label>시작일<input type="date" value={start} min={today} onChange={event => setStart(event.target.value)} /></label><label>종료일<input type="date" value={end} min={today} onChange={event => setEnd(event.target.value)} /></label></div>}
      <p>활성 구독에 등록된 다음 결제 1회씩 합산해요. 해지 예약·결제 중지·해외 결제는 제외하며, 예정된 상품 변경은 반영해요.</p>
      <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>완료</button>
    </div>}
    <p className={styles.metricValue} aria-live="polite">{invalid ? "기간 확인" : error ? "조회 실패" : !data ? "불러오는 중…" : money(summary.amount)}</p>
    <p className={styles.metricHint}>{invalid ? "선택한 날짜를 확인해 주세요." : `${name}${months === "all" ? "" : ` ${months}개월`} · ${period === "date" ? selectedDate : period === "custom" ? `${start} ~ ${end}` : periods[period]} · 예정 ${summary.count}건`}</p>
    <p className={styles.metricHint}>국내 자동결제 예정 · 실제 결제액은 달라질 수 있어요</p>
    {error && <button type="button" className={styles.serviceLink} onClick={() => setAttempt(value => value+1)}>다시 시도</button>}
  </article>;
}
