import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ checkoutId: string }> },
) {
  try {
    const { checkoutId } = await context.params;
    const id = idSchema.parse(checkoutId);
    const session = await requireAuthenticatedMvpSession();
    const rows = await getDb()`
      select o.id,o.kind,o.product_code,o.order_name,o.billing_cycle,o.status,
        o.failure_code,o.approved_at,o.amount_krw,
        o.installment_months,o.proration_credit_krw,
        coalesce(r.status,
          case when o.proration_refund_status='succeeded' and o.proration_credit_krw > 0
            then 'completed' else null end
        ) as upgrade_refund_status,
        coalesce(r.refund_amount_krw,o.proration_credit_krw,0)::integer as refund_amount_krw
      from shorts_mvp.billing_orders o
      left join shorts_mvp.subscription_upgrade_refunds r on r.upgrade_order_id=o.id
      where o.id=${id} and o.user_id=${session.userId} limit 1
    `;
    const order = rows[0];
    if (!order) throw new HttpError(404, "결제 주문을 찾을 수 없습니다.");
    return NextResponse.json({
      checkoutId: order.id,
      kind: order.kind,
      productCode: order.productCode,
      orderName: order.orderName,
      billingCycle: order.billingCycle,
      status: order.status,
      failureCode: order.failureCode || null,
      approvedAt: order.approvedAt?.toISOString() || null,
      chargedAmountKrw: Number(order.amountKrw || 0),
      installmentMonths: Number(order.installmentMonths || 0),
      refund: {
        mode: order.upgradeRefundStatus
          ? "manual_partial"
          : Number(order.refundAmountKrw || 0) > 0
            ? "automatic_full"
            : "none",
        amountKrw: Number(order.refundAmountKrw || 0),
        processingBusinessDays: order.upgradeRefundStatus ? 3 : 0,
        status: order.upgradeRefundStatus || null,
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return apiError(error, "결제 상태를 확인하지 못했습니다.");
  }
}
