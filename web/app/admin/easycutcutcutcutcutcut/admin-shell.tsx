"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./admin-shell.module.css";

export type AdminTab =
  | "billing"
  | "refunds"
  | "members"
  | "managed-accounts"
  | "referrals"
  | "partner-applications"
  | "inquiries"
  | "feedback"
  | "onboarding"
  | "creator-projects"
  | "settings"
  | "editor-releases"
  | "installments";

export type AdminSalesTrendPoint = {
  date: string;
  sales: number;
  orderCount: number;
};

export type AdminMemberTrendPoint = {
  date: string;
  memberCount: number;
};

type AdminMetrics = {
    grossSales: number;
    refundedSales: number;
    todaySales: number;
    paidOrders: number;
    orderReviewCount: number;
    activeSubscriptions: number;
    pastDueSubscriptions: number;
    manualReviewSubscriptions: number;
    activeProSubscriptions: number;
    activeSubscriptionBillingKrw: number;
};

type AdminOverviewData = {
  metrics: AdminMetrics;
  salesTrend: AdminSalesTrendPoint[];
  memberTrend: AdminMemberTrendPoint[];
};

type AdminShellProps = {
  activeTab: AdminTab;
  adminEmail: string;
  children: ReactNode;
};

const emptyMetrics: AdminMetrics = {
  grossSales: 0,
  refundedSales: 0,
  todaySales: 0,
  paidOrders: 0,
  orderReviewCount: 0,
  activeSubscriptions: 0,
  pastDueSubscriptions: 0,
  manualReviewSubscriptions: 0,
  activeProSubscriptions: 0,
  activeSubscriptionBillingKrw: 0,
};

type IconName =
  | "billing"
  | "refunds"
  | "members"
  | "accounts"
  | "referrals"
  | "partner-applications"
  | "inquiries"
  | "feedback"
  | "onboarding"
  | "creator-projects"
  | "settings"
  | "editor-releases"
  | "installments";

const navigationGroups: Array<{
  label: string;
  items: Array<{ tab: AdminTab; label: string; icon: IconName }>;
}> = [
  {
    label: "Commerce",
    items: [
      { tab: "billing", label: "결제 관리", icon: "billing" },
      { tab: "refunds", label: "환불 운영", icon: "refunds" },
      { tab: "installments", label: "할부 혜택", icon: "installments" },
    ],
  },
  {
    label: "Customers",
    items: [
      { tab: "members", label: "회원 관리", icon: "members" },
      { tab: "managed-accounts", label: "발급 계정", icon: "accounts" },
      { tab: "referrals", label: "레퍼럴", icon: "referrals" },
      { tab: "partner-applications", label: "파트너 신청", icon: "partner-applications" },
      { tab: "inquiries", label: "고객 문의", icon: "inquiries" },
      { tab: "feedback", label: "제품 피드백", icon: "feedback" },
      { tab: "onboarding", label: "온보딩 분석", icon: "onboarding" },
      { tab: "creator-projects", label: "크리에이터 프로젝트", icon: "creator-projects" },
    ],
  },
  {
    label: "System",
    items: [
      { tab: "editor-releases", label: "편집기 릴리스", icon: "editor-releases" },
      { tab: "settings", label: "운영 설정", icon: "settings" },
    ],
  },
];

const pageCopy: Record<AdminTab, { eyebrow: string; title: string }> = {
  billing: { eyebrow: "Commerce / Payments", title: "결제 운영" },
  refunds: { eyebrow: "Commerce / Refunds", title: "환불 운영" },
  members: { eyebrow: "Customers / Members", title: "회원 관리" },
  "managed-accounts": { eyebrow: "Customers / Accounts", title: "발급 계정" },
  referrals: { eyebrow: "Growth / Referrals", title: "레퍼럴 운영" },
  "partner-applications": { eyebrow: "Growth / Partner applications", title: "파트너 신청" },
  inquiries: { eyebrow: "Support / Inquiries", title: "고객 문의" },
  feedback: { eyebrow: "Insights / Feedback", title: "제품 피드백" },
  onboarding: { eyebrow: "Insights / Onboarding", title: "온보딩 분석" },
  "creator-projects": { eyebrow: "Growth / Creator outreach", title: "크리에이터 프로젝트" },
  settings: { eyebrow: "System / Runtime", title: "운영 설정" },
  "editor-releases": { eyebrow: "System / Editor releases", title: "편집기 릴리스" },
  installments: { eyebrow: "Commerce / Installments", title: "할부 혜택" },
};

