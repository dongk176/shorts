"use client";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { kstDate, shiftTrendDate } from "@/lib/admin-trends";
import { summarizeSubscriptionBilling, type SubscriptionBillingData } from "@/lib/admin-subscription-billing-contract";
import styles from "./admin-shell.module.css";
import filters from "./admin-subscription-billing-card.module.css";

const periods = { month: "이번 달", today: "오늘", "7d": "최근 7일", "30d": "최근 30일", all: "전체 기간", custom: "직접 선택" };
export function AdminSubscriptionBillingCard({ icon }: { icon: ReactNode }) {
  const [data, setData] = useState<SubscriptionBillingData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState("all");
  const [period, setPeriod] = useState<keyof typeof periods>("month");
  const [net, setNet] = useState(false);
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
  const from = period === "all" ? "" : period === "custom" ? start : period === "month" ? `${today.slice(0,7)}-01` : period === "today" ? today : shiftTrendDate(today, period === "7d" ? -6 : -29);
  const to = period === "custom" ? end : today;
  const invalid = period === "custom" && (!start || !end || start > end);
  const rows = data?.rows ?? [];
  const products = [...new Map(rows.map(row => [row.productCode, row.productName])).entries()];
  const summary = summarizeSubscriptionBilling(rows, product, from, to);
  const name = product === "all" ? "전체 상품" : products.find(([code]) => code === product)?.[1] ?? product;
  const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  return <article ref={root} className={`${styles.metricCard} ${styles.salesCard} ${open ? styles.salesCardOpen : ""}`}
    style={{ "--metric-color": "#5fd1b3" } as CSSProperties}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
    <div className={styles.metricTop}>
      <button ref={trigger} type="button" className={styles.salesTrigger} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
        활성 구독 {net ? "순결제액" : "결제액"}<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m4 6 4 4 4-4" /></svg>
      </button><span className={styles.metricIcon}>{icon}</span>
    </div>
    {open && <div id={id} className={filters.panel} role="group" aria-label="활성 구독 결제액 조회 조건">
      <label>결제 상품<select ref={first} value={product} onChange={event => setProduct(event.target.value)}><option value="all">전체 상품</option>{products.map(([code,label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label>결제일 기준 · 한국시간<select value={period} onChange={event => setPeriod(event.target.value as keyof typeof periods)}>{Object.entries(periods).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {period === "custom" && <div className={filters.dates}><label>시작일<input type="date" value={start} max={end || today} onChange={event => setStart(event.target.value)} /></label><label>종료일<input type="date" value={end} min={start} max={today} onChange={event => setEnd(event.target.value)} /></label></div>}
      <label>금액 기준<select value={net ? "net" : "gross"} onChange={event => setNet(event.target.value === "net")}><option value="gross">실결제액 · 환불 차감 전</option><option value="net">순결제액 · 환불 차감 후</option></select></label>
      <p>현재 이용 기간이 유효한 활성 구독의 국내 승인 결제만 합산합니다. 월 환산액이 아니며, 해외 결제·추가 크레딧은 제외됩니다.</p>
      <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>완료</button>
    </div>}
    <p className={styles.metricValue} aria-live="polite">{invalid ? "기간 확인" : error ? "조회 실패" : !data ? "불러오는 중…" : money(net ? summary.gross-summary.refunded : summary.gross)}</p>
    <p className={styles.metricHint}>{invalid ? "시작일과 종료일을 확인해 주세요." : `${name} · ${period === "custom" ? `${start} ~ ${end}` : periods[period]} · 승인 ${summary.count}건`}</p>
    <p className={styles.metricHint}>{net ? `해당 결제의 환불 ${money(summary.refunded)} 차감` : "국내 실제 승인액 · 환불 차감 전"}</p>
    {error && <button type="button" className={styles.serviceLink} onClick={() => setAttempt(value => value+1)}>다시 시도</button>}
  </article>;
}
