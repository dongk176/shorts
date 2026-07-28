import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireAuthenticatedMvpSession();
    const url = new URL(request.url);
    const type = url.searchParams.get("type") === "usage" ? "usage" : "payments";
    const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page") || 1)));
    const limit = 25;
    const offset = (page - 1) * limit;
    const db = getDb();

    if (type === "payments") {
      const [rows, countRows] = await Promise.all([
        db`
          select o.id,o.order_id,o.order_name,o.product_code,o.billing_cycle,o.kind,
            o.amount_krw,o.installment_months,o.status,o.refund_status,o.refunded_amount_krw,
            o.provider_auth_code,o.provider_transaction_id,o.approved_at,o.created_at,
            coalesce((
              select sum(r.refund_amount_krw) from shorts_mvp.subscription_upgrade_refunds r
              where r.source_order_id=o.id and r.status in ('pending','submitted','manual_review')
            ),0)::integer as scheduled_refund_amount_krw,
            coalesce((
              select sum(r.refund_amount_krw) from shorts_mvp.subscription_upgrade_refunds r
              where r.source_order_id=o.id and r.status='completed'
            ),0)::integer as upgrade_refunded_amount_krw
          from shorts_mvp.billing_orders o
          where o.user_id=${session.userId} and o.amount_krw > 0
          order by coalesce(o.approved_at,o.created_at) desc
          limit ${limit} offset ${offset}
        `,
        db`
          select count(*)::integer as count from shorts_mvp.billing_orders
          where user_id=${session.userId} and amount_krw > 0
        `,
      ]);
      return NextResponse.json({
        type, page, pageSize: limit, total: Number(countRows[0]?.count || 0), items: rows,
      });
    }

    const [rows, countRows] = await Promise.all([
      db`
        with activity as (
          select g.id::text || ':credited' as id,g.created_at as occurred_at,
            case
              when g.product_code='feedback_reward_30m' then 'feedback_reward'
              when g.product_code='editor_launch_bonus_20260728' then 'update_event_bonus'
              when g.product_code='onboarding_welcome_20min_v1' then 'welcome_grant'
              when g.kind='addon' then 'addon_grant'
              when s.billing_cycle='yearly'
                and o.approved_at is not null
                and g.valid_from > o.approved_at + interval '1 day'
                then 'annual_or_monthly_grant'
              when o.kind='subscription_change' then 'upgrade_grant'
              when o.kind='subscription_renewal' then 'annual_or_monthly_grant'
              else 'plan_grant'
            end as event_type,
            g.product_code,g.credited_seconds as seconds,null::bigint as project_number,
            null::text as video_title,'granted'::text as result
          from shorts_mvp.usage_grants g
          left join shorts_mvp.billing_orders o on o.id=g.billing_order_id
          left join shorts_mvp.user_subscriptions s on s.id=g.subscription_id
          where g.user_id=${session.userId} and g.credited_seconds > 0
          union all
          select g.id::text || ':carried',g.created_at,'upgrade_carryover',
            g.product_code,g.carried_seconds,null::bigint,null::text,'carried'
          from shorts_mvp.usage_grants g
          where g.user_id=${session.userId} and g.carried_seconds > 0
          union all
          select e.id::text,e.occurred_at,e.event_type,null::text,
            case when e.event_type='source_consumed' then -e.source_duration_seconds
              else e.source_duration_seconds end,
            j.project_number,j.video_title,j.status
          from shorts_mvp.usage_events e
          join shorts_mvp.video_jobs j on j.id=e.job_id
          where e.user_id=${session.userId}
        )
        select * from activity order by occurred_at desc limit ${limit} offset ${offset}
      `,
      db`
        select (
          (select count(*) from shorts_mvp.usage_grants where user_id=${session.userId} and credited_seconds > 0)
          +(select count(*) from shorts_mvp.usage_grants where user_id=${session.userId} and carried_seconds > 0)
          +(select count(*) from shorts_mvp.usage_events where user_id=${session.userId})
        )::integer as count
      `,
    ]);
    return NextResponse.json({
      type, page, pageSize: limit, total: Number(countRows[0]?.count || 0), items: rows,
    });
  } catch (error) {
    return apiError(error, "내 이용내역을 불러오지 못했습니다.");
  }
}
