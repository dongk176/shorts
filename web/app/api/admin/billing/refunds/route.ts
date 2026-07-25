import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { addKstMonths } from "@/lib/billing";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  adminRefundReasonCodes,
  adminRefundReasonLabel,
  quoteCustomerEarlyTerminationRefund,
} from "@/lib/refund-policy";
import {
  assertThePayOneBillingEnabled,
  createPaymentTrackId,
  refundThePayOnePayment,
  thePayOneRefundMismatchFields,
  thePayOneTerminalId,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  requestId: z.string().uuid(),
  orderId: z.string().uuid(),
  amountKrw: z.number().int().positive().max(100_000_000),
  reasonCode: z.enum(adminRefundReasonCodes),
  reason: z.string().trim().min(2).max(400),
}).strict();

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  return error.message
    .replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]")
    .slice(0, 300);
}

function kstDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function POST(request: Request) {
  let refundId: string | null = null;
  let billingOrderId: string | null = null;
  let claimed = false;
  try {
    assertBillingMutationRequest(request);
    const admin = await requireAdminUser();
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    const db = getDb();
    const prepared = await db.begin(async (tx) => {
      const existing = await tx`
        select * from shorts_mvp.admin_billing_refunds
        where request_id=${body.requestId} limit 1
      `;
      if (existing[0]) return { refund: existing[0], order: null };

      const orders = await tx`
        select o.*,u.email,p.prepaid_months
        from shorts_mvp.billing_orders o
        join shorts_mvp.app_users u on u.id=o.user_id
        left join shorts_mvp.plans p on p.code=o.product_code
        where o.id=${body.orderId}
        for update of o
      `;
      const order = orders[0];
      if (!order) throw new HttpError(404, "환불할 주문을 찾을 수 없습니다.");
      if (
        order.status !== "succeeded"
        || order.provider !== "thepayone"
        || !order.providerTransactionId
      ) throw new HttpError(409, "더페이원 승인 완료 주문만 자동 환불할 수 있습니다.");

      const reservedRows = await tx`
        select (
          coalesce((
            select sum(amount_krw)
            from shorts_mvp.admin_billing_refunds
            where billing_order_id=${order.id}
              and status in ('pending','processing','succeeded','manual_review')
          ),0)
          + coalesce((
            select sum(refund_amount_krw)
            from shorts_mvp.subscription_upgrade_refunds
            where source_order_id=${order.id}
              and status in ('pending','submitted','completed','manual_review')
          ),0)
        )::integer as amount
      `;
      const reservedAmountKrw = Number(reservedRows[0]?.amount || 0);
      const refundable = Number(order.amountKrw) - reservedAmountKrw;
      const paidFeatureUsageRows = await tx`
        select count(*)::integer as popular_filter_usage_count,
          max(occurred_at) as popular_filter_last_used_at
        from shorts_mvp.popular_filter_usage_events
        where billing_order_id=${order.id}
      `;
      const popularFilterUsageCount = Number(
        paidFeatureUsageRows[0]?.popularFilterUsageCount || 0,
      );
      if (
        body.reasonCode === "statutory_withdrawal_unused"
        && popularFilterUsageCount > 0
      ) {
        throw new HttpError(
          409,
          "유료 실시간 인기 필터 사용 이력이 있어 미사용 전액환불로 처리할 수 없습니다. 중도해지 기준을 확인해 주세요.",
          "PAID_FEATURE_ALREADY_USED",
        );
      }
      let amountKrw = body.amountKrw;
      let policyQuote = null;
      if (body.reasonCode === "customer_early_termination") {
        if (order.kind === "addon") {
          throw new HttpError(409, "추가 처리시간에는 기간형 중도해지 위약금을 적용할 수 없습니다.");
        }
        const contractStart = order.renewalPeriodStart instanceof Date
          ? order.renewalPeriodStart
          : order.approvedAt instanceof Date
            ? order.approvedAt
            : null;
        if (!contractStart) {
          throw new HttpError(409, "계약기간을 확인할 수 없어 중도해지 환불을 자동 계산하지 못했습니다.");
        }
        const contractMonths = order.billingCycle === "yearly"
          ? Number(order.prepaidMonths || 12)
          : 1;
        policyQuote = quoteCustomerEarlyTerminationRefund({
          actualPaymentKrw: Number(order.amountKrw),
          refundedOrReservedKrw: reservedAmountKrw,
          periodStart: contractStart,
          periodEnd: addKstMonths(contractStart, contractMonths),
          requestedAt: new Date(),
        });
        amountKrw = policyQuote.refundAmountKrw;
        if (amountKrw < 1) {
          throw new HttpError(409, "경과 이용대금과 중도해지 위약금을 공제하면 환불할 금액이 없습니다.");
        }
      } else if (body.reasonCode !== "goodwill") {
        amountKrw = refundable;
      }
      if (amountKrw > refundable) throw new HttpError(409, "남은 환불 가능 금액을 초과했습니다.");
      if (order.kind === "addon" && amountKrw !== refundable) {
        throw new HttpError(409, "추가 상품은 남은 결제금액 전액만 환불할 수 있습니다.");
      }
      if (
        amountKrw < refundable
        && order.approvedAt instanceof Date
        && kstDay(order.approvedAt) === kstDay(new Date())
      ) throw new HttpError(409, "당일 승인 거래는 전액 환불만 가능합니다.");

      if (order.kind === "addon") {
        const grants = await tx`
          select count(*)::integer as grant_count,
            coalesce(sum(consumed_seconds),0)::integer as consumed,
            coalesce(sum(reserved_seconds),0)::integer as reserved
          from shorts_mvp.usage_grants
          where billing_order_id=${order.id} and kind='addon'
        `;
        if (Number(grants[0]?.grantCount || 0) !== 1) {
          throw new HttpError(409, "추가 상품 권한 원장을 확인할 수 없어 자동 환불을 중단했습니다.");
        }
        if (Number(grants[0]?.consumed || 0) > 0 || Number(grants[0]?.reserved || 0) > 0) {
          throw new HttpError(409, "이미 사용하거나 처리 중인 추가 시간은 자동 환불할 수 없습니다.");
        }
      }

      const trackId = createPaymentTrackId("REFUND");
      const reason = `[${adminRefundReasonLabel(body.reasonCode)}] ${body.reason}`;
      const inserted = await tx`
        insert into shorts_mvp.admin_billing_refunds (
          request_id,billing_order_id,requested_by_user_id,provider,provider_track_id,
          root_provider_transaction_id,amount_krw,reason,status
        ) values (
          ${body.requestId},${order.id},${admin.id},'thepayone',${trackId},
          ${order.providerTransactionId},${amountKrw},${reason},'pending'
        ) returning *
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'billing.refund_requested','billing_order',${order.id},
          ${tx.json({
            refundId: inserted[0].id,
            amountKrw,
            reasonCode: body.reasonCode,
            reason: body.reason,
            policyQuote,
            popularFilterUsageCount,
            popularFilterLastUsedAt:
              paidFeatureUsageRows[0]?.popularFilterLastUsedAt || null,
          })}
        )
      `;
      return { refund: inserted[0], order };
    });

    const refund = prepared.refund;
    refundId = refund.id;
    billingOrderId = refund.billingOrderId;
    if (refund.status === "succeeded") {
      return NextResponse.json({ ok: true, refundId: refund.id, alreadyProcessed: true });
    }
    if (refund.status !== "pending") {
      throw new HttpError(409, "이미 처리 중이거나 확인이 필요한 환불 요청입니다.");
    }
    const order = prepared.order || (await db`
      select * from shorts_mvp.billing_orders where id=${refund.billingOrderId} limit 1
    `)[0];
    if (!order) throw new HttpError(404, "환불할 원주문을 찾을 수 없습니다.");

    const claim = await db`
      update shorts_mvp.admin_billing_refunds set status='processing'
      where id=${refund.id} and status='pending' returning id
    `;
    if (!claim[0]) throw new HttpError(409, "다른 요청에서 환불을 처리하고 있습니다.");
    claimed = true;

    const providerRefund = await refundThePayOnePayment({
      trackId: refund.providerTrackId,
      rootTransactionId: refund.rootProviderTransactionId,
      amount: Number(refund.amountKrw),
      referenceId: refund.id,
      reason: refund.reason,
    });
    const refundMismatchFields = thePayOneRefundMismatchFields(providerRefund, {
      trackId: refund.providerTrackId,
      rootTransactionId: refund.rootProviderTransactionId,
      amount: Number(refund.amountKrw),
      terminalId: thePayOneTerminalId(),
    });
    if (refundMismatchFields.length > 0) {
      throw new ThePayOneError(
        "환불 승인 결과가 원주문과 일치하지 않습니다.",
        "REFUND_MISMATCH",
        `불일치 필드: ${refundMismatchFields.join(",")}`,
        true,
      );
    }

    await db.begin(async (tx) => {
      const locked = await tx`
        select * from shorts_mvp.admin_billing_refunds
        where id=${refund.id} for update
      `;
      if (!locked[0] || locked[0].status !== "processing") {
        throw new Error("REFUND_STATE_CHANGED");
      }
      const lockedOrders = await tx`
        select * from shorts_mvp.billing_orders where id=${order.id} for update
      `;
      if (!lockedOrders[0]) throw new Error("REFUND_ORDER_MISSING");
      const newRefundedAmount = Number(lockedOrders[0].refundedAmountKrw || 0) + Number(refund.amountKrw);
      const fullyRefunded = newRefundedAmount === Number(order.amountKrw);
      const entitlementStatus = order.kind === "addon" ? "revoked" : "manual_review";
      if (order.kind === "addon") await tx`
        update shorts_mvp.usage_grants set status='revoked'
        where billing_order_id=${order.id} and kind='addon'
          and consumed_seconds=0 and reserved_seconds=0
      `;
      await tx`
        update shorts_mvp.billing_orders
        set refunded_amount_krw=${newRefundedAmount},
          refund_status=${fullyRefunded ? "full" : "partial"}
        where id=${order.id}
      `;
      await tx`
        update shorts_mvp.admin_billing_refunds
        set status='succeeded',provider_refund_transaction_id=${providerRefund.providerTransactionId},
          provider_code=${providerRefund.resultCode},entitlement_action_status=${entitlementStatus},
          failure_message=null,processed_at=${providerRefund.refundedAt}
        where id=${refund.id}
      `;
      await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id},validation_status='processed',
          processing_result='admin_refund_reconciled',processed_at=now()
        where provider='thepayone'
          and provider_transaction_id=${providerRefund.providerTransactionId}
          and validation_status in ('received','validated')
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'billing.refund_succeeded','billing_refund',${refund.id},
          ${tx.json({ orderId: order.id, amountKrw: Number(refund.amountKrw), fullyRefunded, entitlementStatus })}
        )
      `;
    });
    return NextResponse.json({
      ok: true,
      refundId: refund.id,
      amountKrw: Number(refund.amountKrw),
      entitlementRequiresReview: order.kind !== "addon",
    });
  } catch (error) {
    if (refundId && claimed) {
      const unknown = error instanceof ThePayOneError && error.outcomeUnknown;
      try {
        await getDb().begin(async (tx) => {
          await tx`
            update shorts_mvp.admin_billing_refunds
            set status=${unknown ? "manual_review" : "failed"},
              provider_code=${error instanceof ThePayOneError ? error.resultCode : "REFUND_FAILED"},
              failure_message=${safeFailureMessage(error)},processed_at=now(),
              entitlement_action_status=${unknown ? "manual_review" : "not_required"}
            where id=${refundId} and status='processing'
          `;
          if (billingOrderId && unknown) await tx`
            update shorts_mvp.billing_orders set refund_status='manual_review'
            where id=${billingOrderId}
          `;
        });
      } catch {
        // Preserve the original provider outcome for operator reconciliation.
      }
    }
    return apiError(error, "환불을 처리하지 못했습니다.");
  }
}