function AdminIcon({ name, className }: { name: IconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "billing") {
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3" /></svg>;
  }
  if (name === "refunds") {
    return <svg {...common}><path d="M4 9V4m0 0h5M4 4l5 5" /><path d="M5.3 13a7 7 0 1 0 2-6.1" /></svg>;
  }
  if (name === "members") {
    return <svg {...common}><path d="M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19" /><circle cx="9.5" cy="7" r="3" /><path d="M16 4.5a3 3 0 0 1 0 5.8M21 19v-1.5a4 4 0 0 0-3-3.7" /></svg>;
  }
  if (name === "accounts") {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2.2" /><path d="M5.8 16c.7-1.8 1.8-2.7 3.2-2.7s2.5.9 3.2 2.7M15 9h3M15 13h3" /></svg>;
  }
  if (name === "referrals") {
    return <svg {...common}><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6m-7.6 6 7.6 3.6" /></svg>;
  }
  if (name === "partner-applications") {
    return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h5M8 16h3" /><path d="m15 16 1.5 1.5L19 15" /></svg>;
  }
  if (name === "inquiries") {
    return <svg {...common}><path d="M20 15a4 4 0 0 1-4 4H8l-5 2V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></svg>;
  }
  if (name === "feedback") {
    return <svg {...common}><path d="M12 3.7 14.5 9l5.7.7-4.2 4 1.1 5.6-5.1-2.8-5.1 2.8L8 13.7l-4.2-4L9.5 9Z" /></svg>;
  }
  if (name === "onboarding") {
    return <svg {...common}><path d="M5 20V10m7 10V4m7 16v-7" /><path d="m3 7 6-4 5 4 7-5" /></svg>;
  }
  if (name === "creator-projects") {
    return <svg {...common}><path d="M8 7h8M8 11h5" /><rect x="3" y="3" width="18" height="14" rx="3" /><path d="m9 17-2 4 5-4" /><path d="m16 14 4 4m0-4-4 4" /></svg>;
  }
  if (name === "settings") {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></svg>;
  }
  if (name === "editor-releases") {
    return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="8" cy="7" r="1.8" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="10" cy="17" r="1.8" fill="currentColor" stroke="none" /></svg>;
  }
  return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 9h10M7 13h4M15 13h2" /></svg>;
}

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function compactMoney(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
  return money(value);
}

type TrendChartPoint = {
  date: string;
  detailLabel: string;
  value: number;
  valueLabel: string;
  tooltip: string;
};

