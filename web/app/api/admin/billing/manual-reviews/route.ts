import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { isPricingV2PackageCode } from "@/lib/pricing-v2";
import {
  assertThePayOneBillingEnabled,
  createPaymentTrackId,
  refundThePayOnePayment,
  thePayOneCredentialScopeForMerchantTerminal,
  thePayOneRefundMismatchFields,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("no_approval"),
    requestId: z.string().uuid(),
    orderId: z.string().uuid(),
    note: z.string().trim().min(2).max(400),
    confirmation: z.literal("PG 승인 없음 확인"),
  }).strict(),
  z.object({
    action: z.literal("refund_approved"),
    requestId: z.string().uuid(),
    orderId: z.string().uuid(),
    providerTransactionId: z.string().trim().min(4).max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    note: z.string().trim().min(2).max(400),
    confirmation: z.literal("PG 승인 확인 및 전액취소"),
  }).strict(),
]);

function safeFailureMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  return error.message
    .replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]")
    .slice(0, 300);
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
      const existingRefunds = await tx`
        select * from shorts_mvp.admin_billing_refunds
        where request_id=${body.requestId}
        limit 1
      `;
      if (existingRefunds[0]) {
        if (
          body.action !== "refund_approved"
          || existingRefunds[0].billingOrderId !== body.orderId
          || existingRefunds[0].rootProviderTransactionId !== body.providerTransactionId
        ) {
          throw new HttpError(409, "이 처리 요청 ID가 다른 PG 대조 작업에 이미 사용되었습니다.");
        }
        return { kind: "refund" as const, refund: existingRefunds[0], order: null };
      }

      const orders = await tx`
        select * from shorts_mvp.billing_orders
        where id=${body.orderId}
        for update
      `;
      const order = orders[0];
      if (!order) throw new HttpError(404, "확인할 결제 주문을 찾을 수 없습니다.");
      if (
        order.provider !== "thepayone"
        || (
          order.kind !== "addon"
          && !isPricingV2PackageCode(String(order.productCode))
        )
      ) {
        throw new HttpError(
          409,
          "패키지·추가시간 더페이원 수기결제 주문만 이 화면에서 처리할 수 있습니다.",
        );
      }
      const credentialScope = thePayOneCredentialScopeForMerchantTerminal(
        String(order.providerMerchantId),
        String(order.providerTerminalId),
      );
      if (credentialScope !== "manual") {
        throw new HttpError(
          409,
          "arti02 수기결제 주문이 아닙니다. 기존 환불 절차를 이용해 주세요.",
        );
      }
      const grants = await tx`
        select count(*)::integer as grant_count
        from shorts_mvp.usage_grants
        where billing_order_id=${order.id}
      `;
      if (Number(grants[0]?.grantCount || 0) > 0) {
        throw new HttpError(
          409,
          "이 주문에 연결된 권한이 있어 결과 불명 전용 처리로 종결할 수 없습니다.",
        );
      }
      if (order.refundStatus !== "none") {
        throw new HttpError(
          409,
          "이 주문은 이미 취소 처리 중이거나 취소 결과 대조가 필요합니다.",
        );
      }

      if (body.action === "no_approval") {
        if (
          order.status === "failed"
          && order.failureCode === "MANUAL_REVIEW_NO_APPROVAL"
        ) {
          return { kind: "no_approval" as const, order, alreadyProcessed: true };
        }
        if (!["manual_review", "unknown"].includes(String(order.status))) {
          throw new HttpError(409, "PG 대조가 필요한 주문 상태가 아닙니다.");
        }
        await tx`
          update shorts_mvp.billing_orders
          set status='failed',provider_status='no_approval',
            failure_code='MANUAL_REVIEW_NO_APPROVAL',
            failure_message='PG 관리자에서 승인 없음 확인'
          where id=${order.id}
        `;
        await tx`
          update shorts_mvp.billing_attempts
          set status='failed',provider_code='MANUAL_REVIEW_NO_APPROVAL',
            finished_at=coalesce(finished_at,now())
          where order_id=${order.id} and status in ('processing','unknown')
        `;
        await tx`
          insert into shorts_mvp.admin_audit_logs (
            actor_user_id,action,entity_type,entity_id,metadata
          ) values (
            ${admin.id},'billing.manual_review_no_approval','billing_order',${order.id},
            ${tx.json({
              requestId: body.requestId,
              note: body.note,
              previousStatus: order.status,
              amountKrw: Number(order.amountKrw),
              recordedProviderTransactionId: order.providerTransactionId || null,
              providerTerminalId: order.providerTerminalId,
            })}
          )
        `;
        return { kind: "no_approval" as const, order, alreadyProcessed: false };
      }

      if (!["manual_review", "unknown"].includes(String(order.status))) {
        throw new HttpError(409, "PG 대조가 필요한 주문 상태가 아닙니다.");
      }
      if (
        order.providerTransactionId
        && order.providerTransactionId !== body.providerTransactionId
      ) {
        throw new HttpError(409, "입력한 승인 거래번호가 주문 기록과 일치하지 않습니다.");
      }
      if (Number(order.amountKrw) <= 0) {
        throw new HttpError(409, "전액취소할 주문 금액이 올바르지 않습니다.");
      }
      const activeRefunds = await tx`
        select id
        from shorts_mvp.admin_billing_refunds
        where billing_order_id=${order.id}
          and status in ('pending','processing','succeeded','manual_review')
        limit 1
      `;
      if (activeRefunds[0]) {
        throw new HttpError(409, "이 주문의 전액취소가 이미 처리 중이거나 대조 중입니다.");
      }
      const trackId = createPaymentTrackId("REFUND");
      const inserted = await tx`
        insert into shorts_mvp.admin_billing_refunds (
          request_id,billing_order_id,requested_by_user_id,provider,provider_track_id,
          root_provider_transaction_id,amount_krw,reason,status,refund_policy_version,
          entitlement_action_mode,entitlement_action_status
        ) values (
          ${body.requestId},${order.id},${admin.id},'thepayone',${trackId},
          ${body.providerTransactionId},${Number(order.amountKrw)},
          ${`[결과 불명 승인 확인 후 전액취소] ${body.note}`},'pending',${3},
          'none','not_required'
        ) returning *
      `;
      await tx`
        update shorts_mvp.billing_orders
        set provider_transaction_id=coalesce(provider_transaction_id,${body.providerTransactionId}),
          provider_status='approved_pending_refund'
        where id=${order.id}
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'billing.manual_review_refund_requested','billing_order',${order.id},
          ${tx.json({
            requestId: body.requestId,
            refundId: inserted[0].id,
            note: body.note,
            amountKrw: Number(order.amountKrw),
            providerTransactionId: body.providerTransactionId,
            providerTerminalId: order.providerTerminalId,
          })}
        )
      `;
      return { kind: "refund" as const, refund: inserted[0], order };
    });

    if (prepared.kind === "no_approval") {
      return NextResponse.json({
        ok: true,
        action: "no_approval",
        alreadyProcessed: prepared.alreadyProcessed,
      });
    }

    const refund = prepared.refund;
    refundId = refund.id;
    billingOrderId = refund.billingOrderId;
    if (refund.status === "succeeded") {
      return NextResponse.json({
        ok: true,
        action: "refund_approved",
        refundId: refund.id,
        alreadyProcessed: true,
      });
    }
    if (refund.status !== "pending") {
      throw new HttpError(409, "이미 처리 중이거나 추가 확인이 필요한 취소 요청입니다.");
    }
    const order = prepared.order || (await db`
      select * from shorts_mvp.billing_orders
      where id=${refund.billingOrderId}
      limit 1
    `)[0];
    if (!order) throw new HttpError(404, "전액취소할 원주문을 찾을 수 없습니다.");
    const credentialScope = thePayOneCredentialScopeForMerchantTerminal(
      String(order.providerMerchantId),
      String(order.providerTerminalId),
    );
    if (credentialScope !== "manual") {
      throw new HttpError(409, "arti02 수기결제 주문이 아닙니다.");
    }
    const claim = await db`
      update shorts_mvp.admin_billing_refunds
      set status='processing'
      where id=${refund.id} and status='pending'
      returning id
    `;
    if (!claim[0]) throw new HttpError(409, "다른 요청에서 전액취소를 처리하고 있습니다.");
    claimed = true;

    const providerRefund = await refundThePayOnePayment({
      trackId: refund.providerTrackId,
      rootTransactionId: refund.rootProviderTransactionId,
      amount: Number(refund.amountKrw),
      referenceId: refund.id,
      reason: refund.reason,
    }, credentialScope);
    const mismatchFields = thePayOneRefundMismatchFields(providerRefund, {
      trackId: refund.providerTrackId,
      rootTransactionId: refund.rootProviderTransactionId,
      amount: Number(refund.amountKrw),
      terminalId: String(order.providerTerminalId),
    });
    if (mismatchFields.length > 0) {
      throw new ThePayOneError(
        "전액취소 결과가 원주문과 일치하지 않습니다.",
        "REFUND_MISMATCH",
        `불일치 필드: ${mismatchFields.join(",")}`,
        true,
      );
    }

    await db.begin(async (tx) => {
      const lockedRefunds = await tx`
        select * from shorts_mvp.admin_billing_refunds
        where id=${refund.id}
        for update
      `;
      if (!lockedRefunds[0] || lockedRefunds[0].status !== "processing") {
        throw new Error("REFUND_STATE_CHANGED");
      }
      const lockedOrders = await tx`
        select * from shorts_mvp.billing_orders
        where id=${order.id}
        for update
      `;
      if (!lockedOrders[0]) throw new Error("REFUND_ORDER_MISSING");
      const grants = await tx`
        select count(*)::integer as grant_count
        from shorts_mvp.usage_grants
        where billing_order_id=${order.id}
      `;
      if (Number(grants[0]?.grantCount || 0) > 0) {
        throw new Error("ENTITLEMENT_CREATED_DURING_REVIEW");
      }
      await tx`
        update shorts_mvp.billing_orders
        set status='canceled',provider_status='refunded',
          refunded_amount_krw=${Number(order.amountKrw)},refund_status='full',
          failure_code='MANUAL_REVIEW_APPROVAL_REFUNDED',
          failure_message='PG 승인 확인 후 전액취소 완료'
        where id=${order.id}
      `;
      await tx`
        update shorts_mvp.admin_billing_refunds
        set status='succeeded',
          provider_refund_transaction_id=${providerRefund.providerTransactionId},
          provider_code=${providerRefund.resultCode},failure_message=null,
          entitlement_action_status='not_required',processed_at=${providerRefund.refundedAt}
        where id=${refund.id}
      `;
      await tx`
        update shorts_mvp.billing_payment_events
        set billing_order_id=${order.id},validation_status='processed',
          processing_result='manual_review_refund_reconciled',processed_at=now()
        where provider='thepayone'
          and provider_transaction_id=${providerRefund.providerTransactionId}
          and validation_status in ('received','validated')
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'billing.manual_review_refund_succeeded','billing_refund',${refund.id},
          ${tx.json({
            orderId: order.id,
            amountKrw: Number(refund.amountKrw),
            providerRefundTransactionId: providerRefund.providerTransactionId,
            entitlementGranted: false,
          })}
        )
      `;
    });
    return NextResponse.json({
      ok: true,
      action: "refund_approved",
      refundId: refund.id,
      amountKrw: Number(refund.amountKrw),
    });
  } catch (error) {
    if (refundId && claimed) {
      const unknown = error instanceof ThePayOneError && error.outcomeUnknown;
      try {
        await getDb().begin(async (tx) => {
          await tx`
            update shorts_mvp.admin_billing_refunds
            set status=${unknown ? "manual_review" : "failed"},
              provider_code=${error instanceof ThePayOneError
                ? error.resultCode
                : "MANUAL_REVIEW_REFUND_FAILED"},
              failure_message=${safeFailureMessage(error)},processed_at=now(),
              entitlement_action_status='not_required'
            where id=${refundId} and status='processing'
          `;
          if (billingOrderId) await tx`
            update shorts_mvp.billing_orders
            set refund_status=${unknown ? "manual_review" : "none"},
              provider_status=${unknown ? "refund_manual_review" : "approved_refund_failed"}
            where id=${billingOrderId}
          `;
        });
      } catch {
        // Keep the original provider result for the next operator reconciliation.
      }
    }
    return apiError(error, "결제 확인 결과를 처리하지 못했습니다.");
  }
}
