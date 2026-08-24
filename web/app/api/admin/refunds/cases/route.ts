import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import {
  adminRefundActions,
  adminRefundBillingActions,
  adminRefundEntitlementActions,
} from "@/lib/admin-refund-case";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  adminRefundReasonCodes,
  getPrepaidPackageMonthState,
  quoteFirstCompletedJobRefund,
} from "@/lib/refund-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  billingOrderId: z.string().uuid(),
  reasonCode: z.enum(adminRefundReasonCodes),
  reasonDetail: z.string().trim().min(2).max(1000),
  refundAction: z.enum(adminRefundActions),
  manualRefundKrw: z.number().int().min(0).max(100_000_000).optional(),
  billingAction: z.enum(adminRefundBillingActions),
  entitlementAction: z.enum(adminRefundEntitlementActions),
  adminNote: z.string().trim().max(2000).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const admin = await requireAdminUser();
    const body = schema.parse(await request.json());
    const db = getDb();
    const rows = await db.begin(async (tx) => {
      const orderRows = await tx`
        select o.*,u.email,u.display_name,p.prepaid_months,p.display_name as product_name,
          s.current_period_end,s.status as subscription_status
        from shorts_mvp.billing_orders o
        join shorts_mvp.app_users u on u.id=o.user_id
        left join shorts_mvp.plans p on p.code=o.product_code
        left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
        where o.id=${body.billingOrderId}
        for update of o
      `;
      const order = orderRows[0];
      if (!order) throw new HttpError(404, "환불 대상 주문을 찾을 수 없습니다.");
      if (order.status !== "succeeded") {
        throw new HttpError(409, "승인 완료된 결제만 환불 건으로 등록할 수 있습니다.");
      }
      const existing = await tx`
        select id,status
        from shorts_mvp.admin_refund_cases
        where billing_order_id=${order.id}
          and status in ('unprocessed','in_progress','manual_review')
        limit 1
      `;
      if (existing[0]) {
        throw new HttpError(409, "이 주문에는 이미 처리 중인 환불 건이 있습니다.");
      }

      const firstJobRows = await tx`
        select j.id,j.completed_at
        from shorts_mvp.usage_grants g
        join shorts_mvp.usage_grant_allocations a
          on a.grant_id=g.id and a.status='consumed'
        join shorts_mvp.usage_reservations ur
          on ur.id=a.reservation_id and ur.status='consumed'
        join shorts_mvp.video_jobs j
          on j.id=ur.job_id and j.status='completed' and j.completed_at is not null
        where g.billing_order_id=${order.id}
        order by j.completed_at,j.created_at,j.id
        limit 1
      `;
      const firstJob = firstJobRows[0] || null;
      const prepaidMonths = Number(
        order.prepaidMonths || (order.billingCycle === "yearly" ? 12 : 1),
      );
      const reservedRows = await tx`
        select (
          coalesce((
            select sum(amount_krw)
            from shorts_mvp.admin_billing_refunds
            where billing_order_id=${order.id}
              and status in ('pending','processing','manual_review')
          ),0)
          + coalesce((
            select sum(refund_amount_krw)
            from shorts_mvp.subscription_upgrade_refunds
            where source_order_id=${order.id}
              and status in ('pending','submitted','manual_review')
          ),0)
        )::integer as reserved_amount
      `;
      const refundedOrReservedKrw = Number(order.refundedAmountKrw || 0)
        + Number(reservedRows[0]?.reservedAmount || 0);
      const quote = quoteFirstCompletedJobRefund({
        actualPaymentKrw: Number(order.amountKrw),
        refundedOrReservedKrw,
        prepaidMonths,
        firstJobCompleted: Boolean(firstJob),
      });
      const maximumRemainingKrw = Math.max(
        0,
        Number(order.amountKrw) - refundedOrReservedKrw,
      );
      const plannedRefundKrw = body.refundAction === "none"
        ? 0
        : body.refundAction === "manual_amount"
          ? Number(body.manualRefundKrw || 0)
          : quote.refundAmountKrw;
      if (body.refundAction === "manual_amount" && plannedRefundKrw < 1) {
        throw new HttpError(400, "직접 입력 환불액은 1원 이상이어야 합니다.");
      }
      if (plannedRefundKrw > maximumRemainingKrw) {
        throw new HttpError(409, "남은 환불 가능 금액을 초과했습니다.");
      }
      if (body.billingAction !== "none" && order.provider !== "thepayone") {
        throw new HttpError(409, "토스 주문은 토스 구독 관리에서 자동결제를 해지해 주세요.");
      }
      if (body.billingAction !== "none" && order.billingCycle !== "monthly") {
        throw new HttpError(409, "자동결제 중지는 더페이원 월간 구독 주문에서만 선택할 수 있습니다.");
      }
      if (
        order.provider === "thepayone"
        && order.billingCycle === "monthly"
        && body.entitlementAction !== "none"
        && body.billingAction === "none"
      ) {
        throw new HttpError(409, "월간 구독 종료 시에는 다음 결제 중지도 함께 선택해 주세요.");
      }
      if (
        (body.billingAction !== "none" || body.entitlementAction !== "none")
        && !order.subscriptionId
      ) {
        throw new HttpError(409, "연결된 구독이나 패키지 이용권을 확인할 수 없습니다.");
      }

      const contractStart = order.renewalPeriodStart instanceof Date
        ? order.renewalPeriodStart
        : order.approvedAt instanceof Date
          ? order.approvedAt
          : null;
      let entitlementEffectiveAt: Date | null = null;
      if (body.entitlementAction === "revoke_now") {
        entitlementEffectiveAt = new Date();
      } else if (body.entitlementAction === "end_at_current_period") {
        if (order.billingCycle === "monthly" && order.currentPeriodEnd instanceof Date) {
          entitlementEffectiveAt = order.currentPeriodEnd;
        } else if (contractStart) {
          entitlementEffectiveAt = getPrepaidPackageMonthState({
            periodStart: contractStart,
            prepaidMonths,
          }).currentMonthEnd || new Date();
        }
        if (!entitlementEffectiveAt) {
          throw new HttpError(409, "이용권 종료 예정일을 계산할 수 없습니다.");
        }
      }

      const inserted = await tx`
        insert into shorts_mvp.admin_refund_cases (
          billing_order_id,user_id,created_by_user_id,assigned_to_user_id,
          reason_code,reason_detail,first_job_completed,first_completed_job_id,
          first_completed_job_at,prepaid_months,monthly_deduction_krw,
          calculated_refund_krw,planned_refund_krw,refund_action,
          billing_action,entitlement_action,entitlement_effective_at,admin_note
        ) values (
          ${order.id},${order.userId},${admin.id},${admin.id},
          ${body.reasonCode},${body.reasonDetail},${Boolean(firstJob)},
          ${firstJob?.id || null},${firstJob?.completedAt || null},${prepaidMonths},
          ${quote.monthlyDeductionKrw},${quote.refundAmountKrw},${plannedRefundKrw},
          ${body.refundAction},${body.billingAction},${body.entitlementAction},
          ${entitlementEffectiveAt},${body.adminNote || null}
        )
        returning *
      `;
      const refundCase = inserted[0];
      await tx`
        insert into shorts_mvp.admin_refund_case_events (
          refund_case_id,actor_user_id,event_type,to_status,note,metadata
        ) values (
          ${refundCase.id},${admin.id},'refund_case.created','unprocessed',
          ${body.reasonDetail},
          ${tx.json({
            orderId: order.orderId,
            productCode: order.productCode,
            firstJobCompleted: Boolean(firstJob),
            monthlyDeductionKrw: quote.monthlyDeductionKrw,
            calculatedRefundKrw: quote.refundAmountKrw,
            plannedRefundKrw,
            billingAction: body.billingAction,
            entitlementAction: body.entitlementAction,
            entitlementEffectiveAt,
          })}
        )
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'refund_case.created','admin_refund_case',${refundCase.id},
          ${tx.json({
            billingOrderId: order.id,
            userId: order.userId,
            plannedRefundKrw,
          })}
        )
      `;
      return inserted;
    });
    return NextResponse.json({ ok: true, refundCase: rows[0] });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      return apiError(
        new HttpError(409, "이 주문에는 이미 처리 중인 환불 건이 있습니다."),
        "환불 건을 추가하지 못했습니다.",
      );
    }
    return apiError(error, "환불 건을 추가하지 못했습니다.");
  }
}
