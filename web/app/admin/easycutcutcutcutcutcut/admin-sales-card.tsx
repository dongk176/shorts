"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./admin-shell.module.css";
import { formatAdminCurrency } from "@/lib/admin-paddle-contract";

export function AdminSalesCard({
  period, grossSales, refundedSales, icon, currency,
}: {
  period: "all" | "today";
  grossSales: number;
  refundedSales: number;
  icon: ReactNode;
  currency?: "USD" | "JPY";
}) {
  const [net, setNet] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const labels = currency
    ? period === "today" ? ["오늘 해외 매출", "오늘 해외 순매출"] : ["누적 해외 매출", "해외 순매출"]
    : period === "today" ? ["오늘 국내 매출", "오늘 국내 순매출"] : ["누적 국내 매출", "국내 순매출"];
  const selected = net ? 1 : 0;
  const money = (value: number) => currency ? formatAdminCurrency(value, currency) : `${value.toLocaleString("ko-KR")}원`;

  useEffect(() => {
    if (!open) return;
    options.current[selected]?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, selected]);

  return (
    <article
      ref={root}
      className={`${styles.metricCard} ${styles.salesCard} ${open ? styles.salesCardOpen : ""}`}
      style={{ "--metric-color": period === "today" ? "#56d6b0" : "#a991ff" } as CSSProperties}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <div className={styles.metricTop}>
        <div className={styles.salesSelect}>
          <button
            ref={trigger}
            id={`${id}-trigger`}
            type="button"
            className={styles.salesTrigger}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? `${id}-options` : undefined}
            onClick={() => setOpen((current) => !current)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            {labels[selected]}
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
          {open && (
            <div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-trigger`} className={styles.salesOptions}>
              {labels.map((label, index) => (
                <button
                  key={label}
                  ref={(element) => { options.current[index] = element; }}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected === index}
                  className={styles.salesOption}
                  onClick={() => {
                    setNet(index === 1);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                  onKeyDown={(event) => {
                    let next: number;
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") next = 1 - index;
                    else if (event.key === "Home") next = 0;
                    else if (event.key === "End") next = 1;
                    else return;
                    event.preventDefault();
                    options.current[next]?.focus();
                  }}
                >
                  <span>{label}</span>
                  {selected === index && (
                    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <path d="m3 8 3 3 7-7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={styles.metricIcon}>{icon}</span>
      </div>
      <p className={styles.metricValue} aria-live="polite">{money(net ? grossSales - refundedSales : grossSales)}</p>
      <p className={styles.metricHint}>
        {net
          ? `${period === "today" ? currency ? "오늘 결제 건의" : "오늘 승인 건의" : "누적"} ${currency ? "환불·차지백" : "환불"} ${money(refundedSales)} 차감`
          : currency ? (period === "today" ? "KST 자정 이후 기록 · 환불 차감 전" : "전체 실결제 금액 · 환불 차감 전") : period === "today" ? "KST 자정 이후 승인 · 환불 차감 전" : "전체 승인 금액 · 환불 차감 전"}
      </p>
    </article>
  );
}
