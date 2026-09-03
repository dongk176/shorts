import "server-only";

import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";
import type {
  AdminMemberTrendPoint,
  AdminSalesTrendPoint,
} from "@/app/admin/easycutcutcutcutcutcut/admin-shell";

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
  salesTrend: AdminSalesTrendPoint[];
  memberTrend: AdminMemberTrendPoint[];
};

export const loadAdminOverview = unstable_cache(async (): Promise<AdminOverviewData> => {
  const db = getDb();
  const rows = await db`
    with metrics as (
      select
        coalesce(sum(amount_krw) filter (where status='succeeded'),0)::bigint as gross_sales,
        coalesce(sum(refunded_amount_krw),0)::bigint as refunded_sales,
        coalesce(sum(amount_krw) filter (
          where status='succeeded' and amount_krw>0
            and approved_at >= (
              date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul')
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
    ),
    days as (
      select generate_series(
        date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days',
        date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul'),
        interval '1 day'
      )::date as trend_day
    ),
    daily_sales as (
      select (approved_at at time zone 'Asia/Seoul')::date as trend_day,
        coalesce(sum(amount_krw),0)::bigint as sales,count(*)::integer as order_count
      from shorts_mvp.billing_orders
      where status='succeeded' and amount_krw>0
        and approved_at >= (
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days'
        ) at time zone 'Asia/Seoul'
      group by (approved_at at time zone 'Asia/Seoul')::date
    ),
    daily_members as (
      select (created_at at time zone 'Asia/Seoul')::date as trend_day,
        count(*)::integer as member_count
      from shorts_mvp.app_users
      where created_at >= (
        date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days'
      ) at time zone 'Asia/Seoul'
      group by (created_at at time zone 'Asia/Seoul')::date
    )
    select metrics.*,subscriptions.*,
      (
        select jsonb_agg(jsonb_build_object(
          'date',to_char(days.trend_day,'YYYY-MM-DD'),
          'sales',coalesce(daily_sales.sales,0),
          'orderCount',coalesce(daily_sales.order_count,0)
        ) order by days.trend_day)
        from days left join daily_sales using (trend_day)
      ) as sales_trend,
      (
        select jsonb_agg(jsonb_build_object(
          'date',to_char(days.trend_day,'YYYY-MM-DD'),
          'memberCount',coalesce(daily_members.member_count,0)
        ) order by days.trend_day)
        from days left join daily_members using (trend_day)
      ) as member_trend
    from metrics cross join subscriptions
  `;
  const row = rows[0] || {};
  const salesTrend = Array.isArray(row.salesTrend) ? row.salesTrend : [];
  const memberTrend = Array.isArray(row.memberTrend) ? row.memberTrend : [];

  return {
    metrics: {
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
    },
    salesTrend: salesTrend.map((item) => ({
      date: String((item as Record<string, unknown>).date),
      sales: Number((item as Record<string, unknown>).sales || 0),
      orderCount: Number((item as Record<string, unknown>).orderCount || 0),
    })),
    memberTrend: memberTrend.map((item) => ({
      date: String((item as Record<string, unknown>).date),
      memberCount: Number((item as Record<string, unknown>).memberCount || 0),
    })),
  };
}, ["admin-overview-v2"], { revalidate: 60 });
