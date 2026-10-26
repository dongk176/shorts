"use client";
import { useState, type CSSProperties } from "react";
import type { OverseasData } from "@/lib/admin-overseas-contract";
import { AdminSalesCard } from "../admin-sales-card";
import { AdminTrendCard } from "../admin-trend-card";
import shell from "../admin-shell.module.css";
import styles from "./overseas.module.css";

const endpoint = "/api/admin/overseas/trends";
export function OverseasOverview({data}: {data:OverseasData}) {
  const [currency,setCurrency] = useState<"USD"|"JPY">("USD");
  const sale=data.sales.find(row=>row.currency===currency)!;
  const metrics=data.metrics;
  const count=(value:number)=>value.toLocaleString("ko-KR");
  const cards=[
    {label:"해외 회원",value:`${count(metrics.members)}명`,hint:`오늘 신규 ${count(metrics.todayMembers)}명`,color:"#68a5ff"},
    {label:"활성 구독",value:`${count(metrics.activeSubscriptions)}건`,hint:`연체 ${count(metrics.pastDueSubscriptions)}건`,color:"#56d6b0"},
    {label:"누적 해외 결제",value:`${count(data.sales.reduce((sum,row)=>sum+row.orders,0))}건`,hint:`해외 제작 ${count(metrics.projects)}건`,color:"#f2a65f"},
  ];
  const statuses=[
    {label:"정상 활성",value:metrics.activeSubscriptions,color:"#55d6af"},
    {label:"연체",value:metrics.pastDueSubscriptions,color:"#f6b85e"},
    {label:"해지·기타",value:metrics.inactiveSubscriptions,color:"#9d85ff"},
  ];
  const total=Math.max(1,statuses.reduce((sum,row)=>sum+row.value,0));
  const icon=<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/></svg>;
  return <>
    <div className={styles.currencyBar}><span>매출 통화</span><div role="group" aria-label="해외 매출 통화">{(["USD","JPY"] as const).map(value=><button key={value} type="button" aria-pressed={currency===value} onClick={()=>setCurrency(value)}>{value==="USD"?"미국 달러 · USD":"일본 엔 · JPY"}</button>)}</div></div>
    <div className={shell.metricGrid} aria-label="해외 운영 요약">
      <AdminSalesCard key={`${currency}-all`} period="all" currency={currency} grossSales={sale.gross} refundedSales={sale.refunded+sale.chargeback} icon={icon}/>
      <AdminSalesCard key={`${currency}-today`} period="today" currency={currency} grossSales={sale.today} refundedSales={sale.todayDeductions} icon={icon}/>
      {cards.map(card=><article className={shell.metricCard} key={card.label} style={{"--metric-color":card.color} as CSSProperties}><div className={shell.metricTop}><p className={shell.metricLabel}>{card.label}</p><span className={shell.metricIcon}>{icon}</span></div><p className={shell.metricValue}>{card.value}</p><p className={shell.metricHint}>{card.hint}</p></article>)}
    </div>
    <div className={`${shell.analyticsGrid} ${styles.analytics}`}>
      <AdminTrendCard key={currency} initialData={data.salesTrends[currency]} endpoint={endpoint} currency={currency} heading={`해외 매출 · ${currency}`}/>
      <AdminTrendCard initialData={data.memberTrend} endpoint={endpoint} heading="해외 회원 수 추이"/>
      <article className={`${shell.analyticsCard} ${shell.subscriptionCard}`}><h3 className={shell.cardTitle}>구독 상태 분포</h3><div className={shell.statusList}>{statuses.map(status=><div key={status.label}><div className={shell.statusMeta}><span>{status.label}</span><strong>{count(status.value)}건</strong></div><div className={shell.statusTrack}><div className={shell.statusBar} style={{"--status-color":status.color,width:`${status.value/total*100}%`} as CSSProperties}/></div></div>)}</div></article>
    </div>
  </>;
}