function TrendChart({
  ariaLabel,
  areaColor,
  data,
  gradientId,
  lineClassName,
  pointClassName,
}: {
  ariaLabel: string;
  areaColor: string;
  data: TrendChartPoint[];
  gradientId: string;
  lineClassName: string;
  pointClassName: string;
}) {
  const width = 760;
  const height = 260;
  const padding = { top: 82, right: 15, bottom: 10, left: 12 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...data.map((point) => point.value), 1);
  const coordinates = data.map((point, index) => {
    const x = padding.left + (data.length === 1 ? chartWidth / 2 : (index / (data.length - 1)) * chartWidth);
    const y = padding.top + chartHeight - (point.value / maxValue) * chartHeight;
    return { ...point, x, y };
  });
  const linePath = coordinates.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = coordinates.length
    ? `${linePath} L ${coordinates[coordinates.length - 1].x.toFixed(2)} ${(padding.top + chartHeight).toFixed(2)} L ${coordinates[0].x.toFixed(2)} ${(padding.top + chartHeight).toFixed(2)} Z`
    : "";
  const labelStep = data.length > 8 ? 3 : 1;

  return (
    <div className={styles.chartFrame}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={areaColor} stopOpacity="0.27" />
            <stop offset="100%" stopColor={areaColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + chartHeight * ratio;
          return <line key={ratio} className={styles.chartGrid} x1={padding.left} x2={width - padding.right} y1={y} y2={y} />;
        })}
        {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
        {linePath ? <path className={lineClassName} d={linePath} /> : null}
        {coordinates.map((point) => (
          <circle
            className={pointClassName}
            cx={point.x}
            cy={point.y}
            key={point.date}
            r="3.2"
          />
        ))}
      </svg>

      <div className={styles.chartHoverLayer}>
        {coordinates.map((point, index) => {
          const edgeClass = index === 0
            ? styles.chartHitColumnFirst
            : index === coordinates.length - 1
              ? styles.chartHitColumnLast
              : "";
          const hitAreaLeft = index === 0
            ? 0
            : (coordinates[index - 1].x + point.x) / 2;
          const hitAreaRight = index === coordinates.length - 1
            ? width
            : (point.x + coordinates[index + 1].x) / 2;
          return (
            <span
              aria-label={point.tooltip}
              className={`${styles.chartHitColumn} ${edgeClass}`}
              key={point.date}
              role="img"
              style={{
                "--chart-column-left": `${(hitAreaLeft / width) * 100}%`,
                "--chart-column-width": `${((hitAreaRight - hitAreaLeft) / width) * 100}%`,
                "--chart-point-position": `${((point.x - hitAreaLeft) / (hitAreaRight - hitAreaLeft)) * 100}%`,
                "--chart-tooltip-top": `${(point.y / height) * 100}%`,
              } as CSSProperties}
              tabIndex={0}
            >
              <span className={styles.chartTooltip}>
                <span className={styles.chartTooltipDate}>
                  {point.date.replaceAll("-", ".")}
                </span>
                <strong>{point.valueLabel}</strong>
                <span className={styles.chartTooltipDetail}>{point.detailLabel}</span>
              </span>
            </span>
          );
        })}
      </div>

      <div className={styles.chartDateLabels} aria-hidden="true">
        {coordinates.map((point, index) => {
          if (index % labelStep !== 0 && index !== coordinates.length - 1) return null;
          const edgeClass = index === 0
            ? styles.chartDateLabelFirst
            : index === coordinates.length - 1
              ? styles.chartDateLabelLast
              : "";
          return (
            <span
              className={`${styles.chartDateLabel} ${edgeClass}`}
              key={point.date}
              style={{
                "--chart-date-position": `${(point.x / width) * 100}%`,
              } as CSSProperties}
            >
              {point.date.slice(5).replace("-", ".")}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SalesTrendChart({ data }: { data: AdminSalesTrendPoint[] }) {
  return (
    <TrendChart
      ariaLabel="최근 14일 일별 매출 추이"
      areaColor="#9d85ff"
      data={data.map((point) => ({
        date: point.date,
        detailLabel: `${point.orderCount.toLocaleString("ko-KR")}건 승인`,
        value: point.sales,
        valueLabel: money(point.sales),
        tooltip: `${point.date} · 매출 ${money(point.sales)} · ${point.orderCount}건`,
      }))}
      gradientId="admin-sales-area"
      lineClassName={styles.chartLine}
      pointClassName={styles.chartPoint}
    />
  );
}

function MemberTrendChart({ data }: { data: AdminMemberTrendPoint[] }) {
  return (
    <TrendChart
      ariaLabel="최근 14일 일별 신규 회원 수 추이"
      areaColor="#56d6b0"
      data={data.map((point) => ({
        date: point.date,
        detailLabel: "신규 가입",
        value: point.memberCount,
        valueLabel: `${point.memberCount.toLocaleString("ko-KR")}명`,
        tooltip: `${point.date} · 신규 회원 ${point.memberCount.toLocaleString("ko-KR")}명`,
      }))}
      gradientId="admin-members-area"
      lineClassName={styles.memberChartLine}
      pointClassName={styles.memberChartPoint}
    />
  );
}

export function AdminShell({
  activeTab,
  adminEmail,
  children,
}: AdminShellProps) {
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    setOverviewError(null);
    void fetch("/api/admin/overview", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json() as AdminOverviewData & { detail?: string };
      if (!response.ok || !body.metrics) {
        throw new Error(body.detail || "운영 현황을 불러오지 못했습니다.");
      }
      setOverview(body);
    }).catch((cause) => {
      if (controller.signal.aborted) {
        setOverviewError("운영 현황 응답이 늦어 중단했습니다.");
      } else {
        setOverviewError(cause instanceof Error ? cause.message : "운영 현황을 불러오지 못했습니다.");
      }
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [overviewAttempt]);
  const metrics = overview?.metrics ?? emptyMetrics;
  const salesTrend = overview?.salesTrend ?? [];
  const memberTrend = overview?.memberTrend ?? [];
  const currentPage = pageCopy[activeTab];
  const trendSales = salesTrend.reduce((sum, point) => sum + point.sales, 0);
  const trendMemberCount = memberTrend.reduce((sum, point) => sum + point.memberCount, 0);
  const subscriptionTotal = Math.max(
    metrics.activeSubscriptions
      + metrics.pastDueSubscriptions
      + metrics.manualReviewSubscriptions,
    1,
  );
  const totalReviewCount = metrics.orderReviewCount + metrics.manualReviewSubscriptions;
  const initials = adminEmail.slice(0, 2).toUpperCase();
  const statuses = [
    { label: "정상 활성", value: metrics.activeSubscriptions, color: "#55d6af" },
    { label: "연체", value: metrics.pastDueSubscriptions, color: "#f6b85e" },
    { label: "확인 필요", value: metrics.manualReviewSubscriptions, color: "#9d85ff" },
  ];
  const summaryCards = [
    {
      label: "누적 매출",
      value: money(metrics.grossSales),
      hint: `승인 ${metrics.paidOrders.toLocaleString("ko-KR")}건`,
      icon: "billing" as const,
      color: "#a991ff",
    },
    {
      label: "오늘 매출",
      value: money(metrics.todaySales),
      hint: "KST 자정 이후 승인 기준",
      icon: "onboarding" as const,
      color: "#56d6b0",
    },
    {
      label: "활성 구독",
      value: `${metrics.activeSubscriptions.toLocaleString("ko-KR")}건`,
      hint: `연체 ${metrics.pastDueSubscriptions.toLocaleString("ko-KR")}건`,
      icon: "members" as const,
      color: "#68a5ff",
    },
    {
      label: "활성 구독 결제액",
      value: money(metrics.activeSubscriptionBillingKrw),
      hint: `이지컷 프로 ${metrics.activeProSubscriptions.toLocaleString("ko-KR")}건 · 월 기준`,
      icon: "billing" as const,
      color: "#5fd1b3",
    },
    {
      label: "운영 확인",
      value: `${totalReviewCount.toLocaleString("ko-KR")}건`,
      hint: `누적 환불 ${compactMoney(metrics.refundedSales)}`,
      icon: "inquiries" as const,
      color: "#f2a65f",
    },
  ];

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <div>
            <p className={styles.brandEyebrow}>Easy Cut</p>
            <p className={styles.brandName}>Admin Console</p>
          </div>
        </div>

        <nav className={styles.navigation} aria-label="관리자 메뉴">
          {navigationGroups.map((group) => (
            <div className={styles.navGroup} key={group.label}>
              <p className={styles.navGroupLabel}>{group.label}</p>
              {group.items.map((item) => {
                const active = activeTab === item.tab;
                return (
                  <Link
                    key={item.tab}
                    href={`/admin/easycutcutcutcutcutcut?tab=${item.tab}`}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                  >
                    <AdminIcon name={item.icon} className={styles.navIcon} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.operator}>
            <span className={styles.avatar}>{initials}</span>
            <div className={styles.operatorMeta}>
              <p className={styles.operatorRole}>Administrator</p>
              <p className={styles.operatorEmail} title={adminEmail}>{adminEmail}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.pageEyebrow}>
              <span className={styles.liveDot} aria-hidden="true" />
              {currentPage.eyebrow}
            </p>
            <h1 className={styles.pageTitle}>{currentPage.title}</h1>
          </div>
          <div className={styles.topbarActions}>
            <span className={styles.kstBadge}>최근 운영 데이터 · 최대 1분 지연</span>
            <Link href="/" prefetch={false} className={styles.serviceLink}>
              서비스로 이동
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M7 4h9v9M16 4 8 12" />
                <path d="M13 10v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />
              </svg>
            </Link>
          </div>
        </header>

        <div className={styles.workspace}>
          <section aria-labelledby="admin-overview-title" aria-busy={!overview && !overviewError}>
            <div className={styles.overviewHeading}>
              <div>
                <p className={styles.overviewKicker}>Operations overview</p>
                <h2 id="admin-overview-title" className={styles.overviewTitle}>비즈니스 현황을 한눈에.</h2>
              </div>
              <p className={styles.overviewDescription}>
                결제 승인, 회원 가입, 구독 상태를 최근 데이터로 집계합니다.
                주요 운영 지표와 최근 흐름을 확인한 뒤 아래에서 상세 업무를 처리하세요.
              </p>
            </div>

            {!overview ? (
              <div className={styles.overviewDescription} role={overviewError ? "alert" : "status"}>
                {overviewError || "운영 현황을 불러오는 중…"}
                {overviewError ? (
                  <button
                    type="button"
                    onClick={() => setOverviewAttempt((value) => value + 1)}
                    className={styles.serviceLink}
                  >
                    다시 시도
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className={styles.metricGrid} aria-label="운영 요약">
              {summaryCards.map((card) => (
                <article
                  className={styles.metricCard}
                  key={card.label}
                  style={{
                    "--metric-color": card.color,
                  } as CSSProperties}
                >
                  <div className={styles.metricTop}>
                    <p className={styles.metricLabel}>{card.label}</p>
                    <span className={styles.metricIcon}><AdminIcon name={card.icon} /></span>
                  </div>
                  <p className={styles.metricValue}>{card.value}</p>
                  <p className={styles.metricHint}>{card.hint}</p>
                </article>
              ))}
            </div>

            <div className={styles.analyticsGrid}>
              <article className={`${styles.analyticsCard} ${styles.revenueCard}`}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>최근 14일 매출</h3>
                  </div>
                  <div>
                    <p className={styles.chartTotal}>기간 합계<strong>{compactMoney(trendSales)}</strong></p>
                    <p className={styles.chartLegend}><span className={styles.legendDot} /> 일별 매출</p>
                  </div>
                </div>
                <SalesTrendChart data={salesTrend} />
              </article>

              <article className={`${styles.analyticsCard} ${styles.memberCard}`}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>최근 14일 회원 수 추이</h3>
                  </div>
                  <div>
                    <p className={styles.chartTotal}>기간 신규<strong>{trendMemberCount.toLocaleString("ko-KR")}명</strong></p>
                    <p className={styles.chartLegend}><span className={styles.memberLegendDot} /> 일별 신규 회원</p>
                  </div>
                </div>
                <MemberTrendChart data={memberTrend} />
              </article>

              <article className={`${styles.analyticsCard} ${styles.subscriptionCard}`}>
                <div>
                  <h3 className={styles.cardTitle}>구독 상태 분포</h3>
                </div>
                <div className={styles.statusList}>
                  {statuses.map((status) => (
                    <div key={status.label}>
                      <div className={styles.statusMeta}>
                        <span>{status.label}</span>
                        <strong>{status.value.toLocaleString("ko-KR")}건</strong>
                      </div>
                      <div className={styles.statusTrack}>
                        <div
                          className={styles.statusBar}
                          style={{
                            "--status-color": status.color,
                            width: `${Math.min((status.value / subscriptionTotal) * 100, 100)}%`,
                          } as CSSProperties}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>

          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </main>
  );
}
