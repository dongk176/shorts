import "server-only";

import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";
import {
  buildAdminTrend, kstDate, shiftTrendDate,
  type AdminTrendData, type AdminTrendMetric, type AdminTrendPeriod, type AdminTrendPoint,
} from "@/lib/admin-trends";

export type AdminOverviewData = {
  metrics: {
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
  salesTrend: AdminTrendData;
  memberTrend: AdminTrendData;
};

const loadAdminMetrics = unstable_cache(async (today: string): Promise<AdminOverviewData["metrics"]> => {
  const db = getDb();
  const rows = await db`
    with metrics as (
      select
        coalesce(sum(amount_krw) filter (where status='succeeded'),0)::bigint as gross_sales,
        coalesce(sum(refunded_amount_krw),0)::bigint as refunded_sales,
        coalesce(sum(amount_krw) filter (
          where status='succeeded' and amount_krw>0
            and approved_at >= (
              ${today}::timestamp
              at time zone 'Asia/Seoul'
            )
        ),0)::bigint as today_sales,
        count(*) filter (where status='succeeded' and amount_krw>0)::integer as paid_orders,
        count(*) filter (where status in ('unknown','manual_review'))::integer as review_orders
      from shorts_mvp.billing_orders
    ),
    subscriptions as (
      select
        count(*) filter (where subscription.status='active')::integer as active,
        count(*) filter (where subscription.status='past_due')::integer as past_due,
        count(*) filter (where subscription.billing_review_status='manual_review')::integer as manual_review,
        count(*) filter (
          where subscription.status='active' and subscription.plan_code='easycut_pro_v2'
        )::integer as active_pro,
        coalesce(sum(plan.monthly_price_krw) filter (
          where subscription.status='active' and subscription.plan_code='easycut_pro_v2'
        ),0)::bigint as active_billing_krw
      from shorts_mvp.user_subscriptions subscription
      left join shorts_mvp.plans plan on plan.code=subscription.plan_code
    )
    select metrics.*,subscriptions.*
    from metrics cross join subscriptions
  `;
  const row = rows[0] || {};
  return {
    grossSales: Number(row.grossSales || 0),
    refundedSales: Number(row.refundedSales || 0),
    todaySales: Number(row.todaySales || 0),
    paidOrders: Number(row.paidOrders || 0),
    orderReviewCount: Number(row.reviewOrders || 0),
    activeSubscriptions: Number(row.active || 0),
    pastDueSubscriptions: Number(row.pastDue || 0),
    manualReviewSubscriptions: Number(row.manualReview || 0),
    activeProSubscriptions: Number(row.activePro || 0),
    activeSubscriptionBillingKrw: Number(row.activeBillingKrw || 0),
  };
}, ["admin-overview-metrics-v3"], { revalidate: 60 });

async function readTrendRows(
  metric: AdminTrendMetric, from: string | null, until: string,
): Promise<AdminTrendPoint[]> {
  const db = getDb();
  const lower = from ? `${from}T00:00:00+09:00` : null;
  const upper = `${until}T00:00:00+09:00`;
  if (metric === "sales") {
    const rows = await db`
      select
        to_char(approved_at at time zone 'Asia/Seoul','YYYY-MM-DD') as date,
        coalesce(sum(amount_krw),0)::bigint as sales,
        count(*)::integer as order_count
      from shorts_mvp.billing_orders
      where status='succeeded' and amount_krw>0
        and (${lower}::timestamptz is null or approved_at >= ${lower}::timestamptz)
        and approved_at < ${upper}::timestamptz
      group by 1 order by 1
    `;
    return rows.map((row) => ({
      date: String(row.date), value: Number(row.sales), orderCount: Number(row.orderCount),
    }));
  }
  const rows = await db`
    select
      to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as date,
      count(*)::integer as member_count
    from shorts_mvp.app_users
    where (${lower}::timestamptz is null or created_at >= ${lower}::timestamptz)
      and created_at < ${upper}::timestamptz
    group by 1 order by 1
  `;
  return rows.map((row) => ({ date: String(row.date), value: Number(row.memberCount) }));
}

// Share historical daily aggregates across all four periods. The KST cutoff
// is part of the key, so a new day cannot reuse yesterday's partition boundary.
const loadHistoricalTrend = unstable_cache(
  (metric: AdminTrendMetric, until: string) => readTrendRows(metric, null, until),
  ["admin-trend-history-v1"], { revalidate: 86_400 },
);
const loadRecentTrend = unstable_cache(
  (metric: AdminTrendMetric, from: string, until: string) => readTrendRows(metric, from, until),
  ["admin-trend-recent-v1"], { revalidate: 30 },
);

export async function loadAdminTrend(
  metric: AdminTrendMetric, period: AdminTrendPeriod, today = kstDate(),
): Promise<AdminTrendData> {
  const cutoff = shiftTrendDate(today, -1);
  const history = await loadHistoricalTrend(metric, cutoff);
  const recent = await loadRecentTrend(metric, cutoff, shiftTrendDate(today, 1));
  return buildAdminTrend(metric, period, today, [...history, ...recent]);
}

export async function loadAdminOverview(): Promise<AdminOverviewData> {
  // Do not wrap this orchestration in unstable_cache: Next 15 bypasses nested
  // unstable_cache reads, which would defeat the longer historical cache.
  const today = kstDate();
  const metrics = await loadAdminMetrics(today);
  const salesTrend = await loadAdminTrend("sales", "7d", today);
  const memberTrend = await loadAdminTrend("members", "7d", today);
  return { metrics, salesTrend, memberTrend };
}
