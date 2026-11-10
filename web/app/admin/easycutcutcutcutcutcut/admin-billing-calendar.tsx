"use client";

import { useEffect, useState } from "react";
import { billingCalendarCells, shiftBillingMonth, type BillingCalendarData, type BillingCurrency } from "@/lib/admin-billing-calendar";
import { kstDate } from "@/lib/admin-trends";
import styles from "./admin-billing.module.css";

export function billingMoney(value: number, currency: BillingCurrency) {
  return currency === "KRW" ? `${value.toLocaleString("ko-KR")}원`
    : new Intl.NumberFormat("ko-KR", { style: "currency", currency }).format(value / (currency === "USD" ? 100 : 1));
}

export function AdminBillingCalendar({ month, currency, selectedDay, provider, query, onMonthChange, onCurrencyChange, onSelectDay, overseas = false }: {
  overseas?: boolean;
  month: string; currency: BillingCurrency; selectedDay: string | null; provider: string; query: string;
  onMonthChange: (value: string) => void; onCurrencyChange: (value: BillingCurrency) => void;
  onSelectDay: (day: string | null) => void;
}) {
  const [data, setData] = useState<BillingCalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [metric, setMetric] = useState<"gross" | "net">("gross");
  const today = kstDate();
  const currentMonth = today.slice(0, 7);
  const monthLabel = `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
  const metricLabel = metric === "gross" ? "총매출" : "순매출";
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    setLoading(true);
    setData(null);
    setError(null);
    const params = new URLSearchParams({ month, currency, provider, q: query });
    void fetch(`${overseas ? "/api/admin/overseas/billing" : "/api/admin/billing/calendar"}?${params}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.days)) throw new Error(result.detail || "매출을 불러오지 못했습니다.");
        if (active) setData(result);
      }).catch(cause => {
        if (active) setError(controller.signal.aborted ? "응답이 늦어 조회를 중단했어요. 다시 시도해 주세요." : cause instanceof Error ? cause.message : "매출을 불러오지 못했습니다.");
      }).finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [month, currency, provider, query, attempt, overseas]);

  const ready = !loading && !error && data?.month === month && data.currency === currency;
  const days = new Map((ready ? data.days : []).map(day => [day.day, day]));
  const total = (ready ? data.days : []).reduce((sum, day) => ({ gross: sum.gross + day.gross, refunded: sum.refunded + day.refunded, count: sum.count + day.count }), { gross: 0, refunded: 0, count: 0 });
  const amount = (gross: number, refunded: number) => metric === "gross" ? gross : gross - refunded;
  const compactMoney = (value: number) => {
    if (currency === "KRW" && Math.abs(value) >= 10000) return `${(value / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만`;
    return new Intl.NumberFormat("ko-KR", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value / (currency === "USD" ? 100 : 1));
  };
  const summaries = [
    { label: `${Number(month.slice(5))}월 ${metricLabel}`, value: billingMoney(amount(total.gross, total.refunded), currency), hint: "선택한 통화 · 결제사 기준" },
    { label: "승인 결제", value: `${total.count.toLocaleString("ko-KR")}건`, hint: "환불된 결제 포함" },
    { label: "환불·차지백", value: billingMoney(total.refunded, currency), hint: "이 달 결제의 누적 차감액" },
    { label: "평균 결제 금액", value: billingMoney(total.count ? Math.round(total.gross / total.count) : 0, currency), hint: "총매출 ÷ 승인 결제 건수" },
  ];
  return <section className={styles.calendarCard} aria-label="월별 매출 달력" aria-busy={loading}>
    <div className={styles.calendarHeading}>
      <div className={styles.monthNavigation}>
        <h2>{monthLabel}</h2>
        <button type="button" aria-label="이전 달" disabled={month <= "2000-01"} onClick={() => onMonthChange(shiftBillingMonth(month, -1))}>‹</button>
        <button type="button" aria-label="다음 달" disabled={month >= currentMonth} onClick={() => onMonthChange(shiftBillingMonth(month, 1))}>›</button>
        <button type="button" className={styles.thisMonth} onClick={() => onMonthChange(currentMonth)}>이번 달</button>
      </div>
      <div className={styles.calendarControls}>
        <label className={styles.monthPicker}>월 선택<input aria-label="조회 월" type="month" value={month} min="2000-01" max={currentMonth} onChange={event => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value) && event.target.value <= currentMonth) onMonthChange(event.target.value); }} /></label>
        <select aria-label="매출 통화" value={currency} onChange={event => onCurrencyChange(event.target.value as BillingCurrency)}>
          {!overseas && <option value="KRW">국내 · KRW</option>}<option value="USD">해외 · USD</option><option value="JPY">해외 · JPY</option>
        </select>
      </div>
    </div>
    <div className={styles.summaryGrid} aria-live="polite">{summaries.map((summary, index) => <div className={styles.summary} key={summary.label}>
      <p>{summary.label}</p><strong className={index === 0 ? styles.primaryValue : undefined}>{ready ? summary.value : "—"}</strong><small>{summary.hint}</small>
    </div>)}</div>
    <div className={styles.calendarToolbar}>
      <div className={styles.segmented} aria-label="매출 표시 기준">{(["gross", "net"] as const).map(value => <button type="button" key={value} aria-pressed={metric === value} onClick={() => setMetric(value)}>{value === "gross" ? "총매출" : "순매출"}</button>)}</div>
      <p><span className={styles.legendDot} />{metricLabel}<span className={styles.toolbarHint}> · 금액을 누르면 결제 내역을 볼 수 있어요</span></p>
    </div>
    {error ? <div className={styles.calendarMessage} role="alert"><strong>매출을 확인하지 못했어요</strong><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></div> : <>
      {loading && <p className={styles.loading} role="status">매출을 불러오는 중…</p>}
      <div className={styles.calendarScroll}>
        <div className={styles.calendarGrid}>
          {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => <div key={day} className={`${styles.weekday} ${index === 0 ? styles.sunday : index === 6 ? styles.saturday : ""}`}>{day}</div>)}
          {billingCalendarCells(month).map((day, index) => {
            const outside = !day.startsWith(month);
            const future = day > today;
            const row = days.get(day);
            const value = amount(row?.gross || 0, row?.refunded || 0);
            return <div key={day} className={`${styles.day} ${outside ? styles.outside : ""} ${selectedDay === day ? styles.selectedDay : ""}`}>
              <div className={`${styles.dayHeading} ${index % 7 === 0 ? styles.sunday : index % 7 === 6 ? styles.saturday : ""}`}><span>{Number(day.slice(8))}</span>{day === today && <span className={styles.today}>오늘</span>}</div>
              {!outside && <button type="button" className={`${styles.dayAmount} ${!row?.count ? styles.zero : ""}`} disabled={!ready || future} aria-pressed={selectedDay === day} aria-label={`${day} ${metricLabel} ${billingMoney(value, currency)}, 결제 ${row?.count || 0}건 내역 보기`} onClick={() => onSelectDay(day)}>
                <strong title={ready && !future ? billingMoney(value, currency) : undefined}><span className={styles.fullAmount}>{!ready || future ? "—" : billingMoney(value, currency)}</span><span className={styles.compactAmount}>{!ready || future ? "—" : compactMoney(value)}</span></strong>
                {ready && !future && <span>{row?.count ? `${row.count.toLocaleString("ko-KR")}건` : "결제 없음"}</span>}
              </button>}
            </div>;
          })}
        </div>
      </div>
    </>}
    <div className={styles.calendarFootnote}><p>한국 시간(KST) 기준 · {!overseas && "국내는 승인일, "}Paddle은 결제 기록 수신일, PayPal은 결제 완료일 기준입니다.</p><p>순매출은 해당 결제의 누적 환불·차지백을 차감한 금액입니다. 정산액과 다르며, 환불 대기 금액은 차감하지 않습니다.</p></div>
  </section>;
}
