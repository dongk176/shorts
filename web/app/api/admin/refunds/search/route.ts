import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || "";
    if (query.length < 2) {
      return NextResponse.json({ results: [] });
    }
    const db = getDb();
    const rows = await db`
      select
        o.id,o.order_id,o.order_name,o.kind,o.product_code,o.billing_cycle,
        o.amount_krw,o.refunded_amount_krw,o.status,o.provider,
        o.provider_transaction_id,o.approved_at,o.created_at,o.subscription_id,
        u.id as user_id,u.email,u.display_name,
        p.display_name as product_name,p.prepaid_months,
        s.status as subscription_status,s.current_period_end,
        s.cancel_at_period_end,s.provider_schedule_status,
        first_job.id as first_completed_job_id,
        first_job.completed_at as first_completed_job_at,
        open_case.id as open_case_id,open_case.status as open_case_status
      from shorts_mvp.billing_orders o
      join shorts_mvp.app_users u on u.id=o.user_id
      left join shorts_mvp.plans p on p.code=o.product_code
      left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
      left join lateral (
        select j.id,j.completed_at
        from shorts_mvp.usage_grants g
        join shorts_mvp.usage_grant_allocations a
          on a.grant_id=g.id and a.status='consumed'
        join shorts_mvp.usage_reservations ur
          on ur.id=a.reservation_id and ur.status='consumed'
        join shorts_mvp.video_jobs j
          on j.id=ur.job_id and j.status='completed' and j.completed_at is not null
        where g.billing_order_id=o.id
        order by j.completed_at,j.created_at,j.id
        limit 1
      ) first_job on true
      left join lateral (
        select c.id,c.status
        from shorts_mvp.admin_refund_cases c
        where c.billing_order_id=o.id
          and c.status in ('unprocessed','in_progress','manual_review')
        order by c.created_at desc
        limit 1
      ) open_case on true
      where (
        lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(u.display_name,'')) like ${`%${query.toLowerCase()}%`}
        or lower(o.order_id) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(o.provider_transaction_id,'')) like ${`%${query.toLowerCase()}%`}
        or u.id::text=${query}
        or o.id::text=${query}
      )
      order by
        case when o.status='succeeded' then 0 else 1 end,
        coalesce(o.approved_at,o.created_at) desc
      limit 50
    `;
    return NextResponse.json({ results: rows });
  } catch (error) {
    return apiError(error, "환불 대상 결제를 검색하지 못했습니다.");
  }
}
