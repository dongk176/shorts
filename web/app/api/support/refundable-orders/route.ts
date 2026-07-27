import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const rows = await getDb()`
      with customer_orders as (
        select o.*,
          greatest(
            o.refunded_amount_krw,
            coalesce((
              select sum(r.amount_krw)
              from shorts_mvp.admin_billing_refunds r
              where r.billing_order_id=o.id
                and r.status in ('pending','processing','succeeded','manual_review')
            ),0)
            + coalesce((
              select sum(r.refund_amount_krw)
              from shorts_mvp.subscription_upgrade_refunds r
              where r.source_order_id=o.id
                and r.status in ('pending','submitted','completed','manual_review')
            ),0)
          )::integer as unavailable_refund_amount_krw
        from shorts_mvp.billing_orders o
        where o.user_id=${session.userId}
          and o.status='succeeded'
          and o.amount_krw > 0
      )
      select o.id,o.order_id,o.order_name,o.product_code,o.billing_cycle,o.kind,
        o.amount_krw,o.unavailable_refund_amount_krw,
        (o.amount_krw-o.unavailable_refund_amount_krw)::integer
          as remaining_refundable_amount_krw,
        o.approved_at,o.created_at,
        exists (
          select 1 from shorts_mvp.customer_inquiries i
          where i.billing_order_id=o.id
            and i.inquiry_kind='refund_request'
            and i.status in ('new','in_progress','waiting_on_customer')
        ) as has_open_refund_inquiry
      from customer_orders o
      where o.amount_krw > o.unavailable_refund_amount_krw
      order by coalesce(o.approved_at,o.created_at) desc
      limit 20
    `;
    const response = NextResponse.json({ items: rows });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error, "환불 가능한 결제 내역을 불러오지 못했습니다.");
  }
}
