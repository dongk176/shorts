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
  // Keep the administrator overview from occupying every connection in the
  // four-slot serverless pool at once. These cached reads are small, and
  // sequential execution leaves capacity for authentication and the active
  // dashboard tab even when two administrator navigations overlap.
  const metricRows = await db`
      select
        coalesce(sum(amount_krw) filter (where status='succeeded'),0)::bigint as gross_sales,
        coalesce(sum(refunded_amount_krw),0)::bigint as refunded_sales,
        coalesce(sum(amount_krw) filter (
          where status='succeeded'
            and amount_krw>0
            and approved_at >= (
              date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul')
              at time zone 'Asia/Seoul'
            )
        ),0)::bigint as today_sales,
        count(*) filter (
          where status='succeeded' and amount_krw>0
        )::integer as paid_orders,
        count(*) filter (where status in ('unknown','manual_review'))::integer as review_orders
      from shorts_mvp.billing_orders
    `;
  const subscriptionRows = await db`
      select
        count(*) filter (where subscription.status='active')::integer as active,
        count(*) filter (where subscription.status='past_due')::integer as past_due,
        count(*) filter (
          where subscription.billing_review_status='manual_review'
        )::integer as manual_review,
        count(*) filter (
          where subscription.status='active'
            and subscription.plan_code='easycut_pro_v2'
        )::integer as active_pro,
        coalesce(sum(plan.monthly_price_krw) filter (
          where subscription.status='active'
            and subscription.plan_code='easycut_pro_v2'
        ),0)::bigint as active_billing_krw
      from shorts_mvp.user_subscriptions subscription
      left join shorts_mvp.plans plan on plan.code=subscription.plan_code
    `;
  const salesTrendRows = await db`
      with days as (
        select generate_series(
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days',
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul'),
          interval '1 day'
        )::date as trend_day
      ),
      daily_sales as (
        select
          (approved_at at time zone 'Asia/Seoul')::date as trend_day,
          coalesce(sum(amount_krw),0)::bigint as sales,
          count(*)::integer as order_count
        from shorts_mvp.billing_orders
        where status='succeeded'
          and amount_krw>0
          and approved_at >= (
            date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days'
          ) at time zone 'Asia/Seoul'
        group by (approved_at at time zone 'Asia/Seoul')::date
      )
      select
        to_char(days.trend_day,'YYYY-MM-DD') as date,
        coalesce(daily_sales.sales,0)::bigint as sales,
        coalesce(daily_sales.order_count,0)::integer as order_count
      from days
      left join daily_sales using (trend_day)
      order by days.trend_day
    `;
  const memberTrendRows = await db`
      with days as (
        select generate_series(
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days',
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul'),
          interval '1 day'
        )::date as trend_day
      ),
      daily_members as (
        select
          (created_at at time zone 'Asia/Seoul')::date as trend_day,
          count(*)::integer as member_count
        from shorts_mvp.app_users
        where created_at >= (
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days'
        ) at time zone 'Asia/Seoul'
        group by (created_at at time zone 'Asia/Seoul')::date
      )
      select
        to_char(days.trend_day,'YYYY-MM-DD') as date,
        coalesce(daily_members.member_count,0)::integer as member_count
      from days
      left join daily_members using (trend_day)
      order by days.trend_day
    `;
  const metrics = metricRows[0] || {};
  const subscriptions = subscriptionRows[0] || {};

  return {
    metrics: {
      grossSales: Number(metrics.grossSales || 0),
      refundedSales: Number(metrics.refundedSales || 0),
      todaySales: Number(metrics.todaySales || 0),
      paidOrders: Number(metrics.paidOrders || 0),
      orderReviewCount: Number(metrics.reviewOrders || 0),
      activeSubscriptions: Number(subscriptions.active || 0),
      pastDueSubscriptions: Number(subscriptions.pastDue || 0),
      manualReviewSubscriptions: Number(subscriptions.manualReview || 0),
      activeProSubscriptions: Number(subscriptions.activePro || 0),
      activeSubscriptionBillingKrw: Number(subscriptions.activeBillingKrw || 0),
    },
    salesTrend: salesTrendRows.map((row) => ({
      date: String(row.date),
      sales: Number(row.sales || 0),
      orderCount: Number(row.orderCount || 0),
    })),
    memberTrend: memberTrendRows.map((row) => ({
      date: String(row.date),
      memberCount: Number(row.memberCount || 0),
    })),
  };
}, ["admin-overview-v1"], { revalidate: 30 });
